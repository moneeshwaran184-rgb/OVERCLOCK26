/* Report inbox stages are derived from persisted work orders, not local guesses. */
const ReportAdmin = {
  grouping:false, groupedSignature:'', groupRetryAt:0, groupPasses:0,
  async groupNewReports(force=false){
    if(this.grouping||this.busy||!document.getElementById('adminGroupingStatus'))return;
    const member=await API.getActiveMembership();if(member?.role!=='report_admin')return;
    const pending=this.reports.filter(r=>this.stageFor(r)==='new');
    const signature=JSON.stringify([member.college_id,pending.map(r=>[r.id,r.description,r.room_id,r.asset_id,r.category,r.equipment_description])]);
    if(!force&&(signature===this.groupedSignature||Date.now()<this.groupRetryAt))return;
    if(!force)this.groupPasses=0;
    this.grouping=true;
    const status=document.getElementById('adminGroupingStatus');status.textContent='AI is checking new reports for duplicate issues…';
    try{
      const {data,error}=await API.client.functions.invoke('campusops-group-reports',{body:{college_id:member.college_id}});
      if(error||data?.error)throw new Error(data?.error||'Deploy campusops-group-reports and the admin grouping SQL, then retry.');
      if(API._currentMember?.college_id!==member.college_id||API._currentMember?.role!=='report_admin')return;
      const merged=Number(data.merged||0);
      if(merged){Object.assign(this,await this.fetchData());if(document.getElementById('adminReportsList'))this.render();}
      if(data.candidates===undefined){
        status.textContent=data.remaining?'AI review is continuing on the next refresh.':`AI duplicate review complete. ${merged} report(s) combined this pass.`;
        if(!data.remaining)this.groupedSignature=signature;
        this.groupRetryAt=Date.now()+10000;
        return;
      }
      const candidates=Number(data.candidates)||0, pairs=Number(data.pairs)||0, reviewed=Number(data.reviewed)||0;
      const skipped=data.skipped||{};
      let message;
      if(candidates<2){
        const ineligible=Math.max(0,pending.length-candidates);
        message=`Only ${candidates} open student report(s) are eligible for AI comparison.`;
        message+=ineligible?` ${ineligible} of the ${pending.length} new report(s) have no room, or already have a work order, so they are skipped.`:' At least two reports in the same room are needed.';
      }else if(!pairs)message=`${candidates} report(s) checked, but no two share the same room${skipped.other_room?` (${skipped.other_room} pair(s) skipped: different rooms)`:''}. Duplicate detection only merges reports from one room.`;
      else message=`AI compared ${pairs} pair(s), reviewed ${reviewed} with the model and combined ${merged} report(s) this pass${skipped.category?` (${skipped.category} pair(s) skipped: different categories)`:''}.`;
      const near=Number(data.near_miss)||0, refused=Number(data.refused)||0;
      if(near)message+=` ${near} pair(s) looked similar but scored below the 90% confidence required to merge automatically.`;
      if(refused)message+=` ${refused} merge(s) were blocked by the database safety rules — apply supabase/20261101_duplicate_group_category_fix.sql.`;
      if(data.remaining)message+=' More pairs are queued — continuing automatically…';
      status.textContent=message;
      if(!data.remaining){
        this.groupedSignature=signature;this.groupPasses=0;
      }else if(this.groupPasses<3){
        this.groupPasses++;
        setTimeout(()=>{void this.groupNewReports(true);},1200);
      }
      this.groupRetryAt=Date.now()+10000;
    }catch(e){status.textContent='AI grouping unavailable: '+e.message;this.groupRetryAt=Date.now()+60000;}
    finally{this.grouping=false;}
  },
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
  activeStage: 'new', loading: false, historyMode: false, historyReports:[],
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
    const [result, work, history] = await Promise.all([
      API.client.rpc('campusops_admin_report_groups',{p_college:member.college_id}),
      API.getWorkOrders(member.college_id),
      API.client.from('campusops_reports').select('*,reporter:campusops_members!campusops_reports_college_id_reporter_id_fkey!inner(role),campus:campusops_campuses(name),department:campusops_departments(name),room:campusops_rooms(name,building:campusops_buildings(name))').eq('college_id',member.college_id).eq('reporter.role','student').order('created_at',{ascending:false}).limit(200)
    ]);
    if (result.error) throw result.error; if(history.error)throw history.error;
    return {reports: result.data || [], work, historyReports:history.data||[]};
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
        <div id="adminGroupingPanel" class="p-3 border rounded-xl"><p id="adminGroupingStatus" role="status">AI duplicate review pending.</p><button type="button" onclick="ReportAdmin.groupNewReports(true)" class="underline mt-2">Check duplicates with AI</button></div>
        <div class="flex flex-wrap gap-3"><label class="flex-1 text-sm">Find a report<input id="adminReportSearch" placeholder="Issue, technician or room" class="block w-full mt-1 p-3 border rounded-xl bg-white dark:bg-slate-900"></label><select id="adminReportDateFilter" class="p-3 border rounded-xl bg-white dark:bg-slate-900" aria-label="Filter reports by age"><option value="0">Any date</option><option value="7">Last 7 days</option><option value="30">Last 30 days</option></select><button type="button" id="adminReportsRefresh" class="px-4 py-2 border rounded-xl">Refresh</button></div>
        <p id="adminReportRefreshStatus" role="status" class="text-xs text-slate-500">Use Refresh to load the latest reports. Showing grouped issues in the queue and individual reports in history.</p>
        <p class="text-xs text-slate-500">Review order: Critical → High → Medium → Low.</p><div id="adminReportsList" role="tabpanel" class="flex flex-col gap-4"></div></div>`;
      document.getElementById('adminReportSearch').oninput = () => this.render();
      document.getElementById('adminReportDateFilter').onchange = () => this.render();
      document.getElementById('adminQueueMode').onclick = () => {this.historyMode=false;this.activeStage='new';this.render();};
      document.getElementById('adminHistoryMode').onclick = () => {this.historyMode=true;this.activeStage='all';this.render();};
      document.getElementById('adminReportsRefresh').onclick = () => this.refresh(true);
      this.render();
      void this.groupNewReports();
    } catch(error) {
      container.innerHTML = '<div class="p-6 border rounded-2xl"><h2 class="font-bold">Unable to load the report inbox</h2><p class="text-sm mt-2">'+this.escape(error.message)+'</p><button class="mt-3 underline" type="button">Retry</button></div>';
      container.querySelector('button').onclick = () => this.load(container);
    }
  },
  async refresh(manual=false) {
    if (this.loading || this.busy || !document.getElementById('adminReportsList')) return;
    this.loading = true;
    const refreshButton=document.getElementById('adminReportsRefresh');
    if(refreshButton){refreshButton.disabled=true;refreshButton.textContent='Refreshing…';}
    document.getElementById('adminReportRefreshStatus').textContent='Fetching latest reports…';
    try {
      const data = await this.fetchData();
      if (API._currentMember?.role !== 'report_admin' || !document.getElementById('adminReportsList')) return;
      if(manual || JSON.stringify(data)!==JSON.stringify({reports:this.reports,work:this.work,historyReports:this.historyReports})){const y=window.scrollY;const expanded=new Set([...document.querySelectorAll("#adminReportsList article")].filter(a=>a.querySelector("details[open]")).map(a=>a.dataset.reportId));Object.assign(this,data);this.render();document.querySelectorAll("#adminReportsList article").forEach(a=>{if(expanded.has(a.dataset.reportId)&&a.querySelector("details"))a.querySelector("details").open=true;});window.scrollTo(0,y);}
      document.getElementById('adminReportRefreshStatus').textContent = 'Updated '+new Date().toLocaleTimeString()+'. Use Refresh to load the latest reports.';
      void this.groupNewReports();
    } catch(error) {
      const status = document.getElementById('adminReportRefreshStatus');
      if(status) status.textContent = 'Refresh failed: '+error.message+'. Use Refresh to retry.';
    } finally { this.loading = false;if(refreshButton){refreshButton.disabled=false;refreshButton.textContent='Refresh';} }
  },
  selectStage(stage) { this.activeStage = stage; this.render(); },
  isCombined(report) {
    if (!report) return false;
    const linked = Array.isArray(report.linked_reports) ? report.linked_reports.length : 0;
    return Number(report.affected_count || 1) > 1 || linked > 0;
  },
  combinedCount(report) {
    if (!report) return 1;
    const linked = Array.isArray(report.linked_reports) ? report.linked_reports.length : 0;
    return Math.max(Number(report.affected_count || 1), 1 + linked);
  },
  render() {
    const search = document.getElementById('adminReportSearch');
    if (!search) return;
    const query = search.value.toLowerCase();
    const visibleReports=this.historyMode?this.historyReports:this.reports;
    // In history, an already-combined report is represented by its canonical row.
    // Duplicate rows stay visible in "All reports" but must not be counted again in
    // Dispatched or Completed just because they share the canonical work order.
    const stageMatches=(r,stage=this.activeStage)=>{
      if(!this.historyMode)return this.stageFor(r)===stage;
      if(r.duplicate_of)return stage==='all';
      if(stage==='all')return true;
      if(stage==='pending')return !['resolved','closed'].includes(r.status);
      return this.stageFor(r)===stage;
    };
    const stages = this.historyMode ? [['all','All reports'],['pending','Pending / not resolved'],['dispatched','Dispatched'],['completed','Resolved / completed']] : [['new','New Reports'],['dispatched','Dispatched Orders'],['completed','Completed Work']];
    document.getElementById('adminQueueMode').classList.toggle('bg-indigo-600',!this.historyMode);document.getElementById('adminQueueMode').classList.toggle('text-white',!this.historyMode);
    document.getElementById('adminHistoryMode').classList.toggle('bg-indigo-600',this.historyMode);document.getElementById('adminHistoryMode').classList.toggle('text-white',this.historyMode);
    document.getElementById('adminReportTabs').innerHTML = stages.map(([id,label]) => `<button type="button" role="tab" aria-selected="${this.activeStage===id}" onclick="ReportAdmin.selectStage('${id}')" class="px-4 py-3 rounded-xl border font-semibold text-sm ${this.activeStage===id?'bg-indigo-600 text-white':'bg-white dark:bg-slate-800'}">${label} <span class="ml-2">${visibleReports.filter(r=>stageMatches(r,id)).length}</span></button>`).join('');
    // AI duplicate grouping only runs on the New Reports queue. Hide its panel on
    // Dispatched / Completed / history so those tabs show grouped results only.
    const groupingPanel=document.getElementById('adminGroupingPanel');
    if(groupingPanel)groupingPanel.classList.toggle('hidden',this.historyMode||this.activeStage!=='new');
    const age=Number(document.getElementById('adminReportDateFilter')?.value||0),cutoff=age?Date.now()-age*86400000:0;
    const rows = visibleReports.filter(r => stageMatches(r) && (!cutoff||new Date(r.created_at).getTime()>=cutoff) && [r.description,r.department?.name,r.room?.name,r.equipment_description,...this.jobsFor(r).map(w=>w.assigned_user?.full_name)].some(x=>(x||'').toLowerCase().includes(query))).sort((a,b)=>this.reviewPriority(a)-this.reviewPriority(b) || new Date(b.created_at)-new Date(a.created_at));
    document.getElementById('adminReportsList').innerHTML = rows.length ? rows.map(r => {
      const jobs = this.jobsFor(r), stage = this.stageFor(r);
      const grouped = this.reports.find(x=>x.id===r.id) || r;
      const linked = Array.isArray(grouped.linked_reports) ? grouped.linked_reports : [];
      const combined = !r.duplicate_of && this.isCombined(grouped);
      const affected = this.combinedCount(grouped);
      const badge = combined
        ? `<span class="px-2.5 py-1 rounded-full border font-semibold bg-indigo-100 text-indigo-800 border-indigo-200">${affected} reports combined</span>`
        : r.duplicate_of
          ? '<span class="px-2.5 py-1 rounded-full border font-semibold bg-indigo-50 text-indigo-700 border-indigo-200">Combined</span>'
          : `<span class="px-2.5 py-1 rounded-full border font-semibold ${this.priorityClass(this.reviewPriority(r))}">${this.priorityLabel(this.reviewPriority(r))}${stage==='new'&&!this.historyMode?' review priority':' priority'}</span>`;
      const header = r.duplicate_of ? 'Combined into another report' : stage==='new'?'Awaiting dispatch':stage==='completed'?'Completed':'Dispatched';
      const combinedDetails = combined ? `<details class="mt-3 text-sm"><summary class="cursor-pointer text-xs font-semibold text-slate-500">Combined student reports (${linked.length})</summary><div class="mt-2 space-y-2">${linked.map(child=>`<div class="p-3 rounded-xl bg-slate-50 dark:bg-slate-900 text-sm"><strong>${this.escape(child.reporter_name || child.student_name || 'Student')}</strong><p class="text-xs">${this.escape(new Date(child.created_at).toLocaleString())}</p><p class="mt-1 whitespace-pre-wrap">${this.escape(child.description)}</p></div>`).join('')}</div></details>` : '';
      const aiDetails = combined || r.duplicate_of || this.historyMode || stage !== 'new' ? '' : `<details class="mt-3 text-sm"><summary class="cursor-pointer text-xs font-semibold text-slate-500">AI priority review</summary><div class="mt-2 p-3 border rounded-xl">
        ${this.aiFor(r)?'<strong>AI suggests '+this.priorityLabel(this.aiFor(r).priority)+'</strong><p>'+this.escape(this.aiFor(r).reason)+'</p><p>Category: '+this.escape(this.aiFor(r).category)+'</p><p>'+this.escape(this.aiFor(r).summary)+'</p>':'<button type="button" data-report="'+r.id+'" onclick="ReportAdmin.analysePriority(this.dataset.report)" '+(this.aiPending.has(r.id)?'disabled':'')+' class="underline">'+(this.aiPending.has(r.id)?'Reviewing with AI…':'Review priority with AI')+'</button>'}
        <p class="text-xs mt-2">Workflow priority: ${this.priorityLabel(r.priority)}. AI review does not change dispatch rules or SLA.</p></div></details>`;
      const duplicateNote = r.duplicate_of ? `<p class="mt-3 text-xs font-semibold text-indigo-700 dark:text-indigo-300">This report was combined with another student report. Open the original report to see the shared group and work order.</p>` : '';
      return `<article data-report-id="${r.id}" class="p-5 bg-white dark:bg-slate-800 border rounded-2xl">
        <div class="flex justify-between gap-2 text-xs"><strong>${header}</strong>${badge}</div>
        <h2 class="font-bold mt-3">${this.escape(r.description)}</h2><p class="text-xs mt-2 font-semibold">${r.duplicate_of?'Combined with other reports':`${affected} student(s) affected`}</p>
        <p class="text-xs mt-1 text-slate-500">${this.escape(r.campus?.name)} · ${this.escape(r.room?.building?.name)} · ${this.escape(r.room?.name || 'Room needed')}</p>
        <p class="text-xs mt-2">${this.escape(r.category)}${r.equipment_description?' · '+this.escape(r.equipment_description):''}</p>
        ${duplicateNote}${combinedDetails}${aiDetails}
        ${!r.duplicate_of && (jobs.length || stage==='completed')?`<details class="mt-3 text-sm"><summary class="cursor-pointer text-xs font-semibold text-slate-500">Completed work and status</summary><div class="mt-2">${jobs.map(w=>`<div class="p-3 rounded-xl bg-slate-50 dark:bg-slate-900 text-sm"><strong>${w.status==='completed'?'Completed by':'Assigned to'}: ${this.escape(w.assigned_user?.full_name || (w.assigned_to?'Assigned technician':'Awaiting technician'))}</strong><p class="mt-1 capitalize">${this.escape(w.status.replaceAll('_',' '))}</p>${w.completion_note?'<p class="mt-2">'+this.escape(w.completion_note)+'</p>':''}${w.completed_at?'<p class="mt-1 text-xs">'+this.escape(new Date(w.completed_at).toLocaleString())+'</p>':''}</div>`).join('')}${stage==='completed'?'<p class="mt-3 text-xs">'+(['resolved','closed'].includes(r.status)?'Report resolved.':'Repair finished; report resolution is pending.')+'</p>':''}</div></details>`:''}
        <div class="flex gap-2 mt-4"><button type="button" onclick="ReportAdmin.openReport('${r.duplicate_of || r.id}')" class="px-4 py-2 bg-indigo-600 text-white rounded-xl text-sm">${r.duplicate_of?'Open original report':stage==='new'?'Review photo & dispatch':stage==='dispatched'?'View assignment & photos':'View completed work'}</button>${this.historyMode?`<button type="button" onclick="ReportAdmin.deleteReport('${r.id}')" class="px-4 py-2 border border-rose-500 text-rose-600 rounded-xl text-sm">Delete report</button>`:''}</div></article>`;
    }).join('') : '<p class="p-6 text-sm text-slate-500">No matching reports in this tab.</p>';
  },
  async deleteReport(id) {
    const report=[...this.reports,...this.historyReports].find(r=>r.id===id);if(!report||this.busy)return;
    if(!confirm('Permanently delete this report from report history? Technician work orders and audit history will remain.'))return;
    this.busy=true;
    try{const {error}=await API.client.rpc('campusops_admin_delete_report',{p_report:id});if(error)throw error;Object.assign(this,await this.fetchData());this.render();App.showToast('Report deleted from history.','success');}
    catch(error){App.showToast('Could not delete report: '+error.message,'error');}
    finally{this.busy=false;}
  },
  async openReport(id) {
    const r=[...this.reports,...this.historyReports].find(x=>x.id===id); if(!r||this.busy)return;
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
    const detail=document.getElementById('reportAdminDetail');
    for(const child of r.linked_reports||[]){
      const section=document.createElement('section');section.className='p-3 mt-3 border rounded-xl';
      const label=document.createElement('p');label.textContent=child.reporter_name+' · '+new Date(child.created_at).toLocaleString()+' · '+child.description;section.append(label);
      const photos=document.createElement('div');section.append(photos);detail.append(section);ReportPhotos.render(photos,child.id,false);
      if(!closed&&!jobs.length){const button=document.createElement('button');button.type='button';button.className='underline';button.textContent='Unlink into a separate issue';button.onclick=async()=>{button.disabled=true;try{const {error}=await API.client.rpc('campusops_unlink_duplicate',{p_report:child.id});if(error)throw error;App.closeModals();await this.load(this.container);}catch(e){App.showToast(e.message,'error');button.disabled=false;}};section.append(button);}
    }

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


