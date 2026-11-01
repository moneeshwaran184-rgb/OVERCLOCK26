/**
 * CampusOps – My Reports Controller
 * Displays the authenticated user's reports with clarification messages,
 * replies via campusops_reply_report, and timelines via campusops_report_timeline.
 */
const MyReports = {
  reports: [],
  selectedReportId: null,

  async load() {
    const user = await API.getCurrentUser();
    if (!user) {
      this.showSignInPrompt();
      return;
    }

    this.showContent();
    await this.fetchAndRender();
  },

  showSignInPrompt() {
    const prompt = document.getElementById('myreportsSigninPrompt');
    const content = document.getElementById('myreportsContent');
    if (prompt) prompt.classList.remove('hidden');
    if (content) content.classList.add('hidden');

    const btn = document.getElementById('myreportsSigninBtn');
    if (btn && !btn._wired) {
      btn._wired = true;
      btn.addEventListener('click', () => {
        if (window.App) window.App.openModal('authModal');
      });
    }

    if (window.App) window.App.refreshIcons();
  },

  showContent() {
    const prompt = document.getElementById('myreportsSigninPrompt');
    const content = document.getElementById('myreportsContent');
    if (prompt) prompt.classList.add('hidden');
    if (content) content.classList.remove('hidden');
  },

  async fetchAndRender() {
    const container = document.getElementById('myReportsGridContainer');
    if (!container) return;

    container.innerHTML = `
      <div class="col-span-full py-16 text-center text-slate-400">
        <svg class="animate-spin h-8 w-8 text-indigo-600 mx-auto mb-3" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
          <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
          <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z"></path>
        </svg>
        <p class="text-sm font-medium">Loading your reports…</p>
      </div>
    `;

    try {
      const user = await API.getCurrentUser();
      const reports = await API.getStudentReports(user.id);
      this.reports = reports || [];

      if (this.reports.length === 0) {
        container.innerHTML = `
          <div class="col-span-full py-16 px-4 text-center bg-white dark:bg-slate-800 rounded-2xl border border-dashed border-slate-200 dark:border-slate-700">
            <div class="w-14 h-14 bg-indigo-50 dark:bg-indigo-950/50 text-indigo-600 dark:text-indigo-400 rounded-2xl flex items-center justify-center mx-auto mb-3">
              <i data-lucide="inbox" class="w-7 h-7"></i>
            </div>
            <h3 class="text-base font-semibold text-slate-800 dark:text-white">No reports filed yet</h3>
            <p class="text-sm text-slate-500 dark:text-slate-400 mt-1 max-w-sm mx-auto">
              You haven't submitted any maintenance reports yet. Use the <strong>Submit Report</strong> tab to report campus issues.
            </p>
            <button onclick="App.switchTab('report')" class="mt-5 px-5 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white font-semibold text-sm rounded-xl transition">
              Submit a Report
            </button>
          </div>
        `;
        if (window.App) window.App.refreshIcons();
        return;
      }

      container.innerHTML = this.reports.map(r => {
        const statusColors = {
          submitted: 'bg-amber-50 text-amber-700 border-amber-200',
          triaged: 'bg-blue-50 text-blue-700 border-blue-200',
          in_progress: 'bg-indigo-50 text-indigo-700 border-indigo-200',
          resolved: 'bg-emerald-50 text-emerald-700 border-emerald-200',
          closed: 'bg-slate-100 text-slate-600 border-slate-200'
        };
        const statusClass = statusColors[r.status] || 'bg-slate-100 text-slate-600 border-slate-200';
        const createdDate = new Date(r.created_at).toLocaleDateString(undefined, {
          month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit'
        });

        const messagesCount = Array.isArray(r.messages) ? r.messages.length : 0;

        return `
          <div class="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700 p-5 shadow-sm hover:shadow-md transition flex flex-col justify-between">
            <div>
              <div class="flex items-start justify-between gap-2">
                <span class="px-2.5 py-1 rounded-full text-xs font-semibold capitalize border ${statusClass}">
                  ${r.status.replace('_', ' ')}
                </span>
                <span class="text-xs text-slate-400 font-mono">${createdDate}</span>
              </div>

              <div class="mt-3">
                <p class="text-xs font-semibold text-indigo-600 dark:text-indigo-400 capitalize">${this.escapeHtml(r.category || 'General')}</p>
                <h4 class="font-bold text-slate-900 dark:text-white text-base mt-0.5 line-clamp-2">${this.escapeHtml(r.description)}</h4>
              </div>

              <div class="mt-3 space-y-1.5 text-xs text-slate-600 dark:text-slate-300">
                <div class="flex items-center gap-1.5">
                  <i data-lucide="map-pin" class="w-3.5 h-3.5 text-slate-400"></i>
                  <span class="font-medium">${this.escapeHtml(r.room_display || 'Campus')}</span>
                </div>
                ${r.asset ? `
                  <div class="flex items-center gap-1.5">
                    <i data-lucide="tag" class="w-3.5 h-3.5 text-slate-400"></i>
                    <span>Asset: ${this.escapeHtml(r.asset.name)} [${this.escapeHtml(r.asset.asset_tag)}]</span>
                  </div>
                ` : ''}
                ${r.incident ? `
                  <div class="flex items-center gap-1.5 text-slate-500">
                    <i data-lucide="activity" class="w-3.5 h-3.5 text-indigo-500"></i>
                    <span>Incident Status: <strong class="capitalize">${this.escapeHtml(r.incident.status)}</strong></span>
                  </div>
                ` : ''}
              </div>
            </div>

            <div class="mt-5 pt-3 border-t border-slate-100 dark:border-slate-700/60 flex items-center justify-between">
              <span class="text-xs text-slate-500 flex items-center gap-1">
                <i data-lucide="message-square" class="w-3.5 h-3.5"></i>
                ${messagesCount} ${messagesCount === 1 ? 'Message' : 'Messages'}
              </span>
              <button onclick="MyReports.deleteReport('${r.id}', this)" class="px-3 py-1.5 text-rose-600 text-xs font-semibold">Delete report</button>
              <button onclick="MyReports.openDetailModal('${r.id}')" class="px-3 py-1.5 rounded-xl bg-indigo-50 hover:bg-indigo-100 dark:bg-slate-700 dark:hover:bg-slate-600 text-indigo-600 dark:text-indigo-300 text-xs font-semibold transition flex items-center gap-1">
                <span>View Report, Photo & Chat</span>
                <i data-lucide="chevron-right" class="w-3 h-3"></i>
              </button>
            </div>
          </div>
        `;
      }).join('');

      if (window.App) window.App.refreshIcons();
    } catch (err) {
      console.error('Error fetching my reports:', err);
      container.innerHTML = `
        <div class="col-span-full py-12 text-center text-rose-500">
          <p class="font-medium">Failed to load reports: ${this.escapeHtml(err.message)}</p>
        </div>
      `;
    }
  },

  async deleteReport(reportId, button) {
    if (!confirm('Delete this report and its chat/photo records? This cannot be undone. Any maintenance work already created will remain with staff.')) return;
    button.disabled=true;
    try {
      const {error}=await API.client.rpc('campusops_delete_own_report',{p_report:reportId});
      if(error) throw error;
      App.showToast('Report deleted.', 'success');
      await this.fetchAndRender();
    } catch(error) { App.showToast(error.code==='PGRST202'?'Run the student report deletion SQL update in Supabase first.':error.message,'error');button.disabled=false; }
  },

  async openDetailModal(reportId) {
    this.selectedReportId = reportId;
    const report = this.reports.find(r => r.id === reportId);
    if (!report) return;

    const modal = document.getElementById('reportDetailModal');
    const titleEl = document.getElementById('reportDetailTitle');
    const metaEl = document.getElementById('reportDetailMeta');
    const messagesEl = document.getElementById('reportDetailMessages');
    const timelineEl = document.getElementById('reportDetailTimeline');

    if (titleEl) titleEl.textContent = report.description;
    if (metaEl) {
      metaEl.innerHTML = `
        <div class="flex flex-wrap gap-2 text-xs">
          <span class="px-2 py-0.5 rounded-full bg-slate-100 dark:bg-slate-700 text-slate-700 dark:text-slate-300 font-semibold">
            Status: <strong class="capitalize">${report.status.replace('_', ' ')}</strong>
          </span>
          <span class="px-2 py-0.5 rounded-full bg-indigo-50 dark:bg-indigo-950/40 text-indigo-700 dark:text-indigo-300 font-semibold">
            Category: <strong class="capitalize">${report.category || 'General'}</strong>
          </span>
          <span class="px-2 py-0.5 rounded-full bg-slate-100 dark:bg-slate-700 text-slate-700 dark:text-slate-300">
            Room: <strong>${this.escapeHtml(report.room_display || 'Campus')}</strong>
          </span>
        </div>
      `;
    }

    ReportPhotos.render(document.getElementById('reportDetailPhotos'), report.id, true);

    if (report.equipment_description && metaEl) {
      const equipment=document.createElement('p'); equipment.className='text-xs mt-2'; equipment.textContent='Equipment / item: '+report.equipment_description; metaEl.append(equipment);
    }
    // Render Messages
    if (messagesEl) {
      const msgs = Array.isArray(report.messages) ? report.messages : [];
      if (msgs.length === 0) {
        messagesEl.innerHTML = '<p class="text-xs text-slate-400 italic">No clarification messages exchanged yet.</p>';
      } else {
        messagesEl.innerHTML = msgs.map(m => `
          <div class="p-3 rounded-xl ${m.author?.role === 'student' ? 'bg-indigo-50 dark:bg-indigo-950/40 ml-4' : 'bg-slate-100 dark:bg-slate-800 mr-4'} text-xs">
            <div class="flex items-center justify-between text-[11px] text-slate-500 mb-1">
              <span class="font-bold text-slate-800 dark:text-slate-200">${this.escapeHtml(m.author?.full_name || 'Staff')} (${this.escapeHtml(m.author?.role || 'user')})</span>
              <span>${new Date(m.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
            </div>
            <p class="text-slate-700 dark:text-slate-300 whitespace-pre-line">${this.escapeHtml(m.body)}</p>
          </div>
        `).join('');
      }
    }

    // Load Timeline from RPC
    if (timelineEl) {
      timelineEl.innerHTML = '<p class="text-xs text-slate-400">Loading timeline events…</p>';
      try {
        const events = await API.getReportTimeline(report.id);
        if (!events || events.length === 0) {
          timelineEl.innerHTML = '<p class="text-xs text-slate-400 italic">No timeline events recorded yet.</p>';
        } else {
          timelineEl.innerHTML = events.map((ev, idx) => `
            <div class="flex gap-3 text-xs relative">
              ${idx !== events.length - 1 ? '<div class="absolute left-2.5 top-5 bottom-0 w-0.5 bg-slate-200 dark:bg-slate-700"></div>' : ''}
              <div class="w-5 h-5 rounded-full bg-indigo-600 text-white flex items-center justify-center text-[10px] z-10 shrink-0">
                ●
              </div>
              <div class="pb-4">
                <span class="font-bold text-slate-800 dark:text-slate-200 uppercase tracking-wider text-[10px] text-indigo-600">${this.escapeHtml(ev.event_type)}</span>
                <span class="text-slate-400 text-[10px] ml-1.5">${new Date(ev.event_at).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' })}</span>
                <p class="text-slate-600 dark:text-slate-300 text-xs mt-0.5">${this.escapeHtml(ev.message)}</p>
              </div>
            </div>
          `).join('');
        }
      } catch (err) {
        timelineEl.innerHTML = `<p class="text-xs text-rose-500">Timeline error: ${this.escapeHtml(err.message)}</p>`;
      }
    }

    if (window.App) window.App.openModal('reportDetailModal');
  },

  async sendReply(e) {
    if (e) e.preventDefault();
    if (!this.selectedReportId) return;

    const input = document.getElementById('reportReplyInput');
    const msg = input ? input.value.trim() : '';
    if (!msg) return;

    const btn = document.getElementById('reportReplySubmitBtn');
    if (btn) btn.disabled = true;

    try {
      await API.replyReport({
        p_report: this.selectedReportId,
        p_message: msg
      });

      if (input) input.value = '';
      if (window.App) window.App.showToast('Reply sent successfully!', 'success');

      // Refresh report data
      await this.fetchAndRender();
      await this.openDetailModal(this.selectedReportId);
    } catch (err) {
      console.error('Failed to reply to report:', err);
      if (window.App) window.App.showToast(err.message, 'error');
    } finally {
      if (btn) btn.disabled = false;
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

window.MyReports = MyReports;
