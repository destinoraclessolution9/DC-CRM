// ========== BIOMETRIC AUTHENTICATION ==========

// Check if biometric auth is supported
const isBiometricSupported = () => {
    return window.PublicKeyCredential &&
        PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable &&
        PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
};

// Check if device has biometric hardware
const hasBiometricHardware = async () => {
    if (!isBiometricSupported()) return false;

    try {
        const available = await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
        return available;
    } catch (error) {
        console.error('Error checking biometric hardware:', error);
        return false;
    }
};

// Register biometric credential
const registerBiometric = async (username, userId) => {
    if (!await hasBiometricHardware()) {
        UI.toast.error('Biometric authentication not available on this device');
        return null;
    }

    try {
        // Get challenge from server
        const challengeResponse = await fetch('/api/auth/biometric/register/challenge', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${Auth.getToken()}`
            },
            body: JSON.stringify({ username, userId })
        });

        const options = await challengeResponse.json();

        // Convert base64 to ArrayBuffer
        options.challenge = base64ToArrayBuffer(options.challenge);
        options.user.id = base64ToArrayBuffer(options.user.id);

        // Create credential
        const credential = await navigator.credentials.create({
            publicKey: options
        });

        // Send credential to server
        const registrationResponse = await fetch('/api/auth/biometric/register', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${Auth.getToken()}`
            },
            body: JSON.stringify({
                id: credential.id,
                rawId: arrayBufferToBase64(credential.rawId),
                type: credential.type,
                response: {
                    attestationObject: arrayBufferToBase64(credential.response.attestationObject),
                    clientDataJSON: arrayBufferToBase64(credential.response.clientDataJSON)
                }
            })
        });

        const result = await registrationResponse.json();

        if (result.success) {
            UI.toast.success('Biometric authentication enabled');
            localStorage.setItem('biometric_enabled', 'true');
            return result;
        } else {
            throw new Error(result.error);
        }
    } catch (error) {
        console.error('Error registering biometric:', error);
        UI.toast.error('Failed to register biometric authentication');
        return null;
    }
};

// Authenticate with biometric
const authenticateWithBiometric = async () => {
    if (!await hasBiometricHardware()) {
        return false;
    }

    try {
        // Get challenge from server
        const challengeResponse = await fetch('/api/auth/biometric/authenticate/challenge', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ username: localStorage.getItem('last_username') })
        });

        const options = await challengeResponse.json();

        // Convert base64 to ArrayBuffer
        options.challenge = base64ToArrayBuffer(options.challenge);
        options.allowCredentials.forEach(cred => {
            cred.id = base64ToArrayBuffer(cred.id);
        });

        // Get credential assertion
        const assertion = await navigator.credentials.get({
            publicKey: options
        });

        // Send assertion to server
        const authResponse = await fetch('/api/auth/biometric/authenticate', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                id: assertion.id,
                rawId: arrayBufferToBase64(assertion.rawId),
                type: assertion.type,
                response: {
                    authenticatorData: arrayBufferToBase64(assertion.response.authenticatorData),
                    clientDataJSON: arrayBufferToBase64(assertion.response.clientDataJSON),
                    signature: arrayBufferToBase64(assertion.response.signature),
                    userHandle: assertion.response.userHandle ? arrayBufferToBase64(assertion.response.userHandle) : null
                }
            })
        });

        const result = await authResponse.json();

        if (result.success) {
            Auth.setToken(result.token);
            Auth.setUser(result.user);
            return true;
        } else {
            throw new Error(result.error);
        }
    } catch (error) {
        console.error('Biometric authentication failed:', error);
        return false;
    }
};

// Helper functions for ArrayBuffer conversion
const base64ToArrayBuffer = (base64) => {
    const binaryString = window.atob(base64);
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
        bytes[i] = binaryString.charCodeAt(i);
    }
    return bytes.buffer;
};

const arrayBufferToBase64 = (buffer) => {
    let binary = '';
    const bytes = new Uint8Array(buffer);
    const len = bytes.byteLength;
    for (let i = 0; i < len; i++) {
        binary += String.fromCharCode(bytes[i]);
    }
    return window.btoa(binary);
};

// Show biometric login option
const showBiometricLogin = () => {
    if (!localStorage.getItem('biometric_enabled')) return null;

    const button = document.createElement('button');
    button.className = 'biometric-login-btn';
    button.innerHTML = '<i class="fas fa-fingerprint"></i> Login with Biometric';

    button.addEventListener('click', async () => {
        button.disabled = true;
        button.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Authenticating...';

        const success = await authenticateWithBiometric();

        if (success) {
            UI.toast.success('Login successful');
            window.location.href = '#dashboard';
        } else {
            UI.toast.error('Biometric authentication failed');
            button.disabled = false;
            button.innerHTML = '<i class="fas fa-fingerprint"></i> Login with Biometric';
        }
    });

    return button;
};
