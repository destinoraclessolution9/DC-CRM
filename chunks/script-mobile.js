/**
 * CRM Lazy Chunk: Notes, Voice Recording + Mobile UI
 *
 * Self-contained IIFE loaded on-demand. On mobile devices it is eagerly
 * loaded at init time via window._loadChunk() so mobile nav and swipe
 * gestures are available immediately.
 *
 * Extracted 2026-06-05 from script.js PHASE 14 (~2258 lines).
 * External deps: window.AppDataStore, window.UI, window.app,
 *   window._appState (cu, cv, cdv), window._crmUtils (escapeHtml, isMobile),
 *   window._loadScriptOnce
 */
(() => {
    const _state = window._appState;
    const _utils = window._crmUtils;
    const isMobile = () => _utils.isMobile();
    const escapeHtml = (...a) => _utils.escapeHtml(...a);
    const getVisibleUserIds = (u) => _utils.getVisibleUserIds(u);
    const isSystemAdmin = (u) => _utils.isSystemAdmin(u || _state.cu);
    const getUserLevel = (u) => _utils.getUserLevel(u || _state.cu);
    const navigateTo = (v) => window.app.navigateTo(v);
    // Mirror of script.js _defaultViewFor for mobile: L15 → stock_take,
    // L12–L14 (ambassador / customer / referrer) → fude, agent band (L1–L11) →
    // home. Used to bounce non-agents off the agent Home dashboard and to decide
    // which bottom-nav tabs to surface.
    const _mobileDefaultView = (u) => {
        const lvl = getUserLevel(u || _state.cu);
        if (lvl === 15) return 'stock_take';
        if (lvl >= 12) return 'fude';
        return 'home';
    };
    // Local (MYT) date YYYY-MM-DD — toISOString() is UTC and records the previous
    // day for actions taken before 08:00 local.
    const _mLocalDate = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; };
    // Team-birthday MM-DD for a staff/user record: prefer an explicit
    // date_of_birth (YYYY-MM-DD), else derive from the Malaysian IC number
    // (first 6 digits = YYMMDD). Birth year is irrelevant for a birthday match,
    // so we only ever return MM-DD. Foreign / non-IC ids fail the range check
    // and return '' (skipped). Mirrors getStaffMMDD in script-calendar.js.
    const _staffMD = (u) => {
        const dob = u && u.date_of_birth || '';
        if (typeof dob === 'string' && dob.length >= 7 && dob[4] === '-') return dob.slice(5, 10);
        const digits = String((u && u.ic_number) || '').replace(/[^0-9]/g, '');
        if (digits.length < 6) return '';
        const mm = digits.substring(2, 4), dd = digits.substring(4, 6);
        const mi = parseInt(mm, 10), di = parseInt(dd, 10);
        if (!(mi >= 1 && mi <= 12 && di >= 1 && di <= 31)) return '';
        return `${mm}-${dd}`;
    };
    // Collapse duplicate staff accounts (same person across multiple user rows)
    // so a colleague's Team Birthday shows once. Keyed by name + birthday MM-DD;
    // prefers a row with a phone (so Send Wish works). Drops no-birthday rows.
    const _dedupStaffByBday = (rows) => {
        const seen = new Map();
        for (const u of (rows || [])) {
            const md = _staffMD(u);
            if (!md) continue;
            const key = `${String(u.full_name || '').trim().toLowerCase()}|${md}`;
            const prev = seen.get(key);
            if (!prev || (!prev.phone && u.phone)) seen.set(key, u);
        }
        return [...seen.values()];
    };
    // Collapse a CLIENT (prospect/customer) who exists in BOTH tables — e.g. a
    // converted prospect whose old record lingers — into one birthday entry.
    // Keyed by name + DOB (MM-DD); prefers the customer record. Drops rows with
    // no usable birthday date.
    const _dedupClientByBday = (rows) => {
        const seen = new Map();
        for (const p of (rows || [])) {
            const dob = p && p.date_of_birth || '';
            const md = (typeof dob === 'string' && dob.length >= 7 && dob[4] === '-') ? dob.slice(5, 10) : '';
            if (!md) continue;
            const key = `${String(p.full_name || '').trim().toLowerCase()}|${md}`;
            const prev = seen.get(key);
            if (!prev || (p.customer_since && !prev.customer_since)) seen.set(key, p);
        }
        return [...seen.values()];
    };
    // Cross-chunk helpers — defined in script-prospects.js, exported to window.app.
    const showAgentDetail        = (...a) => (window.app.showAgentDetail        || (() => Promise.resolve()))(...a);
    const showProspectsView      = (...a) => (window.app.showProspectsView      || (() => Promise.resolve()))(...a);
    const openAddCustomerModal   = (...a) => (window.app.openAddCustomerModal   || (() => {}))(...a);
    // ── Chunk-local: voice recording state ──
    let _mediaRecorder = null;
    let _audioChunks = [];
    let _recordingStartTime = null;
    let _recordingTimer = null;
    let _recordingStream = null;
    // Voice transcription is NOT wired to a real speech-to-text backend. The flag
    // stays false so processRecording() never fabricates random sample text and
    // saveTranscription() never persists un-transcribed placeholder notes. Flip to
    // true only once _audioChunks is actually sent to a transcription endpoint.
    const VOICE_TRANSCRIPTION_ENABLED = (typeof window !== 'undefined' && window._VOICE_TRANSCRIPTION_ENABLED === true);
    // ── Pull-to-refresh flag — consumed by Home/Calendar/People renders ──
    let _mobileForceFresh = false;
    // ==================== PHASE 14: CUSTOMER & AGENT NOTE HELPERS ====================

    const addCustomerNote = async (customerId) => {
        const text = document.getElementById('customer-note-text')?.value?.trim();
        if (!text) { UI.toast.error('Please enter a note'); return; }
        const currentUser = _state.cu;
        try {
            await AppDataStore.create('notes', {
                customer_id: customerId,
                text,
                author: currentUser?.full_name || 'System',
                date: _mLocalDate()
            });
            const _cnEl = document.getElementById('customer-note-text');
            if (_cnEl) _cnEl.value = '';
            UI.toast.success('Note added');
        } catch (e) { UI.toast.error('Failed to add note: ' + (e?.message || e)); return; }
        await (window.app.showCustomerDetail || (() => {}))(customerId);
    };

    const deleteCustomerNote = async (customerId, noteId) => {
        UI.confirm('Delete Note?', 'Are you sure?', async () => {
            try {
                await AppDataStore.delete('notes', noteId);
                UI.toast.success('Note deleted');
            } catch (e) { UI.toast.error('Failed to delete note: ' + (e?.message || e)); return; }
            await (window.app.showCustomerDetail || (() => {}))(customerId);
        });
    };

    const addAgentNote = async (agentId) => {
        const text = document.getElementById(`agent-note-text-${agentId}`)?.value?.trim();
        if (!text) { UI.toast.error('Please enter a note'); return; }
        const currentUser = _state.cu;
        try {
            await AppDataStore.create('notes', {
                agent_id: agentId,
                text,
                author: currentUser?.full_name || 'System',
                date: _mLocalDate()
            });
            const _anEl = document.getElementById(`agent-note-text-${agentId}`);
            if (_anEl) _anEl.value = '';
            UI.toast.success('Note added');
        } catch (e) { UI.toast.error('Failed to add note: ' + (e?.message || e)); return; }
        await (window.app.showAgentDetail || (() => {}))(agentId);
    };

    const deleteAgentNote = async (agentId, noteId) => {
        UI.confirm('Delete Note?', 'Are you sure?', async () => {
            try {
                await AppDataStore.delete('notes', noteId);
                UI.toast.success('Note deleted');
            } catch (e) { UI.toast.error('Failed to delete note: ' + (e?.message || e)); return; }
            await (window.app.showAgentDetail || (() => {}))(agentId);
        });
    };

    // ==================== PHASE 14: VOICE RECORDING FUNCTIONS ====================

    const openVoiceRecorder = async (targetElementId, entityType, entityId) => {
        window._voiceTarget = { elementId: targetElementId, entityType, entityId };

        // Save current modal HTML so we can restore it when voice recorder closes
        const overlay = document.getElementById('global-modal-overlay');
        window._prevModalState = (overlay && overlay.classList.contains('active')) ? overlay.innerHTML : null;

        const modalContent = `
            <div class="voice-recorder">
                <div class="mic-container">
                    <i class="fas fa-microphone" id="voice-mic-icon"></i>
                </div>

                <div class="recorder-controls">
                    <button class="btn primary btn-large" id="voice-record-btn" onclick="app.startRecording()">
                        <i class="fas fa-circle" style="color:#ef4444;"></i> RECORD
                    </button>
                    <button class="btn error btn-large" id="voice-stop-btn" style="display:none;" onclick="app.stopRecording()">
                        <i class="fas fa-stop"></i> STOP
                    </button>
                </div>

                <div class="recorder-timer" id="voice-timer">00:00</div>

                <div class="waveform-container" id="voice-waveform"></div>

                <div class="transcription-area">
                    <label>Transcribed Text:</label>
                    <textarea id="voice-transcribed-text" class="form-control" rows="5"
                        placeholder="Transcribed text will appear here..." readonly></textarea>
                </div>

                <div class="recorder-actions" id="voice-recorder-actions" style="display:none;">
                    <button class="btn primary" onclick="app.saveTranscription()">
                        <i class="fas fa-save"></i> Save Text
                    </button>
                    <button class="btn secondary" onclick="app.editTranscription()">
                        <i class="fas fa-edit"></i> Edit
                    </button>
                    <button class="btn secondary" onclick="app.discardRecording()">
                        <i class="fas fa-times"></i> Cancel
                    </button>
                    <button class="btn secondary" onclick="app.deleteAudio()">
                        <i class="fas fa-trash"></i> Delete Audio
                    </button>
                </div>

                <div style="margin-top:16px; text-align:right;">
                    <button class="btn secondary btn-sm" onclick="app.openVoiceSettings()">
                        <i class="fas fa-cog"></i> Settings
                    </button>
                </div>
            </div>
        `;

        UI.showModal('🎤 Voice Recording', modalContent, [
            { label: 'Close', type: 'secondary', action: 'app.closeVoiceRecorder()' }
        ]);

        // Override × button to restore previous modal instead of closing entirely
        const closeBtn = document.querySelector('#global-modal-overlay .modal-close');
        if (closeBtn) closeBtn.setAttribute('onclick', 'app.closeVoiceRecorder()');
    };

    const startRecording = async () => {
        try {
            if (!_recordingStream) {
                _recordingStream = await navigator.mediaDevices.getUserMedia({ audio: true });
            }

            _audioChunks = [];
            _mediaRecorder = new MediaRecorder(_recordingStream);

            _mediaRecorder.ondataavailable = (e) => { _audioChunks.push(e.data); };
            _mediaRecorder.onstop = async () => { await processRecording(); };
            _mediaRecorder.start();
            _recordingStartTime = Date.now();

            // Update UI
            const recordBtn = document.getElementById('voice-record-btn');
            const stopBtn = document.getElementById('voice-stop-btn');
            const micIcon = document.getElementById('voice-mic-icon');
            if (recordBtn) recordBtn.style.display = 'none';
            if (stopBtn) stopBtn.style.display = 'inline-flex';
            if (micIcon) micIcon.className = 'fas fa-microphone recording';

            // Start timer — clear any prior interval first so re-opening the
            // recorder and recording again can never orphan an earlier timer.
            if (_recordingTimer) { clearInterval(_recordingTimer); _recordingTimer = null; }
            _recordingTimer = setInterval(() => {
                const elapsed = Math.floor((Date.now() - _recordingStartTime) / 1000);
                const m = Math.floor(elapsed / 60).toString().padStart(2, '0');
                const s = (elapsed % 60).toString().padStart(2, '0');
                const timerEl = document.getElementById('voice-timer');
                if (timerEl) timerEl.textContent = `${m}:${s}`;
            }, 1000);

            // Start waveform — use CSS animation instead of JS interval to avoid layout thrashing
            const waveform = document.getElementById('voice-waveform');
            if (waveform) {
                waveform.innerHTML = Array.from({ length: 40 }, (_, i) =>
                    `<div class="waveform-bar" style="height:${Math.floor(Math.random() * 28) + 4}px; animation-delay:${(i * 0.05).toFixed(2)}s;"></div>`
                ).join('');
            }

        } catch (err) {
            console.error('Microphone error:', err);
            UI.toast.error('Could not access microphone. Please check permissions.');
        }
    };

    const stopRecording = () => {
        if (_mediaRecorder && _mediaRecorder.state === 'recording') {
            _mediaRecorder.stop();
        }
        if (_recordingStream) {
            _recordingStream.getTracks().forEach(t => t.stop());
            _recordingStream = null;
        }

        clearInterval(_recordingTimer);
        _recordingTimer = null;
        clearInterval(window._waveformInterval);
        window._waveformInterval = null;

        const stopBtn = document.getElementById('voice-stop-btn');
        const micIcon = document.getElementById('voice-mic-icon');
        if (stopBtn) stopBtn.style.display = 'none';
        if (micIcon) micIcon.className = 'fas fa-microphone processing';

        const transcribedEl = document.getElementById('voice-transcribed-text');
        if (transcribedEl) transcribedEl.placeholder = '⏳ Transcribing audio...';
    };

    const processRecording = async () => {
        const transcribedEl = document.getElementById('voice-transcribed-text');
        const micIcon = document.getElementById('voice-mic-icon');
        const actionsEl = document.getElementById('voice-recorder-actions');

        // No real speech-to-text backend is wired up. Do NOT fabricate transcription
        // text — let the user type the note manually instead of persisting random
        // sample text as a real customer note (data-integrity fix).
        if (!VOICE_TRANSCRIPTION_ENABLED) {
            if (micIcon) micIcon.className = 'fas fa-microphone';
            if (transcribedEl) {
                transcribedEl.value = '';
                transcribedEl.placeholder = 'Automatic transcription is not available yet — please type your note here.';
                transcribedEl.readOnly = false;
            }
            // Allow saving whatever the user typed manually.
            if (actionsEl) actionsEl.style.display = 'flex';
            UI.toast.error('Voice transcription is not available — type the note manually.');
            return;
        }

        // Real backend path: send the recorded audio for transcription. This branch
        // is inert until VOICE_TRANSCRIPTION_ENABLED is flipped on AND a real
        // transcription endpoint is implemented below.
        try {
            const blob = new Blob(_audioChunks, { type: 'audio/webm' });
            const transcribedText = await (window.app.transcribeAudio || (async () => { throw new Error('No transcription backend'); }))(blob);
            if (transcribedEl) { transcribedEl.value = transcribedText || ''; transcribedEl.placeholder = ''; }
            if (micIcon) micIcon.className = 'fas fa-microphone';
            if (actionsEl) actionsEl.style.display = 'flex';
            UI.toast.success('Transcription complete!');
        } catch (e) {
            if (micIcon) micIcon.className = 'fas fa-microphone';
            if (transcribedEl) { transcribedEl.placeholder = 'Transcription failed — please type your note here.'; transcribedEl.readOnly = false; }
            if (actionsEl) actionsEl.style.display = 'flex';
            UI.toast.error('Transcription failed: ' + (e?.message || e));
        }
    };

    const saveTranscription = async () => {
        const transcribedText = document.getElementById('voice-transcribed-text')?.value?.trim();
        if (!transcribedText) { UI.toast.error('No text to save'); return; }

        const target = window._voiceTarget || {};
        const targetEl = document.getElementById(target.elementId);

        if (targetEl && (targetEl.tagName === 'TEXTAREA' || targetEl.tagName === 'INPUT')) {
            // Directly insert into the target field
            const currentVal = targetEl.value;
            targetEl.value = currentVal ? currentVal + '\n' + transcribedText : transcribedText;
            closeVoiceRecorder();
            UI.toast.success('Voice text inserted');
        } else {
            // Create a note record — only report success (and close the modal)
            // when the write actually persisted.
            const ok = await createNoteFromVoice(target.entityType, target.entityId, transcribedText);
            if (!ok) return; // createNoteFromVoice already surfaced an error toast
            UI.hideModal();
            UI.toast.success('Voice note saved');
        }
    };

    const createNoteFromVoice = async (entityType, entityId, text) => {
        // Attribute to the CRM users-table row (mirrors addCustomerNote/addAgentNote);
        // Auth.getCurrentUser() returns the raw supabase auth user, which has no
        // top-level full_name, so it always fell back to 'System'.
        const currentUser = _state.cu;
        const noteData = {
            text,
            author: currentUser?.full_name || 'System',
            date: _mLocalDate(),
            is_voice_note: true
        };

        try {
            if (entityType === 'prospect') {
                noteData.prospect_id = entityId;
                await AppDataStore.create('notes', noteData);
                if (entityId) await (window.app.showProspectDetail || (() => {}))(entityId);
            } else if (entityType === 'customer') {
                noteData.customer_id = entityId;
                await AppDataStore.create('notes', noteData);
                if (entityId) await (window.app.showCustomerDetail || (() => {}))(entityId);
            } else if (entityType === 'agent') {
                noteData.agent_id = entityId;
                await AppDataStore.create('notes', noteData);
                if (entityId) await (window.app.showAgentDetail || (() => {}))(entityId);
            } else {
                await AppDataStore.create('notes', noteData);
            }
            return true;
        } catch (e) { UI.toast.error('Failed to save voice note: ' + (e?.message || e)); return false; }
    };

    const editTranscription = () => {
        const el = document.getElementById('voice-transcribed-text');
        if (el) { el.readOnly = false; el.focus(); }
    };

    const discardRecording = () => {
        // Clean up any ongoing recording
        if (_mediaRecorder && _mediaRecorder.state === 'recording') {
            _mediaRecorder.stop();
        }
        if (_recordingStream) { _recordingStream.getTracks().forEach(t => t.stop()); _recordingStream = null; }
        clearInterval(_recordingTimer); _recordingTimer = null;
        clearInterval(window._waveformInterval); window._waveformInterval = null;
        closeVoiceRecorder();
    };

    const closeVoiceRecorder = () => {
        // Stop any live recording + release the microphone/stream + clear the
        // timer so closing (not just Cancel) can never leave the mic hot or
        // orphan the 1s interval. Mirrors discardRecording's cleanup.
        try { if (_mediaRecorder && _mediaRecorder.state === 'recording') _mediaRecorder.stop(); } catch (_) { /* best-effort */ }
        if (_recordingStream) { try { _recordingStream.getTracks().forEach(t => t.stop()); } catch (_) {} _recordingStream = null; }
        if (_recordingTimer) { clearInterval(_recordingTimer); _recordingTimer = null; }
        if (window._waveformInterval) { clearInterval(window._waveformInterval); window._waveformInterval = null; }
        const overlay = document.getElementById('global-modal-overlay');
        if (overlay && window._prevModalState) {
            overlay.innerHTML = window._prevModalState;
            overlay.classList.add('active');
            window._prevModalState = null;
        } else {
            UI.hideModal();
        }
    };

    const deleteAudio = () => {
        _audioChunks = [];
        UI.toast.success('Audio file deleted');
    };

    const openVoiceSettings = () => {
        const saved = UserPreferences.getSync('voice_settings', {});
        const lang = saved.language || 'en';
        const quality = saved.quality || 'balanced';
        const deleteAudioPref = saved.deleteAudio !== false;

        const content = `
            <div class="voice-settings">
                <h4>Language</h4>
                <div class="radio-group">
                    <label><input type="radio" name="voice-language" value="en" ${lang === 'en' ? 'checked' : ''}> English</label>
                    <label><input type="radio" name="voice-language" value="zh" ${lang === 'zh' ? 'checked' : ''}> Chinese (Mandarin)</label>
                    <label><input type="radio" name="voice-language" value="ms" ${lang === 'ms' ? 'checked' : ''}> Malay</label>
                    <label><input type="radio" name="voice-language" value="yue" ${lang === 'yue' ? 'checked' : ''}> Cantonese</label>
                </div>

                <h4>Recognition Quality</h4>
                <div class="radio-group">
                    <label><input type="radio" name="voice-quality" value="fast" ${quality === 'fast' ? 'checked' : ''}> Fast (lower accuracy)</label>
                    <label><input type="radio" name="voice-quality" value="balanced" ${quality === 'balanced' ? 'checked' : ''}> Balanced</label>
                    <label><input type="radio" name="voice-quality" value="high" ${quality === 'high' ? 'checked' : ''}> High (slower, more accurate)</label>
                </div>

                <h4>Privacy</h4>
                <label class="checkbox-label"><input type="checkbox" id="voice-delete-audio" ${deleteAudioPref ? 'checked' : ''}> Delete audio immediately after transcription</label>
                <label class="checkbox-label"><input type="checkbox" id="voice-save-audio" ${saved.saveAudio ? 'checked' : ''}> Save audio for quality improvement</label>
            </div>
        `;

        UI.showModal('Voice Recognition Settings', content, [
            { label: 'Cancel', type: 'secondary', action: 'UI.hideModal()' },
            { label: 'Save Settings', type: 'primary', action: 'app.saveVoiceSettings()' }
        ]);
    };

    const saveVoiceSettings = async () => {
        const settings = {
            language: document.querySelector('input[name="voice-language"]:checked')?.value || 'en',
            quality: document.querySelector('input[name="voice-quality"]:checked')?.value || 'balanced',
            deleteAudio: document.getElementById('voice-delete-audio')?.checked ?? true,
            saveAudio: document.getElementById('voice-save-audio')?.checked ?? false
        };
        try {
            await UserPreferences.save('voice_settings', settings);
            UI.hideModal();
            UI.toast.success('Voice settings saved');
        } catch (e) { UI.toast.error('Failed to save settings: ' + (e?.message || e)); }
    };
    // Apply/remove body.is-mobile class and drive layout changes
    const applyMobileClass = () => {
        if (isMobile()) {
            document.body.classList.add('is-mobile');
        } else {
            document.body.classList.remove('is-mobile');
            closeMobileDrawer();
        }
    };

    // ── Side Drawer ──────────────────────────────────────────
    // #15 fix: added noticeboard, knowledge, ai-insights, security, admin-gated items
    // that were missing from DRAWER_SECTIONS — their perms entries were correct
    // but renderMobileDrawer iterates DRAWER_SECTIONS, so missing entries = invisible.
    const DRAWER_SECTIONS = [
        {
            title: 'Core CRM',
            items: [
                { view: 'calendar',             label: 'Calendar',                    icon: 'fas fa-calendar-alt' },
                { view: 'noticeboard',          label: '📢 公告栏',                    icon: 'fas fa-bullhorn' },
                { view: 'prospects',            label: 'Prospect / Customer',          icon: 'fas fa-users' },
                { view: 'referrals',            label: 'Referral Management',          icon: 'fas fa-project-diagram' },
                { view: 'pipeline',             label: 'Pipeline Management',          icon: 'fas fa-filter' },
                { view: 'promotions',           label: 'Monthly Promotion',            icon: 'fas fa-bullhorn' },
                { view: 'marketing_automation', label: 'Marketing Automation',         icon: 'fas fa-robot' },
                { view: 'milestones',           label: '增运九法',                     icon: 'fas fa-star' },
                { view: 'fude',                 label: '福运相随',                     icon: 'fas fa-yin-yang' },
                { view: 'cases',                label: 'Success Case Library',         icon: 'fas fa-book-open' },
                { view: 'purchases_history',    label: 'Purchases History',            icon: 'fas fa-receipt' },
            ]
        },
        {
            title: 'Consultant & Analytics',
            items: [
                { view: 'agents',       label: 'Consultant',              icon: 'fas fa-user-tie' },
                { view: 'performance',  label: 'Ranking Performance',     icon: 'fas fa-trophy' },
                { view: 'reports',      label: 'Reporting KPI',           icon: 'fas fa-chart-bar' },
                { view: 'risk',         label: 'Attrition Risk Analysis', icon: 'fas fa-exclamation-triangle' },
                { view: 'ai-insights',  label: 'AI Insights',             icon: 'fas fa-brain' },
                { view: 'security',     label: 'Security',                icon: 'fas fa-shield-halved' },
            ]
        },
        {
            title: 'Documents & Admin',
            items: [
                { view: 'documents',      label: 'Document Management', icon: 'fas fa-folder-open' },
                { view: 'knowledge',      label: 'Knowledge HQ',        icon: 'fas fa-brain' },
                { view: 'import',         label: 'Import / Export',     icon: 'fas fa-file-import' },
                { view: 'contracts',      label: 'Contracts',           icon: 'fas fa-file-contract' },
                { view: 'settings',       label: 'Settings',            icon: 'fas fa-cog' },
            ]
        },
        {
            title: 'Tools',
            items: [
                { view: 'protection',         label: 'Protection Monitor',  icon: 'fas fa-shield-alt' },
                { view: 'integrations',       label: 'Integrations',        icon: 'fas fa-plug' },
                { view: 'lead_forms',         label: 'Lead Capture Forms',  icon: 'fas fa-wpforms' },
                { view: 'surveys',            label: 'NPS Surveys',         icon: 'fas fa-poll' },
                { view: 'booking_settings',   label: 'Booking Scheduler',   icon: 'fas fa-calendar-check' },
                { view: 'egg_purchasing',     label: 'Egg Purchasing',      icon: 'fas fa-egg' },
                { view: 'formula_purchaser',  label: 'Formula Purchaser',   icon: 'fas fa-flask' },
                { view: 'stock_take',         label: 'Stock Take',          icon: 'fas fa-boxes' },
            ]
        },
    ];

    // Map drawer view names → nav ID suffix (only where they differ)
    const _drawerViewToNavId = { 'marketing_automation': 'marketing-automation', 'egg_purchasing': 'egg-purchasing', 'formula_purchaser': 'formula-purchaser', 'stock_take': 'stock-take', 'boss_report': 'boss-report' };

    // Returns the set of allowed nav IDs for the current user (mirrors updateNavVisibility logic)
    const _getAllowedNavIds = () => {
        // Agent band (L5-10) set — mirrors desktop _AGENT_NAV plus 'settings' (a mobile
        // drawer item). Knowledge HQ + Document Management dropped per the 2026 nav
        // curation (agents no longer see them); the desktop drawer order is by section.
        const _agentNav = ['calendar', 'fude', 'prospects', 'referrals', 'pipeline', 'promotions', 'cases', 'reports', 'milestones', 'settings'];
        const perms = {
            // #5 fix: added 'knowledge' to L1-L4 and 'noticeboard'/'knowledge' to match desktop levelPermissions
            1: ['calendar','prospects','referrals','pipeline','promotions','marketing-automation','marketing-lists','cases','purchases_history','agents','performance','reports','npo','risk','ai-insights','security','admin','protection','documents','knowledge','import','integrations','settings','fude','milestones','noticeboard','lead_forms','surveys','contracts','custom_fields','booking_settings','egg-purchasing','formula-purchaser','stock-take','org-chart'],
            2: ['calendar','prospects','referrals','pipeline','promotions','marketing-automation','marketing-lists','cases','agents','performance','reports','risk','ai-insights','security','admin','protection','documents','knowledge','import','integrations','settings','fude','milestones','noticeboard','lead_forms','surveys','contracts','custom_fields','booking_settings','org-chart'],
            3: ['calendar','prospects','referrals','pipeline','promotions','cases','performance','reports','protection','documents','knowledge','settings','fude'],
            4: ['calendar','prospects','referrals','pipeline','promotions','cases','performance','reports','protection','documents','knowledge','settings','fude'],
            5: _agentNav, 6: _agentNav, 7: _agentNav, 8: _agentNav, 9: _agentNav, 10: _agentNav,
            11: ['calendar','fude','prospects','referrals','pipeline','promotions','cases','milestones','settings'],
            // #6 fix: added 'noticeboard' to L12/L13/L14 (customers must reach Noticeboard on mobile)
            12: ['noticeboard','prospects','referrals','fude','milestones'],
            13: ['noticeboard','fude','milestones'],
            14: ['noticeboard','fude','milestones'],
            // Level 15 Stock Take Staff — per-store counter accounts that only
            // see the Stock Take tab. Inside the module they only get the
            // count / recount / summary sub-tabs (gated in showStockTakeView).
            15: ['stock-take'],
        };
        // Use the canonical role parser (_utils.getUserLevel / _getUserLevel in
        // script.js) instead of an inline regex/switch. The inline version had NO
        // case for the Chinese-only role names, so a customer (改命客户 = L13) or
        // referrer (准传福大使 = L14) fell through to the default L12 nav set and
        // saw forbidden tabs (prospects/referrals). The canonical parser resolves
        // Level-N strings, named roles AND the Chinese names identically to desktop.
        // perms has no key for an unmatched level (canonical returns 99) → the
        // `|| perms[12]` fallback preserves the previous null/unknown behavior.
        const level = getUserLevel(_state.cu);
        return new Set(perms[level] || perms[12]);
    };

    const renderMobileDrawer = () => {
        const body = document.getElementById('mobile-drawer-body');
        if (!body) return;

        const allowedIds = _getAllowedNavIds();

        let html = '';
        DRAWER_SECTIONS.forEach(section => {
            // Only include items the current user is allowed to see
            const visibleItems = section.items.filter(item => {
                const navId = _drawerViewToNavId[item.view] || item.view;
                return allowedIds.has(navId);
            });
            if (visibleItems.length === 0) return;

            html += `<div class="mobile-drawer-section-title">${section.title}</div>`;
            visibleItems.forEach(item => {
                const isActive = _state.cv === item.view ? ' active' : '';
                html += `
                    <button class="mobile-drawer-item${isActive}" onclick="app.navigateTo('${item.view}'); app.closeMobileDrawer()">
                        <i class="${item.icon}"></i>
                        <span>${item.label}</span>
                    </button>
                `;
            });
            html += `<div class="mobile-drawer-divider"></div>`;
        });

        body.innerHTML = html;

        // Sync footer user info
        const avatar = document.getElementById('drawer-user-avatar');
        const nameEl = document.getElementById('drawer-user-name');
        const roleEl = document.getElementById('drawer-user-role');
        if (_state.cu) {
            if (avatar) avatar.src = _state.cu.avatar_url || `https://ui-avatars.com/api/?name=${encodeURIComponent(_state.cu.full_name || 'U')}&background=8B0000&color=fff`;
            if (nameEl) nameEl.textContent = _state.cu.full_name || 'User';
            if (roleEl) roleEl.textContent = _state.cu.role || '—';
        }
    };

    const openMobileDrawer = () => {
        renderMobileDrawer();
        document.getElementById('mobile-drawer')?.classList.add('open');
        document.getElementById('mobile-drawer-overlay')?.classList.add('open');
        document.body.style.overflow = 'hidden';
    };

    const closeMobileDrawer = () => {
        document.getElementById('mobile-drawer')?.classList.remove('open');
        document.getElementById('mobile-drawer-overlay')?.classList.remove('open');
        document.body.style.overflow = '';
    };

    const toggleMobileNav = () => {
        const drawer = document.getElementById('mobile-drawer');
        if (drawer?.classList.contains('open')) {
            closeMobileDrawer();
        } else {
            openMobileDrawer();
        }
    };

    // ── Bottom Nav ───────────────────────────────────────────
    // Tab catalogue. '__home' is the synthetic mobile agent landing (not a real
    // nav permission); every other key is a navId checked against
    // _getAllowedNavIds() so a tab can never open a view the user can't access.
    const _BOTTOM_NAV_SPEC = {
        '__home':      { view: 'home',        icon: 'fas fa-house',           label: 'Home' },
        'calendar':    { view: 'calendar',    icon: 'far fa-calendar',        label: 'Calendar' },
        'prospects':   { view: 'prospects',   icon: 'fas fa-user-group',      label: 'Clients' },
        'referrals':   { view: 'referrals',   icon: 'fas fa-project-diagram', label: 'Referrals' },
        'fude':        { view: 'fude',        icon: 'fas fa-yin-yang',        label: '福运相随' },
        'milestones':  { view: 'milestones',  icon: 'fas fa-star',            label: '增运九法' },
        'noticeboard': { view: 'noticeboard', icon: 'fas fa-bullhorn',        label: '公告栏' },
        'reports':     { view: 'reports',     icon: 'fas fa-chart-column',    label: 'Insights' },
        'stock-take':  { view: 'stock_take',  icon: 'fas fa-boxes',           label: 'Stock Take' },
    };

    // Up-to-4 leading tabs (+ a trailing "More") for the current user. The agent
    // band (L1–L11, default view = home) keeps its historical bar byte-for-byte;
    // members / stock-take staff (L12–L15) get tabs drawn strictly from their
    // allowed nav set so nothing they tap bounces.
    const _bottomNavItemsFor = (user) => {
        if (_mobileDefaultView(user) === 'home') {
            // '__home' is synthetic (no nav permission); the rest must be gated
            // against the user's allowed nav set so a tab can never open a view
            // they can't access. L11 omits 'reports' (navigateTo would bounce it),
            // so it's dropped rather than left as a dead tab. L1–L10 keep the
            // historical bar byte-for-byte (all four are allowed for them).
            const allowed = _getAllowedNavIds();
            return ['__home', 'calendar', 'prospects', 'reports'].filter(id => id === '__home' || allowed.has(id));
        }
        const allowed = _getAllowedNavIds();
        const order = ['fude', 'prospects', 'referrals', 'milestones', 'noticeboard', 'stock-take', 'calendar', 'reports'];
        const picked = [];
        for (const navId of order) {
            if (picked.length >= 4) break;
            if (allowed.has(navId)) picked.push(navId);
        }
        return picked;
    };

    const renderMobileBottomNav = async () => {
        const itemsHtml = _bottomNavItemsFor(_state.cu).map(navId => {
            const s = _BOTTOM_NAV_SPEC[navId];
            if (!s) return '';
            return `
            <a class="mobile-bottom-nav-item" data-view="${s.view}" href="#" onclick="event.preventDefault(); app.navigateTo('${s.view}')">
                <i class="${s.icon}"></i><span>${s.label}</span>
            </a>`;
        }).join('');
        const moreHtml = `
            <a class="mobile-bottom-nav-item" id="mobile-more" href="#" onclick="event.preventDefault(); app.openMobileDrawer()">
                <i class="fas fa-ellipsis"></i><span>More</span>
            </a>`;
        // Rebuild in place (no singleton early-return) so a prior session's bar
        // never persists into the next account on a shared device.
        let bottomNav = document.getElementById('mobile-bottom-nav');
        if (!bottomNav) {
            bottomNav = document.createElement('div');
            bottomNav.className = 'mobile-bottom-nav';
            bottomNav.id = 'mobile-bottom-nav';
            document.body.appendChild(bottomNav);
        }
        bottomNav.innerHTML = itemsHtml + moreHtml;
        updateBottomNavActive(_state.cv);
    };

    const updateBottomNavActive = (viewId) => {
        // Calendar/month share the same tab; prospects + customers both highlight Clients.
        const tabFor = (v) => {
            if (v === 'home') return 'home';
            if (v === 'month' || v === 'calendar' || v === 'week' || v === 'day') return 'calendar';
            if (v === 'prospects' || v === 'customers') return 'prospects';
            if (v === 'referrals') return 'referrals';
            if (v === 'fude') return 'fude';
            if (v === 'milestones') return 'milestones';
            if (v === 'noticeboard') return 'noticeboard';
            if (v === 'reports') return 'reports';
            if (v === 'stock_take') return 'stock_take';
            return null;
        };
        const target = tabFor(viewId);
        document.querySelectorAll('.mobile-bottom-nav-item, .mobile-nav-item').forEach(el => el.classList.remove('active'));
        if (!target) return;
        document.querySelectorAll(`.mobile-bottom-nav-item[data-view="${target}"]`).forEach(el => el.classList.add('active'));
    };

    // Legacy — kept for any callers
    const showMobileMenu = () => openMobileDrawer();

    // ── Mobile Home dashboard ────────────────────────────────
    // AI Assistant landing for mobile users. Aggregates today's appointments,
    // pending follow-ups, birthdays and refill reminders into one card-based
    // view. Tablet/desktop continue to land on the calendar.
    const _mhomeIcon = (type) => {
        const t = String(type || '').toLowerCase();
        if (t.includes('whatsapp') || t.includes('call') || t.includes('phone')) return 'fab fa-whatsapp';
        if (t.includes('meeting') || t.includes('client') || t.includes('visit')) return 'fas fa-user-friends';
        return 'fas fa-clipboard-list';
    };
    const _mhomeEsc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
    const _mhomeInitials = (name) => {
        const parts = String(name || '').trim().split(/\s+/).slice(0, 2);
        return parts.map(p => p.charAt(0).toUpperCase()).join('') || '?';
    };
    const _mhomeWaPhone = (raw) => {
        const digits = String(raw || '').replace(/[^0-9+]/g, '').replace(/^\+/, '');
        if (!digits) return '';
        if (digits.startsWith('60')) return digits;
        if (digits.startsWith('0')) return '6' + digits;
        // Bare local number with the leading 0 dropped — a MY mobile is 1XXXXXXXX
        // (9–10 digits after the 0). Prefix the 60 country code so wa.me doesn't
        // interpret it against the wrong country.
        if (/^1\d{7,9}$/.test(digits)) return '60' + digits;
        return digits;
    };

    // Push channel for the full-JSX home body (SW-108, default-off). The JSX
    // island registers an `update(payload)` setter here on mount; the chunk's
    // progressive repaints push fresh plain payloads through it (React-state
    // re-render) instead of the by-id _composeBody innerHTML fill. The setter is
    // cleared on unmount/navigate. Only used when _reactHomeJsxOn() is true.
    let _mhomeJsxUpdate = null;
    const _mhomeJsxPush = (payload) => {
        try { if (typeof _mhomeJsxUpdate === 'function') _mhomeJsxUpdate(payload); } catch (_) { /* noop */ }
    };

    // React-island flag — DEFAULT-ON (parity-verified live, SW-82). Kill-switch:
    // window.__REACT_HOME=false | ?react_home=0 | localStorage crm_react_home='0'
    // (plus the global ?react=0 / crm_react_off='1').
    const _reactHomeOn = () => {
        try {
            if (/[?&]react=0/.test(location.search)) return false;
            if (localStorage.getItem('crm_react_off') === '1') return false;
            if (!(window.CRMReact && typeof window.CRMReact.mountMobileHome === 'function')) return false;
            if (window.__REACT_HOME === false) return false;
            if (/[?&]react_home=0/.test(location.search)) return false;
            if (localStorage.getItem('crm_react_home') === '0') return false;
            return true;
        } catch (_) { return false; }
    };

    // Full real-JSX render path for the mobile home body — DEFAULT-OFF opt-in
    // (SW-108). When ON, the #mhome-body content (greeting/snapshot cards/quick
    // actions) is rendered as real React JSX from a plain-serializable payload
    // instead of the by-id _composeBody innerHTML fill. Same idiom as the
    // existing flag: ?react_home_jsx=1 or localStorage crm_react_home_jsx==='1'.
    // Requires _reactHomeOn() (the JSX path only exists inside the island).
    const _reactHomeJsxOn = () => {
        try {
            if (!_reactHomeOn()) return false;
            if (/[?&]react_home_jsx=1/.test(location.search)) return true;
            if (localStorage.getItem('crm_react_home_jsx') === '1') return true;
            return false;
        } catch (_) { return false; }
    };

    const showMobileHomeView = async (viewport) => {
        if (!viewport) return;
        // L12–L15 (ambassador / customer / referrer / stock-take staff) have no
        // agent dashboard — if they reach the agent Home via hash/deep-link/back,
        // bounce them to their real landing (mirrors script.js _defaultViewFor).
        if (getUserLevel(_state.cu) >= 12) { await navigateTo(_mobileDefaultView(_state.cu)); return; }
        viewport.classList.add('mhome-active');

        // ── Perf instrumentation (mobile Home Tier 0) ────────────
        // Look for "[mhome-perf]" rows in the console to see where the cold
        // home load is spending time.
        const _mhomePerfT0 = performance.now();
        const _mhomePerf = (label) => {
            try { console.info(`[mhome-perf] ${label} +${Math.round(performance.now() - _mhomePerfT0)}ms`); } catch(_) { /* intentional: perf logging is best-effort */ }
        };
        _mhomePerf('mhome:start');

        const now = new Date();
        const hour = now.getHours();
        const greetWord = hour < 12 ? 'Good Morning' : hour < 18 ? 'Good Afternoon' : 'Good Evening';
        const fullName = _state.cu?.preferred_name || _state.cu?.full_name || 'there';
        const userName = String(fullName).split(' ')[0];
        const dateStr = now.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
        const avatarUrl = _state.cu?.avatar_url
            || `https://ui-avatars.com/api/?name=${encodeURIComponent(_state.cu?.full_name || 'U')}&background=8B0000&color=fff`;

        // Instant snapshot restore — localStorage persists across app close (8hr TTL).
        // User-scoped: the snapshot embeds the rendered home-dashboard HTML (people /
        // refill cards) for THIS user, so on a shared device it must not be served to
        // the next account (mirrors the other mhome-*-${uid} keys below).
        const _mhomeSnapKey = `mhome-snap-${String(_state.cu?.id || 'anon')}-${now.getFullYear()}-${now.getMonth()}-${now.getDate()}`;
        let _mhomeCached;
        try {
            const _snapRaw = localStorage.getItem(_mhomeSnapKey);
            if (_snapRaw) {
                const { ts, val } = JSON.parse(_snapRaw);
                if (Date.now() - ts < 8 * 60 * 60 * 1000) _mhomeCached = val;
                else localStorage.removeItem(_mhomeSnapKey);
            }
        } catch(_) { /* intentional: corrupt/missing snapshot falls back to scaffold */ }
        const _mhomeInitBody = _mhomeCached || `
                <div class="mhome-ai-card"><div class="mhome-ai-top" style="min-height:160px;">
                    <span class="mhome-arc"></span>
                    <span class="mhome-orb o1"></span><span class="mhome-orb o2"></span><span class="mhome-orb o3"></span>
                    <div class="mhome-ai-head">
                        <div class="mhome-ai-icon"><i class="fas fa-wand-magic-sparkles"></i></div>
                        <div><div class="mhome-ai-title">AI Assistant</div><div class="mhome-ai-sub">Loading today's snapshot…</div></div>
                    </div>
                </div></div>`;

        // Full-JSX home body opt-in (SW-108). Captured ONCE here so the choice
        // is stable across this view's async flow. When on, the island renders
        // the #mhome-body parts as real JSX from the pushed payload and we
        // suppress the by-id _composeBody innerHTML fills (the JSX owns the
        // body). When off — byte-for-byte the existing scaffold path.
        const _jsxOn = _reactHomeJsxOn();
        // Reset any prior registration so a stale unmounted setter never fires.
        _mhomeJsxUpdate = null;

        // React scaffold-shell — island renders greeting + #mhome-body (seeded
        // with the cached snapshot); the foreground fetch + _composeBody below
        // fill #mhome-body by id (after awaiting island useEffect-ready).
        if (_reactHomeOn()) {
            viewport.innerHTML = '<div id="mhome-react-root"></div>';
            let _hReady; const _hReadyP = new Promise(res => { _hReady = res; });
            const _hGuard = setTimeout(() => _hReady(), 4000);
            // Control channel for the JSX body — only populated when the opt-in
            // flag is on. registerUpdate lets the island hand us its setState so
            // progressive payloads re-render via React state; initBody is the
            // same loading-card HTML the off-path seeds, so the very first JSX
            // paint matches the scaffold's instant-restore.
            const _jsxData = _jsxOn ? {
                body: null,
                initBody: _mhomeInitBody,
                registerUpdate: (fn) => { _mhomeJsxUpdate = fn; },
                unregister: () => { _mhomeJsxUpdate = null; },
            } : undefined;
            try {
                window.CRMReact.mountMobileHome(document.getElementById('mhome-react-root'), {
                    greetWord, userName, dateStr, avatarUrl, initBody: _mhomeInitBody,
                    data: _jsxData,
                    onReady: () => { clearTimeout(_hGuard); _hReady(); },
                });
            } catch (e) {
                console.warn('[mhome] island mount failed, falling back to legacy:', e && e.message);
                clearTimeout(_hGuard); _hReady();
            }
            await _hReadyP;
        } else {
        viewport.innerHTML = `
        <div class="mhome">
            <div class="mhome-greet">
                <div class="mhome-greet-text">
                    <p class="mhome-greet-hi">${_mhomeEsc(greetWord)}, <span class="name">${_mhomeEsc(userName)}</span> <span class="wave">👋</span></p>
                    <div class="mhome-greet-date">${_mhomeEsc(dateStr)}</div>
                </div>
                <div class="mhome-greet-actions">
                    <div class="mhome-bell" onclick="app.toggleNotifPanel()" role="button" aria-label="Notifications">
                        <i class="far fa-bell"></i><span class="dot"></span>
                    </div>
                    <div class="mhome-avatar" onclick="app.openMobileDrawer()" role="button" aria-label="Profile" style="background-image:url('${_mhomeEsc(avatarUrl)}')"></div>
                </div>
            </div>
            <div id="mhome-body">${_mhomeInitBody}</div>
        </div>`;
        }

        // ── Data ─────────────────────────────────────────────────
        const todayStr = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`;
        const tom = new Date(now); tom.setDate(tom.getDate()+1);
        const mmdd = (d) => `${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
        const todayMD = mmdd(now);
        const tomMD = mmdd(tom);

        _mhomePerf('visibleIds:start');
        const visibleIds = (typeof getVisibleUserIds === 'function')
            ? await getVisibleUserIds(_state.cu).catch(() => 'all')
            : 'all';
        _mhomePerf('visibleIds:done');

        const actQueryOpts = {
            filters: { activity_date: todayStr },
            sort: 'start_time', sortDir: 'asc', limit: 50, offset: 0, countMode: null,
        };
        // NO client-side activity scoping — RLS activities_scoped_select is
        // authoritative and matches the desktop RPC. The old AND-filter here hid
        // all visibility='closed' client work (CALL/FTF/CPS default) from every
        // L3+ user's Home agenda (bug 2026-07-13; see Month view comment).
        // visibleIds stays resolved above for birthday/name scoping only.

        // 1-hour people cache — prospects+customers rarely change mid-session and
        // are only needed for birthday lookup + activity name display on this view.
        // Suffix every cache key with the current user id: the cached rows are
        // RLS/scope-filtered to the viewer, so a stale session-restore onto a
        // different profile must NOT surface the prior user's private data.
        const _mhomeUid = String(_state.cu?.id || 'anon');
        const _mhomePeopleKey = 'mhome-people-v1-' + _mhomeUid;
        const _mhomeLsGet = (key, ttl) => {
            try {
                const raw = localStorage.getItem(key);
                if (!raw) return null;
                const { ts, val } = JSON.parse(raw);
                if (Date.now() - ts > ttl) { localStorage.removeItem(key); return null; }
                return val;
            } catch(_) { return null; /* intentional: corrupt cache entry treated as miss */ }
        };
        const _mhomeLsSet = (key, val) => {
            try { localStorage.setItem(key, JSON.stringify({ ts: Date.now(), val })); } catch(_) { /* intentional: localStorage write is best-effort (quota/private mode) */ }
        };
        // Pull-to-refresh forces a one-time bypass of every cold cache below.
        const _mhomeForce = _mobileForceFresh; _mobileForceFresh = false;
        // Cold reference data (people/customers/users) is held for 8h and only
        // refetched when edited or force-refreshed — it's rarely reviewed anew.
        // Today's activities + drafts + refills stay hot (fetched fresh on load).
        let cachedPeople    = _mhomeForce ? null : _mhomeLsGet(_mhomePeopleKey,    8 * 60 * 60 * 1000);
        const _needPeople = !cachedPeople;

        const _mhomeDraftsKey     = 'mhome-drafts-v1-' + _mhomeUid;
        const _mhomeRefillsKey    = 'mhome-refills-v1-' + _mhomeUid;
        const _mhomeUsersKey      = 'mhome-users-v2-' + _mhomeUid; // v2: + ic_number,status for Team Birthdays (IC-derived DOB)
        const _mhomeCustomersKey  = 'mhome-customers-v1-' + _mhomeUid;
        let cachedDrafts     = _mhomeForce ? null : _mhomeLsGet(_mhomeDraftsKey,     5 * 60 * 1000);
        let cachedRefills    = _mhomeForce ? null : _mhomeLsGet(_mhomeRefillsKey,    5 * 60 * 1000);
        let cachedUsers      = _mhomeForce ? null : _mhomeLsGet(_mhomeUsersKey,      8 * 60 * 60 * 1000);
        let cachedCustomers  = _mhomeForce ? null : _mhomeLsGet(_mhomeCustomersKey,  8 * 60 * 60 * 1000);
        const _needDrafts    = !cachedDrafts;
        const _needRefills   = !cachedRefills;
        const _needUsers     = !cachedUsers;

        // ── Mobile Home Tier 1.1: foreground = TODAY only ────────
        // The cold foreground used to await activities + drafts + refills
        // + getAll('users') (full table). The users fetch alone is a 1-3 s
        // network round-trip on a slow phone — and it's only needed for the
        // birthday widget, which can fill in late without breaking anything.
        //
        // New shape: foreground awaits ONLY today's activities (small,
        // date-bounded). Drafts + refills + users fire in background; when
        // each arrives we save to the localStorage cache and trigger a
        // silent _composeBody repaint so the dashboard fills in
        // progressively instead of staying on "Loading…" until the slowest
        // call resolves.
        _mhomePerf('foreground:activities:start');
        const actResult = await AppDataStore.queryAdvanced('activities', actQueryOpts).catch(() => ({ data: [] }));
        _mhomePerf('foreground:activities:done');
        const activities = (actResult.data || []).filter(a => a.activity_type !== 'EVENT' && a.source !== 'birthday_auto');

        // Background data — repaint when each lands. The guard
        // (_state.cv === 'home') makes a stale repaint harmless if the
        // user has navigated away.
        const _mhomeRepaint = () => {
            if (_state.cv !== 'home') return;
            if (!document.getElementById('mhome-body')) return;
            _mhomePaint(cachedPeople || [], cachedUsers || [], cachedCustomers || [], !cachedPeople);
        };
        if (_needDrafts) {
            AppDataStore.query('follow_up_drafts', { status: 'pending' })
                .then(rows => { cachedDrafts = rows || []; _mhomeLsSet(_mhomeDraftsKey, cachedDrafts); _mhomePerf('bg:drafts:done'); _mhomeRepaint(); })
                .catch(() => {});
        }
        if (_needRefills) {
            AppDataStore.query('refill_reminders', { status: 'pending' })
                .then(rows => { cachedRefills = rows || []; _mhomeLsSet(_mhomeRefillsKey, cachedRefills); _mhomePerf('bg:refills:done'); _mhomeRepaint(); })
                .catch(() => {});
        }
        if (_needUsers) {
            // Trimmed select: only the columns this view actually reads
            // (full_name + dob for birthdays, role for "Agent" tag,
            // reporting_to + team_id for the visibleIds traversal that runs
            // on the next admin/lead navigation). 50× smaller payload than
            // getAll('users') on a wide users schema.
            AppDataStore.queryAdvanced('users', {
                select: 'id,full_name,date_of_birth,ic_number,role,reporting_to,team_id,phone,status',
                limit: 50000,
                countMode: null,
            }).then(r => r?.data || [])
              .then(rows => { cachedUsers = rows; _mhomeLsSet(_mhomeUsersKey, cachedUsers); _mhomePerf('bg:users:done'); _mhomeRepaint(); })
              .catch(() => {});
        }
        // Ensure downstream code that reads these never gets undefined.
        cachedDrafts  = cachedDrafts  || [];
        cachedRefills = cachedRefills || [];
        cachedUsers   = cachedUsers   || [];

        // ── Cadence generator on mobile (parity with the desktop calendar) ───────────────
        // The grade-driven follow-up dispatchers live in the calendar chunk and historically
        // ran ONLY on the desktop calendar load — so a phone-only agent never generated their
        // daily follow-ups. Run the same idempotent batch here (each dispatcher's per-agent caps
        // count existing pending drafts before creating, so re-running is self-bounding),
        // throttled to ~15 min/device, then re-fetch drafts + repaint so the curated list is
        // current. _state is the shared window._appState, so the dispatchers see the logged-in
        // agent. Best-effort — a failure leaves the home on its cached drafts.
        const _mhomeGenKey = 'mhome-cadence-gen-' + _mhomeUid;
        if (_mhomeForce || Date.now() - Number(localStorage.getItem(_mhomeGenKey) || 0) > 15 * 60 * 1000) {
            try { localStorage.setItem(_mhomeGenKey, String(Date.now())); } catch (_) {}
            (async () => {
                try {
                    await window._loadChunk('chunks/script-calendar.min.js');
                    const A = window.app || {};
                    const _disp = ['dispatchBirthdayTriggers', 'dispatchProactiveEventInvites', 'dispatchPendingSolutionReminders', 'dispatchReEngagementReminders', 'dispatchCustomerCheckins', 'dispatchApuAckTouches', 'dispatchAppointmentReminders', 'dispatchVoucherNudges'];
                    await Promise.allSettled(_disp.map(n => (typeof A[n] === 'function' ? A[n]() : Promise.resolve())));
                    const rows = await AppDataStore.query('follow_up_drafts', { status: 'pending' }).catch(() => null);
                    if (rows) { cachedDrafts = rows; _mhomeLsSet(_mhomeDraftsKey, cachedDrafts); }
                    _mhomeRepaint();
                } catch (_) { /* generator best-effort — home still shows cached drafts */ }
            })();
        }

        // Single source of truth for the dashboard HTML. Called once when the
        // people base is warm, or twice on a cold load (fast partial pass with
        // peoplePending=true, then a full pass from the background fetch).
        const _composeBody = (allPeople, cachedUsers, cachedCustomers, peoplePending) => {
        allPeople = allPeople || [];
        cachedUsers = cachedUsers || [];
        cachedCustomers = cachedCustomers || [];
        const _pendNum = '<i class="fas fa-spinner fa-spin" style="font-size:11px;opacity:.55"></i>';
        const personMap = new Map(allPeople.map(p => [String(p.id), p]));
        // Match the desktop follow-up predicate (script-calendar.js:1381): a draft
        // with a null agent_id is treated as belonging to the current user, so
        // null-owned/imported drafts are not hidden from non-admins.
        const _isMine = (d) => isSystemAdmin(_state.cu) || !d.agent_id || String(d.agent_id) === String(_state.cu?.id);
        // Curated via the shared desktop helper (composeFollowUpList) once the calendar chunk is
        // loaded — identical filter (pending + due<=today + non-expired-event + owned + not
        // unable_to_serve) + dedup to the desktop panel, so the count + list match (no more
        // uncapped, un-deduped "93"). Falls back to the lean filter on the first paint before the
        // chunk lands; the generator block above loads it and repaints.
        const _curate = (window.app && typeof window.app.composeFollowUpList === 'function') ? window.app.composeFollowUpList : null;
        const visibleDrafts = _curate
            ? _curate(cachedDrafts, allPeople, cachedCustomers, _state.cu?.id, isSystemAdmin(_state.cu))
            : cachedDrafts.filter(d => d.status === 'pending' && (d.due_date || '') <= todayStr && _isMine(d));
        // RBAC: client (prospect/customer) birthdays are scoped to the viewer's
        // visible agent set so agents don't see other agents' clients; colleague
        // (cachedUsers) birthdays stay visible to all as a team feature.
        const _bdayOwnerVisible = (ownerId) => {
            if (visibleIds === 'all') return true;
            if (!ownerId) return false;
            return Array.isArray(visibleIds) && visibleIds.some(id => String(id) === String(ownerId));
        };
        const _bdayMatch = (p) => {
            const dob = p.date_of_birth || '';
            if (!dob || dob.length < 5) return false;
            const md = dob.slice(5, 10);
            return md === todayMD || md === tomMD;
        };
        // Staff matcher derives MM-DD from IC when date_of_birth is absent, and
        // excludes inactive/expired staff + L13 customer / L14 referrer accounts
        // that also live in the users table.
        const _isStaffUser = (u) => {
            const st = String(u.status || '').toLowerCase();
            if (st === 'inactive' || st === 'expired') return false;
            let lvl = 12; try { lvl = getUserLevel(u); } catch (_) {}
            return lvl <= 12 || lvl === 15;
        };
        const _staffBdayMatch = (u) => { const md = _staffMD(u); return !!md && (md === todayMD || md === tomMD); };
        const birthdays = [
            ..._dedupClientByBday(allPeople.filter(p => _bdayMatch(p) && _bdayOwnerVisible(p.responsible_agent_id || p.lead_agent_id))),
            ..._dedupStaffByBday(cachedUsers.filter(_isStaffUser)).filter(_staffBdayMatch),
        ];
        const refills = cachedRefills;

        const apptCount = activities.length;
        const followCount = visibleDrafts.length;
        const bdayCount = peoplePending ? _pendNum : birthdays.length;
        const refillCount = refills.length;

        const oldestDraft = [...visibleDrafts].sort((a, b) => (a.due_date || '').localeCompare(b.due_date || ''))[0];
        const draftPerson = (d) => {
            if (!d) return null;
            if (d.prospect_id) return personMap.get(String(d.prospect_id));
            if (d.customer_id) return personMap.get(String(d.customer_id));
            return null;
        };
        const oldestPerson = draftPerson(oldestDraft);
        const suggestedName = oldestPerson?.full_name || (birthdays[0]?.full_name) || '—';
        const suggestedAction = oldestPerson
            ? `app.mhomeWa(${oldestPerson.id ?? 'null'}, '${UI.escJsAttr(oldestPerson.phone || '')}')`
            : (birthdays[0]
                ? `app.mhomeWa(${birthdays[0].id ?? 'null'}, '${UI.escJsAttr(birthdays[0].phone || '')}')`
                : `app.navigateTo('calendar')`);

        const scheduleRows = activities.slice(0, 4).map(a => {
            const personId = a.prospect_id || a.customer_id;
            const person = personId ? personMap.get(String(personId)) : null;
            const time = (a.start_time || '00:00').slice(0, 5);
            const title = a.activity_type || 'Activity';
            // M10 (audit): default render path — mask non-owned client names/notes
            // (mirrors the buildHomeIslandData site so the two stay at parity).
            const sub = _mcalOwned(a) ? (person ? person.full_name : (a.notes || a.title || '—')) : '—';
            return `
                <div class="mhome-sched-row" onclick="app.navigateTo('calendar')">
                    <div class="mhome-sched-time">${_mhomeEsc(time)}</div>
                    <div class="mhome-sched-text">
                        <div class="mhome-sched-t1">${_mhomeEsc(title)}</div>
                        <div class="mhome-sched-t2">${_mhomeEsc(sub)}</div>
                    </div>
                    <div class="mhome-sched-act"><i class="${_mhomeIcon(title)}"></i></div>
                </div>`;
        }).join('') || `<div class="mhome-sched-empty">No activities scheduled today.</div>`;

        // Days since last contact (best-effort using activity_date if a draft links to a person)
        const daysAgo = (dateLike) => {
            if (!dateLike) return null;
            const t = new Date(dateLike).getTime();
            if (isNaN(t)) return null;
            return Math.floor((Date.now() - t) / 86400000);
        };
        const _attBuild = () => {
            const rows = [];
            // The curated daily list, inline & front-and-centre: the first few "who to follow up
            // today" drafts (already deduped + capped upstream by the dispatchers), each with a
            // one-tap WhatsApp. The full list stays behind View All.
            const _reasonLabel = (t) => ({
                re_engagement: '该跟进了', cust_checkin: '老客户问候', apu_ack: '推荐名单致谢',
                appointment_reminder: '预约提醒', voucher_unredeemed: '电子券待使用', birthday: '生日祝福'
            }[t] || '跟进提醒');
            const _agentMap = new Map((cachedUsers || []).map(u => [String(u.id), u.full_name]));
            for (const fd of visibleDrafts.slice(0, 5)) {
                const fp = draftPerson(fd);
                const nm = fd.prospect_name || fp?.full_name || 'Unknown';
                const od = daysAgo(fd.due_date);
                const sub = (od != null && od > 0) ? `逾期 ${od} 天` : '今天';
                const phone = UI.escJsAttr(fp?.phone || fd.phone || '');
                const _pid = fp?.id ?? fd.prospect_id ?? fd.customer_id ?? null;
                const _isCust = !!fd.customer_id;
                const _agId = fp?.responsible_agent_id || fp?.lead_agent_id;
                const _agent = _agId ? (_agentMap.get(String(_agId)) || '') : '';
                rows.push(`
                <div class="mhome-att-row followup" id="mhome-fu-${fd.id}">
                    <div class="mhome-att-avatar">${_mhomeEsc(_mhomeInitials(nm))}</div>
                    <div class="mhome-att-text"${_pid != null ? ` style="cursor:pointer;" onclick="app.mcalOpenPerson('${_pid}', ${_isCust})"` : ''}>
                        <div class="mhome-att-name">${_mhomeEsc(nm)}${_agent ? ` <span style="font-size:10px;color:#9CA3AF;font-weight:400;">· ${_mhomeEsc(_agent)}</span>` : ''}</div>
                        <div class="mhome-att-need">${_mhomeEsc(_reasonLabel(fd.trigger_type))}</div>
                        <div class="mhome-att-sub">${_mhomeEsc(sub)}</div>
                    </div>
                    <button class="mhome-att-btn wa" onclick="event.stopPropagation();app.mhomeFollowupWa(${fd.id}, '${_pid}', '${phone}', ${_isCust})">
                        <i class="fab fa-whatsapp"></i> WhatsApp
                    </button>
                </div>`);
            }
            const bday = birthdays[0];
            if (bday) {
                const isToday = _staffMD(bday) === todayMD;
                const phone = UI.escJsAttr(bday.phone || '');
                const isAgent = !!bday.role;
                rows.push(`
                <div class="mhome-att-row birthday">
                    <div class="mhome-att-avatar"><i class="fas fa-gift"></i></div>
                    <div class="mhome-att-text">
                        <div class="mhome-att-name">${_mhomeEsc(bday.full_name || '—')}${isAgent ? ' <span style="font-size:10px;color:var(--gray-400);">Agent</span>' : ''}</div>
                        <div class="mhome-att-need">${isToday ? 'Birthday today' : 'Birthday tomorrow'}</div>
                        <div class="mhome-att-sub">Send your wishes</div>
                    </div>
                    <button class="mhome-att-btn wish" onclick="app.mhomeWa(${bday.id ?? 'null'}, '${phone}')">
                        <i class="fas fa-heart"></i> Send Wish
                    </button>
                </div>`);
            }
            if (rows.length === 0) return '';
            return `
            <div class="mhome-card">
                <div class="mhome-card-head">
                    <div class="mhome-card-title"><span class="ico purple"><i class="fas fa-list-check"></i></span> Today's Follow-ups</div>
                    <button class="mhome-card-link" onclick="app.mhomeOpenFollowups()">${visibleDrafts.length > 5 ? `View All (${visibleDrafts.length})` : 'View All'} ›</button>
                </div>
                ${rows.join('')}
            </div>`;
        };

        const overdueFollowups = visibleDrafts.filter(d => (d.due_date || '') < todayStr).length;

        // ── Compose body ─────────────────────────────────────────
        const body = document.getElementById('mhome-body');
        if (!body) return;
        // Track so we can save snapshot after render
        const _mhomeSaveSnap = (html) => { try { localStorage.setItem(_mhomeSnapKey, JSON.stringify({ ts: Date.now(), val: html })); } catch(_) { /* intentional: snapshot persistence is best-effort */ } };
        body.innerHTML = `
        <div class="mhome-ai-card">
            <div class="mhome-ai-top">
                <span class="mhome-arc"></span>
                <span class="mhome-orb o1"></span><span class="mhome-orb o2"></span><span class="mhome-orb o3"></span>
                <span class="mhome-ring r1"></span><span class="mhome-ring r2"></span>
                <span class="mhome-spk s1">✦</span><span class="mhome-spk s2">✧</span><span class="mhome-spk s3">✦</span>
                <span class="mhome-spk s4">✦</span><span class="mhome-spk s5">✧</span><span class="mhome-spk s6">✦</span><span class="mhome-spk s7">✧</span>
                <span class="mhome-dot d1"></span><span class="mhome-dot d2"></span><span class="mhome-dot d3"></span>
                <span class="mhome-cross c1">＋</span><span class="mhome-cross c2">＋</span>
                <div class="mhome-ai-head">
                    <div class="mhome-ai-icon"><i class="fas fa-wand-magic-sparkles"></i></div>
                    <div>
                        <div class="mhome-ai-title">AI Assistant</div>
                        <div class="mhome-ai-sub">Here's what's happening today.</div>
                    </div>
                </div>
                <div class="mhome-ai-stats">
                    <div class="mhome-ai-stat ais-red">
                        <div class="mhome-ai-stat-ico"><i class="far fa-calendar"></i></div>
                        <div class="mhome-ai-stat-num">${apptCount}</div>
                        <div class="mhome-ai-stat-lbl">Appointments</div>
                    </div>
                    <div class="mhome-ai-stat ais-purple">
                        <div class="mhome-ai-stat-ico"><i class="fas fa-check"></i></div>
                        <div class="mhome-ai-stat-num">${followCount}</div>
                        <div class="mhome-ai-stat-lbl">Follow-ups</div>
                    </div>
                    <div class="mhome-ai-stat ais-pink">
                        <div class="mhome-ai-stat-ico"><i class="fas fa-cake-candles"></i></div>
                        <div class="mhome-ai-stat-num">${bdayCount}</div>
                        <div class="mhome-ai-stat-lbl">Birthday</div>
                    </div>
                    <div class="mhome-ai-stat ais-wood">
                        <div class="mhome-ai-stat-ico"><i class="fas fa-prescription-bottle-medical"></i></div>
                        <div class="mhome-ai-stat-num">${refillCount}</div>
                        <div class="mhome-ai-stat-lbl">Refill Due</div>
                    </div>
                </div>
            </div>
            <div class="mhome-ai-bot">
                <div class="mhome-ai-bot-text">
                    <div class="mhome-ai-bot-l1">Suggested next action</div>
                    <div class="mhome-ai-bot-l2">${_mhomeEsc(suggestedName === '—' ? 'All caught up' : 'Follow up with ' + suggestedName)}</div>
                </div>
                <button class="mhome-ai-bot-btn" onclick="${suggestedAction}">
                    <i class="fab fa-whatsapp"></i> Send Message
                </button>
            </div>
        </div>

        <div class="mhome-card">
            <div class="mhome-card-head">
                <div class="mhome-card-title"><span class="ico"><i class="far fa-calendar"></i></span> Today's Schedule</div>
                <button class="mhome-card-link" onclick="app.navigateTo('calendar')">View Calendar ›</button>
            </div>
            <div class="mhome-sched">${scheduleRows}</div>
        </div>

        ${_attBuild()}

        <div class="mhome-tiles">
            <button class="mhome-tile red" onclick="app.mhomeOpenFollowups()">
                <div class="mhome-tile-ico"><i class="fas fa-user-clock"></i></div>
                <div class="mhome-tile-lbl">Overdue Follow-ups</div>
                <div class="mhome-tile-num">${overdueFollowups}</div>
                <div class="mhome-tile-arrow"><i class="fas fa-chevron-right"></i></div>
            </button>
            <button class="mhome-tile wood" onclick="app.mhomeOpenRefills()">
                <div class="mhome-tile-ico"><i class="fas fa-prescription-bottle-medical"></i></div>
                <div class="mhome-tile-lbl">Refills Due</div>
                <div class="mhome-tile-num">${refillCount}</div>
                <div class="mhome-tile-arrow"><i class="fas fa-chevron-right"></i></div>
            </button>
        </div>`;
        // Only persist a complete render — never cache the partial pending state.
        if (!peoplePending) _mhomeSaveSnap(body.innerHTML);
        }; // end _composeBody

        // ── Full-JSX payload builder (SW-108, default-off) ───────
        // Re-derives the SAME model _composeBody renders, but as a plain,
        // serializable object (numbers + strings + small arrays — NO HTML
        // strings, NO DOM, NO functions). The JSX island renders these parts
        // with React-state and wires interactions to window.app.* directly, so
        // text is auto-escaped by React (no _mhomeEsc here). Only invoked when
        // _jsxOn is true; never touches the DOM, so it cannot affect the
        // off-path. Mirrors _composeBody's derivation 1:1 for parity.
        const buildHomeIslandData = (allPeople, cachedUsers, cachedCustomers, peoplePending) => {
            allPeople = allPeople || [];
            cachedUsers = cachedUsers || [];
            cachedCustomers = cachedCustomers || [];
            const personMap = new Map(allPeople.map(p => [String(p.id), p]));
            // Match the desktop follow-up predicate (script-calendar.js:1381): a draft
        // with a null agent_id is treated as belonging to the current user, so
        // null-owned/imported drafts are not hidden from non-admins.
        const _isMine = (d) => isSystemAdmin(_state.cu) || !d.agent_id || String(d.agent_id) === String(_state.cu?.id);
            const _curate = (window.app && typeof window.app.composeFollowUpList === 'function') ? window.app.composeFollowUpList : null;
            const visibleDrafts = _curate
                ? _curate(cachedDrafts, allPeople, cachedCustomers, _state.cu?.id, isSystemAdmin(_state.cu))
                : cachedDrafts.filter(d => d.status === 'pending' && (d.due_date || '') <= todayStr && _isMine(d));
            const _bdayOwnerVisible = (ownerId) => {
                if (visibleIds === 'all') return true;
                if (!ownerId) return false;
                return Array.isArray(visibleIds) && visibleIds.some(id => String(id) === String(ownerId));
            };
            const _bdayMatch = (p) => {
                const dob = p.date_of_birth || '';
                if (!dob || dob.length < 5) return false;
                const md = dob.slice(5, 10);
                return md === todayMD || md === tomMD;
            };
            // Staff matcher: IC-derived MM-DD fallback + exclude inactive/expired
            // and L13 customer / L14 referrer accounts (see _composeBody).
            const _isStaffUser = (u) => {
                const st = String(u.status || '').toLowerCase();
                if (st === 'inactive' || st === 'expired') return false;
                let lvl = 12; try { lvl = getUserLevel(u); } catch (_) {}
                return lvl <= 12 || lvl === 15;
            };
            const _staffBdayMatch = (u) => { const md = _staffMD(u); return !!md && (md === todayMD || md === tomMD); };
            const birthdays = [
                ..._dedupClientByBday(allPeople.filter(p => _bdayMatch(p) && _bdayOwnerVisible(p.responsible_agent_id || p.lead_agent_id))),
                ..._dedupStaffByBday(cachedUsers.filter(_isStaffUser)).filter(_staffBdayMatch),
            ];
            const refills = cachedRefills;

            const apptCount = activities.length;
            const followCount = visibleDrafts.length;
            const refillCount = refills.length;

            const oldestDraft = [...visibleDrafts].sort((a, b) => (a.due_date || '').localeCompare(b.due_date || ''))[0];
            const draftPerson = (d) => {
                if (!d) return null;
                if (d.prospect_id) return personMap.get(String(d.prospect_id));
                if (d.customer_id) return personMap.get(String(d.customer_id));
                return null;
            };
            const oldestPerson = draftPerson(oldestDraft);
            const suggestedName = oldestPerson?.full_name || (birthdays[0]?.full_name) || '—';
            // Plain action descriptor — the JSX maps {kind} to a window.app.* call.
            let suggestedAction;
            if (oldestPerson) suggestedAction = { kind: 'wa', id: oldestPerson.id ?? null, phone: oldestPerson.phone || '' };
            else if (birthdays[0]) suggestedAction = { kind: 'wa', id: birthdays[0].id ?? null, phone: birthdays[0].phone || '' };
            else suggestedAction = { kind: 'nav', view: 'calendar' };

            const scheduleRows = activities.slice(0, 4).map(a => {
                const personId = a.prospect_id || a.customer_id;
                const person = personId ? personMap.get(String(personId)) : null;
                const time = (a.start_time || '00:00').slice(0, 5);
                const title = a.activity_type || 'Activity';
                // M10 (audit): only show the client name / raw notes for activities the
                // viewer owns (or is scoped to). RLS now returns same-team & open/public
                // rows the client-side scope filter used to clamp, so an ungated subtitle
                // would surface a peer's client name or note text. Non-owned → generic.
                const sub = _mcalOwned(a) ? (person ? person.full_name : (a.notes || a.title || '—')) : '—';
                return { time, title, sub, icon: _mhomeIcon(title) };
            });

            const daysAgo = (dateLike) => {
                if (!dateLike) return null;
                const t = new Date(dateLike).getTime();
                if (isNaN(t)) return null;
                return Math.floor((Date.now() - t) / 86400000);
            };
            // Curated "Today's Follow-ups" — mirror the legacy _attBuild: the first few due
            // drafts (deduped/capped upstream) with Chinese reason labels, plus a birthday.
            // Parity with the off-path so toggling the JSX flag never changes the layout.
            const _reasonLabel = (t) => ({
                re_engagement: '该跟进了', cust_checkin: '老客户问候', apu_ack: '推荐名单致谢',
                appointment_reminder: '预约提醒', voucher_unredeemed: '电子券待使用', birthday: '生日祝福'
            }[t] || '跟进提醒');
            const _agentMapJ = new Map((cachedUsers || []).map(u => [String(u.id), u.full_name]));
            const attention = [];
            for (const fd of visibleDrafts.slice(0, 5)) {
                const fp = draftPerson(fd);
                const nm = fd.prospect_name || fp?.full_name || 'Unknown';
                const od = daysAgo(fd.due_date);
                const _agId = fp?.responsible_agent_id || fp?.lead_agent_id;
                attention.push({
                    type: 'followup',
                    draftId: fd.id,
                    personId: fp?.id ?? fd.prospect_id ?? fd.customer_id ?? null,
                    isCustomer: !!fd.customer_id,
                    agent: _agId ? (_agentMapJ.get(String(_agId)) || '') : '',
                    initials: _mhomeInitials(nm),
                    name: nm,
                    need: _reasonLabel(fd.trigger_type),
                    sub: (od != null && od > 0) ? `逾期 ${od} 天` : '今天',
                    waId: fp?.id ?? null,
                    waPhone: fp?.phone || fd.phone || '',
                });
            }
            const bday = birthdays[0];
            if (bday) {
                const isToday = _staffMD(bday) === todayMD;
                attention.push({
                    type: 'birthday',
                    name: bday.full_name || '—',
                    isAgent: !!bday.role,
                    need: isToday ? 'Birthday today' : 'Birthday tomorrow',
                    sub: 'Send your wishes',
                    waId: bday.id ?? null,
                    waPhone: bday.phone || '',
                });
            }

            const overdueFollowups = visibleDrafts.filter(d => (d.due_date || '') < todayStr).length;

            return {
                peoplePending: !!peoplePending,
                stats: { apptCount, followCount, refillCount, bdayCount: birthdays.length },
                suggestedName,
                suggestedAction,
                scheduleRows,
                attention,
                tiles: { overdueFollowups, refillCount },
            };
        };

        // Single paint dispatcher. OFF (default): byte-for-byte the existing
        // _composeBody by-id fill. ON: build the plain payload and push it to
        // the JSX island via the registered React-state setter — never touches
        // #mhome-body, so the JSX-owned DOM is left intact. A build throw is
        // swallowed (ON path is best-effort) and the off-path is unaffected.
        const _mhomePaint = (allPeople, cachedUsers, cachedCustomers, peoplePending) => {
            if (_jsxOn) {
                try { _mhomeJsxPush(buildHomeIslandData(allPeople, cachedUsers, cachedCustomers, peoplePending)); } catch (_) { /* noop */ }
                return;
            }
            _composeBody(allPeople, cachedUsers, cachedCustomers, peoplePending);
        };

        if (cachedPeople) {
            // Warm base → render everything in one pass.
            _mhomePaint(cachedPeople, cachedUsers, cachedCustomers, false);
        } else {
            // ── Mobile Home Tier 1.2: paint NOW, fill people in async ──
            // Cold-base: previously we awaited two queryAdvanced round-trips
            // (refId prospects + refId customers) before the first paint,
            // adding ~500-1500 ms on a slow connection. Now we paint
            // immediately with an empty personMap, then trigger repaints as
            // each layer of person data lands — first the refId-scoped names
            // (cheap, only the people referenced today), then the full base
            // (for birthdays + inactive count).
            _mhomePaint([], cachedUsers, cachedCustomers || [], true);
            _mhomePerf('cold-paint:partial');

            // Background pass 1: just the people referenced by today's
            // activities + drafts. Fast — N is small (typically <50).
            (async () => {
                const refIds = new Set();
                activities.forEach(a => { if (a.prospect_id) refIds.add(a.prospect_id); if (a.customer_id) refIds.add(a.customer_id); });
                (cachedDrafts || []).forEach(d => { if (d.prospect_id) refIds.add(d.prospect_id); if (d.customer_id) refIds.add(d.customer_id); });
                if (!refIds.size) return;
                const idArr = [...refIds];
                const [pp, cc] = await Promise.all([
                    AppDataStore.queryAdvanced('prospects', { scopeField: 'id', scopeValues: idArr, select: 'id,full_name,phone,date_of_birth', countMode: null, limit: idArr.length }).catch(() => ({ data: [] })),
                    AppDataStore.queryAdvanced('customers', { scopeField: 'id', scopeValues: idArr, select: 'id,full_name,phone,date_of_birth', countMode: null, limit: idArr.length }).catch(() => ({ data: [] })),
                ]);
                const partialPeople = [...(pp.data || []), ...(cc.data || [])];
                _mhomePerf('cold-bg:refids:done');
                if (_state.cv === 'home' && document.getElementById('mhome-body')) {
                    _mhomePaint(partialPeople, cachedUsers, cachedCustomers || [], true);
                }
            })().catch(() => {});

            // Background pass 2: full prospect + customer base (used for the
            // accurate birthday count + inactive-client tile). Heavy on cold
            // boot, so we don't block any paint on it.
            (async () => {
                const [allP, allC] = await Promise.all([
                    AppDataStore.getAll('prospects').catch(() => []),
                    AppDataStore.getAll('customers').catch(() => []),
                ]);
                cachedPeople    = [...(allP || []), ...(allC || [])];
                cachedCustomers = allC || [];
                if (cachedPeople.length) {
                    _mhomeLsSet(_mhomePeopleKey,    cachedPeople);
                    _mhomeLsSet(_mhomeCustomersKey, cachedCustomers);
                }
                _mhomePerf('cold-bg:full:done');
                if (_state.cv === 'home' && document.getElementById('mhome-body')) {
                    _mhomePaint(cachedPeople, cachedUsers, cachedCustomers, false);
                }
            })().catch(() => {});
        }
    };

    // Quick handler — open WhatsApp for the given phone, or fall back to
    // navigating to the customer/prospect detail when no phone is on file.
    const mhomeWa = (id, phone, text) => {
        const num = _mhomeWaPhone(phone);
        if (num) {
            const _q = (typeof text === 'string' && text.length) ? `?text=${encodeURIComponent(text)}` : '';
            window.open(`https://wa.me/${num}${_q}`, '_blank', 'noopener');
        } else if (id) {
            // No usable phone → open the SPECIFIC record (id may be a prospect OR a
            // customer), not the generic Clients list. Resolve the entity type the
            // same way mcalOpenPerson does, and surface a toast either way.
            UI.toast.error('No phone number on file — opening profile.');
            mcalOpenPerson(id).catch(() => navigateTo('prospects').catch(() => {}));
        } else {
            UI.toast.error('No phone number on file.');
        }
    };

    // Animate a handled follow-up row out of whichever list it's in (home card or sheet),
    // then hide the home card if it has no rows left.
    const _mhomeDropFollowupRow = (draftId) => {
        const row = document.getElementById(`mhome-fu-${draftId}`) || document.getElementById(`followup-row-${draftId}`);
        if (!row) return;
        row.style.transition = 'opacity .3s ease, max-height .35s ease, padding .3s ease, margin .3s ease';
        row.style.opacity = '0'; row.style.maxHeight = '0'; row.style.paddingTop = '0'; row.style.paddingBottom = '0';
        row.style.marginTop = '0'; row.style.marginBottom = '0'; row.style.overflow = 'hidden';
        setTimeout(() => {
            const card = row.closest('.mhome-card');
            row.remove();
            if (card && !card.querySelector('.mhome-att-row')) card.style.display = 'none';
        }, 360);
    };
    // Follow-up WhatsApp — "contacted = handled". Opens the chat (sync, gesture-safe) using the
    // PERSON's phone (not the draft's, so it works offline + when the draft row is lean), marks
    // the draft status='sent' + advances the cadence clock (last_activity/contact_date=today so
    // re-engagement won't immediately re-fire), and drops the row from view. Replaces the
    // calendar-chunk app.sendFollowUpInvite call, which getById's the draft + needs draft.phone
    // (undefined/offline-fragile on mobile — the reported "icon not responding").
    const mhomeFollowupWa = (draftId, personId, phone, isCustomer) => {
        const num = _mhomeWaPhone(phone);
        if (num) window.open(`https://wa.me/${num}`, '_blank', 'noopener');
        else if (personId) { mcalOpenPerson(personId).catch(() => {}); }
        if (draftId == null) return;
        const today = _mhomeToday();
        AppDataStore.update('follow_up_drafts', draftId, { status: 'sent', updated_at: new Date().toISOString() }).catch(() => {});
        if (personId != null && personId !== 'null') {
            const tbl = isCustomer ? 'customers' : 'prospects';
            // Contacted = clock advances; for prospects also clear the re-engagement back-off
            // (desktop _logFollowUpContact parity) so the cadence resets cleanly.
            const patch = isCustomer ? { last_contact_date: today } : { last_activity_date: today, follow_mode: 'active', silence_count: 0 };
            AppDataStore.update(tbl, personId, patch).catch(() => {});
        }
        // Prune the just-sent draft from the Home drafts snapshot (mhome-drafts-v1-<uid>, 5-min
        // TTL) so it doesn't resurface on the next Home visit before the throttled re-query fires
        // — the DB row is already status='sent'; this keeps the cached list in step (audit fix).
        try {
            const _k = 'mhome-drafts-v1-' + String(_state.cu?.id || 'anon');
            const _raw = localStorage.getItem(_k);
            if (_raw) {
                const _o = JSON.parse(_raw);
                if (_o && Array.isArray(_o.val)) {
                    _o.val = _o.val.filter(d => String(d.id) !== String(draftId));
                    localStorage.setItem(_k, JSON.stringify(_o));
                }
            }
        } catch (_) { /* best-effort snapshot prune */ }
        _mhomeDropFollowupRow(draftId);
    };

    // ── Mobile dashboard tile sheets (SW-109) ────────────────────────────
    // The home quick-action tiles (Overdue Follow-ups / Refills Due /
    // Inactive Clients) previously all navigated to 'calendar'/'prospects'.
    // On mobile that's a dead end: the desktop follow-up + refill panels live
    // in the desktop calendar's DOM, which the custom mobile calendar never
    // renders — so the user saw a number but could never reach the list behind
    // it. These openers surface the real list in a bottom-sheet (UI.showModal
    // is sheet-styled on mobile) and reuse the calendar-chunk action handlers
    // verbatim, so Send / Mark-sent / Dismiss / WhatsApp behave identically.
    const _mhomeToday = () => {
        const d = new Date();
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    };
    const _mhomeOverlayOpen = () =>
        !!document.getElementById('global-modal-overlay')?.classList.contains('active');
    const _mhomeSheetScroll = (inner) =>
        `<div style="max-height:64vh;overflow-y:auto;-webkit-overflow-scrolling:touch;display:flex;flex-direction:column;gap:10px;padding:2px 2px 4px;">${inner}</div>`;
    const _mhomeSheetLoading =
        `<div style="padding:40px;text-align:center;color:var(--gray-400,#9ca3af);"><i class="fas fa-spinner fa-spin" style="font-size:20px;"></i></div>`;
    const _mhomeSheetEmpty = (icon, msg) =>
        `<div style="text-align:center;padding:38px 16px;color:var(--gray-500,#6b7280);">
            <div style="font-size:34px;margin-bottom:10px;opacity:.45;"><i class="${icon}"></i></div>
            <div style="font-size:14px;">${_mhomeEsc(msg)}</div>
        </div>`;
    const _mhomeSheetBtns = [{ label: 'Close', type: 'secondary', action: 'UI.hideModal()' }];

    // Overdue follow-up drafts — same predicate as the home tile count
    // (pending · due before today · owned by viewer). Rows carry the SAME
    // followup-row-${id} id the desktop panel uses, so the reused
    // markFollowUpSent / dismissFollowUp handlers animate them out in place.
    const mhomeOpenFollowups = async () => {
        UI.showModal('Overdue Follow-ups', _mhomeSheetLoading, _mhomeSheetBtns);
        try { await window._loadChunk('chunks/script-calendar.min.js'); } catch (_) { /* intentional: action handlers are guarded at call sites if chunk missing */ }
        let drafts = [], people = [], _sheetUsers = [];
        try {
            const [dR, pR, cR, uR] = await Promise.all([
                AppDataStore.query('follow_up_drafts', { status: 'pending' }).catch(() => []),
                AppDataStore.getAll('prospects').catch(() => []),
                AppDataStore.getAll('customers').catch(() => []),
                AppDataStore.getAll('users').catch(() => []),
            ]);
            drafts = dR || [];
            people = [...(pR || []), ...(cR || [])];
            _sheetUsers = uR || [];
        } catch (_) { /* intentional: per-query fallbacks keep empty defaults → empty sheet */ }
        if (!_mhomeOverlayOpen()) return; // user closed the sheet while it loaded
        const personMap = new Map(people.map(p => [String(p.id), p]));
        const _agentMap = new Map((_sheetUsers || []).map(u => [String(u.id), u.full_name]));
        const today = _mhomeToday();
        // null agent_id → treat as current user's (desktop parity, script-calendar.js:1381)
        const mine = (d) => isSystemAdmin(_state.cu) || !d.agent_id || String(d.agent_id) === String(_state.cu?.id);
        // Curated list via the shared desktop helper (loaded above): same filter + dedup as the
        // desktop panel, due<=today (today's full list incl. overdue — each row's label shows
        // "Due today" vs "N overdue"). Lean fallback if the helper isn't present.
        const _curate = (window.app && typeof window.app.composeFollowUpList === 'function') ? window.app.composeFollowUpList : null;
        const rows = _curate
            ? _curate(drafts, people, people, _state.cu?.id, isSystemAdmin(_state.cu))
            : drafts.filter(d => d.status === 'pending' && (d.due_date || '') < today && mine(d))
                    .sort((a, b) => (a.due_date || '').localeCompare(b.due_date || ''));
        if (!rows.length) {
            UI.showModal('Overdue Follow-ups', _mhomeSheetEmpty('fas fa-circle-check', 'All caught up — no overdue follow-ups.'), _mhomeSheetBtns);
            return;
        }
        const body = rows.map(d => {
            const person = d.prospect_id ? personMap.get(String(d.prospect_id)) : personMap.get(String(d.customer_id));
            const name = d.prospect_name || person?.full_name || 'Unknown';
            const days = Math.max(0, Math.round((new Date(today) - new Date(d.due_date)) / 86400000));
            const due = days <= 0 ? 'Due today' : `${days} day${days === 1 ? '' : 's'} overdue`;
            const _phone = UI.escJsAttr(person?.phone || d.phone || '');
            const _pid = person?.id ?? d.prospect_id ?? d.customer_id ?? null;
            const _isCust = !!d.customer_id;
            const _agId = person?.responsible_agent_id || person?.lead_agent_id;
            const _agent = _agId ? (_agentMap.get(String(_agId)) || '') : '';
            return `
            <div id="followup-row-${d.id}" style="display:flex;align-items:center;gap:12px;padding:12px;background:var(--gray-50,#f9fafb);border-radius:12px;border-left:4px solid #ef4444;transition:opacity .4s ease,max-height .4s ease;">
                <div style="width:38px;height:38px;border-radius:50%;background:#fee2e2;color:#b91c1c;display:flex;align-items:center;justify-content:center;font-weight:700;font-size:13px;flex-shrink:0;">${_mhomeEsc(_mhomeInitials(name))}</div>
                <div style="flex:1;min-width:0;${_pid != null ? 'cursor:pointer;' : ''}"${_pid != null ? ` onclick="app.mcalOpenPerson('${_pid}', ${_isCust})"` : ''}>
                    <div style="font-weight:600;font-size:14px;color:var(--gray-800,#1f2937);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${_mhomeEsc(name)}${_agent ? ` <span style="font-size:10px;color:#9CA3AF;font-weight:400;">· ${_mhomeEsc(_agent)}</span>` : ''}</div>
                    <div style="font-size:12px;color:#dc2626;font-weight:500;margin-top:2px;">${due}</div>
                </div>
                <div style="display:flex;gap:6px;flex-shrink:0;">
                    <button class="btn primary btn-sm" style="font-size:13px;padding:8px 12px;white-space:nowrap;" onclick="event.stopPropagation();app.mhomeFollowupWa(${d.id}, '${_pid}', '${_phone}', ${_isCust})" title="Send WhatsApp"><i class="fab fa-whatsapp"></i></button>
                    <button class="btn secondary btn-sm" style="font-size:13px;padding:8px 10px;" onclick="event.stopPropagation();app.markFollowUpSent ? app.markFollowUpSent(${d.id}) : UI.toast.error('Action unavailable — please retry.');" title="Mark as sent"><i class="fas fa-check"></i></button>
                    <button class="btn secondary btn-sm" style="font-size:13px;padding:8px 10px;" onclick="event.stopPropagation();app.dismissFollowUp ? app.dismissFollowUp(${d.id}) : UI.toast.error('Action unavailable — please retry.');" title="Dismiss"><i class="fas fa-times"></i></button>
                </div>
            </div>`;
        }).join('');
        // The curated list includes today's due items alongside overdue ones, so a flat
        // "N overdue" over-counts (mismatching the per-row "Due today" labels + the tile's
        // overdue badge). Split the header the same way each row is labelled.
        const _odCount = rows.filter(d => (d.due_date || '') < today).length;
        const _dtCount = rows.length - _odCount;
        const head = `<div style="font-size:13px;color:var(--gray-500,#6b7280);margin:0 2px 2px;">${_odCount} overdue${_dtCount ? ` · ${_dtCount} due today` : ''} · oldest first</div>`;
        UI.showModal('Overdue Follow-ups', _mhomeSheetScroll(head + body), _mhomeSheetBtns);
    };

    // Pending refill reminders — joins refill_reminders to the prospect/
    // customer for name + phone (mirrors the desktop renderRefillReminders
    // join). Non-admin agents only see reminders for their own clients.
    // Reuses sendRefillWhatsApp / viewRefillProspect from the calendar chunk.
    const mhomeOpenRefills = async () => {
        UI.showModal('Refills Due', _mhomeSheetLoading, _mhomeSheetBtns);
        try { await window._loadChunk('chunks/script-calendar.min.js'); } catch (_) { /* intentional: action handlers are guarded at call sites if chunk missing */ }
        let reminders = [], prospects = [], customers = [];
        try {
            const [rR, pR, cR] = await Promise.all([
                AppDataStore.query('refill_reminders', { status: 'pending' }).catch(() => []),
                AppDataStore.getAll('prospects').catch(() => []),
                AppDataStore.getAll('customers').catch(() => []),
            ]);
            reminders = rR || []; prospects = pR || []; customers = cR || [];
        } catch (_) { /* intentional: per-query fallbacks keep empty defaults → empty sheet */ }
        if (!_mhomeOverlayOpen()) return;
        const pMap = new Map(prospects.map(p => [String(p.id), p]));
        const cMap = new Map(customers.map(c => [String(c.id), c]));
        const isAdmin = isSystemAdmin(_state.cu);
        const myId = String(_state.cu?.id);
        const entityOf = (r) => r.prospect_id ? pMap.get(String(r.prospect_id)) : cMap.get(String(r.customer_id));
        const rows = reminders
            .map(r => ({ r, e: entityOf(r) }))
            .filter(({ e }) => {
                if (!e) return false;
                if (isAdmin) return true;
                const owner = e.responsible_agent_id || e.lead_agent_id;
                return owner && String(owner) === myId;
            })
            .sort((a, b) => (Number(a.r.days_until_finish) || 0) - (Number(b.r.days_until_finish) || 0));
        if (!rows.length) {
            UI.showModal('Refills Due', _mhomeSheetEmpty('fas fa-prescription-bottle-medical', 'No refills due right now.'), _mhomeSheetBtns);
            return;
        }
        const body = rows.map(({ r, e }) => {
            const name = e?.full_name || 'Unknown contact';
            const phone = e?.phone || '';
            const dleft = Number(r.days_until_finish);
            const days = !isNaN(dleft)
                ? (dleft < 0 ? `<span style="color:#dc2626;font-weight:600;">${Math.abs(dleft)}d overdue</span>`
                    : dleft === 0 ? `<span style="color:#dc2626;font-weight:600;">Due today</span>`
                    : `<span style="color:#d97706;font-weight:600;">${dleft}d left</span>`)
                : '';
            const sent = r.status === 'whatsapp_sent' ? ' <span style="background:#dcfce7;color:#15803d;padding:1px 6px;border-radius:6px;font-size:10px;">✓ Sent</span>' : '';
            return `
            <div style="display:flex;align-items:center;gap:12px;padding:12px;background:var(--gray-50,#f9fafb);border-radius:12px;border-left:4px solid #f59e0b;">
                <div style="flex:1;min-width:0;">
                    <div style="font-weight:600;font-size:14px;color:var(--gray-800,#1f2937);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${_mhomeEsc(name)}${sent}</div>
                    <div style="font-size:12px;color:var(--gray-600,#4b5563);margin-top:2px;">💊 ${_mhomeEsc(r.product_name || 'Product')}</div>
                    <div style="font-size:11px;margin-top:2px;">${days}</div>
                </div>
                <div style="display:flex;gap:6px;flex-shrink:0;">
                    <button class="btn primary btn-sm" style="font-size:13px;padding:8px 12px;" onclick="event.stopPropagation();app.sendRefillWhatsApp ? app.sendRefillWhatsApp(${r.id}) : UI.toast.error('Action unavailable — please retry.');" ${phone ? '' : 'disabled title="No phone number"'}><i class="fab fa-whatsapp"></i></button>
                    <button class="btn secondary btn-sm" style="font-size:13px;padding:8px 10px;" onclick="event.stopPropagation();app.viewRefillProspect ? (UI.hideModal(),app.viewRefillProspect(${r.prospect_id || 'null'}, ${r.customer_id || 'null'})) : UI.toast.error('Action unavailable — please retry.');" title="View profile"><i class="fas fa-user"></i></button>
                </div>
            </div>`;
        }).join('');
        const head = `<div style="font-size:13px;color:var(--gray-500,#6b7280);margin:0 2px 2px;">${rows.length} pending refill${rows.length === 1 ? '' : 's'}</div>`;
        UI.showModal('Refills Due', _mhomeSheetScroll(head + body), _mhomeSheetBtns);
    };

    // ── Mobile Calendar (month grid) ─────────────────────────
    // Custom mobile-only month-grid layout that matches the Home dashboard's
    // brand palette. Uses the same activity dataset as the desktop calendar.
    let _mcalYear = null;
    let _mcalMonth = null;
    let _mcalByDate = new Map();
    let _mcalPersonMap = new Map();
    // Cached getVisibleUserIds() result for the calendar surfaces, refreshed on
    // each month/range fetch. Lets _mcalOwned grant client-name visibility to a
    // team leader / manager whose downline includes the activity's lead agent —
    // mirroring the desktop _canViewEntityName gate. Stays null until first
    // resolved, in which case _mcalOwned falls back to strict owner/co-agent/admin.
    let _mcalVisibleScope = null;
    // id → agent full_name, used to label the responsible agent under each
    // birthday card in the day sheet. Held in memory only (never persisted) so
    // agent names can't leak across logins on a shared device.
    let _mcalUserMap = new Map();
    // Staff/colleague records (id, full_name, ic_number, date_of_birth, role,
    // team, phone) for the Team Birthday markers on the month grid + day sheet.
    // Held in memory; the WA button reads it live when a birthday card is tapped.
    let _mcalStaffList = [];
    // Pre-warmed birthday-poster image blobs, keyed by gender. The poster URLs
    // are admin-managed in Marketing ▸ Automation ▸ Birthday Posters (stored in
    // the automation_config singleton) so they can be refreshed every year with
    // no code change. We prefetch the images into blobs once per session so the
    // birthday WhatsApp button can copy the poster to the clipboard synchronously
    // inside the tap (mcalBirthdayWa: clipboard-write-then-open-chat) without an
    // await-to-fetch at tap time. male = navy poster, female = pink poster.
    let _mcalBdayBlob = { male: null, female: null };
    let _mcalBdayWarmed = false;
    // Clipboard image-write requires PNG on Chrome (image/jpeg throws). Normalize
    // any uploaded format → PNG at warm time (off the tap gesture). PNG passes
    // through untouched; decode failure falls back to the original blob.
    const _toPngBlob = (blob) => new Promise((resolve) => {
        if (!blob) return resolve(null);
        if (blob.type === 'image/png') return resolve(blob);
        try {
            const img = new Image();
            const u = URL.createObjectURL(blob);
            img.onload = () => {
                try {
                    const c = document.createElement('canvas');
                    c.width = img.naturalWidth; c.height = img.naturalHeight;
                    c.getContext('2d').drawImage(img, 0, 0);
                    c.toBlob(b => { URL.revokeObjectURL(u); resolve(b || blob); }, 'image/png');
                } catch (_) { URL.revokeObjectURL(u); resolve(blob); }
            };
            img.onerror = () => { URL.revokeObjectURL(u); resolve(blob); };
            img.src = u;
        } catch (_) { resolve(blob); }
    });
    const _mcalWarmBdayPosters = async () => {
        if (_mcalBdayWarmed) return;
        _mcalBdayWarmed = true;
        try {
            const rows = await AppDataStore.getAll('automation_config').catch(() => []);
            const cfg = (rows && rows[0]) || null;
            if (!cfg) { _mcalBdayWarmed = false; return; } // not configured yet — retry next load
            const _grab = (url, key) => {
                if (!url || _mcalBdayBlob[key]) return;
                fetch(url).then(r => r.ok ? r.blob() : null)
                    .then(b => b ? _toPngBlob(b) : null)
                    .then(b => { if (b && b.size) _mcalBdayBlob[key] = b; })
                    .catch(() => { /* intentional: poster fetch failed → birthday WA falls back to text-only */ });
            };
            _grab(cfg.birthday_poster_male_url, 'male');
            _grab(cfg.birthday_poster_female_url, 'female');
        } catch (_) { _mcalBdayWarmed = false; /* allow retry on a later load */ }
    };
    // Active calendar view: 'month' | 'week' | 'day' | 'agenda'. Month is the
    // default; the Week/Day/Agenda renderers (below) read & write these.
    // _mcalSelDate is the anchor day for the Week + Day views (a Date object,
    // local-midnight). It defaults to today the first time an alt view opens.
    let _mcalView = 'month';
    let _mcalSelDate = null;

    // SWR revalidate guard — last-revalidated timestamp per `${year}-${month}`.
    // Background refetch is skipped if the same month was revalidated < 30s ago,
    // which prevents render-loop ping-pong when the background fetch resolves
    // and triggers a re-render that would otherwise revalidate again.
    const _mcalLastRevalidatedAt = new Map();
    const _MCAL_REVALIDATE_TTL_MS = 30_000;

    // Optimistic-insert tracking — keyed by tmp id, value is the activity row
    // we inserted into the localStorage cache before the Supabase write
    // resolved. Used to swap the tmp id for the real id on success, or to
    // mark the row as failed-to-sync.
    const _mcalOptimisticRows = new Map();

    // Persistent retry queue for activity inserts that failed to reach
    // Supabase. Each entry: { tmpId, table, data, attempts, lastAttemptAt }.
    // Drained on page load, on `online` events, and on a slow backoff timer.
    const _MCAL_RETRY_QUEUE_KEY = 'mcal-retry-queue-v1';
    // In-flight guard: three triggers (5s timeout, 'online' event, 60s interval)
    // can fire _mcalDrainRetryQueue concurrently. Without this lock two drains
    // read the same pending entry and both call AppDataStore.create → duplicate
    // activity rows, plus racing _mcalRetryQueueWrite clobbers each other.
    let _mcalDraining = false;
    const _mcalRetryQueueRead = () => {
        try { return JSON.parse(localStorage.getItem(_MCAL_RETRY_QUEUE_KEY) || '[]'); } catch(_) { return []; /* intentional: corrupt queue treated as empty */ }
    };
    const _mcalRetryQueueWrite = (q) => {
        try { localStorage.setItem(_MCAL_RETRY_QUEUE_KEY, JSON.stringify(q)); } catch(_) { /* intentional: queue persistence is best-effort */ }
    };

    // Wipe persisted mobile snapshots/caches so the next render refetches.
    // Called on data mutations (create/edit/delete) — implements the
    // "cold data stays cached until edited" rule for Home + Calendar + Clients.
    // `prefixes` scopes WHICH caches to clear; omitting it clears everything
    // (used by pull-to-refresh). Scoping matters because the prospect/customer
    // base is expensive to refetch — an activity edit must NOT evict it.
    const _clearMobileSnapshots = (prefixes) => {
        const pfx = prefixes && prefixes.length ? prefixes : ['mcal-', 'mhome-', 'mp-list-snap-'];
        try {
            const toRemove = [];
            for (let i = 0; i < localStorage.length; i++) {
                const k = localStorage.key(i);
                if (!k) continue;
                // NEVER wipe the durable retry queue — it shares the 'mcal-' prefix
                // but holds offline/failed activity inserts that must survive
                // pull-to-refresh (which clears with the default prefix list).
                if (k === _MCAL_RETRY_QUEUE_KEY) continue;
                if (pfx.some(p => k.startsWith(p))) toRemove.push(k);
            }
            toRemove.forEach(k => { try { localStorage.removeItem(k); } catch(_) { /* intentional: per-key removal is best-effort */ } });
        } catch(_) { /* intentional: cache clear is best-effort (localStorage may be unavailable) */ }
    };
    const _mcalColorForType = (type) => {
        const t = String(type || '').toLowerCase();
        if (t.includes('birthday') || t.includes('all day') || t.includes('all-day')) return 'allday';
        if (t === 'event') return 'red';
        if (t.includes('client meeting') || t.includes('client mtg') || t.includes('meeting')) return 'red';
        if (t.includes('cps') || t.includes('consult') || t.includes('follow')) return 'purple';
        if (t.includes('team')) return 'pink';
        if (t.includes('review')) return 'peach';
        if (t.includes('training') || t.includes('product') || t.includes('workshop')) return 'green';
        const palette = ['red','purple','pink','peach','green'];
        let h = 0; for (let i = 0; i < t.length; i++) h = (h * 31 + t.charCodeAt(i)) | 0;
        return palette[Math.abs(h) % palette.length];
    };
    // Ownership gate — mirrors the desktop calendar (commits fa31e3b/3a75855).
    // Non-owners viewing another agent's public/open activity must NOT see the
    // client's name; they see the activity type instead.
    const _mcalOwned = (a) => {
        const cu = _state.cu;
        // cu?.id != null guard so a logged-out viewer can't self-match an
        // activity with no lead_agent_id via String(undefined)===String(undefined).
        if (isSystemAdmin(cu)
            || (cu?.id != null && a.lead_agent_id != null && String(a.lead_agent_id) === String(cu?.id))
            || (cu?.id != null && Array.isArray(a.co_agents) && a.co_agents.some(c => c.id != null && String(c.id) === String(cu?.id)))) {
            return true;
        }
        // Team leader / manager: the calendar fetch already scoped this row into
        // their view (lead_agent_id ∈ visibleIds), so the client name is theirs to
        // see. _mcalVisibleScope is the cached getVisibleUserIds() result ('all' or
        // an id array); null → not yet resolved, stay strict.
        if (_mcalVisibleScope === 'all') return true;
        if (Array.isArray(_mcalVisibleScope) && a.lead_agent_id != null) {
            const lid = String(a.lead_agent_id);
            return _mcalVisibleScope.some(id => String(id) === lid);
        }
        return false;
    };
    // Keep all non-event activities; keep events only when they have a
    // resolvable title (mirrors the desktop orphan-EVENT filter). Events used
    // to be excluded from the mobile calendar entirely, so they never appeared
    // on a phone even when marked Open — visibility scoping is already applied
    // by the fetch's scopeFields (lead ∈ visible OR visibility IN open/public).
    const _mcalKeepAct = (a) => a.activity_type !== 'EVENT' || !!(a.activity_title || a.event_title || a.title);
    const _mcalShortTitle = (a, personMap) => {
        // EVENT tiles show the event's own title (e.g. "AI 與 風水"), never a
        // client name — an event is a group activity with attendees, not a single
        // prospect/customer, so there's no name to leak.
        if (a.activity_type === 'EVENT') {
            return String(a.activity_title || a.event_title || a.title || 'Event');
        }
        const pid = a.prospect_id || a.customer_id;
        const person = pid ? personMap.get(String(pid)) : null;
        if (person?.full_name && _mcalOwned(a)) {
            const parts = String(person.full_name).split(/\s+/);
            return parts[0]; // first name fits the cell
        }
        const t = String(a.activity_type || a.title || 'Event');
        const w = t.split(/\s+/);
        return w.length >= 2 ? `${w[0]} ${w[1].charAt(0)}` : t;
    };

    // Crash breadcrumb (2026-07-13): every mobile-calendar call site swallows
    // rejections (.catch(() => {})), so a mid-render exception dies INVISIBLY —
    // the grid just stays blank with no console trace reachable on iOS
    // standalone. Wrap the real renderer: persist the last error to
    // localStorage (surfaced by /diag.html) and paint a visible notice in the
    // grid instead of silent emptiness. Rethrow is pointless (callers swallow).
    const showMobileCalendarView = async (viewport) => {
        try {
            return await _showMobileCalendarViewImpl(viewport);
        } catch (e) {
            try {
                localStorage.setItem('mcal-last-error', JSON.stringify({
                    ts: new Date().toISOString(),
                    msg: (e && e.message) || String(e),
                    stack: String((e && e.stack) || '').slice(0, 600),
                }));
            } catch (_) { /* best-effort breadcrumb */ }
            try { console.error('[mcal] month render crashed:', e); } catch (_) { /* noop */ }
            try {
                const g = document.getElementById('mcal-grid');
                if (g && !g.querySelector('.mcal-cell')) {
                    g.innerHTML = '<div style="grid-column:1/-1;padding:28px 14px;text-align:center;color:#b91c1c;font-size:13px;">' +
                        '⚠️ Calendar failed to draw.<br><span style="color:#6b7280">Pull down to retry, or open ☰ → 🩺 and send a screenshot.</span></div>';
                }
            } catch (_) { /* display best-effort */ }
        }
    };
    const _showMobileCalendarViewImpl = async (viewport) => {
        if (!viewport) return;
        viewport.classList.add('mcal-active');
        _mcalView = 'month';

        const todayD = new Date();
        if (_mcalYear == null) { _mcalYear = todayD.getFullYear(); _mcalMonth = todayD.getMonth(); }

        const firstDay = new Date(_mcalYear, _mcalMonth, 1);
        const daysInMonth = new Date(_mcalYear, _mcalMonth + 1, 0).getDate();
        const prevMonthLastDay = new Date(_mcalYear, _mcalMonth, 0).getDate();
        // Convert Sun=0..Sat=6 to Mon=0..Sun=6
        const startOffset = (firstDay.getDay() + 6) % 7;
        const monthName = firstDay.toLocaleDateString('en-US', { month: 'long' });

        const userName = (_state.cu?.preferred_name || _state.cu?.full_name || 'there').split(' ')[0];
        const avatarUrl = _state.cu?.avatar_url
            || `https://ui-avatars.com/api/?name=${encodeURIComponent(_state.cu?.full_name || 'U')}&background=8B0000&color=fff`;

        // ── Persistent cache helpers (survive tab-close unlike sessionStorage) ──
        const _lsGet = (key, ttl) => {
            try {
                const raw = localStorage.getItem(key);
                if (!raw) return null;
                const { ts, val } = JSON.parse(raw);
                if (Date.now() - ts > ttl) { localStorage.removeItem(key); return null; }
                return val;
            } catch(_) { return null; /* intentional: corrupt cache entry treated as miss */ }
        };
        const _lsSet = (key, val) => {
            try { localStorage.setItem(key, JSON.stringify({ ts: Date.now(), val })); } catch(_) { /* intentional: localStorage write is best-effort (quota/private mode) */ }
        };

        // A: Instant snapshot restore — 8hr TTL survives app close on Android
        const _mcalSnapKey = `mcal-snap-${_mcalYear}-${_mcalMonth}`;
        const _mcalCachedGrid   = _lsGet(_mcalSnapKey,           8 * 60 * 60 * 1000);
        const _mcalCachedComing = _lsGet(_mcalSnapKey + '-coming', 8 * 60 * 60 * 1000);
        const _mcalInitGrid = _mcalCachedGrid
            || Array.from({length: 42}).map(() => '<div class="mcal-cell muted"></div>').join('');

        viewport.innerHTML = `
        <div class="mcal">
            <div class="mcal-top">
                <div class="mcal-blossom"><span class="b1">🌸</span><span class="b2">🌸</span><span class="b3">🌸</span></div>
                <button class="mcal-burger" onclick="app.openMobileDrawer()" aria-label="Menu"><i class="fas fa-bars"></i></button>
                <div class="mcal-title-wrap">
                    <div class="mcal-title">
                        <button class="mcal-nav-btn" onclick="event.stopPropagation();app.mcalPrevMonth()" aria-label="Previous month" type="button"><i class="fas fa-chevron-left"></i></button>
                        <span class="mcal-title-text">${_mhomeEsc(monthName)} ${_mcalYear}</span>
                        <button class="mcal-nav-btn" onclick="event.stopPropagation();app.mcalNextMonth()" aria-label="Next month" type="button"><i class="fas fa-chevron-right"></i></button>
                    </div>
                    <div class="mcal-sub">Let's make today count, ${_mhomeEsc(userName)}! <span class="spk">✨</span></div>
                </div>
                <div class="mcal-actions">
                    <button class="mcal-search" onclick="(window._cmd=document.getElementById('cmdk-trigger'))&&_cmd.click()" aria-label="Search"><i class="fas fa-search"></i></button>
                    <div class="mcal-avatar" onclick="app.openMobileDrawer()" role="button" aria-label="Profile" style="background-image:url('${_mhomeEsc(avatarUrl)}')"></div>
                </div>
            </div>
            <div class="mcal-tabs">
                <button class="mcal-tab active" onclick="app.mcalTab('month', this)">Month</button>
                <button class="mcal-tab" onclick="app.mcalTab('week', this)">Week</button>
                <button class="mcal-tab" onclick="app.mcalTab('day', this)">Day</button>
                <button class="mcal-tab" onclick="app.mcalTab('list', this)">List</button>
            </div>
            <div class="mcal-filter-row">
                <button class="mcal-filter" onclick="app.mcalFilter()"><i class="fas fa-sliders"></i> All Events <i class="fas fa-chevron-down"></i></button>
                <div class="mcal-quick">
                    <button class="mcal-quick-btn wa" onclick="app.mcalWa()" aria-label="WhatsApp"><svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor" aria-hidden="true"><path d="M17.498 14.382c-.301-.15-1.767-.867-2.04-.966-.273-.101-.473-.15-.673.15-.197.295-.771.964-.944 1.162-.175.195-.349.21-.646.075-.3-.15-1.263-.465-2.403-1.485-.888-.795-1.484-1.77-1.66-2.07-.174-.3-.019-.465.13-.615.136-.135.301-.345.451-.523.146-.181.194-.301.297-.496.1-.21.049-.375-.025-.524-.075-.15-.672-1.62-.922-2.206-.24-.584-.487-.51-.672-.51-.172-.015-.371-.015-.571-.015-.2 0-.523.074-.797.359-.273.3-1.045 1.02-1.045 2.475s1.07 2.865 1.219 3.075c.149.195 2.105 3.195 5.1 4.485.714.3 1.27.48 1.704.629.714.227 1.365.195 1.88.121.574-.091 1.767-.721 2.016-1.426.255-.705.255-1.29.18-1.425-.074-.135-.27-.21-.57-.345m-5.446 7.443h-.016c-1.77 0-3.524-.48-5.055-1.38l-.36-.214-3.75.975 1.005-3.645-.239-.375a9.869 9.869 0 0 1-1.516-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 0 1 2.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0 0 12.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 0 0 5.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 0 0-3.48-8.413Z"/></svg></button>
                    <button class="mcal-quick-btn add" onclick="app.mcalAdd()" aria-label="Add activity" style="font-size:20px;line-height:1;">+</button>
                </div>
                <button class="mcal-today" onclick="app.mcalToday()">Today</button>
            </div>
            <div class="mcal-grid-wrap">
                <div class="mcal-dow"><span>MON</span><span>TUE</span><span>WED</span><span>THU</span><span>FRI</span><span>SAT</span><span>SUN</span></div>
                <div class="mcal-grid" id="mcal-grid">
                    ${_mcalInitGrid}
                </div>
            </div>
            <div id="mcal-coming-host">${_mcalCachedComing || ''}</div>
        </div>`;

        // ── Perf instrumentation (mobile Tier 0) ─────────────────
        // Look for "[mcal-perf]" rows in the console to see where the cold
        // mobile load is spending time.
        const _mcalPerfT0 = performance.now();
        const _mcalPerf = (label) => {
            try { console.info(`[mcal-perf] ${label} +${Math.round(performance.now() - _mcalPerfT0)}ms`); } catch(_) { /* intentional: perf logging is best-effort */ }
        };
        _mcalPerf('mcal:start');

        // ── Fetch month activities + supporting data ─────────────
        const monthStartStr = `${_mcalYear}-${String(_mcalMonth+1).padStart(2,'0')}-01`;
        const monthEndStr = `${_mcalYear}-${String(_mcalMonth+1).padStart(2,'0')}-${String(daysInMonth).padStart(2,'0')}`;

        // Strategy: cache-first instant paint + background full-month revalidate.
        //   - Past months are immutable → cache only, no network.
        //   - Current/future months → render cache instantly, then quietly refetch
        //     the FULL month in the background and re-render if anything differs.
        //     This catches activities added from other devices/sessions without
        //     making the user wait. Saves done in this session use the optimistic
        //     insert path (see _mcalOptimisticInsert below) so they appear instantly.
        const _fmtD = (d) => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
        const _todayStr = _fmtD(todayD);
        const _isPastMonth = monthEndStr < _todayStr;

        // Pull-to-refresh forces a full refetch once.
        const _forceFresh = _mobileForceFresh; _mobileForceFresh = false;

        // Persistent raw-activity cache for this month (no TTL — until edited).
        const _mcalActsKey = `mcal-acts-${_mcalYear}-${_mcalMonth}`;
        const _lsGetRaw = (key) => { try { const r = localStorage.getItem(key); if (!r) return null; return JSON.parse(r).val; } catch(_) { return null; /* intentional: corrupt cache entry treated as miss */ } };
        const _cachedActs = _forceFresh ? null : _lsGetRaw(_mcalActsKey);

        // Start visibleIds resolution early (non-blocking) so it runs
        // concurrently with cache reads below.
        const _visibleIdsP = (typeof getVisibleUserIds === 'function')
            ? getVisibleUserIds(_state.cu).catch(() => 'all') : Promise.resolve('all');

        // B: Serve prospects + customers from localStorage cache (cold reference
        // data — birthdays/names rarely change; invalidated on edit).
        const _PEOPLE_KEY  = 'mcal-people-v5'; // v5: + customer_since (customers) so _dedupClientByBday's prefer-customer tie-break works; v4: + gender for the gendered birthday poster (v3: phone for birthday WhatsApp greeting; v2: responsible_agent_id for RBAC birthday scoping)
        const _DRAFTS_KEY  = 'mcal-drafts-v1';
        const _REFILLS_KEY = 'mcal-refills-v1';
        let allPeople     = _forceFresh ? null : _lsGet(_PEOPLE_KEY,  8 * 60 * 60 * 1000);
        let cachedDrafts  = _forceFresh ? null : _lsGet(_DRAFTS_KEY,   5 * 60 * 1000);
        let cachedRefills = _forceFresh ? null : _lsGet(_REFILLS_KEY,  5 * 60 * 1000);
        const _needPeople  = !allPeople;
        const _needDrafts  = !cachedDrafts;
        const _needRefills = !cachedRefills;

        const visibleIds = await _visibleIdsP;
        _mcalVisibleScope = visibleIds;

        // RBAC: birthday grid markers + the coming-up count are scoped to the
        // viewer's visible agent set so agents don't see other agents' clients'
        // birthdays. Admins / marketing (visibleIds === 'all') see everything.
        const _mcalBdayOwnerVisible = (ownerId) => {
            if (visibleIds === 'all') return true;
            if (!ownerId) return false;
            return Array.isArray(visibleIds) && visibleIds.some(id => String(id) === String(ownerId));
        };

        // NO client-side activity scoping: the activities_scoped_select RLS policy
        // is authoritative and matches the desktop get_calendar_window RPC exactly
        // (own + subtree + co-agent rows at ANY visibility, plus open/public and
        // same-team-chain rows). The old client filter here ANDed
        // `lead_agent_id IN subtree` with `visibility IN (open,public,team)` —
        // strictly narrower than RLS — which hid ALL ordinary client work
        // (CALL/FTF/CPS default to visibility 'closed') from every L3+ user and
        // left team leaders staring at an empty month (bug 2026-07-13). The
        // server cannot return anything RLS forbids, so no filter is needed.
        const _scopeFields = null;
        // gte/lte range replaces 31-item IN list — faster Postgres plan
        const _buildActOpts = (gteStr, lteStr) => {
            const o = { gte: { activity_date: gteStr }, lte: { activity_date: lteStr }, sort: 'start_time', sortDir: 'asc', limit: 1000, offset: 0, countMode: null };
            if (_scopeFields) o.scopeFields = _scopeFields;
            return o;
        };

        // Decide what to fetch RIGHT NOW (blocking) vs. what to revalidate
        // in the background (non-blocking).
        //   - past month + cache → render cache, no network at all
        //   - any month + cache (not forced) → render cache instantly, refetch
        //     full month in background; if data differs, silently re-render
        //   - no cache or forced → must block on a full month fetch
        let _actMode, _actsP, _shouldRevalidate = false;
        if (_isPastMonth && _cachedActs && !_forceFresh) {
            _actMode = 'cache';
            _actsP = Promise.resolve(null);
        } else if (_cachedActs && !_forceFresh) {
            _actMode = 'cache';
            _actsP = Promise.resolve(null);
            _shouldRevalidate = true;
        } else {
            _actMode = 'full';
            _actsP = AppDataStore.queryAdvanced('activities', _buildActOpts(monthStartStr, monthEndStr)).catch(() => ({ data: [], _degraded: true }));
        }

        // ── Mobile Tier 1.1: decouple people / drafts / refills ──
        // Phase 1 (blocking): activities only. Drives the calendar grid —
        // this is what the user is staring at. Even with no people data,
        // activity cards still render via _mcalShortTitle's fallback to
        // activity_type.
        _mcalPerf('phase1:activities:start');
        const actResult = await _actsP;
        _mcalPerf('phase1:activities:done');

        // Phase 2 (fire-and-forget): people / drafts / refills.
        // These power person-names on cards, the birthday markers, and the
        // "Coming up" strip. On cold load they're missing — first paint
        // falls back gracefully — then when they land we silently re-render.
        // Trimmed select() shrinks the wire payload 5-10× vs. getAll() for
        // wide prospect/customer schemas.
        const _capturedYearMcal = _mcalYear, _capturedMonthMcal = _mcalMonth;
        if (_needPeople || _needDrafts || _needRefills) {
            Promise.all([
                _needPeople  ? AppDataStore.queryAdvanced('prospects', { select: 'id,full_name,date_of_birth,responsible_agent_id,phone,gender', limit: 50000, countMode: null }).then(r => r?.data || []).catch(() => []) : Promise.resolve(null),
                _needPeople  ? AppDataStore.queryAdvanced('customers', { select: 'id,full_name,date_of_birth,responsible_agent_id,phone,gender,customer_since', limit: 50000, countMode: null }).then(r => r?.data || []).catch(() => []) : Promise.resolve(null),
                _needDrafts  ? AppDataStore.getAll('follow_up_drafts').catch(() => []) : Promise.resolve(null),
                _needRefills ? AppDataStore.query('refill_reminders', { status: 'pending' }).catch(() => []) : Promise.resolve(null),
            ]).then(([p, c, d, r]) => {
                _mcalPerf('phase2:people-drafts-refills:done');
                if (p !== null || c !== null) {
                    // Tag each row with its source table so birthday actions can
                    // resolve the correct FK target instead of probing by ambiguous
                    // (overlapping) id — customers get _isCustomer:true.
                    const fresh = [...(p || []), ...((c || []).map(x => ({ ...x, _isCustomer: true })))];
                    _lsSet(_PEOPLE_KEY, fresh);
                }
                if (d !== null) _lsSet(_DRAFTS_KEY,  d);
                if (r !== null) _lsSet(_REFILLS_KEY, r);
                // Silent re-render so names + birthdays + coming-up strip
                // fill in. Guarded so we don't repaint a month the user has
                // already swiped away from.
                const vp = document.getElementById('content-viewport');
                if (vp && vp.classList.contains('mcal-active') && _mcalView === 'month' &&
                    _capturedYearMcal === _mcalYear && _capturedMonthMcal === _mcalMonth) {
                    showMobileCalendarView(vp).catch(() => {});
                }
            }).catch(() => {});
        }

        // Agent-name lookup for the day sheet's birthday cards. Seed instantly
        // from the Home users cache when it's warm; otherwise fetch a trimmed
        // (id, full_name) user list in the background. The day sheet reads
        // _mcalUserMap live when tapped, so no re-render is needed here.
        if (_mcalUserMap.size === 0) {
            const _homeUsers = _lsGet('mhome-users-v2-' + String(_state.cu?.id || 'anon'), 8 * 60 * 60 * 1000);
            if (Array.isArray(_homeUsers) && _homeUsers.length) {
                _mcalUserMap = new Map(_homeUsers.filter(u => u && u.full_name).map(u => [String(u.id), u.full_name]));
            } else {
                AppDataStore.queryAdvanced('users', { select: 'id,full_name', limit: 50000, countMode: null })
                    .then(r => r?.data || [])
                    .then(rows => { _mcalUserMap = new Map((rows || []).filter(u => u && u.full_name).map(u => [String(u.id), u.full_name])); })
                    .catch(() => { /* intentional: agent-name line degrades to hidden */ });
            }
        }

        // Team Birthdays: staff/colleague records for the month-grid markers +
        // day-sheet cards. Visible to ALL staff (team feature, not RBAC-scoped),
        // excludes inactive/expired staff + L13 customer / L14 referrer accounts.
        // Birthday MM-DD comes from date_of_birth or, failing that, the IC number
        // (see _staffMD). Cached so swiping months doesn't refetch.
        {
            const _STAFF_KEY = 'mcal-staff-v1';
            const _isStaffUser = (u) => {
                const st = String(u.status || '').toLowerCase();
                if (st === 'inactive' || st === 'expired') return false;
                let lvl = 12; try { lvl = getUserLevel(u); } catch (_) {}
                return lvl <= 12 || lvl === 15;
            };
            const _cachedStaff = _lsGet(_STAFF_KEY, 8 * 60 * 60 * 1000);
            if (Array.isArray(_cachedStaff)) {
                _mcalStaffList = _dedupStaffByBday(_cachedStaff);
            } else {
                AppDataStore.queryAdvanced('users', { select: 'id,full_name,date_of_birth,ic_number,role,team,phone,status', limit: 50000, countMode: null })
                    .then(r => r?.data || [])
                    .then(rows => {
                        _mcalStaffList = _dedupStaffByBday((rows || []).filter(_isStaffUser));
                        _lsSet(_STAFF_KEY, _mcalStaffList);
                        // Re-render so staff markers appear once the list lands (guarded
                        // to the still-current month, mirrors the people refetch above).
                        const vp = document.getElementById('content-viewport');
                        if (vp && vp.classList.contains('mcal-active') && _mcalView === 'month') {
                            showMobileCalendarView(vp).catch(() => {});
                        }
                    })
                    .catch(() => { /* intentional: team birthdays degrade to hidden */ });
            }
        }

        // Pre-warm the gendered birthday posters so the day-sheet WhatsApp button
        // can share the image file synchronously inside the tap.
        _mcalWarmBdayPosters();

        // First-paint fallbacks: ensure downstream code handles missing data
        // without throwing. On cold load these are empty; the Phase 2 re-render
        // swaps in real values.
        allPeople     = allPeople     || [];
        cachedDrafts  = cachedDrafts  || [];
        cachedRefills = cachedRefills || [];
        const draftsR  = cachedDrafts;
        const refillsR = cachedRefills;

        // Resolve this month's activity set from cache or fresh fetch.
        // Dead-session guard: without a live local token, queryAdvanced resolves
        // from the local snapshot fallback (or an anon RLS empty read) — that
        // result is NOT the truth and must never be persisted. mcal-acts has no
        // TTL, so caching a dead-session [] kept the month empty even after a
        // fresh login (bug 2026-07-13, mobile). Also route to the session probe —
        // it self-earns server proof via a health-endpoint check, so a genuinely
        // offline user is never bounced.
        const _mcalLive = (() => {
            try { return !window.AppDataStore || typeof AppDataStore.hasLiveSession !== 'function' || AppDataStore.hasLiveSession(); }
            catch (_) { return true; }
        })();
        if (!_mcalLive) {
            try { if (typeof window._checkSessionAlive === 'function') window._checkSessionAlive('mcal_dead_session', { probeReachability: true }); } catch (_) { /* best-effort */ }
        }
        let activities;
        // _mcalTrust: this render is backed by a REAL server answer — live local
        // token AND the fetch didn't degrade to the client-side fallback
        // (_degraded from data.js on dead-session/timeout/overload). Only trusted
        // renders may be persisted into the no-TTL mcal caches / grid snapshots;
        // a transient NANO overload must never be frozen in as an empty month
        // (bug 2026-07-13 round 2: post-CACHE_VERSION-bump fleet reload briefly
        // starved the DB and Safari cached the failed fetch as []).
        const _mcalTrust = _mcalLive && !(_actMode === 'full' && actResult && actResult._degraded);
        if (_actMode === 'cache') {
            activities = (_cachedActs || []).filter(_mcalKeepAct);
        } else {
            activities = (actResult?.data || []).filter(_mcalKeepAct);
            if (_mcalTrust) _lsSet(_mcalActsKey, activities);
        }
        const personMap = new Map(allPeople.map(p => [String(p.id), p]));
        _mcalPersonMap = personMap;

        // Group activities by date (YYYY-MM-DD). Normalize the date in case
        // a row was saved with a full ISO timestamp ("2026-06-12T00:00:00+08:00")
        // instead of a plain date — without this slice() the cell key wouldn't
        // match the grid keys below and the activity would silently disappear.
        const byDate = new Map();
        for (const a of activities) {
            const k = String(a.activity_date || '').slice(0, 10);
            if (!k) continue;
            if (!byDate.has(k)) byDate.set(k, []);
            byDate.get(k).push(a);
        }
        // Inject birthdays into matching dates within this month. Dedup clients
        // who exist as both a prospect and a customer (prefer customer) so a
        // converted-but-not-removed prospect doesn't double a birthday marker.
        const mmdd = (m, d) => `${String(m).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
        for (const p of _dedupClientByBday(allPeople)) {
            const dob = p.date_of_birth || '';
            if (!dob || dob.length < 10) continue;
            if (!_mcalBdayOwnerVisible(p.responsible_agent_id || p.lead_agent_id)) continue;
            const md = dob.slice(5, 10); // MM-DD
            // Find the date in this month with this MM-DD
            const [_pm, _pd] = md.split('-').map(n => parseInt(n));
            if (_pm - 1 !== _mcalMonth) continue;
            if (_pd < 1 || _pd > daysInMonth) continue;
            const k = `${_mcalYear}-${String(_mcalMonth+1).padStart(2,'0')}-${String(_pd).padStart(2,'0')}`;
            if (!byDate.has(k)) byDate.set(k, []);
            byDate.get(k).push({ activity_type: 'All Day Birthday', _isBirthday: true, _person: p });
        }
        // Team Birthdays: inject staff markers (team-wide, no owner check). MM-DD
        // from date_of_birth or IC (_staffMD).
        for (const s of _mcalStaffList) {
            const md = _staffMD(s);
            if (!md) continue;
            const [_pm, _pd] = md.split('-').map(n => parseInt(n));
            if (_pm - 1 !== _mcalMonth) continue;
            if (_pd < 1 || _pd > daysInMonth) continue;
            const k = `${_mcalYear}-${String(_mcalMonth+1).padStart(2,'0')}-${String(_pd).padStart(2,'0')}`;
            if (!byDate.has(k)) byDate.set(k, []);
            byDate.get(k).push({ activity_type: 'All Day Birthday', _isBirthday: true, _isStaff: true, _person: s });
        }
        _mcalByDate = byDate;

        // ── Render grid cells ───────────────────────────────────
        const todayY = todayD.getFullYear();
        const todayM = todayD.getMonth();
        const todayDay = todayD.getDate();
        const cells = [];

        // Prev month spillover
        for (let i = startOffset; i > 0; i--) {
            const d = prevMonthLastDay - i + 1;
            cells.push(`<div class="mcal-cell muted"><span class="num">${d}</span></div>`);
        }

        // Current month
        for (let d = 1; d <= daysInMonth; d++) {
            const k = `${_mcalYear}-${String(_mcalMonth+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
            const isToday = (_mcalYear === todayY && _mcalMonth === todayM && d === todayDay);
            const dayActs = (byDate.get(k) || []).filter(a => a.source !== 'birthday_auto');
            const visibleActs = dayActs.slice(0, 3);
            const overflow = Math.max(0, dayActs.length - 3);
            const evtsHtml = visibleActs.map(a => {
                if (a._isBirthday) {
                    const p = a._person;
                    const fname = String(p.full_name || '').split(' ')[0];
                    return `<div class="mcal-evt allday" title="🎂 ${_mhomeEsc(p.full_name||fname)}'s Birthday" onclick="event.stopPropagation();app.mcalDayClick('${k}')">🎂 ${_mhomeEsc(fname)}</div>`;
                }
                const time = (a.start_time || '00:00').slice(0, 5);
                const color = _mcalColorForType(a.activity_type);
                const short = _mcalShortTitle(a, personMap);
                // Pending optimistic insert → italic + opacity; failed sync → ⚠ icon
                const pendingClass = a._syncFailed ? ' sync-failed' : (a._pending ? ' pending' : '');
                const warnIcon = a._syncFailed ? '<i class="fas fa-exclamation-triangle" title="Not synced — will retry"></i> ' : '';
                return `<div class="mcal-evt ${color}${pendingClass}" onclick="event.stopPropagation();app.mcalDayClick('${k}')">${warnIcon}<span class="t">${_mhomeEsc(time)}</span>${_mhomeEsc(short)}</div>`;
            }).join('');
            const moreLink = overflow > 0 ? `<span class="more" onclick="event.stopPropagation();app.mcalDayClick('${k}')">+${overflow} more</span>` : '';
            cells.push(`
                <div class="mcal-cell ${isToday ? 'today' : ''}" onclick="app.mcalDayClick('${k}')">
                    <span class="num">${d}</span>
                    <div class="events">${evtsHtml}${moreLink}</div>
                </div>`);
        }

        // Next month spillover to fill grid (multiple of 7)
        const used = startOffset + daysInMonth;
        const trail = (7 - (used % 7)) % 7;
        for (let i = 1; i <= trail; i++) {
            cells.push(`<div class="mcal-cell muted"><span class="num">${i}</span></div>`);
        }
        // Pad to 6 rows (42) for consistent height
        while (cells.length < 42) {
            const d = (cells.length - startOffset - daysInMonth) + 1;
            cells.push(`<div class="mcal-cell muted"><span class="num">${d > 0 ? d : ''}</span></div>`);
        }

        const grid = document.getElementById('mcal-grid');
        if (grid) {
            grid.innerHTML = cells.join('');
            // Only snapshot a grid built from trusted data — a dead-session or
            // degraded-fetch render must not become the instant-restore for next launch.
            if (_mcalTrust) _lsSet(_mcalSnapKey, cells.join(''));
            _mcalPerf('grid-painted');
        }

        // ── Coming-up strip ─────────────────────────────────────
        const todayStr = `${todayY}-${String(todayM+1).padStart(2,'0')}-${String(todayDay).padStart(2,'0')}`;
        const tom = new Date(todayD); tom.setDate(tom.getDate()+1);
        const todayMD = mmdd(todayM+1, todayDay);
        const tomMD = mmdd(tom.getMonth()+1, tom.getDate());
        const bdayCount = _dedupClientByBday(allPeople.filter(p => _mcalBdayOwnerVisible(p.responsible_agent_id || p.lead_agent_id))).filter(p => {
            const dob = p.date_of_birth || ''; if (dob.length < 10) return false;
            const md = dob.slice(5, 10); return md === todayMD || md === tomMD;
        }).length + _mcalStaffList.filter(s => { const md = _staffMD(s); return !!md && (md === todayMD || md === tomMD); }).length;
        const refillCount = (refillsR || []).length;
        const _mcalIsAdmin = isSystemAdmin(_state.cu);
        const overdueFollowups = (draftsR || []).filter(d =>
            d.status === 'pending' && (d.due_date || '') < todayStr &&
            // Was `!d.agent_id || ...` which counted unassigned (null-owner) drafts into
            // every non-admin's tile — a scope leak. Admins see all; everyone else counts
            // only their own owned drafts.
            (_mcalIsAdmin || String(d.agent_id) === String(_state.cu?.id))
        ).length;

        const comingHost = document.getElementById('mcal-coming-host');
        if (comingHost) {
            comingHost.innerHTML = `
            <div class="mcal-coming" data-snap="1">
                <div class="mcal-coming-head">
                    <div class="mcal-coming-title"><span class="ico"><i class="fas fa-clock"></i></span> Here's what's coming up</div>
                    <button class="mcal-coming-link" onclick="app.navigateTo('home')">View All ›</button>
                </div>
                <div class="mcal-coming-list">
                    <button class="mcal-coming-item bday" onclick="app.navigateTo('home')">
                        <div class="ico"><i class="fas fa-cake-candles"></i></div>
                        <div class="mcal-coming-text">
                            <div class="mcal-coming-num">${bdayCount}<small>Birthday${bdayCount===1?'':'s'}</small></div>
                            <div class="mcal-coming-lbl">Today &amp; Tomorrow</div>
                        </div>
                    </button>
                    <button class="mcal-coming-item refill" onclick="app.mhomeOpenRefills()">
                        <div class="ico"><i class="fas fa-prescription-bottle-medical"></i></div>
                        <div class="mcal-coming-text">
                            <div class="mcal-coming-num">${refillCount}<small>Refills</small></div>
                            <div class="mcal-coming-lbl">Pending</div>
                        </div>
                    </button>
                    <button class="mcal-coming-item followup" onclick="app.mhomeOpenFollowups()">
                        <div class="ico"><i class="fas fa-user-clock"></i></div>
                        <div class="mcal-coming-text">
                            <div class="mcal-coming-num">${overdueFollowups}<small>Follow-ups</small></div>
                            <div class="mcal-coming-lbl">Overdue</div>
                        </div>
                    </button>
                </div>
            </div>`;
            if (_mcalTrust) _lsSet(_mcalSnapKey + '-coming', comingHost.innerHTML);
        }

        // ── SWR background revalidate ──────────────────────────
        // After the cached grid is painted, quietly re-fetch the FULL month
        // from Supabase. If the row set differs from what we rendered, save
        // the fresh data + trigger ONE re-render. The TTL guard prevents the
        // re-rendered view from kicking off another revalidate immediately.
        if (_shouldRevalidate) {
            const _revKey = `${_mcalYear}-${_mcalMonth}`;
            const _lastRev = _mcalLastRevalidatedAt.get(_revKey) || 0;
            if (Date.now() - _lastRev > _MCAL_REVALIDATE_TTL_MS) {
                _mcalLastRevalidatedAt.set(_revKey, Date.now());
                const _capturedYear = _mcalYear, _capturedMonth = _mcalMonth;
                const _sig = (rows) => (rows || [])
                    .map(a => `${a.id}|${a.activity_date || ''}|${a.start_time || ''}|${a.updated_at || ''}|${a._pending ? 1 : 0}`)
                    .sort()
                    .join(';');
                const _staleSig = _sig(activities);
                AppDataStore.queryAdvanced('activities', _buildActOpts(monthStartStr, monthEndStr))
                    .then(res => {
                        // Dead-session guard: a revalidate without a live token
                        // resolves from the local fallback / anon empty read.
                        // Overwriting the (good) cache with it — and re-rendering —
                        // would make a zombie session actively WIPE a healthy view.
                        try {
                            if (window.AppDataStore && typeof AppDataStore.hasLiveSession === 'function'
                                && !AppDataStore.hasLiveSession()) return;
                        } catch (_) { /* treat as live */ }
                        // Degraded result (client-side fallback, not a server answer) —
                        // never overwrite the cache or re-render from it.
                        if (res && res._degraded) return;
                        const freshRaw = (res?.data || []).filter(_mcalKeepAct);
                        // Preserve any optimistic rows still pending — they're not
                        // in Supabase yet but the user expects to see them.
                        // Check both localStorage (normal path) AND the in-memory
                        // _mcalOptimisticRows Map, which survives _clearMobileSnapshots
                        // cache clears triggered by the AppDataStore.create mutation hook.
                        const cached = _lsGetRaw(_mcalActsKey) || [];
                        const lsPending = cached.filter(a => a._pending && a.id && String(a.id).startsWith('tmp-'));
                        const freshIds = new Set(freshRaw.map(a => String(a.id)));
                        const memPending = [..._mcalOptimisticRows.values()]
                            .map(e => e.row)
                            .filter(p => !freshIds.has(String(p.id)));
                        const pending = [...lsPending, ...memPending]
                            .filter((r, i, arr) => arr.findIndex(x => String(x.id) === String(r.id)) === i);
                        const merged = [...freshRaw, ...pending];
                        const freshSig = _sig(merged);
                        if (freshSig === _staleSig) return; // no change, no re-render
                        _lsSet(_mcalActsKey, merged);
                        // Re-render only if the user is still on the same month
                        // and the calendar view is still active.
                        if (_capturedYear === _mcalYear && _capturedMonth === _mcalMonth) {
                            const vp = document.getElementById('content-viewport');
                            if (vp && vp.classList.contains('mcal-active') && _mcalView === 'month') {
                                showMobileCalendarView(vp).catch(() => {});
                            }
                        }
                    })
                    .catch(() => {});
            }
        }
    };

    // ── Optimistic mcal insert / swap / retry queue ─────────────
    // Insert a draft activity row into the visible month's cache + grid so
    // the user sees their save instantly. The real Supabase write happens
    // in the background (see saveActivity); on success the tmp id is swapped
    // for the real id via _mcalOptimisticSwap, on failure the row is marked
    // pending and queued for retry.
    const _mcalOptimisticInsert = (row) => {
        if (!row || !row.activity_date || !row.id) return;
        const dateStr = String(row.activity_date).slice(0, 10);
        const [y, m] = dateStr.split('-').map(n => parseInt(n, 10));
        if (!y || !m) return;
        const key = `mcal-acts-${y}-${m - 1}`;
        let cached = [];
        try { cached = JSON.parse(localStorage.getItem(key) || '{}').val || []; } catch(_) { /* intentional: corrupt cache treated as empty */ }
        if (!Array.isArray(cached)) cached = [];
        // Avoid double-insert if called twice with same tmp id
        if (cached.some(a => String(a.id) === String(row.id))) return;
        cached.push(row);
        try { localStorage.setItem(key, JSON.stringify({ ts: Date.now(), val: cached })); } catch(_) { /* intentional: optimistic cache write is best-effort */ }
        _mcalOptimisticRows.set(String(row.id), { key, row });
        // If the calendar is currently showing this month, re-render now.
        const vp = document.getElementById('content-viewport');
        if (vp && vp.classList.contains('mcal-active') && _mcalView === 'month' && _mcalYear === y && _mcalMonth === (m - 1)) {
            showMobileCalendarView(vp).catch(() => {});
        }
    };

    // Replace a tmp-id row with the real row Supabase returned. Keeps the
    // cache and the grid consistent with what the server confirmed.
    const _mcalOptimisticSwap = (tmpId, realRow) => {
        const entry = _mcalOptimisticRows.get(String(tmpId));
        _mcalOptimisticRows.delete(String(tmpId));
        if (!entry || !realRow) return;
        const { key } = entry;
        let cached = [];
        try { cached = JSON.parse(localStorage.getItem(key) || '{}').val || []; } catch(_) { /* intentional: corrupt cache treated as empty */ }
        if (!Array.isArray(cached)) return;
        const idx = cached.findIndex(a => String(a.id) === String(tmpId));
        if (idx >= 0) {
            cached[idx] = { ...realRow, _pending: false };
        } else {
            cached.push({ ...realRow, _pending: false });
        }
        try { localStorage.setItem(key, JSON.stringify({ ts: Date.now(), val: cached })); } catch(_) { /* intentional: optimistic cache write is best-effort */ }
        // Re-render the mobile calendar if it's still showing the same month —
        // the SWR revalidation may have raced ahead and wiped the optimistic cell
        // before the real row arrived, so we repaint to ensure it stays visible.
        const [_swY, _swM] = key.replace('mcal-acts-', '').split('-').map(Number);
        const _swVp = document.getElementById('content-viewport');
        if (_swVp && _swVp.classList.contains('mcal-active') && _mcalView === 'month' &&
            !isNaN(_swY) && !isNaN(_swM) && _mcalYear === _swY && _mcalMonth === _swM) {
            showMobileCalendarView(_swVp).catch(() => {});
        }
    };

    // Mark an optimistic row as failed-to-sync. Keeps it visible (so the
    // user doesn't think their save disappeared) but flags it for retry +
    // a small warning indicator in the grid.
    const _mcalOptimisticMarkFailed = (tmpId, activityData) => {
        // Resolve the month-cache key. Prefer the in-memory bookkeeping, but fall
        // back to deriving it from the retry entry's activity_date — the in-memory
        // Map is empty after a page reload, so without this fallback a reloaded
        // session's give-up path silently failed to flag the row (no ⚠ ever shown).
        let key = _mcalOptimisticRows.get(String(tmpId))?.key;
        if (!key && activityData && activityData.activity_date) {
            const dateStr = String(activityData.activity_date).slice(0, 10);
            const [y, m] = dateStr.split('-').map(n => parseInt(n, 10));
            if (y && m) key = `mcal-acts-${y}-${m - 1}`;
        }
        if (!key) return;
        let cached = [];
        try { cached = JSON.parse(localStorage.getItem(key) || '{}').val || []; } catch(_) { /* intentional: corrupt cache treated as empty */ }
        if (!Array.isArray(cached)) return;
        const idx = cached.findIndex(a => String(a.id) === String(tmpId));
        if (idx >= 0) {
            cached[idx] = { ...cached[idx], _pending: true, _syncFailed: true };
            try { localStorage.setItem(key, JSON.stringify({ ts: Date.now(), val: cached })); } catch(_) { /* intentional: optimistic cache write is best-effort */ }
        }
    };

    // Push a failed save onto the persistent retry queue. Caller is expected
    // to also invoke _mcalOptimisticMarkFailed so the UI shows the warning.
    const _mcalEnqueueRetry = (tmpId, table, data) => {
        const q = _mcalRetryQueueRead();
        q.push({ tmpId: String(tmpId), table, data, attempts: 0, lastAttemptAt: 0, enqueuedAt: Date.now() });
        _mcalRetryQueueWrite(q);
    };

    // Drain the retry queue. Each entry gets one attempt per call; on
    // success the optimistic row is swapped + the entry removed, on failure
    // attempts++ and the entry stays for a future drain.
    const _mcalDrainRetryQueue = async () => {
        // Single-flight: bail if another drain is already in progress so concurrent
        // triggers can't double-create the same queued activity.
        if (_mcalDraining) return;
        _mcalDraining = true;
        try {
            const q = _mcalRetryQueueRead();
            if (!q.length) return;
            // Remember which entries THIS drain is responsible for, so the
            // write-back below doesn't clobber entries that _mcalEnqueueRetry
            // appended while an awaited create was in flight.
            const _processedIds = new Set(q.map(e => String(e.tmpId)));
            const remaining = [];
            for (const entry of q) {
                // Backoff: skip if attempted in the last 30s × 2^attempts
                const backoff = Math.min(30_000 * Math.pow(2, entry.attempts), 10 * 60_000);
                if (Date.now() - (entry.lastAttemptAt || 0) < backoff) {
                    remaining.push(entry);
                    continue;
                }
                try {
                    const saved = await AppDataStore.create(entry.table, entry.data);
                    if (saved && saved.id) {
                        _mcalOptimisticSwap(entry.tmpId, saved);
                        // success → drop from queue
                        continue;
                    }
                    throw new Error('create returned no id');
                } catch (_) {
                    entry.attempts = (entry.attempts || 0) + 1;
                    entry.lastAttemptAt = Date.now();
                    if (entry.attempts >= 8) {
                        // Give up after ~8 tries (~30s + 60s + 2m + 4m + 8m + 10m + 10m).
                        // Leave the row in cache marked as failed; user can edit/delete.
                        // Pass entry.data so a reloaded session (empty in-memory Map)
                        // can still derive the month-cache key and flag the row.
                        _mcalOptimisticMarkFailed(entry.tmpId, entry.data);
                        continue;
                    }
                    remaining.push(entry);
                }
            }
            // Re-read the live queue and preserve any entry appended mid-drain
            // (tmpId not in this drain's processed set) so a concurrent
            // _mcalEnqueueRetry write isn't silently dropped by our stale snapshot.
            const _now = _mcalRetryQueueRead();
            const _appended = _now.filter(e => !_processedIds.has(String(e.tmpId)));
            _mcalRetryQueueWrite([...remaining, ..._appended]);
        } finally {
            _mcalDraining = false;
        }
    };

    // Auto-drain triggers: page load (deferred so we don't compete with the
    // initial render), network recovery, and a 60s backoff loop.
    setTimeout(() => { _mcalDrainRetryQueue().catch(() => {}); }, 5_000);
    window.addEventListener('online', () => { _mcalDrainRetryQueue().catch(() => {}); });
    setInterval(() => { _mcalDrainRetryQueue().catch(() => {}); }, 60_000);

    // ── Mobile calendar control handlers ─────────────────────
    const mcalPrevMonth = async () => {
        _mcalMonth--;
        if (_mcalMonth < 0) { _mcalMonth = 11; _mcalYear--; }
        await showMobileCalendarView(document.getElementById('content-viewport'));
    };
    const mcalNextMonth = async () => {
        _mcalMonth++;
        if (_mcalMonth > 11) { _mcalMonth = 0; _mcalYear++; }
        await showMobileCalendarView(document.getElementById('content-viewport'));
    };
    // View-aware prev/next used by the Week + Day headers. Month keeps its own
    // mcalPrevMonth/mcalNextMonth handlers (its header is built separately).
    const mcalPrev = async () => {
        if (_mcalView === 'week') {
            _mcalSelDate = _mcalSelDate || new Date();
            _mcalSelDate = new Date(_mcalSelDate.getFullYear(), _mcalSelDate.getMonth(), _mcalSelDate.getDate() - 7);
            return showMobileCalendarWeek(document.getElementById('content-viewport'));
        }
        if (_mcalView === 'day') {
            _mcalSelDate = _mcalSelDate || new Date();
            _mcalSelDate = new Date(_mcalSelDate.getFullYear(), _mcalSelDate.getMonth(), _mcalSelDate.getDate() - 1);
            return showMobileCalendarDay(document.getElementById('content-viewport'));
        }
        return mcalPrevMonth();
    };
    const mcalNext = async () => {
        if (_mcalView === 'week') {
            _mcalSelDate = _mcalSelDate || new Date();
            _mcalSelDate = new Date(_mcalSelDate.getFullYear(), _mcalSelDate.getMonth(), _mcalSelDate.getDate() + 7);
            return showMobileCalendarWeek(document.getElementById('content-viewport'));
        }
        if (_mcalView === 'day') {
            _mcalSelDate = _mcalSelDate || new Date();
            _mcalSelDate = new Date(_mcalSelDate.getFullYear(), _mcalSelDate.getMonth(), _mcalSelDate.getDate() + 1);
            return showMobileCalendarDay(document.getElementById('content-viewport'));
        }
        return mcalNextMonth();
    };
    const mcalToday = async () => {
        const t = new Date();
        _mcalYear = t.getFullYear();
        _mcalMonth = t.getMonth();
        _mcalSelDate = new Date(t.getFullYear(), t.getMonth(), t.getDate());
        // "Today" snaps the active view back to the current day/week/month.
        if (_mcalView === 'week') return showMobileCalendarWeek(document.getElementById('content-viewport'));
        if (_mcalView === 'day')  return showMobileCalendarDay(document.getElementById('content-viewport'));
        if (_mcalView === 'list') return showMobileCalendarAgenda(document.getElementById('content-viewport'));
        await showMobileCalendarView(document.getElementById('content-viewport'));
    };

    // Re-render whichever mobile calendar sub-view (month/week/day/list) is
    // currently on screen, keeping the same anchor month/day. Called by
    // refreshCurrentView (script.js _VIEW_REFRESH.month) after an activity
    // mutation: on mobile _currentView is always 'month', so the desktop
    // renderCalendar() the map used before never touched this custom DOM —
    // a deleted/created/edited event would linger until a full re-navigation.
    // The dataChanged listener clears the mcal-acts cache *before* this runs,
    // so the re-render refetches fresh and the stale row disappears.
    const mcalRefreshActiveView = async () => {
        const vp = document.getElementById('content-viewport');
        if (!vp) return;
        if (_mcalView === 'week') return showMobileCalendarWeek(vp);
        if (_mcalView === 'day')  return showMobileCalendarDay(vp);
        if (_mcalView === 'list') return showMobileCalendarAgenda(vp);
        return showMobileCalendarView(vp);
    };
    // Tapping a calendar event jumps straight to the linked prospect/customer
    // profile — the richer destination where the full timeline, meeting notes
    // and follow-up actions live. Entity-less rows (events, agent meetings /
    // trainings) and rows the viewer doesn't own fall back to the activity
    // detail modal, which keeps the same privacy masking. Robust against a
    // deleted/orphaned contact: if the lookup misses we drop back to details.
    const mcalOpenEvent = async (activityId, prospectId, customerId) => {
        try { UI.hideModal(); } catch (_) { /* intentional: best-effort modal cleanup before navigating */ }
        try {
            if (prospectId) {
                const p = await AppDataStore.getById('prospects', prospectId);
                if (p) { await window.app.showProspectDetail(prospectId); return; }
            } else if (customerId) {
                const c = await AppDataStore.getById('customers', customerId);
                if (c) { await window.app.showCustomerDetail(customerId); return; }
            }
        } catch (e) { console.error(e); }
        // No linked contact (or it was removed) — show the activity details.
        // viewActivityDetails (incl. the attendee list) lives in the calendar
        // chunk, which the mobile calendar never loads on its own — so without
        // this on-demand load the tap silently no-ops and EVENT attendees never
        // render. Mirrors the _loadChunk pattern used by the mobile follow-up
        // sheets elsewhere in this file.
        try { if (typeof window._loadChunk === 'function') await window._loadChunk('chunks/script-calendar.min.js'); } catch (_) { /* guarded below */ }
        try { if (window.app.viewActivityDetails) await window.app.viewActivityDetails(activityId); } catch (e) { console.error(e); }
    };
    // Birthday WhatsApp greeting — id-only so nothing dynamic (names like
    // O'Brien) ever lands in an onclick attribute. Phone is looked up from the
    // in-scope person map; no phone → no-op (the button is also phone-gated).
    const mcalBirthdayWa = async (id, isCustomer) => {
        const person = _mcalPersonMap.get(String(id));
        if (!person || !_mhomeWaPhone(person.phone)) return;
        const greeting = `Happy Birthday, ${person.full_name || ''}! 🎂 Wishing you a wonderful year ahead.`;
        // Option 2 — "direct chat + paste the poster". female → pink, everyone
        // else (male/other/unknown) → navy. We FIRE the clipboard copy but do
        // NOT await it before opening the chat: window.open needs a fresh user
        // gesture, and an await would consume it → the chat popup gets blocked on
        // iOS (the exact lesson in mhomeWa's comment). So the copy settles in the
        // background from the already-warmed in-memory PNG while we immediately
        // open the prospect's chat (greeting pre-filled, page stays alive so the
        // wish still logs below). Opening the chat is the primary action and is
        // never sacrificed for the copy. In the chat the agent taps the message
        // box → Paste → the poster drops in as a real inline image.
        const _g = String(person.gender || '').trim().toLowerCase();
        const _isFemale = _g.startsWith('f') || _g.includes('女');
        const _posterBlob = _isFemale ? _mcalBdayBlob.female : _mcalBdayBlob.male;
        let _attemptedCopy = false;
        if (_posterBlob && navigator.clipboard && window.ClipboardItem) {
            try {
                // Fire-and-forget (no await) so the gesture survives for window.open below.
                navigator.clipboard.write([new ClipboardItem({ 'image/png': _posterBlob })]).catch(() => {});
                _attemptedCopy = true;
            } catch (_) { /* clipboard image unsupported → open chat with text only */ }
        }
        mhomeWa(id, person.phone, greeting); // open the prospect's chat (greeting pre-filled) — gesture still fresh
        if (_attemptedCopy) UI.toast.success('📋 Poster copied! In the chat: tap the message box → Paste, then Send.');
        else if (_posterBlob) UI.toast.info('Chat opened with the greeting — the poster could not auto-copy on this device.');
        // Log the wish as an activity — parity with desktop executeSendBirthdayWish.
        // The mobile people map merges prospects + customers with NO type tag, so
        // resolve the entity by id at send-time. Wrapped in try/catch so a logging
        // failure can never break the WhatsApp open (the primary action).
        try {
            const _d = new Date();
            const _localDate = `${_d.getFullYear()}-${String(_d.getMonth()+1).padStart(2,'0')}-${String(_d.getDate()).padStart(2,'0')}`;
            const _payload = {
                activity_type: 'CALL',
                activity_date: _localDate,
                source: 'birthday_auto',   // logged touch — hidden from the calendar, kept in history
                summary: `Birthday Wish via WhatsApp: ${greeting}`,
                lead_agent_id: _state.cu?.id,
                created_by: _state.cu?.id,
            };
            // Prefer the explicit type flag the caller passed (from the person's
            // source table) — id sequences overlap, so probing prospects-first
            // would mis-file a customer's wish onto an unrelated prospect. Only
            // fall back to a probe when the flag is absent.
            let isProspect;
            if (typeof isCustomer === 'boolean') {
                isProspect = !isCustomer;
            } else {
                isProspect = !!(await AppDataStore.getById('prospects', id).catch(() => null));
            }
            if (isProspect) _payload.prospect_id = id; else _payload.customer_id = id;
            // De-dupe: one birthday-wish log per person per day (re-tapping won't pile up).
            const _existB = await AppDataStore.query('activities', isProspect ? { prospect_id: id } : { customer_id: id }).catch(() => []);
            if ((_existB || []).some(a => a.source === 'birthday_auto' && a.activity_date === _localDate && (a.summary || '').startsWith('Birthday Wish'))) {
                return; // already logged today
            }
            await AppDataStore.create('activities', _payload);
            UI.toast.success('Birthday wish logged.');
        } catch (e) { console.warn('[mcalBirthdayWa] activity log failed (WhatsApp still opened)', e); }
    };
    // Team Birthday WhatsApp — open a colleague's chat with a prefilled greeting.
    // Staff are NOT contacts, so this does NOT log a birthday_auto activity (which
    // would orphan an FK against prospects/customers). Text-only, no poster.
    const mcalTeamBirthdayWa = async (id) => {
        const s = _mcalStaffList.find(u => String(u.id) === String(id));
        if (!s || !_mhomeWaPhone(s.phone)) return;
        const firstName = (s.full_name || '').split(' ')[0] || s.full_name || '';
        const greeting = `${firstName}，生日快乐！🎉 祝您新岁安康，诸事顺遂。— DestinOraclesSolution Team`;
        mhomeWa(id, s.phone, greeting);
    };
    // Open a birthday person's profile — mirrors mcalOpenEvent: try prospect,
    // then customer, routing to the matching detail view. id-only.
    const mcalOpenPerson = async (id, isCustomer) => {
        try { UI.hideModal(); } catch (_) { /* intentional: best-effort modal cleanup before navigating */ }
        try {
            // Prospects + customers have independent id sequences, so a bare id is ambiguous
            // (low ids overlap). When the caller knows the type (follow-up rows pass isCustomer),
            // probe that table FIRST so a same-id record of the wrong type isn't opened.
            if (isCustomer) {
                const c = await AppDataStore.getById('customers', id);
                if (c) { await window.app.showCustomerDetail(id); return; }
                const p = await AppDataStore.getById('prospects', id);
                if (p) { await window.app.showProspectDetail(id); return; }
                return;
            }
            const p = await AppDataStore.getById('prospects', id);
            if (p) { await window.app.showProspectDetail(id); return; }
            const c = await AppDataStore.getById('customers', id);
            if (c) { await window.app.showCustomerDetail(id); return; }
        } catch (e) { console.error(e); }
    };
    const mcalDayClick = (dateStr) => {
        const allDay    = _mcalByDate.get(dateStr) || [];
        const dayBdays  = allDay.filter(a => a._isBirthday);
        const dayActs   = allDay.filter(a => !a._isBirthday && a.source !== 'birthday_auto');
        const sorted    = [...dayActs].sort((a, b) => (a.start_time || '').localeCompare(b.start_time || ''));

        const d = new Date(dateStr + 'T00:00:00');
        const days   = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
        const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
        const dateLabel = `${days[d.getDay()]}, ${d.getDate()} ${months[d.getMonth()]} ${d.getFullYear()}`;

        // Birthday cards — shown at the top of the modal
        const bdayRows = dayBdays.map(a => {
            const p = a._person;
            const hasPhone = !!_mhomeWaPhone(p.phone);
            if (a._isStaff) {
                // Team Birthday card: green accent, role/team subline, text-only WA
                // (staff aren't contacts → no activity logging), name → agent profile.
                const roleLine = (p.role || p.team)
                    ? `<div style="font-size:10px;color:#9CA3AF;margin-top:1px;">${_mhomeEsc([p.role, p.team].filter(Boolean).join(' · '))}</div>`
                    : '';
                const staffWa = hasPhone
                    ? `<button onclick="event.stopPropagation();app.mcalTeamBirthdayWa('${p.id}')" aria-label="Send birthday WhatsApp" style="flex-shrink:0;display:inline-flex;align-items:center;justify-content:center;width:38px;height:38px;border:none;border-radius:50%;background:#25D366;color:#fff;font-size:17px;cursor:pointer;"><i class="fab fa-whatsapp"></i></button>`
                    : '';
                return `
                <div style="display:flex;align-items:center;gap:12px;padding:12px 10px;margin-bottom:6px;background:linear-gradient(90deg,#ECFDF5,#fff);border-radius:10px;border:1px solid #A7F3D0;">
                    <div style="font-size:26px;flex-shrink:0;">🎉</div>
                    <div style="flex:1;min-width:0;cursor:pointer;" onclick="app.showAgentDetail('${p.id}')">
                        <div style="font-size:15px;font-weight:700;color:#065F46;">${_mhomeEsc(p.full_name || '—')}</div>
                        <div style="font-size:12px;color:#047857;margin-top:2px;">Team Birthday 🎂</div>
                        ${roleLine}
                    </div>
                    ${staffWa}
                </div>`;
            }
            const dob = p.date_of_birth || '';
            let ageStr = '';
            if (dob.length >= 4) {
                const age = d.getFullYear() - parseInt(dob.slice(0, 4));
                if (age > 0 && age < 120) ageStr = ` · Turning ${age}`;
            }
            const _pIsCust = !!p._isCustomer;
            const waBtn = hasPhone
                ? `<button onclick="event.stopPropagation();app.mcalBirthdayWa('${p.id}', ${_pIsCust})" aria-label="Send birthday WhatsApp" style="flex-shrink:0;display:inline-flex;align-items:center;justify-content:center;width:38px;height:38px;border:none;border-radius:50%;background:#25D366;color:#fff;font-size:17px;cursor:pointer;"><i class="fab fa-whatsapp"></i></button>`
                : '';
            // Responsible agent label (e.g. "- Oo Kean Cherng"), smaller/muted.
            const _agentId = p.responsible_agent_id || p.lead_agent_id;
            const _agentName = _agentId ? (_mcalUserMap.get(String(_agentId)) || '') : '';
            const agentLine = _agentName
                ? `<div style="font-size:10px;color:#9CA3AF;margin-top:1px;">- ${_mhomeEsc(_agentName)}</div>`
                : '';
            return `
                <div style="display:flex;align-items:center;gap:12px;padding:12px 10px;margin-bottom:6px;background:linear-gradient(90deg,#FDF2F8,#fff);border-radius:10px;border:1px solid #FBCFE8;">
                    <div style="font-size:26px;flex-shrink:0;">🎂</div>
                    <div style="flex:1;min-width:0;cursor:pointer;" onclick="app.mcalOpenPerson('${p.id}', ${_pIsCust})">
                        <div style="font-size:15px;font-weight:700;color:#9D174D;">${_mhomeEsc(p.full_name || '—')}</div>
                        <div style="font-size:12px;color:#BE185D;margin-top:2px;">Birthday${ageStr}</div>
                        ${agentLine}
                    </div>
                    ${waBtn}
                </div>`;
        }).join('');

        // Regular activity rows
        const actRows = sorted.map(a => {
            const time = (a.start_time || '').slice(0, 5);
            const type = a.activity_type || '';
            const pid = a.prospect_id || a.customer_id;
            const person = pid ? _mcalPersonMap.get(String(pid)) : null;
            // Ownership gate: non-owners never see another agent's client name
            // — nor get routed into that agent's prospect/customer profile.
            const owned = _mcalOwned(a);
            const name = (owned && person?.full_name) ? person.full_name : (a.activity_title || a.activity_type || '—');
            const _pArg = (owned && a.prospect_id) ? a.prospect_id : 'null';
            const _cArg = (owned && a.customer_id) ? a.customer_id : 'null';
            const venue = a.venue_name || a.venue || a.location_address || '';
            const color = _mcalColorForType(type);
            return `
                <div style="display:flex;align-items:center;gap:10px;padding:11px 0;border-bottom:1px solid var(--gray-100);cursor:pointer;" onclick="app.mcalOpenEvent('${a.id}', ${_pArg}, ${_cArg});">
                    <div style="min-width:42px;font-size:13px;font-weight:600;color:var(--gray-700);">${_mhomeEsc(time)}</div>
                    <span class="mcal-evt ${color}" style="white-space:nowrap;font-size:11px;padding:2px 7px;border-radius:4px;flex-shrink:0;">${_mhomeEsc(type)}</span>
                    <div style="flex:1;min-width:0;">
                        <div style="font-size:14px;font-weight:500;color:var(--gray-800);">${_mhomeEsc(name)}</div>
                        ${venue ? `<div style="font-size:12px;color:var(--gray-500);margin-top:2px;"><i class="fas fa-map-marker-alt" style="font-size:10px;margin-right:3px;"></i>${_mhomeEsc(venue)}</div>` : ''}
                    </div>
                    <i class="fas fa-chevron-right" style="color:var(--gray-300);font-size:12px;flex-shrink:0;"></i>
                </div>`;
        }).join('');

        const isEmpty = dayBdays.length === 0 && sorted.length === 0;
        UI.showModal(dateLabel, `
            <div style="margin:-8px -4px;">
                ${bdayRows}
                ${actRows}
                ${isEmpty ? '<div style="text-align:center;padding:28px;color:var(--gray-400);font-size:13px;">No activities on this day</div>' : ''}
            </div>
        `, [
            { label: '+ Add Meet Up', type: 'primary', action: `(async()=>{try{app.mcalAddMeetUp && await app.mcalAddMeetUp('${dateStr}');}catch(e){console.error(e);}})()` },
            { label: 'Close', type: 'secondary', action: 'UI.hideModal()' },
        ]);
    };
    // ── Week / Day / Agenda views ────────────────────────────
    // These three renderers reuse the SAME data path the Month grid uses:
    // an activity-date-range query via AppDataStore.queryAdvanced('activities')
    // with the identical ownership-scope fields (so non-admins only see their
    // visible agent set's records + open/public ones), the same EVENT row
    // filter, the same person map (id → prospect/customer), the same
    // _mcalColorForType chips, the same _mcalOwned client-name masking gate,
    // and the same _mhomeEsc escaping. The Month grid stays untouched.
    const _fmtLocalDate = (d) => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
    const _mcalDayNamesShort = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
    const _mcalMonNamesShort = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

    // Resolve the viewer's visible agent set (still needed for birthday/name
    // masking) but return NO activity scope fields: RLS activities_scoped_select
    // is authoritative and matches the desktop RPC (see the Month view's
    // _scopeFields comment — the old client AND-filter starved L3+ users of all
    // visibility='closed' client work; bug 2026-07-13).
    const _mcalScopeFields = async () => {
        const visibleIds = (typeof getVisibleUserIds === 'function')
            ? await getVisibleUserIds(_state.cu).catch(() => 'all') : 'all';
        _mcalVisibleScope = visibleIds;
        return null;
    };

    // Fetch activities for an inclusive [gteStr, lteStr] activity_date range
    // and group them by YYYY-MM-DD. Mirrors the Month view's _buildActOpts +
    // EVENT filter. Also ensures the person map is loaded so client names can
    // render (and be masked for non-owners). Returns a Map(dateStr → [acts]).
    const _mcalFetchRangeByDate = async (gteStr, lteStr) => {
        const scopeFields = await _mcalScopeFields();
        const opts = {
            gte: { activity_date: gteStr },
            lte: { activity_date: lteStr },
            sort: 'start_time', sortDir: 'asc', limit: 2000, offset: 0, countMode: null,
        };
        if (scopeFields) opts.scopeFields = scopeFields;

        // People map powers client names + the ownership mask. Reuse the live
        // map if the Month view already populated it; otherwise pull a trimmed
        // select (same shape the Month view caches) so names resolve.
        let personMap = _mcalPersonMap;
        if (!personMap || personMap.size === 0) {
            try {
                // Include `phone` so the appointment-WhatsApp sheet (mcalWa) has a
                // contactable number even when the Month grid never populated the map.
                const [p, c] = await Promise.all([
                    AppDataStore.queryAdvanced('prospects', { select: 'id,full_name,phone', limit: 50000, countMode: null }).then(r => r?.data || []).catch(() => []),
                    AppDataStore.queryAdvanced('customers', { select: 'id,full_name,phone', limit: 50000, countMode: null }).then(r => r?.data || []).catch(() => []),
                ]);
                personMap = new Map([...(p || []), ...(c || [])].map(x => [String(x.id), x]));
                if (personMap.size) _mcalPersonMap = personMap;
            } catch (_) { personMap = _mcalPersonMap || new Map(); /* intentional: name lookup degrades to activity-type labels */ }
        }

        let acts = [];
        try {
            const res = await AppDataStore.queryAdvanced('activities', opts);
            // Exclude birthday_auto logged touches — they're hidden from the
            // calendar (parity with the month grid + day sheet), so the Week /
            // Day / List views + the appointment WhatsApp sheet never show them.
            acts = (res?.data || []).filter(a => _mcalKeepAct(a) && a.source !== 'birthday_auto');
        } catch (_) { acts = []; /* intentional: fetch failure renders empty range */ }

        const byDate = new Map();
        for (const a of acts) {
            const k = String(a.activity_date || '').slice(0, 10);
            if (!k) continue;
            if (!byDate.has(k)) byDate.set(k, []);
            byDate.get(k).push(a);
        }
        // Stable time-order within each day.
        for (const list of byDate.values()) {
            list.sort((a, b) => String(a.start_time || '').localeCompare(String(b.start_time || '')));
        }
        return byDate;
    };

    // One activity row, mobile-card style — shared by Week / Day / Agenda.
    // Reuses _mcalColorForType for the chip and _mcalOwned for client-name
    // masking (non-owners see the activity title/type, never the client name).
    const _mcalActRowHtml = (a) => {
        const time = (a.start_time || '').slice(0, 5);
        const type = a.activity_type || '';
        const pid = a.prospect_id || a.customer_id;
        const person = pid ? _mcalPersonMap.get(String(pid)) : null;
        const owned = _mcalOwned(a);
        const name = (owned && person?.full_name)
            ? person.full_name
            : (a.activity_title || a.activity_type || '—');
        const venue = a.venue_name || a.venue || a.location_address || '';
        const color = _mcalColorForType(type);
        const pendingClass = a._syncFailed ? ' sync-failed' : (a._pending ? ' pending' : '');
        const warnIcon = a._syncFailed ? '<i class="fas fa-exclamation-triangle" title="Not synced — will retry"></i> ' : '';
        // Tap → linked prospect/customer profile (owner-only); entity-less or
        // unsynced rows fall back to the activity detail modal via mcalOpenEvent.
        const _pArg = (owned && a.prospect_id) ? a.prospect_id : 'null';
        const _cArg = (owned && a.customer_id) ? a.customer_id : 'null';
        const click = a.id != null
            ? `onclick="app.mcalOpenEvent('${a.id}', ${_pArg}, ${_cArg});"`
            : '';
        return `
            <div style="display:flex;align-items:center;gap:10px;padding:10px 0;border-bottom:1px solid var(--gray-100);${a.id != null ? 'cursor:pointer;' : ''}" ${click}>
                <div style="min-width:46px;font-size:12.5px;font-weight:700;color:var(--mc-ink);">${time ? _mhomeEsc(time) : '<span style=\'color:var(--mc-ink-mute);font-weight:600;\'>All&nbsp;day</span>'}</div>
                <span class="mcal-evt ${color}${pendingClass}" style="white-space:nowrap;font-size:10px;padding:2px 7px;border-radius:5px;flex-shrink:0;">${warnIcon}${_mhomeEsc(type)}</span>
                <div style="flex:1;min-width:0;">
                    <div style="font-size:13.5px;font-weight:600;color:var(--mc-ink);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${_mhomeEsc(name)}</div>
                    ${venue ? `<div style="font-size:11.5px;color:var(--mc-ink-soft);margin-top:1px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;"><i class="fas fa-map-marker-alt" style="font-size:9px;margin-right:3px;"></i>${_mhomeEsc(venue)}</div>` : ''}
                </div>
                ${a.id != null ? '<i class="fas fa-chevron-right" style="color:var(--mc-ink-mute);font-size:11px;flex-shrink:0;"></i>' : ''}
            </div>`;
    };

    // Shared chrome (top bar + tab strip + filter row) for the alt views, so
    // they look identical to the Month view. `titleHtml` is the centre title
    // with prev/next nav; `tab` is which tab pill is active.
    const _mcalAltChrome = (tab, titleHtml, bodyHtml) => {
        const userName = (_state.cu?.preferred_name || _state.cu?.full_name || 'there').split(' ')[0];
        const avatarUrl = _state.cu?.avatar_url
            || `https://ui-avatars.com/api/?name=${encodeURIComponent(_state.cu?.full_name || 'U')}&background=8B0000&color=fff`;
        return `
        <div class="mcal">
            <div class="mcal-top">
                <div class="mcal-blossom"><span class="b1">🌸</span><span class="b2">🌸</span><span class="b3">🌸</span></div>
                <button class="mcal-burger" onclick="app.openMobileDrawer()" aria-label="Menu"><i class="fas fa-bars"></i></button>
                <div class="mcal-title-wrap">
                    <div class="mcal-title">${titleHtml}</div>
                    <div class="mcal-sub">Let's make today count, ${_mhomeEsc(userName)}! <span class="spk">✨</span></div>
                </div>
                <div class="mcal-actions">
                    <button class="mcal-search" onclick="(window._cmd=document.getElementById('cmdk-trigger'))&&_cmd.click()" aria-label="Search"><i class="fas fa-search"></i></button>
                    <div class="mcal-avatar" onclick="app.openMobileDrawer()" role="button" aria-label="Profile" style="background-image:url('${_mhomeEsc(avatarUrl)}')"></div>
                </div>
            </div>
            <div class="mcal-tabs">
                <button class="mcal-tab ${tab==='month'?'active':''}" onclick="app.mcalTab('month', this)">Month</button>
                <button class="mcal-tab ${tab==='week'?'active':''}" onclick="app.mcalTab('week', this)">Week</button>
                <button class="mcal-tab ${tab==='day'?'active':''}" onclick="app.mcalTab('day', this)">Day</button>
                <button class="mcal-tab ${tab==='list'?'active':''}" onclick="app.mcalTab('list', this)">List</button>
            </div>
            <div class="mcal-filter-row">
                <button class="mcal-filter" onclick="app.mcalFilter()"><i class="fas fa-sliders"></i> All Events <i class="fas fa-chevron-down"></i></button>
                <div class="mcal-quick">
                    <button class="mcal-quick-btn wa" onclick="app.mcalWa()" aria-label="WhatsApp"><svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor" aria-hidden="true"><path d="M17.498 14.382c-.301-.15-1.767-.867-2.04-.966-.273-.101-.473-.15-.673.15-.197.295-.771.964-.944 1.162-.175.195-.349.21-.646.075-.3-.15-1.263-.465-2.403-1.485-.888-.795-1.484-1.77-1.66-2.07-.174-.3-.019-.465.13-.615.136-.135.301-.345.451-.523.146-.181.194-.301.297-.496.1-.21.049-.375-.025-.524-.075-.15-.672-1.62-.922-2.206-.24-.584-.487-.51-.672-.51-.172-.015-.371-.015-.571-.015-.2 0-.523.074-.797.359-.273.3-1.045 1.02-1.045 2.475s1.07 2.865 1.219 3.075c.149.195 2.105 3.195 5.1 4.485.714.3 1.27.48 1.704.629.714.227 1.365.195 1.88.121.574-.091 1.767-.721 2.016-1.426.255-.705.255-1.29.18-1.425-.074-.135-.27-.21-.57-.345m-5.446 7.443h-.016c-1.77 0-3.524-.48-5.055-1.38l-.36-.214-3.75.975 1.005-3.645-.239-.375a9.869 9.869 0 0 1-1.516-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 0 1 2.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0 0 12.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 0 0 5.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 0 0-3.48-8.413Z"/></svg></button>
                    <button class="mcal-quick-btn add" onclick="app.mcalAdd()" aria-label="Add activity" style="font-size:20px;line-height:1;">+</button>
                </div>
                <button class="mcal-today" onclick="app.mcalToday()">Today</button>
            </div>
            ${bodyHtml}
        </div>`;
    };

    // WEEK — the Mon-Sun week containing _mcalSelDate. Compact day-by-day list
    // (one card per day) which reads better on a phone than a 7×13 hour grid.
    const showMobileCalendarWeek = async (viewport) => {
        if (!viewport) viewport = document.getElementById('content-viewport');
        if (!viewport) return;
        viewport.classList.add('mcal-active');
        _mcalView = 'week';
        if (!_mcalSelDate) _mcalSelDate = new Date();

        // Monday-start week (matches the Month grid's Mon-first layout).
        const start = new Date(_mcalSelDate.getFullYear(), _mcalSelDate.getMonth(), _mcalSelDate.getDate());
        const offsetToMon = (start.getDay() + 6) % 7;
        start.setDate(start.getDate() - offsetToMon);
        const end = new Date(start); end.setDate(start.getDate() + 6);

        const title = `${start.getDate()} ${_mcalMonNamesShort[start.getMonth()]} – ${end.getDate()} ${_mcalMonNamesShort[end.getMonth()]} ${end.getFullYear()}`;
        const titleHtml = `
            <button class="mcal-nav-btn" onclick="event.stopPropagation();app.mcalPrev()" aria-label="Previous week" type="button"><i class="fas fa-chevron-left"></i></button>
            <span class="mcal-title-text">${_mhomeEsc(title)}</span>
            <button class="mcal-nav-btn" onclick="event.stopPropagation();app.mcalNext()" aria-label="Next week" type="button"><i class="fas fa-chevron-right"></i></button>`;

        viewport.innerHTML = _mcalAltChrome('week', titleHtml,
            `<div id="mcal-alt-body" style="background:#fff;border-radius:18px;padding:6px 12px 4px;box-shadow:var(--mc-shadow);min-height:120px;">
                <div style="text-align:center;padding:26px;color:var(--mc-ink-mute);font-size:13px;"><i class="fas fa-spinner fa-spin"></i> Loading…</div>
            </div>`);

        const byDate = await _mcalFetchRangeByDate(_fmtLocalDate(start), _fmtLocalDate(end));
        // Guard against the user swiping away mid-fetch.
        if (_mcalView !== 'week') return;
        const host = document.getElementById('mcal-alt-body');
        if (!host) return;

        const todayStr = _fmtLocalDate(new Date());
        let html = '';
        for (let i = 0; i < 7; i++) {
            const d = new Date(start); d.setDate(start.getDate() + i);
            const ds = _fmtLocalDate(d);
            const acts = byDate.get(ds) || [];
            const isToday = ds === todayStr;
            html += `
                <div style="padding:10px 0;border-bottom:${i < 6 ? '1px solid var(--gray-100)' : 'none'};">
                    <div onclick="app.mcalOpenDay('${ds}')" style="display:flex;align-items:center;gap:9px;cursor:pointer;margin-bottom:${acts.length ? '6px' : '0'};">
                        <div style="min-width:34px;height:34px;border-radius:9px;display:flex;flex-direction:column;align-items:center;justify-content:center;${isToday ? 'background:var(--mc-red);color:#fff;' : 'background:var(--mc-beige-deep);color:var(--mc-ink);'}">
                            <span style="font-size:8.5px;font-weight:700;letter-spacing:0.4px;line-height:1;">${_mcalDayNamesShort[d.getDay()].toUpperCase()}</span>
                            <span style="font-size:14px;font-weight:800;line-height:1.1;">${d.getDate()}</span>
                        </div>
                        <div style="flex:1;font-size:12px;font-weight:600;color:var(--mc-ink-soft);">${acts.length ? `${acts.length} ${acts.length === 1 ? 'activity' : 'activities'}` : 'No activities'}</div>
                        <i class="fas fa-chevron-right" style="color:var(--mc-ink-mute);font-size:11px;"></i>
                    </div>
                    ${acts.length ? `<div style="padding-left:43px;">${acts.map(_mcalActRowHtml).join('')}</div>` : ''}
                </div>`;
        }
        host.innerHTML = html;
    };

    // DAY — the selected day (_mcalSelDate), activities listed by time.
    const showMobileCalendarDay = async (viewport) => {
        if (!viewport) viewport = document.getElementById('content-viewport');
        if (!viewport) return;
        viewport.classList.add('mcal-active');
        _mcalView = 'day';
        if (!_mcalSelDate) _mcalSelDate = new Date();

        const d = new Date(_mcalSelDate.getFullYear(), _mcalSelDate.getMonth(), _mcalSelDate.getDate());
        const ds = _fmtLocalDate(d);
        const todayStr = _fmtLocalDate(new Date());
        const title = `${_mcalDayNamesShort[d.getDay()]}, ${d.getDate()} ${_mcalMonNamesShort[d.getMonth()]} ${d.getFullYear()}`;
        const titleHtml = `
            <button class="mcal-nav-btn" onclick="event.stopPropagation();app.mcalPrev()" aria-label="Previous day" type="button"><i class="fas fa-chevron-left"></i></button>
            <span class="mcal-title-text">${ds === todayStr ? 'Today' : _mhomeEsc(title)}</span>
            <button class="mcal-nav-btn" onclick="event.stopPropagation();app.mcalNext()" aria-label="Next day" type="button"><i class="fas fa-chevron-right"></i></button>`;

        viewport.innerHTML = _mcalAltChrome('day', titleHtml,
            `<div id="mcal-alt-body" style="background:#fff;border-radius:18px;padding:6px 14px 8px;box-shadow:var(--mc-shadow);min-height:120px;">
                <div style="text-align:center;padding:26px;color:var(--mc-ink-mute);font-size:13px;"><i class="fas fa-spinner fa-spin"></i> Loading…</div>
            </div>`);

        const byDate = await _mcalFetchRangeByDate(ds, ds);
        if (_mcalView !== 'day') return;
        const host = document.getElementById('mcal-alt-body');
        if (!host) return;

        const acts = byDate.get(ds) || [];
        if (!acts.length) {
            host.innerHTML = `<div style="text-align:center;padding:34px 10px;color:var(--mc-ink-mute);">
                <div style="font-size:30px;margin-bottom:8px;">🌿</div>
                <div style="font-size:13px;font-weight:600;">No activities on this day</div>
                <button class="mcal-today" style="margin-top:14px;" onclick="app.mcalAddMeetUp('${ds}')">+ Add Meet Up</button>
            </div>`;
        } else {
            host.innerHTML = `<div style="font-size:11.5px;font-weight:700;color:var(--mc-ink-soft);padding:8px 0 2px;">${acts.length} ${acts.length === 1 ? 'ACTIVITY' : 'ACTIVITIES'}</div>${acts.map(_mcalActRowHtml).join('')}`;
        }
    };

    // AGENDA ("List") — a forward-looking chronological list of upcoming
    // activities (today → +30 days), grouped by date.
    const showMobileCalendarAgenda = async (viewport) => {
        if (!viewport) viewport = document.getElementById('content-viewport');
        if (!viewport) return;
        viewport.classList.add('mcal-active');
        _mcalView = 'list';

        const today = new Date();
        const start = new Date(today.getFullYear(), today.getMonth(), today.getDate());
        const end = new Date(start); end.setDate(start.getDate() + 30);
        const startStr = _fmtLocalDate(start);
        const endStr = _fmtLocalDate(end);

        const titleHtml = `<span class="mcal-title-text">Upcoming</span>`;
        viewport.innerHTML = _mcalAltChrome('list', titleHtml,
            `<div id="mcal-alt-body" style="min-height:120px;">
                <div style="background:#fff;border-radius:18px;padding:26px;box-shadow:var(--mc-shadow);text-align:center;color:var(--mc-ink-mute);font-size:13px;"><i class="fas fa-spinner fa-spin"></i> Loading…</div>
            </div>`);

        const byDate = await _mcalFetchRangeByDate(startStr, endStr);
        if (_mcalView !== 'list') return;
        const host = document.getElementById('mcal-alt-body');
        if (!host) return;

        // Walk the 31-day window in order; emit a dated section per day that
        // has activities. Skips empty days so the list stays dense.
        const todayStr = _fmtLocalDate(today);
        let tomorrow = new Date(start); tomorrow.setDate(start.getDate() + 1);
        const tomorrowStr = _fmtLocalDate(tomorrow);
        const sections = [];
        for (let i = 0; i <= 30; i++) {
            const d = new Date(start); d.setDate(start.getDate() + i);
            const ds = _fmtLocalDate(d);
            const acts = byDate.get(ds) || [];
            if (!acts.length) continue;
            let label = `${_mcalDayNamesShort[d.getDay()]}, ${d.getDate()} ${_mcalMonNamesShort[d.getMonth()]}`;
            if (ds === todayStr) label = `Today · ${label}`;
            else if (ds === tomorrowStr) label = `Tomorrow · ${label}`;
            sections.push(`
                <div style="background:#fff;border-radius:18px;padding:8px 14px 6px;box-shadow:var(--mc-shadow);margin-bottom:10px;">
                    <div onclick="app.mcalOpenDay('${ds}')" style="display:flex;align-items:center;justify-content:space-between;cursor:pointer;padding:6px 0 4px;border-bottom:1px dashed var(--gray-100);">
                        <span style="font-size:12.5px;font-weight:800;color:var(--mc-red);">${_mhomeEsc(label)}</span>
                        <span style="font-size:10.5px;font-weight:600;color:var(--mc-ink-mute);">${acts.length} ${acts.length === 1 ? 'item' : 'items'}</span>
                    </div>
                    ${acts.map(_mcalActRowHtml).join('')}
                </div>`);
        }

        if (!sections.length) {
            host.innerHTML = `<div style="background:#fff;border-radius:18px;padding:40px 16px;box-shadow:var(--mc-shadow);text-align:center;color:var(--mc-ink-mute);">
                <div style="font-size:32px;margin-bottom:10px;">🗓️</div>
                <div style="font-size:14px;font-weight:700;color:var(--mc-ink-soft);">Nothing on the horizon</div>
                <div style="font-size:12px;margin-top:4px;">No activities in the next 30 days.</div>
                <button class="mcal-today" style="margin-top:16px;" onclick="app.mcalAdd()">+ Add Activity</button>
            </div>`;
        } else {
            host.innerHTML = sections.join('');
        }
    };

    // Jump to the Day view for a specific date (used by Week / Agenda rows).
    const mcalOpenDay = async (dateStr) => {
        const d = new Date(dateStr + 'T00:00:00');
        if (!isNaN(d.getTime())) _mcalSelDate = d;
        await showMobileCalendarDay(document.getElementById('content-viewport'));
    };

    const mcalTab = async (tab, btn) => {
        document.querySelectorAll('.mcal-tab').forEach(t => t.classList.remove('active'));
        if (btn) btn.classList.add('active');
        const vp = document.getElementById('content-viewport');
        try {
            if (tab === 'week')      { _mcalSelDate = _mcalSelDate || new Date(); await showMobileCalendarWeek(vp); }
            else if (tab === 'day')  { _mcalSelDate = _mcalSelDate || new Date(); await showMobileCalendarDay(vp); }
            else if (tab === 'list') { await showMobileCalendarAgenda(vp); }
            else                     { await showMobileCalendarView(vp); }
        } catch (e) { console.error(e); UI.toast.error('Could not load that view'); }
    };
    const mcalFilter = () => {
        if (typeof window.app?.openCalendarFilterModal === 'function') {
            window.app.openCalendarFilterModal();
        } else {
            UI.toast.error('Filter unavailable — please try again in a moment');
        }
    };
    const mcalAdd = async () => {
        // Open the activity creation modal — pre-fills with today's date by default.
        try { await (window.app.openActivityModal || (() => {}))(); return; } catch (_) { /* intentional: falls through to toast if modal unavailable */ }
        UI.toast.success('Add activity');
    };
    const mcalAddMeetUp = (dateStr) => {
        // Opens the activity modal from a calendar day-detail. After saving, the
        // day-detail is automatically reopened so the user sees the new activity.
        UI.hideModal();
        window._mcalAfterSaveDate = dateStr;
        window.app.openActivityModal && window.app.openActivityModal(dateStr);
    };
    // Per-render context for the appointment-WhatsApp sheet, keyed by the
    // person id (prospect/customer). Holds the human date label + the
    // appointment time so the id-only handler can compose the reminder without
    // any names/phones in the onclick attribute. Rebuilt each time the sheet
    // opens; the person + phone are still looked up live from _mcalPersonMap.
    let _mcalApptWaCtx = new Map();
    // WhatsApp FAB → bottom-sheet of the day's appointments. web.whatsapp.com
    // is a desktop QR page (dead end on the phone this lives on), so instead we
    // list the people the agent has appointments with on the selected day (or
    // today) and let them fire a bilingual reminder. Owner-gated via _mcalOwned
    // (the same gate the day-detail / week / day views use) so non-owners never
    // see another agent's client name or phone here.
    const mcalWa = async () => {
        const d = (_mcalSelDate instanceof Date && !isNaN(_mcalSelDate.getTime()))
            ? new Date(_mcalSelDate.getFullYear(), _mcalSelDate.getMonth(), _mcalSelDate.getDate())
            : new Date();
        const dateStr = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
        const days   = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
        const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
        const dateLabel = `${days[d.getDay()]}, ${d.getDate()} ${months[d.getMonth()]} ${d.getFullYear()}`;

        // Fetch the SELECTED day fresh — _mcalByDate is only populated by the
        // Month grid, so on Week/Day/List (or a fresh load that started on an alt
        // view) it holds a stale/empty month and the sheet showed "No appointments"
        // for days that actually have some. _mcalFetchRangeByDate also primes
        // _mcalPersonMap (incl. phone) so the reminder can be composed.
        const dayMap = await _mcalFetchRangeByDate(dateStr, dateStr).catch(() => new Map());
        const allDay  = dayMap.get(dateStr) || [];
        const sorted  = allDay
            .filter(a => !a._isBirthday)
            .sort((a, b) => (a.start_time || '').localeCompare(b.start_time || ''));

        _mcalApptWaCtx = new Map();
        const rows = [];
        for (const a of sorted) {
            // Owner gate: only appointments whose client this agent may see.
            if (!_mcalOwned(a)) continue;
            const pid = a.prospect_id || a.customer_id;
            if (!pid) continue;
            const person = _mcalPersonMap.get(String(pid));
            if (!person || !person.full_name) continue;
            if (!_mhomeWaPhone(person.phone)) continue; // no contactable phone → skip

            const time  = (a.start_time || '').slice(0, 5);
            const type  = a.activity_type || a.activity_title || 'Appointment';
            const venue = a.venue_name || a.venue || a.location_address || '';
            _mcalApptWaCtx.set(String(pid), { dateLabel, time });
            rows.push(`
                <div style="display:flex;align-items:center;gap:10px;padding:11px 0;border-bottom:1px solid var(--gray-100);">
                    <div style="min-width:46px;font-size:13px;font-weight:600;color:var(--gray-700);">${time ? _mhomeEsc(time) : 'All day'}</div>
                    <div style="flex:1;min-width:0;">
                        <div style="font-size:14px;font-weight:600;color:var(--gray-800);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${_mhomeEsc(person.full_name)}</div>
                        <div style="font-size:12px;color:var(--gray-500);margin-top:2px;">${_mhomeEsc(type)}${venue ? ' · ' + _mhomeEsc(venue) : ''}</div>
                    </div>
                    <button onclick="event.stopPropagation();app.mcalApptWa('${pid}')" aria-label="WhatsApp appointment reminder" style="flex-shrink:0;display:inline-flex;align-items:center;justify-content:center;width:38px;height:38px;border:none;border-radius:50%;background:#25D366;color:#fff;font-size:17px;cursor:pointer;"><i class="fab fa-whatsapp"></i></button>
                </div>`);
        }

        const body = rows.length
            ? `<div style="margin:-8px -4px;">${rows.join('')}</div>`
            : `<div style="text-align:center;padding:28px;color:var(--gray-400);font-size:13px;">No appointments with a phone on file for this day.<br>Tap an appointment in the calendar to add a contact.</div>`;

        UI.showModal(`WhatsApp · ${_mhomeEsc(dateLabel)}`, body, [
            { label: 'Close', type: 'secondary', action: 'UI.hideModal()' },
        ]);
    };
    // Appointment WhatsApp reminder — id-only (no names/phones in the onclick
    // attribute so names like O'Brien can't break the markup). Person + phone
    // are looked up live from _mcalPersonMap; date/time come from the sheet
    // context built in mcalWa. Reuses mhomeWa(id, phone, text) + _mhomeWaPhone.
    const mcalApptWa = (id) => {
        const person = _mcalPersonMap.get(String(id));
        if (!person || !_mhomeWaPhone(person.phone)) return;
        const ctx = _mcalApptWaCtx.get(String(id)) || {};
        const name = person.full_name || '';
        const when = ctx.time ? `${ctx.dateLabel || ''} at ${ctx.time}` : (ctx.dateLabel || '');
        const text = `Hi ${name}, this is a reminder of our appointment on ${when}. See you then! / 您好${name}，提醒您我们于 ${when} 的预约，到时见！`;
        mhomeWa(id, person.phone, text);
    };

    // ── Mobile Prospects / Clients view ──────────────────────
    // Card-based mobile-only listing matching the home/calendar brand
    // language. Shares data with the desktop prospects/customers views.
    let _mpTab = 'prospects';   // 'prospects' | 'customers'
    let _mpAgentMap = null;     // id → agent_code, loaded once per session
    let _mpSearch = '';
    let _mpRenderSeq = 0;       // last-writer-wins token for async list renders (search race guard)
    // Mobile-side filters — parity subset of the desktop filter modal.
    // Status / responsible_agent_id / Ming Gua / score range / pipeline stage.
    // Empty string / null means "no filter for that field".
    let _mpFilters = {
        status: '',           // active | converted | lost | inactive
        agentId: '',          // responsible_agent_id (string id)
        mingGua: '',          // MG1..MG9
        scoreMin: '',         // numeric
        scoreMax: '',         // numeric
        pipelineStage: '',    // prospects only
    };
    const _mpHasActiveFilters = () => Object.values(_mpFilters).some(v => v !== '' && v != null);
    const _mpActiveFilterCount = () => Object.values(_mpFilters).filter(v => v !== '' && v != null).length;
    const showMobileProspectsView = async (viewport) => {
        if (!viewport) return;
        viewport.classList.add('mprospects-active');

        const userName = (_state.cu?.preferred_name || _state.cu?.full_name || 'there').split(' ')[0];
        const avatarUrl = _state.cu?.avatar_url
            || `https://ui-avatars.com/api/?name=${encodeURIComponent(_state.cu?.full_name || 'U')}&background=8B0000&color=fff`;

        // Pull-to-refresh forces a one-time fresh fetch past the snapshot.
        const _mpForce = _mobileForceFresh; _mobileForceFresh = false;
        // Instant snapshot restore — localStorage persists across app close (30-min TTL).
        // Client lists rarely change between visits, so a fresh snapshot is served
        // as-is with no background refetch; it refreshes only on edit, pull-to-
        // refresh, or after the TTL expires.
        const _mpSnapKey = `mp-list-snap-v3-${_mpTab}`;
        let _mpSnapHtml;
        if (!_mpForce) {
            try {
                const _raw = localStorage.getItem(_mpSnapKey);
                if (_raw) {
                    const { ts, val } = JSON.parse(_raw);
                    if (Date.now() - ts < 30 * 60 * 1000) _mpSnapHtml = val;
                    else localStorage.removeItem(_mpSnapKey);
                }
            } catch(_) { /* intentional: corrupt/missing snapshot falls back to live fetch */ }
        }
        // Only use snapshot when there's no active search (search results shouldn't be cached)
        const _mpHasSnap = !!_mpSnapHtml && !_mpSearch;

        viewport.innerHTML = `
        <div class="mp">
            <div class="mp-top">
                <button class="mp-burger" onclick="app.openMobileDrawer()" aria-label="Menu"><i class="fas fa-bars"></i></button>
                <div class="mp-title-wrap">
                    <div class="mp-title">Clients</div>
                    <div class="mp-sub">Hi ${_mhomeEsc(userName)}, your community awaits 🌸</div>
                </div>
                <div class="mp-actions">
                    <button class="mp-search-btn" onclick="document.getElementById('mp-search-input')?.focus()" aria-label="Search"><i class="fas fa-search"></i></button>
                    <div class="mp-avatar" onclick="app.openMobileDrawer()" role="button" aria-label="Profile" style="background-image:url('${_mhomeEsc(avatarUrl)}')"></div>
                </div>
            </div>

            <div class="mp-tabs">
                <button class="mp-tab ${_mpTab === 'prospects' ? 'active' : ''}" onclick="app.mpSwitchTab('prospects', this)">Prospects</button>
                <button class="mp-tab ${_mpTab === 'customers' ? 'active' : ''}" onclick="app.mpSwitchTab('customers', this)">Customers</button>
            </div>

            <div class="mp-search-row">
                <div class="mp-search-input-wrap">
                    <i class="fas fa-search"></i>
                    <input type="text" id="mp-search-input" class="mp-search-input" placeholder="Search by name, phone or email…" oninput="app.mpSearchInput(this.value)" value="${_mhomeEsc(_mpSearch)}">
                </div>
                <button class="mp-filter-btn ${_mpHasActiveFilters() ? 'active' : ''}" onclick="app.mpOpenFilters()" aria-label="Filters">
                    <i class="fas fa-sliders"></i>
                    ${_mpHasActiveFilters() ? `<span class="mp-filter-badge">${_mpActiveFilterCount()}</span>` : ''}
                </button>
            </div>

            <div id="mp-list" class="mp-list">${_mpHasSnap ? _mpSnapHtml : ''}</div>
        </div>
        <button class="mp-fab" onclick="app.mpAdd()" aria-label="Add"><i class="fas fa-plus"></i></button>`;

        // Fresh snapshot → show it and stop (no background fetch). Otherwise load.
        if (_mpHasSnap && !_mpForce) return;
        await _mpRenderList(!_mpHasSnap);
    };

    // Mobile-aware prospects dispatcher. Use this from ANY callsite outside the
    // main navigateTo router (Back-to-List buttons, post-delete redirects,
    // post-convert redirects, post-import redirects, auxiliary routers).
    // Without this, mobile users get bounced to the desktop TABLE view squeezed
    // into a narrow viewport — looks like the "old card view" because
    // applyMobileTableLabels() decorates each <td> with data-label="NAME" etc.
    const showProspectsViewSmart = async (viewport) => {
        if (!viewport) viewport = document.getElementById('content-viewport');
        if (isMobile()) return showMobileProspectsView(viewport);
        return (window.app.showProspectsView || (() => {}))(viewport);
    };

    const _mpRenderList = async (silent = false) => {
        const listHost = document.getElementById('mp-list');
        if (!listHost) return;
        // Last-writer-wins sequencing: a slower stale search (e.g. "jo") must not
        // repaint the list after a newer one ("john") has already resolved. Each
        // call claims a token; only the latest may write the final innerHTML.
        const _seq = ++_mpRenderSeq;
        if (!silent) listHost.innerHTML = '<div class="mp-empty"><i class="fas fa-spinner fa-spin"></i> Loading…</div>';

        const table = _mpTab === 'customers' ? 'customers' : 'prospects';
        const visibleIds = (typeof getVisibleUserIds === 'function')
            ? await getVisibleUserIds(_state.cu).catch(() => 'all') : 'all';

        const searchTerm = (_mpSearch || '').trim();
        let rows = [];
        let _serverSearched = false;
        try {
            let tableRowsPromise;
            if (searchTerm) {
                // Bypass SWR cache on search — getAll() serves stale localStorage snapshot
                // so prospects added on another device wouldn't appear. Server-side search
                // always hits Supabase fresh, matching the desktop prospects search behavior.
                tableRowsPromise = table === 'prospects'
                    ? AppDataStore.searchProspects(searchTerm, { includeDormant: true, limit: 200 })
                    : AppDataStore.searchCustomers(searchTerm, { limit: 200 });
                _serverSearched = true;
            } else {
                tableRowsPromise = AppDataStore.getAll(table);
            }
            const [tableRows, agentRows] = await Promise.all([
                tableRowsPromise,
                _mpAgentMap ? Promise.resolve(null) : AppDataStore.getAll('users').catch(() => []),
            ]);
            rows = tableRows || [];
            if (agentRows) {
                _mpAgentMap = new Map(
                    agentRows.filter(u => u.agent_code || u.full_name)
                             .map(u => [String(u.id), { code: u.agent_code || '', name: u.full_name || '' }])
                );
            }
        } catch (_) { rows = []; /* intentional: fetch failure renders empty list */ }

        // Scope by visibility for non-admins
        if (typeof isSystemAdmin === 'function' && !isSystemAdmin(_state.cu) && visibleIds !== 'all') {
            const setIds = new Set(visibleIds.map(String));
            // Scope to own+team like desktop getVisibleProspects/getVisibleCustomers:
            // match responsible_agent_id OR the legacy agent_id. Do NOT show null-owner
            // (unassigned / imported) rows to a scoped agent — the old `!responsible_agent_id`
            // clause leaked every unassigned prospect+customer (name, phone, WhatsApp) to
            // all non-admin agents.
            rows = rows.filter(r => setIds.has(String(r.responsible_agent_id)) || setIds.has(String(r.agent_id)));
        }

        // Client-side text filter — skip when server already filtered via searchProspects/searchCustomers
        if (!_serverSearched) {
            const q = searchTerm.toLowerCase();
            if (q) {
                rows = rows.filter(r => {
                    const blob = `${r.full_name || ''} ${r.phone || ''} ${r.email || ''} ${r.nickname || ''}`.toLowerCase();
                    return blob.includes(q);
                });
            }
        }

        // Filter modal — applied AFTER search so the filter button count
        // reflects the user's narrowed query. Each filter is opt-in: a blank
        // string means "no filter on this field" so we only narrow when set.
        const F = _mpFilters;
        if (F.status) {
            rows = rows.filter(r => String(r.status || '').toLowerCase() === F.status.toLowerCase());
        }
        if (F.agentId) {
            rows = rows.filter(r => String(r.responsible_agent_id || '') === String(F.agentId));
        }
        if (F.mingGua) {
            rows = rows.filter(r => String(r.ming_gua || '').toUpperCase() === F.mingGua.toUpperCase());
        }
        if (F.scoreMin !== '' && F.scoreMin != null) {
            const min = Number(F.scoreMin);
            if (!isNaN(min)) rows = rows.filter(r => (Number(r.score) || 0) >= min);
        }
        if (F.scoreMax !== '' && F.scoreMax != null) {
            const max = Number(F.scoreMax);
            if (!isNaN(max)) rows = rows.filter(r => (Number(r.score) || 0) <= max);
        }
        if (F.pipelineStage && _mpTab !== 'customers') {
            rows = rows.filter(r => String(r.pipeline_stage || '').toLowerCase() === F.pipelineStage.toLowerCase());
        }

        // Sort: most recent first
        rows.sort((a, b) => {
            const at = new Date(a.updated_at || a.created_at || 0).getTime();
            const bt = new Date(b.updated_at || b.created_at || 0).getTime();
            return bt - at;
        });

        // Bail if a newer render has superseded this one (stale search response).
        if (_seq !== _mpRenderSeq) return;

        if (!rows.length) {
            listHost.innerHTML = `<div class="mp-empty"><span class="mp-empty-flower">🌸</span> No ${_mhomeEsc(_mpTab)} yet. Tap + to add the first one.</div>`;
            return;
        }

        const isCust = _mpTab === 'customers';
        const palettes = ['red','purple','pink','peach','wood'];
        // Cap the rendered cards at 60 for scroll performance, but tell the user
        // when the list is truncated so a record beyond the cap doesn't look
        // "missing" — they can narrow the set with the search box above.
        const _mpCap = 60;
        const _mpTotal = rows.length;
        const html = rows.slice(0, _mpCap).map((p, i) => {
            const init = _mhomeInitials(p.full_name);
            const pal = palettes[i % palettes.length];
            const phone = UI.escJsAttr(p.phone || '');
            const agentEntry = p.responsible_agent_id ? (_mpAgentMap?.get(String(p.responsible_agent_id)) || null) : null;
            const agentCode = agentEntry?.code || '';
            const agentName = agentEntry?.name || '';
            const lastActRaw = p.last_activity_date || '';
            const lastAct = lastActRaw
                ? new Date(lastActRaw).toLocaleDateString('en-MY', { day: 'numeric', month: 'short' })
                : '';
            const fn = isCust ? 'showCustomerDetail' : 'showProspectDetail';
            return `
            <div class="mp-card pal-${pal}" onclick="app.${fn}(${p.id})" role="button" tabindex="0">
                <div class="mp-card-avatar">${_mhomeEsc(init)}</div>
                <div class="mp-card-text">
                    <div class="mp-card-name-row">
                        <div class="mp-card-name${(p.unable_to_serve || p.manual_grade === 'F') ? ' name-unable' : ''}">${_mhomeEsc(p.full_name || 'Unknown')}</div>
                        ${phone ? `<button class="mp-card-wa" onclick="event.stopPropagation();app.mhomeWa(${p.id ?? 'null'},'${phone}')" aria-label="WhatsApp"><i class="fab fa-whatsapp"></i></button>` : ''}
                        ${agentCode ? `<span class="mp-card-agent">${_mhomeEsc(agentCode)}</span>` : ''}
                    </div>
                    <div class="mp-card-meta">
                        ${p.unable_to_serve ? `<span class="badge-unable">Unable to Serve</span>` : ''}${p.manual_grade === 'F' ? `<span class="badge-unable">Dropped (F)</span>` : ''}
                        ${lastAct ? `<span class="mp-chip date">${_mhomeEsc(lastAct)}</span>` : ''}
                        ${agentName ? `<span class="mp-chip agent">${_mhomeEsc(agentName)}</span>` : ''}
                    </div>
                </div>
                <div class="mp-card-actions">
                    <i class="fas fa-chevron-right mp-card-chev"></i>
                </div>
            </div>`;
        }).join('');

        const truncNote = _mpTotal > _mpCap
            ? `<div class="mp-empty" style="padding:14px 8px;font-size:12px;">Showing ${_mpCap} of ${_mpTotal}. Use search above to find older records.</div>`
            : '';

        listHost.innerHTML = html + truncNote;
        // Only cache the snapshot when there's no active search AND no active
        // filters. Caching a filtered list under the canonical key means a
        // page reload would paint that narrowed list while the in-memory
        // filter state is empty — UI says "no filters" but list is narrowed.
        if (!_mpSearch && !_mpHasActiveFilters()) {
            try { localStorage.setItem(`mp-list-snap-v3-${_mpTab}`, JSON.stringify({ ts: Date.now(), val: html + truncNote })); } catch(_) { /* intentional: snapshot persistence is best-effort */ }
        }
    };

    const mpSwitchTab = async (tab, btn) => {
        // Drop filters that don't apply to the new tab so the badge count
        // stays honest and the user doesn't get an empty list from a
        // tab-foreign filter (e.g. status='converted' on Customers).
        if (tab !== _mpTab) {
            const prospectStatuses = new Set(['active','converted','lost']);
            const customerStatuses = new Set(['active','inactive']);
            const validStatuses = tab === 'customers' ? customerStatuses : prospectStatuses;
            if (_mpFilters.status && !validStatuses.has(_mpFilters.status)) _mpFilters.status = '';
            if (tab === 'customers') _mpFilters.pipelineStage = '';
        }
        _mpTab = tab;
        document.querySelectorAll('.mp-tab').forEach(t => t.classList.remove('active'));
        if (btn) btn.classList.add('active');
        // Update only the filter badge inline rather than re-rendering the
        // shell — re-rendering would blow away the search-input focus state.
        _mpUpdateFilterBtn();
        await _mpRenderList();
    };

    // Keep the filter-button .active state + badge in sync with _mpFilters
    // without re-rendering the whole search row (preserves input focus).
    const _mpUpdateFilterBtn = () => {
        const btn = document.querySelector('.mp-filter-btn');
        if (!btn) return;
        const active = _mpHasActiveFilters();
        btn.classList.toggle('active', active);
        const oldBadge = btn.querySelector('.mp-filter-badge');
        if (active) {
            const count = String(_mpActiveFilterCount());
            if (oldBadge) oldBadge.textContent = count;
            else {
                const b = document.createElement('span');
                b.className = 'mp-filter-badge';
                b.textContent = count;
                btn.appendChild(b);
            }
        } else if (oldBadge) {
            oldBadge.remove();
        }
    };
    let _mpSearchTimer = null;
    const mpSearchInput = (v) => {
        _mpSearch = v || '';
        clearTimeout(_mpSearchTimer);
        _mpSearchTimer = setTimeout(() => { _mpRenderList(); }, 220);
    };
    const mpAdd = () => {
        if (_mpTab === 'customers' && typeof window.app?.openAddCustomerModal === 'function') {
            try { window.app.openAddCustomerModal(); return; } catch (_) { /* intentional: falls through to prospect modal / toast */ }
        }
        if (typeof window.app?.openAddProspectModal === 'function') {
            try { window.app.openAddProspectModal(); return; } catch (_) { /* intentional: falls through to toast if modal unavailable */ }
        }
        UI.toast.success('Add');
    };

    // ── Mobile filters modal ─────────────────────────────────
    // Bottom-sheet style filter modal matching the desktop's filter set
    // (subset: status, agent, ming gua, score range, pipeline stage for
    // prospects). UI.showModal handles the bottom-sheet styling on mobile
    // because the modal-overlay aligns to flex-end on <=768px.
    const mpOpenFilters = async () => {
        const isCust = _mpTab === 'customers';
        // Build agent options from _mpAgentMap (already loaded by the list).
        // If somehow empty, fall back to a one-off fetch.
        let agentEntries = _mpAgentMap ? Array.from(_mpAgentMap.entries()) : [];
        if (!agentEntries.length) {
            try {
                const agents = await AppDataStore.getAll('users');
                _mpAgentMap = new Map(
                    (agents || []).filter(u => u.agent_code || u.full_name)
                        .map(u => [String(u.id), { code: u.agent_code || '', name: u.full_name || '' }])
                );
                agentEntries = Array.from(_mpAgentMap.entries());
            } catch (_) { /* intentional: agent dropdown degrades to "All Agents" only */ }
        }
        agentEntries.sort((a, b) => (a[1].name || '').localeCompare(b[1].name || ''));
        const agentOptions = agentEntries.map(([id, e]) => {
            const label = e.code ? `${e.name || 'Unknown'} (${e.code})` : (e.name || 'Unknown');
            const sel = String(_mpFilters.agentId) === String(id) ? 'selected' : '';
            return `<option value="${_mhomeEsc(id)}" ${sel}>${_mhomeEsc(label)}</option>`;
        }).join('');

        const statusOpts = isCust
            ? [['active','Active'],['inactive','Inactive']]
            : [['active','Active'],['converted','Converted'],['lost','Lost']];
        const statusHtml = statusOpts.map(([v, l]) =>
            `<option value="${v}" ${_mpFilters.status === v ? 'selected' : ''}>${l}</option>`
        ).join('');

        const mgOpts = [
            ['MG1','MG1 坎'],['MG2','MG2 坤'],['MG3','MG3 震'],['MG4','MG4 巽'],
            ['MG5','MG5'],['MG6','MG6 乾'],['MG7','MG7 兑'],['MG8','MG8 艮'],['MG9','MG9 离'],
        ];
        const mgHtml = mgOpts.map(([v, l]) =>
            `<option value="${v}" ${_mpFilters.mingGua === v ? 'selected' : ''}>${l}</option>`
        ).join('');

        const pipelineOpts = [
            ['new','New'],['contacted','Contacted'],['qualified','Qualified'],
            ['proposal','Proposal'],['negotiation','Negotiation'],
            ['closed_won','Closed Won'],['closed_lost','Closed Lost'],
        ];
        const pipelineHtml = pipelineOpts.map(([v, l]) =>
            `<option value="${v}" ${_mpFilters.pipelineStage === v ? 'selected' : ''}>${l}</option>`
        ).join('');

        const body = `
            <div class="mp-filter-form">
                <div class="mp-filter-group">
                    <label for="mpf-status">Status</label>
                    <select id="mpf-status" class="form-control">
                        <option value="">All</option>
                        ${statusHtml}
                    </select>
                </div>
                <div class="mp-filter-group">
                    <label for="mpf-agent">Responsible Agent</label>
                    <select id="mpf-agent" class="form-control">
                        <option value="">All Agents</option>
                        ${agentOptions}
                    </select>
                </div>
                <div class="mp-filter-group">
                    <label for="mpf-minggua">Ming Gua</label>
                    <select id="mpf-minggua" class="form-control">
                        <option value="">All</option>
                        ${mgHtml}
                    </select>
                </div>
                <div class="mp-filter-group">
                    <label>Score Range</label>
                    <div style="display:flex;gap:8px;">
                        <input type="number" id="mpf-score-min" class="form-control" placeholder="Min" value="${_mhomeEsc(String(_mpFilters.scoreMin ?? ''))}" inputmode="numeric">
                        <input type="number" id="mpf-score-max" class="form-control" placeholder="Max" value="${_mhomeEsc(String(_mpFilters.scoreMax ?? ''))}" inputmode="numeric">
                    </div>
                </div>
                ${!isCust ? `
                <div class="mp-filter-group">
                    <label for="mpf-pipeline">Pipeline Stage</label>
                    <select id="mpf-pipeline" class="form-control">
                        <option value="">All Stages</option>
                        ${pipelineHtml}
                    </select>
                </div>
                ` : ''}
            </div>
        `;
        // UI.showModal expects { label, type, action } — not { text, class, action }.
        // Passing the wrong keys silently renders the button text as "undefined".
        const buttons = [
            { label: 'Clear', type: 'secondary', action: 'app.mpClearFilters()' },
            { label: 'Apply', type: 'primary',   action: 'app.mpApplyFilters()' },
        ];
        UI.showModal(`Filter ${isCust ? 'Customers' : 'Prospects'}`, body, buttons);
    };

    const mpApplyFilters = async () => {
        const v = (id) => (document.getElementById(id)?.value || '').trim();
        _mpFilters = {
            status: v('mpf-status'),
            agentId: v('mpf-agent'),
            mingGua: v('mpf-minggua'),
            scoreMin: v('mpf-score-min'),
            scoreMax: v('mpf-score-max'),
            pipelineStage: v('mpf-pipeline'),
        };
        UI.hideModal();
        // Drop the snapshot so a stale unfiltered cache doesn't paint over the
        // narrowed list on the next visit. _mpRenderList skips saving while
        // filters are active, so this stays clear until filters are reset.
        try { localStorage.removeItem(`mp-list-snap-v3-${_mpTab}`); } catch(_) { /* intentional: snapshot eviction is best-effort */ }
        _mpUpdateFilterBtn();
        await _mpRenderList();
    };

    const mpClearFilters = async () => {
        _mpFilters = { status: '', agentId: '', mingGua: '', scoreMin: '', scoreMax: '', pipelineStage: '' };
        UI.hideModal();
        try { localStorage.removeItem(`mp-list-snap-v3-${_mpTab}`); } catch(_) { /* intentional: snapshot eviction is best-effort */ }
        _mpUpdateFilterBtn();
        await _mpRenderList();
    };

    // ── Table data-label injection ───────────────────────────
    // Run after every table render so mobile cards show column labels
    const applyMobileTableLabels = () => {
        if (!isMobile()) return;
        document.querySelectorAll('table').forEach(table => {
            const headers = [...table.querySelectorAll('thead th')].map(th => th.textContent.trim());
            if (!headers.length) return;
            table.querySelectorAll('tbody tr').forEach(tr => {
                [...tr.querySelectorAll('td')].forEach((td, i) => {
                    if (headers[i] && !td.hasAttribute('data-label')) {
                        td.setAttribute('data-label', headers[i]);
                    }
                });
            });
        });
    };

    // ── Swipe gestures ───────────────────────────────────────
    // Idempotent: repeated calls remove the previous handlers before
    // re-attaching so we don't stack listeners on every view switch.
    let _swipeHandlers = null;
    const initSwipeActions = () => {
        if (_swipeHandlers) {
            document.removeEventListener('touchstart', _swipeHandlers.start);
            document.removeEventListener('touchend', _swipeHandlers.end);
        }
        let startX = 0;
        const onStart = (e) => { startX = e.touches[0].clientX; };
        const onEnd = (e) => {
            const diff = e.changedTouches[0].clientX - startX;
            if (diff > 60 && startX < 30 && isMobile()) openMobileDrawer();
            if (diff < -60 && isMobile()) closeMobileDrawer();
        };
        document.addEventListener('touchstart', onStart, { passive: true });
        document.addEventListener('touchend', onEnd, { passive: true });
        _swipeHandlers = { start: onStart, end: onEnd };
    };

    // ── Pull-to-refresh (fixed) ──────────────────────────────
    // Idempotent: tagged with data-ptr-attached so repeated init calls
    // don't stack listeners on the same .content-viewport node.
    const initPullToRefresh = async () => {
        const content = document.querySelector('.content-viewport');
        if (!content) return;
        if (content.dataset.ptrAttached === '1') return;
        content.dataset.ptrAttached = '1';

        let startY = 0;
        const refreshEl = document.createElement('div');
        refreshEl.className = 'pull-to-refresh';
        refreshEl.innerHTML = '<i class="fas fa-arrow-down"></i> Pull to refresh';
        content.parentNode.insertBefore(refreshEl, content);

        content.addEventListener('touchstart', (e) => {
            if (content.scrollTop === 0) startY = e.touches[0].clientY;
        }, { passive: true });

        content.addEventListener('touchmove', (e) => {
            if (!startY) return;
            const diff = e.touches[0].clientY - startY;
            if (diff > 0) {
                refreshEl.classList.add('show');
                if (diff > 80) refreshEl.innerHTML = '<i class="fas fa-arrow-up"></i> Release to refresh';
            }
        }, { passive: true });

        content.addEventListener('touchend', async (e) => {
            if (!startY) return;
            const diff = e.changedTouches[0].clientY - startY;
            if (diff > 80) {
                refreshEl.innerHTML = '<i class="fas fa-sync-alt fa-spin"></i> Refreshing...';
                // Invalidate the in-memory caches for the tables this view reads
                // so newly-created activities (added moments ago in another tab
                // or by another user) actually show up after the refresh —
                // otherwise SWR re-serves the stale snapshot and the user sees
                // no change.
                try {
                    AppDataStore.invalidateCache('activities');
                    AppDataStore.invalidateCache('events');
                    AppDataStore.invalidateCache('event_registrations');
                    AppDataStore.invalidateCache('event_attendees');
                    AppDataStore.invalidateCache('prospects');
                    AppDataStore.invalidateCache('customers');
                } catch (_) { /* intentional: cache invalidation is best-effort before refetch */ }
                // Bypass the mobile localStorage snapshots once so the manual
                // refresh actually pulls live data for Home/Calendar/Clients.
                _mobileForceFresh = true;
                _clearMobileSnapshots();
                // If inside a prospect/customer profile, reload that profile — not the list.
                if (_state.cdv?.type === 'prospect') {
                    await (window.app.showProspectDetail || (() => {}))(_state.cdv.id);
                } else if (_state.cdv?.type === 'customer') {
                    await (window.app.showCustomerDetail || (() => {}))(_state.cdv.id);
                } else {
                    await navigateTo(_state.cv || (isMobile() ? 'home' : 'calendar'));
                }
                refreshEl.classList.remove('show');
                refreshEl.innerHTML = '<i class="fas fa-arrow-down"></i> Pull to refresh';
            } else {
                refreshEl.classList.remove('show');
                refreshEl.innerHTML = '<i class="fas fa-arrow-down"></i> Pull to refresh';
            }
            startY = 0;
        }, { passive: true });
    };


    // ── Attach public functions to window.app ────────────────────────────
    app.register('mobile', {
        addCustomerNote,
        deleteCustomerNote,
        addAgentNote,
        deleteAgentNote,
        openVoiceRecorder,
        startRecording,
        stopRecording,
        processRecording,
        saveTranscription,
        createNoteFromVoice,
        editTranscription,
        discardRecording,
        closeVoiceRecorder,
        deleteAudio,
        openVoiceSettings,
        saveVoiceSettings,
        renderMobileDrawer,
        openMobileDrawer,
        closeMobileDrawer,
        // applyMobileClass is defined in script.js (called early in init before chunk loads)
        toggleMobileNav,
        renderMobileBottomNav,
        updateBottomNavActive,
        showMobileMenu,
        showMobileHomeView,
        mhomeWa,
        mhomeFollowupWa,
        mhomeOpenFollowups,
        mhomeOpenRefills,
        showMobileCalendarView,
        showMobileCalendarWeek,
        showMobileCalendarDay,
        showMobileCalendarAgenda,
        mcalPrevMonth,
        mcalNextMonth,
        mcalPrev,
        mcalNext,
        mcalToday,
        mcalRefreshActiveView,
        mcalDayClick,
        mcalOpenEvent,
        mcalBirthdayWa,
        mcalTeamBirthdayWa,
        mcalOpenPerson,
        mcalOpenDay,
        mcalAddMeetUp,
        mcalTab,
        mcalFilter,
        mcalAdd,
        mcalWa,
        mcalApptWa,
        showMobileProspectsView,
        showProspectsViewSmart,
        mpSwitchTab,
        mpSearchInput,
        mpAdd,
        mpOpenFilters,
        mpApplyFilters,
        mpClearFilters,
        applyMobileTableLabels,
        initSwipeActions,
        initPullToRefresh,
        // Optimistic-calendar helpers called by script-activities.js on mobile save path
        _mcalOptimisticInsert,
        _mcalOptimisticSwap,
        _mcalOptimisticMarkFailed,
        _mcalEnqueueRetry,
        // initMobileApp and addMobileMetaTags are defined in script-features2 chunk — exported from there
        // Snapshot invalidation helper — called by script.js DataStore event listener
        _clearMobileSnapshots,
    });
})();