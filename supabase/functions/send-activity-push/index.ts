// supabase/functions/send-activity-push/index.ts
// Deno Edge Function — Deno-native Web Push sender (RFC 8291, aes128gcm).
// No npm or esm.sh dependencies for the crypto — uses Web Crypto only.
//
// Request body: { activity: {...}, targetUserIds: string[], title?: string, body?: string, url?: string }

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

async function pgDelete(table: string, params: Record<string, string>): Promise<void> {
  const qs = new URLSearchParams(params).toString();
  await fetch(`${SUPABASE_URL}/rest/v1/${table}?${qs}`, {
    method: "DELETE",
    headers: {
      "apikey": SERVICE_ROLE,
      "Authorization": `Bearer ${SERVICE_ROLE}`,
    },
  });
}

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

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

// ---------- HTTP handler ----------
serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: CORS_HEADERS });
  }
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "method_not_allowed" }), {
      status: 405,
      headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
    });
  }

  try {
    const { activity, targetUserIds, title, body, url } = await req.json();

    if (!Array.isArray(targetUserIds) || targetUserIds.length === 0) {
      return new Response(JSON.stringify({ ok: true, sent: 0, reason: "no_targets" }), {
        status: 200, headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
      });
    }
    if (!VAPID_PUBLIC || !VAPID_PRIVATE) {
      return new Response(JSON.stringify({ error: "vapid_not_configured" }), {
        status: 500, headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
      });
    }

    // Fetch enabled subscriptions via PostgREST
    const userIdList = `(${targetUserIds.map((u: string) => `"${u}"`).join(",")})`;
    let subs: any[];
    try {
      subs = await pgSelect("push_subscriptions", {
        select: "id,endpoint,p256dh,auth,user_id",
        user_id: `in.${userIdList}`,
        enabled: "eq.true",
      });
    } catch (e: any) {
      return new Response(JSON.stringify({ error: "sub_query_failed", detail: String(e?.message || e) }), {
        status: 500, headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
      });
    }
    if (!subs || subs.length === 0) {
      return new Response(JSON.stringify({ ok: true, sent: 0, reason: "no_subscriptions" }), {
        status: 200, headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
      });
    }

    const payload = JSON.stringify({
      title: title || "New Calendar Activity",
      body: body || (activity
        ? `${activity.type || "Activity"}: ${activity.title || activity.subject || ""}`
        : ""),
      tag: `activity_${activity?.id || Date.now()}`,
      icon: "icons/icon-192x192.png",
      badge: "icons/icon-72x72.png",
      data: {
        type: "activity_created",
        activityId: activity?.id,
        url: url || "./index.html#calendar",
      },
    });

    let sent = 0;
    const toDelete: string[] = [];
    const results = await Promise.all(subs.map((s: any) =>
      sendWebPush({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, payload),
    ));
    results.forEach((r, i) => {
      if (r.ok) sent++;
      else if (r.status === 404 || r.status === 410) toDelete.push(subs[i].id);
      else console.warn("push err", r.status, r.error);
    });

    if (toDelete.length > 0) {
      const idList = `(${toDelete.map((i) => `"${i}"`).join(",")})`;
      await pgDelete("push_subscriptions", { id: `in.${idList}` });
    }

    return new Response(JSON.stringify({ ok: true, sent, pruned: toDelete.length }), {
      status: 200, headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
    });
  } catch (e: any) {
    return new Response(JSON.stringify({ error: "internal", detail: String(e?.message || e) }), {
      status: 500, headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
    });
  }
});
