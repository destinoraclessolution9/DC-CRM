// Ensure app object exists
window.app = window.app || {};

Object.assign(window.app, (() => {

    const getRandomTagColor = () => {
        const colors = ['#3b82f6', '#f59e0b', '#10b981', '#8b5cf6', '#ec4899'];
        return colors[Math.floor(Math.random() * colors.length)];
    };

    const applyTagsFromEngagement = async (registration, breakdown) => {
        const entity = registration.attendee_type === 'prospect'
            ? await AppDataStore.getById('prospects', registration.prospect_id)
            : await AppDataStore.getById('customers', registration.customer_id);
        if (!entity) return;
        const event = await AppDataStore.getById('events', registration.event_id);
        const tagsToApply = [];
        if (event.auto_tags && event.auto_tags.length) tagsToApply.push(...event.auto_tags);
        if (registration.brought_friends > 0 && event.conditional_tags?.friend) tagsToApply.push(event.conditional_tags.friend);
        if (registration.asked_questions > 0 && event.conditional_tags?.question) tagsToApply.push(event.conditional_tags.question);
        if (registration.made_purchase && event.conditional_tags?.purchase) tagsToApply.push(event.conditional_tags.purchase);

        for (const tagName of tagsToApply) {
            let tag = (await AppDataStore.getAll('tags')).find(t => t.name === tagName);
            if (!tag) {
                tag = await AppDataStore.create('tags', {
                    id: 'tag_' + Date.now() + Math.random(),
                    name: tagName,
                    color: getRandomTagColor(),
                    created_at: new Date().toISOString()
                });
            }
            await AppDataStore.create('entity_tags', {
                id: 'et_' + Date.now() + Math.random(),
                entity_type: registration.attendee_type,
                entity_id: entity.id,
                tag_id: tag.id,
                applied_at: new Date().toISOString(),
                source: 'event',
                source_id: event.id
            });
        }
    };

    // BUG FIX 2026-04-11: was synchronously calling async AppDataStore.getById,
    // which returned a Promise and made `category?.base_score` always undefined,
    // silently killing category-based scoring. Now async so callers must await.
    const calculateEventScore = async (registration, event) => {
        const category = event.event_category_id
            ? await AppDataStore.getById('event_categories', event.event_category_id)
            : null;
        const eventMultiplier = event.score_multiplier || 1.0;
        const baseScore = (category?.base_score || event.base_score || 10) * (category?.score_multiplier || 1.0) * eventMultiplier;

        let engagementPoints = 0;
        const breakdown = {};

        if (registration.brought_friends > 0 && event.enable_friend_bonus) {
            const pts = Math.min(registration.brought_friends, event.max_friends || 3) * (event.friend_points_per_friend || 10);
            engagementPoints += pts;
            breakdown.friend_bonus = pts;
        }

        if (registration.asked_questions > 0 && event.enable_question_bonus) {
            const pts = Math.min(registration.asked_questions, event.max_questions || 3) * (event.question_points_per_question || 5);
            engagementPoints += pts;
            breakdown.question_bonus = pts;
        }

        if (registration.stayed_till_end && event.enable_stay_bonus) {
            engagementPoints += event.stay_points || 5;
            breakdown.stay_bonus = event.stay_points || 5;
        }

        if (registration.made_purchase && registration.purchase_amount > 0 && event.enable_purchase_bonus) {
            const pts = (event.purchase_base_points || 15) + (Math.floor(registration.purchase_amount / 100) * (event.purchase_points_per_100 || 10));
            engagementPoints += pts;
            breakdown.purchase_bonus = pts;
        }

        if (registration.registered_next_event) {
            engagementPoints += 10;
            breakdown.next_event_bonus = 10;
        }

        return {
            base: baseScore,
            engagement: engagementPoints,
            total: baseScore + engagementPoints,
            breakdown
        };
    };

    const processEventScoring = async (eventId) => {
        const allRegs = await AppDataStore.getAll('event_registrations');
        const regs = allRegs.filter(r => r.event_id === eventId && r.checked_in && !r.scoring_processed);
        const event = await AppDataStore.getById('events', eventId);
        if (!event) return;
        for (const reg of regs) {
            const score = await calculateEventScore(reg, event);
            reg.points_awarded = score.total;
            reg.points_breakdown = score.breakdown;
            reg.scoring_processed = true;
            await AppDataStore.update('event_registrations', reg.id, reg);
            const table = reg.attendee_type === 'prospect' ? 'prospects' : 'customers';
            const entityId = reg.attendee_type === 'prospect' ? reg.prospect_id : reg.customer_id;
            const entity = await AppDataStore.getById(table, entityId);
            if (entity) {
                entity.total_score = (entity.total_score || 0) + score.total;
                await AppDataStore.update(table, entity.id, entity);
            }
            await applyTagsFromEngagement(reg, score.breakdown);
        }
        UI.toast.success(`Processed scoring for ${regs.length} attendees.`);
        if (document.querySelector('.event-attendees')) await app.openEventAttendeesModal(eventId);
    };

    const updateEngagementMetrics = async (registrationId, metrics) => {
        const registration = await AppDataStore.getById('event_registrations', registrationId);
        if (!registration) return;
        registration.brought_friends = metrics.brought_friends || 0;
        registration.asked_questions = metrics.asked_questions || 0;
        registration.stayed_till_end = metrics.stayed_till_end || false;
        registration.made_purchase = metrics.made_purchase || false;
        registration.purchase_amount = metrics.purchase_amount || 0;
        await AppDataStore.update('event_registrations', registrationId, registration);
    };

    const checkInAttendee = (registrationId) => {
        (async () => {
            const registration = await AppDataStore.getById('event_registrations', registrationId);
            if (!registration) return;
            const content = `
                <div class="form-section">
                    <h4>Engagement Metrics</h4>
                    <div class="form-row">
                        <div class="form-group half"><label>Friends Brought</label><input type="number" id="brought-friends" class="form-control" value="0" min="0" max="3"></div>
                        <div class="form-group half"><label>Questions Asked</label><input type="number" id="asked-questions" class="form-control" value="0" min="0" max="3"></div>
                    </div>
                    <label class="bonus-checkbox"><input type="checkbox" id="stayed-till-end" checked> Stayed till end</label>
                    <label class="bonus-checkbox"><input type="checkbox" id="made-purchase" onchange="document.getElementById('purchase-amount').disabled = !this.checked"> Made Purchase</label>
                    <div class="form-group"><label>Purchase Amount (RM)</label><input type="number" id="purchase-amount" class="form-control" value="0" disabled></div>
                    
                    <hr style="margin: 15px 0; border: 0; border-top: 1px solid var(--gray-200);">
                    <label class="bonus-checkbox" style="font-weight:600; color:var(--primary);">
                        <input type="checkbox" id="reg-next-event"> Registered for next event (+10 bonus points)
                    </label>
                    
                    <div class="form-group"><label>Check-in Notes</label><textarea id="checkin-notes" class="form-control"></textarea></div>
                </div>
            `;
            UI.showModal('Check-in Attendee', content, [
                { label: 'Cancel', type: 'secondary', action: 'UI.hideModal()' },
                { label: 'Confirm Check-in', type: 'primary', action: `app.executeCheckIn(${registrationId})` }
            ]);
        })();
    };

    const executeCheckIn = async (regId) => {
        const reg = await AppDataStore.getById('event_registrations', regId);
        reg.checked_in = true;
        reg.checked_in_at = new Date().toISOString();
        reg.brought_friends = parseInt(document.getElementById('brought-friends')?.value || 0);
        reg.asked_questions = parseInt(document.getElementById('asked-questions')?.value || 0);
        reg.stayed_till_end = document.getElementById('stayed-till-end')?.checked || false;
        reg.made_purchase = document.getElementById('made-purchase')?.checked || false;
        reg.purchase_amount = parseFloat(document.getElementById('purchase-amount')?.value || 0);
        reg.registered_next_event = document.getElementById('reg-next-event')?.checked || false;

        await AppDataStore.update('event_registrations', regId, reg);

        const event = await AppDataStore.getById('events', reg.event_id);
        const score = await calculateEventScore(reg, event);
        reg.points_awarded = score.total;
        reg.points_breakdown = score.breakdown;
        reg.scoring_processed = true;
        await AppDataStore.update('event_registrations', regId, reg);

        const table = reg.attendee_type === 'prospect' ? 'prospects' : 'customers';
        const entityId = reg.attendee_type === 'prospect' ? reg.prospect_id : reg.customer_id;
        const entity = await AppDataStore.getById(table, entityId);
        if (entity) {
            entity.total_score = (entity.total_score || 0) + score.total;
            await AppDataStore.update(table, entity.id, entity);
        }
        await applyTagsFromEngagement(reg, score.breakdown);

        // BUG FIX 2026-04-11: was hardcoding lead_agent_id=5 as fallback
        // (which is an actual real user's ID). Also removed `score_value`
        // which is not a column on the activities table. Support events with
        // both old (event_title/event_date) and new (title/date) schema.
        const currentUser = await Auth.getCurrentUser();
        try {
            await AppDataStore.create('activities', {
                activity_type: 'EVENT',
                activity_title: `Checked in to: ${event?.event_title || event?.title || 'Event'}`,
                activity_date: event?.event_date || event?.date || new Date().toISOString().split('T')[0],
                start_time: event?.start_time || '00:00',
                end_time: event?.end_time || '23:59',
                venue: event?.location || '',
                event_id: reg.event_id,
                prospect_id: reg.attendee_type === 'prospect' ? reg.prospect_id : null,
                customer_id: reg.attendee_type === 'customer' ? reg.customer_id : null,
                lead_agent_id: entity ? entity.responsible_agent_id : (currentUser?.id || null),
                summary: `Notes: ${document.getElementById('checkin-notes')?.value || 'None'}. Points awarded: ${score.total}`
            });
        } catch (err) {
            console.warn('Check-in: failed to write activity log', err);
        }

        UI.hideModal();
        UI.toast.success(`Checked in successfully! Awarded ${score.total} points`);
        await app.openEventAttendeesModal(reg.event_id);
    };

    const registerAttendee = async (eventId, entityId, type) => {
        if (!entityId) return;
        // BUG FIX 2026-04-11: no duplicate check previously — the same prospect/customer
        // could be registered to the same event any number of times.
        try {
            const existing = await AppDataStore.getAll('event_registrations');
            const pid = parseInt(entityId);
            const dup = (existing || []).find(r =>
                String(r.event_id) === String(eventId)
                && (
                    (type === 'prospect' && String(r.prospect_id) === String(pid))
                    || (type === 'customer' && String(r.customer_id) === String(pid))
                )
            );
            if (dup) {
                UI.toast.error('This person is already registered to this event');
                return;
            }
        } catch (_) { /* if the check fails, fall through and let the create run */ }
        try {
            await AppDataStore.create('event_registrations', {
                event_id: eventId,
                attendee_type: type,
                prospect_id: type === 'prospect' ? parseInt(entityId) : null,
                customer_id: type === 'customer' ? parseInt(entityId) : null,
                registered_at: new Date().toISOString(),
                checked_in: false,
                points_awarded: 0
            });
        } catch (err) {
            UI.toast.error('Registration failed: ' + (err.message || 'Unknown error'));
            return;
        }
        UI.toast.success('Attendee registered!');
        await app.openEventAttendeesModal(eventId);
    };

    const openEventAttendeesModal = async (eventId, activeTab = 'all') => {
        const event = await AppDataStore.getById('events', eventId);
        if (!event) return;
        const allRegs = await AppDataStore.getAll('event_registrations');
        const eventRegs = allRegs.filter(r => r.event_id === eventId);

        let regs = eventRegs;
        if (activeTab === 'registered') regs = eventRegs.filter(r => !r.checked_in);
        if (activeTab === 'checked_in') regs = eventRegs.filter(r => r.checked_in);

        let attendeesHtml = '';
        for (const r of regs) {
            const entity = r.attendee_type === 'prospect'
                ? await AppDataStore.getById('prospects', r.prospect_id)
                : await AppDataStore.getById('customers', r.customer_id);
            const name = entity ? entity.full_name : 'Unknown User';
            const checkInBtn = r.checked_in
                ? `<span style="color:var(--success);"><i class="fas fa-check"></i> Checked In</span>`
                : `<button class="btn primary btn-sm" onclick="event.stopPropagation(); app.checkInAttendee(${r.id})">Check In</button>`;
            attendeesHtml += `
                <tr>
                    <td>${name}</td>
                    <td>${checkInBtn}</td>
                    <td>${r.points_awarded || 0}</td>
                    <td><button class="btn-icon text-error" onclick="event.stopPropagation(); app.deleteAttendee(${r.id}, ${eventId})"><i class="fas fa-times"></i></button></td>
                </tr>
            `;
        }

        const content = `
            <div class="event-attendees">
                <div style="margin-bottom: 16px;">
                    <button class="btn primary" onclick="app.openAddAttendeeModal(${eventId})"><i class="fas fa-user-plus"></i> Add Attendee</button>
                    <button class="btn secondary" onclick="app.processEventScoring(${eventId})"><i class="fas fa-magic"></i> Auto Score</button>
                </div>
                <div class="event-tabs" style="margin-bottom: 16px; border-bottom: 2px solid var(--gray-200);">
                    <button class="event-tab ${activeTab === 'all' ? 'active' : ''}" style="margin-bottom: -2px;" onclick="app.openEventAttendeesModal(${eventId}, 'all')">All (${eventRegs.length})</button>
                    <button class="event-tab ${activeTab === 'registered' ? 'active' : ''}" style="margin-bottom: -2px;" onclick="app.openEventAttendeesModal(${eventId}, 'registered')">Registered (${eventRegs.filter(r => !r.checked_in).length})</button>
                    <button class="event-tab ${activeTab === 'checked_in' ? 'active' : ''}" style="margin-bottom: -2px;" onclick="app.openEventAttendeesModal(${eventId}, 'checked_in')">Checked In (${eventRegs.filter(r => r.checked_in).length})</button>
                </div>
                <div class="events-table-container">
                    <table class="events-table">
                        <thead><tr><th>Name</th><th>Status</th><th>Points</th><th>Actions</th></tr></thead>
                        <tbody>
                            ${attendeesHtml || '<tr><td colspan="4" style="text-align:center;">No attendees registered.</td></tr>'}
                        </tbody>
                    </table>
                </div>
            </div>`;
        // BUG FIX 2026-04-11: support both legacy (event_title) and new (title) schema
        UI.showModal(`Attendees - ${event.event_title || event.title || 'Event'}`, content, [{ label: 'Done', type: 'secondary', action: 'UI.hideModal()' }]);
    };

    const deleteAttendee = async (regId, eventId) => {
        try {
            await AppDataStore.delete('event_registrations', regId);
            await app.openEventAttendeesModal(eventId);
        } catch (err) {
            UI.toast.error('Delete failed: ' + (err.message || 'Unknown error'));
        }
    };

    const showEventManagementView = (container) => {
        container.innerHTML = `
            <div class="events-view">
                <div class="events-header">
                    <div><h1>Event Management</h1><p>Create and manage events with automatic scoring</p></div>
                    <div class="header-actions">
                        <button class="btn secondary" onclick="app.openEventReports()"><i class="fas fa-chart-bar"></i> Event Reports</button>
                        <button class="btn secondary" onclick="app.openCreateEventModal(true)"><i class="fas fa-copy"></i> Manage Templates</button>
                        <button class="btn primary" onclick="app.openCreateEventModal()"><i class="fas fa-plus"></i> Create New Event</button>
                    </div>
                </div>
                <div class="event-tabs">
                    <button class="event-tab active" onclick="app.switchEventTab('upcoming', this)">Upcoming Events</button>
                    <button class="event-tab" onclick="app.switchEventTab('past', this)">Past Events</button>
                    <button class="event-tab" onclick="app.switchEventTab('templates', this)">Event Templates</button>
                </div>
                <div id="event-tab-content"></div>
            </div>`;
        app.renderUpcomingEvents();
    };

    const switchEventTab = (tab, btn) => {
        document.querySelectorAll('.event-tab').forEach(b => b.classList.remove('active'));
        if (btn) btn.classList.add('active');
        if (tab === 'upcoming') app.renderUpcomingEvents();
        else if (tab === 'past') app.renderPastEvents();
        else if (tab === 'templates') app.renderEventTemplates();
    };

    // BUG FIX 2026-04-11: events table has duplicate columns from a schema migration
    // (event_title/title, event_date/date, event_category_id/category). Old rows only
    // populate the `event_*` columns; new rows only populate the shorter ones. This
    // helper returns a row with both variants so any consumer can read either name.
    const _normalizeEvent = (e) => {
        if (!e) return e;
        return {
            ...e,
            event_title: e.event_title || e.title || '',
            event_date: e.event_date || e.date || null,
            event_category_id: e.event_category_id || null,
        };
    };

    const renderUpcomingEvents = async () => {
        const container = document.getElementById('event-tab-content');
        if (!container) return;
        const allEvents = (await AppDataStore.getAll('events')).map(_normalizeEvent);
        // Only events that are (a) not completed AND (b) scheduled on/after today.
        // Previously this filter ignored event_date, so stale events stuck here forever.
        const todayStr = new Date().toISOString().split('T')[0];
        const events = allEvents.filter(e => e.status !== 'completed' && (!(e.event_date || e.date || null) || (e.event_date || e.date || null) >= todayStr));
        let html = `<div class="events-table-container"><table class="events-table"><thead><tr><th>Event Title</th><th>Date</th><th>Expected</th><th>Price</th><th>Score</th><th>Actions</th></tr></thead><tbody>`;
        if (events.length === 0) html += `<tr><td colspan="6" style="text-align:center;">No upcoming events.</td></tr>`;
        for (const e of events) {
            html += `
                <tr>
                    <td><strong>${(e.event_title || e.title || '') || '(untitled)'}</strong></td>
                    <td>${(e.event_date || e.date || null) || '—'}</td>
                    <td>${e.registered_count || 0}</td>
                    <td>RM ${e.ticket_price || 0}</td>
                    <td>+${e.base_score || 0}</td>
                    <td>
                        <button class="btn-icon" onclick="event.stopPropagation(); app.openEditEventModal(${e.id})"><i class="fas fa-edit"></i></button>
                        <button class="btn-icon" onclick="event.stopPropagation(); app.deleteEvent(${e.id})"><i class="fas fa-trash"></i></button>
                        <button class="btn secondary btn-sm" onclick="event.stopPropagation(); app.openEventAttendeesModal(${e.id})">View Attendees</button>
                    </td>
                </tr>
            `;
        }
        container.innerHTML = html + "</tbody></table></div>";
    };

    const renderPastEvents = async () => {
        const container = document.getElementById('event-tab-content');
        if (!container) return;
        const allEvents = (await AppDataStore.getAll('events')).map(_normalizeEvent);
        // Past = explicitly completed OR event_date has passed.
        // Removed the phantom-event seeding (ids 991/992) that polluted real data.
        const todayStr = new Date().toISOString().split('T')[0];
        const events = allEvents.filter(e => e.status === 'completed' || ((e.event_date || e.date || null) && (e.event_date || e.date || null) < todayStr));
        let html = `
            <div style="margin-bottom: 10px; text-align: right;">
                <button class="btn secondary" onclick="app.exportEventData('csv')"><i class="fas fa-file-csv"></i> Export All Past Events</button>
            </div>
            <div class="events-table-container"><table class="events-table"><thead><tr><th>Event Title</th><th>Date</th><th>Actual</th><th>Score</th><th>Actions</th></tr></thead><tbody>`;
        if (events.length === 0) html += `<tr><td colspan="5" style="text-align:center;">No past events.</td></tr>`;
        // BUG FIX 2026-04-11: was fetching event_registrations inside the loop (N+1).
        const allRegs = events.length > 0 ? await AppDataStore.getAll('event_registrations') : [];
        for (const e of events) {
            const regs = allRegs.filter(r => r.event_id === e.id && r.checked_in);
            const avgScore = regs.length ? (regs.reduce((sum, r) => sum + (r.points_awarded || 0), 0) / regs.length).toFixed(1) : 0;
            html += `
                <tr>
                    <td><strong>${(e.event_title || e.title || '') || '(untitled)'}</strong></td>
                    <td>${(e.event_date || e.date || null) || '—'}</td>
                    <td>${regs.length}</td>
                    <td>+${avgScore}</td>
                    <td>
                        <button class="btn secondary btn-sm" onclick="event.stopPropagation(); app.openEventReports()">Report</button>
                        <button class="btn secondary btn-sm" onclick="event.stopPropagation(); app.exportEventData('csv')">Export</button>
                    </td>
                </tr>
            `;
        }
        container.innerHTML = html + "</tbody></table></div>";
    };

    const renderEventTemplates = async () => {
        const container = document.getElementById('event-tab-content');
        if (!container) return;
        let templates = await AppDataStore.getAll('event_templates');
        let html = `<div class="events-table-container"><table class="events-table"><thead><tr><th>Name</th><th>Category</th><th>Score</th><th>Actions</th></tr></thead><tbody>`;
        if (templates.length === 0) html += `<tr><td colspan="4" style="text-align:center;">No templates found.</td></tr>`;
        for (const t of templates) {
            const cat = await AppDataStore.getById('event_categories', t.event_category_id);
            html += `
                <tr>
                    <td><strong>${t.template_name || t.event_title || 'Template'}</strong></td>
                    <td>${cat ? cat.category_name : 'N/A'}</td>
                    <td>+${t.base_score || 0}</td>
                    <td>
                        <button class="btn primary btn-sm" onclick="app.openCreateEventModal(${t.id})">Use</button>
                        <button class="btn secondary btn-sm" onclick="app.editTemplate(${t.id})">Edit</button>
                        <button class="btn-icon" onclick="app.deleteTemplate(${t.id})"><i class="fas fa-trash"></i></button>
                    </td>
                </tr>
            `;
        }
        container.innerHTML = html + "</tbody></table></div>";
    };

    const deleteEvent = async (id) => {
        if (!confirm('Delete this event? All linked activities, registrations, and attendees will also be permanently removed.')) return;
        try {
            const [allActivities, allAttendees, allRegs] = await Promise.all([
                AppDataStore.getAll('activities').catch(() => []),
                AppDataStore.getAll('event_attendees').catch(() => []),
                AppDataStore.getAll('event_registrations').catch(() => [])
            ]);
            for (const act of allActivities.filter(a => String(a.event_id) === String(id)))
                await AppDataStore.delete('activities', act.id);
            for (const att of allAttendees.filter(a => String(a.event_id) === String(id)))
                await AppDataStore.delete('event_attendees', att.id);
            for (const reg of allRegs.filter(r => String(r.event_id) === String(id)))
                await AppDataStore.delete('event_registrations', reg.id);
            await AppDataStore.delete('events', id);
            await renderUpcomingEvents();
        } catch (err) {
            UI.toast.error('Delete failed: ' + (err.message || 'Unknown error'));
        }
    };

    const deleteTemplate = async (id) => {
        try {
            await AppDataStore.delete('event_templates', id);
            await renderEventTemplates();
        } catch (err) {
            UI.toast.error('Delete failed: ' + (err.message || 'Unknown error'));
        }
    };

    const editTemplate = async (templateId) => {
        const template = await AppDataStore.getById('event_templates', templateId);
        if (!template) return;

        const categories = await AppDataStore.getAll('event_categories');
        const catOptions = categories.map(c => `<option value="${c.id}" ${template.event_category_id == c.id ? 'selected' : ''}>${c.category_name}</option>`).join('');

        const content = `
            <form id="template-edit-form" onsubmit="event.preventDefault(); app.saveTemplateUpdate(${templateId});">
                <div class="form-section">
                    <h4>Edit Template</h4>
                    <div class="form-row">
                        <div class="form-group half"><label>Template Name</label><input type="text" id="edit-template-name" class="form-control" value="${template.template_name}" required></div>
                        <div class="form-group half"><label>Category</label><select id="edit-template-category" class="form-control">${catOptions}</select></div>
                    </div>
                </div>
            </form>`;

        UI.showModal('Edit Template', content, [
            { label: 'Cancel', type: 'secondary', action: 'UI.hideModal()' },
            { label: 'Save Changes', type: 'primary', action: 'document.getElementById("template-edit-form").dispatchEvent(new Event("submit"))' }
        ]);
    };

    const saveTemplateUpdate = async (templateId) => {
        const template = await AppDataStore.getById('event_templates', templateId);
        template.template_name = document.getElementById('edit-template-name').value;
        template.event_category_id = parseInt(document.getElementById('edit-template-category').value);
        await AppDataStore.update('event_templates', templateId, template);
        UI.hideModal();
        UI.toast.success('Template updated');
        await app.renderEventTemplates();
    };

    const applyTemplate = async (templateId) => {
        const template = await AppDataStore.getById('event_templates', templateId);
        if (!template) return;
        document.getElementById('event-title').value = template.template_name || template.event_title || template.title || '';
        document.getElementById('event-category').value = template.event_category_id || 1;
        document.getElementById('event-description').value = template.description || '';
        document.getElementById('event-location').value = template.location || '';
        if (document.getElementById('event-start-time')) document.getElementById('event-start-time').value = template.start_time || '';
        if (document.getElementById('event-end-time')) document.getElementById('event-end-time').value = template.end_time || '';
        document.getElementById('event-capacity').value = template.capacity || '';
        document.getElementById('ticket-price').value = template.ticket_price || '';
        document.getElementById('base-score').value = template.base_score || 10;
        document.getElementById('score-multiplier').value = template.score_multiplier || 1.0;
        if (template.enable_friend_bonus !== undefined) document.getElementById('enable-friend-bonus').checked = template.enable_friend_bonus;
        if (template.enable_question_bonus !== undefined) document.getElementById('enable-question-bonus').checked = template.enable_question_bonus;
        UI.toast.success('Template applied');
    };

    const openCreateEventModal = async (isTemplate = false) => {
        const categories = await AppDataStore.getAll('event_categories');
        const catOptions = categories.map(c => `<option value="${c.id}">${c.category_name}</option>`).join('');
        const content = `
            <form id="event-form" onsubmit="event.preventDefault(); app.saveEvent(${isTemplate});">
                <div class="form-section">
                    <h4>Event Details</h4>
                    <div class="form-row">
                        <div class="form-group half"><label>Title *</label><input type="text" id="event-title" class="form-control" required></div>
                        <div class="form-group half"><label>Category</label><select id="event-category" class="form-control">${catOptions}</select></div>
                    </div>
                    <div class="form-group"><label>Description</label><textarea id="event-description" class="form-control"></textarea></div>
                    <div class="form-row">
                        <div class="form-group half"><label>Date *</label><input type="date" id="event-date" class="form-control" ${isTemplate ? '' : 'required'}></div>
                        <div class="form-group half"><label>Location</label><input type="text" id="event-location" class="form-control"></div>
                    </div>
                    <div class="form-row">
                        <div class="form-group half"><label>Start Time</label><input type="time" id="event-start-time" class="form-control"></div>
                        <div class="form-group half"><label>End Time</label><input type="time" id="event-end-time" class="form-control"></div>
                    </div>
                    <div class="form-row">
                        <div class="form-group half"><label>Capacity</label><input type="number" id="event-capacity" class="form-control" value="0"></div>
                        <div class="form-group half"><label>Ticket Price</label><input type="number" id="ticket-price" class="form-control" value="0"></div>
                    </div>
                </div>
                <div class="form-section scoring-section">
                    <h4>Scoring Config</h4>
                    <div class="scoring-row" style="display:flex;gap:12px;">
                        <div class="form-group half"><label>Base Points</label><input type="number" id="base-score" class="form-control" value="10"></div>
                        <div class="form-group half"><label>Score Multiplier</label><input type="number" id="score-multiplier" class="form-control" value="1.0" step="0.1"></div>
                    </div>
                    <label class="bonus-checkbox"><input type="checkbox" id="enable-friend-bonus" checked> Bringing a friend (+10 per friend, max 3)</label>
                    <label class="bonus-checkbox"><input type="checkbox" id="enable-question-bonus" checked> Asking questions (+5 per question, max 3)</label>
                    <label class="bonus-checkbox"><input type="checkbox" id="enable-stay-bonus" checked> Staying till end (+5)</label>
                    <label class="bonus-checkbox"><input type="checkbox" id="enable-purchase-bonus" checked> Making purchase (+15 + 10 per RM100)</label>
                    
                    <hr style="margin: 10px 0; border: 0; border-top: 1px dashed var(--gray-200);">
                    <label class="bonus-checkbox" style="font-weight:600; color:var(--primary);">
                        <input type="checkbox" id="enable-next-event-bonus" checked> Register for next event bonus (+10 pts)
                    </label>
                </div>
                <div class="form-section">
                    <h4>Auto-Tagging Rules</h4>
                    <div class="form-row">
                        <div class="form-group half"><label class="bonus-checkbox"><input type="checkbox" id="tag-attendee" checked> Event Attendee</label></div>
                        <div class="form-group half"><label class="bonus-checkbox"><input type="checkbox" id="tag-course"> Course Participant</label></div>
                    </div>
                    <div class="form-group">
                        <label>Conditional Tag on Purchase</label>
                        <input type="text" id="tag-buyer" class="form-control" value="Event Buyer">
                    </div>
                </div>
                <div class="form-section">
                    <h4>Invitations & Reminders</h4>
                    <div class="form-row">
                        <div class="form-group half">
                            <label>Channel</label>
                            <select id="reminder-channel" class="form-control">
                                <option value="Email">Email</option>
                                <option value="WhatsApp">WhatsApp</option>
                                <option value="Both">Both (Email + WhatsApp)</option>
                            </select>
                        </div>
                        <div class="form-group half">
                            <label>Target Audience</label>
                            <select id="target-audience" class="form-control">
                                <option value="All">All Prospects & Customers</option>
                                <option value="Hot">Hot Leads Only</option>
                                <option value="Specific Tag">Specific Tag Category</option>
                            </select>
                        </div>
                    </div>
                    <div class="form-group"><label>Invite Template</label><select class="form-control"><option>Standard Invite</option><option>VIP Invite</option></select></div>
                </div>
                <div class="form-section" style="margin-bottom:30px;">
                    <h4>Post-Event Follow-up</h4>
                    <label class="bonus-checkbox"><input type="checkbox" id="send-thanks" checked> Send Thank You Message</label>
                    <label class="bonus-checkbox"><input type="checkbox" id="assign-followup"> Assign Follow-up Task to Agent</label>
                </div>
            </form>`;
        UI.showModal(isTemplate ? 'Create Template' : 'Create Event', content, [
            { label: 'Cancel', type: 'secondary', action: 'UI.hideModal()' },
            { label: 'Save', type: 'primary', action: 'document.getElementById("event-form").dispatchEvent(new Event("submit"))' }
        ]);
        if (typeof isTemplate === 'number') setTimeout(() => app.applyTemplate(isTemplate), 100);
    };

    const saveEvent = async (isTemplate) => {
        const title = document.getElementById('event-title').value;
        const baseProps = {
            event_category_id: parseInt(document.getElementById('event-category').value) || 1,
            description: document.getElementById('event-description').value,
            location: document.getElementById('event-location').value,
            start_time: document.getElementById('event-start-time')?.value || '',
            end_time: document.getElementById('event-end-time')?.value || '',
            capacity: parseInt(document.getElementById('event-capacity').value) || 0,
            ticket_price: parseFloat(document.getElementById('ticket-price').value) || 0,
            base_score: parseInt(document.getElementById('base-score').value) || 10,
            score_multiplier: parseFloat(document.getElementById('score-multiplier').value) || 1.0,
            enable_friend_bonus: document.getElementById('enable-friend-bonus').checked,
            enable_question_bonus: document.getElementById('enable-question-bonus').checked,
            enable_stay_bonus: document.getElementById('enable-stay-bonus').checked,
            enable_purchase_bonus: document.getElementById('enable-purchase-bonus').checked,
            enable_next_event_bonus: document.getElementById('enable-next-event-bonus').checked,
            conditional_tags: {
                friend: 'Friend Bringer',
                question: 'Engaged Attendee',
                purchase: document.getElementById('tag-buyer')?.value || 'Event Buyer'
            },
            reminder_channel: document.getElementById('reminder-channel')?.value || 'Email',
            target_audience: document.getElementById('target-audience')?.value || 'All',
            send_thanks: document.getElementById('send-thanks')?.checked || false,
            assign_followup: document.getElementById('assign-followup')?.checked || false
        };

        if (isTemplate === true) {
            await AppDataStore.create('event_templates', { template_name: title, ...baseProps });
            UI.toast.success('Template saved.');
            await app.switchEventTab('templates');
        } else {
            const autoTags = [];
            if (document.getElementById('tag-attendee').checked) autoTags.push('Event Attendee');
            if (document.getElementById('tag-course').checked) autoTags.push('Course Participant');

            await AppDataStore.create('events', {
                event_title: title,
                event_date: document.getElementById('event-date').value,
                status: 'upcoming',
                auto_tags: autoTags,
                custom_multiplier: 1.0,
                ...baseProps
            });
            UI.toast.success('Event created.');
            await app.renderUpcomingEvents();
        }
        UI.hideModal();
    };

    const generateAttendanceChart = async () => {
        const events = await AppDataStore.getAll('events');
        const ctx = document.getElementById('attendance-chart')?.getContext('2d');
        if (!ctx) return;
        const regs = await AppDataStore.getAll('event_registrations');
        const data = await Promise.all(events.map(async e => {
            return (await AppDataStore.getAll('event_registrations')).filter(r => r.event_id === e.id && r.checked_in).length;
        }));
        new Chart(ctx, {
            type: 'pie',
            data: {
                labels: events.map(e => (e.event_title || e.title || '')),
                datasets: [{ data: data, backgroundColor: ['#3b82f6', '#f59e0b', '#10b981', '#8b5cf6', '#ec4899'] }]
            },
            options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'bottom' }, title: { display: true, text: 'Attendance by Event' } } }
        });
    };

    const generateScoreChart = async () => {
        const regs = (await AppDataStore.getAll('event_registrations')).filter(r => r.checked_in && r.scoring_processed);
        const ranges = { '0-10': 0, '11-20': 0, '21-30': 0, '31-40': 0, '41+': 0 };
        regs.forEach(r => {
            const pts = r.points_awarded || 0;
            if (pts <= 10) ranges['0-10']++;
            else if (pts <= 20) ranges['11-20']++;
            else if (pts <= 30) ranges['21-30']++;
            else if (pts <= 40) ranges['31-40']++;
            else ranges['41+']++;
        });
        const ctx = document.getElementById('score-chart')?.getContext('2d');
        if (!ctx) return;
        new Chart(ctx, {
            type: 'bar',
            data: { labels: Object.keys(ranges), datasets: [{ label: 'Attendees', data: Object.values(ranges), backgroundColor: '#3b82f6' }] },
            options: { responsive: true, maintainAspectRatio: false, plugins: { title: { display: true, text: 'Score Distribution' } } }
        });
    };

    const generateMonthlyTrendChart = async () => {
        const events = await AppDataStore.getAll('events');
        const regs = (await AppDataStore.getAll('event_registrations')).filter(r => r.checked_in);
        const md = {};
        for (const r of regs) {
            const ev = events.find(e => e.id === r.event_id);
            const _evDate = ev && (ev.event_date || ev.date);
            if (!ev || !_evDate) continue;
            const m = new Date(_evDate).toLocaleString('default', { month: 'short' });
            md[m] = (md[m] || 0) + 1;
        }
        const ctx = document.getElementById('trend-chart')?.getContext('2d');
        if (!ctx) return;
        new Chart(ctx, {
            type: 'line',
            data: { labels: Object.keys(md), datasets: [{ label: 'Attendance', data: Object.values(md), borderColor: '#f59e0b', tension: 0.1 }] },
            options: { responsive: true, maintainAspectRatio: false, plugins: { title: { display: true, text: 'Monthly Attendance Trend' } } }
        });
    };

    const exportEventData = async (format) => {
        const events = await AppDataStore.getAll('events');
        const registrations = await AppDataStore.getAll('event_registrations');

        if (format === 'csv') {
            let csv = 'Event Title,Date,Registered,Attended,Avg Score\n';
            for (const e of events) {
                const evRegs = registrations.filter(r => r.event_id === e.id);
                const att = evRegs.filter(r => r.checked_in).length;
                const avg = att > 0 ? evRegs.reduce((sum, r) => sum + (r.points_awarded || 0), 0) / att : 0;
                csv += `"${(e.event_title || e.title || '')}",${(e.event_date || e.date || null)},${evRegs.length},${att},${avg.toFixed(1)}\n`;
            }
            const blob = new Blob([csv], { type: 'text/csv' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = 'event-report.csv';
            a.click();
            URL.revokeObjectURL(url);
            UI.toast.success('Report exported (CSV)');
        } else if (format === 'pdf') {
            const { jsPDF } = window.jspdf;
            const doc = new jsPDF();

            doc.setFontSize(18);
            doc.text('CRM Event Management Report', 14, 22);
            doc.setFontSize(11);
            doc.setTextColor(100);
            doc.text(`Generated on: ${new Date().toLocaleString()}`, 14, 30);

            const tableData = [];
            for (const e of events) {
                const evRegs = registrations.filter(r => r.event_id === e.id);
                const att = evRegs.filter(r => r.checked_in).length;
                const avg = att > 0 ? (evRegs.reduce((sum, r) => sum + (r.points_awarded || 0), 0) / att).toFixed(1) : '0.0';
                tableData.push([(e.event_title || e.title || ''), (e.event_date || e.date || null), evRegs.length, att, avg]);
            }

            doc.autoTable({
                startY: 40,
                head: [['Event Title', 'Date', 'Registered', 'Attended', 'Avg Score']],
                body: tableData,
                theme: 'striped',
                headStyles: { fillColor: [59, 130, 246] }
            });

            doc.save('event-management-report.pdf');
            UI.toast.success('Report exported (PDF)');
        }
    };

    const exportAttendeeList = async (eventId, format) => {
        const event = await AppDataStore.getById('events', eventId);
        const regs = (await AppDataStore.getAll('event_registrations')).filter(r => r.event_id === eventId);

        if (format === 'pdf') {
            const { jsPDF } = window.jspdf;
            const doc = new jsPDF();

            const _title = event.event_title || event.title || 'Event';
            const _date = event.event_date || event.date || '';
            doc.setFontSize(18);
            doc.text(`Attendee List: ${_title}`, 14, 22);
            doc.setFontSize(11);
            doc.text(`Event Date: ${_date}`, 14, 30);

            const tableData = [];
            for (const r of regs) {
                const entity = r.attendee_type === 'prospect'
                    ? await AppDataStore.getById('prospects', r.prospect_id)
                    : await AppDataStore.getById('customers', r.customer_id);
                tableData.push([
                    entity?.full_name || 'Unknown',
                    r.attendee_type.toUpperCase(),
                    r.checked_in ? 'Yes' : 'No',
                    r.points_awarded || 0,
                    r.checked_in_at ? new Date(r.checked_in_at).toLocaleTimeString() : '-'
                ]);
            }

            doc.autoTable({
                startY: 40,
                head: [['Name', 'Type', 'Checked In', 'Points', 'Check-in Time']],
                body: tableData,
                theme: 'grid'
            });

            doc.save(`attendees-${_title.replace(/\s+/g, '-').toLowerCase()}.pdf`);
            UI.toast.success('Attendee list exported (PDF)');
        }
    };

    const showSingleEventReport = async (eventId) => {
        const event = await AppDataStore.getById('events', eventId);
        const regs = (await AppDataStore.getAll('event_registrations')).filter(r => r.event_id === eventId);
        const checkedIn = regs.filter(r => r.checked_in);

        const attendanceRate = regs.length > 0 ? Math.round((checkedIn.length / regs.length) * 100) : 0;
        const totalPoints = checkedIn.reduce((sum, r) => sum + (r.points_awarded || 0), 0);
        const avgPoints = checkedIn.length > 0 ? (totalPoints / checkedIn.length).toFixed(1) : 0;

        const content = `
            <div class="event-report-detail">
                <div class="report-header">
                    <h2>${event.event_title || event.title || 'Event'} - Analytics</h2>
                    <div class="report-actions">
                        <button class="btn primary btn-sm" onclick="app.exportAttendeeList(${eventId}, 'pdf')">
                            <i class="fas fa-file-pdf"></i> Attendee List
                        </button>
                    </div>
                </div>
                
                <div class="report-stats">
                    <div class="stat-box">
                        <label>Attendance Rate</label>
                        <div class="value">${attendanceRate}%</div>
                        <div class="progress-bar"><div class="progress" style="width: ${attendanceRate}%"></div></div>
                    </div>
                    <div class="stat-box">
                        <label>Total Engagement</label>
                        <div class="value">${totalPoints} pts</div>
                    </div>
                    <div class="stat-box">
                        <label>Engagement Score</label>
                        <div class="value">${avgPoints}</div>
                    </div>
                </div>
                
                <div class="engagement-breakdown">
                    <h4>Engagement Breakdown</h4>
                    <div class="engagement-row">
                        <span>Brought Friends</span>
                        <div class="engagement-bar"><div class="bar" style="width: ${Math.random() * 80 + 10}%"></div></div>
                    </div>
                    <div class="engagement-row">
                        <span>Asked Questions</span>
                        <div class="engagement-bar"><div class="bar" style="width: ${Math.random() * 80 + 10}%"></div></div>
                    </div>
                    <div class="engagement-row">
                        <span>Next Event Reg</span>
                        <div class="engagement-bar"><div class="bar" style="width: ${Math.random() * 80 + 10}%"></div></div>
                    </div>
                </div>
            </div>
        `;

        UI.showModal('Event Report', content, [{ label: 'Close', type: 'secondary', action: 'UI.hideModal()' }]);
    };

    const openAddAttendeeModal = async (eventId) => {
        const event = await AppDataStore.getById('events', eventId);
        if (!event) return;

        const existing = (await AppDataStore.getAll('event_registrations')).filter(r => r.event_id === eventId);
        window._eventAttendeeExcludedProspects = new Set(existing.filter(r => r.prospect_id).map(r => r.prospect_id));
        window._eventAttendeeExcludedCustomers = new Set(existing.filter(r => r.customer_id).map(r => r.customer_id));

        const content = `
            <div>
                <p style="font-size:13px; color:var(--gray-500); margin-bottom:12px;">Search by name or phone number.</p>
                <div style="position:relative;">
                    <input type="text" id="event-attendee-search" class="form-control"
                        placeholder="Type name or phone..."
                        oninput="app.searchEventAttendees(${eventId})"
                        autocomplete="off">
                    <div id="event-attendee-results" style="display:none; position:absolute; top:100%; left:0; right:0; background:#fff; border:1px solid var(--gray-200); border-radius:6px; box-shadow:0 4px 12px rgba(0,0,0,0.1); z-index:1000; max-height:240px; overflow-y:auto;"></div>
                </div>
                <div id="event-attendee-selected" style="margin-top:16px; min-height:48px; color:var(--gray-400); font-size:13px; text-align:center; padding:12px;">
                    No attendee selected yet.
                </div>
            </div>`;

        UI.showModal(`Add Attendee — ${event.event_title || event.title || 'Event'}`, content, [
            { label: 'Cancel', type: 'secondary', action: 'UI.hideModal()' }
        ]);

        setTimeout(() => document.getElementById('event-attendee-search')?.focus(), 100);
    };

    const searchEventAttendees = async (eventId) => {
        const input = document.getElementById('event-attendee-search');
        const results = document.getElementById('event-attendee-results');
        if (!input || !results) return;

        const query = input.value.trim().toLowerCase();
        if (query.length < 2) { results.style.display = 'none'; return; }

        const prospects = await AppDataStore.getAll('prospects');
        const customers = await AppDataStore.getAll('customers');
        const excludeP = window._eventAttendeeExcludedProspects || new Set();
        const excludeC = window._eventAttendeeExcludedCustomers || new Set();

        const matchP = prospects
            .filter(p => !excludeP.has(p.id) &&
                ((p.full_name && p.full_name.toLowerCase().includes(query)) || (p.phone && p.phone.includes(query))))
            .slice(0, 6)
            .map(p => ({ ...p, type: 'prospect' }));

        const matchC = customers
            .filter(c => !excludeC.has(c.id) &&
                ((c.full_name && c.full_name.toLowerCase().includes(query)) || (c.phone && c.phone.includes(query))))
            .slice(0, 4)
            .map(c => ({ ...c, type: 'customer' }));

        const all = [...matchP, ...matchC];
        if (all.length === 0) {
            results.innerHTML = '<div style="padding:10px 14px; color:var(--gray-400); font-size:13px;">No matches found.</div>';
        } else {
            results.innerHTML = all.map(m => `
                <div onclick="app.selectEventAttendee(${eventId}, ${m.id}, '${m.type}', '${(m.full_name || '').replace(/'/g, "\\'")}')"
                    style="padding:10px 14px; cursor:pointer; border-bottom:1px solid var(--gray-100); display:flex; justify-content:space-between; align-items:center;"
                    onmouseover="this.style.background='var(--gray-50)'" onmouseout="this.style.background=''">
                    <div>
                        <div style="font-weight:500; font-size:13px;">${m.full_name || ''}</div>
                        <div style="font-size:11px; color:var(--gray-400);">${m.phone || ''}</div>
                    </div>
                    <span style="font-size:11px; background:${m.type === 'prospect' ? '#eff6ff' : '#f0fdf4'}; color:${m.type === 'prospect' ? '#2563eb' : '#16a34a'}; padding:2px 8px; border-radius:12px;">${m.type}</span>
                </div>
            `).join('');
        }
        results.style.display = 'block';
    };

    const selectEventAttendee = (eventId, entityId, type, name) => {
        const results = document.getElementById('event-attendee-results');
        const selected = document.getElementById('event-attendee-selected');
        const input = document.getElementById('event-attendee-search');
        if (results) results.style.display = 'none';
        if (input) input.value = name;
        if (selected) {
            selected.innerHTML = `
                <div style="display:flex; align-items:center; justify-content:space-between; padding:10px 14px; background:var(--gray-50); border-radius:8px; border:1px solid var(--gray-200);">
                    <div>
                        <div style="font-weight:600; font-size:14px;">${name}</div>
                        <div style="font-size:12px; color:var(--gray-400); text-transform:capitalize;">${type}</div>
                    </div>
                    <button class="btn primary btn-sm" onclick="app.registerAttendee(${eventId}, ${entityId}, '${type}')">
                        <i class="fas fa-plus"></i> Register
                    </button>
                </div>`;
        }
    };

    const openEditEventModal = async (eventId) => {
        const e = await AppDataStore.getById('events', eventId);
        if (!e) return;

        const categories = await AppDataStore.getAll('event_categories');
        const catOptions = categories.map(c =>
            `<option value="${c.id}" ${e.event_category_id == c.id ? 'selected' : ''}>${c.category_name}</option>`
        ).join('');

        const content = `
            <form id="edit-event-form" onsubmit="event.preventDefault(); app.saveEditEvent(${eventId});">
                <div class="form-section">
                    <h4>Event Details</h4>
                    <div class="form-row">
                        <div class="form-group half"><label>Title *</label><input type="text" id="edit-event-title" class="form-control" value="${((e.event_title || e.title || '') || '').replace(/"/g, '&quot;')}" required></div>
                        <div class="form-group half"><label>Category</label><select id="edit-event-category" class="form-control">${catOptions}</select></div>
                    </div>
                    <div class="form-group"><label>Description</label><textarea id="edit-event-description" class="form-control">${e.description || ''}</textarea></div>
                    <div class="form-row">
                        <div class="form-group half"><label>Date *</label><input type="date" id="edit-event-date" class="form-control" value="${(e.event_date || e.date || null) || ''}" required></div>
                        <div class="form-group half"><label>Location</label><input type="text" id="edit-event-location" class="form-control" value="${(e.location || '').replace(/"/g, '&quot;')}"></div>
                    </div>
                    <div class="form-row">
                        <div class="form-group half"><label>Capacity</label><input type="number" id="edit-event-capacity" class="form-control" value="${e.capacity || 0}"></div>
                        <div class="form-group half"><label>Ticket Price (RM)</label><input type="number" id="edit-ticket-price" class="form-control" value="${e.ticket_price || 0}"></div>
                    </div>
                </div>
                <div class="form-section scoring-section">
                    <h4>Scoring Config</h4>
                    <div class="scoring-row" style="display:flex;gap:12px;">
                        <div class="form-group half"><label>Base Points</label><input type="number" id="edit-base-score" class="form-control" value="${e.base_score || 10}"></div>
                        <div class="form-group half"><label>Score Multiplier</label><input type="number" id="edit-score-multiplier" class="form-control" value="${e.score_multiplier || 1.0}" step="0.1"></div>
                    </div>
                    <label class="bonus-checkbox"><input type="checkbox" id="edit-friend-bonus" ${e.enable_friend_bonus !== false ? 'checked' : ''}> Bringing a friend (+10 per friend, max 3)</label>
                    <label class="bonus-checkbox"><input type="checkbox" id="edit-question-bonus" ${e.enable_question_bonus !== false ? 'checked' : ''}> Asking questions (+5 per question, max 3)</label>
                    <label class="bonus-checkbox"><input type="checkbox" id="edit-stay-bonus" ${e.enable_stay_bonus !== false ? 'checked' : ''}> Staying till end (+5)</label>
                    <label class="bonus-checkbox"><input type="checkbox" id="edit-purchase-bonus" ${e.enable_purchase_bonus !== false ? 'checked' : ''}> Making purchase (+15 + 10 per RM100)</label>
                </div>
                <div class="form-section">
                    <h4>Status</h4>
                    <select id="edit-event-status" class="form-control">
                        <option value="upcoming" ${e.status === 'upcoming' ? 'selected' : ''}>Upcoming</option>
                        <option value="completed" ${e.status === 'completed' ? 'selected' : ''}>Completed</option>
                        <option value="cancelled" ${e.status === 'cancelled' ? 'selected' : ''}>Cancelled</option>
                    </select>
                </div>
            </form>`;

        UI.showModal('Edit Event', content, [
            { label: 'Cancel', type: 'secondary', action: 'UI.hideModal()' },
            { label: 'Save Changes', type: 'primary', action: 'document.getElementById("edit-event-form").dispatchEvent(new Event("submit"))' }
        ]);
    };

    const saveEditEvent = async (eventId) => {
        const title = document.getElementById('edit-event-title')?.value?.trim();
        if (!title) { UI.toast.error('Event title is required.'); return; }

        await AppDataStore.update('events', eventId, {
            event_title: title,
            event_category_id: parseInt(document.getElementById('edit-event-category').value) || 1,
            description: document.getElementById('edit-event-description').value,
            event_date: document.getElementById('edit-event-date').value,
            location: document.getElementById('edit-event-location').value,
            capacity: parseInt(document.getElementById('edit-event-capacity').value) || 0,
            ticket_price: parseFloat(document.getElementById('edit-ticket-price').value) || 0,
            base_score: parseInt(document.getElementById('edit-base-score').value) || 10,
            score_multiplier: parseFloat(document.getElementById('edit-score-multiplier').value) || 1.0,
            enable_friend_bonus: document.getElementById('edit-friend-bonus').checked,
            enable_question_bonus: document.getElementById('edit-question-bonus').checked,
            enable_stay_bonus: document.getElementById('edit-stay-bonus').checked,
            enable_purchase_bonus: document.getElementById('edit-purchase-bonus').checked,
            status: document.getElementById('edit-event-status').value
        });

        UI.toast.success('Event updated.');
        UI.hideModal();
        if (app.renderUpcomingEvents) await app.renderUpcomingEvents();
    };

    const openEventReports = async () => {
        const events = await AppDataStore.getAll('events');
        const registrations = await AppDataStore.getAll('event_registrations');
        const checkedInRegs = registrations.filter(r => r.checked_in);
        const totalAttendees = checkedInRegs.length;
        const totalScore = checkedInRegs.reduce((sum, r) => sum + (r.points_awarded || 0), 0);
        const avgScore = totalAttendees > 0 ? (totalScore / totalAttendees).toFixed(1) : '0.0';

        const content = `<div class="reports-dashboard"><div class="reports-grid"><div class="report-card"><h3>Events</h3><div class="stat">${events.length}</div></div><div class="report-card"><h3>Checked-in Attendees</h3><div class="stat">${totalAttendees}</div></div><div class="report-card"><h3>Avg Score Awarded</h3><div class="stat">${avgScore}</div></div></div><div class="chart-row"><div class="chart-container"><canvas id="attendance-chart"></canvas></div><div class="chart-container"><canvas id="score-chart"></canvas></div></div><div class="chart-container full-width"><canvas id="trend-chart"></canvas></div><div class="export-actions"><button class="btn primary" onclick="app.exportEventData('csv')"><i class="fas fa-file-csv"></i> Export CSV</button><button class="btn secondary" onclick="app.exportEventData('pdf')"><i class="fas fa-file-pdf"></i> Export PDF</button></div></div>`;
        UI.showModal('Event Reports', content, [{ label: 'Close', type: 'secondary', action: 'UI.hideModal()' }], 'fullscreen');
        setTimeout(async () => {
            await app.generateAttendanceChart();
            await app.generateScoreChart();
            await app.generateMonthlyTrendChart();
        }, 100);
    };

    return {
        updateEngagementMetrics,
        processEventScoring,
        applyTemplate,
        editTemplate,
        saveTemplateUpdate,
        exportEventData,
        exportAttendeeList,
        showSingleEventReport,
        generateAttendanceChart,
        generateScoreChart,
        generateMonthlyTrendChart,
        applyTagsFromEngagement,
        showEventManagementView,
        switchEventTab,
        renderUpcomingEvents,
        renderPastEvents,
        renderEventTemplates,
        openCreateEventModal,
        saveEvent,
        calculateEventScore,
        openEventAttendeesModal,
        openAddAttendeeModal,
        searchEventAttendees,
        selectEventAttendee,
        registerAttendee,
        checkInAttendee,
        executeCheckIn,
        openEditEventModal,
        saveEditEvent,
        openEventReports,
        deleteEvent,
        deleteTemplate,
        deleteAttendee
    };
})());