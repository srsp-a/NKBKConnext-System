/** ช่องทางติดต่อ + เวลาทำการสมาชิก — sync กับ public-cms/site-config.js + หน้า /contact */
const CMS_CONTACT_DEFAULTS = {
  contactPagePath: '/contact',
  hoursTh: 'วันจันทร์–วันศุกร์: 08.30 น.-16.30 น.',
  phoneDisplay: '042-420750',
  email: 'support@nkbkcoop.com',
  address: '919 หมู่ 5 ต.โพธิ์ชัย อ.เมืองหนองคาย จ.หนองคาย 43000',
  fax: '042-420740',
  mobile: ['087-8604004', '089-8619198'],
  facebook: 'https://www.facebook.com/sahakon.nkbk',
  line: 'https://page.line.me/117kkqhx?openQrModal=true',
  youtube: 'https://www.youtube.com/@nkbkcoop',
  mapUrl: 'https://maps.app.goo.gl/FhT4ThAC2VPwt7dm9'
};

function normalizeCoopTimeDot(value, fallback) {
  const raw = value != null ? String(value).trim() : '';
  if (!raw) return fallback;
  return raw.replace(':', '.');
}

function buildMemberWorkHoursLine(org) {
  const start = normalizeCoopTimeDot(org && org.attendanceWorkStart, '08.30');
  const end = normalizeCoopTimeDot(org && org.attendanceWorkEnd, '16.30');
  const ct = (org && org.contact) || {};
  const hoursLabel = ct.hoursTh || CMS_CONTACT_DEFAULTS.hoursTh;
  return `[เวลาทำการสหกรณ์] ${hoursLabel} (เปิด ${start} น.-${end} น. วันจันทร์-ศุกร์)`;
}

function buildMemberContactContextLines(org, cmsSite) {
  const site = cmsSite && typeof cmsSite === 'object' ? cmsSite : {};
  const ct = site.contact || (org && org.contact) || {};
  const lines = [
    'ข้อมูลช่องทางติดต่อเดียวกับหน้า [ติดต่อเรา](/contact)',
    'หน้าติดต่อ: [ติดต่อเรา](/contact)'
  ];
  const hours = ct.hoursTh || CMS_CONTACT_DEFAULTS.hoursTh;
  lines.push('เวลาทำการ: ' + hours);
  const phone =
    site.phoneDisplay ||
    site.phone ||
    (org && (org.phoneDisplay || org.phone || org.contactPhone)) ||
    CMS_CONTACT_DEFAULTS.phoneDisplay;
  lines.push('โทรศัพท์: ' + String(phone).trim());
  const fax = ct.fax || CMS_CONTACT_DEFAULTS.fax;
  if (fax) lines.push('แฟกซ์: ' + String(fax).trim());
  const mobile = Array.isArray(ct.mobile) ? ct.mobile : CMS_CONTACT_DEFAULTS.mobile;
  if (mobile.length) lines.push('มือถือ: ' + mobile.join(', '));
  const email =
    site.email ||
    (org && (org.email || org.contactEmail)) ||
    CMS_CONTACT_DEFAULTS.email;
  if (email) lines.push('อีเมล: ' + String(email).trim());
  const address =
    site.address ||
    (org && org.address) ||
    CMS_CONTACT_DEFAULTS.address;
  if (address) lines.push('ที่อยู่: ' + String(address).trim());
  const facebook = site.facebook || CMS_CONTACT_DEFAULTS.facebook;
  const lineUrl = site.line || CMS_CONTACT_DEFAULTS.line;
  const youtube = site.youtube || CMS_CONTACT_DEFAULTS.youtube;
  const mapUrl = site.mapUrl || CMS_CONTACT_DEFAULTS.mapUrl;
  if (facebook) lines.push('Facebook: ' + facebook);
  if (lineUrl) lines.push('LINE Official: ' + lineUrl);
  if (youtube) lines.push('YouTube: ' + youtube);
  if (mapUrl) lines.push('แผนที่: ' + mapUrl);
  return lines;
}

module.exports = {
  CMS_CONTACT_DEFAULTS,
  buildMemberWorkHoursLine,
  buildMemberContactContextLines
};
