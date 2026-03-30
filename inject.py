const fs = require('fs');
const path = require('path');

const scriptPath = path.join(__dirname, 'script.js');
let scriptContent = fs.readFileSync(scriptPath, 'utf8');

const whatsappJS = `
// ========== WHATSAPP BUSINESS INTEGRATION FUNCTIONS ==========

let _whatsappService = null;

// Initialize WhatsApp service
const initWhatsAppIntegration = () => {
    _whatsappService = {
        sendMessage: sendWhatsApp,
        sendFreeText: sendWhatsApp,
        syncTemplates: syncWhatsAppTemplates
    };
};

// Get WhatsApp connection
const getWhatsAppConnection = () => {
    const integrations = DataStore.getAll('integrations');
    const whatsappIntegration = integrations.find(i => i.provider === 'whatsapp');
    
    if (!whatsappIntegration) return null;
    
    const connections = DataStore.query('integration_connections', {
        integration_id: whatsappIntegration.id,
        user_id: _currentUser?.id || 1
    });
    
    return connections.length > 0 ? connections[0] : null;
};

// Show WhatsApp integration settings
const showWhatsAppIntegration = () => {
    const connection = getWhatsAppConnection();
    const isConnected = connection && connection.status === 'connected';
    
    const content = \`
        <div class="whatsapp-integration">
            <div class="detail-header" style="margin-bottom: 24px; display: flex; align-items: center; gap: 16px;">
                <button class="btn secondary" onclick="app.showIntegrationHub(document.getElementById('content-viewport'))">
                    <i class="fas fa-arrow-left"></i> Back to Integrations
                </button>
                <h1 style="margin: 0; font-size: 24px;">WhatsApp Business Integration</h1>
            </div>

            <div class="connection-status \${isConnected ? 'connected' : 'disconnected'}">
                <div class="status-indicator \${isConnected ? 'connected' : 'disconnected'}"></div>
                <div class="status-text">
                    <h3>\${isConnected ? 'Connected' : 'Disconnected'}</h3>
                    \${isConnected ? \`
                        <p>Connected as: \${connection.business_phone || '+65 9123 4567'}</p>
                        <p>Last Sync: \${connection.last_sync ? new Date(connection.last_sync).toLocaleString() : 'Never'}</p>
                    \` : \`
                        <p>Connect your WhatsApp Business account to send messages and track conversations.</p>
                    \`}
                </div>
            </div>
            
            <div class="connection-form" style="margin-top: 24px; background: var(--white); padding: 24px; border-radius: 8px; box-shadow: var(--shadow-md);">
                <h3>Connection Details</h3>
                
                <div class="form-group">
                    <label>WhatsApp Business Account ID</label>
                    <input type="text" id="waba-id" class="form-control" value="\${connection?.business_account_id || ''}" placeholder="123456789012345">
                </div>
                
                <div class="form-group">
                    <label>Phone Number ID</label>
                    <input type="text" id="phone-id" class="form-control" value="\${connection?.phone_number_id || ''}" placeholder="123456789012345">
                </div>
                
                <div class="form-group">
                    <label>Business Phone Number</label>
                    <input type="text" id="business-phone" class="form-control" value="\${connection?.business_phone || '+65 9123 4567'}" placeholder="+65 9123 4567">
                </div>
                
                <div class="form-group">
                    <label>Access Token</label>
                    <div class="token-input">
                        <input type="password" id="access-token" class="form-control" value="\${connection?.access_token ? '••••••••' : ''}" placeholder="Enter access token">
                        <button class="btn secondary" onclick="app.testWhatsAppConnection()">Test Connection</button>
                    </div>
                </div>
                
                <h3 style="margin-top: 24px;">Webhook Configuration</h3>
                
                <div class="form-group">
                    <label>Webhook URL</label>
                    <div class="webhook-url">
                        <input type="text" id="webhook-url" class="form-control" value="https://your-crm.com/api/whatsapp/webhook" readonly>
                        <button class="btn-icon" onclick="app.copyWebhookUrl()" title="Copy"><i class="fas fa-copy"></i></button>
                    </div>
                </div>
                
                <div class="form-group">
                    <label>Verification Token</label>
                    <div class="token-input">
                        <input type="password" id="verify-token" class="form-control" value="\${connection?.verify_token || ''}" placeholder="Enter verification token">
                        <button class="btn secondary" onclick="app.verifyWebhook()">Verify</button>
                    </div>
                </div>
                
                <div class="webhook-status">
                    <span class="status-indicator \${connection?.webhook_verified ? 'connected' : 'disconnected'}"></span>
                    <span>\${connection?.webhook_verified ? 'Active - Last ping: 2 minutes ago' : 'Not verified'}</span>
                </div>
            </div>
            
            <div class="form-actions">
                <button class="btn primary" onclick="app.saveWhatsAppConnection()">Save Connection</button>
                \${isConnected ? \`
                    <button class="btn secondary" onclick="app.testWhatsAppConnection()">Test Connection</button>
                    <button class="btn error" onclick="app.disconnectWhatsApp()">Disconnect</button>
                \` : ''}
            </div>
        </div>
    \`;
    const viewport = document.getElementById('content-viewport');
    if (viewport) {
        viewport.innerHTML = content;
    } else {
        UI.showModal('WhatsApp Business Integration', content, [
            { label: 'Close', type: 'secondary', action: 'UI.hideModal()' }
        ]);
    }
};

// Save WhatsApp connection
const saveWhatsAppConnection = () => {
    const businessAccountId = document.getElementById('waba-id')?.value;
    const phoneNumberId = document.getElementById('phone-id')?.value;
    const businessPhone = document.getElementById('business-phone')?.value;
    const accessToken = document.getElementById('access-token')?.value;
    const verifyToken = document.getElementById('verify-token')?.value;
    
    if (!businessAccountId || !phoneNumberId || !businessPhone || !accessToken) {
        UI.toast.error('Please fill in all required fields');
        return;
    }
    
    let integration = DataStore.getAll('integrations').find(i => i.provider === 'whatsapp');
    if (!integration) {
        integration = DataStore.create('integrations', {
            integration_name: 'WhatsApp Business',
            provider: 'whatsapp',
            type: 'messaging',
            is_active: true,
            config_schema: {},
            created_at: new Date().toISOString()
        });
    }
    
    const existingConnection = getWhatsAppConnection();
    const connectionData = {
        integration_id: integration.id,
        user_id: _currentUser?.id || 1,
        business_account_id: businessAccountId,
        phone_number_id: phoneNumberId,
        business_phone: businessPhone,
        access_token: accessToken,
        verify_token: verifyToken,
        status: 'connected',
        updated_at: new Date().toISOString()
    };
    
    if (existingConnection) {
        DataStore.update('integration_connections', existingConnection.id, connectionData);
    } else {
        DataStore.create('integration_connections', {
            ...connectionData,
            created_at: new Date().toISOString()
        });
    }
    
    UI.hideModal();
    UI.toast.success('WhatsApp connection saved');
    showWhatsAppIntegration();
};

const testWhatsAppConnection = async () => {
    UI.toast.info('Testing connection...');
    setTimeout(() => {
        UI.toast.success('Connection successful!');
    }, 1500);
};

const verifyWebhook = () => {
    UI.toast.success('Webhook verified successfully');
    const connection = getWhatsAppConnection();
    if (connection) {
        DataStore.update('integration_connections', connection.id, {
            webhook_verified: true,
            updated_at: new Date().toISOString()
        });
    }
};

const copyWebhookUrl = () => {
    const url = document.getElementById('webhook-url');
    url.select();
    document.execCommand('copy');
    UI.toast.success('Webhook URL copied to clipboard');
};

const disconnectWhatsApp = () => {
    UI.showModal('Disconnect WhatsApp', \`
        <p>Are you sure you want to disconnect WhatsApp Business?</p>
        <p>This will stop all messaging and template sync.</p>
    \`, [
        { label: 'Cancel', type: 'secondary', action: 'UI.hideModal()' },
        { label: 'Disconnect', type: 'error', action: 'app.confirmDisconnectWhatsApp()' }
    ]);
};

const confirmDisconnectWhatsApp = () => {
    const connection = getWhatsAppConnection();
    if (connection) {
        DataStore.update('integration_connections', connection.id, {
            status: 'disconnected',
            updated_at: new Date().toISOString()
        });
    }
    UI.hideModal();
    UI.toast.success('WhatsApp disconnected');
    showWhatsAppIntegration();
};

const openSendWhatsAppModal = (entityType, entityId) => {
    const entity = entityType === 'prospect' 
        ? DataStore.getById('prospects', entityId)
        : DataStore.getById('customers', entityId);
    if (!entity) return;
    
    // Create demo templates if empty
    let templates = DataStore.getAll('whatsapp_templates');
    if (templates.length === 0) {
        templates = [
            DataStore.create('whatsapp_templates', { template_name: 'Birthday Greeting', status: 'APPROVED', content: 'Hi {{1}}, wishing you a very happy birthday!' }),
            DataStore.create('whatsapp_templates', { template_name: 'Appointment Reminder', status: 'APPROVED', content: 'Hi {{1}}, your appointment is confirmed.' })
        ];
    }
    
    const content = \`
        <div class="send-whatsapp-modal">
            <div class="message-type">
                <label class="radio-label">
                    <input type="radio" name="msg-type" value="template" checked onchange="app.toggleMessageType()"> Use Template
                </label>
                <label class="radio-label">
                    <input type="radio" name="msg-type" value="free" onchange="app.toggleMessageType()"> Free Text
                </label>
            </div>
            
            <div id="template-section">
                <div class="form-group">
                    <label>Template</label>
                    <select id="template-select" class="form-control" onchange="app.previewTemplate()">
                        <option value="">Select a template</option>
                        \${templates.map(t => \`<option value="\${t.id}">\${t.template_name}</option>\`).join('')}
                    </select>
                </div>
            </div>
            
            <div id="free-text-section" style="display: none;">
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
    \`;
    UI.showModal('Send WhatsApp Message to ' + entity.full_name, content, [
        { label: 'Cancel', type: 'secondary', action: 'UI.hideModal()' },
        { label: 'Send', type: 'primary', action: \`app.sendWhatsApp('\${entityType}', \${entityId})\` }
    ]);
    window._currentWhatsAppEntity = { type: entityType, id: entityId, phone: entity.phone };
};

const toggleMessageType = () => {
    const isTemplate = document.querySelector('input[name="msg-type"]:checked')?.value === 'template';
    document.getElementById('template-section').style.display = isTemplate ? 'block' : 'none';
    document.getElementById('free-text-section').style.display = isTemplate ? 'none' : 'block';
};

const sendWhatsApp = (entityType, entityId) => {
    const isTemplate = document.querySelector('input[name="msg-type"]:checked')?.value === 'template';
    const isNow = document.querySelector('input[name="schedule"]:checked')?.value === 'now';
    
    if (isTemplate) {
        const templateId = document.getElementById('template-select')?.value;
        if (!templateId) { UI.toast.error('Please select a template'); return; }
        const template = DataStore.getById('whatsapp_templates', parseInt(templateId));
        setTimeout(() => {
            DataStore.create('whatsapp_messages', {
                id: 'wamid_' + Date.now(),
                entity_type: entityType,
                entity_id: entityId,
                direction: 'outgoing',
                to: window._currentWhatsAppEntity.phone,
                template_name: template.template_name,
                content: template.content,
                status: 'delivered',
                sent_at: new Date().toISOString()
            });
            UI.hideModal();
            UI.toast.success('Message sent successfully');
            if (entityType === 'prospect') app.showProspectDetail(entityId);
            else app.showCustomerDetail(entityId);
        }, 800);
    } else {
        const message = document.getElementById('free-message')?.value;
        if (!message) { UI.toast.error('Please enter a message'); return; }
        setTimeout(() => {
            DataStore.create('whatsapp_messages', {
                id: 'wamid_' + Date.now(),
                entity_type: entityType,
                entity_id: entityId,
                direction: 'outgoing',
                to: window._currentWhatsAppEntity.phone,
                content: message,
                status: 'delivered',
                sent_at: new Date().toISOString()
            });
            UI.hideModal();
            UI.toast.success('Message sent successfully');
            if (entityType === 'prospect') app.showProspectDetail(entityId);
            else app.showCustomerDetail(entityId);
        }, 800);
    }
};

const renderWhatsAppHistoryTab = (entityType, entityId) => {
    const messages = DataStore.getAll('whatsapp_messages')
        .filter(m => m.entity_type === entityType && m.entity_id == entityId)
        .sort((a, b) => new Date(b.sent_at || b.created_at) - new Date(a.sent_at || a.created_at));
    
    if (messages.length === 0) {
        return \`
            <div class="empty-history" style="text-align:center; padding: 40px; color: var(--gray-500);">
                <i class="fab fa-whatsapp" style="font-size: 48px; color: #25D366; margin-bottom: 16px;"></i>
                <h3>No WhatsApp messages yet</h3>
                <p>Click the WhatsApp button to send your first message</p>
            </div>
        \`;
    }
    
    return \`
        <div class="whatsapp-history" style="display:flex; flex-direction:column; gap:16px;">
            \${messages.map(msg => \`
                <div class="message-item \${msg.direction}">
                    <div class="message-header" style="display:flex; justify-content:space-between; margin-bottom:8px; font-size:12px; color:var(--gray-600);">
                        <span>\${msg.direction === 'outgoing' ? '📤 Outgoing' : '📥 Incoming'} · \${new Date(msg.sent_at || msg.created_at).toLocaleString()}</span>
                        \${msg.template_name ? \`<span class="template-badge">\${msg.template_name}</span>\` : ''}
                    </div>
                    <div class="message-content" style="font-size:14px; margin-bottom: 8px;">
                        \${msg.content || msg.template_name + ' template message'}
                    </div>
                    <div class="message-footer" style="display:flex; justify-content:space-between; align-items:center; font-size:11px;">
                        <span class="message-status status-\${msg.status}">
                            \${msg.status === 'sent' ? '✓ Sent' : msg.status === 'delivered' ? '✓✓ Delivered' : msg.status === 'read' ? '👁️ Read' : '❌ Failed'}
                        </span>
                        <div class="message-actions">
                            <button class="btn-icon" onclick="app.viewMessageDetails('\${msg.id}')"><i class="fas fa-eye"></i></button>
                            <button class="btn-icon" onclick="app.todo('Resend Message')"><i class="fas fa-redo"></i></button>
                        </div>
                    </div>
                </div>
            \`).join('')}
        </div>
    \`;
};

const addWhatsAppButtonToProfile = (entityType, entityId) => {
    const headers = document.querySelectorAll('.header-actions');
    headers.forEach(header => {
        // Prevent duplicate buttons
        if (!header.querySelector('.btn-whatsapp-add')) {
            const button = document.createElement('button');
            button.className = 'btn secondary btn-whatsapp-add';
            button.innerHTML = '<i class="fab fa-whatsapp" style="color:#25D366;"></i> WhatsApp';
            button.onclick = () => openSendWhatsAppModal(entityType, entityId);
            header.insertBefore(button, header.lastElementChild);
        }
    });
};

const viewMessageDetails = (messageId) => {
    const message = DataStore.getAll('whatsapp_messages').find(m => m.id === messageId);
    if (!message) return;
    const content = \`
        <div class="message-details">
            <div class="message-metadata" style="background:var(--gray-50); padding:16px; border-radius:8px; margin-bottom:16px;">
                <div><strong>To:</strong> \${message.to || ''}</div>
                <div><strong>Direction:</strong> \${message.direction}</div>
                <div><strong>Message ID:</strong> \${message.id}</div>
                <div><strong>Sent:</strong> \${new Date(message.sent_at || message.created_at).toLocaleString()}</div>
            </div>
            <div class="message-bubble-large" style="background:#e5ddd5; padding:20px; border-radius:12px; margin-bottom:16px;">
                \${message.content || message.template_name}
            </div>
        </div>
    \`;
    UI.showModal('Message Details', content, [
        { label: 'Close', type: 'secondary', action: 'UI.hideModal()' }
    ]);
};

// Mock functions for missing references
const previewTemplate = () => {};
const resendMessage = () => {};
const replyToMessage = () => {};
const forwardMessage = () => {};
const createTaskFromMessage = () => {};
const syncWhatsAppTemplates = () => { UI.toast.success('Templates synced'); };
const importSelectedTemplates = () => {};
`;

// Insert WhatsApp functions before // ==================== INIT ====================
if (!scriptContent.includes('// ========== WHATSAPP BUSINESS INTEGRATION FUNCTIONS ==========')) {
    scriptContent = scriptContent.replace(
        '// ==================== INIT ====================',
        whatsappJS + '\n\n    // ==================== INIT ===================='
    );
}

// Update init calls to include initWhatsAppIntegration()
if (!scriptContent.includes('initWhatsAppIntegration();')) {
    scriptContent = scriptContent.replace(
        'initGoogleIntegration();',
        'initGoogleIntegration();\n            initWhatsAppIntegration();'
    );
}

// Ensure the WA button is added on prospect load
if (!scriptContent.includes('addWhatsAppButtonToProfile(')) {
    // Add inside showProspectDetail
    scriptContent = scriptContent.replace(
        '// Setup event listeners for tabs',
        'setTimeout(() => { addWhatsAppButtonToProfile(\\\'prospect\\\', prospectId); }, 100);\n        // Setup event listeners for tabs'
    );
    scriptContent = scriptContent.replace(
        '// Populate data into active tab',
        'setTimeout(() => { addWhatsAppButtonToProfile(\\\'customer\\\', customerId); }, 100);\n        // Populate data into active tab'
    );
}

// Update integration hub buttons string replace
if (!scriptContent.includes('app.showWhatsAppIntegration()')) {
    scriptContent = scriptContent.replace(
        /\`\\s*<button class="btn \$\{status === 'connected' \? 'secondary' : 'primary'\}" onclick="event\\.stopPropagation\(\); app\\.showIntegrationDetails\\('\$\{id\}'\\)">\\s*\$\{status === 'connected' \? 'Configure' : 'Connect'\}\\s*<\/button>\\s*\`/g,
        \`\\n            <button class="btn \${status === 'connected' ? 'secondary' : 'primary'}" onclick="event.stopPropagation(); id === 'whatsapp' ? app.showWhatsAppIntegration() : app.showIntegrationDetails('\${id}')">
                \${status === 'connected' ? 'Configure' : 'Connect'}
            </button>\\n\`
    );
}

// Update history tab to include WhatsApp history in prospect Details (and customer details)
// We need to inject the Whatsapp history tab logic or assume the user has a "History" tab that we don't modify but just render it properly. Let's just expose the methods inside return statement

const exportsToAdd = \`
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
        viewMessageDetails,
        resendMessage,
        replyToMessage,
        forwardMessage,
        createTaskFromMessage,
        syncWhatsAppTemplates,
        importSelectedTemplates,
        renderWhatsAppHistoryTab,
        addWhatsAppButtonToProfile,
        previewTemplate,
\`;

if (!scriptContent.includes('showWhatsAppIntegration,')) {
    scriptContent = scriptContent.replace(
        '    return {',
        '    return {\n' + exportsToAdd
    );
}

fs.writeFileSync(scriptPath, scriptContent);


const stylesPath = path.join(__dirname, 'styles.css');
let stylesContent = fs.readFileSync(stylesPath, 'utf8');

const whatsappCSS = \`
/* Phase 16: WhatsApp Integration Styles */

.whatsapp-integration {
    max-width: 800px;
    margin: 0 auto;
}

.token-input {
    display: flex;
    gap: 8px;
}

.token-input input {
    flex: 1;
}

.webhook-url {
    display: flex;
    gap: 4px;
}

.webhook-url input {
    flex: 1;
    background: var(--gray-100);
}

.webhook-status {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-top: 8px;
    padding: 8px;
    background: var(--gray-50);
    border-radius: 6px;
}

.webhook-status .status-indicator {
    width: 12px;
    height: 12px;
    border-radius: 50%;
}

.webhook-status .status-indicator.connected {
    background: var(--success);
    box-shadow: 0 0 0 2px rgba(16, 185, 129, 0.2);
}

.webhook-status .status-indicator.disconnected {
    background: var(--gray-300);
}

.form-actions {
    display: flex;
    gap: 12px;
    margin-top: 24px;
    padding-top: 16px;
    border-top: 1px solid var(--gray-200);
}

/* Send WhatsApp Modal */
.send-whatsapp-modal {
    min-width: 500px;
}

.message-type {
    display: flex;
    gap: 16px;
    margin: 16px 0;
    padding: 12px;
    background: var(--gray-50);
    border-radius: 8px;
}

.schedule-options {
    display: flex;
    gap: 16px;
    margin: 16px 0;
}

/* WhatsApp History */
.message-item {
    padding: 16px;
    border-radius: 12px;
    border-left: 4px solid;
    transition: all 0.2s;
}

.message-item.outgoing {
    background: #dcfce7;
    border-left-color: #10b981;
}

.message-item.incoming {
    background: #dbeafe;
    border-left-color: #3b82f6;
}

.template-badge {
    background: var(--gray-200);
    padding: 2px 8px;
    border-radius: 20px;
    font-size: 10px;
    font-weight: 600;
}

.message-status {
    display: flex;
    align-items: center;
    gap: 4px;
}

.message-status.status-sent {
    color: var(--gray-500);
}

.message-status.status-delivered {
    color: var(--primary);
}

.message-status.status-read {
    color: var(--success);
}

.message-status.status-failed {
    color: var(--error);
}

.btn.whatsapp {
    background: #25D366;
    color: white;
}

.btn.whatsapp:hover {
    background: #128C7E;
}
\`;

if (!stylesContent.includes('.whatsapp-integration {')) {
    stylesContent += '\\n' + whatsappCSS;
    fs.writeFileSync(stylesPath, stylesContent);
}

console.log('Injection complete');
