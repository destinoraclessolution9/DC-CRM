/**
 * Feng Shui CRM V8.7 - Auth Layer
 */
// auth.js
const Auth = (() => {
    const SESSION_KEY = 'fs_crm_session';

    const getCurrentUser = () => {
        try {
            const data = localStorage.getItem(SESSION_KEY);
            return data ? JSON.parse(data) : null;
        } catch (e) {
            return null;
        }
    };

    const setUser = (user) => {
        try {
            localStorage.setItem(SESSION_KEY, JSON.stringify(user));
        } catch (e) {
            console.warn('Auth: localStorage save blocked');
        }
    };

    const logout = () => {
        try {
            localStorage.removeItem(SESSION_KEY);
        } catch (e) {
            console.warn('Auth: localStorage remove blocked');
        }
    };

    const login = (userId) => {
        const user = DataStore.getById('users', userId);
        if (user) {
            setUser(user);
            return user;
        }
        return null;
    };

    return { getCurrentUser, setUser, logout, login };
})();

