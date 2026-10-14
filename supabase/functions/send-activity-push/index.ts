// supabase/functions/send-activity-push/index.ts
// Deno Edge Function — Deno-native Web Push sender (RFC 8291, aes128gcm).
// No npm or esm.sh dependencies for the crypto — uses Web Crypto only.
//
// Request body (enqueue + deliver):
//   { activity: {...}, targetUserIds: string[], title?, body?, url?, kind?, priority?, dedupe_key? }
// Request body (server-only retry/dispatch): { dispatch: true, ids?: number[] }
// Every notification is written to notification_outbox (queue + log + bell inbox) first.

// Use Deno.serve directly — no external http server lib needed.
// We also skip the Supabase JS SDK (it has transitive deps that BOOT_ERROR
// in the Edge Runtime) and talk to PostgREST with plain fetch.
// @ts-ignore
const serve = (handler: (req: Request) => Promise<Response> | Response) => Deno.serve(handler);

async function pgSelect(
  table: string,
  params: Record<string, string>,
): Promise<any[]> {
  const qs = new URLSearchParams(params).toString();
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}?${qs}`, {
    headers: {
      "apikey": SERVICE_ROLE,
      "Authorization": `Bearer ${SERVICE_ROLE}`,
      "Accept": "application/json",
    },
  });
  if (!res.ok) throw new Error(`pg_select ${table} ${res.status}: ${await res.text()}`);
  return await res.json();
}

async function pgDelete(table: string, params: Record<string, string>): Promise<boolean> {
  const qs = new URLSearchParams(params).toString();
  // Surface delete failures: pgSelect throws on !res.ok, but a silently-swallowed
  // DELETE failure (RLS/network/400) leaves expired subscriptions un-pruned while the
  // caller still reports them as removed. Return a boolean so the prune count is honest.
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}?${qs}`, {
    method: "DELETE",
    headers: {
      "apikey": SERVICE_ROLE,
      "Authorization": `Bearer ${SERVICE_ROLE}`,
    },
  });
  if (!res.ok) {
    console.warn(`pg_delete ${table} ${res.status}: ${await res.text().catch(() => "")}`);
    return false;
  }
  return true;
}

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function callerRole(req: Request): string | null {
  const h = req.headers.get("authorization") || "";
  const t = h.replace(/^Bearer\s+/i, "");
  if (!t) return null;
  // Server-to-server: notify-on-activity forwards with THIS project's
  // SUPABASE_SERVICE_ROLE_KEY env value. That value is not guaranteed to be a
  // JWT carrying role=service_role (new-format sb_secret_ keys are opaque), so
  // decoding it returned null and every new-activity push 401'd
  // ("unauthorized", seen live 2026-10-14). Exact match is the authoritative check.
  if (SERVICE_ROLE && t === SERVICE_ROLE) return "service_role";
  // JWT payloads are base64URL without padding — plain atob() throws on '-'/'_'.
  try {
    let p = (t.split(".")[1] || "").replace(/-/g, "+").replace(/_/g, "/");
    while (p.length % 4) p += "=";
    return (JSON.parse(atob(p)).role) || null;
  } catch { return null; }
}

// @ts-ignore
const VAPID_PUBLIC = Deno.env.get("VAPID_PUBLIC_KEY") || "";
// @ts-ignore
const VAPID_PRIVATE = Deno.env.get("VAPID_PRIVATE_KEY") || "";
// @ts-ignore
const VAPID_SUBJECT = Deno.env.get("VAPID_SUBJECT") || "mailto:admin@destinoraclessolution.com";
// @ts-ignore
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
// @ts-ignore
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";

// ---------- base64url helpers ----------
function b64urlEncode(bytes: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function b64urlDecode(s: string): Uint8Array {
  s = s.replace(/-/g, "+").replace(/_/g, "/");
  while (s.length % 4) s += "=";
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
function concat(...arrs: Uint8Array[]): Uint8Array {
  const total = arrs.reduce((a, b) => a + b.length, 0);
  const out = new Uint8Array(total);
  let off = 0;
  for (const a of arrs) { out.set(a, off); off += a.length; }
  return out;
}
function u16be(n: number): Uint8Array {
  return new Uint8Array([(n >> 8) & 0xff, n & 0xff]);
}
function u32be(n: number): Uint8Array {
  const b = new Uint8Array(4);
  new DataView(b.buffer).setUint32(0, n >>> 0);
  return b;
}

// ---------- Import VAPID private key as ECDSA P-256 CryptoKey ----------
async function importVapidPrivateKey(): Promise<CryptoKey> {
  const d = b64urlDecode(VAPID_PRIVATE); // 32 bytes
  const pub = b64urlDecode(VAPID_PUBLIC); // 65 bytes (uncompressed: 0x04 || x || y)
  const x = pub.slice(1, 33);
  const y = pub.slice(33, 65);
  const jwk = {
    kty: "EC",
    crv: "P-256",
    d: b64urlEncode(d),
    x: b64urlEncode(x),
    y: b64urlEncode(y),
    ext: true,
  };
  return await crypto.subtle.importKey(
    "jwk",
    jwk,
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["sign"],
  );
}

// ---------- Build & sign a VAPID JWT ----------
async function makeVapidJwt(audience: string): Promise<string> {
  const key = await importVapidPrivateKey();
  const header = { typ: "JWT", alg: "ES256" };
  const payload = {
    aud: audience,
    exp: Math.floor(Date.now() / 1000) + 12 * 60 * 60, // 12h
    sub: VAPID_SUBJECT,
  };
  const enc = new TextEncoder();
  const h = b64urlEncode(enc.encode(JSON.stringify(header)));
  const p = b64urlEncode(enc.encode(JSON.stringify(payload)));
  const data = enc.encode(`${h}.${p}`);
  const sig = new Uint8Array(await crypto.subtle.sign(
    { name: "ECDSA", hash: "SHA-256" },
    key,
    data,
  ));
  return `${h}.${p}.${b64urlEncode(sig)}`;
}

// ---------- HKDF using Web Crypto ----------
async function hkdf(
  salt: Uint8Array,
  ikm: Uint8Array,
  info: Uint8Array,
  length: number,
): Promise<Uint8Array> {
  const baseKey = await crypto.subtle.importKey(
    "raw",
    ikm,
    { name: "HKDF" },
    false,
    ["deriveBits"],
  );
  const bits = await crypto.subtle.deriveBits(
    { name: "HKDF", hash: "SHA-256", salt, info },
    baseKey,
    length * 8,
  );
  return new Uint8Array(bits);
}

// ---------- Encrypt payload with aes128gcm (RFC 8188/8291) ----------
async function encryptPayload(
  payload: Uint8Array,
  recipientP256dh: Uint8Array, // 65 bytes, 0x04 || x || y
  recipientAuth: Uint8Array,   // 16 bytes
): Promise<{ body: Uint8Array; salt: Uint8Array; asPublicKey: Uint8Array }> {
  // 1. Generate ephemeral ECDH keypair
  const asKeys = await crypto.subtle.generateKey(
    { name: "ECDH", namedCurve: "P-256" },
    true,
    ["deriveBits"],
  );
  const asPublicJwk = await crypto.subtle.exportKey("jwk", asKeys.publicKey);
  const asX = b64urlDecode(asPublicJwk.x!);
  const asY = b64urlDecode(asPublicJwk.y!);
  const asPublicKey = concat(new Uint8Array([0x04]), asX, asY); // 65 bytes

  // 2. Import recipient public key
  const recipX = recipientP256dh.slice(1, 33);
  const recipY = recipientP256dh.slice(33, 65);
  const recipJwk = {
    kty: "EC",
    crv: "P-256",
    x: b64urlEncode(recipX),
    y: b64urlEncode(recipY),
    ext: true,
  };
  const recipPub = await crypto.subtle.importKey(
    "jwk",
    recipJwk,
    { name: "ECDH", namedCurve: "P-256" },
    false,
    [],
  );

  // 3. ECDH
  const ecdhSecret = new Uint8Array(await crypto.subtle.deriveBits(
    { name: "ECDH", public: recipPub },
    asKeys.privateKey,
    256,
  ));

  // 4. Salt (16 random bytes)
  const salt = new Uint8Array(16);
  crypto.getRandomValues(salt);

  // 5. PRK_key = HKDF(auth, ecdhSecret, "WebPush: info\0" || ua_public || as_public, 32)
  const enc = new TextEncoder();
  const keyInfo = concat(
    enc.encode("WebPush: info\0"),
    recipientP256dh,
    asPublicKey,
  );
  const ikm = await hkdf(recipientAuth, ecdhSecret, keyInfo, 32);

  // 6. CEK = HKDF(salt, ikm, "Content-Encoding: aes128gcm\0", 16)
  const cek = await hkdf(salt, ikm, concat(enc.encode("Content-Encoding: aes128gcm\0")), 16);

  // 7. Nonce = HKDF(salt, ikm, "Content-Encoding: nonce\0", 12)
  const nonce = await hkdf(salt, ikm, concat(enc.encode("Content-Encoding: nonce\0")), 12);

  // 8. Pad payload: append 0x02 padding delimiter, then encrypt with AES-128-GCM
  const padded = concat(payload, new Uint8Array([0x02]));
  const cekKey = await crypto.subtle.importKey(
    "raw",
    cek,
    { name: "AES-GCM" },
    false,
    ["encrypt"],
  );
  const ciphertext = new Uint8Array(await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: nonce },
    cekKey,
    padded,
  ));

  // 9. Body = salt(16) || rs(4, big-endian = 4096) || idlen(1, = 65) || as_public(65) || ciphertext
  const rs = 4096;
  const body = concat(
    salt,
    u32be(rs),
    new Uint8Array([asPublicKey.length]),
    asPublicKey,
    ciphertext,
  );

  return { body, salt, asPublicKey };
}

// ---------- Send a single web push ----------
async function sendWebPush(
  subscription: { endpoint: string; keys: { p256dh: string; auth: string } },
  payload: string,
  urgency = "high",
): Promise<{ ok: boolean; status: number; error?: string }> {
  try {
    const url = new URL(subscription.endpoint);
    const audience = `${url.protocol}//${url.host}`;
    const jwt = await makeVapidJwt(audience);

    const p256dh = b64urlDecode(subscription.keys.p256dh);
    const auth = b64urlDecode(subscription.keys.auth);

    const { body } = await encryptPayload(new TextEncoder().encode(payload), p256dh, auth);

    const res = await fetch(subscription.endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/octet-stream",
        "Content-Encoding": "aes128gcm",
        "Content-Length": String(body.length),
        "TTL": "86400",
        // High urgency: Android (FCM) otherwise holds "normal" pushes while the
        // phone dozes; APNs honours it too. Calendar alerts are time-sensitive.
        "Urgency": urgency,
        "Authorization": `vapid t=${jwt}, k=${VAPID_PUBLIC}`,
      },
      body,
    });

    if (res.status >= 200 && res.status < 300) {
      return { ok: true, status: res.status };
    }
    const errText = await res.text().catch(() => "");
    return { ok: false, status: res.status, error: errText.slice(0, 200) };
  } catch (e: any) {
    return { ok: false, status: 0, error: String(e?.message || e) };
  }
}

// ---------- Outbox (notification_outbox) ----------
// Every notification is queued as one row per recipient, then delivered here.
// The row is also the delivery log and the in-app bell inbox, so a user with
// no phone signed up still sees it in the bell (status 'no_device').
async function pgInsertReturning(table: string, rows: any[], onConflict?: string): Promise<any[]> {
  const qs = onConflict ? `?on_conflict=${onConflict}` : "";
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}${qs}`, {
    method: "POST",
    headers: {
      "apikey": SERVICE_ROLE,
      "Authorization": `Bearer ${SERVICE_ROLE}`,
      "Content-Type": "application/json",
      "Accept": "application/json",
      // ignore-duplicates + representation → only NEWLY inserted rows come back,
      // so a dedupe_key that was already queued is silently skipped.
      "Prefer": "return=representation" + (onConflict ? ",resolution=ignore-duplicates" : ""),
    },
    body: JSON.stringify(rows),
  });
  if (!res.ok) throw new Error(`pg_insert ${table} ${res.status}: ${await res.text()}`);
  return await res.json();
}

async function pgPatch(table: string, params: Record<string, string>, patch: any): Promise<void> {
  const qs = new URLSearchParams(params).toString();
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}?${qs}`, {
    method: "PATCH",
    headers: {
      "apikey": SERVICE_ROLE,
      "Authorization": `Bearer ${SERVICE_ROLE}`,
      "Content-Type": "application/json",
      "Prefer": "return=minimal",
    },
    body: JSON.stringify(patch),
  });
  if (!res.ok) console.warn(`pg_patch ${table} ${res.status}: ${await res.text().catch(() => "")}`);
}

const OUTBOX_COLS = "id,user_id,kind,priority,title,body,url,activity_id,attempts";
const MAX_ATTEMPTS = 3;
const KINDS = new Set([
  "activity_created", "activity_reminder", "daily_summary", "coagent_invite",
  "coagent_response", "highlight", "test", "push",
]);
const PRIORITIES = new Set(["low", "normal", "high", "urgent"]);

// Deliver queued rows: one push per row to each of the recipient's devices,
// then record the outcome on the row. Dead endpoints (404/410) are pruned.
async function deliverRows(rows: any[]): Promise<{ sent: number; noDevice: number; failed: number; pruned: number; devices: number }> {
  const out = { sent: 0, noDevice: 0, failed: 0, pruned: 0, devices: 0 };
  if (!rows.length) return out;

  const userIds = [...new Set(rows.map((r) => String(r.user_id)))];
  const subs: any[] = await pgSelect("push_subscriptions", {
    select: "id,endpoint,p256dh,auth,user_id",
    user_id: `in.(${userIds.map((u) => `"${u}"`).join(",")})`,
    enabled: "eq.true",
  });
  out.devices = subs.length;
  const subsByUser = new Map<string, any[]>();
  for (const s of subs) {
    const k = String(s.user_id);
    if (!subsByUser.has(k)) subsByUser.set(k, []);
    subsByUser.get(k)!.push(s);
  }

  // One send job per (row, device), run in bounded batches so an all-staff
  // event can't open hundreds of concurrent HTTPS requests.
  const jobs: { row: any; sub: any; payload: string; urgency: string }[] = [];
  for (const row of rows) {
    const payload = JSON.stringify({
      title: row.title,
      body: row.body,
      tag: `${row.kind}_${row.activity_id ?? row.id}`,
      icon: "icons/icon-192x192.png",
      badge: "icons/icon-72x72.png",
      data: { type: row.kind, activityId: row.activity_id, outboxId: row.id, url: row.url },
    });
    const urgency = row.priority === "low" ? "normal" : "high";
    for (const sub of subsByUser.get(String(row.user_id)) || []) jobs.push({ row, sub, payload, urgency });
  }
  const PUSH_BATCH = Math.max(1, Number(Deno.env.get("PUSH_BATCH")) || 100);
  const results: { ok: boolean; status: number; error?: string }[] = [];
  for (let i = 0; i < jobs.length; i += PUSH_BATCH) {
    const slice = jobs.slice(i, i + PUSH_BATCH);
    results.push(...await Promise.all(slice.map((j) =>
      sendWebPush({ endpoint: j.sub.endpoint, keys: { p256dh: j.sub.p256dh, auth: j.sub.auth } }, j.payload, j.urgency))));
  }

  const okCount = new Map<number, number>();
  const lastErr = new Map<number, string>();
  const dead = new Set<string>();
  results.forEach((r, i) => {
    const { row, sub } = jobs[i];
    if (r.ok) okCount.set(row.id, (okCount.get(row.id) || 0) + 1);
    else if (r.status === 404 || r.status === 410) dead.add(String(sub.id));
    else { lastErr.set(row.id, `${r.status} ${r.error || ""}`.trim().slice(0, 200)); console.warn("push err", r.status, r.error); }
  });

  if (dead.size) {
    const ok = await pgDelete("push_subscriptions", { id: `in.(${[...dead].map((i) => `"${i}"`).join(",")})` });
    if (ok) out.pruned = dead.size;
  }

  // Record outcomes, grouped so a 24-person fan-out is a handful of PATCHes.
  const now = new Date().toISOString();
  const groups = new Map<string, { ids: number[]; patch: any }>();
  for (const row of rows) {
    const n = okCount.get(row.id) || 0;
    const live = (subsByUser.get(String(row.user_id)) || []).filter((s) => !dead.has(String(s.id))).length;
    let patch: any;
    if (n > 0) { patch = { status: "sent", devices_sent: n, sent_at: now, last_error: null }; out.sent++; }
    else if (live === 0 && !lastErr.has(row.id)) { patch = { status: "no_device", devices_sent: 0, sent_at: now }; out.noDevice++; }
    else {
      const attempts = (row.attempts || 0) + 1;
      // Keep retrying (via the dispatch pass) until MAX_ATTEMPTS, then give up.
      patch = { status: attempts >= MAX_ATTEMPTS ? "no_device" : "failed", attempts, last_error: lastErr.get(row.id) || "no_device_accepted" };
      out.failed++;
    }
    const key = JSON.stringify(patch);
    if (!groups.has(key)) groups.set(key, { ids: [], patch });
    groups.get(key)!.ids.push(row.id);
  }
  for (const { ids, patch } of groups.values()) {
    await pgPatch("notification_outbox", { id: `in.(${ids.join(",")})` }, patch);
  }
  return out;
}

// ---------- HTTP handler ----------
serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: CORS_HEADERS });
  }

  const _role = callerRole(req);
  if (_role !== "service_role" && _role !== "authenticated") {
    return new Response(JSON.stringify({ error: "unauthorized" }), {
      status: 401,
      headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
    });
  }

  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "method_not_allowed" }), {
      status: 405,
      headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
    });
  }

  const json = (obj: unknown, status = 200) => new Response(JSON.stringify(obj), {
    status, headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
  });

  try {
    const reqBody = await req.json();
    if (!VAPID_PUBLIC || !VAPID_PRIVATE) return json({ error: "vapid_not_configured" }, 500);

    // ── Dispatch mode (server only): deliver already-queued rows. ──
    // { dispatch: true, ids?: number[] } — ids = rows a producer just queued;
    // without ids, (re)try every due pending/failed row from the last day.
    if (reqBody?.dispatch === true) {
      if (_role !== "service_role") return json({ error: "forbidden" }, 403);
      const ids = Array.isArray(reqBody.ids) ? reqBody.ids.map(Number).filter((n: number) => Number.isFinite(n)) : [];
      const params: Record<string, string> = { select: OUTBOX_COLS, order: "id.asc", limit: "300" };
      if (ids.length) {
        params.id = `in.(${ids.join(",")})`;
        params.status = "eq.pending";
      } else {
        params.status = "in.(pending,failed)";
        params.due_at = `lte.${new Date().toISOString()}`;
        params.created_at = `gte.${new Date(Date.now() - 86_400_000).toISOString()}`;
        params.attempts = `lt.${MAX_ATTEMPTS}`;
      }
      const rows = await pgSelect("notification_outbox", params);
      const r = await deliverRows(rows);
      return json({ ok: true, rows: rows.length, ...r });
    }

    // ── Enqueue + deliver now (existing API). ──
    // { activity, targetUserIds, title, body, url, kind?, priority?, dedupe_key? }
    const { activity, targetUserIds, title, body, url } = reqBody;
    if (!Array.isArray(targetUserIds) || targetUserIds.length === 0) {
      return json({ ok: true, sent: 0, reason: "no_targets" });
    }

    // Harden caller-supplied fields. This function accepts ANY authenticated
    // JWT (not just service_role), and the notificationclick handler in sw.js
    // (and the bell) opens data.url — so an unconstrained absolute URL would let
    // any logged-in user deliver a CRM-branded push that taps through to an
    // off-site phishing page. Every legitimate caller passes an in-app RELATIVE
    // link ("./index.html#..."), so reject anything that isn't relative, and
    // cap text so a caller can't stuff an oversized notification.
    const safeInAppUrl = (u: unknown): string => {
      const DEFAULT = "./index.html#calendar";
      if (typeof u !== "string" || u.length === 0 || u.length > 512) return DEFAULT;
      // Reject ASCII control chars first: the WHATWG URL parser STRIPS interior
      // tab/newline/CR before parsing, so "/\t/evil.com" would otherwise
      // collapse to a protocol-relative "//evil.com" and resolve OFF-origin.
      if (/[\u0000-\u001f\u007f]/.test(u)) return DEFAULT;
      // Absolute (scheme:), protocol-relative (//host), or backslash tricks -> reject.
      if (/^[a-z][a-z0-9+.-]*:/i.test(u) || u.startsWith("//") || u.includes("\\")) return DEFAULT;
      // Must be a same-origin relative path or hash.
      if (!(u.startsWith("./") || u.startsWith("/") || u.startsWith("#"))) return DEFAULT;
      // Authoritative check: resolve with the SAME parser the client will use and
      // require the result to stay on the base origin (i.e. the input really was
      // relative). Closes any normalization gap the string checks miss.
      try { const b = "https://app.invalid"; if (new URL(u, b).origin !== b) return DEFAULT; }
      catch { return DEFAULT; }
      return u;
    };
    const clampText = (s: unknown, max: number, fallback: string): string => {
      if (typeof s !== "string" || s.length === 0) return fallback;
      return s.length > max ? s.slice(0, max) : s;
    };

    const kind = KINDS.has(reqBody.kind) ? reqBody.kind : "push";
    const priority = PRIORITIES.has(reqBody.priority) ? reqBody.priority : "normal";
    const dedupeKey = typeof reqBody.dedupe_key === "string" && reqBody.dedupe_key ? reqBody.dedupe_key.slice(0, 200) : null;
    const activityId = activity?.id != null && Number.isFinite(Number(activity.id)) ? Number(activity.id) : null;
    const rowTitle = clampText(title, 150, "New Calendar Activity");
    const rowBody = clampText(body, 300, activity
      ? `${activity.type || activity.activity_type || "Activity"}: ${activity.title || activity.activity_title || activity.subject || ""}`.slice(0, 300)
      : "");
    const rowUrl = safeInAppUrl(url);

    const recipients = [...new Set(targetUserIds.map((u: unknown) => Number(u)).filter((n: number) => Number.isFinite(n)))];
    if (recipients.length === 0) return json({ ok: true, sent: 0, reason: "no_targets" });

    const queued = await pgInsertReturning("notification_outbox", recipients.map((uid) => ({
      user_id: uid, kind, priority, title: rowTitle, body: rowBody, url: rowUrl,
      activity_id: activityId, dedupe_key: dedupeKey,
    })), dedupeKey ? "user_id,dedupe_key" : undefined);

    const r = await deliverRows(queued.map((q: any) => ({ ...q, attempts: 0 })));
    return json({
      ok: true, queued: queued.length, sent: r.sent, no_device: r.noDevice, failed: r.failed, pruned: r.pruned,
      ...(r.devices === 0 ? { reason: "no_subscriptions" } : {}),
    });
  } catch (e: any) {
    return json({ error: "internal", detail: String(e?.message || e) }, 500);
  }
});
