/**
 * Feng Shui CRM V8.7 - UI Components
 */
window.UI = (() => {
    // --- HTML escape helper ---
    const escapeHtml = (unsafe) => {
        if (unsafe === null || unsafe === undefined) return '';
        return String(unsafe)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    };

    // Escape a value to be embedded inside a single-quoted JS string within
    // an HTML attribute, e.g. onclick="app.foo('${escJsAttr(name)}')".
    // Handles backslash, quotes, newlines, < (HTML parser end-of-script
    // confusion), and non-printables. Numeric IDs should still use
    // requireNumericId() for defense in depth.
    const escJsAttr = (unsafe) => {
        if (unsafe === null || unsafe === undefined) return '';
        return String(unsafe)
            .replace(/\\/g, '\\\\')
            .replace(/&/g,  '&amp;')
            .replace(/'/g,  "\\'")
            .replace(/"/g,  '&quot;')
            .replace(/\r/g, '\\r')
            .replace(/\n/g, '\\n')
            .replace(/</g,  '\\x3c')
            .replace(/>/g,  '\\x3e');
    };

    // Validates that a value can safely be interpolated as a numeric literal
    // in an onclick attribute (e.g. onclick="app.foo(${requireNumericId(id)})").
    // Throws if the value isn't a finite integer string. Use this on every
    // *Id field that comes from a row/record before embedding.
    const requireNumericId = (v) => {
        if (typeof v === 'number' && Number.isFinite(v) && Number.isInteger(v)) return v;
        if (typeof v === 'string' && /^-?\d{1,18}$/.test(v)) return v;
        throw new Error('requireNumericId: refusing to embed non-numeric value: ' + String(v).slice(0, 64));
    };

    // --- Button Loading State ---
    // Per-button entry: { origHTML, timerId }. Each loading button owns its own
    // 10s safety-net deadline so staggered clicks can't reset/extend another
    // button's auto-restore (a single shared timer let the earliest stuck button
    // stay disabled far past 10s).
    const _loadingBtns = new Map(); // btn element -> { origHTML, timerId }

    // Restore a single button and clear its own timer.
    const _endBtnLoad = (btn) => {
        const entry = _loadingBtns.get(btn);
        if (!entry) return;
        if (entry.timerId) clearTimeout(entry.timerId);
        _loadingBtns.delete(btn);
        if (btn.isConnected) {
            btn.disabled = false;
            btn.innerHTML = entry.origHTML;
        }
    };

    const _startBtnLoad = (btn) => {
        if (!btn || btn.disabled || _loadingBtns.has(btn)) return;
        const origHTML = btn.innerHTML;
        btn.disabled = true;
        const label = btn.textContent.trim().replace(/\s+/g, ' ');
        btn.innerHTML = `<i class="fas fa-spinner fa-spin"></i> ${label}`;
        // Safety net: auto-restore THIS button after 10s on its own deadline.
        const timerId = setTimeout(() => _endBtnLoad(btn), 10000);
        _loadingBtns.set(btn, { origHTML, timerId });
    };

    const _endAllBtnLoads = () => {
        // Snapshot keys first since _endBtnLoad mutates the map during iteration.
        Array.from(_loadingBtns.keys()).forEach(_endBtnLoad);
    };

    // Global capture-phase listener: intercepts clicks on action buttons before onclick fires
    document.addEventListener('click', (e) => {
        const btn = e.target.closest('button.btn');
        if (!btn || btn.disabled || 'noLoad' in btn.dataset) return;
        const isPrimary = btn.classList.contains('primary');
        const text = btn.textContent.trim().toLowerCase();
        const isActionText = /submit|save|approve|confirm|send/.test(text);
        // Filter/search/apply/refresh buttons re-render in place and never emit a
        // toast or close a modal, so nothing calls _endBtnLoad — they'd sit disabled
        // with a stuck spinner until the 10s safety net. Exclude those non-submitting
        // primaries (the submit-verb set above still spins normally).
        const isNonSubmitting = /\b(apply|filter|search|refresh|reload)\b/.test(text);
        if ((isPrimary || isActionText) && !isNonSubmitting) _startBtnLoad(btn);
    }, true);

    // --- In-modal error banner ---
    // When an error toast fires while a modal is open, also pin a banner at the
    // top of the modal content. Toasts at bottom-right of the viewport auto-fade
    // in 3s and on long scrollable modals (e.g. Quick Add Activity) users miss
    // them — they then think the modal is "stuck" because clicking Save did
    // nothing visible. The banner is persistent until dismissed or the modal
    // closes, so the validation reason is always discoverable.
    const _showModalErrorBanner = (message) => {
        const overlay = document.getElementById('global-modal-overlay');
        if (!overlay || !overlay.classList.contains('active')) return;
        const modalBox = overlay.querySelector('.modal-box');
        const modalContent = modalBox?.querySelector('.modal-content');
        if (!modalContent) return;

        let banner = modalBox.querySelector('.modal-error-banner');
        if (!banner) {
            banner = document.createElement('div');
            banner.className = 'modal-error-banner';
            banner.setAttribute('role', 'alert');
            banner.setAttribute('aria-live', 'assertive');
            modalContent.insertBefore(banner, modalContent.firstChild);
        }
        // Rebuild contents via DOM nodes (no innerHTML with raw message → XSS-safe).
        banner.replaceChildren();
        const icon = document.createElement('i');
        icon.className = 'fas fa-exclamation-circle';
        icon.setAttribute('aria-hidden', 'true');
        const msgSpan = document.createElement('span');
        msgSpan.className = 'modal-error-banner-msg';
        msgSpan.textContent = String(message ?? '');
        const closeBtn = document.createElement('button');
        closeBtn.type = 'button';
        closeBtn.className = 'modal-error-banner-close';
        closeBtn.setAttribute('aria-label', 'Dismiss error');
        closeBtn.textContent = '×';
        closeBtn.addEventListener('click', () => banner.remove());
        banner.append(icon, msgSpan, closeBtn);

        // Scroll modal so the banner is in view (handles long forms where the
        // user clicked Save while scrolled to the bottom). Smooth-scroll via
        // scrollTo() is ignored on some flex children, so set scrollTop directly.
        modalContent.scrollTop = 0;
    };

    // --- Toasts ---
    // Keys (type+message) of on-screen toasts so identical ones can't stack —
    // a burst of the same error (e.g. several module loads failing) shows once.
    const _activeToastKeys = new Set();
    const toast = {
        show: (message, type = 'info') => {
            // Restore loading buttons whenever feedback appears (including info —
            // many flows terminate with toast.info as their only feedback, e.g.
            // 'nothing selected'; leaving the button spinning until the 10s safety
            // timeout looks frozen).
            _endAllBtnLoads();

            // Mirror error toasts into any open modal so the user can't miss them.
            if (type === 'error') _showModalErrorBanner(message);

            // Dedup: skip an identical toast already visible (it fades on its
            // own timer; a later identical message shows fresh after it clears).
            const _key = type + ' ' + String(message ?? '');
            if (_activeToastKeys.has(_key)) return;
            _activeToastKeys.add(_key);

            let container = document.getElementById('toast-container');
            if (!container) {
                container = document.createElement('div');
                container.id = 'toast-container';
                container.className = 'toast-container';
                document.body.appendChild(container);
            }

            const toastEl = document.createElement('div');
            toastEl.className = `toast toast-${type}`;
            toastEl.setAttribute('role', type === 'error' ? 'alert' : 'status');
            toastEl.setAttribute('aria-live', type === 'error' ? 'assertive' : 'polite');
            toastEl.setAttribute('aria-atomic', 'true');

            let icon = 'info-circle';
            if (type === 'success') icon = 'check-circle';
            if (type === 'error') icon = 'exclamation-circle';
            if (type === 'warning') icon = 'exclamation-triangle';

            // Build DOM nodes — never innerHTML with user/error text (XSS).
            const iconEl = document.createElement('i');
            iconEl.className = `fas fa-${icon}`;
            iconEl.setAttribute('aria-hidden', 'true');
            const span = document.createElement('span');
            span.textContent = String(message ?? '');
            toastEl.appendChild(iconEl);
            toastEl.appendChild(document.createTextNode(' '));
            toastEl.appendChild(span);
            container.appendChild(toastEl);

            // Errors stick around longer than info/success — users need more time
            // to read and act on them, especially on mobile.
            const lifetimeMs = type === 'error' ? 6000 : 3000;
            setTimeout(() => {
                toastEl.classList.add('fade-out');
                setTimeout(() => { toastEl.remove(); _activeToastKeys.delete(_key); }, 500);
            }, lifetimeMs);
        },
        success: (msg) => toast.show(msg, 'success'),
        error: (msg) => toast.show(msg, 'error'),
        info: (msg) => toast.show(msg, 'info'),
        warning: (msg) => toast.show(msg, 'warning')
    };

    // --- Modals ---
    let _modalPreviousFocus = null;
    const _FOCUSABLE = 'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';

    const _trapFocus = (e) => {
        const overlay = document.getElementById('global-modal-overlay');
        if (!overlay || !overlay.classList.contains('active')) return;
        const focusable = Array.from(overlay.querySelectorAll(_FOCUSABLE)).filter(el => el.offsetParent !== null);
        if (!focusable.length) return;
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (e.key === 'Tab') {
            if (e.shiftKey) {
                if (document.activeElement === first) { e.preventDefault(); last.focus(); }
            } else {
                if (document.activeElement === last) { e.preventDefault(); first.focus(); }
            }
        }
        if (e.key === 'Escape') { e.preventDefault(); hideModal(); }
    };

    const showModal = (title, contentHtml, actions = [], size = '') => {
        _modalPreviousFocus = document.activeElement;

        let overlay = document.getElementById('global-modal-overlay');
        if (!overlay) {
            overlay = document.createElement('div');
            overlay.id = 'global-modal-overlay';
            overlay.className = 'modal-overlay';
            document.body.appendChild(overlay);
        }

        const buttonsHtml = actions.map(btn => {
            const btnClass = btn.type === 'primary' ? 'btn primary' : 'btn secondary';
            const action = (btn.action === 'UI.modal.hide()' || btn.action === 'UI.hideModal()') ? 'UI.hideModal()' : btn.action;
            const isCancel = action === 'UI.hideModal()' || /cancel|close|no\b|back/i.test(btn.label);
            const safeAction = String(action).replace(/"/g, '&quot;');
            return `<button class="${btnClass}" ${isCancel ? 'data-no-load' : ''} onclick="${safeAction}">${btn.label}</button>`;
        }).join('');

        const modalBoxClass = size === 'fullscreen' ? 'modal-box fullscreen' : 'modal-box';
        const safeTitle = escapeHtml(title);
        const titleId = 'modal-title-' + Date.now();

        overlay.innerHTML = `
            <div class="${modalBoxClass}" role="dialog" aria-modal="true" aria-labelledby="${titleId}">
                <div class="modal-header">
                    <h3 id="${titleId}">${safeTitle}</h3>
                    <button class="modal-close" onclick="UI.hideModal()" aria-label="Close dialog">&times;</button>
                </div>
                <div class="modal-content">
                    ${contentHtml}
                </div>
                ${actions.length > 0 ? `<div class="modal-footer">${buttonsHtml}</div>` : ''}
            </div>
        `;

        overlay.classList.add('active');
        // Remove any stale handler first so rapid re-opens don't stack duplicate
        // keydown listeners (each showModal would otherwise add another).
        document.removeEventListener('keydown', _trapFocus);
        document.addEventListener('keydown', _trapFocus);

        // Focus first focusable element inside modal
        const firstFocusable = overlay.querySelector(_FOCUSABLE);
        if (firstFocusable) setTimeout(() => firstFocusable.focus(), 50);

        if (window._resolveAttachmentImages) window._resolveAttachmentImages(overlay);
    };

    const hideModal = () => {
        _endAllBtnLoads();
        document.removeEventListener('keydown', _trapFocus);
        const overlay = document.getElementById('global-modal-overlay');
        if (overlay) {
            overlay.classList.remove('active');
            // #23 — unmount any React modal root BEFORE blanking the overlay.
            // Clearing innerHTML alone detaches the React tree without unmounting
            // it, leaking its effects/timers/listeners. These mount fns render
            // into the modal content area, so tear them down first; the
            // innerHTML clear below stays the final step.
            // NOTE: do NOT unmount the KB editor here — it mounts into the
            // Knowledge HQ view's #kb-slot (page content), not the modal overlay,
            // so tearing it down on any modal close blanks the editor the user is
            // working in (discarding un-autosaved capture / detail edits).
            try {
                const R = window.CRMReact;
                if (R) {
                    if (R.unmountModalContent) R.unmountModalContent();
                    if (R.unmountAIInsights) R.unmountAIInsights();
                }
            } catch (_) {}
            overlay.innerHTML = '';
        }
        // Restore focus to element that opened the modal
        if (_modalPreviousFocus && typeof _modalPreviousFocus.focus === 'function') {
            try { _modalPreviousFocus.focus(); } catch (_) {}
            _modalPreviousFocus = null;
        }
    };

    // --- Confirm dialog ---
    // _confirm wires up the callback + buttons; bodyHtml is the already-built
    // (and already-escaped where appropriate) modal body so showModal renders it
    // verbatim. Callers go through confirm() (escapes plain text by default) or
    // confirmHtml() (intentional markup — caller is responsible for escaping any
    // interpolated user data with escapeHtml).
    const _confirm = (title, bodyHtml, onConfirm) => {
        window._uiConfirmCb = async () => {
            hideModal();
            delete window._uiConfirmCb;
            // The modal is already gone, so a rejection here would be invisible.
            // Surface it as a toast instead of an unhandled promise rejection.
            try {
                if (typeof onConfirm === 'function') await onConfirm();
            } catch (err) {
                if (toast && toast.error) toast.error('Action failed: ' + (err?.message || err));
                else console.error('Confirm action failed:', err);
            }
        };
        showModal(
            title,
            `<p style="margin:0;line-height:1.6;">${bodyHtml}</p>`,
            [
                { label: 'Confirm', type: 'primary', action: 'window._uiConfirmCb && window._uiConfirmCb()' },
                { label: 'Cancel', type: 'secondary', action: 'UI.hideModal()' }
            ]
        );
    };

    // Plain-text confirm: message is HTML-escaped so callers can pass raw
    // user-derived text (prospect name, note text) without an XSS sink. This is
    // the safe default — nearly all confirm messages are plain text.
    const confirm = (title, message, onConfirm) =>
        _confirm(title, escapeHtml(message), onConfirm);

    // Markup confirm: message is interpolated as raw HTML. Use ONLY when the
    // caller intentionally includes markup (e.g. <strong>) and has escaped every
    // interpolated value with UI.escapeHtml() itself.
    const confirmHtml = (title, message, onConfirm) =>
        _confirm(title, String(message ?? ''), onConfirm);

    // --- Formatters ---
    const formatDate = (d) => {
        if (!d) return '—';
        const date = new Date(d);
        if (isNaN(date.getTime())) return d;
        return date.toLocaleDateString('en-MY', { year: 'numeric', month: 'short', day: 'numeric' });
    };

    const formatNumber = (n) => {
        const num = parseFloat(n);
        if (isNaN(num)) return '0';
        return num.toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    };

    // ═══════════════════════════════════════════════════════════════════════
    //  UI-System foundation (Phase 1) — ADDITIVE. Nothing below mutates the
    //  existing toast / modal code paths. These are NEW reusable primitives the
    //  component library builds on: the vanilla "UI.kit.*" string-builders +
    //  shared a11y behaviors (focus-trap, live announcer, roving tabindex).
    //  The React track (src/react/ui/*) mirrors the same names & token classes.
    // ═══════════════════════════════════════════════════════════════════════

    // JS mirror of the --bp-md CSS token so JS render-path branching and CSS
    // media queries can never disagree on the breakpoint.
    try { window.CRM_BP = Object.freeze({ md: 768 }); } catch (_) {}

    const _KIT_FOCUSABLE = 'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';

    // ── Shared focus management ──────────────────────────────────────────────
    // One reusable focus-trap for modals, drawers and bottom-sheets. Self-
    // contained — does NOT touch the existing modal _trapFocus. trap() returns
    // a release() that removes the trap and restores focus to the opener.
    const focus = {
        getFocusable(container) {
            if (!container) return [];
            return Array.from(container.querySelectorAll(_KIT_FOCUSABLE))
                .filter(el => el.offsetParent !== null || el === document.activeElement);
        },
        trap(container, opts = {}) {
            if (!container) return () => {};
            const restoreTo = opts.restoreTo || document.activeElement;
            const onEscape = typeof opts.onEscape === 'function' ? opts.onEscape : null;
            const onKey = (e) => {
                if (e.key === 'Escape' && onEscape) { e.preventDefault(); onEscape(e); return; }
                if (e.key !== 'Tab') return;
                const f = focus.getFocusable(container);
                if (!f.length) return;
                const first = f[0], last = f[f.length - 1];
                if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
                else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
            };
            container.addEventListener('keydown', onKey);
            // Initial focus after paint so screen readers announce in DOM order.
            const target = opts.initialFocus || focus.getFocusable(container)[0];
            if (target) requestAnimationFrame(() => { try { target.focus(); } catch (_) {} });
            return function release() {
                container.removeEventListener('keydown', onKey);
                if (restoreTo && typeof restoreTo.focus === 'function') {
                    try { restoreTo.focus(); } catch (_) {}
                }
            };
        }
    };

    // ── Polite / assertive route + status announcer ──────────────────────────
    // Singleton visually-hidden live regions (.sr-only already in styles-fixed).
    // Toasts keep their OWN regions; use this for view-load / async-state copy.
    const _ensureLiveRegion = (assertive) => {
        const id = assertive ? 'ui-live-assertive' : 'ui-live-polite';
        let el = document.getElementById(id);
        if (!el) {
            el = document.createElement('div');
            el.id = id;
            el.className = 'sr-only';
            el.setAttribute('role', assertive ? 'alert' : 'status');
            el.setAttribute('aria-live', assertive ? 'assertive' : 'polite');
            el.setAttribute('aria-atomic', 'true');
            document.body.appendChild(el);
        }
        return el;
    };
    const live = (message, opts = {}) => {
        const el = _ensureLiveRegion(!!opts.assertive);
        // Clear then set next frame so identical consecutive messages re-announce.
        el.textContent = '';
        requestAnimationFrame(() => { el.textContent = String(message ?? ''); });
    };

    // ── Roving-tabindex behavior (menus / tabs / toolbars) ───────────────────
    const a11y = {
        roving(container, opts = {}) {
            if (!container) return () => {};
            const selector = opts.selector || '[role="menuitem"],[role="tab"],[data-roving]';
            const orientation = opts.orientation || 'vertical';
            const items = () => Array.from(container.querySelectorAll(selector))
                .filter(el => !el.hasAttribute('disabled'));
            const setTab = (list, idx) => list.forEach((el, i) => { el.tabIndex = i === idx ? 0 : -1; });
            setTab(items(), 0);
            const nextKey = orientation === 'horizontal' ? 'ArrowRight' : 'ArrowDown';
            const prevKey = orientation === 'horizontal' ? 'ArrowLeft' : 'ArrowUp';
            const onKey = (e) => {
                const list = items();
                const cur = list.indexOf(document.activeElement);
                if (cur < 0) return;
                let next = -1;
                if (e.key === nextKey) next = (cur + 1) % list.length;
                else if (e.key === prevKey) next = (cur - 1 + list.length) % list.length;
                else if (e.key === 'Home') next = 0;
                else if (e.key === 'End') next = list.length - 1;
                if (next >= 0) { e.preventDefault(); setTab(list, next); list[next].focus(); }
            };
            container.addEventListener('keydown', onKey);
            return function destroy() { container.removeEventListener('keydown', onKey); };
        }
    };

    // ── Country registry: the ONE place that knows a market's currency ───────
    // Extensible — add a market by adding a row here (and a `countries` DB row +
    // its per-country product prices). No other code change needed. This mirrors
    // the public.countries table; kept client-side so currency rendering stays
    // synchronous (formatCurrency is called on every card/cell). If the registry
    // ever needs to be admin-editable at runtime, load the DB rows into COUNTRIES
    // at boot — every consumer already reads through the helpers below.
    const COUNTRIES = [
        { code: 'MY', name: 'Malaysia',  currency: 'MYR', symbol: 'RM', locale: 'en-MY' },
        { code: 'SG', name: 'Singapore', currency: 'SGD', symbol: 'S$', locale: 'en-SG' },
        { code: 'AU', name: 'Australia', currency: 'AUD', symbol: 'A$', locale: 'en-AU' },
    ];
    const DEFAULT_COUNTRY = 'MY';
    // currency code → { symbol, locale } (derived from COUNTRIES; the lookup key
    // is the currency, so two markets sharing a currency would still resolve).
    const _CURRENCY = COUNTRIES.reduce((m, c) => {
        if (!m[c.currency]) m[c.currency] = { symbol: c.symbol, locale: c.locale };
        return m;
    }, {});
    const countryByCode = (code) =>
        COUNTRIES.find(c => c.code === code) ||
        COUNTRIES.find(c => c.code === DEFAULT_COUNTRY);
    // ISO country code → ISO currency code (e.g. 'SG' → 'SGD'). Unknown → MYR.
    const currencyForCountry = (code) => countryByCode(code).currency;

    // ── Formatters: currency / compact — currency-aware, default MYR / RM ─────
    // opts.currency is an ISO-4217 code ('MYR' default | 'SGD' | 'AUD'). Omitting
    // it keeps the historical 'RM …' / en-MY output byte-identical, so every
    // existing call site is unchanged.
    const formatCurrency = (n, opts = {}) => {
        const num = Number(n);
        if (!Number.isFinite(num)) return '—';
        const dp = opts.dp == null ? 0 : opts.dp;
        const cur = _CURRENCY[opts.currency] || _CURRENCY.MYR;
        return cur.symbol + ' ' + num.toLocaleString(cur.locale, { minimumFractionDigits: dp, maximumFractionDigits: dp });
    };
    const formatCompact = (n, opts = {}) => {
        const num = Number(n);
        if (!Number.isFinite(num)) return '—';
        const cur = _CURRENCY[opts.currency] || _CURRENCY.MYR;
        const abs = Math.abs(num);
        if (abs >= 1e6) return cur.symbol + ' ' + (num / 1e6).toFixed(abs >= 1e7 ? 0 : 1) + 'M';
        if (abs >= 1e3) return cur.symbol + ' ' + (num / 1e3).toFixed(abs >= 1e4 ? 0 : 1) + 'K';
        return formatCurrency(num, opts);
    };
    // Render an amount in a COUNTRY's currency (resolves country → currency for you).
    //   UI.money(45, 'SG')            → 'S$ 45'
    //   UI.money(1500.5, 'MY', {dp:2})→ 'RM 1,500.50'
    const money = (n, country, opts = {}) =>
        formatCurrency(n, { ...opts, currency: currencyForCountry(country) });
    const moneyCompact = (n, country) =>
        formatCompact(n, { currency: currencyForCountry(country) });

    // ── Vanilla UI kit: escaped string-builders that REUSE existing classes ──
    // Every interpolation routes through escapeHtml; onClick strings are the
    // caller's responsibility (build them with requireNumericId / escJsAttr).
    //
    // _onclickAttr builds the onclick="" attribute for a kit-rendered button.
    // CONTRACT (loud reminder): o.onClick is a raw JS expression and is NOT a
    // text sink — the CALLER must escape every interpolated user value with
    // escJsAttr()/requireNumericId() before building the string. This helper
    // only HTML-escapes the four attribute-breaking characters (" & < >) so a
    // forwarded value can't break out of the attribute / confuse the HTML
    // parser. It deliberately does NOT touch ' or \ — those are legitimate JS
    // string syntax in onClick and rewriting them would corrupt valid handlers.
    const _onclickAttr = (onClick) => {
        if (!onClick) return '';
        const safe = String(onClick)
            .replace(/&/g, '&amp;')
            .replace(/"/g, '&quot;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;');
        return ` onclick="${safe}"`;
    };
    const _BADGE_TONES = {
        neutral: 'color:var(--text-secondary);background:var(--bg-sunken);',
        info:    'color:var(--info-text);background:rgba(31,111,178,0.10);',
        success: 'color:var(--success-text);background:rgba(46,125,91,0.12);',
        warning: 'color:var(--warning-text);background:rgba(199,119,0,0.12);',
        danger:  'color:var(--danger-text);background:rgba(232,67,147,0.10);'
    };
    const _btnVariantClass = (v) =>
        v === 'primary' ? 'primary' : v === 'danger' ? 'danger'
        : v === 'ghost' ? 'ghost' : v === 'link' ? 'link' : 'secondary';
    const kit = {
        button(o = {}) {
            const cls = ['btn', _btnVariantClass(o.variant)];
            if (o.size === 'sm') cls.push('btn-sm');
            if (o.size === 'lg') cls.push('btn-lg');
            if (o.fullWidth) cls.push('btn-block');
            const onclick = _onclickAttr(o.onClick);
            const aria = o.ariaLabel ? ` aria-label="${escapeHtml(o.ariaLabel)}"` : '';
            const busy = o.loading ? ' aria-busy="true"' : '';
            const dis = (o.disabled || o.loading) ? ' disabled' : '';
            const noLoad = o.noLoad ? ' data-no-load' : '';
            const type = ` type="${o.type === 'submit' ? 'submit' : o.type === 'reset' ? 'reset' : 'button'}"`;
            const icon = o.loading ? '<i class="fas fa-spinner fa-spin" aria-hidden="true"></i> '
                       : o.iconClass ? `<i class="${escapeHtml(o.iconClass)}" aria-hidden="true"></i> ` : '';
            return `<button class="${cls.join(' ')}"${type}${onclick}${aria}${busy}${dis}${noLoad}>${icon}${escapeHtml(o.label ?? '')}</button>`;
        },
        iconButton(o = {}) {
            const aria = o.ariaLabel || o['aria-label'];
            if (!aria) throw new Error('UI.kit.iconButton: ariaLabel is required for icon-only buttons');
            const onclick = _onclickAttr(o.onClick);
            const dis = o.disabled ? ' disabled' : '';
            const extra = o.className ? ' ' + escapeHtml(o.className) : '';
            return `<button class="btn-icon${extra}" type="button" aria-label="${escapeHtml(aria)}"${onclick}${dis}><i class="${escapeHtml(o.icon || '')}" aria-hidden="true"></i></button>`;
        },
        badge(o = {}) {
            const tone = _BADGE_TONES[o.tone] ? o.tone : 'neutral';
            const style = _BADGE_TONES[tone] + 'display:inline-block;padding:2px 8px;border-radius:999px;font-size:12px;font-weight:600;line-height:1.5;';
            return `<span class="ui-badge" style="${style}">${escapeHtml(o.label ?? '')}</span>`;
        },
        scoreBadge(grade) {
            const g = String(grade || '').trim();
            const safe = g.replace(/[^A-Za-z+\-]/g, '');
            return `<span class="score-badge score-${escapeHtml(safe)}">${escapeHtml(g || '—')}</span>`;
        },
        spinner(o = {}) {
            const label = escapeHtml(o.label || 'Loading');
            return `<span class="ui-spinner" role="status"><i class="fas fa-spinner fa-spin" aria-hidden="true"></i><span class="sr-only">${label}</span></span>`;
        },
        skeleton(o = {}) {
            const rows = Math.max(1, o.rows || 3);
            let out = '<div class="ui-skeleton" aria-hidden="true">';
            for (let i = 0; i < rows; i++) out += `<div class="skeleton-block skeleton-row" style="width:${60 + (i * 13) % 35}%"></div>`;
            return out + '</div>';
        },
        field(o = {}) {
            const id = o.id || ('fld-' + Math.random().toString(36).slice(2, 9));
            const type = o.type || 'text';
            const label = o.label
                ? `<label for="${id}" class="form-label">${escapeHtml(o.label)}${o.required ? ' <span aria-hidden="true" style="color:var(--danger-text)">*</span>' : ''}</label>`
                : '';
            const name = o.name ? ` name="${escapeHtml(o.name)}"` : '';
            const ph = o.placeholder ? ` placeholder="${escapeHtml(o.placeholder)}"` : '';
            const req = o.required ? ' aria-required="true" required' : '';
            const hintId = o.hint ? id + '-hint' : '';
            const errId = o.error ? id + '-err' : '';
            const describedBy = [hintId, errId].filter(Boolean).join(' ');
            const desc = describedBy ? ` aria-describedby="${describedBy}"` : '';
            const invalid = o.error ? ' aria-invalid="true"' : '';
            const aria = (!o.label && o.ariaLabel) ? ` aria-label="${escapeHtml(o.ariaLabel)}"` : '';
            const control = type === 'textarea'
                ? `<textarea id="${id}" class="form-control"${name}${ph}${req}${desc}${invalid}${aria}>${escapeHtml(o.value ?? '')}</textarea>`
                : `<input id="${id}" type="${escapeHtml(type)}" class="form-control"${o.value != null ? ` value="${escapeHtml(o.value)}"` : ''}${name}${ph}${req}${desc}${invalid}${aria}>`;
            const hint = o.hint ? `<small id="${hintId}" class="form-hint" style="color:var(--text-muted)">${escapeHtml(o.hint)}</small>` : '';
            const err = o.error ? `<small id="${errId}" class="form-error" role="alert" style="color:var(--danger-text)">${escapeHtml(o.error)}</small>` : '';
            return `<div class="form-group">${label}${control}${hint}${err}</div>`;
        },
        emptyState(o = {}) {
            const icon = o.icon || 'fa-inbox';
            const title = escapeHtml(o.title || 'Nothing here yet');
            const desc = o.description ? `<p style="color:var(--text-muted);margin:6px 0 14px">${escapeHtml(o.description)}</p>` : '';
            return `<div class="ui-empty-state" role="status" style="text-align:center;padding:40px 20px"><i class="fas ${escapeHtml(icon)}" aria-hidden="true" style="font-size:34px;color:var(--text-muted);opacity:.6"></i><h4 style="margin:14px 0 0">${title}</h4>${desc}${o.actionHtml || ''}</div>`;
        },
        errorState(o = {}) {
            const title = escapeHtml(o.title || 'Something went wrong');
            const desc = escapeHtml(o.description || 'Please try again.');
            const retry = o.onRetry
                ? `<div style="margin-top:14px">${kit.button({ variant: 'secondary', label: o.retryLabel || 'Retry', onClick: o.onRetry, iconClass: 'fas fa-rotate-right' })}</div>`
                : '';
            return `<div class="ui-error-state" role="alert" style="text-align:center;padding:40px 20px"><i class="fas fa-triangle-exclamation" aria-hidden="true" style="font-size:34px;color:var(--danger-text)"></i><h4 style="margin:14px 0 4px">${title}</h4><p style="color:var(--text-muted);margin:0">${desc}</p>${retry}</div>`;
        }
    };

    return {
        toast,
        showModal,
        hideModal,
        confirm,
        confirmHtml,
        formatDate,
        formatNumber,
        formatCurrency,
        formatCompact,
        // ── Multi-country: registry + currency resolver ──
        countries: COUNTRIES,
        defaultCountry: DEFAULT_COUNTRY,
        countryByCode,
        currencyForCountry,
        money,
        moneyCompact,
        escapeHtml,
        escJsAttr,
        requireNumericId,
        // ── UI-system foundation (Phase 1) ──
        kit,
        focus,
        live,
        a11y
    };
})();
