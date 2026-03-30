// ========== SYSTEM CONFIGURATION MANAGEMENT ==========

// Configuration categories
const ConfigCategory = {
    SYSTEM: 'system',
    SECURITY: 'security',
    PERFORMANCE: 'performance',
    FEATURES: 'features',
    INTEGRATIONS: 'integrations',
    NOTIFICATIONS: 'notifications',
    BACKUP: 'backup',
    TENANT: 'tenant'
};

// Configuration Manager
const ConfigManager = {
    // Default configurations
    defaults: {
        system: {
            name: 'CRM System',
            timezone: 'Asia/Singapore',
            date_format: 'DD/MM/YYYY',
            time_format: 'HH:mm',
            currency: 'SGD',
            maintenance_mode: false,
            maintenance_message: 'System under maintenance'
        },
        security: {
            session_timeout: 30, // minutes
            max_login_attempts: 5,
            lockout_duration: 15, // minutes
            password_min_length: 8,
            require_2fa: false,
            ip_whitelist_enabled: false,
            audit_log_retention: 90 // days
        },
        performance: {
            cache_enabled: true,
            cache_ttl: 3600, // seconds
            query_timeout: 30, // seconds
            max_upload_size: 10 * 1024 * 1024, // 10MB
            compression_enabled: true
        },
        features: {
            enable_ai: true,
            enable_whatsapp: true,
            enable_google_calendar: true,
            enable_documents: true,
            enable_analytics: true,
            enable_mobile: true
        },
        integrations: {
            whatsapp: {},
            google: {},
            email: {},
            payment: {}
        },
        notifications: {
            email_enabled: true,
            sms_enabled: false,
            push_enabled: true,
            notification_ttl: 7 // days
        },
        backup: {
            auto_backup: true,
            backup_frequency: 'daily',
            backup_time: '02:00',
            retention_days: 30,
            encrypt_backups: true
        },
        tenant: {
            allow_custom_domains: false,
            max_tenants: 100,
            default_plan: 'basic',
            trial_days: 30
        }
    },

    // Current configuration
    config: {},

    // Load configuration
    loadConfig: () => {
        // Try to load from localStorage
        let saved = null;
        try {
            saved = localStorage.getItem('system_config');
        } catch (e) {
            console.warn('ConfigManager: localStorage load blocked');
        }

        if (saved) {
            try {
                ConfigManager.config = JSON.parse(saved);
            } catch (e) {
                ConfigManager.config = { ...ConfigManager.defaults };
            }
        } else {
            ConfigManager.config = { ...ConfigManager.defaults };
        }

        // Merge with defaults to ensure all keys exist
        ConfigManager.config = ConfigManager.mergeDefaults(ConfigManager.config, ConfigManager.defaults);

        return ConfigManager.config;
    },

    // Save configuration
    saveConfig: (newConfig) => {
        ConfigManager.config = ConfigManager.mergeDefaults(newConfig, ConfigManager.defaults);
        try {
            localStorage.setItem('system_config', JSON.stringify(ConfigManager.config));
        } catch (e) {
            console.warn('ConfigManager: localStorage save blocked');
        }

        // Apply configuration changes
        ConfigManager.applyConfig();

        AuditLogger.info(
            AuditCategory.CONFIG,
            'config_updated',
            {
                categories: Object.keys(newConfig)
            }
        );

        return ConfigManager.config;
    },

    // Get configuration value
    get: (path, defaultValue = null) => {
        const parts = path.split('.');
        let current = ConfigManager.config;

        for (const part of parts) {
            if (current && current[part] !== undefined) {
                current = current[part];
            } else {
                return defaultValue;
            }
        }

        return current;
    },

    // Set configuration value
    set: (path, value) => {
        const parts = path.split('.');
        const lastPart = parts.pop();
        let current = ConfigManager.config;

        for (const part of parts) {
            if (!current[part]) {
                current[part] = {};
            }
            current = current[part];
        }

        current[lastPart] = value;

        // Save changes
        ConfigManager.saveConfig(ConfigManager.config);
    },

    // Merge with defaults
    mergeDefaults: (config, defaults) => {
        const merged = { ...config };

        Object.keys(defaults).forEach(key => {
            if (typeof defaults[key] === 'object' && defaults[key] !== null && !Array.isArray(defaults[key])) {
                merged[key] = ConfigManager.mergeDefaults(merged[key] || {}, defaults[key]);
            } else if (merged[key] === undefined) {
                merged[key] = defaults[key];
            }
        });

        return merged;
    },

    // Apply configuration
    applyConfig: () => {
        // Apply security settings
        if (ConfigManager.config.security.session_timeout && typeof initSessionTimeout === 'function') {
            initSessionTimeout();
        }

        // Apply feature flags
        if (!ConfigManager.config.features.enable_ai) {
            // Disable AI features
            document.querySelectorAll('[data-feature="ai"]').forEach(el => {
                el.style.display = 'none';
            });
        }

        // Apply theme/timezone
        document.documentElement.style.setProperty(
            '--timezone-offset',
            ConfigManager.config.system.timezone
        );

        console.log('Configuration applied');
    },

    // Reset to defaults
    resetToDefaults: () => {
        ConfigManager.config = { ...ConfigManager.defaults };
        ConfigManager.saveConfig(ConfigManager.config);

        UI.toast.success('Configuration reset to defaults');

        return ConfigManager.config;
    },

    // Export configuration
    exportConfig: () => {
        const configJson = JSON.stringify(ConfigManager.config, null, 2);
        const blob = new Blob([configJson], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `crm-config-${new Date().toISOString().split('T')[0]}.json`;
        a.click();
        URL.revokeObjectURL(url);
    },

    // Import configuration
    importConfig: async (file) => {
        try {
            const text = await file.text();
            const config = JSON.parse(text);

            ConfigManager.saveConfig(config);
            UI.toast.success('Configuration imported');

            return true;
        } catch (error) {
            UI.toast.error('Invalid configuration file');
            return false;
        }
    },

    // Validate configuration
    validateConfig: (config) => {
        const errors = [];

        // Check required fields
        if (!config.system.name) errors.push('System name is required');
        if (!config.system.timezone) errors.push('Timezone is required');

        // Validate numbers
        if (config.security.session_timeout < 1) errors.push('Session timeout must be at least 1 minute');
        if (config.security.max_login_attempts < 1) errors.push('Max login attempts must be at least 1');

        return {
            valid: errors.length === 0,
            errors
        };
    }
};

// Initialize configuration
const initConfig = () => {
    ConfigManager.loadConfig();
    ConfigManager.applyConfig();
    console.log('Configuration loaded');
};
