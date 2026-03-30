/**
 * migration-standardize-fields.js
 * Data Standardization Migration for Feng Shui CRM V8.7
 * 
 * Instructions:
 * 1. Open your CRM in the browser.
 * 2. Export/Backup your localStorage data first (Application tab).
 * 3. Copy-paste this entire script into the browser console.
 * 4. Verify output in Dry Run mode (enabled by default).
 * 5. Change 'const dryRun = true;' to 'false' to apply changes.
 */
(function() {
    if (!window.DataStore) {
        console.error('DataStore not found. Please ensure data.js is loaded.');
        return;
    }

    // ---------- SETTINGS ----------
    const dryRun = true; // CHANGE TO false TO ACTUALLY SAVE CHANGES

    // ---------- MAPPING ----------
    // Authoritative mapping based on V8.7 Data Standardization Specification
    const fieldMappings = {
        prospects: {
            'prospect-name': 'full_name',
            'cps-name': 'full_name',
            'prospect-nickname': 'nickname',
            'cps-nickname': 'nickname',
            'prospect-title': 'title',
            'prospect-gender': 'gender',
            'prospect-nationality': 'nationality',
            'prospect-phone': 'phone',
            'cps-phone': 'phone',
            'prospect-email': 'email',
            'cps-email': 'email',
            'prospect-ic': 'ic_number',
            'cps-ic': 'ic_number',
            'prospect-dob': 'date_of_birth',
            'cps-dob': 'date_of_birth',
            'dob': 'date_of_birth',
            'prospect-lunar': 'lunar_birth',
            'cps-lunar': 'lunar_birth',
            'prospect-minggua': 'ming_gua',
            'cps-gua': 'ming_gua',
            'prospect-occupation': 'occupation',
            'cps-occupation': 'occupation',
            'prospect-company': 'company_name',
            'cps-company': 'company_name',
            'prospect-income': 'income_range',
            'cps-income': 'income_range',
            'prospect-address': 'address',
            'cps-address': 'address',
            'prospect-city': 'city',
            'cps-city': 'city',
            'prospect-state': 'state',
            'cps-state': 'state',
            'prospect-postal': 'postal_code',
            'cps-zip': 'postal_code'
        },
        customers: {
            'cust-name': 'full_name',
            'cust-phone': 'phone',
            'cust-email': 'email',
            'cust-ic': 'ic_number',
            'cust-dob': 'date_of_birth',
            'dob': 'date_of_birth',
            'cust-postal': 'postal_code'
        },
        activities: {
            'meeting-title': 'activity_title',
            'start-time': 'start_time',
            'end-time': 'end_time',
            'location-address': 'location_address',
            'compass-needed': 'compass_needed',
            'is-closing': 'is_closing',
            'solution-sold': 'solution_sold',
            'amount-closed': 'amount_closed',
            'payment-method': 'payment_method',
            'pop-monthly-amount': 'pop_monthly_amount',
            'pop-tenure': 'pop_tenure',
            'pop-down-payment': 'pop_down_payment',
            'invoice-number': 'invoice_number',
            'collection-date': 'collection_date',
            'redemption-image': 'redemption_image',
            'unable-to-serve': 'unable_to_serve',
            'unable-reason': 'unable_reason',
            'note-key-points': 'note_key_points',
            'note-outcome': 'note_outcome',
            'note-next-steps': 'note_next_steps',
            'note-needs': 'note_needs',
            'note-pain-points': 'note_pain_points'
        },
        referrals: {
            'date': 'referral_date'
        },
        case_studies: {
            'case-title': 'title',
            'case-prospect-id': 'prospect_id',
            'case-customer-id': 'customer_id',
            'case-product': 'product',
            'case-amount': 'amount',
            'case-closing-date': 'closing_date',
            'case-is-public': 'is_public',
            'case-cps-details': 'cps_invitation_details',
            'case-closing-details': 'closing_details',
            'case-sales-idea': 'sales_idea',
            'case-plan-details': 'plan_details',
            'case-success-story': 'success_story'
        },
        lead_scores: {
            'overall_score': 'score'
        },
        agent_targets: {
            'target_amount': 'monthly_target'
        },
        promotions: {
            'package_name': 'name'
        }
    };

    console.log(`%c[MIGRATION] Starting ${dryRun ? 'DRY RUN' : 'PRODUCTION'} migration...`, 'color: #0d9488; font-weight: bold;');

    function migrateTable(tableName, mapping) {
        const records = DataStore.getAll(tableName);
        if (!records || records.length === 0) {
            console.log(`[${tableName}] No records found. Skipping.`);
            return;
        }

        let migratedCount = 0;
        let conflictCount = 0;

        records.forEach(record => {
            let updated = false;
            const newRecord = { ...record };

            Object.entries(mapping).forEach(([oldKey, newKey]) => {
                if (oldKey in record) {
                    if (!(newKey in record)) {
                        newRecord[newKey] = record[oldKey];
                        delete newRecord[oldKey];
                        updated = true;
                        console.log(`%c[${tableName}] ID ${record.id}: Migrating '${oldKey}' -> '${newKey}'`, 'color: #2563eb;');
                    } else if (record[oldKey] !== record[newKey]) {
                        conflictCount++;
                        console.warn(`[${tableName}] ID ${record.id}: Conflict! Both '${oldKey}' and '${newKey}' exist with different values. Skipping attribute.`);
                    } else {
                        // Already exists and values match, just delete old key
                        delete newRecord[oldKey];
                        updated = true;
                        console.log(`[${tableName}] ID ${record.id}: Cleaned up redundant '${oldKey}'`);
                    }
                }
            });

            if (updated) {
                migratedCount++;
                if (!dryRun) {
                    DataStore.update(tableName, record.id, newRecord);
                }
            }
        });

        console.log(`%c[${tableName}] Summary: ${migratedCount} modified, ${conflictCount} conflicts.`, 'font-weight: bold;');
    }

    // Execute for all tables
    Object.entries(fieldMappings).forEach(([table, mapping]) => {
        migrateTable(table, mapping);
    });

    console.log(`%c[MIGRATION] ${dryRun ? 'DRY RUN COMPLETE. No data was saved.' : 'PRODUCTION MIGRATION COMPLETE.'}`, 'color: #0d9488; font-weight: bold; border-top: 2px solid #0d9488; padding-top: 10px;');
    if (dryRun) {
        console.log('%cTo apply changes, set "dryRun = false" in the script and run again.', 'font-style: italic; color: #6b7280;');
    }
})();
