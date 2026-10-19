// supabase/functions/resolve-map-link/index.ts
// Resolve a Google Maps share link (maps.app.goo.gl / goo.gl/maps) to the place
// it points at. Google issues a new short link on every share, so the CPS
// "Paste Info" box cannot match a fresh link against the links saved on a venue;
// this follows the redirect server-side and returns the place name / address /
// lat,lng so the client can match the venue by name or position.
//
// Caller: any signed-in CRM user (JWT checked against /auth/v1/user).
// Request:  POST JSON { "url": "https://maps.app.goo.gl/..." }
// Response: { ok, name, address, lat, lng, final_url }   (fields may be null)
//
// SSRF guard: every hop (the input and each Location header) must be https on a
// Google Maps host; redirects are followed manually, at most MAX_HOPS.

// @ts-ignore
const SUPABASE_URL: string = Deno.env.get("SUPABASE_URL") || "";
// @ts-ignore
const ANON_KEY: string = Deno.env.get("SUPABASE_ANON_KEY") || "";

const MAX_HOPS = 5;

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

// ── PURE HELPERS (sliced + eval'd by ci/test-paste-appointment.js — keep them
// plain JS, no type annotations) ─────────────────────────────────────────────
const isAllowedMapsUrl = (raw) => {
  let u;
  try { u = new URL(raw); } catch (_) { return false; }
  if (u.protocol !== "https:" || u.port || u.username || u.password) return false;
  const h = u.hostname.toLowerCase();
  if (h === "maps.app.goo.gl") return true;
  if (h === "goo.gl") return u.pathname.startsWith("/maps");
  if (h === "maps.google.com" || h === "www.google.com" || h === "google.com" ||
      /^(www\.)?google\.com\.(my|sg)$/.test(h)) return u.pathname.startsWith("/maps") || h === "maps.google.com";
  return false;
};
const parseMapsUrl = (raw) => {
  const out = { name: null, address: null, lat: null, lng: null };
  let u;
  try { u = new URL(raw); } catch (_) { return out; }
  const dec = (s) => { try { return decodeURIComponent(String(s).replace(/\+/g, " ")).trim(); } catch (_) { return String(s).trim(); } };
  const num = (a, b) => {
    const la = parseFloat(a), ln = parseFloat(b);
    return (isFinite(la) && isFinite(ln) && Math.abs(la) <= 90 && Math.abs(ln) <= 180) ? [la, ln] : null;
  };
  let place = "";
  const pm = u.pathname.match(/\/maps\/(?:place|search)\/([^/]+)/);
  if (pm) place = dec(pm[1]);
  if (!place) place = dec(u.searchParams.get("q") || u.searchParams.get("query") || "");
  // "1.23,103.4" as the place → that is a position, not a name.
  const asPos = place.match(/^(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)$/);
  if (asPos) { const p = num(asPos[1], asPos[2]); if (p) [out.lat, out.lng] = p; place = ""; }
  if (place) {
    const i = place.indexOf(",");
    out.name = (i === -1 ? place : place.slice(0, i)).trim() || null;
    out.address = i === -1 ? null : (place.slice(i + 1).trim() || null);
  }
  // Pin position (!3d<lat>!4d<lng>) beats the viewport centre (@lat,lng).
  const pin = u.href.match(/!3d(-?\d+(?:\.\d+)?)!4d(-?\d+(?:\.\d+)?)/);
  const at = u.pathname.match(/@(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/);
  const p = (pin && num(pin[1], pin[2])) || (out.lat == null && at && num(at[1], at[2])) || null;
  if (p) [out.lat, out.lng] = p;
  return out;
};
// ── END PURE HELPERS ─────────────────────────────────────────────────────────

async function requireAuth(req: Request): Promise<boolean> {
  const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  if (!token) return false;
  const r = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: { "Authorization": `Bearer ${token}`, "apikey": ANON_KEY },
  });
  if (!r.ok) return false;
  const who = await r.json().catch(() => null);
  return !!who?.id;
}

// Follow redirects one hop at a time; stop at the first URL that names a place
// (Google answers the short link with a 302 to /maps/place/...).
async function resolve(start: string): Promise<string | null> {
  let url = start;
  for (let hop = 0; hop <= MAX_HOPS; hop++) {
    if (!isAllowedMapsUrl(url)) return null;
    if (hop > 0) {
      const p = parseMapsUrl(url);
      if (p.name || p.lat != null) return url;
    }
    const r = await fetch(url, {
      redirect: "manual",
      headers: { "User-Agent": "Mozilla/5.0 (compatible; CRM-venue-resolver)" },
      signal: AbortSignal.timeout(6000),
    });
    try { await r.body?.cancel(); } catch (_) { /* ignore */ }
    const loc = r.headers.get("location");
    if (r.status < 300 || r.status >= 400 || !loc) return hop > 0 ? url : null;
    url = new URL(loc, url).href;
  }
  return null;
}

// @ts-ignore
Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS_HEADERS });
  if (req.method !== "POST") return json({ ok: false, error: "method_not_allowed" }, 405);
  if (!(await requireAuth(req))) return json({ ok: false, error: "unauthorized" }, 401);

  const body = await req.json().catch(() => null);
  const input = String(body?.url || "").trim().replace(/[)\].,;]+$/, "");
  if (!isAllowedMapsUrl(input)) return json({ ok: false, error: "not_a_google_maps_link" }, 400);

  try {
    const finalUrl = await resolve(input);
    if (!finalUrl) return json({ ok: false, error: "unresolved" }, 200);
    return json({ ok: true, ...parseMapsUrl(finalUrl), final_url: finalUrl });
  } catch (e) {
    return json({ ok: false, error: "fetch_failed", detail: String((e as Error)?.message || e) }, 200);
  }
});
