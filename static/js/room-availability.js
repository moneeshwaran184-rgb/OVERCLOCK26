/* Shared faculty/facilities availability, calculated by the server. */
const RoomAvailability = {
  panels: new Map(),
  localInput(value) { const d=new Date(value); return new Date(d.getTime()-d.getTimezoneOffset()*60000).toISOString().slice(0,16); },
  escape(value) { return App.escapeHtml(String(value ?? '')); },
  time(value) { return new Date(value).toLocaleString([], {dateStyle:'short',timeStyle:'short'}); },
  mount(id, classes = []) {
    const host=document.getElementById(id); if(!host) return;
    const previous=this.panels.get(id); if(previous) previous.request++;
    const start=new Date(Date.now()+15*60000), end=new Date(start.getTime()+3600000);
    host.innerHTML=`<div class="space-y-4 p-5 rounded-2xl border bg-white dark:bg-slate-800">
      <div><h2 class="font-bold text-lg">All campus rooms & availability</h2><p class="text-xs text-slate-500 mt-1">Availability is for the selected time. Reservations from all faculty and maintenance are included.</p></div>
      <div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <label class="text-xs font-semibold">From<input data-field="start" type="datetime-local" class="block w-full mt-1 p-2 rounded-lg border bg-white dark:bg-slate-900"></label>
        <label class="text-xs font-semibold">Until<input data-field="end" type="datetime-local" class="block w-full mt-1 p-2 rounded-lg border bg-white dark:bg-slate-900"></label>
        <label class="text-xs font-semibold">Course / class<select data-field="class" class="block w-full mt-1 p-2 rounded-lg border bg-white dark:bg-slate-900"><option value="">Any room / independent booking</option>${classes.map(c=>`<option value="${c.id}">${this.escape(c.code)} · ${this.escape(c.title)} (${c.student_count} students)</option>`).join('')}</select></label>
        <label class="text-xs font-semibold">Attendees<input data-field="attendees" type="number" min="1" value="1" class="block w-full mt-1 p-2 rounded-lg border bg-white dark:bg-slate-900"></label>
      </div>
      <div class="flex flex-wrap gap-3 items-center"><label class="text-xs">Show <select data-field="filter" class="p-2 rounded-lg border bg-white dark:bg-slate-900"><option value="all">All rooms</option><option value="available">Available</option><option value="reserved">Reserved</option><option value="unavailable">Unavailable</option></select></label><button data-action="refresh" type="button" class="px-3 py-2 rounded-lg border text-xs font-semibold">Refresh availability</button><span data-status role="status" class="text-xs text-slate-500"></span></div>
      <div data-rooms class="grid gap-3 sm:grid-cols-2 xl:grid-cols-3"></div></div>`;
    const panel={host,id,classes,request:0,rows:[],fields:{}};
    for(const field of host.querySelectorAll('[data-field]')) panel.fields[field.dataset.field]=field;
    panel.fields.start.value=this.localInput(start); panel.fields.end.value=this.localInput(end);
    this.panels.set(id,panel);
    for(const [name,field] of Object.entries(panel.fields)) field.addEventListener('change',()=>{
      if(name==='filter') { this.render(panel); return; }
      if(name==='class') { const cls=classes.find(c=>c.id===field.value); panel.fields.attendees.disabled=!!cls; if(cls) panel.fields.attendees.value=cls.student_count; }
      this.load(panel);
    });
    host.querySelector('[data-action="refresh"]').onclick=()=>this.load(panel);
    return this.load(panel);
  },
  state(row) {
    if(row.available) return 'available';
    if(row.reasons?.some(r=>/incident|Marked unavailable/.test(r))) return 'unavailable';
    return row.reservations?.length ? 'reserved' : 'unavailable';
  },
  async load(panel) {
    const request=++panel.request, {start,end,attendees,class:course}=panel.fields;
    const status=panel.host.querySelector('[data-status]'), grid=panel.host.querySelector('[data-rooms]');
    const stamp=[start.value,end.value,attendees.value,course.value].join('|');
    status.textContent='Checking rooms…'; grid.querySelectorAll('button').forEach(b=>b.disabled=true);
    try {
      const member=await API.getActiveMembership(); if(!member) throw new Error('Sign in to view room availability.');
      const rows=await API.getRoomAvailability({p_college:member.college_id,p_start:start.value,p_end:end.value,p_attendees:Number(attendees.value),p_class:course.value || null});
      if(request!==panel.request || !panel.host.isConnected || stamp!==[start.value,end.value,attendees.value,course.value].join('|')) return;
      panel.rows=rows;panel.loaded={start:start.value,end:end.value,classId:course.value,attendees:Number(attendees.value)};
      status.textContent=`${rows.filter(r=>r.available).length} available · ${rows.length} rooms · updated ${new Date().toLocaleTimeString()}`; this.render(panel);
    } catch(error) {
      if(request!==panel.request) return;
      panel.rows=[];status.textContent=error.message;grid.innerHTML='<p class="text-sm p-3">Availability could not be loaded. Use Refresh to retry.</p>';
    }
  },
  render(panel) {
    const rows=panel.rows.filter(r=>panel.fields.filter.value==='all'||this.state(r)===panel.fields.filter.value);
    const grid=panel.host.querySelector('[data-rooms]');
    grid.innerHTML=rows.map(r=>{
      const state=this.state(r), label=state==='available'?'Available to book':state==='reserved'?'Reserved':'Unavailable';
      const color=state==='available'?'bg-emerald-100 text-emerald-800':state==='reserved'?'bg-amber-100 text-amber-800':'bg-rose-100 text-rose-800';
      return `<article class="p-4 rounded-xl border space-y-2"><span class="inline-block text-xs px-2 py-1 rounded-full font-semibold ${color}">${label}</span>
        <h3 class="font-bold">${this.escape(r.building_name)} · ${this.escape(r.room_name)}</h3><p class="text-xs text-slate-500">${this.escape(r.campus_name)} · ${r.capacity} seats</p>
        <p class="text-xs">Equipment: ${this.escape((r.equipment || []).join(', ') || 'None listed')}</p>
        ${(r.reasons || []).map(reason=>`<p class="text-xs text-rose-600 dark:text-rose-300">${this.escape(reason)}</p>`).join('')}
        ${(r.reservations || []).map(slot=>`<p class="text-xs"><strong>Reserved:</strong> ${this.escape(this.time(slot.starts_at))} – ${this.escape(this.time(slot.ends_at))} · ${this.escape(slot.kind)}</p>`).join('')}
        ${r.available?`<button data-room="${r.room_id}" type="button" class="px-3 py-2 rounded-lg text-xs font-semibold bg-indigo-600 text-white">Book this room</button>`:''}</article>`;
    }).join('') || '<p class="text-sm">No rooms match this filter.</p>';
    grid.querySelectorAll('[data-room]').forEach(button=>button.onclick=()=>{const slot=panel.loaded;if(slot) Bookings.openBookRoomModal(slot.classId || null,{roomId:button.dataset.room,start:slot.start,end:slot.end,attendees:slot.attendees});});
  },
  async refreshVisible() {
    for(const [id,panel] of this.panels) { if(!panel.host.isConnected) {this.panels.delete(id);continue;} if(panel.host.offsetParent!==null && !panel.host.contains(document.activeElement)) await this.load(panel); }
  }
};
window.RoomAvailability=RoomAvailability;
