// supabase/functions/admin-auth-ops/index.ts
// Admin auth operations — service_role only lives here (as a server secret).
// Callers must be authenticated CRM admins; we re-check by reading their row
// from public.users and confirming role level <= 2 before doing anything.
//
// Supported ops (body.op):
//   create-user    : { op, email, password, full_name? }
//   update-password: { op, email, new_password }
//   reset-password : { op, email, new_password }  (alias of update-password)
//   delete-auth-user: { op, email }

// @ts-ignore
const SUPABASE_URL: string = Deno.env.get("SUPABASE_URL") || "";
// @ts-ignore
const SERVICE_ROLE: string = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
// @ts-ignore
const ANON_KEY: string = Deno.env.get("SUPABASE_ANON_KEY") || "";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
  });
}

// Build a curated client response from a GoTrue admin result. The raw provider
// `body` can carry internal error messages, validation detail, and identifiers;
// spreading it into the CORS:* response leaked implementation detail. Return
// only ok/action/status plus a sanitized error code, and log the full body
// server-side for diagnostics.
function sanitizeAuthResult(
  action: string,
  result: { ok: boolean; status: number; body?: any },
): Record<string, unknown> {
  if (!result.ok) {
    console.error(`admin-auth-ops ${action} failed:`, JSON.stringify(result.body ?? null));
  }
  const out: Record<string, unknown> = { ok: result.ok, action, status: result.status };
  if (!result.ok) {
    // Surface a short, non-sensitive error code (e.g. GoTrue's error_code /
    // error / msg field) without echoing the entire provider body.
    const b = result.body || {};
    const code = b.error_code || b.code || b.error || b.msg || b.message;
    out.error = code ? String(code).slice(0, 200) : "auth_admin_error";
  }
  return out;
}

// Verify the caller is an admin by using their JWT to look up their own row
// in public.users. Level 1 = Super Admin, 2 = Marketing Manager.
async function requireAdmin(req: Request): Promise<{ ok: true; userId: string } | { ok: false; reason: string; status: number }> {
  const authHeader = req.headers.get("Authorization") || "";
  const token = authHeader.replace(/^Bearer\s+/i, "");
  if (!token) return { ok: false, reason: "no_token", status: 401 };

  const whoRes = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: { "Authorization": `Bearer ${token}`, "apikey": ANON_KEY },
  });
  if (!whoRes.ok) return { ok: false, reason: "invalid_token", status: 401 };
  const who = await whoRes.json();
  const authUserId = who?.id;
  const authEmail = who?.email;
  if (!authUserId || !authEmail) return { ok: false, reason: "no_identity", status: 401 };

  // Look up the CRM users row by the immutable auth user id (service-role read,
  // RLS bypassed). Email is mutable/non-unique, so keying off auth_user_id (the
  // verified token identity) prevents the role check from matching the wrong row.
  const userRes = await fetch(
    `${SUPABASE_URL}/rest/v1/users?select=id,role,email&auth_user_id=eq.${encodeURIComponent(authUserId)}&limit=1`,
    { headers: { "apikey": SERVICE_ROLE, "Authorization": `Bearer ${SERVICE_ROLE}` } },
  );
  if (!userRes.ok) return { ok: false, reason: "user_lookup_failed", status: 500 };
  const rows = await userRes.json();
  const me = Array.isArray(rows) ? rows[0] : null;
  if (!me) return { ok: false, reason: "not_in_crm", status: 403 };

  // Derive the numeric role level the same way the front-end does
  // (see _getUserLevel in script.js) instead of substring-matching the role
  // string. Substring `includes()` granted full service-role auth powers to any
  // role merely CONTAINING 'super admin'/'marketing manager' (e.g. a future
  // 'Assistant Marketing Manager'). Gate strictly on level 1-2.
  const level = deriveRoleLevel(me.role);
  if (!(level >= 1 && level <= 2)) return { ok: false, reason: "not_admin", status: 403 };

  return { ok: true, userId: String(me.id) };
}

// Mirror of script.js _getUserLevel: parse "Level N" first, then fall back to
// an explicit exact-match map of named roles. Anything unrecognised => 99 (deny).
function deriveRoleLevel(roleRaw: unknown): number {
  if (!roleRaw) return 99;
  const role = String(roleRaw);
  const m = role.match(/Level\s+(\d+)\b/i);
  if (m) return parseInt(m[1], 10);
  const r = role.toLowerCase();
  if (r === "super_admin" || r === "admin") return 1;
  if (r === "marketing_manager") return 2;
  if (r === "manager") return 4;
  if (r === "team_leader") return 5;
  if (r === "consultant") return 7;
  if (r === "agent") return 10;
  if (r === "stock_take_staff" || r === "stock_take") return 15;
  if (r === "customer") return 13;
  if (r === "referrer") return 14;
  const raw = role.trim();
  if (raw === "传福大使") return 12;
  if (raw === "改命客户") return 13;
  if (raw === "准传福大使") return 14;
  return 99;
}

async function findAuthUserByEmail(email: string): Promise<{ id: string } | null> {
  const target = email.toLowerCase();
  const PER_PAGE = 1000;

  // The GoTrue admin list endpoint paginates; a single page only contains the
  // first `per_page` users. Capping at the first page silently returns false
  // 'not found' for any account beyond it (which made create/reset/delete
  // misbehave past 1000 auth users). Walk every page until the email is found
  // or the list is exhausted. A small safety cap prevents an unbounded loop if
  // the backend never reports an empty page.
  for (let page = 1; page <= 1000; page++) {
    const res = await fetch(
      `${SUPABASE_URL}/auth/v1/admin/users?page=${page}&per_page=${PER_PAGE}`,
      { headers: { "apikey": SERVICE_ROLE, "Authorization": `Bearer ${SERVICE_ROLE}` } },
    );
    if (!res.ok) return null;
    const data = await res.json();
    const list = Array.isArray(data?.users) ? data.users : [];
    const match = list.find((u: any) => String(u?.email || "").toLowerCase() === target);
    if (match?.id) return { id: String(match.id) };
    // Exhausted: a short (or empty) page means there are no further pages.
    if (list.length < PER_PAGE) break;
  }
  return null;
}

async function createAuthUser(email: string, password: string, fullName?: string) {
  const res = await fetch(`${SUPABASE_URL}/auth/v1/admin/users`, {
    method: "POST",
    headers: {
      "apikey": SERVICE_ROLE,
      "Authorization": `Bearer ${SERVICE_ROLE}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      email,
      password,
      email_confirm: true,
      user_metadata: fullName ? { full_name: fullName } : {},
    }),
  });
  const body = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, body };
}

async function updateAuthPassword(userId: string, newPassword: string) {
  const res = await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${userId}`, {
    method: "PUT",
    headers: {
      "apikey": SERVICE_ROLE,
      "Authorization": `Bearer ${SERVICE_ROLE}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ password: newPassword, email_confirm: true }),
  });
  const body = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, body };
}

async function deleteAuthUser(userId: string) {
  const res = await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${userId}`, {
    method: "DELETE",
    headers: { "apikey": SERVICE_ROLE, "Authorization": `Bearer ${SERVICE_ROLE}` },
  });
  return { ok: res.ok, status: res.status };
}

// @ts-ignore
Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS_HEADERS });
  if (req.method !== "POST") return json({ ok: false, error: "method_not_allowed" }, 405);

  const gate = await requireAdmin(req);
  if (!gate.ok) return json({ ok: false, error: gate.reason }, gate.status);

  let payload: any;
  try { payload = await req.json(); } catch { return json({ ok: false, error: "bad_json" }, 400); }

  const op = String(payload?.op || "");
  const email = String(payload?.email || "").trim();
  if (!email) return json({ ok: false, error: "email_required" }, 400);

  try {
    if (op === "create-user") {
      const password = String(payload?.password || "");
      if (password.length < 8) return json({ ok: false, error: "weak_password" }, 400);

      const existing = await findAuthUserByEmail(email);
      if (existing) {
        const upd = await updateAuthPassword(existing.id, password);
        return json(sanitizeAuthResult("updated_existing", upd), upd.ok ? 200 : 502);
      }
      const created = await createAuthUser(email, password, payload?.full_name);
      return json(sanitizeAuthResult("created", created), created.ok ? 200 : 502);
    }

    if (op === "update-password" || op === "reset-password") {
      const newPassword = String(payload?.new_password || payload?.password || "");
      if (newPassword.length < 8) return json({ ok: false, error: "weak_password" }, 400);

      const existing = await findAuthUserByEmail(email);
      if (!existing) {
        // Do NOT mint a new account on reset. A 'reset' silently becoming a
        // 'create' (on a typo'd email or a lookup miss) bypasses the create-user
        // path and any invite/verification step. Resetting a non-existent user
        // is a clean 404; account creation must go through op:'create-user'.
        return json({ ok: false, action: "not_found", error: "user_not_found" }, 404);
      }
      const upd = await updateAuthPassword(existing.id, newPassword);
      return json(sanitizeAuthResult("updated", upd), upd.ok ? 200 : 502);
    }

    if (op === "delete-auth-user") {
      const existing = await findAuthUserByEmail(email);
      if (!existing) return json({ ok: true, action: "not_found_already_gone" });
      const del = await deleteAuthUser(existing.id);
      return json({ ok: del.ok, action: "deleted", status: del.status }, del.ok ? 200 : 502);
    }

    return json({ ok: false, error: "unknown_op", op }, 400);
  } catch (e: any) {
    console.error("admin-auth-ops error:", e);
    return json({ ok: false, error: "internal", detail: String(e?.message ?? e) }, 500);
  }
});
