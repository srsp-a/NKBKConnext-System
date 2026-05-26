/**
 * ทำเนียบเจ้าหน้าที่ + กรรมการ — sync กับ /management และ /team
 */
const DEFAULT_INTERNAL_PHONE = '042-420750';
const MAX_STAFF_CARDS = 4;
const MAX_CONTEXT_PEOPLE = 80;

const COMMITTEE_ROLE_QUERIES = [
  { re: /รองประธาน(?:กรรมการ)?/, match: (role) => /รองประธาน/.test(role) },
  { re: /(?:^|\s)กรรมการ(?:\s|$)/, match: (role) => /กรรมการ/.test(role) && !/ประธาน/.test(role) }
];

function isChairmanQuery(messageNorm) {
  if (/รองประธาน/.test(messageNorm)) return false;
  return (
    /ใคร(?:เป็น|คือ).{0,24}ประธาน/.test(messageNorm) ||
    /(?:^|\s|[\sเป็น])ประธาน(?:กรรมการ)?(?:ครับ|ค่ะ)?(?:\s|$|\?)/.test(messageNorm) ||
    /^ประธาน(?:กรรมการ)?(?:ครับ|ค่ะ)?$/.test(messageNorm.trim())
  );
}

function isViceChairmanQuery(messageNorm) {
  return /รองประธาน(?:กรรมการ)?/.test(messageNorm);
}

function isCommitteeContactQuery(message) {
  const messageNorm = normText(message);
  if (isChairmanQuery(messageNorm) || isViceChairmanQuery(messageNorm)) return true;
  return /(?:คณะ)?กรรมการ|คณะทำงาน|\/team\b|committee/i.test(messageNorm);
}

function escHtml(s) {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function pickActiveCommitteeSet(org) {
  const sets = (org && org.committeeSetsData) || [];
  if (!sets.length) {
    const names = (org && org.committeeSets) || [];
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

function userInCommitteeSet(user, setName) {
  if (user.committeeMemberships && Array.isArray(user.committeeMemberships)) {
    return user.committeeMemberships.some((m) => m.set === setName);
  }
  return user.committeeSet === setName;
}

function getCommitteeRole(user, activeSet) {
  if (user.committeeMemberships && Array.isArray(user.committeeMemberships)) {
    const m = user.committeeMemberships.find((x) => x.set === activeSet);
    if (m && m.position) return m.position;
  }
  return user.committeePosition || 'กรรมการ';
}

function isActiveUser(user) {
  const status = String((user && user.status) || 'ปกติ').trim();
  return status !== 'ระงับ' && status !== 'inactive' && status !== 'ลาออก';
}

function positionJob(user) {
  const pos = String((user && user.position) || '').trim();
  const job = String((user && user.job) || '').trim();
  if (!job || job === 'งานทั้งหมด' || pos.includes(job)) return pos;
  return `${pos} ${job}`.trim();
}

function parseInternalPhoneFields(user) {
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
  if (!phone) phone = DEFAULT_INTERNAL_PHONE;
  if (ext.startsWith('กด')) ext = ext.replace(/^กด\s*/, '').trim();
  if (!ext) return phone;
  return `${phone} กด ${ext}`;
}

function shouldShowInternalPhone(user) {
  if (!user || typeof user !== 'object') return false;
  if (user.group === 'กรรมการ') return user.showInternalPhoneOnTeam === true;
  return true;
}

function normalizeStaffRecord(user, kind, extra) {
  const u = user && typeof user === 'object' ? user : {};
  const mobile = String(u.phone || '').trim();
  const internal = shouldShowInternalPhone(u) ? parseInternalPhoneFields(u) : '';
  const avatar = String(u.avatar || u.userAvatar || u.lineAvatar || '').trim();
  const role =
    kind === 'committee'
      ? String((extra && extra.committeeRole) || getCommitteeRole(u, extra && extra.activeSet) || 'กรรมการ')
      : positionJob(u) || String(u.position || 'เจ้าหน้าที่').trim();
  return {
    id: String(u.id || u._firestoreDocId || u.uid || ''),
    fullname: String(u.fullname || 'ไม่ระบุ').trim(),
    role,
    department: String(u.department || '').trim(),
    group: kind === 'committee' ? 'กรรมการ' : 'เจ้าหน้าที่',
    mobile,
    internal,
    avatar,
    avatarPosition: String(u.avatarPosition || 'center center').trim(),
    order: Number(u.order) || 999
  };
}

async function loadMemberStaffDirectory(db, orgInput) {
  let org = orgInput && typeof orgInput === 'object' ? orgInput : {};
  if (!org.committeeSets && db) {
    try {
      const orgSnap = await db.collection('config').doc('org').get();
      org = orgSnap.exists ? orgSnap.data() || {} : org;
    } catch (_) {
      /* ignore */
    }
  }

  const activeSet = pickActiveCommitteeSet(org);
  let staffDocs = [];
  let committeeDocs = [];
  if (db) {
    try {
      const [staffSnap, committeeSnap] = await Promise.all([
        db.collection('users').where('group', '==', 'เจ้าหน้าที่').get(),
        db.collection('users').where('group', '==', 'กรรมการ').get()
      ]);
      staffDocs = staffSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
      committeeDocs = committeeSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
    } catch (e) {
      console.warn('[member-staff] load users:', e.message);
    }
  }

  const staff = staffDocs
    .filter(isActiveUser)
    .map((u) => normalizeStaffRecord(u, 'staff'))
    .sort((a, b) => a.order - b.order || a.fullname.localeCompare(b.fullname, 'th'));

  const committee = committeeDocs
    .filter(isActiveUser)
    .filter((u) => userInCommitteeSet(u, activeSet))
    .map((u) => normalizeStaffRecord(u, 'committee', { activeSet, committeeRole: getCommitteeRole(u, activeSet) }))
    .sort((a, b) => a.order - b.order || a.fullname.localeCompare(b.fullname, 'th'));

  return { staff, committee, activeSet, all: staff.concat(committee) };
}

function buildMemberStaffContextLines(directory) {
  const dir = directory && typeof directory === 'object' ? directory : { staff: [], committee: [], all: [] };
  const lines = [
    'ข้อมูลเดียวกับหน้า [ทำเนียบฝ่ายจัดการ](/management) และ [คณะกรรมการ](/team)',
    'เมื่อถามติดต่อเจ้าหน้าที่/ฝ่าย/กรรมการ/ประธาน ให้ตอบสั้นๆ 1 ประโยง — ระบบจะแสดงการ์ดรูป ชื่อ ตำแหน่ง เบอร์โทรให้ ห้ามปฏิเสธว่าไม่เปิดเผยรายชื่อ',
    'ห้ามพิมพ์ชื่อ-เบอร์ยาวซ้ำในข้อความ — ให้ระบบแสดงการ์ดแทน'
  ];
  if (dir.activeSet) lines.push(`กรรมการชุดปัจจุบัน: ${dir.activeSet}`);

  const people = (dir.all || []).slice(0, MAX_CONTEXT_PEOPLE);
  people.forEach((p) => {
    const bits = [p.fullname, p.role];
    if (p.mobile) bits.push(`มือถือ ${p.mobile}`);
    if (p.internal) bits.push(`ภายใน ${p.internal}`);
    lines.push(`- ${bits.join(' | ')}`);
  });
  if ((dir.all || []).length > MAX_CONTEXT_PEOPLE) {
    lines.push(`- … และอีก ${dir.all.length - MAX_CONTEXT_PEOPLE} คน`);
  }
  return lines;
}

function normText(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function compactText(s) {
  return normText(s).replace(/\s/g, '');
}

function extractStaffRoleQuery(message) {
  const raw = String(message || '').trim();
  const staffMatch = raw.match(/เจ้าหน้าที่\s+(.+)/i);
  if (staffMatch && staffMatch[1]) return normText(staffMatch[1]);
  return '';
}

function extractDeptQuery(message) {
  const raw = String(message || '').trim();
  const deptMatch = raw.match(/ฝ่าย\s+(.+)/i);
  if (deptMatch && deptMatch[1]) return normText(deptMatch[1]);
  return '';
}

function scoreRoleQueryMatch(personRole, roleQuery) {
  const role = normText(personRole);
  const query = normText(roleQuery);
  if (!query || !role) return 0;
  if (role === query || role.includes(query) || query.includes(role)) return 200;
  const tokens = query.split(/\s+/).filter((w) => w.length >= 3);
  if (!tokens.length) return 0;
  const hits = tokens.filter((t) => role.includes(t)).length;
  if (hits === tokens.length) return 180;
  if (hits >= Math.max(2, Math.ceil(tokens.length * 0.75))) return 140;
  return 0;
}

function scoreCommitteeRoleQuery(messageNorm, person) {
  if (person.group !== 'กรรมการ') return 0;
  const role = normText(person.role);
  if (isChairmanQuery(messageNorm)) {
    return role.includes('ประธาน') && !role.includes('รอง') ? 200 : 0;
  }
  if (isViceChairmanQuery(messageNorm)) {
    return role.includes('รองประธาน') ? 200 : 0;
  }
  for (const item of COMMITTEE_ROLE_QUERIES) {
    if (item.re.test(messageNorm) && item.match(role)) return 160;
  }
  return 0;
}

function findCommitteeDirectMatch(directory, messageNorm) {
  const committee = (directory && directory.committee) || [];
  if (isChairmanQuery(messageNorm)) {
    const chair = committee.find((p) => {
      const role = normText(p.role);
      return role.includes('ประธาน') && !role.includes('รอง');
    });
    if (chair) return [chair];
  }
  if (isViceChairmanQuery(messageNorm)) {
    const vice = committee.filter((p) => normText(p.role).includes('รองประธาน'));
    if (vice.length) return vice.slice(0, MAX_STAFF_CARDS);
  }
  return [];
}

function pickStaffFromReplyName(reply, directory) {
  const compact = compactText(reply);
  if (!compact || compact.length < 6) return [];
  const hits = (directory.all || []).filter((p) => {
    const nc = compactText(p.fullname);
    return nc.length >= 6 && compact.includes(nc);
  });
  if (!hits.length) return [];
  hits.sort((a, b) => compactText(b.fullname).length - compactText(a.fullname).length);
  return [hits[0]];
}

function scoreStaffPerson(person, messageNorm, messageCompact, roleQuery, deptQuery) {
  const nameCompact = compactText(person.fullname || '');
  if (nameCompact.length >= 4 && messageCompact.includes(nameCompact)) return 220;

  if (roleQuery) {
    return person.group === 'เจ้าหน้าที่' ? scoreRoleQueryMatch(person.role, roleQuery) : 0;
  }

  const committeeScore = scoreCommitteeRoleQuery(messageNorm, person);
  if (committeeScore) return committeeScore;

  if (deptQuery && person.department) {
    const deptNorm = normText(person.department);
    if (deptNorm.includes(deptQuery) || deptQuery.includes(deptNorm)) return 120;
    const tokens = deptQuery.split(/\s+/).filter((w) => w.length >= 3);
    const hits = tokens.filter((t) => deptNorm.includes(t)).length;
    if (hits >= Math.max(1, Math.ceil(tokens.length * 0.6))) return 90 + hits * 5;
  }

  let score = 0;
  const role = normText(person.role);
  if (role && messageNorm.includes(role)) score += 80;

  const dept = person.department || '';
  if (dept) {
    const deptNorm = normText(dept);
    if (messageNorm.includes(deptNorm)) score += 70;
  }

  if (/ผู้จัดการ|ผู้บริหาร|ทำเนียบ/i.test(messageNorm) && /ผู้จัดการ|รองผู้จัดการ/.test(person.role || '')) {
    score += 50;
  }

  return score;
}

function isStaffContactIntent(message, directory) {
  const m = String(message || '');
  const messageNorm = normText(m);
  if (isChairmanQuery(messageNorm) || isViceChairmanQuery(messageNorm) || isCommitteeContactQuery(m)) {
    return true;
  }
  if (
    /(?:ติดต่อ|โทร(?:หา|ติด)?|สอบถาม|ขอ(?:คุย|พูด)|หา|แนะนำ).{0,24}(?:เจ้าหน้าที่|ฝ่าย|หัวหน้า|ผู้จัดการ|กรรมการ|ประธาน)/i.test(m) ||
    /(?:เจ้าหน้าที่|ฝ่าย|หัวหน้า|ผู้จัดการ|กรรมการ|ทำเนียบ|คณะ(?:กรรม|ทำงาน)|ประธาน|รองประธาน).{0,30}(?:ติดต่อ|โทร|ใคร|คือใคร|เบอร์)/i.test(m) ||
    /ใคร(?:เป็น|คือ).{0,24}(?:ประธาน|กรรมการ)/i.test(m) ||
    /เจ้าหน้าที่\s+\S+/i.test(m) ||
    /ฝ่าย\s+\S+/i.test(m)
  ) {
    return true;
  }
  const compact = compactText(m);
  return (directory.all || []).some((p) => {
    const name = compactText(p.fullname);
    return name.length >= 4 && compact.includes(name);
  });
}

function pickStaffMatches(message, directory, limit) {
  const dir = directory && typeof directory === 'object' ? directory : { all: [] };
  const messageNorm = normText(message);
  const messageCompact = compactText(message);
  const roleQuery = extractStaffRoleQuery(message);
  const deptQuery = extractDeptQuery(message);
  const max = limit || MAX_STAFF_CARDS;

  const directCommittee = findCommitteeDirectMatch(dir, messageNorm);
  if (directCommittee.length) return directCommittee;

  const scored = (dir.all || [])
    .map((p) => ({
      person: p,
      score: scoreStaffPerson(p, messageNorm, messageCompact, roleQuery, deptQuery)
    }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score || a.person.order - b.person.order);

  if (!scored.length) return [];

  const top = scored[0];
  const second = scored[1];

  if (roleQuery || scoreCommitteeRoleQuery(messageNorm, top.person) || top.score >= 140) {
    if (!second || top.score - second.score >= 20) return [top.person];
  }

  if (deptQuery && !roleQuery) {
    const deptNorm = normText(deptQuery);
    const deptMatches = scored
      .filter((x) => {
        const d = normText(x.person.department || '');
        return d.includes(deptNorm) || deptNorm.includes(d);
      })
      .map((x) => x.person);
    if (deptMatches.length) return deptMatches.slice(0, max);
  }

  if (top.score - (second?.score || 0) >= 40) return [top.person];

  const picked = [];
  const seen = new Set();
  for (const item of scored) {
    if (picked.length >= max) break;
    if (item.score < top.score - 25) break;
    const id = item.person.id || item.person.fullname;
    if (seen.has(id)) continue;
    seen.add(id);
    picked.push(item.person);
  }
  return picked.length ? picked : [top.person];
}

function staffAvatarHtml(person) {
  const name = person.fullname || 'U';
  const pos = escHtml(person.avatarPosition || 'center center');
  if (person.avatar) {
    return `<img src="${escHtml(person.avatar)}" alt="" class="kb-chat-staff-img" style="object-position:${pos}" loading="lazy" onerror="this.remove();this.parentElement.classList.add('kb-chat-staff-photo--fallback');this.parentElement.textContent='${escHtml(name.charAt(0))}';">`;
  }
  return `<span class="kb-chat-staff-initial" aria-hidden="true">${escHtml(name.charAt(0))}</span>`;
}

function buildStaffCardHtml(person) {
  const mobileRow = person.mobile
    ? `<div class="kb-chat-staff-row"><span class="kb-chat-staff-label">โทรศัพท์</span><a class="kb-chat-staff-value kb-chat-staff-link" href="tel:${escHtml(String(person.mobile).replace(/[^\d+]/g, ''))}">${escHtml(person.mobile)}</a></div>`
    : '';
  const internalRow = person.internal
    ? `<div class="kb-chat-staff-row"><span class="kb-chat-staff-label">เบอร์โทร</span><span class="kb-chat-staff-value">${escHtml(person.internal)}</span></div>`
    : '';
  return (
    '<article class="kb-chat-staff-card">' +
    `<div class="kb-chat-staff-photo">${staffAvatarHtml(person)}</div>` +
    '<div class="kb-chat-staff-body">' +
    `<h4 class="kb-chat-staff-name">${escHtml(person.fullname)}</h4>` +
    `<p class="kb-chat-staff-role">${escHtml(person.role)}</p>` +
    `<div class="kb-chat-staff-contact">${mobileRow}${internalRow}</div>` +
    '</div></article>'
  );
}

function buildMemberStaffCardsHtml(matches) {
  if (!matches || !matches.length) return '';
  const cards = matches.map(buildStaffCardHtml).join('');
  return `<div class="kb-chat-staff-wrap"><div class="kb-chat-staff-grid">${cards}</div></div>`;
}

function stripStaffDetailsFromReply(text, matches) {
  let s = String(text || '');
  s = s.replace(/ขออภัย[^.]*?ไม่สามารถเปิดเผย[^.]*?(?:ค่ะ|ครับ|\.)/gi, '');
  s = s.replace(/(?:โทร\.?|โทรศัพท์|ติดต่อสหกรณ์)\s*0[\d\-]{8,}[^\n.]*/gi, '');
  s = s.replace(/(?:คือ|ได้แก่)\s+[^\n.]{4,80}(?:ค่ะ|ครับ)/gi, '');
  (matches || []).forEach((p) => {
    if (!p.fullname) return;
    const ep = p.fullname.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    s = s.replace(new RegExp(ep, 'g'), '');
  });
  s = s.replace(/\s{2,}/g, ' ').replace(/\s+([,.])/g, '$1').trim();
  return s;
}

function fixCommitteeReplyLinks(text) {
  let s = String(text || '');
  s = s.replace(/\[ผู้บริหาร\]\(\/management\)/g, '[คณะกรรมการ](/team)');
  s = s.replace(/(?:ดู(?:ข้อมูล)?(?:ประธาน|กรรมการ)[^[]]{0,40}?(?:ที่|ได้ที่))\s*(?:\[)?ผู้บริหาร(?:\]\(\/management\))?/gi, '$1 [คณะกรรมการ](/team)');
  s = s.replace(/(?:หน้า|ที่)\s*(?:\[)?ผู้บริหาร(?:\]\(\/management\))?/gi, 'ที่ [คณะกรรมการ](/team)');
  return s.replace(/\s{2,}/g, ' ').trim();
}

function buildStaffCardReplyIntro(matches, message) {
  const committee = isCommitteeContactQuery(message) || (matches[0] && matches[0].group === 'กรรมการ');
  if (!matches || !matches.length) return '';
  if (matches.length === 1) {
    const p = matches[0];
    return `ข้อมูล${p.role || (committee ? 'กรรมการ' : 'เจ้าหน้าที่')} มีดังนี้ค่ะ`;
  }
  return committee ? 'ข้อมูลกรรมการที่เกี่ยวข้องมีดังนี้ค่ะ' : 'ข้อมูลที่เกี่ยวข้องมีดังนี้ค่ะ';
}

function staffCardFooterLink(matches, message) {
  const committee =
    isCommitteeContactQuery(message) || (matches && matches.every((p) => p.group === 'กรรมการ'));
  if (committee) return ' ดูเพิ่มเติมได้ที่ [คณะกรรมการ](/team)';
  if (matches && matches.length === 1) return ' ดูเพิ่มเติมได้ที่ [ทำเนียบฝ่ายจัดการ](/management)';
  return ' ดูทั้งหมดได้ที่ [ทำเนียบฝ่ายจัดการ](/management) หรือ [คณะกรรมการ](/team)';
}

module.exports = {
  loadMemberStaffDirectory,
  buildMemberStaffContextLines,
  isStaffContactIntent,
  isCommitteeContactQuery,
  pickStaffMatches,
  pickStaffFromReplyName,
  buildMemberStaffCardsHtml,
  stripStaffDetailsFromReply,
  buildStaffCardReplyIntro,
  staffCardFooterLink,
  fixCommitteeReplyLinks
};
