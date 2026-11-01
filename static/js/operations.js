/**
 * CampusOps Operations & Incident Management Controller
 * Used by Department Manager and Facilities Administrator.
 * Manages incidents, merging, dispatching work orders, resolving incidents, and budgets.
 */

const Operations = {
  incidents: [],
  workOrders: [],
  budgets: [],
  skills: [],
  staff: [],
  stock: [],
  selectedIncidentId: null,

  async init() {
    this.bindEvents();
  },

  bindEvents() {
    const resolveForm = document.getElementById('resolveIncidentForm');
    if (resolveForm) {
      resolveForm.addEventListener('submit', (e) => this.handleResolveIncident(e));
    }

    const workOrderForm = document.getElementById('createWorkOrderForm');
    if (workOrderForm) {
      workOrderForm.addEventListener('submit', (e) => this.handleCreateWorkOrder(e));
    }

    const mergeForm = document.getElementById('mergeIncidentsForm');
    if (mergeForm) {
      mergeForm.addEventListener('submit', (e) => this.handleMergeIncidents(e));
    }

    const budgetForm = document.getElementById('setBudgetForm');
    if (budgetForm) {
      budgetForm.addEventListener('submit', (e) => this.handleSetBudget(e));
    }

    const purchaseForm = document.getElementById('managerPurchaseForm');
    if (purchaseForm) {
      purchaseForm.addEventListener('submit', (e) => this.handlePurchaseSubmit(e));
    }
  },

  async loadData() {
    const member = await API.getActiveMembership();
    if (!member) return;

    try {
      const isManager = member.role === 'department_manager';
      const [incidents, workOrders, budgets, skills, staff, stock] = await Promise.all([
        API.getIncidents(member.college_id, isManager ? member.department_id : null),
        API.getWorkOrders(member.college_id),
        API.getBudgets(member.college_id, isManager ? member.department_id : null),
        API.getSkills(member.college_id),
        API.getStaff(member.college_id),
        API.getStock(member.college_id)
      ]);

      this.incidents = incidents || [];
      this.workOrders = workOrders || [];
      this.budgets = budgets || [];
      this.skills = skills || [];
      this.staff = staff || [];
      this.stock = stock || [];

      this.renderIncidents();
      this.renderWorkOrdersQueue();
      this.renderBudgets();
    } catch (err) {
      console.error('Failed to load operations data:', err);
      if (window.App) window.App.showToast(err.message, 'error');
    }
  },

  renderIncidents() {
    const container = document.getElementById('operationsIncidentsContainer');
    if (!container) return;

    if (this.incidents.length === 0) {
      container.innerHTML = `
        <div class="col-span-full py-12 text-center text-slate-500 bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700">
          <i data-lucide="shield-check" class="w-8 h-8 mx-auto mb-2 text-emerald-500"></i>
          <p class="font-medium text-sm">No open incidents in this department queue.</p>
        </div>`;
      if (window.App) window.App.refreshIcons();
      return;
    }

    const member = API._currentMember;
    const canManage = member && (member.role === 'facilities_admin' || member.role === 'department_manager');

    container.innerHTML = this.incidents.map(i => {
      const isClosed = i.status === 'resolved' || i.status === 'closed';
      const priLabels = { 1: 'Critical', 2: 'High', 3: 'Medium', 4: 'Low' };
      const rooms = Array.isArray(i.rooms) ? i.rooms.map(r => r.room ? `${r.room.building?.name || ''} · ${r.room.name}` : '').filter(Boolean) : [];

      return `
        <div class="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700 p-5 shadow-sm hover:shadow-md transition">
          <div class="flex items-start justify-between gap-3">
            <div>
              <div class="flex items-center gap-2">
                <span class="px-2.5 py-0.5 rounded-full text-xs font-semibold capitalize ${isClosed ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' : 'bg-rose-50 text-rose-700 border border-rose-200'}">
                  ${i.status}
                </span>
                <span class="px-2 py-0.5 rounded-md text-[10px] font-bold uppercase tracking-wider bg-slate-100 dark:bg-slate-700 text-slate-700 dark:text-slate-300">
                  ${this.escapeHtml(i.category)}
                </span>
                <span class="text-xs text-rose-600 font-bold font-mono">P${i.priority} (${priLabels[i.priority] || 'Medium'})</span>
              </div>
              <h3 class="font-extrabold text-slate-900 dark:text-white text-base mt-2">${this.escapeHtml(i.title)}</h3>
              <p class="text-xs text-indigo-600 dark:text-indigo-400 font-medium mt-1">
                Affected Rooms: ${rooms.length > 0 ? rooms.join(', ') : 'Campus'}
              </p>
            </div>
            <span class="text-xs font-mono text-slate-400">${new Date(i.created_at).toLocaleDateString()}</span>
          </div>

          <button type="button" onclick="ReportPhotos.openIncident('${i.id}')" class="mt-3 text-xs font-semibold text-indigo-600 underline">View report photos</button>
          <!-- Actions -->
          ${canManage ? `
            <div class="mt-4 pt-3 border-t border-slate-100 dark:border-slate-700/60 flex flex-wrap items-center justify-between gap-2">
              <div class="flex items-center gap-1.5">
                <span class="text-xs text-slate-500 font-medium">Change Priority:</span>
                <select onchange="Operations.setPriority('${i.id}', this.value)" class="text-xs px-2 py-1 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800">
                  <option value="1" ${i.priority === 1 ? 'selected' : ''}>P1 - Critical</option>
                  <option value="2" ${i.priority === 2 ? 'selected' : ''}>P2 - High</option>
                  <option value="3" ${i.priority === 3 ? 'selected' : ''}>P3 - Medium</option>
                  <option value="4" ${i.priority === 4 ? 'selected' : ''}>P4 - Low</option>
                </select>
              </div>

              <div class="flex items-center gap-2">
                <button onclick="Operations.openWorkOrderModal('${i.id}')" class="px-3 py-1.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-semibold text-xs transition flex items-center gap-1 shadow-sm">
                  <i data-lucide="plus" class="w-3.5 h-3.5"></i>
                  Create Work Order
                </button>
                ${!isClosed ? `
                  <button onclick="Operations.openResolveModal('${i.id}')" class="px-3 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-semibold text-xs transition flex items-center gap-1 shadow-sm">
                    <i data-lucide="check-circle" class="w-3.5 h-3.5"></i>
                    Resolve Incident
                  </button>
                ` : ''}
              </div>
            </div>
          ` : ''}
        </div>
      `;
    }).join('');

    if (window.App) window.App.refreshIcons();
  },

  renderWorkOrdersQueue() {
    const container = document.getElementById('operationsWorkOrdersContainer');
    if (!container) return;

    if (this.workOrders.length === 0) {
      container.innerHTML = `
        <div class="col-span-full py-12 text-center text-slate-500 bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700">
          <i data-lucide="check" class="w-8 h-8 mx-auto mb-2 text-emerald-500"></i>
          <p class="font-medium text-sm">No work orders in queue.</p>
        </div>`;
      if (window.App) window.App.refreshIcons();
      return;
    }

    const member = API._currentMember;
    const canManage = member && (member.role === 'facilities_admin' || member.role === 'department_manager');

    container.innerHTML = this.workOrders.map(w => `
      <div class="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700 p-4 shadow-sm hover:shadow-md transition flex items-center justify-between gap-3">
        <div>
          <div class="flex items-center gap-2">
            <span class="px-2 py-0.5 rounded-md text-[10px] font-bold uppercase tracking-wider bg-slate-100 dark:bg-slate-700 font-mono text-slate-700 dark:text-slate-300">
              ${w.status.replace('_', ' ')}
            </span>
            <span class="text-xs font-bold text-slate-900 dark:text-white">${this.escapeHtml(w.title)}</span>
          </div>
          <p class="text-xs text-slate-500 mt-1">
            Assigned: <strong class="text-slate-700 dark:text-slate-300">${this.escapeHtml(w.assigned_user?.full_name || 'Unassigned')}</strong>
            · Budget Hold: ₹${w.budget_hold || 0}
          </p>
        </div>

        ${canManage ? `
          <div class="flex items-center gap-2 shrink-0">
            ${!w.assigned_to ? `
              <button onclick="Operations.assignWork('${w.id}')" class="px-3 py-1.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-semibold text-xs transition">
                Assign Tech
              </button>
            ` : ''}
            ${w.status !== 'completed' && w.status !== 'cancelled' ? `
              <button onclick="Operations.cancelWork('${w.id}')" class="px-3 py-1.5 rounded-xl border border-rose-200 hover:bg-rose-50 text-rose-600 text-xs font-semibold transition">
                Cancel
              </button>
            ` : ''}
          </div>
        ` : ''}
      </div>
    `).join('');

    if (window.App) window.App.refreshIcons();
  },

  renderBudgets() {
    const container = document.getElementById('operationsBudgetsContainer');
    if (!container) return;

    if (this.budgets.length === 0) {
      container.innerHTML = `
        <div class="col-span-full py-8 text-center text-slate-500 bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700">
          <i data-lucide="dollar-sign" class="w-8 h-8 mx-auto mb-2 text-slate-400"></i>
          <p class="font-medium text-sm">No departmental budgets registered.</p>
        </div>`;
      if (window.App) window.App.refreshIcons();
      return;
    }

    container.innerHTML = this.budgets.map(b => {
      const allocated = parseFloat(b.allocated) || 0;
      const spent = parseFloat(b.spent) || 0;
      const committed = parseFloat(b.committed) || 0;
      const remaining = allocated - spent - committed;

      return `
        <div class="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700 p-5 shadow-sm">
          <div class="flex items-start justify-between">
            <div>
              <span class="text-xs text-indigo-600 dark:text-indigo-400 font-semibold">${this.escapeHtml(b.department?.name || 'Department')}</span>
              <h4 class="font-bold text-slate-900 dark:text-white text-base mt-0.5">${this.escapeHtml(b.name)}</h4>
            </div>
            <span class="text-xs font-mono text-slate-400">${b.starts_on} – ${b.ends_on}</span>
          </div>
          <div class="mt-4 grid grid-cols-3 gap-2 text-center text-xs">
            <div class="p-2 rounded-xl bg-slate-50 dark:bg-slate-700">
              <span class="text-slate-400 block text-[10px] uppercase">Allocated</span>
              <span class="font-bold text-slate-900 dark:text-white">₹${allocated}</span>
            </div>
            <div class="p-2 rounded-xl bg-slate-50 dark:bg-slate-700">
              <span class="text-slate-400 block text-[10px] uppercase">Committed</span>
              <span class="font-bold text-amber-600">₹${committed}</span>
            </div>
            <div class="p-2 rounded-xl bg-slate-50 dark:bg-slate-700">
              <span class="text-slate-400 block text-[10px] uppercase">Remaining</span>
              <span class="font-bold text-emerald-600">₹${remaining}</span>
            </div>
          </div>
        </div>
      `;
    }).join('');

    if (window.App) window.App.refreshIcons();
  },

  async setPriority(incidentId, priority) {
    try {
      await API.setIncidentPriority({
        p_incident: incidentId,
        p_priority: parseInt(priority, 10)
      });
      if (window.App) window.App.showToast('Incident priority updated.', 'success');
      await this.loadData();
    } catch (err) {
      console.error('Update priority failed:', err);
      if (window.App) window.App.showToast(err.message, 'error');
    }
  },

  openResolveModal(incidentId) {
    this.selectedIncidentId = incidentId;
    const summaryInput = document.getElementById('resolveIncidentSummary');
    if (summaryInput) summaryInput.value = '';
    if (window.App) window.App.openModal('resolveIncidentModal');
  },

  async handleResolveIncident(e) {
    e.preventDefault();
    if (!this.selectedIncidentId) return;

    const summaryInput = document.getElementById('resolveIncidentSummary');
    const submitBtn = document.getElementById('resolveIncidentSubmitBtn');
    const summary = summaryInput?.value.trim();

    if (!summary || summary.length < 5) {
      if (window.App) window.App.showToast('Please enter a resolution summary of at least 5 characters.', 'error');
      return;
    }

    if (submitBtn) submitBtn.disabled = true;

    try {
      await API.resolveIncident({
        p_incident: this.selectedIncidentId,
        p_summary: summary
      });

      if (window.App) {
        window.App.showToast('Incident resolved successfully! Reporter and stakeholders notified.', 'success');
        window.App.closeModals();
      }

      await this.loadData();
    } catch (err) {
      console.error('Resolve incident failed:', err);
      if (window.App) window.App.showToast(err.message, 'error');
    } finally {
      if (submitBtn) submitBtn.disabled = false;
    }
  },

  openWorkOrderModal(incidentId) {
    this.selectedIncidentId = incidentId;
    const titleInput = document.getElementById('newWorkOrderTitle');
    const costInput = document.getElementById('newWorkOrderCost');
    const budgetSelect = document.getElementById('newWorkOrderBudget');
    const partsSelect = document.getElementById('newWorkOrderParts');

    if (titleInput) titleInput.value = '';
    if (costInput) costInput.value = '1000';

    if (budgetSelect) {
      budgetSelect.innerHTML = '<option value="">No Budget Attached</option>' +
        this.budgets.map(b => `<option value="${b.id}">${this.escapeHtml(b.name)} (₹${b.allocated})</option>`).join('');
    }

    if (partsSelect) {
      partsSelect.innerHTML = '<option value="">No Spare Parts Needed</option>' +
        this.stock.map(s => `<option value="${s.id}">${this.escapeHtml(s.item?.name || 'Part')} [On Hand: ${s.on_hand}]</option>`).join('');
    }

    if (window.App) window.App.openModal('createWorkOrderModal');
  },

  async handleCreateWorkOrder(e) {
    e.preventDefault();
    if (!this.selectedIncidentId) return;

    const titleInput = document.getElementById('newWorkOrderTitle');
    const costInput = document.getElementById('newWorkOrderCost');
    const budgetSelect = document.getElementById('newWorkOrderBudget');
    const partsSelect = document.getElementById('newWorkOrderParts');
    const submitBtn = document.getElementById('createWorkOrderSubmitBtn');

    const title = titleInput?.value.trim();
    const cost = parseFloat(costInput?.value) || 0;
    const budgetId = budgetSelect?.value || null;
    const stockId = partsSelect?.value || null;

    if (!title) {
      if (window.App) window.App.showToast('Work order title is required.', 'error');
      return;
    }

    const partsPayload = stockId ? [{ stock_id: stockId, quantity: 1 }] : [];

    if (submitBtn) submitBtn.disabled = true;

    try {
      await API.createWorkOrder({
        p_incident: this.selectedIncidentId,
        p_title: title,
        p_cost: cost,
        p_budget: budgetId,
        p_parts: partsPayload,
        p_skills: []
      });

      if (window.App) {
        window.App.showToast('Work order created and dispatched to maintenance staff!', 'success');
        window.App.closeModals();
      }

      await this.loadData();
    } catch (err) {
      console.error('Create work order failed:', err);
      if (window.App) window.App.showToast(err.message, 'error');
    } finally {
      if (submitBtn) submitBtn.disabled = false;
    }
  },

  async assignWork(workId) {
    try {
      await API.assignWork(workId);
      if (window.App) window.App.showToast('Work order automatically assigned to available technician.', 'success');
      await this.loadData();
    } catch (err) {
      console.error('Assign work failed:', err);
      if (window.App) window.App.showToast(err.message, 'error');
    }
  },

  async cancelWork(workId) {
    const reason = prompt('Enter cancellation reason:');
    if (!reason) return;
    try {
      await API.cancelWork({
        p_work: workId,
        p_reason: reason
      });
      if (window.App) window.App.showToast('Work order cancelled.', 'success');
      await this.loadData();
    } catch (err) {
      console.error('Cancel work failed:', err);
      if (window.App) window.App.showToast(err.message, 'error');
    }
  },

  openPurchaseModal() {
    const stockSelect = document.getElementById('purchaseStockSelect');
    const budgetSelect = document.getElementById('purchaseBudgetSelect');

    if (stockSelect) {
      stockSelect.innerHTML = this.stock.map(s => `<option value="${s.id}">${this.escapeHtml(s.item?.name || 'Part')} [Current Stock: ${s.on_hand}]</option>`).join('');
    }
    if (budgetSelect) {
      budgetSelect.innerHTML = this.budgets.map(b => `<option value="${b.id}">${this.escapeHtml(b.name)}</option>`).join('');
    }

    if (window.App) window.App.openModal('createPurchaseModal');
  },

  async handlePurchaseSubmit(e) {
    e.preventDefault();
    const member = await API.getActiveMembership();
    if (!member) return;

    const stockSelect = document.getElementById('purchaseStockSelect');
    const budgetSelect = document.getElementById('purchaseBudgetSelect');
    const qtyInput = document.getElementById('purchaseQuantity');
    const costInput = document.getElementById('purchaseTotalCost');
    const reasonInput = document.getElementById('purchaseReason');
    const submitBtn = document.getElementById('purchaseSubmitBtn');

    const stockId = stockSelect?.value;
    const budgetId = budgetSelect?.value;
    const qty = parseFloat(qtyInput?.value) || 1;
    const cost = parseFloat(costInput?.value) || 0;
    const reason = reasonInput?.value.trim();

    if (!stockId || !budgetId || !reason) {
      if (window.App) window.App.showToast('Please fill in all purchase order fields.', 'error');
      return;
    }

    if (submitBtn) submitBtn.disabled = true;

    try {
      await API.requestPurchase({
        p_college: member.college_id,
        p_department: member.department_id,
        p_stock: stockId,
        p_quantity: qty,
        p_total_cost: cost,
        p_budget: budgetId,
        p_reason: reason
      });

      if (window.App) {
        window.App.showToast('Purchase request created and routed to Procurement Approver!', 'success');
        window.App.closeModals();
      }

      await this.loadData();
    } catch (err) {
      console.error('Request purchase failed:', err);
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

window.Operations = Operations;
