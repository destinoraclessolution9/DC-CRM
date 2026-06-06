/**
 * CRM Lazy Chunk: Activity Modal + Appointment + Push Notifications + Past Record
 * Covers: openActivityModal, saveActivity, searchConsultants, searchEntities,
 *   selectEntity, openPastRecordModal, and all sub-handlers.
 * Loaded on-demand when activity modal is first opened.
 * Extracted 2026-06-05 (~4528 lines).
 */
(() => {
    const _state  = window._appState;
    const _utils  = window._crmUtils;
    const esc     = (...a) => _utils.escapeHtml(...a);
    const escapeHtml = esc;
    const getVisibleUserIds = (u) => _utils.getVisibleUserIds(u);
    const isMobile = () => _utils.isMobile();
    const isSystemAdmin        = (u) => _utils.isSystemAdmin(u || _state.cu);
    const isMarketingManager   = (u) => _utils.isMarketingManager(u || _state.cu);
    const isAgent              = (u) => _utils.isAgent(u || _state.cu);
    const isManagement         = (u) => _utils.isManagement(u || _state.cu);
    const isTeamLeaderOrAbove  = (u) => _utils.isTeamLeaderOrAbove(u || _state.cu);
    const getUserLevel         = (u) => _utils.getUserLevel(u);
    const getAgentsAndLeaders  = () => _utils.getAgentsAndLeaders();
    // ========== PHASE 2: ACTIVITY MODAL FUNCTIONS ==========

    const openActivityModal = async (prefillDate = null, prospectId = null, activity = null) => {
        const today = new Date().toISOString().split('T')[0];

        // Reset all temporary state to avoid interference between uses
        _state.sat = [];
        _state.sca = [];
        _state.scon = [];
        _state.se = null;
        _state.sr = null;
        window._cpsDuplicateConfirmed = false;

        // Pre-fetch lookup data BEFORE building the template (safer than await inside template literals).
        // Cached helpers turn this from two network round-trips per modal open into
        // an instant cache hit after the first call — which is the difference
        // between a snappy day-tap and a 1-3s freeze on mobile.
        const _venueData = await _getVenuesCached();
        const _venueOptions = (_venueData || [])
            .sort((a, b) => (a.sequence || 0) - (b.sequence || 0))
            .map(v => `<option value="${v.name} | ${v.location}">${v.name} | ${v.location}</option>`)
            .join('');
        const _productOptions = (await _getProductsCached())
            .filter(p => p.is_active !== false)
            .map(p => `<option value="${p.name}">${p.name}</option>`)
            .join('') || '<option value="">No products available</option>';

        const modalContent = `
            <div class="activity-modal-form">
                <div class="form-group">
                    <label>Activity Type <span class="required">*</span></label>
                    <select id="modal-activity-type" class="form-control" onchange="app.updateActivityForm()">
                        <option value="CPS">🟢 CPS - Consultation/Planning Session</option>
                        <option value="FTF">🔵 FTF - Face to Face Meeting</option>
                        <option value="FSA">🟠 FSA - Feng Shui Analysis</option>
                        <option value="GR">🟣 Golden Road</option>
                        <option value="EVENT">🔴 Event</option>
                        <option value="AGENT_MEETING">📅 Agent Weekly Meeting</option>
                        <option value="AGENT_TRAINING">🎓 Agent Training</option>
                        <option value="SITE">🟤 Site Visit</option>
                        <option value="XG">🟤 XG - Xin Gua</option>
                        <option value="CALL">📞 Call</option>
                        <option value="EMAIL">📧 Email</option>
                        <option value="WHATSAPP">💬 WhatsApp</option>
                        <option value="PERSONAL">🏠 Personal</option>
                        <option value="OTHERS">📌 Others</option>
                    </select>
                </div>
                
                <div id="dynamic-form-fields">
                    <!-- Fields will be dynamically inserted here -->
                </div>
                
                <div class="form-section">
                    <h4>🧑‍💼 Appointment's Consultant</h4>
                    <div class="form-group">
                        <div class="search-with-results" style="position:relative;">
                            <input type="text" id="consultant-search-input" class="form-control" placeholder="Search consultant..." oninput="app.debounceCall('consultant-search', () => app.searchConsultants(), 250)">
                            <div id="consultant-search-results" class="search-results-dropdown"></div>
                        </div>
                        <div id="selected-consultants-list" style="margin-top:8px;"></div>
                    </div>
                </div>

                <div class="form-section">
                    <h4>👥 Co-Agent Assignment</h4>
                    <div class="form-group">
                        <label class="toggle-switch">
                            <input type="checkbox" id="allow-join" onchange="app.toggleCoAgentSection()">
                            <span class="toggle-label">Allow Join</span>
                        </label>
                    </div>
                </div>
                    
                <div id="co-agent-section" style="display: none; background: #f0fdfa; padding: 12px; border-radius: 8px; margin-bottom: 20px; border: 1px solid #ccfbf1;">
                    <div class="form-group">
                        <label>Search and Add Co-Agents</label>
                        <div class="co-agent-search" style="position:relative;">
                            <input type="text" id="co-agent-search-input" class="form-control" placeholder="Type consultant name..." oninput="app.debounceCall('co-agent-search-2', () => app.searchAgents(), 250)">
                            <div id="agent-search-results" class="search-results-dropdown"></div>
                        </div>
                    </div>
                    
                    <div id="selected-co-agents" class="co-agent-list">
                        <!-- Selected co-agents will appear here -->
                    </div>
                    <p class="help-text">Maximum 5 co-agents. They will receive calendar invitations.</p>
                </div>
                
                <div class="form-section">
                    <h4>📅 Date & Time</h4>
                    <div class="form-row">
                        <div class="form-group half">
                            <label>Date</label>
                            <input type="date" id="activity-date" class="form-control" value="${prefillDate || today}">
                        </div>
                        <div class="form-group half">
                            <label>Start Time</label>
                            <input type="time" id="start-time" class="form-control" value="09:00" onchange="app.onStartTimeChange()">
                        </div>
                    </div>
                    <div class="form-row">
                        <div class="form-group half">
                            <label>End Time</label>
                            <input type="time" id="end-time" class="form-control" value="10:00" onchange="app.onEndTimeChange()">
                        </div>
                        <div class="form-group half">
                            <label>Duration</label>
                            <input type="text" id="duration" class="form-control" readonly value="60 min">
                        </div>
                    </div>
                    <div class="form-group">
                        <label>Venue <span id="venue-required-star" class="required" style="display:none;">*</span></label>
                        <select id="activity-venue" class="form-control">
                            <option value="">-- Select Venue --</option>
                            ${_venueOptions}
                        </select>
                    </div>
                </div>

                <div class="form-section">
                    <h4>📝 Remarks</h4>
                    <div class="form-group">
                        <textarea id="activity-remarks" class="form-control" rows="3" placeholder="Add any notes or remarks..."></textarea>
                    </div>
                </div>

                <div id="cps-summary-section" class="form-section" style="display:none">
                    <h4>📝 Summary</h4>
                    <div class="form-group">
                        <label>Summary</label>
                        <textarea id="cps-summary" class="form-control" rows="3" placeholder="Why is the customer interested to do the CPS? What is the reason they want to come?"></textarea>
                    </div>
                </div>

                <div class="form-section" style="display:none">
                    <h4>📝 Meeting Outcome</h4>
                    <div class="form-group">
                        <label class="checkbox-label">
                            <input type="checkbox" id="is-closing" onchange="document.getElementById('closing-fields').style.display = this.checked ? 'block' : 'none'"> Case Closed Well Done!
                        </label>
                    </div>
                    
                    <div id="closing-fields" style="display: none; padding-left: 20px;">
                        <div class="form-group">
                            <label>Product/Service Sold</label>
                            <select id="solution-sold" class="form-control">
                                ${_productOptions}
                            </select>
                        </div>
                        <div class="form-row">
                            <div class="form-group half">
                                <label>Amount Closed (RM)</label>
                                <input type="number" id="amount-closed" class="form-control" placeholder="0.00">
                            </div>
                            <div class="form-group half">
                                <label>Payment Method</label>
                                <select id="payment-method" class="form-control" onchange="document.getElementById('pop-fields').style.display = this.value === 'POP' ? 'block' : 'none'">
                                    <option value="Cash">Cash</option>
                                    <option value="Bank Transfer">Bank Transfer</option>
                                    <option value="Credit Card">Credit Card</option>
                                    <option value="Cheque">Cheque</option>
                                    <option value="POP">POP</option>
                                </select>
                            </div>
                        </div>
                        <div id="pop-fields" style="display: none; background: var(--gray-50); padding: 12px; border-radius: 6px; margin-bottom: 12px;">
                            <div class="form-row">
                                <div class="form-group half">
                                    <label>Payment Amount per Month (RM)</label>
                                    <input type="number" id="pop-monthly-amount" class="form-control" placeholder="0.00">
                                </div>
                                <div class="form-group half">
                                    <label>Tenure (months)</label>
                                    <input type="number" id="pop-tenure" class="form-control" placeholder="12">
                                </div>
                            </div>
                            <div class="form-row">
                                <div class="form-group half">
                                    <label>Down Payment Collected (RM)</label>
                                    <input type="number" id="pop-down-payment" class="form-control" placeholder="0.00">
                                </div>
                            </div>
                        </div>
                        <div class="form-row">
                            <div class="form-group half">
                                <label>Invoice Number</label>
                                <input type="text" id="invoice-number" class="form-control" placeholder="INV-2026-001">
                            </div>
                            <div class="form-group half">
                                <label>Collection Date</label>
                                <input type="date" id="collection-date" class="form-control">
                            </div>
                        </div>
                        <div class="form-group">
                            <label>Upload Purchased Invoices</label>
                            <input type="file" id="redemption-image" class="form-control" accept="image/png, image/jpeg">
                        </div>

                        <div id="case-study-section" style="margin-top:20px; border-top:1px solid #eee; padding-top:10px;">
                            <h5>📁 Case Study (Optional)</h5>
                            <div class="form-group">
                                <label>Sales Idea</label>
                                <textarea id="case-sales-idea" class="form-control" rows="2" placeholder="Describe the sales idea..."></textarea>
                            </div>
                            <div class="form-group">
                                <label>Plan Details</label>
                                <textarea id="case-plan-details" class="form-control" rows="2" placeholder="Details of the plan proposed..."></textarea>
                            </div>
                            <div class="form-group">
                                <label>Success Story</label>
                                <textarea id="case-success-story" class="form-control" rows="2" placeholder="What made this a success?"></textarea>
                            </div>
                        </div>
                    </div>
                    
                    <div class="form-group">
                        <label class="checkbox-label">
                            <input type="checkbox" id="unable-to-serve" onchange="document.getElementById('unable-to-serve-fields').style.display = this.checked ? 'block' : 'none'"> Unable to Serve
                        </label>
                    </div>
                    
                    <div id="unable-to-serve-fields" style="display: none; padding-left: 20px;">
                        <div class="form-group">
                            <label>Reason</label>
                            <textarea id="unable-reason" class="form-control" rows="2" placeholder="Why unable to serve..."></textarea>
                        </div>
                    </div>

                </div>

                <div class="form-section" style="display:none">
                    <h4>📝 Post-Meetup Notes</h4>
                    <div class="form-group">
                        <label>Key Points Discussed:</label>
                        <div style="display:flex; gap:8px;">
                            <textarea id="note-key-points" class="form-control" rows="2" placeholder="Main discussion points..."></textarea>
                            <button class="btn-icon" onclick="app.openVoiceRecorder('note-key-points', 'activity', null)" title="Record voice note" style="color:var(--primary);"><i class="fas fa-microphone"></i></button>
                        </div>
                    </div>
                    <div class="form-group">
                        <label>Outcome:</label>
                        <div style="display:flex; gap:8px;">
                            <textarea id="note-outcome" class="form-control" rows="2" placeholder="What was the result?"></textarea>
                            <button class="btn-icon" onclick="app.openVoiceRecorder('note-outcome', 'activity', null)" title="Record voice note" style="color:var(--primary);"><i class="fas fa-microphone"></i></button>
                        </div>
                    </div>
                    <div class="form-group">
                        <label>Next Steps:</label>
                        <div style="display:flex; gap:8px;">
                            <textarea id="note-next-steps" class="form-control" rows="2" placeholder="Action items..."></textarea>
                            <button class="btn-icon" onclick="app.openVoiceRecorder('note-next-steps', 'activity', null)" title="Record voice note" style="color:var(--primary);"><i class="fas fa-microphone"></i></button>
                        </div>
                    </div>
                    <div class="form-group">
                        <label>Customer Needs/Interests:</label>
                        <div style="display:flex; gap:8px;">
                            <textarea id="note-needs" class="form-control" rows="2" placeholder="What are they looking for?"></textarea>
                            <button class="btn-icon" onclick="app.openVoiceRecorder('note-needs', 'activity', null)" title="Record voice note" style="color:var(--primary);"><i class="fas fa-microphone"></i></button>
                        </div>
                    </div>
                    <div class="form-group">
                        <label>Pain Points:</label>
                        <div style="display:flex; gap:8px;">
                            <textarea id="note-pain-points" class="form-control" rows="2" placeholder="Dislikes or problems to solve..."></textarea>
                            <button class="btn-icon" onclick="app.openVoiceRecorder('note-pain-points', 'activity', null)" title="Record voice note" style="color:var(--primary);"><i class="fas fa-microphone"></i></button>
                        </div>
                    </div>
                </div>
            </div>
        `;

        UI.showModal('Quick Add Activity', modalContent, [
            { label: 'Cancel', type: 'secondary', action: 'UI.hideModal()' },
            { label: 'Save & Add Another', type: 'secondary', action: '(async () => { await app.saveAndAddAnother(); })()' },
            { label: 'Save Activity', type: 'primary', action: '(async () => { await app.saveActivity(); })()' }
        ]);

        await updateActivityForm();

        if (activity) {
            setTimeout(() => {
                fillActivityForm(activity);
            }, 300); // Increased timeout to ensure DOM is ready
        }

        // If prospectId is provided, pre-select it and pre-fill CPS fields
        if (prospectId) {
            setTimeout(async () => {
                const prospect = await AppDataStore.getById('prospects', prospectId);
                if (prospect) {
                    _state.se = { id: prospectId, type: 'Prospect' };
                    const infoDiv = document.getElementById('selected-entity-info');
                    if (infoDiv) {
                        infoDiv.innerHTML = `
                            <div class="selected-entity-badge">
                                <span>Prospect: <strong>${prospect.full_name}</strong></span>
                                <button class="btn btn-sm secondary" onclick="app.clearSelectedEntity()">Clear</button>
                            </div>
                        `;
                    }
                    // Pre-fill CPS fields when activity type is CPS (default)
                    let attempts = 0;
                    const cpsInterval = setInterval(() => {
                        const cpsName = document.getElementById('cps-name');
                        if (cpsName) {
                            const setF = (id, val) => { const el = document.getElementById(id); if (el) el.value = val || ''; };
                            setF('cps-name', prospect.full_name);
                            setF('cps-nickname', prospect.nickname);
                            setF('cps-phone', prospect.phone);
                            setF('cps-ic', prospect.ic_number);
                            setF('cps-email', prospect.email);
                            setF('cps-dob', prospect.date_of_birth);
                            {
                                const lct = prospect.life_chart_type;
                                const dobChk = document.getElementById('cps-use-dob');
                                const lunarChk = document.getElementById('cps-use-lunar');
                                if (dobChk) dobChk.checked = ['solar','both'].includes(lct);
                                if (lunarChk) lunarChk.checked = ['lunar','both'].includes(lct);
                            }
                            setF('cps-lunar', prospect.lunar_birth);
                            setF('cps-minggua', prospect.ming_gua);
                            setF('cps-occupation', prospect.occupation);
                            setF('cps-company', prospect.company_name);
                            setF('cps-income', prospect.income_range);
                            setF('cps-address', prospect.address);
                            setF('cps-city', prospect.city);
                            setF('cps-state', prospect.state);
                            setF('cps-postal', prospect.postal_code);
                            setF('cps-referrer', prospect.referred_by);
                            setF('cps-relationship', prospect.referral_relationship);
                            clearInterval(cpsInterval);
                        } else if (++attempts >= 12) {
                            clearInterval(cpsInterval);
                        }
                    }, 250);
                }
            }, 200);
        }
    };

    const fillActivityForm = async (activity) => {
    // 1. Set activity type and trigger dynamic form generation
    const typeSelect = document.getElementById('modal-activity-type');
    if (typeSelect) {
        typeSelect.value = activity.activity_type;
        await updateActivityForm();
    } else {
        console.error('modal-activity-type not found');
        return;
    }

    // 2. Helper to safely set field values with logging
    const setField = (id, value) => {
        const el = document.getElementById(id);
        if (el) {
            el.value = value || '';
        } else {
            console.warn(`Field #${id} not found for activity type ${activity.activity_type}`);
        }
    };

    // 3. Wait for the dynamic fields to be async injected (first wave)
    setTimeout(async () => {
        // Common fields for all activity types
        const setField = (id, val) => {
            const el = document.getElementById(id);
            if (el) el.value = val || '';
        };
        setField('activity-date', activity.activity_date);
        setField('start-time', activity.start_time);
        setField('end-time', activity.end_time);
        setField('note-key-points', activity.note_key_points);
        setField('note-outcome', activity.note_outcome);
        setField('note-next-steps', activity.note_next_steps);
        setField('note-needs', activity.note_needs);
        setField('note-pain-points', activity.note_pain_points);
        setField('location-address', activity.location_address);
        // Restore venue dropdown selection — fall back to location_address since we mirror
        // venue there for cross-device persistence (the `venue` column may be missing from
        // the Supabase schema).
        setField('activity-venue', activity.venue || activity.location_address);

        // 4. Restore selected entity (store in module variable)
        let entityRestored = false;
        if (activity.prospect_id) {
            const prospect = await AppDataStore.getById('prospects', activity.prospect_id);
            if (prospect) {
                _state.se = { id: prospect.id, type: 'Prospect' };
                entityRestored = true;
            }
        } else if (activity.customer_id) {
            const customer = await AppDataStore.getById('customers', activity.customer_id);
            if (customer) {
                _state.se = { id: customer.id, type: 'Customer' };
                entityRestored = true;
            }
        }

        // 5. Poll for the entity badge container and render the badge if needed
        if (entityRestored) {
            const badgeContainerId = 'selected-entity-info';
            // Pre-fetch entity name ONCE before polling to avoid DB calls inside interval
            const entityName = _state.se.type === 'Prospect'
                ? (await AppDataStore.getById('prospects', _state.se.id))?.full_name
                : (await AppDataStore.getById('customers', _state.se.id))?.full_name;
            if (entityName) {
                let attempts = 0;
                const badgeInterval = setInterval(() => {
                    const container = document.getElementById(badgeContainerId);
                    if (container) {
                        container.innerHTML = `
                            <div class="selected-entity-badge">
                                <span>${_state.se.type}: <strong>${entityName}</strong></span>
                                <button class="btn btn-sm secondary" onclick="app.clearSelectedEntity()">Clear</button>
                            </div>
                        `;
                        clearInterval(badgeInterval);
                    } else if (++attempts >= 12) { // 12 * 250ms = 3 seconds
                        console.warn('Entity badge container not found after polling');
                        clearInterval(badgeInterval);
                    }
                }, 250);
            }
        }
        // 6. Type-specific fields
        switch (activity.activity_type) {
            case 'FTF':
            case 'GR':
            case 'XG':
            case 'CALL':
            case 'EMAIL':
            case 'WHATSAPP':
                setField('meeting-title', activity.activity_title || '');
                break;
            case 'FSA':
            case ' SITE':
                if (activity.compass_needed) {
                    const chk = document.getElementById('compass-needed');
                    if (chk) chk.checked = true;
                }
                break;
        }

        // 7. Co-agents
        _state.sca = activity.co_agents || [];
        if (typeof renderCoAgents === 'function') renderCoAgents();

        // 8. If this is a CPS activity, poll for CPS-specific fields
        if (activity.activity_type === 'CPS' && activity.prospect_id) {
            const prospect = await AppDataStore.getById('prospects', activity.prospect_id);
            if (prospect) {
                let attempts = 0;
                const cpsInterval = setInterval(() => {
                    const cpsName = document.getElementById('cps-name');
                    if (cpsName) {
                        setField('cps-name', prospect.full_name);
                        setField('cps-nickname', prospect.nickname);
                        setField('cps-phone', prospect.phone);
                        setField('cps-ic', prospect.ic_number);
                        setField('cps-email', prospect.email);
                        setField('cps-dob', prospect.date_of_birth);
                        {
                            const lct = prospect.life_chart_type;
                            const dobChk = document.getElementById('cps-use-dob');
                            const lunarChk = document.getElementById('cps-use-lunar');
                            if (dobChk) dobChk.checked = ['solar','both'].includes(lct);
                            if (lunarChk) lunarChk.checked = ['lunar','both'].includes(lct);
                        }
                        setField('cps-lunar', prospect.lunar_birth);
                        setField('cps-minggua', prospect.ming_gua);
                        setField('cps-occupation', prospect.occupation);
                        setField('cps-company', prospect.company_name);
                        setField('cps-income', prospect.income_range);
                        setField('cps-address', prospect.address);
                        setField('cps-city', prospect.city);
                        setField('cps-state', prospect.state);
                        setField('cps-postal', prospect.postal_code);
                        setField('cps-summary', activity.summary);
                        setField('cps-interest', prospect.cps_interest);
                        clearInterval(cpsInterval);
                    } else if (++attempts >= 12) {
                        console.warn('CPS fields did not appear after polling');
                        clearInterval(cpsInterval);
                    }
                }, 250);
            }
        }

        // 9. Change the modal's save button to "Update Activity"
        const saveBtn = document.querySelector('.modal-footer .btn.primary');
        if (saveBtn) {
            saveBtn.textContent = 'Update Activity';
            saveBtn.onclick = async () => await app.updateActivity(activity.id);
        }
    }, 500);
};

    const updateActivity = async (activityId) => {
    const activity = await _lookupActivityRobust(activityId);
    if (!activity) { UI.toast.error('Activity not found'); return; }

    const venueVal = document.getElementById('activity-venue')?.value;
    const locationAddressEl = document.getElementById('location-address');
    const updatedData = {
        activity_type: document.getElementById('modal-activity-type')?.value,
        activity_date: document.getElementById('activity-date')?.value,
        start_time: document.getElementById('start-time')?.value,
        end_time: document.getElementById('end-time')?.value,
        summary: document.getElementById('cps-summary')?.value?.trim() || document.getElementById('note-key-points')?.value,
        note_key_points: document.getElementById('note-key-points')?.value,
        note_outcome: document.getElementById('note-outcome')?.value,
        note_next_steps: document.getElementById('note-next-steps')?.value,
        note_needs: document.getElementById('note-needs')?.value,
        note_pain_points: document.getElementById('note-pain-points')?.value,
        co_agents: _state.sca,
        // Type‑specific fields
        activity_title: document.getElementById('meeting-title')?.value
    };
    // Save the venue dropdown value when it exists in the form
    if (document.getElementById('activity-venue')) {
        updatedData.venue = venueVal || '';
    }
    // Set location_address from the FSA/SITE address textarea if present, otherwise mirror
    // the venue (so it persists server-side even when the `venue` column is missing from the
    // Supabase schema). Skip entirely if neither is available — don't clobber existing data
    // with `undefined`.
    if (locationAddressEl) {
        updatedData.location_address = locationAddressEl.value || '';
    } else if (venueVal) {
        updatedData.location_address = venueVal;
    }

    // Update entity IDs based on current _state.se
    if (_state.se) {
        if (_state.se.type === 'Prospect') {
            updatedData.prospect_id = _state.se.id;
            updatedData.customer_id = null;
        } else if (_state.se.type === 'Customer') {
            updatedData.customer_id = _state.se.id;
            updatedData.prospect_id = null;
        }
        // Updating with selected entity
    } else {
        updatedData.prospect_id = null;
        updatedData.customer_id = null;
    }

    await AppDataStore.update('activities', activityId, { ...activity, ...updatedData });
    UI.hideModal();
    UI.toast.success('Activity updated');

    // === Auto Milestone: also check on edit in case type/title was set now ===
    try {
        if (_state.cu) {
            const aType = updatedData.activity_type || '';
            const aTitle = (updatedData.activity_title || '').toLowerCase();
            const milestoneMap = [
                { key: 'CPS',           test: () => aType === 'CPS' },
                { key: '9 Stars',       test: () => aTitle.includes('9 star') || aTitle.includes('nine star') },
                { key: 'DIY',           test: () => aTitle.includes('diy') },
                { key: '福气课',         test: () => aTitle.includes('福气') || aTitle.includes('fudi') || aTitle.includes('fu qi') },
                { key: '九运课',         test: () => aTitle.includes('九运') || aTitle.includes('jiuyun') || aTitle.includes('jiu yun') },
                { key: 'Museum',        test: () => aTitle.includes('museum') },
                { key: 'HuiJi',         test: () => aTitle.includes('huiji') || aTitle.includes('hui ji') },
                { key: 'Advance Class', test: () => aTitle.includes('advance') },
                { key: 'Sharing',       test: () => aTitle.includes('sharing') || aType === 'Sharing' }
            ];
            for (const m of milestoneMap) {
                if (m.test()) await markMilestoneCompleted(_state.cu.id, m.key);
            }
        }
    } catch (e) { console.warn('Milestone auto-mark (update) failed:', e); }

    if (typeof renderCalendar === 'function') await (window.app.renderCalendar || (() => {}))();
    if (typeof renderTodayActivities === 'function') await (window.app.renderTodayActivities || (() => {}))();
};

    // ═══════════════════════════════════════════════════════════════════════
    // STANDARD FUNCTION — Basic Information Block
    // Single source of truth for the reusable prospect/customer field set.
    // Used in 3 places:
    //   1. Add / Edit Prospect modal (openProspectModal)
    //   2. Quick Add Activity → CPS type (New Customer Information)
    //   3. Standard Functions admin page (Level 1 only, preview/documentation)
    // To add a new field: update buildBasicInfoBlock + collectBasicInfoData.
    // All 3 call sites pick it up automatically.
    // ═══════════════════════════════════════════════════════════════════════
    const BASIC_INFO_INCOME_RANGES = [
        ['< RM3k', 'Below RM 3,000'],
        ['RM3-5k', 'RM 3,000 – RM 5,000'],
        ['RM5-8k', 'RM 5,001 – RM 8,000'],
        ['RM8-12k', 'RM 8,001 – RM 12,000'],
        ['RM12-20k', 'RM 12,001 – RM 20,000'],
        ['> RM20k', 'Above RM 20,000'],
    ];
    const BASIC_INFO_RELATIONS = ['Friend','Family','Spouse','Siblings','Cousin','Colleague','Ex Colleague','Ex Classmate','Business Partner','Customer'];
    const BASIC_INFO_INTERESTS = [
        ['个人改命', '个人改命 (Personal Destiny Change)'],
        ['风水', '风水 (Feng Shui)'],
        ['画作', '画作 (Calligraphy)'],
        ['满堂系列', '满堂系列 (Bujishu Home Furnishing)'],
        ['Formula', 'Formula Healthcare'],
        ['代理配套', '代理配套 (Agent Package)'],
    ];
    const BASIC_INFO_MING_GUA = [
        ['MG1','MG1 坎'],['MG2','MG2 坤'],['MG3','MG3 震'],['MG4','MG4 巽'],
        ['MG5','MG5'],['MG6','MG6 乾'],['MG7','MG7 兑'],['MG8','MG8 艮'],['MG9','MG9 离']
    ];

    const buildBasicInfoBlock = (prefix, data = null) => {
        const d = data || {};
        const sel = (v, opt) => v === opt ? 'selected' : '';
        const chk = (cond) => cond ? 'checked' : '';
        const esc = (s) => (s == null ? '' : String(s).replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;').replace(/>/g,'&gt;'));
        const relOther = d.referral_relationship
            && !BASIC_INFO_RELATIONS.includes(d.referral_relationship)
            && d.referral_relationship !== 'Other';
        const useDob = ['solar','both'].includes(d.life_chart_type);
        const useLunar = ['lunar','both'].includes(d.life_chart_type) || !data;
        const readOnly = prefix === 'preview';
        const disabled = readOnly ? 'disabled' : '';
        const searchHandler = readOnly ? '' : `oninput="app.debounceCall('${prefix}-referrer', () => app.searchBasicInfoReferrers('${prefix}'), 250)"`;
        const clearHandler = readOnly ? '' : `onclick="app.clearBasicInfoReferrer('${prefix}')"`;

        const scanBtn = readOnly ? '' : `
            <div class="cps-scan-toolbar" style="background:linear-gradient(135deg,#f5f3ff 0%,#ede9fe 100%);border:1px solid #ddd6fe;border-radius:10px;padding:12px 14px;margin-bottom:16px;display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;">
                <div style="display:flex;align-items:center;gap:10px;min-width:0;">
                    <div style="width:36px;height:36px;background:#7c3aed;border-radius:8px;display:flex;align-items:center;justify-content:center;color:white;font-size:16px;flex-shrink:0;"><i class="fas fa-camera"></i></div>
                    <div style="min-width:0;">
                        <div style="font-weight:600;font-size:14px;color:#111827;">Scan or Paste CPS Form</div>
                        <div style="font-size:12px;color:#6b7280;">Snap a photo of the form, or paste the customer's reply to auto-fill</div>
                    </div>
                </div>
                <div style="display:flex;gap:8px;flex-wrap:wrap;">
                    <button type="button" class="btn secondary btn-sm" style="white-space:nowrap;" onclick="app.openCpsPasteModal('${prefix}')">
                        <i class="fas fa-paste"></i> Paste Info
                    </button>
                    <button type="button" class="btn primary btn-sm" style="white-space:nowrap;" onclick="app.scanCpsForm('${prefix}')">
                        <i class="fas fa-camera"></i> Take Photo
                    </button>
                </div>
                <input type="file" id="${prefix}-scan-input" accept="image/*" capture="environment" style="display:none;" onchange="app.handleCpsScanFile(this, '${prefix}')">
            </div>`;

        return `
            <div class="form-section basic-info-block" data-prefix="${prefix}">
                ${scanBtn}
                <div class="form-row">
                    <div class="form-group half">
                        <label>Title</label>
                        <select id="${prefix}-title" class="form-control" ${disabled}>
                            ${['Mr.','Ms.','Mrs.','Dr.'].map(v => `<option value="${v}" ${sel(d.title, v)}>${v}</option>`).join('')}
                        </select>
                    </div>
                    <div class="form-group half">
                        <label>Full Name <span class="required">*</span></label>
                        <input type="text" id="${prefix}-name" class="form-control" value="${esc(d.full_name)}" placeholder="e.g., Tan Ah Kow" ${disabled} required>
                    </div>
                </div>
                <div class="form-row">
                    <div class="form-group half">
                        <label>Nickname</label>
                        <input type="text" id="${prefix}-nickname" class="form-control" value="${esc(d.nickname)}" placeholder="e.g., Ah Kow" ${disabled}>
                    </div>
                    <div class="form-group half">
                        <label>Gender</label>
                        <select id="${prefix}-gender" class="form-control" ${disabled}>
                            ${['Male','Female','Other'].map(v => `<option value="${v}" ${sel(d.gender, v)}>${v}</option>`).join('')}
                        </select>
                    </div>
                </div>
                <div class="form-row">
                    <div class="form-group half">
                        <label>Nationality</label>
                        <input type="text" id="${prefix}-nationality" class="form-control" value="${esc(d.nationality || 'Malaysian')}" ${disabled}>
                    </div>
                    <div class="form-group half">
                        <label>Phone <span class="required">*</span></label>
                        <input type="tel" id="${prefix}-phone" class="form-control" value="${esc(d.phone)}" placeholder="e.g., 012-3456789" ${disabled} required>
                    </div>
                </div>
                <div class="form-row">
                    <div class="form-group half">
                        <div style="display:flex;align-items:center;gap:8px;">
                            <label style="margin-bottom:0;">Date of Birth</label>
                            ${readOnly ? '' : `<input type="checkbox" id="${prefix}-use-dob" ${chk(useDob)} title="Use for life chart"><small style="color:var(--gray-400);font-size:11px;">Use for life chart</small>`}
                        </div>
                        <input type="date" id="${prefix}-dob" class="form-control" value="${esc(d.date_of_birth)}" onchange="app.updateLunarBirth('${prefix}-dob','${prefix}-lunar')" ${disabled}>
                    </div>
                    <div class="form-group half">
                        <div style="display:flex;align-items:center;gap:8px;">
                            <label style="margin-bottom:0;">Lunar Birth</label>
                            ${readOnly ? '' : `<input type="checkbox" id="${prefix}-use-lunar" ${chk(useLunar)} title="Use for life chart"><small style="color:var(--gray-400);font-size:11px;">Use for life chart</small>`}
                        </div>
                        <input type="text" id="${prefix}-lunar" class="form-control" value="${esc(d.lunar_birth)}" placeholder="Lunar date" ${disabled}>
                    </div>
                </div>
                <div class="form-row">
                    <div class="form-group half">
                        <label>Ming Gua</label>
                        <select id="${prefix}-minggua" class="form-control" ${disabled}>
                            <option value="">-- Select --</option>
                            ${BASIC_INFO_MING_GUA.map(([v,l]) => `<option value="${v}" ${sel(d.ming_gua, v)}>${l}</option>`).join('')}
                        </select>
                    </div>
                    <div class="form-group half">
                        <label>IC Number</label>
                        <input type="text" id="${prefix}-ic" class="form-control" value="${esc(d.ic_number)}" placeholder="e.g., 901212-10-1234" ${disabled}>
                    </div>
                </div>
                <div class="form-row">
                    <div class="form-group half">
                        <label>Occupation</label>
                        <input type="text" id="${prefix}-occupation" class="form-control" value="${esc(d.occupation)}" placeholder="e.g., Engineer" ${disabled}>
                    </div>
                    <div class="form-group half">
                        <label>Company Name</label>
                        <input type="text" id="${prefix}-company" class="form-control" value="${esc(d.company_name)}" placeholder="e.g., ABC Sdn Bhd" ${disabled}>
                    </div>
                </div>
                <div class="form-row">
                    <div class="form-group half">
                        <label>Income Range</label>
                        <select id="${prefix}-income" class="form-control" ${disabled}>
                            <option value="">-- Select Range --</option>
                            ${BASIC_INFO_INCOME_RANGES.map(([v,l]) => `<option value="${v}" ${sel(d.income_range, v)}>${l}</option>`).join('')}
                        </select>
                    </div>
                    <div class="form-group half">
                        <label>Email</label>
                        <input type="email" id="${prefix}-email" class="form-control" value="${esc(d.email)}" placeholder="email@example.com" ${disabled}>
                    </div>
                </div>
                <div class="form-group">
                    <label>Prospect Interest / 客户兴趣</label>
                    <select id="${prefix}-interest" class="form-control" ${disabled}>
                        <option value="">-- Select Interest --</option>
                        ${BASIC_INFO_INTERESTS.map(([v,l]) => `<option value="${v}" ${sel(d.cps_interest, v)}>${l}</option>`).join('')}
                    </select>
                </div>
                <div class="form-group">
                    <label>Marital Status</label>
                    ${readOnly
                        ? `<div style="padding:6px 0;color:var(--text-primary);">${d.marital_status || '—'}</div>`
                        : `<div style="display:flex;gap:16px;align-items:center;flex-wrap:wrap;">
                        ${['Single','Married','Others'].map(opt => `
                            <label style="display:flex;align-items:center;gap:6px;font-weight:normal;margin:0;cursor:pointer;">
                                <input type="checkbox" class="${prefix}-marital-cb" value="${opt}" ${chk(d.marital_status === opt)} onchange="document.querySelectorAll('.${prefix}-marital-cb').forEach(cb=>{if(cb!==this)cb.checked=false;});">
                                ${opt}
                            </label>
                        `).join('')}
                    </div>`}
                </div>
                <div class="form-group">
                    <label>Children</label>
                    <div id="prospect-children-list" style="display:flex;flex-direction:column;gap:8px;"></div>
                    <button type="button" class="btn secondary btn-sm" style="margin-top:8px;" onclick="app.addProspectChildRow()" ${disabled}><i class="fas fa-plus"></i> Add Child</button>
                </div>
                <div class="form-group">
                    <label>Address</label>
                    <textarea id="${prefix}-address" class="form-control" rows="2" placeholder="Street address" ${disabled}>${esc(d.address)}</textarea>
                </div>
                <div class="form-row">
                    <div class="form-group half">
                        <input type="text" id="${prefix}-city" class="form-control" placeholder="City" value="${esc(d.city)}" ${disabled}>
                    </div>
                    <div class="form-group half">
                        <input type="text" id="${prefix}-state" class="form-control" placeholder="State" value="${esc(d.state)}" ${disabled}>
                    </div>
                </div>
                <div class="form-group">
                    <input type="text" id="${prefix}-postal" class="form-control" placeholder="Postal Code" value="${esc(d.postal_code)}" ${disabled}>
                </div>
                <div class="form-row">
                    <div class="form-group half">
                        <label>Referred By <span class="required">*</span></label>
                        <div style="position:relative;">
                            <input type="text" id="${prefix}-referrer" class="form-control" placeholder="Search prospect or consultant..." ${searchHandler} ${disabled}>
                            <div id="${prefix}-referrer-results" class="search-results-dropdown" style="display:none;position:absolute;z-index:1000;background:white;border:1px solid #ddd;border-radius:4px;width:100%;max-height:180px;overflow-y:auto;box-shadow:0 4px 8px rgba(0,0,0,0.1);"></div>
                        </div>
                        <div id="${prefix}-referrer-info" style="margin-top:6px;">${d.referred_by ? `<div class="selected-entity-badge"><span><strong>${esc(d.referred_by)}</strong></span><button class="btn btn-sm secondary" ${clearHandler}>Clear</button></div>` : ''}</div>
                    </div>
                    <div class="form-group half">
                        <label>Relationship <span class="required">*</span></label>
                        <select id="${prefix}-relationship" class="form-control" onchange="document.getElementById('${prefix}-relationship-other-div').style.display = this.value === 'Other' ? 'block' : 'none'" ${disabled}>
                            <option value="">-- Select --</option>
                            ${BASIC_INFO_RELATIONS.map(v => `<option value="${v}" ${sel(d.referral_relationship, v)}>${v}</option>`).join('')}
                            <option value="Other" ${d.referral_relationship === 'Other' || relOther ? 'selected' : ''}>Other</option>
                        </select>
                    </div>
                </div>
                <div id="${prefix}-relationship-other-div" class="form-group" style="display:${relOther ? 'block' : 'none'};margin-top:10px;">
                    <label>Please specify relation</label>
                    <input type="text" id="${prefix}-relationship-other" class="form-control" placeholder="Specify relation..." value="${relOther ? esc(d.referral_relationship) : ''}" ${disabled}>
                </div>
            </div>
        `;
    };

    // Collect all Basic Info fields from the DOM for saving. Used by both
    // saveProspect and saveActivity (CPS) so they stay in sync.
    const collectBasicInfoData = (prefix) => {
        const d = (id) => document.getElementById(id)?.value?.trim() || '';
        const useDob = document.getElementById(`${prefix}-use-dob`)?.checked;
        const useLunar = document.getElementById(`${prefix}-use-lunar`)?.checked;
        let lifeChartType = null;
        if (useDob && useLunar) lifeChartType = 'both';
        else if (useDob) lifeChartType = 'solar';
        else if (useLunar) lifeChartType = 'lunar';
        const rel = d(`${prefix}-relationship`);
        const relOther = d(`${prefix}-relationship-other`);
        return {
            title: d(`${prefix}-title`) || null,
            full_name: d(`${prefix}-name`),
            nickname: d(`${prefix}-nickname`) || null,
            gender: d(`${prefix}-gender`) || null,
            nationality: d(`${prefix}-nationality`) || null,
            phone: d(`${prefix}-phone`),
            email: d(`${prefix}-email`) || null,
            ic_number: d(`${prefix}-ic`) || null,
            date_of_birth: d(`${prefix}-dob`) || null,
            lunar_birth: d(`${prefix}-lunar`) || null,
            occupation: d(`${prefix}-occupation`) || null,
            company_name: d(`${prefix}-company`) || null,
            income_range: d(`${prefix}-income`) || null,
            address: d(`${prefix}-address`) || null,
            city: d(`${prefix}-city`) || null,
            state: d(`${prefix}-state`) || null,
            postal_code: d(`${prefix}-postal`) || null,
            ming_gua: d(`${prefix}-minggua`) || null,
            cps_interest: d(`${prefix}-interest`) || null,
            marital_status: document.querySelector(`.${prefix}-marital-cb:checked`)?.value || null,
            children: JSON.stringify(collectProspectChildren()),
            referral_relationship: rel === 'Other' ? (relOther || 'Other') : rel,
            life_chart_type: lifeChartType,
        };
    };

    // Thin dispatchers so the shared block's referrer widget routes to the
    // right form-specific search/clear handler based on prefix.
    const searchBasicInfoReferrers = async (prefix) => {
        if (prefix === 'cps') return searchReferrers();
        if (prefix === 'prospect') return searchProspectReferrers();
    };
    const clearBasicInfoReferrer = (prefix) => {
        if (prefix === 'cps') return clearSelectedReferrer();
        if (prefix === 'prospect') return clearProspectReferrer();
    };

    // Mirror of the canonical list in chunks/script-marketing.js so the
    // Post-Meetup Notes block can build the "Next Actions" picker without
    // depending on the marketing chunk being loaded (it is L1/L2-gated).
    const EVENT_CATEGORIES = [
        '个人风水基础课',
        '环境风水基础课',
        '老板每月主题课',
        '运程讲座',
        '新春活动',
        '博物馆',
        '汇聚-专案',
        '汇集-商业',
        '汇集-灵活',
        '汇集-简易',
        '个人改命分享会',
        '风水改命分享会-简易',
        '风水改命分享会-专案',
        '画作分享会',
        '艺品分享会',
        'Bujishu 分享会',
        'Bujishu 新品发布会',
        'DC 招商会',
        'DC 日',
        'Formula 新品发布会',
        'Formula 分享会',
        'Formula 展览',
        'Formula Member Day',
        '游一游',
        '福气分享会',
        '代理重要会议',
        '代理培训',
        '代理补习班',
        '课程',
        '聚餐-代理',
        '聚餐-客户'
    ];
    const parseEventCategories = (raw) => {
        if (!raw) return [];
        if (Array.isArray(raw)) return raw;
        try {
            const parsed = JSON.parse(raw);
            return Array.isArray(parsed) ? parsed : [];
        } catch (_) {
            return String(raw).split(',').map(s => s.trim()).filter(Boolean);
        }
    };

    // ═══════════════════════════════════════════════════════════════════════
    // STANDARD FUNCTION — Post-Meetup Notes Block
    // Single source of truth for the Post-Meetup Notes form.
    // Used in:
    //   1. openPostMeetupNotesModal (per-activity edit)
    //   2. Standard Functions admin page (preview/documentation)
    // To add a new field: update buildPostMeetupNotesBlock + collectPostMeetupNotesData.
    // ═══════════════════════════════════════════════════════════════════════
    const buildPostMeetupNotesBlock = (prefix, activity = {}, opts = {}) => {
        const a = activity || {};
        const readOnly = prefix === 'preview';
        const disabled = readOnly ? 'disabled' : '';
        const products = opts.products || [];
        const bujishuItems = opts.bujishu || [];
        const formulaItems = opts.formula || [];
        const events = opts.events || [];
        const parsedOpp = opts.parsedOpp || parseSelectedItems(a.opportunity_potential || '');
        const parsedNA = opts.parsedNA || parseSelectedItems(a.next_action || '');

        const cb = (name, value, group, selectedArr) => {
            const checked = selectedArr.includes(value) ? 'checked' : '';
            const groupAttr = group ? ` data-group="${escapeHtml(group)}"` : '';
            return `<label style="display:flex;align-items:center;gap:6px;margin-bottom:4px;cursor:pointer;font-size:13px;padding:3px 8px;border-radius:4px;" onmouseover="this.style.background='#f3f4f6'" onmouseout="this.style.background=''">
                <input type="checkbox" name="${prefix}-${name}" value="${escapeHtml(value)}"${groupAttr} ${checked} ${disabled}> ${escapeHtml(value)}
            </label>`;
        };

        const oppCheckboxes = [
            ...(products.length ? [`<div style="font-weight:600;font-size:12px;color:var(--primary);margin-bottom:4px;border-bottom:1px solid var(--gray-200);padding-bottom:3px;">Products</div>`] : []),
            ...products.map(p => cb('opp-items', p.name, 'Products', parsedOpp.selected)),
            ...(bujishuItems.length ? [`<div style="font-weight:600;font-size:12px;color:var(--primary);margin:8px 0 4px;border-bottom:1px solid var(--gray-200);padding-bottom:3px;">Bujishu</div>`] : []),
            ...bujishuItems.map(b => cb('opp-items', b.name, 'Bujishu', parsedOpp.selected)),
            ...(formulaItems.length ? [`<div style="font-weight:600;font-size:12px;color:var(--primary);margin:8px 0 4px;border-bottom:1px solid var(--gray-200);padding-bottom:3px;">Formula</div>`] : []),
            ...formulaItems.map(f => cb('opp-items', f.name, 'Formula', parsedOpp.selected)),
        ];
        // Next Actions options: canonical EVENT_CATEGORIES + custom "Others" categories from events.
        // Saved selections are parsed directly from the raw string (avoids group-marker mismatch).
        const naCategories = new Set(EVENT_CATEGORIES);
        events.forEach(e => parseEventCategories(e.categories).forEach(c => c && naCategories.add(c)));
        const rawNAFull = a.next_action || '';
        const rawNARemarksMatch = rawNAFull.match(/ \| Remarks: ([\s\S]*)$/);
        const rawNARemarksText = rawNARemarksMatch ? rawNARemarksMatch[1].trim() : '';
        const rawNAItemsPart = rawNARemarksMatch ? rawNAFull.slice(0, rawNAFull.lastIndexOf(' | Remarks:')) : rawNAFull;
        const savedNAArr = rawNAItemsPart.split(',').map(s => s.trim()).filter(Boolean);
        const naOthers = savedNAArr.filter(s => !naCategories.has(s));
        const naOthersText = naOthers.join(', ').replace(/"/g, '&quot;');
        const hasNaOthers = naOthers.length > 0;
        const naCheckboxes = Array.from(naCategories).map(cat => cb('na-items', cat, '', savedNAArr));

        // Voice-recorder button only makes sense in the editable context.
        const voiceBtn = (targetId) => readOnly ? '' : `<button class="btn-icon" onclick="app.openVoiceRecorder('${targetId}', 'activity', null)" title="Record voice note" style="color:var(--primary);"><i class="fas fa-microphone"></i></button>`;

        return `
            <div class="post-meetup-notes-block" data-prefix="${prefix}">
                <div class="form-group">
                    <label>Key Points Discussed:</label>
                    <div style="display:flex;gap:8px;">
                        <textarea id="${prefix}-key-points" class="form-control" rows="2" placeholder="Main discussion points..." ${disabled}>${escapeHtml(a.note_key_points || '')}</textarea>
                        ${voiceBtn(`${prefix}-key-points`)}
                    </div>
                </div>
                <div class="form-group">
                    <label>Customer Needs/Interests:</label>
                    <div style="display:flex;gap:8px;">
                        <textarea id="${prefix}-needs" class="form-control" rows="2" placeholder="What are they looking for?" ${disabled}>${escapeHtml(a.note_needs || '')}</textarea>
                        ${voiceBtn(`${prefix}-needs`)}
                    </div>
                </div>
                <div class="form-group">
                    <label>Pain Points:</label>
                    <div style="display:flex;gap:8px;">
                        <textarea id="${prefix}-pain-points" class="form-control" rows="2" placeholder="Dislikes or problems to solve..." ${disabled}>${escapeHtml(a.note_pain_points || '')}</textarea>
                        ${voiceBtn(`${prefix}-pain-points`)}
                    </div>
                </div>
                <div class="form-group">
                    <label>Potential &amp; Opportunities:</label>
                    <div style="border:1px solid var(--gray-300);border-radius:6px;padding:10px;max-height:180px;overflow-y:auto;background:#fafafa;">
                        ${oppCheckboxes.length > 0 ? oppCheckboxes.join('') : '<p style="color:var(--gray-400);font-size:12px;margin:0;">No products/items available.</p>'}
                    </div>
                    <div style="display:flex;gap:8px;margin-top:6px;">
                        <textarea id="${prefix}-opportunity-remarks" class="form-control" rows="2" placeholder="Additional remarks..." ${disabled}>${escapeHtml(parsedOpp.remarks || '')}</textarea>
                        ${voiceBtn(`${prefix}-opportunity-remarks`)}
                    </div>
                    <div style="font-size:11px;color:var(--gray-400);margin-top:3px;"><i class="fas fa-link"></i> Linked to prospect profile → Potential &amp; Opportunities / Pipeline → Target to Sign</div>
                </div>
                <div class="form-group">
                    <label>Next Actions:</label>
                    <div style="border:1px solid var(--gray-300);border-radius:6px;padding:10px;max-height:180px;overflow-y:auto;background:#fafafa;">
                        ${naCheckboxes.join('')}
                        <label style="display:flex;align-items:center;gap:6px;margin-bottom:4px;cursor:${readOnly ? 'default' : 'pointer'};font-size:13px;padding:3px 8px;border-radius:4px;" ${!readOnly ? `onmouseover="this.style.background='#f3f4f6'" onmouseout="this.style.background=''"` : ''}>
                            <input type="checkbox" id="${prefix}-na-others-cb" ${hasNaOthers ? 'checked' : ''} ${disabled} ${!readOnly ? `onchange="(function(el){var b=document.getElementById('${prefix}-na-others-box');b.style.display=el.checked?'block':'none';if(el.checked)document.getElementById('${prefix}-na-others-input').focus();})(this)"` : ''}>
                            Others
                        </label>
                        <div id="${prefix}-na-others-box" style="display:${hasNaOthers ? 'block' : 'none'};padding:0 8px 4px;">
                            <input type="text" id="${prefix}-na-others-input" class="form-control" placeholder="Type custom categories, separate with commas" value="${naOthersText}" ${disabled} style="font-size:13px;">
                        </div>
                    </div>
                    <div style="display:flex;gap:8px;margin-top:6px;">
                        <textarea id="${prefix}-next-action-remarks" class="form-control" rows="2" placeholder="Additional remarks..." ${disabled}>${escapeHtml(rawNARemarksText)}</textarea>
                        ${voiceBtn(`${prefix}-next-action-remarks`)}
                    </div>
                    <div style="font-size:11px;color:var(--gray-400);margin-top:3px;"><i class="fas fa-link"></i> Linked to prospect profile → Next Actions / Pipeline → Action Needed to Close Deal</div>
                </div>
            </div>
        `;
    };

    // Collect Post-Meetup Notes values from the DOM using the block's prefix.
    // Uses the same serializer helpers as the legacy modal so stored shape is
    // unchanged — `opportunity_potential` and `next_action` remain the
    // checkbox-list + remarks text format the rest of the app already parses.
    const collectPostMeetupNotesData = (prefix) => {
        const keyPoints = document.getElementById(`${prefix}-key-points`)?.value || '';
        return {
            note_key_points: keyPoints,
            summary: keyPoints,
            note_needs: document.getElementById(`${prefix}-needs`)?.value || '',
            note_pain_points: document.getElementById(`${prefix}-pain-points`)?.value || '',
            opportunity_potential: serializeMultiSelectToText(`${prefix}-opp-items`, `${prefix}-opportunity-remarks`),
            next_action: (() => {
                const items = Array.from(document.querySelectorAll(`input[name="${prefix}-na-items"]:checked`)).map(c => c.value);
                const othersCb = document.getElementById(`${prefix}-na-others-cb`);
                const othersInput = document.getElementById(`${prefix}-na-others-input`);
                if (othersCb?.checked && othersInput?.value?.trim()) {
                    othersInput.value.split(',').map(s => s.trim()).filter(Boolean).forEach(c => { if (!items.includes(c)) items.push(c); });
                }
                const remarks = document.getElementById(`${prefix}-next-action-remarks`)?.value?.trim() || '';
                let result = items.join(', ');
                if (remarks) result += (result ? ' | ' : '') + 'Remarks: ' + remarks;
                return result;
            })(),
        };
    };

    // ═══════════════════════════════════════════════════════════════════════
    // STANDARD FUNCTION — Meeting Outcome Block (DC Closing Record)
    // Single source of truth for the closing/outcome form. Used by:
    //   1. Activity Details → "Outcome" action
    //   2. Today's Activities → clipboard icon
    //   3. Meet Up History → "Close Sale" button
    //   4. Standard Functions admin page (preview)
    // Add a field: update buildMeetingOutcomeBlock + collectMeetingOutcomeData.
    // Approval/queue/conversion logic stays in saveMeetingOutcome — this block
    // covers form UI + field collection only.
    // ═══════════════════════════════════════════════════════════════════════
    const buildMeetingOutcomeBlock = (prefix, activity = {}, opts = {}) => {
        const a = activity || {};
        const readOnly = prefix === 'preview';
        const disabled = readOnly ? 'disabled' : '';
        const products = opts.products || [];
        const prospect = opts.prospect || null;
        const cr = opts.closingRecord || a.closing_record || {};
        const crStatus = cr.status || 'draft';
        const crLocked = (crStatus === 'submitted' || crStatus === 'approved');
        const hasProspect = !!a.prospect_id || !!prospect || readOnly;

        const selectedProduct = cr.product || a.solution_sold || '';
        const productOptions = products.length
            ? products.map(p => `<option value="${escapeHtml(p.name)}" ${selectedProduct === p.name ? 'selected' : ''}>${escapeHtml(p.name)}</option>`).join('')
            : '<option value="">No products available</option>';

        const paymentMethod = cr.payment_method || a.payment_method || 'Cash';
        const isPOP = paymentMethod === 'POP';
        const isClosingChecked = !!(a.is_closing || cr.product || cr.sale_amount || cr.invoice_number);

        const v = {
            full_name:       cr.full_name       || prospect?.full_name     || '',
            phone:           cr.phone           || prospect?.phone         || '',
            email:           cr.email           || prospect?.email         || '',
            ic_number:       cr.ic_number       || prospect?.ic_number     || '',
            date_of_birth:   cr.date_of_birth   || prospect?.date_of_birth || '',
            address:         cr.address         || [prospect?.address, prospect?.city, prospect?.state, prospect?.postal_code].filter(Boolean).join(', ') || '',
            sale_amount:     cr.sale_amount     || a.amount_closed  || a.closing_amount || '',
            pop_monthly:     cr.pop_monthly     || a.pop_monthly_amount || '',
            pop_tenure:      cr.pop_tenure      || a.pop_tenure        || '',
            pop_down:        cr.pop_down_payment || a.pop_down_payment || '',
            invoice_no:      cr.invoice_number  || a.invoice_number    || '',
            // Invoice file URL lives on the prospect's closing_record JSONB
            // (the activities schema has no invoice_file column). When the
            // form is rendered for an activity NOT yet linked to a closing
            // record, this stays empty.
            invoice_file:    cr.invoice_file        || '',
            invoice_file_name: cr.invoice_file_name || '',
            closing_date:    cr.closing_date    || a.collection_date   || '',
            closing_remarks: cr.closing_remarks || '',
            sales_idea:      cr.sales_idea      || '',
            plan_details:    cr.plan_details    || '',
            success_story:   cr.success_story   || '',
            order_date:      cr.order_date      || a.activity_date || '',
        };

        const linkBadge = a.prospect_id ? `
            <div style="font-size:11px;color:var(--gray-500);margin-bottom:8px;">
                <i class="fas fa-link"></i> Linked to <strong>${escapeHtml(prospect?.full_name || 'prospect')}</strong> → DC Closing Record
            </div>` : '';

        const lockedNotice = crLocked ? `
            <div style="margin-bottom:14px;padding:8px 12px;border-radius:8px;background:#e3f2fd;border:1px solid #2196f3;color:#1565c0;font-size:12px;">
                <i class="fas fa-lock"></i> Closing record is <strong>${escapeHtml(crStatus)}</strong> — activity fields will be saved, but the locked closing record won't be overwritten.
            </div>` : '';

        const customerInfoSection = hasProspect ? `
            <div style="font-weight:600;color:var(--gray-700);margin:8px 0 6px;">Customer Information</div>
            <div class="form-group">
                <label>Full Name</label>
                <input id="${prefix}-full-name" class="form-control" value="${escapeHtml(v.full_name)}" placeholder="Full name" ${disabled}>
            </div>
            <div class="form-row">
                <div class="form-group half">
                    <label>Phone</label>
                    <input id="${prefix}-phone" class="form-control" value="${escapeHtml(v.phone)}" placeholder="Phone" ${disabled}>
                </div>
                <div class="form-group half">
                    <label>Email</label>
                    <input id="${prefix}-email" class="form-control" value="${escapeHtml(v.email)}" placeholder="Email" ${disabled}>
                </div>
            </div>
            <div class="form-row">
                <div class="form-group half">
                    <label>IC Number</label>
                    <input id="${prefix}-ic" class="form-control" value="${escapeHtml(v.ic_number)}" placeholder="NRIC/Passport" ${disabled}>
                </div>
                <div class="form-group half">
                    <label>Date of Birth</label>
                    <input id="${prefix}-dob" type="date" class="form-control" value="${escapeHtml(v.date_of_birth)}" ${disabled}>
                </div>
            </div>
            <div class="form-group">
                <label>Address</label>
                <textarea id="${prefix}-address" class="form-control" rows="2" placeholder="Full address" ${disabled}>${escapeHtml(v.address)}</textarea>
            </div>
            <div style="font-weight:600;color:var(--gray-700);margin:14px 0 6px;">Meeting Outcome</div>
        ` : '';

        const remarksAndUploadSection = hasProspect ? `
            <div class="form-group">
                <label>Remarks</label>
                <textarea id="${prefix}-remarks" class="form-control" rows="2" placeholder="e.g. Ring Size, Special Request..." ${disabled}>${escapeHtml(v.closing_remarks)}</textarea>
            </div>
            <div class="form-group">
                <label>Upload Purchased Invoice <span style="font-size:11px;color:var(--gray-400);font-weight:normal;">(AI auto-fill on upload)</span></label>
                <input id="${prefix}-invoice-file" type="file" class="form-control" accept="image/png,image/jpeg,application/pdf" ${disabled} onchange="if(!this.disabled)app.scanInvoiceWithAI(this,'${prefix}','mo')">
                ${v.invoice_file ? `<div style="margin-top:6px;font-size:11px;color:var(--gray-500);"><i class="fas fa-paperclip"></i> Current: <a href="${v.invoice_file}" target="_blank" rel="noopener noreferrer" style="color:var(--primary);">${escapeHtml(v.invoice_file_name || 'View invoice')}</a> <span style="color:var(--gray-400);">(choosing a new file will replace it)</span></div>` : ''}
            </div>
        ` : '';

        const caseStudySection = hasProspect ? `
            <div style="margin-top:16px;border-top:1px solid #eee;padding-top:12px;">
                <div style="font-weight:600;color:var(--gray-700);margin-bottom:8px;">📁 Case Study (Optional)</div>
                <div class="form-group">
                    <label>Sales Idea</label>
                    <textarea id="${prefix}-sales-idea" class="form-control" rows="2" placeholder="Describe the sales idea..." ${disabled}>${escapeHtml(v.sales_idea)}</textarea>
                </div>
                <div class="form-group">
                    <label>Plan Details</label>
                    <textarea id="${prefix}-plan-details" class="form-control" rows="2" placeholder="Details of the plan proposed..." ${disabled}>${escapeHtml(v.plan_details)}</textarea>
                </div>
                <div class="form-group">
                    <label>Success Story</label>
                    <textarea id="${prefix}-success-story" class="form-control" rows="2" placeholder="What made this a success?" ${disabled}>${escapeHtml(v.success_story)}</textarea>
                </div>
            </div>
        ` : '';

        const paymentOptions = ['Cash','Bank Transfer','Credit Card','Cheque','EPP','POP']
            .map(m => `<option value="${m}" ${paymentMethod === m ? 'selected' : ''}>${m}</option>`).join('');

        return `
            <div class="meeting-outcome-block" data-prefix="${prefix}">
                ${linkBadge}
                ${lockedNotice}
                <div class="form-group">
                    <label class="checkbox-label">
                        <input type="checkbox" id="${prefix}-is-closing" onchange="document.getElementById('${prefix}-closing-fields').style.display = this.checked ? 'block' : 'none'" ${isClosingChecked ? 'checked' : ''} ${disabled}> Case Closed Well Done!
                    </label>
                </div>
                <div id="${prefix}-closing-fields" style="display:${isClosingChecked ? 'block' : 'none'};padding-left:20px;">
                    ${!readOnly && a.prospect_id ? `
                    <div style="margin:0 0 14px;padding:14px;background:linear-gradient(135deg,#fef3c7 0%,#fde68a 100%);border:2px dashed #f59e0b;border-radius:10px;">
                        <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px;">
                            <i class="fas fa-camera" style="color:#b45309;font-size:18px;"></i>
                            <strong style="color:#92400e;">📸 Order Form Photo <span style="color:#dc2626;" title="Required">*</span></strong>
                        </div>
                        <p style="margin:0 0 10px;font-size:12px;color:#78350f;line-height:1.4;">
                            Take a photo of the signed order form (any of the 3 templates — PRN Installment, PRN Receipt, or Old Paper Form). AI will auto-fill product, amount, payment, and customer details.
                        </p>
                        <div style="display:flex;gap:6px;flex-wrap:wrap;align-items:center;">
                            <button type="button" class="btn primary btn-sm" onclick="document.getElementById('${prefix}-order-form-camera').click()" ${disabled}>
                                <i class="fas fa-camera"></i> Take Photo
                            </button>
                            <button type="button" class="btn secondary btn-sm" onclick="document.getElementById('${prefix}-order-form-file').click()" ${disabled}>
                                <i class="fas fa-upload"></i> Choose File
                            </button>
                            <span style="font-size:11px;color:#78350f;margin-left:6px;">Form type:</span>
                            <select id="${prefix}-order-form-type" class="form-control" style="width:auto;padding:4px 8px;font-size:12px;" ${disabled}>
                                <option value="auto">Auto-detect</option>
                                <option value="A">A — PRN Installment</option>
                                <option value="B">B — PRN Receipt</option>
                                <option value="C">C — Paper Form</option>
                            </select>
                            <input type="file" id="${prefix}-order-form-camera" accept="image/*" capture="environment" style="display:none;" onchange="app.handleOrderFormFile(this,'${prefix}',${a.prospect_id})">
                            <input type="file" id="${prefix}-order-form-file" accept="image/png,image/jpeg" style="display:none;" onchange="app.handleOrderFormFile(this,'${prefix}',${a.prospect_id})">
                        </div>
                        <div id="${prefix}-order-form-thumbs" style="margin-top:10px;display:flex;flex-wrap:wrap;gap:8px;"></div>
                        <div id="${prefix}-order-form-status" style="margin-top:6px;"></div>
                        <img src="data:image/gif;base64,R0lGODlhAQABAAAAACw=" alt="" style="display:none;" onload="window.app && app.loadOrderFormThumbnails && app.loadOrderFormThumbnails('${prefix}',${a.prospect_id})">
                    </div>
                    ` : ''}
                    ${customerInfoSection}
                    <div class="form-row">
                        <div class="form-group half">
                            <label>Product/Service Sold</label>
                            <select id="${prefix}-solution-sold" class="form-control" ${disabled}>${productOptions}</select>
                        </div>
                        <div class="form-group half">
                            <label>Order Date</label>
                            <input type="date" id="${prefix}-order-date" class="form-control" value="${escapeHtml(v.order_date)}" ${disabled}>
                        </div>
                    </div>
                    <div class="form-row">
                        <div class="form-group half">
                            <label for="${prefix}-amount-closed">Amount Closed (RM) <span style="color:#ef4444;font-weight:700;" title="Required" aria-hidden="true">*</span></label>
                            <input type="number" id="${prefix}-amount-closed" class="form-control" value="${escapeHtml(v.sale_amount)}" placeholder="0.00" min="0.01" step="0.01" aria-required="true" aria-describedby="${prefix}-amount-closed-hint" ${disabled}>
                            <span id="${prefix}-amount-closed-hint" style="font-size:11px;color:var(--gray-400);">Required when case is closed</span>
                        </div>
                        <div class="form-group half">
                            <label>Payment Method</label>
                            <select id="${prefix}-payment-method" class="form-control" onchange="document.getElementById('${prefix}-pop-fields').style.display = this.value === 'POP' ? 'block' : 'none'" ${disabled}>
                                ${paymentOptions}
                            </select>
                        </div>
                    </div>
                    <div id="${prefix}-pop-fields" style="display:${isPOP ? 'block' : 'none'};background:var(--gray-50);padding:12px;border-radius:6px;margin-bottom:12px;">
                        <div class="form-row">
                            <div class="form-group half">
                                <label>Payment Amount per Month (RM)</label>
                                <input type="number" id="${prefix}-pop-monthly" class="form-control" value="${escapeHtml(v.pop_monthly)}" placeholder="0.00" ${disabled}>
                            </div>
                            <div class="form-group half">
                                <label>Tenure (months)</label>
                                <input type="number" id="${prefix}-pop-tenure" class="form-control" value="${escapeHtml(v.pop_tenure)}" placeholder="12" ${disabled}>
                            </div>
                        </div>
                        <div class="form-group half">
                            <label>Down Payment (RM)</label>
                            <input type="number" id="${prefix}-pop-down" class="form-control" value="${escapeHtml(v.pop_down)}" placeholder="0.00" ${disabled}>
                        </div>
                    </div>
                    <div class="form-row">
                        <div class="form-group half">
                            <label>Invoice Number</label>
                            <input type="text" id="${prefix}-invoice-number" class="form-control" value="${escapeHtml(v.invoice_no)}" placeholder="INV-2026-001" ${disabled}>
                        </div>
                        <div class="form-group half">
                            <label>Collection Date</label>
                            <input type="date" id="${prefix}-collection-date" class="form-control" value="${escapeHtml(v.closing_date)}" ${disabled}>
                        </div>
                    </div>
                    ${remarksAndUploadSection}
                    ${caseStudySection}
                </div>
                <div class="form-group" style="margin-top:12px;">
                    <label class="checkbox-label">
                        <input type="checkbox" id="${prefix}-unable-to-serve" onchange="document.getElementById('${prefix}-unable-fields').style.display = this.checked ? 'block' : 'none'" ${a.unable_to_serve ? 'checked' : ''} ${disabled}> Unable to Serve
                    </label>
                </div>
                <div id="${prefix}-unable-fields" style="display:${a.unable_to_serve ? 'block' : 'none'};padding-left:20px;">
                    <div class="form-group">
                        <label>Reason</label>
                        <textarea id="${prefix}-unable-reason" class="form-control" rows="2" ${disabled}>${escapeHtml(a.unable_reason || '')}</textarea>
                    </div>
                </div>
            </div>
        `;
    };

    // Read all Meeting Outcome fields from the DOM. `hasProspect` surfaces
    // whether the customer-info section was rendered so the caller can keep
    // its nullable-field merging logic unchanged.
    const collectMeetingOutcomeData = (prefix) => {
        const read = (id) => {
            const el = document.getElementById(id);
            if (!el) return null;
            return (el.value || '').trim();
        };
        const readBool = (id) => document.getElementById(id)?.checked || false;
        return {
            is_closing: readBool(`${prefix}-is-closing`),
            unable_to_serve: readBool(`${prefix}-unable-to-serve`),
            unable_reason: read(`${prefix}-unable-reason`) ?? '',
            // Customer Info (only present when linked to a prospect)
            full_name: read(`${prefix}-full-name`),
            phone: read(`${prefix}-phone`),
            email: read(`${prefix}-email`),
            ic_number: read(`${prefix}-ic`),
            date_of_birth: read(`${prefix}-dob`),
            address: read(`${prefix}-address`),
            // Closing details
            solution_sold: read(`${prefix}-solution-sold`),
            amount_closed: read(`${prefix}-amount-closed`),
            payment_method: read(`${prefix}-payment-method`),
            pop_monthly: read(`${prefix}-pop-monthly`),
            pop_tenure: read(`${prefix}-pop-tenure`),
            pop_down: read(`${prefix}-pop-down`),
            invoice_number: read(`${prefix}-invoice-number`),
            collection_date: read(`${prefix}-collection-date`),
            order_date: read(`${prefix}-order-date`),
            closing_remarks: read(`${prefix}-remarks`),
            sales_idea: read(`${prefix}-sales-idea`),
            plan_details: read(`${prefix}-plan-details`),
            success_story: read(`${prefix}-success-story`),
        };
    };

    // OCR invoice scanner using Tesseract.js — no API key required, runs entirely in-browser.
    // Lazy-loads Tesseract from CDN on first use. Supports Manual and Online Order Forms.
    const scanInvoiceWithAI = async (inputEl, prefix, formContext) => {
        const file = inputEl.files[0];
        if (!file) return;

        if (!file.type.startsWith('image/')) {
            UI.toast.info('OCR scan supports image files (PNG/JPG) only. Please fill PDF fields manually.');
            return;
        }

        const scanStatusId = `${prefix}-ai-scan-status`;
        const existing = document.getElementById(scanStatusId);
        if (existing) existing.remove();

        const statusEl = document.createElement('div');
        statusEl.id = scanStatusId;
        statusEl.style.cssText = 'margin-top:6px;padding:7px 11px;border-radius:6px;font-size:12px;display:flex;align-items:center;gap:6px;background:#e3f2fd;color:#1565c0;';
        statusEl.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Loading OCR engine...';
        inputEl.parentElement.appendChild(statusEl);

        try {
            // Lazy-load Tesseract.js from CDN (downloaded once, cached by browser)
            if (!window.Tesseract) {
                await new Promise((resolve, reject) => {
                    const s = document.createElement('script');
                    s.src = 'https://unpkg.com/tesseract.js@4/dist/tesseract.min.js';
                    s.onload = resolve;
                    s.onerror = () => reject(new Error('Failed to load OCR library. Check your internet connection.'));
                    document.head.appendChild(s);
                });
            }

            statusEl.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Scanning invoice... 0%';

            const { data: { text } } = await Tesseract.recognize(file, 'eng', {
                logger: m => {
                    if (m.status === 'recognizing text') {
                        const pct = Math.round(m.progress * 100);
                        statusEl.innerHTML = `<i class="fas fa-spinner fa-spin"></i> Scanning invoice... ${pct}%`;
                    }
                }
            });

            statusEl.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Extracting fields...';

            // --- Parse raw OCR text into structured fields ---
            const normalizeDate = (str) => {
                if (!str) return null;
                const dmy = str.match(/^(\d{1,2})[\/\-\.](\d{1,2})[\/\-\.](\d{4})$/);
                if (dmy) return `${dmy[3]}-${dmy[2].padStart(2,'0')}-${dmy[1].padStart(2,'0')}`;
                if (/^\d{4}-\d{2}-\d{2}$/.test(str)) return str;
                try { const d = new Date(str); if (!isNaN(d)) return d.toISOString().split('T')[0]; } catch {}
                return null;
            };

            const full = text.split('\n').map(l => l.trim()).filter(Boolean).join('\n');

            // Find value after a label on the same line (handles both : and | separators)
            const afterLabel = (patterns) => {
                for (const pat of patterns) {
                    const re = new RegExp(pat + '[:\\s|]+([^\\n]{2,80})', 'i');
                    const m = full.match(re);
                    if (m) { const v = m[1].replace(/[|]/g, '').trim(); if (v) return v; }
                }
                return null;
            };

            const extracted = {};

            // IC number — strong pattern first
            const icStrict = full.match(/\b(\d{6}-\d{2}-\d{4})\b/);
            if (icStrict) {
                extracted.ic_number = icStrict[1];
            } else {
                const ic12 = full.match(/\b(\d{12})\b/);
                if (ic12) extracted.ic_number = ic12[1].replace(/(\d{6})(\d{2})(\d{4})/, '$1-$2-$3');
                else extracted.ic_number = afterLabel(['ic\\s*(?:no\\.?|number)?','nric\\s*(?:no\\.?)?','no\\.?\\s*kp','no\\.?\\s*kad\\s*pengenalan','passport\\s*(?:no\\.?)?']);
            }

            // Phone
            const phoneLabel = afterLabel(['tel(?:efon)?(?:\\s*no\\.?)?','phone(?:\\s*no\\.?)?','hp(?:\\s*no\\.?)?','no\\.?\\s*(?:tel|hp|phone)','handphone','mobile']);
            if (phoneLabel) {
                extracted.phone = phoneLabel.replace(/[^\d+\-\s]/g, '').trim() || null;
            } else {
                const phoneRaw = full.match(/(?:^|\s)((?:\+?60|0)[1-9]\d{7,9})(?:\s|$)/m);
                if (phoneRaw) extracted.phone = phoneRaw[1].trim();
            }

            // Email
            const emailMatch = full.match(/[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/);
            extracted.email = emailMatch ? emailMatch[0] : null;

            // Invoice number
            const invLabel = afterLabel(['invoice\\s*(?:no\\.?|number)?','inv\\s*(?:no\\.?)?','receipt\\s*(?:no\\.?)?','no\\.?\\s*inv(?:oice)?','resit\\s*(?:no\\.?)?']);
            if (invLabel) {
                extracted.invoice_number = invLabel.replace(/[^\w\-\/]/g, '').trim() || null;
            } else {
                const invRaw = full.match(/\b(INV[-\s]?\d{3,4}[-\s]?\d{3,6})\b/i);
                if (invRaw) extracted.invoice_number = invRaw[1].trim();
            }

            // Amount
            const amtLabel = afterLabel(['total(?:\\s*amount)?','amount(?:\\s*(?:rm|paid|due))?','jumlah(?:\\s*(?:rm|keseluruhan))?','harga(?:\\s*(?:rm|jumlah))?','price(?:\\s*total)?']);
            if (amtLabel) {
                const amtNum = amtLabel.match(/[\d,]+\.?\d{0,2}/);
                if (amtNum) extracted.amount = amtNum[0].replace(/,/g, '');
            }
            if (!extracted.amount) {
                const rmRaw = full.match(/RM\s*([\d,]+\.?\d{0,2})/i);
                if (rmRaw) extracted.amount = rmRaw[1].replace(/,/g, '');
            }

            // Date
            const dateLabel = afterLabel(['(?:order|sales|purchase|transaction)?\\s*date','tarikh(?:\\s*(?:pesanan|jualan))?','date\\s*of\\s*(?:purchase|sale|order)']);
            if (dateLabel) {
                const dm = dateLabel.match(/\d{1,2}[\/\-\.]\d{1,2}[\/\-\.]\d{4}|\d{4}-\d{2}-\d{2}|\d{1,2}\s+\w+\s+\d{4}/);
                if (dm) extracted.sales_date = normalizeDate(dm[0]);
            }
            if (!extracted.sales_date) {
                const dateRaw = full.match(/\b(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})\b/);
                if (dateRaw) extracted.sales_date = normalizeDate(dateRaw[0]);
            }

            // Name
            extracted.full_name = afterLabel(['(?:full\\s*)?name(?:\\s*of\\s*(?:customer|buyer|purchaser))?','nama(?:\\s*(?:penuh|pelanggan))?','customer\\s*name','buyer']);

            // Address
            extracted.address = afterLabel(['(?:full\\s*)?address','alamat(?:\\s*penuh)?','residential\\s*address','home\\s*address']);

            // Occupation
            extracted.occupation = afterLabel(['occupation','pekerjaan','profession','job(?:\\s*title)?','employment']);

            // Agent name
            extracted.agent_name = afterLabel(['agent(?:\\s*name)?','ejen(?:\\s*jualan)?','consultant(?:\\s*name)?','introducer(?:\\s*name)?','sales(?:\\s*(?:person|rep|agent))?','nama\\s*ejen']);

            // Product
            extracted.product = afterLabel(['product(?:\\s*(?:name|sold))?','produk','service(?:\\s*(?:name|sold))?','package(?:\\s*name)?','pakej','item(?:\\s*(?:name|sold))?']);

            // --- Fill form fields ---
            const highlight = (el) => {
                if (!el) return;
                el.style.background = '#e8f5e9';
                setTimeout(() => { el.style.background = ''; }, 4000);
            };
            const setF = (id, value) => {
                if (!value) return;
                const el = document.getElementById(id);
                if (!el) return;
                el.value = value;
                highlight(el);
            };
            const setSelect = (id, value) => {
                if (!value) return;
                const sel = document.getElementById(id);
                if (!sel) return;
                const v = value.toLowerCase();
                const match = Array.from(sel.options).find(o => o.text.toLowerCase().includes(v) || v.includes(o.text.toLowerCase()));
                if (match) { sel.value = match.value; highlight(sel); }
            };
            const appendRemarks = (id, occ, agent) => {
                const extras = [];
                if (occ) extras.push(`Occupation: ${occ}`);
                if (agent) extras.push(`Agent: ${agent}`);
                if (!extras.length) return;
                const el = document.getElementById(id);
                if (el && !el.value) { el.value = extras.join(' | '); highlight(el); }
            };

            if (formContext === 'pre2025') {
                // prefix is the prospectId — fill the new-row inputs
                setF(`pre2025-product-${prefix}`, extracted.product);
                const noteParts = [];
                if (extracted.amount) noteParts.push(`RM${extracted.amount}`);
                if (extracted.sales_date) noteParts.push(extracted.sales_date);
                if (extracted.invoice_number) noteParts.push(`Inv: ${extracted.invoice_number}`);
                if (noteParts.length) setF(`pre2025-notes-${prefix}`, noteParts.join(' | '));
            } else if (formContext === 'cr') {
                setF('cr-full-name', extracted.full_name);
                setF('cr-ic', extracted.ic_number);
                setF('cr-phone', extracted.phone);
                setF('cr-address', extracted.address);
                setF('cr-email', extracted.email);
                setF('cr-invoice', extracted.invoice_number);
                setF('cr-order-date', extracted.sales_date);
                setF('cr-amount', extracted.amount);
                setSelect('cr-product', extracted.product);
                appendRemarks('cr-remarks', extracted.occupation, extracted.agent_name);
            } else {
                setF(`${prefix}-full-name`, extracted.full_name);
                setF(`${prefix}-ic`, extracted.ic_number);
                setF(`${prefix}-phone`, extracted.phone);
                setF(`${prefix}-address`, extracted.address);
                setF(`${prefix}-email`, extracted.email);
                setF(`${prefix}-invoice-number`, extracted.invoice_number);
                setF(`${prefix}-order-date`, extracted.sales_date);
                setF(`${prefix}-amount-closed`, extracted.amount);
                setSelect(`${prefix}-solution-sold`, extracted.product);
                appendRemarks(`${prefix}-remarks`, extracted.occupation, extracted.agent_name);
            }

            const filled = Object.values(extracted).filter(v => v !== null && v !== undefined && v !== '').length;
            statusEl.innerHTML = `<i class="fas fa-check-circle" style="color:#4caf50;"></i> OCR found ${filled} fields — highlighted in green. Please review and correct if needed.`;
            statusEl.style.background = '#e8f5e9';
            statusEl.style.color = '#1b5e20';

        } catch (err) {
            statusEl.innerHTML = `<i class="fas fa-exclamation-triangle" style="color:#f44336;"></i> Scan failed: ${escapeHtml(err.message)}`;
            statusEl.style.background = '#ffebee';
            statusEl.style.color = '#b71c1c';
            console.error('[scanInvoiceWithAI]', err);
        }
    };

    // ═══════════════════════════════════════════════════════════════════════
    // Order Form Photo Capture + AI Auto-Fill (Templates A, B, C)
    // 1. Agent takes photo in closing modal
    // 2. Photo uploaded to attachments/order_forms/{prospect}_{ts}_{type}.jpg
    // 3. Sent to order-form-ocr edge function (Gemini 2.5 Flash) — classifies template + extracts
    // 4. Review modal shows photo + extracted fields with confidence dots
    // 5. Selected fields applied to closing modal (Customer Info / Product / Amount / Payment)
    // 6. prospect_attachments row created with metadata = { form_type, fields, confidence, raw_text }
    // ═══════════════════════════════════════════════════════════════════════

    let _orderFormScanCache = null;

    // [scan_key, closing_field_suffix, label, strategy]
    // strategy ∈ 'fill' | 'fill_if_empty' | 'fuzzy_select' | 'map_payment' | 'fill_pop'
    const ORDER_FORM_FIELD_MAP = [
        ['customer_name',            'full-name',       'Full Name',          'fill_if_empty'],
        ['customer_phone',           'phone',           'Phone',              'fill_if_empty'],
        ['customer_email',           'email',           'Email',              'fill_if_empty'],
        ['customer_nric',            'ic',              'NRIC',               'fill_if_empty'],
        ['customer_address',         'address',         'Address',            'fill_if_empty'],
        ['product_solar_bd',         'dob',             'Date of Birth',      'fill_if_empty'],
        ['order_date',               'order-date',      'Order Date',         'fill'],
        ['product_name',             'solution-sold',   'Product',            'fuzzy_select'],
        ['amount_total_due',         'amount-closed',   'Amount Closed (RM)', 'fill'],
        ['payment_type',             'payment-method',  'Payment Method',     'map_payment'],
        ['installment_monthly',      'pop-monthly',     'Monthly Payment',    'fill_pop'],
        ['installment_tenure_months','pop-tenure',      'Tenure (months)',    'fill_pop'],
        ['amount_down_payment',      'pop-down',        'Down Payment',       'fill_pop'],
        ['prn_number',               'invoice-number',  'PRN / Invoice No.',  'fill_if_empty'],
        ['order_date',               'collection-date', 'Collection Date',    'fill_if_empty'],
    ];

    // Map extracted payment_type/method to closing dropdown enum
    const _mapPaymentToClosingValue = (payment_type, payment_method) => {
        const t = (payment_type || '').toLowerCase();
        const m = (payment_method || '').toLowerCase();
        if (m.includes('standing') || t.includes('standing')) return 'POP';
        if (m.includes('online') || m.includes('mpgs')) return 'Credit Card';
        if (t === 'visa' || t === 'master' || t.includes('credit') || t.includes('debit')) return 'Credit Card';
        if (t.includes('cheque')) return 'Cheque';
        if (m.includes('direct') || t.includes('direct')) return 'Bank Transfer';
        if (t.includes('cash')) return 'Cash';
        return null;
    };

    // Strip "RM", commas, and stray whitespace so values write cleanly into
    // <input type="number"> fields. Only applied to keys we know are amounts.
    const _ORDER_FORM_AMOUNT_KEYS = new Set([
        'amount_unit_price','amount_down_payment','amount_security_deposit',
        'amount_total_due','amount_grand_total',
        'installment_amount','installment_monthly',
    ]);
    const _cleanScannedValue = (key, val) => {
        if (val == null) return val;
        let s = String(val).trim();
        if (_ORDER_FORM_AMOUNT_KEYS.has(key)) {
            s = s.replace(/\bRM\b/gi, '').replace(/,/g, '').replace(/\s+/g, '').trim();
            // Defensive: if still not a clean number string, leave as-is so the
            // agent sees something instead of silently nuking the value.
            if (!/^[\d.]+$/.test(s)) s = String(val).trim();
        }
        return s;
    };

    const _fuzzyMatchProduct = (selectId, scannedName) => {
        const sel = document.getElementById(selectId);
        if (!sel || !scannedName) return false;
        const target = scannedName.toLowerCase().trim();
        let best = null;
        for (const opt of sel.options) {
            const val = (opt.value || opt.textContent).toLowerCase();
            if (val === target) { sel.value = opt.value; return true; }
            if (val && (val.includes(target) || target.includes(val))) {
                if (!best) best = opt.value;
            }
        }
        if (best) { sel.value = best; return true; }
        return false;
    };

    const handleOrderFormFile = async (input, prefix, prospectId) => {
        const file = input.files && input.files[0];
        if (!file) return;
        if (!file.type.startsWith('image/')) {
            UI.toast.error('Please select an image file (JPG or PNG).');
            input.value = '';
            return;
        }
        if (file.size > 8 * 1024 * 1024) {
            UI.toast.error('Image too large. Use a photo under 8 MB.');
            input.value = '';
            return;
        }
        if (!prospectId) {
            UI.toast.error('Order form photo requires a linked prospect.');
            input.value = '';
            return;
        }

        const statusEl = document.getElementById(`${prefix}-order-form-status`);
        const formTypeSel = document.getElementById(`${prefix}-order-form-type`);
        const formTypeHint = formTypeSel ? (formTypeSel.value || 'auto') : 'auto';

        const setStatus = (bg, fg, html) => {
            if (statusEl) {
                statusEl.innerHTML = `<div style="padding:7px 11px;background:${bg};color:${fg};border-radius:6px;font-size:12px;display:flex;align-items:center;gap:6px;">${html}</div>`;
            }
        };

        try {
            const sb = window.supabase || window.supabaseClient;
            if (!sb || !sb.storage) throw new Error('Supabase storage not available (offline mode?)');

            // 1. Upload photo to Supabase Storage
            setStatus('#e3f2fd', '#1565c0', '<i class="fas fa-spinner fa-spin"></i> Uploading photo…');
            const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
            const path = `order_forms/${prospectId}_${Date.now()}_${formTypeHint}_${safeName}`;
            const { error: upErr } = await sb.storage.from('attachments').upload(path, file, { upsert: false, contentType: file.type });
            if (upErr) throw upErr;
            const { data: urlData } = sb.storage.from('attachments').getPublicUrl(path);
            const photoUrl = urlData?.publicUrl || null;
            if (!photoUrl) throw new Error('Photo uploaded but URL not returned');

            // 2. base64 → edge function
            setStatus('#fef3c7', '#92400e', '<i class="fas fa-spinner fa-spin"></i> Reading order form with AI… (3–6s)');
            const dataUrl = await new Promise((resolve, reject) => {
                const reader = new FileReader();
                reader.onload = () => resolve(reader.result);
                reader.onerror = () => reject(new Error('Could not read file'));
                reader.readAsDataURL(file);
            });
            const [meta, b64] = String(dataUrl).split(',');
            const mime = (meta.match(/data:(.*?);base64/) || [])[1] || file.type || 'image/jpeg';

            if (!sb.functions) throw new Error('Supabase functions client not available');

            const { data: res, error } = await sb.functions.invoke('order-form-ocr', {
                body: { image_base64: b64, mime_type: mime, form_type: formTypeHint },
            });
            if (error) throw new Error(error.message || 'Edge function call failed');
            if (!res || res.ok === false) throw new Error(res?.detail || res?.error || 'OCR failed');

            const fields = res.fields || {};
            const confidence = res.confidence || {};
            const detectedType = res.form_type || fields.form_type || 'unknown';
            const rawText = res.raw_text || '';

            // 3. Mean confidence summary
            const confValue = (c) => c === 'high' ? 1.0 : c === 'medium' ? 0.6 : c === 'low' ? 0.3 : null;
            const confValues = Object.values(confidence).map(confValue).filter(v => v !== null);
            const meanConf = confValues.length > 0
                ? Math.round((confValues.reduce((a, b) => a + b, 0) / confValues.length) * 100) / 100
                : null;

            // 4. Persist attachment row (graceful fallback if metadata column not yet migrated)
            let attachment = null;
            try {
                attachment = await AppDataStore.create('prospect_attachments', {
                    prospect_id: prospectId,
                    attachment_type: 'order_form',
                    file_url: photoUrl,
                    filename: safeName,
                    metadata: {
                        form_type: detectedType,
                        prn_number: fields.prn_number || null,
                        fields,
                        confidence,
                        raw_text: rawText,
                        edited_by_agent: [],
                    },
                    scanned_at: new Date().toISOString(),
                    scan_confidence: meanConf,
                });
            } catch (e) {
                console.warn('[order-form] metadata insert failed, retrying without:', e?.message || e);
                attachment = await AppDataStore.create('prospect_attachments', {
                    prospect_id: prospectId,
                    attachment_type: 'order_form',
                    file_url: photoUrl,
                    filename: safeName,
                }).catch(err2 => { console.error('[order-form] basic insert failed too:', err2); return null; });
            }

            _orderFormScanCache = {
                prefix,
                prospectId,
                attachmentId: attachment?.id || null,
                photoUrl,
                detectedType,
                fields,
                confidence,
                rawText,
            };

            if (statusEl) statusEl.innerHTML = '';
            renderOrderFormScanReview();
        } catch (err) {
            console.error('Order form scan failed:', err);
            setStatus('#ffebee', '#b71c1c', `<i class="fas fa-exclamation-triangle"></i> ${escapeHtml(err.message || 'Scan failed')}`);
            UI.toast.error('Order form scan failed: ' + (err.message || 'Unknown error'));
        } finally {
            // Reset the input so re-selecting the same file fires onchange
            if (input) input.value = '';
        }
    };

    const renderOrderFormScanReview = () => {
        if (!_orderFormScanCache) return;
        const { prefix, photoUrl, detectedType, fields, confidence, rawText } = _orderFormScanCache;
        const norm = v => (v == null ? '' : String(v).trim());

        const formTypeLabel = {
            A: 'A — PRN Modern (Installment)',
            B: 'B — PRN Receipt (Direct)',
            C: 'C — Old Paper Form',
            unknown: 'Unknown',
        }[detectedType] || detectedType;

        const confBadge = (c) => {
            if (!c) return '';
            const color = c === 'high' ? '#10b981' : c === 'medium' ? '#f59e0b' : '#ef4444';
            return `<span style="display:inline-block;padding:1px 6px;border-radius:10px;background:${color}1a;color:${color};font-size:10px;font-weight:600;text-transform:uppercase;">${c}</span>`;
        };

        const rows = ORDER_FORM_FIELD_MAP.map(([key, suffix, label, strategy], idx) => {
            let scn = norm(_cleanScannedValue(key, fields[key]));
            // Fallback: if total_due missing, use unit_price (templates B/C direct purchase)
            if (key === 'amount_total_due' && !scn) scn = norm(_cleanScannedValue('amount_unit_price', fields.amount_unit_price));
            const conf = confidence[key] || null;
            const curEl = document.getElementById(`${prefix}-${suffix}`);
            const cur = curEl ? norm(curEl.value || curEl.textContent) : '';

            let status, defaultChecked;
            if (!scn) { status = 'no-scan'; defaultChecked = false; }
            else if (!cur) { status = 'fill-empty'; defaultChecked = true; }
            else if (cur.toLowerCase() === scn.toLowerCase()) { status = 'same'; defaultChecked = false; }
            else { status = 'conflict'; defaultChecked = (strategy === 'fill'); }

            return { idx, key, suffix, label, strategy, scn, cur, conf, status, defaultChecked };
        });

        // Read-only meta rows (PRN, agent code, card details — stored on attachment only)
        const metaRows = [
            ['prn_number',              'PRN / PR Number'],
            ['consultant',              'Consultant'],
            ['agent_code',              'Agent Code'],
            ['collection_branch',       'Collection Branch'],
            ['product_ringsize',        'Ring Size'],
            ['product_lifesign',        'Lifesign'],
            ['product_lunar_bd',        'Lunar Birth Date'],
            ['amount_security_deposit', 'Security Deposit'],
            ['installment_amount',      'Installment Amount'],
            ['card_holder',             'Card Holder'],
            ['card_last4',              'Card (last 4)'],
            ['card_issuing_bank',       'Issuing Bank'],
            ['transaction_reference',   'Transaction Reference'],
            ['transaction_receipt_no',  'Receipt Number'],
        ].map(([key, label]) => ({ key, label, val: norm(fields[key]), conf: confidence[key] || null }))
         .filter(r => r.val);

        const statusBadge = (s) => {
            if (s === 'same')       return '<span style="color:#10b981;font-size:11px;font-weight:600;">✓ MATCH</span>';
            if (s === 'fill-empty') return '<span style="color:#7c3aed;font-size:11px;font-weight:600;">+ FILL</span>';
            if (s === 'conflict')   return '<span style="color:#d97706;font-size:11px;font-weight:600;">⚠ CONFLICT</span>';
            if (s === 'no-scan')    return '<span style="color:#9ca3af;font-size:11px;">— blank</span>';
            return '';
        };
        const rowBg = (s) => {
            if (s === 'conflict')   return '#fffbeb';
            if (s === 'fill-empty') return '#f5f3ff';
            if (s === 'same')       return '#f0fdf4';
            return '#ffffff';
        };

        const html = `
            <div style="display:grid;grid-template-columns:1fr 1.4fr;gap:14px;max-height:70vh;">
                <div style="overflow:auto;">
                    <div style="font-size:11px;color:var(--gray-500);margin-bottom:4px;">DETECTED TEMPLATE</div>
                    <div style="font-weight:600;color:var(--gray-900);margin-bottom:10px;">${escapeHtml(formTypeLabel)} ${confBadge(confidence.form_type)}</div>
                    <img loading="lazy" src="${escapeHtml(photoUrl)}" style="max-width:100%;border:1px solid var(--gray-200);border-radius:8px;cursor:zoom-in;" onclick="window._openAttachment && window._openAttachment('${escapeHtml(photoUrl)}')">
                    ${metaRows.length ? `
                        <div style="margin-top:12px;font-size:12px;">
                            <div style="font-weight:600;color:var(--gray-700);margin-bottom:6px;">Extra extracted info (saved with photo)</div>
                            <table style="width:100%;border-collapse:collapse;font-size:11px;">
                                ${metaRows.map(r => `
                                    <tr>
                                        <td style="padding:4px 6px;color:var(--gray-500);width:45%;">${escapeHtml(r.label)}</td>
                                        <td style="padding:4px 6px;color:var(--gray-900);">${escapeHtml(r.val)} ${confBadge(r.conf)}</td>
                                    </tr>
                                `).join('')}
                            </table>
                        </div>
                    ` : ''}
                </div>
                <div style="overflow:auto;">
                    <p style="margin:0 0 10px;color:var(--gray-600);font-size:13px;">
                        Tick rows to apply to the closing form. <strong style="color:#d97706;">Conflicts</strong> need explicit confirmation.
                    </p>
                    <table style="width:100%;border-collapse:collapse;font-size:12px;">
                        <thead>
                            <tr style="background:var(--gray-100);text-align:left;">
                                <th style="padding:6px;width:28px;"></th>
                                <th style="padding:6px;">Field</th>
                                <th style="padding:6px;">Current</th>
                                <th style="padding:6px;">Scanned</th>
                                <th style="padding:6px;width:80px;">Status</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${rows.map(r => `
                                <tr style="background:${rowBg(r.status)};border-bottom:1px solid #e5e7eb;">
                                    <td style="padding:6px;text-align:center;">
                                        ${r.status === 'no-scan' || r.status === 'same' ? '' :
                                            `<input type="checkbox" class="order-form-pick" data-idx="${r.idx}" ${r.defaultChecked ? 'checked' : ''}>`}
                                    </td>
                                    <td style="padding:6px;font-weight:500;color:var(--gray-700);">${r.label}</td>
                                    <td style="padding:6px;color:${r.cur ? 'var(--gray-700)' : 'var(--gray-400)'};">${r.cur ? escapeHtml(r.cur) : '<em style="font-size:11px;">(empty)</em>'}</td>
                                    <td style="padding:6px;color:${r.scn ? 'var(--gray-900)' : 'var(--gray-400)'};">
                                        ${r.scn ? escapeHtml(r.scn) : '<em style="font-size:11px;">(blank)</em>'}
                                        ${r.conf ? ' ' + confBadge(r.conf) : ''}
                                    </td>
                                    <td style="padding:6px;">${statusBadge(r.status)}</td>
                                </tr>
                            `).join('')}
                        </tbody>
                    </table>
                    <div style="margin-top:10px;display:flex;gap:8px;flex-wrap:wrap;">
                        <button type="button" class="btn secondary btn-sm" onclick="app.toggleOrderFormScanAll(true)"><i class="fas fa-check-square"></i> Tick all available</button>
                        <button type="button" class="btn secondary btn-sm" onclick="app.toggleOrderFormScanAll(false)"><i class="far fa-square"></i> Untick all</button>
                    </div>
                    ${rawText ? `
                        <details style="margin-top:10px;font-size:11px;color:var(--gray-500);">
                            <summary style="cursor:pointer;">Show raw AI text</summary>
                            <pre style="white-space:pre-wrap;background:var(--gray-100);padding:8px;border-radius:6px;margin-top:6px;font-size:10px;max-height:140px;overflow:auto;">${escapeHtml(rawText)}</pre>
                        </details>
                    ` : ''}
                </div>
            </div>
        `;

        // Use the shared scan-overlay (sits ON TOP of the Meeting Outcome modal so
        // the closing form DOM stays intact while we write into its fields).
        _showCpsScanOverlay('Review Scanned Order Form', html, [
            { type: 'secondary', label: 'Skip Auto-Fill (keep photo)', action: 'app.dismissOrderFormScanReview()' },
            { type: 'primary',   label: 'Apply Selected', action: '(async () => { await app.applyOrderFormScanSelection(); })()' },
        ]);
    };

    const toggleOrderFormScanAll = (checked) => {
        document.querySelectorAll('.order-form-pick').forEach(cb => { cb.checked = !!checked; });
    };

    const dismissOrderFormScanReview = () => {
        _hideCpsScanOverlay();
        _renderOrderFormThumb(_orderFormScanCache);
        _orderFormScanCache = null;
    };

    const applyOrderFormScanSelection = async () => {
        if (!_orderFormScanCache) { UI.hideModal(); return; }
        const { prefix, fields } = _orderFormScanCache;

        const picked = Array.from(document.querySelectorAll('.order-form-pick:checked'))
            .map(cb => parseInt(cb.dataset.idx, 10))
            .filter(n => !isNaN(n));

        let applied = 0;
        const editedFields = [];

        for (const idx of picked) {
            const row = ORDER_FORM_FIELD_MAP[idx];
            if (!row) continue;
            const [key, suffix, label, strategy] = row;

            let val = fields[key];
            if (key === 'amount_total_due' && !val) val = fields.amount_unit_price;
            if (val == null || String(val).trim() === '') continue;
            val = _cleanScannedValue(key, val);
            if (val == null || String(val).trim() === '') continue;
            val = String(val).trim();

            const fieldId = `${prefix}-${suffix}`;
            const el = document.getElementById(fieldId);
            if (!el) continue;

            if (strategy === 'fuzzy_select') {
                if (_fuzzyMatchProduct(fieldId, val)) { applied++; editedFields.push(key); }
            } else if (strategy === 'map_payment') {
                const closingVal = _mapPaymentToClosingValue(fields.payment_type, fields.payment_method);
                if (closingVal && el.tagName === 'SELECT') {
                    let matched = false;
                    for (const opt of el.options) {
                        if (opt.value === closingVal) { el.value = closingVal; matched = true; break; }
                    }
                    if (matched) { el.dispatchEvent(new Event('change')); applied++; editedFields.push(key); }
                }
            } else if (strategy === 'fill_pop') {
                const popSel = document.getElementById(`${prefix}-payment-method`);
                if (popSel && popSel.value !== 'POP') {
                    popSel.value = 'POP';
                    popSel.dispatchEvent(new Event('change'));
                }
                el.value = val; applied++; editedFields.push(key);
            } else {
                el.value = val; applied++; editedFields.push(key);
            }
        }

        // Persist agent edits for audit
        if (_orderFormScanCache.attachmentId) {
            try {
                await AppDataStore.update('prospect_attachments', _orderFormScanCache.attachmentId, {
                    metadata: {
                        form_type: _orderFormScanCache.detectedType,
                        prn_number: fields.prn_number || null,
                        fields,
                        confidence: _orderFormScanCache.confidence,
                        raw_text: _orderFormScanCache.rawText,
                        edited_by_agent: editedFields,
                    },
                });
            } catch (e) {
                console.warn('Could not persist edited_by_agent:', e?.message || e);
            }
        }

        _hideCpsScanOverlay();
        _renderOrderFormThumb(_orderFormScanCache);
        _orderFormScanCache = null;

        if (applied > 0) {
            UI.toast.success(`Applied ${applied} field${applied === 1 ? '' : 's'} from order form. Please review before saving.`);
        } else {
            UI.toast.info('No fields applied — photo is still saved.');
        }
    };

    const _renderOrderFormThumb = (cache) => {
        if (!cache) return;
        const { prefix, photoUrl, detectedType, attachmentId, fields } = cache;
        const thumbWrap = document.getElementById(`${prefix}-order-form-thumbs`);
        if (!thumbWrap) return;
        const typeLabel = { A: 'PRN Installment', B: 'PRN Direct', C: 'Paper Form', unknown: 'Unknown' }[detectedType] || detectedType;
        const prn = fields?.prn_number;
        const item = document.createElement('div');
        item.style.cssText = 'display:inline-flex;flex-direction:column;align-items:center;gap:2px;position:relative;';
        item.innerHTML = `
            <img src="${escapeHtml(photoUrl)}" style="width:80px;height:80px;border-radius:6px;object-fit:cover;cursor:pointer;border:1px solid var(--gray-200);" onclick="window._openAttachment && window._openAttachment('${escapeHtml(photoUrl)}')">
            <div style="font-size:10px;color:var(--gray-600);text-align:center;line-height:1.2;">${escapeHtml(typeLabel)}</div>
            ${prn ? `<div style="font-size:9px;color:var(--gray-400);">${escapeHtml(prn)}</div>` : ''}
            ${attachmentId ? `<button type="button" title="Remove" style="position:absolute;top:-6px;right:-6px;background:var(--error);color:white;border:none;border-radius:50%;width:20px;height:20px;font-size:10px;padding:0;cursor:pointer;" onclick="app.removeOrderFormAttachment(${attachmentId}, this.parentElement)"><i class="fas fa-times"></i></button>` : ''}
        `;
        thumbWrap.appendChild(item);
    };

    const loadOrderFormThumbnails = async (prefix, prospectId) => {
        if (!prospectId) return;
        const thumbWrap = document.getElementById(`${prefix}-order-form-thumbs`);
        if (!thumbWrap) return;
        try {
            const rows = await AppDataStore.query('prospect_attachments', { prospect_id: prospectId, attachment_type: 'order_form' });
            thumbWrap.innerHTML = '';
            (rows || []).forEach(row => {
                const meta = row.metadata || {};
                _renderOrderFormThumb({
                    prefix,
                    photoUrl: row.file_url,
                    detectedType: meta.form_type || 'unknown',
                    attachmentId: row.id,
                    fields: meta.fields || { prn_number: meta.prn_number },
                });
            });
        } catch (e) {
            console.warn('Could not load order form thumbnails:', e?.message || e);
        }
    };

    const removeOrderFormAttachment = async (attachmentId, btnParent) => {
        if (!confirm('Remove this order form photo? This cannot be undone.')) return;
        try {
            await AppDataStore.delete('prospect_attachments', attachmentId);
            if (btnParent && btnParent.parentElement) btnParent.parentElement.removeChild(btnParent);
            UI.toast.success('Order form photo removed');
        } catch (e) {
            UI.toast.error('Could not remove: ' + (e.message || e));
        }
    };

    // Block save when closing is ticked but no order-form photo attached.
    const hasOrderFormPhoto = (prefix) => {
        const thumbWrap = document.getElementById(`${prefix}-order-form-thumbs`);
        return !!(thumbWrap && thumbWrap.children.length > 0);
    };

    // Standard Functions page — Level 1 only. Shows a read-only preview of
    // each reusable block so admins can see the canonical field set that
    // powers Add Prospect / Edit Prospect / CPS New Customer Info in one
    // place. Edit buildBasicInfoBlock() to change any field — all 3 call
    // sites update automatically.
    const showStandardFunctionsView = async (container) => {
        container.innerHTML = `
            <style>
                .sf-wrap{max-width:1100px;margin:0 auto;padding:20px;}
                .sf-header{margin-bottom:20px;}
                .sf-header h1{font-size:24px;font-weight:700;margin:0 0 6px;color:var(--gray-900);}
                .sf-header p{color:var(--gray-500);font-size:14px;margin:0;}
                .sf-card{background:#fff;border:1px solid var(--gray-200);border-radius:12px;box-shadow:var(--shadow-sm);margin-bottom:20px;overflow:hidden;}
                .sf-card-hdr{padding:14px 18px;background:var(--gray-50);border-bottom:1px solid var(--gray-200);display:flex;justify-content:space-between;align-items:center;gap:12px;}
                .sf-card-hdr h3{margin:0;font-size:16px;font-weight:600;color:var(--gray-900);}
                .sf-card-hdr .sf-meta{font-size:12px;color:var(--gray-500);}
                .sf-card-body{padding:18px;}
                .sf-usage{background:#fffbea;border-left:3px solid #f59e0b;padding:10px 14px;border-radius:6px;margin-bottom:14px;font-size:13px;color:#78350f;}
                .sf-usage code{background:rgba(0,0,0,0.05);padding:1px 6px;border-radius:3px;font-size:12px;}
                .sf-preview-wrap{border:1px dashed var(--gray-300);border-radius:8px;padding:14px;background:var(--gray-50);}
                .sf-preview-wrap .form-control{pointer-events:none;}
            </style>
            <div class="sf-wrap">
                <div class="sf-header">
                    <h1><i class="fas fa-cubes"></i> Standard Functions</h1>
                    <p>Reusable form blocks shared across the CRM. Edit once — all consumers update automatically.</p>
                </div>

                <div class="sf-card">
                    <div class="sf-card-hdr">
                        <h3>👤 Basic Information</h3>
                        <span class="sf-meta">Used in 3 places</span>
                    </div>
                    <div class="sf-card-body">
                        <div class="sf-usage">
                            <strong>Consumers:</strong>
                            <ul style="margin:6px 0 0;padding-left:20px;">
                                <li>Prospects → <em>Add New Prospect</em> button</li>
                                <li>Prospects → <em>Edit Prospect</em> action</li>
                                <li>Calendar → Quick Add Activity → <em>CPS type</em> (New Customer Information)</li>
                            </ul>
                            <div style="margin-top:8px;">
                                <strong>To add a field:</strong> edit <code>buildBasicInfoBlock()</code> and <code>collectBasicInfoData()</code> in <code>script.js</code>. All 3 consumers pick it up on next page reload.
                            </div>
                        </div>
                        <div class="sf-preview-wrap">
                            ${buildBasicInfoBlock('preview')}
                        </div>
                    </div>
                </div>

                <div class="sf-card">
                    <div class="sf-card-hdr">
                        <h3>📝 Post-Meetup Notes</h3>
                        <span class="sf-meta">Used in 2 places</span>
                    </div>
                    <div class="sf-card-body">
                        <div class="sf-usage">
                            <strong>Consumers:</strong>
                            <ul style="margin:6px 0 0;padding-left:20px;">
                                <li>Prospect Profile → Meet Up History → per-activity <em>Notes</em> button</li>
                                <li>Activity Details → <em>Post-Meetup Notes</em> action</li>
                            </ul>
                            <div style="margin-top:8px;">
                                <strong>To add a field:</strong> edit <code>buildPostMeetupNotesBlock()</code> and <code>collectPostMeetupNotesData()</code> in <code>script.js</code>. Both consumers pick it up on next page reload.
                            </div>
                        </div>
                        <div class="sf-preview-wrap">
                            ${buildPostMeetupNotesBlock('preview', {}, {})}
                        </div>
                    </div>
                </div>

                <div class="sf-card">
                    <div class="sf-card-hdr">
                        <h3>💼 Meeting Outcome</h3>
                        <span class="sf-meta">Used in 3 places</span>
                    </div>
                    <div class="sf-card-body">
                        <div class="sf-usage">
                            <strong>Consumers:</strong>
                            <ul style="margin:6px 0 0;padding-left:20px;">
                                <li>Activity Details → <em>Outcome</em> action button</li>
                                <li>Today's Activities → clipboard icon</li>
                                <li>Prospect Profile → Meet Up History → <em>Close Sale</em> button</li>
                            </ul>
                            <div style="margin-top:8px;">
                                <strong>To add a field:</strong> edit <code>buildMeetingOutcomeBlock()</code> and <code>collectMeetingOutcomeData()</code> in <code>script.js</code>. All 3 consumers pick it up on next page reload.
                            </div>
                        </div>
                        <div class="sf-preview-wrap">
                            ${buildMeetingOutcomeBlock('preview', { prospect_id: 'preview' }, {})}
                        </div>
                    </div>
                </div>
            </div>
        `;
    };

    const updateActivityForm = async () => {
        const type = document.getElementById('modal-activity-type')?.value;
        const container = document.getElementById('dynamic-form-fields');
        if (!container) return;

        // Show/hide venue required star
        const venueStar = document.getElementById('venue-required-star');
        if (venueStar) {
            venueStar.style.display = ['CPS','FTF','EVENT','GR','XG'].includes(type) ? 'inline' : 'none';
        }

        // Show/hide CPS Summary section (only visible for CPS)
        const cpsSummarySection = document.getElementById('cps-summary-section');
        if (cpsSummarySection) {
            cpsSummarySection.style.display = type === 'CPS' ? 'block' : 'none';
        }

        let html = '';

        switch (type) {
            case 'CPS':
                html = `
                    <div class="form-section">
                        <h4>👤 New Customer Information</h4>
                        ${buildBasicInfoBlock('cps')}
                        <p class="help-text">Minimum required: Name, Phone Number, and Relation. Tap <strong>📷 Take Photo</strong> above to auto-fill from a paper form — the photo is also saved to the prospect record.</p>
                    </div>

                    <div class="form-section">
                        <h4>📢 CPS Invitation Method (Optional)</h4>
                        <div class="form-group">
                            <label>Invitation Method</label>
                            <select id="cps-invitation-method" class="form-control" onchange="document.getElementById('cps-invitation-other-div').style.display = this.value === 'Other' ? 'block' : 'none'">
                                <option value="">-- Select Method --</option>
                                <option value="Face to Face in Person">Face to Face in Person</option>
                                <option value="Call">Call</option>
                                <option value="WhatsApp">WhatsApp</option>
                                <option value="Event">Event</option>
                                <option value="Referral">Referral</option>
                                <option value="Walk-in">Walk-in</option>
                                <option value="Other">Other</option>
                            </select>
                        </div>
                        <div id="cps-invitation-other-div" class="form-group" style="display:none; margin-top: 10px;">
                            <label>Please specify method</label>
                            <input type="text" id="cps-invitation-other" class="form-control" placeholder="Specify method...">
                        </div>
                        <div class="form-group">
                            <label>Details</label>
                            <textarea id="cps-invitation-details" class="form-control" rows="2" placeholder="How was the customer convinced to attend?"></textarea>
                        </div>
                    </div>
                `;
                break;

            case 'FTF':
            case 'GR':
            case 'XG':
            case 'EMAIL':
            case 'CALL':
            case 'WHATSAPP':
                html = `
                    <div class="form-section">
                        <h4>🔍 Select ${type === 'CALL' || type === 'WHATSAPP' || type === 'EMAIL' ? 'Prospect/Customer' : 'Existing Prospect/Customer'}</h4>
                        <div class="form-group">
                            <div class="search-with-results">
                                <input type="text" id="entity-search" class="form-control" placeholder="Type name, phone, or email..." oninput="app.searchEntities()">
                                <div id="search-results" class="search-results-dropdown"></div>
                            </div>
                        </div>
                        <div id="selected-entity-info" class="selected-entity-info"></div>
                        <div class="form-group">
                            <label>Meeting Title/Purpose</label>
                            <input type="text" id="meeting-title" class="form-control" placeholder="e.g., Career discussion, PR4 follow-up">
                        </div>
                    </div>
                `;
                break;

            case 'PERSONAL':
            case 'OTHERS':
                html = `
                    <div class="form-section">
                        <h4>🔍 Link to Prospect/Customer (Optional)</h4>
                        <div class="form-group">
                            <div class="search-with-results">
                                <input type="text" id="entity-search" class="form-control" placeholder="Type name, phone, or email..." oninput="app.searchEntities()">
                                <div id="search-results" class="search-results-dropdown"></div>
                            </div>
                        </div>
                        <div id="selected-entity-info" class="selected-entity-info"></div>
                        <div class="form-group">
                            <label>Title/Purpose</label>
                            <input type="text" id="meeting-title" class="form-control" placeholder="e.g., Personal errand, Other activity">
                        </div>
                    </div>
                `;
                break;

            case 'FSA':
            case 'SITE':
                html = `
                    <div class="form-section">
                        <h4>🔍 Select Existing Prospect/Customer</h4>
                        <div class="form-group">
                            <div class="search-with-results">
                                <input type="text" id="entity-search" class="form-control" placeholder="Type name, phone, or email..." oninput="app.searchEntities()">
                                <div id="search-results" class="search-results-dropdown"></div>
                            </div>
                        </div>
                        <div id="selected-entity-info" class="selected-entity-info"></div>
                        
                        <div class="form-group">
                            <label>Address <span class="required">*</span></label>
                            <textarea id="location-address" class="form-control" rows="2" placeholder="Full address required" required></textarea>
                        </div>
                        
                        <div class="form-group">
                            <label class="checkbox-label">
                                <input type="checkbox" id="compass-needed"> Compass reading required
                            </label>
                        </div>
                    </div>
                `;
                break;

            case 'EVENT':
            case 'AGENT_MEETING':
            case 'AGENT_TRAINING':
                html = `
                    <div class="form-section">
                        <h4>🎪 ${type.replace('_', ' ')} Settings</h4>
                        <div class="form-group">
                            <label>Visibility</label>
                            <div class="radio-group" style="display:flex; gap:20px;">
                                <label><input type="radio" name="event-visibility" value="closed"> Closed Event (Private)</label>
                                <label><input type="radio" name="event-visibility" value="open" checked> Open Event (Public)</label>
                            </div>
                            <small class="help-text">Open events are visible to all agents. Closed events only to involved agents.</small>
                        </div>

                        <div class="form-group">
                            <label class="radio-label">
                                <input type="radio" name="event-selection" value="existing" checked onchange="app.toggleEventForm()"> Select Existing
                            </label>
                            <label class="radio-label">
                                <input type="radio" name="event-selection" value="new" onchange="app.toggleEventForm()"> Create New
                            </label>
                        </div>
                        
                        <div id="existing-event-section">
                            <div class="form-group">
                                <label>Choose ${type.includes('AGENT') ? 'Meeting/Training' : 'Event'}</label>
                                <select id="existing-event" class="form-control" onchange="app.showSelectedEventDetails(this.value)">
                                    <option value="">-- Select --</option>
                                    ${(await AppDataStore.getAll('events')).filter(e => e.is_active !== false && e.status !== 'inactive').map(e => `<option value="${e.id}">${e.event_title || e.title || 'Untitled Event'}</option>`).join('')}
                                </select>
                                <div id="event-details-preview"></div>
                            </div>
                        </div>
                        
                        <div id="new-event-section" style="display: none;">
                            <button type="button" class="btn btn-primary" onclick="event.stopPropagation(); app.openCpsCreateEventModal();" style="margin-top:4px;">
                                <i class="fas fa-plus"></i> Create New Event
                            </button>
                            <div id="cps-new-event-preview" style="margin-top:8px;"></div>
                        </div>

                        ${type === 'EVENT' ? `
                        <!-- 📢 Noticeboard publishing — applies to whichever event (existing or new) is attached. -->
                        <div class="form-group" style="margin-top: 15px; padding: 12px; background: #fdf2f8; border: 1px solid #fce7f3; border-radius: 8px;">
                            <label style="font-weight:600; color:#be185d; display:flex; align-items:center; gap:8px; cursor:pointer;">
                                <input type="checkbox" id="activity-publish-noticeboard" checked onchange="app.toggleActivityNoticeboardFields()">
                                📢 Publish to Noticeboard
                                <span style="color:#6b7280; font-weight:normal; font-size:0.85rem;">(visible to L12/13/14 — untick to keep private)</span>
                            </label>
                            <div id="activity-noticeboard-fields" style="display:block; margin-top:10px;">
                                <label style="font-size:0.9rem; color:#374151;">Poster Image URL</label>
                                <input type="url" id="activity-poster-url" class="form-control" placeholder="https://… or Supabase storage path" style="margin-top:4px;">
                                <small style="color:#6b7280; font-size:0.8rem;">Leave blank to keep the event's existing poster (if any).</small>
                            </div>
                        </div>
                        ` : ''}

                        <div class="form-group" style="margin-top: 15px;">
                            <label>Add Attendees (${type.includes('AGENT') ? 'Agents' : 'Clients/Agents'})</label>
                            <div class="search-with-results">
                                <input type="text" id="attendee-search" class="form-control" placeholder="Search to add..." oninput="app.searchAttendees()">
                                <div id="attendee-search-results" class="search-results-dropdown" style="display: none;"></div>
                            </div>
                            <div id="selected-attendees" style="margin-top: 10px;"></div>
                        </div>
                    </div>
                `;
                break;
        }

        container.innerHTML = html;
        calculateDuration();
    };

    const calculateDuration = () => {
        const start = document.getElementById('start-time')?.value;
        const end = document.getElementById('end-time')?.value;
        const durationField = document.getElementById('duration');

        if (start && end && durationField) {
            const startParts = start.split(':');
            const endParts = end.split(':');
            const startMin = parseInt(startParts[0]) * 60 + parseInt(startParts[1]);
            const endMin = parseInt(endParts[0]) * 60 + parseInt(endParts[1]);
            const duration = endMin - startMin;
            durationField.value = duration > 0 ? `${duration} min` : 'Invalid';
        }
    };

    const onStartTimeChange = () => {
        const startEl = document.getElementById('start-time');
        const endEl = document.getElementById('end-time');
        // Auto-fill end-time to start+60 min, UNLESS the user has already
        // manually typed a different end time in this modal session.
        // We use data-user-modified to distinguish a user edit from the
        // HTML default value="10:00" (which is never blank, so !endEl.value
        // would always block auto-fill — that was the prior bug).
        if (startEl?.value && endEl && !endEl.dataset.userModified) {
            const [h, m] = startEl.value.split(':').map(Number);
            const totalMin = h * 60 + m + 60;
            const endH = String(Math.floor(totalMin / 60) % 24).padStart(2, '0');
            const endM = String(totalMin % 60).padStart(2, '0');
            endEl.value = `${endH}:${endM}`;
        }
        calculateDuration();
    };

    const onEndTimeChange = () => {
        const endEl = document.getElementById('end-time');
        // Mark as user-modified so onStartTimeChange stops auto-filling it.
        if (endEl) endEl.dataset.userModified = '1';
        calculateDuration();
    };

    const toggleCoAgentSection = () => {
        const section = document.getElementById('co-agent-section');
        const checked = document.getElementById('allow-join')?.checked;
        if (section) section.style.display = checked ? 'block' : 'none';
        if (!checked) _state.sca = [];
        renderCoAgents();
    };

    const toggleEventForm = () => {
        const val = document.querySelector('input[name="event-selection"]:checked')?.value;
        const existing = document.getElementById('existing-event-section');
        const next = document.getElementById('new-event-section');
        if (existing) existing.style.display = val === 'existing' ? 'block' : 'none';
        if (next) next.style.display = val === 'new' ? 'block' : 'none';
    };

    // Show/hide the poster URL input when the noticeboard checkbox is toggled
    // inside the Quick Add Activity → EVENT modal.
    const toggleActivityNoticeboardFields = () => {
        const cb = document.getElementById('activity-publish-noticeboard');
        const fields = document.getElementById('activity-noticeboard-fields');
        if (fields) fields.style.display = cb?.checked ? 'block' : 'none';
    };

    const openCpsCreateEventModal = () => {
        const content = `
            ${buildEventCategoriesField([])}
            <div class="form-group"><label>Title*</label><input type="text" id="mkt-title" class="form-control"></div>
            <div class="form-row" style="display:flex;gap:12px;">
                <div class="form-group" style="flex:1;"><label>Date*</label><input type="date" id="mkt-event-date" class="form-control"></div>
                <div class="form-group" style="flex:1;"><label>Start Time</label><input type="time" id="mkt-start-time" class="form-control"></div>
                <div class="form-group" style="flex:1;"><label>End Time</label><input type="time" id="mkt-end-time" class="form-control"></div>
            </div>
            <div class="form-group"><label>Ticket Price (RM)</label><input type="number" id="mkt-price" class="form-control" value="0"></div>
            <div class="form-group"><label>Early Bird Price (RM)</label><input type="text" id="mkt-early-bird-price" class="form-control" placeholder="e.g. 199"></div>
            <div class="form-group"><label>Group Purchase Price (RM)</label><input type="text" id="mkt-group-price" class="form-control" placeholder="e.g. 299 (min 5 pax)"></div>
            <div class="form-group"><label>Duration (text fallback)</label><input type="text" id="mkt-duration" class="form-control" placeholder="e.g. 2 hours"></div>
            <div class="form-group"><label>Target Group</label><input type="text" id="mkt-target" class="form-control"></div>
            <div class="form-group"><label>Location / Venue</label><input type="text" id="mkt-location" class="form-control" placeholder="e.g. KL, Online"></div>
            <div class="form-group"><label>Speaker</label><input type="text" id="mkt-speaker" class="form-control" placeholder="e.g. Master Tan"></div>
            <div class="form-group"><label>Description</label><textarea id="mkt-desc" class="form-control"></textarea></div>
            <div class="form-group"><label>Poster Image URL <span style="color:var(--gray-400);font-weight:normal;">(shown on Noticeboard)</span></label><input type="url" id="mkt-poster-url" class="form-control" placeholder="https://… or Supabase storage path"></div>
            <div class="form-group"><label>Remarks</label><input type="text" id="mkt-remarks" class="form-control"></div>
            <div class="form-group"><label><input type="checkbox" id="mkt-active" checked> Is Active</label></div>
            <div class="form-group" style="padding:10px 12px;background:#fdf2f8;border:1px solid #fce7f3;border-radius:8px;">
                <label style="font-weight:600;color:#be185d;display:flex;align-items:center;gap:8px;cursor:pointer;">
                    <input type="checkbox" id="mkt-publish-noticeboard" checked> 📢 Publish to Noticeboard <span style="color:#6b7280;font-weight:normal;font-size:0.85rem;">(visible to L12/13/14 — untick to keep private)</span>
                </label>
            </div>
        `;
        UI.showModal('Add New Event', content, [
            { label: 'Cancel', type: 'secondary', action: 'UI.hideModal()' },
            { label: 'Save', type: 'primary', action: '(async () => { await app.saveCpsNewEvent(); })()' }
        ]);
    };

    const saveCpsNewEvent = async () => {
        const title = document.getElementById('mkt-title')?.value?.trim();
        if (!title) return UI.toast.error('Title is required');

        // Date is required so the event has a valid timeline (otherwise the
        // noticeboard would skip it and the calendar wouldn't know where to
        // pin it). Earlier this field was missing entirely — events created
        // here landed in the DB with no date and rendered as "Invalid Date"
        // on the noticeboard.
        const eventDate = document.getElementById('mkt-event-date')?.value;
        if (!eventDate) return UI.toast.error('Event date is required');

        const catCheckboxes = document.querySelectorAll('#mkt-event-categories .mkt-event-category-cb:checked');
        const selectedCats = Array.from(catCheckboxes).map(cb => cb.value);
        const othersCb = document.getElementById('mkt-event-cat-others-cb');
        const othersInput = document.getElementById('mkt-event-cat-others-input');
        if (othersCb && othersCb.checked && othersInput && othersInput.value.trim()) {
            othersInput.value.split(',').map(s => s.trim()).filter(Boolean).forEach(c => {
                if (!selectedCats.includes(c)) selectedCats.push(c);
            });
        }
        if (!selectedCats.length) return UI.toast.error('At least one category is required');

        const data = {
            // Write BOTH `title` and `event_title` so downstream consumers
            // (calendar list, noticeboard, attendee modal) all find the name
            // regardless of which column they prefer.
            title: title,
            event_title: title,
            date: document.getElementById('mkt-event-date')?.value || null,
            event_date: document.getElementById('mkt-event-date')?.value || null,
            start_time: document.getElementById('mkt-start-time')?.value || null,
            end_time:   document.getElementById('mkt-end-time')?.value || null,
            ticket_price: parseFloat(document.getElementById('mkt-price')?.value) || 0,
            early_bird_price: document.getElementById('mkt-early-bird-price')?.value || '',
            group_purchase_price: document.getElementById('mkt-group-price')?.value || '',
            duration: document.getElementById('mkt-duration')?.value || '',
            target_group: document.getElementById('mkt-target')?.value || '',
            location: document.getElementById('mkt-location')?.value || '',
            speaker: document.getElementById('mkt-speaker')?.value || '',
            description: document.getElementById('mkt-desc')?.value || '',
            poster_url: document.getElementById('mkt-poster-url')?.value?.trim() || null,
            published_to_noticeboard: document.getElementById('mkt-publish-noticeboard')?.checked || false,
            remarks: document.getElementById('mkt-remarks')?.value || '',
            is_active: document.getElementById('mkt-active')?.checked ?? true,
            status: document.getElementById('mkt-active')?.checked ? 'upcoming' : 'inactive',
            categories: JSON.stringify(selectedCats),
            created_by: _state.cu ? _state.cu.id : null,
            updated_at: new Date().toISOString()
        };

        try {
            const newEvent = await AppDataStore.create('events', data);
            UI.hideModal();
            UI.toast.success('Event created successfully');

            // Refresh existing events dropdown and auto-select the new event
            const dropdown = document.getElementById('existing-event');
            if (dropdown) {
                const allEvents = await AppDataStore.getAll('events');
                const activeEvents = allEvents.filter(e => e.is_active !== false && e.status !== 'inactive');
                dropdown.innerHTML = '<option value="">-- Select --</option>' +
                    activeEvents.map(e => `<option value="${e.id}" ${e.id === newEvent.id ? 'selected' : ''}>${e.event_title || e.title || 'Untitled Event'}</option>`).join('');
                showSelectedEventDetails(newEvent.id);
            }

            // Switch to "Select Existing" with the new event selected
            const existingRadio = document.querySelector('input[name="event-selection"][value="existing"]');
            if (existingRadio) {
                existingRadio.checked = true;
                toggleEventForm();
            }
        } catch (err) {
            console.error('saveCpsNewEvent error:', err);
            UI.toast.error('Save failed: ' + (err.message || err));
        }
    };

    const showSelectedEventDetails = async (eventId) => {
        const preview = document.getElementById('event-details-preview');
        if (!preview) return;
        if (!eventId) { preview.innerHTML = ''; return; }
        const ev = await AppDataStore.getById('events', eventId);
        if (!ev) { preview.innerHTML = ''; return; }

        // Reflect this event's current noticeboard state in the toggle so the
        // user sees whether it's already published, and can update the poster
        // URL without losing the existing value.
        const ncb = document.getElementById('activity-publish-noticeboard');
        const purl = document.getElementById('activity-poster-url');
        if (ncb) {
            ncb.checked = ev.published_to_noticeboard === true;
            toggleActivityNoticeboardFields();
        }
        if (purl && !purl.value) purl.value = ev.poster_url || '';

        preview.innerHTML = `
            <div style="margin-top:12px; padding:12px; background:var(--gray-50,#faf9f7); border:1px solid var(--border,#e5e0d8); border-radius:8px; font-size:13px;">
                <div style="font-weight:600; margin-bottom:8px; color:var(--primary);">Event Details</div>
                <div style="display:grid; grid-template-columns:110px 1fr; gap:4px 8px;">
                    <span style="color:var(--gray-400);">Type:</span><span>${ev.event_type || '-'}</span>
                    <span style="color:var(--gray-400);">Title:</span><span><strong>${ev.event_title || ev.title || '-'}</strong></span>
                    <span style="color:var(--gray-400);">Speaker:</span><span>${ev.speaker || '-'}</span>
                    <span style="color:var(--gray-400);">Duration:</span><span>${ev.duration || '-'}</span>
                    <span style="color:var(--gray-400);">Venue:</span><span>${ev.location || ev.venue || '-'}</span>
                    <span style="color:var(--gray-400);">Ticket Price:</span><span>${ev.ticket_price ? 'RM ' + ev.ticket_price : '-'}</span>
                    <span style="color:var(--gray-400);">Early Bird:</span><span>${ev.early_bird_price || '-'}</span>
                    <span style="color:var(--gray-400);">Group Price:</span><span>${ev.group_purchase_price || '-'}</span>
                    <span style="color:var(--gray-400);">Target Group:</span><span>${ev.target_group || '-'}</span>
                    <span style="color:var(--gray-400);">Description:</span><span>${ev.description || '-'}</span>
                </div>
            </div>
        `;
    };

    const toggleAttendeePaid = async (attendeeId, checked) => {
        await AppDataStore.update('event_attendees', attendeeId, { paid: checked });
    };

    const toggleAttendeeTicket = async (attendeeId, checked) => {
        await AppDataStore.update('event_attendees', attendeeId, { ticket_created: checked });
    };

    const toggleAttendeeAttended = async (attendeeId, checked, entityId, entityType, eventId, activityDate) => {
        const status = checked ? 'Attended' : 'Registered';
        await AppDataStore.update('event_attendees', attendeeId, { attended: checked, attendance_status: status });

        // Write back to event_registrations so it appears in prospect/customer profile
        if (entityId && eventId) {
            try {
                const existing = (await AppDataStore.getAll('event_registrations')).find(
                    r => r.event_id == eventId && r.attendee_id == entityId
                );
                if (existing) {
                    await AppDataStore.update('event_registrations', existing.id, { attendance_status: status });
                } else {
                    await AppDataStore.create('event_registrations', {
                        event_id: eventId,
                        attendee_id: entityId,
                        attendee_type: entityType || 'prospect',
                        attendance_status: status,
                        event_date: activityDate || new Date().toISOString().split('T')[0],
                        points_awarded: 0,
                        created_at: new Date().toISOString()
                    });
                }
                UI.toast.success(checked ? 'Marked as Attended' : 'Attendance removed');

                // Trigger follow-up: event attendance triggers (data-driven)
                if (checked && entityId && eventId) {
                    dispatchOnEventAttendanceTriggers(entityId, entityType || 'prospect', eventId, activityDate).catch(e => console.warn('Event attendance follow-up failed:', e));
                }
            } catch (err) {
                console.error('toggleAttendeeAttended write-back error:', err);
            }
        }
    };

    const toggleAttendeeUnattended = async (attendeeId, checked, entityId, entityType, eventId, activityDate) => {
        // Mutually exclusive with Attended — checking Unattended marks as No Show, unchecking
        // returns to plain Registered.
        const status = checked ? 'No Show' : 'Registered';
        await AppDataStore.update('event_attendees', attendeeId, { attended: false, attendance_status: status });

        if (entityId && eventId) {
            try {
                const existing = (await AppDataStore.getAll('event_registrations')).find(
                    r => r.event_id == eventId && r.attendee_id == entityId
                );
                if (existing) {
                    await AppDataStore.update('event_registrations', existing.id, { attendance_status: status });
                } else {
                    await AppDataStore.create('event_registrations', {
                        event_id: eventId,
                        attendee_id: entityId,
                        attendee_type: entityType || 'prospect',
                        attendance_status: status,
                        event_date: activityDate || new Date().toISOString().split('T')[0],
                        points_awarded: 0,
                        created_at: new Date().toISOString()
                    });
                }
                UI.toast.success(checked ? 'Marked as Unattended (No Show)' : 'Unattended cleared');
            } catch (err) {
                console.error('toggleAttendeeUnattended write-back error:', err);
            }
        }
        // Refresh the modal so the Attended checkbox unticks if it was on
        const allActivities = await AppDataStore.getAll('activities');
        const acts = allActivities.filter(a => a.event_id == eventId && a.activity_date == activityDate);
        if (acts.length > 0) await app.viewActivityDetails(acts[0].id);
    };

    const toggleLifeChartType = async (prospectId, dateType, checked) => {
        // Read the FRESHEST state (bypass cache) so concurrent toggles on both
        // solar and lunar don't race and overwrite each other.
        AppDataStore.invalidateCache('prospects');
        const prospect = await AppDataStore.getById('prospects', prospectId);
        if (!prospect) {
            UI.toast.error('Prospect not found');
            return;
        }
        // Mutually exclusive: ticking one auto-unticks the other.
        let newType;
        if (checked) {
            newType = dateType; // 'solar' or 'lunar'
        } else {
            newType = null;
        }

        let writeOk = false;
        try {
            await AppDataStore.update('prospects', prospectId, { life_chart_type: newType });
            writeOk = true;
        } catch (e) {
            console.warn('life_chart_type update failed:', e);
        }

        if (!writeOk) {
            UI.toast.error('Failed to save life chart type — please try again');
            // Re-render to revert the checkbox to its actual persisted state
            const bodyEl = document.getElementById(`acc-body-personal-${prospectId}`);
            if (bodyEl) await switchProspectTab('personal', prospectId, null, bodyEl);
            return;
        }

        // Update both checkboxes directly in the DOM instead of re-rendering
        // the whole tab.  A full re-render via switchProspectTab fetches the
        // prospect again — if the read returns stale/cached data the checkbox
        // silently reverts to its old state ("tick doesn't stick").
        AppDataStore.invalidateCache('prospects');
        UI.toast.success('Life chart type updated');
        const bodyEl = document.getElementById(`acc-body-personal-${prospectId}`);
        if (bodyEl) {
            bodyEl.querySelectorAll('input[type="checkbox"]').forEach(chk => {
                const oc = chk.getAttribute('onchange') || '';
                const row = chk.closest('.pv-row');
                const lbl = row ? row.querySelector('.pv-lbl') : null;
                let isActive = false;
                if (oc.includes("'solar'")) { isActive = newType === 'solar'; chk.checked = isActive; }
                else if (oc.includes("'lunar'")) { isActive = newType === 'lunar'; chk.checked = isActive; }
                if (lbl) lbl.style.fontWeight = isActive ? '700' : '';
            });
        }
    };

    const showAttendeeDetails = async (entityId, type) => {
        if (!entityId) { UI.toast.error('No profile available'); return; }
        const table = type === 'customer' ? 'customers' : 'prospects';
        const person = await AppDataStore.getById(table, entityId);
        if (!person) { UI.toast.error('Profile not found'); return; }
        const agent = person.responsible_agent_id ? await AppDataStore.getById('users', person.responsible_agent_id) : null;
        const row = (label, value) => `
            <div style="display:flex;gap:8px;padding:8px 0;border-bottom:1px solid var(--border,#e5e0d8);">
                <span style="width:140px;font-size:12px;color:var(--gray-400);flex-shrink:0;">${label}</span>
                <span style="font-size:13px;font-weight:500;">${value || '—'}</span>
            </div>`;
        const content = `
            <div style="padding:4px 0;">
                ${row('Name', person.full_name)}
                ${row('IC Number', person.ic_number)}
                ${row('Email', person.email)}
                ${row('Date of Birth', person.date_of_birth)}
                ${row('Lunar Date of Birth', person.lunar_birth)}
                ${row('Occupation', person.occupation)}
                ${row('Agent', agent?.full_name)}
            </div>`;
        UI.showModal(person.full_name || 'Attendee Details', content, [
            { label: 'View Full Profile', type: 'primary', action: `UI.hideModal(); app.${type === 'customer' ? 'showCustomerDetail' : 'showProspectDetail'}(${entityId})` },
            { label: 'Close', type: 'secondary', action: 'UI.hideModal()' }
        ]);
    };

    const goToProspectEventNotes = async (entityId, eventId, entityType, activityDate) => {
        if (!entityId) return;
        // Ensure event_registrations record exists so it shows in prospect's Activities & Events tab
        try {
            const existing = (await AppDataStore.getAll('event_registrations')).find(
                r => r.event_id == eventId && r.attendee_id == entityId
            );
            if (!existing) {
                await AppDataStore.create('event_registrations', {
                    event_id: eventId,
                    attendee_id: entityId,
                    attendee_type: entityType || 'prospect',
                    attendance_status: 'Registered',
                    event_date: activityDate || new Date().toISOString().split('T')[0],
                    points_awarded: 0,
                    created_at: new Date().toISOString()
                });
            }
        } catch (err) {
            console.warn('goToProspectEventNotes: could not write event_registrations', err);
        }
        UI.hideModal();
        (window.app.showProspectDetail || (() => {}))(entityId);
    };

    const showAddAttendeeSearch = (eventId, activityId) => {
        // Modal opens instantly. No preload of getAll('prospects') —
        // a 124-row prospects fetch with heavy jsonb columns
        // (closing_records_history / pre2025_purchases / feng_shui_audits)
        // can take 5–20 s on nano under load, leaving the user staring at
        // "no results" while typing. Search is now server-side via the
        // pg_trgm-indexed searchProspects path (~300 ms per query).
        window._addAttSelected = null;
        window._addAttEventId = eventId;
        window._addAttActivityId = activityId;
        window._addAttSearchSeq = 0;       // race-token: only the most-recent search commits
        window._addAttCustomers = null;    // lazily fetched on first search (small table)
        const content = `
            <div class="form-group">
                <label>Search Prospect / Customer</label>
                <input type="text" id="add-att-search" class="form-control" placeholder="Type name or phone..." oninput="app.searchAddAttendee(this.value)" autocomplete="off">
                <div id="add-att-results" style="border:1px solid var(--border,#e5e0d8);border-radius:4px;max-height:200px;overflow-y:auto;background:#fff;margin-top:4px;">
                    <div style="padding:10px 12px;color:#9CA3AF;font-size:12px;">Type 2 or more characters to search…</div>
                </div>
            </div>
            <div id="add-att-name" style="margin-top:8px;font-weight:600;color:var(--primary);min-height:20px;"></div>
            <div style="margin-top:12px;padding-top:12px;border-top:1px solid var(--border,#e5e0d8);">
                <div style="font-size:12px;color:var(--gray-400);margin-bottom:6px;">New person not in system?</div>
                <button class="btn secondary btn-sm" onclick="app.showFTFAttendeeForm()" style="width:100%;">➕ First Time Friend (New Prospect)</button>
            </div>
        `;
        UI.showModal('Add Attendee', content, [
            { label: 'Cancel', type: 'secondary', action: 'UI.hideModal()' },
            { label: 'Add', type: 'primary', action: '(async()=>{ await app.confirmAddAttendee(); })()' }
        ]);
    };

    // v6: Search & add an agent/consultant attendee.
    // Uses the users table filtered by consultant role (Level 7) or any agent level.
    // Writes to event_attendees with attendee_type='agent'.
    const showAddConsultantSearch = async (eventId, activityId) => {
        const users = await AppDataStore.getAll('users');
        // Filter to consultants + agents (Level 3-12). Exclude customers/referrers/inactive.
        const filtered = users.filter(u => {
            if (u.status === 'inactive') return false;
            const lvl = _getUserLevel(u);
            return lvl >= 3 && lvl <= 12; // agents/consultants only; admins (1-2), customers (13), referrers (14) excluded
        });
        // Dedupe by email (fallback: normalized name) — keep the most senior (lowest level) row,
        // then the oldest created_at. Defensive net against stray duplicate rows in the users table.
        const seen = new Map();
        for (const u of filtered) {
            const key = (u.email && String(u.email).trim().toLowerCase())
                || `name:${String(u.full_name || '').trim().toLowerCase()}`;
            if (!key || key === 'name:') continue;
            const prev = seen.get(key);
            if (!prev) { seen.set(key, u); continue; }
            const prevLvl = _getUserLevel(prev);
            const curLvl  = _getUserLevel(u);
            if (curLvl < prevLvl) { seen.set(key, u); continue; }
            if (curLvl === prevLvl) {
                const prevTs = Date.parse(prev.created_at || 0) || 0;
                const curTs  = Date.parse(u.created_at || 0) || 0;
                if (curTs && prevTs && curTs < prevTs) seen.set(key, u);
            }
        }
        const eligible = Array.from(seen.values());
        window._addConsultAll = eligible.map(u => ({ ...u, _type: 'agent' }));
        window._addConsultSelected = null;
        window._addConsultEventId = eventId;
        window._addConsultActivityId = activityId;
        const content = `
            <div class="form-group">
                <label>Search Agent / Consultant</label>
                <input type="text" id="add-consult-search" class="form-control" placeholder="Type name, phone, or role..." oninput="app.searchAddConsultant(this.value)">
                <div id="add-consult-results" style="border:1px solid var(--border,#e5e0d8);border-radius:4px;max-height:220px;overflow-y:auto;display:none;background:#fff;"></div>
            </div>
            <div id="add-consult-name" style="margin-top:8px;font-weight:600;color:var(--primary);min-height:20px;"></div>
            <div style="margin-top:10px;font-size:11px;color:var(--gray-400);">Showing ${eligible.length} active agents/consultants</div>
        `;
        UI.showModal('Add Agent / Consultant', content, [
            { label: 'Cancel', type: 'secondary', action: 'UI.hideModal()' },
            { label: 'Add', type: 'primary', action: '(async()=>{ await app.confirmAddConsultant(); })()' }
        ]);
    };

    const searchAddConsultant = (query) => {
        const q = (query || '').toLowerCase().trim();
        const res = document.getElementById('add-consult-results');
        if (!res) return;
        if (q.length < 1) { res.style.display = 'none'; res.innerHTML = ''; return; }
        const matches = (window._addConsultAll || []).filter(u =>
            (u.full_name || '').toLowerCase().includes(q)
            || (u.phone || '').includes(q)
            || (u.role || '').toLowerCase().includes(q)
            || (u.email || '').toLowerCase().includes(q)
        ).slice(0, 15);
        res.innerHTML = matches.map(u =>
            `<div style="padding:8px 12px;cursor:pointer;border-bottom:1px solid #eee;" onmousedown="app.selectAddConsultant(${u.id},'${(u.full_name||'').replace(/'/g,"\\'")}')">
                <strong>${escapeHtml(u.full_name || '')}</strong>
                <small style="color:gray;margin-left:6px;">${escapeHtml(u.role || '')}</small>
            </div>`
        ).join('') || '<div style="padding:12px;color:#9CA3AF;font-size:12px;">No matches</div>';
        res.style.display = 'block';
    };

    const selectAddConsultant = (id, name) => {
        window._addConsultSelected = { id, name };
        const nameEl = document.getElementById('add-consult-name');
        if (nameEl) nameEl.textContent = '✅ Selected: ' + name;
        const res = document.getElementById('add-consult-results');
        if (res) res.style.display = 'none';
        const input = document.getElementById('add-consult-search');
        if (input) input.value = name;
    };

    const confirmAddConsultant = async () => {
        const eventId = window._addConsultEventId;
        const activityId = window._addConsultActivityId;
        const s = window._addConsultSelected;
        if (!s) { UI.toast.error('Please select an agent first'); return; }

        // Guard against duplicate (same agent already added to this event/date)
        try {
            const existing = await AppDataStore.query('event_attendees', { activity_id: activityId });
            const dup = (existing || []).find(a =>
                a.attendee_type === 'agent'
                && String(a.entity_id || a.attendee_id) === String(s.id)
            );
            if (dup) {
                UI.toast.error(s.name + ' is already an agent attendee');
                return;
            }
        } catch (_) {}

        await AppDataStore.create('event_attendees', {
            event_id: eventId,
            activity_id: activityId,
            attendee_id: s.id,
            entity_id: s.id,
            entity_name: s.name || '',
            attendee_type: 'agent',
            attendance_status: 'Registered',
            added_by_agent_id: _state.cu?.id || null,
            added_by_name: _state.cu?.full_name || '',
            created_at: new Date().toISOString()
        });
        UI.hideModal();
        await app.viewActivityDetails(activityId);
        UI.toast.success(s.name + ' added as agent attendee');
    };

    const removeAgentAttendee = async (attendeeId, activityId) => {
        if (!confirm('Remove this agent from the event?')) return;
        try {
            await AppDataStore.delete('event_attendees', attendeeId);
            UI.toast.success('Agent removed');
            if (activityId) await app.viewActivityDetails(activityId);
        } catch (e) {
            UI.toast.error('Could not remove: ' + e.message);
        }
    };

    // Server-side search with debounce + race-token + visible loading state.
    // Replaces the old in-memory filter on a preloaded getAll('prospects') +
    // getAll('customers') array — that pattern made the modal feel "stuck"
    // because typing a name showed zero results until the 5–20 s preload
    // finished. Each call hits searchProspects (pg_trgm-indexed, ~300 ms)
    // plus a one-time customers fetch (small table — 10 rows today).
    const searchAddAttendee = (query) => {
        const q = (query || '').trim();
        const res = document.getElementById('add-att-results');
        if (!res) return;
        const setState = (html) => { res.innerHTML = html; res.style.display = 'block'; };

        if (q.length < 2) {
            setState('<div style="padding:10px 12px;color:#9CA3AF;font-size:12px;">Type 2 or more characters to search…</div>');
            return;
        }

        // Debounce — coalesce keystrokes within 250 ms into a single query.
        if (window._addAttSearchTimer) clearTimeout(window._addAttSearchTimer);
        // Show searching state immediately so the user gets feedback while typing.
        setState('<div style="padding:10px 12px;color:#6b7280;font-size:12px;"><i class="fas fa-circle-notch fa-spin" style="margin-right:6px;"></i>Searching database…</div>');

        const seq = ++window._addAttSearchSeq;
        window._addAttSearchTimer = setTimeout(async () => {
            try {
                // Customers table is small (≤ a few hundred); cache once per modal open.
                if (!window._addAttCustomers) {
                    try { window._addAttCustomers = await AppDataStore.getAll('customers'); }
                    catch { window._addAttCustomers = []; }
                }
                const qLower = q.toLowerCase();
                const customerMatches = (window._addAttCustomers || []).filter(c =>
                    (c.full_name || '').toLowerCase().includes(qLower) || (c.phone || '').includes(q)
                ).slice(0, 5).map(c => ({ ...c, _type: 'customer' }));

                let prospectMatches = [];
                try {
                    const rows = await AppDataStore.searchProspects(q, { limit: 10, includeDormant: true });
                    prospectMatches = (rows || []).map(p => ({ ...p, _type: 'prospect' }));
                } catch (e) {
                    console.warn('[addAttendee] searchProspects failed:', e);
                }

                // If a newer keystroke fired while we were waiting, drop this result.
                if (seq !== window._addAttSearchSeq) return;

                // Dedupe by normalized phone (fallback: name) so the same person
                // doesn't appear twice when they exist as both prospect and customer.
                const all = [...prospectMatches, ...customerMatches];
                const seen = new Map();
                for (const p of all) {
                    const key = (p.phone && String(p.phone).replace(/\D+/g, ''))
                        || `name:${String(p.full_name || '').trim().toLowerCase()}`;
                    if (!key || key === 'name:') continue;
                    if (!seen.has(key)) seen.set(key, p);
                }
                const matches = Array.from(seen.values()).slice(0, 10);

                if (matches.length === 0) {
                    setState('<div style="padding:10px 12px;color:#9CA3AF;font-size:12px;">No matches in database. Use “First Time Friend” below to add as new prospect.</div>');
                    return;
                }

                res.innerHTML = matches.map(p => {
                    const safeName = (p.full_name || '').replace(/'/g, "\\'");
                    return `<div style="padding:8px 12px;cursor:pointer;border-bottom:1px solid #eee;" onmousedown="app.selectAddAttendee(${p.id},'${safeName}','${p._type}')">
                        ${escapeHtml(p.full_name || '')} <small style="color:gray;margin-left:6px;">${p._type}${p.phone ? ' · ' + escapeHtml(p.phone) : ''}</small>
                    </div>`;
                }).join('');
                res.style.display = 'block';
            } catch (e) {
                if (seq !== window._addAttSearchSeq) return;
                setState('<div style="padding:10px 12px;color:#b91c1c;font-size:12px;">Search failed. Check your connection and try again.</div>');
                console.error('[addAttendee] search error:', e);
            }
        }, 250);
    };

    const selectAddAttendee = (id, name, type) => {
        window._addAttSelected = { id, name, type };
        const nameEl = document.getElementById('add-att-name');
        if (nameEl) nameEl.textContent = '✅ Selected: ' + name;
        const res = document.getElementById('add-att-results');
        if (res) res.style.display = 'none';
        const input = document.getElementById('add-att-search');
        if (input) input.value = name;
    };

    const showFTFAttendeeForm = () => {
        // Save event context, then open full Add New Prospect modal
        const eventId = window._addAttEventId;
        const activityId = window._addAttActivityId;

        // One-time listener: after prospect is created, add as attendee
        const handler = async (e) => {
            document.removeEventListener('prospectCreated', handler);
            const prospect = e.detail;
            if (!prospect?.id || !eventId) return;
            await AppDataStore.create('event_attendees', {
                event_id: eventId,
                activity_id: activityId,
                // attendee_id is the canonical Supabase column — must be set so the record
                // remains linked to the prospect when other columns get stripped on insert.
                attendee_id: prospect.id,
                entity_id: prospect.id,
                entity_name: prospect.full_name || '',
                attendee_type: 'prospect',
                attendance_status: 'Registered',
                added_by_agent_id: _state.cu?.id || null,
                added_by_name: _state.cu?.full_name || '',
                created_at: new Date().toISOString()
            });
            await app.viewActivityDetails(activityId);
            UI.toast.success((prospect.full_name || 'New prospect') + ' added as attendee');
        };
        document.addEventListener('prospectCreated', handler);

        openProspectModal(); // opens the full Add New Prospect form
    };

    const confirmAddAttendee = async () => {
        const eventId = window._addAttEventId;
        const activityId = window._addAttActivityId;

        const s = window._addAttSelected;
        if (!s) { UI.toast.error('Please select a person first'); return; }
        await AppDataStore.create('event_attendees', {
            event_id: eventId,
            activity_id: activityId,
            // attendee_id is the actual Supabase schema column — entity_id gets stripped
            // by data.js because it doesn't exist in the table, which is why prior writes
            // persisted with no link to the prospect.
            attendee_id: s.id,
            entity_id: s.id,
            entity_name: s.name || s.full_name || '',
            attendee_type: s.type,
            attendance_status: 'Registered',
            added_by_agent_id: _state.cu?.id || null,
            added_by_name: _state.cu?.full_name || '',
            created_at: new Date().toISOString()
        });
        UI.hideModal();
        await app.viewActivityDetails(activityId);
        UI.toast.success(s.name + ' added as attendee');
    };

    const searchAttendees = () => {
        const input = document.getElementById('attendee-search');
        const resultsContainer = document.getElementById('attendee-search-results');

        if (input && resultsContainer) {
            clearTimeout(window.attendeeSearchTimeout);
            window.attendeeSearchTimeout = (async () => {
                const searchTerm = input.value.toLowerCase();
                if (searchTerm.length < 2) {
                    resultsContainer.style.display = 'none';
                    return;
                }

                const type = document.getElementById('modal-activity-type')?.value;
                const isAgentRelevant = type === 'AGENT_MEETING' || type === 'AGENT_TRAINING' || type === 'EVENT';

                let matches = [];
                if (type === 'CPS' || type === 'EVENT') {
                    const [_prospects, _customers] = await Promise.all([AppDataStore.getAll('prospects'), AppDataStore.getAll('customers')]);
                    const all = [..._prospects, ..._customers];
                    const available = all.filter(p => !_state.sat.find(a => a.id === p.id && a.type !== 'agent'));
                    matches = available.filter(p =>
                        (p.full_name && p.full_name.toLowerCase().includes(searchTerm)) ||
                        (p.phone && p.phone.includes(searchTerm)) ||
                        (p.email && p.email?.toLowerCase().includes(searchTerm))
                    ).map(p => ({ ...p, type: p.is_customer ? 'customer' : 'prospect' }));
                }

                if (isAgentRelevant) {
                    const agents = (await AppDataStore.getAll('users')).filter(u =>
                        isAgent(u) &&
                        !_state.sat.find(a => a.id === u.id && a.type === 'agent')
                    );
                    const agentMatches = agents.filter(a =>
                        a.full_name && a.full_name.toLowerCase().includes(searchTerm)
                    ).map(a => ({ ...a, type: 'agent' }));
                    matches = [...matches, ...agentMatches];
                }

                matches = matches.slice(0, 10);

                if (matches.length > 0) {
                    resultsContainer.innerHTML = matches.map(m => `
                        <div class="search-result-item" onclick="app.addAttendee(${m.id}, '${m.type}', '${m.full_name.replace(/'/g, "\\'")}')">
                            <div class="name">${m.full_name} <small>(${m.type})</small></div>
                            <div class="details">${m.phone || ''}</div>
                        </div>
                    `).join('');
                    resultsContainer.style.display = 'block';
                } else {
                    resultsContainer.innerHTML = '<div class="search-result-item">No matches found</div>';
                    resultsContainer.style.display = 'block';
                }
            }, 200);
        }
    };

    const addAttendee = (id, type, name) => {
        _state.sat.push({
            id: id,
            name: name,
            type: type,
            status: 'Registered'
        });
        renderAttendees();
        const results = document.getElementById('attendee-search-results');
        if (results) results.style.display = 'none';
        const input = document.getElementById('attendee-search');
        if (input) input.value = '';
    };

    const removeAttendee = (id) => {
        _state.sat = _state.sat.filter(a => a.id !== id);
        renderAttendees();
    };

    const updateAttendeeStatus = (id, status) => {
        const attendee = _state.sat.find(a => a.id === id);
        if (attendee) attendee.status = status;
    };

    const renderAttendees = () => {
        const container = document.getElementById('selected-attendees');
        if (container) {
            container.innerHTML = _state.sat.map(a => `
                <div class="co-agent-tag" style="display:inline-flex; align-items:center; gap:8px; padding:6px 12px; margin-bottom:8px; background:var(--gray-100); border-radius:4px; border:1px solid var(--gray-200);">
                    <span>${a.name}</span>
                    <select class="form-control" style="width: auto; padding: 2px 6px; font-size: 11px; height: 24px;" onchange="app.updateAttendeeStatus(${a.id}, this.value)">
                        <option value="Registered" ${a.status === 'Registered' ? 'selected' : ''}>Registered</option>
                        <option value="Attended" ${a.status === 'Attended' ? 'selected' : ''}>Attended</option>
                        <option value="No Show" ${a.status === 'No Show' ? 'selected' : ''}>No Show</option>
                    </select>
                    <span class="remove" onclick="app.removeAttendee(${a.id})" style="cursor:pointer; font-weight:bold; margin-left:4px; color:var(--danger-color);">&times;</span>
                </div>
            `).join('');
        }
    };

    const updateLunarBirth = (dobId = 'cps-dob', lunarId = 'cps-lunar') => {
        const dob = document.getElementById(dobId)?.value;
        const lunarField = document.getElementById(lunarId);
        if (dob && lunarField) {
            const lunarDate = convertSolarToLunar(dob);
            if (lunarDate) {
                lunarField.value = lunarDate;
            } else {
                UI.toast.warning("Lunar conversion not available for this date.");
                lunarField.value = '';
            }
        }
    };

    const searchReferrers = async () => {
        try {
            const term = document.getElementById('cps-referrer')?.value.toLowerCase();
            const resultsDiv = document.getElementById('cps-referrer-results');

            if (!term || term.length < 1) {
                if (resultsDiv) resultsDiv.style.display = 'none';
                return;
            }

            // Indexed server-side prospect search (trigram GIN). users table
            // is small (~dozens of rows) so a cached getAll + client filter
            // is still the right call there.
            const [matchedProspectsRaw, allUsers] = await Promise.all([
                AppDataStore.searchProspects(term, { includeDormant: true, limit: 15 }),
                AppDataStore.getAll('users'),
            ]);
            // Respect the original "active only" rule for prospects in this UI.
            const matchedProspects = matchedProspectsRaw
                .filter(p => !p.status || p.status === 'active')
                .slice(0, 5);
            const matchedConsultants = allUsers
                .filter(u => {
                    const lvl = parseInt(u.role?.match(/Level\s+(\d+)/i)?.[1] || 0);
                    return lvl >= 3 && u.full_name && u.full_name.toLowerCase().includes(term);
                })
                .slice(0, 5);

            if (resultsDiv) {
                let html = '';

                if (matchedProspects.length > 0) {
                    html += `<div style="padding:4px 10px; font-size:11px; font-weight:600; color:#6b7280; background:#f9fafb; border-bottom:1px solid #e5e7eb; text-transform:uppercase; letter-spacing:0.05em;">Prospects</div>`;
                    html += matchedProspects.map(p => `
                        <div class="search-result-item" onclick="app.selectReferrer(${p.id}, '${(p.full_name || '').replace(/'/g, "\\'")}', 'Prospect')"
                             style="cursor:pointer; padding:8px 12px; border-bottom:1px solid #f3f4f6; display:flex; flex-direction:column;">
                            <strong style="font-size:13px;">${p.full_name || ''}</strong>
                            <span style="font-size:11px; color:#6b7280;">${p.phone || p.ic_number || ''}</span>
                        </div>
                    `).join('');
                }

                if (matchedConsultants.length > 0) {
                    html += `<div style="padding:4px 10px; font-size:11px; font-weight:600; color:#6b7280; background:#f9fafb; border-bottom:1px solid #e5e7eb; text-transform:uppercase; letter-spacing:0.05em;">Consultants</div>`;
                    html += matchedConsultants.map(u => `
                        <div class="search-result-item" onclick="app.selectReferrer(${u.id}, '${(u.full_name || '').replace(/'/g, "\\'")}', 'Consultant')"
                             style="cursor:pointer; padding:8px 12px; border-bottom:1px solid #f3f4f6; display:flex; flex-direction:column;">
                            <strong style="font-size:13px;">${u.full_name || ''}</strong>
                            <span style="font-size:11px; color:#6b7280;">${u.agent_code || u.role || ''}</span>
                        </div>
                    `).join('');
                }

                if (!html) {
                    html = '<div style="padding:10px 12px; color:#6b7280; font-size:13px;">No results found</div>';
                }

                resultsDiv.innerHTML = html;
                resultsDiv.style.display = 'block';
            }
        } catch (error) {
            console.error('Error in searchReferrers:', error);
        }
    };

    const selectReferrer = (id, name, type) => {
        _state.sr = { id, name, type };
        const infoDiv = document.getElementById('cps-referrer-info');
        if (infoDiv) {
            infoDiv.innerHTML = `
                <div class="selected-entity-badge">
                    <span>${type}: <strong>${name}</strong></span>
                    <button class="btn btn-sm secondary" onclick="app.clearSelectedReferrer()">Clear</button>
                </div>
            `;
        }
        const results = document.getElementById('cps-referrer-results');
        if (results) results.style.display = 'none';
        const input = document.getElementById('cps-referrer');
        if (input) input.value = '';
    };

    const clearSelectedReferrer = () => {
        _state.sr = null;
        const infoDiv = document.getElementById('cps-referrer-info');
        if (infoDiv) infoDiv.innerHTML = '';
    };

    // ========== APPOINTMENT CONSULTANT ==========

    const searchConsultants = async () => {
        const term = document.getElementById('consultant-search-input')?.value.toLowerCase().trim();
        const resultsDiv = document.getElementById('consultant-search-results');
        if (!resultsDiv) return;
        if (!term || term.length < 1) { resultsDiv.style.display = 'none'; return; }

        const users = await AppDataStore.getAll('users');
        // Consultants = Level 1–9 (any level user)
        const consultants = users.filter(u => {
            const lvl = parseInt(u.role?.match(/Level\s+(\d+)/i)?.[1] || 0);
            return lvl >= 1 && lvl <= 9;
        });

        const matches = consultants
            .filter(u => u.full_name && u.full_name.toLowerCase().includes(term))
            .filter(u => !_state.scon.find(c => c.id === u.id))
            .slice(0, 10);

        resultsDiv.innerHTML = matches.length
            ? matches.map(u => `
                <div class="search-result-item" onclick="app.selectConsultant(${u.id}, '${(u.full_name||'').replace(/'/g,"\\'")}', '${u.role||''}')" style="cursor:pointer;padding:8px;border-bottom:1px solid #eee;">
                    <strong>${u.full_name}</strong> <span style="font-size:12px;color:#888;">${u.role || ''}</span>
                </div>`).join('')
            : '<div class="search-result-item" style="padding:8px;">No consultants found</div>';
        resultsDiv.style.display = 'block';
    };

    const selectConsultant = (id, name, role) => {
        if (_state.scon.find(c => c.id === id)) return;
        _state.scon.push({ id, name, role, status: 'pending' });
        const input = document.getElementById('consultant-search-input');
        if (input) input.value = '';
        const resultsDiv = document.getElementById('consultant-search-results');
        if (resultsDiv) resultsDiv.style.display = 'none';
        renderSelectedConsultants();
    };

    const removeConsultant = (id) => {
        _state.scon = _state.scon.filter(c => c.id !== id);
        renderSelectedConsultants();
    };

    const renderSelectedConsultants = () => {
        const list = document.getElementById('selected-consultants-list');
        if (!list) return;
        if (_state.scon.length === 0) { list.innerHTML = ''; return; }
        list.innerHTML = _state.scon.map(c => {
            const icon = c.status === 'accepted'
                ? '<i class="fas fa-check-circle" style="color:#16a34a;" title="Accepted"></i>'
                : c.status === 'rejected'
                    ? '<i class="fas fa-times-circle" style="color:#dc2626;" title="Rejected"></i>'
                    : '<i class="fas fa-clock" style="color:#f59e0b;" title="Pending"></i>';
            return `
                <div style="display:flex;align-items:center;justify-content:space-between;padding:6px 10px;background:#fff;border:1px solid var(--gray-200);border-radius:6px;margin-bottom:4px;">
                    <span style="font-size:13px;">${icon} <strong>${c.name}</strong> <span style="color:#888;font-size:11px;">${c.role||''}</span></span>
                    <button class="btn-icon text-danger" onclick="event.stopPropagation();app.removeConsultant(${c.id})" title="Remove"><i class="fas fa-times"></i></button>
                </div>`;
        }).join('');
    };

    // Called by consultant to accept/reject — from notification or activity detail
    const respondConsultantInvite = async (activityId, consultantId, response) => {
        const activity = await _lookupActivityRobust(activityId);
        if (!activity) return UI.toast.error('Activity not found');
        const consultants = (activity.consultants || []).map(c =>
            c.id === consultantId ? { ...c, status: response } : c
        );
        await AppDataStore.update('activities', activityId, { consultants });
        UI.toast.success(response === 'accepted' ? 'Appointment accepted!' : 'Appointment rejected.');
        UI.hideModal();
        await viewActivityDetails(activityId);
    };

    const searchProspectReferrers = async () => {
        try {
            const term = document.getElementById('prospect-referrer')?.value.toLowerCase();
            const resultsDiv = document.getElementById('prospect-referrer-results');
            if (!term || term.length < 1) { if (resultsDiv) resultsDiv.style.display = 'none'; return; }

            const allProspects = (await AppDataStore.getAll('prospects')).filter(p => !p.status || p.status === 'active');
            const allUsers = (await AppDataStore.getAll('users')).filter(u => parseInt(u.role?.match(/Level\s+(\d+)/i)?.[1] || 0) >= 3);

            const matchedProspects = allProspects.filter(p => p.full_name?.toLowerCase().includes(term) || p.nickname?.toLowerCase().includes(term)).slice(0, 5);
            const matchedConsultants = allUsers.filter(u => u.full_name?.toLowerCase().includes(term)).slice(0, 5);

            let html = '';
            if (matchedProspects.length) {
                html += `<div style="padding:4px 10px;font-size:11px;font-weight:600;color:#6b7280;background:#f9fafb;border-bottom:1px solid #e5e7eb;text-transform:uppercase;letter-spacing:0.05em;">Prospects</div>`;
                html += matchedProspects.map(p => `<div style="cursor:pointer;padding:8px 12px;border-bottom:1px solid #f3f4f6;" onmousedown="app.selectProspectReferrer(${p.id},'${(p.full_name||'').replace(/'/g,"\\'")}','Prospect')"><strong>${p.full_name}</strong><br><small style="color:#6b7280;">${p.phone||''}</small></div>`).join('');
            }
            if (matchedConsultants.length) {
                html += `<div style="padding:4px 10px;font-size:11px;font-weight:600;color:#6b7280;background:#f9fafb;border-bottom:1px solid #e5e7eb;text-transform:uppercase;letter-spacing:0.05em;">Consultants</div>`;
                html += matchedConsultants.map(u => `<div style="cursor:pointer;padding:8px 12px;border-bottom:1px solid #f3f4f6;" onmousedown="app.selectProspectReferrer(${u.id},'${(u.full_name||'').replace(/'/g,"\\'")}','Consultant')"><strong>${u.full_name}</strong><br><small style="color:#6b7280;">${u.agent_code||u.role||''}</small></div>`).join('');
            }
            if (!html) html = '<div style="padding:10px 12px;color:#6b7280;font-size:13px;">No results found</div>';

            if (resultsDiv) { resultsDiv.innerHTML = html; resultsDiv.style.display = 'block'; }
        } catch (e) { console.error('searchProspectReferrers:', e); }
    };

    const selectProspectReferrer = (id, name, type) => {
        _state.sprr = { id, name, type };
        const infoDiv = document.getElementById('prospect-referrer-info');
        // SECURITY: escape user-controlled name/type to prevent XSS (e.g. "<img loading="lazy" decoding="async" onerror=...>")
        if (infoDiv) infoDiv.innerHTML = `<div class="selected-entity-badge"><span>${escapeHtml(type)}: <strong>${escapeHtml(name)}</strong></span><button class="btn btn-sm secondary" onclick="app.clearProspectReferrer()">Clear</button></div>`;
        const results = document.getElementById('prospect-referrer-results');
        if (results) results.style.display = 'none';
        const input = document.getElementById('prospect-referrer');
        if (input) input.value = '';
    };

    const clearProspectReferrer = () => {
        _state.sprr = null;
        const infoDiv = document.getElementById('prospect-referrer-info');
        if (infoDiv) infoDiv.innerHTML = '';
    };

    const addProspectChildRow = (age = '', gender = '') => {
        const list = document.getElementById('prospect-children-list');
        if (!list) return;
        const row = document.createElement('div');
        row.className = 'prospect-child-row';
        row.style.cssText = 'display:flex;gap:8px;align-items:center;';
        row.innerHTML = `
            <input type="number" min="0" class="form-control prospect-child-age" placeholder="Age" style="max-width:90px;" value="${age}">
            <select class="form-control prospect-child-gender" style="max-width:130px;">
                <option value="">Gender</option>
                <option value="Male" ${gender === 'Male' ? 'selected' : ''}>Male</option>
                <option value="Female" ${gender === 'Female' ? 'selected' : ''}>Female</option>
                <option value="Other" ${gender === 'Other' ? 'selected' : ''}>Other</option>
            </select>
            <button type="button" class="btn-icon text-danger" onclick="this.closest('.prospect-child-row').remove()"><i class="fas fa-trash-alt"></i></button>
        `;
        list.appendChild(row);
    };

    const prefillProspectChildren = (kidsData) => {
        const list = document.getElementById('prospect-children-list');
        if (!list) return;
        list.innerHTML = '';
        let kids = [];
        try { kids = Array.isArray(kidsData) ? kidsData : (kidsData ? JSON.parse(kidsData) : []); } catch(e) { kids = []; }
        kids.forEach(k => addProspectChildRow(k.age || '', k.gender || ''));
    };

    const collectProspectChildren = () => {
        const rows = document.querySelectorAll('#prospect-children-list .prospect-child-row');
        const out = [];
        rows.forEach(r => {
            const age = r.querySelector('.prospect-child-age')?.value?.trim();
            const gender = r.querySelector('.prospect-child-gender')?.value || '';
            if (age || gender) out.push({ age: age ? parseInt(age, 10) : null, gender });
        });
        return out;
    };

    const searchEntities = async () => {
        const raw = document.getElementById('entity-search')?.value || '';
        const searchTerm = raw.toLowerCase().trim();
        const resultsDiv = document.getElementById('search-results');
        if (!searchTerm || searchTerm.length < 2) {
            if (resultsDiv) resultsDiv.style.display = 'none';
            return;
        }

        // Search prospects, customers, and agents
        const [visibleProspects, visibleCustomers, allUsers] = await Promise.all([
            getVisibleProspects(),
            getVisibleCustomers(),
            AppDataStore.getAll('users'),
        ]);

        const visibleAgents = allUsers.filter(u => isAgent(u));

        const all = [
            ...visibleProspects.map(p => ({ ...p, type: 'Prospect' })),
            ...visibleCustomers.map(c => ({ ...c, type: 'Customer' })),
            ...visibleAgents.map(a => ({ ...a, type: 'Agent' })),
        ];

        // Normalise phone digits for phone-number queries
        const termDigits = searchTerm.replace(/\D/g, '');

        const matches = all.filter(e => {
            const name  = (e.full_name  || '').toLowerCase();
            const nick  = (e.nickname   || '').toLowerCase();
            const email = (e.email      || '').toLowerCase();
            const phone = (e.phone      || '').replace(/\D/g, '');
            return name.includes(searchTerm)
                || nick.includes(searchTerm)
                || email.includes(searchTerm)
                || (termDigits.length >= 4 && phone.includes(termDigits));
        }).slice(0, 10);

        if (resultsDiv) {
            if (matches.length) {
                resultsDiv.innerHTML = matches.map(m => `
                    <div class="search-result-item" onclick="app.selectEntity(${m.id}, '${m.type}')">
                        <strong>${escapeHtml(m.full_name || '')}</strong>
                        <span style="color:#888;font-size:11px;margin-left:6px;">${m.type}${m.phone ? ' · ' + escapeHtml(m.phone) : ''}</span>
                    </div>
                `).join('');
            } else {
                resultsDiv.innerHTML = `
                    <div class="search-result-item" style="color:#888;cursor:default;">
                        No results found for "<strong>${escapeHtml(raw)}</strong>".<br>
                        <span style="font-size:11px;">Check spelling, or go to <em>Prospects</em> to add them first.</span>
                    </div>`;
            }
            resultsDiv.style.display = 'block';
        }
    };

    const selectEntity = async (id, type) => {
        _state.se = { id, type };
        const entity = type === 'Prospect'
            ? await AppDataStore.getById('prospects', id)
            : type === 'Customer'
            ? await AppDataStore.getById('customers', id)
            : await AppDataStore.getById('users', id);

        const infoDiv = document.getElementById('selected-entity-info');
        if (infoDiv) {
            infoDiv.innerHTML = `
                <div class="selected-entity-badge">
                    <span>${type}: <strong>${entity.full_name}</strong></span>
                    <button class="btn btn-sm secondary" onclick="app.clearSelectedEntity()">Clear</button>
                </div>
             `;
        }
        const sDir = document.getElementById('search-results');
        if (sDir) sDir.style.display = 'none';
        const sInput = document.getElementById('entity-search');
        if (sInput) sInput.value = '';
    };

    const clearSelectedEntity = () => {
        _state.se = null;
        const infoDiv = document.getElementById('selected-entity-info');
        if (infoDiv) infoDiv.innerHTML = '';
    };

    const searchAgents = async () => {
        const term = document.getElementById('co-agent-search-input')?.value.toLowerCase();
        const resultsDiv = document.getElementById('agent-search-results');
        if (!term || term.length < 1) { if (resultsDiv) resultsDiv.style.display = 'none'; return; }

        const consultants = (await AppDataStore.getAll('users')).filter(u => {
            const lvl = parseInt(u.role?.match(/Level\s+(\d+)/i)?.[1] || 0);
            return lvl >= 3 || isAgent(u) || u.role === 'team_leader' || u.role === 'consultant';
        });
        const matches = consultants.filter(u => u.full_name && u.full_name.toLowerCase().includes(term));

        if (resultsDiv) {
            resultsDiv.innerHTML = matches.map(m => `
                <div class="search-result-item" onclick="app.addCoAgent(${m.id}, '${m.full_name.replace(/'/g, "\\'")}')">
                    <strong>${m.full_name}</strong> <span style="color:#888; font-size:11px;">(${m.role || 'Consultant'})</span>
                </div>
            `).join('') || '<div class="search-result-item">No consultants found</div>';
            resultsDiv.style.display = 'block';
        }
    };

    const addCoAgent = (id, name) => {
        if (_state.sca.length >= 5) {
            UI.toast.warning('Max 5 co-agents allowed');
            return;
        }
        if (_state.sca.find(a => a.id === id)) return;

        // Newly-added co-agents start as "pending" so the invitee has to Accept/Reject.
        _state.sca.push({ id, name, co_role: 'Supporting', status: 'pending' });
        renderCoAgents();
        const aRes = document.getElementById('agent-search-results');
        if (aRes) aRes.style.display = 'none';
        const aInp = document.getElementById('co-agent-search-input');
        if (aInp) aInp.value = '';
    };

    const removeCoAgent = (id) => {
        _state.sca = _state.sca.filter(a => a.id !== id);
        renderCoAgents();
    };

    const updateCoAgentRole = (id, role) => {
        const agent = _state.sca.find(a => a.id === id);
        if (agent) agent.co_role = role;
    };

    const renderCoAgents = () => {
        const container = document.getElementById('selected-co-agents');
        if (container) {
            container.innerHTML = _state.sca.map(a => {
                // Missing status = legacy entry written before the accept/reject flow — treat as accepted.
                const status = a.status || 'accepted';
                const statusIcon = status === 'accepted'
                    ? '<i class="fas fa-check-circle" style="color:#16a34a;" title="Accepted"></i>'
                    : status === 'rejected'
                        ? '<i class="fas fa-times-circle" style="color:#dc2626;" title="Rejected"></i>'
                        : '<i class="fas fa-clock" style="color:#f59e0b;" title="Pending response"></i>';
                return `
                <div class="co-agent-tag" style="display:inline-flex; align-items:center; gap:8px; padding:6px 12px; margin-bottom:8px;">
                    <span>${statusIcon} ${a.name}</span>
                    <select class="form-control" style="width: auto; padding: 2px 6px; font-size: 11px; height: 24px;" onchange="app.updateCoAgentRole(${a.id}, this.value)">
                        <option value="Supporting" ${a.co_role === 'Supporting' ? 'selected' : ''}>Supporting</option>
                        <option value="Observer" ${a.co_role === 'Observer' ? 'selected' : ''}>Observer</option>
                        <option value="Trainer" ${a.co_role === 'Trainer' ? 'selected' : ''}>Trainer</option>
                    </select>
                    <span class="remove" onclick="app.removeCoAgent(${a.id})" style="cursor:pointer; font-weight:bold; margin-left:4px;">&times;</span>
                </div>
            `;
            }).join('');
        }
    };

    // Called by the invited co-agent to accept/reject an appointment they were assigned to.
    // Updates their entry in activity.co_agents, re-renders the affected views, and notifies
    // the lead agent so the assigner knows the status changed.
    const respondCoAgentInvite = async (activityId, response) => {
        if (!_state.cu || _state.cu.id == null) {
            UI.toast.error('You must be logged in to respond.');
            return;
        }
        if (response !== 'accepted' && response !== 'rejected') {
            UI.toast.error('Invalid response');
            return;
        }
        const activity = (await AppDataStore.getByIdFull('activities', activityId))
            || (await _lookupActivityRobust(activityId));
        if (!activity) { UI.toast.error('Activity not found'); return; }
        const coAgents = Array.isArray(activity.co_agents) ? activity.co_agents : [];
        const myEntry = coAgents.find(ca => String(ca.id) === String(_state.cu.id));
        if (!myEntry) { UI.toast.error('You are not a co-agent on this appointment'); return; }

        const updatedCoAgents = coAgents.map(ca =>
            String(ca.id) === String(_state.cu.id)
                ? { ...ca, status: response, responded_at: new Date().toISOString() }
                : ca
        );
        try {
            await AppDataStore.update('activities', activityId, { co_agents: updatedCoAgents });
        } catch (e) {
            UI.toast.error('Could not save response: ' + (e.message || 'Unknown error'));
            return;
        }

        UI.toast.success(response === 'accepted' ? 'Appointment accepted ✓' : 'Appointment rejected');
        // Notify the lead agent so they know the response came in (best-effort, non-blocking).
        _notifyCoAgentResponse({ ...activity, co_agents: updatedCoAgents }, myEntry, response).catch(() => {});

        // Refresh whichever views are currently visible.
        if (document.querySelector('.calendar-view-container')) {
            await (window.app.renderCalendar || (() => {}))();
            await (window.app.renderTodayActivities || (() => {}))();
        }
        // If the activity detail modal is open, re-open it to reflect the new status.
        if (document.querySelector('.modal-overlay.active')) {
            UI.hideModal();
            setTimeout(() => viewActivityDetails(activityId), 150);
        }
    };

    const saveActivity = async (stayOpen = false) => {
        // Re-entrancy guard: blocks double-clicks during the async save flow (file upload,
        // prospect creation, activity creation, referral creation, etc.) which previously
        // allowed 5+ duplicate prospects/activities when the user clicked Save while lagging.
        if (window._savingActivity) { return; }
        window._savingActivity = true;

        // Visually disable every Save button in open modals so the user sees the click landed.
        // Note: UI.js's capture-phase click listener already disables the clicked button and
        // swaps its innerHTML to '<spinner> <label>'. Our override just tightens the label to
        // "Saving…" to make progress clearer. We do NOT capture innerHTML to restore later —
        // the captured value would be the UI.js-altered spinner state, which would re-stick
        // onto the button after toast/hideModal's _endAllBtnLoads cleaned it up (the bug that
        // left Save Activity permanently spinning on iPhone after any validation error).
        const saveBtns = Array.from(document.querySelectorAll('.modal-overlay .modal-footer button.primary, .modal .modal-footer button.primary'));
        saveBtns.forEach(b => { b.disabled = true; b.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Saving…'; });

        const _releaseSaveGuard = () => {
            window._savingActivity = false;
            // Only re-enable; let UI.js's _endAllBtnLoads (fired by toast.error / toast.success
            // / hideModal / the 10s safety net) own innerHTML restoration. Restoring a captured
            // innerHTML here would overwrite the cleaned-up label and leave the button stuck.
            saveBtns.forEach(b => { try { if (b.isConnected) b.disabled = false; } catch (_) {} });
        };

        try {

        const type = document.getElementById('modal-activity-type')?.value;
        const date = document.getElementById('activity-date')?.value;
        const start = document.getElementById('start-time')?.value;
        const end = document.getElementById('end-time')?.value;

        if (!date || !start || !end) {
            UI.toast.error('Date and time are required.');
            return;
        }

        const venueVal = document.getElementById('activity-venue')?.value || '';
        const activity = {
            activity_type: type,
            activity_date: date,
            start_time: start,
            end_time: end,
            co_agents: _state.sca,
            consultants: _state.scon,
            lead_agent_id: _state.cu ? _state.cu.id : 5,
            venue: venueVal,
            // Mirror venue to location_address so it persists server-side (the `venue` column
            // may be missing from the Supabase schema and silently stripped on save). For
            // FSA/SITE the type-specific block below will override this with the site address.
            location_address: venueVal || null
        };

        // Venue compulsory for these types
        const venueRequiredTypes = ['CPS', 'FTF', 'EVENT', 'GR', 'XG'];
        if (venueRequiredTypes.includes(type) && !activity.venue) {
            UI.toast.error('Venue is required for ' + type + '. Please select a venue.');
            return;
        }

        if (type === 'CPS') {
            const name = document.getElementById('cps-name')?.value;
            const phone = document.getElementById('cps-phone')?.value;
            const relation = document.getElementById('cps-relationship')?.value;
            const referrerInputName = document.getElementById('cps-referrer')?.value.trim();

            // All CPS must have a referrer — business runs by recommendation only
            if (!_state.sr) {
                UI.toast.error('A referrer is required. All appointments must be by recommendation. Search and select the person who referred this prospect.');
                return;
            }

            if (!name || !phone) {
                UI.toast.error('Name and Phone are required for CPS.');
                return;
            }
            if (!relation) {
                UI.toast.error('Relation is required for CPS.');
                return;
            }

            // Duplicate checking: BLOCK on same name+phone or same name+IC
            {
                const allPeople = [...(await AppDataStore.getAll('prospects')), ...(await AppDataStore.getAll('customers'))];
                const normalize = str => str ? str.toLowerCase().replace(/\s+/g, '') : '';
                const normName = normalize(name);
                const ic = document.getElementById('cps-ic')?.value?.trim();

                const hardDuplicate = allPeople.find(p => {
                    const sameName = normalize(p.full_name) === normName;
                    if (!sameName) return false;
                    if (phone && p.phone && normalize(p.phone) === normalize(phone)) return true;
                    if (ic && p.ic_number && normalize(p.ic_number) === normalize(ic)) return true;
                    return false;
                });

                if (hardDuplicate) {
                    const agent = await AppDataStore.getById('users', hardDuplicate.responsible_agent_id || hardDuplicate.lead_agent_id) || { full_name: 'Unknown Agent' };
                    const matchField = (phone && hardDuplicate.phone && normalize(hardDuplicate.phone) === normalize(phone)) ? 'phone number' : 'IC number';
                    UI.toast.error(`Duplicate blocked: "${hardDuplicate.full_name}" already exists under ${agent.full_name} with the same name and ${matchField}.`);
                    return;
                }

                // Soft warning: same phone or same name (but not hard match)
                if (!window._cpsDuplicateConfirmed) {
                    const softDuplicate = allPeople.find(p => normalize(p.phone) === normalize(phone) || normalize(p.full_name) === normName);
                    if (softDuplicate) {
                        const agent = await AppDataStore.getById('users', softDuplicate.responsible_agent_id || softDuplicate.lead_agent_id) || { full_name: 'Unknown Agent' };
                        // Indexed lookups (idx_activities_prospect_date / _customer_date)
                        // instead of getAll('activities').filter — was scanning the full
                        // table on every soft-duplicate warning.
                        const [byProspect, byCustomer] = await Promise.all([
                            AppDataStore.getActivitiesForProspect(softDuplicate.id, { limit: 1 }).catch(() => []),
                            AppDataStore.getActivitiesForCustomer(softDuplicate.id, { limit: 1 }).catch(() => []),
                        ]);
                        const activities2 = [...byProspect, ...byCustomer];
                        activities2.sort((a, b) => new Date(b.activity_date) - new Date(a.activity_date));
                        const lastDate = activities2.length > 0 ? activities2[0].activity_date : 'N/A';
                        const msg = `This person may have visited before. The agent is ${agent.full_name}, last meet up on ${lastDate}. Are you sure this is not the same prospect? Check with your leader.`;
                        UI.showModal('Potential Duplicate Found', `<p>${msg}</p>`, [
                            { label: 'Cancel', type: 'secondary', action: 'UI.hideModal()' },
                            { label: 'Continue Anyway', type: 'primary', action: `window._cpsDuplicateConfirmed = true; (async () => { await app.saveActivity(${stayOpen}); })()` }
                        ]);
                        return;
                    }
                }
            }
            window._cpsDuplicateConfirmed = false; // reset flag

            // All Basic Info fields pulled via the shared collector — keeps
            // CPS + Prospect forms in lockstep. Activity-specific metadata
            // (responsible_agent_id, referred_by_*, score) is merged after.
            const basic = collectBasicInfoData('cps');
            const prospectData = {
                ...basic,
                score: SCORING_RULES.CREATE_PROSPECT,
                responsible_agent_id: _state.cu?.id || null,
                referred_by_id: _state.sr?.id || null,
                referred_by_type: _state.sr?.type || null,
                referred_by: _state.sr?.name || document.getElementById('cps-referrer')?.value || '',
            };

            let prospect;
            try {
                prospect = await AppDataStore.create('prospects', prospectData);
            } catch (err) {
                UI.toast.error('Failed to create prospect: ' + (err.message || 'Unknown error'));
                return;
            }
            activity.prospect_id = prospect.id;
            activity.activity_title = `CPS With ${name}`;

            // Silent upload of CPS form photo (if scanned during this session).
            // Fire-and-forget — does not block the rest of the save flow.
            if (_state.cppf.cps) {
                const _pendingScanFile = _state.cppf.cps;
                delete _state.cppf.cps;
                _uploadCpsFormFile(_pendingScanFile, prospect.id).catch(() => {});
            }

            // Auto-create referral record from CPS activity
            const _refType = (_state.sr.type || '').toLowerCase() === 'consultant' ? 'user' : 'prospect';
            try {
                await AppDataStore.create('referrals', {
                    id: Date.now(),
                    referrer_id: _state.sr.id,
                    referrer_type: _refType,
                    referred_prospect_id: prospect.id,
                    referral_source: 'CPS',
                    memo: '',
                    is_converted: false,
                    status: 'Pending',
                    created_at: new Date().toISOString()
                });
            } catch(e) { console.warn('Auto-referral creation failed:', e); }

            const inviteMethod = document.getElementById('cps-invitation-method')?.value;
            activity.cps_invitation_method = inviteMethod === 'Other' ? document.getElementById('cps-invitation-other')?.value : inviteMethod;
            activity.cps_invitation_details = document.getElementById('cps-invitation-details')?.value || '';
            activity.summary = document.getElementById('cps-summary')?.value?.trim() || '';
        } else if (type === 'FSA' || type === 'SITE') {
            const address = document.getElementById('location-address')?.value;
            if (!address) {
                UI.toast.error('Address is required for site visits.');
                return;
            }
            activity.location_address = address;
            activity.activity_title = type === 'FSA' ? 'Feng Shui Analysis' : 'Site Visit';
            if (_state.se) {
                if (_state.se.type === 'Prospect') activity.prospect_id = _state.se.id;
                else activity.customer_id = _state.se.id;
            }
        } else if (type === 'EVENT' || type === 'AGENT_MEETING' || type === 'AGENT_TRAINING') {
            const visibility = document.querySelector('input[name="event-visibility"]:checked')?.value || 'closed';
            const eventId = document.getElementById('existing-event')?.value;
            if (!eventId) {
                UI.toast.error('Please select an event. Use "Create New" to add one first.');
                return;
            }
            const ev = await AppDataStore.getById('events', eventId);
            activity.activity_title = ev ? (ev.event_title || ev.title) : 'Event';
            activity.event_id = parseInt(eventId);
            activity.visibility = visibility;

            // 📢 Noticeboard publish toggle (EVENT type only). Syncs the
            // selected/created event's publish flag and (optional) poster URL
            // so the noticeboard tab picks it up immediately. Existing poster
            // is preserved if the user leaves the URL field empty.
            if (type === 'EVENT' && ev) {
                const publishCb = document.getElementById('activity-publish-noticeboard');
                if (publishCb) {
                    const wantsPublished = publishCb.checked === true;
                    const newPoster = document.getElementById('activity-poster-url')?.value?.trim() || null;
                    const patch = { published_to_noticeboard: wantsPublished };
                    if (newPoster) patch.poster_url = newPoster;
                    // Only write if something actually changed (avoids extra
                    // Supabase calls when the user just selected an event
                    // without flipping the toggle).
                    const changed = ev.published_to_noticeboard !== wantsPublished
                                 || (newPoster && newPoster !== ev.poster_url);
                    if (changed) {
                        try {
                            await AppDataStore.update('events', parseInt(eventId), patch);
                            if (wantsPublished) UI.toast.success('Event published to Noticeboard 📢');
                        } catch (err) {
                            console.warn('[noticeboard] event publish update failed:', err);
                            UI.toast.error('Activity saved, but noticeboard publish failed: ' + (err.message || 'unknown'));
                        }
                    }
                }
            }

            // Link to selected entity if present
            if (_state.se) {
                if (_state.se.type === 'Prospect') activity.prospect_id = _state.se.id;
                else activity.customer_id = _state.se.id;
            }

            // Attendees saved after activity is created (below) so activity_id is available
        } else {
            const entityRequired = !['PERSONAL', 'OTHERS'].includes(type);
            if (entityRequired && !_state.se) {
                UI.toast.error('Please select a prospect or customer.');
                return;
            }
            activity.activity_title = document.getElementById('meeting-title')?.value
                || (type === 'PERSONAL' ? 'Personal' : type === 'OTHERS' ? 'Others' : 'Meeting');
            if (_state.se) {
                if (_state.se.type === 'Prospect') activity.prospect_id = _state.se.id;
                else activity.customer_id = _state.se.id;
            }
        }

        if (document.getElementById('is-closing')?.checked) {
            activity.is_closing = true;
            activity.solution_sold = document.getElementById('solution-sold')?.value;
            activity.amount_closed = document.getElementById('amount-closed')?.value;
            activity.payment_method = document.getElementById('payment-method')?.value;
            activity.invoice_number = document.getElementById('invoice-number')?.value;
            activity.collection_date = document.getElementById('collection-date')?.value;
            const imgInput = document.getElementById('redemption-image');
            if (imgInput && imgInput.files.length > 0) activity.redemption_image_name = imgInput.files[0].name;

            if (activity.payment_method === 'POP') {
                const amount = document.getElementById('pop-monthly-amount')?.value;
                const tenure = document.getElementById('pop-tenure')?.value;
                const downPayment = document.getElementById('pop-down-payment')?.value;
                if (amount) activity.pop_monthly_amount = amount;
                if (tenure) activity.pop_tenure = tenure;
                if (downPayment) activity.pop_down_payment = downPayment;
            }
        }

        if (document.getElementById('unable-to-serve')?.checked) {
            activity.unable_to_serve = true;
            activity.unable_reason = document.getElementById('unable-reason')?.value;
        }

        if (document.getElementById('continue-follow-up')?.checked) {
            activity.continue_follow_up = true;
        }

        activity.summary = document.getElementById('note-key-points')?.value || '';
        activity.note_key_points = document.getElementById('note-key-points')?.value || '';
        activity.note_outcome = document.getElementById('note-outcome')?.value || '';
        activity.note_next_steps = document.getElementById('note-next-steps')?.value || '';
        activity.note_needs = document.getElementById('note-needs')?.value || '';
        activity.note_pain_points = document.getElementById('note-pain-points')?.value || '';
        activity.remarks = document.getElementById('activity-remarks')?.value || '';

        // CPS attachment upload — store the file in Supabase storage so it's viewable everywhere.
        // We stash it here and upload AFTER the activity row exists so the path can reference the activity id.
        // The file comes from the "📷 Take Photo" widget at the top of the basic-info block
        // (the dedicated <input type="file" id="cps-attachment"> was removed as part of the
        // photo unification — one scan, both OCR and storage).
        let _pendingCpsFile = null;
        if (type === 'CPS') {
            // Prefer the scanned file stashed by handleCpsScanFile (covers Take Photo flow)
            if (_state.cppf?.cps) {
                _pendingCpsFile = _state.cppf.cps;
                if (_pendingCpsFile.size > 5 * 1024 * 1024) {
                    UI.toast.error('File size exceeds 5MB limit');
                    return;
                }
            }
        }

        // === Optimistic UI: mobile calendar only ===
        // If the user is on the mobile calendar, drop the activity into the
        // local cache + grid BEFORE we hit the network. This way the row is
        // visible in the same tick the user tapped Save, instead of waiting
        // for the round-trip. On success we swap the tmp id for the real
        // one; on failure we mark the row pending and queue it for retry so
        // the user doesn't lose their work.
        const _mcalActiveForSave = !!document.querySelector('.mcal-active');
        const _mcalTmpId = (_mcalActiveForSave && activity.activity_date)
            ? ('tmp-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8))
            : null;
        if (_mcalTmpId) {
            _mcalOptimisticInsert({
                ...activity,
                id: _mcalTmpId,
                _pending: true,
                created_at: new Date().toISOString(),
            });
        }

        let savedActivity;
        try {
            savedActivity = await AppDataStore.create('activities', activity);
        } catch (err) {
            if (_mcalTmpId) {
                // Keep the optimistic row in the grid so the user doesn't lose
                // sight of their save; flag it pending and queue for retry.
                _mcalOptimisticMarkFailed(_mcalTmpId);
                _mcalEnqueueRetry(_mcalTmpId, 'activities', activity);
                UI.toast.error("Couldn't sync — saved locally, will retry automatically");
            } else {
                UI.toast.error('Failed to save activity: ' + (err.message || 'Unknown error'));
            }
            return;
        }

        // Swap the tmp id for the real one returned by Supabase so any
        // future edits target the actual row.
        if (_mcalTmpId && savedActivity?.id) {
            _mcalOptimisticSwap(_mcalTmpId, savedActivity);
        }

        // Sync unable_to_serve to prospect row when set via the activity form
        if (activity.unable_to_serve && activity.prospect_id) {
            AppDataStore.update('prospects', activity.prospect_id, {
                unable_to_serve: true,
                unable_reason: activity.unable_reason || '',
                updated_at: new Date().toISOString()
            }).catch(() => {});
            // Score penalty for marking unable to serve / not interested
            addScoreToProspect(activity.prospect_id, SCORING_RULES.MARK_NOT_INTERESTED, 'Marked unable to serve / not interested').catch(() => {});
        }

        // Upload CPS attachment to Supabase storage and save URL into activities.photo_urls.
        // Kept non-blocking for the rest of the save flow — errors show a toast but don't fail the activity.
        if (_pendingCpsFile && savedActivity?.id) {
            try {
                const sb = window.supabase || window.supabaseClient;
                if (sb && sb.storage) {
                    const safeName = _pendingCpsFile.name.replace(/[^a-zA-Z0-9._-]/g, '_');
                    const path = `activity_photos/${savedActivity.id}_${Date.now()}_${safeName}`;
                    const { error: upErr } = await sb.storage.from('attachments').upload(path, _pendingCpsFile, { upsert: false, contentType: _pendingCpsFile.type });
                    if (upErr) throw upErr;
                    const { data: urlData } = sb.storage.from('attachments').getPublicUrl(path);
                    if (urlData?.publicUrl) {
                        const existing = Array.isArray(savedActivity.photo_urls) ? savedActivity.photo_urls : [];
                        await AppDataStore.update('activities', savedActivity.id, { photo_urls: [...existing, urlData.publicUrl] });
                        savedActivity.photo_urls = [...existing, urlData.publicUrl];
                    }
                } else {
                    UI.toast.error('CPS attachment not uploaded — Supabase not connected');
                }
            } catch (err) {
                console.error('CPS attachment upload failed:', err);
                UI.toast.error('CPS attachment upload failed: ' + (err.message || 'Unknown error'));
            }
            // Clear the stash so the next save doesn't reuse this file
            delete _state.cppf.cps;
        }

        // Save event attendees now that we have the activity ID — stored per-activity so
        // different dates of the same event don't share attendees
        if ((type === 'EVENT' || type === 'AGENT_MEETING' || type === 'AGENT_TRAINING') && _state.sat.length > 0) {
            for (const att of _state.sat) {
                await AppDataStore.create('event_attendees', {
                    event_id: activity.event_id,
                    activity_id: savedActivity.id,
                    entity_id: att.id,
                    entity_name: att.name || att.full_name || '',
                    attendee_id: att.id,
                    attendee_type: att.type,
                    attendance_status: att.status,
                    added_by_agent_id: _state.cu?.id || null,
                    added_by_name: _state.cu?.full_name || ''
                });
            }
        }

        if (document.getElementById('is-closing')?.checked) {
            const salesIdea = document.getElementById('case-sales-idea')?.value;
            const planDetails = document.getElementById('case-plan-details')?.value;
            const successStory = document.getElementById('case-success-story')?.value;

            if (salesIdea || planDetails || successStory) {
                try {
                    await AppDataStore.create('case_studies', {
                        title: `Case Study: ${activity.activity_title}`,
                        prospect_id: activity.prospect_id || null,
                        customer_id: activity.customer_id || null,
                        activity_id: savedActivity.id,
                        sales_idea: salesIdea,
                        plan_details: planDetails,
                        success_story: successStory,
                        product: activity.solution_sold,
                        amount: activity.amount_closed,
                        closing_date: activity.activity_date,
                        created_by: _state.cu?.id || null,
                        is_public: false
                    });
                } catch (err) {
                    console.warn('Case study save failed:', err.message);
                }
            }
        }

        // Auto-create CPS Invitation Case in Success Case Library
        if (type === 'CPS') {
            try {
                await AppDataStore.create('case_studies', {
                    title: `CPS: ${activity.activity_title}`,
                    prospect_id: activity.prospect_id || null,
                    customer_id: null,
                    activity_id: savedActivity.id,
                    case_type: 'cps',
                    cps_invitation_method: activity.cps_invitation_method || '',
                    cps_invitation_details: activity.cps_invitation_details || '',
                    closing_date: activity.activity_date,
                    created_by: _state.cu?.id || null,
                    is_public: !!(activity.cps_invitation_details && activity.cps_invitation_details.trim())
                });
            } catch (err) {
                console.warn('CPS case study auto-create failed:', err.message);
            }
        }

        UI.toast.success('Activity saved!');

        // === If this save was approving a CPS intake request, mark it approved ===
        let _cpsIntakeWaCallback = null;
        if (_state.pii) {
            const intakeRow = _state.pir;
            try {
                await AppDataStore.update('cps_intake_requests', _state.pii, {
                    status: 'approved',
                    approved_at: new Date().toISOString(),
                    approved_activity_id: savedActivity?.id || null
                });
            } catch (e) { console.warn('CPS intake approval mark failed:', e); }
            _state.pii  = null;
            _state.pir = null;

            // Build WhatsApp modal — will be shown AFTER activity modal closes
            if (intakeRow?.prospect_phone) {
                let phone = intakeRow.prospect_phone.replace(/\D/g, '');
                if (phone.startsWith('0')) phone = '60' + phone.slice(1);
                else if (!phone.startsWith('60') && phone.length <= 10) phone = '60' + phone;
                const name    = intakeRow.prospect_name  || 'Pelanggan';
                const date    = intakeRow.activity_date  || '';
                const start   = (intakeRow.start_time    || '').slice(0, 5);
                const end     = (intakeRow.end_time      || '').slice(0, 5);
                const venue   = intakeRow.venue_name     || '';
                const address = intakeRow.venue_address  || '';
                const waze    = intakeRow.waze_link      || '';

                const mbbHqNote = (venue || '').toLowerCase().includes('mbb hq') ? [
                    ``,
                    `___________________________________________`,
                    `给予第一次来DC-KL总部的朋友`,
                    `欢迎您`,
                    ``,
                    `1. 驾车的朋友，可以Park 在B1-basement parking。`,
                    `2. 搭monorail 的朋友，请下Bukit Nanas station。走向Menara Bangkok Bank 方向`,
                    `3. 到了时，请打电话给我。因为需要亲自来接您才可以上楼。`,
                    `4. 在等待的时候，请到保安柜台登记。 告知是去 21 楼 DC，需用到IC`,
                ] : [];

                const msg = [
                    `\u2705 Your appointment has been CONFIRMED! / 您的预约已确认！`,
                    ``,
                    `\u{1F464} ${name}`,
                    `\u{1F4C5} Date / 日期: ${date}`,
                    `\u23F0 Time / 时间: ${start}–${end}`,
                    venue   ? `\u{1F4CD} Venue / 地点: ${venue}` : '',
                    address ? `\u{1F3E0} Address / 地址: ${address}` : '',
                    waze    ? `\u{1F5FA}\uFE0F Waze: ${waze}` : '',
                    ``,
                    `Please ensure you arrive on time. Dress code: formal/smart casual.`,
                    `请准时出席。着装要求：正式/整洁休闲。`,
                    ...mbbHqNote,
                ].filter(l => l !== undefined && !(l === '' && false)).join('\n').replace(/\n{3,}/g, '\n\n').trim();

                const waUrl = `https://wa.me/${phone}?text=${encodeURIComponent(msg)}`;

                _cpsIntakeWaCallback = () => {
                    UI.showModal(
                        '✅ Appointment Confirmed',
                        `<div style="text-align:center; padding:8px 0;">
                            <p style="margin-bottom:12px; font-size:14px; color:#374151;">
                                Notify <strong>${name}</strong> (${intakeRow.prospect_phone}) via WhatsApp?
                            </p>
                            <pre style="background:#f3f4f6; border-radius:8px; padding:12px; font-size:12px; text-align:left; white-space:pre-wrap; max-height:220px; overflow-y:auto;">${msg}</pre>
                        </div>`,
                        [
                            { label: '📲 Send WhatsApp', type: 'primary',   action: `window.open('${waUrl}', '_blank'); UI.hideModal();` },
                            { label: 'Skip',              type: 'secondary', action: 'UI.hideModal();' }
                        ]
                    );
                };
            }
        }

        // === Auto Scoring: Award points based on activity type ===
        try {
            await applyActivityScoring(activity);
        } catch (e) { console.warn('Activity scoring failed:', e); }

        // === Auto Protection Extension: Extend deadline based on activity type ===
        if (activity.prospect_id) {
            try {
                const extType = activity.is_closing ? 'transaction' : getExtensionType(activity.activity_type);
                await autoExtendProtection(activity.prospect_id, extType);
            } catch (e) { console.warn('Protection auto-extend failed:', e); }
        }

        // === Workflow Engine: Trigger activity_completed workflows ===
        try {
            const entityName = _state.se?.name || activity.activity_title || '';
            await executeWorkflows('activity_completed', { name: entityName, activityType: activity.activity_type });
        } catch (e) { console.warn('Workflow trigger failed:', e); }

        // === Auto Milestone: Mark milestone based on activity type / title ===
        try {
            if (_state.cu) {
                const aType = activity.activity_type || '';
                const aTitle = (activity.activity_title || '').toLowerCase();
                const milestoneMap = [
                    { key: 'CPS',           test: () => aType === 'CPS' },
                    { key: '9 Stars',       test: () => aTitle.includes('9 star') || aTitle.includes('nine star') },
                    { key: 'DIY',           test: () => aTitle.includes('diy') },
                    { key: '福气课',         test: () => aTitle.includes('福气') || aTitle.includes('fudi') || aTitle.includes('fu qi') },
                    { key: '九运课',         test: () => aTitle.includes('九运') || aTitle.includes('jiuyun') || aTitle.includes('jiu yun') },
                    { key: 'Museum',        test: () => aTitle.includes('museum') },
                    { key: 'HuiJi',         test: () => aTitle.includes('huiji') || aTitle.includes('hui ji') },
                    { key: 'Advance Class', test: () => aTitle.includes('advance') },
                    { key: 'Sharing',       test: () => aTitle.includes('sharing') || aType === 'Sharing' }
                ];
                for (const m of milestoneMap) {
                    if (m.test()) await markMilestoneCompleted(_state.cu.id, m.key);
                }
            }
        } catch (e) { console.warn('Milestone auto-mark failed:', e); }

        // === Push notification: alert lead agent, co-agents, and management ===
        _notifyActivityCreated(savedActivity).catch(() => {});

        // === Follow-Up Automation: trigger CPS-based follow-ups (data-driven, non-blocking) ===
        if (activity.activity_type === 'CPS' && activity.prospect_id) {
            dispatchAfterCpsTriggers(activity.prospect_id).catch(e => console.warn('CPS follow-up triggers failed:', e));
        }

        // === Follow-Up Automation: scan for invite candidates when a new calendar event is scheduled ===
        if (activity.activity_type === 'EVENT' && activity.event_id && savedActivity?.id) {
            dispatchOnNewCalendarEvent({ ...activity, id: savedActivity.id })
                .catch(e => console.warn('Calendar event invite dispatch failed:', e));
        }

        // === Auto-mark proposed solution as Purchased when closing activity has solution_sold ===
        if (activity.is_closing && activity.solution_sold) {
            const soldLower = (activity.solution_sold || '').toLowerCase();
            const entityId = activity.prospect_id || activity.customer_id;
            if (entityId) {
                AppDataStore.getAll('proposed_solutions').then(sols => {
                    const matches = (sols || []).filter(s => {
                        const samePerson = String(s.prospect_id) === String(activity.prospect_id) ||
                                           String(s.customer_id) === String(activity.customer_id);
                        return samePerson && s.status !== 'Purchased' &&
                               (s.solution || '').toLowerCase().includes(soldLower.slice(0, 8));
                    });
                    for (const s of matches) {
                        AppDataStore.update('proposed_solutions', s.id, {
                            status: 'Purchased',
                            next_follow_up_date: null,
                            updated_at: new Date().toISOString()
                        }).catch(() => {});
                    }
                }).catch(() => {});
            }
        }

        await (window.app.renderCalendar || (() => {}))();
        await renderFollowUpReminders();
        await (window.app.renderTodayActivities || (() => {}))();

        // === Auto-refresh open activity tabs so changes reflect immediately ===
        try {
            const pid = activity.prospect_id;
            const cid = activity.customer_id;
            if (pid) {
                const bodyEl = document.getElementById(`acc-body-activity-${pid}`);
                if (bodyEl && bodyEl.style.display !== 'none') {
                    await switchProspectTab('activity', pid, null, bodyEl);
                }
            }
            if (cid) {
                const bodyEl = document.getElementById(`cust-acc-body-activity-${cid}`);
                if (bodyEl && bodyEl.style.display !== 'none') {
                    const cust = await AppDataStore.getById('customers', cid);
                    if (cust) await renderCustomerActivityTab(cust, bodyEl.id);
                }
            }
        } catch (e) { console.warn('Activity tab auto-refresh failed:', e); }

        // Mobile calendar: ensure the saved activity is visible before the modal
        // closes. The fire-and-forget render from _mcalOptimisticInsert may not
        // have finished by now, so we do one final await here so the user never
        // sees the calendar in an un-updated state when the modal dismisses.
        if (_mcalActiveForSave) {
            const _mcVp = document.getElementById('content-viewport');
            if (_mcVp && _mcVp.classList.contains('mcal-active'))
                await (window.app.showMobileCalendarView || (() => {}))(_mcVp).catch(() => {});
        }

        if (!stayOpen) {
            UI.hideModal();
            if (_cpsIntakeWaCallback) setTimeout(_cpsIntakeWaCallback, 300);
        } else {
            // Reset co-agents and consultants when staying open for another add
            _state.sca = [];
            _state.scon = [];
            await openActivityModal(date);
        }
        } finally {
            _releaseSaveGuard();
        }
    };

    const saveAndAddAnother = async () => await saveActivity(true);

    // ========== PUSH NOTIFICATIONS: notify subscribed users when an activity is created ==========
    // Fire-and-forget: never blocks the save flow, never throws.
    // Targets = lead_agent + co_agents + admins/team leads, minus the creator themselves.
    const _notifyActivityCreated = async (savedActivity) => {
        try {
            if (!savedActivity || !window.PushNotif) return;
            const targets = new Set();
            if (savedActivity.lead_agent_id != null) targets.add(String(savedActivity.lead_agent_id));
            if (Array.isArray(savedActivity.co_agents)) {
                // co_agents is an array of {id, name, co_role, status} objects — not raw IDs.
                // The previous version iterated each object as if it were an ID and pushed
                // "[object Object]" into the targets set, so co-agents never got notified.
                savedActivity.co_agents.forEach(ca => {
                    if (ca && ca.id != null) targets.add(String(ca.id));
                });
            }
            // Include admins / team leads so management sees new activity across the org.
            try {
                const allUsers = await AppDataStore.getAll('users');
                (allUsers || []).forEach(u => {
                    const role = (u.role || '').toString().toLowerCase();
                    const lvlMatch = role.match(/level\s*(\d+)/);
                    const lvl = lvlMatch ? parseInt(lvlMatch[1]) : 99;
                    const isLead =
                        lvl <= 4 ||
                        role === 'team_leader' ||
                        role === 'admin' ||
                        role === 'super_admin' ||
                        role === 'marketing_manager' ||
                        role === 'manager';
                    if (isLead && u.id != null) targets.add(String(u.id));
                });
            } catch (e) { /* admin broadcast is best-effort */ }

            // Don't self-notify the creator — they just did it.
            if (_state.cu && _state.cu.id != null) targets.delete(String(_state.cu.id));
            if (targets.size === 0) return;

            const whoLabel = _state.cu
                ? (_state.cu.full_name || _state.cu.name || _state.cu.email || 'Someone')
                : 'Someone';
            const typeLabel = savedActivity.activity_type || savedActivity.type || 'Activity';
            const titleLabel = savedActivity.activity_title || savedActivity.title || savedActivity.subject || '';
            const dateLabel = savedActivity.activity_date || savedActivity.date || '';

            await window.PushNotif.sendActivityPush(
                savedActivity,
                Array.from(targets),
                {
                    title: `New ${typeLabel} scheduled`,
                    body: `${whoLabel}: ${titleLabel}${dateLabel ? ` (${dateLabel})` : ''}`,
                    url: `./index.html#calendar`,
                }
            );
        } catch (e) {
            // Never let notification errors affect the activity save flow.
            console.warn('[PushNotif] notifyActivityCreated failed:', e);
        }
    };

    // Notify only specific co-agents (delta case: someone was added to an existing activity).
    // Uses the same Edge Function as _notifyActivityCreated so all push infra is shared.
    const _notifyCoAgentAdded = async (savedActivity, newCoAgentIds) => {
        try {
            if (!savedActivity || !window.PushNotif) return;
            if (!Array.isArray(newCoAgentIds) || newCoAgentIds.length === 0) return;
            const targets = newCoAgentIds
                .filter(id => id != null)
                .map(String)
                .filter(id => !_state.cu || String(_state.cu.id) !== id);
            if (targets.length === 0) return;

            const whoLabel = _state.cu
                ? (_state.cu.full_name || _state.cu.name || _state.cu.email || 'Someone')
                : 'Someone';
            const typeLabel = savedActivity.activity_type || 'Activity';
            const dateLabel = savedActivity.activity_date || '';
            const timeLabel = savedActivity.start_time || '';

            await window.PushNotif.sendActivityPush(
                savedActivity,
                targets,
                {
                    title: `You've been invited to a ${typeLabel}`,
                    body: `${whoLabel} added you as co-agent${dateLabel ? ` on ${dateLabel}${timeLabel ? ` at ${timeLabel}` : ''}` : ''}. Tap to accept or reject.`,
                    url: `./index.html#calendar`,
                }
            );
        } catch (e) {
            console.warn('[PushNotif] notifyCoAgentAdded failed:', e);
        }
    };

    // Notify the lead agent when a co-agent accepts or rejects their invitation.
    const _notifyCoAgentResponse = async (savedActivity, coAgent, response) => {
        try {
            if (!savedActivity || !window.PushNotif || !coAgent) return;
            const leadId = savedActivity.lead_agent_id;
            if (leadId == null) return;
            // Don't self-notify — e.g. lead agent responding to an invite on their own activity.
            if (_state.cu && String(_state.cu.id) === String(leadId)) return;

            const typeLabel = savedActivity.activity_type || 'Activity';
            const dateLabel = savedActivity.activity_date || '';
            const timeLabel = savedActivity.start_time || '';
            const verb = response === 'accepted' ? 'accepted' : 'rejected';

            await window.PushNotif.sendActivityPush(
                savedActivity,
                [String(leadId)],
                {
                    title: `Co-agent ${verb} your ${typeLabel}`,
                    body: `${coAgent.name || 'Co-agent'} ${verb} the invitation${dateLabel ? ` on ${dateLabel}${timeLabel ? ` at ${timeLabel}` : ''}` : ''}.`,
                    url: `./index.html#calendar`,
                }
            );
        } catch (e) {
            console.warn('[PushNotif] notifyCoAgentResponse failed:', e);
        }
    };

    // ========== AUTO-SUBSCRIBE PUSH for PWA / homescreen users ==========
    const _autoSubscribePush = () => {
        try {
            if (!window.PushNotif || !window.PushNotif.isPushSupported()) return;
            // Only auto-prompt for installed PWA (homescreen) — not regular browser tabs
            const isStandalone = window.matchMedia('(display-mode: standalone)').matches
                || window.navigator.standalone === true;
            if (!isStandalone) return;
            // Delay so login UI settles first, then verify + subscribe if needed
            setTimeout(async () => {
                try {
                    // Even if push_enabled=1, verify the browser subscription still exists.
                    // The Edge Function prunes expired endpoints from the DB, but the
                    // localStorage flag stays set — causing silent notification failures.
                    if (localStorage.getItem('push_enabled') === '1') {
                        const reg = window._swRegistration || (await navigator.serviceWorker.ready);
                        const existingSub = reg && (await reg.pushManager.getSubscription());
                        if (existingSub) return; // still active, nothing to do
                        // Subscription was lost — clear flag and re-subscribe below
                        localStorage.removeItem('push_enabled');
                        console.log('[Push] stale push_enabled flag cleared — re-subscribing');
                    }
                    await window.PushNotif.subscribe();
                } catch (e) { console.warn('[Push] auto-subscribe skipped:', e.message || e); }
            }, 2000);
        } catch (_) {}
    };

    // ========== PUSH NOTIFICATION: notify when a 福运相随 highlight is created/updated ==========
    const _notifyHighlightSaved = async (highlight, isNew) => {
        try {
            if (!highlight || !window.PushNotif) return;
            const targets = new Set();
            // Notify all active users
            try {
                const allUsers = await AppDataStore.getAll('users');
                (allUsers || []).forEach(u => {
                    if (u.id != null && u.status !== 'inactive') targets.add(String(u.id));
                });
            } catch (_) {}
            // Don't self-notify the author
            if (_state.cu && _state.cu.id != null) targets.delete(String(_state.cu.id));
            if (targets.size === 0) return;

            const typeMap = { highlight: '📰 Highlight', success_story: '🌟 Success Story', recommendation_tip: '💡 Tip' };
            const typeLabel = typeMap[highlight.type] || 'Highlight';

            await window.PushNotif.sendActivityPush(
                highlight,
                Array.from(targets),
                {
                    title: isNew ? `福运相随: New ${typeLabel}` : `福运相随: ${typeLabel} Updated`,
                    body: highlight.title || '',
                    url: './index.html#fude',
                }
            );
        } catch (e) {
            console.warn('[PushNotif] notifyHighlightSaved failed:', e);
        }
    };

    // ========== PAST RECORD ENTRY (for old customers with historical meet ups) ==========
    const openPastRecordModal = async (prospectId) => {
        const prospect = await AppDataStore.getById('prospects', prospectId);
        if (!prospect) {
            UI.toast.error('Prospect not found.');
            return;
        }

        const today = new Date().toISOString().split('T')[0];
        const modalContent = `
            <div class="activity-modal-form">
                <p style="background:#fff8e1;border:1px solid #ffe082;color:#7a5c00;padding:10px 12px;border-radius:6px;font-size:13px;margin-bottom:14px;">
                    <i class="fas fa-history"></i> Log a historical meet up for <strong>${prospect.full_name}</strong>. This entry will <strong>not</strong> award scoring points or extend protection — it is only for record keeping.
                </p>
                <div class="form-row">
                    <div class="form-group half">
                        <label>Date <span class="required">*</span></label>
                        <input type="date" id="past-record-date" class="form-control" max="${today}">
                    </div>
                    <div class="form-group half">
                        <label>Activity Type <span class="required">*</span></label>
                        <select id="past-record-type" class="form-control">
                            <option value="CPS">CPS - Consultation/Planning Session</option>
                            <option value="FTF">FTF - Face to Face Meeting</option>
                            <option value="FSA">FSA - Feng Shui Analysis</option>
                            <option value="GR">GR - Golden Road</option>
                            <option value="XG">XG - Xin Gua</option>
                            <option value="SITE">Site Visit</option>
                            <option value="CALL">Call</option>
                            <option value="EMAIL">Email</option>
                            <option value="WHATSAPP">WhatsApp</option>
                        </select>
                    </div>
                </div>
                <div class="form-group">
                    <label>Title</label>
                    <input type="text" id="past-record-title" class="form-control" placeholder="e.g. House FSA visit">
                </div>
                <div class="form-group">
                    <label>Core Problem / Summary</label>
                    <textarea id="past-record-summary" class="form-control" rows="3" placeholder="What was discussed or done during this meet up?"></textarea>
                </div>
                <div class="form-group">
                    <label>Outcome</label>
                    <textarea id="past-record-outcome" class="form-control" rows="2" placeholder="What was the result?"></textarea>
                </div>
                <div class="form-group">
                    <label>Next Action</label>
                    <input type="text" id="past-record-next" class="form-control" placeholder="Optional follow up note">
                </div>
            </div>
        `;
        UI.showModal('Add Past Record', modalContent, [
            { label: 'Cancel', type: 'secondary', action: 'UI.hideModal()' },
            { label: 'Save Past Record', type: 'primary', action: `(async () => { await app.savePastRecord(${prospectId}); })()` }
        ]);
    };

    const savePastRecord = async (prospectId) => {
        const date = document.getElementById('past-record-date')?.value;
        const type = document.getElementById('past-record-type')?.value;
        const title = document.getElementById('past-record-title')?.value?.trim() || '';
        const summary = document.getElementById('past-record-summary')?.value?.trim() || '';
        const outcome = document.getElementById('past-record-outcome')?.value?.trim() || '';
        const nextAction = document.getElementById('past-record-next')?.value?.trim() || '';

        if (!date) {
            UI.toast.error('Date is required.');
            return;
        }
        if (!type) {
            UI.toast.error('Activity type is required.');
            return;
        }

        const activity = {
            prospect_id: prospectId,
            activity_type: type,
            activity_date: date,
            activity_title: title || `${type} (Past Record)`,
            summary: summary,
            core_problem: summary,
            note_outcome: outcome,
            note_next_steps: nextAction,
            next_action: nextAction,
            is_past_record: true,
            lead_agent_id: _state.cu ? _state.cu.id : null,
            co_agents: [],
            consultants: []
        };

        let savedPastRecord;
        try {
            savedPastRecord = await AppDataStore.create('activities', activity);
        } catch (err) {
            UI.toast.error('Failed to save past record: ' + (err.message || 'Unknown error'));
            return;
        }

        UI.toast.success('Past record saved.');

        UI.hideModal();

        const bodyEl = document.getElementById(`acc-body-activity-${prospectId}`);
        if (bodyEl) {
            await switchProspectTab('activity', prospectId, null, bodyEl);
        }
    };

    Object.assign(window.app, {
        openActivityModal,
        fillActivityForm,
        typeSelect,
        setField,
        updateActivity,
        activity,
        venueVal,
        locationAddressEl,
        updatedData,
        BASIC_INFO_INCOME_RANGES,
        BASIC_INFO_RELATIONS,
        BASIC_INFO_INTERESTS,
        BASIC_INFO_MING_GUA,
        buildBasicInfoBlock,
        collectBasicInfoData,
        searchBasicInfoReferrers,
        clearBasicInfoReferrer,
        EVENT_CATEGORIES,
        parseEventCategories,
        buildPostMeetupNotesBlock,
        collectPostMeetupNotesData,
        buildMeetingOutcomeBlock,
        collectMeetingOutcomeData,
        scanInvoiceWithAI,
        ORDER_FORM_FIELD_MAP,
        handleOrderFormFile,
        renderOrderFormScanReview,
        toggleOrderFormScanAll,
        dismissOrderFormScanReview,
        applyOrderFormScanSelection,
        loadOrderFormThumbnails,
        removeOrderFormAttachment,
        hasOrderFormPhoto,
        showStandardFunctionsView,
        updateActivityForm,
        calculateDuration,
        onStartTimeChange,
        onEndTimeChange,
        toggleCoAgentSection,
        toggleEventForm,
        toggleActivityNoticeboardFields,
        openCpsCreateEventModal,
        saveCpsNewEvent,
        showSelectedEventDetails,
        toggleAttendeePaid,
        toggleAttendeeTicket,
        toggleAttendeeAttended,
        toggleAttendeeUnattended,
        toggleLifeChartType,
        showAttendeeDetails,
        goToProspectEventNotes,
        showAddAttendeeSearch,
        showAddConsultantSearch,
        searchAddConsultant,
        selectAddConsultant,
        confirmAddConsultant,
        removeAgentAttendee,
        searchAddAttendee,
        selectAddAttendee,
        showFTFAttendeeForm,
        confirmAddAttendee,
        searchAttendees,
        addAttendee,
        removeAttendee,
        updateAttendeeStatus,
        renderAttendees,
        updateLunarBirth,
        searchReferrers,
        selectReferrer,
        clearSelectedReferrer,
        searchConsultants,
        selectConsultant,
        removeConsultant,
        renderSelectedConsultants,
        respondConsultantInvite,
        searchProspectReferrers,
        selectProspectReferrer,
        clearProspectReferrer,
        addProspectChildRow,
        prefillProspectChildren,
        collectProspectChildren,
        searchEntities,
        selectEntity,
        clearSelectedEntity,
        searchAgents,
        addCoAgent,
        removeCoAgent,
        updateCoAgentRole,
        renderCoAgents,
        respondCoAgentInvite,
        saveActivity,
        saveAndAddAnother,
        openPastRecordModal,
        savePastRecord,
    });
})();