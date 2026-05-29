/**
 * LINE Webhook Server for Synology NAS
 * สหกรณ์ออมทรัพย์สาธารณสุขจังหวัดหนองคาย จำกัด
 * 
 * ดึงการตั้งค่าจาก Firebase โดยอัตโนมัติ!
 * ตั้งค่าผ่านหน้า Admin Panel → LINE → ตั้งค่า LINE
 */

const http = require('http');
const https = require('https');
const crypto = require('crypto');
const url = require('url');
const fs = require('fs');
const path = require('path');

// =====================================================
// Firebase Configuration
// =====================================================
const FIREBASE_CONFIG = {
  projectId: 'admin-panel-nkbkcoop-cbf10',
  apiKey: 'AIzaSyBEUdu_TdTfRvpBpVzdVoHqfQAtrIXAAAw'
};

/** ถ้า NAS ออกเน็ตไม่ได้ / DNS ช้า — ไม่ให้ค้างไม่มี response (เช่น POST /api/monitor-login) */
const FIREBASE_HTTP_TIMEOUT_MS = 18000;

const PORT = Number(process.env.PORT) || 3001;

/** Firebase Cloud Functions / Cloud Run — ไม่ listen พอร์ต, ไม่รัน setInterval บน instance */
const IS_SERVERLESS = !!(
  process.env.K_SERVICE ||
  process.env.FUNCTION_TARGET ||
  process.env.SKIP_HTTP_LISTEN === '1'
);

// Monitor app login sessions (token -> { username, createdAt }) — สำหรับแอป NKBKConnext เรียกจากเครื่องลูก
const MONITOR_SESSIONS = new Map();

// LINE Config (จะถูกโหลดจาก Firebase)
let LINE_CONFIG = {
  channelSecret: '',
  accessToken: ''
};

// =====================================================
// Firebase REST API Helper
// =====================================================
function firebaseGet(collection, doc) {
  return new Promise((resolve, reject) => {
    let finished = false;
    let httpReq = null;
    const timer = setTimeout(() => {
      if (finished) return;
      finished = true;
      if (httpReq) try { httpReq.destroy(); } catch (_) {}
      reject(new Error('Firestore request timed out'));
    }, FIREBASE_HTTP_TIMEOUT_MS);
    const finish = (err, val) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      if (err) reject(err);
      else resolve(val);
    };

    const path = `/v1/projects/${FIREBASE_CONFIG.projectId}/databases/(default)/documents/${collection}/${doc}?key=${FIREBASE_CONFIG.apiKey}`;
    
    const options = {
      hostname: 'firestore.googleapis.com',
      port: 443,
      path: path,
      method: 'GET',
      headers: {
        'Content-Type': 'application/json'
      }
    };

    httpReq = https.request(options, (res) => {
      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => {
        try {
          const body = Buffer.concat(chunks).toString('utf-8');
          const data = JSON.parse(body);
          if (data.fields) {
            const result = {};
            for (const [key, value] of Object.entries(data.fields)) {
              result[key] = fromFirestoreValue(value);
            }
            finish(null, result);
          } else {
            finish(null, null);
          }
        } catch (e) {
          finish(e);
        }
      });
    });

    httpReq.on('error', (e) => finish(e));
    httpReq.end();
  });
}

function fromFirestoreValue(value) {
  if (!value) return null;
  if (value.nullValue !== undefined) return null;
  if (value.stringValue !== undefined) return value.stringValue;
  if (value.booleanValue !== undefined) return value.booleanValue;
  if (value.integerValue !== undefined) return parseInt(value.integerValue, 10);
  if (value.doubleValue !== undefined) return parseFloat(value.doubleValue);
  if (value.arrayValue && value.arrayValue.values) {
    return value.arrayValue.values.map(fromFirestoreValue);
  }
  if (value.mapValue && value.mapValue.fields) {
    const obj = {};
    for (const [k, v] of Object.entries(value.mapValue.fields)) obj[k] = fromFirestoreValue(v);
    return obj;
  }
  return null;
}

/**
 * ดึง documents จาก collection (รองรับ pageSize และ pagination เพื่อให้ได้ครบทุก doc)
 * @param {string} collection - ชื่อ collection
 * @param {{ pageSize?: number }} opts - pageSize (เช่น 500) ถ้าไม่ระบุ Firestore อาจคืนแค่ ~30 รายการ
 */
function firebaseGetCollection(collection, opts) {
  const pageSize = (opts && opts.pageSize) ? Math.min(1000, Math.max(1, parseInt(opts.pageSize, 10) || 100)) : undefined;

  function doList(pageToken) {
    return new Promise((resolve, reject) => {
      let finished = false;
      let httpReq = null;
      const timer = setTimeout(() => {
        if (finished) return;
        finished = true;
        if (httpReq) try { httpReq.destroy(); } catch (_) {}
        reject(new Error('Firestore request timed out'));
      }, FIREBASE_HTTP_TIMEOUT_MS);
      const finish = (err, val) => {
        if (finished) return;
        finished = true;
        clearTimeout(timer);
        if (err) reject(err);
        else resolve(val);
      };

      let path = `/v1/projects/${FIREBASE_CONFIG.projectId}/databases/(default)/documents/${collection}?key=${FIREBASE_CONFIG.apiKey}`;
      if (pageSize) path += `&pageSize=${pageSize}`;
      if (pageToken) path += `&pageToken=${encodeURIComponent(pageToken)}`;

      const options = {
        hostname: 'firestore.googleapis.com',
        port: 443,
        path: path,
        method: 'GET'
      };

      httpReq = https.request(options, (res) => {
        const chunks = [];
        res.on('data', chunk => chunks.push(chunk));
        res.on('end', () => {
          try {
            const body = Buffer.concat(chunks).toString('utf-8');
            const data = JSON.parse(body);
            const results = [];
            if (data.documents) {
              for (const doc of data.documents) {
                const item = { id: doc.name.split('/').pop() };
                if (doc.fields) {
                  for (const [key, value] of Object.entries(doc.fields)) {
                    item[key] = fromFirestoreValue(value);
                  }
                }
                results.push(item);
              }
            }
            finish(null, { documents: results, nextPageToken: data.nextPageToken || null });
          } catch (e) {
            finish(e);
          }
        });
      });

      httpReq.on('error', (e) => finish(e));
      httpReq.end();
    });
  }

  return doList(null).then(function concat(result) {
    const all = result.documents || [];
    if (result.nextPageToken) {
      return doList(result.nextPageToken).then(function next(r) {
        all.push(...(r.documents || []));
        if (r.nextPageToken) return doList(r.nextPageToken).then(next).then(() => all);
        return all;
      });
    }
    return all;
  });
}

// Firebase Query (find document by field value)
function firebaseQuery(collection, field, value) {
  return new Promise((resolve, reject) => {
    let finished = false;
    let httpReq = null;
    const timer = setTimeout(() => {
      if (finished) return;
      finished = true;
      if (httpReq) try { httpReq.destroy(); } catch (_) {}
      reject(new Error('Firestore request timed out'));
    }, FIREBASE_HTTP_TIMEOUT_MS);
    const finish = (err, val) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      if (err) reject(err);
      else resolve(val);
    };

    const path = `/v1/projects/${FIREBASE_CONFIG.projectId}/databases/(default)/documents:runQuery?key=${FIREBASE_CONFIG.apiKey}`;
    const body = JSON.stringify({
      structuredQuery: {
        from: [{ collectionId: collection }],
        where: {
          fieldFilter: {
            field: { fieldPath: field },
            op: 'EQUAL',
            value: { stringValue: value }
          }
        },
        limit: 1
      }
    });

    const options = {
      hostname: 'firestore.googleapis.com',
      port: 443,
      path: path,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body)
      }
    };

    httpReq = https.request(options, (res) => {
      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => {
        try {
          const responseBody = Buffer.concat(chunks).toString('utf-8');
          const results = JSON.parse(responseBody);
          if (Array.isArray(results) && results.length > 0 && results[0].document) {
            const doc = results[0].document;
            const docId = doc.name.split('/').pop();
            const item = { id: docId };
            if (doc.fields) {
              for (const [key, val] of Object.entries(doc.fields)) {
                item[key] = fromFirestoreValue(val);
              }
            }
            finish(null, item);
          } else {
            finish(null, null);
          }
        } catch (e) {
          finish(e);
        }
      });
    });

    httpReq.on('error', (e) => finish(e));
    httpReq.write(body);
    httpReq.end();
  });
}

// แปลงค่าเป็น Firestore field value (รองรับ string, number, boolean, array, object)
function toFirestoreValue(value) {
  if (value === null || value === undefined) return { nullValue: null };
  if (typeof value === 'string') return { stringValue: value };
  if (typeof value === 'boolean') return { booleanValue: value };
  if (typeof value === 'number') return Number.isInteger(value) ? { integerValue: String(value) } : { doubleValue: value };
  if (Array.isArray(value)) {
    return { arrayValue: { values: value.map(v => toFirestoreValue(v)) } };
  }
  if (typeof value === 'object') {
    const mapFields = {};
    for (const [k, v] of Object.entries(value)) mapFields[k] = toFirestoreValue(v);
    return { mapValue: { fields: mapFields } };
  }
  return { nullValue: null };
}

// Firebase Set Document (merge — อ่านเดิมก่อน รวมกับใหม่ แล้วเขียนทับ ไม่ลบ field เดิม)
async function firebaseSet(collection, docId, data) {
  // 1) อ่าน document เดิม (ถ้ามี)
  let existing = {};
  try {
    const doc = await firebaseGet(collection, docId);
    if (doc) existing = doc;
  } catch (e) { /* document ยังไม่มี — สร้างใหม่ */ }

  // 2) Merge: เอาข้อมูลเดิม + ข้อมูลใหม่ (ใหม่ทับเดิม)
  const merged = { ...existing, ...data };
  // ลบ field ที่ไม่ควรเขียนกลับ (id เป็น metadata ไม่ใช่ field จริง) — ยกเว้น programs ต้องมี id ใน doc เพื่อให้ Admin แสดงผล
  if (collection !== 'programs') delete merged.id;

  // 3) แปลงเป็น Firestore fields
  const fields = {};
  for (const [key, value] of Object.entries(merged)) {
    fields[key] = toFirestoreValue(value);
  }

  const path = `/v1/projects/${FIREBASE_CONFIG.projectId}/databases/(default)/documents/${collection}/${docId}?key=${FIREBASE_CONFIG.apiKey}`;
  const body = JSON.stringify({ fields });

  return new Promise((resolve, reject) => {
    let finished = false;
    let httpReq = null;
    const timer = setTimeout(() => {
      if (finished) return;
      finished = true;
      if (httpReq) try { httpReq.destroy(); } catch (_) {}
      reject(new Error('Firestore request timed out'));
    }, FIREBASE_HTTP_TIMEOUT_MS);
    const finish = (err, val) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      if (err) reject(err);
      else resolve(val);
    };

    const options = {
      hostname: 'firestore.googleapis.com',
      port: 443,
      path: path,
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body)
      }
    };

    httpReq = https.request(options, (res) => {
      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => {
        try {
          const responseBody = Buffer.concat(chunks).toString('utf-8');
          const parsed = JSON.parse(responseBody);
          if (parsed.error) {
            const errMsg = parsed.error.message || JSON.stringify(parsed.error);
            console.error(`❌ firebaseSet ${collection}/${docId} error:`, errMsg);
            finish(new Error(errMsg));
          } else {
            finish(null, parsed);
          }
        } catch (e) {
          finish(null, Buffer.concat(chunks).toString('utf-8'));
        }
      });
    });

    httpReq.on('error', (e) => finish(e));
    httpReq.write(body);
    httpReq.end();
  });
}

function firebaseDelete(collection, docId) {
  return new Promise((resolve, reject) => {
    let finished = false;
    let httpReq = null;
    const timer = setTimeout(() => {
      if (finished) return;
      finished = true;
      if (httpReq) try { httpReq.destroy(); } catch (_) {}
      reject(new Error('Firestore request timed out'));
    }, FIREBASE_HTTP_TIMEOUT_MS);
    const finish = (err, val) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      if (err) reject(err);
      else resolve(val);
    };

    const path = `/v1/projects/${FIREBASE_CONFIG.projectId}/databases/(default)/documents/${collection}/${docId}?key=${FIREBASE_CONFIG.apiKey}`;
    const options = {
      hostname: 'firestore.googleapis.com',
      port: 443,
      path: path,
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' }
    };
    httpReq = https.request(options, (res) => {
      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => {
        if (res.statusCode >= 400) {
          try {
            const body = JSON.parse(Buffer.concat(chunks).toString('utf-8'));
            finish(new Error(body.error && body.error.message ? body.error.message : 'Delete failed'));
          } catch (e) {
            finish(new Error('Delete failed ' + res.statusCode));
          }
        } else finish(null, undefined);
      });
    });
    httpReq.on('error', (e) => finish(e));
    httpReq.end();
  });
}

// =====================================================
// Load LINE Config from Firebase
// =====================================================
async function loadLineConfig() {
  try {
    console.log('📥 Loading LINE config from Firebase...');
    const settings = await firebaseGet('config', 'line_settings');
    
    if (settings) {
      LINE_CONFIG.channelSecret = settings.channelSecret || '';
      LINE_CONFIG.accessToken = settings.accessToken || '';
      console.log('✅ LINE config loaded successfully');
      console.log(`   Channel ID: ${settings.channelId || 'Not set'}`);
      return true;
    } else {
      console.log('⚠️ No LINE settings found in Firebase');
      console.log('   Please configure in Admin Panel → LINE → ตั้งค่า LINE');
      return false;
    }
  } catch (error) {
    console.error('❌ Failed to load LINE config:', error.message);
    return false;
  }
}

// Reload config every 5 minutes (NAS เท่านั้น — บน Firebase ใช้ Cloud Scheduler + /api/reload หรือ cold start)
if (!IS_SERVERLESS) {
  setInterval(loadLineConfig, 5 * 60 * 1000);
}

// =====================================================
// Attendance Notify — แจ้งเตือนเข้า-ออกงานทาง LINE
// =====================================================
const ATTENDANCE_SENT_FILE = IS_SERVERLESS
  ? path.join(require('os').tmpdir(), 'nkbk_attendance_notify_sent.json')
  : path.join(__dirname, 'attendance_notify_sent.json');

function getBangkokNow() {
  const now = new Date();
  const utc = now.getTime() + now.getTimezoneOffset() * 60000;
  return new Date(utc + 420 * 60000);
}

function getTodayDateId() {
  const b = getBangkokNow();
  const d = b.getDate();
  const m = b.getMonth() + 1;
  const y = b.getFullYear();
  return String(d).padStart(2, '0') + String(m).padStart(2, '0') + String(y);
}

function getBangkokMinutes() {
  const b = getBangkokNow();
  return b.getHours() * 60 + b.getMinutes();
}

function getBangkokDay() { return getBangkokNow().getDay(); }

/** วันนี้ (Bangkok) เป็น YYYY-MM-DD สำหรับเทียบวันหยุด/วันลา */
function getTodayYYYYMMDD() {
  const b = getBangkokNow();
  const y = b.getFullYear();
  const m = b.getMonth() + 1;
  const d = b.getDate();
  return y + '-' + String(m).padStart(2, '0') + '-' + String(d).padStart(2, '0');
}

/** วันหยุดราชการ (static) ปี 2026 — ถ้าวันนี้ตรงและไม่มี Firestore แก้เป็น "สหกรณ์ไม่หยุด" ถือว่าหยุด */
const STATIC_HOLIDAYS_2026 = ['2026-01-01', '2026-01-02', '2026-02-17', '2026-03-03', '2026-03-20', '2026-04-06', '2026-04-13', '2026-04-14', '2026-04-15', '2026-05-01', '2026-05-04', '2026-05-11', '2026-05-31', '2026-06-01', '2026-06-03', '2026-07-28', '2026-07-29', '2026-07-30', '2026-08-12', '2026-10-13', '2026-10-23', '2026-12-05', '2026-12-07', '2026-12-10', '2026-12-25', '2026-12-31'];

function readAttendanceSent() {
  try {
    const raw = fs.readFileSync(ATTENDANCE_SENT_FILE, 'utf8');
    return JSON.parse(raw);
  } catch (e) { return {}; }
}

function writeAttendanceSent(obj) {
  try {
    fs.writeFileSync(ATTENDANCE_SENT_FILE, JSON.stringify(obj, null, 0), 'utf8');
  } catch (e) { console.warn('writeAttendanceSent failed', e.message); }
}

function replaceVars(str, vars) {
  if (!str || typeof str !== 'string') return str;
  let out = str;
  for (const [k, v] of Object.entries(vars)) {
    out = out.split('{' + k + '}').join(v != null ? String(v) : '');
  }
  out = out.replace(/\s*&\s*ensp;\s*/g, ' ');
  return out;
}

/** ตัดคำนำหน้าชื่อไทย (นาง, นาย, น.ส. ฯลฯ) — ใช้ในข้อความแจ้งสแกนเข้า/ออก ไม่ใส่คำนำหน้า */
function stripThaiNamePrefix(str) {
  if (!str || typeof str !== 'string') return '';
  let s = str.trim().replace(/\s+/g, ' ');
  const prefixes = [/^นาง\s+/i, /^นาย\s+/i, /^น\.ส\.\s*/i, /^นส\.\s*/i, /^ด\.ช\.\s*/i, /^ด\.ญ\.\s*/i, /^ว่าที่\s*ร\.ต\.\s*(หญิง\s*)?/i, /^ร\.ต\.\s*/i, /^พล\.ต\.\s*/i];
  for (const p of prefixes) s = s.replace(p, '');
  return s.trim() || str.trim();
}

const ATT2_BASE = 'https://a2w.att2mobile.com/rp/CV44elrP';
/** ดึงข้อมูลเข้า-ออกงานจาก ATT2Mobile — ใช้ทั้ง API GET และดึงอัตโนมัติบนเซิร์ฟเวอร์ */
function fetchAttendanceFromAtt2(dateParam) {
  const targetDate = dateParam || (() => { const d = new Date(); return String(d.getDate()).padStart(2, '0') + String(d.getMonth() + 1).padStart(2, '0') + String(d.getFullYear()); })();
  const url = dateParam ? `${ATT2_BASE}/${dateParam}/?com=` : ATT2_BASE + '/';
  return new Promise((resolve, reject) => {
    const attReq = https.get(url, (attRes) => {
      if (attRes.statusCode !== 200) {
        const chunks = [];
        attRes.on('data', c => chunks.push(c));
        attRes.on('end', () => resolve({ success: false, code: 502, error: 'ATT2Mobile ตอบกลับ HTTP ' + attRes.statusCode }));
        return;
      }
      const chunks = [];
      attRes.on('data', c => chunks.push(c));
      attRes.on('end', () => {
        try {
          const html = Buffer.concat(chunks).toString('utf-8');
          const rows = [];
          const tableMatch = html.match(/<table[^>]*>[\s\S]*?<tbody[^>]*>([\s\S]*?)<\/tbody>/i) || html.match(/<table[^>]*>([\s\S]*?)<\/table>/i);
          const tableBody = tableMatch ? tableMatch[1] : html;
          const trRegex = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
          let tr;
          while ((tr = trRegex.exec(tableBody)) !== null) {
            const cells = [];
            const tdRegex = /<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi;
            let td;
            while ((td = tdRegex.exec(tr[1])) !== null) cells.push(td[1].replace(/<[^>]+>/g, '').trim());
            if (cells.length >= 4) {
              const code = cells[0];
              if (code !== 'รหัส' && /^\d+$/.test(code)) rows.push({ code, name: cells[1] || '', checkIn: cells[2] || '', checkOut: cells[3] || '' });
            }
          }
          if (rows.length === 0) {
            const altMatch = html.match(/\|\s*(\d+)\s*\|\s*([^|]+)\s*\|\s*(\d{1,2}:\d{2})?\s*\|\s*(\d{1,2}:\d{2})?\s*\|/g);
            if (altMatch) altMatch.forEach(line => {
              const m = line.match(/\|\s*(\d+)\s*\|\s*([^|]+)\s*\|\s*(\d{1,2}:\d{2})?\s*\|\s*(\d{1,2}:\d{2})?\s*\|/);
              if (m) rows.push({ code: m[1], name: m[2].trim(), checkIn: m[3] || '', checkOut: m[4] || '' });
            });
          }
          if (rows.length === 0 && (html.length < 500 || /เข้าสู่ระบบ|login|sign.?in/i.test(html)))
            return resolve({ success: false, code: 502, error: 'ATT2Mobile อาจต้องล็อกอินหรือรูปแบบหน้าเปลี่ยน' });
          resolve({ success: true, date: targetDate, rows });
        } catch (e) {
          resolve({ success: false, code: 500, error: (e.message || 'Parse error') + '' });
        }
      });
    });
    attReq.setTimeout(15000, () => { attReq.destroy(); resolve({ success: false, code: 504, error: 'ATT2Mobile ตอบช้าเกิน 15 วินาที' }); });
    attReq.on('error', e => resolve({ success: false, code: 502, error: (e.message || 'Fetch failed') + '' }));
  });
}

async function runAttendanceNotify() {
  if (getBangkokDay() === 0 || getBangkokDay() === 6) return;
  let cfg;
  try { cfg = await firebaseGet('config', 'line_attendance_notify'); } catch (e) { return; }
  if (!cfg || !cfg.enabled) return;
  const delayMorning = Math.max(0, Math.min(60, parseInt(cfg.delayMinutesMorning, 10) || 5));
  const delayAfternoon = Math.max(0, Math.min(60, parseInt(cfg.delayMinutesAfternoon, 10) || 5));
  const delayCheckout = Math.max(0, Math.min(60, parseInt(cfg.delayMinutesCheckout, 10) || 5));
  const morningEnd = 9 * 60 + 30;
  const afternoonEnd = 13 * 60 + 0;
  const checkoutEnd = 17 * 60 + 30;
  const triggerMorning = morningEnd + delayMorning;
  const triggerAfternoon = afternoonEnd + delayAfternoon;
  const triggerCheckout = checkoutEnd + delayCheckout;
  const nowMin = getBangkokMinutes();
  const dateId = getTodayDateId();
  const sent = readAttendanceSent();
  if (!sent[dateId]) sent[dateId] = { forget_morning: [], forget_afternoon: [], forget_checkout: [], summary: [], summary_all_done: false };

  let users = [];
  try { users = await firebaseGetCollection('users'); } catch (e) { return; }
  const staff = (users || []).filter(u => (u.group === 'เจ้าหน้าที่' || !u.group) && u.lineUserId);

  const todayStr = getTodayYYYYMMDD();
  let isHoliday = false;
  let staffOnLeave = new Set();
  try {
    const [holidaysList, leavesList] = await Promise.all([
      firebaseGetCollection('holidays').catch(() => []),
      firebaseGetCollection('leaves').catch(() => [])
    ]);
    const holidays = Array.isArray(holidaysList) ? holidaysList : [];
    const leaves = Array.isArray(leavesList) ? leavesList : [];
    const b = getBangkokNow();
    if (b.getFullYear() === 2026 && STATIC_HOLIDAYS_2026.indexOf(todayStr) >= 0) isHoliday = true;
    const coopOpenDates = new Set(holidays.filter((h) => h.hidden === true && h.date).map((h) => String(h.date).trim()));
    if (coopOpenDates.has(todayStr)) isHoliday = false;
    const firestoreHolidayDates = holidays.filter((h) => h.date && h.hidden !== true).map((h) => String(h.date).trim());
    if (firestoreHolidayDates.indexOf(todayStr) >= 0) isHoliday = true;
    if (isHoliday) return;
    const approvedLeavesToday = leaves.filter((l) => {
      if ((l.status || '').toString().toLowerCase() !== 'approved') return false;
      const start = (l.startDate || '').toString().trim();
      const end = (l.endDate || l.startDate || '').toString().trim();
      if (!start) return false;
      return todayStr >= start && todayStr <= end;
    });
    approvedLeavesToday.forEach((l) => {
      const uid = l.userId || l.memberId;
      if (uid) staffOnLeave.add(uid);
    });
  } catch (e) { /* ถ้าโหลดไม่ได้ไม่บล็อก แค่ไม่กรองลา/วันหยุด */ }

  let rows = [];
  try {
    const log = await firebaseGet('attendance_log', dateId);
    if (log && log.rows && Array.isArray(log.rows)) rows = log.rows;
  } catch (e) { /* permission or missing */ }

  function findRow(user) {
    const code = (user.workCode || user.employeeCode || user.username || user.id || '').toString().trim();
    const name = (user.fullname || user.nameTH || user.displayName || '').toString().trim();
    const nName = normNameForMatch(name);
    for (const r of rows) {
      const rc = (r.code != null ? r.code : '').toString().trim();
      if (code && rc && String(rc).replace(/^0+/, '') === String(code).replace(/^0+/, '')) return r;
      const rn = (r.name || '').toString().trim();
      const nRn = normNameForMatch(rn);
      if (nName && nRn && (name === rn || nName === nRn)) return r;
      if (nName && nRn && nName.length >= 3 && (nRn.indexOf(nName) >= 0 || nName.indexOf(nRn) >= 0)) return r;
    }
    return null;
  }

  const name = u => (u.fullname || u.nameTH || u.displayName || u.name || '').toString().trim();
  const callName = u => (u.aiChatCallName != null && String(u.aiChatCallName).trim() !== '') ? String(u.aiChatCallName).trim() : name(u);
  const dateStr = () => {
    const b = getBangkokNow();
    return b.getDate() + '/' + (b.getMonth() + 1) + '/' + (b.getFullYear() + 543);
  };
  const timeStr = () => {
    const b = getBangkokNow();
    return String(b.getHours()).padStart(2, '0') + '.' + String(b.getMinutes()).padStart(2, '0');
  };

  if (nowMin >= triggerMorning && nowMin < triggerMorning + 2) {
    for (const u of staff) {
      if (staffOnLeave.has(u.id)) continue;
      if (sent[dateId].forget_morning.indexOf(u.lineUserId) >= 0) continue;
      const row = findRow(u);
      const hasIn = row && (row.checkIn || row.check_in);
      if (hasIn) continue;
      const vars = { name: name(u), callName: callName(u), date: dateStr(), time: timeStr() };
      const type = cfg.forgetInType || 'text';
      const text = replaceVars(cfg.forgetInText || 'คุณลืมสแกนเข้างานหรือเปล่า? ({name})', vars);
      try {
        if (type === 'flex' && cfg.forgetInFlex) {
          let flexStr = String(cfg.forgetInFlex);
          for (const [k, v] of Object.entries(vars)) flexStr = flexStr.split('{' + k + '}').join(v != null ? String(v) : '');
          const contents = JSON.parse(flexStr);
          await pushMessage(u.lineUserId, [{ type: 'flex', altText: text.substring(0, 400), contents }]);
        } else {
          await pushMessage(u.lineUserId, [{ type: 'text', text }]);
        }
        sent[dateId].forget_morning.push(u.lineUserId);
      } catch (err) { console.warn('Attendance notify forget_in', u.lineUserId, err.message); }
    }
    writeAttendanceSent(sent);
  }

  if (nowMin >= triggerAfternoon && nowMin < triggerAfternoon + 2) {
    for (const u of staff) {
      if (staffOnLeave.has(u.id)) continue;
      if (sent[dateId].forget_afternoon.indexOf(u.lineUserId) >= 0) continue;
      const row = findRow(u);
      const hasIn = row && (row.checkIn || row.check_in);
      if (hasIn) continue;
      const vars = { name: name(u), callName: callName(u), date: dateStr(), time: timeStr() };
      const type = cfg.forgetInType || 'text';
      const text = replaceVars(cfg.forgetInText || 'คุณลืมสแกนเข้างานหรือเปล่า? ({name})', vars);
      try {
        if (type === 'flex' && cfg.forgetInFlex) {
          let flex = cfg.forgetInFlex;
          for (const [k, v] of Object.entries(vars)) flex = flex.split('{' + k + '}').join(v != null ? String(v) : '');
          await pushMessage(u.lineUserId, [{ type: 'flex', altText: text.substring(0, 400), contents: typeof flex === 'string' ? JSON.parse(flex) : flex }]);
        } else {
          await pushMessage(u.lineUserId, [{ type: 'text', text }]);
        }
        sent[dateId].forget_afternoon.push(u.lineUserId);
      } catch (err) { console.warn('Attendance notify forget_afternoon', u.lineUserId, err.message); }
    }
    writeAttendanceSent(sent);
  }

  if (nowMin >= triggerCheckout && nowMin < triggerCheckout + 2) {
    for (const u of staff) {
      if (staffOnLeave.has(u.id)) continue;
      if (sent[dateId].forget_checkout.indexOf(u.lineUserId) >= 0) continue;
      const row = findRow(u);
      const hasOut = row && (row.checkOut || row.check_out);
      if (hasOut) continue;
      const vars = { name: name(u), callName: callName(u), date: dateStr(), time: timeStr() };
      const type = cfg.forgetOutType || 'text';
      const text = replaceVars(cfg.forgetOutText || 'คุณลืมสแกนออกงานหรือเปล่า? ({name})', vars);
      try {
        if (type === 'flex' && cfg.forgetOutFlex) {
          let flex = cfg.forgetOutFlex;
          for (const [k, v] of Object.entries(vars)) flex = flex.split('{' + k + '}').join(v != null ? String(v) : '');
          await pushMessage(u.lineUserId, [{ type: 'flex', altText: text.substring(0, 400), contents: typeof flex === 'string' ? JSON.parse(flex) : flex }]);
        } else {
          await pushMessage(u.lineUserId, [{ type: 'text', text }]);
        }
        sent[dateId].forget_checkout.push(u.lineUserId);
      } catch (err) { console.warn('Attendance notify forget_checkout', u.lineUserId, err.message); }
    }
    writeAttendanceSent(sent);
  }

  if (nowMin >= triggerCheckout && nowMin < triggerCheckout + 2) {
    for (const u of staff) {
      if (staffOnLeave.has(u.id)) continue;
      if (sent[dateId].summary.indexOf(u.lineUserId) >= 0) continue;
      const row = findRow(u);
      const ci = row ? ((row.checkIn || row.check_in) || '').toString().trim().replace(':', '.') : '';
      const co = row ? ((row.checkOut || row.check_out) || '').toString().trim().replace(':', '.') : '';
      if (!ci && !co) continue;
      const vars = { name: name(u), callName: callName(u), checkIn: ci || '-', checkOut: co || '-', date: dateStr(), time: timeStr() };
      const type = cfg.summaryType || 'text';
      const text = replaceVars(cfg.summaryText || 'วันนี้เข้างาน {checkIn} ออกงาน {checkOut} ({name})', vars);
      try {
        if (type === 'flex' && cfg.summaryFlex) {
          let flex = cfg.summaryFlex;
          for (const [k, v] of Object.entries(vars)) flex = flex.split('{' + k + '}').join(v != null ? String(v) : '');
          await pushMessage(u.lineUserId, [{ type: 'flex', altText: text.substring(0, 400), contents: typeof flex === 'string' ? JSON.parse(flex) : flex }]);
        } else {
          await pushMessage(u.lineUserId, [{ type: 'text', text }]);
        }
        sent[dateId].summary.push(u.lineUserId);
      } catch (err) { console.warn('Attendance notify summary', u.lineUserId, err.message); }
    }
    writeAttendanceSent(sent);
  }

  const delaySummaryAll = Math.max(0, Math.min(60, parseInt(cfg.summaryAllDelayMinutes, 10) || 5));
  const summaryAllWindow = 25;
  let triggerSummaryAll;
  const sendAt = (cfg.summaryAllSendAt || '').toString().trim();
  if (sendAt && /^\d{1,2}:\d{2}(:\d{2})?$/.test(sendAt)) {
    const parts = sendAt.split(':');
    triggerSummaryAll = parseInt(parts[0], 10) * 60 + parseInt(parts[1], 10);
  } else {
    triggerSummaryAll = checkoutEnd + delaySummaryAll;
  }
  const rawRecipients = cfg.summaryAllRecipientLineIds;
  const recipients = (Array.isArray(rawRecipients) ? rawRecipients : (rawRecipients && typeof rawRecipients === 'object' ? Object.values(rawRecipients) : []))
    .map(id => (id != null ? String(id) : '').trim())
    .filter(Boolean);
  const summaryAllReady = cfg.summaryAllEnabled && recipients.length > 0 && !sent[dateId].summary_all_done && nowMin >= triggerSummaryAll && nowMin < triggerSummaryAll + summaryAllWindow;
  if (summaryAllReady) {
    let summaryRows = rows;
    try {
      const logFresh = await firebaseGet('attendance_log', dateId);
      if (logFresh && logFresh.rows && Array.isArray(logFresh.rows)) summaryRows = logFresh.rows;
    } catch (e) { /* ใช้ rows เดิม */ }
    const summaryLines = (summaryRows || []).map(r => {
      const n = (r.name || '').toString().trim();
      const ci = ((r.checkIn || r.check_in) || '').toString().trim().replace(':', '.') || '-';
      const co = ((r.checkOut || r.check_out) || '').toString().trim().replace(':', '.') || '-';
      return n + ' เข้า ' + ci + ' ออก ' + co;
    });
    const summaryList = summaryLines.length ? summaryLines.join('\n') : 'ไม่มีข้อมูล';
    const vars = { date: dateStr(), summaryList };
    const summaryAllType = cfg.summaryAllType || 'text';
    const escapeForJson = (s) => (s == null ? '' : String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"'));
    for (const lineUserId of recipients) {
      try {
        if (summaryAllType === 'flex' && cfg.summaryAllFlex) {
          let flexStr = String(cfg.summaryAllFlex);
          flexStr = flexStr.split('{date}').join(vars.date != null ? String(vars.date) : '');
          flexStr = flexStr.split('{summaryList}').join(escapeForJson(vars.summaryList));
          const contents = JSON.parse(flexStr);
          const altText = 'สรุปเข้า-ออกงานวันนี้ (ทั้งหมด)';
          await pushMessage(lineUserId, [{ type: 'flex', altText, contents }]);
        } else {
          const text = replaceVars(cfg.summaryAllText || '📋 สรุปเข้า-ออกงานวันนี้ (ทั้งหมด)\n{date}\n\n{summaryList}', vars);
          await pushMessage(lineUserId, [{ type: 'text', text }]);
        }
        console.log('✅ Summary-all sent to', lineUserId);
      } catch (err) { console.warn('Attendance summary_all', lineUserId, err.message); }
    }
    sent[dateId].summary_all_done = true;
    writeAttendanceSent(sent);
    if (recipients.length) console.log('📋 สรุปเข้า-ออกงานวันนี้ (รวมทุกคน) ส่งแล้ว', recipients.length, 'คน');
  }
}

async function runAttendanceScanNotifyQueue() {
  let cfg;
  try { cfg = await firebaseGet('config', 'line_attendance_notify'); } catch (e) { return; }
  if (!cfg) return;
  let list = [];
  try { list = await firebaseGetCollection('attendance_scan_notify_queue'); } catch (e) { console.warn('Attendance scan queue read error', e.message); return; }
  if (!list || list.length === 0) return;
  if (list.length > 0) console.log('📤 Attendance scan queue: processing', list.length, 'item(s)');
  const dateStr = () => {
    const b = getBangkokNow();
    return b.getDate() + '/' + (b.getMonth() + 1) + '/' + (b.getFullYear() + 543);
  };
  const timeStr = (t) => {
    if (t && typeof t === 'string') return t.replace(':', '.');
    const b = getBangkokNow();
    return String(b.getHours()).padStart(2, '0') + '.' + String(b.getMinutes()).padStart(2, '0');
  };
  for (const item of list) {
    const docId = item.id;
    const lineUserId = item.lineUserId;
    const type = (item.type || 'in').toLowerCase();
    const staffName = (item.staffName || item.name || '').toString().trim();
    const displayName = stripThaiNamePrefix(staffName);
    const checkTime = (item.checkTime || item.time || '').toString().trim();
    const vars = { name: displayName, time: checkTime ? timeStr(checkTime) : timeStr() };
    try {
      let sent = false;
      if (type === 'out' && cfg.scanOutEnabled) {
        const t = cfg.scanOutType || 'text';
        const text = replaceVars(cfg.scanOutText || '✅ สแกนออกงานแล้ว ({name}) เวลา {time} น.', vars);
        if (t === 'flex' && cfg.scanOutFlex) {
          let flex = cfg.scanOutFlex;
          for (const [k, v] of Object.entries(vars)) flex = flex.split('{' + k + '}').join(v != null ? String(v) : '');
          const contents = typeof flex === 'string' ? JSON.parse(flex) : flex;
          await pushMessage(lineUserId, [{ type: 'flex', altText: text.substring(0, 400), contents }]);
        } else {
          await pushMessage(lineUserId, [{ type: 'text', text }]);
        }
        sent = true;
      } else if (type === 'in' && cfg.scanInEnabled) {
        const t = cfg.scanInType || 'text';
        const text = replaceVars(cfg.scanInText || '✅ สแกนเข้างานแล้ว ({name}) เวลา {time} น.', vars);
        if (t === 'flex' && cfg.scanInFlex) {
          let flex = cfg.scanInFlex;
          for (const [k, v] of Object.entries(vars)) flex = flex.split('{' + k + '}').join(v != null ? String(v) : '');
          const contents = typeof flex === 'string' ? JSON.parse(flex) : flex;
          await pushMessage(lineUserId, [{ type: 'flex', altText: text.substring(0, 400), contents }]);
        } else {
          await pushMessage(lineUserId, [{ type: 'text', text }]);
        }
        sent = true;
      }
      if (sent) {
        const dateId = (item.dateId || '').toString().trim();
        if (dateId && lineUserId) {
          const sentDocId = dateId + '_' + type + '_' + lineUserId.replace(/[/\\]/g, '_');
          try {
            await firebaseSet('attendance_line_sent', sentDocId, { dateId, lineUserId, type, sentAt: new Date().toISOString() });
          } catch (e) { console.warn('attendance_line_sent write', e.message); }
        }
        await firebaseDelete('attendance_scan_notify_queue', docId);
        console.log('✅ Attendance scan notify sent:', type, lineUserId);
      } else {
        console.warn('Attendance scan notify skipped (type=%s, scanInEnabled=%s, scanOutEnabled=%s)', type, !!cfg.scanInEnabled, !!cfg.scanOutEnabled);
      }
    } catch (err) {
      console.warn('Attendance scan notify queue', docId, err.message);
    }
  }
}

/** ดึงและบันทึกเข้า-ออกงานอัตโนมัติบนเซิร์ฟเวอร์ (ไม่ต้องเปิดหน้า Admin) */
function timeStrToMinutes(s) {
  if (!s || typeof s !== 'string') return NaN;
  const parts = s.trim().replace('.', ':').split(':');
  if (parts.length < 2) return NaN;
  const h = parseInt(parts[0], 10), m = parseInt(parts[1], 10);
  if (isNaN(h) || isNaN(m)) return NaN;
  return h * 60 + m;
}
function isInAttendanceWindowServer(cfg, nowMin) {
  const mS = timeStrToMinutes(cfg.windowMorningStart || '03:00');
  const mE = timeStrToMinutes(cfg.windowMorningEnd || '09:30');
  const aS = timeStrToMinutes(cfg.windowAfternoonStart || '12:00');
  const aE = timeStrToMinutes(cfg.windowAfternoonEnd || '13:00');
  const cS = timeStrToMinutes(cfg.windowCheckoutStart || '16:30');
  const cE = timeStrToMinutes(cfg.windowCheckoutEnd || '17:30');
  return (nowMin >= mS && nowMin <= mE) || (nowMin >= aS && nowMin <= aE) || (nowMin >= cS && nowMin <= cE);
}
function normNameForMatch(str) {
  if (!str || typeof str !== 'string') return '';
  let s = str.trim().replace(/\s+/g, ' ');
  const prefixes = [/^นาง\s+/i, /^นาย\s+/i, /^น\.ส\.\s*/i, /^นส\.\s*/i, /^ด\.ช\.\s*/i, /^ด\.ญ\.\s*/i, /^ว่าที่\s*ร\.ต\.\s*(หญิง\s*)?/i, /^ร\.ต\.\s*/i, /^พล\.ต\.\s*/i];
  for (const p of prefixes) s = s.replace(p, '');
  return s.trim();
}
function findUserForAttendanceRow(row, staffList) {
  if (!staffList || !staffList.length) return null;
  const code = (row.code != null ? row.code : '').toString().trim();
  const name = (row.name || '').toString().trim();
  const nName = normNameForMatch(name);
  for (const u of staffList) {
    if (!u.lineUserId) continue;
    const uc = (u.workCode || u.employeeCode || '').toString().trim();
    if (code && uc && String(uc).replace(/^0+/, '') === String(code).replace(/^0+/, '')) return u;
    const un = (u.fullname || u.nameTH || '').toString().trim();
    const nUn = normNameForMatch(un);
    if (name && un && (un === name || nUn === nName)) return u;
    if (name && un && nName.length >= 3 && (nUn.indexOf(nName) >= 0 || nName.indexOf(nUn) >= 0)) return u;
  }
  return null;
}
/**
 * รวมแถวจาก ATT2Mobile กับของเดิมใน Firestore — ถ้ามี checkInManual/checkOutManual (แก้ในแอดมิน)
 * ให้คงเวลาที่แก้ ไม่ถูกดึงอัตโนมัติทับ
 */
function mergeAttendanceRowsPreserveManual(oldRows, attRows) {
  if (!Array.isArray(attRows) || attRows.length === 0) return Array.isArray(oldRows) ? oldRows : [];
  const norm = normNameForMatch;
  const oldByCode = Object.create(null);
  const oldByNorm = Object.create(null);
  for (const r of oldRows || []) {
    const c = (r.code != null ? r.code : '').toString().trim();
    if (c) {
      const k = c.replace(/^0+/, '') || '0';
      oldByCode[k] = r;
    }
    const n = norm((r.name || '').toString());
    if (n) oldByNorm[n] = r;
  }
  return attRows.map((att) => {
    const rCode = (att.code != null ? att.code : '').toString().trim();
    const rName = (att.name || '').toString().trim();
    const k = rCode.replace(/^0+/, '') || '0';
    const oldR = oldByCode[k] || oldByNorm[norm(rName)];
    const cinAtt = (att.checkIn != null ? att.checkIn : att.check_in != null ? att.check_in : '').toString().trim();
    const coutAtt = (att.checkOut != null ? att.checkOut : att.check_out != null ? att.check_out : '').toString().trim();
    const out = { ...att };
    delete out.check_in;
    delete out.check_out;
    if (oldR) {
      const oldIn = (oldR.checkIn != null ? oldR.checkIn : oldR.check_in != null ? oldR.check_in : '').toString().trim();
      const oldOut = (oldR.checkOut != null ? oldR.checkOut : oldR.check_out != null ? oldR.check_out : '').toString().trim();
      if (oldR.checkInManual === true) {
        out.checkIn = oldIn;
        out.checkInManual = true;
      } else {
        out.checkIn = cinAtt || oldIn;
      }
      if (oldR.checkOutManual === true) {
        out.checkOut = oldOut;
        out.checkOutManual = true;
      } else {
        out.checkOut = coutAtt || oldOut;
      }
    } else {
      out.checkIn = cinAtt;
      out.checkOut = coutAtt;
    }
    return out;
  });
}

async function runAttendanceAutoFetchServer() {
  let cfg;
  try { cfg = await firebaseGet('config', 'attendance_auto_fetch'); } catch (e) { return; }
  if (!cfg || !cfg.enabled || !cfg.autoSave) return;
  const nowMin = getBangkokMinutes();
  if (!isInAttendanceWindowServer(cfg, nowMin)) return;
  const dateId = getTodayDateId();
  const data = await fetchAttendanceFromAtt2(dateId);
  if (!data.success || !data.rows || data.rows.length === 0) return;
  let users = [];
  try { users = await firebaseGetCollection('users'); } catch (e) { return; }
  const staffList = (users || []).filter(u => (u.group === 'เจ้าหน้าที่' || !u.group) && u.lineUserId);
  let oldRows = [];
  try {
    const log = await firebaseGet('attendance_log', dateId);
    if (log && log.rows && Array.isArray(log.rows)) oldRows = log.rows;
  } catch (e) {}
  const mergedRows = mergeAttendanceRowsPreserveManual(oldRows, data.rows);
  const oldByKey = {};
  const norm = normNameForMatch;
  for (const r of oldRows) {
    const c = (r.code != null ? r.code : '').toString().trim();
    const n = (r.name || '').toString().trim();
    if (c) oldByKey['c:' + c] = r;
    if (n) { oldByKey['n:' + n] = r; oldByKey['norm:' + norm(n)] = r; }
  }
  const queue = [];
  for (const r of data.rows) {
    const newIn = (r.checkIn != null ? r.checkIn : r.check_in || '').toString().trim();
    const newOut = (r.checkOut != null ? r.checkOut : r.check_out || '').toString().trim();
    const rCode = (r.code != null ? r.code : '').toString().trim();
    const rName = (r.name || '').toString().trim();
    const oldR = oldByKey['c:' + rCode] || oldByKey['n:' + rName] || oldByKey['norm:' + norm(rName)];
    const oldIn = oldR ? (oldR.checkIn != null ? oldR.checkIn : oldR.check_in || '').toString().trim() : '';
    const oldOut = oldR ? (oldR.checkOut != null ? oldR.checkOut : oldR.check_out || '').toString().trim() : '';
    const user = findUserForAttendanceRow(r, staffList);
    if (!user || !user.lineUserId) continue;
    const staffName = (r.name || user.fullname || user.nameTH || '').toString().trim();
    const skipInNotify = oldR && oldR.checkInManual === true;
    const skipOutNotify = oldR && oldR.checkOutManual === true;
    if (!skipInNotify && newIn && newIn !== oldIn) queue.push({ lineUserId: user.lineUserId, type: 'in', staffName, checkTime: newIn.replace(':', '.'), dateId });
    if (!skipOutNotify && newOut && newOut !== oldOut) queue.push({ lineUserId: user.lineUserId, type: 'out', staffName, checkTime: newOut.replace(':', '.'), dateId });
  }
  try {
    await firebaseSet('attendance_log', dateId, { date: dateId, rows: mergedRows, savedAt: new Date().toISOString() });
    for (const item of queue) {
      const docId = Date.now() + '_' + Math.random().toString(36).slice(2, 10);
      await firebaseSet('attendance_scan_notify_queue', docId, { lineUserId: item.lineUserId, type: item.type, staffName: item.staffName, checkTime: item.checkTime, dateId: item.dateId, createdAt: new Date().toISOString() });
    }
    if (queue.length > 0) console.log('📥 Attendance auto-fetch: saved', dateId, 'queue', queue.length);
  } catch (e) { console.warn('Attendance auto-fetch', e.message); }
}

if (!IS_SERVERLESS) {
  setInterval(runAttendanceNotify, 60 * 1000);
  setTimeout(runAttendanceNotify, 30 * 1000);
  setInterval(runAttendanceScanNotifyQueue, 30 * 1000);
  setTimeout(runAttendanceScanNotifyQueue, 10 * 1000);
  setInterval(runAttendanceAutoFetchServer, 60 * 1000);
  setTimeout(runAttendanceAutoFetchServer, 45 * 1000);
}

// =====================================================
// LINE API Helper
// =====================================================
function callLineAPI(endpoint, method, data) {
  return new Promise((resolve, reject) => {
    if (!LINE_CONFIG.accessToken) {
      reject(new Error('Access Token not configured'));
      return;
    }

    const options = {
      hostname: 'api.line.me',
      port: 443,
      path: endpoint,
      method: method,
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${LINE_CONFIG.accessToken}`
      }
    };

    const req = https.request(options, (res) => {
      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => {
        const body = Buffer.concat(chunks).toString('utf-8');
        let parsed;
        try { parsed = JSON.parse(body); } catch (e) { parsed = body; }
        if (res.statusCode >= 400) {
          const msg = (parsed && parsed.message) ? parsed.message : `LINE API HTTP ${res.statusCode}`;
          const err = new Error(msg);
          err.statusCode = res.statusCode;
          err.responseBody = parsed;
          reject(err);
        } else {
          resolve(parsed);
        }
      });
    });

    req.on('error', reject);
    if (data) req.write(JSON.stringify(data));
    req.end();
  });
}

function replyMessage(replyToken, messages) {
  const sanitized = messages.map(m => m.type === 'flex' ? sanitizeFlexForLine(m) : m);
  return callLineAPI('/v2/bot/message/reply', 'POST', {
    replyToken,
    messages: sanitized
  });
}

/**
 * sanitizeFlexForLine: แก้ component/property ที่ LINE API ปฏิเสธ
 * 1) filler (deprecated → rejected) → text " "
 * 2) spacer (ไม่ใช่ Flex component ที่ LINE รองรับ) → text " " + margin
 * 3) box ที่ไม่มี contents (required) → เพิ่ม contents
 * 4) borderWidth ที่เป็น px → แปลงเป็นชื่อ (light/normal/medium/bold)
 */
function sanitizeFlexForLine(obj) {
  if (!obj) return obj;
  if (Array.isArray(obj)) return obj.map(sanitizeFlexForLine);
  if (typeof obj !== 'object') return obj;
  if (obj.type === 'filler') return { type: 'text', text: ' ', size: 'xxs' };
  if (obj.type === 'spacer') {
    const r = { type: 'text', text: ' ', size: 'xxs' };
    if (obj.size) r.margin = obj.size;
    return r;
  }
  const out = {};
  for (const k of Object.keys(obj)) {
    const v = obj[k];
    out[k] = (v && typeof v === 'object') ? sanitizeFlexForLine(v) : v;
  }
  // box ต้องมี contents
  if (out.type === 'box' && !Array.isArray(out.contents)) {
    out.contents = [{ type: 'text', text: ' ', size: 'xxs' }];
  }
  // borderWidth ต้องเป็นชื่อ ไม่ใช่ px
  if (out.borderWidth && String(out.borderWidth).includes('px')) {
    const px = parseFloat(out.borderWidth);
    out.borderWidth = px <= 1 ? 'light' : px <= 2 ? 'normal' : px <= 3 ? 'medium' : 'bold';
  }
  return out;
}

function pushMessage(userId, messages) {
  // sanitize ทุก flex message ก่อนส่งไป LINE (แทน filler ด้วย text space)
  const sanitized = messages.map(m => m.type === 'flex' ? sanitizeFlexForLine(m) : m);
  return callLineAPI('/v2/bot/message/push', 'POST', {
    to: userId,
    messages: sanitized
  });
}

function getProfile(userId) {
  return callLineAPI(`/v2/bot/profile/${userId}`, 'GET');
}

function leaveGroup(groupId) {
  return callLineAPI(`/v2/bot/group/${encodeURIComponent(groupId)}/leave`, 'POST');
}

function getGroupSummary(groupId) {
  return callLineAPI(`/v2/bot/group/${encodeURIComponent(groupId)}/summary`, 'GET');
}

function getGroupMemberCount(groupId) {
  return callLineAPI(`/v2/bot/group/${encodeURIComponent(groupId)}/members/count`, 'GET');
}

function generateGroupCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 6; i++) code += chars[Math.floor(Math.random() * chars.length)];
  return code;
}

// =====================================================
// Profile Command — ดึงข้อมูลจาก Firestore แล้วตอบ Flex
// =====================================================
async function handleProfileCommand(lineUserId, replyToken, lineProfile) {
  // 1) หา user data จาก line_followers → users
  let userData = null;
  let memberId = null;
  try {
    const follower = await firebaseGet('line_followers', lineUserId);
    if (follower && follower.memberId) {
      memberId = follower.memberId;
      userData = await firebaseGet('users', memberId);
      if (!userData) {
        const byUsername = await firebaseQuery('users', 'username', memberId);
        if (byUsername) userData = byUsername;
      }
    }
  } catch (e) { /* ignore */ }
  if (!userData) {
    try {
      const byLine = await firebaseQuery('users', 'lineUserId', lineUserId);
      if (byLine) userData = byLine;
    } catch (e) { /* ignore */ }
  }

  // ถ้าไม่เจอข้อมูลในระบบ → แจ้งผูกบัญชีก่อน
  if (!userData) {
    await replyMessage(replyToken, [{ type: 'text', text: '❌ ยังไม่พบข้อมูลของคุณในระบบ\n\nกรุณาผูกบัญชีก่อนนะครับ' }]);
    return;
  }

  // 2) รวมข้อมูลทั้งหมด
  const linePic = (lineProfile && lineProfile.pictureUrl) ? lineProfile.pictureUrl : '';
  const avatar = userData.avatar || userData.linePictureUrl || linePic || 'https://placehold.co/200x200/e2e8f0/94a3b8?text=+';
  const fullname = userData.fullname || userData.nameTH || userData.displayName || '-';
  const username = userData.username || memberId || '-';
  const group = userData.group || 'เจ้าหน้าที่';
  const department = userData.department || userData.dept || '-';
  const position = userData.position || userData.jobPosition || '-';
  const job = userData.job || userData.workType || '-';
  const email = userData.email || '-';
  const unit = userData.unit || '';

  // 3) สร้าง Flex ตามกลุ่ม
  const isCommittee = group === 'กรรมการ';
  const flex = isCommittee
    ? buildCommitteeProfileFlex({ avatar, fullname, username, group, position, email, committeeMemberships: userData.committeeMemberships || [], committeeSet: userData.committeeSet, committeeGroup: userData.committeeGroup, committeePosition: userData.committeePosition, status: userData.status })
    : buildStaffProfileFlex({ avatar, fullname, username, group, department, position, job, email, unit });

  await replyMessage(replyToken, [{ type: 'flex', altText: 'โปรไฟล์ — ' + fullname, contents: flex }]);
  console.log('✅ Profile flex sent for:', fullname);
}

/** Flex โปรไฟล์เจ้าหน้าที่ */
function buildStaffProfileFlex(d) {
  const rows = [
    makeProfileRow('รหัสสมาชิก', d.username),
    makeProfileRow('ชื่อ-สกุล', d.fullname),
    makeProfileRow('กลุ่ม', d.group),
    makeProfileRow('ฝ่ายงาน', d.department),
    makeProfileRow('ตำแหน่ง', d.position),
    makeProfileRow('งาน', d.job)
  ];
  if (d.unit && d.unit !== '-') rows.push(makeProfileRow('หน่วยบริการ', d.unit));
  rows.push(makeProfileRow('อีเมล', d.email, '#0D9488'));
  return buildProfileBubble({ headerColor: '#0D9488', avatar: d.avatar, fullname: d.fullname, subtitle: d.position, rows });
}

/** Flex โปรไฟล์กรรมการ */
function buildCommitteeProfileFlex(d) {
  const rows = [
    makeProfileRow('รหัสสมาชิก', d.username),
    makeProfileRow('ชื่อ-สกุล', d.fullname),
    makeProfileRow('กลุ่ม', d.group),
    makeProfileRow('ตำแหน่ง', d.position)
  ];
  // แสดงคณะกรรมการ
  const memberships = Array.isArray(d.committeeMemberships) && d.committeeMemberships.length > 0
    ? d.committeeMemberships
    : d.committeeGroup ? [{ group: d.committeeGroup, position: d.committeePosition || '', set: d.committeeSet || '' }] : [];
  memberships.forEach((m, i) => {
    const label = memberships.length > 1 ? 'คณะที่ ' + (i + 1) : 'คณะกรรมการ';
    const val = (m.group || '-') + (m.position ? ' (' + m.position + ')' : '') + (m.set ? ' ชุดที่ ' + m.set : '');
    rows.push(makeProfileRow(label, val));
  });
  if (d.status && d.status !== '-') rows.push(makeProfileRow('สถานะ', d.status));
  if (d.email && d.email !== '-') rows.push(makeProfileRow('อีเมล', d.email, '#7C3AED'));
  return buildProfileBubble({ headerColor: '#7C3AED', avatar: d.avatar, fullname: d.fullname, subtitle: d.group + (d.status ? ' — ' + d.status : ''), rows });
}

/** Helper: สร้างแถวข้อมูล */
function makeProfileRow(label, value, valueColor) {
  return {
    type: 'box', layout: 'horizontal', margin: 'md', spacing: 'sm',
    contents: [
      { type: 'text', text: label, size: 'xs', color: '#6B7280', flex: 2 },
      { type: 'text', text: value || '-', size: 'sm', color: valueColor || '#1F2937', weight: 'bold', flex: 3, align: 'end', wrap: true }
    ]
  };
}

/** Helper: สร้าง bubble โปรไฟล์ */
function buildProfileBubble(opts) {
  const { headerColor, avatar, fullname, subtitle, rows } = opts;
  // สร้าง body contents: แต่ละแถวคั่นด้วย separator
  const bodyContents = [];
  rows.forEach((row, i) => {
    if (i > 0) bodyContents.push({ type: 'separator', margin: 'md', color: '#F3F4F6' });
    bodyContents.push(row);
  });
  return {
    type: 'bubble',
    size: 'mega',
    header: {
      type: 'box', layout: 'vertical', backgroundColor: headerColor, paddingAll: '24px', alignItems: 'center',
      contents: [
        { type: 'image', url: avatar, size: 'sm', aspectMode: 'cover' },
        { type: 'text', text: fullname, weight: 'bold', size: 'xl', color: '#FFFFFF', align: 'center', margin: 'lg' },
        { type: 'text', text: subtitle || '', size: 'sm', color: '#FFFFFFCC', align: 'center', margin: 'xs' }
      ]
    },
    body: {
      type: 'box', layout: 'vertical', paddingAll: '20px', backgroundColor: '#FFFFFF',
      contents: bodyContents
    },
    footer: {
      type: 'box', layout: 'vertical', paddingAll: '16px', paddingTop: '0px', backgroundColor: '#FFFFFF',
      contents: [
        { type: 'button', action: { type: 'uri', label: 'แก้ไขข้อมูล', uri: 'https://liff.line.me/2008951184-zlFZf7gn' }, style: 'primary', color: headerColor, height: 'sm' }
      ]
    }
  };
}

// =====================================================
// LINE Login Functions
// =====================================================
function getLineLoginToken(code, clientId, clientSecret, redirectUri) {
  return new Promise((resolve, reject) => {
    const postData = new URLSearchParams({
      grant_type: 'authorization_code',
      code: code,
      redirect_uri: redirectUri,
      client_id: clientId,
      client_secret: clientSecret
    }).toString();
    
    const options = {
      hostname: 'api.line.me',
      port: 443,
      path: '/oauth2/v2.1/token',
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(postData)
      }
    };

    const req = https.request(options, (res) => {
      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => {
        try {
          const body = Buffer.concat(chunks).toString('utf-8');
          resolve(JSON.parse(body));
        } catch (e) {
          reject(e);
        }
      });
    });

    req.on('error', reject);
    req.write(postData);
    req.end();
  });
}

function getLineLoginProfile(accessToken) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'api.line.me',
      port: 443,
      path: '/v2/profile',
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${accessToken}`
      }
    };

    const req = https.request(options, (res) => {
      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => {
        try {
          const body = Buffer.concat(chunks).toString('utf-8');
          resolve(JSON.parse(body));
        } catch (e) {
          reject(e);
        }
      });
    });

    req.on('error', reject);
    req.end();
  });
}

// =====================================================
// Signature Verification
// =====================================================
function verifySignature(body, signature) {
  if (!LINE_CONFIG.channelSecret) return true; // Skip if not configured
  
  const hash = crypto
    .createHmac('SHA256', LINE_CONFIG.channelSecret)
    .update(body)
    .digest('base64');
  return hash === signature;
}

// =====================================================
// Auto Reply - ดึงจาก Firebase
// =====================================================
let autoReplyRules = [];

async function loadAutoReplyRules() {
  try {
    const rules = await firebaseGetCollection('line_autoreply');
    autoReplyRules = rules.filter(r => r.enabled !== false);
    console.log(`📋 Loaded ${autoReplyRules.length} auto-reply rules from Firebase`);
  } catch (error) {
    console.error('❌ Failed to load auto-reply rules from Firebase:', error.message);
    // ไม่ใช้ hardcoded fallback -- ใช้กฎจาก Firebase เท่านั้น
    // ถ้าโหลดไม่ได้ ให้เก็บกฎเดิมที่โหลดสำเร็จครั้งล่าสุดไว้
    console.log(`⚠️ Keeping ${autoReplyRules.length} previously loaded rules`);
  }
}

if (!IS_SERVERLESS) {
  setInterval(loadAutoReplyRules, 5 * 60 * 1000);
}

// ตรวจสอบว่า LINE userId อยู่ในกลุ่มเป้าหมาย (audience) หรือไม่ — ต้องผ่านถึงจะตอบกลับ
async function checkAudience(audience, lineUserId) {
  if (!audience || !audience.type || audience.type === 'all') return true;
  try {
    // ค้นหา user ที่ผูก LINE จาก line_followers (ต้องมี memberId ไม่งั้นถือว่าไม่อยู่ในกลุ่ม)
    const follower = await firebaseGet('line_followers', lineUserId);
    const memberId = follower?.memberId || follower?.linkedUserId;
    if (!memberId && audience.type !== 'specific') {
      console.log(`⏭️ checkAudience: no memberId in line_followers for ${lineUserId.substring(0, 8)}... — ไม่ผูกบัญชีหรือข้อมูลหาย`);
      return false;
    }

    if (audience.type === 'specific') {
      const ok = Array.isArray(audience.userIds) && audience.userIds.includes(lineUserId);
      if (!ok) console.log(`⏭️ checkAudience: user not in specific list`);
      return ok;
    }

    // ดึงข้อมูล user จาก users collection (ใช้ group, status เช็คเจ้าหน้าที่/กรรมการ)
    let userData = null;
    if (memberId) {
      userData = await firebaseGet('users', memberId);
    }
    if (!userData) {
      const found = await firebaseQuery('users', 'lineUserId', lineUserId);
      if (found) userData = found;
    }
    if (!userData) {
      console.log(`⏭️ checkAudience: no user doc for memberId=${memberId}`);
      return false;
    }

    // รองรับทั้งภาษาไทยและค่าที่อาจเก็บในระบบ (staff = เจ้าหน้าที่)
    const rawGroup = (userData.group || userData.userGroup || 'เจ้าหน้าที่').toString().trim();
    const group = rawGroup === 'staff' ? 'เจ้าหน้าที่' : rawGroup;
    const rawStatus = (userData.status || userData.userStatus || 'ปกติ').toString().trim();
    const status = rawStatus === '' ? 'ปกติ' : rawStatus;

    if (audience.type === 'staff') {
      const ok = group === 'เจ้าหน้าที่' && (status === 'ปกติ' || status === 'active');
      if (!ok) console.log(`⏭️ checkAudience: staff — group="${group}" status="${status}" (ต้องเป็น เจ้าหน้าที่ + ปกติ)`);
      return ok;
    }
    if (audience.type === 'committee') {
      const ok = group === 'กรรมการ' && (status === 'ปกติ' || status === 'อยู่ในวาระ' || status === 'active');
      if (!ok) console.log(`⏭️ checkAudience: committee — group="${group}" status="${status}"`);
      return ok;
    }
    if (audience.type === 'by_board') {
      if (group !== 'กรรมการ') return false;
      if (!Array.isArray(audience.boards) || audience.boards.length === 0) return true;
      const memberships = Array.isArray(userData.committeeMemberships) ? userData.committeeMemberships : [];
      return memberships.some(m => audience.boards.includes(m.group));
    }
    if (audience.type === 'by_dept') {
      if (group !== 'เจ้าหน้าที่' || (status !== 'ปกติ' && status !== 'active')) return false;
      if (!Array.isArray(audience.departments) || audience.departments.length === 0) return true;
      const dept = (userData.department || userData.departmentName || '').toString().trim();
      return audience.departments.includes(dept);
    }
    return false;
  } catch (e) {
    console.log('checkAudience error:', e.message);
    return true; // ถ้า error ให้ตอบกลับเป็น default
  }
}

// คืนค่าเป็น array ของทุกกฎที่ keyword ตรง (เพื่อให้ลองเช็ก audience ทีละกฎ — ถ้ากฎแรกเป็น "กรรมการ" แต่ user เป็น "เจ้าหน้าที่" จะได้ลองกฎ "เจ้าหน้าที่" ต่อ)
function checkAutoReply(text) {
  const lowerText = text.toLowerCase().trim();
  const matches = [];

  for (const rule of autoReplyRules) {
    if (!rule.trigger) continue;
    if (!rule.replyContent && !rule.flexJson) continue;

    let matched = false;
    const triggers = rule.trigger.toLowerCase().split('|').map(t => t.trim());

    switch (rule.triggerType) {
      case 'exact':
        matched = triggers.some(t => lowerText === t);
        break;
      case 'startsWith':
        matched = triggers.some(t => lowerText.startsWith(t));
        break;
      case 'contains':
      default:
        matched = triggers.some(t => lowerText.includes(t));
    }

    if (matched) matches.push(rule);
  }

  return matches;
}

// ดึงค่าสำหรับแทนที่ placeholder ใน Flex (fullname, avatar, username, group, ...)
async function getProfileReplacementsForLineUser(lineUserId, lineProfile) {
  const out = {
    fullname: '-',
    avatar: 'https://placehold.co/200x200/e2e8f0/94a3b8?text=+',
    username: '-',
    group: '-',
    department: '-',
    position: '-',
    job: '-',
    email: '-',
    unit: '-',
    name: (lineProfile && lineProfile.displayName) ? lineProfile.displayName : 'คุณ'
  };
  let userData = null;
  let memberId = null;
  try {
    const follower = await firebaseGet('line_followers', lineUserId);
    if (follower && follower.memberId) {
      memberId = follower.memberId;
      userData = await firebaseGet('users', memberId);
      if (!userData) {
        const byUsername = await firebaseQuery('users', 'username', memberId);
        if (byUsername) userData = byUsername;
      }
    }
  } catch (e) { /* ignore */ }
  if (!userData) {
    try {
      const byLine = await firebaseQuery('users', 'lineUserId', lineUserId);
      if (byLine) userData = byLine;
    } catch (e) { /* ignore */ }
  }
  if (!userData) return out;
  const linePic = (lineProfile && lineProfile.pictureUrl) ? lineProfile.pictureUrl : '';
  out.avatar = userData.avatar || userData.linePictureUrl || linePic || out.avatar;
  out.fullname = userData.fullname || userData.nameTH || userData.displayName || out.fullname;
  out.username = userData.username || memberId || out.username;
  out.group = userData.group || 'เจ้าหน้าที่';
  out.department = userData.department || userData.dept || out.department;
  out.position = userData.position || userData.jobPosition || out.position;
  out.job = userData.job || userData.workType || out.job;
  out.email = userData.email || out.email;
  out.unit = userData.unit || out.unit;
  return out;
}

// แทนที่ {fullname}, {avatar}, ... ใน object (recursive)
function replaceFlexPlaceholders(obj, replacements) {
  if (obj === null || obj === undefined) return obj;
  if (typeof obj === 'string') {
    let s = obj;
    for (const [key, value] of Object.entries(replacements)) {
      if (value != null && typeof value === 'string') s = s.split('{' + key + '}').join(value);
    }
    return s;
  }
  if (Array.isArray(obj)) return obj.map(item => replaceFlexPlaceholders(item, replacements));
  if (typeof obj === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(obj)) out[k] = replaceFlexPlaceholders(v, replacements);
    return out;
  }
  return obj;
}

// =====================================================
// Template Functions
// =====================================================
async function getTemplate(templateId) {
  try {
    const template = await firebaseGet('line_templates', templateId);
    return template;
  } catch (error) {
    console.log('Template not found:', templateId);
    return null;
  }
}

// Flex Message for successful linking
function getLinkSuccessFlex(memberName, memberId) {
  return {
    type: 'bubble',
    size: 'kilo',
    header: {
      type: 'box',
      layout: 'vertical',
      contents: [
        {
          type: 'text',
          text: '✅ ผูกบัญชีสำเร็จ!',
          color: '#FFFFFF',
          weight: 'bold',
          size: 'lg'
        }
      ],
      backgroundColor: '#27AE60',
      paddingAll: 'lg'
    },
    body: {
      type: 'box',
      layout: 'vertical',
      contents: [
        {
          type: 'text',
          text: 'ยินดีต้อนรับ',
          size: 'sm',
          color: '#888888'
        },
        {
          type: 'text',
          text: memberName,
          weight: 'bold',
          size: 'xl',
          margin: 'sm'
        },
        {
          type: 'text',
          text: 'รหัสสมาชิก: ' + memberId,
          size: 'sm',
          color: '#06C755',
          margin: 'sm'
        },
        {
          type: 'separator',
          margin: 'lg'
        },
        {
          type: 'text',
          text: 'คุณสามารถรับการแจ้งเตือนและใช้บริการต่างๆ ผ่าน LINE ได้แล้ว',
          size: 'xs',
          color: '#888888',
          margin: 'lg',
          wrap: true
        }
      ]
    }
  };
}

// Check and verify PIN
async function verifyAndLinkPin(userId, pin, replyToken) {
  try {
    // Get PIN document
    const pinData = await firebaseGet('line_link_pins', pin);
    
    if (!pinData) {
      await replyMessage(replyToken, [{ type: 'text', text: '❌ รหัส PIN ไม่ถูกต้องหรือหมดอายุแล้ว\n\nกรุณาติดต่อเจ้าหน้าที่เพื่อขอรหัส PIN ใหม่' }]);
      return;
    }
    
    // Check if already used
    if (pinData.used === 'true' || pinData.used === true) {
      await replyMessage(replyToken, [{ type: 'text', text: '❌ รหัส PIN นี้ถูกใช้ไปแล้ว\n\nกรุณาติดต่อเจ้าหน้าที่เพื่อขอรหัส PIN ใหม่' }]);
      return;
    }
    
    // Check expiry (if exists)
    if (pinData.expiresAt) {
      const expiresAt = new Date(pinData.expiresAt);
      if (expiresAt < new Date()) {
        await replyMessage(replyToken, [{ type: 'text', text: '❌ รหัส PIN หมดอายุแล้ว\n\nกรุณาติดต่อเจ้าหน้าที่เพื่อขอรหัส PIN ใหม่' }]);
        return;
      }
    }
    
    const memberId = pinData.memberId;
    const memberName = pinData.memberName || memberId;
    
    // Update follower with memberId
    const profile = await getProfile(userId);
    await firebaseSet('line_followers', userId, {
      displayName: profile.displayName || '',
      pictureUrl: profile.pictureUrl || '',
      memberId: memberId,
      linkedAt: new Date().toISOString(),
      lastActivity: new Date().toISOString()
    });
    
    // Mark PIN as used
    await firebaseSet('line_link_pins', pin, {
      used: true,
      usedBy: userId,
      usedAt: new Date().toISOString()
    });
    
    // Send success message
    const successFlex = getLinkSuccessFlex(memberName, memberId);
    await replyMessage(replyToken, [{
      type: 'flex',
      altText: 'ผูกบัญชีสำเร็จ!',
      contents: successFlex
    }]);
    
    console.log(`🔗 Account linked: ${userId.substring(0,10)}... -> ${memberId}`);
    
  } catch (error) {
    console.error('Error verifying PIN:', error.message);
    await replyMessage(replyToken, [{ type: 'text', text: '❌ เกิดข้อผิดพลาด กรุณาลองใหม่อีกครั้ง' }]);
  }
}

// =====================================================
// Event Handlers
// =====================================================
async function handleMessage(event) {
  const { message, replyToken, source } = event;
  const userId = source.userId;
  
  if (message.type !== 'text') return;
  
  const text = message.text.trim();
  console.log(`📨 Message from ${userId.substring(0,10)}...: "${text}"`);
  
  // บันทึก/อัปเดต user ลง Firebase
  let userProfile;
  try {
    userProfile = await getProfile(userId);
    await saveFollower(userId, userProfile, 'message');
  } catch (e) {
    console.log('Could not save user:', e.message);
  }
  
  // ถ้าข้อความมาจากกลุ่ม: ตรวจสอบโค้ดยืนยันกลุ่ม (สุ่มอัตโนมัติเฉพาะกลุ่ม) หรือออกจากกลุ่มถ้าหมดเวลา
  if (source.groupId) {
    try {
      const groupDoc = await firebaseGet('line_bot_groups', source.groupId);
      if (groupDoc && groupDoc.status === 'pending_code') {
        const expectedCode = groupDoc.verifyCode ? String(groupDoc.verifyCode).trim() : '';
        const now = new Date().toISOString();
        if (expectedCode && text.toUpperCase() === expectedCode.toUpperCase()) {
          // อัปเดตชื่อกลุ่มอีกครั้ง (อาจยังไม่ได้ตอน join)
          let gName = groupDoc.groupName || '-';
          let mCount = groupDoc.memberCount || 0;
          try {
            const summary = await getGroupSummary(source.groupId);
            if (summary && summary.groupName) gName = summary.groupName;
            const countRes = await getGroupMemberCount(source.groupId);
            if (countRes && countRes.count) mCount = countRes.count;
          } catch (e) { /* ignore */ }
          await firebaseSet('line_bot_groups', source.groupId, {
            groupId: source.groupId,
            groupName: gName,
            memberCount: mCount,
            joinedAt: groupDoc.joinedAt || now,
            status: 'verified',
            verifyCode: expectedCode,
            mustVerifyBy: groupDoc.mustVerifyBy || ''
          });
          // ส่ง Flex ยืนยันสำเร็จ (ถ้าตั้งไว้) หรือ fallback text
          let verifiedMsg = null;
          try {
            const vSettings = await firebaseGet('config', 'line_settings');
            if (vSettings && vSettings.groupVerifiedFlexJson) {
              let fStr = vSettings.groupVerifiedFlexJson.replace(/\{groupName\}/g, gName).replace(/\{code\}/g, expectedCode);
              const parsed = JSON.parse(fStr);
              verifiedMsg = parsed.type === 'flex' ? parsed : { type: 'flex', altText: `ยืนยันกลุ่ม ${gName} เรียบร้อย`, contents: parsed };
            }
          } catch (e) { /* ignore */ }
          if (!verifiedMsg) {
            verifiedMsg = { type: 'text', text: `✅ ยืนยันกลุ่ม "${gName}" เรียบร้อยครับ` };
          }
          await replyMessage(replyToken, [verifiedMsg]);
          console.log(`✅ Group "${gName}" (${source.groupId.substring(0,12)}...) verified`);
          return;
        } else if (groupDoc.mustVerifyBy && now > groupDoc.mustVerifyBy) {
          try {
            await pushMessage(source.groupId, [{ type: 'text', text: '⏰ หมดเวลายืนยันกลุ่ม บอทจะออกจากกลุ่มแล้วครับ' }]);
          } catch (e) { /* ignore */ }
          try {
            await leaveGroup(source.groupId);
            await firebaseSet('line_bot_groups', source.groupId, {
              groupId: source.groupId,
              groupName: groupDoc.groupName || '-',
              joinedAt: groupDoc.joinedAt || '',
              status: 'left',
              leftAt: now,
              mustVerifyBy: groupDoc.mustVerifyBy || ''
            });
            console.log(`👋 Left group ${source.groupId.substring(0,12)}... (หมดเวลา 5 นาที)`);
          } catch (leaveErr) {
            console.log('Could not leave group:', leaveErr.message);
          }
          return;
        } else {
          // ยังไม่หมดเวลา + ไม่ใช่โค้ดที่ถูก → ไม่ทำอะไร
          return;
        }
      }
    } catch (e) {
      console.log('Group code check error:', e.message);
    }
    try {
      const existing = await firebaseGet('line_followers', userId);
      const groups = Array.isArray(existing?.groups) ? existing.groups.slice() : [];
      const hasGroup = groups.some(g => (typeof g === 'object' && g && g.id) ? g.id === source.groupId : g === source.groupId);
      if (!hasGroup) {
        groups.push({ id: source.groupId, name: source.groupId, joinedAt: new Date().toISOString() });
        const mergeData = { displayName: existing?.displayName || '', pictureUrl: existing?.pictureUrl || '', statusMessage: existing?.statusMessage || '', isBlocked: existing?.isBlocked === true, lastActivity: new Date().toISOString(), source: 'message', groups };
        if (existing?.memberId) mergeData.memberId = existing.memberId;
        if (existing?.linkedUserId) mergeData.linkedUserId = existing.linkedUserId;
        if (existing?.followedAt) mergeData.followedAt = existing.followedAt;
        if (existing?.memberName) mergeData.memberName = existing.memberName;
        await firebaseSet('line_followers', userId, mergeData);
        console.log(`📌 User ${userId.substring(0,8)}... อยู่ในกลุ่ม ${source.groupId.substring(0,12)}...`);
      }
    } catch (e) {
      console.log('Could not update user groups:', e.message);
    }
  }
  
  // ===== Check for 6-digit PIN =====
  if (/^\d{6}$/.test(text)) {
    await verifyAndLinkPin(userId, text, replyToken);
    return;
  }

  // ===== คำสั่งปลดล็อคแอป (เฉพาะผู้ดูแลระบบ) — ระบบทำที่ backend ไม่ต้องเปิดเว็บ =====
  const unlockMatch = text.match(/ปลดล็อค(?:แอป)?\s*(\d{4,8})/i);
  if (unlockMatch) {
    const memberIdRaw = unlockMatch[1];
    let adminUser = null;
    try {
      adminUser = await firebaseQuery('users', 'lineUserId', userId);
    } catch (e) {
      console.log('Unlock: firebaseQuery admin error', e.message);
    }
    if (!adminUser || adminUser.role !== 'ผู้ดูแลระบบ') {
      await replyMessage(replyToken, [{ type: 'text', text: '⛔ คำสั่งนี้เฉพาะผู้ดูแลระบบเท่านั้น' }]);
      return;
    }
    await replyMessage(replyToken, [{ type: 'text', text: '⏳ กำลังปลดล็อคแอปให้เลข ' + memberIdRaw + '...' }]);
    let unlockResult;
    try {
      const { runBackOfficeUnlock } = require('./backoffice-unlock.js');
      unlockResult = await runBackOfficeUnlock(memberIdRaw);
    } catch (e) {
      console.error('Unlock error:', e.message);
      unlockResult = { ok: false, error: e.message || String(e) };
    }
    const resultText = unlockResult.ok
      ? '✅ ปลดล็อคแอปให้เลข ' + (unlockResult.memberId || memberIdRaw) + ' เรียบร้อยแล้ว'
      : '❌ ปลดล็อคไม่สำเร็จ: ' + (unlockResult.error || 'ไม่ทราบสาเหตุ');
    try {
      await pushMessage(userId, [{ type: 'text', text: resultText }]);
    } catch (e) {
      console.error('Push unlock result error:', e.message);
    }
    return;
  }

  // ===== Reload auto-reply rules ก่อนเช็ค (ให้ได้กฎล่าสุดจาก Firebase เสมอ) =====
  try { await loadAutoReplyRules(); } catch (e) { /* ใช้ cache เดิม */ }

  // ===== Check auto reply (with audience filtering) =====
  // มีหลายกฎที่ keyword ตรงได้ (เช่น "โปรไฟล์" มีทั้งกฎเจ้าหน้าที่และกรรมการ) — ใช้กฎแรกที่ audience ผ่าน
  const matchingRules = checkAutoReply(text);
  let matchedRule = null;
  for (const rule of matchingRules) {
    let audienceAllowed = true;
    if (rule.audience && rule.audience.type && rule.audience.type !== 'all') {
      audienceAllowed = await checkAudience(rule.audience, userId);
      if (!audienceAllowed) {
        console.log(`⏭️ Rule "${rule.name}" matched but user not in audience (${rule.audience.type})`);
        continue;
      }
    }
    matchedRule = rule;
    break;
  }

  // ไม่มี built-in fallback — ส่งเฉพาะเมื่อมีกฎจาก Firebase ที่ match และ audience ตรงเท่านั้น
  if (matchedRule) {
    // Check if reply is a template reference
    if (matchedRule.replyContent && matchedRule.replyContent.startsWith('template:')) {
      const templateId = matchedRule.replyContent.substring(9).trim();
      const template = await getTemplate(templateId);
      
      if (template) {
        if (template.type === 'flex' && template.content) {
          const flexContent = typeof template.content === 'string' ? JSON.parse(template.content) : template.content;
          await replyMessage(replyToken, [{
            type: 'flex',
            altText: template.name || 'Flex Message',
            contents: flexContent
          }]);
        } else {
          let replyText = template.content || template.text || '';
          replyText = replyText.replace(/{name}/g, userProfile?.displayName || 'คุณ');
          replyText = replyText.replace(/{date}/g, new Date().toLocaleDateString('th-TH'));
          replyText = replyText.replace(/{time}/g, new Date().toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' }));
          await replyMessage(replyToken, [{ type: 'text', text: replyText }]);
        }
        console.log('✅ Template reply sent:', templateId);
        return;
      }
    }
    
    // Check replyType - Flex Message
    if (matchedRule.replyType === 'flex' && matchedRule.flexJson) {
      try {
        const flexData = typeof matchedRule.flexJson === 'string' ? JSON.parse(matchedRule.flexJson) : matchedRule.flexJson;
        let contents = (flexData.type === 'flex' && flexData.contents) ? flexData.contents : flexData;
        let altText = (flexData.type === 'flex' && flexData.altText) ? flexData.altText : (matchedRule.name || 'Flex Message');
        // แทนที่ placeholder {fullname}, {avatar}, ... ด้วยข้อมูลจาก Firestore + line_followers
        let replacements = { name: userProfile?.displayName || 'คุณ', date: new Date().toLocaleDateString('th-TH'), time: new Date().toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' }) };
        try {
          const profileData = await getProfileReplacementsForLineUser(userId, userProfile);
          replacements = { ...replacements, ...profileData };
          // ถ้ามีข้อมูลเพิ่มเติมใน line_followers (จากการแก้ไขที่ link.nkbkcoop.com)
          const followerData = await firebaseGet('line_followers', userId);
          if (followerData) {
            if (followerData.fullname) replacements.fullname = followerData.fullname;
            if (followerData.email) replacements.email = followerData.email;
            if (followerData.avatar) replacements.avatar = followerData.avatar;
          }
        } catch (e) { console.log('Profile replacement warning:', e.message); }
        contents = replaceFlexPlaceholders(contents, replacements);
        altText = replaceFlexPlaceholders(altText, replacements);
        const flexMessage = { type: 'flex', altText, contents };
        await replyMessage(replyToken, [flexMessage]);
        console.log('✅ Flex auto reply sent:', matchedRule.name);
        return;
      } catch (e) {
        console.error('❌ Error with flex reply:', e.message);
        // Fallback: ส่งข้อความแจ้งแทน
        try {
          await replyMessage(replyToken, [{ type: 'text', text: '⚠️ ไม่สามารถแสดงข้อมูลได้ กรุณาลองใหม่อีกครั้ง' }]);
        } catch (e2) { console.error('Fallback reply also failed:', e2.message); }
        return;
      }
    }
    
    // Check replyType - Image
    if (matchedRule.replyType === 'image' && matchedRule.imageUrl) {
      await replyMessage(replyToken, [{
        type: 'image',
        originalContentUrl: matchedRule.imageUrl,
        previewImageUrl: matchedRule.imageUrl
      }]);
      console.log('✅ Image auto reply sent:', matchedRule.name);
      return;
    }
    
    // Regular text reply (default)
    if (matchedRule.replyContent) {
      let replyText = matchedRule.replyContent;
      replyText = replyText.replace(/{name}/g, userProfile?.displayName || 'คุณ');
      replyText = replyText.replace(/{date}/g, new Date().toLocaleDateString('th-TH'));
      replyText = replyText.replace(/{time}/g, new Date().toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' }));
      
      await replyMessage(replyToken, [{ type: 'text', text: replyText }]);
      console.log('✅ Auto reply sent:', matchedRule.name);
    }
    return;
  }

  // ===== AI Chat (ถ้า Auto Reply ไม่ match — ตามสเปก docs/ai-chat-spec.md) =====
  try {
    const aiChat = require('./ai-chat.js');
    await aiChat.tryAiChat(
      { replyMessage, pushMessage, firebaseGet, firebaseSet, firebaseGetCollection, firebaseQuery },
      replyToken,
      text,
      userId,
      source,
      userProfile || {}
    );
  } catch (e) {
    console.warn('AI chat:', e.message);
  }
}

async function handleFollow(event) {
  const { replyToken, source } = event;
  const userId = source.userId;
  
  console.log(`👤 New follower: ${userId.substring(0,10)}...`);
  
  try {
    // Get profile and save to Firebase
    const profile = await getProfile(userId);
    await saveFollower(userId, profile, 'follow');
    console.log(`   Saved: ${profile.displayName}`);
    
    // Get welcome message from Firebase
    const settings = await firebaseGet('config', 'line_settings');
    
    if (settings && settings.welcomeEnabled) {
      const welcomeType = settings.welcomeType || 'text';
      let messages = [];
      
      if (welcomeType === 'flex' && settings.welcomeFlexJson) {
        try {
          const parsed = JSON.parse(settings.welcomeFlexJson);
          if (parsed.type === 'flex') {
            messages = [parsed];
          } else {
            messages = [{ type: 'flex', altText: 'ยินดีต้อนรับ', contents: parsed }];
          }
        } catch (e) {
          console.error('Invalid welcome Flex JSON:', e.message);
        }
      } else if (settings.welcomeMessage) {
        let welcomeText = settings.welcomeMessage;
        welcomeText = welcomeText.replace(/{name}/g, profile.displayName || 'คุณ');
        welcomeText = welcomeText.replace(/{date}/g, new Date().toLocaleDateString('th-TH'));
        messages = [{ type: 'text', text: welcomeText }];
      }
      
      if (messages.length > 0) {
        await replyMessage(replyToken, messages);
        console.log(`✅ Welcome message sent (${welcomeType})`);
      }
    }
  } catch (error) {
    console.error('Error handling follow:', error.message);
  }
}

async function handleUnfollow(event) {
  const userId = event.source.userId;
  console.log(`👋 User unfollowed: ${userId.substring(0,10)}...`);
  
  // อัปเดตสถานะเป็น blocked
  try {
    await firebaseSet('line_followers', userId, {
      isBlocked: true,
      unfollowedAt: new Date().toISOString()
    });
  } catch (e) {
    console.log('Could not update unfollow status');
  }
}

// บอทถูก add เข้ากลุ่ม → สุ่มโค้ดอัตโนมัติ + ดึงชื่อกลุ่ม + ส่งข้อความต้อนรับ + แจ้งโค้ด
async function handleJoin(event) {
  const source = event.source || {};
  const replyToken = event.replyToken;
  if (source.type === 'group' && source.groupId) {
    const groupId = source.groupId;
    const now = new Date();
    const mustVerifyBy = new Date(now.getTime() + 5 * 60 * 1000).toISOString();
    const verifyCode = generateGroupCode();
    // ดึงชื่อกลุ่มจาก LINE API
    let groupName = '-';
    let memberCount = 0;
    try {
      const summary = await getGroupSummary(groupId);
      if (summary && summary.groupName) groupName = summary.groupName;
      if (summary && summary.pictureUrl) { /* could store later */ }
    } catch (e) { console.log('Could not get group summary:', e.message); }
    try {
      const countRes = await getGroupMemberCount(groupId);
      if (countRes && countRes.count) memberCount = countRes.count;
    } catch (e) { /* ignore */ }
    try {
      await firebaseSet('line_bot_groups', groupId, {
        groupId,
        groupName,
        memberCount,
        joinedAt: now.toISOString(),
        status: 'pending_code',
        verifyCode,
        mustVerifyBy
      });
      console.log(`✅ Bot joined group "${groupName}" (${groupId.substring(0, 12)}...) code=${verifyCode} expires=${mustVerifyBy}`);
    } catch (e) {
      console.log('Could not save bot group:', e.message);
    }
    try {
      const settings = await firebaseGet('config', 'line_settings');
      const messages = [];
      // ส่งเฉพาะข้อความโค้ดยืนยัน (ไม่ส่งต้อนรับแยก)
      let sentVerifyMsg = false;
      if (settings && settings.groupVerifyFlexJson) {
        try {
          let flexStr = settings.groupVerifyFlexJson;
          flexStr = flexStr.replace(/\{code\}/g, verifyCode).replace(/\{minutes\}/g, '5').replace(/\{groupName\}/g, groupName);
          const parsed = JSON.parse(flexStr);
          messages.push(parsed.type === 'flex' ? parsed : { type: 'flex', altText: 'รหัสยืนยันกลุ่ม', contents: parsed });
          sentVerifyMsg = true;
        } catch (e) { /* ignore */ }
      }
      if (!sentVerifyMsg) {
        messages.push({ type: 'text', text: `🔐 เพื่อยืนยันกลุ่ม "${groupName}" กรุณาส่งโค้ดนี้ภายใน 5 นาที:\n\n👉 ${verifyCode}\n\nหากไม่ส่งโค้ด บอทจะออกจากกลุ่มอัตโนมัติ` });
      }
      if (replyToken && messages.length > 0) {
        await replyMessage(replyToken, messages);
      }
    } catch (e) {
      console.log('Could not send group welcome:', e.message);
      if (replyToken) {
        await replyMessage(replyToken, [{ type: 'text', text: `🔐 กรุณาส่งโค้ด ${verifyCode} ภายใน 5 นาทีเพื่อยืนยันกลุ่ม` }]).catch(() => {});
      }
    }
  } else if (source.type === 'room' && source.roomId) {
    try {
      await firebaseSet('line_bot_rooms', source.roomId, {
        roomId: source.roomId,
        joinedAt: new Date().toISOString()
      });
      console.log(`✅ Bot joined room: ${source.roomId.substring(0, 12)}...`);
    } catch (e) {
      console.log('Could not save bot room:', e.message);
    }
  }
}

// บันทึก Follower ลง Firebase (merge กับข้อมูลเดิม ไม่ลบ groups, memberId, linkedUserId, followedAt)
async function saveFollower(userId, profile, source = 'unknown') {
  let existing = null;
  try {
    existing = await firebaseGet('line_followers', userId);
  } catch (e) { /* ignore */ }
  const data = {
    displayName: profile.displayName || '',
    pictureUrl: profile.pictureUrl || '',
    statusMessage: profile.statusMessage || '',
    isBlocked: existing && existing.isBlocked === true,
    lastActivity: new Date().toISOString(),
    source: source
  };
  if (existing) {
    if (existing.groups) data.groups = existing.groups;
    if (existing.memberId) data.memberId = existing.memberId;
    if (existing.linkedUserId) data.linkedUserId = existing.linkedUserId;
    if (existing.followedAt) data.followedAt = existing.followedAt;
    if (existing.memberName) data.memberName = existing.memberName;
  }
  if (source === 'follow' && !data.followedAt) {
    data.followedAt = new Date().toISOString();
  }
  await firebaseSet('line_followers', userId, data);
  console.log(`💾 Saved follower: ${profile.displayName}`);
}

async function handleEvent(event) {
  const type = event.type;
  console.log(`📌 Event: ${type}`);
  
  switch (type) {
    case 'message':
      await handleMessage(event);
      break;
    case 'follow':
      await handleFollow(event);
      break;
    case 'unfollow':
      await handleUnfollow(event);
      break;
    case 'join':
      await handleJoin(event);
      break;
    case 'leave': {
      const leftSource = event.source || {};
      const leftGroupId = leftSource.groupId;
      if (leftGroupId) {
        try {
          const cur = await firebaseGet('line_bot_groups', leftGroupId);
          if (cur) {
            await firebaseSet('line_bot_groups', leftGroupId, {
              groupId: leftGroupId,
              joinedAt: cur.joinedAt || new Date().toISOString(),
              status: 'left',
              leftAt: new Date().toISOString(),
              mustVerifyBy: cur.mustVerifyBy || ''
            });
          }
        } catch (e) { /* ignore */ }
      }
      console.log(`👋 Bot left: ${leftGroupId || leftSource.roomId || '?'}`);
      break;
    }
    case 'postback':
      console.log(`🔘 Postback: ${event.postback.data}`);
      break;
  }
}

// =====================================================
// HTTP Server
// =====================================================

/** อ่าน body บน Cloud Functions (req.rawBody) หรือ NAS (stream) */
function normalizeRawBody(buf) {
  if (buf == null) return null;
  return Buffer.isBuffer(buf) ? buf : Buffer.from(buf);
}

function readIncomingBody(req) {
  const existing = normalizeRawBody(req.rawBody);
  if (existing) return Promise.resolve(existing);
  return new Promise((resolve, reject) => {
    const chunks = [];
    if (req.readableEnded) {
      resolve(Buffer.alloc(0));
      return;
    }
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
    if (typeof req.resume === 'function') req.resume();
  });
}

async function bufferRequestBody(req) {
  if (!['POST', 'PUT', 'PATCH'].includes(req.method || '')) return;
  if (req.rawBody != null) {
    req.rawBody = normalizeRawBody(req.rawBody);
    return;
  }
  req.rawBody = await readIncomingBody(req);
}

const server = http.createServer(async (req, res) => {
  try {
    await bufferRequestBody(req);
  } catch (e) {
    res.writeHead(500);
    res.end(JSON.stringify({ error: e.message || 'Body read failed' }));
    return;
  }

  const parsedUrl = url.parse(req.url, true);
  const pathname = parsedUrl.pathname;
  
  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Line-Signature, X-Monitor-Token');
  res.setHeader('Content-Type', 'application/json');
  
  // OPTIONS (preflight)
  if (req.method === 'OPTIONS') {
    res.writeHead(200);
    res.end();
    return;
  }

  // Org email (Cloudflare) — /v1/send, /v1/send/test, /v1/health
  if (pathname.includes('/v1/send') || pathname.endsWith('/v1/health')) {
    try {
      const orgEmail = require('./org-email');
      const handled = await orgEmail.handleRoute(req, res, pathname);
      if (handled) return;
    } catch (e) {
      console.error('org-email:', e.message);
      res.writeHead(500);
      res.end(JSON.stringify({ ok: false, error: e.message }));
      return;
    }
  }
  
  // API: Push Message to Group (รองรับ text, flex, messages array)
  if (pathname.endsWith('/api/push-group') && req.method === 'POST') {
    (async () => {
      try {
        const body = (req.rawBody || Buffer.alloc(0)).toString('utf-8');
        const data = JSON.parse(body);
        const { groupId, message, messages } = data;
        if (!groupId) {
          res.writeHead(400);
          res.end(JSON.stringify({ success: false, error: 'Missing groupId' }));
          return;
        }
        if (!LINE_CONFIG.accessToken) {
          res.writeHead(400);
          res.end(JSON.stringify({ success: false, error: 'LINE not configured' }));
          return;
        }
        // รองรับทั้ง messages array (text/flex/image) หรือ message string เดิม
        const msgArray = Array.isArray(messages) ? messages : (message ? [{ type: 'text', text: message }] : null);
        if (!msgArray || msgArray.length === 0) {
          res.writeHead(400);
          res.end(JSON.stringify({ success: false, error: 'Missing message or messages' }));
          return;
        }
        const result = await pushMessage(groupId, msgArray);
        console.log(`📤 Push group message to ${groupId.substring(0,15)}... (${msgArray.length} msg)`, JSON.stringify(result));
        if (result && result.message) {
          // LINE API returned error
          res.writeHead(200);
          res.end(JSON.stringify({ success: false, error: result.message || 'LINE API error', detail: result }));
        } else {
          res.writeHead(200);
          res.end(JSON.stringify({ success: true, result }));
        }
      } catch (error) {
        console.error('Push group error:', error.message);
        res.writeHead(500);
        res.end(JSON.stringify({ success: false, error: error.message }));
      }
    })();
    return;
  }

  // API: Push Message
  if (pathname.endsWith('/api/push') && req.method === 'POST') {
    (async () => {
      try {
        const body = (req.rawBody || Buffer.alloc(0)).toString('utf-8');
        const data = JSON.parse(body);
        const { userId, message, messages } = data;
        
        if (!userId) {
          res.writeHead(400);
          res.end(JSON.stringify({ success: false, error: 'Missing userId' }));
          return;
        }
        
        if (!LINE_CONFIG.accessToken) {
          res.writeHead(400);
          res.end(JSON.stringify({ success: false, error: 'LINE not configured' }));
          return;
        }
        
        // รองรับทั้ง messages array (text/flex) หรือ message string เดิม
        const msgArray = Array.isArray(messages) ? messages : (message ? [{ type: 'text', text: message }] : null);
        if (!msgArray || msgArray.length === 0) {
          res.writeHead(400);
          res.end(JSON.stringify({ success: false, error: 'Missing message or messages' }));
          return;
        }
        
        const result = await pushMessage(userId, msgArray);
        console.log(`📤 Push message to ${userId.substring(0,10)}... (${msgArray.length} msg) OK`);
        res.writeHead(200);
        res.end(JSON.stringify({ success: true, result }));
      } catch (error) {
        console.error('❌ Push error:', error.message, error.responseBody || '');
        res.writeHead(200);
        res.end(JSON.stringify({
          success: false,
          error: error.message,
          detail: error.responseBody,
          statusCode: error.statusCode
        }));
      }
    })();
    return;
  }
  
  // API: Link Account via LIFF
  if (pathname.endsWith('/api/link-account') && req.method === 'POST') {
    (async () => {
      try {
        const body = (req.rawBody || Buffer.alloc(0)).toString('utf-8');
        const data = JSON.parse(body);
        const { lineUserId, lineDisplayName, linePictureUrl, memberId, memberName } = data;

        if (!lineUserId || !memberId) {
          res.writeHead(400);
          res.end(JSON.stringify({ success: false, error: 'Missing lineUserId or memberId' }));
          return;
        }

        // Check if already linked
        const existing = await firebaseGet('line_followers', lineUserId);
        if (existing && existing.memberId) {
          res.writeHead(409);
          res.end(JSON.stringify({ success: false, error: 'already_linked', existingMemberId: existing.memberId }));
          return;
        }

        // Update line_followers
        await firebaseSet('line_followers', lineUserId, {
          displayName: lineDisplayName || '',
          pictureUrl: linePictureUrl || '',
          memberId: memberId,
          memberName: memberName || '',
          linkedAt: new Date().toISOString(),
          lastActivity: new Date().toISOString()
        });

        console.log(`🔗 LIFF Account linked: ${lineUserId.substring(0,10)}... -> ${memberId}`);

        res.writeHead(200);
        res.end(JSON.stringify({ success: true, message: 'Account linked successfully' }));
      } catch (error) {
        console.error('Link account error:', error.message);
        res.writeHead(500);
        res.end(JSON.stringify({ success: false, error: error.message }));
      }
    })();
    return;
  }

  // API: Update LINE Profile
  if (pathname.endsWith('/api/update-profile') && req.method === 'POST') {
    (async () => {
      try {
        const body = (req.rawBody || Buffer.alloc(0)).toString('utf-8');
        const data = JSON.parse(body);
        const { lineUserId, displayName, pictureUrl } = data;

        if (!lineUserId) {
          res.writeHead(400);
          res.end(JSON.stringify({ success: false, error: 'Missing lineUserId' }));
          return;
        }

        await firebaseSet('line_followers', lineUserId, {
          displayName: displayName || '',
          pictureUrl: pictureUrl || '',
          lastActivity: new Date().toISOString()
        });

        console.log(`🔄 Profile updated: ${lineUserId.substring(0,10)}...`);
        res.writeHead(200);
        res.end(JSON.stringify({ success: true, message: 'Profile updated successfully' }));
      } catch (error) {
        console.error('Update profile error:', error.message);
        res.writeHead(500);
        res.end(JSON.stringify({ success: false, error: error.message }));
      }
    })();
    return;
  }

  // API: Unlink Account
  if (pathname.endsWith('/api/unlink-account') && req.method === 'POST') {
    (async () => {
      try {
        const body = (req.rawBody || Buffer.alloc(0)).toString('utf-8');
        const data = JSON.parse(body);
        const { lineUserId } = data;

        if (!lineUserId) {
          res.writeHead(400);
          res.end(JSON.stringify({ success: false, error: 'Missing lineUserId' }));
          return;
        }

        await firebaseSet('line_followers', lineUserId, {
          memberId: '',
          memberName: '',
          linkedAt: '',
          unlinkedAt: new Date().toISOString()
        });

        console.log(`🔓 Account unlinked: ${lineUserId.substring(0,10)}...`);
        res.writeHead(200);
        res.end(JSON.stringify({ success: true, message: 'Account unlinked successfully' }));
      } catch (error) {
        console.error('Unlink account error:', error.message);
        res.writeHead(500);
        res.end(JSON.stringify({ success: false, error: error.message }));
      }
    })();
    return;
  }

  // API: Update User Profile (from LIFF edit form)
  if (pathname.endsWith('/api/update-user-profile') && req.method === 'POST') {
    (async () => {
      try {
        const body = (req.rawBody || Buffer.alloc(0)).toString('utf-8');
        const data = JSON.parse(body);
        const { lineUserId, fullname, email, avatar, signature, username, pin, employmentStart, aiChatCallName } = data;

        if (!lineUserId) {
          res.writeHead(400);
          res.end(JSON.stringify({ success: false, error: 'Missing lineUserId' }));
          return;
        }

        // Find user by lineUserId (or via line_followers → memberId)
        let user = null;
        let currentFollower = null;
        try { user = await firebaseQuery('users', 'lineUserId', lineUserId); } catch (e) {}
        if (!user) {
          try {
            currentFollower = await firebaseGet('line_followers', lineUserId);
            if (currentFollower && currentFollower.memberId) {
              user = await firebaseGet('users', currentFollower.memberId);
              if (user) user.id = currentFollower.memberId;
            }
          } catch (e) {}
        }
        if (!currentFollower) {
          try { currentFollower = await firebaseGet('line_followers', lineUserId); } catch (e) {}
        }

        // Save profile data in line_followers — ต้องคง memberId/linkedUserId ไว้ไม่งั้นบอทจะไม่ตอบ (checkAudience จะได้ memberId จาก line_followers)
        const followerUpdate = { lastActivity: new Date().toISOString() };
        if (fullname) followerUpdate.memberName = fullname;
        if (fullname) followerUpdate.fullname = fullname;
        if (email !== undefined) followerUpdate.email = email;
        if (avatar) followerUpdate.avatar = avatar;
        if (signature) followerUpdate.signature = signature;
        // ไม่เปลี่ยน memberId ตอนอัปเดต username — ใช้สำหรับ lookup กับ users collection
        // คงค่าเดิมที่ใช้ในการผูกบัญชีและเช็ค audience (ห้ามเขียนทับเป็นค่าว่าง)
        if (currentFollower) {
          if (currentFollower.memberId) followerUpdate.memberId = currentFollower.memberId;
          if (currentFollower.linkedUserId !== undefined && currentFollower.linkedUserId !== null) followerUpdate.linkedUserId = currentFollower.linkedUserId;
          if (currentFollower.linkedAt) followerUpdate.linkedAt = currentFollower.linkedAt;
        }
        await firebaseSet('line_followers', lineUserId, followerUpdate);

        // Try to update users collection (may fail due to permissions — that's OK)
        let usersUpdated = false;
        if (user && user.id) {
          try {
            const updateData = {};
            if (fullname !== undefined && fullname !== '') updateData.fullname = fullname;
            if (email !== undefined) updateData.email = email;
            if (username !== undefined && username !== '') updateData.username = username;
            if (pin !== undefined && typeof pin === 'string' && /^\d{6}$/.test(pin)) updateData.pin = pin;
            if (employmentStart !== undefined && employmentStart !== null && employmentStart !== '') updateData.employmentStart = employmentStart;
            if (aiChatCallName !== undefined) updateData.aiChatCallName = (aiChatCallName && String(aiChatCallName).trim()) ? String(aiChatCallName).trim() : null;
            if (avatar) updateData.avatar = avatar;
            if (signature) updateData.signature = signature;
            // คง lineUserId ไว้เพื่อให้ webhook หา user จาก LINE ได้หลังแก้ไขอีเมล
            if (user.lineUserId) updateData.lineUserId = user.lineUserId;
            else if (lineUserId) updateData.lineUserId = lineUserId;
            await firebaseSet('users', user.id, updateData);
            usersUpdated = true;
            console.log(`📝 User profile updated: ${user.id}`);
          } catch (e) {
            console.log(`⚠️ Could not update users/${user.id} (permission denied?) — data saved in line_followers`);
          }
        }

        res.writeHead(200);
        res.end(JSON.stringify({ success: true, message: 'Profile updated', usersUpdated }));
      } catch (error) {
        console.error('Update user profile error:', error.message);
        res.writeHead(500);
        res.end(JSON.stringify({ success: false, error: error.message }));
      }
    })();
    return;
  }

  // API: Test Welcome Message (push to user)
  if (pathname.endsWith('/api/test-welcome') && req.method === 'POST') {
    const chunks = [];
    req.on('data', chunk => chunks.push(chunk));
    req.on('end', async () => {
      try {
        const body = Buffer.concat(chunks).toString('utf-8');
        const { userId, messages } = JSON.parse(body);
        if (!userId || !messages || !messages.length) {
          res.writeHead(400);
          res.end(JSON.stringify({ success: false, error: 'Missing userId or messages' }));
          return;
        }
        await pushMessage(userId, messages);
        console.log(`📨 Test welcome sent to ${userId.substring(0,10)}...`);
        res.writeHead(200);
        res.end(JSON.stringify({ success: true }));
      } catch (e) {
        console.error('Test welcome error:', e.message);
        res.writeHead(500);
        res.end(JSON.stringify({ success: false, error: e.message }));
      }
    })();
    return;
  }

  // API: Reload Config
  if (pathname.endsWith('/api/reload') && req.method === 'POST') {
    await loadLineConfig();
    await loadAutoReplyRules();
    res.writeHead(200);
    res.end(JSON.stringify({ success: true, message: 'Config reloaded' }));
    return;
  }
  
  // API: Bot Info
  if (pathname.endsWith('/api/bot-info') && req.method === 'GET') {
    try {
      const info = await callLineAPI('/v2/bot/info', 'GET');
      res.writeHead(200);
      res.end(JSON.stringify({ success: true, info }));
    } catch (error) {
      res.writeHead(500);
      res.end(JSON.stringify({ success: false, error: error.message }));
    }
    return;
  }
  
  // API: Get Followers List
  if (pathname.endsWith('/api/followers') && req.method === 'GET') {
    try {
      const followers = await firebaseGetCollection('line_followers');
      res.writeHead(200);
      res.end(JSON.stringify({ success: true, followers }));
    } catch (error) {
      res.writeHead(500);
      res.end(JSON.stringify({ success: false, error: error.message }));
    }
    return;
  }

  // API: Site settings (public branding for installer / LIFF) — จาก config/site ใน Firestore
  if (pathname.endsWith('/api/site-settings') && req.method === 'GET') {
    try {
      const site = await firebaseGet('config', 'site');
      const out = {
        systemTitle: (site && site.systemTitle) ? String(site.systemTitle).trim() : '',
        orgNameTH: (site && site.orgNameTH) ? String(site.orgNameTH).trim() : '',
        orgNameEN: (site && site.orgNameEN) ? String(site.orgNameEN).trim() : '',
        orgShortName: (site && site.orgShortName) ? String(site.orgShortName).trim() : '',
        logoUrl: (site && site.logoUrl) ? String(site.logoUrl).trim() : '',
        faviconUrl: (site && site.faviconUrl) ? String(site.faviconUrl).trim() : '',
        colorPrimary: (site && site.colorPrimary) ? String(site.colorPrimary).trim() : '#6366f1',
        colorSecondary: (site && site.colorSecondary) ? String(site.colorSecondary).trim() : '#4f46e5',
        colorAccent: (site && site.colorAccent) ? String(site.colorAccent).trim() : '#f59e0b',
        colorBg: (site && site.colorBg) ? String(site.colorBg).trim() : '#f9fafb'
      };
      res.writeHead(200);
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.end(JSON.stringify(out));
    } catch (e) {
      console.error('Site settings error:', e.message);
      res.writeHead(500);
      res.end(JSON.stringify({ systemTitle: '', orgNameTH: '', orgNameEN: '', orgShortName: '', logoUrl: '', faviconUrl: '', colorPrimary: '#6366f1', colorSecondary: '#4f46e5', colorAccent: '#f59e0b', colorBg: '#f9fafb' }));
    }
    return;
  }

  // API: Monitor app login — แอป NKBKConnext ใช้ล็อกอินผ่านเซิร์ฟเวอร์ (ไม่ต้องมี firebase-service-account บนเครื่อง)
  if (pathname.endsWith('/api/monitor-me') && req.method === 'GET') {
    const token = (req.headers['x-monitor-token'] || '').trim();
    const session = token ? MONITOR_SESSIONS.get(token) : null;
    if (!session) {
      res.writeHead(401);
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.end(JSON.stringify({ ok: false }));
      return;
    }
    (async () => {
      let fullname = session.fullname || '';
      let email = session.email || '';
      let group = session.group || '';
      let role = session.role || '';
      try {
        const u = String(session.username || '').trim();
        if (u) {
          let q = u;
          if (/^\d+$/.test(q)) q = q.padStart(6, '0').slice(-6);
          let user = await firebaseQuery('users', 'username', q);
          if (!user) {
            const all = await firebaseGetCollection('users', { pageSize: 300 });
            const lower = u.toLowerCase();
            user = (all || []).find((x) => x && String(x.username || '').toLowerCase() === lower);
          }
          if (user) {
            fullname = user.fullname != null ? String(user.fullname).trim() : '';
            email = user.email != null ? String(user.email).trim() : '';
            group = user.group != null ? String(user.group).trim() : '';
            role = user.role != null ? String(user.role).trim() : '';
          }
        }
      } catch (e) {
        console.error('monitor-me profile:', e.message);
      }
      res.writeHead(200);
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.end(JSON.stringify({ ok: true, username: session.username, fullname, email, group, role }));
    })().catch((e) => {
      console.error('monitor-me:', e);
      try {
        res.writeHead(500);
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.end(JSON.stringify({ ok: false }));
      } catch (_) {}
    });
    return;
  }

  if (pathname.endsWith('/api/monitor-logout') && req.method === 'POST') {
    (async () => {
      try {
        const body = (req.rawBody || Buffer.alloc(0)).toString('utf-8');
        const data = JSON.parse(body || '{}');
        const token = (req.headers['x-monitor-token'] || (data && data.token) || '').trim();
        if (token) MONITOR_SESSIONS.delete(token);
        res.writeHead(200);
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.end(JSON.stringify({ ok: true }));
      } catch (e) {
        res.writeHead(200);
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.end(JSON.stringify({ ok: true }));
      }
    })();
    return;
  }

  if (pathname.endsWith('/api/monitor-login') && req.method === 'POST') {
    (async () => {
      try {
        const body = (req.rawBody || Buffer.alloc(0)).toString('utf-8');
        const data = JSON.parse(body);
        let username = (data.username || '').toString().trim();
        const pin = (data.pin || '').toString().trim();
        if (!username) {
          res.writeHead(400);
          res.setHeader('Content-Type', 'application/json; charset=utf-8');
          res.end(JSON.stringify({ ok: false, message: 'กรุณากรอกชื่อผู้ใช้' }));
          return;
        }
        if (pin.length !== 6 || !/^\d{6}$/.test(pin)) {
          res.writeHead(400);
          res.setHeader('Content-Type', 'application/json; charset=utf-8');
          res.end(JSON.stringify({ ok: false, message: 'รหัส PIN ต้องเป็นตัวเลข 6 หลัก' }));
          return;
        }
        if (/^\d+$/.test(username)) username = username.padStart(6, '0').slice(-6);
        let user = null;
        try {
          user = await firebaseQuery('users', 'username', username);
          if (!user && username.length > 0) {
            const all = await firebaseGetCollection('users', { pageSize: 300 });
            const lower = username.toLowerCase();
            const found = (all || []).find(u => u && String(u.username || '').toLowerCase() === lower);
            if (found) user = found;
          }
        } catch (e) {
          const msg = (e && e.message) ? String(e.message) : '';
          if (msg.includes('timed out')) {
            console.error('Monitor login: Firestore timeout — NAS อาจออกเน็ตไม่ได้หรือ DNS ช้า');
            res.writeHead(503);
            res.setHeader('Content-Type', 'application/json; charset=utf-8');
            res.end(JSON.stringify({
              ok: false,
              message: 'เซิร์ฟเวอร์เชื่อมต่อฐานข้อมูลไม่ได้ (หมดเวลา) — ตรวจสอบว่า NAS ออกอินเทอร์เน็ตและเข้าถึง firestore.googleapis.com ได้'
            }));
            return;
          }
        }
        if (!user || !(user.fullname && String(user.fullname).trim())) {
          res.writeHead(200);
          res.setHeader('Content-Type', 'application/json; charset=utf-8');
          res.end(JSON.stringify({ ok: false, message: 'ชื่อผู้ใช้หรือรหัส PIN ไม่ถูกต้อง' }));
          return;
        }
        const userPin = String(user.pin != null ? user.pin : '').trim();
        if (userPin !== pin.trim()) {
          res.writeHead(200);
          res.setHeader('Content-Type', 'application/json; charset=utf-8');
          res.end(JSON.stringify({ ok: false, message: 'ชื่อผู้ใช้หรือรหัส PIN ไม่ถูกต้อง' }));
          return;
        }
        const g = String(user.group || '').trim();
        const r = String(user.role || '').trim();
        if (g === 'สมาชิก') {
          res.writeHead(200);
          res.setHeader('Content-Type', 'application/json; charset=utf-8');
          res.end(JSON.stringify({ ok: false, message: 'บัญชีนี้ไม่มีสิทธิ์เข้าแอป Monitor (เฉพาะเจ้าหน้าที่/กรรมการ/ผู้ดูแลระบบ)' }));
          return;
        }
        if (g !== 'เจ้าหน้าที่' && g !== 'กรรมการ' && r !== 'ผู้ดูแลระบบ' && r.indexOf('ผู้ดูแล') < 0 && g) {
          res.writeHead(200);
          res.setHeader('Content-Type', 'application/json; charset=utf-8');
          res.end(JSON.stringify({ ok: false, message: 'บัญชีนี้ไม่มีสิทธิ์เข้าแอป Monitor' }));
          return;
        }
        const token = crypto.randomBytes(24).toString('hex');
        const sessionName = String(user.username || username).trim() || username;
        MONITOR_SESSIONS.set(token, {
          username: sessionName,
          createdAt: Date.now(),
          fullname: user.fullname != null ? String(user.fullname).trim() : '',
          email: user.email != null ? String(user.email).trim() : '',
          group: user.group != null ? String(user.group).trim() : '',
          role: user.role != null ? String(user.role).trim() : ''
        });
        res.writeHead(200);
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.end(JSON.stringify({ ok: true, token, username: sessionName }));
      } catch (error) {
        console.error('Monitor login error:', error.message);
        res.writeHead(500);
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.end(JSON.stringify({ ok: false, message: 'เกิดข้อผิดพลาด กรุณาลองใหม่' }));
      }
    })();
    return;
  }

  // --- Meetdoc portal API ---
  function loadMeetdocApi() {
    try {
      return require('../lib/meetdoc-api');
    } catch (_) {
      try {
        return require('../../lib/meetdoc-api');
      } catch (e2) {
        return null;
      }
    }
  }

  function meetdocToken(req, body) {
    const b = body || {};
    return String(req.headers['x-meetdoc-token'] || b.token || '').trim();
  }

  function jsonMeetdoc(res, status, obj) {
    res.writeHead(status);
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.end(JSON.stringify(obj));
  }

  if (pathname.endsWith('/api/meetdoc-exchange') && req.method === 'POST') {
    (async () => {
      try {
        const api = loadMeetdocApi();
        if (!api) {
          jsonMeetdoc(res, 503, { ok: false, message: 'Meetdoc API unavailable' });
          return;
        }
        const body = (req.rawBody || Buffer.alloc(0)).toString('utf-8');
        const data = JSON.parse(body || '{}');
        const monitorToken = String(data.monitorToken || req.headers['x-monitor-token'] || '').trim();
        const session = monitorToken ? MONITOR_SESSIONS.get(monitorToken) : null;
        const result = await api.exchangeFromMonitorSession(session);
        jsonMeetdoc(res, 200, result);
      } catch (e) {
        jsonMeetdoc(res, 500, { ok: false, message: e.message });
      }
    })();
    return;
  }

  if (pathname.endsWith('/api/meetdoc-login') && req.method === 'POST') {
    (async () => {
      try {
        const api = loadMeetdocApi();
        if (!api) {
          jsonMeetdoc(res, 503, { ok: false, message: 'Meetdoc API unavailable' });
          return;
        }
        const body = (req.rawBody || Buffer.alloc(0)).toString('utf-8');
        const data = JSON.parse(body || '{}');
        const result = await api.loginWithPin(data.username, data.pin);
        jsonMeetdoc(res, 200, result);
      } catch (e) {
        console.error('meetdoc-login:', e.message);
        jsonMeetdoc(res, 500, { ok: false, message: 'เกิดข้อผิดพลาด' });
      }
    })();
    return;
  }

  if (pathname.endsWith('/api/meetdoc-line-login') && req.method === 'POST') {
    (async () => {
      try {
        const api = loadMeetdocApi();
        if (!api) {
          jsonMeetdoc(res, 503, { ok: false, message: 'Meetdoc API unavailable' });
          return;
        }
        const body = (req.rawBody || Buffer.alloc(0)).toString('utf-8');
        const data = JSON.parse(body || '{}');
        const result = await api.loginWithLine(data.lineUserId);
        jsonMeetdoc(res, 200, result);
      } catch (e) {
        jsonMeetdoc(res, 500, { ok: false, message: e.message });
      }
    })();
    return;
  }

  if (pathname.endsWith('/api/meetdoc-line-link') && req.method === 'POST') {
    (async () => {
      try {
        const api = loadMeetdocApi();
        const body = (req.rawBody || Buffer.alloc(0)).toString('utf-8');
        const data = JSON.parse(body || '{}');
        const result = await api.linkLineAccount(data.lineUserId, data.username);
        jsonMeetdoc(res, 200, result);
      } catch (e) {
        jsonMeetdoc(res, 500, { ok: false, message: e.message });
      }
    })();
    return;
  }

  if (pathname.endsWith('/api/meetdoc/meetings') && req.method === 'GET') {
    (async () => {
      try {
        const api = loadMeetdocApi();
        const q = url.parse(req.url, true).query || {};
        const token = meetdocToken(req, q);
        const result = await api.listMeetings(token, { queue: q.queue === 'approval' });
        jsonMeetdoc(res, result.ok ? 200 : 401, result);
      } catch (e) {
        jsonMeetdoc(res, 500, { ok: false, message: e.message });
      }
    })();
    return;
  }

  const meetdocMeetingMatch = pathname.match(/\/api\/meetdoc\/meetings\/([^/]+)(?:\/(file|approve|reject))?$/);
  if (meetdocMeetingMatch && req.method === 'GET' && !meetdocMeetingMatch[2]) {
    (async () => {
      try {
        const api = loadMeetdocApi();
        const token = meetdocToken(req, url.parse(req.url, true).query);
        const result = await api.getMeeting(token, meetdocMeetingMatch[1]);
        jsonMeetdoc(res, result.ok ? 200 : 404, result);
      } catch (e) {
        jsonMeetdoc(res, 500, { ok: false, message: e.message });
      }
    })();
    return;
  }

  if (meetdocMeetingMatch && meetdocMeetingMatch[2] === 'file' && req.method === 'GET') {
    (async () => {
      try {
        const api = loadMeetdocApi();
        const q = url.parse(req.url, true).query || {};
        const token = meetdocToken(req, q);
        const kind = q.kind || 'agenda';
        const result = await api.getSignedFileUrl(token, meetdocMeetingMatch[1], kind);
        jsonMeetdoc(res, result.ok ? 200 : 404, result);
      } catch (e) {
        jsonMeetdoc(res, 500, { ok: false, message: e.message });
      }
    })();
    return;
  }

  if (meetdocMeetingMatch && meetdocMeetingMatch[2] === 'approve' && req.method === 'POST') {
    (async () => {
      try {
        const api = loadMeetdocApi();
        const body = (req.rawBody || Buffer.alloc(0)).toString('utf-8');
        const data = JSON.parse(body || '{}');
        const token = meetdocToken(req, data);
        const result = await api.approveMeeting(token, meetdocMeetingMatch[1], data.step);
        jsonMeetdoc(res, result.ok ? 200 : 400, result);
      } catch (e) {
        jsonMeetdoc(res, 500, { ok: false, message: e.message });
      }
    })();
    return;
  }

  if (meetdocMeetingMatch && meetdocMeetingMatch[2] === 'reject' && req.method === 'POST') {
    (async () => {
      try {
        const api = loadMeetdocApi();
        const body = (req.rawBody || Buffer.alloc(0)).toString('utf-8');
        const data = JSON.parse(body || '{}');
        const token = meetdocToken(req, data);
        const result = await api.rejectMeeting(token, meetdocMeetingMatch[1]);
        jsonMeetdoc(res, result.ok ? 200 : 400, result);
      } catch (e) {
        jsonMeetdoc(res, 500, { ok: false, message: e.message });
      }
    })();
    return;
  }

  if (pathname.endsWith('/api/meetdoc/firebase-token') && req.method === 'POST') {
    (async () => {
      try {
        const api = loadMeetdocApi();
        const body = (req.rawBody || Buffer.alloc(0)).toString('utf-8');
        const data = JSON.parse(body || '{}');
        const token = meetdocToken(req, data);
        const result = await api.createFirebaseCustomToken(token);
        jsonMeetdoc(res, result.ok ? 200 : 403, result);
      } catch (e) {
        console.error('meetdoc/firebase-token:', e.message);
        jsonMeetdoc(res, 500, { ok: false, message: e.message });
      }
    })();
    return;
  }

  // API: Installer login — ชื่อผู้ใช้ + รหัส PIN (6 หลัก) เพื่อดึงข้อมูลเครื่องที่กำหนดให้
  if (pathname.endsWith('/api/installer-login') && req.method === 'POST') {
    (async () => {
      try {
        const body = (req.rawBody || Buffer.alloc(0)).toString('utf-8');
        const data = JSON.parse(body);
        let username = (data.username || '').toString().trim();
        const pin = (data.pin || '').toString().trim();
        if (!username || !pin) {
          res.writeHead(400);
          res.end(JSON.stringify({ success: false, error: 'กรุณากรอกชื่อผู้ใช้และรหัส PIN' }));
          return;
        }
        if (pin.length !== 6 || !/^\d{6}$/.test(pin)) {
          res.writeHead(400);
          res.end(JSON.stringify({ success: false, error: 'รหัส PIN ต้องเป็นตัวเลข 6 หลัก' }));
          return;
        }
        // ถ้าชื่อผู้ใช้เป็นตัวเลขล้วน ให้ปัดเป็น 6 หลัก (เช่น 7368 → 007368) เพื่อให้ตรงกับ users ที่ใช้เลขสมาชิก
        if (/^\d+$/.test(username)) username = username.padStart(6, '0').slice(-6);
        let user = null;
        try {
          user = await firebaseQuery('users', 'username', username);
          if (!user && username.length > 0) {
            const all = await firebaseGetCollection('users', { pageSize: 300 });
            const lower = username.toLowerCase();
            const found = (all || []).find(u => u && String(u.username || '').toLowerCase() === lower);
            if (found) user = found;
          }
        } catch (e) {
          const msg = (e && e.message) ? String(e.message) : '';
          if (msg.includes('timed out')) {
            res.writeHead(503);
            res.setHeader('Content-Type', 'application/json; charset=utf-8');
            res.end(JSON.stringify({
              success: false,
              error: 'เซิร์ฟเวอร์เชื่อมต่อฐานข้อมูลไม่ได้ (หมดเวลา) — ตรวจสอบการออกเน็ตของ NAS'
            }));
            return;
          }
        }
        if (!user || !user.fullname) {
          res.writeHead(401);
          res.end(JSON.stringify({ success: false, error: 'ไม่พบชื่อผู้ใช้ในระบบ' }));
          return;
        }
        const userPin = String(user.pin != null ? user.pin : '').trim();
        const pinNorm = pin.trim();
        if (userPin !== pinNorm) {
          res.writeHead(401);
          res.end(JSON.stringify({ success: false, error: 'รหัส PIN ไม่ถูกต้อง' }));
          return;
        }
        const fullname = (user.fullname || '').trim();
        const assignedUserId = user.id || user._firestoreDocId;
        const assignedUsernameNorm = (user.username || '').toString().trim();
        let allPrograms;
        try {
          allPrograms = await firebaseGetCollection('programs', { pageSize: 500 });
        } catch (e) {
          const msg = (e && e.message) ? String(e.message) : '';
          if (msg.includes('timed out')) {
            res.writeHead(503);
            res.setHeader('Content-Type', 'application/json; charset=utf-8');
            res.end(JSON.stringify({
              success: false,
              error: 'เซิร์ฟเวอร์เชื่อมต่อฐานข้อมูลไม่ได้ (หมดเวลา) — ตรวจสอบการออกเน็ตของ NAS'
            }));
            return;
          }
          throw e;
        }
        const computers = (allPrograms || []).filter(p => {
          if ((p.type || '') !== 'computer') return false;
          const assignName = (p.user || (p.userInfo && p.userInfo.fullname) || '').trim();
          const assignId = p.assignedUserId || p.assignedUsername;
          if (assignedUserId && (assignId === assignedUserId || assignId === assignedUsernameNorm)) return true;
          if (fullname && assignName === fullname) return true;
          return false;
        });
        res.writeHead(200);
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.end(JSON.stringify({
          success: true,
          user: { fullname: user.fullname, username: user.username },
          computers
        }));
      } catch (error) {
        console.error('Installer login error:', error.message);
        res.writeHead(500);
        res.end(JSON.stringify({ success: false, error: error.message }));
      }
    })();
    return;
  }

  // API: Installer ส่งข้อมูลเครื่องจากเครื่องนี้ไปบันทึกที่ programs (แสดงที่ Admin #programs)
  if (pathname.endsWith('/api/installer-submit-machine') && req.method === 'POST') {
    (async () => {
      try {
        const body = (req.rawBody || Buffer.alloc(0)).toString('utf-8');
        const data = JSON.parse(body);
        let username = (data.username || '').toString().trim();
        const pin = (data.pin || '').toString().trim();
        const machine = data.machine || {};
        if (!username || !pin) {
          res.writeHead(400);
          res.end(JSON.stringify({ success: false, error: 'กรุณากรอกชื่อผู้ใช้และรหัส PIN' }));
          return;
        }
        if (pin.length !== 6 || !/^\d{6}$/.test(pin)) {
          res.writeHead(400);
          res.end(JSON.stringify({ success: false, error: 'รหัส PIN ต้องเป็นตัวเลข 6 หลัก' }));
          return;
        }
        if (/^\d+$/.test(username)) username = username.padStart(6, '0').slice(-6);
        let user = null;
        try {
          user = await firebaseQuery('users', 'username', username);
          if (!user && username.length > 0) {
            const all = await firebaseGetCollection('users', { pageSize: 300 });
            const lower = username.toLowerCase();
            const found = (all || []).find(u => u && String(u.username || '').toLowerCase() === lower);
            if (found) user = found;
          }
        } catch (e) {}
        if (!user || !user.fullname) {
          res.writeHead(401);
          res.end(JSON.stringify({ success: false, error: 'ไม่พบชื่อผู้ใช้ในระบบ' }));
          return;
        }
        const userPin = String(user.pin != null ? user.pin : '').trim();
        if (userPin !== pin.trim()) {
          res.writeHead(401);
          res.end(JSON.stringify({ success: false, error: 'รหัส PIN ไม่ถูกต้อง' }));
          return;
        }
        const fullname = (user.fullname || '').trim();
        const assignedUserId = user.id || user._firestoreDocId;
        const assignedUsername = (user.username || '').toString().trim();
        const programId = (typeof crypto !== 'undefined' && crypto.randomUUID) ? crypto.randomUUID() : (Date.now().toString(36) + Math.random().toString(36).substring(2, 12));
        const device = machine.device || {};
        const sw = machine.sw || {};
        const net = machine.net || {};
        const hw = machine.hw || {};
        const svc = machine.svc || {};
        const sec = machine.sec || {};
        const userInfo = machine.userInfo || {};
        const obj = {
          id: programId,
          type: 'computer',
          icon: (machine.icon || 'fas fa-desktop').trim(),
          name: (device.computer_name || machine.name || '').trim() || fullname + ' — เครื่องนี้',
          user: fullname,
          assignedUserId: assignedUserId || undefined,
          assignedUsername: assignedUsername || undefined,
          workStatus: 'ใช้งาน',
          userInfo: {
            fullname: (userInfo.fullname || fullname).trim(),
            position: (userInfo.position || user.department || '').trim(),
            contact: (userInfo.contact || user.email || '').trim(),
            assign_date: userInfo.assign_date || '',
            admin: (userInfo.admin || '').trim()
          },
          device: {
            computer_name: (device.computer_name || '').trim(),
            brand_model: (device.brand_model || '').trim(),
            serial: (device.serial || '').trim(),
            asset: (device.asset || '').trim(),
            purchase: device.purchase || '',
            warranty_end: device.warranty_end || '',
            location: (device.location || '').trim()
          },
          sw: {
            os: { name: (sw.os && sw.os.name) || '', version: (sw.os && sw.os.version) || '', license: (sw.os && sw.os.license) || '' },
            mso: { name: (sw.mso && sw.mso.name) || '', version: (sw.mso && sw.mso.version) || '', license: (sw.mso && sw.mso.license) || '' },
            others: Array.isArray(sw.others) ? sw.others : []
          },
          net: {
            ip: (net.ip || '').trim(),
            mask: (net.mask || '').trim(),
            gw: (net.gw || '').trim(),
            dns: (net.dns || '').trim(),
            mac: (net.mac || '').trim(),
            wifi: (net.wifi || '').trim()
          },
          hw: {
            cpu: (hw.cpu || '').trim(),
            ram: (hw.ram || '').trim(),
            storage: (hw.storage || '').trim(),
            gpu: (hw.gpu || '').trim(),
            monitor: (hw.monitor || '').trim(),
            peripherals: (hw.peripherals || '').trim(),
            warranty_item: (hw.warranty_item || '').trim()
          },
          svc: {
            first_install: svc.first_install || '',
            last_update: svc.last_update || '',
            technician: (svc.technician || '').trim(),
            repairs: (svc.repairs || '').trim(),
            issues: (svc.issues || '').trim()
          },
          sec: {
            edr: (sec.edr || '').trim(),
            encrypt: (sec.encrypt || '').trim(),
            role: sec.role || 'User',
            backup: (sec.backup || '').trim()
          },
          details: (machine.details || '').trim(),
          startDate: machine.startDate || ''
        };
        await firebaseSet('programs', programId, obj);
        res.writeHead(200);
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.end(JSON.stringify({ success: true, id: programId, message: 'บันทึกข้อมูลเครื่องเรียบร้อย' }));
      } catch (error) {
        console.error('Installer submit machine error:', error.message);
        res.writeHead(500);
        res.end(JSON.stringify({ success: false, error: error.message }));
      }
    })();
    return;
  }

  // ---------- NKBKCONNEXT License System (Firestore: licenses) ----------
  const LICENSE_COLLECTION = 'licenses';
  const LICENSE_ADMIN_SECRET = process.env.NKBKCONNEXT_LICENSE_ADMIN_SECRET || '';

  function normalizeLicenseKey(key) {
    if (!key || typeof key !== 'string') return '';
    const s = key.toUpperCase().replace(/\s/g, '').replace(/-/g, '-');
    const parts = s.split('-').filter(Boolean);
    if (parts.length !== 4 || parts[0] !== 'NKBK') return '';
    return parts.join('-');
  }

  function generateLicenseKeySegment() {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let s = '';
    for (let i = 0; i < 4; i++) s += chars[Math.floor(Math.random() * chars.length)];
    return s;
  }

  function generateNewLicenseKey() {
    return `NKBK-${generateLicenseKeySegment()}-${generateLicenseKeySegment()}-${generateLicenseKeySegment()}`;
  }

  // POST /api/license/generate — สร้าง License Key (ต้องส่ง admin secret)
  if (pathname.endsWith('/api/license/generate') && req.method === 'POST') {
    (async () => {
      try {
        const body = (req.rawBody || Buffer.alloc(0)).toString('utf-8');
        const data = JSON.parse(body);
        if (LICENSE_ADMIN_SECRET && data.adminSecret !== LICENSE_ADMIN_SECRET) {
          res.writeHead(403);
          res.end(JSON.stringify({ success: false, error: 'Unauthorized' }));
          return;
        }
        const maxDevices = Math.min(10, Math.max(1, parseInt(data.maxDevices, 10) || 1));
        const validDays = Math.min(3650, Math.max(1, parseInt(data.validDays, 10) || 365));
        const key = generateNewLicenseKey();
        const now = new Date();
        const expiresAt = new Date(now.getTime() + validDays * 24 * 60 * 60 * 1000);
        const docId = key;
        const licenseDoc = {
          licenseKey: key,
          status: 'active',
          createdAt: now.toISOString(),
          expiresAt: expiresAt.toISOString(),
          maxDevices,
          devices: []
        };
        await firebaseSet(LICENSE_COLLECTION, docId, licenseDoc);
        res.writeHead(200);
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.end(JSON.stringify({ success: true, licenseKey: key, expiresAt: expiresAt.toISOString(), maxDevices }));
      } catch (error) {
        console.error('License generate error:', error.message);
        res.writeHead(500);
        res.end(JSON.stringify({ success: false, error: error.message }));
      }
    })();
    return;
  }

  // POST /api/license/activate — ลงทะเบียนเครื่องกับ License
  if (pathname.endsWith('/api/license/activate') && req.method === 'POST') {
    (async () => {
      try {
        const body = (req.rawBody || Buffer.alloc(0)).toString('utf-8');
        const data = JSON.parse(body);
        const rawKey = (data.licenseKey || '').toString().trim();
        const key = normalizeLicenseKey(rawKey);
        const deviceId = (data.deviceId || '').toString().trim();
        const deviceName = (data.deviceName || '').toString().trim() || 'Device';
        const fingerprint = (data.fingerprint || '').toString().trim();
        if (!key || !deviceId) {
          res.writeHead(400);
          res.end(JSON.stringify({ success: false, error: 'กรุณากรอก License Key และ Device ID' }));
          return;
        }
        const doc = await firebaseGet(LICENSE_COLLECTION, key);
        if (!doc) {
          res.writeHead(404);
          res.end(JSON.stringify({ success: false, error: 'ไม่พบ License Key นี้' }));
          return;
        }
        const now = new Date();
        const expiresAt = doc.expiresAt ? new Date(doc.expiresAt) : null;
        if (doc.status === 'revoked') {
          res.writeHead(400);
          res.end(JSON.stringify({ success: false, error: 'License ถูกยกเลิกแล้ว' }));
          return;
        }
        if (expiresAt && expiresAt < now) {
          await firebaseSet(LICENSE_COLLECTION, key, { status: 'expired' });
          res.writeHead(400);
          res.end(JSON.stringify({ success: false, error: 'License หมดอายุแล้ว' }));
          return;
        }
        const devices = Array.isArray(doc.devices) ? doc.devices : [];
        const existing = devices.find(d => d.deviceId === deviceId);
        if (existing) {
          res.writeHead(200);
          res.setHeader('Content-Type', 'application/json; charset=utf-8');
          res.end(JSON.stringify({ success: true, message: 'เครื่องนี้ลงทะเบียนแล้ว', expiresAt: doc.expiresAt, maxDevices: doc.maxDevices }));
          return;
        }
        if (devices.length >= (doc.maxDevices || 1)) {
          res.writeHead(400);
          res.end(JSON.stringify({ success: false, error: 'เกินจำนวนเครื่องที่อนุญาตแล้ว' }));
          return;
        }
        devices.push({ deviceId, deviceName, activatedAt: now.toISOString(), fingerprint: fingerprint || '' });
        await firebaseSet(LICENSE_COLLECTION, key, { devices });
        res.writeHead(200);
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.end(JSON.stringify({ success: true, message: 'เปิดใช้งาน License สำเร็จ', expiresAt: doc.expiresAt, maxDevices: doc.maxDevices }));
      } catch (error) {
        console.error('License activate error:', error.message);
        res.writeHead(500);
        res.end(JSON.stringify({ success: false, error: error.message }));
      }
    })();
    return;
  }

  // POST /api/license/validate — ตรวจสอบ License + Device
  if (pathname.endsWith('/api/license/validate') && req.method === 'POST') {
    (async () => {
      try {
        const body = (req.rawBody || Buffer.alloc(0)).toString('utf-8');
        const data = JSON.parse(body);
        const rawKey = (data.licenseKey || '').toString().trim();
        const key = normalizeLicenseKey(rawKey);
        const deviceId = (data.deviceId || '').toString().trim();
        if (!key) {
          res.writeHead(400);
          res.end(JSON.stringify({ valid: false, error: 'กรุณากรอก License Key' }));
          return;
        }
        const doc = await firebaseGet(LICENSE_COLLECTION, key);
        if (!doc) {
          res.writeHead(200);
          res.setHeader('Content-Type', 'application/json; charset=utf-8');
          res.end(JSON.stringify({ valid: false, error: 'ไม่พบ License Key' }));
          return;
        }
        const now = new Date();
        const expiresAt = doc.expiresAt ? new Date(doc.expiresAt) : null;
        if (doc.status === 'revoked') {
          res.writeHead(200);
          res.end(JSON.stringify({ valid: false, error: 'License ถูกยกเลิกแล้ว' }));
          return;
        }
        if (expiresAt && expiresAt < now) {
          await firebaseSet(LICENSE_COLLECTION, key, { status: 'expired' });
          res.writeHead(200);
          res.end(JSON.stringify({ valid: false, error: 'License หมดอายุแล้ว' }));
          return;
        }
        const devices = Array.isArray(doc.devices) ? doc.devices : [];
        const device = deviceId ? devices.find(d => d.deviceId === deviceId) : null;
        const valid = device != null;
        res.writeHead(200);
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.end(JSON.stringify({
          valid,
          status: doc.status,
          expiresAt: doc.expiresAt,
          maxDevices: doc.maxDevices,
          deviceCount: devices.length,
          error: valid ? undefined : (deviceId ? 'เครื่องนี้ยังไม่ได้ลงทะเบียนกับ License นี้' : 'กรุณาส่ง deviceId')
        }));
      } catch (error) {
        console.error('License validate error:', error.message);
        res.writeHead(500);
        res.end(JSON.stringify({ valid: false, error: error.message }));
      }
    })();
    return;
  }

  // POST /api/license/revoke — ยกเลิก License (ต้องส่ง admin secret)
  if (pathname.endsWith('/api/license/revoke') && req.method === 'POST') {
    (async () => {
      try {
        const body = (req.rawBody || Buffer.alloc(0)).toString('utf-8');
        const data = JSON.parse(body);
        if (LICENSE_ADMIN_SECRET && data.adminSecret !== LICENSE_ADMIN_SECRET) {
          res.writeHead(403);
          res.end(JSON.stringify({ success: false, error: 'Unauthorized' }));
          return;
        }
        const rawKey = (data.licenseKey || '').toString().trim();
        const key = normalizeLicenseKey(rawKey);
        if (!key) {
          res.writeHead(400);
          res.end(JSON.stringify({ success: false, error: 'กรุณากรอก License Key' }));
          return;
        }
        const doc = await firebaseGet(LICENSE_COLLECTION, key);
        if (!doc) {
          res.writeHead(404);
          res.end(JSON.stringify({ success: false, error: 'ไม่พบ License Key' }));
          return;
        }
        await firebaseSet(LICENSE_COLLECTION, key, { status: 'revoked' });
        res.writeHead(200);
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.end(JSON.stringify({ success: true, message: 'ยกเลิก License แล้ว' }));
      } catch (error) {
        console.error('License revoke error:', error.message);
        res.writeHead(500);
        res.end(JSON.stringify({ success: false, error: error.message }));
      }
    })();
    return;
  }

  // POST /api/analytics — บันทึกเหตุการณ์ (สำหรับ NKBKCONNEXT)
  if (pathname.endsWith('/api/analytics') && req.method === 'POST') {
    (async () => {
      try {
        const body = (req.rawBody || Buffer.alloc(0)).toString('utf-8');
        const data = JSON.parse(body);
        const event = (data.event || 'unknown').toString().trim();
        const payload = data.payload || {};
        const docId = (typeof crypto !== 'undefined' && crypto.randomUUID) ? crypto.randomUUID() : Date.now() + '-' + Math.random().toString(36).slice(2);
        await firebaseSet('analytics_events', docId, {
          event,
          ...payload,
          timestamp: new Date().toISOString(),
          app: 'NKBKCONNEXT'
        });
        res.writeHead(200);
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.end(JSON.stringify({ success: true }));
      } catch (error) {
        res.writeHead(500);
        res.end(JSON.stringify({ success: false }));
      }
    })();
    return;
  }

  // Helper: fetch one day attendance from ATT2Mobile (Promise)
  function fetchAttendanceOneDay(dateDDMMYYYY) {
    const baseUrl = 'https://a2w.att2mobile.com/rp/CV44elrP';
    const url = dateDDMMYYYY ? `${baseUrl}/${dateDDMMYYYY}/?com=` : baseUrl + '/';
    return new Promise((resolve) => {
      const req = https.get(url, (attRes) => {
        if (attRes.statusCode !== 200) {
          resolve({ date: dateDDMMYYYY, rows: [], error: 'HTTP ' + attRes.statusCode });
          return;
        }
        const chunks = [];
        attRes.on('data', c => chunks.push(c));
        attRes.on('end', () => {
          try {
            const html = Buffer.concat(chunks).toString('utf-8');
            const rows = [];
            const tableMatch = html.match(/<table[^>]*>[\s\S]*?<tbody[^>]*>([\s\S]*?)<\/tbody>/i) || html.match(/<table[^>]*>([\s\S]*?)<\/table>/i);
            const tableBody = tableMatch ? tableMatch[1] : html;
            const trRegex = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
            let tr;
            while ((tr = trRegex.exec(tableBody)) !== null) {
              const cells = [];
              const tdRegex = /<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi;
              let td;
              while ((td = tdRegex.exec(tr[1])) !== null) cells.push(td[1].replace(/<[^>]+>/g, '').trim());
              if (cells.length >= 4) {
                const code = cells[0];
                if (code !== 'รหัส' && /^\d+$/.test(code)) rows.push({ code, name: cells[1] || '', checkIn: cells[2] || '', checkOut: cells[3] || '' });
              }
            }
            if (rows.length === 0) {
              const altMatch = html.match(/\|\s*(\d+)\s*\|\s*([^|]+)\s*\|\s*(\d{1,2}:\d{2})?\s*\|\s*(\d{1,2}:\d{2})?\s*\|/g);
              if (altMatch) altMatch.forEach(line => {
                const m = line.match(/\|\s*(\d+)\s*\|\s*([^|]+)\s*\|\s*(\d{1,2}:\d{2})?\s*\|\s*(\d{1,2}:\d{2})?\s*\|/);
                if (m) rows.push({ code: m[1], name: m[2].trim(), checkIn: m[3] || '', checkOut: m[4] || '' });
              });
            }
            resolve({ date: dateDDMMYYYY, rows });
          } catch (e) {
            resolve({ date: dateDDMMYYYY, rows: [], error: e.message });
          }
        });
      });
      req.setTimeout(12000, () => { req.destroy(); resolve({ date: dateDDMMYYYY, rows: [], error: 'Timeout' }); });
      req.on('error', (e) => resolve({ date: dateDDMMYYYY, rows: [], error: e.message }));
    });
  }

  // API: Attendance range — หลายวัน หรือรายเดือน (from, to เป็น DDMMYYYY หรือ month=YYYYMM)
  const q = parsedUrl.query || {};
  const fromParam = q.from;
  const toParam = q.to;
  const monthParam = q.month;
  if (pathname.endsWith('/api/attendance') && req.method === 'GET' && (fromParam || toParam || monthParam)) {
    const corsHeaders = { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' };
    let dateList = [];
    if (monthParam && /^\d{6}$/.test(monthParam)) {
      const y = parseInt(monthParam.slice(0, 4), 10);
      const m = parseInt(monthParam.slice(4, 6), 10);
      const lastDay = new Date(y, m, 0).getDate();
      for (let day = 1; day <= lastDay; day++) {
        dateList.push(String(day).padStart(2, '0') + String(m).padStart(2, '0') + String(y));
      }
    } else if (fromParam && toParam && /^\d{8}$/.test(fromParam) && /^\d{8}$/.test(toParam)) {
      const fromD = parseInt(fromParam.slice(0, 2), 10), fromM = parseInt(fromParam.slice(2, 4), 10), fromY = parseInt(fromParam.slice(4, 8), 10);
      const toD = parseInt(toParam.slice(0, 2), 10), toM = parseInt(toParam.slice(2, 4), 10), toY = parseInt(toParam.slice(4, 8), 10);
      const start = new Date(fromY, fromM - 1, fromD);
      const end = new Date(toY, toM - 1, toD);
      for (let t = start.getTime(); t <= end.getTime(); t += 86400000) {
        const x = new Date(t);
        dateList.push(String(x.getDate()).padStart(2, '0') + String(x.getMonth() + 1).padStart(2, '0') + String(x.getFullYear()));
      }
    }
    if (dateList.length > 31) dateList = dateList.slice(0, 31);
    if (dateList.length === 0) {
      res.writeHead(400, corsHeaders);
      res.end(JSON.stringify({ success: false, error: 'กรุณาระบุ month=YYYYMM หรือ from&to เป็น DDMMYYYY' }));
      return;
    }
    (async () => {
      const dates = {};
      for (const d of dateList) {
        const one = await fetchAttendanceOneDay(d);
        dates[d] = { rows: one.rows, error: one.error || null };
      }
      res.writeHead(200, corsHeaders);
      res.end(JSON.stringify({ success: true, dates }));
    })().catch(e => {
      res.writeHead(500, corsHeaders);
      res.end(JSON.stringify({ success: false, error: e.message || 'Server error' }));
    });
    return;
  }

  // API: Attendance — ดึงข้อมูลเข้า-ออกงานจาก ATT2Mobile (NKBKCOOP) — วันเดียว
  if (pathname.endsWith('/api/attendance') && req.method === 'GET') {
    const corsHeaders = { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' };
    const dateParam = parsedUrl.query.date || '';
    const today = (() => { const d = new Date(); return String(d.getDate()).padStart(2, '0') + String(d.getMonth() + 1).padStart(2, '0') + String(d.getFullYear()); })();
    const targetDate = dateParam || today;
    fetchAttendanceFromAtt2(targetDate).then(data => {
      if (data.success) {
        res.writeHead(200, corsHeaders);
        res.end(JSON.stringify(data));
      } else {
        res.writeHead(data.code || 502, corsHeaders);
        res.end(JSON.stringify({ success: false, error: data.error || 'ดึงข้อมูลไม่สำเร็จ' }));
      }
    }).catch(e => {
      res.writeHead(502, corsHeaders);
      res.end(JSON.stringify({ success: false, error: (e.message || 'Fetch failed') + '' }));
    });
    return;
  }
  
  // LINE Login Callback
  if (pathname === '/line/callback' || pathname === '/callback') {
    const query = parsedUrl.query;
    const code = query.code;
    const state = query.state;
    const error = query.error;
    
    if (error) {
      res.writeHead(302, { 'Location': '/?error=' + encodeURIComponent(error) });
      res.end();
      return;
    }
    
    if (!code) {
      res.writeHead(400);
      res.end(JSON.stringify({ error: 'No authorization code' }));
      return;
    }
    
    try {
      // Get LINE Login settings from Firebase
      const settings = await firebaseGet('config', 'line_settings');
      const loginChannelId = settings?.loginChannelId;
      const loginChannelSecret = settings?.loginChannelSecret;
      const callbackUrl = settings?.callbackUrl || `https://api-line.nkbkcoop.com/line/callback`;
      
      if (!loginChannelId || !loginChannelSecret) {
        res.writeHead(500);
        res.end(JSON.stringify({ error: 'LINE Login not configured' }));
        return;
      }
      
      // Exchange code for access token
      const tokenData = await getLineLoginToken(code, loginChannelId, loginChannelSecret, callbackUrl);
      
      if (tokenData.error) {
        res.writeHead(400);
        res.end(JSON.stringify({ error: tokenData.error_description || tokenData.error }));
        return;
      }
      
      // Get user profile
      const profile = await getLineLoginProfile(tokenData.access_token);
      
      // Save user to Firebase
      const userData = {
        displayName: profile.displayName || '',
        pictureUrl: profile.pictureUrl || '',
        email: profile.email || '',
        isBlocked: false,
        lastLogin: new Date().toISOString(),
        source: 'line_login'
      };
      await firebaseSet('line_users', profile.userId, userData);
      console.log(`🔐 LINE Login: ${profile.displayName}`);
      
      // Redirect to success page with user info
      const successUrl = settings?.loginSuccessUrl || 'https://nkbkcoop.com/login-success';
      const redirectUrl = `${successUrl}?userId=${profile.userId}&name=${encodeURIComponent(profile.displayName || '')}`;
      
      res.writeHead(302, { 'Location': redirectUrl });
      res.end();
    } catch (error) {
      console.error('LINE Login error:', error.message);
      res.writeHead(500);
      res.end(JSON.stringify({ error: error.message }));
    }
    return;
  }
  
  // GET (health check)
  if (req.method === 'GET') {
    res.writeHead(200);
    res.end(JSON.stringify({
      status: 'ok',
      message: 'LINE Webhook Server Running',
      configured: !!LINE_CONFIG.accessToken,
      autoReplyRules: autoReplyRules.length,
      timestamp: new Date().toISOString()
    }));
    return;
  }
  
  // Only POST for webhook
  if (req.method !== 'POST') {
    res.writeHead(405);
    res.end(JSON.stringify({ error: 'Method Not Allowed' }));
    return;
  }
  
  try {
    const body = (req.rawBody || Buffer.alloc(0)).toString('utf-8');
    if (!body || body === '{}') {
      res.writeHead(200);
      res.end(JSON.stringify({ status: 'ok' }));
      return;
    }

    const data = JSON.parse(body);

    if (!data.events || data.events.length === 0) {
      res.writeHead(200);
      res.end(JSON.stringify({ status: 'ok' }));
      return;
    }

    const signature = req.headers['x-line-signature'] || '';
    if (LINE_CONFIG.channelSecret && !verifySignature(body, signature)) {
      console.log('❌ Invalid signature');
      res.writeHead(403);
      res.end(JSON.stringify({ error: 'Invalid signature' }));
      return;
    }

    console.log(`\n📬 Received ${data.events.length} event(s)`);
    for (const event of data.events) {
      await handleEvent(event);
    }

    res.writeHead(200);
    res.end(JSON.stringify({ status: 'ok' }));
  } catch (error) {
    console.error('❌ Error:', error.message);
    res.writeHead(500);
    res.end(JSON.stringify({ error: error.message }));
  }
});

// =====================================================
// Start Server
// =====================================================

// จับ uncaught exception & unhandled rejection ไม่ให้ process หลุด
process.on('uncaughtException', (err) => {
  console.error('🔴 Uncaught Exception:', err.message);
  console.error(err.stack);
});
process.on('unhandledRejection', (reason) => {
  console.error('🔴 Unhandled Rejection:', reason);
});

// จับ EADDRINUSE — ถ้าพอร์ตถูกใช้ ลองปิด process เก่าแล้วรันใหม่
server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`❌ Port ${PORT} is already in use. Retrying in 3 seconds...`);
    setTimeout(() => {
      server.close();
      server.listen(PORT, '0.0.0.0');
    }, 3000);
  } else {
    console.error('❌ Server error:', err.message);
  }
});

let _bootstrapPromise = null;

async function bootstrapLineWebhook() {
  await loadLineConfig();
  await loadAutoReplyRules();
}

function ensureBootstrapped() {
  if (!_bootstrapPromise) {
    _bootstrapPromise = bootstrapLineWebhook().catch((e) => {
      _bootstrapPromise = null;
      throw e;
    });
  }
  return _bootstrapPromise;
}

async function start() {
  console.log(`
╔═══════════════════════════════════════════════════╗
║     LINE Webhook Server for Synology NAS          ║
╚═══════════════════════════════════════════════════╝
  `);

  await ensureBootstrapped();

  if (IS_SERVERLESS) {
    console.log('[line-webhook] serverless mode — HTTP handler only (no listen)');
    return;
  }

  server.listen(PORT, '0.0.0.0', () => {
    console.log(`
✅ Server started on port ${PORT}
📌 Build: 2025-02-ai-context (users pageSize+manager filter)
📡 Webhook URL: https://api-line.nkbkcoop.com/line/webhook

💡 ตั้งค่า LINE ได้ที่: Admin Panel → LINE → ตั้งค่า LINE
   (ไม่ต้องแก้ไขไฟล์ server.js อีกแล้ว!)
    `);
  });
}

function drainPendingImageJobs() {
  try {
    const aiChat = require('./ai-chat.js');
    return aiChat.drainPendingImageJobs ? aiChat.drainPendingImageJobs() : Promise.resolve();
  } catch (_) {
    return Promise.resolve();
  }
}

module.exports = {
  server,
  ensureBootstrapped,
  bufferRequestBody,
  drainPendingImageJobs,
  loadLineConfig,
  loadAutoReplyRules,
  runAttendanceNotify,
  runAttendanceScanNotifyQueue,
  runAttendanceAutoFetchServer,
  pushMessage
};

if (!IS_SERVERLESS) {
  start();
} else {
  ensureBootstrapped().catch((e) => console.error('[line-webhook] bootstrap failed:', e.message));
}
