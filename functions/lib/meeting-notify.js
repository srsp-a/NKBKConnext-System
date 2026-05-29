/**
 * แจ้งเตือนวาระ/รายงานประชุม — LINE + อีเมล
 * ใช้จาก Cloud Functions cron/trigger และ line-webhook (inject pushFn)
 */
'use strict';

const MEETDOC_BASE = process.env.MEETDOC_PUBLIC_URL || 'https://meetdoc.nkbkcoop.com';

const STATUS_TO_TEMPLATE = {
  scheduled: 'meeting_scheduled',
  approval_step1: 'meeting_approval_step1',
  approval_step2: 'meeting_approval_step2',
  approval_step3: 'meeting_approval_step3',
  approved: 'meeting_approved',
  revision: 'meeting_revision'
};

let _linePusher = null;

function getAdmin() {
  const admin = require('firebase-admin');
  if (!admin.apps.length) {
    admin.initializeApp({ projectId: 'admin-panel-nkbkcoop-cbf10' });
  }
  return admin;
}

function setLinePusher(fn) {
  _linePusher = typeof fn === 'function' ? fn : null;
}

function formatThaiDate(val) {
  if (!val) return '—';
  let dt;
  if (val.toDate) dt = val.toDate();
  else if (val._seconds) dt = new Date(val._seconds * 1000);
  else dt = new Date(val);
  if (isNaN(dt.getTime())) return '—';
  return dt.toLocaleDateString('th-TH', { day: 'numeric', month: 'short', year: 'numeric' });
}

function meetingVars(meeting, extra) {
  const m = meeting || {};
  return {
    meeting_title: m.title || 'การประชุม',
    meeting_date: formatThaiDate(m.meetingDate),
    meeting_time: [m.startTime, m.endTime].filter(Boolean).join('–') || '—',
    committee_board: m.committeeBoard || '—',
    location: m.location || '—',
    meetdoc_url: MEETDOC_BASE + '/#meeting/' + (m.id || ''),
    approver_name: (extra && extra.approver_name) || '',
    step_label: (extra && extra.step_label) || '',
    org_name: (extra && extra.org_name) || 'สหกรณ์ออมทรัพย์สาธารณสุขหนองคาย จำกัด',
    ...(extra || {})
  };
}

function renderLineMessage(templateId, meeting, opts) {
  const test = opts && opts.isTest;
  const prefix = test ? '[ทดสอบ] ' : '';
  const title = meeting ? meeting.title : 'การประชุม';
  const date = meeting ? formatThaiDate(meeting.meetingDate) : formatThaiDate(new Date());
  const board = meeting ? meeting.committeeBoard || '' : '';
  const url = meeting && meeting.id ? '\n' + MEETDOC_BASE + '/#meeting/' + meeting.id : '';
  const lines = {
    meeting_scheduled: prefix + 'กำหนดการประชุม: ' + title + '\nวันที่: ' + date + '\nคณะ: ' + board + url,
    meeting_reminder: prefix + 'เตือนการประชุม: ' + title + '\nวันที่: ' + date + url,
    meeting_reminder_day_before: prefix + 'พรุ่งนี้มีการประชุม: ' + title + url,
    meeting_approval_step1: prefix + 'รอผู้จัดการอนุมัติรายงาน: ' + title + url,
    meeting_approval_step2: prefix + 'รอเลขาคณะอนุมัติรายงาน: ' + title + url,
    meeting_approval_step3: prefix + 'รอประธานคณะอนุมัติรายงาน: ' + title + url,
    meeting_approved: prefix + 'อนุมัติรายงานครบแล้ว: ' + title + url,
    meeting_revision: prefix + 'ส่งกลับแก้รายงาน: ' + title + url
  };
  return lines[templateId] || prefix + title;
}

async function loadMeetingSettings() {
  const snap = await getAdmin().firestore().collection('config').doc('meetingdocs').get();
  const d = snap.exists ? snap.data() : {};
  return {
    defaultManagerApproverId: d.defaultManagerApproverId || '',
    editors: Array.isArray(d.editors) ? d.editors : [],
    boardDefaults: d.boardDefaults || {},
    reminderOffsets: Array.isArray(d.reminderOffsets) ? d.reminderOffsets : [7, 3],
    reminderOnDayBefore: d.reminderOnDayBefore !== false
  };
}

async function loadUserById(userId) {
  if (!userId) return null;
  const db = getAdmin().firestore();
  let snap = await db.collection('users').doc(userId).get();
  if (snap.exists) return { id: snap.id, ...snap.data() };
  const q = await db.collection('users').where('username', '==', userId).limit(1).get();
  if (!q.empty) return { id: q.docs[0].id, ...q.docs[0].data() };
  return null;
}

async function boardMemberUserIds(meeting, settings) {
  const board = meeting.committeeBoard;
  const set = meeting.committeeSet || '';
  if (!board) return [];
  const snap = await getAdmin().firestore().collection('users').limit(500).get();
  const ids = [];
  snap.docs.forEach((doc) => {
    const u = doc.data();
    const memberships = Array.isArray(u.committeeMemberships) ? u.committeeMemberships : [];
    const match = memberships.some((m) => {
      const g = (m.group || m.committeeGroup || '').trim();
      const s = (m.set || m.committeeSet || '').trim();
      return g === board && (!set || !s || s === set);
    });
    if (match || (u.committeeGroup === board && (!set || u.committeeSet === set))) {
      ids.push(doc.id);
    }
  });
  return ids;
}

async function resolveRecipients(meeting, templateId, settings) {
  settings = settings || (await loadMeetingSettings());
  const recipients = [];
  const add = async (userId) => {
    const u = await loadUserById(userId);
    if (u && (u.lineUserId || u.email)) recipients.push(u);
  };

  if (templateId === 'meeting_scheduled' || templateId === 'meeting_reminder' || templateId === 'meeting_reminder_day_before') {
    const memberIds = await boardMemberUserIds(meeting, settings);
    for (const id of memberIds) await add(id);
    for (const eid of settings.editors || []) await add(eid);
    if (meeting.secretaryId) await add(meeting.secretaryId);
    if (meeting.chairpersonId) await add(meeting.chairpersonId);
  } else if (templateId === 'meeting_approval_step1') {
    await add(settings.defaultManagerApproverId);
  } else if (templateId === 'meeting_approval_step2') {
    const bd = (settings.boardDefaults || {})[meeting.committeeBoard] || {};
    await add(meeting.secretaryId || bd.secretaryId);
  } else if (templateId === 'meeting_approval_step3') {
    const bd = (settings.boardDefaults || {})[meeting.committeeBoard] || {};
    await add(meeting.chairpersonId || bd.chairpersonId);
  } else if (templateId === 'meeting_approved' || templateId === 'meeting_revision') {
    for (const eid of settings.editors || []) await add(eid);
    if (meeting.secretaryId) await add(meeting.secretaryId);
    await add(settings.defaultManagerApproverId);
  }

  const seen = new Set();
  return recipients.filter((u) => {
    const k = u.id || u.lineUserId || u.email;
    if (!k || seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

async function sendLineToUser(lineUserId, text) {
  if (!lineUserId || !_linePusher) return { ok: false, reason: 'no_pusher' };
  try {
    await _linePusher(lineUserId, [{ type: 'text', text: String(text).slice(0, 5000) }]);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

async function sendEmailToUser(email, templateId, variables, isTest) {
  if (!email) return { ok: false, reason: 'no_email' };
  try {
    const orgEmail = require('../line-webhook/org-email');
    return await orgEmail.sendOrgEmail({
      templateType: templateId,
      to: email,
      variables,
      isTest: !!isTest
    });
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

async function sendMeetingNotify({ templateId, meeting, meetingId, channels, isTest }) {
  const db = getAdmin().firestore();
  let doc = meeting;
  if (!doc && meetingId) {
    const snap = await db.collection('committee_meetings').doc(meetingId).get();
    if (!snap.exists) return { ok: false, error: 'meeting_not_found' };
    doc = { id: snap.id, ...snap.data() };
  }
  if (!doc || !doc.id) return { ok: false, error: 'no_meeting' };

  const settings = await loadMeetingSettings();
  const recipients = await resolveRecipients(doc, templateId, settings);
  const ch = channels || { line: true, email: true };
  const vars = meetingVars(doc);
  const lineText = renderLineMessage(templateId, doc, { isTest });
  const results = { line: 0, email: 0, errors: [] };

  for (const u of recipients) {
    if (ch.line && u.lineUserId) {
      const r = await sendLineToUser(u.lineUserId, lineText);
      if (r.ok) results.line++;
      else results.errors.push({ user: u.id, channel: 'line', error: r.error || r.reason });
    }
    if (ch.email && u.email) {
      const r = await sendEmailToUser(u.email, templateId, vars, isTest);
      if (r.ok && !r.skipped) results.email++;
      else if (!r.ok) results.errors.push({ user: u.id, channel: 'email', error: r.error });
    }
  }

  return { ok: true, templateId, recipients: recipients.length, ...results };
}

async function onWorkflowStatusChange(meetingId, before, after) {
  const newStatus = after && after.status;
  const oldStatus = before && before.status;
  if (!newStatus || newStatus === oldStatus) return { skipped: true };

  const templateId = STATUS_TO_TEMPLATE[newStatus];
  if (!templateId) return { skipped: true, reason: 'no_template' };

  const db = getAdmin().firestore();
  const ref = db.collection('committee_meetings').doc(meetingId);
  const snap = await ref.get();
  if (!snap.exists) return { ok: false, error: 'not_found' };

  const data = snap.data();
  const sent = data.workflowNotifySent || {};
  if (sent[newStatus]) return { skipped: true, reason: 'already_sent' };

  const meeting = { id: meetingId, ...data };
  const result = await sendMeetingNotify({
    templateId,
    meeting,
    channels: { line: true, email: true }
  });

  await ref.set(
    {
      workflowNotifySent: { ...sent, [newStatus]: getAdmin().firestore.FieldValue.serverTimestamp() }
    },
    { merge: true }
  );

  return { ok: true, templateId, ...result };
}

module.exports = {
  setLinePusher,
  renderLineMessage,
  meetingVars,
  resolveRecipients,
  sendMeetingNotify,
  onWorkflowStatusChange,
  loadMeetingSettings,
  STATUS_TO_TEMPLATE,
  MEETDOC_BASE
};
