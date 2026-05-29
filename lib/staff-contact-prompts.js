/**
 * คำถามด่วนแชตติดต่อเจ้าหน้าที่ — ค่าเริ่มต้นตามงาน/ฝ่าย
 */
function normKey(s) {
  return String(s || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

const DEFAULT_BY_JOB = {
  'เทคโนโลยีและสารสนเทศ': ['ปลดล็อคแอป NKBKConnect', 'ลืมรหัสผ่านแอป', 'แจ้งปัญหาระบบ/คอมพิวเตอร์'],
  'สินเชื่อ': ['สอบถามสถานะสินเชื่อ', 'ขอเอกสารสินเชื่อ', 'ตารางผ่อนชำระ'],
  'เงินฝาก': ['สอบถามยอดเงินฝาก', 'เปิดบัญชีเงินฝาก', 'ฝาก-ถอนผ่านแอป'],
  'การเงิน': ['สอบถามรายการทางการเงิน', 'ใบเสร็จ/หลักฐานการโอน', 'แจ้งโอนเงินสหกรณ์'],
  'บริหาร': ['ติดต่องานบริหารทั่วไป', 'นัดหมายผู้บริหาร', 'เอกสารแจ้งสำนักงาน'],
  'ธุรการ': ['ขอเอกสาร/หนังสือรับรอง', 'ติดต่องานธุรการ', 'สอบถามขั้นตอนเอกสาร'],
  'สมาชิกสัมพันธ์': ['สอบถามสิทธิ์สมาชิก', 'แจ้งเปลี่ยนแปลงข้อมูล', 'ติดต่อเรื่องทั่วไป']
};

const DEFAULT_BY_DEPT = {
  'สินเชื่อ': ['สอบถามสถานะสินเชื่อ', 'ขอเอกสารสินเชื่อ', 'ตารางผ่อนชำระ'],
  'เงินฝาก': ['สอบถามยอดเงินฝาก', 'เปิดบัญชีเงินฝาก', 'ฝาก-ถอนผ่านแอป'],
  'บริหาร': ['ติดต่องานบริหารทั่วไป', 'นัดหมายผู้บริหาร', 'เอกสารแจ้งสำนักงาน'],
  'เทคโนโลยีและสารสนเทศ': ['ปลดล็อคแอป NKBKConnect', 'ลืมรหัสผ่านแอป', 'แจ้งปัญหาระบบ/คอมพิวเตอร์']
};

const FALLBACK = ['สอบถามเรื่องทั่วไป', 'ติดตามสถานะคำขอ', 'ขอเอกสารที่เกี่ยวข้อง'];

function sanitizePromptList(list) {
  if (!Array.isArray(list)) return [];
  return list
    .map((x) => String(x || '').trim())
    .filter(Boolean)
    .slice(0, 8);
}

function defaultQuickPrompts(staff) {
  const u = staff && typeof staff === 'object' ? staff : {};
  const job = normKey(u.job);
  const dept = normKey(u.department);
  for (const [key, prompts] of Object.entries(DEFAULT_BY_JOB)) {
    if (job && (job.includes(normKey(key)) || normKey(key).includes(job))) return prompts.slice();
  }
  for (const [key, prompts] of Object.entries(DEFAULT_BY_DEPT)) {
    if (dept && (dept.includes(normKey(key)) || normKey(key).includes(dept))) return prompts.slice();
  }
  return FALLBACK.slice();
}

function resolveQuickPrompts(staff) {
  const custom = sanitizePromptList(staff && staff.contactQuickPrompts);
  if (custom.length) return custom;
  return defaultQuickPrompts(staff);
}

function staffContactTitle(staff) {
  const u = staff && typeof staff === 'object' ? staff : {};
  const pos = String(u.position || '').trim();
  const job = String(u.job || '').trim();
  if (!job || job === 'งานทั้งหมด' || pos.includes(job)) {
    return pos || 'เจ้าหน้าที่';
  }
  return `${pos} ${job}`.trim();
}

function staffDisplayName(staff) {
  const u = staff && typeof staff === 'object' ? staff : {};
  const full = String(u.fullname || u.name || '').trim();
  const nick = String(u.nickname || '').trim();
  if (full && nick) return full + ' (' + nick + ')';
  return full || 'เจ้าหน้าที่';
}

module.exports = {
  resolveQuickPrompts,
  defaultQuickPrompts,
  staffContactTitle,
  staffDisplayName,
  sanitizePromptList
};
