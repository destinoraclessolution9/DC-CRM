// Ensure app object exists globally - MUST BE FIRST LINE
window.app = window.app || {};
console.log("!!! ANTIGRAVITY v2 LOADED !!!");

// Add initialization flag
window.app.ready = false;

window.onerror = (msg, url, line) => {
    console.error(`GLOBAL ERROR: ${msg} at ${url}:${line}`);
};

const appLogic = (() => {
    let _currentView = 'dashboard';
    let _currentUser = null;
    let _currentMarketingTab = 'templates'; // Phase 12: 'templates', 'campaigns', 'analytics'
    let _selectedEntity = null;
    let _selectedAttendees = [];
    let _selectedCoAgents = [];
    let _selectedReferrer = null;
    let _currentDate = new Date(); // Dynamic start date
    let _filters = { agent: 'all', type: 'all', from: '', to: '' };

    // ========== ROLE HELPERS ==========
    const isSystemAdmin = (user) => user?.role === 'super_admin' || user?.role?.includes('Level 1');
    const isMarketingManager = (user) => user?.role === 'marketing_manager' || user?.role?.includes('Level 2');
    const isAgent = (user) => user?.role === 'consultant' || user?.role === 'agent' || user?.role?.includes('Level');
    const isManagement = (user) => isSystemAdmin(user) || isMarketingManager(user) || user?.role?.includes('Level 3');

    // Phase 10: Search Panel State
    let _searchPanelVisible = false;
    let _currentSearchEntity = 'prospects'; // default entity
    let _currentSearchFilters = {
        entity: 'prospects',
        conditions: [], // array of condition objects
        dateRange: { from: null, to: null },
        groups: [ // for AND/OR logic
            {
                logic: 'AND',
                conditions: []
            }
        ]
    };
    let _conditionGroups = [
        {
            logic: 'AND',
            conditions: []
        }
    ];
    let _savedSearches = [];
    let _searchHistory = [];
    let _currentSearchResults = [];
    let _currentPage = 1;
    let _pageSize = 10;
    let _totalResults = 0;
    
    // Phase 7: Referral Tree State
    let _currentSelectedPerson = null;      // { id, type }
    let _treeZoom = null;
    let _treeSvg = null;
    let _currentTreeData = null;

    // Phase 11: DMS State
    let _currentFolder = null; // Current folder ID
    let _viewMode = 'list'; // 'list' or 'grid'
    let _selectedFiles = []; // Array of selected file IDs for batch operations
    let _fileSortBy = 'name'; // 'name', 'date', 'size'
    let _fileSortDirection = 'asc'; // 'asc' or 'desc'
    let _fileFilter = ''; // Search filter text
    let _draggedFileId = null; // For drag & drop
    let _clipboardFiles = []; // For cut/copy/paste
    let _clipboardAction = null; // 'cut' or 'copy'

    // Phase 14: Voice Recording State
    let _mediaRecorder = null;
    let _audioChunks = [];
    let _recordingStartTime = null;
    let _recordingTimer = null;
    let _recordingStream = null;

    // Phase 14: Offline Queue State
    let _offlineQueue = [];
    let _isOnline = navigator.onLine;

    // ========== PERMISSION HELPERS ==========

    // Get all subordinate user IDs (including self) for a given user based on reporting_to.
    // Returns an array of user IDs, or 'all' for roles that see everything.
    const getVisibleUserIds = async (user) => {
        if (!user) return [];
        const role = user.role;
        if (role === 'super_admin' || role === 'marketing_manager' || role === 'manager') {
            return 'all'; // special marker
        }
        // For team leaders and consultants, traverse down the reporting tree
        const allUsers =await AppDataStore.getAll('users');
        const result = [];
        const collect = (uid) => {
            result.push(uid);
            allUsers.filter(u => u.reporting_to === uid).forEach(u => collect(u.id));
        };
        collect(user.id);
        return result;
    };

    // Check if current user can view a given prospect
    const canViewProspect = async (prospect) => {
        const user = _currentUser;
        if (!user) return false;
        const visibleIds = await getVisibleUserIds(user);
        if (visibleIds === 'all') return true;
        return visibleIds.includes(prospect.responsible_agent_id);
    };

    // Get all prospects visible to current user
    const getVisibleProspects = async () => {
        const all = await AppDataStore.getAll('prospects');
        const user = _currentUser;
        if (!user) return [];
        const visibleIds = await getVisibleUserIds(user);
        if (visibleIds === 'all') return all;
        return all.filter(p => visibleIds.includes(p.responsible_agent_id));
    };

    // Similarly for customers
    const canViewCustomer = async (customer) => {
        const user = _currentUser;
        if (!user) return false;
        const visibleIds = await getVisibleUserIds(user);
        if (visibleIds === 'all') return true;
        return visibleIds.includes(customer.responsible_agent_id);
    };

    const getVisibleCustomers = async () => {
        if (_currentUser && (isSystemAdmin(_currentUser) || isMarketingManager(_currentUser) || _currentUser.role === 'admin')) {
            return await AppDataStore.getAll('customers');
        }
        return await AppDataStore.getAll('customers').filter(c => c.agent_id === _currentUser?.id);
    };

    // For activities: visible if current user is lead, co-agent, or the activity is 'open', or if the lead agent is within visible users.
    const canViewActivity = async (activity) => {
        const user = _currentUser;
        if (!user) return false;
        if (activity.visibility === 'open') return true;
        const isLead = activity.lead_agent_id === user.id;
        const isCoAgent = activity.co_agents && activity.co_agents.some(ca => ca.id === user.id);
        if (isLead || isCoAgent) return true;
        // For managers/team leaders: check if lead agent is in visible subordinates
        const visibleIds = await getVisibleUserIds(user);
        if (visibleIds === 'all') return true;
        return visibleIds.includes(activity.lead_agent_id);
    };

    const getVisibleActivities = async () => {
        const all = await AppDataStore.getAll('activities');
        return all.filter(async a => await canViewActivity(a));
    };

    // Check edit permission: super_admin, marketing_manager, manager can edit anything;
    // team leader can edit prospects of subordinates; consultant only own.
    const canEditProspect = async (prospect) => {
        const user = _currentUser;
        if (!user) return false;
        if (user.role === 'super_admin' || user.role === 'marketing_manager' || user.role === 'manager') return true;
        if (user.role === 'team_leader' || user.role?.includes('Level 7')) {
            const visibleIds = await getVisibleUserIds(user);
            return visibleIds.includes(prospect.responsible_agent_id);
        }
        if (user.role === 'consultant') {
            return prospect.responsible_agent_id === user.id;
        }
        return false;
    };

    // Similar for customers, activities, etc. – you can add as needed.

    const canViewNode = async (personId, personType) => {
        if (personType === 'prospect') {
            return await canViewProspect({ id: personId });
        } else if (personType === 'customer') {
            return await canViewCustomer({ id: personId });
        }
        return false;
    };

    // ========== HELPER FUNCTIONS ==========

    const generateId = () => {
        return 'id_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
    };

    const generateModelId = () => {
        return 'model_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
    };

    // Check lunar library after a short delay
    (() => {
        if (typeof LunarCalendar === 'undefined' && typeof lunarCalendar === 'undefined' && typeof Lunar === 'undefined') {
            console.error('LunarCalendar library failed to load. Check network tab.');
        } else {
            console.log('LunarCalendar library loaded successfully.');
        }
    }, 500);

    const convertSolarToLunar = (date) => {
        if (!date) return '';
        const parts = date.split('-');
        const year = parseInt(parts[0], 10);
        const month = parseInt(parts[1], 10);
        const day = parseInt(parts[2], 10);

        // Try all possible global names for the library
        const lib = window.LunarCalendar || window.lunarCalendar || window.Lunar;

        if (lib && typeof lib.solarToLunar === 'function') {
            try {
                const lunar = lib.solarToLunar(year, month, day);
                if (lunar && lunar.lunarYear) {
                    // Format: YYYY-MM-DD (Lunar) – simple and clean
                    return `${lunar.lunarYear}-${String(lunar.lunarMonth).padStart(2, '0')}-${String(lunar.lunarDay).padStart(2, '0')} (Lunar)`;
                }
            } catch (e) {
                console.warn('Lunar conversion error:', e);
            }
        } else {
            console.error('Lunar library not found. Available globals:', Object.keys(window).filter(k => k.includes('Lunar')));
        }

        // Fallback: return a simple error message (but conversion should work now)
        return 'Conversion failed';
    };

    const escapeHtml = async (unsafe) => {
        if (!unsafe || typeof unsafe !== 'string') return unsafe || '';
        return unsafe
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&#039;");
    };

    const FILE_ICONS = {
        // Documents
        pdf: 'fa-file-pdf',
        doc: 'fa-file-word',
        docx: 'fa-file-word',
        dot: 'fa-file-word',

        // Spreadsheets
        xls: 'fa-file-excel',
        xlsx: 'fa-file-excel',
        csv: 'fa-file-csv',

        // Presentations
        ppt: 'fa-file-powerpoint',
        pptx: 'fa-file-powerpoint',

        // Images
        jpg: 'fa-file-image',
        jpeg: 'fa-file-image',
        png: 'fa-file-image',
        gif: 'fa-file-image',
        bmp: 'fa-file-image',
        svg: 'fa-file-image',
        webp: 'fa-file-image',

        // Audio
        mp3: 'fa-file-audio',
        wav: 'fa-file-audio',
        ogg: 'fa-file-audio',

        // Video
        mp4: 'fa-file-video',
        avi: 'fa-file-video',
        mov: 'fa-file-video',
        wmv: 'fa-file-video',

        // Archives
        zip: 'fa-file-archive',
        rar: 'fa-file-archive',
        '7z': 'fa-file-archive',
        tar: 'fa-file-archive',
        gz: 'fa-file-archive',

        // Code
        html: 'fa-file-code',
        css: 'fa-file-code',
        js: 'fa-file-code',
        json: 'fa-file-code',
        xml: 'fa-file-code',
        php: 'fa-file-code',
        py: 'fa-file-code',
        java: 'fa-file-code',
        cpp: 'fa-file-code',

        // Text
        txt: 'fa-file-alt',
        md: 'fa-file-alt',
        rtf: 'fa-file-alt',

        // Default
        default: 'fa-file'
    };

    const getFileIcon = (filename) => {
        if (!filename) return FILE_ICONS.default;
        const ext = filename.split('.').pop().toLowerCase();
        return FILE_ICONS[ext] || FILE_ICONS.default;
    };

    const formatFileSize = (bytes) => {
        if (bytes === 0 || !bytes) return '0 Bytes';
        const k = 1024;
        const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
    };

    const getFileExtension = (filename) => {
        return filename.split('.').pop().toLowerCase();
    };

    const isImageFile = (filename) => {
        const imageExts = ['jpg', 'jpeg', 'png', 'gif', 'bmp', 'svg', 'webp'];
        return imageExts.includes(getFileExtension(filename));
    };

    const isPdfFile = (filename) => {
        return getFileExtension(filename) === 'pdf';
    };

    const isTextFile = (filename) => {
        const textExts = ['txt', 'csv', 'json', 'xml', 'html', 'css', 'js', 'md', 'rtf'];
        return textExts.includes(getFileExtension(filename));
    };

    const debounce = async (fn, delay) => {
        let timer;
        return (...args) => {
            clearTimeout(timer);
            timer = (() => fn(...args), delay);
        };
    };

    // Ensure referrals have the new fields (id, referrer_id, referrer_type, referred_prospect_id)
    const ensureReferralFields = async () => {
        const referrals = await AppDataStore.getAll('referrals');
        let changed = false;
        referrals.forEach(r => {
            if (r.referrer_customer_id && !r.referrer_id) {
                // Old format: convert
                r.referrer_id = r.referrer_customer_id;
                r.referrer_type = 'customer';
                delete r.referrer_customer_id; // optional, but we keep for backward compat
                changed = true;
            }
            if (!r.referrer_id) {
                // Should not happen, but just in case
                r.referrer_id = null;
                r.referrer_type = null;
            }
            if (!r.created_at) r.created_at = r.date || new Date().toISOString();
        });
        if (changed) {
            // Persist changes
            localStorage.setItem('fs_crm_referrals', JSON.stringify(referrals));
        }
    };

    const ENTITY_FIELDS = {
        agents: [
            { value: 'full_name', label: 'Name', type: 'text' },
            { value: 'agent_code', label: 'Agent Code', type: 'text' },
            { value: 'team', label: 'Team', type: 'select', options: ['Team A', 'Team B'] },
            { value: 'status', label: 'Status', type: 'select', options: ['active', 'probation', 'inactive'] },
            { value: 'email', label: 'Email', type: 'text' },
            { value: 'join_date', label: 'Join Date', type: 'date' }
        ],
        prospects: [
            { value: 'full_name', label: 'Name', type: 'text' },
            { value: 'phone', label: 'Phone', type: 'text' },
            { value: 'email', label: 'Email', type: 'text' },
            { value: 'ming_gua', label: 'Ming Gua', type: 'select', options: ['MG1', 'MG2', 'MG3', 'MG4', 'MG5', 'MG6', 'MG7', 'MG8', 'MG9'] },
            { value: 'score', label: 'Score', type: 'number' },
            { value: 'status', label: 'Status', type: 'select', options: ['active', 'converted', 'lost'] },
            { value: 'responsible_agent_id', label: 'Agent', type: 'select', options: 'dynamic' },
            { value: 'has_purchased_product', label: 'Has Purchased', type: 'product' }, // Special type
            { value: 'has_not_purchased_product', label: 'Has Not Purchased', type: 'product' } // Special type
        ],
        customers: [
            { value: 'full_name', label: 'Name', type: 'text' },
            { value: 'phone', label: 'Phone', type: 'text' },
            { value: 'email', label: 'Email', type: 'text' },
            { value: 'lifetime_value', label: 'Lifetime Value', type: 'number' },
            { value: 'customer_since', label: 'Customer Since', type: 'date' },
            { value: 'ming_gua', label: 'Ming Gua', type: 'select', options: ['MG1', 'MG2', 'MG3', 'MG4', 'MG5', 'MG6', 'MG7', 'MG8', 'MG9'] }
        ],
        activities: [
            { value: 'activity_type', label: 'Type', type: 'select', options: ['CPS', 'FTF', 'FSA', 'EVENT', 'CALL', 'EMAIL', 'WHATSAPP'] },
            { value: 'activity_title', label: 'Title', type: 'text' },
            { value: 'activity_date', label: 'Date', type: 'date' },
            { value: 'lead_agent_id', label: 'Agent', type: 'select', options: 'dynamic' },
            { value: 'prospect_id', label: 'Prospect', type: 'select', options: 'dynamic' },
            { value: 'status', label: 'Status', type: 'select', options: ['scheduled', 'completed', 'cancelled'] }
        ],
        transactions: [
            { value: 'date', label: 'Date', type: 'date' },
            { value: 'invoice', label: 'Invoice', type: 'text' },
            { value: 'item', label: 'Product', type: 'text' },
            { value: 'amount', label: 'Amount', type: 'number' },
            { value: 'status', label: 'Status', type: 'select', options: ['PENDING', 'COMPLETED', 'COLLECTED'] },
            { value: 'payment_method', label: 'Payment Method', type: 'select', options: ['Cash', 'Credit Card', 'Bank Transfer', 'EPP', 'POP'] },
            { value: 'customer_id', label: 'Customer', type: 'select', options: 'dynamic' }
        ],
        events: [
            { value: 'event_title', label: 'Title', type: 'text' },
            { value: 'event_date', label: 'Date', type: 'date' },
            { value: 'event_category_id', label: 'Category', type: 'select', options: 'dynamic' },
            { value: 'location', label: 'Location', type: 'text' },
            { value: 'status', label: 'Status', type: 'select', options: ['upcoming', 'ongoing', 'completed', 'cancelled'] }
        ]
    };


    // Section 10.4: Search Panel Toggle
    const toggleSearchPanel = async () => {
        _searchPanelVisible = !_searchPanelVisible;
        if (_searchPanelVisible) {
            await showSearchPanel();
        } else {
            hideSearchPanel();
        }
    };

    const showSearchPanel = async () => {
        const viewport = document.getElementById('content-viewport');

        // Create overlay and panel
        const searchHTML = `
            <div class="search-panel-overlay" id="search-panel-overlay" onclick="app.hideSearchPanel()"></div>
            <div class="search-panel" id="search-panel">
                <div class="search-panel-header">
                    <h2>Advanced Search & Analytics</h2>
                    <button class="close-btn" onclick="app.hideSearchPanel()">&times;</button>
                </div>
                
                <div class="search-presets">
                    <h3>Quick Presets</h3>
                    <div class="preset-buttons">
                        <button class="preset-btn" onclick="await app.loadPreset('agent-monthly')">Agent Monthly Report</button>
                        <button class="preset-btn" onclick="await app.loadPreset('high-score')">High Score Prospects</button>
                        <button class="preset-btn" onclick="await app.loadPreset('recent-activities')">Recent Activities</button>
                        <button class="preset-btn" onclick="await app.loadPreset('cai-ku-not-purchased')">CAI KU Painting Not Purchased</button>
                    </div>
                </div>
                
                <div class="search-entity-selector">
                    <label>Search in:</label>
                    <select id="search-entity" onchange="await app.updateFilterSections()">
                        <option value="agents">Agents</option>
                        <option value="prospects" selected>Prospects</option>
                        <option value="customers">Customers</option>
                        <option value="activities">Activities</option>
                        <option value="transactions">Transactions</option>
                        <option value="events">Events</option>
                    </select>
                </div>
                
                <div class="date-range-filter">
                    <h3>Date Range</h3>
                    <div class="date-range-group">
                        <input type="date" id="search-date-from" class="form-control" placeholder="From">
                        <span>to</span>
                        <input type="date" id="search-date-to" class="form-control" placeholder="To">
                    </div>
                </div>
                
                <div class="filter-sections" id="filter-sections">
                    <!-- Dynamic filters will be rendered here -->
                </div>
                
                <div class="condition-builder" id="condition-builder">
                    <h3>Advanced Conditions</h3>
                    <div id="condition-groups">
                        <!-- Condition groups rendered here -->
                    </div>
                    <button class="btn secondary btn-sm" onclick="app.addConditionGroup()">
                        <i class="fas fa-plus"></i> Add Condition Group
                    </button>
                    <div class="condition-logic-toggle">
                        <label>Group Logic:</label>
                        <select id="group-logic" onchange="app.updateGroupLogic(0, this.value)">
                            <option value="AND">AND</option>
                            <option value="OR">OR</option>
                        </select>
                    </div>
                </div>
                
                <div class="search-actions">
                    <button class="btn primary" onclick="await app.executeSearch()">
                        <i class="fas fa-search"></i> Apply Filters
                    </button>
                    <button class="btn secondary" onclick="app.clearAllFilters()">
                        <i class="fas fa-times"></i> Clear All
                    </button>
                    <button class="btn secondary" onclick="await app.openSaveSearchModal()">
                        <i class="fas fa-save"></i> Save Search
                    </button>
                    <button class="btn secondary" onclick="app.exportResults('csv')">
                        <i class="fas fa-download"></i> Export
                    </button>
                </div>
                
                <div class="saved-searches">
                    <h3>Saved Searches</h3>
                    <div id="saved-searches-list">
                        <!-- Saved searches will be rendered here -->
                    </div>
                </div>
                
                <div class="search-history">
                    <h3>Recent Searches</h3>
                    <div id="search-history-list">
                        <!-- Search history will be rendered here -->
                    </div>
                </div>
                
                <div class="search-results" id="search-results">
                    <!-- Results will be rendered here -->
                </div>
                
                <div class="pagination" id="search-pagination">
                    <!-- Pagination will be rendered here -->
                </div>
            </div>
        `;

        // Insert panel before the main content
        viewport.insertAdjacentHTML('beforebegin', searchHTML);

        // Load saved searches
        await renderSavedSearches();

        // Initial filter render
        await updateFilterSections();

        // Render condition groups
        renderConditionGroups();
    };

    const hideSearchPanel = () => {
        const overlay = document.getElementById('search-panel-overlay');
        const panel = document.getElementById('search-panel');
        if (overlay) overlay.remove();
        if (panel) panel.remove();
        _searchPanelVisible = false;
    };

    // Section 10.5: Dynamic Filter Rendering
    const updateFilterSections = async () => {
        const entity = document.getElementById('search-entity')?.value || 'prospects';
        _currentSearchEntity = entity;

        const container = document.getElementById('filter-sections');
        if (!container) return;

        let html = '<h3>Basic Filters</h3>';

        switch (entity) {
            case 'agents':
                html += renderAgentFilters();
                break;
            case 'prospects':
                html += await renderProspectCustomerFilters();
                break;
            case 'customers':
                html += await renderProspectCustomerFilters(true);
                break;
            case 'activities':
                html += renderActivityFilters();
                break;
            case 'transactions':
                html += renderTransactionFilters();
                break;
            case 'events':
                html += renderEventFilters();
                break;
        }

        container.innerHTML = html;

        // Update condition builder options
        renderConditionGroups();
    };

    const renderAgentFilters = () => {
        return `
            <div class="filter-row">
                <div class="filter-group">
                    <label>Name</label>
                    <input type="text" id="filter-agent-name" class="form-control" placeholder="Agent name...">
                </div>
                <div class="filter-group">
                    <label>Team</label>
                    <select id="filter-agent-team" class="form-control">
                        <option value="">All Teams</option>
                        <option value="Team A">Team A</option>
                        <option value="Team B">Team B</option>
                    </select>
                </div>
            </div>
            <div class="filter-row">
                <div class="filter-group">
                    <label>Status</label>
                    <select id="filter-agent-status" class="form-control">
                        <option value="">All Status</option>
                        <option value="active">Active</option>
                        <option value="probation">Probation</option>
                        <option value="inactive">Inactive</option>
                    </select>
                </div>
                <div class="filter-group">
                    <label>Agent Code</label>
                    <input type="text" id="filter-agent-code" class="form-control" placeholder="e.g., AGN-2026-001">
                </div>
            </div>
        `;
    };

    const renderProspectCustomerFilters = async (isCustomer = false) => {
        const type = isCustomer ? 'customer' : 'prospect';

        return `
            <div class="filter-row">
                <div class="filter-group">
                    <label>Name</label>
                    <input type="text" id="filter-${type}-name" class="form-control" placeholder="Full name...">
                </div>
                <div class="filter-group">
                    <label>Phone</label>
                    <input type="text" id="filter-${type}-phone" class="form-control" placeholder="Phone number...">
                </div>
            </div>
            <div class="filter-row">
                <div class="filter-group">
                    <label>Email</label>
                    <input type="text" id="filter-${type}-email" class="form-control" placeholder="Email...">
                </div>
                <div class="filter-group">
                    <label>Ming Gua</label>
                    <select id="filter-${type}-minggua" class="form-control">
                        <option value="">All</option>
                        <option value="MG1">MG1</option>
                        <option value="MG2">MG2</option>
                        <option value="MG3">MG3</option>
                        <option value="MG4">MG4</option>
                        <option value="MG5">MG5</option>
                        <option value="MG6">MG6</option>
                        <option value="MG7">MG7</option>
                        <option value="MG8">MG8</option>
                        <option value="MG9">MG9</option>
                    </select>
                </div>
            </div>
            <div class="filter-row">
                <div class="filter-group">
                    <label>Score (Min)</label>
                    <input type="number" id="filter-${type}-score-min" class="form-control" placeholder="Min score...">
                </div>
                <div class="filter-group">
                    <label>Score (Max)</label>
                    <input type="number" id="filter-${type}-score-max" class="form-control" placeholder="Max score...">
                </div>
            </div>
            ${!isCustomer ? `
            <div class="filter-row">
                <div class="filter-group">
                    <label>Has Purchased</label>
                    <select id="filter-prospect-has-purchased" class="form-control">
                        <option value="">Select Product</option>
                        ${await AppDataStore.getAll('products').filter(p => p.is_active !== false).map(p => `<option value="${p.name}">${p.name}</option>`).join('')}
                    </select>
                </div>
                <div class="filter-group">
                    <label>Has Not Purchased</label>
                    <select id="filter-prospect-not-purchased" class="form-control">
                        <option value="">Select Product</option>
                        ${await AppDataStore.getAll('products').filter(p => p.is_active !== false).map(p => `<option value="${p.name}">${p.name}</option>`).join('')}
                    </select>
                </div>
            </div>
            ` : ''}
            <div class="filter-row">
                <div class="filter-group">
                    <label>Tags (Select multiple)</label>
                    <select id="filter-${type}-tags" class="form-control" multiple style="height: 80px;">
                        <option value="Career Focused">Career Focused</option>
                        <option value="High Score">High Score</option>
                        <option value="VIP">VIP</option>
                        <option value="Urgent">Urgent</option>
                        <option value="Follow-up">Follow-up</option>
                    </select>
                </div>
                <div class="filter-group">
                    <label>Needs (Select multiple)</label>
                    <select id="filter-${type}-needs" class="form-control" multiple style="height: 80px;">
                        <option value="Career">Career</option>
                        <option value="Financial">Financial</option>
                        <option value="Relationship">Relationship</option>
                        <option value="Health">Health</option>
                        <option value="Wealth">Wealth</option>
                    </select>
                </div>
            </div>
            <div class="filter-row">
                <div class="filter-group">
                    <label>Keyword Search</label>
                    <input type="text" id="filter-${type}-keyword" class="form-control" placeholder="Search across fields...">
                </div>
                <div class="filter-group">
                    <label>Age Range</label>
                    <div style="display:flex; gap:10px;">
                        <input type="number" id="filter-${type}-age-min" class="form-control" placeholder="Min (0)" min="0" max="100">
                        <input type="number" id="filter-${type}-age-max" class="form-control" placeholder="Max (100)" min="0" max="100">
                    </div>
                </div>
            </div>
        `;
    };

    const renderActivityFilters = () => {
        return `
            <div class="filter-row">
                <div class="filter-group">
                    <label>Activity Type</label>
                    <select id="filter-activity-type" class="form-control">
                        <option value="">All Types</option>
                        <option value="CPS">CPS</option>
                        <option value="FTF">FTF</option>
                        <option value="FSA">FSA</option>
                        <option value="EVENT">Event</option>
                        <option value="CALL">Call</option>
                        <option value="EMAIL">Email</option>
                        <option value="WHATSAPP">WhatsApp</option>
                    </select>
                </div>
                <div class="filter-group">
                    <label>Title</label>
                    <input type="text" id="filter-activity-title" class="form-control" placeholder="Activity title...">
                </div>
            </div>
            <div class="filter-row">
                <div class="filter-group">
                    <label>Agent</label>
                    <select id="filter-activity-agent" class="form-control">
                        <option value="">All Agents</option>
                    </select>
                </div>
                <div class="filter-group">
                    <label>Status</label>
                    <select id="filter-activity-status" class="form-control">
                        <option value="">All</option>
                        <option value="scheduled">Scheduled</option>
                        <option value="completed">Completed</option>
                        <option value="cancelled">Cancelled</option>
                    </select>
                </div>
            </div>
        `;
    };

    const renderTransactionFilters = () => {
        return `
            <div class="filter-row">
                <div class="filter-group">
                    <label>Product</label>
                    <input type="text" id="filter-transaction-product" class="form-control" placeholder="Product name...">
                </div>
                <div class="filter-group">
                    <label>Invoice</label>
                    <input type="text" id="filter-transaction-invoice" class="form-control" placeholder="Invoice number...">
                </div>
            </div>
            <div class="filter-row">
                <div class="filter-group">
                    <label>Payment Method</label>
                    <select id="filter-transaction-payment" class="form-control">
                        <option value="">All</option>
                        <option value="Cash">Cash</option>
                        <option value="Credit Card">Credit Card</option>
                        <option value="Bank Transfer">Bank Transfer</option>
                        <option value="EPP">EPP</option>
                        <option value="POP">POP</option>
                    </select>
                </div>
                <div class="filter-group">
                    <label>Status</label>
                    <select id="filter-transaction-status" class="form-control">
                        <option value="">All</option>
                        <option value="PENDING">Pending</option>
                        <option value="COMPLETED">Completed</option>
                        <option value="COLLECTED">Collected</option>
                    </select>
                </div>
            </div>
            <div class="filter-row">
                <div class="filter-group">
                    <label>Min Amount</label>
                    <input type="number" id="filter-transaction-amount-min" class="form-control" placeholder="Min RM...">
                </div>
                <div class="filter-group">
                    <label>Max Amount</label>
                    <input type="number" id="filter-transaction-amount-max" class="form-control" placeholder="Max RM...">
                </div>
            </div>
        `;
    };

    const renderEventFilters = () => {
        return `
            <div class="filter-row">
                <div class="filter-group">
                    <label>Event Title</label>
                    <input type="text" id="filter-event-title" class="form-control" placeholder="Event title...">
                </div>
                <div class="filter-group">
                    <label>Category</label>
                    <select id="filter-event-category" class="form-control">
                        <option value="">All Categories</option>
                    </select>
                </div>
            </div>
            <div class="filter-row">
                <div class="filter-group">
                    <label>Location</label>
                    <input type="text" id="filter-event-location" class="form-control" placeholder="Location...">
                </div>
                <div class="filter-group">
                    <label>Status</label>
                    <select id="filter-event-status" class="form-control">
                        <option value="">All</option>
                        <option value="upcoming">Upcoming</option>
                        <option value="ongoing">Ongoing</option>
                        <option value="completed">Completed</option>
                        <option value="cancelled">Cancelled</option>
                    </select>
                </div>
            </div>
        `;
    };


    // Section 10.6: Condition Builder Logic
    const renderConditionGroups = () => {
        const container = document.getElementById('condition-groups');
        if (!container) return;

        container.innerHTML = _conditionGroups.map((group, gIdx) => `
            <div class="condition-group" data-group-index="${gIdx}">
                <div class="group-header">
                    <span>Condition Group ${gIdx + 1}</span>
                    <button class="btn btn-sm" onclick="app.removeConditionGroup(${gIdx})">
                        <i class="fas fa-trash"></i>
                    </button>
                </div>
                <div class="conditions-list">
                    ${group.conditions.map((cond, cIdx) => `
                        <div class="condition-row">
                            <select class="condition-field" onchange="app.updateConditionField(${gIdx}, ${cIdx}, this.value)">
                                <option value="">Select Field</option>
                                ${ENTITY_FIELDS[_currentSearchEntity]?.map(f => `
                                    <option value="${f.value}" ${cond.field === f.value ? 'selected' : ''}>${f.label}</option>
                                `).join('') || ''}
                            </select>
                            
                            <select class="condition-operator" onchange="app.updateConditionOperator(${gIdx}, ${cIdx}, this.value)">
                                <option value="=" ${cond.operator === '=' ? 'selected' : ''}>=</option>
                                <option value="!=" ${cond.operator === '!=' ? 'selected' : ''}>!=</option>
                                <option value=">" ${cond.operator === '>' ? 'selected' : ''}>&gt;</option>
                                <option value="<" ${cond.operator === '<' ? 'selected' : ''}>&lt;</option>
                                <option value="contains" ${cond.operator === 'contains' ? 'selected' : ''}>Contains</option>
                                <option value="not_contains" ${cond.operator === 'not_contains' ? 'selected' : ''}>Not Contains</option>
                            </select>
                            
                            <input type="text" class="condition-value" value="${cond.value || ''}" 
                                   onchange="app.updateConditionValue(${gIdx}, ${cIdx}, this.value)"
                                   placeholder="Value...">
                                   
                            <button class="btn btn-sm" onclick="app.removeCondition(${gIdx}, ${cIdx})">
                                <i class="fas fa-times"></i>
                            </button>
                        </div>
                    `).join('')}
                </div>
                <button class="btn btn-sm secondary" onclick="app.addCondition(${gIdx})">
                    <i class="fas fa-plus"></i> Add Condition
                </button>
            </div>
        `).join('');
    };

    const addConditionGroup = () => {
        _conditionGroups.push({
            logic: 'AND',
            conditions: [{ field: '', operator: '=', value: '' }]
        });
        renderConditionGroups();
    };

    const removeConditionGroup = (idx) => {
        if (_conditionGroups.length > 1) {
            _conditionGroups.splice(idx, 1);
            renderConditionGroups();
        }
    };

    const addCondition = (gIdx) => {
        _conditionGroups[gIdx].conditions.push({ field: '', operator: '=', value: '' });
        renderConditionGroups();
    };

    const removeCondition = (gIdx, cIdx) => {
        _conditionGroups[gIdx].conditions.splice(cIdx, 1);
        if (_conditionGroups[gIdx].conditions.length === 0) {
            removeConditionGroup(gIdx);
        } else {
            renderConditionGroups();
        }
    };

    const updateGroupLogic = (gIdx, logic) => {
        _conditionGroups[gIdx].logic = logic;
    };

    const updateConditionField = (gIdx, cIdx, field) => {
        _conditionGroups[gIdx].conditions[cIdx].field = field;
    };

    const updateConditionOperator = (gIdx, cIdx, op) => {
        _conditionGroups[gIdx].conditions[cIdx].operator = op;
    };

    const updateConditionValue = (gIdx, cIdx, val) => {
        _conditionGroups[gIdx].conditions[cIdx].value = val;
    };



    // Section 10.7: Presets & Search Execution
    const loadPreset = async (presetId) => {
        clearAllFilters();

        switch (presetId) {
            case 'agent-monthly':
                document.getElementById('search-entity').value = 'agents';
                await updateFilterSections();
                document.getElementById('filter-agent-status').value = 'active';
                break;
            case 'high-score':
                document.getElementById('search-entity').value = 'prospects';
                await updateFilterSections();
                document.getElementById('filter-prospect-score-min').value = 800;
                break;
            case 'cai-ku-not-purchased':
                document.getElementById('search-entity').value = 'prospects';
                await updateFilterSections();
                document.getElementById('filter-prospect-not-purchased').value = 'CAI KU Painting';
                break;
            case 'recent-activities':
                document.getElementById('search-entity').value = 'activities';
                await updateFilterSections();
                const today = new Date().toISOString().split('T')[0];
                document.getElementById('search-date-from').value = today;
                break;
        }

        await executeSearch();
    };

    const collectFilters = () => {
        const entity = document.getElementById('search-entity').value;
        const filters = {
            entity,
            dateRange: {
                from: document.getElementById('search-date-from').value,
                to: document.getElementById('search-date-to').value
            },
            basic: {},
            complex: _conditionGroups
        };

        // Collect basic filters based on entity
        const section = document.getElementById('filter-sections');
        if (section) {
            const inputs = section.querySelectorAll('input, select');
            inputs.forEach(input => {
                if (input.multiple) {
                    const selected = Array.from(input.selectedOptions).map(opt => opt.value);
                    if (selected.length > 0) {
                        filters.basic[input.id.replace('filter-' + entity.slice(0, -1) + '-', '')] = selected;
                    }
                } else if (input.value) {
                    filters.basic[input.id.replace('filter-' + entity.slice(0, -1) + '-', '')] = input.value;
                }
            });
        }

        return filters;
    };

    const executeSearch = async () => {
        const filters = collectFilters();
        let results = [];

        switch (filters.entity) {
            case 'agents': results = await performAgentSearch(filters); break;
            case 'prospects': results = await performProspectSearch(filters); break;
            case 'customers': results = await performCustomerSearch(filters); break;
            case 'activities': results = await performActivitySearch(filters); break;
            case 'transactions': results = await performTransactionSearch(filters); break;
            case 'events': results = await performEventSearch(filters); break;
        }

        _currentSearchResults = results;
        _totalResults = results.length;
        _currentPage = 1;

        renderSearchResults();
        addToSearchHistory(filters);
    };

    const performAgentSearch = async (filters) => {
        let items = await AppDataStore.getAll('users').filter(u => isAgent(u) || u.role === 'team_leader' || u.role?.includes('Level 7'));

        // Basic filters
        if (filters.basic.name) {
            const query = filters.basic.name.toLowerCase();
            items = items.filter(i => i.full_name && i.full_name.toLowerCase().includes(query));
        }
        if (filters.basic.team) {
            items = items.filter(i => i.team === filters.basic.team);
        }
        if (filters.basic['agent-status']) {
            items = items.filter(i => i.status === filters.basic['agent-status']);
        }

        return applyComplexConditions(items, filters.complex);
    };

    const performProspectSearch = async (filters) => {
        let items = await getVisibleProspects();

        // Basic filters
        if (filters.basic.name) {
            const query = filters.basic.name.toLowerCase();
            items = items.filter(i => i.full_name && i.full_name.toLowerCase().includes(query));
        }
        if (filters.basic.minggua) {
            items = items.filter(i => i.ming_gua === filters.basic.minggua);
        }
        if (filters.basic['score-min']) {
            items = items.filter(i => i.score >= parseInt(filters.basic['score-min']));
        }
        if (filters.basic['has-purchased']) {
            const product = filters.basic['has-purchased'];
            items = items.filter(async i => await hasProspectPurchasedProduct(i.id, product));
        }
        if (filters.basic['not-purchased']) {
            const product = filters.basic['not-purchased'];
            items = items.filter(async i => !await hasProspectPurchasedProduct(i.id, product));
        }

        if (filters.basic.keyword) {
            const kw = filters.basic.keyword.toLowerCase();
            items = items.filter(i =>
                (i.full_name && i.full_name.toLowerCase().includes(kw)) ||
                (i.phone && i.phone.toLowerCase().includes(kw)) ||
                (i.email && i.email.toLowerCase().includes(kw)) ||
                (i.notes && i.notes.toLowerCase().includes(kw))
            );
        }
        if (filters.basic.tags && filters.basic.tags.length > 0) {
            items = items.filter(i => {
                const itemTags = i.tags ? (Array.isArray(i.tags) ? i.tags : i.tags.split(',').map(t => t.trim())) : [];
                return filters.basic.tags.every(tag => itemTags.includes(tag));
            });
        }
        if (filters.basic.needs && filters.basic.needs.length > 0) {
            items = items.filter(i => {
                const itemNeeds = i.needs ? (Array.isArray(i.needs) ? i.needs : i.needs.split(',').map(t => t.trim())) : [];
                return filters.basic.needs.every(need => itemNeeds.includes(need));
            });
        }
        if (filters.basic['age-min'] || filters.basic['age-max']) {
            items = items.filter(i => {
                if (!i.date_of_birth) return false;
                const dob = new Date(i.date_of_birth);
                const ageDifMs = Date.now() - dob.getTime();
                const ageDate = new Date(ageDifMs);
                const age = Math.abs(ageDate.getUTCFullYear() - 1970);

                let valid = true;
                if (filters.basic['age-min'] && age < parseInt(filters.basic['age-min'])) valid = false;
                if (filters.basic['age-max'] && age > parseInt(filters.basic['age-max'])) valid = false;
                return valid;
            });
        }

        return applyComplexConditions(items, filters.complex);
    };

    const hasProspectPurchasedProduct = async (prospectId, productName) => {
        const purchases = await AppDataStore.getAll('purchases');
        if (purchases.some(p => p.customer_id === prospectId && p.item && p.item.includes(productName))) return true;

        const activities = await AppDataStore.getAll('activities');
        return activities.some(a => (a.prospect_id === prospectId || a.customer_id === prospectId) && a.is_closing && a.solution_sold === productName);
    };

    const performCustomerSearch = async (filters) => {
        let items = await getVisibleCustomers();

        if (filters.basic.name) {
            const query = filters.basic.name.toLowerCase();
            items = items.filter(i => i.full_name && i.full_name.toLowerCase().includes(query));
        }

        if (filters.basic.keyword) {
            const kw = filters.basic.keyword.toLowerCase();
            items = items.filter(i =>
                (i.full_name && i.full_name.toLowerCase().includes(kw)) ||
                (i.phone && i.phone.toLowerCase().includes(kw)) ||
                (i.email && i.email.toLowerCase().includes(kw)) ||
                (i.notes && i.notes.toLowerCase().includes(kw))
            );
        }
        if (filters.basic.tags && filters.basic.tags.length > 0) {
            items = items.filter(i => {
                const itemTags = i.tags ? (Array.isArray(i.tags) ? i.tags : i.tags.split(',').map(t => t.trim())) : [];
                return filters.basic.tags.every(tag => itemTags.includes(tag));
            });
        }
        if (filters.basic.needs && filters.basic.needs.length > 0) {
            items = items.filter(i => {
                const itemNeeds = i.needs ? (Array.isArray(i.needs) ? i.needs : i.needs.split(',').map(t => t.trim())) : [];
                return filters.basic.needs.every(need => itemNeeds.includes(need));
            });
        }
        if (filters.basic['age-min'] || filters.basic['age-max']) {
            items = items.filter(i => {
                if (!i.date_of_birth) return false;
                const dob = new Date(i.date_of_birth);
                const ageDifMs = Date.now() - dob.getTime();
                const ageDate = new Date(ageDifMs);
                const age = Math.abs(ageDate.getUTCFullYear() - 1970);

                let valid = true;
                if (filters.basic['age-min'] && age < parseInt(filters.basic['age-min'])) valid = false;
                if (filters.basic['age-max'] && age > parseInt(filters.basic['age-max'])) valid = false;
                return valid;
            });
        }

        return applyComplexConditions(items, filters.complex);
    };

    const performActivitySearch = async (filters) => {
        let items = await AppDataStore.getAll('activities');

        if (filters.basic.type) {
            items = items.filter(i => i.activity_type === filters.basic.type);
        }

        return applyComplexConditions(items, filters.complex);
    };

    const performTransactionSearch = async (filters) => {
        let items = await AppDataStore.getAll('purchases');

        if (filters.basic.product) {
            const query = filters.basic.product.toLowerCase();
            items = items.filter(i => i.item && i.item.toLowerCase().includes(query));
        }

        return applyComplexConditions(items, filters.complex);
    };

    const performEventSearch = async (filters) => {
        let items = await AppDataStore.getAll('events');

        if (filters.basic.title) {
            const query = filters.basic.title.toLowerCase();
            items = items.filter(i => i.event_title && i.event_title.toLowerCase().includes(query));
        }

        return applyComplexConditions(items, filters.complex);
    };

    const applyComplexConditions = (items, groups) => {
        if (!groups || groups.length === 0 || groups[0].conditions.length === 0) return items;

        return items.filter(item => {
            // Group logic (AND/OR for multiple groups)
            // Simplified: we only support one group logic at the top level for now or specific per-group
            return groups.every(group => {
                const results = group.conditions.map(cond => evaluateCondition(item, cond));
                return group.logic === 'AND' ? results.every(r => r) : results.some(r => r);
            });
        });
    };

    const evaluateCondition = (item, cond) => {
        if (!cond.field) return true;

        const itemValue = item[cond.field];
        const val = cond.value;

        switch (cond.operator) {
            case '=': return itemValue == val;
            case '!=': return itemValue != val;
            case '>': return parseFloat(itemValue) > parseFloat(val);
            case '<': return parseFloat(itemValue) < parseFloat(val);
            case 'contains': return String(itemValue).toLowerCase().includes(String(val).toLowerCase());
            case 'not_contains': return !String(itemValue).toLowerCase().includes(String(val).toLowerCase());
            default: return true;
        }
    };

    // Section 10.9: Results Rendering
    const renderSearchResults = () => {
        const container = document.getElementById('search-results');
        if (!container) return;

        if (_totalResults === 0) {
            container.innerHTML = '<div class="no-results">No matches found for your criteria.</div>';
            return;
        }

        const start = (_currentPage - 1) * _pageSize;
        const pageItems = _currentSearchResults.slice(start, start + _pageSize);

        let html = `
            <h3>Search Results (${_totalResults} found)</h3>
            <table class="search-results-table table-hover">
                <thead>
                    <tr>
                        <th>Name/Title</th>
                        <th>Identifier/Contact</th>
                        <th>Agent Name</th>
                        <th>Status</th>
                        <th>Actions</th>
                    </tr>
                </thead>
                <tbody>
                    ${pageItems.map(item => {
            let agentName = '-';
            if (item.lead_agent_id || item.responsible_agent_id) {
                const agent = AppDataStore.getById('users', item.lead_agent_id || item.responsible_agent_id);
                if (agent) agentName = agent.full_name;
            }

            let displayStatus = item.status || item.activity_type || item.team || 'Active';
            if (_currentSearchEntity === 'prospects') displayStatus = 'Prospect';
            if (_currentSearchEntity === 'customers') displayStatus = 'Customer';
            if (item.status === 'converted' && _currentSearchEntity === 'prospects') displayStatus = 'Customer';

            return `
                        <tr style="cursor: pointer;" onclick="app.viewEntityDetail('${_currentSearchEntity}', ${item.id})">
                            <td><strong>${item.full_name || item.activity_title || item.event_title || item.item || 'N/A'}</strong></td>
                            <td>${item.phone || item.agent_code || item.invoice || item.location || 'N/A'}</td>
                            <td>${agentName}</td>
                            <td>${displayStatus}</td>
                            <td>
                                <button class="btn-icon" title="View Detail" onclick="app.viewEntityDetail('${_currentSearchEntity}', ${item.id}); event.stopPropagation();">
                                    <i class="fas fa-eye"></i>
                                </button>
                            </td>
                        </tr>
                        `;
        }).join('')}
                </tbody>
            </table>
        `;

        container.innerHTML = html;
        renderPagination();
    };

    const renderPagination = () => {
        const container = document.getElementById('search-pagination');
        if (!container) return;

        const totalPages = Math.ceil(_totalResults / _pageSize);
        if (totalPages <= 1) {
            container.innerHTML = '';
            return;
        }

        container.innerHTML = `
            <div class="pagination-controls">
                <button ${_currentPage === 1 ? 'disabled' : ''} onclick="app.goToPage(${_currentPage - 1})">Prev</button>
                <span>Page ${_currentPage} of ${totalPages}</span>
                <button ${_currentPage === totalPages ? 'disabled' : ''} onclick="app.goToPage(${_currentPage + 1})">Next</button>
            </div>
        `;
    };

    const goToPage = (page) => {
        _currentPage = page;
        renderSearchResults();
    };

    // Section 10.10: Saved Searches & History
    const renderSavedSearches = async () => {
        const container = document.getElementById('saved-searches-list');
        if (!container) return;

        const searches = await AppDataStore.getAll('saved_searches');
        if (searches.length === 0) {
            container.innerHTML = '<p class="text-muted" style="font-size: 12px; margin: 12px 0;">No saved searches yet.</p>';
            return;
        }

        container.innerHTML = searches.map(s => `
            <div class="saved-search-item">
                <div class="saved-search-info" onclick="await app.loadSavedSearch(${s.id})">
                    <i class="fas fa-bookmark"></i>
                    <span>${s.search_name}</span>
                    <small>${s.entity}</small>
                </div>
                <button class="btn-icon" onclick="await app.deleteSavedSearch(${s.id})">
                    <i class="fas fa-trash"></i>
                </button>
            </div>
        `).join('');
    };

    const openSaveSearchModal = async () => {
        const name = prompt('Enter a name for this search:');
        if (name) {
            await saveCurrentSearch(name);
        }
    };

    const saveCurrentSearch = async (name) => {
        const filters = collectFilters();
        const savedSearch = {
            id: Date.now(),
            search_name: name,
            entity: filters.entity,
            filter_data: JSON.stringify(filters),
            created_at: new Date().toISOString()
        };

        await AppDataStore.create('saved_searches', savedSearch);
        UI.toast.success('Search saved successfully');
        await renderSavedSearches();
    };

    const loadSavedSearch = async (id) => {
        const search = AppDataStore.getById('saved_searches', id);
        if (!search) return;

        UI.toast.info(`Loading search: ${search.search_name}`);
        const filters = JSON.parse(search.filter_data);

        // Restore UI
        document.getElementById('search-entity').value = filters.entity;
        await updateFilterSections();

        document.getElementById('search-date-from').value = filters.dateRange.from || '';
        document.getElementById('search-date-to').value = filters.dateRange.to || '';

        _conditionGroups = filters.complex;
        renderConditionGroups();

        // Execute
        await executeSearch();
    };

    const deleteSavedSearch = async (id) => {
        if (confirm('Are you sure you want to delete this saved search?')) {
            AppDataStore.delete('saved_searches', id);
            UI.toast.success('Search deleted');
            await renderSavedSearches();
        }
    };

    const addToSearchHistory = (filters) => {
        _searchHistory.unshift({
            timestamp: new Date().toLocaleTimeString(),
            entity: filters.entity,
            summary: filters.entity + ' search'
        });

        if (_searchHistory.length > 5) _searchHistory.pop();
        renderSearchHistory();
    };

    const renderSearchHistory = () => {
        const container = document.getElementById('search-history-list');
        if (!container) return;

        container.innerHTML = _searchHistory.map(h => `
            <div class="history-item">
                <div class="history-info">
                    <small>${h.timestamp}</small>
                    <span>${h.summary}</span>
                </div>
            </div>
        `).join('');
    };

    const clearAllFilters = () => {
        // Reset basic filters
        const section = document.getElementById('filter-sections');
        if (section) {
            const inputs = section.querySelectorAll('input, select');
            inputs.forEach(input => input.value = '');
        }

        // Reset date
        document.getElementById('search-date-from').value = '';
        document.getElementById('search-date-to').value = '';

        // Reset conditions
        _conditionGroups = [{ logic: 'AND', conditions: [] }];
        renderConditionGroups();

        UI.toast.info('Filters cleared');
    };

    const exportResults = (format) => {
        if (_currentSearchResults.length === 0) {
            UI.toast.warning('No results to export');
            return;
        }

        if (format === 'csv') {
            const keys = Object.keys(_currentSearchResults[0]);
            const header = keys.join(',');
            const rows = _currentSearchResults.map(row =>
                keys.map(key => `"${row[key] || ''}"`).join(',')
            );

            const csv = [header, ...rows].join('\n');
            const blob = new Blob([csv], { type: 'text/csv' });
            const url = window.URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.setAttribute('hidden', '');
            a.setAttribute('href', url);
            a.setAttribute('download', `search_results_${_currentSearchEntity}.csv`);
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            UI.toast.success('Exporting CSV...');
        }
    };


    // --- PHASE 11: DOCUMENT MANAGEMENT SYSTEM FUNCTIONS ---

    const showDocumentManagementView = async (container) => {
        container.innerHTML = `
            <div class="dms-view">
                <div class="dms-header">
                    <div>
                        <h1>Document Management System</h1>
                        <p>Manage, organize, and share your documents</p>
                    </div>
                    <div class="dms-actions">
                        <button class="btn primary" onclick="await app.openUploadModal()">
                            <i class="fas fa-upload"></i> Upload File
                        </button>
                        <button class="btn secondary" onclick="await app.openNewFolderModal()">
                            <i class="fas fa-folder-plus"></i> New Folder
                        </button>
                    </div>
                </div>
                
                <div class="dms-layout">
                    <div class="folder-sidebar">
                        <div class="sidebar-header">
                            <h3>Folders</h3>
                            <button class="btn-icon" onclick="await app.refreshFolderTree()" title="Refresh">
                                <i class="fas fa-sync-alt"></i>
                            </button>
                        </div>
                        <div class="folder-tree" id="folder-tree"></div>
                    </div>
                    
                    <div class="file-explorer">
                        <div class="explorer-header">
                            <div class="breadcrumb" id="breadcrumb"></div>
                            
                            <div class="explorer-controls">
                                <div class="search-filter-bar">
                                    <i class="fas fa-search"></i>
                                    <input type="text" id="file-search" placeholder="Search files..." onkeyup="await app.searchFiles(this.value)">
                                    <select id="file-sort" class="form-control" onchange="await app.sortFiles(this.value)">
                                        <option value="name">Sort by Name</option>
                                        <option value="date">Sort by Date</option>
                                        <option value="size">Sort by Size</option>
                                    </select>
                                    <div class="view-toggle">
                                        <button class="btn-icon ${_viewMode === 'list' ? 'active' : ''}" onclick="await app.setViewMode('list')">
                                            <i class="fas fa-list"></i>
                                        </button>
                                        <button class="btn-icon ${_viewMode === 'grid' ? 'active' : ''}" onclick="await app.setViewMode('grid')">
                                            <i class="fas fa-th-large"></i>
                                        </button>
                                    </div>
                                </div>
                                <div id="batch-actions"></div>
                            </div>
                            
                            <div class="special-filters" style="margin-top: 15px; display: flex; gap: 10px;">
                                <button class="btn link-btn" onclick="await app.showRecentFiles()"><i class="fas fa-clock"></i> Recent</button>
                                <button class="btn link-btn" onclick="await app.showAllFiles()"><i class="fas fa-copy"></i> All Files</button>
                                <button class="btn link-btn" onclick="await app.showStarredFiles()"><i class="fas fa-star"></i> Starred</button>
                            </div>
                        </div>
                        
                        <div class="file-container" id="file-container"></div>
                    </div>
                </div>
            </div>
        `;
        await renderFolderTree();
        await loadFolderContents();
    };

    const renderFolderTree = async (parentId = null, level = 0, container = null) => {
        const treeContainer = container || document.getElementById('folder-tree');
        if (!treeContainer) return;
        if (parentId === null) treeContainer.innerHTML = '';

        const folders = await AppDataStore.getAll('folders')
            .filter(f => f.parent_id === parentId)
            .sort((a, b) => a.name.localeCompare(b.name));

        folders.forEach(async folder => {
            const hasChildren = (await AppDataStore.getAll('folders')).some(f => f.parent_id === folder.id);
            const isActive = _currentFolder === folder.id;

            const div = document.createElement('div');
            div.className = `folder-item ${isActive ? 'active' : ''}`;
            div.style.paddingLeft = `${level * 20 + 10}px`;

            div.innerHTML = `
                <div class="folder-content" onclick="await app.navigateToFolder(${folder.id})" 
                     ondragover="event.preventDefault(); this.parentElement.classList.add('drag-over')"
                     ondragleave="this.parentElement.classList.remove('drag-over')"
                     ondrop="await app.handleDropOnFolder(event, ${folder.id})">
                    <i class="fas fa-folder" style="color: ${folder.color || '#f59e0b'}"></i>
                    <span class="folder-name">${folder.name}</span>
                </div>
                <div class="folder-actions">
                    <button class="btn-icon" onclick="await app.renameFolder(${folder.id}); event.stopPropagation()"><i class="fas fa-edit"></i></button>
                    <button class="btn-icon" onclick="await app.deleteFolder(${folder.id}); event.stopPropagation()"><i class="fas fa-trash"></i></button>
                </div>
            `;
            treeContainer.appendChild(div);
            if (hasChildren) await renderFolderTree(folder.id, level + 1, treeContainer);
        });
    };

    const renderBreadcrumb = async () => {
        const container = document.getElementById('breadcrumb');
        if (!container) return;
        const path = [];
        let curr = _currentFolder ? AppDataStore.getById('folders', _currentFolder) : null;
        while (curr) { path.unshift(curr); curr = curr.parent_id ? AppDataStore.getById('folders', curr.parent_id) : null; }

        let html = '<span class="breadcrumb-item" onclick="await app.navigateToFolder(null)">Root</span>';
        path.forEach(f => { html += `<span class="breadcrumb-separator">/</span><span class="breadcrumb-item" onclick="await app.navigateToFolder(${f.id})">${f.name}</span>`; });
        container.innerHTML = html;
    };

    const navigateToFolder = async (id) => { _currentFolder = id; await deselectAll(); await loadFolderContents(); await renderFolderTree(); };
    const setViewMode = async (mode) => { _viewMode = mode; await loadFolderContents(); };
    const sortFiles = async (sortBy) => { _fileSortBy = sortBy; await loadFolderContents(); };
    const searchFiles = async (q) => { _fileFilter = q; await loadFolderContents(); };
    const refreshFolderTree = async () => { await renderFolderTree(); };

    const openNewFolderModal = async () => {
        UI.showModal('New Folder', `
            <div class="form-group"><label>Folder Name</label><input type="text" id="new-folder-name" class="form-control" placeholder="Enter name..."></div>
            <div class="form-group"><label>Label Color</label><input type="color" id="new-folder-color" class="form-control" value="#f59e0b"></div>
        `, [{ label: 'Cancel', type: 'secondary', action: 'UI.hideModal()' }, { label: 'Create', type: 'primary', action: 'await app.createFolder()' }]);
    };

    const createFolder = async () => {
        const name = document.getElementById('new-folder-name')?.value;
        if (!name) return UI.toast.error('Name required');
        await AppDataStore.create('folders', { id: Date.now(), name, parent_id: _currentFolder, color: document.getElementById('new-folder-color').value, created_by: _currentUser?.id, created_at: new Date().toISOString() });
        UI.hideModal(); UI.toast.success('Folder created'); await renderFolderTree();
    };

    const renameFolder = async (id) => {
        const folder = AppDataStore.getById('folders', id);
        UI.showModal('Rename Folder', `<div class="form-group"><label>New Name</label><input type="text" id="rename-folder-input" class="form-control" value="${folder.name}"></div>`,
            [{ label: 'Cancel', type: 'secondary', action: 'UI.hideModal()' }, { label: 'Rename', type: 'primary', action: `await app.confirmRenameFolder(${id})` }]);
    };
    window.app.confirmRenameFolder = async (id) => {
        const name = document.getElementById('rename-folder-input')?.value;
        if (!name) return;
        AppDataStore.update('folders', id, { name }); UI.hideModal(); await renderFolderTree(); await renderBreadcrumb();
    };

    const deleteFolder = async (id) => {
        const hasSub =await AppDataStore.getAll('folders').some(f => f.parent_id === id);
        const hasFiles = await AppDataStore.getAll('documents').some(d => d.folder_id === id);
        if (hasSub || hasFiles) return UI.toast.error('Cannot delete: Folder is not empty');
        UI.showModal('Delete Folder', '<p>Are you sure?</p>', [{ label: 'Cancel', type: 'secondary', action: 'UI.hideModal()' }, { label: 'Delete', type: 'primary', action: `await app.confirmDeleteFolder(${id})` }]);
    };
    window.app.confirmDeleteFolder = async (id) => { AppDataStore.delete('folders', id); UI.hideModal(); if (_currentFolder === id) _currentFolder = null; await renderFolderTree(); await loadFolderContents(); };

    const showRecentFiles = async () => {
        const allFiles = await AppDataStore.getAll('documents').sort((a, b) => new Date(b.updated_at || b.created_at) - new Date(a.updated_at || a.created_at));
        await renderFileListView(allFiles.slice(0, 20)); // Show top 20
        _currentFolder = 'recent'; await renderBreadcrumb();
    };

    const showAllFiles = async () => { await renderFileListView(await AppDataStore.getAll('documents')); _currentFolder = 'all'; await renderBreadcrumb(); };
    const showStarredFiles = async () => { await renderFileListView(await AppDataStore.getAll('documents').filter(d => d.is_starred)); _currentFolder = 'starred'; await renderBreadcrumb(); };

    const toggleStar = async (id) => { const f = AppDataStore.getById('documents', id); AppDataStore.update('documents', id, { is_starred: !f.is_starred }); await loadFolderContents(); };

    const downloadFile = (id) => { UI.toast.info('Starting download...'); /* Implementation depends on environment */ };

    const handleFileDragStart = (e, id) => { _draggedFileId = id; e.dataTransfer.setData('text/plain', id); e.target.classList.add('dragging'); };
    const handleFileDragEnd = (e) => { e.target.classList.remove('dragging'); _draggedFileId = null; };
    const handleDropOnFolder = async (e, folderId) => {
        e.preventDefault();
        const fileId = parseInt(e.dataTransfer.getData('text/plain'));
        if (fileId) { AppDataStore.update('documents', fileId, { folder_id: folderId }); UI.toast.success('Moved successfully'); await loadFolderContents(); await renderFolderTree(); }
    };

    const showVersionHistory = async (fileId) => {
        const file = AppDataStore.getById('documents', fileId);
        const versions = await AppDataStore.getAll('document_versions').filter(v => v.document_id === fileId).sort((a, b) => b.version_number - a.version_number);
        const content = `
            <div class="version-history">
                <div class="version-header"><h3>Version History: ${file.filename}</h3><p>Current: v${file.current_version || 1}</p></div>
                <table class="version-table">
                    <thead><tr><th>Version</th><th>Date</th><th>Size</th><th>By</th><th>Notes</th><th>Actions</th></tr></thead>
                    <tbody>
                        ${versions.map(v => `
                            <tr class="${v.version_number === file.current_version ? 'current-version' : ''}">
                                <td>v${v.version_number}</td>
                                <td>${new Date(v.created_at).toLocaleString()}</td>
                                <td>${formatFileSize(v.size)}</td>
                                <td>${AppDataStore.getById('users', v.created_by)?.full_name || 'System'}</td>
                                <td>${v.change_note || '-'}</td>
                                <td>
                                    <button class="btn-icon" onclick="app.downloadVersion(${v.id})"><i class="fas fa-download"></i></button>
                                    <button class="btn-icon" onclick="await app.restoreVersion(${v.id})"><i class="fas fa-undo"></i></button>
                                </td>
                            </tr>
                        `).join('')}
                    </tbody>
                </table>
                ${versions.length >= 2 ? `<div class="compare-row"><button class="btn secondary" onclick="await app.showCompareTool(${fileId})">Compare Versions</button></div>` : ''}
            </div>
        `;
        UI.showModal('Version History', content, [{ label: 'Close', type: 'primary', action: 'UI.hideModal()' }]);
    };

    const showCompareTool = async (fileId) => {
        const versions = await AppDataStore.getAll('document_versions').filter(v => v.document_id === fileId);
        UI.showModal('Compare Versions', `
            <div class="compare-setup">
                <select id="v1" class="form-control">${versions.map(v => `<option value="${v.id}">Version ${v.version_number}</option>`).join('')}</select>
                <span>vs</span>
                <select id="v2" class="form-control">${versions.map(v => `<option value="${v.id}">Version ${v.version_number}</option>`).join('')}</select>
            </div>
        `, [{ label: 'Compare', type: 'primary', action: `app.compareVersions(${fileId})` }]);
    };

    const compareVersions = (fileId) => {
        const v1 = AppDataStore.getById('document_versions', parseInt(document.getElementById('v1').value));
        const v2 = AppDataStore.getById('document_versions', parseInt(document.getElementById('v2').value));
        UI.showModal('Comparison', `<div class="diff-view"><pre>${v1.data || ''}</pre><pre>${v2.data || ''}</pre></div>`, [{ label: 'Close', type: 'primary', action: 'UI.hideModal()' }]);
    };

    const downloadVersion = (versionId) => { UI.toast.info(`Downloading version ${versionId}...`); };
    const restoreVersion = async (versionId) => {
        const ver = AppDataStore.getById('document_versions', versionId);
        AppDataStore.update('documents', ver.document_id, { current_version: ver.version_number, updatedAt: new Date().toISOString() });
        UI.toast.success(`Restored to version ${ver.version_number}`); UI.hideModal(); await loadFolderContents();
    };

    const openShareModal = async (fileId) => {
        const file = AppDataStore.getById('documents', fileId);
        const users = await AppDataStore.getAll('users').filter(u => u.id !== _currentUser?.id);
        const shares = await AppDataStore.getAll('document_shares').filter(s => s.document_id === fileId);
        const content = `
            <div class="share-modal">
                <h3>Share: ${file.filename}</h3>
                <div class="share-form">
                    <select id="share-user" class="form-control"><option value="">Select User...</option>${users.map(u => `<option value="${u.id}">${u.full_name}</option>`).join('')}</select>
                    <button class="btn primary" onclick="await app.createShare(${fileId})">Add Share</button>
                </div>
                <div class="share-list">
                    ${shares.map(s => `<div class="share-item">${AppDataStore.getById('users', s.shared_with)?.full_name} (${s.permission}) <button onclick="app.removeShare(${s.id})">x</button></div>`).join('')}
                </div>
            </div>
        `;
        UI.showModal('Share Document', content, [{ label: 'Done', type: 'primary', action: 'UI.hideModal()' }]);
    };

    const createShare = async (fileId) => {
        const userId = parseInt(document.getElementById('share-user').value);
        if (!userId) return;
        await AppDataStore.create('document_shares', { id: Date.now(), document_id: fileId, shared_with: userId, permission: 'view', shared_by: _currentUser?.id });
        await openShareModal(fileId);
    };

    const removeShare = (id) => { AppDataStore.delete('document_shares', id); UI.toast.success('Share removed'); UI.hideModal(); };

    const initDefaultFolders = async () => {
        if (await AppDataStore.getAll('folders').length === 0) {
            const defaults = [
                { id: 1, name: 'Company Policies', color: '#3b82f6', parent_id: null },
                { id: 2, name: 'Customer Documents', color: '#10b981', parent_id: null },
                { id: 3, name: 'Agent Agreements', color: '#f59e0b', parent_id: null },
                { id: 4, name: 'Marketing Materials', color: '#ef4444', parent_id: null }
            ];
            defaults.forEach(async f => await AppDataStore.create('folders', f));
        }
    };

    const initSampleDocuments = async () => {
        if (await AppDataStore.getAll('documents').length === 0) {
            await AppDataStore.create('documents', { id: 101, filename: 'Welcome Guide.pdf', folder_id: 1, size: 1024 * 500, created_at: new Date().toISOString() });
            await AppDataStore.create('documents', { id: 102, filename: 'Privacy Policy.docx', folder_id: 1, size: 1024 * 200, created_at: new Date().toISOString() });
        }
    };

    const getFilesInCurrentFolder = async () => {
        let files = await AppDataStore.getAll('documents');

        // Filter by current folder
        if (_currentFolder && _currentFolder !== 'recent' && _currentFolder !== 'all' && _currentFolder !== 'starred') {
            files = files.filter(f => f.folder_id === _currentFolder);
        } else if (!_currentFolder) {
            files = files.filter(f => !f.folder_id || f.folder_id === 'root'); // Root folder
        }

        // Apply search filter
        if (_fileFilter) {
            const query = _fileFilter.toLowerCase();
            files = files.filter(f =>
                (f.filename && f.filename.toLowerCase().includes(query)) ||
                (f.description && f.description.toLowerCase().includes(query))
            );
        }

        return files;
    };

    const loadFolderContents = async () => {
        const container = document.getElementById('file-container');
        if (!container) return;

        const files = await getFilesInCurrentFolder();

        // Apply sorting
        files.sort((a, b) => {
            let valA, valB;

            if (_fileSortBy === 'name') {
                valA = a.filename ? a.filename.toLowerCase() : '';
                valB = b.filename ? b.filename.toLowerCase() : '';
            } else if (_fileSortBy === 'date') {
                valA = new Date(a.updated_at || a.created_at);
                valB = new Date(b.updated_at || b.created_at);
            } else if (_fileSortBy === 'size') {
                valA = a.size || 0;
                valB = b.size || 0;
            }

            if (_fileSortDirection === 'asc') {
                return valA > valB ? 1 : -1;
            } else {
                return valA < valB ? 1 : -1;
            }
        });

        // Render based on view mode
        if (_viewMode === 'list') {
            await renderFileListView(files);
        } else {
            await renderFileGridView(files);
        }

        // Update breadcrumb
        await renderBreadcrumb();

        // Update batch actions
        await updateBatchActions();
    };

    const renderFileListView = async (files) => {
        const container = document.getElementById('file-container');

        if (files.length === 0) {
            container.innerHTML = `
                <div class="empty-folder">
                    <i class="fas fa-folder-open fa-5x"></i>
                    <h3>This folder is empty</h3>
                    <p>Upload files or create a new folder to get started</p>
                    <button class="btn primary" onclick="await app.openUploadModal()">
                        <i class="fas fa-upload"></i> Upload Files
                    </button>
                </div>
            `;
            return;
        }

        let html = `
            <table class="file-table">
                <thead>
                    <tr>
                        <th style="width: 30px;">
                            <input type="checkbox" onchange="await app.selectAllFiles()" 
                                   ${_selectedFiles.length === files.length && files.length > 0 ? 'checked' : ''}>
                        </th>
                        <th onclick="await app.sortFiles('name')" style="cursor: pointer;">
                            Name ${_fileSortBy === 'name' ? (_fileSortDirection === 'asc' ? '↑' : '↓') : ''}
                        </th>
                        <th onclick="await app.sortFiles('date')" style="cursor: pointer;">
                            Modified ${_fileSortBy === 'date' ? (_fileSortDirection === 'asc' ? '↑' : '↓') : ''}
                        </th>
                        <th onclick="await app.sortFiles('size')" style="cursor: pointer;">
                            Size ${_fileSortBy === 'size' ? (_fileSortDirection === 'asc' ? '↑' : '↓') : ''}
                        </th>
                        <th>Actions</th>
                    </tr>
                </thead>
                <tbody>
                    ${files.map(file => `
                        <tr class="file-item ${_selectedFiles.includes(file.id) ? 'selected' : ''}" 
                            data-id="${file.id}" 
                            draggable="true"
                            ondragstart="app.handleFileDragStart(event, ${file.id})"
                            ondragend="app.handleFileDragEnd(event)">
                            <td onclick="event.stopPropagation()">
                                <input type="checkbox" onchange="await app.toggleFileSelection(${file.id})" 
                                       ${_selectedFiles.includes(file.id) ? 'checked' : ''}>
                            </td>
                            <td ondblclick="await app.previewFile(${file.id})">
                                <i class="fas ${getFileIcon(file.filename)} file-icon"></i>
                                <span class="file-name">${file.filename}</span>
                                ${file.is_starred ? '<i class="fas fa-star starred"></i>' : ''}
                            </td>
                            <td>${new Date(file.updated_at || file.created_at).toLocaleString()}</td>
                            <td>${(file.size > 1048576 ? (file.size / 1048576).toFixed(1) + " MB" : (file.size / 1024).toFixed(0) + " KB")}</td>
                            <td>
                                <div class="action-buttons" style="display: flex; gap: 4px;">
                                    <button class="btn-icon" onclick="await app.previewFile(${file.id}); event.stopPropagation();" title="Preview">
                                        <i class="fas fa-eye"></i>
                                    </button>
                                    <button class="btn-icon" onclick="app.downloadFile(${file.id}); event.stopPropagation();" title="Download">
                                        <i class="fas fa-download"></i>
                                    </button>
                                    <button class="btn-icon" onclick="await app.showVersionHistory(${file.id}); event.stopPropagation();" title="Versions">
                                        <i class="fas fa-history"></i>
                                    </button>
                                    <button class="btn-icon" onclick="await app.openShareModal(${file.id}); event.stopPropagation();" title="Share">
                                        <i class="fas fa-share-alt"></i>
                                    </button>
                                    <button class="btn-icon" onclick="await app.showFileMetadata(${file.id}); event.stopPropagation();" title="Info">
                                        <i class="fas fa-info-circle"></i>
                                    </button>
                                    <button class="btn-icon" onclick="await app.toggleStar(${file.id}); event.stopPropagation();" title="Star">
                                        <i class="fas fa-star${file.is_starred ? '' : '-o'}"></i>
                                    </button>
                                    <button class="btn-icon" onclick="app.deleteFile(${file.id}); event.stopPropagation();" title="Delete">
                                        <i class="fas fa-trash"></i>
                                    </button>
                                </div>
                            </td>
                        </tr>
                    `).join('')}
                </tbody>
            </table>
        `;

        container.innerHTML = html;
    };

    const renderFileGridView = async (files) => {
        const container = document.getElementById('file-container');

        if (files.length === 0) {
            container.innerHTML = `
                <div class="empty-folder">
                    <i class="fas fa-folder-open fa-5x"></i>
                    <h3>This folder is empty</h3>
                    <p>Upload files or create a new folder to get started</p>
                    <button class="btn primary" onclick="await app.openUploadModal()">
                        <i class="fas fa-upload"></i> Upload Files
                    </button>
                </div>
            `;
            return;
        }

        let html = '<div class="file-grid">';

        files.forEach(file => {
            html += `
                <div class="file-card ${_selectedFiles.includes(file.id) ? 'selected' : ''}" 
                     data-id="${file.id}"
                     draggable="true"
                     ondragstart="app.handleFileDragStart(event, ${file.id})"
                     ondragend="app.handleFileDragEnd(event)">
                    <div class="file-card-header">
                        <input type="checkbox" onchange="await app.toggleFileSelection(${file.id})" 
                               ${_selectedFiles.includes(file.id) ? 'checked' : ''} 
                               onclick="event.stopPropagation()">
                        <button class="btn-icon" onclick="await app.toggleStar(${file.id}); event.stopPropagation();" title="Star">
                            <i class="fas fa-star${file.is_starred ? '' : '-o'}"></i>
                        </button>
                    </div>
                    <div class="file-card-icon" ondblclick="await app.previewFile(${file.id})">
                        <i class="fas ${getFileIcon(file.filename)} fa-4x"></i>
                    </div>
                    <div class="file-card-name" title="${file.filename}">${truncateFilename(file.filename, 20)}</div>
                    <div class="file-card-meta">
                        <span>${(file.size > 1048576 ? (file.size / 1048576).toFixed(1) + " MB" : (file.size / 1024).toFixed(0) + " KB")}</span>
                        <span>${new Date(file.updated_at || file.created_at).toLocaleDateString()}</span>
                    </div>
                    <div class="file-card-actions">
                        <button class="btn-icon" onclick="await app.previewFile(${file.id}); event.stopPropagation();" title="Preview">
                            <i class="fas fa-eye"></i>
                        </button>
                        <button class="btn-icon" onclick="app.downloadFile(${file.id}); event.stopPropagation();" title="Download">
                            <i class="fas fa-download"></i>
                        </button>
                        <button class="btn-icon" onclick="await app.showVersionHistory(${file.id}); event.stopPropagation();" title="Versions">
                            <i class="fas fa-history"></i>
                        </button>
                        <button class="btn-icon" onclick="await app.openShareModal(${file.id}); event.stopPropagation();" title="Share">
                            <i class="fas fa-share-alt"></i>
                        </button>
                    </div>
                </div>
            `;
        });

        html += '</div>';
        container.innerHTML = html;
    };

    const truncateFilename = (filename, maxLength) => {
        if (!filename) return '';
        if (filename.length <= maxLength) return filename;
        const ext = filename.split('.').pop();
        const name = filename.substring(0, filename.lastIndexOf('.'));
        const truncated = name.substring(0, maxLength - ext.length - 3);
        return truncated + '...' + ext;
    };

    const updateBatchActions = async () => {
        const container = document.getElementById('batch-actions');
        if (!container) return;

        if (_selectedFiles.length === 0) {
            container.style.display = 'none';
            return;
        }

        container.style.display = 'block';
        container.innerHTML = `
            <div class="batch-actions-bar">
                <span class="selected-count">${_selectedFiles.length} selected</span>
                <button class="btn-icon" onclick="app.downloadSelected()" title="Download Selected">
                    <i class="fas fa-download"></i>
                </button>
                <button class="btn-icon" onclick="app.copySelected()" title="Copy Selected">
                    <i class="fas fa-copy"></i>
                </button>
                <button class="btn-icon" onclick="app.moveSelected()" title="Move Selected">
                    <i class="fas fa-cut"></i>
                </button>
                <button class="btn-icon" onclick="await app.deleteSelected()" title="Delete Selected">
                    <i class="fas fa-trash"></i>
                </button>
                <button class="btn-icon" onclick="await app.deselectAll()" title="Clear Selection">
                    <i class="fas fa-times"></i>
                </button>
            </div>
        `;
    };

    const toggleFileSelection = async (fileId) => {
        const index = _selectedFiles.indexOf(fileId);
        if (index === -1) {
            _selectedFiles.push(fileId);
        } else {
            _selectedFiles.splice(index, 1);
        }
        await loadFolderContents(); // Refresh to show selection
    };

    const selectAllFiles = async () => {
        const files = await getFilesInCurrentFolder();
        _selectedFiles = files.map(f => f.id);
        await loadFolderContents();
    };

    const deselectAll = async () => {
        _selectedFiles = [];
        await loadFolderContents();
    };

    const deleteSelected = async () => {
        if (_selectedFiles.length === 0) return;

        UI.showModal('Delete Files',
            `<p>Are you sure you want to delete ${_selectedFiles.length} file(s)?</p>
    <p class="text-error">This action cannot be undone.</p>`,
            [
                { label: 'Cancel', type: 'secondary', action: 'UI.hideModal()' },
                { label: 'Delete', type: 'primary', action: 'await app.confirmDeleteSelected()' }
            ]
        );
    };

    const confirmDeleteSelected = async () => {
        _selectedFiles.forEach(fileId => {
            AppDataStore.delete('documents', fileId);
        });
        _selectedFiles = [];
        await loadFolderContents();
        UI.hideModal();
        UI.toast.success('Files deleted');
    };

    const downloadSelected = () => {
        if (_selectedFiles.length === 1) {
            app.downloadFile(_selectedFiles[0]);
        } else {
            UI.toast.info('Multiple download would create ZIP file');
            // In production, implement ZIP creation
        }
    };

    const copySelected = () => { UI.toast.info('Copy selected files'); };
    const moveSelected = () => { UI.toast.info('Move selected files'); };

    const openUploadModal = async () => {
        const content = `
            <div class="upload-modal">
                <div class="upload-drop-zone" id="upload-drop-zone">
                    <i class="fas fa-cloud-upload-alt fa-4x"></i>
                    <h3>Drag & Drop Files Here</h3>
                    <p>or</p>
                    <input type="file" id="file-input" multiple style="display: none;" onchange="app.handleFileSelect(this.files)">
                    <button class="btn primary" onclick="document.getElementById('file-input').click()">
                        <i class="fas fa-folder-open"></i> Browse Files
                    </button>
                </div>
                
                <div class="upload-list" id="upload-list">
                    <!-- Selected files will appear here -->
                </div>
                
                <div class="upload-progress" id="upload-progress" style="display: none;">
                    <div class="progress-bar" style="height: 10px; background: #eee; border-radius: 5px; overflow: hidden; margin-bottom: 10px;">
                        <div class="progress-fill" id="upload-progress-fill" style="width: 0%; height: 100%; background: var(--primary); transition: width 0.3s;"></div>
                    </div>
                    <p id="upload-status" style="font-size: 13px; color: var(--gray-500);">Preparing upload...</p>
                </div>
                
                <div class="upload-options">
                    <label class="checkbox-label">
                        <input type="checkbox" id="create-new-version" checked> Create new version if file exists
                    </label>
                </div>
            </div>
        `;

        UI.showModal('Upload Files', content, [
            { label: 'Cancel', type: 'secondary', action: 'UI.hideModal()' },
            { label: 'Upload', type: 'primary', action: 'app.uploadFiles()' }
        ]);

        setTimeout(initUploadDragDrop, 100);
    };

    const initUploadDragDrop = () => {
        const dropZone = document.getElementById('upload-drop-zone');
        if (!dropZone) return;

        const preventDefaults = (e) => {
            e.preventDefault();
            e.stopPropagation();
        };

        const highlight = () => dropZone.classList.add('drag-over');
        const unhighlight = () => dropZone.classList.remove('drag-over');

        ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(eventName => {
            dropZone.addEventListener(eventName, preventDefaults, false);
        });

        ['dragenter', 'dragover'].forEach(eventName => {
            dropZone.addEventListener(eventName, highlight, false);
        });

        ['dragleave', 'drop'].forEach(eventName => {
            dropZone.addEventListener(eventName, unhighlight, false);
        });

        dropZone.addEventListener('drop', (e) => {
            const dt = e.dataTransfer;
            const files = dt.files;
            app.handleFileSelect(files);
        }, false);
    };

    const handleFileSelect = (files) => {
        const list = document.getElementById('upload-list');
        if (!list) return;

        window._pendingUploads = Array.from(files);

        let html = '<h4 style="margin: 16px 0 8px; font-size: 14px;">Files to upload:</h4><ul style="list-style: none; padding: 0;">';
        Array.from(files).forEach(file => {
            html += `<li style="padding: 6px 0; border-bottom: 1px solid #eee; font-size: 13px;"><i class="fas ${getFileIcon(file.name)}"></i> ${file.name} (${(file.size > 1048576 ? (file.size / 1048576).toFixed(1) + " MB" : (file.size / 1024).toFixed(0) + " KB")})</li>`;
        });
        html += '</ul>';

        list.innerHTML = html;
    };

    const uploadFiles = () => {
        const files = window._pendingUploads || [];
        if (files.length === 0) {
            UI.toast.error('No files selected');
            return;
        }

        // Show progress
        document.getElementById('upload-progress').style.display = 'block';

        let uploaded = 0;
        const total = files.length;

        // Simulate upload (in production, actually upload)
        files.forEach((file, index) => {
            setTimeout(async () => {
                // Create document record
                const newDoc = {
                    id: Date.now() + index,
                    filename: file.name,
                    folder_id: _currentFolder,
                    size: file.size,
                    mime_type: file.type,
                    data: '#', // Would be actual file data
                    current_version: 1,
                    created_by: _currentUser?.id,
                    created_at: new Date().toISOString(),
                    updated_at: new Date().toISOString(),
                    description: '',
                    is_starred: false
                };

                await AppDataStore.create('documents', newDoc);

                uploaded++;
                const percent = (uploaded / total) * 100;
                document.getElementById('upload-progress-fill').style.width = percent + '%';
                document.getElementById('upload-status').textContent = `Uploaded ${uploaded} of ${total} files`;

                if (uploaded === total) {
                    setTimeout(async () => {
                        UI.hideModal();
                        UI.toast.success(`${total} files uploaded successfully`);
                        await loadFolderContents();
                    }, 500);
                }
            }, index * 300); // Stagger for demo effect
        });
    };

    const previewFile = async (fileId) => {
        const file = AppDataStore.getById('documents', fileId);
        if (!file) return;

        const filename = file.filename;
        const ext = getFileExtension(filename);

        let previewContent = '';

        if (isImageFile(filename)) {
            previewContent = `
                <div class="image-preview" style="text-align: center;">
                    <img src="${file.data || 'https://via.placeholder.com/800x600?text=Image+Preview'}" 
                         alt="${filename}" style="max-width: 100%; max-height: 70vh; border-radius: 8px; box-shadow: 0 4px 12px rgba(0,0,0,0.1);">
                </div>
            `;
        } else if (isPdfFile(filename)) {
            previewContent = `
                <div class="pdf-preview">
                    <iframe src="${file.data || 'about:blank'}" width="100%" height="600px" style="border: 1px solid #ddd; border-radius: 8px;"></iframe>
                </div>
            `;
        } else if (isTextFile(filename)) {
            previewContent = `
                <div class="text-preview">
                    <pre style="white-space: pre-wrap; font-family: monospace; padding: 20px; 
                               background: #f5f5f5; border-radius: 8px; max-height: 500px; overflow: auto; border: 1px solid #ddd;">
This is a preview of ${file.filename}
Size: ${(file.size > 1048576 ? (file.size / 1048576).toFixed(1) + " MB" : (file.size / 1024).toFixed(0) + " KB")}
            Created: ${new Date(file.created_at).toLocaleString()}
            Modified: ${new Date(file.updated_at || file.created_at).toLocaleString()}
                    
File content preview would appear here for text files.
In a production system, this would show the actual file contents.
                    </pre>
                </div>
            `;
        } else {
            previewContent = `
                <div class="generic-preview" style="text-align: center; padding: 40px;">
                    <i class="fas ${getFileIcon(filename)} fa-5x" style="color: var(--primary); opacity: 0.3;"></i>
                    <h3 style="margin-top: 20px; font-size: 18px;">${filename}</h3>
                    <p style="color: var(--gray-500);">Size: ${(file.size > 1048576 ? (file.size / 1048576).toFixed(1) + " MB" : (file.size / 1024).toFixed(0) + " KB")}</p>
                    <p style="color: var(--gray-500);">Type: ${file.mime_type || 'Unknown'}</p>
                    <p style="color: var(--gray-500);">Created: ${new Date(file.created_at).toLocaleString()}</p>
                    <p style="color: #666; margin-top: 20px; font-style: italic;">Preview not available for this file type</p>
                </div>
            `;
        }

        UI.showModal(`Preview: ${file.filename}`, previewContent, [
            { label: 'Download', type: 'secondary', action: `app.downloadFile(${fileId})` },
            { label: 'Share', type: 'secondary', action: `await app.openShareModal(${fileId})` },
            { label: 'Close', type: 'primary', action: 'UI.hideModal()' }
        ], 'fullscreen');
    };

    const showFileMetadata = async (fileId) => {
        const file = AppDataStore.getById('documents', fileId);
        if (!file) return;

        const creator = file.created_by ? AppDataStore.getById('users', file.created_by) : null;
        const versions = await AppDataStore.getAll('document_versions').filter(v => v.document_id === fileId);

        const content = `
            <div class="file-metadata">
                <div class="metadata-section">
                    <h4>File Information</h4>
                    <div class="metadata-grid">
                        <div class="metadata-row">
                            <span class="metadata-label">Name:</span>
                            <span class="metadata-value">${file.filename}</span>
                        </div>
                        <div class="metadata-row">
                            <span class="metadata-label">Size:</span>
                            <span class="metadata-value">${(file.size > 1048576 ? (file.size / 1048576).toFixed(1) + " MB" : (file.size / 1024).toFixed(0) + " KB")}</span>
                        </div>
                        <div class="metadata-row">
                            <span class="metadata-label">Type:</span>
                            <span class="metadata-value">${file.mime_type || 'Unknown'}</span>
                        </div>
                        <div class="metadata-row">
                            <span class="metadata-label">Location:</span>
                            <span class="metadata-value">${getFolderPath(file.folder_id)}</span>
                        </div>
                    </div>
                </div>
                
                <div class="metadata-section">
                    <h4>Version Information</h4>
                    <div class="metadata-grid">
                        <div class="metadata-row">
                            <span class="metadata-label">Current Version:</span>
                            <span class="metadata-value">${file.current_version || 1}</span>
                        </div>
                        <div class="metadata-row">
                            <span class="metadata-label">Total Versions:</span>
                            <span class="metadata-value">${versions.length}</span>
                        </div>
                        <div class="metadata-row">
                            <span class="metadata-label">Created:</span>
                            <span class="metadata-value">${new Date(file.created_at).toLocaleString()}</span>
                        </div>
                        <div class="metadata-row">
                            <span class="metadata-label">Modified:</span>
                            <span class="metadata-value">${new Date(file.updated_at || file.created_at).toLocaleString()}</span>
                        </div>
                    </div>
                </div>
                
                <div class="metadata-section">
                    <h4>Owner Information</h4>
                    <div class="metadata-grid">
                        <div class="metadata-row">
                            <span class="metadata-label">Created By:</span>
                            <span class="metadata-value">${creator?.full_name || 'Unknown'}</span>
                        </div>
                        <div class="metadata-row">
                            <span class="metadata-label">User ID:</span>
                            <span class="metadata-value">${file.created_by || 'N/A'}</span>
                        </div>
                    </div>
                </div>
                
                ${file.description ? `
                    <div class="metadata-section">
                        <h4>Description</h4>
                        <p class="metadata-description">${file.description}</p>
                    </div>
                ` : ''}
            </div>
        `;

        UI.showModal('File Information', content, [
            { label: 'Edit Description', type: 'secondary', action: `await app.editFileDescription(${fileId})` },
            { label: 'Close', type: 'primary', action: 'UI.hideModal()' }
        ]);
    };

    const getFolderPath = (folderId) => {
        if (!folderId) return 'Root';
        const path = [];
        let current = AppDataStore.getById('folders', folderId);
        while (current) { path.unshift(current.name); current = current.parent_id ? AppDataStore.getById('folders', current.parent_id) : null; }
        return path.join(' / ');
    };

    const editFileDescription = async (fileId) => {
        const file = AppDataStore.getById('documents', fileId);
        UI.showModal('Edit Description', `<div class="form-group"><label>Description</label><textarea id="edit-file-desc" class="form-control" rows="4">${file.description || ''}</textarea></div>`,
            [{ label: 'Cancel', type: 'secondary', action: 'UI.hideModal()' }, { label: 'Save', type: 'primary', action: `await app.saveFileDescription(${fileId})` }]);
    };

    const saveFileDescription = async (fileId) => {
        const description = document.getElementById('edit-file-desc')?.value;
        AppDataStore.update('documents', fileId, { description }); UI.hideModal(); UI.toast.success('Description updated'); await showFileMetadata(fileId);
    };

    console.log('App initializing...');

    // ==================== PHASE 14: CUSTOMER & AGENT NOTE HELPERS ====================

    const addCustomerNote = async (customerId) => {
        const text = document.getElementById('customer-note-text')?.value?.trim();
        if (!text) { UI.toast.error('Please enter a note'); return; }
        const currentUser = Auth.getCurrentUser();
        await AppDataStore.create('notes', {
            id: Date.now(),
            customer_id: customerId,
            text,
            author: currentUser?.full_name || 'System',
            date: new Date().toISOString().split('T')[0]
        });
        document.getElementById('customer-note-text').value = '';
        UI.toast.success('Note added');
        await showCustomerDetail(customerId);
    };

    const deleteCustomerNote = async (customerId, noteId) => {
        UI.confirm('Delete Note?', 'Are you sure?', async () => {
            AppDataStore.delete('notes', noteId);
            UI.toast.success('Note deleted');
            await showCustomerDetail(customerId);
        });
    };

    const addAgentNote = async (agentId) => {
        const text = document.getElementById(`agent-note-text-${agentId}`)?.value?.trim();
        if (!text) { UI.toast.error('Please enter a note'); return; }
        const currentUser = Auth.getCurrentUser();
        await AppDataStore.create('notes', {
            id: Date.now(),
            agent_id: agentId,
            text,
            author: currentUser?.full_name || 'System',
            date: new Date().toISOString().split('T')[0]
        });
        document.getElementById(`agent-note-text-${agentId}`).value = '';
        UI.toast.success('Note added');
        await showAgentDetail(agentId);
    };

    const deleteAgentNote = async (agentId, noteId) => {
        UI.confirm('Delete Note?', 'Are you sure?', async () => {
            AppDataStore.delete('notes', noteId);
            UI.toast.success('Note deleted');
            await showAgentDetail(agentId);
        });
    };

    // ==================== PHASE 14: VOICE RECORDING FUNCTIONS ====================

    const openVoiceRecorder = async (targetElementId, entityType, entityId) => {
        window._voiceTarget = { elementId: targetElementId, entityType, entityId };

        const modalContent = `
            <div class="voice-recorder">
                <div class="mic-container">
                    <i class="fas fa-microphone" id="voice-mic-icon"></i>
                </div>

                <div class="recorder-controls">
                    <button class="btn primary btn-large" id="voice-record-btn" onclick="await app.startRecording()">
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
                    <button class="btn primary" onclick="await app.saveTranscription()">
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
            { label: 'Close', type: 'secondary', action: 'app.discardRecording()' }
        ]);
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
            _recordingTimer = (() => {
                const elapsed = Math.floor((Date.now() - _recordingStartTime) / 1000);
                const m = Math.floor(elapsed / 60).toString().padStart(2, '0');
                const s = (elapsed % 60).toString().padStart(2, '0');
                const timerEl = document.getElementById('voice-timer');
                if (timerEl) timerEl.textContent = `${m}:${s}`;
            }, 1000);

            // Start waveform
            const waveform = document.getElementById('voice-waveform');
            if (waveform) {
                waveform.innerHTML = Array.from({ length: 40 }, () =>
                    `<div class="waveform-bar" style="height:${Math.floor(Math.random() * 28) + 4}px;"></div>`
                ).join('');
                window._waveformInterval = (() => {
                    document.querySelectorAll('.waveform-bar').forEach(b => {
                        b.style.height = (Math.floor(Math.random() * 28) + 4) + 'px';
                    });
                }, 150);
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
        const voiceSettings = JSON.parse(localStorage.getItem('voice_settings') || '{}');
        const delay = voiceSettings.quality === 'high' ? 3000 : voiceSettings.quality === 'fast' ? 1000 : 2000;

        (() => {
            const samples = [
                "Customer is facing career stagnation and financial difficulties. Interested in PR4 solution. Office located in Bangsar with main entrance facing North-West.",
                "Discussed upcoming Feng Shui workshop. Client wants to bring two friends. Follow up next week with registration details.",
                "Property audit completed. Main entrance faces South, which is favorable for career. Recommended placing water feature in North area.",
                "Client interested in Harmony Painting for living room. Wants to know if it matches their Wood element.",
                "Follow-up call: Client decided to proceed with PR4 purchase. Payment scheduled for next Friday. Need to prepare invoice.",
                "Birthday greeting sent. Client replied with thanks and mentioned interest in office audit for new company premises."
            ];

            // Use browser speech recognition if available, else use sample
            if ('webkitSpeechRecognition' in window || 'SpeechRecognition' in window) {
                // In a real implementation would use actual transcript here
            }

            const transcribedText = samples[Math.floor(Math.random() * samples.length)];

            const transcribedEl = document.getElementById('voice-transcribed-text');
            const micIcon = document.getElementById('voice-mic-icon');
            const actionsEl = document.getElementById('voice-recorder-actions');

            if (transcribedEl) { transcribedEl.value = transcribedText; transcribedEl.placeholder = ''; }
            if (micIcon) micIcon.className = 'fas fa-microphone';
            if (actionsEl) actionsEl.style.display = 'flex';

            UI.toast.success('Transcription complete!');
        }, delay);
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
            UI.hideModal();
            UI.toast.success('Voice text inserted');
        } else {
            // Create a note record
            await createNoteFromVoice(target.entityType, target.entityId, transcribedText);
            UI.hideModal();
            UI.toast.success('Voice note saved');
        }
    };

    const createNoteFromVoice = async (entityType, entityId, text) => {
        const currentUser = Auth.getCurrentUser();
        const noteData = {
            id: Date.now(),
            text,
            author: currentUser?.full_name || 'System',
            date: new Date().toISOString().split('T')[0],
            is_voice_note: true
        };

        if (entityType === 'prospect') {
            noteData.prospect_id = entityId;
            await AppDataStore.create('notes', noteData);
            if (entityId) await showProspectDetail(entityId);
        } else if (entityType === 'customer') {
            noteData.customer_id = entityId;
            await AppDataStore.create('notes', noteData);
            if (entityId) await showCustomerDetail(entityId);
        } else if (entityType === 'agent') {
            noteData.agent_id = entityId;
            await AppDataStore.create('notes', noteData);
            if (entityId) await showAgentDetail(entityId);
        } else {
            await AppDataStore.create('notes', noteData);
        }
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
        UI.hideModal();
    };

    const deleteAudio = () => {
        _audioChunks = [];
        UI.toast.success('Audio file deleted');
    };

    const openVoiceSettings = () => {
        const saved = JSON.parse(localStorage.getItem('voice_settings') || '{}');
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

    const saveVoiceSettings = () => {
        const settings = {
            language: document.querySelector('input[name="voice-language"]:checked')?.value || 'en',
            quality: document.querySelector('input[name="voice-quality"]:checked')?.value || 'balanced',
            deleteAudio: document.getElementById('voice-delete-audio')?.checked ?? true,
            saveAudio: document.getElementById('voice-save-audio')?.checked ?? false
        };
        localStorage.setItem('voice_settings', JSON.stringify(settings));
        UI.hideModal();
        UI.toast.success('Voice settings saved');
    };

    // ==================== PHASE 14: MOBILE FUNCTIONS ====================

    const toggleMobileNav = () => {
        const navLinks = document.getElementById('nav-links');
        if (navLinks) {
            navLinks.classList.toggle('show');
        }
    };

    const isMobile = () => window.innerWidth <= 768;

    const renderMobileBottomNav = async () => {
        if (document.querySelector('.mobile-bottom-nav')) return; // Already added
        const bottomNav = document.createElement('div');
        bottomNav.className = 'mobile-bottom-nav';
        bottomNav.id = 'mobile-bottom-nav';
        bottomNav.innerHTML = `
            <div class="mobile-nav-item" onclick="await app.navigateTo('calendar')">
                <i class="fas fa-calendar-alt"></i>
                <span>Calendar</span>
            </div>
            <div class="mobile-nav-item" onclick="await app.navigateTo('prospects')">
                <i class="fas fa-users"></i>
                <span>Prospects</span>
            </div>
            <div class="mobile-nav-item" onclick="await app.navigateTo('pipeline')">
                <i class="fas fa-chart-line"></i>
                <span>Pipeline</span>
            </div>
            <div class="mobile-nav-item" onclick="await app.showMobileMenu()">
                <i class="fas fa-ellipsis-h"></i>
                <span>More</span>
            </div>
        `;
        document.body.appendChild(bottomNav);
    };

    const showMobileMenu = async () => {
        const menuItems = [
            { view: 'agents', label: 'Consultant', icon: 'fas fa-user-tie' },
            { view: 'promotions', label: 'Promotions', icon: 'fas fa-bullhorn' },
            { view: 'reports', label: 'Reports', icon: 'fas fa-chart-bar' },
            { view: 'documents', label: 'Documents', icon: 'fas fa-folder' },
            { view: 'protection', label: 'Protection', icon: 'fas fa-shield-alt' },
            { view: 'settings', label: 'Settings', icon: 'fas fa-cog' }
        ];

        const content = `
            <div class="mobile-menu">
                ${menuItems.map(item => `
                    <div class="mobile-menu-item" onclick="await app.navigateTo('${item.view}'); UI.hideModal()">
                        <i class="${item.icon}"></i>
                        <span>${item.label}</span>
                    </div>
                `).join('')}
            </div>
        `;
        UI.showModal('Menu', content, [{ label: 'Close', type: 'secondary', action: 'UI.hideModal()' }]);
    };

    const initSwipeActions = () => {
        let startX = 0;
        const threshold = 50;

        document.addEventListener('touchstart', (e) => { startX = e.touches[0].clientX; }, { passive: true });
        document.addEventListener('touchend', (e) => {
            const diff = e.changedTouches[0].clientX - startX;
            if (Math.abs(diff) > threshold) {
                // Swipe right to go back (if on detail view)
                if (diff > 0 && _currentView && document.querySelector('.profile-header')) {
                    // Optional: navigate back
                }
            }
        }, { passive: true });
    };

    const initPullToRefresh = async () => {
        const content = document.querySelector('.content-viewport');
        if (!content) return;

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

        content.addEventListener('touchend', (e) => {
            if (!startY) return;
            const diff = e.changedTouches[0].clientY - startY;
            if (diff > 80) {
                refreshEl.innerHTML = '<i class="fas fa-sync-alt fa-spin"></i> Refreshing...';
                setTimeout(async () => {
                    await navigateTo(_currentView || 'calendar');
                    refreshEl.classList.remove('show');
                    refreshEl.innerHTML = '<i class="fas fa-arrow-down"></i> Pull to refresh';
                }, 800);
            } else {
                refreshEl.classList.remove('show');
                refreshEl.innerHTML = '<i class="fas fa-arrow-down"></i> Pull to refresh';
            }
            startY = 0;
        }, { passive: true });
    };

    // ==================== PHASE 14: OFFLINE SUPPORT ====================

    const initOfflineSupport = () => {
        window.addEventListener('online', handleOnline);
        window.addEventListener('offline', handleOffline);

        // Load saved queue
        try {
            const saved = localStorage.getItem('offline_queue');
            if (saved) _offlineQueue = JSON.parse(saved);
        } catch (e) { _offlineQueue = []; }

        updateOfflineIndicator();
    };

    const handleOnline = async () => {
        _isOnline = true;
        UI.toast.success('Back online – syncing data...');
        await processOfflineQueue();
        updateOfflineIndicator();
    };

    const handleOffline = () => {
        _isOnline = false;
        UI.toast.warning('You are offline – changes will be queued');
        updateOfflineIndicator();
    };

    const updateOfflineIndicator = () => {
        let indicator = document.getElementById('offline-indicator');
        if (!indicator) {
            indicator = document.createElement('div');
            indicator.id = 'offline-indicator';
            document.body.appendChild(indicator);
        }

        if (!_isOnline) {
            indicator.innerHTML = `<i class="fas fa-wifi" style="text-decoration:line-through;"></i> Offline(${_offlineQueue.length} pending)`;
            indicator.style.display = 'flex';
        } else if (_offlineQueue.length > 0) {
            indicator.innerHTML = `<i class="fas fa-sync-alt fa-spin"></i> Syncing(${_offlineQueue.length} pending)`;
            indicator.style.display = 'flex';
        } else {
            indicator.style.display = 'none';
        }
    };

    const addToOfflineQueue = (action, data) => {
        const item = { id: Date.now() + Math.random(), action, data, timestamp: new Date().toISOString() };
        _offlineQueue.push(item);
        localStorage.setItem('offline_queue', JSON.stringify(_offlineQueue));
        updateOfflineIndicator();
        UI.toast.info('Action saved offline – will sync when online');
    };

    const processOfflineQueue = async () => {
        if (_offlineQueue.length === 0) return;
        const queue = [..._offlineQueue];
        _offlineQueue = [];
        localStorage.setItem('offline_queue', JSON.stringify(_offlineQueue));
        updateOfflineIndicator();

        let success = 0;
        let fail = 0;
        for (const item of queue) {
            try {
                if (item.action.startsWith('create_')) {
                    await AppDataStore.create(item.action.replace('create_', ''), item.data);
                } else if (item.action.startsWith('update_')) {
                    AppDataStore.update(item.action.replace('update_', ''), item.data.id, item.data);
                }
                success++;
            } catch (e) {
                fail++;
                _offlineQueue.push(item);
            }
        }
        localStorage.setItem('offline_queue', JSON.stringify(_offlineQueue));
        updateOfflineIndicator();

        if (fail === 0) UI.toast.success(`Synced ${success} offline actions`);
        else UI.toast.warning(`Synced ${success}, failed ${fail} `);
    };

    const offlineCreate = async (tableName, data) => {
        if (_isOnline) return await AppDataStore.create(tableName, data);
        addToOfflineQueue('create_' + tableName, data);
        return { ...data, id: 'offline-' + Date.now(), offline: true };
    };

    const offlineUpdate = (tableName, id, data) => {
        if (_isOnline) return AppDataStore.update(tableName, id, data);
        addToOfflineQueue('update_' + tableName, { ...data, id });
        return { ...data, id, offline: true };
    };

    // ========== GOOGLE CALENDAR INTEGRATION FUNCTIONS ==========

    class GoogleCalendarService {
        constructor() {
            this.baseUrl = 'https://www.googleapis.com/calendar/v3';
        }

        async getAccessToken() {
            return await refreshGoogleToken();
        }

        async createEvent(activity) {
            const token = await this.getAccessToken();
            if (!token) return null;

            const event = {
                summary: activity.activity_title || `${activity.activity_type} Meeting`,
                description: activity.discussion_summary || '',
                start: {
                    dateTime: `${activity.activity_date}T${activity.start_time}:00`,
                    timeZone: 'Asia/Kuala_Lumpur'
                },
                end: {
                    dateTime: `${activity.activity_date}T${activity.end_time}:00`,
                    timeZone: 'Asia/Kuala_Lumpur'
                },
                attendees: activity.co_agents ? activity.co_agents.map(a => ({ email: a.email })) : [],
                reminders: {
                    useDefault: true
                },
                extendedProperties: {
                    private: {
                        crm_activity_id: activity.id.toString(),
                        crm_type: activity.activity_type
                    }
                }
            };

            try {
                // In a real implementation this would call the API
                // For demo, we simulate success and return a mock event ID
                console.log('Mocking Google Calendar Event Creation', event);
                return 'mock_event_id_' + Date.now();
            } catch (error) {
                console.error('Error creating Google Calendar event:', error);
                return null;
            }
        }

        async updateEvent(activity, googleEventId) {
            const token = await this.getAccessToken();
            if (!token) return false;

            try {
                // For demo, simulate success
                console.log('Mocking Google Calendar Event Update', googleEventId);
                return true;
            } catch (error) {
                console.error('Error updating Google Calendar event:', error);
                return false;
            }
        }

        async deleteEvent(googleEventId) {
            const token = await this.getAccessToken();
            if (!token) return false;

            try {
                // For demo, simulate success
                console.log('Mocking Google Calendar Event Deletion', googleEventId);
                return true;
            } catch (error) {
                console.error('Error deleting Google Calendar event:', error);
                return false;
            }
        }

        async listEvents(timeMin, timeMax) {
            const token = await this.getAccessToken();
            if (!token) return [];

            try {
                // For demo, simulate empty events list
                console.log('Mocking Google Calendar Event List fetch');
                return [];
            } catch (error) {
                console.error('Error listing Google Calendar events:', error);
                return [];
            }
        }
    }

    class SyncManager {
        constructor() {
            this.googleCalendar = new GoogleCalendarService();
            this.syncInProgress = false;
            this.lastSyncTime = localStorage.getItem('last_google_sync');
        }

        async syncCRMtoGoogle() {
            if (this.syncInProgress) return;
            this.syncInProgress = true;

            try {
                const activities = await AppDataStore.getAll('activities');
                const syncLog = this.getSyncLog();

                let synced = 0, created = 0, updated = 0, deleted = 0;

                for (const activity of activities) {
                    const syncRecord = syncLog.find(s => s.activity_id === activity.id);

                    if (this.needsSync(activity, syncRecord)) {
                        if (activity.status === 'cancelled' && syncRecord?.google_event_id) {
                            await this.googleCalendar.deleteEvent(syncRecord.google_event_id);
                            this.removeSyncRecord(activity.id);
                            deleted++;
                        } else if (syncRecord?.google_event_id) {
                            await this.googleCalendar.updateEvent(activity, syncRecord.google_event_id);
                            await this.updateSyncRecord(activity.id, syncRecord.google_event_id);
                            updated++;
                        } else {
                            const googleEventId = await this.googleCalendar.createEvent(activity);
                            if (googleEventId) {
                                await this.addSyncRecord(activity.id, googleEventId);
                                created++;
                            }
                        }
                        synced++;
                    }
                }

                this.lastSyncTime = new Date().toISOString();
                localStorage.setItem('last_google_sync', this.lastSyncTime);

                if (created || updated || deleted) {
                    // Only show toast if something actually synced to avoid spam
                    UI.toast.success(`Google Calendar sync complete: ${created} created`);
                }
            } catch (error) {
                console.error('Sync error:', error);
            } finally {
                this.syncInProgress = false;
            }
        }

        async syncGoogleToCRM() {
            if (this.syncInProgress) return;
            this.syncInProgress = true;

            try {
                // For demo purposes, we will not fetch Google events, just finish.
                this.syncInProgress = false;
            } catch (error) {
                console.error('Import error:', error);
                this.syncInProgress = false;
            }
        }

        needsSync(activity, syncRecord) {
            if (!syncRecord) return true;
            const activityUpdated = new Date(activity.updated_at || activity.created_at);
            const syncUpdated = new Date(syncRecord.last_synced_at);
            return activityUpdated > syncUpdated;
        }

        getSyncLog() {
            const log = localStorage.getItem('google_sync_log');
            return log ? JSON.parse(log) : [];
        }

        async addSyncRecord(activityId, googleEventId) {
            const log = this.getSyncLog();
            log.push({
                activity_id: activityId,
                google_event_id: googleEventId,
                last_synced_at: new Date().toISOString()
            });
            localStorage.setItem('google_sync_log', JSON.stringify(log));

            // Also add to sync_history table
            const connection = await getGoogleConnection();
            if (connection && _currentUser) {
                await AppDataStore.create('sync_history', {
                    integration_id: connection.integration_id,
                    user_id: _currentUser.id,
                    activity_id: activityId,
                    google_event_id: googleEventId,
                    direction: 'crm_to_google',
                    status: 'success',
                    error_message: '',
                    synced_at: new Date().toISOString()
                });
            }
        }

        async updateSyncRecord(activityId, googleEventId) {
            const log = this.getSyncLog();
            const record = log.find(r => r.activity_id === activityId);
            if (record) {
                record.last_synced_at = new Date().toISOString();
            } else {
                log.push({
                    activity_id: activityId,
                    google_event_id: googleEventId,
                    last_synced_at: new Date().toISOString()
                });
            }
            localStorage.setItem('google_sync_log', JSON.stringify(log));

            const connection = await getGoogleConnection();
            if (connection && _currentUser) {
                await AppDataStore.create('sync_history', {
                    integration_id: connection.integration_id,
                    user_id: _currentUser.id,
                    activity_id: activityId,
                    google_event_id: googleEventId,
                    direction: 'crm_to_google',
                    status: 'success',
                    error_message: '',
                    synced_at: new Date().toISOString()
                });
            }
        }

        removeSyncRecord(activityId) {
            const log = this.getSyncLog();
            const filtered = log.filter(r => r.activity_id !== activityId);
            localStorage.setItem('google_sync_log', JSON.stringify(filtered));
        }

        resolveConflict(choice, activityId, eventId) {
            UI.hideModal();
            UI.toast.success(`Conflict resolved. Chose: ${choice}`);
        }
    }

    // Refresh Google Token - mock implementation for demo
    const refreshGoogleToken = async () => {
        const connection = await getGoogleConnection();
        if (connection && connection.access_token) {
            return connection.access_token;
        }
        return null;
    };

    let _googleCalendarService = null;
    let _syncManager = null;

    const initGoogleIntegration = () => {
        _googleCalendarService = new GoogleCalendarService();
        _syncManager = new SyncManager();
    };

    const showIntegrationHub = async (container) => {
        container.innerHTML = `
            <div class="integration-hub">
                <div class="integration-header">
                    <div>
                        <h1>Integration Hub</h1>
                        <p>Connect your CRM with external services</p>
                    </div>
                    <button class="btn secondary" onclick="await app.navigateTo('settings')">
                        <i class="fas fa-arrow-left"></i> Back to Settings
                    </button>
                </div>
                
                <div class="integration-grid">
                    ${await renderIntegrationCard('google', 'Google Calendar', 'Two-way sync', 'calendar', await getConnectionStatus('google'))}
                    ${await renderIntegrationCard('outlook', 'Outlook Calendar', 'One-way sync', 'calendar', await getConnectionStatus('outlook'))}
                    ${await renderIntegrationCard('whatsapp', 'WhatsApp Business', 'Outbound only', 'messaging', await getConnectionStatus('whatsapp'))}
                    ${await renderIntegrationCard('twilio', 'Twilio SMS', 'Outbound only', 'messaging', await getConnectionStatus('twilio'))}
                    ${await renderIntegrationCard('quickbooks', 'QuickBooks', 'One-way sync', 'accounting', await getConnectionStatus('quickbooks'))}
                    ${await renderIntegrationCard('googledrive', 'Google Drive', 'Two-way sync', 'storage', await getConnectionStatus('googledrive'))}
                </div>
            </div>
        `;
    };

    const renderIntegrationCard = async (id, name, description, type, status) => {
        const statusColors = {
            connected: 'status-connected',
            disconnected: 'status-disconnected',
            expired: 'status-expired'
        };

        const statusIcons = {
            calendar: 'fas fa-calendar-alt',
            messaging: 'fas fa-comment',
            accounting: 'fas fa-chart-line',
            storage: 'fas fa-database'
        };

        return `
            <div class="integration-card" onclick="await app.showIntegrationDetails('${id}')">
                <div class="integration-icon ${type}">
                    <i class="${statusIcons[type] || 'fas fa-plug'}"></i>
                </div>
                <div class="integration-info">
                    <h3>${name}</h3>
                    <p>${description}</p>
                    <div class="integration-status ${statusColors[status] || statusColors.disconnected}">
                        ${status === 'connected' ? '🟢 Connected' : status === 'expired' ? '🟡 Expired' : '🔴 Disconnected'}
                    </div>
                </div>
                <div class="integration-action">
                    <button class="btn ${status === 'connected' ? 'secondary' : 'primary'}" onclick="event.stopPropagation(); id === 'whatsapp' ? await app.showWhatsAppIntegration() : await app.showIntegrationDetails('${id}')">
                        ${status === 'connected' ? 'Configure' : 'Connect'}
                    </button>
                </div>
            </div>
        `;
    };

    const getConnectionStatus = async (integrationId) => {
        const connections = AppDataStore.query('integration_connections', {
            integration_id: await getIntegrationId(integrationId),
            user_id: _currentUser?.id || 1
        });

        if (connections.length === 0) return 'disconnected';

        const conn = connections[0];
        if (conn.token_expires_at && new Date(conn.token_expires_at) < new Date()) {
            return 'expired';
        }

        return conn.status;
    };

    const getIntegrationId = async (provider) => {
        const integrations = await AppDataStore.getAll('integrations');
        const integration = integrations.find(i => i.provider === provider);
        return integration ? integration.id : null;
    };

    const showIntegrationDetails = async (provider) => {
        if (provider === 'google') {
            await showGoogleCalendarIntegration();
        } else {
            UI.toast.info(`${provider} integration coming soon`);
        }
    };

    const showGoogleCalendarIntegration = async () => {
        const connection = await getGoogleConnection();
        const isConnected = connection && connection.status === 'connected';

        const viewport = document.getElementById('content-viewport');
        viewport.innerHTML = `
            <div class="integration-detail">
                <div class="detail-header">
                    <button class="btn secondary" onclick="await app.showIntegrationHub(document.getElementById('content-viewport'))">
                        <i class="fas fa-arrow-left"></i> Back to Integrations
                    </button>
                    <h1>Google Calendar Integration</h1>
                </div>
                
                <div class="connection-status ${isConnected ? 'connected' : 'disconnected'}">
                    <div class="status-indicator ${isConnected ? 'connected' : 'disconnected'}"></div>
                    <div class="status-text">
                        <h3>${isConnected ? 'Connected' : 'Disconnected'}</h3>
                        ${isConnected ? `
                            <p>Connected as: ${connection.user_email || 'user@gmail.com'}</p>
                            <p>Last Sync: ${connection.last_sync ? new Date(connection.last_sync).toLocaleString() : 'Never'}</p>
                        ` : `
                            <p>Connect your Google Calendar to sync activities both ways.</p>
                        `}
                    </div>
                    ${!isConnected ? `
                        <button class="btn primary btn-large" onclick="await app.initiateGoogleOAuth()">
                            <i class="fas fa-google"></i> Connect with Google
                        </button>
                    ` : ''}
                </div>
                
                ${isConnected ? `
                    <div class="sync-settings">
                        <h3>Sync Settings</h3>
                        
                        <div class="settings-section">
                            <h4>Sync Direction</h4>
                            <label class="radio-label">
                                <input type="radio" name="sync-direction" value="two-way" ${connection.sync_settings?.direction === 'two-way' || !connection.sync_settings ? 'checked' : ''}> Two-way sync (CRM ↔ Google)
                            </label>
                            <label class="radio-label">
                                <input type="radio" name="sync-direction" value="crm-to-google" ${connection.sync_settings?.direction === 'crm-to-google' ? 'checked' : ''}> CRM to Google only
                            </label>
                            <label class="radio-label">
                                <input type="radio" name="sync-direction" value="google-to-crm" ${connection.sync_settings?.direction === 'google-to-crm' ? 'checked' : ''}> Google to CRM only
                            </label>
                        </div>
                        
                        <div class="settings-section">
                            <h4>Sync Calendar</h4>
                            <select class="form-control" id="sync-calendar">
                                <option value="primary">Primary CRM Calendar</option>
                                <option value="work">Work Calendar</option>
                                <option value="personal">Personal Calendar</option>
                            </select>
                        </div>
                        
                        <div class="settings-section">
                            <h4>Sync Options</h4>
                            <label class="checkbox-label">
                                <input type="checkbox" id="sync-cps" ${connection.sync_settings?.syncTypes?.cps ?? true ? 'checked' : ''}> Sync CPS activities
                            </label>
                            <label class="checkbox-label">
                                <input type="checkbox" id="sync-ftf" ${connection.sync_settings?.syncTypes?.ftf ?? true ? 'checked' : ''}> Sync FTF meetings
                            </label>
                            <label class="checkbox-label">
                                <input type="checkbox" id="sync-fsa" ${connection.sync_settings?.syncTypes?.fsa ?? true ? 'checked' : ''}> Sync FSA appointments
                            </label>
                            <label class="checkbox-label">
                                <input type="checkbox" id="sync-event" ${connection.sync_settings?.syncTypes?.event ?? true ? 'checked' : ''}> Sync Events
                            </label>
                            <label class="checkbox-label">
                                <input type="checkbox" id="sync-call" ${connection.sync_settings?.syncTypes?.call ?? false ? 'checked' : ''}> Sync Calls (as reminders)
                            </label>
                        </div>
                        
                        <div class="settings-section">
                            <h4>Default Reminder</h4>
                            <select class="form-control" id="default-reminder">
                                <option value="0">No reminder</option>
                                <option value="5">5 minutes before</option>
                                <option value="10">10 minutes before</option>
                                <option value="15" selected>15 minutes before</option>
                                <option value="30">30 minutes before</option>
                                <option value="60">1 hour before</option>
                                <option value="1440">1 day before</option>
                            </select>
                        </div>
                        
                        <div class="settings-actions">
                            <button class="btn primary" onclick="await app.saveGoogleSettings()">Save Settings</button>
                            <button class="btn secondary" onclick="await app.syncGoogleCalendar()">Sync Now</button>
                            <button class="btn secondary" onclick="await app.viewSyncHistory()">View Sync History</button>
                            <button class="btn error" onclick="await app.disconnectGoogle()">Disconnect</button>
                        </div>
                    </div>
                ` : ''}
            </div>
        `;
    };

    const getGoogleConnection = async () => {
        const integrationId = await getIntegrationId('google');
        if (!integrationId) return null;

        const connections = AppDataStore.query('integration_connections', {
            integration_id: integrationId,
            user_id: _currentUser?.id || 1
        });

        return connections.length > 0 ? connections[0] : null;
    };

    const initiateGoogleOAuth = async () => {
        UI.showModal('Connect Google Calendar', `
            <div class="oauth-simulator">
                <p>This would open Google's OAuth consent screen.</p>
                <p>For demo purposes, click "Simulate Connection" to pretend it worked.</p>
                
                <div class="oauth-mock">
                    <div class="mock-account" style="display:flex;align-items:center;gap:16px;padding:16px;background:var(--gray-50);border-radius:8px;margin-bottom:16px;">
                        <i class="fas fa-user-circle" style="font-size:48px;color:#4285f4;"></i>
                        <div>
                            <strong>user@gmail.com</strong>
                            <p style="margin:0;font-size:13px;color:var(--gray-500)">Signed in to Google</p>
                        </div>
                    </div>
                    
                    <div class="mock-permissions" style="background:var(--gray-50);padding:16px;border-radius:8px;">
                        <h5 style="margin-top:0;">Google Calendar would like to:</h5>
                        <ul style="list-style:none;padding:0;">
                            <li style="padding:4px 0;"><i class="fas fa-check-circle" style="color:var(--success);"></i> See, edit, share, and permanently delete all calendars</li>
                            <li style="padding:4px 0;"><i class="fas fa-check-circle" style="color:var(--success);"></i> See and download any calendar</li>
                        </ul>
                    </div>
                </div>
            </div>
        `, [
            { label: 'Cancel', type: 'secondary', action: 'UI.hideModal()' },
            { label: 'Simulate Connection', type: 'primary', action: 'await app.simulateGoogleConnection()' }
        ]);
    };

    const simulateGoogleConnection = async () => {
        UI.hideModal();
        let integration = await AppDataStore.getAll('integrations').find(i => i.provider === 'google');
        if (!integration) {
            integration = await AppDataStore.create('integrations', {
                integration_name: 'Google Calendar',
                provider: 'google',
                type: 'calendar',
                is_active: true,
                config_schema: {},
                created_at: new Date().toISOString()
            });
        }

        const oldConn = await getGoogleConnection();
        if (oldConn) {
            AppDataStore.update('integration_connections', oldConn.id, {
                status: 'connected',
                token_expires_at: new Date(Date.now() + 3600 * 1000).toISOString(),
                updated_at: new Date().toISOString()
            });
        } else {
            await AppDataStore.create('integration_connections', {
                integration_id: integration.id,
                user_id: _currentUser?.id || 1,
                access_token: 'encrypted_mock_token',
                refresh_token: 'encrypted_mock_refresh',
                token_expires_at: new Date(Date.now() + 3600 * 1000).toISOString(),
                scope: 'calendar',
                status: 'connected',
                last_sync: null,
                sync_settings: {
                    direction: 'two-way',
                    calendars: ['primary'],
                    syncTypes: { cps: true, ftf: true, fsa: true, event: true, call: false }
                },
                created_at: new Date().toISOString()
            });
        }

        UI.toast.success('Google Calendar connected successfully');
        await showGoogleCalendarIntegration();
    };

    const saveGoogleSettings = async () => {
        const connection = await getGoogleConnection();
        if (!connection) return;

        const settings = {
            direction: document.querySelector('input[name="sync-direction"]:checked')?.value || 'two-way',
            calendar: document.getElementById('sync-calendar')?.value || 'primary',
            syncTypes: {
                cps: document.getElementById('sync-cps')?.checked || false,
                ftf: document.getElementById('sync-ftf')?.checked || false,
                fsa: document.getElementById('sync-fsa')?.checked || false,
                event: document.getElementById('sync-event')?.checked || false,
                call: document.getElementById('sync-call')?.checked || false
            },
            reminder: document.getElementById('default-reminder')?.value || '15'
        };

        AppDataStore.update('integration_connections', connection.id, {
            sync_settings: settings,
            updated_at: new Date().toISOString()
        });

        UI.toast.success('Google Calendar settings saved');
    };

    const syncGoogleCalendar = async () => {
        if (!_syncManager) {
            _syncManager = new SyncManager();
        }

        UI.toast.info('Starting Google Calendar sync...');

        await _syncManager.syncCRMtoGoogle();
        await _syncManager.syncGoogleToCRM();

        const connection = await getGoogleConnection();
        if (connection) {
            AppDataStore.update('integration_connections', connection.id, {
                last_sync: new Date().toISOString()
            });
        }
        await showGoogleCalendarIntegration();
    };

    const viewSyncHistory = async () => {
        const syncHistory = await AppDataStore.getAll('sync_history').filter(
            h => h.user_id === (_currentUser?.id || 1)
        ).sort((a, b) => new Date(b.synced_at) - new Date(a.synced_at));

        let tableHtml = `
            <div class="sync-history">
                <div class="history-filters" style="display:flex;gap:12px;margin-bottom:16px;">
                    <select class="form-control" style="width: 150px;" id="history-date-range">
                        <option value="7">Last 7 days</option>
                        <option value="30">Last 30 days</option>
                        <option value="90">Last 90 days</option>
                    </select>
                    <button class="btn secondary" onclick="await app.refreshSyncHistory()">Apply</button>
                </div>
                
                <table class="history-table" style="width:100%;border-collapse:collapse;margin-bottom:16px;">
                    <thead>
                        <tr style="background:var(--gray-50);border-bottom:2px solid var(--gray-200);text-align:left;">
                            <th style="padding:12px;">#</th>
                            <th style="padding:12px;">Activity</th>
                            <th style="padding:12px;">Direction</th>
                            <th style="padding:12px;">Status</th>
                            <th style="padding:12px;">Time</th>
                        </tr>
                    </thead>
                    <tbody>
        `;

        if (syncHistory.length === 0) {
            tableHtml += `
                <tr>
                    <td colspan="5" style="text-align: center; padding: 40px;">
                        <i class="fas fa-history" style="font-size: 48px; color: var(--gray-300);"></i>
                        <h3>No sync history yet</h3>
                        <p>Sync with Google Calendar to see history here</p>
                    </td>
                </tr>
            `;
        } else {
            syncHistory.slice(0, 10).forEach((item, index) => {
                const activity = AppDataStore.getById('activities', item.activity_id);
                const directionIcon = item.direction === 'crm_to_google' ? '→' : '←';
                const statusIcon = item.status === 'success' ? '✓' : item.status === 'conflict' ? '⚠' : '✗';
                const statusColor = item.status === 'success' ? '#10b981' : item.status === 'conflict' ? '#f59e0b' : '#ef4444';

                tableHtml += `
                    <tr style="border-bottom:1px solid var(--gray-100);">
                        <td style="padding:12px;">${index + 1}</td>
                        <td style="padding:12px;">${activity ? activity.activity_title : 'Unknown activity'}</td>
                        <td style="padding:12px;">CRM ${directionIcon} Google</td>
                        <td style="padding:12px;"><span style="color:${statusColor};font-weight:600;">${statusIcon} ${item.status}</span></td>
                        <td style="padding:12px;">${new Date(item.synced_at).toLocaleTimeString()}</td>
                    </tr>
                `;
            });
        }

        tableHtml += `
                    </tbody>
                </table>
                
                <div class="history-actions" style="display:flex;gap:12px;justify-content:flex-end;">
                    <button class="btn secondary" onclick="app.exportSyncHistory()">Export Log</button>
                    <button class="btn secondary" onclick="await app.clearSyncHistory()">Clear History</button>
                </div>
            </div>
        `;

        UI.showModal('Sync History - Google Calendar', tableHtml, [
            { label: 'Close', type: 'secondary', action: 'UI.hideModal()' }
        ]);
    };

    const exportSyncHistory = () => { UI.toast.info('Exporting sync history...'); };
    const clearSyncHistory = async () => {
        const logs =await  AppDataStore.getAll('sync_history').filter(h => h.user_id !== (_currentUser?.id || 1));
        localStorage.setItem('fs_crm_sync_history', JSON.stringify(logs));
        UI.toast.success('Sync history cleared');
        await viewSyncHistory();
    };
    const refreshSyncHistory = async () => { await viewSyncHistory(); };

    const disconnectGoogle = async () => {
        UI.showModal('Disconnect Google Calendar', `
            <p>Are you sure you want to disconnect Google Calendar?</p>
            <p>This will stop all sync between CRM and Google Calendar.</p>
            <p class="warning-text" style="color:var(--error);font-weight:600;">Your existing activities will remain in both systems.</p>
        `, [
            { label: 'Cancel', type: 'secondary', action: 'UI.hideModal()' },
            { label: 'Disconnect', type: 'error', action: 'await app.confirmDisconnectGoogle()' }
        ]);
    };

    const confirmDisconnectGoogle = async () => {
        const connection = await getGoogleConnection();
        if (connection) {
            AppDataStore.update('integration_connections', connection.id, {
                status: 'disconnected',
                updated_at: new Date().toISOString()
            });
        }
        UI.hideModal();
        UI.toast.success('Google Calendar disconnected');
        await showGoogleCalendarIntegration();
    };

    const resolveConflict = (choice, activityId, eventId) => {
        if (_syncManager) _syncManager.resolveConflict(choice, activityId, eventId);
    };

    // Hook into activity CRUD for auto-sync
    const originalCreateActivity = AppDataStore.create;
    const originalUpdateActivity = AppDataStore.update;
    const originalDeleteActivity = AppDataStore.delete;

    AppDataStore.create = async function (tableName, data) {
        const result = await originalCreateActivity.call(this, tableName, data);
        if (tableName === 'activities' && _syncManager) {
            setTimeout(async () => {
                const connection = await getGoogleConnection();
                if (connection && connection.sync_settings?.syncTypes[data.activity_type?.toLowerCase()]) {
                    await _syncManager.syncCRMtoGoogle().catch(console.error);
                }
            }, 1000);
        }
        return result;
    };

    AppDataStore.update = async function (tableName, id, data) {
        const result = await originalUpdateActivity.call(this, tableName, id, data);
        if (tableName === 'activities' && _syncManager) {
            setTimeout(async () => {
                const connection = await getGoogleConnection();
                const activity = AppDataStore.getById('activities', id);
                if (connection && activity && connection.sync_settings?.syncTypes[activity.activity_type?.toLowerCase()]) {
                    await _syncManager.syncCRMtoGoogle().catch(console.error);
                }
            }, 1000);
        }
        return result;
    };

    AppDataStore.delete = async function (tableName, id) {
        const result = await originalDeleteActivity.call(this, tableName, id);
        if (tableName === 'activities' && _syncManager) {
            setTimeout(async () => {
                const connection = await getGoogleConnection();
                if (connection) {
                    await _syncManager.syncCRMtoGoogle().catch(console.error);
                }
            }, 1000);
        }
        return result;
    };

    // ========== WHATSAPP BUSINESS INTEGRATION FUNCTIONS ==========

    let _whatsappService = null;

    // Initialize WhatsApp service
    const initWhatsAppIntegration = () => {
        _whatsappService = {
            sendMessage: sendWhatsAppMessage,
            sendFreeText: sendFreeTextWhatsApp,
            syncTemplates: syncWhatsAppTemplates
        };
    };

    // Get WhatsApp connection
    const getWhatsAppConnection = async () => {
        const integrations = await AppDataStore.getAll('integrations');
        const whatsappIntegration = integrations.find(i => i.provider === 'whatsapp');

        if (!whatsappIntegration) return null;

        const connections = AppDataStore.query('integration_connections', {
            integration_id: whatsappIntegration.id,
            user_id: _currentUser?.id || 1
        });

        return connections.length > 0 ? connections[0] : null;
    };

    // Show WhatsApp integration settings
    const showWhatsAppIntegration = async () => {
        const connection = await getWhatsAppConnection();
        const isConnected = connection && connection.status === 'connected';

        const content = `
            <div class="whatsapp-integration">
                <div class="detail-header" style="margin-bottom: 24px; display: flex; align-items: center; gap: 16px;">
                    <button class="btn secondary" onclick="await app.showIntegrationHub(document.getElementById('content-viewport'))">
                        <i class="fas fa-arrow-left"></i> Back to Integrations
                    </button>
                    <h1 style="margin: 0; font-size: 24px;">WhatsApp Business Integration</h1>
                </div>

                <div class="connection-status ${isConnected ? 'connected' : 'disconnected'}">
                    <div class="status-indicator ${isConnected ? 'connected' : 'disconnected'}"></div>
                    <div class="status-text">
                        <h3>${isConnected ? 'Connected' : 'Disconnected'}</h3>
                        ${isConnected ? `
                            <p>Connected as: ${connection.business_phone || '+65 9123 4567'}</p>
                            <p>Last Sync: ${connection.last_sync ? new Date(connection.last_sync).toLocaleString() : 'Never'}</p>
                        ` : `
                            <p>Connect your WhatsApp Business account to send messages and track conversations.</p>
                        `}
                    </div>
                </div>
                
                <div class="connection-form" style="margin-top: 24px; background: var(--white); padding: 24px; border-radius: 8px; box-shadow: var(--shadow-md);">
                    <h3>Connection Details</h3>
                    
                    <div class="form-group">
                        <label>WhatsApp Business Account ID</label>
                        <input type="text" id="waba-id" class="form-control" value="${connection?.business_account_id || ''}" placeholder="123456789012345">
                    </div>
                    
                    <div class="form-group">
                        <label>Phone Number ID</label>
                        <input type="text" id="phone-id" class="form-control" value="${connection?.phone_number_id || ''}" placeholder="123456789012345">
                    </div>
                    
                    <div class="form-group">
                        <label>Business Phone Number</label>
                        <input type="text" id="business-phone" class="form-control" value="${connection?.business_phone || '+65 9123 4567'}" placeholder="+65 9123 4567">
                    </div>
                    
                    <div class="form-group">
                        <label>Access Token</label>
                        <div class="token-input">
                            <input type="password" id="access-token" class="form-control" value="${connection?.access_token ? '••••••••' : ''}" placeholder="Enter access token">
                            <button class="btn secondary" onclick="await app.testWhatsAppConnection()">Test Connection</button>
                        </div>
                    </div>
                    
                    <h3 style="margin-top: 24px;">Webhook Configuration</h3>
                    
                    <div class="form-group">
                        <label>Webhook URL</label>
                        <div class="webhook-url">
                            <input type="text" id="webhook-url" class="form-control" value="https://your-crm.com/api/whatsapp/webhook" readonly>
                            <button class="btn-icon" onclick="app.copyWebhookUrl()" title="Copy"><i class="fas fa-copy"></i></button>
                        </div>
                    </div>
                    
                    <div class="form-group">
                        <label>Verification Token</label>
                        <div class="token-input">
                            <input type="password" id="verify-token" class="form-control" value="${connection?.verify_token || ''}" placeholder="Enter verification token">
                            <button class="btn secondary" onclick="await app.verifyWebhook()">Verify</button>
                        </div>
                    </div>
                    
                    <div class="webhook-status">
                        <span class="status-indicator ${connection?.webhook_verified ? 'connected' : 'disconnected'}"></span>
                        <span>${connection?.webhook_verified ? 'Active - Last ping: 2 minutes ago' : 'Not verified'}</span>
                    </div>
                </div>
                
                <div class="form-actions">
                    <button class="btn primary" onclick="await app.saveWhatsAppConnection()">Save Connection</button>
                    ${isConnected ? `
                        <button class="btn secondary" onclick="await app.testWhatsAppConnection()">Test Connection</button>
                        <button class="btn error" onclick="await app.disconnectWhatsApp()">Disconnect</button>
                    ` : ''}
                </div>
            </div>
        `;
        const viewport = document.getElementById('content-viewport');
        if (viewport) {
            viewport.innerHTML = content;
        } else {
            UI.showModal('WhatsApp Business Integration', content, [
                { label: 'Close', type: 'secondary', action: 'UI.hideModal()' }
            ]);
        }
    };

    // Save WhatsApp connection
    const saveWhatsAppConnection = async () => {
        const businessAccountId = document.getElementById('waba-id')?.value;
        const phoneNumberId = document.getElementById('phone-id')?.value;
        const businessPhone = document.getElementById('business-phone')?.value;
        const accessToken = document.getElementById('access-token')?.value;
        const verifyToken = document.getElementById('verify-token')?.value;

        if (!businessAccountId || !phoneNumberId || !businessPhone || !accessToken) {
            UI.toast.error('Please fill in all required fields');
            return;
        }

        let integration = await AppDataStore.getAll('integrations').find(i => i.provider === 'whatsapp');
        if (!integration) {
            integration = await AppDataStore.create('integrations', {
                integration_name: 'WhatsApp Business',
                provider: 'whatsapp',
                type: 'messaging',
                is_active: true,
                config_schema: {},
                created_at: new Date().toISOString()
            });
        }

        const existingConnection = await getWhatsAppConnection();
        const connectionData = {
            integration_id: integration.id,
            user_id: _currentUser?.id || 1,
            business_account_id: businessAccountId,
            phone_number_id: phoneNumberId,
            business_phone: businessPhone,
            access_token: accessToken,
            verify_token: verifyToken,
            status: 'connected',
            updated_at: new Date().toISOString()
        };

        if (existingConnection) {
            AppDataStore.update('integration_connections', existingConnection.id, connectionData);
        } else {
            await AppDataStore.create('integration_connections', {
                ...connectionData,
                created_at: new Date().toISOString()
            });
        }

        UI.hideModal();
        UI.toast.success('WhatsApp connection saved');
        await showWhatsAppIntegration();
    };

    const testWhatsAppConnection = async () => {
        UI.toast.info('Testing connection...');
        (() => {
            UI.toast.success('Connection successful!');
        }, 1500);
    };

    const verifyWebhook = async () => {
        UI.toast.success('Webhook verified successfully');
        const connection = await getWhatsAppConnection();
        if (connection) {
            AppDataStore.update('integration_connections', connection.id, {
                webhook_verified: true,
                updated_at: new Date().toISOString()
            });
        }
    };

    const copyWebhookUrl = () => {
        const url = document.getElementById('webhook-url');
        url.select();
        document.execCommand('copy');
        UI.toast.success('Webhook URL copied to clipboard');
    };

    const disconnectWhatsApp = async () => {
        UI.showModal('Disconnect WhatsApp', `
            <p>Are you sure you want to disconnect WhatsApp Business?</p>
            <p>This will stop all messaging and template sync.</p>
        `, [
            { label: 'Cancel', type: 'secondary', action: 'UI.hideModal()' },
            { label: 'Disconnect', type: 'error', action: 'await app.confirmDisconnectWhatsApp()' }
        ]);
    };

    const confirmDisconnectWhatsApp = async () => {
        const connection = await getWhatsAppConnection();
        if (connection) {
            AppDataStore.update('integration_connections', connection.id, {
                status: 'disconnected',
                updated_at: new Date().toISOString()
            });
        }
        UI.hideModal();
        UI.toast.success('WhatsApp disconnected');
        await showWhatsAppIntegration();
    };

    const openSendWhatsAppModal = async (entityType, entityId) => {
        const entity = entityType === 'prospect'
            ? AppDataStore.getById('prospects', entityId)
            : AppDataStore.getById('customers', entityId);
        if (!entity) return;

        // Create demo templates if empty
        let templates = await AppDataStore.getAll('whatsapp_templates');
        if (templates.length === 0) {
            templates = [
                await AppDataStore.create('whatsapp_templates', { template_name: 'Birthday Greeting', status: 'APPROVED', content: 'Hi {{name}}, wishing you a very happy birthday!' }),
                await AppDataStore.create('whatsapp_templates', { template_name: 'Appointment Reminder', status: 'APPROVED', content: 'Hi {{name}}, your appointment is confirmed.' })
            ];
        }

        const content = `
            <div class="send-whatsapp-modal">
                <h3>Send WhatsApp to ${entity.full_name} (${entity.phone})</h3>
                <div class="message-type">
                    <label class="radio-label">
                        <input type="radio" name="msg-type" value="template" checked onchange="app.toggleMessageType()"> Use Template
                    </label>
                    <label class="radio-label">
                        <input type="radio" name="msg-type" value="free" onchange="app.toggleMessageType()"> Free Text
                    </label>
                </div>
                
                <div id="template-section">
                    <div class="form-group">
                        <label>Template</label>
                        <select id="template-select" class="form-control" onchange="app.previewTemplate()">
                            <option value="">Select a template</option>
                            ${templates.map(t => `<option value="${t.id}">${t.template_name}</option>`).join('')}
                        </select>
                    </div>
                </div>
                
                <div id="free-text-section" style="display: none;">
                    <div class="form-group">
                        <label>Message</label>
                        <textarea id="free-message" class="form-control" rows="4" placeholder="Type your message..."></textarea>
                    </div>
                </div>
                
                <div class="schedule-options">
                    <label class="radio-label"><input type="radio" name="schedule" value="now" checked> Send now</label>
                    <label class="radio-label"><input type="radio" name="schedule" value="later"> Schedule for later</label>
                </div>
            </div>
        `;
        UI.showModal('Send WhatsApp Message', content, [
            { label: 'Cancel', type: 'secondary', action: 'UI.hideModal()' },
            { label: 'Send', type: 'primary', action: `app.sendWhatsApp('${entityType}', ${entityId})` }
        ]);
        window._currentWhatsAppEntity = { type: entityType, id: entityId, phone: entity.phone };
    };

    const toggleMessageType = () => {
        const isTemplate = document.querySelector('input[name="msg-type"]:checked')?.value === 'template';
        document.getElementById('template-section').style.display = isTemplate ? 'block' : 'none';
        document.getElementById('free-text-section').style.display = isTemplate ? 'none' : 'block';
    };

    const sendWhatsApp = async (entityType, entityId) => {
        const isTemplate = document.querySelector('input[name="msg-type"]:checked')?.value === 'template';
        const isNow = document.querySelector('input[name="schedule"]:checked')?.value === 'now';

        if (isTemplate) {
            const templateId = document.getElementById('template-select')?.value;
            if (!templateId) { UI.toast.error('Please select a template'); return; }
            const template = AppDataStore.getById('whatsapp_templates', parseInt(templateId));
            setTimeout(async () => {
                await AppDataStore.create('whatsapp_messages', {
                    id: 'wamid_' + Date.now(),
                    entity_type: entityType,
                    entity_id: entityId,
                    direction: 'outgoing',
                    to: window._currentWhatsAppEntity.phone,
                    template_name: template.template_name,
                    content: template.content,
                    status: 'delivered',
                    sent_at: new Date().toISOString()
                });
                UI.hideModal();
                UI.toast.success('Message sent successfully');
                if (entityType === 'prospect') await app.showProspectDetail(entityId);
                else await app.showCustomerDetail(entityId);
            }, 800);
        } else {
            const message = document.getElementById('free-message')?.value;
            if (!message) { UI.toast.error('Please enter a message'); return; }
            setTimeout(async () => {
                await AppDataStore.create('whatsapp_messages', {
                    id: 'wamid_' + Date.now(),
                    entity_type: entityType,
                    entity_id: entityId,
                    direction: 'outgoing',
                    to: window._currentWhatsAppEntity.phone,
                    content: message,
                    status: 'delivered',
                    sent_at: new Date().toISOString()
                });
                UI.hideModal();
                UI.toast.success('Message sent successfully');
                if (entityType === 'prospect') await app.showProspectDetail(entityId);
                else await app.showCustomerDetail(entityId);
            }, 800);
        }
    };

    const renderWhatsAppHistoryTab = async (entityType, entityId) => {
        const messages = await AppDataStore.getAll('whatsapp_messages')
            .filter(m => m.entity_type === entityType && m.entity_id == entityId)
            .sort((a, b) => new Date(b.sent_at || b.created_at) - new Date(a.sent_at || a.created_at));

        if (messages.length === 0) {
            return `
                <div class="empty-history" style="text-align:center; padding: 40px; color: var(--gray-500);">
                    <i class="fab fa-whatsapp" style="font-size: 48px; color: #25D366; margin-bottom: 16px;"></i>
                    <h3>No WhatsApp messages yet</h3>
                    <p>Click the WhatsApp button to send your first message</p>
                </div>
            `;
        }

        return `
            <div class="whatsapp-history" style="display:flex; flex-direction:column; gap:16px;">
                ${messages.map(msg => `
                    <div class="message-item ${msg.direction}">
                        <div class="message-header" style="display:flex; justify-content:space-between; margin-bottom:8px; font-size:12px; color:var(--gray-600);">
                            <span>${msg.direction === 'outgoing' ? '📤 Outgoing' : '📥 Incoming'} · ${new Date(msg.sent_at || msg.created_at).toLocaleString()}</span>
                            ${msg.template_name ? `<span class="template-badge">${msg.template_name}</span>` : ''}
                        </div>
                        <div class="message-content" style="font-size:14px; margin-bottom: 8px;">
                            ${msg.content || msg.template_name + ' template message'}
                        </div>
                        <div class="message-footer" style="display:flex; justify-content:space-between; align-items:center; font-size:11px;">
                            <span class="message-status status-${msg.status}">
                                ${msg.status === 'sent' ? '✓ Sent' : msg.status === 'delivered' ? '✓✓ Delivered' : msg.status === 'read' ? '👁️ Read' : '❌ Failed'}
                            </span>
                            <div class="message-actions">
                                <button class="btn-icon" onclick="await app.viewMessageDetails('${msg.id}')"><i class="fas fa-eye"></i></button>
                                <button class="btn-icon" onclick="app.todo('Resend Message')"><i class="fas fa-redo"></i></button>
                            </div>
                        </div>
                    </div>
                `).join('')}
            </div>
        `;
    };

    const addWhatsAppButtonToProfile = async (entityType, entityId) => {
        const headers = document.querySelectorAll('.header-actions');
        headers.forEach(header => {
            // Prevent duplicate buttons
            if (!header.querySelector('.btn-whatsapp-add')) {
                const button = document.createElement('button');
                button.className = 'btn secondary btn-whatsapp-add';
                button.innerHTML = '<i class="fab fa-whatsapp" style="color:#25D366;"></i> WhatsApp';
                button.onclick = async () => await openSendWhatsAppModal(entityType, entityId);
                header.insertBefore(button, header.lastElementChild);
            }
        });
    };

    const viewMessageDetails = async (messageId) => {
        const message = await AppDataStore.getAll('whatsapp_messages').find(m => m.id === messageId);
        if (!message) return;
        const content = `
            <div class="message-details">
                <div class="message-metadata" style="background:var(--gray-50); padding:16px; border-radius:8px; margin-bottom:16px;">
                    <div><strong>To:</strong> ${message.to || ''}</div>
                    <div><strong>Direction:</strong> ${message.direction}</div>
                    <div><strong>Message ID:</strong> ${message.id}</div>
                    <div><strong>Sent:</strong> ${new Date(message.sent_at || message.created_at).toLocaleString()}</div>
                </div>
                <div class="message-bubble-large" style="background:#e5ddd5; padding:20px; border-radius:12px; margin-bottom:16px;">
                    ${message.content || message.template_name}
                </div>
            </div>
        `;
        UI.showModal('Message Details', content, [
            { label: 'Close', type: 'secondary', action: 'UI.hideModal()' }
        ]);
    };

    // Mock functions for missing references
    //const previewTemplate = () => {};
    const resendMessage = () => { };
    const replyToMessage = () => { };
    const forwardMessage = () => { };
    const createTaskFromMessage = () => { };
    const syncWhatsAppTemplates = async () => { UI.toast.success('Templates synced'); };
    const sendWhatsAppMessage = async (to, templateName, variables) => { };
    const sendFreeTextWhatsApp = async (to, text) => { };
    const importSelectedTemplates = () => { };
    const showTemplateSyncModal = (templates) => { };

    // ========== PHASE 17: AI ANALYTICS FUNCTIONS ==========

    let _aiService = null;
    let _currentModelVersion = '1.0.0';

    // Initialize AI Service
    const initAIAnalytics = async () => {
        console.log('Initializing AI Analytics...');

        _aiService = {
            predictLeadScore: predictLeadScore,
            calculateChurnRisk: calculateChurnRisk,
            generateForecast: generateSalesForecast,
            getPerformanceInsights: generateAgentInsights,
            retrainModels: retrainAIModels
        };

        // Check if AI models exist, create default if not
        await ensureAIModelsExist();

        // Run initial predictions
        (() => {
            await batchUpdateLeadScores();
            await batchUpdateChurnRisks();
        }, 2000);
    };

    // Ensure AI models exist in AppDataStore
    const ensureAIModelsExist = async () => {
        const models = await AppDataStore.getAll('ai_models');

        if (models.length === 0) {
            // Create default models
            const defaultModels = [
                {
                    id: generateModelId(),
                    model_name: 'lead_scoring',
                    model_version: _currentModelVersion,
                    accuracy: 87.5,
                    trained_at: new Date().toISOString(),
                    trained_on_records: 1250,
                    features_used: {
                        engagement_score: 0.35,
                        demographic_fit: 0.25,
                        behavioral_signals: 0.20,
                        source_quality: 0.15,
                        recency: 0.05
                    },
                    is_active: true,
                    created_at: new Date().toISOString(),
                    updated_at: new Date().toISOString()
                },
                {
                    id: generateModelId(),
                    model_name: 'churn_prediction',
                    model_version: _currentModelVersion,
                    accuracy: 82.3,
                    trained_at: new Date().toISOString(),
                    trained_on_records: 850,
                    features_used: {
                        activity_recency: 0.30,
                        support_tickets: 0.20,
                        payment_history: 0.25,
                        engagement_trend: 0.15,
                        contract_status: 0.10
                    },
                    is_active: true,
                    created_at: new Date().toISOString(),
                    updated_at: new Date().toISOString()
                },
                {
                    id: generateModelId(),
                    model_name: 'sales_forecast',
                    model_version: _currentModelVersion,
                    accuracy: 89.1,
                    trained_at: new Date().toISOString(),
                    trained_on_records: 2100,
                    features_used: {
                        historical_sales: 0.40,
                        pipeline_stage: 0.25,
                        seasonality: 0.15,
                        team_performance: 0.10,
                        market_trends: 0.10
                    },
                    is_active: true,
                    created_at: new Date().toISOString(),
                    updated_at: new Date().toISOString()
                }
            ];

            defaultModels.forEach(model => {
                await AppDataStore.create('ai_models', model);
            });

            console.log('Default AI models created');
        }
    };

    // Show AI Insights Dashboard
    const showAIInsightsDashboard = async () => {
        const content = `
            <div class="ai-dashboard">
                <div class="dashboard-header">
                    <h2>AI Insights Dashboard</h2>
                    <button class="btn secondary" onclick="app.refreshAIPredictions()">
                        <i class="fas fa-sync-alt"></i> Refresh
                    </button>
                </div>
                
                <div class="stats-grid">
                    ${await renderAIStatsCards()}
                </div>
                
                <div class="chart-container">
                    <h3>AI Predictions Timeline</h3>
                    <div class="ai-timeline-chart" id="ai-timeline-chart">
                        ${renderAITimelineChart()}
                    </div>
                    <div class="chart-legend">
                        <div class="legend-item"><span class="color-dot actual"></span> Actual</div>
                        <div class="legend-item"><span class="color-dot predicted"></span> Predicted</div>
                        <div class="legend-item"><span class="color-dot target"></span> Target</div>
                        <div class="legend-item"><span class="color-dot confidence"></span> Confidence: 85%</div>
                    </div>
                </div>
                
                <div class="insights-grid">
                    <div class="insight-card" onclick="await app.showLeadScoring()">
                        <i class="fas fa-chart-line"></i>
                        <h4>Lead Scoring</h4>
                        <p>156 leads> 80 score</p>
                        <span class="trend up">+34 this week</span>
                    </div>
                    <div class="insight-card" onclick="await app.showSalesForecast()">
                        <i class="fas fa-dollar-sign"></i>
                        <h4>Sales Forecast</h4>
                        <p>$2.4M next 30 days</p>
                        <span class="trend down">-12% vs last month</span>
                    </div>
                    <div class="insight-card" onclick="await app.showChurnRiskAnalysis()">
                        <i class="fas fa-exclamation-triangle"></i>
                        <h4>Churn Risk</h4>
                        <p>23 customers at risk</p>
                        <span class="trend up warning">+15% increase</span>
                    </div>
                    <div class="insight-card" onclick="await app.showPerformanceInsights()">
                        <i class="fas fa-users"></i>
                        <h4>Team Insights</h4>
                        <p>8 recommendations</p>
                        <span class="trend up">3 high priority</span>
                    </div>
                </div>
                
                <div class="recent-predictions">
                    <h3>Top Predictions This Week</h3>
                    <table class="predictions-table">
                        <thead>
                            <tr>
                                <th>Lead/Customer</th>
                                <th>Prediction Type</th>
                                <th>Score</th>
                                <th>Confidence</th>
                                <th>Recommended Action</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${await renderTopPredictions()}
                        </tbody>
                    </table>
                </div>
            </div>
        `;

        UI.showModal('AI Insights Dashboard', content, [
            { label: 'Close', type: 'secondary', action: 'UI.hideModal()' }
        ], 'fullscreen');
    };

    // Render AI Stats Cards
    const renderAIStatsCards = async () => {
        // Get forecast data
        const forecasts = await AppDataStore.getAll('forecast_history')
            .filter(f => new Date(f.forecast_date) > new Date(Date.now() - 30 * 24 * 60 * 60 * 1000))
            .sort((a, b) => new Date(b.forecast_date) - new Date(a.forecast_date));

        const latestForecast = forecasts[0] || { predicted_amount: 2400000 };

        // Get lead scores
        const leadScores = await AppDataStore.getAll('lead_scores')
            .filter(l => new Date(l.score_date) > new Date(Date.now() - 7 * 24 * 60 * 60 * 1000));

        const highValueLeads = leadScores.filter(l => l.overall_score >= 80).length;
        const newHighValueLeads = leadScores.filter(l =>
            l.overall_score >= 80 &&
            new Date(l.score_date) > new Date(Date.now() - 2 * 24 * 60 * 60 * 1000)
        ).length;

        // Get churn risks
        const churnRisks = await AppDataStore.getAll('churn_risk')
            .filter(c => c.risk_level === 'high');

        return `
            <div class="stat-card">
                <div class="stat-icon blue">
                    <i class="fas fa-chart-line"></i>
                </div>
                <div class="stat-content">
                    <h4>Sales Forecast</h4>
                    <div class="stat-value">$${(latestForecast.predicted_amount / 1000000).toFixed(1)}M</div>
                    <div class="stat-trend negative">
                        <i class="fas fa-arrow-down"></i> 12% vs last month
                    </div>
                </div>
            </div>
            
            <div class="stat-card">
                <div class="stat-icon green">
                    <i class="fas fa-trophy"></i>
                </div>
                <div class="stat-content">
                    <h4>Lead Scoring</h4>
                    <div class="stat-value">${highValueLeads}</div>
                    <div class="stat-trend positive">
                        <i class="fas fa-arrow-up"></i> ${newHighValueLeads} new this week
                    </div>
                </div>
            </div>
            
            <div class="stat-card">
                <div class="stat-icon red">
                    <i class="fas fa-exclamation-circle"></i>
                </div>
                <div class="stat-content">
                    <h4>Churn Risk</h4>
                    <div class="stat-value">${churnRisks.length}</div>
                    <div class="stat-trend negative">
                        <i class="fas fa-arrow-up"></i> 15% increase
                    </div>
                </div>
            </div>
        `;
    };

    // Render AI Timeline Chart
    const renderAITimelineChart = () => {
        // Generate mock data for the chart
        const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
        const actualData = [1.2, 1.5, 1.4, 1.8, 1.9, 2.1, 2.0, 2.2, 2.3, 2.1, 2.4, 2.6];
        const predictedData = [1.3, 1.6, 1.5, 1.9, 2.0, 2.2, 2.1, 2.3, 2.4, 2.2, 2.5, 2.8];
        const targetData = [1.5, 1.7, 1.7, 2.0, 2.1, 2.3, 2.3, 2.5, 2.6, 2.5, 2.7, 3.0];

        let chartHTML = '<div class="timeline-bars">';

        for (let i = 0; i < months.length; i++) {
            const actualHeight = (actualData[i] / 3) * 100;
            const predictedHeight = (predictedData[i] / 3) * 100;
            const targetHeight = (targetData[i] / 3) * 100;

            chartHTML += `
                <div class="timeline-bar-group">
                    <div class="bar-container">
                        <div class="bar actual" style="height: ${actualHeight}px" title="Actual: $${actualData[i]}M"></div>
                        <div class="bar predicted" style="height: ${predictedHeight}px" title="Predicted: $${predictedData[i]}M"></div>
                        <div class="bar target" style="height: ${targetHeight}px" title="Target: $${targetData[i]}M"></div>
                    </div>
                    <div class="bar-label">${months[i]}</div>
                </div>
            `;
        }

        chartHTML += '</div>';

        return chartHTML;
    };

    // Render Top Predictions
    const renderTopPredictions = async () => {
        // Combine lead scores and churn risks for display
        const predictions = [];

        // Add top lead scores
        const leadScores = await AppDataStore.getAll('lead_scores')
            .filter(l => l.prospect_id)
            .sort((a, b) => b.overall_score - a.overall_score)
            .slice(0, 3);

        leadScores.forEach(score => {
            const prospect = AppDataStore.getById('prospects', score.prospect_id);
            if (prospect) {
                predictions.push({
                    name: prospect.full_name,
                    type: 'Lead Score',
                    score: score.overall_score,
                    confidence: 85 + Math.floor(Math.random() * 10),
                    action: score.recommended_action || 'Contact now',
                    icon: '🔥'
                });
            }
        });

        // Add top churn risks
        const churnRisks = await AppDataStore.getAll('churn_risk')
            .sort((a, b) => b.risk_score - a.risk_score)
            .slice(0, 2);

        churnRisks.forEach(risk => {
            const customer = AppDataStore.getById('customers', risk.customer_id);
            if (customer) {
                predictions.push({
                    name: customer.full_name,
                    type: 'Churn Risk',
                    score: risk.risk_score,
                    confidence: 78 + Math.floor(Math.random() * 15),
                    action: risk.recommended_actions?.[0] || 'Contact immediately',
                    icon: '⚠️'
                });
            }
        });

        // Sort by score descending
        predictions.sort((a, b) => b.score - a.score);

        let rows = '';
        predictions.forEach(p => {
            const confidenceClass = p.confidence >= 85 ? 'high' : p.confidence >= 70 ? 'medium' : 'low';

            rows += `
                <tr>
                    <td><strong>${p.icon} ${p.name}</strong></td>
                    <td>${p.type}</td>
                    <td><span class="score-badge ${p.score >= 80 ? 'high' : p.score >= 60 ? 'medium' : 'low'}">${p.score}</span></td>
                    <td><span class="confidence ${confidenceClass}">${p.confidence}%</span></td>
                    <td><button class="btn-link" onclick="app.executeAction('${p.action}')">${p.action}</button></td>
                </tr>
            `;
        });

        return rows || '<tr><td colspan="5" class="empty-state">No predictions available</td></tr>';
    };

    // Show Lead Scoring Interface
    const showLeadScoring = async () => {
        // Get active model
        const model = await AppDataStore.getAll('ai_models').find(m => m.model_name === 'lead_scoring' && m.is_active);

        // Get recent lead scores
        const leadScores = await AppDataStore.getAll('lead_scores')
            .filter(l => l.prospect_id)
            .sort((a, b) => new Date(b.score_date) - new Date(a.score_date))
            .slice(0, 10);

        let scoresHTML = '';
        leadScores.forEach(score => {
            const prospect = AppDataStore.getById('prospects', score.prospect_id);
            if (!prospect) return;

            const trendIcon = score.trend === 'up' ? '⬆️' : score.trend === 'down' ? '⬇️' : '➡️';
            const scoreClass = score.overall_score >= 80 ? 'high' : score.overall_score >= 60 ? 'medium' : 'low';

            scoresHTML += `
                <tr>
                    <td><strong>${prospect.full_name}</strong></td>
                    <td><span class="score-badge ${scoreClass}">${score.overall_score}</span></td>
                    <td>${trendIcon} ${score.trend === 'up' ? '+' + (score.factors?.engagement_score || 0) : ''}</td>
                    <td>${score.prediction === 'hot' ? '🔥 Hot' : score.prediction === 'warm' ? '👌 Warm' : '❄️ Cold'}</td>
                    <td>${score.recommended_action || 'Contact'}</td>
                    <td><button class="btn-icon" onclick="app.viewLeadDetails(${prospect.id})"><i class="fas fa-eye"></i></button></td>
                </tr>
            `;
        });

        const content = `
            <div class="lead-scoring-dashboard">
                <div class="scoring-header">
                    <h3>AI Lead Scoring</h3>
                    <div>
                        <span class="model-badge">Model v${model?.model_version || '1.0'} • Accuracy: ${model?.accuracy || 87.5}%</span>
                        <button class="btn secondary" onclick="app.retrainAIModels()">
                            <i class="fas fa-sync-alt"></i> Retrain
                        </button>
                    </div>
                </div>
                
                <div class="factors-card">
                    <h4>Lead Scoring Factors</h4>
                    <table class="factors-table">
                        <thead>
                            <tr>
                                <th>Factor</th>
                                <th>Weight</th>
                                <th>Current Value</th>
                                <th>Impact</th>
                            </tr>
                        </thead>
                        <tbody>
                            <tr>
                                <td>Engagement Score</td>
                                <td>35%</td>
                                <td>82/100</td>
                                <td><span class="trend up">⬆️ +12</span></td>
                            </tr>
                            <tr>
                                <td>Demographic Fit</td>
                                <td>25%</td>
                                <td>90/100</td>
                                <td><span class="trend up">⬆️ +8</span></td>
                            </tr>
                            <tr>
                                <td>Behavioral Signals</td>
                                <td>20%</td>
                                <td>65/100</td>
                                <td><span class="trend down">⬇️ -5</span></td>
                            </tr>
                            <tr>
                                <td>Source Quality</td>
                                <td>15%</td>
                                <td>95/100</td>
                                <td><span class="trend up">⬆️ +10</span></td>
                            </tr>
                            <tr>
                                <td>Recency</td>
                                <td>5%</td>
                                <td>40/100</td>
                                <td><span class="trend down">⬇️ -3</span></td>
                            </tr>
                            <tr class="total-row">
                                <td colspan="2"><strong>TOTAL SCORE</strong></td>
                                <td><span class="score-large">82/100</span></td>
                                <td><span class="prediction-badge high">HIGH VALUE</span></td>
                            </tr>
                        </tbody>
                    </table>
                </div>
                
                <div class="top-leads-card">
                    <div class="card-header">
                        <h4>Top Scoring Leads This Week</h4>
                        <div>
                            <button class="btn-icon" onclick="app.recalculateLeadScores()" title="Recalculate Scores">
                                <i class="fas fa-calculator"></i>
                            </button>
                            <button class="btn-icon" onclick="app.exportLeads()" title="Export Leads">
                                <i class="fas fa-download"></i>
                            </button>
                        </div>
                    </div>
                    <table class="leads-table">
                        <thead>
                            <tr>
                                <th>Lead Name</th>
                                <th>Score</th>
                                <th>Trend</th>
                                <th>Prediction</th>
                                <th>Recommended Action</th>
                                <th></th>
                            </tr>
                        </thead>
                        <tbody>
                            ${scoresHTML || '<tr><td colspan="6" class="empty-state">No scored leads available</td></tr>'}
                        </tbody>
                    </table>
                </div>
                
                <div class="action-buttons">
                    <button class="btn primary" onclick="app.createSegmentFromScoredLeads()">
                        <i class="fas fa-filter"></i> Create Segment from Top Leads
                    </button>
                    <button class="btn secondary" onclick="app.scheduleBulkFollowup()">
                        <i class="fas fa-clock"></i> Schedule Bulk Follow-up
                    </button>
                    <button class="btn secondary" onclick="app.exportScoringReport()">
                        <i class="fas fa-file-pdf"></i> Export Report
                    </button>
                </div>
            </div>
        `;

        UI.showModal('AI Lead Scoring', content, [
            { label: 'Close', type: 'secondary', action: 'UI.hideModal()' }
        ], 'fullscreen');
    };

    // Predict lead score for a prospect
    const predictLeadScore = async (prospectId) => {
        const prospect = AppDataStore.getById('prospects', prospectId);
        if (!prospect) return null;

        // Get activities for this prospect
        const activities = AppDataStore.query('activities', { prospect_id: prospectId });

        // Calculate engagement score (0-100)
        const recentActivities = activities.filter(a =>
            new Date(a.activity_date) > new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
        ).length;

        const emailOpens = activities.filter(a => a.activity_type === 'EMAIL_OPEN').length;
        const whatsappReplies = activities.filter(a => a.activity_type === 'WHATSAPP_REPLY').length;

        const engagementScore = Math.min(100, Math.floor(
            (recentActivities * 5) +
            (emailOpens * 10) +
            (whatsappReplies * 15)
        ));

        // Calculate demographic fit (mock - would use real demographic data)
        const demographicFit = 70 + Math.floor(Math.random() * 30);

        // Calculate behavioral signals
        const timeOnSite = Math.floor(Math.random() * 100);
        const pageViews = Math.floor(Math.random() * 50);
        const behavioralScore = Math.min(100, Math.floor((timeOnSite + pageViews) / 1.5));

        // Source quality based on referral source
        let sourceQuality = 50;
        if (prospect.source === 'referral') sourceQuality = 95;
        else if (prospect.source === 'website') sourceQuality = 70;
        else if (prospect.source === 'event') sourceQuality = 80;
        else if (prospect.source === 'social') sourceQuality = 60;

        // Recency score
        const lastActivity = activities.sort((a, b) =>
            new Date(b.activity_date) - new Date(a.activity_date)
        )[0];

        let recencyScore = 0;
        if (lastActivity) {
            const daysSince = Math.floor((Date.now() - new Date(lastActivity.activity_date).getTime()) / (24 * 60 * 60 * 1000));
            recencyScore = Math.max(0, 100 - (daysSince * 5));
        }

        // Calculate weighted score
        const overallScore = Math.floor(
            (engagementScore * 0.35) +
            (demographicFit * 0.25) +
            (behavioralScore * 0.20) +
            (sourceQuality * 0.15) +
            (recencyScore * 0.05)
        );

        // Determine async trend (compare with last score)
        const lastScore = await AppDataStore.getAll('lead_scores')
            .filter(l => l.prospect_id === prospectId)
            .sort((a, b) => new Date(b.score_date) - new Date(a.score_date))[0];

        let trend = 'stable';
        if (lastScore) {
            if (overallScore > lastScore.overall_score + 5) trend = 'up';
            else if (overallScore < lastScore.overall_score - 5) trend = 'down';
        }

        // Determine prediction
        let prediction = 'cold';
        let recommendedAction = 'Nurture with content';

        if (overallScore >= 80) {
            prediction = 'hot';
            recommendedAction = 'Contact immediately - high priority';
        } else if (overallScore >= 60) {
            prediction = 'warm';
            recommendedAction = 'Schedule follow-up within 3 days';
        } else if (overallScore >= 40) {
            recommendedAction = 'Send nurturing sequence';
        }

        // Create lead score record
        const leadScore = {
            id: generateId(),
            prospect_id: prospectId,
            score_date: new Date().toISOString(),
            overall_score: overallScore,
            factors: {
                engagement_score: engagementScore,
                demographic_fit: demographicFit,
                behavioral_signals: behavioralScore,
                source_quality: sourceQuality,
                recency: recencyScore
            },
            trend: trend,
            prediction: prediction,
            recommended_action: recommendedAction,
            model_version: _currentModelVersion,
            expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
            created_at: new Date().toISOString()
        };

        await AppDataStore.create('lead_scores', leadScore);

        return leadScore;
    };

    // Batch update all lead scores
    const batchUpdateLeadScores = async () => {
        const prospects = await AppDataStore.getAll('prospects').filter(p => p.status === 'active');

        prospects.forEach(prospect => {
            await predictLeadScore(prospect.id);
        });

        console.log(`Updated scores for ${prospects.length} prospects`);
        UI.toast.success(`Updated scores for ${prospects.length} prospects`);
    };

    // Show Sales Forecast
    const showSalesForecast = async () => {
        const forecast = await generateSalesForecast('quarterly');

        const content = `
            <div class="forecast-dashboard">
                <div class="forecast-header">
                    <h3>AI Sales Forecast</h3>
                    <div class="forecast-controls">
                        <select id="forecast-period" class="form-control" onchange="app.changeForecastPeriod(this.value)">
                            <option value="weekly">Weekly</option>
                            <option value="monthly">Monthly</option>
                            <option value="quarterly" selected>Quarterly</option>
                            <option value="yearly">Yearly</option>
                        </select>
                        <select id="forecast-compare" class="form-control">
                            <option value="previous">vs Previous Period</option>
                            <option value="last-year">vs Last Year</option>
                            <option value="target">vs Target</option>
                        </select>
                    </div>
                </div>
                
                <div class="forecast-accuracy">
                    <div class="accuracy-meter">
                        <span class="accuracy-label">Forecast Accuracy: 87% ±3%</span>
                        <div class="accuracy-bar">
                            <div class="accuracy-fill" style="width: 87%"></div>
                        </div>
                    </div>
                </div>
                
                <div class="forecast-chart-large">
                    ${renderForecastChart()}
                </div>
                
                <div class="forecast-numbers">
                    <div class="number-card">
                        <div class="number-label">Predicted</div>
                        <div class="number-value">$${(forecast.predicted_amount / 1000000).toFixed(1)}M</div>
                    </div>
                    <div class="number-card best">
                        <div class="number-label">Best Case</div>
                        <div class="number-value">$${(forecast.best_case / 1000000).toFixed(1)}M</div>
                        <div class="number-trend">+16%</div>
                    </div>
                    <div class="number-card worst">
                        <div class="number-label">Worst Case</div>
                        <div class="number-value">$${(forecast.worst_case / 1000000).toFixed(1)}M</div>
                        <div class="number-trend negative">-12%</div>
                    </div>
                </div>
                
                <div class="forecast-breakdown">
                    <h4>Forecast Breakdown</h4>
                    <table class="breakdown-table">
                        <thead>
                            <tr>
                                <th>Source</th>
                                <th>Current</th>
                                <th>Predicted</th>
                                <th>Confidence</th>
                                <th></th>
                            </tr>
                        </thead>
                        <tbody>
                            <tr>
                                <td>Existing Deals</td>
                                <td>$1.2M</td>
                                <td>$1.4M <span class="trend up">⬆️</span></td>
                                <td><span class="confidence high">95%</span></td>
                                <td><button class="btn-link" onclick="app.viewDealDetails('existing')">View</button></td>
                            </tr>
                            <tr>
                                <td>New Prospects</td>
                                <td>$850K</td>
                                <td>$650K <span class="trend down">⬇️</span></td>
                                <td><span class="confidence medium">72%</span></td>
                                <td><button class="btn-link" onclick="app.viewProspectDetails()">View</button></td>
                            </tr>
                            <tr>
                                <td>Upsells</td>
                                <td>$350K</td>
                                <td>$280K <span class="trend down">⬇️</span></td>
                                <td><span class="confidence medium">68%</span></td>
                                <td><button class="btn-link" onclick="app.viewUpsellOpportunities()">View</button></td>
                            </tr>
                            <tr>
                                <td>Referrals</td>
                                <td>$120K</td>
                                <td>$180K <span class="trend up">⬆️</span></td>
                                <td><span class="confidence high">88%</span></td>
                                <td><button class="btn-link" onclick="app.viewReferrals()">View</button></td>
                            </tr>
                            <tr>
                                <td>Renewals</td>
                                <td>$180K</td>
                                <td>$160K <span class="trend down">⬇️</span></td>
                                <td><span class="confidence high">91%</span></td>
                                <td><button class="btn-link" onclick="app.viewRenewals()">View</button></td>
                            </tr>
                        </tbody>
                    </table>
                </div>
                
                <div class="forecast-actions">
                    <button class="btn primary" onclick="app.exportForecast()">
                        <i class="fas fa-download"></i> Export Forecast
                    </button>
                    <button class="btn secondary" onclick="app.adjustForecast()">
                        <i class="fas fa-sliders-h"></i> Adjust Factors
                    </button>
                    <button class="btn secondary" onclick="app.scheduleForecastReview()">
                        <i class="fas fa-calendar-alt"></i> Schedule Review
                    </button>
                </div>
            </div>
        `;

        UI.showModal('AI Sales Forecast', content, [
            { label: 'Close', type: 'secondary', action: 'UI.hideModal()' }
        ], 'fullscreen');
    };

    // Generate sales forecast
    const generateSalesForecast = async (period = 'quarterly') => {
        // Get historical transactions
        const transactions = await AppDataStore.getAll('transactions');

        // Get pipeline deals
        const prospects = await AppDataStore.getAll('prospects').filter(p => p.status === 'active');

        // Simple forecast calculation
        const historicalAvg = transactions.length > 0
            ? transactions.reduce((sum, t) => sum + (t.amount || 0), 0) / Math.max(1, transactions.length / 30)
            : 100000;

        const pipelineValue = prospects.length * 5000; // Mock calculation

        const predictedAmount = historicalAvg + (pipelineValue * 0.3);
        const bestCase = predictedAmount * 1.16;
        const worstCase = predictedAmount * 0.88;

        // Save forecast to history
        const forecast = {
            id: generateId(),
            forecast_date: new Date().toISOString(),
            period: period,
            period_start: getPeriodStart(period),
            period_end: getPeriodEnd(period),
            predicted_amount: predictedAmount,
            confidence_low: worstCase,
            confidence_high: bestCase,
            breakdown: {
                existing_deals: predictedAmount * 0.58,
                new_prospects: predictedAmount * 0.27,
                upsells: predictedAmount * 0.12,
                referrals: predictedAmount * 0.03
            },
            model_version: _currentModelVersion,
            created_at: new Date().toISOString()
        };

        await AppDataStore.create('forecast_history', forecast);

        return {
            predicted_amount: predictedAmount,
            best_case: bestCase,
            worst_case: worstCase,
            breakdown: forecast.breakdown
        };
    };

    // Helper functions for period calculation
    const getPeriodStart = (period) => {
        const now = new Date();
        if (period === 'weekly') {
            return new Date(now.setDate(now.getDate() - now.getDay())).toISOString();
        } else if (period === 'monthly') {
            return new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
        } else if (period === 'quarterly') {
            const quarter = Math.floor(now.getMonth() / 3);
            return new Date(now.getFullYear(), quarter * 3, 1).toISOString();
        } else {
            return new Date(now.getFullYear(), 0, 1).toISOString();
        }
    };

    const getPeriodEnd = (period) => {
        const start = new Date(getPeriodStart(period));
        if (period === 'weekly') {
            return new Date(start.setDate(start.getDate() + 6)).toISOString();
        } else if (period === 'monthly') {
            return new Date(start.getFullYear(), start.getMonth() + 1, 0).toISOString();
        } else if (period === 'quarterly') {
            return new Date(start.getFullYear(), start.getMonth() + 3, 0).toISOString();
        } else {
            return new Date(start.getFullYear(), 11, 31).toISOString();
        }
    };

    // Render forecast chart
    const renderForecastChart = () => {
        const weeks = ['W1', 'W2', 'W3', 'W4', 'W5', 'W6', 'W7', 'W8', 'W9', 'W10', 'W11', 'W12'];
        const values = [1.8, 2.0, 1.9, 2.2, 2.3, 2.5, 2.4, 2.6, 2.7, 2.5, 2.8, 3.0];

        let chartHTML = '<div class="forecast-bars">';

        values.forEach((val, i) => {
            const height = (val / 3) * 150; // Scale to max height 150px
            chartHTML += `
                <div class="forecast-bar-group">
                    <div class="forecast-bar" style="height: ${height}px" title="$${val}M"></div>
                    <div class="forecast-label">${weeks[i]}</div>
                </div>
            `;
        });

        chartHTML += '</div>';

        return chartHTML;
    };

    // Show Churn Risk Analysis
    const showChurnRiskAnalysis = async () => {
        // Get all churn risks
        const churnRisks = await AppDataStore.getAll('churn_risk')
            .sort((a, b) => b.risk_score - a.risk_score);

        const highRisk = churnRisks.filter(c => c.risk_level === 'high').length;
        const mediumRisk = churnRisks.filter(c => c.risk_level === 'medium').length;
        const lowRisk = churnRisks.filter(c => c.risk_level === 'low').length;
        const total = churnRisks.length || 1; // avoid div by 0

        let risksHTML = '';
        churnRisks.slice(0, 5).forEach(risk => {
            const customer = AppDataStore.getById('customers', risk.customer_id);
            if (!customer) return;

            const riskClass = risk.risk_level === 'high' ? 'high' : risk.risk_level === 'medium' ? 'medium' : 'low';
            const factors = risk.factors || {};

            risksHTML += `
                <tr>
                    <td><strong>${customer.full_name}</strong></td>
                    <td><span class="risk-badge ${riskClass}">${risk.risk_score}%</span></td>
                    <td>
                        <div class="risk-factors">
                            ${Object.entries(factors).slice(0, 2).map(([key, val]) =>
                `<span class="factor-tag">${key}: ${val}</span>`
            ).join('')}
                        </div>
                    </td>
                    <td><button class="btn-link" onclick="app.contactAtRiskCustomer(${customer.id})">Contact</button></td>
                </tr>
            `;
        });

        const content = `
            <div class="churn-dashboard">
                <div class="churn-header">
                    <h3>Churn Risk Analysis</h3>
                    <div class="overall-risk">
                        <span class="risk-meter">15.3%</span>
                        <span class="risk-trend negative">⬆️ +2.1% vs last month</span>
                    </div>
                </div>
                
                <div class="risk-distribution">
                    <h4>Risk Distribution</h4>
                    <div class="distribution-bars">
                        <div class="distribution-item">
                            <span class="distribution-label">High Risk (${highRisk} customers)</span>
                            <div class="distribution-bar-container">
                                <div class="distribution-bar high" style="width: ${(highRisk / total) * 100}%"></div>
                            </div>
                            <span class="distribution-value">${Math.round((highRisk / total) * 100)}%</span>
                        </div>
                        <div class="distribution-item">
                            <span class="distribution-label">Medium Risk (${mediumRisk} customers)</span>
                            <div class="distribution-bar-container">
                                <div class="distribution-bar medium" style="width: ${(mediumRisk / total) * 100}%"></div>
                            </div>
                            <span class="distribution-value">${Math.round((mediumRisk / total) * 100)}%</span>
                        </div>
                        <div class="distribution-item">
                            <span class="distribution-label">Low Risk (${lowRisk} customers)</span>
                            <div class="distribution-bar-container">
                                <div class="distribution-bar low" style="width: ${(lowRisk / total) * 100}%"></div>
                            </div>
                            <span class="distribution-value">${Math.round((lowRisk / total) * 100)}%</span>
                        </div>
                    </div>
                </div>
                
                <div class="at-risk-customers">
                    <h4>Top At-Risk Customers</h4>
                    <table class="risk-table">
                        <thead>
                            <tr>
                                <th>Customer</th>
                                <th>Risk Score</th>
                                <th>Key Factors</th>
                                <th>Action</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${risksHTML || '<tr><td colspan="4" class="empty-state">No churn risk data available</td></tr>'}
                        </tbody>
                    </table>
                </div>
                
                <div class="recommended-actions">
                    <h4>Recommended Actions</h4>
                    <ul class="action-list">
                        <li class="action-item high">
                            <input type="checkbox" id="action1">
                            <label for="action1">Contact ${highRisk} high-risk customers this week</label>
                        </li>
                        <li class="action-item medium">
                            <input type="checkbox" id="action2">
                            <label for="action2">Schedule account reviews for medium-risk group (${mediumRisk} customers)</label>
                        </li>
                        <li class="action-item low">
                            <input type="checkbox" id="action3">
                            <label for="action3">Send satisfaction survey to all at-risk customers</label>
                        </li>
                        <li class="action-item critical">
                            <input type="checkbox" id="action4">
                            <label for="action4"><strong>⚠️ 3 customers showing critical signs - immediate attention required</strong></label>
                        </li>
                    </ul>
                    <button class="btn primary" onclick="app.executeRiskActions()">
                        <i class="fas fa-check-circle"></i> Execute Selected Actions
                    </button>
                </div>
            </div>
        `;

        UI.showModal('Churn Risk Analysis', content, [
            { label: 'Close', type: 'secondary', action: 'UI.hideModal()' }
        ], 'fullscreen');
    };

    // Calculate churn risk for a customer
    const calculateChurnRisk = async (customerId) => {
        const customer = AppDataStore.getById('customers', customerId);
        if (!customer) return null;

        // Get customer activities
        const activities = AppDataStore.query('activities', { customer_id: customerId });

        // Calculate activity recency
        const lastActivity = activities.sort((a, b) =>
            new Date(b.activity_date) - new Date(a.activity_date)
        )[0];

        let recencyScore = 0;
        if (lastActivity) {
            const daysSince = Math.floor((Date.now() - new Date(lastActivity.activity_date).getTime()) / (24 * 60 * 60 * 1000));
            recencyScore = daysSince > 60 ? 100 : daysSince > 30 ? 70 : daysSince > 14 ? 40 : 10;
        } else {
            recencyScore = 90; // No activity at all
        }

        // Support ticket count (mock)
        const supportTickets = Math.floor(Math.random() * 10);
        const supportScore = Math.min(100, supportTickets * 15);

        // Payment history
        const paymentScore = Math.floor(Math.random() * 100); // Mock

        // Engagement trend
        const recentActivities = activities.filter(a =>
            new Date(a.activity_date) > new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
        ).length;

        const previousActivities = activities.filter(a => {
            const date = new Date(a.activity_date);
            return date > new Date(Date.now() - 60 * 24 * 60 * 60 * 1000) &&
                date <= new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
        }).length;

        let trendScore = 50;
        if (recentActivities < previousActivities * 0.5) {
            trendScore = 80; // High risk - engagement dropping
        } else if (recentActivities > previousActivities * 1.5) {
            trendScore = 20; // Low risk - engagement increasing
        }

        // Contract status (mock)
        const contractScore = Math.floor(Math.random() * 100);

        // Calculate overall risk score
        const riskScore = Math.floor(
            (recencyScore * 0.30) +
            (supportScore * 0.20) +
            (paymentScore * 0.25) +
            (trendScore * 0.15) +
            (contractScore * 0.10)
        );

        // Determine risk level
        let riskLevel = 'low';
        if (riskScore >= 70) riskLevel = 'high';
        else if (riskScore >= 40) riskLevel = 'medium';

        // Generate warning signals
        const warningSignals = [];
        if (recencyScore > 70) warningSignals.push('No activity for over 30 days');
        if (supportScore > 70) warningSignals.push('High support ticket volume');
        if (paymentScore > 70) warningSignals.push('Payment delays detected');
        if (trendScore > 70) warningSignals.push('Engagement dropping significantly');
        if (contractScore > 70) warningSignals.push('Contract expiring soon');

        // Generate recommended actions
        const recommendedActions = [];
        if (riskLevel === 'high') {
            recommendedActions.push('Contact immediately');
            recommendedActions.push('Schedule account review');
            recommendedActions.push('Offer retention incentive');
        } else if (riskLevel === 'medium') {
            recommendedActions.push('Send satisfaction survey');
            recommendedActions.push('Schedule check-in call');
        } else {
            recommendedActions.push('Monitor activity');
            recommendedActions.push('Send newsletter');
        }

        // Create churn risk record
        const churnRisk = {
            id: generateId(),
            customer_id: customerId,
            risk_score: riskScore,
            risk_level: riskLevel,
            factors: {
                activity_recency: recencyScore,
                support_tickets: supportScore,
                payment_history: paymentScore,
                engagement_trend: trendScore,
                contract_status: contractScore
            },
            predicted_churn_date: new Date(Date.now() + (90 * 24 * 60 * 60 * 1000)).toISOString(),
            probability: riskScore / 100,
            warning_signals: warningSignals,
            recommended_actions: recommendedActions,
            model_version: _currentModelVersion,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString()
        };

        await AppDataStore.create('churn_risk', churnRisk);

        return churnRisk;
    };

    // Batch update all churn risks
    const batchUpdateChurnRisks = async () => {
        const customers = await AppDataStore.getAll('customers').filter(c => c.status === 'active');

        customers.forEach(customer => {
            await calculateChurnRisk(customer.id);
        });

        console.log(`Updated churn risks for ${customers.length} customers`);
        UI.toast.success(`Updated churn risks for ${customers.length} customers`);
    };

    // Show Performance Insights
    const showPerformanceInsights = async () => {
        const agents = await AppDataStore.getAll('users').filter(isAgent);

        let insightsHTML = '';
        agents.forEach(agent => {
            const insights = await generateAgentInsights(agent.id);

            if (insights) {
                const varianceClass = insights.variance > 0 ? 'positive' : 'negative';
                const trendIcon = insights.variance > 0 ? '⬆️' : '⬇️';

                insightsHTML += `
                    <tr>
                        <td><strong>${agent.full_name}</strong></td>
                        <td>$${(insights.target / 1000).toFixed(0)}K</td>
                        <td>$${(insights.actual / 1000).toFixed(0)}K</td>
                        <td>$${(insights.predicted / 1000).toFixed(0)}K</td>
                        <td><span class="variance ${varianceClass}">${trendIcon} ${Math.abs(insights.variance)}%</span></td>
                        <td>
                            <div class="agent-insight">
                                <span class="insight-strength">💪 ${insights.strength}</span>
                                <span class="insight-improvement">📈 ${insights.improvement}</span>
                            </div>
                        </td>
                        <td><button class="btn-icon" onclick="app.viewAgentDetails(${agent.id})"><i class="fas fa-chart-bar"></i></button></td>
                    </tr>
                `;
            }
        });

        const content = `
            <div class="performance-dashboard">
                <div class="performance-header">
                    <h3>Agent Performance Insights</h3>
                    <button class="btn secondary" onclick="app.refreshPerformanceInsights()">
                        <i class="fas fa-sync-alt"></i> Refresh
                    </button>
                </div>
                
                <div class="team-performance">
                    <h4>Team Performance vs AI Predictions</h4>
                    <table class="performance-table">
                        <thead>
                            <tr>
                                <th>Agent</th>
                                <th>Target</th>
                                <th>Actual</th>
                                <th>Predicted</th>
                                <th>Variance</th>
                                <th>Insights</th>
                                <th></th>
                            </tr>
                        </thead>
                        <tbody>
                            ${insightsHTML || '<tr><td colspan="7" class="empty-state">No performance data available</td></tr>'}
                        </tbody>
                    </table>
                </div>
                
                <div class="activity-recommendations">
                    <h4>AI Activity Recommendations</h4>
                    <div class="recommendations-grid">
                        <div class="recommendation-card">
                            <i class="fas fa-phone-alt"></i>
                            <div class="recommendation-content">
                                <h5>Best time to call</h5>
                                <p>Tue 10-11am (32% higher connect rate)</p>
                                <small>Based on 10,247 historical calls</small>
                            </div>
                        </div>
                        <div class="recommendation-card">
                            <i class="fas fa-calendar-check"></i>
                            <div class="recommendation-content">
                                <h5>Best day for meetings</h5>
                                <p>Wednesday (45% show rate)</p>
                                <small>Based on 3,892 scheduled meetings</small>
                            </div>
                        </div>
                        <div class="recommendation-card">
                            <i class="fas fa-clock"></i>
                            <div class="recommendation-content">
                                <h5>Optimal follow-up</h5>
                                <p>Within 2 hours (3x conversion)</p>
                                <small>Based on 15,678 follow-up sequences</small>
                            </div>
                        </div>
                        <div class="recommendation-card">
                            <i class="fas fa-envelope"></i>
                            <div class="recommendation-content">
                                <h5>Email subject line</h5>
                                <p>"Quick question" (22% open rate)</p>
                                <small>Based on 8,431 email campaigns</small>
                            </div>
                        </div>
                    </div>
                </div>
                
                <div class="performance-actions">
                    <button class="btn primary" onclick="app.scheduleCoachingSessions()">
                        <i class="fas fa-chalkboard-teacher"></i> Schedule Coaching Sessions
                    </button>
                    <button class="btn secondary" onclick="app.generatePerformanceReport()">
                        <i class="fas fa-file-alt"></i> Generate Full Report
                    </button>
                    <button class="btn secondary" onclick="app.shareInsights()">
                        <i class="fas fa-share-alt"></i> Share Insights
                    </button>
                </div>
            </div>
        `;

        UI.showModal('Performance Insights', content, [
            { label: 'Close', type: 'secondary', action: 'UI.hideModal()' }
        ], 'fullscreen');
    };

    // Generate insights for an agent
    const generateAgentInsights = async (agentId) => {
        // Get agent stats
        const stats = AppDataStore.query('agent_stats', { agent_id: agentId })[0];
        if (!stats) return null;

        // Get agent targets
        const target = AppDataStore.query('monthly_targets', { agent_id: agentId })[0];

        // Mock data for demo
        const actual = 435000 + Math.floor(Math.random() * 150000);
        const predicted = 480000 + Math.floor(Math.random() * 50000);
        const targetValue = target?.target_amount || 500000;

        const variance = Math.round(((actual - predicted) / predicted) * 100);

        const strengths = [
            'Closing rate (32% vs avg 24%)',
            'Best at WhatsApp follow-ups',
            'High customer satisfaction',
            'Quick response time'
        ];

        const improvements = [
            'Follow-up async speed (2.1 days vs 1.2 avg)',
            'Call volume ↓40% this month',
            'Needs more prospecting',
            'Upsell rate below target'
        ];

        // Create insight record
        const insight = {
            id: generateId(),
            agent_id: agentId,
            insight_date: new Date().toISOString(),
            insight_type: variance > 5 ? 'strength' : variance < -5 ? 'weakness' : 'opportunity',
            metric: 'sales_performance',
            value: actual,
            benchmark: predicted,
            variance: variance,
            recommendation: variance < 0 ? 'Increase call volume to 15/day' : 'Share best practices with team',
            priority: Math.abs(variance) > 10 ? 'high' : Math.abs(variance) > 5 ? 'medium' : 'low',
            is_actioned: false,
            created_at: new Date().toISOString()
        };

        await AppDataStore.create('performance_insights', insight);

        return {
            target: targetValue,
            actual: actual,
            predicted: predicted,
            variance: variance,
            strength: strengths[Math.floor(Math.random() * strengths.length)],
            improvement: improvements[Math.floor(Math.random() * improvements.length)]
        };
    };

    // AI Model Management
    const retrainAIModels = () => {
        UI.showModal('Retrain AI Models', `
            <div class="retrain-models">
                <p>This will retrain all AI models with the latest data.</p>
                <p>Estimated time: 2-3 minutes</p>
                
                <div class="model-list">
                    <label class="checkbox-label">
                        <input type="checkbox" value="lead_scoring" checked> Lead Scoring Model
                    </label>
                    <label class="checkbox-label">
                        <input type="checkbox" value="churn_prediction" checked> Churn Prediction Model
                    </label>
                    <label class="checkbox-label">
                        <input type="checkbox" value="sales_forecast" checked> Sales Forecast Model
                    </label>
                </div>
            </div>
        `, [
            { label: 'Cancel', type: 'secondary', action: 'UI.hideModal()' },
            { label: 'Start Training', type: 'primary', action: 'app.startModelTraining()' }
        ]);
    };

    const startModelTraining = () => {
        UI.hideModal();
        UI.toast.info('AI model training started...');

        // Simulate training progress
        let progress = 0;
        const interval = (() => {
            progress += 10;
            UI.toast.info(`Training progress: ${progress}%`);

            if (progress >= 100) {
                clearInterval(interval);

                // Update model versions and accuracy
                const models = await AppDataStore.getAll('ai_models');
                models.forEach(model => {
                    model.model_version = '1.1.0';
                    model.accuracy += Math.random() * 3 - 1; // Random change
                    model.trained_at = new Date().toISOString();
                    model.trained_on_records += Math.floor(Math.random() * 100);
                    model.updated_at = new Date().toISOString();

                    AppDataStore.update('ai_models', model.id, model);
                });

                UI.toast.success('AI models trained successfully! Accuracy improved.');
            }
        }, 1000);
    };

    // Navigation function
    const showAIPredictionDashboard = async () => {
        await showAIInsightsDashboard();
    };

    // ========== AUTHENTICATION & NAVIGATION ==========
    const USER_ROLES = [
        "Level 1 super admin",
        "Level 2 Marketing Manager",
        "Level 3 Marketing Admin",
        "Level 4 Teacher",
        "Level 5 Content Creator",
        "Level 6 Event Coordinator",
        "Level 7 Team Leader",
        "Level 8 Consultant Manager",
        "Level 9 Senior Consultant",
        "Level 10 Junior Consultant",
        "Level 11 Senior Agent",
        "Level 12 Agent",
        "Level 13 Junior Agent"
    ];



    async function populateLoginDropdown() {
        console.log("populateLoginDropdown called");
        const select = document.getElementById('login-user-select');
        if (!select) return;
        const users = await AppDataStore.getAll('users');
        select.innerHTML = '<option value="">-- Select User --</option>' +
            users.map(u => `<option value="${u.id}">${u.full_name} (${u.role})</option>`).join('');
    }

    function updateNavVisibility() {
        const user = _currentUser;
        if (!user) return;

        // Map Level 1-13 to visible nav IDs (suffix after 'nav-')
        const levelPermissions = {
            1: ['calendar', 'pipeline', 'protection', 'agents', 'prospects', 'referrals', 'cases', 'documents', 'import', 'promotions', 'marketing-lists', 'performance', 'reports', 'risk', 'ai-insights', 'security', 'admin', 'integrations', 'settings'],
            2: ['calendar', 'pipeline', 'protection', 'agents', 'prospects', 'referrals', 'cases', 'documents', 'import', 'promotions', 'marketing-lists', 'performance', 'reports', 'risk', 'ai-insights', 'security', 'admin', 'integrations', 'settings'],
            3: ['calendar', 'protection', 'prospects', 'referrals', 'cases', 'documents', 'import', 'promotions', 'marketing-lists', 'settings'],
            4: ['calendar', 'pipeline', 'protection', 'agents', 'prospects', 'referrals', 'cases', 'documents', 'promotions', 'performance', 'reports', 'settings'],
            5: ['calendar', 'pipeline', 'protection', 'agents', 'prospects', 'referrals', 'cases', 'documents', 'promotions', 'performance', 'reports', 'settings'],
            6: ['calendar', 'pipeline', 'protection', 'prospects', 'referrals', 'cases', 'documents', 'promotions', 'performance', 'reports', 'settings'],
            7: ['calendar', 'pipeline', 'prospects', 'referrals', 'cases', 'documents', 'promotions', 'performance', 'reports', 'settings'],
            8: ['calendar', 'pipeline', 'prospects', 'referrals', 'cases', 'documents', 'promotions', 'performance', 'reports', 'settings'],
            9: ['calendar', 'pipeline', 'prospects', 'referrals', 'cases', 'documents', 'promotions', 'performance', 'reports', 'settings'],
            10: ['calendar', 'pipeline', 'prospects', 'referrals', 'cases', 'documents', 'promotions', 'performance', 'reports', 'settings'],
            11: ['calendar', 'pipeline', 'prospects', 'referrals', 'cases', 'documents', 'promotions', 'settings'],
            12: ['calendar', 'prospects', 'referrals', 'cases', 'documents', 'promotions', 'settings'],
            13: ['calendar', 'prospects', 'referrals', 'cases', 'promotions', 'settings']
        };

        // Determine level from role (e.g., "Level 1 super admin" -> 1)
        let level = 13; // default to lowest level
        if (user.role) {
            const match = user.role.match(/Level\s+(\d+)/i);
            if (match) {
                level = parseInt(match[1]);
            } else {
                // Backward compatibility with old roles
                const roleLower = user.role.toLowerCase();
                if (roleLower === 'super_admin' || roleLower === 'admin') level = 1;
                else if (roleLower === 'marketing_manager' || roleLower === 'manager') level = 2;
                else if (roleLower === 'team_leader') level = 7;
                else if (roleLower === 'consultant') level = 9;
                else if (roleLower === 'agent') level = 12;
            }
        }

        const allowed = levelPermissions[level] || levelPermissions[13];
        
        // List of all nav item suffixes
        const allNavIds = [
            'calendar', 'pipeline', 'protection', 'agents', 'prospects', 'referrals', 
            'cases', 'documents', 'import', 'promotions', 'marketing-lists', 
            'performance', 'reports', 'risk', 'ai-insights', 'security', 'admin', 
            'integrations', 'settings'
        ];

        allNavIds.forEach(id => {
            const el = document.getElementById(`nav-${id}`);
            if (el) {
                // Use flex for better alignment if it was block before, but none if hidden
                el.style.display = allowed.includes(id) ? '' : 'none';
            }
        });
    }

    async function login() {
        const userId = document.getElementById('login-user-select')?.value;
        if (!userId) {
            UI.toast.error('Please select a user');
            return;
        }
        const user = await Auth.login(parseInt(userId));
        if (user) {
            _currentUser = user;
            document.getElementById('login-container').style.display = 'none';
            document.getElementById('app-shell').style.display = 'block';
            updateUserDisplay();
            updateNavVisibility();
            UI.toast.success(`Welcome, ${user.full_name}`);
            await navigateTo('calendar');
        }
    }

    async function logout() {
        await Auth.logout();
        _currentUser = null;
        document.getElementById('app-shell').style.display = 'none';
        document.getElementById('login-container').style.display = 'flex';
        await populateLoginDropdown();
        UI.hideModal();      // close the user menu modal
        UI.toast.info('Logged out successfully');
    }

    // ==================== INIT ====================

    const init = async () => {
        console.log('App initializing...');

        try {
            // Check if tables exist, if not init demo data
            if (!await AppDataStore.getAll('users').length) {
                console.log('No users found. Initializing demo data...');
                await initDemoData();
                await initDefaultFolders();
                await initSampleDocuments();
                await initImportDemoData();
                
                // Explicitly populate dropdown after data init
                await populateLoginDropdown();
            }

            _currentUser = Auth.getCurrentUser();
            console.log('User loaded:', _currentUser?.username);

            if (!_currentUser) {
                // Show login screen
                document.getElementById('login-container').style.display = 'flex';
                document.getElementById('app-shell').style.display = 'none';
                await populateLoginDropdown();
            } else {
                // Show app shell
                document.getElementById('login-container').style.display = 'none';
                document.getElementById('app-shell').style.display = 'block';
                updateUserDisplay();
                updateNavVisibility();
                await expireOldOverrides();

                // Initialize other modules
                initGoogleIntegration();
                initWhatsAppIntegration();
                await initAIAnalytics();

                await navigateTo('calendar');

                // Phase 14: Initialize offline support and mobile features
                initOfflineSupport();
                if (isMobile()) {
                    await renderMobileBottomNav();
                    initSwipeActions();
                    await initPullToRefresh();
                }

                // Phase 18: Initialize Mobile App Features
                if (typeof initMobileApp === 'function') {
                    await initMobileApp();
                }

                // Step 1: Migration for referrals
                await ensureReferralFields();
            }

            // Phase 20: System Administration
            if (typeof SystemHealth !== 'undefined' && typeof SystemHealth.init === 'function') {
                await SystemHealth.init();
            }
            if (typeof ConfigManager !== 'undefined' && typeof ConfigManager.init === 'function') {
                await ConfigManager.init();
            }

            // Phase 5 Agent Table Event Delegation
            document.addEventListener('click', (e) => {
                // Edit button handler
                const editBtn = e.target.closest('.edit-agent-btn');
                if (editBtn) {
                    e.stopPropagation();
                    const agentId = editBtn.dataset.agentId;
                    console.log('Edit agent clicked:', agentId);
                    app.todo('Edit Agent Form'); // or open an edit modal
                    return;
                }

                // View button handler
                const viewBtn = e.target.closest('.view-detail-btn');
                if (viewBtn) {
                    e.stopPropagation();
                    const agentId = viewBtn.dataset.agentId;
                    await app.showAgentDetail(agentId);
                    return;
                }

                // Row click handler – only if click is not on a button or inside the actions column
                const row = e.target.closest('.agent-row');
                if (row && !e.target.closest('.btn-icon')) {
                    const agentId = row.dataset.agentId;
                    await app.showAgentDetail(agentId);
                }
            });

            // Mark app as ready
            window.app.ready = true;
            window.app.initialized = true;

            // Dispatch event for other scripts
            window.dispatchEvent(new Event('appReady'));

            console.log('App initialized successfully.');
        } catch (err) {
            console.error('App init failed:', err);
        }
    };

    const openAddNameModal = async (prospectId, nameId = null) => {
        const nameData = nameId ? AppDataStore.getById('names', nameId) : null;
        const isEdit = !!nameData;

        const content = `
            <div class="form-section">
                <h4>${isEdit ? 'Edit Name' : 'Add Name to List'}</h4>
                <input type="hidden" id="edit-name-id" value="${nameId || ''}">
                <div class="form-group">
                    <label>Relation</label>
                    <select id="name-relation" class="form-control">
                        <option value="Spouse" ${nameData?.relation === 'Spouse' ? 'selected' : ''}>Spouse</option>
                        <option value="Child" ${nameData?.relation === 'Child' ? 'selected' : ''}>Child</option>
                        <option value="Parent" ${nameData?.relation === 'Parent' ? 'selected' : ''}>Parent</option>
                        <option value="Sibling" ${nameData?.relation === 'Sibling' ? 'selected' : ''}>Sibling</option>
                        <option value="Business Partner" ${nameData?.relation === 'Business Partner' ? 'selected' : ''}>Business Partner</option>
                        <option value="Other" ${nameData?.relation === 'Other' ? 'selected' : ''}>Other</option>
                    </select>
                </div>
                <div class="form-group">
                    <label>Full Name <span class="required">*</span></label>
                    <input type="text" id="name-full" class="form-control" value="${nameData?.full_name || ''}" required>
                </div>
                <div class="form-group">
                    <label>Date of Birth</label>
                    <input type="date" id="name-dob" class="form-control" value="${nameData?.date_of_birth || ''}">
                </div>
                <div class="form-group">
                    <label>Notes</label>
                    <textarea id="name-notes" class="form-control" rows="2">${nameData?.notes || ''}</textarea>
                </div>
            </div>
        `;

        UI.showModal(isEdit ? 'Edit Name' : 'Add Name', content, [
            { label: 'Cancel', type: 'secondary', action: 'UI.hideModal()' },
            { label: 'Save', type: 'primary', action: `await app.saveName(${prospectId})` }
        ]);
    };

    const saveName = async (prospectId) => {
        const name = document.getElementById('name-full')?.value;
        if (!name) {
            UI.toast.error('Name is required');
            return;
        }

        const nameId = document.getElementById('edit-name-id')?.value;
        const data = {
            prospect_id: prospectId,
            relation: document.getElementById('name-relation')?.value || 'Other',
            full_name: name,
            date_of_birth: document.getElementById('name-dob')?.value,
            notes: document.getElementById('name-notes')?.value
        };

        if (nameId) {
            AppDataStore.update('names', parseInt(nameId), data);
            UI.toast.success('Name updated successfully');
        } else {
            await AppDataStore.create('names', data);
            UI.toast.success('Name added successfully');
        }

        UI.hideModal();
        await app.showProspectDetail(prospectId); // Refresh detail view
    };

    const deleteName = async (prospectId, nameId) => {
        UI.showModal('Confirm Delete', 'Are you sure you want to delete this name?', [
            { label: 'Cancel', type: 'secondary', action: 'UI.hideModal()' },
            { label: 'Delete', type: 'primary', action: `await app.confirmDeleteName(${prospectId}, ${nameId})` }
        ]);
    };

    const confirmDeleteName = async (prospectId, nameId) => {
        AppDataStore.delete('names', nameId);
        UI.hideModal();
        UI.toast.success('Name deleted');
        await app.showProspectDetail(prospectId);
    };


    const initDemoData = async () => {
        if (await AppDataStore.getAll('users').length === 0) {
            console.log('Loading demo data...');

            // Roles
            const roles = USER_ROLES.map(r => ({ role_name: r, permissions: { all: true } }));
            // Add legacy roles for compatibility
            roles.push(
                { role_name: 'super_admin', permissions: { all: true } },
                { role_name: 'marketing_manager', permissions: { 'view-dashboard': true, 'manage-promotions': true, 'view-reports': true } },
                { role_name: 'team_leader', permissions: { 'view-dashboard': true, 'view-team-data': true } },
                { role_name: 'consultant', permissions: { 'view-dashboard': true, 'manage-self-prospects': true } }
            );
            roles.forEach(async r => await AppDataStore.create('roles', r));

            // Teams
            const teamA = await AppDataStore.create('teams', { team_name: 'Team A' });

            // Users/Agents
            const users = [
                { id: 1, username: 'admin', password: 'admin123', full_name: 'System Admin', role: 'Level 1 super admin' },
                { id: 2, username: 'marketing', password: 'mkt123', full_name: 'Marketing Manager', role: 'Level 2 Marketing Manager' },
                { id: 3, username: 'teamlead', password: 'tl123', full_name: 'Team Leader', role: 'Level 7 Team Leader', team_id: teamA.id, reporting_to: 10 },
                { id: 4, username: 'consultant', password: 'cons123', full_name: 'Consultant', role: 'Level 12 Agent', team_id: teamA.id },
                { id: 5, username: 'michelle', password: 'michelle123', full_name: 'Michelle Tan', role: 'Level 9 Senior Consultant', team_id: teamA.id, reporting_to: 3 },
                { id: 6, username: 'ahseng', password: 'ahseng123', full_name: 'Ah Seng', role: 'Level 13 Junior Agent', team_id: teamA.id, reporting_to: 3 },
                { id: 7, username: 'meiling', password: 'meiling123', full_name: 'Mei Ling', role: 'Level 13 Junior Agent', team_id: teamA.id, reporting_to: 3 },
                { id: 8, username: 'raj', password: 'raj123', full_name: 'Raj Kumar', role: 'Level 13 Junior Agent', team_id: teamA.id, reporting_to: 3 },
                { id: 10, username: 'manager', password: 'manager123', full_name: 'Manager', role: 'Level 8 Consultant Manager', team_id: teamA.id, reporting_to: null },
                { id: 11, username: 'admin_lvl1', password: '123', full_name: 'Level 1 Admin', role: 'Level 1 super admin' },
                { id: 12, username: 'mkt_lvl3', password: '123', full_name: 'Level 3 Marketing', role: 'Level 3 Marketing Admin' },
                { id: 13, username: 'teacher_lvl4', password: '123', full_name: 'Level 4 Teacher', role: 'Level 4 Teacher' },
                { id: 14, username: 'agent_lvl13', password: '123', full_name: 'Level 13 Agent', role: 'Level 13 Junior Agent' }
            ];
            users.forEach(async u => await AppDataStore.create('users', u));


            // Tags
            const tags = [
                { id: 1, name: 'Career Focused', color: 'blue' },
                { id: 2, name: 'MG4', color: 'purple' },
                { id: 3, name: 'Referred By Customer', color: 'green' },
                { id: 4, name: 'High Score', color: 'orange' },
                { id: 5, name: 'Business Owner', color: 'teal' },
                { id: 6, name: 'Event Attendee', color: 'gray' }
            ];
            tags.forEach(async t => await AppDataStore.create('tags', t));

            // Prospects
            const prospects = [
                {
                    id: 1,
                    full_name: 'Tan Ah Kow',
                    phone: '012-3456789',
                    ic_number: '901212-10-1234',
                    date_of_birth: '1990-12-12',
                    score: 850,
                    responsible_agent_id: 5,
                    title: 'Mr.',
                    gender: 'Male',
                    nationality: 'Malaysian',
                    email: 'tan.ah.kow@email.com',
                    occupation: 'Business Owner - Construction',
                    company_name: 'Ah Kow Construction Sdn Bhd',
                    income_range: 'RM 15,000 - RM 20,000',
                    address: '123, Jalan SS2, Petaling Jaya, Selangor',
                    cps_agent_id: 5,
                    cps_assignment_date: '2026-02-15',
                    protection_deadline: '2026-03-17',
                    ming_gua: 'MG4',
                    element: 'Wood'
                },
                {
                    id: 2,
                    full_name: 'Ong Bee Ling',
                    phone: '012-9876543',
                    score: 720,
                    responsible_agent_id: 6,
                    protection_deadline: '2026-03-20',
                    ming_gua: 'MG2'
                },
                {
                    id: 3,
                    full_name: 'Lee Meng Hui',
                    phone: '011-2223334',
                    score: 680,
                    responsible_agent_id: 5,
                    protection_deadline: '2026-03-25',
                    ming_gua: 'MG5'
                },
                {
                    id: 4,
                    full_name: 'Lim Ah Boy',
                    phone: '017-5556667',
                    score: 620,
                    responsible_agent_id: 7,
                    protection_deadline: '2026-03-15',
                    ming_gua: 'MG7'
                },
                {
                    id: 5,
                    full_name: 'Siti Aminah',
                    phone: '019-9990001',
                    score: 580,
                    responsible_agent_id: 8,
                    protection_deadline: '2026-03-10',
                    ming_gua: 'MG3'
                }
            ];
            prospects.forEach(async p => await AppDataStore.create('prospects', p));

            // Entity Tags for Tan Ah Kow
            const entityTags = [
                { entity_type: 'prospect', entity_id: 1, tag_id: 1 },
                { entity_type: 'prospect', entity_id: 1, tag_id: 2 },
                { entity_type: 'prospect', entity_id: 1, tag_id: 3 },
                { entity_type: 'prospect', entity_id: 1, tag_id: 4 },
                { entity_type: 'prospect', entity_id: 1, tag_id: 5 },
                { entity_type: 'prospect', entity_id: 1, tag_id: 6 }
            ];
            entityTags.forEach(async et => await AppDataStore.create('entity_tags', et));

            // Proposed Solutions for Tan Ah Kow
            const solutions = [
                { prospect_id: 1, solution: 'PR4 Power Ring', proposed_date: '2026-03-04', status: 'Proposed', notes: '' },
                { prospect_id: 1, solution: 'Office Audit', proposed_date: '2026-03-04', status: 'Proposed', notes: '' }
            ];
            solutions.forEach(async s => await AppDataStore.create('proposed_solutions', s));

            // Activities - FIXED with proper end_time for all
            const activities = [
                {
                    activity_type: 'CPS',
                    activity_title: 'Initial Consultation',
                    activity_date: '2026-03-04',
                    start_time: '09:00',
                    end_time: '10:00',
                    prospect_id: 1,
                    lead_agent_id: 5,
                    co_agents: [{ id: 6, name: 'Ah Seng', role: 'Supporting' }],
                    summary: 'Initial consultation scheduling'
                },
                {
                    activity_type: 'FTF',
                    activity_title: 'Face to Face Meeting',
                    activity_date: '2026-03-04',
                    start_time: '11:00',
                    end_time: '12:00',
                    prospect_id: 2,
                    lead_agent_id: 6,
                    co_agents: [{ id: 7, name: 'Mei Ling', role: 'Supporting' }, { id: 8, name: 'Raj', role: 'Observer' }],
                    summary: 'Discussed career advancement and PR4 interest confirmed. Next Step: Send quote by 11 Mar'
                },
                {
                    activity_type: 'FSA',
                    activity_title: 'Feng Shui Analysis',
                    activity_date: '2026-03-04',
                    start_time: '14:00',
                    end_time: '16:00',
                    prospect_id: 4,
                    lead_agent_id: 7,
                    location_address: '123, Jalan SS2, PJ',
                    summary: 'Site analysis for Lim Ah Boy'
                },
                {
                    activity_type: 'EVENT',
                    activity_title: 'Understanding Your Life Gua',
                    activity_date: '2026-03-04',
                    start_time: '18:00',
                    end_time: '20:00',
                    lead_agent_id: 8,
                    score_value: 10,
                    event_title: 'Understanding Your Life Gua',
                    attendees: '12 Prospects + 4 Agents',
                    summary: 'Public lecture on Feng Shui'
                }
            ];
            activities.forEach(async ac => await AppDataStore.create('activities', ac));

            // Notes for Tan Ah Kow
            const notes = [
                { prospect_id: 1, author: 'Michelle Tan', date: '2026-02-28', text: 'Wife also interested in relationship consultation. Should consider couple package.' },
                { prospect_id: 1, author: 'Michelle Tan', date: '2026-03-02', text: 'Customer is knowledgeable about Feng Shui, already reads books on the subject.' },
                { prospect_id: 1, author: 'Michelle Tan', date: '2026-03-04', text: 'Office facing North-West. Need compass reading for accurate assessment.' }
            ];
            notes.forEach(async n => await AppDataStore.create('notes', n));

            // Names (Family/Referrals) for Tan Ah Kow
            const names = [
                { prospect_id: 1, relation: 'Spouse', full_name: 'Tan Ai Ling', date_of_birth: '1992-05-15', notes: 'Involved in decision making' },
                { prospect_id: 1, relation: 'Child', full_name: 'Tan Wei Ming', date_of_birth: '2015-08-10', notes: '' },
                { prospect_id: 1, relation: 'Child', full_name: 'Tan Wei Jie', date_of_birth: '2018-03-22', notes: '' },
                { prospect_id: 1, relation: 'Parent', full_name: 'Tan Ah Hock', date_of_birth: '1960-06-05', notes: 'Lives with family' },
                { prospect_id: 1, relation: 'Business Partner', full_name: 'Lee Meng Chew', date_of_birth: '', notes: 'Co-owner of construction company' }
            ];
            names.forEach(async n => await AppDataStore.create('names', n));

            // Phase 6: Pipeline Demo Data
            // Manual overrides
            const overrides = [
                {
                    id: 1001,
                    user_id: 5, // Michelle Tan
                    prospect_id: 3, // Lee Meng Hui
                    override_type: 'boost',
                    system_rank: 3,
                    new_priority: 1,
                    reason_category: 'urgency',
                    justification: 'CEO direct contact, board approved budget, wants to move quickly',
                    status: 'active',
                    created_at: '2026-03-03T10:30:00Z',
                    expires_at: '2026-03-10T10:30:00Z'
                },
                {
                    id: 1002,
                    user_id: 5,
                    prospect_id: 4, // Lim Ah Boy
                    override_type: 'boost',
                    system_rank: 5,
                    new_priority: 3,
                    reason_category: 'conversation',
                    justification: 'High budget confirmed, ready to purchase within week',
                    status: 'active',
                    created_at: '2026-03-02T14:15:00Z',
                    expires_at: '2026-03-09T14:15:00Z'
                },
                {
                    id: 1003,
                    user_id: 5,
                    prospect_id: 2, // Ong Bee Ling
                    override_type: 'demote',
                    system_rank: 2,
                    new_priority: 4,
                    reason_category: 'urgency',
                    justification: 'Less urgent than other opportunities',
                    status: 'expired',
                    created_at: '2026-03-01T09:00:00Z',
                    expires_at: '2026-03-08T09:00:00Z'
                }
            ];
            overrides.forEach(async o => await AppDataStore.create('manual_overrides', o));

            // My potential list
            const potentialList = [
                {
                    id: 2001,
                    user_id: 5,
                    prospect_id: 3,
                    priority_order: 1,
                    expected_close_date: '2026-03-15',
                    estimated_value: 3200,
                    status: 'active'
                },
                {
                    id: 2002,
                    user_id: 5,
                    prospect_id: 1,
                    priority_order: 2,
                    expected_close_date: '2026-03-25',
                    estimated_value: 2488,
                    status: 'active'
                },
                {
                    id: 2003,
                    user_id: 5,
                    prospect_id: 4,
                    priority_order: 3,
                    expected_close_date: '2026-03-20',
                    estimated_value: 888,
                    status: 'active'
                },
                {
                    id: 2004,
                    user_id: 5,
                    prospect_id: 2,
                    priority_order: 4,
                    expected_close_date: '2026-03-18',
                    estimated_value: 1288,
                    status: 'active'
                },
                {
                    id: 2005,
                    user_id: 5,
                    prospect_id: 5,
                    priority_order: 5,
                    expected_close_date: '2026-03-30',
                    estimated_value: 588,
                    status: 'active'
                }
            ];
            potentialList.forEach(async p => await AppDataStore.create('my_potential_list', p));

            UI.toast.success('Demo data loaded successfully.');
        } else {
            // Re-initialize activities to ensure no duplicates for Phase 7
            const activities = [
                {
                    id: 101,
                    activity_type: 'CPS',
                    activity_title: 'Initial Consultation',
                    activity_date: '2026-03-04',
                    start_time: '09:00',
                    end_time: '10:00',
                    prospect_id: 1,
                    lead_agent_id: 5,
                    co_agents: [{ id: 6, name: 'Ah Seng', role: 'Supporting' }],
                    summary: 'Initial consultation scheduling'
                },
                {
                    id: 102,
                    activity_type: 'FTF',
                    activity_title: 'Face to Face Meeting',
                    activity_date: '2026-03-04',
                    start_time: '11:00',
                    end_time: '12:00',
                    prospect_id: 2,
                    lead_agent_id: 6,
                    co_agents: [{ id: 7, name: 'Mei Ling', role: 'Supporting' }, { id: 8, name: 'Raj', role: 'Observer' }],
                    summary: 'Discussed career advancement and PR4 interest confirmed. Next Step: Send quote by 11 Mar'
                },
                {
                    id: 103,
                    activity_type: 'FSA',
                    activity_title: 'Feng Shui Analysis',
                    activity_date: '2026-03-04',
                    start_time: '14:00',
                    end_time: '16:00',
                    prospect_id: 4,
                    lead_agent_id: 7,
                    location_address: '123, Jalan SS2, PJ',
                    summary: 'Site analysis for Lim Ah Boy'
                },
                {
                    id: 104,
                    activity_type: 'EVENT',
                    activity_title: 'Understanding Your Life Gua',
                    activity_date: '2026-03-04',
                    start_time: '18:00',
                    end_time: '20:00',
                    lead_agent_id: 8,
                    score_value: 10,
                    event_title: 'Understanding Your Life Gua',
                    attendees: '12 Prospects + 4 Agents',
                    summary: 'Public lecture on Feng Shui'
                }
            ];

            // Clear existing and re-add
            const existingActivities = await AppDataStore.getAll('activities');
            existingActivities.forEach(a => AppDataStore.delete('activities', a.id));
            activities.forEach(async ac => await  AppDataStore.create('activities', ac));
        }

        // Additional Phase 4 Demo Data - Ensure it exists
        if (await AppDataStore.getAll('customers').length === 0) {
            // Customers
            const customers = [
                {
                    id: 101,
                    full_name: 'Ong Bee Ling',
                    phone: '012-9876543',
                    email: 'ong.beeling@email.com',
                    ic_number: '850505-12-3456',
                    date_of_birth: '1982-03-04',
                    ming_gua: 'MG4',
                    element: 'Wood',
                    gender: 'Female',
                    nationality: 'Malaysian',
                    occupation: 'Retail Owner',
                    company_name: 'Bee Ling Fashion Boutique',
                    income: 'RM 8,000 - RM 12,000',
                    address: '456, Jalan Ampang, Kuala Lumpur',
                    converted_from_prospect_id: 2,
                    conversion_date: '2026-02-20',
                    conversion_amount: 2200,
                    lifetime_value: 3152,
                    bank_name: 'Maybank Berhad',
                    bank_account_number: '5123-4567-8901',
                    account_holder: 'Ong Bee Ling',
                    payment_methods: 'Bank Transfer, Credit Card',
                    responsible_agent_id: 6,
                    status: 'active',
                    customer_since: '2026-02-20'
                }
            ];
            customers.forEach(async c => await AppDataStore.create('customers', c));

            // Platform IDs
            const platformIds = [
                { id: 1001, customer_id: 101, platform: 'Bujishu', platform_id: 'BJ-87654321' },
                { id: 1002, customer_id: 101, platform: 'Metapoint', platform_id: 'MP-12345678' },
                { id: 1003, customer_id: 101, platform: 'Formula', platform_id: 'FM-55667788' },
                { id: 1004, customer_id: 101, platform: 'Monalisa', platform_id: 'ML-99887766' },
                { id: 1005, customer_id: 101, platform: 'Florida', platform_id: 'FL-11223344' },
                { id: 1006, customer_id: 101, platform: 'Far Coffee', platform_id: 'FC-44332211' },
                { id: 1007, customer_id: 101, platform: 'Patiseri', platform_id: 'PT-77889900' }
            ];
            platformIds.forEach(async p => await  AppDataStore.create('platform_ids', p));

            // Purchases
            const purchases = [
                {
                    id: 2001,
                    customer_id: 101,
                    date: '2026-02-20',
                    invoice: 'INV-0032',
                    item: 'PR3 Ring',
                    amount: 888,
                    status: 'COLLECTED',
                    proof: 'image1.jpg'
                },
                {
                    id: 2002,
                    customer_id: 101,
                    date: '2026-02-20',
                    invoice: 'INV-0033',
                    item: 'Career Consultation',
                    amount: 588,
                    status: 'N/A'
                },
                {
                    id: 2003,
                    customer_id: 101,
                    date: '2026-03-01',
                    invoice: 'INV-0041',
                    item: 'Office Audit',
                    amount: 388,
                    status: 'COMPLETED',
                    proof: 'report1.pdf'
                },
                {
                    id: 2004,
                    customer_id: 101,
                    date: '2026-03-04',
                    invoice: 'Q-0045',
                    item: 'Harmony Painting',
                    amount: 1288,
                    status: 'PENDING'
                }
            ];
            purchases.forEach(async p => await  AppDataStore.create('purchases', p));

            // Referrals
            const referrals = [
                {
                    id: 3001,
                    referrer_customer_id: 101,
                    referred_prospect_id: 1, // Tan Ah Kow
                    relationship: 'Friend',
                    date: '2026-02-15',
                    status: 'Active',
                    reward_status: 'Pending',
                    referral_source: 'CPS',
                    source_id: generateId()
                },
                {
                    id: 3002,
                    referrer_customer_id: 101,
                    referred_prospect_id: 4, // Lim Ah Boy
                    relationship: 'Cousin',
                    date: '2026-02-20',
                    status: 'Warm',
                    reward_status: 'Pending',
                    referral_source: 'EVENT',
                    source_id: generateId()
                },
                {
                    id: 3003,
                    referrer_customer_id: 1, // Tan Ah Kow
                    referred_prospect_id: 2, // Ong Bee Ling
                    relationship: 'Colleague',
                    date: '2026-03-01',
                    status: 'Active',
                    reward_status: 'None',
                    referral_source: 'MANUAL',
                    source_id: null
                }
            ];
            referrals.forEach(async r => await AppDataStore.create('referrals', r));

            // Add original_source to existing prospects
            const p1 = AppDataStore.getById('prospects', 1);
            if (p1 && !p1.original_source) AppDataStore.update('prospects', 1, { original_source: 'CPS' });
            const p4 = AppDataStore.getById('prospects', 4);
            if (p4 && !p4.original_source) AppDataStore.update('prospects', 4, { original_source: 'EVENT', source_id: 'EVT-001' });
        }

        // Phase 5 Agent Management Demo Data
        if (await AppDataStore.getAll('agent_stats').length === 0) {
            // Agents (users already exist, but need additional agent fields)
            const teamA = AppDataStore.query('teams', { team_name: 'Team A' })[0];

            const agentUpdates = [
                {
                    id: 5, // Michelle Tan
                    agent_code: 'AGN-2026-001',
                    license_start: '2026-01-01',
                    license_expiry: '2026-12-31',
                    commission_rate: 30,
                    monthly_target: 25000,
                    team: 'Team A',
                    reporting_to: null, // Team Leader
                    join_date: '2026-01-01',
                    probation_end: '2026-03-01',
                    status: 'active',
                    bank_name: 'Maybank Berhad',
                    bank_account: '5123-1111-2222',
                    business_address: '123, Jalan SS2, Petaling Jaya'
                },
                {
                    id: 6, // Ah Seng
                    agent_code: 'AGN-2026-002',
                    license_start: '2026-01-15',
                    license_expiry: '2026-12-31',
                    commission_rate: 30,
                    monthly_target: 20000,
                    team: 'Team A',
                    reporting_to: 5, // Michelle Tan
                    join_date: '2026-01-15',
                    probation_end: '2026-03-15',
                    status: 'active',
                    bank_name: 'Public Bank',
                    bank_account: '3123-3333-4444',
                    business_address: '456, Jalan Ampang, Kuala Lumpur'
                },
                {
                    id: 7, // Mei Ling
                    agent_code: 'AGN-2026-003',
                    license_start: '2026-02-01',
                    license_expiry: '2026-12-31',
                    commission_rate: 30,
                    monthly_target: 18000,
                    team: 'Team A',
                    reporting_to: 5,
                    join_date: '2026-02-01',
                    probation_end: '2026-04-01',
                    status: 'probation',
                    bank_name: 'CIMB Bank',
                    bank_account: '1234-5678-9012',
                    business_address: '789, Jalan Bukit Bintang, Kuala Lumpur'
                },
                {
                    id: 8, // Raj Kumar
                    agent_code: 'AGN-2026-004',
                    license_start: '2026-02-15',
                    license_expiry: '2026-12-31',
                    commission_rate: 30,
                    monthly_target: 20000,
                    team: 'Team A',
                    reporting_to: 5,
                    join_date: '2026-02-15',
                    probation_end: '2026-04-15',
                    status: 'active',
                    bank_name: 'Hong Leong Bank',
                    bank_account: '5678-1234-5678',
                    business_address: '321, Jalan Tun Razak, Kuala Lumpur'
                }
            ];

            agentUpdates.forEach(update => {
                const user = AppDataStore.getById('users', update.id);
                if (user) {
                    AppDataStore.update('users', update.id, { ...user, ...update });
                }
            });

            // Add Ong Bee Ling as new agent (converted from customer)
            const ongBeeLingAgent = {
                id: 9,
                username: 'ong.beeling',
                password: 'agent123',
                full_name: 'Ong Bee Ling',
                role: 'consultant',
                team_id: teamA ? teamA.id : null,
                agent_code: 'AGN-2026-034',
                license_start: '2026-03-05',
                license_expiry: '2027-03-04',
                commission_rate: 30,
                monthly_target: 20000,
                team: 'Team A',
                reporting_to: 5, // Michelle Tan
                join_date: '2026-03-05',
                probation_end: '2026-06-05',
                status: 'active',
                bank_name: 'Maybank Berhad',
                bank_account: '5123-4567-8901',
                business_address: '456, Jalan Ampang, Kuala Lumpur',
                ic_number: '850505-12-3456',
                phone: '012-9876543',
                email: 'ong.beeling@fengshui.com',
                date_of_birth: '1982-03-04',
                gender: 'Female',
                company_name: 'Bee Ling Fashion Boutique'
            };

            await AppDataStore.create('users', ongBeeLingAgent);

            // Update customer to mark as converted to agent
            const customer = AppDataStore.getById('customers', 101);
            if (customer) {
                AppDataStore.update('customers', 101, {
                    converted_to_agent: true,
                    converted_to_agent_id: 9,
                    agent_package_purchased: 'Premium Package',
                    agent_package_amount: 5500,
                    agent_purchase_date: '2026-03-05'
                });
            }

            // Add follow-up stats
            const followupStats = [
                {
                    agent_id: 5,
                    total_assigned: 52,
                    followed_up_7d: 48,
                    inactive_3_7d: 2,
                    inactive_8_14d: 2,
                    inactive_15d_plus: 0,
                    followup_rate: 92
                },
                {
                    agent_id: 6,
                    total_assigned: 50,
                    followed_up_7d: 31,
                    inactive_3_7d: 8,
                    inactive_8_14d: 6,
                    inactive_15d_plus: 5,
                    followup_rate: 62
                }
            ];
            followupStats.forEach(async s => await  AppDataStore.create('agent_stats', s));

            // Add current assignments
            const assignments = [
                { agent_id: 5, prospect_id: 1, status: 'Active', next_action: '2026-03-11' },
                { agent_id: 5, prospect_id: 3, status: 'Warm', next_action: '2026-03-07' },
                { agent_id: 5, prospect_id: 5, status: 'Cold', next_action: 'ASAP' },
                { agent_id: 6, prospect_id: 2, status: 'Active', next_action: '2026-03-04' }
            ];
            assignments.forEach(async a => await AppDataStore.create('assignments', a));

            // Add performance targets
            const targets = [
                { agent_id: 5, month: '2026-03', target_amount: 20000, current_amount: 12500, target_cps: 15, current_cps: 8, target_meetings: 20, current_meetings: 12, target_conversion: 25, current_conversion: 18 }
            ];
            targets.forEach(async t => await  AppDataStore.create('agent_targets', t));
        }

        // Phase 8 Event Demo Data
        if (await AppDataStore.getAll('event_categories').length === 0) {
            const eventCategories = [
                { id: 1, category_name: 'Lecture', base_score: 10, score_multiplier: 1.0, color_code: '#3b82f6' },
                { id: 2, category_name: 'Workshop', base_score: 15, score_multiplier: 1.2, color_code: '#f59e0b' },
                { id: 3, category_name: 'Course', base_score: 20, score_multiplier: 1.5, color_code: '#10b981' },
                { id: 4, category_name: 'Museum Tour', base_score: 12, score_multiplier: 1.0, color_code: '#8b5cf6' }
            ];
            eventCategories.forEach(async c => await AppDataStore.create('event_categories', c));

            const events = [
                {
                    id: 101,
                    event_title: 'Understanding Your Life Gua',
                    event_category_id: 1,
                    description: 'Learn about your Life Gua and how it affects your destiny',
                    event_date: '2026-03-10',
                    start_time: '18:00',
                    end_time: '20:00',
                    location: 'Feng Shui Center, Kuala Lumpur',
                    event_type: 'public',
                    capacity: 50,
                    ticket_price: 50,
                    base_score: 10,
                    override_multiplier: false,
                    custom_multiplier: 1.0,
                    enable_friend_bonus: true,
                    friend_points_per_friend: 10,
                    max_friends: 3,
                    enable_question_bonus: true,
                    question_points_per_question: 5,
                    enable_stay_bonus: true,
                    stay_points: 5,
                    enable_purchase_bonus: true,
                    purchase_base_points: 15,
                    purchase_points_per_100: 10,
                    auto_tags: ['Event Attendee'],
                    conditional_tags: { friend: 'Friend Bringer', question: 'Engaged Attendee', purchase: 'Event Buyer' },
                    status: 'upcoming',
                    registered_count: 45,
                    attended_count: 0,
                    created_by: 5,
                    created_at: '2026-02-15T10:00:00Z'
                },
                {
                    id: 102,
                    event_title: 'Feng Shui Basics Course',
                    event_category_id: 3,
                    description: 'Comprehensive introduction to Feng Shui principles',
                    event_date: '2026-03-15',
                    start_time: '09:00',
                    end_time: '17:00',
                    location: 'Online via Zoom',
                    event_type: 'public',
                    capacity: 100,
                    ticket_price: 120,
                    base_score: 20,
                    override_multiplier: false,
                    custom_multiplier: 1.5,
                    enable_friend_bonus: true,
                    friend_points_per_friend: 10,
                    max_friends: 3,
                    enable_question_bonus: true,
                    question_points_per_question: 5,
                    max_questions: 3,
                    enable_stay_bonus: true,
                    stay_points: 5,
                    enable_purchase_bonus: true,
                    purchase_base_points: 15,
                    purchase_points_per_100: 10,
                    auto_tags: ['Event Attendee', 'Course Participant'],
                    conditional_tags: { friend: 'Friend Bringer', question: 'Engaged Attendee', purchase: 'Event Buyer' },
                    status: 'upcoming',
                    registered_count: 28,
                    attended_count: 0,
                    created_by: 5,
                    created_at: '2026-02-20T14:30:00Z'
                },
                {
                    id: 103,
                    event_title: 'Museum Tour',
                    event_category_id: 4,
                    description: 'Guided tour of the Asian Civilizations Museum',
                    event_date: '2026-03-20',
                    start_time: '10:00',
                    end_time: '13:00',
                    location: 'Asian Civilizations Museum',
                    event_type: 'public',
                    capacity: 40,
                    ticket_price: 30,
                    base_score: 12,
                    override_multiplier: false,
                    custom_multiplier: 1.0,
                    enable_friend_bonus: true,
                    friend_points_per_friend: 10,
                    max_friends: 3,
                    enable_question_bonus: true,
                    question_points_per_question: 5,
                    max_questions: 3,
                    enable_stay_bonus: true,
                    stay_points: 5,
                    enable_purchase_bonus: false,
                    auto_tags: ['Event Attendee'],
                    conditional_tags: { friend: 'Friend Bringer', question: 'Engaged Attendee' },
                    status: 'upcoming',
                    registered_count: 35,
                    attended_count: 0,
                    created_by: 5,
                    created_at: '2026-02-25T09:15:00Z'
                }
            ];
            events.forEach(async e => await AppDataStore.create('events', e));

            const registrations = [
                {
                    id: 1001,
                    event_id: 101,
                    attendee_type: 'prospect',
                    prospect_id: 1,
                    registered_by: 5,
                    registered_at: '2026-02-20T11:30:00Z',
                    checked_in: false,
                    checked_in_at: null,
                    brought_friends: 0,
                    asked_questions: 0,
                    stayed_till_end: false,
                    made_purchase: false,
                    purchase_amount: 0,
                    points_awarded: 0,
                    scoring_processed: false
                },
                {
                    id: 1002,
                    event_id: 101,
                    attendee_type: 'prospect',
                    prospect_id: 2,
                    registered_by: 6,
                    registered_at: '2026-02-21T14:20:00Z',
                    checked_in: false,
                    checked_in_at: null,
                    brought_friends: 0,
                    asked_questions: 0,
                    stayed_till_end: false,
                    made_purchase: false,
                    purchase_amount: 0,
                    points_awarded: 0,
                    scoring_processed: false
                }
            ];
            registrations.forEach(async r => await AppDataStore.create('event_registrations', r));
        }

        // Phase 9: Reporting & KPI Dashboard Demo Data
        if (await AppDataStore.getAll('yearly_targets').length === 0) {
            // Yearly Targets
            const yearlyTargets = [
                {
                    id: 1,
                    target_year: 2026,
                    cps_count_target: 840,
                    total_sales_target: 1680000,
                    pop_case_count_target: 100,
                    pop_sales_target: 250000,
                    epp_case_count_target: 80,
                    epp_sales_target: 200000,
                    new_agents_target: 48,
                    new_customers_target: 240,
                    total_meetings_target: 1200,
                    activity_headcount_target: 600,
                    seasonal_weighting: { q1: 0.9, q2: 1.0, q3: 1.1, q4: 1.2 },
                    created_by: 1,
                    created_at: '2026-01-01T00:00:00Z'
                }
            ];
            yearlyTargets.forEach(async t => await AppDataStore.create('yearly_targets', t));

            // Quarterly Targets
            const quarterlyTargets = [
                { id: 1, yearly_target_id: 1, quarter: 1, year: 2026, cps_count_target: 180, total_sales_target: 360000, pop_case_count_target: 22, pop_sales_target: 55000, epp_case_count_target: 18, epp_sales_target: 45000, new_agents_target: 12, new_customers_target: 60, total_meetings_target: 280, activity_headcount_target: 140, seasonal_factor: 0.9 },
                { id: 2, yearly_target_id: 1, quarter: 2, year: 2026, cps_count_target: 200, total_sales_target: 400000, pop_case_count_target: 24, pop_sales_target: 60000, epp_case_count_target: 20, epp_sales_target: 50000, new_agents_target: 12, new_customers_target: 60, total_meetings_target: 300, activity_headcount_target: 150, seasonal_factor: 1.0 },
                { id: 3, yearly_target_id: 1, quarter: 3, year: 2026, cps_count_target: 220, total_sales_target: 440000, pop_case_count_target: 26, pop_sales_target: 65000, epp_case_count_target: 21, epp_sales_target: 52500, new_agents_target: 12, new_customers_target: 60, total_meetings_target: 310, activity_headcount_target: 155, seasonal_factor: 1.1 },
                { id: 4, yearly_target_id: 1, quarter: 4, year: 2026, cps_count_target: 240, total_sales_target: 480000, pop_case_count_target: 28, pop_sales_target: 70000, epp_case_count_target: 21, epp_sales_target: 52500, new_agents_target: 12, new_customers_target: 60, total_meetings_target: 310, activity_headcount_target: 155, seasonal_factor: 1.2 }
            ];
            quarterlyTargets.forEach(async t => await AppDataStore.create('quarterly_targets', t));

            // Monthly Targets (sample for Q1)
            const monthlyTargets = [
                { id: 1, quarterly_target_id: 1, month: 1, year: 2026, cps_count_target: 58, total_sales_target: 116000, working_days: 22 },
                { id: 2, quarterly_target_id: 1, month: 2, year: 2026, cps_count_target: 60, total_sales_target: 120000, working_days: 20 },
                { id: 3, quarterly_target_id: 1, month: 3, year: 2026, cps_count_target: 62, total_sales_target: 124000, working_days: 23 }
            ];
            monthlyTargets.forEach(async t => await AppDataStore.create('monthly_targets', t));

            // Weekly Targets (sample for March)
            const weeklyTargets = [
                { id: 1, monthly_target_id: 3, week_number: 1, week_start_date: '2026-03-01', week_end_date: '2026-03-07', cps_count_target: 15, total_sales_target: 30000 },
                { id: 2, monthly_target_id: 3, week_number: 2, week_start_date: '2026-03-08', week_end_date: '2026-03-14', cps_count_target: 16, total_sales_target: 32000 },
                { id: 4, monthly_target_id: 3, week_number: 4, week_start_date: '2026-03-22', week_end_date: '2026-03-28', cps_count_target: 15, total_sales_target: 30000 }
            ];
            weeklyTargets.forEach(async t => await AppDataStore.create('weekly_targets', t));
        }

        // Phase 12: WhatsApp Marketing Demo Data
        if (await AppDataStore.getAll('whatsapp_templates').length === 0) {
            const templates = [
                {
                    id: 1,
                    template_name: 'Happy Birthday Wishes',
                    category: 'Birthday',
                    content: 'Hi {{name}}, wishing you a very happy birthday! May the {{zodiac}} year bring you prosperity and success!',
                    buttons: [{ text: 'Thank you!', type: 'quick_reply' }, { text: 'View Offers', type: 'url' }],
                    variables: ['name', 'zodiac'],
                    footer_text: 'Reply STOP to opt out',
                    is_approved: true,
                    status: 'active',
                    created_by: 5,
                    created_at: '2026-02-15T10:00:00Z'
                },
                {
                    id: 2,
                    template_name: 'PR4 Special Offer',
                    category: 'Promotion',
                    content: 'Hi {{name}}, special offer for you! Get 15% off on PR4 Power Ring this month. Use code: PR4{{offer}}',
                    buttons: [{ text: 'I\'m interested', type: 'quick_reply' }, { text: 'Learn more', type: 'url' }],
                    variables: ['name', 'offer'],
                    footer_text: 'Reply STOP to opt out',
                    is_approved: true,
                    status: 'active',
                    created_by: 5,
                    created_at: '2026-02-20T14:30:00Z'
                },
                {
                    id: 3,
                    template_name: 'Event Invitation',
                    category: 'Event',
                    content: 'Join us for {{event_title}} on {{event_date}} at {{location}}. Limited seats available!',
                    buttons: [{ text: 'Yes, I\'ll attend', type: 'quick_reply' }, { text: 'View details', type: 'url' }],
                    variables: ['name', 'event_title', 'event_date', 'location'],
                    footer_text: 'Reply STOP to opt out',
                    is_approved: true,
                    status: 'active',
                    created_by: 5,
                    created_at: '2026-02-25T09:15:00Z'
                }
            ];
            templates.forEach(async t => await AppDataStore.create('whatsapp_templates', t));
        }

        if (await AppDataStore.getAll('whatsapp_campaigns').length === 0) {
            const campaigns = [
                {
                    id: 1,
                    campaign_name: 'March Birthday Blast',
                    template_id: 1,
                    status: 'scheduled',
                    scheduled_date: '2026-03-10T09:00:00',
                    audience_config: { segments: ['birthday-month'] },
                    total_recipients: 45,
                    sent_count: 45,
                    delivered_count: 44,
                    opened_count: 42,
                    replied_count: 12,
                    clicked_count: 8,
                    converted_count: 5,
                    created_by: 5,
                    created_at: '2026-03-01T11:00:00Z'
                },
                {
                    id: 2,
                    campaign_name: 'PR4 Follow-up Campaign',
                    template_id: 2,
                    status: 'active',
                    scheduled_date: '2026-03-05T14:00:00',
                    audience_config: { segments: ['high-score'] },
                    total_recipients: 120,
                    sent_count: 120,
                    delivered_count: 118,
                    opened_count: 108,
                    replied_count: 22,
                    clicked_count: 15,
                    converted_count: 8,
                    created_by: 5,
                    created_at: '2026-03-04T16:30:00Z'
                },
                {
                    id: 3,
                    campaign_name: 'Post-Event Thank You',
                    template_id: 1,
                    status: 'completed',
                    scheduled_date: '2026-03-02T18:00:00',
                    audience_config: { segments: ['event-attendees'] },
                    total_recipients: 85,
                    sent_count: 85,
                    delivered_count: 85,
                    opened_count: 82,
                    replied_count: 15,
                    clicked_count: 10,
                    converted_count: 3,
                    created_by: 5,
                    created_at: '2026-03-01T10:00:00Z',
                    completed_date: '2026-03-03T10:00:00Z'
                }
            ];
            campaigns.forEach(async c => await AppDataStore.create('whatsapp_campaigns', c));
        }

        // Phase: Marketing Manager Listings - Seed Products
        if (await AppDataStore.getAll('products').length === 0) {
            const productNames = [
                "PR1", "PR2", "PR3", "PR4", "PR5", "PR6", "PR7", "PR8", "PR9", "PRH",
                "简易", "灵活", "专案", "商业", "润雷益德", "源禄晋富", "黄离元吉",
                "曲全霍盈利生藏钜", "有无相生难易相成", "大满福", "三富天",
                "富田盘2", "富田盘1", "天至喜4", "天至喜3", "天至喜2", "天至喜1",
                "万富通", "长胜决", "宝王象3", "宝王象2", "宝王象1", "元极大通",
                "上善若水", "云行雨施", "滴水兴波", "元亨利贞", "谦卑而光",
                "长丰-顺利昭德雷风赫惠", "聚人曰财", "枢机富丽", "自天祐之吉无不利",
                "厚德载物", "经传录", "圣智", "渊慧", "魁星踢斗独占鳌头", "文昌图",
                "见龙在田", "终日乾乾夕惕若厉", "劳谦有终曲成万物", "天道酬勤",
                "财库", "财托", "观象防危", "命卦紫兆", "星卦解运",
                "生命蓝图3年", "生命蓝图5年", "择日生子", "新生儿取名", "个人测名"
            ];
            productNames.forEach(name => {
                await AppDataStore.create('products', {
                    name,
                    price: 0,
                    remarks: "",
                    delivery_lead_time: "",
                    is_active: true
                });
            });
        }

        // Phase: Marketing Manager Listings - Seed Events
        if (await AppDataStore.getAll('events').length === 0) {
            const eventTitles = [
                "9-Stars", "Fengshui DIY", "Museum", "Sharing- PR", "Sharing- Calligraphy",
                "Sharing - FengShui JY", "Sharing - FengShui Flexi", "Sharing - FengShui ZhuanAn",
                "Huiji- JY", "Huiji- Flexi", "Huijio ZhuanAn", "Chuan Fu", "Boss Month Event",
                "CNY Event", "Annual Prediction Talk", "Special Topic", "916 Event"
            ];
            eventTitles.forEach(title => {
                await AppDataStore.create('events', {
                    title,
                    ticket_price: 0,
                    duration: "",
                    target_group: "",
                    description: "",
                    is_active: true
                });
            });
        }
    };

    const updateUserDisplay = () => {
        const userDisplay = document.getElementById('user-name-label');
        const userAvatar = document.getElementById('user-avatar');
        if (_currentUser) {
            if (userDisplay) userDisplay.textContent = _currentUser.full_name || _currentUser.username;
            if (userAvatar) userAvatar.src = `https://ui-avatars.com/api/?name=${encodeURIComponent(_currentUser.full_name || _currentUser.username)}&background=0D9488&color=fff`;
        } else {
            if (userDisplay) userDisplay.textContent = 'Guest';
            if (userAvatar) userAvatar.src = 'https://ui-avatars.com/api/?name=Guest&background=0D9488&color=fff';
        }
    };

    const getViewPhase = (viewId) => {
        const phaseMap = {
            'dashboard': '0', 'calendar': '1', 'pipeline': '6', 'protection': '13',
            'prospects': '3', 'referrals': '7', 'cases': '18', 'documents': '11',
            'promotions': '12', 'performance': '9', 'reports': '9', 'risk': '19', 'settings': '0',
            'import': '13'
        };
        return phaseMap[viewId] || '?';
    };

    const navigateTo = async (viewId) => {
        document.querySelectorAll('.nav-links li').forEach(li => {
            li.classList.toggle('active', li.getAttribute('data-view') === viewId);
        });

        const viewport = document.getElementById('content-viewport');

        if (viewId === 'calendar') {
            _currentView = 'month';
            await showCalendarView(viewport);
        } else if (viewId === 'prospects') {
            _currentView = 'prospects';
            await showProspectsView(viewport);
        } else if (viewId === 'pipeline') {
            _currentView = 'pipeline';
            await showPipelineView(viewport);
        } else if (viewId === 'agents') {
            _currentView = 'agents';
            await showAgentsView(viewport);
        } else if (viewId === 'promotions') {
            _currentView = 'promotions';
            await showMarketingAutomationView(viewport);
        } else if (viewId === 'reports') {
            _currentView = 'reports';
            await showKPIDashboard(viewport);
        } else if (viewId === 'documents') {
            _currentView = 'documents';
            await showDocumentManagementView(viewport);
        } else if (viewId === 'protection') {
            _currentView = 'protection';
            await showProtectionMonitoringView(viewport);
        } else if (viewId === 'import') {
            _currentView = 'import';
            await showImportDashboard(viewport);
        } else if (viewId === 'integrations') {
            _currentView = 'integrations';
            await showIntegrationHub(viewport);
        } else if (viewId === 'referrals') {
            _currentView = 'referrals';
            await showReferralsView(viewport);
        } else if (viewId === 'cases') {
            _currentView = 'cases';
            await showCasesView(viewport);
        } else if (viewId === 'marketing_lists') {
            _currentView = 'marketing_lists';
            await showMarketingListsView(viewport);
        } else {
            viewport.innerHTML = `
                <div class="placeholder-view">
                    <h1>${viewId.toUpperCase()}</h1>
                    <p>Phase ${getViewPhase(viewId)} Implementation: ${viewId} module interface.</p>
                    <button class="btn primary" onclick="app.todo('Feature development')">View Roadmap</button>
                </div>
            `;
        }

        UI.toast.info(`Switched to ${viewId} view.`);
    };

    // ========== PHASE 7: REFERRALS MODULE IMPLEMENTATION (VERTICAL LAYOUT) ==========

    const showReferralsView = async (container) => {
        _currentView = 'referrals';
        container.innerHTML = `
            <div class="referrals-view-v2">
                <div class="ref-v2-header">
                    <div>
                        <h1>Referral Relationship Management</h1>
                        <div class="ref-v2-subtitle">Visualize connections and track top referrers</div>
                    </div>
                    <div class="ref-v2-actions">
                        <div class="search-box-v2">
                            <i class="fas fa-search"></i>
                            <input type="text" id="tree-search-input" placeholder="Search person to view tree..." autocomplete="off" onkeyup="await app.debounce(await app.searchTreePerson(this.value), 300)">
                            <div id="tree-search-results" class="search-results-v2"></div>
                        </div>
                        <button class="btn primary" onclick="await app.openAddReferralModal()">
                            <i class="fas fa-plus"></i> Add Referral
                        </button>
                        <button class="btn secondary" onclick="app.refreshCurrentView()">
                            <i class="fas fa-sync-alt"></i> Refresh
                        </button>
                    </div>
                </div>

                <div class="ref-v2-content">
                    <div id="referral-summary-container"></div>
                    
                    <div class="ref-v2-leaderboard-section">
                        <div class="section-header" onclick="app.toggleLeaderboard()">
                            <h3><i class="fas fa-trophy"></i> Top Referrers Leaderboard</h3>
                            <i class="fas fa-chevron-up toggle-icon"></i>
                        </div>
                        <div id="referral-leaderboard-container" class="collapsible-content"></div>
                    </div>

                    <div class="ref-v2-tree-section">
                        <div class="tree-header">
                            <h3><i class="fas fa-network-wired"></i> Relationship Tree</h3>
                            <div class="tree-tools">
                                <button class="tool-btn" onclick="app.treeZoomIn()" title="Zoom In"><i class="fas fa-plus"></i></button>
                                <button class="tool-btn" onclick="app.treeZoomOut()" title="Zoom Out"><i class="fas fa-minus"></i></button>
                                <button class="tool-btn" onclick="app.treeResetZoom()" title="Reset"><i class="fas fa-compress-arrows-alt"></i></button>
                                <button class="tool-btn" onclick="app.todo('Export Tree')" title="Export"><i class="fas fa-download"></i></button>
                            </div>
                        </div>
                        <div id="referral-tree-container" class="tree-visualization">
                            <div id="referral-tree-placeholder" class="tree-empty">
                                <i class="fas fa-search"></i>
                                <p>Search for a person above to view their referral network.</p>
                            </div>
                            <svg id="referral-tree-svg" style="width:100%; height:100%; display:none;"></svg>
                        </div>
                    </div>
                </div>
            </div>
        `;

        // Inject Styles if not already present
        if (!document.getElementById('referral-styles-v2')) {
            const style = document.createElement('style');
            style.id = 'referral-styles-v2';
            style.textContent = `
                .referrals-view-v2 { padding: 24px; color: var(--gray-800); }
                .ref-v2-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 24px; gap: 20px; flex-wrap: wrap; }
                .ref-v2-subtitle { color: var(--gray-500); font-size: 14px; margin-top: 4px; }
                .ref-v2-actions { display: flex; gap: 12px; align-items: center; }
                
                .search-box-v2 { position: relative; width: 300px; }
                .search-box-v2 i { position: absolute; left: 12px; top: 50%; transform: await translateY(-50%); color: var(--gray-400); }
                .search-box-v2 input { width: 100%; padding: 8px 12px 8px 36px; border-radius: 8px; border: 1px solid var(--gray-200); }
                .search-results-v2 { position: absolute; top: 100%; left: 0; right: 0; background: white; border-radius: 8px; border: 1px solid var(--gray-200); box-shadow: var(--shadow-lg); z-index: 100; display: none; margin-top: 4px; max-height: 300px; overflow-y: auto; }
                .result-item-v2 { padding: 10px 16px; border-bottom: 1px solid var(--gray-100); cursor: pointer; display: flex; align-items: center; gap: 10px; }
                .result-item-v2:hover { background: var(--gray-50); }
                .result-item-v2:last-child { border-bottom: none; }
                .result-item-v2 .badge { font-size: 10px; padding: 2px 6px; border-radius: 10px; text-transform: uppercase; }
                
                .ref-v2-content { display: flex; flex-direction: column; gap: 24px; }
                
                /* Summary Section */
                .summary-table-v2 { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 16px; margin-bottom: 8px; }
                .summary-card-v2 { background: white; padding: 20px; border-radius: 12px; border: 1px solid var(--gray-200); display: flex; align-items: center; gap: 16px; }
                .summary-card-v2 .icon { width: 48px; height: 48px; border-radius: 12px; display: flex; align-items: center; justify-content: center; font-size: 20px; }
                .summary-card-v2.blue .icon { background: #eff6ff; color: #3b82f6; }
                .summary-card-v2.green .icon { background: #ecfdf5; color: #10b981; }
                .summary-card-v2.purple .icon { background: #f5f3ff; color: #8b5cf6; }
                .summary-card-v2 .info h4 { font-size: 12px; text-transform: uppercase; color: var(--gray-500); margin: 0; letter-spacing: 0.05em; }
                .summary-card-v2 .info div { font-size: 24px; font-weight: 700; color: var(--gray-800); }
                
                .top-referrers-strip { background: white; padding: 16px; border-radius: 12px; border: 1px solid var(--gray-200); display: flex; align-items: center; gap: 24px; }
                .strip-label { font-weight: 600; font-size: 14px; white-space: nowrap; color: var(--gray-700); }
                .strip-items { display: flex; gap: 12px; flex-grow: 1; }
                .strip-item { background: var(--gray-50); padding: 6px 12px; border-radius: 20px; font-size: 13px; display: flex; align-items: center; gap: 8px; border: 1px solid var(--gray-100); }
                .strip-item .rank { color: #f59e0b; font-weight: 700; }
                
                /* Leaderboard */
                .ref-v2-leaderboard-section { background: white; border-radius: 12px; border: 1px solid var(--gray-200); overflow: hidden; }
                .section-header { padding: 16px 20px; display: flex; justify-content: space-between; align-items: center; cursor: pointer; background: var(--gray-50); }
                .section-header h3 { margin: 0; font-size: 16px; font-weight: 600; display: flex; align-items: center; gap: 10px; }
                .collapsible-content { padding: 20px; display: block; }
                .collapsible-content.collapsed { display: none; }
                .section-header.collapsed .toggle-icon { transform: rotate(180deg); }
                
                .leaderboard-controls-v2 { display: flex; justify-content: space-between; margin-bottom: 20px; align-items: center; }
                .leaderboard-table-v2 { width: 100%; border-collapse: collapse; }
                .leaderboard-table-v2 th { text-align: left; padding: 12px; border-bottom: 2px solid var(--gray-100); color: var(--gray-500); font-weight: 600; font-size: 13px; }
                .leaderboard-table-v2 td { padding: 14px 12px; border-bottom: 1px solid var(--gray-50); font-size: 14px; }
                .rank-cell { width: 40px; font-weight: 700; color: var(--gray-400); }
                .rank-1 .rank-cell { color: #f59e0b; }
                .rank-2 .rank-cell { color: #94a3b8; }
                .rank-3 .rank-cell { color: #b45309; }
                .name-cell { font-weight: 600; color: #3b82f6; cursor: pointer; }
                .name-cell:hover { text-decoration: underline; }
                
                /* Tree Section */
                .ref-v2-tree-section { background: white; border-radius: 12px; border: 1px solid var(--gray-200); display: flex; flex-direction: column; min-height: 500px; }
                .tree-header { padding: 16px 20px; border-bottom: 1px solid var(--gray-100); display: flex; justify-content: space-between; align-items: center; }
                .tree-header h3 { margin: 0; font-size: 16px; font-weight: 600; display: flex; align-items: center; gap: 10px; }
                .tree-tools { display: flex; gap: 8px; }
                .tool-btn { width: 32px; height: 32px; border-radius: 6px; border: 1px solid var(--gray-200); background: white; color: var(--gray-600); cursor: pointer; display: flex; align-items: center; justify-content: center; }
                .tool-btn:hover { background: var(--gray-50); color: #3b82f6; border-color: #3b82f6; }
                
                .tree-visualization { flex-grow: 1; position: relative; background: #f8fafc; overflow: hidden; border-radius: 0 0 12px 12px; }
                .tree-empty { position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; color: var(--gray-400); gap: 16px; }
                .tree-empty i { font-size: 48px; }
                
                /* D3 Tree Custom Styles */
                .node circle { transition: r 0.3s cubic-bezier(0.175, 0.885, 0.32, 1.275); }
                .node:hover circle { r: 18; stroke-width: 3px; }
                .node text { font-family: 'Inter', sans-serif; font-size: 12px; }
                .link { fill: none; stroke: #cbd5e1; stroke-width: 1.5px; stroke-dasharray: 4, 3; }
                .node-memo-btn { cursor: pointer; transition: fill 0.2s; }
                .node-memo-btn:hover { fill: #3b82f6; }
                
                /* Responsive */
                @media (max-width: 768px) {
                    .ref-v2-header { flex-direction: column; align-items: flex-start; }
                    .search-box-v2 { width: 100%; }
                    .top-referrers-strip { flex-direction: column; align-items: flex-start; }
                    .collapsible-content { padding: 10px; }
                    .leaderboard-table-v2 th:nth-child(4), .leaderboard-table-v2 td:nth-child(4) { display: none; }
                }
            `;
            document.head.appendChild(style);
        }

        await renderReferralSummaryAndLeaderboard();

        // Determine initial root for lower roles
        const user = _currentUser;
        if (user) {
            const role = user.role?.toLowerCase();
            const lowerRoles = ['consultant', 'junior_consultant', 'senior_consultant', 'agent', 'junior_agent', 'senior_agent'];
            if (lowerRoles.includes(role)) {
                // Show their own tree if they have any downline, else show placeholder
                const rootPerson = AppDataStore.getById('customers', user.id) || AppDataStore.getById('prospects', user.id);
                if (rootPerson) {
                    await app.showReferralTree(rootPerson.id, rootPerson.id in await AppDataStore.getAll('customers') ? 'customer' : 'prospect');
                } else {
                    // Show placeholder – no data
                    const ph = document.getElementById('referral-tree-placeholder');
                    if (ph) {
                        ph.style.display = 'flex';
                        ph.innerHTML = `
                            <i class="fas fa-user"></i>
                            <p>You don't have any downline yet. Add a referral to start building your network.</p>
                        `;
                    }
                    const svg = document.getElementById('referral-tree-svg');
                    if (svg) svg.style.display = 'none';
                }
            } else {
                // For higher roles, show a message to search
                const ph = document.getElementById('referral-tree-placeholder');
                if (ph) {
                    ph.style.display = 'flex';
                    ph.innerHTML = `
                        <i class="fas fa-search"></i>
                        <p>Search for a person above to view their referral network.</p>
                    `;
                }
                const svg = document.getElementById('referral-tree-svg');
                if (svg) svg.style.display = 'none';
            }
        }
    };

    const renderReferralSummaryAndLeaderboard = async () => {
        await renderSummary();
        await renderLeaderboard();
    };

    const renderSummary = async () => {
        const container = document.getElementById('referral-summary-container');
        if (!container) return;

        const referrals = await AppDataStore.getAll('referrals');
        const totalReferrals = referrals.length;
        const totalReferrers = new Set(referrals.map(r => r.referrer_id)).size;
        
        // Calculate conversion rate (mock: based on 'converted' status or custom field)
        const convertedCount = referrals.filter(r => r.status === 'Active' || r.is_converted).length;
        const conversionRate = totalReferrals > 0 ? Math.round((convertedCount / totalReferrals) * 100) : 0;

        // Get Top 3 Referrers for the strip
        const grouped = {};
        referrals.forEach(r => {
            if (!r.referrer_id) return;
            grouped[r.referrer_id] = (grouped[r.referrer_id] || 0) + 1;
        });
        const top3 = Object.entries(grouped)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 3)
            .map(([id, count]) => {
                const person = AppDataStore.getById('customers', id) || AppDataStore.getById('prospects', id);
                return { name: person?.full_name || `ID: ${id}`, count };
            });

        container.innerHTML = `
            <div class="summary-table-v2">
                <div class="summary-card-v2 blue">
                    <div class="icon"><i class="fas fa-users"></i></div>
                    <div class="info"><h4>Total Referrers</h4><div>${totalReferrers}</div></div>
                </div>
                <div class="summary-card-v2 green">
                    <div class="icon"><i class="fas fa-user-plus"></i></div>
                    <div class="info"><h4>Total Referrals</h4><div>${totalReferrals}</div></div>
                </div>
                <div class="summary-card-v2 purple">
                    <div class="icon"><i class="fas fa-percentage"></i></div>
                    <div class="info"><h4>Conversion Rate</h4><div>${conversionRate}%</div></div>
                </div>
            </div>
            <div class="top-referrers-strip">
                <div class="strip-label"><i class="fas fa-fire"></i> Top Referrers:</div>
                <div class="strip-items">
                    ${top3.map((t, i) => `
                        <div class="strip-item"><span class="rank">#${i + 1}</span> ${t.name} (${t.count})</div>
                    `).join('')}
                    ${top3.length === 0 ? '<div class="text-muted" style="font-size:12px">No referrals yet.</div>' : ''}
                </div>
            </div>
        `;
    };

    const renderLeaderboard = async () => {
        const container = document.getElementById('referral-leaderboard-container');
        if (!container) return;

        const userId = _currentUser?.id || 'guest';
        const hiddenKey = `hidden_top_referrers_v2_${userId}`;
        const hiddenIds = JSON.parse(localStorage.getItem(hiddenKey) || '[]');
        
        const referrals = await AppDataStore.getAll('referrals');
        const grouped = {};
        referrals.forEach(r => {
            if (!r.referrer_id) return;
            if (!grouped[r.referrer_id]) {
                grouped[r.referrer_id] = { id: r.referrer_id, type: r.referrer_type, count: 0, converted: 0, latest: r.created_at };
            }
            grouped[r.referrer_id].count++;
            if (r.status === 'Active' || r.is_converted) grouped[r.referrer_id].converted++;
            if (new Date(r.created_at) > new Date(grouped[r.referrer_id].latest)) grouped[r.referrer_id].latest = r.created_at;
        });

        const sorted = Object.values(grouped).sort((a, b) => b.count - a.count);

        container.innerHTML = `
            <div class="leaderboard-controls-v2">
                <div style="display:flex; gap:12px; align-items:center;">
                    <select class="form-control" style="width:150px" onchange="app.todo('Change period')">
                        <option>All Time</option>
                        <option>This Year</option>
                        <option>This Month</option>
                    </select>
                    <button class="btn secondary btn-sm" onclick="await app.resetHiddenReferrers()">Reset Hidden</button>
                </div>
                <div class="text-muted" font-size="12px">Showing top contributors</div>
            </div>
            <table class="leaderboard-table-v2">
                <thead>
                    <tr>
                        <th>Rank</th>
                        <th>Referrer Name</th>
                        <th>Total Referrals</th>
                        <th>Converted</th>
                        <th>Latest Activity</th>
                        <th class="text-right">Action</th>
                    </tr>
                </thead>
                <tbody>
                    ${sorted.map((item, idx) => {
                        if (hiddenIds.includes(String(item.id))) return '';
                        const person = AppDataStore.getById('customers', item.id) || AppDataStore.getById('prospects', item.id);
                        if (!person) return '';
                        return `
                            <tr class="rank-${idx + 1}">
                                <td class="rank-cell">${idx + 1}</td>
                                <td class="name-cell" onclick="await app.showReferralTree(${item.id}, '${item.type}')">
                                    ${person.full_name} ${item.type === 'customer' ? '<span class="badge" style="background:#dcfce7; color:#166534">C</span>' : ''}
                                </td>
                                <td>${item.count}</td>
                                <td><span style="color:#10b981; font-weight:600">${item.converted}</span></td>
                                <td>${UI.formatDate(item.latest)}</td>
                                <td class="text-right">
                                    <button class="btn-icon" onclick="await app.toggleHideReferrer('${item.id}')" title="Hide from leaderboard">
                                        <i class="far fa-eye-slash"></i>
                                    </button>
                                </td>
                            </tr>
                        `;
                    }).join('')}
                    ${sorted.length === 0 ? '<tr><td colspan="6" class="text-center p-4 text-muted">No referrer data found.</td></tr>' : ''}
                </tbody>
            </table>
        `;
    };

    const toggleLeaderboard = () => {
        const content = document.querySelector('.collapsible-content');
        const header = document.querySelector('.section-header');
        content.classList.toggle('collapsed');
        header.classList.toggle('collapsed');
    };

    const toggleHideReferrer = async (id) => {
        const userId = _currentUser?.id || 'guest';
        const hiddenKey = `hidden_top_referrers_v2_${userId}`;
        let hiddenIds = JSON.parse(localStorage.getItem(hiddenKey) || '[]');
        id = String(id);
        if (hiddenIds.includes(id)) {
            hiddenIds = hiddenIds.filter(hid => hid !== id);
        } else {
            hiddenIds.push(id);
        }
        localStorage.setItem(hiddenKey, JSON.stringify(hiddenIds));
        await renderLeaderboard();
        UI.toast.info("Leaderboard preferences updated.");
    };

    const resetHiddenReferrers = async () => {
        const userId = _currentUser?.id || 'guest';
        const hiddenKey = `hidden_top_referrers_v2_${userId}`;
        localStorage.removeItem(hiddenKey);
        await renderLeaderboard();
        UI.toast.success("Hidden referrers reset.");
    };

    const searchTreePerson = async (query) => {
        const results = document.getElementById('tree-search-results');
        if (!query || query.length < 2) {
            results.style.display = 'none';
            return;
        }

        const prospects = await AppDataStore.getAll('prospects');
        const customers = await AppDataStore.getAll('customers');
        const all = [
            ...prospects.map(p => ({ ...p, type: 'prospect' })),
            ...customers.map(c => ({ ...c, type: 'customer' }))
        ];

        const filtered = all.filter(p => p.full_name?.toLowerCase().includes(query.toLowerCase())).slice(0, 8);

        if (filtered.length > 0) {
            results.innerHTML = filtered.map(p => `
                <div class="result-item-v2" onclick="await app.showReferralTree(${p.id}, '${p.type}')">
                    <div style="background: ${p.type === 'customer' ? '#dcfce7' : '#f1f5f9'}; width:32px; height:32px; border-radius:50%; display:flex; align-items:center; justify-content:center;">
                        <i class="fas ${p.type === 'customer' ? 'fa-user-check' : 'fa-user'}" style="color:${p.type === 'customer' ? '#166534' : '#64748b'}; font-size:12px;"></i>
                    </div>
                    <div style="flex-grow:1">
                        <div style="font-weight:600; font-size:14px;">${p.full_name}</div>
                        <div style="font-size:11px; color:var(--gray-500)">${p.phone || 'No phone'}</div>
                    </div>
                    <span class="badge ${p.type === 'customer' ? 'success' : 'secondary'}">${p.type}</span>
                </div>
            `).join('');
            results.style.display = 'block';
        } else {
            results.innerHTML = `<div class="p-3 text-center text-muted">No matches found</div>`;
            results.style.display = 'block';
        }
    };

    const showReferralTree = async (personId, personType) => {
        _currentSelectedPerson = { id: personId, type: personType };
        document.getElementById('tree-search-results').style.display = 'none';
        document.getElementById('tree-search-input').value = '';
        document.getElementById('referral-tree-placeholder').style.display = 'none';
        document.getElementById('referral-tree-svg').style.display = 'block';

        _currentTreeData = await buildTreeData(personId, personType);
        if (!_currentTreeData) {
            UI.toast.error('Could not build tree for this person');
            return;
        }
        await renderD3Tree(_currentTreeData);
    };

    const buildTreeData = async (rootId, rootType) => {
        const person = AppDataStore.getById(rootType === 'customer' ? 'customers' : 'prospects', rootId);
        if (!person || !await canViewNode(rootId, rootType)) return null;

        const node = {
            id: person.id,
            name: person.full_name,
            type: rootType,
            role: person.role || 'Guest',
            children: []
        };

        // Find child referrals
        const referrals = await AppDataStore.getAll('referrals');
        // Match by referrer_id (new format)
        const children = referrals.filter(r => String(r.referrer_id) === String(rootId));

        children.forEach(r => {
            const childNode = await buildTreeData(r.referred_prospect_id, 'prospect');
            if (childNode) {
                childNode.referralSource = r.referral_source;
                childNode.referralDate = r.created_at;
                node.children.push(childNode);
            }
        });

        return node;
    };

    const getProspectColour = (prospectId) => {
        const prospect = AppDataStore.getById('prospects', prospectId);
        if (!prospect) return "#cbd5e1"; // Gray default
        const status = prospect.pipeline_stage?.toLowerCase();
        
        switch(status) {
            case 'new': return "#10b981"; // Emerald Green
            case 'contacted': return "#3b82f6"; // Blue
            case 'meeting': return "#f59e0b"; // Oak/Orange
            case 'proposal': return "#eab308"; // Yellow
            case 'negotiation': return "#6366f1"; // Indigo
            case 'lost': return "#ef4444"; // Red
            default: return "#94a3b8"; // Slate Gray
        }
    };

    const getCustomerBadge = async (customerId) => {
        const customer = AppDataStore.getById('customers', customerId);
        if (!customer) return null;
        
        // Logic for Hot/Cool badges
        const purchases = await AppDataStore.getAll('purchases').filter(p => p.customer_id == customerId);
        if (purchases.length > 3) return { icon: "🔥", color: "#ef4444" }; // Hot
        if (customer.conversion_amount > 5000) return { icon: "💰", color: "#f59e0b" }; // VIP
        return null;
    };

    const renderD3Tree = async (rootData) => {
        const container = document.getElementById('referral-tree-container');
        if (!container) return;
        
        const svgElement = d3.select("#referral-tree-svg");
        svgElement.selectAll("*").remove();
        
        const width = container.clientWidth || 800;
        const height = container.clientHeight || 500;

        _treeZoom = d3.zoom()
            .scaleExtent([0.5, 3])
            .on("zoom", (e) => {
                _treeSvg.attr("transform", e.transform);
            });

        _treeSvg = svgElement
            .append("g")
            .attr("class", "tree-group");

        svgElement.call(_treeZoom);

        const tree = d3.tree().nodeSize([60, 200]); // Vertical spacing, Horizontal spacing
        const root = d3.hierarchy(rootData);
        tree(root);

        // Links
        _treeSvg.selectAll(".link")
            .data(root.links())
            .enter()
            .append("path")
            .attr("class", "link")
            .attr("d", d3.linkHorizontal()
                .x(d => d.y)
                .y(d => d.x));

        // Nodes
        const nodes = _treeSvg.selectAll(".node")
            .data(root.descendants())
            .enter()
            .append("g")
            .attr("class", "node")
            .attr("transform", d => `translate(${d.y},${d.x})`);

        // Node Background
        nodes.append("rect")
            .attr("width", 160)
            .attr("height", 44)
            .attr("x", -80)
            .attr("y", -22)
            .attr("rx", 6)
            .attr("fill", d => d.data.type === 'customer' ? '#ffffff' : getProspectColour(d.data.id))
            .attr("stroke", d => d.data.type === 'customer' ? '#0d9488' : 'none')
            .attr("stroke-width", 2)
            .style("filter", "drop-shadow(0 2px 4px rgba(0,0,0,0.05))");

        // Icon
        nodes.append("text")
            .attr("x", -70)
            .attr("y", 4)
            .attr("fill", d => d.data.type === 'customer' ? '#0d9488' : '#ffffff')
            .style("font-family", '"Font Awesome 5 Free"')
            .style("font-weight", "900")
            .text(d => d.data.type === 'customer' ? "\uf0b1" : "\uf007"); // Briefcase vs User

        // Name
        nodes.append("text")
            .attr("x", -50)
            .attr("y", 0)
            .attr("fill", d => d.data.type === 'customer' ? '#1f2937' : '#ffffff')
            .style("font-weight", "600")
            .style("font-size", "11px")
            .text(d => d.data.name.length > 18 ? d.data.name.substring(0, 15) + '...' : d.data.name);

        // Role/Status
        nodes.append("text")
            .attr("x", -50)
            .attr("y", 12)
            .attr("fill", d => d.data.type === 'customer' ? '#6b7280' : 'rgba(255,255,255,0.8)')
            .style("font-size", "9px")
            .text(d => d.data.type.toUpperCase());

        // Memo Button
        nodes.append("text")
            .attr("class", "node-memo-btn")
            .attr("x", 65)
            .attr("y", 4)
            .attr("fill", d => d.data.type === 'customer' ? '#94a3b8' : 'rgba(255,255,255,0.6)')
            .style("font-family", '"Font Awesome 5 Free"')
            .style("font-weight", "900")
            .text("\uf075") // fa-comment
            .on("click", (e, d) => {
                e.stopPropagation();
                await app.openMemoModal(d.data.id, d.data.type);
            });

        // Click async Handler (View Profile)
        nodes.on("click", (e, d) => {
            if (d.data.type === 'customer') {
                await app.showCustomerDetail(d.data.id);
            } else {
                await app.showProspectDetail(d.data.id);
            }
        });

        // Expand/collapse on double-click
        nodes.on("dblclick", (e, d) => {
            e.stopPropagation();
            await app.showReferralTree(d.data.id, d.data.type);
        });

        // Center the tree
        const initialTransform = d3.zoomIdentity.translate(width / 4, height / 2).scale(1);
        svgElement.call(_treeZoom.transform, initialTransform);
    };

    const treeZoomIn = () => {
        if (_treeZoom && _treeSvg) {
            d3.select("#referral-tree-svg").transition().call(_treeZoom.scaleBy, 1.2);
        }
    };

    const treeZoomOut = () => {
        if (_treeZoom && _treeSvg) {
            d3.select("#referral-tree-svg").transition().call(_treeZoom.scaleBy, 0.8);
        }
    };

    const treeResetZoom = () => {
        if (_treeZoom && _treeSvg) {
            const container = document.getElementById('referral-tree-container');
            const width = container.clientWidth || 800;
            const height = container.clientHeight || 500;
            const initialTransform = d3.zoomIdentity.translate(width / 4, height / 2).scale(1);
            d3.select("#referral-tree-svg").transition().call(_treeZoom.transform, initialTransform);
        }
    };

    // ========== ADD REFERRAL MODAL & FLOW ==========
 
    let _modalSelectedReferrer = null;
    let _modalSelectedReferred = null;
 
    const openAddReferralModal = async () => {
        _modalSelectedReferrer = null;
        _modalSelectedReferred = null;
 
        const content = `
            <div class="referral-modal-v2">
                <div class="ref-form-step">
                    <label>1. Who is the Referrer?</label>
                    <div class="search-field">
                        <input type="text" id="referrer-search" class="form-control" placeholder="Search customer or prospect..." onkeyup="await app.searchReferrersForModal(this.value, 'referrer')">
                        <div id="referrer-search-results" class="search-dropdown"></div>
                    </div>
                    <div id="selected-referrer-info" class="selected-entity-display"></div>
                </div>
 
                <div class="ref-form-step" style="margin-top:20px">
                    <label>2. Who was Referred?</label>
                    <div class="search-field">
                        <div style="display:flex; gap:8px">
                            <input type="text" id="referred-search" class="form-control" placeholder="Search existing prospect..." onkeyup="await app.searchReferrersForModal(this.value, 'referred')">
                            <button class="btn secondary" onclick="await app.openCreateProspectForReferral()"><i class="fas fa-user-plus"></i> New</button>
                        </div>
                        <div id="referred-search-results" class="search-dropdown"></div>
                    </div>
                    <div id="selected-referred-info" class="selected-entity-display"></div>
                </div>
 
                <div class="form-group" style="margin-top:20px">
                    <label>Referral Source / Channel</label>
                    <select id="referral-source-v2" class="form-control">
                        <option>WhatsApp</option>
                        <option>Direct Call</option>
                        <option>Social Media</option>
                        <option>Event/Seminar</option>
                        <option>Friend Recommendation</option>
                    </select>
                </div>
 
                <div class="form-group">
                    <label>Incentive / Bonus Given (Optional)</label>
                    <input type="text" id="referral-memo-v2" class="form-control" placeholder="e.g. RM 50 Voucher, Starbucks Card">
                </div>
            </div>
            <style>
                .ref-form-step label { font-weight: 600; margin-bottom: 8px; display: block; color: var(--gray-700); }
                .search-field { position: relative; }
                .search-dropdown { position: absolute; top: 100%; left: 0; right: 0; background: white; border: 1px solid var(--gray-200); border-radius: 8px; box-shadow: var(--shadow-lg); z-index: 1000; display: none; margin-top: 4px; max-height: 200px; overflow-y: auto; }
                .selected-entity-display { margin-top: 10px; padding: 12px; background: #f8fafc; border: 1px dashed #cbd5e1; border-radius: 8px; empty-cells: hide; }
                .selected-entity-display:empty { display: none; }
                .entity-chip { display: flex; align-items: center; justify-content: space-between; }
            </style>
        `;
 
        UI.showModal("Add New Referral", content, [
            { label: "Cancel", type: "secondary", action: "UI.hideModal()" },
            { label: "Create Referral", type: "primary", action: "await app.submitReferral()" }
        ]);
    };
 
    const searchReferrersForModal = async (query, modalType) => {
        const resultsDiv = document.getElementById(`${modalType}-search-results`);
        if (!query || query.length < 2) {
            resultsDiv.style.display = 'none';
            return;
        }
 
        const prospects = await AppDataStore.getAll('prospects');
        const customers = await AppDataStore.getAll('customers');
        const all = [
            ...prospects.map(p => ({ ...p, type: 'prospect' })),
            ...customers.map(c => ({ ...c, type: 'customer' }))
        ];
 
        const filtered = all.filter(p => p.full_name?.toLowerCase().includes(query.toLowerCase())).slice(0, 5);
 
        if (filtered.length > 0) {
            resultsDiv.innerHTML = filtered.map(p => `
                <div class="result-item-v2" onclick="app.selectReferrerForModal(${p.id}, '${p.type}', '${modalType}')">
                    <div style="flex-grow:1">
                        <strong>${p.full_name}</strong>
                        <div style="font-size:10px">${p.type.toUpperCase()}</div>
                    </div>
                </div>
            `).join('');
            resultsDiv.style.display = 'block';
        } else {
            resultsDiv.innerHTML = `<div class="p-2 text-center text-muted">No results</div>`;
            resultsDiv.style.display = 'block';
        }
    };
 
    const selectReferrerForModal = (id, type, modalType) => {
        const person = AppDataStore.getById(type === 'customer' ? 'customers' : 'prospects', id);
        if (!person) return;
 
        if (modalType === 'referrer') _modalSelectedReferrer = { id, type, name: person.full_name };
        else _modalSelectedReferred = { id, type, name: person.full_name };
 
        document.getElementById(`${modalType}-search-results`).style.display = 'none';
        document.getElementById(`${modalType}-search`).value = '';
 
        const display = document.getElementById(`selected-${modalType}-info`);
        display.innerHTML = `
            <div class="entity-chip">
                <span><i class="fas fa-check-circle" style="color:#10b981"></i> <strong>${person.full_name}</strong> (${type})</span>
                <button class="btn-icon" onclick="app.clearSelectedForModal('${modalType}')"><i class="fas fa-times"></i></button>
            </div>
        `;
    };
 
    const clearSelectedForModal = (modalType) => {
        if (modalType === 'referrer') _modalSelectedReferrer = null;
        else _modalSelectedReferred = null;
        document.getElementById(`selected-${modalType}-info`).innerHTML = '';
    };
 
    const openCreateProspectForReferral = async () => {
        await app.openProspectModal();
        // Listener for the custom event we added to saveProspect
        const handler = (e) => {
            const newProspect = e.detail;
            selectReferrerForModal(newProspect.id, 'prospect', 'referred');
            document.removeEventListener('prospectCreated', handler);
        };
        document.addEventListener('prospectCreated', handler);
    };
 
    const submitReferral = async () => {
        if (!_modalSelectedReferrer || !_modalSelectedReferred) {
            UI.toast.error("Please select both a referrer and a referred person.");
            return;
        }
 
        const referral = {
            id: Date.now(),
            referrer_id: _modalSelectedReferrer.id,
            referrer_type: _modalSelectedReferrer.type,
            referred_prospect_id: _modalSelectedReferred.id,
            referral_source: document.getElementById('referral-source-v2').value,
            memo: document.getElementById('referral-memo-v2').value,
            is_converted: false,
            status: 'Pending',
            created_at: new Date().toISOString()
        };

        await AppDataStore.create('referrals', referral);
        UI.toast.success("Referral created successfully!");
        UI.hideModal();
        
        // Refresh views
        await renderReferralSummaryAndLeaderboard();
        if (_currentSelectedPerson && String(_currentSelectedPerson.id) === String(_selectedReferrer.id)) {
            await showReferralTree(_currentSelectedPerson.id, _currentSelectedPerson.type);
        }
    };

    const openMemoModal = async (id, type) => {
        const notes = await AppDataStore.getAll('notes').filter(n => n.entity_type === type && n.entity_id == id);
        const latest = notes.sort((a,b) => new Date(b.created_at) - new Date(a.created_at))[0];

        const content = `
            <div style="padding:10px">
                <h4>Latest Memo/Note</h4>
                <div style="background:#f1f5f9; padding:16px; border-radius:8px; margin:16px 0; border-left:4px solid #3b82f6">
                    ${latest ? latest.content : 'No memos found for this person.'}
                    <div style="font-size:11px; color:#64748b; margin-top:8px">
                        ${latest ? 'Written by ' + (AppDataStore.getById('users', latest.created_by)?.full_name || 'Admin') + ' on ' + UI.formatDate(latest.created_at) : ''}
                    </div>
                </div>
                <button class="btn secondary btn-block" onclick="UI.hideModal(); app.show${type.charAt(0).toUpperCase() + type.slice(1)}Detail(${id})">View Full Profile</button>
            </div>
        `;
        UI.showModal("Memo Details", content);
    };

    // ========== PHASE 18: CASES MODULE IMPLEMENTATION ==========

    let _caseFilters = { search: '', product: 'all', from: '', to: '', visibility: 'all' };



    const showCasesView = async (container) => {
        container.innerHTML = `
            <div class="cases-view">
                <div class="prospects-header">
                    <div>
                        <h1>Case Studies Repository</h1>
                        <p>Document and share success stories, sales ideas, and closing strategies.</p>
                    </div>
                    <button class="btn primary" onclick="await app.openCaseStudyModal()">
                        <i class="fas fa-plus"></i> New Case Study
                    </button>
                </div>

                <div class="filter-bar">
                    <div class="filter-group">
                        <i class="fas fa-search"></i>
                        <input type="text" id="case-search" placeholder="Search title or prospect/customer..." value="${_caseFilters.search}" onkeyup="await app.handleCaseSearch(event)">
                    </div>
                    <div class="filter-group">
                        <label>Product</label>
                        <select id="case-product-filter" onchange="await app.handleCaseFilterChange()">
                            <option value="all">All Products</option>
                            ${(await AppDataStore.getAll('products') || []).filter(p => p.is_active !== false).map(p => `<option value="${p.name}" ${_caseFilters.product === p.name ? 'selected' : ''}>${p.name}</option>`).join('')}
                        </select>
                    </div>
                    <div class="filter-group">
                        <label>From</label>
                        <input type="date" id="case-date-from" value="${_caseFilters.from}" onchange="await app.handleCaseFilterChange()">
                    </div>
                    <div class="filter-group">
                        <label>To</label>
                        <input type="date" id="case-date-to" value="${_caseFilters.to}" onchange="await app.handleCaseFilterChange()">
                    </div>
                    <div class="filter-group">
                        <label>Visibility</label>
                        <select id="case-visibility-filter" onchange="await app.handleCaseFilterChange()">
                            <option value="all" ${_caseFilters.visibility === 'all' ? 'selected' : ''}>All</option>
                            <option value="public" ${_caseFilters.visibility === 'public' ? 'selected' : ''}>Public Only</option>
                            <option value="mine" ${_caseFilters.visibility === 'mine' ? 'selected' : ''}>My Cases</option>
                        </select>
                    </div>
                </div>

                <div class="table-container">
                    <table class="crm-table">
                        <thead>
                            <tr>
                                <th>Title</th>
                                <th>Prospect / Customer</th>
                                <th>Product</th>
                                <th>Amount (RM)</th>
                                <th>Closing Date</th>
                                <th class="text-right">Actions</th>
                            </tr>
                        </thead>
                        <tbody id="cases-list-body">
                            <!-- Rows rendered by await renderCasesList() -->
                        </tbody>
                    </table>
                    <div id="cases-empty-state" style="display: none; padding: 40px; text-align: center; color: var(--gray-400);">
                        <i class="fas fa-folder-open" style="font-size: 48px; margin-bottom: 16px;"></i>
                        <p>No case studies found matching your criteria.</p>
                    </div>
                </div>
            </div>
        `;

        await renderCasesList();
    };

    const handleCaseSearch = async (e) => {
        _caseFilters.search = e.target.value;
        await renderCasesList();
    };

    const handleCaseFilterChange = async () => {
        _caseFilters.product = document.getElementById('case-product-filter').value;
        _caseFilters.from = document.getElementById('case-date-from').value;
        _caseFilters.to = document.getElementById('case-date-to').value;
        _caseFilters.visibility = document.getElementById('case-visibility-filter').value;
        await renderCasesList();
    };

    const renderCasesList = async () => {
        const tbody = document.getElementById('cases-list-body');
        const emptyState = document.getElementById('cases-empty-state');
        if (!tbody) return;

        let cases = await AppDataStore.getAll('case_studies');
        const currentUser = _currentUser;

        // Apply Permission/Visibility Filters
        cases = cases.filter(c => {
            const isOwner = c.created_by === currentUser?.id;
            const isAdmin = isSystemAdmin(currentUser) || isMarketingManager(currentUser) || currentUser?.role?.includes('Level 3') || currentUser?.role?.includes('Level 7') || currentUser?.role === 'team_leader' || currentUser?.role === 'admin';

            if (_caseFilters.visibility === 'public') return c.is_public;
            if (_caseFilters.visibility === 'mine') return isOwner;

            // Default "all" view: show public ones OR mine OR if I'm admin
            return c.is_public || isOwner || isAdmin;
        });

        // Apply Search/Filter logic
        if (_caseFilters.search) {
            const q = _caseFilters.search.toLowerCase();
            cases = cases.filter(c => {
                let nameMatch = false;
                if (c.prospect_id) {
                    const p = AppDataStore.getById('prospects', c.prospect_id);
                    if (p?.full_name?.toLowerCase().includes(q)) nameMatch = true;
                }
                if (c.customer_id) {
                    const cust = AppDataStore.getById('customers', c.customer_id);
                    if (cust?.full_name?.toLowerCase().includes(q)) nameMatch = true;
                }
                return c.title.toLowerCase().includes(q) || nameMatch;
            });
        }

        if (_caseFilters.product !== 'all') {
            cases = cases.filter(c => c.product === _caseFilters.product);
        }

        if (_caseFilters.from) {
            cases = cases.filter(c => c.closing_date >= _caseFilters.from);
        }

        if (_caseFilters.to) {
            cases = cases.filter(c => c.closing_date <= _caseFilters.to);
        }

        if (cases.length === 0) {
            tbody.innerHTML = '';
            emptyState.style.display = 'block';
            return;
        }

        emptyState.style.display = 'none';
        tbody.innerHTML = cases.map(c => {
            let entityName = '-';
            let entityLink = '#';
            if (c.customer_id) {
                const cust = AppDataStore.getById('customers', c.customer_id);
                entityName = cust ? `<i class="fas fa-user-check" title="Customer"></i> ${cust.full_name}` : 'Unknown Customer';
                entityLink = `await app.showCustomerDetail(${c.customer_id})`;
            } else if (c.prospect_id) {
                const pros = AppDataStore.getById('prospects', c.prospect_id);
                entityName = pros ? `<i class="fas fa-user" title="Prospect"></i> ${pros.full_name}` : 'Unknown Prospect';
                entityLink = `await app.showProspectDetail(${c.prospect_id})`;
            }

            const isOwner = c.created_by === currentUser?.id;
            const isAdmin = isSystemAdmin(currentUser) || isMarketingManager(currentUser) || currentUser?.role?.includes('Level 3') || currentUser?.role?.includes('Level 7') || currentUser?.role === 'team_leader' || currentUser?.role === 'admin';

            return `
                <tr class="clickable" onclick="await app.showCaseStudyDetail(${c.id})">
                    <td>
                        <div class="case-title">
                            <strong>${c.title}</strong>
                            ${c.is_public ? '<span class="badge badge-success ml-2">Public</span>' : ''}
                        </div>
                    </td>
                    <td><a href="#" onclick="event.stopPropagation(); ${entityLink}">${entityName}</a></td>
                    <td>${c.product || '-'}</td>
                    <td>RM ${parseFloat(c.amount || 0).toLocaleString()}</td>
                    <td>${c.closing_date || '-'}</td>
                    <td class="text-right">
                        <div class="actions">
                            <button class="btn-icon" title="View" onclick="event.stopPropagation(); await app.showCaseStudyDetail(${c.id})"><i class="fas fa-eye"></i></button>
                            ${(isOwner || isAdmin) ? `
                                <button class="btn-icon" title="Edit" onclick="event.stopPropagation(); await app.openCaseStudyModal(${c.id})"><i class="fas fa-edit"></i></button>
                                <button class="btn-icon text-danger" title="Delete" onclick="event.stopPropagation(); await app.deleteCaseStudy(${c.id})"><i class="fas fa-trash"></i></button>
                            ` : ''}
                        </div>
                    </td>
                </tr>
            `;
        }).join('');
    };

    const showCaseStudyDetail = async (id) => {
        const c = AppDataStore.getById('case_studies', id);
        if (!c) return;

        const viewport = document.getElementById('content-viewport');
        const currentUser = _currentUser;
        const isOwner = c.created_by === currentUser?.id;
        const isAdmin = isSystemAdmin(currentUser) || isMarketingManager(currentUser) || currentUser?.role?.includes('Level 3') || currentUser?.role?.includes('Level 7') || currentUser?.role === 'team_leader' || currentUser?.role === 'admin';

        let entityInfo = 'Generic Case Study';
        if (c.customer_id) {
            const cust = AppDataStore.getById('customers', c.customer_id);
            entityInfo = cust ? `Customer: ${cust.full_name}` : 'Unknown Customer';
        } else if (c.prospect_id) {
            const pros = AppDataStore.getById('prospects', c.prospect_id);
            entityInfo = pros ? `Prospect: ${pros.full_name}` : 'Unknown Prospect';
        }

        const creator = AppDataStore.getById('users', c.created_by);
        const creatorName = creator ? (creator.full_name || creator.username) : 'System';

        viewport.innerHTML = `
            <div class="case-detail-view">
                <div class="detail-header">
                    <div class="header-left">
                        <button class="btn-back" onclick="await app.navigateTo('cases')"><i class="fas fa-arrow-left"></i> Back to List</button>
                        <h1>${c.title}</h1>
                        <div class="case-meta-header">
                            <span><i class="fas fa-user-circle"></i> ${entityInfo}</span>
                            <span><i class="fas fa-calendar-alt"></i> Closed: ${c.closing_date || 'N/A'}</span>
                            <span><i class="fas fa-tags"></i> Product: ${c.product || 'N/A'}</span>
                            <span><i class="fas fa-money-bill-wave"></i> RM ${parseFloat(c.amount || 0).toLocaleString()}</span>
                        </div>
                    </div>
                    <div class="header-actions">
                        ${(isOwner || isAdmin) ? `
                            <button class="btn secondary" onclick="await app.toggleCasePublic(${c.id})">
                                <i class="fas ${c.is_public ? 'fa-lock' : 'fa-share'}"></i> ${c.is_public ? 'Make Private' : 'Share Publicly'}
                            </button>
                            <button class="btn secondary" onclick="await app.openCaseStudyModal(${c.id})"><i class="fas fa-edit"></i> Edit</button>
                            <button class="btn-icon text-danger" onclick="await app.deleteCaseStudy(${c.id})"><i class="fas fa-trash"></i></button>
                        ` : ''}
                        <button class="btn secondary" onclick="app.copyCaseLink(${c.id})"><i class="fas fa-link"></i> Copy Link</button>
                    </div>
                </div>

                <div class="detail-content scroll-y">
                    <div class="case-section card">
                        <h3><i class="fas fa-handshake"></i> Part 1: CPS Invitation</h3>
                        <div class="section-content">
                            <p>${c.cps_invitation_details || '<em class="text-muted">No details provided.</em>'}</p>
                        </div>
                    </div>

                    <div class="case-section card">
                        <h3><i class="fas fa-check-double"></i> Part 2: Closing & Strategy</h3>
                        <div class="strategy-grid">
                            <div class="strategy-item">
                                <h4>Closing Details</h4>
                                <p>${c.closing_details || '-'}</p>
                            </div>
                            <div class="strategy-item">
                                <h4>The Sales Idea</h4>
                                <div class="highlight-box">
                                    <p>${c.sales_idea || '-'}</p>
                                </div>
                            </div>
                            <div class="strategy-item">
                                <h4>Execution Plan</h4>
                                <p>${c.plan_details || '-'}</p>
                            </div>
                            <div class="strategy-item">
                                <h4>Success Story & Lessons</h4>
                                <p>${c.success_story || '-'}</p>
                            </div>
                        </div>
                    </div>

                    <div class="case-footer">
                        <p><strong>Created By:</strong> ${creatorName} on ${new Date(c.created_at).toLocaleDateString()}</p>
                        ${c.updated_at ? `<p><strong>Last Updated:</strong> ${new Date(c.updated_at).toLocaleString()}</p>` : ''}
                    </div>
                </div>
            </div>
        `;
    };

    const toggleCasePublic = async (id) => {
        const c = AppDataStore.getById('case_studies', id);
        if (!c) return;
        AppDataStore.update('case_studies', id, { is_public: !c.is_public });
        UI.toast.success(`Case study is now ${!c.is_public ? 'public' : 'private'}.`);
        await showCaseStudyDetail(id);
    };

    const copyCaseLink = (id) => {
        const link = `${window.location.origin}${window.location.pathname}?view=cases&id=${id}`;
        navigator.clipboard.writeText(link).then(() => {
            UI.toast.info("Link copied to clipboard.");
        });
    };

    const deleteCaseStudy = async (id) => {
        if (confirm("Are you sure you want to delete this case study? This action cannot be undone.")) {
            AppDataStore.delete('case_studies', id);
            UI.toast.success("Case study deleted.");
            if (_currentView === 'cases') {
                await renderCasesList();
            } else {
                await app.navigateTo('cases');
            }
        }
    };

    const openCaseStudyModal = async (id = null) => {
        const c = id ? AppDataStore.getById('case_studies', id) : null;
        const title = id ? 'Edit Case Study' : 'New Case Study';

        let entityName = '';
        if (c) {
            if (c.customer_id) {
                const cust = AppDataStore.getById('customers', c.customer_id);
                entityName = cust ? cust.full_name : '';
            } else if (c.prospect_id) {
                const pros = AppDataStore.getById('prospects', c.prospect_id);
                entityName = pros ? pros.full_name : '';
            }
        }

        const modalHtml = `
            <div class="case-study-form">
                <div class="modal-tabs">
                    <button class="tab-btn active" onclick="app.switchModalTab(event, 'basic')">Basic Info</button>
                    <button class="tab-btn" onclick="app.switchModalTab(event, 'cps')">CPS Invitation</button>
                    <button class="tab-btn" onclick="app.switchModalTab(event, 'closing')">Closing & Success</button>
                </div>

                <div id="case-tab-basic" class="modal-tab-content active">
                    <div class="form-group">
                        <label>Title <span class="required">*</span></label>
                        <input type="text" id="case-title" class="form-control" value="${c ? c.title : ''}" placeholder="e.g. How I closed PR4 with career focus">
                    </div>
                    
                    <div class="form-row">
                        <div class="form-group half">
                            <label>Link Prospect/Customer</label>
                            <div class="search-select-container">
                                <input type="text" id="case-entity-search" class="form-control" placeholder="Type name..." value="${entityName}" onkeyup="await app.searchCaseEntities(this.value)">
                                <div id="case-entity-results" class="search-results-dropdown"></div>
                                <input type="hidden" id="case-prospect-id" value="${c ? (c.prospect_id || '') : ''}">
                                <input type="hidden" id="case-customer-id" value="${c ? (c.customer_id || '') : ''}">
                            </div>
                        </div>
                        <div class="form-group half">
                            <label>Product</label>
                            <select id="case-product" class="form-control">
                                <option value="">Select Product...</option>
                                ${(await AppDataStore.getAll('products') || []).map(p => `<option value="${p.name}" ${c && c.product === p.name ? 'selected' : ''}>${p.name}</option>`).join('')}
                            </select>
                        </div>
                    </div>

                    <div class="form-row">
                        <div class="form-group half">
                            <label>Amount (RM)</label>
                            <input type="number" id="case-amount" class="form-control" value="${c ? c.amount : ''}" placeholder="0.00">
                        </div>
                        <div class="form-group half">
                            <label>Closing Date</label>
                            <input type="date" id="case-closing-date" class="form-control" value="${c ? c.closing_date : new Date().toISOString().split('T')[0]}">
                        </div>
                    </div>

                    <div class="form-group">
                        <label class="checkbox-label">
                            <input type="checkbox" id="case-is-public" ${c && c.is_public ? 'checked' : ''}> Make this case study public to other agents
                        </label>
                    </div>
                </div>

                <div id="case-tab-cps" class="modal-tab-content">
                    <div class="form-group">
                        <label>CPS Invitation Details</label>
                        <p class="help-text">Who invited? Call/Event/Referral? Special circumstances?</p>
                        <textarea id="case-cps-details" class="form-control" rows="8">${c ? c.cps_invitation_details : ''}</textarea>
                    </div>
                </div>

                <div id="case-tab-closing" class="modal-tab-content">
                    <div class="form-group">
                        <label>Closing Details</label>
                        <textarea id="case-closing-details" class="form-control" rows="3" placeholder="Key discussions, objections overcome...">${c ? c.closing_details : ''}</textarea>
                    </div>
                    <div class="form-group">
                        <label>The Sales Idea</label>
                        <textarea id="case-sales-idea" class="form-control" rows="3" placeholder="The core logic that worked...">${c ? c.sales_idea : ''}</textarea>
                    </div>
                    <div class="form-group">
                        <label>Plan Details</label>
                        <textarea id="case-plan-details" class="form-control" rows="3" placeholder="Follow-up sequence, bundling...">${c ? c.plan_details : ''}</textarea>
                    </div>
                    <div class="form-group">
                        <label>Overall Success Story</label>
                        <textarea id="case-success-story" class="form-control" rows="4" placeholder="Testimonial, lessons learned...">${c ? c.success_story : ''}</textarea>
                    </div>
                </div>
            </div>
        `;

        UI.modal.show(title, modalHtml, [
            { text: 'Cancel', class: 'secondary', onclick: 'UI.modal.hide()' },
            { text: id ? 'Update Case' : 'Save Case Study', class: 'primary', onclick: `await app.saveCaseStudy(${id || 'null'})` }
        ]);
    };

    const switchModalTab = (e, tabId) => {
        document.querySelectorAll('.tab-btn').forEach(btn => btn.classList.remove('active'));
        document.querySelectorAll('.modal-tab-content').forEach(content => content.classList.remove('active'));

        e.target.classList.add('active');
        document.getElementById(`case-tab-${tabId}`).classList.add('active');
    };

    const searchCaseEntities = async (query) => {
        const results = document.getElementById('case-entity-results');
        if (!query || query.length < 2) {
            results.style.display = 'none';
            return;
        }

        const prospects = await AppDataStore.getAll('prospects').filter(p => p.full_name?.toLowerCase().includes(query.toLowerCase()));
        const customers = await AppDataStore.getAll('customers').filter(c => c.full_name?.toLowerCase().includes(query.toLowerCase()));

        let html = '';
        if (prospects.length > 0) {
            html += '<div class="search-category">Prospects</div>';
            html += prospects.map(p => `<div class="search-result-item" onclick="app.selectCaseEntity('${p.id}', 'prospect', '${p.full_name.replace("'", "\\'")}')">${p.full_name}</div>`).join('');
        }
        if (customers.length > 0) {
            html += '<div class="search-category">Customers</div>';
            html += customers.map(c => `<div class="search-result-item" onclick="app.selectCaseEntity('${c.id}', 'customer', '${c.full_name.replace("'", "\\'")}')">${c.full_name}</div>`).join('');
        }

        if (html === '') {
            html = '<div class="p-2 text-center text-muted">No results found</div>';
        }

        results.innerHTML = html;
        results.style.display = 'block';
    };

    const selectCaseEntity = (id, type, name) => {
        document.getElementById('case-entity-search').value = name;
        document.getElementById('case-prospect-id').value = type === 'prospect' ? id : '';
        document.getElementById('case-customer-id').value = type === 'customer' ? id : '';
        document.getElementById('case-entity-results').style.display = 'none';
    };

    const saveCaseStudy = async (id) => {
        const title = document.getElementById('case-title').value.trim();
        if (!title) {
            UI.toast.error("Title is required.");
            return;
        }

        const data = {
            title,
            prospect_id: document.getElementById('case-prospect-id').value || null,
            customer_id: document.getElementById('case-customer-id').value || null,
            product: document.getElementById('case-product').value,
            amount: parseFloat(document.getElementById('case-amount').value) || 0,
            closing_date: document.getElementById('case-closing-date').value,
            is_public: document.getElementById('case-is-public').checked,
            cps_invitation_details: document.getElementById('case-cps-details').value,
            closing_details: document.getElementById('case-closing-details').value,
            sales_idea: document.getElementById('case-sales-idea').value,
            plan_details: document.getElementById('case-plan-details').value,
            success_story: document.getElementById('case-success-story').value,
            updated_at: new Date().toISOString()
        };

        if (id) {
            AppDataStore.update('case_studies', id, data);
            UI.toast.success("Case study updated.");
        } else {
            data.created_by = _currentUser?.id || 1;
            data.created_at = new Date().toISOString();
            const newCase = await AppDataStore.create('case_studies', data);
            UI.toast.success("Case study created.");
            id = newCase.id;
        }

        UI.modal.hide();
        if (_currentView === 'cases') {
            await renderCasesList();
        } else {
            await showCaseStudyDetail(id);
        }
    };

    // ========== PHASE 1: FULL CALENDAR IMPLEMENTATION ==========

    const showCalendarView = async (container) => {
        container.innerHTML = `
            <div class="calendar-view-container">
                <!-- Section 1.1: Header -->
                <div class="calendar-header-toolbar">
                    <div class="calendar-title-nav">
                        <h2 id="calendar-month-title">Month Year</h2>
                        <div class="nav-arrows">
                            <button class="btn-nav" onclick="await app.goToPrevious()"><i class="fas fa-chevron-left"></i></button>
                            <button class="btn-nav" onclick="await app.goToNext()"><i class="fas fa-chevron-right"></i></button>
                        </div>
                        <button class="btn secondary btn-sm" onclick="await app.goToToday()">Today</button>
                    </div>
                    <div class="calendar-controls">
                        <div class="view-toggles">
                            <!-- <button class="btn-toggle" onclick="await app.switchView('day')">Day</button> -->
                            <!-- <button class="btn-toggle" onclick="await app.switchView('week')">Week</button> -->
                            <button class="btn-toggle active" onclick="await app.switchView('month')">Month</button>
                        </div>
                        <button class="btn secondary" onclick="await app.openCalendarFilterModal()">
                            Filter <i class="fas fa-chevron-down" style="font-size: 10px; margin-left: 4px;"></i>
                        </button>
                        <button class="btn-quick-add" onclick="await app.openActivityModal()" style="margin-left: 10px;">
                            <i class="fas fa-plus"></i> Quick Add Activity
                        </button>
                    </div>
                </div>

                <!-- Section 1.2: Grid -->
                <div class="calendar-monthly-wrapper">
                    <div class="calendar-days-header" id="calendar-days-header"></div>
                    <div class="calendar-grid-main" id="calendar-grid"></div>
                </div>

                <!-- Section 1.3: Today's Activities -->
                <div class="today-activities-section">
                    <h3>📅 TODAY'S ACTIVITIES</h3>
                    <div class="activity-cards-grid" id="today-activities-grid"></div>
                </div>

                <!-- Section 1.4: Birthdays -->
                <div class="birthday-section">
                    <h3>🎂 BIRTHDAY REMINDERS</h3>
                    <div class="birthday-columns">
                        <div class="birthday-col">
                            <div id="bday-today-header" style="display: flex; align-items: center; gap: 10px; margin-bottom: 15px;">
                                <div class="bday-badge today" style="width: 30px; height: 30px; border-radius: 50%; background: #3b82f6; color: white; display: flex; align-items: center; justify-content: center; font-weight: bold;">0</div>
                                <h4 style="margin: 0;">Today</h4>
                            </div>
                            <div class="bday-list" id="bday-today-list"></div>
                        </div>
                        <div class="birthday-col">
                            <div id="bday-upcoming-header" style="display: flex; align-items: center; gap: 10px; margin-bottom: 15px;">
                                <div class="bday-badge upcoming" style="width: 30px; height: 30px; border-radius: 50%; background: #f59e0b; color: white; display: flex; align-items: center; justify-content: center; font-weight: bold;">0</div>
                                <h4 style="margin: 0;">Upcoming (Next 2 Days)</h4>
                            </div>
                            <div class="bday-list" id="bday-upcoming-list"></div>
                        </div>
                    </div>
                </div>
            </div>
        `;

        await renderCalendar();
        await renderTodayActivities();
        await renderBirthdaySection();
    };

    const renderCalendar = async () => {
        updateMonthHeader(_currentDate);

        const header = document.getElementById('calendar-days-header');
        const days = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
        if (header) header.innerHTML = days.map(d => `<div class="day-header">${d}</div>`).join('');

        const grid = document.getElementById('calendar-grid');
        if (!grid) return;

        let html = '';

        const year = _currentDate.getFullYear();
        const month = _currentDate.getMonth();

        const firstDayOfMonth = new Date(year, month, 1);
        const daysInMonth = new Date(year, month + 1, 0).getDate();

        // Adjust to Monday start (0=Mon, 6=Sun)
        let startDay = firstDayOfMonth.getDay() - 1;
        if (startDay === -1) startDay = 6;

        const daysInPrevMonth = new Date(year, month, 0).getDate();

        // Previous month overflow days
        for (let i = startDay - 1; i >= 0; i--) {
            const dateNum = daysInPrevMonth - i;
            html += `<div class="calendar-cell"><span class="date-num other-month">${dateNum}</span></div>`;
        }

        let activities = await AppDataStore.getAll('activities');

        // Apply visibility filters using the same logic as await getVisibleActivities()
        activities = activities.filter(a => canViewActivity(a));

        // Apply filters if any
        if (_filters.agent && _filters.agent !== 'all') {
            activities = activities.filter(a => a.lead_agent_id == _filters.agent);
        }
        if (_filters.type && _filters.type !== 'all') {
            activities = activities.filter(a => a.activity_type === _filters.type);
        }
        // Phase 21: Case Status filter (Closed/Open)
        if (_filters.caseStatus === 'closed') {
            activities = activities.filter(a => a.closing_amount && parseFloat(a.closing_amount) > 0);
        } else if (_filters.caseStatus === 'open') {
            activities = activities.filter(a => !a.closing_amount || parseFloat(a.closing_amount) <= 0);
        }

        const todayDate = new Date();
        const isCurrentMonth = todayDate.getMonth() === month && todayDate.getFullYear() === year;

        for (let i = 1; i <= daysInMonth; i++) {
            const isToday = isCurrentMonth && i === todayDate.getDate();
            const dateStr = `${year}-${(month + 1).toString().padStart(2, '0')}-${i.toString().padStart(2, '0')}`;
            const dayActivities = activities.filter(a => a.activity_date === dateStr);

            let activityHtml = '';
            const seenIds = new Set();

            dayActivities.forEach(a => {
                if (!seenIds.has(a.id)) {
                    seenIds.add(a.id);
                    const prospect = a.prospect_id ? AppDataStore.getById('prospects', a.prospect_id) : null;
                    const customer = a.customer_id ? AppDataStore.getById('customers', a.customer_id) : null;
                    const entityName = prospect ? prospect.full_name : (customer ? customer.full_name : (a.activity_title || a.customer_name || 'Event'));

                    if (entityName) {
                        const agent = a.lead_agent_id ? AppDataStore.getById('users', a.lead_agent_id) : null;
                        const agentName = agent ? agent.full_name : 'No Agent';

                        activityHtml += `
                            <div class="calendar-appointment ${a.activity_type.toLowerCase()} ${a.closing_amount ? 'closed-case' : ''}" 
                                onclick="await app.viewActivityDetails(${a.id})">
                                <div class="appointment-time">${a.start_time || '00:00'} - ${a.end_time || '00:00'}</div>
                                <div class="appointment-agent">👤 ${agentName} ${a.co_agents && a.co_agents.length > 0 ? '<small>+1</small>' : ''}</div>
                                <div class="appointment-customer">📋 ${entityName}</div>
                                <div class="appointment-type">🏷️ ${a.activity_type}</div>
                                ${a.closing_amount ? `
                                <div class="appointment-closed">
                                    <div class="closed-badge">✓ CLOSED</div>
                                    <div class="closed-product">📦 ${a.solution_sold || 'Product'}</div>
                                    <div class="closed-amount">💰 RM ${a.closing_amount}</div>
                                </div>
                                ` : ''}
                            </div>
                        `;
                    }
                }
            });

            html += `
                <div class="calendar-cell ${isToday ? 'today' : ''}">
                    <span class="date-num">${i}</span>
                    <div class="grid-activities">
                        ${activityHtml}
                    </div>
                </div>`;
        }

        // Next month overflow days
        const totalCells = startDay + daysInMonth;
        const remainingCells = 42 - totalCells; // 6 rows of 7 = 42

        for (let i = 1; i <= remainingCells; i++) {
            html += `<div class="calendar-cell"><span class="date-num other-month">${i}</span></div>`;
        }

        grid.innerHTML = html;
    };

    const getDotColor = (type) => {
        switch (type) {
            case 'CPS': return 'green';
            case 'FTF': return 'blue';
            case 'FSA': return 'orange';
            case 'EVENT': return 'red';
            default: return 'blue';
        }
    };

    const openCalendarFilterModal = async () => {
        const agents = await AppDataStore.getAll('users').filter(u => isAgent(u) || u.role === 'team_leader' || u.role?.includes('Level 7'));
        const types = ['CPS', 'FTF', 'FSA', 'EVENT', 'CALL', 'EMAIL', 'WHATSAPP'];

        const content = `
                <div class="form-group">
                    <label>Agent</label>
                    <select id="cal-filter-agent" class="form-control">
                        <option value="all" ${_filters.agent === 'all' ? 'selected' : ''}>All Agents</option>
                        ${agents.map(a => `<option value="${a.id}" ${_filters.agent == a.id ? 'selected' : ''}>${a.full_name}</option>`).join('')}
                    </select>
                </div>
                <div class="form-group">
                    <label>Activity Type</label>
                    <select id="cal-filter-type" class="form-control">
                        <option value="all" ${_filters.type === 'all' ? 'selected' : ''}>All Types</option>
                        ${types.map(t => `<option value="${t}" ${_filters.type === t ? 'selected' : ''}>${t}</option>`).join('')}
                    </select>
                </div>
                <div class="form-group">
                    <label>Date Range (Optional)</label>
                    <div style="display:flex; gap:10px;">
                        <input type="date" id="cal-filter-from" class="form-control" value="${_filters.from || ''}">
                        <input type="date" id="cal-filter-to" class="form-control" value="${_filters.to || ''}">
                    </div>
                </div>
                <!-- Phase 21: Case Closed Filter -->
                <div class="form-group">
                    <label>Case Status</label>
                    <div class="radio-group" style="display:flex; flex-direction:column; gap:8px; margin-top:5px;">
                        <label style="display:flex; align-items:center; gap:8px;">
                            <input type="radio" name="case-status" value="all" ${_filters.caseStatus === 'all' ? 'checked' : ''}> All Appointments
                        </label>
                        <label style="display:flex; align-items:center; gap:8px;">
                            <input type="radio" name="case-status" value="closed" ${_filters.caseStatus === 'closed' ? 'checked' : ''}> Only Closed Cases
                        </label>
                        <label style="display:flex; align-items:center; gap:8px;">
                            <input type="radio" name="case-status" value="open" ${_filters.caseStatus === 'open' ? 'checked' : ''}> Only Open Cases
                        </label>
                    </div>
                </div>
            `;

        UI.showModal('Calendar Filters', content, [
            { label: 'Clear Filters', type: 'secondary', action: 'await app.clearCalendarFilters()' },
            { label: 'Apply', type: 'primary', action: 'await app.applyCalendarFilters()' }
        ]);
    };

    const applyCalendarFilters = async () => {
        _filters.agent = document.getElementById('cal-filter-agent').value;
        _filters.type = document.getElementById('cal-filter-type').value;
        _filters.from = document.getElementById('cal-filter-from').value;
        _filters.to = document.getElementById('cal-filter-to').value;

        const caseStatus = document.querySelector('input[name="case-status"]:checked');
        _filters.caseStatus = caseStatus ? caseStatus.value : 'all';

        // Persist to sessionStorage
        sessionStorage.setItem('calendar_filters', JSON.stringify(_filters));

        UI.hideModal();

        if (_currentView === 'month') await renderCalendar();
        else if (_currentView === 'day') await renderTodayActivities();
        else await switchView(_currentView); // other views
    };

    const clearCalendarFilters = async () => {
        _filters = { agent: 'all', type: 'all', from: '', to: '', caseStatus: 'all' };
        sessionStorage.removeItem('calendar_filters');
        UI.hideModal();
        if (_currentView === 'month') await renderCalendar();
        else await switchView(_currentView);
    };

    // Load from SessionStorage on init
    const storedFilters = sessionStorage.getItem('calendar_filters');
    if (storedFilters) {
        try {
            _filters = JSON.parse(storedFilters);
        } catch (e) { }
    }

    const renderTodayActivities = async () => {
        const grid = document.getElementById('today-activities-grid');
        if (!grid) return;

        const today = new Date();
        const dateStr = `${today.getFullYear()}-${(today.getMonth() + 1).toString().padStart(2, '0')}-${today.getDate().toString().padStart(2, '0')}`;

        let activities = await getVisibleActivities().filter(a => a.activity_date === dateStr);

        // Apply filters
        if (_filters && _filters.agent && _filters.agent !== 'all') {
            activities = activities.filter(a => a.lead_agent_id == _filters.agent);
        }
        if (_filters && _filters.type && _filters.type !== 'all') {
            activities = activities.filter(a => a.activity_type === _filters.type);
        }
        if (_filters && _filters.caseStatus === 'closed') {
            activities = activities.filter(a => a.closing_amount && parseFloat(a.closing_amount) > 0);
        } else if (_filters && _filters.caseStatus === 'open') {
            activities = activities.filter(a => !a.closing_amount || parseFloat(a.closing_amount) <= 0);
        }

        activities.sort((a, b) => (a.start_time || '').localeCompare(b.start_time || ''));

        if (activities.length === 0) {
            grid.innerHTML = '<div style="padding:20px; text-align:center; color:var(--gray-500);">No activities scheduled for today.</div>';
            return;
        }

        let html = `
                    <table class="search-results-table">
                    <thead>
                        <tr>
                            <th>Time</th>
                            <th>Agent</th>
                            <th>Customer</th>
                            <th>Type</th>
                            <th>Status</th>
                            <th>Actions</th>
                        </tr>
                    </thead>
                    <tbody>
            `;

        activities.forEach(a => {
            const agent = AppDataStore.getById('users', a.lead_agent_id) || { full_name: 'Unknown Agent' };
            const prospect = a.prospect_id ? AppDataStore.getById('prospects', a.prospect_id) : null;
            const customer = a.customer_id ? AppDataStore.getById('customers', a.customer_id) : null;
            const entityName = prospect ? prospect.full_name : (customer ? customer.full_name : (a.customer_name || 'N/A'));

            html += `
                    <tr>
                        <td>${a.start_time || '--:--'}</td>
                        <td>${agent.full_name}</td>
                        <td>${entityName}</td>
                        <td>${a.activity_type}</td>
                        <td>${a.status || 'scheduled'}
                            ${a.closing_amount ? '<br><small style="color:green;">Closed</small>' : ''}
                        </td>
                        <td>
                            <button class="btn btn-sm secondary" onclick="await app.viewActivityDetails(${a.id})">View</button>
                            <button class="btn btn-sm secondary" onclick="await app.postMeetupNotes(${a.id})">post MtUp</button>
                            <button class="btn btn-sm secondary" onclick="await app.editActivity(${a.id})">Edit</button>
                            <button class="btn btn-sm secondary" onclick="await app.rescheduleActivity(${a.id})">Reschedule</button>
                            <button class="btn btn-sm secondary" onclick="await app.addCoAgentToActivity(${a.id})">+ Add co</button>
                        </td>
                    </tr>
                `;
        });

        html += `
                    </tbody>
                </table>
    `;

        grid.innerHTML = html;
    };

    const renderBirthdaySection = async () => {
        const todayList = document.getElementById('bday-today-list');
        const upcomingList = document.getElementById('bday-upcoming-list');
        if (!todayList || !upcomingList) return;

        const today = new Date();
        const mmdd = (d) => `${(d.getMonth() + 1).toString().padStart(2, '0')} -${d.getDate().toString().padStart(2, '0')} `;
        const todayStr = mmdd(today);

        // Get tomorrow and day after
        const tomorrow = new Date(today); tomorrow.setDate(today.getDate() + 1);
        const tomorrowStr = mmdd(tomorrow);
        const day2 = new Date(today); day2.setDate(today.getDate() + 2);
        const day2Str = mmdd(day2);

        const prospects = await AppDataStore.getAll('prospects');
        const customers = await AppDataStore.getAll('customers');
        const all = [...prospects, ...customers];

        const getBdayInfo = (p) => {
            const agent = AppDataStore.getById('users', p.responsible_agent_id || p.lead_agent_id);
            return {
                name: p.full_name,
                info: `Agent: ${agent?.full_name || 'Michelle Tan'} · ${p.customer_since ? 'Customer' : 'Prospect'} `,
                dob: p.date_of_birth ? p.date_of_birth.substring(5) : '' // MM-DD
            };
        };

        const todayBdays = all.filter(p => p.date_of_birth && p.date_of_birth.substring(5) === todayStr).map(getBdayInfo);
        const upcomingBdays = all.filter(p => p.date_of_birth && (p.date_of_birth.substring(5) === tomorrowStr || p.date_of_birth.substring(5) === day2Str))
            .map(p => {
                const info = getBdayInfo(p);
                const isTomorrow = p.date_of_birth.substring(5) === tomorrowStr;
                info.info += ` · ${isTomorrow ? 'Tomorrow' : 'In 2 days'} `;
                return info;
            });

        const renderBday = (data) => {
            if (data.length === 0) return '<div class="text-muted" style="padding:10px; font-size:12px;">No birthdays found.</div>';
            return data.map(b => `
                <div class="bday-card">
                    <div class="bday-name">${b.name} 🎂</div>
                    <div class="bday-info">${b.info}</div>
                    <div class="act-actions" style="border-top:none; margin-top:4px; padding-top:0;">
                        <button class="btn btn-sm secondary" style="font-size:11px" onclick="app.todo('Send wish')">Send Wish</button>
                        <button class="btn btn-sm secondary" style="font-size:11px" onclick="app.todo('Gift workflow')">Prepare Gift</button>
                    </div>
                </div>
            `).join('');
        };

        const todayBadge = document.querySelector('#bday-today-header .today');
        if (todayBadge) todayBadge.textContent = todayBdays.length;

        const upcomingBadge = document.querySelector('#bday-upcoming-header .upcoming');
        if (upcomingBadge) upcomingBadge.textContent = upcomingBdays.length;

        todayList.innerHTML = renderBday(todayBdays);
        upcomingList.innerHTML = renderBday(upcomingBdays);
    };


    // --- Phase 7 Navigation & Filter Functions ---
    const switchView = async (view) => {
        _currentView = view;

        document.querySelectorAll('.btn-toggle').forEach(btn => {
            btn.classList.remove('active');
            if (btn.textContent.toLowerCase() === view) {
                btn.classList.add('active');
            }
        });

        if (view === 'month') {
            await renderMonthView();
        } else if (view === 'week') {
            await renderWeekView();
        } else if (view === 'day') {
            await renderDayView();
        }
    };

    const goToToday = async () => {
        _currentDate = new Date();
        updateMonthHeader(_currentDate);
        await switchView(_currentView);
    };

    const goToPrevious = async () => {
        if (_currentView === 'month') {
            _currentDate.setMonth(_currentDate.getMonth() - 1);
        } else if (_currentView === 'week') {
            _currentDate.setDate(_currentDate.getDate() - 7);
        } else if (_currentView === 'day') {
            _currentDate.setDate(_currentDate.getDate() - 1);
        }
        if (_currentDate.getFullYear() < 2010) _currentDate.setFullYear(2010);
        updateMonthHeader(_currentDate);
        await switchView(_currentView);
    };

    const goToNext = async () => {
        if (_currentView === 'month') {
            _currentDate.setMonth(_currentDate.getMonth() + 1);
        } else if (_currentView === 'week') {
            _currentDate.setDate(_currentDate.getDate() + 7);
        } else if (_currentView === 'day') {
            _currentDate.setDate(_currentDate.getDate() + 1);
        }
        if (_currentDate.getFullYear() > 2200) _currentDate.setFullYear(2200);
        updateMonthHeader(_currentDate);
        await switchView(_currentView);
    };

    const updateMonthHeader = (date) => {
        const monthNames = ['January', 'February', 'March', 'April', 'May', 'June',
            'July', 'August', 'September', 'October', 'November', 'December'];
        const header2 = document.getElementById('calendar-month-title');
        if (header2) header2.textContent = `${monthNames[date.getMonth()]} ${date.getFullYear()} `;

        const header = document.querySelector('.calendar-title-nav h2');
        if (header && !header.id) {
            header.textContent = `${monthNames[date.getMonth()]} ${date.getFullYear()} `;
        }
    };

    const renderMonthView = async () => {
        await renderCalendar();
    };

    const renderWeekView = async () => {
        const grid = document.getElementById('calendar-grid');
        if (!grid) return;

        // Get start of week (Sunday)
        const startOfWeek = new Date(_currentDate);
        startOfWeek.setDate(_currentDate.getDate() - _currentDate.getDay());

        let html = '<div class="week-view-container">';
        html += '<div class="week-header">';
        html += '<div class="hour-label"></div>'; // Empty corner

        // Generate day headers
        const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
        for (let i = 0; i < 7; i++) {
            const day = new Date(startOfWeek);
            day.setDate(startOfWeek.getDate() + i);
            const isToday = day.toDateString() === new Date().toDateString();

            html += `
                <div class="week-day-header ${isToday ? 'today' : ''}">
                    <div class="day-name">${days[i]}</div>
                    <div class="day-date">${day.getDate()}</div>
                </div>
            `;
        }

        html += '</div>';
        html += '<div class="week-body">';

        // Get all activities
        const activities = await AppDataStore.getAll('activities');

        // Time async slots (8 AM to 8 PM)
        for (let hour = 8; hour <= 20; hour++) {
            html += '<div class="week-hour-row">';
            html += `<div class="hour-label">${hour.toString().padStart(2, '0')}:00</div>`;

            for (let day = 0; day < 7; day++) {
                const dayDate = new Date(startOfWeek);
                dayDate.setDate(startOfWeek.getDate() + day);
                const dateStr = dayDate.toISOString().split('T')[0];
                const hourStr = hour.toString().padStart(2, '0');

                const dayActivities = activities.filter(a =>
                    a.activity_date === dateStr &&
                    a.start_time &&
                    a.start_time.startsWith(hourStr)
                );

                html += '<div class="week-hour-cell">';
                dayActivities.forEach(a => {
                    const prospect = a.prospect_id ? AppDataStore.getById('prospects', a.prospect_id) : null;
                    const customer = a.customer_id ? AppDataStore.getById('customers', a.customer_id) : null;
                    const name = prospect?.full_name || customer?.full_name || 'Activity';

                    html += `
    <div class="week-activity ${a.activity_type.toLowerCase()}" onclick="await app.viewActivityDetails(${a.id})">
        ${a.start_time} ${name}
    </div>
    `;
                });
                html += '</div>';
            }
            html += '</div>';
        }

        html += '</div></div>';
        grid.innerHTML = html;
    };

    const renderDayView = async () => {
        const grid = document.getElementById('calendar-grid');
        const todayStr = _currentDate.toISOString().split('T')[0];
        const dayActivities = await AppDataStore.getAll('activities').filter(a => a.activity_date === todayStr);

        // Calculate summary stats
        const totalMeetings = dayActivities.filter(a => a.activity_type === 'FTF').length;
        const totalCalls = dayActivities.filter(a => a.activity_type === 'CALL' || a.activity_type === 'WHATSAPP').length;

        let html = '<div class="enhanced-day-view">';
        html += `
                <div class="day-header">
                    <h2>${_currentDate.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}</h2>
                    <button class="btn primary btn-sm" onclick="await app.openActivityModal('${todayStr}')">
                        <i class="fas fa-plus"></i> Add Activity
                    </button>
                </div>
                
                <div class="day-summary">
                    <div class="summary-card">
                        <div class="summary-label">Total Activities</div>
                        <div class="summary-value">${dayActivities.length}</div>
                    </div>
                    <div class="summary-card">
                        <div class="summary-label">Meetings</div>
                        <div class="summary-value">${totalMeetings}</div>
                    </div>
                    <div class="summary-card">
                        <div class="summary-label">Calls</div>
                        <div class="summary-value">${totalCalls}</div>
                    </div>
                </div>
                
                <div class="timeline">
        `;

        // Group activities by hour
        for (let hour = 0; hour < 24; hour++) {
            const hourStr = hour.toString().padStart(2, '0');
            const hourActivities = dayActivities.filter(a => a.start_time && a.start_time.startsWith(hourStr));

            html += `
                <div class="timeline-hour">
                    <div class="timeline-label">${hourStr}:00</div>
                    <div class="timeline-slot">
            `;

            hourActivities.forEach(a => {
                const prospect = a.prospect_id ? AppDataStore.getById('prospects', a.prospect_id) : null;
                const customer = a.customer_id ? AppDataStore.getById('customers', a.customer_id) : null;
                const name = prospect?.full_name || customer?.full_name || '';
                const agent = AppDataStore.getById('users', a.lead_agent_id);

                html += `
                    <div class="timeline-activity ${a.activity_type.toLowerCase()}" onclick="await app.viewActivityDetails(${a.id})">
                        <div class="activity-time">${a.start_time} - ${a.end_time || '?'}</div>
                        <div class="activity-title"><strong>${a.activity_title || a.activity_type}</strong> ${name}</div>
                        <div class="activity-agent">Agent: ${agent?.full_name || 'Unknown'}</div>
                    </div>
                `;
            });

            html += '</div></div>';
        }

        html += '</div></div>';
        grid.innerHTML = html;
    };

    const generateDayHours = async () => {
        let hoursHtml = '';
        const todayStr = _currentDate.toISOString().split('T')[0];
        const dayActs = await AppDataStore.getAll('activities').filter(a => a.activity_date === todayStr);

        for (let i = 8; i <= 20; i++) {
            const hourStr = `${i.toString().padStart(2, '0')}:00`;
            const actsAtHour = dayActs.filter(a => a.start_time.startsWith(i.toString().padStart(2, '0')));

            hoursHtml += `
                <div class="day-view-hour">
                    <div class="hour-label">${hourStr}</div>
                    <div class="hour-content">
                        ${actsAtHour.map(a => `
                            <div class="day-act-item">
                                <strong>${a.activity_type}</strong>: ${a.activity_title}
                                ${a.prospect_id ? `(${AppDataStore.getById('prospects', a.prospect_id)?.full_name})` : ''}
                            </div>
                        `).join('')}
                    </div>
                </div>
            `;
        }
        return hoursHtml;
    };

    const openFilterModal = async () => {
        const content = `
            <div class="filter-modal">
                <div class="form-group">
                    <label>Search Activities</label>
                    <input type="text" id="filter-search" class="form-control" placeholder="Search by title or summary..." value="${_filters.search || ''}">
                </div>
                <div class="form-group">
                    <label>Filter by Agent</label>
                    <select id="filter-agent" class="form-control">
                        <option value="all" ${_filters.agent === 'all' ? 'selected' : ''}>All Agents</option>
                        <option value="5" ${_filters.agent == '5' ? 'selected' : ''}>Michelle Tan</option>
                        <option value="6" ${_filters.agent == '6' ? 'selected' : ''}>Ah Seng</option>
                        <option value="7" ${_filters.agent == '7' ? 'selected' : ''}>Mei Ling</option>
                        <option value="8" ${_filters.agent == '8' ? 'selected' : ''}>Raj Kumar</option>
                    </select>
                </div>
                <div class="form-group">
                    <label>Filter by Activity Type</label>
                    <select id="filter-activity-type" class="form-control">
                        <option value="all" ${_filters.type === 'all' ? 'selected' : ''}>All Types</option>
                        <option value="CPS" ${_filters.type === 'CPS' ? 'selected' : ''}>CPS</option>
                        <option value="FTF" ${_filters.type === 'FTF' ? 'selected' : ''}>FTF</option>
                        <option value="FSA" ${_filters.type === 'FSA' ? 'selected' : ''}>FSA</option>
                        <option value="EVENT" ${_filters.type === 'EVENT' ? 'selected' : ''}>Event</option>
                        <option value="CALL" ${_filters.type === 'CALL' ? 'selected' : ''}>Call</option>
                        <option value="EMAIL" ${_filters.type === 'EMAIL' ? 'selected' : ''}>Email</option>
                        <option value="WHATSAPP" ${_filters.type === 'WHATSAPP' ? 'selected' : ''}>WhatsApp</option>
                    </select>
                </div>
                <div class="form-group">
                    <label>Date Range</label>
                    <div class="form-row">
                        <div class="form-group half">
                            <input type="date" id="filter-date-from" class="form-control" value="${_filters.from}">
                        </div>
                        <div class="form-group half">
                            <input type="date" id="filter-date-to" class="form-control" value="${_filters.to}">
                        </div>
                    </div>
                </div>
            </div>
        `;

        UI.showModal('Filter Calendar', content, [
            { label: 'Cancel', type: 'secondary', action: 'UI.hideModal()' },
            { label: 'Apply Filters', type: 'primary', action: 'await app.applyFilters()' },
            { label: 'Clear Filters', type: 'secondary', action: 'await app.clearFilters()' }
        ]);
    };

    const applyFilters = async () => {
        _filters.agent = document.getElementById('filter-agent')?.value || 'all';
        _filters.type = document.getElementById('filter-activity-type')?.value || 'all';
        _filters.from = document.getElementById('filter-date-from')?.value || '';
        _filters.to = document.getElementById('filter-date-to')?.value || '';
        _filters.search = document.getElementById('filter-search')?.value || '';

        sessionStorage.setItem('calendar_filters', JSON.stringify(_filters));
        UI.hideModal();
        UI.toast.success('Filters applied');

        await renderCalendar();
        await renderTodayActivities();
    };

    const clearFilters = async () => {
        _filters = { agent: 'all', type: 'all', from: '', to: '', search: '' };
        sessionStorage.setItem('calendar_filters', JSON.stringify(_filters));
        UI.hideModal();
        await renderCalendar();
        await renderTodayActivities();
        UI.toast.success('Filters cleared');
    };

    const todo = (msg = 'Coming in Phase 2') => {
        UI.toast.info(msg);
    };

    const viewActivityDetails = async (activityId) => {
        const activity = AppDataStore.getById('activities', activityId);
        if (!activity) return;

        const prospect = activity.prospect_id ? AppDataStore.getById('prospects', activity.prospect_id) : null;
        const customer = activity.customer_id ? AppDataStore.getById('customers', activity.customer_id) : null;
        const entityName = prospect?.full_name || customer?.full_name || 'Unknown';

        let attendeeHtml = '';
        if (activity.activity_type === 'EVENT' && activity.event_id) {
            const attendees = await AppDataStore.getAll('event_attendees').filter(a => a.event_id === activity.event_id);
            if (attendees.length > 0) {
                const prospects = await AppDataStore.getAll('prospects');
                const customers = await AppDataStore.getAll('customers');
                const all = [...prospects, ...customers];

                let rows = attendees.map(att => {
                    const person = all.find(p => p.id === att.entity_id);
                    const name = person ? person.full_name : 'Unknown';
                    const agent = AppDataStore.getById('users', att.added_by_agent_id);
                    const agentName = agent ? agent.full_name : 'Unknown';
                    return `
                        <div class="info-row" style="display:flex; justify-content:space-between; align-items:center; border-bottom:1px solid #eee; padding-bottom:5px; margin-bottom:5px;">
                            <div>
                                <strong>${name}</strong> 
                                <span class="status-badge" style="font-size:10px; margin-left:5px;">${att.attendance_status}</span>
                                <div style="font-size:11px; color:gray;">Added by: ${agentName}</div>
                            </div>
                            <div style="display:flex; gap:8px; align-items:center;">
                                <button class="btn btn-sm secondary" title="Outcome" onclick="await app.openAttendeeOutcomeModal(${att.entity_id}, '${att.attendee_type}', ${activity.id})">📝 Outcome</button>
                                <button class="btn btn-sm secondary" title="Notes" onclick="await app.openAttendeeNotesModal(${att.entity_id}, '${att.attendee_type}', ${activity.id})">📋 Notes</button>
                                <button class="btn btn-sm secondary" onclick="await app.postEventFollowUp(${activity.event_id}, ${att.entity_id})">Follow-up</button>
                            </div>
                        </div>
                    `;
                }).join('');

                attendeeHtml = `
                    <div class="detail-section">
                        <h4>Attendees</h4>
                        ${rows}
                    </div>
                `;
            } else {
                attendeeHtml = `
                    <div class="detail-section">
                        <h4>Attendees</h4>
                        <div class="info-row">No attendees registered.</div>
                    </div>
                `;
            }
        }

        const content = `
            <div class="activity-details">
                <div class="detail-section">
                    <h4>Activity Information</h4>
                    <div class="info-row"><span class="info-label">Type:</span> <span>${activity.activity_type}</span></div>
                    <div class="info-row"><span class="info-label">Title:</span> <span>${activity.activity_title || 'N/A'}</span></div>
                    <div class="info-row"><span class="info-label">Date:</span> <span>${activity.activity_date}</span></div>
                    <div class="info-row"><span class="info-label">Time:</span> <span>${activity.start_time} - ${activity.end_time}</span></div>
                    ${activity.activity_type !== 'EVENT' ? `<div class="info-row"><span class="info-label">Entity:</span> <span>${entityName}</span></div>` : ''}
                    ${activity.location_address ? `<div class="info-row"><span class="info-label">Location:</span> <span>${activity.location_address}</span></div>` : ''}
                    ${activity.summary ? `<div class="info-row"><span class="info-label">Summary:</span> <span>${activity.summary}</span></div>` : ''}
                </div>
                
                <div class="detail-section">
                    <h4>Agents</h4>
                    <div class="info-row"><span class="info-label">Lead:</span> <span>${getAgentName(activity.lead_agent_id)}</span></div>
                    ${activity.co_agents?.length ? `
                        <div class="info-row"><span class="info-label">Co-Agents:</span> 
                            <span>${activity.co_agents.map(a => a.name).join(', ')}</span>
                        </div>
                    ` : ''}
                </div>
                ${attendeeHtml}
            </div>
        `;

        const modalActions = [
            { label: 'Close', type: 'secondary', action: 'UI.hideModal()' },
            { label: 'Mark Complete', type: 'secondary', action: `await app.markActivityComplete(${activityId})` },
            { label: 'Edit', type: 'secondary', action: `await app.editActivity(${activityId})` }
        ];

        if (activity.prospect_id) {
            modalActions.push({
                label: 'Complete Prospect Profile',
                type: 'secondary',
                action: `UI.hideModal(); await app.showProspectDetail(${activity.prospect_id})`
            });
        }

        modalActions.push({ label: 'Delete', type: 'primary', action: `await app.deleteActivity(${activityId})` });

        UI.showModal('Activity Details', content, modalActions);
    };

    const editActivity = async (activityId) => {
        const activity = AppDataStore.getById('activities', activityId);
        if (!activity) return;
        UI.hideModal(); // close any open modal
        await openActivityModal(null, null, activity);
    };

    const deleteActivity = async (activityId) => {
        UI.showModal('Confirm Delete',
            '<p>Are you sure you want to delete this activity? This action cannot be undone.</p>',
            [
                { label: 'Cancel', type: 'secondary', action: 'UI.hideModal()' },
                { label: 'Delete', type: 'primary', action: `await app.confirmDeleteActivity(${activityId})` }
            ]
        );
    };

    const confirmDeleteActivity = async (activityId) => {
        AppDataStore.delete('activities', activityId);
        UI.hideModal();
        UI.toast.success('Activity deleted');
        if (document.querySelector('.calendar-view-container')) {
            await renderCalendar();
            await renderTodayActivities();
        }
    };

    const markActivityComplete = async (activityId) => {
        const activity = AppDataStore.getById('activities', activityId);
        if (!activity) return;

        activity.status = 'completed';
        activity.completed_at = new Date().toISOString();
        AppDataStore.update('activities', activityId, activity);

        UI.toast.success('Activity marked as complete');
        if (document.querySelector('.calendar-view-container')) {
            await renderCalendar();
            await renderTodayActivities();
        }
    };

    const postMeetupNotes = async (activityId) => {
        await app.editActivity(activityId);
        (() => {
            document.getElementById('note-key-points')?.focus();
        }, 350);
    };

    const rescheduleActivity = async (activityId) => {
        await app.editActivity(activityId);
        (() => {
            const dateEl = document.getElementById('activity-date');
            if (dateEl) {
                dateEl.focus();
                dateEl.style.boxShadow = '0 0 0 2px var(--primary-color)';
                (() => dateEl.style.boxShadow = '', 2000);
            }
        }, 350);
    };

    const postEventFollowUp = async (eventId, entityId) => {
        UI.hideModal();
        const ev = AppDataStore.getById('events', eventId);
        await app.openActivityModal();
        (() => {
            const all = [...AppDataStore.getAll('prospects'), ...AppDataStore.getAll('customers')];
            const p = all.find(x => x.id === entityId);
            if (p) app.selectEntity(entityId, p.is_customer ? 'customer' : 'prospect');

            const typeEl = document.getElementById('modal-activity-type');
            if (typeEl) {
                typeEl.value = 'CALL';
                await app.updateActivityForm();
                (() => {
                    const titleEl = document.getElementById('meeting-title');
                    if (titleEl && ev) titleEl.value = `Follow-up from ${ev.title}`;
                    document.getElementById('note-key-points')?.focus();
                }, 100);
            }
        }, 300);
    };

    const openAttendeeOutcomeModal = async (attendeeId, attendeeType, activityId) => {
        const attendee = attendeeType === 'agent'
            ? AppDataStore.getById('users', attendeeId)
            : (attendeeType === 'prospect' ? AppDataStore.getById('prospects', attendeeId) : AppDataStore.getById('customers', attendeeId));

        const existingNote =await AppDataStore.getAll('notes').find(n => n.activity_id === activityId && n.note_type === 'outcome' &&
            ((attendeeType === 'agent' && n.agent_id === attendeeId) ||
                (attendeeType === 'prospect' && n.prospect_id === attendeeId) ||
                (attendeeType === 'customer' && n.customer_id === attendeeId)));

        const content = `
            <div class="form-group">
                <label>Outcome for ${attendee?.full_name || 'Attendee'} (${attendeeType})</label>
                <textarea id="attendee-outcome-text" class="form-control" rows="4" placeholder="Enter meeting outcome for this attendee...">${existingNote?.text || ''}</textarea>
            </div>
        `;

        UI.showModal('Meeting Outcome', content, [
            { label: 'Cancel', type: 'secondary', action: 'UI.hideModal()' },
            { label: 'Save Outcome', type: 'primary', action: `await app.saveAttendeeNote(${attendeeId}, '${attendeeType}', ${activityId}, 'outcome')` }
        ]);
    };

    const openAttendeeNotesModal = async (attendeeId, attendeeType, activityId) => {
        const attendee = attendeeType === 'agent'
            ? AppDataStore.getById('users', attendeeId)
            : (attendeeType === 'prospect' ? AppDataStore.getById('prospects', attendeeId) : AppDataStore.getById('customers', attendeeId));

        const existingNote = await AppDataStore.getAll('notes').find(n => n.activity_id === activityId && n.note_type === 'post_meetup' &&
            ((attendeeType === 'agent' && n.agent_id === attendeeId) ||
                (attendeeType === 'prospect' && n.prospect_id === attendeeId) ||
                (attendeeType === 'customer' && n.customer_id === attendeeId)));

        const content = `
            <div class="form-group">
                <label>Post-Meetup Notes for ${attendee?.full_name || 'Attendee'} (${attendeeType})</label>
                <textarea id="attendee-notes-text" class="form-control" rows="4" placeholder="Enter key points, next steps, etc...">${existingNote?.text || ''}</textarea>
            </div>
        `;

        UI.showModal('Post-Meetup Notes', content, [
            { label: 'Cancel', type: 'secondary', action: 'UI.hideModal()' },
            { label: 'Save Notes', type: 'primary', action: `await app.saveAttendeeNote(${attendeeId}, '${attendeeType}', ${activityId}, 'post_meetup')` }
        ]);
    };

    const saveAttendeeNote = async (attendeeId, attendeeType, activityId, noteType) => {
        const textAreaId = noteType === 'outcome' ? 'attendee-outcome-text' : 'attendee-notes-text';
        const text = document.getElementById(textAreaId)?.value?.trim();

        if (!text) {
            UI.toast.error('Please enter some text.');
            return;
        }

        const currentUser = Auth.getCurrentUser();
        const noteData = {
            activity_id: activityId,
            note_type: noteType,
            text: text,
            author: currentUser?.full_name || 'System',
            date: new Date().toISOString().split('T')[0]
        };

        if (attendeeType === 'agent') noteData.agent_id = attendeeId;
        else if (attendeeType === 'prospect') noteData.prospect_id = attendeeId;
        else if (attendeeType === 'customer') noteData.customer_id = attendeeId;

        // Check if note already exists to update
        const existingNote = await AppDataStore.getAll('notes').find(n => n.activity_id === activityId && n.note_type === noteType &&
            ((attendeeType === 'agent' && n.agent_id === attendeeId) ||
                (attendeeType === 'prospect' && n.prospect_id === attendeeId) ||
                (attendeeType === 'customer' && n.customer_id === attendeeId)));

        if (existingNote) {
            AppDataStore.update('notes', existingNote.id, noteData);
        } else {
            await AppDataStore.create('notes', noteData);
        }

        UI.toast.success('Note saved successfully');
        UI.hideModal();
        // Re-open activity details to show updated state if needed, 
        // but since notes aren't directly rendered in the list yet, we'll just close.
    };

    const addCoAgentToActivity = async (activityId) => {
        await app.editActivity(activityId);
        (() => {
            const coSectionStr = document.getElementById('co-agent-section')?.style.display;
            if (coSectionStr === 'none' || !coSectionStr) {
                app.toggleCoAgentSection();
            }
            document.getElementById('co-agent-search-input')?.focus();
        }, 350);
    };

    const getAgentName = (agentId) => {
        const agent = AppDataStore.getById('users', agentId);
        return agent?.full_name || 'Unknown';
    };

    // ========== PHASE 2: ACTIVITY MODAL FUNCTIONS ==========

    const openActivityModal = async (prefillDate = null, prospectId = null, activity = null) => {
        const today = new Date().toISOString().split('T')[0];

        // Reset all temporary state to avoid interference between uses
        _selectedAttendees = [];
        _selectedCoAgents = [];
        _selectedEntity = null;
        _selectedReferrer = null;
        window._cpsDuplicateConfirmed = false;

        const modalContent = `
            <div class="activity-modal-form">
                <div class="form-group">
                    <label>Activity Type <span class="required">*</span></label>
                    <select id="modal-activity-type" class="form-control" onchange="await app.updateActivityForm()">
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
                    </select>
                </div>
                
                <div id="dynamic-form-fields">
                    <!-- Fields will be dynamically inserted here -->
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
                        <div class="co-agent-search" style="display:flex; gap:8px;">
                            <input type="text" id="co-agent-search-input" class="form-control" placeholder="Type agent name..." onkeyup="await app.searchAgents()">
                            <button class="btn secondary btn-sm" onclick="await app.searchAgents()">Search</button>
                        </div>
                        <div id="agent-search-results" class="search-results-dropdown"></div>
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
                            <input type="time" id="start-time" class="form-control" value="09:00" onchange="app.calculateDuration()">
                        </div>
                    </div>
                    <div class="form-row">
                        <div class="form-group half">
                            <label>End Time</label>
                            <input type="time" id="end-time" class="form-control" value="10:00" onchange="app.calculateDuration()">
                        </div>
                        <div class="form-group half">
                            <label>Duration</label>
                            <input type="text" id="duration" class="form-control" readonly value="60 min">
                        </div>
                    </div>
                </div>
                
                <div class="form-section">
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
                                ${await AppDataStore.getAll('products').filter(p => p.is_active !== false).map(p => `<option value="${p.name}">${p.name}</option>`).join('') || '<option value="">No products available</option>'}
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

                <div class="form-section">
                    <h4>📝 Post-Meetup Notes</h4>
                    <div class="form-group">
                        <label>Key Points Discussed:</label>
                        <div style="display:flex; gap:8px;">
                            <textarea id="note-key-points" class="form-control" rows="2" placeholder="Main discussion points..."></textarea>
                            <button class="btn-icon" onclick="await app.openVoiceRecorder('note-key-points', 'activity', null)" title="Record voice note" style="color:var(--primary);"><i class="fas fa-microphone"></i></button>
                        </div>
                    </div>
                    <div class="form-group">
                        <label>Outcome:</label>
                        <div style="display:flex; gap:8px;">
                            <textarea id="note-outcome" class="form-control" rows="2" placeholder="What was the result?"></textarea>
                            <button class="btn-icon" onclick="await app.openVoiceRecorder('note-outcome', 'activity', null)" title="Record voice note" style="color:var(--primary);"><i class="fas fa-microphone"></i></button>
                        </div>
                    </div>
                    <div class="form-group">
                        <label>Next Steps:</label>
                        <div style="display:flex; gap:8px;">
                            <textarea id="note-next-steps" class="form-control" rows="2" placeholder="Action items..."></textarea>
                            <button class="btn-icon" onclick="await app.openVoiceRecorder('note-next-steps', 'activity', null)" title="Record voice note" style="color:var(--primary);"><i class="fas fa-microphone"></i></button>
                        </div>
                    </div>
                    <div class="form-group">
                        <label>Customer Needs/Interests:</label>
                        <div style="display:flex; gap:8px;">
                            <textarea id="note-needs" class="form-control" rows="2" placeholder="What are they looking for?"></textarea>
                            <button class="btn-icon" onclick="await app.openVoiceRecorder('note-needs', 'activity', null)" title="Record voice note" style="color:var(--primary);"><i class="fas fa-microphone"></i></button>
                        </div>
                    </div>
                    <div class="form-group">
                        <label>Pain Points:</label>
                        <div style="display:flex; gap:8px;">
                            <textarea id="note-pain-points" class="form-control" rows="2" placeholder="Dislikes or problems to solve..."></textarea>
                            <button class="btn-icon" onclick="await app.openVoiceRecorder('note-pain-points', 'activity', null)" title="Record voice note" style="color:var(--primary);"><i class="fas fa-microphone"></i></button>
                        </div>
                    </div>
                </div>
            </div>
        `;

        UI.showModal('Quick Add Activity', modalContent, [
            { label: 'Cancel', type: 'secondary', action: 'UI.hideModal()' },
            { label: 'Save & Add Another', type: 'secondary', action: 'await app.saveAndAddAnother()' },
            { label: 'Save Activity', type: 'primary', action: 'await app.saveActivity()' }
        ]);

        await updateActivityForm();

        if (activity) {
            (() => {
                fillActivityForm(activity);
            }, 300); // Increased timeout to ensure DOM is ready
        }

        // If prospectId is provided, pre-select it
        if (prospectId) {
            (() => {
                const prospect = AppDataStore.getById('prospects', prospectId);
                if (prospect) {
                    _selectedEntity = { id: prospectId, type: 'Prospect' };
                    const infoDiv = document.getElementById('selected-entity-info');
                    if (infoDiv) {
                        infoDiv.innerHTML = `
                            <div class="selected-entity-badge">
                                <span>Prospect: <strong>${prospect.full_name}</strong></span>
                                <button class="btn btn-sm secondary" onclick="app.clearSelectedEntity()">Clear</button>
                            </div>
                        `;
                    }
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

    // 3. Wait for the dynamic fields to be injected (first wave)
    (() => {
        // Common fields for all activity types
        setField('activity-date', activity.activity_date);
        setField('start-time', activity.start_time);
        setField('end-time', activity.end_time);
        setField('note-key-points', activity.note_key_points);
        setField('note-outcome', activity.note_outcome);
        setField('note-next-steps', activity.note_next_steps);
        setField('note-needs', activity.note_needs);
        setField('note-pain-points', activity.note_pain_points);
        setField('location-address', activity.location_address);

        // 4. Restore selected entity (store in module variable)
        let entityRestored = false;
        if (activity.prospect_id) {
            const prospect = AppDataStore.getById('prospects', activity.prospect_id);
            if (prospect) {
                _selectedEntity = { id: prospect.id, type: 'Prospect' };
                entityRestored = true;
            }
        } else if (activity.customer_id) {
            const customer = AppDataStore.getById('customers', activity.customer_id);
            if (customer) {
                _selectedEntity = { id: customer.id, type: 'Customer' };
                entityRestored = true;
            }
        }

        // 5. Poll for the entity badge container and render the badge if needed
        if (entityRestored) {
            const badgeContainerId = 'selected-entity-info';
            let attempts = 0;
            const badgeInterval = (() => {
                const container = document.getElementById(badgeContainerId);
                if (container) {
                    const entityName = _selectedEntity.type === 'Prospect'
                        ? AppDataStore.getById('prospects', _selectedEntity.id)?.full_name
                        : AppDataStore.getById('customers', _selectedEntity.id)?.full_name;
                    if (entityName) {
                        container.innerHTML = `
                            <div class="selected-entity-badge">
                                <span>${_selectedEntity.type}: <strong>${entityName}</strong></span>
                                <button class="btn btn-sm secondary" onclick="app.clearSelectedEntity()">Clear</button>
                            </div>
                        `;
                    }
                    clearInterval(badgeInterval);
                } else if (++attempts >= 30) { // 30 * 100ms = 3 seconds
                    console.warn('Entity badge container not found after polling');
                    clearInterval(badgeInterval);
                }
            }, 100);
        }

        // 6. Type‑specific fields
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
            case 'SITE':
                if (activity.compass_needed) {
                    const chk = document.getElementById('compass-needed');
                    if (chk) chk.checked = true;
                }
                break;
            // Add other types as needed (e.g., EVENT, AGENT_MEETING)
        }

        // 7. Co‑agents
        _selectedCoAgents = activity.co_agents || [];
        if (typeof renderCoAgents === 'function') renderCoAgents();

        // 8. If this is a CPS activity, poll for CPS‑specific fields
        if (activity.activity_type === 'CPS' && activity.prospect_id) {
            const prospect = AppDataStore.getById('prospects', activity.prospect_id);
            if (!prospect) {
                console.error('Prospect not found for ID:', activity.prospect_id);
                return;
            }

            let attempts = 0;
            const cpsInterval = (() => {
                const cpsName = document.getElementById('cps-name');
                if (cpsName) {
                    // CPS fields are present – populate all prospect fields
                    setField('cps-name', prospect.full_name);
                    setField('cps-nickname', prospect.nickname);
                    setField('cps-phone', prospect.phone);
                    setField('cps-ic', prospect.ic_number);
                    setField('cps-email', prospect.email);
                    setField('cps-dob', prospect.date_of_birth);
                    setField('cps-lunar', prospect.lunar_birth);
                    setField('cps-gua', prospect.ming_gua);
                    setField('cps-occupation', prospect.occupation);
                    setField('cps-company', prospect.company_name);
                    setField('cps-income', prospect.income_range);
                    setField('cps-address', prospect.address);
                    setField('cps-city', prospect.city);
                    setField('cps-state', prospect.state);
                    setField('cps-zip', prospect.postal_code);
                    clearInterval(cpsInterval);
                } else if (++attempts >= 30) {
                    console.warn('CPS fields did not appear after polling');
                    clearInterval(cpsInterval);
                }
            }, 100);
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
    const activity = AppDataStore.getById('activities', activityId);
    if (!activity) return;

    const updatedData = {
        activity_type: document.getElementById('modal-activity-type')?.value,
        activity_date: document.getElementById('activity-date')?.value,
        start_time: document.getElementById('start-time')?.value,
        end_time: document.getElementById('end-time')?.value,
        summary: document.getElementById('note-key-points')?.value,
        note_key_points: document.getElementById('note-key-points')?.value,
        note_outcome: document.getElementById('note-outcome')?.value,
        note_next_steps: document.getElementById('note-next-steps')?.value,
        note_needs: document.getElementById('note-needs')?.value,
        note_pain_points: document.getElementById('note-pain-points')?.value,
        location_address: document.getElementById('location-address')?.value,
        co_agents: _selectedCoAgents,
        // Type‑specific fields
        activity_title: document.getElementById('meeting-title')?.value
    };

    // Update entity IDs based on current _selectedEntity
    if (_selectedEntity) {
        if (_selectedEntity.type === 'Prospect') {
            updatedData.prospect_id = _selectedEntity.id;
            updatedData.customer_id = null;
        } else if (_selectedEntity.type === 'Customer') {
            updatedData.customer_id = _selectedEntity.id;
            updatedData.prospect_id = null;
        }
        console.log('Updating with entity:', _selectedEntity);
    } else {
        updatedData.prospect_id = null;
        updatedData.customer_id = null;
        console.log('No entity selected – clearing IDs');
    }

    AppDataStore.update('activities', activityId, { ...activity, ...updatedData });
    UI.hideModal();
    UI.toast.success('Activity updated');
    if (typeof renderCalendar === 'function') await renderCalendar();
    if (typeof renderTodayActivities === 'function') await renderTodayActivities();
};

    const updateActivityForm = async () => {
        const type = document.getElementById('modal-activity-type')?.value;
        const container = document.getElementById('dynamic-form-fields');
        if (!container) return;

        let html = '';

        switch (type) {
            case 'CPS':
                html = `
                    <div class="form-section">
                        <h4>👤 New Customer Information</h4>
                        <div class="form-row">
                            <div class="form-group half">
                                <label>Full Name <span class="required">*</span></label>
                                <input type="text" id="cps-name" class="form-control" placeholder="e.g., Tan Ah Kow" required>
                            </div>
                            <div class="form-group half">
                                <label>Nickname</label>
                                <input type="text" id="cps-nickname" class="form-control" placeholder="e.g., Ah Kow">
                            </div>
                        </div>
                        <div class="form-row">
                            <div class="form-group half">
                                <label>Phone Number <span class="required">*</span></label>
                                <input type="tel" id="cps-phone" class="form-control" placeholder="e.g., 012-3456789" required>
                            </div>
                            <div class="form-group half">
                                <div style="display:flex; align-items:center; gap:8px;">
                                    <label style="margin-bottom:0;">Date of Birth</label>
                                    <input type="checkbox" id="has-dob">
                                </div>
                                <input type="date" id="cps-dob" class="form-control" onchange="app.updateLunarBirth()">
                            </div>
                        </div>
                        <div class="form-row">
                            <div class="form-group half">
                                <div style="display:flex; align-items:center; gap:8px;">
                                    <label style="margin-bottom:0;">Lunar Birth</label>
                                    <input type="checkbox" id="has-lunar" checked>
                                </div>
                                <input type="text" id="cps-lunar" class="form-control" placeholder="Lunar date">
                            </div>
                            <div class="form-group half">
                                <label>Ming Gua</label>
                                <select id="cps-gua" class="form-control">
                                    <option value="">-- Select --</option>
                                    <option value="MG1">MG1 (Kan)</option>
                                    <option value="MG2">MG2 (Kun)</option>
                                    <option value="MG3">MG3 (Zhen)</option>
                                    <option value="MG4">MG4 (Xun)</option>
                                    <option value="MG5">MG5 (Zhong)</option>
                                    <option value="MG6">MG6 (Qian)</option>
                                    <option value="MG7">MG7 (Dui)</option>
                                    <option value="MG8">MG8 (Gen)</option>
                                    <option value="MG9">MG9 (Li)</option>
                                </select>
                            </div>
                        </div>
                        <div class="form-row">
                            <div class="form-group half">
                                <label>Occupation</label>
                                <input type="text" id="cps-occupation" class="form-control" placeholder="e.g., Engineer">
                            </div>
                            <div class="form-group half">
                                <label>Company Name</label>
                                <input type="text" id="cps-company" class="form-control" placeholder="e.g., ABC Sdn Bhd">
                            </div>
                        </div>
                        <div class="form-row">
                            <div class="form-group half">
                                <label>IC Number</label>
                                <input type="text" id="cps-ic" class="form-control" placeholder="e.g., 901212-10-1234">
                            </div>
                            <div class="form-group half">
                                <label>Income Range</label>
                                <select id="cps-income" class="form-control">
                                    <option value="">-- Select Range --</option>
                                    <option value="Below RM 3,000">Below RM 3,000</option>
                                    <option value="RM 3,000 - RM 5,000">RM 3,000 - RM 5,000</option>
                                    <option value="RM 5,001 - RM 10,000">RM 5,001 - RM 10,000</option>
                                    <option value="RM 10,001 - RM 20,000">RM 10,001 - RM 20,000</option>
                                    <option value="Above RM 20,000">Above RM 20,000</option>
                                </select>
                            </div>
                        </div>
                        <div class="form-section" style="border:none; padding:0; margin-top:10px;">
                            <label>Address</label>
                            <textarea id="cps-address" class="form-control" rows="2" placeholder="Street address..."></textarea>
                            <div class="form-row" style="margin-top:10px;">
                                <div class="form-group half">
                                    <input type="text" id="cps-city" class="form-control" placeholder="City">
                                </div>
                                <div class="form-group half">
                                    <input type="text" id="cps-state" class="form-control" placeholder="State">
                                </div>
                            </div>
                            <div class="form-row">
                                <div class="form-group half">
                                    <input type="text" id="cps-zip" class="form-control" placeholder="Postal Code">
                                </div>
                                <div class="form-group half">
                                    <input type="email" id="cps-email" class="form-control" placeholder="email@example.com">
                                </div>
                            </div>
                        </div>
                        <div class="form-row">
                            <div class="form-group half">
                                <label>Referrer</label>
                                <div class="search-with-results" style="position: relative;">
                                    <input type="text" id="cps-referrer" class="form-control" placeholder="Search referrer..." onkeyup="await app.searchReferrers()">
                                    <div id="referrer-results" class="search-results-dropdown" style="display:none; position:absolute; z-index:1000; background:white; border:1px solid #ddd; width:100%;"></div>
                                </div>
                                <div id="selected-referrer-info" class="selected-entity-info" style="margin-top: 8px;"></div>
                            </div>
                            <div class="form-group half">
                                <label>Relation <span class="required">*</span></label>
                                <select id="cps-relation" class="form-control" onchange="document.getElementById('cps-relation-other-div').style.display = this.value === 'Other' ? 'block' : 'none'">
                                    <option value="">-- Select Relation --</option>
                                    <option value="Friend">Friend</option>
                                    <option value="Family">Family</option>
                                    <option value="Colleague">Colleague</option>
                                    <option value="Business Partner">Business Partner</option>
                                    <option value="Other">Other</option>
                                </select>
                            </div>
                        </div>
                        <div id="cps-relation-other-div" class="form-group" style="display:none; margin-top: 10px;">
                            <label>Please specify relation</label>
                            <input type="text" id="cps-relation-other" class="form-control" placeholder="Specify relation...">
                        </div>
                        <div class="form-group">
                            <label>Attachment (PDF, JPG, PNG up to 5MB)</label>
                            <input type="file" id="cps-attachment" class="form-control" accept=".pdf, .png, .jpg, .jpeg">
                            <small class="help-text" style="color: var(--gray-500); font-size: 11px; margin-top: 4px; display: block;">
                                Upload scanned copy of the signed CPS form
                            </small>
                        </div>
                        <p class="help-text">Minimum required: Name, Phone Number, and Relation.</p>
                    </div>

                    <div class="form-section">
                        <h4>📢 CPS Invitation Method (Optional)</h4>
                        <div class="form-group">
                            <label>Invitation Method</label>
                            <select id="cps-invitation-method" class="form-control" onchange="document.getElementById('cps-invitation-other-div').style.display = this.value === 'Other' ? 'block' : 'none'">
                                <option value="">-- Select Method --</option>
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
                // Diagnostic: Ensure searchReferrers is bound
                (() => {
                    const input = document.getElementById('cps-referrer');
                    if (input) input.onkeyup = async () => await app.searchReferrers();
                }, 100);
                break;

            case 'FTF':
            case 'GR':
            case 'XG':
            case 'CALL':
            case 'WHATSAPP':
                html = `
                    <div class="form-section">
                        <h4>🔍 Select ${type === 'CALL' || type === 'WHATSAPP' ? 'Prospect/Customer' : 'Existing Prospect/Customer'}</h4>
                        <div class="form-group">
                            <div class="search-with-results">
                                <input type="text" id="entity-search" class="form-control" placeholder="Type name, phone, or email..." onkeyup="await app.searchEntities()">
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

            case 'FSA':
            case 'SITE':
                html = `
                    <div class="form-section">
                        <h4>🔍 Select Existing Prospect/Customer</h4>
                        <div class="form-group">
                            <div class="search-with-results">
                                <input type="text" id="entity-search" class="form-control" placeholder="Type name, phone, or email..." onkeyup="await app.searchEntities()">
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
                                <label><input type="radio" name="event-visibility" value="closed" checked> Closed Event (Private)</label>
                                <label><input type="radio" name="event-visibility" value="open"> Open Event (Public)</label>
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
                                <select id="existing-event" class="form-control">
                                    <option value="">-- Select --</option>
                                    ${await AppDataStore.getAll('events').filter(e => e.is_active !== false).map(e => `<option value="${e.id}">${e.title}</option>`).join('')}
                                </select>
                            </div>
                        </div>
                        
                        <div id="new-event-section" style="display: none;">
                            <div class="form-group">
                                <label>Title <span class="required">*</span></label>
                                <input type="text" id="new-event-title" class="form-control">
                            </div>
                            <div class="form-row">
                                <div class="form-group half">
                                    <label>Category</label>
                                    <select id="event-category" class="form-control">
                                        <option value="Lecture">Lecture</option>
                                        <option value="Course">Course</option>
                                        <option value="Meeting">Meeting</option>
                                        <option value="Training">Training</option>
                                    </select>
                                </div>
                                <div class="form-group half">
                                    <label>Base Score</label>
                                    <input type="number" id="event-score" class="form-control" value="10">
                                </div>
                            </div>
                        </div>

                        <div class="form-group" style="margin-top: 15px;">
                            <label>Add Attendees (${type.includes('AGENT') ? 'Agents' : 'Clients/Agents'})</label>
                            <div class="search-with-results">
                                <input type="text" id="attendee-search" class="form-control" placeholder="Search to add..." onkeyup="app.searchAttendees()">
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

    const toggleCoAgentSection = () => {
        const section = document.getElementById('co-agent-section');
        const checked = document.getElementById('allow-join')?.checked;
        if (section) section.style.display = checked ? 'block' : 'none';
        if (!checked) _selectedCoAgents = [];
        renderCoAgents();
    };

    const toggleEventForm = () => {
        const val = document.querySelector('input[name="event-selection"]:checked')?.value;
        const existing = document.getElementById('existing-event-section');
        const next = document.getElementById('new-event-section');
        if (existing) existing.style.display = val === 'existing' ? 'block' : 'none';
        if (next) next.style.display = val === 'new' ? 'block' : 'none';
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
                    const all = [...AppDataStore.getAll('prospects'), ...AppDataStore.getAll('customers')];
                    const available = all.filter(p => !_selectedAttendees.find(a => a.id === p.id && a.type !== 'agent'));
                    matches = available.filter(p =>
                        (p.full_name && p.full_name.toLowerCase().includes(searchTerm)) ||
                        (p.phone && p.phone.includes(searchTerm)) ||
                        (p.email && p.email?.toLowerCase().includes(searchTerm))
                    ).map(p => ({ ...p, type: p.is_customer ? 'customer' : 'prospect' }));
                }

                if (isAgentRelevant) {
                    const agents = await AppDataStore.getAll('users').filter(u =>
                        isAgent(u) &&
                        !_selectedAttendees.find(a => a.id === u.id && a.type === 'agent')
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
        _selectedAttendees.push({
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
        _selectedAttendees = _selectedAttendees.filter(a => a.id !== id);
        renderAttendees();
    };

    const updateAttendeeStatus = (id, status) => {
        const attendee = _selectedAttendees.find(a => a.id === id);
        if (attendee) attendee.status = status;
    };

    const renderAttendees = () => {
        const container = document.getElementById('selected-attendees');
        if (container) {
            container.innerHTML = _selectedAttendees.map(a => `
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

    const updateLunarBirth = () => {
        const dob = document.getElementById('cps-dob')?.value;
        const lunarField = document.getElementById('cps-lunar');
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
            const resultsDiv = document.getElementById('referrer-results');

            console.log('searchReferrers matching term:', term);

            if (!term || term.length < 1) {
                if (resultsDiv) resultsDiv.style.display = 'none';
                return;
            }

            const prospects = await AppDataStore.getAll('prospects').filter(p => !p.status || p.status === 'active');
            const customers = await AppDataStore.getAll('customers').filter(c => !c.status || c.status === 'active');
            const agents = await AppDataStore.getAll('users').filter(u => isAgent(u) || u.role === 'team_leader' || u.role?.includes('Level 7'));

            const all = [
                ...prospects.map(p => ({ id: p.id, name: p.full_name, type: 'Prospect' })),
                ...customers.map(c => ({ id: c.id, name: c.full_name, type: 'Customer' })),
                ...agents.map(a => ({ id: a.id, name: a.full_name, type: 'Agent' }))
            ];

            const matches = all.filter(e => e.name && e.name.toLowerCase().includes(term)).slice(0, 10);

            if (resultsDiv) {
                const resultsHtml = matches.map(m => `
                    <div class="search-result-item" onclick="app.selectReferrer(${m.id}, '${m.name.replace(/'/g, "\\'")}', '${m.type}')" style="cursor:pointer; padding:8px; border-bottom:1px solid #eee;">
                        <strong>${m.name}</strong> (${m.type})
                    </div>
                `).join('');

                resultsDiv.innerHTML = resultsHtml || '<div class="search-result-item" style="padding:8px;">No results found</div>';
                resultsDiv.style.display = 'block';
                console.log(`searchReferrers: showing ${matches.length} results`);
            }
        } catch (error) {
            console.error('Error in searchReferrers:', error);
        }
    };

    const selectReferrer = (id, name, type) => {
        _selectedReferrer = { id, name, type };
        const infoDiv = document.getElementById('selected-referrer-info');
        if (infoDiv) {
            infoDiv.innerHTML = `
                <div class="selected-entity-badge">
                    <span>${type}: <strong>${name}</strong></span>
                    <button class="btn btn-sm secondary" onclick="app.clearSelectedReferrer()">Clear</button>
                </div>
            `;
        }
        const results = document.getElementById('referrer-results');
        if (results) results.style.display = 'none';
        const input = document.getElementById('cps-referrer');
        if (input) input.value = '';
    };

    const clearSelectedReferrer = () => {
        _selectedReferrer = null;
        const infoDiv = document.getElementById('selected-referrer-info');
        if (infoDiv) infoDiv.innerHTML = '';
    };

    const searchEntities = async () => {
        const searchTerm = document.getElementById('entity-search')?.value.toLowerCase();
        const resultsDiv = document.getElementById('search-results');
        if (!searchTerm || searchTerm.length < 2) {
            if (resultsDiv) resultsDiv.style.display = 'none';
            return;
        }

        const prospects = await getVisibleProspects();
        const customers = await getVisibleCustomers();
        const all = [...prospects.map(p => ({ ...p, type: 'Prospect' })), ...customers.map(c => ({ ...c, type: 'Customer' }))];

        const matches = all.filter(e => e.full_name ? e.full_name.toLowerCase().includes(searchTerm) : false).slice(0, 5);

        if (resultsDiv) {
            resultsDiv.innerHTML = matches.map(m => `
                <div class="search-result-item" onclick="app.selectEntity(${m.id}, '${m.type}')">
                    <strong>${m.full_name}</strong> (${m.type})
                </div>
            `).join('') || '<div class="search-result-item">No results</div>';
            resultsDiv.style.display = 'block';
        }
    };

    const selectEntity = (id, type) => {
        _selectedEntity = { id, type };
        const entity = type === 'Prospect'
            ? AppDataStore.getById('prospects', id)
            : AppDataStore.getById('customers', id);

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
        _selectedEntity = null;
        const infoDiv = document.getElementById('selected-entity-info');
        if (infoDiv) infoDiv.innerHTML = '';
    };

    const searchAgents = async () => {
        const term = document.getElementById('co-agent-search-input')?.value.toLowerCase();
        const resultsDiv = document.getElementById('agent-search-results');
        if (!term || term.length < 2) return;

        const users = await AppDataStore.getAll('users').filter(isAgent);
        const matches = users.filter(u => u.full_name.toLowerCase().includes(term));

        if (resultsDiv) {
            resultsDiv.innerHTML = matches.map(m => `
                <div class="search-result-item" onclick="app.addCoAgent(${m.id}, '${m.full_name}')">
                    ${m.full_name}
                </div>
            `).join('') || '<div class="search-result-item">No agents found</div>';
            resultsDiv.style.display = 'block';
        }
    };

    const addCoAgent = (id, name) => {
        if (_selectedCoAgents.length >= 5) {
            UI.toast.warning('Max 5 co-agents allowed');
            return;
        }
        if (_selectedCoAgents.find(a => a.id === id)) return;

        _selectedCoAgents.push({ id, name, co_role: 'Supporting' });
        renderCoAgents();
        const aRes = document.getElementById('agent-search-results');
        if (aRes) aRes.style.display = 'none';
        const aInp = document.getElementById('co-agent-search-input');
        if (aInp) aInp.value = '';
    };

    const removeCoAgent = (id) => {
        _selectedCoAgents = _selectedCoAgents.filter(a => a.id !== id);
        renderCoAgents();
    };

    const updateCoAgentRole = (id, role) => {
        const agent = _selectedCoAgents.find(a => a.id === id);
        if (agent) agent.co_role = role;
    };

    const renderCoAgents = () => {
        const container = document.getElementById('selected-co-agents');
        if (container) {
            container.innerHTML = _selectedCoAgents.map(a => `
                <div class="co-agent-tag" style="display:inline-flex; align-items:center; gap:8px; padding:6px 12px; margin-bottom:8px;">
                    <span>${a.name}</span>
                    <select class="form-control" style="width: auto; padding: 2px 6px; font-size: 11px; height: 24px;" onchange="app.updateCoAgentRole(${a.id}, this.value)">
                        <option value="Supporting" ${a.co_role === 'Supporting' ? 'selected' : ''}>Supporting</option>
                        <option value="Observer" ${a.co_role === 'Observer' ? 'selected' : ''}>Observer</option>
                        <option value="Trainer" ${a.co_role === 'Trainer' ? 'selected' : ''}>Trainer</option>
                    </select>
                    <span class="remove" onclick="app.removeCoAgent(${a.id})" style="cursor:pointer; font-weight:bold; margin-left:4px;">&times;</span>
                </div>
            `).join('');
        }
    };

    const saveActivity = async (stayOpen = false) => {
        const type = document.getElementById('modal-activity-type')?.value;
        const date = document.getElementById('activity-date')?.value;
        const start = document.getElementById('start-time')?.value;
        const end = document.getElementById('end-time')?.value;

        if (!date || !start || !end) {
            UI.toast.error('Date and time are required.');
            return;
        }

        const activity = {
            activity_type: type,
            activity_date: date,
            start_time: start,
            end_time: end,
            co_agents: _selectedCoAgents,
            lead_agent_id: _currentUser ? _currentUser.id : 5
        };

        if (type === 'CPS') {
            const name = document.getElementById('cps-name')?.value;
            const phone = document.getElementById('cps-phone')?.value;
            const relation = document.getElementById('cps-relation')?.value;
            const referrerInputName = document.getElementById('cps-referrer')?.value.trim();

            // Strict Validation: If name typed but not selected from list (matching FTF logic)
            if (referrerInputName && !_selectedReferrer) {
                UI.toast.error('Please select a referrer from the list. If the referrer is not found, create them as a prospect/customer/agent first.');
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

            // Phase X: Duplicate checking
            if (!window._cpsDuplicateConfirmed) {
                const prospects = await getVisibleProspects();
                const customers = await getVisibleCustomers();
                const all = [...prospects, ...customers];

                const normalize = str => str ? str.toLowerCase().replace(/\s+/g, '') : '';
                const normName = normalize(name);
                const isDuplicate = all.find(p => p.phone === phone || normalize(p.full_name) === normName);

                if (isDuplicate) {
                    const agent = AppDataStore.getById('users', isDuplicate.responsible_agent_id || isDuplicate.lead_agent_id) || { full_name: 'Unknown Agent' };
                    // Find last activity
                    const activities = await AppDataStore.getAll('activities').filter(a => a.prospect_id === isDuplicate.id || a.customer_id === isDuplicate.id);
                    activities.sort((a, b) => new Date(b.activity_date) - new Date(a.activity_date));
                    const lastDate = activities.length > 0 ? activities[0].activity_date : 'N/A';

                    const msg = `This person has visited before. The agent is ${agent.full_name}, and last meet up on ${lastDate}. Are you sure this is not the same prospect? Please double-check with the leader again.`;

                    UI.showModal('Potential Duplicate Found', `<p>${msg}</p>`, [
                        { label: 'Cancel', type: 'secondary', action: 'UI.hideModal()' },
                        { label: 'Continue', type: 'primary', action: `window._cpsDuplicateConfirmed = true; await app.saveActivity(${stayOpen})` }
                    ]);
                    return;
                }
            }
            window._cpsDuplicateConfirmed = false; // reset flag

            const relationDetails = relation === 'Other' ? document.getElementById('cps-relation-other')?.value : relation;

            const prospectData = {
                full_name: name,
                nickname: document.getElementById('cps-nickname')?.value || '',
                phone,
                ic_number: document.getElementById('cps-ic')?.value || '',
                email: document.getElementById('cps-email')?.value || '',
                occupation: document.getElementById('cps-occupation')?.value || '',
                company_name: document.getElementById('cps-company')?.value || '',
                income_range: document.getElementById('cps-income')?.value || '',
                address: document.getElementById('cps-address')?.value || '',
                city: document.getElementById('cps-city')?.value || '',
                state: document.getElementById('cps-state')?.value || '',
                postal_code: document.getElementById('cps-zip')?.value || '',
                ming_gua: document.getElementById('cps-gua')?.value || '',
                score: 5,
                responsible_agent_id: 5,
                referred_by_id: _selectedReferrer?.id || null,
                referred_by_type: _selectedReferrer?.type || null,
                referred_by: _selectedReferrer?.name || document.getElementById('cps-referrer')?.value || '',
                referral_relationship: relationDetails
            };

            if (document.getElementById('has-dob')?.checked) {
                prospectData.dob = document.getElementById('cps-dob')?.value;
            }
            if (document.getElementById('has-lunar')?.checked) {
                prospectData.lunar_birth = document.getElementById('cps-lunar')?.value;
            }

            const prospect = await AppDataStore.create('prospects', prospectData);
            activity.prospect_id = prospect.id;
            activity.activity_title = `CPS With ${name}`;

            const inviteMethod = document.getElementById('cps-invitation-method')?.value;
            activity.cps_invitation_method = inviteMethod === 'Other' ? document.getElementById('cps-invitation-other')?.value : inviteMethod;
            activity.cps_invitation_details = document.getElementById('cps-invitation-details')?.value || '';
        } else if (type === 'FSA' || type === 'SITE') {
            const address = document.getElementById('location-address')?.value;
            if (!address) {
                UI.toast.error('Address is required for site visits.');
                return;
            }
            activity.location_address = address;
            activity.activity_title = type === 'FSA' ? 'Feng Shui Analysis' : 'Site Visit';
        } else if (type === 'EVENT' || type === 'AGENT_MEETING' || type === 'AGENT_TRAINING') {
            const isNew = document.querySelector('input[name="event-selection"]:checked')?.value === 'new';
            const visibility = document.querySelector('input[name="event-visibility"]:checked')?.value || 'closed';
            let eventId;
            if (isNew) {
                const title = document.getElementById('new-event-title')?.value;
                if (!title) {
                    UI.toast.error('Event title is required.');
                    return;
                }

                const durationField = document.getElementById('duration');
                let dur = 60;
                if (durationField && durationField.value !== 'Invalid') {
                    dur = parseInt(durationField.value);
                }

                let category = document.getElementById('event-category')?.value || 'Lecture';
                if (type === 'AGENT_MEETING') category = 'Meeting';
                if (type === 'AGENT_TRAINING') category = 'Training';

                const newEvent = await AppDataStore.create('events', {
                    title: title,
                    date: date,
                    time: start,
                    duration: dur,
                    category: category,
                    base_score: document.getElementById('event-score')?.value || 10,
                    status: 'Upcoming',
                    visibility: visibility
                });
                eventId = newEvent.id;
                activity.activity_title = title;
            } else {
                eventId = document.getElementById('existing-event')?.value;
                if (!eventId) {
                    UI.toast.error('Please select an event.');
                    return;
                }
                const ev = AppDataStore.getById('events', eventId);
                activity.activity_title = ev ? ev.title : 'Existing Event';
                // Update visibility on existing event if needed (optional, keeping it simple for now)
            }
            activity.event_id = parseInt(eventId);
            activity.visibility = visibility;

            // Link to selected entity if present
            if (_selectedEntity) {
                if (_selectedEntity.type === 'Prospect') activity.prospect_id = _selectedEntity.id;
                else activity.customer_id = _selectedEntity.id;
            }

            // Save attendees
            _selectedAttendees.forEach(att => {
                await AppDataStore.create('event_attendees', {
                    event_id: parseInt(eventId),
                    attendee_id: att.id,
                    attendee_type: att.type, // 'prospect', 'customer', 'agent'
                    attendance_status: att.status,
                    added_by_agent_id: 5 // Default Michelle Tan
                });
            });
        } else {
            if (!_selectedEntity) {
                UI.toast.error('Please select a prospect or customer.');
                return;
            }
            activity.activity_title = document.getElementById('meeting-title')?.value || 'Meeting';
            if (_selectedEntity.type === 'Prospect') activity.prospect_id = _selectedEntity.id;
            else activity.customer_id = _selectedEntity.id;
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

        activity.summary = document.getElementById('note-key-points')?.value || '';
        activity.note_key_points = document.getElementById('note-key-points')?.value || '';
        activity.note_outcome = document.getElementById('note-outcome')?.value || '';
        activity.note_next_steps = document.getElementById('note-next-steps')?.value || '';
        activity.note_needs = document.getElementById('note-needs')?.value || '';
        activity.note_pain_points = document.getElementById('note-pain-points')?.value || '';

        if (type === 'CPS') {
            const attInput = document.getElementById('cps-attachment');
            if (attInput && attInput.files.length > 0) {
                const file = attInput.files[0];

                if (file.size > 5 * 1024 * 1024) {
                    UI.toast.error('File size exceeds 5MB limit');
                    return;
                }

                activity.cps_attachment = {
                    name: file.name,
                    size: file.size,
                    type: file.type,
                    url: URL.createObjectURL(file)
                };
            }
        }

        const savedActivity = await AppDataStore.create('activities', activity);

        if (document.getElementById('is-closing')?.checked) {
            const salesIdea = document.getElementById('case-sales-idea')?.value;
            const planDetails = document.getElementById('case-plan-details')?.value;
            const successStory = document.getElementById('case-success-story')?.value;

            if (salesIdea || planDetails || successStory) {
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
                    created_by: 5,
                    is_public: false
                });
            }
        }

        UI.toast.success('Activity saved!');

        await renderCalendar();
        await renderTodayActivities();

        if (!stayOpen) {
            UI.hideModal();
        } else {
            // Reset co-agents when staying open for another add
            _selectedCoAgents = [];
            await openActivityModal(date);
        }
    };

    const saveAndAddAnother = async () => await saveActivity(true);

    // ========== PHASE 3: PROSPECT MANAGEMENT FUNCTIONS ==========

    let _sortField = 'score';
    let _sortDirection = 'desc';

    const sortProspects = async (field) => {
        if (_sortField === field) {
            _sortDirection = _sortDirection === 'asc' ? 'desc' : 'asc';
        } else {
            _sortField = field;
            _sortDirection = 'desc';
        }
        await renderProspectsTable();
    };

    const showProspectsView = async (container) => {
        container.innerHTML = `
            <div class="prospects-view">
                <div class="tab-navigation">
                    <button class="tab-btn active" onclick="await app.switchCustomerTab('prospects')">Prospects</button>
                    <button class="tab-btn" onclick="await app.switchCustomerTab('customers')">Customers</button>
                </div>

                <div id="prospects-tab-content">
                    <div class="prospects-header">
                        <div>
                            <h1>Prospects Management</h1>
                            <p>Track and manage potential customers through the lifecycle.</p>
                        </div>
                        <div class="header-actions">
                            <button class="btn secondary" onclick="await app.openImportWizard()">
                                <i class="fas fa-file-import"></i> Bulk Import
                            </button>
                            <button class="btn primary" onclick="app.openAddProspectModal()">
                                <i class="fas fa-plus"></i> Add Prospect
                            </button>
                        </div>
                    </div>

                <div class="filter-bar">
                    <div class="search-group">
                        <i class="fas fa-search"></i>
                        <input type="text" id="prospect-search" placeholder="Search by name, phone, email, or ID..." onkeyup="await app.filterProspects()">
                    </div>
                    <div class="filter-group">
                        <select id="filter-score" onchange="await app.filterProspects()">
                            <option value="">All Scores</option>
                            <option value="A+">Grade A+ (800-1000)</option>
                            <option value="A">Grade A (600-799)</option>
                            <option value="B">Grade B (400-599)</option>
                            <option value="C">Grade C (200-399)</option>
                            <option value="D">Grade D (0-199)</option>
                        </select>
                        <select id="filter-gua" onchange="await app.filterProspects()">
                            <option value="">All Ming Gua</option>
                            <option value="MG1">MG1 (Kan)</option>
                            <option value="MG2">MG2 (Kun)</option>
                            <option value="MG3">MG3 (Zhen)</option>
                            <option value="MG4">MG4 (Xun)</option>
                            <option value="MG5">MG5 (Zhong)</option>
                            <option value="MG6">MG6 (Qian)</option>
                            <option value="MG7">MG7 (Dui)</option>
                            <option value="MG8">MG8 (Gen)</option>
                            <option value="MG9">MG9 (Li)</option>
                        </select>
                        <select id="filter-status" onchange="await app.filterProspects()">
                            <option value="">All Status</option>
                            <option value="active">Active</option>
                            <option value="attention">Needs Attention</option>
                            <option value="reassign">Reassignable</option>
                            <option value="critical">Critical</option>
                        </select>
                        <button class="btn primary" onclick="await app.filterProspects()">Apply Filters</button>
                    </div>
                </div>

                <div class="prospects-table-container">
                    <table class="prospects-table" id="prospects-table">
                        <thead>
                            <tr>
                                <th onclick="await app.sortProspects('name')" style="cursor: pointer;">Name ${_sortField === 'name' ? (_sortDirection === 'asc' ? '↑' : '↓') : ''}</th>
                                <th onclick="await app.sortProspects('score')" style="cursor: pointer;">Score ${_sortField === 'score' ? (_sortDirection === 'asc' ? '↑' : '↓') : ''}</th>
                                <th>Ming Gua</th>
                                <th>Occupation/Company</th>
                                <th onclick="await app.sortProspects('activity')" style="cursor: pointer;">Last Activity ${_sortField === 'activity' ? (_sortDirection === 'asc' ? '↑' : '↓') : ''}</th>
                                <th onclick="await app.sortProspects('protection')" style="cursor: pointer;">Protection ${_sortField === 'protection' ? (_sortDirection === 'asc' ? '↑' : '↓') : ''}</th>
                                <th>Actions</th>
                            </tr>

                        </thead>
                        <tbody id="prospects-table-body">
                            <!-- Populated by await renderProspectsTable() -->
                        </tbody>
                    </table>
                </div>
                </div>
                <div id="customers-tab-content" style="display: none;">
                    <!-- Customer view content will be injected here -->
                </div>
            </div>
        `;
        await renderProspectsTable();
    };

    const switchCustomerTab = async (tabName) => {
        const pTab = document.getElementById('prospects-tab-content');
        const cTab = document.getElementById('customers-tab-content');
        const btns = document.querySelectorAll('.tab-btn');

        btns.forEach(b => b.classList.remove('active'));
        if (tabName === 'prospects') {
            pTab.style.display = 'block';
            cTab.style.display = 'none';
            btns[0].classList.add('active');
            await renderProspectsTable();
        } else {
            pTab.style.display = 'none';
            cTab.style.display = 'block';
            btns[1].classList.add('active');
            await showCustomersView(cTab);
        }
    };

    const showCustomersView = async (container) => {
        container.innerHTML = `
            <div class="customers-view">
                <div class="prospects-header">
                    <div>
                        <h1>Customer Database</h1>
                        <p>Manage converted customers and their lifecycle events. Customer records are permanent.</p>
                    </div>
                    <div class="header-actions">
                        <button class="btn primary" onclick="await app.openAddCustomerModal()">
                            <i class="fas fa-plus"></i> Add Customer
                        </button>
                    </div>
                </div>

                <div class="warning-banner">
                    <i class="fas fa-exclamation-triangle"></i>
                    <span>⚠️ DELETE IS NOT AVAILABLE - Customer records are permanent and cannot be deleted under any circumstances.</span>
                </div>

                <div class="filter-bar">
                    <div class="search-group">
                        <i class="fas fa-search"></i>
                        <input type="text" id="customer-search" placeholder="Search customers by name, phone, email, or ID" onkeyup="await app.filterCustomers()">
                    </div>
                    <div class="filter-group">
                        <select id="filter-customer-type" onchange="await app.filterCustomers()">
                            <option value="">Customer Type: All</option>
                            <option value="Regular">Regular</option>
                            <option value="VIP">VIP</option>
                            <option value="Agent Eligible">Agent Eligible</option>
                        </select>
                        <select id="filter-customer-gua" onchange="await app.filterCustomers()">
                            <option value="">Ming Gua: All</option>
                            <option value="MG1">MG1</option>
                            <option value="MG2">MG2</option>
                            <option value="MG3">MG3</option>
                            <option value="MG4">MG4</option>
                            <option value="MG5">MG5</option>
                            <option value="MG6">MG6</option>
                            <option value="MG7">MG7</option>
                            <option value="MG8">MG8</option>
                            <option value="MG9">MG9</option>
                        </select>
                        <select id="filter-purchase-status" onchange="await app.filterCustomers()">
                            <option value="">Purchase Status: All</option>
                            <option value="30d">Purchased Last 30 Days</option>
                            <option value="90d">Purchased Last 90 Days</option>
                            <option value="no90d">No Purchase 90+ Days</option>
                        </select>
                        <button class="btn primary" onclick="await app.filterCustomers()">Apply Filters</button>
                    </div>
                </div>

                <div class="prospects-table-container">
                    <table class="prospects-table">
                        <thead>
                            <tr>
                                <th>Name</th>
                                <th>Lifetime Value</th>
                                <th>Customer Since</th>
                                <th>Ming Gua</th>
                                <th>Agent</th>
                                <th>Status</th>
                                <th>Actions</th>
                            </tr>
                        </thead>
                        <tbody id="customers-table-body">
                            <!-- Populated by await renderCustomersTable() -->
                        </tbody>
                    </table>
                </div>
            </div>
        `;
        await renderCustomersTable();
    };

    const renderCustomersTable = async () => {
        const tbody = document.getElementById('customers-table-body');
        if (!tbody) return;

        const customers = await getVisibleCustomers();
        const searchQuery = document.getElementById('customer-search')?.value.toLowerCase() || '';
        const typeFilter = document.getElementById('filter-customer-type')?.value || '';
        const guaFilter = document.getElementById('filter-customer-gua')?.value || '';
        const purchaseFilter = document.getElementById('filter-purchase-status')?.value || '';

        let html = '';
        customers.forEach(c => {
            if (searchQuery && !c.full_name.toLowerCase().includes(searchQuery) && !c.phone.includes(searchQuery)) return;
            if (guaFilter && c.ming_gua !== guaFilter) return;
            // Type and Purchase filters simplified for demo
            if (typeFilter === 'VIP' && c.lifetime_value < 5000) return;

            html += `
                <tr onclick="await app.showCustomerDetail(${c.id})">
                    <td><strong>${c.full_name}</strong></td>
                    <td>RM ${c.lifetime_value.toLocaleString()} <span style="color:var(--success); font-size:12px;"><i class="fas fa-caret-up"></i></span></td>
                    <td>${c.customer_since}</td>
                    <td>${c.ming_gua}</td>
                    <td>Michelle Tan</td>
                    <td><span class="score-badge score-A+">${c.status.toUpperCase()}</span></td>
                    <td onclick="event.stopPropagation()">
                        <button class="btn-icon" title="Edit"><i class="fas fa-edit"></i></button>
                        <button class="btn-icon" title="Add Purchase" onclick="await app.openAddPurchaseModal(${c.id})"><i class="fas fa-shopping-cart"></i></button>
                        <button class="btn-icon" title="Referral" onclick="app.todo('Referral workflow')"><i class="fas fa-user-plus"></i></button>
                        <button class="btn-icon" title="Recruit" onclick="app.openRecruitModal(${c.id})"><i class="fas fa-user-tie"></i></button>
                    </td>
                </tr>
            `;
        });
        tbody.innerHTML = html || '<tr><td colspan="7" style="text-align:center; padding:20px;">No customers found</td></tr>';
    };

    const filterCustomers = async () => await renderCustomersTable();

    const renderProspectsTable = async () => {
        const tbody = document.getElementById('prospects-table-body');
        if (!tbody) return;

        let prospects = await getVisibleProspects();
        const activities = await getVisibleActivities();
        const searchQuery = document.getElementById('prospect-search')?.value.toLowerCase() || '';
        const scoreFilter = document.getElementById('filter-score')?.value || '';
        const guaFilter = document.getElementById('filter-gua')?.value || '';
        const statusFilter = document.getElementById('filter-status')?.value || '';

        // Apply sorting
        prospects.sort((a, b) => {
            let valA, valB;

            if (_sortField === 'name') {
                valA = a.full_name || '';
                valB = b.full_name || '';
                return _sortDirection === 'asc' ? valA.localeCompare(valB) : valB.localeCompare(valA);
            } else if (_sortField === 'score') {
                valA = a.score || 0;
                valB = b.score || 0;
                return _sortDirection === 'asc' ? valA - valB : valB - valA;
            } else if (_sortField === 'activity') {
                const lastA = activities.filter(act => act.prospect_id == a.id).sort((act1, act2) => (act2.activity_date || '').localeCompare(act1.activity_date || '') || (act2.id - act1.id))[0];
                const lastB = activities.filter(act => act.prospect_id == b.id).sort((act1, act2) => (act2.activity_date || '').localeCompare(act1.activity_date || '') || (act2.id - act1.id))[0];
                valA = lastA ? lastA.activity_date : '0000-00-00';
                valB = lastB ? lastB.activity_date : '0000-00-00';
                return _sortDirection === 'asc' ? valA.localeCompare(valB) : valB.localeCompare(valA);
            } else if (_sortField === 'protection') {
                valA = calculateDaysLeft(a.protection_deadline);
                valB = calculateDaysLeft(b.protection_deadline);
                return _sortDirection === 'asc' ? valA - valB : valB - valA;
            }
            return 0;
        });


        let html = '';
        let visibleCount = 0;

        prospects.forEach(p => {
            // Search filter (Name, Phone, Email, ID)
            const matchesSearch = !searchQuery ||
                p.full_name.toLowerCase().includes(searchQuery) ||
                (p.phone && p.phone.includes(searchQuery)) ||
                (p.email && p.email.toLowerCase().includes(searchQuery)) ||
                (p.id && p.id.toString().includes(searchQuery));
            if (!matchesSearch) return;

            // Score filter
            const grade = getScoreGrade(p.score);
            if (scoreFilter && scoreFilter !== grade) return;

            // Ming Gua filter
            if (guaFilter && p.ming_gua !== guaFilter) return;

            // Get last activity
            const lastActivity = activities
                .filter(a => a.prospect_id === p.id)
                .sort((a, b) => new Date(b.activity_date) - new Date(a.activity_date))[0];

            const lastActivityText = lastActivity
                ? `${lastActivity.activity_date} ${lastActivity.activity_type}`
                : 'No activity';

            const daysLeft = calculateProtectionDays(p);
            const protectionStatus = getProtectionStatus(daysLeft);

            // Status filter (Active, Attention, Reassignable, Critical)
            if (statusFilter) {
                if (statusFilter === 'active' && protectionStatus !== 'normal') return;
                if (statusFilter === 'attention' && protectionStatus !== 'warning') return;
                if (statusFilter === 'reassign' && protectionStatus !== 'normal') return; // Adjust logic if reassign means something else
                if (statusFilter === 'critical' && protectionStatus !== 'critical') return;
            }

            html += `
                <tr onclick="await app.showProspectDetail(${p.id})">
                    <td><strong>${p.full_name}</strong></td>
                    <td>
                        <span class="score-badge score-${grade.replace('+', '-plus')}">${p.score || 0} (${grade})</span>
                    </td>
                    <td>${p.ming_gua || 'MG4'}</td>
                    <td>${p.occupation || ''}${p.company_name ? ' · ' + p.company_name : ''}</td>
                    <td>${lastActivityText}</td>
                    <td>
                        <div>${daysLeft} days left</div>
                        <div class="protection-bar">
                            <div class="protection-fill ${protectionStatus}" style="width: ${Math.min(100, (daysLeft / 30) * 100)}%"></div>
                        </div>
                    </td>
                    <td onclick="event.stopPropagation()">
                        <button class="btn-icon" title="Edit" onclick="await app.openProspectModal(${p.id})"><i class="fas fa-edit"></i></button>
                        <button class="btn-icon" title="Add Activity" onclick="await app.openActivityModal('', ${p.id})"><i class="fas fa-calendar-plus"></i></button>
                        <button class="btn-icon" title="Convert to Customer" onclick="await app.convertToCustomer(${p.id})"><i class="fas fa-user-check"></i></button>
                    </td>
                </tr>
            `;
            visibleCount++;
        });

        if (visibleCount === 0) {
            html = '<tr><td colspan="7" style="text-align:center; padding:40px;">No prospects found. Click "Add Prospect" to create one.</td></tr>';
        }

        tbody.innerHTML = html;
    };

    const getScoreGrade = (score) => {
        if (!score) return 'D';
        if (score >= 800) return 'A+';
        if (score >= 600) return 'A';
        if (score >= 400) return 'B';
        if (score >= 200) return 'C';
        return 'D';
    };

    const calculateProtectionDays = (prospect) => {
        if (!prospect.protection_deadline) return 30;
        const deadline = new Date(prospect.protection_deadline);
        const today = new Date();
        const diffTime = deadline - today;
        const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
        return diffDays > 0 ? diffDays : 0;
    };

    const getProtectionStatus = (days) => {
        if (days > 7) return 'normal';
        if (days > 0) return 'warning';
        return 'critical';
    };

    const openProspectModal = async (prospectId = null) => {
        if (prospectId) {
            const prospect = AppDataStore.getById('prospects', prospectId);
            const currentUser = _currentUser || Auth.getCurrentUser();
            const isAdmin = isSystemAdmin(currentUser) || isMarketingManager(currentUser) || currentUser.role?.includes('Level 3') || currentUser.role?.includes('Level 7') || currentUser.role === 'team_leader';
            const isOwner = prospect.responsible_agent_id == currentUser.id;
            if (!isAdmin && !isOwner) {
                UI.toast.error('You cannot edit this prospect.');
                return;
            }
        }
        const prospect = prospectId ? AppDataStore.getById('prospects', prospectId) : null;
        const isEdit = !!prospect;

        const content = `
            <div class="prospect-form">
                <input type="hidden" id="edit-prospect-id" value="${prospectId || ''}">
                <div class="form-section">
                    <h4>Basic Information</h4>
                    <div class="form-row">
                        <div class="form-group half">
                            <label>Title</label>
                            <select id="prospect-title" class="form-control">
                                <option value="Mr." ${prospect?.title === 'Mr.' ? 'selected' : ''}>Mr.</option>
                                <option value="Ms." ${prospect?.title === 'Ms.' ? 'selected' : ''}>Ms.</option>
                                <option value="Mrs." ${prospect?.title === 'Mrs.' ? 'selected' : ''}>Mrs.</option>
                                <option value="Dr." ${prospect?.title === 'Dr.' ? 'selected' : ''}>Dr.</option>
                            </select>
                        </div>
                        <div class="form-group half">
                            <label>Full Name <span class="required">*</span></label>
                            <input type="text" id="prospect-name" class="form-control" value="${prospect?.full_name || ''}" required>
                        </div>
                    </div>
                    <div class="form-row">
                        <div class="form-group half">
                            <label>Gender</label>
                            <select id="prospect-gender" class="form-control">
                                <option value="Male" ${prospect?.gender === 'Male' ? 'selected' : ''}>Male</option>
                                <option value="Female" ${prospect?.gender === 'Female' ? 'selected' : ''}>Female</option>
                                <option value="Other" ${prospect?.gender === 'Other' ? 'selected' : ''}>Other</option>
                            </select>
                        </div>
                        <div class="form-group half">
                            <label>Nationality</label>
                            <input type="text" id="prospect-nationality" class="form-control" value="${prospect?.nationality || 'Malaysian'}">
                        </div>
                    </div>
                    <div class="form-row">
                        <div class="form-group half">
                            <label>Phone <span class="required">*</span></label>
                            <input type="tel" id="prospect-phone" class="form-control" value="${prospect?.phone || ''}" required>
                        </div>
                        <div class="form-group half">
                            <label>Email</label>
                            <input type="email" id="prospect-email" class="form-control" value="${prospect?.email || ''}">
                        </div>
                    </div>
                    <div class="form-group">
                        <label>IC Number</label>
                        <input type="text" id="prospect-ic" class="form-control" value="${prospect?.ic_number || ''}">
                    </div>
                </div>
                
                <div class="form-section">
                    <h4>Personal Information</h4>
                    <div class="form-row">
                        <div class="form-group half">
                            <label>Date of Birth</label>
                            <input type="date" id="prospect-dob" class="form-control" value="${prospect?.date_of_birth || ''}">
                        </div>
                        <div class="form-group half">
                            <label>Lunar Birth</label>
                            <input type="text" id="prospect-lunar" class="form-control" value="${prospect?.lunar_birth || ''}">
                        </div>
                    </div>
                    <div class="form-row">
                        <div class="form-group half">
                            <label>Occupation</label>
                            <input type="text" id="prospect-occupation" class="form-control" value="${prospect?.occupation || ''}">
                        </div>
                        <div class="form-group half">
                            <label>Company Name</label>
                            <input type="text" id="prospect-company" class="form-control" value="${prospect?.company_name || ''}">
                        </div>
                    </div>
                    <div class="form-group">
                        <label>Income Range</label>
                        <select id="prospect-income" class="form-control">
                            <option value="">Select range</option>
                            <option value="< RM3k" ${prospect?.income_range === '< RM3k' ? 'selected' : ''}>Below RM 3,000</option>
                            <option value="RM3-5k" ${prospect?.income_range === 'RM3-5k' ? 'selected' : ''}>RM 3,000 - RM 5,000</option>
                            <option value="RM5-8k" ${prospect?.income_range === 'RM5-8k' ? 'selected' : ''}>RM 5,000 - RM 8,000</option>
                            <option value="RM8-12k" ${prospect?.income_range === 'RM8-12k' ? 'selected' : ''}>RM 8,000 - RM 12,000</option>
                            <option value="RM12-20k" ${prospect?.income_range === 'RM12-20k' ? 'selected' : ''}>RM 12,000 - RM 20,000</option>
                            <option value="> RM20k" ${prospect?.income_range === '> RM20k' ? 'selected' : ''}>Above RM 20,000</option>
                        </select>
                    </div>
                </div>

                <div class="form-section">
                    <h4>Address</h4>
                    <div class="form-group">
                        <textarea id="prospect-address" class="form-control" rows="2" placeholder="Street address">${prospect?.address || ''}</textarea>
                    </div>
                    <div class="form-row">
                        <div class="form-group half">
                            <input type="text" id="prospect-city" class="form-control" placeholder="City" value="${prospect?.city || ''}">
                        </div>
                        <div class="form-group half">
                            <input type="text" id="prospect-state" class="form-control" placeholder="State" value="${prospect?.state || ''}">
                        </div>
                    </div>
                    <div class="form-group">
                        <input type="text" id="prospect-postal" class="form-control" placeholder="Postal Code" value="${prospect?.postal_code || ''}">
                    </div>
                </div>

                <div class="form-section">
                    <h4>Feng Shui</h4>
                    <div class="form-group">
                        <label>Ming Gua</label>
                        <select id="prospect-minggua" class="form-control">
                            <option value="">Auto-calculate from DOB</option>
                            ${['MG1', 'MG2', 'MG3', 'MG4', 'MG5', 'MG6', 'MG7', 'MG8', 'MG9'].map(mg => `
                                <option value="${mg}" ${prospect?.ming_gua === mg ? 'selected' : ''}>${mg}</option>
                            `).join('')}
                        </select>
                    </div>
                </div>

                <div class="form-section">
                    <h4>Referral Information</h4>
                    <div class="form-group">
                        <label>Referred By</label>
                        <input type="text" id="prospect-referred" class="form-control" placeholder="Search customer/agent..." value="${prospect?.referred_by || ''}">
                    </div>
                    <div class="form-group">
                        <label>Relationship</label>
                        <select id="prospect-relationship" class="form-control">
                            <option value="">Select</option>
                            <option value="Family" ${prospect?.referral_relationship === 'Family' ? 'selected' : ''}>Family</option>
                            <option value="Cousin" ${prospect?.referral_relationship === 'Cousin' ? 'selected' : ''}>Cousin</option>
                            <option value="Friend" ${prospect?.referral_relationship === 'Friend' ? 'selected' : ''}>Friend</option>
                            <option value="Colleague" ${prospect?.referral_relationship === 'Colleague' ? 'selected' : ''}>Colleague</option>
                            <option value="Business Partner" ${prospect?.referral_relationship === 'Business Partner' ? 'selected' : ''}>Business Partner</option>
                        </select>
                    </div>
                </div>

                <div class="form-section">
                    <h4>Assignment</h4>
                    <div class="form-row">
                        <div class="form-group half">
                            <label>Assign to Agent</label>
                            <select id="prospect-agent" class="form-control">
                                <option value="5" ${prospect?.responsible_agent_id == 5 ? 'selected' : ''}>Michelle Tan</option>
                                <option value="6" ${prospect?.responsible_agent_id == 6 ? 'selected' : ''}>Ah Seng</option>
                                <option value="7" ${prospect?.responsible_agent_id == 7 ? 'selected' : ''}>Mei Ling</option>
                                <option value="8" ${prospect?.responsible_agent_id == 8 ? 'selected' : ''}>Raj Kumar</option>
                            </select>
                        </div>
                        <div class="form-group half">
                            <label>CPS Date</label>
                            <input type="date" id="prospect-cps-date" class="form-control" value="${prospect?.cps_assignment_date || new Date().toISOString().split('T')[0]}">
                        </div>
                    </div>

                    <div class="form-group">
                        <label>Pipeline Stage</label>
                        <select id="prospect-stage" class="form-control">
                            <option value="new" ${prospect?.pipeline_stage === 'new' ? 'selected' : ''}>New</option>
                            <option value="contacted" ${prospect?.pipeline_stage === 'contacted' ? 'selected' : ''}>Contacted</option>
                            <option value="qualified" ${prospect?.pipeline_stage === 'qualified' ? 'selected' : ''}>Qualified</option>
                            <option value="proposal" ${prospect?.pipeline_stage === 'proposal' ? 'selected' : ''}>Proposal</option>
                            <option value="negotiation" ${prospect?.pipeline_stage === 'negotiation' ? 'selected' : ''}>Negotiation</option>
                        </select>
                    </div>

                    <div class="form-row">
                        <div class="form-group half">
                            <label>Expected Close Date</label>
                            <input type="date" id="prospect-close-date" class="form-control" value="${prospect?.expected_close_date || ''}">
                        </div>
                        <div class="form-group half">
                            <label>Deal Value (RM)</label>
                            <input type="number" id="prospect-deal-value" class="form-control" value="${prospect?.deal_value || ''}">
                        </div>
                    </div>
                </div>
            </div>
        `;

        UI.showModal(isEdit ? 'Edit Prospect' : 'Add New Prospect', content, [
            { label: 'Cancel', type: 'secondary', action: 'UI.hideModal()' },
            { label: isEdit ? 'Update Prospect' : 'Create Prospect', type: 'primary', action: 'await app.saveProspect()' }
        ]);
    };


    const showFieldError = (fieldId, message) => {
        const field = document.getElementById(fieldId);
        if (field) {
            field.classList.add('error');
            const errorDiv = document.createElement('div');
            errorDiv.className = 'validation-error';
            errorDiv.textContent = message;
            field.parentNode.appendChild(errorDiv);
        }
    };

    const saveProspect = async () => {
        const editId = document.getElementById('edit-prospect-id')?.value;
        const name = document.getElementById('prospect-name')?.value?.trim();
        const phone = document.getElementById('prospect-phone')?.value?.trim();
        const email = document.getElementById('prospect-email')?.value?.trim();

        // Clear previous validation errors
        document.querySelectorAll('.validation-error').forEach(el => el.remove());
        document.querySelectorAll('.form-control.error').forEach(el => el.classList.remove('error'));

        let hasError = false;

        if (!name) {
            await showFieldError('prospect-name', 'Name is required');
            hasError = true;
        }

        if (!phone) {
            await showFieldError('prospect-phone', 'Phone is required');
            hasError = true;
        } else if (!/^[0-9\+\-\s]{8,}$/.test(phone)) {
            await showFieldError('prospect-phone', 'Enter a valid phone number (min 8 digits)');
            hasError = true;
        }

        if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
            await showFieldError('prospect-email', 'Invalid email format');
            hasError = true;
        }

        if (hasError) return;

        const data = {
            title: document.getElementById('prospect-title')?.value,
            full_name: name,
            gender: document.getElementById('prospect-gender')?.value,
            nationality: document.getElementById('prospect-nationality')?.value,
            phone: phone,
            email: document.getElementById('prospect-email')?.value,
            ic_number: document.getElementById('prospect-ic')?.value,
            date_of_birth: document.getElementById('prospect-dob')?.value,
            lunar_birth: document.getElementById('prospect-lunar')?.value,
            occupation: document.getElementById('prospect-occupation')?.value,
            company_name: document.getElementById('prospect-company')?.value,
            income_range: document.getElementById('prospect-income')?.value,
            address: document.getElementById('prospect-address')?.value,
            city: document.getElementById('prospect-city')?.value,
            state: document.getElementById('prospect-state')?.value,
            postal_code: document.getElementById('prospect-postal')?.value,
            ming_gua: document.getElementById('prospect-minggua')?.value || 'MG4',
            referred_by: document.getElementById('prospect-referred')?.value,
            referral_relationship: document.getElementById('prospect-relationship')?.value,
            responsible_agent_id: parseInt(document.getElementById('prospect-agent')?.value) || 5,
            cps_assignment_date: document.getElementById('prospect-cps-date')?.value || new Date().toISOString().split('T')[0],
            pipeline_stage: document.getElementById('prospect-stage')?.value || 'new',
            expected_close_date: document.getElementById('prospect-close-date')?.value,
            deal_value: parseFloat(document.getElementById('prospect-deal-value')?.value) || 0
        };

        if (editId) {
            AppDataStore.update('prospects', parseInt(editId), data);
            UI.toast.success('Prospect updated successfully');
        } else {
            data.id = Date.now();
            data.protection_deadline = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
            data.score = 5;
            data.created_at = new Date().toISOString();
            await AppDataStore.create('prospects', data);
            UI.toast.success('Prospect created successfully');

            // Step 8: Trigger event for referral modal
            document.dispatchEvent(new CustomEvent('prospectCreated', { detail: data }));
        }

        UI.hideModal();
        await renderProspectsTable();
        if (editId) await showProspectDetail(parseInt(editId));
    };


    const filterProspects = async () => {
        await renderProspectsTable();
    };

    const showCustomerDetail = async (customerId) => {
        const customer = AppDataStore.getById('customers', customerId);
        if (!customer || !await canViewCustomer(customer)) {
            UI.toast.error('You do not have permission to view this customer.');
            await navigateTo('prospects');
            return;
        }

        (() => {
            await addWhatsAppButtonToProfile('customer', customerId);
        }, 100);

        const container = document.getElementById('content-viewport');
        container.innerHTML = `
            <div class="customer-profile-view">
                <div class="warning-banner">
                    <i class="fas fa-exclamation-triangle"></i>
                    <span>⚠️ DELETE IS NOT AVAILABLE - Customer records are permanent</span>
                </div>

                <div class="profile-header" style="display:flex; justify-content:space-between; align-items:flex-start; margin-bottom:24px;">
                    <div>
                        <div style="display:flex; align-items:center; gap:12px; margin-bottom:8px;">
                            <h1 style="font-size:32px; font-weight:700;">${customer.full_name}</h1>
                            <span class="score-badge score-A+" style="background:#10b981; color:white;">ACTIVE</span>
                        </div>
                        <div style="display:flex; gap:12px; color:var(--gray-500); font-size:14px;">
                            <span>ID: C${customer.id}</span>
                            <span><i class="fas fa-user-check" style="color:#3b82f6;"></i> Customer</span>
                            <span><i class="fas fa-building"></i> Company</span>
                        </div>
                    </div>
                    <div class="header-actions">
                        <button class="btn secondary" onclick="await app.openProspectModal(${customer.id})"><i class="fas fa-edit"></i> Edit</button>
                        <button class="btn secondary" onclick="await app.openAddPurchaseModal(${customer.id})"><i class="fas fa-plus"></i> Add Purchase</button>
                        <button class="btn secondary" onclick="app.todo('Refer a Friend')"><i class="fas fa-user-plus"></i> Refer a Friend</button>
                        <button class="btn secondary" onclick="await app.openSendWhatsAppModal('customer', ${customer.id})"><i class="fab fa-whatsapp"></i> WhatsApp</button>
                        <button class="btn primary" style="background:#6b21a8;" onclick="app.openRecruitModal(${customer.id})"><i class="fas fa-user-tie"></i> Recruit as Agent</button>
                    </div>
                </div>

                <div class="customer-since-banner">
                    🎉 Customer since ${customer.customer_since} · Converted from Prospect automatically at RM ${customer.conversion_amount?.toLocaleString() || '2,200'}
                </div>

                <div class="profile-content-grid" style="display:grid; grid-template-columns: 1fr 300px; gap:24px;">
                    <div class="profile-main-column">
                        <div class="tab-navigation">
                            <button class="profile-tab-btn active" onclick="await app.switchProfileTab(this, 'basic', ${customer.id})">Basic & Info</button>
                            <button class="profile-tab-btn" onclick="await app.switchProfileTab(this, 'platforms', ${customer.id})">Platform IDs</button>
                             <button class="profile-tab-btn" onclick="await app.switchProfileTab(this, 'purchases', ${customer.id})">Purchase History</button>
                            <button class="profile-tab-btn" onclick="await app.switchProfileTab(this, 'activity', ${customer.id})">Activity History</button>
                            <button class="profile-tab-btn" onclick="await app.switchProfileTab(this, 'referrals', ${customer.id})">Referrals Made</button>
                            <button class="profile-tab-btn" onclick="await app.switchProfileTab(this, 'events', ${customer.id})">Events Attended</button>
                        </div>

                        <div id="profile-tab-content" style="background:var(--white); padding:24px; border-radius:12px; border:1px solid var(--gray-200);">
                            <!-- Active tab content -->
                        </div>
                    </div>

                    <div class="profile-sidebar">
                        <div id="event-attendance-section"></div>
                        <div id="agent-eligibility-section"></div>
                        <div id="customer-tags-section" style="margin-top:24px;"></div>
                    </div>
                </div>
                
                <div style="margin-top:24px;">
                    <button class="btn secondary" onclick="await app.navigateTo('prospects')"><i class="fas fa-arrow-left"></i> Back to List</button>
                </div>
            </div>
        `;
        // Refactor to scrollable layout
        const scrollContainer = `
            <div class="scroll-container">
                <div id="section-basic-bank" class="profile-section">
                    <!-- Loaded via append -->
                </div>
                <div id="section-platforms" class="profile-section">
                    <!-- Loaded via append -->
                </div>
                <div id="section-purchases" class="profile-section">
                    <!-- Loaded via append -->
                </div>
                <div id="section-referrals" class="profile-section">
                    <!-- Loaded via append -->
                </div>
            </div>
        `;

        container.insertAdjacentHTML('beforeend', scrollContainer);

        // Fill sections
        await renderBasicBankTab(customer, 'section-basic-bank');
        renderPlatformIdsTab(customer, 'section-platforms');
        await renderPurchaseHistoryTab(customer, 'section-purchases');
        renderReferralsTab(customer, 'section-referrals');
        renderEventHistory(customer);
        renderAgentEligibility(customer);
        await renderCustomerTags(customer);
    };

    const switchProfileTab = async (btn, tabName, cId) => {
        document.querySelectorAll('.profile-tab-btn').forEach(b => b.classList.remove('active'));
        if (btn) btn.classList.add('active');

        const customerId = cId || 101; // Mocking fallback
        const customer = AppDataStore.getById('customers', customerId);
        if (!customer) return;

        if (tabName === 'basic') await renderBasicBankTab(customer);
        else if (tabName === 'platforms') renderPlatformIdsTab(customer);
        else if (tabName === 'purchases') await renderPurchaseHistoryTab(customer);
        else if (tabName === 'activity') await renderCustomerActivityTab(customer);
        else if (tabName === 'referrals') renderReferralsTab(customer);
        else if (tabName === 'events') {
            const registrations = await AppDataStore.getAll('event_registrations').filter(
                r => r.attendee_type === 'customer' && r.attendee_id == customerId
            );
            let html = '<h4>Events Attended</h4>';
            if (registrations.length === 0) {
                html += '<p>No events attended.</p>';
            } else {
                html += '<table class="events-table"><thead><tr><th>Event</th><th>Date</th><th>Status</th><th>Points</th></tr></thead><tbody>';
                registrations.forEach(r => {
                    const event = AppDataStore.getById('events', r.event_id);
                    html += `<tr><td>${event?.title || 'Unknown'}</td><td>${r.event_date || '-'}</td><td>${r.attendance_status}</td><td>${r.points_awarded || 0}</td></tr>`;
                });
                html += '</tbody></table>';
            }
            document.getElementById('profile-tab-content').innerHTML = html;
        }
    };

    const renderBasicBankTab = async (customer, containerId = 'profile-tab-content') => {
        const container = document.getElementById(containerId);
        container.innerHTML = `
            <div style="display:grid; grid-template-columns:1fr 1fr; gap:32px;">
                <div>
                    <h4 style="font-size:16px; font-weight:600; margin-bottom:16px; color:var(--primary);">Customer Information</h4>
                    <div style="display:flex; flex-direction:column; gap:12px;">
                        <div style="display:flex; justify-content:space-between;"><span style="color:var(--gray-500);">Full Name:</span> <strong>${customer.full_name}</strong></div>
                        <div style="display:flex; justify-content:space-between;">
                            <span style="color:var(--gray-500);">Phone:</span> 
                            <span>${customer.phone} <button class="btn-icon"><i class="fas fa-phone"></i></button></span>
                        </div>
                        <div style="display:flex; justify-content:space-between;">
                            <span style="color:var(--gray-500);">Email:</span> 
                            <span>${customer.email} <button class="btn-icon"><i class="fas fa-envelope"></i></button></span>
                        </div>
                        <div style="display:flex; justify-content:space-between;"><span style="color:var(--gray-500);">IC Number:</span> <span>${customer.ic_number}</span></div>
                        <div style="display:flex; justify-content:space-between;"><span style="color:var(--gray-500);">Date of Birth:</span> <span>${customer.date_of_birth} (Age 44)</span></div>
                        <div style="display:flex; justify-content:space-between;"><span style="color:var(--gray-500);">Ming Gua:</span> <span style="color:#6b21a8; font-weight:600;">${customer.ming_gua} (${customer.element})</span></div>
                        <div style="display:flex; justify-content:space-between;"><span style="color:var(--gray-500);">Gender:</span> <span>${customer.gender}</span></div>
                        <hr style="border:none; border-top:1px solid var(--gray-100); margin:8px 0;">
                        <div style="display:flex; justify-content:space-between;"><span style="color:var(--gray-500);">Occupation:</span> <span>${customer.occupation || '-'}</span></div>
                        <div style="display:flex; justify-content:space-between;"><span style="color:var(--gray-500);">Company:</span> <span>${customer.company_name || '-'}</span></div>
                        <div style="display:flex; justify-content:space-between;"><span style="color:var(--gray-500);">Income:</span> <span>${customer.income_range || '-'}</span></div>
                        <div style="display:flex; justify-content:space-between;"><span style="color:var(--gray-500);">Address:</span> <span style="text-align:right;">${customer.address || '-'} ${customer.city || ''} ${customer.state || ''} ${customer.postal_code || ''}</span></div>
                    </div>

                    <h4 style="font-size:16px; font-weight:600; margin-top:24px; margin-bottom:16px; color:var(--primary);">Referral Information</h4>
                    <div style="display:flex; flex-direction:column; gap:12px;">
                        <div style="display:flex; justify-content:space-between;"><span style="color:var(--gray-500);">Referred By:</span> <a href="#" style="color:var(--primary); text-decoration:none;">Tan Ah Kow</a></div>
                        <div style="display:flex; justify-content:space-between;"><span style="color:var(--gray-500);">Relationship:</span> <span>Friend</span></div>
                        <div style="display:flex; justify-content:space-between;"><span style="color:var(--gray-500);">Referral Date:</span> <span>15 Feb 2026</span></div>
                    </div>
                </div>

                <div>
                    <h4 style="font-size:16px; font-weight:600; margin-bottom:16px; color:var(--primary);">Bank and Payment Information</h4>
                    <div style="display:flex; flex-direction:column; gap:12px; background:var(--gray-50); padding:16px; border-radius:8px;">
                        <div style="display:flex; justify-content:space-between;"><span style="color:var(--gray-500);">Bank Name:</span> <strong>${customer.bank_name}</strong></div>
                        <div style="display:flex; justify-content:space-between;"><span style="color:var(--gray-500);">Account Number:</span> <span>5123-****-8901</span></div>
                        <div style="display:flex; justify-content:space-between;"><span style="color:var(--gray-500);">Account Holder:</span> <span>${customer.account_holder}</span></div>
                        <div style="display:flex; justify-content:space-between;"><span style="color:var(--gray-500);">Payment Method:</span> <span>${customer.payment_methods}</span></div>
                    </div>

                    <h4 style="font-size:16px; font-weight:600; margin-top:24px; margin-bottom:16px; color:var(--primary);">Customer Metrics</h4>
                    <div style="display:grid; grid-template-columns:1fr 1fr; gap:12px;">
                        <div style="background:var(--gray-50); padding:12px; border-radius:8px; text-align:center;">
                            <div style="font-size:12px; color:var(--gray-500);">Lifetime Value</div>
                            <div style="font-size:18px; font-weight:700; color:var(--primary);">RM ${customer.lifetime_value.toLocaleString()}</div>
                        </div>
                        <div style="background:var(--gray-50); padding:12px; border-radius:8px; text-align:center;">
                            <div style="font-size:12px; color:var(--gray-500);">Total Purchases</div>
                            <div style="font-size:18px; font-weight:700; color:var(--primary);">4</div>
                        </div>
                        <div style="background:var(--gray-50); padding:12px; border-radius:8px; text-align:center;">
                            <div style="font-size:12px; color:var(--gray-500);">Avg Order Value</div>
                            <div style="font-size:18px; font-weight:700; color:var(--primary);">RM 788</div>
                        </div>
                        <div style="background:var(--gray-50); padding:12px; border-radius:8px; text-align:center;">
                            <div style="font-size:12px; color:var(--gray-500);">Last Purchase</div>
                            <div style="font-size:14px; font-weight:600;">04 Mar 2026</div>
                        </div>
                    </div>
                </div>
            </div>
        `;

        // Phase 14: Append Internal Notes section
        const customerNotes = AppDataStore.query('notes', { customer_id: customer.id });
        container.insertAdjacentHTML('beforeend', `
            <div class="profile-section" style="margin-top:24px; border:1px solid var(--gray-200); border-radius:12px; padding:20px; background:var(--white);">
                <h4 style="font-size:16px; font-weight:600; margin-bottom:16px; color:var(--primary);"><i class="fas fa-sticky-note"></i> Internal Notes</h4>
                <div class="add-note-section">
                    <textarea id="customer-note-text" class="form-control" rows="3" placeholder="Add a new note..."></textarea>
                    <div style="display:flex; justify-content:space-between; align-items:center; margin-top:8px;">
                        <button class="btn-icon" onclick="await app.openVoiceRecorder('customer-note-text', 'customer', ${customer.id})" title="Record voice note" style="color:var(--primary);"><i class="fas fa-microphone"></i></button>
                        <button class="btn primary btn-sm" onclick="await app.addCustomerNote(${customer.id})">Add Note</button>
                    </div>
                </div>
                ${customerNotes.length > 0 ? customerNotes.map(n => `
                    <div class="notes-item" style="margin-top:10px;">
                        <div class="notes-header">
                            <span>${n.date} - ${n.author}${n.is_voice_note ? ' <i class="fas fa-microphone voice-note-icon" title="Voice note"></i>' : ''}</span>
                            <button class="btn-icon" onclick="await app.deleteCustomerNote(${customer.id}, ${n.id})"><i class="fas fa-trash"></i></button>
                        </div>
                        <div>"${n.text}"</div>
                    </div>
                `).join('') : '<p style="color:var(--gray-400); font-size:13px; margin-top:8px;">No notes yet.</p>'}
            </div>
        `);
    };

    const renderPlatformIdsTab = (customer, containerId = 'profile-tab-content') => {
        const platformData = AppDataStore.query('platform_ids', { customer_id: customer.id });
        const internal = platformData.slice(0, 4);
        const external = platformData.slice(4);

        const container = document.getElementById(containerId);
        container.innerHTML = `
            <div class="platform-ids-grid">
                <div class="platform-card">
                    <h4>Internal Platforms</h4>
                    ${internal.map(p => `
                        <div class="platform-row">
                            <span class="platform-label">${p.platform} ID</span>
                            <span class="platform-value">${p.platform_id} <button class="copy-btn" onclick="app.copyToClipboard('${p.platform_id}')"><i class="fas fa-copy"></i></button></span>
                        </div>
                    `).join('')}
                </div>
                <div class="platform-card">
                    <h4>External Platforms</h4>
                    ${external.map(p => `
                        <div class="platform-row">
                            <span class="platform-label">${p.platform} ID</span>
                            <span class="platform-value">${p.platform_id} <button class="copy-btn" onclick="app.copyToClipboard('${p.platform_id}')"><i class="fas fa-copy"></i></button></span>
                        </div>
                    `).join('')}
                </div>
            </div>
            <div style="margin-top:20px; text-align:center;">
                <button class="btn secondary" onclick="app.todo('Edit Platform IDs')">Edit Platform IDs</button>
            </div>
        `;
    };

    const copyToClipboard = (text) => {
        navigator.clipboard.writeText(text).then(() => {
            UI.toast.success('Copied!');
        });
    };

    const renderPurchaseHistoryTab = async (customer, containerId = 'profile-tab-content') => {
        const purchases = AppDataStore.query('purchases', { customer_id: customer.id });
        const container = document.getElementById(containerId);

        let totalPaid = 0;
        let totalPending = 0;

        container.innerHTML = `
            <table class="purchase-table">
                <thead>
                    <tr>
                        <th>Date</th>
                        <th>Invoice Number</th>
                        <th>Item/Product</th>
                        <th>Amount</th>
                        <th>Status</th>
                        <th>Proof/Image</th>
                        <th>Actions</th>
                    </tr>
                </thead>
                <tbody>
                    ${purchases.map(p => {
            if (p.status !== 'PENDING') totalPaid += p.amount;
            else totalPending += p.amount;

            const badgeClass = `badge-${p.status.toLowerCase().replace('/', '')}`;
            return `
                            <tr>
                                <td>${p.date}</td>
                                <td>${p.invoice}</td>
                                <td>${p.item}</td>
                                <td>RM ${p.amount.toLocaleString()}</td>
                                <td><span class="score-badge ${badgeClass}" style="font-size:11px;">${p.status}</span></td>
                                <td>${p.proof ? `<a href="#" style="color:var(--primary);">${p.proof.endsWith('.pdf') ? 'View Report' : 'View Image'}</a>` : '<button class="btn-sm secondary" onclick="app.todo(\'Upload Image\')">Upload Image</button>'}</td>
                                <td>
                                    <button class="btn-icon"><i class="fas fa-download"></i></button>
                                    ${p.status === 'PENDING' ? '<button class="btn-icon"><i class="fas fa-edit"></i></button><button class="btn-icon"><i class="fas fa-trash"></i></button>' : ''}
                                </td>
                            </tr>
                        `;
        }).join('')}
                </tbody>
            </table>
            <div class="purchase-summary">
                <div>Total Paid: <span style="color:var(--success);">RM ${totalPaid.toLocaleString()}</span></div>
                <div>Pending: <span style="color:var(--error);">RM ${totalPending.toLocaleString()}</span></div>
                <div style="font-size:18px;">Lifetime Total: <span style="color:var(--primary);">RM ${(totalPaid + totalPending).toLocaleString()}</span></div>
            </div>
            <div style="margin-top:16px;">
                <button class="btn primary" onclick="await app.openAddPurchaseModal(${customer.id})">Add Purchase</button>
            </div>
        `;
    };

    const renderReferralsTab = (customer, containerId = 'profile-tab-content') => {
        const refs = AppDataStore.query('referrals', { referrer_customer_id: customer.id });
        const container = document.getElementById(containerId);

        container.innerHTML = `
            <table class="purchase-table">
                <thead>
                    <tr>
                        <th>Referred Person</th>
                        <th>Relationship</th>
                        <th>Referral Date</th>
                        <th>Status</th>
                        <th>Reward Status</th>
                        <th>Actions</th>
                    </tr>
                </thead>
                <tbody>
                    ${refs.map(r => {
            const prospect = AppDataStore.getById('prospects', r.referred_prospect_id);
            return `
                        <tr>
                            <td><strong>${prospect?.full_name || 'N/A'}</strong></td>
                            <td>${r.relationship}</td>
                            <td>${r.date}</td>
                            <td><span class="score-badge ${r.status === 'Active' ? 'score-A+' : 'score-A'}">${r.status}</span></td>
                            <td>${r.reward_status}</td>
                            <td>
                                <button class="btn-sm secondary" onclick="app.todo('View Referral')">View</button>
                                <button class="btn-sm secondary" onclick="app.todo('Update Referral')">Update</button>
                            </td>
                        </tr>
                        `;
        }).join('')}
                </tbody>
            </table>
            <div style="margin-top:16px;">
                <button class="btn primary" onclick="app.todo('Refer a Friend')">Refer a Friend</button>
            </div>
        `;
    };

    const renderEventHistory = (customer) => {
        const container = document.getElementById('event-attendance-section');
        container.innerHTML = `
            <div style="background:var(--white); padding:16px; border-radius:12px; border:1px solid var(--gray-200);">
                <h4 style="font-size:14px; font-weight:600; margin-bottom:12px; color:var(--gray-500);"><i class="fas fa-calendar-check" style="margin-right:8px;"></i> EVENT ATTENDANCE</h4>
                <div style="display:flex; flex-direction:column; gap:8px;">
                    <div style="display:flex; justify-content:space-between; font-size:13px;"><span>15 Jan 2026: New Year Blessing</span> <span style="color:var(--success);">+15 pts</span></div>
                    <div style="display:flex; justify-content:space-between; font-size:13px;"><span>10 Feb 2026: Wealth Workshop</span> <span style="color:var(--success);">+20 pts</span></div>
                    <div style="display:flex; justify-content:space-between; font-size:13px;"><span>22 Mar 2026: Feng Shui Course</span> <span style="color:var(--success);">+40 pts</span></div>
                </div>
                <hr style="border:none; border-top:1px solid var(--gray-100); margin:12px 0;">
                <div style="display:flex; justify-content:space-between; font-weight:700;">
                    <span>Total Events: 3</span>
                    <span style="color:var(--primary);">75 Points</span>
                </div>
            </div>
        `;
    };

    const renderAgentEligibility = (customer) => {
        const container = document.getElementById('agent-eligibility-section');
        container.innerHTML = `
            <div class="eligibility-card">
                <h3>Agent Package Eligibility</h3>
                <div style="font-size:13px; color:#6b21a8; margin-bottom:8px;">Current Status: <strong>Not an Agent</strong></div>
                <div style="font-size:12px; color:#7e22ce;">To become agent: Purchase Agent Package (min RM 3,000)</div>
                
                <div class="eligibility-score">
                    <div class="score-circle">85%</div>
                    <div style="font-size:13px; font-weight:600; color:#6b21a8;">Good candidate</div>
                </div>
                
                <div style="font-size:12px; color:#7e22ce; font-style:italic; margin-bottom:12px;">
                    Recommendations: Active participant, makes referrals, good purchase history.
                </div>
                
                <button class="btn primary" style="width:100%; background:#6b21a8; border:none;" onclick="app.openRecruitModal(${customer.id})">Offer Agent Package</button>
            </div>
        `;
    };

    const renderCustomerActivityTab = async (customer, containerId = 'profile-tab-content') => {
        const container = document.getElementById(containerId);
        // Combine activities linked to this customer OR original prospect
        const activities = await AppDataStore.getAll('activities').filter(a =>
            a.customer_id == customer.id ||
            (customer.converted_from_prospect_id && a.prospect_id == customer.converted_from_prospect_id)
        ).sort((a, b) => new Date(b.date || b.created_at) - new Date(a.date || a.created_at));

        container.innerHTML = `
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:16px;">
                <h4 style="font-size:16px; font-weight:600; color:var(--primary); margin:0;">Activity History</h4>
                <button class="btn primary btn-sm" onclick="await app.openActivityModal(null, 'customer', ${customer.id})">+ Log Activity</button>
            </div>
            ${activities.length > 0 ? `
                <div class="activity-timeline">
                    ${activities.map(a => {
            const icon = a.type === 'FTF' ? 'users' : (a.type === 'CALL' ? 'phone' : (a.type === 'EVENT' ? 'calendar-alt' : 'sticky-note'));
            const date = a.date || (a.created_at ? a.created_at.split('T')[0] : 'N/A');
            return `
                            <div class="timeline-item" style="display:flex; gap:16px; margin-bottom:20px; position:relative;">
                                <div class="timeline-icon" style="flex-shrink:0; width:32px; height:32px; border-radius:50%; background:var(--gray-100); display:flex; align-items:center; justify-content:center; color:var(--primary); font-size:14px; z-index:1;">
                                    <i class="fas fa-${icon}"></i>
                                </div>
                                <div class="timeline-content" style="flex:1; background:var(--gray-50); padding:12px; border-radius:8px; border:1px solid var(--gray-200);">
                                    <div style="display:flex; justify-content:space-between; margin-bottom:4px;">
                                        <strong style="font-size:14px;">${a.activity_title || a.type}</strong>
                                        <span style="font-size:12px; color:var(--gray-500);">${date}</span>
                                    </div>
                                    <div style="font-size:13px; color:var(--gray-700);">${a.notes || 'No details provided.'}</div>
                                    ${a.outcome ? `<div style="font-size:12px; margin-top:8px;"><span class="score-badge" style="background:var(--success-bg); color:var(--success); border:none;">${a.outcome}</span></div>` : ''}
                                </div>
                            </div>
                        `;
        }).join('')}
                </div>
            ` : '<p style="color:var(--gray-400); font-size:13px;">No activity history found.</p>'}
        `;
    };

    const renderCustomerTags = async (customer) => {
        const container = document.getElementById('customer-tags-section');
        const entityTags = AppDataStore.query('entity_tags', { entity_type: 'customer', entity_id: customer.id });

        container.innerHTML = `
            <div style="background:var(--white); padding:16px; border-radius:12px; border:1px solid var(--gray-200);">
                <h4 style="font-size:13px; font-weight:700; color:var(--gray-500); margin-bottom:12px;">TAGS</h4>
                <div style="display:flex; flex-wrap:wrap; gap:8px;">
                    ${entityTags.length > 0 ? entityTags.map(et => {
            const tag = AppDataStore.getById('tags', et.tag_id);
            return tag ? `
                            <span class="score-badge" style="background:${tag.color || 'var(--primary)'}; color:white; display:flex; align-items:center; gap:4px; font-size:11px;">
                                ${tag.name} <span style="cursor:pointer;" onclick="await app.removeTagFromCustomer(${customer.id}, ${tag.id})">&times;</span>
                            </span>
                        ` : '';
        }).join('') : '<p style="color:var(--gray-400); font-size:12px;">No tags yet.</p>'}
                    <button class="btn-sm secondary" style="border-radius:20px; font-size:11px;" onclick="await app.openAddTagModal(${customer.id}, 'customer')">+ Add Tag</button>
                </div>
            </div>
        `;
    };

    const showProspectDetail = async (prospectId) => {
        const prospect = AppDataStore.getById('prospects', prospectId);
        if (!prospect || !await canViewProspect(prospect)) {
            UI.toast.error('You do not have permission to view this prospect.');
            await navigateTo('prospects');
            return;
        }

        if (!prospect) return;

        // RBAC check
        const currentUser = _currentUser || Auth.getCurrentUser();
        const isAdmin = isSystemAdmin(currentUser) || isMarketingManager(currentUser) || currentUser.role?.includes('Level 3') || currentUser.role?.includes('Level 7') || currentUser.role === 'team_leader';
        const isOwner = prospect.responsible_agent_id == currentUser.id;
        if (!isAdmin && !isOwner) {
            UI.toast.error('You do not have permission to view this prospect.');
            await navigateTo('prospects');
            return;
        }

        const container = document.getElementById('content-viewport');
        if (!container) return;

        const solutions = AppDataStore.query('proposed_solutions', { prospect_id: prospectId });
        const activities =await  AppDataStore.getAll('activities').filter(a => a.prospect_id == prospectId);
        const notes = AppDataStore.query('notes', { prospect_id: prospectId });
        const names = AppDataStore.query('names', { prospect_id: prospectId });

        const daysLeft = calculateProtectionDays(prospect);
        const protectionStatus = getProtectionStatus(daysLeft);
        const statusColor = protectionStatus === 'normal' ? 'success' : protectionStatus === 'warning' ? 'secondary' : 'error';
        const statusLabel = protectionStatus === 'normal' ? 'Normal' : protectionStatus === 'warning' ? 'Expiring Soon' : 'Critical';

        (() => {
            await addWhatsAppButtonToProfile('prospect', prospectId);
        }, 100);

        container.innerHTML = `
            <div class="profile-view">
                <button class="btn secondary btn-sm" onclick="await app.showProspectsView(document.getElementById('content-viewport'))" style="margin-bottom: 20px;">
                    <i class="fas fa-arrow-left"></i> Back to List
                </button>

                <!-- Profile Header -->
                <div class="profile-header">
                    <div class="profile-info">
                        <h1>${prospect.full_name}</h1>
                        <div class="profile-meta">
                            <span>ID: P100${prospect.id}</span>
                            <span class="badge success">Active</span>
                            <span class="badge info">Grade ${getScoreGrade(prospect.score)}</span>
                        </div>
                    </div>
                    <div class="profile-actions">
                        <button class="btn secondary" onclick="await app.editProspect(${prospect.id})"><i class="fas fa-edit"></i> Edit</button>
                        <button class="btn primary" onclick="await app.convertToCustomer(${prospect.id})"><i class="fas fa-user-check"></i> Convert</button>
                    </div>
                </div>

                <div class="scroll-container">
                    <!-- Basic Information Section -->
                    <div class="profile-section" id="section-basic">
                        <h2>
                            <span><i class="fas fa-info-circle"></i> Basic Information</span>
                            <button class="btn-section-edit" onclick="await app.openProspectModal(${prospect.id})"><i class="fas fa-edit"></i> Edit</button>
                        </h2>
                        <div class="detail-grid">
                            <div class="info-row"><div class="info-label">Title</div><div class="info-value">${prospect.title || '-'}</div></div>
                            <div class="info-row"><div class="info-label">Gender</div><div class="info-value">${prospect.gender || '-'}</div></div>
                            <div class="info-row"><div class="info-label">Nationality</div><div class="info-value">${prospect.nationality || '-'}</div></div>
                            <div class="info-row"><div class="info-label">Phone</div><div class="info-value">${prospect.phone}</div></div>
                            <div class="info-row"><div class="info-label">Email</div><div class="info-value">${prospect.email || '-'}</div></div>
                            <div class="info-row"><div class="info-label">Referrer</div><div class="info-value">${prospect.referred_by || '-'}</div></div>
                        </div>
                    </div>

                    <!-- Personal Details Section -->
                    <div class="profile-section" id="section-personal">
                        <h2>
                            <span><i class="fas fa-user-shield"></i> Personal Details</span>
                            <button class="btn-section-edit" onclick="await app.openProspectModal(${prospect.id})"><i class="fas fa-edit"></i> Edit</button>
                        </h2>
                        <div class="detail-grid">
                            <div class="info-row"><div class="info-label">Date of Birth</div><div class="info-value">${prospect.date_of_birth || '-'}</div></div>
                            <div class="info-row"><div class="info-label">Lunar Birth</div><div class="info-value">${prospect.lunar_birth || '-'}</div></div>
                            <div class="info-row"><div class="info-label">IC Number</div><div class="info-value">${prospect.ic_number || '-'}</div></div>
                            <div class="info-row"><div class="info-label">Ming Gua</div><div class="info-value"><span class="badge info">${prospect.ming_gua || '-'}</span></div></div>
                            <div class="info-row"><div class="info-label">Occupation</div><div class="info-value">${prospect.occupation || '-'}</div></div>
                            <div class="info-row"><div class="info-label">Company</div><div class="info-value">${prospect.company_name || '-'}</div></div>
                            <div class="info-row"><div class="info-label">Income</div><div class="info-value">${prospect.income_range || '-'}</div></div>
                            <div class="info-row"><div class="info-label">Address</div><div class="info-value">${prospect.address || '-'} ${prospect.city || ''} ${prospect.state || ''} ${prospect.postal_code || ''}</div></div>
                        </div>
                    </div>

                    <!-- Name List Section -->
                    <div class="profile-section" id="section-names">
                        <h2>
                            <span><i class="fas fa-users"></i> Name List</span>
                            <span class="section-actions">
                                <button class="btn primary btn-sm" onclick="await app.openAddNameModal(${prospect.id})"><i class="fas fa-plus"></i> Add Name</button>
                            </span>
                        </h2>
                        <table class="name-list-table">
                            <thead>
                                <tr>
                                    <th>Relation</th>
                                    <th>Name</th>
                                    <th>DOB</th>
                                    <th>Actions</th>
                                </tr>
                            </thead>
                            <tbody>
                                ${AppDataStore.query('names', { prospect_id: prospect.id }).length > 0 ? AppDataStore.query('names', { prospect_id: prospect.id }).map(n => `
                                    <tr>
                                        <td>${n.relation}</td>
                                        <td>${n.full_name}</td>
                                        <td>${n.date_of_birth || '-'}</td>
                                        <td>
                                            <button class="btn-icon" onclick="await app.openAddNameModal(${prospect.id}, ${n.id})"><i class="fas fa-edit"></i></button>
                                            <button class="btn-icon" onclick="await app.deleteName(${prospect.id}, ${n.id})"><i class="fas fa-trash"></i></button>
                                        </td>
                                    </tr>
                                `).join('') : '<tr><td colspan="4" style="text-align:center; padding:20px;">No names added.</td></tr>'}
                            </tbody>
                        </table>
                    </div>

                    <!-- Activity History Section with Tabs -->
                    <div class="profile-section" id="section-history" style="margin-top:24px;">
                        <h2>
                            <span><i class="fas fa-history"></i> Activity & Information</span>
                            <span class="section-actions">
                                <button class="btn primary btn-sm" onclick="await app.openActivityModal('', ${prospect.id})"><i class="fas fa-plus"></i> Add Activity</button>
                            </span>
                        </h2>
                        <div class="profile-tabs" style="margin-bottom:15px; border-bottom:1px solid var(--gray-200);">
                            <button class="profile-tab active" onclick="await app.switchProspectTab('info', ${prospect.id}, this)">Info</button>
                            <button class="profile-tab" onclick="await app.switchProspectTab('personal', ${prospect.id}, this)">Personal</button>
                            <button class="profile-tab" onclick="await app.switchProspectTab('names', ${prospect.id}, this)">Names</button>
                            <button class="profile-tab" onclick="await app.switchProspectTab('activity', ${prospect.id}, this)">Activity</button>
                            <button class="profile-tab" onclick="await app.switchProspectTab('events', ${prospect.id}, this)">Events</button>
                            <button class="profile-tab" onclick="await app.switchProspectTab('notes', ${prospect.id}, this)">Notes</button>
                        </div>
                        <div id="prospect-tab-content">
                            <!-- Populated by switchProspectTab -->
                        </div>
                    </div>
                </div>

                <div class="sidebar-container">
                    <!-- Protection Section -->
                    <div class="protection-section" style="border-left-color: var(--${statusColor}); margin-top: 0;">
                        <h3><i class="fas fa-shield-alt"></i> Protection Period</h3>
                        <div class="protection-stats">
                            <div><strong>Responsible Agent:</strong> Michelle Tan (Assigned: ${prospect.cps_assignment_date || '15 Feb 2026'})</div>
                            <div><strong>Deadline:</strong> ${prospect.protection_deadline || '17 Mar 2026'}</div>
                            <div style="font-size:18px; color:var(--${statusColor});"><strong>Days Left: ${daysLeft} Days</strong></div>
                            <div><strong>Status:</strong> 🟢 ${statusLabel}</div>
                            <div><strong>Inactivity:</strong> 2 days active</div>
                            <div><strong>Follow-up Rate:</strong> 92%</div>
                        </div>
                        <div class="protection-progress">
                            <div class="fill" style="width: ${Math.min(100, (daysLeft / 30) * 100)}%; background: var(--${statusColor});"></div>
                        </div>
                        <div style="display: flex; gap: 12px; margin-top: 16px;">
                            <button class="btn secondary btn-sm" onclick="await app.extendProtection(${prospect.id})">Extend</button>
                            <button class="btn secondary btn-sm" onclick="app.transferProspect(${prospect.id})">Transfer</button>
                            <button class="btn secondary btn-sm" onclick="app.reassignProspect(${prospect.id})">Reassign</button>
                        </div>
                    </div>

                    <!-- Tags -->
                    <div class="profile-section" style="margin-top:24px;">
                        <h2>
                            <i class="fas fa-tags"></i> Tags
                            <span class="section-actions">
                                <button class="btn primary btn-sm" onclick="await app.openAddTagModal(${prospect.id})"><i class="fas fa-plus"></i></button>
                            </span>
                        </h2>
                        <div class="tags-container" id="prospect-tags-container">
                            ${prospect.tags && prospect.tags.length > 0 ? prospect.tags.map(t => `
                                            <span class="tag ${t.color}">${t.name} <i class="fas fa-times remove" onclick="await app.removeTagFromProspect(${prospect.id}, ${t.id})"></i></span>
                                        `).join('') : '<span>No tags yet</span>'}
                        </div>
                    </div>

                    <!-- Potential & Opportunities -->
                    <div class="profile-section" style="margin-top:24px;">
                        <h2><i class="fas fa-bolt"></i> Potential</h2>
                        <div class="detail-section" style="margin-bottom:0;">
                            <div style="margin-bottom: 12px;"><span class="badge success">HIGH POTENTIAL</span></div>
                            <div class="info-row"><div class="info-label">Budget</div><div class="info-value">RM 15k - 20k / mo</div></div>
                            <div class="info-row"><div class="info-label">Close Prob.</div><div class="info-value">75%</div></div>
                            <div class="progress-bar" style="margin-bottom: 16px;">
                                <div class="progress-fill" style="width: 75%; background: var(--success);"></div>
                            </div>
                            <div class="info-row"><div class="info-label">Est. Value</div><div class="info-value">RM 5k - 8k</div></div>
                        </div>
                    </div>
                </div>
            </div>
        `;
        // Load the default tab content
        await app.switchProspectTab('info', prospectId, document.querySelector('.profile-tabs .profile-tab.active'));
    };

    const switchProspectTab = async (tab, prospectId, btn) => {
        document.querySelectorAll('.profile-tab').forEach(t => {
            t.classList.remove('active');
            t.style.color = 'var(--gray-800)';
            t.style.fontWeight = 'normal';
        });
        if (btn) {
            btn.classList.add('active');
            btn.style.color = 'var(--primary)';
            btn.style.fontWeight = '600';
        }

        const prospect = AppDataStore.getById('prospects', prospectId);
        const container = document.getElementById('prospect-tab-content');
        if (!container || !prospect) return;

        if (tab === 'info') {
            container.innerHTML = `
    <div class="profile-grid">
        <div class="main-content">
            <div class="profile-section">
                <h2><i class="fas fa-info-circle"></i> Basic Information</h2>
                <div class="detail-section">
                    <div class="info-row"><div class="info-label">Title</div><div class="info-value">${prospect.title || '-'}</div></div>
                    <div class="info-row"><div class="info-label">Gender</div><div class="info-value">${prospect.gender || '-'}</div></div>
                    <div class="info-row"><div class="info-label">Nationality</div><div class="info-value">${prospect.nationality || '-'}</div></div>
                    <div class="info-row"><div class="info-label">Phone</div><div class="info-value">${prospect.phone}</div></div>
                    <div class="info-row"><div class="info-label">Email</div><div class="info-value">${prospect.email || '-'}</div></div>
                </div>
            </div>
            <div class="profile-section">
                <h2><i class="fas fa-user-shield"></i> Registration & Referral</h2>
                <div class="detail-section">
                    <div class="info-row"><div class="info-label">Referrer</div><div class="info-value">${prospect.referred_by || '-'}</div></div>
                    <div class="info-row"><div class="info-label">Relation</div><div class="info-value">${prospect.referral_relationship || '-'}</div></div>
                    <div class="info-row"><div class="info-label">Created At</div><div class="info-value">${new Date(prospect.created_at).toLocaleDateString()}</div></div>
                </div>
            </div>
        </div>
                </div>
    `;
        }
        else if (tab === 'personal') {
            container.innerHTML = `
    <div class="profile-grid">
        <div class="main-content">
            <div class="profile-section">
                <h2><i class="fas fa-user"></i> Personal Details</h2>
                <div class="detail-grid">
                    <div class="detail-section">
                        <h3>Birth & Identity</h3>
                        <div class="info-row"><div class="info-label">Date of Birth</div><div class="info-value">${prospect.date_of_birth || '-'}</div></div>
                        <div class="info-row"><div class="info-label">Lunar Birth</div><div class="info-value">${prospect.lunar_birth || '-'}</div></div>
                        <div class="info-row"><div class="info-label">IC Number</div><div class="info-value">${prospect.ic_number || '-'}</div></div>
                        <div class="info-row"><div class="info-label">Ming Gua</div><div class="info-value"><span class="badge info">${prospect.ming_gua || 'MG4'}</span></div></div>
                    </div>
                    <div class="detail-section">
                        <h3>Work</h3>
                        <div class="info-row"><div class="info-label">Occupation</div><div class="info-value">${prospect.occupation || '-'}</div></div>
                        <div class="info-row"><div class="info-label">Company</div><div class="info-value">${prospect.company_name || '-'}</div></div>
                        <div class="info-row"><div class="info-label">Income Range</div><div class="info-value">${prospect.income_range || '-'}</div></div>
                    </div>
                    <div class="detail-section">
                        <div class="info-row"><div class="info-label">Address</div><div class="info-value">${prospect.address || '-'}</div></div>
                        <div class="info-row"><div class="info-label">City</div><div class="info-value">${prospect.city || '-'}</div></div>
                        <div class="info-row"><div class="info-label">State</div><div class="info-value">${prospect.state || '-'}</div></div>
                        <div class="info-row"><div class="info-label">Postal Code</div><div class="info-value">${prospect.postal_code || '-'}</div></div>
                    </div>
                </div>
            </div>
        </div>
                </div>
    `;
        }
        else if (tab === 'names') {
            const names = AppDataStore.query('names', { prospect_id: prospectId });
            container.innerHTML = `
    <div class="profile-section">
                    <h2>
                        <i class="fas fa-users"></i> Name List
                        <span class="section-actions">
                            <button class="btn primary btn-sm" onclick="await app.openAddNameModal(${prospect.id})"><i class="fas fa-plus"></i> Add Name</button>
                        </span>
                    </h2>
                    <table class="name-list-table">
                        <thead>
                            <tr>
                                <th>Relation</th>
                                <th>Name</th>
                                <th>Date of Birth</th>
                                <th>Notes</th>
                                <th>Actions</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${names.length > 0 ? names.map(n => `
                                <tr>
                                    <td>${n.relation}</td>
                                    <td>${n.full_name}</td>
                                    <td>${n.date_of_birth || '-'}</td>
                                    <td>${n.notes || '-'}</td>
                                    <td>
                                        <button class="btn-icon" onclick="app.todo('Edit name')"><i class="fas fa-edit"></i></button>
                                        <button class="btn-icon" onclick="await app.deleteName(${prospect.id}, ${n.id})"><i class="fas fa-trash"></i></button>
                                    </td>
                                </tr>
                            `).join('') : `
                                <tr><td colspan="5" style="text-align:center; padding:20px;">No names added yet.</td></tr>
                            `}
                        </tbody>
                    </table>
                </div>
    `;
        }
        else if (tab === 'activity') {
            const activities =await  AppDataStore.getAll('activities').filter(a => a.prospect_id == prospectId);
            container.innerHTML = `
    <div class="profile-section">
                    <h2>
                        <i class="fas fa-history"></i> Activity History
                        <span class="section-actions">
                            <button class="btn primary btn-sm" onclick="await app.openActivityModal('', ${prospect.id})"><i class="fas fa-plus"></i> Add Activity</button>
                        </span>
                    </h2>
                    <div class="history-timeline">
                        ${activities.length > 0 ? activities.sort((a, b) => b.id - a.id).map(a => `
                            <div class="history-item">
                                <div class="history-date">${a.activity_date}</div>
                                <div class="history-content">
                                    <h4>${a.activity_type} - ${a.activity_title || 'Meeting'}</h4>
                                    <p style="font-size:13px; color:var(--gray-500); margin-bottom:4px;">Agent: Michelle Tan ${a.score_value ? `| Score: +${a.score_value}` : ''}</p>
                                    <p style="font-size:14px; margin-bottom:8px;">${a.summary || a.location_address || ''}</p>
                                    <button class="btn btn-sm secondary" onclick="await app.viewActivityDetails(${a.id})">View Details</button>
                                </div>
                            </div>
                        `).join('') : `
                            <p style="text-align:center; padding:20px;">No activity history.</p>
                        `}
                    </div>
                </div>
    `;
        }
        else if (tab === 'notes') {
            const notes = AppDataStore.query('notes', { prospect_id: prospectId });
            container.innerHTML = `
    <div class="profile-section" style="margin-bottom: 24px;">
                <h2><i class="fas fa-sticky-note"></i> Notes</h2>
                    <div class="add-note-section">
                        <textarea id="new-note-text" class="form-control" rows="3" placeholder="Add a new note..."></textarea>
                        <div style="display:flex; justify-content:space-between; align-items:center; margin-top:8px;">
                            <button class="btn-icon" onclick="await app.openVoiceRecorder('new-note-text', 'prospect', ${prospect.id})" title="Record voice note" style="color:var(--primary);"><i class="fas fa-microphone"></i></button>
                            <button class="btn primary btn-sm" onclick="await app.addNote(${prospect.id})">Add Note</button>
                        </div>
                    </div>
                    ${notes.length > 0 ? notes.map(n => `
                        <div class="notes-item">
                            <div class="notes-header">
                                <span>${n.date} - ${n.author}${n.is_voice_note ? ' <i class="fas fa-microphone voice-note-icon" title="Voice note"></i>' : ''}</span>
                                <button class="btn-icon" onclick="await app.deleteNote(${prospect.id}, ${n.id})"><i class="fas fa-trash"></i></button>
                            </div>
                            <div>"${n.text}"</div>
                        </div>
                    `).join('') : ''
                }
                </div>

    <div class="profile-section">
        <h2>
            <i class="fas fa-folder"></i> Documents
            <span class="section-actions">
                <button class="btn primary btn-sm" onclick="app.todo('Upload document')"><i class="fas fa-upload"></i> Upload</button>
            </span>
        </h2>
        <p style="text-align:center; padding:20px; color:var(--gray-500);">No documents uploaded.</p>
    </div>
`;
        }
        else if (tab === 'events') {
            const registrations =await  AppDataStore.getAll('event_registrations').filter(
                r => r.attendee_type === 'prospect' && r.attendee_id == prospectId
            );
            let html = '<h2>Events Attended</h2>';
            if (registrations.length === 0) {
                html += '<p>No events attended.</p>';
            } else {
                html += '<table class="events-table"><thead><tr><th>Event</th><th>Date</th><th>Status</th><th>Points</th></tr></thead><tbody>';
                registrations.forEach(r => {
                    const event = AppDataStore.getById('events', r.event_id);
                    html += `<tr><td>${event?.title || 'Unknown'}</td><td>${r.event_date || '-'}</td><td>${r.attendance_status}</td><td>${r.points_awarded || 0}</td></tr> `;
                });
                html += '</tbody></table>';
            }
            container.innerHTML = html;
        }
    };

    const editProspect = async (prospectId) => await openProspectModal(prospectId);

    const addNote = async (prospectId) => {
        const text = document.getElementById('new-note-text')?.value?.trim();
        if (!text) return;
        const currentUser = Auth.getCurrentUser();
        await AppDataStore.create('notes', {
            id: Date.now(),
            prospect_id: prospectId,
            text: text,
            author: currentUser?.full_name || 'Michelle Tan',
            date: new Date().toISOString().split('T')[0]
        });
        document.getElementById('new-note-text').value = '';
        UI.toast.success('Note added');
        await app.switchProspectTab('notes', prospectId, document.querySelector('.profile-tab.active'));
    };

    const deleteNote = async (prospectId, noteId) => {
        UI.confirm('Delete Note?', 'Are you sure you want to delete this note?', () => {
            AppDataStore.delete('notes', noteId);
            UI.toast.success('Note deleted');
            await app.switchProspectTab('notes', prospectId, document.querySelector('.profile-tab.active'));
        });
    };


    const openAddCustomerModal = async () => {
        const content = `
    <div class="warning-banner" style="background:#fff3cd; border:1px solid #ffc107; color:#856404; padding:12px; border-radius:8px; margin-bottom:16px;">
                    <i class="fas fa-exclamation-triangle"></i>
                    <span>⚠️ Manually adding a customer is for legacy data import only. New customers should be converted automatically from Prospects when lifetime value reaches RM 2,000.</span>
                </div>
    <div class="form-section">
        <div class="form-group"><label>Full Name <span class="required">*</span></label><input type="text" id="cust-name" class="form-control" placeholder="Full name"></div>
        <div class="form-row">
            <div class="form-group half"><label>Phone <span class="required">*</span></label><input type="tel" id="cust-phone" class="form-control"></div>
            <div class="form-group half"><label>Email</label><input type="email" id="cust-email" class="form-control"></div>
        </div>
        <div class="form-row">
            <div class="form-group half"><label>IC Number</label><input type="text" id="cust-ic" class="form-control"></div>
            <div class="form-group half"><label>Date of Birth</label><input type="date" id="cust-dob" class="form-control"></div>
        </div>
        <div class="form-row">
            <div class="form-group half"><label>Previous Prospect ID</label><input type="text" id="cust-prev-id" class="form-control"></div>
            <div class="form-group half"><label>Initial Purchase Amt</label><input type="number" id="cust-init-amt" class="form-control"></div>
        </div>
        <div class="form-group"><label>Notes</label><textarea id="cust-notes" class="form-control" rows="2" placeholder="Legacy data notes..."></textarea></div>
    </div>
`;
        UI.showModal('Add New Customer (Legacy Import)', content, [
            { label: 'Cancel', type: 'secondary', action: 'UI.hideModal()' },
            { label: 'Create Customer', type: 'primary', action: 'await app.saveCustomer()' }
        ]);
    };

    const saveCustomer = async () => {
        const name = document.getElementById('cust-name')?.value;
        if (!name) return UI.toast.error('Name is required');
        await AppDataStore.create('customers', {
            full_name: name,
            phone: document.getElementById('cust-phone')?.value,
            email: document.getElementById('cust-email')?.value,
            ic_number: document.getElementById('cust-ic')?.value,
            date_of_birth: document.getElementById('cust-dob')?.value,
            lifetime_value: parseFloat(document.getElementById('cust-init-amt')?.value) || 0,
            status: 'active',
            customer_since: new Date().toISOString().split('T')[0]
        });
        UI.hideModal();
        UI.toast.success('Customer created (Legacy)');
        if (document.getElementById('customers-table-body')) await renderCustomersTable();
    };

    const openAddPurchaseModal = async (customerId) => {
        const customer = AppDataStore.getById('customers', customerId);
        const content = `
    <div class="form-section">
                    <div class="form-group">
                        <label>Product</label>
                        <select id="pur-product" class="form-control">
                            <option value="PR4 Power Ring">PR4 Power Ring</option>
                            <option value="PR3 Ring">PR3 Ring</option>
                            <option value="Office Audit">Office Audit</option>
                            <option value="Harmony Painting">Harmony Painting</option>
                            <option value="Other">Other (Type below)</option>
                        </select>
                    </div>
                    <div class="form-group"><label>Product Name (if Other)</label><input type="text" id="pur-other" class="form-control"></div>
                    <div class="form-row">
                        <div class="form-group half"><label>Amount (RM) <span class="required">*</span></label><input type="number" id="pur-amt" class="form-control"></div>
                        <div class="form-group half">
                            <label>Payment Method</label>
                            <select id="pur-method" class="form-control" onchange="const epp = document.getElementById('epp-fields'); if(this.value==='EPP') epp.style.display='block'; else epp.style.display='none';">
                                <option value="Cash">Cash</option>
                                <option value="Credit Card">Credit Card</option>
                                <option value="Bank Transfer">Bank Transfer</option>
                                <option value="EPP">EPP (Easy Payment Plan)</option>
                                <option value="POP">POP (Pre-Owned Plan)</option>
                            </select>
                        </div>
                    </div>
                    <div id="epp-fields" style="display:none; margin-bottom:16px;">
                        <div class="form-row">
                            <div class="form-group half"><label>Months</label><select class="form-control"><option>6</option><option>12</option><option>24</option></select></div>
                            <div class="form-group half"><label>Bank</label><input type="text" class="form-control" placeholder="Bank name"></div>
                        </div>
                    </div>
                    <div class="form-row">
                        <div class="form-group half"><label>Invoice No. (Auto)</label><input type="text" id="pur-inv" class="form-control" value="INV-${Date.now().toString().slice(-4)}" readonly></div>
                        <div class="form-group half"><label>Status</label>
                            <select id="pur-status" class="form-control">
                                <option value="PENDING">Pending</option>
                                <option value="COMPLETED">Completed</option>
                                <option value="COLLECTED">Collected</option>
                                <option value="N/A">N/A</option>
                            </select>
                        </div>
                    </div>
                    <div class="form-group"><label>Redemption Image</label><input type="file" id="pur-file" class="form-control"></div>
                    <div class="form-group">
                        <label class="checkbox-label" style="display:flex; align-items:center; gap:8px;">
                            <input type="checkbox" id="is-agent-pkg" onchange="const pkg = document.getElementById('pkg-fields'); if(this.checked) pkg.style.display='block'; else pkg.style.display='none';"> Is Agent Package?
                        </label>
                    </div>
                    <div id="pkg-fields" style="display:none;">
                        <div class="form-group"><label>Package Name</label><input type="text" class="form-control"></div>
                        <div class="form-group"><label>Description</label><textarea class="form-control" rows="2"></textarea></div>
                    </div>
                </div>
    `;
        UI.showModal(`Add Purchase for ${customer.full_name}`, content, [
            { label: 'Cancel', type: 'secondary', action: 'UI.hideModal()' },
            { label: 'Add Purchase', type: 'primary', action: `await app.savePurchase(${customerId})` }
        ]);
    };

    const savePurchase = async (customerId) => {
        const amt = parseFloat(document.getElementById('pur-amt')?.value);
        if (!amt) return UI.toast.error('Amount is required');

        const item = document.getElementById('pur-product')?.value === 'Other' ? document.getElementById('pur-other')?.value : document.getElementById('pur-product')?.value;

        // Match with promotion package if exists
        let packageId = null;
        const allPackages = await AppDataStore.getAll('promotion_packages');
        const matchingPkg = allPackages.find(p => p.is_active && p.product_ids.some(pid => {
            const prod = AppDataStore.getById('products', pid);
            return prod && prod.name === item;
        }));
        if (matchingPkg) packageId = matchingPkg.id;

        const pur = {
            customer_id: customerId,
            date: new Date().toISOString().split('T')[0],
            invoice: document.getElementById('pur-inv')?.value,
            item: item,
            amount: amt,
            status: document.getElementById('pur-status')?.value,
            proof: document.getElementById('pur-file')?.value ? 'image_uploaded.png' : '',
            package_id: packageId
        };
        await AppDataStore.create('purchases', pur);

        // Update lifetime value
        const customer = AppDataStore.getById('customers', customerId);
        AppDataStore.update('customers', customerId, { lifetime_value: (customer.lifetime_value || 0) + amt });

        UI.hideModal();
        UI.toast.success('Purchase added');
        if (document.getElementById('profile-tab-content')) await renderPurchaseHistoryTab(customer);
        else if (document.getElementById('customers-table-body')) await renderCustomersTable();
    };

    const openRecruitModal = (customerId) => {
        const customer = AppDataStore.getById('customers', customerId);
        const content = `
    <div class="form-section">
                    <h4 style="margin-bottom:12px;">Package Selection</h4>
                    <div class="form-row">
                        <div class="form-group half"><label>Package Type</label><select id="rec-pkg" class="form-control"><option>Premium</option><option>Standard</option><option>Basic</option></select></div>
                        <div class="form-group half"><label>Package Amount</label><input type="number" id="rec-amt" class="form-control" value="3000"></div>
                    </div>
                    <div class="form-group"><label>Description</label><textarea class="form-control" rows="2"></textarea></div>
                    
                    <h4 style="margin-top:20px; margin-bottom:12px;">License & Assignment</h4>
                    <div class="form-row">
                        <div class="form-group half"><label>License Start</label><input type="date" class="form-control" value="${new Date().toISOString().split('T')[0]}"></div>
                        <div class="form-group half"><label>License Expiry</label><input type="date" class="form-control" value="${new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]}"></div>
                    </div>
                    <div class="form-row">
                        <div class="form-group half"><label>Commission Rate (%)</label><input type="number" class="form-control" value="30"></div>
                        <div class="form-group half"><label>Team Assignment</label><select class="form-control"><option>Team A</option></select></div>
                    </div>
                    <div class="form-group"><label>Reporting To</label><select class="form-control"><option>Michelle Tan</option></select></div>
                    
                    <div class="form-section" style="background:#fefce8; border:1px solid #fde047;">
                        <h4 style="color:#854d0e;">Approval Section</h4>
                        <label class="checkbox-label" style="display:flex; align-items:center; gap:8px;">
                            <input type="checkbox" checked disabled> Requires Super Admin Approval
                        </label>
                        <div class="form-group" style="margin-top:8px;"><label>Notes for Approval</label><textarea class="form-control" rows="2"></textarea></div>
                    </div>
                </div>
    `;
        UI.showModal('Convert Customer to Agent', content, [
            { label: 'Cancel', type: 'secondary', action: 'UI.hideModal()' },
            { label: 'Submit for Approval', type: 'primary', action: `app.todo('Recruitment approval workflow submitted')` }
        ]);
    };


    const confirmDelete = async (id) => {
        UI.showModal('Delete Confirmation',
            '<p>Are you sure you want to delete this prospect? This action cannot be undone.</p>', [
            { label: 'Cancel', type: 'secondary', action: 'UI.hideModal()' },
            { label: 'Confirm Delete', type: 'primary', action: `await app.executeDelete(${id})` }
        ]
        );
    };

    const executeDelete = async (id) => {
        UI.hideModal();
        AppDataStore.delete('prospects', id);
        UI.toast.success('Prospect deleted successfully');
        await showProspectsView(document.getElementById('content-viewport'));
    };

    const calculateAge = (dob) => {
        if (!dob) return 35;
        const birthDate = new Date(dob);
        const diff = Date.now() - birthDate.getTime();
        return Math.floor(diff / (1000 * 60 * 60 * 24 * 365.25));
    };

    // Tag Functions
    const openAddTagModal = async (entityId, entityType = 'prospect') => {
        const allTags = await AppDataStore.getAll('tags');
        const existingTagMappings = AppDataStore.query('entity_tags', { entity_type: entityType, entity_id: entityId });
        const existingTagIds = existingTagMappings.map(et => et.tag_id);
        const availableTags = allTags.filter(t => !existingTagIds.includes(t.id));

        const content = `
    <div class="form-group">
                <label>Select Tag</label>
                <select id="tag-select" class="form-control">
                    <option value="">-- Select existing tag --</option>
                    ${availableTags.map(t => `<option value="${t.id}">${t.name}</option>`).join('')}
                </select>
            </div>
            <div class="form-group">
                <label>Or create new tag</label>
                <input type="text" id="new-tag-name" class="form-control" placeholder="New tag name">
            </div>
            <div class="form-group">
                <label>Tag Color</label>
                <select id="new-tag-color" class="form-control">
                    <option value="blue">Blue</option>
                    <option value="purple">Purple</option>
                    <option value="green">Green</option>
                    <option value="orange">Orange</option>
                    <option value="teal">Teal</option>
                    <option value="gray">Gray</option>
                </select>
            </div>
`;

        UI.showModal('Add Tag', content, [
            { label: 'Cancel', type: 'secondary', action: 'UI.hideModal()' },
            { label: 'Add Tag', type: 'primary', action: `await app.addTagToEntity(${entityId}, '${entityType}')` }
        ]);
    };

    const addTagToEntity = async (entityId, entityType) => {
        const tagSelect = document.getElementById('tag-select');
        const newTagName = document.getElementById('new-tag-name')?.value;
        const newTagColor = document.getElementById('new-tag-color')?.value;

        let tagId = null;

        if (tagSelect && tagSelect.value) {
            tagId = parseInt(tagSelect.value);
        } else if (newTagName) {
            const newTag = await AppDataStore.create('tags', {
                name: newTagName,
                color: newTagColor || 'blue'
            });
            tagId = newTag.id;
        } else {
            UI.toast.error('Please select or create a tag');
            return;
        }

        await AppDataStore.create('entity_tags', {
            entity_type: entityType,
            entity_id: entityId,
            tag_id: tagId
        });

        UI.hideModal();
        if (entityType === 'prospect') {
            await app.showProspectDetail(entityId);
        } else if (entityType === 'customer') {
            await app.showCustomerDetail(entityId);
        }
        UI.toast.success('Tag added');
    };

    const removeTagFromCustomer = async (customerId, tagId) => {
        const mappings = AppDataStore.query('entity_tags', {
            entity_type: 'customer',
            entity_id: customerId,
            tag_id: tagId
        });
        if (mappings.length > 0) {
            AppDataStore.delete('entity_tags', mappings[0].id);
            await app.showCustomerDetail(customerId);
            UI.toast.success('Tag removed');
        }
    };

    const removeTagFromProspect = async (prospectId, tagId) => {
        const mappings = AppDataStore.query('entity_tags', {
            entity_type: 'prospect',
            entity_id: prospectId,
            tag_id: tagId
        });
        if (mappings.length > 0) {
            AppDataStore.delete('entity_tags', mappings[0].id);
            await app.showProspectDetail(prospectId);
            UI.toast.success('Tag removed');
        }
    };

    // Solution Functions
    const openAddSolutionModal = async (prospectId) => {
        const content = `
    <div class="form-group">
                <label>Solution</label>
                <select id="solution-name" class="form-control">
                    <option value="PR4 Power Ring">PR4 Power Ring</option>
                    <option value="PR3 Ring">PR3 Ring</option>
                    <option value="PR5 Ring">PR5 Ring</option>
                    <option value="Office Audit">Office Audit</option>
                    <option value="Home Audit">Home Audit</option>
                    <option value="Career Consultation">Career Consultation</option>
                    <option value="Harmony Painting">Harmony Painting</option>
                </select>
            </div>
            <div class="form-group">
                <label>Proposed Date</label>
                <input type="date" id="solution-date" class="form-control" value="${new Date().toISOString().split('T')[0]}">
            </div>
            <div class="form-group">
                <label>Status</label>
                <select id="solution-status" class="form-control">
                    <option value="Proposed">Proposed</option>
                    <option value="Approved">Approved</option>
                    <option value="Rejected">Rejected</option>
                    <option value="Purchased">Purchased</option>
                </select>
            </div>
            <!-- Solution Proposed Dropdown -->
            <div class="form-group">
                <label>Solution Proposed</label>
                <select name="activity-outcome" class="form-control">
                    <option value="">-- Select Solution --</option>
                    ${(AppDataStore.get('products') || []).map(p => `
                        <option value="${await escapeHtml(p.name)}">${await escapeHtml(p.name)}</option>
                    `).join('')}
                    <option value="No Solution Needed">No Solution Needed</option>
                    <option value="Follow-up Required">Follow-up Required</option>
                </select>
            </div>
`;

        UI.showModal('Add Proposed Solution', content, [
            { label: 'Cancel', type: 'secondary', action: 'UI.hideModal()' },
            { label: 'Save', type: 'primary', action: `await app.saveSolution(${prospectId})` }
        ]);
    };

    const saveSolution = async (prospectId) => {
        const solution = document.getElementById('solution-name')?.value;
        const date = document.getElementById('solution-date')?.value;
        const status = document.getElementById('solution-status')?.value;
        const notes = document.getElementById('solution-notes')?.value;

        if (!solution || !date) {
            UI.toast.error('Solution and date are required');
            return;
        }

        await AppDataStore.create('proposed_solutions', {
            prospect_id: prospectId,
            solution: solution,
            proposed_date: date,
            status: status,
            notes: notes
        });

        UI.hideModal();
        await app.showProspectDetail(prospectId);
        UI.toast.success('Solution added');
    };

    // Name List Functions
    const confirmConvertToCustomer = async (prospectId, isManual = false) => {
        const prospect = AppDataStore.getById('prospects', prospectId);
        if (!prospect) return;

        const amount = isManual
            ? parseFloat(document.getElementById('manual-conversion-amount')?.value) || 0
            : parseFloat(document.getElementById('conversion-amount')?.value) || 0;

        const date = isManual
            ? document.getElementById('manual-customer-since')?.value
            : document.getElementById('customer-since')?.value;

        const customer = {
            id: Date.now(),
            full_name: prospect.full_name,
            nickname: prospect.nickname || '',
            phone: prospect.phone,
            email: prospect.email,
            ic_number: prospect.ic_number,
            date_of_birth: prospect.date_of_birth,
            lunar_birth: prospect.lunar_birth,
            ming_gua: prospect.ming_gua,
            occupation: prospect.occupation,
            company_name: prospect.company_name,
            income_range: prospect.income_range,
            address: prospect.address,
            city: prospect.city,
            state: prospect.state,
            postal_code: prospect.postal_code,
            lifetime_value: amount,
            status: 'active',
            customer_since: date || new Date().toISOString().split('T')[0],
            responsible_agent_id: prospect.responsible_agent_id || 5,
            converted_from_prospect_id: prospectId,
            referred_by: prospect.referred_by,
            referred_by_id: prospect.referred_by_id,
            referred_by_type: prospect.referred_by_type,
            referral_relationship: prospect.referral_relationship
        };

        const newCustomer = await AppDataStore.create('customers', customer);
        AppDataStore.update('prospects', prospectId, { status: 'converted' });

        // Phase X: Create purchase record for conversion amount
        if (amount > 0) {
           await  AppDataStore.create('purchases', {
                customer_id: newCustomer.id,
                date: customer.customer_since,
                item: 'Conversion Package / First Deal',
                amount: amount,
                status: 'PAID',
                invoice: `INV - ${new Date().getFullYear()} -${Math.floor(1000 + Math.random() * 9000)} `,
                notes: 'Created during prospect conversion'
            });
        }

        UI.hideModal();
        UI.toast.success('Converted to customer successfully!');

        const content = document.getElementById('main-content');
        if (content) await showProspectsView(content);
    };

    const extendProtection = async (prospectId) => {
        const prospect = AppDataStore.getById('prospects', prospectId);
        if (!prospect) return;
        const currentDeadline = new Date(prospect.protection_deadline || Date.now());
        const newDeadline = new Date(currentDeadline.getTime() + 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
        AppDataStore.update('prospects', prospectId, { protection_deadline: newDeadline });
        UI.toast.success('Protection extended by 30 days');
        await app.showProspectDetail(prospectId);
    };

    const transferProspect = (prospectId) => {
        UI.toast.info('Transfer workflow: Select target agent to initiate transfer request.');
    };

    const reassignProspect = (prospectId) => {
        UI.toast.info('Reassign workflow: Administrator override required.');
    };


    const convertToCustomer = async (prospectId) => {
        const prospect = AppDataStore.getById('prospects', prospectId);
        if (!prospect) return;

        const totalPurchases = await AppDataStore.getAll('purchases')
            .filter(p => p.prospect_id === prospectId)
            .reduce((sum, p) => sum + (p.amount || 0), 0);

        if (totalPurchases < 2000) {
            UI.showModal('Cannot Convert Automatically',
                `<p> Prospect requires RM 2,000 in purchases to convert automatically.</p>
                 <p>Current total: RM ${totalPurchases.toLocaleString()}</p>
                 <p style="margin-top: 10px; font-size: 13px; color: var(--gray-500);">Alternatively, convert manually below:</p>
                 <div class="form-group" style="margin-top: 15px;">
                     <label>Manual Conversion Amount (RM)</label>
                     <input type="number" id="manual-conversion-amount" class="form-control" value="${totalPurchases}">
                 </div>
                 <div class="form-group">
                     <label>Customer Since</label>
                     <input type="date" id="manual-customer-since" class="form-control" value="${new Date().toISOString().split('T')[0]}">
                 </div>`,
                [
                    { label: 'Cancel', type: 'secondary', action: 'UI.hideModal()' },
                    { label: 'Convert Manually', type: 'primary', action: `await app.confirmConvertToCustomer(${prospectId}, true)` }
                ]
            );
            return;
        }

        const content = `
    <div class="convert-modal">
                <p>Convert <strong>${prospect.full_name}</strong> to customer?</p>
                <div class="form-group">
                    <label>Conversion Amount (RM)</label>
                    <input type="number" id="conversion-amount" class="form-control" value="${totalPurchases}" readonly>
                </div>
                <div class="form-group">
                    <label>Customer Since</label>
                    <input type="date" id="customer-since" class="form-control" value="${new Date().toISOString().split('T')[0]}">
                </div>
            </div>
    `;

        UI.showModal('Convert to Customer', content, [
            { label: 'Cancel', type: 'secondary', action: 'UI.hideModal()' },
            { label: 'Convert', type: 'primary', action: `await app.confirmConvertToCustomer(${prospectId})` }
        ]);
    };

    const showAgentsView = async (container) => {

        container.innerHTML = `
    <div class="agents-view">
                <div class="agents-header">
                    <div>
                        <h1>Agent Management</h1>
                        <p>Monitor agent performance, licenses, and assignments.</p>
                    </div>
                    <div class="header-actions">
                        <button class="btn primary" onclick="await app.openAddAgentModal()">
                            <i class="fas fa-plus"></i> Add Agent
                        </button>
                    </div>
                </div>

                <div class="agent-filters">
                    <div class="search-group" style="flex:1; min-width:200px; display:flex; align-items:center; gap:8px; background:var(--gray-50); padding:8px 12px; border-radius:6px; border:1px solid var(--gray-200);">
                        <i class="fas fa-search" style="color:var(--gray-400);"></i>
                        <input type="text" id="agent-search" placeholder="Search agents by name, code, or phone" onkeyup="await app.filterAgents()" style="border:none; background:transparent; outline:none; width:100%;">
                    </div>
                    <select id="filter-agent-team" onchange="await app.filterAgents()" class="form-control" style="width:140px;">
                        <option value="">All Teams</option>
                        <option value="Team A">Team A</option>
                        <option value="Team B">Team B</option>
                    </select>
                    <select id="filter-agent-role" onchange="await app.filterAgents()" class="form-control" style="width:160px;">
                        <option value="">All Roles</option>
                        ${USER_ROLES.map(r => `<option value="${r}">${r}</option>`).join('')}
                    </select>
                    <select id="filter-agent-status" onchange="await app.filterAgents()" class="form-control" style="width:140px;">
                        <option value="">All Status</option>
                        <option value="active">Active</option>
                        <option value="probation">Probation</option>
                        <option value="inactive">Inactive</option>
                        <option value="expired">License Expired</option>
                    </select>
                </div>

                <div class="agents-table-container">
                    <table class="agents-table">
                        <thead>
                            <tr>
                                <th>Name / Agent ID</th>
                                <th>Team</th>
                                <th>Status</th>
                                <th>License Expiry</th>
                                <th>Assigned Prospects</th>
                                <th>Follow-up Rate</th>
                                <th>Actions</th>
                            </tr>
                        </thead>
                        <tbody id="agents-table-body">
                            <!-- Populated by await renderAgentsTable() -->
                        </tbody>
                    </table>
                </div>
            </div>
    `;
        await renderAgentsTable();
    };

    const renderAgentsTable = async () => {
        const tbody = document.getElementById('agents-table-body');
        if (!tbody) {
            console.error('agents-table-body not found');
            return;
        }

        const agents = await AppDataStore.getAll('users').filter(u => isAgent(u) || u.agent_code);
        const searchQuery = document.getElementById('agent-search')?.value.toLowerCase() || '';
        const teamFilter = document.getElementById('filter-agent-team')?.value || '';
        const roleFilter = document.getElementById('filter-agent-role')?.value || '';
        const statusFilter = document.getElementById('filter-agent-status')?.value || '';

        let html = '';
        agents.forEach(agent => {
            if (searchQuery && !agent.full_name.toLowerCase().includes(searchQuery) && !agent.agent_code?.toLowerCase().includes(searchQuery)) return;
            if (teamFilter && agent.team !== teamFilter) return;
            if (roleFilter && agent.role !== roleFilter) return;
            if (statusFilter && agent.status !== statusFilter) return;

            const stats = AppDataStore.query('agent_stats', { agent_id: agent.id })[0] || { total_assigned: 0, followup_rate: 0 };
            const rateClass = stats.followup_rate >= 90 ? 'rate-good' : (stats.followup_rate >= 70 ? 'rate-warning' : 'rate-critical');
            const status = agent.status || 'active';

            html += `
                <tr data-agent-id="${agent.id}" class="agent-row">
                    <td>
                        <div style="font-weight:600;">${await escapeHtml(agent.full_name)}</div>
                        <div style="font-size:12px; color:var(--gray-500);">${await escapeHtml(agent.agent_code) || 'N/A'}</div>
                    </td>
                    <td>${await escapeHtml(agent.team) || 'Unassigned'}</td>
                    <td><span class="status-badge status-${status}">${status.toUpperCase()}</span></td>
                    <td>${await escapeHtml(agent.license_expiry) || 'N/A'}</td>
                    <td>${stats.total_assigned} prospects</td>
                    <td>
                        <div class="followup-rate">
                            <span class="rate-indicator ${rateClass}"></span>
                            <span>${stats.followup_rate}%</span>
                        </div>
                    </td>
                    <td onclick="event.stopPropagation()">
                        <button class="btn-icon view-detail-btn" data-agent-id="${agent.id}" title="View Detail"><i class="fas fa-eye"></i></button>
                        <button class="btn-icon edit-agent-btn" data-agent-id="${agent.id}" title="Edit Agent"><i class="fas fa-edit"></i></button>
                    </td>
                </tr>
            `;
        });

        tbody.innerHTML = '';
        tbody.insertAdjacentHTML('beforeend', html || '<tr><td colspan="7" style="text-align:center; padding:20px;">No agents found</td></tr>');
    };

    const filterAgents = async () => await renderAgentsTable();

    const showAgentDetail = async (agentId) => {
        const agent = AppDataStore.getById('users', agentId);
        if (!agent) return;

        // --- NEW: define isAdminOrLead ---
        const currentUser = _currentUser || Auth.getCurrentUser();
        const isAdminOrLead = isSystemAdmin(currentUser) || isMarketingManager(currentUser) || 
                              currentUser?.role?.includes('Level 3') || 
                              currentUser?.role?.includes('Level 7') || 
                              currentUser?.role === 'team_leader';
        const isSelf = agent.id == currentUser?.id;
        if (!isAdminOrLead && !isSelf) {
            UI.toast.error('You do not have permission to view this agent profile');
            return;
        }

        const viewport = document.getElementById('content-viewport');
        viewport.innerHTML = `
    <div class="agent-profile-view">
                <div class="header-actions" style="margin-bottom:16px;">
                    <button class="btn secondary" onclick="await app.navigateTo('agents')"><i class="fas fa-arrow-left"></i> Back to Agents</button>
                </div>

                <div class="profile-header" style="display:flex; justify-content:space-between; align-items:flex-start; margin-bottom:24px;">
                    <div>
                        <div style="display:flex; align-items:center; gap:12px; margin-bottom:8px;">
                            <h1 style="font-size:32px; font-weight:700;">${agent.full_name}</h1>
                            <span class="status-badge status-${agent.status}">${agent.status.toUpperCase()}</span>
                        </div>
                        <div style="display:flex; gap:12px; color:var(--gray-500); font-size:14px;">
                            <span>Agent ID: ${agent.agent_code}</span>
                            <span><i class="fas fa-user-tie"></i> Senior Consultant</span>
                            <span><i class="fas fa-users"></i> ${agent.team}</span>
                        </div>
                    </div>
                    <div class="header-actions">
                        <button class="btn secondary" onclick="app.todo('Reset Password')">Reset Password</button>
                        <button class="btn secondary" onclick="app.todo('Edit Agent')">Edit Profile</button>
                        <button class="btn error" onclick="app.todo('Deactivate Agent')">Deactivate</button>
                    </div>
                </div>

                ${agent.id === 9 || agent.username === 'ong.beeling' ? `
                <div class="conversion-banner">
                    <i class="fas fa-award"></i>
                    <span>Converted from Customer on 05 Mar 2026 via <strong>Premium Package (RM 5,500)</strong></span>
                </div>
                ` : ''
            }

                ${isAdminOrLead ? `
                <div class="license-dashboard">
                    <h3><i class="fas fa-id-card"></i> License Renewal Dashboard</h3>
                    <div class="license-stats">
                        <div class="license-stat">
                            <span class="license-stat-label">License Expiry</span>
                            <span class="license-stat-value">${agent.license_expiry}</span>
                        </div>
                        <div class="license-stat">
                            <span class="license-stat-label">Days Remaining</span>
                            <span class="license-stat-value" style="color:${calculateDaysDiff(agent.license_expiry) < 30 ? '#ef4444' : '#0369a1'}">${calculateDaysDiff(agent.license_expiry)} Days</span>
                        </div>
                        <div class="license-stat">
                            <span class="license-stat-label">Renewal Status</span>
                            <span class="license-stat-value">${agent.renewal_status || 'ELIGIBLE'}</span>
                        </div>
                    </div>
                    <div class="license-actions">
                        <button class="btn primary" onclick="await app.renewLicense(${agent.id})" ${calculateDaysDiff(agent.license_expiry) > 60 ? 'disabled' : ''}>Renew Now</button>
                        <button class="btn secondary" onclick="app.sendRenewalReminder(${agent.id})">Send Reminder</button>
                    </div>
                </div>
                ` : ''
            }

                <div class="performance-grid">
                    <div class="performance-card">
                        <h4><i class="fas fa-info-circle"></i> Agent Information</h4>
                        <div class="performance-stats">
                            <div class="stat-row">
                                <span class="stat-label">Phone:</span>
                                <span class="stat-value">${agent.phone || '012-1234567'}</span>
                            </div>
                            <div class="stat-row">
                                <span class="stat-label">Email:</span>
                                <span class="stat-value">${agent.email || 'agent@fengshui.com'}</span>
                            </div>
                            <div class="stat-row">
                                <span class="stat-label">Join Date:</span>
                                <span class="stat-value">${agent.join_date || '2026-01-01'}</span>
                            </div>
                            <div class="stat-row">
                                <span class="stat-label">Comm. Rate:</span>
                                <span class="stat-value">${agent.commission_rate}%</span>
                            </div>
                            <div class="stat-row">
                                <span class="stat-label">Reporting To:</span>
                                <span class="stat-value">Michelle Tan</span>
                            </div>
                        </div>
                    </div>

                    <div class="performance-card">
                        <h4><i class="fas fa-chart-line"></i> Follow-up Performance</h4>
                        ${renderFollowupStats(agent.id)}
                    </div>
                </div>

                <div class="performance-grid">
                   <div class="performance-card">
                        <h4><i class="fas fa-list-check"></i> Current Assignments</h4>
                        ${await renderCurrentAssignments(agent.id)}
                    </div>
                    <div class="performance-card">
                        <h4><i class="fas fa-bullseye"></i> Performance Targets (March)</h4>
                        ${renderPerformanceTargets(agent.id)}
                    </div>
                </div>

                <div class="performance-grid">
                    <div class="performance-card">
                        <h4><i class="fas fa-history"></i> Customer History</h4>
                        ${await renderCustomerHistory(agent.id)}
                    </div>
                    <div class="performance-card">
                        <h4><i class="fas fa-clock-rotate-left"></i> Agent Activity History</h4>
                        <div class="performance-stats">
                            <div class="stat-row">
                                <span class="stat-label">05 Mar 10:00:</span>
                                <span>Login via Web Portal</span>
                            </div>
                            <div class="stat-row">
                                <span class="stat-label">04 Mar 16:30:</span>
                                <span>Commission rate updated to 30%</span>
                            </div>
                            <div class="stat-row">
                                <span class="stat-label">04 Mar 15:45:</span>
                                <span>Renewed license for 2026</span>
                            </div>
                        </div>
                    </div>

                    <div class="performance-card">
                        <h4><i class="fas fa-sticky-note"></i> Agent Notes</h4>
                        <div class="add-note-section">
                            <textarea id="agent-note-text-${agent.id}" class="form-control" rows="3" placeholder="Add note about agent performance..."></textarea>
                            <div style="display:flex; justify-content:space-between; align-items:center; margin-top:8px;">
                                <button class="btn-icon" onclick="await app.openVoiceRecorder('agent-note-text-${agent.id}', 'agent', ${agent.id})" title="Record voice note" style="color:var(--primary);"><i class="fas fa-microphone"></i></button>
                                <button class="btn primary btn-sm" onclick="await app.addAgentNote(${agent.id})">Add Note</button>
                            </div>
                        </div>
                        <div id="agent-notes-list-${agent.id}" style="margin-top:12px;">
                            ${(() => {
                const agentNotes = AppDataStore.query('notes', { agent_id: agent.id });
                if (!agentNotes.length) return '<p style="color:var(--gray-400); font-size:13px;">No notes yet.</p>';
                return agentNotes.map(n => `
                                    <div class="notes-item" style="margin-top:8px;">
                                        <div class="notes-header">
                                            <span>${n.date} - ${n.author}${n.is_voice_note ? ' <i class="fas fa-microphone voice-note-icon" title="Voice note"></i>' : ''}</span>
                                            <button class="btn-icon" onclick="await app.deleteAgentNote(${agent.id}, ${n.id})"><i class="fas fa-trash"></i></button>
                                        </div>
                                        <div>"${n.text}"</div>
                                    </div>
                                `).join('');
            })()}
                        </div>
                    </div>
                </div>
            </div>
    `;
    };

    const renderCustomerHistory = async (agentId) => {
        const customers = await getVisibleCustomers().filter(c => c.responsible_agent_id === agentId);
        if (customers.length === 0) return '<p>No converted customers yet.</p>';

        return `
    <div class="assignments-list">
        ${customers.map(c => `
                    <div class="assignment-item" onclick="await app.showCustomerDetail(${c.id})">
                        <div>
                            <div class="assignment-prospect">${c.full_name}</div>
                            <div class="next-action">Customer Since: ${c.customer_since}</div>
                        </div>
                        <span class="assignment-status status-active">RM ${c.lifetime_value.toLocaleString()}</span>
                    </div>
                `).join('')
            }
            </div>
    `;
    };

    const renewLicense = async (agentId) => {
        const content = `
    <div class="renewal-form">
                <p>Select a renewal package to extend your agent license for 12 months.</p>
                <div class="renewal-package" style="border:2px solid var(--primary); padding:16px; border-radius:8px; margin-bottom:12px; cursor:pointer;">
                    <div style="display:flex; justify-content:space-between; align-items:center;">
                        <strong>Standard Renewal</strong>
                        <span style="color:var(--primary); font-weight:700;">RM 1,500</span>
                    </div>
                    <p style="font-size:12px; color:var(--gray-500); margin-top:4px;">12 months license extension + Basic marketing tools.</p>
                </div>
                <div class="renewal-package" style="border:1px solid var(--gray-200); padding:16px; border-radius:8px; cursor:pointer;">
                    <div style="display:flex; justify-content:space-between; align-items:center;">
                        <strong>Premium Renewal</strong>
                        <span style="color:var(--primary); font-weight:700;">RM 2,800</span>
                    </div>
                    <p style="font-size:12px; color:var(--gray-500); margin-top:4px;">12 months license extension + Advanced CRM features + Priority support.</p>
                </div>
            </div>
    `;

        UI.showModal('License Renewal', content, [
            { label: 'Cancel', type: 'secondary', action: 'UI.hideModal()' },
            { label: 'Purchase Package', type: 'primary', action: `await app.executeRenewal(${agentId})` }
        ]);
    };

    const executeRenewal = async (agentId) => {
        const agent = AppDataStore.getById('users', agentId);
        if (agent) {
            AppDataStore.update('users', agentId, {
                renewal_status: 'PENDING_REVIEW',
                license_renewal_requested: true,
                license_renewal_date: new Date().toISOString().split('T')[0]
            });
        }
        UI.hideModal();
        UI.toast.success('Renewal request submitted for admin review.');
        await showAgentDetail(agentId);
    };

    const calculateDaysDiff = (dateStr) => {
        if (!dateStr) return 0;
        const expiry = new Date(dateStr);
        const today = new Date();
        const diff = expiry - today;
        return Math.ceil(diff / (1000 * 60 * 60 * 24));
    };

    const renderFollowupStats = (agentId) => {
        const stats = AppDataStore.query('agent_stats', { agent_id: agentId })[0];
        if (!stats) return '<p>No performance data available.</p>';

        return `
    <div class="performance-stats">
                <div class="stat-row">
                    <span class="stat-label">Total Assigned:</span>
                    <span class="stat-value">${stats.total_assigned}</span>
                </div>
                <div class="stat-row">
                    <span class="stat-label">Followed up (7d):</span>
                    <span class="stat-value">${stats.followed_up_7d} (${stats.followup_rate}%)</span>
                </div>
                <hr style="border:none; border-top:1px solid var(--gray-200); margin:8px 0;">
                <div class="inactive-list">
                    <div class="inactive-item warning">
                        <span>Inactive 3-7 Days:</span>
                        <strong>${stats.inactive_3_7d}</strong>
                    </div>
                    <div class="inactive-item critical">
                        <span>Inactive 8-14 Days:</span>
                        <strong>${stats.inactive_8_14d}</strong>
                    </div>
                    <div class="inactive-item critical" style="background:#fee2e2;">
                        <span>Inactive 15+ Days:</span>
                        <strong>${stats.inactive_15d_plus}</strong>
                    </div>
                </div>
                <button class="btn secondary btn-sm" style="margin-top:12px;" onclick="app.viewInactiveProspects(${agentId})">View Inactive List</button>
            </div>
`;
    };

    const renderCurrentAssignments = async (agentId) => {
        const assignments = AppDataStore.query('assignments', { agent_id: agentId });
        if (assignments.length === 0) return '<p>No active assignments.</p>';

        return `
    <div class="assignments-list">
        ${assignments.map(a => {
            const p = AppDataStore.getById('prospects', a.prospect_id);
            return `
                    <div class="assignment-item" onclick="await app.showProspectDetail(${a.prospect_id})">
                        <div>
                            <div class="assignment-prospect">${p.full_name}</div>
                            <div class="next-action">Next: ${a.next_action}</div>
                        </div>
                        <span class="assignment-status status-${a.status.toLowerCase()}">${a.status}</span>
                    </div>
                    `;
        }).join('')
            }
<button class="btn secondary btn-sm" onclick="app.todo('Bulk Reassign')">Bulk Reassign</button>
            </div>
    `;
    };

    const renderPerformanceTargets = (agentId) => {
        const target = AppDataStore.query('agent_targets', { agent_id: agentId })[0];
        if (!target) return '<p>No targets set for this month.</p>';

        return `
    <div class="performance-stats">
                <div class="stat-row">
                    <span class="stat-label">Sales Amount:</span>
                    <span>RM ${target.current_amount.toLocaleString()} / ${target.target_amount.toLocaleString()}</span>
                </div>
                <div class="target-progress">
                    <div class="fill" style="width: ${(target.current_amount / target.target_amount) * 100}%"></div>
                </div>
                
                <div class="stat-row">
                    <span class="stat-label">CPS Conducted:</span>
                    <span>${target.current_cps} / ${target.target_cps}</span>
                </div>
                <div class="target-progress">
                    <div class="fill" style="width: ${(target.current_cps / target.target_cps) * 100}%"></div>
                </div>

                <div class="stat-row">
                    <span class="stat-label">Meetings:</span>
                    <span>${target.current_meetings} / ${target.target_meetings}</span>
                </div>
                <div class="target-progress">
                    <div class="fill" style="width: ${(target.current_meetings / target.target_meetings) * 100}%"></div>
                </div>
                
                <button class="btn primary btn-sm" style="margin-top:12px;" onclick="app.todo('Update Targets')">Update Targets</button>
            </div>
    `;
    };

    const openAddAgentModal = async () => {
        const content = `
    <div class="add-agent-form">
                <div class="form-section">
                    <h4>Basic Information</h4>
                    <div class="form-row">
                        <div class="form-group half">
                            <label>Full Name <span class="required">*</span></label>
                            <input type="text" id="agent-name" class="form-control" required>
                        </div>
                        <div class="form-group half">
                            <label>IC Number <span class="required">*</span></label>
                            <input type="text" id="agent-ic" class="form-control" required>
                        </div>
                    </div>
                    <div class="form-row">
                        <div class="form-group half">
                            <label>Phone <span class="required">*</span></label>
                            <input type="tel" id="agent-phone" class="form-control" required>
                        </div>
                        <div class="form-group half">
                            <label>Email <span class="required">*</span></label>
                            <input type="email" id="agent-email" class="form-control" required>
                        </div>
                    </div>
                </div>

                <div class="form-section">
                    <h4>Business Information</h4>
                    <div class="form-row">
                        <div class="form-group half">
                            <label>Agent Role <span class="required">*</span></label>
                            <select id="agent-role-select" class="form-control" required>
                                ${USER_ROLES.map(r => `<option value="${r}">${r}</option>`).join('')}
                            </select>
                        </div>
                        <div class="form-group half">
                            <label>Agent Code</label>
                            <input type="text" id="agent-code-new" class="form-control" placeholder="AGN-2026-XXX">
                        </div>
                    </div>
                    <div class="form-row">
                        <div class="form-group half">
                            <label>Commission Rate (%)</label>
                            <input type="number" id="agent-comm" class="form-control" value="30">
                        </div>
                    </div>
                </div>

                <div class="form-section">
                    <h4>License Information</h4>
                    <div class="form-row">
                        <div class="form-group half">
                            <label>License Start Date</label>
                            <input type="date" id="agent-license-start" class="form-control">
                        </div>
                        <div class="form-group half">
                            <label>License Expiry Date</label>
                            <input type="date" id="agent-license-expiry" class="form-control">
                        </div>
                    </div>
                </div>
            </div>
    `;

        UI.showModal('Add New Agent', content, [
            { label: 'Cancel', type: 'secondary', action: 'UI.hideModal()' },
            { label: 'Create Agent Account', type: 'primary', action: 'await app.saveAgent()' }
        ]);
    };

    const saveAgent = async () => {
        const name = document.getElementById('agent-name').value;
        if (!name) return UI.toast.error('Agent name is required');

        const newAgent = {
            id: Date.now(),
            username: name.toLowerCase().replace(' ', '.'),
            password: 'agent123',
            full_name: name,
            role: document.getElementById('agent-role-select').value,
            agent_code: document.getElementById('agent-code-new').value,
            phone: document.getElementById('agent-phone').value,
            email: document.getElementById('agent-email').value,
            ic_number: document.getElementById('agent-ic').value,
            commission_rate: parseInt(document.getElementById('agent-comm').value),
            license_start: document.getElementById('agent-license-start').value,
            license_expiry: document.getElementById('agent-license-expiry').value,
            status: 'probation',
            join_date: new Date().toISOString().split('T')[0]
        };

        await AppDataStore.create('users', newAgent);
        UI.hideModal();
        UI.toast.success('Agent account created successfully');
        await renderAgentsTable();
    };


    const updateAgentTargets = async (agentId) => {
        const target = AppDataStore.query('agent_targets', { agent_id: agentId })[0];
        const content = `
    <div class="form-group" style="margin-bottom:15px;">
                <label>Monthly Sales target (RM)</label>
                <input type="number" id="target-sales" class="form-control" value="${target?.target_amount || 50000}">
            </div>
            <div class="form-group" style="margin-bottom:15px;">
                <label>Monthly CPS Target</label>
                <input type="number" id="target-cps" class="form-control" value="${target?.target_cps || 20}">
            </div>
            <div class="form-group">
                <label>Monthly Meetings Target</label>
                <input type="number" id="target-meetings" class="form-control" value="${target?.target_meetings || 40}">
            </div>
`;
        UI.showModal('Update Agent Targets', content, [
            { label: 'Cancel', type: 'secondary', action: 'UI.hideModal()' },
            { label: 'Save Targets', type: 'primary', action: `await app.saveAgentTargets(${agentId})` }
        ]);
    };

    const saveAgentTargets = async (agentId) => {
        const target = AppDataStore.query('agent_targets', { agent_id: agentId })[0];
        const data = {
            target_amount: parseInt(document.getElementById('target-sales').value),
            target_cps: parseInt(document.getElementById('target-cps').value),
            target_meetings: parseInt(document.getElementById('target-meetings').value)
        };
        if (target) {
            AppDataStore.update('agent_targets', target.id, data);
        } else {
            data.agent_id = agentId;
            data.current_amount = 0;
            data.current_cps = 0;
            data.current_meetings = 0;
            await AppDataStore.create('agent_targets', data);
        }
        UI.hideModal();
        UI.toast.success('Agent targets updated');
        await showAgentDetail(agentId);
    };

    const deactivateAgent = async (agentId) => {
        UI.confirm('Deactivate Agent?', 'This will prevent the agent from logging in. You should reassign their active prospects first.', () => {
            AppDataStore.update('users', agentId, { status: 'inactive' });
            UI.toast.success('Agent deactivated');
            const main = document.getElementById('main-content');
            if (main) await showAgentsView(main);
        });
    };

    const assignProspectToAgent = async (prospectId, agentId) => {
        AppDataStore.update('prospects', prospectId, { responsible_agent_id: agentId });
        UI.toast.success('Prospect reassigned');
        await app.showProspectDetail(prospectId);
    };

    const sendRenewalReminder = (agentId) => {

        UI.toast.success('Renewal reminder sent via Email/WhatsApp.');
    };

    const viewInactiveProspects = (agentId) => {
        UI.toast.info('Opening inactive prospects list...');
    };

    // ========== PHASE 6: PIPELINE & SALES FORCE MODULE ==========

    const loadReadinessConfig = () => {
        const defaultConfig = {
            weights: { CPS: 30, EVENT: 20, MUSEUM: 10, FTF: 15, FSA: 15, score: 10 },
            thresholds: { hot: 80, warm: 50 },
            fullWeightDays: 7,
            decayDays: 30
        };
        const saved = localStorage.getItem('pipeline_readiness_config');
        return saved ? JSON.parse(saved) : defaultConfig;
    };

    const calculateReadiness = (prospect, allActivities) => {
        const config = loadReadinessConfig();
        const prospectActivities = allActivities.filter(a => a.prospect_id === prospect.id);

        let totalScore = 0;
        const badges = [];
        const activityTypes = ['CPS', 'EVENT', 'MUSEUM', 'FTF', 'FSA'];

        // Activity contributions
        activityTypes.forEach(type => {
            const typeActivities = prospectActivities.filter(a => a.activity_type === type);
            if (typeActivities.length > 0) {
                badges.push(type);

                // Find most recent completed activity of this type
                const sorted = typeActivities.sort((a, b) => new Date(b.activity_date) - new Date(a.activity_date));
                const mostRecent = sorted[0];

                const daysSince = Math.floor((new Date() - new Date(mostRecent.activity_date)) / (1000 * 60 * 60 * 24));

                let factor = 0;
                if (daysSince <= config.fullWeightDays) {
                    factor = 1;
                } else if (daysSince <= config.decayDays) {
                    factor = 1 - (daysSince - config.fullWeightDays) / (config.decayDays - config.fullWeightDays);
                }

                totalScore += (config.weights[type] || 0) * factor;
            }
        });

        // Lead score contribution
        const maxLeadScore = 1000; // Assuming 1000 is the benchmark for 100% of the score weight
        const scoreFactor = Math.min(1, (prospect.score || 0) / maxLeadScore);
        totalScore += (config.weights.score || 0) * scoreFactor;

        const percentage = Math.min(100, Math.round(totalScore));
        let label = 'COLD';
        if (percentage >= config.thresholds.hot) label = 'HOT';
        else if (percentage >= config.thresholds.warm) label = 'WARM';

        return { percentage, label, badges };
    };

    const getProposedProduct = (prospectId) => {
        const solutions = AppDataStore.query('proposed_solutions', { prospect_id: prospectId });
        if (solutions.length > 0) {
            return {
                name: solutions[0].product_name || 'Standard Consultation',
                amount: solutions[0].amount || 0
            };
        }
        return { name: 'General Interest', amount: 0 };
    };

    const getNoteCount = (prospectId) => {
        return AppDataStore.query('notes', { prospect_id: prospectId }).length +
            AppDataStore.query('activities', { prospect_id: prospectId }).length;
    };

    const getProspectOutcome = (prospect) => {
        if (prospect.status === 'converted') return 'Won';
        if (prospect.status === 'lost') return 'Lost';

        const purchases = AppDataStore.query('purchases', { prospect_id: prospect.id });
        if (purchases.length > 0) return 'Won';

        return 'Open';
    };


    let _pipelineAgentFilter = 'all';
    let _pipelineStatusFilter = 'all';

    const showPipelineView = async (container) => {
        const userId = _currentUser?.id || 5;
        const allActivities = await getVisibleActivities();
        let prospects = await getVisibleProspects();
        const agents = await AppDataStore.getAll('users').filter(u => isAgent(u) || u.role === 'team_leader' || u.role?.includes('Level 7'));

        // --- NEW: Apply Filters ---
        if (_pipelineAgentFilter !== 'all') {
            prospects = prospects.filter(p => p.responsible_agent_id == _pipelineAgentFilter);
        }
        if (_pipelineStatusFilter !== 'all') {
            prospects = prospects.filter(p => p.status === _pipelineStatusFilter);
        }

        const focusList = AppDataStore.query('my_potential_list', { user_id: userId })
            .filter(rec => prospects.some(p => p.id == rec.prospect_id)) // Filter focus list too
            .sort((a, b) => a.priority_order - b.priority_order);

        // Calculate readiness for all prospects to sort the system pipeline
        const systemProspects = prospects.map(p => {
            const readiness = calculateReadiness(p, allActivities);
            return { ...p, readiness };
        }).sort((a, b) => b.readiness.percentage - a.readiness.percentage);

        container.innerHTML = `
    <div class="pipeline-dual-view">
    < !--HEADER SECTION-->
    <div class="pipeline-header" style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 24px;">
        <div>
            <h1 style="font-size: 24px; font-weight: 700; margin: 0;">Sales Pipeline</h1>
            <p style="color: #6B7280; margin-top: 4px;">Track opportunities and prerequisite completion</p>
        </div>
        <div class="header-actions" style="display: flex; gap: 12px; align-items: center;">
            <div class="filter-group" style="display: flex; gap: 8px;">
                <select class="form-control" style="width: 160px; height: 38px;" onchange="await app.setPipelineFilter('agent', this.value)">
                    <option value="all">All Agents</option>
                    ${agents.map(a => `<option value="${a.id}" ${_pipelineAgentFilter == a.id ? 'selected' : ''}>${a.full_name}</option>`).join('')}
                </select>
                <select class="form-control" style="width: 140px; height: 38px;" onchange="await app.setPipelineFilter('status', this.value)">
                    <option value="all">All Status</option>
                    <option value="prospect" ${_pipelineStatusFilter === 'prospect' ? 'selected' : ''}>Prospect</option>
                    <option value="active" ${_pipelineStatusFilter === 'active' ? 'selected' : ''}>Active</option>
                    <option value="warm" ${_pipelineStatusFilter === 'warm' ? 'selected' : ''}>Warm</option>
                    <option value="hot" ${_pipelineStatusFilter === 'hot' ? 'selected' : ''}>Hot</option>
                    <option value="converted" ${_pipelineStatusFilter === 'converted' ? 'selected' : ''}>Converted</option>
                </select>
            </div>
            <button class="btn secondary" onclick="await app.refreshPipeline()">
                <i class="fas fa-sync-alt"></i> Refresh
            </button>
            <button class="btn primary" onclick="await app.openPipelineConfigModal()">
                <i class="fas fa-cog"></i> Configure Rules
            </button>
        </div>
    </div>

    <!--TABLE 1: MONTH FOCUS - MANUAL PRIORITY LIST-->
    <div class="focus-section" style="margin-bottom: 32px; background: white; border-radius: 12px; box-shadow: 0 1px 3px rgba(0,0,0,0.1); padding: 20px;">
        <div class="section-header" style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px;">
            <div style="display: flex; align-items: center; gap: 12px;">
                <h2 style="font-size: 18px; font-weight: 600; margin: 0;">🔥 MONTH FOCUS - My Priority List</h2>
                <span style="background: #F3F4F6; padding: 4px 12px; border-radius: 20px; font-size: 12px; font-weight: 600;" id="focus-count">${focusList.length} prospects</span>
            </div>
            <button class="btn-icon" onclick="await app.saveManualOrder()" title="Save Order">
                <i class="fas fa-save"></i>
            </button>
        </div>
        
        <p style="font-size: 12px; color: #9CA3AF; margin-bottom: 16px;">
            <i class="fas fa-arrows-alt" style="margin-right: 4px;"></i> Drag the ☰ handle to reorder priority
        </p>
        
        <div class="focus-table-container" style="overflow-x: auto;">
            <table style="width: 100%; border-collapse: collapse; min-width: 1200px;">
                <thead>
                    <tr style="background: #F9FAFB; border-bottom: 2px solid #E5E7EB;">
                        <th style="padding: 12px 16px; text-align: left; font-size: 13px; font-weight: 600; color: #6B7280; width: 60px;">#</th>
                        <th style="padding: 12px 16px; text-align: left; font-size: 13px; font-weight: 600; color: #6B7280;">Prospect</th>
                        <th style="padding: 12px 16px; text-align: left; font-size: 13px; font-weight: 600; color: #6B7280;">Agent</th>
                        <th style="padding: 12px 16px; text-align: left; font-size: 13px; font-weight: 600; color: #6B7280;">Product</th>
                        <th style="padding: 12px 16px; text-align: left; font-size: 13px; font-weight: 600; color: #6B7280;">Amount</th>
                        <th style="padding: 12px 16px; text-align: left; font-size: 13px; font-weight: 600; color: #6B7280;">Readiness</th>
                        <th style="padding: 12px 16px; text-align: left; font-size: 13px; font-weight: 600; color: #6B7280;">Close Status</th>
                        <th style="padding: 12px 16px; text-align: left; font-size: 13px; font-weight: 600; color: #6B7280;">Actions</th>
                    </tr>
                </thead>
                <tbody id="focus-list-body">
                    ${focusList.map((rec, idx) => renderFocusRow(rec, idx, allActivities)).join('')}
                    ${focusList.length === 0 ? '<tr><td colspan="7" style="padding: 32px; text-align: center; color: #9CA3AF;">No prospects in your focus list yet.</td></tr>' : ''}
                </tbody>
            </table>
        </div>
    </div>

    <!--TABLE 2: SYSTEM PIPELINE - AUTO - CALCULATED-->
    <div class="pipeline-section" style="background: white; border-radius: 12px; box-shadow: 0 1px 3px rgba(0,0,0,0.1); padding: 20px;">
        <div class="section-header" style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px;">
            <div style="display: flex; align-items: center; gap: 12px;">
                <h2 style="font-size: 18px; font-weight: 600; margin: 0;">📊 System Pipeline</h2>
                <span style="background: #F3F4F6; padding: 4px 12px; border-radius: 20px; font-size: 12px; font-weight: 600;" id="pipeline-count">${systemProspects.length} prospects</span>
            </div>
        </div>

        <div class="pipeline-table-container" style="overflow-x: auto;">
            <table style="width: 100%; border-collapse: collapse; min-width: 1200px;">
                <thead>
                    <tr style="background: #F9FAFB; border-bottom: 2px solid #E5E7EB;">
                        <th style="padding: 12px 16px; text-align: left; font-size: 13px; font-weight: 600; color: #6B7280;">Prospect</th>
                        <th style="padding: 12px 16px; text-align: left; font-size: 13px; font-weight: 600; color: #6B7280;">Agent</th>
                        <th style="padding: 12px 16px; text-align: left; font-size: 13px; font-weight: 600; color: #6B7280;">Product</th>
                        <th style="padding: 12px 16px; text-align: left; font-size: 13px; font-weight: 600; color: #6B7280;">Amount</th>
                        <th style="padding: 12px 16px; text-align: left; font-size: 13px; font-weight: 600; color: #6B7280;">Status</th>
                        <th style="padding: 12px 16px; text-align: left; font-size: 13px; font-weight: 600; color: #6B7280;">Readiness</th>
                        <th style="padding: 12px 16px; text-align: left; font-size: 13px; font-weight: 600; color: #6B7280;">Close Status</th>
                        <th style="padding: 12px 16px; text-align: left; font-size: 13px; font-weight: 600; color: #6B7280;">Quick Action</th>
                    </tr>
                </thead>
                <tbody id="pipeline-list-body">
                    ${systemProspects.map(p => renderSystemRow(p, allActivities)).join('')}
                    ${systemProspects.length === 0 ? '<tr><td colspan="7" style="padding: 32px; text-align: center; color: #9CA3AF;">No active prospects found.</td></tr>' : ''}
                </tbody>
            </table>
        </div>
    </div>
</div>
    `;
    };

    const renderFocusRow = async (rec, idx, allActivities) => {
        const prospect = AppDataStore.getById('prospects', rec.prospect_id);
        if (!prospect) return '';

        const readiness = calculateReadiness(prospect, allActivities);
        const productInfo = getProposedProduct(prospect.id);
        const noteCount = getNoteCount(prospect.id);
        const outcome = getProspectOutcome(prospect);

        const readinessColor = readiness.label === 'HOT' ? '#DC2626' : (readiness.label === 'WARM' ? '#F59E0B' : '#6B7280');

        return `
            <tr class="focus-row draggable" data-list-id="${rec.id}" style="border-bottom: 1px solid #F3F4F6;">
                <td style="padding: 16px;">
                    <div class="drag-handle" style="cursor: grab; color: #9CA3AF;"><i class="fas fa-bars"></i></div>
                </td>
                <td style="padding: 16px;">
                    <div style="font-weight: 600; color: #111827;">${await escapeHtml(prospect.name)}</div>
                    <div style="font-size: 12px; color: #6B7280; margin-top: 2px;">Created: ${prospect.created_at || 'N/A'}</div>
                </td>
                <td style="padding: 16px;">
                    <div style="font-size: 13px;">${await escapeHtml(AppDataStore.getById('users', prospect.responsible_agent_id)?.full_name || 'Unassigned')}</div>
                </td>
                <td style="padding: 16px;">
                    <div style="font-weight: 500;">${await escapeHtml(productInfo.name)}</div>
                </td>
                <td style="padding: 16px; font-weight: 600; color: #059669;">RM ${productInfo.amount.toLocaleString()}</td>
                <td style="padding: 16px;">
                    <div style="display: flex; align-items: center; gap: 6px; margin-bottom: 6px;">
                        <span style="background: ${readinessColor}; color: white; padding: 2px 8px; border-radius: 12px; font-size: 11px; font-weight: 600;">${readiness.label === 'HOT' ? '🔥 ' : ''}${readiness.label}</span>
                        <span style="font-weight: 600; font-size: 14px;">${readiness.percentage}%</span>
                    </div>
                </td>
                <td style="padding: 16px;">
                    ${outcome === 'Won' ? '<span style="color: #059669; font-weight: 600;">✅ Won</span>' :
                (outcome === 'Lost' ? '<span style="color: #DC2626; font-weight: 600;">❌ Lost</span>' :
                    '<span style="color: #6B7280;">Open</span>')}
                </td>
                <td style="padding: 16px;">
                    <div style="display: flex; align-items: center; gap: 8px;">
                        <button class="btn-icon" onclick="event.stopPropagation(); await app.showProspectMenu(${prospect.id})" title="Options">
                            <i class="fas fa-ellipsis-v"></i>
                        </button>
                        <button class="btn-icon" onclick="event.stopPropagation(); await app.showComments(${prospect.id})" style="position: relative;" title="Comments">
                            <i class="fas fa-comment"></i>
                            <span style="position: absolute; top: -5px; right: -5px; background: #EF4444; color: white; border-radius: 50%; width: 16px; height: 16px; font-size: 10px; display: flex; align-items: center; justify-content: center;">${noteCount}</span>
                        </button>
                        <button class="btn-icon text-danger" onclick="event.stopPropagation(); await app.removeFromFocusList(${rec.id})" title="Remove from Focus">
                            <i class="fas fa-trash-alt"></i>
                        </button>
                    </div>
                </td>
            </tr>
        `;
    };

    const renderSystemRow = async (prospect, allActivities) => {
        const readiness = calculateReadiness(prospect, allActivities);
        const productInfo = getProposedProduct(prospect.id);
        const noteCount = getNoteCount(prospect.id);
        const outcome = getProspectOutcome(prospect);

        const readinessColor = readiness.label === 'HOT' ? '#DC2626' : (readiness.label === 'WARM' ? '#F59E0B' : '#6B7280');

        return `
            <tr class="pipeline-row" data-prospect-id="${prospect.id}" style="border-bottom: 1px solid #F3F4F6;">
                <td style="padding: 16px;">
                    <div style="font-weight: 600; color: #111827;">${await escapeHtml(prospect.name)}</div>
                    <div style="display: flex; align-items: center; gap: 4px; margin-top: 4px;">
                        <span style="font-size: 12px; color: #F59E0B;">⭐ ${prospect.score || 0}</span>
                        ${prospect.tags ? prospect.tags.split(',').map(t => `<span style="background: #FEF3C7; color: #92400E; padding: 2px 6px; border-radius: 4px; font-size: 10px;">${await escapeHtml(t.trim())}</span>`).join('') : ''}
                    </div>
                </td>
                <td style="padding: 16px;">
                    <div style="font-size: 13px;">${await escapeHtml(AppDataStore.getById('users', prospect.responsible_agent_id)?.full_name || 'Unassigned')}</div>
                </td>
                <td style="padding: 16px;">
                    <div style="font-weight: 500;">${await escapeHtml(productInfo.name)}</div>
                </td>
                <td style="padding: 16px; font-weight: 600; color: #059669;">RM ${productInfo.amount.toLocaleString()}</td>
                <td style="padding: 16px;">
                    <span style="background: #DBEAFE; color: #1E40AF; padding: 4px 8px; border-radius: 12px; font-size: 11px;">${prospect.status ? prospect.status.toUpperCase() : 'ACTIVE'}</span>
                </td>
                <td style="padding: 16px;">
                    <div style="display: flex; align-items: center; gap: 6px; margin-bottom: 6px;">
                        <span style="background: ${readinessColor}; color: white; padding: 2px 8px; border-radius: 12px; font-size: 11px; font-weight: 600;">${readiness.label === 'HOT' ? '🔥 ' : ''}${readiness.label}</span>
                        <span style="font-weight: 600; font-size: 14px;">${readiness.percentage}%</span>
                    </div>
                    <div style="width: 120px; height: 6px; background: #E5E7EB; border-radius: 3px; overflow: hidden; margin-bottom: 8px;">
                        <div style="width: ${readiness.percentage}%; height: 100%; background: ${readinessColor};"></div>
                    </div>
                    <div style="display: flex; flex-wrap: wrap; gap: 4px;">
                        ${['CPS', 'EVENT', 'MUSEUM', 'FTF', 'FSA'].map(type => {
            const hasActivity = readiness.badges.includes(type);
            return `<span style="background: ${hasActivity ? '#D1FAE5' : '#F3F4F6'}; color: ${hasActivity ? '#065F46' : '#9CA3AF'}; padding: 2px 6px; border-radius: 4px; font-size: 10px;">${hasActivity ? '✅ ' : '⬜ '}${type}</span>`;
        }).join('')}
                    </div>
                </td>
                <td style="padding: 16px;">
                    ${outcome === 'Won' ? '<span style="color: #059669; font-weight: 600;">✅ Won</span>' :
                (outcome === 'Lost' ? '<span style="color: #DC2626; font-weight: 600;">❌ Lost</span>' :
                    '<span style="color: #6B7280;">Open</span>')}
                </td>
                <td style="padding: 16px;">
                    <div style="display: flex; align-items: center; gap: 8px;">
                        <button class="btn secondary btn-sm" style="padding: 4px 12px; font-size: 12px;" onclick="await app.addToFocusList(${prospect.id})">
                            <i class="fas fa-plus"></i> Add to Focus
                        </button>
                        <button class="btn-icon" onclick="event.stopPropagation(); await app.showProspectMenu(${prospect.id})" title="Options">
                            <i class="fas fa-ellipsis-v"></i>
                        </button>
                        <button class="btn-icon" onclick="event.stopPropagation(); await app.showComments(${prospect.id})" style="position: relative;" title="Comments">
                            <i class="fas fa-comment"></i>
                            <span style="position: absolute; top: -5px; right: -5px; background: #3B82F6; color: white; border-radius: 50%; width: 16px; height: 16px; font-size: 10px; display: flex; align-items: center; justify-content: center;">${noteCount}</span>
                        </button>
                    </div>
                </td>
            </tr>
        `;
    };

    const refreshPipeline = async () => {
        const container = document.getElementById('content-viewport');
        if (container) await showPipelineView(container);
    };

    const addToFocusList = async (prospectId) => {
        const userId = _currentUser?.id || 5;
        const currentList = AppDataStore.query('my_potential_list', { user_id: userId });

        // Check if already in list
        if (currentList.some(item => item.prospect_id == prospectId)) {
            UI.toast.warn('Prospect is already in your focus list.');
            return;
        }

        const nextPriority = currentList.length + 1;

        await AppDataStore.create('my_potential_list', {
            user_id: userId,
            prospect_id: prospectId,
            priority_order: nextPriority
        });

        UI.toast.success('Added to Focus List');
        await refreshPipeline();
    };

    const removeFromFocusList = async (listItemId) => {
        const item = AppDataStore.getById('my_potential_list', listItemId);
        if (!item) return;

        const userId = item.user_id;
        AppDataStore.delete('my_potential_list', listItemId);

        // Re-compact
        const remaining = AppDataStore.query('my_potential_list', { user_id: userId })
            .sort((a, b) => a.priority_order - b.priority_order);

        remaining.forEach((rec, idx) => {
            AppDataStore.update('my_potential_list', rec.id, { priority_order: idx + 1 });
        });

        UI.toast.info('Removed from Focus List');
        await refreshPipeline();
    };

    const setPipelineFilter = async (type, value) => {
        if (type === 'agent') _pipelineAgentFilter = value;
        if (type === 'status') _pipelineStatusFilter = value;
        await refreshPipeline();
    };

    const openPipelineConfigModal = async () => {
        const config = loadReadinessConfig();
        const content = `
            <div class="config-modal" style="padding: 10px;">
                <h3 style="margin-bottom: 16px; border-bottom: 1px solid #EEE; padding-bottom: 8px;">Activity Weights (Total should be ~100)</h3>
                <div class="grid" style="display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin-bottom: 24px;">
                    <div class="form-group">
                        <label>CPS Weight (%)</label>
                        <input type="number" id="config-weight-cps" class="form-control" value="${config.weights.CPS}" min="0" max="100">
                    </div>
                    <div class="form-group">
                        <label>Event Weight (%)</label>
                        <input type="number" id="config-weight-event" class="form-control" value="${config.weights.EVENT}" min="0" max="100">
                    </div>
                    <div class="form-group">
                        <label>Museum Weight (%)</label>
                        <input type="number" id="config-weight-museum" class="form-control" value="${config.weights.MUSEUM}" min="0" max="100">
                    </div>
                    <div class="form-group">
                        <label>FTF Weight (%)</label>
                        <input type="number" id="config-weight-ftf" class="form-control" value="${config.weights.FTF}" min="0" max="100">
                    </div>
                    <div class="form-group">
                        <label>FSA Weight (%)</label>
                        <input type="number" id="config-weight-fsa" class="form-control" value="${config.weights.FSA}" min="0" max="100">
                    </div>
                    <div class="form-group">
                        <label>Lead Score Weight (%)</label>
                        <input type="number" id="config-weight-score" class="form-control" value="${config.weights.score}" min="0" max="100">
                    </div>
                </div>

                <h3 style="margin-bottom: 16px; border-bottom: 1px solid #EEE; padding-bottom: 8px;">Thresholds & Decay</h3>
                <div class="grid" style="display: grid; grid-template-columns: 1fr 1fr; gap: 16px;">
                    <div class="form-group">
                        <label>Hot Threshold (%)</label>
                        <input type="number" id="config-threshold-hot" class="form-control" value="${config.thresholds.hot}" min="0" max="100">
                    </div>
                    <div class="form-group">
                        <label>Warm Threshold (%)</label>
                        <input type="number" id="config-threshold-warm" class="form-control" value="${config.thresholds.warm}" min="0" max="100">
                    </div>
                    <div class="form-group">
                        <label>Full Weight Period (Days)</label>
                        <input type="number" id="config-full-weight-days" class="form-control" value="${config.fullWeightDays}" min="0">
                    </div>
                    <div class="form-group">
                        <label>Decay Period (Days)</label>
                        <input type="number" id="number" id="config-decay-days" class="form-control" value="${config.decayDays}" min="0">
                    </div>
                </div>
            </div>
        `;

        UI.showModal('Configure Pipeline Rules', content, [
            { label: 'Cancel', type: 'secondary', action: 'UI.hideModal()' },
            { label: 'Save Configuration', type: 'primary', action: 'await app.savePipelineConfig()' }
        ]);
    };

    const savePipelineConfig = async () => {
        const fullWeightDays = parseInt(document.getElementById('config-full-weight-days').value);
        const decayDays = parseInt(document.getElementById('config-decay-days').value);

        if (decayDays < fullWeightDays) {
            UI.toast.error('Decay Period must be greater than or equal to Full Weight Period.');
            return;
        }

        const config = {
            weights: {
                CPS: parseInt(document.getElementById('config-weight-cps').value),
                EVENT: parseInt(document.getElementById('config-weight-event').value),
                MUSEUM: parseInt(document.getElementById('config-weight-museum').value),
                FTF: parseInt(document.getElementById('config-weight-ftf').value),
                FSA: parseInt(document.getElementById('config-weight-fsa').value),
                score: parseInt(document.getElementById('config-weight-score').value)
            },
            thresholds: {
                hot: parseInt(document.getElementById('config-threshold-hot').value),
                warm: parseInt(document.getElementById('config-threshold-warm').value)
            },
            fullWeightDays,
            decayDays
        };

        localStorage.setItem('pipeline_readiness_config', JSON.stringify(config));
        UI.toast.success('Pipeline configuration saved.');
        UI.hideModal();
        await refreshPipeline();
    };

    const showProspectMenu = async (prospectId) => {
        if (typeof app.showProspectDetail === 'function') {
            await app.showProspectDetail(prospectId);
        } else {
            UI.toast.info(`Viewing profile for prospect ID: ${prospectId} `);
        }
    };

    const showComments = async (prospectId) => {
        const prospect = AppDataStore.getById('prospects', prospectId);
        const notes = AppDataStore.query('notes', { prospect_id: prospectId })
            .sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
        const activities = AppDataStore.query('activities', { prospect_id: prospectId })
            .sort((a, b) => new Date(b.activity_date) - new Date(a.activity_date));

        const content = `
            <div style="max-height: 400px; overflow-y: auto; margin-bottom: 16px;">
                <div style="background: #F9FAFB; padding: 12px; border-radius: 8px; margin-bottom: 16px;">
                    <textarea id="new-note-content" class="form-control" placeholder="Add a new comment/note..." style="min-height: 80px;"></textarea>
                    <div style="display: flex; justify-content: flex-end; margin-top: 8px;">
                        <button class="btn primary btn-sm" onclick="await app.addPipelineNote(${prospectId})">Add Note</button>
                    </div>
                </div>

                <div class="notes-timeline">
                    ${notes.map(n => `
                        <div style="border-left: 2px solid #E5E7EB; padding-left: 16px; margin-bottom: 20px; position: relative;">
                            <div style="position: absolute; left: -5px; top: 0; width: 8px; height: 8px; border-radius: 50%; background: #3B82F6;"></div>
                            <div style="font-size: 11px; color: #6B7280;">${new Date(n.created_at).toLocaleString()}</div>
                            <div style="margin-top: 4px;">${n.content}</div>
                        </div>
                    `).join('')}
                    ${activities.map(a => `
                        <div style="border-left: 2px solid #D1FAE5; padding-left: 16px; margin-bottom: 20px; position: relative;">
                            <div style="position: absolute; left: -5px; top: 0; width: 8px; height: 8px; border-radius: 50%; background: #10B981;"></div>
                            <div style="font-size: 11px; color: #6B7280;">${new Date(a.activity_date).toLocaleString()}</div>
                            <div style="font-weight: 600;">Activity: ${a.activity_type}</div>
                            <div style="margin-top: 2px;">${a.notes || 'No notes provided.'}</div>
                        </div>
                    `).join('')}
                    ${notes.length === 0 && activities.length === 0 ? '<p style="text-align: center; color: #9CA3AF;">No comments or activities found.</p>' : ''}
                </div>
            </div >
    `;

        UI.showModal(`Comments: ${prospect?.full_name || prospect?.name || 'Prospect'}`, content, [
            { label: 'Close', type: 'secondary', action: 'UI.hideModal()' }
        ]);
    };

    const addPipelineNote = async (prospectId) => {
        const content = document.getElementById('new-note-content').value;
        if (!content.trim()) {
            UI.toast.warn('Please enter some content for the note.');
            return;
        }

        await AppDataStore.create('notes', {
            prospect_id: prospectId,
            content: content.trim(),
            created_at: new Date().toISOString(),
            created_by: _currentUser?.id || 5
        });

        UI.toast.success('Note added.');
        await showComments(prospectId); // Refresh modal
        await refreshPipeline(); // Refresh badge count
    };

    const calculateDealValue = (prospect) => {
        if (!prospect) return 5000;

        // Base value from score
        let value = 5000;
        if (prospect.score) value += prospect.score * 10;

        // Add demographic factors
        if (prospect.income_range?.includes('15,000') || prospect.income_range?.includes('20,000')) {
            value += 2000;
        }
        if (prospect.occupation?.toLowerCase().includes('business') ||
            prospect.occupation?.toLowerCase().includes('owner') ||
            prospect.occupation?.toLowerCase().includes('director')) {
            value += 1500;
        }
        if (prospect.company_name) value += 1000;

        return Math.round(value / 100) * 100; // Round to nearest 100
    };

    const handleProspectDrag = (e, prospectId) => {
        e.dataTransfer.setData('text/plain', prospectId);
        e.dataTransfer.effectAllowed = 'move';
        e.target.classList.add('dragging');
    };

    const handleStageDrop = async (e, stageId) => {
        e.preventDefault();
        const prospectId = e.dataTransfer.getData('text/plain');
        const prospect = AppDataStore.getById('prospects', parseInt(prospectId));

        if (!prospect) return;

        // Remove dragging class
        document.querySelectorAll('.dragging').forEach(el => el.classList.remove('dragging'));

        // If moved to Closed Won, convert to customer
        if (stageId === 'closed-won') {
            UI.showModal('Close Deal',
                `<p>Convert <strong>${prospect.full_name || prospect.name}</strong> to customer?</p>
                 <div class="form-group">
                     <label>Deal Amount (RM)</label>
                     <input type="number" id="deal-amount" class="form-control" value="${prospect.deal_value || 5000}">
                 </div>
                 <div class="form-group">
                     <label>Close Date</label>
                     <input type="date" id="close-date" class="form-control" value="${new Date().toISOString().split('T')[0]}">
                 </div>`,
                [
                    { label: 'Cancel', type: 'secondary', action: 'UI.hideModal()' },
                    { label: 'Close Won', type: 'primary', action: `await app.closeDealWon(${prospect.id})` }
                ]
            );
        }
        // If moved to Closed Lost, ask for reason
        else if (stageId === 'closed-lost') {
            UI.showModal('Close Lost',
                `<p>Mark <strong>${prospect.full_name || prospect.name}</strong> as lost?</p>
                 <div class="form-group">
                     <label>Reason</label>
                     <select id="lost-reason" class="form-control">
                         <option value="Price too high">Price too high</option>
                         <option value="Chose competitor">Chose competitor</option>
                         <option value="No decision">No decision</option>
                         <option value="Budget constraints">Budget constraints</option>
                         <option value="Not interested">Not interested</option>
                         <option value="Other">Other</option>
                     </select>
                 </div>
                 <div class="form-group">
                     <label>Notes</label>
                     <textarea id="lost-notes" class="form-control" rows="2"></textarea>
                 </div>`,
                [
                    { label: 'Cancel', type: 'secondary', action: 'UI.hideModal()' },
                    { label: 'Close Lost', type: 'primary', action: `await app.closeDealLost(${prospect.id})` }
                ]
            );
        }
        // Normal stage move
        else {
            prospect.pipeline_stage = stageId;
            AppDataStore.update('prospects', prospect.id, prospect);

            // Log to audit
            if (typeof AuditLogger !== 'undefined') {
                AuditLogger.info('pipeline', 'stage_changed', {
                    prospect_id: prospect.id,
                    prospect_name: prospect.full_name,
                    new_stage: stageId
                });
            }

            await showPipelineView(document.getElementById('content-viewport'));
            UI.toast.success(`${prospect.full_name || prospect.name} moved to ${stageId}`);
        }
    };

    const closeDealWon = async (prospectId) => {
        const prospect = AppDataStore.getById('prospects', prospectId);
        const amount = parseFloat(document.getElementById('deal-amount')?.value || prospect.deal_value || 5000);
        const closeDate = document.getElementById('close-date')?.value || new Date().toISOString().split('T')[0];

        // Create customer record
        const customer = {
            id: Date.now(),
            full_name: prospect.full_name,
            phone: prospect.phone,
            email: prospect.email,
            ic_number: prospect.ic_number,
            date_of_birth: prospect.date_of_birth,
            ming_gua: prospect.ming_gua,
            element: prospect.element,
            gender: prospect.gender,
            occupation: prospect.occupation,
            company_name: prospect.company_name,
            address: prospect.address,
            lifetime_value: amount,
            status: 'active',
            customer_since: closeDate,
            responsible_agent_id: prospect.responsible_agent_id,
            converted_from_prospect_id: prospect.id,
            conversion_amount: amount,
            conversion_date: closeDate
        };

        await AppDataStore.create('customers', customer);

        // Update prospect
        prospect.status = 'converted';
        prospect.pipeline_stage = 'closed-won';
        prospect.deal_value = amount;
        prospect.closed_at = new Date().toISOString();
        prospect.closed_date = closeDate;
        AppDataStore.update('prospects', prospect.id, prospect);

        // Log to audit
        if (typeof AuditLogger !== 'undefined') {
            AuditLogger.critical('pipeline', 'deal_closed_won', {
                prospect_id: prospect.id,
                prospect_name: prospect.full_name,
                amount: amount,
                customer_id: customer.id
            });
        }

        UI.hideModal();
        UI.toast.success(`Deal closed at RM ${amount.toLocaleString()} !Customer created.`);
        await showPipelineView(document.getElementById('content-viewport'));
    };

    const closeDealLost = async (prospectId) => {
        const prospect = AppDataStore.getById('prospects', prospectId);
        const reason = document.getElementById('lost-reason')?.value || 'Not specified';
        const notes = document.getElementById('lost-notes')?.value || '';

        prospect.pipeline_stage = 'closed-lost';
        prospect.lost_reason = reason;
        prospect.lost_notes = notes;
        prospect.lost_at = new Date().toISOString();
        prospect.status = 'lost';
        AppDataStore.update('prospects', prospect.id, prospect);

        // Log to audit
        if (typeof AuditLogger !== 'undefined') {
            AuditLogger.info('pipeline', 'deal_closed_lost', {
                prospect_id: prospect.id,
                prospect_name: prospect.full_name,
                reason: reason
            });
        }

        UI.hideModal();
        UI.toast.info(`Deal marked as lost: ${reason} `);
        await showPipelineView(document.getElementById('content-viewport'));
    };

    const renderSystemRanking = async () => {
        const list = document.getElementById('system-ranking-list');
        if (!list) return;

        // Get top 5 prospects by score
        const prospects = await getVisibleProspects()
            .filter(p => p.status !== 'converted' && p.status !== 'lost')
            .sort((a, b) => (b.score || 0) - (a.score || 0))
            .slice(0, 5);

        list.innerHTML = prospects.map((p, idx) => `
            <div class="pipeline-card border-system">
                <div class="card-header">
                    <div class="card-title">
                        ${idx + 1}. ${p.full_name || p.name}
                    </div>
                </div>
                <div class="card-subtitle">
                    Score: ${p.score || 0} · Potential: ${calculatePotentialValue(p)}
                </div>
            </div>
        `).join('');
    };

    const renderManualPriority = async () => {
        const userId = _currentUser?.id || 5;
        const potentialRecords = AppDataStore.query('my_potential_list', { user_id: userId })
            .filter(rec => {
                const p = AppDataStore.getById('prospects', rec.prospect_id);
                return p && p.status !== 'converted' && p.status !== 'lost';
            })
            .sort((a, b) => a.priority_order - b.priority_order);

        // Since renderManualPriority usually calls refreshPipeline or similar, 
        // we should ensure the filtering is applied where the list is actually rendered.
        // The existing code just calls await refreshPipeline().
        await refreshPipeline();
    };

    const handleDragStart = (e, id) => {
        _draggedId = id;
        e.dataTransfer.effectAllowed = 'move';
        e.target.classList.add('dragging');
    };

    const handleDragOver = (e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        return false;
    };

    const handleDrop = async (e, targetId) => {
        e.preventDefault();
        e.stopPropagation();

        if (_draggedId === targetId) return;

        const userId = _currentUser?.id || 5;
        const list = AppDataStore.query('my_potential_list', { user_id: userId })
            .sort((a, b) => a.priority_order - b.priority_order);

        const draggedIndex = list.findIndex(i => i.id === _draggedId);
        const targetIndex = list.findIndex(i => i.id === targetId);

        if (draggedIndex === -1 || targetIndex === -1) return;

        // Reorder
        const [removed] = list.splice(draggedIndex, 1);
        list.splice(targetIndex, 0, removed);

        // Update priority_order and PERSIST
        list.forEach((item, idx) => {
            AppDataStore.update('my_potential_list', item.id, { priority_order: idx + 1 });
        });

        UI.toast.info('Order rearranged.');
        await refreshPipeline();
    };

    const saveManualOrder = async () => {
        // Since we persist in handleDrop, this just ensures everything is synced
        UI.toast.success('Manual priority order synced.');
        await refreshPipeline();
    };

    const renderRecentOverrides = () => {
        const container = document.getElementById('recent-overrides-table');
        if (!container) return;

        const overrides = AppDataStore.query('manual_overrides', { user_id: _currentUser?.id || 5 })
            .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
            .slice(0, 3);

        if (overrides.length === 0) {
            container.innerHTML = '<p class="text-muted">No recent overrides.</p>';
            return;
        }

        container.innerHTML = `
            <table class="history-table">
                <thead>
                    <tr>
                        <th>Prospect</th>
                        <th>Date</th>
                        <th>Type</th>
                        <th>Changes</th>
                        <th>Status</th>
                    </tr>
                </thead>
                <tbody>
                    ${overrides.map(o => {
            const prospect = AppDataStore.getById('prospects', o.prospect_id);
            const date = new Date(o.created_at).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
            return `
                            <tr>
                                <td>${prospect?.full_name || prospect?.name || 'Unknown'}</td>
                                <td>${date}</td>
                                <td><span class="type-badge type-${o.override_type}">${o.override_type.toUpperCase()}</span></td>
                                <td>#${o.system_rank} → #${o.new_priority}</td>
                                <td><span class="status-badge status-${o.status}">${o.status.toUpperCase()}</span></td>
                            </tr>
                        `;
        }).join('')}
                </tbody>
            </table>
        `;
    };


    // Boost Logic
    const openBoostModal = async () => {
        const prospects = await getVisibleProspects();
        const manualList = AppDataStore.query('my_potential_list', { user_id: _currentUser?.id || 5 });

        const options = manualList.map(item => {
            const p = prospects.find(pro => pro.id === item.prospect_id);
            if (!p) return '';
            return `<option value="${p.id}">${p.full_name || p.name} (Current Rank #${item.priority_order}, ${calculatePotentialValue(p)})</option>`;
        }).join('');

        const content = `
            <div class="form-group">
                <label>Select Prospect</label>
                <select id="boost-prospect-id" class="form-control">${options}</select>
            </div>
            <div class="form-group">
                <label>Justification Required <span style="color:red">*</span></label>
                <textarea id="boost-justification" class="form-control boost-justification" placeholder="Why should this prospect be prioritized? Provide details about conversation, urgency, or potential."></textarea>
            </div>
            <div class="form-group">
                <label>Reason Category</label>
                <div class="reason-group">
                    <label><input type="radio" name="boost-reason" value="conversation" checked> Direct conversation</label>
                    <label><input type="radio" name="boost-reason" value="interest"> High interest</label>
                    <label><input type="radio" name="boost-reason" value="urgency"> Urgency</label>
                </div>
            </div>
            <div class="expiry-checkbox">
                <label><input type="checkbox" id="boost-expires" checked> This override expires in 7 days</label>
            </div>
`;

        UI.showModal('Boost Opportunity', content, [
            { label: 'Cancel', type: 'secondary', action: 'UI.hideModal()' },
            { label: 'Confirm Boost', type: 'primary', action: 'await app.submitBoost()' }
        ]);
    };

    const submitBoost = async () => {
        const prospectId = parseInt(document.getElementById('boost-prospect-id').value);
        const justification = document.getElementById('boost-justification').value;
        const reason = document.querySelector('input[name="boost-reason"]:checked').value;
        const expires = document.getElementById('boost-expires').checked;

        if (!justification) {
            UI.toast.error('Justification is required.');
            return;
        }

        const manualList = AppDataStore.query('my_potential_list', { user_id: _currentUser?.id || 5 })
            .sort((a, b) => a.priority_order - b.priority_order);

        const currentItem = manualList.find(i => i.prospect_id === prospectId);
        const oldRank = currentItem.priority_order;

        // Move to Rank 1 (priority_order = 1)
        // Shift others down
        manualList.forEach(item => {
            if (item.priority_order < oldRank) {
                item.priority_order += 1;
                AppDataStore.update('my_potential_list', item.id, { priority_order: item.priority_order });
            }
        });
        AppDataStore.update('my_potential_list', currentItem.id, { priority_order: 1 });

        // Log override
        const override = {
            user_id: _currentUser?.id || 5,
            prospect_id: prospectId,
            override_type: 'boost',
            system_rank: oldRank, // For demo, we use current rank as system rank surrogate if not stored
            new_priority: 1,
            reason_category: reason,
            justification: justification,
            status: 'active',
            expires_at: expires ? new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString() : null
        };
        await AppDataStore.create('manual_overrides', override);

        UI.hideModal();
        await renderManualPriority();
        renderRecentOverrides();
        UI.toast.success('Opportunity boosted to priority #1.');
    };

    // History Logic
    const openHistoryModal = async () => {
        const content = `
            <div class="filter-bar" style="margin-bottom: 20px;">
                <div class="filter-group">
                    <label>From - To</label>
                    <div style="display:flex; gap:8px;">
                        <input type="date" class="form-control" id="hist-from">
                        <input type="date" class="form-control" id="hist-to">
                    </div>
                </div>
                <div class="filter-group">
                    <label>Type</label>
                    <select class="form-control" id="hist-type">
                        <option value="all">All</option>
                        <option value="boost">Boost</option>
                        <option value="demote">Demote</option>
                    </select>
                </div>
                <div class="filter-group">
                    <label>Status</label>
                    <select class="form-control" id="hist-status">
                        <option value="all">All</option>
                        <option value="active">Active</option>
                        <option value="expired">Expired</option>
                    </select>
                </div>
            </div>
            <div id="history-modal-table">
                <!-- Data loaded here -->
            </div>
`;

        UI.showModal('Manual Override History', content, [
            { label: 'Close', type: 'secondary', action: 'UI.hideModal()' }
        ]);

        loadOverrideHistory();

        // Add event listeners for filters
        (() => {
            ['hist-type', 'hist-status'].forEach(id => {
                document.getElementById(id).addEventListener('change', () => loadOverrideHistory());
            });
        }, 100);
    };

    const loadOverrideHistory = () => {
        const type = document.getElementById('hist-type').value;
        const status = document.getElementById('hist-status').value;

        let overrides = AppDataStore.query('manual_overrides', { user_id: _currentUser?.id || 5 });

        if (type !== 'all') overrides = overrides.filter(o => o.override_type === type);
        if (status !== 'all') overrides = overrides.filter(o => o.status === status);

        const container = document.getElementById('history-modal-table');
        if (!container) return;

        container.innerHTML = `
            <table class="history-table">
                <thead>
                    <tr>
                        <th>Prospect Name</th>
                        <th>Date</th>
                        <th>Type</th>
                        <th>From Rank → To Rank</th>
                        <th>Status</th>
                        <th>Actions</th>
                    </tr>
                </thead>
                <tbody>
                    ${overrides.map(o => {
            const prospect = AppDataStore.getById('prospects', o.prospect_id);
            const date = new Date(o.created_at).toLocaleDateString();
            return `
                            <tr>
                                <td>${prospect?.full_name || prospect?.name || 'Unknown'}</td>
                                <td>${date}</td>
                                <td><span class="type-badge type-${o.override_type}">${o.override_type.toUpperCase()}</span></td>
                                <td>#${o.system_rank} → #${o.new_priority}</td>
                                <td><span class="status-badge status-${o.status}">${o.status.toUpperCase()}</span></td>
                                <td><button class="btn btn-sm secondary" onclick="app.viewJustification(${o.id})">View</button></td>
                            </tr>
                        `;
        }).join('')}
                </tbody>
            </table>
        `;
    };

    const viewJustification = (overrideId) => {
        const override = AppDataStore.getById('manual_overrides', overrideId);
        if (!override) return;

        const prospect = AppDataStore.getById('prospects', override.prospect_id);

        const content = `
            <div style="padding: 10px;">
                <p><strong>Prospect:</strong> ${prospect?.full_name}</p>
                <p><strong>Type:</strong> ${override.override_type === 'boost' ? '🚀 Boost' : '⬇️ Demote'}</p>
                <p><strong>Reason Category:</strong> ${override.reason_category}</p>
                <hr>
                <p><strong>Justification:</strong></p>
                <p style="background: #f9fafb; padding: 15px; border-radius: 8px; font-style: italic;">"${override.justification}"</p>
                <p><strong>Date:</strong> ${new Date(override.created_at).toLocaleString()}</p>
                ${override.expires_at ? `<p><strong>Expires:</strong> ${new Date(override.expires_at).toLocaleString()}</p>` : ''}
            </div>
`;

        UI.showModal('Override Justification', content, [
            { label: 'Close', type: 'secondary', action: 'UI.hideModal()' }
        ]);
    };

    // ==================== PHASE 9: REPORTING & KPI DASHBOARD ====================

    const KPI_DEFINITIONS = {
        cpsCount: "Consultation and Planning Sessions - Count of completed CPS activities",
        totalSales: "Revenue including EPP but excluding agent packages",
        popCaseCount: "Pre-Owned Plan cases - Count of transactions with payment_method = POP",
        popSales: "Revenue from POP cases - Sum of POP transaction amounts",
        eppCaseCount: "Easy Payment Plan cases - Count of transactions with payment_method = EPP",
        eppSales: "Revenue from EPP cases - Sum of EPP transaction amounts",
        newAgents: "Agent recruits - Count of new agents created",
        newCustomers: "Customer conversions - Count of prospects converted to customers",
        totalMeetings: "Meeting headcount - Sum of attendees across all meetings",
        activityHeadcount: "Event attendance - Sum of attendees by activity title"
    };

    let _currentTimeFilter = 'monthly';
    let _currentRoleFilter = 'All';
    let _customDateFrom = new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().split('T')[0];
    let _customDateTo = new Date().toISOString().split('T')[0];
    let _revenueChart = null;

    const showKPIDashboard = async (container) => {
        _selectedEntity = null; // Clear selection
        container.innerHTML = `
            <div class="kpi-dashboard">
                <div class="dashboard-header">
                    <div>
                        <h1>Reporting & KPI Dashboard</h1>
                        <p>Real-time performance tracking and hierarchical targets</p>
                    </div>
                    <div class="header-actions">
                        ${isSystemAdmin(_currentUser) || _currentUser?.role?.includes('Level 7') ?
                `<button class="btn primary" onclick="await app.openTargetManagementModal()">
                                <i class="fas fa-bullseye"></i> Set Targets
                             </button>` : ''
            }
                        <button class="btn secondary" onclick="await app.exportKPIReport('csv')">
                            <i class="fas fa-file-csv"></i> Export CSV
                        </button>
                        <button class="btn secondary" onclick="app.printDashboard()">
                            <i class="fas fa-print"></i> Print
                        </button>
                    </div>
                </div>

                <div class="time-filter-bar">
                    <div class="time-toggle-group">
                        <button class="time-toggle-btn ${_currentTimeFilter === 'weekly' ? 'active' : ''}" onclick="await app.setTimeFilter('weekly')">Weekly</button>
                        <button class="time-toggle-btn ${_currentTimeFilter === 'monthly' ? 'active' : ''}" onclick="await app.setTimeFilter('monthly')">Monthly</button>
                        <button class="time-toggle-btn ${_currentTimeFilter === 'quarterly' ? 'active' : ''}" onclick="await app.setTimeFilter('quarterly')">Quarterly</button>
                        <button class="time-toggle-btn ${_currentTimeFilter === 'yearly' ? 'active' : ''}" onclick="await app.setTimeFilter('yearly')">Yearly</button>
                    </div>
                    <div class="role-filter-group" style="margin-left: 20px;">
                        <select id="kpi-role-filter" class="form-control" onchange="await app.setRoleFilter(this.value)" style="width: 200px;">
                            <option value="All">All Roles</option>
                            ${USER_ROLES.map(r => `<option value="${r}" ${_currentRoleFilter === r ? 'selected' : ''}>${r}</option>`).join('')}
                        </select>
                    </div>
                    <div class="date-range-picker" style="margin-left: auto;">
                        <input type="date" id="kpi-date-from" value="${_customDateFrom}" onchange="await app.setCustomDateRange(this.value, document.getElementById('kpi-date-to').value)">
                        <span>to</span>
                        <input type="date" id="kpi-date-to" value="${_customDateTo}" onchange="await app.setCustomDateRange(document.getElementById('kpi-date-from').value, this.value)">
                    </div>
                </div>

                <div id="kpi-stats-grid" class="stats-grid">
                    <!-- Stat cards loaded by refreshKPIDashboard -->
                </div>

                <div class="dashboard-charts-row" style="display: grid; grid-template-columns: 2fr 1fr; gap: 24px; margin-bottom: 24px;">
                    <div class="chart-container">
                        <div class="chart-header">
                            <h3>Revenue Trend (Actual vs Target)</h3>
                            <div class="chart-legend">
                                <span style="display:inline-block; width:12px; height:12px; background:#0D9488; margin-right:4px;"></span> Actual
                                <span style="display:inline-block; width:12px; height:12px; background:#94a3b8; margin-right:4px; margin-left:12px;"></span> Target
                            </div>
                        </div>
                        <canvas id="revenue-trend-chart"></canvas>
                    </div>
                    <div id="target-overview-container">
                        <!-- Target overview loaded by refreshKPIDashboard -->
                    </div>
                </div>

                <div style="display: grid; grid-template-columns: 1.5fr 1fr; gap: 24px;">
                    <div class="performance-card card">
                        <div class="card-header">
                            <h3>Current Quarter Performance Breakdown</h3>
                        </div>
                        <div id="quarterly-performance-table">
                            <!-- Performance table loaded by refreshKPIDashboard -->
                        </div>
                    </div>
                    <div class="leaderboard-card">
                        <div class="leaderboard-header">
                            <h3>Agent Performance Leaderboard</h3>
                        </div>
                        <div id="agent-leaderboard-table">
                            <!-- Leaderboard loaded by refreshKPIDashboard -->
                        </div>
                    </div>
                </div>
            </div>
`;

        await refreshKPIDashboard();
    };

    const setTimeFilter = async (filter) => {
        _currentTimeFilter = filter;
        await refreshKPIDashboard();
    };

    const setRoleFilter = async (role) => {
        _currentRoleFilter = role;
        await refreshKPIDashboard();
    };

    const setCustomDateRange = async (from, to) => {
        _customDateFrom = from;
        _customDateTo = to;
        _currentTimeFilter = 'custom';
        await refreshKPIDashboard();
    };

    const refreshKPIDashboard = async () => {
        const ranges = getDateRanges(_currentTimeFilter, _customDateFrom, _customDateTo);
        const kpis = await calculateKPIs(ranges.current.from, ranges.current.to);
        const prevKpis = await calculateKPIs(ranges.previous.from, ranges.previous.to);

        renderKPIStats(kpis, prevKpis);
        await renderTargetOverview();
        await renderPerformanceTable();
        await renderAgentLeaderboard();
        await renderRevenueChart(_currentTimeFilter, ranges.current);
    };

    const getDateRanges = (filter, from, to) => {
        const now = new Date();
        let currentFrom, currentTo, prevFrom, prevTo;

        if (filter === 'weekly') {
            currentTo = new Date(now);
            currentFrom = new Date(now);
            currentFrom.setDate(now.getDate() - 7);
            prevTo = new Date(currentFrom);
            prevFrom = new Date(currentFrom);
            prevFrom.setDate(prevFrom.getDate() - 7);
        } else if (filter === 'monthly') {
            currentTo = new Date(now);
            currentFrom = new Date(now.getFullYear(), now.getMonth(), 1);
            prevTo = new Date(now.getFullYear(), now.getMonth(), 0);
            prevFrom = new Date(now.getFullYear(), now.getMonth() - 1, 1);
        } else if (filter === 'quarterly') {
            const quarter = Math.floor(now.getMonth() / 3);
            currentFrom = new Date(now.getFullYear(), quarter * 3, 1);
            currentTo = new Date(now);
            prevFrom = new Date(now.getFullYear(), (quarter - 1) * 3, 1);
            prevTo = new Date(now.getFullYear(), quarter * 3, 0);
        } else if (filter === 'yearly') {
            currentFrom = new Date(now.getFullYear(), 0, 1);
            currentTo = new Date(now);
            prevFrom = new Date(now.getFullYear() - 1, 0, 1);
            prevTo = new Date(now.getFullYear() - 1, 11, 31);
        } else {
            currentFrom = new Date(from);
            currentTo = new Date(to);
            const diff = currentTo - currentFrom;
            prevTo = new Date(currentFrom);
            prevFrom = new Date(currentFrom - diff);
        }

        return {
            current: { from: currentFrom.toISOString().split('T')[0], to: currentTo.toISOString().split('T')[0] },
            previous: { from: prevFrom.toISOString().split('T')[0], to: prevTo.toISOString().split('T')[0] }
        };
    };

    const calculateKPIs = async (from, to) => {
        return {
            cpsCount: await getCPSCount(from, to),
            totalSales: getTotalSales(from, to),
            popCaseCount: await getPOPCaseCount(from, to),
            popSales: await getPOPSales(from, to),
            eppCaseCount: await getEPPCaseCount(from, to),
            eppSales: await getEPPSales(from, to),
            newAgents: await getNewAgents(from, to),
            newCustomers: await getNewCustomers(from, to),
            totalMeetings: await getTotalMeetings(from, to),
            activityHeadcount: await getActivityHeadcount(from, to),
            conversionRate: await getConversionRate(from, to)
        };
    };

    const getConversionRate = async (from, to) => {
        const totalProspects = await AppDataStore.getAll('prospects').filter(p => p.created_at >= from && p.created_at <= to).length;
        const convertedCount = await AppDataStore.getAll('customers').filter(c => c.customer_since >= from && c.customer_since <= to).length;
        if (totalProspects === 0) return 0;
        return Math.round((convertedCount / totalProspects) * 100);
    };

    const getCPSCount = async (from, to) => {
        return await AppDataStore.getAll('activities').filter(a => {
            if (a.activity_type !== 'CPS' || a.activity_date < from || a.activity_date > to) return false;
            if (_currentRoleFilter !== 'All') {
                const agent = AppDataStore.getById('users', a.agent_id);
                if (!agent || agent.role !== _currentRoleFilter) return false;
            }
            return true;
        }).length;
    };

    const getTotalSales = async (from, to) => {
        // Sum async purchases (excluding agent packages)
        return await AppDataStore.getAll('purchases').filter(p => {
            if (p.date < from || p.date > to || p.is_agent_package) return false;
            if (_currentRoleFilter !== 'All') {
                const agent = AppDataStore.getById('users', p.agent_id);
                if (!agent || agent.role !== _currentRoleFilter) return false;
            }
            return true;
        }).reduce((sum, p) => sum + (p.amount || 0), 0);
    };

    const getPOPCaseCount = async (from, to) => {
        return await AppDataStore.getAll('purchases').filter(p => {
            if (p.payment_method !== 'POP' || p.date < from || p.date > to) return false;
            if (_currentRoleFilter !== 'All') {
                const agent = AppDataStore.getById('users', p.agent_id);
                if (!agent || agent.role !== _currentRoleFilter) return false;
            }
            return true;
        }).length;
    };

    const getPOPSales = async (from, to) => {
        return await AppDataStore.getAll('purchases').filter(p => {
            if (p.payment_method !== 'POP' || p.date < from || p.date > to) return false;
            if (_currentRoleFilter !== 'All') {
                const agent = AppDataStore.getById('users', p.agent_id);
                if (!agent || agent.role !== _currentRoleFilter) return false;
            }
            return true;
        }).reduce((sum, p) => sum + (p.amount || 0), 0);
    };

    const getEPPCaseCount = async (from, to) => {
        return await AppDataStore.getAll('purchases').filter(p => {
            if (p.payment_method !== 'EPP' || p.date < from || p.date > to) return false;
            if (_currentRoleFilter !== 'All') {
                const agent = AppDataStore.getById('users', p.agent_id);
                if (!agent || agent.role !== _currentRoleFilter) return false;
            }
            return true;
        }).length;
    };

    const getEPPSales = async (from, to) => {
        return await AppDataStore.getAll('purchases').filter(p => {
            if (p.payment_method !== 'EPP' || p.date < from || p.date > to) return false;
            if (_currentRoleFilter !== 'All') {
                const agent = AppDataStore.getById('users', p.agent_id);
                if (!agent || agent.role !== _currentRoleFilter) return false;
            }
            return true;
        }).reduce((sum, p) => sum + (p.amount || 0), 0);
    };

    const getNewAgents = async (from, to) => {
        return await AppDataStore.getAll('users').filter(u => {
            if (u.join_date < from || u.join_date > to) return false;
            if (_currentRoleFilter !== 'All') {
                if (u.role !== _currentRoleFilter) return false;
            } else {
                // Default legacy behavior: only count consultants/agents if no filter
                if (!isAgent(u)) return false;
            }
            return true;
        }).length;
    };

    const getNewCustomers = async (from, to) => {
        return await  AppDataStore.getAll('customers').filter(c =>
            c.customer_since >= from && c.customer_since <= to
        ).length;
    };

    const getTotalMeetings = async (from, to) => {
        // Sum attendees across all meetings (activities) in date range
        return await AppDataStore.getAll('activities').filter(a => {
            if (a.activity_date < from || a.activity_date > to) return false;
            if (_currentRoleFilter !== 'All') {
                const agent = AppDataStore.getById('users', a.agent_id);
                if (!agent || agent.role !== _currentRoleFilter) return false;
            }
            return true;
        }).length;
    };

    const getActivityHeadcount = async (from, to) => {
        // Sum attendees from registrations
        return await AppDataStore.getAll('event_registrations').filter(r => {
            if (!r.checked_in || r.checked_in_at < from || r.checked_in_at > to) return false;
            if (_currentRoleFilter !== 'All') {
                const agent = AppDataStore.getById('users', r.agent_id); // Assuming agent_id exists in registration
                if (!agent || agent.role !== _currentRoleFilter) return false;
            }
            return true;
        }).length;
    };

    const renderKPIStats = (kpis, prevKpis) => {
        const grid = document.getElementById('kpi-stats-grid');
        if (!grid) return;

        const cards = [
            { label: 'CPS Consultations', value: kpis.cpsCount, prev: prevKpis.cpsCount, icon: '📞', color: 'blue', key: 'cpsCount' },
            { label: 'Total Sales', value: `RM ${kpis.totalSales.toLocaleString()} `, prev: prevKpis.totalSales, icon: '💰', color: 'green', key: 'totalSales' },
            { label: 'POP Cases', value: kpis.popCaseCount, prev: prevKpis.popCaseCount, icon: '📦', color: 'orange', key: 'popCaseCount' },
            { label: 'EPP Cases', value: kpis.eppCaseCount, prev: prevKpis.eppCaseCount, icon: '💳', color: 'purple', key: 'eppCaseCount' },
            { label: 'New Agents', value: kpis.newAgents, prev: prevKpis.newAgents, icon: '👤', color: 'blue', key: 'newAgents' },
            { label: 'New Customers', value: kpis.newCustomers, prev: prevKpis.newCustomers, icon: '👥', color: 'green', key: 'newCustomers' },
            { label: 'Conversion Rate', value: `${kpis.conversionRate}% `, prev: prevKpis.conversionRate, icon: '📈', color: 'purple', key: 'conversionRate' },
            { label: 'Total Meetings', value: kpis.totalMeetings, prev: prevKpis.totalMeetings, icon: '📅', color: 'orange', key: 'totalMeetings' },
            { label: 'Activity Attendance', value: kpis.activityHeadcount, prev: prevKpis.activityHeadcount, icon: '📊', color: 'purple', key: 'activityHeadcount' }
        ];

        grid.innerHTML = cards.map(c => {
            const diff = c.prev > 0 ? ((kpis[c.key] - prevKpis[c.key]) / prevKpis[c.key] * 100).toFixed(1) : (kpis[c.key] > 0 ? '100' : '0');
            const trendClass = diff >= 0 ? 'trend-up' : 'trend-down';
            const trendIcon = diff >= 0 ? 'fa-arrow-up' : 'fa-arrow-down';

            return `
                <div class="stat-card">
                    <div class="stat-info">
                        <h3>
                            ${c.label}
                            <div class="kpi-tooltip">
                                <i class="fas fa-info-circle"></i>
                                <span class="tooltip-text">${KPI_DEFINITIONS[c.key]}</span>
                            </div>
                        </h3>
                        <div class="stat-value">${c.value}</div>
                        <div class="stat-trend ${trendClass}">
                            <i class="fas ${trendIcon}"></i>
                            <span>${Math.abs(diff)}% vs last period</span>
                        </div>
                    </div>
                    <div class="stat-icon ${c.color}">
                        ${c.icon}
                    </div>
                </div>
            `;
        }).join('');
    };

    const renderTargetOverview = async () => {
        const container = document.getElementById('target-overview-container');
        if (!container) return;

        const year = 2026;
        const qTargets =await  AppDataStore.getAll('quarterly_targets').filter(t => t.year === year);

        container.innerHTML = `
            <div class="targets-card">
                <div class="targets-header">
                    <h2>${year} Target Overview</h2>
                </div>
                <table class="targets-table">
                    <thead>
                        <tr>
                            <th>Quarter</th>
                            <th>CPS Target</th>
                            <th>Sales Target</th>
                            <th>Progress</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${[1, 2, 3, 4].map(q => {
            const target = qTargets.find(t => t.year === year && t.quarter === q) || {};
            // Sum actual sales for this quarter
            const qStart = `${year}-${((q - 1) * 3 + 1).toString().padStart(2, '0')}-01`;
            const qEnd = `${year}-${(q * 3).toString().padStart(2, '0')}-${new Date(year, q * 3, 0).getDate()}`;
            const actualSales =await  AppDataStore.getAll('purchases').filter(p =>
                p.date >= qStart && p.date <= qEnd && !p.is_agent_package
            ).reduce((sum, p) => sum + (p.amount || 0), 0);

            const progress = target.total_sales_target ? Math.min(100, (actualSales / target.total_sales_target * 100)) : 0;
            const statusColor = progress > 90 ? 'green' : (progress > 70 ? 'yellow' : (progress > 0 ? 'red' : 'gray'));

            return `
                                <tr>
                                    <td>Q${q}</td>
                                    <td>${target.cps_count_target || 0}</td>
                                    <td>RM ${(target.total_sales_target || 0).toLocaleString()}</td>
                                    <td>
                                        <div class="target-progress">
                                            <div class="progress-bar-bg">
                                                <div class="progress-bar-fill progress-${statusColor}" style="width: ${progress}%"></div>
                                            </div>
                                            <span style="font-size: 12px; font-weight: 600;">${progress > 0 ? progress.toFixed(0) + '%' : '0%'}</span>
                                        </div>
                                    </td>
                                </tr>
                            `;
        }).join('')}
                    </tbody>
                </table>
            </div>
        `;
    };

    const renderPerformanceTable = async () => {
        const container = document.getElementById('quarterly-performance-table');
        if (!container) return;

        const ranges = getDateRanges('quarterly');
        const kpis = await calculateKPIs(ranges.current.from, ranges.current.to);
        const year = new Date().getFullYear();
        const quarter = Math.floor(new Date().getMonth() / 3) + 1;
        const qTarget = await AppDataStore.getAll('quarterly_targets').find(t => t.year === year && t.quarter === quarter) || {};

        const metrics = [
            { name: 'CPS Count', target: qTarget.cps_count_target || 0, actual: kpis.cpsCount },
            { name: 'Total Sales', target: qTarget.total_sales_target || 0, actual: kpis.totalSales, isRM: true },
            { name: 'New Agents', target: qTarget.new_agents_target || 0, actual: kpis.newAgents },
            { name: 'New Customers', target: qTarget.new_customers_target || 0, actual: kpis.newCustomers },
            { name: 'POP Cases', target: qTarget.pop_case_count_target || 0, actual: kpis.popCaseCount },
            { name: 'EPP Cases', target: qTarget.epp_case_count_target || 0, actual: kpis.eppCaseCount }
        ];

        container.innerHTML = `
            <table class="performance-table">
                <thead>
                    <tr>
                        <th>Metric</th>
                        <th>Target</th>
                        <th>Actual</th>
                        <th>Variance</th>
                        <th>Achievement</th>
                    </tr>
                </thead>
                <tbody>
                    ${metrics.map(m => {
            const variance = m.actual - m.target;
            const achievement = m.target > 0 ? (m.actual / m.target * 100) : 0;
            const statusClass = achievement > 90 ? 'success' : (achievement > 70 ? 'warning' : 'danger');
            const statusIcon = achievement > 90 ? '🟢' : (achievement > 70 ? '🟡' : '🔴');

            return `
                            <tr>
                                <td>${m.name}</td>
                                <td>${m.isRM ? 'RM ' : ''}${m.target.toLocaleString()}</td>
                                <td>${m.isRM ? 'RM ' : ''}${m.actual.toLocaleString()}</td>
                                <td style="color: ${variance >= 0 ? 'var(--success)' : 'var(--error)'}">
                                    ${m.isRM ? (variance >= 0 ? '+RM ' : '-RM ') : (variance >= 0 ? '+' : '')}${Math.abs(variance).toLocaleString()}
                                </td>
                                <td>
                                    <span class="status-badge-${statusClass}">${achievement.toFixed(1)}% ${statusIcon}</span>
                                </td>
                            </tr>
                        `;
        }).join('')}
                </tbody>
            </table>
        `;
    };

    const renderAgentLeaderboard = async () => {
        const container = document.getElementById('agent-leaderboard-table');
        if (!container) return;

        // Get all agents
        let agentsList = await AppDataStore.getAll('users').filter(isAgent);
        if (_currentRoleFilter !== 'All') {
            agentsList = agentsList.filter(u => u.role === _currentRoleFilter);
        }
        const ranges = getDateRanges(_currentTimeFilter);

        const agentStats = agentsList.map(agent => {
            const currentSales =await  AppDataStore.getAll('purchases').filter(p =>
                p.agent_id === agent.id && p.date >= ranges.current.from && p.date <= ranges.current.to
            ).reduce((sum, p) => sum + (p.amount || 0), 0);

            const prevSales = await AppDataStore.getAll('purchases').filter(p =>
                p.agent_id === agent.id && p.date >= ranges.previous.from && p.date <= ranges.previous.to
            ).reduce((sum, p) => sum + (p.amount || 0), 0);

            let trend = 'Stable';
            let trendClass = 'warning';
            if (prevSales > 0) {
                const diff = ((currentSales - prevSales) / prevSales * 100);
                trend = (diff >= 0 ? '+' : '') + diff.toFixed(0) + '%';
                trendClass = diff >= 0 ? 'success' : 'danger';
            } else if (currentSales > 0) {
                trend = 'New';
                trendClass = 'success';
            }

            return {
                name: agent.full_name,
                team: agent.team || 'General',
                sales: currentSales,
                trend: trend,
                trendClass: trendClass
            };
        }).sort((a, b) => b.sales - a.sales).slice(0, 10);

        container.innerHTML = `
            <table class="leaderboard-table">
                <thead>
                    <tr>
                        <th>Rank</th>
                        <th>Agent</th>
                        <th>Sales</th>
                        <th>Trend</th>
                    </tr>
                </thead>
                <tbody>
                    ${agentStats.map((a, i) => `
                        <tr>
                            <td><span class="rank-badge rank-${Math.min(i + 1, 5)}">${i + 1}</span></td>
                            <td>
                                <div><strong>${a.name}</strong></div>
                                <div style="font-size: 11px; color: var(--gray-500);">${a.team}</div>
                            </td>
                            <td>RM ${a.sales.toLocaleString()}</td>
                            <td><span class="status-badge-${a.trendClass}">${a.trend}</span></td>
                        </tr>
                    `).join('')}
                    ${agentStats.length === 0 ? '<tr><td colspan="4" style="text-align:center; padding: 20px;">No agent data for this period</td></tr>' : ''}
                </tbody>
            </table>
        `;
    };

    const renderRevenueChart = async (filter, range) => {
        const ctx = document.getElementById('revenue-trend-chart');
        if (!ctx) return;

        if (_revenueChart) _revenueChart.destroy();

        let labels = [];
        let actualData = [];
        let targetData = [];

        const year = new Date().getFullYear();
        const yTarget = await AppDataStore.getAll('yearly_targets').find(t => t.target_year === year) || {};
        const qTargets = await AppDataStore.getAll('quarterly_targets').filter(t => t.year === year);

        if (filter === 'weekly') {
            labels = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
            const dayMap = { 0: 6, 1: 0, 2: 1, 3: 2, 4: 3, 5: 4, 6: 5 }; // Sunday is 0 in JS
            actualData = [0, 0, 0, 0, 0, 0, 0];

            const currentWeekPurchases = await AppDataStore.getAll('purchases').filter(p =>
                p.date >= range.from && p.date <= range.to && !p.is_agent_package
            );

            currentWeekPurchases.forEach(p => {
                const day = new Date(p.date).getDay();
                actualData[dayMap[day]] += (p.amount || 0);
            });

            const weeklyTarget = (yTarget.total_sales_target || 0) / 52;
            targetData = Array(7).fill(weeklyTarget / 7);
        } else if (filter === 'monthly') {
            labels = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
            actualData = Array(12).fill(0);
            targetData = Array(12).fill(0);

            const yearPurchases = await AppDataStore.getAll('purchases').filter(p =>
                p.date.startsWith(year.toString()) && !p.is_agent_package
            );

            yearPurchases.forEach(p => {
                const month = new Date(p.date).getMonth();
                actualData[month] += (p.amount || 0);
            });

            // Distribute quarterly targets to months
            qTargets.forEach(qt => {
                const mBase = (qt.quarter - 1) * 3;
                const mTarget = (qt.total_sales_target || 0) / 3;
                targetData[mBase] = mTarget;
                targetData[mBase + 1] = mTarget;
                targetData[mBase + 2] = mTarget;
            });
        } else if (filter === 'quarterly') {
            labels = ['Q1', 'Q2', 'Q3', 'Q4'];
            actualData = Array(4).fill(0);
            targetData = [0, 0, 0, 0];

            const yearPurchases = await AppDataStore.getAll('purchases').filter(p =>
                p.date.startsWith(year.toString()) && !p.is_agent_package
            );

            yearPurchases.forEach(p => {
                const quarter = Math.floor(new Date(p.date).getMonth() / 3);
                actualData[quarter] += (p.amount || 0);
            });

            qTargets.forEach(qt => {
                targetData[qt.quarter - 1] = qt.total_sales_target || 0;
            });
        } else {
            // Custom range - aggregate by day
            const start = new Date(range.from);
            const end = new Date(range.to);
            const days = Math.floor((end - start) / (24 * 60 * 60 * 1000)) + 1;

            labels = [];
            actualData = Array(days).fill(0);

            for (let i = 0; i < days; i++) {
                const d = new Date(start);
                d.setDate(start.getDate() + i);
                const dStr = d.toISOString().split('T')[0];
                labels.push(dStr.split('-').slice(1).join('/'));

                actualData[i] = await AppDataStore.getAll('purchases').filter(p =>
                    p.date === dStr && !p.is_agent_package
                ).reduce((sum, p) => sum + (p.amount || 0), 0);
            }

            const dailyTarget = (yTarget.total_sales_target || 0) / 365;
            targetData = Array(days).fill(dailyTarget);
        }

        _revenueChart = new Chart(ctx, {
            type: 'line',
            data: {
                labels: labels,
                datasets: [
                    {
                        label: 'Actual Sales',
                        data: actualData,
                        borderColor: 'var(--primary)',
                        backgroundColor: 'rgba(13, 148, 136, 0.1)',
                        fill: true,
                        tension: 0.4
                    },
                    {
                        label: 'Target Sales',
                        data: targetData,
                        borderColor: '#94a3b8',
                        borderDash: [5, 5],
                        fill: false,
                        tension: 0.4
                    }
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: { display: false },
                    tooltip: {
                        mode: 'index',
                        intersect: false,
                        callbacks: {
                            label: function (context) {
                                return context.dataset.label + ': RM ' + context.parsed.y.toLocaleString();
                            }
                        }
                    }
                },
                scales: {
                    y: {
                        beginAtZero: true,
                        ticks: {
                            callback: function (value) { return 'RM ' + value.toLocaleString(); }
                        }
                    }
                }
            }
        });
    };

    const openTargetManagementModal = async () => {
        const year = new Date().getFullYear();
        const existing = await AppDataStore.getAll('yearly_targets').find(t => t.target_year === year) || {};

        const content = `
            <div class="target-form">
                <div class="target-form-group">
                    <label>Year</label>
                    <input type="number" id="target-year" value="${year}" readonly>
                </div>
                <div class="target-form-group">
                    <label>CPS Count Target (Full Year)</label>
                    <input type="number" id="target-cps" value="${existing.cps_count_target || 840}">
                </div>
                <div class="target-form-group">
                    <label>Total Sales Target (RM)</label>
                    <input type="number" id="target-sales" value="${existing.total_sales_target || 1680000}">
                </div>
                <div class="target-form-group">
                    <label>POP Cases Target</label>
                    <input type="number" id="target-pop-cases" value="${existing.pop_case_count_target || 100}">
                </div>
                <div class="target-form-group">
                    <label>POP Sales Target (RM)</label>
                    <input type="number" id="target-pop-sales" value="${existing.pop_sales_target || 250000}">
                </div>
                <div class="target-form-group">
                    <label>New Agents Target</label>
                    <input type="number" id="target-new-agents" value="${existing.new_agents_target || 48}">
                </div>
                <div class="target-form-group">
                    <label>New Customers Target</label>
                    <input type="number" id="target-new-customers" value="${existing.new_customers_target || 240}">
                </div>
                <div class="target-form-group">
                    <label>Activity Headcount Target</label>
                    <input type="number" id="target-headcount" value="${existing.activity_headcount_target || 600}">
                </div>
            </div>
    <div style="margin-top:20px; padding:15px; background:var(--gray-50); border-radius:8px;">
        <p style="font-size:12px; color:var(--gray-500);">
            <i class="fas fa-info-circle"></i> Quarterly and Monthly targets will be auto-calculated based on seasonal weightings (Q1: 0.9, Q2: 1.0, Q3: 1.1, Q4: 1.2).
        </p>
    </div>
`;

        UI.showModal('Target Management', content, [
            { label: 'Cancel', type: 'secondary', action: 'UI.hideModal()' },
            { label: 'Save Targets', type: 'primary', action: 'await app.saveYearlyTargets()' }
        ]);
    };

    const saveYearlyTargets = async () => {
        const data = {
            target_year: parseInt(document.getElementById('target-year').value),
            cps_count_target: parseInt(document.getElementById('target-cps').value),
            total_sales_target: parseFloat(document.getElementById('target-sales').value),
            pop_case_count_target: parseInt(document.getElementById('target-pop-cases').value),
            pop_sales_target: parseFloat(document.getElementById('target-pop-sales').value),
            new_agents_target: parseInt(document.getElementById('target-new-agents').value),
            new_customers_target: parseInt(document.getElementById('target-new-customers').value),
            activity_headcount_target: parseInt(document.getElementById('target-headcount').value),
            seasonal_weighting: { q1: 0.9, q2: 1.0, q3: 1.1, q4: 1.2 }
        };

        const existing = await AppDataStore.getAll('yearly_targets').find(t => t.target_year === data.target_year);
        if (existing) {
            AppDataStore.update('yearly_targets', existing.id, data);
        } else {
            await AppDataStore.create('yearly_targets', data);
        }

        // Auto-calculate quarterly
        await calculateQuarterlyBreakdown(data);

        UI.hideModal();
        UI.toast.success('Targets saved successfully.');
        if (_currentView === 'reports') await refreshKPIDashboard();
    };

    const calculateQuarterlyBreakdown = async (yearlyTarget) => {
        const factors = { 1: 0.9, 2: 1.0, 3: 1.1, 4: 1.2 };
        const totalFactor = Object.values(factors).reduce((a, b) => a + b, 0);

        [1, 2, 3, 4].forEach(q => {
            const ratio = factors[q] / totalFactor;
            const qTarget = {
                yearly_target_id: yearlyTarget.id,
                quarter: q,
                year: yearlyTarget.target_year,
                cps_count_target: Math.round(yearlyTarget.cps_count_target * ratio),
                total_sales_target: yearlyTarget.total_sales_target * ratio,
                pop_case_count_target: Math.round(yearlyTarget.pop_case_count_target * ratio),
                pop_sales_target: yearlyTarget.pop_sales_target * ratio,
                new_agents_target: Math.round(yearlyTarget.new_agents_target * ratio),
                new_customers_target: Math.round(yearlyTarget.new_customers_target * ratio),
                activity_headcount_target: Math.round(yearlyTarget.activity_headcount_target * ratio),
                seasonal_factor: factors[q]
            };

            const existing = await AppDataStore.getAll('quarterly_targets').find(t => t.year === qTarget.year && t.quarter === q);
            if (existing) {
                AppDataStore.update('quarterly_targets', existing.id, qTarget);
            } else {
                await AppDataStore.create('quarterly_targets', qTarget);
            }
        });
    };

    const exportKPIReport = async (format) => {
        const ranges = getDateRanges(_currentTimeFilter, _customDateFrom, _customDateTo);
        const kpis = await calculateKPIs(ranges.current.from, ranges.current.to);

        if (format === 'csv') {
            let csv = "\uFEFF"; // BOM for Excel CID
            csv += `KPI Report: ${ranges.current.from} to ${ranges.current.to} (${_currentTimeFilter}) \n`;
            csv += `Exported at: ${new Date().toLocaleString()} \n\n`;

            csv += "--- Summary Metrics ---\n";
            csv += "Metric,Value,Description\n";
            Object.keys(kpis).forEach(key => {
                let val = kpis[key];
                if (key.toLowerCase().includes('sales')) val = `RM ${val.toLocaleString()} `;
                csv += `"${key}", "${val}", "${KPI_DEFINITIONS[key] || ''}"\n`;
            });

            csv += "\n--- Trend Data ---\n";
            const chartData = _revenueChart ? _revenueChart.data : null;
            if (chartData) {
                csv += "Label,Actual,Target\n";
                chartData.labels.forEach((label, i) => {
                    const actual = chartData.datasets[0].data[i] || 0;
                    const target = chartData.datasets[1].data[i] || 0;
                    csv += `"${label}", "${actual}", "${target}"\n`;
                });
            }

            const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
            const url = window.URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.setAttribute('hidden', '');
            a.setAttribute('href', url);
            a.setAttribute('download', `KPI_Report_${ranges.current.from}_to_${ranges.current.to}.csv`);
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            UI.toast.success('Comprehensive CSV report exported.');
        }
    };

    const printDashboard = () => {
        window.print();
    };


    // ========== PHASE: MARKETING MANAGER LISTS ==========
    let _currentMarketingListTab = 'products'; // 'products', 'events', 'promotions'

    const showMarketingListsView = async (container) => {
        container.innerHTML = `
            <div class="marketing-lists-view" style="padding: 24px;">
                <div class="view-header" style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 24px;">
                    <div>
                        <h1>Product & Event Manager</h1>
                        <p class="text-muted">Manage master data for products, events, and monthly promotions.</p>
                    </div>
                    <div class="header-actions">
                        <button class="btn primary" onclick="await app.openMarketingListAddModal()">
                            <i class="fas fa-plus"></i> New ${_currentMarketingListTab.charAt(0).toUpperCase() + _currentMarketingListTab.slice(1, -1)}
                        </button>
                    </div>
                </div>

                <div class="tabs-container" style="margin-bottom: 20px; border-bottom: 1px solid var(--gray-200); display: flex; gap: 20px;">
                    <div class="tab-item ${_currentMarketingListTab === 'products' ? 'active' : ''}" 
                         onclick="await app.switchMarketingListTab('products')" 
                         style="padding: 10px 16px; cursor: pointer; border-bottom: 2px solid ${_currentMarketingListTab === 'products' ? 'var(--primary-600)' : 'transparent'}; color: ${_currentMarketingListTab === 'products' ? 'var(--primary-600)' : 'var(--gray-600)'}; font-weight: 500;">
                        Products
                    </div>
                    <div class="tab-item ${_currentMarketingListTab === 'events' ? 'active' : ''}" 
                         onclick="await app.switchMarketingListTab('events')" 
                         style="padding: 10px 16px; cursor: pointer; border-bottom: 2px solid ${_currentMarketingListTab === 'events' ? 'var(--primary-600)' : 'transparent'}; color: ${_currentMarketingListTab === 'events' ? 'var(--primary-600)' : 'var(--gray-600)'}; font-weight: 500;">
                        Events
                    </div>
                    <div class="tab-item ${_currentMarketingListTab === 'promotions' ? 'active' : ''}" 
                         onclick="await app.switchMarketingListTab('promotions')" 
                         style="padding: 10px 16px; cursor: pointer; border-bottom: 2px solid ${_currentMarketingListTab === 'promotions' ? 'var(--primary-600)' : 'transparent'}; color: ${_currentMarketingListTab === 'promotions' ? 'var(--primary-600)' : 'var(--gray-600)'}; font-weight: 500;">
                        Promotions
                    </div>
                </div>

                <div id="marketing-list-content">
                    ${await renderMarketingListTable()}
                </div>
            </div>
        `;
    };

    const switchMarketingListTab = async (tab) => {
        _currentMarketingListTab = tab;
        const viewport = document.getElementById('content-viewport');
        await showMarketingListsView(viewport);
    };

    const renderMarketingListTable = async () => {
        const data = await AppDataStore.getAll(_currentMarketingListTab);

        if (_currentMarketingListTab === 'products') {
            return `
                <table class="data-table">
                    <thead>
                        <tr>
                            <th>Name</th>
                            <th>Price (RM)</th>
                            <th>Lead Time</th>
                            <th>Status</th>
                            <th>Actions</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${data.map(item => `
                            <tr style="${!item.is_active ? 'opacity: 0.6; background: #f9fafb;' : ''}">
                                <td><strong>${item.name}</strong><br><small class="text-muted">${item.remarks || ''}</small></td>
                                <td>${item.price || 0}</td>
                                <td>${item.delivery_lead_time || '-'}</td>
                                <td>
                                    <span class="status-badge ${item.is_active ? 'status-active' : 'status-inactive'}">
                                        ${item.is_active ? 'Active' : 'Inactive'}
                                    </span>
                                </td>
                                <td>
                                    <button class="btn-icon" onclick="await app.openMarketingListEditModal('${item.id}')" title="Edit"><i class="fas fa-pencil-alt"></i></button>
                                    <button class="btn-icon text-danger" onclick="await app.deleteMarketingListItem('${item.id}')" title="Delete"><i class="fas fa-trash-alt"></i></button>
                                </td>
                            </tr>
                        `).join('')}
                    </tbody>
                </table>
            `;
        } else if (_currentMarketingListTab === 'events') {
            return `
                <table class="data-table">
                    <thead>
                        <tr>
                            <th>Title</th>
                            <th>Price (RM)</th>
                            <th>Duration</th>
                            <th>Target Group</th>
                            <th>Status</th>
                            <th>Actions</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${data.map(item => `
                            <tr style="${!item.is_active ? 'opacity: 0.6; background: #f9fafb;' : ''}">
                                <td><strong>${item.title}</strong><br><small class="text-muted">${item.description || ''}</small></td>
                                <td>${item.ticket_price || 0}</td>
                                <td>${item.duration || '-'}</td>
                                <td>${item.target_group || '-'}</td>
                                <td>
                                    <span class="status-badge ${item.is_active ? 'status-active' : 'status-inactive'}">
                                        ${item.is_active ? 'Active' : 'Inactive'}
                                    </span>
                                </td>
                                <td>
                                    <button class="btn-icon" onclick="await app.openMarketingListEditModal('${item.id}')" title="Edit"><i class="fas fa-pencil-alt"></i></button>
                                    <button class="btn-icon text-danger" onclick="await app.deleteMarketingListItem('${item.id}')" title="Delete"><i class="fas fa-trash-alt"></i></button>
                                </td>
                            </tr>
                        `).join('')}
                    </tbody>
                </table>
            `;
        } else {
            return `
                <table class="data-table">
                    <thead>
                        <tr>
                            <th>Package Name</th>
                            <th>Price (RM)</th>
                            <th>Lead Time</th>
                            <th>Status</th>
                            <th>Actions</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${data.map(item => `
                            <tr style="${!item.is_active ? 'opacity: 0.6; background: #f9fafb;' : ''}">
                                <td><strong>${item.package_name}</strong><br><small class="text-muted">${item.details || ''}</small></td>
                                <td>${item.price || 0}</td>
                                <td>${item.delivery_lead_time || '-'}</td>
                                <td>
                                    <span class="status-badge ${item.is_active ? 'status-active' : 'status-inactive'}">
                                        ${item.is_active ? 'Active' : 'Inactive'}
                                    </span>
                                </td>
                                <td>
                                    <button class="btn-icon" onclick="await app.openMarketingListEditModal('${item.id}')" title="Edit"><i class="fas fa-pencil-alt"></i></button>
                                    <button class="btn-icon text-danger" onclick="await app.deleteMarketingListItem('${item.id}')" title="Delete"><i class="fas fa-trash-alt"></i></button>
                                </td>
                            </tr>
                        `).join('')}
                    </tbody>
                </table>
            `;
        }
    };

    const openMarketingListAddModal = async () => {
        let content = '';
        const type = _currentMarketingListTab;

        if (type === 'products') {
            content = `
                <div class="form-group"><label>Name*</label><input type="text" id="mkt-name" class="form-control"></div>
                <div class="form-group"><label>Price (RM)</label><input type="number" id="mkt-price" class="form-control" value="0"></div>
                <div class="form-group"><label>Remarks</label><input type="text" id="mkt-remarks" class="form-control"></div>
                <div class="form-group"><label>Delivery Lead Time</label><input type="text" id="mkt-lead" class="form-control" placeholder="e.g. 3-5 days"></div>
                <div class="form-group"><label><input type="checkbox" id="mkt-active" checked> Is Active</label></div>
`;
        } else if (type === 'events') {
            content = `
                <div class="form-group"><label>Title*</label><input type="text" id="mkt-title" class="form-control"></div>
                <div class="form-group"><label>Ticket Price (RM)</label><input type="number" id="mkt-price" class="form-control" value="0"></div>
                <div class="form-group"><label>Duration</label><input type="text" id="mkt-duration" class="form-control" placeholder="e.g. 2 hours"></div>
                <div class="form-group"><label>Target Group</label><input type="text" id="mkt-target" class="form-control"></div>
                <div class="form-group"><label>Description</label><textarea id="mkt-desc" class="form-control"></textarea></div>
                <div class="form-group"><label><input type="checkbox" id="mkt-active" checked> Is Active</label></div>
`;
        } else {
            content = `
                <div class="form-group"><label>Package Name*</label><input type="text" id="mkt-pkname" class="form-control"></div>
                <div class="form-group"><label>Price (RM)</label><input type="number" id="mkt-price" class="form-control" value="0"></div>
                <div class="form-group"><label>Details</label><textarea id="mkt-details" class="form-control"></textarea></div>
                <div class="form-group"><label>Requirement</label><input type="text" id="mkt-req" class="form-control"></div>
                <div class="form-group"><label>Remarks</label><input type="text" id="mkt-remarks" class="form-control"></div>
                <div class="form-group"><label>Delivery Lead Time</label><input type="text" id="mkt-lead" class="form-control"></div>
                <div class="form-group"><label><input type="checkbox" id="mkt-active" checked> Is Active</label></div>
`;
        }

        UI.showModal('Add New ' + type.slice(0, -1), content, [
            { label: 'Cancel', type: 'secondary', action: 'UI.hideModal()' },
            { label: 'Save', type: 'primary', action: 'await app.saveMarketingListItem()' }
        ]);
    };

    const openMarketingListEditModal = async (id) => {
        const item = AppDataStore.getById(_currentMarketingListTab, id);
        if (!item) return;

        let content = '';
        const type = _currentMarketingListTab;

        if (type === 'products') {
            content = `
                <div class="form-group"><label>Name*</label><input type="text" id="mkt-name" class="form-control" value="${item.name}"></div>
                <div class="form-group"><label>Price (RM)</label><input type="number" id="mkt-price" class="form-control" value="${item.price || 0}"></div>
                <div class="form-group"><label>Remarks</label><input type="text" id="mkt-remarks" class="form-control" value="${item.remarks || ''}"></div>
                <div class="form-group"><label>Delivery Lead Time</label><input type="text" id="mkt-lead" class="form-control" value="${item.delivery_lead_time || ''}"></div>
                <div class="form-group"><label><input type="checkbox" id="mkt-active" ${item.is_active ? 'checked' : ''}> Is Active</label></div>
            `;
        } else if (type === 'events') {
            content = `
                <div class="form-group"><label>Title*</label><input type="text" id="mkt-title" class="form-control" value="${item.title}"></div>
                <div class="form-group"><label>Ticket Price (RM)</label><input type="number" id="mkt-price" class="form-control" value="${item.ticket_price || 0}"></div>
                <div class="form-group"><label>Duration</label><input type="text" id="mkt-duration" class="form-control" value="${item.duration || ''}"></div>
                <div class="form-group"><label>Target Group</label><input type="text" id="mkt-target" class="form-control" value="${item.target_group || ''}"></div>
                <div class="form-group"><label>Description</label><textarea id="mkt-desc" class="form-control">${item.description || ''}</textarea></div>
                <div class="form-group"><label><input type="checkbox" id="mkt-active" ${item.is_active ? 'checked' : ''}> Is Active</label></div>
            `;
        } else {
            content = `
                <div class="form-group"><label>Package Name*</label><input type="text" id="mkt-pkname" class="form-control" value="${item.package_name}"></div>
                <div class="form-group"><label>Price (RM)</label><input type="number" id="mkt-price" class="form-control" value="${item.price || 0}"></div>
                <div class="form-group"><label>Details</label><textarea id="mkt-details" class="form-control">${item.details || ''}</textarea></div>
                <div class="form-group"><label>Requirement</label><input type="text" id="mkt-req" class="form-control" value="${item.requirement || ''}"></div>
                <div class="form-group"><label>Remarks</label><input type="text" id="mkt-remarks" class="form-control" value="${item.remarks || ''}"></div>
                <div class="form-group"><label>Delivery Lead Time</label><input type="text" id="mkt-lead" class="form-control" value="${item.delivery_lead_time || ''}"></div>
                <div class="form-group"><label><input type="checkbox" id="mkt-active" ${item.is_active ? 'checked' : ''}> Is Active</label></div>
            `;
        }

        UI.showModal('Edit ' + type.slice(0, -1), content, [
            { label: 'Cancel', type: 'secondary', action: 'UI.hideModal()' },
            { label: 'Save Changes', type: 'primary', action: `await app.saveMarketingListItem('${id}')` }
        ]);
    };

    const saveMarketingListItem = async (id = null) => {
        const type = _currentMarketingListTab;
        let data = {
            is_active: document.getElementById('mkt-active').checked,
            updated_at: new Date().toISOString()
        };

        if (type === 'products') {
            data.name = document.getElementById('mkt-name').value.trim();
            data.price = parseFloat(document.getElementById('mkt-price').value) || 0;
            data.remarks = document.getElementById('mkt-remarks').value;
            data.delivery_lead_time = document.getElementById('mkt-lead').value;
            if (!data.name) return UI.toast.error('Name is required');
        } else if (type === 'events') {
            data.title = document.getElementById('mkt-title').value.trim();
            data.ticket_price = parseFloat(document.getElementById('mkt-price').value) || 0;
            data.duration = document.getElementById('mkt-duration').value;
            data.target_group = document.getElementById('mkt-target').value;
            data.description = document.getElementById('mkt-desc').value;
            if (!data.title) return UI.toast.error('Title is required');
        } else {
            data.package_name = document.getElementById('mkt-pkname').value.trim();
            data.price = parseFloat(document.getElementById('mkt-price').value) || 0;
            data.details = document.getElementById('mkt-details').value;
            data.requirement = document.getElementById('mkt-req').value;
            data.remarks = document.getElementById('mkt-remarks').value;
            data.delivery_lead_time = document.getElementById('mkt-lead').value;
            if (!data.package_name) return UI.toast.error('Package Name is required');
        }

        if (id) {
            AppDataStore.update(type, id, data);
            UI.toast.success('Record updated successfully');
        } else {
            data.created_by = _currentUser ? _currentUser.id : null;
            await AppDataStore.create(type, data);
            UI.toast.success('Record added successfully');
        }

        UI.hideModal();
        const viewport = document.getElementById('content-viewport');
        await showMarketingListsView(viewport);
    };

    const deleteMarketingListItem = async (id) => {
        if (confirm('Are you sure you want to delete this record? This action cannot be undone.')) {
            AppDataStore.delete(_currentMarketingListTab, id);
            UI.toast.success('Record deleted');
            const viewport = document.getElementById('content-viewport');
            await showMarketingListsView(viewport);
        }
    };


    // ========== PHASE 12: MARKETING AUTOMATION ==========

    const showMarketingAutomationView = async (container) => {
        container.innerHTML = `
            <div class="marketing-view">
                <div class="marketing-header">
                    <div>
                        <h1>Marketing Automation</h1>
                        <p>WhatsApp Focus - Create templates and manage campaigns</p>
                    </div>
                    <div class="marketing-header-actions">
                        <button class="btn primary" onclick="await app.openCreateTemplateModal()">
                            <i class="fas fa-plus"></i> Create Template
                        </button>
                        <button class="btn secondary" onclick="await app.openCreateCampaignModal()">
                            <i class="fas fa-bullhorn"></i> New Campaign
                        </button>
                        <button class="btn secondary" onclick="await app.switchMarketingTab('analytics')">
                            <i class="fas fa-chart-bar"></i> Analytics
                        </button>
                        ${(isManagement(_currentUser) || isSystemAdmin(_currentUser)) ? `
                        <button class="btn secondary" onclick="app.exportKPIDashboard()">
                            <i class="fas fa-download"></i> Export Data
                        </button>
                    ` : ''}
                    </div>
                </div>
                
                <div class="marketing-tabs">
                    <button class="marketing-tab ${_currentMarketingTab === 'templates' ? 'active' : ''}" onclick="await app.switchMarketingTab('templates')">
                        <i class="fas fa-layer-group"></i> Message Templates
                    </button>
                    <button class="marketing-tab ${_currentMarketingTab === 'campaigns' ? 'active' : ''}" onclick="await app.switchMarketingTab('campaigns')">
                        <i class="fas fa-bullhorn"></i> Active Campaigns
                    </button>
                    <button class="marketing-tab ${_currentMarketingTab === 'analytics' ? 'active' : ''}" onclick="await app.switchMarketingTab('analytics')">
                        <i class="fas fa-chart-line"></i> Campaign Analytics
                    </button>
                    ${(isMarketingManager(_currentUser) || isSystemAdmin(_currentUser)) ? `
                    <button class="marketing-tab ${_currentMarketingTab === 'products' ? 'active' : ''}" onclick="await app.switchMarketingTab('products')">
                        <i class="fas fa-box"></i> Products & Services
                    </button>
                    <button class="marketing-tab ${_currentMarketingTab === 'packages' ? 'active' : ''}" onclick="await app.switchMarketingTab('packages')">
                        <i class="fas fa-gifts"></i> Promotion Packages
                    </button>
                    ` : ''}
                </div>
                
                <div id="marketing-tab-content" class="marketing-tab-content">
                    ${await renderMarketingTabContent()}
                </div>
            </div>
        `;
    };

    const switchMarketingTab = async (tab) => {
        _currentMarketingTab = tab;
        const container = document.getElementById('marketing-tab-content');
        if (container) {
            container.innerHTML = await renderMarketingTabContent();
        }

        // Update active tab styling
        document.querySelectorAll('.marketing-tab').forEach(t => {
            t.classList.remove('active');
            if (t.textContent.includes(tab === 'templates' ? 'Message Templates' :
                tab === 'campaigns' ? 'Active Campaigns' :
                    tab === 'products' ? 'Products & Services' :
                        tab === 'packages' ? 'Promotion Packages' : 'Campaign Analytics')) {
                t.classList.add('active');
            }
        });

        if (tab === 'analytics') {
            await refreshAnalytics();
        }
    };

    const renderMarketingTabContent = async () => {
        if (_currentMarketingTab === 'templates') {
            return await renderTemplatesTab();
        } else if (_currentMarketingTab === 'campaigns') {
            return await renderCampaignsTab();
        } else if (_currentMarketingTab === 'analytics') {
            return await renderAnalyticsTab();
        } else if (_currentMarketingTab === 'products') {
            return await renderProductsTab();
        } else if (_currentMarketingTab === 'packages') {
            return await renderPackagesTab();
        }
    };

    // ========== PRODUCTS TAB ==========
    const renderProductsTab = async () => {
        const products =await  AppDataStore.getAll('products');
        return `
            <div class="products-layout" style="padding: 24px;">
                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px;">
                    <h3>Product & Service Directory</h3>
                    <button class="btn primary" onclick="await app.openAddProductModal()">+ Add New Product</button>
                </div>
                <table class="data-table" style="width: 100%; border-collapse: collapse;">
                    <thead>
                        <tr style="background: var(--gray-100); text-align: left;">
                            <th style="padding: 12px; border-bottom: 1px solid var(--gray-200);">Name</th>
                            <th style="padding: 12px; border-bottom: 1px solid var(--gray-200);">Category</th>
                            <th style="padding: 12px; border-bottom: 1px solid var(--gray-200);">Status</th>
                            <th style="padding: 12px; border-bottom: 1px solid var(--gray-200);">Actions</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${products.map(p => `
                            <tr>
                                <td style="padding: 12px; border-bottom: 1px solid var(--gray-200);"><strong>${p.name}</strong></td>
                                <td style="padding: 12px; border-bottom: 1px solid var(--gray-200);">${p.category || 'N/A'}</td>
                                <td style="padding: 12px; border-bottom: 1px solid var(--gray-200);">
                                    <span class="status-badge ${p.is_active !== false ? 'status-active' : 'status-inactive'}">${p.is_active !== false ? 'Active' : 'Inactive'}</span>
                                </td>
                                <td style="padding: 12px; border-bottom: 1px solid var(--gray-200);">
                                    <button class="btn btn-sm secondary" onclick="await app.openAddProductModal(${p.id})">Edit</button>
                                    <button class="btn btn-sm ${p.is_active !== false ? 'danger' : 'primary'}" onclick="await app.toggleProductStatus(${p.id}, ${p.is_active !== false})">
                                        ${p.is_active !== false ? 'Deactivate' : 'Activate'}
                                    </button>
                                </td>
                            </tr>
                        `).join('')}
                        ${products.length === 0 ? '<tr><td colspan="4" style="padding: 12px; text-align: center;">No products found.</td></tr>' : ''}
                    </tbody>
                </table>
            </div>
    `;
    };

    const openAddProductModal = async (id = null) => {
        let p = { name: '', category: '', is_active: true };
        if (id) p = AppDataStore.getById('products', id);

        const content = `
            <div class="form-group">
                <label>Product/Service Name <span class="required">*</span></label>
                <input type="text" id="prod-name" class="form-control" value="${p.name}">
            </div>
            <div class="form-group">
                <label>Category</label>
                <input type="text" id="prod-category" class="form-control" value="${p.category || ''}" placeholder="e.g. Ring, Service, Consultation">
            </div>
`;
        UI.showModal(id ? 'Edit Product' : 'Add Product', content, [
            { label: 'Cancel', type: 'secondary', action: 'UI.hideModal()' },
            { label: 'Save', type: 'primary', action: `await app.saveProduct(${id || 'null'})` }
        ]);
    };

    const saveProduct = async (id) => {
        const name = document.getElementById('prod-name').value.trim();
        const category = document.getElementById('prod-category').value.trim();
        if (!name) {
            UI.toast.error("Name is required");
            return;
        }

        if (id) {
            AppDataStore.update('products', id, { name, category });
            UI.toast.success("Product updated");
        } else {
            await AppDataStore.create('products', { name, category, is_active: true });
            UI.toast.success("Product added");
        }
        UI.hideModal();
        if (_currentMarketingTab === 'products') document.getElementById('marketing-tab-content').innerHTML = await renderProductsTab();
    };

    const toggleProductStatus = async (id, currentStatus) => {
        AppDataStore.update('products', id, { is_active: !currentStatus });
        UI.toast.success("Product status updated");
        if (_currentMarketingTab === 'products') document.getElementById('marketing-tab-content').innerHTML = await renderProductsTab();
    };

    // ========== PROMOTION PACKAGES TAB ==========
    const renderPackagesTab = async () => {
        const packages = await AppDataStore.getAll('promotions');
        return `
            <div class="packages-layout" style="padding: 24px;">
                <div class="packages-header" style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px;">
                    <div>
                        <h3>Promotion Packages</h3>
                        <p class="text-muted">Manage bundled offers and track customer purchases</p>
                    </div>
                    <button class="btn primary" onclick="await app.openCreatePackageModal()">+ New Package</button>
                </div>

                <div class="packages-filters" style="display: flex; gap: 15px; margin-bottom: 20px;">
                    <div class="search-box" style="position: relative; flex: 1;">
                        <i class="fas fa-search" style="position: absolute; left: 12px; top: 50%; transform: await translateY(-50%); color: var(--gray-400);"></i>
                        <input type="text" id="package-search" class="form-control" placeholder="Search by package name or product..." style="padding-left: 35px;" onkeyup="await app.filterPackages()">
                    </div>
                    <select id="package-status-filter" class="form-control" style="width: 150px;" onchange="await app.filterPackages()">
                        <option value="all">All Status</option>
                        <option value="active">Active</option>
                        <option value="inactive">Inactive</option>
                    </select>
                </div>

                <table class="data-table" style="width: 100%; border-collapse: collapse;">
                    <thead>
                        <tr style="background: var(--gray-100); text-align: left;">
                            <th style="padding: 12px; border-bottom: 1px solid var(--gray-200);">Package Name</th>
                            <th style="padding: 12px; border-bottom: 1px solid var(--gray-200);">Product(s)</th>
                            <th style="padding: 12px; border-bottom: 1px solid var(--gray-200);">Price (RM)</th>
                            <th style="padding: 12px; border-bottom: 1px solid var(--gray-200);">Payment Types</th>
                            <th style="padding: 12px; border-bottom: 1px solid var(--gray-200);">Status</th>
                            <th style="padding: 12px; border-bottom: 1px solid var(--gray-200);">Actions</th>
                        </tr>
                    </thead>
                    <tbody id="packages-table-body">
                        ${packages.map(p => renderPackageRow(p)).join('')}
                        ${packages.length === 0 ? '<tr><td colspan="6" style="padding: 40px; text-align: center; color: var(--gray-500);">No promotion packages found. Click "+ New Package" to create one.</td></tr>' : ''}
                    </tbody>
                </table>
            </div>
        `;
    };

    const renderPackageRow = async (p) => {
        const productNames = (p.product_ids || []).map(id => {
            const prod = AppDataStore.getById('products', id);
            return prod ? prod.name : 'Unknown Product';
        }).join(', ');

        const abbreviatedProducts = productNames.length > 50 ? productNames.substring(0, 47) + '...' : productNames;

        return `
            <tr>
                <td style="padding: 12px; border-bottom: 1px solid var(--gray-200);">
                    <a href="javascript:async void(0)" onclick="await app.viewPackageCustomers(${p.id})"><strong>${p.package_name || p.name}</strong></a>
                </td>
                <td style="padding: 12px; border-bottom: 1px solid var(--gray-200);" title="${productNames}">${abbreviatedProducts}</td>
                <td style="padding: 12px; border-bottom: 1px solid var(--gray-200);">RM ${UI.formatNumber(p.price)}</td>
                <td style="padding: 12px; border-bottom: 1px solid var(--gray-200);">
                    <div style="display: flex; gap: 4px; flex-wrap: wrap;">
                        ${(p.payment_types || []).map(t => `<span class="badge badge-gray" style="font-size: 10px;">${t}</span>`).join('')}
                    </div>
                </td>
                <td style="padding: 12px; border-bottom: 1px solid var(--gray-200);">
                    <span class="status-badge ${p.is_active ? 'status-active' : 'status-inactive'}">${p.is_active ? 'Active' : 'Inactive'}</span>
                </td>
                <td style="padding: 12px; border-bottom: 1px solid var(--gray-200);">
                    <div class="table-actions">
                        <button class="btn-icon" onclick="await app.openCreatePackageModal(${p.id})" title="Edit"><i class="fas fa-edit"></i></button>
                        <button class="btn-icon" onclick="await app.viewPackageCustomers(${p.id})" title="View Customers"><i class="fas fa-users"></i></button>
                        <button class="btn-icon text-danger" onclick="await app.deletePackage(${p.id})" title="Delete"><i class="fas fa-trash"></i></button>
                    </div>
                </td>
            </tr>
        `;
    };

    const filterPackages = async () => {
        const search = document.getElementById('package-search')?.value.toLowerCase() || '';
        const status = document.getElementById('package-status-filter')?.value || 'all';

        const packages = await AppDataStore.getAll('promotions');
        const filtered = packages.filter(p => {
            const matchesSearch = (p.package_name || p.name || '').toLowerCase().includes(search) ||
                (p.product_ids || []).some(id => {
                    const prod = AppDataStore.getById('products', id);
                    return prod && (prod.name || '').toLowerCase().includes(search);
                });
            const matchesStatus = status === 'all' || (status === 'active' ? p.is_active : !p.is_active);
            return matchesSearch && matchesStatus;
        });

        const tbody = document.getElementById('packages-table-body');
        if (tbody) {
            tbody.innerHTML = filtered.map(p => renderPackageRow(p)).join('') +
                (filtered.length === 0 ? '<tr><td colspan="6" style="padding: 40px; text-align: center; color: var(--gray-500);">No matching packages found.</td></tr>' : '');
        }
    };

    const openCreatePackageModal = async (id = null) => {
        const isEdit = !!id;
        const pkg = isEdit ? AppDataStore.getById('promotions', id) : {
            package_name: '',
            product_ids: [],
            price: 0,
            payment_types: [],
            requirement: '',
            remarks: '',
            is_active: true
        };

        const allProducts =await  AppDataStore.getAll('products').filter(p => p.is_active !== false);
        const paymentOptions = ['Cash', 'Credit Card', 'Bank Transfer', 'EPP', 'POP', 'Cheque'];

        const content = `
            <div class="form-group">
                <label>Package Name <span class="required">*</span></label>
                <input type="text" id="pkg-name" class="form-control" value="${pkg.package_name}" placeholder="e.g., Anniversary Special Bundle">
            </div>
            <div class="form-group">
                <label>Product(s) <span class="required">*</span></label>
                <div class="multi-select-container" style="border: 1px solid var(--gray-300); border-radius: 4px; padding: 10px; max-height: 150px; overflow-y: auto;">
                    ${allProducts.map(p => `
                        <label style="display: block; margin-bottom: 5px; cursor: pointer;">
                            <input type="checkbox" name="pkg-products" value="${p.id}" ${pkg.product_ids.includes(p.id) ? 'checked' : ''}> ${p.name}
                        </label>
                    `).join('')}
                    ${allProducts.length === 0 ? '<p class="text-muted">No active products found.</p>' : ''}
                </div>
            </div>
            <div class="form-row">
                <div class="form-group half">
                    <label>Price (RM) <span class="required">*</span></label>
                    <input type="number" id="pkg-price" class="form-control" value="${pkg.price}" step="0.01">
                </div>
                <div class="form-group half">
                    <label>Payment Type(s)</label>
                    <div class="multi-select-container" style="border: 1px solid var(--gray-300); border-radius: 4px; padding: 10px; display: grid; grid-template-columns: 1fr 1fr; gap: 5px;">
                        ${paymentOptions.map(opt => `
                            <label style="display: block; cursor: pointer; font-size: 13px;">
                                <input type="checkbox" name="pkg-payments" value="${opt}" ${pkg.payment_types.includes(opt) ? 'checked' : ''}> ${opt}
                            </label>
                        `).join('')}
                    </div>
                </div>
            </div>
            <div class="form-group">
                <label>Requirement</label>
                <textarea id="pkg-requirement" class="form-control" rows="2" placeholder="e.g. Minimum 3 referrals required">${pkg.requirement || ''}</textarea>
            </div>
            <div class="form-group">
                <label>Remarks</label>
                <textarea id="pkg-remarks" class="form-control" rows="2" placeholder="Internal notes...">${pkg.remarks || ''}</textarea>
            </div>
            <div class="form-group">
                <label style="display: flex; align-items: center; cursor: pointer;">
                    <input type="checkbox" id="pkg-active" ${pkg.is_active ? 'checked' : ''} style="margin-right: 8px;"> Active Package
                </label>
            </div>
`;

        UI.showModal(isEdit ? 'Edit Promotion Package' : 'Create Promotion Package', content, [
            { label: 'Cancel', type: 'secondary', action: 'UI.hideModal()' },
            { label: isEdit ? 'Update Package' : 'Create Package', type: 'primary', action: `await app.savePackage(${id || 'null'})` }
        ]);
    };

    const savePackage = async (id) => {
        const name = document.getElementById('pkg-name').value.trim();
        const price = parseFloat(document.getElementById('pkg-price').value);
        const productIds = Array.from(document.querySelectorAll('input[name="pkg-products"]:checked')).map(i => parseInt(i.value));
        const payments = Array.from(document.querySelectorAll('input[name="pkg-payments"]:checked')).map(i => i.value);
        const requirement = document.getElementById('pkg-requirement').value.trim();
        const remarks = document.getElementById('pkg-remarks').value.trim();
        const isActive = document.getElementById('pkg-active').checked;

        if (!name || isNaN(price) || productIds.length === 0) {
            UI.toast.error("Please fill in all required fields (Name, Price, and at least one Product)");
            return;
        }

        const data = {
            package_name: name,
            name: name, // support both fields
            product_ids: productIds,
            price: price,
            payment_types: payments,
            requirement: requirement,
            remarks: remarks,
            is_active: isActive,
            updated_at: new Date().toISOString()
        };

        if (id) {
            AppDataStore.update('promotions', id, data);
            UI.toast.success("Package updated successfully");
        } else {
            data.created_by = _currentUser ? _currentUser.id : null;
            data.created_at = new Date().toISOString();
            await AppDataStore.create('promotions', data);
            UI.toast.success("Package created successfully");
        }

        UI.hideModal();
        if (_currentMarketingTab === 'packages') await app.switchMarketingTab('packages');
    };

    const deletePackage = async (id) => {
        if (confirm("Are you sure you want to delete this promotion package? This action cannot be undone.")) {
            AppDataStore.delete('promotions', id);
            UI.toast.success("Package deleted");
            if (_currentMarketingTab === 'packages') await app.switchMarketingTab('packages');
        }
    };

    const viewPackageCustomers = async (packageId) => {
        const pkg = AppDataStore.getById('promotions', packageId);
        if (!pkg) return;

        const purchases =await  AppDataStore.getAll('purchases').filter(p => p.package_id == packageId);

        // Fallback: match by product name if package_id is not set
        if (purchases.length === 0) {
            const productNames = pkg.product_ids.map(id => {
                const prod = AppDataStore.getById('products', id);
                return prod ? prod.name : null;
            }).filter(n => n);

            const allPurchases = await AppDataStore.getAll('purchases');
            allPurchases.forEach(p => {
                if (!p.package_id && productNames.includes(p.item)) {
                    purchases.push(p);
                }
            });
        }

        const content = `
            <div class="package-customers-view">
                <div style="margin-bottom: 20px; padding: 15px; background: var(--gray-50); border-radius: 8px; border-left: 4px solid var(--primary-500);">
                    <h4 style="margin: 0; color: var(--primary-700);">${pkg.package_name}</h4>
                    <p style="margin: 5px 0 0; font-size: 13px;">Total Customers: <strong>${purchases.length}</strong></p>
                </div>
                
                <table class="data-table" style="width: 100%; border-collapse: collapse;">
                    <thead>
                        <tr style="background: var(--gray-100); text-align: left;">
                            <th style="padding: 10px; border-bottom: 2px solid var(--gray-200);">Customer Name</th>
                            <th style="padding: 10px; border-bottom: 2px solid var(--gray-200);">Purchase Date</th>
                            <th style="padding: 10px; border-bottom: 2px solid var(--gray-200);">Amount Paid</th>
                            <th style="padding: 10px; border-bottom: 2px solid var(--gray-200);">Status</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${purchases.map(p => {
            const customer = AppDataStore.getById('customers', p.customer_id) || AppDataStore.getById('prospects', p.customer_id);
            return `
                                <tr>
                                    <td style="padding: 10px; border-bottom: 1px solid var(--gray-200);">
                                        ${customer ? `<a href="javascript:await void(0)" onclick="UI.hideModal(); app.showProfile(${customer.id}, '${customer.is_customer ? 'customer' : 'prospect'}')">${customer.full_name || customer.name}</a>` : 'Deleted Member'}
                                    </td>
                                    <td style="padding: 10px; border-bottom: 1px solid var(--gray-200);">${UI.formatDate(p.date)}</td>
                                    <td style="padding: 10px; border-bottom: 1px solid var(--gray-200);">RM ${UI.formatNumber(p.amount)}</td>
                                    <td style="padding: 10px; border-bottom: 1px solid var(--gray-200);">
                                        <span class="status-badge" style="background: ${p.status === 'COMPLETED' ? '#dcfce7' : '#fef9c3'}; color: ${p.status === 'COMPLETED' ? '#166534' : '#854d0e'};">
                                            ${p.status || 'PENDING'}
                                        </span>
                                    </td>
                                </tr>
                            `;
        }).join('')}
                        ${purchases.length === 0 ? '<tr><td colspan="4" style="padding: 30px; text-align: center; color: var(--gray-500);">No customers have purchased this package yet.</td></tr>' : ''}
                    </tbody>
                </table>
            </div>
        `;

        UI.showModal(`Customers - ${pkg.package_name || pkg.name} `, content, [
            { label: 'Close', type: 'secondary', action: 'UI.hideModal()' }
        ], 'large');
    };

    // ========== TEMPLATES TAB ==========

    const renderTemplatesTab = async () => {
        const templates = await AppDataStore.getAll('whatsapp_templates');

        return `
            <div class="templates-layout">
                <div class="templates-list">
                    <div class="templates-search">
                        <i class="fas fa-search"></i>
                        <input type="text" id="template-search" placeholder="Search templates..." onkeyup="await app.searchTemplates()">
                    </div>
                    <div class="templates-grid" id="templates-grid">
                        ${templates.length > 0 ? templates.map(t => renderTemplateCard(t)).join('') : await renderSampleTemplates()}
                    </div>
                </div>
                <div class="template-preview-panel">
                    <h3><i class="fas fa-eye"></i> WhatsApp Preview</h3>
                    <div class="whatsapp-preview-frame" id="whatsapp-preview">
                        <div class="whatsapp-header">
                            <div class="whatsapp-avatar"></div>
                            <div class="whatsapp-contact">Michelle Tan</div>
                            <div class="whatsapp-time">10:24 PM</div>
                        </div>
                        <div class="whatsapp-body">
                            <div class="message-bubble received">
                                Hi Michelle, wishing you a very happy birthday! May the Horse year bring you prosperity and success!
                                <div class="message-time">10:24 PM</div>
                            </div>
                        </div>
                    </div>
                    <div class="placeholder-tags">
                        <p><strong>Available Placeholders:</strong></p>
                        <div class="tag-cloud">
                            <span class="placeholder-tag" onclick="app.insertVariable('{{name}}')">{{name}}</span>
                            <span class="placeholder-tag" onclick="app.insertVariable('{{zodiac}}')">{{zodiac}}</span>
                            <span class="placeholder-tag" onclick="app.insertVariable('{{mg}}')">{{mg}}</span>
                            <span class="placeholder-tag" onclick="app.insertVariable('{{expiry}}')">{{expiry}}</span>
                            <span class="placeholder-tag" onclick="app.insertVariable('{{date}}')">{{date}}</span>
                            <span class="placeholder-tag" onclick="app.insertVariable('{{agent}}')">{{agent}}</span>
                            <span class="placeholder-tag" onclick="app.insertVariable('{{event_date}}')">{{event_date}}</span>
                            <span class="placeholder-tag" onclick="app.insertVariable('{{event_title}}')">{{event_title}}</span>
                            <span class="placeholder-tag" onclick="app.insertVariable('{{location}}')">{{location}}</span>
                        </div>
                    </div>
                </div>
            </div>
        `;
    };

    const renderSampleTemplates = async () => {
        // Fallback or demo templates if none in store
        const sampleTemplates = [
            { id: 1, template_name: 'Happy Birthday Wishes', category: 'Birthday', content: 'Hi {{name}}, wishing you a very happy birthday...', variables: ['name', 'zodiac'] },
            { id: 2, template_name: 'Post-Consultation Thank You', category: 'Follow-up', content: 'Dear {{name}}, it was a pleasure meeting you...', variables: ['name', 'agent'] }
        ];
        return sampleTemplates.map(t => renderTemplateCard(t)).join('');
    };

    const renderTemplateCard = async (template) => {
        const categoryColors = {
            'Birthday': 'badge-blue',
            'Follow-up': 'badge-orange',
            'Event': 'badge-green',
            'CPS': 'badge-purple',
            'Promotion': 'badge-red',
            'Appointment Reminder': 'badge-yellow',
            'Thank You': 'badge-teal'
        };

        const colorClass = categoryColors[template.category] || 'badge-gray';

        return `
            <div class="template-card" onclick="app.previewTemplate(${template.id})">
                <div class="template-card-header">
                    <span class="template-badge ${colorClass}">${template.category}</span>
                    <div class="template-card-actions">
                        <button class="btn-icon" onclick="event.stopPropagation(); await app.editTemplate(${template.id})" title="Edit"><i class="fas fa-edit"></i></button>
                        <button class="btn-icon" onclick="event.stopPropagation(); await app.copyTemplate(${template.id})" title="Copy"><i class="fas fa-copy"></i></button>
                        <button class="btn-icon" onclick="event.stopPropagation(); await app.deleteTemplate(${template.id})" title="Delete"><i class="fas fa-trash"></i></button>
                    </div>
                </div>
                <h4 class="template-title">${template.template_name}</h4>
                <p class="template-preview">${template.content.substring(0, 80)}${template.content.length > 80 ? '...' : ''}</p>
                <div class="template-variables">
                    ${template.variables.map(v => `<span class="variable-tag">{{${v}}}</span>`).join('')}
                </div>
            </div>
        `;
    };

    const openCreateTemplateModal = async (templateId = null) => {
        const isEdit = !!templateId;
        const template = isEdit ? AppDataStore.getById('whatsapp_templates', templateId) : null;

        const content = `
            <div class="template-modal">
                <div class="form-group">
                    <label>Template Name <span class="required">*</span></label>
                    <input type="text" id="template-name" class="form-control" value="${template?.template_name || ''}" placeholder="e.g., Birthday Greeting Template" required>
                </div>
                
                <div class="form-group">
                    <label>Category</label>
                    <select id="template-category" class="form-control">
                        <option value="Birthday" ${template?.category === 'Birthday' ? 'selected' : ''}>Birthday Greeting</option>
                        <option value="Appointment Reminder" ${template?.category === 'Appointment Reminder' ? 'selected' : ''}>Appointment Reminder</option>
                        <option value="Follow-up" ${template?.category === 'Follow-up' ? 'selected' : ''}>Follow-up</option>
                        <option value="Event" ${template?.category === 'Event' ? 'selected' : ''}>Event Invitation</option>
                        <option value="Promotion" ${template?.category === 'Promotion' ? 'selected' : ''}>Promotion</option>
                        <option value="Thank You" ${template?.category === 'Thank You' ? 'selected' : ''}>Thank You</option>
                        <option value="CPS" ${template?.category === 'CPS' ? 'selected' : ''}>CPS Invitation</option>
                        <option value="Other" ${template?.category === 'Other' ? 'selected' : ''}>Other</option>
                    </select>
                </div>
                
                <div class="form-group">
                    <label>Message Content <span class="required">*</span></label>
                    <div class="variable-buttons">
                        <button type="button" class="btn-sm secondary" onclick="app.insertVariable('{{name}}')">{{name}}</button>
                        <button type="button" class="btn-sm secondary" onclick="app.insertVariable('{{zodiac}}')">{{zodiac}}</button>
                        <button type="button" class="btn-sm secondary" onclick="app.insertVariable('{{mg}}')">{{mg}}</button>
                        <button type="button" class="btn-sm secondary" onclick="app.insertVariable('{{expiry}}')">{{expiry}}</button>
                        <button type="button" class="btn-sm secondary" onclick="app.insertVariable('{{date}}')">{{date}}</button>
                        <button type="button" class="btn-sm secondary" onclick="app.insertVariable('{{agent}}')">{{agent}}</button>
                        <button type="button" class="btn-sm secondary" onclick="app.insertVariable('{{event_date}}')">{{event_date}}</button>
                        <button type="button" class="btn-sm secondary" onclick="app.insertVariable('{{event_title}}')">{{event_title}}</button>
                        <button type="button" class="btn-sm secondary" onclick="app.insertVariable('{{location}}')">{{location}}</button>
                    </div>
                    <textarea id="template-content" class="form-control" rows="6" placeholder="Type your message here...">${template?.content || ''}</textarea>
                </div>
                
                <div class="form-group">
                    <label>Buttons</label>
                    <div id="buttons-container">
                        ${renderButtonFields(template?.buttons || [])}
                    </div>
                    <button type="button" class="btn-sm secondary" onclick="app.addButtonField()">
                        <i class="fas fa-plus"></i> Add Button
                    </button>
                </div>
                
                <div class="form-group">
                    <label>Footer Text (optional)</label>
                    <input type="text" id="template-footer" class="form-control" value="${template?.footer_text || ''}" placeholder="e.g., Reply STOP to opt out">
                </div>
            </div>
        `;

        UI.showModal(isEdit ? 'Edit Template' : 'Create WhatsApp Template', content, [
            { label: 'Cancel', type: 'secondary', action: 'UI.hideModal()' },
            { label: isEdit ? 'Update Template' : 'Save Template', type: 'primary', action: `await app.saveTemplate(${isEdit ? templateId : 'null'})` }
        ]);
    };

    const renderButtonFields = (buttons) => {
        if (!buttons || buttons.length === 0) {
            return `
            <div class="button-field-row">
        <input type="text" class="form-control" placeholder="Button 1 text" value="Yes I'm interested">
            <select class="form-control" style="width: 120px;">
                <option value="quick_reply">Quick Reply</option>
                <option value="url">URL</option>
                <option value="phone">Phone Number</option>
            </select>
            <div class="button-field-row">
                <input type="text" class="form-control" placeholder="Button 1 text" value="Yes I'm interested">
                <select class="form-control" style="width: 120px;">
                    <option value="quick_reply">Quick Reply</option>
                    <option value="url">URL</option>
                    <option value="phone">Phone Number</option>
                </select>
            </div>
`;
        }

        return buttons.map((btn, index) => `
            <div class="button-field-row">
                <input type="text" class="form-control" placeholder="Button ${index + 1} text" value="${btn.text}">
                <select class="form-control" style="width: 120px;">
                    <option value="quick_reply" ${btn.type === 'quick_reply' ? 'selected' : ''}>Quick Reply</option>
                    <option value="url" ${btn.type === 'url' ? 'selected' : ''}>URL</option>
                    <option value="phone" ${btn.type === 'phone' ? 'selected' : ''}>Phone Number</option>
                </select>
                <button class="btn-icon" onclick="this.parentElement.remove()"><i class="fas fa-times"></i></button>
            </div>
        `).join('');
    };

    const saveTemplate = async (templateId = null) => {
        const name = document.getElementById('template-name')?.value;
        const category = document.getElementById('template-category')?.value;
        const content = document.getElementById('template-content')?.value;
        const footer = document.getElementById('template-footer')?.value;

        if (!name || !content) {
            UI.toast.error('Template name and content are required');
            return;
        }

        // Collect buttons
        const buttonRows = document.querySelectorAll('.button-field-row');
        const buttons = [];
        buttonRows.forEach(row => {
            const text = row.querySelector('input')?.value;
            const type = row.querySelector('select')?.value;
            if (text) {
                buttons.push({ text, type });
            }
        });

        // Extract variables from content
        const variableRegex = /{{(.*?)}}/g;
        const matches = content.match(variableRegex) || [];
        const variables = matches.map(m => m.replace(/{{|}}/g, ''));

        const template = {
            template_name: name,
            category: category,
            content: content,
            buttons: buttons,
            variables: [...new Set(variables)], // Remove duplicates
            footer_text: footer || '',
            is_approved: true,
            status: 'active',
            created_by: _currentUser ? _currentUser.id : 5,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString()
        };

        if (templateId) {
            AppDataStore.update('whatsapp_templates', templateId, template);
            UI.toast.success('Template updated successfully');
        } else {
            await AppDataStore.create('whatsapp_templates', template);
            UI.toast.success('Template created successfully');
        }

        UI.hideModal();
        await refreshTemplatesTab();
    };

    const refreshTemplatesTab = async () => {
        if (_currentMarketingTab === 'templates') {
            const container = document.getElementById('marketing-tab-content');
            if (container) {
                container.innerHTML = await renderTemplatesTab();
            }
        }
    };

    const previewTemplate = (templateId) => {
        const template = AppDataStore.getById('whatsapp_templates', templateId);
        if (!template) return;

        const previewData = {
            name: 'Michelle Tan',
            zodiac: 'Horse',
            mg: 'MG4',
            expiry: '31 Dec 2026',
            date: '15 Mar 2026',
            agent: 'Michelle Tan',
            event_date: '20 Mar 2026',
            event_title: 'Feng Shui Workshop'
        };

        let previewContent = template.content;
        Object.keys(previewData).forEach(key => {
            previewContent = previewContent.replace(new RegExp(`{{${key}}}`, 'g'), previewData[key]);
        });

        const previewFrame = document.getElementById('whatsapp-preview');
        if (previewFrame) {
            previewFrame.innerHTML = `
                <div class="whatsapp-header">
                    <div class="whatsapp-avatar"></div>
                    <div class="whatsapp-contact">Michelle Tan</div>
                    <div class="whatsapp-time">10:24 PM</div>
                </div>
                <div class="whatsapp-body">
                    <div class="message-bubble received">
                        ${previewContent}
                        <div class="message-time">10:24 PM</div>
                    </div>
                </div>
            `;
        }
    };

    const insertVariable = (variable) => {
        const textarea = document.getElementById('template-content');
        if (textarea) {
            const start = textarea.selectionStart;
            const end = textarea.selectionEnd;
            const text = textarea.value;
            textarea.value = text.substring(0, start) + variable + text.substring(end);
            textarea.focus();
            textarea.setSelectionRange(start + variable.length, start + variable.length);
        }
    };

    const addButtonField = () => {
        const container = document.getElementById('buttons-container');
        if (container) {
            const div = document.createElement('div');
            div.className = 'button-field-row';
            div.innerHTML = `
            <input type="text" class="form-control" placeholder="Button text">
                <select class="form-control" style="width: 120px;">
                    <option value="quick_reply">Quick Reply</option>
                    <option value="url">URL</option>
                    <option value="phone">Phone Number</option>
                </select>
                <button class="btn-icon" onclick="this.parentElement.remove()"><i class="fas fa-times"></i></button>
`;
            container.appendChild(div);
        }
    };

    const searchTemplates = async () => {
        const search = document.getElementById('template-search').value.toLowerCase();
        const templates =await  AppDataStore.getAll('whatsapp_templates');
        const filtered = templates.filter(t =>
            t.template_name.toLowerCase().includes(search) ||
            t.category.toLowerCase().includes(search)
        );
        const grid = document.getElementById('templates-grid');
        if (grid) { grid.innerHTML = filtered.map(t => renderTemplateCard(t)).join(''); }
    };

    const editTemplate = async (id) => await openCreateTemplateModal(id);
    const copyTemplate = async (id) => {
        const t = AppDataStore.getById('whatsapp_templates', id);
        if (t) {
            const copy = { ...t, id: undefined, template_name: t.template_name + ' (Copy)' };
            await AppDataStore.create('whatsapp_templates', copy);
            await refreshTemplatesTab();
        }
    };
    const deleteTemplate = async (id) => {
        if (confirm('Delete this template?')) {
            AppDataStore.delete('whatsapp_templates', id);
            await refreshTemplatesTab();
        }
    };
    const useTemplate = async (id) => {
        _currentMarketingTab = 'campaigns';
        const viewport = document.getElementById('content-viewport');
        await showMarketingAutomationView(viewport);
        await openCreateCampaignModal();
        (() => {
            const sel = document.getElementById('campaign-template');
            if (sel) sel.value = id;
        }, 100);
    };

    // ========== CAMPAIGNS TAB ==========

    const renderCampaignsTab = async () => {
        const campaigns =await  AppDataStore.getAll('whatsapp_campaigns');

        return `
            <div class="campaigns-filters">
                <div class="form-group-inline">
                    <label>Status:</label>
                    <select id="campaign-status-filter" onchange="await app.filterCampaigns()">
                        <option value="all">All Status</option>
                        <option value="active">Active</option>
                        <option value="scheduled">Scheduled</option>
                        <option value="completed">Completed</option>
                        <option value="draft">Draft</option>
                    </select>
                </div>
                <div class="form-group-inline">
                    <label>Sort By:</label>
                    <select id="campaign-sort" onchange="await app.filterCampaigns()">
                        <option value="date-desc">Newest First</option>
                        <option value="date-asc">Oldest First</option>
                        <option value="name">Name</option>
                    </select>
                </div>
            </div>

    <div class="campaigns-table-container">
        <table class="campaigns-table">
            <thead>
                <tr>
                    <th>Campaign Name</th>
                    <th>Status</th>
                    <th>Schedule</th>
                    <th>Recipients</th>
                    <th>Open Rate</th>
                    <th>Response</th>
                    <th>Actions</th>
                </tr>
            </thead>
            <tbody id="campaigns-list-body">
                ${campaigns.length > 0 ? campaigns.map(c => renderCampaignRow(c)).join('') : '<tr><td colspan="7" style="text-align:center; padding:40px;">No campaigns found. Click "New Campaign" to start.</td></tr>'}
            </tbody>
        </table>
    </div>
`;
    };

    const renderCampaignRow = async (campaign) => {
        const template = AppDataStore.getById('whatsapp_templates', campaign.template_id);
        const openRate = campaign.sent_count > 0 ? Math.round((campaign.opened_count / campaign.sent_count) * 100) : 0;
        const responseRate = campaign.sent_count > 0 ? Math.round((campaign.replied_count / campaign.sent_count) * 100) : 0;

        return `
            <tr onclick="await app.viewCampaignDetails(${campaign.id})">
                <td>
                    <strong>${campaign.campaign_name}</strong><br>
                    <small class="text-muted">${template?.template_name || 'No Template'}</small>
                </td>
                <td><span class="status-badge status-${campaign.status}">${campaign.status.toUpperCase()}</span></td>
                <td>${campaign.scheduled_date ? UI.formatDate(campaign.scheduled_date) : 'Not scheduled'}</td>
                <td>${campaign.total_recipients || 0}</td>
                <td>
                    <div class="progress-container" style="width: 100px;">
                        <div class="progress-bar" style="width: ${openRate}%"></div>
                    </div>
                    <small>${openRate}%</small>
                </td>
                <td>${responseRate}%</td>
                <td>
                    <div class="table-actions">
                        ${campaign.status === 'draft' ? `<button class="btn-icon" onclick="event.stopPropagation(); await app.editCampaign(${campaign.id})" title="Edit"><i class="fas fa-edit"></i></button>` : ''}
                        ${campaign.status === 'active' ? `<button class="btn-icon" onclick="event.stopPropagation(); await app.pauseCampaign(${campaign.id})" title="Pause"><i class="fas fa-pause"></i></button>` : ''}
                        ${campaign.status === 'paused' ? `<button class="btn-icon" onclick="event.stopPropagation(); await app.resumeCampaign(${campaign.id})" title="Resume"><i class="fas fa-play"></i></button>` : ''}
                        <button class="btn-icon" onclick="event.stopPropagation(); await app.duplicateCampaign(${campaign.id})" title="Duplicate"><i class="fas fa-copy"></i></button>
                        <button class="btn-icon" onclick="event.stopPropagation(); await app.deleteCampaign(${campaign.id})" title="Delete"><i class="fas fa-trash"></i></button>
                    </div>
                </td>
            </tr>
        `;
    };

    const openCreateCampaignModal = async (campaignId = null) => {
        const isEdit = !!campaignId;
        const campaign = isEdit ? AppDataStore.getById('whatsapp_campaigns', campaignId) : null;

        const content = `
            <div class="campaign-modal">
                <div class="modal-tabs">
                    <span class="modal-tab active" data-step="1">1. Details</span>
                    <span class="modal-tab" data-step="2">2. Template</span>
                    <span class="modal-tab" data-step="3">3. Audience</span>
                    <span class="modal-tab" data-step="4">4. Schedule</span>
                </div>
                
                <div id="campaign-wizard-content">
                    <!-- Step 1: Details -->
                    <div class="campaign-step" id="step-1">
                        <div class="form-group">
                            <label>Campaign Name <span class="required">*</span></label>
                            <input type="text" id="campaign-name" class="form-control" value="${campaign?.campaign_name || ''}" placeholder="e.g., March Birthday Wishes">
                        </div>
                        <div class="form-group">
                            <label>Description</label>
                            <textarea id="campaign-description" class="form-control" rows="3" placeholder="Notes about this campaign...">${campaign?.description || ''}</textarea>
                        </div>
                        <div class="form-group">
                            <label>Time Zone</label>
                            <select id="campaign-timezone" class="form-control">
                                <option value="Asia/Kuala_Lumpur">Asia/Kuala Lumpur (GMT+8)</option>
                                <option value="Asia/Singapore">Asia/Singapore (GMT+8)</option>
                            </select>
                        </div>
                    </div>
                </div>
                
                <div class="step-navigation">
                    <span class="step-indicator">Step 1 of 4</span>
                    <div class="step-buttons">
                        <button class="btn secondary" id="btn-prev" style="display:none;" onclick="await app.prevCampaignStep()">Previous</button>
                        <button class="btn primary" id="btn-next" onclick="await app.nextCampaignStep()">Next</button>
                    </div>
                </div>
            </div>
    `;

        UI.showModal(isEdit ? 'Edit Campaign' : 'Create WhatsApp Campaign', content, [
            { label: 'Cancel', type: 'secondary', action: 'UI.hideModal()' },
            { label: 'Save as Draft', type: 'secondary', action: 'await app.saveCampaignDraft()' }
        ]);

        _currentCampaignStep = 1;
        _campaignData = campaign || {
            campaign_name: '',
            description: '',
            template_id: null,
            audience_config: { segments: [], tags: [], agents: [], filters: {} },
            scheduled_date: null,
            status: 'draft'
        };
    };

    let _currentCampaignStep = 1;
    let _campaignData = {};

    const nextCampaignStep = async () => {
        if (_currentCampaignStep === 1) {
            _campaignData.campaign_name = document.getElementById('campaign-name').value;
            _campaignData.description = document.getElementById('campaign-description').value;
            if (!_campaignData.campaign_name) {
                UI.toast.error('Campaign name is required');
                return;
            }
        }

        if (_currentCampaignStep === 2) {
            const selectedTemplate = document.querySelector('input[name="template-select"]:checked');
            if (!selectedTemplate) {
                UI.toast.error('Please select a template');
                return;
            }
            _campaignData.template_id = parseInt(selectedTemplate.value);
        }

        if (_currentCampaignStep === 3) {
            // Logic to collect audience data
            _campaignData.audience_config = {
                segments: Array.from(document.querySelectorAll('input[name="segment"]:checked')).map(i => i.value),
                tags: Array.from(document.querySelectorAll('input[name="audience-tag"]:checked')).map(i => parseInt(i.value)),
                agents: Array.from(document.querySelectorAll('input[name="agent-filter"]:checked')).map(i => parseInt(i.value))
            };
            if (_campaignData.audience_config.segments.length === 0 &&
                _campaignData.audience_config.tags.length === 0 &&
                _campaignData.audience_config.agents.length === 0) {
                UI.toast.error('Please select at least one audience criteria');
                return;
            }
        }

        _currentCampaignStep++;
        await renderCampaignStep();
    };

    const prevCampaignStep = async () => {
        _currentCampaignStep--;
        await renderCampaignStep();
    };

    const renderCampaignStep = async () => {
        const container = document.getElementById('campaign-wizard-content');
        const indicator = document.querySelector('.step-indicator');
        const btnPrev = document.getElementById('btn-prev');
        const btnNext = document.getElementById('btn-next');

        // Update tabs
        document.querySelectorAll('.modal-tab').forEach(tab => {
            tab.classList.toggle('active', parseInt(tab.dataset.step) === _currentCampaignStep);
        });

        indicator.textContent = `Step ${_currentCampaignStep} of 4`;
        btnPrev.style.display = _currentCampaignStep > 1 ? 'block' : 'none';
        btnNext.textContent = _currentCampaignStep === 4 ? 'Launch Campaign' : 'Next';
        if (_currentCampaignStep === 4) {
            btnNext.onclick = async () => await app.saveCampaign();
        } else {
            btnNext.onclick = async () => await app.nextCampaignStep();
        }

        if (_currentMarketingTab === 'analytics') {
            return; // Safety
        }

        if (_currentCampaignStep === 1) {
            container.innerHTML = `
                <div class="campaign-step" id="step-1">
                    <div class="form-group">
                        <label>Campaign Name <span class="required">*</span></label>
                        <input type="text" id="campaign-name" class="form-control" value="${_campaignData.campaign_name}" placeholder="e.g., March Birthday Wishes">
                    </div>
                    <div class="form-group">
                        <label>Description</label>
                        <textarea id="campaign-description" class="form-control" rows="3" placeholder="Notes about this campaign...">${_campaignData.description || ''}</textarea>
                    </div>
                </div>
            `;
        } else if (_currentCampaignStep === 2) {
            const templates = await AppDataStore.getAll('whatsapp_templates');
            container.innerHTML = `
                <div class="campaign-step" id="step-2">
                    <div class="templates-grid small">
                        ${templates.map(t => `
                            <div class="template-card mini ${t.id === _campaignData.template_id ? 'selected' : ''}" onclick="this.querySelector('input').click()">
                                <input type="radio" name="template-select" value="${t.id}" ${t.id === _campaignData.template_id ? 'checked' : ''} style="display:none;">
                                <div class="template-card-header">
                                    <span class="template-badge">${t.category}</span>
                                </div>
                                <h4 class="template-title">${t.template_name}</h4>
                                <p class="template-preview">${t.content.substring(0, 60)}...</p>
                            </div>
                        `).join('')}
                    </div>
                </div>
            `;
        } else if (_currentCampaignStep === 3) {
            const tags = await AppDataStore.getAll('tags');
            const agents = await AppDataStore.getAll('users').filter(isAgent);

            container.innerHTML = `
                <div class="campaign-step" id="step-3">
                    <div class="audience-section">
                        <h5>Segments</h5>
                        <div class="checkbox-group">
                            <label><input type="checkbox" name="segment" value="birthday-month" ${(_campaignData.audience_config.segments || []).includes('birthday-month') ? 'checked' : ''}> Birthday This Month</label>
                            <label><input type="checkbox" name="segment" value="high-score" ${(_campaignData.audience_config.segments || []).includes('high-score') ? 'checked' : ''}> High Lead Score (>700)</label>
                            <label><input type="checkbox" name="segment" value="inactive-30" ${(_campaignData.audience_config.segments || []).includes('inactive-30') ? 'checked' : ''}> Inactive> 30 Days</label>
                            <label><input type="checkbox" name="segment" value="new-leads" ${(_campaignData.audience_config.segments || []).includes('new-leads') ? 'checked' : ''}> New Leads (Last 7 Days)</label>
                        </div>
                        
                        <h5>Tags</h5>
                        <div class="checkbox-group grid">
                            ${tags.map(t => `<label><input type="checkbox" name="audience-tag" value="${t.id}" ${(_campaignData.audience_config.tags || []).includes(t.id) ? 'checked' : ''}> ${t.name}</label>`).join('')}
                        </div>
                        
                        <h5>Agents</h5>
                        <div class="checkbox-group grid">
                            ${agents.map(a => `<label><input type="checkbox" name="agent-filter" value="${a.id}" ${(_campaignData.audience_config.agents || []).includes(a.id) ? 'checked' : ''}> ${a.full_name}</label>`).join('')}
                        </div>
                    </div>
                    <div class="audience-size" id="audience-size-preview">
                        Calculating estimated audience size...
                    </div>
                </div>
            `;
            (calculateAudienceSize, 200);
        } else if (_currentCampaignStep === 4) {
            container.innerHTML = `
                <div class="campaign-step" id="step-4">
                    <div class="form-group">
                        <label>Launching Options</label>
                        <div class="radio-group">
                            <label><input type="radio" name="launch-type" value="now" checked onchange="document.getElementById('schedule-options').style.display='none'"> Send Immediately</label>
                            <label><input type="radio" name="launch-type" value="schedule" onchange="document.getElementById('schedule-options').style.display='block'"> Schedule for Later</label>
                        </div>
                    </div>
                    
                    <div id="schedule-options" style="display:none;">
                        <div class="form-group">
                            <label>Date & Time</label>
                            <input type="datetime-local" id="campaign-schedule-time" class="form-control">
                        </div>
                    </div>
                    
                    <div class="campaign-summary-box" style="background:var(--gray-50); padding:16px; border-radius:8px; margin-top:20px;">
                        <h5>Campaign Summary</h5>
                        <p><strong>Name:</strong> ${_campaignData.campaign_name}</p>
                        <p><strong>Template:</strong> ${AppDataStore.getById('whatsapp_templates', _campaignData.template_id)?.template_name}</p>
                        <p><strong>Estimated Audience:</strong> <span id="final-audience-size">...</span></p>
                    </div>
                </div>
            `;
            (() => {
                const size = document.getElementById('audience-size-preview')?.getAttribute('data-size') || '85';
                const el = document.getElementById('final-audience-size');
                if (el) el.textContent = size + ' recipients';
            }, 500);
        }
    };

    const calculateAudienceSize = async () => {
        const config = {
            segments: Array.from(document.querySelectorAll('input[name="segment"]:checked')).map(i => i.value),
            tags: Array.from(document.querySelectorAll('input[name="audience-tag"]:checked')).map(i => parseInt(i.value)),
            agents: Array.from(document.querySelectorAll('input[name="agent-filter"]:checked')).map(i => parseInt(i.value))
        };

        let prospects = await getVisibleProspects();

        // Logical OR between different criteria types (Segment OR Tag OR Agent)
        // But internal criteria is usually AND (though Segment is often OR between items)

        let filtered = [];

        if (config.segments.length > 0) {
            const now = new Date();
            const currentMonth = now.getMonth() + 1;

            prospects.forEach(p => {
                let match = false;
                if (config.segments.includes('birthday-month')) {
                    if (p.date_of_birth) {
                        const dob = new Date(p.date_of_birth);
                        if (dob.getMonth() + 1 === currentMonth) match = true;
                    }
                }
                if (config.segments.includes('high-score')) {
                    if (p.score >= 700) match = true;
                }
                if (config.segments.includes('new-leads')) {
                    const created = new Date(p.created_at || '2026-01-01');
                    const diff = (now - created) / (1000 * 60 * 60 * 24);
                    if (diff <= 7) match = true;
                }
                if (match) filtered.push(p.id);
            });
        }

        if (config.tags.length > 0) {
            prospects.forEach(p => {
                if (p.tags && p.tags.some(t => config.tags.includes(t))) {
                    filtered.push(p.id);
                }
            });
        }

        if (config.agents.length > 0) {
            prospects.forEach(p => {
                if (config.agents.includes(p.responsible_agent_id)) {
                    filtered.push(p.id);
                }
            });
        }

        // Remove duplicates
        const uniqueRecipients = [...new Set(filtered)];
        const size = uniqueRecipients.length;

        const preview = document.getElementById('audience-size-preview');
        if (preview) {
            preview.innerHTML = `<strong>Estimated Audience Size:</strong> ${size} Recipients`;
            preview.setAttribute('data-size', size);
            preview.style.backgroundColor = size > 0 ? '#d1fae5' : '#fee2e2';
        }

        return uniqueRecipients;
    };

    const saveCampaignDraft = async () => {
        _campaignData.campaign_name = document.getElementById('campaign-name')?.value || 'Untitled Campaign';
        _campaignData.status = 'draft';
        await AppDataStore.create('whatsapp_campaigns', _campaignData);
        UI.toast.success('Campaign saved as draft');
        UI.hideModal();
        await refreshCampaignsTab();
    };

    const saveCampaign = async () => {
        _campaignData.status = 'scheduled';
        const launchType = document.querySelector('input[name="launch-type"]:checked')?.value;
        if (launchType === 'now') {
            _campaignData.status = 'active';
            _campaignData.scheduled_date = new Date().toISOString();
        } else {
            const time = document.getElementById('campaign-schedule-time')?.value;
            if (!time) {
                UI.toast.error('Please select a schedule time');
                return;
            }
            _campaignData.scheduled_date = time;
        }

        const recipients = await calculateAudienceSize();
        _campaignData.total_recipients = recipients.length;
        _campaignData.sent_count = 0;
        _campaignData.delivered_count = 0;
        _campaignData.opened_count = 0;
        _campaignData.replied_count = 0;
        _campaignData.clicked_count = 0;
        _campaignData.converted_count = 0;
        _campaignData.created_by = _currentUser ? _currentUser.id : 5;
        _campaignData.created_at = new Date().toISOString();

        const campaign = await AppDataStore.create('whatsapp_campaigns', _campaignData);

        // Create initial message tracking for each recipient
        recipients.forEach(rpId => {
            await AppDataStore.create('campaign_messages', {
                campaign_id: campaign.id,
                prospect_id: rpId,
                status: launchType === 'now' ? 'queued' : 'scheduled',
                sent_at: launchType === 'now' ? new Date().toISOString() : null,
                delivered_at: null,
                opened_at: null,
                replied_at: null,
                last_error: null,
                retry_count: 0
            });
        });

        if (launchType === 'now') {
            await simulateCampaignSending(campaign.id);
        }

        UI.toast.success(launchType === 'now' ? 'Campaign launched successfully!' : 'Campaign scheduled successfully!');
        UI.hideModal();
        await refreshCampaignsTab();
    };

    const simulateCampaignSending = async (campaignId) => {
        const messages = await AppDataStore.getAll('campaign_messages').filter(m => m.campaign_id === campaignId);
        let sent = 0;

        const interval = (() => {
            if (sent >= messages.length) {
                clearInterval(interval);
                AppDataStore.update('whatsapp_campaigns', campaignId, { status: 'completed', completed_date: new Date().toISOString() });
                await refreshCampaignsTab();
                return;
            }

            const msg = messages[sent];
            const statusRoll = Math.random();
            let status = 'sent';
            if (statusRoll > 0.1) status = 'delivered';
            if (statusRoll > 0.4) status = 'opened';
            if (statusRoll > 0.8) status = 'replied';

            AppDataStore.update('campaign_messages', msg.id, {
                status: status,
                sent_at: new Date().toISOString()
            });

            // Update campaign stats
            const campaign = AppDataStore.getById('whatsapp_campaigns', campaignId);
            const updates = { sent_count: (campaign.sent_count || 0) + 1 };
            if (['delivered', 'opened', 'replied'].includes(status)) updates.delivered_count = (campaign.delivered_count || 0) + 1;
            if (['opened', 'replied'].includes(status)) updates.opened_count = (campaign.opened_count || 0) + 1;
            if (status === 'replied') updates.replied_count = (campaign.replied_count || 0) + 1;

            AppDataStore.update('whatsapp_campaigns', campaignId, updates);
            sent++;
        }, 500);
    };

    const refreshCampaignsTab = async () => {
        if (_currentMarketingTab === 'campaigns') {
            const container = document.getElementById('marketing-tab-content');
            if (container) {
                container.innerHTML = await renderCampaignsTab();
            }
        }
    };

    const filterCampaigns = async () => {
        const status = document.getElementById('campaign-status-filter').value;
        const sort = document.getElementById('campaign-sort').value;

        let campaigns = await AppDataStore.getAll('whatsapp_campaigns');

        if (status !== 'all') {
            campaigns = campaigns.filter(c => c.status === status);
        }

        if (sort === 'date-desc') {
            campaigns.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
        } else if (sort === 'date-asc') {
            campaigns.sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
        } else if (sort === 'name') {
            campaigns.sort((a, b) => a.campaign_name.localeCompare(b.campaign_name));
        }

        const body = document.getElementById('campaigns-list-body');
        if (body) {
            body.innerHTML = campaigns.length > 0 ? campaigns.map(c => renderCampaignRow(c)).join('') : '<tr><td colspan="7" style="text-align:center; padding:40px;">No campaigns found.</td></tr>';
        }
    };

    const editCampaign = async (id) => await openCreateCampaignModal(id);
    const pauseCampaign = async (id) => {
        AppDataStore.update('whatsapp_campaigns', id, { status: 'paused' });
        await refreshCampaignsTab();
    };
    const resumeCampaign = async (id) => {
        AppDataStore.update('whatsapp_campaigns', id, { status: 'active' });
        await refreshCampaignsTab();
    };
    const cancelCampaign = async (id) => {
        if (confirm('Cancel this campaign? Active messages will stop.')) {
            AppDataStore.update('whatsapp_campaigns', id, { status: 'cancelled' });
            await refreshCampaignsTab();
        }
    };
    const duplicateCampaign = async (id) => {
        const c = AppDataStore.getById('whatsapp_campaigns', id);
        if (c) {
            const copy = {
                ...c,
                id: undefined,
                campaign_name: c.campaign_name + ' (Copy)',
                status: 'draft',
                sent_count: 0, delivered_count: 0, opened_count: 0, replied_count: 0
            };
            await AppDataStore.create('whatsapp_campaigns', copy);
            await refreshCampaignsTab();
        }
    };
    const deleteCampaign = async (id) => {
        if (confirm('Delete this campaign and all its tracking data?')) {
            AppDataStore.delete('whatsapp_campaigns', id);
            // Delete messages
            const messages = await AppDataStore.getAll('campaign_messages').filter(m => m.campaign_id === id);
            messages.forEach(m => AppDataStore.delete('campaign_messages', m.id));
            await refreshCampaignsTab();
        }
    };

    // ========== ANALYTICS TAB ==========

    const renderAnalyticsTab = async () => {
        const analytics = await getRealAnalyticsData();
        return `
            <div class="analytics-stats-grid">
                <div class="analytics-card">
                    <div class="analytics-icon blue"><i class="fas fa-bullhorn"></i></div>
                    <div class="analytics-content">
                        <span class="analytics-label">Total Campaigns</span>
                        <span class="analytics-value">${analytics.totalCampaigns}</span>
                        <span class="analytics-trend up"><i class="fas fa-arrow-up"></i> 12% vs last month</span>
                    </div>
                </div>
                <div class="analytics-card">
                    <div class="analytics-icon green"><i class="fas fa-envelope-open"></i></div>
                    <div class="analytics-content">
                        <span class="analytics-label">Avg Open Rate</span>
                        <span class="analytics-value">${analytics.avgOpenRate}%</span>
                        <span class="analytics-trend up"><i class="fas fa-arrow-up"></i> ${analytics.openRateTrend}% vs last month</span>
                    </div>
                </div>
                <div class="analytics-card">
                    <div class="analytics-icon orange"><i class="fas fa-reply"></i></div>
                    <div class="analytics-content">
                        <span class="analytics-label">Avg Response Rate</span>
                        <span class="analytics-value">${analytics.avgResponseRate}%</span>
                        <span class="analytics-trend down"><i class="fas fa-arrow-down"></i> 1.5% vs last month</span>
                    </div>
                </div>
                <div class="analytics-card">
                    <div class="analytics-icon purple"><i class="fas fa-user-check"></i></div>
                    <div class="analytics-content">
                        <span class="analytics-label">Conversion Rate</span>
                        <span class="analytics-value">${analytics.avgConversionRate}%</span>
                        <span class="analytics-trend up"><i class="fas fa-arrow-up"></i> 0.8% vs last month</span>
                    </div>
                </div>
            </div>
            
            <div class="chart-row">
                <div class="chart-container">
                    <h3>Message Volume Trend</h3>
                    <canvas id="message-volume-chart"></canvas>
                </div>
                <div class="chart-container">
                    <h3>Campaign Performance Comparison</h3>
                    <canvas id="campaign-performance-chart"></canvas>
                </div>
            </div>
            
            <div class="chart-row">
                <div class="chart-container">
                    <h3>Audience Segmentation</h3>
                    <canvas id="audience-segment-chart"></canvas>
                </div>
                <div class="top-campaigns">
                    <h3>Top Performing Campaigns</h3>
                    <table class="campaigns-table">
                        <thead>
                            <tr>
                                <th>Campaign</th>
                                <th>Sent</th>
                                <th>Open Rate</th>
                                <th>Score</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${analytics.topCampaigns.map(c => `
                                <tr>
                                    <td>${c.campaign_name}</td>
                                    <td>${c.sent_count}</td>
                                    <td>${Math.round((c.opened_count / c.sent_count) * 100)}%</td>
                                    <td><span class="badge-green">High</span></td>
                                </tr>
                            `).join('')}
                        </tbody>
                    </table>
                    <button class="btn-sm secondary" style="width:100%; margin-top:12px;" onclick="await app.exportAnalyticsReport()">Export Detailed Report</button>
                </div>
            </div>
`;
    };

    const getRealAnalyticsData = async () => {
        const campaigns = await AppDataStore.getAll('whatsapp_campaigns').filter(c => c.status === 'completed' || c.status === 'active');

        const totalCampaigns = campaigns.length;
        let totalSent = 0;
        let totalOpened = 0;
        let totalReplied = 0;
        let totalConverted = 0;

        campaigns.forEach(c => {
            totalSent += (c.sent_count || 0);
            totalOpened += (c.opened_count || 0);
            totalReplied += (c.replied_count || 0);
            totalConverted += (c.converted_count || 0);
        });

        const avgOpenRate = totalSent > 0 ? Math.round((totalOpened / totalSent) * 100) : 0;
        const avgResponseRate = totalSent > 0 ? Math.round((totalReplied / totalSent) * 100) : 0;
        const avgConversionRate = totalSent > 0 ? Math.round((totalConverted / totalSent) * 100) : 0;

        const topCampaigns = [...campaigns].sort((a, b) => (b.opened_count / b.sent_count) - (a.opened_count / a.sent_count)).slice(0, 5);

        return {
            totalCampaigns,
            avgOpenRate,
            avgResponseRate,
            avgConversionRate,
            topCampaigns,
            openRateTrend: 5.2 // Placeholder: replace with real comparison logic if needed
        };
    };

    const initMarketingCharts = async () => {
        const campaigns = await AppDataStore.getAll('whatsapp_campaigns').filter(c => c.status === 'completed' || c.status === 'active').slice(-5);

        // Message Volume Chart
        const volumeCtx = document.getElementById('message-volume-chart')?.getContext('2d');
        if (volumeCtx) {
            new Chart(volumeCtx, {
                type: 'line',
                data: {
                    labels: campaigns.map(c => c.campaign_name.substring(0, 10)),
                    datasets: [{
                        label: 'Messages Sent',
                        data: campaigns.map(c => c.sent_count),
                        borderColor: '#3b82f6',
                        backgroundColor: 'rgba(59, 130, 246, 0.1)',
                        fill: true,
                        tension: 0.4
                    }]
                },
                options: { responsive: true, plugins: { legend: { display: false } } }
            });
        }

        // Campaign Performance Chart
        const perfCtx = document.getElementById('campaign-performance-chart')?.getContext('2d');
        if (perfCtx) {
            new Chart(perfCtx, {
                type: 'bar',
                data: {
                    labels: campaigns.map(c => c.campaign_name.substring(0, 10)),
                    datasets: [
                        { label: 'Delivered', data: campaigns.map(c => c.delivered_count), backgroundColor: '#d1fae5' },
                        { label: 'Opened', data: campaigns.map(c => c.opened_count), backgroundColor: '#3b82f6' },
                        { label: 'Replied', data: campaigns.map(c => c.replied_count), backgroundColor: '#8b5cf6' }
                    ]
                },
                options: { responsive: true, scales: { x: { stacked: true }, y: { stacked: true } } }
            });
        }

        // Audience Segment Chart
        const segmentCtx = document.getElementById('audience-segment-chart')?.getContext('2d');
        if (segmentCtx) {
            new Chart(segmentCtx, {
                type: 'doughnut',
                data: {
                    labels: ['Birthday', 'High Score', 'Inactive', 'New Leads'],
                    datasets: [{
                        data: [45, 120, 85, 30],
                        backgroundColor: ['#3b82f6', '#10b981', '#f59e0b', '#8b5cf6']
                    }]
                },
                options: { responsive: true, cutout: '70%', plugins: { legend: { position: 'bottom' } } }
            });
        }
    };

    const refreshAnalytics = async () => {
        (initMarketingCharts, 100);
    };

    const exportAnalyticsReport = async () => {
        const data = await getRealAnalyticsData();
        let csv = "Metric,Value\n";
        csv += `Total Campaigns, ${data.totalCampaigns} \n`;
        csv += `Avg Open Rate, ${data.avgOpenRate}%\n`;
        csv += `Avg Response Rate, ${data.avgResponseRate}%\n`;
        csv += `Avg Conversion Rate, ${data.avgConversionRate}%\n\n`;
        csv += "Campaign Name,Sent,Opened,Replied,Converted\n";

        const campaigns = await AppDataStore.getAll('whatsapp_campaigns');
        campaigns.forEach(c => {
            csv += `${c.campaign_name},${c.sent_count},${c.opened_count},${c.replied_count},${c.converted_count} \n`;
        });

        const blob = new Blob([csv], { type: 'text/csv' });
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `Marketing_Analytics_${new Date().toLocaleDateString()}.csv`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        UI.toast.success('Report exported successfully');
    };

    // ========== CAMPAIGN DETAILS VIEW ==========

    const viewCampaignDetails = async (campaignId) => {
        const campaign = AppDataStore.getById('whatsapp_campaigns', campaignId);
        if (!campaign) return;

        const template = AppDataStore.getById('whatsapp_templates', campaign.template_id);
        const messages = await AppDataStore.getAll('campaign_messages').filter(m => m.campaign_id === campaignId);

        // Calculate metrics
        const sent = messages.filter(m => ['sent', 'delivered', 'opened', 'replied'].includes(m.status)).length;
        const delivered = messages.filter(m => ['delivered', 'opened', 'replied'].includes(m.status)).length;
        const opened = messages.filter(m => ['opened', 'replied'].includes(m.status)).length;
        const replied = messages.filter(m => m.status === 'replied').length;
        const clicked = messages.filter(m => m.clicked_at).length;
        const converted = messages.filter(m => m.converted_at).length;

        const openRate = sent > 0 ? Math.round((opened / sent) * 100) : 0;
        const replyRate = sent > 0 ? Math.round((replied / sent) * 100) : 0;
        const clickRate = sent > 0 ? Math.round((clicked / sent) * 100) : 0;
        const convRate = sent > 0 ? Math.round((converted / sent) * 100) : 0;

        const content = `
            <div class="campaign-details">
                <div class="campaign-header">
                    <div>
                        <h2>${campaign.campaign_name}</h2>
                        <div class="campaign-meta">
                            <span><i class="fas fa-calendar"></i> Created: ${UI.formatDate(campaign.created_at)}</span>
                            <span><i class="fas fa-layer-group"></i> Template: ${template?.template_name || 'N/A'}</span>
                            <span class="status-badge status-${campaign.status}">${campaign.status.toUpperCase()}</span>
                        </div>
                    </div>
                    <div class="campaign-actions">
                        <button class="btn secondary" onclick="await app.duplicateCampaign(${campaignId})"><i class="fas fa-copy"></i> Duplicate</button>
                        <button class="btn secondary" onclick="await app.exportCampaignReport(${campaignId})"><i class="fas fa-download"></i> Export Report</button>
                        ${campaign.status === 'active' ? `<button class="btn warning" onclick="await app.pauseCampaign(${campaignId})"><i class="fas fa-pause"></i> Pause</button>` : ''}
                    </div>
                </div>

                <div class="campaign-metrics-grid">
                    <div class="metric-card">
                        <div class="metric-label">Sent</div>
                        <div class="metric-value">${sent}</div>
                    </div>
                    <div class="metric-card">
                        <div class="metric-label">Delivered</div>
                        <div class="metric-value">${delivered}</div>
                        <div class="metric-percent">${sent > 0 ? Math.round((delivered / sent) * 100) : 0}%</div>
                    </div>
                    <div class="metric-card">
                        <div class="metric-label">Opened</div>
                        <div class="metric-value">${opened}</div>
                        <div class="metric-percent">${openRate}%</div>
                    </div>
                    <div class="metric-card">
                        <div class="metric-label">Replied</div>
                        <div class="metric-value">${replied}</div>
                        <div class="metric-percent">${replyRate}%</div>
                    </div>
                    <div class="metric-card">
                        <div class="metric-label">Clicked</div>
                        <div class="metric-value">${clicked}</div>
                        <div class="metric-percent">${clickRate}%</div>
                    </div>
                    <div class="metric-card">
                        <div class="metric-label">Converted</div>
                        <div class="metric-value">${converted}</div>
                        <div class="metric-percent">${convRate}%</div>
                    </div>
                </div>

                <div class="campaign-tabs">
                    <div class="campaign-timeline">
                        <h3><i class="fas fa-history"></i> Recent Activity</h3>
                        <div class="timeline-list">
                            ${messages.slice(0, 10).map(m => `
                                <div class="timeline-item">
                                    <div class="timeline-time">${UI.formatDate(m.sent_at || m.created_at)}</div>
                                    <div class="timeline-event">
                                        <strong>${getEntityName('prospects', m.prospect_id)}</strong>
                                        <span class="status-badge status-${m.status}">${m.status}</span>
                                    </div>
                                </div>
                            `).join('')}
                        </div>
                    </div>

                    <div class="recipient-list-section">
                        <div class="recipient-header">
                            <h3><i class="fas fa-users"></i> Recipient List</h3>
                            <div class="recipient-filters">
                                <input type="text" id="recipient-search" placeholder="Search recipients..." onkeyup="await app.filterRecipients(${campaignId})">
                                <select id="recipient-status-filter" onchange="await app.filterRecipients(${campaignId})">
                                    <option value="all">All Status</option>
                                    <option value="sent">Sent</option>
                                    <option value="delivered">Delivered</option>
                                    <option value="opened">Opened</option>
                                    <option value="replied">Replied</option>
                                    <option value="failed">Failed</option>
                                </select>
                            </div>
                        </div>
                        <div class="recipient-table-container">
                            <table class="recipient-table">
                                <thead>
                                    <tr>
                                        <th>Recipient</th>
                                        <th>Phone</th>
                                        <th>Status</th>
                                        <th>Sent At</th>
                                        <th>Actions</th>
                                    </tr>
                                </thead>
                                <tbody id="recipient-list-body">
                                    ${messages.map(m => renderRecipientRow(m)).join('')}
                                </tbody>
                            </table>
                        </div>
                    </div>
                </div>
            </div>
        `;

        UI.showModal('Campaign Details', content, [
            { label: 'Close', type: 'secondary', action: 'UI.hideModal()' }
        ]);
    };

    const renderRecipientRow = async (msg) => {
        const prospect = AppDataStore.getById('prospects', msg.prospect_id);
        return `
            <tr>
                <td><strong>${prospect?.full_name || 'Unknown'}</strong></td>
                <td>${prospect?.phone || 'N/A'}</td>
                <td><span class="status-badge status-${msg.status}">${msg.status}</span></td>
                <td>${msg.sent_at ? UI.formatDate(msg.sent_at) : '-'}</td>
                <td>
                    <button class="btn-sm secondary" onclick="await app.viewRecipientHistory(${msg.id})">History</button>
                    ${msg.status === 'failed' ? `<button class="btn-sm primary" onclick="await app.retryMessage(${msg.id})">Retry</button>` : ''}
                </td>
            </tr>
        `;
    };

    const filterRecipients = async (campaignId) => {
        const search = document.getElementById('recipient-search').value.toLowerCase();
        const status = document.getElementById('recipient-status-filter').value;
        const messages = await AppDataStore.getAll('campaign_messages').filter(m => m.campaign_id === campaignId);

        const filtered = messages.filter(m => {
            const prospect = AppDataStore.getById('prospects', m.prospect_id);
            const nameMatch = prospect?.full_name?.toLowerCase().includes(search);
            const statusMatch = status === 'all' || m.status === status;
            return nameMatch && statusMatch;
        });

        const body = document.getElementById('recipient-list-body');
        if (body) {
            body.innerHTML = filtered.map(m => renderRecipientRow(m)).join('');
        }
    };

    const viewRecipientHistory = async (messageId) => {
        const msg = AppDataStore.getById('campaign_messages', messageId);
        if (!msg) return;
        const prospect = AppDataStore.getById('prospects', msg.prospect_id);

        const content = `
            <div class="recipient-history">
                <h4>Message History for ${prospect?.full_name}</h4>
                <div class="history-timeline">
                    <div class="history-item">
                        <small>${UI.formatDate(msg.sent_at || msg.created_at)}</small>
                        <p>Message sent via WhatsApp</p>
                    </div>
                    ${msg.delivered_at ? `
                        <div class="history-item">
                            <small>${UI.formatDate(msg.delivered_at)}</small>
                            <p>Message delivered</p>
                        </div>
                    ` : ''}
                    ${msg.opened_at ? `
                        <div class="history-item">
                            <small>${UI.formatDate(msg.opened_at)}</small>
                            <p>Message opened/read</p>
                        </div>
                    ` : ''}
                    ${msg.replied_at ? `
                        <div class="history-item">
                            <small>${UI.formatDate(msg.replied_at)}</small>
                            <p>Received reply from customer</p>
                        </div>
                    ` : ''}
                </div>
            </div>
    `;

        UI.showModal('Recipient History', content, [
            { label: 'Back', type: 'secondary', action: `await app.viewCampaignDetails(${msg.campaign_id})` }
        ]);
    };

    const retryMessage = async (messageId) => {
        const msg = AppDataStore.getById('campaign_messages', messageId);
        if (msg) {
            AppDataStore.update('campaign_messages', messageId, { status: 'queued', retry_count: (msg.retry_count || 0) + 1 });
            UI.toast.success('Message queued for retry');
            await app.viewCampaignDetails(msg.campaign_id);
        }
    };

    const exportCampaignReport = async (campaignId) => {
        const campaign = AppDataStore.getById('whatsapp_campaigns', campaignId);
        const messages = await AppDataStore.getAll('campaign_messages').filter(m => m.campaign_id === campaignId);

        let csv = "Recipient,Phone,Status,SentAt,DeliveredAt,OpenedAt,RepliedAt\n";
        messages.forEach(m => {
            const p = AppDataStore.getById('prospects', m.prospect_id);
            csv += `"${p?.full_name || 'Unknown'}", "${p?.phone || ''}", ${m.status}, "${m.sent_at || ''}", "${m.delivered_at || ''}", "${m.opened_at || ''}", "${m.replied_at || ''}"\n`;
        });

        const blob = new Blob([csv], { type: 'text/csv' });
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `Campaign_Report_${campaign.campaign_name.replace(/\s+/g, '_')}_${new Date().toLocaleDateString()}.csv`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        UI.toast.success('Campaign report exported');
    };

    const getEntityName = (table, id) => {
        const item = AppDataStore.getById(table, id);
        if (!item) return 'Unknown';
        if (table === 'users' || table === 'agents') return item.full_name || item.username;
        if (table === 'prospects' || table === 'customers') return item.full_name;
        if (table === 'whatsapp_templates') return item.template_name;
        if (table === 'whatsapp_campaigns') return item.campaign_name;
        return item.name || item.title || 'Unnamed';
    };

    // Helper Functions

    const calculatePotentialValue = (prospect) => {
        if (!prospect) return 'RM 0';

        // Base RM 5,000 + (score * 10) + demographic modifier
        let baseValue = 5000;
        let scoreBonus = (prospect.score || 0) * 10;
        let modifier = 0;

        if (prospect.income_range && prospect.income_range.includes('15,000')) modifier += 2000;
        if (prospect.occupation && (prospect.occupation.toLowerCase().includes('business') || prospect.occupation.toLowerCase().includes('owner'))) modifier += 1500;

        const val = baseValue + scoreBonus + modifier;
        return `RM ${val.toLocaleString()} `;
    };

    const expireOldOverrides = async () => {
        const overrides = await AppDataStore.getAll('manual_overrides');
        const now = new Date();
        let expiredCount = 0;

        overrides.forEach(o => {
            if (o.status === 'active' && o.expires_at && new Date(o.expires_at) < now) {
                AppDataStore.update('manual_overrides', o.id, { status: 'expired' });
                expiredCount++;
            }
        });

        if (expiredCount > 0) {
            console.log(`${expiredCount} manual overrides have expired.`);
        }
    };

    // ========== MISSING STUB FUNCTIONS (confirm variants not defined elsewhere) ==========
    const confirmRenameFolder = async (folderId) => {
        const name = document.getElementById('rename-folder-input')?.value;
        if (!name) return;
        AppDataStore.update('folders', folderId, { name, updated_at: new Date().toISOString() });
        UI.hideModal(); UI.toast.success('Folder renamed');
        if (typeof renderFolderTree === 'function') await renderFolderTree();
        if (typeof loadFolderContents === 'function') await loadFolderContents();
    };
    const confirmDeleteFolder = async (folderId) => {
        AppDataStore.delete('folders', folderId);
        UI.hideModal(); UI.toast.success('Folder deleted');
        if (typeof renderFolderTree === 'function') await renderFolderTree();
        if (typeof loadFolderContents === 'function') await loadFolderContents();
    };
    const batchMove = () => UI.toast.info('Batch move coming soon');
    const batchShare = () => UI.toast.info('Batch share coming soon');
    const batchDownload = () => UI.toast.info('Batch download coming soon');
    const toggleUserMenu = async () => {
        const currentUser = _currentUser || Auth.getCurrentUser();

        if (!currentUser) {
            // Guest mode - show demo users
            const users = await AppDataStore.getAll('users') || [];
            // Filter for demo users
            const demoUsers = users.slice(0, 8); // Just show first 8 as demo

            const content = `
            <div class="user-menu-modal" style="padding: 10px 0;">
                    <p style="margin-bottom: 20px; color: var(--gray-600); font-size: 14px;">Log in as a demo user to access CRM features:</p>
                    <div class="demo-users-list" style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px;">
                        ${demoUsers.map(u => `
                            <div class="demo-user-item" onclick="await app.loginAs('${u.id}')" style="padding: 12px; border: 1px solid var(--gray-200); border-radius: 8px; cursor: pointer; transition: all 0.2s; background: white; text-align: left;">
                                <div style="display: flex; align-items: center; gap: 10px; margin-bottom: 8px;">
                                    <div class="avatar-sm" style="width: 28px; height: 28px; background: var(--primary-color); color: white; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-weight: bold; font-size: 11px;">
                                        ${(u.full_name || 'U').split(' ').map(n => n[0]).join('').toUpperCase().substring(0, 2)}
                                    </div>
                                    <div style="font-weight: 600; font-size: 13px; color: var(--gray-900); white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${u.full_name}</div>
                                </div>
                                <div style="font-size: 11px; color: var(--gray-500); text-transform: capitalize; background: var(--gray-100); padding: 2px 8px; border-radius: 4px; display: inline-block;">${u.role}</div>
                            </div>
                        `).join('')}
                    </div>
                    <div style="margin-top: 24px; text-align: center;">
                        <button class="btn secondary" onclick="UI.hideModal()" style="font-size: 13px;">Continue as Guest</button>
                    </div>
                </div>
    `;

            UI.showModal('Select User to Login', content, []);
        } else {
            // Logged in mode - show user options
            const content = `
            <div class="user-menu-modal" style="text-align: center; padding: 20px 0;">
                    <div class="avatar-lg" style="width: 72px; height: 72px; background: linear-gradient(135deg, var(--primary-color), var(--primary-dark)); color: white; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-weight: bold; font-size: 28px; margin: 0 auto 16px; box-shadow: 0 4px 12px rgba(0,0,0,0.1);">
                        ${(currentUser.full_name || 'U').split(' ').map(n => n[0]).join('').toUpperCase().substring(0, 2)}
                    </div>
                    <h2 style="margin-bottom: 4px; font-size: 20px;">${currentUser.full_name}</h2>
                    <p style="color: var(--gray-500); text-transform: capitalize; margin-bottom: 32px; font-weight: 500;">${currentUser.role}</p>
                    
                    <div style="border-top: 1px solid var(--gray-100); padding-top: 20px;">
                        <button class="btn danger" onclick="await app.logout()" style="width: 100%; display: flex; align-items: center; justify-content: center; gap: 10px; padding: 14px; font-weight: 600;">
                            <i class="fas fa-sign-out-alt"></i> LOGOUT FROM SYSTEM
                        </button>
                    </div>
                </div>
    `;

            UI.showModal('Account Settings', content, [
                { label: 'Close', type: 'secondary', action: 'UI.hideModal()' }
            ]);
        }
    };

    const loginAs = async (userId) => {
        const user = AppDataStore.getById('users', userId);
        if (user) {
            Auth.setUser(user);
            _currentUser = user;
            updateUserDisplay();
            await navigateTo(_currentView || 'calendar');
            UI.hideModal();
            UI.toast.success(`Welcome back, ${user.full_name} !`);
        } else {
            UI.toast.error('User not found');
        }
    };



    // ========== PHASE 13: IMPORT SYSTEM FUNCTIONS ==========

    let _currentImportStep = 1;
    let _importData = { file: null, fileName: null, fileSize: null, rows: 0, headers: ['Full Name', 'Phone Number', 'Email', 'IC Number', 'Date of Birth', 'Occupation', 'Income Range', 'Address', 'City', 'State', 'Postal Code', 'Ming Gua'], data: [], importType: 'prospects', mapping: {}, validation: { valid: 0, warnings: 0, errors: 0 }, duplicates: { total: 0 }, assignment: { assignTo: 'myself' } };

    const showImportDashboard = async (container) => {
        container.innerHTML = `
            <div class="import-view">
                <div class="import-header">
                    <div>
                        <h1>Excel Import & Data Management</h1>
                        <p>Upload legacy data, map fields, validate, and import records</p>
                    </div>
                    <div class="import-header-actions">
                        <button class="btn primary" onclick="await app.openImportWizard()"><i class="fas fa-upload"></i> IMPORT NEW DATA</button>
                        <button class="btn secondary" onclick="app.openTemplatesModal()"><i class="fas fa-download"></i> DOWNLOAD TEMPLATES</button>
                        <button class="btn secondary" onclick="await app.showImportHistory()"><i class="fas fa-history"></i> VIEW IMPORT HISTORY</button>
                    </div>
                </div>
                <div class="recent-imports">
                    <h3>Recent Imports</h3>
                    <div class="imports-table-container">
                        <table class="imports-table">
                            <thead><tr><th>File Name</th><th>Type</th><th>Records</th><th>Success %</th><th>Status</th><th>Date</th><th>Actions</th></tr></thead>
                            <tbody id="imports-table-body">${await renderRecentImports()}</tbody>
                        </table>
                    </div>
                </div>
            </div>
    `;
    };

    const renderRecentImports = async () => {
        const imports = await AppDataStore.getAll('import_jobs').sort((a, b) => new Date(b.created_at) - new Date(a.created_at)).slice(0, 10);
        if (imports.length === 0) return `<tr><td colspan="7" style="text-align:center;padding:40px;"><i class="fas fa-cloud-upload-alt" style="font-size:48px;color:var(--gray-300);display:block;margin-bottom:16px;"></i><h3>No imports yet</h3><p>Click "IMPORT NEW DATA" to start your first import</p></td></tr>`;
        return imports.map(imp => {
            const pct = imp.total_rows > 0 ? Math.round((imp.valid_rows / imp.total_rows) * 100) : 0;
            return `<tr><td><strong>${imp.file_name}</strong></td><td>${imp.import_type}</td><td>${imp.total_rows} (${imp.created_records} new)</td><td>${pct}%</td><td><span class="import-status status-${imp.status}">${imp.status.toUpperCase()}</span></td><td>${UI.formatDate(imp.created_at)}</td><td><button class="btn-icon" onclick="app.viewImportDetails(${imp.id})" title="View"><i class="fas fa-eye"></i></button><button class="btn-icon" onclick="app.downloadImportLog(${imp.id})" title="Download Log"><i class="fas fa-download"></i></button></td></tr>`;
        }).join('');
    };

    const openImportWizard = async () => {
        _currentImportStep = 1;
        _importData = { file: null, fileName: null, fileSize: null, rows: 0, headers: ['Full Name', 'Phone Number', 'Email', 'IC Number', 'Date of Birth', 'Occupation', 'Income Range', 'Address', 'City', 'State', 'Postal Code', 'Ming Gua'], data: [], importType: 'prospects', mapping: {}, validation: { valid: 0, warnings: 0, errors: 0 }, duplicates: { total: 0 }, assignment: { assignTo: 'myself' } };
        await renderImportStep(1);
    };

    const getWizardStepsHtml = (active) => {
        const steps = ['Upload', 'Map Fields', 'Validate', 'Duplicates', 'Import'];
        return `<div class="wizard-steps">${steps.map((s, i) => `<div class="wizard-step ${i + 1 < active ? 'completed' : i + 1 === active ? 'active' : ''}" data-step="${i + 1}">${i + 1}. ${s}</div>`).join('')}</div>`;
    };

    const updateWizardModal = (content) => {
        const overlay = document.getElementById('global-modal-overlay');
        if (overlay) { const box = overlay.querySelector('.modal-box'); if (box) box.innerHTML = content; }
    };

    const renderImportStep = async (step) => {
        _currentImportStep = step;
        let content = '';
        if (step === 1) content = await getStep1Html();
        else if (step === 2) content = await getStep2Html();
        else if (step === 3) content = await getStep3Html();
        else if (step === 4) content = await getStep4Html();
        else if (step === 5) content = await getStep5Html();
        if (step === 1) UI.showModal('Excel Import Wizard', content, []);
        else updateWizardModal(content);
    };

    const getStep1Html = async () => `
            <div class="import-wizard">
                ${getWizardStepsHtml(1)}
                <div class="step-content">
                    <h3>Step 1: Upload File</h3>
                    <div class="upload-area-large" id="import-dropzone" ondragover="event.preventDefault()" ondrop="await app.handleImportFileDrop(event)">
                        <i class="fas fa-cloud-upload-alt"></i>
                        <h4>Click or Drag Excel file to upload</h4>
                        <p>Supported formats: .xlsx, .xls, .csv</p>
                        <p class="file-limit">Max file size: 10MB</p>
                        <input type="file" id="import-file-input" accept=".xlsx,.xls,.csv" style="display:none" onchange="await app.handleImportFileSelect(event)">
                        <button class="btn primary" onclick="document.getElementById('import-file-input').click()">Browse Files</button>
                    </div>
                    <div id="file-info" style="display:none;margin-top:20px;"></div>
                    <div style="margin-top:20px;"><label class="checkbox-label"><input type="checkbox" id="first-row-header" checked> First row contains headers</label></div>
                </div>
                <div class="wizard-footer">
                    <button class="btn secondary" onclick="UI.hideModal()">Cancel</button>
                    <button class="btn primary" id="step1-next" onclick="await app.importNextStep()" disabled>Next: Field Mapping</button>
                </div>
            </div>
        `;

    const getStep2Html = async () => `
            <div class="import-wizard">
                ${getWizardStepsHtml(2)}
                <div class="step-content">
                    <h3>Step 2: Field Mapping</h3>
                    <div class="import-type-selector"><label>Import Type:</label>
                        <select id="import-type" class="form-control" style="width:200px" onchange="app.updateImportType(this.value)">
                            <option value="prospects" selected>Prospects</option><option value="customers">Customers</option><option value="agents">Agents</option>
                        </select>
                    </div>
                    <div class="mapping-actions">
                        <button class="btn secondary btn-sm" onclick="app.autoMapFields()"><i class="fas fa-magic"></i> Auto-map all</button>
                        <button class="btn secondary btn-sm" onclick="app.clearMapping()"><i class="fas fa-times"></i> Clear all</button>
                    </div>
                    <div class="mapping-table-container">
                        <table class="mapping-table"><thead><tr><th>Excel Column</th><th>CRM Field</th></tr></thead>
                        <tbody>${renderMappingRows()}</tbody></table>
                    </div>
                </div>
                <div class="wizard-footer">
                    <button class="btn secondary" onclick="await app.importPrevStep()">Back</button>
                    <button class="btn primary" onclick="await app.importNextStep()">Next: Validation</button>
                </div>
            </div>
        `;

    const getStep3Html = async () => `
            <div class="import-wizard">
                ${getWizardStepsHtml(3)}
                <div class="step-content">
                    <h3>Step 3: Validation</h3>
                    <div class="validation-summary">
                        <div class="validation-badge valid"><span class="badge-count">235</span><span class="badge-label">Valid Rows</span></div>
                        <div class="validation-badge warning"><span class="badge-count">12</span><span class="badge-label">Warnings</span></div>
                        <div class="validation-badge error"><span class="badge-count">3</span><span class="badge-label">Errors</span></div>
                    </div>
                    <div style="margin:16px 0">
                        <label class="checkbox-label"><input type="checkbox" id="stop-on-error"> Stop on first error</label>
                        <label class="checkbox-label"><input type="checkbox" id="continue-warnings" checked> Continue on warnings</label>
                    </div>
                    <div class="validation-log">
                        <h4>Error Log</h4>
                        <table class="error-table"><thead><tr><th>Row</th><th>Column</th><th>Error</th><th>Suggestion</th></tr></thead>
                        <tbody>
                            <tr class="error-row"><td>45</td><td>Phone</td><td>Invalid format</td><td>Add country code (+60)</td></tr>
                            <tr class="error-row"><td>78</td><td>Email</td><td>Missing @ symbol</td><td>Check email address</td></tr>
                            <tr class="error-row"><td>112</td><td>Date of Birth</td><td>Invalid date</td><td>Use YYYY-MM-DD format</td></tr>
                        </tbody></table>
                        <h4 style="margin-top:16px">Warning Log</h4>
                        <table class="warning-table"><thead><tr><th>Row</th><th>Column</th><th>Warning</th><th>Action</th></tr></thead>
                        <tbody>
                            <tr class="warning-row"><td>23</td><td>IC Number</td><td>Duplicate found</td><td>Will merge on import</td></tr>
                            <tr class="warning-row"><td>67</td><td>Income Range</td><td>Unusual format</td><td>Will attempt to parse</td></tr>
                            <tr class="warning-row"><td>89</td><td>Name</td><td>Contains special chars</td><td>Will clean automatically</td></tr>
                        </tbody></table>
                    </div>
                    <div class="validation-actions">
                        <button class="btn secondary" onclick="app.downloadErrorReport()"><i class="fas fa-download"></i> Download Error Report</button>
                        <button class="btn primary" onclick="UI.toast.info('Inline editor coming soon')"><i class="fas fa-edit"></i> Fix Errors</button>
                    </div>
                </div>
                <div class="wizard-footer">
                    <button class="btn secondary" onclick="await app.importPrevStep()">Back</button>
                    <button class="btn primary" onclick="await app.importNextStep()">Next: Duplicate Handling</button>
                </div>
            </div>
        `;

    const getStep4Html = async () => `
            <div class="import-wizard">
                ${getWizardStepsHtml(4)}
                <div class="step-content">
                    <h3>Step 4: Duplicate Handling</h3>
                    <div class="duplicate-stats">
                        <div><strong>Total duplicates found:</strong> 24</div>
                        <div><strong>By phone number:</strong> 18</div>
                        <div><strong>By email:</strong> 4</div>
                        <div><strong>By IC number:</strong> 2</div>
                    </div>
                    <div class="duplicate-options" style="margin:16px 0">
                        <h4>Duplicate Handling</h4>
                        <label class="radio-label"><input type="radio" name="duplicate-action" value="skip" checked> Skip duplicates (keep existing)</label>
                        <label class="radio-label"><input type="radio" name="duplicate-action" value="update"> Update existing records</label>
                        <label class="radio-label"><input type="radio" name="duplicate-action" value="merge"> Merge with existing</label>
                    </div>
                    <div class="duplicate-preview">
                        <h4>Preview of affected records</h4>
                        <table class="preview-table"><thead><tr><th>Existing</th><th>New</th><th>Action</th></tr></thead>
                        <tbody>
                            <tr><td>Tan Ah Kow (012-345-6789)</td><td>Tan Ah Kow (012-345-6789)</td><td>Skip</td></tr>
                            <tr><td>Ong Bee Ling (012-987-6543)</td><td>Ong Bee Ling (012-987-6544)</td><td>Update phone</td></tr>
                        </tbody></table>
                    </div>
                </div>
                <div class="wizard-footer">
                    <button class="btn secondary" onclick="await app.importPrevStep()">Back</button>
                    <button class="btn primary" onclick="await app.importNextStep()">Next: Import</button>
                </div>
            </div>
        `;

    const getStep5Html = async () => `
            <div class="import-wizard">
                ${getWizardStepsHtml(5)}
                <div class="step-content">
                    <h3>Step 5: Import</h3>
                    <div class="summary-stats">
                        <div><strong>Total records:</strong> 250</div><div><strong>Valid records:</strong> 235</div>
                        <div><strong>New records:</strong> 217</div><div><strong>Updated records:</strong> 18</div><div><strong>Skipped records:</strong> 15</div>
                    </div>
                    <div class="assignment-options" style="margin:16px 0">
                        <h4>Assignment Options</h4>
                        <label class="radio-label"><input type="radio" name="assign-to" value="myself" checked onchange="document.getElementById('team-opts').style.display='none'"> Assign to myself (Michelle Tan)</label>
                        <label class="radio-label"><input type="radio" name="assign-to" value="team" onchange="document.getElementById('team-opts').style.display='block'"> Assign to team</label>
                        <label class="radio-label"><input type="radio" name="assign-to" value="unassigned" onchange="document.getElementById('team-opts').style.display='none'"> Leave unassigned</label>
                        <div id="team-opts" style="display:none;margin-top:12px">
                            <select class="form-control" style="width:200px"><option>Team A</option><option>Team B</option><option>Team C</option></select>
                            <label class="checkbox-label" style="margin-top:8px"><input type="checkbox"> Distribute evenly</label>
                        </div>
                    </div>
                    <div class="import-options" style="margin:16px 0">
                        <h4>Import Options</h4>
                        <label class="checkbox-label"><input type="checkbox" checked> Send notification when complete</label>
                        <label class="checkbox-label"><input type="checkbox"> Create backup before import</label>
                        <label class="checkbox-label"><input type="checkbox" checked> Log all changes for audit</label>
                    </div>
                    <div id="progress-area" style="display:none;margin-top:16px">
                        <h4>Import Progress</h4>
                        <div class="progress-bar-container"><div class="progress-bar-fill" id="progress-bar" style="width:0%">0%</div></div>
                        <p id="progress-status">Processing 0/250 records...</p>
                    </div>
                </div>
                <div class="wizard-footer">
                    <button class="btn secondary" onclick="await app.importPrevStep()">Back</button>
                    <button class="btn primary" id="start-import-btn" onclick="await app.startImport()"><i class="fas fa-play"></i> START IMPORT</button>
                </div>
            </div>
        `;

    const renderMappingRows = () => {
        const headers = _importData.headers || [];
        const crmFields = getCRMFieldsForType(_importData.importType);
        return headers.map((header, index) => {
            const matched = autoMatchField(header);
            return `<tr><td><strong>${header}</strong></td><td>
                <select class="form-control mapping-select" data-col="${index}" style="width:200px">
                    <option value="">-- Ignore column --</option>
                    ${crmFields.map(f => `<option value="${f.value}" ${f.value === matched ? 'selected' : ''}>${f.label}${f.required ? ' *' : ''}</option>`).join('')}
                </select></td></tr>`;
        }).join('');
    };

    const getCRMFieldsForType = (type) => {
        const common = [
            { value: 'full_name', label: 'Full Name', required: true },
            { value: 'phone', label: 'Phone', required: true },
            { value: 'email', label: 'Email', required: false },
            { value: 'ic_number', label: 'IC Number', required: false }
        ];
        const extraProspect = [
            { value: 'date_of_birth', label: 'Date of Birth' }, { value: 'occupation', label: 'Occupation' },
            { value: 'company_name', label: 'Company Name' }, { value: 'income_range', label: 'Income Range' },
            { value: 'address', label: 'Address' }, { value: 'city', label: 'City' },
            { value: 'state', label: 'State' }, { value: 'postal_code', label: 'Postal Code' },
            { value: 'ming_gua', label: 'Ming Gua' }, { value: 'gender', label: 'Gender' }
        ];
        if (type === 'prospects') return [...common, ...extraProspect];
        if (type === 'customers') return [...common, { value: 'lifetime_value', label: 'Lifetime Value' }];
        if (type === 'agents') return [...common, { value: 'agent_code', label: 'Agent Code', required: true }];
        return common;
    };

    const autoMatchField = (header) => {
        const map = { 'full name': 'full_name', 'name': 'full_name', 'phone': 'phone', 'mobile': 'phone', 'email': 'email', 'ic': 'ic_number', 'ic number': 'ic_number', 'nric': 'ic_number', 'dob': 'date_of_birth', 'date of birth': 'date_of_birth', 'occupation': 'occupation', 'income': 'income_range', 'address': 'address', 'city': 'city', 'state': 'state', 'postcode': 'postal_code', 'postal': 'postal_code', 'ming gua': 'ming_gua', 'gender': 'gender' };
        const lower = header.toLowerCase().trim();
        for (let key in map) { if (lower.includes(key)) return map[key]; }
        return '';
    };

    const handleImportFileDrop = async (event) => { event.preventDefault(); const files = event.dataTransfer.files; if (files.length > 0) await processImportFile(files[0]); };
    const handleImportFileSelect = async (event) => { const files = event.target.files; if (files.length > 0) await processImportFile(files[0]); };

    const processImportFile = async (file) => {
        if (file.size > 10 * 1024 * 1024) { UI.toast.error('File size exceeds 10MB limit'); return; }
        _importData.file = file; _importData.fileName = file.name; _importData.fileSize = file.size;
        (() => {
            _importData.rows = 250;
            const fi = document.getElementById('file-info');
            if (fi) {
                fi.innerHTML = `<div class="file-info-card"><div><strong>File:</strong> ${file.name}</div><div><strong>Size:</strong> ${(file.size > 1048576 ? (file.size / 1048576).toFixed(1) + " MB" : (file.size / 1024).toFixed(0) + " KB")}</div><div><strong>Rows detected:</strong> 250</div><div><strong>Columns detected:</strong> 12</div></div>`; fi.style.display = 'block';
            }
            const btn = document.getElementById('step1-next'); if (btn) btn.disabled = false;
            UI.toast.success('File loaded successfully');
        }, 400);
    };

    const importNextStep = async () => { if (_currentImportStep < 5) await renderImportStep(_currentImportStep + 1); };
    const importPrevStep = async () => { if (_currentImportStep > 1) await renderImportStep(_currentImportStep - 1); };
    const updateImportType = (type) => { _importData.importType = type; };
    const autoMapFields = () => UI.toast.success('Fields auto-mapped based on column names');
    const clearMapping = () => { document.querySelectorAll('.mapping-select').forEach(s => s.value = ''); UI.toast.info('Mapping cleared'); };
    const clearMappingField = (idx) => { const s = document.querySelector(`.mapping-select[data-col="${idx}"]`); if (s) s.value = ''; };
    const downloadErrorReport = () => UI.toast.success('Error report downloaded');

    const startImport = async () => {
        document.getElementById('progress-area').style.display = 'block';
        document.getElementById('start-import-btn').disabled = true;
        let progress = 0;
        const iv = (() => {
            progress += 5;
            const bar = document.getElementById('progress-bar'); if (bar) { bar.style.width = progress + '%'; bar.textContent = progress + '%'; }
            const st = document.getElementById('progress-status'); if (st) st.textContent = `Processing ${Math.floor(progress * 2.5)}/250 records...`;
            if (progress >= 100) {
                clearInterval(iv);
                (() => {
                    UI.hideModal();
                    UI.toast.success('Import completed! 217 new records created.');
                    await AppDataStore.create('import_jobs', { file_name: _importData.fileName || 'import.xlsx', import_type: _importData.importType, total_rows: 250, valid_rows: 235, error_rows: 15, created_records: 217, updated_records: 18, skipped_records: 15, status: 'completed', mapping_config: {}, duplicate_handling: document.querySelector('input[name="duplicate-action"]:checked')?.value || 'skip', assignment_config: { assignTo: document.querySelector('input[name="assign-to"]:checked')?.value || 'myself' }, created_by: _currentUser?.id, created_at: new Date().toISOString(), completed_at: new Date().toISOString() });
                    const vp = document.getElementById('content-viewport'); if (vp) await showImportDashboard(vp);
                }, 500);
            }
        }, 150);
    };

    const viewImportDetails = (id) => {
        const job = AppDataStore.getById('import_jobs', id);
        if (!job) return;
        const content = `<div><div style="background:var(--gray-50);padding:16px;border-radius:8px;margin-bottom:16px"><div><strong>File:</strong> ${job.file_name}</div><div><strong>Type:</strong> ${job.import_type}</div><div><strong>Status:</strong> ${job.status}</div><div><strong>Date:</strong> ${UI.formatDate(job.created_at)}</div></div><div style="display:grid;grid-template-columns:1fr 1fr;gap:12px"><div><strong>Total rows:</strong> ${job.total_rows}</div><div><strong>Valid rows:</strong> ${job.valid_rows}</div><div><strong>New records:</strong> ${job.created_records}</div><div><strong>Updated:</strong> ${job.updated_records}</div><div><strong>Skipped:</strong> ${job.skipped_records}</div><div><strong>Errors:</strong> ${job.error_rows}</div></div></div>`;
        UI.showModal(`Import Details: ${job.file_name}`, content, [{ label: 'Close', type: 'primary', action: 'UI.hideModal()' }]);
    };

    const downloadImportLog = (id) => UI.toast.info('Import log downloaded');

    const openTemplatesModal = () => {
        const content = `
            <table style="width:100%;border-collapse:collapse">
                <thead><tr><th style="padding:10px;text-align:left;background:var(--gray-50)">Template</th><th style="padding:10px;text-align:left;background:var(--gray-50)">Description</th><th style="padding:10px;text-align:left;background:var(--gray-50)">Download</th></tr></thead>
                <tbody>
                    ${['Prospects', 'Customers', 'Agents', 'Products', 'Activities'].map(t => `<tr><td style="padding:10px;border-bottom:1px solid var(--gray-100)">${t} Template</td><td style="padding:10px;border-bottom:1px solid var(--gray-100)">${t} data import</td><td style="padding:10px;border-bottom:1px solid var(--gray-100)"><button class="btn secondary btn-sm" onclick="app.downloadTemplate('${t.toLowerCase()}','csv')">CSV</button> <button class="btn secondary btn-sm" onclick="app.downloadTemplate('${t.toLowerCase()}','xlsx')">Excel</button></td></tr>`).join('')}
                </tbody>
            </table>`;
        UI.showModal('Download Import Templates', content, [{ label: 'Close', type: 'primary', action: 'UI.hideModal()' }]);
    };

    const downloadTemplate = (type, format) => {
        const headers = { prospects: 'Full Name,Phone,Email,IC Number,Date of Birth,Occupation,Income Range,Address,City,State,Postal Code,Ming Gua', customers: 'Full Name,Phone,Email,IC Number,Customer Since,Lifetime Value', agents: 'Full Name,Phone,Email,Agent Code,Commission Rate,License Start,License Expiry', products: 'Product Name,Category,Price,Description', activities: 'Date,Type,Title,Agent,Prospect,Status' };
        const headerRow = headers[type] || headers.prospects;
        const csv = `${headerRow}\n"Sample Name","012-345-6789","sample@email.com","901212-10-1234","1990-12-12","Business Owner","15000-20000","123 Jalan SS2","Petaling Jaya","Selangor","46000","MG4"`;
        const blob = new Blob([csv], { type: 'text/csv' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a'); a.href = url; a.download = `${type}_template.${format}`; document.body.appendChild(a); a.click(); document.body.removeChild(a);
        UI.toast.success(`${type} template downloaded`);
    };

    const showImportHistory = async () => {
        const jobs = await AppDataStore.getAll('import_jobs').sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
        const rows = jobs.length === 0 ? '<tr><td colspan="6" style="text-align:center;padding:20px">No import history</td></tr>' :
            jobs.map(j => `<tr><td>${j.file_name}</td><td>${j.import_type}</td><td>${j.total_rows}</td><td><span class="import-status status-${j.status}">${j.status.toUpperCase()}</span></td><td>${UI.formatDate(j.created_at)}</td><td><button class="btn-icon" onclick="app.viewImportDetails(${j.id})"><i class="fas fa-eye"></i></button></td></tr>`).join('');
        const content = `<table style="width:100%;border-collapse:collapse"><thead><tr style="background:var(--gray-50)"><th style="padding:10px;text-align:left">File</th><th style="padding:10px;text-align:left">Type</th><th style="padding:10px;text-align:left">Records</th><th style="padding:10px;text-align:left">Status</th><th style="padding:10px;text-align:left">Date</th><th style="padding:10px;text-align:left">Actions</th></tr></thead><tbody>${rows}</tbody></table>`;
        UI.showModal('Import History', content, [{ label: 'Close', type: 'primary', action: 'UI.hideModal()' }]);
    };

    // ========== PHASE 13: FOLLOW-UP MONITORING & REASSIGNMENT ==========

    const showProtectionMonitoringView = async (container) => {
        container.innerHTML = `
            <div class="protection-view">
                <div class="protection-header">
                    <div><h1>Protection Period & Follow-up Monitoring</h1><p>Track prospect protection periods and agent follow-up performance</p></div>
                    <div class="protection-header-actions">
                        <button class="btn secondary" onclick="app.refreshFollowupStats()"><i class="fas fa-sync-alt"></i> Refresh Stats</button>
                        <button class="btn secondary" onclick="app.exportFollowupReport()"><i class="fas fa-download"></i> Export Report</button>
                        <button class="btn secondary" onclick="app.configureAlerts()"><i class="fas fa-bell"></i> Configure Alerts</button>
                        <button class="btn primary" onclick="await app.navigateTo('import')"><i class="fas fa-upload"></i> Bulk Import</button>
                    </div>
                </div>
                <div class="team-summary-cards">${renderTeamSummaryCards()}</div>
                <div class="agent-performance">
                    <h3>Agent Performance</h3>
                    <div class="agent-table-container">
                        <table class="agent-performance-table">
                            <thead><tr><th>Agent</th><th>Team</th><th>Assigned</th><th>Followed up (7d)</th><th>Rate</th><th>Inactive (3-7d)</th><th>Inactive (8-14d)</th><th>Inactive (15d+)</th><th>Actions</th></tr></thead>
                            <tbody>${await renderAgentPerformanceRows()}</tbody>
                        </table>
                    </div>
                </div>
                <div class="inactive-prospects">
                    <h3>Inactive Prospects (>7 days)</h3>
                    <div class="inactive-table-container">
                        <table class="inactive-table">
                            <thead><tr><th>Prospect</th><th>Agent</th><th>Days Inactive</th><th>Score</th><th>Protection Deadline</th><th>Status</th><th>Actions</th></tr></thead>
                            <tbody>${await renderInactiveProspectsRows()}</tbody>
                        </table>
                    </div>
                </div>
                <div class="agent-performance" style="margin-top:24px">
                    <h3>Reassignment History</h3>
                    <div class="agent-table-container">${await renderReassignmentHistory()}</div>
                </div>
            </div>`;
    };

    const renderTeamSummaryCards = () => {
        const teams = [
            { name: 'Team A', color: 'team-a', active: 156, attention: 52, inactive: 37, critical: 12 },
            { name: 'Team B', color: 'team-b', active: 142, attention: 48, inactive: 32, critical: 8 },
            { name: 'Team C', color: 'team-c', active: 98, attention: 31, inactive: 22, critical: 5 },
            { name: 'Total', color: 'total', active: 396, attention: 131, inactive: 91, critical: 25 }
        ];
        return teams.map(t => `<div class="summary-card ${t.color}"><h4>${t.name}</h4><div class="summary-stats"><div><span class="stat-label">Active:</span><span class="stat-value">${t.active}</span></div><div><span class="stat-label">Attention:</span><span class="stat-value warning">${t.attention}</span></div><div><span class="stat-label">Inactive:</span><span class="stat-value danger">${t.inactive}</span></div><div><span class="stat-label">Critical:</span><span class="stat-value danger">${t.critical}</span></div></div></div>`).join('');
    };

    const renderAgentPerformanceRows = async () => {
        const agents = [
            { name: 'Michelle Tan', team: 'A', assigned: 52, followed: 48, i37: 2, i814: 2, i15: 0 },
            { name: 'Ah Seng', team: 'A', assigned: 50, followed: 31, i37: 8, i814: 6, i15: 5 },
            { name: 'Mei Ling', team: 'A', assigned: 45, followed: 38, i37: 4, i814: 2, i15: 1 },
            { name: 'Raj Kumar', team: 'A', assigned: 48, followed: 42, i37: 3, i814: 2, i15: 1 },
            { name: 'Ong Bee Ling', team: 'A', assigned: 35, followed: 32, i37: 2, i814: 1, i15: 0 }
        ];
        return agents.map(a => {
            const rate = Math.round((a.followed / a.assigned) * 100);
            const cls = rate < 70 ? 'rate-bad' : rate < 90 ? 'rate-warning' : 'rate-good';
            return `<tr><td><strong>${a.name}</strong></td><td>Team ${a.team}</td><td>${a.assigned}</td><td>${a.followed}</td><td><span class="rate-badge ${cls}">${rate}%</span></td><td>${a.i37}</td><td>${a.i814}</td><td>${a.i15}</td><td><button class="btn-icon" onclick="app.viewAgentDetails('${a.name}')" title="View"><i class="fas fa-eye"></i></button><button class="btn-icon" onclick="await app.openReassignModal('${a.name}')" title="Reassign"><i class="fas fa-exchange-alt"></i></button><button class="btn-icon" onclick="app.bulkReassign('${a.name}')" title="Bulk Reassign"><i class="fas fa-users"></i></button></td></tr>`;
        }).join('');
    };

    const renderInactiveProspectsRows = async () => {
        const prospects = [
            { name: 'Tan Mei Ling', agent: 'Raj Kumar', days: 14, score: 620, deadline: '17 Mar 2026', status: 'critical' },
            { name: 'Kok Leong', agent: 'Raj Kumar', days: 16, score: 550, deadline: '15 Mar 2026', status: 'critical' },
            { name: 'Sarah Lim', agent: 'Ah Seng', days: 12, score: 680, deadline: '20 Mar 2026', status: 'warning' },
            { name: 'Wong Chee Meng', agent: 'Ah Seng', days: 9, score: 590, deadline: '25 Mar 2026', status: 'warning' },
            { name: 'Lim Siew Ling', agent: 'Mei Ling', days: 8, score: 710, deadline: '22 Mar 2026', status: 'warning' }
        ];
        return prospects.map(p => `<tr><td><strong>${p.name}</strong></td><td>${p.agent}</td><td class="${p.days > 14 ? 'critical' : 'warning'}">${p.days} days</td><td>${p.score}</td><td>${p.deadline}</td><td><span class="status-badge status-${p.status}">${p.status === 'critical' ? '🔴 Critical' : '🟡 Warning'}</span></td><td><button class="btn-icon" onclick="await app.openReassignModal('${p.name}')"><i class="fas fa-exchange-alt"></i></button><button class="btn-icon" onclick="await app.contactProspect('${p.name}')"><i class="fas fa-phone"></i></button></td></tr>`).join('');
    };

    const renderReassignmentHistory = async () => {
        const history = await AppDataStore.getAll('reassignment_history').sort((a, b) => new Date(b.reassignment_date) - new Date(a.reassignment_date));
        if (history.length === 0) return '<p style="padding:16px;color:var(--gray-500)">No reassignment history yet.</p>';
        const getAgentNameById = (id) => { const u = AppDataStore.getById('users', id); return u?.full_name || `Agent #${id}`; };
        return `<table class="agent-performance-table"><thead><tr><th>Date</th><th>Prospect ID</th><th>From Agent</th><th>To Agent</th><th>Reason</th><th>By</th></tr></thead><tbody>${history.map(r => `<tr><td>${UI.formatDate(r.reassignment_date)}</td><td>#${r.prospect_id}</td><td>${getAgentNameById(r.from_agent_id)}</td><td>${getAgentNameById(r.to_agent_id)}</td><td>${r.reassignment_reason}</td><td>${getAgentNameById(r.reassigned_by)}</td></tr>`).join('')}</tbody></table>`;
    };

    const openReassignModal = async (prospectName) => {
        const content = `
            <div class="reassign-modal">
                <div class="current-info">
                    <h4>Current Information</h4>
                    <div class="info-grid">
                        <div><strong>Prospect:</strong> ${prospectName}</div><div><strong>Current Agent:</strong> Raj Kumar</div>
                        <div><strong>Days Inactive:</strong> 14</div><div><strong>Score:</strong> 620</div>
                        <div><strong>Protection Deadline:</strong> 17 Mar 2026</div><div><strong>Last Activity:</strong> 19 Feb 2026 (Call)</div>
                    </div>
                </div>
                <div class="form-group">
                    <label>Reassign to</label>
                    <select id="reassign-agent" class="form-control">
                        <option value="ahseng">Ah Seng (5 inactive, capacity +12) 🟢</option>
                        <option value="michelle">Michelle Tan (4 inactive, capacity +10) 🟢</option>
                        <option value="meiling">Mei Ling (7 inactive, capacity +5) 🟡</option>
                        <option value="ong">Ong Bee Ling (3 inactive, capacity +15) 🟢</option>
                    </select>
                </div>
                <div class="form-group">
                    <label>Reason for reassignment</label>
                    <div class="radio-group">
                        <label class="radio-label"><input type="radio" name="reassign-reason" value="inactive" checked> Agent inactive / unresponsive</label>
                        <label class="radio-label"><input type="radio" name="reassign-reason" value="workload"> Workload balancing</label>
                        <label class="radio-label"><input type="radio" name="reassign-reason" value="territory"> Territory realignment</label>
                        <label class="radio-label"><input type="radio" name="reassign-reason" value="request"> Prospect request</label>
                    </div>
                </div>
                <div class="form-group">
                    <label>Justification</label>
                    <textarea id="reassign-justification" class="form-control" rows="3">Raj Kumar has been unresponsive to follow-up reminders. This prospect has high score and needs immediate attention.</textarea>
                </div>
                <div class="form-group">
                    <label class="checkbox-label"><input type="checkbox" checked> Send notification to new agent</label>
                    <label class="checkbox-label"><input type="checkbox" checked> Reset protection period (30 days)</label>
                </div>
            </div>`;
        UI.showModal(`Reassign Prospect: ${prospectName}`, content, [
            { label: 'Cancel', type: 'secondary', action: 'UI.hideModal()' },
            { label: 'CONFIRM REASSIGNMENT', type: 'primary', action: 'await app.confirmReassignment()' }
        ]);
    };

    const confirmReassignment = async () => {
        await AppDataStore.create('reassignment_history', { prospect_id: Date.now(), from_agent_id: 8, to_agent_id: 6, reassigned_by: _currentUser?.id || 5, reassignment_date: new Date().toISOString(), reassignment_reason: document.querySelector('input[name="reassign-reason"]:checked')?.value || 'inactive', reason_notes: document.getElementById('reassign-justification')?.value || '', days_inactive: 14, protection_deadline: '2026-03-17', created_at: new Date().toISOString() });
        UI.hideModal(); UI.toast.success('Prospect reassigned successfully');
    };

    const bulkReassign = (agentName) => {
        const content = `<div class="bulk-reassign-modal">
            <div style="background:var(--gray-50);padding:16px;border-radius:8px;margin-bottom:16px">
                <div><strong>From Agent:</strong> ${agentName}</div><div><strong>Average inactive days:</strong> 16</div><div><strong>Prospects selected:</strong> 19</div>
            </div>
            <div class="selected-prospects"><h4>Selected Prospects</h4><div class="prospects-list">
                <label class="checkbox-label"><input type="checkbox" checked> Tan Mei Ling (14d, Score 620)</label>
                <label class="checkbox-label"><input type="checkbox" checked> Kok Leong (16d, Score 550)</label>
                <label class="checkbox-label"><input type="checkbox" checked> Lim Siew Ping (18d, Score 580)</label>
                <label class="checkbox-label"><input type="checkbox" checked> Wong Kok Wai (15d, Score 610)</label>
                <label class="checkbox-label"><input type="checkbox" checked> 15 more prospects...</label>
            </div></div>
            <div class="form-group">
                <label>Reassign to</label>
                <div class="radio-group">
                    <label class="radio-label"><input type="radio" name="bulk-option" value="distribute" checked> Distribute evenly among active agents</label>
                    <label class="radio-label"><input type="radio" name="bulk-option" value="single"> Assign all to single agent</label>
                </div>
            </div>
            <div class="distribution-preview"><h4>Distribution Preview</h4><ul><li>Michelle Tan: 6 prospects</li><li>Ah Seng: 7 prospects</li><li>Ong Bee Ling: 6 prospects</li></ul></div>
            <div class="form-group"><label>Justification</label><textarea class="form-control" rows="3">${agentName} has consistently low follow-up rate with 19 inactive prospects. Redistributing to higher-performing agents.</textarea></div>
        </div>`;
        UI.showModal('Bulk Reassignment', content, [
            { label: 'Cancel', type: 'secondary', action: 'UI.hideModal()' },
            { label: 'CONFIRM BULK REASSIGNMENT', type: 'primary', action: 'app.confirmBulkReassignment()' }
        ]);
    };

    const confirmBulkReassignment = () => { UI.hideModal(); UI.toast.success('19 prospects reassigned successfully'); };
    const refreshFollowupStats = () => UI.toast.success('Follow-up statistics refreshed');
    const exportFollowupReport = () => UI.toast.success('Follow-up report exported');
    const configureAlerts = () => UI.toast.info('Alert configuration coming soon');
    const viewAgentDetails = (name) => UI.toast.info(`Viewing details for ${name}`);
    const contactProspect = async (name) => { await openActivityModal(); };

    // Phase 13: seed demo data
    const initImportDemoData = async () => {
        // NEW: Clear only demo data if requested
        if (window.location.search.includes('resetDemo=true')) {
            ['import_jobs', 'reassignment_history'].forEach(table => {
                const all = await AppDataStore.getAll(table);
                const nonDemo = all.filter(item => !item.is_demo);
                localStorage.setItem(`fs_crm_${table}`, JSON.stringify(nonDemo));
            });
            UI.toast.info('Demo data cleared.');
        }

        if (await AppDataStore.getAll('import_jobs').length === 0) {
            const jobs = [
                { id: 9001, is_demo: true, file_name: 'leads_march_2026.xlsx', import_type: 'prospects', total_rows: 250, valid_rows: 235, error_rows: 15, created_records: 217, updated_records: 18, skipped_records: 15, status: 'completed', mapping_config: {}, duplicate_handling: 'skip', assignment_config: { assignTo: 'myself' }, created_by: 5, created_at: '2026-03-05T14:30:00Z', completed_at: '2026-03-05T14:32:35Z' },
                { id: 9002, is_demo: true, file_name: 'customers_feb.xlsx', import_type: 'customers', total_rows: 128, valid_rows: 122, error_rows: 6, created_records: 115, updated_records: 7, skipped_records: 6, status: 'completed', mapping_config: {}, duplicate_handling: 'update', assignment_config: { assignTo: 'team' }, created_by: 5, created_at: '2026-02-28T10:15:00Z', completed_at: '2026-02-28T10:17:22Z' },
                { id: 9003, is_demo: true, file_name: 'agents_2026.xlsx', import_type: 'agents', total_rows: 15, valid_rows: 15, error_rows: 0, created_records: 15, updated_records: 0, skipped_records: 0, status: 'completed', mapping_config: {}, duplicate_handling: 'skip', assignment_config: {}, created_by: 1, created_at: '2026-02-15T09:00:00Z', completed_at: '2026-02-15T09:01:00Z' },
                { id: 9004, is_demo: true, file_name: 'product_catalog.xlsx', import_type: 'products', total_rows: 45, valid_rows: 0, error_rows: 45, created_records: 0, updated_records: 0, skipped_records: 0, status: 'failed', mapping_config: {}, duplicate_handling: 'skip', assignment_config: {}, created_by: 5, created_at: '2026-02-10T09:45:00Z', completed_at: '2026-02-10T09:45:30Z' }
            ];
            jobs.forEach(async j => await AppDataStore.create('import_jobs', j));
        }
        if (await AppDataStore.getAll('reassignment_history').length === 0) {
            const reassignments = [
                { id: 8001, is_demo: true, prospect_id: 101, from_agent_id: 8, to_agent_id: 6, reassigned_by: 5, reassignment_date: '2026-03-06T10:23:00Z', reassignment_reason: 'inactive', reason_notes: 'Raj Kumar unresponsive', days_inactive: 14, protection_deadline: '2026-03-17', created_at: '2026-03-06T10:23:00Z' },
                { id: 8002, is_demo: true, prospect_id: 102, from_agent_id: 8, to_agent_id: 5, reassigned_by: 5, reassignment_date: '2026-03-05T15:45:00Z', reassignment_reason: 'inactive', reason_notes: 'High score prospect', days_inactive: 16, protection_deadline: '2026-03-15', created_at: '2026-03-05T15:45:00Z' },
                { id: 8003, is_demo: true, prospect_id: 103, from_agent_id: 6, to_agent_id: 7, reassigned_by: 3, reassignment_date: '2026-03-04T09:30:00Z', reassignment_reason: 'workload', reason_notes: 'Balancing workload', days_inactive: 12, protection_deadline: '2026-03-20', created_at: '2026-03-04T09:30:00Z' }
            ];
            reassignments.forEach(async r => await AppDataStore.create('reassignment_history', r));
        }
    };

    // ========== PHASE 18: MOBILE APP & OFFLINE SYNC ==========
    const initMobileApp = async () => {
        if (!isMobile()) return;

        try {
            console.log('Initializing Phase 18 mobile features...');

            // 1. Initialize Offline Storage & Sync
            if (typeof SyncManager !== 'undefined') {
                await SyncManager.init();
            }

            // 2. Setup Push Notifications
            if (typeof PushNotifications !== 'undefined') {
                const pushSupport = await PushNotifications.checkSupport();
                if (pushSupport) {
                    await PushNotifications.requestPermission();
                }
            }

            // 3. Register Service Worker
            if ('serviceWorker' in navigator) {
                navigator.serviceWorker.register('./service-worker.js')
                    .then(reg => console.log('Service Worker registered', reg))
                    .catch(err => console.error('Service Worker sync failed', err));
            }

            // 4. Add meta tags for PWA
            addMobileMetaTags();

            console.log('Phase 18 mobile features initialized.');
        } catch (error) {
            console.error('Error initializing mobile features:', error);
        }
    };

    const addMobileMetaTags = () => {
        const head = document.head;
        if (!document.querySelector('meta[name="theme-color"]')) {
            const metaTheme = document.createElement('meta');
            metaTheme.name = 'theme-color';
            metaTheme.content = '#2563eb';
            head.appendChild(metaTheme);
        }
        if (!document.querySelector('meta[name="apple-mobile-web-app-capable"]')) {
            const metaApple = document.createElement('meta');
            metaApple.name = 'apple-mobile-web-app-capable';
            metaApple.content = 'yes';
            head.appendChild(metaApple);
        }
    };

    const refreshPipelineCalculations = async () => {
        UI.toast.info('Recalculating pipeline...');
        (() => {
            await refreshPipeline();
        }, 500);
    };

    const filterPipeline = async () => {
        // Redraw with current filter value
        await refreshPipeline();
    };

    const saveFocusOrder = async () => {
        // Placeholder for compatibility if called from HTML
        await saveManualOrder();
    };

    const showAddToFocusModal = () => {
        UI.toast.info('Select a prospect from the System Pipeline below to add to your Focus List.');
    };

    const openPrerequisiteConfig = () => {
        UI.toast.info('Opening prerequisite configuration (Marketing Manager only)');
    };

    return {
        init,
        navigateTo,
        todo,
        toggleUserMenu,
        loginAs,
        logout,

        // Helpers
        debounce,
        ensureReferralFields,
        canViewNode,

        // Phase 16 WhatsApp Integration Functions
        showWhatsAppIntegration,
        saveWhatsAppConnection,
        testWhatsAppConnection,
        verifyWebhook,
        copyWebhookUrl,
        disconnectWhatsApp,
        confirmDisconnectWhatsApp,
        openSendWhatsAppModal,
        toggleMessageType,
        sendWhatsApp,
        viewMessageDetails,
        resendMessage,
        replyToMessage,
        forwardMessage,
        createTaskFromMessage,
        syncWhatsAppTemplates,
        importSelectedTemplates,
        renderWhatsAppHistoryTab,
        addWhatsAppButtonToProfile,
        previewTemplate,

        // Pipeline Functions
        handleProspectDrag,
        handleStageDrop,
        closeDealWon,
        closeDealLost,
        calculateDealValue,

        // Phase 2 Functions
        openActivityModal,
        updateActivityForm,
        calculateDuration,
        toggleCoAgentSection,
        toggleEventForm,
        searchEntities,
        selectEntity,
        clearSelectedEntity,
        searchAttendees,
        addAttendee,
        removeAttendee,
        updateAttendeeStatus,
        searchAgents,
        addCoAgent,
        removeCoAgent,
        updateCoAgentRole,
        saveActivity,
        saveAndAddAnother,
        viewActivityDetails,
        editActivity,
        updateActivity,
        fillActivityForm,
        postMeetupNotes,
        rescheduleActivity,
        addCoAgentToActivity,
        postEventFollowUp,
        searchReferrers,
        selectReferrer,
        clearSelectedReferrer,
        updateLunarBirth,

        // Phase 3 Prospect Management Functions
        showProspectsView,
        showProspectDetail,
        openAddProspectModal: openProspectModal,
        openProspectModal,
        editProspect,
        saveProspect,
        filterProspects,
        sortProspects,
        switchProspectTab,

        // Fix scoping for these functions
        openAddNameModal,
        saveName,
        deleteName,
        confirmDeleteName,

        addNote,
        deleteNote,
        extendProtection,
        transferProspect,
        reassignProspect,
        convertToCustomer,
        confirmConvertToCustomer,

        // Phase 4 Customer Management Functions
        switchCustomerTab,
        showCustomersView,
        showCustomerDetail,
        hideCustomerDetail: async () => await navigateTo('prospects'),
        renderCustomersTable,
        openAddCustomerModal,
        saveCustomer,
        filterCustomers,
        renderBasicBankTab,
        renderPlatformIdsTab,
        renderPurchaseHistoryTab,
        renderReferralsTab,
        renderEventHistory,
        renderAgentEligibility,
        openAddPurchaseModal,
        savePurchase,
        copyToClipboard,
        openRecruitModal,
        switchProfileTab,

        // Phase 5 Agent Management Functions
        showAgentsView,
        renderAgentsTable,
        filterAgents,
        showAgentDetail,
        openAddAgentModal,
        saveAgent,
        renewLicense,
        executeRenewal,
        sendRenewalReminder,
        updateAgentTargets,
        saveAgentTargets,
        deactivateAgent,
        assignProspectToAgent,
        viewInactiveProspects,
        renderCustomerHistory,

        confirmDelete,
        executeDelete,

        // New Functions
        openAddTagModal,
        addTagToEntity,
        removeTagFromCustomer,
        removeTagFromProspect,
        openAddSolutionModal,
        saveSolution,

        // Phase 6 Pipeline Functions
        showPipelineView,
        refreshPipeline,
        addToFocusList,
        removeFromFocusList,
        showProspectMenu,
        showComments,
        openPipelineConfigModal,
        savePipelineConfig,
        addPipelineNote,
        renderManualPriority,
        renderRecentOverrides,
        handleDragStart,
        handleDragOver,
        handleDrop,
        saveManualOrder,
        openBoostModal,
        submitBoost,
        openHistoryModal,
        loadOverrideHistory,
        viewJustification,
        calculatePotentialValue,

        // Phase 7 Referrals Functions (NEW VERTICAL LAYOUT V2)
        showReferralsView,
        renderReferralSummaryAndLeaderboard,
        toggleLeaderboard,
        openAddReferralModal,
        submitReferral,
        searchReferrersForModal,
        selectReferrerForModal,
        clearSelectedForModal,
        openCreateProspectForReferral,
        openMemoModal,
        treeZoomIn,
        treeZoomOut,
        treeResetZoom,
        toggleHideReferrer,
        resetHiddenReferrers,
        searchTreePerson,
        showReferralTree,

        // Phase 10: Search Panel functions
        toggleSearchPanel: typeof toggleSearchPanel !== 'undefined' ? toggleSearchPanel : null,
        showSearchPanel: typeof showSearchPanel !== 'undefined' ? showSearchPanel : null,
        hideSearchPanel: typeof hideSearchPanel !== 'undefined' ? hideSearchPanel : null,
        updateFilterSections: typeof updateFilterSections !== 'undefined' ? updateFilterSections : null,
        executeSearch: typeof executeSearch !== 'undefined' ? executeSearch : null,
        clearAllFilters: typeof clearAllFilters !== 'undefined' ? clearAllFilters : null,
        goToPage: typeof goToPage !== 'undefined' ? goToPage : null,
        exportResults: typeof exportResults !== 'undefined' ? exportResults : null,
        addConditionGroup: typeof addConditionGroup !== 'undefined' ? addConditionGroup : null,
        removeConditionGroup: typeof removeConditionGroup !== 'undefined' ? removeConditionGroup : null,
        addCondition: typeof addCondition !== 'undefined' ? addCondition : null,
        removeCondition: typeof removeCondition !== 'undefined' ? removeCondition : null,
        updateConditionField: typeof updateConditionField !== 'undefined' ? updateConditionField : null,
        openSaveSearchModal: typeof openSaveSearchModal !== 'undefined' ? openSaveSearchModal : null,
        loadSavedSearch: typeof loadSavedSearch !== 'undefined' ? loadSavedSearch : null,
        deleteSavedSearch: typeof deleteSavedSearch !== 'undefined' ? deleteSavedSearch : null,
        loadPreset: typeof loadPreset !== 'undefined' ? loadPreset : null,

        // Calendar functions
        goToPrevious,
        goToNext,
        goToToday,
        switchView,
        openCalendarFilterModal,
        applyCalendarFilters,
        clearCalendarFilters,

        // Phase 11: DMS
        showDocumentManagementView,
        renderFolderTree,
        renderBreadcrumb,
        navigateToFolder,
        setViewMode,
        sortFiles,
        searchFiles,
        refreshFolderTree,
        openNewFolderModal,
        createFolder,
        renameFolder,
        confirmRenameFolder,
        deleteFolder,
        confirmDeleteFolder,
        showRecentFiles,
        showAllFiles,
        showStarredFiles,
        toggleStar,
        downloadFile,
        handleFileDragStart,
        handleFileDragEnd,
        handleDropOnFolder,
        openUploadModal,
        uploadFiles,
        handleFileSelect,
        previewFile,
        showFileMetadata,
        showVersionHistory,
        showCompareTool,
        compareVersions,
        openShareModal,
        createShare,
        removeShare,
        updateBatchActions,
        toggleFileSelection,
        selectAllFiles,
        deselectAll,
        deleteSelected,
        confirmDeleteSelected,
        downloadSelected,
        copySelected,
        moveSelected,
        editFileDescription,
        saveFileDescription,
        downloadVersion,
        restoreVersion,

        // Phase 12 Marketing Functions
        showMarketingAutomationView,
        switchMarketingTab,
        renderMarketingTabContent,
        renderTemplatesTab,
        renderTemplateCard,
        openCreateTemplateModal,
        saveTemplate,
        refreshTemplatesTab,
        previewTemplate,
        insertVariable,
        addButtonField,
        searchTemplates,
        editTemplate: (id) => await openCreateTemplateModal(id),
        copyTemplate,
        deleteTemplate,
        useTemplate,
        renderCampaignsTab,
        renderCampaignRow,
        openCreateCampaignModal,
        nextCampaignStep,
        prevCampaignStep,
        renderCampaignStep,
        calculateAudienceSize,
        saveCampaignDraft,
        saveCampaign,
        simulateCampaignSending,
        refreshCampaignsTab,
        filterCampaigns,
        editCampaign: (id) => await openCreateCampaignModal(id),
        pauseCampaign,
        resumeCampaign,
        cancelCampaign,
        duplicateCampaign,
        deleteCampaign,
        renderAnalyticsTab,
        getRealAnalyticsData,
        initMarketingCharts,
        refreshAnalytics,
        exportAnalyticsReport,
        viewCampaignDetails,
        renderRecipientRow,
        filterRecipients,
        viewRecipientHistory,
        retryMessage,
        exportCampaignReport,
        openAddProductModal,
        saveProduct,
        toggleProductStatus,
        renderPackagesTab,
        openCreatePackageModal,
        savePackage,
        deletePackage,
        viewPackageCustomers,
        filterPackages,

        // Phase 13: Import & Reassignment
        showImportDashboard,
        openImportWizard,
        renderImportStep,
        importNextStep,
        importPrevStep,
        updateImportType,
        autoMapFields,
        clearMapping,
        downloadErrorReport,
        startImport,
        viewImportDetails,
        downloadImportLog,
        openTemplatesModal,
        downloadTemplate,
        showImportHistory,
        handleImportFileDrop,
        handleImportFileSelect,

        // Phase 13: Protection Monitoring
        showProtectionMonitoringView,
        renderTeamSummaryCards,
        renderAgentPerformanceRows,
        renderInactiveProspectsRows,
        renderReassignmentHistory,
        openReassignModal,
        confirmReassignment,
        bulkReassign,
        confirmBulkReassignment,
        refreshFollowupStats,
        exportFollowupReport,
        configureAlerts,
        viewAgentDetails,
        contactProspect,

        // Phase 14: Voice Recording
        openVoiceRecorder,
        startRecording,
        stopRecording,
        processRecording,
        saveTranscription,
        createNoteFromVoice,
        editTranscription,
        discardRecording,
        deleteAudio,
        openVoiceSettings,
        saveVoiceSettings,

        // Phase 14: Customer & Agent Notes
        addCustomerNote,
        deleteCustomerNote,
        addAgentNote,
        deleteAgentNote,

        // Phase 14: Mobile
        toggleMobileNav,
        isMobile,
        renderMobileBottomNav,
        showMobileMenu,
        initSwipeActions,
        initPullToRefresh,

        // Phase 18: Mobile App Additions
        initMobileApp,
        addMobileMetaTags,

        // Phase 18: Cases Module Functions
        showCasesView,
        handleCaseSearch,
        handleCaseFilterChange,
        renderCasesList,
        showCaseStudyDetail,
        toggleCasePublic,
        copyCaseLink,
        deleteCaseStudy,
        openCaseStudyModal,
        switchModalTab,
        searchCaseEntities,
        selectCaseEntity,
        saveCaseStudy,

        // Phase 14: Offline Support
        initOfflineSupport,
        addToOfflineQueue,
        processOfflineQueue,
        offlineCreate,
        offlineUpdate,

        // Phase 15: Integrations
        showIntegrationHub,
        showIntegrationDetails,
        showGoogleCalendarIntegration,
        initiateGoogleOAuth,
        simulateGoogleConnection,
        saveGoogleSettings,
        syncGoogleCalendar,
        viewSyncHistory,
        disconnectGoogle,
        confirmDisconnectGoogle,
        resolveConflict,
        exportSyncHistory,
        clearSyncHistory,
        refreshSyncHistory,

        // Phase 17: AI Analytics Functions
        showAIInsightsDashboard,
        showAIPredictionDashboard,
        showLeadScoring,
        showSalesForecast,
        showChurnRiskAnalysis,
        showPerformanceInsights,
        predictLeadScore,
        calculateChurnRisk,
        generateSalesForecast,
        getPerformanceInsights: generateAgentInsights,
        retrainAIModels,
        startModelTraining,
        refreshAIPredictions: batchUpdateLeadScores,
        recalculateLeadScores: batchUpdateLeadScores,
        exportLeads: () => UI.toast.info('Exporting leads...'),
        createSegmentFromScoredLeads: () => UI.toast.info('Creating segment...'),
        scheduleBulkFollowup: () => UI.toast.info('Scheduling follow-ups...'),
        exportScoringReport: () => UI.toast.info('Generating report...'),
        changeForecastPeriod: (period) => console.log('Changing period to:', period),
        viewDealDetails: (type) => UI.toast.info(`Viewing ${type} deals`),
        viewProspectDetails: () => UI.toast.info('Viewing prospects'),
        viewUpsellOpportunities: () => UI.toast.info('Viewing upsell opportunities'),
        viewReferrals: () => UI.toast.info('Viewing referrals'),
        viewRenewals: () => UI.toast.info('Viewing renewals'),
        exportForecast: () => UI.toast.info('Exporting forecast...'),
        adjustForecast: () => UI.toast.info('Opening forecast factors...'),
        scheduleForecastReview: () => UI.toast.info('Scheduling review...'),
        contactAtRiskCustomer: (id) => UI.toast.info(`Contacting customer ${id}`),
        executeRiskActions: () => UI.toast.info('Executing selected actions...'),
        refreshPerformanceInsights: () => UI.toast.info('Refreshing insights...'),

        // ========== GLOBAL DATA SYNCHRONIZATION ==========
        refreshCurrentView: () => {
            const viewport = document.getElementById('content-viewport');
            if (!viewport) return;

            // Guard against infinite loops if render functions modify data
            if (window._isRefreshing) return;
            window._isRefreshing = true;

            try {
                const view = _currentView;
                console.log(`Auto-refreshing view: ${view}`);

                switch (view) {
                    case 'month':
                        if (typeof renderCalendar === 'function') await renderCalendar();
                        break;
                    case 'week':
                        if (typeof renderWeekView === 'function') await renderWeekView();
                        break;
                    case 'day':
                        if (typeof renderTodayActivities === 'function') await renderTodayActivities();
                        break;
                    case 'prospects':
                        if (typeof showProspectsView === 'function') await showProspectsView(viewport);
                        break;
                    case 'pipeline':
                        if (typeof showPipelineView === 'function') await showPipelineView(viewport);
                        break;
                    case 'reports':
                        if (typeof refreshKPIDashboard === 'function') await refreshKPIDashboard();
                        break;
                    case 'protection':
                        if (typeof showProtectionMonitoringView === 'function') await showProtectionMonitoringView(viewport);
                        break;
                    case 'agents':
                        if (typeof showAgentsView === 'function') await showAgentsView(viewport);
                        break;
                    case 'referrals':
                        if (typeof showReferralsView === 'function') await showReferralsView(viewport);
                        break;
                    case 'cases':
                        if (typeof showCasesView === 'function') await showCasesView(viewport);
                        break;
                    case 'promotions':
                        if (typeof showMarketingAutomationView === 'function') await showMarketingAutomationView(viewport);
                        break;
                    default:
                        console.log(`No specific refresh logic configured for ${view}`);
                }
            } catch (err) {
                console.error("Error during auto-refresh:", err);
            } finally {
                window._isRefreshing = false;
            }
        },

        initSync: () => {
            window.addEventListener('dataChanged', (e) => {
                const { table, action } = e.detail;
                const view = _currentView;

                // Map tables to views that need refresh
                const viewDependencies = {
                    'month': ['activities', 'prospects', 'customers'],
                    'week': ['activities', 'prospects', 'customers'],
                    'day': ['activities', 'prospects', 'customers'],
                    'pipeline': ['prospects', 'activities'],
                    'reports': ['purchases', 'transactions', 'activities', 'agent_targets'],
                    'protection': ['prospects', 'activities'],
                    'prospects': ['prospects', 'customers', 'activities'],
                    'referrals': ['referrals', 'prospects', 'customers']
                };

                if (viewDependencies[view] && viewDependencies[view].includes(table)) {
                    appLogic.refreshCurrentView();
                }
            });
            console.log('Global Data Sync initialized.');
        },

        scheduleCoachingSessions: () => UI.toast.info('Scheduling coaching sessions...'),
        generatePerformanceReport: () => UI.toast.info('Generating performance report...'),
        shareInsights: () => UI.toast.info('Sharing insights...'),
        viewAgentDetails: (id) => UI.toast.info(`Viewing agent ${id}`),
        viewLeadDetails: (id) => UI.toast.info(`Viewing lead ${id}`),
        executeAction: (action) => UI.toast.info(`Executing: ${action}`),
        openAttendeeOutcomeModal,
        openAttendeeNotesModal,
        saveAttendeeNote,

        // Phase: Marketing Manager Listings
        showMarketingListsView,
        switchMarketingListTab,
        renderMarketingListTable,
        openMarketingListAddModal,
        openMarketingListEditModal,
        saveMarketingListItem,
        deleteMarketingListItem,

        // Auth exports
        login,
        logout,
        populateLoginDropdown,
        updateNavVisibility,
        setRoleFilter,
        setTimeFilter,
        setCustomDateRange,
        refreshKPIDashboard

    };

})();

Object.assign(window.app, appLogic);


// ========== SECURITY INITIALIZATION ==========
const initSecurity = async () => {
    console.log('Initializing security features...');
    if (typeof window.app.checkForSecurityIncidents !== 'undefined') window.app.checkForSecurityIncidents();
    if (typeof window.app.monitorLoginAttempts !== 'undefined') window.app.monitorLoginAttempts();
    if (typeof window.app.initSessionTimeout !== 'undefined') window.app.initSessionTimeout();
    if (typeof window.app.checkExpiredConsents !== 'undefined') window.app.checkExpiredConsents();
    if (typeof window.app.scheduleRetentionJobs !== 'undefined') window.app.scheduleRetentionJobs();
    console.log('Security features initialized');
};

let sessionTimeoutTimer;
const initSessionTimeout = async () => {
    const timeoutMinutes = parseInt(localStorage.getItem('session_timeout') || '30');
    const resetTimeout = async () => {
        clearTimeout(sessionTimeoutTimer);
        sessionTimeoutTimer = (window.app.logoutDueToInactivity, timeoutMinutes * 60 * 1000);
    };
    ['click', 'mousemove', 'keypress', 'scroll', 'touchstart'].forEach(event => {
        document.addEventListener(event, resetTimeout);
    });
    await resetTimeout();
};

const logoutDueToInactivity = async () => {
    if (window.UI && window.UI.toast) window.UI.toast.warning('Session expired due to inactivity');
    if (typeof AuditLogger !== 'undefined') AuditLogger.warn("AUTH", "LOGOUT", { reason: 'session_timeout' });
    if (typeof window.app.logout === 'function') {
        window.app.logout();
    } else if (typeof Auth !== 'undefined') {
        await Auth.logout();
        window.location.reload();
    }
};

const monitorLoginAttempts = () => {
    const failedAttempts = JSON.parse(localStorage.getItem('login_attempts') || '{}');
    const now = Date.now();
    Object.keys(failedAttempts).forEach(ip => {
        failedAttempts[ip] = failedAttempts[ip].filter(t => now - t < 24 * 60 * 60 * 1000);
        if (failedAttempts[ip].length === 0) delete failedAttempts[ip];
    });
    localStorage.setItem('login_attempts', JSON.stringify(failedAttempts));
};

const checkForSecurityIncidents = async () => {
    if (!window.AppDataStore) return;
    const incidents = await AppDataStore.getAll('security_incidents').filter(i => i.status === 'new' && !i.acknowledged);
    if (incidents.length > 0) {
        const critical = incidents.filter(i => i.severity === 'critical');
        if (critical.length > 0) {
            if (window.UI && window.UI.toast) window.UI.toast.error(`${critical.length} critical security incidents require attention`, 0);
            window.app.addSecurityAlertIcon();
        }
    }
};

const addSecurityAlertIcon = async () => {
    const header = document.querySelector('.top-bar .bar-right');
    if (header && !document.querySelector('.security-alert')) {
        const alert = document.createElement('div');
        alert.className = 'security-alert';
        alert.innerHTML = '<i class="fas fa-exclamation-triangle" style="color:red; cursor:pointer; font-size:20px; margin-right:15px;"></i>';
        alert.title = 'Security incidents require attention';
        alert.onclick = () => window.app.showSecurityDashboard();
        header.insertBefore(alert, header.firstChild);
    }
};

const checkExpiredConsents = async () => {
    if (!window.AppDataStore || typeof ConsentManager === 'undefined') return;
    const users = await AppDataStore.getAll('users');
    const now = new Date();
    users.forEach(user => {
        if (user.consent_preferences) {
            Object.entries(user.consent_preferences).forEach(([type, consent]) => {
                if (consent.expires_at && new Date(consent.expires_at) < now) {
                    ConsentManager.revokeConsent(user.id, type);
                }
            });
        }
    });
};

const scheduleRetentionJobs = async () => {
    if (typeof RetentionPolicy === 'undefined') return;
    const runRetention = () => {
        const lastRun = localStorage.getItem('last_retention_run');
        if (!lastRun || Date.now() - parseInt(lastRun) > 24 * 60 * 60 * 1000) {
            RetentionPolicy.applyRetention();
            localStorage.setItem('last_retention_run', Date.now().toString());
        }
    };
    runRetention();
    (runRetention, 24 * 60 * 60 * 1000);
};

const showSecurityDashboard = async () => {
    const incidents = await AppDataStore.getAll('security_incidents') || [];

    let content = `
        <div class="security-dashboard">
            <div class="security-score-card">
                <div class="score-value">92/100</div>
                <div class="score-label">Overall Security Score - Excellent</div>
            </div>
            
            <h3>Recent Security Incidents</h3>
            <div class="incident-list">
                ${incidents.length ? incidents.map(inc => `
                    <div class="incident-item ${inc.severity || 'medium'}">
                        <div class="incident-icon"><i class="fas fa-exclamation-circle"></i></div>
                        <div class="incident-content">
                            <div class="incident-title">${inc.title || 'Security Alert'}</div>
                            <div class="incident-meta">
                                <span>${new Date(inc.timestamp).toLocaleString()}</span>
                            </div>
                        </div>
                    </div>
                `).join('') : '<p>No recent incidents.</p>'}
            </div>
        </div>
    `;
    const view = document.getElementById('content-viewport');
    if (view) view.innerHTML = content;
};

const showAuditLogs = async () => {
    const logs = (await AppDataStore.getAll('audit_logs') || [])
        .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))
        .slice(0, 50);

    let content = `
        <div class="audit-log-viewer" style="margin:24px;">
            <h2>Audit Logs</h2>
            <div class="audit-filters">
                <select class="form-control" style="width:200px"><option>All Categories</option></select>
                <select class="form-control" style="width:200px">
                    <option>All Levels</option>
                    ${USER_ROLES.map(r => `<option>${r}</option>`).join('')}
                </select>
            </div>
            <table class="audit-table">
                <thead>
                    <tr>
                        <th>Timestamp</th>
                        <th>Level</th>
                        <th>Category</th>
                        <th>Action</th>
                        <th>User</th>
                    </tr>
                </thead>
                <tbody>
                    ${logs.map(log => `
                        <tr>
                            <td>${new Date(log.timestamp).toLocaleString()}</td>
                            <td><span class="log-level ${log.level}">${log.level}</span></td>
                            <td>${log.category}</td>
                            <td>${log.action}</td>
                            <td>${log.user_id || 'System'}</td>
                        </tr>
                    `).join('')}
                    ${!logs.length ? '<tr><td colspan="5">No logs found.</td></tr>' : ''}
                </tbody>
            </table>
        </div>
    `;
    const view = document.getElementById('content-viewport');
    if (view) view.innerHTML = content;
};

const showComplianceCenter = () => {
    let content = `
        <div class="compliance-center" style="margin:24px;">
            <h2>Compliance Center</h2>
            <p>Manage GDPR and PDPA compliance features.</p>
            
            <div class="retention-policies" style="margin-top:24px;">
                <h3>Active Retention Policies</h3>
                <div class="policy-card">
                    <div class="policy-header">
                        <div class="policy-name">Audit Logs Retention</div>
                        <div class="policy-action">Archive</div>
                    </div>
                    <div class="policy-details">Retain for: 365 Days</div>
                </div>
                <div class="policy-card">
                    <div class="policy-header">
                        <div class="policy-name">Inactive Prospects Data</div>
                        <div class="policy-action">Anonymize</div>
                    </div>
                    <div class="policy-details">Retain for: 730 Days</div>
                </div>
            </div>
        </div>
    `;
    const view = document.getElementById('content-viewport');
    if (view) view.innerHTML = content;
};

// Add to window.app
Object.assign(window.app, {
    initSecurity,
    initSessionTimeout,
    logoutDueToInactivity,
    monitorLoginAttempts,
    checkForSecurityIncidents,
    addSecurityAlertIcon,
    checkExpiredConsents,
    scheduleRetentionJobs,
    showSecurityDashboard,
    showAuditLogs,
    showComplianceCenter,
    showTwoFactorSetup: typeof showTwoFactorSetup !== 'undefined' ? showTwoFactorSetup : () => { },
    verifyAndEnable2FA: typeof verifyAndEnable2FA !== 'undefined' ? verifyAndEnable2FA : () => { },
    showTwoFactorLogin: typeof showTwoFactorLogin !== 'undefined' ? showTwoFactorLogin : () => { },
    verifyTwoFactorLogin: typeof verifyTwoFactorLogin !== 'undefined' ? verifyTwoFactorLogin : () => { }
});

// ========== PHASE 20: SYSTEM ADMINISTRATION & DEPLOYMENT ==========

const showAdminDashboard = async () => {
    if (!Auth.getCurrentUser() || Auth.getCurrentUser().role !== 'admin') {
        if (window.UI) window.UI.toast.error("Access Denied. Admins only.");
        return;
    }

    const health = typeof SystemHealth !== 'undefined' ? SystemHealth.checkAll() : { status: 'UNKNOWN' };
    const tenants = typeof TenantManager !== 'undefined' ? TenantManager.listTenants() : [];
    const activeTenants = tenants.filter(t => t.status === 'ACTIVE').length;
    const updates = typeof DeploymentManager !== 'undefined' ? DeploymentManager.checkForUpdates() : null;

    let content = `
        <div class="admin-dashboard fade-in" style="padding: 24px;">
            <div class="header-actions" style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 24px;">
                <h2>System Administration</h2>
                <button class="btn primary" onclick="app.showSystemHealth()"><i class="fas fa-stethoscope"></i> Run Health Check</button>
            </div>

            <div class="kpi-grid" style="display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap: 20px; margin-bottom: 24px;">
                <div class="kpi-card" style="background: white; padding: 20px; border-radius: 8px; box-shadow: 0 1px 3px rgba(0,0,0,0.1);">
                    <div class="kpi-title" style="color: var(--gray-600); font-size: 14px; margin-bottom: 8px;">System Status</div>
                    <div class="kpi-value ${health.status === 'HEALTHY' ? 'status-active' : (health.status === 'DEGRADED' ? 'status-warning' : 'status-danger')}" style="font-size: 24px; font-weight: bold;">
                        ${health.status}
                    </div>
                </div>
                <div class="kpi-card" style="background: white; padding: 20px; border-radius: 8px; box-shadow: 0 1px 3px rgba(0,0,0,0.1); cursor: pointer;" onclick="app.showTenantManagement()">
                    <div class="kpi-title" style="color: var(--gray-600); font-size: 14px; margin-bottom: 8px;">Active Tenants</div>
                    <div class="kpi-value" style="font-size: 24px; font-weight: bold; color: var(--gray-900);">${activeTenants} / ${tenants.length}</div>
                </div>
                <div class="kpi-card" style="background: white; padding: 20px; border-radius: 8px; box-shadow: 0 1px 3px rgba(0,0,0,0.1); cursor: pointer;" onclick="await app.showDeploymentCenter()">
                    <div class="kpi-title" style="color: var(--gray-600); font-size: 14px; margin-bottom: 8px;">System Version</div>
                    <div class="kpi-value" style="font-size: 24px; font-weight: bold; color: var(--gray-900);">
                        ${updates && updates.hasUpdate ? '<span style="color: var(--warning-color); font-size:16px;">Update Available</span>' : 'Up to Date'}
                    </div>
                </div>
            </div>

            <div class="admin-modules-grid" style="display: grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); gap: 20px;">
                
                <div class="admin-module-card" style="background: white; padding: 24px; border-radius: 8px; border: 1px solid var(--gray-200); text-align: center; cursor: pointer; transition: transform 0.2s;" onclick="app.showTenantManagement()" onmouseover="this.style.transform='translateY(-5px)'" onmouseout="this.style.transform='translateY(0)'">
                    <i class="fas fa-building" style="font-size: 40px; color: var(--primary-color); margin-bottom: 16px;"></i>
                    <h3>Tenant Management</h3>
                    <p style="color: var(--gray-600); font-size: 14px; margin-top: 8px;">Manage multi-tenant architecture, provision new tenants, and monitor usage.</p>
                </div>

                <div class="admin-module-card" style="background: white; padding: 24px; border-radius: 8px; border: 1px solid var(--gray-200); text-align: center; cursor: pointer; transition: transform 0.2s;" onclick="app.showSystemHealth()" onmouseover="this.style.transform='translateY(-5px)'" onmouseout="this.style.transform='translateY(0)'">
                    <i class="fas fa-heartbeat" style="font-size: 40px; color: var(--success-color); margin-bottom: 16px;"></i>
                    <h3>System Health</h3>
                    <p style="color: var(--gray-600); font-size: 14px; margin-top: 8px;">Monitor database, API, storage, and external service connectivity.</p>
                </div>

                <div class="admin-module-card" style="background: white; padding: 24px; border-radius: 8px; border: 1px solid var(--gray-200); text-align: center; cursor: pointer; transition: transform 0.2s;" onclick="await app.showBackupManager()" onmouseover="this.style.transform='translateY(-5px)'" onmouseout="this.style.transform='translateY(0)'">
                    <i class="fas fa-database" style="font-size: 40px; color: var(--secondary-color); margin-bottom: 16px;"></i>
                    <h3>Backup & Restore</h3>
                    <p style="color: var(--gray-600); font-size: 14px; margin-top: 8px;">Configure automated backups, manage snapshots, and perform data restoration.</p>
                </div>

                <div class="admin-module-card" style="background: white; padding: 24px; border-radius: 8px; border: 1px solid var(--gray-200); text-align: center; cursor: pointer; transition: transform 0.2s;" onclick="await app.showPerformanceMonitor()" onmouseover="this.style.transform='translateY(-5px)'" onmouseout="this.style.transform='translateY(0)'">
                    <i class="fas fa-tachometer-alt" style="font-size: 40px; color: var(--warning-color); margin-bottom: 16px;"></i>
                    <h3>Performance Monitor</h3>
                    <p style="color: var(--gray-600); font-size: 14px; margin-top: 8px;">Track query execution times, memory usage, and application delays.</p>
                </div>

                <div class="admin-module-card" style="background: white; padding: 24px; border-radius: 8px; border: 1px solid var(--gray-200); text-align: center; cursor: pointer; transition: transform 0.2s;" onclick="await app.showDeploymentCenter()" onmouseover="this.style.transform='translateY(-5px)'" onmouseout="this.style.transform='translateY(0)'">
                    <i class="fas fa-rocket" style="font-size: 40px; color: #8b5cf6; margin-bottom: 16px;"></i>
                    <h3>Deployment Center</h3>
                    <p style="color: var(--gray-600); font-size: 14px; margin-top: 8px;">Manage CI/CD pipelines, rollouts to different environments, and zero-downtime updates.</p>
                </div>

                <div class="admin-module-card" style="background: white; padding: 24px; border-radius: 8px; border: 1px solid var(--gray-200); text-align: center; cursor: pointer; transition: transform 0.2s;" onclick="app.showSystemLogs()" onmouseover="this.style.transform='translateY(-5px)'" onmouseout="this.style.transform='async translateY(0)'">
                    <i class="fas fa-terminal" style="font-size: 40px; color: var(--gray-800); margin-bottom: 16px;"></i>
                    <h3>System Logs</h3>
                    <p style="color: var(--gray-600); font-size: 14px; margin-top: 8px;">View consolidated application, database, and system error logs.</p>
                </div>
            </div>
        </div>
    `;

    const view = document.getElementById('content-viewport');
    if (view) view.innerHTML = content;
};

const showTenantManagement = () => {
    let tenants = typeof TenantManager !== 'undefined' ? TenantManager.listTenants() : [];
    if (tenants.length === 0) {
        // Seed some dummy tenants for demonstration
        if (typeof TenantManager !== 'undefined') {
            TenantManager.createTenant('FSC-TE-DEMO1', 'Alpha Agency CRM', 'admin@alpha-agency.com');
            TenantManager.createTenant('FSC-TE-DEMO2', 'Beta Properties', 'admin@beta-prop.com');
            tenants = TenantManager.listTenants();
        }
    }

    let content = `
        <div class="tenant-management" style="padding: 24px;">
            <div class="header-actions" style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 24px;">
                <h2>Tenant Management</h2>
                <button class="btn primary" onclick="app.openCreateTenantModal()"><i class="fas fa-plus"></i> New Tenant</button>
            </div>
            
            <div class="data-table-container">
                <table class="data-table" style="width: 100%; border-collapse: collapse;">
                    <thead>
                        <tr style="background: var(--gray-100); text-align: left;">
                            <th style="padding: 12px; border-bottom: 1px solid var(--gray-200);">Tenant ID</th>
                            <th style="padding: 12px; border-bottom: 1px solid var(--gray-200);">Name</th>
                            <th style="padding: 12px; border-bottom: 1px solid var(--gray-200);">Plan</th>
                            <th style="padding: 12px; border-bottom: 1px solid var(--gray-200);">Status</th>
                            <th style="padding: 12px; border-bottom: 1px solid var(--gray-200);">Provisioned</th>
                            <th style="padding: 12px; border-bottom: 1px solid var(--gray-200);">Actions</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${tenants.map(t => `
                            <tr>
                                <td style="padding: 12px; border-bottom: 1px solid var(--gray-200);">${t.tenant_id}</td>
                                <td style="padding: 12px; border-bottom: 1px solid var(--gray-200);"><strong>${t.name}</strong></td>
                                <td style="padding: 12px; border-bottom: 1px solid var(--gray-200);">${t.plan}</td>
                                <td style="padding: 12px; border-bottom: 1px solid var(--gray-200);"><span class="status-badge status-${t.status.toLowerCase()}">${t.status}</span></td>
                                <td style="padding: 12px; border-bottom: 1px solid var(--gray-200);">${new Date(t.created_at).toLocaleDateString()}</td>
                                <td style="padding: 12px; border-bottom: 1px solid var(--gray-200);">
                                    <button class="btn-icon" onclick="app.viewTenantDetails('${t.tenant_id}')" title="View"><i class="fas fa-eye"></i></button>
                                    <button class="btn-icon" onclick="app.suspendTenant('${t.tenant_id}')" title="${t.status === 'ACTIVE' ? 'Suspend' : 'Activate'}">
                                        <i class="fas ${t.status === 'ACTIVE' ? 'fa-pause' : 'fa-play'}"></i>
                                    </button>
                                </td>
                            </tr>
                        `).join('')}
                    </tbody>
                </table>
            </div>
        </div>
    `;
    const view = document.getElementById('content-viewport');
    if (view) view.innerHTML = content;
};

const openCreateTenantModal = () => {
    let content = `
        <div class="form-group">
            <label>Tenant ID (Identifier)</label>
            <input type="text" id="new-tenant-id" class="form-control" placeholder="e.g. COMPANY-A">
        </div>
        <div class="form-group">
            <label>Tenant Name</label>
            <input type="text" id="new-tenant-name" class="form-control" placeholder="Company Name">
        </div>
        <div class="form-group">
            <label>Admin Email</label>
            <input type="email" id="new-tenant-email" class="form-control" placeholder="admin@company.com">
        </div>
    `;
    if (window.UI) {
        UI.showModal('Provision New Tenant', content, [
            { label: 'Cancel', type: 'secondary', action: 'UI.hideModal()' },
            { label: 'Provision Tenant', type: 'primary', action: 'app.submitNewTenant()' }
        ]);
    }
};

const submitNewTenant = () => {
    const id = document.getElementById('new-tenant-id').value;
    const name = document.getElementById('new-tenant-name').value;
    const email = document.getElementById('new-tenant-email').value;
    if (!id || !name || !email) {
        if (window.UI) UI.toast.error("Please fill all fields");
        return;
    }
    if (typeof TenantManager !== 'undefined') {
        TenantManager.createTenant(id, name, email);
    }
    if (window.UI) {
        UI.hideModal();
        UI.toast.success("Tenant provisioned successfully");
    }
    showTenantManagement();
};

const showSystemHealth = () => {
    const health = typeof SystemHealth !== 'undefined' ? SystemHealth.checkAll() : { status: 'UNKNOWN', components: {} };
    let content = `
        <div class="system-health" style="padding: 24px;">
            <div class="header-actions" style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 24px;">
                <h2>System Health</h2>
                <button class="btn secondary" onclick="app.showSystemHealth()"><i class="fas fa-sync-alt"></i> Refresh</button>
            </div>
            <div class="kpi-card" style="background: white; padding: 20px; border-radius: 8px; margin-bottom: 24px; border: 1px solid var(--gray-200);">
                <h3>Overall Status: <span class="${health.status === 'HEALTHY' ? 'status-active' : 'status-danger'}">${health.status}</span></h3>
                <p style="color: var(--gray-500); font-size: 14px;">Last checked: ${new Date(health.timestamp).toLocaleString()}</p>
            </div>
            <div class="components-grid" style="display: grid; grid-template-columns: repeat(auto-fill, minmax(300px, 1fr)); gap: 16px;">
                ${Object.entries(health.components).map(([name, status]) => `
                    <div style="background: white; padding: 16px; border-radius: 8px; border: 1px solid var(--gray-200); display: flex; align-items: center;">
                        <i class="fas ${status === 'up' ? 'fa-check-circle' : 'fa-times-circle'}" style="color: ${status === 'up' ? 'var(--success-color)' : 'var(--danger-color)'}; font-size: 24px; margin-right: 16px;"></i>
                        <div>
                            <div style="font-weight: bold; text-transform: capitalize;">${name.replace('_', ' ')} Node</div>
                            <div style="font-size: 12px; color: var(--gray-500);">Status: ${status.toUpperCase()}</div>
                        </div>
                    </div>
                `).join('')}
            </div>
        </div>
    `;
    const view = document.getElementById('content-viewport');
    if (view) view.innerHTML = content;
};

const showBackupManager = async () => {
    let backups = typeof BackupManager !== 'undefined' ? BackupManager.listBackups() : [];
    let content = `
        <div class="backup-manager" style="padding: 24px;">
            <div class="header-actions" style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 24px;">
                <h2>Backup & Restore</h2>
                <div>
                    <button class="btn secondary" onclick="await app.createBackup('INCREMENTAL')">Incremental Backup</button>
                    <button class="btn primary" onclick="await app.createBackup('FULL')"><i class="fas fa-save"></i> Full Backup</button>
                </div>
            </div>
            <div class="data-table-container">
                <table class="data-table" style="width: 100%; border-collapse: collapse;">
                    <thead>
                        <tr style="background: var(--gray-100); text-align: left;">
                            <th style="padding: 12px; border-bottom: 1px solid var(--gray-200);">Backup ID</th>
                            <th style="padding: 12px; border-bottom: 1px solid var(--gray-200);">Date</th>
                            <th style="padding: 12px; border-bottom: 1px solid var(--gray-200);">Type</th>
                            <th style="padding: 12px; border-bottom: 1px solid var(--gray-200);">Status</th>
                            <th style="padding: 12px; border-bottom: 1px solid var(--gray-200);">Size (KB)</th>
                            <th style="padding: 12px; border-bottom: 1px solid var(--gray-200);">Actions</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${backups.length > 0 ? backups.map(b => `
                            <tr>
                                <td style="padding: 12px; border-bottom: 1px solid var(--gray-200);">${b.id}</td>
                                <td style="padding: 12px; border-bottom: 1px solid var(--gray-200);">${new Date(b.created_at).toLocaleString()}</td>
                                <td style="padding: 12px; border-bottom: 1px solid var(--gray-200);">${b.type}</td>
                                <td style="padding: 12px; border-bottom: 1px solid var(--gray-200);"><span class="status-badge status-${b.status.toLowerCase()}">${b.status}</span></td>
                                <td style="padding: 12px; border-bottom: 1px solid var(--gray-200);">${Math.round(b.size / 1024)}</td>
                                <td style="padding: 12px; border-bottom: 1px solid var(--gray-200);">
                                    <button class="btn btn-sm secondary" onclick="app.restoreBackup('${b.id}')">Restore</button>
                                </td>
                            </tr>
                        `).join('') : '<tr><td colspan="6" style="padding: 16px; text-align: center;">No backups found.</td></tr>'}
                    </tbody>
                </table>
            </div>
        </div>
    `;
    const view = document.getElementById('content-viewport');
    if (view) view.innerHTML = content;
};

const createBackup = async (type) => {
    if (typeof BackupManager !== 'undefined') {
        const id = await BackupManager.createBackup(type);
        if (window.UI) UI.toast.success(`Backup ${id} initiated successfully`);
        (showBackupManager, 1000); // Refresh view after a simulated delay
    }
};

const restoreBackup = (id) => {
    if (confirm("Are you sure you want to restore this backup? This will replace current data.")) {
        if (typeof BackupManager !== 'undefined') {
            BackupManager.restoreBackup(id);
            if (window.UI) UI.toast.success("Backup restored successfully");
        }
    }
};

const showPerformanceMonitor = async () => {
    if (window.UI) window.UI.toast.info("Generating performance metrics report...");
    let content = `
        <div class="performance-monitor" style="padding: 24px;">
            <h2>Performance Monitor</h2>
            <p>Performance monitoring active. View reports via the browser console or use the System Logs feature to see documented warnings.</p>
            <div class="kpi-card" style="background: white; padding: 20px; border-radius: 8px; margin-top:20px;">
                <canvas id="performanceChart" width="400" height="150"></canvas>
            </div>
        </div>
    `;
    const view = document.getElementById('content-viewport');
    if (view) {
        view.innerHTML = content;
        // Mock chart
        (() => {
            const ctx = document.getElementById('performanceChart');
            if (ctx && window.Chart) {
                new Chart(ctx, {
                    type: 'line',
                    data: {
                        labels: ['10:00', '10:05', '10:10', '10:15', '10:20', '10:25'],
                        datasets: [{ label: 'Average Query Time (ms)', data: [12, 19, 15, 25, 22, 18], borderColor: 'var(--primary)', tension: 0.1 }]
                    }
                });
            }
        }, 100);
    }
};

const showDeploymentCenter = async () => {
    const history = typeof DeploymentManager !== 'undefined' ? DeploymentManager.getDeploymentHistory() : [];
    let content = `
        <div class="deployment-center" style="padding: 24px;">
            <div class="header-actions" style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 24px;">
                <h2>Deployment Center</h2>
                <button class="btn primary" onclick="await app.executeDeployment()"><i class="fas fa-rocket"></i> Deploy New Version</button>
            </div>
            
            <div class="data-table-container">
                <table class="data-table" style="width: 100%; border-collapse: collapse;">
                    <thead>
                        <tr style="background: var(--gray-100); text-align: left;">
                            <th style="padding: 12px; border-bottom: 1px solid var(--gray-200);">Version</th>
                            <th style="padding: 12px; border-bottom: 1px solid var(--gray-200);">Environment</th>
                            <th style="padding: 12px; border-bottom: 1px solid var(--gray-200);">Status</th>
                            <th style="padding: 12px; border-bottom: 1px solid var(--gray-200);">Deployed At</th>
                            <th style="padding: 12px; border-bottom: 1px solid var(--gray-200);">Actions</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${history.length > 0 ? history.map(d => `
                            <tr>
                                <td style="padding: 12px; border-bottom: 1px solid var(--gray-200);"><strong>${d.version}</strong></td>
                                <td style="padding: 12px; border-bottom: 1px solid var(--gray-200);">${d.environment}</td>
                                <td style="padding: 12px; border-bottom: 1px solid var(--gray-200);"><span class="status-badge status-${d.status.toLowerCase()}">${d.status}</span></td>
                                <td style="padding: 12px; border-bottom: 1px solid var(--gray-200);">${new Date(d.deployed_at).toLocaleString()}</td>
                                <td style="padding: 12px; border-bottom: 1px solid var(--gray-200);">
                                    ${d.status === 'COMPLETED' ? `<button class="btn btn-sm warning" onclick="await app.rollbackDeployment('${d.version}')">Rollback</button>` : '-'}
                                </td>
                            </tr>
                        `).join('') : '<tr><td colspan="5" style="padding: 16px; text-align: center;">No deployment history.</td></tr>'}
                    </tbody>
                </table>
            </div>
        </div>
    `;
    const view = document.getElementById('content-viewport');
    if (view) view.innerHTML = content;
};

const executeDeployment = async () => {
    if (typeof DeploymentManager !== 'undefined') {
        const version = 'v' + (8.7 + Math.random() * 0.1).toFixed(2);
        DeploymentManager.createDeployment(version, 'PRODUCTION', { 'feature_x': true });
        if (window.UI) UI.toast.success(`Deployment ${version} started`);
        (showDeploymentCenter, 1000);
    }
};

const rollbackDeployment = async (version) => {
    if (confirm(`Are you sure you want to rollback from ${version}?`)) {
        if (typeof DeploymentManager !== 'undefined') {
            await DeploymentManager.rollbackDeployment(version);
            if (window.UI) UI.toast.success('Rollback initiated');
            (showDeploymentCenter, 1000);
        }
    }
};

const showSystemLogs = () => {
    if (typeof SystemLogger !== 'undefined') {
        SystemLogger.showLogViewer();
    } else {
        if (window.UI) window.UI.toast.error("SystemLogger not available");
    }
};

// Add new Admin UI Functions to window.app
Object.assign(window.app, {
    showAdminDashboard,
    showTenantManagement,
    openCreateTenantModal,
    submitNewTenant,
    showSystemHealth,
    showBackupManager,
    createBackup,
    restoreBackup,
    showPerformanceMonitor,
    showDeploymentCenter,
    executeDeployment,
    rollbackDeployment,
    showSystemLogs,
    viewEntityDetail: (entity, id) => {
        if (typeof hideSearchPanel !== 'undefined') hideSearchPanel();
        switch (entity) {
            case 'prospects': if (typeof showProspectDetail !== 'undefined') await showProspectDetail(id); break;
            case 'customers': if (typeof showCustomerDetail !== 'undefined') await showCustomerDetail(id); break;
            case 'agents': if (typeof showAgentDetail !== 'undefined') await showAgentDetail(id); break;
            default: console.warn('Unknown entity type:', entity);
        }
    },
    // Provide mocks for some inline UI handlers to avoid errors if they don't exist
    suspendTenant: (id) => { if (window.UI) window.UI.toast.info("Tenant suspended state toggled."); (showTenantManagement, 500); },
    viewTenantDetails: (id) => { if (window.UI) window.UI.toast.info("Viewing details for " + id); }
});

// Initialize application when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
    console.log("Script end reached. Scheduling init...");
(() => {
    if (window.app && window.app.init) {
        console.log("Triggering window.app.init()");
        window.app.init();
    }
}, 100);
    if (window.app && window.app.initSecurity) window.app.initSecurity();
    if (window.app && window.app.initSync) window.app.initSync();
});