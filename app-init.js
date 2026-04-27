// app-init.js — loaded deferred; replaces all inline <script> blocks in index.html.
// Runs after DOM is parsed (deferred) but before DOMContentLoaded fires.

// ── Footer copyright year ──────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', function () {
    const el = document.getElementById('footer-year');
    if (el) el.textContent = new Date().getFullYear();
});

// ── Nav dropdown toggle (AI Insights / Security / Admin) ──────────────────
document.addEventListener('DOMContentLoaded', function () {
    const triggers = document.querySelectorAll('.dropdown-trigger');
    triggers.forEach(function (trigger) {
        trigger.addEventListener('click', function (e) {
            if (e.target.tagName.toLowerCase() !== 'li' || !e.target.hasAttribute('onclick')) {
                const menu = this.querySelector('.dropdown-menu');
                if (menu) menu.style.display = menu.style.display === 'none' ? 'block' : 'none';
            }
        });
    });
    document.addEventListener('click', function (e) {
        if (!e.target.closest('.dropdown-trigger')) {
            document.querySelectorAll('.dropdown-menu').forEach(function (menu) {
                menu.style.display = 'none';
            });
        }
    });
});

// ── App init + event handlers ─────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', function () {
    // Brand logo navigation
    const brandLogo = document.getElementById('brand-logo');
    if (brandLogo) {
        brandLogo.addEventListener('click', function () {
            if (window.app && window.app.navigateTo) {
                window.app.navigateTo('calendar');
            }
        });
    }

    // Navigation menu items
    document.querySelectorAll('.nav-links li').forEach(function (li) {
        const view = li.getAttribute('data-view');
        if (view) {
            li.addEventListener('click', function () {
                if (window.app && window.app.navigateTo) {
                    window.app.navigateTo(view);
                }
                document.getElementById('nav-links')?.classList.remove('show');
            });
        }
    });

    // User info click
    const userInfo = document.getElementById('current-user-display');
    if (userInfo) {
        userInfo.addEventListener('click', function () {
            if (window.app && window.app.toggleUserMenu) window.app.toggleUserMenu();
        });
    }

    // Search button
    const searchBtn = document.getElementById('sidebar-search-btn');
    if (searchBtn) {
        searchBtn.addEventListener('click', function () {
            if (window.app && window.app.toggleSearchPanel) window.app.toggleSearchPanel();
        });
    }

    // Initialize app with retry
    let __initAttempts = 0;
    const __tryInit = async function () {
        if (window.__appInitCalled || window.app?.initialized) return;
        if (window.app && window.app.init) {
            window.__appInitCalled = true;
            try { await window.app.init(); }
            catch (e) {
                console.warn('[init] app.init() failed, retrying...', e);
                window.__appInitCalled = false;
                if (++__initAttempts < 5) setTimeout(__tryInit, 500);
            }
        } else if (++__initAttempts < 10) {
            setTimeout(__tryInit, 200);
        }
    };
    __tryInit();

    // Fallback: ensure login button always has a handler
    setTimeout(function () {
        const loginBtn = document.getElementById('loginBtn');
        if (loginBtn && window.app && window.app._wireLoginBtn && !loginBtn._supabaseSetup) {
            window.app._wireLoginBtn();
        }
    }, 1500);
});

// Fallback if scripts load after DOM
window.addEventListener('load', function () {
    if (window.app && window.app.init && !window.__appInitCalled && !window.app?.initialized) {
        window.__appInitCalled = true;
        window.app.init().catch(function (e) { console.warn('[init fallback]', e); });
    }
});

// ── PWA: Service Worker ────────────────────────────────────────────────────
if ('serviceWorker' in navigator) {
    window.addEventListener('load', function () {
        navigator.serviceWorker.register('service-worker.js')
            .then(function (reg) {
                console.log('[PWA] Service worker registered:', reg.scope);
                window._swRegistration = reg;
            })
            .catch(function (err) { console.warn('[PWA] Service worker registration failed:', err); });
    });
}

// ── PWA: Install prompt ────────────────────────────────────────────────────
window.addEventListener('beforeinstallprompt', function (e) {
    e.preventDefault();
    window._installPromptEvent = e;
});

// ── Theme toggle ───────────────────────────────────────────────────────────
(function () {
    function applyTheme(theme) {
        document.documentElement.setAttribute('data-theme', theme);
        try { localStorage.setItem('docs-theme', theme); } catch (e) {}
        const icon = document.getElementById('theme-toggle-icon');
        if (icon) icon.className = theme === 'dark' ? 'fas fa-sun' : 'fas fa-moon';
        const meta = document.querySelector('meta[name="theme-color"]');
        if (meta) meta.setAttribute('content', theme === 'dark' ? '#14090C' : '#800020');
    }
    function toggleTheme() {
        const current = document.documentElement.getAttribute('data-theme') || 'light';
        applyTheme(current === 'dark' ? 'light' : 'dark');
    }
    document.addEventListener('DOMContentLoaded', function () {
        applyTheme(localStorage.getItem('docs-theme') || 'light');
        const btn = document.getElementById('theme-toggle');
        if (btn) btn.addEventListener('click', toggleTheme);
    });
    document.addEventListener('keydown', function (e) {
        if (e.ctrlKey && e.shiftKey && (e.key === 'L' || e.key === 'l')) {
            e.preventDefault();
            toggleTheme();
        }
    });
    window._toggleTheme = toggleTheme;
})();

// ── Command palette (Ctrl+K) ───────────────────────────────────────────────
(function () {
    const COMMANDS = [
        { section: 'Navigate', label: 'Calendar',                         icon: 'fa-calendar',            view: 'calendar' },
        { section: 'Navigate', label: 'Prospect / Customer',              icon: 'fa-users',               view: 'prospects' },
        { section: 'Navigate', label: 'Referral Relationship',            icon: 'fa-share-nodes',         view: 'referrals' },
        { section: 'Navigate', label: 'Potential Pipeline',               icon: 'fa-chart-line',          view: 'pipeline' },
        { section: 'Navigate', label: 'Monthly Promotion',                icon: 'fa-bullhorn',            view: 'promotions' },
        { section: 'Navigate', label: 'Marketing Automation',             icon: 'fa-robot',               view: 'marketing_automation' },
        { section: 'Navigate', label: 'Success Case Library',             icon: 'fa-book-open',           view: 'cases' },
        { section: 'Navigate', label: 'Consultant',                       icon: 'fa-user-tie',            view: 'agents' },
        { section: 'Navigate', label: 'Ranking Performance',              icon: 'fa-trophy',              view: 'performance' },
        { section: 'Navigate', label: 'Reporting KPI',                    icon: 'fa-chart-pie',           view: 'reports' },
        { section: 'Navigate', label: 'Consultant Attrition Risk',        icon: 'fa-triangle-exclamation',view: 'risk' },
        { section: 'Navigate', label: 'Document Management',              icon: 'fa-folder-open',         view: 'documents' },
        { section: 'Navigate', label: 'Import / Export',                  icon: 'fa-file-import',         view: 'import' },
        { section: 'Navigate', label: 'Custom Fields',                    icon: 'fa-list-check',          view: 'custom_fields' },
        { section: 'Navigate', label: 'Integrations',                     icon: 'fa-plug',                view: 'integrations' },
        { section: 'Navigate', label: 'Setting - Account',                icon: 'fa-gear',                view: 'settings' },
        { section: 'Navigate', label: 'Protection Monitoring',            icon: 'fa-shield-halved',       view: 'protection' },
        { section: 'Action',   label: 'Toggle Light / Dark Theme',        icon: 'fa-circle-half-stroke',  action: function () { window._toggleTheme && window._toggleTheme(); }, meta: 'Ctrl+Shift+L' },
        { section: 'Action',   label: 'Logout',                           icon: 'fa-right-from-bracket',  action: function () { window.app && window.app.logout && window.app.logout(); } },
    ];

    let activeIdx = 0;
    let filtered = [];

    function open() {
        document.getElementById('cmdk-overlay').classList.add('active');
        const input = document.getElementById('cmdk-input');
        input.value = '';
        render('');
        setTimeout(function () { input.focus(); }, 30);
    }
    function close() {
        document.getElementById('cmdk-overlay').classList.remove('active');
    }
    function score(label, q) {
        if (!q) return 1;
        const l = label.toLowerCase(), qq = q.toLowerCase();
        if (l.startsWith(qq)) return 100;
        if (l.includes(qq)) return 50;
        let i = 0, j = 0;
        while (i < l.length && j < qq.length) { if (l[i] === qq[j]) j++; i++; }
        return j === qq.length ? 10 : 0;
    }
    function render(q) {
        filtered = COMMANDS
            .map(function (c) { return { c: c, s: score(c.label, q) }; })
            .filter(function (x) { return x.s > 0; })
            .sort(function (a, b) { return b.s - a.s; })
            .map(function (x) { return x.c; });
        activeIdx = 0;
        const root = document.getElementById('cmdk-results');
        if (!filtered.length) {
            root.innerHTML = '<div class="cmdk-empty">No matches. Try another query.</div>';
            return;
        }
        let html = '', lastSection = '';
        filtered.forEach(function (c, i) {
            if (c.section !== lastSection) {
                html += '<div class="cmdk-section">' + c.section + '</div>';
                lastSection = c.section;
            }
            html += '<div class="cmdk-item ' + (i === activeIdx ? 'active' : '') + '" data-idx="' + i + '">' +
                '<span class="cmdk-icon"><i class="fas ' + c.icon + '"></i></span>' +
                '<span>' + c.label + '</span>' +
                (c.meta ? '<span class="cmdk-meta">' + c.meta + '</span>' : '') +
                '</div>';
        });
        root.innerHTML = html;
        root.querySelectorAll('.cmdk-item').forEach(function (el) {
            el.addEventListener('mouseenter', function () {
                activeIdx = parseInt(el.dataset.idx, 10);
                updateActive();
            });
            el.addEventListener('click', function () { execute(filtered[parseInt(el.dataset.idx, 10)]); });
        });
    }
    function updateActive() {
        document.querySelectorAll('.cmdk-item').forEach(function (el, i) {
            el.classList.toggle('active', i === activeIdx);
        });
        const active = document.querySelector('.cmdk-item.active');
        if (active) active.scrollIntoView({ block: 'nearest' });
    }
    function execute(cmd) {
        if (!cmd) return;
        close();
        if (cmd.view && window.app && window.app.navigateTo) window.app.navigateTo(cmd.view);
        else if (cmd.action) cmd.action();
    }

    document.addEventListener('keydown', function (e) {
        const isCmdK = (e.ctrlKey || e.metaKey) && (e.key === 'k' || e.key === 'K');
        if (isCmdK) { e.preventDefault(); open(); return; }
        const overlay = document.getElementById('cmdk-overlay');
        if (!overlay || !overlay.classList.contains('active')) return;
        if (e.key === 'Escape')       { e.preventDefault(); close(); }
        else if (e.key === 'ArrowDown') { e.preventDefault(); if (filtered.length) { activeIdx = (activeIdx + 1) % filtered.length; updateActive(); } }
        else if (e.key === 'ArrowUp')   { e.preventDefault(); if (filtered.length) { activeIdx = (activeIdx - 1 + filtered.length) % filtered.length; updateActive(); } }
        else if (e.key === 'Enter')     { e.preventDefault(); execute(filtered[activeIdx]); }
    });
    document.addEventListener('DOMContentLoaded', function () {
        const input = document.getElementById('cmdk-input');
        if (input) input.addEventListener('input', function (e) { render(e.target.value); });
        const trigger = document.getElementById('cmdk-trigger');
        if (trigger) trigger.addEventListener('click', open);
    });
})();

// ── Live status (online / offline) ────────────────────────────────────────
(function () {
    function update() {
        const el = document.getElementById('live-status');
        const lbl = document.getElementById('live-status-label');
        if (!el || !lbl) return;
        if (navigator.onLine) {
            el.classList.remove('offline');
            lbl.textContent = 'LIVE';
        } else {
            el.classList.add('offline');
            lbl.textContent = 'OFFLINE';
        }
    }
    window.addEventListener('online', update);
    window.addEventListener('offline', update);
    document.addEventListener('DOMContentLoaded', update);
})();

// ── Mobile bottom nav active sync ─────────────────────────────────────────
(function () {
    function sync() {
        const view = (window.app && window.app._currentView) || 'calendar';
        document.querySelectorAll('.mobile-bottom-nav-item[data-view]').forEach(function (el) {
            el.classList.toggle('active', el.dataset.view === view);
        });
    }
    const tryHook = function () {
        if (!window.app || !window.app.navigateTo || window.app._navHooked) return;
        const original = window.app.navigateTo.bind(window.app);
        window.app.navigateTo = function (v) {
            const r = original(v);
            window.app._currentView = v;
            sync();
            return r;
        };
        window.app._navHooked = true;
    };
    document.addEventListener('DOMContentLoaded', function () {
        let tries = 0;
        const id = setInterval(function () {
            tryHook();
            if (window.app && window.app._navHooked) { clearInterval(id); sync(); }
            if (++tries > 40) clearInterval(id);
        }, 250);
    });
})();

// ── Mobile enhancements (M1–M10) ──────────────────────────────────────────
(function () {
    const isMobile = function () { return window.matchMedia('(max-width: 768px)').matches; };

    function autoCardTables(root) {
        if (!isMobile()) return;
        const scope = root || document;
        const tables = scope.querySelectorAll('table:not(.no-card-mode):not(.auto-card-applied)');
        tables.forEach(function (t) {
            if (t.closest('.modal-content')) return;
            const headers = Array.from(t.querySelectorAll('thead th')).map(function (th) { return th.textContent.trim(); });
            if (!headers.length) return;
            t.classList.add('auto-card', 'auto-card-applied');
            t.querySelectorAll('tbody tr').forEach(function (tr) {
                Array.from(tr.children).forEach(function (td, i) {
                    if (!td.getAttribute('data-label') && headers[i]) td.setAttribute('data-label', headers[i]);
                });
            });
        });
    }

    function addCalendarMoreIndicators() { /* no-op */ }
    function setupPipelineDots() { /* no-op */ }

    function setupTreeFullscreen() {
        if (!isMobile()) return;
        document.querySelectorAll('.tree-card, .referral-tree-container').forEach(function (card) {
            if (card.dataset.fsReady) return;
            card.dataset.fsReady = '1';
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'tree-fullscreen-btn';
            btn.innerHTML = '<i class="fas fa-expand"></i> View fullscreen';
            btn.addEventListener('click', function () {
                card.classList.toggle('fullscreen');
                btn.innerHTML = card.classList.contains('fullscreen')
                    ? '<i class="fas fa-compress"></i> Exit fullscreen'
                    : '<i class="fas fa-expand"></i> View fullscreen';
            });
            card.insertBefore(btn, card.firstChild);
        });
    }

    function augmentDrawer() {
        const body = document.getElementById('mobile-drawer-body');
        if (!body) return;
        if (body.querySelector('.mobile-drawer-quick-actions')) return;
        const row = document.createElement('div');
        row.className = 'mobile-drawer-quick-actions';
        row.innerHTML =
            '<button type="button" id="drawer-theme-toggle"><i class="fas fa-moon"></i> Theme</button>' +
            '<button type="button" id="drawer-cmdk-trigger"><i class="fas fa-search"></i> Search</button>';
        body.insertBefore(row, body.firstChild);
        row.querySelector('#drawer-theme-toggle').addEventListener('click', function () {
            window._toggleTheme && window._toggleTheme();
        });
        row.querySelector('#drawer-cmdk-trigger').addEventListener('click', function () {
            if (window.app && window.app.closeMobileDrawer) window.app.closeMobileDrawer();
            const t = document.getElementById('cmdk-trigger');
            if (t) t.click();
            else document.getElementById('cmdk-overlay')?.classList.add('active');
        });
    }

    async function resolveAttachmentImages(root) {
        if (!window.AppDataStore || !AppDataStore.resolveAttachmentSrc) return;
        const scope = root || document;
        const imgs = Array.from(scope.querySelectorAll('img[data-attach-src]:not([data-attach-resolved])'));
        const bgs  = Array.from(scope.querySelectorAll('[data-attach-bg]:not([data-attach-resolved])'));
        if (!imgs.length && !bgs.length) return;
        [...imgs, ...bgs].forEach(function (el) { el.setAttribute('data-attach-resolved', '1'); });
        await Promise.all([
            ...imgs.map(async function (img) {
                const url = await AppDataStore.resolveAttachmentSrc(img.getAttribute('data-attach-src')).catch(function () { return null; });
                if (url) img.src = url; else img.style.display = 'none';
            }),
            ...bgs.map(async function (el) {
                const url = await AppDataStore.resolveAttachmentSrc(el.getAttribute('data-attach-bg')).catch(function () { return null; });
                if (url) el.style.backgroundImage = "url('" + url.replace(/'/g, "\\'") + "')";
            })
        ]);
    }

    function runAll() {
        autoCardTables();
        addCalendarMoreIndicators();
        setupPipelineDots();
        setupTreeFullscreen();
        augmentDrawer();
        resolveAttachmentImages();
    }

    document.addEventListener('DOMContentLoaded', runAll);
    window.addEventListener('resize', function () {
        if (!isMobile()) {
            document.querySelectorAll('table.auto-card-applied').forEach(function (t) { t.classList.remove('auto-card'); });
        } else {
            document.querySelectorAll('table.auto-card-applied').forEach(function (t) { t.classList.add('auto-card'); });
        }
        runAll();
    });

    const viewport = document.getElementById('content-viewport');
    if (viewport) {
        const obs = new MutationObserver(function () {
            clearTimeout(window._mobileEnhanceTimer);
            window._mobileEnhanceTimer = setTimeout(runAll, 250);
        });
        obs.observe(viewport, { childList: true, subtree: true });
    }
    const drawer = document.getElementById('mobile-drawer');
    if (drawer) {
        const obs2 = new MutationObserver(augmentDrawer);
        obs2.observe(drawer, { childList: true, subtree: true });
    }

    window._mobileEnhance = runAll;
    window._resolveAttachmentImages = resolveAttachmentImages;
})();

// ── Attachment opener ──────────────────────────────────────────────────────
window._openAttachment = async function (src) {
    try {
        if (window.AppDataStore && AppDataStore.resolveAttachmentSrc) {
            const url = await AppDataStore.resolveAttachmentSrc(src);
            if (url) { window.open(url, '_blank', 'noopener'); return; }
        }
    } catch (_) {}
    if (src) window.open(src, '_blank', 'noopener');
};

// ── Chart.js dark-theme defaults ──────────────────────────────────────────
(function () {
    function applyChartDefaults() {
        if (typeof window.Chart === 'undefined') return false;
        const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
        const text   = isDark ? '#C7B19A' : '#6B4226';
        const grid   = isDark ? 'rgba(255,200,200,0.06)' : 'rgba(139,0,32,0.08)';
        const accent = isDark ? '#E94560' : '#800020';
        Chart.defaults.color = text;
        Chart.defaults.borderColor = grid;
        Chart.defaults.font.family = "'Inter', sans-serif";
        if (Chart.defaults.scale) {
            Chart.defaults.scale.grid = Chart.defaults.scale.grid || {};
            Chart.defaults.scale.grid.color = grid;
        }
        Chart.defaults.plugins = Chart.defaults.plugins || {};
        Chart.defaults.plugins.legend = Chart.defaults.plugins.legend || {};
        Chart.defaults.plugins.legend.labels = Chart.defaults.plugins.legend.labels || {};
        Chart.defaults.plugins.legend.labels.color = text;
        Chart.defaults.plugins.tooltip = Chart.defaults.plugins.tooltip || {};
        Chart.defaults.plugins.tooltip.backgroundColor = isDark ? 'rgba(30,17,21,0.95)' : 'rgba(255,255,255,0.98)';
        Chart.defaults.plugins.tooltip.titleColor = text;
        Chart.defaults.plugins.tooltip.bodyColor = text;
        Chart.defaults.plugins.tooltip.borderColor = accent;
        Chart.defaults.plugins.tooltip.borderWidth = 1;
        Chart.defaults.plugins.tooltip.padding = 10;
        Chart.defaults.plugins.tooltip.cornerRadius = 8;
        window._chartThemeApplied = true;
        return true;
    }
    const id = setInterval(function () { if (applyChartDefaults()) clearInterval(id); }, 500);
    const obs = new MutationObserver(function () { if (window.Chart) applyChartDefaults(); });
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
})();

// ── Global error tracker ───────────────────────────────────────────────────
(function () {
    const MAX_ERRORS = 50;
    function storeError(entry) {
        try {
            const key = 'crm_error_log';
            const log = JSON.parse(localStorage.getItem(key) || '[]');
            log.unshift(entry);
            if (log.length > MAX_ERRORS) log.length = MAX_ERRORS;
            localStorage.setItem(key, JSON.stringify(log));
        } catch (e) {}
    }
    window.addEventListener('error', function (e) {
        storeError({ type: 'error', msg: e.message, src: e.filename, line: e.lineno, col: e.colno, ts: new Date().toISOString() });
    });
    window.addEventListener('unhandledrejection', function (e) {
        storeError({ type: 'promise', msg: String(e.reason), ts: new Date().toISOString() });
    });
    window.getCRMErrors = function () {
        try { return JSON.parse(localStorage.getItem('crm_error_log') || '[]'); } catch (e) { return []; }
    };
    window.clearCRMErrors = function () {
        try { localStorage.removeItem('crm_error_log'); } catch (e) {}
    };
})();
