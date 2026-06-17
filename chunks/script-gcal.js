/**
 * CRM Lazy Chunk: Google Calendar & Integrations Hub
 *
 * Self-contained IIFE loaded on-demand when user navigates to 'integrations' view.
 * Handles the integration hub UI plus Google Calendar sync.
 *
 * Extracted 2026-06-05 from script.js (~779 lines).
 * External deps: window.AppDataStore, window.UI, window.app, window._appState.cu
 */
(() => {
    const _state = window._appState;
    const _utils = window._crmUtils || {};
    const esc = (...a) => (_utils.escapeHtml ? _utils.escapeHtml(...a) : String(a[0] ?? ''));
    const isSystemAdmin = (u) => (_utils.isSystemAdmin ? _utils.isSystemAdmin(u || _state.cu) : false);
    const navigateTo = (v) => window.app.navigateTo(v);
    // ========== GOOGLE CALENDAR INTEGRATION FUNCTIONS ==========

    class GoogleCalendarService {
        constructor() {
            this.baseUrl = 'https://www.googleapis.com/calendar/v3';
        }

        async getAccessToken() {
            return await refreshGoogleToken();
        }

        async createEvent(activity) {
            const token = await this.getAccessToken();
            if (!token) return null;

            const event = {
                summary: activity.activity_title || `${activity.activity_type} Meeting`,
                description: activity.discussion_summary || '',
                start: {
                    dateTime: `${activity.activity_date}T${activity.start_time}:00`,
                    timeZone: 'Asia/Kuala_Lumpur'
                },
                end: {
                    dateTime: `${activity.activity_date}T${activity.end_time}:00`,
                    timeZone: 'Asia/Kuala_Lumpur'
                },
                attendees: activity.co_agents ? activity.co_agents.map(a => ({ email: a.email })) : [],
                reminders: {
                    useDefault: true
                },
                extendedProperties: {
                    private: {
                        crm_activity_id: activity.id.toString(),
                        crm_type: activity.activity_type
                    }
                }
            };

            try {
                const response = await fetch(`${this.baseUrl}/calendars/primary/events`, {
                    method: 'POST',
                    headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
                    body: JSON.stringify(event)
                });
                if (!response.ok) throw new Error('Calendar API error: ' + response.status);
                const data = await response.json();
                return data.id;
            } catch (error) {
                console.error('Error creating Google Calendar event:', error);
                return null;
            }
        }

        async updateEvent(activity, googleEventId) {
            const token = await this.getAccessToken();
            if (!token) return false;

            try {
                const response = await fetch(`${this.baseUrl}/calendars/primary/events/${googleEventId}`, {
                    method: 'PUT',
                    headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        summary: activity.activity_title || `${activity.activity_type} Meeting`,
                        description: activity.discussion_summary || '',
                        start: { dateTime: `${activity.activity_date}T${activity.start_time}:00`, timeZone: 'Asia/Kuala_Lumpur' },
                        end: { dateTime: `${activity.activity_date}T${activity.end_time}:00`, timeZone: 'Asia/Kuala_Lumpur' }
                    })
                });
                return response.ok;
            } catch (error) {
                console.error('Error updating Google Calendar event:', error);
                return false;
            }
        }

        async deleteEvent(googleEventId) {
            const token = await this.getAccessToken();
            if (!token) return false;

            try {
                const response = await fetch(`${this.baseUrl}/calendars/primary/events/${googleEventId}`, {
                    method: 'DELETE',
                    headers: { 'Authorization': `Bearer ${token}` }
                });
                return response.ok || response.status === 204;
            } catch (error) {
                console.error('Error deleting Google Calendar event:', error);
                return false;
            }
        }

        async listEvents(timeMin, timeMax) {
            const token = await this.getAccessToken();
            if (!token) return [];

            try {
                const params = new URLSearchParams({
                    timeMin: timeMin.toISOString(), timeMax: timeMax.toISOString(),
                    singleEvents: 'true', orderBy: 'startTime'
                });
                const response = await fetch(`${this.baseUrl}/calendars/primary/events?${params}`, {
                    headers: { 'Authorization': `Bearer ${token}` }
                });
                if (!response.ok) throw new Error('Calendar API error: ' + response.status);
                const data = await response.json();
                return data.items || [];
            } catch (error) {
                console.error('Error listing Google Calendar events:', error);
                return [];
            }
        }
    }

    class SyncManager {
        constructor() {
            this.googleCalendar = new GoogleCalendarService();
            this.syncInProgress = false;
            this.lastSyncTime = null; // updated in-memory after each sync
        }

        async syncCRMtoGoogle() {
            if (this.syncInProgress) return;
            this.syncInProgress = true;

            try {
                const activities = await AppDataStore.getAll('activities');
                const syncLog = await this.getSyncLog();

                let synced = 0, created = 0, updated = 0, deleted = 0;

                for (const activity of activities) {
                    const syncRecord = syncLog.find(s => s.activity_id === activity.id);

                    if (this.needsSync(activity, syncRecord)) {
                        if (activity.status === 'cancelled' && syncRecord?.google_event_id) {
                            await this.googleCalendar.deleteEvent(syncRecord.google_event_id);
                            this.removeSyncRecord(activity.id);
                            deleted++;
                        } else if (syncRecord?.google_event_id) {
                            await this.googleCalendar.updateEvent(activity, syncRecord.google_event_id);
                            await this.updateSyncRecord(activity.id, syncRecord.google_event_id);
                            updated++;
                        } else {
                            const googleEventId = await this.googleCalendar.createEvent(activity);
                            if (googleEventId) {
                                await this.addSyncRecord(activity.id, googleEventId);
                                created++;
                            }
                        }
                        synced++;
                    }
                }

                this.lastSyncTime = new Date().toISOString();
                // Persist last sync time to Supabase via integration_connections.last_sync_at
                try {
                    const _syncConn = await getGoogleConnection();
                    if (_syncConn) {
                        AppDataStore.update('integration_connections', _syncConn.id, { last_sync_at: this.lastSyncTime }).catch(() => {});
                    }
                } catch (_) {}

                if (created || updated || deleted) {
                    // Only show toast if something actually synced to avoid spam
                    UI.toast.success(`Google Calendar sync complete: ${created} created`);
                }
            } catch (error) {
                console.error('Sync error:', error);
            } finally {
                this.syncInProgress = false;
            }
        }

        async syncGoogleToCRM() {
            if (this.syncInProgress) return;
            this.syncInProgress = true;
            try {
                const timeMin = new Date(Date.now() - 30 * 86400000);
                const timeMax = new Date(Date.now() + 30 * 86400000);
                const googleEvents = await this.googleCalendar.listEvents(timeMin, timeMax);
                if (!googleEvents.length) { this.syncInProgress = false; return; }

                const syncLog = await this.getSyncLog();
                let imported = 0;
                for (const gEvent of googleEvents) {
                    // Skip events that originated from CRM
                    if (gEvent.extendedProperties?.private?.crm_activity_id) continue;
                    // Skip already-synced events
                    if (syncLog.find(s => s.google_event_id === gEvent.id)) continue;

                    const startDate = gEvent.start?.date || gEvent.start?.dateTime?.split('T')[0];
                    const startTime = gEvent.start?.dateTime?.split('T')[1]?.substring(0, 5) || '09:00';
                    const endTime = gEvent.end?.dateTime?.split('T')[1]?.substring(0, 5) || '10:00';

                    const activity = await AppDataStore.create('activities', {
                        activity_title: gEvent.summary || 'Google Calendar Event',
                        activity_type: 'Call',
                        activity_date: startDate,
                        start_time: startTime,
                        end_time: endTime,
                        status: 'completed',
                        discussion_summary: gEvent.description || '',
                        lead_agent_id: _state.cu?.id || 1,
                        source: 'google_calendar',
                        google_event_id: gEvent.id,
                        created_at: new Date().toISOString()
                    });

                    // Record import in sync_history (was localStorage-only before)
                    await this.addSyncRecord(activity?.id, gEvent.id, 'google_to_crm');
                    imported++;
                }
                if (imported > 0) UI.toast.success(`Imported ${imported} events from Google Calendar`);
            } catch (error) {
                console.error('Import error:', error);
            } finally {
                this.syncInProgress = false;
            }
        }

        needsSync(activity, syncRecord) {
            if (!syncRecord) return true;
            const activityUpdated = new Date(activity.updated_at || activity.created_at);
            const syncUpdated = new Date(syncRecord.last_synced_at);
            return activityUpdated > syncUpdated;
        }

        async getSyncLog() {
            try {
                const records = await AppDataStore.getAll('sync_history');
                return (records || []).map(r => ({
                    activity_id: r.activity_id,
                    google_event_id: r.google_event_id,
                    last_synced_at: r.synced_at || r.last_synced_at
                }));
            } catch (_) { return []; }
        }

        async addSyncRecord(activityId, googleEventId, direction = 'crm_to_google') {
            try {
                const connection = await getGoogleConnection();
                if (connection && _state.cu) {
                    await AppDataStore.create('sync_history', {
                        integration_id: connection.integration_id,
                        user_id: _state.cu.id,
                        activity_id: activityId,
                        google_event_id: googleEventId,
                        direction,
                        status: 'success',
                        error_message: '',
                        synced_at: new Date().toISOString()
                    });
                }
            } catch (_) {}
        }

        async updateSyncRecord(activityId, googleEventId) {
            // sync_history rows are append-only; the latest row wins for the same activity_id.
            await this.addSyncRecord(activityId, googleEventId, 'crm_to_google');
        }

        async removeSyncRecord(activityId) {
            try {
                const records = await AppDataStore.query('sync_history', { activity_id: activityId });
                for (const r of records || []) {
                    await AppDataStore.delete('sync_history', r.id);
                }
            } catch (_) {}
        }

        resolveConflict(choice, activityId, eventId) {
            UI.hideModal();
            UI.toast.success(`Conflict resolved. Chose: ${choice}`);
        }
    }

    // Refresh Google Token - mock implementation for demo
    const refreshGoogleToken = async () => {
        const connection = await getGoogleConnection();
        if (connection && connection.access_token) {
            return connection.access_token;
        }
        return null;
    };

    let _googleCalendarService = null;
    let _syncManager = null;

    const initGoogleIntegration = () => {
        _googleCalendarService = new GoogleCalendarService();
        _syncManager = new SyncManager();
    };

    const buildIntegrationHubHtml = (googleCard, webhookCard, whatsappCard, outlookCard, githubCard, googledriveCard) => {
        return `
            <div class="integration-hub">
                <div class="integration-header">
                    <div>
                        <h1>Integration Hub</h1>
                        <p>Connect your CRM with external services</p>
                    </div>
                    <button class="btn secondary" onclick="app.navigateTo('settings')">
                        <i class="fas fa-arrow-left"></i> Back to Settings
                    </button>
                </div>

                <div class="integration-grid">
                    ${googleCard}
                    ${webhookCard}
                    ${whatsappCard}
                    ${outlookCard}
                    ${githubCard}
                    ${googledriveCard}
                </div>
            </div>
        `;
    };

    const showIntegrationHub = async (container) => {
        try {
            const googleCard = await renderIntegrationCard('google', 'Google Calendar', 'Two-way sync', 'calendar', await getConnectionStatus('google'));
            const webhookCard = await renderIntegrationCard('webhook', 'Webhook Notifications', 'Slack / Discord / generic', 'messaging', await getConnectionStatus('webhook'));
            const whatsappCard = await renderIntegrationCard('whatsapp', 'WhatsApp Business', 'Outbound only', 'messaging', await getConnectionStatus('whatsapp'));
            const outlookCard = await renderIntegrationCard('outlook', 'Outlook Calendar', 'Two-way sync', 'calendar', 'oauth_backend');
            const githubCard = await renderIntegrationCard('github', 'GitHub', 'Issues & activity', 'devtools', 'oauth_backend');
            const googledriveCard = await renderIntegrationCard('googledrive', 'Google Drive', 'Two-way sync', 'storage', 'oauth_backend');
            container.innerHTML = buildIntegrationHubHtml(googleCard, webhookCard, whatsappCard, outlookCard, githubCard, googledriveCard);
        } catch (e) {
            console.error('Integration Hub error:', e);
            container.innerHTML = '<div class="error-state" style="padding:40px;text-align:center;"><i class="fas fa-exclamation-circle" style="font-size:2rem;color:#ef4444;"></i><p style="margin-top:12px;">Failed to load integrations. Please try again later.</p></div>';
        }
    };

    const renderIntegrationCard = async (id, name, description, type, status) => {
        const statusColors = {
            connected: 'status-connected',
            disconnected: 'status-disconnected',
            expired: 'status-expired',
            oauth_backend: 'status-expired'
        };

        const statusIcons = {
            calendar: 'fas fa-calendar-alt',
            messaging: 'fas fa-comment',
            accounting: 'fas fa-chart-line',
            storage: 'fas fa-database',
            devtools: 'fab fa-github'
        };

        // Honest state for OAuth-only services that this static SPA cannot
        // actually connect (no server-side OAuth backend / secrets here).
        const isOAuthBackend = status === 'oauth_backend';
        const statusLabel = isOAuthBackend
            ? '🔒 Requires admin OAuth setup'
            : status === 'connected' ? '🟢 Connected'
            : status === 'expired' ? '🟡 Expired'
            : '🔴 Not configured';

        const safeId = esc(id);
        return `
            <div class="integration-card" onclick="app.showIntegrationDetails('${safeId}')">
                <div class="integration-icon ${esc(type)}">
                    <i class="${statusIcons[type] || 'fas fa-plug'}"></i>
                </div>
                <div class="integration-info">
                    <h3>${esc(name)}</h3>
                    <p>${esc(description)}</p>
                    <div class="integration-status ${statusColors[status] || statusColors.disconnected}">
                        ${statusLabel}
                    </div>
                </div>
                <div class="integration-action">
                    <button class="btn ${status === 'connected' ? 'secondary' : 'primary'}" onclick="event.stopPropagation(); app.showIntegrationDetails('${safeId}')">
                        ${isOAuthBackend ? 'Details' : status === 'connected' ? 'Configure' : 'Connect'}
                    </button>
                </div>
            </div>
        `;
    };

    const getConnectionStatus = async (integrationId) => {
        const id = await getIntegrationId(integrationId);
        if (!id) return 'disconnected';
        const connections = await AppDataStore.query('integration_connections', {
            integration_id: id,
            user_id: _state.cu?.id || 1
        });

        if (connections.length === 0) return 'disconnected';

        const conn = connections[0];
        if (conn.token_expires_at && new Date(conn.token_expires_at) < new Date()) {
            return 'expired';
        }

        return conn.status;
    };

    const getIntegrationId = async (provider) => {
        const integrations = await AppDataStore.getAll('integrations');
        const integration = integrations.find(i => i.provider === provider);
        return integration ? integration.id : null;
    };

    // Services that genuinely require a server-side OAuth backend + client
    // secrets the user must register. This static SPA cannot perform that
    // flow client-side, so we show an HONEST explanation rather than a fake
    // "Connect" button that pretends to work.
    const OAUTH_BACKEND_SERVICES = {
        outlook: {
            name: 'Outlook Calendar',
            why: 'Microsoft Graph calendar sync needs an Azure app registration (client ID + secret) and a server-side OAuth callback. Those secrets cannot live in the browser, so this can only be enabled once an admin sets up the backend.'
        },
        github: {
            name: 'GitHub',
            why: 'GitHub OAuth needs a registered OAuth App (client ID + secret) and a server-side token exchange. The browser cannot hold those credentials, so this requires backend setup before it can connect.'
        },
        googledrive: {
            name: 'Google Drive',
            why: 'Drive file sync needs Google OAuth scopes granted through a server-side consent + token-exchange flow with stored client secrets — not possible from this static front end alone.'
        }
    };

    const showIntegrationDetails = async (provider) => {
        if (provider === 'google') {
            await showGoogleCalendarIntegration();
        } else if (provider === 'webhook') {
            await showWebhookIntegration();
        } else if (provider === 'whatsapp') {
            if (window.app.showWhatsAppIntegration) {
                await window.app.showWhatsAppIntegration();
            } else {
                UI.toast.info('WhatsApp integration coming soon');
            }
        } else if (OAUTH_BACKEND_SERVICES[provider]) {
            showOAuthBackendNotice(provider);
        } else {
            UI.toast.info(`${provider} integration coming soon`);
        }
    };

    const showOAuthBackendNotice = (provider) => {
        const svc = OAUTH_BACKEND_SERVICES[provider];
        if (!svc) return;
        UI.showModal(`${esc(svc.name)} — Requires backend setup`, `
            <div style="display:flex;gap:14px;align-items:flex-start;">
                <i class="fas fa-shield-halved" style="font-size:28px;color:var(--gray-400);margin-top:2px;"></i>
                <div>
                    <p style="margin-top:0;font-weight:600;">This integration is not available client-side.</p>
                    <p style="color:var(--gray-600);line-height:1.55;">${esc(svc.why)}</p>
                    <p style="color:var(--gray-600);line-height:1.55;margin-bottom:0;">
                        Need outbound notifications today? Use
                        <a href="#" onclick="event.preventDefault(); UI.hideModal(); app.showWebhookIntegration();" style="color:var(--primary);font-weight:600;">Webhook Notifications</a>
                        to push CRM events to Slack, Discord, or any incoming-webhook endpoint — no backend required.
                    </p>
                </div>
            </div>
        `, [
            { label: 'Close', type: 'secondary', action: 'UI.hideModal()' }
        ]);
    };

    const showGoogleCalendarIntegration = async () => {
        const connection = await getGoogleConnection();
        const isConnected = connection && connection.status === 'connected';

        const vp = document.getElementById('content-viewport');
        if (!vp) return;
        const viewport = vp;
        viewport.innerHTML = `
            <div class="integration-detail">
                <div class="detail-header">
                    <button class="btn secondary" onclick="app.showIntegrationHub(document.getElementById('content-viewport'))">
                        <i class="fas fa-arrow-left"></i> Back to Integrations
                    </button>
                    <h1>Google Calendar Integration</h1>
                </div>
                
                <div class="connection-status ${isConnected ? 'connected' : 'disconnected'}">
                    <div class="status-indicator ${isConnected ? 'connected' : 'disconnected'}"></div>
                    <div class="status-text">
                        <h3>${isConnected ? 'Connected' : 'Disconnected'}</h3>
                        ${isConnected ? `
                            <p>Connected as: ${esc(connection.user_email || 'user@gmail.com')}</p>
                            <p>Last Sync: ${connection.last_sync ? new Date(connection.last_sync).toLocaleString() : 'Never'}</p>
                        ` : `
                            <p>Connect your Google Calendar to sync activities both ways.</p>
                        `}
                    </div>
                    ${!isConnected ? `
                        <button class="btn primary btn-large" onclick="app.initiateGoogleOAuth()">
                            <i class="fas fa-google"></i> Connect with Google
                        </button>
                    ` : ''}
                </div>
                
                ${isConnected ? `
                    <div class="sync-settings">
                        <h3>Sync Settings</h3>
                        
                        <div class="settings-section">
                            <h4>Sync Direction</h4>
                            <label class="radio-label">
                                <input type="radio" name="sync-direction" value="two-way" ${connection.sync_settings?.direction === 'two-way' || !connection.sync_settings ? 'checked' : ''}> Two-way sync (CRM ↔ Google)
                            </label>
                            <label class="radio-label">
                                <input type="radio" name="sync-direction" value="crm-to-google" ${connection.sync_settings?.direction === 'crm-to-google' ? 'checked' : ''}> CRM to Google only
                            </label>
                            <label class="radio-label">
                                <input type="radio" name="sync-direction" value="google-to-crm" ${connection.sync_settings?.direction === 'google-to-crm' ? 'checked' : ''}> Google to CRM only
                            </label>
                        </div>
                        
                        <div class="settings-section">
                            <h4>Sync Calendar</h4>
                            <select class="form-control" id="sync-calendar">
                                <option value="primary">Primary CRM Calendar</option>
                                <option value="work">Work Calendar</option>
                                <option value="personal">Personal Calendar</option>
                            </select>
                        </div>
                        
                        <div class="settings-section">
                            <h4>Sync Options</h4>
                            <label class="checkbox-label">
                                <input type="checkbox" id="sync-cps" ${connection.sync_settings?.syncTypes?.cps ?? true ? 'checked' : ''}> Sync CPS activities
                            </label>
                            <label class="checkbox-label">
                                <input type="checkbox" id="sync-ftf" ${connection.sync_settings?.syncTypes?.ftf ?? true ? 'checked' : ''}> Sync FTF meetings
                            </label>
                            <label class="checkbox-label">
                                <input type="checkbox" id="sync-fsa" ${connection.sync_settings?.syncTypes?.fsa ?? true ? 'checked' : ''}> Sync FSA appointments
                            </label>
                            <label class="checkbox-label">
                                <input type="checkbox" id="sync-event" ${connection.sync_settings?.syncTypes?.event ?? true ? 'checked' : ''}> Sync Events
                            </label>
                            <label class="checkbox-label">
                                <input type="checkbox" id="sync-call" ${connection.sync_settings?.syncTypes?.call ?? false ? 'checked' : ''}> Sync Calls (as reminders)
                            </label>
                        </div>
                        
                        <div class="settings-section">
                            <h4>Default Reminder</h4>
                            <select class="form-control" id="default-reminder">
                                <option value="0">No reminder</option>
                                <option value="5">5 minutes before</option>
                                <option value="10">10 minutes before</option>
                                <option value="15" selected>15 minutes before</option>
                                <option value="30">30 minutes before</option>
                                <option value="60">1 hour before</option>
                                <option value="1440">1 day before</option>
                            </select>
                        </div>
                        
                        <div class="settings-actions">
                            <button class="btn primary" onclick="app.saveGoogleSettings()">Save Settings</button>
                            <button class="btn secondary" onclick="app.syncGoogleCalendar()">Sync Now</button>
                            <button class="btn secondary" onclick="app.viewSyncHistory()">View Sync History</button>
                            <button class="btn error" onclick="app.disconnectGoogle()">Disconnect</button>
                        </div>
                    </div>
                ` : ''}
            </div>
        `;
    };

    const getGoogleConnection = async () => {
        const integrationId = await getIntegrationId('google');
        if (!integrationId) return null;

        const connections = await AppDataStore.query('integration_connections', {
            integration_id: integrationId,
            user_id: _state.cu?.id || 1
        });

        return connections.length > 0 ? connections[0] : null;
    };

    const initiateGoogleOAuth = async () => {
        UI.showModal('Connect Google Calendar', `
            <div class="oauth-simulator">
                <p>This would open Google's OAuth consent screen.</p>
                <p>For demo purposes, click "Simulate Connection" to pretend it worked.</p>
                
                <div class="oauth-mock">
                    <div class="mock-account" style="display:flex;align-items:center;gap:16px;padding:16px;background:var(--gray-50);border-radius:8px;margin-bottom:16px;">
                        <i class="fas fa-user-circle" style="font-size:48px;color:#4285f4;"></i>
                        <div>
                            <strong>user@gmail.com</strong>
                            <p style="margin:0;font-size:13px;color:var(--gray-500)">Signed in to Google</p>
                        </div>
                    </div>
                    
                    <div class="mock-permissions" style="background:var(--gray-50);padding:16px;border-radius:8px;">
                        <h5 style="margin-top:0;">Google Calendar would like to:</h5>
                        <ul style="list-style:none;padding:0;">
                            <li style="padding:4px 0;"><i class="fas fa-check-circle" style="color:var(--success);"></i> See, edit, share, and permanently delete all calendars</li>
                            <li style="padding:4px 0;"><i class="fas fa-check-circle" style="color:var(--success);"></i> See and download any calendar</li>
                        </ul>
                    </div>
                </div>
            </div>
        `, [
            { label: 'Cancel', type: 'secondary', action: 'UI.hideModal()' },
            { label: 'Simulate Connection', type: 'primary', action: '(async () => { await app.simulateGoogleConnection(); })()' }
        ]);
    };

    const simulateGoogleConnection = async () => {
        UI.hideModal();
        let integration = (await AppDataStore.getAll('integrations')).find(i => i.provider === 'google');
        if (!integration) {
            integration = await AppDataStore.create('integrations', {
                integration_name: 'Google Calendar',
                provider: 'google',
                type: 'calendar',
                is_active: true,
                config_schema: {},
                created_at: new Date().toISOString()
            });
        }

        const oldConn = await getGoogleConnection();
        if (oldConn) {
            await AppDataStore.update('integration_connections', oldConn.id, {
                status: 'connected',
                token_expires_at: new Date(Date.now() + 3600 * 1000).toISOString(),
                updated_at: new Date().toISOString()
            });
        } else {
            await AppDataStore.create('integration_connections', {
                integration_id: integration.id,
                user_id: _state.cu?.id || 1,
                access_token: 'encrypted_mock_token',
                refresh_token: 'encrypted_mock_refresh',
                token_expires_at: new Date(Date.now() + 3600 * 1000).toISOString(),
                scope: 'calendar',
                status: 'connected',
                last_sync: null,
                sync_settings: {
                    direction: 'two-way',
                    calendars: ['primary'],
                    syncTypes: { cps: true, ftf: true, fsa: true, event: true, call: false }
                },
                created_at: new Date().toISOString()
            });
        }

        UI.toast.success('Google Calendar connected successfully');
        await showGoogleCalendarIntegration();
    };

    const saveGoogleSettings = async () => {
        const connection = await getGoogleConnection();
        if (!connection) return;

        const settings = {
            direction: document.querySelector('input[name="sync-direction"]:checked')?.value || 'two-way',
            calendar: document.getElementById('sync-calendar')?.value || 'primary',
            syncTypes: {
                cps: document.getElementById('sync-cps')?.checked || false,
                ftf: document.getElementById('sync-ftf')?.checked || false,
                fsa: document.getElementById('sync-fsa')?.checked || false,
                event: document.getElementById('sync-event')?.checked || false,
                call: document.getElementById('sync-call')?.checked || false
            },
            reminder: document.getElementById('default-reminder')?.value || '15'
        };

        await AppDataStore.update('integration_connections', connection.id, {
            sync_settings: settings,
            updated_at: new Date().toISOString()
        });

        UI.toast.success('Google Calendar settings saved');
    };

    const syncGoogleCalendar = async () => {
        if (!_syncManager) {
            _syncManager = new SyncManager();
        }

        UI.toast.info('Starting Google Calendar sync...');

        await _syncManager.syncCRMtoGoogle();
        await _syncManager.syncGoogleToCRM();

        const connection = await getGoogleConnection();
        if (connection) {
            await AppDataStore.update('integration_connections', connection.id, {
                last_sync: new Date().toISOString()
            });
        }
        await showGoogleCalendarIntegration();
    };

    const viewSyncHistory = async () => {
        const syncHistory = (await AppDataStore.getAll('sync_history')).filter(
            h => h.user_id === (_state.cu?.id || 1)
        ).sort((a, b) => new Date(b.synced_at) - new Date(a.synced_at));

        let tableHtml = `
            <div class="sync-history">
                <div class="history-filters" style="display:flex;gap:12px;margin-bottom:16px;">
                    <select class="form-control" style="width: 150px;" id="history-date-range">
                        <option value="7">Last 7 days</option>
                        <option value="30">Last 30 days</option>
                        <option value="90">Last 90 days</option>
                    </select>
                    <button class="btn secondary" onclick="app.refreshSyncHistory()">Apply</button>
                </div>
                
                <table class="history-table" style="width:100%;border-collapse:collapse;margin-bottom:16px;">
                    <thead>
                        <tr style="background:var(--gray-50);border-bottom:2px solid var(--gray-200);text-align:left;">
                            <th scope="col" style="padding:12px;">#</th>
                            <th scope="col" style="padding:12px;">Activity</th>
                            <th scope="col" style="padding:12px;">Direction</th>
                            <th scope="col" style="padding:12px;">Status</th>
                            <th scope="col" style="padding:12px;">Time</th>
                        </tr>
                    </thead>
                    <tbody>
        `;

        if (syncHistory.length === 0) {
            tableHtml += `
                <tr>
                    <td colspan="5" style="text-align: center; padding: 40px;">
                        <i class="fas fa-history" style="font-size: 48px; color: var(--gray-300);"></i>
                        <h3>No sync history yet</h3>
                        <p>Sync with Google Calendar to see history here</p>
                    </td>
                </tr>
            `;
        } else {
            for (const [index, item] of syncHistory.slice(0, 10).entries()) {
                const activity = await AppDataStore.getById('activities', item.activity_id);
                const directionIcon = item.direction === 'crm_to_google' ? '→' : '←';
                const statusIcon = item.status === 'success' ? '✓' : item.status === 'conflict' ? '⚠' : '✗';
                const statusColor = item.status === 'success' ? '#10b981' : item.status === 'conflict' ? '#f59e0b' : '#ef4444';

                tableHtml += `
                    <tr style="border-bottom:1px solid var(--gray-100);">
                        <td style="padding:12px;">${index + 1}</td>
                        <td style="padding:12px;">${activity ? esc(activity.activity_title) : 'Unknown activity'}</td>
                        <td style="padding:12px;">CRM ${directionIcon} Google</td>
                        <td style="padding:12px;"><span style="color:${statusColor};font-weight:600;">${statusIcon} ${item.status}</span></td>
                        <td style="padding:12px;">${new Date(item.synced_at).toLocaleTimeString()}</td>
                    </tr>
                `;
            }
        }

        tableHtml += `
                    </tbody>
                </table>
                
                <div class="history-actions" style="display:flex;gap:12px;justify-content:flex-end;">
                    <button class="btn secondary" onclick="app.exportSyncHistory()">Export Log</button>
                    <button class="btn secondary" onclick="app.clearSyncHistory()">Clear History</button>
                </div>
            </div>
        `;

        UI.showModal('Sync History - Google Calendar', tableHtml, [
            { label: 'Close', type: 'secondary', action: 'UI.hideModal()' }
        ]);
    };

    const exportSyncHistory = () => { UI.toast.info('Exporting sync history...'); };
    const clearSyncHistory = async () => {
        const userId = _state.cu?.id || 1;
        const myLogs = await AppDataStore.getAll('sync_history');
        const mine = myLogs.filter(h => h.user_id === userId);
        await Promise.all(mine.map(h => AppDataStore.delete('sync_history', h.id).catch(() => {})));
        UI.toast.success('Sync history cleared');
        await viewSyncHistory();
    };
    const refreshSyncHistory = async () => { await viewSyncHistory(); };

    const disconnectGoogle = async () => {
        UI.showModal('Disconnect Google Calendar', `
            <p>Are you sure you want to disconnect Google Calendar?</p>
            <p>This will stop all sync between CRM and Google Calendar.</p>
            <p class="warning-text" style="color:var(--error);font-weight:600;">Your existing activities will remain in both systems.</p>
        `, [
            { label: 'Cancel', type: 'secondary', action: 'UI.hideModal()' },
            { label: 'Disconnect', type: 'error', action: '(async () => { await app.confirmDisconnectGoogle(); })()' }
        ]);
    };

    const confirmDisconnectGoogle = async () => {
        const connection = await getGoogleConnection();
        if (connection) {
            await AppDataStore.update('integration_connections', connection.id, {
                status: 'disconnected',
                updated_at: new Date().toISOString()
            });
        }
        UI.hideModal();
        UI.toast.success('Google Calendar disconnected');
        await showGoogleCalendarIntegration();
    };

    const resolveConflict = async (choice, activityId, eventId) => {
        if (_syncManager) _syncManager.resolveConflict(choice, activityId, eventId);
    };

    // ========== WEBHOOK NOTIFICATIONS INTEGRATION ==========
    // Genuinely feasible from a static SPA: the admin pastes an *incoming*
    // webhook URL (Slack / Discord / generic) and picks which CRM events
    // should POST a JSON payload to it. No OAuth, no secrets we hold — the
    // URL is user-provided config, persisted like Google's settings via an
    // integration_connections row (config lives in the JSON sync_settings
    // column). AppDataStore already falls back to localStorage when offline.

    // Catalogue of events an admin can subscribe to. Keys are stored in
    // config.events as booleans.
    const WEBHOOK_EVENTS = [
        { key: 'new_lead', label: 'New lead / prospect created' },
        { key: 'deal_closed', label: 'Deal closed (sale recorded)' },
        { key: 'new_activity', label: 'Activity logged (CPS / FTF / FSA)' },
        { key: 'appointment_booked', label: 'Appointment booked' },
        { key: 'customer_added', label: 'New customer added' }
    ];

    const DEFAULT_WEBHOOK_EVENTS = { new_lead: true, deal_closed: true, new_activity: false, appointment_booked: false, customer_added: false };

    const getWebhookIntegrationId = async () => {
        let integration = (await AppDataStore.getAll('integrations')).find(i => i.provider === 'webhook');
        if (!integration) {
            integration = await AppDataStore.create('integrations', {
                integration_name: 'Webhook Notifications',
                provider: 'webhook',
                type: 'messaging',
                is_active: true,
                config_schema: {},
                created_at: new Date().toISOString()
            });
        }
        return integration ? integration.id : null;
    };

    const getWebhookConnection = async () => {
        const integrationId = await getIntegrationId('webhook');
        if (!integrationId) return null;
        const connections = await AppDataStore.query('integration_connections', {
            integration_id: integrationId,
            user_id: _state.cu?.id || 1
        });
        return connections.length > 0 ? connections[0] : null;
    };

    // Pull the webhook config out of the connection's JSON column, with
    // sane defaults so the form always renders.
    const getWebhookConfig = (connection) => {
        const s = connection?.sync_settings || {};
        return {
            url: typeof s.url === 'string' ? s.url : '',
            provider: s.provider || 'generic', // slack | discord | generic
            events: { ...DEFAULT_WEBHOOK_EVENTS, ...(s.events || {}) }
        };
    };

    const isHttpsWebhookUrl = (url) => {
        if (!url || typeof url !== 'string') return false;
        try {
            const u = new URL(url.trim());
            return u.protocol === 'https:';
        } catch (_) {
            return false;
        }
    };

    const detectWebhookProvider = (url) => {
        const u = (url || '').toLowerCase();
        if (u.includes('hooks.slack.com')) return 'slack';
        if (u.includes('discord.com/api/webhooks') || u.includes('discordapp.com/api/webhooks')) return 'discord';
        return 'generic';
    };

    const showWebhookIntegration = async () => {
        const connection = await getWebhookConnection();
        const cfg = getWebhookConfig(connection);
        const isConfigured = !!cfg.url;
        const canEdit = isSystemAdmin();

        const vp = document.getElementById('content-viewport');
        if (!vp) return;

        const eventRows = WEBHOOK_EVENTS.map(ev => `
            <label class="checkbox-label" style="display:flex;align-items:center;gap:8px;padding:4px 0;">
                <input type="checkbox" id="wh-ev-${esc(ev.key)}" ${cfg.events[ev.key] ? 'checked' : ''} ${canEdit ? '' : 'disabled'}>
                ${esc(ev.label)}
            </label>
        `).join('');

        vp.innerHTML = `
            <div class="integration-detail">
                <div class="detail-header">
                    <button class="btn secondary" onclick="app.showIntegrationHub(document.getElementById('content-viewport'))">
                        <i class="fas fa-arrow-left"></i> Back to Integrations
                    </button>
                    <h1>Webhook Notifications</h1>
                </div>

                <div class="connection-status ${isConfigured ? 'connected' : 'disconnected'}">
                    <div class="status-indicator ${isConfigured ? 'connected' : 'disconnected'}"></div>
                    <div class="status-text">
                        <h3>${isConfigured ? 'Configured' : 'Not configured'}</h3>
                        ${isConfigured ? `
                            <p>Posting selected CRM events to your <strong>${esc(cfg.provider)}</strong> webhook.</p>
                        ` : `
                            <p>Push CRM events (new leads, closed deals, …) to Slack, Discord, or any incoming-webhook URL.</p>
                        `}
                    </div>
                </div>

                ${!canEdit ? `
                    <div class="settings-section" style="margin-top:16px;">
                        <p style="color:var(--gray-500);"><i class="fas fa-lock"></i> Only a System Admin can configure webhook notifications.</p>
                    </div>
                ` : `
                    <div class="sync-settings">
                        <div class="settings-section">
                            <h4>Incoming Webhook URL</h4>
                            <p style="color:var(--gray-500);font-size:13px;margin:0 0 8px;">
                                Paste a Slack / Discord / generic incoming-webhook URL. Must start with <code>https://</code>.
                                Create one in Slack (Incoming Webhooks app) or Discord (Channel → Integrations → Webhooks).
                            </p>
                            <input type="url" class="form-control" id="wh-url" placeholder="https://hooks.slack.com/services/..." value="${esc(cfg.url)}">
                        </div>

                        <div class="settings-section">
                            <h4>Notify me on</h4>
                            ${eventRows}
                        </div>

                        <div class="settings-actions">
                            <button class="btn primary" onclick="app.saveWebhookSettings()">Save</button>
                            <button class="btn secondary" onclick="app.testWebhook()">Send Test</button>
                            ${isConfigured ? `<button class="btn error" onclick="app.disconnectWebhook()">Remove</button>` : ''}
                        </div>
                    </div>
                `}
            </div>
        `;
    };

    const readWebhookFormConfig = () => {
        const url = (document.getElementById('wh-url')?.value || '').trim();
        const events = {};
        for (const ev of WEBHOOK_EVENTS) {
            events[ev.key] = document.getElementById(`wh-ev-${ev.key}`)?.checked || false;
        }
        return { url, events, provider: detectWebhookProvider(url) };
    };

    const saveWebhookSettings = async () => {
        if (!isSystemAdmin()) { UI.toast.error('Only a System Admin can change this'); return; }
        const form = readWebhookFormConfig();

        if (!form.url) { UI.toast.error('Please enter a webhook URL'); return; }
        if (!isHttpsWebhookUrl(form.url)) {
            UI.toast.error('Webhook URL must be a valid https:// address');
            return;
        }

        try {
            const integrationId = await getWebhookIntegrationId();
            if (!integrationId) { UI.toast.error('Could not save — integration unavailable'); return; }

            const settings = { url: form.url, provider: form.provider, events: form.events };
            const existing = await getWebhookConnection();

            if (existing) {
                await AppDataStore.update('integration_connections', existing.id, {
                    status: 'connected',
                    sync_settings: settings,
                    updated_at: new Date().toISOString()
                });
            } else {
                await AppDataStore.create('integration_connections', {
                    integration_id: integrationId,
                    user_id: _state.cu?.id || 1,
                    access_token: '',
                    refresh_token: '',
                    token_expires_at: null,
                    scope: 'webhook',
                    status: 'connected',
                    last_sync: null,
                    sync_settings: settings,
                    created_at: new Date().toISOString()
                });
            }

            UI.toast.success('Webhook settings saved');
            await showWebhookIntegration();
        } catch (e) {
            console.error('Save webhook error:', e);
            UI.toast.error('Failed to save webhook settings');
        }
    };

    // Build a provider-shaped payload. Slack expects { text }, Discord
    // expects { content }; generic endpoints get a structured object.
    const buildWebhookPayload = (provider, event, summary, data) => {
        const text = `:bell: *CRM ${event}* — ${summary}`;
        if (provider === 'slack') return { text };
        if (provider === 'discord') return { content: `🔔 **CRM ${event}** — ${summary}` };
        return {
            source: 'DestinOraclesSolution CRM',
            event,
            summary,
            data: data || {},
            timestamp: new Date().toISOString()
        };
    };

    // POST to the configured webhook. Slack/Discord browser POSTs trip CORS,
    // so we use mode:'no-cors' (opaque response — we can't read status, but
    // the request is delivered). Generic endpoints that send CORS headers
    // get a normal request so we can surface real failures. Always wrapped
    // in try/catch; never throws to the caller.
    const postToWebhook = async (url, provider, payload) => {
        if (!isHttpsWebhookUrl(url)) return { ok: false, reason: 'invalid_url' };
        const opaque = provider === 'slack' || provider === 'discord';
        try {
            const resp = await fetch(url, {
                method: 'POST',
                mode: opaque ? 'no-cors' : 'cors',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
            // Opaque (no-cors) responses report ok:false / status:0 even on
            // success — treat a non-thrown opaque response as delivered.
            if (opaque) return { ok: true, opaque: true };
            return { ok: resp.ok, status: resp.status };
        } catch (e) {
            console.error('Webhook POST failed:', e);
            return { ok: false, reason: e?.message || 'network_error' };
        }
    };

    const testWebhook = async () => {
        if (!isSystemAdmin()) { UI.toast.error('Only a System Admin can do this'); return; }
        // Prefer the value currently in the form so admins can test before saving.
        const form = readWebhookFormConfig();
        let url = form.url;
        let provider = form.provider;
        if (!url) {
            const conn = await getWebhookConnection();
            const cfg = getWebhookConfig(conn);
            url = cfg.url; provider = cfg.provider;
        }
        if (!isHttpsWebhookUrl(url)) {
            UI.toast.error('Enter a valid https:// webhook URL first');
            return;
        }

        UI.toast.info('Sending test notification…');
        const payload = buildWebhookPayload(
            provider,
            'test',
            'This is a test notification from your CRM Integration Hub.',
            { triggered_by: _state.cu?.name || _state.cu?.email || 'admin', kind: 'test' }
        );
        const result = await postToWebhook(url, provider, payload);
        if (result.ok) {
            UI.toast.success(result.opaque
                ? 'Test sent — check your channel (delivery cannot be confirmed from the browser for Slack/Discord)'
                : 'Test notification delivered successfully');
        } else {
            UI.toast.error('Test failed — check the URL and try again');
        }
    };

    const disconnectWebhook = async () => {
        UI.showModal('Remove Webhook', `
            <p>Remove the configured webhook? CRM events will stop being sent.</p>
            <p style="color:var(--gray-500);font-size:13px;">The webhook URL on your Slack/Discord side is not affected.</p>
        `, [
            { label: 'Cancel', type: 'secondary', action: 'UI.hideModal()' },
            { label: 'Remove', type: 'error', action: '(async () => { await app.confirmDisconnectWebhook(); })()' }
        ]);
    };

    const confirmDisconnectWebhook = async () => {
        try {
            const connection = await getWebhookConnection();
            if (connection) {
                await AppDataStore.update('integration_connections', connection.id, {
                    status: 'disconnected',
                    sync_settings: { url: '', provider: 'generic', events: { ...DEFAULT_WEBHOOK_EVENTS } },
                    updated_at: new Date().toISOString()
                });
            }
        } catch (e) {
            console.error('Disconnect webhook error:', e);
        }
        UI.hideModal();
        UI.toast.success('Webhook removed');
        await showWebhookIntegration();
    };

    // Public dispatch hook: other parts of the CRM can call
    // app.dispatchWebhookEvent('new_lead', 'Jane Doe added', {...}) to fire a
    // notification if (a) a webhook is configured and (b) that event is
    // enabled. Silent + non-blocking — never throws into the caller.
    const dispatchWebhookEvent = async (eventKey, summary, data) => {
        try {
            const connection = await getWebhookConnection();
            if (!connection || connection.status !== 'connected') return;
            const cfg = getWebhookConfig(connection);
            if (!cfg.url || !cfg.events[eventKey]) return;
            const payload = buildWebhookPayload(cfg.provider, eventKey, summary || eventKey, data);
            await postToWebhook(cfg.url, cfg.provider, payload);
        } catch (e) {
            console.error('dispatchWebhookEvent error:', e);
        }
    };

    // Auto-sync activities to Google Calendar. Subscribe to the data layer's
    // `dataChanged` event (emitted once per create/update/delete) instead of
    // monkey-patching AppDataStore.create/update/delete process-wide. Filtering
    // to the explicit-mutation actions (add/update/delete) reproduces the old
    // method-wrap behavior exactly — same 1s debounce, same per-activity-type
    // gate, same "sync on any delete" — while leaving the shared data layer's
    // methods untouched (the wrap previously ran on every write of every table).
    window.addEventListener('dataChanged', (e) => {
        const d = e.detail || {};
        if (d.table !== 'activities' || !_syncManager) return;
        if (d.action !== 'add' && d.action !== 'update' && d.action !== 'delete') return;
        setTimeout(async () => {
            const connection = await getGoogleConnection();
            if (!connection) return;
            if (d.action === 'delete') {
                await _syncManager.syncCRMtoGoogle().catch(console.error);
                return;
            }
            // add: gate by the new record's type (matches the old create wrap).
            // update: re-read the persisted activity, matching the old update
            // wrap which fetched by id rather than trusting the partial payload.
            let activity = d.record;
            if (d.action === 'update') {
                activity = await AppDataStore.getById('activities', d.record?.id);
            }
            if (activity && connection.sync_settings?.syncTypes[activity.activity_type?.toLowerCase()]) {
                await _syncManager.syncCRMtoGoogle().catch(console.error);
            }
        }, 1000);
    });

    app.register('gcal', {
        showIntegrationHub,
        showIntegrationDetails,
        showGoogleCalendarIntegration,
        initiateGoogleOAuth,
        simulateGoogleConnection,
        saveGoogleSettings,
        syncGoogleCalendar,
        viewSyncHistory,
        exportSyncHistory,
        clearSyncHistory,
        refreshSyncHistory,
        disconnectGoogle,
        confirmDisconnectGoogle,
        resolveConflict,
        initGoogleIntegration,
        // Webhook Notifications integration
        showWebhookIntegration,
        saveWebhookSettings,
        testWebhook,
        disconnectWebhook,
        confirmDisconnectWebhook,
        dispatchWebhookEvent,
    });
    // Self-init: the main script no longer calls initGoogleIntegration() directly
    // (it's a lazy chunk), so we call it here when the chunk first loads.
    initGoogleIntegration();
})();