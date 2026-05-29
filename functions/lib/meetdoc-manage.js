/**
 * Meetdoc manage API — Firestore/Storage ผ่าน Admin SDK (ไม่ต้อง custom token ฝั่ง client)
 */
'use strict';

const COLLECTION = 'committee_meetings';
const CONFIG_DOC = 'meetingdocs';
const PDF_MAX_BYTES = 100 * 1024 * 1024;
const MEETDOC_PUBLIC_API_BASE = 'https://monitor-api.nkbkcoop.com';
/** รอ OpenAI วิเคราะห์ PDF (Cloud Function สูงสุด 300s — เหลือเวลาให้ดาวน์โหลด/แปลง PDF) */
const MEETDOC_AI_OPENAI_TIMEOUT_MS = 270000;

function meetdocBucket() {
  const api = require('./meetdoc-api');
  return api.getAdmin().storage().bucket(api.MEETDOC_STORAGE_BUCKET);
}

function firebaseStorageDownloadUrl(bucketName, storagePath, token) {
  return (
    'https://firebasestorage.googleapis.com/v0/b/' +
    bucketName +
    '/o/' +
    encodeURIComponent(storagePath) +
    '?alt=media&token=' +
    token
  );
}

function meetingDocStoragePath(meeting, meetingId, kind) {
  const fy = meeting.fiscalYear || new Date().getFullYear() + 543;
  return 'meeting-docs/' + fy + '/' + meetingId + '/' + (kind === 'report' ? 'report' : 'agenda') + '.pdf';
}

async function assertManage(token) {
  const api = require('./meetdoc-api');
  if (token && String(token).startsWith('__admin__')) {
    const uid = String(token).slice('__admin__'.length);
    const userSnap = await api.getAdmin().firestore().collection('users').doc(uid).get();
    if (!userSnap.exists) return { ok: false, message: 'session_expired' };
    const user = { id: uid, ...userSnap.data() };
    const settings = await api.loadMeetingSettings();
    const role = api.resolveMeetdocRole(user, settings);
    if (!api.canManageMeetings(user, settings, role)) {
      return { ok: false, message: 'no_manage_permission' };
    }
    return { ok: true, ctx: { user }, settings, role };
  }
  const ctx = await api.getSessionUser(token);
  if (!ctx) return { ok: false, message: 'session_expired' };
  const settings = await api.loadMeetingSettings();
  const role = api.resolveMeetdocRole(ctx.user, settings);
  if (!api.canManageMeetings(ctx.user, settings, role)) {
    return { ok: false, message: 'no_manage_permission' };
  }
  return { ok: true, ctx, settings, role };
}

function stripSentinels(obj) {
  if (!obj || typeof obj !== 'object') return obj;
  if (obj.__serverTimestamp) return require('firebase-admin').firestore.FieldValue.serverTimestamp();
  if (obj._seconds != null && typeof obj._seconds === 'number') {
    const admin = require('firebase-admin');
    const ms = obj._seconds * 1000 + Math.floor((obj._nanoseconds || 0) / 1e6);
    return admin.firestore.Timestamp.fromMillis(ms);
  }
  if (Array.isArray(obj)) return obj.map(stripSentinels);
  const out = {};
  Object.keys(obj).forEach((k) => {
    out[k] = stripSentinels(obj[k]);
  });
  return out;
}

function serializeDoc(data) {
  if (!data) return data;
  return JSON.parse(
    JSON.stringify(data, (_, v) => {
      if (v && typeof v.toDate === 'function') return { _seconds: Math.floor(v.toDate().getTime() / 1000) };
      if (v && v._seconds != null) return v;
      return v;
    })
  );
}

async function getSettings(token) {
  const auth = await assertManage(token);
  if (!auth.ok) return auth;
  const snap = await require('./meetdoc-api').getAdmin().firestore().collection('config').doc(CONFIG_DOC).get();
  return { ok: true, settings: snap.exists ? serializeDoc(snap.data()) : {} };
}

async function saveSettings(token, data) {
  const auth = await assertManage(token);
  if (!auth.ok) return auth;
  const clean = stripSentinels(data || {});
  await require('./meetdoc-api')
    .getAdmin()
    .firestore()
    .collection('config')
    .doc(CONFIG_DOC)
    .set(clean, { merge: true });
  return { ok: true };
}

async function listMeetingsManage(token) {
  const auth = await assertManage(token);
  if (!auth.ok) return auth;
  const db = require('./meetdoc-api').getAdmin().firestore();
  let snap;
  try {
    snap = await db.collection(COLLECTION).orderBy('meetingDate', 'desc').limit(500).get();
  } catch (_) {
    snap = await db.collection(COLLECTION).limit(500).get();
  }
  const meetings = snap.docs.map((d) => serializeDoc({ id: d.id, ...d.data() }));
  meetings.sort((a, b) => {
    const ta = (a.meetingDate && a.meetingDate._seconds) || 0;
    const tb = (b.meetingDate && b.meetingDate._seconds) || 0;
    return tb - ta;
  });
  return { ok: true, meetings };
}

async function createMeeting(token, data) {
  const auth = await assertManage(token);
  if (!auth.ok) return auth;
  const clean = stripSentinels(data || {});
  clean.createdAt = require('firebase-admin').firestore.FieldValue.serverTimestamp();
  clean.updatedAt = clean.createdAt;
  clean.createdBy = auth.ctx.user.id;
  const ref = await require('./meetdoc-api').getAdmin().firestore().collection(COLLECTION).add(clean);
  return { ok: true, id: ref.id };
}

async function updateMeeting(token, meetingId, data, merge) {
  const auth = await assertManage(token);
  if (!auth.ok) return auth;
  const clean = stripSentinels(data || {});
  clean.updatedAt = require('firebase-admin').firestore.FieldValue.serverTimestamp();
  const ref = require('./meetdoc-api').getAdmin().firestore().collection(COLLECTION).doc(meetingId);
  if (merge) await ref.set(clean, { merge: true });
  else await ref.update(clean);
  return { ok: true };
}

async function deleteMeeting(token, meetingId) {
  const auth = await assertManage(token);
  if (!auth.ok) return auth;
  await require('./meetdoc-api').getAdmin().firestore().collection(COLLECTION).doc(meetingId).delete();
  return { ok: true };
}

async function getEmailTemplate(token, templateId) {
  const auth = await assertManage(token);
  if (!auth.ok) return auth;
  const snap = await require('./meetdoc-api')
    .getAdmin()
    .firestore()
    .collection('email_templates')
    .doc(templateId)
    .get();
  return { ok: true, exists: snap.exists, data: snap.exists ? serializeDoc(snap.data()) : null };
}

async function saveEmailTemplate(token, templateId, body) {
  const auth = await assertManage(token);
  if (!auth.ok) return auth;
  await require('./meetdoc-api')
    .getAdmin()
    .firestore()
    .collection('email_templates')
    .doc(templateId)
    .set(
      {
        subject: String(body.subject || '').trim(),
        html: String(body.html || ''),
        updatedAt: require('firebase-admin').firestore.FieldValue.serverTimestamp()
      },
      { merge: true }
    );
  return { ok: true };
}

async function addTestLog(token, entry) {
  const auth = await assertManage(token);
  if (!auth.ok) return auth;
  await require('./meetdoc-api')
    .getAdmin()
    .firestore()
    .collection('meeting_notification_test_logs')
    .add(stripSentinels(entry || {}));
  return { ok: true };
}

function validatePdfBuffer(buf) {
  if (!buf.length) return { ok: false, message: 'empty_file' };
  if (buf.length > PDF_MAX_BYTES) return { ok: false, message: 'pdf_too_large' };
  if (buf.slice(0, 4).toString() !== '%PDF') return { ok: false, message: 'not_pdf' };
  return { ok: true };
}

async function savePdfToStorage(storagePath, buf, downloadToken) {
  const bucket = meetdocBucket();
  await bucket.file(storagePath).save(buf, {
    metadata: {
      contentType: 'application/pdf',
      metadata: { firebaseStorageDownloadTokens: String(downloadToken) }
    },
    resumable: buf.length > 8 * 1024 * 1024
  });
  return firebaseStorageDownloadUrl(bucket.name, storagePath, downloadToken);
}

async function getUploadUrl(token, meetingId, kind, fileName) {
  const auth = await assertManage(token);
  if (!auth.ok) return auth;
  const snap = await require('./meetdoc-api').getAdmin().firestore().collection(COLLECTION).doc(meetingId).get();
  if (!snap.exists) return { ok: false, message: 'not_found' };
  const m = snap.data();
  const kindNorm = kind === 'report' ? 'report' : 'agenda';
  const storagePath = meetingDocStoragePath(m, meetingId, kindNorm);
  const crypto = require('crypto');
  const downloadToken = crypto.randomBytes(16).toString('hex');
  const bucket = meetdocBucket();
  const downloadUrl = firebaseStorageDownloadUrl(bucket.name, storagePath, downloadToken);
  const q = new URLSearchParams({
    kind: kindNorm,
    token: String(token || ''),
    dlToken: downloadToken
  });
  const uploadUrl =
    MEETDOC_PUBLIC_API_BASE +
    '/api/meetdoc/manage/meetings/' +
    encodeURIComponent(meetingId) +
    '/upload-pdf?' +
    q.toString();
  return {
    ok: true,
    uploadUrl,
    downloadUrl,
    storagePath,
    fileName: fileName || (kindNorm === 'report' ? 'report.pdf' : 'agenda.pdf')
  };
}

/** Legacy: client PUT ไฟล์มาที่ uploadUrl แล้วเรียก file-meta แยก */
async function uploadMeetingPdfPut(token, meetingId, kind, pdfBuffer, dlToken) {
  const auth = await assertManage(token);
  if (!auth.ok) return auth;
  const buf = Buffer.isBuffer(pdfBuffer) ? pdfBuffer : Buffer.from(pdfBuffer || []);
  const valid = validatePdfBuffer(buf);
  if (!valid.ok) return valid;
  if (!dlToken) return { ok: false, message: 'missing_dl_token' };
  const snap = await require('./meetdoc-api').getAdmin().firestore().collection(COLLECTION).doc(meetingId).get();
  if (!snap.exists) return { ok: false, message: 'not_found' };
  const m = snap.data();
  const storagePath = meetingDocStoragePath(m, meetingId, kind);
  await savePdfToStorage(storagePath, buf, dlToken);
  return { ok: true, storagePath };
}

async function uploadMeetingPdf(token, meetingId, kind, pdfBuffer, fileName) {
  const auth = await assertManage(token);
  if (!auth.ok) return auth;
  const buf = Buffer.isBuffer(pdfBuffer) ? pdfBuffer : Buffer.from(pdfBuffer || []);
  const valid = validatePdfBuffer(buf);
  if (!valid.ok) return valid;
  const snap = await require('./meetdoc-api').getAdmin().firestore().collection(COLLECTION).doc(meetingId).get();
  if (!snap.exists) return { ok: false, message: 'not_found' };
  const m = snap.data();
  const storagePath = meetingDocStoragePath(m, meetingId, kind);
  const crypto = require('crypto');
  const downloadToken = crypto.randomBytes(16).toString('hex');
  const downloadUrl = await savePdfToStorage(storagePath, buf, downloadToken);
  const saved = await saveFileMeta(token, meetingId, kind, {
    storagePath,
    downloadUrl,
    fileName: fileName || (kind === 'report' ? 'report.pdf' : 'agenda.pdf')
  });
  if (!saved.ok) return saved;
  return {
    ok: true,
    downloadUrl,
    storagePath,
    fileName: fileName || (kind === 'report' ? 'report.pdf' : 'agenda.pdf'),
    version: saved.version
  };
}

async function saveFileMeta(token, meetingId, kind, meta) {
  const auth = await assertManage(token);
  if (!auth.ok) return auth;
  const ref = require('./meetdoc-api').getAdmin().firestore().collection(COLLECTION).doc(meetingId);
  const snap = await ref.get();
  if (!snap.exists) return { ok: false, message: 'not_found' };
  const data = snap.data();
  const files = { ...(data.files || {}) };
  const fileKey = kind === 'report' ? 'report' : 'agenda';
  const fileHistory = { ...(data.fileHistory || {}) };
  const history = Array.isArray(fileHistory[fileKey]) ? fileHistory[fileKey].slice() : [];
  const prev = files[fileKey];
  const version = history.length + 1;
  const admin = require('firebase-admin');
  // Firestore ห้ามใช้ serverTimestamp() ภายใน array (fileHistory.*)
  const uploadedAt = admin.firestore.Timestamp.now();
  const entry = {
    version,
    kind: fileKey,
    action: prev && prev.downloadUrl ? 'replace' : 'upload',
    fileName: meta.fileName || prev?.fileName || fileKey + '.pdf',
    downloadUrl: meta.downloadUrl,
    storagePath: meta.storagePath,
    uploadedAt,
    uploadedBy: auth.ctx.user.id
  };
  history.push(entry);
  fileHistory[fileKey] = history.slice(-40);
  files[fileKey] = {
    storagePath: meta.storagePath,
    downloadUrl: meta.downloadUrl,
    fileName: entry.fileName,
    uploadedAt: entry.uploadedAt,
    uploadedBy: auth.ctx.user.id,
    version
  };
  await ref.update({
    files,
    fileHistory,
    updatedAt: admin.firestore.FieldValue.serverTimestamp()
  });
  return { ok: true, version, fileHistory };
}

function httpsJsonPost(hostname, path, headers, bodyObj) {
  const https = require('https');
  const body = JSON.stringify(bodyObj);
  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        hostname,
        path,
        method: 'POST',
        headers: {
          ...headers,
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(body)
        }
      },
      (res) => {
        let raw = '';
        res.on('data', (c) => (raw += c));
        res.on('end', () => {
          try {
            const j = JSON.parse(raw || '{}');
            if (res.statusCode >= 400) reject(new Error(j.error?.message || j.message || raw.slice(0, 200)));
            else resolve(j);
          } catch (e) {
            reject(e);
          }
        });
      }
    );
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

async function downloadPdfBuffer(storagePath) {
  const bucket = meetdocBucket();
  const [buf] = await bucket.file(storagePath).download();
  return buf;
}

async function extractPdfText(buf) {
  const pdfParse = require('pdf-parse');
  const data = await pdfParse(buf);
  return String(data.text || '').trim();
}

async function analyzeMeetingAgenda(token, meetingId, opts) {
  const auth = await assertManage(token);
  if (!auth.ok) return auth;
  const source = opts && opts.source === 'report' ? 'report' : 'agenda';
  const snap = await require('./meetdoc-api').getAdmin().firestore().collection(COLLECTION).doc(meetingId).get();
  if (!snap.exists) return { ok: false, message: 'not_found' };
  const m = snap.data();
  const fileMeta = m.files && m.files[source];
  if (!fileMeta || !fileMeta.storagePath) {
    return { ok: false, message: 'no_pdf', detail: source };
  }
  let buf;
  try {
    buf = await downloadPdfBuffer(fileMeta.storagePath);
  } catch (e) {
    return { ok: false, message: 'pdf_download_failed', detail: e.message };
  }
  if (buf.length > PDF_MAX_BYTES) return { ok: false, message: 'pdf_too_large' };
  let text = '';
  try {
    text = await extractPdfText(buf);
  } catch (e) {
    return { ok: false, message: 'pdf_parse_failed', detail: e.message };
  }
  if (!text || text.length < 20) return { ok: false, message: 'pdf_empty' };
  let apiKey = '';
  let model = 'gpt-4o-mini';
  try {
    const nkbk = require('./nkbk-ai');
    const db = require('./meetdoc-api').getAdmin().firestore();
    const creds = await nkbk.getOpenAiCredentialsForInternal(db);
    if (creds) {
      apiKey = creds.openaiApiKey;
      model = creds.model || model;
    }
  } catch (e) {
    console.warn('[meetdoc] AI config', e.message);
  }
  if (!apiKey) {
    return {
      ok: false,
      message: 'ai_not_configured',
      detail: 'ตั้งค่า OpenAI API Key ที่ Admin → ตั้งค่า AI แชท'
    };
  }
  const prompt =
    'จากข้อความ PDF วาระ/รายงานการประชุมด้านล่าง ให้สรุปเป็นรายการวาระการประชุมภาษาไทย\n' +
    'ตอบเป็น JSON เท่านั้น: {"agendaItems":[{"order":1,"title":"หัวข้อ","detail":"รายละเอียดสั้นๆ"}]}\n' +
    'แยกหัวข้อตามลำดับในเอกสาร ไม่เกิน 30 รายการ\n\n---\n' +
    text.slice(0, 32000);
  const messages = [
    { role: 'system', content: 'คุณช่วยสรุปวาระการประชุมจากเอกสาร PDF ตอบ JSON ตาม schema ที่กำหนดเท่านั้น' },
    { role: 'user', content: prompt }
  ];
  const nkbk = require('./nkbk-ai');
  const chatOpts = { temperature: 0.2 };
  if (!/^gpt-5|^o[0-9]/i.test(model)) {
    chatOpts.responseFormat = { type: 'json_object' };
  }
  let raw;
  try {
    chatOpts.timeout = MEETDOC_AI_OPENAI_TIMEOUT_MS;
    raw = await nkbk.callOpenAIChat(apiKey, model, messages, 4000, chatOpts);
  } catch (e) {
    const msg = String(e.message || e);
    console.error('[meetdoc] OpenAI', msg);
    return { ok: false, message: 'ai_failed', detail: msg };
  }
  let parsed;
  try {
    parsed = JSON.parse(raw || '{}');
  } catch (_) {
    return { ok: false, message: 'ai_invalid_json' };
  }
  const items = Array.isArray(parsed.agendaItems) ? parsed.agendaItems : [];
  const agendaItems = items
    .map((it, i) => ({
      order: Number(it.order) || i + 1,
      title: String(it.title || '').trim().slice(0, 500),
      detail: String(it.detail || '').trim().slice(0, 4000)
    }))
    .filter((it) => it.title);
  if (!agendaItems.length) return { ok: false, message: 'ai_no_items' };
  return { ok: true, agendaItems, source, analyzedAt: new Date().toISOString() };
}

async function analyzeMeetingAgendaForUid(uid, meetingId, opts) {
  const api = require('./meetdoc-api');
  const settings = await api.loadMeetingSettings();
  const userSnap = await api.getAdmin().firestore().collection('users').doc(uid).get();
  if (!userSnap.exists) return { ok: false, message: 'user_not_found' };
  const user = { id: uid, ...userSnap.data() };
  const role = api.resolveMeetdocRole(user, settings);
  if (!api.canManageMeetings(user, settings, role)) return { ok: false, message: 'no_manage_permission' };
  return analyzeMeetingAgenda('__admin__' + uid, meetingId, opts);
}

module.exports = {
  getSettings,
  saveSettings,
  listMeetingsManage,
  createMeeting,
  updateMeeting,
  deleteMeeting,
  getEmailTemplate,
  saveEmailTemplate,
  addTestLog,
  getUploadUrl,
  uploadMeetingPdf,
  uploadMeetingPdfPut,
  saveFileMeta,
  analyzeMeetingAgenda,
  analyzeMeetingAgendaForUid
};
