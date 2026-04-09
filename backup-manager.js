// ========== BACKUP & RESTORE MANAGEMENT ==========

// Backup status
const BackupStatus = {
    PENDING: 'pending',
    IN_PROGRESS: 'in_progress',
    COMPLETED: 'completed',
    FAILED: 'failed',
    RESTORING: 'restoring'
};

// Backup types
const BackupType = {
    FULL: 'full',
    INCREMENTAL: 'incremental',
    SCHEMA: 'schema',
    DATA: 'data'
};

// Backup Manager
const BackupManager = {
    // Create backup
    createBackup: async (options = {}) => {
        const backupId = `backup_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

        const backup = {
            id: backupId,
            name: options.name || `Backup ${new Date().toLocaleString()}`,
            type: options.type || BackupType.FULL,
            status: BackupStatus.PENDING,
            size: null,
            records_backed_up: 0,
            created_at: new Date().toISOString(),
            created_by: _currentUser?.id,
            scheduled: options.scheduled || false,
            retention_days: options.retention_days || 30,
            expires_at: new Date(Date.now() + (options.retention_days || 30) * 24 * 60 * 60 * 1000).toISOString(),
            include_tables: options.include_tables || Object.keys(TABLES),
            exclude_tables: options.exclude_tables || [],
            compression: options.compression !== false,
            encrypted: options.encrypted !== false
        };

        AppDataStore.create('backups', backup);

        // Start backup process
        BackupManager.processBackup(backupId);

        return backup;
    },

    // Process backup
    processBackup: async (backupId) => {
        const backup = AppDataStore.getById('backups', backupId);
        if (!backup) return null;

        // Update status
        backup.status = BackupStatus.IN_PROGRESS;
        backup.started_at = new Date().toISOString();
        AppDataStore.update('backups', backupId, backup);

        try {
            const backupData = {};
            let totalRecords = 0;

            // Backup each table
            for (const table of backup.include_tables) {
                if (backup.exclude_tables.includes(table)) continue;

                const records = AppDataStore.getAll(table);
                backupData[table] = records;
                totalRecords += records.length;
            }

            // Add metadata
            backupData._metadata = {
                version: '1.0',
                created_at: new Date().toISOString(),
                tables: backup.include_tables,
                record_counts: Object.fromEntries(
                    Object.entries(backupData).map(([table, records]) => [table, records.length])
                ),
                created_by: backup.created_by
            };

            // Convert to JSON
            let backupJson = JSON.stringify(backupData);
            const size = new Blob([backupJson]).size;

            // Compress if enabled
            if (backup.compression) {
                // In production, use actual compression
                backupJson = `compressed_${backupJson}`;
            }

            // Encrypt if enabled
            if (backup.encrypted) {
                const key = await getEncryptionKey();
                backupJson = await Encryption.encrypt(backupJson, await Encryption.importKey(key));
            }

            // Store backup data in Supabase backups table
            await AppDataStore.update('backups', backupId, { backup_data: backupJson });

            // Update backup record
            backup.status = BackupStatus.COMPLETED;
            backup.completed_at = new Date().toISOString();
            backup.size = size;
            backup.records_backed_up = totalRecords;
            backup.file_location = `backup_${backupId}`;
            AppDataStore.update('backups', backupId, backup);

            // Audit log
            AuditLogger.info(
                AuditCategory.BACKUP,
                'backup_created',
                {
                    backup_id: backupId,
                    size: size,
                    records: totalRecords
                }
            );

            // Cleanup old backups
            BackupManager.cleanupOldBackups();

            return backup;
        } catch (error) {
            console.error('Backup failed:', error);

            backup.status = BackupStatus.FAILED;
            backup.error = error.message;
            backup.failed_at = new Date().toISOString();
            AppDataStore.update('backups', backupId, backup);

            AuditLogger.error(
                AuditCategory.BACKUP,
                'backup_failed',
                {
                    backup_id: backupId,
                    error: error.message
                }
            );

            return null;
        }
    },

    // Restore from backup
    restoreBackup: async (backupId, options = {}) => {
        const backup = AppDataStore.getById('backups', backupId);
        if (!backup) return null;

        // Update status
        backup.restore_status = BackupStatus.RESTORING;
        backup.restore_started_at = new Date().toISOString();
        AppDataStore.update('backups', backupId, backup);

        try {
            // Get backup data from Supabase
            const backupRecord = await AppDataStore.getById('backups', backupId);
            const backupJson = backupRecord?.backup_data;
            if (!backupJson) throw new Error('Backup file not found');

            let backupData = backupJson;

            // Decrypt if encrypted
            if (backup.encrypted) {
                const key = await getEncryptionKey();
                backupData = await Encryption.decrypt(backupData, await Encryption.importKey(key));
            }

            // Decompress if compressed
            if (backup.compression && backupData.startsWith('compressed_')) {
                backupData = backupData.substring(11);
            }

            // Parse JSON
            const data = JSON.parse(backupData);

            // Restore tables
            const tablesToRestore = options.tables || backup.include_tables;

            for (const table of tablesToRestore) {
                if (data[table]) {
                    // Clear existing data if specified
                    if (options.clearExisting) {
                        const existing = AppDataStore.getAll(table);
                        existing.forEach(record => {
                            AppDataStore.delete(table, record.id);
                        });
                    }

                    // Restore records
                    for (const record of data[table]) {
                        AppDataStore.create(table, record);
                    }
                }
            }

            // Update backup status
            backup.restore_status = BackupStatus.COMPLETED;
            backup.restore_completed_at = new Date().toISOString();
            backup.restored_by = _currentUser?.id;
            AppDataStore.update('backups', backupId, backup);

            // Audit log
            AuditLogger.critical(
                AuditCategory.BACKUP,
                'backup_restored',
                {
                    backup_id: backupId,
                    tables: tablesToRestore
                }
            );

            UI.toast.success('Backup restored successfully');

            return true;
        } catch (error) {
            console.error('Restore failed:', error);

            backup.restore_status = BackupStatus.FAILED;
            backup.restore_error = error.message;
            AppDataStore.update('backups', backupId, backup);

            AuditLogger.error(
                AuditCategory.BACKUP,
                'restore_failed',
                {
                    backup_id: backupId,
                    error: error.message
                }
            );

            UI.toast.error('Restore failed: ' + error.message);

            return false;
        }
    },

    // Schedule automatic backup
    scheduleBackup: (schedule) => {
        const job = {
            id: `backup_job_${Date.now()}`,
            frequency: schedule.frequency, // 'daily', 'weekly', 'monthly'
            time: schedule.time, // '02:00'
            day_of_week: schedule.day_of_week, // for weekly
            day_of_month: schedule.day_of_month, // for monthly
            type: schedule.type || BackupType.FULL,
            retention_days: schedule.retention_days || 30,
            enabled: true,
            last_run: null,
            next_run: BackupManager.calculateNextRun(schedule),
            created_at: new Date().toISOString(),
            created_by: _currentUser?.id
        };

        AppDataStore.create('backup_schedules', job);

        return job;
    },

    // Calculate next run time
    calculateNextRun: (schedule) => {
        const now = new Date();
        const [hours, minutes] = (schedule.time || '02:00').split(':').map(Number);

        if (schedule.frequency === 'daily') {
            const next = new Date(now);
            next.setHours(hours, minutes, 0, 0);
            if (next <= now) {
                next.setDate(next.getDate() + 1);
            }
            return next.toISOString();
        }

        // For weekly/monthly, simplified
        return new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString();
    },

    // Cleanup old backups
    cleanupOldBackups: () => {
        const backups = AppDataStore.getAll('backups');
        const now = new Date();

        backups.forEach(backup => {
            if (backup.expires_at && new Date(backup.expires_at) < now) {
                // Clear backup data from Supabase record before deleting
                AppDataStore.update('backups', backup.id, { backup_data: null }).catch(() => {});

                // Delete record
                AppDataStore.delete('backups', backup.id);
            }
        });
    },

    // List all backups
    listBackups: (filters = {}) => {
        let backups = AppDataStore.getAll('backups').sort((a, b) =>
            new Date(b.created_at) - new Date(a.created_at)
        );

        if (filters.type) {
            backups = backups.filter(b => b.type === filters.type);
        }

        if (filters.status) {
            backups = backups.filter(b => b.status === filters.status);
        }

        if (filters.fromDate) {
            backups = backups.filter(b => new Date(b.created_at) >= new Date(filters.fromDate));
        }

        if (filters.toDate) {
            backups = backups.filter(b => new Date(b.created_at) <= new Date(filters.toDate));
        }

        return backups;
    },

    // Download backup
    downloadBackup: async (backupId) => {
        const backup = await AppDataStore.getById('backups', backupId);
        if (!backup) return;

        const backupRecord = await AppDataStore.getById('backups', backupId);
        const backupData = backupRecord?.backup_data;
        if (!backupData) return;

        const blob = new Blob([backupData], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `crm-backup-${new Date(backup.created_at).toISOString().split('T')[0]}.json`;
        a.click();
        URL.revokeObjectURL(url);
    }
};
