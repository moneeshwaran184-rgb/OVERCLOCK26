/* Report inbox stages are derived from persisted work orders, not local guesses. */
const ReportAdmin = {
  aiCache:new Map(), aiPending:new Set(),
  aiKey(r){return JSON.stringify([API._currentMember?.user_id,r.college_id,r.id,r.description,r.room_id,r.equipment_description,r.category]);},
  aiFor(r){return this.aiCache.get(this.aiKey(r));},
  reviewPriority(r){return this.aiFor(r)?.priority || Number(r.priority) || 3;},
  async analysePriority(id){
    const r=this.reports.find(x=>x.id===id);if(!r||this.aiPending.has(id)||this.aiFor(r))return;
    const key=this.aiKey(r);this.aiPending.add(id);this.render();
    try{const {data,error}=await API.client.functions.invoke('rapid-action',{body:{mode:'admin_priority',report_id:id}});
      if(error||data?.error)throw new Error(data?.error||'AI review failed. Check the deployed function and quota.');
      if(!Number.isInteger(data.priority)||data.priority<1||data.priority>4)throw new Error('AI returned an invalid priority.');
      this.aiCache.set(key,{priority:data.priority,reason:String(data.priority_reason||''),category:String(data.category||''),summary:String(data.summary||'')});
      App.showToast('AI priority review saved for this session.','success');
    }catch(e){App.showToast(e.message,'error');}finally{this.aiPending.delete(id);this.render();}
  },
  reports: [], work: [], selected: null, container: null, busy: false, detailRequest: 0,
  activeStage: 'new', loading: false,
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
      API.client.from('campusops_reports').select('*,reporter:campusops_members!campusops_reports_college_id_reporter_id_fkey!inner(full_name,role),campus:campusops_campuses(name),department:campusops_departments(name),room:campusops_rooms(name,building:campusops_buildings(name))').eq('college_id',member.college_id).eq('reporter.role','student').order('created_at',{ascending:false}).limit(200),
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
        <div id="adminReportTabs" role="tablist" aria-label="Report stages" class="flex flex-wrap gap-2"></div>
        <div class="flex flex-wrap gap-3"><label class="flex-1 text-sm">Find a report<input id="adminReportSearch" placeholder="Student, technician, issue, department or room" class="block w-full mt-1 p-3 border rounded-xl bg-white dark:bg-slate-900"></label><button type="button" id="adminReportsRefresh" class="px-4 py-2 border rounded-xl">Refresh</button></div>
        <p id="adminReportRefreshStatus" role="status" class="text-xs text-slate-500">Updates automatically every 10 seconds. Showing up to 200 recent student reports.</p>
        <p class="text-xs text-slate-500">Review order: Critical → High → Medium → Low. Reports are sorted by AI review when available. Reviews are reused during this session.</p><div id="adminReportsList" role="tabpanel" class="flex flex-col gap-4"></div></div>`;
      document.getElementById('adminReportSearch').oninput = () => this.render();
      document.getElementById('adminReportsRefresh').onclick = () => this.refresh();
      this.render();
    } catch(error) {
      container.innerHTML = '<div class="p-6 border rounded-2xl"><h2 class="font-bold">Unable to load the report inbox</h2><p class="text-sm mt-2">'+this.escape(error.message)+'</p><button class="mt-3 underline" type="button">Retry</button></div>';
      container.querySelector('button').onclick = () => this.load(container);
    }
  },
  async refresh() {
    if (this.loading || this.busy || !document.getElementById('adminReportsList')) return;
    this.loading = true;
    try {
      const data = await this.fetchData();
      if (API._currentMember?.role !== 'report_admin' || !document.getElementById('adminReportsList')) return;
      Object.assign(this, data); this.render();
      document.getElementById('adminReportRefreshStatus').textContent = 'Updated '+new Date().toLocaleTimeString()+'. Updates automatically every 10 seconds.';
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
    const stages = [['new','New Reports'],['dispatched','Dispatched Orders'],['completed','Completed Work']];
    document.getElementById('adminReportTabs').innerHTML = stages.map(([id,label]) => `<button type="button" role="tab" aria-selected="${this.activeStage===id}" onclick="ReportAdmin.selectStage('${id}')" class="px-4 py-3 rounded-xl border font-semibold text-sm ${this.activeStage===id?'bg-indigo-600 text-white':'bg-white dark:bg-slate-800'}">${label} <span class="ml-2">${this.reports.filter(r=>this.stageFor(r)===id).length}</span></button>`).join('');
    const rows = this.reports.filter(r => this.stageFor(r)===this.activeStage && [r.description,r.reporter?.full_name,r.department?.name,r.room?.name,r.equipment_description,...this.jobsFor(r).map(w=>w.assigned_user?.full_name)].some(x=>(x||'').toLowerCase().includes(query))).sort((a,b)=>this.reviewPriority(a)-this.reviewPriority(b) || new Date(b.created_at)-new Date(a.created_at));
    document.getElementById('adminReportsList').innerHTML = rows.length ? rows.map(r => {
      const jobs = this.jobsFor(r), stage = this.stageFor(r);
      return `<article class="p-5 bg-white dark:bg-slate-800 border rounded-2xl">
        <div class="flex justify-between text-xs"><strong>${stage==='new'?'Awaiting dispatch':stage==='completed'?'Completed':'Dispatched'}</strong><span class="px-2.5 py-1 rounded-full border font-semibold ${this.priorityClass(this.reviewPriority(r))}">${this.priorityLabel(this.reviewPriority(r))} review priority</span></div>
        <h2 class="font-bold mt-3">${this.escape(r.description)}</h2><p class="text-xs mt-2 font-semibold">${1+Number(r.supporter_count||0)} student(s) affected</p><p class="text-sm mt-2">${this.escape(r.reporter?.full_name)} · ${this.escape(r.department?.name)}</p>
        <p class="text-xs mt-1 text-slate-500">${this.escape(r.campus?.name)} · ${this.escape(r.room?.building?.name)} · ${this.escape(r.room?.name || 'Room needed')}</p>
        <p class="text-xs mt-2">${this.escape(r.category)}${r.equipment_description?' · '+this.escape(r.equipment_description):''}</p>
        <details class="mt-3 text-sm"><summary class="cursor-pointer text-xs font-semibold text-slate-500">AI priority review</summary><div class="mt-2 p-3 border rounded-xl">
        ${this.aiFor(r)?'<strong>AI suggests '+this.priorityLabel(this.aiFor(r).priority)+'</strong><p>'+this.escape(this.aiFor(r).reason)+'</p><p>Category: '+this.escape(this.aiFor(r).category)+'</p><p>'+this.escape(this.aiFor(r).summary)+'</p>':'<button type="button" data-report="'+r.id+'" onclick="ReportAdmin.analysePriority(this.dataset.report)" '+(this.aiPending.has(r.id)?'disabled':'')+' class="underline">'+(this.aiPending.has(r.id)?'Reviewing with AI…':'Review priority with AI')+'</button>'}
        <p class="text-xs mt-2">Workflow priority: ${this.priorityLabel(r.priority)}. AI review does not change dispatch rules or SLA.</p></div></details>
        ${jobs.length || stage==='completed'?`<details class="mt-3 text-sm"><summary class="cursor-pointer text-xs font-semibold text-slate-500">Completed work and status</summary><div class="mt-2">${jobs.map(w=>`<div class="p-3 rounded-xl bg-slate-50 dark:bg-slate-900 text-sm"><strong>${w.status==='completed'?'Completed by':'Assigned to'}: ${this.escape(w.assigned_user?.full_name || (w.assigned_to?'Assigned technician':'Awaiting technician'))}</strong><p class="mt-1 capitalize">${this.escape(w.status.replaceAll('_',' '))}</p>${w.completion_note?'<p class="mt-2">'+this.escape(w.completion_note)+'</p>':''}${w.completed_at?'<p class="mt-1 text-xs">'+this.escape(new Date(w.completed_at).toLocaleString())+'</p>':''}</div>`).join('')}${stage==='completed'?'<p class="mt-3 text-xs">'+(['resolved','closed'].includes(r.status)?'Report resolved.':'Repair finished; report resolution is pending.')+'</p>':''}</div></details>`:''}
        <button type="button" onclick="ReportAdmin.openReport('${r.id}')" class="mt-4 px-4 py-2 bg-indigo-600 text-white rounded-xl text-sm">${stage==='new'?'Review photo & dispatch':stage==='dispatched'?'View assignment & photos':'View completed work'}</button></article>`;
    }).join('') : '<p class="p-6 text-sm text-slate-500">No matching reports in this tab.</p>';
  },
  async openReport(id) {
    const r=this.reports.find(x=>x.id===id); if(!r||this.busy)return;
    this.selected=r; const request=++this.detailRequest;
    const jobs=this.work.filter(w=>w.incident_id===r.incident_id&&w.status!=='cancelled');
    const closed=['resolved','closed'].includes(r.status);
    const canDispatch=!closed && (!jobs.length || (jobs.length===1 && jobs[0].manual_assignment && ['open','assigned'].includes(jobs[0].status)));
    const canResolve=!closed && jobs.length>0 && jobs.every(w=>w.status==='completed');
    document.getElementById('reportAdminDetail').innerHTML=`<p class="text-sm whitespace-pre-line">${this.escape(r.description)}</p><p class="text-xs mt-2">${this.escape(r.reporter?.full_name)} · ${this.escape(r.department?.name)} · ${this.escape(r.campus?.name)} · ${this.escape(r.room?.building?.name)} · ${this.escape(r.room?.name || 'Room needed')}</p>
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


