const CampusReports={
 rows:[], filters:{query:'',campus:'',building:'',room:''},
 esc(v){return App.escapeHtml(String(v??''));},
 async load(){
 const host=document.getElementById('campusReportsList');host.textContent='Loading campus reports…';
 try{const m=await API.getActiveMembership();const {data,error}=await API.client.rpc('campusops_shared_reports',{p_college:m.college_id});if(error)throw error;
 this.rows=(data||[]).filter(r=>!['resolved','closed'].includes(r.status));this.setup();this.render();
 }catch(e){host.textContent=e.code==='PGRST202'?'Run the Campus Reports SQL update in Supabase to enable this tab.':e.message;}
 },
 setup(){
 const host=document.getElementById('campusReportFilters');
 host.innerHTML=`<label class="block text-sm font-semibold">Search problems<input id="campusReportSearch" type="search" placeholder="Search keywords, such as water leak or Wi-Fi" class="block w-full mt-2 p-3 rounded-xl border bg-white dark:bg-slate-800"></label><div class="flex flex-wrap gap-3 mt-4">${['campus','building','room'].map(k=>`<label class="flex-1 min-w-40 text-sm capitalize">${k}<select data-location="${k}" class="block w-full mt-1 p-3 rounded-xl border bg-white dark:bg-slate-800"></select></label>`).join('')}<button id="clearCampusFilters" class="px-4 py-2 border rounded-xl self-end">Clear filters</button></div><p id="campusReportCount" role="status" class="text-sm text-slate-400 mt-3"></p>`;
 const input=document.getElementById('campusReportSearch');input.value=this.filters.query;input.oninput=()=>{this.filters.query=input.value;this.render();};
 host.querySelectorAll('[data-location]').forEach(select=>select.onchange=()=>{const key=select.dataset.location;this.filters[key]=select.value;if(key==='campus'){this.filters.building='';this.filters.room='';}if(key==='building')this.filters.room='';this.options();this.render();});
 document.getElementById('clearCampusFilters').onclick=()=>{this.filters={query:'',campus:'',building:'',room:''};this.setup();this.render();};this.options();
 },
 options(){for(const key of ['campus','building','room']){const select=document.querySelector(`[data-location="${key}"]`);const rows=this.rows.filter(r=>(key==='campus'||!this.filters.campus||r.campus_name===this.filters.campus)&&(key!=='room'||!this.filters.building||r.building_name===this.filters.building));const values=[...new Set(rows.map(r=>r[key+'_name']).filter(Boolean))].sort();if(!values.includes(this.filters[key]))this.filters[key]='';select.innerHTML=`<option value="">All ${key==='campus'?'campuses':key+'s'}</option>`+values.map(v=>`<option value="${this.esc(v)}">${this.esc(v)}</option>`).join('');select.value=this.filters[key];}},
 render(){
 const f=this.filters,terms=f.query.trim().toLowerCase().split(/\s+/).filter(Boolean);
 const rows=this.rows.filter(r=>['campus','building','room'].every(k=>!f[k]||r[k+'_name']===f[k])&&terms.every(term=>[r.id,r.description,r.category,r.campus_name,r.building_name,r.room_name].join(' ').toLowerCase().includes(term)));
 document.getElementById('campusReportCount').textContent=`${rows.length} unresolved problem${rows.length===1?'':'s'} found`;
 const host=document.getElementById('campusReportsList');host.innerHTML=rows.map(r=>`<article class="p-5 rounded-xl border bg-white dark:bg-slate-800 space-y-3"><p class="text-xs font-semibold">ID ${this.esc(r.id.slice(0,8).toUpperCase())} · ${this.esc(r.category)} · ${this.esc(r.status.replaceAll('_',' '))} · ${['','Critical','High','Medium','Low'][r.priority]||''}</p><h3 class="font-bold">${this.esc(r.description)}</h3><p class="text-sm">${this.esc([r.campus_name,r.building_name,r.room_name].filter(Boolean).join(' · '))}</p><div class="flex flex-wrap items-center justify-between gap-3"><p class="text-sm">${1+Number(r.supporter_count||0)} student(s) affected</p><button data-join="${r.id}" class="rounded-lg bg-indigo-600 text-white px-4 py-2 disabled:opacity-50" ${r.own_report||r.joined?'disabled':''}>${r.own_report?'Your report':r.joined?'You joined this report':'I have the same problem'}</button></div></article>`).join('')||'<p class="p-5 border rounded-xl">No unresolved problems match your search. Try another keyword or clear the filters.</p>';
 host.querySelectorAll('[data-join]').forEach(b=>b.onclick=()=>this.join(b));
 },
 async join(button){button.disabled=true;try{const {error}=await API.client.rpc('campusops_join_report',{p_report:button.dataset.join});if(error)throw error;App.showToast('You joined the existing report. No duplicate report was created.','success');await this.load();}catch(e){App.showToast(e.message,'error');button.disabled=false;}}
};window.CampusReports=CampusReports;
