/** หน้าทำเนียบฝ่ายจัดการ — ข้อมูลจาก departments + users (เดียวกับ admin #orgstructure) */
const CMS_MANAGEMENT_PAGE_ID = '8929';

const MGMT_DEPT_COLORS = [
  { from: '#a855f7', to: '#9333ea', text: '#6d28d9', line: '#d8b4fe' },
  { from: '#6366f1', to: '#4f46e5', text: '#4338ca', line: '#c7d2fe' },
  { from: '#8b5cf6', to: '#7c3aed', text: '#6d28d9', line: '#ddd6fe' },
  { from: '#c026d3', to: '#a21caf', text: '#86198f', line: '#f5d0fe' }
];

let mgmtAllUsers = [];

function escapeMgmtHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function mgmtUserId(u) {
  return u.id || u._firestoreDocId || u.uid || '';
}

function mgmtAvatarSrc(user) {
  return (user.avatar || user.userAvatar || user.lineAvatar || '').trim();
}

function mgmtAvatarPosition(user) {
  return (user.avatarPosition || 'center center').trim();
}

function mgmtAvatarHtml(user, size) {
  const src = mgmtAvatarSrc(user);
  const pos = mgmtAvatarPosition(user);
  const name = user.fullname || 'U';
  if (!src) {
    return `<span class="kb-mgmt-card-initial" aria-hidden="true">${escapeMgmtHtml(name.charAt(0))}</span>`;
  }
  const px = (size || 16) * 4;
  return `<img src="${escapeMgmtHtml(src)}" alt="" class="kb-mgmt-card-img" style="object-position:${escapeMgmtHtml(pos)}" loading="lazy" onerror="this.onerror=null;this.src='https://ui-avatars.com/api/?name=${encodeURIComponent(name)}&background=c2185b&color=fff&size=${px}';">`;
}

function mgmtPositionJob(u) {
  const pos = (u.position || '').trim();
  const job = (u.job || '').trim();
  if (!job || job === 'งานทั้งหมด' || pos.includes(job)) return pos;
  return `${pos} ${job}`.trim();
}

function mgmtDeptHeadTitle(deptName) {
  return `หัวหน้า ${deptName || ''}`.trim();
}

let mgmtRoleOverrides = {};

const MGMT_DEFAULT_INTERNAL_PHONE = '042-420750';

function mgmtInternalPhone(user) {
  const u = user && typeof user === 'object' ? user : {};
  let phone = String(u.internalPhone || '').trim();
  let ext = String(u.internalPhoneExt || '').trim();
  if (!ext && phone && /กด/.test(phone)) {
    const m = phone.match(/^(.+?)\s+กด\s*(.+)$/);
    if (m) {
      phone = m[1].trim();
      ext = m[2].trim();
    }
  }
  if (!phone) phone = MGMT_DEFAULT_INTERNAL_PHONE;
  if (ext.startsWith('กด')) ext = ext.replace(/^กด\s*/, '').trim();
  if (!ext) return phone;
  return `${phone} กด ${ext}`;
}

function renderMgmtPersonCard(user, opts) {
  const size = (opts && opts.size) || 'md';
  const accent = (opts && opts.accent) || '';
  const cls =
    size === 'lg'
      ? 'kb-mgmt-card kb-mgmt-card--lg'
      : size === 'sm'
        ? 'kb-mgmt-card kb-mgmt-card--sm'
        : 'kb-mgmt-card';
  const style = accent ? ` style="--kb-mgmt-accent:${accent}"` : '';
  const name = user.fullname || 'ไม่ระบุ';
  const memberId = escapeMgmtHtml(String(mgmtUserId(user)));
  const role = (opts && opts.roleOverride) || mgmtPositionJob(user);
  return `
<article class="${cls}"${style} data-member-id="${memberId}">
  <button type="button" class="kb-mgmt-card-photo kb-mgmt-card-photo--clickable" data-mgmt-member-open="${memberId}" aria-label="ดูข้อมูล ${escapeMgmtHtml(name)}">
    ${mgmtAvatarHtml(user, size === 'lg' ? 20 : size === 'sm' ? 12 : 16)}
  </button>
  <h4 class="kb-mgmt-card-name">${escapeMgmtHtml(name)}</h4>
  <p class="kb-mgmt-card-role">${escapeMgmtHtml(role)}</p>
</article>`;
}

function buildUsersByDept(users) {
  const map = {};
  users.forEach((u) => {
    const pos = u.position || '';
    if (pos.includes('ผู้จัดการ')) return;
    const dept = u.department || 'ไม่ระบุฝ่าย';
    if (!map[dept]) map[dept] = [];
    map[dept].push(u);
  });
  Object.keys(map).forEach((dept) => {
    map[dept].sort((a, b) => {
      const posA = a.position || '';
      const posB = b.position || '';
      if (posA.includes('หัวหน้า')) return -1;
      if (posB.includes('หัวหน้า')) return 1;
      if (posA.includes('เจ้าหน้าที่') && !posB.includes('เจ้าหน้าที่')) return -1;
      if (!posA.includes('เจ้าหน้าที่') && posB.includes('เจ้าหน้าที่')) return 1;
      return (a.fullname || '').localeCompare(b.fullname || '', 'th');
    });
  });
  return map;
}

function buildMgmtRoleOverrides(departments, users) {
  const overrides = {};
  departments.forEach((dept) => {
    const deptUsers = users.filter((u) => (u.department || '') === dept.name);
    const deptHead =
      (dept.headUserId && users.find((u) => mgmtUserId(u) === dept.headUserId)) ||
      deptUsers.find((u) => mgmtUserId(u) === dept.headUserId) ||
      deptUsers.find((u) => (u.position || '').includes('หัวหน้า'));
    if (deptHead) {
      overrides[mgmtUserId(deptHead)] = mgmtDeptHeadTitle(dept.name);
    }
  });
  return overrides;
}

function mgmtDisplayRole(member) {
  const id = mgmtUserId(member);
  if (id && mgmtRoleOverrides[id]) return mgmtRoleOverrides[id];
  return mgmtPositionJob(member) || member.position || 'เจ้าหน้าที่';
}

function renderManagementChart(departments, users) {
  const usersByDept = buildUsersByDept(users);
  const topManagers = users.filter((u) => {
    const pos = u.position || '';
    return pos.includes('ผู้จัดการ') && !pos.includes('รอง');
  });
  const deputyManagers = users.filter((u) => (u.position || '').includes('รองผู้จัดการ'));

  let html = '<div class="kb-mgmt-tree">';

  if (topManagers.length) {
    html += `<div class="kb-mgmt-level">
  <span class="kb-mgmt-level-badge kb-mgmt-level-badge--gold">ผู้จัดการ</span>
  <div class="kb-mgmt-row">${topManagers.map((m) => renderMgmtPersonCard(m, { size: 'lg' })).join('')}</div>
</div><div class="kb-mgmt-connector" aria-hidden="true"></div>`;
  }

  if (deputyManagers.length) {
    html += `<div class="kb-mgmt-level">
  <span class="kb-mgmt-level-badge kb-mgmt-level-badge--blue">รองผู้จัดการ</span>
  <div class="kb-mgmt-row">${deputyManagers.map((m) => renderMgmtPersonCard(m, { size: 'md' })).join('')}</div>
</div><div class="kb-mgmt-connector" aria-hidden="true"></div>`;
  }

  if (departments.length) {
    html += '<div class="kb-mgmt-dept-grid">';
    departments.forEach((dept, idx) => {
      const c = MGMT_DEPT_COLORS[idx % MGMT_DEPT_COLORS.length];
      const deptUsers = usersByDept[dept.name] || [];
      const deptHead =
        (dept.headUserId && users.find((u) => mgmtUserId(u) === dept.headUserId)) ||
        deptUsers.find((u) => mgmtUserId(u) === dept.headUserId) ||
        deptUsers.find((u) => (u.position || '').includes('หัวหน้า'));
      const headId = deptHead ? mgmtUserId(deptHead) : '';
      const staff = deptUsers.filter((u) => mgmtUserId(u) !== headId);

      html += `<section class="kb-mgmt-dept" style="--kb-dept-from:${c.from};--kb-dept-to:${c.to};--kb-dept-text:${c.text};--kb-dept-line:${c.line}">
  <h3 class="kb-mgmt-dept-title">${escapeMgmtHtml(dept.name)}</h3>`;

      if (deptHead || staff.length) {
        html += '<div class="kb-mgmt-dept-body">';
        if (deptHead) {
          html += `<div class="kb-mgmt-dept-head">${renderMgmtPersonCard(deptHead, { size: 'md', accent: c.text, roleOverride: mgmtDeptHeadTitle(dept.name) })}</div>`;
          if (staff.length) html += '<div class="kb-mgmt-dept-line" aria-hidden="true"></div>';
        }
        if (staff.length) {
          html += `<div class="kb-mgmt-dept-staff">${staff.map((u) => renderMgmtPersonCard(u, { size: 'sm' })).join('')}</div>`;
        }
        html += '</div>';
      } else {
        html += '<p class="kb-mgmt-dept-empty">ว่าง</p>';
      }
      html += '</section>';
    });
    html += '</div>';
  }

  const noDept = usersByDept['ไม่ระบุฝ่าย'] || [];
  if (noDept.length) {
    html += `<section class="kb-mgmt-dept kb-mgmt-dept--muted">
  <h3 class="kb-mgmt-dept-title">ยังไม่ระบุฝ่าย</h3>
  <div class="kb-mgmt-dept-staff">${noDept.map((u) => renderMgmtPersonCard(u, { size: 'sm' })).join('')}</div>
</section>`;
  }

  if (!topManagers.length && !deputyManagers.length && !departments.length && !noDept.length) {
    html += '<div class="kb-mgmt-empty"><p>ยังไม่มีข้อมูลเจ้าหน้าที่</p></div>';
  }

  html += '</div>';
  return html;
}

function renderManagementPage(departments, users) {
  return `
<div class="kb-page-body kb-page-body--management">
  <div class="kb-container">
    <div class="kb-mgmt-chart-wrap">${renderManagementChart(departments, users)}</div>
  </div>
</div>`;
}

async function fetchManagementData() {
  const [deptSnap, usersSnap, orgSnap] = await Promise.all([
    db.collection('departments').get(),
    db.collection('users').where('group', '==', 'เจ้าหน้าที่').get(),
    db.collection('config').doc('org').get()
  ]);
  const org = orgSnap.exists ? orgSnap.data() : {};
  let departments = deptSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
  departments.sort((a, b) => (a.order || 999) - (b.order || 999));

  if (!departments.length && Array.isArray(org.departments)) {
    departments = org.departments.map((name, i) => ({
      id: String(i),
      name,
      order: i + 1
    }));
  }

  const users = usersSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
  return { departments, users };
}

function mgmtTelHref(phone) {
  const digits = String(phone || '').replace(/[^\d+]/g, '');
  return digits || '';
}

function renderMgmtMemberModalPhoto(member) {
  const src = mgmtAvatarSrc(member);
  const pos = mgmtAvatarPosition(member);
  const name = member.fullname || 'ไม่ระบุ';
  if (src) {
    return `<img src="${escapeMgmtHtml(src)}" alt="" class="kb-team-modal-photo-img" style="object-position:${escapeMgmtHtml(pos)}" loading="lazy">`;
  }
  return `<span class="kb-team-modal-photo-fallback" aria-hidden="true">${escapeMgmtHtml((name.charAt(0) || 'U').toUpperCase())}</span>`;
}

function mgmtShowsPublicPhone(user) {
  if (user && user.showPhoneOnPublic === true) return true;
  if (user && user.showPhoneOnPublic === false) return false;
  return user && user.group === 'เจ้าหน้าที่';
}

function mgmtShowsInternalPhone(user) {
  if (user && user.showInternalPhoneOnPublic === true) return true;
  if (user && user.showInternalPhoneOnPublic === false) return false;
  if (user && user.showInternalPhoneOnTeam === true) return true;
  if (user && user.showInternalPhoneOnTeam === false) return false;
  return user && user.group === 'เจ้าหน้าที่';
}

function mgmtShowsEmail(user) {
  return !!(user && user.showEmailOnPublic === true);
}

function renderMgmtMemberModalBody(member) {
  const name = member.fullname || 'ไม่ระบุ';
  const memberId = mgmtUserId(member);
  const role = mgmtDisplayRole(member);
  const email = mgmtShowsEmail(member) ? (member.email || '').trim() : '';
  const phone = mgmtShowsPublicPhone(member) ? (member.phone || '').trim() : '';
  const internalPhone = mgmtShowsInternalPhone(member) ? mgmtInternalPhone(member) : '';
  const emailRow = email
    ? `<div class="kb-team-modal-row">
  <span class="kb-team-modal-label">อีเมล</span>
  <a class="kb-team-modal-value kb-team-modal-link" href="mailto:${escapeMgmtHtml(email)}">${escapeMgmtHtml(email)}</a>
</div>`
    : '';
  const phoneRow = phone
    ? `<div class="kb-team-modal-row">
  <span class="kb-team-modal-label">โทรศัพท์</span>
  <a class="kb-team-modal-value kb-team-modal-link" href="tel:${escapeMgmtHtml(mgmtTelHref(phone))}">${escapeMgmtHtml(phone)}</a>
</div>`
    : '';
  const internalRow = internalPhone
    ? `<div class="kb-team-modal-row">
  <span class="kb-team-modal-label">เบอร์โทร</span>
  <span class="kb-team-modal-value">${escapeMgmtHtml(internalPhone)}</span>
</div>`
    : '';
  const contactEmpty = !email && !phone && !internalPhone
    ? '<p class="kb-team-modal-empty">ยังไม่มีข้อมูลติดต่อ</p>'
    : '';

  return `
<div class="kb-team-modal-layout">
  <div class="kb-team-modal-photo">${renderMgmtMemberModalPhoto(member)}</div>
  <div class="kb-team-modal-info">
    <h2 id="kb-team-modal-name" class="kb-team-modal-name">${escapeMgmtHtml(name)}</h2>
    <p class="kb-team-modal-role">${escapeMgmtHtml(role)}</p>
    <div class="kb-team-modal-contact">${emailRow}${phoneRow}${internalRow}${contactEmpty}</div>
    <div class="kb-team-modal-actions">
      <button type="button" class="kb-team-modal-contact-btn" data-mgmt-contact-staff="${escapeMgmtHtml(String(memberId))}" data-mgmt-contact-name="${escapeMgmtHtml(name)}" data-mgmt-contact-title="${escapeMgmtHtml(role)}">
        <span class="kb-team-modal-contact-btn-icon" aria-hidden="true">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
        </span>
        ติดต่อเจ้าหน้าที่
      </button>
    </div>
  </div>
</div>`;
}

function ensureMgmtMemberModal() {
  let modal = document.getElementById('kb-team-member-modal');
  if (modal) return modal;

  modal = document.createElement('div');
  modal.id = 'kb-team-member-modal';
  modal.className = 'kb-team-modal';
  modal.hidden = true;
  modal.innerHTML = `
<div class="kb-team-modal-backdrop" data-team-modal-close tabindex="-1"></div>
<div class="kb-team-modal-panel" role="dialog" aria-modal="true" aria-labelledby="kb-team-modal-name">
  <button type="button" class="kb-team-modal-close" data-team-modal-close aria-label="ปิด">&times;</button>
  <div class="kb-team-modal-body"></div>
</div>`;
  document.body.appendChild(modal);
  return modal;
}

let mgmtModalLastFocus = null;
let mgmtModalFocusTrapHandler = null;

function bindMgmtMemberModalFocus(modal) {
  const panel = modal.querySelector('.kb-team-modal-panel');
  if (!panel) return;
  const focusable = panel.querySelectorAll(
    'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
  );
  if (!focusable.length) return;
  const first = focusable[0];
  const last = focusable[focusable.length - 1];
  if (mgmtModalFocusTrapHandler) {
    modal.removeEventListener('keydown', mgmtModalFocusTrapHandler);
  }
  mgmtModalFocusTrapHandler = (e) => {
    if (e.key !== 'Tab') return;
    if (e.shiftKey) {
      if (document.activeElement === first) {
        e.preventDefault();
        last.focus();
      }
    } else if (document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  };
  modal.addEventListener('keydown', mgmtModalFocusTrapHandler);
}

function closeMgmtMemberModal(modal) {
  if (!modal) return;
  modal.hidden = true;
  document.body.classList.remove('kb-team-modal-open');
  if (mgmtModalFocusTrapHandler) {
    modal.removeEventListener('keydown', mgmtModalFocusTrapHandler);
    mgmtModalFocusTrapHandler = null;
  }
  if (mgmtModalLastFocus && typeof mgmtModalLastFocus.focus === 'function') {
    mgmtModalLastFocus.focus();
  }
  mgmtModalLastFocus = null;
}

function openMgmtMemberModal(member) {
  const modal = ensureMgmtMemberModal();
  const body = modal.querySelector('.kb-team-modal-body');
  if (!body) return;
  mgmtModalLastFocus = document.activeElement;
  body.innerHTML = renderMgmtMemberModalBody(member);
  modal.hidden = false;
  document.body.classList.add('kb-team-modal-open');
  bindMgmtMemberModalFocus(modal);
  modal.querySelector('.kb-team-modal-close')?.focus();
}

let mgmtModalListenersBound = false;

function bindMgmtMemberModal() {
  if (mgmtModalListenersBound) return;
  mgmtModalListenersBound = true;

  document.addEventListener('click', (e) => {
    if (!e.target.closest('[data-team-modal-close]')) return;
    const modal = document.getElementById('kb-team-member-modal');
    if (modal && !modal.hidden) closeMgmtMemberModal(modal);
  });

  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    const modal = document.getElementById('kb-team-member-modal');
    if (modal && !modal.hidden) closeMgmtMemberModal(modal);
  });
}

function bindManagementPage(root) {
  root.addEventListener('click', (e) => {
    const memberBtn = e.target.closest('[data-mgmt-member-open]');
    if (!memberBtn) return;
    const memberId = memberBtn.getAttribute('data-mgmt-member-open');
    const member = mgmtAllUsers.find((m) => String(mgmtUserId(m)) === String(memberId));
    if (member) openMgmtMemberModal(member);
  });
}

function bindMgmtContactStaff() {
  if (window.__mgmtContactStaffBound) return;
  window.__mgmtContactStaffBound = true;
  document.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-mgmt-contact-staff]');
    if (!btn) return;
    e.preventDefault();
    const staffId = btn.getAttribute('data-mgmt-contact-staff');
    const staffName = btn.getAttribute('data-mgmt-contact-name') || '';
    const contactTitle = btn.getAttribute('data-mgmt-contact-title') || '';
    const modal = document.getElementById('kb-team-member-modal');
    if (modal && !modal.hidden) closeMgmtMemberModal(modal);
    function tryOpen(tries) {
      if (window.NkbkMemberChat && typeof window.NkbkMemberChat.open === 'function') {
        window.NkbkMemberChat.open({
          staffId: staffId,
          staffName: staffName,
          contactTitle: contactTitle,
          prefill: contactTitle
            ? 'สวัสดีครับ/ค่ะ ต้องการติดต่อ' + contactTitle + ' เรื่อง '
            : 'สวัสดีครับ/ค่ะ ต้องการติดต่อเจ้าหน้าที่ เรื่อง '
        });
        return;
      }
      if (tries > 40) return;
      setTimeout(function () {
        tryOpen(tries + 1);
      }, 150);
    }
    tryOpen(0);
  });
}

function tryOpenStaffContactFromUrl() {
  const params = new URLSearchParams(window.location.search);
  const staffId = params.get('contact') || params.get('staff');
  if (!staffId) return;
  function tryOpen(tries) {
    if (window.NkbkMemberChat && typeof window.NkbkMemberChat.open === 'function') {
      window.NkbkMemberChat.open({ staffId: staffId });
      return;
    }
    if (tries > 50) return;
    setTimeout(function () {
      tryOpen(tries + 1);
    }, 200);
  }
  tryOpen(0);
}

async function initManagementPage(main) {
  const { departments, users } = await fetchManagementData();
  mgmtAllUsers = users;
  mgmtRoleOverrides = buildMgmtRoleOverrides(departments, users);
  bindMgmtMemberModal();
  bindMgmtContactStaff();
  main.innerHTML = renderManagementPage(departments, users);
  bindManagementPage(main);
  tryOpenStaffContactFromUrl();
}

window.CmsManagementPage = {
  PAGE_ID: CMS_MANAGEMENT_PAGE_ID,
  initManagementPage
};
