/**
 * CRM Lazy Chunk: WhatsApp Business Integration
 *
 * Self-contained IIFE. Accesses shared state through window.* globals only.
 * Loaded on-demand by navigateTo() when user navigates to 'whatsapp' view,
 * OR auto-loaded by addWhatsAppButtonToProfile (kept in script.js) via
 * window._loadChunk('chunks/script-whatsapp.min.js') on first button click.
 *
 * Extracted 2026-06-05 from script.js L6967-7605 (~640 lines).
 *
 * External dependencies (all global):
 *   window.AppDataStore   window.UI   window.app
 *   window._appState.cu   (current user — read-only)
 *   window._crmUtils.escapeHtml
 */
(() => {
    const _state = window._appState;
    const esc    = (s) => (window._crmUtils.escapeHtml || String)(s);

    // Collision-resistant local id for whatsapp_messages rows when the Meta API
    // does not return a wamid (offline / API failure / fabricated record).
    // Date.now() alone collides on rapid sends (ms resolution); append entropy.
    const _localMsgId = () => (
        (window.crypto && window.crypto.randomUUID)
            ? 'wamid_' + window.crypto.randomUUID()
            : 'wamid_' + Date.now() + '_' + Math.random().toString(36).slice(2)
    );

    // Escape regex metacharacters so a variable key cannot build a malformed
    // pattern when interpolated into a RegExp source.
    const _escapeRegExp = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

    // Render a timestamp from a (possibly missing) date field. Incoming/webhook
    // rows may carry neither sent_at nor created_at → avoid 'Invalid Date'.
    const _fmtDate = (d) => (d ? new Date(d).toLocaleString() : '—');

    // ── Internal helpers ─────────────────────────────────────────────────

    const getWhatsAppConnection = async () => {
        const integrations = await AppDataStore.getAll('integrations');
        const whatsappIntegration = integrations.find(i => i.provider === 'whatsapp');
        if (!whatsappIntegration) return null;
        const connections = await AppDataStore.query('integration_connections', {
            integration_id: whatsappIntegration.id,
            user_id: _state.cu?.id || 1
        });
        return connections.length > 0 ? connections[0] : null;
    };

    const _callWhatsAppAPI = async (method, path, body = null) => {
        const conn = await getWhatsAppConnection();
        if (!conn?.access_token) throw new Error('WhatsApp not connected. Please configure credentials in Integrations.');
        const url = `https://graph.facebook.com/v20.0/${path}`;
        const opts = {
            method,
            headers: { 'Authorization': `Bearer ${conn.access_token}`, 'Content-Type': 'application/json' }
        };
        if (body) opts.body = JSON.stringify(body);
        const res  = await fetch(url, opts);
        const data = await res.json();
        if (!res.ok) throw new Error(data.error?.message || `WhatsApp API error ${res.status}`);
        return { data, conn };
    };

    // ── Public view ──────────────────────────────────────────────────────

    const buildWhatsAppIntegrationHtml = (connection, isConnected) => `
            <div class="whatsapp-integration">
                <div class="detail-header" style="margin-bottom:24px;display:flex;align-items:center;gap:16px;">
                    <button class="btn secondary" onclick="app.showIntegrationHub(document.getElementById('content-viewport'))">
                        <i class="fas fa-arrow-left"></i> Back to Integrations
                    </button>
                    <h1 style="margin:0;font-size:24px;">WhatsApp Business Integration</h1>
                </div>
                <div class="connection-status ${isConnected ? 'connected' : 'disconnected'}">
                    <div class="status-indicator ${isConnected ? 'connected' : 'disconnected'}"></div>
                    <div class="status-text">
                        <h3>${isConnected ? 'Connected' : 'Disconnected'}</h3>
                        ${isConnected ? `
                            <p>Connected as: ${esc(connection.business_phone || '+60 XXX XXXX')}</p>
                            <p>Last Sync: ${connection.last_sync ? new Date(connection.last_sync).toLocaleString() : 'Never'}</p>
                        ` : `
                            <p>Connect your WhatsApp Business account to send messages and track conversations.</p>
                        `}
                    </div>
                </div>
                <div class="connection-form" style="margin-top:24px;background:var(--white);padding:24px;border-radius:8px;box-shadow:var(--shadow-md);">
                    <h3>Connection Details</h3>
                    <div class="form-group">
                        <label>WhatsApp Business Account ID</label>
                        <input type="text" id="waba-id" class="form-control" value="${esc(connection?.business_account_id || '')}" placeholder="123456789012345">
                    </div>
                    <div class="form-group">
                        <label>Phone Number ID</label>
                        <input type="text" id="phone-id" class="form-control" value="${esc(connection?.phone_number_id || '')}" placeholder="123456789012345">
                    </div>
                    <div class="form-group">
                        <label>Business Phone Number</label>
                        <input type="text" id="business-phone" class="form-control" value="${esc(connection?.business_phone || '')}" placeholder="+60 12-345 6789">
                    </div>
                    <div class="form-group">
                        <label>Access Token</label>
                        <div class="token-input">
                            <input type="password" id="access-token" class="form-control" value="${connection?.access_token ? '••••••••' : ''}" placeholder="Enter access token">
                            <button class="btn secondary" onclick="app.testWhatsAppConnection()">Test Connection</button>
                        </div>
                    </div>
                    <h3 style="margin-top:24px;">Webhook Configuration</h3>
                    <div class="form-group">
                        <label>Webhook URL</label>
                        <div class="webhook-url">
                            <input type="text" id="webhook-url" class="form-control" value="https://destinoraclessolution.com/api/whatsapp/webhook" readonly>
                            <button class="btn-icon" aria-label="Copy webhook URL" onclick="app.copyWebhookUrl()" title="Copy"><i class="fas fa-copy" aria-hidden="true"></i></button>
                        </div>
                    </div>
                    <div class="form-group">
                        <label>Verification Token</label>
                        <div class="token-input">
                            <input type="password" id="verify-token" class="form-control" value="${esc(connection?.verify_token || '')}" placeholder="Enter verification token">
                            <button class="btn secondary" onclick="app.verifyWebhook()">Verify</button>
                        </div>
                    </div>
                    <div class="webhook-status">
                        <span class="status-indicator ${connection?.webhook_verified ? 'connected' : 'disconnected'}"></span>
                        <span>${connection?.webhook_verified ? 'Active' : 'Not verified'}</span>
                    </div>
                </div>
                <div class="form-actions">
                    <button class="btn primary" onclick="app.saveWhatsAppConnection()">Save Connection</button>
                    ${isConnected ? `
                        <button class="btn secondary" onclick="app.testWhatsAppConnection()">Test Connection</button>
                        <button class="btn error" onclick="app.disconnectWhatsApp()">Disconnect</button>
                    ` : ''}
                </div>
            </div>`;

    const showWhatsAppIntegration = async (container) => {
        const connection  = await getWhatsAppConnection();
        const isConnected = connection && connection.status === 'connected';
        const viewport    = container || document.getElementById('content-viewport');

        const content = buildWhatsAppIntegrationHtml(connection, isConnected);

        if (viewport) viewport.innerHTML = content;
        else UI.showModal('WhatsApp Business Integration', content, [{ label: 'Close', type: 'secondary', action: 'UI.hideModal()' }]);
    };

    const saveWhatsAppConnection = async () => {
        const businessAccountId = document.getElementById('waba-id')?.value;
        const phoneNumberId     = document.getElementById('phone-id')?.value;
        const businessPhone     = document.getElementById('business-phone')?.value;
        const tokenInput        = document.getElementById('access-token')?.value;
        const verifyToken       = document.getElementById('verify-token')?.value;

        const existingConnection = await getWhatsAppConnection();
        // The token field is pre-filled with a bullet mask when a connection
        // already exists. Treat the mask (or an empty field) as "unchanged" and
        // keep the previously-stored token — otherwise editing any other field
        // and saving would overwrite the real token with the literal mask.
        const accessToken = (tokenInput && tokenInput !== '••••••••')
            ? tokenInput
            : (existingConnection?.access_token || '');

        if (!businessAccountId || !phoneNumberId || !businessPhone || !accessToken) {
            UI.toast.error('Please fill in all required fields'); return;
        }
        // Wrap all writes: an RLS/offline failure must surface as an error toast
        // (the user is saving an access token — silent failure is unacceptable)
        // and must NOT hide the modal so they can retry.
        try {
            let integration = (await AppDataStore.getAll('integrations')).find(i => i.provider === 'whatsapp');
            if (!integration) {
                integration = await AppDataStore.create('integrations', {
                    integration_name: 'WhatsApp Business', provider: 'whatsapp',
                    type: 'messaging', is_active: true, config_schema: {},
                    created_at: new Date().toISOString()
                });
            }
            const connectionData = {
                integration_id: integration.id, user_id: _state.cu?.id || 1,
                business_account_id: businessAccountId, phone_number_id: phoneNumberId,
                business_phone: businessPhone, access_token: accessToken,
                verify_token: verifyToken, status: 'connected',
                updated_at: new Date().toISOString()
            };
            if (existingConnection) {
                await AppDataStore.update('integration_connections', existingConnection.id, connectionData);
            } else {
                await AppDataStore.create('integration_connections', { ...connectionData, created_at: new Date().toISOString() });
            }
        } catch (e) {
            UI.toast.error('Failed to save WhatsApp connection: ' + (e?.message || e));
            return;
        }
        UI.hideModal();
        UI.toast.success('WhatsApp connection saved');
        await showWhatsAppIntegration();
    };

    const testWhatsAppConnection = async () => {
        UI.toast.info('Testing connection...');
        try {
            const conn = await getWhatsAppConnection();
            if (!conn?.phone_number_id) { UI.toast.error('No connection configured'); return; }
            const { data } = await _callWhatsAppAPI('GET', conn.phone_number_id);
            UI.toast.success(`Connected: ${data.display_phone_number || data.verified_name || 'OK'}`);
        } catch (e) { UI.toast.error(`Connection failed: ${e.message}`); }
    };

    const verifyWebhook = async () => {
        const connection = await getWhatsAppConnection();
        if (!connection) { UI.toast.error('No WhatsApp connection configured. Save the connection first.'); return; }
        const verifyToken = document.getElementById('verify-token')?.value || connection.verify_token;
        const webhookUrl  = document.getElementById('webhook-url')?.value || 'https://destinoraclessolution.com/api/whatsapp/webhook';
        if (!verifyToken) { UI.toast.error('Enter a verification token first'); return; }
        UI.toast.info('Verifying webhook...');
        try {
            // Actually perform the Meta webhook handshake: GET the endpoint with the
            // hub.* challenge and require it to echo our nonce back verbatim. Only a
            // correct verify_token + reachable endpoint will produce the echo.
            const nonce = String(Date.now());
            const url = `${webhookUrl}${webhookUrl.includes('?') ? '&' : '?'}hub.mode=subscribe&hub.verify_token=${encodeURIComponent(verifyToken)}&hub.challenge=${encodeURIComponent(nonce)}`;
            const res = await fetch(url, { method: 'GET' });
            if (!res.ok) throw new Error(`Webhook returned ${res.status}`);
            const echoed = (await res.text()).trim();
            if (echoed !== nonce) throw new Error('Verify token rejected by endpoint');
            await AppDataStore.update('integration_connections', connection.id, {
                webhook_verified: true, updated_at: new Date().toISOString()
            });
            UI.toast.success('Webhook verified successfully');
            await showWhatsAppIntegration();
        } catch (e) {
            UI.toast.error('Webhook verification failed: ' + (e?.message || e));
        }
    };

    const copyWebhookUrl = () => {
        const url = document.getElementById('webhook-url');
        if (!url || !url.value) { UI.toast.error('No webhook URL to copy'); return; }
        // Use the modern async clipboard API; only report success when the write
        // actually resolves. Fall back to the legacy execCommand path if the
        // Clipboard API is unavailable (e.g. insecure context).
        if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(url.value)
                .then(() => UI.toast.success('Webhook URL copied to clipboard'))
                .catch(() => UI.toast.error('Failed to copy webhook URL'));
        } else {
            url.select();
            const ok = document.execCommand('copy');
            if (ok) UI.toast.success('Webhook URL copied to clipboard');
            else UI.toast.error('Failed to copy webhook URL');
        }
    };

    const disconnectWhatsApp = async () => {
        UI.showModal('Disconnect WhatsApp', `
            <p>Are you sure you want to disconnect WhatsApp Business?</p>
            <p>This will stop all messaging and template sync.</p>
        `, [
            { label: 'Cancel',     type: 'secondary', action: 'UI.hideModal()' },
            { label: 'Disconnect', type: 'error',     action: '(async () => { await app.confirmDisconnectWhatsApp(); })()' }
        ]);
    };

    const confirmDisconnectWhatsApp = async () => {
        const connection = await getWhatsAppConnection();
        if (connection) {
            await AppDataStore.update('integration_connections', connection.id, {
                status: 'disconnected', updated_at: new Date().toISOString()
            });
        }
        UI.hideModal();
        UI.toast.success('WhatsApp disconnected');
        await showWhatsAppIntegration();
    };

    const openSendWhatsAppModal = async (entityType, entityId) => {
        const entity = entityType === 'prospect'
            ? await AppDataStore.getById('prospects', entityId)
            : await AppDataStore.getById('customers', entityId);
        if (!entity) return;

        // Do NOT auto-seed templates when the read returns empty. An empty result
        // can mean a dead-session/RLS-denied read, an offline window, or that an
        // admin deliberately deleted all templates — writing seed rows here would
        // insert duplicates on repeated opens and silently resurrect deleted rows.
        // The picker below simply renders no options ("Select a template").
        const templates = await AppDataStore.getAll('whatsapp_templates');
        UI.showModal('Send WhatsApp Message', `
            <div class="send-whatsapp-modal">
                <h3>Send WhatsApp to ${esc(entity.full_name)} (${esc(entity.phone)})</h3>
                <div class="message-type">
                    <label class="radio-label"><input type="radio" name="msg-type" value="template" checked onchange="app.toggleMessageType()"> Use Template</label>
                    <label class="radio-label"><input type="radio" name="msg-type" value="free" onchange="app.toggleMessageType()"> Free Text</label>
                </div>
                <div id="template-section">
                    <div class="form-group">
                        <label>Template</label>
                        <select id="template-select" class="form-control">
                            <option value="">Select a template</option>
                            ${templates.map(t => `<option value="${esc(String(t.id))}">${esc(t.template_name)}</option>`).join('')}
                        </select>
                    </div>
                </div>
                <div id="free-text-section" style="display:none;">
                    <div class="form-group">
                        <label>Message</label>
                        <textarea id="free-message" class="form-control" rows="4" placeholder="Type your message..."></textarea>
                    </div>
                </div>
                <div class="schedule-options">
                    <label class="radio-label"><input type="radio" name="schedule" value="now" checked> Send now</label>
                    <label class="radio-label"><input type="radio" name="schedule" value="later"> Schedule for later</label>
                </div>
            </div>
        `, [
            { label: 'Cancel', type: 'secondary', action: 'UI.hideModal()' },
            { label: 'Send',   type: 'primary',   action: `app.sendWhatsApp('${entityType}', ${entityId})` }
        ]);
        window._currentWhatsAppEntity = { type: entityType, id: entityId, phone: entity.phone };
    };

    const toggleMessageType = () => {
        const isTemplate = document.querySelector('input[name="msg-type"]:checked')?.value === 'template';
        document.getElementById('template-section').style.display  = isTemplate ? 'block' : 'none';
        document.getElementById('free-text-section').style.display = isTemplate ? 'none'  : 'block';
    };

    const sendWhatsApp = async (entityType, entityId) => {
        const isTemplate = document.querySelector('input[name="msg-type"]:checked')?.value === 'template';
        const entity = window._currentWhatsAppEntity;
        if (!entity?.phone) { UI.toast.error('No recipient phone'); return; }
        // The "Schedule for later" radio has no backend behind it — never send
        // immediately while implying the scheduled option worked. Tell the user
        // it is unsupported and abort so no customer message goes out unexpectedly.
        const schedule = document.querySelector('input[name="schedule"]:checked')?.value;
        if (schedule === 'later') { UI.toast.error('Scheduling is not available yet — choose "Send now".'); return; }
        if (isTemplate) {
            const templateId = document.getElementById('template-select')?.value;
            if (!templateId) { UI.toast.error('Please select a template'); return; }
            const tid = parseInt(templateId);
            if (Number.isNaN(tid)) { UI.toast.error('Invalid template'); return; }
            // getById can return null (RLS deny / offline / deleted-but-listed) —
            // guard before dereferencing template_name, and keep the modal feedback.
            const template = await AppDataStore.getById('whatsapp_templates', tid);
            if (!template) { UI.toast.error('Template not found'); return; }
            UI.hideModal(); UI.toast.info('Sending...');
            await sendWhatsAppMessage(entity.phone, template.template_name, {});
        } else {
            const message = document.getElementById('free-message')?.value;
            if (!message) { UI.toast.error('Please enter a message'); return; }
            UI.hideModal(); UI.toast.info('Sending...');
            await sendFreeTextWhatsApp(entity.phone, message);
        }
        if (entityType === 'prospect') await app.showProspectDetail(entityId);
        else await app.showCustomerDetail(entityId);
    };

    const renderWhatsAppHistoryTab = async (entityType, entityId) => {
        const messages = (await AppDataStore.getAll('whatsapp_messages'))
            .filter(m => m.entity_type === entityType && m.entity_id == entityId)
            .sort((a, b) => new Date(b.sent_at || b.created_at) - new Date(a.sent_at || a.created_at));

        if (!messages.length) return `
            <div class="empty-history" style="text-align:center;padding:40px;color:var(--gray-500);">
                <i class="fab fa-whatsapp" style="font-size:48px;color:#25D366;margin-bottom:16px;"></i>
                <h3>No WhatsApp messages yet</h3>
                <p>Click the WhatsApp button to send your first message</p>
            </div>`;

        return `<div class="whatsapp-history" style="display:flex;flex-direction:column;gap:16px;">
            ${messages.map(msg => `
                <div class="message-item ${msg.direction}">
                    <div class="message-header" style="display:flex;justify-content:space-between;margin-bottom:8px;font-size:12px;color:var(--gray-600);">
                        <span>${msg.direction === 'outgoing' ? '📤 Outgoing' : '📥 Incoming'} · ${_fmtDate(msg.sent_at || msg.created_at)}</span>
                        ${msg.template_name ? `<span class="template-badge">${esc(msg.template_name)}</span>` : ''}
                    </div>
                    <div class="message-content" style="font-size:14px;margin-bottom:8px;">${esc(msg.content) || esc(msg.template_name) + ' template message'}</div>
                    <div class="message-footer" style="display:flex;justify-content:space-between;align-items:center;font-size:11px;">
                        <span class="message-status status-${msg.status}">
                            ${msg.status === 'sent' ? '✓ Sent' : msg.status === 'delivered' ? '✓✓ Delivered' : msg.status === 'read' ? '👁️ Read' : '❌ Failed'}
                        </span>
                        <div class="message-actions">
                            <button class="btn-icon" aria-label="View details" onclick="app.viewMessageDetails('${esc(String(msg.id))}')"><i class="fas fa-eye" aria-hidden="true"></i></button>
                            <button class="btn-icon" title="Resend" onclick="app.resendMessage('${esc(String(msg.id))}')"><i class="fas fa-redo"></i></button>
                            <button class="btn-icon" title="Reply"  onclick="app.replyToMessage('${esc(String(msg.id))}')"><i class="fas fa-reply"></i></button>
                            <button class="btn-icon" title="Forward" onclick="app.forwardMessage('${esc(String(msg.id))}')"><i class="fas fa-share"></i></button>
                            <button class="btn-icon" title="Create Activity" onclick="app.createTaskFromMessage('${esc(String(msg.id))}')"><i class="fas fa-calendar-plus"></i></button>
                        </div>
                    </div>
                </div>`).join('')}
        </div>`;
    };

    const viewMessageDetails = async (messageId) => {
        const message = (await AppDataStore.getAll('whatsapp_messages')).find(m => m.id === messageId);
        if (!message) return;
        UI.showModal('Message Details', `
            <div class="message-details">
                <div class="message-metadata" style="background:var(--gray-50);padding:16px;border-radius:8px;margin-bottom:16px;">
                    <div><strong>To:</strong> ${esc(message.to || '')}</div>
                    <div><strong>Direction:</strong> ${esc(message.direction || '')}</div>
                    <div><strong>Message ID:</strong> ${esc(String(message.id))}</div>
                    <div><strong>Sent:</strong> ${_fmtDate(message.sent_at || message.created_at)}</div>
                </div>
                <div class="message-bubble-large" style="background:#e5ddd5;padding:20px;border-radius:12px;margin-bottom:16px;">
                    ${esc(message.content || message.template_name || '')}
                </div>
            </div>
        `, [{ label: 'Close', type: 'secondary', action: 'UI.hideModal()' }]);
    };

    const resendMessage = async (messageId) => {
        const original = (await AppDataStore.getAll('whatsapp_messages')).find(m => m.id === messageId);
        if (!original) { UI.toast.error('Message not found'); return; }
        if (!original.to) { UI.toast.error('Original message has no recipient'); return; }
        UI.toast.info('Resending...');
        // Actually hit the WhatsApp API and persist the REAL status/wamid the
        // canonical send path returns — never fabricate a delivered row.
        if (original.template_name) {
            await sendWhatsAppMessage(original.to, original.template_name, {});
        } else {
            await sendFreeTextWhatsApp(original.to, original.content);
        }
        if (original.entity_type === 'prospect') await app.showProspectDetail(original.entity_id);
        else await app.showCustomerDetail(original.entity_id);
    };

    const replyToMessage = async (messageId) => {
        const original = (await AppDataStore.getAll('whatsapp_messages')).find(m => m.id === messageId);
        if (!original) { UI.toast.error('Message not found'); return; }
        window._currentWhatsAppEntity = { type: original.entity_type, id: original.entity_id, phone: original.to };
        await openSendWhatsAppModal(original.entity_type, original.entity_id);
    };

    const forwardMessage = async (messageId) => {
        const original = (await AppDataStore.getAll('whatsapp_messages')).find(m => m.id === messageId);
        if (!original) { UI.toast.error('Message not found'); return; }
        const [allProspects, allCustomers] = await Promise.all([AppDataStore.getAll('prospects'), AppDataStore.getAll('customers')]);
        // Scope the recipient picker to records the viewer is allowed to see —
        // otherwise the dropdown leaks every other agent's client names org-wide.
        let _visibleUserIds = 'all';
        try { _visibleUserIds = await window._crmUtils.getVisibleUserIds(_state.cu); }
        catch (_) { _visibleUserIds = _state.cu?.id != null ? [_state.cu.id] : []; }
        const _visSet = (_visibleUserIds !== 'all' && Array.isArray(_visibleUserIds))
            ? new Set(_visibleUserIds.map(v => String(v))) : null;
        // Customers are scoped by responsible_agent_id OR agent_id (prospects only have
        // the former, whose r.agent_id is undefined → harmlessly ignored). Without the
        // agent_id path an agent's own agent_id-scoped customers were hidden from Forward.
        const _canSee = (r) => !_visSet || _visSet.has(String(r.responsible_agent_id)) || _visSet.has(String(r.agent_id));
        const options = [
            ...allProspects.filter(_canSee).map(p => `<option value="prospect:${p.id}">${esc(p.full_name)} (Prospect)</option>`),
            ...allCustomers.filter(_canSee).map(c => `<option value="customer:${c.id}">${esc(c.full_name)} (Customer)</option>`)
        ].join('');
        UI.showModal('Forward Message', `
            <div class="form-group" style="margin-bottom:12px;">
                <label>Forward to</label>
                <select id="forward-target" class="form-control">
                    <option value="">-- Select recipient --</option>${options}
                </select>
            </div>
            <div style="background:var(--gray-50);padding:12px;border-radius:8px;font-size:13px;">${esc(original.content)}</div>
        `, [
            { label: 'Cancel',  type: 'secondary', action: 'UI.hideModal()' },
            // Actually forward via the canonical free-text send path
            // (app.sendFreeTextWhatsApp), which hits the WhatsApp API and persists
            // the REAL status/wamid — no fabricated 'delivered' row with a fake id.
            { label: 'Forward', type: 'primary',   action: `(async () => { try {
                const val = document.getElementById('forward-target').value;
                if (!val) { UI.toast.error('Select a recipient'); return; }
                const [type, id] = val.split(':');
                const entity = type === 'prospect' ? await AppDataStore.getById('prospects', parseInt(id)) : await AppDataStore.getById('customers', parseInt(id));
                if (!entity || !entity.phone) { UI.toast.error('Recipient has no phone number'); return; }
                UI.hideModal(); UI.toast.info('Forwarding...');
                await app.sendFreeTextWhatsApp(entity.phone, ${JSON.stringify(original.content)});
            } catch(e) { UI.toast.error('Forward failed: ' + (e?.message || e)); } })()` }
        ]);
    };

    const createTaskFromMessage = async (messageId) => {
        const original = (await AppDataStore.getAll('whatsapp_messages')).find(m => m.id === messageId);
        if (!original) { UI.toast.error('Message not found'); return; }
        window._activityPrefill = { entity_type: original.entity_type, entity_id: original.entity_id };
        await (window.app.openActivityModal || (() => {}))();
    };

    const syncWhatsAppTemplates = async () => {
        const connection = await getWhatsAppConnection();
        // The request URL is built from business_account_id, so guard on it (not
        // phone_number_id) — a legacy row missing it would otherwise request
        // '.../undefined/message_templates' and get a misleading API 400.
        if (!connection?.business_account_id || !connection?.access_token) {
            UI.toast.error('WhatsApp not connected. Configure integration settings first.'); return;
        }
        try {
            // Pass the bearer token in the Authorization header, never the query
            // string, so it does not leak into proxy/browser history logs.
            const res = await fetch(`https://graph.facebook.com/v20.0/${connection.business_account_id}/message_templates`, {
                headers: { 'Authorization': `Bearer ${connection.access_token}` }
            });
            if (!res.ok) throw new Error(`API error ${res.status}`);
            const data = await res.json();
            showTemplateSyncModal((data.data || []).filter(t => t.status === 'APPROVED'));
        } catch (err) {
            UI.toast.error('Sync failed: ' + err.message + '. Using local templates.');
            UI.toast.info(`${(await AppDataStore.getAll('whatsapp_templates')).length} local templates available`);
        }
    };

    const showTemplateSyncModal = (templates) => {
        if (!templates.length) { UI.toast.info('No approved templates found'); return; }
        UI.showModal('Sync Templates', `
            <p style="margin-bottom:12px;color:var(--gray-500);">${templates.length} approved templates found. Select which to import:</p>
            <div style="max-height:300px;overflow-y:auto;">
                ${templates.map(t => `
                    <label class="checkbox-label" style="display:flex;align-items:center;gap:8px;padding:8px;border-bottom:1px solid var(--gray-100);">
                        <input type="checkbox" class="sync-template-cb" value="${esc(t.name)}" data-content="${esc(t.components?.[0]?.text || t.name)}" checked>
                        <span><strong>${esc(t.name)}</strong> <span style="font-size:11px;color:var(--gray-400);">${t.language || ''}</span></span>
                    </label>`).join('')}
            </div>
        `, [
            { label: 'Cancel',          type: 'secondary', action: 'UI.hideModal()' },
            { label: 'Import Selected', type: 'primary',   action: '(async () => { try { await app.importSelectedTemplates(); } catch(e) { UI.toast.error(\'Import failed: \' + (e?.message || e)); } })()' }
        ]);
    };

    const importSelectedTemplates = async () => {
        const checked = Array.from(document.querySelectorAll('.sync-template-cb:checked'));
        if (!checked.length) { UI.toast.error('Select at least one template'); return; }
        let count = 0;
        for (const cb of checked) {
            const name = cb.value, content = cb.getAttribute('data-content');
            if (!(await AppDataStore.query('whatsapp_templates', { template_name: name })).length) {
                await AppDataStore.create('whatsapp_templates', { template_name: name, status: 'APPROVED', content });
                count++;
            }
        }
        UI.hideModal();
        UI.toast.success(`${count} template${count !== 1 ? 's' : ''} imported`);
    };

    const sendWhatsAppMessage = async (to, templateName, variables = {}) => {
        // Normalize to E.164-style digits with the Malaysia country code. The old
        // strip (only '+' and spaces) left dashes in and, worse, sent bare local
        // numbers ('012...', '12...') with no country code, so WhatsApp resolved them
        // against the wrong country.
        let phone = (to || '').replace(/[^0-9+]/g, '').replace(/^\+/, '');
        if (phone.startsWith('0')) phone = '60' + phone.slice(1);
        else if (/^1\d{7,9}$/.test(phone)) phone = '60' + phone;
        const conn  = await getWhatsAppConnection();
        if (!conn?.phone_number_id) { UI.toast.error('WhatsApp not connected'); return; }

        const localTemplate = (await AppDataStore.getAll('whatsapp_templates')).find(t => t.template_name === templateName);
        let content = localTemplate?.content || templateName;
        // Use a replacement FUNCTION so a `$` in the value isn't interpreted as a
        // String.replace replacement pattern ($&, $1, $`, …); escape regex
        // metacharacters in the key so the {{key}} pattern is built literally.
        Object.entries(variables).forEach(([k, v]) => {
            content = content.replace(new RegExp('{{' + _escapeRegExp(k) + '}}', 'g'), () => String(v));
        });

        const params = Object.values(variables).map(v => ({ type: 'text', text: String(v) }));
        const components = params.length ? [{ type: 'body', parameters: params }] : [];
        const langCode   = phone.startsWith('60') ? 'ms' : 'en_US';
        // Prefer the actual Meta-registered template name stored on the record so
        // the API call targets the approved template. Templates synced from Meta
        // (importSelectedTemplates) already store the Meta name verbatim in
        // template_name (it has no spaces — Meta names are snake_case), so a record
        // whose template_name is already slug-shaped is used as-is. Only legacy /
        // seeded records with a spaced display name fall back to deriving the slug;
        // the display name and the Meta name are otherwise independent.
        const slugify = (s) => s.toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '');
        const storedMeta = localTemplate?.meta_name
            || (localTemplate && localTemplate.template_name === slugify(localTemplate.template_name) ? localTemplate.template_name : null);
        const metaName   = storedMeta || slugify(templateName);

        let wamid = _localMsgId(), status = 'failed';
        try {
            const { data } = await _callWhatsAppAPI('POST', `${conn.phone_number_id}/messages`, {
                messaging_product: 'whatsapp', recipient_type: 'individual', to: phone,
                type: 'template', template: { name: metaName, language: { code: langCode }, components }
            });
            wamid  = data.messages?.[0]?.id || wamid;
            status = 'sent';
            UI.toast.success('WhatsApp message sent');
        } catch (e) { UI.toast.error(`Send failed: ${e.message}`); }

        // Scale-safe: resolve the recipient by phone via the existing
        // import_existing_matches RPC (normalized phone match, SECURITY DEFINER)
        // instead of downloading the whole prospects + customers tables. This is a
        // best-effort attribution (entity_id on the logged message), so the RPC's
        // more-robust phone normalization only improves match rate. Falls back to
        // the exact legacy whole-table scan on any error.
        let entity = null;
        try {
            const sb = window.supabase || (AppDataStore._readClient && AppDataStore._readClient());
            const [mp, mc] = await Promise.all([
                sb.rpc('import_existing_matches', { p_table: 'prospects', p_phones: [phone], p_emails: [], p_ics: [] }),
                sb.rpc('import_existing_matches', { p_table: 'customers', p_phones: [phone], p_emails: [], p_ics: [] }),
            ]);
            if (mp.error) throw mp.error;
            if (mc.error) throw mc.error;
            const p0 = (mp.data || [])[0], c0 = (mc.data || [])[0];
            if (p0) entity = { id: p0.id, _type: 'prospect' };
            else if (c0) entity = { id: c0.id, _type: 'customer' };
        } catch (e) {
            console.warn('WhatsApp entity lookup via RPC failed — full-table fallback', e);
            const allEntities = [
                ...(await AppDataStore.getAll('prospects')).map(e => ({ ...e, _type: 'prospect' })),
                ...(await AppDataStore.getAll('customers')).map(e => ({ ...e, _type: 'customer' }))
            ];
            entity = allEntities.find(e => (e.phone || '').replace(/^\+/, '').replace(/\s/g, '') === phone) || null;
        }
        await AppDataStore.create('whatsapp_messages', {
            id: wamid, entity_type: entity?._type || 'prospect', entity_id: entity?.id || null,
            direction: 'outgoing', to, template_name: templateName, content, status,
            sent_at: new Date().toISOString(), created_at: new Date().toISOString()
        });
    };

    const sendFreeTextWhatsApp = async (to, text) => {
        if (!text) return;
        const phone = (to || '').replace(/^\+/, '').replace(/\s/g, '');
        const conn  = await getWhatsAppConnection();
        if (!conn?.phone_number_id) { UI.toast.error('WhatsApp not connected'); return; }

        let wamid = _localMsgId(), status = 'failed';
        try {
            const { data } = await _callWhatsAppAPI('POST', `${conn.phone_number_id}/messages`, {
                messaging_product: 'whatsapp', recipient_type: 'individual', to: phone,
                type: 'text', text: { preview_url: false, body: text }
            });
            wamid  = data.messages?.[0]?.id || wamid;
            status = 'sent';
            UI.toast.success('WhatsApp message sent');
        } catch (e) { UI.toast.error(`Send failed: ${e.message}`); }

        // Scale-safe: resolve the recipient by phone via the existing
        // import_existing_matches RPC (normalized phone match, SECURITY DEFINER)
        // instead of downloading the whole prospects + customers tables. This is a
        // best-effort attribution (entity_id on the logged message), so the RPC's
        // more-robust phone normalization only improves match rate. Falls back to
        // the exact legacy whole-table scan on any error.
        let entity = null;
        try {
            const sb = window.supabase || (AppDataStore._readClient && AppDataStore._readClient());
            const [mp, mc] = await Promise.all([
                sb.rpc('import_existing_matches', { p_table: 'prospects', p_phones: [phone], p_emails: [], p_ics: [] }),
                sb.rpc('import_existing_matches', { p_table: 'customers', p_phones: [phone], p_emails: [], p_ics: [] }),
            ]);
            if (mp.error) throw mp.error;
            if (mc.error) throw mc.error;
            const p0 = (mp.data || [])[0], c0 = (mc.data || [])[0];
            if (p0) entity = { id: p0.id, _type: 'prospect' };
            else if (c0) entity = { id: c0.id, _type: 'customer' };
        } catch (e) {
            console.warn('WhatsApp entity lookup via RPC failed — full-table fallback', e);
            const allEntities = [
                ...(await AppDataStore.getAll('prospects')).map(e => ({ ...e, _type: 'prospect' })),
                ...(await AppDataStore.getAll('customers')).map(e => ({ ...e, _type: 'customer' }))
            ];
            entity = allEntities.find(e => (e.phone || '').replace(/^\+/, '').replace(/\s/g, '') === phone) || null;
        }
        await AppDataStore.create('whatsapp_messages', {
            id: wamid, entity_type: entity?._type || 'prospect', entity_id: entity?.id || null,
            direction: 'outgoing', to, content: text, status,
            sent_at: new Date().toISOString(), created_at: new Date().toISOString()
        });
    };

    // ── Attach public functions to window.app ────────────────────────────
    app.register('whatsapp', {
        showWhatsAppIntegration,
        saveWhatsAppConnection,
        testWhatsAppConnection,
        verifyWebhook,
        copyWebhookUrl,
        disconnectWhatsApp,
        confirmDisconnectWhatsApp,
        openSendWhatsAppModal,
        toggleMessageType,
        sendWhatsApp,
        renderWhatsAppHistoryTab,
        viewMessageDetails,
        resendMessage,
        replyToMessage,
        forwardMessage,
        createTaskFromMessage,
        syncWhatsAppTemplates,
        importSelectedTemplates,
        sendWhatsAppMessage,
        sendFreeTextWhatsApp,
    });
})();
