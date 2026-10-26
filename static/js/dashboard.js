/**
 * CampusOps Role-Based Dashboard Controller
 * Renders completely distinct dashboard experiences and metrics for each role:
 * Student, Faculty, Technician, Department Manager, Facilities Admin, Procurement Approver, System Admin.
 */

const Dashboard = {
  async init() {
    await this.renderRoleDashboard();
  },

  async renderRoleDashboard() {
    const container = document.getElementById('dashboardContentContainer');
    if (!container) return;

    const user = await API.getCurrentUser();
    if (!user) {
      this.renderPublicLanding(container);
      return;
    }

    let member;
    try {
      member = await API.getActiveMembership();
    } catch (err) {
      container.innerHTML = `
        <div class="max-w-2xl mx-auto py-16 px-6 text-center bg-white dark:bg-slate-800 rounded-3xl border border-rose-200 shadow-xl">
          <div class="w-16 h-16 bg-rose-50 text-rose-600 rounded-2xl flex items-center justify-center mx-auto mb-4">
            <i data-lucide="shield-alert" class="w-8 h-8"></i>
          </div>
          <h2 class="text-2xl font-black text-slate-900 dark:text-white">Access Verification Error</h2>
          <p class="text-sm text-slate-600 dark:text-slate-400 mt-2">${this.escapeHtml(err.message)}</p>
          <button onclick="App.signOut()" class="mt-6 px-6 py-2.5 rounded-xl bg-slate-900 text-white font-semibold text-sm">
            Sign Out
          </button>
        </div>`;
      if (window.App) window.App.refreshIcons();
      return;
    }

    if (!member) {
      container.innerHTML = `
        <div class="max-w-2xl mx-auto py-16 px-6 text-center bg-white dark:bg-slate-800 rounded-3xl border border-slate-200 dark:border-slate-700 shadow-xl">
          <div class="w-16 h-16 bg-amber-50 dark:bg-amber-950/50 text-amber-600 rounded-2xl flex items-center justify-center mx-auto mb-4">
            <i data-lucide="lock" class="w-8 h-8"></i>
          </div>
          <h2 class="text-2xl font-black text-slate-900 dark:text-white tracking-tight">Your account does not have active CampusOps access</h2>
          <p class="text-sm text-slate-600 dark:text-slate-400 mt-3 max-w-md mx-auto">
            You are signed in as <strong>${this.escapeHtml(user.email)}</strong>, but no active college membership was found in <code>campusops_members</code>.
            Please contact your System Administrator to provision your role.
          </p>
          <div class="mt-8 flex justify-center gap-3">
            <button onclick="App.signOut()" class="px-5 py-2.5 rounded-xl border border-slate-200 hover:bg-slate-50 dark:border-slate-700 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 font-semibold text-sm transition">
              Sign Out
            </button>
          </div>
        </div>`;
      if (window.App) window.App.refreshIcons();
      return;
    }

    // Role-specific rendering
    switch (member.role) {
      case 'student':
        await this.renderStudentDashboard(container, member);
        break;
      case 'faculty':
        await this.renderFacultyDashboard(container, member);
        break;
      case 'technician':
        await this.renderTechnicianDashboard(container, member);
        break;
      case 'department_manager':
        await this.renderManagerDashboard(container, member);
        break;
      case 'facilities_admin':
        await this.renderFacilitiesDashboard(container, member);
        break;
      case 'procurement_approver':
        await this.renderProcurementDashboard(container, member);
        break;
      case 'system_admin':
        await this.renderSysAdminDashboard(container, member);
        break;
      default:
        container.innerHTML = `<p class="text-center py-12 text-slate-500">Unrecognized role: ${this.escapeHtml(member.role)}</p>`;
    }

    if (window.App) window.App.refreshIcons();
  },

  renderPublicLanding(container) {
    container.innerHTML = `
      <div class="college-home">
        <section class="college-hero" aria-labelledby="collegeWelcome">
          <div class="college-hero-copy">
            <p class="college-eyebrow">CAMPUS LIFE, CONNECTED</p>
            <h1 id="collegeWelcome">A better day<br>on campus<br><em>starts here.</em></h1>
            <p class="college-intro">Welcome to CampusOps Engineering College. Your shared space for campus services, classroom coordination and a well-cared-for learning environment.</p>
            <div class="college-hero-actions">
              <button class="college-primary" onclick="App.openModal('authModal')">Access your portal <span aria-hidden="true">↗</span></button>
              <button class="college-secondary" onclick="document.getElementById('campusOverview').scrollIntoView({behavior:'smooth'})">Explore our campus <span aria-hidden="true">↓</span></button>
            </div>
            <p class="college-access-note">For students, faculty and college staff.</p>
          </div>
          <div class="college-scene" aria-hidden="true">
            <div class="scene-orbit"></div><div class="scene-sun"></div>
            <div class="scene-building scene-building-back"><span></span><span></span><span></span><span></span></div>
            <div class="scene-building scene-building-front"><span></span><span></span><span></span><span></span><span></span><span></span></div>
            <div class="scene-path"></div><div class="scene-tree scene-tree-one"></div><div class="scene-tree scene-tree-two"></div>
            <div class="scene-caption"><span class="scene-dot"></span> MAIN CAMPUS <strong>A place to learn. A place to belong.</strong></div>
          </div>
        </section>
        <section class="college-overview" id="campusOverview" aria-labelledby="campusOverviewTitle">
          <div class="college-section-heading"><p class="college-eyebrow">OUR COLLEGE</p><h2 id="campusOverviewTitle">Spaces that support your day.</h2><p>From classrooms to laboratories, CampusOps brings everyday campus needs into one place.</p></div>
          <div class="college-space-grid">
            <article class="college-space-card"><span class="college-card-number">01 / LEARNING</span><i data-lucide="book-open" aria-hidden="true"></i><h3>Academic Block</h3><p>Classrooms and shared learning spaces, with room booking and facilities support for faculty and students.</p></article>
            <article class="college-space-card"><span class="college-card-number">02 / DISCOVERY</span><i data-lucide="flask-conical" aria-hidden="true"></i><h3>Laboratory Block</h3><p>Practical learning spaces supported by equipment records, issue reporting and maintenance coordination.</p></article>
            <article class="college-space-card"><span class="college-card-number">03 / CAMPUS CARE</span><i data-lucide="heart-handshake" aria-hidden="true"></i><h3>Here to help</h3><p>Report a facilities issue, follow progress and stay informed when maintenance affects your campus activities.</p></article>
          </div>
        </section>
        <section class="college-service-strip" aria-labelledby="collegeServiceTitle">
          <div><p class="college-eyebrow">EVERYDAY SUPPORT</p><h2 id="collegeServiceTitle">See something that needs attention?</h2><p>Sign in, choose the location and describe the issue. You can follow updates in My Reports.</p></div>
          <button class="college-primary" onclick="App.openModal('authModal')">Sign in to get started <span aria-hidden="true">→</span></button>
        </section>
        <footer class="college-footer"><span>CampusOps Engineering College · Main Campus</span><span>Campus services, together.</span></footer>
      </div>
    `;
    if (window.App) window.App.refreshIcons();
  },

  // 1. STUDENT DASHBOARD
  async renderStudentDashboard(container, member) {
    const reports = await API.getStudentReports(member.user_id);
    const pending = reports.filter(r => r.status !== 'resolved' && r.status !== 'cancelled').length;
    const resolved = reports.filter(r => r.status === 'resolved').length;

    container.innerHTML = `
      <div class="space-y-8">
        <!-- Header Banner -->
        <div class="rounded-3xl bg-gradient-to-r from-indigo-700 to-indigo-900 text-white p-6 sm:p-8 shadow-lg flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div>
            <div class="flex items-center gap-2">
              <span class="px-2.5 py-0.5 rounded-full bg-indigo-500/30 text-indigo-200 text-xs font-semibold uppercase tracking-wider border border-indigo-400/20">Student Portal</span>
              <span class="text-xs text-indigo-200">${member.college?.name || 'CampusOps Engineering College'}</span>
            </div>
            <h1 class="text-2xl sm:text-3xl font-black mt-1">Welcome, ${this.escapeHtml(member.full_name)}</h1>
            <p class="text-xs sm:text-sm text-indigo-100/80 mt-1">Track your campus reports, view technician updates, and submit new maintenance requests.</p>
          </div>
          <button onclick="App.switchTab('report')" class="px-5 py-2.5 rounded-xl bg-white text-indigo-900 hover:bg-indigo-50 font-bold text-xs shadow-md transition flex items-center gap-1.5 shrink-0">
            <i data-lucide="plus-circle" class="w-4 h-4 text-indigo-600"></i>
            Submit New Report
          </button>
        </div>

        <!-- Metrics -->
        <div class="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div class="p-5 rounded-2xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 shadow-sm">
            <span class="text-xs font-semibold text-slate-500 uppercase tracking-wider">Total Reports</span>
            <div class="text-3xl font-black text-slate-900 dark:text-white mt-1">${reports.length}</div>
          </div>
          <div class="p-5 rounded-2xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 shadow-sm">
            <span class="text-xs font-semibold text-amber-600 uppercase tracking-wider">In Progress / Pending</span>
            <div class="text-3xl font-black text-amber-600 mt-1">${pending}</div>
          </div>
          <div class="p-5 rounded-2xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 shadow-sm">
            <span class="text-xs font-semibold text-emerald-600 uppercase tracking-wider">Resolved</span>
            <div class="text-3xl font-black text-emerald-600 mt-1">${resolved}</div>
          </div>
        </div>

        <!-- Recent Reports Preview -->
        <div class="bg-white dark:bg-slate-800 rounded-3xl border border-slate-200 dark:border-slate-700 p-6 shadow-sm">
          <div class="flex items-center justify-between mb-4">
            <h3 class="font-bold text-slate-900 dark:text-white text-lg">My Recent Reports</h3>
            <button onclick="App.switchTab('myreports')" class="text-xs font-semibold text-indigo-600 dark:text-indigo-400 hover:underline">
              View All Reports →
            </button>
          </div>
          ${reports.length === 0 ? `
            <div class="text-center py-8 text-slate-500 text-xs">
              You haven't filed any reports yet. Click "Submit New Report" to report broken equipment or facilities issues.
            </div>
          ` : `
            <div class="divide-y divide-slate-100 dark:divide-slate-800">
              ${reports.slice(0, 3).map(r => `
                <div class="py-3 flex items-center justify-between gap-3 text-xs">
                  <div>
                    <span class="font-bold text-slate-900 dark:text-white">${this.escapeHtml(r.description)}</span>
                    <span class="text-slate-500 block text-[11px] mt-0.5">${this.escapeHtml(r.room_display || 'Campus')} · ${new Date(r.created_at).toLocaleDateString()}</span>
                  </div>
                  <span class="px-2.5 py-0.5 rounded-full capitalize text-[11px] font-semibold bg-slate-100 dark:bg-slate-700">
                    ${r.status.replace('_', ' ')}
                  </span>
                </div>
              `).join('')}
            </div>
          `}
        </div>
      </div>
    `;
  },

  // 2. FACULTY DASHBOARD
  async renderFacultyDashboard(container, member) {
    const [classes, bookings, incidentRooms] = await Promise.all([
      API.getClasses(member.college_id, member.user_id),
      API.getBookings(member.college_id),
      Promise.resolve(API.client.from('campusops_incident_rooms').select('room_id').eq('college_id', member.college_id).is('ends_at', null)).then(result => { if (result.error) throw new Error(API.formatError(result.error)); return result; })
    ]);

    const badRoomIds = new Set((incidentRooms.data || []).map(r => r.room_id));
    const affected = bookings.filter(b => b.kind === 'class' && b.status === 'confirmed' && new Date(b.ends_at) > new Date() && badRoomIds.has(b.room_id));

    container.innerHTML = `
      <div class="space-y-8">
        <!-- Header Banner -->
        <div class="rounded-3xl bg-gradient-to-r from-emerald-800 to-teal-900 text-white p-6 sm:p-8 shadow-lg flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div>
            <div class="flex items-center gap-2">
              <span class="px-2.5 py-0.5 rounded-full bg-emerald-500/30 text-emerald-200 text-xs font-semibold uppercase tracking-wider border border-emerald-400/20">Faculty Portal</span>
              <span class="text-xs text-emerald-200">${this.escapeHtml(member.department?.name || 'Engineering')}</span>
            </div>
            <h1 class="text-2xl sm:text-3xl font-black mt-1">${this.escapeHtml(member.full_name)}</h1>
            <p class="text-xs sm:text-sm text-emerald-100/80 mt-1">Manage scheduled lectures, relocate affected classes, and book available facilities.</p>
          </div>
          <div class="flex gap-2">
            <button onclick="App.switchTab('bookings')" class="px-4 py-2 rounded-xl bg-white text-emerald-900 hover:bg-emerald-50 font-bold text-xs shadow-md transition">
              Room Bookings
            </button>
            <button onclick="App.switchTab('report')" class="px-4 py-2 rounded-xl bg-emerald-700 hover:bg-emerald-600 text-white font-bold text-xs transition">
              Report Issue
            </button>
          </div>
        </div>

        <!-- Affected Classes Alert Banner if room hazard detected -->
        ${affected.length > 0 ? `
          <div class="p-5 rounded-3xl bg-rose-50 dark:bg-rose-950/40 border border-rose-300 dark:border-rose-900/60 shadow-sm flex items-start justify-between gap-4">
            <div class="flex items-start gap-3">
              <div class="w-10 h-10 rounded-2xl bg-rose-600 text-white flex items-center justify-center shrink-0">
                <i data-lucide="alert-triangle" class="w-5 h-5"></i>
              </div>
              <div>
                <h3 class="font-extrabold text-rose-900 dark:text-rose-200 text-base">Notice: Classroom Hazard Detected</h3>
                <p class="text-xs text-rose-700 dark:text-rose-300 mt-1">
                  <strong>${affected.length} of your scheduled classes</strong> are booked in rooms with active incidents .
                  Please relocate to an alternative room.
                </p>
              </div>
            </div>
            <button onclick="App.switchTab('bookings')" class="px-4 py-2 rounded-xl bg-rose-600 hover:bg-rose-700 text-white font-bold text-xs transition shrink-0">
              Relocate Now
            </button>
          </div>
        ` : ''}

        <!-- Metrics Cards -->
        <div class="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div class="p-5 rounded-2xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 shadow-sm">
            <span class="text-xs font-semibold text-slate-500 uppercase tracking-wider">My Classes</span>
            <div class="text-3xl font-black text-slate-900 dark:text-white mt-1">${classes.length}</div>
          </div>
          <div class="p-5 rounded-2xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 shadow-sm">
            <span class="text-xs font-semibold text-indigo-600 uppercase tracking-wider">Scheduled Sessions</span>
            <div class="text-3xl font-black text-indigo-600 mt-1">${bookings.length}</div>
          </div>
          <div class="p-5 rounded-2xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 shadow-sm">
            <span class="text-xs font-semibold text-rose-600 uppercase tracking-wider">Affected Classes</span>
            <div class="text-3xl font-black text-rose-600 mt-1">${affected.length}</div>
          </div>
        </div>
      </div>
    `;
  },

  // 3. TECHNICIAN DASHBOARD
  async renderTechnicianDashboard(container, member) {
    const workOrders = await API.getWorkOrders(member.college_id, member.user_id);
    const blocked = workOrders.filter(w => w.status === 'blocked_parts' || w.status === 'waiting_approval').length;
    const inProgress = workOrders.filter(w => w.status === 'in_progress').length;

    container.innerHTML = `
      <div class="space-y-8">
        <!-- Header Banner -->
        <div class="rounded-3xl bg-gradient-to-r from-amber-700 via-amber-800 to-slate-900 text-white p-6 sm:p-8 shadow-lg flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div>
            <div class="flex items-center gap-2">
              <span class="px-2.5 py-0.5 rounded-full bg-amber-500/30 text-amber-200 text-xs font-semibold uppercase tracking-wider border border-amber-400/20">Technician Dispatch</span>
              <span class="text-xs text-amber-200">On Duty</span>
            </div>
            <h1 class="text-2xl sm:text-3xl font-black mt-1">${this.escapeHtml(member.full_name)}</h1>
            <p class="text-xs sm:text-sm text-amber-100/80 mt-1">Assigned field maintenance orders, material stock holds, and work completion verification.</p>
          </div>
          <button onclick="App.switchTab('workorders')" class="px-5 py-2.5 rounded-xl bg-white text-slate-900 hover:bg-slate-100 font-bold text-xs shadow-md transition flex items-center gap-1.5 shrink-0">
            <i data-lucide="wrench" class="w-4 h-4 text-amber-600"></i>
            View My Work Orders
          </button>
        </div>

        <!-- Blocked Parts Alert if any -->
        ${blocked > 0 ? `
          <div class="p-5 rounded-3xl bg-rose-50 dark:bg-rose-950/40 border border-rose-300 dark:border-rose-900/60 shadow-sm flex items-start justify-between gap-4">
            <div class="flex items-start gap-3">
              <div class="w-10 h-10 rounded-2xl bg-rose-600 text-white flex items-center justify-center shrink-0">
                <i data-lucide="package-x" class="w-5 h-5"></i>
              </div>
              <div>
                <h3 class="font-extrabold text-rose-900 dark:text-rose-200 text-base">${blocked} Work Order(s) Blocked Waiting for Parts</h3>
                <p class="text-xs text-rose-700 dark:text-rose-300 mt-1">
                  E.g. Circuit breaker replacement requires restocking or purchase approval before work can proceed.
                </p>
              </div>
            </div>
            <button onclick="App.switchTab('workorders')" class="px-4 py-2 rounded-xl bg-rose-600 hover:bg-rose-700 text-white font-bold text-xs transition shrink-0">
              Review Blocked Orders
            </button>
          </div>
        ` : ''}

        <!-- Metrics Cards -->
        <div class="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div class="p-5 rounded-2xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 shadow-sm">
            <span class="text-xs font-semibold text-slate-500 uppercase tracking-wider">Assigned Orders</span>
            <div class="text-3xl font-black text-slate-900 dark:text-white mt-1">${workOrders.length}</div>
          </div>
          <div class="p-5 rounded-2xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 shadow-sm">
            <span class="text-xs font-semibold text-indigo-600 uppercase tracking-wider">In Progress</span>
            <div class="text-3xl font-black text-indigo-600 mt-1">${inProgress}</div>
          </div>
          <div class="p-5 rounded-2xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 shadow-sm">
            <span class="text-xs font-semibold text-rose-600 uppercase tracking-wider">Blocked (Parts / Approval)</span>
            <div class="text-3xl font-black text-rose-600 mt-1">${blocked}</div>
          </div>
        </div>
      </div>
    `;
  },

  // 4. DEPARTMENT MANAGER DASHBOARD
  async renderManagerDashboard(container, member) {
    const [incidents, workOrders, approvals] = await Promise.all([
      API.getIncidents(member.college_id, member.department_id),
      API.getWorkOrders(member.college_id),
      API.getApprovals(member.college_id, member.department_id)
    ]);

    const pendingApprovals = approvals.filter(a => a.stage === 1 && a.status === 'pending');

    container.innerHTML = `
      <div class="space-y-8">
        <!-- Header Banner -->
        <div class="rounded-3xl bg-gradient-to-r from-purple-800 to-indigo-950 text-white p-6 sm:p-8 shadow-lg flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div>
            <div class="flex items-center gap-2">
              <span class="px-2.5 py-0.5 rounded-full bg-purple-500/30 text-purple-200 text-xs font-semibold uppercase tracking-wider border border-purple-400/20">Department Management</span>
              <span class="text-xs text-purple-200">${this.escapeHtml(member.department?.name || 'Department')}</span>
            </div>
            <h1 class="text-2xl sm:text-3xl font-black mt-1">${this.escapeHtml(member.full_name)}</h1>
            <p class="text-xs sm:text-sm text-purple-100/80 mt-1">Incident oversight, technician dispatch, work order creation, and Stage 1 approvals.</p>
          </div>
          <div class="flex gap-2">
            <button onclick="App.switchTab('operations')" class="px-4 py-2 rounded-xl bg-white text-purple-900 font-bold text-xs shadow-md transition">
              Incident Queue
            </button>
            <button onclick="App.switchTab('approvals')" class="px-4 py-2 rounded-xl bg-purple-600 hover:bg-purple-700 text-white font-bold text-xs transition">
              Pending Approvals (${pendingApprovals.length})
            </button>
          </div>
        </div>

        <!-- Metrics Cards -->
        <div class="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div class="p-5 rounded-2xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 shadow-sm">
            <span class="text-xs font-semibold text-slate-500 uppercase tracking-wider">Active Incidents</span>
            <div class="text-3xl font-black text-slate-900 dark:text-white mt-1">${incidents.length}</div>
          </div>
          <div class="p-5 rounded-2xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 shadow-sm">
            <span class="text-xs font-semibold text-purple-600 uppercase tracking-wider">Stage 1 Approvals Pending</span>
            <div class="text-3xl font-black text-purple-600 mt-1">${pendingApprovals.length}</div>
          </div>
          <div class="p-5 rounded-2xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 shadow-sm">
            <span class="text-xs font-semibold text-indigo-600 uppercase tracking-wider">Work Orders Dispatched</span>
            <div class="text-3xl font-black text-indigo-600 mt-1">${workOrders.length}</div>
          </div>
        </div>
      </div>
    `;
  },

  // 5. FACILITIES ADMINISTRATOR DASHBOARD
  async renderFacilitiesDashboard(container, member) {
    const [buildings, rooms, incidents, stock] = await Promise.all([
      API.getBuildings(member.college_id),
      API.getRooms(member.college_id),
      API.getIncidents(member.college_id),
      API.getStock(member.college_id)
    ]);

    container.innerHTML = `
      <div class="space-y-8">
        <!-- Header Banner -->
        <div class="rounded-3xl bg-gradient-to-r from-slate-900 via-indigo-950 to-slate-900 text-white p-6 sm:p-8 shadow-2xl border border-indigo-900/50 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div>
            <div class="flex items-center gap-2">
              <span class="px-2.5 py-0.5 rounded-full bg-rose-500/20 text-rose-300 text-xs font-semibold uppercase tracking-wider border border-rose-500/30">Facilities Administrator</span>
              <span class="text-xs text-slate-300">${member.college?.name || 'CampusOps Engineering College'}</span>
            </div>
            <h1 class="text-2xl sm:text-3xl font-black mt-1">${this.escapeHtml(member.full_name)} — Operations Central</h1>
            <p class="text-xs sm:text-sm text-slate-300 mt-1">Full control over Buildings, Rooms, Assets, Inventory Movements, Technician Dispatch, and Incident SLAs.</p>
          </div>
          <div class="flex flex-wrap gap-2">
            <button onclick="App.switchTab('rooms')" class="px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-bold text-xs shadow-md transition flex items-center gap-1.5">
              <i data-lucide="building" class="w-4 h-4"></i>
              Buildings & Rooms
            </button>
            <button onclick="App.switchTab('inventory')" class="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 border border-slate-700 text-white font-bold text-xs transition flex items-center gap-1.5">
              <i data-lucide="package" class="w-4 h-4"></i>
              Inventory
            </button>
          </div>
        </div>

        <!-- Metrics Cards -->
        <div class="grid grid-cols-2 sm:grid-cols-4 gap-4">
          <div class="p-5 rounded-2xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 shadow-sm">
            <span class="text-xs font-semibold text-slate-500 uppercase tracking-wider">Buildings Managed</span>
            <div class="text-3xl font-black text-indigo-600 mt-1">${buildings.length}</div>
            <span class="text-[11px] text-slate-400 mt-1 block">Dynamic in DB</span>
          </div>
          <div class="p-5 rounded-2xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 shadow-sm">
            <span class="text-xs font-semibold text-slate-500 uppercase tracking-wider">Total Rooms</span>
            <div class="text-3xl font-black text-slate-900 dark:text-white mt-1">${rooms.length}</div>
            <span class="text-[11px] text-slate-400 mt-1 block">All capacity tracked</span>
          </div>
          <div class="p-5 rounded-2xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 shadow-sm">
            <span class="text-xs font-semibold text-rose-600 uppercase tracking-wider">Active Incidents</span>
            <div class="text-3xl font-black text-rose-600 mt-1">${incidents.length}</div>
            <span class="text-[11px] text-slate-400 mt-1 block">SLA countdown</span>
          </div>
          <div class="p-5 rounded-2xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 shadow-sm">
            <span class="text-xs font-semibold text-emerald-600 uppercase tracking-wider">Inventory Items</span>
            <div class="text-3xl font-black text-emerald-600 mt-1">${stock.length}</div>
            <span class="text-[11px] text-slate-400 mt-1 block">Stock tracked</span>
          </div>
        </div>

        <!-- Quick Access to Buildings and Rooms Screen (User Primary Requirement) -->
        <div class="p-6 rounded-3xl bg-indigo-50/60 dark:bg-indigo-950/30 border border-indigo-200 dark:border-indigo-900/60 flex flex-col sm:flex-row items-center justify-between gap-4">
          <div>
            <h3 class="font-extrabold text-slate-900 dark:text-white text-base">Buildings and Rooms Management Screen</h3>
            <p class="text-xs text-slate-600 dark:text-slate-400 mt-1">
              Add and edit Academic Block, Laboratory Block, and create new buildings or classrooms with equipment and capacity.
            </p>
          </div>
          <button onclick="App.switchTab('rooms')" class="px-5 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-xs shadow-md transition flex items-center gap-1.5 shrink-0">
            <i data-lucide="door-open" class="w-4 h-4"></i>
            Manage Buildings & Rooms
          </button>
        </div>
      </div>
    `;
  },

  // 6. PROCUREMENT APPROVER DASHBOARD
  async renderProcurementDashboard(container, member) {
    const approvals = await API.getApprovals(member.college_id);
    const stage2 = approvals.filter(a => a.stage === 2 && a.status === 'pending');

    container.innerHTML = `
      <div class="space-y-8">
        <!-- Header Banner -->
        <div class="rounded-3xl bg-gradient-to-r from-blue-800 to-indigo-950 text-white p-6 sm:p-8 shadow-lg flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div>
            <div class="flex items-center gap-2">
              <span class="px-2.5 py-0.5 rounded-full bg-blue-500/30 text-blue-200 text-xs font-semibold uppercase tracking-wider border border-blue-400/20">Procurement & Financial Approvals</span>
              <span class="text-xs text-blue-200">Stage 2 Authority</span>
            </div>
            <h1 class="text-2xl sm:text-3xl font-black mt-1">${this.escapeHtml(member.full_name)}</h1>
            <p class="text-xs sm:text-sm text-blue-100/80 mt-1">Focused Stage 2 approval queue for materials purchase orders, major repair authorization, and emergency stock expenditures.</p>
          </div>
          <button onclick="App.switchTab('approvals')" class="px-5 py-2.5 rounded-xl bg-white text-blue-900 hover:bg-blue-50 font-bold text-xs shadow-md transition shrink-0">
            Open Approval Queue
          </button>
        </div>

        <!-- Metrics Cards -->
        <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div class="p-5 rounded-2xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 shadow-sm">
            <span class="text-xs font-semibold text-blue-600 uppercase tracking-wider">Stage 2 Requisitions Pending</span>
            <div class="text-3xl font-black text-blue-600 mt-1">${stage2.length}</div>
          </div>
          <div class="p-5 rounded-2xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 shadow-sm">
            <span class="text-xs font-semibold text-slate-500 uppercase tracking-wider">Total Approvals Cleared</span>
            <div class="text-3xl font-black text-slate-900 dark:text-white mt-1">${approvals.filter(a => a.status === 'approved').length}</div>
          </div>
        </div>
      </div>
    `;
  },

  // 7. SYSTEM ADMINISTRATOR DASHBOARD
  async renderSysAdminDashboard(container, member) {
    const members = await API.getMembers(member.college_id);

    container.innerHTML = `
      <div class="space-y-8">
        <!-- Header Banner -->
        <div class="rounded-3xl bg-gradient-to-r from-slate-900 via-slate-800 to-indigo-950 text-white p-6 sm:p-8 shadow-lg flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div>
            <div class="flex items-center gap-2">
              <span class="px-2.5 py-0.5 rounded-full bg-slate-700 text-slate-200 text-xs font-semibold uppercase tracking-wider border border-slate-600">System Administrator</span>
              <span class="text-xs text-slate-300">Identity & Role Governance</span>
            </div>
            <h1 class="text-2xl sm:text-3xl font-black mt-1">${this.escapeHtml(member.full_name)}</h1>
            <p class="text-xs sm:text-sm text-slate-300 mt-1">Provision user roles, manage college access, and configure permissions via campusops_set_member.</p>
          </div>
          <button onclick="App.switchTab('sysadmin')" class="px-5 py-2.5 rounded-xl bg-white text-slate-900 hover:bg-slate-100 font-bold text-xs shadow-md transition shrink-0 flex items-center gap-1.5">
            <i data-lucide="users" class="w-4 h-4 text-indigo-600"></i>
            Manage Members
          </button>
        </div>

        <!-- Metrics Cards -->
        <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div class="p-5 rounded-2xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 shadow-sm">
            <span class="text-xs font-semibold text-slate-500 uppercase tracking-wider">Provisioned Members</span>
            <div class="text-3xl font-black text-indigo-600 mt-1">${members.length}</div>
          </div>
          <div class="p-5 rounded-2xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 shadow-sm">
            <span class="text-xs font-semibold text-emerald-600 uppercase tracking-wider">Active Status</span>
            <div class="text-3xl font-black text-emerald-600 mt-1">${members.filter(m => m.active).length}</div>
          </div>
        </div>
      </div>
    `;
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

window.Dashboard = Dashboard;
