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
    const navigateTo = (v) => window.app.navigateTo(v);
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
                date: new Date().toISOString().split('T')[0]
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
                date: new Date().toISOString().split('T')[0]
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

            // Start timer
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
        const voiceSettings = UserPreferences.getSync('voice_settings', {});
        const delay = voiceSettings.quality === 'high' ? 3000 : voiceSettings.quality === 'fast' ? 1000 : 2000;

        return new Promise(resolve => setTimeout(() => {
            const samples = [
                "Customer is facing career stagnation and financial difficulties. Interested in PR4 solution. Office located in Bangsar with main entrance facing North-West.",
                "Discussed upcoming Feng Shui workshop. Client wants to bring two friends. Follow up next week with registration details.",
                "Property audit completed. Main entrance faces South, which is favorable for career. Recommended placing water feature in North area.",
                "Client interested in Harmony Painting for living room. Wants to know if it matches their Wood element.",
                "Follow-up call: Client decided to proceed with PR4 purchase. Payment scheduled for next Friday. Need to prepare invoice.",
                "Birthday greeting sent. Client replied with thanks and mentioned interest in office audit for new company premises."
            ];

            const transcribedText = samples[Math.floor(Math.random() * samples.length)];

            const transcribedEl = document.getElementById('voice-transcribed-text');
            const micIcon = document.getElementById('voice-mic-icon');
            const actionsEl = document.getElementById('voice-recorder-actions');

            if (transcribedEl) { transcribedEl.value = transcribedText; transcribedEl.placeholder = ''; }
            if (micIcon) micIcon.className = 'fas fa-microphone';
            if (actionsEl) actionsEl.style.display = 'flex';

            UI.toast.success('Transcription complete!');
            resolve();
        }, delay));
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
            // Create a note record
            await createNoteFromVoice(target.entityType, target.entityId, transcribedText);
            UI.hideModal();
            UI.toast.success('Voice note saved');
        }
    };

    const createNoteFromVoice = async (entityType, entityId, text) => {
        const currentUser = await Auth.getCurrentUser();
        const noteData = {
            text,
            author: currentUser?.full_name || 'System',
            date: new Date().toISOString().split('T')[0],
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
        } catch (e) { UI.toast.error('Failed to save voice note: ' + (e?.message || e)); }
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
        // #5 fix: added 'knowledge' and 'noticeboard' to _l12 (mirrors desktop script.js:1349)
        const _l12 = ['calendar', 'prospects', 'referrals', 'pipeline', 'promotions', 'cases', 'reports', 'documents', 'knowledge', 'settings', 'fude', 'milestones'];
        const perms = {
            // #5 fix: added 'knowledge' to L1-L4 and 'noticeboard'/'knowledge' to match desktop levelPermissions
            1: ['calendar','prospects','referrals','pipeline','promotions','marketing-automation','marketing-lists','cases','purchases_history','agents','performance','reports','risk','ai-insights','security','admin','protection','documents','knowledge','import','integrations','settings','fude','milestones','noticeboard','lead_forms','surveys','contracts','custom_fields','booking_settings','egg-purchasing','formula-purchaser','stock-take','org-chart'],
            2: ['calendar','prospects','referrals','pipeline','promotions','marketing-automation','marketing-lists','cases','agents','performance','reports','risk','ai-insights','security','admin','protection','documents','knowledge','import','integrations','settings','fude','milestones','noticeboard','lead_forms','surveys','contracts','custom_fields','booking_settings','org-chart'],
            3: ['calendar','prospects','referrals','pipeline','promotions','cases','performance','reports','protection','documents','knowledge','settings','fude'],
            4: ['calendar','prospects','referrals','pipeline','promotions','cases','performance','reports','protection','documents','knowledge','settings','fude'],
            5: _l12, 6: _l12, 7: _l12, 8: _l12, 9: _l12, 10: _l12,
            11: ['calendar','prospects','referrals','promotions','cases','knowledge','settings','fude','milestones'],
            // #6 fix: added 'noticeboard' to L12/L13/L14 (customers must reach Noticeboard on mobile)
            12: ['noticeboard','prospects','referrals','fude','milestones'],
            13: ['noticeboard','prospects','fude','milestones'],
            14: ['noticeboard','prospects','fude','milestones'],
            // Level 15 Stock Take Staff — per-store counter accounts that only
            // see the Stock Take tab. Inside the module they only get the
            // count / recount / summary sub-tabs (gated in showStockTakeView).
            15: ['stock-take'],
        };
        let level = 12;
        const user = _state.cu;
        if (user?.role) {
            const m = user.role.match(/Level\s+(\d+)/i);
            if (m) { level = parseInt(m[1]); }
            else {
                const r = user.role.toLowerCase();
                if (r === 'super_admin' || r === 'admin') level = 1;
                else if (r === 'marketing_manager') level = 2;
                else if (r === 'manager') level = 4;
                else if (r === 'team_leader') level = 5;
                else if (r === 'consultant') level = 7;
                else if (r === 'agent') level = 10;
                else if (r === 'customer') level = 13;
                else if (r === 'referrer') level = 14;
            }
        }
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
    const renderMobileBottomNav = async () => {
        if (document.querySelector('.mobile-bottom-nav')) return;
        const bottomNav = document.createElement('div');
        bottomNav.className = 'mobile-bottom-nav';
        bottomNav.id = 'mobile-bottom-nav';
        bottomNav.innerHTML = `
            <a class="mobile-bottom-nav-item" data-view="home" href="#" onclick="event.preventDefault(); app.navigateTo('home')">
                <i class="fas fa-house"></i><span>Home</span>
            </a>
            <a class="mobile-bottom-nav-item" data-view="calendar" href="#" onclick="event.preventDefault(); app.navigateTo('calendar')">
                <i class="far fa-calendar"></i><span>Calendar</span>
            </a>
            <a class="mobile-bottom-nav-item" data-view="prospects" href="#" onclick="event.preventDefault(); app.navigateTo('prospects')">
                <i class="fas fa-user-group"></i><span>Clients</span>
            </a>
            <a class="mobile-bottom-nav-item" data-view="reports" href="#" onclick="event.preventDefault(); app.navigateTo('reports')">
                <i class="fas fa-chart-column"></i><span>Insights</span>
            </a>
            <a class="mobile-bottom-nav-item" id="mobile-more" href="#" onclick="event.preventDefault(); app.openMobileDrawer()">
                <i class="fas fa-ellipsis"></i><span>More</span>
            </a>
        `;
        document.body.appendChild(bottomNav);
    };

    const updateBottomNavActive = (viewId) => {
        // Calendar/month share the same tab; prospects + customers both highlight Clients.
        const tabFor = (v) => {
            if (v === 'home') return 'home';
            if (v === 'month' || v === 'calendar') return 'calendar';
            if (v === 'prospects' || v === 'customers') return 'prospects';
            if (v === 'reports') return 'reports';
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
        return digits;
    };

    const showMobileHomeView = async (viewport) => {
        if (!viewport) return;
        viewport.classList.add('mhome-active');

        // ── Perf instrumentation (mobile Home Tier 0) ────────────
        // Look for "[mhome-perf]" rows in the console to see where the cold
        // home load is spending time.
        const _mhomePerfT0 = performance.now();
        const _mhomePerf = (label) => {
            try { console.info(`[mhome-perf] ${label} +${Math.round(performance.now() - _mhomePerfT0)}ms`); } catch(_) {}
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

        // Instant snapshot restore — localStorage persists across app close (8hr TTL)
        const _mhomeSnapKey = `mhome-snap-${now.getFullYear()}-${now.getMonth()}-${now.getDate()}`;
        let _mhomeCached;
        try {
            const _snapRaw = localStorage.getItem(_mhomeSnapKey);
            if (_snapRaw) {
                const { ts, val } = JSON.parse(_snapRaw);
                if (Date.now() - ts < 8 * 60 * 60 * 1000) _mhomeCached = val;
                else localStorage.removeItem(_mhomeSnapKey);
            }
        } catch(_) {}
        const _mhomeInitBody = _mhomeCached || `
                <div class="mhome-ai-card"><div class="mhome-ai-top" style="min-height:160px;">
                    <span class="mhome-arc"></span>
                    <span class="mhome-orb o1"></span><span class="mhome-orb o2"></span><span class="mhome-orb o3"></span>
                    <div class="mhome-ai-head">
                        <div class="mhome-ai-icon"><i class="fas fa-wand-magic-sparkles"></i></div>
                        <div><div class="mhome-ai-title">AI Assistant</div><div class="mhome-ai-sub">Loading today's snapshot…</div></div>
                    </div>
                </div></div>`;

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
        if (typeof isSystemAdmin === 'function' && !isSystemAdmin(_state.cu) && visibleIds !== 'all') {
            actQueryOpts.scopeFields = [
                { field: 'lead_agent_id', values: visibleIds },
                { field: 'visibility', values: ['open', 'public'] }
            ];
        }

        // 1-hour people cache — prospects+customers rarely change mid-session and
        // are only needed for birthday lookup + activity name display on this view.
        const _mhomePeopleKey = 'mhome-people-v1';
        const _mhomeLsGet = (key, ttl) => {
            try {
                const raw = localStorage.getItem(key);
                if (!raw) return null;
                const { ts, val } = JSON.parse(raw);
                if (Date.now() - ts > ttl) { localStorage.removeItem(key); return null; }
                return val;
            } catch(_) { return null; }
        };
        const _mhomeLsSet = (key, val) => {
            try { localStorage.setItem(key, JSON.stringify({ ts: Date.now(), val })); } catch(_) {}
        };
        // Pull-to-refresh forces a one-time bypass of every cold cache below.
        const _mhomeForce = _mobileForceFresh; _mobileForceFresh = false;
        // Cold reference data (people/customers/users) is held for 8h and only
        // refetched when edited or force-refreshed — it's rarely reviewed anew.
        // Today's activities + drafts + refills stay hot (fetched fresh on load).
        let cachedPeople    = _mhomeForce ? null : _mhomeLsGet(_mhomePeopleKey,    8 * 60 * 60 * 1000);
        const _needPeople = !cachedPeople;

        const _mhomeDraftsKey     = 'mhome-drafts-v1';
        const _mhomeRefillsKey    = 'mhome-refills-v1';
        const _mhomeUsersKey      = 'mhome-users-v1';
        const _mhomeCustomersKey  = 'mhome-customers-v1';
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
        const activities = (actResult.data || []).filter(a => a.activity_type !== 'EVENT');

        // Background data — repaint when each lands. The guard
        // (_state.cv === 'home') makes a stale repaint harmless if the
        // user has navigated away.
        const _mhomeRepaint = () => {
            if (_state.cv !== 'home') return;
            if (!document.getElementById('mhome-body')) return;
            _composeBody(cachedPeople || [], cachedUsers || [], cachedCustomers || [], !cachedPeople);
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
                select: 'id,full_name,date_of_birth,role,reporting_to,team_id,phone',
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

        // Single source of truth for the dashboard HTML. Called once when the
        // people base is warm, or twice on a cold load (fast partial pass with
        // peoplePending=true, then a full pass from the background fetch).
        const _composeBody = (allPeople, cachedUsers, cachedCustomers, peoplePending) => {
        allPeople = allPeople || [];
        cachedUsers = cachedUsers || [];
        cachedCustomers = cachedCustomers || [];
        const _pendNum = '<i class="fas fa-spinner fa-spin" style="font-size:11px;opacity:.55"></i>';
        const personMap = new Map(allPeople.map(p => [String(p.id), p]));
        const _isMine = (d) => !d.agent_id || String(d.agent_id) === String(_state.cu?.id);
        const visibleDrafts = cachedDrafts.filter(d =>
            d.status === 'pending' && (d.due_date || '') <= todayStr && _isMine(d)
        );
        const birthdays = [...allPeople, ...cachedUsers].filter(p => {
            const dob = p.date_of_birth || '';
            if (!dob || dob.length < 5) return false;
            const md = dob.slice(5, 10);
            return md === todayMD || md === tomMD;
        });
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
            ? `app.mhomeWa(${oldestPerson.id ?? 'null'}, '${_mhomeEsc(oldestPerson.phone || '')}')`
            : (birthdays[0]
                ? `app.mhomeWa(${birthdays[0].id ?? 'null'}, '${_mhomeEsc(birthdays[0].phone || '')}')`
                : `app.navigateTo('calendar')`);

        const scheduleRows = activities.slice(0, 4).map(a => {
            const personId = a.prospect_id || a.customer_id;
            const person = personId ? personMap.get(String(personId)) : null;
            const time = (a.start_time || '00:00').slice(0, 5);
            const title = a.activity_type || 'Activity';
            const sub = person ? person.full_name : (a.notes || a.title || '—');
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
            if (oldestPerson) {
                const d = daysAgo(oldestDraft.due_date);
                const sub = (d != null && d >= 0) ? `Last contact ${d} day${d === 1 ? '' : 's'} ago` : 'Awaiting follow-up';
                const phone = _mhomeEsc(oldestPerson.phone || '');
                rows.push(`
                <div class="mhome-att-row followup">
                    <div class="mhome-att-avatar">${_mhomeEsc(_mhomeInitials(oldestPerson.full_name))}</div>
                    <div class="mhome-att-text">
                        <div class="mhome-att-name">${_mhomeEsc(oldestPerson.full_name || '—')}</div>
                        <div class="mhome-att-need">Needs follow-up</div>
                        <div class="mhome-att-sub">${_mhomeEsc(sub)}</div>
                    </div>
                    <button class="mhome-att-btn wa" onclick="app.mhomeWa(${oldestPerson.id ?? 'null'}, '${phone}')">
                        <i class="fab fa-whatsapp"></i> Send WhatsApp
                    </button>
                </div>`);
            }
            const bday = birthdays[0];
            if (bday) {
                const isToday = (bday.date_of_birth || '').slice(5,10) === todayMD;
                const phone = _mhomeEsc(bday.phone || '');
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
                    <div class="mhome-card-title"><span class="ico purple"><i class="fas fa-circle-exclamation"></i></span> Needs Your Attention</div>
                    <button class="mhome-card-link" onclick="app.openMobileDrawer()">View All ›</button>
                </div>
                ${rows.join('')}
            </div>`;
        };

        // Inactive: customers with last_contact_date older than 60 days, OR no contact ever.
        const inactiveCount = (() => {
            const sixtyAgo = Date.now() - 60 * 86400000;
            return (cachedCustomers || []).filter(c => {
                if (c.status === 'inactive') return true;
                const lc = c.last_contact_date || c.updated_at || c.created_at;
                if (!lc) return false;
                const t = new Date(lc).getTime();
                return !isNaN(t) && t < sixtyAgo;
            }).length;
        })();
        const overdueFollowups = visibleDrafts.filter(d => (d.due_date || '') < todayStr).length;

        // ── Compose body ─────────────────────────────────────────
        const body = document.getElementById('mhome-body');
        if (!body) return;
        // Track so we can save snapshot after render
        const _mhomeSaveSnap = (html) => { try { localStorage.setItem(_mhomeSnapKey, JSON.stringify({ ts: Date.now(), val: html })); } catch(_) {} };
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
            <button class="mhome-tile red" onclick="app.navigateTo('calendar')">
                <div class="mhome-tile-ico"><i class="fas fa-user-clock"></i></div>
                <div class="mhome-tile-lbl">Overdue Follow-ups</div>
                <div class="mhome-tile-num">${overdueFollowups}</div>
                <div class="mhome-tile-arrow"><i class="fas fa-chevron-right"></i></div>
            </button>
            <button class="mhome-tile wood" onclick="app.navigateTo('prospects')">
                <div class="mhome-tile-ico"><i class="fas fa-prescription-bottle-medical"></i></div>
                <div class="mhome-tile-lbl">Refills Due</div>
                <div class="mhome-tile-num">${refillCount}</div>
                <div class="mhome-tile-arrow"><i class="fas fa-chevron-right"></i></div>
            </button>
            <button class="mhome-tile purple" onclick="app.navigateTo('prospects')">
                <div class="mhome-tile-ico"><i class="fas fa-chart-column"></i></div>
                <div class="mhome-tile-lbl">Inactive Clients</div>
                <div class="mhome-tile-num">${peoplePending ? _pendNum : inactiveCount}</div>
                <div class="mhome-tile-arrow"><i class="fas fa-chevron-right"></i></div>
            </button>
        </div>`;
        // Only persist a complete render — never cache the partial pending state.
        if (!peoplePending) _mhomeSaveSnap(body.innerHTML);
        }; // end _composeBody

        if (cachedPeople) {
            // Warm base → render everything in one pass.
            _composeBody(cachedPeople, cachedUsers, cachedCustomers, false);
        } else {
            // ── Mobile Home Tier 1.2: paint NOW, fill people in async ──
            // Cold-base: previously we awaited two queryAdvanced round-trips
            // (refId prospects + refId customers) before the first paint,
            // adding ~500-1500 ms on a slow connection. Now we paint
            // immediately with an empty personMap, then trigger repaints as
            // each layer of person data lands — first the refId-scoped names
            // (cheap, only the people referenced today), then the full base
            // (for birthdays + inactive count).
            _composeBody([], cachedUsers, cachedCustomers || [], true);
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
                    _composeBody(partialPeople, cachedUsers, cachedCustomers || [], true);
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
                    _composeBody(cachedPeople, cachedUsers, cachedCustomers, false);
                }
            })().catch(() => {});
        }
    };

    // Quick handler — open WhatsApp for the given phone, or fall back to
    // navigating to the customer/prospect detail when no phone is on file.
    const mhomeWa = (id, phone) => {
        const num = _mhomeWaPhone(phone);
        if (num) {
            window.open(`https://wa.me/${num}`, '_blank', 'noopener');
        } else if (id) {
            navigateTo('prospects').catch(() => {});
        }
    };

    // ── Mobile Calendar (month grid) ─────────────────────────
    // Custom mobile-only month-grid layout that matches the Home dashboard's
    // brand palette. Uses the same activity dataset as the desktop calendar.
    let _mcalYear = null;
    let _mcalMonth = null;
    let _mcalByDate = new Map();
    let _mcalPersonMap = new Map();

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
    const _mcalRetryQueueRead = () => {
        try { return JSON.parse(localStorage.getItem(_MCAL_RETRY_QUEUE_KEY) || '[]'); } catch(_) { return []; }
    };
    const _mcalRetryQueueWrite = (q) => {
        try { localStorage.setItem(_MCAL_RETRY_QUEUE_KEY, JSON.stringify(q)); } catch(_) {}
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
                if (pfx.some(p => k.startsWith(p))) toRemove.push(k);
            }
            toRemove.forEach(k => { try { localStorage.removeItem(k); } catch(_) {} });
        } catch(_) {}
    };
    const _mcalColorForType = (type) => {
        const t = String(type || '').toLowerCase();
        if (t.includes('birthday') || t.includes('all day') || t.includes('all-day')) return 'allday';
        if (t.includes('client meeting') || t.includes('client mtg') || t.includes('meeting')) return 'red';
        if (t.includes('cps') || t.includes('consult') || t.includes('follow')) return 'purple';
        if (t.includes('team')) return 'pink';
        if (t.includes('review')) return 'peach';
        if (t.includes('training') || t.includes('product') || t.includes('workshop')) return 'green';
        const palette = ['red','purple','pink','peach','green'];
        let h = 0; for (let i = 0; i < t.length; i++) h = (h * 31 + t.charCodeAt(i)) | 0;
        return palette[Math.abs(h) % palette.length];
    };
    const _mcalShortTitle = (a, personMap) => {
        const pid = a.prospect_id || a.customer_id;
        const person = pid ? personMap.get(String(pid)) : null;
        if (person?.full_name) {
            const parts = String(person.full_name).split(/\s+/);
            return parts[0]; // first name fits the cell
        }
        const t = String(a.activity_type || a.title || 'Event');
        const w = t.split(/\s+/);
        return w.length >= 2 ? `${w[0]} ${w[1].charAt(0)}` : t;
    };

    const showMobileCalendarView = async (viewport) => {
        if (!viewport) return;
        viewport.classList.add('mcal-active');

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
            } catch(_) { return null; }
        };
        const _lsSet = (key, val) => {
            try { localStorage.setItem(key, JSON.stringify({ ts: Date.now(), val })); } catch(_) {}
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
            try { console.info(`[mcal-perf] ${label} +${Math.round(performance.now() - _mcalPerfT0)}ms`); } catch(_) {}
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
        const _lsGetRaw = (key) => { try { const r = localStorage.getItem(key); if (!r) return null; return JSON.parse(r).val; } catch(_) { return null; } };
        const _cachedActs = _forceFresh ? null : _lsGetRaw(_mcalActsKey);

        // Start visibleIds resolution early (non-blocking) so it runs
        // concurrently with cache reads below.
        const _visibleIdsP = (typeof getVisibleUserIds === 'function')
            ? getVisibleUserIds(_state.cu).catch(() => 'all') : Promise.resolve('all');

        // B: Serve prospects + customers from localStorage cache (cold reference
        // data — birthdays/names rarely change; invalidated on edit).
        const _PEOPLE_KEY  = 'mcal-people-v1';
        const _DRAFTS_KEY  = 'mcal-drafts-v1';
        const _REFILLS_KEY = 'mcal-refills-v1';
        let allPeople     = _forceFresh ? null : _lsGet(_PEOPLE_KEY,  8 * 60 * 60 * 1000);
        let cachedDrafts  = _forceFresh ? null : _lsGet(_DRAFTS_KEY,   5 * 60 * 1000);
        let cachedRefills = _forceFresh ? null : _lsGet(_REFILLS_KEY,  5 * 60 * 1000);
        const _needPeople  = !allPeople;
        const _needDrafts  = !cachedDrafts;
        const _needRefills = !cachedRefills;

        const visibleIds = await _visibleIdsP;

        const _scopeFields = (typeof isSystemAdmin === 'function' && !isSystemAdmin(_state.cu) && visibleIds !== 'all')
            ? [ { field: 'lead_agent_id', values: visibleIds }, { field: 'visibility', values: ['open', 'public'] } ]
            : null;
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
            _actsP = AppDataStore.queryAdvanced('activities', _buildActOpts(monthStartStr, monthEndStr)).catch(() => ({ data: [] }));
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
                _needPeople  ? AppDataStore.queryAdvanced('prospects', { select: 'id,full_name,date_of_birth', limit: 50000, countMode: null }).then(r => r?.data || []).catch(() => []) : Promise.resolve(null),
                _needPeople  ? AppDataStore.queryAdvanced('customers', { select: 'id,full_name,date_of_birth', limit: 50000, countMode: null }).then(r => r?.data || []).catch(() => []) : Promise.resolve(null),
                _needDrafts  ? AppDataStore.getAll('follow_up_drafts').catch(() => []) : Promise.resolve(null),
                _needRefills ? AppDataStore.query('refill_reminders', { status: 'pending' }).catch(() => []) : Promise.resolve(null),
            ]).then(([p, c, d, r]) => {
                _mcalPerf('phase2:people-drafts-refills:done');
                if (p !== null || c !== null) {
                    const fresh = [...(p || []), ...(c || [])];
                    _lsSet(_PEOPLE_KEY, fresh);
                }
                if (d !== null) _lsSet(_DRAFTS_KEY,  d);
                if (r !== null) _lsSet(_REFILLS_KEY, r);
                // Silent re-render so names + birthdays + coming-up strip
                // fill in. Guarded so we don't repaint a month the user has
                // already swiped away from.
                const vp = document.getElementById('content-viewport');
                if (vp && vp.classList.contains('mcal-active') &&
                    _capturedYearMcal === _mcalYear && _capturedMonthMcal === _mcalMonth) {
                    showMobileCalendarView(vp).catch(() => {});
                }
            }).catch(() => {});
        }

        // First-paint fallbacks: ensure downstream code handles missing data
        // without throwing. On cold load these are empty; the Phase 2 re-render
        // swaps in real values.
        allPeople     = allPeople     || [];
        cachedDrafts  = cachedDrafts  || [];
        cachedRefills = cachedRefills || [];
        const draftsR  = cachedDrafts;
        const refillsR = cachedRefills;

        // Resolve this month's activity set from cache or fresh fetch.
        let activities;
        if (_actMode === 'cache') {
            activities = (_cachedActs || []).filter(a => a.activity_type !== 'EVENT');
        } else {
            activities = (actResult?.data || []).filter(a => a.activity_type !== 'EVENT');
            _lsSet(_mcalActsKey, activities);
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
        // Inject birthdays into matching dates within this month
        const mmdd = (m, d) => `${String(m).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
        for (const p of allPeople) {
            const dob = p.date_of_birth || '';
            if (!dob || dob.length < 10) continue;
            const md = dob.slice(5, 10); // MM-DD
            // Find the date in this month with this MM-DD
            const [_pm, _pd] = md.split('-').map(n => parseInt(n));
            if (_pm - 1 !== _mcalMonth) continue;
            if (_pd < 1 || _pd > daysInMonth) continue;
            const k = `${_mcalYear}-${String(_mcalMonth+1).padStart(2,'0')}-${String(_pd).padStart(2,'0')}`;
            if (!byDate.has(k)) byDate.set(k, []);
            byDate.get(k).push({ activity_type: 'All Day Birthday', _isBirthday: true, _person: p });
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
            const dayActs = byDate.get(k) || [];
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
            _lsSet(_mcalSnapKey, cells.join(''));
            _mcalPerf('grid-painted');
        }

        // ── Coming-up strip ─────────────────────────────────────
        const todayStr = `${todayY}-${String(todayM+1).padStart(2,'0')}-${String(todayDay).padStart(2,'0')}`;
        const tom = new Date(todayD); tom.setDate(tom.getDate()+1);
        const todayMD = mmdd(todayM+1, todayDay);
        const tomMD = mmdd(tom.getMonth()+1, tom.getDate());
        const bdayCount = allPeople.filter(p => {
            const dob = p.date_of_birth || ''; if (dob.length < 10) return false;
            const md = dob.slice(5, 10); return md === todayMD || md === tomMD;
        }).length;
        const refillCount = (refillsR || []).length;
        const overdueFollowups = (draftsR || []).filter(d =>
            d.status === 'pending' && (d.due_date || '') < todayStr &&
            (!d.agent_id || String(d.agent_id) === String(_state.cu?.id))
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
                            <div class="mcal-coming-lbl">Tomorrow</div>
                        </div>
                    </button>
                    <button class="mcal-coming-item refill" onclick="app.navigateTo('home')">
                        <div class="ico"><i class="fas fa-prescription-bottle-medical"></i></div>
                        <div class="mcal-coming-text">
                            <div class="mcal-coming-num">${refillCount}<small>Refills</small></div>
                            <div class="mcal-coming-lbl">This Week</div>
                        </div>
                    </button>
                    <button class="mcal-coming-item followup" onclick="app.navigateTo('home')">
                        <div class="ico"><i class="fas fa-user-clock"></i></div>
                        <div class="mcal-coming-text">
                            <div class="mcal-coming-num">${overdueFollowups}<small>Follow-ups</small></div>
                            <div class="mcal-coming-lbl">Overdue</div>
                        </div>
                    </button>
                </div>
            </div>`;
            _lsSet(_mcalSnapKey + '-coming', comingHost.innerHTML);
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
                        const freshRaw = (res?.data || []).filter(a => a.activity_type !== 'EVENT');
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
                            if (vp && vp.classList.contains('mcal-active')) {
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
        try { cached = JSON.parse(localStorage.getItem(key) || '{}').val || []; } catch(_) {}
        if (!Array.isArray(cached)) cached = [];
        // Avoid double-insert if called twice with same tmp id
        if (cached.some(a => String(a.id) === String(row.id))) return;
        cached.push(row);
        try { localStorage.setItem(key, JSON.stringify({ ts: Date.now(), val: cached })); } catch(_) {}
        _mcalOptimisticRows.set(String(row.id), { key, row });
        // If the calendar is currently showing this month, re-render now.
        const vp = document.getElementById('content-viewport');
        if (vp && vp.classList.contains('mcal-active') && _mcalYear === y && _mcalMonth === (m - 1)) {
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
        try { cached = JSON.parse(localStorage.getItem(key) || '{}').val || []; } catch(_) {}
        if (!Array.isArray(cached)) return;
        const idx = cached.findIndex(a => String(a.id) === String(tmpId));
        if (idx >= 0) {
            cached[idx] = { ...realRow, _pending: false };
        } else {
            cached.push({ ...realRow, _pending: false });
        }
        try { localStorage.setItem(key, JSON.stringify({ ts: Date.now(), val: cached })); } catch(_) {}
        // Re-render the mobile calendar if it's still showing the same month —
        // the SWR revalidation may have raced ahead and wiped the optimistic cell
        // before the real row arrived, so we repaint to ensure it stays visible.
        const [_swY, _swM] = key.replace('mcal-acts-', '').split('-').map(Number);
        const _swVp = document.getElementById('content-viewport');
        if (_swVp && _swVp.classList.contains('mcal-active') &&
            !isNaN(_swY) && !isNaN(_swM) && _mcalYear === _swY && _mcalMonth === _swM) {
            showMobileCalendarView(_swVp).catch(() => {});
        }
    };

    // Mark an optimistic row as failed-to-sync. Keeps it visible (so the
    // user doesn't think their save disappeared) but flags it for retry +
    // a small warning indicator in the grid.
    const _mcalOptimisticMarkFailed = (tmpId) => {
        const entry = _mcalOptimisticRows.get(String(tmpId));
        if (!entry) return;
        const { key } = entry;
        let cached = [];
        try { cached = JSON.parse(localStorage.getItem(key) || '{}').val || []; } catch(_) {}
        if (!Array.isArray(cached)) return;
        const idx = cached.findIndex(a => String(a.id) === String(tmpId));
        if (idx >= 0) {
            cached[idx] = { ...cached[idx], _pending: true, _syncFailed: true };
            try { localStorage.setItem(key, JSON.stringify({ ts: Date.now(), val: cached })); } catch(_) {}
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
        const q = _mcalRetryQueueRead();
        if (!q.length) return;
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
                    _mcalOptimisticMarkFailed(entry.tmpId);
                    continue;
                }
                remaining.push(entry);
            }
        }
        _mcalRetryQueueWrite(remaining);
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
    const mcalToday = async () => {
        const t = new Date();
        _mcalYear = t.getFullYear();
        _mcalMonth = t.getMonth();
        await showMobileCalendarView(document.getElementById('content-viewport'));
    };
    const mcalDayClick = (dateStr) => {
        const allDay    = _mcalByDate.get(dateStr) || [];
        const dayBdays  = allDay.filter(a => a._isBirthday);
        const dayActs   = allDay.filter(a => !a._isBirthday);
        const sorted    = [...dayActs].sort((a, b) => (a.start_time || '').localeCompare(b.start_time || ''));

        const d = new Date(dateStr + 'T00:00:00');
        const days   = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
        const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
        const dateLabel = `${days[d.getDay()]}, ${d.getDate()} ${months[d.getMonth()]} ${d.getFullYear()}`;

        // Birthday cards — shown at the top of the modal
        const bdayRows = dayBdays.map(a => {
            const p = a._person;
            const dob = p.date_of_birth || '';
            let ageStr = '';
            if (dob.length >= 4) {
                const age = d.getFullYear() - parseInt(dob.slice(0, 4));
                if (age > 0 && age < 120) ageStr = ` · Turning ${age}`;
            }
            return `
                <div style="display:flex;align-items:center;gap:12px;padding:12px 10px;margin-bottom:6px;background:linear-gradient(90deg,#FDF2F8,#fff);border-radius:10px;border:1px solid #FBCFE8;">
                    <div style="font-size:26px;flex-shrink:0;">🎂</div>
                    <div style="flex:1;min-width:0;">
                        <div style="font-size:15px;font-weight:700;color:#9D174D;">${_mhomeEsc(p.full_name || '—')}</div>
                        <div style="font-size:12px;color:#BE185D;margin-top:2px;">Birthday${ageStr}</div>
                    </div>
                </div>`;
        }).join('');

        // Regular activity rows
        const actRows = sorted.map(a => {
            const time = (a.start_time || '').slice(0, 5);
            const type = a.activity_type || '';
            const pid = a.prospect_id || a.customer_id;
            const person = pid ? _mcalPersonMap.get(String(pid)) : null;
            const name = person?.full_name || a.activity_title || '—';
            const venue = a.venue_name || a.venue || a.location_address || '';
            const color = _mcalColorForType(type);
            return `
                <div style="display:flex;align-items:center;gap:10px;padding:11px 0;border-bottom:1px solid var(--gray-100);cursor:pointer;" onclick="(async()=>{try{UI.hideModal();await app.viewActivityDetails(${a.id});}catch(e){console.error(e);}})();">
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
    const mcalTab = (tab, btn) => {
        document.querySelectorAll('.mcal-tab').forEach(t => t.classList.remove('active'));
        if (btn) btn.classList.add('active');
        if (tab !== 'month') {
            UI.toast.success(`${tab.charAt(0).toUpperCase() + tab.slice(1)} view coming soon`);
            // Re-activate Month tab visually
            setTimeout(() => {
                document.querySelectorAll('.mcal-tab').forEach((t, i) => {
                    t.classList.toggle('active', i === 0);
                });
            }, 600);
        }
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
        try { await (window.app.openActivityModal || (() => {}))(); return; } catch (_) {}
        UI.toast.success('Add activity');
    };
    const mcalAddMeetUp = (dateStr) => {
        // Opens the activity modal from a calendar day-detail. After saving, the
        // day-detail is automatically reopened so the user sees the new activity.
        UI.hideModal();
        window._mcalAfterSaveDate = dateStr;
        window.app.openActivityModal && window.app.openActivityModal(dateStr);
    };
    const mcalWa = () => {
        window.open('https://web.whatsapp.com', '_blank', 'noopener');
    };

    // ── Mobile Prospects / Clients view ──────────────────────
    // Card-based mobile-only listing matching the home/calendar brand
    // language. Shares data with the desktop prospects/customers views.
    let _mpTab = 'prospects';   // 'prospects' | 'customers'
    let _mpAgentMap = null;     // id → agent_code, loaded once per session
    let _mpSearch = '';
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
        const _mpSnapKey = `mp-list-snap-v2-${_mpTab}`;
        let _mpSnapHtml;
        if (!_mpForce) {
            try {
                const _raw = localStorage.getItem(_mpSnapKey);
                if (_raw) {
                    const { ts, val } = JSON.parse(_raw);
                    if (Date.now() - ts < 30 * 60 * 1000) _mpSnapHtml = val;
                    else localStorage.removeItem(_mpSnapKey);
                }
            } catch(_) {}
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
        } catch (_) { rows = []; }

        // Scope by visibility for non-admins
        if (typeof isSystemAdmin === 'function' && !isSystemAdmin(_state.cu) && visibleIds !== 'all') {
            const setIds = new Set(visibleIds.map(String));
            rows = rows.filter(r => !r.responsible_agent_id || setIds.has(String(r.responsible_agent_id)));
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

        if (!rows.length) {
            listHost.innerHTML = `<div class="mp-empty"><span class="mp-empty-flower">🌸</span> No ${_mhomeEsc(_mpTab)} yet. Tap + to add the first one.</div>`;
            return;
        }

        const isCust = _mpTab === 'customers';
        const palettes = ['red','purple','pink','peach','wood'];
        const html = rows.slice(0, 60).map((p, i) => {
            const init = _mhomeInitials(p.full_name);
            const pal = palettes[i % palettes.length];
            const phone = _mhomeEsc(p.phone || '');
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
                        <div class="mp-card-name">${_mhomeEsc(p.full_name || 'Unknown')}</div>
                        ${phone ? `<button class="mp-card-wa" onclick="event.stopPropagation();app.mhomeWa(${p.id ?? 'null'},'${phone}')" aria-label="WhatsApp"><i class="fab fa-whatsapp"></i></button>` : ''}
                        ${agentCode ? `<span class="mp-card-agent">${_mhomeEsc(agentCode)}</span>` : ''}
                    </div>
                    <div class="mp-card-meta">
                        ${lastAct ? `<span class="mp-chip date">${_mhomeEsc(lastAct)}</span>` : ''}
                        ${agentName ? `<span class="mp-chip agent">${_mhomeEsc(agentName)}</span>` : ''}
                    </div>
                </div>
                <div class="mp-card-actions">
                    <i class="fas fa-chevron-right mp-card-chev"></i>
                </div>
            </div>`;
        }).join('');

        listHost.innerHTML = html;
        // Only cache the snapshot when there's no active search AND no active
        // filters. Caching a filtered list under the canonical key means a
        // page reload would paint that narrowed list while the in-memory
        // filter state is empty — UI says "no filters" but list is narrowed.
        if (!_mpSearch && !_mpHasActiveFilters()) {
            try { localStorage.setItem(`mp-list-snap-v2-${_mpTab}`, JSON.stringify({ ts: Date.now(), val: html })); } catch(_) {}
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
            try { window.app.openAddCustomerModal(); return; } catch (_) {}
        }
        if (typeof window.app?.openAddProspectModal === 'function') {
            try { window.app.openAddProspectModal(); return; } catch (_) {}
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
            } catch (_) {}
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
        try { localStorage.removeItem(`mp-list-snap-v2-${_mpTab}`); } catch(_) {}
        _mpUpdateFilterBtn();
        await _mpRenderList();
    };

    const mpClearFilters = async () => {
        _mpFilters = { status: '', agentId: '', mingGua: '', scoreMin: '', scoreMax: '', pipelineStage: '' };
        UI.hideModal();
        try { localStorage.removeItem(`mp-list-snap-v2-${_mpTab}`); } catch(_) {}
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
                } catch (_) {}
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
    Object.assign(window.app, {
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
        showMobileCalendarView,
        mcalPrevMonth,
        mcalNextMonth,
        mcalToday,
        mcalDayClick,
        mcalAddMeetUp,
        mcalTab,
        mcalFilter,
        mcalAdd,
        mcalWa,
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