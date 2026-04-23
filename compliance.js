// ========== COMPLIANCE MANAGEMENT ==========

// Consent types
const ConsentType = {
    MARKETING: 'marketing',
    DATA_PROCESSING: 'data_processing',
    THIRD_PARTY: 'third_party',
    COMMUNICATIONS: 'communications',
    LOCATION: 'location',
    BIOMETRIC: 'biometric'
};

// Consent actions
const ConsentAction = {
    GRANT: 'grant',
    REVOKE: 'revoke'
};

// Compliance regions
const ComplianceRegion = {
    GDPR: 'GDPR', // Europe
    PDPA: 'PDPA', // Singapore
    CCPA: 'CCPA', // California
    LGPD: 'LGPD', // Brazil
    NONE: 'none'
};

// Safe audit wrapper — AuditLogger may not be loaded
const _complianceAudit = (severity, category, action, detail) => {
    try {
        if (typeof AuditLogger !== 'undefined' && AuditLogger?.[severity]) {
            AuditLogger[severity](category, action, detail);
        }
    } catch (_) { /* best-effort */ }
};

// Consent management
const ConsentManager = {
    // Record consent
    recordConsent: async (userId, consentType, granted, ipAddress = null) => {
        const consent = {
            id: `consent_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
            user_id: userId,
            consent_type: consentType,
            granted: granted,
            ip_address: ipAddress || await getClientIP(),
            user_agent: navigator.userAgent,
            timestamp: new Date().toISOString(),
            expires_at: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString(), // 1 year
            revoked_at: null
        };

        await AppDataStore.create('consent_records', consent);

        // Update user's consent preferences
        const user = await AppDataStore.getById('users', userId);
        if (user) {
            user.consent_preferences = user.consent_preferences || {};
            user.consent_preferences[consentType] = {
                granted: granted,
                granted_at: consent.timestamp,
                expires_at: consent.expires_at
            };
            await AppDataStore.update('users', userId, user);
        }

        _complianceAudit('info', 'COMPLIANCE', granted ? ConsentAction.GRANT : ConsentAction.REVOKE, {
            user_id: userId,
            consent_type: consentType,
            ip_address: consent.ip_address
        });

        return consent;
    },

    // Check if user has consent
    hasConsent: async (userId, consentType) => {
        const user = await AppDataStore.getById('users', userId);
        if (!user || !user.consent_preferences) return false;

        const consent = user.consent_preferences[consentType];
        if (!consent) return false;

        // Check if expired
        if (consent.expires_at && new Date(consent.expires_at) < new Date()) {
            return false;
        }

        return consent.granted === true;
    },

    // Get consent history for user
    getConsentHistory: async (userId) => {
        const records = (await AppDataStore.query('consent_records', { user_id: userId })) || [];
        return records.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
    },

    // Revoke consent
    revokeConsent: async (userId, consentType) => {
        const user = await AppDataStore.getById('users', userId);
        if (user && user.consent_preferences) {
            user.consent_preferences[consentType] = {
                granted: false,
                revoked_at: new Date().toISOString()
            };
            await AppDataStore.update('users', userId, user);
        }

        // Record revocation
        const revocation = {
            id: `revoke_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
            user_id: userId,
            consent_type: consentType,
            revoked_at: new Date().toISOString()
        };

        await AppDataStore.create('consent_revocations', revocation);

        return revocation;
    }
};

// Data Subject Access Request (DSAR) management
const DSARManager = {
    // Create DSAR request
    createRequest: async (userId, requestType) => {
        const request = {
            id: `dsar_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
            user_id: userId,
            request_type: requestType, // 'access', 'rectification', 'erasure', 'restriction', 'portability'
            status: 'pending',
            submitted_at: new Date().toISOString(),
            due_date: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(), // 30 days
            completed_at: null,
            notes: [],
            attachments: []
        };

        await AppDataStore.create('dsar_requests', request);

        // Notify compliance officer
        const notifyComplianceOfficer = (title, req) => console.log(title, req);
        notifyComplianceOfficer('New DSAR Request', request);

        return request;
    },

    // Process access request - gather all user data
    processAccessRequest: async (requestId) => {
        const request = await AppDataStore.getById('dsar_requests', requestId);
        if (!request) return null;

        const [profile, prospects, customers, activities, transactions, documents, consent_records, audit_logs_raw] = await Promise.all([
            AppDataStore.getById('users', request.user_id),
            AppDataStore.query('prospects', { created_by: request.user_id }),
            AppDataStore.query('customers', { created_by: request.user_id }),
            AppDataStore.query('activities', { user_id: request.user_id }),
            AppDataStore.query('transactions', { user_id: request.user_id }),
            AppDataStore.query('documents', { created_by: request.user_id }),
            AppDataStore.query('consent_records', { user_id: request.user_id }),
            AppDataStore.query('audit_logs', { user_id: request.user_id })
        ]);

        const userData = {
            profile,
            prospects,
            customers,
            activities,
            transactions,
            documents,
            consent_records,
            audit_logs: (audit_logs_raw || []).slice(0, 1000) // Limit for performance
        };

        // Generate report
        const report = {
            request_id: requestId,
            generated_at: new Date().toISOString(),
            data: userData,
            format: 'json'
        };

        // Store report
        const reportId = `report_${Date.now()}`;
        await AppDataStore.create('dsar_reports', {
            id: reportId,
            request_id: requestId,
            ...report
        });

        // Update request status
        request.status = 'completed';
        request.completed_at = new Date().toISOString();
        request.report_id = reportId;
        await AppDataStore.update('dsar_requests', requestId, request);

        return reportId;
    },

    // Process erasure request (right to be forgotten)
    processErasureRequest: async (requestId) => {
        const request = await AppDataStore.getById('dsar_requests', requestId);
        if (!request) return null;

        const userId = request.user_id;

        // Anonymize or delete user data
        const user = await AppDataStore.getById('users', userId);
        if (user) {
            // Keep minimal record for legal purposes
            const anonymizedUser = {
                ...user,
                full_name: 'ANONYMIZED',
                email: `deleted_${Date.now()}@anonymized.com`,
                phone: 'ANONYMIZED',
                address: 'ANONYMIZED',
                id_number: 'ANONYMIZED',
                is_anonymized: true,
                anonymized_at: new Date().toISOString()
            };
            await AppDataStore.update('users', userId, anonymizedUser);
        }

        // Delete or anonymize related records
        const tables = ['prospects', 'customers', 'activities', 'transactions'];
        for (const table of tables) {
            const records = (await AppDataStore.query(table, { created_by: userId })) || [];
            for (const record of records) {
                // For compliance, we might want to anonymize rather than delete
                const anonymized = {
                    ...record,
                    full_name: 'ANONYMIZED',
                    email: null,
                    phone: null,
                    is_anonymized: true
                };
                await AppDataStore.update(table, record.id, anonymized);
            }
        }

        // Update request
        request.status = 'completed';
        request.completed_at = new Date().toISOString();
        request.erasure_performed = true;
        await AppDataStore.update('dsar_requests', requestId, request);

        _complianceAudit('critical', 'COMPLIANCE', 'right_to_be_forgotten', {
            user_id: userId,
            request_id: requestId
        });

        return request;
    }
};

// Data Retention Policy
const RetentionPolicy = {
    policies: {
        prospects: {
            active: 730, // 2 years
            inactive: 365, // 1 year
            action: 'anonymize'
        },
        customers: {
            active: 2555, // 7 years
            inactive: 1825, // 5 years
            action: 'archive'
        },
        activities: {
            retention: 730, // 2 years
            action: 'delete'
        },
        transactions: {
            retention: 2555, // 7 years (legal requirement)
            action: 'archive'
        },
        audit_logs: {
            retention: 2555, // 7 years
            action: 'archive'
        },
        whatsapp_messages: {
            retention: 730, // 2 years
            action: 'delete'
        }
    },

    // Apply retention policy
    applyRetention: async () => {
        const results = {
            anonymized: 0,
            archived: 0,
            deleted: 0,
            errors: []
        };

        for (const [table, policy] of Object.entries(RetentionPolicy.policies)) {
            try {
                const records = (await AppDataStore.getAll(table)) || [];
                const now = new Date();

                for (const record of records) {
                    const lastActivity = record.last_activity_at || record.updated_at || record.created_at;
                    if (!lastActivity) continue; // Skip if no date
                    const daysSince = Math.floor((now - new Date(lastActivity)) / (24 * 60 * 60 * 1000));

                    let shouldProcess = false;

                    if (policy.active && record.status === 'active' && daysSince > policy.active) {
                        shouldProcess = true;
                    } else if (policy.inactive && record.status === 'inactive' && daysSince > policy.inactive) {
                        shouldProcess = true;
                    } else if (policy.retention && daysSince > policy.retention) {
                        shouldProcess = true;
                    }

                    if (shouldProcess) {
                        switch (policy.action) {
                            case 'anonymize':
                                await RetentionPolicy.anonymizeRecord(table, record);
                                results.anonymized++;
                                break;
                            case 'archive':
                                await RetentionPolicy.archiveRecord(table, record);
                                results.archived++;
                                break;
                            case 'delete':
                                await AppDataStore.delete(table, record.id);
                                results.deleted++;
                                break;
                        }
                    }
                }
            } catch (error) {
                results.errors.push({ table, error: error.message });
            }
        }

        // Log retention job
        await AppDataStore.create('retention_jobs', {
            id: `retention_${Date.now()}`,
            executed_at: new Date().toISOString(),
            results: results
        });

        return results;
    },

    // Anonymize record
    anonymizeRecord: async (table, record) => {
        const anonymized = { ...record };

        // Anonymize common fields
        if (anonymized.full_name) anonymized.full_name = 'ANONYMIZED';
        if (anonymized.email) anonymized.email = null;
        if (anonymized.phone) anonymized.phone = null;
        if (anonymized.address) anonymized.address = null;
        if (anonymized.id_number) anonymized.id_number = null;

        anonymized.is_anonymized = true;
        anonymized.anonymized_at = new Date().toISOString();

        await AppDataStore.update(table, record.id, anonymized);
    },

    // Archive record
    archiveRecord: async (table, record) => {
        // Move to archive store
        await AppDataStore.create('archived_records', {
            id: `archived_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
            original_table: table,
            original_id: record.id,
            data: record,
            archived_at: new Date().toISOString()
        });

        // Optionally delete original
        // AppDataStore.delete(table, record.id);
    }
};
