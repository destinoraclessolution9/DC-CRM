/**
 * Feng Shui CRM V8.7 - UI Components
 */
window.UI = (() => {
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

            let icon = 'info-circle';
            if (type === 'success') icon = 'check-circle';
            if (type === 'error') icon = 'exclamation-circle';
            if (type === 'warning') icon = 'exclamation-triangle';

            toastEl.innerHTML = `<i class="fas fa-${icon}"></i> <span>${message}</span>`;
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
    const showModal = (title, contentHtml, actions = [], size = '') => {
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
            // Cancel/close buttons skip loading state
            const isCancel = action === 'UI.hideModal()' || /cancel|close|no\b|back/i.test(btn.label);
            return `<button class="${btnClass}" ${isCancel ? 'data-no-load' : ''} onclick="${action}">${btn.label}</button>`;
        }).join('');

        const modalBoxClass = size === 'fullscreen' ? 'modal-box fullscreen' : 'modal-box';

        overlay.innerHTML = `
            <div class="${modalBoxClass}">
                <div class="modal-header">
                    <h3>${title}</h3>
                    <button class="modal-close" onclick="UI.hideModal()">&times;</button>
                </div>
                <div class="modal-content">
                    ${contentHtml}
                </div>
                ${actions.length > 0 ? `<div class="modal-footer">${buttonsHtml}</div>` : ''}
            </div>
        `;

        overlay.classList.add('active');
    };

    const hideModal = () => {
        _endAllBtnLoads();
        const overlay = document.getElementById('global-modal-overlay');
        if (overlay) {
            overlay.classList.remove('active');
            overlay.innerHTML = '';
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
        formatNumber
    };
})();
