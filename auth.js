/**
 * Feng Shui CRM V8.7 - Auth Layer (Supabase)
 */
const Auth = (() => {
    const supabase = window.supabase;

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

    const logout = async () => {
        const { error } = await supabase.auth.signOut();
        if (error) throw error;
    };

    return { getCurrentUser, login, logout };
})();