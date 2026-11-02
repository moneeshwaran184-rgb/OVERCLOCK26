const StudentHelp = {
  messages: [], owner: null, busy: false, generation: 0,
  grouping: false, groupRetryAt: 0, groupPasses: 0, adminRefresh: null, limitedMode: false,

  reset() {
    this.messages = [];
    this.owner = null;
    this.busy = false;
    this.generation++;
    this.grouping = false;
    this.groupRetryAt = 0;
    this.groupPasses = 0;
    this.adminRefresh = null;
    document.getElementById('section-studenthelp')?.replaceChildren();
    document.getElementById('section-grievances')?.replaceChildren();
  },

  node(tag, text, cls = '') {
    const n = document.createElement(tag);
    n.textContent = text;
    n.className = cls;
    return n;
  },

  statusLabel(value) {
    return String(value || 'new').replaceAll('_', ' ');
  },

  async load() {
    const el = document.getElementById('section-studenthelp');
    el.replaceChildren();
    try {
      const m = await API.getActiveMembership();
      if (m?.role !== 'student') throw Error('Student access required');
      const { data: { user } } = await API.client.auth.getUser();
      if (!user) throw Error('Sign in required');
      const owner = user.id + ':' + m.college_id;
      if (this.owner !== owner) { this.reset(); this.owner = owner; }

      el.append(
        this.node('h1', 'AI Help & Grievances', 'text-3xl font-bold'),
        this.node('p', 'Ask a question about CampusOps, or report a website problem through AI Help. Only website and software problems are sent to Grievance Redressal. Do not share passwords or OTPs.', 'ops-help')
      );

      const log = this.node('div', '', 'space-y-3');
      log.setAttribute('role', 'log');
      log.setAttribute('aria-live', 'polite');
      el.append(log);
      const draw = () => {
        log.replaceChildren();
        for (const msg of this.messages) {
          log.append(this.node('p', (msg.role === 'user' ? 'You: ' : 'CampusOps AI: ') + msg.text, 'border rounded-xl p-4 whitespace-pre-wrap'));
        }
      };
      draw();

      const form = document.createElement('form');
      form.className = 'space-y-3';
      const label = this.node('label', 'Your question');
      const input = document.createElement('textarea');
      input.maxLength = 2000; input.required = true; input.rows = 3;
      input.className = 'w-full p-3 rounded border bg-transparent';
      label.append(input);
      const send = this.node('button', 'Ask AI', 'ops-quiet-button');
      send.type = 'submit';
      const clear = this.node('button', 'New chat', 'ops-quiet-button');
      clear.type = 'button';
      const feedback = this.node('p', '');
      feedback.setAttribute('role', 'status');
      form.append(label, send, clear, feedback);
      el.append(form);

      const report = this.node('details', '');
      const summary = this.node('summary', 'Report a website problem', 'cursor-pointer font-semibold');
      report.append(summary);
      el.append(report);

      const grievance = document.createElement('form');
      grievance.className = 'space-y-3 mt-3';
      report.append(grievance);
      const dl = this.node('label', 'What happened? Include the page, what you tried, and any error message.');
      const description = document.createElement('textarea');
      description.minLength = 10; description.maxLength = 6000; description.required = true; description.rows = 5;
      description.className = input.className;
      dl.append(description);
      const pl = this.node('label', 'Affected page (optional)');
      const page = document.createElement('input');
      page.maxLength = 200;
      page.className = input.className;
      page.placeholder = 'For example: Submit Report';
      pl.append(page);
      const notice = this.node('p', 'Only website problems are accepted here. For a broken fan, water leak, or other physical maintenance issue, use Submit Report instead.', 'ops-help');
      const confirm = this.node('button', 'Confirm & submit website problem', 'ops-quiet-button');
      confirm.type = 'submit';
      const saved = this.node('p', '');
      saved.setAttribute('role', 'status');
      grievance.append(dl, pl, notice, confirm, saved);

      const tickets = this.node('div', '', 'space-y-4');
      let requestId = crypto.randomUUID();

      grievance.onsubmit = async e => {
        e.preventDefault();
        confirm.disabled = true; description.readOnly = true; page.readOnly = true;
        saved.textContent = 'Submitting…';
        try {
          const { data, error } = await API.client.rpc('campusops_submit_grievance', {
            p_id: requestId,
            p_college: m.college_id,
            p_description: description.value.trim(),
            p_page: page.value.trim()
          });
          if (error) throw error;

          saved.textContent = 'Submitted to Grievance Redressal. Reference: ' + data;
          requestId = crypto.randomUUID();
          description.value = '';
          page.value = '';
          report.open = false;

          // AI triage runs after the submission so the form still works when AI is down.
          this.triage(data).then(result => {
            if (result?.website_problem === false) {
              saved.textContent = 'Submitted. AI marked this as not a website problem, so the report admin may hide it. Use Submit Report for physical maintenance.';
            } else if (result?.summary) {
              saved.textContent = 'Submitted to Grievance Redressal. AI checked it as: ' + result.summary;
            }
          }).catch(() => {});

          await this.renderTickets(tickets, m, false);
        } catch (e) {
          saved.textContent = 'Not confirmed: ' + e.message + ' Retry with the same details if your connection was interrupted.';
        } finally {
          confirm.disabled = false; description.readOnly = false; page.readOnly = false;
        }
      };

      clear.onclick = () => {
        if (this.busy) return;
        this.messages = [];
        draw();
        feedback.textContent = '';
      };

      form.onsubmit = async e => {
        e.preventDefault();
        if (this.busy || !input.value.trim()) return;
        this.busy = true; send.disabled = true; clear.disabled = true; input.disabled = true;
        const generation = this.generation, text = input.value.trim();
        feedback.textContent = 'AI is thinking…';
        this.messages.push({ role: 'user', text });
        draw();
        try {
          let messages = this.messages.slice(-11);
          if (messages[0]?.role === 'assistant') messages = messages.slice(1);
          const { data, error } = await API.client.functions.invoke('campusops-chat', {
            body: { college_id: m.college_id, messages }
          });
          if (generation !== this.generation) return;
          if (error || data?.error) {
            let detail = data?.error;
            try { detail = (await error.context.json()).error || detail; } catch {}
            throw Error(detail || 'AI help could not connect. Deploy campusops-chat, or submit a grievance below.');
          }
          this.messages.push({ role: 'assistant', text: data.answer });
          this.messages = this.messages.slice(-12);
          draw();
          input.value = '';
          feedback.textContent = '';
          if (data.intent === 'website_problem') {
            report.open = true;
            if (!description.value) {
              description.value = this.messages.filter(x => x.role === 'user').map(x => x.text).join('\n').slice(0, 6000);
            }
            feedback.textContent = 'Review the website problem details below and confirm to send them to the report admin.';
          }
          if (data.intent === 'maintenance') {
            feedback.textContent = 'For physical maintenance problems, use the Submit Report tab. Grievance Redressal only accepts website problems.';
          }
        } catch (e) {
          if (generation === this.generation) {
            this.messages.pop();
            draw();
            feedback.textContent = e.message;
            report.open = true;
          }
        } finally {
          if (generation === this.generation) {
            this.busy = false; send.disabled = false; clear.disabled = false; input.disabled = false;
          }
        }
      };

      el.append(this.node('h2', 'My grievances', 'text-xl font-bold'));
      const refresh = this.node('button', 'Refresh grievances', 'ops-quiet-button');
      refresh.type = 'button';
      el.append(refresh, tickets);
      refresh.onclick = () => this.renderTickets(tickets, m, false);
      await this.renderTickets(tickets, m, false);
    } catch (e) {
      el.append(this.node('p', e.message));
    }
  },

  async admin() {
    const el = document.getElementById('section-grievances');
    el.replaceChildren();
    try {
      const m = await API.getActiveMembership();
      if (m?.role !== 'report_admin') throw Error('Report administrator required');

      el.append(
        this.node('h1', 'Grievance Redressal', 'text-3xl font-bold'),
        this.node('p', 'Only website and software problems submitted through AI Help are shown here. Similar reports from different students are combined by AI into one card.', 'ops-help')
      );

      const actions = document.createElement('div');
      actions.className = 'flex flex-wrap gap-3 items-center';
      const refresh = this.node('button', 'Refresh', 'ops-quiet-button');
      refresh.type = 'button';
      const group = this.node('button', 'Check duplicates with AI', 'ops-quiet-button');
      group.type = 'button';
      actions.append(refresh, group);
      el.append(actions);

      const status = this.node('p', 'Website grievance AI review pending.', 'text-sm');
      status.setAttribute('role', 'status');
      status.id = 'grievanceGroupingStatus';
      el.append(status);

      const list = this.node('div', '', 'space-y-4');
      el.append(list);
      this.adminRefresh = () => this.renderTickets(list, m, true, 0);

      refresh.onclick = async () => {
        await this.renderTickets(list, m, true, 0);
        if (!this.limitedMode) void this.groupNewGrievances();
      };
      group.onclick = () => void this.groupNewGrievances(true);

      await this.renderTickets(list, m, true, 0);
      if (this.limitedMode) {
        group.disabled = true;
        group.className = 'ops-quiet-button opacity-50 cursor-not-allowed';
        group.title = 'Run supabase/20261103_fix_step1.sql and 20261103_fix_step2.sql to enable AI grouping.';
        status.textContent = 'AI grouping is off until the 20261103 SQL fix (step 1 + step 2) is applied.';
      } else {
        void this.groupNewGrievances();
      }
    } catch (e) {
      el.append(this.node('p', e.message));
    }
  },

  async triage(id) {
    try {
      const { data, error } = await API.client.functions.invoke('campusops-grievance-ai', {
        body: { grievance_id: id }
      });
      if (error || data?.error) return null;
      return data;
    } catch {
      return null;
    }
  },

  async groupNewGrievances(force = false) {
    if (this.grouping || !document.getElementById('grievanceGroupingStatus')) return;
    const m = await API.getActiveMembership();
    if (m?.role !== 'report_admin') return;
    if (!force && Date.now() < this.groupRetryAt) return;
    if (!force) this.groupPasses = 0;

    this.grouping = true;
    const status = document.getElementById('grievanceGroupingStatus');
    status.textContent = 'AI is checking website grievances for duplicates…';
    try {
      const { data, error } = await API.client.functions.invoke('campusops-group-grievances', {
        body: { college_id: m.college_id }
      });
      if (error || data?.error) {
        const detail = data?.error || error?.message || '';
        const missing = /PGRST202|schema cache|Could not find the function|does not exist/i.test(detail);
        throw new Error(missing
          ? 'Grievance database setup is incomplete. Run supabase/20261103_student_help_ai_grouping_FIX.sql in the Supabase SQL Editor, then retry.'
          : detail || 'Deploy campusops-group-grievances, then retry.');
      }
      if (API._currentMember?.college_id !== m.college_id || API._currentMember?.role !== 'report_admin') return;

      const merged = Number(data.merged || 0);
      if (merged && this.adminRefresh) await this.adminRefresh();

      const reviewed = Number(data.reviewed || 0);
      const candidates = Number(data.candidates || 0);
      let message;
      if (merged) {
        message = `AI combined ${merged} duplicate website grievance(s) this pass.`;
      } else if (candidates < 2) {
        message = 'At least two open website grievances are needed for AI comparison.';
      } else if (!data.pairs) {
        message = `${candidates} website grievance(s) checked, but no compatible pair was found.`;
      } else {
        message = `AI reviewed ${reviewed} pair(s) and did not confirm a duplicate this pass.`;
      }

      const near = Number(data.near_miss || 0);
      const refused = Number(data.refused || 0);
      if (near) message += ` ${near} pair(s) looked similar but scored below the 90% confidence required.`;
      if (refused) message += ` ${refused} merge(s) were blocked by the database safety rules.`;

      if (data.remaining && this.groupPasses < 3) {
        this.groupPasses++;
        message += ' Continuing automatically…';
        status.textContent = message;
        setTimeout(() => void this.groupNewGrievances(true), 1200);
      } else {
        this.groupPasses = 0;
        status.textContent = message;
      }
      this.groupRetryAt = Date.now() + 10000;
    } catch (e) {
      status.textContent = 'AI grouping unavailable: ' + e.message;
      this.groupRetryAt = Date.now() + 60000;
    } finally {
      this.grouping = false;
    }
  },

  async renderTickets(el, m, admin, offset = 0) {
    el.textContent = 'Loading grievances…';
    try {
      if (admin) {
        const { data, error } = await API.client.rpc('campusops_admin_grievance_groups', {
          p_college: m.college_id,
          p_offset: offset,
          p_limit: 20
        });
        if (error) {
          // The grouping RPC is part of the 20261103 SQL. Until that is applied,
          // fall back to a plain table read so grievances are still visible.
          if (!/PGRST202|schema cache|Could not find the function/i.test(error.message || '')) throw error;
          await this.renderTicketsBasic(el, m, offset);
          return;
        }
        const rows = Array.isArray(data) ? data : [];
        this.limitedMode = false;
        el.replaceChildren();
        if (!rows.length) el.append(this.node('p', 'No website grievances on this page.'));

        for (const row of rows) el.append(this.adminCard(row));

        if (offset) {
          const prev = this.node('button', 'Previous', 'ops-quiet-button');
          prev.onclick = () => this.renderTickets(el, m, admin, Math.max(0, offset - 20));
          el.append(prev);
        }
        if (rows.length === 20) {
          const next = this.node('button', 'Next', 'ops-quiet-button');
          next.onclick = () => this.renderTickets(el, m, admin, offset + 20);
          el.append(next);
        }
        return;
      }

      const { data, error } = await API.client
        .from('campusops_grievances')
        .select('*')
        .eq('college_id', m.college_id)
        .order('created_at', { ascending: false })
        .order('id')
        .range(offset, offset + 19);
      if (error) throw error;
      el.replaceChildren();
      if (!data.length) el.append(this.node('p', 'No grievances on this page.'));

      for (const row of data) el.append(this.studentCard(row));

      if (offset) {
        const prev = this.node('button', 'Previous', 'ops-quiet-button');
        prev.onclick = () => this.renderTickets(el, m, admin, Math.max(0, offset - 20));
        el.append(prev);
      }
      if (data.length === 20) {
        const next = this.node('button', 'Next', 'ops-quiet-button');
        next.onclick = () => this.renderTickets(el, m, admin, offset + 20);
        el.append(next);
      }
    } catch (e) {
      const missing = /PGRST202|schema cache|does not exist|Could not find the function/i.test(e.message || '');
      el.textContent = missing && admin
        ? 'Grievance database setup is incomplete. Run supabase/20261103_student_help_ai_grouping_FIX.sql in the Supabase SQL Editor, then reload. (' + e.message + ')'
        : 'Could not load grievances: ' + e.message;
    }
  },

  async renderTicketsBasic(el, m, offset = 0) {
    this.limitedMode = true;
    const { data, error } = await API.client
      .from('campusops_grievances')
      .select('*')
      .eq('college_id', m.college_id)
      .order('created_at', { ascending: false })
      .order('id')
      .range(offset, offset + 19);
    if (error) throw error;

    const rows = (data || []).filter(r => r.kind === undefined || r.kind === 'website');
    const byId = new Map(rows.map(r => [r.id, r]));
    const children = new Map();
    for (const r of rows) {
      if (r.duplicate_of && byId.has(r.duplicate_of)) {
        if (!children.has(r.duplicate_of)) children.set(r.duplicate_of, []);
        children.get(r.duplicate_of).push(r);
      }
    }

    const groups = rows
      .filter(r => !r.duplicate_of || !byId.has(r.duplicate_of))
      .map(r => {
        const linked = (children.get(r.id) || []).map(c => ({
          id: c.id, description: c.description, page: c.page,
          status: c.status, created_at: c.created_at, student_name: ''
        }));
        return { ...r, affected_count: 1 + linked.length, linked_reports: linked };
      })
      .sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

    el.replaceChildren();
    el.append(this.node('p',
      'Limited mode: the AI grouping database functions are not installed yet, so reports are listed one by one. Run supabase/20261103_fix_step1.sql, then step2, in the Supabase SQL Editor to enable AI grouping.',
      'ops-help'));
    if (!groups.length) el.append(this.node('p', 'No website grievances on this page.'));

    for (const row of groups) el.append(this.adminCard(row));

    if (offset) {
      const prev = this.node('button', 'Previous', 'ops-quiet-button');
      prev.onclick = () => this.renderTickets(el, m, true, Math.max(0, offset - 20));
      el.append(prev);
    }
    if (rows.length === 20) {
      const next = this.node('button', 'Next', 'ops-quiet-button');
      next.onclick = () => this.renderTickets(el, m, true, offset + 20);
      el.append(next);
    }
  },

  historyDetails(row) {
    const history = document.createElement('details');
    history.append(this.node('summary', 'Status history'));
    const events = this.node('div', '', 'space-y-2');
    history.append(events);
    history.ontoggle = async () => {
      if (!history.open) return;
      events.textContent = 'Loading…';
      const { data, error } = await API.client
        .from('campusops_grievance_history')
        .select('status,response,created_at')
        .eq('grievance_id', row.id)
        .order('created_at');
      events.replaceChildren();
      if (error) { events.textContent = error.message; return; }
      for (const event of data) {
        events.append(this.node('p', new Date(event.created_at).toLocaleString() + ' · ' + this.statusLabel(event.status) + ' · ' + event.response, 'whitespace-pre-wrap'));
      }
    };
    return history;
  },

  studentCard(row) {
    const card = this.node('article', '', 'border rounded-xl p-4 space-y-3');
    card.append(this.node('h3', this.statusLabel(row.status) + ' · ' + new Date(row.created_at).toLocaleString(), 'font-bold'));

    if (row.duplicate_of) {
      card.append(this.node('p', 'Combined with other student reports about the same website problem. Admin replies and status changes apply to this report too.', 'text-xs font-semibold text-indigo-700 dark:text-indigo-300'));
    }
    card.append(this.node('p', 'Reference: ' + row.id, 'ops-help'));
    card.append(this.node('p', row.description, 'whitespace-pre-wrap'));
    if (row.page) card.append(this.node('p', 'Affected page: ' + row.page));
    if (row.ai_summary) card.append(this.node('p', 'AI summary: ' + row.ai_summary, 'ops-help'));
    if (row.admin_response) card.append(this.node('p', 'Admin response: ' + row.admin_response, 'whitespace-pre-wrap'));
    card.append(this.historyDetails(row));
    return card;
  },

  adminCard(row) {
    const card = this.node('article', '', 'border rounded-xl p-4 space-y-3');
    const linked = Array.isArray(row.linked_reports) ? row.linked_reports : [];
    const affected = Math.max(Number(row.affected_count || 1), 1);

    const header = document.createElement('div');
    header.className = 'flex flex-wrap gap-2 justify-between items-start';
    header.append(this.node('h3', this.statusLabel(row.status) + ' · ' + new Date(row.created_at).toLocaleString(), 'font-bold'));
    if (affected > 1) {
      header.append(this.node('span', affected + ' students affected', 'px-2.5 py-1 rounded-full border text-xs font-semibold bg-indigo-50 text-indigo-800 border-indigo-200'));
    }
    card.append(header);

    card.append(this.node('p', row.description, 'whitespace-pre-wrap'));
    if (row.page) card.append(this.node('p', 'Affected page: ' + row.page));
    if (row.ai_summary) card.append(this.node('p', 'AI summary: ' + row.ai_summary, 'ops-help'));
    if (row.ai_category) card.append(this.node('p', 'AI category: ' + this.statusLabel(row.ai_category), 'ops-help'));
    if (!row.ai_checked_at) card.append(this.node('p', 'AI triage pending. It will update automatically after the next check.', 'ops-help'));
    card.append(this.node('p', 'Student ID: ' + row.student_id, 'ops-help'));

    if (linked.length) {
      const details = document.createElement('details');
      details.append(this.node('summary', 'Combined student reports (' + linked.length + ')'));
      const box = this.node('div', '', 'space-y-2 mt-2');
      for (const child of linked) {
        const meta = [child.student_name || 'Student', new Date(child.created_at).toLocaleString()];
        if (child.page) meta.push('Page: ' + child.page);
        const item = this.node('div', '', 'p-3 rounded-xl bg-slate-50 dark:bg-slate-900');
        item.append(this.node('p', meta.join(' · '), 'text-xs font-semibold'));
        item.append(this.node('p', child.description, 'text-sm whitespace-pre-wrap mt-1'));
        box.append(item);
      }
      details.append(box);
      card.append(details);
    }

    card.append(this.historyDetails(row));

    const form = document.createElement('form');
    form.className = 'space-y-3';
    const sl = this.node('label', 'Status');
    const status = document.createElement('select');
    status.className = 'p-2 border rounded bg-slate-800 text-white';
    for (const s of ['new', 'in_progress', 'resolved']) {
      const o = this.node('option', this.statusLabel(s));
      o.value = s;
      status.append(o);
    }
    status.value = row.status;
    sl.append(status);

    const rl = this.node('label', 'Reply to student');
    const response = document.createElement('textarea');
    response.maxLength = 4000;
    response.value = row.admin_response || '';
    response.className = 'w-full p-3 rounded border bg-transparent';
    rl.append(response);

    const save = this.node('button', 'Save response & status', 'ops-quiet-button');
    save.type = 'submit';
    const message = this.node('p', '');
    message.setAttribute('role', 'status');
    form.append(sl, rl, save, message);
    card.append(form);

    form.onsubmit = async e => {
      e.preventDefault();
      save.disabled = true;
      try {
        const { error } = await API.client.rpc('campusops_review_grievance', {
          p_id: row.id,
          p_status: status.value,
          p_response: response.value
        });
        if (error) throw error;
        if (this.adminRefresh) await this.adminRefresh();
      } catch (err) {
        message.textContent = err.message;
      } finally {
        save.disabled = false;
      }
    };

    return card;
  }
};
window.StudentHelp = StudentHelp;
