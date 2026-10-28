/* Private report photos: existing Supabase bucket, RLS and attachment RPC. */
const ReportPhotos = {
  bucket: 'campusops-evidence',
  pending: new Map(),
  previewUrl: null,
  validate(file) {
    if (!file || !['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) throw new Error('Choose a JPG, PNG or WebP image.');
    if (!file.size || file.size > 5 * 1024 * 1024) throw new Error('Choose an image smaller than 5 MB.');
  },
  clearPreview() {
    if (this.previewUrl) URL.revokeObjectURL(this.previewUrl);
    this.previewUrl = null;
    const preview = document.getElementById('reportPhotoPreview');
    if (preview) { preview.removeAttribute('src'); preview.hidden = true; }
    const input = document.getElementById('reportPhoto');
    if (input) input.value = '';
    document.getElementById('removeReportPhoto')?.setAttribute('hidden', '');
  },
  async preview(input) {
    const file = input.files[0];
    this.clearPreview();
    if (!file) return;
    try {
      this.validate(file);
      // Decode before accepting the file; a renamed non-image must not reach storage.
      const bitmap = await createImageBitmap(file);
      bitmap.close();
      const transfer = new DataTransfer(); transfer.items.add(file); input.files = transfer.files;
      this.previewUrl = URL.createObjectURL(file);
      const image = document.getElementById('reportPhotoPreview');
      image.src = this.previewUrl; image.hidden = false;
      document.getElementById('removeReportPhoto').hidden = false;
    } catch (error) { App.showToast(error.message || 'This image could not be opened.', 'error'); }
  },
  async list(reportId) {
    const {data, error} = await API.client.from('campusops_attachments').select('id,object_name,media_type').eq('report_id', reportId).eq('media_type', 'image').order('created_at');
    if (error) throw new Error(API.formatError(error));
    return data || [];
  },
  async upload(reportId, file) {
    this.validate(file);
    const member = await API.getActiveMembership();
    if (!member) throw new Error('Please sign in again.');
    // Recover a completed attachment after a lost network response without duplicating it.
    if ((await this.list(reportId)).length) { this.pending.delete(reportId); return; }
    let pending = this.pending.get(reportId);
    if (!pending) {
      const extension = {'image/jpeg':'jpg','image/png':'png','image/webp':'webp'}[file.type];
      const path = `${member.college_id}/${reportId}/${member.user_id}/${crypto.randomUUID()}.${extension}`;
      const {error} = await API.client.storage.from(this.bucket).upload(path, file, {contentType:file.type, upsert:false});
      if (error) throw new Error(error.message);
      pending = {path}; this.pending.set(reportId, pending);
    }
    const {error} = await API.client.rpc('campusops_attach_evidence', {p_report:reportId, p_object_name:pending.path, p_media_type:'image'});
    if (error) throw new Error(API.formatError(error));
    this.pending.delete(reportId);
  },
  async render(container, reportId, allowUpload = false) {
    const request = Symbol(); container._photoRequest = request;
    container.textContent = 'Loading report photo…';
    try {
      const photos = await this.list(reportId);
      if (container._photoRequest !== request) return;
      container.replaceChildren();
      const title = document.createElement('h4'); title.textContent = 'Problem photo'; title.className = 'text-sm font-bold mb-2'; container.append(title);
      if (!photos.length) {
        const note = document.createElement('p'); note.textContent = 'No photo attached.'; note.className = 'text-xs text-slate-500'; container.append(note);
        if (allowUpload) {
          const label = document.createElement('label'); label.textContent = 'Add a photo (JPG, PNG or WebP, up to 5 MB)'; label.className = 'block text-xs mt-3';
          const input = document.createElement('input'); input.type = 'file'; input.accept = 'image/jpeg,image/png,image/webp'; input.className = 'block mt-2 max-w-full'; label.append(input); container.append(label);
          input.addEventListener('change', async () => {
            const file = input.files[0]; if (!file) return;
            input.disabled = true;
            try {
              this.validate(file); const bitmap = await createImageBitmap(file); bitmap.close();
              await this.upload(reportId, file);
              App.showToast('Photo attached to your report.', 'success');
              await this.render(container, reportId, true);
            } catch (error) { App.showToast('Photo not attached: ' + error.message + '. You can try again here.', 'error'); input.disabled = false; input.value = ''; }
          });
        }
      }
      for (const photo of photos) {
        const {data,error} = await API.client.storage.from(this.bucket).createSignedUrl(photo.object_name, 3600);
        if (container._photoRequest !== request) return;
        if (error) throw new Error(error.message);
        const link = document.createElement('a'); link.href = data.signedUrl; link.target = '_blank'; link.rel = 'noopener noreferrer'; link.title = 'Open full photo';
        const image = document.createElement('img'); image.src = data.signedUrl; image.alt = 'Photo attached to this maintenance report'; image.style.cssText = 'display:block;max-width:100%;max-height:320px;object-fit:contain;border-radius:12px;margin:8px 0';
        image.onerror = () => { image.alt = 'Photo could not load. Reopen this report to refresh it.'; };
        link.append(image); container.append(link);
      }
    } catch (error) {
      if (container._photoRequest !== request) return;
      container.textContent = 'Unable to load photo: ' + error.message;
      const retry = document.createElement('button'); retry.type = 'button'; retry.textContent = 'Retry'; retry.className = 'ml-2 underline'; retry.onclick = () => this.render(container, reportId, allowUpload); container.append(retry);
    }
  },
  async openIncident(incidentId) {
    const container = document.getElementById('incidentPhotosContent');
    const request = Symbol(); container._incidentRequest = request;
    container.textContent = 'Loading photos…'; App.openModal('incidentPhotosModal');
    try {
      const {data,error} = await API.client.from('campusops_reports').select('id,description,equipment_description').eq('incident_id', incidentId).order('created_at');
      if (error) throw new Error(API.formatError(error));
      if (container._incidentRequest !== request) return;
      container.replaceChildren();
      if (!data.length) container.textContent = 'No accessible reports for this incident.';
      for (const report of data) {
        const section = document.createElement('section'); section.className = 'py-3 border-b border-slate-200';
        const heading = document.createElement('p'); heading.className = 'text-sm mb-2'; heading.textContent = report.description + (report.equipment_description ? " — Equipment: " + report.equipment_description : "");
        const photos = document.createElement('div'); section.append(heading, photos); container.append(section);
        await this.render(photos, report.id);
      }
    } catch (error) { if (container._incidentRequest === request) container.textContent = 'Unable to load photos: ' + error.message; }
  }
};
window.ReportPhotos = ReportPhotos;
