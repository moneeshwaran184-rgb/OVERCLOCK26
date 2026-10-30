const ReportAI={
 signature:'',result:null,choice:null,target:null,
 async review(){
 const description=document.getElementById('reportDescription').value.trim();const m=await API.getActiveMembership();
 const location=['reportCampus','reportBuilding','reportRoom'].map(id=>{const e=document.getElementById(id);return e?.selectedOptions?.[0]?.textContent||'';}).join(' / ');
 const fields={campus_id:document.getElementById('reportCampus').value,department_id:ReportForm.rooms.find(r=>r.id===document.getElementById('reportRoom').value)?.department_id,room_id:document.getElementById('reportRoom').value,category:document.getElementById('reportCategory').value,equipment:''};
 const signature=JSON.stringify([description,location,fields]);if(signature===this.signature&&this.result)return !this.result.duplicates.length || !!this.choice; this.choice=null;this.target=null;
 let panel=document.getElementById('reportAIReview');if(!panel){panel=document.createElement('div');panel.id='reportAIReview';panel.className='p-4 my-4 rounded-xl border space-y-3';document.getElementById('submitReportBtn').parentElement.before(panel);}
 panel.textContent='Checking similar campus problems with AI…';
 try{const {data,error}=await API.client.functions.invoke('campusops-ai',{body:{description,location,college_id:m.college_id,...fields}});if(error||data?.error){
 let message=data?.error;
 if(error?.context){const status=error.context.status;try{const detail=await error.context.clone().json();message=detail.error||detail.message||message;}catch{}
 if(status===404)message='AI function is not deployed. Deploy campusops-ai in the OVERCLOCK26 Supabase project.';
 if(status===401)message='AI authentication failed. Sign out and sign in again. If this persists, check the Edge Function authentication configuration.';
 }throw new Error(message||'Could not reach the AI service. Check your connection and try again.');
 }
 if(!data.assessment_id||!Number.isInteger(data.priority)||data.priority<1||data.priority>4)throw new Error('Deploy the updated AI function before submitting.');
 this.signature=signature;this.result=data;
 document.getElementById('reportPrioritySummary').textContent=['','Critical','High','Medium','Low'][data.priority]+' · assessed by AI';
 document.getElementById('reportPriorityReason').textContent=data.priority_reason;const esc=v=>App.escapeHtml(String(v||''));
 panel.innerHTML=`<h3 class="font-bold">AI report review</h3><p>${esc(data.summary)}</p><p class="text-sm">Suggested category: ${esc(data.category)} · Urgency: ${esc(data.urgency)}</p><p class="text-sm">Location: ${esc(data.location)} · Equipment: ${esc(data.assets.join(', '))}</p>${data.clarification_questions.map(q=>`<p class="text-amber-600">Please clarify: ${esc(q)}</p>`).join('')}${['duplicates','related'].map(type=>data[type].map(r=>`<div class="p-3 border rounded-lg"><strong>${type==='duplicates'?'Possible same problem':'Possibly related problem'} · ID ${esc(r.id.slice(0,8).toUpperCase())}</strong><p>${esc(r.description)}</p><button type="button" class="underline" data-ai-report="${r.id}">Find this problem in Campus Reports</button></div>`).join('')).join('')}<p class="text-sm">Review these suggestions and update your description if needed. Choose whether to join an existing issue or submit separately. AI does not change operational rules.</p>`;
 if(data.duplicates.length){
 const choices=document.createElement('div');choices.className='flex flex-wrap gap-3';
 for(const r of data.duplicates){const b=document.createElement('button');b.type='button';b.className='p-3 border rounded-xl';b.textContent='Join issue '+r.id.slice(0,8);b.onclick=()=>{this.choice='join';this.target=r.id;ReportForm.submitForm();};choices.append(b);}
 const separate=document.createElement('button');separate.type='button';separate.className='p-3 border rounded-xl';separate.textContent='Submit as a separate issue';separate.onclick=()=>{this.choice='separate';this.target=null;ReportForm.submitForm();};choices.append(separate);panel.append(choices);
 }
 panel.querySelectorAll('[data-ai-report]').forEach(b=>b.onclick=()=>{CampusReports.filters.query=b.dataset.aiReport;App.switchTab('campusreports');});panel.scrollIntoView({block:'center',behavior:'smooth'});return !data.duplicates.length;
 }catch(e){panel.textContent=e.message+' Please retry; no priority has been assigned.';this.signature='';this.result=null;return false;}
 }
};window.ReportAI=ReportAI;

