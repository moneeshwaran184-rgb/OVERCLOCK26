/**
 * CampusOps Demo Account Switcher
 * ─────────────────────────────────────────────────────────────────
 * A Google/Microsoft-inspired multi-account switcher for hackathon
 * demonstration. Frontend-only — no backend changes, no Edge Functions.
 *
 * How it works:
 *  - Saves account profiles (email, name, role, college) in localStorage.
 *  - Passwords are NEVER stored — required for every switch.
 *  - Uses existing API.signIn() (Supabase email/password auth).
 *  - Patches API.signIn to auto-capture profile after any login.
 *  - Reads current auth state via supabaseClient.auth.onAuthStateChange.
 *
 * Files modified:
 *  - static/css/demo-switcher.css  (new)
 *  - static/js/demo-switcher.js    (new — this file)
 *  - static/index.html             (header avatar + modals + script tag)
 */

const DemoSwitcher = (() => {
  'use strict';

  // ═══════════════════════════════════════════════════════════════════
  // CONSTANTS
  // ═══════════════════════════════════════════════════════════════════

  const STORAGE_KEY = 'campusops_demo_accts_v2';
  const MAX_ACCOUNTS = 50;

  /** Role display metadata: label + avatar gradient */
  const ROLE_META = {
    student:              { label: 'Student',          grad: 'linear-gradient(135deg,#6366f1,#4f46e5)' },
    faculty:              { label: 'Faculty',           grad: 'linear-gradient(135deg,#10b981,#059669)' },
    technician:           { label: 'Technician',        grad: 'linear-gradient(135deg,#f59e0b,#d97706)' },
    department_manager:   { label: 'Dept Manager',      grad: 'linear-gradient(135deg,#8b5cf6,#7c3aed)' },
    facilities_admin:     { label: 'Facilities Admin',  grad: 'linear-gradient(135deg,#f43f5e,#e11d48)' },
    report_admin:         { label: 'Report Admin',      grad: 'linear-gradient(135deg,#06b6d4,#0891b2)' },
    procurement_approver: { label: 'Procurement',       grad: 'linear-gradient(135deg,#3b82f6,#2563eb)' },
    system_admin:         { label: 'System Admin',      grad: 'linear-gradient(135deg,#475569,#334155)' },
  };

  /** Email-hash-based fallback gradients for accounts with no known role */
  const PALETTES = [
    ['#6366f1','#4f46e5'], ['#8b5cf6','#7c3aed'], ['#ec4899','#db2777'],
    ['#f43f5e','#e11d48'], ['#f97316','#ea580c'], ['#eab308','#ca8a04'],
    ['#22c55e','#16a34a'], ['#14b8a6','#0d9488'], ['#06b6d4','#0891b2'],
    ['#3b82f6','#2563eb'],
  ];

  // ═══════════════════════════════════════════════════════════════════
  // STATE
  // ═══════════════════════════════════════════════════════════════════

  let _accounts    = [];   // [{email, full_name, role, col_code, col_name, dept, uid, used}]
  let _curEmail    = null; // currently signed-in account email
  let _ddOpen      = false;
  let _switchTarget= null; // account being switched to
  let _sq          = '';   // search query
  let _fr          = '';   // role filter
  let _fc          = '';   // college filter

  // ═══════════════════════════════════════════════════════════════════
  // STORAGE
  // ═══════════════════════════════════════════════════════════════════

  const DEFAULT_DEMO_ACCOUNTS = [
    { email: 'student@campus.edu',            full_name: 'Alex Chen',            role: 'student',            col_code: 'COPS01', col_name: 'CampusOps College', dept: 'Computer Science' },
    { email: 'faculty@campus.edu',            full_name: 'Dr. Sarah Verma',      role: 'faculty',            col_code: 'COPS01', col_name: 'CampusOps College', dept: 'Civil Engineering' },
    { email: 'reportsadmin@campusops.example', full_name: 'Report Administrator', role: 'report_admin',       col_code: 'COPS01', col_name: 'CampusOps College', dept: 'Campus Operations' },
    { email: 'admin@campus.edu',              full_name: 'R. Sharma',            role: 'facilities_admin',   col_code: 'COPS01', col_name: 'CampusOps College', dept: 'Facilities & Infrastructure' },
    { email: 'mechanic@campusops.example',    full_name: 'Mani - Mechanic',      role: 'technician',         col_code: 'COPS01', col_name: 'CampusOps College', dept: 'Mechanical Equipment' },
    { email: 'carpenter@campusops.example',   full_name: 'Kavya - Carpenter',    role: 'technician',         col_code: 'COPS01', col_name: 'CampusOps College', dept: 'Furniture & Carpentry' },
    { email: 'facilities.lead@campus.edu',    full_name: 'A. Patel',             role: 'department_manager', col_code: 'COPS01', col_name: 'CampusOps College', dept: 'Physical Plant' },
    { email: 'facultymaths@campusops.example',full_name: 'Dr. Neha Sharma',      role: 'faculty',            col_code: 'COPS01', col_name: 'CampusOps College', dept: 'Mathematics' },
  ];

  function _load() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw !== null) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed) && parsed.length > 0) return parsed;
      }
      localStorage.setItem(STORAGE_KEY, JSON.stringify(DEFAULT_DEMO_ACCOUNTS));
      return [...DEFAULT_DEMO_ACCOUNTS];
    } catch {
      return [...DEFAULT_DEMO_ACCOUNTS];
    }
  }

  function _save() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(_accounts)); } catch {}
  }

  /**
   * Upsert a profile into the saved accounts list.
   * @param {object} p - Profile with at least `email`.
   */
  function upsert(p) {
    if (!p?.email) return;
    const idx = _accounts.findIndex(a => a.email === p.email);
    const entry = {
      email:    p.email,
      full_name: p.full_name || _fmtEmail(p.email),
      role:     p.role || 'member',
      col_code: p.col_code || window.CAMPUSOPS_CONFIG?.collegeCode || 'COPS01',
      col_name: p.col_name || 'CampusOps College',
      dept:     p.dept || '',
      uid:      p.uid  || '',
      used:     new Date().toISOString(),
    };
    if (idx >= 0) {
      _accounts[idx] = { ..._accounts[idx], ...entry };
    } else {
      _accounts.unshift(entry);
      if (_accounts.length > MAX_ACCOUNTS) _accounts = _accounts.slice(0, MAX_ACCOUNTS);
    }
    _save();
  }

  function _remove(email) {
    const acct = _accounts.find(a => a.email === email);
    if (email === _curEmail) {
      _toast('You are signed in to this account. Sign out before deleting it.', 'error');
      return;
    }
    if (!window.confirm(`Delete ${acct?.full_name || email} from this device?\n\nThe login itself is not deleted and can be added again later.`)) return;
    _accounts = _accounts.filter(a => a.email !== email);
    _save();
    renderDropdown();
    _toast(`Deleted ${acct?.full_name || email} from this device.`, 'success');
  }

  /**
   * Save the signed-in profile to the saved accounts list.
   * Re-reads the live Supabase session so a missing name/role gets repaired.
   */
  async function _saveAccount(email) {
    const existing = _accounts.find(a => a.email === email) || { email };
    if (email === _curEmail && window.API) {
      try {
        const user   = window.API._currentUser || await window.API.getCurrentUser();
        const member = await window.API.getActiveMembership(true).catch(() => null);
        if (user) {
          upsert({
            email:    user.email,
            full_name: member?.full_name || existing.full_name,
            role:      member?.role      || existing.role,
            col_code:  member?.college?.code || existing.col_code,
            col_name:  member?.college?.name || existing.col_name,
            dept:      member?.department?.name || existing.dept,
            uid:       user.id,
          });
        } else {
          upsert(existing);
        }
      } catch {
        upsert(existing);
      }
    } else {
      upsert(existing);
    }
    renderDropdown();
    renderAvatar();
    const saved = _accounts.find(a => a.email === email);
    _toast(`Saved ${saved?.full_name || email} to your accounts.`, 'success');
  }

  function _toast(msg, type = 'success') {
    if (window.App?.showToast) window.App.showToast(msg, type);
    else console.log('[DemoSwitcher]', msg);
  }

  // ═══════════════════════════════════════════════════════════════════
  // UTILITIES
  // ═══════════════════════════════════════════════════════════════════

  const _esc = s => String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');

  const _fmtEmail = e => (e || '').split('@')[0].replace(/[._-]/g,' ').replace(/\b\w/g, c => c.toUpperCase());

  function _initials(name) {
    if (!name) return '?';
    const parts = name.trim().split(/\s+/).filter(Boolean);
    if (parts.length === 1) return parts[0][0].toUpperCase();
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  }

  function _emailGrad(email) {
    let h = 0;
    for (const c of (email || '')) h = c.charCodeAt(0) + ((h << 5) - h);
    const pal = PALETTES[Math.abs(h) % PALETTES.length];
    return `linear-gradient(135deg,${pal[0]},${pal[1]})`;
  }

  const _roleGrad  = r => (ROLE_META[r] || ROLE_META.student).grad;
  const _roleLabel = r => (ROLE_META[r] || { label: r || 'Member' }).label;
  const _roleCls   = r => `ds-badge ds-r-${r || 'member'}`;

  const _el = id => document.getElementById(id);

  function _showErr(id, msg) {
    const e = _el(id);
    if (e) { e.textContent = '⚠ ' + msg; e.classList.add('show'); }
  }
  function _hideErr(id) {
    _el(id)?.classList.remove('show');
  }

  function _clearAPIState() {
    if (!window.API) return;
    window.API._currentUser   = null;
    window.API._currentMember = null;
    window.API._cache         = {};
  }

  // ═══════════════════════════════════════════════════════════════════
  // AVATAR RENDERING
  // ═══════════════════════════════════════════════════════════════════

  function renderAvatar() {
    const avEl = _el('dsAv');
    const btn  = _el('demoSwitcherBtn');
    if (!avEl) return;

    const acct = _accounts.find(a => a.email === _curEmail);
    const name = acct?.full_name || _curEmail;
    const bg   = acct
      ? _roleGrad(acct.role)
      : (_curEmail ? _emailGrad(_curEmail) : 'linear-gradient(135deg,#94a3b8,#64748b)');

    avEl.style.background = bg;
    avEl.textContent = _initials(name);
    if (btn) btn.title = acct ? `${acct.full_name} · Switch Account` : 'Switch Account';
  }

  // ═══════════════════════════════════════════════════════════════════
  // HTML BUILDERS
  // ═══════════════════════════════════════════════════════════════════

  function _avHtml(acct, cls = 'ds-av ds-av-26') {
    return `<div class="${_esc(cls)}" style="background:${_roleGrad(acct.role)}">${_esc(_initials(acct.full_name))}</div>`;
  }

  function _badgeHtml(role) {
    return `<span class="${_roleCls(role)}">${_esc(_roleLabel(role))}</span>`;
  }

  function _cardHtml(acct) {
    const isActive = acct.email === _curEmail;
    return `
<div class="ds-card${isActive ? ' active' : ''}"
     data-switch-email="${_esc(acct.email)}"
     role="option"
     tabindex="0"
     aria-selected="${isActive}"
     title="${isActive ? 'Currently active' : 'Switch to ' + _esc(acct.full_name)}">
  <div style="position:relative;flex-shrink:0">
    ${_avHtml(acct, 'ds-av ds-av-26')}
    ${isActive ? '<div class="ds-online-dot"></div>' : ''}
  </div>
  <div class="ds-card-info">
    <div class="ds-card-name">${_esc(acct.full_name)}</div>
    <div class="ds-card-email">${_esc(acct.email)}</div>
    <div class="ds-card-meta">
      ${_badgeHtml(acct.role)}
      <span class="ds-col-chip">${_esc(acct.col_code)}</span>
    </div>
  </div>
  ${isActive
    ? `<div class="ds-card-actions">
         <button class="ds-act ds-act-save" data-save-email="${_esc(acct.email)}" type="button" title="Save this profile to your saved accounts">Save account</button>
         <svg class="ds-check-ico" width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><polyline points="20 6 9 17 4 12"/></svg>
       </div>`
    : `<div class="ds-card-actions">
         <button class="ds-act ds-act-del" data-rm-email="${_esc(acct.email)}" type="button" title="Delete this account from the list">Delete account</button>
       </div>`
  }
</div>`;
  }

  // ═══════════════════════════════════════════════════════════════════
  // DROPDOWN RENDERING
  // ═══════════════════════════════════════════════════════════════════

  function _getFiltered() {
    let list = [..._accounts];
    if (_sq) {
      const q = _sq.toLowerCase();
      list = list.filter(a =>
        a.email.toLowerCase().includes(q) ||
        a.full_name.toLowerCase().includes(q) ||
        _roleLabel(a.role).toLowerCase().includes(q) ||
        (a.col_code || '').toLowerCase().includes(q)
      );
    }
    if (_fr) list = list.filter(a => a.role === _fr);
    if (_fc) list = list.filter(a => a.col_code === _fc);
    return list;
  }

  function renderDropdown() {
    const listEl  = _el('dsAcctList');
    const filtersEl = _el('dsFilters');
    if (!listEl) return;

    // Build filter chips
    const roles   = [...new Set(_accounts.map(a => a.role).filter(Boolean))];
    const colleges = [...new Set(_accounts.map(a => a.col_code).filter(Boolean))];
    let chips = '';
    for (const r of roles) {
      chips += `<button class="ds-chip${_fr === r ? ' active' : ''}" data-fil-role="${_esc(r)}" type="button">${_esc(_roleLabel(r))}</button>`;
    }
    if (colleges.length > 1) {
      for (const c of colleges) {
        chips += `<button class="ds-chip${_fc === c ? ' active' : ''}" data-fil-col="${_esc(c)}" type="button">${_esc(c)}</button>`;
      }
    }
    if (_fr || _fc) {
      chips += `<button class="ds-chip" id="dsClearFil" type="button">✕ Clear filters</button>`;
    }
    if (filtersEl) {
      filtersEl.innerHTML = chips;
      filtersEl.style.display = chips ? '' : 'none';
    }

    // Build account cards
    const list   = _getFiltered();
    const active = list.filter(a => a.email === _curEmail);
    const others = list.filter(a => a.email !== _curEmail);
    let html = '';

    if (active.length > 0) {
      html += `<div class="ds-section-lbl">Active Account</div>`;
      html += active.map(_cardHtml).join('');
    }

    if (others.length > 0) {
      html += `<div class="ds-section-lbl">Saved Accounts <span class="ds-count-badge">${others.length}</span></div>`;
      html += others.map(_cardHtml).join('');
    }

    if (list.length === 0) {
      if (_sq || _fr || _fc) {
        html = `<div class="ds-empty">
          <div class="ds-empty-ico">🔍</div>
          <div class="ds-empty-ttl">No matching accounts</div>
          <div class="ds-empty-body">Try a different search term or clear the active filters.</div>
        </div>`;
      } else {
        html = `<div class="ds-empty">
          <div class="ds-empty-ico">👤</div>
          <div class="ds-empty-ttl">No saved accounts yet</div>
          <div class="ds-empty-body">
            Sign in to any account and it will appear here automatically for quick switching.<br>
            Or click <strong>Add Account</strong> below.
          </div>
        </div>`;
      }
    }

    listEl.innerHTML = html;
  }

  // ═══════════════════════════════════════════════════════════════════
  // DROPDOWN OPEN / CLOSE
  // ═══════════════════════════════════════════════════════════════════

  function openDropdown() {
    const dd  = _el('dsDropdown');
    const btn = _el('demoSwitcherBtn');
    if (!dd || _ddOpen) return;
    _ddOpen = true; _sq = ''; _fr = ''; _fc = '';
    dd.classList.remove('hidden', 'ds-closing');
    btn?.classList.add('open');
    btn?.setAttribute('aria-expanded', 'true');
    renderDropdown();
    const srch = _el('dsSrch');
    if (srch) { srch.value = ''; setTimeout(() => srch.focus(), 60); }
  }

  function closeDropdown() {
    const dd  = _el('dsDropdown');
    const btn = _el('demoSwitcherBtn');
    if (!dd || !_ddOpen) return;
    _ddOpen = false;
    dd.classList.add('ds-closing');
    btn?.classList.remove('open');
    btn?.setAttribute('aria-expanded', 'false');
    setTimeout(() => {
      if (!_ddOpen) { dd.classList.add('hidden'); dd.classList.remove('ds-closing'); }
    }, 200);
  }

  // ═══════════════════════════════════════════════════════════════════
  // SWITCH ACCOUNT MODAL
  // ═══════════════════════════════════════════════════════════════════

  function openSwitchModal(acct) {
    _switchTarget = acct;
    const ol = _el('dsSwitchOL');
    if (!ol) return;

    // Populate header gradient
    const hdr = _el('dsMHdr');
    if (hdr) hdr.style.background = _roleGrad(acct.role);

    // Populate avatar preview
    const avEl = _el('dsMAvEl');
    if (avEl) { avEl.style.background = _roleGrad(acct.role); avEl.textContent = _initials(acct.full_name); }

    // Populate info
    const nameEl  = _el('dsMName');  if (nameEl)  nameEl.textContent  = acct.full_name;
    const emailEl = _el('dsMEmail'); if (emailEl) emailEl.textContent = acct.email;
    const badgeEl = _el('dsMBadge'); if (badgeEl) badgeEl.innerHTML   = _badgeHtml(acct.role);
    const colEl   = _el('dsMCol');   if (colEl)   colEl.textContent   = acct.col_code;

    // Reset form
    const pwi = _el('dsPwInput');
    if (pwi) { pwi.value = ''; pwi.type = 'password'; }
    _hideErr('dsSwitchErr');

    const btn = _el('dsSwitchBtn');
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = `Switch to ${_esc(acct.full_name)} →`;
      btn.style.background = _roleGrad(acct.role);
    }

    ol.classList.remove('hidden');
    setTimeout(() => pwi?.focus(), 80);
  }

  function closeSwitchModal() {
    _el('dsSwitchOL')?.classList.add('hidden');
    _switchTarget = null;
  }

  // ═══════════════════════════════════════════════════════════════════
  // ADD ACCOUNT MODAL
  // ═══════════════════════════════════════════════════════════════════

  function openAddModal() {
    const ol = _el('dsAddOL');
    if (!ol) return;

    const eEl = _el('dsAddEmail'); if (eEl) { eEl.value = ''; eEl.type = 'email'; }
    const pEl = _el('dsAddPw');    if (pEl) { pEl.value = ''; pEl.type = 'password'; }
    _hideErr('dsAddErr');

    const btn = _el('dsAddBtn');
    if (btn) { btn.disabled = false; btn.innerHTML = 'Add Account'; }

    ol.classList.remove('hidden');
    setTimeout(() => _el('dsAddEmail')?.focus(), 80);
  }

  const closeAddModal = () => _el('dsAddOL')?.classList.add('hidden');

  // ═══════════════════════════════════════════════════════════════════
  // AFTER-LOGIN: capture profile from newly signed-in session
  // ═══════════════════════════════════════════════════════════════════

  async function _afterLogin(email) {
    try {
      const member = await window.API?.getActiveMembership(true).catch(() => null);
      const user   = window.API?._currentUser || await window.API?.getCurrentUser().catch(() => null);
      if (user) {
        upsert({
          email:    user.email,
          full_name: member?.full_name || _fmtEmail(user.email),
          role:      member?.role      || 'member',
          col_code:  member?.college?.code || window.CAMPUSOPS_CONFIG?.collegeCode || 'COPS01',
          col_name:  member?.college?.name || 'CampusOps College',
          dept:      member?.department?.name || '',
          uid:       user.id,
        });
        _curEmail = user.email;
      }
    } catch (e) {
      console.warn('[DemoSwitcher] afterLogin profile capture failed:', e.message);
    }
  }

  // ═══════════════════════════════════════════════════════════════════
  // AUTH ACTIONS
  // ═══════════════════════════════════════════════════════════════════

  async function doSwitch(email, password) {
    const btn = _el('dsSwitchBtn');
    const err = _el('dsSwitchErr');
    _hideErr('dsSwitchErr');
    if (btn) { btn.disabled = true; btn.innerHTML = `<span class="ds-spin"></span>Switching…`; }

    try {
      _clearAPIState();
      await window.API.signIn(email, password);
      await _afterLogin(email);
      closeSwitchModal();
      closeDropdown();
      renderAvatar();

      if (window.App) {
        await window.App.checkAuthState();
        await window.App.switchTab('dashboard');
        window.App.showToast(`Switched to ${_switchTarget?.full_name || email}!`, 'success');
      }
    } catch (e) {
      _showErr('dsSwitchErr', e.message || 'Incorrect password. Please try again.');
      if (btn) {
        btn.disabled = false;
        btn.innerHTML = `Retry →`;
        if (_switchTarget) btn.style.background = _roleGrad(_switchTarget.role);
      }
    }
  }

  async function doAddAccount(email, password) {
    const btn = _el('dsAddBtn');
    _hideErr('dsAddErr');
    if (btn) { btn.disabled = true; btn.innerHTML = `<span class="ds-spin"></span>Signing in…`; }

    try {
      _clearAPIState();
      await window.API.signIn(email, password);
      await _afterLogin(email);
      closeAddModal();
      closeDropdown();
      renderAvatar();

      const savedName = _accounts.find(a => a.email === email)?.full_name || email;
      if (window.App) {
        await window.App.checkAuthState();
        await window.App.switchTab('dashboard');
        window.App.showToast(`Added and switched to ${savedName}!`, 'success');
      }
    } catch (e) {
      _showErr('dsAddErr', e.message || 'Authentication failed. Check your email and password.');
      if (btn) { btn.disabled = false; btn.innerHTML = 'Add Account'; }
    }
  }

  async function doSignOut() {
    closeDropdown();
    if (window.App) {
      await window.App.signOut();
    } else if (window.API) {
      await window.API.signOut();
    }
    _curEmail = null;
    renderAvatar();
  }

  // ═══════════════════════════════════════════════════════════════════
  // EVENT LISTENERS
  // ═══════════════════════════════════════════════════════════════════

  function _setupListeners() {
    // Avatar button → toggle dropdown
    _el('demoSwitcherBtn')?.addEventListener('click', e => {
      e.stopPropagation();
      _ddOpen ? closeDropdown() : openDropdown();
    });

    // Close on outside click
    document.addEventListener('click', e => {
      if (!_ddOpen) return;
      const root = _el('dsDSRoot');
      if (root && !root.contains(e.target)) closeDropdown();
    });

    // Escape closes everything
    document.addEventListener('keydown', e => {
      if (e.key !== 'Escape') return;
      if (_ddOpen) closeDropdown();
      if (!_el('dsSwitchOL')?.classList.contains('hidden')) closeSwitchModal();
      if (!_el('dsAddOL')?.classList.contains('hidden')) closeAddModal();
    });

    // Live search
    document.addEventListener('input', e => {
      if (e.target.id !== 'dsSrch') return;
      _sq = e.target.value.trim();
      renderDropdown();
    });

    // Delegated clicks for dropdown
    document.addEventListener('click', e => {
      // Filter role chip
      if (e.target.dataset.filRole !== undefined) {
        e.stopPropagation();
        _fr = _fr === e.target.dataset.filRole ? '' : e.target.dataset.filRole;
        renderDropdown();
        return;
      }
      // Filter college chip
      if (e.target.dataset.filCol !== undefined) {
        e.stopPropagation();
        _fc = _fc === e.target.dataset.filCol ? '' : e.target.dataset.filCol;
        renderDropdown();
        return;
      }
      // Clear filters
      if (e.target.id === 'dsClearFil') {
        e.stopPropagation();
        _fr = ''; _fc = '';
        renderDropdown();
        return;
      }

      // Save the active profile to the saved list
      const saveBtn = e.target.closest('[data-save-email]');
      if (saveBtn) {
        e.stopPropagation();
        const email = saveBtn.dataset.saveEmail;
        if (email) _saveAccount(email);
        return;
      }

      // Delete account from the saved list
      const rmBtn = e.target.closest('[data-rm-email]');
      if (rmBtn) {
        e.stopPropagation();
        const email = rmBtn.dataset.rmEmail;
        if (email) _remove(email);
        return;
      }

      // Account card → open switch modal
      const card = e.target.closest('[data-switch-email]');
      if (card) {
        e.stopPropagation();
        const email = card.dataset.switchEmail;
        if (!email) return;
        if (email === _curEmail) { closeDropdown(); return; }
        const acct = _accounts.find(a => a.email === email);
        if (acct) { closeDropdown(); openSwitchModal(acct); }
        return;
      }

      // Footer: Add Account
      if (e.target.closest('#dsAddAcctBtn')) {
        e.stopPropagation();
        closeDropdown();
        openAddModal();
        return;
      }
      // Footer: Sign Out
      if (e.target.closest('#dsSignOutBtn')) {
        e.stopPropagation();
        doSignOut();
        return;
      }
    });

    // Keyboard: Enter/Space on account card
    document.addEventListener('keydown', e => {
      if (e.key !== 'Enter' && e.key !== ' ') return;
      if (e.target.closest('button')) return; // Save/Delete buttons handle their own keys
      const card = e.target.closest('[data-switch-email]');
      if (!card) return;
      e.preventDefault();
      card.click();
    });

    // Modal backdrop clicks
    _el('dsSwitchOL')?.addEventListener('click', e => { if (e.target === _el('dsSwitchOL')) closeSwitchModal(); });
    _el('dsAddOL')?.addEventListener('click',    e => { if (e.target === _el('dsAddOL'))    closeAddModal(); });

    // Modal close / cancel buttons
    _el('dsSwitchX')?.addEventListener('click',      closeSwitchModal);
    _el('dsSwitchCancel')?.addEventListener('click',  closeSwitchModal);
    _el('dsAddX')?.addEventListener('click',          closeAddModal);
    _el('dsAddCancel')?.addEventListener('click',      closeAddModal);

    // Switch form submit
    _el('dsSwitchForm')?.addEventListener('submit', async e => {
      e.preventDefault();
      const pw = _el('dsPwInput')?.value;
      if (!pw || !_switchTarget) return;
      await doSwitch(_switchTarget.email, pw);
    });

    // Add account form submit
    _el('dsAddForm')?.addEventListener('submit', async e => {
      e.preventDefault();
      const email = _el('dsAddEmail')?.value.trim();
      const pw    = _el('dsAddPw')?.value;
      if (!email || !pw) return;
      await doAddAccount(email, pw);
    });

    // Password visibility toggles
    _el('dsPwEye')?.addEventListener('click', () => {
      const inp = _el('dsPwInput');
      if (inp) inp.type = inp.type === 'password' ? 'text' : 'password';
    });
    _el('dsAddEye')?.addEventListener('click', () => {
      const inp = _el('dsAddPw');
      if (inp) inp.type = inp.type === 'password' ? 'text' : 'password';
    });
  }

  // ═══════════════════════════════════════════════════════════════════
  // AUTH INTEGRATION
  // ═══════════════════════════════════════════════════════════════════

  /**
   * Read current Supabase session and update local state + avatar.
   * Called on init and on auth state changes.
   */
  async function refreshCurrentAccount() {
    if (!window.supabaseClient) return;
    try {
      const user = await window.API?.getCurrentUser().catch(() => null);
      if (user) {
        _curEmail = user.email;
        const member = await window.API?.getActiveMembership().catch(() => null);
        upsert({
          email:    user.email,
          full_name: member?.full_name || _fmtEmail(user.email),
          role:      member?.role      || 'member',
          col_code:  member?.college?.code || window.CAMPUSOPS_CONFIG?.collegeCode || 'COPS01',
          col_name:  member?.college?.name || 'CampusOps College',
          dept:      member?.department?.name || '',
          uid:       user.id,
        });
      } else {
        _curEmail = null;
      }
    } catch (e) {
      console.warn('[DemoSwitcher] refreshCurrentAccount:', e.message);
    }
    renderAvatar();
  }

  /**
   * Monkey-patch API.signIn so that profiles are auto-captured
   * even when users sign in via the existing authModal, not just
   * via the demo switcher.
   */
  function _patchAPISignIn() {
    if (!window.API || window.API._dsPatch) return;
    const _orig = window.API.signIn.bind(window.API);
    window.API.signIn = async (email, password) => {
      const result = await _orig(email, password);
      // Wait for the session to fully settle before reading membership
      setTimeout(async () => {
        try {
          const user = window.API._currentUser;
          const mem  = await window.API.getActiveMembership(true).catch(() => null);
          if (user) {
            upsert({
              email:    user.email,
              full_name: mem?.full_name || _fmtEmail(user.email),
              role:      mem?.role      || 'member',
              col_code:  mem?.college?.code || window.CAMPUSOPS_CONFIG?.collegeCode || 'COPS01',
              col_name:  mem?.college?.name || 'CampusOps College',
              dept:      mem?.department?.name || '',
              uid:       user.id,
            });
            _curEmail = user.email;
            renderAvatar();
          }
        } catch {}
      }, 700);
      return result;
    };
    window.API._dsPatch = true;
  }

  // ═══════════════════════════════════════════════════════════════════
  // PUBLIC INIT
  // ═══════════════════════════════════════════════════════════════════

  async function init() {
    _accounts = _load();
    _patchAPISignIn();
    _setupListeners();
    await refreshCurrentAccount();

    // Subscribe to future Supabase auth changes
    if (window.supabaseClient) {
      window.supabaseClient.auth.onAuthStateChange(async (event, _session) => {
        if (['SIGNED_IN', 'TOKEN_REFRESHED'].includes(event)) {
          await refreshCurrentAccount();
        } else if (event === 'SIGNED_OUT') {
          _curEmail = null;
          renderAvatar();
        }
      });
    }

    console.log('[DemoSwitcher] Initialized. Saved accounts:', _accounts.length);
  }

  // ═══════════════════════════════════════════════════════════════════
  // PUBLIC API
  // ═══════════════════════════════════════════════════════════════════
  return { init, renderAvatar, refreshCurrentAccount };

})();

window.DemoSwitcher = DemoSwitcher;

document.addEventListener('DOMContentLoaded', () => {
  // Small delay so App.init() (also DOMContentLoaded) runs first
  setTimeout(() => DemoSwitcher.init(), 150);
});
