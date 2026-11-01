/**
 * CampusOps Report Form Controller
 * Connected to campusops_submit_report_v2; server validates priority.
 * Dynamic hierarchy: Campus -> Department -> Building -> Room; equipment is free text.
 * Priority preview uses the same rule dataset as the database.
 * Preserves user inputs on submission errors.
 */

const ReportForm = {
  campuses: [],
  departments: [],
  buildings: [],
  rooms: [],

  async init() {
    this.setupEventListeners();
    document.getElementById('reportCategory').innerHTML = ReportRules.categories.map(c=>'<option value="'+c.code+'">'+this.escapeHtml(c.name)+'</option>').join('');
    document.getElementById('reportCategory').value = 'general';
    this.analyzeKeywords('');
  },

  async loadReferenceData() {
    const member = await API.getActiveMembership();
    if (!member) return;

    try {
      const [campuses, departments, buildings, rooms] = await Promise.all([
        API.getCampuses(member.college_id),
        API.getDepartments(member.college_id),
        API.getBuildings(member.college_id),
        API.getRooms(member.college_id)
      ]);

      this.campuses = campuses || [];
      this.departments = departments || [];
      this.buildings = buildings || [];
      this.rooms = rooms || [];


      this.populateDropdowns();
    } catch (err) {
      console.error('Failed to load report form data:', err);
      if (window.App) window.App.showToast('Unable to load campus locations: ' + err.message, 'error');
    }
  },

  populateDropdowns() {
    const member=API._currentMember;
    const campusSelect=document.getElementById('reportCampus');
    const deptSelect=document.getElementById('reportDepartment');
    const previousCampus=campusSelect?.value;
    if(campusSelect) {
      campusSelect.innerHTML=this.campuses.map(c=>'<option value="'+c.id+'">'+this.escapeHtml(c.name)+'</option>').join('');
      if(this.campuses.some(c=>c.id===previousCampus)) campusSelect.value=previousCampus;
    }
    if(deptSelect) {
      const previous=deptSelect.value || '';
      deptSelect.innerHTML='<option value="">All departments</option>'+this.departments.map(d=>'<option value="'+d.id+'">'+this.escapeHtml(d.name)+'</option>').join('');
      if(this.departments.some(d=>d.id===previous)) deptSelect.value=previous;
    }
    if (!previousCampus && campusSelect && deptSelect) {
      const room=this.rooms.find(r=>r.department_id===deptSelect.value);
      const building=this.buildings.find(b=>b.id===room?.building_id);
      if(building) campusSelect.value=building.campus_id;
    }
    this.updateBuildingDropdown();
  },

  updateBuildingDropdown() {
    const campusId=document.getElementById('reportCampus')?.value;
    const select=document.getElementById('reportBuilding');
    const buildings=this.buildings.filter(b=>b.campus_id===campusId);
    if(select) select.innerHTML='<option value="">All buildings in this campus</option>'+buildings.map(b=>'<option value="'+b.id+'">'+this.escapeHtml(b.name)+'</option>').join('');
    this.updateRoomDropdown();
  },

  updateRoomDropdown(selectedBuildingId = document.getElementById('reportBuilding')?.value || '') {
    const select=document.getElementById('reportRoom');
    if(!select) return;
    const campusId=document.getElementById('reportCampus')?.value;
    const departmentId=document.getElementById('reportDepartment')?.value;
    const buildings=new Set(this.buildings.filter(b=>b.campus_id===campusId).map(b=>b.id));
    const rooms=this.rooms.filter(r=>buildings.has(r.building_id) && (!departmentId || r.department_id===departmentId) && (!selectedBuildingId || r.building_id===selectedBuildingId));
    select.innerHTML='<option value="">Select the room</option>'+rooms.map(r=>'<option value="'+r.id+'">'+this.escapeHtml(r.building_name)+' · '+this.escapeHtml(r.name)+' · '+this.escapeHtml(r.department_name)+'</option>').join('');
  },

  setupEventListeners() {
    const form = document.getElementById('issueReportForm');
    const descInput = document.getElementById('reportDescription');
    const buildingSelect = document.getElementById('reportBuilding');

    document.getElementById('reportCampus')?.addEventListener('change', () => this.updateBuildingDropdown());
    document.getElementById('reportDepartment')?.addEventListener('change', () => this.updateRoomDropdown());

    if (buildingSelect) {
      buildingSelect.addEventListener('change', (e) => {
        this.updateRoomDropdown(e.target.value);
      });
    }


    // Keyword-based suggestion analysis
    if (descInput) {
      descInput.addEventListener('input', () => {
        this.analyzeKeywords(descInput.value);
      });
    }

    // Form submit
    if (form) {
      form.addEventListener('submit', (e) => {
        e.preventDefault();
        this.submitForm().catch(error => window.App?.showToast(error.message || 'Unable to submit your report.', 'error'));
      });
    }

    // Reset button
    const resetBtn = document.getElementById('resetReportBtn');
    if (resetBtn) {
      resetBtn.addEventListener('click', () => {
        this.resetForm();
      });
    }
  },

  analyzeKeywords() {
    if(window.ReportAI){ReportAI.signature='';ReportAI.result=null;}
    document.getElementById('reportPrioritySummary').textContent='Awaiting AI review';
    document.getElementById('reportPriorityReason').textContent='Press Submit to let AI assess Critical, High, Medium or Low.';
  },

  async submitForm() {
    if (this.submitting) return;
    const member = await API.getActiveMembership();
    if (!member) {
      if (window.App) {
        window.App.showToast('Please sign in to submit a maintenance report.', 'error');
        window.App.openModal('authModal');
      }
      return;
    }

    const campusSelect = document.getElementById('reportCampus');
    const deptSelect = document.getElementById('reportDepartment');
    const roomSelect = document.getElementById('reportRoom');
    const descInput = document.getElementById('reportDescription');
    const catSelect = document.getElementById('reportCategory');
    const submitBtn = document.getElementById('submitReportBtn');

    const description = descInput ? descInput.value.trim() : '';
    if (!description || description.length < 10 || description.length > 10000) {
      if (window.App) window.App.showToast('Please provide a detailed description of 10 to 10,000 characters.', 'error');
      if (descInput) descInput.focus();
      return;
    }

    const campusId = campusSelect?.value || (this.campuses[0] ? this.campuses[0].id : null);
    const selectedRoom=this.rooms.find(r=>r.id===roomSelect?.value);
    const departmentId = selectedRoom?.department_id || null;
    const roomId = roomSelect?.value || null;
    const equipment = null;
    const category = catSelect?.value || 'general';


    if (!campusId || !departmentId || !roomId) {
      if (window.App) window.App.showToast('Choose a campus, department and room.', 'error');
      return;
    }

    const photo = document.getElementById('reportPhoto')?.files[0];
    if (photo) {
      try { ReportPhotos.validate(photo); }
      catch (error) { App.showToast(error.message, 'error'); return; }
    }
    this.submitting = true;
    if (submitBtn) {
      submitBtn.disabled = true;
      submitBtn.innerHTML = '<span class="animate-spin mr-2">⏳</span> Submitting to CampusOps...';
    }

    try {
      if (!await ReportAI.review()) return;
      const result = await API.submitReport({
        p_assessment: ReportAI.result.assessment_id,
        p_choice: ReportAI.choice,p_target: ReportAI.target,
        p_college: member.college_id,
        p_campus: campusId,
        p_department: departmentId,
        p_description: description,
        p_room: roomId,
        p_category: category,
        p_equipment: equipment
      });

      let photoError = null;
      if (photo) {
        if (submitBtn) submitBtn.textContent = 'Report saved. Uploading photo…';
        try { await ReportPhotos.upload(result.report_id, photo); }
        catch (error) { photoError = error; }
      }
      if (window.App) {
        window.App.showToast('Report submitted. Reference: ' + result.report_id.slice(0, 8).toUpperCase(), 'success');
      }

      this.resetForm();

      // Switch to my reports tab to see the newly submitted report
      if (window.App) {
        await window.App.switchTab('myreports');
        if (photoError) {
          window.App.showToast('Your report was saved, but the photo failed: ' + photoError.message + '. Add it again in report details.', 'error');
          await MyReports.openDetailModal(result.report_id);
        }
      }
    } catch (err) {
      console.error('Report submission failed:', err);
      // PRESERVE FORM INPUT ON ERROR
      if (window.App) {
        window.App.showToast(err.message, 'error');
      }
    } finally {
      this.submitting = false;
      if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.textContent = 'Submit Facilities Report';
      }
    }
  },

  resetForm() {
    ReportAI.signature="";ReportAI.result=null;ReportAI.clarificationAssessment=null;document.getElementById("reportAIReview")?.remove();
    const form = document.getElementById('issueReportForm');
    if (form) form.reset();
    ReportPhotos.clearPreview();
    const box = document.getElementById('keywordSuggestionBox');
    if (box) box.classList.add('hidden');
    document.getElementById('reportCampus').value='';
    document.getElementById('reportDepartment').value='';
    this.populateDropdowns();
    document.getElementById('reportCategory').value='general';
    this.analyzeKeywords('');
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

window.ReportForm = ReportForm;
