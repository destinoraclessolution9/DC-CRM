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

    const showIntegrationHub = async (container) => {
        try {
            container.innerHTML = `
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
                    ${await renderIntegrationCard('google', 'Google Calendar', 'Two-way sync', 'calendar', await getConnectionStatus('google'))}
                    ${await renderIntegrationCard('outlook', 'Outlook Calendar', 'One-way sync', 'calendar', await getConnectionStatus('outlook'))}
                    ${await renderIntegrationCard('whatsapp', 'WhatsApp Business', 'Outbound only', 'messaging', await getConnectionStatus('whatsapp'))}
                    ${await renderIntegrationCard('twilio', 'Twilio SMS', 'Outbound only', 'messaging', await getConnectionStatus('twilio'))}
                    ${await renderIntegrationCard('quickbooks', 'QuickBooks', 'One-way sync', 'accounting', await getConnectionStatus('quickbooks'))}
                    ${await renderIntegrationCard('googledrive', 'Google Drive', 'Two-way sync', 'storage', await getConnectionStatus('googledrive'))}
                </div>
            </div>
        `;
        } catch (e) {
            console.error('Integration Hub error:', e);
            container.innerHTML = '<div class="error-state" style="padding:40px;text-align:center;"><i class="fas fa-exclamation-circle" style="font-size:2rem;color:#ef4444;"></i><p style="margin-top:12px;">Failed to load integrations. Please try again later.</p></div>';
        }
    };

    const renderIntegrationCard = async (id, name, description, type, status) => {
        const statusColors = {
            connected: 'status-connected',
            disconnected: 'status-disconnected',
            expired: 'status-expired'
        };

        const statusIcons = {
            calendar: 'fas fa-calendar-alt',
            messaging: 'fas fa-comment',
            accounting: 'fas fa-chart-line',
            storage: 'fas fa-database'
        };

        return `
            <div class="integration-card" onclick="app.showIntegrationDetails('${id}')">
                <div class="integration-icon ${type}">
                    <i class="${statusIcons[type] || 'fas fa-plug'}"></i>
                </div>
                <div class="integration-info">
                    <h3>${name}</h3>
                    <p>${description}</p>
                    <div class="integration-status ${statusColors[status] || statusColors.disconnected}">
                        ${status === 'connected' ? '🟢 Connected' : status === 'expired' ? '🟡 Expired' : '🔴 Disconnected'}
                    </div>
                </div>
                <div class="integration-action">
                    <button class="btn ${status === 'connected' ? 'secondary' : 'primary'}" onclick="event.stopPropagation(); id === 'whatsapp' ? await app.showWhatsAppIntegration() : app.showIntegrationDetails('${id}')">
                        ${status === 'connected' ? 'Configure' : 'Connect'}
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

    const showIntegrationDetails = async (provider) => {
        if (provider === 'google') {
            await showGoogleCalendarIntegration();
        } else {
            UI.toast.info(`${provider} integration coming soon`);
        }
    };

    const showGoogleCalendarIntegration = async () => {
        const connection = await getGoogleConnection();
        const isConnected = connection && connection.status === 'connected';

        const viewport = document.getElementById('content-viewport');
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
                            <p>Connected as: ${connection.user_email || 'user@gmail.com'}</p>
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
                        <td style="padding:12px;">${activity ? activity.activity_title : 'Unknown activity'}</td>
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

    // Hook into activity CRUD for auto-sync
    const originalCreateActivity = AppDataStore.create;
    const originalUpdateActivity = AppDataStore.update;
    const originalDeleteActivity = AppDataStore.delete;

    AppDataStore.create = async function (tableName, data) {
        const result = await originalCreateActivity.call(this, tableName, data);
        if (tableName === 'activities' && _syncManager) {
            setTimeout(async () => {
                const connection = await getGoogleConnection();
                if (connection && connection.sync_settings?.syncTypes[data.activity_type?.toLowerCase()]) {
                    await _syncManager.syncCRMtoGoogle().catch(console.error);
                }
            }, 1000);
        }
        return result;
    };

    AppDataStore.update = async function (tableName, id, data) {
        const result = await originalUpdateActivity.call(this, tableName, id, data);
        if (tableName === 'activities' && _syncManager) {
            setTimeout(async () => {
                const connection = await getGoogleConnection();
                const activity = await AppDataStore.getById('activities', id);
                if (connection && activity && connection.sync_settings?.syncTypes[activity.activity_type?.toLowerCase()]) {
                    await _syncManager.syncCRMtoGoogle().catch(console.error);
                }
            }, 1000);
        }
        return result;
    };

    AppDataStore.delete = async function (tableName, id) {
        const result = await originalDeleteActivity.call(this, tableName, id);
        if (tableName === 'activities' && _syncManager) {
            setTimeout(async () => {
                const connection = await getGoogleConnection();
                if (connection) {
                    await _syncManager.syncCRMtoGoogle().catch(console.error);
                }
            }, 1000);
        }
        return result;
    };

    Object.assign(window.app, {
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
    });
    // Self-init: the main script no longer calls initGoogleIntegration() directly
    // (it's a lazy chunk), so we call it here when the chunk first loads.
    initGoogleIntegration();
})();