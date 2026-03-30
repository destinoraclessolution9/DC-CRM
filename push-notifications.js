// ========== PUSH NOTIFICATIONS ==========

// Check if push notifications are supported
const isPushSupported = () => {
    return 'Notification' in window && 'serviceWorker' in navigator && 'PushManager' in window;
};

// Request notification permission
const requestNotificationPermission = async () => {
    if (!isPushSupported()) {
        console.log('Push notifications not supported');
        return false;
    }

    try {
        const permission = await Notification.requestPermission();
        return permission === 'granted';
    } catch (error) {
        console.error('Error requesting notification permission:', error);
        return false;
    }
};

// Register for push notifications
const registerPushNotifications = async () => {
    if (!isPushSupported()) return null;

    try {
        const registration = await navigator.serviceWorker.ready;

        // Subscribe to push
        const subscription = await registration.pushManager.subscribe({
            userVisibleOnly: true,
            applicationServerKey: urlBase64ToUint8Array(process.env.VAPID_PUBLIC_KEY)
        });

        // Send subscription to server
        await fetch('/api/push/subscribe', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${Auth.getToken()}`
            },
            body: JSON.stringify(subscription)
        });

        console.log('Push notification registered');
        return subscription;
    } catch (error) {
        console.error('Error registering push notifications:', error);
        return null;
    }
};

// Convert VAPID key
const urlBase64ToUint8Array = (base64String) => {
    const padding = '='.repeat((4 - base64String.length % 4) % 4);
    const base64 = (base64String + padding)
        .replace(/\-/g, '+')
        .replace(/_/g, '/');

    const rawData = window.atob(base64);
    const outputArray = new Uint8Array(rawData.length);

    for (let i = 0; i < rawData.length; ++i) {
        outputArray[i] = rawData.charCodeAt(i);
    }
    return outputArray;
};

// Show local notification
const showLocalNotification = (title, options = {}) => {
    if (!isPushSupported() || Notification.permission !== 'granted') {
        return;
    }

    const {
        body = '',
        icon = '/icons/icon-192x192.png',
        badge = '/icons/icon-72x72.png',
        tag = 'default',
        data = {},
        actions = []
    } = options;

    const notification = new Notification(title, {
        body,
        icon,
        badge,
        tag,
        data,
        actions,
        vibrate: [200, 100, 200],
        requireInteraction: true
    });

    notification.onclick = (event) => {
        event.preventDefault();
        window.focus();

        if (data.url) {
            window.location.href = data.url;
        }

        notification.close();
    };

    return notification;
};

// Notification types
const NotificationTypes = {
    APPOINTMENT_REMINDER: 'appointment_reminder',
    TASK_DUE: 'task_due',
    NEW_MESSAGE: 'new_message',
    LEAD_UPDATE: 'lead_update',
    DEAL_WON: 'deal_won',
    TARGET_ACHIEVED: 'target_achieved'
};

// Send appointment reminder
const sendAppointmentReminder = (appointment) => {
    return showLocalNotification('Upcoming Appointment', {
        body: `You have an appointment with ${appointment.contact_name} in 15 minutes`,
        tag: `appointment_${appointment.id}`,
        data: {
            type: NotificationTypes.APPOINTMENT_REMINDER,
            url: `/calendar?event=${appointment.id}`
        },
        actions: [
            { action: 'view', title: 'View Details' },
            { action: 'dismiss', title: 'Dismiss' }
        ]
    });
};

// Send new message notification
const sendNewMessageNotification = (message) => {
    return showLocalNotification('New Message', {
        body: `${message.sender}: ${message.preview}`,
        tag: `message_${message.id}`,
        data: {
            type: NotificationTypes.NEW_MESSAGE,
            url: `/messages/${message.id}`
        },
        actions: [
            { action: 'reply', title: 'Reply' },
            { action: 'mark-read', title: 'Mark Read' }
        ]
    });
};

// Send lead update notification
const sendLeadUpdateNotification = (lead) => {
    return showLocalNotification('Lead Score Updated', {
        body: `${lead.name} score is now ${lead.score} - ready for follow-up`,
        tag: `lead_${lead.id}`,
        data: {
            type: NotificationTypes.LEAD_UPDATE,
            url: `/prospects/${lead.id}`
        },
        actions: [
            { action: 'view', title: 'View Lead' },
            { action: 'call', title: 'Call Now' }
        ]
    });
};

// Initialize notifications
const initNotifications = async () => {
    if (!isPushSupported()) {
        console.log('Push notifications not supported');
        return;
    }

    // Check existing permission
    if (Notification.permission === 'granted') {
        await registerPushNotifications();
    } else if (Notification.permission !== 'denied') {
        const granted = await requestNotificationPermission();
        if (granted) {
            await registerPushNotifications();
        }
    }

    // Listen for notification clicks
    navigator.serviceWorker.addEventListener('message', (event) => {
        if (event.data.type === 'NOTIFICATION_CLICK') {
            handleNotificationClick(event.data.data);
        }
    });
};

// Handle notification click
const handleNotificationClick = (data) => {
    switch (data.type) {
        case NotificationTypes.APPOINTMENT_REMINDER:
            navigateTo('calendar', { event: data.eventId });
            break;
        case NotificationTypes.NEW_MESSAGE:
            navigateTo('messages', { id: data.messageId });
            break;
        case NotificationTypes.LEAD_UPDATE:
            navigateTo('prospect', { id: data.leadId });
            break;
        default:
            navigateTo('dashboard');
    }
};
