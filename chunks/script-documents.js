/**
 * CRM Lazy Chunk: Document Management System
 *
 * Self-contained IIFE. Accesses shared state through window.* globals only.
 * Loaded on-demand by navigateTo() when user navigates to the 'documents' view.
 *
 * Extracted 2026-06-05 from script.js PHASE 11 (~981 lines).
 * External dependencies: window.AppDataStore, window.UI, window.app,
 *   window._appState.cu (current user), window._crmUtils.escapeHtml
 */
(() => {
    const _state = window._appState;
    const esc    = (s) => window._crmUtils.escapeHtml(s);
    const escapeHtml = esc;
    const getVisibleUserIds = (u) => window._crmUtils.getVisibleUserIds(u);
    // Post-split missing aliases — getFileIcon/formatFileSize live on _crmUtils
    // (script.js); getFileExtension was never exported, so define it locally.
    // (Fixes the latent `getFileIcon is not defined` / `formatFileSize is not
    // defined` ReferenceErrors that threw whenever files/sizes rendered.)
    const getFileIcon = (filename) => window._crmUtils.getFileIcon(filename);
    const formatFileSize = (bytes) => window._crmUtils.formatFileSize(bytes);
    const getFileExtension = (filename) => (filename || '').split('.').pop().toLowerCase();
    // File-type predicates live as private `const`s inside the script.js IIFE and
    // were never exported, so previewFile() threw `isImageFile is not defined`.
    // Define them locally here (mirroring getFileExtension above).
    const isImageFile = (fn) => ['jpg', 'jpeg', 'png', 'gif', 'bmp', 'svg', 'webp'].includes(getFileExtension(fn));
    const isPdfFile = (fn) => getFileExtension(fn) === 'pdf';
    const isTextFile = (fn) => ['txt', 'csv', 'json', 'xml', 'html', 'css', 'js', 'md', 'rtf'].includes(getFileExtension(fn));
    // Scheme guard for untrusted file.data values flowing into href/src/iframe sinks.
    // Only allow inline data: URLs and http(s) — blocks javascript:/data:text/html XSS.
    const isSafeFileData = (s) => typeof s === 'string' && /^(data:|https?:)/i.test(s) && !/^data:text\/html/i.test(s);
    const isSafeImageData = (s) => typeof s === 'string' && (/^data:image\//i.test(s) || /^https?:/i.test(s));
    const isSafePdfData = (s) => typeof s === 'string' && (/^data:application\/pdf/i.test(s) || /^https?:/i.test(s));
    // ── Chunk-local state (documents view only) ──
    let _currentFolder = null;
    let _viewMode = 'list';
    let _selectedFiles = [];
    let _fileSortBy = 'name';
    let _fileSortDirection = 'asc';
    let _fileFilter = '';
    let _draggedFileId = null;

    // ── Metadata-only documents fetch (excludes the heavy base64 `data` blob) ──
    // Every folder/list render used getAll('documents'), which selects `*` for
    // this table (documents is NOT in data.js `_lightSelects`), pulling the large
    // base64 `data` column for EVERY row — a multi-hundred-MB download on each
    // render. The listing UI never reads `data`; the blob is fetched lazily only
    // when a file is actually opened/downloaded (downloadFile/previewFile/
    // downloadSelected use getById/full docs). queryPaged accepts an explicit
    // `select` column list and pages through the whole table with no silent cap,
    // so this returns the SAME complete row set as getAll — just without the blob.
    // Falls back to getAll('documents') on any throw so the offline/local-snapshot
    // resilience of getAll is preserved.
    const DOC_LIST_COLUMNS =
        'id,filename,folder_id,size,mime_type,current_version,created_by,created_at,updated_at,description,is_starred';
    const getDocumentsMeta = async () => {
        try {
            return await AppDataStore.queryPaged('documents', { select: DOC_LIST_COLUMNS });
        } catch (e) {
            try { console.warn('[documents] metadata queryPaged failed, falling back to getAll:', e && e.message); } catch (_) {}
            return (await AppDataStore.getAll('documents')) || [];
        }
    };

    // React-island flag (default-on, PROMOTED 2026-06-16 after opt-in verification:
    // useEffect-driven populate confirmed live — folder tree + files + breadcrumb
    // populate, matching legacy). Kill-switch → legacy: window.__REACT_DMS===false,
    // ?react=0, crm_react_off='1'.
    const _reactDocumentsOn = () => {
        try {
            if (window.__REACT_DMS === false) return false;
            if (/[?&]react=0/.test(location.search)) return false;
            if (localStorage.getItem('crm_react_off') === '1') return false;
            return !!(window.CRMReact && typeof window.CRMReact.mountDocuments === 'function');
        } catch (_) { return false; }
    };

    // NEW (default-OFF) flag: full real-JSX render path. ON only when the URL has
    // ?react_dms_jsx=1 OR localStorage crm_react_dms_jsx==='1' (same detection
    // idiom as the existing flag, different param). When OFF the view keeps the
    // current scaffold-shell + by-id onReady fill BYTE-FOR-BYTE. The JSX path is
    // best-effort and gated entirely behind this flag.
    const _reactDmsJsxOn = () => {
        // PROMOTED (SW-107): full-JSX render is the DEFAULT.
        // Kill-switch: ?react_dms_jsx=0 or localStorage crm_react_dms_jsx='0'.
        try {
            if (/[?&]react_dms_jsx=0/.test(location.search)) return false;
            if (localStorage.getItem('crm_react_dms_jsx') === '0') return false;
            return true;
        } catch (_) { return true; }
    };

    // ── Builder: full plain-serializable payload for the JSX render path ──
    // Returns objects/arrays/strings/numbers (NEVER HTML strings) describing the
    // complete explorer content: the recursive folder tree (flattened with depth),
    // the breadcrumb trail, the current folder's filtered+sorted files, the active
    // view mode, the current selection, and the toolbar/sort state. Mirrors exactly
    // what renderFolderTree() / loadFolderContents() / renderBreadcrumb() /
    // updateBatchActions() pull today. Throwing is caught by the caller, which then
    // degrades to data:undefined + the existing onReady fill.
    const buildDocumentsIslandData = async () => {
        const [allFolders, allDocs] = await Promise.all([
            AppDataStore.getAll('folders'),
            // Listing render: metadata-only fetch (never pulls the heavy base64 blob).
            getDocumentsMeta(),
        ]);
        const folders = (allFolders || []);
        const docs = (allDocs || []);

        // Flattened folder tree (pre-order DFS) with depth + hasChildren + active.
        const childrenOf = (pid) => folders
            .filter(f => f.parent_id === pid)
            .sort((a, b) => String(a.name || '').localeCompare(String(b.name || '')));
        const tree = [];
        const walk = (pid, level) => {
            for (const f of childrenOf(pid)) {
                const hasChildren = folders.some(c => c.parent_id === f.id);
                tree.push({
                    id: f.id,
                    name: f.name || '',
                    color: f.color || '#f59e0b',
                    level,
                    hasChildren,
                    active: _currentFolder === f.id,
                });
                if (hasChildren) walk(f.id, level + 1);
            }
        };
        walk(null, 0);

        // Breadcrumb trail (Root + ancestors of current folder, when in a real folder).
        const breadcrumb = [];
        if (_currentFolder && _currentFolder !== 'recent' && _currentFolder !== 'all' && _currentFolder !== 'starred') {
            const byId = new Map(folders.map(f => [String(f.id), f]));
            let curr = byId.get(String(_currentFolder));
            const seen = new Set();
            const trail = [];
            while (curr && !seen.has(String(curr.id))) {
                seen.add(String(curr.id));
                trail.unshift({ id: curr.id, name: curr.name || '' });
                curr = curr.parent_id ? byId.get(String(curr.parent_id)) : null;
            }
            breadcrumb.push(...trail);
        }

        // Current folder's files — replicate getFilesInCurrentFolder() + sort.
        let files;
        if (_currentFolder === 'recent') {
            files = docs.slice().sort((a, b) => new Date(b.updated_at || b.created_at) - new Date(a.updated_at || a.created_at)).slice(0, 20);
        } else if (_currentFolder === 'all') {
            files = docs.slice();
        } else if (_currentFolder === 'starred') {
            files = docs.filter(d => d.is_starred);
        } else {
            if (_currentFolder) {
                files = docs.filter(f => f.folder_id === _currentFolder);
            } else {
                files = docs.filter(f => !f.folder_id || f.folder_id === 'root');
            }
            if (_fileFilter) {
                const q = _fileFilter.toLowerCase();
                files = files.filter(f =>
                    (f.filename && f.filename.toLowerCase().includes(q)) ||
                    (f.description && f.description.toLowerCase().includes(q)));
            }
        }
        // recent/all/starred views skip the search filter in the legacy path
        // (they call renderFileListView directly), so only the folder branch above
        // applies _fileFilter — matching legacy behavior.
        files = files.slice().sort((a, b) => {
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
            if (_fileSortDirection === 'asc') return valA > valB ? 1 : -1;
            return valA < valB ? 1 : -1;
        });

        const fileRows = files.map(f => ({
            id: f.id,
            filename: f.filename || '',
            iconClass: getFileIcon(f.filename),
            isStarred: !!f.is_starred,
            sizeLabel: (f.size > 1048576 ? (f.size / 1048576).toFixed(1) + ' MB' : (f.size / 1024).toFixed(0) + ' KB'),
            modifiedLabel: new Date(f.updated_at || f.created_at).toLocaleString(),
            modifiedDateLabel: new Date(f.updated_at || f.created_at).toLocaleDateString(),
            selected: _selectedFiles.includes(f.id),
        }));

        return {
            viewMode: _viewMode,
            sortBy: _fileSortBy,
            sortDirection: _fileSortDirection,
            fileFilter: _fileFilter,
            currentFolder: _currentFolder,
            tree,
            breadcrumb,
            files: fileRows,
            selectedCount: _selectedFiles.length,
            allSelected: _selectedFiles.length === fileRows.length && fileRows.length > 0,
        };
    };

    // ── Builder: legacy (non-React) explorer shell HTML ──
    // Pure string-building extracted verbatim from showDocumentManagementView's
    // legacy innerHTML assignment. Takes the view mode it reads (the only
    // interpolated module var) and RETURNS the identical HTML string. The
    // orchestrator keeps all data fetching, the React path, early return, and the
    // trailing renderFolderTree()/loadFolderContents() awaits.
    const buildDocumentsShellHtml = (viewMode) => {
        return `
            <div class="dms-view">
                <div class="dms-header">
                    <div>
                        <h1>Document Management System</h1>
                        <p>Manage, organize, and share your documents</p>
                    </div>
                    <div class="dms-actions">
                        <button class="btn primary" onclick="app.openUploadModal()">
                            <i class="fas fa-upload"></i> Upload File
                        </button>
                        <button class="btn secondary" onclick="app.openNewFolderModal()">
                            <i class="fas fa-folder-plus"></i> New Folder
                        </button>
                    </div>
                </div>
                
                <div class="dms-layout">
                    <div class="folder-sidebar">
                        <div class="sidebar-header">
                            <h3>Folders</h3>
                            <button class="btn-icon" onclick="app.refreshFolderTree()" title="Refresh">
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
                                    <input type="text" id="file-search" placeholder="Search files..." onkeyup="app.debounceCall('file-search', () => app.searchFiles(this.value), 220)">
                                    <select id="file-sort" class="form-control" onchange="app.sortFiles(this.value)">
                                        <option value="name">Sort by Name</option>
                                        <option value="date">Sort by Date</option>
                                        <option value="size">Sort by Size</option>
                                    </select>
                                    <div class="view-toggle">
                                        <button class="btn-icon ${viewMode === 'list' ? 'active' : ''}" onclick="app.setViewMode('list')">
                                            <i class="fas fa-list"></i>
                                        </button>
                                        <button class="btn-icon ${viewMode === 'grid' ? 'active' : ''}" onclick="app.setViewMode('grid')">
                                            <i class="fas fa-th-large"></i>
                                        </button>
                                    </div>
                                </div>
                                <div id="batch-actions"></div>
                            </div>
                            
                            <div class="special-filters" style="margin-top: 15px; display: flex; gap: 10px;">
                                <button class="btn link-btn" onclick="app.showRecentFiles()"><i class="fas fa-clock"></i> Recent</button>
                                <button class="btn link-btn" onclick="app.showAllFiles()"><i class="fas fa-copy"></i> All Files</button>
                                <button class="btn link-btn" onclick="app.showStarredFiles()"><i class="fas fa-star"></i> Starred</button>
                            </div>
                        </div>
                        
                        <div class="file-container" id="file-container"></div>
                    </div>
                </div>
            </div>
        `;
    };

    const showDocumentManagementView = async (container) => {
        // React scaffold-shell — island renders the static shell; the chunk then
        // populates #folder-tree + #file-container via the SAME renderFolderTree()
        // + loadFolderContents() as the legacy path (drag-drop + all rendering
        // unchanged). rAF-wait so the populate runs after React commits the DOM.
        if (_reactDocumentsOn()) {
            try {
                container.innerHTML = '<div id="dms-react-root"></div>';

                // NEW JSX path (default-OFF): when _reactDmsJsxOn() AND the payload
                // builds without throwing, pass data:<payload> and suppress the
                // by-id onReady fill (the JSX view owns the DOM). On ANY build throw,
                // OR when the flag is off, fall back to data:undefined + the EXACT
                // existing onReady by-id fill — byte-for-byte the current behavior.
                let _jsxData; // undefined unless the new flag is on AND build succeeds
                if (_reactDmsJsxOn()) {
                    try {
                        _jsxData = await buildDocumentsIslandData();
                    } catch (be) {
                        _jsxData = undefined; // degrade to legacy scaffold fill, never blank
                        try { console.warn('[documents] JSX payload build failed, falling back to scaffold fill:', be && be.message); } catch (_) {}
                    }
                }

                // Populate via the island's useEffect (post-commit) — reliable, unlike
                // the chunk-side rAF that left the view empty in the 2026-06-16 incident.
                window.CRMReact.mountDocuments(document.getElementById('dms-react-root'), {
                    viewMode: _viewMode,
                    data: _jsxData,
                    // When the JSX path is active the view renders from props.data and
                    // owns the DOM, so the by-id fill must NOT run (it would write into
                    // React-owned nodes). When data is undefined, pass the EXACT existing
                    // onReady so the scaffold-fill path is unchanged.
                    onReady: _jsxData ? (() => {}) : (() => { renderFolderTree(); loadFolderContents(); }),
                });
                return;
            } catch (e) {
                console.warn('[documents] island mount failed, falling back to legacy:', e && e.message);
                // fall through to the legacy render below
            }
        }

        container.innerHTML = buildDocumentsShellHtml(_viewMode);
        await renderFolderTree();
        await loadFolderContents();
    };

    const renderFolderTree = async (parentId = null, level = 0, container = null, _cachedFolders = null) => {
        const treeContainer = container || document.getElementById('folder-tree');
        if (!treeContainer) return;
        if (parentId === null) treeContainer.innerHTML = '';

        const allFolders = _cachedFolders || await AppDataStore.getAll('folders');
        const folders = allFolders
            .filter(f => f.parent_id === parentId)
            .sort((a, b) => String(a.name || '').localeCompare(String(b.name || '')));

        for (const folder of folders) {
            const hasChildren = allFolders.some(f => f.parent_id === folder.id);
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
                    <span class="folder-name">${escapeHtml(folder.name || '')}</span>
                </div>
                <div class="folder-actions">
                    <button class="btn-icon" aria-label="Rename folder" onclick="app.renameFolder(${folder.id}); event.stopPropagation()"><i class="fas fa-edit" aria-hidden="true"></i></button>
                    <button class="btn-icon" aria-label="Delete folder" onclick="app.deleteFolder(${folder.id}); event.stopPropagation()"><i class="fas fa-trash" aria-hidden="true"></i></button>
                </div>
            `;
            treeContainer.appendChild(div);
            if (hasChildren) await renderFolderTree(folder.id, level + 1, treeContainer, allFolders);
        }
    };

    const renderBreadcrumb = async () => {
        const container = document.getElementById('breadcrumb');
        if (!container) return;
        const path = [];
        if (_currentFolder && _currentFolder !== 'recent' && _currentFolder !== 'all' && _currentFolder !== 'starred') {
            // One cached getAll beats N sequential getById calls up the hierarchy
            const allFolders = (await AppDataStore.getAll('folders')) || [];
            const byId = new Map(allFolders.map(f => [String(f.id), f]));
            let curr = byId.get(String(_currentFolder));
            const seen = new Set();
            while (curr && !seen.has(String(curr.id))) {
                seen.add(String(curr.id));
                path.unshift(curr);
                curr = curr.parent_id ? byId.get(String(curr.parent_id)) : null;
            }
        }

        let html = '<span class="breadcrumb-item" onclick="app.navigateToFolder(null)">Root</span>';
        for (const f of path) { html += `<span class="breadcrumb-separator">/</span><span class="breadcrumb-item" onclick="app.navigateToFolder(${f.id})">${escapeHtml(f.name || '')}</span>`; }
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
        `, [{ label: 'Cancel', type: 'secondary', action: 'UI.hideModal()' }, { label: 'Create', type: 'primary', action: '(async () => { await app.createFolder(); })()' }]);
    };

    const createFolder = async () => {
        const name = document.getElementById('new-folder-name')?.value;
        if (!name) return UI.toast.error('Name required');
        // Omit client-generated id — let the DB assign a uuid/serial (Date.now()
        // collides under concurrency). Optional-chain the color input (modal may
        // have been torn down between click and async resolution).
        // Normalize the special-view sentinels ('recent'/'all'/'starred') back to
        // Root (null) so we never persist a junk parent_id that no folder filter matches.
        const _parentId = (_currentFolder === 'recent' || _currentFolder === 'all' || _currentFolder === 'starred') ? null : _currentFolder;
        await AppDataStore.create('folders', { name, parent_id: _parentId, color: document.getElementById('new-folder-color')?.value || '#f59e0b', created_by: _state.cu?.id, created_at: new Date().toISOString() });
        UI.hideModal(); UI.toast.success('Folder created'); await renderFolderTree();
    };

    const renameFolder = async (id) => {
        const folder = await AppDataStore.getById('folders', id);
        if (!folder) { UI.toast.error("Folder not found"); return; }
        UI.showModal('Rename Folder', `<div class="form-group"><label>New Name</label><input type="text" id="rename-folder-input" class="form-control" value="${escapeHtml(folder.name || '')}"></div>`,
            [{ label: 'Cancel', type: 'secondary', action: 'UI.hideModal()' }, { label: 'Rename', type: 'primary', action: `(async () => { await app.confirmRenameFolder(${id}); })()` }]);
    };
    window.app.confirmRenameFolder = async (id) => {
        const name = document.getElementById('rename-folder-input')?.value;
        if (!name) return;
        await AppDataStore.update('folders', id, { name }); UI.hideModal(); await renderFolderTree(); await renderBreadcrumb();
    };

    const deleteFolder = async (id) => {
        const [allFoldersForDel, allDocsForDel] = await Promise.all([AppDataStore.getAll('folders'), getDocumentsMeta()]);
        const hasSub = allFoldersForDel.some(f => f.parent_id === id);
        const hasFiles = allDocsForDel.some(d => d.folder_id === id);
        if (hasSub || hasFiles) return UI.toast.error('Cannot delete: Folder is not empty');
        UI.showModal('Delete Folder', '<p>Are you sure?</p>', [{ label: 'Cancel', type: 'secondary', action: 'UI.hideModal()' }, { label: 'Delete', type: 'primary', action: `(async () => { await app.confirmDeleteFolder(${id}); })()` }]);
    };
    // Self-provided here (Phase 8) — mirrors confirmRenameFolder above. Previously
    // this DMS handler lived only in the marketing chunk + the retired
    // script-features.js, so on the Documents-delete path it could be undefined
    // (load-order bug). Bound to THIS chunk's folder helpers/_currentFolder.
    window.app.confirmDeleteFolder = async (id) => {
        try {
            await AppDataStore.delete('folders', id);
            UI.hideModal();
            if (_currentFolder === id) _currentFolder = null;
            UI.toast.success('Folder deleted');
            await renderFolderTree();
            await loadFolderContents();
        } catch (err) {
            UI.toast.error('Delete failed: ' + (err.message || 'Unknown error'));
        }
    };

    // Set state FIRST, then let loadFolderContents() handle rendering — this honors
    // _viewMode (grid vs list), refreshes the breadcrumb and batch-action bar, and
    // keeps _currentFolder consistent for any concurrent re-render (matches
    // navigateToFolder). getFilesInCurrentFolder() resolves the special modes.
    const showRecentFiles = async () => { _currentFolder = 'recent'; await loadFolderContents(); };
    const showAllFiles = async () => { _currentFolder = 'all'; await loadFolderContents(); };
    const showStarredFiles = async () => { _currentFolder = 'starred'; await loadFolderContents(); };

    const toggleStar = async (id) => {
        // Optimistic: flip the star icon in-place immediately, persist + refresh in background.
        const starBtn = document.querySelector(`[data-star-id="${id}"]`);
        const f = await AppDataStore.getById('documents', id);
        if (!f) return;
        const next = !f.is_starred;
        if (starBtn) starBtn.classList.toggle('active', next);
        try {
            await AppDataStore.update('documents', id, { is_starred: next });
        } catch (e) {
            if (starBtn) starBtn.classList.toggle('active', !next); // revert on failure
            UI.toast.error('Could not update star');
            return;
        }
        // The chunk-rendered list/grid star buttons carry no [data-star-id], so the
        // optimistic starBtn flip above is a no-op in the non-React path — always
        // re-render so the icon (fa-star vs fa-star-o) and the starred marker reflect
        // the new DB state instead of silently desyncing.
        await loadFolderContents();
    };

    const downloadFile = async (id) => {
        const file = await AppDataStore.getById('documents', id);
        if (!file) { UI.toast.error('File not found'); return; }
        const src = file.data;
        if (!src || src === '#') { UI.toast.error('File content not available — please re-upload the file'); return; }
        // Reject non-data/http(s) schemes (e.g. javascript:) before assigning to href.
        if (!isSafeFileData(src)) { UI.toast.error('File content not available — please re-upload the file'); return; }
        const a = document.createElement('a');
        a.href = src;
        a.download = file.filename || 'download';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        UI.toast.success(`Downloading ${file.filename}`);
    };

    const handleFileDragStart = (e, id) => { _draggedFileId = id; e.dataTransfer.setData('text/plain', id); e.target.classList.add('dragging'); };
    const handleFileDragEnd = (e) => { e.target.classList.remove('dragging'); _draggedFileId = null; };
    const handleDropOnFolder = async (e, folderId) => {
        e.preventDefault();
        const fileId = parseInt(e.dataTransfer.getData('text/plain'));
        if (fileId) { await AppDataStore.update('documents', fileId, { folder_id: folderId }); UI.toast.success('Moved successfully'); await loadFolderContents(); await renderFolderTree(); }
    };

    const showVersionHistory = async (fileId) => {
        const [file, allVersions, allUsersForVer] = await Promise.all([
            AppDataStore.getById('documents', fileId),
            AppDataStore.getAll('document_versions'),
            AppDataStore.getAll('users')
        ]);
        // getById can return null (row deleted concurrently / RLS deny / offline) —
        // guard before dereferencing file.filename / file.current_version below.
        if (!file) { UI.toast.error('File not found'); return; }
        const versions = allVersions.filter(v => v.document_id === fileId).sort((a, b) => b.version_number - a.version_number);
        const verUserMap = new Map(allUsersForVer.map(u => [String(u.id), u.full_name]));
        const content = `
            <div class="version-history">
                <div class="version-header"><h3>Version History: ${escapeHtml(file.filename || '')}</h3><p>Current: v${file.current_version || 1}</p></div>
                <table class="version-table">
                    <thead><tr><th scope="col">Version</th><th scope="col">Date</th><th scope="col">Size</th><th scope="col">By</th><th scope="col">Notes</th><th scope="col">Actions</th></tr></thead>
                    <tbody>
                        ${versions.map(v => `
                            <tr class="${v.version_number === file.current_version ? 'current-version' : ''}">
                                <td>v${v.version_number}</td>
                                <td>${new Date(v.created_at).toLocaleString()}</td>
                                <td>${formatFileSize(v.size)}</td>
                                <td>${escapeHtml(verUserMap.get(String(v.created_by)) || 'System')}</td>
                                <td>${escapeHtml(v.change_note || '-')}</td>
                                <td>
                                    <button class="btn-icon" aria-label="Download version" onclick="app.downloadVersion(${v.id})"><i class="fas fa-download" aria-hidden="true"></i></button>
                                    <button class="btn-icon" aria-label="Restore version" onclick="app.restoreVersion(${v.id})"><i class="fas fa-undo" aria-hidden="true"></i></button>
                                </td>
                            </tr>
                        `).join('')}
                    </tbody>
                </table>
                ${versions.length >= 2 ? `<div class="compare-row"><button class="btn secondary" onclick="app.showCompareTool(${fileId})">Compare Versions</button></div>` : ''}
            </div>
        `;
        UI.showModal('Version History', content, [{ label: 'Close', type: 'primary', action: 'UI.hideModal()' }]);
    };

    const showCompareTool = async (fileId) => {
        const versions = (await AppDataStore.getAll('document_versions')).filter(v => v.document_id === fileId);
        UI.showModal('Compare Versions', `
            <div class="compare-setup">
                <select id="v1" class="form-control">${versions.map(v => `<option value="${v.id}">Version ${v.version_number}</option>`).join('')}</select>
                <span>vs</span>
                <select id="v2" class="form-control">${versions.map(v => `<option value="${v.id}">Version ${v.version_number}</option>`).join('')}</select>
            </div>
        `, [{ label: 'Compare', type: 'primary', action: `(async () => { await app.compareVersions(${fileId}); })()` }]);
    };

    const compareVersions = async (fileId) => {
        const v1El = document.getElementById('v1');
        const v2El = document.getElementById('v2');
        if (!v1El || !v2El) return;
        const v1 = await AppDataStore.getById('document_versions', parseInt(v1El.value));
        const v2 = await AppDataStore.getById('document_versions', parseInt(v2El.value));
        // getById can return null (RLS deny / offline / removed) — guard before deref.
        if (!v1 || !v2) { UI.toast.error('Version not found'); return; }
        UI.showModal('Comparison', `<div class="diff-view"><pre>${escapeHtml(v1.data || '')}</pre><pre>${escapeHtml(v2.data || '')}</pre></div>`, [{ label: 'Close', type: 'primary', action: 'UI.hideModal()' }]);
    };

    const downloadVersion = (versionId) => { UI.toast.info(`Downloading version ${versionId}...`); };
    const restoreVersion = async (versionId) => {
        const ver = await AppDataStore.getById('document_versions', versionId);
        // getById can return null (RLS deny / offline / removed) — guard before deref.
        if (!ver) { UI.toast.error('Version not found'); return; }
        // Column is snake_case `updated_at` (matches the rest of this file); camelCase
        // `updatedAt` targets a non-existent column and the modified time never bumps.
        await AppDataStore.update('documents', ver.document_id, { current_version: ver.version_number, updated_at: new Date().toISOString() });
        UI.toast.success(`Restored to version ${ver.version_number}`); UI.hideModal(); await loadFolderContents();
    };

    const openShareModal = async (fileId) => {
        // Fetch everything we need in parallel. Previously this did 3 sequential
        // awaits plus N getById('users', ...) inside the shares.map — now users
        // are fetched once and re-used from a Map.
        const [file, allUsers, allShares] = await Promise.all([
            AppDataStore.getById('documents', fileId),
            AppDataStore.getAll('users'),
            AppDataStore.getAll('document_shares'),
        ]);
        // getById can return null (row deleted concurrently / RLS deny / offline) —
        // guard before dereferencing file.filename below.
        if (!file) { UI.toast.error('File not found'); return; }
        const userMap = new Map((allUsers || []).map(u => [String(u.id), u]));
        // Scope share targets to the current user's visibility set (role system) —
        // a low-level agent must not be able to enumerate / share to the whole org.
        // getVisibleUserIds is ASYNC (await it) and returns the string 'all' for
        // admins (L1-2) — treat that as "no restriction" rather than Set('all').
        const _visibleIds = await getVisibleUserIds(_state.cu);
        const _allVisible = _visibleIds === 'all';
        const visible = _allVisible ? null : new Set((_visibleIds || []).map(String));
        const users = (allUsers || []).filter(u => u.id !== _state.cu?.id && (_allVisible || visible.has(String(u.id))));
        const shares = (allShares || []).filter(s => s.document_id === fileId);
        const shareItems = shares.map(s => {
            const user = userMap.get(String(s.shared_with));
            return `<div class="share-item">${escapeHtml(user?.full_name || 'Unknown')} (${escapeHtml(s.permission)}) <button onclick="app.removeShare(${s.id})">x</button></div>`;
        });

        const content = `
            <div class="share-modal">
                <h3>Share: ${escapeHtml(file.filename)}</h3>
                <div class="share-form">
                    <select id="share-user" class="form-control"><option value="">Select User...</option>${users.map(u => `<option value="${escapeHtml(u.id)}">${escapeHtml(u.full_name)}</option>`).join('')}</select>
                    <button class="btn primary" onclick="app.createShare(${fileId})">Add Share</button>
                </div>
                <div class="share-list">
                    ${shareItems.join('')}
                </div>
            </div>
        `;
        UI.showModal('Share Document', content, [{ label: 'Done', type: 'primary', action: 'UI.hideModal()' }]);
    };

    const createShare = async (fileId) => {
        // Optional-chain the select (modal DOM may be gone before the async handler).
        const userId = parseInt(document.getElementById('share-user')?.value);
        if (!userId) return;
        // Omit client-generated id — let the DB assign it (Date.now() collides under
        // concurrency / skewed clocks → PK 409 or silent overwrite).
        await AppDataStore.create('document_shares', { document_id: fileId, shared_with: userId, permission: 'view', shared_by: _state.cu?.id });
        await openShareModal(fileId);
    };

    const removeShare = async (id) => { await AppDataStore.delete('document_shares', id); UI.toast.success('Share removed'); UI.hideModal(); };

    const initDefaultFolders = async () => {
        const existing = await AppDataStore.getAll('folders');
        if (!existing || existing.length === 0) {
            const defaults = [
                { id: 1, name: 'Company Policies', color: '#3b82f6', parent_id: null },
                { id: 2, name: 'Customer Documents', color: '#10b981', parent_id: null },
                { id: 3, name: 'Agent Agreements', color: '#f59e0b', parent_id: null },
                { id: 4, name: 'Marketing Materials', color: '#ef4444', parent_id: null }
            ];
            for (const f of defaults) {
                await AppDataStore.create('folders', f);
            }
        }
    };

    const initSampleDocuments = async () => {
        if (((await getDocumentsMeta()) || []).length === 0) {
            await AppDataStore.create('documents', { id: 101, filename: 'Welcome Guide.pdf', folder_id: 1, size: 1024 * 500, created_at: new Date().toISOString() });
            await AppDataStore.create('documents', { id: 102, filename: 'Privacy Policy.docx', folder_id: 1, size: 1024 * 200, created_at: new Date().toISOString() });
        }
    };

    const getFilesInCurrentFolder = async () => {
        // Listing render: metadata-only fetch (never pulls the heavy base64 blob).
        // The blob is fetched lazily by getById only when a file is opened/downloaded.
        let files = (await getDocumentsMeta()) || [];

        // Special views — mirror buildDocumentsIslandData so loadFolderContents()
        // can drive Recent/All/Starred uniformly (honoring _viewMode + batch actions).
        if (_currentFolder === 'recent') {
            return files.slice().sort((a, b) => new Date(b.updated_at || b.created_at) - new Date(a.updated_at || a.created_at)).slice(0, 20);
        } else if (_currentFolder === 'all') {
            return files.slice();
        } else if (_currentFolder === 'starred') {
            return files.filter(d => d.is_starred);
        }

        // Filter by current folder
        if (_currentFolder) {
            files = files.filter(f => f.folder_id === _currentFolder);
        } else {
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
                        <th scope="col" style="width: 30px;">
                            <input type="checkbox" onchange="app.selectAllFiles(this.checked)"
                                   ${_selectedFiles.length === files.length && files.length > 0 ? 'checked' : ''}>
                        </th>
                        <th scope="col" onclick="app.sortFiles('name')" style="cursor: pointer;">
                            Name ${_fileSortBy === 'name' ? (_fileSortDirection === 'asc' ? '↑' : '↓') : ''}
                        </th>
                        <th scope="col" onclick="app.sortFiles('date')" style="cursor: pointer;">
                            Modified ${_fileSortBy === 'date' ? (_fileSortDirection === 'asc' ? '↑' : '↓') : ''}
                        </th>
                        <th scope="col" onclick="app.sortFiles('size')" style="cursor: pointer;">
                            Size ${_fileSortBy === 'size' ? (_fileSortDirection === 'asc' ? '↑' : '↓') : ''}
                        </th>
                        <th scope="col">Actions</th>
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
                                <span class="file-name">${escapeHtml(file.filename || '')}</span>
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
                    <button class="btn primary" onclick="app.openUploadModal()">
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
                    <div class="file-card-name" title="${escapeHtml(file.filename || '')}">${escapeHtml(truncateFilename(file.filename, 20))}</div>
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

    const toggleFileSelection = async (fileId) => {
        const index = _selectedFiles.indexOf(fileId);
        if (index === -1) {
            _selectedFiles.push(fileId);
        } else {
            _selectedFiles.splice(index, 1);
        }
        await loadFolderContents(); // Refresh to show selection
    };

    const selectAllFiles = async (checked = true) => {
        // Honor the header checkbox state: checked selects all, unchecked clears —
        // previously it re-selected everything in both directions (never de-selectable).
        if (checked) {
            const files = await getFilesInCurrentFolder();
            _selectedFiles = files.map(f => f.id);
        } else {
            _selectedFiles = [];
        }
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
                { label: 'Delete', type: 'primary', action: '(async () => { await app.confirmDeleteSelected(); })()' }
            ]
        );
    };

    const confirmDeleteSelected = async () => {
        for (const fileId of _selectedFiles) {
            await AppDataStore.delete('documents', fileId);
        }
        _selectedFiles = [];
        await loadFolderContents();
        UI.hideModal();
        UI.toast.success('Files deleted');
    };

    // Resolve the chunk-private selection (_selectedFiles = array of doc ids) into
    // the matching document records, dropping any that no longer exist. One getAll
    // beats N sequential getById round-trips.
    const _getSelectedDocs = async () => {
        const want = new Set(_selectedFiles.map(String));
        const all = (await AppDataStore.getAll('documents')) || [];
        return all.filter(d => want.has(String(d.id)));
    };

    // ── Move Selected ──────────────────────────────────────────────────
    // Opens a folder picker; confirmMoveSelected() persists the new folder_id.
    const moveSelected = async () => {
        if (_selectedFiles.length < 1) { UI.toast.info('Select one or more files first'); return; }
        try {
            const folders = ((await AppDataStore.getAll('folders')) || [])
                .slice()
                .sort((a, b) => String(a.name || '').localeCompare(String(b.name || '')));

            const options = ['<option value="">Root (no folder)</option>']
                .concat(folders.map(f => `<option value="${esc(String(f.id))}">${esc(f.name || 'Unnamed folder')}</option>`))
                .join('');

            const content = `
                <div class="batch-move-modal" style="padding:4px 0;">
                    <p style="margin-bottom:14px; color:var(--gray-600); font-size:14px;">
                        Move <strong>${_selectedFiles.length}</strong> selected file${_selectedFiles.length === 1 ? '' : 's'} to:
                    </p>
                    <select id="batch-move-target" class="form-control" style="width:100%;">${options}</select>
                </div>
            `;

            UI.showModal('Move Files', content, [
                { label: 'Cancel', type: 'secondary', action: 'UI.hideModal()' },
                { label: 'Move', type: 'primary', action: '(async () => { await app.confirmMoveSelected(); })()' }
            ]);
        } catch (err) {
            UI.toast.error('Could not load folders: ' + (err.message || 'Unknown error'));
        }
    };

    const confirmMoveSelected = async () => {
        if (_selectedFiles.length < 1) { UI.toast.info('Select one or more files first'); return; }
        const sel = document.getElementById('batch-move-target');
        const rawTarget = sel ? sel.value : '';
        // Empty string → Root (null folder_id). Otherwise coerce to number when numeric.
        let targetFolder = null;
        if (rawTarget !== '') {
            const n = Number(rawTarget);
            targetFolder = Number.isNaN(n) ? rawTarget : n;
        }

        try {
            let moved = 0;
            for (const id of _selectedFiles) {
                await AppDataStore.update('documents', id, {
                    folder_id: targetFolder,
                    updated_at: new Date().toISOString()
                });
                moved++;
            }
            _selectedFiles = [];
            UI.hideModal();
            await loadFolderContents();
            await renderFolderTree();
            UI.toast.success(`Moved ${moved} file${moved === 1 ? '' : 's'}`);
        } catch (err) {
            UI.toast.error('Move failed: ' + (err.message || 'Unknown error'));
        }
    };

    // ── Copy Selected (Share) ──────────────────────────────────────────
    // Build a plain-text reference summary (filename + any http(s) link the
    // record carries) and copy it to the clipboard. We intentionally do NOT mint
    // server-side share links — only surface what already exists on the record.
    // Data-URIs are skipped (not shareable as a reference).
    const copySelected = async () => {
        if (_selectedFiles.length < 1) { UI.toast.info('Select one or more files first'); return; }
        try {
            const docs = await _getSelectedDocs();
            if (docs.length === 0) { UI.toast.error('Selected files could not be found'); return; }

            const lines = docs.map(d => {
                const title = d.filename || ('File ' + d.id);
                const link = (typeof d.data === 'string' && /^https?:\/\//i.test(d.data)) ? d.data : '';
                return link ? `${title} — ${link}` : title;
            });
            const summary = lines.join('\n');

            if (!(navigator.clipboard && navigator.clipboard.writeText)) {
                throw new Error('Clipboard unavailable');
            }
            await navigator.clipboard.writeText(summary);
            UI.toast.success(`Copied ${docs.length} reference${docs.length === 1 ? '' : 's'}`);
        } catch (err) {
            UI.toast.error('Copy failed: ' + (err.message || 'Clipboard unavailable'));
        }
    };

    // ── Download Selected ──────────────────────────────────────────────
    // Single OR multi: trigger the same per-file download mechanism downloadFile
    // uses (anchor + record's `data` src). Counts started vs skipped (no content).
    const downloadSelected = async () => {
        if (_selectedFiles.length < 1) { UI.toast.info('Select one or more files first'); return; }
        try {
            const docs = await _getSelectedDocs();
            if (docs.length === 0) { UI.toast.error('Selected files could not be found'); return; }

            let started = 0;
            let skipped = 0;
            for (const d of docs) {
                const src = d.data;
                // Skip empty or non-data/http(s) scheme values (XSS / navigation guard).
                if (!src || src === '#' || !isSafeFileData(src)) { skipped++; continue; }
                const a = document.createElement('a');
                a.href = src;
                a.download = d.filename || ('download_' + d.id);
                document.body.appendChild(a);
                a.click();
                document.body.removeChild(a);
                started++;
            }

            if (started === 0) {
                UI.toast.error('No downloadable content on the selected files');
            } else if (skipped > 0) {
                UI.toast.success(`Downloading ${started} file${started === 1 ? '' : 's'} (${skipped} skipped — no content)`);
            } else {
                UI.toast.success(`Downloading ${started} file${started === 1 ? '' : 's'}`);
            }
        } catch (err) {
            UI.toast.error('Download failed: ' + (err.message || 'Unknown error'));
        }
    };

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

    const MAX_UPLOAD_SIZE_MB = 20;
    const MAX_UPLOAD_SIZE_BYTES = MAX_UPLOAD_SIZE_MB * 1024 * 1024;
    const ALLOWED_UPLOAD_EXTENSIONS = /\.(pdf|doc|docx|xls|xlsx|csv|txt|png|jpg|jpeg|gif|webp|mp4|mov|zip|json)$/i;

    const handleFileSelect = (files) => {
        const list = document.getElementById('upload-list');
        if (!list) return;

        const oversized = [];
        const badType = [];
        const valid = [];

        Array.from(files).forEach(file => {
            if (file.size > MAX_UPLOAD_SIZE_BYTES) {
                oversized.push(file.name);
            } else if (!ALLOWED_UPLOAD_EXTENSIONS.test(file.name)) {
                badType.push(file.name);
            } else {
                valid.push(file);
            }
        });

        if (oversized.length) UI.toast.error(`File too large (max ${MAX_UPLOAD_SIZE_MB}MB): ${oversized.join(', ')}`);
        if (badType.length) UI.toast.error(`File type not allowed: ${badType.join(', ')}`);

        window._pendingUploads = valid;

        let html = '<h4 style="margin: 16px 0 8px; font-size: 14px;">Files to upload:</h4><ul style="list-style: none; padding: 0;">';
        valid.forEach(file => {
            html += `<li style="padding: 6px 0; border-bottom: 1px solid #eee; font-size: 13px;"><i class="fas ${getFileIcon(file.name)}"></i> ${escapeHtml(file.name)} (${(file.size > 1048576 ? (file.size / 1048576).toFixed(1) + ' MB' : (file.size / 1024).toFixed(0) + ' KB')})</li>`;
        });
        html += '</ul>';

        list.innerHTML = html;
    };

    const uploadFiles = async () => {
        const files = window._pendingUploads || [];
        if (files.length === 0) {
            UI.toast.error('No files selected');
            return;
        }

        // Show progress
        const progressEl = document.getElementById('upload-progress');
        const progressFillEl = document.getElementById('upload-progress-fill');
        const progressStatusEl = document.getElementById('upload-status');
        if (progressEl) progressEl.style.display = 'block';

        let uploaded = 0;
        const total = files.length;

        // Normalize the special-view sentinels ('recent'/'all'/'starred') back to
        // Root (null) so uploaded docs are never saved with a junk folder_id that no
        // folder filter matches (and, on a bigint column, would 400 the insert).
        const _targetFolder = (_currentFolder === 'recent' || _currentFolder === 'all' || _currentFolder === 'starred') ? null : _currentFolder;

        for (const [index, file] of files.entries()) {
            const dataUrl = await new Promise((resolve, reject) => {
                const reader = new FileReader();
                reader.onload = e => resolve(e.target.result);
                reader.onerror = () => reject(new Error('Read failed'));
                reader.readAsDataURL(file);
            });

            const newDoc = {
                filename: file.name,
                folder_id: _targetFolder,
                size: file.size,
                mime_type: file.type,
                data: dataUrl,
                current_version: 1,
                created_by: _state.cu?.id,
                created_at: new Date().toISOString(),
                updated_at: new Date().toISOString(),
                description: '',
                is_starred: false
            };

            await AppDataStore.create('documents', newDoc);

            uploaded++;
            const percent = (uploaded / total) * 100;
            if (progressFillEl) progressFillEl.style.width = percent + '%';
            if (progressStatusEl) progressStatusEl.textContent = `Uploaded ${uploaded} of ${total} files`;
        }

        // Clear the staged batch so reopening the modal (or a double Upload click)
        // does not re-create the same documents. handleFileSelect repopulates it.
        window._pendingUploads = [];

        setTimeout(async () => {
            UI.hideModal();
            UI.toast.success(`${total} files uploaded successfully`);
            await loadFolderContents();
        }, 300);
    };

    const previewFile = async (fileId) => {
        const file = await AppDataStore.getById('documents', fileId);
        if (!file) return;

        const filename = file.filename;
        const ext = getFileExtension(filename);

        let previewContent = '';

        if (isImageFile(filename)) {
            // Only allow data:image/* or http(s) src; escape it too. A raw file.data
            // with a double-quote could break out of the attribute and inject onerror.
            const imgSrc = isSafeImageData(file.data) ? file.data : 'https://via.placeholder.com/800x600?text=Image+Preview';
            previewContent = `
                <div class="image-preview" style="text-align: center;">
                    <img loading="lazy" decoding="async" src="${escapeHtml(imgSrc)}"
                         alt="${escapeHtml(filename || '')}" style="max-width: 100%; max-height: 70vh; border-radius: 8px; box-shadow: 0 4px 12px rgba(0,0,0,0.1);">
                </div>
            `;
        } else if (isPdfFile(filename)) {
            // Only allow data:application/pdf or http(s); reject data:text/html and
            // javascript: payloads (stored cross-user XSS via shared documents).
            // Sandbox the iframe (no allow-scripts/allow-same-origin) as defense in depth.
            const pdfSrc = isSafePdfData(file.data) ? file.data : 'about:blank';
            previewContent = `
                <div class="pdf-preview">
                    <iframe src="${escapeHtml(pdfSrc)}" sandbox width="100%" height="600px" style="border: 1px solid #ddd; border-radius: 8px;"></iframe>
                </div>
            `;
        } else if (isTextFile(filename)) {
            previewContent = `
                <div class="text-preview">
                    <pre style="white-space: pre-wrap; font-family: monospace; padding: 20px; 
                               background: #f5f5f5; border-radius: 8px; max-height: 500px; overflow: auto; border: 1px solid #ddd;">
This is a preview of ${escapeHtml(file.filename || '')}
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
                    <h3 style="margin-top: 20px; font-size: 18px;">${escapeHtml(filename)}</h3>
                    <p style="color: var(--gray-500);">Size: ${(file.size > 1048576 ? (file.size / 1048576).toFixed(1) + " MB" : (file.size / 1024).toFixed(0) + " KB")}</p>
                    <p style="color: var(--gray-500);">Type: ${escapeHtml(file.mime_type || 'Unknown')}</p>
                    <p style="color: var(--gray-500);">Created: ${new Date(file.created_at).toLocaleString()}</p>
                    <p style="color: #666; margin-top: 20px; font-style: italic;">Preview not available for this file type</p>
                </div>
            `;
        }

        UI.showModal(`Preview: ${file.filename}`, previewContent, [
            { label: 'Download', type: 'secondary', action: `app.downloadFile(${fileId})` },
            { label: 'Share', type: 'secondary', action: `(async () => { await app.openShareModal(${fileId}); })()` },
            { label: 'Close', type: 'primary', action: 'UI.hideModal()' }
        ], 'fullscreen');
    };

    const showFileMetadata = async (fileId) => {
        const file = await AppDataStore.getById('documents', fileId);
        if (!file) return;

        const creator = file.created_by ? await AppDataStore.getById('users', file.created_by) : null;
        const versions = (await AppDataStore.getAll('document_versions')).filter(v => v.document_id === fileId);

        const content = `
            <div class="file-metadata">
                <div class="metadata-section">
                    <h4>File Information</h4>
                    <div class="metadata-grid">
                        <div class="metadata-row">
                            <span class="metadata-label">Name:</span>
                            <span class="metadata-value">${escapeHtml(file.filename || '')}</span>
                        </div>
                        <div class="metadata-row">
                            <span class="metadata-label">Size:</span>
                            <span class="metadata-value">${(file.size > 1048576 ? (file.size / 1048576).toFixed(1) + " MB" : (file.size / 1024).toFixed(0) + " KB")}</span>
                        </div>
                        <div class="metadata-row">
                            <span class="metadata-label">Type:</span>
                            <span class="metadata-value">${escapeHtml(file.mime_type || 'Unknown')}</span>
                        </div>
                        <div class="metadata-row">
                            <span class="metadata-label">Location:</span>
                            <span class="metadata-value">${escapeHtml(await getFolderPath(file.folder_id))}</span>
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
                            <span class="metadata-value">${escapeHtml(creator?.full_name || 'Unknown')}</span>
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
                        <p class="metadata-description">${escapeHtml(file.description)}</p>
                    </div>
                ` : ''}
            </div>
        `;

        UI.showModal('File Information', content, [
            { label: 'Edit Description', type: 'secondary', action: `(async () => { await app.editFileDescription(${fileId}); })()` },
            { label: 'Close', type: 'primary', action: 'UI.hideModal()' }
        ]);
    };

    const getFolderPath = async (folderId) => {
        if (!folderId) return 'Root';
        // One cached getAll beats N sequential getById calls up the hierarchy
        const allFolders = (await AppDataStore.getAll('folders')) || [];
        const byId = new Map(allFolders.map(f => [String(f.id), f]));
        const path = [];
        let current = byId.get(String(folderId));
        const seen = new Set();
        while (current && !seen.has(String(current.id))) {
            seen.add(String(current.id));
            path.unshift(current.name);
            current = current.parent_id ? byId.get(String(current.parent_id)) : null;
        }
        return path.join(' / ') || 'Root';
    };

    const editFileDescription = async (fileId) => {
        const file = await AppDataStore.getById('documents', fileId);
        // getById can return null (deleted between modal-open and click / RLS / offline).
        if (!file) { UI.toast.error('File not found'); return; }
        UI.showModal('Edit Description', `<div class="form-group"><label>Description</label><textarea id="edit-file-desc" class="form-control" rows="4">${escapeHtml(file.description || '')}</textarea></div>`,
            [{ label: 'Cancel', type: 'secondary', action: 'UI.hideModal()' }, { label: 'Save', type: 'primary', action: `(async () => { await app.saveFileDescription(${fileId}); })()` }]);
    };

    const saveFileDescription = async (fileId) => {
        const description = document.getElementById('edit-file-desc')?.value;
        await AppDataStore.update('documents', fileId, { description }); UI.hideModal(); UI.toast.success('Description updated'); await showFileMetadata(fileId);
    };

    console.log('App initializing...');

    // ── Attach public functions to window.app ────────────────────────────
    app.register('documents', {
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
        deleteFolder,
        showRecentFiles,
        showAllFiles,
        showStarredFiles,
        toggleStar,
        downloadFile,
        handleFileDragStart,
        handleFileDragEnd,
        handleDropOnFolder,
        showVersionHistory,
        showCompareTool,
        compareVersions,
        downloadVersion,
        restoreVersion,
        openShareModal,
        createShare,
        removeShare,
        loadFolderContents,
        updateBatchActions,
        toggleFileSelection,
        selectAllFiles,
        deselectAll,
        deleteSelected,
        confirmDeleteSelected,
        downloadSelected,
        copySelected,
        moveSelected,
        confirmMoveSelected,
        openUploadModal,
        handleFileSelect,
        uploadFiles,
        previewFile,
        showFileMetadata,
        editFileDescription,
        saveFileDescription,
    });
})();