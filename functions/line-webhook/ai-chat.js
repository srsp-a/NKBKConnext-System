/**
 * AI แชท LINE (โมเน่) — ตามสเปก docs/ai-chat-spec.md
 * ใช้ OpenAI API, ความจำจาก Firestore, บุคลิกและคำเรียกจาก config
 */
const https = require('https');
const aiImageGen = require('./ai-image-gen.js');
const { buildCoopHolidayContextLines } = require('./coop-holidays.js');
const { buildMemberWorkHoursLine, buildMemberContactContextLines } = require('./member-context.js');
const { buildMemberInterestRatesContextLines } = require('./member-interest-rates.js');
const { parseDownloadSections, buildMemberDownloadsContextLines } = require('./member-downloads.js');

const pendingImageJobs = new Set();

function trackImageJob(promise) {
  pendingImageJobs.add(promise);
  promise.finally(() => pendingImageJobs.delete(promise));
  return promise;
}

async function drainPendingImageJobs() {
  if (!pendingImageJobs.size) return;
  await Promise.allSettled([...pendingImageJobs]);
}

function withTimeout(promise, ms, message) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(message || 'timeout')), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

async function runLineImageGeneration(deps, pushTo, scopeId, groupId, text, lastContext, cfg, apiKey) {
  const { pushMessage, firebaseSet } = deps;
  const imgCfg = aiImageGen.configFromLineCfg(cfg);
  const directText = String(text || '').trim();
  const ctxText =
    (lastContext && lastContext.lastAssistantText) ||
    (lastContext && lastContext.lastUserText) ||
    '';

  console.log('[ai-image] start', scopeId.substring(0, 8), 'len=', directText.length);

  try {
    let prompt = aiImageGen.buildImagePromptFromMessage(text, lastContext);
    if (directText.length <= 180 && ctxText && ctxText.length > 120) {
      try {
        prompt = await withTimeout(
          aiImageGen.enhancePromptFromContext(apiKey, imgCfg, text, ctxText),
          20000,
          'prompt timeout'
        );
      } catch (_) {}
    }

    const images = await withTimeout(
      aiImageGen.generateImages(apiKey, imgCfg, prompt, { fastOnly: true }),
      150000,
      'ใช้เวลานานเกินไป — ลองใหม่หรือย่อเนื้อหา'
    );
    const imageUrl = await withTimeout(
      aiImageGen.uploadPngAndGetUrl(images[0].b64),
      90000,
      'อัปโหลดรูปไม่สำเร็จ'
    );

    const imageMessages = [
      { type: 'text', text: 'สร้างรูปให้แล้วค่ะ ✨' },
      {
        type: 'image',
        originalContentUrl: imageUrl,
        previewImageUrl: imageUrl
      }
    ];

    try {
      await pushMessage(pushTo, imageMessages);
    } catch (pushErr) {
      const pushMsg = String((pushErr && pushErr.message) || pushErr || '');
      console.warn('[ai-image] push failed:', pushMsg);
      await firebaseSet('ai_chat_pending_image', scopeId, {
        scopeId,
        imageUrl,
        pushError: pushMsg.slice(0, 200),
        createdAt: new Date().toISOString()
      });
      console.log('[ai-image] saved pending image for next reply', scopeId.substring(0, 8));
      return;
    }

    try {
      await firebaseSet('ai_chat_pending_image', scopeId, {
        scopeId,
        imageUrl: '',
        clearedAt: new Date().toISOString()
      });
    } catch (_) {}
    try {
      await firebaseSet('ai_chat_context', scopeId, {
        lastUserText: text,
        lastAssistantText: '[สร้างรูปแล้ว]',
        updatedAt: new Date().toISOString()
      });
    } catch (_) {}
    if (groupId) {
      try {
        await firebaseSet('ai_chat_state', groupId, { groupId, lastMessageAt: new Date().toISOString() });
      } catch (_) {}
    }
    console.log('✅ AI image sent to', groupId ? 'group' : 'user', scopeId.substring(0, 8) + '...');
  } catch (e) {
    console.warn('AI image generation error:', e.message);
    try {
      await pushMessage(pushTo, [
        {
          type: 'text',
          text: '⚠️ สร้างรูปไม่สำเร็จ — ' + String(e.message || 'ลองใหม่').slice(0, 400)
        }
      ]);
    } catch (e2) {
      console.warn('AI image error push failed:', e2.message);
    }
  }
}

const SYSTEM_PROMPT_TEMPLATE = `คุณคือ {{name}} — {{gender_instruction}}

## กฎการพูด
- เรียกผู้ใช้ว่า "{{userCallName}}" เสมอเมื่อพูดกับเขา
- ใช้คำลงท้ายตามเพศ: {{particle_rule}}
- พูดสั้น กระชับ เหมาะกับแชท LINE (ไม่ยาวเกินไป)
- **เมื่อผู้ใช้ถามคำถาม (เช่น เวลาเข้างาน วันหยุด โปรแกรม ระบบ) ให้ตอบจากข้อมูลด้านล่างจริงๆ อย่าตอบแค่ทักทายหรือบอก "มีอะไรให้รับใช้"**

## วันที่และเวลา (อ้างอิง Bangkok — ใช้ตอบเมื่อถามว่าวันนี้วันอะไร/วันที่เท่าไหร่)
{{bangkok_date}}

## สมองที่ใช้ตอบ (เลือกตามประเภทผู้ใช้ที่ผูก LINE แล้ว)
{{brain_label}}

## สิ่งที่ระบบตอบอัตโนมัติอยู่แล้ว (อย่าตอบซ้ำหรือขัดแย้ง)
{{systemRulesSummary}}

## ข้อมูลวันนี้จากระบบ (เวลาเข้างานวันนี้)
{{today_context}}

## ที่มาข้อมูลจากระบบ (ต้องตอบจากส่วนใน "ข้อมูลจากระบบ" ด้านล่างเท่านั้น — แต่ละส่วนมาจาก Firestore ดังนี้)
- [ผู้จัดการ] ← เฉพาะคนที่ position หรือ role = "ผู้จัดการ" (มีได้ 1 คน) — ตอบชื่อจากส่วนนี้เท่านั้น อย่าดึงจากรายชื่อเจ้าหน้าที่
- [ประธานฯ] ← เฉพาะประธานหลัก (มีได้ 1 คน) — ตอบชื่อจากส่วนนี้เท่านั้น
- [วันลาคงเหลือของผู้นี้] ← leave_balances (doc = userId_ปีพ.ศ. ฟิลด์ items ตามประเภทลา) — ใช้ตอบ "วันลาเหลือเท่าไหร่/ลาป่วยเหลือกี่วัน" เท่านั้น
- [วันหยุด/วันหยุดขัตฤกษ์] ← holidays + รายการ static
- [อัตราดอกเบี้ย] ← cms_site/settings.interestRates (sync หน้าแรกเว็บ) — ใช้ตอบอัตราดอกเบี้ยฝาก/กู้ % ต่อปี (สมาชิก)
- [แบบฟอร์มดาวน์โหลด] ← cms_pages/7934 (sync หน้า /download) — แบบฟอร์มและเอกสาร PDF (สมาชิก)
- [เวลาทำการเข้างาน] ← config/org (attendanceWorkStart)
- [ประเภทการลา] ← leave_types (โควต้า/ปี — ใช้ตอบประเภทมีอะไรบ้าง ไม่ใช้แทนวันลาคงเหลือ)
- [โครงสร้างองค์กร] ← config/org (departments, units, positions, กรรมการ)
- [เจ้าหน้าที่] [กรรมการ] ← users แต่ละคนมี "ตำแหน่ง" ในรายการ — ใช้แยกตามตำแหน่งเมื่อถาม (เช่น ใครเป็นหัวหน้า = ดูที่ตำแหน่งในรายชื่อ)
- [รายการลาล่าสุด — ใครลาวันไหน] ← leaves (approved/pending)
- เข้า-ออกงานย้อนหลัง ← attendance_log + users (lineUserId)
- [โปรแกรม/คอมพิวเตอร์] ← programs
- [ระบบและบริการ] ← systems
ถ้าส่วนใดไม่มีใน "ข้อมูลจากระบบ" ด้านล่าง = ยังไม่มีข้อมูลหรือระบบโหลดไม่ได้ — ให้ตอบว่า "ยังไม่มีข้อมูลในระบบ" หรือ "แนะนำให้ติดต่อเจ้าหน้าที่" อย่าใช้ส่วนอื่นแทนหรือเดาข้อมูล

## ข้อมูลจากระบบ (วันหยุด, การลา, เข้า-ออกงานย้อนหลัง, โครงสร้าง, เจ้าหน้าที่/กรรมการ, โปรแกรม-คอม, ระบบและบริการ — ใช้ตอบเมื่อผู้ใช้ถาม)
{{data_context}}

## ความจำที่คุณมี (ใช้ตอบตามนี้เมื่อเกี่ยวข้อง)
{{memory_block}}

## ข้อกำหนดเพิ่มเติม
- ถ้าผู้ใช้ถามคำถามเฉพาะ (เวลาเข้างาน, วันหยุด, โปรแกรม, ระบบ ฯลฯ) ให้ตอบจากข้อมูลด้านบนทันที อย่าตอบแค่ "สวัสดี" หรือ "มีอะไรให้รับใช้"
- เมื่อถามเรื่องวันลาคงเหลือ (เช่น วันลาเหลือเท่าไหร่ ลาป่วยเหลือกี่วัน ลากิจเหลือ ลาพักผ่อนเหลือ): ให้ตอบจากส่วน [วันลาคงเหลือของผู้นี้] เท่านั้น — แยกบอกแต่ละประเภทตามตัวเลขที่มี (กิจส่วนตัว เหลือ X วัน, ป่วย เหลือ Y วัน, พักผ่อน เหลือ Z วัน). อย่าตอบแค่ตัวเลขเดียวและอย่าใช้โควต้าจาก [ประเภทการลา] แทน. ถ้าไม่มีส่วน [วันลาคงเหลือของผู้นี้] ในข้อมูล ให้ตอบว่า "ข้อมูลวันลาเหลือของเจ้านายยังไม่มีบันทึกในระบบ แนะนำให้ติดต่อเจ้าหน้าที่" อย่าหยิบตัวเลขจากที่อื่นมาเดา
- เมื่อตอบชื่อบุคคล ให้ใช้ชื่อตามที่อยู่ในข้อมูลตรงตัว (รวมคำนำหน้าชื่อ เช่น นาง, นาย, น.ส., ดร.) อย่าเปลี่ยนหรือเดาคำนำหน้าชื่อเอง
- เมื่อถามว่า "ประธานชื่ออะไร" โดยไม่ระบุประเภท: ให้ตอบประธานสูงสุดคือ ประธานกรรมการดำเนินการ (ใช้ชื่อจาก [ประธานฯ]). ถ้าผู้ใช้ถามเฉพาะเจาะจง (เช่น ประธานกู้เงิน) ค่อยตอบตามนั้น หรือถามกลับว่า "ประธานอะไรคะ เช่น ประธานดำเนินการ ประธานกู้เงิน"
- ถ้าไม่แน่ใจหรือไม่รู้ ให้บอกตรงๆ และเสนอให้ติดต่อเจ้าหน้าที่
- ไม่สร้างข้อมูลเท็จเกี่ยวกับองค์กรหรือตัวบุคคล`;

function hasTriggerWord(text, words) {
  if (!text || !Array.isArray(words) || words.length === 0) return true;
  const t = text.trim().toLowerCase();
  return words.some(w => t.includes((w || '').toString().trim().toLowerCase()));
}

const THAI_DAYS = ['อาทิตย์', 'จันทร์', 'อังคาร', 'พุธ', 'พฤหัสบดี', 'ศุกร์', 'เสาร์'];
const THAI_MONTHS = ['มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน', 'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม'];

function getBangkokNow() {
  const now = new Date();
  const utc = now.getTime() + now.getTimezoneOffset() * 60000;
  return new Date(utc + 420 * 60000);
}

/** วันที่และเวลาปัจจุบัน (Bangkok) เป็นข้อความภาษาไทย สำหรับใส่ใน prompt */
function formatBangkokDateThai() {
  const b = getBangkokNow();
  const day = b.getDate();
  const month = THAI_MONTHS[b.getMonth()];
  const year = b.getFullYear() + 543;
  const dayOfWeek = THAI_DAYS[b.getDay()];
  const h = b.getHours();
  const m = b.getMinutes();
  return `วันนี้วันที่ ${day} ${month} ${year} วัน${dayOfWeek} (เวลา ${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')} น. Bangkok)`;
}

/** Bangkok date → dateId DDMMYYYY */
function getDateIdForBangkok(bangkokDate) {
  const d = bangkokDate.getDate();
  const m = bangkokDate.getMonth() + 1;
  const y = bangkokDate.getFullYear();
  return String(d).padStart(2, '0') + String(m).padStart(2, '0') + String(y);
}

/** Bangkok time → dateId DDMMYYYY (today) */
function getTodayDateIdLocal() {
  return getDateIdForBangkok(getBangkokNow());
}

/** ตัดคำนำหน้าชื่อไทย (นาย, นาง, ว่าที่ ร.ต. ฯลฯ) เพื่อจับคู่กับแถวจาก ATT2Mobile — ต้องตรงกับ Admin/Leave */
function normStaffNameForMatch(str) {
  if (!str || typeof str !== 'string') return '';
  let s = str.trim().replace(/\s+/g, ' ');
  const prefixes = [/^นาง\s+/i, /^นาย\s+/i, /^น\.ส\.\s*/i, /^นส\.\s*/i, /^ด\.ช\.\s*/i, /^ด\.ญ\.\s*/i, /^ว่าที่\s*ร\.ต\.\s*(หญิง\s*)?/i, /^ร\.ต\.\s*/i, /^พล\.ต\.\s*/i];
  for (const p of prefixes) s = s.replace(p, '');
  return s.trim();
}

function findAttendanceRow(rows, user) {
  if (!rows || !Array.isArray(rows) || !user) return null;
  const code = (user.workCode != null ? user.workCode : user.employeeCode != null ? user.employeeCode : user.username || user.code || user.id || '').toString().trim();
  const name = (user.fullname || user.nameTH || user.displayName || user.name || '').toString().trim();
  const normName = normStaffNameForMatch(name);
  for (const r of rows) {
    const rc = (r.code != null ? r.code : '').toString().trim();
    if (code && rc && String(rc).replace(/^0+/, '') === String(code).replace(/^0+/, '')) return r;
    const rn = (r.name || '').toString().trim();
    const normRn = normStaffNameForMatch(rn);
    if (normName && normRn && normName === normRn) return r;
    if (normName && normRn && normName.length >= 3 && (normRn.indexOf(normName) >= 0 || normName.indexOf(normRn) >= 0)) return r;
  }
  return null;
}

/**
 * ดึงข้อความ "ข้อมูลเข้างานวันนี้" สำหรับใส่ใน system prompt
 * ใช้ users (lineUserId) และ attendance_log (dateId)
 * @param {Function} firebaseGet - (collection, docId) => Promise<doc>
 * @param {Function} firebaseQuery - (collection, field, value) => Promise<user>
 */
async function getTodayAttendanceContext(firebaseGet, firebaseQuery, lineUserId) {
  if (!lineUserId || !firebaseGet || !firebaseQuery) return '';
  let user;
  try {
    user = await firebaseQuery('users', 'lineUserId', lineUserId);
  } catch (e) {
    return '';
  }
  if (!user) return '';
  const dateId = getTodayDateIdLocal();
  let log;
  try {
    log = await firebaseGet('attendance_log', dateId);
  } catch (e) {
    return '';
  }
  const rows = (log && log.rows && Array.isArray(log.rows)) ? log.rows : [];
  const row = findAttendanceRow(rows, user);
  const staffName = (user.fullname || user.nameTH || user.displayName || user.name || 'ผู้ใช้').toString().trim();
  if (!row) {
    return `วันนี้ (${dateId}) ยังไม่มีรายการเข้างานของ ${staffName} ในระบบ — ถ้าผู้ใช้ถามเวลาเข้างาน ให้บอกตามนี้และเสนอให้เช็คตารางหรือติดต่อเจ้าหน้าที่`;
  }
  const checkIn = (row.checkIn != null ? row.checkIn : row.check_in != null ? row.check_in : '').toString().trim();
  const checkOut = (row.checkOut != null ? row.checkOut : row.check_out != null ? row.check_out : '').toString().trim();
  const parts = [];
  if (checkIn) parts.push(`${staffName} เข้างานเวลา ${checkIn} น.`);
  if (checkOut) parts.push(`ออกงานเวลา ${checkOut} น.`);
  if (parts.length === 0) return `วันนี้มีรายการของ ${staffName} ในระบบแต่ยังไม่มีเวลาเข้า-ออก — ให้บอกตามนี้ถ้าผู้ใช้ถาม`;
  return 'ข้อมูลเข้างานวันนี้: ' + parts.join(', ');
}

/**
 * ดึงข้อมูลเข้า-ออกงานย้อนหลังหลายวัน (วันนี้ + เมื่อวาน + ...) สำหรับ user ที่ผูก lineUserId
 * @param {number} daysBack - จำนวนวันย้อนหลัง (รวมวันนี้) สูงสุด 14
 */
async function getAttendanceContextMultiDay(firebaseGet, firebaseQuery, lineUserId, daysBack = 7) {
  if (!lineUserId || !firebaseGet || !firebaseQuery) return '';
  let user;
  try {
    user = await firebaseQuery('users', 'lineUserId', lineUserId);
  } catch (e) { return ''; }
  if (!user) return '';
  const staffName = (user.fullname || user.nameTH || user.displayName || user.name || 'ผู้ใช้').toString().trim();
  const limit = Math.min(14, Math.max(1, parseInt(daysBack, 10) || 7));
  const b = getBangkokNow();
  const lines = [];
  for (let i = 0; i < limit; i++) {
    const d = new Date(b.getTime());
    d.setDate(d.getDate() - i);
    const dateId = getDateIdForBangkok(d);
    let log;
    try {
      log = await firebaseGet('attendance_log', dateId);
    } catch (e) { continue; }
    const rows = (log && log.rows && Array.isArray(log.rows)) ? log.rows : [];
    const row = findAttendanceRow(rows, user);
    if (!row) continue;
    const checkIn = (row.checkIn != null ? row.checkIn : row.check_in != null ? row.check_in : '').toString().trim();
    const checkOut = (row.checkOut != null ? row.checkOut : row.check_out != null ? row.check_out : '').toString().trim();
    const label = i === 0 ? 'วันนี้' : (i === 1 ? 'เมื่อวาน' : `${i} วันที่แล้ว`);
    const dateStr = `${d.getDate()}/${d.getMonth() + 1}/${d.getFullYear() + 543}`;
    if (checkIn || checkOut) {
      lines.push(`${label} (${dateStr}): เข้า ${checkIn || '-'}, ออก ${checkOut || '-'}`);
    }
  }
  if (lines.length === 0) return `ไม่มีข้อมูลเข้า-ออกงานย้อนหลัง ${limit} วันของ ${staffName} ในระบบ`;
  return 'เข้า-ออกงานย้อนหลัง:\n' + lines.join('\n');
}

function rulesArrayToSummary(rules) {
  if (!Array.isArray(rules) || !rules.length) return '';
  return rules.map((r) => (r && r.text != null ? String(r.text).trim() : '')).filter(Boolean).join('\n');
}

/**
 * ตรวจประเภทผู้ใช้จากบัญชีที่ผูก LINE → เลือกสมอง (staff | member)
 */
async function resolveAiBrainAudience(firebaseGet, firebaseQuery, lineUserId) {
  try {
    const follower = firebaseGet ? await firebaseGet('line_followers', lineUserId).catch(() => null) : null;
    const memberId = follower && (follower.memberId || follower.linkedUserId);
    let userData = null;
    if (memberId && firebaseGet) userData = await firebaseGet('users', memberId).catch(() => null);
    if (!userData && firebaseQuery && lineUserId) {
      userData = await firebaseQuery('users', 'lineUserId', lineUserId).catch(() => null);
    }
    if (!userData) {
      return { audience: 'member', label: 'สมองสมาชิกสหกรณ์ (บริการสมาชิก — ไม่ต้องผูกบัญชี)' };
    }
    const group = String(userData.group || userData.userGroup || '').trim();
    const role = String(userData.role || '').trim();
    if (group === 'สมาชิก') {
      return { audience: 'member', label: 'สมองสมาชิกสหกรณ์ (ผู้ใช้: สมาชิก)', user: userData };
    }
    if (group === 'เจ้าหน้าที่' || group === 'staff') {
      return { audience: 'staff', label: 'สมองเจ้าหน้าที่ & กรรมการ (ผู้ใช้: เจ้าหน้าที่)', user: userData };
    }
    if (group === 'กรรมการ') {
      return { audience: 'staff', label: 'สมองเจ้าหน้าที่ & กรรมการ (ผู้ใช้: กรรมการ)', user: userData };
    }
    if (role === 'ผู้ดูแลระบบ' || role.indexOf('ผู้ดูแล') >= 0) {
      return { audience: 'staff', label: 'สมองเจ้าหน้าที่ & กรรมการ (ผู้ใช้: ผู้ดูแลระบบ)', user: userData };
    }
    return { audience: 'member', label: 'สมองสมาชิกสหกรณ์ (กลุ่ม: ' + (group || 'ไม่ระบุ') + ')', user: userData };
  } catch (e) {
    return { audience: 'member', label: 'สมองสมาชิกสหกรณ์ (ตรวจสอบผู้ใช้ไม่ได้ — ใช้กรอบสมาชิก)' };
  }
}

function pickSystemRulesSummary(cfg, audience) {
  const staffRules = Array.isArray(cfg.systemRulesStaff) && cfg.systemRulesStaff.length
    ? cfg.systemRulesStaff
    : (Array.isArray(cfg.systemRules) ? cfg.systemRules : []);
  const memberRules = Array.isArray(cfg.systemRulesMember) ? cfg.systemRulesMember : [];
  if (audience === 'staff') {
    const summary = rulesArrayToSummary(staffRules);
    return summary || String(cfg.systemRulesStaffSummary || cfg.systemRulesSummary || 'ไม่มีกฎพิเศษ').trim() || 'ไม่มีกฎพิเศษ';
  }
  const summary = rulesArrayToSummary(memberRules);
  return summary || String(cfg.systemRulesMemberSummary || 'ไม่มีกฎสำหรับสมาชิก').trim() || 'ไม่มีกฎสำหรับสมาชิก';
}

/**
 * สร้างบล็อกข้อมูลจาก DB สำหรับใส่ใน system prompt (วันหยุด, การลา, โครงสร้าง, เจ้าหน้าที่, โปรแกรม, ระบบ, เข้า-ออกงานย้อนหลัง)
 * @param {object} deps - { firebaseGet, firebaseGetCollection, firebaseQuery }
 * @param {string} lineUserId - LINE user ID ของผู้ส่ง (ใช้ดึง user จาก users และเข้า-ออกงาน)
 * @param {string} audience - 'staff' | 'member'
 */
async function buildDataContext(deps, lineUserId, audience) {
  const isMemberBrain = audience === 'member';
  const { firebaseGet, firebaseGetCollection, firebaseQuery } = deps;
  if (!firebaseGet || !firebaseGetCollection) return '';
  const sections = [];
  const b = getBangkokNow();
  const currentYear = b.getFullYear() + 543;

  let user = null;
  if (firebaseQuery && lineUserId) {
    try {
      user = await firebaseQuery('users', 'lineUserId', lineUserId);
    } catch (e) {}
  }
  if (!user && firebaseGet && lineUserId) {
    try {
      const follower = await firebaseGet('line_followers', lineUserId);
      const memberId = follower && (follower.memberId || follower.linkedUserId);
      if (memberId) user = await firebaseGet('users', memberId);
    } catch (e) {}
  }

  const safe = (p) => p.catch(() => null);

  // วันหยุด, ประเภทลา, config องค์กร/ลา, config AI (สำหรับตั้งค่าผู้จัดการ/ประธานโดยตรง)
  const [holidaysList, leaveTypesList, orgCfg, leaveCfg, usersList, programsList, systemsList, leavesList, aiChatCfg, cmsSiteCfg, downloadPageCfg] = await Promise.all([
    safe(firebaseGetCollection('holidays')),
    safe(firebaseGetCollection('leave_types')),
    safe(firebaseGet('config', 'org')),
    safe(firebaseGet('config', 'leave')),
    safe(firebaseGetCollection('users', { pageSize: 500 })),
    safe(firebaseGetCollection('programs', { pageSize: 300 })),
    safe(firebaseGetCollection('systems', { pageSize: 300 })),
    safe(firebaseGetCollection('leaves', { pageSize: 500 })),
    safe(firebaseGet('config', 'ai_chat')),
    safe(firebaseGet('cms_site', 'settings')),
    safe(firebaseGet('cms_pages', '7934'))
  ]);

  const holidays = Array.isArray(holidaysList) ? holidaysList : [];
  const leaveTypes = Array.isArray(leaveTypesList) ? leaveTypesList : [];
  const users = Array.isArray(usersList) ? usersList : [];
  const cfg = aiChatCfg && typeof aiChatCfg === 'object' ? aiChatCfg : {};
  const programs = Array.isArray(programsList) ? programsList : [];
  const systems = Array.isArray(systemsList) ? systemsList : [];
  const leaves = Array.isArray(leavesList) ? leavesList : [];

  // ---- วันหยุด (รวม static + Firestore, ตั้งค่า "สหกรณ์ไม่หยุด" จาก Firestore hidden) ----
  const holidayLines = buildCoopHolidayContextLines(holidays, {
    now: b,
    futureOnly: !isMemberBrain,
    maxItems: isMemberBrain ? null : 25
  });
  sections.push('[วันหยุด/วันหยุดขัตฤกษ์]\n' + holidayLines.join('\n'));

  // ---- เวลาทำการ (จาก config/org) ----
  const workStart = (orgCfg && orgCfg.attendanceWorkStart) ? String(orgCfg.attendanceWorkStart).trim() : '';
  if (isMemberBrain) {
    sections.push(buildMemberWorkHoursLine(orgCfg || {}));
  } else if (workStart) {
    sections.push('[เวลาทำการเข้างาน] เริ่ม ' + workStart + ' น. (อ้างอิงจากระบบเข้า-ออกงาน)');
  }

  if (isMemberBrain) {
    const cmsSite = cmsSiteCfg && typeof cmsSiteCfg === 'object' ? cmsSiteCfg : {};
    sections.push('[ช่องทางติดต่อสหกรณ์]\n' + buildMemberContactContextLines(orgCfg || {}, cmsSite).join('\n'));
    sections.push('[อัตราดอกเบี้ย]\n' + buildMemberInterestRatesContextLines(cmsSite).join('\n'));
    const downloadHtml = downloadPageCfg && downloadPageCfg.contentHtml ? String(downloadPageCfg.contentHtml) : '';
    const downloadSections = parseDownloadSections(downloadHtml, cmsSite.downloadPatches || []);
    if (downloadSections.length) {
      sections.push('[แบบฟอร์มดาวน์โหลด]\n' + buildMemberDownloadsContextLines(downloadSections).join('\n'));
    }
    if (user) {
      const nm = (user.fullname || user.nameTH || user.displayName || user.name || '').trim();
      const mno = (user.username || user.memberId || '').trim();
      if (nm || mno) {
        sections.push('[สมาชิกที่ผูก LINE]\n' + [nm && 'ชื่อ: ' + nm, mno && 'เลขสมาชิก: ' + mno].filter(Boolean).join('\n'));
      }
    }
    const userCallName = (user && user.aiChatCallName != null && String(user.aiChatCallName).trim() !== '')
      ? String(user.aiChatCallName).trim()
      : null;
    return { dataContextStr: sections.join('\n\n'), userCallName };
  }

  // ---- ประเภทการลา + โควต้า ----
  if (leaveTypes.length > 0) {
    const ltLines = leaveTypes.map((t) => `${t.name || t.id || '-'}: โควต้า ${t.yearlyQuota != null ? t.yearlyQuota : t.quota != null ? t.quota : '-'} วัน/ปี`).join('\n');
    sections.push('[ประเภทการลา]\n' + ltLines);
  }

  // ---- โครงสร้าง (config/org) ----
  if (orgCfg) {
    const depts = Array.isArray(orgCfg.departments) ? orgCfg.departments : [];
    const units = Array.isArray(orgCfg.units) ? orgCfg.units : [];
    const positions = Array.isArray(orgCfg.positions) ? orgCfg.positions : [];
    const committeePositions = Array.isArray(orgCfg.committeePositions) ? orgCfg.committeePositions : [];
    const committeeSets = Array.isArray(orgCfg.committeeSets) ? orgCfg.committeeSets : [];
    const committeeGroups = Array.isArray(orgCfg.committeeGroups) ? orgCfg.committeeGroups : [];
    const orgLines = [];
    if (depts.length > 0) orgLines.push('ฝ่าย/แผนก: ' + depts.map((x) => (typeof x === 'string' ? x : x.name || x)).join(', '));
    if (units.length > 0) orgLines.push('หน่วย: ' + units.map((x) => (typeof x === 'string' ? x : x.name || x)).join(', '));
    if (positions.length > 0) orgLines.push('ตำแหน่ง: ' + positions.map((x) => (typeof x === 'string' ? x : x.name || x)).join(', '));
    if (committeePositions.length > 0) orgLines.push('ตำแหน่งกรรมการ: ' + committeePositions.map((x) => (typeof x === 'string' ? x : x.name || x)).join(', '));
    if (committeeSets.length > 0 || committeeGroups.length > 0) orgLines.push('คณะกรรมการ/ชุด: ' + [...(committeeSets || []), ...(committeeGroups || [])].map((x) => (typeof x === 'string' ? x : x.name || x)).join(', '));
    if (orgLines.length > 0) sections.push('[โครงสร้างองค์กร]\n' + orgLines.join('\n'));
  }

  // ---- เจ้าหน้าที่ / กรรมการ (เจ้าหน้าที่ = ทุกคนที่ไม่ได้อยู่ในกลุ่มกรรมการ, ตรงกับที่ Admin แสดงในแท็บเจ้าหน้าที่) ----
  const committee = users.filter((u) => u.group === 'กรรมการ' && (u.fullname || u.nameTH || u.displayName || u.id));
  const staff = users.filter((u) => u.group !== 'กรรมการ' && (u.fullname || u.nameTH || u.displayName || u.id));
  const pos = (u) => String(u.position || '').trim();
  const roleStr = (u) => String(u.role || '').trim();
  const comm = (u) => String(u.committeePosition || '').trim();
  const staffLines = staff.slice(0, 80).map((u) => {
    const name = (u.fullname || u.nameTH || u.displayName || u.name || u.id || '').toString().trim();
    const position = pos(u) || roleStr(u) || '-';
    const linked = u.lineUserId ? 'ผูกไลน์' : 'ยังไม่ผูกไลน์';
    const start = u.employmentStart || u.startDate || '';
    const age = start ? (() => { try { const y = new Date(start).getFullYear(); const nowY = b.getFullYear(); return String(nowY - y) + ' ปี'; } catch (e) { return '-'; } })() : '-';
    return `${name} — ตำแหน่ง: ${position} (${linked}, อายุงาน ${age})`;
  });
  const committeeLines = committee.slice(0, 50).map((u) => {
    const name = (u.fullname || u.nameTH || u.displayName || u.name || u.id || '').toString().trim();
    const position = comm(u) || pos(u) || roleStr(u) || '-';
    const linked = u.lineUserId ? 'ผูกไลน์' : 'ยังไม่ผูกไลน์';
    return `${name} — ตำแหน่ง: ${position} (${linked})`;
  });
  if (staffLines.length > 0) sections.push('[เจ้าหน้าที่] ทั้งหมด ' + staff.length + ' คน (ชื่อ — ตำแหน่ง, ผูกไลน์/ยังไม่ผูก, อายุงาน)\n' + staffLines.join('\n'));
  if (committeeLines.length > 0) sections.push('[กรรมการ] ทั้งหมด ' + committee.length + ' คน (ชื่อ — ตำแหน่ง)\n' + committeeLines.join('\n'));

  // ---- ผู้จัดการ / ประธาน: ถ้าแอดมินตั้งค่า managerUserId/chairUserId ใน config/ai_chat ใช้คนนั้นตรง ๆ ไม่然ค่อยกรองจาก position ----
  const nameOf = (u) => (u && (u.fullname || u.nameTH || u.displayName || u.id)) || '';
  let managers = [];
  let chair = [];
  if (cfg.managerUserId) {
    const u = users.find((x) => x.id === cfg.managerUserId);
    if (u) managers = [u];
  }
  if (cfg.chairUserId) {
    const u = users.find((x) => x.id === cfg.chairUserId);
    if (u) chair = [u];
  }
  if (managers.length === 0) {
    const isManager = (u) => {
      const p = pos(u);
      if (p.includes('รอง')) return false;
      return p === 'ผู้จัดการ' || roleStr(u) === 'ผู้จัดการ';
    };
    managers = users.filter(isManager);
    if (managers.length > 1) managers = managers.slice(0, 1);
  }
  if (chair.length === 0) {
    const isMainChair = (s) => {
      const t = String(s || '').trim();
      if (!t) return false;
      if (t === 'ประธานกรรมการ' || t === 'ประธาน') return true;
      if (/^ประธานกรรมการ\s*(\(ชุดที่\s*\d+\))?$/.test(t)) return true;
      if (t.includes('ประธานกรรมการ') && !t.includes('ดำเนินการ') && !t.includes('อำนวยการ') && !t.includes('เงินกู้')) return true;
      return false;
    };
    const isChairDern = (u) => /ประธานกรรมการดำเนินการ|ประธานดำเนินการ/i.test(comm(u)) || /ประธานกรรมการดำเนินการ|ประธานดำเนินการ/i.test(pos(u));
    chair = users.filter((u) => isMainChair(pos(u)) || isMainChair(comm(u)));
    if (chair.length === 0) {
      const anyWithChair = users.filter((u) => /ประธาน/i.test(pos(u)) || /ประธาน/i.test(comm(u)));
      const chairDern = anyWithChair.filter(isChairDern);
      chair = (chairDern.length > 0 ? chairDern : anyWithChair).slice(0, 1);
    }
    if (chair.length > 1) {
      const chairDern = chair.filter(isChairDern);
      chair = (chairDern.length > 0 ? chairDern : chair).slice(0, 1);
    }
  }
  if (managers.length > 0) sections.push('[ผู้จัดการ] ' + managers.map((u) => nameOf(u)).join(', '));
  if (chair.length > 0) sections.push('[ประธานฯ] (ประธานกรรมการดำเนินการ — ประธานสูงสุด) ' + chair.map((u) => nameOf(u)).join(', '));

  // ---- การลา: ค balance ของ user นี้ (Admin ใช้ doc id = userId_ปีค.ศ. เช่น xxx_2026 ไม่ใช่ปีพ.ศ.) ----
  let leaveBalDocId = '';
  if (user && user.id) {
    const yearGregorian = b.getFullYear();
    leaveBalDocId = user.id + '_' + yearGregorian;
    const balanceDoc = await safe(firebaseGet('leave_balances', leaveBalDocId));
    const hasDoc = !!balanceDoc && typeof balanceDoc === 'object';
    const items = balanceDoc && typeof balanceDoc.items === 'object' ? balanceDoc.items : (balanceDoc && !balanceDoc.items ? balanceDoc : null);
    const itemKeys = items && typeof items === 'object' ? Object.keys(items) : [];
    const balLines = (items && typeof items === 'object')
      ? Object.entries(items)
          .filter(([, v]) => v && typeof v === 'object' && (v.remaining != null || v.remaining === 0))
          .map(([k, v]) => {
            const t = leaveTypes.find((ty) => String(ty.id) === String(k));
            const typeName = (t && (t.nameTH || t.name)) || k;
            const remain = v.remaining != null ? Number(v.remaining) : (v.quota != null && v.used != null ? Math.max(0, Number(v.quota) - Number(v.used)) : '-');
            return `${typeName}: เหลือ ${remain} วัน`;
          })
      : [];
    if (balLines.length > 0) sections.push('[วันลาคงเหลือของผู้นี้]\n' + balLines.join('\n'));
    if (leaveBalDocId && (leaveBalDocId.length < 50)) {
      console.log('[leave_balances] docId=' + leaveBalDocId + ' gotDoc=' + (hasDoc ? 'yes' : 'no') + ' itemsKeys=' + itemKeys.length + ' balLines=' + balLines.length);
    }
  }
  const recentLeaves = leaves
    .filter((l) => l.status === 'approved' || l.status === 'pending')
    .sort((a, b) => (b.startDate || '').localeCompare(a.startDate || ''))
    .slice(0, 30);
  if (recentLeaves.length > 0) {
    const leaveLines = recentLeaves.map((l) => {
      const who = l.userName || l.fullname || l.userId || '-';
      const type = l.leaveType || l.type || '-';
      const range = (l.startDate || '-') + ' ถึง ' + (l.endDate || '-');
      return `${who}: ${type} ${range}`;
    }).join('\n');
    sections.push('[รายการลาล่าสุด — ใครลาวันไหน]\n' + leaveLines);
  }

  // ---- เข้า-ออกงานย้อนหลัง (ของ user นี้) ----
  const attendanceMulti = await getAttendanceContextMultiDay(firebaseGet, firebaseQuery, lineUserId, 7);
  if (attendanceMulti) sections.push(attendanceMulti);

  // ---- โปรแกรมและคอมพิวเตอร์ (ใครใช้เครื่องไหน) ----
  if (programs.length > 0) {
    const progLines = programs.slice(0, 40).map((p) => {
      const name = (p.name || p.computerName || p.id || '').toString().trim();
      const user = (p.userName || p.fullname || p.user || '').toString().trim();
      const detail = (p.detail || p.notes || '').toString().trim().substring(0, 60);
      return user ? `${name}: ใช้โดย ${user}${detail ? ' — ' + detail : ''}` : `${name}${detail ? ': ' + detail : ''}`;
    }).join('\n');
    sections.push('[โปรแกรม/คอมพิวเตอร์]\n' + progLines);
  }

  // ---- ระบบและบริการ (รายการ, ต่ออายุ, คงเหลือ, สถานะ) ----
  if (systems.length > 0) {
    const sysLines = systems.slice(0, 40).map((s) => {
      const name = (s.name || s.id || '').toString().trim();
      const expiry = s.expiryDate || s.endDate || s.renewalDate || '';
      const remaining = s.remaining != null ? s.remaining : (s.daysLeft != null ? s.daysLeft : '');
      const status = (s.status || s.licenseStatus || '').toString().trim();
      return `${name}: หมดอายุ/ต่ออายุ ${expiry || '-'}, คงเหลือ ${remaining !== '' ? remaining : '-'}, สถานะ ${status || '-'}`;
    }).join('\n');
    sections.push('[ระบบและบริการ]\n' + sysLines);
  }

  const hasLeaveBal = sections.some((s) => String(s).indexOf('[วันลาคงเหลือของผู้นี้]') >= 0);
  console.log('[AI context] users=' + users.length + ' managers=' + managers.length + ' leaveBal=' + (hasLeaveBal ? 'yes' : 'no') + ' linkedUser=' + (user && user.id ? 'yes' : 'no') + ' sections=' + sections.length);

  const userCallName = (user && user.aiChatCallName != null && String(user.aiChatCallName).trim() !== '')
    ? String(user.aiChatCallName).trim()
    : null;
  return { dataContextStr: sections.join('\n\n'), userCallName };
}

function buildSystemPrompt(cfg, memoryLines, todayContext, bangkokDateStr, dataContextStr, userCallNameOverride, audience, brainLabel) {
  const name = (cfg.name || 'โมเน่').trim();
  const gender = (cfg.gender || 'female').toString().toLowerCase();
  const userCallName = (userCallNameOverride != null && String(userCallNameOverride).trim() !== '')
    ? String(userCallNameOverride).trim()
    : (cfg.userCallName || 'คุณ').trim();
  const genderInstruction = gender === 'male'
    ? 'ผู้ช่วย (ผู้ชาย)'
    : 'เลขาส่วนตัวของคุณผู้ชาย (ผู้หญิง)';
  const particleRule = gender === 'male'
    ? 'ใช้ "ครับ" ทุกครั้ง'
    : 'ใช้ "คะ/ค่ะ" ทุกครั้ง';
  const aud = audience === 'staff' ? 'staff' : 'member';
  const systemRulesSummary = pickSystemRulesSummary(cfg, aud);
  const brain_label = (brainLabel && String(brainLabel).trim()) || (aud === 'staff' ? 'สมองเจ้าหน้าที่ & กรรมการ' : 'สมองสมาชิกสหกรณ์');
  const today_context = (todayContext && todayContext.trim())
    ? todayContext.trim()
    : '(ไม่มีข้อมูลเข้างานวันนี้จากระบบ — ถ้าผู้ใช้ถาม ให้บอกตามนี้และเสนอให้เช็คตารางหรือติดต่อเจ้าหน้าที่)';
  const bangkok_date = (bangkokDateStr && bangkokDateStr.trim()) ? bangkokDateStr.trim() : '(ไม่ระบุ)';
  const data_context = (dataContextStr && dataContextStr.trim()) ? dataContextStr.trim() : '(ไม่มีข้อมูลเพิ่มเติมจากระบบ)';
  const memory_block = memoryLines.length > 0
    ? memoryLines.map(m => '- ' + m).join('\n')
    : '(ยังไม่มีความจำที่บันทึก)';

  return SYSTEM_PROMPT_TEMPLATE
    .replace(/\{\{name\}\}/g, name)
    .replace(/\{\{gender_instruction\}\}/g, genderInstruction)
    .replace(/\{\{userCallName\}\}/g, userCallName)
    .replace(/\{\{particle_rule\}\}/g, particleRule)
    .replace(/\{\{brain_label\}\}/g, brain_label)
    .replace(/\{\{systemRulesSummary\}\}/g, systemRulesSummary)
    .replace(/\{\{bangkok_date\}\}/g, bangkok_date)
    .replace(/\{\{today_context\}\}/g, today_context)
    .replace(/\{\{data_context\}\}/g, data_context)
    .replace(/\{\{memory_block\}\}/g, memory_block);
}

async function getAiMemory(firebaseGetCollection, userId, groupId, maxPerScope) {
  const limit = Math.min(50, Math.max(5, parseInt(maxPerScope, 10) || 20));
  let list = [];
  try {
    list = await firebaseGetCollection('ai_memory');
  } catch (e) {
    return [];
  }
  const now = Date.now();
  const filtered = (list || []).filter(m => {
    if (m.scope === 'global') return true;
    if (m.scope === 'user' && m.scopeId === userId) return true;
    if (groupId && m.scope === 'group' && m.scopeId === groupId) return true;
    return false;
  });
  const byScope = (a, b) => {
    const order = { global: 0, group: 1, user: 2 };
    return (order[a.scope] || 2) - (order[b.scope] || 2);
  };
  const getTime = (v) => {
    if (v == null) return 0;
    if (typeof v === 'number') return v;
    if (typeof v === 'string') return new Date(v).getTime();
    if (v && typeof v.toMillis === 'function') return v.toMillis();
    return 0;
  };
  filtered.sort((a, b) => getTime(b.updatedAt || b.createdAt) - getTime(a.updatedAt || a.createdAt));
  return filtered.slice(0, limit).map(m => (m.content || '').trim()).filter(Boolean);
}

function buildChatCompletionBody(model, messages, maxTokens) {
  const m = model || 'gpt-4o-mini';
  const limit = Math.min(4000, Math.max(256, parseInt(maxTokens, 10) || 1000));
  const body = { model: m, messages };
  // gpt-5 / o-series ใช้ max_completion_tokens แทน max_tokens
  if (/^gpt-5|^o[0-9]/i.test(m)) {
    body.max_completion_tokens = limit;
  } else {
    body.max_tokens = limit;
    body.temperature = 0.7;
  }
  return body;
}

async function callOpenAI(apiKey, model, systemContent, userContent) {
  if (!apiKey || !apiKey.trim()) {
    throw new Error('OpenAI API Key not configured');
  }
  const payload = buildChatCompletionBody(model, [
    { role: 'system', content: systemContent },
    { role: 'user', content: userContent }
  ], 1000);
  const body = JSON.stringify(payload);
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'api.openai.com',
      port: 443,
      path: '/v1/chat/completions',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + apiKey.trim(),
        'Content-Length': Buffer.byteLength(body, 'utf8')
      }
    };
    const req = https.request(options, (res) => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        try {
          const data = JSON.parse(Buffer.concat(chunks).toString('utf-8'));
          if (data.error) {
            reject(new Error(data.error.message || JSON.stringify(data.error)));
            return;
          }
          const content = data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;
          resolve((content || '').trim());
        } catch (e) {
          reject(e);
        }
      });
    });
    req.on('error', reject);
    req.setTimeout(30000, () => { req.destroy(); reject(new Error('OpenAI request timeout')); });
    req.write(body);
    req.end();
  });
}

/**
 * พยายามตอบด้วย AI แชท (เรียกหลัง Auto Reply ไม่ match แล้ว)
 * @param {object} deps - { replyMessage, firebaseGet, firebaseSet, firebaseGetCollection }
 * @param {string} replyToken - LINE reply token
 * @param {string} text - ข้อความจากผู้ใช้
 * @param {string} userId - LINE user ID
 * @param {object} source - { userId, groupId? }
 * @param {object} userProfile - { displayName? }
 */
function readPendingImageUrl(pending) {
  if (!pending || typeof pending !== 'object') return '';
  const url = String(pending.imageUrl || '').trim();
  if (!url) return '';
  const created = pending.createdAt ? new Date(pending.createdAt).getTime() : 0;
  if (created && Date.now() - created > 48 * 60 * 60 * 1000) return '';
  return url;
}

async function tryAiChat(deps, replyToken, text, userId, source, userProfile) {
  const { replyMessage, pushMessage, firebaseGet, firebaseSet, firebaseGetCollection, firebaseQuery } = deps;
  let cfg;
  try {
    cfg = await firebaseGet('config', 'ai_chat');
  } catch (e) {
    return;
  }
  if (!cfg || cfg.enabled !== true) return;

  const groupId = source.groupId || null;

  if (groupId) {
    const triggerWords = Array.isArray(cfg.groupTriggerWords) ? cfg.groupTriggerWords : [];
    const idleMinutes = Math.max(1, Math.min(60, parseInt(cfg.groupIdleMinutes, 10) || 5));
    let state = null;
    try {
      state = await firebaseGet('ai_chat_state', groupId);
    } catch (e) {}

    const hasTrigger = hasTriggerWord(text, triggerWords);
    const now = Date.now();
    const lastAt = state && state.lastMessageAt
      ? (state.lastMessageAt.toMillis ? state.lastMessageAt.toMillis() : new Date(state.lastMessageAt).getTime())
      : 0;
    const idleMs = idleMinutes * 60 * 1000;
    const isActive = lastAt > 0 && (now - lastAt) <= idleMs;

    if (!hasTrigger && !isActive) return;
    if (!hasTrigger && isActive) {
      // ยังอยู่ในช่วงคุย — อัปเดตเวลาแล้วไปต่อ
    }
    if (hasTrigger) {
      try {
        await firebaseSet('ai_chat_state', groupId, { groupId, lastMessageAt: new Date().toISOString() });
      } catch (e) {}
    }

    const allowedGroups = Array.isArray(cfg.allowedGroupIds) ? cfg.allowedGroupIds : [];
    if (allowedGroups.length > 0 && !allowedGroups.includes(groupId)) return;
  } else {
    const allowedUsers = Array.isArray(cfg.allowedUserIds) ? cfg.allowedUserIds : [];
    if (allowedUsers.length === 0) return;
    const allowAll = allowedUsers.includes('*');
    if (!allowAll && !allowedUsers.includes(userId)) return;
  }

  const displayName = (userProfile && userProfile.displayName) ? userProfile.displayName.trim() : 'ผู้ใช้';
  const userContent = groupId
    ? `[ผู้ส่ง: ${displayName}]\n\n${text}`
    : text;
  const scopeId = groupId || userId;
  const pushTo = groupId || userId;

  const sendFallback = async (msg) => {
    const fallback = msg || 'ขออภัยค่ะ ตอนนี้ตอบไม่ได้ กรุณาลองใหม่หรือติดต่อเจ้าหน้าที่';
    try {
      await replyMessage(replyToken, [{ type: 'text', text: fallback }]);
    } catch (e2) {
      console.warn('AI chat fallback reply failed:', e2.message);
    }
  };

  try {
    const apiKey = (cfg.openaiApiKey || '').trim();
    const model = (cfg.model || 'gpt-4o-mini').trim();

    let lastContext = null;
    let pendingImageUrl = '';
    try {
      lastContext = await firebaseGet('ai_chat_context', scopeId);
    } catch (_) {}
    try {
      const pending = await firebaseGet('ai_chat_pending_image', scopeId);
      pendingImageUrl = readPendingImageUrl(pending);
    } catch (_) {}

    if (aiImageGen.wantsLineImageGeneration(text) && typeof pushMessage === 'function') {
      try {
        await replyMessage(replyToken, [{
          type: 'text',
          text: '🎨 กำลังสร้างรูปให้... รอ 1–2 นาทีนะคะ ✨\n(ถ้าไม่เห็นรูป ลองพิมพ์ข้อความอีกครั้ง โมเน่จะส่งให้ในข้อความถัดไป)'
        }]);
      } catch (e) {
        console.warn('AI image ack reply failed:', e.message);
      }

      trackImageJob(
        runLineImageGeneration(
          { pushMessage, firebaseSet },
          pushTo,
          scopeId,
          groupId,
          text,
          lastContext,
          cfg,
          apiKey
        )
      );
      return;
    }

    // โหลด context พร้อมกันเพื่อให้เร็ว ลดโอกาส reply token หมดอายุ
    const brainInfo = await resolveAiBrainAudience(firebaseGet, firebaseQuery, userId).catch(() => ({
      audience: 'member',
      label: 'สมองสมาชิกสหกรณ์'
    }));
    const [memoryLines, todayContext, dataContextResult] = await Promise.all([
      getAiMemory(firebaseGetCollection, userId, groupId, cfg.memoryMaxPerScope).catch(() => []),
      brainInfo.audience === 'staff' && firebaseQuery
        ? getTodayAttendanceContext(firebaseGet, firebaseQuery, userId).catch(() => '')
        : Promise.resolve(''),
      buildDataContext({ firebaseGet, firebaseGetCollection, firebaseQuery }, userId, brainInfo.audience).catch(() => ({ dataContextStr: '', userCallName: null }))
    ]);
    const dataContextStr = dataContextResult && typeof dataContextResult === 'object' && dataContextResult.dataContextStr != null
      ? dataContextResult.dataContextStr
      : (typeof dataContextResult === 'string' ? dataContextResult : '');
    const userCallNameOverride = dataContextResult && typeof dataContextResult === 'object' ? dataContextResult.userCallName : null;
    const bangkokDateStr = formatBangkokDateThai();
    const systemContent = buildSystemPrompt(cfg, memoryLines, todayContext, bangkokDateStr, dataContextStr, userCallNameOverride, brainInfo.audience, brainInfo.label);

    let replyText;
    try {
      replyText = await callOpenAI(apiKey, model, systemContent, userContent);
    } catch (e) {
      console.warn('AI chat OpenAI error:', e.message);
      await sendFallback();
      return;
    }

    if (!replyText) {
      replyText = 'ขออภัยค่ะ ตอบไม่ทันนะคะ ลองถามใหม่ได้ค่ะ';
    }
    if (replyText.length > 5000) {
      replyText = replyText.substring(0, 4997) + '...';
    }

    const replyMessages = [];
    if (pendingImageUrl) {
      replyMessages.push({ type: 'text', text: 'สร้างรูปให้แล้วค่ะ ✨' });
      replyMessages.push({
        type: 'image',
        originalContentUrl: pendingImageUrl,
        previewImageUrl: pendingImageUrl
      });
      try {
        await firebaseSet('ai_chat_pending_image', scopeId, {
          scopeId,
          imageUrl: '',
          deliveredAt: new Date().toISOString()
        });
      } catch (_) {}
    }
    replyMessages.push({ type: 'text', text: replyText });

    try {
      await replyMessage(replyToken, replyMessages);
    } catch (e) {
      console.warn('AI chat reply error:', e.message);
      await sendFallback('ขออภัยค่ะ ส่งคำตอบไม่สำเร็จ (อาจหมดเวลา) ลองถามใหม่ได้ค่ะ');
      return;
    }

    try {
      await firebaseSet('ai_chat_context', scopeId, {
        lastUserText: text,
        lastAssistantText: replyText.slice(0, 4000),
        updatedAt: new Date().toISOString()
      });
    } catch (_) {}

    if (groupId) {
      try {
        await firebaseSet('ai_chat_state', groupId, { groupId, lastMessageAt: new Date().toISOString() });
      } catch (e) {}
    }
    console.log('✅ AI chat replied to', groupId ? 'group ' + groupId.substring(0, 8) + '...' : 'user ' + userId.substring(0, 8) + '...', 'brain=' + brainInfo.audience);
  } catch (e) {
    console.warn('AI chat error:', e.message);
    await sendFallback();
  }
}

module.exports = { tryAiChat, buildSystemPrompt, getAiMemory, getTodayAttendanceContext, callOpenAI, hasTriggerWord, drainPendingImageJobs, resolveAiBrainAudience, pickSystemRulesSummary };
