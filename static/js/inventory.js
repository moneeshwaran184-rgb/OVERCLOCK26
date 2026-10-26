/**
 * CampusOps Inventory & Stock Management Controller
 * Handles stock balances, parts adjustments with reason, and stock creation.
 */

const Inventory = {
  stockList: [],
  items: [],
  locations: [],
  selectedStockId: null,

  async init() {
    this.bindEvents();
  },

  bindEvents() {
    const adjustForm = document.getElementById('adjustStockForm');
    if (adjustForm) {
      adjustForm.addEventListener('submit', (e) => this.handleAdjustSubmit(e));
    }

    const createForm = document.getElementById('createStockForm');
    if (createForm) {
      createForm.addEventListener('submit', (e) => this.handleCreateSubmit(e));
    }
  },

  async loadData() {
    const member = await API.getActiveMembership();
    if (!member) return;

    try {
      const [stock, items, locations] = await Promise.all([
        API.getStock(member.college_id),
        API.getInventoryItems(member.college_id),
        API.getStockLocations(member.college_id)
      ]);

      this.stockList = stock || [];
      this.items = items || [];
      this.locations = locations || [];

      this.renderStock();
    } catch (err) {
      console.error('Failed to load inventory data:', err);
      if (window.App) window.App.showToast(err.message, 'error');
    }
  },

  renderStock() {
    const container = document.getElementById('inventoryListContainer');
    if (!container) return;

    if (this.stockList.length === 0) {
      container.innerHTML = `
        <div class="col-span-full py-12 text-center text-slate-500 bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700">
          <i data-lucide="package" class="w-8 h-8 mx-auto mb-2 text-slate-400"></i>
          <p class="font-medium text-sm">No inventory items in stock records.</p>
        </div>`;
      if (window.App) window.App.refreshIcons();
      return;
    }

    const member = API._currentMember;
    const canManage = member && member.role === 'facilities_admin';

    container.innerHTML = this.stockList.map(s => {
      const item = s.item || {};
      const loc = s.location || {};
      const onHand = parseFloat(s.on_hand) || 0;
      const reorder = parseFloat(item.reorder_level) || 5;
      const isLow = onHand <= reorder;

      return `
        <div class="bg-white dark:bg-slate-800 rounded-2xl border ${isLow ? 'border-amber-300 dark:border-amber-900/60' : 'border-slate-200 dark:border-slate-700'} p-5 shadow-sm hover:shadow-md transition flex flex-col justify-between">
          <div>
            <div class="flex items-start justify-between">
              <div>
                <span class="px-2 py-0.5 rounded-md text-[10px] font-bold uppercase tracking-wider bg-slate-100 dark:bg-slate-700 font-mono text-slate-600 dark:text-slate-300">
                  ${this.escapeHtml(item.sku || 'SKU')}
                </span>
                <h4 class="font-bold text-slate-900 dark:text-white text-base mt-1.5">${this.escapeHtml(item.name || 'Component')}</h4>
                <p class="text-xs text-slate-500 mt-0.5">Location: <span class="font-medium text-indigo-600 dark:text-indigo-400">${this.escapeHtml(loc.name || 'Warehouse')}</span></p>
              </div>
              <div class="text-right">
                <span class="text-2xl font-black ${isLow ? 'text-amber-600 dark:text-amber-400' : 'text-slate-900 dark:text-white'}">
                  ${onHand}
                </span>
                <span class="text-xs text-slate-400 block">${this.escapeHtml(item.unit || 'units')}</span>
              </div>
            </div>

            <div class="mt-3 flex items-center justify-between text-xs text-slate-500">
              <span>Unit Cost: ₹${item.unit_cost || 0}</span>
              <span class="px-2 py-0.5 rounded-full text-[10px] font-semibold ${isLow ? 'bg-amber-100 text-amber-800' : 'bg-emerald-100 text-emerald-800'}">
                ${isLow ? 'Low Stock Warning' : 'Normal Stock'}
              </span>
            </div>
          </div>

          ${canManage ? `
            <div class="mt-4 pt-3 border-t border-slate-100 dark:border-slate-700/60 flex items-center justify-end">
              <button onclick="Inventory.openAdjustModal('${s.id}')" class="px-3 py-1.5 rounded-xl bg-indigo-50 hover:bg-indigo-100 dark:bg-slate-700 dark:hover:bg-slate-600 text-indigo-600 dark:text-indigo-300 text-xs font-semibold transition flex items-center gap-1">
                <i data-lucide="sliders" class="w-3.5 h-3.5"></i>
                Adjust Stock
              </button>
            </div>
          ` : ''}
        </div>
      `;
    }).join('');

    if (window.App) window.App.refreshIcons();
  },

  openAdjustModal(stockId) {
    this.selectedStockId = stockId;
    const s = this.stockList.find(item => item.id === stockId);
    if (!s) return;

    const nameEl = document.getElementById('adjustStockItemName');
    const currentEl = document.getElementById('adjustStockCurrentOnHand');
    const deltaInput = document.getElementById('adjustStockDelta');
    const reasonInput = document.getElementById('adjustStockReason');

    if (nameEl) nameEl.textContent = s.item?.name || 'Item';
    if (currentEl) currentEl.textContent = `${s.on_hand} ${s.item?.unit || 'units'}`;
    if (deltaInput) deltaInput.value = '1';
    if (reasonInput) reasonInput.value = '';

    if (window.App) window.App.openModal('adjustStockModal');
  },

  async handleAdjustSubmit(e) {
    e.preventDefault();
    if (!this.selectedStockId) return;

    const deltaInput = document.getElementById('adjustStockDelta');
    const reasonInput = document.getElementById('adjustStockReason');
    const submitBtn = document.getElementById('adjustStockSubmitBtn');

    const delta = parseFloat(deltaInput?.value);
    const reason = reasonInput?.value.trim();

    if (isNaN(delta) || delta === 0) {
      if (window.App) window.App.showToast('Please specify a non-zero adjustment amount (positive or negative).', 'error');
      return;
    }
    if (!reason || reason.length < 5) {
      if (window.App) window.App.showToast('A clear adjustment reason of at least 5 characters is required for audit logs.', 'error');
      return;
    }

    if (submitBtn) submitBtn.disabled = true;

    try {
      await API.adjustStock({
        p_stock: this.selectedStockId,
        p_delta: delta,
        p_reason: reason
      });

      if (window.App) {
        window.App.showToast('Stock balance adjusted and movement logged to audit log.', 'success');
        window.App.closeModals();
      }

      await this.loadData();
    } catch (err) {
      console.error('Adjust stock failed:', err);
      if (window.App) window.App.showToast(err.message, 'error');
    } finally {
      if (submitBtn) submitBtn.disabled = false;
    }
  },

  escapeHtml(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }
};

window.Inventory = Inventory;
