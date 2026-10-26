/**
 * CampusOps Report Form Controller
 * Connected to campusops_submit_report RPC.
 * Dynamic hierarchy: Campus -> Department -> Building -> Room (Building · Room) -> Asset
 * Keyword-based category and priority suggestions (non-generative).
 * Preserves user inputs on submission errors.
 */

const ReportForm = {
  campuses: [],
  departments: [],
  buildings: [],
  rooms: [],
  assets: [],
  suggestedCategory: null,
  suggestedPriority: null,

  async init() {
    this.setupEventListeners();
  },

  async loadReferenceData() {
    const member = await API.getActiveMembership();
    if (!member) return;

    try {
      const [campuses, departments, buildings, rooms, assets] = await Promise.all([
        API.getCampuses(member.college_id),
        API.getDepartments(member.college_id),
        API.getBuildings(member.college_id),
        API.getRooms(member.college_id),
        API.getAssets(member.college_id)
      ]);

      this.campuses = campuses || [];
      this.departments = departments || [];
      this.buildings = buildings || [];
      this.rooms = rooms || [];
      this.assets = assets || [];

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
      const previous=deptSelect.value || member?.department_id;
      deptSelect.innerHTML=this.departments.map(d=>'<option value="'+d.id+'">'+this.escapeHtml(d.name)+'</option>').join('');
      if(this.departments.some(d=>d.id===previous)) deptSelect.value=previous;
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
    const rooms=this.rooms.filter(r=>buildings.has(r.building_id) && r.department_id===departmentId && (!selectedBuildingId || r.building_id===selectedBuildingId));
    select.innerHTML='<option value="">Select a room, or provide it later</option>'+rooms.map(r=>'<option value="'+r.id+'">'+this.escapeHtml(r.building_name)+' · '+this.escapeHtml(r.name)+'</option>').join('');
    this.updateAssetDropdown();
  },

  updateAssetDropdown(selectedRoomId = '') {
    const select=document.getElementById('reportAsset');
    if(!select) return;
    select.disabled=!selectedRoomId;
    const assets=selectedRoomId ? this.assets.filter(a=>a.room_id===selectedRoomId) : [];
    select.innerHTML='<option value="">'+(selectedRoomId?'Equipment / asset (optional)':'Choose a room first')+'</option>'+assets.map(a=>'<option value="'+a.id+'">'+this.escapeHtml(a.name)+' — '+this.escapeHtml(a.asset_tag)+'</option>').join('');
  },

  setupEventListeners() {
    const form = document.getElementById('issueReportForm');
    const descInput = document.getElementById('reportDescription');
    const buildingSelect = document.getElementById('reportBuilding');
    const roomSelect = document.getElementById('reportRoom');

    document.getElementById('reportCampus')?.addEventListener('change', () => this.updateBuildingDropdown());
    document.getElementById('reportDepartment')?.addEventListener('change', () => this.updateRoomDropdown());

    if (buildingSelect) {
      buildingSelect.addEventListener('change', (e) => {
        this.updateRoomDropdown(e.target.value);
      });
    }

    if (roomSelect) {
      roomSelect.addEventListener('change', (e) => {
        this.updateAssetDropdown(e.target.value);
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

  analyzeKeywords(text) {
    const box = document.getElementById('keywordSuggestionBox');
    const textLower = (text || '').toLowerCase();

    if (textLower.length < 5) {
      if (box) box.classList.add('hidden');
      return;
    }

    let cat = null;
    let pri = null;
    let rationale = '';

    // Electrical keywords
    if (/spark|short circuit|wire|breaker|switch|socket|power outage|blackout|electroc|shock|voltage/.test(textLower)) {
      cat = 'electrical';
      pri = /spark|shock|smoke|fire/.test(textLower) ? 1 : 2;
      rationale = 'Electrical safety hazard detected from keywords';
    }
    // Plumbing keywords
    else if (/leak|pipe|flood|water|drain|clog|sink|flush|toilet|overflow|sewage/.test(textLower)) {
      cat = 'plumbing';
      pri = /flood|burst|overflow|sewage/.test(textLower) ? 1 : 3;
      rationale = 'Plumbing fixture or water issue detected from keywords';
    }
    // IT / Network keywords
    else if (/wifi|router|lan|ethernet|switch|network|internet|cable|server|pc|computer|projector/.test(textLower)) {
      cat = 'it';
      pri = /server|offline|no internet/.test(textLower) ? 2 : 3;
      rationale = 'Network/IT equipment keywords detected';
    }
    // HVAC keywords
    else if (/ac|air condition|cooler|hvac|vent|heating|cooling|thermostat|airflow|duct/.test(textLower)) {
      cat = 'hvac';
      pri = 3;
      rationale = 'Climate control and ventilation keywords detected';
    }
    // General keywords
    else if (/chair|bench|desk|table|door|window|lock|handle|glass|paint|tile|stair|rail/.test(textLower)) {
      cat = 'general';
      pri = /glass|broken door|lock|stair/.test(textLower) ? 2 : 4;
      rationale = 'Physical campus fixtures keywords detected';
    }

    if (cat && box) {
      this.suggestedCategory = cat;
      this.suggestedPriority = pri;
      const priLabels = { 1: 'Critical', 2: 'High', 3: 'Medium', 4: 'Low' };

      box.classList.remove('hidden');
      box.innerHTML = `
        <div class="flex items-center justify-between p-3 rounded-xl bg-indigo-50/80 dark:bg-indigo-950/40 border border-indigo-200/80 dark:border-indigo-800/60 text-xs">
          <div class="flex items-center gap-2">
            <span class="w-6 h-6 rounded-lg bg-indigo-600 text-white flex items-center justify-center font-bold text-xs">💡</span>
            <div>
              <span class="font-semibold text-slate-900 dark:text-white">Keyword Suggestion:</span>
              <span class="text-indigo-700 dark:text-indigo-300 font-medium capitalize">Category: ${cat}</span> ·
              <span class="text-indigo-700 dark:text-indigo-300 font-medium">Priority: ${priLabels[pri] || 'Medium'}</span>
              <span class="text-slate-500 text-[11px] block mt-0.5">${rationale}</span>
            </div>
          </div>
          <button type="button" onclick="ReportForm.applySuggestion()" class="px-2.5 py-1 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white font-semibold shadow-sm transition">
            Apply
          </button>
        </div>
      `;
    } else if (box) {
      box.classList.add('hidden');
    }
  },

  applySuggestion() {
    const catSelect = document.getElementById('reportCategory');
    const priSelect = document.getElementById('reportPriority');
    const box = document.getElementById('keywordSuggestionBox');

    if (catSelect && this.suggestedCategory) {
      catSelect.value = this.suggestedCategory;
    }
    if (priSelect && this.suggestedPriority) {
      priSelect.value = String(this.suggestedPriority);
    }
    if (box) box.classList.add('hidden');
    if (window.App) window.App.showToast('Suggestion applied to form!', 'info');
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
    const assetSelect = document.getElementById('reportAsset');
    const descInput = document.getElementById('reportDescription');
    const catSelect = document.getElementById('reportCategory');
    const priSelect = document.getElementById('reportPriority');
    const submitBtn = document.getElementById('submitReportBtn');

    const description = descInput ? descInput.value.trim() : '';
    if (!description || description.length < 10 || description.length > 10000) {
      if (window.App) window.App.showToast('Please provide a detailed description of 10 to 10,000 characters.', 'error');
      if (descInput) descInput.focus();
      return;
    }

    const campusId = campusSelect?.value || (this.campuses[0] ? this.campuses[0].id : null);
    const departmentId = deptSelect?.value || member.department_id || (this.departments[0] ? this.departments[0].id : null);
    const roomId = roomSelect?.value || null;
    const assetId = assetSelect?.value || null;
    const category = catSelect?.value || 'general';
    const priority = priSelect?.value ? parseInt(priSelect.value, 10) : 3;

    if (!campusId || !departmentId) {
      if (window.App) window.App.showToast('Campus and department are required.', 'error');
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
      const result = await API.submitReport({
        p_college: member.college_id,
        p_campus: campusId,
        p_department: departmentId,
        p_description: description,
        p_room: roomId,
        p_asset: assetId,
        p_category: category,
        p_priority: priority
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
    const form = document.getElementById('issueReportForm');
    if (form) form.reset();
    ReportPhotos.clearPreview();
    const box = document.getElementById('keywordSuggestionBox');
    if (box) box.classList.add('hidden');
    this.suggestedCategory = null;
    this.suggestedPriority = null;
    this.populateDropdowns();
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
