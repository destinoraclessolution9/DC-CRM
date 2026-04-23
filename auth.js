/**
 * Feng Shui CRM V8.7 - Auth Layer (Supabase)
 */
const Auth = (() => {

    // Strong password policy: 12+ chars, or 8+ with upper + digit + special.
    // Rejects the 20 most-used breached passwords locally; full HIBP k-anonymity
    // check is optional (network) and runs only if callers pass { checkBreach: true }.
    const _topBreached = new Set([
        '123456','password','12345678','qwerty','123456789','12345','1234','111111',
        'abc123','password1','iloveyou','admin','welcome','letmein','monkey','dragon',
        'sunshine','princess','football','baseball'
    ]);

    const validatePasswordStrength = async (pw, opts = {}) => {
        const errors = [];
        const s = String(pw ?? '');
        if (s.length < 8) errors.push('Password must be at least 8 characters.');
        const hasUpper = /[A-Z]/.test(s);
        const hasDigit = /\d/.test(s);
        const hasSpecial = /[^A-Za-z0-9]/.test(s);
        if (s.length < 12 && !(hasUpper && hasDigit && hasSpecial)) {
            errors.push('Use 12+ chars, or include uppercase, a digit, and a special character.');
        }
        if (_topBreached.has(s.toLowerCase())) {
            errors.push('This password is in the most-commonly-breached list.');
        }
        if (opts.checkBreach && errors.length === 0) {
            try {
                const buf = await crypto.subtle.digest('SHA-1', new TextEncoder().encode(s));
                const hex = Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('').toUpperCase();
                const prefix = hex.slice(0, 5), suffix = hex.slice(5);
                const res = await fetch(`https://api.pwnedpasswords.com/range/${prefix}`, { cache: 'no-store' });
                if (res.ok) {
                    const body = await res.text();
                    if (body.split('\n').some(l => l.startsWith(suffix))) {
                        errors.push('This password has appeared in a known breach. Choose another.');
                    }
                }
            } catch (_) { /* network issue — skip silently */ }
        }
        return { ok: errors.length === 0, errors };
    };

    const getCurrentUser = async () => {
        try {
            const { data: { user }, error } = await supabase.auth.getUser();
            if (error) throw error;
            return user;
        } catch (e) {
            console.warn('Auth: getCurrentUser failed', e);
            return null;
        }
    };

    const login = async (email, password) => {
        const { data, error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
        return data.user;
    };

    // Log out of the current session. Use scope:'local' for the default logout
    // so other tabs/devices keep their sessions; logoutAll revokes everywhere.
    const logout = async () => {
        const { error } = await supabase.auth.signOut({ scope: 'local' });
        if (error) throw error;
    };

    // Revoke refresh tokens on ALL active sessions (use after password change
    // or when user clicks "Sign out everywhere"). scope:'global' invalidates
    // the refresh token across every device.
    const logoutAll = async () => {
        const { error } = await supabase.auth.signOut({ scope: 'global' });
        if (error) throw error;
    };

    // Rate-limited password reset: 1 request per email per hour (client-side
    // guard; the server should also enforce this via Supabase Auth settings).
    const _resetAttempts = new Map(); // email -> lastAttemptMs
    const requestPasswordReset = async (email) => {
        const now = Date.now();
        const last = _resetAttempts.get(email) || 0;
        if (now - last < 60 * 60 * 1000) {
            throw new Error('A reset link was already sent. Please wait an hour before trying again.');
        }
        _resetAttempts.set(email, now);
        const { error } = await supabase.auth.resetPasswordForEmail(email, {
            redirectTo: `${window.location.origin}/#reset-password`
        });
        if (error) throw error;
    };

    return { getCurrentUser, login, logout, logoutAll, requestPasswordReset, validatePasswordStrength };
})();