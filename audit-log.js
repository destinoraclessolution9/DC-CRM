// ========== AUDIT LOGGING SYSTEM ==========

// Audit log levels
const AuditLevel = {
    INFO: 'info',
    WARNING: 'warning',
    ERROR: 'error',
    CRITICAL: 'critical'
};

// Audit log categories
const AuditCategory = {
    AUTH: 'authentication',
    DATA: 'data_access',
    CONFIG: 'configuration',
    SECURITY: 'security',
    EXPORT: 'data_export',
    IMPORT: 'data_import',
    PERMISSION: 'permission_change',
    ENCRYPTION: 'encryption',
    COMPLIANCE: 'compliance'
};

// Audit log actions
const AuditAction = {
    LOGIN: 'login',
    LOGOUT: 'logout',
    LOGIN_FAILED: 'login_failed',
    CREATE: 'create',
    READ: 'read',
    UPDATE: 'update',
    DELETE: 'delete',
    EXPORT: 'export',
    IMPORT: 'import',
    PERMISSION_GRANT: 'permission_grant',
    PERMISSION_REVOKE: 'permission_revoke',
    ROLE_CHANGE: 'role_change',
    PASSWORD_CHANGE: 'password_change',
    MFA_ENABLE: 'mfa_enable',
    MFA_DISABLE: 'mfa_disable',
    DATA_PURGE: 'data_purge',
    CONSENT_UPDATE: 'consent_update'
};

// Audit logger
const AuditLogger = {
    // Log an event
    log: async (level, category, action, details = {}, userId = null) => {
        try {
            const auditEntry = {
                id: `audit_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
                timestamp: new Date().toISOString(),
                level: level,
                category: category,
                action: action,
                user_id: userId || window._currentUser?.id || 'system',
                username: window._currentUser?.username || 'system',
                ip_address: await getClientIP(),
                user_agent: navigator.userAgent,
                session_id: getSessionId(),
                details: details,
                changes: details.changes || null,
                old_values: details.old_values || null,
                new_values: details.new_values || null,
                resource_type: details.resource_type || null,
                resource_id: details.resource_id || null,
                success: details.success !== false,
                error_message: details.error || null
            };

            // Store in AppDataStore
            AppDataStore.create('audit_logs', auditEntry);

            // Also send to server for permanent storage
            if (navigator.onLine) {
                sendAuditToServer(auditEntry);
            } else {
                // Queue for later sync
                queueAuditForSync(auditEntry);
            }

            // Check for security incidents
            checkSecurityIncident(auditEntry);

            return auditEntry;
        } catch (error) {
            console.error('Error writing audit log:', error);
        }
    },

    // Convenience methods
    info: (category, action, details) =>
        AuditLogger.log(AuditLevel.INFO, category, action, details),

    warn: (category, action, details) =>
        AuditLogger.log(AuditLevel.WARNING, category, action, details),

    error: (category, action, details) =>
        AuditLogger.log(AuditLevel.ERROR, category, action, details),

    critical: (category, action, details) =>
        AuditLogger.log(AuditLevel.CRITICAL, category, action, details),

    // Log data access
    logDataAccess: (action, table, recordId, userId) => {
        return AuditLogger.info(
            AuditCategory.DATA,
            action,
            {
                resource_type: table,
                resource_id: recordId,
                user_id: userId
            }
        );
    },

    // Log authentication events
    logAuth: (action, success, username, error = null) => {
        return AuditLogger.log(
            success ? AuditLevel.INFO : AuditLevel.WARNING,
            AuditCategory.AUTH,
            action,
            {
                username: username,
                success: success,
                error: error
            }
        );
    },

    // Log permission changes
    logPermissionChange: (action, role, permissions, userId) => {
        return AuditLogger.log(
            AuditLevel.INFO,
            AuditCategory.PERMISSION,
            action,
            {
                role: role,
                permissions: permissions,
                target_user: userId
            }
        );
    },

    // Log data export
    logExport: (table, recordCount, filters, userId) => {
        return AuditLogger.info(
            AuditCategory.EXPORT,
            AuditAction.EXPORT,
            {
                resource_type: table,
                record_count: recordCount,
                filters: filters,
                user_id: userId
            }
        );
    },

    // Search audit logs
    search: async (filters = {}) => {
        let logs = AppDataStore.getAll('audit_logs');

        if (filters.startDate) {
            logs = logs.filter(log => log.timestamp >= filters.startDate);
        }

        if (filters.endDate) {
            logs = logs.filter(log => log.timestamp <= filters.endDate);
        }

        if (filters.level) {
            logs = logs.filter(log => log.level === filters.level);
        }

        if (filters.category) {
            logs = logs.filter(log => log.category === filters.category);
        }

        if (filters.userId) {
            logs = logs.filter(log => log.user_id === filters.userId);
        }

        if (filters.action) {
            logs = logs.filter(log => log.action === filters.action);
        }

        if (filters.resourceType) {
            logs = logs.filter(log => log.resource_type === filters.resourceType);
        }

        if (filters.resourceId) {
            logs = logs.filter(log => log.resource_id === filters.resourceId);
        }

        // Sort by timestamp descending
        logs.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

        return logs;
    },

    // Get summary statistics
    getStats: async (days = 30) => {
        const cutoff = new Date();
        cutoff.setDate(cutoff.getDate() - days);

        const logs = AppDataStore.getAll('audit_logs').filter(
            log => new Date(log.timestamp) >= cutoff
        );

        return {
            total_events: logs.length,
            by_level: {
                info: logs.filter(l => l.level === AuditLevel.INFO).length,
                warning: logs.filter(l => l.level === AuditLevel.WARNING).length,
                error: logs.filter(l => l.level === AuditLevel.ERROR).length,
                critical: logs.filter(l => l.level === AuditLevel.CRITICAL).length
            },
            by_category: Object.values(AuditCategory).reduce((acc, cat) => {
                acc[cat] = logs.filter(l => l.category === cat).length;
                return acc;
            }, {}),
            top_users: Object.entries(
                logs.reduce((acc, log) => {
                    acc[log.username] = (acc[log.username] || 0) + 1;
                    return acc;
                }, {})
            ).sort((a, b) => b[1] - a[1]).slice(0, 5)
        };
    }
};

// Helper functions
const getClientIP = async () => {
    try {
        const response = await fetch('https://api.ipify.org?format=json');
        const data = await response.json();
        return data.ip;
    } catch (error) {
        return 'unknown';
    }
};

const getSessionId = () => {
    let sessionId = sessionStorage.getItem('session_id');
    if (!sessionId) {
        sessionId = `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        sessionStorage.setItem('session_id', sessionId);
    }
    return sessionId;
};

const sendAuditToServer = (auditEntry) => {
    // Pending backend implementations - mock for now
    /*
    fetch('/api/audit/log', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${Auth?.getToken()}`
        },
        body: JSON.stringify(auditEntry)
    }).catch(error => console.error('Error sending audit to server:', error));
    */
    console.log('Sending audit log to server mock endpoint:', auditEntry.id);
};

// In-memory audit sync queue — entries are flushed to audit_logs table when online
const _auditSyncQueue = [];
const queueAuditForSync = (auditEntry) => {
    _auditSyncQueue.push(auditEntry);
    // Try to flush to Supabase immediately
    if (window.AppDataStore) {
        AppDataStore.create('audit_logs', auditEntry).then(() => {
            const idx = _auditSyncQueue.indexOf(auditEntry);
            if (idx >= 0) _auditSyncQueue.splice(idx, 1);
        }).catch(() => {});
    }
};

// Security incident detection
const checkSecurityIncident = (auditEntry) => {
    const incidents = [];

    // Multiple failed logins
    if (auditEntry.action === AuditAction.LOGIN_FAILED) {
        const recentFailures = AppDataStore.query('audit_logs', {
            action: AuditAction.LOGIN_FAILED,
            username: auditEntry.username
        }).filter(log => {
            const logTime = new Date(log.timestamp);
            const fiveMinAgo = new Date(Date.now() - 5 * 60 * 1000);
            return logTime > fiveMinAgo;
        });

        if (recentFailures.length >= 5) {
            incidents.push({
                type: 'brute_force_attempt',
                severity: 'high',
                username: auditEntry.username,
                count: recentFailures.length,
                timestamp: new Date().toISOString()
            });
        }
    }

    // Permission escalation
    if (auditEntry.action === AuditAction.PERMISSION_GRANT &&
        auditEntry.details.permissions?.includes('admin')) {
        incidents.push({
            type: 'permission_escalation',
            severity: 'critical',
            user: auditEntry.user_id,
            granted_by: auditEntry.details.granted_by,
            timestamp: new Date().toISOString()
        });
    }

    // Data export of many records
    if (auditEntry.action === AuditAction.EXPORT &&
        auditEntry.details.record_count > 1000) {
        incidents.push({
            type: 'bulk_data_export',
            severity: 'medium',
            user: auditEntry.user_id,
            count: auditEntry.details.record_count,
            timestamp: new Date().toISOString()
        });
    }

    // Store incidents
    incidents.forEach(incident => {
        AppDataStore.create('security_incidents', {
            id: `incident_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
            ...incident,
            status: 'new',
            acknowledged: false,
            created_at: new Date().toISOString()
        });

        // Send alert for critical incidents
        if (incident.severity === 'critical') {
            sendSecurityAlert(incident);
        }
    });
};

const sendSecurityAlert = (incident) => {
    // Send email/SMS to security team
    console.log('SECURITY ALERT:', incident);

    // Show notification to admin
    if (window._currentUser?.role === 'admin') {
        if (window.UI && window.UI.toast) {
            UI.toast.error(`Security Alert: ${incident.type}`, 0);
        }
    }
};
