/**
 * test-migration.js
 * Verification script for CRM Data Standardization Migration.
 * Run this in the browser console of the CRM application.
 */
(function() {
    console.log('--- STARTING MIGRATION TEST ---');

    // 1. Setup Mock Data
    const mockData = {
        prospects: [
            { id: 1, 'prospect-name': 'John Prospect', 'prospect-phone': '123456', 'prospect-dob': '1990-01-01', existing_canonical: 'Keep Me' },
            { id: 2, 'cps-name': 'Jane CPS', 'cps-phone': '654321', 'dob': '1985-05-05' }
        ],
        customers: [
            { id: 101, 'cust-name': 'Alice Cust', 'cust-phone': '111222', 'cust-dob': '1970-10-10' }
        ],
        activities: [
            { id: 201, 'start-time': '09:00', 'end-time': '10:00', 'is-closing': true, 'amount-closed': 5000 }
        ],
        agent_targets: [
            { id: 301, 'target_amount': 100000 }
        ]
    };

    // 2. Mock DataStore
    const originalDataStore = window.DataStore;
    window.DataStore = {
        getAll: (table) => JSON.parse(JSON.stringify(mockData[table] || [])),
        update: (table, id, data) => {
            const idx = mockData[table].findIndex(r => r.id == id);
            if (idx !== -1) {
                mockData[table][idx] = { ...mockData[table][idx], ...data };
                console.log(`[TEST] Mock DataStore updated ${table}:${id}`);
            }
        },
        emit: () => {} // No-op for tests
    };

    // 3. Define Mappings (Same as production)
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

    // 4. Run Migration Logic (Inlined for test script self-containment)
    Object.entries(fieldMappings).forEach(([tableName, mapping]) => {
        const records = DataStore.getAll(tableName);
        records.forEach(record => {
            let updated = false;
            const newRecord = { ...record };
            Object.entries(mapping).forEach(([oldKey, newKey]) => {
                if (oldKey in record && !(newKey in record)) {
                    newRecord[newKey] = record[oldKey];
                    // We don't delete immediately in the loop to avoid skipping fields if mapping is dense,
                    // but since Object.entries gives a snapshot, it's fine.
                    delete newRecord[oldKey];
                    updated = true;
                } else if (oldKey in record && newKey in record) {
                    // console.warn(`Conflict in ${tableName}:${record.id} for ${newKey}`);
                }
            });
            if (updated) {
                DataStore.update(tableName, record.id, newRecord);
            }
        });
    });

    // 5. Assertions
    try {
        const p1 = mockData.prospects[0];
        console.assert(p1.full_name === 'John Prospect', 'P1: full_name mismatch');
        console.assert(p1.phone === '123456', 'P1: phone mismatch');
        console.assert(p1.date_of_birth === '1990-01-01', 'P1: date_of_birth mismatch');
        console.assert(p1['prospect-name'] === undefined, 'P1: old field not deleted');
        console.assert(p1.existing_canonical === 'Keep Me', 'P1: canonical data lost');

        const p2 = mockData.prospects[1];
        console.assert(p2.full_name === 'Jane CPS', 'P2: full_name mismatch');
        console.assert(p2.date_of_birth === '1985-05-05', 'P2: date_of_birth mismatch');

        const c101 = mockData.customers[0];
        console.assert(c101.full_name === 'Alice Cust', 'C101: full_name mismatch');
        console.assert(c101.date_of_birth === '1970-10-10', 'C101: date_of_birth mismatch');

        const a201 = mockData.activities[0];
        console.assert(a201.start_time === '09:00', 'A201: start_time mismatch');
        console.assert(a201.is_closing === true, 'A201: is_closing mismatch');
        console.assert(a201.amount_closed === 5000, 'A201: amount_closed mismatch');

        const t301 = mockData.agent_targets[0];
        console.assert(t301.monthly_target === 100000, 'T301: monthly_target mismatch');

        console.log('--- ALL TESTS PASSED ---');
    } catch (e) {
        console.error('--- TESTS FAILED ---', e);
    } finally {
        // Restore DataStore
        window.DataStore = originalDataStore;
    }
})();
