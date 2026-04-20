/**
 * NKBK Monitor API — API ล็อกอินแอป NKBKConnext (Monitor) เท่านั้น
 * โปรเจกต์ it (ระบบโปรแกรม Monitor) — ใช้ Firestore เดียวกับระบบ ไม่ต้องรัน line-webhook
 * Deploy แยกได้ (Plesk, Cloud Run, VPS ฯลฯ)
 * สหกรณ์ออมทรัพย์สาธารณสุขจังหวัดหนองคาย จำกัด
 *
 * ค่าตัวแปรยาว ๆ ใส่ในไฟล์ .env ข้าง server.js แล้วอัปโหลดขึ้น server (หลบข้อจำกัดตัวอักษรใน Plesk)
 */

const path = require('path');
const fsSync = require('fs');

/** Plesk/Passenger บางเคส cwd ไม่ใช่โฟลเดอร์ server.js — ลองหลาย path */
function loadMonitorApiDotenv() {
  const candidates = [
    process.env.DOTENV_CONFIG_PATH && String(process.env.DOTENV_CONFIG_PATH).trim(),
    path.join(__dirname, '.env'),
    path.join(process.cwd(), '.env'),
    path.join(__dirname, '..', '.env')
  ].filter(Boolean);
  const tried = [];
  for (const p of candidates) {
    try {
      if (!p || !fsSync.existsSync(p)) continue;
      tried.push(p);
      require('dotenv').config({ path: p, override: true });
    } catch (e) {
      console.warn('[Monitor API] dotenv', p, e.message);
    }
  }
  const id = (process.env.LINE_LOGIN_CHANNEL_ID || '').trim();
  const sec = (process.env.LINE_LOGIN_CHANNEL_SECRET || '').trim();
  if (!id || !sec) {
    console.warn(
      '[Monitor API] LINE_LOGIN_CHANNEL_ID/SECRET ยังไม่มีใน process.env หลังโหลด .env — ตรวจว่าไฟล์ .env อยู่ข้าง server.js บน server หรือใส่ตัวแปรใน Plesk (Node) แล้วรีสตาร์ทแอป',
      tried.length ? '(โหลดจาก: ' + tried.join(' | ') + ')' : '(ไม่พบไฟล์ .env จาก path ที่ลอง)'
    );
  } else {
    console.log('[Monitor API] LINE Login: พบ channel id/secret ใน environment แล้ว');
  }
}
loadMonitorApiDotenv();

const express = require('express');
const https = require('https');
const crypto = require('crypto');

const app = express();
app.use(express.json({ limit: '2mb' }));

/**
 * Plesk มักส่ง path เต็ม เช่น /monitor-api/workstations.html เข้า Node
 * แต่ route ใน Express เป็น /workstations.html — ต้องตัด prefix
 *
 * 1) ตั้ง MONITOR_API_BASE_PATH=/monitor-api ใน .env (ชัดเจนที่สุด)
 * 2) ถ้าไม่ตั้ง แต่ path ขึ้นต้นด้วย /monitor-api/ จะตัดให้อัตโนมัติ (ปิดด้วย MONITOR_API_NO_AUTO_STRIP=1)
 */
function normalizeMonitorApiBasePath(raw) {
  if (raw == null) return '';
  let s = String(raw).trim();
  if (!s || s === '/') return '';
  if (!s.startsWith('/')) s = '/' + s;
  return s.replace(/\/+$/, '');
}

const MONITOR_API_BASE_PATH = normalizeMonitorApiBasePath(process.env.MONITOR_API_BASE_PATH || '');
const MONITOR_API_NO_AUTO_STRIP = /^1|true|yes$/i.test(String(process.env.MONITOR_API_NO_AUTO_STRIP || '').trim());

const DEFAULT_PLESK_PREFIX = '/monitor-api';

/** เมื่อไม่ได้ตั้ง MONITOR_API_BASE_PATH ใน .env — อ่านจาก URL จริง (กัน LINE redirect_uri ไม่ตรงกับที่ลงทะเบียน) */
function inferMonitorApiBasePathFromReq(req) {
  if (!req) return '';
  try {
    const full = String(req.originalUrl || req.url || '').split('?')[0];
    if (full === DEFAULT_PLESK_PREFIX || full.startsWith(DEFAULT_PLESK_PREFIX + '/')) {
      return DEFAULT_PLESK_PREFIX;
    }
  } catch (_) {}
  return '';
}

function stripMonitorApiBasePath(req, res, next) {
  const full = req.originalUrl || req.url || '';
  const q = full.indexOf('?');
  const pathOnly = q >= 0 ? full.slice(0, q) : full;

  let base = MONITOR_API_BASE_PATH;
  if (!base && !MONITOR_API_NO_AUTO_STRIP) {
    if (pathOnly === DEFAULT_PLESK_PREFIX || pathOnly.startsWith(DEFAULT_PLESK_PREFIX + '/')) {
      base = DEFAULT_PLESK_PREFIX;
    }
  }
  if (!base) return next();

  if (pathOnly === base || pathOnly.startsWith(base + '/')) {
    const rest = pathOnly.slice(base.length) || '/';
    req.url = q >= 0 ? rest + full.slice(q) : rest;
  }
  next();
}

app.use(stripMonitorApiBasePath);

const PORT = Number(process.env.PORT) || 3002;

/** แอป Monitor POST สเปกมาที่นี่ — ต้องตรงกับ X-Monitor-System-Secret */
const MONITOR_SYSTEM_UPLOAD_SECRET = (process.env.MONITOR_SYSTEM_UPLOAD_SECRET || '').trim();
/** เปิดหน้าเว็บ / API ดูรายการเครื่อง — ส่งเป็น ?key= หรือ header */
const MONITOR_SYSTEM_PUBLIC_READ_KEY = (process.env.MONITOR_SYSTEM_PUBLIC_READ_KEY || '').trim();

/** hostname (lower) -> { updatedAt, snapshot } */
const WORKSTATION_SNAPSHOTS = new Map();
const SNAPSHOT_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/** บันทึกผลล่าสุดของการซิงก์ programs → Firestore (สำหรับ GET /api/monitor-programs-sync-status) */
let _lastProgramsSyncAttempt = null;

// Firestore — ใช้โปรเจกต์เดียวกับระบบ (ตั้งจาก env ได้)
const FIREBASE_CONFIG = {
  projectId: process.env.FIREBASE_PROJECT_ID || 'admin-panel-nkbkcoop-cbf10',
  apiKey: process.env.FIREBASE_API_KEY || 'AIzaSyBEUdu_TdTfRvpBpVzdVoHqfQAtrIXAAAw'
};

const FIREBASE_HTTP_TIMEOUT_MS = 18000;

const MONITOR_SESSIONS = new Map();

function getMonitorSessionsFilePath() {
  return process.env.MONITOR_SESSIONS_PATH || path.join(process.cwd(), 'monitor-sessions.json');
}
function loadMonitorSessionsFromDisk() {
  try {
    const p = getMonitorSessionsFilePath();
    if (!fsSync.existsSync(p)) return;
    const raw = fsSync.readFileSync(p, 'utf8');
    const parsed = JSON.parse(raw);
    const tokens = parsed && parsed.tokens && typeof parsed.tokens === 'object' ? parsed.tokens : null;
    if (!tokens) return;
    let n = 0;
    for (const [token, sess] of Object.entries(tokens)) {
      if (!token || typeof token !== 'string' || token.length < 16) continue;
      if (!sess || typeof sess !== 'object' || !sess.username) continue;
      MONITOR_SESSIONS.set(token, {
        username: String(sess.username).trim(),
        createdAt: typeof sess.createdAt === 'number' ? sess.createdAt : Date.now(),
        fullname: sess.fullname != null ? String(sess.fullname).trim() : '',
        email: sess.email != null ? String(sess.email).trim() : '',
        group: sess.group != null ? String(sess.group).trim() : '',
        role: sess.role != null ? String(sess.role).trim() : ''
      });
      n++;
    }
    if (n > 0) console.log('[Monitor API] Loaded persisted sessions:', n);
  } catch (e) {
    console.warn('[Monitor API] load monitor-sessions:', e.message);
  }
}
let _monitorSessionsPersistTimer = null;
function persistMonitorSessionsToDisk() {
  if (_monitorSessionsPersistTimer) clearTimeout(_monitorSessionsPersistTimer);
  _monitorSessionsPersistTimer = setTimeout(() => {
    _monitorSessionsPersistTimer = null;
    try {
      const p = getMonitorSessionsFilePath();
      const dir = path.dirname(p);
      if (!fsSync.existsSync(dir)) fsSync.mkdirSync(dir, { recursive: true });
      const tokens = {};
      MONITOR_SESSIONS.forEach((sess, token) => {
        tokens[token] = {
          username: sess.username,
          createdAt: sess.createdAt || Date.now(),
          fullname: sess.fullname || '',
          email: sess.email || '',
          group: sess.group || '',
          role: sess.role || ''
        };
      });
      fsSync.writeFileSync(p, JSON.stringify({ version: 1, tokens }, null, 0), 'utf8');
    } catch (e) {
      console.warn('[Monitor API] persist monitor-sessions:', e.message);
    }
  }, 80);
}
function monitorSessionsSet(token, sessionObj) {
  MONITOR_SESSIONS.set(token, sessionObj);
  persistMonitorSessionsToDisk();
}
function monitorSessionsDelete(token) {
  if (!token) return;
  MONITOR_SESSIONS.delete(token);
  persistMonitorSessionsToDisk();
}
loadMonitorSessionsFromDisk();

// =====================================================
// Firestore helpers (มี timeout ไม่ค้าง)
// =====================================================
function fromFirestoreValue(value) {
  if (!value) return null;
  if (value.nullValue !== undefined) return null;
  if (value.stringValue !== undefined) return value.stringValue;
  if (value.booleanValue !== undefined) return value.booleanValue;
  if (value.integerValue !== undefined) return parseInt(value.integerValue, 10);
  if (value.doubleValue !== undefined) return parseFloat(value.doubleValue);
  if (value.timestampValue !== undefined) return value.timestampValue;
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

/** runQuery หลายเอกสาร (จับคู่ programs ตามชื่อเครื่อง) */
function firebaseQueryAll(collection, field, value, limit = 8) {
  const lim = Math.min(24, Math.max(1, parseInt(limit, 10) || 8));
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
        limit: lim
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
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => {
        try {
          const responseBody = Buffer.concat(chunks).toString('utf-8');
          const results = JSON.parse(responseBody);
          const items = [];
          if (Array.isArray(results)) {
            for (const row of results) {
              if (!row || !row.document) continue;
              const doc = row.document;
              const docId = doc.name.split('/').pop();
              const item = { id: docId };
              if (doc.fields) {
                for (const [key, val] of Object.entries(doc.fields)) {
                  item[key] = fromFirestoreValue(val);
                }
              }
              items.push(item);
            }
          }
          finish(null, items);
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

function firebaseGet(collection, docId) {
  const enc = encodeURIComponent(String(docId));
  const p = `/v1/projects/${FIREBASE_CONFIG.projectId}/databases/(default)/documents/${collection}/${enc}?key=${FIREBASE_CONFIG.apiKey}`;
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
    const options = { hostname: 'firestore.googleapis.com', port: 443, path: p, method: 'GET' };
    httpReq = https.request(options, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => {
        try {
          const raw = Buffer.concat(chunks).toString('utf-8');
          if (res.statusCode === 404) return finish(null, null);
          const parsed = JSON.parse(raw);
          if (parsed.error) return finish(new Error(parsed.error.message || 'Firestore error'));
          const item = {};
          if (parsed.fields) {
            for (const [key, val] of Object.entries(parsed.fields)) {
              item[key] = fromFirestoreValue(val);
            }
          }
          finish(null, item);
        } catch (e) {
          finish(e);
        }
      });
    });
    httpReq.on('error', (e) => finish(e));
    httpReq.end();
  });
}

function toFirestoreValue(value) {
  if (value === null || value === undefined) return { nullValue: null };
  if (value instanceof Date && !Number.isNaN(value.getTime())) return { timestampValue: value.toISOString() };
  if (typeof value === 'string') return { stringValue: value };
  if (typeof value === 'boolean') return { booleanValue: value };
  if (typeof value === 'number') return Number.isInteger(value) ? { integerValue: String(value) } : { doubleValue: value };
  if (Array.isArray(value)) {
    return { arrayValue: { values: value.map((v) => toFirestoreValue(v)) } };
  }
  if (typeof value === 'object') {
    const mapFields = {};
    for (const [k, v] of Object.entries(value)) mapFields[k] = toFirestoreValue(v);
    return { mapValue: { fields: mapFields } };
  }
  return { nullValue: null };
}

async function firebaseSet(collection, docId, data) {
  let existing = {};
  try {
    const doc = await firebaseGet(collection, docId);
    if (doc) existing = doc;
  } catch (_) {}
  const merged = { ...existing, ...data };
  delete merged.id;
  const fields = {};
  for (const [key, value] of Object.entries(merged)) {
    fields[key] = toFirestoreValue(value);
  }
  const path = `/v1/projects/${FIREBASE_CONFIG.projectId}/databases/(default)/documents/${collection}/${encodeURIComponent(String(docId))}?key=${FIREBASE_CONFIG.apiKey}`;
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
      path,
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body)
      }
    };
    httpReq = https.request(options, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => {
        try {
          const responseBody = Buffer.concat(chunks).toString('utf-8');
          const parsed = JSON.parse(responseBody);
          if (parsed.error) {
            finish(new Error(parsed.error.message || JSON.stringify(parsed.error)));
          } else {
            finish(null, parsed);
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

/**
 * Admin SDK — เขียน collection programs ได้แม้ rules เป็น allow write: if isAdmin()
 * (REST + API key ไม่มี request.auth → เขียน programs ไม่ผ่าน)
 */
let _monitorAdminFirestore = null;
let _monitorAdminInitAttempted = false;

function normalizeServiceAccountEnv(raw) {
  if (!raw || typeof raw !== 'string') return '';
  return raw
    .replace(/^\uFEFF/, '')
    .trim()
    .replace(/^["']|["']$/g, '')
    .trim();
}

/**
 * หาไฟล์ service account จริง — รองรับ Plesk (path ใน .env ไม่ตรง disk, หรือใช้แค่ชื่อไฟล์)
 * @returns {{ path: string, source: string }}
 */
function resolveFirebaseServiceAccountPath() {
  const raw = normalizeServiceAccountEnv(
    process.env.FIREBASE_SERVICE_ACCOUNT_PATH || process.env.GOOGLE_APPLICATION_CREDENTIALS || ''
  );
  if (raw) {
    if (fsSync.existsSync(raw)) return { path: raw, source: 'env_absolute' };
    const joined = path.isAbsolute(raw) ? raw : path.join(__dirname, raw);
    if (joined !== raw && fsSync.existsSync(joined)) return { path: joined, source: 'env_relative_to_app' };
    const base = path.basename(raw.split('\\').join('/'));
    const beside = path.join(__dirname, base);
    if (base && fsSync.existsSync(beside)) return { path: beside, source: 'env_filename_beside_server_js' };
  }
  try {
    const files = fsSync.readdirSync(__dirname);
    const want = raw ? path.basename(raw.split('\\').join('/')) : '';
    if (want && files.includes(want) && fsSync.existsSync(path.join(__dirname, want))) {
      return { path: path.join(__dirname, want), source: 'dirname_match_env_basename' };
    }
    const hit = files.find((f) => /firebase-adminsdk-.+\.json$/i.test(f));
    if (hit) return { path: path.join(__dirname, hit), source: 'auto_firebase_adminsdk_json' };
  } catch (_) {}
  return { path: raw || '', source: raw ? 'env_path_missing_on_disk' : 'unset' };
}

function getMonitorAdminFirestore() {
  if (_monitorAdminInitAttempted) return _monitorAdminFirestore;
  _monitorAdminInitAttempted = true;
  const { path: p, source } = resolveFirebaseServiceAccountPath();
  if (!p || !fsSync.existsSync(p)) {
    console.warn('[Monitor API] Service account ไม่พบไฟล์ —', source, p ? `"${p}"` : '(ว่าง)');
    return null;
  }
  try {
    const sa = JSON.parse(fsSync.readFileSync(p, 'utf8'));
    if (!sa || typeof sa.private_key !== 'string') return null;
    let admin;
    try {
      admin = require('firebase-admin');
    } catch (reqErr) {
      console.warn('[Monitor API] ติดตั้ง firebase-admin: npm install firebase-admin');
      return null;
    }
    if (!admin.apps.length) {
      admin.initializeApp({ credential: admin.credential.cert(sa) });
    }
    _monitorAdminFirestore = admin.firestore();
    console.log('[Monitor API] firebase-admin พร้อม —', p, '(' + source + ')');
    return _monitorAdminFirestore;
  } catch (e) {
    console.warn('[Monitor API] firebase-admin ไม่พร้อม:', e.message);
    return null;
  }
}

let _programsSyncRestWarned = false;

/** เขียนเอกสาร programs: ใช้ Admin SDK ถ้ามี path service account มิฉะนั้น REST (อาจโดน rules บล็อก) */
async function writeProgramsDocumentAdminOrRest(docId, payload) {
  const data = { ...payload };
  delete data.id;
  const adb = getMonitorAdminFirestore();
  if (adb) {
    const admin = require('firebase-admin');
    data.lastLiveSyncAt = admin.firestore.FieldValue.serverTimestamp();
    await adb.collection('programs').doc(String(docId)).set(data, { merge: true });
    return 'admin';
  }
  data.lastLiveSyncAt = new Date();
  await firebaseSet('programs', docId, data);
  return 'rest';
}

function getBangkokNowMonitor() {
  const now = new Date();
  const utc = now.getTime() + now.getTimezoneOffset() * 60000;
  return new Date(utc + 420 * 60000);
}

function getBangkokDateIso() {
  const b = getBangkokNowMonitor();
  const y = b.getFullYear();
  const m = b.getMonth() + 1;
  const d = b.getDate();
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

/** คีย์เอกสาร attendance_log = DDMMYYYY (เช่น 23032026) — ตรงกับ line-webhook */
function getBangkokAttendanceLogDocId() {
  const b = getBangkokNowMonitor();
  return String(b.getDate()).padStart(2, '0') + String(b.getMonth() + 1).padStart(2, '0') + String(b.getFullYear());
}

function getBangkokDateId() {
  return getBangkokDateIso();
}

function calcTenureText(startDateStr) {
  if (!startDateStr) return '';
  const start = new Date(startDateStr);
  if (Number.isNaN(start.getTime())) return '';
  const now = new Date();
  let years = now.getFullYear() - start.getFullYear();
  let months = now.getMonth() - start.getMonth();
  let days = now.getDate() - start.getDate();
  if (days < 0) {
    months -= 1;
    const prevMonth = new Date(now.getFullYear(), now.getMonth(), 0);
    days += prevMonth.getDate();
  }
  if (months < 0) {
    years -= 1;
    months += 12;
  }
  let txt = '';
  if (years > 0) txt += `${years} ปี `;
  if (months > 0) txt += `${months} เดือน `;
  if (days >= 0) txt += `${days} วัน`;
  return txt.trim();
}

function normName(s) {
  return String(s || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '');
}

function normStaffNameForMatch(s) {
  if (!s || typeof s !== 'string') return '';
  let t = s.trim().replace(/\s+/g, ' ');
  const prefixes = [/^นาง\s+/i, /^นาย\s+/i, /^น\.ส\.\s*/i, /^นส\.\s*/i, /^ด\.ช\.\s*/i, /^ด\.ญ\.\s*/i, /^ว่าที่\s*ร\.ต\.\s*(หญิง\s*)?/i, /^ร\.ต\.\s*/i, /^พล\.ต\.\s*/i];
  for (const p of prefixes) t = t.replace(p, '');
  return t.trim();
}

function codesMatch(a, b) {
  const sa = String(a || '').trim();
  const sb = String(b || '').trim();
  if (!sa || !sb) return false;
  const na = sa.replace(/^0+/, '') || '0';
  const nb = sb.replace(/^0+/, '') || '0';
  return na === nb;
}

function timeStrToMinutesApi(s) {
  if (!s || typeof s !== 'string') return NaN;
  const t = s.trim().replace('.', ':');
  const m = t.match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return NaN;
  const h = parseInt(m[1], 10);
  const mn = parseInt(m[2], 10);
  if (h < 0 || h > 23 || mn < 0 || mn > 59) return NaN;
  return h * 60 + mn;
}

function computeLateInfoApi(checkInStr, workStartStr, graceMinRaw) {
  const graceMin = Math.max(0, Math.min(60, Number(graceMinRaw) || 15));
  const startStr = String(workStartStr || '08:30')
    .trim()
    .replace('.', ':');
  if (!checkInStr || !String(checkInStr).trim()) {
    return { show: false, text: '', level: null };
  }
  const startMin = timeStrToMinutesApi(startStr);
  const inMin = timeStrToMinutesApi(String(checkInStr).trim());
  if (Number.isNaN(startMin) || Number.isNaN(inMin)) {
    return { show: false, text: '', level: null };
  }
  const lateMin = inMin - startMin;
  if (lateMin <= 0) return { show: false, text: '', level: null };
  const text = `มาสาย ${lateMin} นาที`;
  if (lateMin <= graceMin) return { show: true, text, level: 'within' };
  return { show: true, text, level: 'over' };
}

async function getOrgAttendanceSettingsApi() {
  const defaults = { workStart: '08:30', graceMinutes: 15 };
  try {
    const doc = await firebaseGet('config', 'org');
    if (!doc) return defaults;
    const ws =
      doc.attendanceWorkStart && String(doc.attendanceWorkStart).trim()
        ? String(doc.attendanceWorkStart).trim().replace('.', ':')
        : defaults.workStart;
    const g = doc.attendanceGraceMinutes;
    const grace =
      g !== undefined && g !== null && g !== '' && !Number.isNaN(Number(g))
        ? Math.max(0, Math.min(60, Number(g)))
        : defaults.graceMinutes;
    return { workStart: ws, graceMinutes: grace };
  } catch (_) {
    return defaults;
  }
}

function findAttendanceRowForMonitor(rows, user) {
  if (!rows || !Array.isArray(rows) || !user) return null;
  const code = String(
    user.workCode != null ? user.workCode
      : user.employeeCode != null ? user.employeeCode
      : user.username != null ? user.username
      : user.code != null ? user.code
      : user.id != null ? user.id
      : ''
  ).trim();
  const name = String(user.fullname || user.nameTH || user.displayName || user.name || '').trim();
  const normN = normStaffNameForMatch(name);
  for (const r of rows) {
    if (!r) continue;
    const rc = (r.code != null ? r.code : '').toString().trim();
    if (code && rc && codesMatch(rc, code)) return r;
    const rn = (r.name || '').toString().trim();
    const normR = normStaffNameForMatch(rn);
    if (normN && normR && normN === normR) return r;
    if (normN && normR && normN.length >= 3 && (normR.indexOf(normN) >= 0 || normN.indexOf(normR) >= 0)) return r;
  }
  return null;
}

/** หา user document (users) ตาม session username — logic เดียวกับ monitor-login */
async function findUserForMonitor(sessionName) {
  if (!sessionName || !String(sessionName).trim()) return null;
  let u = String(sessionName).trim();
  if (/^\d+$/.test(u)) u = u.padStart(6, '0').slice(-6);
  let user = await firebaseQuery('users', 'username', u);
  if (!user && sessionName.length > 0) {
    const all = await firebaseGetCollection('users', { pageSize: 300 });
    const lower = String(sessionName).toLowerCase();
    user = (all || []).find((x) => x && String(x.username || '').toLowerCase() === lower);
  }
  return user || null;
}

function buildWorkFromUser(user) {
  if (!user) {
    return {
      position: '',
      department: '',
      job: '',
      unit: '',
      serviceCounter: '',
      employmentStart: '',
      tenureText: ''
    };
  }
  const employmentStart = user.employmentStart != null ? String(user.employmentStart).trim() : '';
  return {
    position: String(user.position || user.jobPosition || '').trim(),
    department: String(user.department || user.dept || '').trim(),
    job: String(user.job || user.workType || '').trim(),
    unit: String(user.unit || '').trim(),
    serviceCounter: user.serviceCounter != null && user.serviceCounter !== '' ? String(user.serviceCounter) : '',
    employmentStart,
    tenureText: calcTenureText(employmentStart)
  };
}

async function buildTodayAttendance(user) {
  const dateIso = getBangkokDateIso();
  const docIdPrimary = getBangkokAttendanceLogDocId();
  const org = await getOrgAttendanceSettingsApi();
  try {
    let day = await firebaseGet('attendance_log', docIdPrimary);
    if (day == null) {
      try {
        day = await firebaseGet('attendance_log', dateIso);
      } catch (_) {
        day = null;
      }
    }
    const rows = Array.isArray(day && day.rows) ? day.rows : [];
    const match = findAttendanceRowForMonitor(rows, user);
    if (!match) {
      return {
        date: dateIso,
        checkIn: '—',
        checkOut: '—',
        statusText: 'ยังไม่มีข้อมูลสแกนวันนี้',
        lateText: '',
        lateLevel: null
      };
    }
    const checkIn = (match.checkIn != null ? match.checkIn : match.check_in != null ? match.check_in : '')
      .toString()
      .trim();
    const checkOut = (match.checkOut != null ? match.checkOut : match.check_out != null ? match.check_out : '')
      .toString()
      .trim();
    const late = computeLateInfoApi(checkIn, org.workStart, org.graceMinutes);
    return {
      date: dateIso,
      checkIn: checkIn || '—',
      checkOut: checkOut || '—',
      statusText: '',
      lateText: late.show ? late.text : '',
      lateLevel: late.show ? late.level : null
    };
  } catch (e) {
    return {
      date: dateIso,
      checkIn: '—',
      checkOut: '—',
      statusText: 'โหลดข้อมูลไม่สำเร็จ',
      lateText: '',
      lateLevel: null
    };
  }
}

let _thaiPublicHolidaysCacheApi = null;
function getThaiPublicHolidaysListApi() {
  if (_thaiPublicHolidaysCacheApi !== null) return _thaiPublicHolidaysCacheApi;
  const candidates = [
    path.join(__dirname, '..', 'thai-public-holidays.json'),
    path.join(__dirname, 'thai-public-holidays.json')
  ];
  for (const p of candidates) {
    try {
      const raw = fsSync.readFileSync(p, 'utf8');
      const j = JSON.parse(raw);
      if (Array.isArray(j)) {
        _thaiPublicHolidaysCacheApi = j;
        return j;
      }
    } catch (_) {}
  }
  _thaiPublicHolidaysCacheApi = [];
  return _thaiPublicHolidaysCacheApi;
}
function mergeThaiPublicHolidaysIntoHolidayMapApi(map, ym, hiddenDates) {
  const hidden = hiddenDates || new Set();
  for (const h of getThaiPublicHolidaysListApi()) {
    const dt = (h && h.date ? h.date : '').toString().trim();
    if (!dt || dt.slice(0, 7) !== ym) continue;
    if (hidden.has(dt)) continue;
    if (map.has(dt)) continue;
    map.set(dt, (h.name || 'วันหยุดสหกรณ์').toString().trim());
  }
}

async function loadCoopHolidayMapForMonthApi(year, month) {
  const map = new Map();
  const ym = `${year}-${String(month).padStart(2, '0')}`;
  const hiddenDates = new Set();
  try {
    const list = await firebaseGetCollection('holidays', { pageSize: 500 });
    for (const h of list || []) {
      const dt = (h.date || '').toString().trim();
      if (!dt) continue;
      if (h.hidden === true) {
        hiddenDates.add(dt);
        continue;
      }
      if (dt.slice(0, 7) !== ym) continue;
      map.set(dt, (h.nameTH || h.name || 'วันหยุดสหกรณ์').toString().trim());
    }
  } catch (_) {}
  mergeThaiPublicHolidaysIntoHolidayMapApi(map, ym, hiddenDates);
  return map;
}

function classifyMonitorDayKindApi(dateIso, holidayMap) {
  const parts = dateIso.split('-').map((n) => parseInt(n, 10));
  if (parts.length !== 3 || parts.some((x) => Number.isNaN(x))) return { dayKind: 'work', dayLabel: '' };
  const d = new Date(parts[0], parts[1] - 1, parts[2]);
  const dow = d.getDay();
  if (holidayMap.has(dateIso)) {
    return { dayKind: 'holiday', dayLabel: holidayMap.get(dateIso) };
  }
  if (dow === 0 || dow === 6) {
    return { dayKind: 'weekend', dayLabel: 'หยุด เสาร์-อาทิตย์' };
  }
  return { dayKind: 'work', dayLabel: '' };
}

async function buildAttendanceMonthApi(user, year, month) {
  const org = await getOrgAttendanceSettingsApi();
  const holidayMap = await loadCoopHolidayMapForMonthApi(year, month);
  const lastDay = new Date(year, month, 0).getDate();
  const days = [];
  for (let d = 1; d <= lastDay; d++) {
    const dateIso = `${year}-${String(month).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    const docId = String(d).padStart(2, '0') + String(month).padStart(2, '0') + String(year);
    const cls = classifyMonitorDayKindApi(dateIso, holidayMap);
    try {
      let day = await firebaseGet('attendance_log', docId);
      if (day == null) day = await firebaseGet('attendance_log', dateIso);
      const rowList = Array.isArray(day && day.rows) ? day.rows : [];
      const match = findAttendanceRowForMonitor(rowList, user);
      if (!match) {
        days.push({
          date: dateIso,
          checkIn: '',
          checkOut: '',
          lateText: '',
          lateLevel: null,
          hasRecord: false,
          dayKind: cls.dayKind,
          dayLabel: cls.dayLabel
        });
        continue;
      }
      const checkIn = (match.checkIn != null ? match.checkIn : match.check_in != null ? match.check_in : '')
        .toString()
        .trim();
      const checkOut = (match.checkOut != null ? match.checkOut : match.check_out != null ? match.check_out : '')
        .toString()
        .trim();
      const late = computeLateInfoApi(checkIn, org.workStart, org.graceMinutes);
      days.push({
        date: dateIso,
        checkIn: checkIn || '',
        checkOut: checkOut || '',
        lateText: late.show ? late.text : '',
        lateLevel: late.show ? late.level : null,
        hasRecord: !!(checkIn || checkOut),
        dayKind: cls.dayKind,
        dayLabel: cls.dayLabel
      });
    } catch (_) {
      days.push({
        date: dateIso,
        checkIn: '',
        checkOut: '',
        lateText: '',
        lateLevel: null,
        hasRecord: false,
        dayKind: cls.dayKind,
        dayLabel: cls.dayLabel
      });
    }
  }
  return { year, month, days };
}

// =====================================================
// ซิงก์ snapshot → Firestore programs (แอดมิน #programs) — ไม่ต้องมี service account บน PC ลูกข่าย
// =====================================================
const _PROGRAM_DOC_UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function slugifyWorkstationProgramDocId(hostname) {
  const h = String(hostname || 'pc').trim() || 'pc';
  const s = h.replace(/[^a-zA-Z0-9._-]+/g, '_').replace(/^[._]+|[._]+$/g, '').slice(0, 120);
  return 'ws_' + (s || 'pc');
}

function pickPreferredProgramDocByHostname(docs) {
  if (!docs || docs.length === 0) return null;
  if (docs.length === 1) return docs[0];
  const uuidFirst = docs.find((d) => _PROGRAM_DOC_UUID_RE.test(d.id));
  return uuidFirst || docs[0];
}

function getMonitorApiProgramSyncAliases() {
  const envA = (process.env.MONITOR_PROGRAM_SYNC_ALIASES || '').trim();
  if (!envA) return [];
  return envA.split(/[,;]/).map((s) => s.trim()).filter(Boolean);
}

async function resolveProgramsDocForSnapshot(hostname, extraAliases) {
  const envId = (process.env.MONITOR_PROGRAM_DOC_ID || '').trim();
  if (envId) {
    return { docId: envId, matchedBy: null, preserveDisplayNames: true, source: 'env' };
  }
  const list = [...new Set([hostname, ...extraAliases].map((n) => String(n || '').trim()).filter((n) => n && n !== 'unknown'))];
  if (list.length === 0) {
    return { docId: slugifyWorkstationProgramDocId('pc'), matchedBy: null, preserveDisplayNames: false, source: 'ws_slug' };
  }
  for (const hn of list) {
    let docs = await firebaseQueryAll('programs', 'device.computer_name', hn, 8);
    let chosen = pickPreferredProgramDocByHostname(docs);
    if (!chosen) {
      docs = await firebaseQueryAll('programs', 'name', hn, 8);
      chosen = pickPreferredProgramDocByHostname(docs);
    }
    if (chosen) {
      return { docId: chosen.id, matchedBy: hn, preserveDisplayNames: true, source: 'matched_existing' };
    }
  }
  return {
    docId: slugifyWorkstationProgramDocId(list[0]),
    matchedBy: list[0],
    preserveDisplayNames: false,
    source: 'ws_slug'
  };
}

function deepMergeProgramMaps(existing, patch) {
  const ex = existing && typeof existing === 'object' ? existing : {};
  const p = patch && typeof patch === 'object' ? patch : {};
  return { ...ex, ...p };
}

/** รวม net จาก snapshot — ไม่ทับค่าที่มีอยู่ด้วยสตริงว่าง (กัน DNS/mask ที่แอดมินกรอกหายหลังซิงก์) */
function mergeNetPreferNonEmpty(existing, incoming) {
  const ex = existing && typeof existing === 'object' ? existing : {};
  const inc = incoming && typeof incoming === 'object' ? incoming : {};
  const keys = ['ip', 'mask', 'gw', 'dns', 'mac', 'wifi'];
  const out = { ...ex };
  for (const k of keys) {
    if (!Object.prototype.hasOwnProperty.call(inc, k)) continue;
    const v = inc[k];
    if (v != null && String(v).trim() !== '') out[k] = String(v).trim();
  }
  return out;
}

function stripUndefinedDeepForLive(val) {
  if (val === undefined) return undefined;
  if (val === null || typeof val !== 'object') return val;
  if (Array.isArray(val)) {
    return val.map(stripUndefinedDeepForLive).filter((x) => x !== undefined);
  }
  const o = {};
  for (const [k, v] of Object.entries(val)) {
    if (v === undefined) continue;
    const inner = stripUndefinedDeepForLive(v);
    if (inner !== undefined) o[k] = inner;
  }
  return o;
}

/** ข้อมูลละเอียดสำหรับแอดมิน #programs — ตรงกับ buildLiveDetailPayload ใน it/server.js */
function buildLiveDetailPayloadFromSnapshot(snapshot) {
  if (!snapshot || typeof snapshot !== 'object') return {};
  const s = snapshot;
  return stripUndefinedDeepForLive({
    schemaVersion: 1,
    uuid: (s.system && s.system.uuid) || (s.os && s.os.serial) || '',
    capturedAt: s.timestamp || Date.now(),
    os: s.os,
    cpu: s.cpu,
    memory: s.memory,
    load: s.load,
    processes: s.processes,
    disks: s.disks,
    storage: s.storage,
    networkDrives: s.networkDrives,
    gpu: s.gpu,
    graphics: s.graphics,
    network: s.network,
    networkStatus: s.networkStatus,
    networkDefaultGateway: s.networkDefaultGateway,
    printers: s.printers,
    printerDrivers: s.printerDrivers,
    office: s.office,
    line: s.line,
    battery: s.battery,
    windowsUpdate: s.windowsUpdate,
    system: s.system,
    appVersion: s.appVersion,
    extras: s.extras
  });
}

function buildProgramPatchFromSnapshot(snapshot, sessionUserLabel) {
  const os = snapshot && snapshot.os ? snapshot.os : {};
  const hostname = String(os.hostname || '').trim() || 'unknown';
  const distro = os.distro || '';
  const release = os.release || '';
  const platform = os.platform || '';
  const liveOsLabel = [distro, release].filter(Boolean).join(' ').trim() || `${platform} ${release}`.trim();

  const office = Array.isArray(snapshot.office) ? snapshot.office : [];
  const officeLines = office.slice(0, 16).map((o) => {
    const n = o.name || 'Microsoft Office';
    const v = o.version && o.version !== '—' ? o.version : '';
    return v ? `${n} ${v}` : n;
  });

  const mem = snapshot.memory || {};
  const load = snapshot.load || {};
  const printers = Array.isArray(snapshot.printers) ? snapshot.printers : [];
  const lineInfo = snapshot.line || {};
  const liveTelemetry = {
    memoryUsedGB: mem.used != null ? (Number(mem.used) / 1e9).toFixed(2) : null,
    memoryTotalGB: mem.total != null ? (Number(mem.total) / 1e9).toFixed(2) : null,
    memoryUsagePercent: mem.usagePercent != null ? String(mem.usagePercent) : null,
    loadPercent: load.currentLoad != null ? Number(load.currentLoad).toFixed(1) : null,
    officeCount: office.length,
    printersCount: printers.length,
    lineInstalled: !!lineInfo.installed,
    timestamp: snapshot.timestamp || Date.now()
  };

  const cpu = snapshot.cpu || {};
  const gpu = snapshot.gpu || {};
  const sys = snapshot.system || {};
  const brandModel = [sys.manufacturer, sys.model].filter(Boolean).join(' ').trim();
  const netArr = Array.isArray(snapshot.network) ? snapshot.network : [];
  const primaryNet =
    netArr.find((x) => x && x.isDefault && x.ip4) ||
    netArr.find((x) => x && String(x.operstate || '').toLowerCase() === 'up' && x.ip4) ||
    netArr[0] ||
    {};
  const appVer = snapshot.appVersion != null ? String(snapshot.appVersion).trim() : '';
  const gw = String(snapshot.networkDefaultGateway || primaryNet.defaultGateway || '').trim();

  const device = {
    computer_name: hostname,
    brand_model: brandModel
  };
  const net = {
    ip: primaryNet.ip4 || '',
    mac: primaryNet.mac || '',
    mask: primaryNet.subnet || '',
    gw,
    dns: String(primaryNet.dnsServers || '').trim(),
    wifi: ''
  };
  const hw = {
    cpu: `${cpu.brand || ''} (${cpu.cores || 0} cores)`.trim(),
    ram: mem.total != null ? `${(Number(mem.total) / 1e9).toFixed(2)} GB (รวม)` : '',
    gpu: gpu.model ? gpu.model : '',
    storage: '',
    monitor: '',
    peripherals: '',
    warranty_item: ''
  };
  const liveDetail = buildLiveDetailPayloadFromSnapshot(snapshot);
  const patch = {
    nkbkConnextSync: true,
    connextHostname: hostname,
    connextAppVersion: appVer,
    liveOsLabel,
    liveSoftwareLines: officeLines,
    liveTelemetry,
    liveDetail,
    lastLiveSyncAt: new Date(),
    type: 'computer'
  };
  const u = sessionUserLabel != null ? String(sessionUserLabel).trim() : '';
  if (u) patch.user = u;
  return { hostname, patch, device, net, hw };
}

/**
 * @returns {Promise<{ ok: boolean, hostname?: string, docId?: string, mode?: string, action?: string, skipped?: boolean, reason?: string, error?: string }>}
 */
async function syncProgramsFromMonitorSnapshot(snapshot, sessionUserLabel) {
  if (/^1|true|yes$/i.test(String(process.env.MONITOR_DISABLE_PROGRAM_FIRESTORE_SYNC || '').trim())) {
    _lastProgramsSyncAttempt = {
      at: Date.now(),
      ok: false,
      skipped: true,
      reason: 'MONITOR_DISABLE_PROGRAM_FIRESTORE_SYNC'
    };
    return { ok: false, skipped: true, reason: 'MONITOR_DISABLE_PROGRAM_FIRESTORE_SYNC' };
  }
  if (!snapshot || typeof snapshot !== 'object') {
    return { ok: false, error: 'invalid snapshot' };
  }
  try {
    const os = snapshot.os || {};
    const hostname = String(os.hostname || '').trim() || 'unknown';
    const aliases = getMonitorApiProgramSyncAliases();
    const { docId, preserveDisplayNames, source, matchedBy } = await resolveProgramsDocForSnapshot(hostname, aliases);
    if (source === 'matched_existing') {
      console.log('[programs-sync] matched "' + (matchedBy || '') + '" → programs/' + docId);
    } else if (aliases.length && source === 'ws_slug') {
      console.warn(
        '[programs-sync] no Firestore match for hostname — using',
        docId,
        '— set MONITOR_PROGRAM_SYNC_ALIASES or MONITOR_PROGRAM_DOC_ID if admin card uses another name'
      );
    }

    const { patch, device: pDev, net: pNet, hw: pHw } = buildProgramPatchFromSnapshot(snapshot, sessionUserLabel);

    const existing = await firebaseGet('programs', docId);
    if (!existing) {
      const initial = {
        workStatus: 'ใช้งาน',
        icon: 'fas fa-desktop',
        name: hostname,
        user: patch.user || '',
        details: 'ข้อมูลซิงก์อัตโนมัติจาก NKBKConnext (Monitor API) — แก้ไขได้ที่แอดมิน',
        startDate: '',
        ...patch,
        device: {
          computer_name: hostname,
          brand_model: pDev.brand_model || ''
        },
        net: { ...pNet },
        hw: { ...pHw },
        userInfo: patch.user ? { fullname: patch.user } : {},
        sw: {},
        svc: {},
        sec: {},
        linkedSystems: [],
        otherSystems: []
      };
      delete initial.id;
      const mode = await writeProgramsDocumentAdminOrRest(docId, initial);
      console.log('[programs-sync] created programs/' + docId + (mode === 'admin' ? ' (admin)' : ''));
      _lastProgramsSyncAttempt = { at: Date.now(), ok: true, hostname, docId, mode, action: 'create' };
      return { ok: true, hostname, docId, mode, action: 'create' };
    }

    const merged = { ...existing, ...patch };
    merged.device = deepMergeProgramMaps(
      existing.device,
      preserveDisplayNames ? { brand_model: pDev.brand_model || '' } : { computer_name: hostname, brand_model: pDev.brand_model || '' }
    );
    merged.net = mergeNetPreferNonEmpty(existing.net, pNet);
    merged.hw = deepMergeProgramMaps(existing.hw, pHw);
    const sessLabel =
      sessionUserLabel != null && String(sessionUserLabel).trim() !== ''
        ? String(sessionUserLabel).trim()
        : '';
    if (sessLabel) {
      merged.user = sessLabel;
      merged.userInfo = deepMergeProgramMaps(existing.userInfo || {}, { fullname: sessLabel });
    }
    delete merged.id;
    const mode = await writeProgramsDocumentAdminOrRest(docId, merged);
    _lastProgramsSyncAttempt = { at: Date.now(), ok: true, hostname, docId, mode, action: 'merge' };
    if (mode === 'rest' && !_programsSyncRestWarned) {
      _programsSyncRestWarned = true;
      console.warn(
        '[programs-sync] เขียน programs ผ่าน REST — ถ้า rules เป็น write เฉพาะแอดมินจะล้มเหลว ให้ตั้ง FIREBASE_SERVICE_ACCOUNT_PATH + npm i firebase-admin'
      );
    }
    return { ok: true, hostname, docId, mode, action: 'merge' };
  } catch (e) {
    const msg = e && e.message ? String(e.message) : String(e);
    console.warn('[programs-sync] Firestore programs update failed:', msg);
    let hn = '';
    try {
      const os = snapshot.os || {};
      hn = String(os.hostname || '').trim() || 'unknown';
      _lastProgramsSyncAttempt = { at: Date.now(), ok: false, error: msg, hostname: hn };
    } catch (_) {
      _lastProgramsSyncAttempt = { at: Date.now(), ok: false, error: msg };
    }
    return { ok: false, error: msg, hostname: hn || undefined };
  }
}

// =====================================================
// CORS
// =====================================================
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'Content-Type, X-Monitor-Token, X-Monitor-System-Secret, X-Monitor-Read-Key, X-Monitor-Manual-Sync-Secret'
  );
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});

// =====================================================
// Health
// =====================================================
app.get('/', (req, res) => {
  const b = MONITOR_API_BASE_PATH || '';
  res.json({
    status: 'ok',
    message: 'NKBK Monitor API',
    service: 'nkbk-monitor-api',
    basePath: b || '/',
    timestamp: new Date().toISOString(),
    endpoints: [
      `POST ${b}/api/monitor-login`,
      `POST ${b}/api/monitor-system-snapshot`,
      `GET ${b}/api/monitor-system-snapshots?key=...`,
      `GET ${b}/api/programs-sync-status?key=...`,
      `GET ${b}/api/monitor-programs-sync-status?key=...`,
      `POST ${b}/api/programs-manual-sync`,
      `POST ${b}/api/monitor-programs-manual-sync`,
      `GET ${b}/workstations.html?key=...`
    ]
  });
});

// =====================================================
// สเปกเครื่องจากแอป Monitor -> แสดงบนเว็บ (nkbk.srsp.app)
// =====================================================
app.post('/api/monitor-system-snapshot', (req, res) => {
  if (!MONITOR_SYSTEM_UPLOAD_SECRET) {
    return res.status(503).json({ ok: false, message: 'เซิร์ฟเวอร์ยังไม่ตั้ง MONITOR_SYSTEM_UPLOAD_SECRET' });
  }
  const hdr = String(req.headers['x-monitor-system-secret'] || '').trim();
  if (hdr !== MONITOR_SYSTEM_UPLOAD_SECRET) {
    return res.status(401).json({ ok: false, message: 'ไม่ได้รับอนุญาต' });
  }
  const snapshot = req.body && req.body.snapshot;
  if (!snapshot || typeof snapshot !== 'object') {
    return res.status(400).json({ ok: false, message: 'ต้องส่ง { snapshot: { ... } }' });
  }
  const hostRaw = snapshot.os && snapshot.os.hostname != null ? String(snapshot.os.hostname).trim() : '';
  const key = (hostRaw || 'unknown').toLowerCase() || 'unknown';
  WORKSTATION_SNAPSHOTS.set(key, { updatedAt: Date.now(), hostname: hostRaw || key, snapshot });
  const now = Date.now();
  for (const [k, v] of WORKSTATION_SNAPSHOTS.entries()) {
    if (now - v.updatedAt > SNAPSHOT_TTL_MS) WORKSTATION_SNAPSHOTS.delete(k);
  }

  let sessionUserLabel = '';
  const tokenHdr = String(req.headers['x-monitor-token'] || '').trim();
  const tokenBody =
    req.body && req.body.monitorToken != null ? String(req.body.monitorToken).trim() : '';
  const tok = tokenHdr || tokenBody;
  if (tok) {
    const sess = MONITOR_SESSIONS.get(tok);
    if (sess && sess.username) {
      sessionUserLabel = (sess.fullname && String(sess.fullname).trim()) || String(sess.username).trim();
    }
  }
  syncProgramsFromMonitorSnapshot(snapshot, sessionUserLabel).catch(() => {});

  return res.json({ ok: true, hostname: hostRaw || key });
});

/**
 * บังคับซิงก์ snapshot ที่อยู่ใน RAM → Firestore `programs` (กรณีอัตโนมัติไม่ทำงาน)
 * Header: X-Monitor-Manual-Sync-Secret หรือ X-Monitor-System-Secret
 * ค่า = MONITOR_PROGRAM_MANUAL_SYNC_KEY (ถ้าตั้งใน .env) มิฉะนั้น = MONITOR_SYSTEM_UPLOAD_SECRET (เดียวกับแอป)
 *
 * ลงทะเบียน 2 path: ยาว + สั้น (กรณี proxy / เวอร์ชันเก่า)
 */
async function routePostProgramsManualSync(req, res) {
  const uploadSec = (MONITOR_SYSTEM_UPLOAD_SECRET || '').trim();
  const manualOnly = (process.env.MONITOR_PROGRAM_MANUAL_SYNC_KEY || '').trim();
  const expected = manualOnly || uploadSec;
  if (!expected) {
    return res.status(503).json({
      ok: false,
      message: 'ตั้ง MONITOR_SYSTEM_UPLOAD_SECRET หรือ MONITOR_PROGRAM_MANUAL_SYNC_KEY ใน .env ก่อน'
    });
  }
  const hManual = String(req.headers['x-monitor-manual-sync-secret'] || '').trim();
  const hUpload = String(req.headers['x-monitor-system-secret'] || '').trim();
  if (hManual !== expected && hUpload !== expected) {
    return res.status(401).json({
      ok: false,
      message:
        'ส่ง header X-Monitor-Manual-Sync-Secret หรือ X-Monitor-System-Secret ให้ตรงกับรหัสอัปโหลด (หรือ MONITOR_PROGRAM_MANUAL_SYNC_KEY)'
    });
  }
  const now = Date.now();
  const rows = [];
  for (const [, v] of WORKSTATION_SNAPSHOTS.entries()) {
    if (now - v.updatedAt > SNAPSHOT_TTL_MS) continue;
    rows.push(v);
  }
  if (rows.length === 0) {
    return res.json({
      ok: true,
      emptySnapshots: true,
      message:
        'ไม่มี snapshot ในหน่วยความจำเซิร์ฟเวอร์ — เปิดแอป NKBKConnext ให้ส่งข้อมูลก่อน แล้วกด โหลด/รีเฟรช บนหน้านี้',
      results: [],
      count: 0,
      lastProgramsSyncAttempt: _lastProgramsSyncAttempt
    });
  }
  const results = [];
  for (const v of rows) {
    const r = await syncProgramsFromMonitorSnapshot(v.snapshot, '');
    results.push({
      hostname: v.hostname,
      ...(r && typeof r === 'object' ? r : { ok: false, error: 'sync returned empty' })
    });
  }
  console.log(
    '[manual-sync]',
    JSON.stringify(results.map((x) => ({ hostname: x.hostname, ok: x.ok, docId: x.docId, error: x.error })))
  );
  return res.json({
    ok: true,
    count: results.length,
    results,
    lastProgramsSyncAttempt: _lastProgramsSyncAttempt
  });
}
app.post('/api/monitor-programs-manual-sync', routePostProgramsManualSync);
app.post('/api/programs-manual-sync', routePostProgramsManualSync);

app.get('/api/monitor-system-snapshots', (req, res) => {
  if (!MONITOR_SYSTEM_PUBLIC_READ_KEY) {
    return res.status(503).json({ ok: false, message: 'เซิร์ฟเวอร์ยังไม่ตั้ง MONITOR_SYSTEM_PUBLIC_READ_KEY' });
  }
  const qk = String(req.query.key || '').trim();
  const hk = String(req.headers['x-monitor-read-key'] || '').trim();
  if (qk !== MONITOR_SYSTEM_PUBLIC_READ_KEY && hk !== MONITOR_SYSTEM_PUBLIC_READ_KEY) {
    return res.status(401).json({ ok: false, message: 'ต้องส่ง key ที่ถูกต้อง' });
  }
  const now = Date.now();
  const list = [];
  for (const [k, v] of WORKSTATION_SNAPSHOTS.entries()) {
    if (now - v.updatedAt > SNAPSHOT_TTL_MS) {
      WORKSTATION_SNAPSHOTS.delete(k);
      continue;
    }
    list.push({
      hostname: v.hostname,
      updatedAt: v.updatedAt,
      snapshot: v.snapshot
    });
  }
  list.sort((a, b) => String(a.hostname).localeCompare(String(b.hostname), 'th'));
  return res.json({ ok: true, count: list.length, workstations: list });
});

/**
 * ตรวจว่าทำไม Firestore programs ว่าง — ใช้ key เดียวกับ monitor-system-snapshots
 * ลงทะเบียน 2 path: ยาว + สั้น
 */
function routeGetProgramsSyncStatus(req, res) {
  if (!MONITOR_SYSTEM_PUBLIC_READ_KEY) {
    return res.status(503).json({ ok: false, message: 'เซิร์ฟเวอร์ยังไม่ตั้ง MONITOR_SYSTEM_PUBLIC_READ_KEY' });
  }
  const qk = String(req.query.key || '').trim();
  const hk = String(req.headers['x-monitor-read-key'] || '').trim();
  if (qk !== MONITOR_SYSTEM_PUBLIC_READ_KEY && hk !== MONITOR_SYSTEM_PUBLIC_READ_KEY) {
    return res.status(401).json({ ok: false, message: 'ต้องส่ง key ที่ถูกต้อง' });
  }
  const saPathRaw = normalizeServiceAccountEnv(
    process.env.FIREBASE_SERVICE_ACCOUNT_PATH || process.env.GOOGLE_APPLICATION_CREDENTIALS || ''
  );
  const saResolved = resolveFirebaseServiceAccountPath();
  const saExists = !!(saResolved.path && fsSync.existsSync(saResolved.path));
  const adb = getMonitorAdminFirestore();
  const adminReady = !!adb;
  return res.json({
    ok: true,
    firebaseProjectId: FIREBASE_CONFIG.projectId,
    programFirestoreSyncDisabled: /^1|true|yes$/i.test(String(process.env.MONITOR_DISABLE_PROGRAM_FIRESTORE_SYNC || '').trim()),
    serviceAccountPathSet: !!saPathRaw,
    serviceAccountPathFromEnv: saPathRaw,
    serviceAccountResolvedPath: saResolved.path || '',
    serviceAccountResolution: saResolved.source,
    serviceAccountFileExists: saExists,
    firebaseAdminInstalled: (() => {
      try {
        require.resolve('firebase-admin');
        return true;
      } catch (_) {
        return false;
      }
    })(),
    firebaseAdminFirestoreReady: adminReady,
    hint:
      adminReady
        ? 'Admin SDK พร้อม — หลังแอปส่ง snapshot ควรมีเอกสารใน programs'
        : !saPathRaw
          ? 'ตั้ง FIREBASE_SERVICE_ACCOUNT_PATH หรือวางไฟล์ *firebase-adminsdk*.json ข้าง server.js แล้วรีสตาร์ท Node'
          : !saExists
            ? 'ไม่พบไฟล์ — ดู serviceAccountResolvedPath / serviceAccountResolution ด้านบน (ลองใส่แค่ชื่อไฟล์ใน .env หรือ path สัมพันธ์กับโฟลเดอร์แอป)'
            : 'มี path แต่ Admin SDK ไม่พร้อม — รัน npm install firebase-admin ในโฟลเดอร์ monitor-api',
    lastProgramsSyncAttempt: _lastProgramsSyncAttempt
  });
}
app.get('/api/monitor-programs-sync-status', routeGetProgramsSyncStatus);
app.get('/api/programs-sync-status', routeGetProgramsSyncStatus);

/** แถวแรก adminNetworkDrives → ฟอร์ม NAS (สอดคล้อง it/server.js) */
function firstAdminDriveToNasForm(drives) {
  const arr = Array.isArray(drives) ? drives : [];
  for (const d of arr) {
    if (!d || typeof d !== 'object') continue;
    const unc = String(d.uncPath || '').trim().replace(/\//g, '\\');
    let m = String(d.mount || d.unc || '').trim().replace(/\//g, '\\');
    const uncPath = unc || (m.startsWith('\\\\') ? m : '');
    const user = String(d.smbUsername || '').trim();
    const pass = String(d.smbPassword || '');
    const letterRaw = String(d.driveLetter || '').trim();
    let driveSel = letterRaw.toUpperCase().replace(/:$/, '');
    if (!driveSel && /^[A-Za-z]:/.test(m)) driveSel = m.charAt(0).toUpperCase();
    const effectiveUnc = uncPath || m;
    if (!effectiveUnc && !user && !pass) continue;
    return {
      uncPath: effectiveUnc || '',
      username: user,
      password: pass,
      driveLetter: driveSel || ''
    };
  }
  return null;
}

function buildNasWebRevision(docId, nas) {
  const payload = {
    docId: String(docId || ''),
    uncPath: nas.uncPath || '',
    username: nas.username || '',
    password: nas.password || '',
    driveLetter: nas.driveLetter || ''
  };
  return crypto.createHash('sha256').update(JSON.stringify(payload)).digest('hex').slice(0, 32);
}

/**
 * ดึงการตั้งค่า NAS จากเอกสาร programs (adminNetworkDrives) — key เดียวกับ monitor-system-snapshots
 * query: hostname (จำเป็น), computerName, aliases (คั่นด้วยจุลภาค)
 */
async function routeGetMonitorProgramNas(req, res) {
  if (!MONITOR_SYSTEM_PUBLIC_READ_KEY) {
    return res.status(503).json({ ok: false, message: 'เซิร์ฟเวอร์ยังไม่ตั้ง MONITOR_SYSTEM_PUBLIC_READ_KEY' });
  }
  const qk = String(req.query.key || '').trim();
  const hk = String(req.headers['x-monitor-read-key'] || '').trim();
  if (qk !== MONITOR_SYSTEM_PUBLIC_READ_KEY && hk !== MONITOR_SYSTEM_PUBLIC_READ_KEY) {
    return res.status(401).json({ ok: false, message: 'ต้องส่ง key ที่ถูกต้อง' });
  }
  const hostname = String(req.query.hostname || '').trim();
  if (!hostname) {
    return res.status(400).json({ ok: false, message: 'ต้องระบุ hostname' });
  }
  const computerName = String(req.query.computerName || '').trim();
  const aliasesFromQuery = String(req.query.aliases || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  const envAliases = getMonitorApiProgramSyncAliases();
  const extraAliases = [...new Set([computerName, ...aliasesFromQuery, ...envAliases].filter(Boolean))];
  try {
    const { docId, source, matchedBy } = await resolveProgramsDocForSnapshot(hostname, extraAliases);
    const data = await firebaseGet('programs', docId);
    if (!data || typeof data !== 'object') {
      return res.json({ ok: false, reason: 'no_doc', docId, source, matchedBy });
    }
    const nas = firstAdminDriveToNasForm(data.adminNetworkDrives);
    if (!nas) {
      return res.json({ ok: false, reason: 'no_admin_drives', docId, source, matchedBy });
    }
    const revision = buildNasWebRevision(docId, nas);
    return res.json({ ok: true, docId, source, matchedBy, nas, revision });
  } catch (e) {
    return res.status(500).json({ ok: false, message: (e && e.message) || String(e) });
  }
}
app.get('/api/monitor-program-nas', routeGetMonitorProgramNas);

/**
 * POST /api/programs-push-admin-web
 * รับข้อมูลเว็บไซต์ที่เชื่อมต่อจากแอปปลายทางที่ไม่มี firebase service account
 * Header: X-Monitor-System-Secret = MONITOR_SYSTEM_UPLOAD_SECRET
 * Body:   { hostname, url, database?, username?, password?, name?, computerName?, aliases? }
 * เขียน adminWebConnections[0] ของเอกสาร programs ที่ match ชื่อเครื่อง
 */
async function routePostProgramsPushAdminWeb(req, res) {
  if (!MONITOR_SYSTEM_UPLOAD_SECRET) {
    return res.status(503).json({ ok: false, reason: 'no_upload_secret', message: 'เซิร์ฟเวอร์ยังไม่ตั้ง MONITOR_SYSTEM_UPLOAD_SECRET' });
  }
  const hdr = String(req.headers['x-monitor-system-secret'] || '').trim();
  if (hdr !== MONITOR_SYSTEM_UPLOAD_SECRET) {
    return res.status(401).json({ ok: false, reason: 'unauthorized', message: 'ไม่ได้รับอนุญาต' });
  }
  const body = req.body || {};
  const hostname = String(body.hostname || '').trim();
  if (!hostname) return res.status(400).json({ ok: false, reason: 'invalid_hostname', message: 'ต้องระบุ hostname' });
  const rawUrl = String(body.url || '').trim();
  if (!rawUrl) return res.status(400).json({ ok: false, reason: 'invalid_url', message: 'ต้องระบุ url' });
  const url = /^https?:\/\//i.test(rawUrl) ? rawUrl : ('http://' + rawUrl);
  const database = body.database != null ? String(body.database).trim() : '';
  const username = body.username != null ? String(body.username).trim() : '';
  const password = body.password != null ? String(body.password) : '';
  const explicitName = body.name != null ? String(body.name).trim() : '';
  let name = explicitName;
  if (!name) {
    try { name = (new URL(url).host || '').replace(/^www\./i, ''); }
    catch (_) { name = url; }
  }
  const computerName = String(body.computerName || '').trim();
  const aliasesFromBody = Array.isArray(body.aliases)
    ? body.aliases.map((s) => String(s || '').trim()).filter(Boolean)
    : String(body.aliases || '').split(',').map((s) => s.trim()).filter(Boolean);
  const envAliases = getMonitorApiProgramSyncAliases();
  const extraAliases = [...new Set([computerName, ...aliasesFromBody, ...envAliases].filter(Boolean))];
  try {
    const { docId, source, matchedBy } = await resolveProgramsDocForSnapshot(hostname, extraAliases);
    const existing = (await firebaseGet('programs', docId)) || {};
    const list = Array.isArray(existing.adminWebConnections)
      ? existing.adminWebConnections.map((w) => (w && typeof w === 'object' ? { ...w } : {}))
      : [];
    const prev0 = list[0] && typeof list[0] === 'object' ? list[0] : {};
    const row = { name, url };
    if (database) row.database = database;
    if (username) row.username = username;
    if (password) row.password = password;
    const merged0 = { ...prev0, ...row };
    if (!database && prev0.database) merged0.database = prev0.database;
    if (!username && prev0.username) merged0.username = prev0.username;
    if (!password && prev0.password) merged0.password = prev0.password;
    if (prev0.note != null && String(prev0.note).trim() !== '' && (merged0.note == null || String(merged0.note).trim() === '')) {
      merged0.note = prev0.note;
    }
    list[0] = merged0;
    const payload = { ...existing, adminWebConnections: list };
    if (!payload.name) payload.name = hostname;
    delete payload.id;
    const mode = await writeProgramsDocumentAdminOrRest(docId, payload);
    return res.json({ ok: true, docId, source, matchedBy, mode, row: merged0 });
  } catch (e) {
    return res.status(500).json({ ok: false, reason: 'error', message: (e && e.message) || String(e) });
  }
}
app.post('/api/programs-push-admin-web', routePostProgramsPushAdminWeb);
app.post('/api/monitor-programs-push-admin-web', routePostProgramsPushAdminWeb);

// =====================================================
// Leave system — (my-leaves / balance / pending-approvals / approve / reject / form-data)
// สอดคล้องกับ schema V2 LIFF (leaves, leave_types, leave_balances)
// =====================================================
function _leaveFiscalYearKey(date) {
  const d = date instanceof Date ? date : new Date();
  return d.getFullYear();
}
function _leaveClassify(user) {
  const pos = String((user && user.position) || '').trim();
  const canFlag = user && (user.canApproveLeave === true || user.canApproveLeave === 'true');
  const isLevel1 = canFlag && /ผู้จัดการ/.test(pos) && !/รอง/.test(pos);
  const isLevel2 = canFlag && (/รองผู้จัดการ/.test(pos) || /หัวหน้า/.test(pos));
  return { canApprove: !!(canFlag && (isLevel1 || isLevel2)), isLevel1, isLevel2 };
}
async function _leaveLoadTypes() {
  try {
    const list = await firebaseGetCollection('leave_types', { pageSize: 200 });
    const out = {};
    (list || []).forEach((t) => { if (t && t.id) out[t.id] = t; });
    return out;
  } catch (_) { return {}; }
}
async function _leaveWriteDoc(collection, docId, patch) {
  const adb = getMonitorAdminFirestore();
  if (adb) {
    await adb.collection(collection).doc(String(docId)).set(patch, { merge: true });
    return 'admin';
  }
  await firebaseSet(collection, docId, patch);
  return 'rest';
}
function _leaveTsToIso(v) {
  if (!v) return '';
  if (typeof v === 'string') return v;
  if (v.toDate) { try { return v.toDate().toISOString(); } catch (_) {} }
  if (v._seconds != null) { try { return new Date(v._seconds * 1000).toISOString(); } catch (_) {} }
  return String(v);
}
function _leaveCreatedMs(v) {
  if (!v) return 0;
  if (v.toDate) { try { return v.toDate().getTime(); } catch (_) {} }
  if (v._seconds != null) return v._seconds * 1000;
  if (typeof v === 'string') { const t = Date.parse(v); return isNaN(t) ? 0 : t; }
  return 0;
}

app.get('/api/monitor-my-leaves', async (req, res) => {
  const token = (req.headers['x-monitor-token'] || req.query.token || '').trim();
  const session = token ? MONITOR_SESSIONS.get(token) : null;
  if (!session) return res.status(401).json({ ok: false, reason: 'no_session' });
  try {
    const u = await findUserForMonitor(session.username);
    if (!u) return res.status(404).json({ ok: false, reason: 'no_user' });
    const types = await _leaveLoadTypes();
    const all = await firebaseQueryAll('leaves', 'userId', u.id, 500);
    const items = (all || []).map((d) => ({
      id: d.id,
      type: String(d.type || ''),
      typeName: (types[d.type] && (types[d.type].nameTH || types[d.type].name)) || String(d.type || ''),
      partial: String(d.partial || 'full'),
      startDate: String(d.startDate || ''),
      endDate: String(d.endDate || ''),
      durationDays: Number(d.durationDays) || 0,
      status: String(d.status || 'pending'),
      reason: String(d.reason || ''),
      approverName1: String(d.approverName1 || ''),
      approverName2: String(d.approverName2 || ''),
      createdAtMs: _leaveCreatedMs(d.createdAt)
    }));
    items.sort((a, b) => {
      const sa = String(a.startDate || ''), sb = String(b.startDate || '');
      if (sa && sb && sa !== sb) return sb.localeCompare(sa);
      return (b.createdAtMs || 0) - (a.createdAtMs || 0);
    });
    return res.json({ ok: true, items, userId: u.id });
  } catch (e) {
    return res.status(500).json({ ok: false, reason: 'error', message: (e && e.message) || String(e) });
  }
});

app.get('/api/monitor-my-leave-balance', async (req, res) => {
  const token = (req.headers['x-monitor-token'] || req.query.token || '').trim();
  const session = token ? MONITOR_SESSIONS.get(token) : null;
  if (!session) return res.status(401).json({ ok: false, reason: 'no_session' });
  try {
    const u = await findUserForMonitor(session.username);
    if (!u) return res.status(404).json({ ok: false, reason: 'no_user' });
    const year = _leaveFiscalYearKey(new Date());
    const types = await _leaveLoadTypes();
    const balDoc = await firebaseGet('leave_balances', u.id + '_' + year);
    const itemsMap = balDoc && balDoc.items && typeof balDoc.items === 'object' ? balDoc.items : {};
    const out = [];
    for (const [tid, t] of Object.entries(types)) {
      const row = itemsMap[tid] || {};
      const quota = Number(row.quota != null ? row.quota : (t.yearlyQuota || t.quota || 0)) || 0;
      const used = Number(row.used != null ? row.used : 0) || 0;
      const remaining = Number(row.remaining != null ? row.remaining : (quota - used)) || 0;
      out.push({
        typeId: tid,
        name: String(t.nameTH || t.name || tid),
        order: Number(t.order) || 999,
        quota, used, remaining
      });
    }
    out.sort((a, b) => (a.order || 999) - (b.order || 999));
    return res.json({ ok: true, year, items: out });
  } catch (e) {
    return res.status(500).json({ ok: false, reason: 'error', message: (e && e.message) || String(e) });
  }
});

app.get('/api/monitor-leave-pending-approvals', async (req, res) => {
  const token = (req.headers['x-monitor-token'] || req.query.token || '').trim();
  const session = token ? MONITOR_SESSIONS.get(token) : null;
  if (!session) return res.status(401).json({ ok: false, reason: 'no_session' });
  try {
    const u = await findUserForMonitor(session.username);
    if (!u) return res.status(404).json({ ok: false, reason: 'no_user' });
    const cls = _leaveClassify(u);
    if (!cls.canApprove) return res.json({ ok: true, canApprove: false, items: [] });
    const types = await _leaveLoadTypes();
    const statuses = cls.isLevel1 ? ['pending', 'approved_lv1'] : ['pending'];
    const all = [];
    for (const st of statuses) {
      const list = await firebaseQueryAll('leaves', 'status', st, 200);
      (list || []).forEach((d) => {
        if (d.userId === u.id) return;
        all.push({
          id: d.id,
          userId: String(d.userId || ''),
          userName: String(d.userName || ''),
          userDept: String(d.userDept || ''),
          type: String(d.type || ''),
          typeName: (types[d.type] && (types[d.type].nameTH || types[d.type].name)) || String(d.type || ''),
          partial: String(d.partial || 'full'),
          startDate: String(d.startDate || ''),
          endDate: String(d.endDate || ''),
          durationDays: Number(d.durationDays) || 0,
          status: String(d.status || 'pending'),
          reason: String(d.reason || ''),
          approverName2: String(d.approverName2 || ''),
          createdAtMs: _leaveCreatedMs(d.createdAt)
        });
      });
    }
    all.sort((a, b) => (a.createdAtMs || 0) - (b.createdAtMs || 0));
    return res.json({ ok: true, canApprove: true, level: cls.isLevel1 ? 1 : 2, items: all });
  } catch (e) {
    return res.status(500).json({ ok: false, reason: 'error', message: (e && e.message) || String(e) });
  }
});

app.post('/api/monitor-leave-approve', async (req, res) => {
  const token = (req.headers['x-monitor-token'] || req.query.token || '').trim();
  const session = token ? MONITOR_SESSIONS.get(token) : null;
  if (!session) return res.status(401).json({ ok: false, reason: 'no_session' });
  const leaveId = req.body && req.body.leaveId ? String(req.body.leaveId) : '';
  if (!leaveId) return res.status(400).json({ ok: false, reason: 'no_id' });
  try {
    const u = await findUserForMonitor(session.username);
    if (!u) return res.status(404).json({ ok: false, reason: 'no_user' });
    const cls = _leaveClassify(u);
    if (!cls.canApprove) return res.status(403).json({ ok: false, reason: 'not_approver' });
    const d = await firebaseGet('leaves', leaveId);
    if (!d) return res.status(404).json({ ok: false, reason: 'no_leave' });
    if (d.userId === u.id) return res.status(400).json({ ok: false, reason: 'self' });
    const curStatus = String(d.status || 'pending');
    const now = new Date();
    const approverName = String(u.fullname || session.fullname || session.username);
    const patch = {};
    if (cls.isLevel1) {
      if (curStatus === 'approved' || curStatus === 'rejected' || curStatus === 'cancelled') {
        return res.status(400).json({ ok: false, reason: 'bad_state', currentStatus: curStatus });
      }
      patch.status = 'approved';
      patch.approvedByLevel1 = u.id;
      patch.approvedAtLevel1 = now;
      patch.approverName1 = approverName;
      try {
        const year = _leaveFiscalYearKey(new Date());
        const balId = (d.userId || '') + '_' + year;
        const bal = await firebaseGet('leave_balances', balId);
        const items = bal && bal.items && typeof bal.items === 'object' ? { ...bal.items } : {};
        const tid = d.type;
        const days = Number(d.durationDays) || 0;
        const row = items[tid] || {};
        const used = (Number(row.used) || 0) + days;
        const quota = Number(row.quota != null ? row.quota : 0) || 0;
        items[tid] = { ...row, used, remaining: quota - used };
        await _leaveWriteDoc('leave_balances', balId, { items });
      } catch (e) { console.warn('[leave-approve] balance update:', e.message); }
    } else {
      if (curStatus !== 'pending') {
        return res.status(400).json({ ok: false, reason: 'bad_state', currentStatus: curStatus });
      }
      patch.status = 'approved_lv1';
      patch.approvedByLevel2 = u.id;
      patch.approvedAtLevel2 = now;
      patch.approverName2 = approverName;
    }
    await _leaveWriteDoc('leaves', leaveId, patch);
    return res.json({ ok: true, status: patch.status });
  } catch (e) {
    return res.status(500).json({ ok: false, reason: 'error', message: (e && e.message) || String(e) });
  }
});

app.post('/api/monitor-leave-reject', async (req, res) => {
  const token = (req.headers['x-monitor-token'] || req.query.token || '').trim();
  const session = token ? MONITOR_SESSIONS.get(token) : null;
  if (!session) return res.status(401).json({ ok: false, reason: 'no_session' });
  const leaveId = req.body && req.body.leaveId ? String(req.body.leaveId) : '';
  const reason = req.body && req.body.reason != null ? String(req.body.reason).trim() : '';
  if (!leaveId) return res.status(400).json({ ok: false, reason: 'no_id' });
  try {
    const u = await findUserForMonitor(session.username);
    if (!u) return res.status(404).json({ ok: false, reason: 'no_user' });
    const cls = _leaveClassify(u);
    if (!cls.canApprove) return res.status(403).json({ ok: false, reason: 'not_approver' });
    const d = await firebaseGet('leaves', leaveId);
    if (!d) return res.status(404).json({ ok: false, reason: 'no_leave' });
    if (d.userId === u.id) return res.status(400).json({ ok: false, reason: 'self' });
    const curStatus = String(d.status || 'pending');
    if (curStatus === 'approved' || curStatus === 'rejected' || curStatus === 'cancelled') {
      return res.status(400).json({ ok: false, reason: 'bad_state', currentStatus: curStatus });
    }
    const rejectorName = String(u.fullname || session.fullname || session.username);
    const now = new Date();
    await _leaveWriteDoc('leaves', leaveId, {
      status: 'rejected',
      rejectedAt: now,
      statusAt: now,
      approverId: u.id,
      rejectedBy: u.id,
      rejectedByName: rejectorName,
      rejectorName: rejectorName,
      rejectReason: reason
    });
    return res.json({ ok: true, status: 'rejected' });
  } catch (e) {
    return res.status(500).json({ ok: false, reason: 'error', message: (e && e.message) || String(e) });
  }
});

app.get('/api/monitor-leave-form-data', async (req, res) => {
  const token = (req.headers['x-monitor-token'] || req.query.token || '').trim();
  const session = token ? MONITOR_SESSIONS.get(token) : null;
  if (!session) return res.status(401).json({ ok: false, reason: 'no_session' });
  const leaveId = String(req.query.leaveId || '').trim();
  if (!leaveId) return res.status(400).json({ ok: false, reason: 'no_id' });
  try {
    const l = await firebaseGet('leaves', leaveId);
    if (!l) return res.status(404).json({ ok: false, reason: 'no_leave' });
    const me = await findUserForMonitor(session.username);
    const myUid = me ? me.id : '';
    const meRole = me ? String(me.role || '').trim() : '';
    const cls = _leaveClassify(me);
    if (l.userId !== myUid && meRole !== 'ผู้ดูแลระบบ' && meRole !== 'แอดมิน' && !cls.canApprove) {
      return res.status(403).json({ ok: false, reason: 'forbidden' });
    }
    const user = l.userId ? await firebaseGet('users', l.userId) : null;
    async function resolveApprover(idOrEmail, fallback) {
      const s = String(idOrEmail || '').trim();
      if (!s) return String(fallback || '');
      try {
        if (s.includes('@')) {
          const q = await firebaseQuery('users', 'email', s);
          if (q) return String(q.fullname || q.nameTH || q.displayName || fallback || '');
        } else {
          const doc = await firebaseGet('users', s);
          if (doc) return String(doc.fullname || doc.nameTH || doc.displayName || fallback || '');
        }
      } catch (_) {}
      return String(fallback || s);
    }
    const approverLv1Name = await resolveApprover(l.approvedByLevel1 || l.approverId1 || l.approverId, l.approverName1 || l.approverName);
    const approverLv2Name = await resolveApprover(l.approvedByLevel2 || l.acknowledgedByLevel2 || l.approverId2, l.approverName2 || l.acknowledgerName2);
    const types = await _leaveLoadTypes();
    const typeName = (l.type && types[l.type] && (types[l.type].nameTH || types[l.type].name)) || String(l.type || '');
    const year = _leaveFiscalYearKey(new Date());
    const bal = await firebaseGet('leave_balances', (l.userId || '') + '_' + year);
    const balItems = bal && bal.items ? bal.items : {};
    const balance = [];
    for (const [tid, t] of Object.entries(types)) {
      const row = balItems[tid] || {};
      const quota = Number(t.yearlyQuota || row.quota || 0) || 0;
      const used = Number(row.used || 0) || 0;
      balance.push({
        typeId: tid,
        name: String(t.nameTH || t.name || tid),
        quota, used, remaining: Math.max(0, quota - used),
        order: Number(t.order) || 999
      });
    }
    balance.sort((a, b) => (a.order || 999) - (b.order || 999));
    return res.json({
      ok: true,
      leaveId,
      leave: {
        type: l.type || '',
        typeName,
        partial: l.partial || 'full',
        startDate: l.startDate || '',
        endDate: l.endDate || l.startDate || '',
        durationDays: Number(l.durationDays) || 0,
        reason: l.reason || l.note || '',
        status: l.status || 'pending',
        createdAtIso: _leaveTsToIso(l.createdAt),
        approvedAtLevel1Iso: _leaveTsToIso(l.approvedAtLevel1 || l.approvedAt1 || l.approvedAt),
        approvedAtLevel2Iso: _leaveTsToIso(l.approvedAtLevel2 || l.approvedAt2 || l.acknowledgedAtLevel2),
        acknowledged: !!l.acknowledgedByLevel2
      },
      user: {
        fullname: (user && (user.fullname || user.nameTH || user.displayName)) || l.userName || '',
        position: (user && (user.position || user.jobPosition)) || '',
        job: (user && (user.job || user.workType)) || '',
        department: (user && (user.department || user.dept)) || l.userDept || ''
      },
      approver: { level1Name: approverLv1Name || '', level2Name: approverLv2Name || '' },
      balance
    });
  } catch (e) {
    return res.status(500).json({ ok: false, reason: 'error', message: (e && e.message) || String(e) });
  }
});

// =====================================================
// GET /api/monitor-me
// =====================================================
app.get('/api/monitor-me', async (req, res) => {
  const token = (req.headers['x-monitor-token'] || req.query.token || '').trim();
  const session = token ? MONITOR_SESSIONS.get(token) : null;
  if (!session) return res.status(401).json({ ok: false });
  let fullname = session.fullname || '';
  let email = session.email || '';
  let group = session.group || '';
  let role = session.role || '';
  let work = buildWorkFromUser(null);
  let todayAttendance = {
    date: getBangkokDateId(),
    checkIn: '—',
    checkOut: '—',
    statusText: '—',
    lateText: '',
    lateLevel: null
  };
  try {
    const user = await findUserForMonitor(session.username);
    if (user) {
      fullname = user.fullname != null ? String(user.fullname).trim() : fullname;
      email = user.email != null ? String(user.email).trim() : email;
      group = user.group != null ? String(user.group).trim() : group;
      role = user.role != null ? String(user.role).trim() : role;
      work = buildWorkFromUser(user);
      todayAttendance = await buildTodayAttendance(user);
    }
  } catch (e) {
    console.error('monitor-me profile lookup:', e.message);
  }
  res.json({
    ok: true,
    username: session.username,
    fullname,
    email,
    group,
    role,
    work,
    todayAttendance
  });
});

// =====================================================
// GET /api/monitor-attendance-month?year=2026&month=3
// =====================================================
app.get('/api/monitor-attendance-month', async (req, res) => {
  const token = (req.headers['x-monitor-token'] || req.query.token || '').trim();
  const session = token ? MONITOR_SESSIONS.get(token) : null;
  if (!session) return res.status(401).json({ ok: false, message: 'กรุณาเข้าสู่ระบบใหม่' });
  const year = parseInt(req.query.year, 10);
  const month = parseInt(req.query.month, 10);
  if (!year || !month || month < 1 || month > 12 || year < 2000 || year > 2100) {
    return res.status(400).json({ ok: false, message: 'ระบุ year (ค.ศ.) และ month (1-12)' });
  }
  try {
    const user = await findUserForMonitor(session.username);
    if (!user) return res.status(404).json({ ok: false, message: 'ไม่พบบัญชีผู้ใช้' });
    const payload = await buildAttendanceMonthApi(user, year, month);
    return res.json({ ok: true, ...payload });
  } catch (e) {
    console.error('monitor-attendance-month:', e.message);
    return res.status(500).json({ ok: false, message: e.message || 'โหลดไม่สำเร็จ' });
  }
});

// =====================================================
// POST /api/monitor-change-pin (ต้องมีสิทธิ์เขียน Firestore users — ตามกฎของโปรเจกต์)
// =====================================================
app.post('/api/monitor-change-pin', async (req, res) => {
  const token = (req.headers['x-monitor-token'] || '').trim();
  const session = token ? MONITOR_SESSIONS.get(token) : null;
  if (!session) return res.status(401).json({ ok: false, message: 'กรุณาเข้าสู่ระบบใหม่' });
  const currentPin = String((req.body && req.body.currentPin) || '').trim();
  const newPin = String((req.body && req.body.newPin) || '').trim();
  if (!/^\d{6}$/.test(newPin)) {
    return res.status(400).json({ ok: false, message: 'รหัส PIN ใหม่ต้องเป็นตัวเลข 6 หลัก' });
  }
  if (currentPin === newPin) {
    return res.status(400).json({ ok: false, message: 'รหัสใหม่ต้องไม่ซ้ำกับรหัสเดิม' });
  }
  try {
    const user = await findUserForMonitor(session.username);
    if (!user) return res.status(404).json({ ok: false, message: 'ไม่พบบัญชีผู้ใช้' });
    const pinOk = String(user.pin != null ? user.pin : '').trim() === currentPin;
    if (!pinOk) return res.status(400).json({ ok: false, message: 'รหัส PIN ปัจจุบันไม่ถูกต้อง' });
    const docId = user.id;
    if (!docId) return res.status(500).json({ ok: false, message: 'ไม่พบรหัสเอกสารผู้ใช้ในระบบ' });
    await firebaseSet('users', docId, { pin: newPin });
    return res.json({ ok: true, message: 'เปลี่ยนรหัส PIN เรียบร้อย' });
  } catch (e) {
    console.error('monitor-change-pin:', e.message);
    return res.status(500).json({
      ok: false,
      message: e.message || 'ไม่สามารถเปลี่ยนรหัสได้ — ตรวจสิทธิ์ Firestore หรือลองใหม่'
    });
  }
});

// =====================================================
// POST /api/monitor-logout
// =====================================================
app.post('/api/monitor-logout', (req, res) => {
  const token = (req.headers['x-monitor-token'] || (req.body && req.body.token) || '').trim();
  if (token) monitorSessionsDelete(token);
  res.json({ ok: true });
});

// =====================================================
// LINE Login (บน monitor-api — คีย์จาก .env; แอปเดสก์ท็อปพร็อกซีเมื่อมี monitorApiUrl)
// =====================================================
const LINE_OAUTH_PENDING = new Map();
const LINE_LOGIN_POLL = new Map();

function lineHtmlEscMonitor(s) {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function sanitizeLineReturnOrigin(raw) {
  const u = String(raw || '').trim();
  if (!/^http:\/\/127\.0\.0\.1:\d+$/i.test(u)) return '';
  return u.replace(/\/+$/, '');
}

function normLineCallbackUrl(u) {
  return String(u || '')
    .replace(/^\uFEFF/g, '')
    .trim()
    .replace(/\/+$/, '');
}

function lineCallbackUrlsEquivalent(a, b) {
  const na = normLineCallbackUrl(a);
  const nb = normLineCallbackUrl(b);
  if (!na || !nb) return false;
  if (na === nb) return true;
  try {
    const ua = new URL(na);
    const ub = new URL(nb);
    return (
      ua.protocol.toLowerCase() === ub.protocol.toLowerCase() &&
      ua.hostname.toLowerCase() === ub.hostname.toLowerCase() &&
      String(ua.port || '') === String(ub.port || '') &&
      (ua.pathname || '').replace(/\/+$/, '') === (ub.pathname || '').replace(/\/+$/, '')
    );
  } catch (_) {
    return false;
  }
}

const KNOWN_LINE_OAUTH_CALLBACK_PATHS = ['/api/line-login-callback', '/monitor-api/api/line-login-callback'];

/**
 * redirect_uri จากแอปเดสก์ท็อป (สร้างจาก monitorApiUrl) — ใช้เมื่อ reverse proxy ตัด path ทำให้ infer จาก req ผิด
 * อนุญาตเฉพาะ https + host ตรงกับ .env หรือ Host ของคำขอ + path callback ที่ยอมรับได้
 */
function pickAllowedLineOAuthRedirectUri(clientUri, req) {
  const u = normLineCallbackUrl(clientUri);
  if (!u || !/^https:\/\//i.test(u)) return '';
  let purl;
  try {
    purl = new URL(u);
  } catch (_) {
    return '';
  }
  const path = (purl.pathname || '').replace(/\/+$/, '') || '/';
  const host = (purl.hostname || '').toLowerCase();

  const ex = normLineCallbackUrl(process.env.LINE_LOGIN_CALLBACK_URL || '');
  if (ex) {
    if (lineCallbackUrlsEquivalent(u, ex)) return u;
    try {
      const eu = new URL(ex);
      if (host !== eu.hostname.toLowerCase()) return '';
      if (KNOWN_LINE_OAUTH_CALLBACK_PATHS.includes(path)) return u;
    } catch (_) {}
    return '';
  }

  const allowedHosts = new Set();
  const mo = normLineCallbackUrl(process.env.MONITOR_PUBLIC_ORIGIN || '');
  if (mo) {
    try {
      allowedHosts.add(new URL(mo).hostname.toLowerCase());
    } catch (_) {}
  }
  const fh = String((req && req.get && req.get('x-forwarded-host')) || (req && req.get && req.get('host')) || '')
    .split(',')[0]
    .trim()
    .toLowerCase()
    .split(':')[0];
  if (fh) allowedHosts.add(fh);
  if (!allowedHosts.size) return '';
  if (!allowedHosts.has(host)) return '';

  const bp = (MONITOR_API_BASE_PATH || '').trim().replace(/\/+$/, '');
  const paths = new Set(KNOWN_LINE_OAUTH_CALLBACK_PATHS);
  if (bp) {
    const base = bp.startsWith('/') ? bp : `/${bp}`;
    const p3 = `${base}/api/line-login-callback`.replace(/([^:])\/{2,}/g, '$1/').replace(/\/+$/, '');
    if (p3 && p3 !== '/') paths.add(p3);
  }
  return paths.has(path) ? u : '';
}

function getLineLoginCallbackPublicUrl(req) {
  const explicit = normLineCallbackUrl(process.env.LINE_LOGIN_CALLBACK_URL || '');
  if (explicit) return explicit;
  let origin = (process.env.MONITOR_PUBLIC_ORIGIN || '').trim().replace(/\/+$/, '');
  if (!origin && req) {
    const proto = String(req.get('x-forwarded-proto') || '').split(',')[0].trim() || 'https';
    const host = String(req.get('x-forwarded-host') || req.get('host') || '').split(',')[0].trim();
    if (host && /^https?$/i.test(proto)) origin = `${proto}://${host}`;
  }
  if (!origin) return '';
  let bp = MONITOR_API_BASE_PATH || '';
  if (!bp && req) bp = inferMonitorApiBasePathFromReq(req);
  const suffix = '/api/line-login-callback';
  if (!bp) return `${origin}${suffix}`;
  const base = bp.startsWith('/') ? bp : `/${bp}`;
  return `${origin}${base}${suffix}`.replace(/([^:])\/{2,}/g, '$1/');
}

function httpsPostForm(urlString, bodyStr) {
  const u = new URL(urlString);
  return new Promise((resolve, reject) => {
    const opts = {
      hostname: u.hostname,
      port: u.port || 443,
      path: u.pathname + u.search,
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(bodyStr, 'utf8')
      }
    };
    const req = https.request(opts, (res) => {
      let raw = '';
      res.on('data', (c) => {
        raw += c;
      });
      res.on('end', () => resolve({ status: res.statusCode, raw }));
    });
    req.on('error', reject);
    req.write(bodyStr);
    req.end();
  });
}

function v2UserMayAccessMonitorLine(user) {
  if (!user) return false;
  const g = String(user.group || '').trim();
  const r = String(user.role || '').trim();
  if (g === 'สมาชิก') return false;
  if (g !== 'เจ้าหน้าที่' && g !== 'กรรมการ' && r !== 'ผู้ดูแลระบบ' && r !== 'แอดมิน' && r.indexOf('ผู้ดูแล') < 0 && g) return false;
  return true;
}

app.get('/api/monitor-public-config', (req, res) => {
  const id = (process.env.LINE_LOGIN_CHANNEL_ID || '').trim();
  const sec = (process.env.LINE_LOGIN_CHANNEL_SECRET || '').trim();
  res.json({ lineLoginEnabled: !!(id && sec) });
});

app.get('/api/line-login-start', (req, res) => {
  const channelId = (process.env.LINE_LOGIN_CHANNEL_ID || '').trim();
  const channelSecret = (process.env.LINE_LOGIN_CHANNEL_SECRET || '').trim();
  if (!channelId || !channelSecret) {
    return res.status(503).json({
      ok: false,
      message: 'ยังไม่ตั้ง LINE_LOGIN_CHANNEL_ID / LINE_LOGIN_CHANNEL_SECRET ใน .env ของ monitor-api'
    });
  }
  const returnOrigin = sanitizeLineReturnOrigin(req.query.return_origin || req.query.returnOrigin || '');
  if (!returnOrigin) {
    return res.status(400).json({
      ok: false,
      message: 'ต้องส่ง return_origin เป็น http://127.0.0.1:พอร์ต (จากแอปเดสก์ท็อป)'
    });
  }
  const fromClient = String(req.query.line_oauth_redirect_uri || req.query.lineOauthRedirectUri || '').trim();
  let callbackPublic = fromClient ? pickAllowedLineOAuthRedirectUri(fromClient, req) : '';
  if (!callbackPublic) callbackPublic = getLineLoginCallbackPublicUrl(req);
  if (!callbackPublic) {
    return res.status(503).json({
      ok: false,
      message:
        'ตั้ง MONITOR_PUBLIC_ORIGIN หรือ LINE_LOGIN_CALLBACK_URL ใน .env — ต้องตรงกับ Callback URL ใน LINE Developers'
    });
  }
  const state = crypto.randomBytes(24).toString('hex');
  LINE_OAUTH_PENDING.set(state, {
    returnOrigin,
    redirectUri: callbackPublic,
    expires: Date.now() + 10 * 60 * 1000
  });
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: channelId,
    redirect_uri: callbackPublic,
    state,
    scope: 'openid profile'
  });
  const url = `https://access.line.me/oauth2/v2.1/authorize?${params.toString()}`;
  res.json({ ok: true, url, state });
});

app.get('/api/line-login-poll', (req, res) => {
  const state = String(req.query.state || '').trim();
  if (!state || !/^[a-f0-9]{48}$/i.test(state)) {
    return res.status(400).json({ ok: false, message: 'state ไม่ถูกต้อง' });
  }
  const row = LINE_LOGIN_POLL.get(state);
  if (!row) return res.json({ ok: true, pending: true });
  if (row.expires < Date.now()) {
    LINE_LOGIN_POLL.delete(state);
    return res.json({ ok: false, message: 'หมดเวลา ลองเข้า LINE ใหม่' });
  }
  if (row.error) {
    LINE_LOGIN_POLL.delete(state);
    return res.json({ ok: false, message: row.error });
  }
  if (row.token) {
    LINE_LOGIN_POLL.delete(state);
    return res.json({ ok: true, token: row.token, username: row.username });
  }
  return res.json({ ok: true, pending: true });
});

app.get('/api/line-login-callback', async (req, res) => {
  const qerr = (req.query && req.query.error) || '';
  const qdesc = (req.query && req.query.error_description) || '';
  if (qerr) {
    return res
      .status(200)
      .type('html')
      .send(
        `<!DOCTYPE html><html lang="th"><head><meta charset="utf-8"></head><body style="font-family:sans-serif;padding:1.5rem;text-align:center">` +
          `<p>${lineHtmlEscMonitor(String(qdesc || qerr))}</p><p>ปิดหน้าต่างนี้แล้วลองใหม่ในแอป</p></body></html>`
      );
  }
  const codeStr = String((req.query && req.query.code) || '').trim();
  const state = String((req.query && req.query.state) || '').trim();
  if (!codeStr || !state) {
    return res.status(400).type('html').send(
      '<!DOCTYPE html><meta charset="utf-8"><body style="font-family:sans-serif;padding:1.5rem;max-width:36rem">' +
        '<p><strong>พารามิเตอร์ไม่ครบ</strong></p>' +
        '<p style="color:#444;line-height:1.5">ที่อยู่นี้ใช้เมื่อ LINE ส่งกลับหลังคุณกดอนุญาตใน LINE เท่านั้น (จะมี <code>?code=</code> และ <code>state=</code> ต่อท้าย) — อย่าเปิดลิงก์นี้โดยตรง ให้กด «เข้าสู่ระบบด้วย LINE» จากแอปหรือหน้า Login แล้วทำขั้นตอนใน LINE</p>' +
        '</body>'
    );
  }
  const pending = LINE_OAUTH_PENDING.get(state);
  if (!pending || pending.expires < Date.now()) {
    return res.status(400).type('html').send('<body>ลิงก์หมดอายุ — ลองกดเข้าด้วย LINE จากแอปอีกครั้ง</body>');
  }
  const returnOrigin = pending.returnOrigin;
  const storedRedirect = pending.redirectUri ? normLineCallbackUrl(pending.redirectUri) : '';
  LINE_OAUTH_PENDING.delete(state);
  const channelId = (process.env.LINE_LOGIN_CHANNEL_ID || '').trim();
  const channelSecret = (process.env.LINE_LOGIN_CHANNEL_SECRET || '').trim();
  if (!channelId || !channelSecret) {
    return res.status(500).type('html').send('<body>เซิร์ฟเวอร์ยังไม่ตั้งค่า LINE channel</body>');
  }
  const callbackPublic = storedRedirect || getLineLoginCallbackPublicUrl(req);
  if (!callbackPublic) {
    return res.status(500).type('html').send('<body>ตั้งค่า callback URL ไม่ครบ</body>');
  }
  try {
    const tokenBody = new URLSearchParams({
      grant_type: 'authorization_code',
      code: codeStr,
      redirect_uri: callbackPublic,
      client_id: channelId,
      client_secret: channelSecret
    }).toString();
    const tr = await httpsPostForm('https://api.line.me/oauth2/v2.1/token', tokenBody);
    let tj = {};
    try {
      tj = JSON.parse(tr.raw || '{}');
    } catch (_) {}
    if (tr.status < 200 || tr.status >= 300) {
      const msg = (tj && (tj.error_description || tj.error)) || 'token error';
      LINE_LOGIN_POLL.set(state, { error: String(msg), expires: Date.now() + 120000 });
      return res
        .status(200)
        .type('html')
        .send(
          `<!DOCTYPE html><meta charset="utf-8"><body style="padding:1.5rem;text-align:center"><p>${lineHtmlEscMonitor(msg)}</p></body></html>`
        );
    }
    const idToken = (tj && tj.id_token) || '';
    if (!idToken) {
      LINE_LOGIN_POLL.set(state, { error: 'LINE ไม่ส่ง id_token', expires: Date.now() + 120000 });
      return res.status(200).type('html').send('<body>LINE ไม่ส่ง id_token</body>');
    }
    const vb = new URLSearchParams({ id_token: idToken, client_id: channelId }).toString();
    const vr = await httpsPostForm('https://api.line.me/oauth2/v2.1/verify', vb);
    let vj = {};
    try {
      vj = JSON.parse(vr.raw || '{}');
    } catch (_) {}
    if (vr.status < 200 || vr.status >= 300 || !vj.sub) {
      const msg = (vj && (vj.error_description || vj.error)) || 'verify id_token failed';
      LINE_LOGIN_POLL.set(state, { error: String(msg), expires: Date.now() + 120000 });
      return res.status(200).type('html').send(`<body>${lineHtmlEscMonitor(msg)}</body>`);
    }
    const lineSub = String(vj.sub).trim();
    let v2User = null;
    try {
      v2User = await firebaseQuery('users', 'lineUserId', lineSub);
    } catch (e) {
      console.error('[line-login-callback] Firestore:', e.message);
    }
    if (!v2User) {
      LINE_LOGIN_POLL.set(state, {
        error: 'ไม่พบบัญชีที่ผูก LINE นี้ — ผูกบัญชีที่ลิงก์ของสหกรณ์ก่อน',
        expires: Date.now() + 120000
      });
      return res
        .status(200)
        .type('html')
        .send(
          '<body style="font-family:sans-serif;padding:1.5rem;text-align:center"><p>บัญชี LINE นี้ยังไม่ได้ผูกกับผู้ใช้ในระบบ</p></body>'
        );
    }
    if (!v2UserMayAccessMonitorLine(v2User)) {
      LINE_LOGIN_POLL.set(state, { error: 'บัญชีนี้ไม่มีสิทธิ์เข้าแอป Monitor', expires: Date.now() + 120000 });
      return res
        .status(200)
        .type('html')
        .send('<body style="padding:1.5rem;text-align:center"><p>บัญชีนี้ไม่มีสิทธิ์เข้าแอป</p></body>');
    }
    const sessionName = String(v2User.username || v2User.id || '').trim() || 'user';
    const token = crypto.randomBytes(24).toString('hex');
    monitorSessionsSet(token, {
      username: sessionName,
      createdAt: Date.now(),
      fullname: v2User.fullname != null ? String(v2User.fullname).trim() : '',
      email: v2User.email != null ? String(v2User.email).trim() : '',
      group: v2User.group != null ? String(v2User.group).trim() : '',
      role: v2User.role != null ? String(v2User.role).trim() : ''
    });
    LINE_LOGIN_POLL.set(state, { token, username: sessionName, expires: Date.now() + 120000 });
    const back = `${returnOrigin}/login.html?line_resume=1&state=${encodeURIComponent(state)}`;
    return res.status(200).type('html').send(
      '<!DOCTYPE html><html lang="th"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width">' +
        '<title>เข้าสู่ระบบแล้ว</title></head><body style="font-family:sans-serif;padding:2rem;text-align:center;background:#0d0f14;color:#e8eaed">' +
        '<p style="font-size:1.1rem">เข้าสู่ระบบแล้ว</p><p style="color:#8b8f99">กลับไปที่แอป NKBKConnext</p>' +
        `<script>location.replace(${JSON.stringify(back)});</script></body></html>`
    );
  } catch (e) {
    console.error('[monitor-api line-login-callback]', e);
    LINE_LOGIN_POLL.set(state, { error: (e && e.message) || 'ผิดพลาด', expires: Date.now() + 120000 });
    return res.status(500).type('html').send('<body>เกิดข้อผิดพลาด</body>');
  }
});

// =====================================================
// POST /api/monitor-login
// =====================================================
app.post('/api/monitor-login', async (req, res) => {
  try {
    let username = (req.body && req.body.username != null) ? String(req.body.username).trim() : '';
    const pin = (req.body && req.body.pin != null) ? String(req.body.pin).trim() : '';

    if (!username) {
      return res.status(400).json({ ok: false, message: 'กรุณากรอกชื่อผู้ใช้' });
    }
    if (pin.length !== 6 || !/^\d{6}$/.test(pin)) {
      return res.status(400).json({ ok: false, message: 'รหัส PIN ต้องเป็นตัวเลข 6 หลัก' });
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
        console.error('Monitor login: Firestore timeout');
        return res.status(503).json({
          ok: false,
          message: 'เซิร์ฟเวอร์เชื่อมต่อฐานข้อมูลไม่ได้ (หมดเวลา) — ตรวจสอบการออกเน็ตและ firestore.googleapis.com'
        });
      }
    }

    if (!user || !(user.fullname && String(user.fullname).trim())) {
      return res.status(200).json({ ok: false, message: 'ชื่อผู้ใช้หรือรหัส PIN ไม่ถูกต้อง' });
    }

    const userPin = String(user.pin != null ? user.pin : '').trim();
    if (userPin !== pin.trim()) {
      return res.status(200).json({ ok: false, message: 'ชื่อผู้ใช้หรือรหัส PIN ไม่ถูกต้อง' });
    }

    const g = String(user.group || '').trim();
    const r = String(user.role || '').trim();
    if (g === 'สมาชิก') {
      return res.status(200).json({
        ok: false,
        message: 'บัญชีนี้ไม่มีสิทธิ์เข้าแอป Monitor (เฉพาะเจ้าหน้าที่/กรรมการ/ผู้ดูแลระบบ)'
      });
    }
    if (g !== 'เจ้าหน้าที่' && g !== 'กรรมการ' && r !== 'ผู้ดูแลระบบ' && r !== 'แอดมิน' && r.indexOf('ผู้ดูแล') < 0 && g) {
      return res.status(200).json({ ok: false, message: 'บัญชีนี้ไม่มีสิทธิ์เข้าแอป Monitor' });
    }

    const token = crypto.randomBytes(24).toString('hex');
    const sessionName = String(user.username || username).trim() || username;
    monitorSessionsSet(token, {
      username: sessionName,
      createdAt: Date.now(),
      fullname: user.fullname != null ? String(user.fullname).trim() : '',
      email: user.email != null ? String(user.email).trim() : '',
      group: user.group != null ? String(user.group).trim() : '',
      role: user.role != null ? String(user.role).trim() : ''
    });

    res.status(200).json({ ok: true, token, username: sessionName });
  } catch (error) {
    console.error('Monitor login error:', error.message);
    res.status(500).json({ ok: false, message: 'เกิดข้อผิดพลาด กรุณาลองใหม่' });
  }
});

// =====================================================
// หน้าแสดงรายการเครื่อง (ระบุ route ชัด — กันพลาดเมื่อ static ไม่ทำงาน)
// =====================================================
app.get('/workstations.html', (req, res) => {
  const filePath = path.join(__dirname, 'public', 'workstations.html');
  res.sendFile(filePath, (err) => {
    if (err) {
      console.error('[workstations] ไม่พบไฟล์:', filePath, err.message);
      res
        .status(404)
        .type('html')
        .send(
          '<!DOCTYPE html><meta charset="utf-8"><body style="font-family:sans-serif;padding:1rem">' +
            '<h1>404 — ไม่มี workstations.html</h1>' +
            '<p>อัปโหลดไฟล์ <code>public/workstations.html</code> จากโปรเจกต์ monitor-api ขึ้นโฟลเดอร์เดียวกับ <code>server.js</code></p>' +
            '<p>และรีสตาร์ท Node.js</p></body>'
        );
    }
  });
});

// =====================================================
// Static (ไฟล์อื่นใน public)
// =====================================================
app.use(express.static(path.join(__dirname, 'public')));

// =====================================================
// Start / Passenger
// =====================================================
// Passenger รอให้แอปเรียก listen() — ใช้ app.listen('passenger') (reverse port binding)
// อ้างอิง: https://www.phusionpassenger.com/library/indepth/nodejs/reverse_port_binding.html
console.log(
  '[Monitor API boot]',
  'MONITOR_API_BASE_PATH=',
  MONITOR_API_BASE_PATH || '(ว่าง)',
  !MONITOR_API_BASE_PATH && !MONITOR_API_NO_AUTO_STRIP
    ? '| path ที่ขึ้นต้น /monitor-api/ จะถูกตัดอัตโนมัติ'
    : '',
  '| cwd=',
  process.cwd(),
  '| __dirname=',
  __dirname
);

module.exports = app;

/** Phusion อาจแนบเป็น PhusionPassenger (ไม่ใช่แค่ global.PhusionPassenger) — ดู reverse_port_binding docs */
function getPhusionPassenger() {
  if (typeof PhusionPassenger !== 'undefined' && PhusionPassenger) return PhusionPassenger;
  if (typeof globalThis !== 'undefined' && globalThis.PhusionPassenger) return globalThis.PhusionPassenger;
  if (typeof global !== 'undefined' && global.PhusionPassenger) return global.PhusionPassenger;
  return null;
}

function passengerEnvLikely() {
  return (
    typeof process.env.PASSENGER_APP_ENV !== 'undefined' ||
    typeof process.env.PASSENGER_INSTANCE_REGISTRY_DIR !== 'undefined' ||
    String(process.env.PASSENGER_USE_FEEDBACK || '').length > 0
  );
}

function logRoutesHint(p) {
  if (MONITOR_SYSTEM_UPLOAD_SECRET) {
    console.log(`[snapshots] POST ${p}/api/monitor-system-snapshot — เปิดรับอัปโหลดจากแอป Monitor`);
  } else {
    console.log('[snapshots] ยังไม่ตั้ง MONITOR_SYSTEM_UPLOAD_SECRET — ปิดรับอัปโหลดสเปก');
  }
  if (MONITOR_SYSTEM_PUBLIC_READ_KEY) {
    console.log(`[snapshots] GET ${p}/workstations.html?key=*** — ดูรายการเครื่องบนเว็บ`);
  } else {
    console.log('[snapshots] ยังไม่ตั้ง MONITOR_SYSTEM_PUBLIC_READ_KEY — ปิดดูรายการทางเว็บ');
  }
}

const _basePathHint = MONITOR_API_BASE_PATH || '';

const psg = getPhusionPassenger();
const usePassengerSocket = psg || passengerEnvLikely();

if (usePassengerSocket) {
  if (psg && typeof psg.configure === 'function') {
    try {
      psg.configure({ autoInstall: false });
    } catch (e) {
      console.warn('[Monitor API] PhusionPassenger.configure:', e.message);
    }
  }
  app.listen('passenger', () => {
    logRoutesHint(_basePathHint);
  });
  console.log(
    '[Monitor API] app.listen("passenger")',
    psg ? '(PhusionPassenger object)' : '(Passenger env hints only)'
  );
  console.log(`Health (path บนโดเมน): ...${_basePathHint || ''}/`);
} else if (require.main === module) {
  const port = Number(process.env.PORT) || PORT;
  app.listen(port, '0.0.0.0', () => {
    console.log(`NKBK Monitor API listening on port ${port}${_basePathHint ? ` (base path: ${_basePathHint})` : ''}`);
    console.log(`Health: http://localhost:${port}${_basePathHint || ''}/`);
    console.log(`Monitor login: POST http://localhost:${port}${_basePathHint}/api/monitor-login`);
    logRoutesHint(_basePathHint);
  });
} else {
  // ถูก require โดย Plesk (require.main ไม่ใช่ไฟล์นี้) — UI มักไม่มี PASSENGER_*; ห้าม listen("passenger") นอก Passenger จะ EACCES
  // Phusion ระบุว่า Passenger hook listen() แรกแม้ใส่พอร์ตตัวเลข — เลยใช้พอร์ตจาก env หรือค่าเริ่มต้น
  const port = Number(process.env.PORT) || PORT;
  app.listen(port, '0.0.0.0', () => {
    console.log(`[Monitor API] listen(${port}) — โหลดเป็นโมดูล (ให้ Passenger hook ถ้ามี)`);
    logRoutesHint(_basePathHint);
  });
}
