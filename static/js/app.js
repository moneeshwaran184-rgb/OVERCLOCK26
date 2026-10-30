/**
 * CampusOps Core Application Controller
 * Handles tabs, authentication state, dynamic role-based navigation, global modals, toasts, and UI helpers.
 */
const App = {
  currentTab: 'dashboard',
  pendingRedirectTab: null,

  async init() {
    this.setupNavigation();
    this.setupModalListeners();
    this.setupAuthListeners();
    this.refreshIcons();

    // Initialize sub-controllers
    if (window.BuildingsRooms) window.BuildingsRooms.init();
    if (window.WorkOrders) window.WorkOrders.init();
    if (window.Bookings) window.Bookings.init();
    if (window.Approvals) window.Approvals.init();
    if (window.Inventory) window.Inventory.init();
    if (window.SysAdmin) window.SysAdmin.init();
    if (window.ReportForm) window.ReportForm.init();
    if (window.Operations) window.Operations.init();

    // Check existing authentication state on page load
    await this.checkAuthState();

    // Handle initial navigation tab from URL hash
    const hash = window.location.hash.replace('#', '') || 'dashboard';
    await this.switchTab(hash);
    this.startLiveRefresh();


  },

  startLiveRefresh() {
    clearInterval(this.liveRefreshTimer);
    this.liveRefreshTimer = setInterval(async () => {
      if (this.liveRefreshBusy || document.hidden || !API._currentMember) return;
      if (document.querySelector('.modal-backdrop:not(.hidden)')) return;
      this.liveRefreshBusy = true;
      const role = API._currentMember.role;
      try {
        if (this.currentTab === 'workorders' && role === 'technician') await WorkOrders.loadData();
        if (this.currentTab === 'dashboard' && role === 'technician') await Dashboard.renderRoleDashboard();
        if (this.currentTab === 'approvals' && ['department_manager','facilities_admin'].includes(role)) await Approvals.loadData();
        if (['faculty','facilities_admin','department_manager'].includes(role) && ['dashboard','bookings'].includes(this.currentTab) && window.RoomAvailability) await RoomAvailability.refreshVisible();
        if (window.Notifications) await Notifications.loadData();
      } catch (error) { console.warn('Live refresh failed:', error.message); }
      finally { this.liveRefreshBusy = false; }
    }, 10000);
  },

  refreshIcons() {
    if (window.lucide) {
      window.lucide.createIcons();
    }
  },

  setupNavigation() {
    document.addEventListener('click', async (event) => {
      const button = event.target.closest('[data-tab-target]');
      if (!button) return;
      event.preventDefault();
      await this.switchTab(button.dataset.tabTarget);
    });

    // Mobile nav menu toggle
    const mobileMenuBtn = document.getElementById('mobileMenuBtn');
    const mobileNav = document.getElementById('mobileNav');
    if (mobileMenuBtn && mobileNav) {
      mobileMenuBtn.addEventListener('click', () => {
        mobileNav.classList.toggle('hidden');
      });
    }

    // Handle URL hash changes directly
    window.addEventListener('hashchange', async () => {
      const hash = window.location.hash.replace('#', '') || 'dashboard';
      if (hash !== this.currentTab) {
        await this.switchTab(hash);
      }
    });
  },

  async switchTab(tabName) {
    const user = await API.getCurrentUser();
    const member = user ? await API.getActiveMembership().catch(() => null) : null;

    // Check route permissions
    const allowed = this.isTabAllowedForRole(tabName, member ? member.role : 'public');
    if (!allowed) {
      if (!user) {
        this.showToast('Please sign in to access this section.', 'info');
        this.openModal('authModal');
      } else {
        this.showToast(`Your current role does not have permission to view #${tabName}.`, 'error');
      }
      if (tabName !== 'dashboard') {
        tabName = 'dashboard';
      }
    }

    this.currentTab = tabName;
    window.location.hash = tabName;

    // Toggle content visibility
    document.querySelectorAll('.tab-section').forEach(sec => {
      sec.classList.add('hidden');
    });

    const activeSec = document.getElementById(`section-${tabName}`);
    if (activeSec) {
      activeSec.classList.remove('hidden');
      activeSec.classList.add('animate-fade-in');
    }

    // Update active nav button styles
    document.querySelectorAll('[data-tab-target]').forEach(btn => {
      const target = btn.getAttribute('data-tab-target');
      if (target === tabName) {
        btn.classList.add('bg-indigo-50', 'text-indigo-600', 'font-semibold', 'dark:bg-slate-700', 'dark:text-indigo-400');
        btn.classList.remove('text-slate-600', 'hover:bg-slate-50', 'dark:text-slate-300');
      } else {
        btn.classList.remove('bg-indigo-50', 'text-indigo-600', 'font-semibold', 'dark:bg-slate-700', 'dark:text-indigo-400');
        btn.classList.add('text-slate-600', 'hover:bg-slate-50', 'dark:text-slate-300');
      }
    });

    // Close mobile nav
    const mobileNav = document.getElementById('mobileNav');
    if (mobileNav && !mobileNav.classList.contains('hidden')) {
      mobileNav.classList.add('hidden');
    }

    try {
    // Trigger tab specific data loads
    if(tabName==='studenthelp'){await StudentHelp.load();} else if(tabName==='grievances'){await StudentHelp.admin();} else if(tabName==='emailintake'){await EmailIntake.load();} else if (tabName === 'dashboard' && window.Dashboard) {
      await window.Dashboard.renderRoleDashboard();
    } else if (tabName === 'report' && window.ReportForm) {
      await window.ReportForm.loadReferenceData();
    } else if (tabName === 'campusreports') {
      await CampusReports.load();
    } else if (tabName === 'myreports' && window.MyReports) {
      await window.MyReports.load();
    } else if (tabName === 'rooms' && window.BuildingsRooms) {
      await window.BuildingsRooms.loadData();
    } else if (tabName === 'workorders' && window.WorkOrders) {
      await window.WorkOrders.loadData();
    } else if (tabName === 'bookings' && window.Bookings) {
      await window.Bookings.loadData();
    } else if (tabName === 'operations' && window.Operations) {
      await window.Operations.loadData();
    } else if (tabName === 'approvals' && window.Approvals) {
      await window.Approvals.loadData();
    } else if (tabName === 'inventory' && window.Inventory) {
      await window.Inventory.loadData();
    } else if (tabName === 'sysadmin' && window.SysAdmin) {
      await window.SysAdmin.loadData();
    } else if (tabName === 'notifications' && window.Notifications) {
      await window.Notifications.loadData();
    } else if (tabName === 'analytics' && window.Analytics) {
      await window.Analytics.loadAnalytics();
    }

    } catch (error) {
      console.error('Unable to load section:', error);
      if (activeSec) {
        let notice = activeSec.querySelector('.section-load-error');
        if (!notice) { notice = document.createElement('div'); notice.className='section-load-error mb-5 p-4 rounded-xl bg-rose-50 text-rose-800 border border-rose-200'; activeSec.prepend(notice); }
        notice.innerHTML = '<strong>We couldn’t load this page.</strong><p class="text-sm mt-1">' + this.escapeHtml(error.message) + '</p><button class="mt-3 underline text-sm font-semibold" type="button">Try again</button>';
        notice.querySelector('button').onclick=() => { notice.remove(); this.switchTab(tabName); };
      }
    }

    this.refreshIcons();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  },

  isTabAllowedForRole(tab, role) {
    if (tab === 'dashboard') return true;
    if (role === 'public') return false;

    switch (role) {
      case 'report_admin':
        return ['dashboard','emailintake','grievances','notifications'].includes(tab);
      case 'student':
        return ['dashboard', 'report', 'myreports', 'campusreports', 'studenthelp', 'notifications'].includes(tab);
      case 'faculty':
        return ['dashboard', 'bookings', 'notifications'].includes(tab);
      case 'technician':
        return ['dashboard', 'workorders', 'notifications'].includes(tab);
      case 'department_manager':
        return ['dashboard', 'inventory', 'operations', 'approvals', 'report', 'analytics', 'notifications'].includes(tab);
      case 'facilities_admin':
        return ['dashboard', 'rooms', 'operations', 'workorders', 'inventory', 'bookings', 'approvals', 'analytics', 'notifications'].includes(tab);
      case 'procurement_approver':
        return ['dashboard', 'approvals', 'notifications'].includes(tab);
      case 'system_admin':
        return ['dashboard', 'sysadmin', 'notifications'].includes(tab);
      default:
        return false;
    }
  },

  setupModalListeners() {
    document.querySelectorAll('.modal-backdrop').forEach(bd => {
      bd.addEventListener('click', (e) => {
        if (e.target === bd) this.closeModals();
      });
    });

    document.querySelectorAll('[data-close-modal]').forEach(btn => {
      btn.addEventListener('click', () => this.closeModals());
    });

    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') this.closeModals();
    });
  },

  openModal(modalId) {
    const modal = document.getElementById(modalId);
    if (modal) {
      modal.classList.remove('hidden');
      modal.classList.add('flex');
      document.body.style.overflow = 'hidden';
      this.refreshIcons();
    }
  },

  closeModals() {
    document.querySelectorAll('.modal-backdrop').forEach(modal => {
      modal.classList.add('hidden');
      modal.classList.remove('flex');
    });
    document.body.style.overflow = '';
  },

  setupAuthListeners() {
    const openBtn = document.getElementById('authModalOpenBtn');
    const signOutBtn = document.getElementById('authSignOutBtn');
    const form = document.getElementById('authForm');

    if (openBtn) {
      openBtn.addEventListener('click', () => {
        this.openModal('authModal');
      });
    }

    if (signOutBtn) {
      signOutBtn.addEventListener('click', async () => {
        await this.signOut();
      });
    }

    if (form) {
      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const email = document.getElementById('authEmail')?.value.trim();
        const password = document.getElementById('authPassword')?.value;
        const submitBtn = document.getElementById('authSubmitBtn');

        if (!email || !password) {
          this.showToast('Please enter both email and password.', 'error');
          return;
        }

        if (submitBtn) {
          submitBtn.disabled = true;
          submitBtn.innerHTML = '<span class="animate-spin mr-2">⏳</span> Validating credentials...';
        }

        try {
          await API.signIn(email, password);
          this.showToast('Signed in successfully!', 'success');
          this.closeModals();
          await this.checkAuthState();
          await this.switchTab('dashboard');
        } catch (err) {
          this.showToast(err.message || 'Authentication error', 'error');
        } finally {
          if (submitBtn) {
            submitBtn.disabled = false;
            submitBtn.textContent = 'Sign In to CampusOps';
          }
        }
      });
    }

    // Subscribe to auth state changes in Supabase JS v2
    if (window.supabaseClient) {
      window.supabaseClient.auth.onAuthStateChange((event, session) => {
        // Supabase holds its auth lock while invoking this callback.
        // Defer API calls to avoid blocking sign-in or token refresh.
        if (!['SIGNED_IN', 'TOKEN_REFRESHED', 'SIGNED_OUT', 'USER_UPDATED'].includes(event)) return;
        API._currentUser = session?.user || null;
        API._currentMember = null;
        clearTimeout(this.authRefreshTimer);
        this.authRefreshTimer = setTimeout(async () => {
          try {
            await this.checkAuthState();
            if (event === 'SIGNED_OUT') { window.StudentHelp?.reset(); await this.switchTab('dashboard'); }
          } catch (error) {
            this.showToast(error.message || 'Unable to refresh your session.', 'error');
          }
        }, 0);
      });
    }
  },

  async signOut() {
    await API.signOut();
    this.showToast('Signed out successfully.', 'info');
    await this.checkAuthState();
    await this.switchTab('dashboard');
  },

  async checkAuthState() {
    const authBtn = document.getElementById('authModalOpenBtn');
    const signedInGroup = document.getElementById('authSignedInGroup');
    const authUserName = document.getElementById('authUserName');
    const roleIndicator = document.getElementById('roleIndicator');
    const roleBadge = document.getElementById('roleIndicatorBadge');

    if (!window.supabaseClient) return;

    try {
      const user = await API.getCurrentUser();
      let member = null;

      if (user) {
        member = await API.getActiveMembership().catch(() => null);
      }

      if (user && member) {
        if (authBtn) authBtn.classList.add('hidden');
        if (signedInGroup) signedInGroup.classList.remove('hidden');
        if (authUserName) authUserName.textContent = member.full_name || user.email;

        const roleLabels = {
          student: 'Student',
          faculty: 'Faculty',
          technician: 'Technician',
          department_manager: 'Dept Manager',
          facilities_admin: 'Facilities Admin',
          report_admin: 'Report Admin',
          procurement_approver: 'Procurement',
          system_admin: 'System Admin'
        };

        if (roleIndicator) {
          roleIndicator.textContent = roleLabels[member.role] || member.role;
        }
        if (roleBadge) {
          roleBadge.classList.remove('hidden');
          roleBadge.className = 'hidden sm:flex px-2.5 py-1 rounded-xl text-[11px] font-bold border ' + this.getRoleBadgeClass(member.role);
        }
      } else if (user && !member) {
        // Authenticated but no active college membership
        if (authBtn) authBtn.classList.add('hidden');
        if (signedInGroup) signedInGroup.classList.remove('hidden');
        if (authUserName) authUserName.textContent = user.email;
        if (roleIndicator) roleIndicator.textContent = 'No Membership';
        if (roleBadge) {
          roleBadge.classList.remove('hidden');
          roleBadge.className = 'hidden sm:flex px-2.5 py-1 rounded-xl text-[11px] font-bold bg-amber-50 text-amber-800 border border-amber-200';
        }
      } else {
        // Signed out
        if (authBtn) authBtn.classList.remove('hidden');
        if (signedInGroup) signedInGroup.classList.add('hidden');
        if (roleBadge) roleBadge.classList.add('hidden');
      }

      document.getElementById('notificationNavButton')?.classList.toggle('hidden', !member);
      // Re-render Dynamic Navigation Tabs according to current role
      this.renderNavTabs(member ? member.role : 'public');
    } catch (e) {
      console.warn('checkAuthState error:', e);
    }
  },

  getRoleBadgeClass(role) {
    switch (role) {
      case 'student': return 'bg-indigo-50 text-indigo-700 border-indigo-200';
      case 'faculty': return 'bg-emerald-50 text-emerald-700 border-emerald-200';
      case 'technician': return 'bg-amber-50 text-amber-700 border-amber-200';
      case 'department_manager': return 'bg-purple-50 text-purple-700 border-purple-200';
      case 'facilities_admin': return 'bg-rose-50 text-rose-700 border-rose-300 font-extrabold';
      case 'procurement_approver': return 'bg-blue-50 text-blue-700 border-blue-200';
      case 'system_admin': return 'bg-slate-800 text-white border-slate-700';
      default: return 'bg-slate-100 text-slate-700 border-slate-200';
    }
  },

  renderNavTabs(role) {
    const desktopNav = document.getElementById('desktopNav');
    const mobileNavList = document.getElementById('mobileNavList');

    const tabsByRole = {
      public: [
        { id: 'dashboard', label: 'Home', icon: 'layout-grid' }
      ],
      report_admin: [
        { id: 'dashboard', label: 'Student Reports', icon: 'clipboard-list' },
          { id: 'emailintake', label: 'Email Intake', icon: 'mail' },
        { id: 'grievances', label: 'Grievance Redressal', icon: 'message-square' },
        { id: 'notifications', label: 'Notifications', icon: 'bell' }
      ],
      student: [
        { id: 'dashboard', label: 'Dashboard', icon: 'layout-grid' },
        { id: 'report', label: 'Submit Report', icon: 'plus-circle' },
        { id: 'myreports', label: 'My Reports', icon: 'list' },
        { id: 'campusreports', label: 'Campus Reports', icon: 'users' },
        { id: 'studenthelp', label: 'AI Help & Grievances', icon: 'message-circle' },
        { id: 'notifications', label: 'Notifications', icon: 'bell' }
      ],
      faculty: [
        { id: 'dashboard', label: 'Dashboard', icon: 'layout-grid' },
        { id: 'bookings', label: 'Classes & Bookings', icon: 'calendar' },
        { id: 'notifications', label: 'Notifications', icon: 'bell' }
      ],
      technician: [
        { id: 'dashboard', label: 'Dashboard', icon: 'layout-grid' },
        { id: 'workorders', label: 'My Work Orders', icon: 'wrench' },
        { id: 'notifications', label: 'Notifications', icon: 'bell' }
      ],
      department_manager: [
        { id: 'inventory', label: 'Inventory', icon: 'package' },
        { id: 'dashboard', label: 'Dashboard', icon: 'layout-grid' },
        { id: 'operations', label: 'Incident Queue', icon: 'alert-triangle' },
        { id: 'approvals', label: 'Approvals', icon: 'file-check' },
        { id: 'report', label: 'Report Issue', icon: 'plus-circle' },
        { id: 'analytics', label: 'Analytics', icon: 'bar-chart-3' },
        { id: 'notifications', label: 'Notifications', icon: 'bell' }
      ],
      facilities_admin: [
        { id: 'dashboard', label: 'Operations', icon: 'layout-grid' },
        { id: 'rooms', label: 'Buildings & Rooms', icon: 'door-open' },
        { id: 'operations', label: 'Incidents & Work', icon: 'shield-alert' },
        { id: 'workorders', label: 'All Work Orders', icon: 'wrench' },
        { id: 'inventory', label: 'Inventory', icon: 'package' },
        { id: 'bookings', label: 'Room Schedule', icon: 'calendar' },
        { id: 'approvals', label: 'Approvals', icon: 'file-check' },
        { id: 'analytics', label: 'Analytics', icon: 'bar-chart-3' },
        { id: 'notifications', label: 'Notifications', icon: 'bell' }
      ],
      procurement_approver: [
        { id: 'dashboard', label: 'Dashboard', icon: 'layout-grid' },
        { id: 'approvals', label: 'Approval Queue', icon: 'file-check' },
        { id: 'notifications', label: 'Notifications', icon: 'bell' }
      ],
      system_admin: [
        { id: 'dashboard', label: 'Dashboard', icon: 'layout-grid' },
        { id: 'sysadmin', label: 'Account Memberships', icon: 'users' },
        { id: 'notifications', label: 'Notifications', icon: 'bell' }
      ]
    };

    const tabs = tabsByRole[role] || tabsByRole.public;

    if (desktopNav) {
      desktopNav.innerHTML = tabs.map(t => `
        <button data-tab-target="${t.id}" class="px-3.5 py-2 rounded-xl text-xs font-medium transition flex items-center gap-1.5 ${t.id === this.currentTab ? 'bg-indigo-50 text-indigo-600 font-semibold dark:bg-slate-700 dark:text-indigo-400' : 'text-slate-600 hover:bg-slate-50 dark:text-slate-300 dark:hover:bg-slate-700'}">
          <i data-lucide="${t.icon}" class="w-4 h-4"></i>
          <span>${t.label}</span>
        </button>
      `).join('');
    }

    if (mobileNavList) {
      mobileNavList.innerHTML = tabs.map(t => `
        <button data-tab-target="${t.id}" class="w-full text-left px-4 py-2.5 rounded-xl text-sm font-medium flex items-center gap-2.5 ${t.id === this.currentTab ? 'bg-indigo-50 text-indigo-600 font-semibold' : 'text-slate-600 hover:bg-slate-50'}">
          <i data-lucide="${t.icon}" class="w-4 h-4"></i>
          <span>${t.label}</span>
        </button>
      `).join('');
    }

    this.refreshIcons();
  },

  showToast(message, type = 'info') {
    const container = document.getElementById('toastContainer');
    if (!container) return;

    const toast = document.createElement('div');
    const bgColors = {
      success: 'bg-emerald-600 text-white',
      error: 'bg-rose-600 text-white',
      info: 'bg-indigo-600 text-white'
    };

    toast.className = `p-4 rounded-2xl shadow-xl flex items-center gap-3 text-xs font-semibold animate-slide-up transition-all ${bgColors[type] || bgColors.info}`;
    toast.innerHTML = `
      <span>${this.escapeHtml(message)}</span>
      <button onclick="this.parentElement.remove()" class="ml-auto opacity-75 hover:opacity-100 font-bold">✕</button>
    `;

    container.appendChild(toast);
    setTimeout(() => {
      if (toast.parentElement) toast.remove();
    }, 4500);
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

window.App = App;

document.addEventListener('DOMContentLoaded', () => {
  App.init();
});
