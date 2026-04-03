// ========== TWO-FACTOR AUTHENTICATION ==========

// 2FA methods
const TwoFactorMethod = {
    TOTP: 'totp', // Time-based One-Time Password (Google Authenticator)
    SMS: 'sms',
    EMAIL: 'email',
    BIOMETRIC: 'biometric'
};

// TOTP Manager
const TOTPManager = {
    // Generate secret for TOTP
    generateSecret: () => {
        const secret = Encryption.generateToken(20);
        return {
            secret: secret,
            qrCode: `otpauth://totp/CRM:${window._currentUser?.email || window._currentUser?.username}?secret=${secret}&issuer=CRM&period=30`
        };
    },

    // Verify TOTP code
    verifyTOTP: (secret, token) => {
        // TOTP verification algorithm
        // For demo, we'll accept any 6-digit code
        return /^\d{6}$/.test(token);
    },

    // Enable TOTP for user
    enableTOTP: async (userId, secret) => {
        const user = AppDataStore.getById('users', userId);
        if (!user) return false;

        // Encrypt and store secret
        const encryptedSecret = await Encryption.encryptField(secret, await getEncryptionKey());

        user.mfa_secret = encryptedSecret;
        user.mfa_enabled = true;
        user.mfa_method = TwoFactorMethod.TOTP;
        user.mfa_enabled_at = new Date().toISOString();

        AppDataStore.update('users', userId, user);

        // Generate backup codes
        const backupCodes = TOTPManager.generateBackupCodes();
        user.mfa_backup_codes = backupCodes;
        AppDataStore.update('users', userId, user);

        AuditLogger.info(
            AuditCategory.SECURITY,
            AuditAction.MFA_ENABLE,
            {
                user_id: userId,
                method: TwoFactorMethod.TOTP
            }
        );

        return { success: true, backupCodes };
    },

    // Generate backup codes
    generateBackupCodes: (count = 10) => {
        const codes = [];
        for (let i = 0; i < count; i++) {
            codes.push(Encryption.generateToken(8).toUpperCase());
        }
        return codes;
    },

    // Disable MFA
    disableMFA: (userId) => {
        const user = AppDataStore.getById('users', userId);
        if (!user) return false;

        user.mfa_enabled = false;
        user.mfa_secret = null;
        user.mfa_backup_codes = null;

        AppDataStore.update('users', userId, user);

        AuditLogger.warn(
            AuditCategory.SECURITY,
            AuditAction.MFA_DISABLE,
            {
                user_id: userId
            }
        );

        return true;
    }
};

// SMS 2FA
const SMS2FAManager = {
    // Send verification code via SMS
    sendCode: async (phoneNumber) => {
        const code = Math.floor(100000 + Math.random() * 900000).toString();

        // Store code temporarily
        sessionStorage.setItem('mfa_code', code);
        sessionStorage.setItem('mfa_code_expires', Date.now() + 5 * 60 * 1000); // 5 minutes

        // In production, send via SMS gateway
        console.log(`SMS code to ${phoneNumber}: ${code}`);

        // For demo, show in UI
        if (window.UI && window.UI.toast) {
            UI.toast.info(`Your verification code is: ${code}`);
        }

        return true;
    },

    // Verify code
    verifyCode: (code) => {
        const storedCode = sessionStorage.getItem('mfa_code');
        const expires = sessionStorage.getItem('mfa_code_expires');

        if (!storedCode || !expires) return false;

        if (Date.now() > parseInt(expires)) {
            sessionStorage.removeItem('mfa_code');
            sessionStorage.removeItem('mfa_code_expires');
            return false;
        }

        return code === storedCode;
    }
};

// 2FA UI Component
const showTwoFactorSetup = () => {
    const secret = TOTPManager.generateSecret();

    const content = `
        <div class="two-factor-setup">
            <h3>Set Up Two-Factor Authentication</h3>
            
            <div class="setup-steps">
                <div class="step">
                    <div class="step-number">1</div>
                    <div class="step-content">
                        <h4>Install Authenticator App</h4>
                        <p>Download Google Authenticator or any TOTP-compatible app</p>
                    </div>
                </div>
                
                <div class="step">
                    <div class="step-number">2</div>
                    <div class="step-content">
                        <h4>Scan QR Code</h4>
                        <div class="qr-code">
                            <img src="https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(secret.qrCode)}" 
                                 alt="QR Code">
                        </div>
                        <p>Or enter this key manually: <code>${secret.secret}</code></p>
                    </div>
                </div>
                
                <div class="step">
                    <div class="step-number">3</div>
                    <div class="step-content">
                        <h4>Verify Code</h4>
                        <input type="text" id="verification-code" placeholder="Enter 6-digit code" maxlength="6">
                        <button class="btn primary" onclick="app.verifyAndEnable2FA('${secret.secret}')">Verify & Enable</button>
                    </div>
                </div>
            </div>
            
            <div class="backup-codes" style="display: none;">
                <h4>Backup Codes</h4>
                <p>Save these codes in a safe place. They can be used to access your account if you lose your device.</p>
                <div class="codes-list" id="backup-codes-list"></div>
            </div>
        </div>
    `;

    UI.showModal('Set Up Two-Factor Authentication', content, [
        { label: 'Cancel', type: 'secondary', action: 'UI.hideModal()' }
    ]);
};

const verifyAndEnable2FA = async (secret) => {
    const code = document.getElementById('verification-code').value;

    if (!TOTPManager.verifyTOTP(secret, code)) {
        if (window.UI && window.UI.toast) UI.toast.error('Invalid verification code');
        return;
    }

    const result = await TOTPManager.enableTOTP(window._currentUser.id, secret);

    if (result.success) {
        // Show backup codes
        const backupCodesDiv = document.querySelector('.backup-codes');
        const codesList = document.getElementById('backup-codes-list');

        codesList.innerHTML = result.backupCodes.map(code =>
            `<div class="backup-code">${code}</div>`
        ).join('');

        backupCodesDiv.style.display = 'block';

        if (window.UI && window.UI.toast) UI.toast.success('Two-factor authentication enabled');

        // Add download button
        const downloadBtn = document.createElement('button');
        downloadBtn.className = 'btn secondary';
        downloadBtn.innerHTML = 'Download Backup Codes';
        downloadBtn.onclick = () => downloadBackupCodes(result.backupCodes);
        backupCodesDiv.appendChild(downloadBtn);
    }
};

const downloadBackupCodes = (codes) => {
    const content = codes.join('\n');
    const blob = new Blob([content], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `crm-backup-codes-${new Date().toISOString().split('T')[0]}.txt`;
    a.click();
    URL.revokeObjectURL(url);
};

// 2FA Login Screen
const showTwoFactorLogin = (username, password) => {
    const content = `
        <div class="two-factor-login">
            <h3>Two-Factor Authentication</h3>
            <p>Enter the verification code from your authenticator app</p>
            
            <div class="form-group">
                <input type="text" id="2fa-code" placeholder="6-digit code" maxlength="6" autofocus>
            </div>
            
            <div class="form-actions">
                <button class="btn primary" onclick="app.verifyTwoFactorLogin('${username}', '${password}')">Verify</button>
            </div>
            
            <div class="backup-option">
                <a href="#" onclick="app.showBackupCodeLogin()">Use backup code instead</a>
            </div>
        </div>
    `;

    UI.showModal('Two-Factor Authentication', content, [
        { label: 'Cancel', type: 'secondary', action: 'UI.hideModal()' }
    ]);
};

// Used in login verification
const verifyTwoFactorLogin = async (username, password) => {
    const code = document.getElementById('2fa-code').value;

    // In production, verify with server endpoint.
    // Since we're client-side, check user mock data.
    const user = AppDataStore.getAll('users').find(u => u.username === username);

    if (user && TOTPManager.verifyTOTP("dummy_secret_for_demo", code)) {
        UI.hideModal();
        Auth.setToken(Encryption.generateToken());
        Auth.setUser(user);
        window.location.href = '#dashboard';
    } else {
        if (window.UI && window.UI.toast) UI.toast.error('Invalid verification code');
    }
};
