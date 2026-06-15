// Document Management System — scaffold-shell island (view id 'documents').
//
// React owns ONLY the static shell (header + folder sidebar frame + explorer
// header/toolbar + empty stable-id containers: #folder-tree, #breadcrumb,
// #file-container, #batch-actions). ALL content rendering + interactivity stays
// in the chunk (chunks/script-documents.js): after this island mounts, the
// chunk calls renderFolderTree() + loadFolderContents() which populate those
// containers exactly as before — so the recursive folder tree, file list/grid,
// drag-drop file moves, breadcrumb, and batch actions are byte-identical to the
// legacy view (zero behavior change). Toolbar buttons call window.app.* (same
// handlers the legacy inline markup used).
import React from 'react';

const app = () => window.app || {};
const call = (name, ...args) => { const f = app()[name]; if (typeof f === 'function') f(...args); };

export function DocumentManagementView({ viewMode = 'list' }) {
    try { window.__REACT_DMS_STATE = 'ready'; } catch (_) { /* noop */ }

    return (
        <div className="dms-view">
            <div className="dms-header">
                <div>
                    <h1>Document Management System</h1>
                    <p>Manage, organize, and share your documents</p>
                </div>
                <div className="dms-actions">
                    <button className="btn primary" onClick={() => call('openUploadModal')}><i className="fas fa-upload"></i> Upload File</button>
                    <button className="btn secondary" onClick={() => call('openNewFolderModal')}><i className="fas fa-folder-plus"></i> New Folder</button>
                </div>
            </div>

            <div className="dms-layout">
                <div className="folder-sidebar">
                    <div className="sidebar-header">
                        <h3>Folders</h3>
                        <button className="btn-icon" onClick={() => call('refreshFolderTree')} title="Refresh"><i className="fas fa-sync-alt"></i></button>
                    </div>
                    <div className="folder-tree" id="folder-tree"></div>
                </div>

                <div className="file-explorer">
                    <div className="explorer-header">
                        <div className="breadcrumb" id="breadcrumb"></div>

                        <div className="explorer-controls">
                            <div className="search-filter-bar">
                                <i className="fas fa-search"></i>
                                <input type="text" id="file-search" placeholder="Search files..."
                                    onKeyUp={(e) => { const v = e.target.value; call('debounceCall', 'file-search', () => call('searchFiles', v), 220); }} />
                                <select id="file-sort" className="form-control" onChange={(e) => call('sortFiles', e.target.value)}>
                                    <option value="name">Sort by Name</option>
                                    <option value="date">Sort by Date</option>
                                    <option value="size">Sort by Size</option>
                                </select>
                                <div className="view-toggle">
                                    <button className={`btn-icon ${viewMode === 'list' ? 'active' : ''}`} onClick={() => call('setViewMode', 'list')}><i className="fas fa-list"></i></button>
                                    <button className={`btn-icon ${viewMode === 'grid' ? 'active' : ''}`} onClick={() => call('setViewMode', 'grid')}><i className="fas fa-th-large"></i></button>
                                </div>
                            </div>
                            <div id="batch-actions"></div>
                        </div>

                        <div className="special-filters" style={{ marginTop: '15px', display: 'flex', gap: '10px' }}>
                            <button className="btn link-btn" onClick={() => call('showRecentFiles')}><i className="fas fa-clock"></i> Recent</button>
                            <button className="btn link-btn" onClick={() => call('showAllFiles')}><i className="fas fa-copy"></i> All Files</button>
                            <button className="btn link-btn" onClick={() => call('showStarredFiles')}><i className="fas fa-star"></i> Starred</button>
                        </div>
                    </div>

                    <div className="file-container" id="file-container"></div>
                </div>
            </div>
        </div>
    );
}
