/**
 * จัดรูปแบบข้อความแชทสมาชิก — ลิงก์หน้าเว็บเป็นชื่อไทย + ตัด URL ยาว
 */
const MEMBER_CHAT_PAGE_LINKS = [
  { path: '/download', label: 'ดาวน์โหลด' },
  { path: '/contact', label: 'ติดต่อเรา' },
  { path: '/faq', label: 'คำถามที่พบบ่อย' },
  { path: '/news', label: 'ข่าวสาร' },
  { path: '/team', label: 'คณะกรรมการ' },
  { path: '/management', label: 'ทำเนียบฝ่ายจัดการ' },
  { path: '/about-us', label: 'เกี่ยวกับเรา' },
  { path: '/agenda', label: 'วาระการประชุม' },
  { path: '/terms', label: 'ข้อกำหนด' },
  { path: '/privacy-policy', label: 'นโยบายความเป็นส่วนตัว' },
  { path: '/infrom-payment', label: 'แจ้งโอนเงิน' }
];

const REPLY_PHRASES_TO_REMOVE = [
  /ระบบจะแสดงปุ่มดาวน์โหลดให้อัตโนมัติ/gi,
  /ระบบจะแสดงตารางให้อัตโนมัติ/gi,
  /ไม่ต้องพิมพ์ตารางเอง/gi
];

function escapeRegex(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function pathToMarkdown(path, label) {
  return `[${label}](${path})`;
}

function protectMarkdownLinks(text) {
  const saved = [];
  const out = String(text || '').replace(/\[([^\]]+)\]\(([^)]+)\)/g, (m) => {
    saved.push(m);
    return `\x00MDLINK${saved.length - 1}\x00`;
  });
  return { text: out, saved };
}

function restoreMarkdownLinks(text, saved) {
  return String(text || '').replace(/\x00MDLINK(\d+)\x00/g, (_, i) => saved[Number(i)] || '');
}

function stripExternalUrls(text) {
  let s = String(text || '');
  s = s.replace(/\[([^\]]+)\]\((https?:\/\/[^)]+)\)/gi, '$1');
  s = s.replace(/\[([^\]]+)\]\((\/api\/[^)]+)\)/gi, '$1');
  s = s.replace(/https?:\/\/[^\s)\],]+/gi, '');
  s = s.replace(/(?:ดาวน์โหลด(?:ได้)?(?:ที่)?)\s*[\u0E00-\u0E7A\sA-Za-z0-9_-]+(?=\s*(?:หรือ|ค่ะ|ครับ|$|\.))/gi, '');
  return s;
}

function stripReplyWhenDownloads(text) {
  let s = String(text || '');
  s = s.replace(/ดาวน์โหลด(?:ได้)?(?:ที่)?[^.]*?(?=หรือ|ค่ะ|ครับ|$)/gi, '');
  s = s.replace(/(?:กด|ใช้)\s*ปุ่ม(?:ดาวน์โหลด)?[^.]*?(?=ค่ะ|ครับ|$)/gi, '');
  s = s.replace(/\s{2,}/g, ' ').trim();
  return s;
}

function isPaymentIntent(message) {
  return /แจ้งโอน|โอนเงิน|ชำระ(?:เงิน|หนี้|ค่า)|สลิป|transfer|payment/i.test(String(message || ''));
}

function stripPaymentAccountLinesFromReply(text) {
  let s = String(text || '');
  s = s.replace(/^[\s\-•]*บัญชีรับโอน\s*:?\s*$/gim, '');
  s = s.replace(/^[\s\-•]+[^\n:]{2,40}\s*:\s*[\d\-]+[^\n]*$/gim, '');
  s = s.replace(/ประเภทที่แจ้งได้\s*:[^\n]+/gi, '');
  s = s.replace(/\n{3,}/g, '\n\n');
  return s.replace(/\s{2,}/g, ' ').trim();
}

function fixPaymentReplyLinks(text) {
  let s = String(text || '');
  s = s.replace(/\[ติดต่อเรา\]\(\/contact\)/g, '[แจ้งโอนเงิน](/infrom-payment)');
  s = s.replace(
    /ดูรายละเอียดเพิ่มเติม(?:ได้)?(?:ที่)?\s*(?:\[ติดต่อเรา\]\(\/contact\)|ติดต่อเรา)/gi,
    'แจ้งได้ที่ [แจ้งโอนเงิน](/infrom-payment)'
  );
  s = s.replace(
    /(?:ผ่าน|ที่)\s*(?:\[)?ติดต่อเรา(?:\]\(\/contact\))?/gi,
    'ที่ [แจ้งโอนเงิน](/infrom-payment)'
  );
  return s.replace(/\s{2,}/g, ' ').trim();
}

function formatMemberChatReply(text, userMessage) {
  let s = String(text || '');
  REPLY_PHRASES_TO_REMOVE.forEach((re) => {
    s = s.replace(re, '');
  });
  s = stripExternalUrls(s);
  s = s.replace(/\s{2,}/g, ' ').replace(/\s+([,.])/g, '$1').trim();

  const sorted = [...MEMBER_CHAT_PAGE_LINKS].sort((a, b) => b.path.length - a.path.length);
  sorted.forEach(({ path, label }) => {
    const md = pathToMarkdown(path, label);
    const ep = escapeRegex(path);
    const protectedLinks = protectMarkdownLinks(s);
    s = protectedLinks.text;
    s = s.replace(new RegExp(`\\*\\*${ep}\\*\\*`, 'gi'), md);
    s = s.replace(new RegExp(`หน้า\\s*${ep}`, 'gi'), md);
    s = s.replace(new RegExp(`(?<![\\w/(])${ep}(?![\\w/)])`, 'g'), md);
    s = restoreMarkdownLinks(s, protectedLinks.saved);
  });

  s = s.replace(/หน้า\s+\[([^\]]+)\]\(([^)]+)\)/g, '[$1]($2)');
  s = s.replace(/\s{2,}/g, ' ').trim();
  if (isPaymentIntent(userMessage)) {
    s = fixPaymentReplyLinks(s);
  }
  return s;
}

function memberChatPageLinkPromptLines() {
  return [
    'เมื่ออ้างถึงหน้าเว็บ ห้ามพิมพ์ path แบบ /download /contact — ให้ใช้ชื่อไทยพร้อมลิงก์ markdown เช่น [ดาวน์โหลด](/download) [ติดต่อเรา](/contact) [แจ้งโอนเงิน](/infrom-payment)',
    'เมื่อถามแจ้งโอน/โอนเงิน/ชำระเงิน ให้แนะนำ [แจ้งโอนเงิน](/infrom-payment) — ห้ามลิงก์ไป [ติดต่อเรา](/contact) แทน',
    'ห้ามใส่ URL ไฟล์ PDF หรือลิงก์ยาว (https://...) ในการตอบ — มีปุ่มดาวน์โหลดให้แล้ว',
    'ห้ามพูดว่า "ระบบจะแสดงปุ่มดาวน์โหลดให้อัตโนมัติ" หรือ "ระบบจะแสดงตารางให้อัตโนมัติ"',
    'เมื่อถามอัตราดอกเบี้ยเฉพาะเงินฝาก ตอบเฉพาะเงินฝาก — ถามเฉพาะเงินกู้ ตอบเฉพาะเงินกู้',
    'เมื่อถามวันหยุด ตอบสั้นๆ 1-2 ประโยง — ระบบจะแสดงตารางวันหยุดของเดือนที่ถาม (ค่าเริ่มต้น=เดือนปัจจุบัน) ห้ามพิมพ์ตารางเอง',
    'เมื่อถามติดต่อเจ้าหน้าที่/ฝ่าย/กรรมการ ตอบสั้นๆ — ระบบจะแสดงการ์ดข้อมูลให้ ห้ามปฏิเสธว่าไม่เปิดเผยรายชื่อ'
  ];
}

module.exports = {
  MEMBER_CHAT_PAGE_LINKS,
  formatMemberChatReply,
  stripReplyWhenDownloads,
  stripPaymentAccountLinesFromReply,
  isPaymentIntent,
  fixPaymentReplyLinks,
  memberChatPageLinkPromptLines
};
