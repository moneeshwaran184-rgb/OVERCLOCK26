/**
 * CampusOps Work Orders & Technician Controller
 * Handles technician work order lifecycle:
 * Acknowledge -> Start -> Complete, Parts reservations, Blocked status detection,
 * Shift & availability management, and Repair approval requests.
 */

const WorkOrders = {
  workOrders: [],
  selectedWorkId: null,
  isAvailable: true,
  staffSkills: [],
  shifts: [],

  async init() {
    this.bindEvents();
  },

  bindEvents() {
    const availToggle = document.getElementById('technicianAvailabilityToggle');
    if (availToggle) {
      availToggle.addEventListener('change', (e) => this.toggleAvailability(e.target.checked));
    }

    const completeForm = document.getElementById('completeWorkForm');
    if (completeForm) {
      completeForm.addEventListener('submit', (e) => this.handleCompleteWork(e));
    }

    const repairApprovalForm = document.getElementById('repairApprovalForm');
    if (repairApprovalForm) {
      repairApprovalForm.addEventListener('submit', (e) => this.handleRepairApproval(e));
    }
  },

  async loadData() {
    const member = await API.getActiveMembership();
    if (!member) return;

    try {
      const isTech = member.role === 'technician';
      const [workOrders, shifts, skills] = await Promise.all([
        API.getWorkOrders(member.college_id, isTech ? member.user_id : null),
        this.fetchShifts(member.college_id, member.user_id),
        this.fetchSkills(member.college_id, member.user_id)
      ]);

      this.workOrders = workOrders || [];
      this.shifts = shifts || [];
      this.staffSkills = skills || [];

      this.renderWorkOrders();
      this.renderTechnicianStatus();
    } catch (err) {
      console.error('Failed to load work orders:', err);
      if (window.App) window.App.showToast(err.message, 'error');
    }
  },

  async fetchShifts(collegeId, userId) {
    try {
      const { data } = await API.client
        .from('campusops_shifts')
        .select('*')
        .eq('college_id', collegeId)
        .eq('user_id', userId)
        .order('starts_at', { ascending: false })
        .limit(3);
      return data || [];
    } catch (e) {
      return [];
    }
  },

  async fetchSkills(collegeId, userId) {
    try {
      const { data } = await API.client
        .from('campusops_staff_skills')
        .select('level, skill:campusops_skills(name)')
        .eq('college_id', collegeId)
        .eq('user_id', userId);
      return data || [];
    } catch (e) {
      return [];
    }
  },

  renderTechnicianStatus() {
    const skillsContainer = document.getElementById('techSkillsBadges');
    const shiftContainer = document.getElementById('techShiftInfo');

    if (skillsContainer) {
      if (this.staffSkills.length === 0) {
        skillsContainer.innerHTML = '<span class="text-xs text-slate-400 italic">No skills assigned yet</span>';
      } else {
        skillsContainer.innerHTML = this.staffSkills.map(s => `
          <span class="px-2.5 py-1 rounded-lg bg-indigo-50 dark:bg-indigo-950/40 text-indigo-700 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-800 text-xs font-semibold flex items-center gap-1">
            <i data-lucide="wrench" class="w-3 h-3"></i>
            ${this.escapeHtml(s.skill?.name || 'Skill')} (Level ${s.level})
          </span>
        `).join('');
      }
    }

    if (shiftContainer) {
      if (this.shifts.length === 0) {
        shiftContainer.innerHTML = '<span class="text-xs text-slate-400">Standard shift active</span>';
      } else {
        const s = this.shifts[0];
        const sTime = new Date(s.starts_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        const eTime = new Date(s.ends_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        shiftContainer.innerHTML = `
          <div class="text-xs text-slate-700 dark:text-slate-300">
            <span class="font-bold text-slate-900 dark:text-white">Active Shift:</span> ${sTime} – ${eTime}
            <span class="block text-[11px] text-slate-500 mt-0.5">${this.escapeHtml(s.reason?.startsWith('Demo') ? 'Scheduled availability' : (s.reason || 'Scheduled availability'))}</span>
          </div>
        `;
      }
    }

    if (window.App) window.App.refreshIcons();
  },

  async toggleAvailability(checked) {
    const member = await API.getActiveMembership();
    if (!member) return;

    try {
      await API.setAvailability({
        p_college: member.college_id,
        p_available: checked
      });
      this.isAvailable = checked;
      if (window.App) {
        window.App.showToast(`Status updated: You are now marked as ${checked ? 'Available for Dispatch' : 'Unavailable'}.`, 'success');
      }
    } catch (err) {
      console.error('Failed to set availability:', err);
      if (window.App) window.App.showToast(err.message, 'error');
      // Revert checkbox
      const availToggle = document.getElementById('technicianAvailabilityToggle');
      if (availToggle) availToggle.checked = !checked;
    }
  },

  renderWorkOrders() {
    const container = document.getElementById('workOrdersListContainer');
    if (!container) return;

    if (this.workOrders.length === 0) {
      container.innerHTML = `
        <div class="col-span-full py-16 text-center text-slate-500 dark:text-slate-400 bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700">
          <i data-lucide="check-circle" class="w-10 h-10 mx-auto mb-2 text-emerald-500"></i>
          <h4 class="font-bold text-slate-900 dark:text-white text-base">No Assigned Work Orders</h4>
          <p class="text-xs text-slate-500 mt-1">You are all caught up! New tasks will appear here upon dispatch.</p>
        </div>`;
      if (window.App) window.App.refreshIcons();
      return;
    }

    const member = API._currentMember;
    const isTech = member && member.role === 'technician';

    container.innerHTML = this.workOrders.map(w => {
      const isBlocked = w.status === 'blocked_parts' || w.status === 'pending_approval';
      const partsList = Array.isArray(w.parts) ? w.parts : [];
      const partsBlocked = partsList.some(p => p.reserved_quantity < p.quantity || (p.stock && p.stock.on_hand <= 0));

      const statusBadges = {
        open: 'bg-amber-50 text-amber-700 border-amber-200',
        acknowledged: 'bg-blue-50 text-blue-700 border-blue-200',
        in_progress: 'bg-indigo-50 text-indigo-700 border-indigo-200',
        blocked_parts: 'bg-rose-50 text-rose-700 border-rose-300 font-bold animate-pulse',
        pending_approval: 'bg-orange-50 text-orange-700 border-orange-300 font-bold',
        completed: 'bg-emerald-50 text-emerald-700 border-emerald-200',
        cancelled: 'bg-slate-100 text-slate-600 border-slate-200'
      };

      const statusBadge = statusBadges[w.status] || 'bg-slate-100 text-slate-600 border-slate-200';

      return `
        <div class="bg-white dark:bg-slate-800 rounded-2xl border ${isBlocked ? 'border-rose-300 dark:border-rose-900/60 shadow-rose-100/30' : 'border-slate-200 dark:border-slate-700'} p-5 shadow-sm hover:shadow-md transition">
          <div class="flex items-start justify-between gap-3">
            <div>
              <div class="flex items-center gap-2">
                <span class="px-2.5 py-1 rounded-full text-xs font-semibold capitalize border ${statusBadge}">
                  ${w.status.replace('_', ' ')}
                </span>
                ${isBlocked ? `
                  <span class="px-2 py-0.5 rounded-md bg-rose-600 text-white font-bold text-[10px] tracking-wide uppercase">
                    ${w.status === 'blocked_parts' ? 'Parts Required' : 'Approval Required'}
                  </span>
                ` : ''}
                <span class="text-xs text-slate-400 font-mono">Priority ${w.priority}</span>
              </div>
              <h3 class="font-extrabold text-slate-900 dark:text-white text-lg mt-2 tracking-tight">${this.escapeHtml(w.title)}</h3>
              <p class="text-xs text-slate-500 mt-0.5">Incident: <span class="text-indigo-600 dark:text-indigo-400 font-medium">${this.escapeHtml(w.incident?.title || 'Maintenance Task')}</span></p>
            </div>
            <div class="text-right text-xs">
              <span class="font-mono text-slate-500">${new Date(w.created_at).toLocaleDateString()}</span>
            </div>
          </div>

          <button type="button" onclick="ReportPhotos.openIncident('${w.incident_id}')" class="mt-3 text-xs font-semibold text-indigo-600 underline">View report photos</button>
          <!-- Required Parts & Stock Status -->
          <div class="mt-4 p-3.5 rounded-xl bg-slate-50 dark:bg-slate-900/50 border border-slate-200/80 dark:border-slate-700/80 text-xs">
            <div class="font-semibold text-slate-800 dark:text-slate-200 flex items-center justify-between mb-2">
              <span class="flex items-center gap-1.5">
                <i data-lucide="package" class="w-3.5 h-3.5 text-indigo-500"></i>
                Required Parts & Materials:
              </span>
              ${w.status === 'blocked_parts' ? `
                <button onclick="WorkOrders.reserveParts('${w.id}')" class="px-2.5 py-1 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white text-[11px] font-semibold transition">
                  Reserve Parts
                </button>
              ` : ''}
            </div>

            ${partsList.length > 0 ? `
              <div class="space-y-1.5">
                ${partsList.map(p => {
                  const onHand = p.stock ? p.stock.on_hand : 0;
                  const item = p.stock?.item || {};
                  const isShort = onHand < p.quantity;
                  return `
                    <div class="flex items-center justify-between py-1 border-b border-slate-200/40 dark:border-slate-800/40 last:border-0">
                      <div>
                        <span class="font-medium text-slate-900 dark:text-white">${this.escapeHtml(item.name || 'Component')}</span>
                        <span class="text-slate-400 font-mono text-[11px] ml-1">[${this.escapeHtml(item.sku || 'PART')}]</span>
                      </div>
                      <div class="flex items-center gap-2">
                        <span class="text-slate-600 dark:text-slate-300">Need: <strong>${p.quantity}</strong></span>
                        <span class="px-2 py-0.5 rounded-md text-[11px] font-semibold ${isShort ? 'bg-rose-100 text-rose-800 dark:bg-rose-950/60 dark:text-rose-300' : 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300'}">
                          Stock: ${onHand} ${onHand <= 0 ? '(Out of stock)' : ''}
                        </span>
                      </div>
                    </div>
                  `;
                }).join('')}
              </div>
            ` : '<p class="text-slate-400 italic">No spare parts required for this order.</p>'}
          </div>

          <!-- Actions Bar -->
          <div class="mt-4 pt-3 border-t border-slate-100 dark:border-slate-700/60 flex flex-wrap items-center justify-between gap-2">
            <div class="text-xs text-slate-500 flex items-center gap-2">
              ${w.acknowledged_at ? `
                <span class="text-blue-600 dark:text-blue-400 flex items-center gap-1 font-medium">
                  <i data-lucide="check" class="w-3.5 h-3.5"></i> Acknowledged
                </span>
              ` : '<span class="text-amber-600 flex items-center gap-1">Unacknowledged</span>'}
              ${w.started_at ? `
                <span class="text-indigo-600 dark:text-indigo-400 flex items-center gap-1 font-medium">
                  <i data-lucide="play" class="w-3.5 h-3.5"></i> In Progress
                </span>
              ` : ''}
            </div>

            <div class="flex items-center gap-2">
              ${isTech && !w.acknowledged_at && w.status !== 'completed' && w.status !== 'cancelled' ? `
                <button onclick="WorkOrders.acknowledgeWork('${w.id}')" class="px-3 py-1.5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-semibold text-xs transition flex items-center gap-1">
                  <i data-lucide="check" class="w-3.5 h-3.5"></i> Acknowledge
                </button>
              ` : ''}

              ${isTech && w.status !== 'in_progress' && w.status !== 'completed' && w.status !== 'cancelled' ? `
                <button onclick="WorkOrders.startWork('${w.id}')" class="px-3.5 py-1.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-semibold text-xs transition flex items-center gap-1 shadow-sm">
                  <i data-lucide="play" class="w-3.5 h-3.5"></i> Start Work
                </button>
              ` : ''}

              ${isTech && w.status === 'in_progress' ? `
                <button onclick="WorkOrders.openCompleteModal('${w.id}')" class="px-3.5 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-semibold text-xs transition flex items-center gap-1 shadow-sm">
                  <i data-lucide="check-circle" class="w-3.5 h-3.5"></i> Complete Work
                </button>
              ` : ''}

              ${isTech && w.status !== 'completed' && w.status !== 'cancelled' ? `
                <button onclick="WorkOrders.openRepairApprovalModal('${w.id}')" class="px-3 py-1.5 rounded-xl border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 font-semibold text-xs transition">
                  Request Approval
                </button>
              ` : ''}
            </div>
          </div>
        </div>
      `;
    }).join('');

    if (window.App) window.App.refreshIcons();
  },

  async acknowledgeWork(workId) {
    try {
      await API.acknowledgeWork(workId);
      if (window.App) window.App.showToast('Work order acknowledged.', 'success');
      await this.loadData();
    } catch (err) {
      console.error('Acknowledge failed:', err);
      if (window.App) window.App.showToast(err.message, 'error');
    }
  },

  async startWork(workId) {
    try {
      const res = await API.startWork(workId);
      if (window.App) window.App.showToast(`Work started: ${res || 'Task in progress'}`, 'success');
      await this.loadData();
    } catch (err) {
      console.error('Start work failed:', err);
      if (window.App) window.App.showToast(err.message, 'error');
    }
  },

  async reserveParts(workId) {
    try {
      const res = await API.reserveParts(workId);
      if (res) {
        if (window.App) window.App.showToast('All required parts successfully reserved!', 'success');
      } else {
        if (window.App) window.App.showToast('Parts unavailable in warehouse stock. Purchase or restocking needed.', 'error');
      }
      await this.loadData();
    } catch (err) {
      console.error('Reserve parts failed:', err);
      if (window.App) window.App.showToast(err.message, 'error');
    }
  },

  openCompleteModal(workId) {
    this.selectedWorkId = workId;
    const noteInput = document.getElementById('workCompletionNote');
    const costInput = document.getElementById('workActualCost');
    if (noteInput) noteInput.value = '';
    if (costInput) costInput.value = '0';
    if (window.App) window.App.openModal('completeWorkModal');
  },

  async handleCompleteWork(e) {
    e.preventDefault();
    if (!this.selectedWorkId) return;

    const noteInput = document.getElementById('workCompletionNote');
    const costInput = document.getElementById('workActualCost');
    const submitBtn = document.getElementById('completeWorkSubmitBtn');

    const note = noteInput?.value.trim();
    const actualCost = parseFloat(costInput?.value) || 0;

    if (!note || note.length < 5) {
      if (window.App) window.App.showToast('Please provide a completion note of at least 5 characters.', 'error');
      return;
    }

    if (submitBtn) {
      submitBtn.disabled = true;
      submitBtn.innerHTML = '<span class="animate-spin mr-2">⏳</span> Completing...';
    }

    try {
      await API.completeWork({
        p_work: this.selectedWorkId,
        p_note: note,
        p_actual_cost: actualCost
      });

      if (window.App) {
        window.App.showToast('Work order successfully completed! Maintenance history logged.', 'success');
        window.App.closeModals();
      }

      await this.loadData();
    } catch (err) {
      console.error('Complete work failed:', err);
      if (window.App) window.App.showToast(err.message, 'error');
    } finally {
      if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.textContent = 'Confirm Work Completion';
      }
    }
  },

  openRepairApprovalModal(workId) {
    this.selectedWorkId = workId;
    const reasonInput = document.getElementById('repairApprovalReason');
    const emergencyCheck = document.getElementById('repairApprovalEmergency');
    if (reasonInput) reasonInput.value = '';
    if (emergencyCheck) emergencyCheck.checked = false;
    if (window.App) window.App.openModal('repairApprovalModal');
  },

  async handleRepairApproval(e) {
    e.preventDefault();
    if (!this.selectedWorkId) return;

    const reasonInput = document.getElementById('repairApprovalReason');
    const emergencyCheck = document.getElementById('repairApprovalEmergency');
    const submitBtn = document.getElementById('repairApprovalSubmitBtn');

    const reason = reasonInput?.value.trim();
    const emergency = emergencyCheck ? emergencyCheck.checked : false;

    if (!reason) {
      if (window.App) window.App.showToast('Please provide a reason for the repair approval request.', 'error');
      return;
    }

    if (submitBtn) {
      submitBtn.disabled = true;
      submitBtn.innerHTML = '<span class="animate-spin mr-2">⏳</span> Submitting...';
    }

    try {
      await API.requestRepairApproval({
        p_work: this.selectedWorkId,
        p_reason: reason,
        p_emergency: emergency
      });

      if (window.App) {
        window.App.showToast('Repair approval request submitted to Department Manager.', 'success');
        window.App.closeModals();
      }

      await this.loadData();
    } catch (err) {
      console.error('Repair approval request failed:', err);
      if (window.App) window.App.showToast(err.message, 'error');
    } finally {
      if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.textContent = 'Submit Approval Request';
      }
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

window.WorkOrders = WorkOrders;
