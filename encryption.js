// ========== ENCRYPTION MODULE ==========

// Using Web Crypto API for encryption
const Encryption = {
    // Generate encryption key
    generateKey: async () => {
        try {
            const key = await window.crypto.subtle.generateKey(
                {
                    name: "AES-GCM",
                    length: 256
                },
                true,
                ["encrypt", "decrypt"]
            );

            // Export key for storage
            const exportedKey = await window.crypto.subtle.exportKey("raw", key);
            return {
                key,
                exportedKey: arrayBufferToBase64(exportedKey)
            };
        } catch (error) {
            console.error('Error generating key:', error);
            throw error;
        }
    },

    // Import key from stored format
    importKey: async (base64Key) => {
        try {
            const keyData = base64ToArrayBuffer(base64Key);
            const key = await window.crypto.subtle.importKey(
                "raw",
                keyData,
                {
                    name: "AES-GCM",
                    length: 256
                },
                true,
                ["encrypt", "decrypt"]
            );
            return key;
        } catch (error) {
            console.error('Error importing key:', error);
            throw error;
        }
    },

    // Encrypt data
    encrypt: async (data, key) => {
        try {
            // Generate random IV
            const iv = window.crypto.getRandomValues(new Uint8Array(12));

            // Convert data to buffer
            const encoder = new TextEncoder();
            const dataBuffer = encoder.encode(JSON.stringify(data));

            // Encrypt
            const encryptedBuffer = await window.crypto.subtle.encrypt(
                {
                    name: "AES-GCM",
                    iv: iv
                },
                key,
                dataBuffer
            );

            // Combine IV and encrypted data
            const result = new Uint8Array(iv.length + encryptedBuffer.byteLength);
            result.set(iv, 0);
            result.set(new Uint8Array(encryptedBuffer), iv.length);

            return arrayBufferToBase64(result.buffer);
        } catch (error) {
            console.error('Error encrypting:', error);
            throw error;
        }
    },

    // Decrypt data
    decrypt: async (encryptedBase64, key) => {
        try {
            // Convert from base64
            const encryptedData = base64ToArrayBuffer(encryptedBase64);
            const encryptedArray = new Uint8Array(encryptedData);

            // Extract IV (first 12 bytes)
            const iv = encryptedArray.slice(0, 12);
            const data = encryptedArray.slice(12);

            // Decrypt
            const decryptedBuffer = await window.crypto.subtle.decrypt(
                {
                    name: "AES-GCM",
                    iv: iv
                },
                key,
                data
            );

            // Convert back to object
            const decoder = new TextDecoder();
            const decryptedString = decoder.decode(decryptedBuffer);

            return JSON.parse(decryptedString);
        } catch (error) {
            console.error('Error decrypting:', error);
            throw error;
        }
    },

    // Hash password (for storage)
    hashPassword: async (password) => {
        try {
            const encoder = new TextEncoder();
            const data = encoder.encode(password);

            const hash = await window.crypto.subtle.digest('SHA-256', data);

            return arrayBufferToBase64(hash);
        } catch (error) {
            console.error('Error hashing password:', error);
            throw error;
        }
    },

    // Generate random token
    generateToken: (length = 32) => {
        const array = new Uint8Array(length);
        window.crypto.getRandomValues(array);
        return Array.from(array, byte => byte.toString(16).padStart(2, '0')).join('');
    },

    // Encrypt field value (for sensitive data like SSN, credit cards)
    encryptField: async (value, fieldKey) => {
        if (!value) return value;

        try {
            const key = await Encryption.importKey(fieldKey);
            const encrypted = await Encryption.encrypt(value, key);
            return `ENC:${encrypted}`;
        } catch (error) {
            console.error('Error encrypting field:', error);
            return value; // Fallback to plain text
        }
    },

    // Decrypt field value
    decryptField: async (encryptedValue, fieldKey) => {
        if (!encryptedValue || !encryptedValue.startsWith('ENC:')) {
            return encryptedValue;
        }

        try {
            const key = await Encryption.importKey(fieldKey);
            const encrypted = encryptedValue.substring(4); // Remove 'ENC:' prefix
            return await Encryption.decrypt(encrypted, key);
        } catch (error) {
            console.error('Error decrypting field:', error);
            return '[ENCRYPTED]';
        }
    }
};

// Field-level encryption configuration
const EncryptedFields = {
    prospects: ['phone', 'email', 'address', 'id_number', 'bank_account'],
    customers: ['phone', 'email', 'address', 'id_number', 'credit_card', 'bank_account'],
    users: ['password_hash', 'mfa_secret', 'reset_token'],
    documents: ['content', 'file_data']
};

// Wrapper for AppDataStore with encryption
const SecureDataStore = {
    // Create with encryption
    create: async (table, data) => {
        // Check if table has encrypted fields
        const encryptedFields = EncryptedFields[table] || [];

        // Get encryption key for user/tenant
        const encryptionKey = await getEncryptionKey();

        // Encrypt sensitive fields
        const encryptedData = { ...data };
        for (const field of encryptedFields) {
            if (encryptedData[field]) {
                encryptedData[field] = await Encryption.encryptField(
                    encryptedData[field],
                    encryptionKey
                );
            }
        }

        // Add encryption metadata
        encryptedData._encrypted_fields = encryptedFields.filter(f => data[f]);
        encryptedData._encrypted_at = new Date().toISOString();
        encryptedData._encryption_version = '1.0';

        // Store in AppDataStore
        return AppDataStore.create(table, encryptedData);
    },

    // Read with decryption
    getById: async (table, id) => {
        const data = AppDataStore.getById(table, id);
        if (!data) return null;

        // Check if data is encrypted
        if (data._encrypted_fields && data._encrypted_fields.length > 0) {
            const encryptionKey = await getEncryptionKey();
            const decryptedData = { ...data };

            for (const field of data._encrypted_fields) {
                if (decryptedData[field]) {
                    decryptedData[field] = await Encryption.decryptField(
                        decryptedData[field],
                        encryptionKey
                    );
                }
            }

            return decryptedData;
        }

        return data;
    },

    // Update with encryption
    update: async (table, id, data) => {
        const existing = AppDataStore.getById(table, id);
        if (!existing) return null;

        const encryptedFields = EncryptedFields[table] || [];
        const encryptionKey = await getEncryptionKey();

        const encryptedData = { ...existing, ...data };
        for (const field of encryptedFields) {
            if (encryptedData[field] && !encryptedData[field].startsWith('ENC:')) {
                encryptedData[field] = await Encryption.encryptField(
                    encryptedData[field],
                    encryptionKey
                );
            }
        }

        // Update encryption metadata
        encryptedData._encrypted_fields = [...new Set([
            ...(existing._encrypted_fields || []),
            ...encryptedFields.filter(f => encryptedData[f])
        ])];
        encryptedData._encrypted_at = new Date().toISOString();

        return AppDataStore.update(table, id, encryptedData);
    },

    // Query with decryption (careful with performance)
    query: async (table, conditions) => {
        const results = AppDataStore.query(table, conditions);
        if (!results || results.length === 0) return results;

        // Check if any result has encrypted fields
        if (results[0]._encrypted_fields) {
            const encryptionKey = await getEncryptionKey();

            return Promise.all(results.map(async (data) => {
                const decryptedData = { ...data };

                for (const field of data._encrypted_fields) {
                    if (decryptedData[field]) {
                        decryptedData[field] = await Encryption.decryptField(
                            decryptedData[field],
                            encryptionKey
                        );
                    }
                }

                return decryptedData;
            }));
        }

        return results;
    }
};

// Get encryption key for current user/tenant
const getEncryptionKey = async () => {
    // Fetch encryption key from Supabase encryption_keys table
    try {
        const keys = await AppDataStore.getAll('encryption_keys');
        const activeKey = keys.find(k => k.status === 'active' || k.is_active);
        if (activeKey?.key_data) return activeKey.key_data;
    } catch (_) {}

    // No key found — generate and store in Supabase
    const { exportedKey } = await Encryption.generateKey();
    try {
        await AppDataStore.create('encryption_keys', {
            key_data: exportedKey,
            status: 'active',
            is_active: true,
            created_at: new Date().toISOString()
        });
    } catch (_) {}

    return exportedKey;
};

// Base64 helpers (needed for Web Crypto interactions)
function encryptionArrayBufferToBase64(buffer) {
    const bytes = new Uint8Array(buffer);
    let binary = '';
    for (let i = 0; i < bytes.byteLength; i++) {
        binary += String.fromCharCode(bytes[i]);
    }
    return window.btoa(binary);
}

function encryptionBase64ToArrayBuffer(base64) {
    const binary_string = window.atob(base64);
    const len = binary_string.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) {
        bytes[i] = binary_string.charCodeAt(i);
    }
    return bytes.buffer;
}