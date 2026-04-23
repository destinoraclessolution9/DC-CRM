// ========== PERFORMANCE MONITORING ==========

// Performance metrics
const PerformanceMetrics = {
    page_load: [],
    api_calls: [],
    database_queries: [],
    render_times: [],
    memory_usage: []
};

// Performance Monitor
const PerformanceMonitor = {
    // Start measuring
    startMeasure: (label) => {
        const start = performance.now();
        return {
            label,
            start,
            end: null,
            duration: null,

            // End measurement
            end: function () {
                this.end = performance.now();
                this.duration = this.end - this.start;
                PerformanceMonitor.recordMetric(label, this.duration);
                return this.duration;
            }
        };
    },

    // Record metric
    recordMetric: (name, value, metadata = {}) => {
        const metric = {
            name,
            value,
            timestamp: new Date().toISOString(),
            metadata,
            session_id: getSessionId()
        };

        AppDataStore.create('performance_metrics', metric).catch(err => console.debug('[perf] metric write failed:', err?.message));

        // Keep in memory for quick access
        if (!PerformanceMetrics[name]) {
            PerformanceMetrics[name] = [];
        }
        PerformanceMetrics[name].push(value);

        // Limit memory storage
        if (PerformanceMetrics[name].length > 1000) {
            PerformanceMetrics[name].shift();
        }

        // Check for performance issues
        PerformanceMonitor.checkThresholds(name, value);
    },

    // Measure function execution
    measureFunction: (fn, name) => {
        return async (...args) => {
            const measure = PerformanceMonitor.startMeasure(name);
            try {
                const result = await fn(...args);
                return result;
            } finally {
                const duration = measure.end();
                console.log(`${name} took ${duration.toFixed(2)}ms`);
            }
        };
    },

    // Measure API call
    measureAPI: async (url, options = {}) => {
        const measure = PerformanceMonitor.startMeasure(`api_${url}`);
        try {
            const response = await fetch(url, options);
            const duration = measure.end();

            PerformanceMonitor.recordMetric('api_call', duration, {
                url,
                method: options.method || 'GET',
                status: response.status
            });

            return response;
        } catch (error) {
            measure.end();
            throw error;
        }
    },

    // Measure database query
    measureQuery: (queryFn, table) => {
        return (...args) => {
            const measure = PerformanceMonitor.startMeasure(`db_${table}`);
            try {
                const result = queryFn(...args);
                measure.end();
                return result;
            } catch (error) {
                measure.end();
                throw error;
            }
        };
    },

    // Get performance summary
    getSummary: async (minutes = 60) => {
        const cutoff = new Date(Date.now() - minutes * 60 * 1000);
        const metrics = ((await AppDataStore.getAll('performance_metrics')) || [])
            .filter(m => new Date(m.timestamp) >= cutoff);

        // Group by name
        const grouped = {};
        metrics.forEach(m => {
            if (!grouped[m.name]) grouped[m.name] = [];
            grouped[m.name].push(m.value);
        });

        // Calculate statistics
        const summary = {};
        Object.entries(grouped).forEach(([name, values]) => {
            const sorted = values.sort((a, b) => a - b);
            summary[name] = {
                count: values.length,
                min: sorted[0],
                max: sorted[sorted.length - 1],
                avg: values.reduce((a, b) => a + b, 0) / values.length,
                p95: sorted[Math.floor(sorted.length * 0.95)],
                p99: sorted[Math.floor(sorted.length * 0.99)]
            };
        });

        return summary;
    },

    // Check performance thresholds
    checkThresholds: (name, value) => {
        const thresholds = {
            page_load: 3000, // 3 seconds
            api_call: 1000,   // 1 second
            db_query: 500,    // 500ms
            render_time: 100   // 100ms
        };

        const threshold = thresholds[name];
        if (threshold && value > threshold) {
            // Log slow operation
            AppDataStore.create('performance_warnings', {
                id: `warn_${Date.now()}`,
                name,
                value,
                threshold,
                timestamp: new Date().toISOString()
            }).catch(err => console.debug('[perf] warning write failed:', err?.message));

            // Alert if very slow
            if (value > threshold * 2) {
                console.warn(`Performance warning: ${name} took ${value.toFixed(2)}ms (threshold: ${threshold}ms)`);
            }
        }
    },

    // Get performance warnings
    getWarnings: async (hours = 24) => {
        const cutoff = new Date(Date.now() - hours * 60 * 60 * 1000);
        return ((await AppDataStore.getAll('performance_warnings')) || [])
            .filter(w => new Date(w.timestamp) >= cutoff)
            .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
    },

    // Monitor memory usage
    monitorMemory: () => {
        if (performance.memory) {
            const memory = performance.memory;
            PerformanceMonitor.recordMetric('memory_used', memory.usedJSHeapSize);
            PerformanceMonitor.recordMetric('memory_total', memory.totalJSHeapSize);
            PerformanceMonitor.recordMetric('memory_limit', memory.jsHeapSizeLimit);

            // Check for memory pressure
            const usagePercent = (memory.usedJSHeapSize / memory.totalJSHeapSize) * 100;
            if (usagePercent > 80) {
                console.warn(`High memory usage: ${usagePercent.toFixed(1)}%`);
            }
        }
    },

    // Start continuous monitoring
    startMonitoring: (interval = 60000) => {
        setInterval(() => {
            PerformanceMonitor.monitorMemory();
        }, interval);
    }
};

// Wrap AppDataStore with performance monitoring
const MonitoredDataStore = {
    getAll: PerformanceMonitor.measureQuery(
        (table) => AppDataStore.getAll(table),
        'getAll'
    ),

    getById: PerformanceMonitor.measureQuery(
        (table, id) => AppDataStore.getById(table, id),
        'getById'
    ),

    query: PerformanceMonitor.measureQuery(
        (table, conditions) => AppDataStore.query(table, conditions),
        'query'
    ),

    create: PerformanceMonitor.measureQuery(
        (table, data) => AppDataStore.create(table, data),
        'create'
    ),

    update: PerformanceMonitor.measureQuery(
        (table, id, data) => AppDataStore.update(table, id, data),
        'update'
    ),

    delete: PerformanceMonitor.measureQuery(
        (table, id) => AppDataStore.delete(table, id),
        'delete'
    )
};
