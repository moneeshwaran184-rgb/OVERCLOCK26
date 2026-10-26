/**
 * CampusOps System Administrator Controller
 * Membership management for Supabase Auth users via campusops_set_member.
 */

const SysAdmin = {
  members: [],
  departments: [],
  selectedUserId: null,

  async init() {
    this.bindEvents();
  },

  bindEvents() {
    const memberForm = document.getElementById('setMemberForm');
    if (memberForm) {
      memberForm.addEventListener('submit', (e) => this.handleSetMember(e));
    }

    const openAddBtn = document.getElementById('openAddMemberModalBtn');
    if (openAddBtn) {
      openAddBtn.addEventListener('click', () => this.openMemberModal());
    }
  },

  async loadData() {
    const member = await API.getActiveMembership();
    if (!member) return;

    try {
      const [members, departments] = await Promise.all([
        API.getMembers(member.college_id),
        API.getDepartments(member.college_id)
      ]);

      this.members = members || [];
      this.departments = departments || [];

      this.renderMembers();
    } catch (err) {
      console.error('Failed to load sysadmin data:', err);
      if (window.App) window.App.showToast(err.message, 'error');
    }
  },

  renderMembers() {
    const container = document.getElementById('sysadminMembersList');
    if (!container) return;

    if (this.members.length === 0) {
      container.innerHTML = `
        <div class="col-span-full py-12 text-center text-slate-500 bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700">
          <i data-lucide="users" class="w-8 h-8 mx-auto mb-2 text-slate-400"></i>
          <p class="font-medium text-sm">No campus members found.</p>
        </div>`;
      if (window.App) window.App.refreshIcons();
      return;
    }

    const roleColors = {
      student: 'bg-indigo-50 text-indigo-700 border-indigo-200',
      faculty: 'bg-emerald-50 text-emerald-700 border-emerald-200',
      technician: 'bg-amber-50 text-amber-700 border-amber-200',
      department_manager: 'bg-purple-50 text-purple-700 border-purple-200',
      facilities_admin: 'bg-rose-50 text-rose-700 border-rose-200 font-bold',
      procurement_approver: 'bg-blue-50 text-blue-700 border-blue-200',
      system_admin: 'bg-slate-800 text-white font-bold'
    };

    container.innerHTML = this.members.map(m => `
      <div class="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700 p-5 shadow-sm hover:shadow-md transition flex flex-col justify-between">
        <div>
          <div class="flex items-start justify-between">
            <span class="px-2.5 py-0.5 rounded-full text-[11px] font-semibold border ${roleColors[m.role] || 'bg-slate-100 text-slate-700'}">
              ${m.role.replace('_', ' ').toUpperCase()}
            </span>
            <span class="px-2 py-0.5 rounded-md text-[10px] font-semibold ${m.active ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' : 'bg-rose-50 text-rose-700 border border-rose-200'}">
              ${m.active ? 'Active' : 'Inactive'}
            </span>
          </div>
          <h4 class="font-bold text-slate-900 dark:text-white text-base mt-2">${this.escapeHtml(m.full_name)}</h4>
          <p class="text-xs text-slate-500 font-mono text-[11px] mt-0.5">${m.user_id}</p>
          <p class="text-xs text-indigo-600 dark:text-indigo-400 font-medium mt-1">
            Dept: ${this.escapeHtml(m.department?.name || 'Unassigned')}
          </p>
        </div>

        <div class="mt-4 pt-3 border-t border-slate-100 dark:border-slate-700/60 flex items-center justify-end">
          <button onclick="SysAdmin.openMemberModal('${m.user_id}')" class="px-3 py-1.5 rounded-xl bg-slate-100 hover:bg-slate-200 dark:bg-slate-700 dark:hover:bg-slate-600 text-slate-700 dark:text-slate-200 text-xs font-semibold transition flex items-center gap-1">
            <i data-lucide="user-cog" class="w-3.5 h-3.5"></i>
            Edit Membership
          </button>
        </div>
      </div>
    `).join('');

    if (window.App) window.App.refreshIcons();
  },

  openMemberModal(userId = null) {
    this.selectedUserId = userId;
    const modalTitle = document.getElementById('setMemberModalTitle');
    const userInput = document.getElementById('setMemberUserId');
    const nameInput = document.getElementById('setMemberFullName');
    const roleSelect = document.getElementById('setMemberRole');
    const deptSelect = document.getElementById('setMemberDepartment');
    const activeCheck = document.getElementById('setMemberActive');

    if (deptSelect) {
      deptSelect.innerHTML = '<option value="">No Department</option>' +
        this.departments.map(d => `<option value="${d.id}">${this.escapeHtml(d.name)}</option>`).join('');
    }

    if (userId) {
      const m = this.members.find(item => item.user_id === userId);
      if (m) {
        if (modalTitle) modalTitle.textContent = 'Edit Account Role & Membership';
        if (userInput) { userInput.value = m.user_id; userInput.readOnly = true; }
        if (nameInput) nameInput.value = m.full_name;
        if (roleSelect) roleSelect.value = m.role;
        if (deptSelect) deptSelect.value = m.department_id || '';
        if (activeCheck) activeCheck.checked = m.active;
      }
    } else {
      if (modalTitle) modalTitle.textContent = 'Add / Provision CampusOps Member';
      if (userInput) { userInput.value = ''; userInput.readOnly = false; }
      if (nameInput) nameInput.value = '';
      if (roleSelect) roleSelect.value = 'student';
      if (deptSelect && this.departments[0]) deptSelect.value = this.departments[0].id;
      if (activeCheck) activeCheck.checked = true;
    }

    if (window.App) window.App.openModal('setMemberModal');
  },

  async handleSetMember(e) {
    e.preventDefault();
    const member = await API.getActiveMembership();
    if (!member || member.role !== 'system_admin') {
      if (window.App) window.App.showToast('Permission denied: System Administrator privileges required.', 'error');
      return;
    }

    const userInput = document.getElementById('setMemberUserId');
    const nameInput = document.getElementById('setMemberFullName');
    const roleSelect = document.getElementById('setMemberRole');
    const deptSelect = document.getElementById('setMemberDepartment');
    const activeCheck = document.getElementById('setMemberActive');
    const submitBtn = document.getElementById('setMemberSubmitBtn');

    const userId = userInput?.value.trim();
    const name = nameInput?.value.trim();
    const role = roleSelect?.value;
    const departmentId = deptSelect?.value || null;
    const active = activeCheck ? activeCheck.checked : true;

    if (!userId || !name || !role) {
      if (window.App) window.App.showToast('User UUID, Name, and Role are required.', 'error');
      return;
    }

    if (submitBtn) submitBtn.disabled = true;

    try {
      await API.setMember({
        p_college: member.college_id,
        p_user: userId,
        p_name: name,
        p_role: role,
        p_department: departmentId,
        p_active: active
      });

      if (window.App) {
        window.App.showToast('Account membership updated successfully via campusops_set_member!', 'success');
        window.App.closeModals();
      }

      await this.loadData();
    } catch (err) {
      console.error('Set member failed:', err);
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

window.SysAdmin = SysAdmin;
