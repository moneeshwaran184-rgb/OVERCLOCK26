const StudentHelp = {
  messages: [], owner: null, busy: false, generation: 0,
  reset() { this.messages=[]; this.owner=null; this.busy=false; this.generation++; document.getElementById('section-studenthelp')?.replaceChildren(); document.getElementById('section-grievances')?.replaceChildren(); },
  node(tag,text,cls='') { const n=document.createElement(tag);n.textContent=text;n.className=cls;return n; },
  async load() {
    const el=document.getElementById('section-studenthelp');el.replaceChildren();
    try {
      const m=await API.getActiveMembership();if(m?.role!=='student')throw Error('Student access required');
      const {data:{user}}=await API.client.auth.getUser();if(!user)throw Error('Sign in required');
      const owner=user.id+':'+m.college_id;if(this.owner!==owner){this.reset();this.owner=owner;}
      el.append(this.node('h1','AI Help & Grievances','text-3xl font-bold'),this.node('p','Ask a question about CampusOps, or tell us about a website problem. AI answers may be imperfect. Do not share passwords or OTPs.','ops-help'));
      const log=this.node('div','','space-y-3');log.setAttribute('role','log');log.setAttribute('aria-live','polite');el.append(log);
      const draw=()=>{log.replaceChildren();for(const msg of this.messages){const p=this.node('p',(msg.role==='user'?'You: ':'CampusOps AI: ')+msg.text,'border rounded-xl p-4 whitespace-pre-wrap');log.append(p);}};draw();
      const form=document.createElement('form');form.className='space-y-3';
      const label=this.node('label','Your question');const input=document.createElement('textarea');input.maxLength=2000;input.required=true;input.rows=3;input.className='w-full p-3 rounded border bg-transparent';label.append(input);
      const send=this.node('button','Ask AI','ops-quiet-button');send.type='submit';const clear=this.node('button','New chat','ops-quiet-button');clear.type='button';
      const feedback=this.node('p','');feedback.setAttribute('role','status');form.append(label,send,clear,feedback);el.append(form);
      const report=this.node('details','');const summary=this.node('summary','Report a website problem','cursor-pointer font-semibold');report.append(summary);el.append(report);
      const grievance=document.createElement('form');grievance.className='space-y-3 mt-3';report.append(grievance);
      const dl=this.node('label','What happened? Include the page, what you tried, and any error message.');const description=document.createElement('textarea');description.minLength=10;description.maxLength=6000;description.required=true;description.rows=5;description.className=input.className;dl.append(description);
      const pl=this.node('label','Affected page (optional)');const page=document.createElement('input');page.maxLength=200;page.className=input.className;page.placeholder='For example: Submit Report';pl.append(page);
      const notice=this.node('p','Only the description and page below are sent to the report admin. Your chat is not attached.','ops-help');
      const confirm=this.node('button','Confirm & submit grievance','ops-quiet-button');confirm.type='submit';
      const saved=this.node('p','');saved.setAttribute('role','status');grievance.append(dl,pl,notice,confirm,saved);
      let requestId=crypto.randomUUID();
      grievance.onsubmit=async e=>{e.preventDefault();confirm.disabled=true;description.readOnly=true;page.readOnly=true;saved.textContent='Submitting…';try{
        const {data,error}=await API.client.rpc('campusops_submit_grievance',{p_id:requestId,p_college:m.college_id,p_description:description.value.trim(),p_page:page.value.trim()});if(error)throw error;
        saved.textContent='Submitted to Grievance Redressal. Reference: '+data;requestId=crypto.randomUUID();description.value='';page.value='';await this.renderTickets(tickets,m,false);
      }catch(e){saved.textContent='Not confirmed: '+e.message+' Retry with the same details if your connection was interrupted.';}finally{confirm.disabled=false;description.readOnly=false;page.readOnly=false;}};
      clear.onclick=()=>{if(this.busy)return;this.messages=[];draw();feedback.textContent='';};
      form.onsubmit=async e=>{e.preventDefault();if(this.busy||!input.value.trim())return;this.busy=true;send.disabled=true;clear.disabled=true;input.disabled=true;
        const generation=this.generation,text=input.value.trim();feedback.textContent='AI is thinking…';
        this.messages.push({role:'user',text});draw();
        try{let messages=this.messages.slice(-11);if(messages[0]?.role==='assistant')messages=messages.slice(1);
          const {data,error}=await API.client.functions.invoke('campusops-chat',{body:{college_id:m.college_id,messages}});
          if(generation!==this.generation)return;
          if(error||data?.error){let detail=data?.error;try{detail=(await error.context.json()).error||detail;}catch{}throw Error(detail||'AI help could not connect. Deploy campusops-chat, or submit a grievance below.');}
          this.messages.push({role:'assistant',text:data.answer});this.messages=this.messages.slice(-12);draw();input.value='';feedback.textContent='';
          if(data.intent==='website_problem'){report.open=true;if(!description.value)description.value=this.messages.filter(x=>x.role==='user').map(x=>x.text).join('\n').slice(0,6000);feedback.textContent='Review the grievance details below and confirm to send them to the report admin.';}
          if(data.intent==='maintenance')feedback.textContent='For physical maintenance problems, use the Submit Report tab.';
        }catch(e){if(generation===this.generation){this.messages.pop();draw();feedback.textContent=e.message;report.open=true;}}
        finally{if(generation===this.generation){this.busy=false;send.disabled=false;clear.disabled=false;input.disabled=false;}}
      };
      el.append(this.node('h2','My grievances','text-xl font-bold'));const refresh=this.node('button','Refresh grievances','ops-quiet-button');refresh.type='button';el.append(refresh);const tickets=this.node('div','','space-y-4');el.append(tickets);refresh.onclick=()=>this.renderTickets(tickets,m,false);await this.renderTickets(tickets,m,false);
    }catch(e){el.append(this.node('p',e.message));}
  },
  async admin() {
    const el=document.getElementById('section-grievances');el.replaceChildren();
    try{const m=await API.getActiveMembership();if(m?.role!=='report_admin')throw Error('Report administrator required');
      el.append(this.node('h1','Grievance Redressal','text-3xl font-bold'),this.node('p','Review student website problems, reply, and track resolution.','ops-help'));
      const refresh=this.node('button','Refresh','ops-quiet-button');refresh.type='button';el.append(refresh);const list=this.node('div','','space-y-4');el.append(list);refresh.onclick=()=>this.renderTickets(list,m,true);await this.renderTickets(list,m,true);
    }catch(e){el.append(this.node('p',e.message));}
  },
  async renderTickets(el,m,admin,offset=0) {
    el.textContent='Loading grievances…';
    try{const {data,error}=await API.client.from('campusops_grievances').select('*').eq('college_id',m.college_id).order('created_at',{ascending:false}).order('id').range(offset,offset+19);if(error)throw error;el.replaceChildren();
      if(!data.length)el.append(this.node('p','No grievances on this page.'));
      for(const row of data){const card=this.node('article','','border rounded-xl p-4 space-y-3');
        card.append(this.node('h3',row.status.replaceAll('_',' ')+' · '+new Date(row.created_at).toLocaleString(),'font-bold'),this.node('p','Reference: '+row.id,'ops-help'),this.node('p',row.description,'whitespace-pre-wrap'));
        if(admin)card.append(this.node('p','Student ID: '+row.student_id,'ops-help'));
        if(row.page)card.append(this.node('p','Affected page: '+row.page));if(row.admin_response)card.append(this.node('p','Admin response: '+row.admin_response,'whitespace-pre-wrap'));
        const history=document.createElement('details');history.append(this.node('summary','Status history'));const events=this.node('div','','space-y-2');history.append(events);history.ontoggle=async()=>{if(!history.open)return;events.textContent='Loading…';const {data,error}=await API.client.from('campusops_grievance_history').select('status,response,created_at').eq('grievance_id',row.id).order('created_at');events.replaceChildren();if(error){events.textContent=error.message;return;}for(const event of data)events.append(this.node('p',new Date(event.created_at).toLocaleString()+' · '+event.status+' · '+event.response,'whitespace-pre-wrap'));};card.append(history);
        if(admin){const form=document.createElement('form');form.className='space-y-3';const sl=this.node('label','Status');const status=document.createElement('select');status.className='p-2 border rounded bg-slate-800 text-white';for(const s of ['new','in_progress','resolved']){const o=this.node('option',s.replaceAll('_',' '));o.value=s;status.append(o);}status.value=row.status;sl.append(status);
          const rl=this.node('label','Reply to student');const response=document.createElement('textarea');response.maxLength=4000;response.value=row.admin_response;response.className='w-full p-3 rounded border bg-transparent';rl.append(response);const save=this.node('button','Save response & status','ops-quiet-button');save.type='submit';const message=this.node('p','');message.setAttribute('role','status');form.append(sl,rl,save,message);card.append(form);
          form.onsubmit=async e=>{e.preventDefault();save.disabled=true;try{const {error}=await API.client.rpc('campusops_review_grievance',{p_id:row.id,p_status:status.value,p_response:response.value});if(error)throw error;await this.renderTickets(el,m,admin,offset);}catch(e){message.textContent=e.message;}finally{save.disabled=false;}};
        }el.append(card);
      }
      if(offset){const prev=this.node('button','Previous','ops-quiet-button');prev.onclick=()=>this.renderTickets(el,m,admin,Math.max(0,offset-20));el.append(prev);}if(data.length===20){const next=this.node('button','Next','ops-quiet-button');next.onclick=()=>this.renderTickets(el,m,admin,offset+20);el.append(next);}
    }catch(e){el.textContent='Could not load grievances: '+e.message;}
  }
};
window.StudentHelp=StudentHelp;
