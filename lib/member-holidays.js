/**
 * วันหยุดสมาชิก — ตารางรายเดือนสำหรับแชทเว็บ
 */
const path = require('path');

const COOP_THAI_MONTHS = [
  'มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน',
  'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม'
];

let staticHolidaysCache = null;

function loadStaticHolidays() {
  if (staticHolidaysCache) return staticHolidaysCache;
  try {
    staticHolidaysCache = require(path.join(__dirname, '..', 'thai-public-holidays.json'));
  } catch (e) {
    staticHolidaysCache = [];
  }
  return staticHolidaysCache;
}

function bangkokNow() {
  return new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Bangkok' }));
}

function parseCoopHolidayDate(dateStr) {
  const date = String(dateStr || '').trim().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  const dateObj = new Date(date + 'T12:00:00');
  return Number.isNaN(dateObj.getTime()) ? null : dateObj;
}

function formatCoopHolidayDateBE(dateObj) {
  const day = dateObj.getDate();
  const month = COOP_THAI_MONTHS[dateObj.getMonth()];
  const yearBE = dateObj.getFullYear() + 543;
  return `${day} ${month} ${yearBE}`;
}

function getStaticForYear(year) {
  return loadStaticHolidays().filter((h) => String(h.date || '').startsWith(String(year) + '-'));
}

function collectCoopHolidayRows(holidaysDocs, gregorianYear) {
  const holidays = Array.isArray(holidaysDocs) ? holidaysDocs : [];
  const datesCoopOpen = new Set(
    holidays
      .filter((h) => h && h.hidden === true && h.date)
      .map((h) => String(h.date).trim().slice(0, 10))
  );
  const byDate = new Map();

  getStaticForYear(gregorianYear).forEach((h) => {
    const date = String(h.date).trim().slice(0, 10);
    const dateObj = parseCoopHolidayDate(date);
    if (!dateObj || dateObj.getFullYear() !== gregorianYear) return;
    if (!byDate.has(date)) {
      byDate.set(date, { date, name: (h.name || '').trim() || '-', dateObj });
    }
  });

  holidays.forEach((h) => {
    if (!h || !h.date || h.hidden === true) return;
    const date = String(h.date).trim().slice(0, 10);
    const dateObj = parseCoopHolidayDate(date);
    if (!dateObj || dateObj.getFullYear() !== gregorianYear) return;
    byDate.set(date, {
      date,
      name: (h.nameTH || h.name || '').trim() || '-',
      dateObj
    });
  });

  return Array.from(byDate.values())
    .sort((a, b) => a.dateObj - b.dateObj)
    .map((row) => ({
      ...row,
      isCoopOpen: datesCoopOpen.has(row.date)
    }));
}

function detectHolidayMonth(message, now) {
  const ref = now instanceof Date ? now : bangkokNow();
  const m = String(message || '');
  const lower = m.toLowerCase();

  let year = ref.getFullYear();
  const beMatch = m.match(/(?:พ\.?\s*ศ\.?|ปี)\s*(\d{4})/i);
  if (beMatch) {
    const be = parseInt(beMatch[1], 10);
    if (be > 2400) year = be - 543;
  }
  const ceMatch = m.match(/(?:ค\.?\s*ศ\.?|ปี)\s*(20\d{2})/i);
  if (ceMatch) year = parseInt(ceMatch[1], 10);

  if (/เดือนหน้า/.test(lower)) {
    const d = new Date(ref.getFullYear(), ref.getMonth() + 1, 1);
    return { month: d.getMonth(), year: d.getFullYear() };
  }
  if (/เดือน(?:ที่)?แล้ว|เดือนก่อน/.test(lower)) {
    const d = new Date(ref.getFullYear(), ref.getMonth() - 1, 1);
    return { month: d.getMonth(), year: d.getFullYear() };
  }

  for (let i = 0; i < COOP_THAI_MONTHS.length; i++) {
    if (m.includes(COOP_THAI_MONTHS[i])) {
      return { month: i, year };
    }
  }

  return { month: ref.getMonth(), year };
}

function isHolidayIntent(message) {
  return /วันหยุด|หยุด(?:.*?)(?:วัน)?|holiday|ขัตฤกษ์|นักขัตฤกษ์|เสาร์.?อาทิตย์/i.test(String(message || ''));
}

function escHtml(s) {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function buildMemberHolidaysTableHtml(holidaysDocs, message) {
  const now = bangkokNow();
  const { month, year } = detectHolidayMonth(message, now);
  const monthRows = collectCoopHolidayRows(holidaysDocs, year).filter(
    (r) => r.dateObj.getMonth() === month && r.dateObj.getFullYear() === year
  );
  const monthLabel = COOP_THAI_MONTHS[month];
  const beYear = year + 543;

  let bodyRows = '';
  if (!monthRows.length) {
    bodyRows =
      '<tr><td colspan="3" class="kb-chat-holiday-empty">ไม่มีวันหยุดนักขัตฤกษ์/พิเศษในเดือนนี้</td></tr>';
  } else {
    bodyRows = monthRows
      .map((r) => {
        const note = r.isCoopOpen ? 'สหกรณ์เปิดทำการ' : 'สหกรณ์หยุด';
        const noteClass = r.isCoopOpen ? ' kb-chat-holiday-note--open' : '';
        return (
          `<tr><td>${escHtml(formatCoopHolidayDateBE(r.dateObj))}</td>` +
          `<td>${escHtml(r.name)}</td>` +
          `<td class="kb-chat-holiday-note${noteClass}">${escHtml(note)}</td></tr>`
        );
      })
      .join('');
  }

  return (
    '<div class="kb-chat-holiday-wrap">' +
    `<div class="kb-chat-holiday-head">วันหยุดขัตฤกษ์ — ${escHtml(monthLabel)} ${beYear}</div>` +
    '<table class="kb-chat-holiday-table">' +
    '<thead><tr><th>วันที่</th><th>รายการ</th><th>สถานะ</th></tr></thead>' +
    `<tbody>${bodyRows}</tbody></table>` +
    '<div class="kb-chat-holiday-foot">สหกรณ์หยุดทุกวันเสาร์-อาทิตย์</div>' +
    '</div>'
  );
}

module.exports = {
  bangkokNow,
  detectHolidayMonth,
  isHolidayIntent,
  buildMemberHolidaysTableHtml,
  collectCoopHolidayRows
};
