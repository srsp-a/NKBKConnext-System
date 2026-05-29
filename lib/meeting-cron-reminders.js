/**
 * Cron เตือนการประชุมล่วงหน้า 30/15/7/3 วัน + D-1
 */
'use strict';

const meetingNotify = require('./meeting-notify');

function getAdmin() {
  const admin = require('firebase-admin');
  if (!admin.apps.length) {
    admin.initializeApp({ projectId: 'admin-panel-nkbkcoop-cbf10' });
  }
  return admin;
}

function bangkokDayStart(d) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Bangkok',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(d);
  const y = parts.find((p) => p.type === 'year').value;
  const m = parts.find((p) => p.type === 'month').value;
  const day = parts.find((p) => p.type === 'day').value;
  return new Date(`${y}-${m}-${day}T00:00:00+07:00`);
}

function daysUntilMeeting(meetingDate) {
  if (!meetingDate) return null;
  let dt;
  if (meetingDate.toDate) dt = meetingDate.toDate();
  else if (meetingDate._seconds) dt = new Date(meetingDate._seconds * 1000);
  else dt = new Date(meetingDate);
  const today = bangkokDayStart(new Date());
  const meet = bangkokDayStart(dt);
  return Math.round((meet.getTime() - today.getTime()) / 86400000);
}

async function runDailyReminders() {
  const db = getAdmin().firestore();
  const settings = await meetingNotify.loadMeetingSettings();
  const offsets = settings.reminderOffsets || [];
  const wantDayBefore = settings.reminderOnDayBefore !== false;

  const snap = await db
    .collection('committee_meetings')
    .where('status', 'in', ['scheduled', 'held'])
    .limit(200)
    .get();

  const summary = { checked: 0, sent: 0, skipped: 0, errors: [] };

  for (const doc of snap.docs) {
    summary.checked++;
    const data = doc.data();
    const days = daysUntilMeeting(data.meetingDate);
    if (days == null || days < 0) {
      summary.skipped++;
      continue;
    }

    const reminderSent = data.reminderSent || {};
    let templateId = null;
    let key = null;

    if (wantDayBefore && days === 1) {
      templateId = 'meeting_reminder_day_before';
      key = '1';
    } else if (offsets.includes(days)) {
      templateId = 'meeting_reminder';
      key = String(days);
    }

    if (!templateId || !key) {
      summary.skipped++;
      continue;
    }
    if (reminderSent[key]) {
      summary.skipped++;
      continue;
    }

    try {
      const meeting = { id: doc.id, ...data };
      const result = await meetingNotify.sendMeetingNotify({
        templateId,
        meeting,
        channels: { line: true, email: true }
      });

      await doc.ref.set(
        {
          reminderSent: {
            ...reminderSent,
            [key]: getAdmin().firestore.FieldValue.serverTimestamp()
          }
        },
        { merge: true }
      );
      summary.sent++;
      console.log('[meeting-cron]', doc.id, templateId, key, result);
    } catch (e) {
      summary.errors.push({ id: doc.id, error: e.message });
      console.error('[meeting-cron]', doc.id, e.message);
    }
  }

  return summary;
}

module.exports = { runDailyReminders, daysUntilMeeting };
