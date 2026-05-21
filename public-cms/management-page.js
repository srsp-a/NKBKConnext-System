/** หน้าทำเนียบฝ่ายจัดการ — ข้อมูลจาก departments + users (เดียวกับ admin #orgstructure) */
const CMS_MANAGEMENT_PAGE_ID = '8929';

const MGMT_DEPT_COLORS = [
  { from: '#a855f7', to: '#9333ea', text: '#6d28d9', line: '#d8b4fe' },
  { from: '#6366f1', to: '#4f46e5', text: '#4338ca', line: '#c7d2fe' },
  { from: '#8b5cf6', to: '#7c3aed', text: '#6d28d9', line: '#ddd6fe' },
  { from: '#c026d3', to: '#a21caf', text: '#86198f', line: '#f5d0fe' }
];

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

function mgmtAvatarHtml(user, size) {
  const src = user.userAvatar || user.lineAvatar || user.avatar || '';
  const name = user.fullname || 'U';
  if (!src) {
    return `<span class="kb-mgmt-card-initial" aria-hidden="true">${escapeMgmtHtml(name.charAt(0))}</span>`;
  }
  const px = (size || 16) * 4;
  return `<img src="${escapeMgmtHtml(src)}" alt="" class="kb-mgmt-card-img" loading="lazy" onerror="this.onerror=null;this.src='https://ui-avatars.com/api/?name=${encodeURIComponent(name)}&background=c2185b&color=fff&size=${px}';">`;
}

function mgmtPositionJob(u) {
  const pos = (u.position || '').trim();
  const job = (u.job || '').trim();
  if (!job || job === 'งานทั้งหมด' || pos.includes(job)) return pos;
  return `${pos} ${job}`.trim();
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
  return `
<article class="${cls}"${style}>
  <div class="kb-mgmt-card-photo">${mgmtAvatarHtml(user, size === 'lg' ? 20 : size === 'sm' ? 12 : 16)}</div>
  <h4 class="kb-mgmt-card-name">${escapeMgmtHtml(user.fullname || 'ไม่ระบุ')}</h4>
  <p class="kb-mgmt-card-role">${escapeMgmtHtml(mgmtPositionJob(user))}</p>
</article>`;
}

function buildUsersByDept(users) {
  const map = {};
  users.forEach((u) => {
    const pos = u.position || '';
    if (pos.includes('ผู้จัดการ') && !pos.includes('รอง')) return;
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
      const deptHead = deptUsers.find(
        (u) =>
          (u.position || '').includes('หัวหน้า') ||
          mgmtUserId(u) === dept.headUserId
      );
      const headId = deptHead ? mgmtUserId(deptHead) : '';
      const staff = deptUsers.filter((u) => mgmtUserId(u) !== headId);

      html += `<section class="kb-mgmt-dept" style="--kb-dept-from:${c.from};--kb-dept-to:${c.to};--kb-dept-text:${c.text};--kb-dept-line:${c.line}">
  <h3 class="kb-mgmt-dept-title">${escapeMgmtHtml(dept.name)}</h3>`;

      if (deptHead || staff.length) {
        html += '<div class="kb-mgmt-dept-body">';
        if (deptHead) {
          html += `<div class="kb-mgmt-dept-head">${renderMgmtPersonCard(deptHead, { size: 'md', accent: c.text })}</div>`;
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

async function initManagementPage(main) {
  const { departments, users } = await fetchManagementData();
  main.innerHTML = renderManagementPage(departments, users);
}

window.CmsManagementPage = {
  PAGE_ID: CMS_MANAGEMENT_PAGE_ID,
  initManagementPage
};
