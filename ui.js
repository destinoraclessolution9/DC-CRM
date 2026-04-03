/**
 * Feng Shui CRM V8.7 - UI Components
 */
window.UI = (() => {
    // --- Toasts ---
    const toast = {
        show: (message, type = 'info') => {
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
            // Use UI.hideModal() as default or if specified
            const action = (btn.action === 'UI.modal.hide()' || btn.action === 'UI.hideModal()') ? 'UI.hideModal()' : btn.action;
            return `<button class="${btnClass}" onclick="${action}">${btn.label}</button>`;
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
        const overlay = document.getElementById('global-modal-overlay');
        if (overlay) {
            overlay.classList.remove('active');
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
