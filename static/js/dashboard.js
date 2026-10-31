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

    if (window.CampusHeroAnimation) {
      window.CampusHeroAnimation.destroy();
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
      case 'report_admin':
        await ReportAdmin.load(container);
        break;
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
        <!-- HERO BANNER -->
        <header class="college-hero-header" aria-labelledby="collegeWelcome">
          <div class="campus-hero-badge">
            <span class="campus-hero-badge-pulse"></span>
            <span>Campus Infrastructure Platform</span>
          </div>
          <h1 id="collegeWelcome" class="campus-hero-title">
            A calmer, smarter day on campus<br><em>starts here.</em>
          </h1>
          <p class="campus-hero-subtitle">
            From classroom fixtures to historic central facilities — experience unified reporting, AI-powered triage, and transparent maintenance coordination.
          </p>
          <div class="campus-hero-actions">
            <button class="btn-college-primary" onclick="App.switchTab('report')">
              <i data-lucide="alert-circle" class="w-4 h-4"></i>
              <span>Submit a Report</span>
            </button>
            <button class="btn-college-secondary" onclick="App.openModal('authModal')">
              <i data-lucide="log-in" class="w-4 h-4"></i>
              <span>Sign In to Portal</span>
            </button>
          </div>
        </header>

        <!-- FLOATING FLIGHT TRACKER DOCK -->
        <div class="campus-hero-floating-dock" id="campusFloatingDock">
          <div class="hero-flight-point">
            <span class="hero-flight-dot"></span>
            <span>Photo 1 · Aerial Quad</span>
          </div>

          <div class="hero-scrubber-track" id="heroScrubberTrack" title="Click or scroll to transition view">
            <div class="hero-scrubber-fill" id="heroTransitionBar"></div>
          </div>

          <div class="hero-flight-point">
            <i data-lucide="building-2" class="w-3.5 h-3.5 text-emerald-400"></i>
            <span>Photo 2 · Clock Tower</span>
          </div>

          <div class="hero-flight-status">
            <span class="hero-stage-badge" id="heroTransitionStage">Photo 1 · Aerial Quad</span>
            <span class="text-slate-400">·</span>
            <span class="text-white font-mono font-bold" id="heroTransitionPercent">0%</span>
            <span class="hero-scroll-hint hidden md:flex">
              <i data-lucide="arrow-down" class="w-3 h-3"></i>
              <span>Scroll to blend view</span>
            </span>
          </div>
        </div>

        <!-- EXTENDED LANDING SECTIONS -->
        <div class="college-landing-sections">

          <!-- 1. THE CAMPUS PROBLEM -->
          <section id="section-problem" class="college-section" aria-labelledby="problemTitle">
            <div class="section-tagline">01 / The Operational Challenge</div>
            <h2 id="problemTitle" class="section-heading-lg">Maintenance reports get lost across messages.</h2>
            <p class="section-desc-lg">
              When issues are reported across scattered chat groups, hallway conversations, and inbox threads, staff struggle to track requests, duplicate complaints accumulate, and resolution slows to a crawl.
            </p>

            <div class="problem-card-grid">
              <div class="problem-card problem-card-chaos">
                <div class="problem-card-header">
                  <div class="problem-icon-box problem-icon-chaos">
                    <i data-lucide="message-square-off" class="w-5 h-5"></i>
                  </div>
                  <div>
                    <h3 class="font-bold text-lg text-rose-950 dark:text-rose-200">The Fragmented Approach</h3>
                    <p class="text-xs text-rose-700/80 dark:text-rose-300/80">How campus maintenance breaks down</p>
                  </div>
                </div>
                <ul class="problem-list problem-list-chaos">
                  <li>
                    <i data-lucide="x-circle" class="w-4 h-4 text-rose-500 shrink-0 mt-0.5"></i>
                    <span><strong>Unclear Locations:</strong> "AC broken in 2nd floor lab" — leaving technicians guessing between 6 different rooms.</span>
                  </li>
                  <li>
                    <i data-lucide="x-circle" class="w-4 h-4 text-rose-500 shrink-0 mt-0.5"></i>
                    <span><strong>Duplicate Clutter:</strong> Multiple students post about the same broken projector in separate WhatsApp chats.</span>
                  </li>
                  <li>
                    <i data-lucide="x-circle" class="w-4 h-4 text-rose-500 shrink-0 mt-0.5"></i>
                    <span><strong>Lost Accountability:</strong> Without ticket tracking, urgent electrical or plumbing faults get buried.</span>
                  </li>
                </ul>
              </div>

              <div class="problem-card problem-card-solution">
                <div class="problem-card-header">
                  <div class="problem-icon-box problem-icon-solution">
                    <i data-lucide="shield-check" class="w-5 h-5"></i>
                  </div>
                  <div>
                    <h3 class="font-bold text-lg text-emerald-950 dark:text-emerald-200">The CampusOps Standard</h3>
                    <p class="text-xs text-emerald-700/80 dark:text-emerald-300/80">Coordinated, accountable operations</p>
                  </div>
                </div>
                <ul class="problem-list problem-list-solution">
                  <li>
                    <i data-lucide="check-circle-2" class="w-4 h-4 text-emerald-600 shrink-0 mt-0.5"></i>
                    <span><strong>Pinpoint Accuracy:</strong> Exact Building, Floor, and Room selection ensures zero confusion.</span>
                  </li>
                  <li>
                    <i data-lucide="check-circle-2" class="w-4 h-4 text-emerald-600 shrink-0 mt-0.5"></i>
                    <span><strong>Intelligent Grouping:</strong> Reports for the same space are grouped to prevent duplicate work.</span>
                  </li>
                  <li>
                    <i data-lucide="check-circle-2" class="w-4 h-4 text-emerald-600 shrink-0 mt-0.5"></i>
                    <span><strong>Full Status Visibility:</strong> Requester and staff see live progress from triage to fix.</span>
                  </li>
                </ul>
              </div>
            </div>
          </section>

          <!-- 2. ONE PLACE TO REPORT -->
          <section id="section-reporting" class="college-section" aria-labelledby="reportingTitle">
            <div class="section-tagline">02 / Unified Submission</div>
            <h2 id="reportingTitle" class="section-heading-lg">One place to report: fast, structured, and verified.</h2>
            <p class="section-desc-lg">
              Students and faculty describe the fault, select the campus location, and attach photo proof directly from their phone or computer in under 60 seconds.
            </p>

            <div class="reporting-flow-container">
              <div class="steps-list">
                <div class="step-item">
                  <div class="step-number">01</div>
                  <div class="step-text">
                    <h4>Choose Exact Campus Location</h4>
                    <p>Select the Academic Block, Floor, and Room Number (e.g., Block A, Lab 204) so technicians know where to go.</p>
                  </div>
                </div>
                <div class="step-item">
                  <div class="step-number">02</div>
                  <div class="step-text">
                    <h4>Describe the Fault</h4>
                    <p>Outline what is broken or malfunctioning — whether it's lighting, air conditioning, projector, plumbing, or classroom furniture.</p>
                  </div>
                </div>
                <div class="step-item">
                  <div class="step-number">03</div>
                  <div class="step-text">
                    <h4>Attach Visual Proof</h4>
                    <p>Upload a clear photo so technicians can prepare the right replacement spares and tools before arriving on site.</p>
                  </div>
                </div>
                <div class="pt-2">
                  <button class="btn-college-primary" onclick="App.switchTab('report')">
                    <i data-lucide="file-plus" class="w-4 h-4"></i>
                    <span>Open Report Form</span>
                  </button>
                </div>
              </div>

              <!-- Interactive Mock Report Card -->
              <div class="report-mock-card">
                <div class="mock-ticket-header">
                  <div class="flex items-center gap-2">
                    <span class="w-2.5 h-2.5 rounded-full bg-amber-500"></span>
                    <span class="text-xs font-mono font-bold text-slate-700 dark:text-slate-300">TKT-2026-0842</span>
                  </div>
                  <span class="text-[11px] font-bold px-2 py-0.5 rounded-full bg-indigo-50 dark:bg-indigo-950/60 text-indigo-700 dark:text-indigo-300 border border-indigo-200/50">Electrical</span>
                </div>
                <div class="space-y-3">
                  <h4 class="font-bold text-sm text-slate-900 dark:text-white">Ceiling Projector HDMI Port & Power Trip</h4>
                  <div class="flex items-center gap-2 text-xs text-slate-500">
                    <i data-lucide="map-pin" class="w-3.5 h-3.5 text-slate-400"></i>
                    <span>Academic Block A · 3rd Floor · Room 304</span>
                  </div>
                  <div class="p-3 rounded-xl bg-slate-50 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700 text-xs text-slate-600 dark:text-slate-300">
                    "Projector loses signal midway through lectures; spark sound observed near wall switch."
                  </div>
                  <div class="flex items-center justify-between text-[11px] pt-1 text-slate-400">
                    <span class="flex items-center gap-1"><i data-lucide="image" class="w-3.5 h-3.5"></i> Photo Attached (1.2 MB)</span>
                    <span class="text-emerald-600 dark:text-emerald-400 font-semibold">Triage Score: High</span>
                  </div>
                </div>
              </div>
            </div>
          </section>

          <!-- 3. AI-ASSISTED REVIEW -->
          <section id="section-ai-review" class="college-section" aria-labelledby="aiTitle">
            <div class="section-tagline">03 / Intelligent Triage</div>
            <h2 id="aiTitle" class="section-heading-lg">AI-assisted review: Smart suggestions, human authority.</h2>
            <p class="section-desc-lg">
              CampusOps AI assists facilities teams by clarifying vague problem statements, categorizing urgency, and clustering duplicate reports — while college administrators retain 100% final decision authority.
            </p>

            <div class="ai-review-grid">
              <div class="ai-card">
                <div class="ai-card-icon">
                  <i data-lucide="sparkles" class="w-5 h-5"></i>
                </div>
                <h3>Intelligent Clarification</h3>
                <p>AI prompts the student if essential troubleshooting details are missing, such as equipment model numbers or specific breaker indicators, before dispatching.</p>
              </div>

              <div class="ai-card">
                <div class="ai-card-icon">
                  <i data-lucide="copy-check" class="w-5 h-5"></i>
                </div>
                <h3>Duplicate Detection</h3>
                <p>Automatically flags when multiple students or faculty submit reports for the same fault in the same room, bundling them into one master dispatch ticket.</p>
              </div>

              <div class="ai-card">
                <div class="ai-card-icon">
                  <i data-lucide="alert-triangle" class="w-5 h-5"></i>
                </div>
                <h3>Safety & Priority Scoring</h3>
                <p>Calculates severity levels (Critical, High, Medium, Low) based on safety hazards, live wires, water leaks, or immediate classroom impact.</p>
              </div>
            </div>

            <div class="ai-human-banner">
              <div class="w-10 h-10 rounded-xl bg-indigo-600 text-white flex items-center justify-center shrink-0">
                <i data-lucide="user-check" class="w-5 h-5"></i>
              </div>
              <div class="text-xs sm:text-sm text-indigo-950 dark:text-indigo-200">
                <strong>Human-in-the-Loop Standard:</strong> AI never dispatches contractors or closes reports automatically. College administrators and maintenance supervisors verify recommendations and approve every single work order.
              </div>
            </div>
          </section>

          <!-- 4. TRACK PROGRESS -->
          <section id="section-tracking" class="college-section" aria-labelledby="trackTitle">
            <div class="section-tagline">04 / Lifecycle Transparency</div>
            <h2 id="trackTitle" class="section-heading-lg">Track progress from submission to resolution.</h2>
            <p class="section-desc-lg">
              Every maintenance request follows a clear, transparent four-stage lifecycle so students, faculty, and administrators always know the exact status.
            </p>

            <div class="progress-stepper">
              <div class="stepper-card">
                <div class="stepper-header">
                  <span class="stepper-badge">Step 1</span>
                  <i data-lucide="send" class="w-4 h-4 text-emerald-600"></i>
                </div>
                <h3>1. Submission</h3>
                <p>Requester submits fault description, room location, and photo evidence. The system assigns a unique ticket tracking ID.</p>
              </div>

              <div class="stepper-card">
                <div class="stepper-header">
                  <span class="stepper-badge">Step 2</span>
                  <i data-lucide="clipboard-check" class="w-4 h-4 text-indigo-600"></i>
                </div>
                <h3>2. Admin Review</h3>
                <p>Facilities admin validates report, evaluates AI triage suggestions, checks inventory spares, and approves the work order.</p>
              </div>

              <div class="stepper-card">
                <div class="stepper-header">
                  <span class="stepper-badge">Step 3</span>
                  <i data-lucide="wrench" class="w-4 h-4 text-amber-600"></i>
                </div>
                <h3>3. Technician Assignment</h3>
                <p>Assigned specialized technician (electrician, plumber, HVAC specialist) accepts the ticket and heads to the campus site.</p>
              </div>

              <div class="stepper-card">
                <div class="stepper-header">
                  <span class="stepper-badge">Step 4</span>
                  <i data-lucide="check-circle" class="w-4 h-4 text-emerald-600"></i>
                </div>
                <h3>4. Verified Resolution</h3>
                <p>Repair completed, resolution proof photo logged, and requester receives instant notification of successful sign-off.</p>
              </div>
            </div>
          </section>

          <!-- 5. CAMPUS OPERATIONS TOOLS -->
          <section id="section-tools" class="college-section" aria-labelledby="toolsTitle">
            <div class="section-tagline">05 / Operations Infrastructure</div>
            <h2 id="toolsTitle" class="section-heading-lg">Comprehensive campus operations tools.</h2>
            <p class="section-desc-lg">
              CampusOps provides facilities teams, faculty, and department heads with the specialized tools needed to keep campus infrastructure running flawlessly.
            </p>

            <div class="tools-grid">
              <div class="tool-card">
                <div>
                  <div class="tool-icon tool-icon-hall">
                    <i data-lucide="calendar-check-2" class="w-6 h-6"></i>
                  </div>
                  <h3>Hall Booking Conflict Prevention</h3>
                  <p>Real-time calendar verification for seminar halls, auditoriums, and smart conference rooms to eliminate double-booking clashes between departments.</p>
                </div>
                <ul class="tool-feature-list">
                  <li><i data-lucide="check" class="w-3.5 h-3.5 text-sky-600"></i> Automated schedule collision alerts</li>
                  <li><i data-lucide="check" class="w-3.5 h-3.5 text-sky-600"></i> Department head approval routing</li>
                </ul>
              </div>

              <div class="tool-card">
                <div>
                  <div class="tool-icon tool-icon-work">
                    <i data-lucide="hammer" class="w-6 h-6"></i>
                  </div>
                  <h3>Maintenance Work Orders</h3>
                  <p>Structured dispatch checklists, priority triage, technician assignment, labor hour logging, and root-cause recording for facilities teams.</p>
                </div>
                <ul class="tool-feature-list">
                  <li><i data-lucide="check" class="w-3.5 h-3.5 text-amber-600"></i> Real-time technician task dispatch</li>
                  <li><i data-lucide="check" class="w-3.5 h-3.5 text-amber-600"></i> Resolution proof & audit records</li>
                </ul>
              </div>

              <div class="tool-card">
                <div>
                  <div class="tool-icon tool-icon-stock">
                    <i data-lucide="boxes" class="w-6 h-6"></i>
                  </div>
                  <h3>Stock & Spares Inventory Tracking</h3>
                  <p>Centralized tracking of maintenance consumables (LED tubes, plumbing valves, projector lamps, wire spools) with minimum threshold alerts.</p>
                </div>
                <ul class="tool-feature-list">
                  <li><i data-lucide="check" class="w-3.5 h-3.5 text-emerald-600"></i> Low-stock replenishment alerts</li>
                  <li><i data-lucide="check" class="w-3.5 h-3.5 text-emerald-600"></i> Departmental purchase requisitions</li>
                </ul>
              </div>
            </div>
          </section>

          <!-- 6. CALL TO ACTION -->
          <section id="section-cta" class="college-section" aria-labelledby="ctaTitle">
            <div class="college-cta-banner">
              <div class="cta-glow"></div>
              <div class="college-cta-copy">
                <h2 id="ctaTitle">Keep our campus running at its best.</h2>
                <p>
                  Whether you are a student reporting a classroom issue, faculty reserving a seminar hall, or a technician resolving a work order — CampusOps keeps the college moving forward together.
                </p>
              </div>
              <div class="college-cta-buttons">
                <button class="btn-college-primary" onclick="App.switchTab('report')">
                  <i data-lucide="plus-circle" class="w-4 h-4"></i>
                  <span>Submit a Campus Report</span>
                </button>
                <button class="btn-college-secondary" onclick="App.openModal('authModal')">
                  <i data-lucide="log-in" class="w-4 h-4"></i>
                  <span>Sign In to Portal</span>
                </button>
              </div>
            </div>
          </section>

          <!-- COLLEGE FOOTER -->
          <footer class="college-landing-footer">
            <div class="flex items-center gap-2">
              <i data-lucide="building" class="w-4 h-4 text-emerald-600"></i>
              <span>CampusOps Engineering College · Facilities & Operations Division</span>
            </div>
            <div>
              <span>Main Campus & Technology Blocks · Real-time Infrastructure Care</span>
            </div>
          </footer>

        </div>
      </div>
    `;

    if (window.CampusHeroAnimation) {
      window.CampusHeroAnimation.init();
    }
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
      API.getRoomImpacts(member.college_id).catch(()=>null)
    ]);

    const overlaps=(b,r)=>r.room_id===b.room_id && new Date(r.starts_at)<new Date(b.ends_at) && (!r.ends_at || new Date(r.ends_at)>new Date(b.starts_at));
    const affected = bookings.filter(b => b.kind === 'class' && b.status === 'confirmed' && new Date(b.ends_at) > new Date() && (incidentRooms || []).some(r=>overlaps(b,r)));

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

        <div id="facultyRoomAvailability"></div>
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
    await RoomAvailability.mount('facultyRoomAvailability',classes);
  },

  // 3. TECHNICIAN DASHBOARD
  async renderTechnicianDashboard(container, member) {
    const workOrders = await API.getWorkOrders(member.college_id, member.user_id);
    const blocked = workOrders.filter(w => w.status === 'blocked_parts' || ['waiting_approval','pending_approval'].includes(w.status)).length;
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
            <div class="text-3xl font-black text-slate-900 dark:text-white mt-1">${workOrders.filter(w=>!['completed','cancelled'].includes(w.status)).length}</div>
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
        <section class="space-y-3"><h2 class="text-xl font-bold">Your assigned jobs</h2>
          ${workOrders.filter(w=>!['completed','cancelled'].includes(w.status)).map(w=>`<article class="p-5 border rounded-2xl bg-white dark:bg-slate-800"><h3 class="font-bold">${this.escapeHtml(w.title)}</h3><p class="mt-2 text-sm capitalize">${this.escapeHtml(w.status.replaceAll('_',' '))}</p><button type="button" onclick="App.switchTab('workorders')" class="mt-3 px-4 py-2 bg-indigo-600 text-white rounded-xl">Open job & photos</button></article>`).join('') || '<p class="text-sm text-slate-500">No active jobs assigned to you yet.</p>'}
        </section>
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
