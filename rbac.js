// ========== ADVANCED ROLE-BASED ACCESS CONTROL ==========

// Permission levels
const PermissionLevel = {
    NONE: 0,
    VIEW: 1,
    EDIT: 2,
    CREATE: 3,
    DELETE: 4,
    ADMIN: 5
};

// Resource types
const ResourceType = {
    PROSPECT: 'prospect',
    CUSTOMER: 'customer',
    ACTIVITY: 'activity',
    DOCUMENT: 'document',
    REPORT: 'report',
    USER: 'user',
    ROLE: 'role',
    SETTING: 'setting',
    INTEGRATION: 'integration',
    AUDIT_LOG: 'audit_log'
};

// Default roles
const DefaultRoles = {
    ADMIN: {
        name: 'Administrator',
        permissions: {
            '*': PermissionLevel.ADMIN // Wildcard for all resources
        },
        field_permissions: {
            '*': ['*'] // Can view/edit all fields
        }
    },
    MANAGER: {
        name: 'Manager',
        permissions: {
            [ResourceType.PROSPECT]: PermissionLevel.EDIT,
            [ResourceType.CUSTOMER]: PermissionLevel.EDIT,
            [ResourceType.ACTIVITY]: PermissionLevel.EDIT,
            [ResourceType.DOCUMENT]: PermissionLevel.EDIT,
            [ResourceType.REPORT]: PermissionLevel.VIEW,
            [ResourceType.USER]: PermissionLevel.VIEW
        },
        field_permissions: {
            [ResourceType.PROSPECT]: ['full_name', 'phone', 'email', 'status', 'score'],
            [ResourceType.CUSTOMER]: ['full_name', 'phone', 'email', 'status', 'total_purchases'],
            'sensitive': [] // No access to sensitive fields
        }
    },
    AGENT: {
        name: 'Sales Agent',
        permissions: {
            [ResourceType.PROSPECT]: PermissionLevel.EDIT,
            [ResourceType.CUSTOMER]: PermissionLevel.VIEW,
            [ResourceType.ACTIVITY]: PermissionLevel.EDIT,
            [ResourceType.DOCUMENT]: PermissionLevel.CREATE
        },
        field_permissions: {
            [ResourceType.PROSPECT]: ['full_name', 'phone', 'email', 'status'],
            [ResourceType.CUSTOMER]: ['full_name', 'phone'],
            'sensitive': []
        }
    },
    VIEWER: {
        name: 'Read Only',
        permissions: {
            [ResourceType.PROSPECT]: PermissionLevel.VIEW,
            [ResourceType.CUSTOMER]: PermissionLevel.VIEW,
            [ResourceType.ACTIVITY]: PermissionLevel.VIEW,
            [ResourceType.REPORT]: PermissionLevel.VIEW
        },
        field_permissions: {
            [ResourceType.PROSPECT]: ['full_name', 'status'],
            [ResourceType.CUSTOMER]: ['full_name', 'status'],
            'sensitive': []
        }
    }
};

// Safe audit wrapper — AuditLogger may not be loaded (audit-log.js is
// included conditionally). Never throw; degrade silently.
const _rbacAudit = (severity, category, action, detail) => {
    try {
        if (typeof AuditLogger !== 'undefined' && AuditLogger?.[severity]) {
            AuditLogger[severity](category, action, detail);
        }
    } catch (_) { /* best-effort */ }
};

// Custom-role cache. hasPermission/canViewField are called frequently from
// render paths, so we keep the sync interface by loading custom roles once
// and refreshing after create/assign. Default roles always resolve synchronously.
let _customRolesCache = null;
const _refreshCustomRoles = async () => {
    try {
        _customRolesCache = (await AppDataStore.getAll('roles')) || [];
    } catch (_) {
        _customRolesCache = [];
    }
    return _customRolesCache;
};

// Kick off the initial load (best-effort; sync callers will see an empty
// cache until it resolves, but will fall back to VIEWER for unknown roles)
if (typeof AppDataStore !== 'undefined' && typeof AppDataStore.getAll === 'function') {
    _refreshCustomRoles();
}

// Helper functions
const getRole = (roleName) => {
    // Check default roles first
    if (DefaultRoles[roleName?.toUpperCase()]) {
        return DefaultRoles[roleName.toUpperCase()];
    }

    // Check custom roles from cache (see _refreshCustomRoles)
    const customRole = (_customRolesCache || []).find(r => r.name === roleName);
    return customRole || DefaultRoles.VIEWER;
};

const isSensitiveField = (fieldName) => {
    const sensitiveFields = ['id_number', 'credit_card', 'bank_account', 'password', 'mfa_secret'];
    return sensitiveFields.includes(fieldName);
};


// Permission manager
const PermissionManager = {
    // Check if user has permission for resource
    hasPermission: (user, resourceType, level = PermissionLevel.VIEW) => {
        if (!user || !user.role) return false;

        // Get role
        const role = getRole(user.role);
        if (!role) return false;

        // Check wildcard first
        if (role.permissions['*'] >= level) return true;

        // Check specific resource
        const userLevel = role.permissions[resourceType] || PermissionLevel.NONE;
        return userLevel >= level;
    },

    // Check field-level permission
    canViewField: (user, resourceType, fieldName) => {
        if (!user || !user.role) return false;

        // Admin can see all fields
        if (user.role === 'admin') return true;

        const role = getRole(user.role);
        if (!role) return false;

        // Check if field is in allowed list
        const allowedFields = role.field_permissions[resourceType] || [];
        const sensitiveFields = role.field_permissions['sensitive'] || [];

        // If field is sensitive, check if user has access
        if (isSensitiveField(fieldName)) {
            return sensitiveFields.includes(fieldName) || sensitiveFields.includes('*');
        }

        return allowedFields.includes('*') || allowedFields.includes(fieldName);
    },

    // Filter data based on field permissions
    filterFields: (user, resourceType, data) => {
        if (!data) return data;

        if (Array.isArray(data)) {
            return data.map(item => PermissionManager.filterFields(user, resourceType, item));
        }

        const filtered = {};

        for (const [key, value] of Object.entries(data)) {
            if (PermissionManager.canViewField(user, resourceType, key)) {
                filtered[key] = value;
            } else {
                filtered[key] = '[RESTRICTED]';
            }
        }

        return filtered;
    },

    // Check if user can access a specific record
    canAccessRecord: (user, resourceType, record) => {
        // Admin can access everything
        if (user.role === 'admin') return true;

        // Check ownership
        if (record.assigned_to === user.id) return true;
        if (record.created_by === user.id) return true;

        // Check team access
        if (record.team_id && user.team_id === record.team_id) return true;

        // Managers can access their team's records
        if (user.role === 'manager' && record.team_id === user.team_id) return true;

        // Check permission level
        return PermissionManager.hasPermission(user, resourceType, PermissionLevel.VIEW);
    }
};

// Role management
const RoleManager = {
    // Create custom role
    createRole: async (name, permissions, fieldPermissions) => {
        const role = {
            id: `role_${Date.now()}`,
            name: name,
            permissions: permissions,
            field_permissions: fieldPermissions,
            is_custom: true,
            created_at: new Date().toISOString(),
            created_by: window._currentUser?.id
        };

        await AppDataStore.create('roles', role);
        await _refreshCustomRoles();

        _rbacAudit('info', 'PERMISSION', 'ROLE_CHANGE', {
            action: 'create',
            role_name: name,
            permissions: permissions
        });

        return role;
    },

    // Assign role to user
    assignRole: async (userId, roleId) => {
        const user = await AppDataStore.getById('users', userId);
        const role = await AppDataStore.getById('roles', roleId);

        if (!user || !role) return false;

        user.role = role.name;
        user.role_id = roleId;
        user.role_assigned_at = new Date().toISOString();
        user.role_assigned_by = window._currentUser?.id;

        await AppDataStore.update('users', userId, user);

        _rbacAudit('info', 'PERMISSION', 'PERMISSION_GRANT', {
            user_id: userId,
            username: user.username,
            role: role.name
        });

        return true;
    },

    // Get effective permissions for user
    getUserPermissions: async (userId) => {
        const user = await AppDataStore.getById('users', userId);
        if (!user) return null;

        const role = getRole(user.role);
        if (!role) return null;

        return {
            role: role.name,
            permissions: role.permissions,
            field_permissions: role.field_permissions,
            is_admin: user.role === 'admin'
        };
    },

    // Expose cache refresh for external callers (e.g. after external role mutations)
    refresh: _refreshCustomRoles
};


// Middleware for protecting actions
const requirePermission = (resourceType, level = PermissionLevel.VIEW) => {
    return (action) => {
        return (...args) => {
            if (!PermissionManager.hasPermission(window._currentUser, resourceType, level)) {
                if (window.UI && window.UI.toast) {
                    UI.toast.error('You do not have permission to perform this action');
                }
                _rbacAudit('warn', 'SECURITY', 'permission_denied', {
                    user_id: window._currentUser?.id,
                    resource_type: resourceType,
                    required_level: level,
                    action: action.name || 'anonymous function'
                });
                return null;
            }

            return action(...args);
        };
    };
};
