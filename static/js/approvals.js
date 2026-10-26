/**
 * CampusOps Approvals Controller
 * Manages 2-stage approval workflows (Department Manager: stage 1, Procurement Approver: stage 2).
 * Enforces self-approval prevention and confirmation prompts.
 */

const Approvals = {
  approvals: [],
  selectedApprovalId: null,

  async init() {
    this.bindEvents();
  },

  bindEvents() {
    const decisionForm = document.getElementById('approvalDecisionForm');
    if (decisionForm) {
      decisionForm.addEventListener('submit', (e) => this.handleDecisionSubmit(e));
    }

    const purchaseForm = document.getElementById('createPurchaseRequestForm');
    if (purchaseForm) {
      purchaseForm.addEventListener('submit', (e) => this.handlePurchaseRequest(e));
    }
  },

  async loadData() {
    const member = await API.getActiveMembership();
    if (!member) return;

    try {
      const isManager = member.role === 'department_manager';
      const approvals = await API.getApprovals(member.college_id, isManager ? member.department_id : null);
      this.approvals = approvals || [];
      this.renderApprovals();
    } catch (err) {
      console.error('Failed to load approvals:', err);
      if (window.App) window.App.showToast(err.message, 'error');
    }
  },

  renderApprovals() {
    const container = document.getElementById('approvalsListContainer');
    if (!container) return;

    const member = API._currentMember;
    const isProcurement = member && member.role === 'procurement_approver';
    const isManager = member && member.role === 'department_manager';
    const isFacilities = member && member.role === 'facilities_admin';

    // Filter approvals for role
    let list = this.approvals;
    if (isProcurement) {
      // Stage 2 approvals
      list = list.filter(a => a.stage === 2 || a.status === 'pending');
    }

    if (list.length === 0) {
      container.innerHTML = `
        <div class="col-span-full py-16 text-center text-slate-500 dark:text-slate-400 bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700">
          <i data-lucide="check-circle" class="w-10 h-10 mx-auto mb-2 text-emerald-500"></i>
          <h4 class="font-bold text-slate-900 dark:text-white text-base">All Approvals Cleared</h4>
          <p class="text-xs text-slate-500 mt-1">There are no pending approval requests in your queue.</p>
        </div>`;
      if (window.App) window.App.refreshIcons();
      return;
    }

    container.innerHTML = list.map(a => {
      const isRequester = member && a.requested_by === member.user_id;
      const isPending = a.status === 'pending';
      const canApprove = isPending && !isRequester && (
        (isManager && a.stage === 1) ||
        (isProcurement && a.stage === 2) ||
        (isFacilities && a.kind === 'booking_override')
      );

      const kindLabels = {
        repair: 'Repair Authorization',
        purchase: 'Material Purchase Order',
        booking_override: 'Room Booking Override',
        emergency: 'Emergency Procurement'
      };

      const kindColors = {
        repair: 'bg-amber-50 text-amber-700 border-amber-200',
        purchase: 'bg-blue-50 text-blue-700 border-blue-200',
        booking_override: 'bg-purple-50 text-purple-700 border-purple-200',
        emergency: 'bg-rose-50 text-rose-700 border-rose-300'
      };

      return `
        <div class="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700 p-5 shadow-sm hover:shadow-md transition">
          <div class="flex items-start justify-between gap-3">
            <div>
              <div class="flex items-center gap-2">
                <span class="px-2.5 py-1 rounded-full text-xs font-semibold border ${kindColors[a.kind] || 'bg-slate-100 text-slate-700'}">
                  ${kindLabels[a.kind] || a.kind}
                </span>
                <span class="px-2 py-0.5 rounded-md text-[10px] font-bold uppercase tracking-wider ${isPending ? 'bg-amber-100 text-amber-800' : (a.status === 'approved' ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-100 text-slate-600')}">
                  Stage ${a.stage || 1}: ${a.status}
                </span>
                <span class="text-xs text-slate-400 font-mono">${new Date(a.created_at).toLocaleDateString()}</span>
              </div>
              <h3 class="font-bold text-slate-900 dark:text-white text-base mt-2">${this.escapeHtml(a.reason || 'Operational approval request')}</h3>
              <p class="text-xs text-slate-500 mt-1">
                Requested by: <strong class="text-slate-800 dark:text-slate-200">${this.escapeHtml(a.requester?.full_name || 'Staff Member')}</strong> (${this.escapeHtml(a.requester?.role || 'Staff')})
                ${a.department ? `· Dept: ${this.escapeHtml(a.department.name)}` : ''}
              </p>
            </div>

            ${isRequester ? `
              <span class="px-2.5 py-1 rounded-lg bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300 text-[11px] font-semibold">
                Self-Submitted (No self-approval)
              </span>
            ` : ''}
          </div>

          <!-- Payload info if purchase -->
          ${a.payload ? `
            <div class="mt-3 p-3 rounded-xl bg-slate-50 dark:bg-slate-900/40 border border-slate-200/60 dark:border-slate-700/60 text-xs">
              ${a.payload.total_cost ? `<span class="font-semibold text-slate-800 dark:text-slate-200">Total Cost: ₹${a.payload.total_cost}</span> · Quantity: ${a.payload.quantity || 1}` : ''}
              ${a.payload.title ? `<span class="font-semibold text-slate-800 dark:text-slate-200">Room Requested:</span> ${a.payload.title}` : ''}
            </div>
          ` : ''}

          <!-- Decisions History -->
          ${Array.isArray(a.decisions) && a.decisions.length > 0 ? `
            <div class="mt-3 space-y-1 text-[11px] text-slate-500">
              ${a.decisions.map(d => `
                <div class="flex items-center gap-1.5">
                  <span class="font-semibold text-slate-700 dark:text-slate-300">Stage ${d.stage} decided by ${this.escapeHtml(d.decider?.full_name || 'Approver')}:</span>
                  <span class="capitalize font-bold ${d.approved ? 'text-emerald-600' : 'text-rose-600'}">${d.approved ? 'Approved' : 'Rejected'}</span>
                  ${d.comment ? `— "${this.escapeHtml(d.comment)}"` : ''}
                </div>
              `).join('')}
            </div>
          ` : ''}

          <!-- Actions -->
          <div class="mt-4 pt-3 border-t border-slate-100 dark:border-slate-700/60 flex items-center justify-between">
            <div>
              ${a.status === 'approved' && a.kind === 'purchase' && isFacilities ? `
                <button onclick="Approvals.receivePurchase('${a.id}')" class="px-3.5 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-semibold text-xs transition flex items-center gap-1 shadow-sm">
                  <i data-lucide="package-check" class="w-3.5 h-3.5"></i>
                  Receive Purchased Stock
                </button>
              ` : ''}
              ${a.status === 'approved' && a.kind === 'booking_override' && isFacilities ? `
                <button onclick="Approvals.executeBookingOverride('${a.id}')" class="px-3.5 py-1.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-semibold text-xs transition flex items-center gap-1 shadow-sm">
                  <i data-lucide="calendar-check" class="w-3.5 h-3.5"></i>
                  Execute Override
                </button>
              ` : ''}
            </div>

            ${canApprove ? `
              <div class="flex items-center gap-2">
                <button onclick="Approvals.openDecisionModal('${a.id}', true)" class="px-3.5 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-semibold text-xs transition shadow-sm flex items-center gap-1">
                  <i data-lucide="check" class="w-3.5 h-3.5"></i>
                  Approve
                </button>
                <button onclick="Approvals.openDecisionModal('${a.id}', false)" class="px-3.5 py-1.5 rounded-xl border border-rose-200 bg-rose-50 hover:bg-rose-100 text-rose-700 font-semibold text-xs transition flex items-center gap-1">
                  <i data-lucide="x" class="w-3.5 h-3.5"></i>
                  Reject
                </button>
              </div>
            ` : ''}
          </div>
        </div>
      `;
    }).join('');

    if (window.App) window.App.refreshIcons();
  },

  openDecisionModal(approvalId, approve) {
    this.selectedApprovalId = approvalId;
    this.pendingDecision = approve;

    const modalTitle = document.getElementById('approvalDecisionModalTitle');
    const commentInput = document.getElementById('approvalDecisionComment');
    const submitBtn = document.getElementById('approvalDecisionSubmitBtn');

    if (modalTitle) modalTitle.textContent = approve ? 'Confirm Approval Decision' : 'Confirm Rejection Decision';
    if (commentInput) commentInput.value = '';
    if (submitBtn) {
      submitBtn.textContent = approve ? 'Confirm Approval' : 'Confirm Rejection';
      submitBtn.className = approve
        ? 'px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-semibold text-xs transition'
        : 'px-4 py-2 rounded-xl bg-rose-600 hover:bg-rose-700 text-white font-semibold text-xs transition';
    }

    if (window.App) window.App.openModal('approvalDecisionModal');
  },

  async handleDecisionSubmit(e) {
    e.preventDefault();
    if (!this.selectedApprovalId) return;

    const commentInput = document.getElementById('approvalDecisionComment');
    const comment = commentInput?.value.trim() || null;
    const submitBtn = document.getElementById('approvalDecisionSubmitBtn');

    if (submitBtn) submitBtn.disabled = true;

    try {
      await API.decideApproval({
        p_approval: this.selectedApprovalId,
        p_approve: this.pendingDecision,
        p_comment: comment
      });

      if (window.App) {
        window.App.showToast(`Request successfully ${this.pendingDecision ? 'approved' : 'rejected'}.`, 'success');
        window.App.closeModals();
      }

      await this.loadData();
    } catch (err) {
      console.error('Approval decision failed:', err);
      if (window.App) window.App.showToast(err.message, 'error');
    } finally {
      if (submitBtn) submitBtn.disabled = false;
    }
  },

  async receivePurchase(approvalId) {
    if (!confirm('Confirm receipt of purchased stock into warehouse?')) return;
    try {
      await API.receivePurchase(approvalId);
      if (window.App) window.App.showToast('Purchase received! Stock on hand updated.', 'success');
      await this.loadData();
    } catch (err) {
      console.error('Receive purchase failed:', err);
      if (window.App) window.App.showToast(err.message, 'error');
    }
  },

  async executeBookingOverride(approvalId) {
    if (!confirm('Execute room booking override? Conflicting bookings will be rescheduled.')) return;
    try {
      await API.executeBookingOverride(approvalId);
      if (window.App) window.App.showToast('Booking override executed successfully!', 'success');
      await this.loadData();
    } catch (err) {
      console.error('Execute override failed:', err);
      if (window.App) window.App.showToast(err.message, 'error');
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

window.Approvals = Approvals;
