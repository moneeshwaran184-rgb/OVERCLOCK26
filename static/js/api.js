/**
 * CampusOps Unified API Client
 * Wraps @supabase/supabase-js v2 for authentication, role queries,
 * workflow RPCs, reference data, and analytics views.
 */

const API = {
  get client() {
    return window.supabaseClient;
  },

  // State cache
  _currentUser: null,
  _currentMember: null,
  _cache: {},

  // ================= AUTHENTICATION =================
  async getSession() {
    if (!this.client) return null;
    try {
      const { data: { session }, error } = await this.client.auth.getSession();
      if (error) throw error;
      return session;
    } catch (e) {
      console.warn('getSession error:', e);
      return null;
    }
  },

  async getCurrentUser() {
    if (!this.client) return null;
    try {
      const { data: { user }, error } = await this.client.auth.getUser();
      if (error) {
        if (error.status === 401 || error.message.includes('expired')) {
          await this.signOut();
        }
        return null;
      }
      this._currentUser = user;
      return user;
    } catch (e) {
      return null;
    }
  },

  async signIn(email, password) {
    if (!this.client) throw new Error('Supabase client is not initialized');
    const { data, error } = await this.client.auth.signInWithPassword({
      email: email.trim(),
      password
    });
    if (error) throw new Error(this.formatError(error));
    this._currentUser = data.user;
    this._currentMember = null;
    return data;
  },

  async signOut() {
    this._currentUser = null;
    this._currentMember = null;
    this._cache = {};
    if (this.client) {
      try {
        await this.client.auth.signOut();
      } catch (e) {}
    }
  },

  // ================= MEMBERSHIP & ROLES =================
  async getActiveMembership(forceRefresh = false) {
    if (this._currentMember && !forceRefresh) return this._currentMember;
    const user = await this.getCurrentUser();
    if (!user) {
      this._currentMember = null;
      return null;
    }

    const { data, error } = await this.client
      .from('campusops_members')
      .select('*, college:campusops_colleges(*), department:campusops_departments(*)')
      .eq('user_id', user.id)
      .eq('active', true);

    if (error) {
      console.error('Error fetching membership:', error);
      throw new Error(this.formatError(error));
    }

    if (!data || data.length === 0) {
      this._currentMember = null;
      return null;
    }

    // Default to primary active membership
    this._currentMember = data[0];
    return this._currentMember;
  },

  // ================= REFERENCE DATA =================
  async getColleges() {
    const { data, error } = await this.client
      .from('campusops_colleges')
      .select('*')
      .order('name');
    if (error) throw new Error(this.formatError(error));
    return data || [];
  },

  async getCampuses(collegeId) {
    let q = this.client.from('campusops_campuses').select('*').order('name');
    if (collegeId) q = q.eq('college_id', collegeId);
    const { data, error } = await q;
    if (error) throw new Error(this.formatError(error));
    return data || [];
  },

  async getDepartments(collegeId) {
    let q = this.client.from('campusops_departments').select('*').order('name');
    if (collegeId) q = q.eq('college_id', collegeId);
    const { data, error } = await q;
    if (error) throw new Error(this.formatError(error));
    return data || [];
  },

  async getBuildings(collegeId) {
    let q = this.client
      .from('campusops_buildings')
      .select('*, campus:campusops_campuses(name), rooms:campusops_rooms(id)')
      .order('name');
    if (collegeId) q = q.eq('college_id', collegeId);
    const { data, error } = await q;
    if (error) throw new Error(this.formatError(error));
    return (data || []).map(b => ({
      ...b,
      campus_name: b.campus?.name || 'Main Campus',
      room_count: Array.isArray(b.rooms) ? b.rooms.length : 0
    }));
  },

  async getRooms(collegeId, buildingId = null) {
    let q = this.client
      .from('campusops_rooms')
      .select('*, building:campusops_buildings(id, name), department:campusops_departments(id, name)')
      .order('name');
    if (collegeId) q = q.eq('college_id', collegeId);
    if (buildingId) q = q.eq('building_id', buildingId);
    const { data, error } = await q;
    if (error) throw new Error(this.formatError(error));
    return (data || []).map(r => ({
      ...r,
      building_name: r.building?.name || 'Building',
      department_name: r.department?.name || 'Department',
      display_name: `${r.building?.name || 'Building'} · ${r.name}`
    }));
  },

  formatRoomDisplay(roomOrObj) {
    if (!roomOrObj) return '—';
    if (typeof roomOrObj === 'string') return roomOrObj;
    const bName = roomOrObj.building_name || roomOrObj.building?.name || '';
    const rName = roomOrObj.name || roomOrObj.room_name || '';
    return bName ? `${bName} · ${rName}` : rName;
  },

  async getAssets(collegeId, roomId = null) {
    let q = this.client
      .from('campusops_assets')
      .select('*, room:campusops_rooms(id, name, building:campusops_buildings(name))')
      .order('name');
    if (collegeId) q = q.eq('college_id', collegeId);
    if (roomId) q = q.eq('room_id', roomId);
    const { data, error } = await q;
    if (error) throw new Error(this.formatError(error));
    return (data || []).map(a => ({
      ...a,
      room_display: a.room ? `${a.room.building?.name || ''} · ${a.room.name}` : ''
    }));
  },

  async getSkills(collegeId) {
    let q = this.client.from('campusops_skills').select('*').order('name');
    if (collegeId) q = q.eq('college_id', collegeId);
    const { data, error } = await q;
    if (error) throw new Error(this.formatError(error));
    return data || [];
  },

  async getStaff(collegeId) {
    let q = this.client
      .from('campusops_staff')
      .select('*, member:campusops_members!campusops_staff_college_id_user_id_fkey(full_name, role), skills:campusops_staff_skills(*, skill:campusops_skills(name))');
    if (collegeId) q = q.eq('college_id', collegeId);
    const { data, error } = await q;
    if (error) {
      // Fallback query if relation fkey name differs
      const { data: fallback, error: fbErr } = await this.client
        .from('campusops_members')
        .select('*')
        .eq('college_id', collegeId)
        .eq('role', 'technician');
      if (fbErr) throw new Error(this.formatError(fbErr));
      return fallback || [];
    }
    return data || [];
  },

  async getInventoryItems(collegeId) {
    let q = this.client.from('campusops_inventory_items').select('*').order('name');
    if (collegeId) q = q.eq('college_id', collegeId);
    const { data, error } = await q;
    if (error) throw new Error(this.formatError(error));
    return data || [];
  },

  async getStockLocations(collegeId) {
    let q = this.client.from('campusops_stock_locations').select('*').order('name');
    if (collegeId) q = q.eq('college_id', collegeId);
    const { data, error } = await q;
    if (error) throw new Error(this.formatError(error));
    return data || [];
  },

  async getStock(collegeId) {
    let q = this.client
      .from('campusops_stock')
      .select('*, item:campusops_inventory_items(*), location:campusops_stock_locations(*)')
      .order('created_at', { ascending: false });
    if (collegeId) q = q.eq('college_id', collegeId);
    const { data, error } = await q;
    if (error) throw new Error(this.formatError(error));
    return data || [];
  },

  async getBudgets(collegeId, departmentId = null) {
    let q = this.client
      .from('campusops_budgets')
      .select('*, department:campusops_departments(name)')
      .order('name');
    if (collegeId) q = q.eq('college_id', collegeId);
    if (departmentId) q = q.eq('department_id', departmentId);
    const { data, error } = await q;
    if (error) throw new Error(this.formatError(error));
    return data || [];
  },

  async getClasses(collegeId, facultyId = null) {
    let q = this.client
      .from('campusops_classes')
      .select('*, department:campusops_departments(name), faculty:campusops_members!campusops_classes_college_id_faculty_id_fkey(full_name)')
      .order('code');
    if (collegeId) q = q.eq('college_id', collegeId);
    if (facultyId) q = q.eq('faculty_id', facultyId);
    const { data, error } = await q;
    if (error) {
      // Fallback without deep fkey join
      let fb = this.client.from('campusops_classes').select('*').order('code');
      if (collegeId) fb = fb.eq('college_id', collegeId);
      if (facultyId) fb = fb.eq('faculty_id', facultyId);
      const { data: fbData, error: fbErr } = await fb;
      if (fbErr) throw new Error(this.formatError(fbErr));
      return fbData || [];
    }
    return data || [];
  },

  async getBookings(collegeId, roomId = null, classId = null) {
    let q = this.client
      .from('campusops_bookings')
      .select('*, room:campusops_rooms(id, name, building:campusops_buildings(name)), department:campusops_departments(name)')
      .order('starts_at', { ascending: false });
    if (collegeId) q = q.eq('college_id', collegeId);
    if (roomId) q = q.eq('room_id', roomId);
    if (classId) q = q.eq('class_id', classId);
    const { data, error } = await q;
    if (error) throw new Error(this.formatError(error));
    return (data || []).map(b => ({
      ...b,
      room_display: b.room ? `${b.room.building?.name || ''} · ${b.room.name}` : ''
    }));
  },

  async getMembers(collegeId) {
    let q = this.client
      .from('campusops_members')
      .select('*, department:campusops_departments(name)')
      .order('full_name');
    if (collegeId) q = q.eq('college_id', collegeId);
    const { data, error } = await q;
    if (error) throw new Error(this.formatError(error));
    return data || [];
  },

  // ================= BUILDINGS & ROOMS MANAGEMENT (FACILITIES ADMIN) =================
  async addBuilding({ college_id, campus_id, name }) {
    if (!name || !name.trim()) throw new Error('Building name is required');
    const { data, error } = await this.client
      .from('campusops_buildings')
      .insert([{
        college_id,
        campus_id,
        name: name.trim()
      }])
      .select();
    if (error) throw new Error(this.formatError(error));
    return data?.[0];
  },

  async updateBuilding(buildingId, { name }) {
    if (!name || !name.trim()) throw new Error('Building name is required');
    const { data, error } = await this.client
      .from('campusops_buildings')
      .update({ name: name.trim() })
      .eq('id', buildingId)
      .select();
    if (error) throw new Error(this.formatError(error));
    return data?.[0];
  },

  async addRoom({ college_id, building_id, department_id, name, capacity, equipment, status }) {
    if (!name || !name.trim()) throw new Error('Room name is required');
    if (!building_id) throw new Error('Building selection is required');
    if (!department_id) throw new Error('Department selection is required');
    const cap = parseInt(capacity, 10);
    if (isNaN(cap) || cap <= 0) throw new Error('Capacity must be a positive number');

    const equipArray = Array.isArray(equipment)
      ? equipment
      : (equipment || '').split(',').map(s => s.trim()).filter(Boolean);

    const { data, error } = await this.client
      .from('campusops_rooms')
      .insert([{
        college_id,
        building_id,
        department_id,
        name: name.trim(),
        capacity: cap,
        equipment: equipArray,
        status: status || 'available'
      }])
      .select();
    if (error) throw new Error(this.formatError(error));
    return data?.[0];
  },

  async updateRoom(roomId, { building_id, department_id, name, capacity, equipment, status }) {
    const updatePayload = {};
    if (building_id) updatePayload.building_id = building_id;
    if (department_id) updatePayload.department_id = department_id;
    if (name) updatePayload.name = name.trim();
    if (capacity !== undefined) {
      const cap = parseInt(capacity, 10);
      if (isNaN(cap) || cap <= 0) throw new Error('Capacity must be a positive number');
      updatePayload.capacity = cap;
    }
    if (equipment !== undefined) {
      updatePayload.equipment = Array.isArray(equipment)
        ? equipment
        : (equipment || '').split(',').map(s => s.trim()).filter(Boolean);
    }
    if (status) updatePayload.status = status;

    const { data, error } = await this.client
      .from('campusops_rooms')
      .update(updatePayload)
      .eq('id', roomId)
      .select();
    if (error) throw new Error(this.formatError(error));
    return data?.[0];
  },

  // ================= WORKFLOW RPC FUNCTIONS =================
  async submitReport({ p_college, p_campus, p_department, p_description, p_room = null, p_asset = null, p_category = null, p_priority = null }) {
    const { data, error } = await this.client.rpc('campusops_submit_report', {
      p_college,
      p_campus,
      p_department,
      p_description: p_description.trim(),
      p_room,
      p_asset,
      p_category,
      p_priority: p_priority ? parseInt(p_priority, 10) : null
    });
    if (error) throw new Error(this.formatError(error));
    return data;
  },

  async replyReport({ p_report, p_message, p_room = null }) {
    const { data, error } = await this.client.rpc('campusops_reply_report', {
      p_report,
      p_message: p_message.trim(),
      p_room
    });
    if (error) throw new Error(this.formatError(error));
    return data;
  },

  async getReportTimeline(p_report) {
    const { data, error } = await this.client.rpc('campusops_report_timeline', {
      p_report
    });
    if (error) throw new Error(this.formatError(error));
    return data || [];
  },

  async getIncidentSummary(p_incident) {
    const { data, error } = await this.client.rpc('campusops_incident_summary', {
      p_incident
    });
    if (error) throw new Error(this.formatError(error));
    return data;
  },

  async mergeIncidents({ p_target, p_source }) {
    const { data, error } = await this.client.rpc('campusops_merge_incidents', {
      p_target,
      p_source
    });
    if (error) throw new Error(this.formatError(error));
    return data;
  },

  async resolveIncident({ p_incident, p_summary }) {
    const { data, error } = await this.client.rpc('campusops_resolve_incident', {
      p_incident,
      p_summary: p_summary.trim()
    });
    if (error) throw new Error(this.formatError(error));
    return data;
  },

  async setIncidentPriority({ p_incident, p_priority }) {
    const { data, error } = await this.client.rpc('campusops_set_incident_priority', {
      p_incident,
      p_priority: parseInt(p_priority, 10)
    });
    if (error) throw new Error(this.formatError(error));
    return data;
  },

  async createWorkOrder({ p_incident, p_title, p_skills = [], p_parts = [], p_minutes = 60, p_cost = 0, p_budget = null, p_asset = null }) {
    const { data, error } = await this.client.rpc('campusops_create_work_order', {
      p_incident,
      p_title: p_title.trim(),
      p_skills,
      p_parts,
      p_minutes: parseInt(p_minutes, 10) || 60,
      p_cost: parseFloat(p_cost) || 0,
      p_budget,
      p_asset
    });
    if (error) throw new Error(this.formatError(error));
    return data;
  },

  async assignWork(p_work) {
    const { data, error } = await this.client.rpc('campusops_assign_work', {
      p_work
    });
    if (error) throw new Error(this.formatError(error));
    return data;
  },

  async acknowledgeWork(p_work) {
    const { data, error } = await this.client.rpc('campusops_acknowledge_work', {
      p_work
    });
    if (error) throw new Error(this.formatError(error));
    return data;
  },

  async startWork(p_work) {
    const { data, error } = await this.client.rpc('campusops_start_work', {
      p_work
    });
    if (error) throw new Error(this.formatError(error));
    return data;
  },

  async completeWork({ p_work, p_note, p_actual_cost = 0 }) {
    const { data, error } = await this.client.rpc('campusops_complete_work', {
      p_work,
      p_note: p_note.trim(),
      p_actual_cost: parseFloat(p_actual_cost) || 0
    });
    if (error) throw new Error(this.formatError(error));
    return data;
  },

  async cancelWork({ p_work, p_reason }) {
    const { data, error } = await this.client.rpc('campusops_cancel_work', {
      p_work,
      p_reason: p_reason.trim()
    });
    if (error) throw new Error(this.formatError(error));
    return data;
  },

  async setAvailability({ p_college, p_available }) {
    const { data, error } = await this.client.rpc('campusops_set_availability', {
      p_college,
      p_available: Boolean(p_available)
    });
    if (error) throw new Error(this.formatError(error));
    return data;
  },

  async reserveParts(p_work) {
    const { data, error } = await this.client.rpc('campusops_reserve_parts', {
      p_work
    });
    if (error) throw new Error(this.formatError(error));
    return data;
  },

  async requestRepairApproval({ p_work, p_reason, p_emergency = false }) {
    const { data, error } = await this.client.rpc('campusops_request_repair_approval', {
      p_work,
      p_reason: p_reason.trim(),
      p_emergency: Boolean(p_emergency)
    });
    if (error) throw new Error(this.formatError(error));
    return data;
  },

  async requestPurchase({ p_college, p_department, p_stock, p_quantity, p_total_cost, p_budget, p_reason }) {
    const { data, error } = await this.client.rpc('campusops_request_purchase', {
      p_college,
      p_department,
      p_stock,
      p_quantity: parseFloat(p_quantity),
      p_total_cost: parseFloat(p_total_cost),
      p_budget,
      p_reason: p_reason.trim()
    });
    if (error) throw new Error(this.formatError(error));
    return data;
  },

  async decideApproval({ p_approval, p_approve, p_comment = null }) {
    const { data, error } = await this.client.rpc('campusops_decide_approval', {
      p_approval,
      p_approve: Boolean(p_approve),
      p_comment: p_comment ? p_comment.trim() : null
    });
    if (error) throw new Error(this.formatError(error));
    return data;
  },

  async receivePurchase(p_approval) {
    const { data, error } = await this.client.rpc('campusops_receive_purchase', {
      p_approval
    });
    if (error) throw new Error(this.formatError(error));
    return data;
  },

  async bookRoom({ p_college, p_room, p_title, p_start, p_end, p_attendees = 1, p_equipment = [], p_class = null }) {
    const { data, error } = await this.client.rpc('campusops_book_room', {
      p_college,
      p_room,
      p_title: p_title.trim(),
      p_start: new Date(p_start).toISOString(),
      p_end: new Date(p_end).toISOString(),
      p_attendees: parseInt(p_attendees, 10) || 1,
      p_equipment,
      p_class
    });
    if (error) throw new Error(this.formatError(error));
    return data;
  },

  async cancelBooking(p_booking) {
    const { data, error } = await this.client.rpc('campusops_cancel_booking', {
      p_booking
    });
    if (error) throw new Error(this.formatError(error));
    return data;
  },

  async moveBooking({ p_booking, p_room }) {
    const { data, error } = await this.client.rpc('campusops_move_booking', {
      p_booking,
      p_room
    });
    if (error) throw new Error(this.formatError(error));
    return data;
  },

  async findRooms({ p_college, p_campus, p_start, p_end, p_capacity, p_equipment = [] }) {
    const { data, error } = await this.client.rpc('campusops_find_rooms', {
      p_college,
      p_campus,
      p_start: new Date(p_start).toISOString(),
      p_end: new Date(p_end).toISOString(),
      p_capacity: parseInt(p_capacity, 10) || 1,
      p_equipment
    });
    if (error) throw new Error(this.formatError(error));
    return data || [];
  },

  async getRoomSchedule({ p_college, p_start, p_end }) {
    const { data, error } = await this.client.rpc('campusops_room_schedule', {
      p_college,
      p_start: new Date(p_start).toISOString(),
      p_end: new Date(p_end).toISOString()
    });
    if (error) throw new Error(this.formatError(error));
    return data || [];
  },

  async requestBookingOverride({ p_college, p_room, p_title, p_start, p_end, p_attendees = 1, p_reason }) {
    const { data, error } = await this.client.rpc('campusops_request_booking_override', {
      p_college,
      p_room,
      p_title: p_title.trim(),
      p_start: new Date(p_start).toISOString(),
      p_end: new Date(p_end).toISOString(),
      p_attendees: parseInt(p_attendees, 10) || 1,
      p_reason: p_reason.trim()
    });
    if (error) throw new Error(this.formatError(error));
    return data;
  },

  async executeBookingOverride(p_approval) {
    const { data, error } = await this.client.rpc('campusops_execute_booking_override', {
      p_approval
    });
    if (error) throw new Error(this.formatError(error));
    return data;
  },

  async setMember({ p_college, p_user, p_name, p_role, p_department, p_active = true }) {
    const { data, error } = await this.client.rpc('campusops_set_member', {
      p_college,
      p_user,
      p_name: p_name.trim(),
      p_role,
      p_department,
      p_active: Boolean(p_active)
    });
    if (error) throw new Error(this.formatError(error));
    return data;
  },

  async setBudget({ p_college, p_department, p_name, p_amount, p_start, p_end, p_id = null }) {
    const { data, error } = await this.client.rpc('campusops_set_budget', {
      p_college,
      p_department,
      p_name: p_name.trim(),
      p_amount: parseFloat(p_amount),
      p_start,
      p_end,
      p_id
    });
    if (error) throw new Error(this.formatError(error));
    return data;
  },

  async createStock({ p_college, p_item, p_location }) {
    const { data, error } = await this.client.rpc('campusops_create_stock', {
      p_college,
      p_item,
      p_location
    });
    if (error) throw new Error(this.formatError(error));
    return data;
  },

  async adjustStock({ p_stock, p_delta, p_reason }) {
    const { data, error } = await this.client.rpc('campusops_adjust_stock', {
      p_stock,
      p_delta: parseFloat(p_delta),
      p_reason: p_reason.trim()
    });
    if (error) throw new Error(this.formatError(error));
    return data;
  },

  async readNotification(p_notification) {
    const { data, error } = await this.client.rpc('campusops_read_notification', {
      p_notification
    });
    if (error) throw new Error(this.formatError(error));
    return data;
  },

  // ================= QUEUES & SPECIFIC FEEDS =================
  async getStudentReports(userId) {
    const { data, error } = await this.client
      .from('campusops_reports')
      .select(`
        *,
        room:campusops_rooms(id, name, building:campusops_buildings(name)),
        asset:campusops_assets(name, asset_tag),
        incident:campusops_incidents(id, title, status, priority),
        messages:campusops_report_messages(*, author:campusops_members!campusops_report_messages_college_id_author_id_fkey(full_name, role))
      `)
      .eq('reporter_id', userId)
      .order('created_at', { ascending: false });

    if (error) throw new Error(this.formatError(error));
    return (data || []).map(r => ({
      ...r,
      room_display: r.room ? `${r.room.building?.name || ''} · ${r.room.name}` : '—'
    }));
  },

  async getDepartmentReports(departmentId) {
    let q = this.client
      .from('campusops_reports')
      .select(`
        *,
        reporter:campusops_members!campusops_reports_college_id_reporter_id_fkey(full_name, role),
        room:campusops_rooms(id, name, building:campusops_buildings(name)),
        asset:campusops_assets(name, asset_tag),
        incident:campusops_incidents(id, title, status, priority)
      `)
      .order('created_at', { ascending: false });
    if (departmentId) q = q.eq('department_id', departmentId);
    const { data, error } = await q;
    if (error) throw new Error(this.formatError(error));
    return (data || []).map(r => ({
      ...r,
      room_display: r.room ? `${r.room.building?.name || ''} · ${r.room.name}` : '—'
    }));
  },

  async getIncidents(collegeId, departmentId = null) {
    let q = this.client
      .from('campusops_incidents')
      .select(`
        *,
        department:campusops_departments(name),
        rooms:campusops_incident_rooms(room:campusops_rooms(id, name, building:campusops_buildings(name))),
        work_orders:campusops_work_orders(id, title, status, priority, assigned_to)
      `)
      .order('created_at', { ascending: false });
    if (collegeId) q = q.eq('college_id', collegeId);
    if (departmentId) q = q.eq('department_id', departmentId);
    const { data, error } = await q;
    if (error) throw new Error(this.formatError(error));
    return data || [];
  },

  async getWorkOrders(collegeId, technicianId = null) {
    let q = this.client
      .from('campusops_work_orders')
      .select(`
        *,
        incident:campusops_incidents(id, title, category),
        asset:campusops_assets(id, name, asset_tag),
        parts:campusops_work_parts(*, stock:campusops_stock(id, on_hand, item:campusops_inventory_items(name, sku, unit))),
        assigned_staff:campusops_staff!campusops_work_orders_college_id_assigned_to_fkey(member:campusops_members!campusops_staff_college_id_user_id_fkey(full_name, role))
      `)
      .order('created_at', { ascending: false });
    if (collegeId) q = q.eq('college_id', collegeId);
    if (technicianId) q = q.eq('assigned_to', technicianId);
    const { data, error } = await q;
    if (error) throw new Error(this.formatError(error));
    return (data || []).map(w => ({ ...w, assigned_user: w.assigned_staff?.member || null }));
  },

  async getApprovals(collegeId, departmentId = null) {
    let q = this.client
      .from('campusops_approvals')
      .select(`
        *,
        requester:campusops_members!campusops_approvals_college_id_requested_by_fkey(full_name, role),
        department:campusops_departments(name),
        decisions:campusops_approval_decisions(*, decider:campusops_members!campusops_approval_decisions_college_id_decided_by_fkey(full_name, role))
      `)
      .order('created_at', { ascending: false });
    if (collegeId) q = q.eq('college_id', collegeId);
    if (departmentId) q = q.eq('department_id', departmentId);
    const { data, error } = await q;
    if (error) throw new Error(this.formatError(error));
    return data || [];
  },

  async getNotifications(userId) {
    let q = this.client
      .from('campusops_notifications')
      .select('*')
      .order('created_at', { ascending: false });
    if (userId) q = q.eq('user_id', userId);
    const { data, error } = await q;
    if (error) throw new Error(this.formatError(error));
    return data || [];
  },

  // ================= ANALYTICS VIEWS =================
  async getWorkAnalytics() {
    const { data, error } = await this.client.from('campusops_work_analytics').select('*');
    if (error) throw new Error(this.formatError(error));
    return data || [];
  },

  async getIncidentSlaAnalytics() {
    const { data, error } = await this.client.from('campusops_incident_sla_analytics').select('*');
    if (error) throw new Error(this.formatError(error));
    return data || [];
  },

  async getStaffWorkload() {
    const { data, error } = await this.client.from('campusops_staff_workload').select('*');
    if (error) throw new Error(this.formatError(error));
    return data || [];
  },

  async getStockAlerts() {
    const { data, error } = await this.client.from('campusops_stock_alerts').select('*');
    if (error) throw new Error(this.formatError(error));
    return data || [];
  },

  async getRecurringIncidents() {
    const { data, error } = await this.client.from('campusops_recurring_incidents').select('*');
    if (error) throw new Error(this.formatError(error));
    return data || [];
  },

  // ================= PLAIN LANGUAGE ERROR FORMATTER =================
  formatError(err) {
    if (!err) return 'An unexpected error occurred.';
    if (typeof err === 'string') return err;
    let msg = err.message || err.details || err.hint || '';

    // PostgreSQL / RLS error mappings
    if (msg.includes('new row violates row-level security policy') || msg.includes('row-level security')) {
      return 'Permission denied: Your role does not have authorization to perform this action.';
    }
    if (msg.includes('College membership required')) {
      return 'Active college membership is required for this action.';
    }
    if (msg.includes('Self-approval forbidden')) {
      return 'You cannot approve a request that you submitted yourself.';
    }
    if (msg.includes('Booking role required')) {
      return 'Faculty or Facilities role is required to manage room bookings.';
    }
    if (msg.includes('Assigned technician required')) {
      return 'This action is restricted to the assigned technician.';
    }
    if (msg.includes('Finish or cancel all work orders first')) {
      return 'Cannot resolve incident: All associated work orders must be completed or cancelled first.';
    }
    if (msg.includes('Invalid credentials') || msg.includes('Invalid login credentials')) {
      return 'Invalid email or password. Please verify your credentials.';
    }
    if (msg.includes('JWT expired') || msg.includes('token is expired')) {
      return 'Your session has expired. Please sign in again.';
    }
    if (msg.includes('duplicate key value') || msg.includes('unique constraint')) {
      return 'A record with this name, code, or identifier already exists.';
    }
    if (msg.includes('Stock shortage') || msg.includes('insufficient stock')) {
      return 'Insufficient parts stock available to reserve or consume.';
    }

    // Clean up generic Postgres prefixes
    msg = msg.replace(/^Error:\s*/, '').replace(/^PG::Error:\s*/, '');
    return msg || 'An error occurred while communicating with CampusOps.';
  }
};

window.API = API;
