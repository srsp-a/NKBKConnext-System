/**
 * วันหยุดสหกรณ์ — sync กับ lib/nkbk-ai.js buildCoopHolidayContextLines และ Admin thaiHolidays
 */
const COOP_THAI_MONTHS = [
  'มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน',
  'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม'
];

const STATIC_THAI_HOLIDAYS_2025 = [
  { date: '2025-01-01', name: 'วันขึ้นปีใหม่' },
  { date: '2025-01-29', name: 'วันตรุษจีน' },
  { date: '2025-02-12', name: 'วันมาฆบูชา' },
  { date: '2025-03-30', name: 'สิ้นสุดรอมฎอน' },
  { date: '2025-04-06', name: 'วันจักรี' },
  { date: '2025-04-07', name: 'ชดเชยวันจักรี' },
  { date: '2025-04-13', name: 'เทศกาลสงกรานต์' },
  { date: '2025-04-14', name: 'เทศกาลสงกรานต์' },
  { date: '2025-04-15', name: 'เทศกาลสงกรานต์' },
  { date: '2025-05-01', name: 'วันแรงงาน' },
  { date: '2025-05-04', name: 'วันฉัตรมงคล' },
  { date: '2025-05-05', name: 'ชดเชยวันฉัตรมงคล' },
  { date: '2025-05-09', name: 'วันพืชมงคล' },
  { date: '2025-05-11', name: 'วันวิสาขบูชา' },
  { date: '2025-05-12', name: 'ชดเชยวันวิสาขบูชา' },
  { date: '2025-06-02', name: 'ชดเชยวันเฉลิมพระชนมพรรษาสมเด็จพระราชินี' },
  { date: '2025-06-03', name: 'วันเฉลิมพระชนมพรรษาสมเด็จพระราชินี' },
  { date: '2025-07-10', name: 'วันอาสาฬหบูชา' },
  { date: '2025-07-11', name: 'วันเข้าพรรษา' },
  { date: '2025-07-28', name: 'วันเฉลิมพระชนมพรรษาพระบาทสมเด็จพระเจ้าอยู่หัว' },
  { date: '2025-08-11', name: 'ชดเชยวันแม่แห่งชาติ' },
  { date: '2025-08-12', name: 'วันแม่แห่งชาติ' },
  { date: '2025-10-13', name: 'วันคล้ายวันสวรรคต ร.9' },
  { date: '2025-10-23', name: 'วันปิยมหาราช' },
  { date: '2025-12-05', name: 'วันคล้ายวันพระบรมราชสมภพ ร.9' },
  { date: '2025-12-10', name: 'วันรัฐธรรมนูญ' },
  { date: '2025-12-25', name: 'วันคริสต์มาส' },
  { date: '2025-12-31', name: 'วันสิ้นปี' }
];

const STATIC_THAI_HOLIDAYS_2026 = [
  { date: '2026-01-01', name: 'วันขึ้นปีใหม่' },
  { date: '2026-01-02', name: 'วันหยุดปีใหม่' },
  { date: '2026-02-17', name: 'วันตรุษจีน' },
  { date: '2026-03-03', name: 'วันมาฆบูชา' },
  { date: '2026-03-20', name: 'สิ้นสุดรอมฎอน' },
  { date: '2026-04-06', name: 'วันจักรี' },
  { date: '2026-04-13', name: 'เทศกาลสงกรานต์' },
  { date: '2026-04-14', name: 'เทศกาลสงกรานต์' },
  { date: '2026-04-15', name: 'เทศกาลสงกรานต์' },
  { date: '2026-05-01', name: 'วันแรงงาน' },
  { date: '2026-05-04', name: 'วันฉัตรมงคล' },
  { date: '2026-05-11', name: 'วันพืชมงคล' },
  { date: '2026-05-31', name: 'วันวิสาขบูชา' },
  { date: '2026-06-01', name: 'ชดเชยวันวิสาขบูชา' },
  { date: '2026-06-03', name: 'วันเฉลิมพระชนมพรรษาสมเด็จพระราชินี' },
  { date: '2026-07-28', name: 'วันเฉลิมพระชนมพรรษาพระบาทสมเด็จพระเจ้าอยู่หัว' },
  { date: '2026-07-29', name: 'วันอาสาฬหบูชา' },
  { date: '2026-07-30', name: 'วันเข้าพรรษา' },
  { date: '2026-08-12', name: 'วันแม่แห่งชาติ' },
  { date: '2026-10-13', name: 'วันคล้ายวันสวรรคต ร.9' },
  { date: '2026-10-23', name: 'วันปิยมหาราช' },
  { date: '2026-12-05', name: 'วันคล้ายวันพระบรมราชสมภพ ร.9' },
  { date: '2026-12-07', name: 'ชดเชยวันคล้ายวันพระบรมราชสมภพ ร.9' },
  { date: '2026-12-10', name: 'วันรัฐธรรมนูญ' },
  { date: '2026-12-25', name: 'วันคริสต์มาส' },
  { date: '2026-12-31', name: 'วันสิ้นปี' }
];

function getStaticThaiHolidaysForYear(gregorianYear) {
  if (gregorianYear === 2025) return STATIC_THAI_HOLIDAYS_2025;
  if (gregorianYear === 2026) return STATIC_THAI_HOLIDAYS_2026;
  return [];
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

function startOfDay(d) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

function buildCoopHolidayContextLines(holidaysDocs, options) {
  const opts = options && typeof options === 'object' ? options : {};
  const now = opts.now instanceof Date ? opts.now : new Date();
  const gregorianYear = opts.gregorianYear != null ? Number(opts.gregorianYear) : now.getFullYear();
  const beYear = gregorianYear + 543;
  const futureOnly = opts.futureOnly === true;
  const maxItems = opts.maxItems != null ? Number(opts.maxItems) : null;

  const holidays = Array.isArray(holidaysDocs) ? holidaysDocs : [];
  const datesCoopOpen = new Set(
    holidays
      .filter((h) => h && h.hidden === true && h.date)
      .map((h) => String(h.date).trim().slice(0, 10))
  );

  const byDate = new Map();
  const staticForYear = getStaticThaiHolidaysForYear(gregorianYear);

  staticForYear.forEach((h) => {
    const date = String(h.date).trim().slice(0, 10);
    const dateObj = parseCoopHolidayDate(date);
    if (!dateObj || dateObj.getFullYear() !== gregorianYear) return;
    if (futureOnly && dateObj < startOfDay(now)) return;
    if (!byDate.has(date)) {
      byDate.set(date, { date, name: (h.name || '').trim() || '-', dateObj, source: 'static' });
    }
  });

  holidays.forEach((h) => {
    if (!h || !h.date || h.hidden === true) return;
    const date = String(h.date).trim().slice(0, 10);
    const dateObj = parseCoopHolidayDate(date);
    if (!dateObj || dateObj.getFullYear() !== gregorianYear) return;
    if (futureOnly && dateObj < startOfDay(now)) return;
    const name = (h.nameTH || h.name || '').trim() || '-';
    byDate.set(date, { date, name, dateObj, source: 'firestore' });
  });

  let sortedHolidays = Array.from(byDate.values()).sort((a, b) => a.dateObj - b.dateObj);
  if (maxItems != null && maxItems > 0) sortedHolidays = sortedHolidays.slice(0, maxItems);

  const lines = [
    'สหกรณ์หยุดทุกวันเสาร์-อาทิตย์',
    `อ้างอิงปี พ.ศ. ${beYear} (ปีปัจจุบัน)`
  ];

  if (sortedHolidays.length === 0) {
    lines.push('ไม่มีรายการวันหยุดนักขัตฤกษ์/พิเศษในปีนี้ (นอกจากเสาร์-อาทิตย์)');
  } else {
    sortedHolidays.forEach((h) => {
      const dateStr = formatCoopHolidayDateBE(h.dateObj);
      const isCoopOpen = datesCoopOpen.has(h.date);
      lines.push(
        isCoopOpen
          ? `${h.name}: ${dateStr} (สหกรณ์ไม่หยุด — เปิดทำการ)`
          : `${h.name}: ${dateStr}`
      );
    });
  }

  if (datesCoopOpen.size > 0) {
    lines.push('หมายเหตุ: (สหกรณ์ไม่หยุด) = วันที่สหกรณ์เปิดทำการตามที่แอดมินตั้งค่า');
  }

  return lines;
}

module.exports = { buildCoopHolidayContextLines };
