const EmailIntake={
 tab: 'pending', query: '', reviewing:false,
 reviewText(row){
 const a=row.assessment||{},esc=v=>App.escapeHtml(String(v??''));
 if(a.error)return '<p>The previous AI review did not finish. Use Retry AI review to analyse this email again.</p><p class="ops-help">Previous error: '+esc(a.error)+'</p>';
 if(!a.summary)return '<p>This email has not been reviewed yet.</p>';
 let text='<p>'+esc(a.summary)+'</p>';
 if(a.rejected)text+='<p>'+esc(a.rejection_reason)+'</p>';
 else if(a.review_version===2){text+='<p>'+esc(a.location?'The reported location is '+a.location+'.':'No affected room was identified.')+'</p>';if(a.is_maintenance&&a.priority)text+='<p>This appears to be a '+esc(a.category)+' issue with '+['','critical','high','medium','low'][a.priority]+' priority.</p>';}
 else text+='<p>This is an older analysis. Run AI review to check whether it belongs in the maintenance inbox.</p>';
 if(Array.isArray(a.clarification_questions))for(const q of a.clarification_questions)text+='<p>'+esc(q)+'</p>';
 return text;
 },
 async reviewPending(rows,button){
 if(this.reviewing)return;this.reviewing=true;button.disabled=true;
 try{for(let i=0;i<rows.length;i++){button.textContent='Reviewing '+(i+1)+' of '+rows.length+'…';const {data,error}=await API.client.functions.invoke('campusops-email-review',{body:{email_id:rows[i].id}});if(error||data?.error){let message=data?.error;try{const detail=await error.context.clone().json();message=detail.error||detail.message||message;}catch{}if(error?.context?.status===401)message='Your AI review request was rejected by authentication. Sign in again; if it persists, check the campusops-email-review deployment settings.';if(error?.context?.status===404)message='The campusops-email-review function is missing. Deploy it to the CampusOps Supabase project.';throw Error(message||'Could not reach campusops-email-review. Check the function deployment and your connection.');}}await this.load();}
 catch(e){App.showToast(e.message,'error');button.textContent='Retry AI review';button.disabled=false;}
 finally{this.reviewing=false;}
 },
 async load(){
 const el=document.getElementById('section-emailintake'),esc=v=>App.escapeHtml(String(v??''));
 el.textContent='Loading email intake…';
 try{
 const member=await API.getActiveMembership();if(member?.role!=='report_admin')throw Error('Report administrator required');
 const [inbox,rooms,categories]=await Promise.all([
 API.client.from('campusops_email_intake').select('*').eq('college_id',member.college_id).order('created_at',{ascending:false}).limit(100),
 API.client.from('campusops_rooms').select('id,name,building:campusops_buildings(name)').eq('college_id',member.college_id),
 API.client.from('campusops_report_categories').select('code,name').eq('college_id',member.college_id)]);
 for(const r of [inbox,rooms,categories])if(r.error)throw r.error;
 el.innerHTML='<header class="ops-heading"><div><div class="ops-eyebrow">Report administration / Inbox</div><h1>Email intake</h1><p>Review incoming maintenance requests and turn them into actionable reports.</p></div><button id="emailRefresh" class="ops-quiet-button">↻ Refresh</button></header><div class="ops-toolbar"><input id="emailSearch" type="search" aria-label="Search emails" placeholder="Search subject, message or sender…"><button id="emailClear" class="ops-quiet-button">Clear search</button></div><p class="ops-help">Confirm the sender and room before creating a report. Report creation requires a registered student sender.</p>';
 el.querySelector('#emailRefresh').onclick=()=>this.load();
 const waiting=inbox.data.filter(r=>r.status==='pending'&&r.assessment?.review_version!==2);
 if(waiting.length){const review=document.createElement('button');review.className='ops-quiet-button';review.textContent='AI review pending emails ('+Math.min(waiting.length,5)+')';review.onclick=()=>this.reviewPending(waiting.slice(0,5),review);el.querySelector('.ops-toolbar').append(review);}

 const tabs=document.createElement('div');tabs.className='flex gap-3 my-4';tabs.setAttribute('role','tablist');tabs.setAttribute('aria-label','Email status');for(const [status,label] of [['pending','Pending emails'],['rejected','Rejected emails'],['created','Created reports']]){const b=document.createElement('button');b.className='border rounded p-3';b.setAttribute('role','tab');b.setAttribute('aria-selected',String(this.tab===status));b.textContent=label+' · '+inbox.data.filter(r=>r.status===status).length;b.onclick=()=>{this.tab=status;this.load();};tabs.append(b);}el.append(tabs);
 const list=document.createElement('div');list.className='ops-email-list';el.append(list);
 const rows=inbox.data.filter(r=>r.status===this.tab);
 for(const row of rows){
 const card=document.createElement('article');card.className='ops-email-card';card.dataset.search=[row.subject,row.body,row.sender].join(' ').toLowerCase();
 card.innerHTML=`<h2>${esc(row.subject||'Untitled email')}</h2><div class="ops-email-meta"><span>${esc(row.sender)}</span><span>${esc(new Date(row.received_at).toLocaleString())}</span></div>${row.status==='rejected'?`<p>Rejected by: ${row.reviewed_by?'Report admin':'AI'} · ${esc(row.assessment?.rejection_reason||'Rejected during administrator review')}</p>`:''}<p class="ops-preview">${esc(row.assessment?.summary||row.body)}</p><details><summary>Read full email</summary><pre>${esc(row.body)}</pre></details><details><summary>AI review</summary><div class="space-y-2 mt-3">${this.reviewText(row)}</div></details>`;
 if(row.status==='pending'&&row.assessment?.review_version!==2){const retry=document.createElement('button');retry.type='button';retry.className='ops-quiet-button';retry.textContent='Retry AI review';retry.onclick=()=>this.reviewPending([row],retry);card.append(retry);}
 if(row.status==='pending'){
 const form=document.createElement('form');form.className='flex flex-wrap gap-3';
 form.innerHTML=`<select name="room" aria-label="Verified room" required class="p-2 bg-slate-800"><option value="">Choose verified location</option>${rooms.data.map(r=>`<option value="${esc(r.id)}">${esc(r.building?.name)} · ${esc(r.name)}</option>`).join('')}</select><select name="category" aria-label="Category" required class="p-2 bg-slate-800">${categories.data.map(r=>`<option value="${esc(r.code)}">${esc(r.name)}</option>`).join('')}</select><p class="p-2">Priority: <strong>${esc(row.assessment?.review_version===2&&[1,2,3,4].includes(row.assessment?.priority)?['','Critical','High','Medium','Low'][row.assessment.priority]+' · assigned by AI':'Awaiting AI review')}</strong></p><button class="bg-indigo-600 p-2 rounded">Create report</button><button type="button" data-reject class="border p-2 rounded">Reject</button><p role="status"></p>`;

 if(categories.data.some(c=>c.code===row.assessment?.category))form.elements.category.value=row.assessment.category;
 const decide=async reject=>{form.querySelectorAll('button').forEach(b=>b.disabled=true);try{const {error}=await API.client.rpc('campusops_review_email',{p_email:row.id,p_reject:reject,p_room:reject?null:form.elements.room.value,p_category:reject?null:form.elements.category.value,p_priority:null});if(error)throw error;if(!reject){form.querySelector('[role=status]').textContent='Report created. AI is checking for duplicate website and email reports…';try{const {data,error:groupError}=await API.client.functions.invoke('campusops-group-reports',{body:{college_id:member.college_id}});if(groupError||data?.error)throw Error(data?.error||groupError.message);App.showToast(data.merged?'AI combined duplicate reports.':'Report created. AI duplicate review completed.','success');if(window.ReportAdmin)ReportAdmin.groupedSignature='';}catch(groupFailure){App.showToast('Report saved. Duplicate review pending: '+groupFailure.message,'error');}}await this.load();}catch(e){form.querySelector('[role=status]').textContent=e.message;form.querySelectorAll('button').forEach(b=>b.disabled=false);}};
 form.onsubmit=e=>{e.preventDefault();decide(false);};form.querySelector('[data-reject]').onclick=()=>decide(true);card.append(form);
 }
 list.append(card);
 }
 const empty=document.createElement('div');empty.className='ops-empty';empty.textContent='No matching emails. Try another status or search.';list.append(empty);
 const search=el.querySelector('#emailSearch');search.value=this.query;
 const filter=()=>{this.query=search.value;let count=0;list.querySelectorAll('article').forEach(card=>{card.hidden=!card.dataset.search.includes(this.query.trim().toLowerCase());if(!card.hidden)count++;});empty.hidden=count>0;};search.oninput=filter;el.querySelector('#emailClear').onclick=()=>{search.value='';filter();search.focus();};filter();
 }catch(e){el.textContent='Unable to load email intake: '+e.message;}
 }
};window.EmailIntake=EmailIntake;
