/**
 * Meetdoc portal API — session + meetings list/approve/PDF
 */
'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const MEETDOC_SESSIONS = new Map();
const SESSION_TTL_MS = 12 * 60 * 60 * 1000;
const PROJECT_ID = 'admin-panel-nkbkcoop-cbf10';
const MEETDOC_STORAGE_BUCKET = 'admin-panel-nkbkcoop-cbf10.firebasestorage.app';

function adminInitOptions(extra) {
  return Object.assign(
    { projectId: PROJECT_ID, storageBucket: MEETDOC_STORAGE_BUCKET },
    extra || {}
  );
}

/**
 * Firebase Admin — ต้องใช้ ADC/cert บน Cloud Functions (ไม่ใช้แค่ projectId)
 * เพื่อ createCustomToken ได้ (signBlob)
 */
function getAdmin() {
  const admin = require('firebase-admin');
  if (admin.apps.length) return admin;

  const onGcp = !!(process.env.K_SERVICE || process.env.FUNCTION_TARGET);
  if (onGcp) {
    admin.initializeApp(
      adminInitOptions({ credential: admin.credential.applicationDefault() })
    );
    return admin;
  }

  const dirs = [
    path.join(__dirname),
    path.join(__dirname, '..'),
    path.join(__dirname, '..', 'monitor-api')
  ];
  for (const dir of dirs) {
    try {
      const files = fs.readdirSync(dir);
      const hit = files.find((f) => /firebase-adminsdk-.+\.json$/i.test(f));
      if (hit) {
        const sa = JSON.parse(fs.readFileSync(path.join(dir, hit), 'utf8'));
        if (sa && sa.private_key) {
          admin.initializeApp(adminInitOptions({ credential: admin.credential.cert(sa) }));
          return admin;
        }
      }
    } catch (_) {}
  }

  admin.initializeApp(adminInitOptions());
  return admin;
}

function sessionGet(token) {
  const t = String(token || '').trim();
  if (!t) return null;
  const s = MEETDOC_SESSIONS.get(t);
  if (!s) return null;
  if (Date.now() - s.createdAt > SESSION_TTL_MS) {
    MEETDOC_SESSIONS.delete(t);
    return null;
  }
  return s;
}

function sessionSet(token, data) {
  MEETDOC_SESSIONS.set(token, { ...data, createdAt: Date.now() });
}

async function findUserByUsername(usernameRaw) {
  const username = String(usernameRaw || '').trim();
  if (!username) return null;
  const db = getAdmin().firestore();
  let q = await db.collection('users').where('username', '==', username).limit(1).get();
  if (!q.empty) return { id: q.docs[0].id, ...q.docs[0].data() };
  const lower = username.toLowerCase();
  const all = await db.collection('users').limit(400).get();
  for (const doc of all.docs) {
    const u = doc.data();
    if (String(u.username || '').toLowerCase() === lower || String(u.email || '').toLowerCase() === lower) {
      return { id: doc.id, ...u };
    }
  }
  return null;
}

async function loadMeetingSettings() {
  const snap = await getAdmin().firestore().collection('config').doc('meetingdocs').get();
  return snap.exists ? snap.data() : {};
}

function resolveMeetdocRole(user, settings) {
  const uid = user.id;
  const role = String(user.role || '').trim();
  const group = String(user.group || '').trim();
  const editors = Array.isArray(settings.editors) ? settings.editors : [];
  if (role === 'ผู้ดูแลระบบ' || role === 'แอดมิน' || role.indexOf('ผู้ดูแล') >= 0) {
    return { role: 'admin', canApprove: false, canEdit: true, canManage: true, approveSteps: [] };
  }
  if (settings.defaultManagerApproverId && uid === settings.defaultManagerApproverId) {
    return { role: 'manager', canApprove: true, canEdit: false, canManage: false, approveSteps: [1] };
  }
  if (editors.includes(uid)) {
    return { role: 'staff', canApprove: false, canEdit: true, canManage: true, approveSteps: [] };
  }
  if (group === 'กรรมการ') {
    return { role: 'committee', canApprove: true, canEdit: false, canManage: false, approveSteps: [2, 3] };
  }
  if (group === 'เจ้าหน้าที่') {
    return { role: 'staff', canApprove: false, canEdit: false, canManage: false, approveSteps: [] };
  }
  return { role: 'viewer', canApprove: false, canEdit: false, canManage: false, approveSteps: [] };
}

function canManageMeetings(user, settings, meetdocRole) {
  if (!user || !meetdocRole) return false;
  if (meetdocRole.canManage) return true;
  const editors = Array.isArray(settings.editors) ? settings.editors : [];
  return editors.includes(user.id);
}

function isMeetingAttendee(user, meeting) {
  const uid = user && user.id;
  if (!uid || !meeting) return false;
  if (meeting.secretaryId === uid || meeting.chairpersonId === uid) return true;
  const attendees = Array.isArray(meeting.attendees) ? meeting.attendees : [];
  return attendees.some((a) => a && String(a.userId || a.id || '') === uid);
}

function membershipInMeetingBoard(user, meeting) {
  const board = String(meeting.committeeBoard || '').trim();
  if (!board) return false;
  const set = String(meeting.committeeSet || '').trim();
  const memberships = Array.isArray(user.committeeMemberships) ? user.committeeMemberships : [];
  const inMembership = memberships.some((m) => {
    const g = String(m.group || m.committeeGroup || '').trim();
    const s = String(m.set || m.committeeSet || '').trim();
    if (g !== board) return false;
    if (!set || !s) return true;
    return s === set;
  });
  if (inMembership) return true;
  const uGroup = String(user.committeeGroup || '').trim();
  const uSet = String(user.committeeSet || '').trim();
  if (uGroup === board) {
    if (!set || !uSet || uSet === set) return true;
  }
  return false;
}

function canReadMeeting(user, meeting, settings, meetdocRole) {
  const vis = meeting.visibility || 'board_members';
  if (meetdocRole.role === 'admin') return true;
  if (canManageMeetings(user, settings, meetdocRole)) return true;
  if (vis === 'admin_only') return false;
  if (isMeetingAttendee(user, meeting)) return true;
  if (vis === 'all_staff' && user.group === 'เจ้าหน้าที่') return true;
  if (user.group === 'กรรมการ' && (vis === 'board_members' || vis === 'all_staff')) {
    return membershipInMeetingBoard(user, meeting);
  }
  return false;
}

function sanitizeMeeting(doc, role) {
  const d = doc;
  const pubStatuses = [
    'scheduled',
    'held',
    'report_pending',
    'approval_step1',
    'approval_step2',
    'approval_step3',
    'approved',
    'archived',
    'revision'
  ];
  if (role.role === 'committee' && !pubStatuses.includes(d.status)) return null;
  return {
    id: d.id,
    title: d.title,
    meetingDate: d.meetingDate,
    startTime: d.startTime,
    endTime: d.endTime,
    location: d.location,
    committeeBoard: d.committeeBoard,
    meetingNo: d.meetingNo,
    status: d.status,
    visibility: d.visibility,
    agendaItems: d.agendaItems || [],
    resolutions: d.resolutions || [],
    files: {
      agenda: d.files && d.files.agenda ? { fileName: d.files.agenda.fileName, hasFile: true } : null,
      report: d.files && d.files.report ? { fileName: d.files.report.fileName, hasFile: true } : null
    },
    approval: d.approval
  };
}

async function createSessionForUser(user, settings) {
  const meetdocRole = resolveMeetdocRole(user, settings);
  if (meetdocRole.role === 'viewer') {
    return { ok: false, message: 'บัญชีนี้ไม่มีสิทธิ์เข้า Meetdoc' };
  }
  const token = crypto.randomBytes(24).toString('hex');
  sessionSet(token, {
    userId: user.id,
    username: user.username || '',
    fullname: user.fullname || '',
    email: user.email || '',
    group: user.group || '',
    role: user.role || '',
    meetdocRole: meetdocRole.role,
    canApprove: meetdocRole.canApprove,
    canManage: meetdocRole.canManage,
    approveSteps: meetdocRole.approveSteps || []
  });
  return {
    ok: true,
    token,
    username: user.username || '',
    fullname: user.fullname || '',
    meetdocRole: meetdocRole.role,
    canApprove: meetdocRole.canApprove,
    canManage: meetdocRole.canManage
  };
}

async function exchangeFromMonitorSession(monitorSession) {
  if (!monitorSession || !monitorSession.username) {
    return { ok: false, message: 'session_expired' };
  }
  const user = await findUserByUsername(monitorSession.username);
  if (!user) return { ok: false, message: 'ไม่พบผู้ใช้ในระบบ' };
  const settings = await loadMeetingSettings();
  return createSessionForUser(user, settings);
}

async function loginWithPin(username, pin) {
  if (!/^\d{6}$/.test(String(pin || '').trim())) {
    return { ok: false, message: 'รหัส PIN ต้องเป็นตัวเลข 6 หลัก' };
  }
  let uname = String(username || '').trim();
  if (/^\d+$/.test(uname)) uname = uname.padStart(6, '0').slice(-6);
  const user = await findUserByUsername(uname);
  if (!user || !user.fullname) {
    return { ok: false, message: 'ชื่อผู้ใช้หรือรหัส PIN ไม่ถูกต้อง' };
  }
  const userPin = String(user.pin != null ? user.pin : '').trim();
  if (userPin !== String(pin).trim()) {
    return { ok: false, message: 'ชื่อผู้ใช้หรือรหัส PIN ไม่ถูกต้อง' };
  }
  const g = String(user.group || '').trim();
  if (g === 'สมาชิก') {
    return { ok: false, message: 'บัญชีนี้ไม่มีสิทธิ์เข้า Meetdoc' };
  }
  const settings = await loadMeetingSettings();
  return createSessionForUser({ ...user, username: user.username || uname }, settings);
}

async function loginWithLine(lineUserId) {
  const db = getAdmin().firestore();
  const q = await db.collection('users').where('lineUserId', '==', lineUserId).limit(1).get();
  if (q.empty) return { ok: false, message: 'ยังไม่ได้ผูกบัญชี LINE — ใช้ชื่อผู้ใช้ + PIN ก่อน' };
  const doc = q.docs[0];
  const user = { id: doc.id, ...doc.data() };
  const settings = await loadMeetingSettings();
  const meetdocRole = resolveMeetdocRole(user, settings);
  if (meetdocRole.role === 'viewer') {
    return { ok: false, message: 'บัญชีนี้ไม่มีสิทธิ์เข้า Meetdoc' };
  }
  const token = crypto.randomBytes(24).toString('hex');
  sessionSet(token, {
    userId: user.id,
    username: user.username || '',
    fullname: user.fullname || '',
    lineUserId,
    meetdocRole: meetdocRole.role,
    canApprove: meetdocRole.canApprove,
    canManage: meetdocRole.canManage,
    approveSteps: meetdocRole.approveSteps || []
  });
  return {
    ok: true,
    token,
    fullname: user.fullname,
    meetdocRole: meetdocRole.role,
    canManage: meetdocRole.canManage
  };
}

async function linkLineAccount(lineUserId, username) {
  const user = await findUserByUsername(username);
  if (!user) return { ok: false, message: 'ไม่พบชื่อผู้ใช้' };
  await getAdmin().firestore().collection('users').doc(user.id).set({ lineUserId }, { merge: true });
  return { ok: true };
}

async function getSessionUser(token) {
  const session = sessionGet(token);
  if (!session) return null;
  const snap = await getAdmin().firestore().collection('users').doc(session.userId).get();
  if (!snap.exists) return null;
  return { session, user: { id: snap.id, ...snap.data() } };
}

async function getManageBootstrap(meetdocToken) {
  const ctx = await getSessionUser(meetdocToken);
  if (!ctx) return { ok: false, message: 'session_expired' };
  const settings = await loadMeetingSettings();
  const meetdocRole = resolveMeetdocRole(ctx.user, settings);
  if (!canManageMeetings(ctx.user, settings, meetdocRole)) {
    return { ok: false, message: 'no_manage_permission' };
  }
  const db = getAdmin().firestore();
  const usersSnap = await db.collection('users').limit(800).get();
  const users = usersSnap.docs.map((doc) => ({ id: doc.id, _firestoreDocId: doc.id, ...doc.data() }));
  let org = {};
  try {
    const orgSnap = await db.collection('config').doc('org').get();
    if (orgSnap.exists) org = orgSnap.data() || {};
  } catch (_) {}
  return {
    ok: true,
    userId: ctx.user.id,
    meetdocRole: meetdocRole.role,
    users,
    committeeSets: org.committeeSets || [],
    committeeGroups: org.committeeGroups || [],
    committeeSetsData: org.committeeSetsData || [],
    committeePositions: org.committeePositions || [],
    meetingSettings: settings
  };
}

async function createFirebaseCustomToken(meetdocToken) {
  const ctx = await getSessionUser(meetdocToken);
  if (!ctx) return { ok: false, message: 'session_expired' };
  const settings = await loadMeetingSettings();
  const meetdocRole = resolveMeetdocRole(ctx.user, settings);
  if (!canManageMeetings(ctx.user, settings, meetdocRole)) {
    return { ok: false, message: 'no_manage_permission' };
  }
  const claims = { admin: true, meetdocManage: true };
  try {
    const customToken = await getAdmin().auth().createCustomToken(ctx.user.id, claims);
    return { ok: true, customToken, uid: ctx.user.id };
  } catch (e) {
    const msg = String(e.message || e);
    console.error('[meetdoc] createCustomToken:', msg);
    if (msg.indexOf('signBlob') >= 0 || msg.indexOf('serviceAccount') >= 0) {
      return { ok: false, message: 'signBlob_denied', detail: msg };
    }
    return { ok: false, message: msg };
  }
}

async function listMeetings(token, opts) {
  const ctx = await getSessionUser(token);
  if (!ctx) return { ok: false, message: 'session_expired' };
  const settings = await loadMeetingSettings();
  const meetdocRole = resolveMeetdocRole(ctx.user, settings);
  const snap = await getAdmin().firestore().collection('committee_meetings').orderBy('meetingDate', 'desc').limit(200).get();
  let items = [];
  snap.docs.forEach((doc) => {
    const m = { id: doc.id, ...doc.data() };
    if (!canReadMeeting(ctx.user, m, settings, meetdocRole)) return;
    const s = sanitizeMeeting(m, meetdocRole);
    if (s) items.push(s);
  });
  if (opts && opts.queue === 'approval') {
    const steps = meetdocRole.approveSteps || [];
    items = items.filter((m) => {
      if (steps.includes(1) && m.status === 'approval_step1') return true;
      if (steps.includes(2) && m.status === 'approval_step2') {
        const bd = (settings.boardDefaults || {})[m.committeeBoard] || {};
        const secId = m.secretaryId || bd.secretaryId;
        return ctx.user.id === secId;
      }
      if (steps.includes(3) && m.status === 'approval_step3') {
        const bd = (settings.boardDefaults || {})[m.committeeBoard] || {};
        const chairId = m.chairpersonId || bd.chairpersonId;
        return ctx.user.id === chairId;
      }
      return false;
    });
  }
  return {
    ok: true,
    meetings: items,
    meetdocRole: meetdocRole.role,
    canManage: canManageMeetings(ctx.user, settings, meetdocRole)
  };
}

async function getMeeting(token, meetingId) {
  const ctx = await getSessionUser(token);
  if (!ctx) return { ok: false, message: 'session_expired' };
  const snap = await getAdmin().firestore().collection('committee_meetings').doc(meetingId).get();
  if (!snap.exists) return { ok: false, message: 'not_found' };
  const m = { id: snap.id, ...snap.data() };
  const settings = await loadMeetingSettings();
  const meetdocRole = resolveMeetdocRole(ctx.user, settings);
  if (!canReadMeeting(ctx.user, m, settings, meetdocRole)) return { ok: false, message: 'forbidden' };
  return { ok: true, meeting: sanitizeMeeting(m, meetdocRole) };
}

async function getSignedFileUrl(token, meetingId, kind) {
  const ctx = await getSessionUser(token);
  if (!ctx) return { ok: false, message: 'session_expired' };
  const snap = await getAdmin().firestore().collection('committee_meetings').doc(meetingId).get();
  if (!snap.exists) return { ok: false, message: 'not_found' };
  const m = snap.data();
  const settings = await loadMeetingSettings();
  const meetdocRole = resolveMeetdocRole(ctx.user, settings);
  if (!canReadMeeting(ctx.user, { ...m, id: meetingId }, settings, meetdocRole)) {
    return { ok: false, message: 'forbidden' };
  }
  const meta = m.files && m.files[kind === 'report' ? 'report' : 'agenda'];
  if (!meta) return { ok: false, message: 'no_file' };
  if (meta.downloadUrl) {
    return { ok: true, url: meta.downloadUrl, fileName: meta.fileName || kind + '.pdf' };
  }
  const path = meta.storagePath;
  if (!path) return { ok: false, message: 'no_file' };
  try {
    const bucket = getAdmin().storage().bucket(MEETDOC_STORAGE_BUCKET);
    const [metadata] = await bucket.file(path).getMetadata();
    const raw =
      metadata &&
      metadata.metadata &&
      (metadata.metadata.firebaseStorageDownloadTokens || metadata.metadata.firebaseStorageDownloadToken);
    const token = raw ? String(raw).split(',')[0].trim() : '';
    if (token) {
      const encoded = encodeURIComponent(path);
      const url =
        'https://firebasestorage.googleapis.com/v0/b/' +
        bucket.name +
        '/o/' +
        encoded +
        '?alt=media&token=' +
        token;
      return { ok: true, url, fileName: meta.fileName || kind + '.pdf' };
    }
    return { ok: false, message: 'no_download_token' };
  } catch (e) {
    return { ok: false, message: e.message || 'file_url_failed' };
  }
}

function emptyApproval() {
  return {
    currentStep: 1,
    steps: { manager: { status: 'pending' }, secretary: { status: 'pending' }, chair: { status: 'pending' } },
    completedAt: null
  };
}

async function approveMeeting(token, meetingId, step) {
  const ctx = await getSessionUser(token);
  if (!ctx) return { ok: false, message: 'session_expired' };
  const settings = await loadMeetingSettings();
  const meetdocRole = resolveMeetdocRole(ctx.user, settings);
  const snap = await getAdmin().firestore().collection('committee_meetings').doc(meetingId).get();
  if (!snap.exists) return { ok: false, message: 'not_found' };
  const m = snap.data();
  const st = parseInt(step, 10);
  if (st === 1) {
    if (settings.defaultManagerApproverId !== ctx.user.id && meetdocRole.role !== 'admin') {
      return { ok: false, message: 'not_approver' };
    }
    if (m.status !== 'approval_step1') return { ok: false, message: 'wrong_status' };
  } else if (st === 2) {
    const bd = (settings.boardDefaults || {})[m.committeeBoard] || {};
    const secId = m.secretaryId || bd.secretaryId;
    if (ctx.user.id !== secId && meetdocRole.role !== 'admin') return { ok: false, message: 'not_approver' };
    if (m.status !== 'approval_step2') return { ok: false, message: 'wrong_status' };
  } else if (st === 3) {
    const bd = (settings.boardDefaults || {})[m.committeeBoard] || {};
    const chairId = m.chairpersonId || bd.chairpersonId;
    if (ctx.user.id !== chairId && meetdocRole.role !== 'admin') return { ok: false, message: 'not_approver' };
    if (m.status !== 'approval_step3') return { ok: false, message: 'wrong_status' };
  } else {
    return { ok: false, message: 'invalid_step' };
  }

  const approval = m.approval || emptyApproval();
  const key = st === 1 ? 'manager' : st === 2 ? 'secretary' : 'chair';
  approval.steps[key] = { status: 'approved', userId: ctx.user.id, at: new Date().toISOString() };
  let newStatus = m.status;
  if (st === 1) {
    approval.currentStep = 2;
    newStatus = 'approval_step2';
  } else if (st === 2) {
    approval.currentStep = 3;
    newStatus = 'approval_step3';
  } else {
    approval.currentStep = 'complete';
    approval.completedAt = getAdmin().firestore.FieldValue.serverTimestamp();
    newStatus = 'approved';
  }

  await snap.ref.update({
    approval,
    status: newStatus,
    updatedAt: getAdmin().firestore.FieldValue.serverTimestamp()
  });
  return { ok: true, status: newStatus };
}

async function rejectMeeting(token, meetingId) {
  const ctx = await getSessionUser(token);
  if (!ctx) return { ok: false, message: 'session_expired' };
  const settings = await loadMeetingSettings();
  const meetdocRole = resolveMeetdocRole(ctx.user, settings);
  const canReject = meetdocRole.role === 'admin' || meetdocRole.role === 'manager' || (meetdocRole.approveSteps || []).length > 0;
  if (!canReject) return { ok: false, message: 'forbidden' };
  const ref = getAdmin().firestore().collection('committee_meetings').doc(meetingId);
  const snap = await ref.get();
  if (!snap.exists) return { ok: false, message: 'not_found' };
  await ref.update({
    status: 'revision',
    updatedAt: getAdmin().firestore.FieldValue.serverTimestamp()
  });
  return { ok: true };
}

module.exports = {
  sessionGet,
  loginWithPin,
  loginWithLine,
  linkLineAccount,
  exchangeFromMonitorSession,
  findUserByUsername,
  listMeetings,
  getMeeting,
  getSignedFileUrl,
  approveMeeting,
  rejectMeeting,
  getSessionUser,
  createFirebaseCustomToken,
  getManageBootstrap,
  loadMeetingSettings,
  getAdmin,
  canManageMeetings,
  MEETDOC_STORAGE_BUCKET,
  resolveMeetdocRole
};
