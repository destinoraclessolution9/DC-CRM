// Document Management System — island (view id 'documents').
//
// TWO render paths, selected by props.data:
//
// 1. FULL-JSX path (props.data present) — NEW, gated behind the chunk's
//    default-OFF flag _reactDmsJsxOn() (?react_dms_jsx=1 / crm_react_dms_jsx=1).
//    React owns the ENTIRE explorer: folder tree, breadcrumb, file list/grid,
//    batch toolbar — all rendered as real JSX from props.data (objects/arrays,
//    NOT HTML strings). View-mode switching (list/grid) is React state. Drag-drop
//    uses React onDragStart/onDragOver/onDrop. Every action button calls the
//    EXISTING window.app.* handler (same ones the legacy inline markup used), so
//    behavior matches the legacy chunk. After data-mutating handlers resolve the
//    chunk handlers themselves re-render (they call loadFolderContents/
//    renderFolderTree), and navigation/sort/search re-open the view, so no manual
//    refresh is wired here. React auto-escapes text children — no innerHTML, no
//    getElementById writes on this path.
//
// 2. SCAFFOLD-SHELL path (props.data absent) — UNCHANGED. React owns ONLY the
//    static shell (header + folder sidebar frame + explorer header/toolbar + empty
//    stable-id containers: #folder-tree, #breadcrumb, #file-container,
//    #batch-actions). The chunk's onReady (renderFolderTree + loadFolderContents)
//    populates those containers by-id exactly as before — byte-for-byte the legacy
//    behavior. This is the default (flag-off) and ships-to-live path.
import React, { useEffect, useState } from 'react';

const app = () => window.app || {};
const call = (name, ...args) => { const f = app()[name]; if (typeof f === 'function') f(...args); };
const stop = (e) => { if (e && typeof e.stopPropagation === 'function') e.stopPropagation(); };

// ── Folder tree (mirrors chunk renderFolderTree) ────────────────────────────
function FolderTree({ tree }) {
    return (
        <div className="folder-tree" id="folder-tree">
            {tree.map((f) => (
                <div
                    key={f.id}
                    className={`folder-item ${f.active ? 'active' : ''}`}
                    style={{ paddingLeft: `${f.level * 20 + 10}px` }}
                >
                    <div
                        className="folder-content"
                        onClick={() => call('navigateToFolder', f.id)}
                        onDragOver={(e) => { e.preventDefault(); e.currentTarget.parentElement.classList.add('drag-over'); }}
                        onDragLeave={(e) => { e.currentTarget.parentElement.classList.remove('drag-over'); }}
                        onDrop={(e) => { e.currentTarget.parentElement.classList.remove('drag-over'); call('handleDropOnFolder', e, f.id); }}
                    >
                        <i className="fas fa-folder" style={{ color: f.color }}></i>
                        <span className="folder-name">{f.name}</span>
                    </div>
                    <div className="folder-actions">
                        <button className="btn-icon" aria-label="Rename folder" onClick={(e) => { call('renameFolder', f.id); stop(e); }}><i className="fas fa-edit" aria-hidden="true"></i></button>
                        <button className="btn-icon" aria-label="Delete folder" onClick={(e) => { call('deleteFolder', f.id); stop(e); }}><i className="fas fa-trash" aria-hidden="true"></i></button>
                    </div>
                </div>
            ))}
        </div>
    );
}

// ── Breadcrumb (mirrors chunk renderBreadcrumb) ─────────────────────────────
function Breadcrumb({ breadcrumb }) {
    return (
        <div className="breadcrumb" id="breadcrumb">
            <span className="breadcrumb-item" onClick={() => call('navigateToFolder', null)}>Root</span>
            {breadcrumb.map((f) => (
                <React.Fragment key={f.id}>
                    <span className="breadcrumb-separator">/</span>
                    <span className="breadcrumb-item" onClick={() => call('navigateToFolder', f.id)}>{f.name}</span>
                </React.Fragment>
            ))}
        </div>
    );
}

// ── Empty-folder placeholder (mirrors chunk renderFileListView/GridView empty) ─
function EmptyFolder() {
    return (
        <div className="empty-folder">
            <i className="fas fa-folder-open fa-5x"></i>
            <h3>This folder is empty</h3>
            <p>Upload files or create a new folder to get started</p>
            <button className="btn primary" onClick={() => call('openUploadModal')}><i className="fas fa-upload"></i> Upload Files</button>
        </div>
    );
}

// ── File list view (mirrors chunk renderFileListView) ───────────────────────
function FileListView({ files, sortBy, sortDirection, allSelected }) {
    const arrow = (col) => (sortBy === col ? (sortDirection === 'asc' ? ' ↑' : ' ↓') : '');
    if (files.length === 0) return <EmptyFolder />;
    return (
        <table className="file-table">
            <thead>
                <tr>
                    <th scope="col" style={{ width: '30px' }}>
                        <input type="checkbox" checked={allSelected} onChange={() => call('selectAllFiles')} />
                    </th>
                    <th scope="col" onClick={() => call('sortFiles', 'name')} style={{ cursor: 'pointer' }}>Name{arrow('name')}</th>
                    <th scope="col" onClick={() => call('sortFiles', 'date')} style={{ cursor: 'pointer' }}>Modified{arrow('date')}</th>
                    <th scope="col" onClick={() => call('sortFiles', 'size')} style={{ cursor: 'pointer' }}>Size{arrow('size')}</th>
                    <th scope="col">Actions</th>
                </tr>
            </thead>
            <tbody>
                {files.map((file) => (
                    <tr
                        key={file.id}
                        className={`file-item ${file.selected ? 'selected' : ''}`}
                        data-id={file.id}
                        draggable="true"
                        onDragStart={(e) => call('handleFileDragStart', e, file.id)}
                        onDragEnd={(e) => call('handleFileDragEnd', e)}
                    >
                        <td onClick={(e) => stop(e)}>
                            <input type="checkbox" checked={file.selected} onChange={() => call('toggleFileSelection', file.id)} />
                        </td>
                        <td onDoubleClick={() => call('previewFile', file.id)}>
                            <i className={`fas ${file.iconClass} file-icon`}></i>
                            <span className="file-name">{file.filename}</span>
                            {file.isStarred ? <i className="fas fa-star starred"></i> : null}
                        </td>
                        <td>{file.modifiedLabel}</td>
                        <td>{file.sizeLabel}</td>
                        <td>
                            <div className="action-buttons" style={{ display: 'flex', gap: '4px' }}>
                                <button className="btn-icon" onClick={(e) => { call('previewFile', file.id); stop(e); }} title="Preview"><i className="fas fa-eye"></i></button>
                                <button className="btn-icon" onClick={(e) => { call('downloadFile', file.id); stop(e); }} title="Download"><i className="fas fa-download"></i></button>
                                <button className="btn-icon" onClick={(e) => { call('showVersionHistory', file.id); stop(e); }} title="Versions"><i className="fas fa-history"></i></button>
                                <button className="btn-icon" onClick={(e) => { call('openShareModal', file.id); stop(e); }} title="Share"><i className="fas fa-share-alt"></i></button>
                                <button className="btn-icon" onClick={(e) => { call('showFileMetadata', file.id); stop(e); }} title="Info"><i className="fas fa-info-circle"></i></button>
                                <button className="btn-icon" data-star-id={file.id} onClick={(e) => { call('toggleStar', file.id); stop(e); }} title="Star"><i className={`fas fa-star${file.isStarred ? '' : '-o'}`}></i></button>
                                <button className="btn-icon" onClick={(e) => { call('deleteFile', file.id); stop(e); }} title="Delete"><i className="fas fa-trash"></i></button>
                            </div>
                        </td>
                    </tr>
                ))}
            </tbody>
        </table>
    );
}

// ── File grid view (mirrors chunk renderFileGridView) ───────────────────────
function FileGridView({ files }) {
    if (files.length === 0) return <EmptyFolder />;
    return (
        <div className="file-grid">
            {files.map((file) => (
                <div
                    key={file.id}
                    className={`file-card ${file.selected ? 'selected' : ''}`}
                    data-id={file.id}
                    draggable="true"
                    onDragStart={(e) => call('handleFileDragStart', e, file.id)}
                    onDragEnd={(e) => call('handleFileDragEnd', e)}
                >
                    <div className="file-card-header">
                        <input type="checkbox" checked={file.selected} onChange={() => call('toggleFileSelection', file.id)} onClick={(e) => stop(e)} />
                        <button className="btn-icon" data-star-id={file.id} onClick={(e) => { call('toggleStar', file.id); stop(e); }} title="Star"><i className={`fas fa-star${file.isStarred ? '' : '-o'}`}></i></button>
                    </div>
                    <div className="file-card-icon" onDoubleClick={() => call('previewFile', file.id)}>
                        <i className={`fas ${file.iconClass} fa-4x`}></i>
                    </div>
                    <div className="file-card-name" title={file.filename}>{file.filename}</div>
                    <div className="file-card-meta">
                        <span>{file.sizeLabel}</span>
                        <span>{file.modifiedDateLabel}</span>
                    </div>
                    <div className="file-card-actions">
                        <button className="btn-icon" onClick={(e) => { call('previewFile', file.id); stop(e); }} title="Preview"><i className="fas fa-eye"></i></button>
                        <button className="btn-icon" onClick={(e) => { call('downloadFile', file.id); stop(e); }} title="Download"><i className="fas fa-download"></i></button>
                        <button className="btn-icon" onClick={(e) => { call('showVersionHistory', file.id); stop(e); }} title="Versions"><i className="fas fa-history"></i></button>
                        <button className="btn-icon" onClick={(e) => { call('openShareModal', file.id); stop(e); }} title="Share"><i className="fas fa-share-alt"></i></button>
                    </div>
                </div>
            ))}
        </div>
    );
}

// ── Batch toolbar (mirrors chunk updateBatchActions) ────────────────────────
function BatchActions({ selectedCount }) {
    if (!selectedCount) return <div id="batch-actions"></div>;
    return (
        <div id="batch-actions">
            <div className="batch-actions-bar">
                <span className="selected-count">{selectedCount} selected</span>
                <button className="btn-icon" onClick={() => call('downloadSelected')} title="Download Selected"><i className="fas fa-download"></i></button>
                <button className="btn-icon" onClick={() => call('copySelected')} title="Copy Selected"><i className="fas fa-copy"></i></button>
                <button className="btn-icon" onClick={() => call('moveSelected')} title="Move Selected"><i className="fas fa-cut"></i></button>
                <button className="btn-icon" onClick={() => call('deleteSelected')} title="Delete Selected"><i className="fas fa-trash"></i></button>
                <button className="btn-icon" onClick={() => call('deselectAll')} title="Clear Selection"><i className="fas fa-times"></i></button>
            </div>
        </div>
    );
}

// ── FULL-JSX render path (props.data present) ───────────────────────────────
// Renders the entire explorer from data. View mode is React state, seeded from
// data.viewMode; switching view mode also calls the chunk's setViewMode so the
// chunk-side _viewMode stays in sync for the next re-open. All other interactions
// call the existing window.app.* handlers (which re-render the chunk-driven view).
function FullDocumentManagement({ data }) {
    const [viewMode, setViewMode] = useState(data.viewMode || 'list');

    // Keep local view-mode state aligned with the latest payload on re-render.
    useEffect(() => { setViewMode(data.viewMode || 'list'); }, [data.viewMode]);

    const switchView = (mode) => { setViewMode(mode); call('setViewMode', mode); };

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
                    <FolderTree tree={data.tree || []} />
                </div>

                <div className="file-explorer">
                    <div className="explorer-header">
                        <Breadcrumb breadcrumb={data.breadcrumb || []} />

                        <div className="explorer-controls">
                            <div className="search-filter-bar">
                                <i className="fas fa-search"></i>
                                <input
                                    type="text"
                                    id="file-search"
                                    placeholder="Search files..."
                                    defaultValue={data.fileFilter || ''}
                                    onKeyUp={(e) => { const v = e.target.value; call('debounceCall', 'file-search', () => call('searchFiles', v), 220); }}
                                />
                                <select id="file-sort" className="form-control" value={data.sortBy || 'name'} onChange={(e) => call('sortFiles', e.target.value)}>
                                    <option value="name">Sort by Name</option>
                                    <option value="date">Sort by Date</option>
                                    <option value="size">Sort by Size</option>
                                </select>
                                <div className="view-toggle">
                                    <button className={`btn-icon ${viewMode === 'list' ? 'active' : ''}`} onClick={() => switchView('list')}><i className="fas fa-list"></i></button>
                                    <button className={`btn-icon ${viewMode === 'grid' ? 'active' : ''}`} onClick={() => switchView('grid')}><i className="fas fa-th-large"></i></button>
                                </div>
                            </div>
                            <BatchActions selectedCount={data.selectedCount || 0} />
                        </div>

                        <div className="special-filters" style={{ marginTop: '15px', display: 'flex', gap: '10px' }}>
                            <button className="btn link-btn" onClick={() => call('showRecentFiles')}><i className="fas fa-clock"></i> Recent</button>
                            <button className="btn link-btn" onClick={() => call('showAllFiles')}><i className="fas fa-copy"></i> All Files</button>
                            <button className="btn link-btn" onClick={() => call('showStarredFiles')}><i className="fas fa-star"></i> Starred</button>
                        </div>
                    </div>

                    <div className="file-container" id="file-container">
                        {viewMode === 'list'
                            ? <FileListView files={data.files || []} sortBy={data.sortBy} sortDirection={data.sortDirection} allSelected={!!data.allSelected} />
                            : <FileGridView files={data.files || []} />}
                    </div>
                </div>
            </div>
        </div>
    );
}

export function DocumentManagementView({ viewMode = 'list', onReady, data }) {
    try { window.__REACT_DMS_STATE = 'ready'; } catch (_) { /* noop */ }

    // FULL-JSX path — owns the DOM, renders entirely from props.data. Gated behind
    // the chunk's default-OFF flag; data is only ever passed when that flag is on
    // AND the payload built. Hooks live in FullDocumentManagement (always called
    // for a given branch), so the early-return-before-scaffold-hooks is rules-safe.
    if (data) {
        return <FullDocumentManagement data={data} />;
    }

    // SCAFFOLD-SHELL path (UNCHANGED). Populate the shell AFTER React has committed
    // the DOM (so #folder-tree / #file-container exist). The chunk passes
    // onReady = renderFolderTree + loadFolderContents.
    useEffect(() => {
        if (typeof onReady === 'function') {
            try { onReady(); } catch (e) { try { console.warn('[dms] onReady failed:', e && e.message); } catch (_) {} }
        }
    }, [onReady]);

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
