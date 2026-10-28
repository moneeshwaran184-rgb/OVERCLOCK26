const EmailIntake={
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
 el.innerHTML='<h1 class="text-2xl font-bold">Email Intake</h1><button id="emailRefresh" class="border rounded p-3">Refresh inbox</button><p>Verify the sender and location before creating a report. Email sender addresses alone do not prove identity. Only registered student senders can currently be converted.</p>';
 el.querySelector('#emailRefresh').onclick=()=>this.load();
 for(const row of inbox.data){
 const card=document.createElement('article');card.className='border rounded-xl p-5 space-y-3';
 card.innerHTML=`<strong>${esc(row.subject)}</strong><p>${esc(row.sender)} · ${esc(row.status)}</p><pre class="whitespace-pre-wrap">${esc(row.body)}</pre><details><summary>AI extracted details</summary><pre class="whitespace-pre-wrap">${esc(JSON.stringify(row.assessment,null,2))}</pre></details>`;
 if(row.status==='pending'){
 const form=document.createElement('form');form.className='flex flex-wrap gap-3';
 form.innerHTML=`<select name="room" aria-label="Verified room" required class="p-2 bg-slate-800"><option value="">Choose verified location</option>${rooms.data.map(r=>`<option value="${esc(r.id)}">${esc(r.building?.name)} · ${esc(r.name)}</option>`).join('')}</select><select name="category" aria-label="Category" required class="p-2 bg-slate-800">${categories.data.map(r=>`<option value="${esc(r.code)}">${esc(r.name)}</option>`).join('')}</select><select name="priority" aria-label="Priority" required class="p-2 bg-slate-800"><option value="">Confirm priority</option>${['Critical','High','Medium','Low'].map((v,i)=>`<option value="${i+1}">${v}</option>`).join('')}</select><button class="bg-indigo-600 p-2 rounded">Create report</button><button type="button" data-reject class="border p-2 rounded">Reject</button><p role="status"></p>`;
 if([1,2,3,4].includes(row.assessment?.priority))form.elements.priority.value=row.assessment.priority;
 if(categories.data.some(c=>c.code===row.assessment?.category))form.elements.category.value=row.assessment.category;
 const decide=async reject=>{form.querySelectorAll('button').forEach(b=>b.disabled=true);try{const {error}=await API.client.rpc('campusops_review_email',{p_email:row.id,p_reject:reject,p_room:reject?null:form.elements.room.value,p_category:reject?null:form.elements.category.value,p_priority:reject?null:Number(form.elements.priority.value)});if(error)throw error;await this.load();}catch(e){form.querySelector('[role=status]').textContent=e.message;form.querySelectorAll('button').forEach(b=>b.disabled=false);}};
 form.onsubmit=e=>{e.preventDefault();decide(false);};form.querySelector('[data-reject]').onclick=()=>decide(true);card.append(form);
 }
 el.append(card);
 }
 if(!inbox.data.length)el.append(document.createTextNode('No emails received yet.'));
 }catch(e){el.textContent='Unable to load email intake: '+e.message;}
 }
};window.EmailIntake=EmailIntake;
