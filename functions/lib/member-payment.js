/**
 * แจ้งโอนเงิน — sync กับ public-cms/site-config.js + หน้า /infrom-payment
 */
const PAYMENT_BANKS_DEFAULTS = [
  {
    label: 'พร้อมเพย์',
    account: '0994000375891',
    icon: 'wallet',
    logoUrl:
      'https://res.cloudinary.com/dzs7zbikj/image/upload/v1777910843/6789cc7973863d34426baf54_678316f2a65ae45dd6a22f9f_678303b39e0a1b2f05c23bc4_673ac03613ce1d036f897c16_thaiqr_logosimbolo_chvgzt.png'
  },
  {
    label: 'ธ.กรุงไทย สาขาหนองคาย',
    account: '413-1-00856-4',
    icon: 'bank',
    logoUrl:
      'https://res.cloudinary.com/dzs7zbikj/image/upload/v1778185285/next_jhsxfs.png'
  },
  {
    label: 'ธ.กรุงไทย สาขาสี่แยกบึงกาฬ',
    account: '980-6-21826-4',
    icon: 'bank',
    logoUrl:
      'https://res.cloudinary.com/dzs7zbikj/image/upload/v1778185285/next_jhsxfs.png'
  }
];

const PAYMENT_TYPES_DEFAULTS = [
  'โอนเงินฝาก',
  'โอนซื้อหุ้น',
  'โอนชำระหนี้',
  'โอนค่าสมัครสมาชิก',
  'โอนชำระกองทุน',
  'โอนรายการอื่นๆ'
];

const CHAT_PAYMENT_COPY_SVG =
  '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">' +
  '<rect x="9" y="9" width="13" height="13" rx="2"/>' +
  '<path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>';

function resolvePaymentBanks(cmsSite) {
  const site = cmsSite && typeof cmsSite === 'object' ? cmsSite : {};
  const banks = Array.isArray(site.payment && site.payment.banks) ? site.payment.banks : [];
  if (!banks.length) return PAYMENT_BANKS_DEFAULTS;
  return banks
    .map((b) => ({
      label: String((b && b.label) || '').trim(),
      account: String((b && b.account) || '').trim(),
      icon: String((b && b.icon) || 'bank').trim(),
      logoUrl: String((b && b.logoUrl) || '').trim()
    }))
    .filter((b) => b.label && b.account);
}

function accountCopyDigits(account) {
  return String(account || '').replace(/\D/g, '');
}

function buildMemberPaymentContextLines(cmsSite) {
  const banks = resolvePaymentBanks(cmsSite);
  const lines = [
    'ข้อมูลเดียวกับหน้า [แจ้งโอนเงิน](/infrom-payment)',
    'เมื่อถามแจ้งโอน/โอนเงิน/ชำระเงิน/สลิป ให้แนะนำกรอกแบบฟอร์มที่ [แจ้งโอนเงิน](/infrom-payment) — ห้ามลิงก์ไป [ติดต่อเรา](/contact) แทน',
    'ขั้นตอน: 1) โอนเข้าบัญชีสหกรณ์ 2) กรอกแบบฟอร์มพร้อมแนบสลิปที่หน้าแจ้งโอน 3) รอเจ้าหน้าที่ตรวจสอบ',
    'บัญชีรับโอน:'
  ];
  banks.forEach((b) => lines.push(`- ${b.label}: ${b.account}`));
  lines.push('ประเภทที่แจ้งได้: ' + PAYMENT_TYPES_DEFAULTS.join(', '));
  return lines;
}

function isPaymentIntent(message) {
  return /แจ้งโอน|โอนเงิน|ชำระ(?:เงิน|หนี้|ค่า)|สลิป|transfer|payment/i.test(String(message || ''));
}

function escHtml(s) {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function renderPaymentBankLogo(bank) {
  if (bank.logoUrl) {
    return `<img src="${escHtml(bank.logoUrl)}" alt="" width="40" height="40" loading="lazy" decoding="async">`;
  }
  return '<span class="kb-chat-payment-bank-fallback" aria-hidden="true">฿</span>';
}

function buildPaymentBankCard(bank) {
  const iconClass = bank.logoUrl ? ' kb-chat-payment-bank-icon--logo' : '';
  const copyDigits = escHtml(accountCopyDigits(bank.account));
  return (
    '<article class="kb-chat-payment-bank">' +
    `<div class="kb-chat-payment-bank-icon${iconClass}" aria-hidden="true">${renderPaymentBankLogo(bank)}</div>` +
    '<div class="kb-chat-payment-bank-body">' +
    `<p class="kb-chat-payment-bank-name">${escHtml(bank.label)}</p>` +
    '<p class="kb-chat-payment-bank-acct">' +
    `<span class="kb-chat-payment-bank-num">${escHtml(bank.account)}</span>` +
    `<button type="button" class="kb-chat-payment-copy" data-copy="${copyDigits}" title="คัดลอก">${CHAT_PAYMENT_COPY_SVG}</button>` +
    '</p></div></article>'
  );
}

function buildMemberPaymentTableHtml(cmsSite) {
  const banks = resolvePaymentBanks(cmsSite);
  if (!banks.length) return '';
  const typesHint = PAYMENT_TYPES_DEFAULTS.slice(0, 4).join(' · ') + ' …';
  const bankCards = banks.map(buildPaymentBankCard).join('');
  return (
    '<div class="kb-chat-payment-wrap">' +
    '<div class="kb-chat-payment-card">' +
    '<div class="kb-chat-payment-head">บัญชีรับโอน</div>' +
    `<div class="kb-chat-payment-banks">${bankCards}</div>` +
    `<div class="kb-chat-payment-foot">ประเภทที่แจ้งได้: ${escHtml(typesHint)}</div>` +
    '</div></div>'
  );
}

module.exports = {
  PAYMENT_BANKS_DEFAULTS,
  PAYMENT_TYPES_DEFAULTS,
  resolvePaymentBanks,
  accountCopyDigits,
  buildMemberPaymentContextLines,
  buildMemberPaymentTableHtml,
  isPaymentIntent
};
