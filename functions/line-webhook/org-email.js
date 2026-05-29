/**
 * ส่งอีเมลองค์กรผ่าน Cloudflare Email Sending API
 * POST /v1/send, /v1/send/test, GET /v1/health
 */
const https = require('https');

const PROJECT_ID = 'admin-panel-nkbkcoop-cbf10';

const DEFAULT_TEMPLATES = {
  leave_request: {
    subject: '[{{org_name}}] คำขอลาใหม่ — {{user_name}}',
    html: '<p>มีคำขอลาใหม่จาก {{user_name}} ({{leave_type}}) วันที่ {{leave_dates}}</p>'
  },
  leave_approved: {
    subject: '[{{org_name}}] อนุมัติการลาแล้ว',
    html: '<p>คำขอลาของคุณได้รับการอนุมัติแล้ว ({{leave_type}}) {{leave_dates}}</p>'
  },
  leave_rejected: {
    subject: '[{{org_name}}] ไม่อนุมัติการลา',
    html: '<p>คำขอลาของคุณไม่ได้รับการอนุมัติ</p>'
  },
  system_expiry: {
    subject: '[{{org_name}}] แจ้งเตือนระบบใกล้หมดอายุ',
    html: '<p>{{message}}</p>'
  },
  welcome: {
    subject: 'ยินดีต้อนรับสู่ {{org_name}}',
    html: '<p>สวัสดี {{user_name}} บัญชีของคุณพร้อมใช้งานแล้ว</p>'
  },
  password_reset: {
    subject: '[{{org_name}}] รีเซ็ตรหัสผ่าน',
    html: '<p>รหัสผ่านชั่วคราว: {{temp_password}}</p>'
  },
  meeting_scheduled: {
    subject: '[{{org_name}}] กำหนดการประชุม — {{meeting_title}}',
    html: meetingEmailHtml('📅 กำหนดการประชุม', '#4F46E5', '#EEF2FF', '#4F46E5', [
      ['หัวข้อ', '{{meeting_title}}'],
      ['วันที่', '{{meeting_date}}'],
      ['เวลา', '{{meeting_time}}'],
      ['คณะ', '{{committee_board}}'],
      ['สถานที่', '{{location}}']
    ], 'ดูรายละเอียดและเอกสารได้ที่ลิงก์ด้านล่าง', true)
  },
  meeting_reminder: {
    subject: '[{{org_name}}] เตือนการประชุม — {{meeting_title}}',
    html: meetingEmailHtml('⏰ เตือนการประชุม', '#EA580C', '#FFEDD5', '#EA580C', [
      ['หัวข้อ', '{{meeting_title}}'],
      ['วันที่', '{{meeting_date}}'],
      ['คณะ', '{{committee_board}}']
    ], 'โปรดเตรียมตัวเข้าร่วมประชุมตามกำหนด', true)
  },
  meeting_reminder_day_before: {
    subject: '[{{org_name}}] พรุ่งนี้มีการประชุม — {{meeting_title}}',
    html: meetingEmailHtml('📌 พรุ่งนี้มีการประชุม', '#DC2626', '#FEE2E2', '#DC2626', [
      ['หัวข้อ', '{{meeting_title}}'],
      ['วันที่', '{{meeting_date}}'],
      ['เวลา', '{{meeting_time}}']
    ], 'เตือนวันก่อนประชุม (D-1)', true)
  },
  meeting_approval_step1: {
    subject: '[{{org_name}}] รอผู้จัดการอนุมัติรายงาน — {{meeting_title}}',
    html: meetingEmailHtml('✅ รออนุมัติ (ผู้จัดการ)', '#D97706', '#FEF3C7', '#D97706', [
      ['หัวข้อ', '{{meeting_title}}'],
      ['คณะ', '{{committee_board}}'],
      ['ขั้นตอน', '{{step_label}}']
    ], 'กรุณาเข้าระบบ Meetdoc เพื่อพิจารณาอนุมัติ', true)
  },
  meeting_approval_step2: {
    subject: '[{{org_name}}] รอเลขาคณะอนุมัติ — {{meeting_title}}',
    html: meetingEmailHtml('✅ รออนุมัติ (เลขาคณะ)', '#0891B2', '#CFFAFE', '#0891B2', [
      ['หัวข้อ', '{{meeting_title}}'],
      ['คณะ', '{{committee_board}}']
    ], 'กรุณาเข้าระบบ Meetdoc เพื่อพิจารณาอนุมัติ', true)
  },
  meeting_approval_step3: {
    subject: '[{{org_name}}] รอประธานอนุมัติ — {{meeting_title}}',
    html: meetingEmailHtml('✅ รออนุมัติ (ประธานคณะ)', '#7C3AED', '#EDE9FE', '#7C3AED', [
      ['หัวข้อ', '{{meeting_title}}'],
      ['คณะ', '{{committee_board}}']
    ], 'กรุณาเข้าระบบ Meetdoc เพื่อพิจารณาอนุมัติ', true)
  },
  meeting_approved: {
    subject: '[{{org_name}}] อนุมัติรายงานครบแล้ว — {{meeting_title}}',
    html: meetingEmailHtml('🎉 อนุมัติครบ 3 ขั้น', '#059669', '#D1FAE5', '#059669', [
      ['หัวข้อ', '{{meeting_title}}'],
      ['วันที่ประชุม', '{{meeting_date}}']
    ], 'รายงานการประชุมได้รับการอนุมัติครบถ้วนแล้ว', true)
  },
  meeting_revision: {
    subject: '[{{org_name}}] ส่งกลับแก้รายงาน — {{meeting_title}}',
    html: meetingEmailHtml('↩️ ส่งกลับแก้รายงาน', '#DC2626', '#FEE2E2', '#DC2626', [
      ['หัวข้อ', '{{meeting_title}}'],
      ['คณะ', '{{committee_board}}']
    ], 'กรุณาแก้ไขรายงานและส่งเข้าสายอนุมัติอีกครั้ง', true)
  }
};

function meetingEmailHtml(title, headerColor, boxBg, borderColor, rows, footerText, withLink) {
  let rowsHtml = '';
  (rows || []).forEach(([label, val]) => {
    rowsHtml += '<p style="margin:6px 0"><strong>' + label + ':</strong> ' + val + '</p>';
  });
  const linkBlock = withLink
    ? '<p style="margin-top:20px"><a href="{{meetdoc_url}}" style="display:inline-block;background:' +
      headerColor +
      ';color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:600">เปิดใน Meetdoc</a></p>'
    : '';
  return (
    '<!DOCTYPE html><html><head><meta charset="utf-8"><style>body{font-family:Sarabun,sans-serif;margin:0;padding:20px;background:#f5f5f5}.container{max-width:600px;margin:0 auto;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 2px 10px rgba(0,0,0,.08)}.header{padding:28px;text-align:center;color:#fff}.content{padding:28px}.info-box{padding:16px;margin:16px 0;border-left:4px solid ' +
    borderColor +
    ';border-radius:0 8px 8px 0;background:' +
    boxBg +
    '}.footer{background:#f9fafb;padding:16px;text-align:center;font-size:12px;color:#6b7280}</style></head><body><div class="container"><div class="header" style="background:linear-gradient(135deg,' +
    headerColor +
    ',' +
    headerColor +
    'dd)"><h1 style="margin:0;font-size:22px">' +
    title +
    '</h1></div><div class="content"><p>เรียน ท่านที่เกี่ยวข้อง,</p><div class="info-box">' +
    rowsHtml +
    '</div><p>' +
    footerText +
    '</p>' +
    linkBlock +
    '</div><div class="footer">{{org_name}}</div></div></body></html>'
  );
}

function json(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}

function parseBody(req) {
  const raw = (req.rawBody || Buffer.alloc(0)).toString('utf8');
  if (!raw) return {};
  return JSON.parse(raw);
}

function getAdmin() {
  const admin = require('firebase-admin');
  if (!admin.apps.length) {
    admin.initializeApp({ projectId: PROJECT_ID });
  }
  return admin;
}

async function verifyAdmin(req) {
  const authHeader = req.headers.authorization || req.headers.Authorization || '';
  if (!authHeader.startsWith('Bearer ')) return null;
  const token = authHeader.slice(7).trim();
  try {
    const decoded = await getAdmin().auth().verifyIdToken(token);
    const db = getAdmin().firestore();
    const uid = decoded.uid;
    if (uid === 'yPyuxPnu9tQmK89OH4NrUBjJ3jb2') return decoded;
    const userDoc = await db.collection('users').doc(uid).get();
    const role = userDoc.exists ? userDoc.data().role : '';
    if (role === 'ผู้ดูแลระบบ' || role === 'แอดมิน' || decoded.admin === true) {
      return decoded;
    }
    return null;
  } catch (e) {
    console.warn('verifyAdmin:', e.message);
    return null;
  }
}

async function getSiteConfig() {
  const snap = await getAdmin().firestore().collection('config').doc('site').get();
  return snap.exists ? snap.data() : {};
}

async function getTemplate(templateType) {
  const snap = await getAdmin().firestore().collection('email_templates').doc(templateType).get();
  if (snap.exists) return snap.data();
  return DEFAULT_TEMPLATES[templateType] || null;
}

function renderTemplate(template, variables) {
  let subject = template.subject || '';
  let html = template.html || '';
  Object.keys(variables || {}).forEach((key) => {
    const re = new RegExp(`\\{\\{${key}\\}\\}`, 'g');
    const val = variables[key] != null ? String(variables[key]) : '';
    subject = subject.replace(re, val);
    html = html.replace(re, val);
  });
  return { subject, html };
}

function cfAccountId() {
  return String(process.env.CLOUDFLARE_ACCOUNT_ID || '').trim();
}

function cfApiToken() {
  return String(process.env.CLOUDFLARE_EMAIL_API_TOKEN || '').trim();
}

function cloudflareConfigured() {
  return !!(cfAccountId() && cfApiToken());
}

function formatFrom(from, fromName) {
  if (!fromName) return from;
  return { address: from, name: fromName };
}

function formatReplyTo(replyTo) {
  if (!replyTo) return undefined;
  const s = String(replyTo).trim();
  if (!s || /^https?:\/\//i.test(s)) return undefined;
  return s;
}

function cloudflareSend({ from, fromName, to, subject, html, replyTo }) {
  return new Promise((resolve, reject) => {
    const accountId = cfAccountId();
    const token = cfApiToken();
    if (!accountId || !token) {
      return reject(new Error('Cloudflare credentials missing'));
    }
    const payload = JSON.stringify({
      from: formatFrom(from, fromName),
      to: Array.isArray(to) ? to : [to],
      subject,
      html,
      reply_to: formatReplyTo(replyTo)
    });
    const req = https.request(
      {
        hostname: 'api.cloudflare.com',
        path: `/client/v4/accounts/${accountId}/email/sending/send`,
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(payload)
        }
      },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          const body = Buffer.concat(chunks).toString('utf8');
          let data;
          try {
            data = JSON.parse(body);
          } catch {
            return reject(new Error(`Cloudflare invalid JSON: ${body.slice(0, 200)}`));
          }
          if (!data.success) {
            const code = data.errors && data.errors[0] && data.errors[0].code;
            const msg = (data.errors && data.errors[0] && data.errors[0].message) || body.slice(0, 300);
            if (code === 10000 || String(msg).includes('sending_disabled')) {
              return reject(
                new Error(
                  'Cloudflare Email Sending ยังไม่เปิด — ไป Email Sending → Onboard Domain → nkbkcoop.com → Add records (ดู docs/PHASE4_CLOUDFLARE_EMAIL_SETUP.md)'
                )
              );
            }
            return reject(new Error(msg));
          }
          resolve(data.result || data);
        });
      }
    );
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

async function sendOrgEmail({ templateType, to, variables, isTest }) {
  if (!cloudflareConfigured()) {
    throw new Error(
      'Cloudflare Email ยังไม่ตั้งค่า — ตั้ง CLOUDFLARE_ACCOUNT_ID และ CLOUDFLARE_EMAIL_API_TOKEN ใน Cloud Functions'
    );
  }
  const site = await getSiteConfig();
  if (site.emailNotif === false && !isTest) {
    return { ok: true, skipped: true, reason: 'emailNotif disabled' };
  }
  const template = await getTemplate(templateType);
  if (!template) throw new Error(`Template not found: ${templateType}`);

  const vars = { ...(variables || {}), org_name: variables?.org_name || site.orgNameTH || 'สหกรณ์ออมทรัพย์สาธารณสุขหนองคาย จำกัด' };
  const { subject, html } = renderTemplate(template, vars);

  const from = String(site.emailFrom || 'support@nkbkcoop.com').trim();
  const fromName = String(site.emailFromName || site.orgNameTH || 'ระบบ NKBK').trim();
  let replyTo = site.emailReplyTo || site.orgEmail || undefined;
  replyTo = formatReplyTo(replyTo);
  const recipients = (Array.isArray(to) ? to : [to]).filter(Boolean);
  if (!recipients.length) throw new Error('No recipients');

  const result = await cloudflareSend({ from, fromName, to: recipients, subject, html, replyTo });

  await getAdmin()
    .firestore()
    .collection('email_logs')
    .add({
      template: templateType,
      to: recipients,
      subject,
      isTest: !!isTest,
      sentAt: getAdmin().firestore.FieldValue.serverTimestamp(),
      provider: 'cloudflare'
    })
    .catch((e) => console.warn('email_logs write:', e.message));

  return { ok: true, result, sent: recipients.length };
}

async function handleRoute(req, res, pathname) {
  if (pathname.endsWith('/v1/health') && req.method === 'GET') {
    json(res, 200, {
      ok: true,
      provider: 'cloudflare',
      configured: cloudflareConfigured()
    });
    return true;
  }

  if (!pathname.includes('/v1/send')) {
    return false;
  }

  if (req.method !== 'POST') {
    json(res, 405, { ok: false, error: 'Method not allowed' });
    return true;
  }

  const user = await verifyAdmin(req);
  if (!user) {
    json(res, 401, { ok: false, error: 'Unauthorized' });
    return true;
  }

  try {
    const body = parseBody(req);
    const isTest = pathname.includes('/v1/send/test');

    if (isTest) {
      const to = body.to || body.testEmail;
      if (!to) {
        json(res, 400, { ok: false, error: 'Missing to' });
        return true;
      }
      const out = await sendOrgEmail({
        templateType: body.template || 'leave_request',
        to: Array.isArray(to) ? to : [to],
        variables: body.variables || { user_name: 'ทดสอบ', leave_type: 'ลากิจ', leave_dates: '2026-05-20' },
        isTest: true
      });
      json(res, 200, out);
      return true;
    }

    const { template, to, variables } = body;
    if (!template || !to) {
      json(res, 400, { ok: false, error: 'Missing template or to' });
      return true;
    }
    const out = await sendOrgEmail({
      templateType: template,
      to: Array.isArray(to) ? to : [to],
      variables: variables || {}
    });
    json(res, 200, out);
    return true;
  } catch (e) {
    console.error('org-email send error:', e.message);
    json(res, 500, { ok: false, error: e.message });
    return true;
  }
}

module.exports = { handleRoute, sendOrgEmail, cloudflareConfigured };
