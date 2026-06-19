-- mfa_sms_codes — server-side state for the SMS 2FA factor. send-2fa-sms persists a
-- salted SHA-256 hash of each generated code (code_hash = sha256(code || ':' || salt))
-- with a TTL + single-use/attempts tracking, so the code is verifiable server-side
-- rather than trusting a client-held hash. Applied to prod 2026-06-20 (deep-audit
-- remediation, send-2fa-sms/index.ts). Idempotent; RLS on with NO anon/authenticated
-- policies → only the service role (the send/verify edge functions) may read/write.
CREATE TABLE IF NOT EXISTS public.mfa_sms_codes (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    auth_user_id UUID NOT NULL,
    phone        TEXT NOT NULL,
    code_hash    TEXT NOT NULL,   -- sha256(code || ':' || salt)
    salt         TEXT NOT NULL,
    expires_at   TIMESTAMPTZ NOT NULL,
    attempts     INT  NOT NULL DEFAULT 0,
    consumed     BOOLEAN NOT NULL DEFAULT false,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_mfa_sms_codes_lookup
    ON public.mfa_sms_codes (auth_user_id, phone, created_at);
ALTER TABLE public.mfa_sms_codes ENABLE ROW LEVEL SECURITY;

-- NOTE (follow-up): the SMS-2FA factor is only fully server-trusted once a companion
-- verify-2fa-sms edge function does the server-side compare (constant-time, expiry +
-- attempts cap + single-use). Until then two-factor.js verifies client-side against the
-- returned salted hash. See AUDIT_FOLLOWUPS_DB_SERVER.md §3.
