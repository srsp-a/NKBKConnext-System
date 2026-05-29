/**
 * วาระ/รายงานประชุม — Admin Panel
 * Firestore: committee_meetings, config/meetingdocs
 * Storage: meeting-docs/{year}/{id}/
 */
(function (global) {
  'use strict';

  const COLLECTION = 'committee_meetings';
  const CONFIG_DOC = 'meetingdocs';
  const LOG_COLLECTION = 'meeting_notification_test_logs';

  const STATUS_LABELS = {
    draft: 'ร่าง',
    scheduled: 'กำหนดแล้ว',
    held: 'ประชุมแล้ว',
    report_pending: 'รอรายงาน',
    approval_step1: 'รอผู้จัดการ',
    approval_step2: 'รอเลขาคณะ',
    approval_step3: 'รอประธานคณะ',
    approved: 'อนุมัติแล้ว',
    archived: 'เก็บถาวร',
    revision: 'ส่งกลับแก้'
  };

  const DEFAULT_TYPES = [
    { id: 'committee', label: 'คณะกรรมการ', requireBoard: true, color: '#4F46E5' },
    { id: 'regular', label: 'ประชุมประจำ', requireBoard: false, color: '#0891B2' },
    { id: 'joint', label: 'ประชุมร่วมคณะ', requireBoard: true, color: '#7C3AED' },
    { id: 'other', label: 'อื่นๆ', requireBoard: false, color: '#D97706' }
  ];

  const NOTIFY_TEMPLATES = [
    { id: 'meeting_scheduled', label: 'กำหนดการประชุม / เผยแพร่วาระ' },
    { id: 'meeting_reminder', label: 'เตือนล่วงหน้า' },
    { id: 'meeting_reminder_day_before', label: 'เตือนวันก่อนประชุม (D-1)' },
    { id: 'meeting_approval_step1', label: 'ถึงคิวผู้จัดการอนุมัติ' },
    { id: 'meeting_approval_step2', label: 'ถึงคิวเลขาคณะอนุมัติ' },
    { id: 'meeting_approval_step3', label: 'ถึงคิวประธานอนุมัติ' },
    { id: 'meeting_approved', label: 'อนุมัติครบ 3 ขั้น' },
    { id: 'meeting_revision', label: 'ส่งกลับแก้รายงาน' }
  ];

  const REMINDER_OPTIONS = [
    { days: 3, label: '3 วันล่วงหน้า' },
    { days: 7, label: '7 วันล่วงหน้า' },
    { days: 15, label: '15 วันล่วงหน้า' },
    { days: 30, label: '1 เดือนล่วงหน้า' }
  ];

  const md = {
    tab: 'overview',
    viewMode: 'cards',
    meetings: [],
    settings: null,
    drawerId: null,
    drawerTab: 'main',
    calYear: null,
    calMonth: null,
    filters: { year: '', type: '', board: '', status: '', q: '' },
    initialized: false
  };

  function db() {
    return firebase.firestore();
  }

  function storage() {
    return firebase.storage();
  }

  function esc(s) {
    return String(s || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function toast(msg, type) {
    if (typeof showToast === 'function') showToast(msg, type || 'info');
    else alert(msg);
  }

  function confirmDlg(html, title) {
    if (typeof showConfirm === 'function') return showConfirm(html, title || 'ยืนยัน', 'confirm');
    return Promise.resolve(window.confirm(html.replace(/<[^>]+>/g, '')));
  }

  /** state จาก index.html (window.state) — ไม่ใช้ global.state */
  function adminState() {
    const w = typeof window !== 'undefined' ? window : global;
    return w && w.state ? w.state : null;
  }

  function adminUsers() {
    const s = adminState();
    return s && Array.isArray(s.users) ? s.users : [];
  }

  function userName(id) {
    const u = adminUsers().find((x) => x.id === id || x._firestoreDocId === id);
    return u ? u.fullname || u.nameTH || u.displayName || id : id || '—';
  }

  function isAdminRole() {
    if (typeof global.isAdminSession === 'function') return global.isAdminSession();
    const uid = firebase.auth().currentUser && firebase.auth().currentUser.uid;
    const me = adminUsers().find((x) => x.id === uid || x._firestoreDocId === uid);
    const role = me && me.role;
    return role === 'ผู้ดูแลระบบ' || role === 'แอดมิน';
  }

  /** Admin panel — ผู้ดูแล/แอดมินแก้ไขได้ทุกอย่าง */
  function canEdit() {
    if (!firebase.auth().currentUser) return false;
    if (isAdminRole()) return true;
    const users = adminUsers();
    if (!users.length) return true;
    const uid = firebase.auth().currentUser.uid;
    const editors = getSettings().editors;
    return Array.isArray(editors) && editors.includes(uid);
  }

  function currentUid() {
    return firebase.auth().currentUser && firebase.auth().currentUser.uid;
  }

  /** อนุมัติใน admin ได้เฉพาะผู้ที่ตรงขั้น (หรือผู้ดูแลระบบ) */
  function canApproveStep(meeting, step) {
    if (!meeting || !meeting.id) return false;
    if (isAdminRole()) return true;
    const uid = currentUid();
    if (!uid) return false;
    const s = getSettings();
    if (step === 1) return s.defaultManagerApproverId === uid;
    const bd = (s.boardDefaults || {})[meeting.committeeBoard] || {};
    if (step === 2) return uid === (meeting.secretaryId || bd.secretaryId);
    if (step === 3) return uid === (meeting.chairpersonId || bd.chairpersonId);
    return false;
  }

  const MEETDOC_PUBLIC_URL = 'https://meetdoc.nkbkcoop.com';

  function waitForAdminUsers(maxMs) {
    const cap = maxMs == null ? 12000 : maxMs;
    return new Promise((resolve) => {
      const start = Date.now();
      (function tick() {
        const users = adminUsers();
        if (users.length > 0 || Date.now() - start >= cap) resolve(users);
        else setTimeout(tick, 150);
      })();
    });
  }

  function defaultSettings() {
    return {
      types: DEFAULT_TYPES.slice(),
      defaultVisibility: 'all_staff',
      reminderOffsets: [7, 3],
      reminderOnDayBefore: true,
      committeeSet: '',
      boardDefaults: {},
      defaultManagerApproverId: '',
      editors: [],
      calendarColors: {}
    };
  }

  function fiscalYearFromDate(d) {
    if (!d) return new Date().getFullYear() + 543;
    const dt = d.toDate ? d.toDate() : new Date(d);
    return dt.getFullYear() + 543;
  }

  function formatThaiDate(val) {
    if (!val) return '—';
    const dt = val.toDate ? val.toDate() : new Date(val);
    if (isNaN(dt.getTime())) return '—';
    return dt.toLocaleDateString('th-TH', { day: 'numeric', month: 'short', year: 'numeric' });
  }

  function emptyApproval() {
    return {
      currentStep: 1,
      steps: {
        manager: { status: 'pending' },
        secretary: { status: 'pending' },
        chair: { status: 'pending' }
      },
      completedAt: null
    };
  }

  function normalizeMeeting(doc) {
    const d = doc.data();
    return {
      id: doc.id,
      ...d,
      agendaItems: Array.isArray(d.agendaItems) ? d.agendaItems : [],
      resolutions: Array.isArray(d.resolutions) ? d.resolutions : [],
      attendees: Array.isArray(d.attendees) ? d.attendees : [],
      files: d.files || {},
      approval: d.approval || emptyApproval(),
      reminderSent: d.reminderSent || {}
    };
  }

  async function loadSettings() {
    const snap = await db().collection('config').doc(CONFIG_DOC).get();
    md.settings = snap.exists ? { ...defaultSettings(), ...snap.data() } : defaultSettings();
    if (!Array.isArray(md.settings.types) || !md.settings.types.length) md.settings.types = DEFAULT_TYPES.slice();
    if (!md.settings.boardDefaults) md.settings.boardDefaults = {};
    if (!Array.isArray(md.settings.reminderOffsets)) md.settings.reminderOffsets = [7, 3];
    if (!md.settings.committeeSet) md.settings.committeeSet = defaultCommitteeSet();
  }

  async function saveSettings(data) {
    await db().collection('config').doc(CONFIG_DOC).set(data, { merge: true });
    md.settings = { ...md.settings, ...data };
  }

  async function loadMeetings() {
    try {
      const snap = await db().collection(COLLECTION).orderBy('meetingDate', 'desc').limit(500).get();
      md.meetings = snap.docs.map(normalizeMeeting);
    } catch (e) {
      console.warn('[MeetingDocs] orderBy meetingDate failed, fallback', e);
      const snap = await db().collection(COLLECTION).limit(500).get();
      md.meetings = snap.docs.map(normalizeMeeting);
      md.meetings.sort((a, b) => {
        const ta = a.meetingDate && a.meetingDate.toDate ? a.meetingDate.toDate().getTime() : 0;
        const tb = b.meetingDate && b.meetingDate.toDate ? b.meetingDate.toDate().getTime() : 0;
        return tb - ta;
      });
    }
  }

  function boards() {
    const s = adminState();
    return s && Array.isArray(s.committeeGroups) ? s.committeeGroups : [];
  }

  function committeeSets() {
    const s = adminState();
    if (!s) return [];
    if (Array.isArray(s.committeeSetsData) && s.committeeSetsData.length) {
      return s.committeeSetsData.map((x) => (typeof x === 'string' ? x : x.name)).filter(Boolean);
    }
    return Array.isArray(s.committeeSets) ? s.committeeSets.slice() : [];
  }

  function defaultCommitteeSet() {
    const sets = committeeSets();
    return sets.length ? sets[sets.length - 1] : '';
  }

  function activeCommitteeSet() {
    const saved = getSettings().committeeSet;
    return saved || defaultCommitteeSet();
  }

  function userDocId(u) {
    return (u && (u.id || u._firestoreDocId)) || '';
  }

  function membershipInBoardSet(u, board, committeeSet) {
    const set = committeeSet || activeCommitteeSet();
    if (!set || !board || !u) return false;
    if (u.committeeMemberships && Array.isArray(u.committeeMemberships)) {
      return u.committeeMemberships.some((m) => m.set === set && m.group === board);
    }
    return u.committeeSet === set && u.committeeGroup === board;
  }

  function positionInBoardSet(u, board, committeeSet) {
    const set = committeeSet || activeCommitteeSet();
    if (u.committeeMemberships && Array.isArray(u.committeeMemberships)) {
      const m = u.committeeMemberships.find((x) => x.set === set && x.group === board);
      if (m) return m.position || '';
    }
    if (u.committeeSet === set && u.committeeGroup === board) return u.committeePosition || '';
    return '';
  }

  function isSecretaryPosition(pos) {
    const p = String(pos || '').trim();
    return p === 'เลขานุการ' || /เลขา/.test(p);
  }

  function isChairPosition(pos) {
    const p = String(pos || '').trim();
    if (!p) return false;
    if (/รองประธาน/.test(p)) return false;
    return p === 'ประธานกรรมการ' || /^ประธาน/.test(p);
  }

  /** ดึงเลขา/ประธานจากแผนผังโครงสร้างกรรมการ (#committeestructure) */
  function resolveOfficersFromOrgChart(board, committeeSet) {
    const set = committeeSet || activeCommitteeSet();
    let secretaryId = '';
    let chairpersonId = '';
    adminUsers()
      .filter((u) => u.group === 'กรรมการ' && membershipInBoardSet(u, board, set))
      .forEach((u) => {
        const pos = positionInBoardSet(u, board, set);
        const id = userDocId(u);
        if (!id) return;
        if (isSecretaryPosition(pos) && !secretaryId) secretaryId = id;
        if (isChairPosition(pos) && !chairpersonId) chairpersonId = id;
      });
    return { secretaryId, chairpersonId, committeeSet: set };
  }

  /** DOM id ปลอดภัยสำหรับชื่อคณะภาษาไทย (btoa ใช้ไม่ได้กับ Unicode) */
  function boardDomId(boardName, prefix) {
    const i = boards().indexOf(boardName);
    const n = i >= 0 ? i : Math.abs(hashStr(String(boardName)));
    return (prefix || 'md-bd') + '-' + n;
  }

  function hashStr(s) {
    let h = 0;
    for (let i = 0; i < s.length; i++) h = (h << 5) - h + s.charCodeAt(i);
    return h | 0;
  }

  function getSettings() {
    if (!md.settings) md.settings = defaultSettings();
    return md.settings;
  }

  function nextMeetingNo(board) {
    const fy = new Date().getFullYear() + 543;
    const same = md.meetings.filter((m) => m.committeeBoard === board && m.fiscalYear === fy);
    let max = 0;
    same.forEach((m) => {
      const n = parseInt(String(m.meetingNo || '').split('/')[0], 10);
      if (!isNaN(n) && n > max) max = n;
    });
    return (max + 1) + '/' + fy;
  }

  function applyBoardDefaults(board, committeeSet) {
    const set = committeeSet || activeCommitteeSet();
    const bd = (getSettings().boardDefaults || {})[board] || {};
    if (bd.secretaryId || bd.chairpersonId) {
      return {
        secretaryId: bd.secretaryId || '',
        chairpersonId: bd.chairpersonId || '',
        committeeSet: set,
        fromOrgChart: false
      };
    }
    const auto = resolveOfficersFromOrgChart(board, set);
    return {
      secretaryId: auto.secretaryId,
      chairpersonId: auto.chairpersonId,
      committeeSet: set,
      fromOrgChart: !!(auto.secretaryId || auto.chairpersonId)
    };
  }

  function boardMembers(board, committeeSet) {
    const set = committeeSet || activeCommitteeSet();
    return adminUsers().filter((u) => u.group === 'กรรมการ' && membershipInBoardSet(u, board, set));
  }

  function stats() {
    const fy = new Date().getFullYear() + 543;
    const yearMeetings = md.meetings.filter((m) => m.fiscalYear === fy);
    return {
      yearTotal: yearMeetings.length,
      scheduled: md.meetings.filter((m) => m.status === 'scheduled').length,
      pendingApproval: md.meetings.filter((m) =>
        ['approval_step1', 'approval_step2', 'approval_step3', 'report_pending'].includes(m.status)
      ).length,
      archived: md.meetings.filter((m) => m.status === 'archived').length
    };
  }

  function filteredMeetings() {
    let list = md.meetings.slice();
    const f = md.filters;
    if (f.year) list = list.filter((m) => String(m.fiscalYear) === f.year);
    if (f.type) list = list.filter((m) => m.meetingTypeId === f.type);
    if (f.board) list = list.filter((m) => m.committeeBoard === f.board);
    if (f.status) list = list.filter((m) => m.status === f.status);
    if (f.q) {
      const q = f.q.toLowerCase();
      list = list.filter(
        (m) =>
          (m.title || '').toLowerCase().includes(q) ||
          (m.meetingNo || '').toLowerCase().includes(q) ||
          (m.resolutions || []).some((r) => (r.text || '').toLowerCase().includes(q))
      );
    }
    return list;
  }

  function renderShell() {
    const root = document.getElementById('meetingdocs-root');
    if (!root) return;
    const st = stats();
    root.innerHTML =
      '<div class="md-hero">' +
      '<div class="flex flex-wrap items-center justify-between gap-4">' +
      '<div><h2 class="text-xl font-bold flex items-center gap-2"><i class="fas fa-clipboard-list"></i> วาระ/รายงานประชุม</h2>' +
      '<p class="text-indigo-100 text-sm mt-1">จัดการวาระ รายงาน และมติ — ประชุมภายในคณะกรรมการ</p></div>' +
      '<button type="button" id="mdBtnNew" class="px-5 py-2.5 bg-white/20 hover:bg-white/30 rounded-xl text-sm font-semibold"><i class="fas fa-plus mr-1"></i>สร้างการประชุม</button>' +
      '</div>' +
      '<div class="md-stat-grid mt-6">' +
      statBox(st.yearTotal, 'ประชุมปีนี้') +
      statBox(st.scheduled, 'กำหนดล่วงหน้า') +
      statBox(st.pendingApproval, 'รอดำเนินการ') +
      statBox(st.archived, 'เก็บถาวร') +
      '</div></div>' +
      '<div class="md-tabs" id="mdTabs"></div>' +
      '<div id="mdPanel"></div>';

    renderTabs();
    renderPanel();
    bindShell();
  }

  function statBox(n, label) {
    return '<div class="md-stat-card"><strong>' + n + '</strong><span>' + esc(label) + '</span></div>';
  }

  function renderTabs() {
    const el = document.getElementById('mdTabs');
    if (!el) return;
    const tabs = [
      ['overview', 'ภาพรวม', 'fa-chart-pie'],
      ['list', 'รายการประชุม', 'fa-list'],
      ['calendar', 'ปฏิทิน', 'fa-calendar-alt'],
      ['resolutions', 'มติที่ประชุม', 'fa-gavel'],
      ['settings', 'ตั้งค่า', 'fa-cog']
    ];
    el.innerHTML = tabs
      .map(
        ([id, label, icon]) =>
          '<button type="button" class="md-tab' +
          (md.tab === id ? ' active' : '') +
          '" data-md-tab="' +
          id +
          '"><i class="fas ' +
          icon +
          ' mr-1"></i>' +
          esc(label) +
          '</button>'
      )
      .join('');
    el.querySelectorAll('[data-md-tab]').forEach((btn) => {
      btn.addEventListener('click', () => {
        md.tab = btn.getAttribute('data-md-tab');
        renderTabs();
        renderPanel();
      });
    });
  }

  function renderPanel() {
    const el = document.getElementById('mdPanel');
    if (!el) return;
    try {
      if (md.tab === 'overview') el.innerHTML = renderOverview();
      else if (md.tab === 'list') el.innerHTML = renderList();
      else if (md.tab === 'calendar') el.innerHTML = renderCalendar();
      else if (md.tab === 'resolutions') el.innerHTML = renderResolutions();
      else if (md.tab === 'settings') el.innerHTML = renderSettings();
    } catch (err) {
      console.error('[MeetingDocs] renderPanel', err);
      el.innerHTML = '<p class="text-red-600 p-6">โหลดแท็บไม่สำเร็จ: ' + esc(err.message) + '</p>';
    }
    bindPanel();
  }

  function renderOverview() {
    const upcoming = md.meetings
      .filter((m) => m.status === 'scheduled' && m.meetingDate)
      .slice(0, 7);
    const recent = md.meetings.slice(0, 5);
    let html = '<div class="grid md:grid-cols-2 gap-6">';
    html += '<div class="md-card p-4"><h3 class="font-semibold text-gray-800 mb-3"><i class="fas fa-clock text-indigo-500 mr-1"></i>ประชุมที่ใกล้ถึง</h3>';
    if (!upcoming.length) html += '<p class="text-gray-400 text-sm">ไม่มีรายการ</p>';
    else {
      html += '<ul class="space-y-2">';
      upcoming.forEach((m) => {
        html +=
          '<li class="flex justify-between items-center p-2 rounded-lg hover:bg-indigo-50 cursor-pointer md-open" data-id="' +
          m.id +
          '"><span class="text-sm font-medium">' +
          esc(m.title) +
          '</span><span class="text-xs text-gray-500">' +
          formatThaiDate(m.meetingDate) +
          '</span></li>';
      });
      html += '</ul>';
    }
    html += '</div>';
    html += '<div class="md-card p-4"><h3 class="font-semibold text-gray-800 mb-3"><i class="fas fa-tasks text-amber-500 mr-1"></i>งานค้างอนุมัติ</h3>';
    const pending = md.meetings.filter((m) => m.status && m.status.startsWith('approval_'));
    if (!pending.length) html += '<p class="text-gray-400 text-sm">ไม่มีรายการ</p>';
    else {
      pending.forEach((m) => {
        html +=
          '<div class="p-2 mb-2 rounded-lg border border-amber-100 bg-amber-50 cursor-pointer md-open" data-id="' +
          m.id +
          '"><span class="text-sm font-medium">' +
          esc(m.title) +
          '</span><span class="text-xs text-amber-700 block">' +
          esc(STATUS_LABELS[m.status]) +
          '</span></div>';
      });
    }
    html += '</div></div>';
    html += '<div class="md-card p-4 mt-6"><h3 class="font-semibold mb-3">ล่าสุด</h3><div class="space-y-2">';
    recent.forEach((m) => {
      html += meetingRowCompact(m);
    });
    html += '</div><button type="button" class="text-indigo-600 text-sm mt-2 md-goto-list">ดูทั้งหมด →</button></div>';
    return html;
  }

  function meetingRowCompact(m) {
    return (
      '<div class="flex items-center gap-2 p-2 rounded-lg hover:bg-gray-50 cursor-pointer md-open" data-id="' +
      m.id +
      '"><span class="md-card-bar md-status-' +
      m.status +
      ' self-stretch rounded"></span><div class="flex-1 min-w-0"><p class="text-sm font-medium truncate">' +
      esc(m.title) +
      '</p><p class="text-xs text-gray-500">' +
      esc(m.meetingNo) +
      ' · ' +
      esc(STATUS_LABELS[m.status]) +
      '</p></div></div>'
    );
  }

  function renderList() {
    const list = filteredMeetings();
    const fy = new Date().getFullYear() + 543;
    let html =
      '<div class="flex flex-wrap gap-2 mb-4 items-center">' +
      '<input type="search" id="mdFilterQ" placeholder="ค้นหา..." class="border rounded-lg px-3 py-2 text-sm flex-1 min-w-[160px]" value="' +
      esc(md.filters.q) +
      '">' +
      '<select id="mdFilterYear" class="border rounded-lg px-3 py-2 text-sm"><option value="">ทุกปี</option>';
    for (let y = fy; y >= fy - 5; y--) html += '<option value="' + y + '"' + (md.filters.year === String(y) ? ' selected' : '') + '>พ.ศ. ' + y + '</option>';
    html += '</select><select id="mdFilterBoard" class="border rounded-lg px-3 py-2 text-sm"><option value="">ทุกคณะ</option>';
    boards().forEach((b) => {
      html += '<option value="' + esc(b) + '"' + (md.filters.board === b ? ' selected' : '') + '>' + esc(b) + '</option>';
    });
    html +=
      '</select><select id="mdFilterStatus" class="border rounded-lg px-3 py-2 text-sm"><option value="">ทุกสถานะ</option>';
    Object.keys(STATUS_LABELS).forEach((k) => {
      html += '<option value="' + k + '"' + (md.filters.status === k ? ' selected' : '') + '>' + esc(STATUS_LABELS[k]) + '</option>';
    });
    html +=
      '</select><button type="button" id="mdViewCards" class="px-3 py-2 rounded-lg text-sm ' +
      (md.viewMode === 'cards' ? 'bg-indigo-100 text-indigo-700' : 'bg-gray-100') +
      '"><i class="fas fa-th-large"></i></button>' +
      '<button type="button" id="mdViewTable" class="px-3 py-2 rounded-lg text-sm ' +
      (md.viewMode === 'table' ? 'bg-indigo-100 text-indigo-700' : 'bg-gray-100') +
      '"><i class="fas fa-table"></i></button></div>';

    if (!list.length) {
      html += '<div class="text-center py-16 text-gray-400"><i class="fas fa-folder-open text-4xl mb-3"></i><p>ยังไม่มีการประชุม</p></div>';
      return html;
    }

    if (md.viewMode === 'table') {
      html += '<div class="md-card overflow-x-auto"><table class="w-full text-sm"><thead><tr class="bg-gray-50 text-left">';
      ['ครั้งที่', 'ชื่อ', 'คณะ', 'วันที่', 'สถานะ', ''].forEach((h) => {
        html += '<th class="px-4 py-3 font-semibold text-gray-600">' + h + '</th>';
      });
      html += '</tr></thead><tbody>';
      list.forEach((m) => {
        html +=
          '<tr class="border-t hover:bg-indigo-50/50 cursor-pointer md-open" data-id="' +
          m.id +
          '"><td class="px-4 py-3">' +
          esc(m.meetingNo) +
          '</td><td class="px-4 py-3">' +
          esc(m.title) +
          '</td><td class="px-4 py-3">' +
          esc(m.committeeBoard || '—') +
          '</td><td class="px-4 py-3">' +
          formatThaiDate(m.meetingDate) +
          '</td><td class="px-4 py-3"><span class="md-badge bg-indigo-50 text-indigo-700">' +
          esc(STATUS_LABELS[m.status]) +
          '</span></td><td class="px-4 py-3"><i class="fas fa-chevron-right text-gray-400"></i></td></tr>';
      });
      html += '</tbody></table></div>';
    } else {
      html += '<div class="grid gap-4 md:grid-cols-2">';
      list.forEach((m) => {
        const hasAgenda = m.files && m.files.agenda && m.files.agenda.downloadUrl;
        const hasReport = m.files && m.files.report && m.files.report.downloadUrl;
        html +=
          '<div class="md-card md-meeting-card md-open" data-id="' +
          m.id +
          '"><span class="md-card-bar md-status-' +
          m.status +
          '"></span><div class="p-4 flex-1"><h4 class="font-semibold text-gray-800">' +
          esc(m.title) +
          '</h4><p class="text-xs text-gray-500 mt-1">' +
          esc(m.meetingNo) +
          ' · ' +
          esc(m.committeeBoard || '') +
          '</p><p class="text-sm text-gray-600 mt-2"><i class="fas fa-calendar mr-1"></i>' +
          formatThaiDate(m.meetingDate) +
          '</p><div class="flex gap-2 mt-3"><span class="md-badge ' +
          (hasAgenda ? 'md-badge-pdf-ok' : 'md-badge-pdf-miss') +
          '"><i class="fas fa-file-pdf"></i> วาระ</span><span class="md-badge ' +
          (hasReport ? 'md-badge-pdf-ok' : 'md-badge-pdf-miss') +
          '"><i class="fas fa-file-pdf"></i> รายงาน</span></div></div></div>';
      });
      html += '</div>';
    }
    return html;
  }

  function renderCalendar() {
    const now = new Date();
    if (md.calYear == null) md.calYear = now.getFullYear();
    if (md.calMonth == null) md.calMonth = now.getMonth();
    const first = new Date(md.calYear, md.calMonth, 1);
    const startDay = first.getDay();
    const daysInMonth = new Date(md.calYear, md.calMonth + 1, 0).getDate();
    const monthNames = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];

    let html =
      '<div class="md-card p-4"><div class="flex items-center justify-between mb-4">' +
      '<button type="button" id="mdCalPrev" class="px-3 py-2 rounded-lg bg-gray-100"><i class="fas fa-chevron-left"></i></button>' +
      '<h3 class="font-semibold">' +
      monthNames[md.calMonth] +
      ' ' +
      (md.calYear + 543) +
      '</h3>' +
      '<button type="button" id="mdCalNext" class="px-3 py-2 rounded-lg bg-gray-100"><i class="fas fa-chevron-right"></i></button></div>';
    html += '<div class="md-calendar">';
    ['อา', 'จ', 'อ', 'พ', 'พฤ', 'ศ', 'ส'].forEach((d) => {
      html += '<div class="md-cal-head">' + d + '</div>';
    });
    const today = new Date();
    for (let i = 0; i < startDay; i++) html += '<div class="md-cal-day other-month"></div>';
    for (let d = 1; d <= daysInMonth; d++) {
      const cellDate = new Date(md.calYear, md.calMonth, d);
      const isToday = cellDate.toDateString() === today.toDateString();
      const events = md.meetings.filter((m) => {
        if (!m.meetingDate) return false;
        const mdDt = m.meetingDate.toDate ? m.meetingDate.toDate() : new Date(m.meetingDate);
        return mdDt.getFullYear() === md.calYear && mdDt.getMonth() === md.calMonth && mdDt.getDate() === d;
      });
      html += '<div class="md-cal-day' + (isToday ? ' today' : '') + '"><span class="font-semibold text-xs">' + d + '</span>';
      events.forEach((m) => {
        const color = (md.settings.calendarColors && md.settings.calendarColors[m.committeeBoard]) || '#3730a3';
        html +=
          '<div class="md-cal-event md-open" style="background:' +
          color +
          '" data-id="' +
          m.id +
          '" title="' +
          esc(m.title) +
          '">' +
          esc((m.title || '').slice(0, 12)) +
          '</div>';
      });
      html += '</div>';
    }
    html += '</div></div>';
    return html;
  }

  function renderResolutions() {
    const rows = [];
    md.meetings.forEach((m) => {
      (m.resolutions || []).forEach((r, i) => {
        rows.push({ meeting: m, res: r, idx: i });
      });
    });
    let html =
      '<div class="mb-4"><input type="search" id="mdResSearch" placeholder="ค้นหามติ..." class="border rounded-lg px-4 py-2 w-full max-w-md"></div>';
    html += '<div class="md-card overflow-x-auto"><table class="w-full text-sm"><thead><tr class="bg-gray-50">';
    ['วันที่', 'คณะ', 'ครั้งที่', 'มติ', 'ผล', ''].forEach((h) => {
      html += '<th class="px-4 py-3 text-left font-semibold text-gray-600">' + h + '</th>';
    });
    html += '</tr></thead><tbody id="mdResBody">';
    rows.forEach(({ meeting, res }) => {
      html +=
        '<tr class="border-t md-res-row" data-text="' +
        esc((res.text || '').toLowerCase()) +
        '"><td class="px-4 py-3">' +
        formatThaiDate(meeting.meetingDate) +
        '</td><td class="px-4 py-3">' +
        esc(meeting.committeeBoard) +
        '</td><td class="px-4 py-3">' +
        esc(meeting.meetingNo) +
        '</td><td class="px-4 py-3 max-w-md">' +
        esc(res.text) +
        '</td><td class="px-4 py-3">' +
        esc(res.result || '—') +
        '</td><td class="px-4 py-3"><button type="button" class="text-indigo-600 md-open" data-id="' +
        meeting.id +
        '">เปิด</button></td></tr>';
    });
    html += '</tbody></table></div>';
    return html;
  }

  function renderSettings() {
    const s = getSettings();
    let html = '<div class="space-y-6">';

    const curSet = s.committeeSet || defaultCommitteeSet();
    const sets = committeeSets();
    html += '<div class="md-card p-6"><h3 class="font-semibold text-gray-800 mb-2"><i class="fas fa-users-cog text-indigo-500 mr-1"></i>เลขา / ประธาน ต่อคณะ (จากแผนผังโครงสร้างกรรมการ)</h3>';
    html +=
      '<p class="text-xs text-gray-500 mb-4">เลือก <strong>คณะกรรมการชุดที่</strong> แล้วระบบดึงตำแหน่งเลขานุการ / ประธานกรรมการจากข้อมูลกรรมการในแผนผังอัตโนมัติ — ปรับเองได้ก่อนบันทึก</p>';
    html += '<div class="flex flex-wrap gap-3 items-end mb-4">';
    html += '<div><label class="block text-gray-600 text-sm mb-1">คณะกรรมการชุดที่</label><select id="mdCommitteeSet" class="border rounded-lg px-3 py-2 text-sm min-w-[200px]">';
    if (!sets.length) html += '<option value="">— ยังไม่มีชุดในโครงสร้างกรรมการ —</option>';
    sets.forEach((name) => {
      html += '<option value="' + esc(name) + '"' + (curSet === name ? ' selected' : '') + '>' + esc(name) + '</option>';
    });
    html += '</select></div>';
    html +=
      '<button type="button" id="mdSyncFromOrg" class="px-4 py-2 bg-violet-100 text-violet-800 rounded-lg text-sm hover:bg-violet-200"><i class="fas fa-sitemap mr-1"></i>ดึงจากแผนผังโครงสร้างกรรมการ</button>';
    html += '</div>';
    html += '<div class="overflow-x-auto"><table class="w-full text-sm"><thead><tr class="bg-gray-50"><th class="px-3 py-2 text-left">คณะ</th><th class="px-3 py-2 text-left">เลขาคณะ</th><th class="px-3 py-2 text-left">ประธานคณะ</th></tr></thead><tbody>';
    boards().forEach((b) => {
      const bd = (s.boardDefaults || {})[b] || {};
      const auto = resolveOfficersFromOrgChart(b, curSet);
      const secId = bd.secretaryId || auto.secretaryId;
      const chairId = bd.chairpersonId || auto.chairpersonId;
      const fromOrg = !bd.secretaryId && !bd.chairpersonId && (auto.secretaryId || auto.chairpersonId);
      html += '<tr class="border-t"><td class="px-3 py-2 font-medium">' + esc(b);
      if (fromOrg) html += ' <span class="text-xs text-indigo-500 font-normal">(แผนผัง)</span>';
      html += '</td>';
      html += '<td class="px-3 py-2">' + userSelect(boardDomId(b, 'md-bd-sec'), secId, true) + '</td>';
      html += '<td class="px-3 py-2">' + userSelect(boardDomId(b, 'md-bd-chair'), chairId, true) + '</td></tr>';
    });
    html += '</tbody></table></div><button type="button" id="mdSaveBoardDefaults" class="mt-4 px-4 py-2 bg-indigo-600 text-white rounded-lg text-sm">บันทึกค่าคณะ + ชุดที่</button></div>';

    html += '<div class="md-card p-6"><h3 class="font-semibold mb-4"><i class="fas fa-bell text-amber-500 mr-1"></i>เตือนล่วงหน้า (LINE + อีเมล)</h3><div class="flex flex-wrap gap-4">';
    REMINDER_OPTIONS.forEach((opt) => {
      const on = (s.reminderOffsets || []).includes(opt.days);
      html +=
        '<label class="flex items-center gap-2"><input type="checkbox" class="md-rem-offset" data-days="' +
        opt.days +
        '"' +
        (on ? ' checked' : '') +
        '><span>' +
        esc(opt.label) +
        '</span></label>';
    });
    html +=
      '<label class="flex items-center gap-2"><input type="checkbox" id="mdRemDayBefore"' +
      (s.reminderOnDayBefore ? ' checked' : '') +
      '><span>เตือนวันก่อนประชุม (D-1)</span></label></div>';
    html += '<button type="button" id="mdSaveReminders" class="mt-4 px-4 py-2 bg-indigo-600 text-white rounded-lg text-sm">บันทึกการเตือน</button></div>';

    html += '<div class="md-card p-6"><h3 class="font-semibold mb-2"><i class="fas fa-envelope text-sky-500 mr-1"></i>เทมเพลตอีเมล (วาระ/รายงานประชุม)</h3>';
    html +=
      '<p class="text-xs text-gray-500 mb-4">ตัวแปร: {{meeting_title}}, {{meeting_date}}, {{meeting_time}}, {{committee_board}}, {{location}}, {{meetdoc_url}}, {{step_label}}, {{org_name}}</p>';
    html += '<div class="flex flex-wrap gap-3 items-end mb-3">';
    html += '<div><label class="block text-gray-600 text-sm mb-1">ประเภท</label><select id="mdEmailTplSelect" class="border rounded-lg px-3 py-2 text-sm min-w-[240px]">';
    NOTIFY_TEMPLATES.forEach((t) => {
      html += '<option value="' + t.id + '">' + esc(t.label) + '</option>';
    });
    html += '</select></div>';
    html += '<button type="button" id="mdEmailTplLoad" class="px-3 py-2 border rounded-lg text-sm">โหลด</button>';
    html += '<button type="button" id="mdEmailTplSave" class="px-3 py-2 bg-sky-600 text-white rounded-lg text-sm">บันทึกเทมเพลต</button>';
    html += '</div>';
    html += '<div class="mb-2"><label class="block text-gray-600 text-sm mb-1">หัวข้ออีเมล</label><input id="mdEmailTplSubject" class="w-full border rounded-lg px-3 py-2 text-sm"></div>';
    html += '<div class="mb-2"><label class="block text-gray-600 text-sm mb-1">เนื้อหา HTML</label><textarea id="mdEmailTplHtml" rows="10" class="w-full border rounded-lg px-3 py-2 text-sm font-mono"></textarea></div>';
    html += '<p class="text-xs text-gray-400" id="mdEmailTplStatus"></p></div>';

    html += '<div class="md-card p-6"><h3 class="font-semibold mb-2"><i class="fas fa-user-cog text-gray-600 mr-1"></i>เจ้าหน้าที่รับผิดชอบ / ผู้จัดการอนุมัติ</h3>';
    html += '<div class="grid md:grid-cols-2 gap-4 text-sm">';
    html += '<div><label class="block text-gray-600 mb-1">ผู้จัดการอนุมัติขั้น 1</label>' + userSelect('mdManagerApprover', s.defaultManagerApproverId, false) + '</div>';
    html += '<div><label class="block text-gray-600 mb-1">เจ้าหน้าที่รับผิดชอบ (หลายคน — Ctrl+คลิก)</label><select id="mdEditors" class="md-select" multiple size="6">';
    adminUsers().forEach((u) => {
      const sel = (s.editors || []).includes(u.id);
      html += '<option value="' + u.id + '"' + (sel ? ' selected' : '') + '>' + esc(u.fullname || u.nameTH || u.id) + '</option>';
    });
    html += '</select></div></div>';
    html += '<button type="button" id="mdSaveStaffRoles" class="mt-4 px-4 py-2 bg-indigo-600 text-white rounded-lg text-sm">บันทึกผู้รับผิดชอบ</button></div>';

    html += '<div class="md-card p-6 border-2 border-dashed border-indigo-200"><h3 class="font-semibold mb-4"><i class="fas fa-vial text-purple-500 mr-1"></i>ทดสอบการส่งแจ้งเตือน</h3>';
    html += '<div class="grid md:grid-cols-2 gap-4 text-sm">';
    html += '<div><label class="block text-gray-600 mb-1">Template</label><select id="mdTestTemplate" class="w-full border rounded-lg px-3 py-2">';
    NOTIFY_TEMPLATES.forEach((t) => {
      html += '<option value="' + t.id + '">' + esc(t.label) + '</option>';
    });
    html += '</select></div>';
    html += '<div><label class="block text-gray-600 mb-1">ผู้รับ (ในระบบ)</label><select id="mdTestUser" class="w-full border rounded-lg px-3 py-2"><option value="">— เลือก —</option>';
    adminUsers().forEach((u) => {
      html += '<option value="' + u.id + '">' + esc(u.fullname || u.nameTH || u.id) + '</option>';
    });
    html += '</select></div>';
    html += '<div><label class="block text-gray-600 mb-1">LINE User ID (ทับ)</label><input id="mdTestLineId" class="w-full border rounded-lg px-3 py-2" placeholder="U..."></div>';
    html += '<div><label class="block text-gray-600 mb-1">อีเมล (ทับ)</label><input id="mdTestEmail" type="email" class="w-full border rounded-lg px-3 py-2"></div>';
    html += '<div class="md:col-span-2"><label class="flex items-center gap-4"><input type="checkbox" id="mdTestChLine" checked> LINE <input type="checkbox" id="mdTestChEmail" checked> อีเมล</label></div>';
    html += '<div class="md:col-span-2 flex gap-2"><button type="button" id="mdTestPreview" class="px-4 py-2 border rounded-lg">ดูตัวอย่าง</button><button type="button" id="mdTestSend" class="px-4 py-2 bg-purple-600 text-white rounded-lg">ส่งทดสอบ</button></div>';
    html += '<pre id="mdTestPreviewBox" class="md:col-span-2 text-xs bg-gray-50 p-3 rounded-lg hidden whitespace-pre-wrap"></pre>';
    html += '<div id="mdTestResult" class="md:col-span-2 text-sm"></div></div></div>';

    html += '</div>';
    return html;
  }

  function userSelect(id, selectedId, committeeOnly) {
    let opts = '<option value="">— เลือก —</option>';
    let users = adminUsers();
    if (committeeOnly) users = users.filter((u) => u.group === 'กรรมการ');
    users.forEach((u) => {
      opts +=
        '<option value="' +
        u.id +
        '"' +
        (selectedId === u.id ? ' selected' : '') +
        '>' +
        esc(u.fullname || u.nameTH || u.id) +
        '</option>';
    });
    return '<select id="' + id + '" class="md-select" data-board-select="' + id + '">' + opts + '</select>';
  }

  function bindShell() {
    const newBtn = document.getElementById('mdBtnNew');
    if (newBtn) newBtn.addEventListener('click', () => openDrawer(null));
  }

  function bindPanel() {
    document.querySelectorAll('.md-open').forEach((el) => {
      el.addEventListener('click', () => {
        const id = el.getAttribute('data-id');
        if (id) openDrawer(id);
      });
    });
    const gotoList = document.querySelector('.md-goto-list');
    if (gotoList)
      gotoList.addEventListener('click', () => {
        md.tab = 'list';
        renderTabs();
        renderPanel();
      });

    const fq = document.getElementById('mdFilterQ');
    if (fq)
      fq.addEventListener('input', () => {
        md.filters.q = fq.value;
        renderPanel();
      });
    ['mdFilterYear', 'mdFilterBoard', 'mdFilterStatus'].forEach((id) => {
      const el = document.getElementById(id);
      if (el)
        el.addEventListener('change', () => {
          if (id === 'mdFilterYear') md.filters.year = el.value;
          if (id === 'mdFilterBoard') md.filters.board = el.value;
          if (id === 'mdFilterStatus') md.filters.status = el.value;
          renderPanel();
        });
    });
    const vc = document.getElementById('mdViewCards');
    const vt = document.getElementById('mdViewTable');
    if (vc)
      vc.addEventListener('click', () => {
        md.viewMode = 'cards';
        renderPanel();
      });
    if (vt)
      vt.addEventListener('click', () => {
        md.viewMode = 'table';
        renderPanel();
      });

    const prev = document.getElementById('mdCalPrev');
    const next = document.getElementById('mdCalNext');
    if (prev)
      prev.addEventListener('click', () => {
        md.calMonth--;
        if (md.calMonth < 0) {
          md.calMonth = 11;
          md.calYear--;
        }
        renderPanel();
      });
    if (next)
      next.addEventListener('click', () => {
        md.calMonth++;
        if (md.calMonth > 11) {
          md.calMonth = 0;
          md.calYear++;
        }
        renderPanel();
      });

    const resSearch = document.getElementById('mdResSearch');
    if (resSearch)
      resSearch.addEventListener('input', () => {
        const q = resSearch.value.toLowerCase();
        document.querySelectorAll('.md-res-row').forEach((row) => {
          const t = row.getAttribute('data-text') || '';
          row.style.display = !q || t.includes(q) ? '' : 'none';
        });
      });

    bindSettingsPanel();
  }

  function fillBoardDefaultsFromOrg(committeeSet) {
    const set = committeeSet || activeCommitteeSet();
    boards().forEach((b) => {
      const auto = resolveOfficersFromOrgChart(b, set);
      const sec = document.getElementById(boardDomId(b, 'md-bd-sec'));
      const chair = document.getElementById(boardDomId(b, 'md-bd-chair'));
      if (sec && auto.secretaryId) sec.value = auto.secretaryId;
      if (chair && auto.chairpersonId) chair.value = auto.chairpersonId;
    });
  }

  function bindSettingsPanel() {
    const setSel = document.getElementById('mdCommitteeSet');
    if (setSel) {
      setSel.addEventListener('change', () => {
        fillBoardDefaultsFromOrg(setSel.value);
        toast('ดึงเลขา/ประธานตามชุด ' + setSel.value + ' แล้ว — กดบันทึกเมื่อพร้อม', 'info');
      });
    }
    const syncBtn = document.getElementById('mdSyncFromOrg');
    if (syncBtn) {
      syncBtn.addEventListener('click', () => {
        const set = setSel ? setSel.value : activeCommitteeSet();
        fillBoardDefaultsFromOrg(set);
        toast('ดึงจากแผนผังโครงสร้างกรรมการแล้ว', 'success');
      });
    }

    const saveBd = document.getElementById('mdSaveBoardDefaults');
    if (saveBd)
      saveBd.addEventListener('click', async () => {
        const committeeSet = setSel ? setSel.value : activeCommitteeSet();
        const boardDefaults = {};
        boards().forEach((b) => {
          const sec = document.getElementById(boardDomId(b, 'md-bd-sec'));
          const chair = document.getElementById(boardDomId(b, 'md-bd-chair'));
          boardDefaults[b] = {
            secretaryId: sec ? sec.value : '',
            chairpersonId: chair ? chair.value : ''
          };
        });
        await saveSettings({ boardDefaults, committeeSet });
        toast('บันทึกชุดที่ ' + committeeSet + ' และค่าเลขา/ประธานแล้ว', 'success');
      });

    const saveRem = document.getElementById('mdSaveReminders');
    if (saveRem)
      saveRem.addEventListener('click', async () => {
        const offsets = [];
        document.querySelectorAll('.md-rem-offset:checked').forEach((cb) => {
          offsets.push(parseInt(cb.getAttribute('data-days'), 10));
        });
        const dayBefore = document.getElementById('mdRemDayBefore');
        await saveSettings({
          reminderOffsets: offsets,
          reminderOnDayBefore: dayBefore && dayBefore.checked
        });
        toast('บันทึกการตั้งค่าเตือนแล้ว', 'success');
      });

    const loadTpl = document.getElementById('mdEmailTplLoad');
    const saveTpl = document.getElementById('mdEmailTplSave');
    if (loadTpl) loadTpl.addEventListener('click', loadMeetingEmailTemplate);
    if (saveTpl) saveTpl.addEventListener('click', saveMeetingEmailTemplate);
    const tplSel = document.getElementById('mdEmailTplSelect');
    if (tplSel) tplSel.addEventListener('change', loadMeetingEmailTemplate);
    if (tplSel) setTimeout(loadMeetingEmailTemplate, 100);

    const saveStaff = document.getElementById('mdSaveStaffRoles');
    if (saveStaff)
      saveStaff.addEventListener('click', async () => {
        const mgr = document.getElementById('mdManagerApprover');
        const ed = document.getElementById('mdEditors');
        const editors = [];
        if (ed) Array.from(ed.selectedOptions).forEach((o) => editors.push(o.value));
        await saveSettings({
          defaultManagerApproverId: mgr ? mgr.value : '',
          editors
        });
        toast('บันทึกเจ้าหน้าที่รับผิดชอบแล้ว', 'success');
      });

    const preview = document.getElementById('mdTestPreview');
    const send = document.getElementById('mdTestSend');
    if (preview) preview.addEventListener('click', showTestPreview);
    if (send) send.addEventListener('click', sendTestNotification);
  }

  async function loadMeetingEmailTemplate() {
    const sel = document.getElementById('mdEmailTplSelect');
    const sub = document.getElementById('mdEmailTplSubject');
    const html = document.getElementById('mdEmailTplHtml');
    const st = document.getElementById('mdEmailTplStatus');
    if (!sel || !sub || !html) return;
    const id = sel.value;
    try {
      const snap = await db().collection('email_templates').doc(id).get();
      if (snap.exists) {
        const d = snap.data();
        sub.value = d.subject || '';
        html.value = d.html || '';
        if (st) st.textContent = 'โหลดจาก Firestore แล้ว';
      } else {
        sub.value = '[' + id + '] {{meeting_title}}';
        html.value = '<p>{{meeting_title}} — {{meeting_date}}</p><p><a href="{{meetdoc_url}}">เปิด Meetdoc</a></p>';
        if (st) st.textContent = 'ยังไม่มีใน Firestore — แสดงตัวอย่าง (บันทึกเพื่อ seed)';
      }
    } catch (e) {
      if (st) st.textContent = 'โหลดไม่สำเร็จ: ' + e.message;
    }
  }

  async function saveMeetingEmailTemplate() {
    const sel = document.getElementById('mdEmailTplSelect');
    const sub = document.getElementById('mdEmailTplSubject');
    const html = document.getElementById('mdEmailTplHtml');
    if (!sel || !sub || !html) return;
    await db()
      .collection('email_templates')
      .doc(sel.value)
      .set({ subject: sub.value.trim(), html: html.value, updatedAt: firebase.firestore.FieldValue.serverTimestamp() });
    toast('บันทึกเทมเพลตอีเมลแล้ว', 'success');
    const st = document.getElementById('mdEmailTplStatus');
    if (st) st.textContent = 'บันทึกแล้ว ' + new Date().toLocaleString('th-TH');
  }

  function meetingEmailVars(meeting, templateId) {
    const m = meeting || md.meetings[0] || { title: 'ตัวอย่าง', meetingDate: new Date(), committeeBoard: 'คณะทดสอบ' };
    return {
      meeting_title: m.title || 'การประชุม',
      meeting_date: formatThaiDate(m.meetingDate),
      meeting_time: [m.startTime, m.endTime].filter(Boolean).join('–') || '—',
      committee_board: m.committeeBoard || '—',
      location: m.location || '—',
      meetdoc_url: MEETDOC_PUBLIC_URL + '/#meeting/' + (m.id || 'sample'),
      step_label: NOTIFY_TEMPLATES.find((t) => t.id === templateId)?.label || '',
      org_name: (global.siteConfig && global.siteConfig.orgNameTH) || 'สหกรณ์ออมทรัพย์สาธารณสุขหนองคาย จำกัด'
    };
  }

  function notifyMessage(templateId, meeting) {
    const title = meeting ? meeting.title : 'การประชุมทดสอบ';
    const date = meeting ? formatThaiDate(meeting.meetingDate) : formatThaiDate(new Date());
    const board = meeting ? meeting.committeeBoard || '' : 'คณะทดสอบ';
    const lines = {
      meeting_scheduled: '[ทดสอบ] กำหนดการประชุม: ' + title + '\nวันที่: ' + date + '\nคณะ: ' + board,
      meeting_reminder: '[ทดสอบ] เตือนการประชุม: ' + title + '\nวันที่: ' + date,
      meeting_reminder_day_before: '[ทดสอบ] พรุ่งนี้มีการประชุม: ' + title,
      meeting_approval_step1: '[ทดสอบ] รอผู้จัดการอนุมัติรายงาน: ' + title,
      meeting_approval_step2: '[ทดสอบ] รอเลขาคณะอนุมัติรายงาน: ' + title,
      meeting_approval_step3: '[ทดสอบ] รอประธานคณะอนุมัติรายงาน: ' + title,
      meeting_approved: '[ทดสอบ] อนุมัติรายงานครบแล้ว: ' + title,
      meeting_revision: '[ทดสอบ] ส่งกลับแก้รายงาน: ' + title
    };
    return lines[templateId] || '[ทดสอบ] ' + title;
  }

  function showTestPreview() {
    const tpl = document.getElementById('mdTestTemplate').value;
    const sample = md.meetings[0] || { title: 'ตัวอย่าง', meetingDate: new Date(), committeeBoard: 'คณะทดสอบ' };
    const box = document.getElementById('mdTestPreviewBox');
    if (box) {
      box.textContent = notifyMessage(tpl, sample);
      box.classList.remove('hidden');
    }
  }

  async function sendTestNotification() {
    const tpl = document.getElementById('mdTestTemplate').value;
    const userId = document.getElementById('mdTestUser').value;
    const lineOverride = document.getElementById('mdTestLineId').value.trim();
    const emailOverride = document.getElementById('mdTestEmail').value.trim();
    const chLine = document.getElementById('mdTestChLine').checked;
    const chEmail = document.getElementById('mdTestChEmail').checked;
    const u = adminUsers().find((x) => x.id === userId);
    const lineId = lineOverride || (u && u.lineUserId) || '';
    const email = emailOverride || (u && u.email) || '';
    const msg = notifyMessage(tpl, md.meetings[0]);
    const result = { line: null, email: null };
    const resultEl = document.getElementById('mdTestResult');

    try {
      if (chLine && lineId) {
        const webhookUrl =
          (document.getElementById('lineWebhookUrl') && document.getElementById('lineWebhookUrl').value) ||
          'https://api-line.nkbkcoop.com/line/webhook';
        const apiUrl = webhookUrl.replace('/line/webhook', '') + '/api/push';
        const res = await fetch(apiUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ userId: lineId, message: '🧪 ' + msg })
        });
        const data = await res.json();
        result.line = data.success ? 'สำเร็จ' : data.error || 'ล้มเหลว';
      } else if (chLine) result.line = 'ไม่มี LINE User ID';

      if (chEmail && email && typeof callEmailApi === 'function') {
        const sample = md.meetings[0] || { title: 'ตัวอย่าง', meetingDate: new Date(), committeeBoard: 'คณะทดสอบ', id: 'sample' };
        await callEmailApi('/v1/send/test', {
          to: email,
          template: tpl,
          variables: meetingEmailVars(sample, tpl),
          subject: '[ทดสอบ] วาระ/รายงานประชุม',
          bodyText: msg
        });
        result.email = 'สำเร็จ';
      } else if (chEmail) result.email = 'ไม่มีอีเมล';

      await db()
        .collection(LOG_COLLECTION)
        .add({
          templateId: tpl,
          channels: { line: chLine, email: chEmail },
          recipientUserId: userId,
          lineUserId: lineId,
          email,
          success: { line: result.line === 'สำเร็จ', email: result.email === 'สำเร็จ' },
          errors: { line: result.line !== 'สำเร็จ' ? result.line : null, email: result.email !== 'สำเร็จ' ? result.email : null },
          sentBy: firebase.auth().currentUser && firebase.auth().currentUser.uid,
          sentAt: firebase.firestore.FieldValue.serverTimestamp()
        });

      if (resultEl) {
        resultEl.innerHTML =
          '<span class="text-green-700">LINE: ' + esc(result.line) + ' · อีเมล: ' + esc(result.email) + '</span>';
      }
      toast('ส่งทดสอบแล้ว', 'success');
    } catch (e) {
      toast('ทดสอบล้มเหลว: ' + e.message, 'error');
      if (resultEl) resultEl.innerHTML = '<span class="text-red-600">' + esc(e.message) + '</span>';
    }
  }

  function ensureDrawer() {
    let d = document.getElementById('mdDrawer');
    if (d) return d;
    d = document.createElement('div');
    d.id = 'mdDrawer';
    d.className = 'md-drawer';
    d.innerHTML =
      '<div class="md-drawer-backdrop" id="mdDrawerBackdrop"></div>' +
      '<div class="md-drawer-panel">' +
      '<div class="md-drawer-header flex justify-between items-start">' +
      '<div id="mdDrawerTitle"></div>' +
      '<button type="button" id="mdDrawerClose" class="text-gray-500 hover:text-gray-800 text-xl"><i class="fas fa-times"></i></button>' +
      '</div>' +
      '<div class="md-drawer-body" id="mdDrawerBody"></div>' +
      '<div class="md-drawer-footer" id="mdDrawerFooter"></div>' +
      '</div>';
    document.body.appendChild(d);
    document.getElementById('mdDrawerBackdrop').addEventListener('click', closeDrawer);
    document.getElementById('mdDrawerClose').addEventListener('click', closeDrawer);
    return d;
  }

  function closeDrawer() {
    md.drawerId = null;
    const d = document.getElementById('mdDrawer');
    if (d) d.classList.remove('open');
  }

  async function openDrawer(id) {
    try {
      await waitForAdminUsers(8000);
      if (!md.initialized) {
        await loadSettings();
        await loadMeetings();
        md.initialized = true;
      } else if (!md.settings) {
        await loadSettings();
      }
      ensureDrawer();
      md.drawerId = id;
      md.drawerTab = 'main';
      const m = id ? md.meetings.find((x) => x.id === id) : null;
      document.getElementById('mdDrawer').classList.add('open');
      renderDrawer(m);
    } catch (e) {
      console.error('[MeetingDocs] openDrawer', e);
      toast('เปิดฟอร์มไม่สำเร็จ: ' + e.message, 'error');
    }
  }

  function renderDrawer(m) {
    const isNew = !m;
    const settings = getSettings();
    const meeting = m || {
      status: 'draft',
      agendaItems: [],
      resolutions: [],
      attendees: [],
      files: {},
      approval: emptyApproval(),
      visibility: settings.defaultVisibility || 'all_staff',
      meetingTypeId: 'committee',
      committeeSet: settings.committeeSet || defaultCommitteeSet()
    };

    const tabIcons = {
      main: 'fa-circle-info',
      agenda: 'fa-list-ol',
      resolutions: 'fa-gavel',
      approval: 'fa-stamp',
      attendees: 'fa-user-check',
      files: 'fa-file-pdf'
    };
    const statusLabel = STATUS_LABELS[meeting.status] || meeting.status || 'ร่าง';
    let metaChips = '';
    if (meeting.committeeSet) metaChips += '<span class="md-drawer-chip"><i class="fas fa-layer-group mr-1"></i>' + esc(meeting.committeeSet) + '</span>';
    if (meeting.committeeBoard) metaChips += '<span class="md-drawer-chip">' + esc(meeting.committeeBoard) + '</span>';
    if (meeting.meetingNo) metaChips += '<span class="md-drawer-chip">ครั้งที่ ' + esc(meeting.meetingNo) + '</span>';

    document.getElementById('mdDrawerTitle').innerHTML =
      '<div class="flex justify-between items-start gap-3">' +
      '<div class="min-w-0 flex-1">' +
      '<div class="flex flex-wrap items-center gap-2 mb-1">' +
      '<span class="md-drawer-status">' + esc(statusLabel) + '</span>' +
      '</div>' +
      '<h3 class="font-bold">' +
      (isNew ? 'สร้างการประชุมใหม่' : esc(meeting.title)) +
      '</h3>' +
      (isNew ? '<p class="md-drawer-sub">กรอกข้อมูลแล้วบันทึก — อัปโหลด PDF ได้หลังสร้าง</p>' : '<p class="md-drawer-sub">' + esc(meeting.meetingNo || '') + '</p>') +
      (metaChips ? '<div class="md-drawer-meta">' + metaChips + '</div>' : '') +
      '</div></div>';

    const tabs = [
      ['main', 'ข้อมูลหลัก'],
      ['agenda', 'วาระ'],
      ['approval', 'การอนุมัติ'],
      ['attendees', 'ผู้เข้าร่วม'],
      ['files', 'เอกสาร']
    ];
    if (!isNew && ['held', 'report_pending', 'approval_step1', 'approval_step2', 'approval_step3', 'approved', 'archived', 'revision'].includes(meeting.status)) {
      tabs.splice(2, 0, ['resolutions', 'มติ']);
    }

    let body = '<div class="md-drawer-tabs">';
    tabs.forEach(([k, label]) => {
      const icon = tabIcons[k] || 'fa-circle';
      body +=
        '<button type="button" class="md-drawer-tab' +
        (md.drawerTab === k ? ' active' : '') +
        '" data-dtab="' +
        k +
        '"><i class="fas ' +
        icon +
        '"></i>' +
        label +
        '</button>';
    });
    body += '</div><div id="mdDrawerTabContent">';
    if (md.drawerTab === 'main') body += renderDrawerMain(meeting, isNew);
    else if (md.drawerTab === 'agenda') body += renderDrawerAgenda(meeting);
    else if (md.drawerTab === 'resolutions') body += renderDrawerResolutions(meeting);
    else if (md.drawerTab === 'approval') body += renderDrawerApproval(meeting);
    else if (md.drawerTab === 'attendees') body += renderDrawerAttendees(meeting);
    else if (md.drawerTab === 'files') body += renderDrawerFiles(meeting);
    body += '</div>';

    const bodyEl = document.getElementById('mdDrawerBody');
    const footerEl = document.getElementById('mdDrawerFooter');
    try {
      bodyEl.innerHTML = body;
    } catch (err) {
      console.error('[MeetingDocs] renderDrawer', err);
      bodyEl.innerHTML =
        '<p class="text-red-600 text-sm p-4">โหลดฟอร์มไม่สำเร็จ: ' + esc(err.message) + '</p>';
    }
    footerEl.innerHTML =
      (canEdit()
        ? '<button type="button" id="mdSaveMeeting" class="md-btn md-btn-primary"><i class="fas fa-check"></i>บันทึก</button>' +
          (m ? '<button type="button" id="mdDeleteMeeting" class="md-btn md-btn-danger"><i class="fas fa-trash-alt"></i>ลบ</button>' : '')
        : '') +
      '<button type="button" id="mdCloseDrawer" class="md-btn md-btn-ghost">ปิด</button>';

    document.querySelectorAll('[data-dtab]').forEach((btn) => {
      btn.addEventListener('click', () => {
        md.drawerTab = btn.getAttribute('data-dtab');
        renderDrawer(meeting);
      });
    });
    bindDrawer(meeting, isNew);
  }

  function renderDrawerMain(m, isNew) {
    const types = getSettings().types || DEFAULT_TYPES;
    let html = '<div class="md-form"><div class="md-form-grid">';
    html += field('ชื่อการประชุม *', '<input id="mdF_title" class="md-input" value="' + esc(m.title || '') + '">', 'md-field-span2');
    html += field('ประเภท', '<select id="mdF_type" class="md-select">' + types.map((t) => '<option value="' + t.id + '"' + (m.meetingTypeId === t.id ? ' selected' : '') + '>' + esc(t.label) + '</option>').join('') + '</select>');
    const sets = committeeSets();
    const curSet = m.committeeSet || activeCommitteeSet();
    let setOpts = '';
    if (!sets.length) setOpts = '<option value="">—</option>';
    else sets.forEach((name) => { setOpts += '<option value="' + esc(name) + '"' + (curSet === name ? ' selected' : '') + '>' + esc(name) + '</option>'; });
    html += field('คณะกรรมการชุดที่', '<select id="mdF_set" class="md-select">' + setOpts + '</select>');
    html += field('คณะกรรมการ', '<select id="mdF_board" class="md-select"><option value="">— เลือกคณะ —</option>' + boards().map((b) => '<option value="' + esc(b) + '"' + (m.committeeBoard === b ? ' selected' : '') + '>' + esc(b) + '</option>').join('') + '</select>');
    html += field('ครั้งที่', '<input id="mdF_no" class="md-input" value="' + esc(m.meetingNo || '') + '" placeholder="เช่น 1/2569">');
    const dateVal = m.meetingDate && m.meetingDate.toDate ? m.meetingDate.toDate().toISOString().slice(0, 10) : '';
    html += field('วันที่ประชุม', '<input type="date" id="mdF_date" class="md-input" value="' + dateVal + '">');
    html += field('เวลาเริ่ม', '<input type="time" id="mdF_start" class="md-input" value="' + esc(m.startTime || '') + '">');
    html += field('เวลาสิ้นสุด', '<input type="time" id="mdF_end" class="md-input" value="' + esc(m.endTime || '') + '">');
    html += field('สถานที่', '<input id="mdF_location" class="md-input" value="' + esc(m.location || '') + '" placeholder="ห้องประชุม / ออนไลน์">', 'md-field-span2');
    html += field('เลขาคณะ', userSelect('mdF_secretary', m.secretaryId, true));
    html += field('ประธานคณะ', userSelect('mdF_chair', m.chairpersonId, true));
    html += field('สถานะ', '<select id="mdF_status" class="md-select">' + Object.keys(STATUS_LABELS).map((k) => '<option value="' + k + '"' + (m.status === k ? ' selected' : '') + '>' + esc(STATUS_LABELS[k]) + '</option>').join('') + '</select>');
    html += field('การมองเห็น', '<select id="mdF_vis" class="md-select"><option value="board_members"' + (m.visibility === 'board_members' ? ' selected' : '') + '>กรรมการคณะ</option><option value="all_staff"' + (m.visibility === 'all_staff' ? ' selected' : '') + '>เจ้าหน้าที่ทุกฝ่าย</option><option value="admin_only"' + (m.visibility === 'admin_only' ? ' selected' : '') + '>เฉพาะแอดมิน</option></select>');
    html += '</div></div>';
    return html;
  }

  function field(label, input, extraClass) {
    return '<div class="md-field' + (extraClass ? ' ' + extraClass : '') + '"><label>' + label + '</label>' + input + '</div>';
  }

  function renderFileUploadCard(opts) {
    const kind = opts.kind;
    const label = opts.label;
    const desc = opts.desc;
    const iconClass = opts.iconClass;
    const fileMeta = opts.fileMeta;
    const inputId = opts.inputId;
    const meeting = opts.meeting;
    const hasFile = fileMeta && fileMeta.downloadUrl;
    const disabled = !meeting.id;

    let html = '<div class="md-upload-card">';
    html += '<div class="md-upload-card-head">';
    html += '<div class="md-upload-icon ' + iconClass + '"><i class="fas fa-file-pdf"></i></div>';
    html += '<div><div class="md-upload-card-title">' + esc(label) + '</div>';
    html += '<div class="md-upload-card-desc">' + esc(desc) + ' · สูงสุด 25MB</div></div></div>';

    if (disabled) {
      html +=
        '<div class="md-upload-disabled"><i class="fas fa-save"></i>บันทึกการประชุมก่อน แล้วจึงอัปโหลด PDF ได้</div>';
    } else {
      if (hasFile) {
        html += '<div class="md-file-preview">';
        html += '<i class="fas fa-file-pdf"></i>';
        html += '<div class="md-file-preview-info">';
        html += '<div class="md-file-preview-name">' + esc(fileMeta.fileName || 'document.pdf') + '</div>';
        html += '<a href="' + esc(fileMeta.downloadUrl) + '" target="_blank" rel="noopener" class="md-file-preview-link"><i class="fas fa-external-link-alt mr-1"></i>เปิดดูไฟล์</a>';
        html += '</div></div>';
      }
      html += '<div class="md-upload-zone-wrap">';
      html += '<label class="md-upload-zone" id="mdZone_' + kind + '" for="' + inputId + '">';
      html += '<i class="fas fa-cloud-arrow-up md-upload-cloud"></i>';
      html += '<div class="md-upload-zone-text">' + (hasFile ? 'อัปโหลดทับไฟล์เดิม' : 'คลิกหรือลากไฟล์ PDF มาวาง') + '</div>';
      html += '<div class="md-upload-zone-hint">เฉพาะไฟล์ .pdf</div>';
      html += '<input type="file" accept=".pdf,application/pdf" id="' + inputId + '">';
      html += '</label></div>';
    }
    html += '</div>';
    return html;
  }

  function renderDrawerFiles(m) {
    let html = '<p class="md-files-intro"><i class="fas fa-shield-alt mr-1"></i>เอกสารเก็บใน Firebase Storage — เฉพาะผู้ล็อกอิน Admin อ่าน/อัปโหลดได้</p>';
    html += '<div class="space-y-4">';
    html += renderFileUploadCard({
      kind: 'agenda',
      label: 'วาระการประชุม',
      desc: 'PDF วาระที่แจกในที่ประชุม',
      iconClass: 'md-upload-icon--agenda',
      fileMeta: m.files && m.files.agenda,
      inputId: 'mdUploadAgenda',
      meeting: m
    });
    html += renderFileUploadCard({
      kind: 'report',
      label: 'รายงานการประชุม',
      desc: 'PDF รายงานสรุปหลังประชุม',
      iconClass: 'md-upload-icon--report',
      fileMeta: m.files && m.files.report,
      inputId: 'mdUploadReport',
      meeting: m
    });
    html += '</div>';
    return html;
  }

  function renderDrawerAgenda(m) {
    let html = '<button type="button" id="mdAddAgenda" class="mb-3 text-sm text-indigo-600"><i class="fas fa-plus"></i> เพิ่มวาระ</button><button type="button" id="mdTplAgenda" class="mb-3 ml-2 text-sm text-gray-600">ชุดวาระเริ่มต้น</button>';
    (m.agendaItems || []).forEach((item, i) => {
      html +=
        '<div class="md-agenda-row" data-idx="' +
        i +
        '"><span class="font-bold text-indigo-600">' +
        (item.order || i + 1) +
        '</span><div><input class="w-full border rounded px-2 py-1 mb-1 md-ag-title" value="' +
        esc(item.title) +
        '"><textarea class="w-full border rounded px-2 py-1 text-xs md-ag-detail" rows="2">' +
        esc(item.detail || '') +
        '</textarea></div><button type="button" class="text-red-500 md-rm-ag" data-idx="' +
        i +
        '"><i class="fas fa-trash"></i></button></div>';
    });
    return html || '<p class="text-gray-400 text-sm">ยังไม่มีวาระ</p>';
  }

  function renderDrawerResolutions(m) {
    let html = '<button type="button" id="mdAddRes" class="mb-3 text-sm text-indigo-600"><i class="fas fa-plus"></i> เพิ่มมติ</button>';
    (m.resolutions || []).forEach((r, i) => {
      html +=
        '<div class="p-3 mb-2 bg-gray-50 rounded-lg"><textarea class="w-full border rounded px-2 py-1 md-res-text" rows="2">' +
        esc(r.text) +
        '</textarea><select class="mt-1 border rounded text-sm md-res-result"><option value="เห็นชอบ"' +
        (r.result === 'เห็นชอบ' ? ' selected' : '') +
        '>เห็นชอบ</option><option value="เห็นชอบด้วยความเห็น"' +
        (r.result === 'เห็นชอบด้วยความเห็น' ? ' selected' : '') +
        '>เห็นชอบด้วยความเห็น</option><option value="ไม่เห็นชอบ"' +
        (r.result === 'ไม่เห็นชอบ' ? ' selected' : '') +
        '>ไม่เห็นชอบ</option></select><button type="button" class="text-red-500 text-xs mt-1 md-rm-res" data-idx="' +
        i +
        '">ลบ</button></div>';
    });
    return html;
  }

  function renderDrawerApproval(m) {
    const a = m.approval || emptyApproval();
    const steps = [
      ['manager', 'ผู้จัดการ', 1],
      ['secretary', 'เลขาคณะ', 2],
      ['chair', 'ประธานคณะ', 3]
    ];
    let html = '<div class="md-stepper">';
    steps.forEach(([key, label, num]) => {
      const st = a.steps && a.steps[key];
      const cls = st && st.status === 'approved' ? 'done' : a.currentStep === num ? 'current' : '';
      html += '<div class="md-step ' + cls + '">' + num + '. ' + label + '<br><small>' + (st && st.status === 'approved' ? '✓' : 'รอ') + '</small></div>';
    });
    html += '</div>';
    if (m.id) {
      html +=
        '<p class="text-xs text-indigo-600 mt-2"><a href="' +
        MEETDOC_PUBLIC_URL +
        '/#meeting/' +
        m.id +
        '" target="_blank" rel="noopener"><i class="fas fa-external-link-alt mr-1"></i>เปิดใน Meetdoc (กรรมการ)</a></p>';
    }
    if (canEdit() && m.id) {
      html += '<div class="flex flex-wrap gap-2 mt-4">';
      if (m.status === 'report_pending' || m.status === 'revision')
        html += '<button type="button" id="mdSubmitApproval" class="px-3 py-2 bg-amber-600 text-white rounded-lg text-sm">ส่งเข้าสายอนุมัติ</button>';
      if (m.status === 'approval_step1' && canApproveStep(m, 1))
        html += '<button type="button" class="md-approve px-3 py-2 bg-green-600 text-white rounded-lg text-sm" data-step="1">อนุมัติ (ผู้จัดการ)</button>';
      if (m.status === 'approval_step2' && canApproveStep(m, 2))
        html += '<button type="button" class="md-approve px-3 py-2 bg-green-600 text-white rounded-lg text-sm" data-step="2">อนุมัติ (เลขาคณะ)</button>';
      if (m.status === 'approval_step3' && canApproveStep(m, 3))
        html += '<button type="button" class="md-approve px-3 py-2 bg-green-600 text-white rounded-lg text-sm" data-step="3">อนุมัติ (ประธาน)</button>';
      if (m.status && m.status.startsWith('approval_') && (isAdminRole() || canApproveStep(m, 1) || canApproveStep(m, 2) || canApproveStep(m, 3)))
        html += '<button type="button" id="mdRejectApproval" class="px-3 py-2 bg-red-50 text-red-600 rounded-lg text-sm">ส่งกลับแก้</button>';
      html += '</div>';
    }
    return html;
  }

  function renderDrawerAttendees(m) {
    const board = m.committeeBoard;
    let html = '';
    if (board) {
      html += '<button type="button" id="mdLoadAttendees" class="mb-3 text-sm text-indigo-600">ดึงจากคณะ</button>';
    }
    (m.attendees || []).forEach((a, i) => {
      html +=
        '<label class="md-attendee-row"><input type="checkbox" class="md-att-present" data-idx="' +
        i +
        '"' +
        (a.present === 'yes' ? ' checked' : '') +
        '><span class="flex-1 min-w-0"><span class="text-sm font-medium text-gray-800 block truncate">' +
        esc(a.name || userName(a.userId)) +
        '</span><span class="text-xs text-gray-500">' +
        esc(a.position || '') +
        '</span></span></label>';
    });
    return html || '<p class="text-gray-400 text-sm">ยังไม่มีรายชื่อ</p>';
  }

  function collectDrawerData(meeting) {
    const title = document.getElementById('mdF_title');
    const board = document.getElementById('mdF_board');
    const date = document.getElementById('mdF_date');
    const data = {
      title: title ? title.value.trim() : meeting.title,
      meetingTypeId: document.getElementById('mdF_type') ? document.getElementById('mdF_type').value : meeting.meetingTypeId,
      committeeBoard: board ? board.value : meeting.committeeBoard,
      committeeSet: document.getElementById('mdF_set') ? document.getElementById('mdF_set').value : meeting.committeeSet || activeCommitteeSet(),
      meetingNo: document.getElementById('mdF_no') ? document.getElementById('mdF_no').value.trim() : meeting.meetingNo,
      startTime: document.getElementById('mdF_start') ? document.getElementById('mdF_start').value : meeting.startTime,
      endTime: document.getElementById('mdF_end') ? document.getElementById('mdF_end').value : meeting.endTime,
      location: document.getElementById('mdF_location') ? document.getElementById('mdF_location').value.trim() : meeting.location,
      secretaryId: document.getElementById('mdF_secretary') ? document.getElementById('mdF_secretary').value : meeting.secretaryId,
      chairpersonId: document.getElementById('mdF_chair') ? document.getElementById('mdF_chair').value : meeting.chairpersonId,
      status: document.getElementById('mdF_status') ? document.getElementById('mdF_status').value : meeting.status,
      visibility: document.getElementById('mdF_vis') ? document.getElementById('mdF_vis').value : meeting.visibility,
      agendaItems: meeting.agendaItems || [],
      resolutions: meeting.resolutions || [],
      attendees: meeting.attendees || [],
      files: meeting.files || {},
      approval: meeting.approval || emptyApproval()
    };
    if (date && date.value) {
      data.meetingDate = firebase.firestore.Timestamp.fromDate(new Date(date.value + 'T12:00:00'));
      data.fiscalYear = fiscalYearFromDate(data.meetingDate);
    }
    data.agendaItems = [];
    document.querySelectorAll('.md-agenda-row').forEach((row, i) => {
      const t = row.querySelector('.md-ag-title');
      const d = row.querySelector('.md-ag-detail');
      if (t && t.value.trim())
        data.agendaItems.push({
          order: i + 1,
          title: t.value.trim(),
          detail: d ? d.value.trim() : ''
        });
    });
    data.resolutions = [];
    document.querySelectorAll('.md-res-text').forEach((ta, i) => {
      const text = ta.value.trim();
      if (!text) return;
      const wrap = ta.closest('.p-3') || ta.parentElement;
      const sel = wrap && wrap.querySelector('.md-res-result');
      data.resolutions.push({
        order: i + 1,
        text,
        result: sel ? sel.value : ''
      });
    });
    data.attendees = (meeting.attendees || []).map((a, idx) => {
      const cb = document.querySelector('.md-att-present[data-idx="' + idx + '"]');
      return { ...a, present: cb && cb.checked ? 'yes' : 'no' };
    });
    return data;
  }

  function bindDrawer(meeting, isNew) {
    function applyDrawerBoardDefaults() {
      const boardSel = document.getElementById('mdF_board');
      const setSel = document.getElementById('mdF_set');
      if (!boardSel || !boardSel.value) return;
      const set = setSel ? setSel.value : activeCommitteeSet();
      const defs = applyBoardDefaults(boardSel.value, set);
      const sec = document.getElementById('mdF_secretary');
      const chair = document.getElementById('mdF_chair');
      if (sec && defs.secretaryId) sec.value = defs.secretaryId;
      if (chair && defs.chairpersonId) chair.value = defs.chairpersonId;
      const no = document.getElementById('mdF_no');
      if (no && !no.value) no.value = nextMeetingNo(boardSel.value);
    }

    const boardSel = document.getElementById('mdF_board');
    const setSel = document.getElementById('mdF_set');
    if (boardSel) boardSel.addEventListener('change', applyDrawerBoardDefaults);
    if (setSel) setSel.addEventListener('change', applyDrawerBoardDefaults);
    if (isNew && boardSel && boardSel.value) applyDrawerBoardDefaults();

    document.getElementById('mdCloseDrawer') && document.getElementById('mdCloseDrawer').addEventListener('click', closeDrawer);

    const saveBtn = document.getElementById('mdSaveMeeting');
    if (saveBtn)
      saveBtn.addEventListener('click', async () => {
        const data = collectDrawerData(meeting);
        if (!data.title) {
          toast('กรุณาระบุชื่อการประชุม', 'error');
          return;
        }
        data.updatedAt = firebase.firestore.FieldValue.serverTimestamp();
        try {
          if (isNew) {
            data.createdAt = firebase.firestore.FieldValue.serverTimestamp();
            data.createdBy = firebase.auth().currentUser && firebase.auth().currentUser.uid;
            data.reminderSent = {};
            const ref = await db().collection(COLLECTION).add(data);
            md.drawerId = ref.id;
            toast('สร้างการประชุมแล้ว', 'success');
          } else {
            await db().collection(COLLECTION).doc(meeting.id).set(data, { merge: true });
            toast('บันทึกแล้ว', 'success');
          }
          await loadMeetings();
          const updated = md.meetings.find((x) => x.id === md.drawerId);
          renderDrawer(updated);
          renderShell();
        } catch (e) {
          toast('บันทึกไม่สำเร็จ: ' + e.message, 'error');
        }
      });

    const delBtn = document.getElementById('mdDeleteMeeting');
    if (delBtn)
      delBtn.addEventListener('click', async () => {
        const ok = await confirmDlg('ลบการประชุมนี้?', 'ลบ');
        if (!ok) return;
        await db().collection(COLLECTION).doc(meeting.id).delete();
        closeDrawer();
        await loadMeetings();
        renderShell();
        toast('ลบแล้ว', 'success');
      });

    document.getElementById('mdAddAgenda') &&
      document.getElementById('mdAddAgenda').addEventListener('click', () => {
        meeting.agendaItems = meeting.agendaItems || [];
        meeting.agendaItems.push({ order: meeting.agendaItems.length + 1, title: '', detail: '' });
        md.drawerTab = 'agenda';
        renderDrawer(meeting);
      });
    document.getElementById('mdTplAgenda') &&
      document.getElementById('mdTplAgenda').addEventListener('click', () => {
        meeting.agendaItems = [
          { order: 1, title: 'เรื่องแจ้งเพื่อทราบ', detail: '' },
          { order: 2, title: 'เรื่องเสนอเพื่อพิจารณา', detail: '' },
          { order: 3, title: 'เรื่องอื่นๆ', detail: '' }
        ];
        renderDrawer(meeting);
      });

    document.querySelectorAll('.md-rm-ag').forEach((btn) => {
      btn.addEventListener('click', () => {
        const idx = parseInt(btn.getAttribute('data-idx'), 10);
        meeting.agendaItems = (meeting.agendaItems || []).filter((_, i) => i !== idx);
        md.drawerTab = 'agenda';
        renderDrawer(meeting);
      });
    });

    document.getElementById('mdAddRes') &&
      document.getElementById('mdAddRes').addEventListener('click', () => {
        meeting.resolutions = meeting.resolutions || [];
        meeting.resolutions.push({ order: meeting.resolutions.length + 1, text: '', result: 'เห็นชอบ' });
        md.drawerTab = 'resolutions';
        renderDrawer(meeting);
      });

    document.querySelectorAll('.md-rm-res').forEach((btn) => {
      btn.addEventListener('click', () => {
        const idx = parseInt(btn.getAttribute('data-idx'), 10);
        meeting.resolutions = (meeting.resolutions || []).filter((_, i) => i !== idx);
        md.drawerTab = 'resolutions';
        renderDrawer(meeting);
      });
    });

    document.getElementById('mdRejectApproval') &&
      document.getElementById('mdRejectApproval').addEventListener('click', async () => {
        const ok = await confirmDlg('ส่งกลับแก้รายงาน?', 'ส่งกลับแก้');
        if (!ok || !meeting.id) return;
        await db().collection(COLLECTION).doc(meeting.id).update({
          status: 'revision',
          updatedAt: firebase.firestore.FieldValue.serverTimestamp()
        });
        await loadMeetings();
        renderDrawer(md.meetings.find((x) => x.id === meeting.id));
        toast('ส่งกลับแก้แล้ว', 'success');
      });

    document.getElementById('mdLoadAttendees') &&
      document.getElementById('mdLoadAttendees').addEventListener('click', () => {
        const setEl = document.getElementById('mdF_set');
        const set = setEl ? setEl.value : meeting.committeeSet || activeCommitteeSet();
        meeting.attendees = boardMembers(meeting.committeeBoard, set).map((u) => ({
          userId: u.id,
          name: u.fullname || u.nameTH,
          position: u.committeePosition || '',
          present: 'yes'
        }));
        md.drawerTab = 'attendees';
        renderDrawer(meeting);
      });

    document.getElementById('mdSubmitApproval') &&
      document.getElementById('mdSubmitApproval').addEventListener('click', async () => {
        await db().collection(COLLECTION).doc(meeting.id).update({
          status: 'approval_step1',
          'approval.currentStep': 1,
          updatedAt: firebase.firestore.FieldValue.serverTimestamp()
        });
        await loadMeetings();
        renderDrawer(md.meetings.find((x) => x.id === meeting.id));
        toast('ส่งเข้าสายอนุมัติแล้ว', 'success');
      });

    document.querySelectorAll('.md-approve').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const step = parseInt(btn.getAttribute('data-step'), 10);
        await advanceApproval(meeting.id, step);
      });
    });

    bindFileUpload(meeting, 'mdUploadAgenda', 'agenda');
    bindFileUpload(meeting, 'mdUploadReport', 'report');
  }

  async function advanceApproval(id, step) {
    const m = md.meetings.find((x) => x.id === id);
    if (!m) return;
    const approval = m.approval || emptyApproval();
    const uid = firebase.auth().currentUser && firebase.auth().currentUser.uid;
    const key = step === 1 ? 'manager' : step === 2 ? 'secretary' : 'chair';
    approval.steps[key] = { status: 'approved', userId: uid, at: new Date().toISOString() };
    let newStatus = m.status;
    if (step === 1) {
      approval.currentStep = 2;
      newStatus = 'approval_step2';
    } else if (step === 2) {
      approval.currentStep = 3;
      newStatus = 'approval_step3';
    } else if (step === 3) {
      approval.currentStep = 'complete';
      approval.completedAt = firebase.firestore.FieldValue.serverTimestamp();
      newStatus = 'approved';
    }
    await db().collection(COLLECTION).doc(id).update({ approval, status: newStatus, updatedAt: firebase.firestore.FieldValue.serverTimestamp() });
    await loadMeetings();
    renderDrawer(md.meetings.find((x) => x.id === id));
    toast('อนุมัติขั้น ' + step + ' แล้ว', 'success');
  }

  function bindUploadZone(inputId, kind) {
    const input = document.getElementById(inputId);
    const zone = document.getElementById('mdZone_' + kind);
    if (!input || !zone) return;
    ['dragenter', 'dragover'].forEach((ev) => {
      zone.addEventListener(ev, (e) => {
        e.preventDefault();
        zone.classList.add('is-dragover');
      });
    });
    ['dragleave', 'drop'].forEach((ev) => {
      zone.addEventListener(ev, (e) => {
        e.preventDefault();
        zone.classList.remove('is-dragover');
      });
    });
    zone.addEventListener('drop', (e) => {
      const f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
      if (f && f.type === 'application/pdf') {
        input.files = e.dataTransfer.files;
        input.dispatchEvent(new Event('change', { bubbles: true }));
      } else if (f) toast('รองรับเฉพาะ PDF', 'error');
    });
  }

  function bindFileUpload(meeting, inputId, kind) {
    const input = document.getElementById(inputId);
    if (!input || !meeting.id) return;
    bindUploadZone(inputId, kind);
    input.addEventListener('change', async () => {
      const file = input.files[0];
      if (!file) return;
      if (file.size > 25 * 1024 * 1024) {
        toast('ไฟล์ใหญ่เกิน 25MB', 'error');
        return;
      }
      try {
        toast('กำลังอัปโหลด...', 'info');
        const fy = meeting.fiscalYear || new Date().getFullYear() + 543;
        const path = 'meeting-docs/' + fy + '/' + meeting.id + '/' + kind + '.pdf';
        const ref = storage().ref(path);
        await ref.put(file, { contentType: 'application/pdf' });
        const url = await ref.getDownloadURL();
        const meta = {
          storagePath: path,
          downloadUrl: url,
          fileName: file.name,
          uploadedAt: firebase.firestore.FieldValue.serverTimestamp(),
          uploadedBy: firebase.auth().currentUser && firebase.auth().currentUser.uid
        };
        const files = { ...(meeting.files || {}), [kind]: meta };
        await db().collection(COLLECTION).doc(meeting.id).update({ files });
        await loadMeetings();
        md.drawerTab = 'files';
        renderDrawer(md.meetings.find((x) => x.id === meeting.id));
        toast('อัปโหลดแล้ว', 'success');
      } catch (e) {
        toast('อัปโหลดไม่สำเร็จ: ' + e.message, 'error');
      }
    });
  }

  async function init() {
    if (!document.getElementById('meetingdocs-root')) return;
    try {
      await waitForAdminUsers(12000);
      await loadSettings();
      await loadMeetings();
      md.initialized = true;
      renderShell();
    } catch (e) {
      console.error('[MeetingDocs]', e);
      const root = document.getElementById('meetingdocs-root');
      if (root) root.innerHTML = '<p class="text-red-600 p-6">โหลดไม่สำเร็จ: ' + esc(e.message) + '</p>';
    }
  }

  global.MeetingDocs = { init, openDrawer, loadMeetings };
})(typeof window !== 'undefined' ? window : global);
