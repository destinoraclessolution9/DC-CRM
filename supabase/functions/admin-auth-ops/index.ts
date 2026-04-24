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

  // Look up the CRM users row by email (service-role read, RLS bypassed).
  const userRes = await fetch(
    `${SUPABASE_URL}/rest/v1/users?select=id,role,email&email=eq.${encodeURIComponent(authEmail)}&limit=1`,
    { headers: { "apikey": SERVICE_ROLE, "Authorization": `Bearer ${SERVICE_ROLE}` } },
  );
  if (!userRes.ok) return { ok: false, reason: "user_lookup_failed", status: 500 };
  const rows = await userRes.json();
  const me = Array.isArray(rows) ? rows[0] : null;
  if (!me) return { ok: false, reason: "not_in_crm", status: 403 };

  const role = String(me.role || "").toLowerCase();
  const isAdmin = role.includes("super admin") || role.includes("marketing manager") || role.includes("system admin");
  if (!isAdmin) return { ok: false, reason: "not_admin", status: 403 };

  return { ok: true, userId: String(me.id) };
}

async function findAuthUserByEmail(email: string): Promise<{ id: string } | null> {
  const res = await fetch(
    `${SUPABASE_URL}/auth/v1/admin/users?per_page=1000`,
    { headers: { "apikey": SERVICE_ROLE, "Authorization": `Bearer ${SERVICE_ROLE}` } },
  );
  if (!res.ok) return null;
  const data = await res.json();
  const list = Array.isArray(data?.users) ? data.users : [];
  const match = list.find((u: any) => String(u?.email || "").toLowerCase() === email.toLowerCase());
  return match?.id ? { id: String(match.id) } : null;
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
        return json({ ok: upd.ok, action: "updated_existing", status: upd.status, ...upd.body }, upd.ok ? 200 : 502);
      }
      const created = await createAuthUser(email, password, payload?.full_name);
      return json({ ok: created.ok, action: "created", status: created.status, ...created.body }, created.ok ? 200 : 502);
    }

    if (op === "update-password" || op === "reset-password") {
      const newPassword = String(payload?.new_password || payload?.password || "");
      if (newPassword.length < 8) return json({ ok: false, error: "weak_password" }, 400);

      const existing = await findAuthUserByEmail(email);
      if (!existing) {
        // Create account on the fly so admin-triggered resets also seed missing auth rows.
        const created = await createAuthUser(email, newPassword, payload?.full_name);
        return json({ ok: created.ok, action: "created_on_reset", status: created.status, ...created.body }, created.ok ? 200 : 502);
      }
      const upd = await updateAuthPassword(existing.id, newPassword);
      return json({ ok: upd.ok, action: "updated", status: upd.status, ...upd.body }, upd.ok ? 200 : 502);
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
