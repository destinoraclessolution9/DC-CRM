// ========== PUSH NOTIFICATIONS ==========
// PWA push notifications wired to Supabase Edge Function `send-activity-push`.
// Exposed on `window.PushNotif` so script.js can call it after creating activities.

(function () {
    'use strict';

    // Must match the VAPID public key stored as a Supabase Edge Function secret.
    const VAPID_PUBLIC_KEY = 'BOJY52iUJoLrpgodSLta-26085boS4RS4V05uHpp4MdODi-JKtPGqZReqA2WYfPbqUMxTKCs9uClUXyxZdgqEzI';

    const isPushSupported = () =>
        typeof window !== 'undefined' &&
        'Notification' in window &&
        'serviceWorker' in navigator &&
        'PushManager' in window;

    // Convert VAPID key (base64url) to Uint8Array for PushManager.subscribe.
    const urlBase64ToUint8Array = (base64String) => {
        const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
        const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
        const rawData = window.atob(base64);
        const outputArray = new Uint8Array(rawData.length);
        for (let i = 0; i < rawData.length; i++) outputArray[i] = rawData.charCodeAt(i);
        return outputArray;
    };

    // Get the Supabase client that's already created in index.html (service-role for now).
    const getSupabase = () => (window.supabase && window.supabase.from ? window.supabase : null);

    // Get the current user id (script.js stores it on window._currentUser via its auth flow).
    const getCurrentUserId = () => {
        try {
            if (window._currentUser && window._currentUser.id) return String(window._currentUser.id);
            if (window.app && window.app._currentUser && window.app._currentUser.id) return String(window.app._currentUser.id);
        } catch (_) {}
        return null;
    };

    const requestPermission = async () => {
        if (!isPushSupported()) return 'unsupported';
        try {
            const permission = await Notification.requestPermission();
            return permission; // "granted" | "denied" | "default"
        } catch (e) {
            console.warn('[Push] permission request failed:', e);
            return 'denied';
        }
    };

    // Subscribe this browser/device to push + save the subscription to Supabase.
    const subscribe = async () => {
        if (!isPushSupported()) throw new Error('push_unsupported');
        if (Notification.permission !== 'granted') {
            const p = await requestPermission();
            if (p !== 'granted') throw new Error('permission_denied');
        }

        const reg = window._swRegistration || (await navigator.serviceWorker.ready);
        if (!reg) throw new Error('no_service_worker');

        let sub = await reg.pushManager.getSubscription();
        if (!sub) {
            sub = await reg.pushManager.subscribe({
                userVisibleOnly: true,
                applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
            });
        }

        const userId = getCurrentUserId();
        if (!userId) throw new Error('no_user');

        // Serialize the subscription (endpoint + p256dh + auth).
        const json = sub.toJSON();
        const row = {
            user_id: userId,
            endpoint: sub.endpoint,
            p256dh: json.keys && json.keys.p256dh,
            auth: json.keys && json.keys.auth,
            user_agent: navigator.userAgent.slice(0, 255),
            enabled: true,
            last_seen_at: new Date().toISOString(),
        };

        const sb = getSupabase();
        if (!sb) throw new Error('no_supabase');

        // Upsert on endpoint (unique) so re-subscribe updates the user_id / keys.
        const { error } = await sb
            .from('push_subscriptions')
            .upsert(row, { onConflict: 'endpoint' });
        if (error) throw error;

        try { localStorage.setItem('push_enabled', '1'); } catch (_) {}
        console.log('[Push] subscribed:', sub.endpoint.slice(0, 60) + '...');
        return sub;
    };

    // Unsubscribe: remove from push service and mark row disabled (or delete).
    const unsubscribe = async () => {
        if (!isPushSupported()) return;
        const reg = window._swRegistration || (await navigator.serviceWorker.ready);
        const sub = reg && (await reg.pushManager.getSubscription());
        if (sub) {
            try {
                const sb = getSupabase();
                if (sb) {
                    await sb.from('push_subscriptions').delete().eq('endpoint', sub.endpoint);
                }
            } catch (e) { console.warn('[Push] delete row failed:', e); }
            try { await sub.unsubscribe(); } catch (e) { console.warn('[Push] unsubscribe failed:', e); }
        }
        try { localStorage.removeItem('push_enabled'); } catch (_) {}
    };

    // Call the Edge Function to fan out a notification about an activity.
    // targetUserIds: array of user IDs who should get the notification (RBAC-aware, computed by caller).
    const sendActivityPush = async (activity, targetUserIds, opts = {}) => {
        if (!Array.isArray(targetUserIds) || targetUserIds.length === 0) return { ok: true, sent: 0 };
        try {
            const sb = getSupabase();
            // Use the ANON or service-role JWT that's already embedded in index.html.
            // In production, should use the user's access token via supabase.auth.getSession()
            const authKey = (sb && sb.supabaseKey) || window.SUPABASE_SR || '';
            const res = await fetch(
                `${window.SUPABASE_URL}/functions/v1/send-activity-push`,
                {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${authKey}`,
                    },
                    body: JSON.stringify({
                        activity,
                        targetUserIds,
                        title: opts.title,
                        body: opts.body,
                        url: opts.url,
                    }),
                }
            );
            const data = await res.json().catch(() => ({}));
            if (!res.ok) {
                console.warn('[Push] send failed:', res.status, data);
                return { ok: false, error: data };
            }
            return data;
        } catch (e) {
            console.warn('[Push] send error:', e);
            return { ok: false, error: String(e && e.message || e) };
        }
    };

    // Show a local (foreground) notification without going through the push service.
    const showLocalNotification = (title, body, data = {}) => {
        if (!isPushSupported() || Notification.permission !== 'granted') return null;
        try {
            return new Notification(title, {
                body,
                icon: 'icons/icon-192x192.png',
                badge: 'icons/icon-72x72.png',
                data,
                tag: data.tag || 'crm-local',
            });
        } catch (e) { return null; }
    };

    // Get current subscription status for UI.
    const getStatus = async () => {
        if (!isPushSupported()) return { supported: false };
        const permission = Notification.permission;
        let subscribed = false;
        try {
            const reg = window._swRegistration || (await navigator.serviceWorker.ready);
            const sub = reg && (await reg.pushManager.getSubscription());
            subscribed = !!sub;
        } catch (_) {}
        return { supported: true, permission, subscribed };
    };

    window.PushNotif = {
        isPushSupported,
        requestPermission,
        subscribe,
        unsubscribe,
        sendActivityPush,
        showLocalNotification,
        getStatus,
    };
})();
