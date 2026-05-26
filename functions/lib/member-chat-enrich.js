/**
 * ตกแต่งคำตอบแชทสมาชิกบนเว็บ — ตารางดอกเบี้ย + ปุ่มดาวน์โหลด + ตารางวันหยุด
 */
const {
  buildMemberInterestRatesTableHtml,
  detectInterestRateScope,
  isInterestRateIntent
} = require('./member-interest-rates.js');
const {
  pickDownloadActions,
  isDownloadIntent,
  stripDownloadMarkers
} = require('./member-downloads.js');
const {
  formatMemberChatReply,
  stripReplyWhenDownloads,
  stripPaymentAccountLinesFromReply
} = require('./member-chat-format.js');
const { isHolidayIntent, buildMemberHolidaysTableHtml } = require('./member-holidays.js');
const { isPaymentIntent, buildMemberPaymentTableHtml } = require('./member-payment.js');
const {
  isStaffContactIntent,
  isCommitteeContactQuery,
  pickStaffMatches,
  pickStaffFromReplyName,
  buildMemberStaffCardsHtml,
  stripStaffDetailsFromReply,
  buildStaffCardReplyIntro,
  staffCardFooterLink,
  fixCommitteeReplyLinks
} = require('./member-staff.js');

function enrichPublicMemberChatReply(message, reply, cmsSite, downloadSections, holidaysDocs, staffDirectory) {
  let text = formatMemberChatReply(stripDownloadMarkers(reply), message);
  const result = { reply: text };
  const paymentIntent = isPaymentIntent(message);

  if (paymentIntent) {
    const paymentHtml = buildMemberPaymentTableHtml(cmsSite || {});
    if (paymentHtml) {
      result.html = paymentHtml;
      text = stripPaymentAccountLinesFromReply(text);
      result.reply = text;
    }
  } else if (isStaffContactIntent(message, staffDirectory)) {
    let matches = pickStaffMatches(message, staffDirectory, 4);
    if (!matches.length) matches = pickStaffFromReplyName(text, staffDirectory);
    const staffHtml = buildMemberStaffCardsHtml(matches);
    if (staffHtml) {
      result.html = staffHtml;
      text = stripStaffDetailsFromReply(text, matches);
      if (isCommitteeContactQuery(message)) text = fixCommitteeReplyLinks(text);
      if (!text || text.length < 8 || /ไม่สามารถเปิดเผย|ไม่ทราบ|ติดต่อเรา|(?:คือ|ชื่อ)\s/i.test(text)) {
        text = buildStaffCardReplyIntro(matches, message) + staffCardFooterLink(matches, message);
      } else if (isCommitteeContactQuery(message)) {
        text = fixCommitteeReplyLinks(text);
        if (!/\[คณะกรรมการ\]\(\/team\)/.test(text)) {
          text += staffCardFooterLink(matches, message);
        }
      }
      result.reply = formatMemberChatReply(text, message);
    } else if (isCommitteeContactQuery(message)) {
      text = fixCommitteeReplyLinks(text);
      if (!/\[คณะกรรมการ\]\(\/team\)/.test(text)) {
        text = (text ? text + ' ' : '') + 'ดูข้อมูลกรรมการได้ที่ [คณะกรรมการ](/team) ค่ะ';
      }
      result.reply = formatMemberChatReply(text, message);
    }
  } else if (isHolidayIntent(message) && !isInterestRateIntent(message)) {
    result.html = buildMemberHolidaysTableHtml(holidaysDocs || [], message);
  } else if (isInterestRateIntent(message)) {
    const scope = detectInterestRateScope(message);
    result.html = buildMemberInterestRatesTableHtml(cmsSite || {}, scope);
  }

  const wantDownloads =
    !paymentIntent &&
    !isStaffContactIntent(message, staffDirectory) &&
    (isDownloadIntent(message) ||
      isDownloadIntent(text) ||
      /แบบฟอร์ม|ดาวน์โหลด|pdf|สมัครสมาชิก/i.test(message) ||
      /แบบฟอร์ม|ดาวน์โหลด|pdf/i.test(text));

  if (wantDownloads && downloadSections && downloadSections.length) {
    const downloads = pickDownloadActions(message, text, downloadSections, 1);
    if (downloads.length) {
      result.downloads = downloads;
      text = stripReplyWhenDownloads(text);
      result.reply = text;
    }
  }

  return result;
}

module.exports = {
  enrichPublicMemberChatReply
};
