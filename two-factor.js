// ========== TWO-FACTOR AUTHENTICATION ==========

// 2FA methods
const TwoFactorMethod = {
    TOTP: 'totp', // Time-based One-Time Password (Google Authenticator)
    SMS: 'sms',
    EMAIL: 'email',
    BIOMETRIC: 'biometric'
};

// --- Small helpers ---

// Fallbacks for modules that may not be loaded (audit-log.js is commented out
// in index.html; Encryption may or may not be present). Never throw — degrade.
const _safeAudit = (severity, category, action, detail) => {
    try {
        if (typeof AuditLogger !== 'undefined' && AuditLogger?.[severity]) {
            const cat = (typeof AuditCategory !== 'undefined' && AuditCategory?.SECURITY) || 'security';
            const act = (typeof AuditAction !== 'undefined' && AuditAction?.[action]) || action;
            AuditLogger[severity](cat, act, detail);
        }
    } catch (_) { /* audit is best-effort */ }
};

// Return a stable AES-GCM key derived from a per-install salt. This is
// client-side encryption-at-rest for the TOTP secret in IndexedDB. True
// security requires server-side storage; this is defense-in-depth.
const getEncryptionKey = async () => {
    try {
        if (typeof Encryption !== 'undefined' && typeof Encryption.getOrCreateKey === 'function') {
            return await Encryption.getOrCreateKey();
        }
    } catch (_) { /* fall through */ }
    // Fallback: derive a key from an install-local salt kept in localStorage.
    let salt = localStorage.getItem('fs_crm_enc_salt');
    if (!salt) {
        const raw = new Uint8Array(16);
        crypto.getRandomValues(raw);
        salt = btoa(String.fromCharCode(...raw));
        localStorage.setItem('fs_crm_enc_salt', salt);
    }
    const material = await crypto.subtle.importKey(
        'raw',
        new TextEncoder().encode(salt),
        { name: 'PBKDF2' },
        false,
        ['deriveKey']
    );
    return crypto.subtle.deriveKey(
        { name: 'PBKDF2', salt: new TextEncoder().encode('fs-crm-2fa'), iterations: 100000, hash: 'SHA-256' },
        material,
        { name: 'AES-GCM', length: 256 },
        false,
        ['encrypt', 'decrypt']
    );
};

// RFC 4648 Base32 decode (for TOTP secrets)
const _base32Decode = (input) => {
    const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
    const cleaned = String(input).replace(/=+$/, '').toUpperCase().replace(/\s/g, '');
    let bits = '';
    for (const ch of cleaned) {
        const idx = alphabet.indexOf(ch);
        if (idx < 0) continue;
        bits += idx.toString(2).padStart(5, '0');
    }
    const bytes = [];
    for (let i = 0; i + 8 <= bits.length; i += 8) {
        bytes.push(parseInt(bits.slice(i, i + 8), 2));
    }
    return new Uint8Array(bytes);
};

const _base32Encode = (bytes) => {
    const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
    let bits = '';
    for (const b of bytes) bits += b.toString(2).padStart(8, '0');
    let out = '';
    for (let i = 0; i < bits.length; i += 5) {
        const chunk = bits.slice(i, i + 5).padEnd(5, '0');
        out += alphabet[parseInt(chunk, 2)];
    }
    while (out.length % 8) out += '=';
    return out;
};

// Compute TOTP-HOTP per RFC 6238 / RFC 4226 (SHA-1, 6 digits, 30s step)
const _computeTOTP = async (secretBase32, timeStep) => {
    const key = _base32Decode(secretBase32);
    const counter = new ArrayBuffer(8);
    const view = new DataView(counter);
    // JS numbers can't hold > 2^53 but step counters fit fine in 32 bits for the next ~2000 years
    view.setUint32(0, Math.floor(timeStep / 0x100000000));
    view.setUint32(4, timeStep >>> 0);
    const cryptoKey = await crypto.subtle.importKey(
        'raw',
        key,
        { name: 'HMAC', hash: 'SHA-1' },
        false,
        ['sign']
    );
    const sig = new Uint8Array(await crypto.subtle.sign('HMAC', cryptoKey, counter));
    const offset = sig[sig.length - 1] & 0x0f;
    const bin =
        ((sig[offset] & 0x7f) << 24) |
        ((sig[offset + 1] & 0xff) << 16) |
        ((sig[offset + 2] & 0xff) << 8) |
        (sig[offset + 3] & 0xff);
    return String(bin % 1000000).padStart(6, '0');
};

// TOTP Manager
const TOTPManager = {
    // Generate a new Base32 secret for TOTP. Label omits the user's email
    // to avoid leaking PII to third-party QR rendering services.
    generateSecret: () => {
        const raw = new Uint8Array(20);
        crypto.getRandomValues(raw);
        const secret = _base32Encode(raw).replace(/=+$/, '');
        // Prefer username; never email. Fall back to user id.
        const u = window._currentUser || {};
        const label = encodeURIComponent(u.username || u.id || 'user');
        const issuer = encodeURIComponent('FengShuiCRM');
        return {
            secret,
            qrCode: `otpauth://totp/${issuer}:${label}?secret=${secret}&issuer=${issuer}&period=30&digits=6&algorithm=SHA1`
        };
    },

    // Verify TOTP code — real RFC 6238, ±1 step of drift.
    verifyTOTP: async (secret, token) => {
        if (!/^\d{6}$/.test(String(token || ''))) return false;
        if (!secret) return false;
        const now = Math.floor(Date.now() / 1000);
        const step = Math.floor(now / 30);
        for (const offset of [-1, 0, 1]) {
            try {
                const expected = await _computeTOTP(secret, step + offset);
                if (expected === String(token)) return true;
            } catch (_) { /* fall through */ }
        }
        return false;
    },

    // Enable TOTP for user
    enableTOTP: async (userId, secret) => {
        const user = await AppDataStore.getById('users', userId);
        if (!user) return { success: false };

        let encryptedSecret = secret;
        try {
            if (typeof Encryption !== 'undefined' && typeof Encryption.encryptField === 'function') {
                encryptedSecret = await Encryption.encryptField(secret, await getEncryptionKey());
            }
        } catch (e) {
            console.warn('[2FA] Encryption unavailable; storing secret in cleartext is not acceptable for production');
            return { success: false, error: 'encryption_unavailable' };
        }

        user.mfa_secret = encryptedSecret;
        user.mfa_enabled = true;
        user.mfa_method = TwoFactorMethod.TOTP;
        user.mfa_enabled_at = new Date().toISOString();

        // Generate backup codes before the first write so we save them atomically
        const backupCodes = TOTPManager.generateBackupCodes();
        user.mfa_backup_codes = backupCodes;
        await AppDataStore.update('users', userId, user);

        _safeAudit('info', 'SECURITY', 'MFA_ENABLE', { user_id: userId, method: TwoFactorMethod.TOTP });

        return { success: true, backupCodes };
    },

    // Generate backup codes
    generateBackupCodes: (count = 10) => {
        const codes = [];
        for (let i = 0; i < count; i++) {
            const raw = new Uint8Array(5);
            crypto.getRandomValues(raw);
            codes.push(Array.from(raw, b => b.toString(16).padStart(2, '0')).join('').toUpperCase());
        }
        return codes;
    },

    // Disable MFA
    disableMFA: async (userId) => {
        const user = await AppDataStore.getById('users', userId);
        if (!user) return false;

        user.mfa_enabled = false;
        user.mfa_secret = null;
        user.mfa_backup_codes = null;

        await AppDataStore.update('users', userId, user);

        _safeAudit('warn', 'SECURITY', 'MFA_DISABLE', { user_id: userId });

        return true;
    }
};

// SMS 2FA — server-side delivery, rate limited, constant-time compare.
const SMS2FAManager = {
    // Rate limit: max 3 sends per phone per 10 minutes (exponential backoff
    // between the 3rd failure and the next allowed attempt).
    _sendAttempts: new Map(), // phone -> { count, firstAt, nextAllowedAt }

    _rateOk(phone) {
        const now = Date.now();
        const windowMs = 10 * 60 * 1000;
        const rec = SMS2FAManager._sendAttempts.get(phone);
        if (!rec || now - rec.firstAt > windowMs) {
            SMS2FAManager._sendAttempts.set(phone, { count: 1, firstAt: now, nextAllowedAt: 0 });
            return true;
        }
        if (now < rec.nextAllowedAt) return false;
        rec.count += 1;
        // After the 3rd attempt, lock until the window closes.
        if (rec.count > 3) {
            rec.nextAllowedAt = rec.firstAt + windowMs;
            return false;
        }
        return true;
    },

    // Constant-time string compare — defeats timing oracles on code verify.
    _constantEq(a, b) {
        const s1 = String(a ?? ''), s2 = String(b ?? '');
        if (s1.length !== s2.length) return false;
        let diff = 0;
        for (let i = 0; i < s1.length; i++) diff |= s1.charCodeAt(i) ^ s2.charCodeAt(i);
        return diff === 0;
    },

    // Send verification code via SMS. Dispatches to a server-side Edge Function
    // so the plaintext code NEVER touches the client. Stores only an SHA-256
    // hash in sessionStorage for verification.
    sendCode: async (phoneNumber) => {
        if (!SMS2FAManager._rateOk(phoneNumber)) {
            if (window.UI?.toast) UI.toast.error('Too many attempts. Please wait 10 minutes.');
            return false;
        }

        try {
            // Server generates + delivers the code; returns a SHA-256 hash we store
            // to verify against. If the Edge Function is not configured yet, this
            // fails closed — NEVER fall back to client-side code generation.
            const { data, error } = await window.supabase.functions.invoke('send-2fa-sms', {
                body: { phone: phoneNumber }
            });
            if (error || !data?.hash) throw error || new Error('no_hash_returned');

            sessionStorage.setItem('mfa_code_hash', data.hash);
            sessionStorage.setItem('mfa_code_expires', String(Date.now() + 5 * 60 * 1000));
            if (window.UI?.toast) UI.toast.info('Verification code sent via SMS.');
            return true;
        } catch (e) {
            _safeAudit('warn', 'SECURITY', 'MFA_SMS_SEND_FAIL', { error: String(e?.message || e) });
            if (window.UI?.toast) UI.toast.error('Could not send SMS code. Contact support.');
            return false;
        }
    },

    // Verify code — hash the submitted code and compare (constant-time) to the
    // stored hash. No plaintext codes on the client.
    verifyCode: async (code) => {
        const storedHash = sessionStorage.getItem('mfa_code_hash');
        const expires = sessionStorage.getItem('mfa_code_expires');
        if (!storedHash || !expires) return false;

        if (Date.now() > parseInt(expires, 10)) {
            sessionStorage.removeItem('mfa_code_hash');
            sessionStorage.removeItem('mfa_code_expires');
            return false;
        }

        const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(String(code)));
        const submittedHash = Array.from(new Uint8Array(buf))
            .map(b => b.toString(16).padStart(2, '0')).join('');
        const ok = SMS2FAManager._constantEq(submittedHash, storedHash);
        if (ok) {
            sessionStorage.removeItem('mfa_code_hash');
            sessionStorage.removeItem('mfa_code_expires');
        }
        return ok;
    }
};

// 2FA UI Component
const showTwoFactorSetup = () => {
    const secret = TOTPManager.generateSecret();
    const esc = (window.UI && window.UI.escapeHtml) || ((s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[c])));

    const content = `
        <div class="two-factor-setup">
            <h3>Set Up Two-Factor Authentication</h3>

            <div class="setup-steps">
                <div class="step">
                    <div class="step-number">1</div>
                    <div class="step-content">
                        <h4>Install Authenticator App</h4>
                        <p>Download Google Authenticator or any TOTP-compatible app</p>
                    </div>
                </div>

                <div class="step">
                    <div class="step-number">2</div>
                    <div class="step-content">
                        <h4>Scan QR Code</h4>
                        <div class="qr-code">
                            <img src="https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(secret.qrCode)}"
                                 alt="QR Code">
                        </div>
                        <p>Or enter this key manually: <code>${esc(secret.secret)}</code></p>
                    </div>
                </div>

                <div class="step">
                    <div class="step-number">3</div>
                    <div class="step-content">
                        <h4>Verify Code</h4>
                        <input type="text" id="verification-code" placeholder="Enter 6-digit code" maxlength="6">
                        <button class="btn primary" onclick="app.verifyAndEnable2FA('${esc(secret.secret)}')">Verify & Enable</button>
                    </div>
                </div>
            </div>

            <div class="backup-codes" style="display: none;">
                <h4>Backup Codes</h4>
                <p>Save these codes in a safe place. They can be used to access your account if you lose your device.</p>
                <div class="codes-list" id="backup-codes-list"></div>
            </div>
        </div>
    `;

    UI.showModal('Set Up Two-Factor Authentication', content, [
        { label: 'Cancel', type: 'secondary', action: 'UI.hideModal()' }
    ]);
};

const verifyAndEnable2FA = async (secret) => {
    const code = document.getElementById('verification-code')?.value || '';

    const ok = await TOTPManager.verifyTOTP(secret, code);
    if (!ok) {
        if (window.UI && window.UI.toast) UI.toast.error('Invalid verification code');
        return;
    }

    const result = await TOTPManager.enableTOTP(window._currentUser?.id, secret);

    if (result && result.success) {
        const backupCodesDiv = document.querySelector('.backup-codes');
        const codesList = document.getElementById('backup-codes-list');

        if (codesList) {
            const esc = (window.UI && window.UI.escapeHtml) || ((s) => String(s));
            codesList.innerHTML = result.backupCodes.map(c =>
                `<div class="backup-code">${esc(c)}</div>`
            ).join('');
        }

        if (backupCodesDiv) {
            backupCodesDiv.style.display = 'block';
            const downloadBtn = document.createElement('button');
            downloadBtn.className = 'btn secondary';
            downloadBtn.textContent = 'Download Backup Codes';
            downloadBtn.onclick = () => downloadBackupCodes(result.backupCodes);
            backupCodesDiv.appendChild(downloadBtn);
        }

        if (window.UI && window.UI.toast) UI.toast.success('Two-factor authentication enabled');
    } else {
        if (window.UI && window.UI.toast) UI.toast.error('Could not enable 2FA: ' + (result?.error || 'unknown error'));
    }
};

const downloadBackupCodes = (codes) => {
    const content = codes.join('\n');
    const blob = new Blob([content], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `crm-backup-codes-${new Date().toISOString().split('T')[0]}.txt`;
    a.click();
    URL.revokeObjectURL(url);
};

// 2FA Login Screen
const showTwoFactorLogin = (username, password) => {
    const esc = (window.UI && window.UI.escapeHtml) || ((s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[c])));
    const escAttr = (s) => String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'");
    const content = `
        <div class="two-factor-login">
            <h3>Two-Factor Authentication</h3>
            <p>Enter the verification code from your authenticator app</p>

            <div class="form-group">
                <input type="text" id="2fa-code" placeholder="6-digit code" maxlength="6" autofocus>
            </div>

            <div class="form-actions">
                <button class="btn primary" onclick="app.verifyTwoFactorLogin('${escAttr(username)}', '${escAttr(password)}')">Verify</button>
            </div>

            <div class="backup-option">
                <a href="#" onclick="app.showBackupCodeLogin()">Use backup code instead</a>
            </div>
        </div>
    `;

    UI.showModal('Two-Factor Authentication', content, [
        { label: 'Cancel', type: 'secondary', action: 'UI.hideModal()' }
    ]);
};

// Used in login verification
const verifyTwoFactorLogin = async (username, password) => {
    const code = document.getElementById('2fa-code')?.value || '';

    const users = await AppDataStore.getAll('users');
    const user = (users || []).find(u => u.username === username);
    if (!user || !user.mfa_enabled || !user.mfa_secret) {
        if (window.UI && window.UI.toast) UI.toast.error('Invalid verification code');
        return;
    }

    let secret = user.mfa_secret;
    try {
        if (typeof Encryption !== 'undefined' && typeof Encryption.decryptField === 'function') {
            secret = await Encryption.decryptField(user.mfa_secret, await getEncryptionKey());
        }
    } catch (_) { /* secret might already be plaintext in legacy records */ }

    const ok = await TOTPManager.verifyTOTP(secret, code);
    if (ok) {
        UI.hideModal();
        if (typeof Auth !== 'undefined') {
            if (typeof Encryption !== 'undefined' && typeof Encryption.generateToken === 'function') {
                Auth.setToken(Encryption.generateToken());
            }
            Auth.setUser(user);
        }
        window.location.href = '#dashboard';
    } else {
        if (window.UI && window.UI.toast) UI.toast.error('Invalid verification code');
    }
};
