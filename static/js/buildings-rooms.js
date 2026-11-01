/**
 * CampusOps Buildings and Rooms Management Controller
 * Fully dynamic: loads all buildings and rooms from Supabase.
 * Enforces role authorization (facilities_admin only for edits).
 */

const BuildingsRooms = {
  buildings: [],
  rooms: [],
  campuses: [],
  departments: [],
  selectedBuildingId: 'all',
  editingBuildingId: null,
  editingRoomId: null,

  async init() {
    this.bindEvents();
  },

  bindEvents() {
    // Add Building Button
    const addBuildingBtn = document.getElementById('openAddBuildingModalBtn');
    if (addBuildingBtn) {
      addBuildingBtn.addEventListener('click', () => this.openBuildingModal());
    }

    // Add Room Button
    const addRoomBtn = document.getElementById('openAddRoomModalBtn');
    if (addRoomBtn) {
      addRoomBtn.addEventListener('click', () => this.openRoomModal());
    }

    // Building Form Submit
    const buildingForm = document.getElementById('buildingForm');
    if (buildingForm) {
      buildingForm.addEventListener('submit', (e) => this.handleBuildingSubmit(e));
    }

    // Room Form Submit
    const roomForm = document.getElementById('roomForm');
    if (roomForm) {
      roomForm.addEventListener('submit', (e) => this.handleRoomSubmit(e));
    }

    // Building Filter Selector in Rooms List
    const filterSelect = document.getElementById('roomBuildingFilter');
    if (filterSelect) {
      filterSelect.addEventListener('change', (e) => {
        this.selectedBuildingId = e.target.value;
        this.renderRooms();
      });
    }
  },

  async loadData() {
    const member = await API.getActiveMembership();
    if (!member) return;

    try {
      const [buildings, rooms, campuses, departments] = await Promise.all([
        API.getBuildings(member.college_id),
        API.getRooms(member.college_id),
        API.getCampuses(member.college_id),
        API.getDepartments(member.college_id)
      ]);

      this.buildings = buildings || [];
      this.rooms = rooms || [];
      this.campuses = campuses || [];
      this.departments = departments || [];

      this.renderBuildings();
      this.populateBuildingFilters();
      this.renderRooms();
    } catch (err) {
      console.error('Failed to load buildings & rooms:', err);
      if (window.App) window.App.showToast(err.message, 'error');
    }
  },

  renderBuildings() {
    const container = document.getElementById('buildingsListContainer');
    if (!container) return;

    if (this.buildings.length === 0) {
      container.innerHTML = `
        <div class="col-span-full py-8 text-center text-slate-500 dark:text-slate-400 bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700">
          <i data-lucide="building" class="w-8 h-8 mx-auto mb-2 text-slate-400"></i>
          <p class="font-medium text-sm">No buildings configured yet.</p>
        </div>`;
      if (window.App) window.App.refreshIcons();
      return;
    }

    const member = API._currentMember;
    const canManage = member && member.role === 'facilities_admin';

    container.innerHTML = this.buildings.map(b => `
      <div class="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700 p-5 shadow-sm hover:shadow-md transition">
        <div class="flex items-start justify-between">
          <div class="flex items-center gap-3">
            <div class="w-10 h-10 rounded-xl bg-indigo-50 dark:bg-indigo-950/50 text-indigo-600 dark:text-indigo-400 flex items-center justify-center font-bold">
              <i data-lucide="building" class="w-5 h-5"></i>
            </div>
            <div>
              <h4 class="font-bold text-slate-900 dark:text-white text-base tracking-tight">${this.escapeHtml(b.name)}</h4>
              <p class="text-xs text-slate-500 dark:text-slate-400">${this.escapeHtml(b.campus_name)}</p>
            </div>
          </div>
          ${canManage ? `
            <button onclick="BuildingsRooms.openBuildingModal('${b.id}')" class="p-1.5 rounded-lg text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 dark:hover:bg-slate-700 transition" title="Edit Building">
              <i data-lucide="edit-3" class="w-4 h-4"></i>
            </button>
          ` : ''}
        </div>
        <div class="mt-4 pt-3 border-t border-slate-100 dark:border-slate-700/60 flex items-center justify-between text-xs text-slate-600 dark:text-slate-300">
          <span class="flex items-center gap-1.5 font-medium">
            <i data-lucide="door-open" class="w-3.5 h-3.5 text-slate-400"></i>
            ${b.room_count} ${b.room_count === 1 ? 'Room' : 'Rooms'}
          </span>
          <span class="px-2 py-0.5 rounded-full bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 font-semibold text-[11px]">Active</span>
        </div>
      </div>
    `).join('');

    if (window.App) window.App.refreshIcons();
  },

  populateBuildingFilters() {
    const filterSelect = document.getElementById('roomBuildingFilter');
    if (filterSelect) {
      filterSelect.innerHTML = '<option value="all">All Buildings</option>' +
        this.buildings.map(b => `<option value="${b.id}">${this.escapeHtml(b.name)}</option>`).join('');
      filterSelect.value = this.selectedBuildingId;
    }
  },

  renderRooms() {
    const container = document.getElementById('roomsListContainer');
    if (!container) return;

    let filtered = this.rooms;
    if (this.selectedBuildingId !== 'all') {
      filtered = filtered.filter(r => r.building_id === this.selectedBuildingId);
    }

    if (filtered.length === 0) {
      container.innerHTML = `
        <div class="col-span-full py-12 text-center text-slate-500 dark:text-slate-400 bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700">
          <i data-lucide="door-closed" class="w-8 h-8 mx-auto mb-2 text-slate-400"></i>
          <p class="font-medium text-sm">No rooms found in this selection.</p>
        </div>`;
      if (window.App) window.App.refreshIcons();
      return;
    }

    const member = API._currentMember;
    const canManage = member && member.role === 'facilities_admin';

    container.innerHTML = filtered.map(r => {
      const isAvailable = r.status === 'available';
      const eqList = Array.isArray(r.equipment) ? r.equipment : [];

      return `
        <div class="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700 p-5 shadow-sm hover:shadow-md transition flex flex-col justify-between">
          <div>
            <div class="flex items-start justify-between">
              <div>
                <span class="px-2 py-0.5 rounded-md text-[10px] font-bold uppercase tracking-wider bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300">
                  ${this.escapeHtml(r.building_name)}
                </span>
                <h4 class="font-bold text-slate-900 dark:text-white text-lg mt-1 tracking-tight">${this.escapeHtml(r.name)}</h4>
                <p class="text-xs text-indigo-600 dark:text-indigo-400 font-medium">${this.escapeHtml(r.department_name)}</p>
              </div>
              <div class="flex items-center gap-1.5">
                <span class="px-2.5 py-1 rounded-full text-xs font-semibold ${isAvailable ? 'bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800' : 'bg-rose-50 dark:bg-rose-950/40 text-rose-700 dark:text-rose-300 border border-rose-200 dark:border-rose-800'}">
                  ${isAvailable ? 'Available' : 'Unavailable'}
                </span>
                ${canManage ? `
                  <button onclick="BuildingsRooms.openRoomModal('${r.id}')" class="p-1.5 rounded-lg text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 dark:hover:bg-slate-700 transition" title="Edit Room">
                    <i data-lucide="edit-3" class="w-4 h-4"></i>
                  </button>
                ` : ''}
              </div>
            </div>

            <div class="mt-4 flex items-center gap-3 text-xs text-slate-600 dark:text-slate-300">
              <span class="flex items-center gap-1">
                <i data-lucide="users" class="w-3.5 h-3.5 text-slate-400"></i>
                Capacity: <strong>${r.capacity}</strong>
              </span>
            </div>

            <!-- Equipment list -->
            <div class="mt-3">
              <div class="text-[11px] font-semibold text-slate-400 uppercase tracking-wider mb-1.5">Equipment</div>
              <div class="flex flex-wrap gap-1.5">
                ${eqList.length > 0 ? eqList.map(eq => `
                  <span class="px-2 py-0.5 rounded-md text-[11px] bg-slate-50 dark:bg-slate-900/60 border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 font-medium">
                    ${this.escapeHtml(eq)}
                  </span>
                `).join('') : '<span class="text-xs text-slate-400 italic">None specified</span>'}
              </div>
            </div>
          </div>

          <div class="mt-4 pt-3 border-t border-slate-100 dark:border-slate-700/60 text-[11px] text-slate-500 dark:text-slate-400 flex items-center justify-between">
            <span>Room ID format:</span>
            <code class="font-mono text-indigo-600 dark:text-indigo-400 font-semibold">${this.escapeHtml(r.building_name)} · ${this.escapeHtml(r.name)}</code>
          </div>
        </div>
      `;
    }).join('');

    if (window.App) window.App.refreshIcons();
  },

  async openBuildingModal(buildingId = null) {
    const member = await API.getActiveMembership();
    if (!member || member.role !== 'facilities_admin') {
      if (window.App) window.App.showToast('Permission denied: Only Facilities Administrators can manage buildings.', 'error');
      return;
    }

    this.editingBuildingId = buildingId;
    const modalTitle = document.getElementById('buildingModalTitle');
    const nameInput = document.getElementById('buildingNameInput');
    const campusSelect = document.getElementById('buildingCampusSelect');

    // Populate campus selector
    if (campusSelect) {
      campusSelect.innerHTML = this.campuses.map(c => `
        <option value="${c.id}">${this.escapeHtml(c.name)}</option>
      `).join('');
    }

    if (buildingId) {
      const b = this.buildings.find(item => item.id === buildingId);
      if (b) {
        if (modalTitle) modalTitle.textContent = 'Edit Building';
        if (nameInput) nameInput.value = b.name;
        if (campusSelect) campusSelect.value = b.campus_id;
      }
    } else {
      if (modalTitle) modalTitle.textContent = 'Add New Building';
      if (nameInput) nameInput.value = '';
      if (campusSelect && this.campuses[0]) campusSelect.value = this.campuses[0].id;
    }

    if (window.App) window.App.openModal('buildingModal');
  },

  async handleBuildingSubmit(e) {
    e.preventDefault();
    const member = await API.getActiveMembership();
    if (!member || member.role !== 'facilities_admin') {
      if (window.App) window.App.showToast('Permission denied: Only Facilities Administrators can manage buildings.', 'error');
      return;
    }

    const nameInput = document.getElementById('buildingNameInput');
    const campusSelect = document.getElementById('buildingCampusSelect');
    const submitBtn = document.getElementById('buildingSubmitBtn');

    const name = nameInput?.value.trim();
    const campusId = campusSelect?.value;

    if (!name) {
      if (window.App) window.App.showToast('Please enter a building name.', 'error');
      return;
    }

    if (submitBtn) {
      submitBtn.disabled = true;
      submitBtn.innerHTML = '<span class="animate-spin mr-2">⏳</span> Saving...';
    }

    try {
      if (this.editingBuildingId) {
        await API.updateBuilding(this.editingBuildingId, { name });
        if (window.App) window.App.showToast('Building updated successfully!', 'success');
      } else {
        await API.addBuilding({
          college_id: member.college_id,
          campus_id: campusId,
          name
        });
        if (window.App) window.App.showToast('New building created successfully!', 'success');
      }

      if (window.App) window.App.closeModals();
      await this.loadData();

      // Trigger app-wide refresh so room selectors immediately see new buildings
      if (window.ReportForm) window.ReportForm.loadReferenceData();
    } catch (err) {
      console.error('Error saving building:', err);
      if (window.App) window.App.showToast(err.message, 'error');
    } finally {
      if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.textContent = 'Save Building';
      }
    }
  },

  async openRoomModal(roomId = null) {
    const member = await API.getActiveMembership();
    if (!member || member.role !== 'facilities_admin') {
      if (window.App) window.App.showToast('Permission denied: Only Facilities Administrators can manage rooms.', 'error');
      return;
    }

    this.editingRoomId = roomId;
    const modalTitle = document.getElementById('roomModalTitle');
    const bSelect = document.getElementById('roomBuildingSelect');
    const dSelect = document.getElementById('roomDepartmentSelect');
    const nameInput = document.getElementById('roomNameInput');
    const capInput = document.getElementById('roomCapacityInput');
    const eqInput = document.getElementById('roomEquipmentInput');
    const statusSelect = document.getElementById('roomStatusSelect');

    // Populate building options
    if (bSelect) {
      bSelect.innerHTML = this.buildings.map(b => `
        <option value="${b.id}">${this.escapeHtml(b.name)}</option>
      `).join('');
    }

    // Populate department options
    if (dSelect) {
      dSelect.innerHTML = this.departments.map(d => `
        <option value="${d.id}">${this.escapeHtml(d.name)}</option>
      `).join('');
    }

    if (roomId) {
      const r = this.rooms.find(item => item.id === roomId);
      if (r) {
        if (modalTitle) modalTitle.textContent = 'Edit Room';
        if (bSelect) bSelect.value = r.building_id;
        if (dSelect) dSelect.value = r.department_id;
        if (nameInput) nameInput.value = r.name;
        if (capInput) capInput.value = r.capacity;
        if (eqInput) eqInput.value = Array.isArray(r.equipment) ? r.equipment.join(', ') : '';
        if (statusSelect) statusSelect.value = r.status;
      }
    } else {
      if (modalTitle) modalTitle.textContent = 'Add New Room';
      if (bSelect && this.buildings[0]) bSelect.value = this.buildings[0].id;
      if (dSelect && this.departments[0]) dSelect.value = this.departments[0].id;
      if (nameInput) nameInput.value = '';
      if (capInput) capInput.value = '30';
      if (eqInput) eqInput.value = '';
      if (statusSelect) statusSelect.value = 'available';
    }

    if (window.App) window.App.openModal('roomModal');
  },

  async handleRoomSubmit(e) {
    e.preventDefault();
    const member = await API.getActiveMembership();
    if (!member || member.role !== 'facilities_admin') {
      if (window.App) window.App.showToast('Permission denied: Only Facilities Administrators can manage rooms.', 'error');
      return;
    }

    const bSelect = document.getElementById('roomBuildingSelect');
    const dSelect = document.getElementById('roomDepartmentSelect');
    const nameInput = document.getElementById('roomNameInput');
    const capInput = document.getElementById('roomCapacityInput');
    const eqInput = document.getElementById('roomEquipmentInput');
    const statusSelect = document.getElementById('roomStatusSelect');
    const submitBtn = document.getElementById('roomSubmitBtn');

    const building_id = bSelect?.value;
    const department_id = dSelect?.value;
    const name = nameInput?.value.trim();
    const capacity = capInput?.value;
    const equipment = eqInput?.value;
    const status = statusSelect?.value || 'available';

    if (!name || !building_id || !department_id) {
      if (window.App) window.App.showToast('Please fill in all required room details.', 'error');
      return;
    }

    if (submitBtn) {
      submitBtn.disabled = true;
      submitBtn.innerHTML = '<span class="animate-spin mr-2">⏳</span> Saving...';
    }

    try {
      if (this.editingRoomId) {
        await API.updateRoom(this.editingRoomId, {
          building_id,
          department_id,
          name,
          capacity,
          equipment,
          status
        });
        if (window.App) window.App.showToast('Room updated successfully!', 'success');
      } else {
        await API.addRoom({
          college_id: member.college_id,
          building_id,
          department_id,
          name,
          capacity,
          equipment,
          status
        });
        if (window.App) window.App.showToast('New room created successfully!', 'success');
      }

      if (window.App) window.App.closeModals();
      await this.loadData();

      // Trigger app-wide refresh so report forms and bookings have the new room
      if (window.ReportForm) window.ReportForm.loadReferenceData();
      if (window.Bookings) window.Bookings.loadData();
    } catch (err) {
      console.error('Error saving room:', err);
      if (window.App) window.App.showToast(err.message, 'error');
    } finally {
      if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.textContent = 'Save Room';
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

window.BuildingsRooms = BuildingsRooms;
