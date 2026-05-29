/**
 * ตรวจสอบความพร้อมติดต่อเจ้าหน้าที่ผ่านแชตโมเน่
 * — เวลาทำการ, วันหยุดสหกรณ์, การลางาน
 */
const memberStaff = require('./member-staff');
const staffContactPrompts = require('./staff-contact-prompts');
const staffContactLinks = require('./staff-contact-links');

const CMS_CONTACT_DEFAULTS = { hoursTh: 'จันทร์–ศุกร์ 08:30–16:30 น.' };

function bangkokNow() {
  return new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Bangkok' }));
}

function todayYmdBangkok() {
  const d = bangkokNow();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return y + '-' + m + '-' + day;
}

function normalizeCoopTimeDot(value, fallback) {
  const raw = value != null ? String(value).trim() : '';
  if (!raw) return fallback;
  return raw.replace(':', '.');
}

function parseTimeToMinutes(dotTime) {
  const m = String(dotTime || '').trim().match(/^(\d{1,2})\.(\d{2})$/);
  if (!m) return null;
  return parseInt(m[1], 10) * 60 + parseInt(m[2], 10);
}

function loadStaticHolidaySet() {
  try {
    const list = require('../thai-public-holidays.json');
    if (!Array.isArray(list)) return new Set();
    return new Set(list.filter((h) => h && h.date).map((h) => String(h.date).trim()));
  } catch (_) {
    return new Set();
  }
}

async function loadOrgConfig(db) {
  let org = {};
  let cmsSite = {};
  try {
    const snap = await db.collection('config').doc('org').get();
    org = snap.exists ? snap.data() || {} : {};
  } catch (_) {}
  try {
    const snap = await db.collection('cms_site').doc('settings').get();
    cmsSite = snap.exists ? snap.data() || {} : {};
  } catch (_) {}
  const merged = { ...org, ...cmsSite, contact: { ...(org.contact || {}), ...(cmsSite.contact || {}) } };
  const start = normalizeCoopTimeDot(merged.attendanceWorkStart, '08.30');
  const end = normalizeCoopTimeDot(merged.attendanceWorkEnd, '16.30');
  const hoursLabel = (merged.contact && merged.contact.hoursTh) || CMS_CONTACT_DEFAULTS.hoursTh;
  return { start, end, hoursLabel };
}

async function loadHolidayContext(db, todayStr) {
  let holidays = [];
  try {
    const snap = await db.collection('holidays').get();
    holidays = snap.docs.map((d) => ({ id: d.id, ...(d.data() || {}) }));
  } catch (_) {}
  const coopOpenDates = new Set(
    holidays.filter((h) => h.hidden === true && h.date).map((h) => String(h.date).trim())
  );
  const staticSet = loadStaticHolidaySet();
  let isHoliday = staticSet.has(todayStr);
  const firestoreHoliday = holidays.find((h) => h.date && h.hidden !== true && String(h.date).trim() === todayStr);
  if (firestoreHoliday) isHoliday = true;
  if (coopOpenDates.has(todayStr)) isHoliday = false;
  const holidayName = firestoreHoliday
    ? String(firestoreHoliday.nameTH || firestoreHoliday.name || 'วันหยุด').trim()
    : '';
  return { isHoliday, holidayName };
}

async function isStaffOnLeaveToday(db, staffId, todayStr) {
  if (!staffId) return false;
  try {
    const snap = await db.collection('leaves').where('userId', '==', staffId).limit(50).get();
    return snap.docs.some((d) => {
      const l = d.data() || {};
      if (String(l.status || '').toLowerCase() !== 'approved') return false;
      const start = String(l.startDate || '').trim();
      const end = String(l.endDate || l.startDate || '').trim();
      if (!start) return false;
      return todayStr >= start && todayStr <= end;
    });
  } catch (_) {
    return false;
  }
}

async function resolveStaffPerson(db, staffId) {
  const id = String(staffId || '').trim();
  if (!id) return null;
  try {
    const doc = await db.collection('users').doc(id).get();
    if (doc.exists) {
      const data = doc.data() || {};
      if (data.group && data.group !== 'เจ้าหน้าที่') return null;
      return {
        id: doc.id,
        fullname: String(data.fullname || data.name || '').trim(),
        nickname: String(data.nickname || '').trim(),
        department: String(data.department || '').trim(),
        job: String(data.job || '').trim(),
        position: String(data.position || '').trim(),
        role: String(data.job || data.position || '').trim(),
        avatar: String(data.avatar || '').trim(),
        avatarPosition: String(data.avatarPosition || 'center center').trim(),
        contactQuickPrompts: Array.isArray(data.contactQuickPrompts) ? data.contactQuickPrompts : [],
        contactShortCode: String(data.contactShortCode || '').trim().toLowerCase()
      };
    }
  } catch (_) {}
  const dir = await memberStaff.loadMemberStaffDirectory(db);
  const all = (dir && dir.all) || [];
  return all.find((p) => String(p.id) === id) || null;
}

function buildPrefill(contactTitle) {
  const title = contactTitle || 'เจ้าหน้าที่';
  return 'สวัสดีครับ/ค่ะ ต้องการติดต่อ' + title + ' เรื่อง ';
}

function buildVisitorMessages(contactTitle, hours, reason, holidayName) {
  const title = contactTitle || 'เจ้าหน้าที่';
  const hoursLabel = hours.hoursLabel;
  const start = hours.start;
  const end = hours.end;

  if (reason === 'on_leave') {
    return {
      intro:
        'สวัสดีค่ะ **' +
        title +
        '** ลางานในวันนี้ค่ะ\n\n' +
        'คุณสามารถ **ฝากข้อความ** ไว้ได้เลย — ระบบจะส่งถึงเจ้าหน้าที่ และจะมีการติดต่อกลับใน **เวลาทำการ** ถัดไป (' +
        hoursLabel +
        ')\n\n' +
        'กรุณาพิมพ์เรื่องที่ต้องการติดต่อด้านล่าง แล้วกดส่งค่ะ',
      ack:
        'ได้รับข้อความฝากถึง' +
        title +
        ' แล้วค่ะ (เจ้าหน้าที่ลางานวันนี้) — จะมีการติดต่อกลับในเวลาทำการถัดไป (' +
        hoursLabel +
        ') ขอบคุณที่รอค่ะ'
    };
  }
  if (reason === 'holiday') {
    const hol = holidayName ? ' (' + holidayName + ')' : '';
    return {
      intro:
        'สวัสดีค่ะ วันนี้สหกรณ์ **หยุดทำการ**' +
        hol +
        ' ค่ะ\n\n' +
        'คุณสามารถ **ฝากข้อความ** ถึง **' +
        title +
        '** ได้เลย — เจ้าหน้าที่จะติดต่อกลับใน **วันและเวลาทำการ** ถัดไป (' +
        hoursLabel +
        ')\n\n' +
        'กรุณาพิมพ์เรื่องที่ต้องการติดต่อ แล้วกดส่งค่ะ',
      ack:
        'ได้รับข้อความฝากถึง' +
        title +
        ' แล้วค่ะ (วันหยุดสหกรณ์) — จะติดต่อกลับในเวลาทำการถัดไป (' +
        hoursLabel +
        ') ขอบคุณค่ะ'
    };
  }
  if (reason === 'weekend') {
    return {
      intro:
        'สวัสดีค่ะ วันนี้เป็นวัน **เสาร์–อาทิตย์** สหกรณ์หยุดทำการค่ะ\n\n' +
        'คุณสามารถ **ฝากข้อความ** ถึง **' +
        title +
        '** ได้เลย — เจ้าหน้าที่จะติดต่อกลับ **วันจันทร์–ศุกร์** ' +
        start +
        '–' +
        end +
        ' น.\n\n' +
        'กรุณาพิมพ์เรื่องที่ต้องการติดต่อ แล้วกดส่งค่ะ',
      ack:
        'ได้รับข้อความฝากถึง' +
        title +
        ' แล้วค่ะ (นอกวันทำการ) — จะติดต่อกลับวันจันทร์–ศุกร์ ' +
        start +
        '–' +
        end +
        ' น. ขอบคุณค่ะ'
    };
  }
  if (reason === 'after_hours') {
    return {
      intro:
        'สวัสดีค่ะ ขณะนี้อยู่ **นอกเวลาทำการ** สหกรณ์ (' +
        hoursLabel +
        ') ค่ะ\n\n' +
        'คุณสามารถ **ฝากข้อความ** ถึง **' +
        title +
        '** ได้เลย — เจ้าหน้าที่จะติดต่อกลับในเวลาทำการถัดไป\n\n' +
        'กรุณาพิมพ์เรื่องที่ต้องการติดต่อ แล้วกดส่งค่ะ',
      ack:
        'ได้รับข้อความฝากถึง' +
        title +
        ' แล้วค่ะ (นอกเวลาทำการ) — จะติดต่อกลับในเวลาทำการ (' +
        hoursLabel +
        ') ขอบคุณค่ะ'
    };
  }
  return {
    intro:
      'สวัสดีค่ะ ต้องการติดต่อ **' +
      title +
      '** ใช่ไหมคะ\n\n' +
      'เจ้าหน้าที่พร้อมรับข้อความในเวลาทำการ — กรุณาพิมพ์เรื่องที่ต้องการสอบถาม แล้วกดส่ง ระบบจะแจ้งเจ้าหน้าที่ให้ตอบกลับในแชทนี้ค่ะ',
    introBody:
      'เจ้าหน้าที่พร้อมรับข้อความในเวลาทำการ — กรุณาพิมพ์เรื่องที่ต้องการสอบถาม แล้วกดส่ง ระบบจะแจ้งเจ้าหน้าที่ให้ตอบกลับในแชทนี้ค่ะ',
    ack: ''
  };
}

function buildAvailabilityPayload(staff, hours, reason, extra) {
  const contactTitle = staffContactPrompts.staffContactTitle(staff);
  const msgs = buildVisitorMessages(contactTitle, hours, reason, extra && extra.holidayName);
  const quickPrompts = staffContactPrompts.resolveQuickPrompts(staff);
  const introBody =
    msgs.introBody ||
    (msgs.intro && String(msgs.intro).includes('\n\n')
      ? String(msgs.intro).split('\n\n').slice(1).join('\n\n')
      : '');
  return {
    ok: true,
    staff: {
      id: staff.id,
      name: staffContactPrompts.staffDisplayName(staff),
      contactTitle,
      role: contactTitle,
      avatar: staff.avatar || '',
      avatarPosition: staff.avatarPosition || 'center center',
      shortCode: staff.contactShortCode || ''
    },
    quickPrompts,
    canLiveChat: reason === 'live',
    contactMode: reason === 'live' ? 'live' : 'message',
    reason,
    hoursLabel: hours.hoursLabel,
    holidayName: (extra && extra.holidayName) || '',
    introMessage: msgs.intro,
    introBody,
    ackMessage: msgs.ack,
    prefill: buildPrefill(contactTitle),
    prefillAvatar: staff.avatar || '',
    prefillAvatarPosition: staff.avatarPosition || 'center center'
  };
}

async function evaluateContactAvailability(db, staffId) {
  const staff = await resolveStaffPerson(db, staffId);
  if (!staff) {
    return { ok: false, error: 'not_found', message: 'ไม่พบข้อมูลเจ้าหน้าที่' };
  }
  const hours = await loadOrgConfig(db);
  const todayStr = todayYmdBangkok();
  const now = bangkokNow();
  const day = now.getDay();
  const nowMin = now.getHours() * 60 + now.getMinutes();
  const startMin = parseTimeToMinutes(hours.start) ?? 8 * 60 + 30;
  const endMin = parseTimeToMinutes(hours.end) ?? 16 * 60 + 30;

  const onLeave = await isStaffOnLeaveToday(db, staff.id, todayStr);
  if (onLeave) return buildAvailabilityPayload(staff, hours, 'on_leave');

  const hol = await loadHolidayContext(db, todayStr);
  if (hol.isHoliday) return buildAvailabilityPayload(staff, hours, 'holiday', { holidayName: hol.holidayName });

  if (day === 0 || day === 6) return buildAvailabilityPayload(staff, hours, 'weekend');

  if (nowMin < startMin || nowMin >= endMin) return buildAvailabilityPayload(staff, hours, 'after_hours');

  return buildAvailabilityPayload(staff, hours, 'live');
}

async function evaluateContactByShortCode(db, code) {
  const staffId = await staffContactLinks.resolveStaffIdByShortCode(db, code);
  if (!staffId) return { ok: false, error: 'not_found', message: 'ไม่พบลิงก์ติดต่อ' };
  return evaluateContactAvailability(db, staffId);
}

module.exports = {
  evaluateContactAvailability,
  evaluateContactByShortCode,
  resolveStaffPerson,
  todayYmdBangkok,
  bangkokNow
};
