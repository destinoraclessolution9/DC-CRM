// ========== MOBILE-OPTIMIZED COMPONENTS ==========

// Swipeable card component
const createSwipeableCard = (item, onLeftSwipe, onRightSwipe) => {
    const card = document.createElement('div');
    card.className = 'swipeable-card';
    card.setAttribute('data-id', item.id);

    let startX = 0;
    let currentX = 0;
    let isDragging = false;

    card.addEventListener('touchstart', (e) => {
        startX = e.touches[0].clientX;
        isDragging = true;
        card.style.transition = 'none';
    });

    card.addEventListener('touchmove', (e) => {
        if (!isDragging) return;
        e.preventDefault();

        currentX = e.touches[0].clientX;
        const diff = currentX - startX;

        // Limit swipe distance
        if (Math.abs(diff) < 100) {
            card.style.transform = `translateX(${diff}px)`;
        }
    });

    card.addEventListener('touchend', (e) => {
        if (!isDragging) return;
        isDragging = false;

        const diff = currentX - startX;
        card.style.transition = 'transform 0.3s ease';

        if (Math.abs(diff) > 50) {
            if (diff > 0 && onRightSwipe) {
                // Swipe right
                card.style.transform = 'translateX(100%)';
                setTimeout(() => {
                    onRightSwipe(item);
                    card.remove();
                }, 300);
            } else if (diff < 0 && onLeftSwipe) {
                // Swipe left
                card.style.transform = 'translateX(-100%)';
                setTimeout(() => {
                    onLeftSwipe(item);
                    card.remove();
                }, 300);
            } else {
                card.style.transform = 'translateX(0)';
            }
        } else {
            card.style.transform = 'translateX(0)';
        }
    });

    return card;
};

// Pull-to-refresh component
const initPullToRefresh = (onRefresh) => {
    const container = document.querySelector('.main-content');
    if (!container) return;

    let startY = 0;
    let currentY = 0;
    let pulling = false;
    let refreshTriggered = false;

    // Create pull indicator
    const pullIndicator = document.createElement('div');
    pullIndicator.className = 'pull-indicator';
    pullIndicator.innerHTML = '<i class="fas fa-arrow-down"></i><span>Pull to refresh</span>';
    container.prepend(pullIndicator);

    container.addEventListener('touchstart', (e) => {
        if (container.scrollTop === 0) {
            startY = e.touches[0].clientY;
            pulling = true;
        }
    });

    container.addEventListener('touchmove', (e) => {
        if (!pulling) return;

        currentY = e.touches[0].clientY;
        const diff = currentY - startY;

        if (diff > 0 && diff < 150) {
            e.preventDefault();
            container.style.transform = `translateY(${diff}px)`;
            pullIndicator.classList.add('pulling');

            if (diff > 100) {
                pullIndicator.innerHTML = '<i class="fas fa-arrow-up"></i><span>Release to refresh</span>';
                refreshTriggered = true;
            } else {
                pullIndicator.innerHTML = '<i class="fas fa-arrow-down"></i><span>Pull to refresh</span>';
                refreshTriggered = false;
            }
        }
    });

    container.addEventListener('touchend', (e) => {
        if (!pulling) return;
        pulling = false;

        container.style.transition = 'transform 0.3s ease';
        container.style.transform = 'translateY(0)';
        pullIndicator.classList.remove('pulling');

        if (refreshTriggered && onRefresh) {
            pullIndicator.innerHTML = '<i class="fas fa-spinner fa-spin"></i><span>Refreshing...</span>';
            onRefresh().then(() => {
                pullIndicator.innerHTML = '<i class="fas fa-check"></i><span>Updated!</span>';
                setTimeout(() => {
                    pullIndicator.innerHTML = '<i class="fas fa-arrow-down"></i><span>Pull to refresh</span>';
                }, 2000);
            });
        }

        setTimeout(() => {
            container.style.transition = '';
        }, 300);
    });
};

// Mobile-optimized list view
const renderMobileList = (items, template, options = {}) => {
    const {
        searchable = true,
        sortable = true,
        groupBy = null,
        emptyMessage = 'No items found'
    } = options;

    let html = `
        <div class="mobile-list-container">
            ${searchable ? `
                <div class="mobile-search">
                    <i class="fas fa-search"></i>
                    <input type="text" placeholder="Search..." id="mobile-search-input">
                </div>
            ` : ''}
            
            ${sortable ? `
                <div class="mobile-sort">
                    <select id="mobile-sort-select">
                        <option value="name">Sort by Name</option>
                        <option value="date">Sort by Date</option>
                        <option value="status">Sort by Status</option>
                    </select>
                </div>
            ` : ''}
            
            <div class="mobile-list" id="mobile-list">
    `;

    if (groupBy) {
        // Group items
        const groups = {};
        items.forEach(item => {
            const groupKey = item[groupBy] || 'Other';
            if (!groups[groupKey]) groups[groupKey] = [];
            groups[groupKey].push(item);
        });

        Object.keys(groups).sort().forEach(group => {
            html += `<div class="list-group-header">${group}</div>`;
            groups[group].forEach(item => {
                html += template(item);
            });
        });
    } else {
        items.forEach(item => {
            html += template(item);
        });
    }

    if (items.length === 0) {
        html += `<div class="empty-list">${emptyMessage}</div>`;
    }

    html += `
            </div>
        </div>
    `;

    return html;
};

// Mobile action sheet
const showMobileActionSheet = (actions, title = 'Actions') => {
    const sheet = document.createElement('div');
    sheet.className = 'action-sheet';

    sheet.innerHTML = `
        <div class="action-sheet-overlay"></div>
        <div class="action-sheet-content">
            <div class="action-sheet-header">
                <h3>${title}</h3>
                <button class="close-btn"><i class="fas fa-times"></i></button>
            </div>
            <div class="action-sheet-actions">
                ${actions.map(action => `
                    <button class="action-btn ${action.destructive ? 'destructive' : ''}" data-action="${action.id}">
                        <i class="${action.icon}"></i>
                        <span>${action.label}</span>
                    </button>
                `).join('')}
            </div>
            <button class="action-sheet-cancel">Cancel</button>
        </div>
    `;

    document.body.appendChild(sheet);

    // Animate in
    setTimeout(() => {
        sheet.classList.add('visible');
    }, 10);

    // Event handlers
    const close = () => {
        sheet.classList.remove('visible');
        setTimeout(() => {
            sheet.remove();
        }, 300);
    };

    sheet.querySelector('.action-sheet-overlay').addEventListener('click', close);
    sheet.querySelector('.close-btn').addEventListener('click', close);
    sheet.querySelector('.action-sheet-cancel').addEventListener('click', close);

    actions.forEach(action => {
        sheet.querySelector(`[data-action="${action.id}"]`).addEventListener('click', () => {
            action.handler();
            close();
        });
    });

    return sheet;
};

// Mobile bottom sheet
const showMobileBottomSheet = (content, height = '50%') => {
    const sheet = document.createElement('div');
    sheet.className = 'bottom-sheet';

    sheet.innerHTML = `
        <div class="bottom-sheet-overlay"></div>
        <div class="bottom-sheet-content" style="height: ${height};">
            <div class="bottom-sheet-handle"></div>
            <div class="bottom-sheet-body">
                ${content}
            </div>
        </div>
    `;

    document.body.appendChild(sheet);

    // Animate in
    setTimeout(() => {
        sheet.classList.add('visible');
    }, 10);

    // Drag to dismiss
    let startY = 0;
    let currentY = 0;
    const contentEl = sheet.querySelector('.bottom-sheet-content');
    const handle = sheet.querySelector('.bottom-sheet-handle');

    handle.addEventListener('touchstart', (e) => {
        startY = e.touches[0].clientY;
    });

    handle.addEventListener('touchmove', (e) => {
        currentY = e.touches[0].clientY;
        const diff = currentY - startY;

        if (diff > 0) {
            contentEl.style.transform = `translateY(${diff}px)`;
        }
    });

    handle.addEventListener('touchend', () => {
        const diff = currentY - startY;

        if (diff > 100) {
            // Dismiss
            sheet.classList.remove('visible');
            setTimeout(() => {
                sheet.remove();
            }, 300);
        } else {
            // Snap back
            contentEl.style.transform = '';
        }
    });

    sheet.querySelector('.bottom-sheet-overlay').addEventListener('click', () => {
        sheet.classList.remove('visible');
        setTimeout(() => {
            sheet.remove();
        }, 300);
    });

    return sheet;
};
