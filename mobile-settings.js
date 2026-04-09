// ========== MOBILE SETTINGS ==========

const showMobileSettings = () => {
    const biometricEnabled = typeof UserPreferences !== 'undefined' ? UserPreferences.getSync('biometric_enabled', false) : localStorage.getItem('biometric_enabled') === 'true';
    const notificationsEnabled = Notification.permission === 'granted';
    const offlineMode = typeof UserPreferences !== 'undefined' ? UserPreferences.getSync('offline_mode', false) : localStorage.getItem('offline_mode') === 'true';

    const content = `
        <div class="mobile-settings">
            <h3>Mobile Settings</h3>
            
            <div class="settings-group">
                <h4>Authentication</h4>
                
                <div class="setting-item">
                    <div class="setting-info">
                        <i class="fas fa-fingerprint"></i>
                        <div>
                            <div class="setting-label">Biometric Login</div>
                            <div class="setting-description">Use fingerprint or face recognition</div>
                        </div>
                    </div>
                    <label class="switch">
                        <input type="checkbox" id="biometric-toggle" ${biometricEnabled ? 'checked' : ''}>
                        <span class="slider"></span>
                    </label>
                </div>
                
                <div class="setting-item">
                    <div class="setting-info">
                        <i class="fas fa-clock"></i>
                        <div>
                            <div class="setting-label">Auto-lock</div>
                            <div class="setting-description">Lock app after inactivity</div>
                        </div>
                    </div>
                    <select id="auto-lock-time" class="setting-select">
                        <option value="0">Never</option>
                        <option value="1">After 1 minute</option>
                        <option value="5" selected>After 5 minutes</option>
                        <option value="15">After 15 minutes</option>
                        <option value="30">After 30 minutes</option>
                    </select>
                </div>
            </div>
            
            <div class="settings-group">
                <h4>Synchronization</h4>
                
                <div class="setting-item">
                    <div class="setting-info">
                        <i class="fas fa-wifi"></i>
                        <div>
                            <div class="setting-label">Offline Mode</div>
                            <div class="setting-description">Work without internet connection</div>
                        </div>
                    </div>
                    <label class="switch">
                        <input type="checkbox" id="offline-toggle" ${offlineMode ? 'checked' : ''}>
                        <span class="slider"></span>
                    </label>
                </div>
                
                <div class="setting-item">
                    <div class="setting-info">
                        <i class="fas fa-sync-alt"></i>
                        <div>
                            <div class="setting-label">Sync Frequency</div>
                            <div class="setting-description">How often to sync with server</div>
                        </div>
                    </div>
                    <select id="sync-frequency" class="setting-select">
                        <option value="0">Manual only</option>
                        <option value="5" selected>Every 5 minutes</option>
                        <option value="15">Every 15 minutes</option>
                        <option value="30">Every 30 minutes</option>
                        <option value="60">Every hour</option>
                    </select>
                </div>
                
                <div class="setting-item">
                    <div class="setting-info">
                        <i class="fas fa-database"></i>
                        <div>
                            <div class="setting-label">Offline Storage</div>
                            <div class="setting-description">Storage usage: 45.2 MB / 500 MB</div>
                        </div>
                    </div>
                    <button class="btn secondary small" onclick="app.clearOfflineData()">Clear Data</button>
                </div>
            </div>
            
            <div class="settings-group">
                <h4>Notifications</h4>
                
                <div class="setting-item">
                    <div class="setting-info">
                        <i class="fas fa-bell"></i>
                        <div>
                            <div class="setting-label">Push Notifications</div>
                            <div class="setting-description">Receive alerts on your device</div>
                        </div>
                    </div>
                    <label class="switch">
                        <input type="checkbox" id="notifications-toggle" ${notificationsEnabled ? 'checked' : ''}>
                        <span class="slider"></span>
                    </label>
                </div>
                
                <div class="setting-item">
                    <div class="setting-info">
                        <i class="fas fa-calendar-alt"></i>
                        <div>
                            <div class="setting-label">Appointment Reminders</div>
                            <div class="setting-description">Get notified before appointments</div>
                        </div>
                    </div>
                    <select id="reminder-time" class="setting-select">
                        <option value="5">5 minutes before</option>
                        <option value="15" selected>15 minutes before</option>
                        <option value="30">30 minutes before</option>
                        <option value="60">1 hour before</option>
                        <option value="1440">1 day before</option>
                    </select>
                </div>
                
                <div class="setting-item">
                    <div class="setting-info">
                        <i class="fas fa-comment"></i>
                        <div>
                            <div class="setting-label">Message Notifications</div>
                            <div class="setting-description">New WhatsApp and chat messages</div>
                        </div>
                    </div>
                    <label class="switch">
                        <input type="checkbox" id="message-notifications" checked>
                        <span class="slider"></span>
                    </label>
                </div>
            </div>
            
            <div class="settings-group">
                <h4>Data Usage</h4>
                
                <div class="setting-item">
                    <div class="setting-info">
                        <i class="fas fa-image"></i>
                        <div>
                            <div class="setting-label">Download Images</div>
                            <div class="setting-description">Automatically download images</div>
                        </div>
                    </div>
                    <select id="image-download" class="setting-select">
                        <option value="all" selected>All images</option>
                        <option value="wifi">Wi-Fi only</option>
                        <option value="never">Never</option>
                    </select>
                </div>
                
                <div class="setting-item">
                    <div class="setting-info">
                        <i class="fas fa-video"></i>
                        <div>
                            <div class="setting-label">Video Quality</div>
                            <div class="setting-description">Quality for recorded videos</div>
                        </div>
                    </div>
                    <select id="video-quality" class="setting-select">
                        <option value="low">Low (save data)</option>
                        <option value="medium" selected>Medium</option>
                        <option value="high">High</option>
                    </select>
                </div>
            </div>
            
            <div class="settings-actions">
                <button class="btn primary" onclick="app.saveMobileSettings()">Save Settings</button>
                <button class="btn secondary" onclick="app.resetMobileSettings()">Reset to Default</button>
            </div>
            
            <div class="app-info">
                <p>CRM Mobile App v2.0.0</p>
                <p>Last sync: ${new Date().toLocaleString()}</p>
                <button class="btn-link" onclick="app.syncNow()">Sync Now</button>
            </div>
        </div>
    `;

    UI.showModal('Mobile Settings', content, [
        { label: 'Close', type: 'secondary', action: 'UI.hideModal()' }
    ], 'fullscreen');
};

// Save mobile settings
const saveMobileSettings = async () => {
    const biometricEnabled = document.getElementById('biometric-toggle')?.checked;
    const offlineMode = document.getElementById('offline-toggle')?.checked;
    const autoLockTime = document.getElementById('auto-lock-time')?.value;
    const syncFrequency = document.getElementById('sync-frequency')?.value;
    const notificationsEnabled = document.getElementById('notifications-toggle')?.checked;

    if (typeof UserPreferences !== 'undefined') {
        await UserPreferences.save('biometric_enabled', !!biometricEnabled);
        await UserPreferences.save('offline_mode', !!offlineMode);
        await UserPreferences.save('auto_lock_time', parseInt(autoLockTime) || 5);
        await UserPreferences.save('sync_frequency', parseInt(syncFrequency) || 15);
    } else {
        localStorage.setItem('biometric_enabled', biometricEnabled);
        localStorage.setItem('offline_mode', offlineMode);
        localStorage.setItem('auto_lock_time', autoLockTime);
        localStorage.setItem('sync_frequency', syncFrequency);
    }

    if (notificationsEnabled && Notification.permission !== 'granted') {
        requestNotificationPermission();
    }

    UI.toast.success('Settings saved');
    UI.hideModal();
};

// Clear offline data
const clearOfflineData = async () => {
    UI.showModal('Clear Offline Data', `
        <p>This will remove all locally stored data.</p>
        <p>You will need to sync again when back online.</p>
        <p><strong>Are you sure?</strong></p>
    `, [
        { label: 'Cancel', type: 'secondary', action: 'UI.hideModal()' },
        { label: 'Clear Data', type: 'error', action: 'app.confirmClearOfflineData()' }
    ]);
};

const confirmClearOfflineData = async () => {
    UI.hideModal();

    // Clear IndexedDB stores
    const stores = ['prospects', 'customers', 'activities', 'transactions', 'sync_queue'];

    for (const store of stores) {
        await OfflineDataStore.clear(store);
    }

    UI.toast.success('Offline data cleared');
};

// Manual sync
const syncNow = async () => {
    UI.toast.info('Syncing data...');

    const results = await SyncManager.sync();

    if (results.success.length > 0) {
        UI.toast.success(`Synced ${results.success.length} items`);
    }

    if (results.failed.length > 0) {
        UI.toast.error(`Failed to sync ${results.failed.length} items`);
    }

    if (results.success.length === 0 && results.failed.length === 0) {
        UI.toast.info('All data is up to date');
    }
};
