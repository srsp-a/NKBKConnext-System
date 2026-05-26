/**
 * อัตราดอกเบี้ยสมาชิก — sync กับ public-cms/site-config.js (หน้าแรกเว็บ)
 * ใช้ใน buildPublicMemberDataContext (แชทเว็บ) และ line-webhook/member-context.js (LINE)
 */
const INTEREST_RATES_DEFAULTS = {
  deposit: [
    { labelTh: 'ออมทรัพย์ (สามัญ)', labelEn: 'Savings (ordinary)', rate: '3.00', popular: true },
    { labelTh: 'ออมทรัพย์ (สมทบ)', labelEn: 'Savings (contribution)', rate: '2.75' },
    { labelTh: 'ออมทรัพย์ ATM', labelEn: 'ATM savings', rate: '3.00' }
  ],
  loanOrdinary: [
    { labelTh: 'สามัญ', labelEn: 'Ordinary', rate: '6.55' },
    { labelTh: 'สามัญสำหรับภาระค้ำประกัน', labelEn: 'Ordinary (guarantee obligation)', rate: '0.50' },
    { labelTh: 'สามัญเพื่อการดำรงชีพ', labelEn: 'Ordinary (livelihood)', rate: '6.55' },
    { labelTh: 'สามัญผู้สูงอายุ', labelEn: 'Ordinary (elderly)', rate: '5.75' },
    { labelTh: 'สามัญเพื่อพัฒนาคุณภาพชีวิต', labelEn: 'Ordinary (quality of life)', rate: '6.55' },
    { labelTh: 'สามัญเพื่อเกษียณสุขใจ', labelEn: 'Ordinary (retirement)', rate: '6.55' },
    { labelTh: 'สามัญรวมหนี้', labelEn: 'Ordinary (debt consolidation)', rate: '6.55' }
  ],
  loanSpecial: [
    { labelTh: 'ฉุกเฉิน', labelEn: 'Emergency', rate: '6.65' },
    { labelTh: 'ฉุกเฉิน ATM', labelEn: 'Emergency ATM', rate: '6.65' },
    { labelTh: 'พิเศษโดยใช้หุ้นค้ำประกัน', labelEn: 'Special (share collateral)', rate: '6.00' },
    { labelTh: 'พิเศษเพื่อการศึกษา', labelEn: 'Special (education)', rate: '6.35' },
    { labelTh: 'พิเศษเพื่อการลงทุนประกอบอาชีพ', labelEn: 'Special (livelihood investment)', rate: '6.35' },
    { labelTh: 'พิเศษเพื่อการเคหะสงเคราะห์', labelEn: 'Special (housing)', rate: '6.35' }
  ]
};

function normalizeRateList(list) {
  if (!Array.isArray(list)) return [];
  return list
    .map((item) => {
      if (!item || typeof item !== 'object') return null;
      const labelTh = String(item.labelTh || item.label || '').trim();
      const rate = String(item.rate != null ? item.rate : '').trim();
      if (!labelTh || !rate) return null;
      return {
        labelTh,
        labelEn: item.labelEn ? String(item.labelEn).trim() : '',
        rate,
        popular: item.popular === true
      };
    })
    .filter(Boolean);
}

function resolveMemberInterestRates(cmsSite) {
  const site = cmsSite && typeof cmsSite === 'object' ? cmsSite : {};
  const raw = site.interestRates && typeof site.interestRates === 'object' ? site.interestRates : {};
  const deposit = normalizeRateList(raw.deposit);
  const loanOrdinary = normalizeRateList(raw.loanOrdinary);
  const loanSpecial = normalizeRateList(raw.loanSpecial);
  return {
    deposit: deposit.length ? deposit : INTEREST_RATES_DEFAULTS.deposit,
    loanOrdinary: loanOrdinary.length ? loanOrdinary : INTEREST_RATES_DEFAULTS.loanOrdinary,
    loanSpecial: loanSpecial.length ? loanSpecial : INTEREST_RATES_DEFAULTS.loanSpecial
  };
}

function formatRateLine(item) {
  const tag = item.popular ? ' (ยอดนิยม)' : '';
  return `- ${item.labelTh}: ${item.rate}% ต่อปี${tag}`;
}

function buildMemberInterestRatesContextLines(cmsSite) {
  const rates = resolveMemberInterestRates(cmsSite);
  const lines = [
    'ข้อมูลเดียวกับหน้าแรกเว็บไซต์ (ส่วน "อัตราดอกเบี้ย") — อัตราเป็น % ต่อปี',
    'เมื่อถามอัตราดอกเบี้ย: ตอบสั้นๆ 1-2 ประโยง — ระบบจะแสดงตารางให้อัตโนมัติ ไม่ต้องพิมพ์ตารางเอง',
    '',
    'เงินฝาก:',
    ...rates.deposit.map(formatRateLine),
    '',
    'เงินกู้สามัญ:',
    ...rates.loanOrdinary.map(formatRateLine),
    '',
    'เงินกู้พิเศษ:',
    ...rates.loanSpecial.map(formatRateLine)
  ];
  return lines;
}

module.exports = {
  INTEREST_RATES_DEFAULTS,
  resolveMemberInterestRates,
  buildMemberInterestRatesContextLines
};
