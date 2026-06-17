// script-features.js — lazy-loaded on first navigation to a non-core view.
// Loaded AFTER script.js has fully executed. Extends window._fv with real
// implementations that script.js stubs delegate to.
//
// Skipped views (kept in script.js — need manual extraction later):
//   showMobileProspectsView, showStandardFunctionsView, showCustomersView,
//   showFormulaPurchaserView, showMarketingAutomationView,
//   showProtectionMonitoringView, showEggPurchasingView, showStockTakeView
(function () {
    'use strict';
    window._fv = window._fv || {};

// ══════════════ showDocumentManagementView ══════════════
window._fv = window._fv || {};
window._fv.showDocumentManagementView = async (container) => {
    const _currentUser = window._appState?.cu;
    const { escapeHtml, getFileIcon, formatFileSize } = window._crmUtils || {};

    // DMS-specific mutable state — stored on _appState so they survive re-renders
    const st = window._appState;
    if (st.cf === undefined) st.cf = null;          // _currentFolder
    if (st.vm === undefined) st.vm = 'list';         // _viewMode
    if (st.sf === undefined) st.sf = [];             // _selectedFiles
    if (st.fsb === undefined) st.fsb = 'name';       // _fileSortBy
    if (st.fsd === undefined) st.fsd = 'asc';        // _fileSortDirection
    if (st.ff === undefined) st.ff = '';             // _fileFilter
    if (st.dfi === undefined) st.dfi = null;         // _draggedFileId

    // ── Local helpers (defined as consts so they can reference each other) ──

    const getFileExtension = (filename) => {
        if (!filename) return '';
        return filename.split('.').pop().toLowerCase();
    };

    const isImageFile = (filename) => {
        const imageExts = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg', 'bmp', 'ico'];
        return imageExts.includes(getFileExtension(filename));
    };

    const isPdfFile = (filename) => {
        return getFileExtension(filename) === 'pdf';
    };

    const isTextFile = (filename) => {
        const textExts = ['txt', 'csv', 'json', 'xml', 'html', 'htm', 'css', 'js', 'md'];
        return textExts.includes(getFileExtension(filename));
    };

    const truncateFilename = (filename, maxLength) => {
        if (!filename) return '';
        if (filename.length <= maxLength) return filename;
        const ext = filename.split('.').pop();
        const name = filename.substring(0, filename.lastIndexOf('.'));
        const truncated = name.substring(0, maxLength - ext.length - 3);
        return truncated + '...' + ext;
    };

    const renderFolderTree = async (parentId = null, level = 0, treeContainerArg = null, _cachedFolders = null) => {
        const treeContainer = treeContainerArg || document.getElementById('folder-tree');
        if (!treeContainer) return;
        if (parentId === null) treeContainer.innerHTML = '';

        const allFolders = _cachedFolders || await window.AppDataStore.getAll('folders');
        const folders = allFolders
            .filter(f => f.parent_id === parentId)
            .sort((a, b) => a.name.localeCompare(b.name));

        for (const folder of folders) {
            const hasChildren = allFolders.some(f => f.parent_id === folder.id);
            const isActive = st.cf === folder.id;

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
        const bc = document.getElementById('breadcrumb');
        if (!bc) return;
        const path = [];
        if (st.cf && st.cf !== 'recent' && st.cf !== 'all' && st.cf !== 'starred') {
            const allFolders = (await window.AppDataStore.getAll('folders')) || [];
            const byId = new Map(allFolders.map(f => [String(f.id), f]));
            let curr = byId.get(String(st.cf));
            const seen = new Set();
            while (curr && !seen.has(String(curr.id))) {
                seen.add(String(curr.id));
                path.unshift(curr);
                curr = curr.parent_id ? byId.get(String(curr.parent_id)) : null;
            }
        }

        let html = '<span class="breadcrumb-item" onclick="app.navigateToFolder(null)">Root</span>';
        for (const f of path) { html += `<span class="breadcrumb-separator">/</span><span class="breadcrumb-item" onclick="app.navigateToFolder(${f.id})">${escapeHtml(f.name || '')}</span>`; }
        bc.innerHTML = html;
    };

    const getFilesInCurrentFolder = async () => {
        let files = await window.AppDataStore.getAll('documents');

        if (st.cf && st.cf !== 'recent' && st.cf !== 'all' && st.cf !== 'starred') {
            files = files.filter(f => f.folder_id === st.cf);
        } else if (!st.cf) {
            files = files.filter(f => !f.folder_id || f.folder_id === 'root');
        }

        if (st.ff) {
            const query = st.ff.toLowerCase();
            files = files.filter(f =>
                (f.filename && f.filename.toLowerCase().includes(query)) ||
                (f.description && f.description.toLowerCase().includes(query))
            );
        }

        return files;
    };

    const updateBatchActions = async () => {
        const batchContainer = document.getElementById('batch-actions');
        if (!batchContainer) return;

        if (st.sf.length === 0) {
            batchContainer.style.display = 'none';
            return;
        }

        batchContainer.style.display = 'block';
        batchContainer.innerHTML = `
            <div class="batch-actions-bar">
                <span class="selected-count">${st.sf.length} selected</span>
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

    const renderFileListView = async (files) => {
        const fileContainer = document.getElementById('file-container');
        if (!fileContainer) return;

        if (files.length === 0) {
            fileContainer.innerHTML = `
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
                            <input type="checkbox" onchange="app.selectAllFiles()"
                                   ${st.sf.length === files.length && files.length > 0 ? 'checked' : ''}>
                        </th>
                        <th scope="col" onclick="app.sortFiles('name')" style="cursor: pointer;">
                            Name ${st.fsb === 'name' ? (st.fsd === 'asc' ? '↑' : '↓') : ''}
                        </th>
                        <th scope="col" onclick="app.sortFiles('date')" style="cursor: pointer;">
                            Modified ${st.fsb === 'date' ? (st.fsd === 'asc' ? '↑' : '↓') : ''}
                        </th>
                        <th scope="col" onclick="app.sortFiles('size')" style="cursor: pointer;">
                            Size ${st.fsb === 'size' ? (st.fsd === 'asc' ? '↑' : '↓') : ''}
                        </th>
                        <th scope="col">Actions</th>
                    </tr>
                </thead>
                <tbody>
                    ${files.map(file => `
                        <tr class="file-item ${st.sf.includes(file.id) ? 'selected' : ''}"
                            data-id="${file.id}"
                            draggable="true"
                            ondragstart="app.handleFileDragStart(event, ${file.id})"
                            ondragend="app.handleFileDragEnd(event)">
                            <td onclick="event.stopPropagation()">
                                <input type="checkbox" onchange="app.toggleFileSelection(${file.id})"
                                       ${st.sf.includes(file.id) ? 'checked' : ''}>
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

        fileContainer.innerHTML = html;
    };

    const renderFileGridView = async (files) => {
        const fileContainer = document.getElementById('file-container');
        if (!fileContainer) return;

        if (files.length === 0) {
            fileContainer.innerHTML = `
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
                <div class="file-card ${st.sf.includes(file.id) ? 'selected' : ''}"
                     data-id="${file.id}"
                     draggable="true"
                     ondragstart="app.handleFileDragStart(event, ${file.id})"
                     ondragend="app.handleFileDragEnd(event)">
                    <div class="file-card-header">
                        <input type="checkbox" onchange="app.toggleFileSelection(${file.id})"
                               ${st.sf.includes(file.id) ? 'checked' : ''}
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
        fileContainer.innerHTML = html;
    };

    const loadFolderContents = async () => {
        const fileContainer = document.getElementById('file-container');
        if (!fileContainer) return;

        const files = await getFilesInCurrentFolder();

        files.sort((a, b) => {
            let valA, valB;

            if (st.fsb === 'name') {
                valA = a.filename ? a.filename.toLowerCase() : '';
                valB = b.filename ? b.filename.toLowerCase() : '';
            } else if (st.fsb === 'date') {
                valA = new Date(a.updated_at || a.created_at);
                valB = new Date(b.updated_at || b.created_at);
            } else if (st.fsb === 'size') {
                valA = a.size || 0;
                valB = b.size || 0;
            }

            if (st.fsd === 'asc') {
                return valA > valB ? 1 : -1;
            } else {
                return valA < valB ? 1 : -1;
            }
        });

        if (st.vm === 'list') {
            await renderFileListView(files);
        } else {
            await renderFileGridView(files);
        }

        await renderBreadcrumb();
        await updateBatchActions();
    };

    // ── Expose helpers on window.app so inline onclick handlers can reach them ──

    window.app.navigateToFolder = async (id) => {
        st.cf = id;
        st.sf = [];
        await loadFolderContents();
        await renderFolderTree();
    };

    window.app.setViewMode = async (mode) => { st.vm = mode; await loadFolderContents(); };
    window.app.sortFiles = async (sortBy) => { st.fsb = sortBy; await loadFolderContents(); };
    window.app.searchFiles = async (q) => { st.ff = q; await loadFolderContents(); };
    window.app.refreshFolderTree = async () => { await renderFolderTree(); };

    window.app.openNewFolderModal = async () => {
        window.UI.showModal('New Folder', `
            <div class="form-group"><label>Folder Name</label><input type="text" id="new-folder-name" class="form-control" placeholder="Enter name..."></div>
            <div class="form-group"><label>Label Color</label><input type="color" id="new-folder-color" class="form-control" value="#f59e0b"></div>
        `, [{ label: 'Cancel', type: 'secondary', action: 'UI.hideModal()' }, { label: 'Create', type: 'primary', action: '(async () => { await app.createFolder(); })()' }]);
    };

    window.app.createFolder = async () => {
        const name = document.getElementById('new-folder-name')?.value;
        if (!name) return window.UI.toast.error('Name required');
        await window.AppDataStore.create('folders', { id: Date.now(), name, parent_id: st.cf, color: document.getElementById('new-folder-color').value, created_by: _currentUser?.id, created_at: new Date().toISOString() });
        window.UI.hideModal(); window.UI.toast.success('Folder created'); await renderFolderTree();
    };

    window.app.renameFolder = async (id) => {
        const folder = await window.AppDataStore.getById('folders', id);
        window.UI.showModal('Rename Folder', `<div class="form-group"><label>New Name</label><input type="text" id="rename-folder-input" class="form-control" value="${escapeHtml(folder.name || '')}"></div>`,
            [{ label: 'Cancel', type: 'secondary', action: 'UI.hideModal()' }, { label: 'Rename', type: 'primary', action: `(async () => { await app.confirmRenameFolder(${id}); })()` }]);
    };

    window.app.confirmRenameFolder = async (id) => {
        const name = document.getElementById('rename-folder-input')?.value;
        if (!name) return;
        await window.AppDataStore.update('folders', id, { name }); window.UI.hideModal(); await renderFolderTree(); await renderBreadcrumb();
    };

    window.app.deleteFolder = async (id) => {
        const [allFoldersForDel, allDocsForDel] = await Promise.all([window.AppDataStore.getAll('folders'), window.AppDataStore.getAll('documents')]);
        const hasSub = allFoldersForDel.some(f => f.parent_id === id);
        const hasFiles = allDocsForDel.some(d => d.folder_id === id);
        if (hasSub || hasFiles) return window.UI.toast.error('Cannot delete: Folder is not empty');
        window.UI.showModal('Delete Folder', '<p>Are you sure?</p>', [{ label: 'Cancel', type: 'secondary', action: 'UI.hideModal()' }, { label: 'Delete', type: 'primary', action: `(async () => { await app.confirmDeleteFolder(${id}); })()` }]);
    };

    window.app.confirmDeleteFolder = async (id) => {
        try {
            await window.AppDataStore.delete('folders', id);
            window.UI.hideModal();
            if (st.cf === id) st.cf = null;
            window.UI.toast.success('Folder deleted');
            await renderFolderTree();
            await loadFolderContents();
        } catch (err) {
            window.UI.toast.error('Delete failed: ' + (err.message || 'Unknown error'));
        }
    };

    window.app.showRecentFiles = async () => {
        const allFiles = (await window.AppDataStore.getAll('documents')).sort((a, b) => new Date(b.updated_at || b.created_at) - new Date(a.updated_at || a.created_at));
        await renderFileListView(allFiles.slice(0, 20));
        st.cf = 'recent'; await renderBreadcrumb();
    };

    window.app.showAllFiles = async () => {
        await renderFileListView(await window.AppDataStore.getAll('documents'));
        st.cf = 'all'; await renderBreadcrumb();
    };

    window.app.showStarredFiles = async () => {
        await renderFileListView((await window.AppDataStore.getAll('documents')).filter(d => d.is_starred));
        st.cf = 'starred'; await renderBreadcrumb();
    };

    window.app.toggleStar = async (id) => {
        const starBtn = document.querySelector(`[data-star-id="${id}"]`);
        const f = await window.AppDataStore.getById('documents', id);
        if (!f) return;
        const next = !f.is_starred;
        if (starBtn) starBtn.classList.toggle('active', next);
        try {
            await window.AppDataStore.update('documents', id, { is_starred: next });
        } catch (e) {
            if (starBtn) starBtn.classList.toggle('active', !next);
            window.UI.toast.error('Could not update star');
            return;
        }
        if (st.cf === 'starred') await loadFolderContents();
    };

    window.app.downloadFile = async (id) => {
        const file = await window.AppDataStore.getById('documents', id);
        if (!file) { window.UI.toast.error('File not found'); return; }
        const src = file.data;
        if (!src || src === '#') { window.UI.toast.error('File content not available — please re-upload the file'); return; }
        const a = document.createElement('a');
        a.href = src;
        a.download = file.filename || 'download';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        window.UI.toast.success(`Downloading ${file.filename}`);
    };

    window.app.handleFileDragStart = (e, id) => {
        st.dfi = id;
        e.dataTransfer.setData('text/plain', id);
        e.target.classList.add('dragging');
    };

    window.app.handleFileDragEnd = (e) => {
        e.target.classList.remove('dragging');
        st.dfi = null;
    };

    window.app.handleDropOnFolder = async (e, folderId) => {
        e.preventDefault();
        const fileId = parseInt(e.dataTransfer.getData('text/plain'));
        if (fileId) {
            await window.AppDataStore.update('documents', fileId, { folder_id: folderId });
            window.UI.toast.success('Moved successfully');
            await loadFolderContents();
            await renderFolderTree();
        }
    };

    window.app.showVersionHistory = async (fileId) => {
        const [file, allVersions, allUsersForVer] = await Promise.all([
            window.AppDataStore.getById('documents', fileId),
            window.AppDataStore.getAll('document_versions'),
            window.AppDataStore.getAll('users')
        ]);
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
        window.UI.showModal('Version History', content, [{ label: 'Close', type: 'primary', action: 'UI.hideModal()' }]);
    };

    window.app.showCompareTool = async (fileId) => {
        const versions = (await window.AppDataStore.getAll('document_versions')).filter(v => v.document_id === fileId);
        window.UI.showModal('Compare Versions', `
            <div class="compare-setup">
                <select id="v1" class="form-control">${versions.map(v => `<option value="${v.id}">Version ${v.version_number}</option>`).join('')}</select>
                <span>vs</span>
                <select id="v2" class="form-control">${versions.map(v => `<option value="${v.id}">Version ${v.version_number}</option>`).join('')}</select>
            </div>
        `, [{ label: 'Compare', type: 'primary', action: `app.compareVersions(${fileId})` }]);
    };

    window.app.compareVersions = async (fileId) => {
        const v1 = await window.AppDataStore.getById('document_versions', parseInt(document.getElementById('v1').value));
        const v2 = await window.AppDataStore.getById('document_versions', parseInt(document.getElementById('v2').value));
        window.UI.showModal('Comparison', `<div class="diff-view"><pre>${escapeHtml(v1.data || '')}</pre><pre>${escapeHtml(v2.data || '')}</pre></div>`, [{ label: 'Close', type: 'primary', action: 'UI.hideModal()' }]);
    };

    window.app.downloadVersion = (versionId) => { window.UI.toast.info(`Downloading version ${versionId}...`); };

    window.app.restoreVersion = async (versionId) => {
        const ver = await window.AppDataStore.getById('document_versions', versionId);
        await window.AppDataStore.update('documents', ver.document_id, { current_version: ver.version_number, updatedAt: new Date().toISOString() });
        window.UI.toast.success(`Restored to version ${ver.version_number}`); window.UI.hideModal(); await loadFolderContents();
    };

    window.app.openShareModal = async (fileId) => {
        const [file, allUsers, allShares] = await Promise.all([
            window.AppDataStore.getById('documents', fileId),
            window.AppDataStore.getAll('users'),
            window.AppDataStore.getAll('document_shares'),
        ]);
        const userMap = new Map((allUsers || []).map(u => [String(u.id), u]));
        const users = (allUsers || []).filter(u => u.id !== _currentUser?.id);
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
        window.UI.showModal('Share Document', content, [{ label: 'Done', type: 'primary', action: 'UI.hideModal()' }]);
    };

    window.app.createShare = async (fileId) => {
        const userId = parseInt(document.getElementById('share-user').value);
        if (!userId) return;
        await window.AppDataStore.create('document_shares', { id: Date.now(), document_id: fileId, shared_with: userId, permission: 'view', shared_by: _currentUser?.id });
        await window.app.openShareModal(fileId);
    };

    window.app.removeShare = async (id) => { await window.AppDataStore.delete('document_shares', id); window.UI.toast.success('Share removed'); window.UI.hideModal(); };

    window.app.toggleFileSelection = async (fileId) => {
        const index = st.sf.indexOf(fileId);
        if (index === -1) { st.sf.push(fileId); } else { st.sf.splice(index, 1); }
        await loadFolderContents();
    };

    window.app.selectAllFiles = async () => {
        const files = await getFilesInCurrentFolder();
        st.sf = files.map(f => f.id);
        await loadFolderContents();
    };

    window.app.deselectAll = async () => {
        st.sf = [];
        await loadFolderContents();
    };

    window.app.deleteSelected = async () => {
        if (st.sf.length === 0) return;
        window.UI.showModal('Delete Files',
            `<p>Are you sure you want to delete ${st.sf.length} file(s)?</p>
<p class="text-error">This action cannot be undone.</p>`,
            [
                { label: 'Cancel', type: 'secondary', action: 'UI.hideModal()' },
                { label: 'Delete', type: 'primary', action: '(async () => { await app.confirmDeleteSelected(); })()' }
            ]
        );
    };

    window.app.confirmDeleteSelected = async () => {
        for (const fileId of st.sf) {
            await window.AppDataStore.delete('documents', fileId);
        }
        st.sf = [];
        await loadFolderContents();
        window.UI.hideModal();
        window.UI.toast.success('Files deleted');
    };

    window.app.downloadSelected = () => {
        if (st.sf.length === 1) {
            window.app.downloadFile(st.sf[0]);
        } else {
            window.UI.toast.info('Multiple download would create ZIP file');
        }
    };

    window.app.copySelected = () => { window.UI.toast.info('Copy selected files'); };
    window.app.moveSelected = () => { window.UI.toast.info('Move selected files'); };

    window.app.openUploadModal = async () => {
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

        window.UI.showModal('Upload Files', content, [
            { label: 'Cancel', type: 'secondary', action: 'UI.hideModal()' },
            { label: 'Upload', type: 'primary', action: 'app.uploadFiles()' }
        ]);

        setTimeout(window.app.initUploadDragDrop, 100);
    };

    window.app.initUploadDragDrop = () => {
        const dropZone = document.getElementById('upload-drop-zone');
        if (!dropZone) return;

        const preventDefaults = (e) => { e.preventDefault(); e.stopPropagation(); };
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
            window.app.handleFileSelect(dt.files);
        }, false);
    };

    const MAX_UPLOAD_SIZE_MB = 20;
    const MAX_UPLOAD_SIZE_BYTES = MAX_UPLOAD_SIZE_MB * 1024 * 1024;
    const ALLOWED_UPLOAD_EXTENSIONS = /\.(pdf|doc|docx|xls|xlsx|csv|txt|png|jpg|jpeg|gif|webp|mp4|mov|zip|json)$/i;

    window.app.handleFileSelect = (files) => {
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

        if (oversized.length) window.UI.toast.error(`File too large (max ${MAX_UPLOAD_SIZE_MB}MB): ${oversized.join(', ')}`);
        if (badType.length) window.UI.toast.error(`File type not allowed: ${badType.join(', ')}`);

        window._pendingUploads = valid;

        let html = '<h4 style="margin: 16px 0 8px; font-size: 14px;">Files to upload:</h4><ul style="list-style: none; padding: 0;">';
        valid.forEach(file => {
            html += `<li style="padding: 6px 0; border-bottom: 1px solid #eee; font-size: 13px;"><i class="fas ${getFileIcon(file.name)}"></i> ${escapeHtml(file.name)} (${(file.size > 1048576 ? (file.size / 1048576).toFixed(1) + ' MB' : (file.size / 1024).toFixed(0) + ' KB')})</li>`;
        });
        html += '</ul>';
        list.innerHTML = html;
    };

    window.app.uploadFiles = async () => {
        const files = window._pendingUploads || [];
        if (files.length === 0) { window.UI.toast.error('No files selected'); return; }

        document.getElementById('upload-progress').style.display = 'block';

        let uploaded = 0;
        const total = files.length;

        for (const [index, file] of files.entries()) {
            const dataUrl = await new Promise((resolve, reject) => {
                const reader = new FileReader();
                reader.onload = e => resolve(e.target.result);
                reader.onerror = () => reject(new Error('Read failed'));
                reader.readAsDataURL(file);
            });

            const newDoc = {
                id: Date.now() + index,
                filename: file.name,
                folder_id: st.cf,
                size: file.size,
                mime_type: file.type,
                data: dataUrl,
                current_version: 1,
                created_by: _currentUser?.id,
                created_at: new Date().toISOString(),
                updated_at: new Date().toISOString(),
                description: '',
                is_starred: false
            };

            await window.AppDataStore.create('documents', newDoc);

            uploaded++;
            const percent = (uploaded / total) * 100;
            document.getElementById('upload-progress-fill').style.width = percent + '%';
            document.getElementById('upload-status').textContent = `Uploaded ${uploaded} of ${total} files`;
        }

        setTimeout(async () => {
            window.UI.hideModal();
            window.UI.toast.success(`${total} files uploaded successfully`);
            await loadFolderContents();
        }, 300);
    };

    window.app.previewFile = async (fileId) => {
        const file = await window.AppDataStore.getById('documents', fileId);
        if (!file) return;

        const filename = file.filename;
        let previewContent = '';

        if (isImageFile(filename)) {
            previewContent = `
                <div class="image-preview" style="text-align: center;">
                    <img loading="lazy" decoding="async" src="${file.data || 'https://via.placeholder.com/800x600?text=Image+Preview'}"
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
                    <h3 style="margin-top: 20px; font-size: 18px;">${escapeHtml(filename)}</h3>
                    <p style="color: var(--gray-500);">Size: ${(file.size > 1048576 ? (file.size / 1048576).toFixed(1) + " MB" : (file.size / 1024).toFixed(0) + " KB")}</p>
                    <p style="color: var(--gray-500);">Type: ${escapeHtml(file.mime_type || 'Unknown')}</p>
                    <p style="color: var(--gray-500);">Created: ${new Date(file.created_at).toLocaleString()}</p>
                    <p style="color: #666; margin-top: 20px; font-style: italic;">Preview not available for this file type</p>
                </div>
            `;
        }

        window.UI.showModal(`Preview: ${file.filename}`, previewContent, [
            { label: 'Download', type: 'secondary', action: `app.downloadFile(${fileId})` },
            { label: 'Share', type: 'secondary', action: `(async () => { await app.openShareModal(${fileId}); })()` },
            { label: 'Close', type: 'primary', action: 'UI.hideModal()' }
        ], 'fullscreen');
    };

    window.app.showFileMetadata = async (fileId) => {
        const file = await window.AppDataStore.getById('documents', fileId);
        if (!file) return;

        const creator = file.created_by ? await window.AppDataStore.getById('users', file.created_by) : null;
        const versions = (await window.AppDataStore.getAll('document_versions')).filter(v => v.document_id === fileId);

        const getFolderPath = async (folderId) => {
            if (!folderId) return 'Root';
            const allFolders = (await window.AppDataStore.getAll('folders')) || [];
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

        window.UI.showModal('File Information', content, [
            { label: 'Edit Description', type: 'secondary', action: `(async () => { await app.editFileDescription(${fileId}); })()` },
            { label: 'Close', type: 'primary', action: 'UI.hideModal()' }
        ]);
    };

    window.app.editFileDescription = async (fileId) => {
        const file = await window.AppDataStore.getById('documents', fileId);
        window.UI.showModal('Edit Description', `<div class="form-group"><label>Description</label><textarea id="edit-file-desc" class="form-control" rows="4">${escapeHtml(file.description || '')}</textarea></div>`,
            [{ label: 'Cancel', type: 'secondary', action: 'UI.hideModal()' }, { label: 'Save', type: 'primary', action: `(async () => { await app.saveFileDescription(${fileId}); })()` }]);
    };

    window.app.saveFileDescription = async (fileId) => {
        const description = document.getElementById('edit-file-desc')?.value;
        await window.AppDataStore.update('documents', fileId, { description });
        window.UI.hideModal();
        window.UI.toast.success('Description updated');
        await window.app.showFileMetadata(fileId);
    };

    // ── Render the view ────────────────────────────────────────────────────
    container.innerHTML = `
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
                                    <button class="btn-icon ${st.vm === 'list' ? 'active' : ''}" onclick="app.setViewMode('list')">
                                        <i class="fas fa-list"></i>
                                    </button>
                                    <button class="btn-icon ${st.vm === 'grid' ? 'active' : ''}" onclick="app.setViewMode('grid')">
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
    await renderFolderTree();
    await loadFolderContents();
};

// ══════════════ showBookingSettingsView ══════════════
window._fv.showBookingSettingsView = async (container) => {
    const _currentUser = window._appState?.cu;
    const { escapeHtml } = window._crmUtils || {};

    window._appState.cv = 'booking_settings';
    const allSlots = await window.AppDataStore.getAll('booking_slots').catch(() => []);
    const agentSlots = allSlots.filter(s => s.agent_id === (_currentUser?.id || 1));
    const allAppts = await window.AppDataStore.getAll('booking_appointments').catch(() => []);
    const appointments = allAppts.filter(a => a.agent_id === (_currentUser?.id || 1))
        .sort((a, b) => (b.booking_date || '').localeCompare(a.booking_date || ''));
    const bookingUrl = `${window.location.origin}/booking.html?agent=${_currentUser?.id || 1}`;
    const dayNames = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];

    container.innerHTML = `
        <div style="padding:24px; max-width:1000px; margin:0 auto;">
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:24px;">
                <div>
                    <h1 style="font-size:24px; font-weight:700; margin:0;">Meeting Scheduler</h1>
                    <p style="color:var(--gray-500); margin:4px 0 0;">Let prospects book appointments directly via a shareable link.</p>
                </div>
                <button class="btn primary" onclick="app.openAddSlotModal()"><i class="fas fa-plus"></i> Add Time Slot</button>
            </div>
            <div style="background:var(--gray-50); border:1px solid var(--gray-200); border-radius:12px; padding:20px; margin-bottom:24px;">
                <h3 style="margin:0 0 8px; font-size:15px;">Your Booking Link</h3>
                <div style="display:flex; align-items:center; gap:12px;">
                    <input type="text" value="${bookingUrl}" readonly style="flex:1; padding:8px 12px; border:1px solid var(--border); border-radius:6px; background:white; font-size:13px;">
                    <button class="btn secondary" onclick="app.openShareBookingLinkModal()"><i class="fas fa-share-alt"></i> Share</button>
                    <a href="${bookingUrl}" target="_blank" rel="noopener noreferrer" class="btn secondary"><i class="fas fa-external-link-alt"></i> Preview</a>
                </div>
            </div>
            <div style="display:grid; grid-template-columns:1fr 1fr; gap:24px;">
                <div>
                    <h3 style="font-size:16px; font-weight:600; margin-bottom:12px;">Availability Slots</h3>
                    ${agentSlots.length === 0 ? `
                        <div style="text-align:center; padding:40px; background:white; border:1px solid var(--gray-200); border-radius:8px; color:var(--gray-400);">
                            <i class="fas fa-clock" style="font-size:32px; display:block; margin-bottom:8px;"></i>
                            No slots configured yet.
                        </div>
                    ` : agentSlots.map(slot => `
                        <div style="display:flex; align-items:center; justify-content:space-between; background:white; border:1px solid var(--gray-200); border-radius:8px; padding:12px 16px; margin-bottom:8px;">
                            <div>
                                <strong>${dayNames[slot.day_of_week]}</strong>
                                <span style="color:var(--gray-500); margin-left:8px;">${slot.start_time} – ${slot.end_time}</span>
                                <span style="color:var(--gray-400); font-size:12px; margin-left:8px;">${slot.duration_minutes}min slots</span>
                            </div>
                            <div style="display:flex; gap:8px; align-items:center;">
                                <label style="display:flex; align-items:center; gap:6px; font-size:13px; cursor:pointer;">
                                    <input type="checkbox" ${slot.is_active ? 'checked' : ''} onchange="app.toggleSlotActive(${slot.id}, this.checked)"> Active
                                </label>
                                <button class="btn-icon" aria-label="Delete time slot" onclick="app.deleteBookingSlot(${slot.id})" style="color:var(--error);"><i class="fas fa-trash" aria-hidden="true"></i></button>
                            </div>
                        </div>
                    `).join('')}
                </div>
                <div>
                    <h3 style="font-size:16px; font-weight:600; margin-bottom:12px;">Appointments <span style="font-size:13px; font-weight:400; color:var(--gray-400);">(${appointments.filter(a => a.status !== 'cancelled').length})</span></h3>
                    ${appointments.length === 0 ? `
                        <div style="text-align:center; padding:40px; background:white; border:1px solid var(--gray-200); border-radius:8px; color:var(--gray-400);">
                            <i class="fas fa-calendar" style="font-size:32px; display:block; margin-bottom:8px;"></i>
                            No bookings yet. Share your link to get started.
                        </div>
                    ` : appointments.slice(0, 10).map(appt => `
                        <div style="background:white; border:1px solid var(--gray-200); border-radius:8px; padding:12px 16px; margin-bottom:8px;">
                            <div style="display:flex; justify-content:space-between; align-items:flex-start;">
                                <div>
                                    <strong>${escapeHtml(appt.prospect_name || '')}</strong>
                                    <div style="font-size:12px; color:var(--gray-500);">${appt.booking_date} ${appt.start_time} · ${escapeHtml(appt.prospect_phone || appt.prospect_email || '')}</div>
                                    ${appt.referred_by ? `<div style="font-size:11px; color:var(--gray-400); margin-top:2px;"><i class="fas fa-user-friends" style="margin-right:3px;"></i>Ref: ${escapeHtml(appt.referred_by)}${appt.referral_relationship ? ` (${escapeHtml(appt.referral_relationship)})` : ''}</div>` : ''}
                                    ${appt.prospect_occupation || appt.prospect_company ? `<div style="font-size:11px; color:var(--gray-400); margin-top:2px;">${escapeHtml([appt.prospect_occupation, appt.prospect_company].filter(Boolean).join(' · '))}</div>` : ''}
                                </div>
                                <div style="display:flex; gap:6px;">
                                    ${appt.status === 'pending' ? `
                                        <button class="btn primary" style="padding:4px 10px; font-size:12px;" onclick="app.confirmBookingAppointment(${appt.id})">Confirm</button>
                                        <button class="btn secondary" style="padding:4px 10px; font-size:12px;" onclick="app.cancelBookingAppointment(${appt.id})">Cancel</button>
                                    ` : `<span style="font-size:12px; padding:4px 10px; border-radius:20px; background:${appt.status==='confirmed'?'#d1fae5':'#fee2e2'}; color:${appt.status==='confirmed'?'#065f46':'#991b1b'};">${appt.status}</span>`}
                                </div>
                            </div>
                        </div>
                    `).join('')}
                </div>
            </div>
        </div>
    `;
};

window._fv.openAddSlotModal = () => {
    window.UI.showModal('Add Availability Slot', `
        <div style="display:flex; flex-direction:column; gap:16px;">
            <div>
                <label style="display:block; font-weight:500; margin-bottom:6px;">Day of Week</label>
                <select id="slot-day" class="form-control">
                    <option value="1">Monday</option><option value="2">Tuesday</option><option value="3">Wednesday</option>
                    <option value="4">Thursday</option><option value="5">Friday</option><option value="6">Saturday</option><option value="0">Sunday</option>
                </select>
            </div>
            <div style="display:grid; grid-template-columns:1fr 1fr; gap:12px;">
                <div><label style="display:block; font-weight:500; margin-bottom:6px;">Start Time</label><input type="time" id="slot-start" class="form-control" value="09:00"></div>
                <div><label style="display:block; font-weight:500; margin-bottom:6px;">End Time</label><input type="time" id="slot-end" class="form-control" value="17:00"></div>
            </div>
            <div>
                <label style="display:block; font-weight:500; margin-bottom:6px;">Duration per Slot (minutes)</label>
                <select id="slot-duration" class="form-control">
                    <option value="30">30 minutes</option><option value="45">45 minutes</option>
                    <option value="60" selected>60 minutes</option><option value="90">90 minutes</option>
                </select>
            </div>
        </div>
    `, [
        { label: 'Cancel', type: 'secondary', action: 'UI.hideModal()' },
        { label: 'Save Slot', type: 'primary', action: '(async () => { await app.saveBookingSlot(); })()' }
    ]);
};

window._fv.saveBookingSlot = async () => {
    const _currentUser = window._appState?.cu;
    const start = document.getElementById('slot-start').value;
    const end = document.getElementById('slot-end').value;
    if (!start || !end || start >= end) { window.UI.toast.error('End time must be after start time.'); return; }
    await window.AppDataStore.create('booking_slots', {
        agent_id: _currentUser?.id || 1,
        day_of_week: parseInt(document.getElementById('slot-day').value),
        start_time: start, end_time: end,
        duration_minutes: parseInt(document.getElementById('slot-duration').value),
        is_active: true, created_at: new Date().toISOString()
    });
    window.UI.hideModal();
    window.UI.toast.success('Availability slot added.');
    await window.app.showBookingSettingsView(document.getElementById('content-viewport'));
};

window._fv.deleteBookingSlot = async (slotId) => {
    try {
        await window.AppDataStore.delete('booking_slots', slotId);
        window.UI.toast.success('Slot removed.');
        await window.app.showBookingSettingsView(document.getElementById('content-viewport'));
    } catch (err) {
        window.UI.toast.error('Delete failed: ' + (err.message || 'Unknown error'));
    }
};

window._fv.toggleSlotActive = async (slotId, isActive) => {
    await window.AppDataStore.update('booking_slots', slotId, { is_active: isActive });
    window.UI.toast.success(isActive ? 'Slot activated.' : 'Slot deactivated.');
};

window._fv.copyBookingLink = () => {
    const _currentUser = window._appState?.cu;
    const url = `${window.location.origin}/booking.html?agent=${_currentUser?.id || 1}`;
    navigator.clipboard.writeText(url).then(() => window.UI.toast.success('Booking link copied!')).catch(() => window.UI.toast.info(`Link: ${url}`));
};

window._fv.openShareBookingLinkModal = () => {
    const _currentUser = window._appState?.cu;
    const baseUrl = `${window.location.origin}/booking.html?agent=${_currentUser?.id || 1}`;
    window.UI.showModal('Share Booking Link', `
        <div style="display:flex; flex-direction:column; gap:16px;">
            <div style="background:#f0fdf4; border:1px solid #bbf7d0; border-radius:8px; padding:12px; font-size:13px; color:#166534;">
                <i class="fas fa-info-circle" style="margin-right:6px;"></i>
                Pre-fill the referral info below, then send the link to the customer. The customer will fill in their own personal details on the booking page.
            </div>
            <div>
                <label style="display:block; font-weight:500; margin-bottom:6px;">Referred By <span style="color:var(--gray-400); font-weight:400;">(optional)</span></label>
                <input type="text" id="share-referrer" class="form-control" placeholder="e.g. Tan Ah Kow" oninput="app.updateShareLinkPreview()">
            </div>
            <div>
                <label style="display:block; font-weight:500; margin-bottom:6px;">Relation to Referrer</label>
                <select id="share-relation" class="form-control" onchange="app.updateShareLinkPreview()">
                    <option value="">-- Select Relation --</option>
                    <option value="Friend">Friend</option>
                    <option value="Family">Family</option>
                    <option value="Spouse">Spouse</option>
                    <option value="Siblings">Siblings</option>
                    <option value="Cousin">Cousin</option>
                    <option value="Colleague">Colleague</option>
                    <option value="Ex Colleague">Ex Colleague</option>
                    <option value="Ex Classmate">Ex Classmate</option>
                    <option value="Business Partner">Business Partner</option>
                    <option value="Customer">Customer</option>
                    <option value="Other">Other</option>
                </select>
            </div>
            <div>
                <label style="display:block; font-weight:500; margin-bottom:6px;">Generated Link</label>
                <input type="text" id="share-link-preview" class="form-control" readonly value="${baseUrl}" style="font-size:12px; color:var(--gray-600); background:var(--gray-50);">
                <p style="font-size:11px; color:var(--gray-400); margin:4px 0 0;">Link updates as you fill in the fields above.</p>
            </div>
        </div>
    `, [
        { label: 'Cancel', type: 'secondary', action: 'UI.hideModal()' },
        { label: '<i class="fas fa-copy"></i> Copy Link', type: 'primary', action: 'app.copySmartBookingLink()' }
    ]);
};

window._fv.updateShareLinkPreview = () => {
    const _currentUser = window._appState?.cu;
    const baseUrl = `${window.location.origin}/booking.html?agent=${_currentUser?.id || 1}`;
    const ref = document.getElementById('share-referrer')?.value.trim();
    const rel = document.getElementById('share-relation')?.value;
    let url = baseUrl;
    if (ref) url += `&ref=${encodeURIComponent(ref)}`;
    if (rel) url += `&rel=${encodeURIComponent(rel)}`;
    const linkEl = document.getElementById('share-link-preview');
    if (linkEl) linkEl.value = url;
};

window._fv.copySmartBookingLink = () => {
    const _currentUser = window._appState?.cu;
    const linkEl = document.getElementById('share-link-preview');
    const url = linkEl?.value || `${window.location.origin}/booking.html?agent=${_currentUser?.id || 1}`;
    navigator.clipboard.writeText(url).then(() => {
        window.UI.hideModal();
        window.UI.toast.success('Booking link copied!');
    }).catch(() => {
        window.UI.hideModal();
        window.UI.toast.info(`Link: ${url}`);
    });
};

window._fv.confirmBookingAppointment = async (apptId) => {
    await window.AppDataStore.update('booking_appointments', apptId, { status: 'confirmed' });
    window.UI.toast.success('Appointment confirmed.');
    await window.app.showBookingSettingsView(document.getElementById('content-viewport'));
};

window._fv.cancelBookingAppointment = async (apptId) => {
    await window.AppDataStore.update('booking_appointments', apptId, { status: 'cancelled' });
    window.UI.toast.success('Appointment cancelled.');
    await window.app.showBookingSettingsView(document.getElementById('content-viewport'));
};

window._fv.openShareCpsIntakeLinkModal = async () => {
    const { escapeHtml } = window._crmUtils || {};
    const _currentUser = window._appState?.cu;
    const venueData = await window.AppDataStore.getAll('venues').catch(() => []);
    const venueOptions = (venueData || [])
        .sort((a, b) => (a.sequence || 0) - (b.sequence || 0))
        .map(v => `<option value="${v.id}" data-name="${(v.name || '').replace(/"/g, '&quot;')}" data-address="${(v.address || v.location || '').replace(/"/g, '&quot;')}" data-waze="${(v.waze_link || '').replace(/"/g, '&quot;')}">${escapeHtml(v.name || '')} | ${escapeHtml(v.location || '')}</option>`)
        .join('');

    const today = new Date().toISOString().split('T')[0];

    window.UI.showModal('Share CPS Intake Link', `
        <div style="display:flex; flex-direction:column; gap:14px;">
            <div style="background:#f0fdf4; border:1px solid #bbf7d0; border-radius:8px; padding:12px; font-size:13px; color:#166534;">
                <i class="fas fa-info-circle" style="margin-right:6px;"></i>
                Set the appointment date, time and venue. A one-time link will be generated — share it with the prospect so they can fill in their basic info. You'll approve it on your calendar afterwards.
            </div>
            <div class="form-row">
                <div class="form-group half">
                    <label>Date <span class="required">*</span></label>
                    <input type="date" id="intake-date" class="form-control" value="${today}">
                </div>
                <div class="form-group half">
                    <label>Venue <span class="required">*</span></label>
                    <select id="intake-venue" class="form-control">
                        <option value="">-- Select Venue --</option>
                        ${venueOptions}
                    </select>
                </div>
            </div>
            <div class="form-row">
                <div class="form-group half">
                    <label>Start Time <span class="required">*</span></label>
                    <input type="time" id="intake-start" class="form-control" value="14:00">
                </div>
                <div class="form-group half">
                    <label>End Time <span class="required">*</span></label>
                    <input type="time" id="intake-end" class="form-control" value="15:30">
                </div>
            </div>

            <div id="intake-generated-link" style="display:none; background:var(--gray-50); border:1px solid var(--gray-200); border-radius:8px; padding:14px;">
                <label style="display:block; font-weight:600; margin-bottom:6px; font-size:13px;">Shareable Link</label>
                <div style="display:flex; gap:8px; align-items:center;">
                    <input type="text" id="intake-link-input" class="form-control" readonly style="flex:1; font-size:12px;">
                    <button class="btn secondary btn-sm" type="button" onclick="app.copyCpsIntakeLink()"><i class="fas fa-copy"></i> Copy</button>
                    <button class="btn secondary btn-sm" type="button" onclick="app.shareCpsIntakeWhatsApp()"><i class="fab fa-whatsapp"></i> WhatsApp</button>
                </div>
                <p class="help-text" style="margin-top:8px; font-size:12px; color:var(--gray-500);">The link expires in 7 days or once the prospect submits.</p>
            </div>
        </div>
    `, [
        { label: 'Close', type: 'secondary', action: 'UI.hideModal()' },
        { label: 'Generate Link', type: 'primary', action: '(async () => { await app.saveCpsIntakeLink(); })()' }
    ]);
};

window._fv.saveCpsIntakeLink = async () => {
    const _currentUser = window._appState?.cu;
    const date = document.getElementById('intake-date')?.value;
    const startTime = document.getElementById('intake-start')?.value;
    const endTime = document.getElementById('intake-end')?.value;
    const venueSel = document.getElementById('intake-venue');

    if (!date || !startTime || !endTime) {
        window.UI.toast.error('Date, start time and end time are required.');
        return;
    }
    if (startTime >= endTime) {
        window.UI.toast.error('End time must be after start time.');
        return;
    }
    if (!venueSel?.value) {
        window.UI.toast.error('Please select a venue.');
        return;
    }

    const opt = venueSel.options[venueSel.selectedIndex];
    const venueName = opt.getAttribute('data-name') || '';
    const venueAddress = opt.getAttribute('data-address') || '';
    const wazeLink = opt.getAttribute('data-waze') || '';

    try {
        const row = await window.AppDataStore.create('cps_intake_requests', {
            agent_id: _currentUser?.id || null,
            activity_date: date,
            start_time: startTime,
            end_time: endTime,
            venue_name: venueName,
            venue_address: venueAddress,
            waze_link: wazeLink,
            status: 'awaiting_submission',
            created_at: new Date().toISOString()
        });

        if (!row || !row.token) {
            window.UI.toast.error('Link created but token missing. Please try again.');
            return;
        }

        const url = `${window.location.origin}/cps-intake.html?token=${row.token}`;
        const linkBlock = document.getElementById('intake-generated-link');
        const linkInput = document.getElementById('intake-link-input');
        if (linkBlock && linkInput) {
            linkInput.value = url;
            linkBlock.style.display = 'block';
        }
        window.UI.toast.success('Link generated! Share it with the prospect.');
    } catch (err) {
        console.error('saveCpsIntakeLink failed:', err);
        window.UI.toast.error('Failed to generate link: ' + (err.message || 'Unknown error'));
    }
};

window._fv.copyCpsIntakeLink = () => {
    const input = document.getElementById('intake-link-input');
    if (!input || !input.value) return;
    navigator.clipboard.writeText(input.value)
        .then(() => window.UI.toast.success('Link copied!'))
        .catch(() => {
            input.select();
            document.execCommand('copy');
            window.UI.toast.success('Link copied!');
        });
};

window._fv.shareCpsIntakeWhatsApp = () => {
    const input = document.getElementById('intake-link-input');
    if (!input || !input.value) return;

    const date = document.getElementById('intake-date')?.value || '';
    const startTime = document.getElementById('intake-start')?.value || '';
    const endTime = document.getElementById('intake-end')?.value || '';
    const venueSel = document.getElementById('intake-venue');
    const opt = venueSel?.options[venueSel.selectedIndex];
    const venueName = opt?.getAttribute('data-name') || '';
    const venueAddress = opt?.getAttribute('data-address') || '';
    const wazeLink = opt?.getAttribute('data-waze') || '';

    let dateStr = date;
    if (date) {
        const [y, m, d] = date.split('-').map(Number);
        const dt = new Date(y, m - 1, d);
        const days = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
        const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
        dateStr = `${days[dt.getDay()]}, ${d} ${months[dt.getMonth()]} ${y}`;
    }
    const timeStr = `${(startTime || '').slice(0,5)} – ${(endTime || '').slice(0,5)}`;

    let msg = `您好！请通过以下链接填妥基本资料以确认您的 CPS 约谈：\nHi! Please fill in your basic information to confirm your CPS appointment:\n`;
    msg += `\n${input.value}\n`;
    msg += `\n📅 日期 Date: ${dateStr}`;
    msg += `\n⏰ 时间 Time: ${timeStr}`;
    if (venueName) msg += `\n📍 地点 Venue: ${venueName}`;
    if (venueAddress) msg += `\n🏠 地址 Address: ${venueAddress}`;
    if (wazeLink) msg += `\n🗺️ Waze: ${wazeLink}`;

    window.open(`https://wa.me/?text=${encodeURIComponent(msg)}`, '_blank');
};

window._fv.renderPendingCpsIntakes = async () => {
    const { escapeHtml } = window._crmUtils || {};
    const _currentUser = window._appState?.cu;
    const host = document.getElementById('pending-cps-intakes');
    if (!host) return;

    let intakes = [];
    try {
        const all = await window.AppDataStore.getAll('cps_intake_requests');
        const pendingStatuses = new Set(['submitted', 'pending', 'awaiting_approval', 'new']);
        intakes = (all || []).filter(r => pendingStatuses.has(r.status));
    } catch (_) { intakes = []; }

    const visibleIds = await window.app.getVisibleUserIds(_currentUser);
    if (visibleIds !== 'all') {
        const visibleStrs = visibleIds.map(String);
        intakes = intakes.filter(i => !i.agent_id || visibleStrs.includes(String(i.agent_id)));
    }

    if (!intakes || intakes.length === 0) {
        host.innerHTML = '';
        host.style.display = 'none';
        return;
    }

    host.style.display = 'block';
    host.innerHTML = `
        <div style="background:#fffbeb; border:1px solid #fcd34d; border-radius:12px; padding:16px; margin-bottom:16px;">
            <h3 style="margin:0 0 12px; font-size:15px; color:#92400e; display:flex; align-items:center; gap:8px;">
                <i class="fas fa-bell"></i> PENDING CPS INTAKE APPROVALS (${intakes.length})
            </h3>
            <div style="display:flex; flex-direction:column; gap:10px;">
                ${intakes.map(i => `
                    <div style="background:white; border:1px solid #fde68a; border-radius:8px; padding:12px;">
                        <div style="display:flex; justify-content:space-between; align-items:flex-start; gap:12px; flex-wrap:wrap;">
                            <div style="flex:1; min-width:200px;">
                                <div style="font-weight:600; font-size:14px; margin-bottom:2px;">${escapeHtml(i.prospect_name || 'Unknown')}</div>
                                <div style="font-size:12px; color:var(--gray-600);">
                                    <i class="fas fa-phone" style="margin-right:4px;"></i>${escapeHtml(i.prospect_phone || '—')}
                                    ${i.prospect_email ? ` · <i class="fas fa-envelope" style="margin-right:4px;"></i>${escapeHtml(i.prospect_email)}` : ''}
                                </div>
                                <div style="font-size:12px; color:var(--gray-500); margin-top:4px;">
                                    <i class="far fa-calendar" style="margin-right:4px;"></i>${i.activity_date} · ${(i.start_time || '').slice(0,5)}–${(i.end_time || '').slice(0,5)}
                                    ${i.venue_name ? ` · <i class="fas fa-map-marker-alt" style="margin-right:4px;"></i>${escapeHtml(i.venue_name)}` : ''}
                                </div>
                            </div>
                            <div style="display:flex; gap:6px;">
                                <button class="btn primary btn-sm" onclick="app.openApproveCpsIntakeModal(${i.id})">
                                    <i class="fas fa-check"></i> Review & Approve
                                </button>
                                <button class="btn secondary btn-sm" onclick="app.rejectCpsIntake(${i.id})" title="Reject">
                                    <i class="fas fa-times"></i>
                                </button>
                            </div>
                        </div>
                    </div>
                `).join('')}
            </div>
        </div>
    `;
};

window._fv.openApproveCpsIntakeModal = async (intakeId) => {
    const intake = await window.AppDataStore.getById('cps_intake_requests', intakeId);
    if (!intake) {
        window.UI.toast.error('Intake request not found.');
        return;
    }
    if (intake.status !== 'submitted') {
        window.UI.toast.error('This intake is no longer pending.');
        await window.app.renderPendingCpsIntakes();
        return;
    }

    window._appState.pii = intakeId;
    window._appState.pir = intake;

    await window.app.openActivityModal(intake.activity_date);

    let attempts = 0;
    const pollInterval = setInterval(() => {
        const nameEl = document.getElementById('cps-name');
        if (nameEl) {
            const setF = (id, val) => { const el = document.getElementById(id); if (el) el.value = val || ''; };
            setF('cps-name', intake.prospect_name);
            setF('cps-ic', intake.prospect_ic);
            setF('cps-occupation', intake.prospect_occupation);
            setF('cps-phone', intake.prospect_phone);
            setF('cps-email', intake.prospect_email);
            setF('activity-date', intake.activity_date);
            setF('start-time', (intake.start_time || '').slice(0, 5));
            setF('end-time', (intake.end_time || '').slice(0, 5));

            const venueSel = document.getElementById('activity-venue');
            if (venueSel && intake.venue_name) {
                for (const opt of venueSel.options) {
                    if (opt.value && opt.value.toLowerCase().startsWith(intake.venue_name.toLowerCase())) {
                        venueSel.value = opt.value;
                        break;
                    }
                }
            }

            if (typeof window.app !== 'undefined' && window.app.calculateDuration) window.app.calculateDuration();

            clearInterval(pollInterval);
            window.UI.toast.info('Please add referrer and relation before saving.');
        } else if (++attempts >= 16) {
            clearInterval(pollInterval);
        }
    }, 250);
};

window._fv.rejectCpsIntake = async (intakeId) => {
    if (!confirm('Reject this CPS intake request? This cannot be undone.')) return;
    try {
        await window.AppDataStore.update('cps_intake_requests', intakeId, {
            status: 'rejected',
            approved_at: new Date().toISOString()
        });
        window.UI.toast.success('Intake rejected.');
        await window.app.renderPendingCpsIntakes();
    } catch (err) {
        window.UI.toast.error('Reject failed: ' + (err.message || 'Unknown error'));
    }
};

const CPS_SCAN_FIELD_MAP = [
    ['name',           'name',         'Full Name',          'full_name'],
    ['gender',         'gender',       'Gender',             'gender'],
    ['dob_solar',      'dob',          'Date of Birth',      'date_of_birth'],
    ['dob_lunar',      'lunar',        'Lunar Birth',        'lunar_birth'],
    ['phone',          'phone',        'Phone',              'phone'],
    ['occupation',     'occupation',   'Occupation',         'occupation'],
    ['email',          'email',        'Email',              'email'],
    ['address',        'address',      'Address',            'address'],
    ['marital_status', '__marital__',  'Marital Status',     'marital_status'],
];

const _readCpsField = (prefix, suffix) => {
    if (suffix === '__marital__') {
        const cb = document.querySelector(`.${prefix}-marital-cb:checked`);
        return cb ? cb.value : '';
    }
    const el = document.getElementById(`${prefix}-${suffix}`);
    return el ? (el.value || '').trim() : '';
};

const _writeCpsField = (prefix, suffix, value) => {
    if (suffix === '__marital__') {
        document.querySelectorAll(`.${prefix}-marital-cb`).forEach(cb => {
            cb.checked = (cb.value === value);
        });
        return;
    }
    const el = document.getElementById(`${prefix}-${suffix}`);
    if (!el) return;
    el.value = value || '';
    if (suffix === 'dob' && typeof window.app !== 'undefined' && window.app.updateLunarBirth) {
        try { window.app.updateLunarBirth(`${prefix}-dob`, `${prefix}-lunar`); } catch (e) {}
    }
};

window._fv._showCpsScanOverlay = (title, contentHtml, buttons = []) => {
    let overlay = document.getElementById('cps-scan-overlay');
    if (!overlay) {
        overlay = document.createElement('div');
        overlay.id = 'cps-scan-overlay';
        overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.55);z-index:99999;display:flex;align-items:center;justify-content:center;padding:16px;';
        document.body.appendChild(overlay);
    }
    const btnHtml = buttons.map(b => {
        const cls = b.type === 'primary' ? 'btn primary' : 'btn secondary';
        return `<button class="${cls}" style="margin-left:8px;" onclick="${b.action}">${b.label}</button>`;
    }).join('');
    overlay.innerHTML = `
        <div style="background:white;border-radius:12px;max-width:760px;width:100%;max-height:90vh;overflow:hidden;display:flex;flex-direction:column;box-shadow:0 20px 60px rgba(0,0,0,0.3);">
            <div style="padding:16px 20px;border-bottom:1px solid var(--gray-200);font-weight:600;font-size:16px;display:flex;justify-content:space-between;align-items:center;">
                <span>${title}</span>
                <button type="button" style="background:none;border:none;font-size:20px;color:var(--gray-500);cursor:pointer;padding:0;line-height:1;" onclick="app._hideCpsScanOverlay()">&times;</button>
            </div>
            <div style="padding:18px 20px;overflow-y:auto;flex:1;">${contentHtml}</div>
            ${buttons.length ? `<div style="padding:14px 20px;border-top:1px solid var(--gray-200);text-align:right;background:var(--gray-50);">${btnHtml}</div>` : ''}
        </div>
    `;
    overlay.style.display = 'flex';
};

window._fv._hideCpsScanOverlay = () => {
    const overlay = document.getElementById('cps-scan-overlay');
    if (overlay) overlay.remove();
};

window._fv.scanCpsForm = (prefix = 'cps') => {
    const input = document.getElementById(`${prefix}-scan-input`);
    if (!input) {
        window.UI.toast.error('Scan input not found. Please reopen the form.');
        return;
    }
    input.value = '';
    input.click();
};

window._fv.handleCpsScanFile = async (input, prefix = 'cps') => {
    const file = input.files && input.files[0];
    if (!file) return;

    if (!file.type.startsWith('image/')) {
        window.UI.toast.error('Please select an image file.');
        return;
    }
    if (file.size > 8 * 1024 * 1024) {
        window.UI.toast.error('Image too large. Please use a photo under 8 MB.');
        return;
    }

    const current = {};
    CPS_SCAN_FIELD_MAP.forEach(([key, suffix]) => {
        current[key] = _readCpsField(prefix, suffix);
    });

    window.app._showCpsScanOverlay('Scanning Form…', `
        <div style="text-align:center; padding:20px 0;">
            <i class="fas fa-spinner fa-spin" style="font-size:36px; color:#7c3aed; margin-bottom:14px;"></i>
            <p style="color:var(--gray-600); margin:0;">Reading the form, please wait…</p>
            <p style="color:var(--gray-400); font-size:12px; margin-top:6px;">(usually 3–6 seconds)</p>
        </div>
    `);

    try {
        const dataUrl = await new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result);
            reader.onerror = () => reject(new Error('Could not read file'));
            reader.readAsDataURL(file);
        });
        const [meta, b64] = String(dataUrl).split(',');
        const mime = (meta.match(/data:(.*?);base64/) || [])[1] || file.type || 'image/jpeg';

        if (!window.supabase || !window.supabase.functions) {
            throw new Error('Supabase client not available (offline mode?)');
        }

        const { data: res, error } = await window.supabase.functions.invoke('cps-form-ocr', {
            body: { image_base64: b64, mime_type: mime },
        });

        if (error) throw new Error(error.message || 'Edge function call failed');
        if (!res || res.ok === false) {
            throw new Error(res?.detail || res?.error || 'OCR failed');
        }

        const scanned = res.fields || {};
        const confidence = res.confidence || {};

        window._appState.csc = { prefix, scanned, confidence, current, rawText: res.raw_text || '' };
        window._appState.cpf = window._appState.cpf || {};
        window._appState.cpf[prefix] = file;
        window.app.renderCpsScanReview();
    } catch (err) {
        window.app._hideCpsScanOverlay();
        console.error('CPS scan failed:', err);
        window.UI.toast.error('Scan failed: ' + (err.message || 'Unknown error'));
    }
};

window._fv.renderCpsScanReview = () => {
    const { escapeHtml } = window._crmUtils || {};
    const _cpsScanCache = window._appState.csc;
    if (!_cpsScanCache) return;
    const { scanned, confidence, current, rawText } = _cpsScanCache;

    const norm = v => (v == null ? '' : String(v).trim());
    const isEmpty = v => norm(v) === '';

    const rows = CPS_SCAN_FIELD_MAP.map(([key, suffix, label]) => {
        const cur = norm(current[key]);
        const scn = norm(scanned[key]);
        const conf = confidence[key] || null;

        let status, defaultChecked;
        if (isEmpty(scn)) {
            status = 'no-scan';
            defaultChecked = false;
        } else if (isEmpty(cur)) {
            status = 'fill-empty';
            defaultChecked = true;
        } else if (cur.toLowerCase() === scn.toLowerCase()) {
            status = 'same';
            defaultChecked = false;
        } else {
            status = 'conflict';
            defaultChecked = false;
        }

        return { key, suffix, label, cur, scn, conf, status, defaultChecked };
    });

    const statusBadge = (s) => {
        if (s === 'same')       return '<span style="color:#10b981;font-size:11px;font-weight:600;">✓ MATCH</span>';
        if (s === 'fill-empty') return '<span style="color:#7c3aed;font-size:11px;font-weight:600;">+ FILL</span>';
        if (s === 'conflict')   return '<span style="color:#d97706;font-size:11px;font-weight:600;">⚠ CONFLICT</span>';
        if (s === 'no-scan')    return '<span style="color:#9ca3af;font-size:11px;">— blank</span>';
        return '';
    };
    const confBadge = (c) => {
        if (!c) return '';
        const color = c === 'high' ? '#10b981' : c === 'medium' ? '#f59e0b' : '#ef4444';
        return `<span style="display:inline-block;padding:1px 6px;border-radius:10px;background:${color}1a;color:${color};font-size:10px;font-weight:600;text-transform:uppercase;">${c}</span>`;
    };
    const rowBg = (s) => {
        if (s === 'conflict')   return '#fffbeb';
        if (s === 'fill-empty') return '#f5f3ff';
        if (s === 'same')       return '#f0fdf4';
        return '#ffffff';
    };

    const html = `
        <div style="max-height:60vh;overflow-y:auto;">
            <p style="margin:0 0 14px;color:var(--gray-600);font-size:13px;">
                Review the scanned values below. Tick the ones you want to apply.
                <br><strong style="color:#d97706;">Conflicts</strong> need your explicit pick — nothing will overwrite without your tick.
            </p>

            <table style="width:100%;border-collapse:collapse;font-size:13px;">
                <thead>
                    <tr style="background:var(--gray-100);text-align:left;">
                        <th style="padding:8px 6px;width:32px;"></th>
                        <th style="padding:8px;">Field</th>
                        <th style="padding:8px;">Currently in form</th>
                        <th style="padding:8px;">Scanned</th>
                        <th style="padding:8px;width:90px;">Status</th>
                    </tr>
                </thead>
                <tbody>
                    ${rows.map((r, idx) => `
                        <tr style="background:${rowBg(r.status)};border-bottom:1px solid #e5e7eb;">
                            <td style="padding:8px 6px;text-align:center;">
                                ${r.status === 'no-scan' || r.status === 'same' ? '' : `
                                    <input type="checkbox" class="cps-scan-pick" data-idx="${idx}" ${r.defaultChecked ? 'checked' : ''}>
                                `}
                            </td>
                            <td style="padding:8px;font-weight:500;color:var(--gray-700);">${r.label}</td>
                            <td style="padding:8px;color:${r.cur ? 'var(--gray-700)' : 'var(--gray-400)'};">
                                ${r.cur ? escapeHtml(r.cur) : '<em style="font-size:12px;">(empty)</em>'}
                            </td>
                            <td style="padding:8px;color:${r.scn ? 'var(--gray-900)' : 'var(--gray-400)'};">
                                ${r.scn ? escapeHtml(r.scn) : '<em style="font-size:12px;">(blank)</em>'}
                                ${r.conf ? ' ' + confBadge(r.conf) : ''}
                            </td>
                            <td style="padding:8px;">${statusBadge(r.status)}</td>
                        </tr>
                    `).join('')}
                </tbody>
            </table>

            <div style="margin-top:14px;display:flex;gap:8px;flex-wrap:wrap;">
                <button type="button" class="btn secondary btn-sm" onclick="app.toggleCpsScanAll(true)">
                    <i class="fas fa-check-square"></i> Tick all available
                </button>
                <button type="button" class="btn secondary btn-sm" onclick="app.toggleCpsScanAll(false)">
                    <i class="far fa-square"></i> Untick all
                </button>
            </div>

            ${rawText ? `
                <details style="margin-top:14px;font-size:12px;color:var(--gray-500);">
                    <summary style="cursor:pointer;">Show raw OCR text</summary>
                    <pre style="white-space:pre-wrap;background:var(--gray-100);padding:10px;border-radius:6px;margin-top:6px;font-size:11px;max-height:160px;overflow:auto;">${escapeHtml(rawText)}</pre>
                </details>
            ` : ''}
        </div>
    `;

    window.app._showCpsScanOverlay('Review Scanned Form', html, [
        { type: 'secondary', label: 'Cancel', action: 'app._hideCpsScanOverlay()' },
        { type: 'primary',   label: 'Apply Selected', action: 'app.applyCpsScanSelection()' },
    ]);
};

window._fv.toggleCpsScanAll = (checked) => {
    document.querySelectorAll('.cps-scan-pick').forEach(cb => { cb.checked = !!checked; });
};

window._fv.applyCpsScanSelection = async () => {
    const _cpsScanCache = window._appState.csc;
    if (!_cpsScanCache) { window.app._hideCpsScanOverlay(); return; }
    const { prefix, scanned, prospectId } = _cpsScanCache;
    const dbTarget = prefix === '__prospect_row__';

    const picked = Array.from(document.querySelectorAll('.cps-scan-pick:checked'))
        .map(cb => parseInt(cb.dataset.idx, 10))
        .filter(n => !isNaN(n));

    let applied = 0;
    if (dbTarget) {
        const patch = {};
        picked.forEach(idx => {
            const row = CPS_SCAN_FIELD_MAP[idx] || [];
            const key = row[0];
            const dbCol = row[3];
            if (!key || !dbCol) return;
            const val = scanned[key];
            if (val == null || String(val).trim() === '') return;
            patch[dbCol] = String(val).trim();
            applied++;
        });
        if (applied > 0 && prospectId) {
            try {
                await window.AppDataStore.update('prospects', prospectId, patch);
            } catch (err) {
                window.UI.toast.error('Failed to save fields: ' + (err.message || err));
                applied = 0;
            }
        }
    } else {
        picked.forEach(idx => {
            const [key, suffix] = CPS_SCAN_FIELD_MAP[idx] || [];
            if (!key) return;
            const val = scanned[key];
            if (val == null || String(val).trim() === '') return;
            _writeCpsField(prefix, suffix, String(val).trim());
            applied++;
        });
    }

    window.app._hideCpsScanOverlay();
    window._appState.csc = null;
    if (applied > 0) {
        const tail = dbTarget ? 'to prospect record.' : 'from scan. Please review before saving.';
        window.UI.toast.success(`Applied ${applied} field${applied === 1 ? '' : 's'} ${tail}`);
    } else {
        window.UI.toast.info('No fields were applied.');
    }
};

window._fv._uploadCpsFormFile = async (file, prospectId) => {
    if (!file || !prospectId) return null;
    try {
        const sb = window.supabase;
        if (!sb || !sb.storage) return null;
        const ext = (file.name.match(/\.[a-z0-9]+$/i)?.[0] || '.jpg').toLowerCase();
        const path = `cps-forms/${prospectId}_${Date.now()}${ext}`;
        const { error: upErr } = await sb.storage
            .from('attachments')
            .upload(path, file, { upsert: true, contentType: file.type });
        if (upErr) throw upErr;
        const { data: urlData } = sb.storage.from('attachments').getPublicUrl(path);
        await window.AppDataStore.update('prospects', prospectId, {
            cps_form_url: urlData?.publicUrl || null,
            cps_form_date: new Date().toISOString().split('T')[0],
            cps_form_name: file.name,
        });
        return urlData?.publicUrl || null;
    } catch (err) {
        console.warn('CPS form silent upload failed:', err);
        return null;
    }
};

// ══════════════ showLeadFormsView ══════════════
window._fv.showLeadFormsView = async (container) => {
    const { escapeHtml } = window._crmUtils || {};
    const _currentUser = window._appState?.cu;
    window._appState = window._appState || {};
    window._appState.cv = 'lead_forms';
    const forms = await window.AppDataStore.getAll('lead_forms').catch(() => []);
    container.innerHTML = `
        <div style="padding:24px; max-width:1000px; margin:0 auto;">
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:24px;">
                <div>
                    <h1 style="font-size:24px; font-weight:700; margin:0;">Lead Capture Forms</h1>
                    <p style="color:var(--gray-500); margin:4px 0 0;">Shareable forms that auto-create prospects when submitted.</p>
                </div>
                <button class="btn primary" onclick="app.openFormBuilderModal()"><i class="fas fa-plus"></i> New Form</button>
            </div>
            ${forms.length === 0 ? `
                <div style="text-align:center; padding:60px; background:white; border:1px solid var(--gray-200); border-radius:12px; color:var(--gray-400);">
                    <i class="fas fa-wpforms" style="font-size:48px; display:block; margin-bottom:12px;"></i>
                    <h3 style="color:var(--gray-500);">No forms yet</h3>
                    <p>Create your first lead capture form to start collecting prospects automatically.</p>
                    <button class="btn primary" onclick="app.openFormBuilderModal()">Create Form</button>
                </div>
            ` : `
                <div style="display:grid; grid-template-columns:repeat(auto-fill, minmax(300px, 1fr)); gap:16px;">
                    ${forms.map(form => `
                        <div style="background:white; border:1px solid var(--gray-200); border-radius:12px; padding:20px;">
                            <div style="display:flex; justify-content:space-between; align-items:flex-start; margin-bottom:12px;">
                                <div>
                                    <h3 style="margin:0; font-size:16px;">${escapeHtml(form.name || '')}</h3>
                                    <p style="margin:4px 0 0; color:var(--gray-500); font-size:13px;">${escapeHtml(form.description || 'No description')}</p>
                                </div>
                                <span style="padding:3px 10px; border-radius:20px; font-size:12px; background:${form.is_active ? '#d1fae5' : '#f3f4f6'}; color:${form.is_active ? '#065f46' : '#6b7280'};">${form.is_active ? 'Active' : 'Inactive'}</span>
                            </div>
                            <div style="font-size:12px; color:var(--gray-400); margin-bottom:16px;">${(form.fields || []).length} fields</div>
                            <div style="display:flex; gap:8px; flex-wrap:wrap;">
                                <button class="btn secondary" style="flex:1; font-size:12px; padding:6px;" onclick="app.copyFormLink(${form.id})"><i class="fas fa-copy"></i> Copy Link</button>
                                <button class="btn secondary" style="flex:1; font-size:12px; padding:6px;" onclick="app.showFormSubmissions(${form.id})"><i class="fas fa-inbox"></i> Submissions</button>
                                <button class="btn-icon" style="color:var(--error);" onclick="app.deleteLeadForm(${form.id})"><i class="fas fa-trash"></i></button>
                            </div>
                        </div>
                    `).join('')}
                </div>
            `}
        </div>
    `;
};

// ══════════════ showSurveysView ══════════════
window._fv.showSurveysView = async (container) => {
    const { escapeHtml } = window._crmUtils || {};
    const _currentUser = window._appState?.cu;

    window._appState.cv = 'surveys';
    const surveys = await window.AppDataStore.getAll('surveys').catch(() => []);
    container.innerHTML = `
        <div style="padding:24px; max-width:1000px; margin:0 auto;">
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:24px;">
                <div>
                    <h1 style="font-size:24px; font-weight:700; margin:0;">NPS & Satisfaction Surveys</h1>
                    <p style="color:var(--gray-500); margin:4px 0 0;">Measure customer satisfaction with shareable survey links.</p>
                </div>
                <button class="btn primary" onclick="app.openSurveyBuilderModal()"><i class="fas fa-plus"></i> New Survey</button>
            </div>
            ${surveys.length === 0 ? `
                <div style="text-align:center; padding:60px; background:white; border:1px solid var(--gray-200); border-radius:12px; color:var(--gray-400);">
                    <i class="fas fa-star" style="font-size:48px; display:block; margin-bottom:12px;"></i>
                    <h3 style="color:var(--gray-500);">No surveys yet</h3>
                    <button class="btn primary" onclick="app.openSurveyBuilderModal()">Create Survey</button>
                </div>
            ` : `
                <div style="display:grid; grid-template-columns:repeat(auto-fill, minmax(320px, 1fr)); gap:16px;">
                    ${surveys.map(survey => `
                        <div style="background:white; border:1px solid var(--gray-200); border-radius:12px; padding:20px;">
                            <div style="display:flex; justify-content:space-between; align-items:flex-start; margin-bottom:10px;">
                                <div>
                                    <h3 style="margin:0; font-size:16px;">${escapeHtml(survey.name || '')}</h3>
                                    <span style="font-size:12px; color:var(--gray-400); text-transform:uppercase;">${escapeHtml(survey.type || '')}</span>
                                </div>
                                <span style="padding:3px 10px; border-radius:20px; font-size:12px; background:${survey.is_active ? '#d1fae5' : '#f3f4f6'}; color:${survey.is_active ? '#065f46' : '#6b7280'};">${survey.is_active ? 'Active' : 'Inactive'}</span>
                            </div>
                            <p style="color:var(--gray-600); font-size:13px; margin:0 0 16px;">${escapeHtml(survey.question || '')}</p>
                            <div style="display:flex; gap:8px; flex-wrap:wrap;">
                                <button class="btn secondary" style="flex:1; font-size:12px; padding:6px;" onclick="app.copySurveyLink(${survey.id})"><i class="fas fa-copy"></i> Copy Link</button>
                                <button class="btn secondary" style="flex:1; font-size:12px; padding:6px;" onclick="app.showSurveyResults(${survey.id})"><i class="fas fa-chart-bar"></i> Results</button>
                                <button class="btn-icon" style="color:var(--error);" onclick="app.deleteSurvey(${survey.id})"><i class="fas fa-trash"></i></button>
                            </div>
                        </div>
                    `).join('')}
                </div>
            `}
        </div>
    `;
};

window._fv.openSurveyBuilderModal = () => {
    window.UI.showModal('Create Survey', `
        <div style="display:flex; flex-direction:column; gap:16px;">
            <div><label style="display:block; font-weight:500; margin-bottom:6px;">Survey Name</label>
            <input type="text" id="survey-name" class="form-control" placeholder="e.g. Q2 Customer Satisfaction"></div>
            <div><label style="display:block; font-weight:500; margin-bottom:6px;">Type</label>
            <select id="survey-type" class="form-control" onchange="app.updateSurveyQuestion(this.value)">
                <option value="nps">NPS (Net Promoter Score)</option>
                <option value="csat">CSAT (Customer Satisfaction)</option>
                <option value="custom">Custom Question</option>
            </select></div>
            <div><label style="display:block; font-weight:500; margin-bottom:6px;">Question</label>
            <input type="text" id="survey-question" class="form-control" value="How likely are you to recommend us to a friend or colleague?"></div>
            <div><label style="display:block; font-weight:500; margin-bottom:6px;">Description (optional)</label>
            <textarea id="survey-description" class="form-control" rows="2" placeholder="Additional context shown to respondents..."></textarea></div>
        </div>
    `, [
        { label: 'Cancel', type: 'secondary', action: 'UI.hideModal()' },
        { label: 'Save Survey', type: 'primary', action: '(async () => { await app.saveSurvey(); })()' }
    ]);
};

window._fv.updateSurveyQuestion = (type) => {
    const q = document.getElementById('survey-question');
    if (!q) return;
    if (type === 'nps') q.value = 'How likely are you to recommend us to a friend or colleague?';
    else if (type === 'csat') q.value = 'How satisfied are you with our service today?';
};

window._fv.saveSurvey = async () => {
    const _currentUser = window._appState?.cu;
    const name = document.getElementById('survey-name').value.trim();
    if (!name) { window.UI.toast.error('Survey name is required.'); return; }
    await window.AppDataStore.create('surveys', {
        name, type: document.getElementById('survey-type').value,
        question: document.getElementById('survey-question').value.trim(),
        description: document.getElementById('survey-description').value.trim(),
        created_by: _currentUser?.id || 1, is_active: true, created_at: new Date().toISOString()
    });
    window.UI.hideModal();
    window.UI.toast.success('Survey created!');
    await window._fv.showSurveysView(document.getElementById('content-viewport'));
};

window._fv.deleteSurvey = async (surveyId) => {
    try {
        const responses = await window.AppDataStore.getAll('survey_responses').catch(() => []);
        for (const r of responses.filter(r => String(r.survey_id) === String(surveyId)))
            await window.AppDataStore.delete('survey_responses', r.id);
        await window.AppDataStore.delete('surveys', surveyId);
        window.UI.toast.success('Survey deleted.');
        await window._fv.showSurveysView(document.getElementById('content-viewport'));
    } catch (err) {
        window.UI.toast.error('Delete failed: ' + (err.message || 'Unknown error'));
    }
};

window._fv.copySurveyLink = (surveyId) => {
    const url = `${window.location.origin}/survey.html?id=${surveyId}`;
    navigator.clipboard.writeText(url).then(() => window.UI.toast.success('Survey link copied!')).catch(() => window.UI.toast.info(`Link: ${url}`));
};

window._fv.showSurveyResults = async (surveyId) => {
    const { escapeHtml } = window._crmUtils || {};
    const survey = await window.AppDataStore.getById('surveys', surveyId);
    const responses = (await window.AppDataStore.getAll('survey_responses').catch(() => [])).filter(r => r.survey_id == surveyId);
    const promoters = responses.filter(r => r.score >= 9).length;
    const passives = responses.filter(r => r.score >= 7 && r.score <= 8).length;
    const detractors = responses.filter(r => r.score <= 6).length;
    const total = responses.length;
    const nps = total > 0 ? Math.round(((promoters - detractors) / total) * 100) : null;
    const npsColor = nps === null ? '#9ca3af' : nps >= 50 ? '#10b981' : nps >= 0 ? '#f59e0b' : '#ef4444';
    const html = `
        <div>
            <p style="color:var(--gray-600); margin:0 0 20px;">${escapeHtml(survey?.question || '')}</p>
            <div style="display:grid; grid-template-columns:repeat(4,1fr); gap:12px; margin-bottom:20px;">
                <div style="text-align:center; padding:16px; background:var(--gray-50); border-radius:8px;">
                    <div style="font-size:28px; font-weight:700; color:${npsColor};">${nps !== null ? nps : '—'}</div>
                    <div style="font-size:12px; color:var(--gray-500);">NPS Score</div>
                </div>
                <div style="text-align:center; padding:16px; background:#f0fdf4; border-radius:8px;">
                    <div style="font-size:28px; font-weight:700; color:#10b981;">${promoters}</div>
                    <div style="font-size:12px; color:var(--gray-500);">Promoters (9-10)</div>
                </div>
                <div style="text-align:center; padding:16px; background:#fffbeb; border-radius:8px;">
                    <div style="font-size:28px; font-weight:700; color:#f59e0b;">${passives}</div>
                    <div style="font-size:12px; color:var(--gray-500);">Passives (7-8)</div>
                </div>
                <div style="text-align:center; padding:16px; background:#fef2f2; border-radius:8px;">
                    <div style="font-size:28px; font-weight:700; color:#ef4444;">${detractors}</div>
                    <div style="font-size:12px; color:var(--gray-500);">Detractors (0-6)</div>
                </div>
            </div>
            ${responses.length === 0 ? '<p style="text-align:center; color:var(--gray-400);">No responses yet. Share your survey link.</p>' : `
                <table style="width:100%; border-collapse:collapse;">
                    <thead><tr style="background:var(--gray-50); border-bottom:2px solid var(--gray-200);">
                        <th scope="col" style="padding:10px; text-align:left;">Respondent</th>
                        <th scope="col" style="padding:10px; text-align:left;">Score</th>
                        <th scope="col" style="padding:10px; text-align:left;">Feedback</th>
                        <th scope="col" style="padding:10px; text-align:left;">Date</th>
                    </tr></thead>
                    <tbody>${responses.slice(0,20).map(r => `
                        <tr style="border-bottom:1px solid var(--gray-100);">
                            <td style="padding:10px;">${escapeHtml(r.respondent_name || 'Anonymous')}</td>
                            <td style="padding:10px;"><span style="font-weight:700; color:${r.score>=9?'#10b981':r.score>=7?'#f59e0b':'#ef4444'};">${r.score}/10</span></td>
                            <td style="padding:10px; color:var(--gray-600); font-size:13px;">${escapeHtml(r.feedback || '—')}</td>
                            <td style="padding:10px; color:var(--gray-400); font-size:12px;">${r.submitted_at ? new Date(r.submitted_at).toLocaleDateString() : '—'}</td>
                        </tr>
                    `).join('')}</tbody>
                </table>
            `}
        </div>
    `;
    window.UI.showModal(`Survey Results — ${survey?.name}`, html, [{ label: 'Close', type: 'secondary', action: 'UI.hideModal()' }]);
};

// ══════════════ showContractsView ══════════════
window._fv.showContractsView = async (container) => {
    const { escapeHtml } = window._crmUtils || {};
    const _currentUser = window._appState?.cu;

    const renderContractStatusBadge = (status) => {
        const map = { draft:{bg:'#f3f4f6',color:'#6b7280',label:'Draft'}, sent:{bg:'#dbeafe',color:'#1e40af',label:'Sent'}, signed:{bg:'#d1fae5',color:'#065f46',label:'Signed'}, declined:{bg:'#fee2e2',color:'#991b1b',label:'Declined'} };
        const s = map[status] || map.draft;
        return `<span style="padding:3px 10px; border-radius:20px; font-size:12px; background:${s.bg}; color:${s.color};">${s.label}</span>`;
    };

    window._currentView = 'contracts';
    const contracts = await window.AppDataStore.getAll('contracts').catch(() => []);
    container.innerHTML = `
        <div style="padding:24px; max-width:1000px; margin:0 auto;">
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:24px;">
                <div>
                    <h1 style="font-size:24px; font-weight:700; margin:0;">Contract Management</h1>
                    <p style="color:var(--gray-500); margin:4px 0 0;">Upload contracts and collect e-signatures from customers.</p>
                </div>
                <button class="btn primary" onclick="app.openUploadContractModal()"><i class="fas fa-plus"></i> Upload Contract</button>
            </div>
            ${contracts.length === 0 ? `
                <div style="text-align:center; padding:60px; background:white; border:1px solid var(--gray-200); border-radius:12px; color:var(--gray-400);">
                    <i class="fas fa-file-signature" style="font-size:48px; display:block; margin-bottom:12px;"></i>
                    <h3 style="color:var(--gray-500);">No contracts yet</h3>
                    <p>Upload a contract to send for e-signature.</p>
                    <button class="btn primary" onclick="app.openUploadContractModal()">Upload Contract</button>
                </div>
            ` : `
                <table style="width:100%; border-collapse:collapse; background:white; border:1px solid var(--gray-200); border-radius:12px; overflow:hidden;">
                    <thead><tr style="background:var(--gray-50); border-bottom:2px solid var(--gray-200);">
                        <th scope="col" style="padding:12px 16px; text-align:left;">Title</th>
                        <th scope="col" style="padding:12px 16px; text-align:left;">Customer</th>
                        <th scope="col" style="padding:12px 16px; text-align:left;">Status</th>
                        <th scope="col" style="padding:12px 16px; text-align:left;">Date</th>
                        <th scope="col" style="padding:12px 16px; text-align:left;">Actions</th>
                    </tr></thead>
                    <tbody>${contracts.map(c => `
                        <tr style="border-bottom:1px solid var(--gray-100);">
                            <td style="padding:12px 16px;"><i class="fas fa-file-contract" style="color:var(--primary); margin-right:8px;"></i>${escapeHtml(c.title || '')}</td>
                            <td style="padding:12px 16px; color:var(--gray-600);">${c.signer_name ? escapeHtml(c.signer_name) : (c.customer_id ? `Customer #${c.customer_id}` : '—')}</td>
                            <td style="padding:12px 16px;">${renderContractStatusBadge(c.status)}</td>
                            <td style="padding:12px 16px; color:var(--gray-400); font-size:13px;">${c.created_at ? new Date(c.created_at).toLocaleDateString() : '—'}</td>
                            <td style="padding:12px 16px;">
                                ${c.status === 'draft' ? `<button class="btn secondary" style="font-size:12px; padding:4px 10px;" onclick="app.sendContractForSigning(${c.id})"><i class="fas fa-paper-plane"></i> Send</button>` : ''}
                                ${c.status === 'sent' ? `<button class="btn secondary" style="font-size:12px; padding:4px 10px;" onclick="app.copySigningLink(${c.id})"><i class="fas fa-copy"></i> Copy Link</button>` : ''}
                                ${c.status === 'signed' ? `<button class="btn secondary" style="font-size:12px; padding:4px 10px;" onclick="app.showContractDetail(${c.id})"><i class="fas fa-eye"></i> View</button>` : ''}
                            </td>
                        </tr>
                    `).join('')}</tbody>
                </table>
            `}
        </div>
    `;
};

// ══════════════ showReferralsView ══════════════
// ── Module-scoped state for the Referrals feature view ──────────────────────
// These variables replace the IIFE closure vars that the original functions
// shared. They are initialised once when script-features.js loads and persist
// across repeated navigations to the Referrals view.
window._fv = window._fv || {};

(function () {
    const esc = (v) => window._crmUtils.escapeHtml(v);
    // State that was previously shared via the IIFE closure
    let _leaderboardPeriod   = 'all';   // 'all' | 'year' | 'month'
    let _treeZoom            = null;
    let _treeSvg             = null;
    let _currentTreeData     = null;
    let _treeNavStack        = [];      // [{id, type}] for back navigation
    let _currentSelectedPerson = null; // { id, type }
    let _treeActiveFilter    = 'all';  // 'all' | 'new' | 'expected_drop' | 'lost'
    let _modalSelectedReferrer = null;
    let _modalSelectedReferred = null;

    // ── helpers that used to be inner-function siblings ──────────────────────

    const renderReferralSummaryAndLeaderboard = async () => {
        await renderSummary();
        await renderLeaderboard();
    };

    const renderSummary = async () => {
        const container = document.getElementById('referral-summary-container');
        if (!container) return;

        const referrals = await getVisibleReferrals();
        const totalReferrals = referrals.length;
        const totalReferrers = new Set(referrals.map(r => r.referrer_id)).size;

        const convertedCount = referrals.filter(r => r.status === 'Active' || r.is_converted).length;
        const conversionRate = totalReferrals > 0 ? Math.round((convertedCount / totalReferrals) * 100) : 0;

        const grouped = {};
        referrals.forEach(r => {
            if (!r.referrer_id) return;
            grouped[r.referrer_id] = (grouped[r.referrer_id] || 0) + 1;
        });
        const top3Promises = Object.entries(grouped)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 3)
            .map(async ([id, count]) => {
                const person = await window.AppDataStore.getById('customers', id)
                    || await window.AppDataStore.getById('prospects', id)
                    || await window.AppDataStore.getById('users', id);
                return { name: person?.full_name || `ID: ${id}`, count };
            });
        const top3 = await Promise.all(top3Promises);

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
                        <div class="strip-item"><span class="rank">#${i + 1}</span> ${esc(t.name || '')} (${t.count})</div>
                    `).join('')}
                    ${top3.length === 0 ? '<div class="text-muted" style="font-size:12px">No referrals yet.</div>' : ''}
                </div>
            </div>
        `;
    };

    const renderLeaderboard = async () => {
        const container = document.getElementById('referral-leaderboard-container');
        if (!container) return;

        const hiddenIds = window.UserPreferences.getSync('hidden_referrers', []);

        let sorted = null;
        try {
            const sb = window.supabase;
            if (sb && sb.rpc) {
                const { data, error } = await sb.rpc('get_referral_leaderboard', { p_period: _leaderboardPeriod });
                if (!error && Array.isArray(data)) {
                    sorted = data.map(r => ({
                        id: r.referrer_id,
                        type: r.referrer_type,
                        name: r.referrer_name,
                        count: Number(r.referral_count) || 0,
                        converted: Number(r.converted_count) || 0,
                        latest: r.latest_at
                    }));
                }
            }
        } catch (_) { /* fall through to JS path */ }

        if (!sorted) {
            const allReferrals = await getVisibleReferrals();
            const now = new Date();
            let cutoff = null;
            if (_leaderboardPeriod === 'year') cutoff = new Date(now.getFullYear(), 0, 1);
            else if (_leaderboardPeriod === 'month') cutoff = new Date(now.getFullYear(), now.getMonth(), 1);
            const referrals = cutoff
                ? allReferrals.filter(r => r.created_at && new Date(r.created_at) >= cutoff)
                : allReferrals;
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
            sorted = Object.values(grouped).sort((a, b) => b.count - a.count);
            for (const item of sorted) {
                const person = await window.AppDataStore.getById('customers', item.id)
                    || await window.AppDataStore.getById('prospects', item.id)
                    || await window.AppDataStore.getById('users', item.id);
                item.name = person?.full_name || '';
            }
        }

        const leaderboardItems = sorted.map((item, idx) => {
            if (hiddenIds.includes(String(item.id))) return '';
            if (!item.name) return '';
            return `
                <tr class="rank-${idx + 1}">
                    <td data-label="Rank" class="rank-cell">${idx + 1}</td>
                    <td data-label="Referrer" class="name-cell" onclick="app.showReferralTree(${item.id}, '${item.type || 'prospect'}')">
                        ${esc(item.name || '')}
                        ${item.type === 'customer' ? '<span class="badge" style="background:#dcfce7; color:#166534">C</span>' : ''}
                        ${item.type === 'user' ? '<span class="badge" style="background:#dbeafe; color:#1e40af">Agent</span>' : ''}
                    </td>
                    <td data-label="Referrals">${item.count}</td>
                    <td data-label="Converted"><span style="color:#10b981; font-weight:600">${item.converted}</span></td>
                    <td data-label="Latest">${window.UI.formatDate(item.latest)}</td>
                    <td class="text-right">
                        <button class="btn-icon" onclick="app.toggleHideReferrer('${item.id}')" title="Hide from leaderboard">
                            <i class="far fa-eye-slash"></i>
                        </button>
                    </td>
                </tr>
            `;
        });

        container.innerHTML = `
            <div class="leaderboard-controls-v2">
                <div style="display:flex; gap:12px; align-items:center;">
                    <select class="form-control" style="width:150px" onchange="app.changeLeaderboardPeriod(this.value)">
                        <option${_leaderboardPeriod === 'all' ? ' selected' : ''}>All Time</option>
                        <option${_leaderboardPeriod === 'year' ? ' selected' : ''}>This Year</option>
                        <option${_leaderboardPeriod === 'month' ? ' selected' : ''}>This Month</option>
                    </select>
                    <button class="btn secondary btn-sm" onclick="app.resetHiddenReferrers()">Reset Hidden</button>
                </div>
                <div class="text-muted" font-size="12px">Showing top contributors</div>
            </div>
            <table class="leaderboard-table-v2">
                <thead>
                    <tr>
                        <th scope="col">Rank</th>
                        <th scope="col">Referrer Name</th>
                        <th scope="col">Total Referrals</th>
                        <th scope="col">Converted</th>
                        <th scope="col">Latest Activity</th>
                        <th scope="col" class="text-right">Action</th>
                    </tr>
                </thead>
                <tbody>
                    ${leaderboardItems.join('')}
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
        let hiddenIds = window.UserPreferences.getSync('hidden_referrers', []);
        id = String(id);
        if (hiddenIds.includes(id)) {
            hiddenIds = hiddenIds.filter(hid => hid !== id);
        } else {
            hiddenIds.push(id);
        }
        await window.UserPreferences.save('hidden_referrers', hiddenIds);
        await renderLeaderboard();
        window.UI.toast.info("Leaderboard preferences updated.");
    };

    const resetHiddenReferrers = async () => {
        await window.UserPreferences.save('hidden_referrers', []);
        await renderLeaderboard();
        window.UI.toast.success("Hidden referrers reset.");
    };

    const searchTreePerson = async (query) => {
        const results = document.getElementById('tree-search-results');
        if (!query || query.length < 2) {
            results.style.display = 'none';
            return;
        }

        const _currentUser = window._appState?.cu;
        const visibleIds = await getVisibleUserIds(_currentUser);
        const [allProspects, allCustomers] = await Promise.all([
            window.AppDataStore.getAll('prospects'),
            window.AppDataStore.getAll('customers'),
        ]);
        const prospects = visibleIds === 'all'
            ? allProspects
            : allProspects.filter(p => visibleIds.map(String).includes(String(p.responsible_agent_id)));
        const customers = visibleIds === 'all'
            ? allCustomers
            : allCustomers.filter(c => visibleIds.map(String).includes(String(c.responsible_agent_id || c.agent_id)));
        const all = [
            ...prospects.map(p => ({ ...p, type: 'prospect' })),
            ...customers.map(c => ({ ...c, type: 'customer' }))
        ];

        const filtered = all.filter(p => p.full_name?.toLowerCase().includes(query.toLowerCase()) || p.nickname?.toLowerCase().includes(query.toLowerCase())).slice(0, 8);

        if (filtered.length > 0) {
            results.innerHTML = filtered.map(p => `
                <div class="result-item-v2" onclick="app.showReferralTree(${p.id}, '${p.type}')">
                    <div style="background: ${p.type === 'customer' ? '#dcfce7' : '#f1f5f9'}; width:32px; height:32px; border-radius:50%; display:flex; align-items:center; justify-content:center;">
                        <i class="fas ${p.type === 'customer' ? 'fa-user-check' : 'fa-user'}" style="color:${p.type === 'customer' ? '#166534' : '#64748b'}; font-size:12px;"></i>
                    </div>
                    <div style="flex-grow:1">
                        <div style="font-weight:600; font-size:14px;">${esc(p.full_name || '')}</div>
                        <div style="font-size:11px; color:var(--gray-500)">${p.phone ? esc(p.phone) : 'No phone'}</div>
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

    const showReferralTree = async (personId, personType, pushToStack = false) => {
        if (pushToStack && _currentSelectedPerson) {
            _treeNavStack.push({ ..._currentSelectedPerson });
        } else if (!pushToStack) {
            _treeNavStack = [];
        }
        const backBtn = document.getElementById('tree-back-btn');
        if (backBtn) backBtn.style.display = _treeNavStack.length > 0 ? 'flex' : 'none';

        _currentSelectedPerson = { id: personId, type: personType };
        const searchResults = document.getElementById('tree-search-results');
        const searchInput = document.getElementById('tree-search-input');
        const placeholder = document.getElementById('referral-tree-placeholder');
        const svg = document.getElementById('referral-tree-svg');
        if (searchResults) searchResults.style.display = 'none';
        if (searchInput) searchInput.value = '';
        if (placeholder) placeholder.style.display = 'none';
        if (svg) svg.style.display = 'block';

        _currentTreeData = await buildTreeData(personId, personType);
        if (!_currentTreeData) {
            window.UI.toast.error('Could not build tree for this person');
            return;
        }
        await renderD3Tree(_currentTreeData);
    };

    const buildTreeData = async (rootId, rootType) => {
        const _currentUser = window._appState?.cu;

        const [allUsers, allProspects, allCustomers, allReferrals, allActivities, allEventAttendees] = await Promise.all([
            window.AppDataStore.getAll('users'),
            window.AppDataStore.getAll('prospects'),
            window.AppDataStore.getAll('customers'),
            window.AppDataStore.getAll('referrals'),
            window.AppDataStore.getAll('activities'),
            window.AppDataStore.getAll('event_attendees'),
        ]);

        const cpsProspectIds = new Set();
        const unableToServeProspectIds = new Set();
        for (const a of allActivities) {
            if (a.activity_type === 'CPS' && a.prospect_id) cpsProspectIds.add(String(a.prospect_id));
            if (a.unable_to_serve && a.prospect_id) unableToServeProspectIds.add(String(a.prospect_id));
        }
        const eventAttendanceCount = new Map();
        for (const ea of allEventAttendees) {
            if ((ea.attended || ea.attendance_status === 'Attended') && ea.attendee_type !== 'agent') {
                const pid = String(ea.entity_id || ea.attendee_id);
                eventAttendanceCount.set(pid, (eventAttendanceCount.get(pid) || 0) + 1);
            }
        }
        const referralCountByReferrer = new Map();
        for (const r of allReferrals) {
            if (r.referrer_id) {
                const key = String(r.referrer_id);
                referralCountByReferrer.set(key, (referralCountByReferrer.get(key) || 0) + 1);
            }
        }

        const lvlMatch = _currentUser?.role?.match(/Level\s+(\d+)/i);
        const level = lvlMatch ? parseInt(lvlMatch[1]) : 10;
        const fullAccess = level <= 2;
        let visibleUserIds = null;
        if (!fullAccess) {
            const vIds = await getVisibleUserIds(_currentUser);
            visibleUserIds = vIds === 'all' ? null : new Set((vIds || []).map(String));
        }
        const canViewUser = (uid) => fullAccess || visibleUserIds === null || visibleUserIds.has(String(uid));
        const canViewProspectSync = (p) =>
            fullAccess || visibleUserIds === null || visibleUserIds.has(String(p.responsible_agent_id));
        const canViewCustomerSync = (c) =>
            fullAccess || visibleUserIds === null ||
            visibleUserIds.has(String(c.responsible_agent_id)) ||
            visibleUserIds.has(String(c.agent_id));

        const usersById = new Map(allUsers.map(u => [String(u.id), u]));
        const prospectsById = new Map(allProspects.map(p => [String(p.id), p]));
        const customersById = new Map(allCustomers.map(c => [String(c.id), c]));

        const subAgentsByParent = new Map();
        for (const u of allUsers) {
            if (!u || u.status === 'inactive' || !u.reporting_to) continue;
            const key = String(u.reporting_to);
            if (!subAgentsByParent.has(key)) subAgentsByParent.set(key, []);
            subAgentsByParent.get(key).push(u);
        }

        const referralsByReferrer = new Map();
        for (const r of allReferrals) {
            if (!r || !r.referrer_id) continue;
            const rType = r.referrer_type || 'prospect';
            const key = `${rType}:${r.referrer_id}`;
            if (!referralsByReferrer.has(key)) referralsByReferrer.set(key, []);
            referralsByReferrer.get(key).push(r);
        }

        const prospectsByAgent = new Map();
        for (const p of allProspects) {
            if (!p || !p.responsible_agent_id) continue;
            const key = String(p.responsible_agent_id);
            if (!prospectsByAgent.has(key)) prospectsByAgent.set(key, []);
            prospectsByAgent.get(key).push(p);
        }

        const MAX_NODES = 400;
        const MAX_DEPTH = 8;
        let nodeCount = 0;
        const visited = new Set();

        const walk = (id, type, depth) => {
            if (depth > MAX_DEPTH) return null;
            if (nodeCount >= MAX_NODES) return null;
            const visitKey = `${type}:${id}`;
            if (visited.has(visitKey)) return null;
            visited.add(visitKey);

            let person;
            if (type === 'user') {
                person = usersById.get(String(id));
                if (!person || !canViewUser(id)) return null;
            } else if (type === 'customer') {
                person = customersById.get(String(id));
                if (!person || !canViewCustomerSync(person)) return null;
            } else {
                person = prospectsById.get(String(id));
                if (!person || !canViewProspectSync(person)) return null;
            }

            nodeCount++;
            const pid = String(person.id);
            const node = {
                id: person.id,
                name: person.full_name,
                type,
                role: person.role || 'Guest',
                pipeline_stage: person.pipeline_stage,
                last_activity_date: person.last_activity_date,
                join_date: person.join_date || person.created_at,
                hasCPS: cpsProspectIds.has(pid),
                unableToServe: unableToServeProspectIds.has(pid),
                referralCount: referralCountByReferrer.get(pid) || 0,
                eventAttendanceCount: eventAttendanceCount.get(pid) || 0,
                closeProbability: person.close_probability || 0,
                children: []
            };

            if (type === 'user') {
                const subs = subAgentsByParent.get(String(id)) || [];
                for (const agent of subs) {
                    const childNode = walk(agent.id, 'user', depth + 1);
                    if (childNode) node.children.push(childNode);
                }
            }

            const refChildIds = new Set();
            const refs = referralsByReferrer.get(`${type}:${id}`) || [];
            for (const r of refs) {
                if (!r.referred_prospect_id) continue;
                const childNode = walk(r.referred_prospect_id, 'prospect', depth + 1);
                if (childNode) {
                    childNode.referralSource = r.referral_source;
                    childNode.referralDate = r.created_at;
                    node.children.push(childNode);
                    refChildIds.add(String(r.referred_prospect_id));
                }
            }

            if (type === 'user') {
                const agentProspects = prospectsByAgent.get(String(id)) || [];
                for (const p of agentProspects) {
                    if (refChildIds.has(String(p.id))) continue;
                    const childNode = walk(p.id, 'prospect', depth + 1);
                    if (childNode) node.children.push(childNode);
                }
            }

            return node;
        };

        return walk(rootId, rootType, 0);
    };

    const renderD3Tree = async (rootData) => {
        const container = document.getElementById('referral-tree-container');
        if (!container) return;
        await window._ensureD3();

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

        const tree = d3.tree().nodeSize([190, 90]);
        const root = d3.hierarchy(rootData);
        tree(root);

        const nowTs = Date.now();
        const nodeColourFromData = (data) => {
            if (data.type === 'user') return '#3b82f6';

            const hasActivityDate = !!data.last_activity_date;
            const daysSinceActivity = hasActivityDate
                ? (nowTs - new Date(data.last_activity_date).getTime()) / 86400000
                : 0;

            if (data.unableToServe) return '#94a3b8';
            if (data.hasCPS && hasActivityDate && daysSinceActivity > 180) return '#94a3b8';
            if (data.hasCPS && hasActivityDate && daysSinceActivity > 45) return '#eab308';
            if (data.closeProbability >= 60) return '#ef4444';
            if (data.referralCount > 5) return '#f59e0b';
            if (data.eventAttendanceCount > 5) return '#6366f1';
            if (data.hasCPS) return '#10b981';
            return '#ffffff';
        };
        const nodesData = root.descendants();
        for (const d of nodesData) {
            d.fillColor = nodeColourFromData(d.data);
        }

        _treeSvg.selectAll(".link")
            .data(root.links())
            .enter()
            .append("path")
            .attr("class", "link")
            .attr("d", d3.linkVertical()
                .x(d => d.x)
                .y(d => d.y));

        const nodes = _treeSvg.selectAll(".node")
            .data(root.descendants())
            .enter()
            .append("g")
            .attr("class", "node")
            .attr("transform", d => `translate(${d.x},${d.y})`);

        nodes.append("rect")
            .attr("width", 160)
            .attr("height", 44)
            .attr("x", -80)
            .attr("y", -22)
            .attr("rx", 6)
            .attr("fill", d => d.fillColor)
            .attr("stroke", d => d.fillColor === '#ffffff' ? '#d1d5db' : 'none')
            .attr("stroke-width", 2)
            .style("filter", "drop-shadow(0 2px 4px rgba(0,0,0,0.05))");

        const isLightBg = (d) => d.fillColor === '#ffffff' || d.fillColor === '#eab308';

        nodes.append("text")
            .attr("x", -70)
            .attr("y", 4)
            .attr("fill", d => isLightBg(d) ? '#374151' : '#ffffff')
            .style("font-family", '"Font Awesome 5 Free"')
            .style("font-weight", "900")
            .text(d => d.data.type === 'customer' ? "" : d.data.type === 'user' ? "" : "");

        nodes.append("text")
            .attr("x", -50)
            .attr("y", 0)
            .attr("fill", d => isLightBg(d) ? '#1f2937' : '#ffffff')
            .style("font-weight", "600")
            .style("font-size", "11px")
            .text(d => d.data.name.length > 18 ? d.data.name.substring(0, 15) + '...' : d.data.name);

        nodes.append("text")
            .attr("x", -50)
            .attr("y", 12)
            .attr("fill", d => isLightBg(d) ? '#6b7280' : 'rgba(255,255,255,0.8)')
            .style("font-size", "9px")
            .text(d => d.data.type === 'user' ? 'AGENT' : d.data.type.toUpperCase());

        nodes.append("text")
            .attr("class", "node-memo-btn")
            .attr("x", 65)
            .attr("y", 4)
            .attr("fill", d => isLightBg(d) ? '#94a3b8' : 'rgba(255,255,255,0.6)')
            .style("font-family", '"Font Awesome 5 Free"')
            .style("font-weight", "900")
            .text("")
            .on("click", async (e, d) => {
                e.stopPropagation();
                await window.app.openMemoModal(d.data.id, d.data.type);
            });

        nodes.on("click", async (e, d) => {
            e.stopPropagation();
            await window.app.showTreeNodeSidebar(d.data.id, d.data.type);
        });

        nodes.on("dblclick", async (e, d) => {
            e.stopPropagation();
            await showReferralTree(d.data.id, d.data.type, true);
        });

        nodes.attr("opacity", d => {
            if (_treeActiveFilter === 'all') return 1;
            const color = d.fillColor;
            if (_treeActiveFilter === 'new') {
                return color === '#10b981' ? 1 : 0.2;
            }
            if (_treeActiveFilter === 'expected_drop') {
                return (color === '#eab308' || color === '#94a3b8') ? 1 : 0.2;
            }
            if (_treeActiveFilter === 'lost') {
                return color === '#94a3b8' ? 1 : 0.2;
            }
            return 1;
        });

        const initialTransform = d3.zoomIdentity.translate(width / 2, 60).scale(0.9);
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

    const getAncestorPath = async (id) => {
        const MAX_DEPTH = 15;
        const targetId = String(id);

        try {
            const { data: row, error } = await window.supabase
                .from('referrals')
                .select('path_ids, path_types')
                .eq('referred_prospect_id', id)
                .limit(1)
                .maybeSingle();
            if (!error && row && Array.isArray(row.path_ids) && row.path_ids.length) {
                const ids = row.path_ids;
                const types = row.path_types || ids.map(() => 'prospect');
                const prospectIds = ids.filter((_, i) => (types[i] || 'prospect') !== 'customer');
                const customerIds = ids.filter((_, i) => (types[i] || 'prospect') === 'customer');
                const [pRows, cRows] = await Promise.all([
                    prospectIds.length
                        ? window.supabase.from('prospects').select('id, full_name').in('id', prospectIds).then(r => r.data || [])
                        : Promise.resolve([]),
                    customerIds.length
                        ? window.supabase.from('customers').select('id, full_name').in('id', customerIds).then(r => r.data || [])
                        : Promise.resolve([]),
                ]);
                const nameById = new Map();
                for (const p of pRows) nameById.set(`prospect:${p.id}`, p.full_name);
                for (const c of cRows) nameById.set(`customer:${c.id}`, c.full_name);
                const path = ids.map((rid, i) => {
                    const t = types[i] || 'prospect';
                    return { id: rid, type: t, name: nameById.get(`${t}:${rid}`) || '' };
                }).filter(n => n.name);
                if (path.length) return path;
            }
        } catch (_) {
            // Fall through to legacy walk on any error.
        }

        const referrals = await window.AppDataStore.getAll('referrals');
        const path = [];
        let currentId = targetId;
        const visited = new Set();

        for (let depth = 0; depth < MAX_DEPTH; depth++) {
            if (visited.has(currentId)) break;
            visited.add(currentId);

            const ref = referrals.find(r => String(r.referred_prospect_id) === currentId);
            if (!ref) break;

            const referrerId = ref.referrer_id;
            const referrerType = ref.referrer_type || 'prospect';
            const person = await window.AppDataStore.getById(referrerType === 'customer' ? 'customers' : 'prospects', referrerId);
            if (!person) break;

            path.unshift({ id: referrerId, type: referrerType, name: person.full_name });
            currentId = String(referrerId);
        }

        return path;
    };

    const showTreeNodeSidebar = async (id, type) => {
        const sidebar = document.getElementById('tree-node-sidebar');
        if (!sidebar) return;

        const person = await window.AppDataStore.getById(type === 'customer' ? 'customers' : 'prospects', id);
        if (!person) return;

        const ancestors = await getAncestorPath(id);
        const pathHtml = ancestors.length > 0
            ? ancestors.map(a => `<span>${esc(a.name || '')}</span>`).join(' <span style="color:var(--gray-300)">›</span> ') + ` <span style="color:var(--gray-300)">›</span> <strong>${esc(person.full_name || '')}</strong>`
            : `<strong>${esc(person.full_name || '')}</strong> <span style="color:var(--gray-400); font-size:10px">(root)</span>`;

        const _currentUser = window._appState?.cu;
        const currentUserId = _currentUser?.id;
        let isInterested = false;
        if (currentUserId) {
            try {
                const existing = await window.AppDataStore.query('tree_interested', {
                    user_id: currentUserId,
                    interested_person_id: id,
                    interested_person_type: type
                });
                isInterested = existing.length > 0;
            } catch (_) {}
        }

        const allReferrals = await window.AppDataStore.getAll('referrals');
        const made = allReferrals.filter(r => String(r.referrer_id) === String(id));
        const converted = made.filter(r => r.is_converted || r.status === 'Active').length;

        const pid = String(id);
        const allActivities = await window.AppDataStore.getAll('activities');
        const hasCPS = allActivities.some(a => a.activity_type === 'CPS' && String(a.prospect_id) === pid);
        const unableToServe = allActivities.some(a => a.unable_to_serve && String(a.prospect_id) === pid);
        const hasActivityDate = !!person.last_activity_date;
        const daysSinceActivity = hasActivityDate
            ? (Date.now() - new Date(person.last_activity_date).getTime()) / 86400000 : 0;
        const allAttendees = await window.AppDataStore.getAll('event_attendees');
        const attendedCount = allAttendees.filter(ea => (ea.attended || ea.attendance_status === 'Attended') && ea.attendee_type !== 'agent' && String(ea.entity_id || ea.attendee_id) === pid).length;

        let stageColor, stageName;
        if (type === 'user') { stageColor = '#3b82f6'; stageName = 'Agent'; }
        else if (unableToServe) { stageColor = '#94a3b8'; stageName = 'Unable to Serve'; }
        else if (hasCPS && hasActivityDate && daysSinceActivity > 180) { stageColor = '#94a3b8'; stageName = 'CPS — Inactive 180d+'; }
        else if (hasCPS && daysSinceActivity > 45) { stageColor = '#eab308'; stageName = 'CPS — Inactive 45d+'; }
        else if ((person.close_probability || 0) >= 60) { stageColor = '#ef4444'; stageName = 'High Closing Chance'; }
        else if (made.length > 5) { stageColor = '#f59e0b'; stageName = 'Referrer 5+'; }
        else if (attendedCount > 5) { stageColor = '#6366f1'; stageName = 'Event Regular'; }
        else if (hasCPS) { stageColor = '#10b981'; stageName = 'CPS'; }
        else { stageColor = '#ffffff'; stageName = type === 'customer' ? 'Customer' : 'Prospect'; }

        sidebar.style.display = 'flex';
        sidebar.innerHTML = `
            <div style="display:flex; justify-content:space-between; align-items:flex-start; margin-bottom:14px">
                <div style="flex:1; min-width:0">
                    <div style="font-size:15px; font-weight:700; color:var(--gray-800); white-space:normal; word-break:break-word">${esc(person.full_name || '')}</div>
                    <span style="background:${stageColor}; color:${stageColor === '#ffffff' || stageColor === '#eab308' ? '#374151' : 'white'}; font-size:10px; padding:2px 8px; border-radius:10px; text-transform:uppercase; display:inline-block; margin-top:4px; ${stageColor === '#ffffff' ? 'border:1px solid #d1d5db;' : ''}">${stageName}</span>
                </div>
                <button onclick="app.toggleTreeInterested(${id}, '${type}')" class="interested-heart-btn" id="heart-btn-${id}" title="${isInterested ? 'Remove bookmark' : 'Add bookmark'}">
                    ${isInterested ? '❤️' : '🤍'}
                </button>
            </div>

            <div class="sidebar-field">
                <label>ID</label>
                <div style="display:flex; align-items:center; gap:8px">
                    <span class="value">${id}</span>
                    <button class="sidebar-copy-btn" onclick="navigator.clipboard.writeText('${id}'); window.UI.toast.success('ID copied!')">Copy</button>
                </div>
            </div>

            ${person.phone ? `<div class="sidebar-field"><label>Phone</label><div class="value">${esc(person.phone)}</div></div>` : ''}
            ${person.email ? `<div class="sidebar-field"><label>Email</label><div class="value" style="font-size:12px">${esc(person.email)}</div></div>` : ''}
            ${person.occupation ? `<div class="sidebar-field"><label>Occupation</label><div class="value">${esc(person.occupation)}</div></div>` : ''}

            <div class="sidebar-field">
                <label>Referrals Made</label>
                <div class="value">${made.length} total &nbsp;·&nbsp; <span style="color:#10b981; font-weight:600">${converted} converted</span></div>
            </div>

            ${(person.join_date || person.created_at) ? `
            <div class="sidebar-field">
                <label>Joined</label>
                <div class="value">${window.UI.formatDate(person.join_date || person.created_at)}</div>
            </div>` : ''}

            <div style="margin:12px 0; padding:10px 12px; background:#f8fafc; border-radius:8px; border-left:3px solid #3b82f6">
                <div style="font-size:10px; text-transform:uppercase; letter-spacing:0.06em; color:var(--gray-400); font-weight:600; margin-bottom:6px">Referral Chain</div>
                <div class="sidebar-ancestor-path">${pathHtml}</div>
            </div>

            <div style="display:flex; flex-direction:column; gap:8px; margin-top:auto; padding-top:8px; border-top:1px solid var(--gray-100)">
                <button class="btn primary btn-sm" onclick="app.showReferralTree(${id}, '${type}', true)">
                    <i class="fas fa-sitemap"></i> View Their Tree
                </button>
                <button class="btn secondary btn-sm" onclick="app.${type === 'customer' ? 'showCustomerDetail' : 'showProspectDetail'}(${id})">
                    <i class="fas fa-user"></i> Full Profile
                </button>
            </div>
        `;
    };

    const toggleTreeInterested = async (id, type) => {
        const _currentUser = window._appState?.cu;
        const currentUserId = _currentUser?.id;
        if (!currentUserId) { window.UI.toast.error('You must be logged in'); return; }

        let existing = [];
        try {
            existing = await window.AppDataStore.query('tree_interested', {
                user_id: currentUserId,
                interested_person_id: id,
                interested_person_type: type
            });
        } catch (_) {}

        const heartBtn = document.getElementById(`heart-btn-${id}`);

        if (existing.length > 0) {
            await window.AppDataStore.delete('tree_interested', existing[0].id);
            if (heartBtn) heartBtn.innerHTML = '🤍';
            if (heartBtn) heartBtn.title = 'Add bookmark';
            window.UI.toast.info('Removed from bookmarks');
        } else {
            let allInterested = [];
            try { allInterested = await window.AppDataStore.query('tree_interested', { user_id: currentUserId }); } catch (_) {}
            if (allInterested.length >= 100) {
                window.UI.toast.error('Maximum 100 bookmarks reached. Remove some first.');
                return;
            }

            const person = await window.AppDataStore.getById(type === 'customer' ? 'customers' : 'prospects', id);
            await window.AppDataStore.create('tree_interested', {
                id: Date.now(),
                user_id: currentUserId,
                interested_person_id: id,
                interested_person_type: type,
                interested_person_name: person?.full_name || '',
                created_at: new Date().toISOString()
            });
            if (heartBtn) heartBtn.innerHTML = '❤️';
            if (heartBtn) heartBtn.title = 'Remove bookmark';
            window.UI.toast.success('Bookmarked!');
        }
    };

    const showTreeBookmarks = async () => {
        const _currentUser = window._appState?.cu;
        const currentUserId = _currentUser?.id;
        if (!currentUserId) { window.UI.toast.error('Login required'); return; }

        let bookmarks = [];
        try { bookmarks = await window.AppDataStore.query('tree_interested', { user_id: currentUserId }); } catch (_) {}

        if (bookmarks.length === 0) {
            window.UI.toast.info('No bookmarks yet. Click ❤️ on any node in the sidebar to bookmark.');
            return;
        }

        const rows = bookmarks.map(b => `
            <div style="display:flex; align-items:center; justify-content:space-between; padding:10px 4px; border-bottom:1px solid var(--gray-100); gap:8px">
                <div style="flex:1; min-width:0">
                    <div style="font-weight:600; font-size:14px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis">${esc(b.interested_person_name || 'ID: ' + b.interested_person_id)}</div>
                    <div style="font-size:11px; color:var(--gray-500); text-transform:uppercase">${b.interested_person_type}</div>
                </div>
                <div style="display:flex; gap:6px; flex-shrink:0">
                    <button class="btn secondary btn-sm" onclick="window.UI.hideModal(); app.showReferralTree(${b.interested_person_id}, '${b.interested_person_type}')">
                        <i class="fas fa-sitemap"></i> Go
                    </button>
                    <button class="btn-icon" title="Remove" onclick="(async () => { await app.toggleTreeInterested(${b.interested_person_id}, '${b.interested_person_type}'); window.UI.hideModal(); await app.showTreeBookmarks(); })()">
                        <i class="fas fa-times" style="color:#ef4444"></i>
                    </button>
                </div>
            </div>
        `).join('');

        window.UI.showModal(`Bookmarks (${bookmarks.length})`, `
            <div style="max-height:420px; overflow-y:auto; padding:0 4px">${rows}</div>
        `);
    };

    const applyTreeFilters = async (filter) => {
        _treeActiveFilter = filter;
        document.querySelectorAll('.tree-filter-chip').forEach(chip => {
            chip.classList.toggle('active', chip.dataset.filter === filter);
        });
        if (_currentTreeData) await renderD3Tree(_currentTreeData);
    };

    const treeNavBack = async () => {
        if (_treeNavStack.length === 0) return;
        const prev = _treeNavStack.pop();
        const backBtn = document.getElementById('tree-back-btn');
        if (backBtn) backBtn.style.display = _treeNavStack.length > 0 ? 'flex' : 'none';

        _currentSelectedPerson = prev;
        _currentTreeData = await buildTreeData(prev.id, prev.type);
        if (_currentTreeData) await renderD3Tree(_currentTreeData);
    };

    const openAddReferralModal = async () => {
        _modalSelectedReferrer = null;
        _modalSelectedReferred = null;

        const content = `
            <div class="referral-modal-v2">
                <div class="ref-form-step">
                    <label>1. Who is the Referrer?</label>
                    <div class="search-field">
                        <input type="text" id="referrer-search" class="form-control" placeholder="Search customer or prospect..." onkeyup="app.debounceCall('referrer-search', () => app.searchReferrersForModal(this.value, 'referrer'), 250)">
                        <div id="referrer-search-results" class="search-dropdown"></div>
                    </div>
                    <div id="selected-referrer-info" class="selected-entity-display"></div>
                </div>

                <div class="ref-form-step" style="margin-top:20px">
                    <label>2. Who was Referred?</label>
                    <div class="search-field">
                        <div style="display:flex; gap:8px">
                            <input type="text" id="referred-search" class="form-control" placeholder="Search existing prospect..." onkeyup="app.debounceCall('referred-search', () => app.searchReferrersForModal(this.value, 'referred'), 250)">
                            <button class="btn secondary" onclick="app.openCreateProspectForReferral()"><i class="fas fa-user-plus"></i> New</button>
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

        window.UI.showModal("Add New Referral", content, [
            { label: "Cancel", type: "secondary", action: "UI.hideModal()" },
            { label: "Create Referral", type: "primary", action: "(async () => { await app.submitReferral(); })()" }
        ]);
    };

    const searchReferrersForModal = async (query, modalType) => {
        const resultsDiv = document.getElementById(`${modalType}-search-results`);
        if (!query || query.length < 2) {
            resultsDiv.style.display = 'none';
            return;
        }

        const [prospects, customers] = await Promise.all([
            window.AppDataStore.searchProspects(query, { includeDormant: true, limit: 10 }),
            window.AppDataStore.searchCustomers(query, { limit: 10 }),
        ]);
        const filtered = [
            ...prospects.map(p => ({ ...p, type: 'prospect' })),
            ...customers.map(c => ({ ...c, type: 'customer' })),
        ].slice(0, 5);

        if (filtered.length > 0) {
            resultsDiv.innerHTML = filtered.map(p => `
                <div class="result-item-v2" onclick="app.selectReferrerForModal(${p.id}, '${p.type}', '${modalType}')">
                    <div style="flex-grow:1">
                        <strong>${esc(p.full_name || '')}</strong>
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

    const selectReferrerForModal = async (id, type, modalType) => {
        const person = await window.AppDataStore.getById(type === 'customer' ? 'customers' : 'prospects', id);
        if (!person) return;

        if (modalType === 'referrer') _modalSelectedReferrer = { id, type, name: person.full_name };
        else _modalSelectedReferred = { id, type, name: person.full_name };

        document.getElementById(`${modalType}-search-results`).style.display = 'none';
        document.getElementById(`${modalType}-search`).value = '';

        const display = document.getElementById(`selected-${modalType}-info`);
        display.innerHTML = `
            <div class="entity-chip">
                <span><i class="fas fa-check-circle" style="color:#10b981"></i> <strong>${esc(person.full_name || '')}</strong> (${type})</span>
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
        await window.app.openProspectModal();
        const handler = async (e) => {
            const newProspect = e.detail;
            await selectReferrerForModal(newProspect.id, 'prospect', 'referred');
            document.removeEventListener('prospectCreated', handler);
        };
        document.addEventListener('prospectCreated', handler);
    };

    const submitReferral = async () => {
        if (!_modalSelectedReferrer || !_modalSelectedReferred) {
            window.UI.toast.error("Please select both a referrer and a referred person.");
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

        await window.AppDataStore.create('referrals', referral);
        window.UI.toast.success("Referral created successfully!");
        window.UI.hideModal();

        await renderReferralSummaryAndLeaderboard();
        if (_currentSelectedPerson && String(_currentSelectedPerson.id) === String(_modalSelectedReferrer.id)) {
            await showReferralTree(_currentSelectedPerson.id, _currentSelectedPerson.type);
        }
    };

    const openReferralFromProfile = async (entityId, entityType) => {
        await openAddReferralModal();
        await selectReferrerForModal(entityId, entityType, 'referrer');
    };

    const viewReferralDetails = async (referralId) => {
        const { escapeHtml } = window._crmUtils || {};
        const r = await window.AppDataStore.getById('referrals', referralId);
        if (!r) return;
        const prospect = await window.AppDataStore.getById('prospects', r.referred_prospect_id);
        const referrer = await window.AppDataStore.getById('customers', r.referrer_customer_id);
        const content = `
            <div class="form-section">
                <div style="display:grid; gap:8px;">
                    <div class="info-row"><div class="info-label">Referrer</div><div class="info-value">${escapeHtml(referrer?.full_name || 'N/A')}</div></div>
                    <div class="info-row"><div class="info-label">Referred Person</div><div class="info-value">${escapeHtml(prospect?.full_name || 'N/A')}</div></div>
                    <div class="info-row"><div class="info-label">Relationship</div><div class="info-value">${escapeHtml(r.relationship || '-')}</div></div>
                    <div class="info-row"><div class="info-label">Date</div><div class="info-value">${r.date || '-'}</div></div>
                    <div class="info-row"><div class="info-label">Source</div><div class="info-value">${escapeHtml(r.source || '-')}</div></div>
                    <div class="info-row"><div class="info-label">Status</div><div class="info-value"><span class="score-badge ${r.status === 'Active' ? 'score-A+' : 'score-A'}">${r.status}</span></div></div>
                    <div class="info-row"><div class="info-label">Reward Status</div><div class="info-value">${r.reward_status || '-'}</div></div>
                    ${r.notes ? `<div class="info-row"><div class="info-label">Notes</div><div class="info-value">${escapeHtml(r.notes)}</div></div>` : ''}
                </div>
            </div>
        `;
        window.UI.showModal('Referral Details', content, [
            { label: 'Close', type: 'secondary', action: 'UI.hideModal()' },
            { label: 'Update', type: 'primary', action: `app.openUpdateReferralModal(${referralId})` }
        ]);
    };

    const openUpdateReferralModal = async (referralId) => {
        const { escapeHtml } = window._crmUtils || {};
        const r = await window.AppDataStore.getById('referrals', referralId);
        if (!r) return;
        const prospect = await window.AppDataStore.getById('prospects', r.referred_prospect_id);
        const content = `
            <div class="form-section">
                <p style="margin-bottom:16px; color:var(--gray-600);">Referred: <strong>${escapeHtml(prospect?.full_name || 'N/A')}</strong></p>
                <div class="form-group">
                    <label>Status</label>
                    <select id="ref-update-status" class="form-control">
                        <option ${r.status === 'Active' ? 'selected' : ''}>Active</option>
                        <option ${r.status === 'Converted' ? 'selected' : ''}>Converted</option>
                        <option ${r.status === 'Inactive' ? 'selected' : ''}>Inactive</option>
                    </select>
                </div>
                <div class="form-group">
                    <label>Reward Status</label>
                    <select id="ref-update-reward" class="form-control">
                        <option ${r.reward_status === 'Pending' ? 'selected' : ''}>Pending</option>
                        <option ${r.reward_status === 'Paid' ? 'selected' : ''}>Paid</option>
                        <option ${r.reward_status === 'Not Applicable' ? 'selected' : ''}>Not Applicable</option>
                    </select>
                </div>
                <div class="form-group">
                    <label>Notes</label>
                    <textarea id="ref-update-notes" class="form-control" rows="3">${escapeHtml(r.notes || '')}</textarea>
                </div>
            </div>
        `;
        window.UI.showModal('Update Referral', content, [
            { label: 'Cancel', type: 'secondary', action: 'UI.hideModal()' },
            { label: 'Save', type: 'primary', action: `(async () => { await app.saveReferralUpdate(${referralId}); })()` }
        ]);
    };

    const saveReferralUpdate = async (referralId) => {
        const data = {
            status: document.getElementById('ref-update-status').value,
            reward_status: document.getElementById('ref-update-reward').value,
            notes: document.getElementById('ref-update-notes').value.trim()
        };
        await window.AppDataStore.update('referrals', referralId, data);
        window.UI.toast.success('Referral updated.');
        window.UI.hideModal();
    };

    const openMemoModal = async (id, type) => {
        const notesArr = await window.AppDataStore.getAll('notes');
        const notes = (notesArr || []).filter(n => n.entity_type === type && n.entity_id == id);
        const latest = notes.sort((a,b) => new Date(b.created_at) - new Date(a.created_at))[0];

        const profileCall = type === 'user'
            ? `app.showAgentProfile(${id})`
            : type === 'customer'
                ? `app.showCustomerDetail(${id})`
                : `app.showProspectDetail(${id})`;

        const content = `
            <div style="padding:10px">
                <h4>Latest Memo/Note</h4>
                <div style="background:#f1f5f9; padding:16px; border-radius:8px; margin:16px 0; border-left:4px solid #3b82f6">
                    ${latest ? esc(latest.content || '') : 'No memos found for this person.'}
                    <div style="font-size:11px; color:#64748b; margin-top:8px">
                        ${latest ? 'Written by ' + esc((await window.AppDataStore.getById('users', latest.created_by))?.full_name || 'Admin') + ' on ' + window.UI.formatDate(latest.created_at) : ''}
                    </div>
                </div>
                <button class="btn secondary btn-block" onclick="window.UI.hideModal(); ${profileCall}">View Full Profile</button>
            </div>
        `;
        window.UI.showModal("Memo Details", content);
    };

    // ── Main entry point ─────────────────────────────────────────────────────
    window._fv.showReferralsView = async (container) => {
        const _currentUser = window._appState?.cu;

        window._appState.cv = 'referrals';
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
                            <input type="text" id="tree-search-input" placeholder="Search person to view tree..." autocomplete="off" oninput="app.debounceCall('tree-search', () => app.searchTreePerson(this.value), 260)">
                            <div id="tree-search-results" class="search-results-v2"></div>
                        </div>
                        <button class="btn primary" onclick="app.openAddReferralModal()">
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
                            <div style="display:flex; align-items:center; gap:16px; flex-wrap:wrap">
                                <h3><i class="fas fa-network-wired"></i> Relationship Tree</h3>
                                <div class="tree-filter-chips">
                                    <button class="tree-filter-chip active" data-filter="all" onclick="app.applyTreeFilters('all')">All</button>
                                    <button class="tree-filter-chip" data-filter="new" onclick="app.applyTreeFilters('new')">CPS Active</button>
                                    <button class="tree-filter-chip" data-filter="expected_drop" onclick="app.applyTreeFilters('expected_drop')">Expected to Drop</button>
                                    <button class="tree-filter-chip" data-filter="lost" onclick="app.applyTreeFilters('lost')">Inactive / Unable</button>
                                </div>
                            </div>
                            <div class="tree-tools">
                                <button class="tool-btn" id="tree-back-btn" onclick="app.treeNavBack()" title="Go Back" style="display:none"><i class="fas fa-arrow-left"></i></button>
                                <button class="tool-btn" onclick="app.treeZoomIn()" title="Zoom In"><i class="fas fa-plus"></i></button>
                                <button class="tool-btn" onclick="app.treeZoomOut()" title="Zoom Out"><i class="fas fa-minus"></i></button>
                                <button class="tool-btn" onclick="app.treeResetZoom()" title="Reset"><i class="fas fa-compress-arrows-alt"></i></button>
                                <button class="tool-btn" onclick="app.showTreeBookmarks()" title="Bookmarks"><i class="fas fa-heart"></i></button>
                                <button class="tool-btn" onclick="app.exportRelationshipTree()" title="Export"><i class="fas fa-download"></i></button>
                            </div>
                        </div>
                        <div class="tree-workspace">
                            <div id="referral-tree-container" class="tree-visualization">
                                <div id="referral-tree-placeholder" class="tree-empty">
                                    <i class="fas fa-search"></i>
                                    <p>Search for a person above to view their referral network.</p>
                                </div>
                                <svg id="referral-tree-svg" style="width:100%; height:100%; display:none;"></svg>
                            </div>
                            <div id="tree-node-sidebar" class="tree-node-sidebar" style="display:none"></div>
                        </div>
                    </div>
                </div>
            </div>
        `;

        if (!document.getElementById('referral-styles-v2')) {
            const style = document.createElement('style');
            style.id = 'referral-styles-v2';
            style.textContent = `
                .referrals-view-v2 { padding: 24px; color: var(--gray-800); }
                .ref-v2-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 24px; gap: 20px; flex-wrap: wrap; }
                .ref-v2-subtitle { color: var(--gray-500); font-size: 14px; margin-top: 4px; }
                .ref-v2-actions { display: flex; gap: 12px; align-items: center; }
                
                .search-box-v2 { position: relative; width: 300px; }
                .search-box-v2 i { position: absolute; left: 12px; top: 50%; transform: translateY(-50%); color: var(--gray-400); }
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
                .name-cell .badge {
                    display: inline-block;
                    margin-left: 8px;
                    padding: 2px 8px;
                    border-radius: 999px;
                    font-size: 11px;
                    font-weight: 600;
                    line-height: 1.4;
                    vertical-align: middle;
                    text-decoration: none;
                }
                .name-cell:hover .badge { text-decoration: none; }
                
                /* Tree Section */
                .ref-v2-tree-section { background: white; border-radius: 12px; border: 1px solid var(--gray-200); display: flex; flex-direction: column; min-height: 500px; }
                .tree-header { padding: 16px 20px; border-bottom: 1px solid var(--gray-100); display: flex; justify-content: space-between; align-items: center; }
                .tree-header h3 { margin: 0; font-size: 16px; font-weight: 600; display: flex; align-items: center; gap: 10px; }
                .tree-tools { display: flex; gap: 8px; }
                .tool-btn { width: 32px; height: 32px; border-radius: 6px; border: 1px solid var(--gray-200); background: white; color: var(--gray-600); cursor: pointer; display: flex; align-items: center; justify-content: center; }
                .tool-btn:hover { background: var(--gray-50); color: #3b82f6; border-color: #3b82f6; }
                
                .tree-workspace { display: flex; flex-grow: 1; min-height: 0; overflow: hidden; border-radius: 0 0 12px 12px; }
                .tree-visualization { flex: 1; min-width: 0; position: relative; background: #f8fafc; overflow: hidden; }
                .tree-empty { position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; color: var(--gray-400); gap: 16px; }
                .tree-empty i { font-size: 48px; }

                /* Filter Chips */
                .tree-filter-chips { display: flex; gap: 6px; flex-wrap: wrap; }
                .tree-filter-chip { padding: 4px 12px; border-radius: 20px; font-size: 12px; border: 1px solid var(--gray-200); cursor: pointer; background: white; color: var(--gray-600); transition: all 0.15s; }
                .tree-filter-chip:hover { border-color: #3b82f6; color: #3b82f6; }
                .tree-filter-chip.active { background: #3b82f6; color: white; border-color: #3b82f6; }

                /* Node Sidebar */
                .tree-node-sidebar { width: 280px; flex-shrink: 0; border-left: 1px solid var(--gray-200); padding: 16px; overflow-y: auto; background: white; display: flex; flex-direction: column; gap: 4px; }
                .sidebar-field { margin-bottom: 10px; }
                .sidebar-field label { font-size: 10px; text-transform: uppercase; letter-spacing: 0.06em; color: var(--gray-400); display: block; margin-bottom: 2px; font-weight: 600; }
                .sidebar-field .value { font-size: 13px; font-weight: 500; color: var(--gray-800); word-break: break-word; }
                .sidebar-ancestor-path { font-size: 11px; color: var(--gray-600); line-height: 1.9; word-break: break-word; }
                .interested-heart-btn { background: none; border: none; font-size: 18px; cursor: pointer; padding: 4px 6px; border-radius: 6px; transition: background 0.15s; flex-shrink: 0; }
                .interested-heart-btn:hover { background: #fef2f2; }
                .sidebar-copy-btn { font-size: 11px; background: #f1f5f9; border: none; border-radius: 4px; padding: 2px 8px; cursor: pointer; color: #64748b; transition: background 0.15s; }
                .sidebar-copy-btn:hover { background: #e2e8f0; }
                
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

        renderReferralSummaryAndLeaderboard().catch(e => console.warn('referral summary failed:', e));

        const user = _currentUser;
        if (user) {
            showReferralTree(user.id, 'user').catch(e => console.warn('referral tree failed:', e));
        }
    };

    // ── Expose all sub-functions on window.app so inline onclick= handlers work
    const app = window.app;
    app.renderReferralSummaryAndLeaderboard = renderReferralSummaryAndLeaderboard;
    app.toggleLeaderboard                   = toggleLeaderboard;
    app.toggleHideReferrer                  = toggleHideReferrer;
    app.resetHiddenReferrers                = resetHiddenReferrers;
    app.searchTreePerson                    = searchTreePerson;
    app.showReferralTree                    = showReferralTree;
    app.treeZoomIn                          = treeZoomIn;
    app.treeZoomOut                         = treeZoomOut;
    app.treeResetZoom                       = treeResetZoom;
    app.showTreeNodeSidebar                 = showTreeNodeSidebar;
    app.toggleTreeInterested                = toggleTreeInterested;
    app.showTreeBookmarks                   = showTreeBookmarks;
    app.applyTreeFilters                    = applyTreeFilters;
    app.treeNavBack                         = treeNavBack;
    app.openAddReferralModal                = openAddReferralModal;
    app.searchReferrersForModal             = searchReferrersForModal;
    app.selectReferrerForModal              = selectReferrerForModal;
    app.clearSelectedForModal               = clearSelectedForModal;
    app.openCreateProspectForReferral       = openCreateProspectForReferral;
    app.submitReferral                      = submitReferral;
    app.openReferralFromProfile             = openReferralFromProfile;
    app.viewReferralDetails                 = viewReferralDetails;
    app.openUpdateReferralModal             = openUpdateReferralModal;
    app.saveReferralUpdate                  = saveReferralUpdate;
    app.openMemoModal                       = openMemoModal;

    // changeLeaderboardPeriod updates the module-scoped period variable then
    // re-renders — it was a closure function in the original IIFE.
    app.changeLeaderboardPeriod = (val) => {
        if (val === 'All Time') _leaderboardPeriod = 'all';
        else if (val === 'This Year') _leaderboardPeriod = 'year';
        else if (val === 'This Month') _leaderboardPeriod = 'month';
        else _leaderboardPeriod = val;
        renderLeaderboard().catch(e => console.warn('leaderboard refresh failed:', e));
    };

})();

// ══════════════ showCasesView ══════════════
window._fv.showCasesView = async (container) => {
    const _currentUser = window._appState?.cu;
    const { escapeHtml, isSystemAdmin, isMarketingManager } = window._crmUtils || {};

    // Closure state lifted to window._appState
    if (!window._appState.caseFilters) window._appState.caseFilters = { search: '', product: 'all', from: '', to: '', visibility: 'all', agent: 'all', tag: 'all' };
    if (window._appState.caseActiveTab === undefined) window._appState.caseActiveTab = 'cps';
    if (window._appState.caseAdvOpen === undefined) window._appState.caseAdvOpen = false;

    const _caseFilters = window._appState.caseFilters;
    const _caseActiveTab = window._appState.caseActiveTab;
    const _caseAdvOpen = window._appState.caseAdvOpen;

    const products = ((await window.AppDataStore.getAll('products')) || []).filter(p => p.is_active !== false);
    const allUsers = (await window.AppDataStore.getAll('users')) || [];
    const agents = allUsers.filter(u => u.status !== 'inactive');
    const allTags = (await window.AppDataStore.getAll('tags')) || [];

    // Count active advanced filters for badge
    const activeAdvCount = [
        _caseFilters.product !== 'all',
        _caseFilters.agent !== 'all',
        _caseFilters.from !== '',
        _caseFilters.to !== '',
        _caseFilters.tag !== 'all',
        _caseFilters.visibility !== 'all'
    ].filter(Boolean).length;

    // Shared filter bar — simple search + collapsible advanced filters
    const filterBar = `
        <div class="cases-toolbar">
            <div class="cases-search-wrap">
                <i class="fas fa-search cases-search-icon"></i>
                <input type="text" id="case-search" class="cases-search-input"
                    placeholder="Search cases, prospects, customers…"
                    value="${escapeHtml(_caseFilters.search || '')}"
                    onkeyup="app.handleCaseSearch(event)">
                <button class="cases-search-clear" title="Clear search"
                    onclick="document.getElementById('case-search').value=''; app.handleCaseSearch({target:{value:''}})">
                    <i class="fas fa-times"></i>
                </button>
            </div>
            <button id="cases-adv-toggle-btn" class="cases-filter-btn${_caseAdvOpen ? ' active' : ''}"
                onclick="app.toggleCaseAdvFilters()">
                <i class="fas fa-sliders-h"></i> Filters
                ${activeAdvCount > 0 ? `<span class="cases-filter-count">${activeAdvCount}</span>` : ''}
            </button>
        </div>
        <div class="cases-adv-panel" id="cases-adv-panel" style="display:${_caseAdvOpen ? 'block' : 'none'};">
            <div class="cases-adv-grid">
                <div class="adv-field">
                    <label>Product</label>
                    <select id="case-product-filter" onchange="app.handleCaseFilterChange()">
                        <option value="all">All Products</option>
                        ${products.map(p => `<option value="${escapeHtml(p.name || '')}" ${_caseFilters.product === p.name ? 'selected' : ''}>${escapeHtml(p.name || '')}</option>`).join('')}
                    </select>
                </div>
                <div class="adv-field">
                    <label>Agent</label>
                    <select id="case-agent-filter" onchange="app.handleCaseFilterChange()">
                        <option value="all">All Agents</option>
                        ${agents.map(u => `<option value="${u.id}" ${_caseFilters.agent === String(u.id) ? 'selected' : ''}>${escapeHtml(u.full_name || u.username || '')}</option>`).join('')}
                    </select>
                </div>
                <div class="adv-field">
                    <label>Date From</label>
                    <input type="date" id="case-date-from" value="${_caseFilters.from}" onchange="app.handleCaseFilterChange()">
                </div>
                <div class="adv-field">
                    <label>Date To</label>
                    <input type="date" id="case-date-to" value="${_caseFilters.to}" onchange="app.handleCaseFilterChange()">
                </div>
                <div class="adv-field">
                    <label>Tag</label>
                    <select id="case-tag-filter" onchange="app.handleCaseFilterChange()">
                        <option value="all">All Tags</option>
                        ${allTags.map(t => `<option value="${t.id}" ${_caseFilters.tag === String(t.id) ? 'selected' : ''}>${escapeHtml(t.name || '')}</option>`).join('')}
                    </select>
                </div>
                <div class="adv-field">
                    <label>Visibility</label>
                    <select id="case-visibility-filter" onchange="app.handleCaseFilterChange()">
                        <option value="all" ${_caseFilters.visibility === 'all' ? 'selected' : ''}>All</option>
                        <option value="public" ${_caseFilters.visibility === 'public' ? 'selected' : ''}>Public Only</option>
                        <option value="mine" ${_caseFilters.visibility === 'mine' ? 'selected' : ''}>My Cases</option>
                    </select>
                </div>
            </div>
            <div class="cases-adv-footer">
                <button class="btn-link" onclick="app.clearCaseFilters()">
                    <i class="fas fa-times-circle"></i> Clear All Filters
                </button>
            </div>
        </div>`;

    container.innerHTML = `
        <div class="cases-view">
            <div class="prospects-header">
                <div>
                    <h1>Success Case Library</h1>
                    <p>Document and share success stories, sales ideas, and closing strategies.</p>
                </div>
                <button class="btn primary" onclick="(async () => { await app.openCaseStudyModal(); })()">
                    <i class="fas fa-plus"></i> New Case
                </button>
            </div>

            ${filterBar}

            <!-- CPS Invitation Cases Section -->
            <div class="cases-section-hdr">
                <div class="section-icon"><i class="fas fa-handshake"></i></div>
                <h2>CPS Invitation Cases</h2>
                <span class="cases-section-desc">Prospects invited via CPS method</span>
                <span class="cases-count-pill" id="cases-count-cps">0</span>
            </div>
            <div class="case-card-grid" id="cases-list-cps"></div>
            <div id="cases-empty-state-cps" class="cases-empty-state" style="display:none;">
                <div class="cases-empty-illus"><i class="fas fa-handshake"></i></div>
                <h3>No CPS invitation cases yet</h3>
                <p>Invite a prospect through CPS and they'll show up here as a case.</p>
            </div>

            <!-- Closed Cases Section -->
            <div class="cases-section-hdr" style="margin-top:40px;">
                <div class="section-icon"><i class="fas fa-trophy"></i></div>
                <h2>Closed Cases</h2>
                <span class="cases-section-desc">Successfully closed deals &amp; stories</span>
                <span class="cases-count-pill" id="cases-count-closed">0</span>
            </div>
            <div class="case-card-grid" id="cases-list-closed"></div>
            <div id="cases-empty-state-closed" class="cases-empty-state" style="display:none;">
                <div class="cases-empty-illus"><i class="fas fa-trophy"></i></div>
                <h3>No closed cases yet</h3>
                <p>Document your first success story — include photos, the sales idea, and what worked.</p>
                <button class="btn primary" onclick="(async () => { await app.openCaseStudyModal(null, 'closed'); })()">
                    <i class="fas fa-plus"></i> Add Closed Case
                </button>
            </div>
        </div>
    `;

    await window._fv.renderCasesList();
};

window._fv.switchCaseTab = async (type) => {
    window._appState.caseActiveTab = type;
    if (!window._appState.caseFilters) window._appState.caseFilters = { search: '', product: 'all', from: '', to: '', visibility: 'all', agent: 'all', tag: 'all' };
    window._appState.caseFilters.agent = 'all';
    window._appState.caseFilters.tag = 'all';
    window._appState.caseFilters.search = '';
    await window._fv.showCasesView(document.getElementById('content-viewport'));
};

window._fv.handleCaseSearch = (e) => {
    const val = e.target.value;
    if (!window._appState.caseFilters) window._appState.caseFilters = { search: '', product: 'all', from: '', to: '', visibility: 'all', agent: 'all', tag: 'all' };
    app.debounceCall('case-search', () => {
        window._appState.caseFilters.search = val;
        window._fv.renderCasesList();
    }, 220);
};

window._fv.handleCaseFilterChange = async () => {
    if (!window._appState.caseFilters) window._appState.caseFilters = { search: '', product: 'all', from: '', to: '', visibility: 'all', agent: 'all', tag: 'all' };
    window._appState.caseFilters.product = document.getElementById('case-product-filter')?.value || 'all';
    window._appState.caseFilters.from = document.getElementById('case-date-from')?.value || '';
    window._appState.caseFilters.to = document.getElementById('case-date-to')?.value || '';
    window._appState.caseFilters.visibility = document.getElementById('case-visibility-filter')?.value || 'all';
    window._appState.caseFilters.agent = document.getElementById('case-agent-filter')?.value || 'all';
    window._appState.caseFilters.tag = document.getElementById('case-tag-filter')?.value || 'all';
    await window._fv.renderCasesList();
};

window._fv.toggleCaseAdvFilters = () => {
    window._appState.caseAdvOpen = !window._appState.caseAdvOpen;
    const panel = document.getElementById('cases-adv-panel');
    const btn = document.getElementById('cases-adv-toggle-btn');
    if (panel) panel.style.display = window._appState.caseAdvOpen ? 'block' : 'none';
    if (btn) btn.classList.toggle('active', window._appState.caseAdvOpen);
};

window._fv.clearCaseFilters = async () => {
    window._appState.caseFilters = { search: '', product: 'all', from: '', to: '', visibility: 'all', agent: 'all', tag: 'all' };
    await window._fv.showCasesView(document.getElementById('content-viewport'));
};

window._fv.renderCasesList = async () => {
    const _currentUser = window._appState?.cu;
    const { escapeHtml, isSystemAdmin, isMarketingManager } = window._crmUtils || {};
    const _caseFilters = window._appState.caseFilters || { search: '', product: 'all', from: '', to: '', visibility: 'all', agent: 'all', tag: 'all' };

    const gridCps = document.getElementById('cases-list-cps');
    const gridClosed = document.getElementById('cases-list-closed');
    const emptyCps = document.getElementById('cases-empty-state-cps');
    const emptyClosed = document.getElementById('cases-empty-state-closed');
    const countCps = document.getElementById('cases-count-cps');
    const countClosed = document.getElementById('cases-count-closed');
    if (!gridCps || !gridClosed) return;

    const [allCases, allUsers, allTags, allTagMappings, allProspects, allCustomers] = await Promise.all([
        window.AppDataStore.getAll('case_studies'),
        window.AppDataStore.getAll('users'),
        window.AppDataStore.getAll('tags'),
        window.AppDataStore.getAll('entity_tags'),
        window.AppDataStore.getAll('prospects'),
        window.AppDataStore.getAll('customers'),
    ]).then(r => r.map(x => x || []));
    const prospectMap = new Map(allProspects.map(p => [String(p.id), p]));
    const customerMap = new Map(allCustomers.map(c => [String(c.id), c]));

    const applySharedFilters = (cases) => {
        cases = cases.filter(c => {
            const isOwner = c.created_by === _currentUser?.id;
            const isAdmin = isSystemAdmin(_currentUser) || isMarketingManager(_currentUser) || /manager|team_leader/i.test(_currentUser?.role || '');
            if (_caseFilters.visibility === 'public') return c.is_public;
            if (_caseFilters.visibility === 'mine') return isOwner;
            return c.is_public || isOwner || isAdmin;
        });
        if (_caseFilters.agent !== 'all') {
            cases = cases.filter(c => String(c.created_by) === String(_caseFilters.agent));
        }
        if (_caseFilters.tag !== 'all') {
            const caseIdsWithTag = allTagMappings
                .filter(et => et.entity_type === 'case_study' && String(et.tag_id) === String(_caseFilters.tag))
                .map(et => et.entity_id);
            cases = cases.filter(c => caseIdsWithTag.includes(c.id));
        }
        if (_caseFilters.search) {
            const q = _caseFilters.search.toLowerCase();
            cases = cases.filter(c => {
                if ((c.title || '').toLowerCase().includes(q)) return true;
                if (c.prospect_id) {
                    const p = prospectMap.get(String(c.prospect_id));
                    if (p?.full_name?.toLowerCase().includes(q)) return true;
                }
                if (c.customer_id) {
                    const cust = customerMap.get(String(c.customer_id));
                    if (cust?.full_name?.toLowerCase().includes(q)) return true;
                }
                return false;
            });
        }
        if (_caseFilters.product !== 'all') cases = cases.filter(c => c.product === _caseFilters.product);
        if (_caseFilters.from) cases = cases.filter(c => c.closing_date >= _caseFilters.from);
        if (_caseFilters.to) cases = cases.filter(c => c.closing_date <= _caseFilters.to);
        return cases;
    };

    const genderEmoji = (g) => {
        if (!g) return '';
        const low = String(g).toLowerCase();
        if (low.startsWith('m')) return '♂';
        if (low.startsWith('f')) return '♀';
        return '';
    };

    const productGradient = (product) => {
        const palettes = [
            'linear-gradient(135deg,#7a0018 0%,#c12b3c 100%)',
            'linear-gradient(135deg,#0f766e 0%,#14b8a6 100%)',
            'linear-gradient(135deg,#1e3a8a 0%,#3b82f6 100%)',
            'linear-gradient(135deg,#92400e 0%,#f59e0b 100%)',
            'linear-gradient(135deg,#6b21a8 0%,#a855f7 100%)',
            'linear-gradient(135deg,#065f46 0%,#10b981 100%)',
        ];
        const key = String(product || 'case');
        let hash = 0;
        for (let i = 0; i < key.length; i++) hash = (hash * 31 + key.charCodeAt(i)) >>> 0;
        return palettes[hash % palettes.length];
    };

    const buildCard = (c, type) => {
        let entityName = '';
        let entityHref = '';
        let entityIcon = '';
        let prospectData = null;
        if (c.customer_id) {
            const cust = customerMap.get(String(c.customer_id));
            if (cust) { entityName = cust.full_name; entityHref = `app.showCustomerDetail(${c.customer_id})`; entityIcon = 'fa-user-check'; }
        } else if (c.prospect_id) {
            const pros = prospectMap.get(String(c.prospect_id));
            if (pros) { prospectData = pros; entityName = pros.full_name; entityHref = `app.showProspectDetail(${c.prospect_id})`; entityIcon = 'fa-user'; }
        }

        const isOwner = c.created_by === _currentUser?.id;
        const isAdmin = isSystemAdmin(_currentUser) || isMarketingManager(_currentUser) || /manager|team_leader/i.test(_currentUser?.role || '');
        const canEdit = isOwner || isAdmin;

        const creator = allUsers.find(u => u.id === c.created_by);
        const creatorName = creator ? (creator.full_name || creator.username || 'Agent') : 'System';
        const creatorInitial = (creatorName[0] || '?').toUpperCase();

        const caseMappings = allTagMappings.filter(et => et.entity_type === 'case_study' && et.entity_id === c.id);
        const caseTags = caseMappings.map(m => allTags.find(t => t.id === m.tag_id)).filter(Boolean);
        const tagBadges = caseTags.slice(0, 3).map(t =>
            `<span class="case-tag-pill" style="background:${escapeHtml(t.color || '#e5e7eb')}22;color:${escapeHtml(t.color || '#374151')};border:1px solid ${escapeHtml(t.color || '#e5e7eb')}55;">${escapeHtml(t.name)}</span>`
        ).join('');
        const extraTagCount = caseTags.length > 3 ? `<span class="case-tag-pill case-tag-more">+${caseTags.length - 3}</span>` : '';

        const photos = Array.isArray(c.photo_urls) ? c.photo_urls : [];
        const coverPhoto = photos[0] || null;
        const extraPhotoCount = photos.length > 1 ? photos.length - 1 : 0;

        const ageText = prospectData?.date_of_birth
            ? Math.floor((Date.now() - new Date(prospectData.date_of_birth)) / (365.25 * 24 * 60 * 60 * 1000)) + 'y'
            : '';

        const actions = `
            <div class="case-card-actions" onclick="event.stopPropagation();">
                <button class="btn-icon" title="View" onclick="app.showCaseStudyDetail(${c.id})"><i class="fas fa-eye"></i></button>
                ${canEdit ? `
                    <button class="btn-icon" title="Edit" onclick="app.openCaseStudyModal(${c.id})"><i class="fas fa-pen"></i></button>
                    <button class="btn-icon text-danger" title="Delete" onclick="app.deleteCaseStudy(${c.id})"><i class="fas fa-trash"></i></button>
                ` : ''}
            </div>`;

        if (type === 'cps') {
            const title = (() => {
                if (entityName) return escapeHtml(entityName);
                if (c.title) return escapeHtml(c.title);
                return 'CPS Case';
            })();
            const subtitle = prospectData?.occupation ? escapeHtml(prospectData.occupation) : (prospectData?.referral_relationship ? 'Referred via ' + escapeHtml(prospectData.referral_relationship) : '');
            const detailsPreview = c.cps_invitation_details
                ? (c.cps_invitation_details.length > 140 ? c.cps_invitation_details.substring(0, 140) + '…' : c.cps_invitation_details)
                : 'No invitation details recorded yet.';
            const metaPills = [
                prospectData?.gender ? `<span class="case-meta-pill"><i class="fas fa-venus-mars"></i> ${escapeHtml(prospectData.gender)} ${genderEmoji(prospectData.gender)}</span>` : '',
                ageText ? `<span class="case-meta-pill"><i class="fas fa-birthday-cake"></i> ${ageText}</span>` : '',
                c.cps_invitation_method ? `<span class="case-meta-pill"><i class="fas fa-paper-plane"></i> ${escapeHtml(c.cps_invitation_method)}</span>` : '',
                prospectData?.referral_relationship ? `<span class="case-meta-pill"><i class="fas fa-people-arrows"></i> ${escapeHtml(prospectData.referral_relationship)}</span>` : '',
            ].filter(Boolean).join('');

            return `
            <div class="case-card" onclick="app.showCaseStudyDetail(${c.id})">
                <div class="case-card-cover" ${coverPhoto ? `data-attach-bg="${escapeHtml(coverPhoto)}"` : ''} style="${coverPhoto ? '' : `background:${productGradient(entityName || 'cps')};`}">
                    ${!coverPhoto ? `<div class="case-card-cover-icon"><i class="fas fa-handshake"></i></div>` : ''}
                    <div class="case-card-cover-badges">
                        <span class="case-type-chip cps">CPS</span>
                        ${c.is_public ? '<span class="case-type-chip public"><i class="fas fa-globe"></i> Public</span>' : ''}
                    </div>
                    ${extraPhotoCount > 0 ? `<div class="case-card-photo-count"><i class="fas fa-images"></i> ${extraPhotoCount + 1}</div>` : ''}
                </div>
                <div class="case-card-body">
                    <h3 class="case-card-title">${title}</h3>
                    ${subtitle ? `<p class="case-card-subtitle">${subtitle}</p>` : ''}
                    <div class="case-card-meta">${metaPills}</div>
                    <p class="case-card-desc">${escapeHtml(detailsPreview)}</p>
                    <div class="case-card-footer">
                        <div class="case-card-agent" title="${escapeHtml(creatorName)}">
                            <span class="case-avatar">${escapeHtml(creatorInitial)}</span>
                            <span class="case-agent-name">${escapeHtml(creatorName)}</span>
                        </div>
                        <div class="case-card-tags">${tagBadges}${extraTagCount}</div>
                    </div>
                </div>
                ${actions}
            </div>`;
        }

        // Closed card
        const amountStr = c.amount ? 'RM ' + parseFloat(c.amount).toLocaleString() : '';
        const closedDate = c.closing_date ? new Date(c.closing_date).toLocaleDateString('en-MY', { year:'numeric', month:'short', day:'numeric' }) : '';
        const storyPreview = (c.success_story || c.sales_idea || c.closing_details || '').trim();
        const storyText = storyPreview
            ? (storyPreview.length > 160 ? storyPreview.substring(0, 160) + '…' : storyPreview)
            : 'Tap to read the full closing strategy and sales idea.';

        return `
            <div class="case-card closed" onclick="app.showCaseStudyDetail(${c.id})">
                <div class="case-card-cover" ${coverPhoto ? `data-attach-bg="${escapeHtml(coverPhoto)}"` : ''} style="${coverPhoto ? '' : `background:${productGradient(c.product)};`}">
                    ${!coverPhoto ? `<div class="case-card-cover-icon"><i class="fas fa-trophy"></i></div>` : ''}
                    <div class="case-card-cover-badges">
                        <span class="case-type-chip closed">Closed</span>
                        ${c.is_public ? '<span class="case-type-chip public"><i class="fas fa-globe"></i> Public</span>' : ''}
                    </div>
                    ${amountStr ? `<div class="case-card-amount">${escapeHtml(amountStr)}</div>` : ''}
                    ${extraPhotoCount > 0 ? `<div class="case-card-photo-count"><i class="fas fa-images"></i> ${extraPhotoCount + 1}</div>` : ''}
                </div>
                <div class="case-card-body">
                    <h3 class="case-card-title">${escapeHtml(c.title || 'Untitled Case')}</h3>
                    <div class="case-card-meta">
                        ${entityName ? `<span class="case-meta-pill"><i class="fas ${entityIcon}"></i> ${escapeHtml(entityName)}</span>` : ''}
                        ${c.product ? `<span class="case-meta-pill"><i class="fas fa-box"></i> ${escapeHtml(c.product)}</span>` : ''}
                        ${closedDate ? `<span class="case-meta-pill"><i class="fas fa-calendar-check"></i> ${escapeHtml(closedDate)}</span>` : ''}
                    </div>
                    <p class="case-card-desc">${escapeHtml(storyText)}</p>
                    <div class="case-card-footer">
                        <div class="case-card-agent" title="${escapeHtml(creatorName)}">
                            <span class="case-avatar">${escapeHtml(creatorInitial)}</span>
                            <span class="case-agent-name">${escapeHtml(creatorName)}</span>
                        </div>
                        <div class="case-card-tags">${tagBadges}${extraTagCount}</div>
                    </div>
                </div>
                ${actions}
            </div>`;
    };

    // CPS cases
    let cpsCases = allCases.filter(c => (c.case_type || 'cps') === 'cps');
    cpsCases = applySharedFilters(cpsCases);
    cpsCases.sort((a, b) => new Date(b.updated_at || b.created_at || 0) - new Date(a.updated_at || a.created_at || 0));
    if (countCps) countCps.textContent = cpsCases.length;
    if (cpsCases.length === 0) {
        gridCps.innerHTML = '';
        gridCps.style.display = 'none';
        emptyCps.style.display = 'flex';
    } else {
        gridCps.style.display = '';
        emptyCps.style.display = 'none';
        gridCps.innerHTML = cpsCases.map(c => buildCard(c, 'cps')).join('');
    }

    // Closed cases
    let closedCases = allCases.filter(c => (c.case_type || 'cps') === 'closed');
    closedCases = applySharedFilters(closedCases);
    closedCases.sort((a, b) => new Date(b.closing_date || b.updated_at || 0) - new Date(a.closing_date || a.updated_at || 0));
    if (countClosed) countClosed.textContent = closedCases.length;
    if (closedCases.length === 0) {
        gridClosed.innerHTML = '';
        gridClosed.style.display = 'none';
        emptyClosed.style.display = 'flex';
    } else {
        gridClosed.style.display = '';
        emptyClosed.style.display = 'none';
        gridClosed.innerHTML = closedCases.map(c => buildCard(c, 'closed')).join('');
    }
};

window._fv.showCaseStudyDetail = async (id) => {
    const _currentUser = window._appState?.cu;
    const { escapeHtml, isSystemAdmin, isMarketingManager } = window._crmUtils || {};

    const c = await window.AppDataStore.getById('case_studies', id);
    if (!c) return;

    const isOwner = c.created_by === _currentUser?.id;
    const isAdmin = isSystemAdmin(_currentUser) || isMarketingManager(_currentUser) || /manager|team_leader/i.test(_currentUser?.role || '');

    const isCpsCase = (c.case_type || 'cps') === 'cps';
    let entityInfo = '';
    let prospectProfile = null;
    if (c.customer_id) {
        const cust = await window.AppDataStore.getById('customers', c.customer_id);
        if (!isCpsCase) entityInfo = cust ? `Customer: ${escapeHtml(cust.full_name || '')}` : 'Unknown Customer';
    } else if (c.prospect_id) {
        const pros = await window.AppDataStore.getById('prospects', c.prospect_id);
        prospectProfile = pros || null;
        if (!isCpsCase) entityInfo = pros ? `Prospect: ${escapeHtml(pros.full_name || '')}` : 'Unknown Prospect';
    }

    const creator = await window.AppDataStore.getById('users', c.created_by);
    const creatorName = creator ? (creator.full_name || creator.username) : 'System';

    const allTagMappings = (await window.AppDataStore.getAll('entity_tags')) || [];
    const allTags = (await window.AppDataStore.getAll('tags')) || [];
    const caseMappings = allTagMappings.filter(et => et.entity_type === 'case_study' && et.entity_id === c.id);
    const caseTags = caseMappings.map(m => allTags.find(t => t.id === m.tag_id)).filter(Boolean);
    const tagPills = caseTags.map(t => `
        <span class="badge" style="background:${t.color || '#e5e7eb'};color:#1f2937;margin-right:4px;">
            ${escapeHtml(t.name || '')}
            <span style="cursor:pointer;margin-left:4px;" onclick="app.removeTagFromCase(${c.id}, ${t.id})">&times;</span>
        </span>`).join('');

    const typeLabel = (c.case_type || 'cps') === 'cps' ? 'CPS Invitation Case' : 'Closed Case';

    const photos = Array.isArray(c.photo_urls) ? c.photo_urls : [];
    const photoGalleryHtml = photos.length ? `
        <div class="case-detail-gallery">
            <div class="case-detail-gallery-main">
                <img loading="lazy" decoding="async" data-attach-src="${escapeHtml(photos[0])}" alt="Cover" onclick="window._openAttachment('${escapeHtml(photos[0])}')">
            </div>
            ${photos.length > 1 ? `
                <div class="case-detail-gallery-thumbs">
                    ${photos.slice(1).map(p => `<img loading="lazy" decoding="async" data-attach-src="${escapeHtml(p)}" alt="Photo" onclick="window._openAttachment('${escapeHtml(p)}')">`).join('')}
                </div>
            ` : ''}
        </div>
    ` : '';

    const contentHtml = `
        <div style="padding:0 4px;">
            ${photoGalleryHtml}
            <div style="display:flex;flex-wrap:wrap;gap:12px;margin-bottom:16px;color:var(--gray-500);font-size:13px;">
                <span><i class="fas fa-tag"></i> ${typeLabel}</span>
                ${isCpsCase ? (() => {
                    const age = prospectProfile?.date_of_birth
                        ? Math.floor((Date.now() - new Date(prospectProfile.date_of_birth)) / (365.25 * 24 * 60 * 60 * 1000)) + 'y'
                        : null;
                    return [
                        prospectProfile?.referral_relationship ? `<span><i class="fas fa-people-arrows"></i> ${escapeHtml(prospectProfile.referral_relationship)}</span>` : '',
                        prospectProfile?.occupation ? `<span><i class="fas fa-briefcase"></i> ${escapeHtml(prospectProfile.occupation)}</span>` : '',
                        age ? `<span><i class="fas fa-birthday-cake"></i> ${age}</span>` : '',
                        prospectProfile?.gender ? `<span><i class="fas fa-venus-mars"></i> ${escapeHtml(prospectProfile.gender)}</span>` : '',
                    ].filter(Boolean).join('');
                })() : `<span><i class="fas fa-user-circle"></i> ${entityInfo}</span>
                <span><i class="fas fa-calendar-alt"></i> Closed: ${c.closing_date || 'N/A'}</span>
                <span><i class="fas fa-box"></i> ${escapeHtml(c.product || 'N/A')}</span>
                <span><i class="fas fa-money-bill-wave"></i> RM ${parseFloat(c.amount || 0).toLocaleString()}</span>`}
                ${c.is_public ? '<span class="badge badge-success">Public</span>' : ''}
            </div>

            <div style="margin-bottom:16px;">
                <strong style="font-size:12px;color:var(--gray-500);text-transform:uppercase;letter-spacing:.05em;">Tags</strong>
                <div style="margin-top:6px;">
                    ${tagPills || '<em style="color:var(--gray-400);font-size:13px;">No tags</em>'}
                    <button class="btn secondary btn-sm" style="margin-left:8px;" onclick="app.addTagToCase(${c.id})"><i class="fas fa-tag"></i> Add Tag</button>
                </div>
            </div>

            <div class="case-section card" style="margin-bottom:12px;">
                <h3 style="font-size:14px;font-weight:600;margin-bottom:8px;"><i class="fas fa-handshake"></i> Part 1: CPS Invitation</h3>
                ${c.cps_invitation_method ? `<p style="font-size:12px;color:var(--gray-500);margin-bottom:6px;"><strong>Method:</strong> ${escapeHtml(c.cps_invitation_method)}</p>` : ''}
                <p style="white-space:pre-wrap;">${c.cps_invitation_details ? escapeHtml(c.cps_invitation_details) : '<em style="color:var(--gray-400);">No details provided.</em>'}</p>
            </div>

            <div class="case-section card" style="margin-bottom:12px;">
                <h3 style="font-size:14px;font-weight:600;margin-bottom:12px;"><i class="fas fa-check-double"></i> Part 2: Closing & Strategy</h3>
                <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">
                    <div>
                        <h4 style="font-size:12px;font-weight:600;color:var(--gray-500);text-transform:uppercase;margin-bottom:4px;">Closing Details</h4>
                        <p style="white-space:pre-wrap;">${c.closing_details ? escapeHtml(c.closing_details) : '-'}</p>
                    </div>
                    <div>
                        <h4 style="font-size:12px;font-weight:600;color:var(--gray-500);text-transform:uppercase;margin-bottom:4px;">The Sales Idea</h4>
                        <p style="white-space:pre-wrap;">${c.sales_idea ? escapeHtml(c.sales_idea) : '-'}</p>
                    </div>
                    <div>
                        <h4 style="font-size:12px;font-weight:600;color:var(--gray-500);text-transform:uppercase;margin-bottom:4px;">Execution Plan</h4>
                        <p style="white-space:pre-wrap;">${c.plan_details ? escapeHtml(c.plan_details) : '-'}</p>
                    </div>
                    <div>
                        <h4 style="font-size:12px;font-weight:600;color:var(--gray-500);text-transform:uppercase;margin-bottom:4px;">Success Story & Lessons</h4>
                        <p style="white-space:pre-wrap;">${c.success_story ? escapeHtml(c.success_story) : '-'}</p>
                    </div>
                </div>
            </div>

            ${(c.key_success_factor || c.script) ? `
            <div class="case-section card" style="margin-bottom:12px;">
                <h3 style="font-size:14px;font-weight:600;margin-bottom:12px;"><i class="fas fa-star"></i> Part 3: Key Factors & Script</h3>
                ${c.key_success_factor ? `
                <div style="margin-bottom:12px;">
                    <h4 style="font-size:12px;font-weight:600;color:var(--gray-500);text-transform:uppercase;margin-bottom:4px;">Key Success Factor</h4>
                    <p style="white-space:pre-wrap;">${escapeHtml(c.key_success_factor)}</p>
                </div>` : ''}
                ${c.script ? `
                <div>
                    <h4 style="font-size:12px;font-weight:600;color:var(--gray-500);text-transform:uppercase;margin-bottom:4px;">Sales Script</h4>
                    <div style="background:var(--gray-50);border:1px solid var(--gray-200);border-radius:6px;padding:12px;">
                        <p style="white-space:pre-wrap;font-family:monospace;font-size:13px;">${escapeHtml(c.script)}</p>
                    </div>
                </div>` : ''}
            </div>` : ''}

            <div style="font-size:12px;color:var(--gray-400);margin-top:8px;">
                <span>Created by <strong>${escapeHtml(creatorName)}</strong> on ${new Date(c.created_at).toLocaleDateString()}</span>
                ${c.updated_at ? ` &middot; Updated ${new Date(c.updated_at).toLocaleString()}` : ''}
            </div>
        </div>
    `;

    const footerButtons = [
        { label: 'Close', type: 'secondary', action: 'UI.hideModal()' },
        { label: 'Copy Link', type: 'secondary', action: `app.copyCaseLink(${c.id})` },
        ...(isOwner || isAdmin ? [
            { label: c.is_public ? 'Make Private' : 'Share Publicly', type: 'secondary', action: `(async () => { await app.toggleCasePublic(${c.id}); })()` },
            { label: 'Edit', type: 'secondary', action: `UI.hideModal(); app.openCaseStudyModal(${c.id})` },
            { label: 'Delete', type: 'danger', action: `(async () => { await app.deleteCaseStudy(${c.id}); UI.hideModal(); })()` }
        ] : [])
    ];

    window.UI.showModal(c.title, contentHtml, footerButtons);
};

window._fv.toggleCasePublic = async (id) => {
    const c = await window.AppDataStore.getById('case_studies', id);
    if (!c) return;
    await window.AppDataStore.update('case_studies', id, { is_public: !c.is_public });
    window.UI.toast.success(`Case study is now ${!c.is_public ? 'public' : 'private'}.`);
    await window._fv.showCaseStudyDetail(id);
};

window._fv.copyCaseLink = (id) => {
    const link = `${window.location.origin}${window.location.pathname}?view=cases&id=${id}`;
    navigator.clipboard.writeText(link).then(() => {
        window.UI.toast.info("Link copied to clipboard.");
    });
};

window._fv.deleteCaseStudy = async (id) => {
    if (confirm("Are you sure you want to delete this case? This action cannot be undone.")) {
        try {
            const c = await window.AppDataStore.getById('case_studies', id).catch(() => null);
            const photoUrls = c && Array.isArray(c.photo_urls) ? c.photo_urls : [];

            const tags = await window.AppDataStore.getAll('entity_tags').catch(() => []);
            for (const t of tags.filter(t => t.entity_type === 'case_study' && String(t.entity_id) === String(id)))
                await window.AppDataStore.delete('entity_tags', t.id);
            await window.AppDataStore.delete('case_studies', id);

            if (photoUrls.length && window.AppDataStore.deleteAttachmentByPath && window.AppDataStore.extractAttachmentPath) {
                for (const url of photoUrls) {
                    const path = window.AppDataStore.extractAttachmentPath(url);
                    if (path) await window.AppDataStore.deleteAttachmentByPath(path);
                }
            }

            window.UI.toast.success("Case deleted.");
            await window._fv.renderCasesList();
        } catch (err) {
            window.UI.toast.error('Delete failed: ' + (err.message || 'Unknown error'));
        }
    }
};

window._fv.addTagToCase = (caseId) => {
    app.openAddTagModal(caseId, 'case_study');
};

window._fv.removeTagFromCase = async (caseId, tagId) => {
    const mappings = await window.AppDataStore.query('entity_tags', { entity_type: 'case_study', entity_id: caseId, tag_id: tagId });
    if (mappings?.length) {
        await window.AppDataStore.delete('entity_tags', mappings[0].id);
        window.UI.toast.success('Tag removed');
        await window._fv.showCaseStudyDetail(caseId);
    }
};

window._fv.openCaseStudyModal = async (id = null, defaultType = null) => {
    const _currentUser = window._appState?.cu;
    const { escapeHtml } = window._crmUtils || {};
    const _caseActiveTab = window._appState.caseActiveTab || 'cps';

    const c = id ? await window.AppDataStore.getById('case_studies', id) : null;
    const title = id ? 'Edit Case' : 'New Case';
    const caseType = c ? (c.case_type || 'cps') : (defaultType || _caseActiveTab || 'cps');

    window._appState.casePendingPhotos = c && Array.isArray(c.photo_urls) ? [...c.photo_urls] : [];

    let entityName = '';
    if (c) {
        if (c.customer_id) {
            const cust = await window.AppDataStore.getById('customers', c.customer_id);
            entityName = cust ? cust.full_name : '';
        } else if (c.prospect_id) {
            const pros = await window.AppDataStore.getById('prospects', c.prospect_id);
            entityName = pros ? pros.full_name : '';
        }
    }

    const modalHtml = `
        <div class="case-study-form">
            <input type="hidden" id="case-type" value="${caseType}">
            <div class="modal-tabs">
                <button class="tab-btn active" onclick="app.switchModalTab(event, 'basic')">Basic Info</button>
                <button class="tab-btn" onclick="app.switchModalTab(event, 'cps')">CPS Invitation</button>
                <button class="tab-btn" onclick="app.switchModalTab(event, 'closing')">Closing & Success</button>
            </div>

            <div id="case-tab-basic" class="modal-tab-content active">
                <div class="form-group">
                    <label>Title <span class="required">*</span></label>
                    <input type="text" id="case-title" class="form-control" value="${c ? escapeHtml(c.title) : ''}" placeholder="e.g. How I closed PR4 with career focus">
                </div>

                <div class="form-row">
                    <div class="form-group half">
                        <label>Link Prospect/Customer</label>
                        <div class="search-select-container">
                            <input type="text" id="case-entity-search" class="form-control" placeholder="Type name..." value="${escapeHtml(entityName)}" onkeyup="app.debounceCall('case-entity-search', () => app.searchCaseEntities(this.value), 220)">
                            <div id="case-entity-results" class="search-results-dropdown"></div>
                            <input type="hidden" id="case-prospect-id" value="${c ? (c.prospect_id || '') : ''}">
                            <input type="hidden" id="case-customer-id" value="${c ? (c.customer_id || '') : ''}">
                        </div>
                    </div>
                    <div class="form-group half">
                        <label>Product</label>
                        <select id="case-product" class="form-control">
                            <option value="">Select Product...</option>
                            ${((await window.AppDataStore.getAll('products')) || []).map(p => `<option value="${escapeHtml(p.name || '')}" ${c && c.product === p.name ? 'selected' : ''}>${escapeHtml(p.name || '')}</option>`).join('')}
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
                    <label><i class="fas fa-camera"></i> Photos</label>
                    <p class="help-text">Add event photos, testimonials, or product shots — the first photo becomes the cover.</p>
                    <div class="case-photo-uploader">
                        <div id="case-photo-gallery" class="case-photo-gallery"></div>
                        <label class="case-photo-add" for="case-photo-input">
                            <i class="fas fa-plus"></i>
                            <span>Add Photo</span>
                            <input type="file" id="case-photo-input" accept="image/*" multiple hidden onchange="app.uploadCasePhotos(event)">
                        </label>
                    </div>
                </div>
            </div>

            <div id="case-tab-cps" class="modal-tab-content">
                <div class="form-group">
                    <label>CPS Invitation Details</label>
                    <p class="help-text">Who invited? Call/Event/Referral? Special circumstances?</p>
                    <textarea id="case-cps-details" class="form-control" rows="8">${c ? escapeHtml(c.cps_invitation_details || '') : ''}</textarea>
                </div>
            </div>

            <div id="case-tab-closing" class="modal-tab-content">
                <div class="form-group">
                    <label>Closing Details</label>
                    <textarea id="case-closing-details" class="form-control" rows="3" placeholder="Key discussions, objections overcome...">${c ? escapeHtml(c.closing_details || '') : ''}</textarea>
                </div>
                <div class="form-group">
                    <label>The Sales Idea</label>
                    <textarea id="case-sales-idea" class="form-control" rows="3" placeholder="The core logic that worked...">${c ? escapeHtml(c.sales_idea || '') : ''}</textarea>
                </div>
                <div class="form-group">
                    <label>Plan Details</label>
                    <textarea id="case-plan-details" class="form-control" rows="3" placeholder="Follow-up sequence, bundling...">${c ? escapeHtml(c.plan_details || '') : ''}</textarea>
                </div>
                <div class="form-group">
                    <label>Overall Success Story</label>
                    <textarea id="case-success-story" class="form-control" rows="3" placeholder="Testimonial, lessons learned...">${c ? escapeHtml(c.success_story || '') : ''}</textarea>
                </div>
                <div class="form-group">
                    <label>Key Success Factor</label>
                    <textarea id="case-key-success-factor" class="form-control" rows="3" placeholder="The single most important factor that made this case succeed...">${c ? escapeHtml(c.key_success_factor || '') : ''}</textarea>
                </div>
                <div class="form-group">
                    <label>Sales Script</label>
                    <textarea id="case-script" class="form-control" rows="4" placeholder="The exact words, pitch, or script that worked...">${c ? escapeHtml(c.script || '') : ''}</textarea>
                </div>
            </div>
        </div>
    `;

    window.UI.showModal(title, modalHtml, [
        { label: 'Cancel', type: 'secondary', action: 'UI.hideModal()' },
        { label: id ? 'Update Case' : 'Save Case', type: 'primary', action: `(async () => { await app.saveCaseStudy(${id || 'null'}); })()` }
    ]);

    window._fv.renderCasePhotoGallery();
};

window._fv.renderCasePhotoGallery = () => {
    const { escapeHtml } = window._crmUtils || {};
    const _casePendingPhotos = window._appState.casePendingPhotos || [];

    const gal = document.getElementById('case-photo-gallery');
    if (!gal) return;
    if (!_casePendingPhotos.length) {
        gal.innerHTML = '<div class="case-photo-empty"><i class="fas fa-images"></i> No photos yet — add up to 12 to tell the story visually.</div>';
        return;
    }
    gal.innerHTML = _casePendingPhotos.map((url, i) => `
        <div class="case-photo-thumb" draggable="false">
            <img loading="lazy" decoding="async" data-attach-src="${escapeHtml(url)}" alt="Case photo ${i + 1}" onclick="window._openAttachment('${escapeHtml(url)}')">
            ${i === 0 ? '<span class="case-photo-badge">Cover</span>' : ''}
            <button class="case-photo-remove" title="Remove" onclick="event.stopPropagation(); app.removeCasePhoto(${i})"><i class="fas fa-times"></i></button>
        </div>
    `).join('');
};

window._fv.uploadCasePhotos = async (event) => {
    const _currentUser = window._appState?.cu;
    if (!window._appState.casePendingPhotos) window._appState.casePendingPhotos = [];

    const files = Array.from(event.target?.files || []);
    if (!files.length) return;
    const sb = window.supabase || window.supabaseClient;
    if (!sb || !sb.storage) { window.UI.toast.error('Supabase not connected — cannot upload photo'); return; }

    const addBtn = document.querySelector('.case-photo-add');
    const originalHtml = addBtn ? addBtn.innerHTML : '';
    if (addBtn) addBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i><span>Uploading…</span>';

    let uploaded = 0, failed = 0;
    for (const file of files) {
        if (!/^image\//.test(file.type)) { failed++; continue; }
        if (file.size > 8 * 1024 * 1024) {
            window.UI.toast.error(`"${file.name}" is larger than 8MB — skipped`);
            failed++;
            continue;
        }
        try {
            const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
            const path = `case_photos/${_currentUser?.id || 'anon'}_${Date.now()}_${Math.random().toString(36).slice(2,8)}_${safeName}`;
            const { error: upErr } = await sb.storage.from('attachments').upload(path, file, { upsert: false, contentType: file.type });
            if (upErr) throw upErr;
            const { data: urlData } = sb.storage.from('attachments').getPublicUrl(path);
            if (!urlData?.publicUrl) throw new Error('Could not resolve public URL');
            window._appState.casePendingPhotos.push(urlData.publicUrl);
            uploaded++;
        } catch (err) {
            console.error('Case photo upload failed:', err);
            failed++;
        }
    }

    if (addBtn) addBtn.innerHTML = originalHtml;
    const input = document.getElementById('case-photo-input');
    if (input) input.value = '';

    if (uploaded) window.UI.toast.success(`${uploaded} photo${uploaded > 1 ? 's' : ''} uploaded`);
    if (failed) window.UI.toast.error(`${failed} upload${failed > 1 ? 's' : ''} failed`);
    window._fv.renderCasePhotoGallery();
};

window._fv.removeCasePhoto = (index) => {
    if (!window._appState.casePendingPhotos) return;
    if (index < 0 || index >= window._appState.casePendingPhotos.length) return;
    window._appState.casePendingPhotos.splice(index, 1);
    window._fv.renderCasePhotoGallery();
};

window._fv.switchModalTab = (e, tabId) => {
    document.querySelectorAll('.tab-btn').forEach(btn => btn.classList.remove('active'));
    document.querySelectorAll('.modal-tab-content').forEach(content => content.classList.remove('active'));
    e.target.classList.add('active');
    document.getElementById(`case-tab-${tabId}`).classList.add('active');
};

window._fv.searchCaseEntities = async (query) => {
    const { escapeHtml } = window._crmUtils || {};
    const results = document.getElementById('case-entity-results');
    if (!results) return;
    if (!query || query.length < 2) {
        results.style.display = 'none';
        return;
    }

    const [allP, allC] = await Promise.all([
        window.AppDataStore.getAll('prospects'),
        window.AppDataStore.getAll('customers'),
    ]);
    const q = query.toLowerCase();
    const prospects = (allP || []).filter(p => p.full_name?.toLowerCase().includes(q) || p.nickname?.toLowerCase().includes(q)).slice(0, 30);
    const customers = (allC || []).filter(c => c.full_name?.toLowerCase().includes(q) || c.nickname?.toLowerCase().includes(q)).slice(0, 30);

    let html = '';
    if (prospects.length > 0) {
        html += '<div class="search-category">Prospects</div>';
        html += prospects.map(p => `<div class="search-result-item" onclick="app.selectCaseEntity('${p.id}', 'prospect', '${p.full_name.replace("'", "\\'")}')">${escapeHtml(p.full_name || '')}</div>`).join('');
    }
    if (customers.length > 0) {
        html += '<div class="search-category">Customers</div>';
        html += customers.map(c => `<div class="search-result-item" onclick="app.selectCaseEntity('${c.id}', 'customer', '${c.full_name.replace("'", "\\'")}')">${escapeHtml(c.full_name || '')}</div>`).join('');
    }

    if (html === '') {
        html = '<div class="p-2 text-center text-muted">No results found</div>';
    }

    results.innerHTML = html;
    results.style.display = 'block';
};

window._fv.selectCaseEntity = (id, type, name) => {
    document.getElementById('case-entity-search').value = name;
    document.getElementById('case-prospect-id').value = type === 'prospect' ? id : '';
    document.getElementById('case-customer-id').value = type === 'customer' ? id : '';
    document.getElementById('case-entity-results').style.display = 'none';
};

window._fv.saveCaseStudy = async (id) => {
    const _currentUser = window._appState?.cu;
    const _caseActiveTab = window._appState.caseActiveTab || 'cps';
    const _casePendingPhotos = window._appState.casePendingPhotos || [];

    const title = document.getElementById('case-title').value.trim();
    if (!title) {
        window.UI.toast.error("Title is required.");
        return;
    }

    const data = {
        title,
        case_type: document.getElementById('case-type')?.value || _caseActiveTab,
        prospect_id: document.getElementById('case-prospect-id').value || null,
        customer_id: document.getElementById('case-customer-id').value || null,
        product: document.getElementById('case-product').value,
        amount: parseFloat(document.getElementById('case-amount').value) || 0,
        closing_date: document.getElementById('case-closing-date').value,
        cps_invitation_details: document.getElementById('case-cps-details').value,
        closing_details: document.getElementById('case-closing-details').value,
        sales_idea: document.getElementById('case-sales-idea').value,
        plan_details: document.getElementById('case-plan-details').value,
        success_story: document.getElementById('case-success-story').value,
        key_success_factor: document.getElementById('case-key-success-factor').value,
        script: document.getElementById('case-script').value,
        photo_urls: Array.isArray(_casePendingPhotos) ? _casePendingPhotos : [],
        updated_at: new Date().toISOString()
    };
    const photos = Array.isArray(_casePendingPhotos) ? _casePendingPhotos : [];
    data.is_public = !!(
        data.cps_invitation_details?.trim() ||
        data.closing_details?.trim() ||
        data.sales_idea?.trim() ||
        data.plan_details?.trim() ||
        data.success_story?.trim() ||
        data.key_success_factor?.trim() ||
        data.script?.trim() ||
        photos.length > 0
    );

    if (id) {
        await window.AppDataStore.update('case_studies', id, data);
        window.UI.toast.success("Case updated.");
    } else {
        data.created_by = _currentUser?.id || 1;
        data.created_at = new Date().toISOString();
        const newCase = await window.AppDataStore.create('case_studies', data);
        window.UI.toast.success("Case created.");
        id = newCase.id;
    }

    window.UI.hideModal();
    await window._fv.renderCasesList();
};

// ══════════════ showProspectsView ══════════════
window._fv.showProspectsView = async (container) => {
    container.innerHTML = `
            <div class="prospects-view">
                <div class="tab-navigation">
                    <button class="tab-btn active" onclick="app.switchCustomerTab('prospects')">Prospects</button>
                    <button class="tab-btn" onclick="app.switchCustomerTab('customers')">Customers</button>
                </div>

                <div id="prospects-tab-content">
                    <div class="prospects-header">
                        <div>
                            <h1>Prospects Management</h1>
                            <p>Track and manage potential customers through the lifecycle.</p>
                        </div>
                        <div class="header-actions">
                            <button class="btn secondary" onclick="app.openImportWizard()">
                                <i class="fas fa-file-import"></i> Import
                            </button>
                            <button class="btn primary" onclick="app.openAddProspectModal()">
                                <i class="fas fa-plus"></i> Add Prospect
                            </button>
                        </div>
                    </div>

                    <!-- Stats row -->
                    <div class="prospect-stats-row" id="prospect-stats-row"></div>

                <div class="filter-bar">
                    <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;">
                        <div class="search-group" style="flex:1;min-width:180px;">
                            <i class="fas fa-search"></i>
                            <input type="text" id="prospect-search" placeholder="Search by name, phone, email, or ID..." oninput="app.debounceCall('prospect-search', app.filterProspects, 220)">
                        </div>
                        <button id="prospect-filter-btn" class="btn secondary btn-sm" onclick="app.toggleProspectFilters(this)" style="white-space:nowrap;position:relative;">
                            <i class="fas fa-sliders-h"></i> Filters
                        </button>
                        <div class="prospect-view-toggle">
                            <button id="prospect-view-table" class="active" onclick="app.toggleProspectView('table')" title="Table view"><i class="fas fa-table"></i> Table</button>
                            <button id="prospect-view-card" onclick="app.toggleProspectView('card')" title="Card view"><i class="fas fa-th-large"></i> Card</button>
                        </div>
                        <select id="prospect-sort-select" class="form-control" style="width:auto;font-size:13px;padding:6px 10px;" onchange="app.sortProspectsBySelect(this.value)">
                            <option value="score_desc">Sort: Score (High → Low)</option>
                            <option value="score_asc">Sort: Score (Low → High)</option>
                            <option value="name_asc">Sort: Name (A → Z)</option>
                            <option value="name_desc">Sort: Name (Z → A)</option>
                            <option value="activity_desc">Sort: Recent Activity</option>
                            <option value="protection_asc">Sort: Protection (Urgent first)</option>
                        </select>
                    </div>
                    <div id="prospect-adv-filters" style="display:none;margin-top:10px;">
                        <div class="filter-group">
                            <select id="filter-score" onchange="app.filterProspects()">
                                <option value="">All Scores</option>
                                <option value="A+">Grade A+ (800-1000)</option>
                                <option value="A">Grade A (600-799)</option>
                                <option value="B">Grade B (400-599)</option>
                                <option value="C">Grade C (200-399)</option>
                                <option value="D">Grade D (0-199)</option>
                            </select>
                            <select id="filter-gua" onchange="app.filterProspects()">
                                <option value="">All Ming Gua</option>
                                <option value="MG1">MG1 坎</option>
                                <option value="MG2">MG2 坤</option>
                                <option value="MG3">MG3 震</option>
                                <option value="MG4">MG4 巽</option>
                                <option value="MG5">MG5</option>
                                <option value="MG6">MG6 乾</option>
                                <option value="MG7">MG7 兑</option>
                                <option value="MG8">MG8 艮</option>
                                <option value="MG9">MG9 离</option>
                            </select>
                            <select id="filter-status" onchange="app.filterProspects()">
                                <option value="">All Status</option>
                                <option value="active">Active</option>
                                <option value="attention">Needs Attention</option>
                                <option value="reassign">Reassignable</option>
                                <option value="critical">Critical</option>
                            </select>
                            <select id="filter-agent" onchange="app.filterProspects()">
                                <option value="">All Agents</option>
                            </select>
                            <label style="display:inline-flex;align-items:center;gap:6px;font-size:13px;color:var(--text-secondary);cursor:pointer;user-select:none;" title="By default, prospects inactive for 500+ days are hidden. Type a name/phone in the search box to find them, or check this to load them all.">
                                <input type="checkbox" id="filter-include-dormant" onchange="app.filterProspects()" style="margin:0;">
                                Include dormant (500+ days)
                            </label>
                            <button class="btn primary" onclick="app.filterProspects()">Apply Filters</button>
                        </div>
                    </div>
                </div>

                <!-- Bulk action bar -->
                <div class="prospect-bulk-bar" id="prospect-bulk-bar" style="display:none;">
                    <span class="bulk-count" id="prospect-bulk-count">0</span>&nbsp;selected
                    <button class="btn-bulk" onclick="app.bulkReassignProspects()"><i class="fas fa-user-tag"></i> Reassign</button>
                    <button class="btn-bulk danger" id="prospect-bulk-delete-btn" onclick="app.bulkDeleteProspects()"><i class="fas fa-trash"></i> Delete</button>
                    <button class="btn-bulk ml-auto" onclick="app.clearProspectSelection()"><i class="fas fa-times"></i> Clear</button>
                </div>

                <div class="prospects-table-container" id="prospects-table-view">
                    <table class="prospects-table" id="prospects-table">
                        <thead>
                            <tr>
                                <th scope="col" class="prospect-select-cell"><input type="checkbox" id="prospect-select-all" onclick="app.toggleProspectSelectAll()" title="Select all"></th>
                                <th scope="col" data-sort-field="name" onclick="app.sortProspects('name')" style="cursor:pointer;">PROSPECT <i class="fas fa-sort sort-icon"></i></th>
                                <th scope="col">AGENT</th>
                                <th scope="col" data-sort-field="score" onclick="app.sortProspects('score')" style="cursor:pointer;">SCORE <i class="fas fa-sort sort-icon active"></i></th>
                                <th scope="col">MING GUA</th>
                                <th scope="col">OCCUPATION/COMPANY</th>
                                <th scope="col" data-sort-field="activity" onclick="app.sortProspects('activity')" style="cursor:pointer;">LAST ACTIVITY <i class="fas fa-sort sort-icon"></i></th>
                                <th scope="col" data-sort-field="protection" onclick="app.sortProspects('protection')" style="cursor:pointer;">PROTECTION <i class="fas fa-sort sort-icon"></i></th>
                                <th scope="col">ACTIONS</th>
                            </tr>
                        </thead>
                        <tbody id="prospects-table-body">
                            <!-- Populated by renderProspectsTable() -->
                        </tbody>
                    </table>
                </div>

                <!-- Card view container -->
                <div id="prospects-card-view" style="display:none;">
                    <div class="prospect-cards-grid" id="prospect-cards-container"></div>
                    <div id="prospects-card-pagination"></div>
                </div>

                </div>
                <div id="customers-tab-content" style="display: none;">
                    <!-- Customer view content will be injected here -->
                </div>
            </div>
        `;
    await window.app.renderProspectsTable();
};

// ══════════════ showPurchasesHistoryView ══════════════
// ── Purchases History View ─────────────────────────────────────────────────
// Shared mutable state lives on window._appState so all delegated helpers
// (phSetFilter, phSetPage, refreshPurchasesHistory, savePurchasesHistoryRow)
// can read/write it whether called via app.X() stubs or directly.
(function _installPurchasesHistoryView() {
    const _PH_PAGE_SIZE = 50;

    // Lazy-initialise state keys on window._appState
    function _ensureState() {
        const s = window._appState;
        if (!s) return;
        if (s.phc  === undefined) s.phc   = null;          // cache object
        if (s.phcts === undefined) s.phcts = 0;            // cache timestamp
        if (!s.phf) s.phf = { search: '', agent: 'all', delivery: 'all', from: '', to: '' };
        if (s.php  === undefined) s.php   = 0;             // page index
    }

    // ── private: load ──────────────────────────────────────────────────────
    const _loadPurchasesHistory = async () => {
        _ensureState();
        const s = window._appState;
        try {
            const allProspects = await window.AppDataStore.getAll('prospects');
            console.log('[PH] total prospects from getAll:', (allProspects || []).length);
            const convertedIds = (allProspects || [])
                .filter(p => p.status === 'converted' || p.conversion_status === 'approved')
                .map(p => p.id);
            console.log('[PH] convertedIds:', convertedIds);
            let data = [];
            if (convertedIds.length) {
                const { data: rows, error } = await window.AppDataStore._readClient()
                    .from('prospects')
                    .select('id,full_name,responsible_agent_id,closing_records_history,closing_record,conversion_status')
                    .in('id', convertedIds);
                console.log('[PH] .in() query result:', rows, 'error:', error);
                if (error) throw error;
                data = rows || [];
            }
            console.log('[PH] data rows to process:', data.length);
            const allUsers = await window.AppDataStore.getAll('users');
            const agentMap = Object.fromEntries((allUsers || []).map(u => [String(u.id), u.full_name || u.name || u.email || 'Unknown']));
            const rows = [];
            for (const p of (data || [])) {
                const history = Array.isArray(p.closing_records_history) ? p.closing_records_history : [];
                history.forEach((h, hi) => {
                    rows.push({
                        prospectId: p.id,
                        customerName: p.full_name || '-',
                        agentId: h.lead_agent_id || p.responsible_agent_id,
                        agentName: agentMap[String(h.lead_agent_id || p.responsible_agent_id)] || '-',
                        date: h.closing_date || (h.approved_at ? h.approved_at.split('T')[0] : ''),
                        invoiceNo: h.invoice_number || '-',
                        product: h.product || '-',
                        amount: parseFloat(h.sale_amount) || 0,
                        deliveryStatus: h.delivery_status || 'pending',
                        remarks: h.delivery_remarks || '',
                        caseCompleted: !!h.case_completed,
                        isHistory: true,
                        historyIndex: hi,
                    });
                });
                if (p.closing_record && p.conversion_status === 'approved' && (p.closing_record.sale_amount || p.closing_record.invoice_number)) {
                    const h = p.closing_record;
                    rows.push({
                        prospectId: p.id,
                        customerName: p.full_name || '-',
                        agentId: h.lead_agent_id || p.responsible_agent_id,
                        agentName: agentMap[String(h.lead_agent_id || p.responsible_agent_id)] || '-',
                        date: h.closing_date || (h.approved_at ? h.approved_at.split('T')[0] : ''),
                        invoiceNo: h.invoice_number || '-',
                        product: h.product || '-',
                        amount: parseFloat(h.sale_amount) || 0,
                        deliveryStatus: h.delivery_status || 'pending',
                        remarks: h.delivery_remarks || '',
                        caseCompleted: !!h.case_completed,
                        isHistory: false,
                        historyIndex: -1,
                    });
                }
            }
            rows.sort((a, b) => {
                if (!a.date && !b.date) return 0;
                if (!a.date) return 1;
                if (!b.date) return -1;
                return b.date.localeCompare(a.date);
            });
            s.phc  = { rows, agentMap };
            s.phcts = Date.now();
        } catch (e) {
            console.error('Purchases history load error:', e);
            s.phc  = { rows: [], agentMap: {} };
            s.phcts = Date.now();
        }
    };

    // ── private: render ────────────────────────────────────────────────────
    const _renderPurchasesHistory = (viewport) => {
        _ensureState();
        const { escapeHtml } = window._crmUtils || {};
        const s = window._appState;
        const { rows = [], agentMap = {} } = s.phc || {};
        const f = s.phf;
        const _phPage = s.php;
        const filtered = rows.filter(r => {
            if (f.search) {
                const q = f.search.toLowerCase();
                if (!r.customerName.toLowerCase().includes(q) && !r.invoiceNo.toLowerCase().includes(q) && !r.product.toLowerCase().includes(q)) return false;
            }
            if (f.agent !== 'all' && String(r.agentId) !== f.agent) return false;
            if (f.delivery !== 'all' && r.deliveryStatus !== f.delivery) return false;
            if (f.from && r.date && r.date < f.from) return false;
            if (f.to && r.date && r.date > f.to) return false;
            return true;
        });
        const totalCount = filtered.length;
        const totalAmt = filtered.reduce((s, r) => s + r.amount, 0);
        const start = _phPage * _PH_PAGE_SIZE;
        const pageRows = filtered.slice(start, start + _PH_PAGE_SIZE);
        const totalPages = Math.ceil(totalCount / _PH_PAGE_SIZE);
        const uniqueAgentIds = [...new Set(rows.map(r => r.agentId).filter(Boolean))];
        const agentOptions = uniqueAgentIds.map(id => `<option value="${id}" ${f.agent === String(id) ? 'selected' : ''}>${escapeHtml(agentMap[String(id)] || String(id))}</option>`).join('');
        const tableRows = pageRows.map((r, i) => {
            const sn = start + i + 1;
            const rk = `${r.prospectId}-${r.historyIndex}`;
            const rowBg = r.caseCompleted ? 'background:#f0fdf4;' : '';
            return `<tr style="border-bottom:1px solid #f3f4f6;${rowBg}">
                <td style="padding:8px 10px;font-size:12px;color:var(--gray-400);text-align:center;">${sn}</td>
                <td style="padding:8px 10px;font-size:12px;white-space:nowrap;">${r.date || '-'}</td>
                <td style="padding:8px 10px;font-size:12px;white-space:nowrap;">${escapeHtml(r.agentName)}</td>
                <td style="padding:8px 10px;font-size:12px;white-space:nowrap;">${escapeHtml(r.invoiceNo)}</td>
                <td style="padding:8px 10px;font-size:12px;">
                    <span style="color:var(--primary);cursor:pointer;text-decoration:underline;font-weight:500;" onclick="event.stopPropagation();app.showProspectDetail(${r.prospectId})">${escapeHtml(r.customerName)}</span>
                </td>
                <td style="padding:8px 10px;font-size:12px;">${escapeHtml(r.product)}</td>
                <td style="padding:8px 10px;font-size:12px;text-align:right;font-weight:600;white-space:nowrap;">RM ${r.amount.toLocaleString()}</td>
                <td style="padding:8px 10px;">
                    <select id="ph-ds-${rk}" class="form-control" style="font-size:11px;min-width:130px;">
                        <option value="pending" ${r.deliveryStatus === 'pending' ? 'selected' : ''}>Pending Delivery</option>
                        <option value="delivered" ${r.deliveryStatus === 'delivered' ? 'selected' : ''}>Delivered</option>
                        <option value="completed" ${r.deliveryStatus === 'completed' ? 'selected' : ''}>Completed</option>
                    </select>
                </td>
                <td style="padding:8px 10px;">
                    <input id="ph-rem-${rk}" class="form-control" value="${escapeHtml(r.remarks)}" placeholder="Remarks..." style="height:28px;font-size:11px;min-width:150px;">
                </td>
                <td style="padding:8px 10px;text-align:center;">
                    <input type="checkbox" id="ph-cc-${rk}" ${r.caseCompleted ? 'checked' : ''} style="width:16px;height:16px;cursor:pointer;">
                </td>
                <td style="padding:8px 10px;text-align:center;">
                    <button class="btn primary btn-sm" style="height:28px;padding:0 12px;font-size:11px;" onclick="event.stopPropagation();app.savePurchasesHistoryRow(${r.prospectId},${r.historyIndex},${r.isHistory})"><i class="fas fa-save"></i></button>
                </td>
            </tr>`;
        }).join('');
        const pager = totalPages > 1 ? `
            <div style="display:flex;align-items:center;justify-content:center;gap:12px;padding:16px;border-top:1px solid #e5e7eb;">
                <button class="btn secondary btn-sm" ${_phPage === 0 ? 'disabled' : ''} onclick="app.phSetPage(${_phPage - 1})"><i class="fas fa-chevron-left"></i> Prev</button>
                <span style="font-size:13px;color:var(--gray-600);">Page ${_phPage + 1} of ${totalPages}</span>
                <button class="btn secondary btn-sm" ${_phPage >= totalPages - 1 ? 'disabled' : ''} onclick="app.phSetPage(${_phPage + 1})">Next <i class="fas fa-chevron-right"></i></button>
            </div>` : '';
        viewport.innerHTML = `
            <div style="padding:16px 20px 10px;background:#fff;border-bottom:1px solid #e5e7eb;position:sticky;top:0;z-index:10;">
                <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px;flex-wrap:wrap;gap:8px;">
                    <div>
                        <div style="font-size:18px;font-weight:700;color:var(--gray-800);">🧾 Purchases History</div>
                        <div style="font-size:12px;color:var(--gray-400);margin-top:2px;">${totalCount} record${totalCount !== 1 ? 's' : ''} · Total: <strong style="color:var(--gray-700);">RM ${totalAmt.toLocaleString()}</strong></div>
                    </div>
                    <button class="btn secondary btn-sm" onclick="app.refreshPurchasesHistory()"><i class="fas fa-sync-alt"></i> Refresh</button>
                </div>
                <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;">
                    <input class="form-control" placeholder="🔍 Customer / invoice / product" value="${escapeHtml(f.search)}" style="flex:1;min-width:180px;height:32px;font-size:12px;" oninput="app.phSetFilter('search',this.value)">
                    <select class="form-control" style="height:32px;font-size:12px;min-width:130px;" onchange="app.phSetFilter('agent',this.value)">
                        <option value="all" ${f.agent === 'all' ? 'selected' : ''}>All Consultants</option>
                        ${agentOptions}
                    </select>
                    <select class="form-control" style="height:32px;font-size:12px;min-width:120px;" onchange="app.phSetFilter('delivery',this.value)">
                        <option value="all" ${f.delivery === 'all' ? 'selected' : ''}>All Status</option>
                        <option value="pending" ${f.delivery === 'pending' ? 'selected' : ''}>Pending</option>
                        <option value="delivered" ${f.delivery === 'delivered' ? 'selected' : ''}>Delivered</option>
                        <option value="completed" ${f.delivery === 'completed' ? 'selected' : ''}>Completed</option>
                    </select>
                    <input type="date" class="form-control" value="${f.from}" style="height:32px;font-size:12px;width:130px;" onchange="app.phSetFilter('from',this.value)">
                    <span style="font-size:12px;color:var(--gray-400);">–</span>
                    <input type="date" class="form-control" value="${f.to}" style="height:32px;font-size:12px;width:130px;" onchange="app.phSetFilter('to',this.value)">
                </div>
            </div>
            <div style="overflow-x:auto;">
                <table style="width:100%;border-collapse:collapse;min-width:1000px;">
                    <thead>
                        <tr style="background:#f9fafb;border-bottom:2px solid #e5e7eb;">
                            <th scope="col" style="padding:8px 10px;font-size:11px;font-weight:700;color:var(--gray-500);text-align:center;white-space:nowrap;">SN</th>
                            <th scope="col" style="padding:8px 10px;font-size:11px;font-weight:700;color:var(--gray-500);white-space:nowrap;">Date</th>
                            <th scope="col" style="padding:8px 10px;font-size:11px;font-weight:700;color:var(--gray-500);white-space:nowrap;">Consultant</th>
                            <th scope="col" style="padding:8px 10px;font-size:11px;font-weight:700;color:var(--gray-500);white-space:nowrap;">Invoice No</th>
                            <th scope="col" style="padding:8px 10px;font-size:11px;font-weight:700;color:var(--gray-500);white-space:nowrap;">Customer Name</th>
                            <th scope="col" style="padding:8px 10px;font-size:11px;font-weight:700;color:var(--gray-500);white-space:nowrap;">Product / Service</th>
                            <th scope="col" style="padding:8px 10px;font-size:11px;font-weight:700;color:var(--gray-500);text-align:right;white-space:nowrap;">Amount (RM)</th>
                            <th scope="col" style="padding:8px 10px;font-size:11px;font-weight:700;color:var(--gray-500);white-space:nowrap;">Delivery Tracking</th>
                            <th scope="col" style="padding:8px 10px;font-size:11px;font-weight:700;color:var(--gray-500);white-space:nowrap;">Remarks</th>
                            <th scope="col" style="padding:8px 10px;font-size:11px;font-weight:700;color:var(--gray-500);text-align:center;white-space:nowrap;">Case Completed</th>
                            <th scope="col" style="padding:8px 10px;font-size:11px;font-weight:700;color:var(--gray-500);text-align:center;white-space:nowrap;">Save</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${tableRows || `<tr><td colspan="11" style="padding:48px;text-align:center;color:var(--gray-400);font-size:13px;"><i class="fas fa-receipt" style="font-size:36px;display:block;margin-bottom:10px;opacity:.4;"></i>No purchase records found</td></tr>`}
                    </tbody>
                </table>
            </div>
            ${pager}
        `;
    };

    // ── public: main entry point ───────────────────────────────────────────
    window._fv.showPurchasesHistoryView = async (viewport) => {
        _ensureState();
        const s = window._appState;
        viewport.innerHTML = `<div style="display:flex;align-items:center;justify-content:center;height:200px;color:var(--gray-400);"><i class="fas fa-spinner fa-spin" style="font-size:24px;"></i></div>`;
        const now = Date.now();
        if (!s.phc || now - s.phcts > 300_000) {
            await _loadPurchasesHistory();
        }
        _renderPurchasesHistory(viewport);
    };

    // ── public: delegated helpers (called via app.X() stubs) ──────────────
    window._fv.phSetFilter = (key, val) => {
        _ensureState();
        const s = window._appState;
        s.phf[key] = val;
        s.php = 0;
        const vp = document.getElementById('content-viewport');
        if (vp) _renderPurchasesHistory(vp);
    };

    window._fv.phSetPage = (page) => {
        _ensureState();
        const s = window._appState;
        s.php = page;
        const vp = document.getElementById('content-viewport');
        if (vp) _renderPurchasesHistory(vp);
    };

    window._fv.refreshPurchasesHistory = async () => {
        _ensureState();
        const s = window._appState;
        s.phc   = null;
        s.phcts = 0;
        const vp = document.getElementById('content-viewport');
        if (vp) await window._fv.showPurchasesHistoryView(vp);
    };

    window._fv.savePurchasesHistoryRow = async (prospectId, historyIndex, isHistory) => {
        _ensureState();
        const s = window._appState;
        const rk = `${prospectId}-${historyIndex}`;
        const statusEl    = document.getElementById(`ph-ds-${rk}`);
        const remarksEl   = document.getElementById(`ph-rem-${rk}`);
        const completedEl = document.getElementById(`ph-cc-${rk}`);
        const updates = {
            delivery_status:  statusEl?.value || 'pending',
            delivery_remarks: remarksEl?.value || '',
            case_completed:   completedEl?.checked || false,
        };
        const prospect = await window.AppDataStore.getByIdFull('prospects', prospectId);
        if (!prospect) return window.UI.toast.error('Prospect not found');
        if (isHistory) {
            const history = Array.isArray(prospect.closing_records_history) ? [...prospect.closing_records_history] : [];
            if (historyIndex < 0 || historyIndex >= history.length) return window.UI.toast.error('Record not found');
            history[historyIndex] = { ...history[historyIndex], ...updates };
            await window.AppDataStore.update('prospects', prospectId, { closing_records_history: history });
        } else {
            if (!prospect.closing_record) return window.UI.toast.error('No active closing record');
            await window.AppDataStore.update('prospects', prospectId, { closing_record: { ...prospect.closing_record, ...updates } });
        }
        if (s.phc?.rows) {
            const row = s.phc.rows.find(r => r.prospectId == prospectId && r.historyIndex == historyIndex && r.isHistory === isHistory);
            if (row) Object.assign(row, updates);
        }
        window.UI.toast.success('Saved');
    };
})();

// ══════════════ showAgentsView ══════════════
window._fv.showAgentsView = async (container) => {
    const _currentUser = window._appState?.cu;
    const { escapeHtml } = window._crmUtils || {};

    container.innerHTML = `
    <div class="agents-view">
                <div class="agents-header">
                    <div>
                        <h1>Agent Management</h1>
                        <p>Monitor agent performance, licenses, and assignments.</p>
                    </div>
                    <div class="header-actions">
                        <button class="btn primary" onclick="app.openAddAgentModal()">
                            <i class="fas fa-plus"></i> Add Agent
                        </button>
                    </div>
                </div>

                <div class="agent-filters">
                    <div class="search-group" style="flex:1; min-width:200px; display:flex; align-items:center; gap:8px; background:var(--gray-50); padding:8px 12px; border-radius:6px; border:1px solid var(--gray-200);">
                        <i class="fas fa-search" style="color:var(--gray-400);"></i>
                        <input type="text" id="agent-search" placeholder="Search agents by name, code, or phone" oninput="app.debounceCall('agent-search', app.filterAgents, 220)" style="border:none; background:transparent; outline:none; width:100%;">
                    </div>
                    <label for="filter-agent-team" class="sr-only">Filter by team</label>
                    <select id="filter-agent-team" aria-label="Filter by team" onchange="app.filterAgents()" class="form-control" style="width:140px;">
                        <option value="">All Teams</option>
                        ${Array.from({length: 26}, (_, i) => String.fromCharCode(65 + i)).map(L => `<option value="Team ${L}">Team ${L}</option>`).join('')}
                    </select>
                    <label for="filter-agent-role" class="sr-only">Filter by role</label>
                    <select id="filter-agent-role" aria-label="Filter by role" onchange="app.filterAgents()" class="form-control" style="width:160px;">
                        <option value="">All Roles</option>
                        ${(window.USER_ROLES || []).map(r => `<option value="${r}">${r}</option>`).join('')}
                    </select>
                    <label for="filter-agent-status" class="sr-only">Filter by status</label>
                    <select id="filter-agent-status" aria-label="Filter by status" onchange="app.filterAgents()" class="form-control" style="width:140px;">
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
                                <th scope="col">Name / Agent ID</th>
                                <th scope="col">Team</th>
                                <th scope="col">Status</th>
                                <th scope="col">License Expiry</th>
                                <th scope="col">Assigned Prospects</th>
                                <th scope="col">Customers</th>
                                <th scope="col">Follow-up Rate</th>
                                <th scope="col">Actions</th>
                            </tr>
                        </thead>
                        <tbody id="agents-table-body">
                            ${Array(8).fill(0).map(() => `<tr>${Array(8).fill(0).map((_, i) => `<td style="padding:10px 12px;"><div class="skeleton" style="height:14px;border-radius:4px;width:${[75,45,50,60,40,35,45,30][i]}%;"></div></td>`).join('')}</tr>`).join('')}
                        </tbody>
                    </table>
                </div>
            </div>
    `;
    await window._fv._renderAgentsTable();
};

window._fv._renderAgentsTable = async () => {
    const _currentUser = window._appState?.cu;
    const { escapeHtml } = window._crmUtils || {};

    const tbody = document.getElementById('agents-table-body');
    if (!tbody) {
        console.error('agents-table-body not found');
        return;
    }

    const allAgents = (await window.AppDataStore.getAll('users')).filter(u => (typeof window.isAgent === 'function' ? window.isAgent(u) : (u.agent_code)) || u.agent_code);
    const getVisibleUserIds = window._crmUtils?.getVisibleUserIds || (async () => 'all');
    const visibleIds = await getVisibleUserIds(_currentUser);
    const agents = visibleIds === 'all' ? allAgents : allAgents.filter(a => visibleIds.map(String).includes(String(a.id)));
    const searchQuery = document.getElementById('agent-search')?.value.toLowerCase() || '';
    const teamFilter = document.getElementById('filter-agent-team')?.value || '';
    const roleFilter = document.getElementById('filter-agent-role')?.value || '';
    const statusFilter = document.getElementById('filter-agent-status')?.value || '';

    const curLvlMatch = _currentUser?.role?.match(/Level\s+(\d+)/i);
    const canAssignUpline = curLvlMatch ? parseInt(curLvlMatch[1]) <= 4 : false;

    const [allProspects, allCustomers, allAgentStats] = await Promise.all([
        window.AppDataStore.getAll('prospects'),
        window.AppDataStore.getAll('customers'),
        window.AppDataStore.getAll('agent_stats')
    ]);
    const prospectCountMap = {};
    const customerCountMap = {};
    for (const p of allProspects) {
        const aid = String(p.responsible_agent_id);
        prospectCountMap[aid] = (prospectCountMap[aid] || 0) + 1;
    }
    for (const c of allCustomers) {
        const aid = String(c.responsible_agent_id || c.agent_id);
        if (aid) customerCountMap[aid] = (customerCountMap[aid] || 0) + 1;
    }
    const statsByAgentId = new Map();
    for (const s of allAgentStats) {
        statsByAgentId.set(String(s.agent_id), s);
    }

    let html = '';
    for (const agent of agents) {
        if (searchQuery && !agent.full_name?.toLowerCase().includes(searchQuery) && !agent.agent_code?.toLowerCase().includes(searchQuery) && !agent.phone?.toLowerCase().includes(searchQuery)) continue;
        if (teamFilter && agent.team !== teamFilter) continue;
        if (roleFilter && agent.role !== roleFilter) continue;
        if (statusFilter && agent.status !== statusFilter) continue;

        const prospectCount = prospectCountMap[String(agent.id)] || 0;
        const customerCount = customerCountMap[String(agent.id)] || 0;
        const stats = statsByAgentId.get(String(agent.id)) || { followup_rate: 0 };
        const rateClass = stats.followup_rate >= 90 ? 'rate-good' : (stats.followup_rate >= 70 ? 'rate-warning' : 'rate-critical');
        const status = agent.status || 'active';

        html += `
                <tr data-agent-id="${agent.id}" class="agent-row">
                    <td data-label="Name">
                        <div style="font-weight:600;">${escapeHtml(agent.full_name)}</div>
                        <div style="font-size:12px; color:var(--gray-500);">${escapeHtml(agent.agent_code) || 'N/A'}</div>
                    </td>
                    <td data-label="Team">${escapeHtml(agent.team) || 'Unassigned'}</td>
                    <td data-label="Status"><span class="status-badge status-${status}">${status.toUpperCase()}</span></td>
                    <td data-label="License Expiry">${escapeHtml(agent.license_expiry) || 'N/A'}</td>
                    <td data-label="Prospects">${prospectCount} prospects</td>
                    <td data-label="Customers">${customerCount} customers</td>
                    <td data-label="Follow-up">
                        <div class="followup-rate">
                            <span class="rate-indicator ${rateClass}"></span>
                            <span>${stats.followup_rate ?? 0}%</span>
                        </div>
                    </td>
                    <td onclick="event.stopPropagation()">
                        <button class="btn-icon view-detail-btn" onclick="event.stopPropagation(); app.showAgentProfile('${agent.id}')" title="View Detail"><i class="fas fa-eye"></i></button>
                        <button class="btn-icon edit-agent-btn" onclick="event.stopPropagation(); app.openEditAgentModal('${agent.id}')" title="Edit Agent"><i class="fas fa-edit"></i></button>
                        ${canAssignUpline ? `<button class="btn-icon" onclick="event.stopPropagation(); app.openAssignUplineModal('${agent.id}')" title="Assign Upline"><i class="fas fa-sitemap"></i></button>` : ''}
                        ${canAssignUpline ? `<button class="btn-icon" onclick="event.stopPropagation(); app.openResetPasswordModal('${agent.id}')" title="Reset Password"><i class="fas fa-key"></i></button>` : ''}
                        ${canAssignUpline ? `<button class="btn-icon" onclick="event.stopPropagation(); app.deleteAgent('${agent.id}')" title="Delete Agent" style="color:var(--error);"><i class="fas fa-trash"></i></button>` : ''}
                    </td>
                </tr>
            `;
    }

    tbody.innerHTML = '';
    tbody.insertAdjacentHTML('beforeend', html || '<tr><td colspan="8" style="text-align:center; padding:20px;">No agents found</td></tr>');
};

window._fv._showAgentProfile = async (agentId) => {
    const _currentUser = window._appState?.cu;
    const { escapeHtml } = window._crmUtils || {};

    // Show skeleton immediately so the user sees something while data loads
    const viewport = document.getElementById('content-viewport');
    if (viewport) viewport.innerHTML = '<div style="display:flex;align-items:center;justify-content:center;height:200px;gap:12px;color:var(--gray-400);flex-direction:column;"><i class="fas fa-circle-notch fa-spin" style="font-size:24px;"></i><span style="font-size:13px;">Loading agent profile…</span></div>';

    const [agent, allUsers] = await Promise.all([
        Promise.race([
            window.AppDataStore.getById('users', agentId).catch(() => null),
            new Promise(resolve => setTimeout(() => resolve(null), 8000))
        ]),
        Promise.race([
            window.AppDataStore.getAll('users').catch(() => []),
            new Promise(resolve => setTimeout(() => resolve([]), 8000))
        ])
    ]);

    if (!agent) {
        window.UI.toast.error('Agent not found');
        if (viewport) viewport.innerHTML = '<div style="padding:40px;text-align:center;color:var(--gray-400);">Agent not found or could not be loaded.</div>';
        return;
    }

    const lvlMatch = _currentUser?.role?.match(/Level\s+(\d+)/i);
    const isAdminOrLead = lvlMatch ? parseInt(lvlMatch[1]) <= 4 : false;

    const reportingToUser = agent.reporting_to ? allUsers.find(u => u.id == agent.reporting_to) : null;
    const reportingToName = reportingToUser ? reportingToUser.full_name : '—';

    const calculateDaysDiff = (expiryDate) => {
        if (!expiryDate) return 0;
        const today = new Date(); today.setHours(0, 0, 0, 0);
        const datePart = String(expiryDate).slice(0, 10);
        const expiry = new Date(datePart + 'T00:00:00');
        if (isNaN(expiry.getTime())) return 0;
        const diff = Math.ceil((expiry - today) / (1000 * 60 * 60 * 24));
        return diff > 0 ? diff : 0;
    };

    const renderFollowupStats = async (agentId) => {
        const stats = (await Promise.race([
            window.AppDataStore.query('agent_stats', { agent_id: agentId }).catch(() => []),
            new Promise(resolve => setTimeout(() => resolve([]), 5000))
        ]))[0];
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
        const agentProspects = await Promise.race([
            window.AppDataStore.query('prospects', { responsible_agent_id: agentId }).catch(() => []),
            new Promise(resolve => setTimeout(() => resolve([]), 6000))
        ]);
        if (agentProspects.length === 0) return '<p style="color:var(--gray-400);font-size:13px;">No prospects assigned.</p>';
        agentProspects.sort((a, b) => (b.last_activity_date || '').localeCompare(a.last_activity_date || ''));
        return `
            <div class="assignments-list">
                ${agentProspects.map(p => `
                    <div class="assignment-item" onclick="app.showProspectDetail(${p.id})" style="cursor:pointer;">
                        <div>
                            <div class="assignment-prospect">${escapeHtml(p.full_name || '(No Name)')}</div>
                            <div class="next-action" style="font-size:12px;color:var(--gray-500);">
                                ${p.last_activity_date ? 'Last: ' + p.last_activity_date : 'No activity yet'}
                            </div>
                        </div>
                        <span class="assignment-status status-${(p.status || 'prospect').toLowerCase()}">${p.status || 'Prospect'}</span>
                    </div>
                `).join('')}
            </div>
            <p style="font-size:12px;color:var(--gray-400);margin-top:8px;">${agentProspects.length} prospect${agentProspects.length !== 1 ? 's' : ''} total</p>
        `;
    };

    const renderPerformanceTargets = async (agentId) => {
        const target = (await Promise.race([
            window.AppDataStore.query('agent_targets', { agent_id: agentId }).catch(() => []),
            new Promise(resolve => setTimeout(() => resolve([]), 5000))
        ]))[0];
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
                
                <button class="btn primary btn-sm" style="margin-top:12px;" onclick="app.updateAgentTargets(${agentId})">Update Targets</button>
            </div>
    `;
    };

    const renderCustomerHistory = async (agentId) => {
        const customers = await Promise.race([
            window.AppDataStore.query('customers', { responsible_agent_id: agentId }).catch(() => []),
            new Promise(resolve => setTimeout(() => resolve([]), 6000))
        ]);
        if (customers.length === 0) return '<p>No converted customers yet.</p>';
        return `
    <div class="assignments-list">
        ${customers.map(c => `
                    <div class="assignment-item" onclick="app.showCustomerDetail(${c.id})">
                        <div>
                            <div class="assignment-prospect">${escapeHtml(c.full_name)}</div>
                            <div class="next-action">Customer Since: ${c.customer_since}</div>
                        </div>
                        <span class="assignment-status status-active">RM ${(c.lifetime_value || 0).toLocaleString()}</span>
                    </div>
                `).join('')}
            </div>
    `;
    };

    const _apLoading = '<div style="padding:20px;text-align:center;color:var(--gray-400);font-size:13px;"><i class="fas fa-circle-notch fa-spin" style="margin-right:6px;"></i>Loading…</div>';
    viewport.innerHTML = `
    <div class="agent-profile-view">
        <div class="header-actions" style="margin-bottom:16px;">
            <button class="btn secondary" onclick="app.navigateTo('agents')"><i class="fas fa-arrow-left"></i> Back to Agents</button>
        </div>

        <div class="profile-header" style="display:flex; justify-content:space-between; align-items:flex-start; margin-bottom:24px;">
            <div>
                <div style="display:flex; align-items:center; gap:12px; margin-bottom:8px;">
                    <h1 style="font-size:32px; font-weight:700;">${escapeHtml(agent.full_name)}</h1>
                    <span class="status-badge status-${agent.status}">${agent.status?.toUpperCase() || 'ACTIVE'}</span>
                </div>
                <div style="display:flex; gap:12px; color:var(--gray-500); font-size:14px;">
                    <span>Agent ID: ${escapeHtml(agent.agent_code || '—')}</span>
                    <span><i class="fas fa-user-tie"></i> ${escapeHtml(agent.role || 'Consultant')}</span>
                    <span><i class="fas fa-users"></i> ${escapeHtml(agent.team || 'Sales')}</span>
                </div>
            </div>
            <div class="header-actions">
                <button class="btn secondary" onclick="app.resetAgentPassword(${agentId})">Reset Password</button>
                <button class="btn secondary" onclick="app.openAddAgentModal(${agentId})">Edit Profile</button>
                <button class="btn error" onclick="app.deactivateAgent(${agentId})">Deactivate</button>
            </div>
        </div>

        ${agent.id === 9 || agent.username === 'ong.beeling' ? `
        <div class="conversion-banner">
            <i class="fas fa-award"></i>
            <span>Converted from Customer on 05 Mar 2026 via <strong>Premium Package (RM 5,500)</strong></span>
        </div>
        ` : ''}

        ${isAdminOrLead ? `
        <div class="license-dashboard">
            <h3><i class="fas fa-id-card"></i> License Renewal Dashboard</h3>
            <div class="license-stats">
                <div class="license-stat">
                    <span class="license-stat-label">License Expiry</span>
                    <span class="license-stat-value">${agent.license_expiry || '2026-12-31'}</span>
                </div>
                <div class="license-stat">
                    <span class="license-stat-label">Days Remaining</span>
                    <span class="license-stat-value" style="color:${calculateDaysDiff(agent.license_expiry || '2026-12-31') < 30 ? '#ef4444' : '#0369a1'}">${calculateDaysDiff(agent.license_expiry || '2026-12-31')} Days</span>
                </div>
                <div class="license-stat">
                    <span class="license-stat-label">Renewal Status</span>
                    <span class="license-stat-value">${agent.renewal_status || 'ELIGIBLE'}</span>
                </div>
            </div>
            <div class="license-actions">
                <button class="btn primary" onclick="app.renewLicense(${agent.id})" ${calculateDaysDiff(agent.license_expiry || '2026-12-31') > 60 ? 'disabled' : ''}>Renew Now</button>
                <button class="btn secondary" onclick="app.sendRenewalReminder(${agent.id})">Send Reminder</button>
            </div>
        </div>
        ` : ''}

        <div class="performance-grid">
            <div class="performance-card">
                <h4><i class="fas fa-info-circle"></i> Agent Information</h4>
                <div class="performance-stats">
                    <div class="stat-row">
                        <span class="stat-label">Phone:</span>
                        <span class="stat-value">${escapeHtml(agent.phone || '012-1234567')}</span>
                    </div>
                    <div class="stat-row">
                        <span class="stat-label">Email:</span>
                        <span class="stat-value">${escapeHtml(agent.email || 'agent@fengshui.com')}</span>
                    </div>
                    <div class="stat-row">
                        <span class="stat-label">Join Date:</span>
                        <span class="stat-value">${agent.join_date || '2026-01-01'}</span>
                    </div>
                    <div class="stat-row">
                        <span class="stat-label">Comm. Rate:</span>
                        <span class="stat-value">${(agent.commission_rate != null && !isNaN(parseFloat(agent.commission_rate))) ? parseFloat(agent.commission_rate) + '%' : '—'}</span>
                    </div>
                    <div class="stat-row">
                        <span class="stat-label">Reporting To:</span>
                        <span class="stat-value">${escapeHtml(reportingToName)}</span>
                    </div>
                </div>
            </div>

            <div class="performance-card">
                <h4><i class="fas fa-chart-line"></i> Follow-up Performance</h4>
                <div id="_ap-followup-${agentId}">${_apLoading}</div>
            </div>
        </div>

        <div class="performance-grid">
            <div class="performance-card">
                <h4><i class="fas fa-list-check"></i> Current Assignments</h4>
                <div id="_ap-assignments-${agentId}">${_apLoading}</div>
            </div>
            <div class="performance-card">
                <h4><i class="fas fa-bullseye"></i> Performance Targets (March)</h4>
                <div id="_ap-targets-${agentId}">${_apLoading}</div>
            </div>
        </div>

        <div class="performance-grid">
            <div class="performance-card">
                <h4><i class="fas fa-history"></i> Customer History</h4>
                <div id="_ap-customers-${agentId}">${_apLoading}</div>
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
        </div>

        <!-- Agent Notes Card -->
        <div class="performance-grid">
            <div class="performance-card">
                <h4><i class="fas fa-sticky-note"></i> Agent Notes</h4>
                <div class="add-note-section">
                    <textarea id="agent-note-text-${agent.id}" class="form-control" rows="3" placeholder="Add note about agent performance..."></textarea>
                    <div style="display:flex; justify-content:space-between; align-items:center; margin-top:8px;">
                        <button class="btn-icon" onclick="app.openVoiceRecorder('agent-note-text-${agent.id}', 'agent', ${agent.id})" title="Record voice note" style="color:var(--primary);"><i class="fas fa-microphone"></i></button>
                        <button class="btn primary btn-sm" onclick="app.addAgentNote(${agent.id})">Add Note</button>
                    </div>
                </div>
                <div id="agent-notes-list-${agent.id}" style="margin-top:12px;"></div>
            </div>
        </div>
    </div>
    `;

    // Populate all async sections in parallel — page already visible above
    Promise.all([
        renderFollowupStats(agent.id).then(html => {
            const el = document.getElementById(`_ap-followup-${agentId}`);
            if (el) el.innerHTML = html;
        }).catch(() => {
            const el = document.getElementById(`_ap-followup-${agentId}`);
            if (el) el.innerHTML = '<p style="color:var(--gray-400);font-size:13px;">Failed to load.</p>';
        }),
        renderCurrentAssignments(agent.id).then(html => {
            const el = document.getElementById(`_ap-assignments-${agentId}`);
            if (el) el.innerHTML = html;
        }).catch(() => {
            const el = document.getElementById(`_ap-assignments-${agentId}`);
            if (el) el.innerHTML = '<p style="color:var(--gray-400);font-size:13px;">Failed to load.</p>';
        }),
        renderPerformanceTargets(agent.id).then(html => {
            const el = document.getElementById(`_ap-targets-${agentId}`);
            if (el) el.innerHTML = html;
        }).catch(() => {
            const el = document.getElementById(`_ap-targets-${agentId}`);
            if (el) el.innerHTML = '<p style="color:var(--gray-400);font-size:13px;">Failed to load.</p>';
        }),
        renderCustomerHistory(agent.id).then(html => {
            const el = document.getElementById(`_ap-customers-${agentId}`);
            if (el) el.innerHTML = html;
        }).catch(() => {
            const el = document.getElementById(`_ap-customers-${agentId}`);
            if (el) el.innerHTML = '<p style="color:var(--gray-400);font-size:13px;">Failed to load.</p>';
        }),
        window.AppDataStore.query('notes', { agent_id: agent.id }).catch(() => []).then(agentNotes => {
            const notesHtml = agentNotes.length
                ? agentNotes.map(n => `
                    <div class="notes-item" style="margin-top:8px;">
                        <div class="notes-header">
                            <span>${escapeHtml(n.date)} - ${escapeHtml(n.author)}${n.is_voice_note ? ' <i class="fas fa-microphone voice-note-icon" title="Voice note"></i>' : ''}</span>
                            <button class="btn-icon" onclick="app.deleteAgentNote(${agent.id}, ${n.id})"><i class="fas fa-trash"></i></button>
                        </div>
                        <div>"${escapeHtml(n.text)}"</div>
                    </div>
                `).join('')
                : '<p style="color:var(--gray-400); font-size:13px;">No notes yet.</p>';
            const notesContainer = document.getElementById(`agent-notes-list-${agent.id}`);
            if (notesContainer) notesContainer.innerHTML = notesHtml;
        })
    ]);
};

// ══════════════ showSettingsView ══════════════
window._fv.showSettingsView = async (container) => {
    const _currentUser = window._appState?.cu;
    const { escapeHtml, isSystemAdmin, isMarketingManager } = window._crmUtils || {};

    const viewport = container || document.getElementById('content-viewport');
    viewport.innerHTML = `
    <div style="max-width:640px; margin:32px auto; padding:0 16px;">
        <h2 style="font-size:24px; font-weight:700; margin-bottom:24px;"><i class="fas fa-cog"></i> Account Settings</h2>

        <div class="performance-card" style="margin-bottom:24px;">
            <h4><i class="fas fa-user"></i> Profile</h4>
            <div class="performance-stats">
                <div class="stat-row"><span class="stat-label">Name:</span><span class="stat-value">${escapeHtml(_currentUser?.full_name || '')}</span></div>
                <div class="stat-row"><span class="stat-label">Email:</span><span class="stat-value">${escapeHtml(_currentUser?.email || '')}</span></div>
                <div class="stat-row"><span class="stat-label">Role:</span><span class="stat-value">${escapeHtml(_currentUser?.role || '')}</span></div>
                <div class="stat-row"><span class="stat-label">Agent Code:</span><span class="stat-value">${escapeHtml(_currentUser?.agent_code || '—')}</span></div>
            </div>
        </div>

        <div class="performance-card" style="margin-bottom:24px;">
            <h4><i class="fas fa-id-badge"></i> Display Name</h4>
            <p style="color:var(--gray-500); font-size:13px; margin:8px 0 12px;">This is the name shown in the top-right header. Leave blank to use your full name.</p>
            <div class="form-group" style="margin-bottom:12px;">
                <label>Preferred Name</label>
                <input type="text" id="settings-preferred-name" class="form-control" placeholder="e.g. Mian" value="${escapeHtml(_currentUser?.preferred_name || '')}" maxlength="60">
            </div>
            <button class="btn primary" onclick="(async()=>{ await app.saveSelfPreferredName(); })()">
                <i class="fas fa-save"></i> Save Display Name
            </button>
        </div>

        <div class="performance-card">
            <h4><i class="fas fa-key"></i> Change Password</h4>
            <div style="margin-top:12px;">
                <div class="form-group" style="margin-bottom:12px;">
                    <label>Current Password</label>
                    <input type="password" id="settings-current-pwd" class="form-control" placeholder="Enter current password">
                </div>
                <div class="form-group" style="margin-bottom:12px;">
                    <label>New Password</label>
                    <input type="password" id="settings-new-pwd" class="form-control" placeholder="Min 8 characters">
                </div>
                <div class="form-group" style="margin-bottom:16px;">
                    <label>Confirm New Password</label>
                    <input type="password" id="settings-confirm-pwd" class="form-control" placeholder="Re-enter new password">
                </div>
                <button class="btn primary" onclick="(async()=>{ await app.selfChangePassword(); })()">
                    <i class="fas fa-save"></i> Update Password
                </button>
            </div>
        </div>

        <!-- ========== Push Notifications ========== -->
        <div class="performance-card" style="margin-top:24px;">
            <h4><i class="fas fa-bell"></i> Phone Push Notifications</h4>
            <p style="color:var(--gray-500); font-size:13px; margin:8px 0 12px;">
                Get a notification on your phone whenever a new calendar activity is added.
                To receive notifications on iPhone or Android, open this site in your mobile browser,
                tap <strong>Share → Add to Home Screen</strong>, then enable notifications below.
                <span id="notif-ios-hint" style="display:block; margin-top:4px; color:var(--warning);">
                    iOS 16.4 or newer is required.
                </span>
            </p>
            <div id="notif-status-box" style="background:var(--gray-100); border-radius:8px; padding:12px; margin-bottom:12px;">
                <div class="stat-row"><span class="stat-label">Browser support:</span><span class="stat-value" id="notif-support">—</span></div>
                <div class="stat-row"><span class="stat-label">Permission:</span><span class="stat-value" id="notif-permission">—</span></div>
                <div class="stat-row"><span class="stat-label">Subscribed:</span><span class="stat-value" id="notif-subscribed">—</span></div>
            </div>
            <div style="display:flex; gap:8px; flex-wrap:wrap;">
                <button id="notif-enable-btn" class="btn primary" onclick="(async()=>{ await app.enablePushNotifications(); })()">
                    <i class="fas fa-bell"></i> Enable Notifications
                </button>
                <button id="notif-disable-btn" class="btn secondary" onclick="(async()=>{ await app.disablePushNotifications(); })()" style="display:none;">
                    <i class="fas fa-bell-slash"></i> Disable
                </button>
                <button class="btn secondary" onclick="(async()=>{ await app.sendTestPushNotification(); })()">
                    <i class="fas fa-paper-plane"></i> Send Test
                </button>
            </div>

            <!-- Reminder timing preferences -->
            <div style="margin-top:20px; border-top:1px solid var(--gray-200); padding-top:16px;">
                <h5 style="margin:0 0 4px; font-size:14px; font-weight:600;">Reminder Timing</h5>
                <p style="color:var(--gray-500); font-size:12px; margin:0 0 12px;">
                    How far in advance do you want to be reminded? Choose one or more.
                </p>
                <div style="display:flex; flex-direction:column; gap:8px; margin-bottom:12px;">
                    <label style="display:flex; align-items:center; gap:8px; font-size:14px; cursor:pointer;">
                        <input type="checkbox" id="reminder-1440" value="1440" onchange="app.onReminderCheckboxChange()">
                        <span>1 day before</span>
                    </label>
                    <label style="display:flex; align-items:center; gap:8px; font-size:14px; cursor:pointer;">
                        <input type="checkbox" id="reminder-60" value="60" onchange="app.onReminderCheckboxChange()">
                        <span>1 hour before</span>
                    </label>
                    <label style="display:flex; align-items:center; gap:8px; font-size:14px; cursor:pointer;">
                        <input type="checkbox" id="reminder-15" value="15" onchange="app.onReminderCheckboxChange()">
                        <span>15 minutes before</span>
                    </label>
                    <label style="display:flex; align-items:center; gap:8px; font-size:14px; cursor:pointer;">
                        <input type="checkbox" id="reminder-10" value="10" onchange="app.onReminderCheckboxChange()">
                        <span>10 minutes before</span>
                    </label>
                </div>
                <label style="display:flex; align-items:center; gap:8px; font-size:14px; cursor:pointer; margin-bottom:14px;">
                    <input type="checkbox" id="reminder-daily-summary" onchange="app.onReminderCheckboxChange()">
                    <span>Daily summary at 10:00 AM (today's events)</span>
                </label>
                <button id="notif-prefs-save-btn" class="btn primary" style="display:none;" onclick="(async()=>{ await app.saveNotificationPreferences(); })()">
                    <i class="fas fa-save"></i> Save Reminder Preferences
                </button>
                <span id="notif-prefs-saved" style="display:none; color:var(--success); font-size:13px; margin-left:8px;">
                    <i class="fas fa-check"></i> Saved
                </span>
            </div>
        </div>

        ${isSystemAdmin(_currentUser) ? `
        <!-- ========== Data Quality (Super Admin only) ========== -->
        <div class="performance-card" style="margin-top:24px;">
            <h4><i class="fas fa-broom"></i> Data Quality</h4>
            <p style="color:var(--gray-500); font-size:13px; margin:8px 0 12px;">
                Review prospects that share the same phone number. Family
                members often legitimately share a phone; obvious duplicates
                should be merged before a DB-level unique constraint is
                enforced.
            </p>
            <button class="btn primary" onclick="(async()=>{ await app.showPhoneDupesModal(); })()">
                <i class="fas fa-search"></i> Review Contact Duplicates
            </button>
        </div>
        ` : ''}
    </div>`;

    // Populate push notification status asynchronously
    const refreshPushNotificationStatus = async () => {
        const _cu = window._appState?.cu;
        const supEl  = document.getElementById('notif-support');
        const permEl = document.getElementById('notif-permission');
        const subEl  = document.getElementById('notif-subscribed');
        const enableBtn  = document.getElementById('notif-enable-btn');
        const disableBtn = document.getElementById('notif-disable-btn');
        if (!supEl || !permEl || !subEl) return;

        if (!window.PushNotif) {
            supEl.textContent = 'Not loaded';
            permEl.textContent = '—';
            subEl.textContent = '—';
            return;
        }
        try {
            const s = await window.PushNotif.getStatus();
            supEl.textContent = s.supported ? 'Yes' : 'No (use a modern browser)';
            permEl.textContent = s.permission || 'default';
            subEl.textContent = s.subscribed ? 'Yes' : 'No';
            if (enableBtn && disableBtn) {
                enableBtn.style.display = s.subscribed ? 'none' : '';
                disableBtn.style.display = s.subscribed ? '' : 'none';
            }
        } catch (e) {
            supEl.textContent = 'Error: ' + (e.message || e);
        }
        // Load reminder preferences into checkboxes
        if (!_cu?.id) return;
        try {
            const { data } = await window.supabase
                .from('notification_preferences')
                .select('reminder_minutes,daily_summary')
                .eq('user_id', _cu.id)
                .maybeSingle();
            const minutes = (data && data.reminder_minutes) ? data.reminder_minutes : [15];
            const dailySummary = data ? !!data.daily_summary : true;
            [1440, 60, 15, 10].forEach(m => {
                const el = document.getElementById(`reminder-${m}`);
                if (el) el.checked = minutes.includes(m);
            });
            const dsel = document.getElementById('reminder-daily-summary');
            if (dsel) dsel.checked = dailySummary;
        } catch (e) {
            console.warn('[Prefs] load failed:', e);
        }
    };

    setTimeout(() => refreshPushNotificationStatus(), 50);
};

// ══════════════ showPipelineView ══════════════
// allSolutions: optional pre-fetched array to avoid N+1 in bulk calcs
window._fv = window._fv || {};
window._fv._pipelineAgentFilter = window._fv._pipelineAgentFilter ?? 'all';
window._fv._pipelineStatusFilter = window._fv._pipelineStatusFilter ?? 'all';
window._fv._focusViewMonth = window._fv._focusViewMonth ?? 'current'; // 'current' or 'YYYY-MM' for viewing archived month

window._fv.showPipelineView = async (container) => {
    const _currentUser = window._appState?.cu;
    const { escapeHtml } = window._crmUtils || {};

    // allSolutions: optional pre-fetched array to avoid N+1 in bulk calcs
    const getPipelineAmount = async (prospect, category, allSolutions) => {
        let solutions;
        if (allSolutions) {
            solutions = allSolutions.filter(s => String(s.prospect_id) === String(prospect.id));
        } else {
            solutions = await window.AppDataStore.query('proposed_solutions', { prospect_id: prospect.id });
        }
        if (solutions.length > 0 && solutions[0].amount) return solutions[0].amount;
        if (prospect.estimated_value_max) return prospect.estimated_value_max;
        if (prospect.estimated_value_min) return prospect.estimated_value_min;
        // v6: default_amount may be null (e.g. agent_package) → caller decides how to render
        if (category?.default_amount != null) return category.default_amount;
        if (category?.defaultAmount != null) return category.defaultAmount; // legacy fallback
        return null;
    };

    // Local references to module-level filter state stored on window._fv
    // These are read/written via window._fv so they persist across re-renders
    // and are accessible to setPipelineFilter / switchFocusMonth helpers.

    const userId = _currentUser?.id || 5;
    runHuiJiMigration(); // fire-and-forget

    // ── STEP 1: Paint skeleton immediately so the page feels alive ────────
    // Same philosophy as Facebook/IG: show structure first, fill data after.
    const _skelR = (cols) => `<tr>${Array.from({length:cols},(_,i)=>`<td style="padding:10px 12px;"><div class="skeleton" style="height:14px;border-radius:4px;width:${[72,88,48,44,82,58,40][i%7]}%;"></div></td>`).join('')}</tr>`;
    const _skelRows = (n, cols) => Array(n).fill(0).map(()=>_skelR(cols)).join('');
    const _skelCard = (h=80) => `<div class="skeleton" style="border-radius:8px;height:${h}px;margin-bottom:12px;"></div>`;

    container.innerHTML = `
<div class="pipeline-dual-view">
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:24px;">
        <div>
            <h1 style="font-size:24px;font-weight:700;margin:0;">Potential Pipeline Management</h1>
            <p style="color:#6B7280;margin-top:4px;">Track signing probability across 6 solution categories</p>
        </div>
        <div id="pl-header-controls" style="display:flex;gap:12px;align-items:center;">
            <div class="skeleton" style="width:160px;height:38px;border-radius:6px;"></div>
            <div class="skeleton" style="width:140px;height:38px;border-radius:6px;"></div>
            <button class="btn secondary" disabled><i class="fas fa-sync-alt"></i> Refresh</button>
            <button class="btn primary" disabled><i class="fas fa-info-circle"></i> Rules</button>
        </div>
    </div>
    <div id="pl-action-plan">
        <div style="background:white;border-radius:12px;padding:20px;box-shadow:0 1px 3px rgba(0,0,0,0.1);margin-bottom:32px;">
            ${_skelCard(28)}${_skelCard(60)}${_skelCard(120)}
        </div>
    </div>
    <div id="pl-focus-section">
        <div style="background:white;border-radius:12px;padding:20px;box-shadow:0 1px 3px rgba(0,0,0,0.1);margin-bottom:32px;">
            ${_skelCard(28)}<div style="overflow-x:auto;"><table style="width:100%;border-collapse:collapse;min-width:1080px;"><tbody>${_skelRows(4,7)}</tbody></table></div>
        </div>
    </div>
    <div style="background:white;border-radius:12px;box-shadow:0 1px 3px rgba(0,0,0,0.1);padding:20px;">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
            <div style="display:flex;align-items:center;gap:12px;">
                <h2 style="font-size:18px;font-weight:600;margin:0;">📊 Auto-Generated Pipeline</h2>
                <span id="pl-table2-count"><div class="skeleton" style="display:inline-block;width:90px;height:22px;border-radius:20px;vertical-align:middle;"></div></span>
            </div>
            <p style="font-size:11px;color:#9CA3AF;margin:0;">Sorted: highest probability → most recent activity → name</p>
        </div>
        <div style="overflow-x:auto;">
            <table style="width:100%;border-collapse:collapse;min-width:1080px;">
                <thead>
                    <tr style="background:#F9FAFB;border-bottom:2px solid #E5E7EB;">
                        <th scope="col" style="padding:10px 12px;text-align:left;font-size:12px;color:#6B7280;">Prospect Name</th>
                        <th scope="col" style="padding:10px 12px;text-align:left;font-size:12px;color:#6B7280;">Target to Sign (Product/Service)</th>
                        <th scope="col" style="padding:10px 12px;text-align:left;font-size:12px;color:#6B7280;">Amount (RM)</th>
                        <th scope="col" style="padding:10px 12px;text-align:left;font-size:12px;color:#6B7280;">Probability</th>
                        <th scope="col" style="padding:10px 12px;text-align:left;font-size:12px;color:#6B7280;">Action Needed to Close Deal</th>
                        <th scope="col" style="padding:10px 12px;text-align:left;font-size:12px;color:#6B7280;">Quick Action</th>
                    </tr>
                </thead>
                <tbody id="pipeline-list-body">${_skelRows(6,6)}</tbody>
            </table>
        </div>
    </div>
</div>`;

    // ── STEP 2: Fire ALL big queries in parallel ──────────────────────────
    // Each query gets a 15s timeout so a slow Supabase call no longer
    // leaves the page on a permanent skeleton. On timeout we render with
    // empty data and the user can hit Refresh to retry.
    const [allActivities, allProspects, allUsers] = await Promise.all([
        withTimeout(getVisibleActivities(), 15000, [], 'pipeline:getVisibleActivities'),
        withTimeout(getVisibleProspects(), 15000, [], 'pipeline:getVisibleProspects'),
        withTimeout(window.AppDataStore.getAll('users'), 15000, [], 'pipeline:getAll(users)'),
        withTimeout(loadPipelineConfig(), 15000, null, 'pipeline:loadPipelineConfig'), // warms cache
    ]);

    const agents = (allUsers || []).filter(u => isAgent(u) || u.role === 'team_leader' || u.role?.includes('Level 7'));

    // Fill header controls as soon as agents are available
    const _plHdrCtrl = document.getElementById('pl-header-controls');
    if (_plHdrCtrl) {
        _plHdrCtrl.innerHTML = `
        <select class="form-control" style="width:160px;height:38px;" onchange="app.setPipelineFilter('agent', this.value)">
            <option value="all">All Agents</option>
            ${agents.map(a => `<option value="${a.id}" ${window._fv._pipelineAgentFilter == a.id ? 'selected' : ''}>${escapeHtml(a.full_name)}</option>`).join('')}
        </select>
        <select class="form-control" style="width:140px;height:38px;" onchange="(async () => { await app.setPipelineFilter('status', this.value); })()">
            <option value="all">All Status</option>
            <option value="prospect" ${window._fv._pipelineStatusFilter === 'prospect' ? 'selected' : ''}>Prospect</option>
            <option value="active" ${window._fv._pipelineStatusFilter === 'active' ? 'selected' : ''}>Active</option>
            <option value="warm" ${window._fv._pipelineStatusFilter === 'warm' ? 'selected' : ''}>Warm</option>
            <option value="hot" ${window._fv._pipelineStatusFilter === 'hot' ? 'selected' : ''}>Hot</option>
        </select>
        <button class="btn secondary" onclick="app.refreshPipeline()"><i class="fas fa-sync-alt"></i> Refresh</button>
        <button class="btn primary" onclick="app.openPipelineConfigModal()"><i class="fas fa-info-circle"></i> Rules</button>`;
    }

    // Filter prospects
    let prospects = allProspects ? [...allProspects] : [];
    // Warn if data failed to load (timeout / stale SWR cache) — guide user to Refresh
    if (prospects.length === 0 && (allActivities || []).length === 0) {
        console.warn('[Pipeline] Both prospects and activities returned empty — possible stale cache. Click Refresh.');
        window.UI.toast.error('Pipeline data could not load. Click <strong>Refresh</strong> to retry.', { duration: 6000 });
    }
    if (window._fv._pipelineAgentFilter !== 'all') prospects = prospects.filter(p => p.responsible_agent_id == window._fv._pipelineAgentFilter);
    if (window._fv._pipelineStatusFilter !== 'all') prospects = prospects.filter(p => p.status === window._fv._pipelineStatusFilter);
    const activeProspects = prospects.filter(p => p.status !== 'converted' && p.status !== 'lost' && !p.unable_to_serve);

    // ── STEP 3: Fast queries (action plan + archive + focus) in parallel ──
    const _focusCurrentMonth = new Date().toISOString().slice(0, 7);
    const _focusMonthLabel = new Date().toLocaleString('default', { month: 'long', year: 'numeric' });
    const _apCurrentMonth = _focusCurrentMonth + '-01';
    const _apMonthLabel = _focusMonthLabel;

    const [_allMyFocusItemsRaw, _apPlanListRaw, _archiveItems] = await Promise.all([
        window.AppDataStore.query('my_potential_list', { user_id: userId }).catch(() => []),
        window.AppDataStore.query('action_plans', { user_id: userId, month_year: _apCurrentMonth }).catch(() => []),
        window.AppDataStore.query('monthly_focus_archive', { user_id: userId }).catch(() => []),
    ]);

    // Tag legacy items (no focus_month) — fire-and-forget, don't block paint
    let _allMyFocusItems = [..._allMyFocusItemsRaw];
    const _legacyItems = _allMyFocusItemsRaw.filter(i => !i.focus_month);
    if (_legacyItems.length > 0) {
        Promise.all(_legacyItems.map(item =>
            window.AppDataStore.update('my_potential_list', item.id, { focus_month: _focusCurrentMonth })
                .then(() => { item.focus_month = _focusCurrentMonth; }).catch(() => {})
        ));
    }
    // Archive expired items — fire-and-forget
    const _expiredFocusItems = _allMyFocusItems.filter(i => i.focus_month && i.focus_month < _focusCurrentMonth);
    if (_expiredFocusItems.length > 0) {
        (async () => {
            let archived = 0;
            for (const item of _expiredFocusItems) {
                try {
                    const ep = await window.AppDataStore.getById('prospects', item.prospect_id);
                    if (!ep) { await window.AppDataStore.delete('my_potential_list', item.id); continue; }
                    const eActs = (allActivities || []).filter(a => a.prospect_id === ep.id);
                    const eEntry = await calcPipelineEntry(ep, eActs);
                    const eAmt = await getPipelineAmount(ep, eEntry.category);
                    const existing = await window.AppDataStore.query('monthly_focus_archive', { user_id: userId, month: item.focus_month, prospect_id: item.prospect_id });
                    if (existing.length === 0) {
                        await window.AppDataStore.create('monthly_focus_archive', {
                            user_id: userId, month: item.focus_month, prospect_id: item.prospect_id,
                            priority_order: item.priority_order,
                            target_product: item.target_product || eEntry.latestOppPotential || eEntry.category?.name || '',
                            amount: eAmt, probability: String(eEntry.probability || 0),
                            action_needed: eEntry.latestNextAction || ''
                        });
                    }
                    await window.AppDataStore.delete('my_potential_list', item.id);
                    archived++;
                } catch(e) {}
            }
            if (archived > 0) window.UI.toast.info(`${archived} expired focus item(s) archived from last month.`);
        })();
        _allMyFocusItems = _allMyFocusItems.filter(i => !_expiredFocusItems.includes(i));
    }

    const _archiveMonths = [...new Set(_archiveItems.map(a => a.month))].sort().reverse();
    const _isArchiveView = window._fv._focusViewMonth !== 'current';

    // ── STEP 4: Fetch action plan items + render action plan card ─────────
    const _activePlan = _apPlanListRaw[0] || null;
    let _apItems = [], _apChecks = [];
    if (_activePlan) {
        try {
            const _today = new Date();
            const _diff = (_today.getDay() === 0 ? 6 : _today.getDay() - 1);
            const _monday = new Date(_today);
            _monday.setDate(_today.getDate() - _diff);
            const _mondayStr = _monday.toISOString().slice(0,10);
            [_apItems, _apChecks] = await Promise.all([
                window.AppDataStore.query('action_plan_items', { plan_id: _activePlan.id }),
                window.AppDataStore.query('action_plan_checks', { plan_id: _activePlan.id, check_date: _mondayStr }),
            ]);
            _apItems.sort((a,b) => (a.display_order||0) - (b.display_order||0));
        } catch(e) { /* offline fallback */ }
    }

    // Fill action plan section — users see this before the slow table loads
    const _plActionPlan = document.getElementById('pl-action-plan');
    if (_plActionPlan) {
        _plActionPlan.outerHTML = `
<div id="pl-action-plan" class="action-plan-section" style="margin-bottom:32px;background:white;border-radius:12px;padding:20px;box-shadow:0 1px 3px rgba(0,0,0,0.1);">
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;">
        <div>
            <h2 style="font-size:18px;font-weight:600;margin:0;">📋 Action Plan — ${_apMonthLabel}</h2>
            ${_activePlan ? `<span style="background:#d1fae5;color:#065f46;padding:2px 10px;border-radius:12px;font-size:11px;font-weight:600;margin-top:4px;display:inline-block;">${(_activePlan.status||'active').toUpperCase()}</span>` : ''}
        </div>
        <div style="display:flex;gap:8px;">
            <button class="btn secondary btn-sm" onclick="app.showActionPlanHistory()">View History</button>
            <button class="btn primary btn-sm" onclick="app.openActionPlanModal()">${_activePlan ? 'Edit Plan' : 'Create Plan'}</button>
        </div>
    </div>
    ${_activePlan ? `
        <div style="background:#f0fdf4;padding:12px;border-radius:8px;margin-bottom:20px;">
            <strong>🎯 Main Target:</strong> RM ${(_activePlan.main_target||0).toLocaleString()}
        </div>
        <div style="overflow-x:auto;">
            <table class="plan-items-table" style="width:100%;border-collapse:collapse;">
                <thead>
                    <tr style="background:#f9fafb;border-bottom:2px solid #e5e7eb;">
                        <th scope="col" style="padding:10px 12px;text-align:left;font-size:12px;color:#6B7280;">Event Name</th>
                        <th scope="col" style="padding:10px 12px;text-align:left;font-size:12px;color:#6B7280;">Objective</th>
                        <th scope="col" style="padding:10px 12px;text-align:left;font-size:12px;color:#6B7280;">Target</th>
                        <th scope="col" style="padding:10px 12px;text-align:left;font-size:12px;color:#6B7280;">Due Date</th>
                        <th scope="col" style="padding:10px 12px;text-align:left;font-size:12px;color:#6B7280;">This Week</th>
                        <th scope="col" style="padding:10px 12px;text-align:left;font-size:12px;color:#6B7280;">Remarks</th>
                    </tr>
                </thead>
                <tbody>
                    ${_apItems.length ? _apItems.map(item => {
                        const chk = _apChecks.find(c => c.item_id === item.id);
                        const done = chk?.is_done || false;
                        return `<tr style="border-bottom:1px solid #e5e7eb;">
                            <td style="padding:10px 12px;">${escapeHtml(item.event_name)}</td>
                            <td style="padding:10px 12px;">${escapeHtml(item.objective||'')}</td>
                            <td style="padding:10px 12px;">${escapeHtml(item.target_to_achieve||'')}</td>
                            <td style="padding:10px 12px;">${item.when_to_achieve||'-'}</td>
                            <td style="padding:10px 12px;">
                                <label style="display:flex;align-items:center;gap:6px;cursor:pointer;">
                                    <input type="checkbox" class="plan-checkbox" ${done?'checked':''} onchange="app.updatePlanCheck(${_activePlan.id},${item.id},this.checked)">
                                    ${done ? '<span style="color:#059669;font-weight:600;">✅ Done</span>' : '<span style="color:#9ca3af;">⏳ Pending</span>'}
                                </label>
                            </td>
                            <td style="padding:10px 12px;">${escapeHtml(item.remarks||'')}</td>
                        </tr>`;
                    }).join('') : `<tr><td colspan="6" style="padding:24px;text-align:center;color:#9ca3af;">No items added yet. Click "Edit Plan" to add items.</td></tr>`}
                </tbody>
            </table>
        </div>
        <div class="weekly-reminder" style="margin-top:16px;padding:12px;background:#fef3c7;border-radius:8px;display:flex;justify-content:space-between;align-items:center;">
            <span><i class="fas fa-bell"></i> Weekly check every Monday — mark completed items above.</span>
            <button class="btn secondary btn-sm" onclick="app.sendPlanReminder()">Send Reminder</button>
        </div>
    ` : `
        <div style="text-align:center;padding:40px;color:#9ca3af;">
            <i class="fas fa-clipboard-list" style="font-size:40px;margin-bottom:16px;display:block;"></i>
            <p>No action plan for this month. Click <strong>"Create Plan"</strong> to get started.</p>
        </div>
    `}
</div>`;
    }

    // ── STEP 5: Build focus list (medium speed) ───────────────────────────
    let focusList;
    if (_isArchiveView) {
        focusList = _archiveItems
            .filter(a => a.month === window._fv._focusViewMonth)
            .sort((a, b) => (a.priority_order || 0) - (b.priority_order || 0));
    } else {
        focusList = _allMyFocusItems
            .filter(rec => activeProspects.some(p => p.id == rec.prospect_id))
            .sort((a, b) => a.priority_order - b.priority_order);
    }

    const probBadge = (prob, prospectId) => {
        const color = prob >= 80 ? '#DC2626' : prob >= 60 ? '#F59E0B' : '#6B7280';
        const label = prob >= 80 ? '🔥 HOT' : prob >= 50 ? '⚡ WARM' : '❄️ COLD';
        const clickable = prospectId != null ? `onclick="event.stopPropagation();app.showPipelineExplain(${prospectId})" style="cursor:pointer;" title="Click to see score breakdown"` : '';
        return `<span ${clickable}><span style="background:${color};color:white;padding:2px 8px;border-radius:12px;font-size:11px;font-weight:600;">${label}</span><strong style="margin-left:6px;">${prob}%</strong></span>`;
    };

    const focusRows = _isArchiveView
        ? (await Promise.all(focusList.map((arc, idx) => renderArchiveFocusRow(arc, idx)))).join('')
        : (await Promise.all(focusList.map((rec, idx) => renderFocusRow(rec, idx, allActivities, probBadge, false, _plPrefetched)))).join('');

    // Fill focus section — visible before expensive table 2 loads
    const _plFocusSection = document.getElementById('pl-focus-section');
    if (_plFocusSection) {
        _plFocusSection.outerHTML = `
<div id="pl-focus-section" style="margin-bottom:32px;background:white;border-radius:12px;box-shadow:0 1px 3px rgba(0,0,0,0.1);padding:20px;">
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;flex-wrap:wrap;gap:8px;">
        <div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap;">
            <h2 style="font-size:18px;font-weight:600;margin:0;">🔥 MONTH FOCUS — My Priority List</h2>
            <span style="background:#F3F4F6;padding:4px 12px;border-radius:20px;font-size:12px;font-weight:600;">${focusList.length} prospects</span>
            <select onchange="app.switchFocusMonth(this.value)" style="border:1px solid #D1D5DB;border-radius:6px;padding:4px 10px;font-size:12px;color:#374151;cursor:pointer;">
                <option value="current" ${window._fv._focusViewMonth === 'current' ? 'selected' : ''}>${_focusMonthLabel} (Current)</option>
                ${_archiveMonths.map(m => {
                    const ml = new Date(m + '-01').toLocaleString('default', { month: 'long', year: 'numeric' });
                    return '<option value="' + m + '" ' + (window._fv._focusViewMonth === m ? 'selected' : '') + '>' + ml + '</option>';
                }).join('')}
            </select>
        </div>
        <div style="display:flex;gap:8px;align-items:center;">
            <button class="btn secondary btn-sm" onclick="app.openExpiredSearchModal()" title="Browse expired &amp; available prospects"><i class="fas fa-search"></i> Browse Past</button>
            ${!_isArchiveView ? '<button class="btn-icon" onclick="app.saveManualOrder()" title="Save Order"><i class="fas fa-save"></i></button>' : ''}
        </div>
    </div>
    ${_isArchiveView
        ? '<div style="background:#FEF3C7;padding:8px 16px;border-radius:8px;margin-bottom:12px;font-size:12px;color:#92400E;"><i class="fas fa-archive" style="margin-right:4px;"></i> Viewing archived month (read-only). Use "Browse Past" to re-add prospects to current month.</div>'
        : '<p style="font-size:12px;color:#9CA3AF;margin-bottom:16px;"><i class="fas fa-arrows-alt" style="margin-right:4px;"></i> Drag ☰ to reorder priority • Add prospects from Table 2 below</p>'}
    <div style="overflow-x:auto;">
        <table style="width:100%;border-collapse:collapse;min-width:1080px;">
            <thead>
                <tr style="background:#F9FAFB;border-bottom:2px solid #E5E7EB;">
                    <th scope="col" style="padding:10px 12px;text-align:left;font-size:12px;color:#6B7280;width:50px;">#</th>
                    <th scope="col" style="padding:10px 12px;text-align:left;font-size:12px;color:#6B7280;">Prospect Name</th>
                    <th scope="col" style="padding:10px 12px;text-align:left;font-size:12px;color:#6B7280;">Target to Sign (Product/Service)</th>
                    <th scope="col" style="padding:10px 12px;text-align:left;font-size:12px;color:#6B7280;">Amount (RM)</th>
                    <th scope="col" style="padding:10px 12px;text-align:left;font-size:12px;color:#6B7280;">Probability</th>
                    <th scope="col" style="padding:10px 12px;text-align:left;font-size:12px;color:#6B7280;">Action Needed to Close Deal</th>
                    <th scope="col" style="padding:10px 12px;text-align:left;font-size:12px;color:#6B7280;">Actions</th>
                </tr>
            </thead>
            <tbody id="focus-list-body">
                ${focusRows || '<tr><td colspan="7" style="padding:32px;text-align:center;color:#9CA3AF;">No prospects in your priority list. Add from Table 2 below.</td></tr>'}
            </tbody>
        </table>
    </div>
    <div id="pl-team-sections"></div>
</div>`;
    }

    // ── STEP 6: Expensive enrichment — Table 2 tbody has skeleton, fill after ──
    // Pre-fetch relational tables once so calcPipelineEntry doesn't fire N+1 requests.
    const [_plAllReferrals, _plAllPurchases, _plAllSolutions] = await Promise.all([
        window.AppDataStore.getAll('referrals').catch(() => []),
        window.AppDataStore.getAll('purchases').catch(() => []),
        window.AppDataStore.getAll('proposed_solutions').catch(() => []),
    ]);
    const _plPrefetched = { allReferrals: _plAllReferrals, allPurchases: _plAllPurchases, allSolutions: _plAllSolutions };

    const enrichedRaw = await Promise.all(activeProspects.map(async (p) => {
        const acts = allActivities.filter(a => a.prospect_id === p.id);
        const pipeline = await calcPipelineEntry(p, acts, _plPrefetched);
        // Also qualify prospects with explicit potential data set (manual override)
        if (!pipeline.qualified && (p.close_probability > 0 || p.potential_level)) {
            const potentialProb = p.close_probability > 0
                ? p.close_probability
                : (p.potential_level === 'High' ? 70 : p.potential_level === 'Medium' ? 40 : 20);
            pipeline.qualified = true;
            pipeline.probability = potentialProb;
            pipeline.fromPotential = true;
            pipeline.potentialLevel = p.potential_level;
            if (!pipeline.action || pipeline.action.startsWith('Complete prerequisite') || pipeline.action.startsWith('Book CPS')) {
                pipeline.action = `Potential: <strong>${p.potential_level || 'Set'}</strong> – follow up to advance to close`;
            }
        }
        return { ...p, _pipeline: pipeline };
    }));

    const enriched = enrichedRaw
        .filter(p => p._pipeline.qualified)
        .sort((a, b) => {
            if (b._pipeline.probability !== a._pipeline.probability) return b._pipeline.probability - a._pipeline.probability;
            const da = a._pipeline.lastActivityDate ? a._pipeline.lastActivityDate.getTime() : 0;
            const db = b._pipeline.lastActivityDate ? b._pipeline.lastActivityDate.getTime() : 0;
            if (db !== da) return db - da;
            return (a.name || a.full_name || '').localeCompare(b.name || b.full_name || '');
        });

    const systemRows = (await Promise.all(enriched.map(p => renderSystemRow(p, probBadge, _plPrefetched)))).join('');

    // Fill table 2 — replaces skeleton rows
    const _tbody2 = document.getElementById('pipeline-list-body');
    if (_tbody2) {
        _tbody2.innerHTML = systemRows || '<tr><td colspan="6" style="padding:32px;text-align:center;color:#9CA3AF;">No qualified prospects found. Complete prerequisites for any category to appear here.</td></tr>';
    }
    const _countEl = document.getElementById('pl-table2-count');
    if (_countEl) {
        _countEl.innerHTML = `<span style="background:#F3F4F6;padding:4px 12px;border-radius:20px;font-size:12px;font-weight:600;">${enriched.length} qualified</span>`;
    }

    // ── STEP 7: Team sections (uses enriched + allUsers, fill last) ────────
    if (isTeamLeaderOrAbove(_currentUser) && !_isArchiveView) {
        const _visIds = await getVisibleUserIds(_currentUser);
        let _subUsers;
        if (_visIds === 'all') {
            _subUsers = allUsers.filter(u => u.id !== userId && (isAgent(u) || isTeamLeaderOrAbove(u)));
        } else {
            _subUsers = allUsers.filter(u => _visIds.includes(u.id) && u.id !== userId);
        }
        let _teamAgentSections = '';
        let agentCount = 0;
        for (const sub of _subUsers) {
            if (agentCount >= 30) break;
            const subFocus = (await window.AppDataStore.query('my_potential_list', { user_id: sub.id }))
                .filter(rec => activeProspects.some(p => p.id == rec.prospect_id))
                .sort((a, b) => a.priority_order - b.priority_order);
            if (subFocus.length === 0) continue;
            agentCount++;
            const subRows = (await Promise.all(subFocus.map((rec, idx) => renderFocusRow(rec, idx, allActivities, probBadge, true, _plPrefetched)))).join('');
            _teamAgentSections += `
                <div style="margin-top:12px;">
                    <div onclick="app.toggleAgentFocusSection(this)" style="cursor:pointer;display:flex;align-items:center;gap:8px;padding:12px 16px;background:#F0F4FF;border-radius:8px;border:1px solid #DBEAFE;user-select:none;">
                        <span class="agent-collapse-icon" style="transition:transform 0.2s;font-size:14px;">▸</span>
                        <strong style="font-size:14px;">${escapeHtml(sub.full_name || sub.username || 'Agent')}</strong>
                        <span style="background:#E0E7FF;padding:2px 10px;border-radius:12px;font-size:11px;font-weight:600;color:#3730A3;">${subFocus.length} prospects</span>
                    </div>
                    <div class="agent-focus-body" style="display:none;padding:8px 0;overflow-x:auto;">
                        <table style="width:100%;border-collapse:collapse;min-width:1080px;">
                            <thead>
                                <tr style="background:#F9FAFB;border-bottom:2px solid #E5E7EB;">
                                    <th scope="col" style="padding:10px 12px;text-align:left;font-size:12px;color:#6B7280;width:50px;">#</th>
                                    <th scope="col" style="padding:10px 12px;text-align:left;font-size:12px;color:#6B7280;">Prospect Name</th>
                                    <th scope="col" style="padding:10px 12px;text-align:left;font-size:12px;color:#6B7280;">Target to Sign</th>
                                    <th scope="col" style="padding:10px 12px;text-align:left;font-size:12px;color:#6B7280;">Amount (RM)</th>
                                    <th scope="col" style="padding:10px 12px;text-align:left;font-size:12px;color:#6B7280;">Probability</th>
                                    <th scope="col" style="padding:10px 12px;text-align:left;font-size:12px;color:#6B7280;">Action Needed</th>
                                    <th scope="col" style="padding:10px 12px;text-align:left;font-size:12px;color:#6B7280;">Actions</th>
                                </tr>
                            </thead>
                            <tbody>${subRows}</tbody>
                        </table>
                    </div>
                </div>`;
        }
        const _plTeamSections = document.getElementById('pl-team-sections');
        if (_plTeamSections && _teamAgentSections) {
            _plTeamSections.innerHTML = `
                <div style="margin-top:16px;border-top:2px solid #E5E7EB;padding-top:16px;">
                    <h3 style="font-size:15px;font-weight:600;color:#374151;margin-bottom:8px;"><i class="fas fa-users" style="margin-right:6px;color:#6366F1;"></i> Team Agents Focus Lists</h3>
                    <p style="font-size:11px;color:#9CA3AF;margin-bottom:8px;">Click agent name to expand/collapse their focus list</p>
                    ${_teamAgentSections}
                </div>`;
        }
    }
};

// ══════════════ showMarketingListsView ══════════════
window._fv.showMarketingListsView = async (container) => {
    const _currentUser = window._appState?.cu;
    const { isSystemAdmin, isMarketingManager, escapeHtml } = window._crmUtils || {};
    const _getUserLevelLocal = (user) => {
        if (!user?.role) return 99;
        const m = String(user.role).match(/Level\s+(\d+)\b/i);
        if (m) return parseInt(m[1], 10);
        const r = String(user.role).toLowerCase();
        if (r === 'super_admin' || r === 'admin') return 1;
        if (r === 'marketing_manager') return 2;
        if (r === 'manager') return 4;
        if (r === 'team_leader') return 5;
        if (r === 'consultant') return 7;
        if (r === 'agent') return 10;
        if (r === 'stock_take_staff' || r === 'stock_take') return 15;
        if (r === 'customer') return 13;
        if (r === 'referrer') return 14;
        const raw = String(user.role).trim();
        if (raw === '传福大使')   return 12;
        if (raw === '改命客户')   return 13;
        if (raw === '准传福大使') return 14;
        return 99;
    };
    const isTeamLeaderOrAbove = (user) => _getUserLevelLocal(user) <= 5;

    // _currentMarketingListTab lives in window._appState.mlt (readable/writable)
    const _getTab = () => window._appState.mlt || 'products';
    const _setTab = (v) => { window._appState.mlt = v; };

    const EVENT_CATEGORIES = [
        'Power Ring', '画作', '风水方案', '开运课程', '玄学分析',
        'Online', 'Offline', 'Workshop', 'Talk', 'Seminar', 'Webinar',
        'Consultation', 'Reading', 'Product Launch', 'Networking'
    ];

    const parseEventCategories = (raw) => {
        if (!raw) return [];
        try {
            const parsed = JSON.parse(raw);
            if (Array.isArray(parsed)) return parsed.filter(Boolean);
        } catch (_) {}
        if (typeof raw === 'string' && raw.trim()) return raw.split(',').map(s => s.trim()).filter(Boolean);
        return [];
    };

    const buildEventCategoriesField = (selected = []) => {
        const sel = new Set(selected);
        const known = new Set(EVENT_CATEGORIES);
        const othersArr = selected.filter(c => !known.has(c));
        const hasOthers = othersArr.length > 0;
        const othersText = othersArr.join(', ');
        const items = EVENT_CATEGORIES.map((cat) => `
            <label style="display:flex;align-items:center;gap:6px;padding:6px 8px;border:1px solid var(--gray-200);border-radius:6px;background:#fff;cursor:pointer;font-size:13px;">
                <input type="checkbox" class="mkt-event-category-cb" value="${cat.replace(/"/g, '&quot;')}" ${sel.has(cat) ? 'checked' : ''}>
                <span>${cat}</span>
            </label>
        `).join('');
        return `
            <div class="form-group">
                <label>Categories <small class="text-muted">(select one or more)</small></label>
                <div id="mkt-event-categories" style="display:flex;flex-wrap:wrap;gap:6px;max-height:200px;overflow-y:auto;padding:8px;border:1px solid var(--gray-200);border-radius:6px;background:var(--gray-50, #f9fafb);">
                    ${items}
                    <label style="display:flex;align-items:center;gap:6px;padding:6px 8px;border:1px solid var(--gray-200);border-radius:6px;background:#fff;cursor:pointer;font-size:13px;">
                        <input type="checkbox" id="mkt-event-cat-others-cb" ${hasOthers ? 'checked' : ''} onchange="document.getElementById('mkt-event-cat-others-input').style.display = this.checked ? 'block' : 'none'; if (this.checked) document.getElementById('mkt-event-cat-others-input').focus();">
                        <span>Others</span>
                    </label>
                </div>
                <input type="text" id="mkt-event-cat-others-input" class="form-control" placeholder="Type custom category, separate multiple with commas" value="${othersText}" style="margin-top:8px;display:${hasOthers ? 'block' : 'none'};">
            </div>
        `;
    };

    const renderSpecialProgramsTable = async () => {
        return await window.app.renderSpecialProgramsTable();
    };

    const renderPackagesTab = async () => {
        return await window.app.renderPackagesTab();
    };

    const renderMarketingListTable = async () => {
        const _currentMarketingListTab = _getTab();
        if (_currentMarketingListTab === 'special_programs') {
            return await renderSpecialProgramsTable();
        }
        let data = await window.AppDataStore.getAll(_currentMarketingListTab);
        if (_currentMarketingListTab === 'venues') {
            const seen = new Set();
            data = data.filter(v => {
                const key = (v.name || '') + '|' + (v.location || '');
                if (seen.has(key)) return false;
                seen.add(key);
                return true;
            });
            data.sort((a, b) => (a.sequence || 0) - (b.sequence || 0));
        }

        if (_currentMarketingListTab === 'products') {
            return `
                <table class="data-table">
                    <thead>
                        <tr>
                            <th scope="col" style="width:54px;">Photo</th>
                            <th scope="col" style="width:54px;">Poster</th>
                            <th scope="col">Name</th>
                            <th scope="col">Category</th>
                            <th scope="col">Functions Description</th>
                            <th scope="col">Product Description</th>
                            <th scope="col">Price (RM)</th>
                            <th scope="col">Lead Time</th>
                            <th scope="col">Dimension</th>
                            <th scope="col">Weight</th>
                            <th scope="col">Status</th>
                            <th scope="col">Actions</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${data.map(item => `
                            <tr style="${!item.is_active ? 'opacity: 0.6; background: #f9fafb;' : ''}">
                                <td style="text-align:center;">
                                    ${item.photo_url
                                        ? `<img loading="lazy" decoding="async" src="${item.photo_url}" crossorigin="anonymous" style="width:40px;height:40px;object-fit:cover;border-radius:4px;cursor:pointer;" onclick="app.viewProductImage('${item.photo_url}','Photo')" title="View photo">`
                                        : `<span style="color:var(--gray-300);font-size:18px;" title="No photo">📷</span>`}
                                </td>
                                <td style="text-align:center;">
                                    ${item.poster_url
                                        ? `<img loading="lazy" decoding="async" src="${item.poster_url}" crossorigin="anonymous" style="width:40px;height:40px;object-fit:cover;border-radius:4px;cursor:pointer;" onclick="app.viewProductImage('${item.poster_url}','Poster')" title="View poster">`
                                        : `<span style="color:var(--gray-300);font-size:18px;" title="No poster">🖼️</span>`}
                                </td>
                                <td><strong>${escapeHtml(item.name || '')}</strong><br><small class="text-muted">${escapeHtml(item.remarks || '')}</small></td>
                                <td>${escapeHtml(item.category || '-')}</td>
                                <td>${escapeHtml(item.functions_description || '-')}</td>
                                <td>${escapeHtml(item.description || '-')}</td>
                                <td>
                                    <span style="font-weight:600;">RM ${item.price || 0}</span>
                                    <button class="btn-icon" style="margin-left:4px;opacity:0.6;" onclick="app.showProductPriceHistory(${item.id})" title="Price history"><i class="fas fa-history"></i></button>
                                </td>
                                <td>${escapeHtml(item.delivery_lead_time || '-')}</td>
                                <td>${escapeHtml(item.product_dimension || '-')}</td>
                                <td>${escapeHtml(item.product_weight || '-')}</td>
                                <td>
                                    <span class="status-badge ${item.is_active ? 'status-active' : 'status-inactive'}">
                                        ${item.is_active ? 'Active' : 'Inactive'}
                                    </span>
                                </td>
                                <td>
                                    <button class="btn-icon" onclick="app.openMarketingListEditModal('${item.id}')" title="Edit"><i class="fas fa-pencil-alt"></i></button>
                                    <button class="btn-icon text-danger" onclick="app.deleteMarketingListItem('${item.id}')" title="Delete"><i class="fas fa-trash-alt"></i></button>
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
                            <th scope="col" style="min-width:160px;">Categories</th>
                            <th scope="col" style="width:54px;">Poster</th>
                            <th scope="col">Title</th>
                            <th scope="col">Price (RM)</th>
                            <th scope="col">Early Bird (RM)</th>
                            <th scope="col">Group Price (RM)</th>
                            <th scope="col">Duration</th>
                            <th scope="col">Target Group</th>
                            <th scope="col">Location</th>
                            <th scope="col">Speaker</th>
                            <th scope="col">Remarks</th>
                            <th scope="col">Status</th>
                            <th scope="col">Actions</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${data.map(item => {
                            const isActive = item.is_active || item.status === 'active' || item.status === 'Active';
                            const cats = parseEventCategories(item.categories);
                            const catsHtml = cats.length
                                ? cats.map(c => `<span style="display:inline-block;background:var(--primary-50,#fef3c7);color:var(--primary-700,#92400e);border:1px solid var(--primary-200,#fde68a);border-radius:10px;padding:2px 8px;margin:2px 2px 2px 0;font-size:11px;white-space:nowrap;">${escapeHtml(c)}</span>`).join('')
                                : '<span class="text-muted">-</span>';
                            return `
                            <tr style="${!isActive ? 'opacity: 0.6; background: #f9fafb;' : ''}">
                                <td>${catsHtml}</td>
                                <td style="text-align:center;">
                                    ${item.poster_url
                                        ? `<img loading="lazy" decoding="async" src="${item.poster_url}" crossorigin="anonymous" style="width:40px;height:40px;object-fit:cover;border-radius:4px;cursor:pointer;" onclick="app.viewProductImage('${item.poster_url}','Poster')" title="View poster">`
                                        : `<span style="color:var(--gray-300);font-size:18px;" title="No poster">🖼️</span>`}
                                </td>
                                <td><strong>${escapeHtml(item.event_title || item.title || '')}</strong><br><small class="text-muted">${escapeHtml(item.description || '')}</small></td>
                                <td>${item.ticket_price || '-'}</td>
                                <td>${item.early_bird_price || '-'}</td>
                                <td>${item.group_purchase_price || '-'}</td>
                                <td>${escapeHtml(item.duration || '-')}</td>
                                <td>${escapeHtml(item.target_group || '-')}</td>
                                <td>${escapeHtml(item.location || '-')}</td>
                                <td>${escapeHtml(item.speaker || '-')}</td>
                                <td>${escapeHtml(item.remarks || '-')}</td>
                                <td>
                                    <span class="status-badge ${isActive ? 'status-active' : 'status-inactive'}">
                                        ${isActive ? 'Active' : 'Inactive'}
                                    </span>
                                </td>
                                <td>
                                    <button class="btn-icon" onclick="app.openMarketingListEditModal('${item.id}')" title="Edit"><i class="fas fa-pencil-alt"></i></button>
                                    <button class="btn-icon text-danger" onclick="app.deleteMarketingListItem('${item.id}')" title="Delete"><i class="fas fa-trash-alt"></i></button>
                                </td>
                            </tr>
                        `}).join('')}
                    </tbody>
                </table>
            `;
        } else if (_currentMarketingListTab === 'venues') {
            const seqOptions = Array.from({length: data.length}, (_, i) => i + 1);
            return `
                <table class="data-table">
                    <thead>
                        <tr>
                            <th scope="col" style="width:60px">#</th>
                            <th scope="col">Venue Name</th>
                            <th scope="col">Location</th>
                            <th scope="col">Address</th>
                            <th scope="col">Waze</th>
                            <th scope="col">Actions</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${data.length === 0 ? '<tr><td colspan="6" style="text-align:center; color: var(--gray-400); padding: 32px;">No venues added yet.</td></tr>' : data.map((item, idx) => `
                            <tr>
                                <td>
                                    <select class="form-control" style="width:55px; padding:2px 4px; font-size:13px; text-align:center;" onchange="app.updateVenueSequence('${item.id}', this.value)" title="Drag to reorder">
                                        ${seqOptions.map(n => `<option value="${n}" ${(item.sequence || idx + 1) === n ? 'selected' : ''}>${n}</option>`).join('')}
                                    </select>
                                </td>
                                <td><strong>${escapeHtml(item.name || '')}</strong></td>
                                <td>${escapeHtml(item.location || '-')}</td>
                                <td>${escapeHtml(item.address || '-')}</td>
                                <td>${item.waze_link ? `<a href="${item.waze_link}" target="_blank" rel="noopener" style="color: var(--primary); text-decoration: none;" title="Open in Waze"><i class="fas fa-map-marker-alt"></i> Waze</a>` : '-'}</td>
                                <td>
                                    <button class="btn-icon" onclick="app.openMarketingListEditModal('${item.id}')" title="Edit"><i class="fas fa-pencil-alt"></i></button>
                                    <button class="btn-icon text-danger" onclick="app.deleteMarketingListItem('${item.id}')" title="Delete"><i class="fas fa-trash-alt"></i></button>
                                </td>
                            </tr>
                        `).join('')}
                    </tbody>
                </table>
            `;
        } else if (_currentMarketingListTab === 'bujishu') {
            return `
                <table class="data-table">
                    <thead>
                        <tr>
                            <th scope="col">Name</th>
                            <th scope="col">Category</th>
                            <th scope="col">Function</th>
                            <th scope="col">Price (RM)</th>
                            <th scope="col">Lead Time</th>
                            <th scope="col">Dimension</th>
                            <th scope="col">Weight</th>
                            <th scope="col">Status</th>
                            <th scope="col">Actions</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${data.length === 0 ? '<tr><td colspan="9" style="text-align:center; color: var(--gray-400); padding: 32px;">No Bujishu items added yet.</td></tr>' : data.map(item => `
                            <tr style="${!item.is_active ? 'opacity: 0.6; background: #f9fafb;' : ''}">
                                <td><strong>${escapeHtml(item.name || '')}</strong></td>
                                <td>${escapeHtml(item.category || '-')}</td>
                                <td>${escapeHtml(item.function_desc || '-')}</td>
                                <td>${item.price || 0}</td>
                                <td>${escapeHtml(item.delivery_lead_time || '-')}</td>
                                <td>${escapeHtml(item.product_dimension || '-')}</td>
                                <td>${escapeHtml(item.product_weight || '-')}</td>
                                <td>
                                    <span class="status-badge ${item.is_active ? 'status-active' : 'status-inactive'}">
                                        ${item.is_active ? 'Active' : 'Inactive'}
                                    </span>
                                </td>
                                <td>
                                    <button class="btn-icon" onclick="app.openMarketingListEditModal('${item.id}')" title="Edit"><i class="fas fa-pencil-alt"></i></button>
                                    <button class="btn-icon text-danger" onclick="app.deleteMarketingListItem('${item.id}')" title="Delete"><i class="fas fa-trash-alt"></i></button>
                                </td>
                            </tr>
                        `).join('')}
                    </tbody>
                </table>
            `;
        } else if (_currentMarketingListTab === 'formula') {
            return `
                <table class="data-table">
                    <thead>
                        <tr>
                            <th scope="col">Name</th>
                            <th scope="col">Category</th>
                            <th scope="col">Functions</th>
                            <th scope="col">Pills/Bottles</th>
                            <th scope="col">Dosage</th>
                            <th scope="col">Price (RM)</th>
                            <th scope="col">Lead Time</th>
                            <th scope="col">Status</th>
                            <th scope="col">Actions</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${data.length === 0 ? '<tr><td colspan="9" style="text-align:center; color: var(--gray-400); padding: 32px;">No Formula items added yet.</td></tr>' : data.map(item => {
                            const dosageHtml = (item.capsules_per_bottle && item.daily_dosage)
                                ? `<span title="Capsules per bottle · daily dosage · reminder lead"><strong>${item.capsules_per_bottle}</strong> caps · <strong>${item.daily_dosage}</strong>/day<br><small class="text-muted">${item.reminder_lead_days ?? 3}d lead · ${((item.reminder_buffer_percent ?? 0.10) * 100).toFixed(0)}% buffer</small></span>`
                                : '<span class="text-muted" style="font-size:11px;">Not configured</span>';
                            return `
                            <tr style="${!item.is_active ? 'opacity: 0.6; background: #f9fafb;' : ''}">
                                <td><strong>${escapeHtml(item.name || '')}</strong></td>
                                <td>${escapeHtml(item.category || '-')}</td>
                                <td>${escapeHtml(item.functions || '-')}</td>
                                <td>${escapeHtml(item.pills_bottles || '-')}</td>
                                <td>${dosageHtml}</td>
                                <td>${item.price || 0}</td>
                                <td>${escapeHtml(item.delivery_lead_time || '-')}</td>
                                <td>
                                    <span class="status-badge ${item.is_active ? 'status-active' : 'status-inactive'}">
                                        ${item.is_active ? 'Active' : 'Inactive'}
                                    </span>
                                </td>
                                <td>
                                    <button class="btn-icon" onclick="app.openMarketingListEditModal('${item.id}')" title="Edit"><i class="fas fa-pencil-alt"></i></button>
                                    <button class="btn-icon text-danger" onclick="app.deleteMarketingListItem('${item.id}')" title="Delete"><i class="fas fa-trash-alt"></i></button>
                                </td>
                            </tr>
                        `;}).join('')}
                    </tbody>
                </table>
            `;
        } else {
            return await renderPackagesTab();
        }
    };

    const _currentMarketingListTab = _getTab();

    container.innerHTML = `
        <div class="marketing-lists-view" style="padding: 24px;">
            <div class="view-header" style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 24px;">
                <div>
                    <h1>Product & Event Manager</h1>
                    <p class="text-muted">Manage master data for products, events, and monthly promotions.</p>
                </div>
                <div class="header-actions">
                    ${_currentMarketingListTab === 'special_programs'
                        ? (isTeamLeaderOrAbove(_currentUser)
                            ? `<button class="btn primary" onclick="app.openSpecialProgramModal()"><i class="fas fa-plus"></i> New Program</button>`
                            : '')
                        : ((_currentMarketingListTab !== 'promotions') ? `
                    <button class="btn primary" onclick="app.openMarketingListAddModal()">
                        <i class="fas fa-plus"></i> New ${{ products: 'Product', events: 'Event', venues: 'Venue' }[_currentMarketingListTab] || _currentMarketingListTab}
                    </button>` : '')}
                </div>
            </div>

            <div class="tabs-container" style="margin-bottom: 20px; border-bottom: 1px solid var(--gray-200); display: flex; gap: 20px;">
                <div class="tab-item ${_currentMarketingListTab === 'products' ? 'active' : ''}" 
                     onclick="app.switchMarketingListTab('products')" 
                     style="padding: 10px 16px; cursor: pointer; border-bottom: 2px solid ${_currentMarketingListTab === 'products' ? 'var(--primary-600)' : 'transparent'}; color: ${_currentMarketingListTab === 'products' ? 'var(--primary-600)' : 'var(--gray-600)'}; font-weight: 500;">
                    Products
                </div>
                <div class="tab-item ${_currentMarketingListTab === 'events' ? 'active' : ''}" 
                     onclick="app.switchMarketingListTab('events')" 
                     style="padding: 10px 16px; cursor: pointer; border-bottom: 2px solid ${_currentMarketingListTab === 'events' ? 'var(--primary-600)' : 'transparent'}; color: ${_currentMarketingListTab === 'events' ? 'var(--primary-600)' : 'var(--gray-600)'}; font-weight: 500;">
                    Events
                </div>
                <div class="tab-item ${_currentMarketingListTab === 'promotions' ? 'active' : ''}"
                     onclick="app.switchMarketingListTab('promotions')"
                     style="padding: 10px 16px; cursor: pointer; border-bottom: 2px solid ${_currentMarketingListTab === 'promotions' ? 'var(--primary-600)' : 'transparent'}; color: ${_currentMarketingListTab === 'promotions' ? 'var(--primary-600)' : 'var(--gray-600)'}; font-weight: 500;">
                    Promotions
                </div>
                <div class="tab-item ${_currentMarketingListTab === 'venues' ? 'active' : ''}"
                     onclick="app.switchMarketingListTab('venues')"
                     style="padding: 10px 16px; cursor: pointer; border-bottom: 2px solid ${_currentMarketingListTab === 'venues' ? 'var(--primary-600)' : 'transparent'}; color: ${_currentMarketingListTab === 'venues' ? 'var(--primary-600)' : 'var(--gray-600)'}; font-weight: 500;">
                    Venues
                </div>
                <div class="tab-item ${_currentMarketingListTab === 'bujishu' ? 'active' : ''}"
                     onclick="app.switchMarketingListTab('bujishu')"
                     style="padding: 10px 16px; cursor: pointer; border-bottom: 2px solid ${_currentMarketingListTab === 'bujishu' ? 'var(--primary-600)' : 'transparent'}; color: ${_currentMarketingListTab === 'bujishu' ? 'var(--primary-600)' : 'var(--gray-600)'}; font-weight: 500;">
                    Bujishu
                </div>
                <div class="tab-item ${_currentMarketingListTab === 'formula' ? 'active' : ''}"
                     onclick="app.switchMarketingListTab('formula')"
                     style="padding: 10px 16px; cursor: pointer; border-bottom: 2px solid ${_currentMarketingListTab === 'formula' ? 'var(--primary-600)' : 'transparent'}; color: ${_currentMarketingListTab === 'formula' ? 'var(--primary-600)' : 'var(--gray-600)'}; font-weight: 500;">
                    Formula
                </div>
                <div class="tab-item ${_currentMarketingListTab === 'special_programs' ? 'active' : ''}"
                     onclick="app.switchMarketingListTab('special_programs')"
                     style="padding: 10px 16px; cursor: pointer; border-bottom: 2px solid ${_currentMarketingListTab === 'special_programs' ? 'var(--primary-600)' : 'transparent'}; color: ${_currentMarketingListTab === 'special_programs' ? 'var(--primary-600)' : 'var(--gray-600)'}; font-weight: 500;">
                    🏆 Special Programs
                </div>
            </div>

            <div id="marketing-list-content">
                ${await renderMarketingListTable()}
            </div>
        </div>
    `;
};

// ══════════════ showMonthlyPromotionView ══════════════
window._fv.showMonthlyPromotionView = async (container) => {
    const { escapeHtml } = window._crmUtils || {};
    const today = new Date(); today.setHours(0,0,0,0);
    const allPromos = await window.AppDataStore.getAll('promotions');

    // Show active, non-expired promotions (Level 12+ cannot access this page via nav)
    const promotions = allPromos.filter(p => {
        if (p.is_active === false) return false;
        if (p.end_date) { const e = new Date(p.end_date); e.setHours(0,0,0,0); if (e < today) return false; }
        return true;
    });

    // Pre-load all products once then resolve names locally
    const _allProducts = await window.AppDataStore.getAll('products');
    const _productMap = new Map(_allProducts.map(pr => [pr.id, pr.name]));
    const promoCards = await Promise.all(promotions.map(async p => {
        const productNames = (p.product_ids || []).map(id => _productMap.get(id) || null);
        const validProductNames = productNames.filter(Boolean);

        // Discount display
        let discountHtml = '';
        if (p.original_value && p.original_value > (p.price || 0)) {
            const savePct = Math.round(((p.original_value - p.price) / p.original_value) * 100);
            discountHtml = `
                <div style="font-size:12px;color:#888;text-decoration:line-through;">RM ${parseFloat(p.original_value).toFixed(2)}</div>
                <div style="font-size:11px;color:#c53030;font-weight:700;">Save ${savePct}%</div>`;
        }

        // Time frame
        let timeFrame = '';
        if (p.start_date || p.end_date) {
            const s = p.start_date ? window.UI.formatDate(p.start_date) : '—';
            const e = p.end_date   ? window.UI.formatDate(p.end_date)   : 'Ongoing';
            timeFrame = `<span style="font-size:11px;color:var(--gray-500);"><i class="fas fa-calendar-alt" style="margin-right:4px;"></i>${s} – ${e}</span>`;
        }

        // Payment types
        const paymentHtml = (p.payment_types || []).length > 0
            ? `<div style="margin-top:6px;display:flex;flex-wrap:wrap;gap:4px;">${(p.payment_types || []).map(pt =>
                `<span style="font-size:11px;background:#f3f4f6;border:1px solid #e5e7eb;border-radius:4px;padding:1px 7px;color:#555;">${escapeHtml(pt)}</span>`
              ).join('')}</div>`
            : '';

        // Limited slots
        const slotsHtml = p.limited_slots
            ? `<span style="font-size:11px;color:var(--gray-500);"><i class="fas fa-layer-group" style="margin-right:4px;"></i>Limited: ${p.limited_slots} sets</span>`
            : '';

        return `
            <div style="background:#fff;border:1px solid var(--gray-200);border-radius:10px;padding:18px 22px;box-shadow:var(--shadow-sm);">
                <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:16px;">
                    <div style="flex:1;min-width:0;">
                        <div style="font-size:17px;font-weight:700;color:#8B1A1A;margin-bottom:4px;">${escapeHtml(p.package_name || p.name || 'Promotion')}</div>
                        ${validProductNames.length > 0 ? `<div style="font-size:12px;color:var(--gray-500);margin-bottom:6px;"><i class="fas fa-box" style="margin-right:4px;"></i>${escapeHtml(validProductNames.join(', '))}</div>` : ''}
                        ${p.requirement ? `<div style="font-size:12px;color:var(--gray-600);margin-bottom:4px;"><i class="fas fa-check-circle" style="color:#8B1A1A;margin-right:4px;"></i>${escapeHtml(p.requirement)}</div>` : ''}
                        <div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap;margin-top:6px;">
                            ${timeFrame}
                            ${slotsHtml}
                        </div>
                        ${paymentHtml}
                        ${p.remarks ? `<div style="font-size:11px;color:var(--gray-400);margin-top:6px;"><i class="fas fa-info-circle" style="margin-right:4px;"></i>${escapeHtml(p.remarks)}</div>` : ''}
                    </div>
                    <div style="text-align:right;flex-shrink:0;min-width:90px;">
                        ${p.price ? `<div style="font-size:20px;font-weight:800;color:#8B1A1A;">RM ${parseFloat(p.price).toFixed(2)}</div>` : ''}
                        ${discountHtml}
                    </div>
                </div>
            </div>
        `;
    }));

    container.innerHTML = `
        <div style="padding:20px;max-width:960px;margin:0 auto;">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:20px;">
                <div>
    `;
};

// ══════════════ showRankingPerformanceView ══════════════
window._fv.showRankingPerformanceView = async (container) => {
    const { escapeHtml } = window._crmUtils || {};
    window._appState.cv = 'ranking';
    // ── Paint skeleton immediately ──────────────────────────────────────
    const _rSkelR = (cols) => `<tr>${Array.from({length:cols},(_,i)=>`<td style="padding:10px 12px;"><div class="skeleton" style="height:14px;border-radius:4px;width:${[30,70,45,40,35,50,45,40,35,35][i%10]}%;"></div></td>`).join('')}</tr>`;
    container.innerHTML = `
        <div class="ranking-view">
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:20px;">
                <div>
                    <h1>Ranking Performance Overview</h1>
                    <p style="color:var(--gray-500);">Calculating agent rankings…</p>
                </div>
                <div><button class="btn secondary" disabled><i class="fas fa-sync-alt"></i> Refresh</button></div>
            </div>
            <div style="display:grid; grid-template-columns:repeat(3, 1fr); gap:16px; margin-bottom:24px;">
                ${Array(3).fill(0).map(() => `<div class="skeleton" style="border-radius:12px;height:160px;"></div>`).join('')}
            </div>
            <div class="profile-section">
                <div class="skeleton" style="height:24px;width:160px;border-radius:4px;margin-bottom:16px;"></div>
                <table class="data-table" style="width:100%;"><tbody>${Array(10).fill(0).map(()=>_rSkelR(10)).join('')}</tbody></table>
            </div>
        </div>`;
    // ── Fetch all four tables in parallel ───────────────────────────────
    // Pre-fetch all four tables in parallel ONCE, then bucket by agent_id
    // for O(1) per-agent lookups. Previously this loop did three serial
    // getAll() calls inside a per-agent for loop and re-filtered the entire
    // activities/purchases/prospects arrays for every agent — O(agents ×
    // records). With 100 agents and 5k activities that's 500k comparisons
    // inside the render path, and each await-in-loop forces a microtask
    // yield even when the cache is hot.
    const [users, allActivities, allPurchases, allProspects] = await Promise.all([
        window.AppDataStore.getAll('users'),
        window.AppDataStore.getAll('activities'),
        window.AppDataStore.getAll('purchases'),
        window.AppDataStore.getAll('prospects'),
    ]);
    const agents = users.filter(u => u.role && (u.role.includes('Level') || u.role === 'agent' || u.role === 'consultant'));
    const now = new Date();
    const monthStart = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
    const monthEnd = now.toISOString().split('T')[0];

    // Bucket activities for the current month by lead_agent_id
    const activitiesByAgent = new Map();
    for (const a of allActivities) {
        if (!a.lead_agent_id) continue;
        if (a.activity_date < monthStart || a.activity_date > monthEnd) continue;
        const k = String(a.lead_agent_id);
        let bucket = activitiesByAgent.get(k);
        if (!bucket) { bucket = []; activitiesByAgent.set(k, bucket); }
        bucket.push(a);
    }
    // Bucket purchases for the current month by agent_id
    const purchasesByAgent = new Map();
    for (const p of allPurchases) {
        if (!p.agent_id) continue;
        if (p.purchase_date < monthStart || p.purchase_date > monthEnd) continue;
        const k = String(p.agent_id);
        let bucket = purchasesByAgent.get(k);
        if (!bucket) { bucket = []; purchasesByAgent.set(k, bucket); }
        bucket.push(p);
    }
    // Bucket prospects by responsible_agent_id
    const prospectsByAgent = new Map();
    for (const p of allProspects) {
        if (!p.responsible_agent_id) continue;
        const k = String(p.responsible_agent_id);
        let bucket = prospectsByAgent.get(k);
        if (!bucket) { bucket = []; prospectsByAgent.set(k, bucket); }
        bucket.push(p);
    }

    // Gather agent stats — O(1) lookup per agent against the buckets above
    const agentStats = [];
    for (const agent of agents) {
        const aid = String(agent.id);
        const activities = activitiesByAgent.get(aid) || [];
        const purchases = purchasesByAgent.get(aid) || [];
        const prospects = prospectsByAgent.get(aid) || [];
        const cpsCount = activities.filter(a => a.activity_type === 'CPS').length;
        const totalSales = purchases.reduce((s, p) => s + (p.amount || 0), 0);
        const meetingCount = activities.filter(a => ['FTF', 'FSA', 'GR', 'SITE', 'XG'].includes(a.activity_type)).length;
        const followedUp = prospects.filter(p => {
            if (!p.last_contact_date) return false;
            const diff = (now - new Date(p.last_contact_date)) / (1000 * 60 * 60 * 24);
            return diff <= 7;
        }).length;
        const followupRate = prospects.length > 0 ? Math.round((followedUp / prospects.length) * 100) : 0;
        const closingRate = cpsCount > 0 ? Math.round((purchases.length / cpsCount) * 100) : 0;

        agentStats.push({
            id: agent.id,
            name: agent.full_name || 'Unknown',
            team: agent.team || '-',
            cps: cpsCount,
            sales: totalSales,
            meetings: meetingCount,
            prospects: prospects.length,
            followupRate,
            closingRate,
            // Overall performance score
            performanceScore: Math.round(cpsCount * 5 + totalSales / 1000 + meetingCount * 3 + followupRate * 0.5 + closingRate * 0.8)
        });
    }
    agentStats.sort((a, b) => b.performanceScore - a.performanceScore);

    const rankBadge = (i) => i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `#${i + 1}`;

    container.innerHTML = `
        <div class="ranking-view">
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:20px;">
                <div>
                    <h1>Ranking Performance Overview</h1>
                    <p style="color:var(--gray-500);">Agent rankings for ${now.toLocaleString('default', { month: 'long', year: 'numeric' })}</p>
                </div>
                <div>
                    <button class="btn secondary" onclick="app.refreshCurrentView()"><i class="fas fa-sync-alt"></i> Refresh</button>
                </div>
            </div>

            <!-- Top 3 Cards -->
            <div style="display:grid; grid-template-columns:repeat(3, 1fr); gap:16px; margin-bottom:24px;">
                ${agentStats.slice(0, 3).map((a, i) => `
                    <div style="background:var(--white); border-radius:12px; padding:20px; text-align:center; box-shadow:0 2px 8px rgba(0,0,0,0.06); border-top:4px solid ${i === 0 ? '#FFD700' : i === 1 ? '#C0C0C0' : '#CD7F32'};">
                        <div style="font-size:32px; margin-bottom:8px;">${rankBadge(i)}</div>
                        <div style="font-size:16px; font-weight:600;">${escapeHtml(a.name)}</div>
                        <div style="color:var(--gray-500); font-size:12px; margin-bottom:12px;">${escapeHtml(a.team)}</div>
                        <div style="font-size:24px; font-weight:700; color:var(--primary);">${a.performanceScore} pts</div>
                        <div style="font-size:12px; color:var(--gray-500); margin-top:8px;">Sales: RM ${a.sales.toLocaleString()} · CPS: ${a.cps} · Rate: ${a.closingRate}%</div>
                    </div>
                `).join('')}
            </div>

            <!-- Full Rankings Table -->
            <div class="profile-section">
                <h2><i class="fas fa-list-ol"></i> Full Rankings</h2>
                <table class="data-table" style="width:100%;">
                    <thead>
                        <tr>
                            <th scope="col">Rank</th>
                            <th scope="col">Agent</th>
                            <th scope="col">Team</th>
                            <th scope="col" style="text-align:right;">Score</th>
                            <th scope="col" style="text-align:right;">CPS</th>
                            <th scope="col" style="text-align:right;">Sales (RM)</th>
                            <th scope="col" style="text-align:right;">Meetings</th>
                            <th scope="col" style="text-align:right;">Prospects</th>
                            <th scope="col" style="text-align:right;">Follow-up %</th>
                            <th scope="col" style="text-align:right;">Closing %</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${agentStats.map((a, i) => `
                            <tr style="${i < 3 ? 'background:var(--primary-50);' : ''}">
                                <td>${rankBadge(i)}</td>
                                <td>${escapeHtml(a.name)}</td>
                                <td>${escapeHtml(a.team)}</td>
                                <td style="text-align:right; font-weight:600;">${a.performanceScore}</td>
                                <td style="text-align:right;">${a.cps}</td>
                                <td style="text-align:right;">RM ${a.sales.toLocaleString()}</td>
                                <td style="text-align:right;">${a.meetings}</td>
                                <td style="text-align:right;">${a.prospects}</td>
                                <td style="text-align:right;">${a.followupRate}%</td>
                                <td style="text-align:right;">${a.closingRate}%</td>
                            </tr>
                        `).join('')}
                    </tbody>
                </table>
            </div>
        </div>`;
};

// ══════════════ showWorkflowAutomationView ══════════════
window._fv.showWorkflowAutomationView = async (container) => {
    const _currentUser = window._appState?.cu;
    const { escapeHtml } = window._crmUtils || {};

    // ========== FEATURE: WORKFLOW AUTOMATION ENGINE ==========

    const WORKFLOW_TRIGGERS = {
        new_prospect: 'New Prospect Created',
        new_customer: 'Customer Converted',
        score_change: 'Score Threshold Reached',
        purchase: 'Transaction Completed',
        activity_completed: 'Activity Completed',
        birthday: 'Customer/Prospect Birthday',
        protection_expiring: 'Protection ≤7 Days Left',
        inactivity: 'No Contact >7 Days',
        event_attendance: 'Event Attended'
    };

    const WORKFLOW_ACTIONS = {
        send_whatsapp: 'Send WhatsApp Message',
        create_task: 'Create Follow-up Task',
        add_tag: 'Add Tag',
        remove_tag: 'Remove Tag',
        add_score: 'Add Score Points',
        extend_protection: 'Extend Protection Period',
        send_notification: 'Send In-App Notification',
        assign_agent: 'Reassign to Agent',
        create_activity: 'Schedule Activity',
        flag_reassignment: 'Flag for Reassignment'
    };

    const renderWorkflowCard = (w) => {
        const statusColor = w.status === 'active' ? 'success' : w.status === 'paused' ? 'warning' : 'secondary';
        return `
            <div style="background:var(--white); border-radius:8px; padding:16px; margin-bottom:12px; border:1px solid var(--gray-200); display:flex; justify-content:space-between; align-items:center;">
                <div>
                    <div style="font-weight:600; font-size:14px;">${escapeHtml(w.workflow_name || '')}</div>
                    <div style="font-size:12px; color:var(--gray-500); margin-top:4px;">
                        Trigger: <strong>${w.trigger_type}</strong> → Action: <strong>${w.action_type || 'Multiple'}</strong>
                    </div>
                    <div style="font-size:11px; color:var(--gray-400); margin-top:2px;">Runs: ${w.run_count || 0} times · Last: ${w.last_run || 'Never'}</div>
                </div>
                <div style="display:flex; gap:8px; align-items:center;">
                    <span class="badge ${statusColor}">${w.status}</span>
                    <button class="btn btn-sm secondary" onclick="app.toggleWorkflow(${w.id})">${w.status === 'active' ? 'Pause' : 'Activate'}</button>
                    <button class="btn btn-sm secondary" onclick="app.editWorkflow(${w.id})"><i class="fas fa-edit"></i></button>
                    <button class="btn btn-sm secondary" style="color:var(--danger);" onclick="app.deleteWorkflow(${w.id})"><i class="fas fa-trash"></i></button>
                </div>
            </div>
        `;
    };

    const renderWorkflowTemplate = (name, trigger, desc, icon) => `
        <div style="background:var(--gray-50); border-radius:8px; padding:16px; border:1px solid var(--gray-200); cursor:pointer;" onclick="app.createWorkflowFromTemplate('${trigger}')">
            <div style="display:flex; align-items:center; gap:8px; margin-bottom:8px;">
                <i class="${icon}" style="color:var(--primary);"></i>
                <span style="font-weight:600; font-size:13px;">${name}</span>
            </div>
            <p style="font-size:12px; color:var(--gray-500); margin:0;">${desc}</p>
        </div>
    `;

    window._appState = window._appState || {};
    window._appState.cv = 'workflows';

    const workflows = await window.AppDataStore.getAll('automation_workflows');

    container.innerHTML = `
        <div class="workflow-view">
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:20px;">
                <div>
                    <h1>Workflow Automation Engine</h1>
                    <p style="color:var(--gray-500);">Create automated workflows with triggers and actions</p>
                </div>
                <div style="display:flex; gap:8px;">
                    <button class="btn primary" onclick="app.openCreateWorkflowModal()"><i class="fas fa-plus"></i> Create Workflow</button>
                    <button class="btn secondary" onclick="app.refreshCurrentView()"><i class="fas fa-sync-alt"></i> Refresh</button>
                </div>
            </div>

            <!-- Active Workflows -->
            <div class="profile-section">
                <h2><i class="fas fa-bolt"></i> Active Workflows (${workflows.filter(w => w.status === 'active').length})</h2>
                <div id="workflows-list">
                    ${workflows.length > 0 ? workflows.map(w => renderWorkflowCard(w)).join('') : `
                        <div style="text-align:center; padding:40px; color:var(--gray-500);">
                            <i class="fas fa-cogs" style="font-size:48px; margin-bottom:12px; color:var(--gray-300);"></i>
                            <p>No workflows created yet</p>
                            <p style="font-size:12px;">Create your first workflow to automate tasks like sending birthday wishes, scoring updates, and follow-up reminders.</p>
                            <button class="btn primary" style="margin-top:12px;" onclick="app.openCreateWorkflowModal()"><i class="fas fa-plus"></i> Create First Workflow</button>
                        </div>
                    `}
                </div>
            </div>

            <!-- Workflow Templates -->
            <div class="profile-section" style="margin-top:20px;">
                <h2><i class="fas fa-clipboard-list"></i> Quick Templates</h2>
                <div style="display:grid; grid-template-columns:repeat(auto-fill, minmax(250px, 1fr)); gap:12px;">
                    ${renderWorkflowTemplate('Birthday Greeting', 'birthday', 'Send WhatsApp greeting on customer birthday', 'fas fa-birthday-cake')}
                    ${renderWorkflowTemplate('Protection Expiring', 'protection_expiring', 'Alert agent 7 days before protection expires', 'fas fa-shield-alt')}
                    ${renderWorkflowTemplate('Inactivity Alert', 'inactivity', 'Flag prospects with >7 days no follow-up', 'fas fa-exclamation-triangle')}
                    ${renderWorkflowTemplate('New Prospect Welcome', 'new_prospect', 'Send welcome message when prospect created', 'fas fa-user-plus')}
                    ${renderWorkflowTemplate('Event Follow-up', 'event_attendance', 'Create follow-up task after event attendance', 'fas fa-calendar-check')}
                    ${renderWorkflowTemplate('Score Threshold', 'score_change', 'Notify agent when prospect reaches 600+ score', 'fas fa-chart-line')}
                </div>
            </div>
        </div>
    `;

    // ---- helper functions exposed on app for inline onclick handlers ----

    app.openCreateWorkflowModal = async (workflowId = null) => {
        const existing = workflowId ? await window.AppDataStore.getById('automation_workflows', workflowId) : null;

        const content = `
            <div style="max-height:70vh; overflow-y:auto;">
                <div class="form-group">
                    <label>Workflow Name *</label>
                    <input type="text" id="wf-name" class="form-control" value="${escapeHtml(existing?.workflow_name || '')}" placeholder="e.g. Birthday Greeting Workflow">
                </div>
                <div class="form-group">
                    <label>Trigger *</label>
                    <select id="wf-trigger" class="form-control" onchange="app.updateWorkflowConditions()">
                        <option value="">Select Trigger...</option>
                        ${Object.entries(WORKFLOW_TRIGGERS).map(([k, v]) => `<option value="${k}" ${existing?.trigger_type === k ? 'selected' : ''}>${v}</option>`).join('')}
                    </select>
                </div>
                <div class="form-group" id="wf-conditions-container" style="display:${existing?.trigger_conditions ? 'block' : 'none'};">
                    <label>Conditions (optional)</label>
                    <div id="wf-conditions">
                        ${existing?.trigger_conditions ? `<input type="text" id="wf-condition-value" class="form-control" value="${escapeHtml(existing.trigger_conditions.value || '')}" placeholder="e.g. score threshold: 600">` : ''}
                    </div>
                </div>
                <hr style="margin:16px 0;">
                <div class="form-group">
                    <label>Action *</label>
                    <select id="wf-action" class="form-control">
                        <option value="">Select Action...</option>
                        ${Object.entries(WORKFLOW_ACTIONS).map(([k, v]) => `<option value="${k}" ${existing?.action_type === k ? 'selected' : ''}>${v}</option>`).join('')}
                    </select>
                </div>
                <div class="form-group">
                    <label>Action Configuration</label>
                    <textarea id="wf-action-config" class="form-control" rows="3" placeholder="e.g. Message: Happy Birthday {{name}}! or Tag: VIP Customer">${escapeHtml(existing?.action_config || '')}</textarea>
                </div>
                <div class="form-group">
                    <label>Delay (days after trigger)</label>
                    <input type="number" id="wf-delay" class="form-control" min="0" value="${existing?.delay_days || 0}">
                </div>
                <div class="form-group">
                    <label>Status</label>
                    <select id="wf-status" class="form-control">
                        <option value="active" ${(!existing || existing?.status === 'active') ? 'selected' : ''}>Active</option>
                        <option value="paused" ${existing?.status === 'paused' ? 'selected' : ''}>Paused</option>
                        <option value="draft" ${existing?.status === 'draft' ? 'selected' : ''}>Draft</option>
                    </select>
                </div>
            </div>
        `;
        window.UI.showModal(workflowId ? 'Edit Workflow' : 'Create Workflow', content, [
            { label: 'Cancel', type: 'secondary', action: 'UI.hideModal()' },
            { label: 'Save Workflow', type: 'primary', action: `(async () => { await app.saveWorkflow(${workflowId || 'null'}); })()` }
        ]);
    };

    app.updateWorkflowConditions = () => {
        const trigger = document.getElementById('wf-trigger')?.value;
        const container = document.getElementById('wf-conditions-container');
        const conditions = document.getElementById('wf-conditions');
        if (!container || !conditions) return;

        if (trigger === 'score_change') {
            container.style.display = 'block';
            conditions.innerHTML = '<input type="number" id="wf-condition-value" class="form-control" placeholder="Score threshold (e.g. 600)">';
        } else if (trigger === 'inactivity') {
            container.style.display = 'block';
            conditions.innerHTML = '<input type="number" id="wf-condition-value" class="form-control" placeholder="Days inactive (e.g. 7)" value="7">';
        } else if (trigger === 'protection_expiring') {
            container.style.display = 'block';
            conditions.innerHTML = '<input type="number" id="wf-condition-value" class="form-control" placeholder="Days before expiry (e.g. 7)" value="7">';
        } else {
            container.style.display = 'none';
        }
    };

    app.saveWorkflow = async (workflowId) => {
        const name = document.getElementById('wf-name')?.value?.trim();
        const trigger = document.getElementById('wf-trigger')?.value;
        const action = document.getElementById('wf-action')?.value;

        if (!name || !trigger || !action) {
            window.UI.toast.error('Workflow name, trigger, and action are required');
            return;
        }

        const data = {
            workflow_name: name,
            trigger_type: trigger,
            action_type: action,
            action_config: document.getElementById('wf-action-config')?.value || '',
            delay_days: parseInt(document.getElementById('wf-delay')?.value) || 0,
            status: document.getElementById('wf-status')?.value || 'active',
            trigger_conditions: {
                value: document.getElementById('wf-condition-value')?.value || ''
            },
            updated_at: new Date().toISOString()
        };

        if (workflowId) {
            await window.AppDataStore.update('automation_workflows', workflowId, data);
        } else {
            data.id = Date.now();
            data.created_by = _currentUser?.id || 5;
            data.created_at = new Date().toISOString();
            data.run_count = 0;
            await window.AppDataStore.create('automation_workflows', data);
        }

        window.UI.hideModal();
        window.UI.toast.success(workflowId ? 'Workflow updated' : 'Workflow created');
        const _tabC = document.getElementById('marketing-tab-content');
        if (_tabC) _tabC.innerHTML = await app.renderAutomationTab();
    };

    app.createWorkflowFromTemplate = async (triggerType) => {
        const templates = {
            birthday: { name: 'Birthday Greeting', action: 'send_whatsapp', config: 'Hi {{name}}, Happy Birthday! Wishing you a wonderful year ahead. — DestinOracles Team', delay: 0 },
            protection_expiring: { name: 'Protection Expiry Alert', action: 'send_notification', config: 'Protection period for {{prospect_name}} expires in {{days}} days. Take action now.', delay: 0 },
            inactivity: { name: 'Inactivity Follow-up Alert', action: 'flag_reassignment', config: 'Prospect {{name}} has been inactive for {{days}} days. Consider reassignment.', delay: 0 },
            new_prospect: { name: 'New Prospect Welcome', action: 'send_whatsapp', config: 'Hi {{name}}, thank you for your interest! Our consultant will reach out to you shortly.', delay: 0 },
            event_attendance: { name: 'Post-Event Follow-up', action: 'create_task', config: 'Follow up with {{name}} after attending {{event_name}}. Schedule a CPS within 3 days.', delay: 1 },
            score_change: { name: 'High Score Notification', action: 'send_notification', config: 'Prospect {{name}} has reached score {{score}}. Prioritize follow-up.', delay: 0 }
        };

        const tpl = templates[triggerType];
        if (!tpl) return;

        const cu = window._appState?.cu;
        const data = {
            id: Date.now(),
            workflow_name: tpl.name,
            trigger_type: triggerType,
            action_type: tpl.action,
            action_config: tpl.config,
            delay_days: tpl.delay,
            status: 'active',
            trigger_conditions: {},
            created_by: cu?.id || 5,
            created_at: new Date().toISOString(),
            run_count: 0
        };

        await window.AppDataStore.create('automation_workflows', data);
        window.UI.toast.success(`Workflow "${tpl.name}" created from template`);
        const _tabC2 = document.getElementById('marketing-tab-content');
        if (_tabC2) _tabC2.innerHTML = await app.renderAutomationTab();
    };

    app.toggleWorkflow = async (workflowId) => {
        const wf = await window.AppDataStore.getById('automation_workflows', workflowId);
        if (!wf) return;
        const newStatus = wf.status === 'active' ? 'paused' : 'active';
        await window.AppDataStore.update('automation_workflows', workflowId, { status: newStatus });
        window.UI.toast.success(`Workflow ${newStatus === 'active' ? 'activated' : 'paused'}`);
        const _tabC3 = document.getElementById('marketing-tab-content');
        if (_tabC3) _tabC3.innerHTML = await app.renderAutomationTab();
    };

    app.editWorkflow = async (workflowId) => {
        await app.openCreateWorkflowModal(workflowId);
    };

    app.deleteWorkflow = async (workflowId) => {
        window.UI.showModal('Delete Workflow', '<p>Are you sure you want to delete this workflow?</p>', [
            { label: 'Cancel', type: 'secondary', action: 'UI.hideModal()' },
            { label: 'Delete', type: 'primary', action: `(async () => { await AppDataStore.delete('automation_workflows', ${workflowId}); UI.hideModal(); UI.toast.success('Workflow deleted'); const tc = document.getElementById('marketing-tab-content'); if (tc) tc.innerHTML = await app.renderAutomationTab(); })()` }
        ]);
    };
};

// ══════════════ showNoticeboardView ══════════════
window._fv.showNoticeboardView = async (container) => {
    const _currentUser = window._appState?.cu;
    const { isSystemAdmin, isMarketingManager } = window._crmUtils || {};

    if (!_currentUser) return;

    const isAdmin = (isSystemAdmin && isSystemAdmin(_currentUser)) || (isMarketingManager && isMarketingManager(_currentUser));

    // Inline <style> so the noticeboard is self-contained (independent of
    // styles-fixed.css load order) and so card hover/responsive rules work
    // without polluting the global stylesheet.
    const styleBlock = `
    <style id="noticeboard-styles">
        .nb-page { background: linear-gradient(180deg, #fdf6ec 0%, #fdf2f8 100%); min-height: 100vh; padding: 0 0 64px; }
        .nb-topbar { display: flex; align-items: center; justify-content: space-between; padding: 18px 28px; border-bottom: 1px solid rgba(128,0,32,0.12); background: rgba(255,255,255,0.6); backdrop-filter: blur(8px); flex-wrap: wrap; gap: 12px; }
        .nb-topbar-brand { font-size: 1.15rem; font-weight: 700; color: #800020; display: flex; align-items: center; gap: 8px; letter-spacing: 0.02em; }
        .nb-topbar-tagline { color: #9b1c4f; font-size: 0.95rem; font-style: italic; letter-spacing: 0.05em; }
        .nb-hero { text-align: center; padding: 48px 20px 32px; max-width: 900px; margin: 0 auto; }
        .nb-hero-title { font-size: 2.2rem; font-weight: 800; color: #800020; margin: 0 0 12px; letter-spacing: 0.05em; position: relative; display: inline-block; padding: 0 28px; }
        .nb-hero-title::before, .nb-hero-title::after { content: ""; position: absolute; top: 50%; width: 32px; height: 1px; background: #be185d; }
        .nb-hero-title::before { left: -16px; } .nb-hero-title::after { right: -16px; }
        .nb-hero-sub { color: #6b7280; font-size: 0.95rem; letter-spacing: 0.08em; }
        .nb-grid { display: grid; gap: 26px; grid-template-columns: repeat(3, 1fr); max-width: 1200px; margin: 0 auto; padding: 0 28px; }
        @media (max-width: 1024px) { .nb-grid { grid-template-columns: repeat(2, 1fr); } }
        @media (max-width: 640px)  { .nb-grid { grid-template-columns: 1fr; gap: 20px; padding: 0 16px; } .nb-hero-title { font-size: 1.6rem; } }
        .nb-card { background: white; border-radius: 14px; overflow: hidden; box-shadow: 0 4px 16px rgba(128,0,32,0.10); display: flex; flex-direction: column; position: relative; transition: transform .18s ease, box-shadow .18s ease; }
        .nb-card:hover { transform: translateY(-3px); box-shadow: 0 10px 28px rgba(128,0,32,0.16); }
        .nb-num { position: absolute; top: 14px; left: 14px; z-index: 2; width: 38px; height: 38px; border-radius: 50%; background: #800020; color: white; display: flex; align-items: center; justify-content: center; font-weight: 700; font-size: 0.95rem; letter-spacing: 0.05em; box-shadow: 0 2px 8px rgba(0,0,0,0.2); font-family: 'Inter', sans-serif; }
        .nb-poster { width: 100%; aspect-ratio: 3 / 4; object-fit: cover; display: block; background: linear-gradient(135deg, #800020, #be185d); }
        .nb-poster-placeholder { width: 100%; aspect-ratio: 3 / 4; background: linear-gradient(135deg, #800020, #be185d); color: white; display: flex; align-items: center; justify-content: center; font-size: 4rem; }
        .nb-body { padding: 18px 18px 20px; display: flex; flex-direction: column; gap: 10px; flex: 1; }
        .nb-title { font-size: 1.2rem; font-weight: 800; color: #1f2937; line-height: 1.25; margin: 0; }
        .nb-tagline { font-size: 0.88rem; color: #9b1c4f; font-style: italic; line-height: 1.3; min-height: 1.3em; }
        .nb-info { background: #fdf2f8; border-radius: 8px; padding: 10px 12px; display: flex; flex-direction: column; gap: 6px; border: 1px solid #fce7f3; }
        .nb-info-row { display: flex; align-items: center; gap: 8px; font-size: 0.85rem; color: #4b5563; }
        .nb-info-row i { color: #be185d; width: 14px; text-align: center; }
        .nb-desc { color: #6b7280; font-size: 0.86rem; line-height: 1.55; display: -webkit-box; -webkit-line-clamp: 5; -webkit-box-orient: vertical; overflow: hidden; }
        .nb-price-badge { display: inline-block; padding: 3px 10px; background: #800020; color: white; border-radius: 12px; font-size: 0.78rem; font-weight: 600; align-self: flex-start; }
        .nb-empty { grid-column: 1 / -1; text-align: center; padding: 80px 20px; color: #6b7280; }
        .nb-empty-emoji { font-size: 4rem; margin-bottom: 16px; opacity: 0.6; }
        .nb-footer { margin: 56px auto 0; padding: 22px 28px; max-width: 1200px; border-top: 1px solid rgba(128,0,32,0.12); display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 12px; color: #800020; font-size: 0.85rem; }
        .nb-footer-brand { display: flex; align-items: center; gap: 10px; font-weight: 700; }
        .nb-footer-brand-icon { width: 36px; height: 36px; border-radius: 50%; background: linear-gradient(135deg, #800020, #be185d); color: white; display: flex; align-items: center; justify-content: center; font-size: 1rem; }
        .nb-footer-meta { color: #9b1c4f; font-size: 0.8rem; letter-spacing: 0.03em; }
        .nb-admin-bar { max-width: 1200px; margin: 0 auto 18px; padding: 0 28px; display: flex; justify-content: flex-end; }
    </style>`;

    // Skeleton paint
    container.innerHTML = `
        ${styleBlock}
        <div class="nb-page">
            <div class="nb-topbar">
                <div class="nb-topbar-brand">📢 公告栏 · Noticeboard</div>
                <div class="nb-topbar-tagline">探索过去 · 启迪未来</div>
            </div>
            <div class="nb-hero">
                <h1 class="nb-hero-title">即将举行的活动</h1>
                <div class="nb-hero-sub">探索风水智慧与人文之美</div>
            </div>
            ${isAdmin ? `<div class="nb-admin-bar"><button class="btn primary" onclick="(async()=>{ if(app.openCreateEventModal) await app.openCreateEventModal(); })()"><i class="fas fa-plus"></i> Post Event</button></div>` : ''}
            <div id="noticeboard-grid" class="nb-grid">
                <div class="nb-empty"><div style="opacity:0.5;">Loading events…</div></div>
            </div>
            <div class="nb-footer">
                <div class="nb-footer-brand">
                    <div class="nb-footer-brand-icon">🏛️</div>
                    <div>DestinOraclesSolution · 玄空风水博物馆</div>
                </div>
                <div class="nb-footer-meta">destinoraclessolution.com</div>
            </div>
        </div>`;

    // Fetch events
    let events = [];
    try {
        events = await window.AppDataStore.getAll('events');
    } catch(err) {
        console.warn('[noticeboard] events fetch failed:', err);
    }
    events = events || [];

    // Filter: must have a valid future event_date AND not be explicitly
    // hidden from the noticeboard. Defaults are inclusive — a freshly-
    // created event shows up unless the admin specifically unticks the
    // "Publish to Noticeboard" checkbox. This avoids the previous footgun
    // where admins forgot to tick the publish box and the event silently
    // never appeared.
    //   - Missing event_date → skipped (otherwise "Invalid Date" cards)
    //   - event_date < today → skipped (auto-expire past events)
    //   - status === 'cancelled' → skipped
    //   - published_to_noticeboard === false → skipped (explicit hide)
    //   - everything else → shown
    // The Postgres `events` table uses column `date` (NOT `event_date`) —
    // older JS code wrote to `event_date` which the data layer stripped.
    // Read `date` first, fall back to `event_date` for legacy in-memory rows.
    const dateOf = (e) => e?.date || e?.event_date || null;
    const todayStr = new Date().toISOString().split('T')[0];
    let visible = events.filter(e => {
        if (!e) return false;
        const d = dateOf(e);
        if (!d) return false;
        const parsed = new Date(d);
        if (isNaN(parsed.getTime())) return false;
        if (d < todayStr) return false; // expired
        if ((e.status || 'upcoming') === 'cancelled') return false;
        if (e.published_to_noticeboard === false) return false; // explicit hide
        return true;
    });
    visible.sort((a, b) => String(dateOf(a) || '').localeCompare(String(dateOf(b) || '')));

    const grid = document.getElementById('noticeboard-grid');
    if (!grid) return;

    if (!visible.length) {
        grid.innerHTML = `
            <div class="nb-empty">
                <div class="nb-empty-emoji">📭</div>
                <div style="font-size:1.15rem;font-weight:700;color:#800020;margin-bottom:6px;">暂无活动 · No upcoming events</div>
                <div style="font-size:0.9rem;">${isAdmin ? 'Tap "Post Event" above to publish the first one.' : 'Check back soon — new events will appear here.'}</div>
            </div>`;
        return;
    }

    // Pre-sign poster images (best-effort)
    const postered = visible.filter(e => e.poster_url);
    if (postered.length && window.AppDataStore.resolveAttachmentSrc) {
        await Promise.all(postered.map(async e => {
            try { e._posterSigned = await window.AppDataStore.resolveAttachmentSrc(e.poster_url); }
            catch(_) { e._posterSigned = e.poster_url; }
        }));
    } else {
        postered.forEach(e => { e._posterSigned = e.poster_url; });
    }

    const esc = (s) => String(s || '').replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
    const titleOf = (e) => e.event_title || e.title || 'Untitled Event';
    const fmtDate = (d) => {
        const dt = new Date(d);
        if (isNaN(dt.getTime())) return '日期待定 · Date TBD';
        // 2026年6月15日 (星期六) style — closer to the reference design
        try {
            const opts = { year: 'numeric', month: 'long', day: 'numeric', weekday: 'short' };
            return dt.toLocaleDateString('zh-CN', opts);
        } catch(_) { return dt.toLocaleDateString(); }
    };
    const fmtTime = (s, e) => {
        if (!s && !e) return '';
        const fmt = (t) => {
            if (!t) return '';
            // Accept "14:30" or "14:30:00" → "2:30 PM"
            const [h, m] = String(t).split(':');
            const hr = parseInt(h, 10);
            if (isNaN(hr)) return t;
            const ampm = hr >= 12 ? 'PM' : 'AM';
            const h12 = hr % 12 || 12;
            return `${h12}:${(m || '00').padStart(2, '0')} ${ampm}`;
        };
        if (s && e) return `${fmt(s)} – ${fmt(e)}`;
        return fmt(s || e);
    };

    grid.innerHTML = visible.map((e, idx) => {
        const num = String(idx + 1).padStart(2, '0');
        const posterHtml = e._posterSigned
            ? `<img class="nb-poster" loading="lazy" decoding="async" src="${esc(e._posterSigned)}" alt="${esc(titleOf(e))}" onerror="this.outerHTML='<div class=&quot;nb-poster-placeholder&quot;>📅</div>';">`
            : `<div class="nb-poster-placeholder">📅</div>`;
        const time = fmtTime(e.start_time, e.end_time);
        const tagline = e.speaker ? `主讲 · ${e.speaker}` : (e.target_group || '');
        const priceBadge = e.ticket_price && parseFloat(e.ticket_price) > 0
            ? `<div class="nb-price-badge">RM ${parseFloat(e.ticket_price).toFixed(0)}${e.early_bird_price ? ` · 早鸟 RM ${esc(e.early_bird_price)}` : ''}</div>`
            : (e.ticket_price === 0 || e.ticket_price === '0' ? `<div class="nb-price-badge" style="background:#10b981;">免费 · Free</div>` : '');
        return `
            <article class="nb-card">
                <div class="nb-num">${num}</div>
                ${posterHtml}
                <div class="nb-body">
                    <h3 class="nb-title">${esc(titleOf(e))}</h3>
                    ${tagline ? `<div class="nb-tagline">${esc(tagline)}</div>` : ''}
                    <div class="nb-info">
                        <div class="nb-info-row"><i class="fas fa-calendar"></i> ${esc(fmtDate(dateOf(e)))}</div>
                        ${time ? `<div class="nb-info-row"><i class="fas fa-clock"></i> ${esc(time)}</div>` : ''}
                        ${e.location ? `<div class="nb-info-row"><i class="fas fa-map-marker-alt"></i> ${esc(e.location)}</div>` : ''}
                    </div>
                    ${e.description ? `<div class="nb-desc">${esc(e.description)}</div>` : ''}
                    ${priceBadge}
                </div>
            </article>`;
    }).join('');
};

// ══════════════ showMilestonesView ══════════════
window._fv.showMilestonesView = async (container, targetUserId = null) => {
    const _currentUser = window._appState?.cu;
    const { escapeHtml } = window._crmUtils || {};

    const currentUser = _currentUser;
    if (!currentUser) return;

    // ── Paint skeleton immediately ──────────────────────────────────────
    container.innerHTML = `
        <div class="milestone-view-wrap">
            <div class="milestone-container">
                <div class="milestone-inner">
                    <div class="milestone-header"><h1>增运九法</h1></div>
                    <div class="nine-method-grid">
                        ${Array(9).fill(0).map(() => `<div class="skeleton" style="border-radius:12px;height:120px;"></div>`).join('')}
                    </div>
                    <div style="margin-top:32px;">
                        <div class="skeleton" style="height:24px;width:140px;border-radius:4px;margin-bottom:16px;"></div>
                        <div style="display:grid;grid-template-columns:repeat(2,1fr);gap:16px;">
                            ${Array(4).fill(0).map(() => `<div class="skeleton" style="border-radius:12px;height:100px;"></div>`).join('')}
                        </div>
                    </div>
                </div>
            </div>
        </div>`;

    // Determine admin status
    const viewerLevel = (() => {
        const m = (currentUser.role || '').match(/Level\s+(\d+)/i);
        return m ? parseInt(m[1]) : 12;
    })();
    const isAdmin = viewerLevel <= 2;

    // Resolve subject (whose milestones to show)
    const subjectUserId = (isAdmin && targetUserId) ? parseInt(targetUserId) : currentUser.id;
    const subjectUser   = (isAdmin && targetUserId) ? (await window.AppDataStore.getById('users', subjectUserId) || currentUser) : currentUser;
    const viewingOther  = isAdmin && subjectUserId !== currentUser.id;

    const subject = {
        user_id: subjectUserId,
        customer_id: subjectUser.customer_id || null,
        prospect_id: subjectUser.prospect_id || null,
    };

    // Compute statuses (parallel)
    const [nineStatuses, pillarStatuses] = await Promise.all([
        computeNineMethodStatuses(subject),
        computeFourPillarStatuses(subject),
    ]);

    // Admin user picker
    let adminPicker = '';
    if (isAdmin) {
        let allUsers = [];
        try { allUsers = (await window.AppDataStore.getAll('users')).filter(u => u.role && u.role.match(/Level\s+1[34]/i)); } catch(e) {}
        if (allUsers.length) {
            adminPicker = `
                <div class="milestone-admin-picker">
                    <span>View:</span>
                    <select onchange="(async()=>{ const vp=document.getElementById('content-viewport'); if(vp) await app.showMilestonesView(vp, this.value||null); })()">
                        <option value="">— My own —</option>
                        ${allUsers.map(u => `<option value="${u.id}" ${u.id === subjectUserId && viewingOther ? 'selected' : ''}>${escapeHtml(u.full_name || '')}</option>`).join('')}
                    </select>
                </div>`;
        }
    }

    const reloadAfter = `setTimeout(() => { const vp=document.getElementById('content-viewport'); if(vp) app.showMilestonesView(vp, ${targetUserId ? targetUserId : 'null'}); }, 120)`;
    const adminBtn = (key, isOn) => {
        if (!isAdmin) return '';
        if (isOn) {
            return `<button class="mc-admin reset" onclick="event.stopPropagation(); app.resetMilestone(${subjectUserId},'${key}').then(()=>{${reloadAfter}})">Reset</button>`;
        }
        return `<button class="mc-admin" onclick="event.stopPropagation(); app.markMilestoneCompleted(${subjectUserId},'${key}').then(()=>{${reloadAfter}})">Mark ✓</button>`;
    };
    const adminBtnPillar = (key, isOn) => {
        if (!isAdmin) return '';
        if (isOn) {
            return `<button class="pc-admin reset" onclick="event.stopPropagation(); app.resetMilestone(${subjectUserId},'${key}').then(()=>{${reloadAfter}})">Reset</button>`;
        }
        return `<button class="pc-admin" onclick="event.stopPropagation(); app.markMilestoneCompleted(${subjectUserId},'${key}').then(()=>{${reloadAfter}})">Mark ✓</button>`;
    };

    container.innerHTML = `
        <div class="milestone-view-wrap">
            <div class="milestone-container">
                <div class="milestone-inner">
                    <div class="milestone-header">
                        <h1>增运九法</h1>
                        ${viewingOther ? `<div class="viewer-note">Viewing: ${escapeHtml(subjectUser.full_name || '')}</div>` : ''}
                    </div>
                    ${adminPicker}
                    <div class="nine-method-grid">
                        ${NINE_METHOD_DEFS.map(def => {
                            const on = !!nineStatuses[def.key];
                            return `
                                <div class="nine-method-card ${on ? 'attended' : ''}">
                                    <div class="mc-icon"><img loading="lazy" decoding="async" src="${def.icon}" alt=""></div>
                                    ${adminBtn(def.key, on)}
                                </div>
                            `;
                        }).join('')}
                    </div>

                    <div class="four-pillar-section">
                        <h2>丁财贵寿四柱</h2>
                        <div class="four-pillar-grid">
                            ${FOUR_PILLAR_DEFS.map(def => {
                                const on = !!pillarStatuses[def.key];
                                return `
                                    <div class="four-pillar-card ${on ? 'owned' : ''}">
                                        <div class="pc-icon"><img loading="lazy" decoding="async" src="${def.icon}" alt=""></div>
                                        <div class="pc-label">${def.label}</div>
                                        ${adminBtnPillar(def.key, on)}
                                    </div>
                                `;
                            }).join('')}
                        </div>
                    </div>
                </div>
            </div>
        </div>`;
};

// ══════════════ showFudeView ══════════════
window._fv.showFudeView = async (container) => {
    const _currentUser = window._appState?.cu;
    const { escapeHtml } = window._crmUtils || {};

    const currentUser = _currentUser;
    if (!currentUser) return;

    const userLevel = (() => {
        const m = (currentUser.role || '').match(/Level\s+(\d+)/i);
        return m ? parseInt(m[1]) : 12;
    })();
    const isAdmin   = userLevel <= 2 || ['mianformula@gmail.com', 'destinyoracles@gmail.com', 'shilynateh7689@gmail.com'].includes((currentUser.email || '').toLowerCase());
    const isL1314   = userLevel >= 13;
    const isCustomer = userLevel === 13;

    // --- Data loading ---
    let highlights = [], myRewards = [], myPurchases = [], allRewards = [];
    try {
        highlights = isAdmin
            ? await window.AppDataStore.getAll('news_highlights')
            : await window.AppDataStore.query('news_highlights', { is_active: true });
    } catch(e) {}
    try { myRewards = await window.AppDataStore.query('recommendation_rewards', { user_id: currentUser.id }); } catch(e) {}
    if (isCustomer && currentUser.customer_id) {
        try { myPurchases = await window.AppDataStore.query('purchases', { customer_id: currentUser.customer_id }); } catch(e) {}
    }
    let allUsersForReward = [];
    if (isAdmin) {
        try { allUsersForReward = (await window.AppDataStore.getAll('users')).filter(u => u.role && u.role.match(/Level\s*1[34]/i)); } catch(e) {}
        try { allRewards = await window.AppDataStore.getAll('recommendation_rewards'); } catch(e) {}
    }

    // --- Helpers ---
    const fmtDate = d => { try { return new Date(d).toLocaleDateString(); } catch(e) { return d || '-'; } };
    const fmtAmt  = v => { try { return 'RM ' + parseFloat(v || 0).toLocaleString('en-MY', { minimumFractionDigits: 2 }); } catch(e) { return v; } };
    const badge   = (txt, bg, col) => `<span style="padding:2px 8px;border-radius:12px;font-size:0.78rem;background:${bg};color:${col};">${escapeHtml(txt)}</span>`;

    // --- Content filters ---
    // Sort highlights/news by created_at desc so the newest one is slide 0
    // (the user expects to see freshly-added highlights immediately, not
    // hidden behind the carousel's next-arrow).
    const publicNews         = highlights.filter(h => h.type === 'highlight').sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
    const successStories     = highlights.filter(h => h.type === 'success_story').sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
    const recommendationTips = highlights.filter(h => h.type === 'recommendation_tip').sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

    // --- Pre-sign highlight images so render doesn't depend on DOM resolver ---
    const withImg = [...publicNews, ...successStories].filter(h => h.image_url);
    if (withImg.length && window.AppDataStore.resolveAttachmentSrc) {
        await Promise.all(withImg.map(async h => {
            try { h._signedUrl = await window.AppDataStore.resolveAttachmentSrc(h.image_url); } catch(e) {}
        }));
    }

    // --- Totals & summary sync ---
    const totalPoints  = myRewards.reduce((s, r) => s + (parseInt(r.fudi_points)    || 0), 0);
    const totalReturns = myRewards.reduce((s, r) => s + (parseFloat(r.sharing_return) || 0), 0);
    if (myRewards.length > 0) { try { await window._fv.syncFudiSummary(currentUser.id, totalPoints, totalReturns); } catch(e) {} }

    // --- Helper: pre-signed image src attr ---
    const imgSrc = (h) => h._signedUrl ? `src="${h._signedUrl}"` : '';

    // --- Summary tiles (L13/14) ---
    const summaryBanner = isL1314 ? `
        <div class="fude-summary-grid">
            <div class="fude-summary-tile" style="background:linear-gradient(135deg,#be185d,#e91e8c);">
                <div class="fude-summary-tile-val">${totalPoints}</div>
                <div class="fude-summary-tile-label">福气 Points</div>
            </div>
            <div class="fude-summary-tile" style="background:linear-gradient(135deg,#065f46,#10b981);">
                <div class="fude-summary-tile-val">RM ${totalReturns.toFixed(2)}</div>
                <div class="fude-summary-tile-label">Sharing Returns</div>
            </div>
        </div>` : '';

    // --- Admin: leaderboard ---
    const leaderboardSection = isAdmin ? (() => {
        const totals = {};
        allRewards.forEach(r => {
            if (!totals[r.user_id]) totals[r.user_id] = { pts: 0, ret: 0 };
            totals[r.user_id].pts += parseInt(r.fudi_points)    || 0;
            totals[r.user_id].ret += parseFloat(r.sharing_return) || 0;
        });
        const ranked = Object.entries(totals)
            .map(([uid, t]) => { const u = allUsersForReward.find(u => u.id === parseInt(uid)); return { name: u?.full_name || 'User ' + uid, ...t }; })
            .sort((a, b) => b.pts - a.pts);
        if (!ranked.length) return '';
        const medals = ['🥇','🥈','🥉'];
        return `<div class="fude-section">
            <div class="fude-sec-bar"><div class="fude-sec-bar-icon news">🏆</div><h2>福气 Leaderboard</h2></div>
            <div class="fude-sec-body"><div style="overflow-x:auto;"><table class="data-table"><thead><tr>
                <th scope="col">#</th><th scope="col">Name</th><th scope="col">福气 Points</th><th scope="col">Sharing Returns (RM)</th>
            </tr></thead><tbody>
                ${ranked.map((r, i) => `<tr>
                    <td>${medals[i] || (i + 1)}</td>
                    <td style="font-weight:600;">${escapeHtml(r.name)}</td>
                    <td>${r.pts}</td>
                    <td>${r.ret.toFixed(2)}</td>
                </tr>`).join('')}
            </tbody></table></div></div>
        </div>`;
    })() : '';

    // --- Admin: manage highlights table ---
    const adminHighlightsSection = isAdmin ? `
        <div class="fude-section">
            <div class="fude-sec-bar" style="justify-content:space-between;">
                <div style="display:flex;align-items:center;gap:12px;"><div class="fude-sec-bar-icon news">⚙️</div><h2>Manage Highlights &amp; Stories</h2></div>
                <button class="btn primary btn-sm" onclick="app.openHighlightModal()"><i class="fas fa-plus"></i> Add New</button>
            </div>
            <div class="fude-sec-body"><div style="overflow-x:auto;"><table class="data-table"><thead><tr>
                <th scope="col">Title</th><th scope="col">Type</th><th scope="col">Status</th><th scope="col">Created</th><th scope="col">Actions</th>
            </tr></thead><tbody>
                ${highlights.length ? highlights.map(h => `<tr>
                    <td style="max-width:240px;overflow:hidden;text-overflow:ellipsis;">${escapeHtml(h.title || '')}</td>
                    <td>${badge(h.type || '-', '#e0e7ff', '#3730a3')}</td>
                    <td>${badge(h.is_active ? 'Active' : 'Hidden', h.is_active ? '#d1fae5' : '#f3f4f6', h.is_active ? '#065f46' : '#6b7280')}</td>
                    <td>${fmtDate(h.created_at)}</td>
                    <td style="white-space:nowrap;">
                        <button class="btn secondary btn-sm" onclick="event.stopPropagation();app.openHighlightModal(${h.id})"><i class="fas fa-edit"></i></button>
                        <button class="btn danger btn-sm" style="margin-left:4px;" onclick="event.stopPropagation();app.deleteHighlight(${h.id})"><i class="fas fa-trash"></i></button>
                    </td>
                </tr>`).join('') : '<tr><td colspan="5" style="text-align:center;color:var(--gray-400);">No highlights yet.</td></tr>'}
            </tbody></table></div></div>
        </div>` : '';

    // --- Admin: manage rewards table ---
    const adminRewardsSection = isAdmin ? `
        <div class="fude-section">
            <div class="fude-sec-bar" style="justify-content:space-between;">
                <div style="display:flex;align-items:center;gap:12px;"><div class="fude-sec-bar-icon gem">🎁</div><h2>Manage Rewards &amp; 福气 Points</h2></div>
                <button class="btn primary btn-sm" onclick="app.openRewardModal()"><i class="fas fa-plus"></i> Award Points</button>
            </div>
            <div class="fude-sec-body"><div style="overflow-x:auto;"><table class="data-table"><thead><tr>
                <th scope="col">User</th><th scope="col">Action</th><th scope="col">福气 Pts</th><th scope="col">Sharing Return</th><th scope="col">Description</th><th scope="col">Date</th><th scope="col"></th>
            </tr></thead><tbody>
                ${allRewards.length ? allRewards.map(r => {
                    const u = allUsersForReward.find(u => u.id === r.user_id);
                    return `<tr>
                        <td style="font-weight:600;">${u ? escapeHtml(u.full_name || '') : 'User ' + r.user_id}</td>
                        <td>${badge(r.action_type || '-', '#e0e7ff', '#3730a3')}</td>
                        <td>${r.fudi_points || 0}</td>
                        <td>${parseFloat(r.sharing_return || 0).toFixed(2)}</td>
                        <td style="max-width:180px;overflow:hidden;text-overflow:ellipsis;">${escapeHtml(r.description || '-')}</td>
                        <td>${fmtDate(r.created_at)}</td>
                        <td><button class="btn danger btn-sm" onclick="event.stopPropagation();app.deleteReward(${r.id})"><i class="fas fa-trash"></i></button></td>
                    </tr>`;
                }).join('') : '<tr><td colspan="7" style="text-align:center;color:var(--gray-400);">No rewards yet.</td></tr>'}
            </tbody></table></div></div>
        </div>` : '';

    // --- Purchases section (L13 only) ---
    let purchasesSection = '';
    if (isCustomer) {
        const rows = myPurchases.length
            ? myPurchases.map(p => `<tr>
                <td>${escapeHtml(p.product_name || p.package_name || p.solution || '-')}</td>
                <td>${fmtAmt(p.amount || p.total_amount)}</td>
                <td>${badge(p.status || 'pending', p.status === 'completed' ? '#d1fae5' : '#fef3c7', p.status === 'completed' ? '#065f46' : '#92400e')}</td>
                <td>${fmtDate(p.purchase_date || p.created_at)}</td>
              </tr>`).join('')
            : '<tr><td colspan="4" style="text-align:center;color:var(--gray-400);">No purchases found.</td></tr>';
        purchasesSection = `<div class="fude-section">
            <div class="fude-sec-bar"><div class="fude-sec-bar-icon story">🛍️</div><h2>My Purchase History</h2></div>
            <div class="fude-sec-body"><div style="overflow-x:auto;"><table class="data-table"><thead><tr>
                <th scope="col">Product / Package</th><th scope="col">Amount</th><th scope="col">Status</th><th scope="col">Date</th>
            </tr></thead><tbody>${rows}</tbody></table></div></div></div>`;
    }

    // --- News carousel HTML ---
    const carouselSection = (() => {
        if (!publicNews.length) return `
            <div class="fude-section">
                <div class="fude-sec-bar"><div class="fude-sec-bar-icon news">📰</div><h2>Highlights &amp; News</h2></div>
                <div class="fude-sec-body"><p style="color:var(--gray-500,#6b7280);margin:0;">No highlights yet.</p></div>
            </div>`;
        const slides = publicNews.map((n, i) => `
            <div class="fude-carousel-slide" onclick="app.openStoryDetail(${n.id})" style="cursor:pointer;">
                ${n._signedUrl ? `<img loading="lazy" decoding="async" ${imgSrc(n)} alt="" onerror="this.style.display='none'">` : ''}
                <div class="fude-carousel-overlay">
                    <span class="fude-carousel-badge">${i === 0 ? 'Latest News' : 'News'}</span>
                    <h3>${escapeHtml(n.title || '')}</h3>
                    ${n.content ? `<p>${escapeHtml(n.content)}</p>` : ''}
                    <span class="fude-carousel-date">📅 ${fmtDate(n.created_at)}</span>
                    <button class="fude-carousel-readmore" onclick="event.stopPropagation(); app.openStoryDetail(${n.id})">Read More</button>
                </div>
            </div>`).join('');
        const dots = publicNews.length > 1
            ? `<div class="fude-carousel-dots">${publicNews.map((_, i) => `<button class="fude-carousel-dot${i === 0 ? ' active' : ''}" data-idx="${i}"></button>`).join('')}</div>`
            : '';
        const arrows = publicNews.length > 1
            ? `<button class="fude-carousel-arrow prev" onclick="event.stopPropagation();(function(){var w=this.closest('.fude-carousel-wrap');var t=w.querySelector('.fude-carousel-track');var n=parseInt(t.dataset.idx||0);var tot=t.children.length;var ni=(n-1+tot)%tot;t.dataset.idx=ni;t.style.transform='translateX(-'+ni*100+'%)';w.querySelectorAll('.fude-carousel-dot').forEach(function(d,i){d.classList.toggle('active',i===ni);});}).call(this)">&#8249;</button>
              <button class="fude-carousel-arrow next" onclick="event.stopPropagation();(function(){var w=this.closest('.fude-carousel-wrap');var t=w.querySelector('.fude-carousel-track');var n=parseInt(t.dataset.idx||0);var tot=t.children.length;var ni=(n+1)%tot;t.dataset.idx=ni;t.style.transform='translateX(-'+ni*100+'%)';w.querySelectorAll('.fude-carousel-dot').forEach(function(d,i){d.classList.toggle('active',i===ni);});}).call(this)">&#8250;</button>`
            : '';
        return `
            <div class="fude-section">
                <div class="fude-sec-bar" style="justify-content:space-between;">
                    <div style="display:flex;align-items:center;gap:12px;"><div class="fude-sec-bar-icon news">📰</div><h2>Highlights &amp; News</h2></div>
                    <a class="fude-sec-link">See all news →</a>
                </div>
                <div class="fude-carousel-wrap">
                    ${arrows}
                    <div class="fude-carousel-track" data-idx="0">${slides}</div>
                </div>
                ${dots}
            </div>`;
    })();

    // --- Success Stories grid ---
    const storiesSection = (() => {
        const PREVIEW = 6;
        const shown = successStories.slice(0, PREVIEW);
        const hasMore = successStories.length > PREVIEW;
        if (!successStories.length) return `
            <div class="fude-section fude-stories-section">
                <div class="fude-stories-masthead">
                    <div class="fude-stories-masthead-line"></div>
                    <div class="fude-stories-masthead-center">
                        <div class="fude-stories-masthead-icon">🏆</div>
                        <div class="fude-stories-title">成功案例分享</div>
                        <div class="fude-stories-subtitle">Success&nbsp;&nbsp;Stories</div>
                    </div>
                    <div class="fude-stories-masthead-line"></div>
                </div>
                <div style="padding:20px;color:var(--gray-500,#6b7280);">No success stories yet.</div>
            </div>`;
        const cards = shown.map((s) => {
            const imgEl = s._signedUrl
                ? `<img loading="lazy" decoding="async" class="fude-story-card-img" ${imgSrc(s)} alt="" onerror="this.style.display='none';this.nextElementSibling.style.display='flex'">`
                : '';
            const ph = `<div class="fude-story-card-img-ph" style="display:${s._signedUrl ? 'none' : 'flex'};">📖</div>`;
            const tags = (s.tags || '').split(',').filter(Boolean).slice(0, 2)
                .map(t => `<span class="fude-story-tag">${escapeHtml(t.trim())}</span>`).join('');
            return `<div class="fude-story-card" onclick="app.openStoryDetail(${s.id})" style="cursor:pointer;">
                ${imgEl}${ph}
                <div class="fude-story-card-body">
                    ${tags ? `<div class="fude-story-card-tags">${tags}</div>` : ''}
                    <h3>${escapeHtml(s.title || '')}</h3>
                    ${s.content ? `<p>${escapeHtml(s.content)}</p>` : '<p style="flex:1"></p>'}
                    <div class="fude-story-card-footer">
                        <div class="fude-story-card-meta">
                            <div class="fude-story-card-avatar">${escapeHtml((s.title || 'D')[0].toUpperCase())}</div>
                            <span>${fmtDate(s.created_at)}</span>
                        </div>
                        <button class="fude-story-readmore" onclick="event.stopPropagation(); app.openStoryDetail(${s.id})">Read More →</button>
                    </div>
                </div>
            </div>`;
        }).join('');
        return `
            <div class="fude-section fude-stories-section">
                <div class="fude-stories-masthead">
                    <div class="fude-stories-masthead-line"></div>
                    <div class="fude-stories-masthead-center">
                        <div class="fude-stories-masthead-icon">🏆</div>
                        <div class="fude-stories-title">成功案例分享</div>
                        <div class="fude-stories-subtitle">Success&nbsp;&nbsp;Stories</div>
                    </div>
                    <div class="fude-stories-masthead-line"></div>
                </div>
                <div class="fude-story-grid">${cards}</div>
                ${hasMore ? `<button class="fude-stories-more-btn">✦ Explore More Success Stories</button>` : ''}
            </div>`;
    })();

    // --- Tips row (dynamic + 2 static) ---
    const dynamicTips = recommendationTips.slice(0, 1);
    const tipsSection = (() => {
        const tipCols = [];
        if (dynamicTips.length) {
            tipCols.push(`<div class="fude-tip-col">
                <div class="fude-tip-icon">💡</div>
                <h3>${escapeHtml(dynamicTips[0].title || '')}</h3>
                ${dynamicTips[0].content ? `<p>${escapeHtml(dynamicTips[0].content)}</p>` : ''}
                <button class="fude-tip-link">Learn More →</button>
            </div>`);
        } else {
            tipCols.push(`<div class="fude-tip-col">
                <div class="fude-tip-icon">🛡️</div>
                <h3>账户安全</h3>
                <p>定期更新密码，避免使用常见密码，并开启双重验证，防止账户被盗用。</p>
                <button class="fude-tip-link">Learn More →</button>
            </div>`);
        }
        tipCols.push(`<div class="fude-tip-col">
            <div class="fude-tip-icon">🎁</div>
            <h3>积分攻略</h3>
            <p>每日签到、参与活动、分享推荐好友，都能累积积分！</p>
            <button class="fude-tip-link">Learn More →</button>
        </div>`);
        tipCols.push(`<div class="fude-tip-col">
            <div class="fude-tip-icon" style="background:#fee2e2;">🎧</div>
            <h3>需要帮助?</h3>
            <p>遇到问题？我们的客服团队随时为您提供支持。</p>
            <button class="fude-tip-link">Contact Us →</button>
        </div>`);
        return `
            <div class="fude-tips-section">
                <div class="fude-tips-header">
                    <span class="fude-tips-header-icon">💡</span>
                    <h2>今日 Tips</h2>
                </div>
                <div class="fude-tips-row">${tipCols.join('')}</div>
            </div>`;
    })();

    // --- My Recommendations & Returns ---
    const rewardsTableHtml = myRewards.length === 0
        ? '<p style="color:var(--gray-500,#6b7280);margin:8px 0 0;">No recommendations or rewards yet.</p>'
        : `<div style="overflow-x:auto;"><table class="data-table"><thead><tr>
            <th scope="col">Action</th><th scope="col">福气 Points</th><th scope="col">Sharing Return (RM)</th><th scope="col">Description</th><th scope="col">Date</th>
           </tr></thead><tbody>
            ${myRewards.map(r => `<tr>
                <td>${badge(r.action_type || '-', '#e0e7ff', '#3730a3')}</td>
                <td style="font-weight:600;">${r.fudi_points || 0}</td>
                <td>${parseFloat(r.sharing_return || 0).toFixed(2)}</td>
                <td style="max-width:180px;overflow:hidden;text-overflow:ellipsis;">${escapeHtml(r.description || '-')}</td>
                <td>${fmtDate(r.created_at)}</td>
            </tr>`).join('')}
           </tbody></table></div>`;

    const returnsSection = `
        <div class="fude-returns-section">
            <div class="fude-returns-header">
                <h2>My Recommendations &amp; Returns</h2>
                <button class="fude-returns-viewall" onclick="(function(btn){var d=btn.closest('.fude-returns-section').querySelector('.fude-rewards-detail');var ic=btn.closest('.fude-returns-section').querySelector('.fude-rewards-toggle');d.classList.toggle('open');ic.querySelector('.fude-rewards-toggle-icon').classList.toggle('open');btn.textContent=d.classList.contains('open')?'View less':'View all →';}).call(this, this)">View all →</button>
            </div>
            <div class="fude-returns-cards">
                <div class="fude-returns-card">
                    <div class="fude-returns-card-img-ph pink">🎀</div>
                    <div class="fude-returns-card-body">
                        <h3>推荐奖励</h3>
                        <p>推荐好友加入，双方都能获得积分奖励！</p>
                        <button class="fude-returns-card-cta">Learn More →</button>
                    </div>
                </div>
            </div>
            <div class="fude-rewards-table-wrap">
                <button class="fude-rewards-toggle">
                    <span class="fude-rewards-toggle-icon">▾</span>
                    积分 &amp; 推荐记录 (${myRewards.length})
                </button>
                <div class="fude-rewards-detail">${rewardsTableHtml}</div>
            </div>
        </div>`;

    // --- Render ---
    container.innerHTML = `
        <div class="fude-tab">
            <div class="fude-inner">
                ${summaryBanner}
                ${isL1314 && totalPoints > 0 ? `
                <div class="fude-points-banner">
                    <span class="fude-points-banner-text">🎉 当前累积 <strong>${totalPoints}</strong> 福气积分，可兑换精选奖励！</span>
                    <button class="fude-points-banner-cta" onclick="app.todo('Redeem Points')">立即兑换 →</button>
                </div>` : ''}
                ${leaderboardSection}
                ${adminHighlightsSection}
                ${adminRewardsSection}
            </div>
            ${carouselSection}
            ${storiesSection}
            ${purchasesSection}
        </div>
    `;

    // Wire carousel dot clicks
    container.querySelectorAll('.fude-carousel-dot').forEach((dot, i) => {
        dot.addEventListener('click', () => {
            const track = dot.closest('.fude-carousel-wrap').querySelector('.fude-carousel-track');
            track.dataset.idx = i;
            track.style.transform = `translateX(-${i * 100}%)`;
            dot.closest('.fude-carousel-dots').querySelectorAll('.fude-carousel-dot').forEach((d, j) => d.classList.toggle('active', j === i));
        });
    });
};

// ══════════════ showBossReportView ══════════════
window._fv.showBossReportView = async (container) => {
    const _currentUser = window._appState?.cu;
    const { isSystemAdmin } = window._crmUtils || {};

    window._appState.currentView = 'boss_report';
    if (!isSystemAdmin(_currentUser)) {
        container.innerHTML = `<div class="placeholder-view"><h1>Access Denied</h1><p>Boss Report is restricted to Super Admin only.</p></div>`;
        return;
    }

    const runs = (await window.AppDataStore.query('egg_run_history', {})||[])
        .sort((a,b) => new Date(b.run_at)-new Date(a.run_at));

    const bals = window._brGetBals();
    const mk   = window._brMonthKey();
    const tgts = window._brGetTgts(mk);
    const now  = new Date();
    const monthLabel = now.toLocaleString('default', { month:'long', year:'numeric' });

    window._brState.skusMap = window._brGetSkus();
    const skusDate = localStorage.getItem('br_skus_date');

    const runOpts = runs.map(r => {
        const cartons = (r.totals?.KL?.GOLD||0)+(r.totals?.KL?.KING||0)+(r.totals?.PG?.GOLD||0)+(r.totals?.PG?.KING||0);
        const label = `Week ${r.week_start_date} • ${r.run_at ? new Date(r.run_at).toLocaleString() : ''} • ${cartons} cartons`;
        return `<option value="${r.id}">${label}</option>`;
    }).join('');

    const balGroups = [
        { key:'oceanSold', label:'Ocean sold' },
        { key:'yangPower', label:'Yang power sold' },
        { key:'d3k2',      label:'D3k2 Sold' },
        { key:'eyePlus',   label:'Eye+' },
    ];
    const tgtGroups = [
        { key:'klKepong',  label:'KL Kepong + SG Puchong & Sunway' },
        { key:'klCheras',  label:'KL Cheras' },
        { key:'pgCenter',  label:'PG Center' },
        { key:'pgMainland',label:'PG Mainland' },
        { key:'pgSouth',   label:'PG South' },
    ];

    const balInputs = balGroups.map(g=>`
            <div style="display:flex;align-items:center;gap:10px;margin-bottom:8px;">
                <label style="width:160px;font-size:13px;color:var(--gray-700);">${g.label}</label>
                <input type="number" id="br-bal-${g.key}" class="form-control" style="width:110px;"
                    value="${bals[g.key]||''}" placeholder="0" min="0">
            </div>`).join('');

    const tgtInputs = tgtGroups.map(g=>`
            <div style="display:flex;align-items:center;gap:10px;margin-bottom:8px;">
                <label style="width:260px;font-size:13px;color:var(--gray-700);">${g.label}</label>
                <input type="number" id="br-tgt-${g.key}" class="form-control" style="width:110px;"
                    value="${tgts[g.key]||''}" placeholder="0" min="0">
            </div>`).join('');

    container.innerHTML = `
        <div style="padding:24px;max-width:860px;">
            <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:20px;">
                <div>
                    <h1 style="margin:0;display:flex;align-items:center;gap:10px;">
                        <i class="fas fa-chart-bar" style="color:#8b5cf6;"></i> Boss Report
                    </h1>
                    <div style="color:var(--gray-500);font-size:13px;margin-top:4px;">Weekly boss summary generator • Super Admin only</div>
                </div>
            </div>

            <!-- 1. Egg Run -->
            <div style="background:white;padding:20px;border-radius:12px;border:1px solid var(--gray-200);margin-bottom:16px;">
                <h3 style="margin-top:0;margin-bottom:6px;">1. Select Egg Purchase Run</h3>
                <p style="color:var(--gray-500);font-size:13px;margin:0 0 12px;">Egg KL/PG/JB totals and wholesales group data are read directly from the committed run.</p>
                ${runs.length===0
                    ? '<p style="color:#ef4444;margin:0;">No committed egg runs found.</p>'
                    : `<select id="br-run-select" class="form-control" style="max-width:620px;">
                           <option value="">— Select a run —</option>${runOpts}
                       </select>`}
            </div>

            <!-- 2. Product Balance Files -->
            <div style="background:white;padding:20px;border-radius:12px;border:1px solid var(--gray-200);margin-bottom:16px;">
                <h3 style="margin-top:0;margin-bottom:6px;">2. Product Balance Files</h3>
                <p style="color:var(--gray-500);font-size:13px;margin:0 0 16px;">Upload both sales files each week. SKUs mapping is one-time and auto-cached.</p>
                <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:12px;margin-bottom:20px;">
                    <div style="border:2px dashed var(--gray-300);border-radius:8px;padding:14px;text-align:center;cursor:pointer;" onclick="document.getElementById('br-inp-sales').click()">
                        <i class="fas fa-file-excel" style="font-size:22px;color:#16a34a;display:block;margin-bottom:6px;"></i>
                        <div style="font-weight:600;font-size:13px;">FORMULA Sales</div>
                        <div style="font-size:11px;color:var(--gray-500);">POS retail (.xlsx)</div>
                        <div id="br-lbl-sales" style="font-size:11px;color:#059669;margin-top:4px;min-height:14px;"></div>
                        <input type="file" id="br-inp-sales" accept=".xlsx" style="display:none;" onchange="app.brLoadSales(this)">
                    </div>
                    <div style="border:2px dashed var(--gray-300);border-radius:8px;padding:14px;text-align:center;cursor:pointer;" onclick="document.getElementById('br-inp-track').click()">
                        <i class="fas fa-file-csv" style="font-size:22px;color:#2563eb;display:block;margin-bottom:6px;"></i>
                        <div style="font-weight:600;font-size:13px;">Order Tracking</div>
                        <div style="font-size:11px;color:var(--gray-500);">Online sales (.csv)</div>
                        <div id="br-lbl-track" style="font-size:11px;color:#059669;margin-top:4px;min-height:14px;"></div>
                        <input type="file" id="br-inp-track" accept=".csv" style="display:none;" onchange="app.brLoadTracking(this)">
                    </div>
                    <div style="border:2px dashed var(--gray-300);border-radius:8px;padding:14px;text-align:center;cursor:pointer;" onclick="document.getElementById('br-inp-skus').click()">
                        <i class="fas fa-table" style="font-size:22px;color:#f59e0b;display:block;margin-bottom:6px;"></i>
                        <div style="font-weight:600;font-size:13px;">SKUs Mapping</div>
                        <div style="font-size:11px;color:var(--gray-500);">One-time (.xlsx)</div>
                        <div id="br-lbl-skus" style="font-size:11px;color:#059669;margin-top:4px;min-height:14px;">${window._brState.skusMap ? `Cached ${skusDate||''}` : 'Not loaded'}</div>
                        <input type="file" id="br-inp-skus" accept=".xlsx" style="display:none;" onchange="app.brLoadSkus(this)">
                    </div>
                </div>
                <div style="font-weight:600;font-size:13px;margin-bottom:10px;">Last week's balances</div>
                ${balInputs}
            </div>

            <!-- 3. Monthly Targets -->
            <div style="background:white;padding:20px;border-radius:12px;border:1px solid var(--gray-200);margin-bottom:20px;">
                <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px;">
                    <h3 style="margin:0;">3. Monthly Targets — ${monthLabel}</h3>
                    <button class="btn secondary" style="font-size:12px;" onclick="app.brSaveTargets()"><i class="fas fa-save"></i> Save</button>
                </div>
                <p style="color:var(--gray-500);font-size:13px;margin:0 0 14px;">Set once on the 1st of each month. Carton targets per wholesale group.</p>
                ${tgtInputs}
            </div>

            <button class="btn primary" style="width:100%;padding:14px;font-size:15px;margin-bottom:20px;" onclick="app.brGenerate()">
                <i class="fas fa-magic"></i> Generate Boss Report
            </button>

            <!-- Output -->
            <div id="br-output" style="display:none;background:white;padding:20px;border-radius:12px;border:1px solid var(--gray-200);">
                <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px;">
                    <h3 style="margin:0;">Report</h3>
                    <div style="display:flex;gap:8px;">
                        <button class="btn secondary" onclick="app.brCopy()"><i class="fas fa-copy"></i> Copy</button>
                        <button class="btn primary" onclick="app.brSaveFinal()"><i class="fas fa-save"></i> Save Final</button>
                    </div>
                </div>
                <p style="color:var(--gray-500);font-size:12px;margin:0 0 10px;">Edit any values below, then click <strong>Save Final</strong>. Next week's balance fields will pre-fill from what you save here.</p>
                <textarea id="br-text" class="form-control" style="width:100%;min-height:520px;font-family:monospace;font-size:13px;"></textarea>
            </div>
        </div>`;
};

// ══════════════ showKnowledgeView ══════════════
window._fv.showKnowledgeView = async (container) => {
    // Mutable KB state lives on window._appState to survive across module boundary
    if (window._appState.kbSegment === undefined) window._appState.kbSegment = 'dashboard';
    if (window._appState.kbCurrentEntryId === undefined) window._appState.kbCurrentEntryId = null;
    if (window._appState.kbAllFilter === undefined) window._appState.kbAllFilter = 'all';
    if (window._appState.kbDailyDate === undefined) window._appState.kbDailyDate = null;
    if (window._appState.kbAutosaveTimer === undefined) window._appState.kbAutosaveTimer = null;

    const { escapeHtml } = window._crmUtils || {};

    // ── Local helpers (inlined from IIFE closure) ────────────────────────────

    const _kbOwnerId = async () => {
        try {
            const { data: { session } } = await window.supabase.auth.getSession();
            return session?.user?.id || null;
        } catch (_) { return null; }
    };

    const _kbTodayISO = () => {
        const d = new Date();
        return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
    };

    const _kbFmtDate = (iso) => {
        if (!iso) return '';
        try { return new Date(iso).toLocaleDateString(); } catch (_) { return iso; }
    };

    const _kbTypeLabel = (t) => ({
        idea: 'Idea', task: 'Task', case_study: 'Case Study',
        note: 'Note', reference: 'Reference'
    })[t] || 'Inbox';

    const _kbTypeIcon = (t) => ({
        idea: 'fa-lightbulb', task: 'fa-check-square', case_study: 'fa-flask',
        note: 'fa-note-sticky', reference: 'fa-bookmark'
    })[t] || 'fa-inbox';

    const _kbStatusLabel = (s) => ({
        draft: 'Draft', active: 'Active', waiting: 'Waiting',
        done: 'Done', archived: 'Archived'
    })[s] || s || '';

    // ── Segment renderer ─────────────────────────────────────────────────────

    const _kbRenderSegment = async () => {
        const slot = document.getElementById('kb-slot');
        if (!slot) return;
        if (window._appState.kbCurrentEntryId) return showKnowledgeDetail(window._appState.kbCurrentEntryId);
        if (window._appState.kbSegment === 'dashboard') return showKnowledgeDashboard(slot);
        if (window._appState.kbSegment === 'capture')   return showKnowledgeCapture(slot);
        if (window._appState.kbSegment === 'all')       return showKnowledgeAllEntries(slot);
        if (window._appState.kbSegment === 'daily')     return showKnowledgeDailyNotes(slot);
    };

    // ── Dashboard ────────────────────────────────────────────────────────────

    const showKnowledgeDashboard = async (slot) => {
        slot.innerHTML = `
            <div class="kb-quick-capture">
                <input type="text" id="kb-qc-title" class="kb-input" placeholder="What's on your mind? (title)" maxlength="200">
                <textarea id="kb-qc-content" class="kb-textarea" rows="3" placeholder="Optional notes... (Ctrl+Enter to save)"></textarea>
                <div class="kb-qc-actions">
                    <span class="kb-qc-hint">No type required — classify later during review.</span>
                    <button class="btn primary" onclick="app.saveQuickCapture()"><i class="fas fa-bolt"></i> Capture</button>
                </div>
            </div>
            <div class="kb-dash-grid">
                <div class="kb-card" id="kb-card-inbox"><div class="kb-card-h"><i class="fas fa-inbox"></i> Inbox <span class="kb-count" id="kb-cnt-inbox">·</span></div><div class="kb-card-body" id="kb-list-inbox"><div class="kb-empty">Loading…</div></div></div>
                <div class="kb-card" id="kb-card-tasks"><div class="kb-card-h"><i class="fas fa-check-square"></i> Today's Tasks <span class="kb-count" id="kb-cnt-tasks">·</span></div><div class="kb-card-body" id="kb-list-tasks"><div class="kb-empty">Loading…</div></div></div>
                <div class="kb-card" id="kb-card-ideas"><div class="kb-card-h"><i class="fas fa-lightbulb"></i> Recent Ideas <span class="kb-count" id="kb-cnt-ideas">·</span></div><div class="kb-card-body" id="kb-list-ideas"><div class="kb-empty">Loading…</div></div></div>
                <div class="kb-card" id="kb-card-cases"><div class="kb-card-h"><i class="fas fa-flask"></i> In-progress Case Studies <span class="kb-count" id="kb-cnt-cases">·</span></div><div class="kb-card-body" id="kb-list-cases"><div class="kb-empty">Loading…</div></div></div>
            </div>
        `;
        const ta = document.getElementById('kb-qc-content');
        if (ta) ta.addEventListener('keydown', (e) => {
            if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); saveQuickCapture(); }
        });
        await _kbReloadDashboard();
    };

    const _kbReloadDashboard = async () => {
        const owner = await _kbOwnerId();
        if (!owner) {
            const slot = document.getElementById('kb-slot');
            if (slot) slot.innerHTML = '<div class="kb-empty" style="padding:40px;">Sign in to use Knowledge HQ.</div>';
            return;
        }
        let all = [];
        try {
            all = await window.AppDataStore.query('knowledge_entries', { owner_id: owner }) || [];
        } catch (e) {
            const slot = document.getElementById('kb-slot');
            if (slot) slot.innerHTML = `<div class="kb-empty" style="padding:40px;">Knowledge HQ tables not yet provisioned. Run <code>migrations/knowledge_hub_2026-05-09.sql</code> in Supabase SQL editor, then reload.</div>`;
            return;
        }
        const today = _kbTodayISO();
        const inbox  = all.filter(e => !e.type).sort((a,b)=> (b.created_at||'').localeCompare(a.created_at||'')).slice(0, 8);
        const tasks  = all.filter(e => e.type==='task' && ['draft','active','waiting'].includes(e.status||'draft') && e.due_date===today).sort((a,b)=> (a.priority||'').localeCompare(b.priority||''));
        const ideas  = all.filter(e => e.type==='idea').sort((a,b)=> (b.created_at||'').localeCompare(a.created_at||'')).slice(0, 5);
        const cases  = all.filter(e => e.type==='case_study' && (e.status||'')!=='done').slice(0, 8);
        _kbRenderList('kb-list-inbox', 'kb-cnt-inbox', inbox, 'No uncategorized entries. Inbox zero.');
        _kbRenderList('kb-list-tasks', 'kb-cnt-tasks', tasks, 'No tasks due today.');
        _kbRenderList('kb-list-ideas', 'kb-cnt-ideas', ideas, 'No ideas yet.');
        _kbRenderList('kb-list-cases', 'kb-cnt-cases', cases, 'No active case studies.');
    };

    const _kbRenderList = (slotId, cntId, rows, emptyMsg) => {
        const slot = document.getElementById(slotId);
        const cnt  = document.getElementById(cntId);
        if (cnt) cnt.textContent = rows.length;
        if (!slot) return;
        if (!rows.length) { slot.innerHTML = `<div class="kb-empty">${escapeHtml(emptyMsg)}</div>`; return; }
        slot.innerHTML = rows.map(r => `
            <div class="kb-row" onclick="app.showKnowledgeDetail('${r.id}')">
                <i class="fas ${_kbTypeIcon(r.type)} kb-row-icon" title="${_kbTypeLabel(r.type)}"></i>
                <div class="kb-row-main">
                    <div class="kb-row-title">${escapeHtml(r.title || '(untitled)')}</div>
                    ${r.tags && r.tags.length ? `<div class="kb-row-tags">${r.tags.map(t=>`<span class="kb-tag">${escapeHtml(t)}</span>`).join('')}</div>` : ''}
                </div>
                <div class="kb-row-meta">${_kbFmtDate(r.due_date || r.created_at)}</div>
            </div>
        `).join('');
    };

    const saveQuickCapture = async () => {
        const titleEl = document.getElementById('kb-qc-title');
        const contentEl = document.getElementById('kb-qc-content');
        const title = (titleEl?.value || '').trim();
        const content = (contentEl?.value || '').trim();
        if (!title) { window.UI.toast.error('Title required'); titleEl?.focus(); return; }
        const owner = await _kbOwnerId();
        if (!owner) { window.UI.toast.error('Sign in first'); return; }
        try {
            await window.AppDataStore.create('knowledge_entries', {
                owner_id: owner, title, content, type: null, status: 'draft', tags: []
            });
            if (titleEl)   titleEl.value = '';
            if (contentEl) contentEl.value = '';
            window.UI.toast.success('Captured');
            await _kbReloadDashboard();
        } catch (e) {
            window.UI.toast.error('Save failed: ' + (e?.message || e));
        }
    };

    // ── Capture full ─────────────────────────────────────────────────────────

    const showKnowledgeCapture = async (slot) => {
        slot.innerHTML = `
            <div class="kb-capture-full">
                <input type="text" id="kb-cap-title" class="kb-input kb-input-lg" placeholder="Title (short)" maxlength="200">
                <textarea id="kb-cap-content" class="kb-textarea kb-textarea-lg" rows="14" placeholder="Free text or markdown...&#10;&#10;Ctrl+Enter to save."></textarea>
                <div class="kb-cap-actions">
                    <button class="btn primary" onclick="app.saveCaptureFull()"><i class="fas fa-save"></i> Save</button>
                    <button class="btn secondary" onclick="app.saveCaptureFull('task')"><i class="fas fa-check-square"></i> Save as Task</button>
                    <button class="btn secondary" onclick="app.saveCaptureFull('case_study')"><i class="fas fa-flask"></i> Save as Case Study</button>
                    <button class="btn secondary" onclick="app.saveCaptureFull('idea')"><i class="fas fa-lightbulb"></i> Save as Idea</button>
                </div>
                <p class="kb-qc-hint" style="margin-top:8px;">Tip: leave type blank to land in Inbox and classify later.</p>
            </div>
        `;
        const ta = document.getElementById('kb-cap-content');
        if (ta) ta.addEventListener('keydown', (e) => {
            if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); saveCaptureFull(); }
        });
    };

    const saveCaptureFull = async (type = null) => {
        const title = (document.getElementById('kb-cap-title')?.value || '').trim();
        const content = (document.getElementById('kb-cap-content')?.value || '').trim();
        if (!title) { window.UI.toast.error('Title required'); return; }
        const owner = await _kbOwnerId();
        if (!owner) { window.UI.toast.error('Sign in first'); return; }
        try {
            const row = await window.AppDataStore.create('knowledge_entries', {
                owner_id: owner, title, content, type, status: 'draft', tags: []
            });
            window.UI.toast.success(type ? `Saved as ${_kbTypeLabel(type)}` : 'Saved to Inbox');
            const id = row?.id || (Array.isArray(row) ? row[0]?.id : null);
            if (id) showKnowledgeDetail(id); else { window._appState.kbSegment = 'dashboard'; await window._fv.showKnowledgeView(document.getElementById('content-viewport')); }
        } catch (e) {
            window.UI.toast.error('Save failed: ' + (e?.message || e));
        }
    };

    // ── All entries ──────────────────────────────────────────────────────────

    const showKnowledgeAllEntries = async (slot) => {
        slot.innerHTML = `
            <div class="kb-all-bar">
                <div class="kb-chips">
                    ${['all','inbox','idea','task','case_study','note','reference','done','archived'].map(f =>
                        `<button class="kb-chip ${window._appState.kbAllFilter===f?'active':''}" onclick="app.filterKnowledgeEntries('${f}')">${
                            f==='all'?'All':f==='inbox'?'Inbox':f==='case_study'?'Case Studies':f==='idea'?'Ideas':f==='task'?'Tasks':f==='note'?'Notes':f==='reference'?'References':f==='done'?'Done':'Archived'
                        }</button>`).join('')}
                </div>
                <div class="kb-search">
                    <i class="fas fa-search"></i>
                    <input type="text" id="kb-search-input" placeholder="Search title + content..." oninput="app.debounceCall('kb-search', () => app.searchKnowledgeEntries(this.value), 250)">
                </div>
            </div>
            <div id="kb-all-list" class="kb-all-list"><div class="kb-empty">Loading…</div></div>
        `;
        await _kbReloadAll('');
    };

    const filterKnowledgeEntries = async (f) => {
        window._appState.kbAllFilter = f;
        document.querySelectorAll('.kb-chip').forEach(c => c.classList.remove('active'));
        const btn = Array.from(document.querySelectorAll('.kb-chip')).find(c => c.getAttribute('onclick')?.includes(`'${f}'`));
        if (btn) btn.classList.add('active');
        const q = document.getElementById('kb-search-input')?.value || '';
        await _kbReloadAll(q);
    };

    const searchKnowledgeEntries = async (q) => { await _kbReloadAll(q || ''); };

    const _kbReloadAll = async (q) => {
        const slot = document.getElementById('kb-all-list');
        if (!slot) return;
        const owner = await _kbOwnerId();
        if (!owner) { slot.innerHTML = '<div class="kb-empty">Sign in first.</div>'; return; }
        let rows = [];
        try {
            if (q && q.trim()) {
                const { data, error } = await window.supabase.rpc('knowledge_search', { q: q.trim() });
                if (error) throw error;
                rows = data || [];
            } else {
                rows = await window.AppDataStore.query('knowledge_entries', { owner_id: owner }) || [];
            }
        } catch (e) {
            slot.innerHTML = `<div class="kb-empty">Cannot load entries (${escapeHtml(e?.message||'unknown')}). Did you run the migration?</div>`;
            return;
        }
        const f = window._appState.kbAllFilter;
        if (f === 'inbox')                       rows = rows.filter(r => !r.type);
        else if (f === 'idea')                   rows = rows.filter(r => r.type === 'idea');
        else if (f === 'task')                   rows = rows.filter(r => r.type === 'task');
        else if (f === 'case_study')             rows = rows.filter(r => r.type === 'case_study');
        else if (f === 'note')                   rows = rows.filter(r => r.type === 'note');
        else if (f === 'reference')              rows = rows.filter(r => r.type === 'reference');
        else if (f === 'done')                   rows = rows.filter(r => r.status === 'done');
        else if (f === 'archived')               rows = rows.filter(r => r.status === 'archived');
        rows.sort((a,b) => (b.created_at||'').localeCompare(a.created_at||''));
        if (!rows.length) { slot.innerHTML = '<div class="kb-empty">No entries match.</div>'; return; }
        slot.innerHTML = `
            <table class="kb-table">
                <thead><tr><th>Title</th><th>Type</th><th>Tags</th><th>Status</th><th>Created</th><th>Due</th></tr></thead>
                <tbody>
                    ${rows.map(r => `
                        <tr onclick="app.showKnowledgeDetail('${r.id}')">
                            <td><i class="fas ${_kbTypeIcon(r.type)} kb-row-icon"></i> ${escapeHtml(r.title||'(untitled)')}</td>
                            <td>${_kbTypeLabel(r.type)}</td>
                            <td>${(r.tags||[]).map(t=>`<span class="kb-tag">${escapeHtml(t)}</span>`).join(' ')}</td>
                            <td><span class="kb-status kb-status-${r.status||'draft'}">${_kbStatusLabel(r.status)}</span></td>
                            <td>${_kbFmtDate(r.created_at)}</td>
                            <td>${r.due_date ? _kbFmtDate(r.due_date) : ''}</td>
                        </tr>
                    `).join('')}
                </tbody>
            </table>
        `;
    };

    // ── Detail view ──────────────────────────────────────────────────────────

    const showKnowledgeDetail = async (id) => {
        window._appState.kbCurrentEntryId = id;
        const slot = document.getElementById('kb-slot');
        if (!slot) return;
        slot.innerHTML = '<div class="kb-empty">Loading…</div>';
        let entry = null;
        try { entry = await window.AppDataStore.getById('knowledge_entries', id); } catch (e) { slot.innerHTML = `<div class="kb-empty">Not found.</div>`; return; }
        if (!entry) { slot.innerHTML = `<div class="kb-empty">Entry not found.</div>`; return; }
        const owner = await _kbOwnerId();
        let backlinks = [], outlinks = [];
        try { backlinks = await window.AppDataStore.query('knowledge_links', { to_entry_id: id }) || []; } catch (_) {}
        try { outlinks  = await window.AppDataStore.query('knowledge_links', { from_entry_id: id }) || []; } catch (_) {}
        const linkedIds = [...backlinks.map(l=>l.from_entry_id), ...outlinks.map(l=>l.to_entry_id)];
        let linkedRows = [];
        if (linkedIds.length) {
            try {
                const all = await window.AppDataStore.query('knowledge_entries', { owner_id: owner }) || [];
                const idx = new Map(all.map(r=>[r.id, r]));
                linkedRows = linkedIds.map(lid => idx.get(lid)).filter(Boolean);
            } catch (_) {}
        }
        slot.innerHTML = `
            <div class="kb-detail">
                <div class="kb-detail-back">
                    <button class="btn secondary" onclick="app.kbBackToSegment()"><i class="fas fa-arrow-left"></i> Back</button>
                </div>
                <div class="kb-detail-grid">
                    <div class="kb-detail-main">
                        <input type="text" id="kb-d-title" class="kb-input kb-input-lg" value="${escapeHtml(entry.title||'')}" maxlength="200" oninput="app.scheduleKnowledgeAutosave()">
                        <textarea id="kb-d-content" class="kb-textarea kb-textarea-lg" rows="20" placeholder="Markdown content..." oninput="app.scheduleKnowledgeAutosave()">${escapeHtml(entry.content||'')}</textarea>
                        <div class="kb-autosave-status" id="kb-autosave-status">Saved · ${_kbFmtDate(entry.updated_at)}</div>
                    </div>
                    <div class="kb-detail-side">
                        <div class="kb-prop"><label>Type</label>
                            <select id="kb-d-type" onchange="app.saveKnowledgeEntry()">
                                <option value="">Inbox (no type)</option>
                                <option value="idea"${entry.type==='idea'?' selected':''}>Idea</option>
                                <option value="task"${entry.type==='task'?' selected':''}>Task</option>
                                <option value="case_study"${entry.type==='case_study'?' selected':''}>Case Study</option>
                                <option value="note"${entry.type==='note'?' selected':''}>Note</option>
                                <option value="reference"${entry.type==='reference'?' selected':''}>Reference</option>
                            </select>
                        </div>
                        <div class="kb-prop"><label>Status</label>
                            <select id="kb-d-status" onchange="app.saveKnowledgeEntry()">
                                ${['draft','active','waiting','done','archived'].map(s=>`<option value="${s}"${(entry.status||'draft')===s?' selected':''}>${_kbStatusLabel(s)}</option>`).join('')}
                            </select>
                        </div>
                        <div class="kb-prop" id="kb-prop-priority" style="${entry.type==='task'?'':'display:none;'}"><label>Priority</label>
                            <select id="kb-d-priority" onchange="app.saveKnowledgeEntry()">
                                <option value="">—</option>
                                <option value="low"${entry.priority==='low'?' selected':''}>Low</option>
                                <option value="med"${entry.priority==='med'?' selected':''}>Medium</option>
                                <option value="high"${entry.priority==='high'?' selected':''}>High</option>
                            </select>
                        </div>
                        <div class="kb-prop" id="kb-prop-due" style="${entry.type==='task'?'':'display:none;'}"><label>Due date</label>
                            <input type="date" id="kb-d-due" value="${entry.due_date||''}" onchange="app.saveKnowledgeEntry()">
                        </div>
                        <div class="kb-prop"><label>Tags (comma-separated)</label>
                            <input type="text" id="kb-d-tags" value="${(entry.tags||[]).join(', ')}" oninput="app.scheduleKnowledgeAutosave()" placeholder="strategy, q2-2026">
                        </div>
                        <div class="kb-prop"><label>Convert</label>
                            <div class="kb-convert">
                                <button class="btn secondary" onclick="app.convertKnowledgeEntry('task')"><i class="fas fa-check-square"></i> → Task</button>
                                <button class="btn secondary" onclick="app.convertKnowledgeEntry('case_study')"><i class="fas fa-flask"></i> → Case Study</button>
                                <button class="btn secondary" onclick="app.convertKnowledgeEntry('idea')"><i class="fas fa-lightbulb"></i> → Idea</button>
                            </div>
                        </div>
                        <div class="kb-prop"><label>Linked entries</label>
                            <div class="kb-links" id="kb-links-list">
                                ${linkedRows.length ? linkedRows.map(l=>`
                                    <div class="kb-link-row">
                                        <span onclick="app.showKnowledgeDetail('${l.id}')"><i class="fas ${_kbTypeIcon(l.type)}"></i> ${escapeHtml(l.title||'(untitled)')}</span>
                                        <button class="kb-link-rm" onclick="app.removeKnowledgeLink('${id}','${l.id}')" title="Remove link"><i class="fas fa-times"></i></button>
                                    </div>
                                `).join('') : '<div class="kb-empty kb-empty-sm">No links yet.</div>'}
                            </div>
                            <div class="kb-link-add">
                                <input type="text" id="kb-link-search" placeholder="Find an entry to link..." oninput="app.debounceCall('kb-link-search', () => app.searchKnowledgeLinkTargets('${id}', this.value), 250)">
                                <div id="kb-link-results" class="kb-link-results"></div>
                            </div>
                        </div>
                        <div class="kb-prop kb-meta">
                            <div>Created: ${_kbFmtDate(entry.created_at)}</div>
                            <div>Updated: ${_kbFmtDate(entry.updated_at)}</div>
                        </div>
                        <div class="kb-prop">
                            <button class="btn danger" onclick="app.deleteKnowledgeEntry('${id}')"><i class="fas fa-trash"></i> Delete entry</button>
                        </div>
                    </div>
                </div>
            </div>
        `;
    };

    const kbBackToSegment = async () => {
        window._appState.kbCurrentEntryId = null;
        await window._fv.showKnowledgeView(document.getElementById('content-viewport'));
    };

    const scheduleKnowledgeAutosave = () => {
        const status = document.getElementById('kb-autosave-status');
        if (status) status.textContent = 'Saving…';
        if (window._appState.kbAutosaveTimer) clearTimeout(window._appState.kbAutosaveTimer);
        window._appState.kbAutosaveTimer = setTimeout(() => { saveKnowledgeEntry().catch(()=>{}); }, 800);
    };

    const saveKnowledgeEntry = async () => {
        if (!window._appState.kbCurrentEntryId) return;
        const id = window._appState.kbCurrentEntryId;
        const title = (document.getElementById('kb-d-title')?.value || '').trim();
        const content = document.getElementById('kb-d-content')?.value || '';
        const type = document.getElementById('kb-d-type')?.value || null;
        const status = document.getElementById('kb-d-status')?.value || 'draft';
        const priority = document.getElementById('kb-d-priority')?.value || null;
        const due_date = document.getElementById('kb-d-due')?.value || null;
        const tagsRaw = document.getElementById('kb-d-tags')?.value || '';
        const tags = tagsRaw.split(',').map(s=>s.trim()).filter(Boolean);
        const propPri = document.getElementById('kb-prop-priority');
        const propDue = document.getElementById('kb-prop-due');
        if (propPri) propPri.style.display = type === 'task' ? '' : 'none';
        if (propDue) propDue.style.display = type === 'task' ? '' : 'none';
        if (!title) { window.UI.toast.error('Title required'); return; }
        try {
            await window.AppDataStore.update('knowledge_entries', id, {
                title, content, type: type || null, status, priority: priority || null,
                due_date: due_date || null, tags
            });
            const s = document.getElementById('kb-autosave-status');
            if (s) s.textContent = 'Saved · ' + new Date().toLocaleTimeString();
        } catch (e) {
            window.UI.toast.error('Save failed: ' + (e?.message || e));
        }
    };

    const convertKnowledgeEntry = async (toType) => {
        const sel = document.getElementById('kb-d-type');
        if (sel) sel.value = toType;
        await saveKnowledgeEntry();
        window.UI.toast.success(`Converted to ${_kbTypeLabel(toType)}`);
        if (window._appState.kbCurrentEntryId) await showKnowledgeDetail(window._appState.kbCurrentEntryId);
    };

    const deleteKnowledgeEntry = async (id) => {
        window.UI.showModal('Delete entry?', '<p>This permanently removes the entry and all links to/from it.</p>', [
            { text: 'Cancel', cls: 'btn secondary', action: 'UI.hideModal()' },
            { text: 'Delete', cls: 'btn danger', action: `(async () => { await app._kbDoDelete('${id}'); })()` }
        ]);
    };

    const _kbDoDelete = async (id) => {
        try {
            await window.AppDataStore.delete('knowledge_entries', id);
            window.UI.hideModal();
            window.UI.toast.success('Deleted');
            await kbBackToSegment();
        } catch (e) {
            window.UI.toast.error('Delete failed: ' + (e?.message || e));
        }
    };

    const searchKnowledgeLinkTargets = async (currentId, q) => {
        const box = document.getElementById('kb-link-results');
        if (!box) return;
        if (!q || q.trim().length < 2) { box.innerHTML = ''; return; }
        const owner = await _kbOwnerId();
        try {
            const all = await window.AppDataStore.query('knowledge_entries', { owner_id: owner }) || [];
            const needle = q.trim().toLowerCase();
            const hits = all.filter(r => r.id !== currentId && (r.title||'').toLowerCase().includes(needle)).slice(0, 8);
            if (!hits.length) { box.innerHTML = '<div class="kb-empty kb-empty-sm">No matches.</div>'; return; }
            box.innerHTML = hits.map(h => `<div class="kb-link-hit" onclick="app.addKnowledgeLink('${currentId}','${h.id}')"><i class="fas ${_kbTypeIcon(h.type)}"></i> ${escapeHtml(h.title||'(untitled)')}</div>`).join('');
        } catch (e) {
            box.innerHTML = `<div class="kb-empty kb-empty-sm">Error: ${escapeHtml(e?.message||'')}</div>`;
        }
    };

    const addKnowledgeLink = async (fromId, toId) => {
        const owner = await _kbOwnerId();
        try {
            await window.AppDataStore.create('knowledge_links', { from_entry_id: fromId, to_entry_id: toId, owner_id: owner });
            window.UI.toast.success('Linked');
            await showKnowledgeDetail(fromId);
        } catch (e) {
            window.UI.toast.error('Link failed: ' + (e?.message || e));
        }
    };

    const removeKnowledgeLink = async (fromId, otherId) => {
        try {
            const owner = await _kbOwnerId();
            const all = await window.AppDataStore.query('knowledge_links', { owner_id: owner }) || [];
            const match = all.find(l =>
                (l.from_entry_id === fromId && l.to_entry_id === otherId) ||
                (l.from_entry_id === otherId && l.to_entry_id === fromId)
            );
            if (match) {
                await window.supabase.from('knowledge_links')
                    .delete()
                    .eq('from_entry_id', match.from_entry_id)
                    .eq('to_entry_id', match.to_entry_id);
            }
            window.UI.toast.success('Link removed');
            await showKnowledgeDetail(fromId);
        } catch (e) {
            window.UI.toast.error('Remove failed: ' + (e?.message || e));
        }
    };

    // ── Daily notes ──────────────────────────────────────────────────────────

    const showKnowledgeDailyNotes = async (slot) => {
        if (!window._appState.kbDailyDate) window._appState.kbDailyDate = _kbTodayISO();
        slot.innerHTML = `
            <div class="kb-daily">
                <div class="kb-daily-bar">
                    <button class="btn secondary" onclick="app.kbShiftDailyDate(-1)"><i class="fas fa-chevron-left"></i></button>
                    <input type="date" id="kb-daily-date" value="${window._appState.kbDailyDate}" onchange="app.kbSetDailyDate(this.value)">
                    <button class="btn secondary" onclick="app.kbShiftDailyDate(1)"><i class="fas fa-chevron-right"></i></button>
                    <button class="btn secondary" onclick="app.kbSetDailyDate('${_kbTodayISO()}')">Today</button>
                    <span class="kb-daily-actions">
                        <button class="btn primary" onclick="app.promoteSelectionToEntry()"><i class="fas fa-arrow-up-right-from-square"></i> Promote selection to Entry</button>
                    </span>
                </div>
                <textarea id="kb-daily-content" class="kb-textarea kb-textarea-daily" rows="22" placeholder="Dump raw, unfiltered thoughts here. Select a chunk and click Promote to turn it into a real Entry."></textarea>
                <div class="kb-autosave-status" id="kb-daily-status">Loading…</div>
            </div>
        `;
        await _kbLoadDaily();
        const ta = document.getElementById('kb-daily-content');
        if (ta) ta.addEventListener('input', () => {
            const s = document.getElementById('kb-daily-status'); if (s) s.textContent = 'Saving…';
            if (window._appState.kbAutosaveTimer) clearTimeout(window._appState.kbAutosaveTimer);
            window._appState.kbAutosaveTimer = setTimeout(() => saveDailyNote().catch(()=>{}), 800);
        });
    };

    const kbSetDailyDate = async (iso) => { window._appState.kbDailyDate = iso; await showKnowledgeDailyNotes(document.getElementById('kb-slot')); };
    const kbShiftDailyDate = async (delta) => {
        const d = new Date(window._appState.kbDailyDate || _kbTodayISO());
        d.setDate(d.getDate() + delta);
        window._appState.kbDailyDate = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
        await showKnowledgeDailyNotes(document.getElementById('kb-slot'));
    };

    const _kbLoadDaily = async () => {
        const owner = await _kbOwnerId();
        if (!owner) return;
        try {
            const rows = await window.AppDataStore.query('knowledge_daily_notes', { owner_id: owner, note_date: window._appState.kbDailyDate }) || [];
            const ta = document.getElementById('kb-daily-content');
            if (ta) ta.value = rows[0]?.content || '';
            const s = document.getElementById('kb-daily-status');
            if (s) s.textContent = rows[0] ? 'Saved · ' + _kbFmtDate(rows[0].updated_at) : 'New entry — start typing.';
        } catch (e) {
            const s = document.getElementById('kb-daily-status');
            if (s) s.textContent = 'Error: ' + (e?.message || 'load failed');
        }
    };

    const saveDailyNote = async () => {
        const owner = await _kbOwnerId();
        if (!owner || !window._appState.kbDailyDate) return;
        const content = document.getElementById('kb-daily-content')?.value || '';
        try {
            const rows = await window.AppDataStore.query('knowledge_daily_notes', { owner_id: owner, note_date: window._appState.kbDailyDate }) || [];
            if (rows[0]) {
                await window.AppDataStore.update('knowledge_daily_notes', rows[0].id, { content });
            } else {
                await window.AppDataStore.create('knowledge_daily_notes', { owner_id: owner, note_date: window._appState.kbDailyDate, content });
            }
            const s = document.getElementById('kb-daily-status');
            if (s) s.textContent = 'Saved · ' + new Date().toLocaleTimeString();
        } catch (e) {
            const s = document.getElementById('kb-daily-status');
            if (s) s.textContent = 'Save failed: ' + (e?.message || e);
        }
    };

    const promoteSelectionToEntry = async () => {
        const ta = document.getElementById('kb-daily-content');
        if (!ta) return;
        const start = ta.selectionStart, end = ta.selectionEnd;
        const sel = ta.value.substring(start, end).trim();
        if (!sel) { window.UI.toast.error('Select some text first'); return; }
        const lines = sel.split('\n');
        const title = (lines.shift() || 'Untitled').trim().slice(0, 200);
        const content = lines.join('\n').trim();
        const owner = await _kbOwnerId();
        try {
            await window.AppDataStore.create('knowledge_entries', {
                owner_id: owner, title, content, type: null, status: 'draft', tags: []
            });
            window.UI.toast.success('Promoted to Inbox');
        } catch (e) {
            window.UI.toast.error('Promote failed: ' + (e?.message || e));
        }
    };

    // ── Quick-capture modal ──────────────────────────────────────────────────

    const openCaptureModal = () => {
        window.UI.showModal('Quick capture', `
            <div class="kb-modal-cap">
                <input type="text" id="kb-modal-title" class="kb-input" placeholder="Title" maxlength="200" autofocus>
                <textarea id="kb-modal-content" class="kb-textarea" rows="6" placeholder="Optional notes (Ctrl+Enter to save)"></textarea>
            </div>
        `, [
            { text: 'Cancel', cls: 'btn secondary', action: 'UI.hideModal()' },
            { text: 'Capture', cls: 'btn primary', action: '(async () => { await app.saveCaptureModal(); })()' }
        ]);
        setTimeout(() => {
            const ta = document.getElementById('kb-modal-content');
            if (ta) ta.addEventListener('keydown', (e) => {
                if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); saveCaptureModal(); }
            });
        }, 50);
    };

    const saveCaptureModal = async () => {
        const title = (document.getElementById('kb-modal-title')?.value || '').trim();
        const content = (document.getElementById('kb-modal-content')?.value || '').trim();
        if (!title) { window.UI.toast.error('Title required'); return; }
        const owner = await _kbOwnerId();
        try {
            await window.AppDataStore.create('knowledge_entries', {
                owner_id: owner, title, content, type: null, status: 'draft', tags: []
            });
            window.UI.hideModal();
            window.UI.toast.success('Captured');
            if (window._appState.currentView === 'knowledge') {
                if (window._appState.kbSegment === 'dashboard') await _kbReloadDashboard();
                else if (window._appState.kbSegment === 'all')  await _kbReloadAll('');
            }
        } catch (e) {
            window.UI.toast.error('Save failed: ' + (e?.message || e));
        }
    };

    // ── Register all sub-functions on app so inline onclick= handlers work ───

    const _reg = (name, fn) => { if (window.app) window.app[name] = fn; };
    _reg('switchKnowledgeSegment', async (seg) => {
        window._appState.kbSegment = seg;
        window._appState.kbCurrentEntryId = null;
        document.querySelectorAll('.kb-seg').forEach(b => b.classList.remove('active'));
        const btn = Array.from(document.querySelectorAll('.kb-seg')).find(b => b.textContent.trim().toLowerCase().includes(seg === 'all' ? 'all entries' : seg));
        if (btn) btn.classList.add('active');
        await _kbRenderSegment();
    });
    _reg('saveQuickCapture', saveQuickCapture);
    _reg('saveCaptureFull', saveCaptureFull);
    _reg('filterKnowledgeEntries', filterKnowledgeEntries);
    _reg('searchKnowledgeEntries', searchKnowledgeEntries);
    _reg('showKnowledgeDetail', showKnowledgeDetail);
    _reg('kbBackToSegment', kbBackToSegment);
    _reg('scheduleKnowledgeAutosave', scheduleKnowledgeAutosave);
    _reg('saveKnowledgeEntry', saveKnowledgeEntry);
    _reg('convertKnowledgeEntry', convertKnowledgeEntry);
    _reg('deleteKnowledgeEntry', deleteKnowledgeEntry);
    _reg('_kbDoDelete', _kbDoDelete);
    _reg('searchKnowledgeLinkTargets', searchKnowledgeLinkTargets);
    _reg('addKnowledgeLink', addKnowledgeLink);
    _reg('removeKnowledgeLink', removeKnowledgeLink);
    _reg('kbSetDailyDate', kbSetDailyDate);
    _reg('kbShiftDailyDate', kbShiftDailyDate);
    _reg('promoteSelectionToEntry', promoteSelectionToEntry);
    _reg('openCaptureModal', openCaptureModal);
    _reg('saveCaptureModal', saveCaptureModal);

    // ── Entry point ──────────────────────────────────────────────────────────

    window._appState.currentView = 'knowledge';
    if (!window._appState.kbSegment) window._appState.kbSegment = 'dashboard';
    container.innerHTML = `
        <div class="kb-view">
            <div class="kb-header">
                <div>
                    <h1><i class="fas fa-brain" style="color:var(--primary);"></i> Knowledge HQ</h1>
                    <div class="kb-subtitle">Capture first. Classify later. Connect anytime.</div>
                </div>
                <div class="kb-segments">
                    <button class="kb-seg ${window._appState.kbSegment==='dashboard'?'active':''}" onclick="app.switchKnowledgeSegment('dashboard')"><i class="fas fa-gauge"></i> Dashboard</button>
                    <button class="kb-seg ${window._appState.kbSegment==='capture'?'active':''}" onclick="app.switchKnowledgeSegment('capture')"><i class="fas fa-feather"></i> Capture</button>
                    <button class="kb-seg ${window._appState.kbSegment==='all'?'active':''}" onclick="app.switchKnowledgeSegment('all')"><i class="fas fa-list"></i> All Entries</button>
                    <button class="kb-seg ${window._appState.kbSegment==='daily'?'active':''}" onclick="app.switchKnowledgeSegment('daily')"><i class="far fa-calendar"></i> Daily Notes</button>
                </div>
            </div>
            <div id="kb-slot" class="kb-slot"></div>
        </div>
    `;
    await _kbRenderSegment();
};
    // Signal features ready
    window._appFeaturesLoaded = true;
    if (typeof window._onFeaturesLoaded === 'function') window._onFeaturesLoaded();
})();
