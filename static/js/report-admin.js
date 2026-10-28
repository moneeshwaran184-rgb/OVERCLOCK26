/* Report inbox stages are derived from persisted work orders, not local guesses. */
const ReportAdmin = {
  reviewPriority(r){return Number(r.priority)||3;},
  reports: [], work: [], selected: null, container: null, busy: false, detailRequest: 0,
  activeStage: 'new', loading: false, historyMode: false,
  escape(value) { return App.escapeHtml(String(value ?? '')); },
  priorityLabel(value) { return ['', 'Critical', 'High', 'Medium', 'Low'][Number(value)] || 'Medium'; },
  priorityClass(value) { return ({1:'bg-red-100 text-red-800 border-red-200',2:'bg-orange-100 text-orange-800 border-orange-200',3:'bg-blue-50 text-blue-800 border-blue-200',4:'bg-slate-100 text-slate-700 border-slate-200'})[Number(value)] || 'bg-blue-50 text-blue-800 border-blue-200'; },
  jobsFor(report) { return this.work.filter(w => w.incident_id === report.incident_id && w.status !== 'cancelled'); },
  stageFor(report) {
    const jobs = this.jobsFor(report);
    if (jobs.some(w => w.status !== 'completed' && w.assigned_to)) return 'dispatched';
    if (jobs.length && jobs.every(w => w.status === 'completed')) return 'completed';
    if (['resolved', 'closed'].includes(report.status)) return 'completed';
    return 'new';
  },
  async fetchData() {
    const member = await API.getActiveMembership();
    if (!member || member.role !== 'report_admin') throw new Error('Report administrator access required.');
    const [result, work] = await Promise.all([
      API.client.from('campusops_reports').select('*,reporter:campusops_members!campusops_reports_college_id_reporter_id_fkey!inner(role),campus:campusops_campuses(name),department:campusops_departments(name),room:campusops_rooms(name,building:campusops_buildings(name))').eq('college_id',member.college_id).eq('reporter.role','student').order('created_at',{ascending:false}).limit(200),
      API.getWorkOrders(member.college_id)
    ]);
    if (result.error) throw result.error;
    return {reports: result.data || [], work};
  },
  async load(container) {
    this.container = container;
    container.innerHTML = '<p class="p-6 text-sm">Loading student reports…</p>';
    try {
      Object.assign(this, await this.fetchData());
      container.innerHTML = `<div class="space-y-5">
        <header class="rounded-3xl bg-indigo-800 text-white p-6"><span class="text-xs uppercase tracking-wider">Report administration</span><h1 class="text-2xl font-bold mt-2">Student reports</h1><p class="text-sm mt-2">Assign new reports, track each technician’s work, and review completed repairs.</p></header>
        <div class="flex gap-2"><button type="button" id="adminQueueMode" class="px-4 py-2 rounded-xl border">Work queue</button><button type="button" id="adminHistoryMode" class="px-4 py-2 rounded-xl border">All report history</button></div>
        <div id="adminReportTabs" role="tablist" aria-label="Report stages" class="flex flex-wrap gap-2"></div>
        <div class="flex flex-wrap gap-3"><label class="flex-1 text-sm">Find a report<input id="adminReportSearch" placeholder="Issue, technician or room" class="block w-full mt-1 p-3 border rounded-xl bg-white dark:bg-slate-900"></label><select id="adminReportDateFilter" class="p-3 border rounded-xl bg-white dark:bg-slate-900" aria-label="Filter reports by age"><option value="0">Any date</option><option value="7">Last 7 days</option><option value="30">Last 30 days</option></select><button type="button" id="adminReportsRefresh" class="px-4 py-2 border rounded-xl">Refresh</button></div>
        <p id="adminReportRefreshStatus" role="status" class="text-xs text-slate-500">Updates automatically every 30 seconds. Showing up to 200 recent student reports.</p>
        <p class="text-xs text-slate-500">Review order: Critical → High → Medium → Low.</p><div id="adminReportsList" role="tabpanel" class="flex flex-col gap-4"></div></div>`;
      document.getElementById('adminReportSearch').oninput = () => this.render();
      document.getElementById('adminReportDateFilter').onchange = () => this.render();
      document.getElementById('adminQueueMode').onclick = () => {this.historyMode=false;this.render();};
      document.getElementById('adminHistoryMode').onclick = () => {this.historyMode=true;this.render();};
      document.getElementById('adminReportsRefresh').onclick = () => this.refresh(true);
      this.render();
    } catch(error) {
      container.innerHTML = '<div class="p-6 border rounded-2xl"><h2 class="font-bold">Unable to load the report inbox</h2><p class="text-sm mt-2">'+this.escape(error.message)+'</p><button class="mt-3 underline" type="button">Retry</button></div>';
      container.querySelector('button').onclick = () => this.load(container);
    }
  },
  async refresh(manual=false) {
    if(!manual && Date.now()-(this.lastRefresh||0)<30000)return;
    this.lastRefresh=Date.now();
    if (this.loading || this.busy || !document.getElementById('adminReportsList')) return;
    this.loading = true;
    try {
      const data = await this.fetchData();
      if (API._currentMember?.role !== 'report_admin' || !document.getElementById('adminReportsList')) return;
      if(JSON.stringify(data)!==JSON.stringify({reports:this.reports,work:this.work})){const y=window.scrollY;const expanded=new Set([...document.querySelectorAll("#adminReportsList article")].filter(a=>a.querySelector("details[open]")).map(a=>a.dataset.reportId));Object.assign(this,data);this.render();document.querySelectorAll("#adminReportsList article").forEach(a=>{if(expanded.has(a.dataset.reportId)&&a.querySelector("details"))a.querySelector("details").open=true;});window.scrollTo(0,y);}
      document.getElementById('adminReportRefreshStatus').textContent = 'Updated '+new Date().toLocaleTimeString()+'. Updates automatically every 30 seconds.';
    } catch(error) {
      const status = document.getElementById('adminReportRefreshStatus');
      if(status) status.textContent = 'Refresh failed: '+error.message+'. Use Refresh to retry.';
    } finally { this.loading = false; }
  },
  selectStage(stage) { this.activeStage = stage; this.render(); },
  render() {
    const search = document.getElementById('adminReportSearch');
    if (!search) return;
    const query = search.value.toLowerCase();
    const stages = this.historyMode ? [['all','All reports'],['pending','Pending / not resolved'],['dispatched','Dispatched'],['completed','Resolved / completed']] : [['new','New Reports'],['dispatched','Dispatched Orders'],['completed','Completed Work']];
    document.getElementById('adminQueueMode').classList.toggle('bg-indigo-600',!this.historyMode);document.getElementById('adminQueueMode').classList.toggle('text-white',!this.historyMode);
    document.getElementById('adminHistoryMode').classList.toggle('bg-indigo-600',this.historyMode);document.getElementById('adminHistoryMode').classList.toggle('text-white',this.historyMode);
    document.getElementById('adminReportTabs').innerHTML = stages.map(([id,label]) => `<button type="button" role="tab" aria-selected="${this.activeStage===id}" onclick="ReportAdmin.selectStage('${id}')" class="px-4 py-3 rounded-xl border font-semibold text-sm ${this.activeStage===id?'bg-indigo-600 text-white':'bg-white dark:bg-slate-800'}">${label} <span class="ml-2">${this.reports.filter(r=>this.stageFor(r)===id).length}</span></button>`).join('');
    const age=Number(document.getElementById('adminReportDateFilter')?.value||0),cutoff=age?Date.now()-age*86400000:0;
    const rows = this.reports.filter(r => (!this.historyMode || this.activeStage==='all' || (this.activeStage==='pending' ? !['resolved','closed'].includes(r.status) : this.stageFor(r)===this.activeStage)) && (!cutoff||new Date(r.created_at).getTime()>=cutoff) && [r.description,r.department?.name,r.room?.name,r.equipment_description,...this.jobsFor(r).map(w=>w.assigned_user?.full_name)].some(x=>(x||'').toLowerCase().includes(query))).sort((a,b)=>this.reviewPriority(a)-this.reviewPriority(b) || new Date(b.created_at)-new Date(a.created_at));
    document.getElementById('adminReportsList').innerHTML = rows.length ? rows.map(r => {
      const jobs = this.jobsFor(r), stage = this.stageFor(r);
      return `<article data-report-id="${r.id}" class="p-5 bg-white dark:bg-slate-800 border rounded-2xl">
        <div class="flex justify-between text-xs"><strong>${stage==='new'?'Awaiting dispatch':stage==='completed'?'Completed':'Dispatched'}</strong><span class="px-2.5 py-1 rounded-full border font-semibold ${this.priorityClass(this.reviewPriority(r))}">${this.priorityLabel(this.reviewPriority(r))} review priority</span></div>
        <h2 class="font-bold mt-3">${this.escape(r.description)}</h2><p class="text-xs mt-2 font-semibold">${1+Number(r.supporter_count||0)} student(s) affected</p>
        <p class="text-xs mt-1 text-slate-500">${this.escape(r.campus?.name)} · ${this.escape(r.room?.building?.name)} · ${this.escape(r.room?.name || 'Room needed')}</p>
        <p class="text-xs mt-2">${this.escape(r.category)}${r.equipment_description?' · '+this.escape(r.equipment_description):''}</p>
        ${jobs.length || stage==='completed'?`<details class="mt-3 text-sm"><summary class="cursor-pointer text-xs font-semibold text-slate-500">Completed work and status</summary><div class="mt-2">${jobs.map(w=>`<div class="p-3 rounded-xl bg-slate-50 dark:bg-slate-900 text-sm"><strong>${w.status==='completed'?'Completed by':'Assigned to'}: ${this.escape(w.assigned_user?.full_name || (w.assigned_to?'Assigned technician':'Awaiting technician'))}</strong><p class="mt-1 capitalize">${this.escape(w.status.replaceAll('_',' '))}</p>${w.completion_note?'<p class="mt-2">'+this.escape(w.completion_note)+'</p>':''}${w.completed_at?'<p class="mt-1 text-xs">'+this.escape(new Date(w.completed_at).toLocaleString())+'</p>':''}</div>`).join('')}${stage==='completed'?'<p class="mt-3 text-xs">'+(['resolved','closed'].includes(r.status)?'Report resolved.':'Repair finished; report resolution is pending.')+'</p>':''}</div></details>`:''}
        <div class="flex gap-2 mt-4"><button type="button" onclick="ReportAdmin.openReport('${r.id}')" class="px-4 py-2 bg-indigo-600 text-white rounded-xl text-sm">${stage==='new'?'Review photo & dispatch':stage==='dispatched'?'View assignment & photos':'View completed work'}</button>${this.historyMode?`<button type="button" onclick="ReportAdmin.deleteReport('${r.id}')" class="px-4 py-2 border border-rose-500 text-rose-600 rounded-xl text-sm">Delete report</button>`:''}</div></article>`;
    }).join('') : '<p class="p-6 text-sm text-slate-500">No matching reports in this tab.</p>';
  },
  async deleteReport(id) {
    const report=this.reports.find(r=>r.id===id);if(!report||this.busy)return;
    if(!confirm('Permanently delete this report from report history? Technician work orders and audit history will remain.'))return;
    this.busy=true;
    try{const {error}=await API.client.rpc('campusops_admin_delete_report',{p_report:id});if(error)throw error;this.reports=this.reports.filter(r=>r.id!==id);this.render();App.showToast('Report deleted from history.','success');}
    catch(error){App.showToast('Could not delete report: '+error.message,'error');}
    finally{this.busy=false;}
  },
  async openReport(id) {
    const r=this.reports.find(x=>x.id===id); if(!r||this.busy)return;
    this.selected=r; const request=++this.detailRequest;
    const jobs=this.work.filter(w=>w.incident_id===r.incident_id&&w.status!=='cancelled');
    const closed=['resolved','closed'].includes(r.status);
    const canDispatch=!closed && (!jobs.length || (jobs.length===1 && jobs[0].manual_assignment && ['open','assigned'].includes(jobs[0].status)));
    const canResolve=!closed && jobs.length>0 && jobs.every(w=>w.status==='completed');
    document.getElementById('reportAdminDetail').innerHTML=`<p class="text-sm whitespace-pre-line">${this.escape(r.description)}</p><p class="text-xs mt-2">${this.escape(r.campus?.name)} · ${this.escape(r.room?.building?.name)} · ${this.escape(r.room?.name || 'Room needed')}</p>
      <p class="text-sm mt-2">Equipment / item: ${this.escape(r.equipment_description || r.asset_id || 'Not specified')}</p>
      <p class="text-xs mt-2">${this.priorityLabel(r.priority)} priority · ${this.escape(r.extraction?.priority_reason || 'Calculated from report description')}</p>
      ${jobs.map(w=>'<p class="text-sm mt-2"><strong>'+this.escape(w.status.replaceAll('_',' '))+'</strong> · '+this.escape(w.assigned_user?.full_name || 'Unassigned')+(w.completion_note ? '<br>Completion note: '+this.escape(w.completion_note):'')+'</p>').join('')}`;
    document.getElementById('reportAdminDispatchForm').classList.toggle('hidden',!canDispatch);
    document.getElementById('reportAdminResolveForm').classList.toggle('hidden',!canResolve);
    document.getElementById('reportAdminResolution').value='';
    document.getElementById('reportAdminStatus').textContent=closed?'This report is resolved and the student has been notified.':canResolve?'The repair is complete, but report resolution is pending. Confirm resolution below to notify the student.':!canDispatch?'Waiting for the assigned technician to complete the work.':'';
    const select=document.getElementById('reportAdminTechnician');select.innerHTML='<option value="">Loading matching technicians…</option>';select.disabled=true;
    document.getElementById('reportAdminDispatchBtn').disabled=true;
    App.openModal('reportAdminModal');
    ReportPhotos.render(document.getElementById('reportAdminPhotos'),id,false);
    if(canDispatch) try {
      const {data,error}=await API.client.rpc('campusops_report_technicians',{p_report:id});if(error)throw error;
      if(request!==this.detailRequest)return;
      select.innerHTML='<option value="">Choose a technician</option>'+(data||[]).map(t=>'<option value="'+t.user_id+'" '+(!t.can_assign?'disabled':'')+'>'+this.escape(t.full_name)+' · '+this.escape(t.skills)+' · '+t.open_jobs+'/'+t.max_jobs+' jobs'+(!t.can_assign?' (unavailable)':'')+'</option>').join('');
      select.disabled=false;document.getElementById('reportAdminDispatchBtn').disabled=!(data||[]).some(t=>t.can_assign);
      if(!(data||[]).some(t=>t.can_assign)) document.getElementById('reportAdminStatus').textContent='No eligible technician currently available. Ask facilities to check campus coverage, skills, shifts and workload.';
    }catch(error){if(request===this.detailRequest)document.getElementById('reportAdminStatus').textContent='Unable to load technicians: '+error.message;}
  },
  async dispatch(event) {
    event.preventDefault();if(this.busy||!this.selected)return;
    const technician=document.getElementById('reportAdminTechnician').value;if(!technician)return;
    const id=this.selected.id;this.busy=true;document.getElementById('reportAdminDispatchBtn').disabled=true;
    try {
      const {data:workId,error}=await API.client.rpc('campusops_dispatch_report',{p_report:id,p_technician:technician});if(error)throw error;
      if(!workId)throw new Error('No assignment confirmation returned. Refresh before trying again.');
      const member=await API.getActiveMembership();
      const work=await API.getWorkOrders(member.college_id);
      const saved=work.find(w=>w.id===workId && w.assigned_to===technician);
      if(!saved)throw new Error('The assignment could not be confirmed. Refresh the report list before retrying.');
      this.activeStage='dispatched';
      App.showToast('Assigned to '+(saved.assigned_user?.full_name || 'the selected technician')+'. Visible in Dispatched Orders.','success');App.closeModals();await this.load(this.container);
    }catch(error){document.getElementById('reportAdminStatus').textContent=error.message;document.getElementById('reportAdminDispatchBtn').disabled=false;}
    finally{this.busy=false;}
  },
  async resolve(event) {
    event.preventDefault();if(this.busy||!this.selected)return;
    const summary=document.getElementById('reportAdminResolution').value.trim();if(summary.length<5)return;
    this.busy=true;document.getElementById('reportAdminResolveBtn').disabled=true;
    try {
      await API.resolveIncident({p_incident:this.selected.incident_id,p_summary:summary});
      App.showToast('Report resolved. The student has been notified.','success');App.closeModals();await this.load(this.container);
    }catch(error){document.getElementById('reportAdminStatus').textContent=error.message;}
    finally{this.busy=false;document.getElementById('reportAdminResolveBtn').disabled=false;}
  }
};
window.ReportAdmin=ReportAdmin;


