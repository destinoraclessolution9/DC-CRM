/**
 * CRM Lazy Chunk: 福德 View + Story + Highlight + Reward CRUD
 * Covers: showFudeView, 福德 rewards, Candle/Fude tracking, story/highlight CRUD,
 *   Destiny Blueprint, CPS analysis, Appraisal modal.
 * Loaded on-demand when navigating to the fude view.
 * Extracted 2026-06-05 (~2483 lines).
 */
(() => {
    const _state = window._appState;
    const _utils = window._crmUtils;
    const esc    = (...a) => _utils.escapeHtml(...a);
    const isMobile = () => _utils.isMobile();
    const isSystemAdmin        = (u) => _utils.isSystemAdmin(u || _state.cu);
    const isMarketingManager   = (u) => _utils.isMarketingManager(u || _state.cu);
    const isAgent              = (u) => _utils.isAgent(u || _state.cu);
    const isManagement         = (u) => _utils.isManagement(u || _state.cu);
    const isTeamLeaderOrAbove  = (u) => _utils.isTeamLeaderOrAbove(u || _state.cu);
    const isCustomer           = (u) => _utils.isCustomer(u || _state.cu);
    const isReferrer           = (u) => _utils.isReferrer(u || _state.cu);
    const _getUserLevel        = (u) => _utils.getUserLevel(u);
    const navigateTo           = (v) => window.app.navigateTo(v);
    // News-highlight push notification — defined in script-activities.js, exported to window.app.
    // Fire-and-forget after a highlight is created/edited.
    const _notifyHighlightSaved = (...a) => (window.app._notifyHighlightSaved || (() => Promise.resolve()))(...a);

    // React modal-content passthrough — DEFAULT-ON (parity-verified live, SW-89:
    // all 8 fude modals render through the React root with signature pads bound,
    // bagua/Likert/referral cells + year-label listener intact). Kill-switch:
    // window.__REACT_FUDEMODALS=false | ?react_fudemodals=0 | crm_react_fudemodals
    // ='0' (plus the global ?react=0 / crm_react_off='1').
    const _reactFudeModalsOn = () => {
        try {
            if (/[?&]react=0/.test(location.search)) return false;
            if (localStorage.getItem('crm_react_off') === '1') return false;
            if (!(window.CRMReact && typeof window.CRMReact.mountModalContent === 'function')) return false;
            if (window.__REACT_FUDEMODALS === false) return false;
            if (/[?&]react_fudemodals=0/.test(location.search)) return false;
            if (localStorage.getItem('crm_react_fudemodals') === '0') return false;
            return true;
        } catch (_) { return false; }
    };
    // Route a modal BODY through the generic React passthrough island (chunk keeps
    // 100% of logic; inline handlers + <style> + signature pads survive because
    // dangerouslySetInnerHTML uses innerHTML). Footer `actions` render normally in
    // UI.showModal's footer (outside the React root). flushSync (in the island
    // mount) guarantees the DOM is present before any post-render setTimeout wiring.
    const _rxShowModal = (title, html, actions, size) => {
        if (_reactFudeModalsOn()) {
            UI.showModal(title, '<div id="fude-modal-react-root"></div>', actions || [], size || '');
            const root = document.getElementById('fude-modal-react-root');
            if (root && window.CRMReact && typeof window.CRMReact.mountModalContent === 'function') {
                try { window.CRMReact.mountModalContent(root, { html }); return; }
                catch (e) { console.warn('[fude] modal island mount failed, legacy:', e && e.message); root.outerHTML = html; return; }
            }
        }
        UI.showModal(title, html, actions || [], size || '');
    };

    // React fude-VIEW passthrough — DEFAULT-ON (parity-verified live, SW-92:
    // renders through the React root with all sections/carousel/stories/admin
    // tables; carousel dot quirk is a PRE-EXISTING legacy bug, identical on both
    // paths). Kill-switch: window.__REACT_FUDEVIEW=false | ?react_fudeview=0 |
    // crm_react_fudeview='0' (plus the global ?react=0 / crm_react_off='1').
    const _reactFudeViewOn = () => {
        try {
            if (/[?&]react=0/.test(location.search)) return false;
            if (localStorage.getItem('crm_react_off') === '1') return false;
            if (!(window.CRMReact && typeof window.CRMReact.mountFudeContent === 'function')) return false;
            if (window.__REACT_FUDEVIEW === false) return false;
            if (/[?&]react_fudeview=0/.test(location.search)) return false;
            if (localStorage.getItem('crm_react_fudeview') === '0') return false;
            return true;
        } catch (_) { return false; }
    };
    // Render the assembled fude-view HTML into `container`, routed through the
    // dedicated fude-view React root when enabled (re-mount on each call; the
    // carousel/filter wiring operates on the rendered descendants regardless).
    const _rxRenderFude = (container, viewHtml) => {
        if (_reactFudeViewOn()) {
            container.innerHTML = '<div id="fude-react-root"></div>';
            const root = document.getElementById('fude-react-root');
            if (root && window.CRMReact && typeof window.CRMReact.mountFudeContent === 'function') {
                try { window.CRMReact.mountFudeContent(root, { html: viewHtml }); return; }
                catch (e) { console.warn('[fude] view island mount failed, legacy:', e && e.message); }
            }
        }
        container.innerHTML = viewHtml;
    };

// Shared 福气 leaderboard reducer — single source of truth for both the rendered
// leaderboard table (showFudeView) and the Export KPI Dashboard download. Sums
// 福气 points + sharing returns per user, resolves the display name, and ranks by
// points desc. Returns [{ user_id, name, pts, ret }].
const _computeFudeLeaderboard = (allRewards, allUsersForReward) => {
    const totals = {};
    (allRewards || []).forEach(r => {
        if (!totals[r.user_id]) totals[r.user_id] = { pts: 0, ret: 0 };
        totals[r.user_id].pts += parseInt(r.fudi_points)     || 0;
        totals[r.user_id].ret += parseFloat(r.sharing_return) || 0;
    });
    return Object.entries(totals)
        .map(([uid, t]) => {
            const u = (allUsersForReward || []).find(u => u.id === parseInt(uid));
            return { user_id: uid, name: u?.full_name || 'User ' + uid, pts: t.pts, ret: t.ret };
        })
        .sort((a, b) => b.pts - a.pts);
};

// --- News carousel HTML builder (pure; extracted from showFudeView) ---
// Takes exactly the vars it reads and RETURNS the section HTML string.
const _buildFudeCarousel = (publicNews, imgSrc, fmtDate) => {
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
                    <h3>${esc(n.title)}</h3>
                    ${n.content ? `<p>${esc(n.content)}</p>` : ''}
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
                    <a class="fude-sec-link" style="cursor:pointer;" onclick="app.openStoryDetail(${publicNews[0].id})">See all news →</a>
                </div>
                <div class="fude-carousel-wrap">
                    ${arrows}
                    <div class="fude-carousel-track" data-idx="0">${slides}</div>
                </div>
                ${dots}
            </div>`;
};

// --- Success Stories grid builder (pure; extracted from showFudeView) ---
const _buildFudeStories = (successStories, imgSrc, fmtDate) => {
        const PREVIEW = 6;
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
        const allTags = [...new Set(
            successStories.flatMap(s => (s.tags || '').split(',').filter(Boolean).map(t => t.trim()))
        )].sort();
        const filterBar = allTags.length ? `
            <div class="fude-story-filter-bar">
                <button class="fude-story-filter-chip active" data-tag="*" onclick="app.fudeFilterStories('*')">All</button>
                ${allTags.map(t => `<button class="fude-story-filter-chip" data-tag="${t.replace(/"/g,'&quot;').replace(/'/g,'&#39;')}" onclick="app.fudeFilterStories('${UI.escJsAttr(t)}')">#${esc(t)}</button>`).join('')}
            </div>` : '';
        const cards = successStories.map((s, idx) => {
            const imgEl = s._signedUrl
                ? `<img loading="lazy" decoding="async" class="fude-story-card-img" ${imgSrc(s)} alt="" onerror="this.style.display='none';this.nextElementSibling.style.display='flex'">`
                : '';
            const ph = `<div class="fude-story-card-img-ph" style="display:${s._signedUrl ? 'none' : 'flex'};">📖</div>`;
            const tagArr = (s.tags || '').split(',').filter(Boolean).map(t => t.trim());
            const tagSpans = tagArr.slice(0, 2).map(t => `<span class="fude-story-tag">#${esc(t)}</span>`).join('');
            const tagData = tagArr.map(t => t.toLowerCase()).join('|');
            const isOverflow = idx >= PREVIEW;
            return `<div class="fude-story-card${isOverflow ? ' fude-story-card--hidden' : ''}" data-tags="${tagData}" data-overflow="${isOverflow ? '1' : '0'}" onclick="app.openStoryDetail(${s.id})" style="cursor:pointer;">
                ${imgEl}${ph}
                <div class="fude-story-card-body">
                    ${tagSpans ? `<div class="fude-story-card-tags">${tagSpans}</div>` : ''}
                    <h3>${esc(s.title)}</h3>
                    ${s.content ? `<p>${esc(s.content)}</p>` : '<p style="flex:1"></p>'}
                    <div class="fude-story-card-footer">
                        <div class="fude-story-card-meta">
                            <div class="fude-story-card-avatar">${esc((s.title || 'D')[0].toUpperCase())}</div>
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
                ${filterBar}
                <div class="fude-story-grid">${cards}</div>
                <div class="fude-story-search-bar">
                    <input type="text" class="fude-story-search-input" placeholder="🔍  Search stories…" oninput="app.fudeSearchStories(this.value)">
                </div>
                ${hasMore ? `<button class="fude-stories-more-btn" onclick="app.fudeShowAllStories()">✦ Explore More Success Stories</button>` : ''}
            </div>`;
};

// --- Tips row builder (pure; extracted from showFudeView) ---
const _buildFudeTips = (dynamicTips) => {
        const tipCols = [];
        if (dynamicTips.length) {
            tipCols.push(`<div class="fude-tip-col">
                <div class="fude-tip-icon">💡</div>
                <h3>${esc(dynamicTips[0].title)}</h3>
                ${dynamicTips[0].content ? `<p>${esc(dynamicTips[0].content)}</p>` : ''}
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
};

// ========== LEVEL 13/14: 福德 VIEW ==========
const showFudeView = async (container) => {
    const currentUser = _state.cu;
    if (!currentUser) return;

    // Show skeleton immediately — don't block first paint on data fetches
    if (container) container.innerHTML = '<div style="display:flex;align-items:center;justify-content:center;height:200px;gap:12px;color:var(--gray-400,#9ca3af);flex-direction:column;"><i class="fas fa-circle-notch fa-spin" style="font-size:24px;"></i><span style="font-size:13px;">Loading 福运相随…</span></div>';

    // Canonical numeric level via the shared role helper (no inline /Level N/ regex).
    const userLevel = _getUserLevel(currentUser);
    // Admin gate for fude management surfaces (leaderboard read + Manage Highlights/Stories
    // CRUD + Manage Rewards/福气 Points CRUD). Original gate was `userLevel <= 2`, i.e.
    // L1 Super Admin OR L2 Marketing Manager — reproduced EXACTLY via canonical helpers so
    // no new band (e.g. L3/L4 agents) silently gains access. Chose L1||L2 (not the broader
    // isManagement L4+) to stay faithful and err on the MORE restrictive side.
    const _canonAdmin = isSystemAdmin(currentUser) || isMarketingManager(currentUser);
    // (2026-06-19) The deprecated legacy email-allowlist fallback was removed: its three
    // emails (mianformula / destinyoracles / shilynateh7689) now hold canonical L1 in the DB,
    // so isSystemAdmin covers them and the allowlist is redundant. The fude admin gate is now
    // purely the canonical L1||L2 helpers — no email special-casing.
    const isAdmin   = _canonAdmin;
    const isL1314   = userLevel >= 13;
    const isCustomer = userLevel === 13;

    // --- Data loading — all fetches in parallel with timeouts ---
    const _t = (p, ms = 6000) => Promise.race([p, new Promise(r => setTimeout(() => r([]), ms))]);

    const [highlights, myRewards, myPurchases, allUsersRaw, allRewards] = await Promise.all([
        _t(isAdmin ? AppDataStore.getAll('news_highlights').catch(() => []) : AppDataStore.query('news_highlights', { is_active: true }).catch(() => [])),
        _t(AppDataStore.query('recommendation_rewards', { user_id: currentUser.id }).catch(() => [])),
        _t(isCustomer && currentUser.customer_id ? AppDataStore.query('purchases', { customer_id: currentUser.customer_id }).catch(() => []) : Promise.resolve([])),
        _t(isAdmin ? AppDataStore.getAll('users').catch(() => []) : Promise.resolve([])),
        _t(isAdmin ? AppDataStore.getAll('recommendation_rewards').catch(() => []) : Promise.resolve([]))
    ]);
    // Use the canonical level helper (not an inline /Level 13|14/ regex) so members
    // with Chinese-only role names (改命客户 → L13, 准传福大使 → L14) are included.
    const allUsersForReward = allUsersRaw.filter(u => { const l = _getUserLevel(u); return l === 13 || l === 14; });

    // --- Helpers ---
    const fmtDate = d => { try { return new Date(d).toLocaleDateString(); } catch(e) { return d || '-'; } };
    const fmtAmt  = v => { try { return 'RM ' + parseFloat(v || 0).toLocaleString('en-MY', { minimumFractionDigits: 2 }); } catch(e) { return v; } };
    const badge   = (txt, bg, col) => `<span style="padding:2px 8px;border-radius:12px;font-size:0.78rem;background:${bg};color:${col};">${txt}</span>`;

    // --- Content filters ---
    // Sort highlights/news by created_at desc so the newest one is slide 0
    const publicNews         = highlights.filter(h => h.type === 'highlight').sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
    const successStories     = highlights.filter(h => h.type === 'success_story').sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
    const recommendationTips = highlights.filter(h => h.type === 'recommendation_tip').sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

    // --- Pre-sign highlight images (parallel, with timeout) ---
    const withImg = [...publicNews, ...successStories].filter(h => h.image_url);
    if (withImg.length && AppDataStore.resolveAttachmentSrc) {
        await Promise.race([
            Promise.all(withImg.map(async h => {
                try { h._signedUrl = await AppDataStore.resolveAttachmentSrc(h.image_url); } catch(e) {}
            })),
            new Promise(r => setTimeout(r, 5000))
        ]);
    }

    // --- Totals & summary sync (fire-and-forget, don't block render) ---
    const totalPoints  = myRewards.reduce((s, r) => s + (parseInt(r.fudi_points)    || 0), 0);
    const totalReturns = myRewards.reduce((s, r) => s + (parseFloat(r.sharing_return) || 0), 0);
    // Only sync when the totals actually changed since the last render — this fires on
    // every fude-view render, so an unguarded write hammered the DB with identical data
    // (and could clobber a concurrent admin edit to the summary) on each repaint.
    if (myRewards.length > 0) {
        const _fudiSig = `${currentUser.id}:${totalPoints}:${totalReturns}`;
        if (window._fudiSummarySig !== _fudiSig) {
            window._fudiSummarySig = _fudiSig;
            syncFudiSummary(currentUser.id, totalPoints, totalReturns).catch(e => console.warn('[fude] syncFudiSummary failed:', e?.message || e));
        }
    }

    // --- Helper: pre-signed image src attr (escaped for the attribute context) ---
    const imgSrc = (h) => h._signedUrl ? `src="${esc(h._signedUrl)}"` : '';

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
        // Shared compute (also used by Export KPI Dashboard) — keep one source of truth.
        const ranked = _computeFudeLeaderboard(allRewards, allUsersForReward);
        if (!ranked.length) return '';
        const medals = ['🥇','🥈','🥉'];
        return `<div class="fude-section">
            <div class="fude-sec-bar"><div class="fude-sec-bar-icon news">🏆</div><h2>福气 Leaderboard</h2></div>
            <div class="fude-sec-body"><div style="overflow-x:auto;"><table class="data-table"><thead><tr>
                <th scope="col">#</th><th scope="col">Name</th><th scope="col">福气 Points</th><th scope="col">Sharing Returns (RM)</th>
            </tr></thead><tbody>
                ${ranked.map((r, i) => `<tr>
                    <td>${medals[i] || (i + 1)}</td>
                    <td style="font-weight:600;">${esc(r.name)}</td>
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
                    <td style="max-width:240px;overflow:hidden;text-overflow:ellipsis;">${esc(h.title)}</td>
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
                <div style="display:flex;gap:8px;flex-wrap:wrap;">
                    <button class="btn secondary btn-sm" onclick="app.showRedemptionQueue()"><i class="fas fa-inbox"></i> 兑换队列 Redemption Queue</button>
                    <button class="btn primary btn-sm" onclick="app.openRewardModal()"><i class="fas fa-plus"></i> Award Points</button>
                </div>
            </div>
            <div class="fude-sec-body"><div style="overflow-x:auto;"><table class="data-table"><thead><tr>
                <th scope="col">User</th><th scope="col">Action</th><th scope="col">福气 Pts</th><th scope="col">Sharing Return</th><th scope="col">Description</th><th scope="col">Date</th><th scope="col"></th>
            </tr></thead><tbody>
                ${allRewards.length ? allRewards.map(r => {
                    const u = allUsersForReward.find(u => u.id === r.user_id);
                    return `<tr>
                        <td style="font-weight:600;">${u ? esc(u.full_name) : 'User ' + r.user_id}</td>
                        <td>${badge(r.action_type || '-', '#e0e7ff', '#3730a3')}</td>
                        <td>${r.fudi_points || 0}</td>
                        <td>${parseFloat(r.sharing_return || 0).toFixed(2)}</td>
                        <td style="max-width:180px;overflow:hidden;text-overflow:ellipsis;">${esc(r.description || '-')}</td>
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
                <td>${esc(p.item || '-')}</td>
                <td>${fmtAmt(p.amount || p.total_amount)}</td>
                <td>${badge(p.status || 'pending', p.status === 'completed' ? '#d1fae5' : '#fef3c7', p.status === 'completed' ? '#065f46' : '#92400e')}</td>
                <td>${fmtDate(p.date || p.purchase_date || p.created_at)}</td>
              </tr>`).join('')
            : '<tr><td colspan="4" style="text-align:center;color:var(--gray-400);">No purchases found.</td></tr>';
        purchasesSection = `<div class="fude-section">
            <div class="fude-sec-bar"><div class="fude-sec-bar-icon story">🛍️</div><h2>My Purchase History</h2></div>
            <div class="fude-sec-body"><div style="overflow-x:auto;"><table class="data-table"><thead><tr>
                <th scope="col">Product / Package</th><th scope="col">Amount</th><th scope="col">Status</th><th scope="col">Date</th>
            </tr></thead><tbody>${rows}</tbody></table></div></div></div>`;
    }

    // --- News carousel HTML ---
    const carouselSection = _buildFudeCarousel(publicNews, imgSrc, fmtDate);

    // --- Success Stories grid ---
    const storiesSection = _buildFudeStories(successStories, imgSrc, fmtDate);

    // --- Tips row (dynamic + 2 static) ---
    const dynamicTips = recommendationTips.slice(0, 1);
    const tipsSection = _buildFudeTips(dynamicTips);

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
                <td style="max-width:180px;overflow:hidden;text-overflow:ellipsis;">${esc(r.description || '-')}</td>
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
    _rxRenderFude(container, `
        <div class="fude-tab">
            <div class="fude-inner">
                ${summaryBanner}
                ${isL1314 && totalPoints > 0 ? `
                <div class="fude-points-banner">
                    <span class="fude-points-banner-text">🎉 当前累积 <strong>${totalPoints}</strong> 福气积分，可兑换精选奖励！</span>
                    <button class="fude-points-banner-cta" onclick="app.openFudeRedeemModal(${totalPoints})">立即兑换 →</button>
                </div>` : ''}
                ${leaderboardSection}
                ${adminHighlightsSection}
                ${adminRewardsSection}
            </div>
            ${carouselSection}
            ${storiesSection}
            ${purchasesSection}
        </div>
    `);

    // Wire carousel dot clicks. NOTE: the .fude-carousel-dots row is rendered as a
    // SIBLING of .fude-carousel-wrap (both inside .fude-section), so the dot is NOT
    // inside the wrap — dot.closest('.fude-carousel-wrap') was null and the click
    // threw, leaving the dots dead. Locate the track via the common .fude-section
    // ancestor instead (zero layout change).
    container.querySelectorAll('.fude-carousel-dot').forEach((dot, i) => {
        dot.addEventListener('click', () => {
            const scope = dot.closest('.fude-section') || dot.closest('.fude-carousel-wrap')?.parentElement;
            const track = scope ? scope.querySelector('.fude-carousel-track') : null;
            if (!track) return;
            track.dataset.idx = i;
            track.style.transform = `translateX(-${i * 100}%)`;
            const dotsRow = dot.closest('.fude-carousel-dots');
            if (dotsRow) dotsRow.querySelectorAll('.fude-carousel-dot').forEach((d, j) => d.classList.toggle('active', j === i));
        });
    });
};

// ========== Story / Highlight detail viewer (everyone) ==========
const openStoryDetail = async (highlightId) => {
    try {
        const h = await AppDataStore.getById('news_highlights', highlightId);
        if (!h) { UI.toast.error('Story not found'); return; }
        let imgSrc = null;
        try { imgSrc = h.image_url ? await AppDataStore.resolveAttachmentSrc(h.image_url) : null; } catch (_) {}
        const fmtDate = d => { try { return new Date(d).toLocaleDateString(); } catch (e) { return d || ''; } };
        const tags = (h.tags || '').split(',').filter(Boolean)
            .map(t => `<span style="display:inline-block;background:var(--primary-50,#fef3c7);color:var(--primary-700,#92400e);border:1px solid var(--primary-200,#fde68a);border-radius:10px;padding:2px 8px;margin:2px 4px 2px 0;font-size:11px;">${esc(t.trim())}</span>`).join('');
        const content = `
            <div style="max-height:75vh;overflow-y:auto;padding-right:4px;">
                ${imgSrc ? `<div style="margin:-4px -4px 16px;"><img loading="lazy" decoding="async" src="${esc(imgSrc)}" style="width:100%;max-height:320px;object-fit:cover;border-radius:8px;display:block;"></div>` : ''}
                ${tags ? `<div style="margin-bottom:8px;">${tags}</div>` : ''}
                <h2 style="margin:0 0 8px;font-size:1.4rem;">${esc(h.title || '')}</h2>
                <div style="font-size:12px;color:var(--gray-500,#6b7280);margin-bottom:14px;">📅 ${fmtDate(h.created_at)}</div>
                <div style="font-size:14px;line-height:1.7;color:var(--gray-700,#374151);white-space:pre-wrap;">${h.content ? esc(h.content) : '<em>No content.</em>'}</div>
            </div>`;
        _rxShowModal(h.title || 'Story', content, [
            { label: 'Close', type: 'secondary', action: 'UI.hideModal()' }
        ]);
    } catch (err) {
        UI.toast.error('Failed to open story: ' + (err.message || 'Unknown error'));
    }
};

// ========== LEVEL 13/14: Highlight CRUD (Admin only) ==========
const openHighlightModal = async (highlightId = null) => {
    const h = highlightId ? await AppDataStore.getById('news_highlights', highlightId) : null;
    const isEdit = !!h;

    const content = `
        <div class="form-section">
            <input type="hidden" id="edit-highlight-id" value="${highlightId || ''}">
            <div class="form-group">
                <label>Title <span class="required">*</span></label>
                <input type="text" id="highlight-title" class="form-control" value="${esc(h?.title || '')}" placeholder="Enter title">
            </div>
            <div class="form-group">
                <label>Content</label>
                <textarea id="highlight-content" class="form-control" rows="4" placeholder="Enter content...">${esc(h?.content || '')}</textarea>
            </div>
            <div class="form-group">
                <label>Tags <span style="font-weight:400;color:var(--gray-500,#6b7280);font-size:12px;">(comma-separated, e.g. 风水,卧室,案例)</span></label>
                <input type="text" id="highlight-tags" class="form-control" value="${esc(h?.tags || '')}" placeholder="逆转胜, 卧室, 风水">
            </div>
            <div class="form-group">
                <label>Photo</label>
                <div style="display:flex;flex-direction:column;gap:8px;">
                    <label style="display:inline-flex;align-items:center;gap:8px;cursor:pointer;background:var(--gray-100,#f3f4f6);border:1px dashed var(--gray-300,#d1d5db);border-radius:8px;padding:10px 14px;font-size:14px;color:var(--gray-600,#4b5563);">
                        <i class="fas fa-upload"></i> Upload image file
                        <input type="file" id="highlight-image-file" accept="image/*" style="display:none;" onchange="
                            const file = this.files[0];
                            if (file) {
                                const reader = new FileReader();
                                reader.onload = e => {
                                    const prev = document.getElementById('highlight-image-preview');
                                    if (prev) { prev.src = e.target.result; prev.style.display='block'; }
                                    document.getElementById('highlight-image-url').value = '';
                                    document.getElementById('highlight-url-preview').style.display='none';
                                };
                                reader.readAsDataURL(file);
                            }
                        ">
                    </label>
                    <img loading="lazy" decoding="async" id="highlight-image-preview" style="width:100%;max-height:140px;object-fit:cover;border-radius:8px;display:none;" onerror="this.style.display='none'">
                    <div style="display:flex;align-items:center;gap:8px;color:var(--gray-400,#9ca3af);font-size:13px;"><span style="flex:1;height:1px;background:currentColor;opacity:.4;"></span>or paste a URL<span style="flex:1;height:1px;background:currentColor;opacity:.4;"></span></div>
                    <input type="url" id="highlight-image-url" class="form-control" value="${esc(h?.image_url || '')}" placeholder="https://example.com/photo.jpg" oninput="
                        const prev = document.getElementById('highlight-url-preview');
                        if (this.value) { prev.src = this.value; prev.style.display='block'; document.getElementById('highlight-image-file').value=''; document.getElementById('highlight-image-preview').style.display='none'; }
                        else { prev.style.display='none'; }
                    ">
                    <img loading="lazy" decoding="async" id="highlight-url-preview" src="${esc(h?.image_url || '')}" style="width:100%;max-height:140px;object-fit:cover;border-radius:8px;${h?.image_url ? '' : 'display:none;'}" onerror="this.style.display='none'">
                </div>
            </div>
            <div class="form-group">
                <label>Type</label>
                <select id="highlight-type" class="form-control">
                    <option value="highlight" ${(!h || h.type === 'highlight') ? 'selected' : ''}>Highlight / News</option>
                    <option value="success_story" ${h?.type === 'success_story' ? 'selected' : ''}>Success Story</option>
                    <option value="recommendation_tip" ${h?.type === 'recommendation_tip' ? 'selected' : ''}>Recommendation Tip</option>
                </select>
            </div>
            <div class="form-group">
                <label style="display:flex; align-items:center; gap:8px; cursor:pointer;">
                    <input type="checkbox" id="highlight-active" ${!h || h.is_active ? 'checked' : ''}>
                    Show publicly (active)
                </label>
            </div>
        </div>
    `;

    _rxShowModal(isEdit ? 'Edit Highlight' : 'Add New Highlight', content, [
        { label: 'Cancel', type: 'secondary', action: 'UI.hideModal()' },
        { label: isEdit ? 'Save Changes' : 'Add Highlight', type: 'primary', action: '(async () => { await app.saveHighlight(); })()' }
    ]);
};

const saveHighlight = async () => {
    const id    = document.getElementById('edit-highlight-id')?.value;
    const title = document.getElementById('highlight-title')?.value?.trim();
    if (!title) { UI.toast.error('Title is required.'); return; }

    // Resolve image URL: uploaded file takes priority over pasted URL
    let imageUrl = document.getElementById('highlight-image-url')?.value?.trim() || null;
    const fileInput = document.getElementById('highlight-image-file');
    const file = fileInput?.files?.[0];
    if (file) {
        const sb = window.supabase || window.supabaseClient;
        if (!sb || !sb.storage) {
            UI.toast.error('Supabase not connected — cannot upload image');
            return;
        }
        if (file.size > 5 * 1024 * 1024) { UI.toast.error('Image too large (max 5MB)'); return; }
        const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
        const path = `highlights/${Date.now()}_${safeName}`;
        const { error: upErr } = await sb.storage.from('attachments').upload(path, file, { upsert: false, contentType: file.type });
        if (upErr) { UI.toast.error('Upload failed: ' + upErr.message); return; }
        imageUrl = path; // store path; signed URL resolved at render time
    }

    const payload = {
        title,
        content:   document.getElementById('highlight-content')?.value || '',
        tags:      document.getElementById('highlight-tags')?.value?.trim() || '',
        image_url: imageUrl,
        type:      document.getElementById('highlight-type')?.value || 'highlight',
        is_active: document.getElementById('highlight-active')?.checked ?? true
        // author_id is set only on CREATE (below) so editing never reassigns the
        // original author to whoever made the edit.
    };

    try {
        const isNew = !id;
        if (id) {
            await AppDataStore.update('news_highlights', parseInt(id), payload);
            UI.toast.success('Highlight updated.');
        } else {
            await AppDataStore.create('news_highlights', { ...payload, author_id: _state.cu?.id || null, created_at: new Date().toISOString() });
            UI.toast.success('Highlight added.');
        }
        // Push notification fan-out (non-blocking, best-effort)
        _notifyHighlightSaved(payload, isNew).catch(() => {});
        UI.hideModal();
        const viewport = document.getElementById('content-viewport');
        if (viewport) await showFudeView(viewport);
    } catch(err) {
        UI.toast.error('Save failed: ' + (err.message || 'Unknown error'));
    }
};

const deleteHighlight = async (highlightId) => {
    UI.showModal('Delete Highlight', '<p>Are you sure you want to delete this highlight? This cannot be undone.</p>', [
        { label: 'Cancel', type: 'secondary', action: 'UI.hideModal()' },
        { label: 'Delete', type: 'danger', action: `(async () => { await app.confirmDeleteHighlight(${highlightId}); })()` }
    ]);
};

const confirmDeleteHighlight = async (highlightId) => {
    try {
        await AppDataStore.delete('news_highlights', highlightId);
        UI.hideModal();
        UI.toast.success('Highlight deleted.');
        const viewport = document.getElementById('content-viewport');
        if (viewport) await showFudeView(viewport);
    } catch(err) {
        UI.toast.error('Delete failed: ' + (err.message || 'Unknown error'));
    }
};

// ========== LEVEL 13/14: Reward CRUD + 福气 Summary Sync ==========

const syncFudiSummary = async (userId, totalPoints, totalReturns) => {
    try {
        const payload  = { total_fudi_points: totalPoints, total_sharing_return: totalReturns, updated_at: new Date().toISOString() };
        // L691 — read-then-insert race: two concurrent calls for the same user
        // could both see existing.length===0 and both create, producing duplicate
        // rows. Prefer an atomic upsert keyed on user_id via the raw Supabase
        // client (no observed UNIQUE(user_id) constraint yet — that DDL is tracked
        // in cross_file_needs; once present this upsert is fully race-safe).
        const sb = window.supabase || window.supabaseClient;
        if (sb && typeof sb.from === 'function') {
            const { error } = await sb.from('user_fudi_summary')
                .upsert({ user_id: userId, ...payload }, { onConflict: 'user_id' });
            if (error) throw error;
            return;
        }
        // Fallback (offline / client unavailable): keep the original read-then-write.
        const existing = await AppDataStore.query('user_fudi_summary', { user_id: userId });
        if (existing.length > 0) {
            // #3 — must pass the row's primary key (id), not user_id; update() filters by id column
            await AppDataStore.update('user_fudi_summary', existing[0].id, payload);
        } else {
            await AppDataStore.create('user_fudi_summary', { user_id: userId, ...payload });
        }
    } catch(e) { console.warn('syncFudiSummary error:', e); }
};

const openRewardModal = async (rewardId = null) => {
    const r = rewardId ? await AppDataStore.getById('recommendation_rewards', rewardId) : null;
    const isEdit = !!r;

    let eligibleUsers = [];
    try { eligibleUsers = (await AppDataStore.getAll('users')).filter(u => { const l = _getUserLevel(u); return l === 13 || l === 14; }); } catch(e) {}
    const userOptions = eligibleUsers.map(u =>
        `<option value="${u.id}" ${r?.user_id === u.id ? 'selected' : ''}>${esc(u.full_name)} (${esc(u.role)})</option>`
    ).join('');

    const content = `
        <div class="form-section">
            <input type="hidden" id="edit-reward-id" value="${rewardId || ''}">
            <div class="form-group">
                <label>Recipient <span class="required">*</span></label>
                <select id="reward-user" class="form-control">
                    <option value="">— Select user —</option>
                    ${userOptions}
                </select>
            </div>
            <div class="form-group">
                <label>Action Type <span class="required">*</span></label>
                <select id="reward-action" class="form-control">
                    <option value="recommendation"   ${(!r || r.action_type === 'recommendation')   ? 'selected' : ''}>Recommendation</option>
                    <option value="sharing"          ${r?.action_type === 'sharing'          ? 'selected' : ''}>Sharing</option>
                    <option value="class_attendance" ${r?.action_type === 'class_attendance' ? 'selected' : ''}>Class Attendance</option>
                </select>
            </div>
            <div class="form-group">
                <label>福气 Points</label>
                <input type="number" id="reward-points" class="form-control" value="${r?.fudi_points || 0}" min="0">
            </div>
            <div class="form-group">
                <label>Sharing Return (RM)</label>
                <input type="number" id="reward-return" class="form-control" value="${parseFloat(r?.sharing_return || 0).toFixed(2)}" min="0" step="0.01">
            </div>
            <div class="form-group">
                <label>Description</label>
                <input type="text" id="reward-desc" class="form-control" value="${esc(r?.description || '')}" placeholder="e.g. Referred Tan Ah Kow to CPS session">
            </div>
        </div>
    `;

    _rxShowModal(isEdit ? 'Edit Reward' : 'Award 福气 Points', content, [
        { label: 'Cancel', type: 'secondary', action: 'UI.hideModal()' },
        { label: isEdit ? 'Save Changes' : 'Award', type: 'primary', action: '(async () => { await app.saveReward(); })()' }
    ]);
};

const saveReward = async () => {
    const id     = document.getElementById('edit-reward-id')?.value;
    const userId = parseInt(document.getElementById('reward-user')?.value);
    if (!userId) { UI.toast.error('Please select a recipient.'); return; }

    const payload = {
        user_id:        userId,
        action_type:    document.getElementById('reward-action')?.value || 'recommendation',
        fudi_points:    parseInt(document.getElementById('reward-points')?.value) || 0,
        sharing_return: parseFloat(document.getElementById('reward-return')?.value) || 0,
        description:    document.getElementById('reward-desc')?.value || ''
    };

    try {
        if (id) {
            await AppDataStore.update('recommendation_rewards', parseInt(id), payload);
            UI.toast.success('Reward updated.');
        } else {
            await AppDataStore.create('recommendation_rewards', { ...payload, created_at: new Date().toISOString() });
            UI.toast.success('Reward awarded!');
        }
        // Recalculate and sync summary for the recipient
        const allRewards = await AppDataStore.query('recommendation_rewards', { user_id: userId });
        await syncFudiSummary(
            userId,
            allRewards.reduce((s, r) => s + (parseInt(r.fudi_points)    || 0), 0),
            allRewards.reduce((s, r) => s + (parseFloat(r.sharing_return) || 0), 0)
        );
        UI.hideModal();
        const viewport = document.getElementById('content-viewport');
        if (viewport) await showFudeView(viewport);
    } catch(err) {
        UI.toast.error('Save failed: ' + (err.message || 'Unknown error'));
    }
};

const deleteReward = async (rewardId) => {
    UI.showModal('Delete Reward', "<p>Remove this reward record? The user's 福气 points will be recalculated.</p>", [
        { label: 'Cancel', type: 'secondary', action: 'UI.hideModal()' },
        { label: 'Delete', type: 'danger', action: `(async () => { await app.confirmDeleteReward(${rewardId}); })()` }
    ]);
};

const confirmDeleteReward = async (rewardId) => {
    try {
        const r = await AppDataStore.getById('recommendation_rewards', rewardId);
        await AppDataStore.delete('recommendation_rewards', rewardId);
        if (r?.user_id) {
            const remaining = await AppDataStore.query('recommendation_rewards', { user_id: r.user_id });
            await syncFudiSummary(
                r.user_id,
                remaining.reduce((s, x) => s + (parseInt(x.fudi_points)    || 0), 0),
                remaining.reduce((s, x) => s + (parseFloat(x.sharing_return) || 0), 0)
            );
        }
        UI.hideModal();
        UI.toast.success('Reward deleted.');
        const viewport = document.getElementById('content-viewport');
        if (viewport) await showFudeView(viewport);
    } catch(err) {
        UI.toast.error('Delete failed: ' + (err.message || 'Unknown error'));
    }
};

// ==========================================================================
// STUB IMPLEMENTATIONS (replacing app.todo placeholders) — 2026-04-11
// ==========================================================================

// Stub 1: View Roadmap — was: onclick="app.todo('Feature development')"
// Shows a modal listing shipped features vs. the planned backlog so users
// on a placeholder view have context on what's coming.
const showRoadmap = () => {
    const content = `
        <div style="max-height:60vh; overflow-y:auto; padding:4px 2px; font-size:14px;">
            <div style="background:#fef3c7; border-left:4px solid #f59e0b; padding:12px; border-radius:4px; margin-bottom:16px;">
                <strong>📍 DestinOraclesSolution CRM</strong><br>
                Core modules are live. This list tracks what's shipped and what's planned.
            </div>
            <h3 style="margin-top:12px;">✅ Shipped</h3>
            <ul style="margin-left:16px;">
                <li>Prospects &amp; Customers pipeline</li>
                <li>Activity tracking (FSA, CPS, Site Visit, Events, Meetings, Training)</li>
                <li>Relationship Tree with fast-rendering synchronous DFS</li>
                <li>Referrals leaderboard, period filter, and rewards</li>
                <li>Events with check-in &amp; engagement scoring</li>
                <li>Document upload per prospect</li>
                <li>Recruitment approval workflow</li>
                <li>KPI dashboard with agent filter</li>
                <li>Marketing Automation (Monthly Promotions, Bujishu, Formula)</li>
                <li>Agent reassignment (single &amp; bulk)</li>
            </ul>
            <h3 style="margin-top:16px;">🚧 Planned</h3>
            <ul style="margin-left:16px;">
                <li>WhatsApp Business deep integration</li>
                <li>Mobile PWA + biometric auth</li>
                <li>Advanced analytics dashboards</li>
                <li>Multi-tenant support</li>
                <li>Automated compliance reports (GDPR / DSAR)</li>
                <li>Export Tree to PDF (CSV already ships)</li>
            </ul>
        </div>
    `;
    UI.showModal('Feature Roadmap', content, [
        { label: 'Close', type: 'secondary', action: 'UI.hideModal()' }
    ]);
};

// Stub 2: Export Tree — was: onclick="app.todo('Export Tree')"
// Walks the currently-loaded _state.ctd object (depth-first) and
// downloads a CSV with one row per node (parent link + key fields).
const exportRelationshipTree = () => {
    if (!_state.ctd) {
        UI.toast.error('No tree loaded — search for a person first.');
        return;
    }
    const rows = [];
    const walk = (node, parentName = '', depth = 0) => {
        rows.push({
            depth,
            parent: parentName,
            name: node.name || '',
            type: node.type || '',
            role: node.role || '',
            pipeline: node.pipeline_stage || '',
            last_activity: node.last_activity_date || '',
            join_date: node.join_date || ''
        });
        (node.children || []).forEach(c => walk(c, node.name, depth + 1));
    };
    walk(_state.ctd);
    const esc = v => {
        const s = String(v ?? '');
        return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
    };
    const header = 'Depth,Parent,Name,Type,Role,Pipeline Stage,Last Activity,Join Date\n';
    const body = rows.map(r => [r.depth, r.parent, r.name, r.type, r.role, r.pipeline, r.last_activity, r.join_date].map(esc).join(',')).join('\n');
    const csv = '\ufeff' + header + body; // BOM so Excel reads UTF-8 (Chinese names) correctly
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    const safeName = String(_state.ctd.name || 'export').replace(/[^\w\u4e00-\u9fff-]+/g, '_');
    a.download = `relationship-tree-${safeName}-${new Date().toISOString().split('T')[0]}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    UI.toast.success(`Exported ${rows.length} nodes to CSV`);
};

// Stub 3: Change leaderboard period — was: onchange="app.todo('Change period')"
// Stores the selected period in a module-level variable that renderLeaderboard
// reads to filter referrals by date before grouping.
const changeLeaderboardPeriod = async (label) => {
    const map = { 'All Time': 'all', 'This Year': 'year', 'This Month': 'month' };
    _state.lbp = map[label] || 'all';
    await renderLeaderboard();
};

// Stub 4: Customer-initiated referral workflow — was: onclick="app.todo('Referral workflow')"
// The openCustomerReferralModal function already existed at line ~15515;
// this stub was purely a wiring fix — the onclick now points at the real function.

// Stub 5: Upload document on prospect detail — was: onclick="app.todo('Upload document')"
// Opens a hidden file input, reads as base64, stores in `documents` table
// linked to the prospect via filename prefix.
const uploadProspectDocument = async (prospectId) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*,application/pdf,.doc,.docx,.txt';
    input.onchange = async (ev) => {
        const file = ev.target.files && ev.target.files[0];
        if (!file) return;
        const MAX_BYTES = 5 * 1024 * 1024; // 5 MB
        if (file.size > MAX_BYTES) {
            UI.toast.error('File too large — 5 MB max');
            return;
        }
        try {
            const dataUrl = await new Promise((resolve, reject) => {
                const reader = new FileReader();
                reader.onload = () => resolve(reader.result);
                reader.onerror = reject;
                reader.readAsDataURL(file);
            });
            await AppDataStore.create('documents', {
                filename: `prospect_${prospectId}/${file.name}`,
                size: file.size,
                mime_type: file.type || 'application/octet-stream',
                data: String(dataUrl || ''),
                current_version: 1,
                created_by: _state.cu?.id || null,
                description: `Uploaded for prospect #${prospectId}`,
                is_starred: false
            });
            UI.toast.success('Document uploaded');
            // Re-render the prospect detail so the new doc shows up
            if (typeof app.showProspectDetail === 'function') {
                await app.showProspectDetail(prospectId);
            }
        } catch (err) {
            UI.toast.error('Upload failed: ' + (err.message || 'Unknown error'));
        }
    };
    input.click();
};

// Stub 6: Submit recruitment approval — was: action="app.todo('Recruitment approval workflow submitted')"
// Captures recruitment form data and writes to approval_queue as pending.
// openRecruitModal (script-prospects.js) passes the customerId being recruited so the
// approval row carries a real customer_id link instead of relying on label-scraping.
const submitRecruitmentApproval = async (customerId = null) => {
    try {
        const cid = parseInt(customerId, 10);
        if (!Number.isFinite(cid)) { UI.toast.error('Missing customer — cannot submit recruitment.'); return; }
        // The modal body is the `.modal-content` element inside the global overlay
        // (UI.showModal, ui.js:222/245) — there is NO element with id="modal-content",
        // so the old getElementById() always fell through to `document` and scraped
        // every .form-control field on the underlying page into the snapshot.
        const modal = document.querySelector('#global-modal-overlay .modal-content') || document;
        const textareas = modal.querySelectorAll('textarea');
        const inputs = modal.querySelectorAll('input.form-control, select.form-control');
        const snapshot = {};
        inputs.forEach((el, i) => {
            const label = el.closest('.form-group')?.querySelector('label')?.textContent?.trim() || `field_${i}`;
            snapshot[label] = el.value;
        });
        textareas.forEach((el, i) => {
            const label = el.closest('.form-group')?.querySelector('label')?.textContent?.trim() || `textarea_${i}`;
            snapshot[label] = el.value;
        });
        await AppDataStore.create('approval_queue', {
            approval_type: 'recruitment',
            status: 'pending',
            customer_id: cid, // real linkage to the customer being recruited (was unlinked)
            submitted_by: _state.cu?.id || null,
            submitted_at: new Date().toISOString(),
            description: 'Recruitment: Convert customer to agent',
            snapshot_after: snapshot,
            created_at: new Date().toISOString()
        });
        UI.hideModal();
        UI.toast.success('Recruitment submitted for approval');
    } catch (err) {
        UI.toast.error('Submit failed: ' + (err.message || 'Unknown error'));
    }
};

// [CHUNK: egg] Section extracted to chunks/script-egg.js — loaded role-gated by navigateTo().

// [CHUNK: boss_report] Section extracted to chunks/script-boss-report.js — loaded role-gated by navigateTo().

// [CHUNK: formula] 32 functions extracted to chunks/script-formula.js — loaded role-gated by navigateTo().

// [CHUNK: stock_take] Section extracted to chunks/script-stock-take.js — loaded role-gated by navigateTo().

// ==================== BUG AUDIT 2026-04-24: fill 3 missing function impls ====================
// Single-file delete — mirrors confirmDeleteSelected pattern (line ~3103)
const deleteFile = async (fileId) => {
    if (!fileId) return;
    UI.showModal('Delete File',
        `<p>Are you sure you want to delete this file?</p><p class="text-error">This action cannot be undone.</p>`,
        [
            { label: 'Cancel', type: 'secondary', action: 'UI.hideModal()' },
            { label: 'Delete', type: 'primary', action: `(async () => { await app._confirmDeleteFile(${fileId}); })()` }
        ]
    );
};
const _confirmDeleteFile = async (fileId) => {
    await AppDataStore.delete('documents', fileId);
    UI.hideModal();
    UI.toast.success('File deleted');
    if (typeof window.app.loadFolderContents === 'function') await window.app.loadFolderContents();
};

// Route Last-Transactions modal profile-link to the right detail view
const showProfile = async (id, type) => {
    if (!id) return;
    if (type === 'prospect' && window.app.showProspectDetail) return window.app.showProspectDetail(id);
    if (window.app.showCustomerDetail) return window.app.showCustomerDetail(id);
};

// Export KPI Dashboard — downloads the same 福气 Leaderboard the admin dashboard
// renders (showFudeView's leaderboardSection) as a spreadsheet. Reuses the SHARED
// compute path (_computeFudeLeaderboard over recommendation_rewards × L13/14 users)
// so the file matches the on-screen table exactly. Gated to the same admins that
// can see the KPI dashboard (L1 Super Admin || L2 Marketing Manager). Offers XLSX
// when the lazy SheetJS helper is present, otherwise falls back to CSV. Output is
// CSV-injection-safe (leading =,+,-,@ in a cell is prefixed with a single quote)
// and Excel-friendly (UTF-8 BOM so Chinese names render).
const exportKPIDashboard = async () => {
    const currentUser = _state.cu || _state.cu;
    // Same role gate as the dashboard's leaderboard surface.
    const _canonAdmin = isSystemAdmin(currentUser) || isMarketingManager(currentUser);
    if (!_canonAdmin) { UI.toast.error('You do not have permission to export the KPI dashboard.'); return; }

    try {
        // Reuse the dashboard's data prep: pull all reward rows + the L13/14 user
        // pool, then run the shared reducer. No duplicated grouping logic.
        const [allRewards, allUsersRaw] = await Promise.all([
            AppDataStore.getAll('recommendation_rewards').catch(() => []),
            AppDataStore.getAll('users').catch(() => [])
        ]);
        const allUsersForReward = (allUsersRaw || []).filter(u => { const l = _getUserLevel(u); return l === 13 || l === 14; });
        const ranked = _computeFudeLeaderboard(allRewards, allUsersForReward);

        if (!ranked.length) { UI.toast.error('No 福气 leaderboard data to export yet.'); return; }

        // --- CSV cell encoder: injection-safe + RFC-4180 quoting ---
        // De-duped: reuse the canonical encoder (script.js _crmUtils.csvCell).
        const csvCell = window._crmUtils.csvCell;

        const generatedOn = new Date();
        const totalPts = ranked.reduce((s, r) => s + (r.pts || 0), 0);
        const totalRet = ranked.reduce((s, r) => s + (r.ret || 0), 0);

        const headerCols = ['Rank', 'Name', '福气 Points', 'Sharing Returns (RM)'];
        // Row tuples (raw values) — reused for both CSV and XLSX builders.
        const dataRows = ranked.map((r, i) => [i + 1, r.name, r.pts, Number((r.ret || 0).toFixed(2))]);
        const totalRow = ['', 'TOTAL', totalPts, Number(totalRet.toFixed(2))];

        const stamp = generatedOn.toISOString().split('T')[0];
        const baseName = `kpi-fude-leaderboard-${stamp}`;

        // --- XLSX when SheetJS is available; otherwise CSV ---
        let xlsxReady = false;
        try {
            if (typeof window._ensureXlsx === 'function') { await window._ensureXlsx(); }
            xlsxReady = (typeof XLSX !== 'undefined' && XLSX && XLSX.utils);
        } catch (_) { xlsxReady = false; }

        if (xlsxReady) {
            const aoa = [
                ['福气 KPI Dashboard Export'],
                ['Generated', generatedOn.toLocaleString()],
                [],
                headerCols,
                ...dataRows,
                totalRow
            ];
            const ws = XLSX.utils.aoa_to_sheet(aoa);
            const wb = XLSX.utils.book_new();
            XLSX.utils.book_append_sheet(wb, ws, 'Leaderboard');
            XLSX.writeFile(wb, `${baseName}.xlsx`);
            UI.toast.success(`Exported KPI dashboard — ${ranked.length} agents (XLSX).`);
            return;
        }

        // CSV path: title + generated-on timestamp rows, header row, data, total.
        const lines = [];
        lines.push(csvCell('福气 KPI Dashboard Export'));
        lines.push([csvCell('Generated'), csvCell(generatedOn.toLocaleString())].join(','));
        lines.push('');
        lines.push(headerCols.map(csvCell).join(','));
        dataRows.forEach(row => lines.push(row.map(csvCell).join(',')));
        lines.push(totalRow.map(csvCell).join(','));

        const csv = '﻿' + lines.join('\r\n'); // BOM so Excel reads UTF-8 (Chinese names) correctly
        const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${baseName}.csv`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        UI.toast.success(`Exported KPI dashboard — ${ranked.length} agents (CSV).`);
    } catch (err) {
        UI.toast.error('Export failed: ' + (err && err.message ? err.message : 'Unknown error'));
    }
};

// [CHUNK: knowledge] Section extracted to chunks/script-knowledge.js — loaded role-gated by navigateTo().

// =========================================================================
// CUSTOMER FORMS — Survey + CPS + APU (Marketing > Forms sub-tab)
// 3 official Destin Oracles forms with bilingual labels, bagua grids,
// canvas signatures, mobile-responsive, print-friendly.
// =========================================================================

// ── Signature pad: bare HTML5 canvas, no external lib (~120 lines covers it)
const _bindSignaturePad = (canvasId) => {
    const c = document.getElementById(canvasId);
    if (!c) return;
    // Make the backing buffer match displayed size × DPR so strokes stay crisp on mobile.
    const dpr = window.devicePixelRatio || 1;
    const rect = c.getBoundingClientRect();
    c.width = rect.width * dpr;
    c.height = rect.height * dpr;
    const ctx = c.getContext('2d');
    ctx.scale(dpr, dpr);
    ctx.lineWidth = 2.2;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = '#0f172a';
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, c.width, c.height);

    let drawing = false, last = null, hasInk = false;
    const getXY = (e) => {
        const r = c.getBoundingClientRect();
        if (e.touches && e.touches[0]) {
            return { x: e.touches[0].clientX - r.left, y: e.touches[0].clientY - r.top };
        }
        return { x: e.clientX - r.left, y: e.clientY - r.top };
    };
    const start = (e) => {
        e.preventDefault();
        drawing = true;
        last = getXY(e);
    };
    const move = (e) => {
        if (!drawing) return;
        e.preventDefault();
        const p = getXY(e);
        ctx.beginPath();
        ctx.moveTo(last.x, last.y);
        ctx.lineTo(p.x, p.y);
        ctx.stroke();
        last = p;
        hasInk = true;
    };
    const end = () => { drawing = false; last = null; };

    c.addEventListener('mousedown', start);
    c.addEventListener('mousemove', move);
    c.addEventListener('mouseup', end);
    c.addEventListener('mouseleave', end);
    c.addEventListener('touchstart', start, { passive: false });
    c.addEventListener('touchmove', move, { passive: false });
    c.addEventListener('touchend', end);

    c._hasInk = () => hasInk;
    c._reset = () => {
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, c.width, c.height);
        hasInk = false;
        // An explicit Clear must also discard the preserved saved signature, so a
        // subsequent save writes null (the user intentionally removed the signature).
        c._preloadSrc = null;
    };

    // If a saved signature was preloaded into c.dataset.preload, paint it AND keep
    // the original data URL so _getSignatureDataUrl can return it even before the
    // async decode completes (or if it fails). Without this, a save that races the
    // preload's onload would read hasInk===false and overwrite the stored signature
    // with null. Any new stroke (hasInk) or an explicit Clear overrides this.
    if (c.dataset.preload) {
        c._preloadSrc = c.dataset.preload;
        const img = new Image();
        img.onload = () => {
            ctx.drawImage(img, 0, 0, rect.width, rect.height);
            hasInk = true;
        };
        img.src = c.dataset.preload;
    } else {
        c._preloadSrc = null;
    }
};

const _clearSignaturePad = (canvasId) => {
    const c = document.getElementById(canvasId);
    if (c && c._reset) c._reset();
};
// Exposed as app.cfClearSignature for inline onclick handlers
const cfClearSignature = (canvasId) => _clearSignaturePad(canvasId);

const _getSignatureDataUrl = (canvasId) => {
    const c = document.getElementById(canvasId);
    if (!c) return null;
    // New ink drawn this session → export the live canvas.
    if (c._hasInk && c._hasInk()) return c.toDataURL('image/png');
    // No new ink, but a previously-saved signature was preloaded and not cleared:
    // return the original so a save that races the async preload (or a failed
    // decode) does NOT wipe the stored signature to null.
    if (c._preloadSrc) return c._preloadSrc;
    return null;
};

// ── Helpers ──────────────────────────────────────────────────────────────
const _cfFmtDate = (iso) => {
    if (!iso) return '';
    try { return new Date(iso).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }); }
    catch (_) { return iso; }
};
const _cfEscape = (s) => (s == null ? '' : String(s).replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c])));

// ── Forms TAB main view ──────────────────────────────────────────────────
let _cfState = { prospectId: null, prospectQuery: '' };
// Short-lived cache of the 5 form tables so that typing in the search box
// (cfSearchProspects re-renders the tab) filters client-side over data already
// in memory instead of firing 5 getAll round-trips + a full rebuild on every
// keystroke-pause. Filtering was ALWAYS client-side, so reusing fresh data is
// behaviour-preserving; the cache auto-expires after CF_CACHE_TTL_MS.
let _cfDataCache = null;
const CF_CACHE_TTL_MS = 15000;

const renderFormsTab = async () => {
    // Wrap each fetch with a short timeout so a missing migration (the 3 new
    // customer-form tables) doesn't hang the whole tab for 15+ seconds.
    const _quickFetch = (table, ms = 4000) => Promise.race([
        AppDataStore.getAll(table).catch(() => []),
        new Promise(resolve => setTimeout(() => resolve([]), ms))
    ]);
    let prospects, surveys, cps, apus, blueprints;
    if (_cfDataCache && (Date.now() - _cfDataCache.ts) < CF_CACHE_TTL_MS) {
        ({ prospects, surveys, cps, apus, blueprints } = _cfDataCache);
    } else {
        [prospects, surveys, cps, apus, blueprints] = await Promise.all([
            _quickFetch('prospects', 6000),
            _quickFetch('customer_surveys'),
            _quickFetch('cps_analyses'),
            _quickFetch('apu_appraisals'),
            _quickFetch('destiny_blueprints')
        ]);
        _cfDataCache = { prospects, surveys, cps, apus, blueprints, ts: Date.now() };
    }

    // Build per-prospect status map
    const byProspect = new Map();
    prospects.forEach(p => byProspect.set(p.id, {
        id: p.id,
        name: p.full_name || p.nickname || '(no name)',
        phone: p.phone || '',
        survey: null, cps: null, apu: null, blueprint: null
    }));
    surveys.forEach(s => { const e = byProspect.get(s.prospect_id); if (e) e.survey = s; });
    cps.forEach(c => { const e = byProspect.get(c.prospect_id); if (e) e.cps = c; });
    apus.forEach(a => { const e = byProspect.get(a.prospect_id); if (e) e.apu = a; });
    blueprints.forEach(b => { const e = byProspect.get(b.prospect_id); if (e) e.blueprint = b; });

    const q = (_cfState.prospectQuery || '').toLowerCase();
    const filtered = Array.from(byProspect.values())
        .filter(p => !q || p.name.toLowerCase().includes(q) || (p.phone || '').includes(q))
        .sort((a, b) => {
            // Show prospects with any form filled in first, then by name
            const ax = (a.survey || a.cps || a.apu || a.blueprint) ? 0 : 1;
            const bx = (b.survey || b.cps || b.apu || b.blueprint) ? 0 : 1;
            return ax - bx || a.name.localeCompare(b.name);
        })
        .slice(0, 200);

    const badge = (val, label, color) => val
        ? `<span class="cf-badge cf-badge-done" title="${_cfEscape(label)} · ${_cfFmtDate(val.created_at)}"><i class="fas fa-check"></i> ${label}</span>`
        : `<span class="cf-badge cf-badge-pending">${label}</span>`;

    return `
        <style>
            .cf-wrap{ max-width:1100px; margin:0 auto; padding:8px 4px; }
            .cf-header{ display:flex; flex-wrap:wrap; gap:12px; justify-content:space-between; align-items:center; margin-bottom:18px; }
            .cf-header h2{ margin:0 0 4px; font-size:20px; }
            .cf-header p{ margin:0; color:#6B7280; font-size:13px; }
            .cf-search{ flex:1; min-width:200px; max-width:340px; padding:9px 12px; border:1px solid #E5E7EB; border-radius:8px; font-size:14px; }
            .cf-flow{ display:flex; gap:10px; align-items:center; background:#F9FAFB; border:1px dashed #D1D5DB; border-radius:10px; padding:12px 16px; margin-bottom:18px; color:#374151; font-size:13px; flex-wrap:wrap; }
            .cf-flow .num{ display:inline-flex; width:22px; height:22px; border-radius:50%; background:#7C3AED; color:white; font-weight:700; font-size:12px; align-items:center; justify-content:center; }
            .cf-list{ display:grid; gap:10px; }
            .cf-row{ background:white; border:1px solid #E5E7EB; border-radius:10px; padding:14px 16px; display:flex; flex-wrap:wrap; gap:12px; align-items:center; }
            .cf-name{ font-weight:600; font-size:15px; color:#111827; flex:1; min-width:160px; }
            .cf-name .sub{ display:block; color:#6B7280; font-weight:400; font-size:12px; margin-top:2px; }
            .cf-badges{ display:flex; gap:6px; flex-wrap:wrap; }
            .cf-badge{ font-size:11px; font-weight:600; padding:3px 9px; border-radius:999px; white-space:nowrap; }
            .cf-badge-done{ background:#D1FAE5; color:#065F46; }
            .cf-badge-pending{ background:#F3F4F6; color:#9CA3AF; }
            .cf-actions{ display:flex; gap:6px; flex-wrap:wrap; }
            .cf-btn{ padding:7px 12px; border-radius:7px; border:1px solid #E5E7EB; background:white; cursor:pointer; font-size:12px; font-weight:600; color:#374151; display:inline-flex; align-items:center; gap:5px; }
            .cf-btn:hover{ background:#F9FAFB; }
            .cf-btn.cf-btn-survey{ background:#EEF2FF; color:#4338CA; border-color:#C7D2FE; }
            .cf-btn.cf-btn-cps{ background:#FEF3C7; color:#92400E; border-color:#FCD34D; }
            .cf-btn.cf-btn-apu{ background:#FCE7F3; color:#9D174D; border-color:#F9A8D4; }
            .cf-btn.cf-btn-blueprint{ background:#E0E7FF; color:#3730A3; border-color:#A5B4FC; }
            .cf-empty{ padding:40px; text-align:center; color:#9CA3AF; background:white; border:1px dashed #E5E7EB; border-radius:10px; }

            /* ── Form modal styling (shared by Survey/CPS/APU) ── */
            .cf-form{ display:flex; flex-direction:column; gap:14px; }
            .cf-form .cf-section-title{ font-weight:700; font-size:14px; color:#111827; border-bottom:2px solid #7C3AED; padding-bottom:6px; margin-top:8px; }
            .cf-form .cf-section-title .zh{ color:#7C3AED; margin-left:6px; }
            .cf-grid{ display:grid; grid-template-columns:repeat(2, minmax(0, 1fr)); gap:12px; }
            .cf-grid-3{ display:grid; grid-template-columns:repeat(3, minmax(0, 1fr)); gap:10px; }
            @media (max-width: 640px){ .cf-grid, .cf-grid-3{ grid-template-columns:1fr; } }
            .cf-field label{ display:block; font-size:12px; font-weight:600; color:#374151; margin-bottom:4px; }
            .cf-field label .zh{ color:#7C3AED; font-weight:500; margin-left:4px; }
            .cf-field input, .cf-field select, .cf-field textarea{
                width:100%; padding:8px 10px; border:1px solid #D1D5DB; border-radius:6px; font-size:14px; font-family:inherit;
            }
            .cf-field textarea{ resize:vertical; min-height:64px; }
            .cf-radio-group{ display:flex; gap:14px; flex-wrap:wrap; margin-top:2px; }
            .cf-radio-group label{ display:flex; align-items:center; gap:6px; font-size:13px; font-weight:500; color:#374151; cursor:pointer; }
            .cf-radio-group input{ width:auto; margin:0; }

            /* Bagua 3×3 grid (Lunar / Solar) */
            .cf-bagua-wrap{ display:grid; grid-template-columns:repeat(2, minmax(0, 1fr)); gap:18px; }
            @media (max-width: 640px){ .cf-bagua-wrap{ grid-template-columns:1fr; } }
            .cf-bagua{ background:#FAFAF9; border:1px solid #E5E7EB; border-radius:10px; padding:12px; }
            .cf-bagua-title{ text-align:center; font-weight:700; font-size:14px; margin-bottom:10px; color:#111827; }
            .cf-bagua-grid{ display:grid; grid-template-columns:repeat(3, 1fr); gap:4px; }
            .cf-bagua-cell{ aspect-ratio:1; border:1px solid #D1D5DB; border-radius:6px; background:white; display:flex; flex-direction:column; align-items:stretch; padding:4px; position:relative; }
            .cf-bagua-cell .tg{ font-size:18px; font-weight:700; color:#7C3AED; text-align:center; line-height:1; }
            .cf-bagua-cell textarea{ flex:1; border:none; outline:none; resize:none; padding:2px 4px; font-size:12px; font-family:inherit; color:#111827; background:transparent; min-height:0; }
            .cf-bagua-cell.cf-bagua-center{ background:#FEF3C7; }
            .cf-bagua-cell.cf-bagua-center .tg{ color:#92400E; }

            /* Signature canvas */
            .cf-sig-wrap{ display:flex; flex-direction:column; gap:6px; }
            .cf-sig-canvas{ width:100%; height:120px; border:1px dashed #9CA3AF; border-radius:6px; background:white; touch-action:none; }
            .cf-sig-actions{ display:flex; justify-content:space-between; align-items:center; }
            .cf-sig-actions small{ color:#6B7280; font-size:11px; }

            /* Likert 5-point */
            .cf-likert{ display:grid; grid-template-columns:repeat(5, 1fr); gap:6px; }
            @media (max-width: 480px){ .cf-likert{ grid-template-columns:repeat(2, 1fr); } }
            .cf-likert label{ display:flex; flex-direction:column; align-items:center; gap:4px; padding:8px 4px; border:1px solid #E5E7EB; border-radius:6px; background:white; cursor:pointer; font-size:11px; font-weight:600; color:#374151; text-align:center; line-height:1.2; }
            .cf-likert label.cf-likert-on{ background:#7C3AED; border-color:#7C3AED; color:white; }
            .cf-likert input{ display:none; }
            .cf-likert .zh{ display:block; font-size:10px; opacity:0.85; }

            /* Referral table (APU Q7) */
            .cf-ref-table{ width:100%; border-collapse:collapse; font-size:13px; }
            .cf-ref-table th, .cf-ref-table td{ border:1px solid #D1D5DB; padding:6px 8px; }
            .cf-ref-table th{ background:#F3F4F6; font-weight:600; font-size:12px; }
            .cf-ref-table input{ width:100%; border:none; outline:none; padding:4px 2px; font-size:13px; }
            @media (max-width: 640px){
                .cf-ref-table thead{ display:none; }
                .cf-ref-table tr{ display:block; border:1px solid #D1D5DB; border-radius:8px; padding:8px; margin-bottom:10px; }
                .cf-ref-table td{ display:block; border:none; padding:4px 0; }
                .cf-ref-table td::before{ content:attr(data-label) ': '; font-weight:600; color:#6B7280; font-size:11px; }
            }
        </style>

        <div class="cf-wrap">
            <div class="cf-header">
                <div>
                    <h2>Customer Forms 客户表格</h2>
                    <p>Survey → CPS Analysis → APU Appraisal. Pick a prospect to start.</p>
                </div>
                <input type="search" id="cf-prospect-search" class="cf-search" placeholder="Search by name or phone…"
                    value="${_cfEscape(_cfState.prospectQuery)}"
                    oninput="app.cfSearchProspects(this.value)">
            </div>

            <div class="cf-flow">
                <span><span class="num">1</span> 新客户调查表 Survey</span>
                <i class="fas fa-arrow-right" style="color:#9CA3AF;"></i>
                <span><span class="num">2</span> 細解命盤 CPS Form</span>
                <i class="fas fa-arrow-right" style="color:#9CA3AF;"></i>
                <span><span class="num">3</span> APU Appraisal 反馈</span>
                <i class="fas fa-arrow-right" style="color:#9CA3AF;"></i>
                <span><span class="num">4</span> 九運改命藍圖表 Blueprint</span>
            </div>

            ${filtered.length === 0 ? `
                <div class="cf-empty">
                    <i class="fas fa-clipboard-list" style="font-size:42px; margin-bottom:10px;"></i>
                    <div>No prospects match. Try a different search.</div>
                </div>
            ` : `
                <div class="cf-list">
                    ${filtered.map(p => `
                        <div class="cf-row">
                            <div class="cf-name">
                                ${_cfEscape(p.name)}
                                <span class="sub">${_cfEscape(p.phone || 'No phone')}</span>
                            </div>
                            <div class="cf-badges">
                                ${badge(p.survey, 'Survey')}
                                ${badge(p.cps, 'CPS')}
                                ${badge(p.apu, 'APU')}
                                ${badge(p.blueprint, 'Blueprint')}
                            </div>
                            <div class="cf-actions">
                                <button class="cf-btn cf-btn-survey" onclick="app.openCustomerSurveyModal(${p.id}${p.survey ? ',' + p.survey.id : ''})">
                                    <i class="fas fa-edit"></i> ${p.survey ? 'Edit' : 'Fill'} Survey
                                </button>
                                <button class="cf-btn cf-btn-cps" onclick="app.openCpsAnalysisModal(${p.id}${p.cps ? ',' + p.cps.id : ''})">
                                    <i class="fas fa-edit"></i> ${p.cps ? 'Edit' : 'Fill'} CPS
                                </button>
                                <button class="cf-btn cf-btn-apu" onclick="app.openApuAppraisalModal(${p.id}${p.apu ? ',' + p.apu.id : ''})">
                                    <i class="fas fa-edit"></i> ${p.apu ? 'Edit' : 'Fill'} APU
                                </button>
                                <button class="cf-btn cf-btn-blueprint" onclick="app.openDestinyBlueprintInTab(${p.id}${p.blueprint ? ',' + p.blueprint.id : ''})">
                                    <i class="fas fa-external-link-alt"></i> ${p.blueprint ? 'Edit' : 'Fill'} Blueprint
                                </button>
                            </div>
                        </div>
                    `).join('')}
                </div>
            `}
        </div>
    `;
};

const cfSearchProspects = (val) => {
    _cfState.prospectQuery = val || '';
    // Debounce-light: re-render on next tick so user can keep typing
    clearTimeout(_cfState._t);
    _cfState._t = setTimeout(async () => {
        const target = document.getElementById('marketing-tab-content');
        if (target && _state.cmt === 'forms') {
            // The whole tab (search box included) is re-rendered, which drops focus and
            // caret — so the user's typing was interrupted every debounce tick. Capture
            // focus/caret first, then restore them onto the freshly-rendered input.
            const hadFocus = document.activeElement?.id === 'cf-prospect-search';
            let caret = null;
            if (hadFocus) { try { caret = document.activeElement.selectionStart; } catch (_) {} }
            target.innerHTML = await renderFormsTab();
            if (hadFocus) {
                const el = document.getElementById('cf-prospect-search');
                if (el) {
                    el.focus();
                    try { const p = caret == null ? el.value.length : caret; el.setSelectionRange(p, p); } catch (_) {}
                }
            }
        }
    }, 220);
};

// ── Likert helper ────────────────────────────────────────────────────────
const _cfLikertHtml = (name, value, options) => `
    <div class="cf-likert" data-likert="${name}">
        ${options.map(o => `
            <label class="${value === o.v ? 'cf-likert-on' : ''}" onclick="this.parentNode.querySelectorAll('label').forEach(l=>l.classList.remove('cf-likert-on'));this.classList.add('cf-likert-on');this.querySelector('input').checked=true;">
                <input type="radio" name="${name}" value="${o.v}" ${value === o.v ? 'checked' : ''}>
                <span>${o.en}</span>
                <span class="zh">${o.zh}</span>
            </label>
        `).join('')}
    </div>
`;
const _cfReadLikert = (name) => {
    const el = document.querySelector(`input[name="${name}"]:checked`);
    return el ? parseInt(el.value, 10) : null;
};

// =========================================================================
// Shared paper-styled CSS for the 3 official forms (Survey / CPS / APU).
// Mirrors the paper PDFs: serif title, tight bordered info box, square
// checkboxes (□), bilingual labels, print-friendly.
// =========================================================================
const _cfPaperStyles = () => `<style>
    .cf-paper{ background:#fff; color:#1f2937; font-family:'Times New Roman','SimSun',serif; padding:28px 32px; max-width:880px; margin:0 auto; line-height:1.45; border:1px solid #e5e7eb; border-radius:4px; }
    .cf-paper *{ box-sizing:border-box; }
    .cf-paper-head{ display:flex; justify-content:space-between; align-items:flex-start; margin-bottom:18px; gap:16px; flex-wrap:wrap; }
    .cf-paper-title-en{ font-size:22px; font-weight:700; letter-spacing:1px; }
    .cf-paper-title-zh{ font-size:24px; font-weight:700; margin-top:4px; letter-spacing:2px; }
    .cf-paper-brand{ text-align:right; font-family:'Times New Roman',serif; }
    .cf-paper-brand .cf-brand-zh{ display:block; font-size:14px; font-weight:700; color:#B89F4A; letter-spacing:1px; }
    .cf-paper-brand .cf-brand-en{ display:block; font-size:11px; font-weight:700; color:#B89F4A; letter-spacing:3px; margin-top:2px; }
    .cf-paper-info{ border:1px solid #000; padding:8px 14px; margin-bottom:14px; }
    .cf-info-2col{ display:grid; grid-template-columns:1fr 1fr; column-gap:24px; }
    @media (max-width:640px){ .cf-info-2col{ grid-template-columns:1fr; } }
    .cf-info-row{ display:grid; grid-template-columns:130px 1fr; align-items:baseline; padding:6px 0; gap:8px; border-bottom:1px dotted #d1d5db; }
    .cf-info-row:last-child, .cf-info-row:nth-last-child(2){ border-bottom:none; }
    .cf-info-lbl{ font-size:13px; font-weight:600; color:#111827; text-align:right; }
    .cf-info-lbl em{ display:block; font-style:italic; font-size:11px; font-weight:500; color:#6b7280; margin-top:1px; }
    .cf-paper-input{ width:100%; border:none; border-bottom:1px solid #6b7280; background:transparent; padding:4px 6px; font-family:inherit; font-size:13px; color:#1f2937; }
    .cf-paper-input:focus{ outline:none; border-bottom-color:#7C3AED; }
    .cf-line-input{ border:none; border-bottom:1px solid #6b7280; background:transparent; padding:2px 6px; font-family:inherit; font-size:13px; min-width:120px; flex:1; }
    .cf-line-input.cf-full{ display:block; width:100%; margin-top:6px; }

    .cf-paper-instr{ font-size:13px; margin:12px 0 8px; font-weight:600; }

    .cf-paper-qs{ display:flex; flex-direction:column; gap:10px; }
    .cf-q{ font-size:13.5px; }
    .cf-q-line{ line-height:1.6; margin-bottom:4px; }
    .cf-q-n{ font-weight:700; margin-right:4px; }
    .cf-cb-row{ display:flex; flex-wrap:wrap; gap:12px 22px; align-items:center; margin:4px 0; }
    .cf-cb{ display:inline-flex; align-items:center; gap:6px; cursor:pointer; font-size:13px; user-select:none; }
    .cf-cb input{ -webkit-appearance:none; appearance:none; width:14px; height:14px; min-width:14px; border:1.5px solid #1f2937; background:#fff; cursor:pointer; margin:0; position:relative; border-radius:0; }
    .cf-cb input:checked{ background:#1f2937; }
    .cf-cb input:checked::after{ content:""; position:absolute; left:3px; top:0px; width:4px; height:8px; border:solid #fff; border-width:0 2px 2px 0; transform:rotate(45deg); }
    .cf-cb-txt{ line-height:1.3; }
    .cf-cb-en{ font-size:11px; color:#6b7280; font-style:italic; margin-left:2px; }
    .cf-cb-stack{ flex-direction:column; align-items:center; text-align:center; padding:6px 4px; min-width:90px; }
    .cf-cb-stack .cf-cb-txt{ font-size:12px; margin-top:4px; }

    .cf-paper-sig-row{ display:grid; grid-template-columns:1.4fr 1fr; gap:24px; margin-top:28px; }
    @media (max-width:640px){ .cf-paper-sig-row{ grid-template-columns:1fr; } }
    .cf-paper-sig-block{ text-align:center; }
    .cf-paper-sig-canvas{ width:100%; height:74px; border-bottom:1px solid #1f2937; background:#fff; touch-action:none; display:block; }
    .cf-paper-sig-cap{ font-size:12px; color:#1f2937; margin-top:4px; }
    .cf-paper-sig-date{ border-bottom:1px solid #1f2937; padding:24px 0 4px; font-size:13px; color:#374151; text-align:center; }
    .cf-mini-btn{ background:transparent; border:1px solid #d1d5db; padding:3px 8px; border-radius:4px; font-size:11px; cursor:pointer; color:#6b7280; }

    .cf-paper-thanks{ margin-top:22px; padding-top:14px; border-top:1px dashed #6b7280; text-align:center; font-size:12.5px; line-height:1.7; color:#1f2937; }
    .cf-paper-copyright{ text-align:center; font-size:11px; color:#6b7280; margin-top:8px; letter-spacing:1px; }

    /* CPS bagua grid — paper styled */
    .cf-bagua-box{ border:1px solid #000; padding:18px 22px; margin:14px 0; }
    .cf-bagua-2col{ display:grid; grid-template-columns:1fr 1fr; gap:36px; }
    @media (max-width:640px){ .cf-bagua-2col{ grid-template-columns:1fr; } }
    .cf-bagua-lbl{ font-weight:700; font-size:15px; margin-bottom:10px; padding-left:4px; }
    .cf-bagua-cells{ display:grid; grid-template-columns:repeat(3, 1fr); border:1.5px solid #1f2937; }
    .cf-bagua-cell{ aspect-ratio:1; border:1px solid #1f2937; position:relative; padding:6px 6px 4px; background:#fff; display:flex; flex-direction:column; }
    .cf-bagua-cell .tg{ position:absolute; top:6px; left:8px; font-size:24px; font-weight:700; color:#cbd5e1; line-height:1; pointer-events:none; font-family:'SimSun','PMingLiU',serif; }
    .cf-bagua-cell textarea{ width:100%; flex:1; border:none; resize:none; padding:24px 4px 4px; font-size:12px; font-family:inherit; color:#1f2937; background:transparent; outline:none; }

    /* CPS notes — 6 lines */
    .cf-notes-lines{ margin:10px 0 14px; }
    .cf-notes-lines .nline{ border-bottom:1px solid #6b7280; height:26px; }

    /* FOR OFFICE USE black banner */
    .cf-office-banner{ background:#000; color:#fff; padding:5px 14px; font-weight:700; font-size:12.5px; letter-spacing:1px; margin:14px 0 12px; }
    .cf-office-row{ display:grid; grid-template-columns:1fr 1fr; gap:36px; padding:6px 4px 0; }
    @media (max-width:640px){ .cf-office-row{ grid-template-columns:1fr; } }
    .cf-office-sig-line{ border-bottom:1px solid #1f2937; height:54px; position:relative; }
    .cf-office-sig-line canvas{ width:100%; height:100%; touch-action:none; display:block; }
    .cf-office-sig-cap{ font-size:12px; color:#1f2937; margin-top:4px; }
    .cf-office-sig-cap .ndate{ display:grid; grid-template-columns:50px 1fr; gap:4px; font-size:12px; margin-top:6px; }
    .cf-office-sig-cap .ndate input,.cf-office-sig-cap .ndate select{ border:none; border-bottom:1px dotted #6b7280; background:transparent; font-family:inherit; font-size:12px; padding:1px 2px; }

    /* APU likert 5 in a row */
    .cf-apu-q{ border-bottom:1px solid #e5e7eb; padding:8px 0; }
    .cf-apu-q:last-child{ border-bottom:none; }
    .cf-apu-likert{ display:grid; grid-template-columns:repeat(5, 1fr); gap:8px; margin:6px 0 6px; }
    @media (max-width:640px){ .cf-apu-likert{ grid-template-columns:repeat(2, 1fr); } }
    .cf-apu-reason{ display:flex; align-items:baseline; gap:6px; margin-top:4px; font-size:12px; }
    .cf-apu-reason .lbl{ white-space:nowrap; font-weight:500; }

    /* APU referral table */
    .cf-apu-ref{ width:100%; border-collapse:collapse; margin:8px 0; font-size:12.5px; }
    .cf-apu-ref th,.cf-apu-ref td{ border:1px solid #1f2937; padding:6px 8px; vertical-align:middle; }
    .cf-apu-ref th{ background:#f3f4f6; font-weight:600; text-align:left; }
    .cf-apu-ref td{ height:30px; }
    .cf-apu-ref input{ width:100%; border:none; background:transparent; font-family:inherit; font-size:12.5px; padding:2px 0; }
    @media (max-width:640px){
        .cf-apu-ref thead{ display:none; }
        .cf-apu-ref tr{ display:block; border:1px solid #1f2937; padding:6px 8px; margin-bottom:8px; }
        .cf-apu-ref td{ display:grid; grid-template-columns:90px 1fr; gap:6px; border:none; padding:3px 0; }
        .cf-apu-ref td::before{ content:attr(data-label); font-weight:600; font-size:11px; color:#6b7280; }
    }

    /* APU 3 signatures */
    .cf-sig-3{ display:grid; grid-template-columns:repeat(3, 1fr); gap:24px; margin-top:24px; }
    @media (max-width:640px){ .cf-sig-3{ grid-template-columns:1fr; } }

    /* Print */
    @media print {
        body * { visibility:hidden !important; }
        .cf-paper, .cf-paper * { visibility:visible !important; }
        .cf-paper{ position:absolute; left:0; top:0; box-shadow:none; border:none; max-width:none; padding:18px; }
        .cf-no-print{ display:none !important; }
        .modal-overlay,.modal-footer{ display:none !important; }
    }
</style>`;

// =========================================================================
// 1) NEW CUSTOMER SURVEY (新客户调查表) — 6 Qs + signature
// =========================================================================
const openCustomerSurveyModal = async (prospectId, surveyId = null) => {
    const prospect = await AppDataStore.getById('prospects', prospectId).catch(() => null);
    if (!prospect) { UI.toast.error('Prospect not found.'); return; }

    let existing = null;
    if (surveyId) {
        existing = await AppDataStore.getById('customer_surveys', surveyId).catch(() => null);
    }

    const users = await AppDataStore.getAll('users').catch(() => []);
    const consultantOpts = users
        .filter(u => u.status !== 'inactive')
        .map(u => `<option value="${u.id}" ${existing?.consultant_id == u.id ? 'selected' : ''}>${_cfEscape(u.full_name || u.email)}</option>`)
        .join('');

    const today = new Date().toISOString().slice(0, 10);
    const data = existing || {};

    const cb = (name, val, en, zh, extra = '') => `
        <label class="cf-cb"><input type="radio" name="${name}" value="${val}" ${data[name] === val ? 'checked' : ''}>
            <span class="cf-cb-txt">${zh}${en ? ` <span class="cf-cb-en">${en}</span>` : ''}${extra}</span>
        </label>`;

    _rxShowModal(`新客户调查表 · ${_cfEscape(prospect.full_name || '')}`, `
        ${_cfPaperStyles()}
        <div class="cf-paper" id="cf-survey-paper">
            <input type="hidden" id="cf-survey-prospect-id" value="${prospect.id}">
            <input type="hidden" id="cf-survey-id" value="${surveyId || ''}">

            <div class="cf-paper-head">
                <div>
                    <div class="cf-paper-title-en">DESTINY CODE</div>
                    <div class="cf-paper-title-zh">新客户调查表</div>
                </div>
                <div class="cf-paper-brand">
                    <span class="cf-brand-zh">天　命　定　數<sup>®</sup></span>
                    <span class="cf-brand-en">DESTINY CODE</span>
                </div>
            </div>

            <div class="cf-paper-info">
                <div class="cf-info-2col">
                    <div class="cf-info-row">
                        <span class="cf-info-lbl">顾问姓名 <em>Consultant</em></span>
                        <select class="cf-paper-input" id="cf-survey-consultant"><option value="">—</option>${consultantOpts}</select>
                    </div>
                    <div class="cf-info-row">
                        <span class="cf-info-lbl">解盘日期 <em>Date</em></span>
                        <input type="date" class="cf-paper-input" id="cf-survey-date" value="${data.analysis_date || today}">
                    </div>
                    <div class="cf-info-row">
                        <span class="cf-info-lbl">客户姓名 <em>Customer Name</em></span>
                        <input type="text" class="cf-paper-input" id="cf-survey-name" value="${_cfEscape(data.customer_name || prospect.full_name || '')}">
                    </div>
                    <div class="cf-info-row">
                        <span class="cf-info-lbl">电邮 <em>Email</em></span>
                        <input type="email" class="cf-paper-input" id="cf-survey-email" value="${_cfEscape(data.email || prospect.email || '')}">
                    </div>
                    <div class="cf-info-row">
                        <span class="cf-info-lbl">联络电话 <em>Phone</em></span>
                        <input type="tel" class="cf-paper-input" id="cf-survey-phone" value="${_cfEscape(data.phone || prospect.phone || '')}">
                    </div>
                    <div class="cf-info-row">
                        <span class="cf-info-lbl">职业 <em>Occupation</em></span>
                        <input type="text" class="cf-paper-input" id="cf-survey-occupation" value="${_cfEscape(data.occupation || prospect.occupation || '')}">
                    </div>
                </div>
            </div>

            <div class="cf-paper-instr">* 请在格子里打勾 <span style="color:#888;">(Tick the appropriate box)</span> ︰－</div>

            <div class="cf-paper-qs">
                <div class="cf-q">
                    <div class="cf-q-line"><span class="cf-q-n">1)</span> 请问您从哪里听闻及认识到DC?</div>
                    <div class="cf-cb-row">
                        ${cb('q1_source','family','','亲属')}
                        ${cb('q1_source','friend','','朋友')}
                        ${cb('q1_source','other','','其他')}
                        <input type="text" id="cf-survey-q1-other" class="cf-line-input" placeholder="(请说明)" value="${_cfEscape(data.q1_source_other || '')}">
                    </div>
                </div>

                <div class="cf-q">
                    <div class="cf-q-line"><span class="cf-q-n">2)</span> 请问您目前或之前有使用过风水或相关风水服务?</div>
                    <div class="cf-cb-row">
                        <label class="cf-cb"><input type="radio" name="q2_used_before" value="true" ${data.q2_used_before === true ? 'checked' : ''}><span class="cf-cb-txt">有</span></label>
                        <label class="cf-cb"><input type="radio" name="q2_used_before" value="false" ${data.q2_used_before === false ? 'checked' : ''}><span class="cf-cb-txt">没有</span></label>
                    </div>
                </div>

                <div class="cf-q">
                    <div class="cf-q-line"><span class="cf-q-n">3)</span> 请问您个人或家庭之前或目前相信风水的功效吗?</div>
                    <div class="cf-cb-row">
                        <label class="cf-cb"><input type="radio" name="q3_belief" value="believe" ${data.q3_belief === 'believe' ? 'checked' : ''}><span class="cf-cb-txt">相信, 为什麼</span></label>
                        <label class="cf-cb"><input type="radio" name="q3_belief" value="disbelieve" ${data.q3_belief === 'disbelieve' ? 'checked' : ''}><span class="cf-cb-txt">不相信, 为什麼</span></label>
                        <label class="cf-cb"><input type="radio" name="q3_belief" value="neutral" ${data.q3_belief === 'neutral' ? 'checked' : ''}><span class="cf-cb-txt">中立</span></label>
                    </div>
                    <input type="text" id="cf-survey-q3-reason" class="cf-line-input cf-full" placeholder="(请说明原因)" value="${_cfEscape(data.q3_belief_reason || '')}">
                </div>

                <div class="cf-q">
                    <div class="cf-q-line"><span class="cf-q-n">4)</span> 如果传承7000年的玄空风水, 确实有效, 您会否愿意尝试使用?</div>
                    <div class="cf-cb-row">
                        ${cb('q4_willing','yes','','愿意')}
                        ${cb('q4_willing','maybe','','可能愿意')}
                        ${cb('q4_willing','no','','不愿意')}
                    </div>
                </div>

                <div class="cf-q">
                    <div class="cf-q-line"><span class="cf-q-n">5)</span> 为了个人及家人拥有更好的利益、更安全的生活环境, 倘若有能力及良好机会, 您是否愿意使用DC风水的解决方案, 以帮助及改善全家人的财富状况、事业发展、工作绩效、夫妻关系、孩子教育及人缘关系等?</div>
                    <div class="cf-cb-row">
                        ${cb('q5_use_dc','willing','','愿意使用')}
                        ${cb('q5_use_dc','consider','','考虑使用')}
                        ${cb('q5_use_dc','neutral','','中立')}
                    </div>
                </div>

                <div class="cf-q">
                    <div class="cf-q-line"><span class="cf-q-n">6)</span> 若您明白到DC风水知识的种种好处与利益, 您会否主动分享给亲友一起获得这个利益?</div>
                    <div class="cf-cb-row">
                        ${cb('q6_share','definitely','','一定分享')}
                        ${cb('q6_share','when_opportunity','','有机会就分享')}
                        ${cb('q6_share','no','','不愿分享')}
                    </div>
                </div>
            </div>

            <div class="cf-paper-sig-row">
                <div class="cf-paper-sig-block">
                    <canvas id="cf-survey-sig" class="cf-paper-sig-canvas" data-preload="${data.signature_data_url || ''}"></canvas>
                    <div class="cf-paper-sig-cap">客户签名 / Customer Signature</div>
                </div>
                <div class="cf-paper-sig-block">
                    <div class="cf-paper-sig-date">${_cfFmtDate(data.signed_at) || _cfFmtDate(new Date().toISOString())}</div>
                    <div class="cf-paper-sig-cap">日期 / Date</div>
                </div>
            </div>
            <div class="cf-no-print" style="text-align:right;margin-top:-8px;"><button type="button" class="cf-mini-btn" onclick="app.cfClearSignature('cf-survey-sig')">Clear signature</button></div>

            <div class="cf-paper-thanks">
                助人为乐, DC全体同仁感谢您无私地参与本次的调查,<br>
                有助於我们提升服务水准, 帮助更多朋友获得利益. 谢谢.
            </div>
            <div class="cf-paper-copyright">~ 版权所有, 翻印必究 ~</div>
        </div>
    `, [
        { label: 'Cancel', type: 'secondary', action: 'UI.hideModal()' },
        { label: 'Print', type: 'secondary', action: 'window.print()' },
        { label: 'Save Survey', type: 'primary', action: '(async () => { await app.saveCustomerSurvey(); })()' }
    ]);

    // Bind signature pad after modal renders
    setTimeout(() => _bindSignaturePad('cf-survey-sig'), 60);
};

const saveCustomerSurvey = async () => {
    const prospectId = parseInt(document.getElementById('cf-survey-prospect-id')?.value, 10);
    const surveyId = document.getElementById('cf-survey-id')?.value || null;
    if (!prospectId) { UI.toast.error('Missing prospect.'); return; }

    const q2Raw = document.querySelector('input[name="q2_used_before"]:checked')?.value;
    const q2 = q2Raw == null ? null : q2Raw === 'true';
    const _cfSurveySig = _getSignatureDataUrl('cf-survey-sig');

    const payload = {
        prospect_id: prospectId,
        consultant_id: parseInt(document.getElementById('cf-survey-consultant')?.value, 10) || null,
        analysis_date: document.getElementById('cf-survey-date')?.value || null,
        customer_name: document.getElementById('cf-survey-name')?.value?.trim() || null,
        email: document.getElementById('cf-survey-email')?.value?.trim() || null,
        phone: document.getElementById('cf-survey-phone')?.value?.trim() || null,
        occupation: document.getElementById('cf-survey-occupation')?.value?.trim() || null,
        q1_source: document.querySelector('input[name="q1_source"]:checked')?.value || null,
        q1_source_other: document.getElementById('cf-survey-q1-other')?.value?.trim() || null,
        q2_used_before: q2,
        q3_belief: document.querySelector('input[name="q3_belief"]:checked')?.value || null,
        q3_belief_reason: document.getElementById('cf-survey-q3-reason')?.value?.trim() || null,
        q4_willing: document.querySelector('input[name="q4_willing"]:checked')?.value || null,
        q5_use_dc: document.querySelector('input[name="q5_use_dc"]:checked')?.value || null,
        q6_share: document.querySelector('input[name="q6_share"]:checked')?.value || null,
        signature_data_url: _cfSurveySig,
        // signed_at is set per-branch below (create vs update) so an edit preserves
        // the moment the customer ORIGINALLY signed instead of re-stamping now().
        // created_by is set only on CREATE (below) so an edit never reassigns the
        // original capturer of the form.
    };

    try {
        if (surveyId) {
            // Preserve the ORIGINAL signing moment across edits: keep the prior
            // signed_at when a signature is still present; stamp now only if this is
            // the first time it's being signed; clear it if the signature was removed.
            let _prior = null;
            try { _prior = await AppDataStore.getById('customer_surveys', surveyId); } catch (_) {}
            payload.signed_at = _cfSurveySig ? (_prior?.signed_at || new Date().toISOString()) : null;
            await AppDataStore.update('customer_surveys', surveyId, payload);
            UI.toast.success('Survey updated.');
        } else {
            payload.signed_at = _cfSurveySig ? new Date().toISOString() : null;
            await AppDataStore.create('customer_surveys', { ...payload, created_by: _state.cu?.id || null, created_at: new Date().toISOString() });
            UI.toast.success('Survey saved.');
        }
        UI.hideModal();
        _cfDataCache = null; // saved data changed — force a fresh fetch on re-render
        const target = document.getElementById('marketing-tab-content');
        if (target && _state.cmt === 'forms') target.innerHTML = await renderFormsTab();
    } catch (err) {
        UI.toast.error('Save failed: ' + (err?.message || err));
    }
};

// =========================================================================
// 2) CPS FORM — Personal Life Chart Analysis (細解命盤) with bagua grids
// =========================================================================
const _cfBaguaHtml = (which, data) => {
    // 後天八卦 standard arrangement (3x3):
    //   xun (SE)   | li  (S) | kun (SW)
    //   zhen (E)   | center | dui (W)
    //   gen  (NE)  | kan (N) | qian (NW)
    const cells = [
        { k: 'xun',    tg: '巽' },
        { k: 'li',     tg: '離' },
        { k: 'kun',    tg: '坤' },
        { k: 'zhen',   tg: '震' },
        { k: 'center', tg: '中' },
        { k: 'dui',    tg: '兌' },
        { k: 'gen',    tg: '艮' },
        { k: 'kan',    tg: '坎' },
        { k: 'qian',   tg: '乾' }
    ];
    return `
        <div class="cf-bagua">
            <div class="cf-bagua-title">${which === 'lunar' ? 'Lunar 農曆' : 'Solar 陽曆'}</div>
            <div class="cf-bagua-grid">
                ${cells.map(c => `
                    <div class="cf-bagua-cell ${c.k === 'center' ? 'cf-bagua-center' : ''}">
                        <div class="tg">${c.tg}</div>
                        <textarea id="cf-cps-${which}-${c.k}" placeholder="…">${_cfEscape((data && data[c.k]) || '')}</textarea>
                    </div>
                `).join('')}
            </div>
        </div>
    `;
};

const _cfReadBagua = (which) => {
    const out = {};
    ['xun','li','kun','zhen','center','dui','gen','kan','qian'].forEach(k => {
        out[k] = document.getElementById(`cf-cps-${which}-${k}`)?.value?.trim() || '';
    });
    return out;
};

const openCpsAnalysisModal = async (prospectId, cpsId = null) => {
    const prospect = await AppDataStore.getById('prospects', prospectId).catch(() => null);
    if (!prospect) { UI.toast.error('Prospect not found.'); return; }

    let existing = null;
    if (cpsId) existing = await AppDataStore.getById('cps_analyses', cpsId).catch(() => null);

    const users = await AppDataStore.getAll('users').catch(() => []);
    const dealerOpts = users
        .filter(u => u.status !== 'inactive')
        .map(u => `<option value="${u.id}" ${existing?.dealer_id == u.id ? 'selected' : ''}>${_cfEscape(u.full_name || u.email)}</option>`)
        .join('');
    const cpsByOpts = users
        .filter(u => u.status !== 'inactive')
        .map(u => `<option value="${u.id}" ${existing?.cps_by_id == u.id ? 'selected' : ''}>${_cfEscape(u.full_name || u.email)}</option>`)
        .join('');

    const today = new Date().toISOString().slice(0, 10);
    const data = existing || {};

    // Bagua cells in 後天八卦 standard arrangement (matches paper):
    //   xun (NW) | li (N) | kun (NE)
    //   zhen (W) |        | dui (E)
    //   gen (SW) | kan(S) | qian(SE)
    const baguaPaper = (which, chartData) => {
        const cells = [
            { k: 'xun',  tg: '巽' }, { k: 'li',   tg: '離' }, { k: 'kun',  tg: '坤' },
            { k: 'zhen', tg: '震' }, { k: 'center', tg: '' },  { k: 'dui',  tg: '兌' },
            { k: 'gen',  tg: '艮' }, { k: 'kan',  tg: '坎' }, { k: 'qian', tg: '乾' }
        ];
        return `
            <div>
                <div class="cf-bagua-lbl">${which === 'lunar' ? 'Lunar' : 'Solar'}</div>
                <div class="cf-bagua-cells">
                    ${cells.map(c => `
                        <div class="cf-bagua-cell">
                            <span class="tg">${c.tg}</span>
                            <textarea id="cf-cps-${which}-${c.k}">${_cfEscape((chartData && chartData[c.k]) || '')}</textarea>
                        </div>
                    `).join('')}
                </div>
            </div>`;
    };

    _rxShowModal(`細解命盤 · ${_cfEscape(prospect.full_name || '')}`, `
        ${_cfPaperStyles()}
        <div class="cf-paper" id="cf-cps-paper">
            <input type="hidden" id="cf-cps-prospect-id" value="${prospect.id}">
            <input type="hidden" id="cf-cps-id" value="${cpsId || ''}">

            <div class="cf-paper-head">
                <div>
                    <div class="cf-paper-title-en">PERSONAL LIFE CHART ANALYSIS</div>
                    <div class="cf-paper-title-zh">細解命盤</div>
                </div>
                <div class="cf-paper-brand">
                    <span class="cf-brand-zh">天　命　定　數<sup>®</sup></span>
                    <span class="cf-brand-en">DESTINY CODE</span>
                </div>
            </div>

            <!-- Date / SN row (above the info box, like paper) -->
            <div style="display:grid; grid-template-columns:1fr 1fr; gap:32px; margin-bottom:12px;">
                <div class="cf-info-row" style="border-bottom:none; grid-template-columns:80px 1fr;">
                    <span class="cf-info-lbl"><strong>Date</strong></span>
                    <input type="date" class="cf-paper-input" id="cf-cps-date" value="${data.form_date || today}">
                </div>
                <div class="cf-info-row" style="border-bottom:none; grid-template-columns:80px 1fr;">
                    <span class="cf-info-lbl"><strong>SN</strong></span>
                    <input type="text" class="cf-paper-input" id="cf-cps-sn" value="${_cfEscape(data.serial_number || '')}" placeholder="…">
                </div>
            </div>

            <!-- Customer info bordered box, 2 columns x 5 rows like paper.
                 CPS-specific overrides: tighter label column, inline-nowrap
                 checkboxes for Gender/Marital, Birthdate cell holds BOTH
                 Solar+Lunar inputs side-by-side. -->
            <style>
                #cf-cps-paper .cf-info-row{ grid-template-columns:108px 1fr; gap:6px; }
                #cf-cps-paper .cf-info-lbl{ font-size:12px; }
                #cf-cps-paper .cf-info-lbl em{ font-size:10.5px; }
                #cf-cps-paper .cf-info-row .cf-cb-row{ flex-wrap:nowrap; gap:12px; }
                #cf-cps-paper .cf-info-row .cf-cb{ font-size:12px; white-space:nowrap; }
                #cf-cps-paper .cf-bd-cell{ display:grid; grid-template-columns:auto 1fr; gap:4px 6px; align-items:center; }
                #cf-cps-paper .cf-bd-cell .lbl{ font-size:10.5px; color:#6b7280; white-space:nowrap; }
                #cf-cps-paper .cf-bd-cell input{ min-width:0; }
                #cf-cps-paper .cf-paper-input{ min-width:0; }
                @media (max-width:640px){
                    #cf-cps-paper .cf-info-row .cf-cb-row{ flex-wrap:wrap; }
                }
            </style>
            <div class="cf-paper-info">
                <div class="cf-info-2col">
                    <!-- Row 1: Customer Name | Gender -->
                    <div class="cf-info-row">
                        <span class="cf-info-lbl">Customer Name<em>客戶姓名</em></span>
                        <input type="text" class="cf-paper-input" id="cf-cps-name" value="${_cfEscape(data.customer_name || prospect.full_name || '')}" placeholder="(中文)">
                    </div>
                    <div class="cf-info-row">
                        <span class="cf-info-lbl">Gender<em>性別</em></span>
                        <div class="cf-cb-row">
                            <label class="cf-cb"><input type="radio" name="cps_gender" value="female" ${data.gender === 'female' ? 'checked' : ''}><span class="cf-cb-txt">女&nbsp;<span class="cf-cb-en">Female</span></span></label>
                            <label class="cf-cb"><input type="radio" name="cps_gender" value="male"   ${data.gender === 'male'   ? 'checked' : ''}><span class="cf-cb-txt">男&nbsp;<span class="cf-cb-en">Male</span></span></label>
                        </div>
                    </div>
                    <!-- Row 2: Birthdate (Solar + Lunar inline) | Phone -->
                    <div class="cf-info-row">
                        <span class="cf-info-lbl">Birthdate<em>生日日期</em></span>
                        <div class="cf-bd-cell">
                            <span class="lbl">Solar 陽曆</span>
                            <input type="date" class="cf-paper-input" id="cf-cps-bd-solar" value="${data.birthdate_solar || prospect.date_of_birth || ''}">
                            <span class="lbl">Lunar 農曆</span>
                            <input type="date" class="cf-paper-input" id="cf-cps-bd-lunar" value="${data.birthdate_lunar || prospect.lunar_birth || ''}">
                        </div>
                    </div>
                    <div class="cf-info-row">
                        <span class="cf-info-lbl">Phone Number<em>手提號碼</em></span>
                        <input type="tel" class="cf-paper-input" id="cf-cps-phone" value="${_cfEscape(data.phone || prospect.phone || '')}">
                    </div>
                    <!-- Row 3: Occupation | Email -->
                    <div class="cf-info-row">
                        <span class="cf-info-lbl">Current Occupation<em>目前職業</em></span>
                        <input type="text" class="cf-paper-input" id="cf-cps-occupation" value="${_cfEscape(data.occupation || prospect.occupation || '')}">
                    </div>
                    <div class="cf-info-row">
                        <span class="cf-info-lbl">Email<em>電郵</em></span>
                        <input type="email" class="cf-paper-input" id="cf-cps-email" value="${_cfEscape(data.email || prospect.email || '')}">
                    </div>
                    <!-- Row 4: Living Area | Introducer -->
                    <div class="cf-info-row">
                        <span class="cf-info-lbl">Living Area<em>居住地區</em></span>
                        <input type="text" class="cf-paper-input" id="cf-cps-area" value="${_cfEscape(data.living_area || prospect.city || '')}">
                    </div>
                    <div class="cf-info-row">
                        <span class="cf-info-lbl">Introducer<em>介紹人</em></span>
                        <input type="text" class="cf-paper-input" id="cf-cps-introducer" value="${_cfEscape(data.introducer || prospect.referred_by || '')}">
                    </div>
                    <!-- Row 5: Marital Status | Dealer Name -->
                    <div class="cf-info-row">
                        <span class="cf-info-lbl">Marital Status<em>婚姻狀況</em></span>
                        <div class="cf-cb-row">
                            <label class="cf-cb"><input type="radio" name="cps_marital" value="single"  ${data.marital_status === 'single'  ? 'checked' : ''}><span class="cf-cb-txt">Single</span></label>
                            <label class="cf-cb"><input type="radio" name="cps_marital" value="married" ${data.marital_status === 'married' ? 'checked' : ''}><span class="cf-cb-txt">Married</span></label>
                            <label class="cf-cb"><input type="radio" name="cps_marital" value="others"  ${data.marital_status === 'others'  ? 'checked' : ''}><span class="cf-cb-txt">Others</span></label>
                        </div>
                    </div>
                    <div class="cf-info-row">
                        <span class="cf-info-lbl">Dealer Name<em>代理姓名</em></span>
                        <select class="cf-paper-input" id="cf-cps-dealer"><option value="">—</option>${dealerOpts}</select>
                    </div>
                </div>
            </div>

            <!-- Bagua: Lunar | Solar -->
            <div class="cf-bagua-box">
                <div class="cf-bagua-2col">
                    ${baguaPaper('lunar', data.lunar_chart || {})}
                    ${baguaPaper('solar', data.solar_chart || {})}
                </div>
            </div>

            <!-- 6 horizontal notes lines (combined into one textarea backing) -->
            <textarea id="cf-cps-notes" style="width:100%; min-height:160px; border:1px solid #6b7280; padding:6px 8px; font-family:inherit; font-size:12.5px; line-height:26px; background:repeating-linear-gradient(transparent, transparent 25px, #6b7280 25px, #6b7280 26px);">${_cfEscape(data.notes || '')}</textarea>

            <!-- FOR OFFICE USE black banner + 2 signature blocks -->
            <div class="cf-office-banner">FOR OFFICE USE</div>
            <div class="cf-office-row">
                <div>
                    <div class="cf-office-sig-line">
                        <canvas id="cf-cps-sig-dealer" data-preload="${data.dealer_signature_data_url || ''}"></canvas>
                    </div>
                    <div class="cf-office-sig-cap">
                        <strong>Dealer's Signature</strong>
                        <div class="ndate"><span>Name</span><input type="text" id="cf-cps-dealer-name" value="${_cfEscape(data.dealer_signed_name || '')}"></div>
                        <div class="ndate"><span>Date</span><input type="date" id="cf-cps-dealer-date" value="${data.dealer_signed_at ? data.dealer_signed_at.slice(0,10) : today}"></div>
                        <button type="button" class="cf-mini-btn cf-no-print" style="margin-top:4px;" onclick="app.cfClearSignature('cf-cps-sig-dealer')">Clear signature</button>
                    </div>
                </div>
                <div>
                    <div class="cf-office-sig-line">
                        <canvas id="cf-cps-sig-cps" data-preload="${data.cps_signature_data_url || ''}"></canvas>
                    </div>
                    <div class="cf-office-sig-cap">
                        <strong>CPS by</strong>
                        <div class="ndate"><span>Name</span><select id="cf-cps-by"><option value="">—</option>${cpsByOpts}</select></div>
                        <div class="ndate"><span></span><input type="text" id="cf-cps-by-name" value="${_cfEscape(data.cps_signed_name || '')}" placeholder="or write name"></div>
                        <div class="ndate"><span>Date</span><input type="date" id="cf-cps-by-date" value="${data.cps_signed_at ? data.cps_signed_at.slice(0,10) : today}"></div>
                        <button type="button" class="cf-mini-btn cf-no-print" style="margin-top:4px;" onclick="app.cfClearSignature('cf-cps-sig-cps')">Clear signature</button>
                    </div>
                </div>
            </div>
        </div>
    `, [
        { label: 'Cancel', type: 'secondary', action: 'UI.hideModal()' },
        { label: 'Print', type: 'secondary', action: 'window.print()' },
        { label: 'Save CPS', type: 'primary', action: '(async () => { await app.saveCpsAnalysis(); })()' }
    ]);

    setTimeout(() => {
        _bindSignaturePad('cf-cps-sig-dealer');
        _bindSignaturePad('cf-cps-sig-cps');
    }, 60);
};

const saveCpsAnalysis = async () => {
    const prospectId = parseInt(document.getElementById('cf-cps-prospect-id')?.value, 10);
    const cpsId = document.getElementById('cf-cps-id')?.value || null;
    if (!prospectId) { UI.toast.error('Missing prospect.'); return; }

    const dealerSig = _getSignatureDataUrl('cf-cps-sig-dealer');
    const cpsSig    = _getSignatureDataUrl('cf-cps-sig-cps');

    // Honour the visible Dealer / CPS date inputs instead of re-stamping now() on
    // every save. Signature-gated exactly as before (no signature → null), but when
    // a signature exists we prefer the entered date: parse the date-only value with
    // explicit Y, M-1, D (no UTC day-shift), anchored to local noon so the stored
    // ISO day matches the picked day. Only fall back to now() when the date field
    // is blank/malformed.
    const _signedAtFrom = (dateInputId, hasSig) => {
        if (!hasSig) return null;
        const raw = document.getElementById(dateInputId)?.value?.trim();
        const m = raw && /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw);
        if (m) return new Date(+m[1], +m[2] - 1, +m[3], 12, 0, 0).toISOString();
        return new Date().toISOString();
    };

    const payload = {
        prospect_id: prospectId,
        serial_number: document.getElementById('cf-cps-sn')?.value?.trim() || null,
        form_date: document.getElementById('cf-cps-date')?.value || null,
        customer_name: document.getElementById('cf-cps-name')?.value?.trim() || null,
        // L2006 — there is no #cf-cps-name-zh input; the form's only name field
        // (#cf-cps-name, placeholder "(中文)") IS the Chinese name. Point the
        // dedicated Chinese column at it so it is no longer always saved null.
        customer_name_chinese: document.getElementById('cf-cps-name')?.value?.trim() || null,
        gender: document.querySelector('input[name="cps_gender"]:checked')?.value || null,
        birthdate_solar: document.getElementById('cf-cps-bd-solar')?.value || null,
        birthdate_lunar: document.getElementById('cf-cps-bd-lunar')?.value || null,
        phone: document.getElementById('cf-cps-phone')?.value?.trim() || null,
        email: document.getElementById('cf-cps-email')?.value?.trim() || null,
        occupation: document.getElementById('cf-cps-occupation')?.value?.trim() || null,
        living_area: document.getElementById('cf-cps-area')?.value?.trim() || null,
        introducer: document.getElementById('cf-cps-introducer')?.value?.trim() || null,
        marital_status: document.querySelector('input[name="cps_marital"]:checked')?.value || null,
        dealer_id: parseInt(document.getElementById('cf-cps-dealer')?.value, 10) || null,
        lunar_chart: _cfReadBagua('lunar'),
        solar_chart: _cfReadBagua('solar'),
        notes: document.getElementById('cf-cps-notes')?.value?.trim() || null,
        dealer_signature_data_url: dealerSig,
        dealer_signed_name: document.getElementById('cf-cps-dealer-name')?.value?.trim() || null,
        dealer_signed_at: _signedAtFrom('cf-cps-dealer-date', !!dealerSig),
        cps_by_id: parseInt(document.getElementById('cf-cps-by')?.value, 10) || null,
        cps_signature_data_url: cpsSig,
        cps_signed_name: document.getElementById('cf-cps-by-name')?.value?.trim() || null,
        cps_signed_at: _signedAtFrom('cf-cps-by-date', !!cpsSig)
        // created_by is set only on CREATE (below) so an edit never reassigns the
        // original capturer of the form.
    };

    try {
        if (cpsId) {
            await AppDataStore.update('cps_analyses', cpsId, payload);
            UI.toast.success('CPS form updated.');
        } else {
            await AppDataStore.create('cps_analyses', { ...payload, created_by: _state.cu?.id || null, created_at: new Date().toISOString() });
            UI.toast.success('CPS form saved.');
        }
        UI.hideModal();
        _cfDataCache = null; // saved data changed — force a fresh fetch on re-render
        const target = document.getElementById('marketing-tab-content');
        if (target && _state.cmt === 'forms') target.innerHTML = await renderFormsTab();
    } catch (err) {
        UI.toast.error('Save failed: ' + (err?.message || err));
    }
};

// =========================================================================
// 3) APU APPRAISAL FORM — 7 Qs + 3 referrals + 3 signatures
// =========================================================================
const openApuAppraisalModal = async (prospectId, apuId = null) => {
    const prospect = await AppDataStore.getById('prospects', prospectId).catch(() => null);
    if (!prospect) { UI.toast.error('Prospect not found.'); return; }

    let existing = null, refs = [];
    if (apuId) {
        existing = await AppDataStore.getById('apu_appraisals', apuId).catch(() => null);
        // Scoped query (was getAll over the whole apu_referrals table + client filter):
        // bounded, auto-paginates past the 1000-row cap, and still has an offline
        // localStorage fallback that applies the same filter.
        refs = (await AppDataStore.query('apu_referrals', { appraisal_id: apuId }).catch(() => []))
            .sort((a, b) => (a.position || 0) - (b.position || 0));
    }

    const users = await AppDataStore.getAll('users').catch(() => []);
    const consultantOpts = users
        .filter(u => u.status !== 'inactive')
        .map(u => `<option value="${u.id}" ${existing?.consultant_id == u.id ? 'selected' : ''}>${_cfEscape(u.full_name || u.email)}</option>`)
        .join('');
    const dealerOpts = users
        .filter(u => u.status !== 'inactive')
        .map(u => `<option value="${u.id}" ${existing?.dealer_ea_id == u.id ? 'selected' : ''}>${_cfEscape(u.full_name || u.email)}</option>`)
        .join('');

    const today = new Date().toISOString().slice(0, 10);
    const data = existing || {};

    const satOpts = [
        { v: 5, en: 'Extremely Satisfied', zh: '非常滿意' },
        { v: 4, en: 'Satisfactory',         zh: '滿意' },
        { v: 3, en: 'Average',              zh: '一般' },
        { v: 2, en: 'Unsatisfactory',       zh: '不滿意' },
        { v: 1, en: 'Poor',                 zh: '非常不滿意' }
    ];
    const valueOpts = [
        { v: 5, en: 'Extremely Exceeded',  zh: '最高價值' },
        { v: 4, en: 'High Value',          zh: '高價值' },
        { v: 3, en: 'Adequate',            zh: '值得' },
        { v: 2, en: 'Marginal',            zh: '一般' },
        { v: 1, en: 'Poor',                zh: '低價值' }
    ];
    const knowOpts = [
        { v: 5, en: 'Excellent',      zh: '很好' },
        { v: 4, en: 'Good',           zh: '好' },
        { v: 3, en: 'Average',        zh: '一般' },
        { v: 2, en: 'Below Average',  zh: '不好' },
        { v: 1, en: 'Unacceptable',   zh: '非常不好' }
    ];

    const refRow = (i) => {
        const r = refs[i] || {};
        return `
            <tr>
                <td data-label="NO.">${i + 1}.</td>
                <td data-label="姓名 / NAME"><input type="text" id="cf-apu-ref-name-${i}" value="${_cfEscape(r.name || '')}"></td>
                <td data-label="身份證 / NRIC"><input type="text" id="cf-apu-ref-nric-${i}" value="${_cfEscape(r.nric || '')}"></td>
                <td data-label="電話 / CONTACT"><input type="tel" id="cf-apu-ref-contact-${i}" value="${_cfEscape(r.contact || '')}"></td>
                <td data-label="職業 / OCCUPATION"><input type="text" id="cf-apu-ref-occ-${i}" value="${_cfEscape(r.occupation || '')}"></td>
            </tr>
        `;
    };

    // Paper-style Likert: 5 stacked checkboxes side-by-side with zh on top, en italicized below
    const likertPaper = (name, currentVal, options) => `
        <div class="cf-apu-likert">
            ${options.map(o => `
                <label class="cf-cb cf-cb-stack">
                    <input type="radio" name="${name}" value="${o.v}" ${currentVal === o.v ? 'checked' : ''}>
                    <span class="cf-cb-txt">${o.zh}<br><span class="cf-cb-en">${o.en}</span></span>
                </label>
            `).join('')}
        </div>
    `;

    _rxShowModal(`DC APPRAISAL FORM · ${_cfEscape(prospect.full_name || '')}`, `
        ${_cfPaperStyles()}
        <div class="cf-paper" id="cf-apu-paper">
            <input type="hidden" id="cf-apu-prospect-id" value="${prospect.id}">
            <input type="hidden" id="cf-apu-id" value="${apuId || ''}">

            <div class="cf-paper-head">
                <div>
                    <div class="cf-paper-title-zh">DC 個人風水之析運論勢 <span style="color:#9ca3af;">|</span> 評估表</div>
                    <div class="cf-paper-title-en" style="font-size:14px; margin-top:4px; color:#374151;">DC PERSONAL CHART ANALYSIS <span style="color:#9ca3af;">|</span> APPRAISAL FORM</div>
                </div>
                <div class="cf-paper-brand">
                    <span class="cf-brand-zh">天　命　定　數<sup>®</sup></span>
                    <span class="cf-brand-en">DESTINY CODE</span>
                </div>
            </div>

            <!-- Header info: DATE / CONSULTANT then DEALER/EA / ID / 傳福者 -->
            <div class="cf-paper-info">
                <div class="cf-info-2col">
                    <div class="cf-info-row">
                        <span class="cf-info-lbl"><strong>DATE</strong></span>
                        <input type="date" class="cf-paper-input" id="cf-apu-date" value="${data.appraisal_date || today}">
                    </div>
                    <div class="cf-info-row">
                        <span class="cf-info-lbl"><strong>CONSULTANT</strong></span>
                        <select class="cf-paper-input" id="cf-apu-consultant"><option value="">—</option>${consultantOpts}</select>
                    </div>
                </div>
                <div style="display:grid; grid-template-columns:1fr 1fr 1fr; gap:12px; margin-top:6px;">
                    <div class="cf-info-row" style="grid-template-columns:90px 1fr; border-bottom:none;">
                        <span class="cf-info-lbl"><strong>DEALER / EA</strong></span>
                        <select class="cf-paper-input" id="cf-apu-dealer"><option value="">—</option>${dealerOpts}</select>
                    </div>
                    <div class="cf-info-row" style="grid-template-columns:30px 1fr; border-bottom:none;">
                        <span class="cf-info-lbl"><strong>ID</strong></span>
                        <input type="text" class="cf-paper-input" id="cf-apu-cust-id" value="${_cfEscape(data.customer_identifier || '')}">
                    </div>
                    <div class="cf-info-row" style="grid-template-columns:70px 1fr; border-bottom:none;">
                        <span class="cf-info-lbl"><strong>傳福者</strong></span>
                        <input type="text" class="cf-paper-input" id="cf-apu-referrer" value="${_cfEscape(data.referrer || prospect.referred_by || '')}">
                    </div>
                </div>
            </div>

            <!-- 7 questions -->
            <div class="cf-apu-q">
                <div class="cf-q-line"><span class="cf-q-n">1)</span> 您所得到的個人風水解盤服務,您覺得︰<br><em style="font-size:11px;color:#6b7280;">How do you rate the personal chart analysis service received:</em></div>
                ${likertPaper('q1_service_rating', data.q1_service_rating, satOpts)}
                <div class="cf-apu-reason"><span class="lbl">原因 Reason :</span><input type="text" id="cf-apu-q1-reason" class="cf-line-input" value="${_cfEscape(data.q1_reason || '')}"></div>
            </div>

            <div class="cf-apu-q">
                <div class="cf-q-line"><span class="cf-q-n">2)</span> 您對這位風水顧問的解盤能力及其他表現,您認為︰<br><em style="font-size:11px;color:#6b7280;">Please rate your opinion on the chart analysis ability and overall performance of the Consultant:</em></div>
                ${likertPaper('q2_consultant_rating', data.q2_consultant_rating, satOpts)}
                <div class="cf-apu-reason"><span class="lbl">原因 Reason :</span><input type="text" id="cf-apu-q2-reason" class="cf-line-input" value="${_cfEscape(data.q2_reason || '')}"></div>
            </div>

            <div class="cf-apu-q">
                <div class="cf-q-line"><span class="cf-q-n">3)</span> 您對整個解盤的安排與流程,是否感到︰<br><em style="font-size:11px;color:#6b7280;">Please indicate your level of satisfaction on the arrangement and flow of the chart analysis:</em></div>
                ${likertPaper('q3_arrangement_rating', data.q3_arrangement_rating, satOpts)}
                <div class="cf-apu-reason"><span class="lbl">原因 Reason :</span><input type="text" id="cf-apu-q3-reason" class="cf-line-input" value="${_cfEscape(data.q3_reason || '')}"></div>
            </div>

            <div class="cf-apu-q">
                <div class="cf-q-line"><span class="cf-q-n">4)</span> 雖然這是DC送予的免費個人風水解盤,您認為本服務給您的收獲為︰<br><em style="font-size:11px;color:#6b7280;">This is a complimentary chart analysis service provided by DC, how do you rate the result of the analysis:</em></div>
                ${likertPaper('q4_value_rating', data.q4_value_rating, valueOpts)}
                <div class="cf-apu-reason"><span class="lbl">原因 Reason :</span><input type="text" id="cf-apu-q4-reason" class="cf-line-input" value="${_cfEscape(data.q4_reason || '')}"></div>
            </div>

            <div class="cf-apu-q">
                <div class="cf-q-line"><span class="cf-q-n">5)</span> 您對這位風水顧問有何評價? 包括其對風水知識的理解、分享及解答疑問。<br><em style="font-size:11px;color:#6b7280;">How do you rate the Consultant? Including His/Her knowledge and understanding of Fengshui and responsiveness?</em></div>
                ${likertPaper('q5_knowledge_rating', data.q5_knowledge_rating, knowOpts)}
                <div class="cf-apu-reason"><span class="lbl">原因 Reason :</span><input type="text" id="cf-apu-q5-reason" class="cf-line-input" value="${_cfEscape(data.q5_reason || '')}"></div>
            </div>

            <div class="cf-apu-q">
                <div class="cf-q-line"><span class="cf-q-n">6)</span> 您是否知道,必須有人推薦,方可免費得到DC個人風水高價值解盤服務?<br><em style="font-size:11px;color:#6b7280;">Are you aware that complementary DC Personal Chart Analysis service will only be accorded by referral?</em></div>
                <div class="cf-cb-row" style="margin-top:4px;">
                    <label class="cf-cb cf-cb-stack" style="min-width:60px;"><input type="radio" name="q6_aware_referral" value="true" ${data.q6_aware_referral === true ? 'checked' : ''}><span class="cf-cb-txt">知道<br><span class="cf-cb-en">Yes</span></span></label>
                    <label class="cf-cb cf-cb-stack" style="min-width:60px;"><input type="radio" name="q6_aware_referral" value="false" ${data.q6_aware_referral === false ? 'checked' : ''}><span class="cf-cb-txt">不知道<br><span class="cf-cb-en">No</span></span></label>
                    <div class="cf-apu-reason" style="flex:1; margin-top:0;"><span class="lbl">原因 Reason :</span><input type="text" id="cf-apu-q6-reason" class="cf-line-input" value="${_cfEscape(data.q6_reason || '')}"></div>
                </div>
            </div>

            <div class="cf-apu-q">
                <div class="cf-q-line"><span class="cf-q-n">7)</span> 若您認同DC個人風水解盤服務物有所值,您最想推薦哪三位親友得到此高價值服務?<br><em style="font-size:11px;color:#6b7280;">Whom are the three relatives/friends that you would strongly recommend to receive this high value DC Personal Chart Analysis service?</em></div>
                <table class="cf-apu-ref">
                    <thead>
                        <tr>
                            <th style="width:38px;">NO.</th>
                            <th>姓名 / NAME</th>
                            <th>身份證 / NRIC</th>
                            <th>電話 / CONTACT</th>
                            <th>職業 / OCCUPATION</th>
                        </tr>
                    </thead>
                    <tbody>${[0,1,2].map(refRow).join('')}</tbody>
                </table>
            </div>

            <!-- 3 signatures -->
            <div class="cf-sig-3">
                <div class="cf-paper-sig-block">
                    <canvas id="cf-apu-sig-cust" class="cf-paper-sig-canvas" data-preload="${data.customer_signature_data_url || ''}"></canvas>
                    <div class="cf-paper-sig-cap"><strong>Signature</strong><br>DC CUSTOMER</div>
                    <button type="button" class="cf-mini-btn cf-no-print" onclick="app.cfClearSignature('cf-apu-sig-cust')">Clear</button>
                </div>
                <div class="cf-paper-sig-block">
                    <canvas id="cf-apu-sig-apu" class="cf-paper-sig-canvas" data-preload="${data.apu_signature_data_url || ''}"></canvas>
                    <div class="cf-paper-sig-cap"><strong>Signature</strong><br>DC APU</div>
                    <button type="button" class="cf-mini-btn cf-no-print" onclick="app.cfClearSignature('cf-apu-sig-apu')">Clear</button>
                </div>
                <div class="cf-paper-sig-block">
                    <canvas id="cf-apu-sig-head" class="cf-paper-sig-canvas" data-preload="${data.head_apu_signature_data_url || ''}"></canvas>
                    <div class="cf-paper-sig-cap"><strong>Signature</strong><br>HEAD OF DC APU</div>
                    <button type="button" class="cf-mini-btn cf-no-print" onclick="app.cfClearSignature('cf-apu-sig-head')">Clear</button>
                </div>
            </div>
        </div>
    `, [
        { label: 'Cancel', type: 'secondary', action: 'UI.hideModal()' },
        { label: 'Print', type: 'secondary', action: 'window.print()' },
        { label: 'Save APU', type: 'primary', action: '(async () => { await app.saveApuAppraisal(); })()' }
    ]);

    setTimeout(() => {
        _bindSignaturePad('cf-apu-sig-cust');
        _bindSignaturePad('cf-apu-sig-apu');
        _bindSignaturePad('cf-apu-sig-head');
    }, 60);
};

const saveApuAppraisal = async () => {
    const prospectId = parseInt(document.getElementById('cf-apu-prospect-id')?.value, 10);
    const apuId = document.getElementById('cf-apu-id')?.value || null;
    if (!prospectId) { UI.toast.error('Missing prospect.'); return; }

    const q6Raw = document.querySelector('input[name="q6_aware_referral"]:checked')?.value;
    const q6 = q6Raw == null ? null : q6Raw === 'true';
    const custSig = _getSignatureDataUrl('cf-apu-sig-cust');
    const apuSig  = _getSignatureDataUrl('cf-apu-sig-apu');
    const headSig = _getSignatureDataUrl('cf-apu-sig-head');

    const payload = {
        prospect_id: prospectId,
        appraisal_date: document.getElementById('cf-apu-date')?.value || null,
        consultant_id: parseInt(document.getElementById('cf-apu-consultant')?.value, 10) || null,
        dealer_ea_id: parseInt(document.getElementById('cf-apu-dealer')?.value, 10) || null,
        customer_identifier: document.getElementById('cf-apu-cust-id')?.value?.trim() || null,
        referrer: document.getElementById('cf-apu-referrer')?.value?.trim() || null,
        q1_service_rating: _cfReadLikert('q1_service_rating'),
        q1_reason: document.getElementById('cf-apu-q1-reason')?.value?.trim() || null,
        q2_consultant_rating: _cfReadLikert('q2_consultant_rating'),
        q2_reason: document.getElementById('cf-apu-q2-reason')?.value?.trim() || null,
        q3_arrangement_rating: _cfReadLikert('q3_arrangement_rating'),
        q3_reason: document.getElementById('cf-apu-q3-reason')?.value?.trim() || null,
        q4_value_rating: _cfReadLikert('q4_value_rating'),
        q4_reason: document.getElementById('cf-apu-q4-reason')?.value?.trim() || null,
        q5_knowledge_rating: _cfReadLikert('q5_knowledge_rating'),
        q5_reason: document.getElementById('cf-apu-q5-reason')?.value?.trim() || null,
        q6_aware_referral: q6,
        q6_reason: document.getElementById('cf-apu-q6-reason')?.value?.trim() || null,
        customer_signature_data_url: custSig,
        customer_signed_at: custSig ? new Date().toISOString() : null,
        apu_signature_data_url: apuSig,
        apu_signed_at: apuSig ? new Date().toISOString() : null,
        apu_signed_by: apuSig ? (_state.cu?.id || null) : null,
        head_apu_signature_data_url: headSig,
        head_apu_signed_at: headSig ? new Date().toISOString() : null,
        head_apu_signed_by: headSig ? (_state.cu?.id || null) : null
        // created_by is set only on CREATE (below) so an edit never reassigns the
        // original capturer of the form.
    };

    try {
        let savedId = apuId;
        if (apuId) {
            await AppDataStore.update('apu_appraisals', apuId, payload);
        } else {
            const row = await AppDataStore.create('apu_appraisals', { ...payload, created_by: _state.cu?.id || null, created_at: new Date().toISOString() });
            if (!row?.id) { UI.toast.error('Save failed: record was not created.'); return; }
            savedId = row?.id;
        }

        if (savedId) {
            // L2308 — create-then-delete (was delete-then-create): if a create() threw
            // mid-loop the old delete had already committed, losing the saved referrals.
            // Build + insert the new rows FIRST; only after every create succeeds do we
            // delete the old ones. If any create fails, roll back the new rows so we
            // never leave the appraisal with duplicated (old + partial-new) referrals.
            const existingRefs = await AppDataStore.query('apu_referrals', { appraisal_id: savedId }).catch(() => []);
            const newRows = [];
            for (let i = 0; i < 3; i++) {
                const name = document.getElementById(`cf-apu-ref-name-${i}`)?.value?.trim();
                const nric = document.getElementById(`cf-apu-ref-nric-${i}`)?.value?.trim();
                const contact = document.getElementById(`cf-apu-ref-contact-${i}`)?.value?.trim();
                const occ = document.getElementById(`cf-apu-ref-occ-${i}`)?.value?.trim();
                if (name || nric || contact || occ) {
                    newRows.push({
                        appraisal_id: savedId,
                        position: i + 1,
                        name: name || null,
                        nric: nric || null,
                        contact: contact || null,
                        occupation: occ || null,
                        created_at: new Date().toISOString()
                    });
                }
            }
            const createdIds = [];
            try {
                for (const row of newRows) {
                    const created = await AppDataStore.create('apu_referrals', row);
                    if (created?.id) createdIds.push(created.id);
                }
            } catch (e) {
                // Roll back the partial new inserts; leave the old rows untouched.
                for (const id of createdIds) {
                    try { await AppDataStore.delete('apu_referrals', id); } catch (_) {}
                }
                throw e;
            }
            // All new rows committed — now it's safe to remove the old ones.
            for (const r of existingRefs) {
                try { await AppDataStore.delete('apu_referrals', r.id); } catch (e) { console.error('Failed to delete apu_referral', r.id, e); }
            }
        }

        UI.toast.success(apuId ? 'APU updated.' : 'APU saved.');
        UI.hideModal();
        _cfDataCache = null; // saved data changed — force a fresh fetch on re-render
        const target = document.getElementById('marketing-tab-content');
        if (target && _state.cmt === 'forms') target.innerHTML = await renderFormsTab();
    } catch (err) {
        UI.toast.error('Save failed: ' + (err?.message || err));
    }
};

// =========================================================================
// 4) DESTINY CODE 3-YEAR BLUEPRINT (九運改命藍圖表)
// Sections: 命卦大運 → 成效與需求 → 未來3年運盤 → 行動與結果 → 簽名
// Default 3-year window: 2026–2028 (start_year configurable per-form).
// =========================================================================

// Opens the Blueprint form in-place. We tried opening a separate tab via
// window.open earlier, but tab boundaries don't reliably share the Supabase
// session in production (the new tab landed on the login screen). Modal
// in-place keeps the user inside the authenticated session and reuses the
// same data store cache, so saves are instant.
const openDestinyBlueprintInTab = (prospectId, dbId = null) =>
    openDestinyBlueprintModal(prospectId, dbId);

const openDestinyBlueprintModal = async (prospectId, dbId = null) => {
    const prospect = await AppDataStore.getById('prospects', prospectId).catch(() => null);
    if (!prospect) { UI.toast.error('Prospect not found.'); return; }

    let existing = null;
    if (dbId) existing = await AppDataStore.getById('destiny_blueprints', dbId).catch(() => null);

    const users = await AppDataStore.getAll('users').catch(() => []);
    const userOpts = (selectedId) => users
        .filter(u => u.status !== 'inactive')
        .map(u => `<option value="${u.id}" ${selectedId == u.id ? 'selected' : ''}>${_cfEscape(u.full_name || u.email)}</option>`)
        .join('');

    const today = new Date().toISOString().slice(0, 10);
    const data = existing || {};
    const startYear = data.start_year || 2026;
    const y1 = startYear, y2 = startYear + 1, y3 = startYear + 2;

    _rxShowModal(`九運改命藍圖表 Destiny Code Blueprint · ${_cfEscape(prospect.full_name || '')}`, `
        <style>
            /* ── Destiny Blueprint — paper-form-faithful layout ── */
            .db-form{ font-family: 'Inter', sans-serif; color:#111827; }
            .db-form input[type="text"], .db-form input[type="tel"], .db-form input[type="number"], .db-form input[type="date"], .db-form select, .db-form textarea{
                width:100%; padding:6px 8px; border:1px solid #D1D5DB; border-radius:4px; font-size:13px; font-family:inherit; background:white; box-sizing:border-box;
            }
            .db-form textarea{ resize:vertical; min-height:38px; }

            /* Top branding row */
            .db-brand{
                display:flex; align-items:flex-start; justify-content:space-between;
                border-bottom:1px solid #E5E7EB; padding-bottom:10px; margin-bottom:12px;
            }
            .db-brand-left{ display:flex; flex-direction:column; gap:4px; }
            .db-brand-tag{
                display:inline-block; background:#1E3A8A; color:white; font-size:11px; font-weight:600;
                padding:3px 10px; border-radius:3px; letter-spacing:1px; width:fit-content;
            }
            .db-brand-title{
                background:#1E3A8A; color:white; font-size:18px; font-weight:700;
                padding:6px 14px; border-radius:4px; letter-spacing:2px; width:fit-content;
            }
            .db-brand-right{ text-align:right; font-size:11px; color:#6B7280; letter-spacing:2px; }
            .db-brand-right strong{ font-size:14px; color:#111827; letter-spacing:3px; display:block; }

            /* Header fields row (姓名/聯絡 / 代理/組別) */
            .db-header-grid{ display:grid; grid-template-columns:1fr 1fr; gap:8px 16px; margin-bottom:14px; }
            @media (max-width:600px){ .db-header-grid{ grid-template-columns:1fr; } }
            .db-header-grid .db-cell{ display:flex; align-items:center; gap:8px; }
            .db-header-grid .db-cell label{ font-size:13px; font-weight:600; white-space:nowrap; color:#1F2937; min-width:90px; }

            /* Section header bar (number badge + Chinese title) */
            .db-section-bar{
                display:flex; align-items:center; gap:0; margin:18px 0 8px;
                border:1px solid #1E3A8A; border-radius:4px; overflow:hidden;
            }
            .db-section-num{
                background:#1E3A8A; color:white; font-weight:700; font-size:14px;
                width:30px; text-align:center; padding:6px 0;
            }
            .db-section-title{ background:#1E3A8A; color:white; font-weight:600; font-size:14px; padding:6px 14px; flex:1; }
            .db-section-en{ color:#BFDBFE; font-size:11px; font-weight:400; margin-left:6px; }

            .db-section-hint{ font-size:11px; color:#4B5563; margin:4px 0 8px; padding-left:4px; }

            /* Section 1: 命卦大運 — 4-quadrant grid + score/advice row */
            .db-quadrant{ display:grid; grid-template-columns:1fr 1fr; gap:6px 14px; margin-bottom:8px; }
            @media (max-width:600px){ .db-quadrant{ grid-template-columns:1fr; } }
            .db-quadrant .db-qcell{ display:flex; align-items:center; gap:8px; }
            .db-quadrant .db-qcell label{ font-weight:600; min-width:38px; font-size:13px; color:#1F2937; }
            .db-score-row{ display:flex; align-items:center; gap:14px; flex-wrap:wrap; margin-top:6px; }
            .db-score-row .db-score-wrap{ display:flex; align-items:center; gap:8px; }
            .db-score-row .db-score-wrap label{ font-weight:600; font-size:13px; min-width:38px; }
            .db-score-row .db-score-wrap input{ width:70px; text-align:center; font-weight:700; }
            .db-score-row .db-advice-wrap{ display:flex; align-items:center; gap:8px; flex:1; min-width:200px; }
            .db-score-row .db-advice-wrap label{ font-weight:600; font-size:13px; }

            /* Paper-style tables (sections 2, 3, 4) */
            .db-table{ width:100%; border-collapse:collapse; font-size:13px; }
            .db-table th, .db-table td{ border:1px solid #9CA3AF; padding:6px 8px; vertical-align:middle; }
            .db-table thead th{ background:#F3F4F6; font-weight:600; text-align:center; font-size:12px; color:#1F2937; }
            .db-table th.db-row-label{ background:#F9FAFB; font-weight:700; text-align:center; width:80px; font-size:13px; }
            .db-table td input, .db-table td textarea{ border:none; padding:2px 4px; background:transparent; }
            .db-table td input:focus, .db-table td textarea:focus{ outline:1px solid #1E3A8A; border-radius:2px; }
            .db-year-cell{ background:#F9FAFB; font-weight:700; text-align:center; font-size:14px; }

            .db-advice-block{ margin-top:8px; display:flex; align-items:flex-start; gap:8px; }
            .db-advice-block label{ font-weight:600; font-size:13px; min-width:50px; padding-top:6px; }
            .db-advice-block textarea{ flex:1; }

            /* Footer signature row */
            .db-footer{ display:grid; grid-template-columns:1fr 1fr; gap:24px; margin-top:20px; padding-top:14px; border-top:1px dashed #9CA3AF; }
            @media (max-width:600px){ .db-footer{ grid-template-columns:1fr; } }
            .db-footer .db-sigbox{ display:flex; flex-direction:column; gap:6px; }
            .db-footer .db-sig-label{ font-size:12px; font-weight:700; color:#1F2937; }
            .db-footer .db-sig-name{ font-size:11px; color:#6B7280; }
            .db-footer canvas{ width:100%; height:90px; border:1px solid #9CA3AF; border-radius:4px; background:white; touch-action:none; }
            .db-footer .db-sig-date-row{ display:flex; justify-content:space-between; align-items:center; font-size:11px; color:#4B5563; }
            .db-footer .db-clear{ background:white; border:1px solid #D1D5DB; padding:3px 8px; border-radius:4px; cursor:pointer; font-size:11px; }
            .db-footer .db-clear:hover{ background:#F9FAFB; }

            .db-copyright{ text-align:right; font-size:10px; color:#9CA3AF; margin-top:10px; font-style:italic; }
        </style>

        <div class="db-form">
            <input type="hidden" id="cf-db-prospect-id" value="${prospect.id}">
            <input type="hidden" id="cf-db-id" value="${dbId || ''}">

            <!-- Top branding (matches paper form) -->
            <div class="db-brand">
                <div class="db-brand-left">
                    <span class="db-brand-tag">DC 個人風水</span>
                    <span class="db-brand-title">九運改命藍圖表</span>
                </div>
                <div class="db-brand-right">
                    天 命 定 數
                    <strong>DESTINY CODE</strong>
                </div>
            </div>

            <!-- Header fields: 姓名/聯絡, 代理/組別 -->
            <div class="db-header-grid">
                <div class="db-cell"><label>姓名</label>
                    <input type="text" id="cf-db-name" value="${_cfEscape(data.customer_name || prospect.full_name || '')}">
                </div>
                <div class="db-cell"><label>聯絡號碼</label>
                    <input type="tel" id="cf-db-phone" value="${_cfEscape(data.contact_number || prospect.phone || '')}">
                </div>
                <div class="db-cell"><label>代理</label>
                    <select id="cf-db-agent"><option value="">--</option>${userOpts(data.agent_id)}</select>
                </div>
                <div class="db-cell"><label>組別</label>
                    <input type="text" id="cf-db-group" value="${_cfEscape(data.group_name || '')}">
                </div>
                <div class="db-cell"><label>日期</label>
                    <input type="date" id="cf-db-date" value="${data.form_date || today}">
                </div>
            </div>

            <!-- Section 1: 命卦大運 -->
            <div class="db-section-bar">
                <div class="db-section-num">1</div>
                <div class="db-section-title">命卦大運<span class="db-section-en">Life Trigram Fortune</span></div>
            </div>
            <div class="db-quadrant">
                <div class="db-qcell"><label>吉:</label><textarea id="cf-db-ji" rows="1">${_cfEscape(data.section1_ji || '')}</textarea></div>
                <div class="db-qcell"><label>悔:</label><textarea id="cf-db-hui" rows="1">${_cfEscape(data.section1_hui || '')}</textarea></div>
                <div class="db-qcell"><label>凶:</label><textarea id="cf-db-xiong" rows="1">${_cfEscape(data.section1_xiong || '')}</textarea></div>
                <div class="db-qcell"><label>吝:</label><textarea id="cf-db-lin" rows="1">${_cfEscape(data.section1_lin || '')}</textarea></div>
            </div>
            <div class="db-score-row">
                <div class="db-score-wrap"><label>分數:</label>
                    <input type="number" id="cf-db-score" min="0" max="100" value="${data.section1_score ?? ''}">
                </div>
                <div class="db-advice-wrap"><label>建言:</label>
                    <input type="text" id="cf-db-s1-advice" value="${_cfEscape(data.section1_advice || '')}">
                </div>
            </div>

            <!-- Section 2: 成效與需求 -->
            <div class="db-section-bar">
                <div class="db-section-num">2</div>
                <div class="db-section-title">成效與需求<span class="db-section-en">Effectiveness & Needs</span></div>
            </div>
            <div class="db-section-hint">按命盤解析,已採用之方案</div>
            <table class="db-table">
                <thead>
                    <tr><th colspan="2">現在及未來可能需要之方案</th></tr>
                </thead>
                <tbody>
                    <tr><th class="db-row-label">個人</th><td><input type="text" id="cf-db-s2-personal" value="${_cfEscape(data.section2_personal || '')}"></td></tr>
                    <tr><th class="db-row-label">家居</th><td><input type="text" id="cf-db-s2-home" value="${_cfEscape(data.section2_home || '')}"></td></tr>
                    <tr><th class="db-row-label">工作</th><td><input type="text" id="cf-db-s2-work" value="${_cfEscape(data.section2_work || '')}"></td></tr>
                    <tr><th class="db-row-label">生意</th><td><input type="text" id="cf-db-s2-business" value="${_cfEscape(data.section2_business || '')}"></td></tr>
                    <tr><th class="db-row-label">關係</th><td><input type="text" id="cf-db-s2-relationship" value="${_cfEscape(data.section2_relationship || '')}"></td></tr>
                    <tr><th class="db-row-label">子女</th><td><input type="text" id="cf-db-s2-children" value="${_cfEscape(data.section2_children || '')}"></td></tr>
                </tbody>
            </table>
            <div class="db-advice-block">
                <label>建言:</label>
                <textarea id="cf-db-s2-advice" rows="2">${_cfEscape(data.section2_advice || '')}</textarea>
            </div>

            <!-- Section 3: Future 3-year fortune -->
            <div class="db-section-bar">
                <div class="db-section-num">3</div>
                <div class="db-section-title">未來3年運盤<span class="db-section-en">Future 3-Year Fortune</span></div>
            </div>
            <div style="display:flex; align-items:center; gap:10px; margin-bottom:6px;">
                <label style="font-size:11px; color:#4B5563; font-weight:600;">起始年 Start Year:</label>
                <input type="number" id="cf-db-start-year" min="2024" max="2099" value="${startYear}" style="width:90px; text-align:center;">
            </div>
            <table class="db-table">
                <thead>
                    <tr>
                        <th style="width:80px;">&nbsp;</th>
                        <th>未來3年運盤重大剋應</th>
                        <th>未來3年最想要之藍圖目標</th>
                    </tr>
                </thead>
                <tbody>
                    <tr>
                        <td class="db-year-cell" id="cf-db-y1-label">${y1}</td>
                        <td><input type="text" id="cf-db-y1-event" value="${_cfEscape(data.year_1_event || '')}"></td>
                        <td><input type="text" id="cf-db-y1-goal" value="${_cfEscape(data.year_1_goal || '')}"></td>
                    </tr>
                    <tr>
                        <td class="db-year-cell" id="cf-db-y2-label">${y2}</td>
                        <td><input type="text" id="cf-db-y2-event" value="${_cfEscape(data.year_2_event || '')}"></td>
                        <td><input type="text" id="cf-db-y2-goal" value="${_cfEscape(data.year_2_goal || '')}"></td>
                    </tr>
                    <tr>
                        <td class="db-year-cell" id="cf-db-y3-label">${y3}</td>
                        <td><input type="text" id="cf-db-y3-event" value="${_cfEscape(data.year_3_event || '')}"></td>
                        <td><input type="text" id="cf-db-y3-goal" value="${_cfEscape(data.year_3_goal || '')}"></td>
                    </tr>
                </tbody>
            </table>
            <div class="db-section-hint">*藍圖目標與結果,每年可以是一個,也可以三年是一個,或三年三個皆可。卻不可過多。</div>
            <div class="db-advice-block">
                <label>結論:</label>
                <textarea id="cf-db-s3-conclusion" rows="2">${_cfEscape(data.section3_conclusion || '')}</textarea>
            </div>

            <!-- Section 4: 行動與結果 -->
            <div class="db-section-bar">
                <div class="db-section-num">4</div>
                <div class="db-section-title">行動與結果<span class="db-section-en">Action & Results</span></div>
            </div>
            <table class="db-table">
                <thead>
                    <tr><th colspan="2">面對未來,其藍圖目標可能之結果變化</th></tr>
                </thead>
                <tbody>
                    <tr><th class="db-row-label">得到</th><td><input type="text" id="cf-db-s4-gain" value="${_cfEscape(data.section4_gain || '')}"></td></tr>
                    <tr><th class="db-row-label">損失</th><td><input type="text" id="cf-db-s4-loss" value="${_cfEscape(data.section4_loss || '')}"></td></tr>
                    <tr><th class="db-row-label">保持</th><td><input type="text" id="cf-db-s4-maintain" value="${_cfEscape(data.section4_maintain || '')}"></td></tr>
                    <tr><th class="db-row-label">衰退</th><td><input type="text" id="cf-db-s4-decline" value="${_cfEscape(data.section4_decline || '')}"></td></tr>
                </tbody>
            </table>
            <div class="db-advice-block">
                <label style="min-width:auto;">*把風險降低提高成率的最佳輔助方案或決定是:</label>
                <textarea id="cf-db-s4-best" rows="2">${_cfEscape(data.section4_best_solution || '')}</textarea>
            </div>

            <!-- Footer signatures (customer + consultant) -->
            <div class="db-footer">
                <div class="db-sigbox">
                    <span class="db-sig-label">客戶姓名 Customer</span>
                    <input type="text" id="cf-db-cust-signed-name" placeholder="Customer signed name" value="${_cfEscape(data.customer_signed_name || '')}">
                    <canvas id="cf-db-sig-cust" data-preload="${data.customer_signature_data_url || ''}"></canvas>
                    <div class="db-sig-date-row">
                        <span>日期: ${_cfFmtDate(data.customer_signed_at) || today}</span>
                        <button type="button" class="db-clear" onclick="app.cfClearSignature('cf-db-sig-cust')"><i class="fas fa-eraser"></i> Clear</button>
                    </div>
                </div>
                <div class="db-sigbox">
                    <span class="db-sig-label">顧問姓名 Consultant</span>
                    <select id="cf-db-consultant"><option value="">--</option>${userOpts(data.consultant_id)}</select>
                    <canvas id="cf-db-sig-cons" data-preload="${data.consultant_signature_data_url || ''}"></canvas>
                    <div class="db-sig-date-row">
                        <span>日期: ${_cfFmtDate(data.consultant_signed_at) || today}</span>
                        <button type="button" class="db-clear" onclick="app.cfClearSignature('cf-db-sig-cons')"><i class="fas fa-eraser"></i> Clear</button>
                    </div>
                </div>
            </div>

            <div class="db-copyright">copyright reserved by DESTINY CODE SDN BHD 2024</div>
        </div>
    `, [
        { label: 'Cancel', type: 'secondary', action: 'UI.hideModal()' },
        { label: 'Save Blueprint', type: 'primary', action: '(async () => { await app.saveDestinyBlueprint(); })()' }
    ], 'fullscreen');

    // Bind signature pads + live year-label updates
    setTimeout(() => {
        _bindSignaturePad('cf-db-sig-cust');
        _bindSignaturePad('cf-db-sig-cons');
        const syEl = document.getElementById('cf-db-start-year');
        if (syEl) {
            syEl.addEventListener('input', () => {
                const sy = parseInt(syEl.value, 10);
                if (!sy || sy < 2024 || sy > 2099) return;
                const l1 = document.getElementById('cf-db-y1-label');
                const l2 = document.getElementById('cf-db-y2-label');
                const l3 = document.getElementById('cf-db-y3-label');
                if (l1) l1.textContent = sy;
                if (l2) l2.textContent = sy + 1;
                if (l3) l3.textContent = sy + 2;
            });
        }
    }, 60);
};

const saveDestinyBlueprint = async () => {
    const prospectId = parseInt(document.getElementById('cf-db-prospect-id')?.value, 10);
    const dbId = document.getElementById('cf-db-id')?.value || null;
    if (!prospectId) { UI.toast.error('Missing prospect.'); return; }

    const custSig = _getSignatureDataUrl('cf-db-sig-cust');
    const consSig = _getSignatureDataUrl('cf-db-sig-cons');
    const scoreRaw = document.getElementById('cf-db-score')?.value;
    const startYearRaw = document.getElementById('cf-db-start-year')?.value;

    const payload = {
        prospect_id: prospectId,
        form_date: document.getElementById('cf-db-date')?.value || null,
        customer_name: document.getElementById('cf-db-name')?.value?.trim() || null,
        contact_number: document.getElementById('cf-db-phone')?.value?.trim() || null,
        agent_id: parseInt(document.getElementById('cf-db-agent')?.value, 10) || null,
        group_name: document.getElementById('cf-db-group')?.value?.trim() || null,

        section1_ji: document.getElementById('cf-db-ji')?.value?.trim() || null,
        section1_xiong: document.getElementById('cf-db-xiong')?.value?.trim() || null,
        section1_hui: document.getElementById('cf-db-hui')?.value?.trim() || null,
        section1_lin: document.getElementById('cf-db-lin')?.value?.trim() || null,
        section1_score: scoreRaw === '' || scoreRaw == null ? null : parseInt(scoreRaw, 10),
        section1_advice: document.getElementById('cf-db-s1-advice')?.value?.trim() || null,

        section2_personal: document.getElementById('cf-db-s2-personal')?.value?.trim() || null,
        section2_home: document.getElementById('cf-db-s2-home')?.value?.trim() || null,
        section2_work: document.getElementById('cf-db-s2-work')?.value?.trim() || null,
        section2_business: document.getElementById('cf-db-s2-business')?.value?.trim() || null,
        section2_relationship: document.getElementById('cf-db-s2-relationship')?.value?.trim() || null,
        section2_children: document.getElementById('cf-db-s2-children')?.value?.trim() || null,
        section2_advice: document.getElementById('cf-db-s2-advice')?.value?.trim() || null,

        start_year: startYearRaw ? parseInt(startYearRaw, 10) : 2026,
        year_1_event: document.getElementById('cf-db-y1-event')?.value?.trim() || null,
        year_1_goal: document.getElementById('cf-db-y1-goal')?.value?.trim() || null,
        year_2_event: document.getElementById('cf-db-y2-event')?.value?.trim() || null,
        year_2_goal: document.getElementById('cf-db-y2-goal')?.value?.trim() || null,
        year_3_event: document.getElementById('cf-db-y3-event')?.value?.trim() || null,
        year_3_goal: document.getElementById('cf-db-y3-goal')?.value?.trim() || null,
        section3_conclusion: document.getElementById('cf-db-s3-conclusion')?.value?.trim() || null,

        section4_gain: document.getElementById('cf-db-s4-gain')?.value?.trim() || null,
        section4_loss: document.getElementById('cf-db-s4-loss')?.value?.trim() || null,
        section4_maintain: document.getElementById('cf-db-s4-maintain')?.value?.trim() || null,
        section4_decline: document.getElementById('cf-db-s4-decline')?.value?.trim() || null,
        section4_best_solution: document.getElementById('cf-db-s4-best')?.value?.trim() || null,

        customer_signed_name: document.getElementById('cf-db-cust-signed-name')?.value?.trim() || null,
        customer_signature_data_url: custSig,
        customer_signed_at: custSig ? new Date().toISOString() : null,
        consultant_id: parseInt(document.getElementById('cf-db-consultant')?.value, 10) || null,
        consultant_signature_data_url: consSig,
        consultant_signed_at: consSig ? new Date().toISOString() : null
        // created_by is set only on CREATE (below) so an edit never reassigns the
        // original capturer of the form.
    };

    try {
        if (dbId) {
            await AppDataStore.update('destiny_blueprints', dbId, payload);
            UI.toast.success('Blueprint updated.');
        } else {
            await AppDataStore.create('destiny_blueprints', { ...payload, created_by: _state.cu?.id || null, created_at: new Date().toISOString() });
            UI.toast.success('Blueprint saved.');
        }
        UI.hideModal();
        _cfDataCache = null; // saved data changed — force a fresh fetch on re-render
        const target = document.getElementById('marketing-tab-content');
        if (target && _state.cmt === 'forms') target.innerHTML = await renderFormsTab();
    } catch (err) {
        UI.toast.error('Save failed: ' + (err?.message || err));
    }
};

// #4 — Redeem Fude points modal — REAL redemption-REQUEST flow (no catalog table).
// #8  fix: use `type: 'primary'` (UI.showModal reads btn.type, not btn.class).
// #10 fix: accept pts as a parameter passed from the onclick — avoids fragile DOM
//          scrape that returns 0 if the fude view re-renders before button click.
//
// Points model: a user's 福气 balance is SUM(fudi_points) over their
// `recommendation_rewards` rows (computed in showFudeView as `totalPoints`).
// There is NO rewards-catalog table and NO redemption ledger in the schema, so
// this implements an honest redemption-REQUEST flow: the user picks/enters what
// they want + the points to spend, and we persist a `redemption_requests` record
// (status: pending) for an admin to process out-of-band. The preset reward tiers
// below pre-fill the form but the user may also enter a custom request.
//
// `pts` is the trusted balance passed from the banner onclick; we cache it on a
// module-level var so confirmRedeemPoints can validate the spend against it
// without re-scraping the DOM.
let _fudeRedeemBalance = 0;
const _fudeRedeemPresets = [
    { item: '精选礼品兑换',                cost: 500  },
    { item: '专属顾问咨询（1小时）',        cost: 1000 },
    { item: 'DestinOracles 会员升级',      cost: 2000 },
    { item: '现金抵用券 (RM 50)',          cost: 5000 }
];

const openFudeRedeemModal = (pts = 0) => {
    const bal = Math.max(0, parseInt(pts, 10) || 0);
    _fudeRedeemBalance = bal;

    if (bal <= 0) {
        _rxShowModal('立即兑换福气积分', `
            <div style="font-size:14px;line-height:1.7;">
                <div style="background:#fef3c7;border-left:4px solid #f59e0b;padding:12px 14px;border-radius:6px;">
                    <strong>当前积分：0 福气积分</strong>
                </div>
                <p style="margin-top:14px;color:var(--gray-600,#4b5563);">您当前没有可兑换的福气积分。推荐好友、分享福报即可累积积分。</p>
            </div>
        `, [{ label: '关闭', action: 'UI.hideModal()', type: 'primary' }]);
        return;
    }

    // Preset buttons pre-fill the custom form; affordable ones are highlighted.
    const presetRows = _fudeRedeemPresets.map(p => {
        const affordable = bal >= p.cost;
        return `<button type="button"
            ${affordable ? '' : 'disabled'}
            onclick="app._fudeRedeemPickPreset(${p.cost}, this.dataset.item)"
            data-item="${esc(p.item)}"
            style="display:flex;justify-content:space-between;align-items:center;width:100%;text-align:left;padding:9px 12px;margin-bottom:6px;border:1px solid ${affordable ? '#d1d5db' : '#e5e7eb'};border-radius:6px;background:${affordable ? '#ffffff' : '#f9fafb'};cursor:${affordable ? 'pointer' : 'not-allowed'};opacity:${affordable ? '1' : '0.55'};font-size:13px;">
            <span>${esc(p.item)}</span>
            <span style="font-weight:600;color:${affordable ? '#be185d' : '#9ca3af'};white-space:nowrap;">${p.cost.toLocaleString()} 积分${affordable ? '' : '（积分不足）'}</span>
        </button>`;
    }).join('');

    _rxShowModal('立即兑换福气积分', `
        <div style="font-size:14px;line-height:1.7;">
            <div style="background:#fef3c7;border-left:4px solid #f59e0b;padding:12px 14px;border-radius:6px;margin-bottom:16px;">
                <strong>当前积分：${bal.toLocaleString()} 福气积分</strong>
            </div>
            <p style="margin-bottom:10px;color:var(--gray-600,#4b5563);">选择一项精选奖励，或在下方填写您想兑换的内容。提交后将生成兑换申请，团队会在 3 个工作日内处理。</p>
            <div style="margin-bottom:14px;">${presetRows}</div>
            <div style="margin-bottom:12px;">
                <label for="fude-redeem-item" style="display:block;font-weight:600;margin-bottom:4px;">兑换内容</label>
                <input type="text" id="fude-redeem-item" class="form-control" maxlength="200" placeholder="例如：精选礼品兑换" autocomplete="off">
            </div>
            <div style="margin-bottom:12px;">
                <label for="fude-redeem-points" style="display:block;font-weight:600;margin-bottom:4px;">使用积分（最多 ${bal.toLocaleString()}）</label>
                <input type="number" id="fude-redeem-points" class="form-control" min="1" max="${bal}" step="1" placeholder="输入要使用的积分数">
            </div>
            <div style="margin-bottom:4px;">
                <label for="fude-redeem-note" style="display:block;font-weight:600;margin-bottom:4px;">备注（选填）</label>
                <textarea id="fude-redeem-note" class="form-control" rows="2" maxlength="500" placeholder="送货地址、联系方式或其他说明"></textarea>
            </div>
        </div>
    `, [
        { label: '取消', action: 'UI.hideModal()', type: 'secondary' },
        { label: '提交兑换申请', action: '(async () => { await app.confirmRedeemPoints(); })()', type: 'primary' }
    ]);
};

// Pre-fill the custom form from a preset reward tier.
const _fudeRedeemPickPreset = (cost, item) => {
    const itemEl = document.getElementById('fude-redeem-item');
    const ptsEl  = document.getElementById('fude-redeem-points');
    if (itemEl) itemEl.value = item || '';
    if (ptsEl)  ptsEl.value  = parseInt(cost, 10) || '';
};

// Persist a redemption REQUEST (status pending) for admin processing. No catalog
// table exists, so we do NOT debit points here — the awarding ledger
// (recommendation_rewards) is admin-managed; the admin reconciles on approval.
const confirmRedeemPoints = async () => {
    // L2811 — was `_state.cu || _state.cu` (copy-paste tautology); _state.cu IS the
    // canonical current user, so collapse it to a single reference.
    const user = _state.cu;
    if (!user || !user.id) { UI.toast.error('无法识别当前用户，请重新登录后再试。'); return; }

    // L486/L2823 — the banner-passed balance (_fudeRedeemBalance) is client-trusted
    // and attacker-controllable (e.g. app.openFudeRedeemModal(999999) from the
    // console). Re-derive the user's REAL balance server-side from their own
    // recommendation_rewards rows before accepting the spend, and refuse a new
    // request while one is already pending so concurrent pending claims can't
    // aggregate past the real balance. Full enforcement (debit/escrow + RLS check)
    // is tracked in cross_file_needs; this removes the trivial client-side bypass.
    let bal = Math.max(0, parseInt(_fudeRedeemBalance, 10) || 0);
    const _sbBal = window.supabase || window.supabaseClient;
    if (_sbBal && typeof _sbBal.from === 'function') {
        try {
            const { data: _rwRows, error: _rwErr } = await _sbBal
                .from('recommendation_rewards')
                .select('fudi_points')
                .eq('user_id', user.id);
            if (!_rwErr && Array.isArray(_rwRows)) {
                // Authoritative balance = SUM of the member's own awarded points.
                bal = _rwRows.reduce((s, r) => s + (parseInt(r.fudi_points, 10) || 0), 0);
                _fudeRedeemBalance = bal;
            }
        } catch (_balErr) { /* offline — fall back to the banner value below */ }
    }
    if (bal <= 0) { UI.toast.error('您当前没有可兑换的福气积分。'); return; }

    const item = (document.getElementById('fude-redeem-item')?.value || '').trim();
    const note = (document.getElementById('fude-redeem-note')?.value || '').trim();
    const pts  = parseInt(document.getElementById('fude-redeem-points')?.value, 10);

    if (!item)                       { UI.toast.error('请填写要兑换的内容。'); return; }
    if (!Number.isFinite(pts) || pts <= 0) { UI.toast.error('请输入有效的积分数量。'); return; }
    if (pts > bal)                   { UI.toast.error(`积分不足：当前仅有 ${bal.toLocaleString()} 福气积分。`); return; }

    // Reject a new request while one is still pending — prevents stacking multiple
    // pending claims that each spend up to the full balance.
    if (_sbBal && typeof _sbBal.from === 'function') {
        try {
            const { data: _pendRows, error: _pendErr } = await _sbBal
                .from('redemption_requests')
                .select('id')
                .eq('user_id', user.id)
                .eq('status', 'pending')
                .limit(1);
            if (!_pendErr && Array.isArray(_pendRows) && _pendRows.length > 0) {
                UI.toast.error('您已有一个待审核的兑换申请，请等待处理后再提交新的申请。');
                return;
            }
        } catch (_pendCatch) { /* offline — fall through, copy-to-leader flow handles it */ }
    }

    // FIRST: attempt a GENUINE server insert into redemption_requests. We deliberately
    // bypass AppDataStore.create — its insert path silently falls back to localStorage
    // on a missing table/RLS deny (which would surface a FALSE "submitted" success).
    // Use the raw Supabase client the app exposes (window.supabase, with the
    // window.supabaseClient alias the chunk already uses in saveHighlight).
    const _sb = window.supabase || window.supabaseClient;
    if (_sb && typeof _sb.from === 'function') {
        try {
            const { data: _rows, error: _insErr } = await _sb
                .from('redemption_requests')
                .insert({
                    user_id:           user.id,
                    requester_name:    (user.full_name || user.name || user.email),
                    item:              item,
                    points:            pts,
                    balance_at_request: bal,
                    note:              note || null,
                    status:            'pending'
                })
                .select();
            // SUCCESS = no error AND a row returned. Any error (PGRST205 missing table,
            // RLS deny, network) OR empty result → fall through to the copy-to-leader flow.
            if (!_insErr && Array.isArray(_rows) && _rows.length > 0) {
                UI.hideModal();
                UI.toast.success('兑换申请已提交，等待审核 (Redemption request submitted)');
                return;
            }
        } catch (_serverErr) {
            // network/offline (Failed to fetch) etc. — fall through to fallback below.
        }
    }

    // FALLBACK (table absent / RLS deny / offline / empty): HONEST copy-to-leader flow.
    // Hand the user a formatted request to send to their team leader — no false claim
    // of server submission. Once the redemption_requests migration is applied, the
    // genuine insert above succeeds and this branch is never reached.
    const reqText = [
        '福气积分兑换申请 / FuQi Points Redemption Request',
        '姓名 Name: ' + (user.full_name || user.name || user.email || user.id),
        '兑换内容 Item: ' + item,
        '使用积分 Points: ' + pts,
        '当前余额 Balance: ' + bal,
        note ? ('备注 Note: ' + note) : ''
    ].filter(Boolean).join('\n');
    try {
        if (navigator.clipboard && navigator.clipboard.writeText) {
            await navigator.clipboard.writeText(reqText);
            UI.hideModal();
            UI.toast.success('兑换详情已复制 — 请发送给您的团队负责人处理。(Details copied — send to your team leader to redeem.)');
        } else {
            UI.hideModal();
            UI.showModal('福气积分兑换申请', '<p>请将以下内容发送给您的团队负责人处理：</p><pre style="white-space:pre-wrap;background:var(--surface-2,#f5f5f5);padding:12px;border-radius:8px;">' + esc(reqText) + '</pre>', [{ label: '好的 OK', type: 'primary', action: 'UI.hideModal()' }]);
        }
    } catch (err) {
        UI.toast.error('操作失败：' + (err?.message || '未知错误'));
    }
};

// ========== ADMIN: 福气 Redemption Queue ==========
// Admin-only queue to process redemption_requests rows. Reads via the raw Supabase
// client (genuine server read, never AppDataStore — which masks a missing table).
// If the table is absent / read errors → friendly "not provisioned" card, never crash.
const _fudeRedeemStatusBadge = (status) => {
    const s = String(status || 'pending').toLowerCase();
    const map = {
        pending:   { label: '待审核 Pending',   bg: '#fef3c7', col: '#92400e' },
        approved:  { label: '已批准 Approved',  bg: '#dbeafe', col: '#1e40af' },
        fulfilled: { label: '已兑现 Fulfilled', bg: '#d1fae5', col: '#065f46' },
        rejected:  { label: '已拒绝 Rejected',  bg: '#fee2e2', col: '#991b1b' }
    };
    const m = map[s] || { label: esc(status || '-'), bg: '#f3f4f6', col: '#6b7280' };
    return `<span style="padding:2px 8px;border-radius:12px;font-size:0.78rem;background:${m.bg};color:${m.col};white-space:nowrap;">${m.label}</span>`;
};

const _fudeRedeemFmtDate = (d) => { try { return new Date(d).toLocaleString(); } catch (e) { return esc(d || '-'); } };

const showRedemptionQueue = async () => {
    // Admin gate — mirror the canonical fude admin gate (L1 Super Admin || L2 Marketing Manager).
    if (!(isSystemAdmin() || isMarketingManager())) {
        UI.toast.error('仅管理员可访问兑换队列。(Admins only.)');
        return;
    }

    UI.showModal('福气 兑换队列 (Redemption Queue)', '<div style="display:flex;align-items:center;justify-content:center;height:120px;gap:10px;color:var(--gray-400,#9ca3af);"><i class="fas fa-circle-notch fa-spin"></i><span>加载中… Loading…</span></div>', [
        { label: '关闭 Close', type: 'secondary', action: 'UI.hideModal()' }
    ]);

    const sb = window.supabase || window.supabaseClient;
    let rows = null;
    if (sb && typeof sb.from === 'function') {
        try {
            // L2919 — fetch ONLY the columns this queue renders; do NOT select('*').
            // The free-text `note` (delivery address / phone) and balance_at_request
            // are PII the queue never displays, so they must not be pulled to the
            // client. Server-side scope hardening (own-row-or-admin RLS SELECT) is
            // tracked in cross_file_needs — the JS gate above is not a trust boundary.
            // Pending first, then newest first within each status group.
            const { data, error } = await sb
                .from('redemption_requests')
                .select('id, item, points, requester_name, user_id, status, created_at')
                .order('status', { ascending: true })
                .order('created_at', { ascending: false });
            if (!error && Array.isArray(data)) rows = data;
        } catch (_readErr) {
            rows = null; // network/offline → treat as not provisioned
        }
    }

    // Table absent / read error / no client → friendly card, never crash.
    if (rows === null) {
        const html = `<div style="font-size:14px;line-height:1.7;">
            <div style="background:#f3f4f6;border-left:4px solid #9ca3af;padding:14px 16px;border-radius:8px;">
                <div style="font-weight:600;margin-bottom:4px;">兑换队列尚未启用 (queue not provisioned yet)</div>
                <div style="color:var(--gray-600,#4b5563);">redemption_requests 数据表尚未创建或当前不可读取。应用迁移后此队列将自动启用。在此之前，会员的兑换申请通过复制给团队负责人处理。</div>
            </div>
        </div>`;
        UI.showModal('福气 兑换队列 (Redemption Queue)', html, [
            { label: '关闭 Close', type: 'primary', action: 'UI.hideModal()' }
        ]);
        return;
    }

    // Sort: pending first, then newest first (defensive — DB order may vary).
    const _rank = (s) => (String(s || 'pending').toLowerCase() === 'pending' ? 0 : 1);
    // L2944 — coerce created_at safely: a null/invalid date yields NaN from Date
    // subtraction, which makes the comparator return NaN (inconsistent/undefined
    // ordering, can throw under strict comparator validation). Map unparseable
    // dates to 0 so the tiebreaker is always a finite number.
    const _ts = (d) => { const n = Date.parse(d); return Number.isFinite(n) ? n : 0; };
    rows.sort((a, b) => (_rank(a.status) - _rank(b.status)) || (_ts(b.created_at) - _ts(a.created_at)));

    let body;
    if (!rows.length) {
        body = '<div style="text-align:center;color:var(--gray-400,#9ca3af);padding:24px;">暂无兑换申请。(No redemption requests yet.)</div>';
    } else {
        const rowsHtml = rows.map(r => {
            const st = String(r.status || 'pending').toLowerCase();
            // Pass the id as a SINGLE-quoted, attribute-escaped JS string literal so
            // it works for both integer (bigserial) and uuid PKs — JSON.stringify on a
            // uuid emits double quotes that would terminate the double-quoted onclick
            // attribute. .eq('id', id) accepts a string for either column type.
            const id = esc(String(r.id));
            const actions = st === 'pending'
                ? `<button class="btn primary btn-sm" onclick="event.stopPropagation();app.redemptionApprove('${id}')"><i class="fas fa-check"></i> 批准 Approve</button>
                   <button class="btn danger btn-sm" style="margin-left:4px;" onclick="event.stopPropagation();app.redemptionReject('${id}')"><i class="fas fa-times"></i> 拒绝 Reject</button>`
                : st === 'approved'
                    ? `<button class="btn primary btn-sm" onclick="event.stopPropagation();app.redemptionFulfil('${id}')"><i class="fas fa-gift"></i> 兑现 Fulfil</button>
                       <button class="btn danger btn-sm" style="margin-left:4px;" onclick="event.stopPropagation();app.redemptionReject('${id}')"><i class="fas fa-times"></i> 拒绝 Reject</button>`
                    : `<span style="color:var(--gray-400,#9ca3af);font-size:0.82rem;">已完成 Done</span>`;
            return `<tr>
                <td style="max-width:200px;overflow:hidden;text-overflow:ellipsis;">${esc(r.item || '-')}</td>
                <td style="white-space:nowrap;font-weight:600;">${esc(String(r.points != null ? r.points : '-'))}</td>
                <td>${esc(r.requester_name || ('User ' + (r.user_id != null ? r.user_id : '?')))}</td>
                <td>${_fudeRedeemStatusBadge(r.status)}</td>
                <td style="white-space:nowrap;">${_fudeRedeemFmtDate(r.created_at)}</td>
                <td style="white-space:nowrap;">${actions}</td>
            </tr>`;
        }).join('');
        body = `<div style="overflow-x:auto;"><table class="data-table"><thead><tr>
            <th scope="col">兑换内容 Item</th><th scope="col">积分 Points</th><th scope="col">申请人 Requester</th>
            <th scope="col">状态 Status</th><th scope="col">提交时间 Created</th><th scope="col">操作 Actions</th>
        </tr></thead><tbody>${rowsHtml}</tbody></table></div>`;
    }

    UI.showModal('福气 兑换队列 (Redemption Queue)', `<div style="font-size:14px;">${body}</div>`, [
        { label: '关闭 Close', type: 'primary', action: 'UI.hideModal()' }
    ], 'large');
};

// Shared status-update helper for the redemption queue. Genuine server UPDATE via the
// raw client; re-renders the queue on success. Admin-gated (defence in depth).
const _redemptionUpdateStatus = async (id, status, okMsg) => {
    if (!(isSystemAdmin() || isMarketingManager())) {
        UI.toast.error('仅管理员可操作。(Admins only.)');
        return;
    }
    const sb = window.supabase || window.supabaseClient;
    if (!sb || typeof sb.from !== 'function') {
        UI.toast.error('未连接服务器，无法更新。(Not connected.)');
        return;
    }
    try {
        const { data, error } = await sb
            .from('redemption_requests')
            .update({ status })
            .eq('id', id)
            .select();
        if (error || !Array.isArray(data) || data.length === 0) {
            UI.toast.error('更新失败：' + ((error && error.message) || '未找到记录'));
            return;
        }
        UI.toast.success(okMsg);
        await showRedemptionQueue(); // re-render with fresh data
    } catch (err) {
        UI.toast.error('更新失败：' + (err?.message || '未知错误'));
    }
};

const redemptionApprove = (id) => _redemptionUpdateStatus(id, 'approved',  '已批准 (Approved)');
const redemptionReject  = (id) => _redemptionUpdateStatus(id, 'rejected',  '已拒绝 (Rejected)');
const redemptionFulfil  = (id) => _redemptionUpdateStatus(id, 'fulfilled', '已兑现 (Fulfilled)');

const fudeSearchStories = (query) => {
    const section = document.querySelector('.fude-stories-section');
    if (!section) return;
    const q = query.trim().toLowerCase();
    const cards = section.querySelectorAll('.fude-story-card');
    const moreBtn = section.querySelector('.fude-stories-more-btn');
    const chips = section.querySelectorAll('.fude-story-filter-chip');
    if (!q) {
        chips.forEach(c => c.classList.toggle('active', c.dataset.tag === '*'));
        cards.forEach(c => c.classList.toggle('fude-story-card--hidden', c.dataset.overflow === '1'));
        if (moreBtn) moreBtn.style.display = '';
        return;
    }
    chips.forEach(c => c.classList.remove('active'));
    if (moreBtn) moreBtn.style.display = 'none';
    cards.forEach(c => {
        const title   = (c.querySelector('h3')?.textContent || '').toLowerCase();
        const excerpt = (c.querySelector('p')?.textContent  || '').toLowerCase();
        const tags    = (c.dataset.tags || '').toLowerCase();
        c.classList.toggle('fude-story-card--hidden', !title.includes(q) && !excerpt.includes(q) && !tags.includes(q));
    });
};

const fudeFilterStories = (tag) => {
    const section = document.querySelector('.fude-stories-section');
    if (!section) return;
    const cards   = section.querySelectorAll('.fude-story-card');
    const moreBtn = section.querySelector('.fude-stories-more-btn');
    const chips   = section.querySelectorAll('.fude-story-filter-chip');
    const searchInput = section.querySelector('.fude-story-search-input');
    if (searchInput) searchInput.value = '';          // clear search when chip clicked
    chips.forEach(c => c.classList.toggle('active', c.dataset.tag === tag));
    if (tag === '*') {
        cards.forEach(c => c.classList.toggle('fude-story-card--hidden', c.dataset.overflow === '1'));
        if (moreBtn) moreBtn.style.display = '';
    } else {
        const lowerTag = tag.toLowerCase();
        cards.forEach(c => {
            const tags = (c.dataset.tags || '').split('|').filter(Boolean);
            c.classList.toggle('fude-story-card--hidden', !tags.includes(lowerTag));
        });
        if (moreBtn) moreBtn.style.display = 'none';
    }
};

const fudeShowAllStories = () => {
    const section = document.querySelector('.fude-stories-section');
    if (!section) return;
    section.querySelectorAll('.fude-story-card').forEach(c => c.classList.remove('fude-story-card--hidden'));
    const moreBtn = section.querySelector('.fude-stories-more-btn');
    if (moreBtn) moreBtn.style.display = 'none';
    const chips = section.querySelectorAll('.fude-story-filter-chip');
    chips.forEach(c => c.classList.toggle('active', c.dataset.tag === '*'));
    const searchInput = section.querySelector('.fude-story-search-input');
    if (searchInput) searchInput.value = '';          // clear search when Explore More clicked
};

    app.register('fude', {
        showFudeView,
        openStoryDetail,
        fudeSearchStories,
        fudeFilterStories,
        fudeShowAllStories,
        openHighlightModal,
        saveHighlight,
        deleteHighlight,
        confirmDeleteHighlight,
        syncFudiSummary,
        openRewardModal,
        saveReward,
        deleteReward,
        confirmDeleteReward,
        showRoadmap,
        exportRelationshipTree,
        // changeLeaderboardPeriod intentionally NOT registered here: this chunk's
        // copy called an out-of-scope renderLeaderboard() (ReferenceError). The
        // working implementation lives in script-referrals.js (renderLeaderboard is
        // in scope there) and is registered from that chunk; app.register is
        // last-loader-wins, so registering a broken copy here would clobber it
        // whenever the fude chunk loads after referrals.
        uploadProspectDocument,
        submitRecruitmentApproval,
        deleteFile,
        _confirmDeleteFile,
        showProfile,
        exportKPIDashboard,
        _bindSignaturePad,
        _clearSignaturePad,
        cfClearSignature,
        _getSignatureDataUrl,
        _cfFmtDate,
        _cfEscape,
        renderFormsTab,
        cfSearchProspects,
        _cfLikertHtml,
        _cfReadLikert,
        _cfPaperStyles,
        openCustomerSurveyModal,
        saveCustomerSurvey,
        _cfBaguaHtml,
        _cfReadBagua,
        openCpsAnalysisModal,
        saveCpsAnalysis,
        openApuAppraisalModal,
        saveApuAppraisal,
        openDestinyBlueprintInTab,
        openDestinyBlueprintModal,
        saveDestinyBlueprint,
        openFudeRedeemModal,
        _fudeRedeemPickPreset,
        confirmRedeemPoints,
        showRedemptionQueue,
        redemptionApprove,
        redemptionReject,
        redemptionFulfil,
    });
})();