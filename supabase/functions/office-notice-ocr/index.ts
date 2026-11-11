// supabase/functions/office-notice-ocr/index.ts
// 🏢 Office "ready for collection" notice reader (owner 2026-11-11).
//
// The office (Agnes) sends a photo / screenshot of an Excel table, e.g.
//   "財庫 pls collect on 11 NOV 2026,WED - lvl 20"
//   "CALLIGRAPHY (DELIVER 22 MAY 2026) … collect this FRIDAY (22 MAY 2026), 1pm at LVL 20, KL HQ"
// with columns like SN NO | group | DEALER NAME | CUSTOMER NAME | ITEM (+ NO,
// MONTH, ORDER DATE, REMARKS, PO AREA on some sheets).
//
// The phone has already uploaded the photo to the attachments bucket and made an
// office_notices row. This function reads the photo SERVER-SIDE (so a phone that
// goes to sleep doesn't lose the read), writes the heading fields onto the notice
// and every table line into office_notice_lines, and returns them.
//
// Caller: signed-in staff (level <= 12), checked with the caller's own JWT.
// Request:  POST { notice_id }
// Response: { ok, notice, lines }  |  { ok:false, error, code?, detail? }
//
// Deploy: SUPABASE_ACCESS_TOKEN=<PAT> npx -y supabase@2.121.0 functions deploy
//         office-notice-ocr --project-ref remuwhxvzkzjtgbzqjaa --use-api --no-verify-jwt
// (--no-verify-jwt: the function checks the JWT itself, like order-form-ocr.)

// @ts-ignore
const SUPABASE_URL: string = Deno.env.get("SUPABASE_URL") || "";
// @ts-ignore
const SERVICE_ROLE: string = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
// @ts-ignore
const ANON_KEY: string = Deno.env.get("SUPABASE_ANON_KEY") || "";
// @ts-ignore
const GEMINI_API_KEY: string = Deno.env.get("GEMINI_API_KEY") || "";
// @ts-ignore
const ANTHROPIC_API_KEY: string = Deno.env.get("ANTHROPIC_API_KEY") || "";

import { readForm, readError } from "../_shared/form-reader.ts";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } });

const svc = { apikey: SERVICE_ROLE, Authorization: `Bearer ${SERVICE_ROLE}` };

// Staff only: ask the database for the caller's level with the caller's own JWT.
async function requireStaff(req: Request): Promise<{ ok: true; token: string } | { ok: false; reason: string; status: number }> {
  const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  if (!token) return { ok: false, reason: "no_token", status: 401 };
  const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/current_user_level`, {
    method: "POST",
    headers: { apikey: ANON_KEY, Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: "{}",
  });
  if (res.status === 401) return { ok: false, reason: "invalid_token", status: 401 };
  if (!res.ok) return { ok: false, reason: "level_lookup_failed", status: 500 };
  const level = Number(await res.json());
  if (!(level >= 1 && level <= 12)) return { ok: false, reason: "staff_only", status: 403 };
  return { ok: true, token };
}

const _rlHits = new Map<string, number[]>();
function rateLimited(key: string): boolean {
  const now = Date.now();
  const arr = (_rlHits.get(key) || []).filter((t) => now - t < 60_000);
  arr.push(now);
  _rlHits.set(key, arr);
  return arr.length > 15;
}

const PROMPT = `You are reading a photo or screenshot of a table (usually an Excel sheet) that a company office sends to its sales managers. It lists products that are READY FOR COLLECTION at the office.

Above the table there are 1–3 heading lines. Examples:
  "財庫 pls collect on 11 NOV 2026,WED - lvl 20"
  "CALLIGRAPHY (DELIVER 22 MAY 2026)" / "Dear Manager" / "pls arrange to collect this FRIDAY (22 MAY 2026), 1pm at LVL 20, KL HQ. thank you"
  "SG - CALLI Namelist & arrangement"

The table columns vary between sheets. Common ones: SN NO, group, DEALER NAME, CUSTOMER NAME, ITEM, and sometimes NO, MONTH, ORDER DATE, REMARKS, PO AREA.

Return:
- is_ready_list: true when the picture is such a table of products/orders (even a partial one). false for anything else (an order form, a receipt, a chat, a person).
- title: all heading text above the table, joined with " / ", exactly as written.
- category: the product group named in the heading if any (e.g. "財庫", "CALLIGRAPHY", "SG - CALLI"), else null.
- collect_date: the date they ask us to collect / deliver, as ISO YYYY-MM-DD (e.g. "22 MAY 2026" → "2026-05-22", "11 NOV 2026" → "2026-11-11"). Malaysian dates are day-first. null if no date is given.
- collect_time: the time if given (e.g. "1pm", "11am"), else null.
- place: where to collect, as written (e.g. "LVL 20, KL HQ", "lvl 20", "loading bay, KL HQ"), else null.
- lines: ONE entry per table row, top to bottom. Skip only the header row. Do NOT merge rows that repeat the same SN — the same SN on several rows means several items.
  For each row:
  - sn: the SN NO cell exactly as written, keeping any letters or spaces ("1908016", "19029678", "PR 1921423", "SG 0000013", "80783").
  - group: the group cell (e.g. "LIM CY") or null.
  - dealer: the DEALER NAME cell or null.
  - customer: the CUSTOMER NAME cell or null (company names are fine).
  - item: the ITEM cell exactly as written — keep Chinese characters as they appear (traditional stays traditional), e.g. "財庫", "上龍柄", "天至喜 1", "元亨利貞".
  - order_date: the ORDER DATE or MONTH cell as written, or null.
  - remarks: any other cell on the row (REMARKS, PO AREA, NO) joined with " / ", or null.

Never invent rows or values; use null for a blank or unreadable cell. Return STRICT JSON matching the schema.`;

const SCHEMA = {
  type: "OBJECT",
  properties: {
    is_ready_list: { type: "BOOLEAN" },
    title: { type: "STRING", nullable: true },
    category: { type: "STRING", nullable: true },
    collect_date: { type: "STRING", nullable: true },
    collect_time: { type: "STRING", nullable: true },
    place: { type: "STRING", nullable: true },
    lines: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          sn: { type: "STRING", nullable: true },
          group: { type: "STRING", nullable: true },
          dealer: { type: "STRING", nullable: true },
          customer: { type: "STRING", nullable: true },
          item: { type: "STRING", nullable: true },
          order_date: { type: "STRING", nullable: true },
          remarks: { type: "STRING", nullable: true },
        },
        required: ["sn", "group", "dealer", "customer", "item", "order_date", "remarks"],
      },
    },
  },
  required: ["is_ready_list", "title", "category", "collect_date", "collect_time", "place", "lines"],
};

const clean = (v: unknown, max = 300): string | null => {
  const s = v == null ? "" : String(v).replace(/\s+/g, " ").trim();
  return s ? s.slice(0, max) : null;
};
const isoDay = (v: unknown): string | null => {
  const s = String(v || "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const d = new Date(s + "T00:00:00Z");
  return isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== s ? null : s;
};

function toBase64(bytes: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

async function patchNotice(id: number, patch: Record<string, unknown>) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/office_notices?id=eq.${id}`, {
    method: "PATCH",
    headers: { ...svc, "Content-Type": "application/json", Prefer: "return=representation" },
    body: JSON.stringify(patch),
  });
  if (!res.ok) throw new Error(`notice_update_${res.status}`);
  return (await res.json())?.[0] || null;
}

// @ts-ignore
Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS_HEADERS });
  if (req.method !== "POST") return json({ ok: false, error: "method_not_allowed" }, 405);
  if (!GEMINI_API_KEY && !ANTHROPIC_API_KEY) return json({ ok: false, error: "ai_key_not_configured" }, 500);

  const auth = await requireStaff(req);
  if (!auth.ok) return json({ ok: false, error: auth.reason }, auth.status);
  if (rateLimited(auth.token.slice(-24))) {
    return json({ ok: false, error: "rate_limited", detail: "Too many reads — wait a minute and try again." }, 429);
  }

  let noticeId = 0;
  try {
    const body = await req.json();
    noticeId = Number(body?.notice_id);
  } catch { /* handled below */ }
  if (!Number.isInteger(noticeId) || noticeId <= 0) return json({ ok: false, error: "no_notice_id" }, 400);

  // The notice row + its photo (service role: the phone already proved it is staff).
  const nRes = await fetch(`${SUPABASE_URL}/rest/v1/office_notices?id=eq.${noticeId}&select=id,photo_path,status`, { headers: svc });
  const notice = nRes.ok ? (await nRes.json())?.[0] : null;
  if (!notice) return json({ ok: false, error: "notice_not_found" }, 404);
  if (notice.status === "applied") return json({ ok: false, error: "already_applied", detail: "This notice is already confirmed — it can't be read again." }, 409);
  if (notice.status === "discarded") return json({ ok: false, error: "discarded" }, 409);

  const path = String(notice.photo_path || "");
  const pRes = await fetch(`${SUPABASE_URL}/storage/v1/object/attachments/${path.split("/").map(encodeURIComponent).join("/")}`, { headers: svc });
  if (!pRes.ok) return json({ ok: false, error: "photo_not_found" }, 404);
  const mime = (pRes.headers.get("content-type") || "image/jpeg").split(";")[0].trim().toLowerCase();
  if (!["image/jpeg", "image/png", "image/webp"].includes(mime)) return json({ ok: false, error: "unsupported_image_type" }, 400);
  const bytes = new Uint8Array(await pRes.arrayBuffer());
  if (bytes.length > 8 * 1024 * 1024) return json({ ok: false, error: "image_too_large" }, 413);

  let result: any, provider = "";
  try {
    ({ result, provider } = await readForm({
      tag: "office-notice-ocr", prompt: PROMPT, imageBase64: toBase64(bytes), mimeType: mime,
      schema: SCHEMA, thinkingBudget: 1024,
    }));
  } catch (e) {
    console.error("[office-notice-ocr] read failed:", String((e as any)?.message || e));
    const r = readError(e);
    try { await patchNotice(noticeId, { read_error: r.code }); } catch { /* best effort */ }
    return json({ ok: false, error: "ocr_failed", code: r.code, detail: r.detail.replace("key the fields in", "type the SNs in") }, r.status);
  }

  const lines = (Array.isArray(result?.lines) ? result.lines : []).slice(0, 200)
    .map((l: any, i: number) => ({
      notice_id: noticeId, line_no: i + 1,
      sn_raw: clean(l?.sn, 60), grp: clean(l?.group, 80), dealer: clean(l?.dealer, 120),
      customer: clean(l?.customer, 160), item: clean(l?.item, 200),
      order_date: clean(l?.order_date, 40), remarks: clean(l?.remarks, 200),
    }))
    .filter((l: any) => l.sn_raw || l.customer || l.item);

  try {
    // Re-reading replaces the lines (nothing on this notice is confirmed yet).
    const del = await fetch(`${SUPABASE_URL}/rest/v1/office_notice_lines?notice_id=eq.${noticeId}`, { method: "DELETE", headers: svc });
    if (!del.ok) throw new Error(`lines_delete_${del.status}`);
    if (lines.length) {
      const ins = await fetch(`${SUPABASE_URL}/rest/v1/office_notice_lines`, {
        method: "POST",
        headers: { ...svc, "Content-Type": "application/json", Prefer: "return=minimal" },
        body: JSON.stringify(lines),
      });
      if (!ins.ok) throw new Error(`lines_insert_${ins.status}`);
    }
    const saved = await patchNotice(noticeId, {
      status: "read", is_ready_list: result?.is_ready_list !== false,
      title: clean(result?.title, 500), category: clean(result?.category, 80),
      collect_date: isoDay(result?.collect_date), collect_time: clean(result?.collect_time, 40),
      place: clean(result?.place, 120), read_provider: provider, read_error: null, read_at: new Date().toISOString(),
    });
    return json({ ok: true, notice: saved, lines: lines.length });
  } catch (e) {
    console.error("[office-notice-ocr] save failed:", String((e as any)?.message || e));
    return json({ ok: false, error: "save_failed", detail: "Read the photo but couldn't save the lines — try Read again." }, 500);
  }
});
