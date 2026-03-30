// ========== SYSTEM LOGS VIEWER ==========

// Log levels
const LogLevel = {
    DEBUG: 'debug',
    INFO: 'info',
    WARN: 'warn',
    ERROR: 'error',
    FATAL: 'fatal'
};

// Log sources
const LogSource = {
    SYSTEM: 'system',
    DATABASE: 'database',
    API: 'api',
    AUTH: 'auth',
    UI: 'ui',
    WORKER: 'worker',
    INTEGRATION: 'integration'
};

// System Logger
const SystemLogger = {
    // Log queue
    queue: [],

    // Log to console and storage
    log: (level, source, message, data = {}) => {
        const logEntry = {
            id: `log_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
            timestamp: new Date().toISOString(),
            level,
            source,
            message,
            data,
            user_id: window._currentUser?.id,
            session_id: typeof getSessionId === 'function' ? getSessionId() : null,
            url: window.location.href,
            user_agent: navigator.userAgent
        };

        // Console output with colors
        const colors = {
            debug: '#808080',
            info: '#0066cc',
            warn: '#ff9900',
            error: '#cc0000',
            fatal: '#990000'
        };

        console.log(
            `%c${logEntry.timestamp.split('T')[1]} [${level.toUpperCase()}] [${source}] ${message}`,
            `color: ${colors[level]}; font-weight: bold;`
        );

        if (Object.keys(data).length > 0) {
            console.log(data);
        }

        // Store in memory
        SystemLogger.queue.push(logEntry);

        // Trim queue
        if (SystemLogger.queue.length > 10000) {
            SystemLogger.queue.shift();
        }

        // Store in DataStore (with sampling for performance)
        if (level === LogLevel.ERROR || level === LogLevel.FATAL || Math.random() < 0.1) {
            DataStore.create('system_logs', logEntry);
        }

        // Send critical logs to server
        if (level === LogLevel.ERROR || level === LogLevel.FATAL) {
            SystemLogger.sendToServer(logEntry);
        }

        return logEntry;
    },

    // Convenience methods
    debug: (source, message, data) => SystemLogger.log(LogLevel.DEBUG, source, message, data),
    info: (source, message, data) => SystemLogger.log(LogLevel.INFO, source, message, data),
    warn: (source, message, data) => SystemLogger.log(LogLevel.WARN, source, message, data),
    error: (source, message, data) => SystemLogger.log(LogLevel.ERROR, source, message, data),
    fatal: (source, message, data) => SystemLogger.log(LogLevel.FATAL, source, message, data),

    // Get logs
    getLogs: (filters = {}) => {
        let logs = [...SystemLogger.queue];

        if (filters.level) {
            logs = logs.filter(l => l.level === filters.level);
        }

        if (filters.source) {
            logs = logs.filter(l => l.source === filters.source);
        }

        if (filters.fromDate) {
            logs = logs.filter(l => new Date(l.timestamp) >= new Date(filters.fromDate));
        }

        if (filters.toDate) {
            logs = logs.filter(l => new Date(l.timestamp) <= new Date(filters.toDate));
        }

        if (filters.search) {
            const searchLower = filters.search.toLowerCase();
            logs = logs.filter(l =>
                l.message.toLowerCase().includes(searchLower) ||
                JSON.stringify(l.data).toLowerCase().includes(searchLower)
            );
        }

        return logs.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
    },

    // Clear logs
    clearLogs: () => {
        SystemLogger.queue = [];
        UI.toast.success('Logs cleared');
    },

    // Export logs
    exportLogs: (format = 'json') => {
        const logs = SystemLogger.getLogs();

        if (format === 'json') {
            const json = JSON.stringify(logs, null, 2);
            const blob = new Blob([json], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `system-logs-${new Date().toISOString()}.json`;
            a.click();
            URL.revokeObjectURL(url);
        } else if (format === 'csv') {
            // Convert to CSV
            const headers = ['timestamp', 'level', 'source', 'message', 'user_id', 'session_id'];
            const csv = [
                headers.join(','),
                ...logs.map(l => [
                    l.timestamp,
                    l.level,
                    l.source,
                    `"${l.message.replace(/"/g, '""')}"`,
                    l.user_id || '',
                    l.session_id || ''
                ].join(','))
            ].join('\n');

            const blob = new Blob([csv], { type: 'text/csv' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `system-logs-${new Date().toISOString()}.csv`;
            a.click();
            URL.revokeObjectURL(url);
        }
    },

    // Send to server
    sendToServer: (logEntry) => {
        if (navigator.onLine) {
            fetch('/api/logs', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(logEntry)
            }).catch(err => console.error('Failed to send log to server:', err));
        }
    },

    // Get log statistics
    getStats: (minutes = 60) => {
        const cutoff = new Date(Date.now() - minutes * 60 * 1000);
        const recent = SystemLogger.queue.filter(l => new Date(l.timestamp) >= cutoff);

        const stats = {
            total: recent.length,
            by_level: {},
            by_source: {},
            errors: recent.filter(l => l.level === LogLevel.ERROR || l.level === LogLevel.FATAL).length
        };

        recent.forEach(l => {
            stats.by_level[l.level] = (stats.by_level[l.level] || 0) + 1;
            stats.by_source[l.source] = (stats.by_source[l.source] || 0) + 1;
        });

        return stats;
    }
};

// Show system logs viewer
const showSystemLogs = () => {
    const logs = SystemLogger.getLogs({ fromDate: new Date(Date.now() - 24 * 60 * 60 * 1000) });
    const stats = SystemLogger.getStats(1440); // Last 24 hours

    let logsHTML = '';
    logs.slice(0, 100).forEach(log => {
        logsHTML += `
            <tr onclick="app.showLogDetails('${log.id}')">
                <td>${new Date(log.timestamp).toLocaleString()}</td>
                <td><span class="log-level ${log.level}">${log.level}</span></td>
                <td>${log.source}</td>
                <td>${log.message}</td>
                <td>${log.user_id || '-'}</td>
                <td><button class="btn-icon"><i class="fas fa-eye"></i></button></td>
            </tr>
        `;
    });

    const content = `
        <div class="system-logs-viewer">
            <div class="logs-header">
                <h3>System Logs</h3>
                <div class="log-stats">
                    <span class="stat-badge">Total: ${stats.total}</span>
                    <span class="stat-badge error">Errors: ${stats.errors}</span>
                    <span class="stat-badge info">Info: ${stats.by_level.info || 0}</span>
                    <span class="stat-badge warn">Warnings: ${stats.by_level.warn || 0}</span>
                </div>
            </div>
            
            <div class="log-filters">
                <select id="log-level-filter" class="form-control">
                    <option value="">All Levels</option>
                    <option value="debug">Debug</option>
                    <option value="info">Info</option>
                    <option value="warn">Warn</option>
                    <option value="error">Error</option>
                    <option value="fatal">Fatal</option>
                </select>
                
                <select id="log-source-filter" class="form-control">
                    <option value="">All Sources</option>
                    ${Object.values(LogSource).map(s =>
        `<option value="${s}">${s}</option>`
    ).join('')}
                </select>
                
                <input type="text" id="log-search" class="form-control" placeholder="Search logs...">
                
                <button class="btn primary" onclick="app.filterLogs()">Apply</button>
                <button class="btn secondary" onclick="app.clearLogs()">Clear</button>
                <button class="btn secondary" onclick="app.exportLogs()">Export</button>
            </div>
            
            <table class="logs-table">
                <thead>
                    <tr>
                        <th>Timestamp</th>
                        <th>Level</th>
                        <th>Source</th>
                        <th>Message</th>
                        <th>User</th>
                        <th></th>
                    </tr>
                </thead>
                <tbody>
                    ${logsHTML}
                </tbody>
            </table>
        </div>
    `;

    UI.showModal('System Logs', content, [
        { label: 'Close', type: 'secondary', action: 'UI.hideModal()' }
    ], 'fullscreen');
};
