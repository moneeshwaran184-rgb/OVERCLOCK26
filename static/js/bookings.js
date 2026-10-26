/**
 * CampusOps Room Bookings & Faculty Controller
 * My Classes, Room Bookings, Affected Classes detection, Alternative Room Finder,
 * Moving bookings, and Booking Overrides.
 */

const Bookings = {
  classes: [],
  bookings: [],
  affectedClasses: [],
  rooms: [],
  campuses: [],
  selectedBookingId: null,

  async init() {
    this.bindEvents();
  },

  bindEvents() {
    const bookRoomBtn = document.getElementById('openBookRoomModalBtn');
    if (bookRoomBtn) {
      bookRoomBtn.addEventListener('click', () => this.openBookRoomModal());
    }

    const bookingForm = document.getElementById('bookRoomForm');
    if (bookingForm) {
      bookingForm.addEventListener('submit', (e) => this.handleBookRoom(e));
    }

    const moveForm = document.getElementById('moveRoomForm');
    if (moveForm) {
      moveForm.addEventListener('submit', (e) => this.handleMoveRoom(e));
    }

    const findRoomsForm = document.getElementById('findRoomsForm');
    if (findRoomsForm) {
      findRoomsForm.addEventListener('submit', (e) => this.handleFindRooms(e));
    }

    const overrideForm = document.getElementById('bookingOverrideForm');
    if (overrideForm) {
      overrideForm.addEventListener('submit', (e) => this.handleOverrideRequest(e));
    }
  },

  async loadData() {
    const member = await API.getActiveMembership();
    if (!member) return;

    try {
      const isFaculty = member.role === 'faculty';
      const [classes, bookings, rooms, campuses, incidentRooms] = await Promise.all([
        API.getClasses(member.college_id, isFaculty ? member.user_id : null),
        API.getBookings(member.college_id),
        API.getRooms(member.college_id),
        API.getCampuses(member.college_id),
        this.fetchActiveIncidentRooms(member.college_id)
      ]);

      this.classes = classes || [];
      this.bookings = bookings || [];
      this.rooms = rooms || [];
      this.campuses = campuses || [];

      // Detect affected classes: classes whose assigned room is in active incidentRooms
      const badRoomIds = new Set((incidentRooms || []).map(ir => ir.room_id));
      this.affectedClasses = this.bookings.filter(b => b.kind === 'class' && badRoomIds.has(b.room_id));

      this.renderClasses();
      this.renderBookings();
      this.renderAffectedClasses();
    } catch (err) {
      console.error('Failed to load bookings & classes:', err);
      if (window.App) window.App.showToast(err.message, 'error');
    }
  },

  async fetchActiveIncidentRooms(collegeId) {
    try {
      const { data } = await API.client
        .from('campusops_incident_rooms')
        .select('*, incident:campusops_incidents(*)')
        .eq('college_id', collegeId)
        .is('ends_at', null);
      return data || [];
    } catch (e) {
      return [];
    }
  },

  renderClasses() {
    const container = document.getElementById('myClassesContainer');
    if (!container) return;

    if (this.classes.length === 0) {
      container.innerHTML = `
        <div class="col-span-full py-8 text-center text-slate-500 dark:text-slate-400 bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700">
          <i data-lucide="book-open" class="w-8 h-8 mx-auto mb-2 text-slate-400"></i>
          <p class="font-medium text-sm">No classes assigned to this faculty account.</p>
        </div>`;
      if (window.App) window.App.refreshIcons();
      return;
    }

    container.innerHTML = this.classes.map(c => `
      <div class="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700 p-5 shadow-sm hover:shadow-md transition">
        <div class="flex items-start justify-between">
          <span class="px-2.5 py-1 rounded-lg bg-indigo-50 dark:bg-indigo-950/50 text-indigo-700 dark:text-indigo-300 font-mono text-xs font-bold">
            ${this.escapeHtml(c.code)}
          </span>
          <span class="text-xs text-slate-500 flex items-center gap-1 font-medium">
            <i data-lucide="users" class="w-3.5 h-3.5"></i>
            ${c.student_count || 0} Students
          </span>
        </div>
        <h4 class="font-bold text-slate-900 dark:text-white text-base mt-2">${this.escapeHtml(c.title)}</h4>
        <p class="text-xs text-slate-500 mt-1">${this.escapeHtml(c.department?.name || 'Department')}</p>

        <div class="mt-4 pt-3 border-t border-slate-100 dark:border-slate-700/60 flex items-center justify-between">
          <button onclick="Bookings.openBookRoomModal('${c.id}')" class="px-3 py-1.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-semibold text-xs transition flex items-center gap-1">
            <i data-lucide="calendar-plus" class="w-3.5 h-3.5"></i>
            Schedule Room
          </button>
        </div>
      </div>
    `).join('');

    if (window.App) window.App.refreshIcons();
  },

  renderAffectedClasses() {
    const container = document.getElementById('affectedClassesContainer');
    const badge = document.getElementById('affectedClassesBadge');
    if (!container) return;

    if (badge) {
      if (this.affectedClasses.length > 0) {
        badge.textContent = `${this.affectedClasses.length} Disruptions`;
        badge.classList.remove('hidden');
      } else {
        badge.classList.add('hidden');
      }
    }

    if (this.affectedClasses.length === 0) {
      container.innerHTML = `
        <div class="py-8 text-center text-slate-500 dark:text-slate-400 bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700">
          <i data-lucide="check-circle-2" class="w-8 h-8 mx-auto mb-2 text-emerald-500"></i>
          <p class="font-medium text-sm text-slate-800 dark:text-white">All Scheduled Rooms Operational</p>
          <p class="text-xs text-slate-500 mt-0.5">No classrooms are currently impacted by active facility incidents.</p>
        </div>`;
      if (window.App) window.App.refreshIcons();
      return;
    }

    container.innerHTML = this.affectedClasses.map(b => `
      <div class="bg-rose-50/70 dark:bg-rose-950/30 rounded-2xl border border-rose-200 dark:border-rose-900/60 p-5 shadow-sm">
        <div class="flex items-start justify-between">
          <div>
            <span class="px-2.5 py-1 rounded-full bg-rose-600 text-white font-bold text-[10px] uppercase tracking-wider">
              Room Hazard / Disrupted
            </span>
            <h4 class="font-extrabold text-slate-900 dark:text-white text-base mt-2">${this.escapeHtml(b.title)}</h4>
            <p class="text-xs text-rose-700 dark:text-rose-300 font-semibold mt-0.5">
              Impacted Room: <strong>${this.escapeHtml(b.room_display)}</strong>
            </p>
            <p class="text-xs text-slate-600 dark:text-slate-400 mt-1">
              Time: ${new Date(b.starts_at).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' })}
            </p>
          </div>
          <div class="flex flex-col gap-2">
            <button onclick="Bookings.openMoveModal('${b.id}')" class="px-3.5 py-1.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-semibold text-xs transition shadow-sm flex items-center gap-1">
              <i data-lucide="move" class="w-3.5 h-3.5"></i>
              Relocate Room
            </button>
            <button onclick="Bookings.openFindAlternative('${b.room?.id || ''}', '${b.starts_at}', '${b.ends_at}')" class="px-3.5 py-1.5 rounded-xl border border-rose-300 dark:border-rose-800 bg-white dark:bg-slate-800 text-rose-700 dark:text-rose-300 font-semibold text-xs hover:bg-rose-50 transition">
              Find Alternatives
            </button>
          </div>
        </div>
      </div>
    `).join('');

    if (window.App) window.App.refreshIcons();
  },

  renderBookings() {
    const container = document.getElementById('bookingsListContainer');
    if (!container) return;

    if (this.bookings.length === 0) {
      container.innerHTML = `
        <div class="col-span-full py-12 text-center text-slate-500 dark:text-slate-400 bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700">
          <i data-lucide="calendar" class="w-8 h-8 mx-auto mb-2 text-slate-400"></i>
          <p class="font-medium text-sm">No room bookings on record.</p>
        </div>`;
      if (window.App) window.App.refreshIcons();
      return;
    }

    const member = API._currentMember;
    const canManage = member && (member.role === 'faculty' || member.role === 'facilities_admin' || member.role === 'department_manager');

    container.innerHTML = this.bookings.map(b => {
      const sTime = new Date(b.starts_at).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' });
      const eTime = new Date(b.ends_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

      return `
        <div class="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700 p-5 shadow-sm hover:shadow-md transition flex flex-col justify-between">
          <div>
            <div class="flex items-start justify-between">
              <span class="px-2.5 py-0.5 rounded-md text-[11px] font-bold uppercase tracking-wider bg-slate-100 dark:bg-slate-700 text-slate-700 dark:text-slate-300">
                ${this.escapeHtml(b.kind)}
              </span>
              <span class="text-xs font-mono text-slate-400">${b.attendee_count || 1} Attendees</span>
            </div>
            <h4 class="font-bold text-slate-900 dark:text-white text-base mt-2">${this.escapeHtml(b.title)}</h4>
            <p class="text-xs text-indigo-600 dark:text-indigo-400 font-semibold mt-1">
              ${this.escapeHtml(b.room_display)}
            </p>
            <p class="text-xs text-slate-500 mt-1">
              ${sTime} – ${eTime}
            </p>
          </div>

          ${canManage ? `
            <div class="mt-4 pt-3 border-t border-slate-100 dark:border-slate-700/60 flex items-center justify-between gap-2">
              <button onclick="Bookings.openMoveModal('${b.id}')" class="px-3 py-1.5 rounded-xl bg-slate-100 hover:bg-slate-200 dark:bg-slate-700 dark:hover:bg-slate-600 text-slate-700 dark:text-slate-200 text-xs font-semibold transition">
                Move Room
              </button>
              <button onclick="Bookings.cancelBooking('${b.id}')" class="px-3 py-1.5 rounded-xl border border-rose-200 hover:bg-rose-50 text-rose-600 text-xs font-semibold transition">
                Cancel
              </button>
            </div>
          ` : ''}
        </div>
      `;
    }).join('');

    if (window.App) window.App.refreshIcons();
  },

  openBookRoomModal(classId = null) {
    const roomSelect = document.getElementById('bookRoomSelect');
    const classSelect = document.getElementById('bookRoomClass');
    const titleInput = document.getElementById('bookRoomTitle');
    const startInput = document.getElementById('bookRoomStart');
    const endInput = document.getElementById('bookRoomEnd');

    if (roomSelect) {
      roomSelect.innerHTML = this.rooms.map(r => `
        <option value="${r.id}">${this.escapeHtml(r.building_name)} · ${this.escapeHtml(r.name)} (${r.capacity} cap)</option>
      `).join('');
    }

    if (classSelect) {
      classSelect.innerHTML = '<option value="">Independent Booking</option>' +
        this.classes.map(c => `<option value="${c.id}" ${c.id === classId ? 'selected' : ''}>${this.escapeHtml(c.code)} - ${this.escapeHtml(c.title)}</option>`).join('');
    }

    const now = new Date();
    now.setMinutes(now.getMinutes() + 15);
    const later = new Date(now.getTime() + 60 * 60 * 1000);

    if (startInput) startInput.value = now.toISOString().slice(0, 16);
    if (endInput) endInput.value = later.toISOString().slice(0, 16);

    if (classId) {
      const cls = this.classes.find(c => c.id === classId);
      if (cls && titleInput) titleInput.value = cls.title;
    }

    if (window.App) window.App.openModal('bookRoomModal');
  },

  async handleBookRoom(e) {
    e.preventDefault();
    const member = await API.getActiveMembership();
    if (!member) return;

    const roomSelect = document.getElementById('bookRoomSelect');
    const classSelect = document.getElementById('bookRoomClass');
    const titleInput = document.getElementById('bookRoomTitle');
    const startInput = document.getElementById('bookRoomStart');
    const endInput = document.getElementById('bookRoomEnd');
    const attendeesInput = document.getElementById('bookRoomAttendees');
    const submitBtn = document.getElementById('bookRoomSubmitBtn');

    const roomId = roomSelect?.value;
    const title = titleInput?.value.trim();
    const start = startInput?.value;
    const end = endInput?.value;
    const classId = classSelect?.value || null;
    const attendees = attendeesInput ? parseInt(attendeesInput.value, 10) : 25;

    if (!roomId || !title || !start || !end) {
      if (window.App) window.App.showToast('Please fill in all booking fields.', 'error');
      return;
    }

    if (submitBtn) {
      submitBtn.disabled = true;
      submitBtn.innerHTML = '<span class="animate-spin mr-2">⏳</span> Reserving...';
    }

    try {
      await API.bookRoom({
        p_college: member.college_id,
        p_room: roomId,
        p_title: title,
        p_start: start,
        p_end: end,
        p_attendees: attendees,
        p_equipment: [],
        p_class: classId
      });

      if (window.App) {
        window.App.showToast('Room booked successfully!', 'success');
        window.App.closeModals();
      }

      await this.loadData();
    } catch (err) {
      console.error('Book room failed:', err);
      if (window.App) window.App.showToast(err.message, 'error');
    } finally {
      if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.textContent = 'Confirm Booking';
      }
    }
  },

  openMoveModal(bookingId) {
    this.selectedBookingId = bookingId;
    const b = this.bookings.find(item => item.id === bookingId);
    if (!b) return;

    const currentEl = document.getElementById('moveCurrentRoomDisplay');
    const selectEl = document.getElementById('moveTargetRoomSelect');

    if (currentEl) currentEl.textContent = b.room_display || 'Current Room';
    if (selectEl) {
      selectEl.innerHTML = this.rooms
        .filter(r => r.id !== b.room_id)
        .map(r => `<option value="${r.id}">${this.escapeHtml(r.building_name)} · ${this.escapeHtml(r.name)} (${r.capacity} cap)</option>`)
        .join('');
    }

    if (window.App) window.App.openModal('moveRoomModal');
  },

  async handleMoveRoom(e) {
    e.preventDefault();
    if (!this.selectedBookingId) return;

    const selectEl = document.getElementById('moveTargetRoomSelect');
    const targetRoomId = selectEl?.value;
    const submitBtn = document.getElementById('moveRoomSubmitBtn');

    if (!targetRoomId) return;

    if (submitBtn) {
      submitBtn.disabled = true;
      submitBtn.innerHTML = '<span class="animate-spin mr-2">⏳</span> Moving...';
    }

    try {
      await API.moveBooking({
        p_booking: this.selectedBookingId,
        p_room: targetRoomId
      });

      if (window.App) {
        window.App.showToast('Booking successfully relocated to new room!', 'success');
        window.App.closeModals();
      }

      await this.loadData();
    } catch (err) {
      console.error('Move booking failed:', err);
      if (window.App) window.App.showToast(err.message, 'error');
    } finally {
      if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.textContent = 'Confirm Relocation';
      }
    }
  },

  async cancelBooking(bookingId) {
    if (!confirm('Are you sure you want to cancel this booking?')) return;
    try {
      await API.cancelBooking(bookingId);
      if (window.App) window.App.showToast('Booking cancelled.', 'success');
      await this.loadData();
    } catch (err) {
      console.error('Cancel booking failed:', err);
      if (window.App) window.App.showToast(err.message, 'error');
    }
  },

  openFindAlternative(roomId, startIso, endIso) {
    const startInput = document.getElementById('findRoomsStart');
    const endInput = document.getElementById('findRoomsEnd');
    const capInput = document.getElementById('findRoomsCapacity');

    if (startInput && startIso) startInput.value = new Date(startIso).toISOString().slice(0, 16);
    if (endInput && endIso) endInput.value = new Date(endIso).toISOString().slice(0, 16);
    if (capInput) capInput.value = '25';

    if (window.App) window.App.openModal('findRoomsModal');
  },

  async handleFindRooms(e) {
    e.preventDefault();
    const member = await API.getActiveMembership();
    if (!member) return;

    const startInput = document.getElementById('findRoomsStart');
    const endInput = document.getElementById('findRoomsEnd');
    const capInput = document.getElementById('findRoomsCapacity');
    const container = document.getElementById('foundRoomsResults');
    const submitBtn = document.getElementById('findRoomsSubmitBtn');

    const start = startInput?.value;
    const end = endInput?.value;
    const capacity = capInput ? parseInt(capInput.value, 10) : 25;

    if (!start || !end) return;

    if (submitBtn) {
      submitBtn.disabled = true;
      submitBtn.innerHTML = '<span class="animate-spin mr-2">⏳</span> Searching...';
    }

    try {
      const results = await API.findRooms({
        p_college: member.college_id,
        p_campus: this.campuses[0]?.id,
        p_start: start,
        p_end: end,
        p_capacity: capacity,
        p_equipment: []
      });

      if (container) {
        if (!results || results.length === 0) {
          container.innerHTML = `
            <div class="p-4 text-center text-slate-500 rounded-xl bg-slate-50 border border-slate-200">
              <p class="font-medium text-xs">No vacant rooms match your capacity and timeframe criteria.</p>
              <button type="button" onclick="Bookings.openOverrideFromFind('${start}', '${end}', ${capacity})" class="mt-2 text-indigo-600 font-bold text-xs underline">
                Request a Booking Override
              </button>
            </div>`;
        } else {
          container.innerHTML = results.map(r => `
            <div class="p-3 rounded-xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 flex items-center justify-between text-xs">
              <div>
                <span class="font-bold text-slate-900 dark:text-white">${this.escapeHtml(r.building_name || 'Building')} · ${this.escapeHtml(r.name)}</span>
                <span class="text-slate-500 block">Capacity: ${r.capacity}</span>
              </div>
              <button type="button" onclick="Bookings.selectAlternativeRoom('${r.id}', '${start}', '${end}')" class="px-3 py-1 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white font-semibold shadow-sm transition">
                Book This Room
              </button>
            </div>
          `).join('');
        }
      }
    } catch (err) {
      console.error('Find rooms failed:', err);
      if (window.App) window.App.showToast(err.message, 'error');
    } finally {
      if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.textContent = 'Search Vacant Rooms';
      }
    }
  },

  selectAlternativeRoom(roomId, start, end) {
    if (window.App) window.App.closeModals();
    this.openBookRoomModal();
    const roomSelect = document.getElementById('bookRoomSelect');
    const startInput = document.getElementById('bookRoomStart');
    const endInput = document.getElementById('bookRoomEnd');

    if (roomSelect) roomSelect.value = roomId;
    if (startInput) startInput.value = new Date(start).toISOString().slice(0, 16);
    if (endInput) endInput.value = new Date(end).toISOString().slice(0, 16);
  },

  openOverrideFromFind(start, end, capacity) {
    if (window.App) window.App.closeModals();
    const rSelect = document.getElementById('overrideRoomSelect');
    const sInput = document.getElementById('overrideStart');
    const eInput = document.getElementById('overrideEnd');
    const attInput = document.getElementById('overrideAttendees');

    if (rSelect) {
      rSelect.innerHTML = this.rooms.map(r => `<option value="${r.id}">${this.escapeHtml(r.building_name)} · ${this.escapeHtml(r.name)}</option>`).join('');
    }
    if (sInput) sInput.value = new Date(start).toISOString().slice(0, 16);
    if (eInput) eInput.value = new Date(end).toISOString().slice(0, 16);
    if (attInput) attInput.value = capacity;

    if (window.App) window.App.openModal('bookingOverrideModal');
  },

  async handleOverrideRequest(e) {
    e.preventDefault();
    const member = await API.getActiveMembership();
    if (!member) return;

    const rSelect = document.getElementById('overrideRoomSelect');
    const titleInput = document.getElementById('overrideTitle');
    const sInput = document.getElementById('overrideStart');
    const eInput = document.getElementById('overrideEnd');
    const attInput = document.getElementById('overrideAttendees');
    const reasonInput = document.getElementById('overrideReason');
    const submitBtn = document.getElementById('overrideSubmitBtn');

    const roomId = rSelect?.value;
    const title = titleInput?.value.trim();
    const start = sInput?.value;
    const end = eInput?.value;
    const attendees = attInput ? parseInt(attInput.value, 10) : 25;
    const reason = reasonInput?.value.trim();

    if (!roomId || !title || !start || !end || !reason) {
      if (window.App) window.App.showToast('Please fill in all override request details.', 'error');
      return;
    }

    if (submitBtn) {
      submitBtn.disabled = true;
      submitBtn.innerHTML = '<span class="animate-spin mr-2">⏳</span> Submitting...';
    }

    try {
      await API.requestBookingOverride({
        p_college: member.college_id,
        p_room: roomId,
        p_title: title,
        p_start: start,
        p_end: end,
        p_attendees: attendees,
        p_reason: reason
      });

      if (window.App) {
        window.App.showToast('Booking override request submitted for administrative approval.', 'success');
        window.App.closeModals();
      }

      await this.loadData();
    } catch (err) {
      console.error('Booking override failed:', err);
      if (window.App) window.App.showToast(err.message, 'error');
    } finally {
      if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.textContent = 'Submit Override Request';
      }
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

window.Bookings = Bookings;
