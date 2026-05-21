/** หน้าคณะกรรมการ — ข้อมูลจาก config/org + users (เดียวกับ admin #committeestructure) */
const CMS_TEAM_PAGE_ID = '420';

function escapeTeamHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function teamAvatarHtml(user) {
  const src = user.avatar || '';
  const pos = user.avatarPosition || 'center center';
  if (!src) return '';
  return `<img src="${escapeTeamHtml(src)}" alt="" class="kb-team-card-img" style="object-position:${escapeTeamHtml(pos)}" loading="lazy" onerror="this.remove();var f=this.parentElement&&this.parentElement.querySelector('.kb-team-card-fallback');if(f)f.hidden=false;">`;
}

function teamAvatarFallback(user) {
  const name = user.fullname || 'U';
  return `<span class="kb-team-card-initial" aria-hidden="true">${escapeTeamHtml(name.charAt(0))}</span>`;
}

function userInSet(user, setName) {
  if (user.committeeMemberships && Array.isArray(user.committeeMemberships)) {
    return user.committeeMemberships.some((m) => m.set === setName);
  }
  return user.committeeSet === setName;
}

function userInBoard(user, setName, board) {
  if (user.committeeMemberships && Array.isArray(user.committeeMemberships)) {
    return user.committeeMemberships.some(
      (m) => m.set === setName && m.group === board
    );
  }
  return user.committeeSet === setName && user.committeeGroup === board;
}

function getMembership(user, setName, board) {
  if (user.committeeMemberships && Array.isArray(user.committeeMemberships)) {
    return user.committeeMemberships.find(
      (m) => m.set === setName && m.group === board
    );
  }
  if (user.committeeSet === setName && user.committeeGroup === board) {
    return {
      position: user.committeePosition || 'กรรมการ',
      order: user.order || 999
    };
  }
  return null;
}

function isExpiredTerm(user) {
  if (!user.termEndDate) return false;
  const end = new Date(user.termEndDate);
  return !Number.isNaN(end.getTime()) && end < new Date();
}

function renderTeamMetaHtml(selectedSet, fiscalYear) {
  const setNum =
    String(selectedSet)
      .replace(/^ชุดที่\s*/i, '')
      .trim() || selectedSet;
  const yearBlock = fiscalYear
    ? `<span class="kb-team-meta-divider" aria-hidden="true"></span>
    <div class="kb-team-meta-item kb-team-meta-item--year">
      <span class="kb-team-meta-kicker">ประจำปี</span>
      <span class="kb-team-meta-value">${escapeTeamHtml(fiscalYear)}</span>
    </div>`
    : '';
  return `<div class="kb-team-meta-premium">
  <div class="kb-team-meta-item">
    <span class="kb-team-meta-kicker">ชุดกรรมการ</span>
    <span class="kb-team-meta-value">ที่ ${escapeTeamHtml(setNum)}</span>
  </div>
  ${yearBlock}
</div>`;
}

function sortMembers(members, positionOrder) {
  return members.slice().sort((a, b) => {
    const posA = positionOrder.indexOf(a._boardPosition);
    const posB = positionOrder.indexOf(b._boardPosition);
    const ia = posA === -1 ? 999 : posA;
    const ib = posB === -1 ? 999 : posB;
    if (ia !== ib) return ia - ib;
    return (a._order || 999) - (b._order || 999);
  });
}

function renderMemberCard(member, opts) {
  const large = opts && opts.large;
  const cls = large ? 'kb-team-card kb-team-card--chair' : 'kb-team-card';
  const expired = isExpiredTerm(member);
  return `
<article class="${cls}">
  <div class="kb-team-card-photo">
    ${teamAvatarHtml(member)}
    <span class="kb-team-card-fallback"${member.avatar ? ' hidden' : ''}>${teamAvatarFallback(member)}</span>
  </div>
  <h4 class="kb-team-card-name">${escapeTeamHtml(member.fullname || 'ไม่ระบุ')}</h4>
  <p class="kb-team-card-role">${escapeTeamHtml(member._boardPosition || 'กรรมการ')}</p>
  ${expired ? '<span class="kb-team-card-badge">หมดวาระ</span>' : ''}
</article>`;
}

function renderTeamChart(state) {
  const { org, users, selectedSet, selectedBoard } = state;
  const positionOrder = org.committeePositions || [
    'ประธานกรรมการ',
    'รองประธานกรรมการ',
    'กรรมการ'
  ];
  const setData = (org.committeeSetsData || []).find((s) => s.name === selectedSet);
  const fiscalYear = setData?.fiscalYear || '';
  const boardKey = `${selectedSet}_${selectedBoard}`;
  const customLayout = (org.chartLayouts || {})[boardKey];

  let members = users
    .filter((u) => u.group === 'กรรมการ' && userInSet(u, selectedSet))
    .filter((u) => userInBoard(u, selectedSet, selectedBoard))
    .map((u) => {
      const m = getMembership(u, selectedSet, selectedBoard);
      return {
        ...u,
        _boardPosition: m?.position || u.committeePosition || 'กรรมการ',
        _order: m?.order ?? u.order ?? 999
      };
    });

  members = sortMembers(members, positionOrder);

  if (!members.length) {
    return `<div class="kb-team-empty">
  <p>ยังไม่มีข้อมูลกรรมการในคณะนี้</p>
  <p class="kb-team-empty-sub">${escapeTeamHtml(selectedBoard)} · ${escapeTeamHtml(selectedSet)}</p>
</div>`;
  }

  let html = `<div class="kb-team-tree">
<header class="kb-team-chart-head">
  <h3 class="kb-team-chart-head-title">${escapeTeamHtml(selectedBoard)}</h3>
  <div class="kb-team-chart-head-meta">${renderTeamMetaHtml(selectedSet, fiscalYear)}</div>
</header>`;

  if (customLayout && customLayout !== 'auto') {
    const rowCounts = customLayout
      .split(',')
      .map((n) => parseInt(n.trim(), 10))
      .filter((n) => !Number.isNaN(n));
    let idx = 0;
    rowCounts.forEach((count, rowIdx) => {
      const row = members.slice(idx, idx + count);
      idx += count;
      if (!row.length) return;
      if (rowIdx === 0 && count === 1) {
        html += `<div class="kb-team-row kb-team-row--chair">${renderMemberCard(row[0], { large: true })}</div>`;
        if (idx < members.length) html += '<div class="kb-team-connector" aria-hidden="true"></div>';
      } else {
        html += `<div class="kb-team-row kb-team-row--grid">${row.map((m) => renderMemberCard(m)).join('')}</div>`;
        if (idx < members.length) html += '<div class="kb-team-connector" aria-hidden="true"></div>';
      }
    });
    if (idx < members.length) {
      html += `<div class="kb-team-row kb-team-row--grid">${members
        .slice(idx)
        .map((m) => renderMemberCard(m))
        .join('')}</div>`;
    }
  } else {
    const chairman = members.find(
      (u) => positionOrder.indexOf(u._boardPosition) === 0
    );
    const vice = members.filter(
      (u) => positionOrder.indexOf(u._boardPosition) === 1
    );
    const others = members.filter((u) => {
      const i = positionOrder.indexOf(u._boardPosition);
      return i !== 0 && i !== 1;
    });

    if (chairman) {
      html += `<div class="kb-team-row kb-team-row--chair">${renderMemberCard(chairman, { large: true })}</div>`;
      if (vice.length || others.length) {
        html += '<div class="kb-team-connector" aria-hidden="true"></div>';
      }
    }
    if (vice.length) {
      html += `<div class="kb-team-row kb-team-row--grid">${vice.map((m) => renderMemberCard(m)).join('')}</div>`;
      if (others.length) html += '<div class="kb-team-connector" aria-hidden="true"></div>';
    }
    if (others.length) {
      html += `<div class="kb-team-row kb-team-row--grid">${others.map((m) => renderMemberCard(m)).join('')}</div>`;
    }
  }

  html += '</div>';
  return html;
}

function renderTeamShell(state) {
  const boards = state.org.committeeGroups || [];
  const boardTabs = boards
    .map((b) => {
      const active = b === state.selectedBoard;
      return `<button type="button" role="tab" class="kb-team-board-tab${active ? ' is-active' : ''}" data-board="${escapeTeamHtml(b)}" aria-selected="${active ? 'true' : 'false'}">${escapeTeamHtml(b)}</button>`;
    })
    .join('');

  return `
<div class="kb-page-body kb-page-body--team">
  <div class="kb-container">
    <nav class="kb-team-nav" aria-label="เลือกคณะกรรมการ">
      <div class="kb-team-board-tabs" role="tablist">${boardTabs}</div>
    </nav>
    <div class="kb-team-chart-wrap" id="kb-team-chart">${renderTeamChart(state)}</div>
  </div>
</div>`;
}

async function fetchCommitteeData() {
  const [orgSnap, usersSnap] = await Promise.all([
    db.collection('config').doc('org').get(),
    db.collection('users').where('group', '==', 'กรรมการ').get()
  ]);
  const org = orgSnap.exists ? orgSnap.data() : {};
  const users = usersSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
  if (!org.committeeSetsData && org.committeeSets) {
    org.committeeSetsData = org.committeeSets.map((name) => ({ name }));
  }
  return { org, users };
}

/** ชุดวาระที่ใช้งาน — ตามวันที่ใน admin หรือชุดล่าสุด (เดียวกับค่าเริ่มต้นใน #committeestructure) */
function pickActiveCommitteeSet(org) {
  const sets = org.committeeSetsData || [];
  if (!sets.length) {
    const names = org.committeeSets || [];
    return names[names.length - 1] || '';
  }
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const inTerm = sets.find((s) => {
    const start = s.startDate ? new Date(s.startDate) : null;
    const end = s.endDate ? new Date(s.endDate) : null;
    if (start && !Number.isNaN(start.getTime()) && today < start) return false;
    if (end && !Number.isNaN(end.getTime())) {
      end.setHours(23, 59, 59, 999);
      if (today > end) return false;
    }
    return !!(s.startDate || s.endDate);
  });
  if (inTerm) return inTerm.name;
  return sets[sets.length - 1].name;
}

function bindTeamPage(root, getState, rerender) {
  root.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-board]');
    if (!btn) return;
    const st = getState();
    st.selectedBoard = btn.getAttribute('data-board');
    rerender();
  });
}

async function initTeamPage(main) {
  const { org, users } = await fetchCommitteeData();
  const boards = org.committeeGroups || [];
  const state = {
    org,
    users,
    selectedSet: pickActiveCommitteeSet(org),
    selectedBoard: boards[0] || ''
  };

  const paint = () => {
    main.innerHTML = renderTeamShell(state);
  };
  paint();
  bindTeamPage(main, () => state, paint);
}

window.CmsTeamPage = {
  PAGE_ID: CMS_TEAM_PAGE_ID,
  initTeamPage
};
