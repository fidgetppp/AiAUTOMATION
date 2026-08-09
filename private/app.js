/* --------------------------------------------------
 * Kalyan Property Consultants - Controller Script
 * Handles: Nav, Polling, REST API Integration, Rendering
 * -------------------------------------------------- */

document.addEventListener('DOMContentLoaded', () => {
    // Intercept fetch calls to handle 401 Unauthorized
    const originalFetch = window.fetch;
    window.fetch = async function (...args) {
        const response = await originalFetch(...args);
        if (response.status === 401) {
            window.location.href = '/login';
        }
        return response;
    };

    // State Variables
    let properties = [];
    let inquiries = [];
    let settings = {};
    let whatsappStatus = 'disconnected';
    let currentCategoryFilter = 'All';

    // Elements
    const navItems = document.querySelectorAll('.nav-item');
    const screenPanels = document.querySelectorAll('.screen-panel');
    const currentPageTitle = document.getElementById('current-page-title');

    // Status Indicators
    const waIndicatorDot = document.querySelector('#wa-connection-status .status-dot');
    const waIndicatorText = document.querySelector('#wa-connection-status .status-text');
    const waConnectionBadge = document.getElementById('wa-connection-badge');
    const groqIndicatorDot = document.querySelector('#groq-api-status .status-dot');
    const groqIndicatorText = document.querySelector('#groq-api-status .status-text');

    // Stats Elements
    const statRevenue = document.getElementById('stat-revenue'); // Used for Total Leads count
    const statOrdersCount = document.getElementById('stat-orders'); // Used for Active Listings count
    const statPendingCount = document.getElementById('stat-pending'); // Used for Scheduled Visits count
    const statChatsCount = document.getElementById('stat-chats'); // Used for Closed Deals count
    const ordersBadge = document.getElementById('orders-count-badge'); // Sidebar badge for active leads

    // QR Panel Elements
    const qrPlaceholder = document.getElementById('wa-qr-code-placeholder');
    const qrImageContainer = document.getElementById('wa-qr-code-image');
    const qrImg = document.getElementById('qr-img');
    const qrExpiredOverlay = document.getElementById('qr-expired-overlay');
    const waConnectedState = document.getElementById('wa-connected-state');
    const waConnectedDetails = document.getElementById('wa-connected-details');
    const btnRefreshQr = document.getElementById('btn-refresh-qr');
    const btnWaLogout = document.getElementById('btn-wa-logout');

    // Inquiries Panel Elements
    const pendingOrdersList = document.getElementById('pending-orders-list');
    const historyOrdersList = document.getElementById('history-orders-list');
    const countPendingOrders = document.getElementById('count-pending-orders');
    const countHistoryOrders = document.getElementById('count-history-orders');

    // Properties Panel Elements
    const menuGrid = document.getElementById('menu-items-grid');
    const filterButtons = document.querySelectorAll('.filter-btn');
    const btnAddItem = document.getElementById('btn-add-item');

    // Modal Elements
    const menuModal = document.getElementById('menu-modal');
    const menuItemForm = document.getElementById('menu-item-form');
    const modalTitle = document.getElementById('modal-title');
    const menuItemId = document.getElementById('menu-item-id');
    const menuItemName = document.getElementById('menu-item-name');
    const menuItemPrice = document.getElementById('menu-item-price');
    const menuItemPriceDisplay = document.getElementById('menu-item-price-display');
    const menuItemCategory = document.getElementById('menu-item-category');
    const menuItemCarpet = document.getElementById('menu-item-carpet');
    const menuItemLocality = document.getElementById('menu-item-locality');
    const menuItemLandmark = document.getElementById('menu-item-landmark');
    const menuItemStatus = document.getElementById('menu-item-status');
    const menuItemImage = document.getElementById('menu-item-image');
    const menuItemDesc = document.getElementById('menu-item-desc');
    const menuItemAvailable = document.getElementById('menu-item-available');
    const btnCloseModal = document.getElementById('btn-close-modal');
    const btnCancelModal = document.getElementById('btn-cancel-modal');

    // Settings Panel Elements
    const settingsForm = document.getElementById('settings-form');
    const settingRestroName = document.getElementById('setting-restro-name');
    const settingOwnerPhone = document.getElementById('setting-owner-phone');
    const settingGroqKey = document.getElementById('setting-groq-key');
    const settingPersonalitySelect = document.getElementById('setting-personality-select');
    const settingBotPrompt = document.getElementById('setting-bot-prompt');
    const settingAutoReply = document.getElementById('setting-auto-reply');
    const topbarAutoReplyToggle = document.getElementById('topbar-auto-reply-toggle');
    const autoReplyStatusText = document.getElementById('auto-reply-status-text');
    const groqKeyStatusText = document.getElementById('groq-key-status-text');

    // Toast Container
    const toastContainer = document.getElementById('toast-container');

    // --------------------------------------------------
    // HTML Escape Helper
    function escapeHtml(str) {
        if (!str) return '';
        return String(str)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    }

    // --------------------------------------------------
    // 1. Navigation & Routing
    // --------------------------------------------------
    function initNavigation() {
        const handleHashChange = () => {
            const hash = window.location.hash || '#dashboard';
            const targetId = `screen-${hash.replace('#', '')}`;
            const targetPanel = document.getElementById(targetId);

            if (targetPanel) {
                // Update active sidebar nav
                navItems.forEach(item => {
                    if (item.getAttribute('href') === hash) {
                        item.classList.add('active');
                    } else {
                        item.classList.remove('active');
                    }
                });

                // Update panel visibility
                screenPanels.forEach(panel => {
                    panel.classList.remove('active');
                });
                targetPanel.classList.add('active');

                // Update page header title
                let title = 'Dashboard';
                if (hash === '#orders') title = 'Inquiries & Leads';
                if (hash === '#menu') title = 'Properties Portfolio';
                if (hash === '#chats') {
                    title = 'WhatsApp Live Chat & Contacts';
                    loadWhatsAppChats();
                    startChatPolling();
                } else {
                    stopChatPolling();
                }
                if (hash === '#settings') title = 'Settings';
                if (hash === '#accuracy') {
                    title = 'AI Accuracy Evaluation Board';
                    loadAccuracyBoard();
                }
                currentPageTitle.textContent = title;
            }
        };

        // Accuracy Board renderer
        async function loadAccuracyBoard() {
            const listContainer = document.getElementById('accuracy-logs-list');
            const scorePct = document.getElementById('accuracy-score-pct');
            const totalRated = document.getElementById('accuracy-total-rated');

            try {
                const res = await fetch('/api/accuracy');
                const data = await res.json();

                if (scorePct) scorePct.textContent = `${data.score}%`;
                if (totalRated) totalRated.textContent = data.totalRated;

                if (!listContainer) return;

                if (!data.logs || data.logs.length === 0) {
                    listContainer.innerHTML = `
                        <tr>
                            <td colspan="6" style="text-align: center; padding: 40px; color: var(--color-text-muted);">
                                No evaluation logs found. Auto-replies will appear here as they occur.
                            </td>
                        </tr>
                    `;
                    return;
                }

                listContainer.innerHTML = data.logs.map(log => {
                    const dateStr = new Date(log.timestamp).toLocaleString();
                    let statusBadge = '';
                    if (log.status === 'accurate') {
                        statusBadge = '<span style="background: rgba(16, 185, 129, 0.1); color: #10b981; padding: 4px 8px; border-radius: 4px; font-size: 0.75rem; font-weight: 600;">Accurate</span>';
                    } else if (log.status === 'inaccurate') {
                        statusBadge = '<span style="background: rgba(239, 68, 68, 0.1); color: #ef4444; padding: 4px 8px; border-radius: 4px; font-size: 0.75rem; font-weight: 600;">Inaccurate</span>';
                    } else {
                        statusBadge = '<span style="background: rgba(245, 158, 11, 0.1); color: #f59e0b; padding: 4px 8px; border-radius: 4px; font-size: 0.75rem; font-weight: 600;">Pending</span>';
                    }

                    const ratingButtons = `
                        <div style="display: flex; gap: 8px; justify-content: center;">
                            <button class="btn btn-sm btn-rate" data-id="${log.id}" data-status="accurate" style="background: ${log.status === 'accurate' ? '#10b981' : 'rgba(255,255,255,0.05)'}; color: ${log.status === 'accurate' ? '#fff' : 'var(--color-text-muted)'}; border: 1px solid rgba(255,255,255,0.1); padding: 4px 8px; border-radius: 4px; cursor: pointer; display: flex; align-items: center; justify-content: center;">
                                👍
                            </button>
                            <button class="btn btn-sm btn-rate" data-id="${log.id}" data-status="inaccurate" style="background: ${log.status === 'inaccurate' ? '#ef4444' : 'rgba(255,255,255,0.05)'}; color: ${log.status === 'inaccurate' ? '#fff' : 'var(--color-text-muted)'}; border: 1px solid rgba(255,255,255,0.1); padding: 4px 8px; border-radius: 4px; cursor: pointer; display: flex; align-items: center; justify-content: center;">
                                👎
                            </button>
                        </div>
                    `;

                    return `
                        <tr style="border-bottom: 1px solid rgba(255,255,255,0.05); transition: background 0.2s;">
                            <td style="padding: 14px 16px; font-size: 0.8rem; color: var(--color-text-muted);">${dateStr}</td>
                            <td style="padding: 14px 16px; color: #fff;">
                                <strong>${escapeHtml(log.contactName)}</strong>
                                <div style="font-size: 0.75rem; color: var(--color-text-muted); margin-top: 2px;">+${log.contact}</div>
                            </td>
                            <td style="padding: 14px 16px; color: #fff; max-width: 250px; word-break: break-word; line-height: 1.4;">${escapeHtml(log.query)}</td>
                            <td style="padding: 14px 16px; color: #fff; max-width: 250px; word-break: break-word; line-height: 1.4;">${escapeHtml(log.reply).replace(/\n/g, '<br>')}</td>
                            <td style="padding: 14px 16px; text-align: center;">${statusBadge}</td>
                            <td style="padding: 14px 16px; text-align: center;">${ratingButtons}</td>
                        </tr>
                    `;
                }).join('');

                // Register event listeners for evaluation rating buttons
                listContainer.querySelectorAll('.btn-rate').forEach(btn => {
                    btn.addEventListener('click', async (e) => {
                        e.preventDefault();
                        const logId = btn.getAttribute('data-id');
                        const status = btn.getAttribute('data-status');
                        
                        try {
                            const rateRes = await fetch(`/api/accuracy/${logId}/rate`, {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({ status })
                            });
                            if (rateRes.ok) {
                                showToast(`AI Reply rated as ${status === 'accurate' ? 'Accurate 👍' : 'Inaccurate 👎'}`, 'success');
                                loadAccuracyBoard(); // Refresh board
                            } else {
                                showToast('Failed to rate the reply.', 'danger');
                            }
                        } catch (err) {
                            console.error('Error submitting rating:', err);
                            showToast('Technical error rating reply.', 'danger');
                        }
                    });
                });

            } catch (err) {
                console.error('Failed to load accuracy logs:', err);
                showToast('Failed to load evaluation logs.', 'danger');
            }
        }

        window.addEventListener('hashchange', handleHashChange);
        handleHashChange(); // Trigger on initial load
    }

    /* --------------------------------------------------
     * 2. API Fetch Requests
     * -------------------------------------------------- */

    // Fetch WhatsApp Status (Polled)
    async function checkWhatsAppStatus() {
        try {
            const res = await fetch('/api/status');
            const data = await res.json();

            whatsappStatus = data.status;

            // Update Header Bar Indicators
            if (whatsappStatus === 'ready') {
                waIndicatorDot.className = 'status-dot green';
                waIndicatorText.textContent = 'WhatsApp Online';
                waConnectionBadge.className = 'badge btn-success';
                waConnectionBadge.textContent = 'Ready';
            } else if (whatsappStatus === 'qr') {
                waIndicatorDot.className = 'status-dot yellow pulse';
                waIndicatorText.textContent = 'WhatsApp Setup Needed';
                waConnectionBadge.className = 'badge btn-primary';
                waConnectionBadge.textContent = 'QR Scanning';
            } else if (whatsappStatus === 'connecting') {
                waIndicatorDot.className = 'status-dot yellow pulse';
                waIndicatorText.textContent = 'WhatsApp Connecting...';
                waConnectionBadge.className = 'badge btn-secondary';
                waConnectionBadge.textContent = 'Connecting';
            } else {
                waIndicatorDot.className = 'status-dot red pulse';
                waIndicatorText.textContent = 'WhatsApp Offline';
                waConnectionBadge.className = 'badge btn-danger';
                waConnectionBadge.textContent = 'Offline';
            }

            // Update Panel QR Code / Success Container
            if (whatsappStatus === 'ready') {
                qrPlaceholder.classList.remove('active');
                qrImageContainer.classList.remove('active');
                waConnectedState.classList.add('active');
                if (data.user) {
                    waConnectedDetails.textContent = `Linked to: ${data.user.pushname || 'Kalyan Property Consultants Bot'} (${data.user.wid.user})`;
                } else {
                    waConnectedDetails.textContent = 'Linked successfully to WhatsApp.';
                }
            } else if (whatsappStatus === 'qr' && data.qr) {
                qrPlaceholder.classList.remove('active');
                waConnectedState.classList.remove('active');
                qrImageContainer.classList.add('active');
                qrImg.src = data.qr;
                qrExpiredOverlay.classList.remove('active');
            } else if (whatsappStatus === 'connecting') {
                waConnectedState.classList.remove('active');
                qrImageContainer.classList.remove('active');
                qrPlaceholder.classList.add('active');
                qrPlaceholder.querySelector('p').textContent = 'Connecting to WhatsApp Web...';
            } else {
                waConnectedState.classList.remove('active');
                qrImageContainer.classList.remove('active');
                qrPlaceholder.classList.add('active');
                qrPlaceholder.querySelector('p').textContent = 'Waiting for WhatsApp backend initialization...';
            }

        } catch (err) {
            console.error('Failed to fetch WhatsApp status:', err);
        }
    }

    // Fetch and Render Property listings
    async function loadProperties() {
        try {
            const res = await fetch('/api/properties');
            properties = await res.json();
            renderPropertiesGrid();
        } catch (err) {
            console.error('Failed to load properties:', err);
            showToast('Error loading properties portfolio.', 'danger');
        }
    }

    // Fetch and Render Inquiries
    async function loadInquiries() {
        try {
            const res = await fetch('/api/inquiries');
            inquiries = await res.json();
            renderInquiriesFeed();
            updateDashboardStats();
        } catch (err) {
            console.error('Failed to load inquiries:', err);
            showToast('Error loading inquiries feed.', 'danger');
        }
    }

    // Fetch and Load Settings Form
    async function loadSettings() {
        try {
            const res = await fetch('/api/settings');
            settings = await res.json();

            settingRestroName.value = settings.businessName || '';
            settingOwnerPhone.value = settings.ownerNumber || '';
            
            if (settingPersonalitySelect) {
                settingPersonalitySelect.value = settings.activePersonality || 'kalyan';
            }
            const activePers = settings.activePersonality || 'kalyan';
            settingBotPrompt.value = activePers === 'tanmay' ? (settings.tanmayPrompt || '') : (settings.kalyanPrompt || '');

            const isAutoReplyOn = settings.autoReplyEnabled === true;
            if (settingAutoReply) settingAutoReply.checked = isAutoReplyOn;
            if (topbarAutoReplyToggle) topbarAutoReplyToggle.checked = isAutoReplyOn;
            if (autoReplyStatusText) {
                autoReplyStatusText.textContent = isAutoReplyOn ? 'AI Auto-Reply: ON' : 'AI Auto-Reply: OFF';
                autoReplyStatusText.style.color = isAutoReplyOn ? '#10b981' : '#f43f5e';
            }

            // Update Groq Status Badge
            if (settings.hasApiKey) {
                groqIndicatorDot.className = 'status-dot green';
                groqIndicatorText.textContent = 'Groq API Active';
                groqKeyStatusText.textContent = 'Status: API Key Active (Masked for security)';
                groqKeyStatusText.style.color = '#10b981';
            } else {
                groqIndicatorDot.className = 'status-dot red';
                groqIndicatorText.textContent = 'Groq API Inactive';
                groqKeyStatusText.textContent = 'Status: API Key is MISSING. Please configure it below.';
                groqKeyStatusText.style.color = '#f43f5e';
            }
        } catch (err) {
            console.error('Failed to load settings:', err);
            showToast('Error loading configurations.', 'danger');
        }
    }

    // Dynamic dropdown & input syncing to store temporary updates
    if (settingPersonalitySelect) {
        settingPersonalitySelect.addEventListener('change', (e) => {
            const selected = e.target.value;
            if (selected === 'tanmay') {
                settingBotPrompt.value = settings.tanmayPrompt || '';
            } else {
                settingBotPrompt.value = settings.kalyanPrompt || '';
            }
        });
    }

    if (settingBotPrompt) {
        settingBotPrompt.addEventListener('input', () => {
            const active = settingPersonalitySelect ? settingPersonalitySelect.value : 'kalyan';
            if (active === 'tanmay') {
                settings.tanmayPrompt = settingBotPrompt.value;
            } else {
                settings.kalyanPrompt = settingBotPrompt.value;
            }
        });
    }

    /* --------------------------------------------------
     * 3. UI Rendering Helpers
     * -------------------------------------------------- */

    // Render Properties Grid based on active category filter
    function renderPropertiesGrid() {
        menuGrid.innerHTML = '';
        const filtered = currentCategoryFilter === 'All'
            ? properties
            : properties.filter(p => p.type === currentCategoryFilter);

        if (filtered.length === 0) {
            menuGrid.innerHTML = `<div class="empty-state span-2" style="grid-column: 1 / -1;">No property listings found in this category.</div>`;
            return;
        }

        filtered.forEach(p => {
            const card = document.createElement('div');
            card.className = `glass-card menu-card ${!p.available ? 'out-of-stock' : ''}`;

            const cardOpacity = p.available ? '' : 'style="opacity: 0.65;"';
            const imgSrc = p.image || 'https://images.unsplash.com/photo-1564013799919-ab600027ffc6?auto=format&fit=crop&w=400&q=80';

            card.innerHTML = `
                <div class="property-card-image" style="background-image: url('${imgSrc}'); height: 160px; background-size: cover; background-position: center; border-radius: var(--radius-md) var(--radius-md) 0 0; margin: -16px -16px var(--space-md) -16px; ${!p.available ? 'opacity:0.65;' : ''}"></div>
                <div class="menu-card-top" ${cardOpacity}>
                    <div class="menu-card-header">
                        <span class="menu-card-category" style="background-color:var(--color-primary-glow);color:var(--color-primary);border:1px solid rgba(204,164,59,0.3);padding:3px 8px;border-radius:4px;font-size:11px;">${p.type}</span>
                        <span class="menu-card-price" style="color:var(--color-primary);font-weight:700;font-size:16px;">${p.priceDisplay}</span>
                    </div>
                    <h5 class="menu-card-name" style="margin-top:var(--space-sm);font-size:16px;font-weight:600;">${p.title}</h5>
                    <div class="property-meta-tags" style="display:flex;flex-wrap:wrap;gap:var(--space-xs);margin:var(--space-xs) 0 var(--space-sm) 0;">
                        <span style="font-size:11px;background-color:rgba(255,255,255,0.05);padding:2px 6px;border-radius:3px;color:var(--color-text-muted);">📍 ${p.locality}</span>
                        <span style="font-size:11px;background-color:rgba(255,255,255,0.05);padding:2px 6px;border-radius:3px;color:var(--color-text-muted);">📐 ${p.carpetArea}</span>
                        <span style="font-size:11px;background-color:rgba(255,255,255,0.05);padding:2px 6px;border-radius:3px;color:var(--color-text-muted);">🏗️ ${p.status}</span>
                    </div>
                    <p class="menu-card-desc" style="font-size:12px;color:var(--color-text-muted);">${p.description}</p>
                    <small style="color:var(--color-text-subtle);font-size:11px;display:block;margin-top:var(--space-xs);">Landmark: ${p.landmark}</small>
                </div>
                <div class="menu-card-footer" style="margin-top:var(--space-md);border-top:1px solid var(--color-border-card);padding-top:var(--space-sm);display:flex;justify-content:space-between;align-items:center;">
                    <label class="toggle-switch-wrapper">
                        <div class="toggle-switch">
                            <input type="checkbox" class="toggle-item-availability" data-id="${p.id}" ${p.available ? 'checked' : ''}>
                            <span class="slider"></span>
                        </div>
                        <span class="toggle-label" style="font-size:11px;margin-left:var(--space-xs);">${p.available ? 'Active Listing' : 'Sold Out/Leased'}</span>
                    </label>
                    
                    <div class="menu-card-actions" style="display:flex;gap:var(--space-xs);">
                        <button class="btn-ghost-edit" data-id="${p.id}" title="Edit Listing" style="background:none;border:none;cursor:pointer;color:var(--color-text-muted);padding:var(--space-xs);border-radius:4px;transition:color 0.2s;">
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:16px;height:16px;"><path d="M12 20h9M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>
                        </button>
                        <button class="btn-ghost-delete" data-id="${p.id}" title="Delete Listing" style="background:none;border:none;cursor:pointer;color:var(--color-danger);padding:var(--space-xs);border-radius:4px;transition:color 0.2s;">
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:16px;height:16px;"><path d="M3 6h18M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/></svg>
                        </button>
                    </div>
                </div>
            `;
            menuGrid.appendChild(card);
        });

        // Add Event Listeners to cards
        document.querySelectorAll('.toggle-item-availability').forEach(toggle => {
            toggle.addEventListener('change', handleAvailabilityToggle);
        });

        document.querySelectorAll('.btn-ghost-edit').forEach(btn => {
            btn.addEventListener('click', openEditItemModal);
        });

        document.querySelectorAll('.btn-ghost-delete').forEach(btn => {
            btn.addEventListener('click', handleDeleteMenuItem);
        });
    }

    // Render Inquiries Feed (split by Pending/Active vs Closed/Cancelled)
    function renderInquiriesFeed() {
        pendingOrdersList.innerHTML = '';
        historyOrdersList.innerHTML = '';

        const pending = inquiries.filter(i => i.status === 'Pending' || i.status === 'Contacted' || i.status === 'Site-Visit Scheduled');
        const history = inquiries.filter(i => i.status === 'Closed Won' || i.status === 'Cancelled');

        countPendingOrders.textContent = pending.length;
        countHistoryOrders.textContent = history.length;

        // Update sidebar header badge
        const activeLeads = inquiries.filter(i => i.status === 'Pending' || i.status === 'Site-Visit Scheduled');
        if (activeLeads.length > 0) {
            ordersBadge.textContent = activeLeads.length;
            ordersBadge.style.display = 'inline-block';
        } else {
            ordersBadge.style.display = 'none';
        }

        if (pending.length === 0) {
            pendingOrdersList.innerHTML = `<div class="empty-state">No pending inquiries.</div>`;
        } else {
            pending.forEach(inquiry => {
                pendingOrdersList.appendChild(createInquiryCard(inquiry));
            });
        }

        if (history.length === 0) {
            historyOrdersList.innerHTML = `<div class="empty-state">No past inquiries.</div>`;
        } else {
            history.forEach(inquiry => {
                historyOrdersList.appendChild(createInquiryCard(inquiry));
            });
        }

        // Add action button listeners
        document.querySelectorAll('.btn-inq-status').forEach(btn => {
            btn.addEventListener('click', () => updateInquiryStatus(btn.dataset.id, btn.dataset.status));
        });

        document.querySelectorAll('.btn-save-notes').forEach(btn => {
            btn.addEventListener('click', () => saveInquiryNotes(btn.dataset.id));
        });
    }

    // Helper to generate a single inquiry/lead DOM element
    function createInquiryCard(inquiry) {
        const card = document.createElement('div');
        card.className = 'order-card';

        const inqDate = new Date(inquiry.date).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) + ' - ' + new Date(inquiry.date).toLocaleDateString();

        // Generate status badge
        let statusBadge = '';
        if (inquiry.status === 'Pending') {
            statusBadge = `<span class="badge yellow" style="background-color:rgba(234,179,8,0.1);color:#eab308;margin-left:0;">New Lead</span>`;
        } else if (inquiry.status === 'Contacted') {
            statusBadge = `<span class="badge blue" style="background-color:rgba(59,130,246,0.1);color:#3b82f6;margin-left:0;">Contacted</span>`;
        } else if (inquiry.status === 'Site-Visit Scheduled') {
            statusBadge = `<span class="badge purple" style="background-color:rgba(139,92,246,0.1);color:#8b5cf6;margin-left:0;">Site Visit Scheduled</span>`;
        } else if (inquiry.status === 'Closed Won') {
            statusBadge = `<span class="badge green" style="background-color:rgba(16,185,129,0.1);color:#10b981;margin-left:0;">Deal Closed</span>`;
        } else {
            statusBadge = `<span class="badge red" style="background-color:rgba(244,63,94,0.1);color:#f43f5e;margin-left:0;">Cancelled</span>`;
        }

        // Action buttons based on status
        let actionButtons = '';
        if (inquiry.status === 'Pending') {
            actionButtons = `
                <div class="order-actions" style="margin-top:var(--space-md);display:flex;gap:var(--space-sm);">
                    <button class="btn btn-secondary btn-sm btn-inq-status" data-id="${inquiry.id}" data-status="Cancelled">Cancel</button>
                    <button class="btn btn-primary btn-sm btn-inq-status" data-id="${inquiry.id}" data-status="Contacted">Mark Contacted</button>
                    <button class="btn btn-success btn-sm btn-inq-status" data-id="${inquiry.id}" data-status="Site-Visit Scheduled">Schedule Site Visit</button>
                </div>
            `;
        } else if (inquiry.status === 'Contacted' || inquiry.status === 'Site-Visit Scheduled') {
            actionButtons = `
                <div class="order-actions" style="margin-top:var(--space-md);display:flex;gap:var(--space-sm);">
                    <button class="btn btn-secondary btn-sm btn-inq-status" data-id="${inquiry.id}" data-status="Cancelled">Cancel Lead</button>
                    <button class="btn btn-success btn-sm btn-inq-status" data-id="${inquiry.id}" data-status="Closed Won">Close Deal (Won)</button>
                </div>
            `;
        }

        // Notes section
        const notesValue = inquiry.notes || '';

        card.innerHTML = `
            <div class="order-header">
                <div>
                    <span class="order-id">#${inquiry.id.replace('inq_', '')}</span>
                    <span class="order-time">${inqDate}</span>
                </div>
                <div style="display:flex;gap:var(--space-xs);align-items:center;">
                    <span class="badge" style="background-color:rgba(204,164,59,0.08);color:var(--color-primary);font-size:11px;margin-left:0;">🏠 ${inquiry.inquiryType}</span>
                    ${statusBadge}
                </div>
            </div>
            <div class="order-customer" style="margin:var(--space-sm) 0 var(--space-xs) 0;font-size:14px;">
                Client: <strong>${inquiry.customerName}</strong> (${inquiry.customerPhone})
            </div>
            <div class="order-details-text" style="font-size:13px;background:rgba(255,255,255,0.02);padding:var(--space-sm);border-radius:6px;border:1px solid var(--color-border-card);color:var(--color-text-main);margin-bottom:var(--space-sm);">
                <strong>Interested in:</strong> ${inquiry.propertyTitle}<br>
                <strong>Message/Requirements:</strong> ${inquiry.message}
            </div>
            
            <div class="inquiry-notes-section" style="margin-top:var(--space-sm);display:flex;flex-direction:column;gap:var(--space-xs);">
                <label style="font-size:10px;text-transform:uppercase;color:var(--color-text-subtle);font-weight:600;">Consultant Activity Notes</label>
                <div style="display:flex;gap:var(--space-xs);">
                    <input type="text" id="notes-${inquiry.id}" class="input-control" style="padding:6px 10px;font-size:12px;background:var(--color-bg-base);border:1px solid var(--color-border-card);border-radius:4px;flex:1;" placeholder="Add details from client call..." value="${notesValue}">
                    <button class="btn btn-primary btn-sm btn-save-notes" data-id="${inquiry.id}" style="padding:6px 12px;font-size:11px;border-radius:4px;">Save</button>
                </div>
            </div>
            ${actionButtons}
        `;

        return card;
    }

    // Update real estate stats on Dashboard
    function updateDashboardStats() {
        statRevenue.textContent = inquiries.length; // Total leads
        statOrdersCount.textContent = properties.length; // Active listings

        const scheduled = inquiries.filter(i => i.status === 'Site-Visit Scheduled').length;
        statPendingCount.textContent = scheduled; // Scheduled visits

        const closed = inquiries.filter(i => i.status === 'Closed Won').length;
        statChatsCount.textContent = closed; // Closed deals
    }

    /* --------------------------------------------------
     * 4. Actions & Event Handlers
     * -------------------------------------------------- */

    // Toggle item availability via slider switch
    async function handleAvailabilityToggle(e) {
        const propId = e.target.dataset.id;
        const available = e.target.checked;

        const p = properties.find(i => i.id === propId);
        if (p) {
            p.available = available;

            try {
                const res = await fetch('/api/properties', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(properties)
                });

                if (res.ok) {
                    showToast(`"${p.title}" status updated.`, 'success');
                    renderPropertiesGrid();
                } else {
                    showToast('Failed to update property status.', 'danger');
                    e.target.checked = !available; // revert UI
                }
            } catch (err) {
                console.error(err);
                showToast('API Connection Error.', 'danger');
                e.target.checked = !available;
            }
        }
    }

    // Category Filter Buttons
    filterButtons.forEach(btn => {
        btn.addEventListener('click', (e) => {
            filterButtons.forEach(b => b.classList.remove('active'));
            e.target.classList.add('active');
            currentCategoryFilter = e.target.dataset.category;
            renderPropertiesGrid();
        });
    });

    // Update inquiry status
    async function updateInquiryStatus(inqId, newStatus) {
        try {
            const res = await fetch(`/api/inquiries/${inqId}/status`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ status: newStatus })
            });

            if (res.ok) {
                showToast(`Inquiry status updated to ${newStatus}!`, 'success');
                loadInquiries(); // reload and redraw
            } else {
                showToast('Failed to update status.', 'danger');
            }
        } catch (err) {
            console.error(err);
            showToast('API Connection Error.', 'danger');
        }
    }

    // Save Inquiry consultant notes
    async function saveInquiryNotes(inqId) {
        const notesInput = document.getElementById(`notes-${inqId}`);
        const notesText = notesInput.value.trim();

        try {
            const res = await fetch(`/api/inquiries/${inqId}/notes`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ notes: notesText })
            });

            if (res.ok) {
                showToast('Consultant activity notes saved!', 'success');
                loadInquiries();
            } else {
                showToast('Failed to save notes.', 'danger');
            }
        } catch (err) {
            console.error(err);
            showToast('API Connection Error.', 'danger');
        }
    }

    // Settings form submission
    settingsForm.addEventListener('submit', async (e) => {
        e.preventDefault();

        const activePers = settingPersonalitySelect ? settingPersonalitySelect.value : 'kalyan';
        const payload = {
            businessName: settingRestroName.value,
            ownerNumber: settingOwnerPhone.value,
            activePersonality: activePers,
            kalyanPrompt: activePers === 'kalyan' ? settingBotPrompt.value : (settings.kalyanPrompt || ''),
            tanmayPrompt: activePers === 'tanmay' ? settingBotPrompt.value : (settings.tanmayPrompt || ''),
            autoReplyEnabled: settingAutoReply ? settingAutoReply.checked : false
        };

        if (settingGroqKey.value.trim() !== '') {
            payload.apiKey = settingGroqKey.value.trim();
        }

        try {
            const res = await fetch('/api/settings', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });

            if (res.ok) {
                showToast('Configurations saved successfully!', 'success');
                settingGroqKey.value = ''; // clear input
                loadSettings(); // refresh display
            } else {
                showToast('Failed to save settings.', 'danger');
            }
        } catch (err) {
            console.error(err);
            showToast('API Connection Error.', 'danger');
        }
    });

    // Sync and save auto-reply state from topbar toggle immediately
    if (topbarAutoReplyToggle) {
        topbarAutoReplyToggle.addEventListener('change', async () => {
            const isChecked = topbarAutoReplyToggle.checked;
            if (settingAutoReply) settingAutoReply.checked = isChecked;
            
            // Send quick update to server
            try {
                const res = await fetch('/api/settings', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ autoReplyEnabled: isChecked })
                });
                if (res.ok) {
                    showToast(isChecked ? 'AI Auto-Reply enabled!' : 'AI Auto-Reply disabled!', 'success');
                    loadSettings(); // refresh display values
                } else {
                    showToast('Failed to update Auto-Reply state.', 'danger');
                    topbarAutoReplyToggle.checked = !isChecked; // revert
                    if (settingAutoReply) settingAutoReply.checked = !isChecked;
                }
            } catch (err) {
                console.error(err);
                showToast('API Connection Error.', 'danger');
                topbarAutoReplyToggle.checked = !isChecked; // revert
                if (settingAutoReply) settingAutoReply.checked = !isChecked;
            }
        });
    }

    if (settingAutoReply) {
        settingAutoReply.addEventListener('change', () => {
            if (topbarAutoReplyToggle) topbarAutoReplyToggle.checked = settingAutoReply.checked;
        });
    }

    /* --------------------------------------------------
     * 5. Add / Edit Property Modal Logic
     * -------------------------------------------------- */

    // Open for creation
    btnAddItem.addEventListener('click', () => {
        modalTitle.textContent = 'Add Property Listing';
        menuItemId.value = '';
        menuItemForm.reset();
        menuItemAvailable.checked = true;
        const imageUploadStatus = document.getElementById('image-upload-status');
        const propertyImageFile = document.getElementById('property-image-file');
        if (imageUploadStatus) imageUploadStatus.textContent = '';
        if (propertyImageFile) propertyImageFile.value = '';
        menuModal.classList.add('active');
    });

    // Open for edit
    function openEditItemModal(e) {
        const id = e.currentTarget.dataset.id;
        const p = properties.find(i => i.id === id);
        if (p) {
            modalTitle.textContent = 'Edit Property Listing';
            menuItemId.value = p.id;
            menuItemName.value = p.title;
            menuItemPrice.value = p.price;
            menuItemPriceDisplay.value = p.priceDisplay || '';
            menuItemCategory.value = p.type;
            menuItemCarpet.value = p.carpetArea || '';
            menuItemLocality.value = p.locality || '';
            menuItemLandmark.value = p.landmark || '';
            menuItemStatus.value = p.status || 'Ready to Move';
            menuItemImage.value = p.image || '';
            menuItemDesc.value = p.description;
            menuItemAvailable.checked = p.available;
            const imageUploadStatus = document.getElementById('image-upload-status');
            const propertyImageFile = document.getElementById('property-image-file');
            if (imageUploadStatus) imageUploadStatus.textContent = '';
            if (propertyImageFile) propertyImageFile.value = '';
            menuModal.classList.add('active');
        }
    }

    // File Upload Handler for Property Images
    const propertyImageFile = document.getElementById('property-image-file');
    const imageUploadStatus = document.getElementById('image-upload-status');

    if (propertyImageFile) {
        propertyImageFile.addEventListener('change', async (e) => {
            const file = e.target.files[0];
            if (!file) return;

            if (imageUploadStatus) imageUploadStatus.textContent = 'Uploading...';

            const reader = new FileReader();
            reader.onload = async (event) => {
                const fileData = event.target.result;
                try {
                    const res = await fetch('/api/upload', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ filename: file.name, fileData: fileData })
                    });
                    if (res.ok) {
                        const data = await res.json();
                        menuItemImage.value = data.url;
                        if (imageUploadStatus) imageUploadStatus.textContent = 'Uploaded successfully!';
                        showToast('Image uploaded successfully!', 'success');
                    } else {
                        if (imageUploadStatus) imageUploadStatus.textContent = 'Upload failed.';
                        showToast('Image upload failed.', 'danger');
                    }
                } catch (err) {
                    console.error(err);
                    if (imageUploadStatus) imageUploadStatus.textContent = 'Upload failed.';
                    showToast('Connection error uploading image.', 'danger');
                }
            };
            reader.readAsDataURL(file);
        });
    }

    // Close Modal
    const closeModal = () => {
        menuModal.classList.remove('active');
    };

    btnCloseModal.addEventListener('click', closeModal);
    btnCancelModal.addEventListener('click', closeModal);

    // Close on click outside modal content card
    menuModal.addEventListener('click', (e) => {
        if (e.target === menuModal) {
            closeModal();
        }
    });

    // Modal submit handler
    menuItemForm.addEventListener('submit', async (e) => {
        e.preventDefault();

        const id = menuItemId.value;
        const payload = {
            title: menuItemName.value,
            price: parseFloat(menuItemPrice.value),
            priceDisplay: menuItemPriceDisplay.value,
            type: menuItemCategory.value,
            carpetArea: menuItemCarpet.value,
            locality: menuItemLocality.value,
            landmark: menuItemLandmark.value,
            status: menuItemStatus.value,
            image: menuItemImage.value,
            description: menuItemDesc.value,
            available: menuItemAvailable.checked
        };

        if (id) {
            // Edit Mode
            const index = properties.findIndex(i => i.id === id);
            if (index !== -1) {
                properties[index] = { ...properties[index], ...payload };
            }
        } else {
            // Add Mode
            payload.id = 'prop_' + Date.now();
            properties.push(payload);
        }

        // Save properties array to server
        try {
            const res = await fetch('/api/properties', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(properties)
            });

            if (res.ok) {
                showToast(id ? 'Property listing updated!' : 'New property listing added!', 'success');
                closeModal();
                loadProperties();
            } else {
                showToast('Failed to save property listing.', 'danger');
            }
        } catch (err) {
            console.error(err);
            showToast('API Connection Error.', 'danger');
        }
    });

    // Delete property handler
    async function handleDeleteMenuItem(e) {
        const id = e.currentTarget.dataset.id;
        const p = properties.find(i => i.id === id);
        if (!p) return;

        if (confirm(`Are you sure you want to delete "${p.title}" from the properties portfolio?`)) {
            properties = properties.filter(i => i.id !== id);
            try {
                const res = await fetch('/api/properties', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(properties)
                });

                if (res.ok) {
                    showToast('Property listing deleted successfully.', 'success');
                    loadProperties();
                } else {
                    showToast('Failed to delete property listing.', 'danger');
                }
            } catch (err) {
                console.error(err);
                showToast('API Connection Error.', 'danger');
            }
        }
    }

    /* --------------------------------------------------
     * 6. Notification Toasts
     * -------------------------------------------------- */
    function showToast(message, type = 'success') {
        const toast = document.createElement('div');
        toast.className = `toast ${type}`;

        let icon = '';
        if (type === 'success') {
            icon = `<svg viewBox="0 0 24 24" fill="none" stroke="#10b981" stroke-width="2" style="width:20px;height:20px;"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><path d="m22 4-10 10.01-3-3"/></svg>`;
        } else if (type === 'danger') {
            icon = `<svg viewBox="0 0 24 24" fill="none" stroke="#f43f5e" stroke-width="2" style="width:20px;height:20px;"><circle cx="12" cy="12" r="10"/><path d="m15 9-6 6M9 9l6 6"/></svg>`;
        } else {
            icon = `<svg viewBox="0 0 24 24" fill="none" stroke="#eab308" stroke-width="2" style="width:20px;height:20px;"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/><path d="M12 9v4M12 17h.01"/></svg>`;
        }

        toast.innerHTML = `
            ${icon}
            <span>${message}</span>
        `;
        toastContainer.appendChild(toast);

        setTimeout(() => {
            toast.remove();
        }, 5000);
    }

    // Unlink WhatsApp account
    btnWaLogout.addEventListener('click', async () => {
        if (confirm('Are you sure you want to unlink and log out this WhatsApp bot? This will disconnect the assistant.')) {
            try {
                const res = await fetch('/api/logout', { method: 'POST' });
                if (res.ok) {
                    showToast('WhatsApp unlinked. Generating new QR code...', 'success');
                    checkWhatsAppStatus();
                } else {
                    const data = await res.json();
                    showToast(data.error || 'Failed to unlink.', 'danger');
                }
            } catch (err) {
                console.error(err);
                showToast('API Connection Error.', 'danger');
            }
        }
    });

    // Admin Dashboard logout handler
    const logoutBtn = document.getElementById('nav-logout');
    if (logoutBtn) {
        logoutBtn.addEventListener('click', async (e) => {
            e.preventDefault();
            if (confirm('Are you sure you want to log out from the admin dashboard?')) {
                try {
                    const res = await fetch('/api/admin/logout', { method: 'POST' });
                    if (res.ok) {
                        window.location.href = '/login';
                    } else {
                        showToast('Failed to log out.', 'danger');
                    }
                } catch (err) {
                    console.error(err);
                    showToast('Connection error during logout.', 'danger');
                }
            }
        });
    }

    /* --------------------------------------------------
     * 6.5. WhatsApp Live Chat & Contact Controller
     * -------------------------------------------------- */
    let chatList = [];
    let activeChatId = null;
    let chatFilter = 'all';
    let chatSearchQuery = '';
    let chatPollingInterval = null;

    const chatContactsList = document.getElementById('chat-contacts-list');
    const chatSearchInput = document.getElementById('chat-search-input');
    const chatFilterTabs = document.querySelectorAll('.chat-filter-tab');
    const chatsCountBadge = document.getElementById('chats-count-badge');
    const chatEmptyState = document.getElementById('chat-empty-state');
    const chatActiveWrapper = document.getElementById('chat-active-wrapper');
    const activeChatAvatar = document.getElementById('active-chat-avatar');
    const activeChatName = document.getElementById('active-chat-name');
    const activeChatNumber = document.getElementById('active-chat-number');
    const chatMessagesFeed = document.getElementById('chat-messages-feed');
    const chatComposerForm = document.getElementById('chat-composer-form');
    const chatMessageInput = document.getElementById('chat-message-input');

    async function loadWhatsAppChats() {
        try {
            const res = await fetch('/api/whatsapp/chats');
            const data = await res.json();

            if (data.status !== 'ready') {
                if (chatContactsList) {
                    chatContactsList.innerHTML = `
                        <div class="chat-disconnected-msg">
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m2 2 20 20"/><path d="M17.5 17.5A8.38 8.38 0 0 1 12 19.5a8.5 8.5 0 0 1-7.6-4.7 8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6"/></svg>
                            <h5>WhatsApp Disconnected</h5>
                            <p>Please scan the QR code on the Dashboard screen to sync contacts and live chats.</p>
                        </div>
                    `;
                }
                return;
            }

            chatList = data.chats || [];

            const totalUnread = chatList.reduce((acc, c) => acc + (c.unreadCount || 0), 0);
            if (chatsCountBadge) {
                if (totalUnread > 0) {
                    chatsCountBadge.textContent = totalUnread;
                    chatsCountBadge.style.display = 'inline-flex';
                } else {
                    chatsCountBadge.style.display = 'none';
                }
            }

            renderChatList();

            if (activeChatId) {
                fetchActiveChatMessages(activeChatId, false);
            }
        } catch (err) {
            console.error('Error loading WhatsApp chats:', err);
        }
    }

    function renderChatList() {
        if (!chatContactsList) return;

        let filtered = chatList.filter(c => {
            const matchesQuery = !chatSearchQuery ||
                (c.name && c.name.toLowerCase().includes(chatSearchQuery.toLowerCase())) ||
                (c.number && c.number.includes(chatSearchQuery));
            const matchesFilter = chatFilter === 'all' || (chatFilter === 'unread' && c.unreadCount > 0);
            return matchesQuery && matchesFilter;
        });

        if (filtered.length === 0) {
            chatContactsList.innerHTML = `
                <div class="chat-empty-list">
                    <p>No chats found${chatSearchQuery ? ' matching "' + escapeHtml(chatSearchQuery) + '"' : ''}.</p>
                </div>
            `;
            return;
        }

        chatContactsList.innerHTML = filtered.map(c => {
            const isActive = c.id === activeChatId ? 'active' : '';
            const initial = c.name ? c.name.charAt(0).toUpperCase() : '?';
            const avatarHtml = c.avatar
                ? `<img src="${c.avatar}" class="chat-item-avatar-img" alt="${escapeHtml(c.name)}">`
                : `<div class="chat-item-avatar-initial">${initial}</div>`;

            let timeStr = '';
            if (c.timestamp) {
                const date = new Date(c.timestamp);
                const isToday = new Date().toDateString() === date.toDateString();
                timeStr = isToday
                    ? date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
                    : date.toLocaleDateString([], { month: 'short', day: 'numeric' });
            }

            const lastMsgText = c.lastMessage ? c.lastMessage.body : 'No messages yet';

            return `
                <div class="chat-item ${isActive}" data-chat-id="${c.id}">
                    <div class="chat-item-avatar">
                        ${avatarHtml}
                    </div>
                    <div class="chat-item-info">
                        <div class="chat-item-top">
                            <h5 class="chat-item-name">${escapeHtml(c.name)}</h5>
                            <span class="chat-item-time">${timeStr}</span>
                        </div>
                        <div class="chat-item-bottom">
                            <p class="chat-item-snippet">${escapeHtml(lastMsgText)}</p>
                            ${c.unreadCount > 0 ? `<span class="chat-unread-badge">${c.unreadCount}</span>` : ''}
                        </div>
                    </div>
                </div>
            `;
        }).join('');

        chatContactsList.querySelectorAll('.chat-item').forEach(item => {
            item.addEventListener('click', () => {
                const id = item.getAttribute('data-chat-id');
                selectChat(id);
            });
        });
    }

    async function selectChat(chatId) {
        activeChatId = chatId;
        renderChatList();

        if (chatEmptyState) chatEmptyState.style.display = 'none';
        if (chatActiveWrapper) chatActiveWrapper.style.display = 'flex';

        const chatObj = chatList.find(c => c.id === chatId);
        if (chatObj) {
            if (activeChatName) activeChatName.textContent = chatObj.name;
            if (activeChatNumber) activeChatNumber.textContent = `+${chatObj.number}`;
            if (activeChatAvatar) {
                if (chatObj.avatar) {
                    activeChatAvatar.innerHTML = `<img src="${chatObj.avatar}" alt="${escapeHtml(chatObj.name)}">`;
                } else {
                    activeChatAvatar.textContent = chatObj.name ? chatObj.name.charAt(0).toUpperCase() : '?';
                }
            }
        }

        await fetchActiveChatMessages(chatId, true);
    }

    async function fetchActiveChatMessages(chatId, shouldScroll = false) {
        if (!chatId || activeChatId !== chatId) return;

        try {
            const res = await fetch(`/api/whatsapp/chats/${encodeURIComponent(chatId)}/messages`);
            if (!res.ok) return;

            const data = await res.json();
            const messages = data.messages || [];

            // Update active chat header dynamically with fresh data (including avatar)
            if (data.chat) {
                if (activeChatName) activeChatName.textContent = data.chat.name;
                if (activeChatNumber) activeChatNumber.textContent = `+${data.chat.number}`;
                if (activeChatAvatar) {
                    if (data.chat.avatar) {
                        activeChatAvatar.innerHTML = `<img src="${data.chat.avatar}" alt="${escapeHtml(data.chat.name)}" class="chat-item-avatar-img">`;
                    } else {
                        const initial = data.chat.name ? data.chat.name.charAt(0).toUpperCase() : '?';
                        activeChatAvatar.innerHTML = `<div class="chat-item-avatar-initial" style="width:100%;height:100%;display:flex;align-items:center;justify-content:center;background:var(--color-primary-glow);color:var(--color-primary);font-weight:600;">${initial}</div>`;
                    }
                }
            }

            if (chatMessagesFeed) {
                const wasAtBottom = chatMessagesFeed.scrollHeight - chatMessagesFeed.clientHeight <= chatMessagesFeed.scrollTop + 50;

                chatMessagesFeed.innerHTML = messages.map(m => {
                    const bubbleClass = m.fromMe ? 'outgoing' : 'incoming';
                    const timeStr = m.timestamp
                        ? new Date(m.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
                        : '';

                    return `
                        <div class="chat-message-bubble ${bubbleClass}">
                            <div class="chat-bubble-content">
                                <p>${escapeHtml(m.body || '[Media message]').replace(/\n/g, '<br>')}</p>
                                <span class="chat-bubble-time">${timeStr}</span>
                            </div>
                        </div>
                    `;
                }).join('');

                if (shouldScroll || wasAtBottom) {
                    chatMessagesFeed.scrollTop = chatMessagesFeed.scrollHeight;
                }
            }
        } catch (err) {
            console.error('Error fetching active chat messages:', err);
        }
    }

    if (chatComposerForm) {
        chatComposerForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            if (!activeChatId) return;

            const text = chatMessageInput.value.trim();
            if (!text) return;

            chatMessageInput.value = '';

            if (chatMessagesFeed) {
                const tempBubble = document.createElement('div');
                tempBubble.className = 'chat-message-bubble outgoing sending';
                tempBubble.innerHTML = `
                    <div class="chat-bubble-content">
                        <p>${escapeHtml(text).replace(/\n/g, '<br>')}</p>
                        <span class="chat-bubble-time">Sending...</span>
                    </div>
                `;
                chatMessagesFeed.appendChild(tempBubble);
                chatMessagesFeed.scrollTop = chatMessagesFeed.scrollHeight;
            }

            try {
                const res = await fetch(`/api/whatsapp/chats/${encodeURIComponent(activeChatId)}/send`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ message: text })
                });

                if (res.ok) {
                    fetchActiveChatMessages(activeChatId, true);
                    loadWhatsAppChats();
                } else {
                    const errData = await res.json();
                    showToast(errData.error || 'Failed to send message.', 'danger');
                }
            } catch (err) {
                console.error('Failed to send message:', err);
                showToast('Failed to send message.', 'danger');
            }
        });
    }

    if (chatSearchInput) {
        chatSearchInput.addEventListener('input', (e) => {
            chatSearchQuery = e.target.value;
            renderChatList();
        });
    }

    chatFilterTabs.forEach(tab => {
        tab.addEventListener('click', () => {
            chatFilterTabs.forEach(t => t.classList.remove('active'));
            tab.classList.add('active');
            chatFilter = tab.getAttribute('data-chat-filter');
            renderChatList();
        });
    });

    document.querySelectorAll('.quick-reply-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const template = btn.getAttribute('data-template');
            if (chatMessageInput && template) {
                chatMessageInput.value = template;
                chatMessageInput.focus();
            }
        });
    });

    function startChatPolling() {
        if (!chatPollingInterval) {
            chatPollingInterval = setInterval(() => {
                loadWhatsAppChats();
            }, 3000);
        }
    }

    function stopChatPolling() {
        if (chatPollingInterval) {
            clearInterval(chatPollingInterval);
            chatPollingInterval = null;
        }
    }

    /* --------------------------------------------------
     * 7. Initialization & Polling
     * -------------------------------------------------- */

    // Theme Switcher Initializer
    const initThemeSwitcher = () => {
        const themeToggleBtn = document.getElementById('theme-toggle');
        const currentTheme = localStorage.getItem('theme') || 'dark';

        document.documentElement.setAttribute('data-theme', currentTheme);

        if (themeToggleBtn) {
            themeToggleBtn.addEventListener('click', () => {
                const current = document.documentElement.getAttribute('data-theme');
                const nextTheme = current === 'light' ? 'dark' : 'light';

                document.documentElement.setAttribute('data-theme', nextTheme);
                localStorage.setItem('theme', nextTheme);
                showToast(`Theme switched to ${nextTheme} mode`, 'success');
            });
        }
    };
    initThemeSwitcher();

    // Initial fetch calls
    initNavigation();
    checkWhatsAppStatus();
    loadProperties();
    loadInquiries();
    loadSettings();
    loadWhatsAppChats();

    // Poll WhatsApp connection status and inquiries feed
    setInterval(checkWhatsAppStatus, 2000); // scan frequency 2s
    setInterval(loadInquiries, 5000);       // active inquiries polling 5s
});
