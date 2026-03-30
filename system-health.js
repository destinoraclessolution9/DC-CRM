// ========== SYSTEM HEALTH MONITORING ==========

// Health check status
const HealthStatus = {
    HEALTHY: 'healthy',
    DEGRADED: 'degraded',
    UNHEALTHY: 'unhealthy',
    MAINTENANCE: 'maintenance'
};

// System components
const SystemComponents = {
    DATABASE: 'database',
    API: 'api',
    STORAGE: 'storage',
    CACHE: 'cache',
    QUEUE: 'queue',
    EMAIL: 'email',
    WHATSAPP: 'whatsapp',
    AI_SERVICE: 'ai_service'
};

// System Health Monitor
const SystemHealth = {
    // Current health status
    status: HealthStatus.HEALTHY,
    checks: {},

    // Run all health checks
    runAllChecks: async () => {
        const results = {};

        // Run each check
        results[SystemComponents.DATABASE] = await SystemHealth.checkDatabase();
        results[SystemComponents.API] = await SystemHealth.checkAPI();
        results[SystemComponents.STORAGE] = await SystemHealth.checkStorage();
        results[SystemComponents.CACHE] = await SystemHealth.checkCache();
        results[SystemComponents.EMAIL] = await SystemHealth.checkEmail();
        results[SystemComponents.WHATSAPP] = await SystemHealth.checkWhatsApp();
        results[SystemComponents.AI_SERVICE] = await SystemHealth.checkAIService();

        // Determine overall status
        const overall = SystemHealth.calculateOverallStatus(results);

        SystemHealth.checks = results;
        SystemHealth.status = overall.status;

        // Store health check result
        SystemHealth.saveHealthCheck(overall, results);

        // Alert if unhealthy
        if (overall.status === HealthStatus.UNHEALTHY) {
            SystemHealth.sendHealthAlert(overall);
        }

        return {
            status: overall.status,
            timestamp: new Date().toISOString(),
            components: results,
            summary: overall.summary
        };
    },

    // Check database connectivity
    checkDatabase: async () => {
        const start = performance.now();

        try {
            // Test database connection
            const testResult = DataStore.getAll('users').length >= 0;
            const responseTime = performance.now() - start;

            return {
                status: testResult ? HealthStatus.HEALTHY : HealthStatus.UNHEALTHY,
                response_time: responseTime,
                message: testResult ? 'Connected' : 'Query failed',
                timestamp: new Date().toISOString()
            };
        } catch (error) {
            return {
                status: HealthStatus.UNHEALTHY,
                error: error.message,
                response_time: performance.now() - start,
                timestamp: new Date().toISOString()
            };
        }
    },

    // Check API endpoints
    checkAPI: async () => {
        const start = performance.now();
        const endpoints = ['/api/health', '/api/version'];
        const results = [];

        for (const endpoint of endpoints) {
            try {
                const response = await fetch(endpoint);
                results.push({
                    endpoint,
                    status: response.ok ? HealthStatus.HEALTHY : HealthStatus.UNHEALTHY,
                    status_code: response.status
                });
            } catch (error) {
                results.push({
                    endpoint,
                    status: HealthStatus.UNHEALTHY,
                    error: error.message
                });
            }
        }

        const responseTime = performance.now() - start;
        const allHealthy = results.every(r => r.status === HealthStatus.HEALTHY);

        return {
            status: allHealthy ? HealthStatus.HEALTHY : HealthStatus.DEGRADED,
            response_time: responseTime,
            endpoints: results,
            timestamp: new Date().toISOString()
        };
    },

    // Check storage
    checkStorage: async () => {
        const start = performance.now();

        try {
            // Check if storage is accessible
            if ('storage' in navigator && 'estimate' in navigator.storage) {
                const estimate = await navigator.storage.estimate();
                const usagePercentage = (estimate.usage / estimate.quota) * 100;

                let status = HealthStatus.HEALTHY;
                if (usagePercentage > 90) status = HealthStatus.DEGRADED;
                if (usagePercentage > 95) status = HealthStatus.UNHEALTHY;

                return {
                    status,
                    usage: estimate.usage,
                    quota: estimate.quota,
                    usage_percentage: usagePercentage,
                    response_time: performance.now() - start,
                    timestamp: new Date().toISOString()
                };
            } else {
                return {
                    status: HealthStatus.HEALTHY,
                    message: 'Storage API not available',
                    response_time: performance.now() - start
                };
            }
        } catch (error) {
            return {
                status: HealthStatus.UNHEALTHY,
                error: error.message,
                response_time: performance.now() - start
            };
        }
    },

    // Check cache
    checkCache: () => {
        const start = performance.now();

        try {
            // Test localStorage/sessionStorage
            const testKey = 'health_test_' + Date.now();
            localStorage.setItem(testKey, 'test');
            const value = localStorage.getItem(testKey);
            localStorage.removeItem(testKey);

            const working = value === 'test';

            return {
                status: working ? HealthStatus.HEALTHY : HealthStatus.UNHEALTHY,
                response_time: performance.now() - start,
                timestamp: new Date().toISOString()
            };
        } catch (error) {
            return {
                status: HealthStatus.UNHEALTHY,
                error: error.message,
                response_time: performance.now() - start
            };
        }
    },

    // Check email service
    checkEmail: async () => {
        const start = performance.now();

        try {
            // Test email configuration
            const response = await fetch('/api/email/test', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ test: true })
            });

            return {
                status: response.ok ? HealthStatus.HEALTHY : HealthStatus.DEGRADED,
                response_time: performance.now() - start,
                message: response.ok ? 'Email service available' : 'Email service degraded',
                timestamp: new Date().toISOString()
            };
        } catch (error) {
            return {
                status: HealthStatus.UNHEALTHY,
                error: error.message,
                response_time: performance.now() - start
            };
        }
    },

    // Check WhatsApp service
    checkWhatsApp: async () => {
        const start = performance.now();

        try {
            const connection = getWhatsAppConnection();
            const status = connection && connection.status === 'connected'
                ? HealthStatus.HEALTHY
                : HealthStatus.DEGRADED;

            return {
                status,
                response_time: performance.now() - start,
                message: status === HealthStatus.HEALTHY ? 'Connected' : 'Not connected',
                timestamp: new Date().toISOString()
            };
        } catch (error) {
            return {
                status: HealthStatus.UNHEALTHY,
                error: error.message,
                response_time: performance.now() - start
            };
        }
    },

    // Check AI service
    checkAIService: async () => {
        const start = performance.now();

        try {
            // Check if AI models are loaded
            const models = DataStore.getAll('ai_models');
            const hasActiveModels = models.some(m => m.is_active);

            return {
                status: hasActiveModels ? HealthStatus.HEALTHY : HealthStatus.DEGRADED,
                response_time: performance.now() - start,
                models_loaded: models.length,
                message: hasActiveModels ? 'AI service ready' : 'No active models',
                timestamp: new Date().toISOString()
            };
        } catch (error) {
            return {
                status: HealthStatus.UNHEALTHY,
                error: error.message,
                response_time: performance.now() - start
            };
        }
    },

    // Calculate overall status
    calculateOverallStatus: (results) => {
        const components = Object.values(results);
        const unhealthy = components.filter(c => c.status === HealthStatus.UNHEALTHY).length;
        const degraded = components.filter(c => c.status === HealthStatus.DEGRADED).length;
        const healthy = components.filter(c => c.status === HealthStatus.HEALTHY).length;

        let status = HealthStatus.HEALTHY;
        let summary = '';

        if (unhealthy > 0) {
            status = HealthStatus.UNHEALTHY;
            summary = `${unhealthy} component(s) unhealthy`;
        } else if (degraded > 0) {
            status = HealthStatus.DEGRADED;
            summary = `${degraded} component(s) degraded`;
        } else {
            summary = 'All systems operational';
        }

        return {
            status,
            healthy,
            degraded,
            unhealthy,
            summary,
            timestamp: new Date().toISOString()
        };
    },

    // Save health check result
    saveHealthCheck: (overall, components) => {
        const check = {
            id: `health_${Date.now()}`,
            timestamp: new Date().toISOString(),
            status: overall.status,
            components: components,
            summary: overall.summary
        };

        DataStore.create('health_checks', check);

        // Keep only last 1000 checks
        const checks = DataStore.getAll('health_checks');
        if (checks.length > 1000) {
            const toRemove = checks.slice(0, checks.length - 1000);
            toRemove.forEach(c => DataStore.delete('health_checks', c.id));
        }

        return check;
    },

    // Send health alert
    sendHealthAlert: (status) => {
        const alert = {
            id: `alert_${Date.now()}`,
            type: 'health',
            severity: 'critical',
            message: `System health degraded: ${status.summary}`,
            details: status,
            timestamp: new Date().toISOString(),
            acknowledged: false
        };

        DataStore.create('system_alerts', alert);

        // Notify admins
        notifyAdmins('System Health Alert', alert.message, 'critical');

        // Log to audit
        AuditLogger.critical(
            AuditCategory.SYSTEM,
            'health_alert',
            status
        );
    },

    // Get health history
    getHealthHistory: (hours = 24) => {
        const cutoff = new Date(Date.now() - hours * 60 * 60 * 1000);

        return DataStore.getAll('health_checks')
            .filter(c => new Date(c.timestamp) >= cutoff)
            .sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
    },

    // Get system metrics
    getSystemMetrics: () => {
        return {
            uptime: process.uptime ? process.uptime() : 3600 * 24 * 7, // Mock uptime
            memory: performance.memory ? {
                used: performance.memory.usedJSHeapSize,
                total: performance.memory.totalJSHeapSize,
                limit: performance.memory.jsHeapSizeLimit
            } : null,
            cpu: navigator.hardwareConcurrency || 4,
            platform: navigator.platform,
            user_agent: navigator.userAgent,
            language: navigator.language,
            online: navigator.onLine
        };
    }
};

// Initialize health monitoring
const initHealthMonitoring = () => {
    console.log('Initializing health monitoring...');

    // Run initial health check
    setTimeout(() => {
        SystemHealth.runAllChecks();
    }, 5000);

    // Schedule regular health checks
    setInterval(() => {
        SystemHealth.runAllChecks();
    }, 5 * 60 * 1000); // Every 5 minutes

    // Monitor online/offline status
    window.addEventListener('online', () => {
        SystemHealth.runAllChecks();
        UI.toast.success('Connection restored');
    });

    window.addEventListener('offline', () => {
        SystemHealth.status = HealthStatus.DEGRADED;
        UI.toast.warning('Connection lost - working offline');
    });
};
