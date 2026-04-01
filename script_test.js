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
        const allUsers =await DataStore.getAll('users');
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
        const all = await DataStore.getAll('prospects');
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
            return await DataStore.getAll('customers');
        }
        return (await DataStore.getAll('customers')).filter(c => c.agent_id === _currentUser?.id);
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
        const all = await DataStore.getAll('activities');
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
        const referrals = await DataStore.getAll('referrals');
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
                        <button class="preset-btn" onclick="app.loadPreset('agent-monthly')">Agent Monthly Report</button>
                        <button class="preset-btn" onclick="app.loadPreset('high-score')">High Score Prospects</button>
                        <button class="preset-btn" onclick="app.loadPreset('recent-activities')">Recent Activities</button>
                        <button class="preset-btn" onclick="app.loadPreset('cai-ku-not-purchased')">CAI KU Painting Not Purchased</button>
                    </div>
                </div>
                
                <div class="search-entity-selector">
                    <label>Search in:</label>
                    <select id="search-entity" onchange="app.updateFilterSections()">
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
                    <button class="btn primary" onclick="app.async executeSearch()">
                        <i class="fas fa-search"></i> Apply Filters
                    </button>
                    <button class="btn secondary" onclick="app.clearAllFilters()">
                        <i class="fas fa-times"></i> Clear All
                    </button>
                    <button class="btn secondary" onclick="app.async openSaveSearchModal()">
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
                        ${(await DataStore.getAll('products')).filter(p => p.is_active !== false).map(p => `<option value="${p.name}">${p.name}</option>`).join('')}
                    </select>
                </div>
                <div class="filter-group">
                    <label>Has Not Purchased</label>
                    <select id="filter-prospect-not-purchased" class="form-control">
                        <option value="">Select Product</option>
                        ${(await DataStore.getAll('products')).filter(p => p.is_active !== false).map(p => `<option value="${p.name}">${p.name}</option>`).join('')}
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

        await renderSearchResults();
        addToSearchHistory(filters);
    };

    const performAgentSearch = async (filters) => {
        let items = (await DataStore.getAll('users')).filter(u => isAgent(u) || u.role === 'team_leader' || u.role?.includes('Level 7'));

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
        const purchases = await DataStore.getAll('purchases');
        if (purchases.some(p => p.customer_id === prospectId && p.item && p.item.includes(productName))) return true;

        const activities = await DataStore.getAll('activities');
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
        let items = await DataStore.getAll('activities');

        if (filters.basic.type) {
            items = items.filter(i => i.activity_type === filters.basic.type);
        }

        return applyComplexConditions(items, filters.complex);
    };

    const performTransactionSearch = async (filters) => {
        let items = await DataStore.getAll('purchases');

        if (filters.basic.product) {
            const query = filters.basic.product.toLowerCase();
            items = items.filter(i => i.item && i.item.toLowerCase().includes(query));
        }

        return applyComplexConditions(items, filters.complex);
    };

    const performEventSearch = async (filters) => {
        let items = await DataStore.getAll('events');

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
    const renderSearchResults = async () => {
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
                    ${(await Promise.all(pageItems.map(async item => {
            let agentName = '-';
            if (item.lead_agent_id || item.responsible_agent_id) {
                const agent = await DataStore.getById('users', item.lead_agent_id || item.responsible_agent_id);
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
        }))).join('')}
                </tbody>
            </table>
        `;

        container.innerHTML = html;
        await renderPagination();
    };

    const renderPagination = async () => {
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

    const goToPage = async (page) => {
        _currentPage = page;
        await renderSearchResults();
    };

    // Section 10.10: Saved Searches & History
    const renderSavedSearches = async () => {
        const container = document.getElementById('saved-searches-list');
        if (!container) return;

        const searches = await DataStore.getAll('saved_searches');
        if (searches.length === 0) {
            container.innerHTML = '<p class="text-muted" style="font-size: 12px; margin: 12px 0;">No saved searches yet.</p>';
            return;
        }

        container.innerHTML = searches.map(s => `
            <div class="saved-search-item">
                <div class="saved-search-info" onclick="app.loadSavedSearch(${s.id})">
                    <i class="fas fa-bookmark"></i>
                    <span>${s.search_name}</span>
                    <small>${s.entity}</small>
                </div>
                <button class="btn-icon" onclick="app.deleteSavedSearch(${s.id})">
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

        await DataStore.create('saved_searches', savedSearch);
        UI.toast.success('Search saved successfully');
        await renderSavedSearches();
    };

    const loadSavedSearch = async (id) => {
        const search = await DataStore.getById('saved_searches', id);
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
            await DataStore.delete('saved_searches', id);
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
                        <button class="btn primary" onclick="app.async openUploadModal()">
                            <i class="fas fa-upload"></i> Upload File
                        </button>
                        <button class="btn secondary" onclick="app.async openNewFolderModal()">
                            <i class="fas fa-folder-plus"></i> New Folder
                        </button>
                    </div>
                </div>
                
                <div class="dms-layout">
                    <div class="folder-sidebar">
                        <div class="sidebar-header">
                            <h3>Folders</h3>
                            <button class="btn-icon" onclick="app.async refreshFolderTree()" title="Refresh">
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
                                    <input type="text" id="file-search" placeholder="Search files..." onkeyup="app.async searchFiles(this.value)">
                                    <select id="file-sort" class="form-control" onchange="app.async sortFiles(this.value)">
                                        <option value="name">Sort by Name</option>
                                        <option value="date">Sort by Date</option>
                                        <option value="size">Sort by Size</option>
                                    </select>
                                    <div class="view-toggle">
                                        <button class="btn-icon ${_viewMode === 'list' ? 'active' : ''}" onclick="app.async setViewMode('list')">
                                            <i class="fas fa-list"></i>
                                        </button>
                                        <button class="btn-icon ${_viewMode === 'grid' ? 'active' : ''}" onclick="app.setViewMode('grid')">
                                            <i class="fas fa-th-large"></i>
                                        </button>
                                    </div>
                                </div>
                                <div id="batch-actions"></div>
                            </div>
                            
                            <div class="special-filters" style="margin-top: 15px; display: flex; gap: 10px;">
                                <button class="btn link-btn" onclick="app.async showRecentFiles()"><i class="fas fa-clock"></i> Recent</button>
                                <button class="btn link-btn" onclick="app.async showAllFiles()"><i class="fas fa-copy"></i> All Files</button>
                                <button class="btn link-btn" onclick="app.async showStarredFiles()"><i class="fas fa-star"></i> Starred</button>
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

        const folders = await DataStore.getAll('folders')
            .filter(f => f.parent_id === parentId)
            .sort((a, b) => a.name.localeCompare(b.name));

        for (const folder of folders) {
            const hasChildren = (await DataStore.getAll('folders')).some(f => f.parent_id === folder.id);
            const isActive = _currentFolder === folder.id;

            const div = document.createElement('div');
            div.className = `folder-item ${isActive ? 'active' : ''}`;
            div.style.paddingLeft = `${level * 20 + 10}px`;

            div.innerHTML = `
                <div class="folder-content" onclick="app.navigateToFolder(${folder.id})" 
                     ondragover="event.preventDefault(); this.parentElement.classList.add('drag-over')"
                     ondragleave="this.parentElement.classList.remove('drag-over')"
                     ondrop="app.handleDropOnFolder(event, ${folder.id})">
                    <i class="fas fa-folder" style="color: ${folder.color || '#f59e0b'}"></i>
                    <span class="folder-name">${folder.name}</span>
                </div>
                <div class="folder-actions">
                    <button class="btn-icon" onclick="app.renameFolder(${folder.id}); event.stopPropagation()"><i class="fas fa-edit"></i></button>
                    <button class="btn-icon" onclick="app.deleteFolder(${folder.id}); event.stopPropagation()"><i class="fas fa-trash"></i></button>
                </div>
            `;
            treeContainer.appendChild(div);
            if (hasChildren) await renderFolderTree(folder.id, level + 1, treeContainer);
        }
    };

    const renderBreadcrumb = async () => {
        const container = document.getElementById('breadcrumb');
        if (!container) return;
        const path = [];
        let curr = _currentFolder ? await DataStore.getById('folders', _currentFolder) : null;
        while (curr) { path.unshift(curr); curr = curr.parent_id ? await DataStore.getById('folders', curr.parent_id) : null; }

        let html = '<span class="breadcrumb-item" onclick="app.navigateToFolder(null)">Root</span>';
        for (const f of path) { html += `<span class="breadcrumb-separator">/</span><span class="breadcrumb-item" onclick="app.navigateToFolder(${f.id})">${f.name}</span>`; }
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
        `, [{ label: 'Cancel', type: 'secondary', action: 'UI.hideModal()' }, { label: 'Create', type: 'primary', action: 'await app.async createFolder()' }]);
    };

    const createFolder = async () => {
        const name = document.getElementById('new-folder-name')?.value;
        if (!name) return UI.toast.error('Name required');
        await DataStore.create('folders', { id: Date.now(), name, parent_id: _currentFolder, color: document.getElementById('new-folder-color').value, created_by: _currentUser?.id, created_at: new Date().toISOString() });
        UI.hideModal(); UI.toast.success('Folder created'); await renderFolderTree();
    };

    const renameFolder = async (id) => {
        const folder = await DataStore.getById('folders', id);
        UI.showModal('Rename Folder', `<div class="form-group"><label>New Name</label><input type="text" id="rename-folder-input" class="form-control" value="${folder.name}"></div>`,
            [{ label: 'Cancel', type: 'secondary', action: 'UI.hideModal()' }, { label: 'Rename', type: 'primary', action: `await app.confirmRenameFolder(${id})` }]);
    };
    window.app.confirmRenameFolder = async (id) => {
        const name = document.getElementById('rename-folder-input')?.value;
        if (!name) return;
        await DataStore.update('folders', id, { name }); UI.hideModal(); await renderFolderTree(); await renderBreadcrumb();
    };

    const deleteFolder = async (id) => {
        const hasSub =(await DataStore.getAll('folders')).some(f => f.parent_id === id);
        const hasFiles = (await DataStore.getAll('documents')).some(d => d.folder_id === id);
        if (hasSub || hasFiles) return UI.toast.error('Cannot delete: Folder is not empty');
        UI.showModal('Delete Folder', '<p>Are you sure?</p>', [{ label: 'Cancel', type: 'secondary', action: 'UI.hideModal()' }, { label: 'Delete', type: 'primary', action: `await app.confirmDeleteFolder(${id})` }]);
    };
    window.app.confirmDeleteFolder = async (id) => { await DataStore.delete('folders', id); UI.hideModal(); if (_currentFolder === id) _currentFolder = null; await renderFolderTree(); await loadFolderContents(); };

    const showRecentFiles = async () => {
        const allFiles = (await DataStore.getAll('documents')).sort((a, b) => new Date(b.updated_at || b.created_at) - new Date(a.updated_at || a.created_at));
        await renderFileListView(allFiles.slice(0, 20)); // Show top 20
        _currentFolder = 'recent'; await renderBreadcrumb();
    };

    const showAllFiles = async () => { await renderFileListView(await DataStore.getAll('documents')); _currentFolder = 'all'; await renderBreadcrumb(); };
    const showStarredFiles = async () => { await renderFileListView((await DataStore.getAll('documents')).filter(d => d.is_starred)); _currentFolder = 'starred'; await renderBreadcrumb(); };

    const toggleStar = async (id) => { const f = await DataStore.getById('documents', id); await DataStore.update('documents', id, { is_starred: !f.is_starred }); await loadFolderContents(); };

    const downloadFile = (id) => { UI.toast.info('Starting download...'); /* Implementation depends on environment */ };

    const handleFileDragStart = (e, id) => { _draggedFileId = id; e.dataTransfer.setData('text/plain', id); e.target.classList.add('dragging'); };
    const handleFileDragEnd = (e) => { e.target.classList.remove('dragging'); _draggedFileId = null; };
    const handleDropOnFolder = async (e, folderId) => {
        e.preventDefault();
        const fileId = parseInt(e.dataTransfer.getData('text/plain'));
        if (fileId) { await DataStore.update('documents', fileId, { folder_id: folderId }); UI.toast.success('Moved successfully'); await loadFolderContents(); await renderFolderTree(); }
    };

    const showVersionHistory = async (fileId) => {
        const file = await DataStore.getById('documents', fileId);
        const versions = (await DataStore.getAll('document_versions')).filter(v => v.document_id === fileId).sort((a, b) => b.version_number - a.version_number);
        const content = `
            <div class="version-history">
                <div class="version-header"><h3>Version History: ${file.filename}</h3><p>Current: v${file.current_version || 1}</p></div>
                <table class="version-table">
                    <thead><tr><th>Version</th><th>Date</th><th>Size</th><th>By</th><th>Notes</th><th>Actions</th></tr></thead>
                    <tbody>
                        ${(await Promise.all(versions.map(async v => `
                            <tr class="${v.version_number === file.current_version ? 'current-version' : ''}">
                                <td>v${v.version_number}</td>
                                <td>${new Date(v.created_at).toLocaleString()}</td>
                                <td>${formatFileSize(v.size)}</td>
                                <td>${(await DataStore.getById('users', v.created_by))?.full_name || 'System'}</td>
                                <td>${v.change_note || '-'}</td>
                                <td>
                                    <button class="btn-icon" onclick="app.downloadVersion(${v.id})"><i class="fas fa-download"></i></button>
                                    <button class="btn-icon" onclick="app.restoreVersion(${v.id})"><i class="fas fa-undo"></i></button>
                                </td>
                            </tr>
                        `))).join('')}
                    </tbody>
                </table>
                ${versions.length >= 2 ? `<div class="compare-row"><button class="btn secondary" onclick="app.showCompareTool(${fileId})">Compare Versions</button></div>` : ''}
            </div>
        `;
        UI.showModal('Version History', content, [{ label: 'Close', type: 'primary', action: 'UI.hideModal()' }]);
    };

    const showCompareTool = async (fileId) => {
        const versions = (await DataStore.getAll('document_versions')).filter(v => v.document_id === fileId);
        UI.showModal('Compare Versions', `
            <div class="compare-setup">
                <select id="v1" class="form-control">${versions.map(v => `<option value="${v.id}">Version ${v.version_number}</option>`).join('')}</select>
                <span>vs</span>
                <select id="v2" class="form-control">${versions.map(v => `<option value="${v.id}">Version ${v.version_number}</option>`).join('')}</select>
            </div>
        `, [{ label: 'Compare', type: 'primary', action: `app.compareVersions(${fileId})` }]);
    };

    const compareVersions = async (fileId) => {
        const v1 = await DataStore.getById('document_versions', parseInt(document.getElementById('v1').value));
        const v2 = await DataStore.getById('document_versions', parseInt(document.getElementById('v2').value));
        UI.showModal('Comparison', `<div class="diff-view"><pre>${v1.data || ''}</pre><pre>${v2.data || ''}</pre></div>`, [{ label: 'Close', type: 'primary', action: 'UI.hideModal()' }]);
    };

    const downloadVersion = (versionId) => { UI.toast.info(`Downloading version ${versionId}...`); };
    const restoreVersion = async (versionId) => {
        const ver = await DataStore.getById('document_versions', versionId);
        await DataStore.update('documents', ver.document_id, { current_version: ver.version_number, updatedAt: new Date().toISOString() });
        UI.toast.success(`Restored to version ${ver.version_number}`); UI.hideModal(); await loadFolderContents();
    };

    const openShareModal = async (fileId) => {
        const file = await DataStore.getById('documents', fileId);
        const users = (await DataStore.getAll('users')).filter(u => u.id !== _currentUser?.id);
        const shares = (await DataStore.getAll('document_shares')).filter(s => s.document_id === fileId);
        const content = `
            <div class="share-modal">
                <h3>Share: ${file.filename}</h3>
                <div class="share-form">
                    <select id="share-user" class="form-control"><option value="">Select User...</option>${users.map(u => `<option value="${u.id}">${u.full_name}</option>`).join('')}</select>
                    <button class="btn primary" onclick="app.createShare(${fileId})">Add Share</button>
                </div>
                <div class="share-list">
                    ${(await Promise.all(shares.map(async s => `<div class="share-item">${(await DataStore.getById('users', s.shared_with))?.full_name} (${s.permission}) <button onclick="app.removeShare(${s.id})">x</button></div>`))).join('')}
                </div>
            </div>
        `;
        UI.showModal('Share Document', content, [{ label: 'Done', type: 'primary', action: 'UI.hideModal()' }]);
    };

    const createShare = async (fileId) => {
        const userId = parseInt(document.getElementById('share-user').value);
        if (!userId) return;
        await DataStore.create('document_shares', { id: Date.now(), document_id: fileId, shared_with: userId, permission: 'view', shared_by: _currentUser?.id });
        await openShareModal(fileId);
    };

    const removeShare = async (id) => { await DataStore.delete('document_shares', id); UI.toast.success('Share removed'); UI.hideModal(); };

    const initDefaultFolders = async () => {
        if (await DataStore.getAll('folders').length === 0) {
            const defaults = [
                { id: 1, name: 'Company Policies', color: '#3b82f6', parent_id: null },
                { id: 2, name: 'Customer Documents', color: '#10b981', parent_id: null },
                { id: 3, name: 'Agent Agreements', color: '#f59e0b', parent_id: null },
                { id: 4, name: 'Marketing Materials', color: '#ef4444', parent_id: null }
            ];
            for (const f of defaults) {
                await DataStore.create('folders', f);
            }
        }
    };

    const initSampleDocuments = async () => {
        if (await DataStore.getAll('documents').length === 0) {
            await DataStore.create('documents', { id: 101, filename: 'Welcome Guide.pdf', folder_id: 1, size: 1024 * 500, created_at: new Date().toISOString() });
            await DataStore.create('documents', { id: 102, filename: 'Privacy Policy.docx', folder_id: 1, size: 1024 * 200, created_at: new Date().toISOString() });
        }
    };

    const getFilesInCurrentFolder = async () => {
        let files = await DataStore.getAll('documents');

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
                    <button class="btn primary" onclick="app.openUploadModal()">
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
                            <input type="checkbox" onchange="app.async selectAllFiles()" 
                                   ${_selectedFiles.length === files.length && files.length > 0 ? 'checked' : ''}>
                        </th>
                        <th onclick="app.sortFiles('name')" style="cursor: pointer;">
                            Name ${_fileSortBy === 'name' ? (_fileSortDirection === 'asc' ? '↑' : '↓') : ''}
                        </th>
                        <th onclick="app.sortFiles('date')" style="cursor: pointer;">
                            Modified ${_fileSortBy === 'date' ? (_fileSortDirection === 'asc' ? '↑' : '↓') : ''}
                        </th>
                        <th onclick="app.sortFiles('size')" style="cursor: pointer;">
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
                                <input type="checkbox" onchange="app.toggleFileSelection(${file.id})" 
                                       ${_selectedFiles.includes(file.id) ? 'checked' : ''}>
                            </td>
                            <td ondblclick="app.previewFile(${file.id})">
                                <i class="fas ${getFileIcon(file.filename)} file-icon"></i>
                                <span class="file-name">${file.filename}</span>
                                ${file.is_starred ? '<i class="fas fa-star starred"></i>' : ''}
                            </td>
                            <td>${new Date(file.updated_at || file.created_at).toLocaleString()}</td>
                            <td>${(file.size > 1048576 ? (file.size / 1048576).toFixed(1) + " MB" : (file.size / 1024).toFixed(0) + " KB")}</td>
                            <td>
                                <div class="action-buttons" style="display: flex; gap: 4px;">
                                    <button class="btn-icon" onclick="app.previewFile(${file.id}); event.stopPropagation();" title="Preview">
                                        <i class="fas fa-eye"></i>
                                    </button>
                                    <button class="btn-icon" onclick="app.downloadFile(${file.id}); event.stopPropagation();" title="Download">
                                        <i class="fas fa-download"></i>
                                    </button>
                                    <button class="btn-icon" onclick="app.showVersionHistory(${file.id}); event.stopPropagation();" title="Versions">
                                        <i class="fas fa-history"></i>
                                    </button>
                                    <button class="btn-icon" onclick="app.openShareModal(${file.id}); event.stopPropagation();" title="Share">
                                        <i class="fas fa-share-alt"></i>
                                    </button>
                                    <button class="btn-icon" onclick="app.showFileMetadata(${file.id}); event.stopPropagation();" title="Info">
                                        <i class="fas fa-info-circle"></i>
                                    </button>
                                    <button class="btn-icon" onclick="app.toggleStar(${file.id}); event.stopPropagation();" title="Star">
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
                    <button class="btn primary" onclick="app.async openUploadModal()">
                        <i class="fas fa-upload"></i> Upload Files
                    </button>
                </div>
            `;
            return;
        }

        let html = '<div class="file-grid">';

        for (const file of files) {
            html += `
                <div class="file-card ${_selectedFiles.includes(file.id) ? 'selected' : ''}" 
                     data-id="${file.id}"
                     draggable="true"
                     ondragstart="app.handleFileDragStart(event, ${file.id})"
                     ondragend="app.handleFileDragEnd(event)">
                    <div class="file-card-header">
                        <input type="checkbox" onchange="app.toggleFileSelection(${file.id})" 
                               ${_selectedFiles.includes(file.id) ? 'checked' : ''} 
                               onclick="event.stopPropagation()">
                        <button class="btn-icon" onclick="app.toggleStar(${file.id}); event.stopPropagation();" title="Star">
                            <i class="fas fa-star${file.is_starred ? '' : '-o'}"></i>
                        </button>
                    </div>
                    <div class="file-card-icon" ondblclick="app.previewFile(${file.id})">
                        <i class="fas ${getFileIcon(file.filename)} fa-4x"></i>
                    </div>
                    <div class="file-card-name" title="${file.filename}">${truncateFilename(file.filename, 20)}</div>
                    <div class="file-card-meta">
                        <span>${(file.size > 1048576 ? (file.size / 1048576).toFixed(1) + " MB" : (file.size / 1024).toFixed(0) + " KB")}</span>
                        <span>${new Date(file.updated_at || file.created_at).toLocaleDateString()}</span>
                    </div>
                    <div class="file-card-actions">
                        <button class="btn-icon" onclick="app.previewFile(${file.id}); event.stopPropagation();" title="Preview">
                            <i class="fas fa-eye"></i>
                        </button>
                        <button class="btn-icon" onclick="app.downloadFile(${file.id}); event.stopPropagation();" title="Download">
                            <i class="fas fa-download"></i>
                        </button>
                        <button class="btn-icon" onclick="app.showVersionHistory(${file.id}); event.stopPropagation();" title="Versions">
                            <i class="fas fa-history"></i>
                        </button>
                        <button class="btn-icon" onclick="app.openShareModal(${file.id}); event.stopPropagation();" title="Share">
                            <i class="fas fa-share-alt"></i>
                        </button>
                    </div>
                </div>
            `;
        }

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
                <button class="btn-icon" onclick="app.deleteSelected()" title="Delete Selected">
                    <i class="fas fa-trash"></i>
                </button>
                <button class="btn-icon" onclick="app.deselectAll()" title="Clear Selection">
                    <i class="fas fa-times"></i>
                </button>
            </div>
        `;
    };
