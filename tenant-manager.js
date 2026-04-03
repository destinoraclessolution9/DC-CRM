// ========== MULTI-TENANT MANAGEMENT ==========

// Tenant status
const TenantStatus = {
    ACTIVE: 'active',
    TRIAL: 'trial',
    SUSPENDED: 'suspended',
    EXPIRED: 'expired',
    PENDING: 'pending'
};

// Tenant plans
const TenantPlan = {
    FREE: 'free',
    BASIC: 'basic',
    PROFESSIONAL: 'professional',
    ENTERPRISE: 'enterprise'
};

// Tenant Manager
const TenantManager = {
    // Create new tenant
    createTenant: async (tenantData) => {
        const tenant = {
            id: `tenant_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
            name: tenantData.name,
            domain: tenantData.domain,
            plan: tenantData.plan || TenantPlan.BASIC,
            status: TenantStatus.PENDING,
            settings: {
                max_users: tenantData.max_users || 10,
                max_storage: tenantData.max_storage || 5 * 1024 * 1024 * 1024, // 5GB
                features: tenantData.features || ['calendar', 'prospects', 'customers'],
                integrations: tenantData.integrations || [],
                timezone: tenantData.timezone || 'Asia/Singapore',
                date_format: tenantData.date_format || 'DD/MM/YYYY',
                currency: tenantData.currency || 'SGD'
            },
            billing: {
                plan: tenantData.plan,
                billing_cycle: tenantData.billing_cycle || 'monthly',
                next_billing_date: tenantData.next_billing_date,
                payment_method: tenantData.payment_method,
                subscription_id: tenantData.subscription_id
            },
            created_at: new Date().toISOString(),
            created_by: _currentUser?.id,
            expires_at: tenantData.expires_at || new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
            database_prefix: `tenant_${Date.now()}`,
            isolation_level: tenantData.isolation_level || 'schema' // 'database', 'schema', 'row'
        };

        // Create tenant record
        AppDataStore.create('tenants', tenant);

        // Provision tenant resources
        await TenantManager.provisionTenant(tenant.id);

        // Create admin user for tenant
        await TenantManager.createTenantAdmin(tenant.id, tenantData.admin);

        // Audit log
        AuditLogger.info(
            AuditCategory.TENANT,
            'tenant_created',
            {
                tenant_id: tenant.id,
                tenant_name: tenant.name,
                plan: tenant.plan
            }
        );

        return tenant;
    },

    // Provision tenant resources
    provisionTenant: async (tenantId) => {
        const tenant = AppDataStore.getById('tenants', tenantId);
        if (!tenant) throw new Error('Tenant not found');

        // Create isolated storage
        if (tenant.isolation_level === 'database') {
            // Create separate database for tenant
            await TenantManager.createTenantDatabase(tenant);
        } else if (tenant.isolation_level === 'schema') {
            // Create separate schema
            await TenantManager.createTenantSchema(tenant);
        }

        // Initialize tenant settings
        tenant.provisioned_at = new Date().toISOString();
        tenant.status = TenantStatus.ACTIVE;
        AppDataStore.update('tenants', tenantId, tenant);

        return true;
    },

    // Get tenant by domain
    getTenantByDomain: (domain) => {
        return AppDataStore.getAll('tenants').find(t => t.domain === domain && t.status === TenantStatus.ACTIVE);
    },

    // Get tenant by ID
    getTenant: (tenantId) => {
        return AppDataStore.getById('tenants', tenantId);
    },

    // Update tenant
    updateTenant: (tenantId, updates) => {
        const tenant = AppDataStore.getById('tenants', tenantId);
        if (!tenant) return null;

        const updated = { ...tenant, ...updates, updated_at: new Date().toISOString() };
        AppDataStore.update('tenants', tenantId, updated);

        AuditLogger.info(
            AuditCategory.TENANT,
            'tenant_updated',
            {
                tenant_id: tenantId,
                updates: Object.keys(updates)
            }
        );

        return updated;
    },

    // Suspend tenant
    suspendTenant: (tenantId, reason) => {
        const tenant = AppDataStore.getById('tenants', tenantId);
        if (!tenant) return null;

        tenant.status = TenantStatus.SUSPENDED;
        tenant.suspended_at = new Date().toISOString();
        tenant.suspension_reason = reason;
        AppDataStore.update('tenants', tenantId, tenant);

        // Notify tenant users
        TenantManager.notifyTenantUsers(tenantId, 'suspension', { reason });

        AuditLogger.critical(
            AuditCategory.TENANT,
            'tenant_suspended',
            {
                tenant_id: tenantId,
                reason: reason
            }
        );

        return tenant;
    },

    // Activate tenant
    activateTenant: (tenantId) => {
        const tenant = AppDataStore.getById('tenants', tenantId);
        if (!tenant) return null;

        tenant.status = TenantStatus.ACTIVE;
        tenant.activated_at = new Date().toISOString();
        AppDataStore.update('tenants', tenantId, tenant);

        AuditLogger.info(
            AuditCategory.TENANT,
            'tenant_activated',
            { tenant_id: tenantId }
        );

        return tenant;
    },

    // Delete tenant (with data purging)
    deleteTenant: async (tenantId, permanent = false) => {
        const tenant = AppDataStore.getById('tenants', tenantId);
        if (!tenant) return null;

        if (permanent) {
            // Permanently delete all tenant data
            await TenantManager.purgeTenantData(tenantId);
            AppDataStore.delete('tenants', tenantId);
        } else {
            // Soft delete
            tenant.status = TenantStatus.EXPIRED;
            tenant.deleted_at = new Date().toISOString();
            AppDataStore.update('tenants', tenantId, tenant);
        }

        AuditLogger.critical(
            AuditCategory.TENANT,
            permanent ? 'tenant_permanently_deleted' : 'tenant_deleted',
            { tenant_id: tenantId }
        );

        return true;
    },

    // List all tenants with filters
    listTenants: (filters = {}) => {
        let tenants = AppDataStore.getAll('tenants');

        if (filters.status) {
            tenants = tenants.filter(t => t.status === filters.status);
        }

        if (filters.plan) {
            tenants = tenants.filter(t => t.plan === filters.plan);
        }

        if (filters.search) {
            const searchLower = filters.search.toLowerCase();
            tenants = tenants.filter(t =>
                t.name.toLowerCase().includes(searchLower) ||
                t.domain.toLowerCase().includes(searchLower)
            );
        }

        return tenants;
    },

    // Get tenant usage statistics
    getTenantUsage: (tenantId) => {
        const tenant = AppDataStore.getById('tenants', tenantId);
        if (!tenant) return null;

        // Get counts from various tables (would need tenant filtering in real implementation)
        const users = AppDataStore.getAll('users').filter(u => u.tenant_id === tenantId);
        const prospects = AppDataStore.getAll('prospects').filter(p => p.tenant_id === tenantId);
        const customers = AppDataStore.getAll('customers').filter(c => c.tenant_id === tenantId);
        const documents = AppDataStore.getAll('documents').filter(d => d.tenant_id === tenantId);

        // Calculate storage usage (simplified)
        const storageUsed = documents.reduce((sum, doc) => sum + (doc.size || 0), 0);

        return {
            tenant_id: tenantId,
            users: users.length,
            prospects: prospects.length,
            customers: customers.length,
            documents: documents.length,
            storage_used: storageUsed,
            storage_percentage: (storageUsed / tenant.settings.max_storage) * 100,
            last_active: users.length > 0 ?
                Math.max(...users.map(u => new Date(u.last_login || 0))) : null,
            api_calls_today: Math.floor(Math.random() * 1000), // Mock data
            active_sessions: users.filter(u => u.is_active).length
        };
    },

    // Get all tenants usage summary
    getAllTenantsUsage: () => {
        const tenants = AppDataStore.getAll('tenants');
        const usage = [];

        tenants.forEach(tenant => {
            usage.push({
                ...TenantManager.getTenantUsage(tenant.id),
                name: tenant.name,
                plan: tenant.plan,
                status: tenant.status
            });
        });

        return usage;
    }
};

// Multi-tenant context middleware
const TenantContext = {
    currentTenant: null,

    // Set current tenant from request/domain
    setFromDomain: () => {
        const hostname = window.location.hostname;

        // For local development, use subdomain or default
        if (hostname === 'localhost' || hostname === '127.0.0.1') {
            const subdomain = localStorage.getItem('dev_tenant') || 'demo';
            TenantContext.currentTenant = TenantManager.getTenantByDomain(`${subdomain}.localhost`);
            if (!TenantContext.currentTenant) {
                // Use default demo tenant
                TenantContext.currentTenant = {
                    id: 'tenant_demo',
                    name: 'Demo Company',
                    domain: 'demo.localhost',
                    settings: {
                        timezone: 'Asia/Singapore',
                        date_format: 'DD/MM/YYYY',
                        currency: 'SGD'
                    }
                };
            }
        } else {
            // Extract subdomain
            const parts = hostname.split('.');
            if (parts.length > 2) {
                const subdomain = parts[0];
                TenantContext.currentTenant = TenantManager.getTenantByDomain(hostname);
            }
        }

        return TenantContext.currentTenant;
    },

    // Get current tenant
    getCurrentTenant: () => {
        return TenantContext.currentTenant;
    },

    // Tenant-aware data query wrapper
    withTenant: (table, query = {}) => {
        if (!TenantContext.currentTenant) return query;

        return {
            ...query,
            tenant_id: TenantContext.currentTenant.id
        };
    }
};

// Initialize tenant context
const initTenantContext = () => {
    TenantContext.setFromDomain();
    console.log('Current tenant:', TenantContext.currentTenant?.name);
};
