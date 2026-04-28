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
            .replace(/'/g,  "\\'")
            .replace(/"/g,  '&quot;')
            .replace(/\r/g, '\\r')
            .replace(/\n/g, '\\n')
            .replace(/</g,  '\\x3c')
            .replace(/>/g,  '\\x3e')
            .replace(/&/g,  '&amp;');
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
    const _loadingBtns = new Map(); // btn element -> original innerHTML
    let _loadTimer = null;

    const _startBtnLoad = (btn) => {
        if (!btn || btn.disabled || _loadingBtns.has(btn)) return;
        _loadingBtns.set(btn, btn.innerHTML);
        btn.disabled = true;
        const label = btn.textContent.trim().replace(/\s+/g, ' ');
        btn.innerHTML = `<i class="fas fa-spinner fa-spin"></i> ${label}`;
        // Safety net: auto-restore after 10s
        if (_loadTimer) clearTimeout(_loadTimer);
        _loadTimer = setTimeout(_endAllBtnLoads, 10000);
    };

    const _endAllBtnLoads = () => {
        if (_loadTimer) { clearTimeout(_loadTimer); _loadTimer = null; }
        _loadingBtns.forEach((origHTML, btn) => {
            if (btn.isConnected) {
                btn.disabled = false;
                btn.innerHTML = origHTML;
            }
        });
        _loadingBtns.clear();
    };

    // Global capture-phase listener: intercepts clicks on action buttons before onclick fires
    document.addEventListener('click', (e) => {
        const btn = e.target.closest('button.btn');
        if (!btn || btn.disabled || 'noLoad' in btn.dataset) return;
        const isPrimary = btn.classList.contains('primary');
        const text = btn.textContent.trim().toLowerCase();
        const isActionText = /submit|save|approve|confirm|send/.test(text);
        if (isPrimary || isActionText) _startBtnLoad(btn);
    }, true);

    // --- Toasts ---
    const toast = {
        show: (message, type = 'info') => {
            // Restore loading buttons whenever feedback appears
            if (type !== 'info') _endAllBtnLoads();

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

            setTimeout(() => {
                toastEl.classList.add('fade-out');
                setTimeout(() => toastEl.remove(), 500);
            }, 3000);
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
            const safeLabel = escapeHtml(btn.label);
            return `<button class="${btnClass}" ${isCancel ? 'data-no-load' : ''} onclick="${safeAction}">${safeLabel}</button>`;
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
            overlay.innerHTML = '';
        }
        // Restore focus to element that opened the modal
        if (_modalPreviousFocus && typeof _modalPreviousFocus.focus === 'function') {
            try { _modalPreviousFocus.focus(); } catch (_) {}
            _modalPreviousFocus = null;
        }
    };

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

    return {
        toast,
        showModal,
        hideModal,
        formatDate,
        formatNumber,
        escapeHtml,
        escJsAttr,
        requireNumericId
    };
})();
