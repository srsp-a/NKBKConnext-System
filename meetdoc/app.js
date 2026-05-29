/**
 * Meetdoc SPA — กรรมการ / ผู้อนุมัติ
 */
(function () {
  'use strict';

  const STATUS_LABELS = {
    scheduled: 'กำหนดแล้ว',
    held: 'ประชุมแล้ว',
    report_pending: 'รอรายงาน',
    approval_step1: 'รอผู้จัดการ',
    approval_step2: 'รอเลขาคณะ',
    approval_step3: 'รอประธาน',
    approved: 'อนุมัติแล้ว',
    revision: 'ส่งกลับแก้',
    archived: 'เก็บถาวร',
    draft: 'ร่าง'
  };

  const ROLE_LABELS = {
    manager: 'ผู้จัดการ',
    committee: 'กรรมการ',
    staff: 'เจ้าหน้าที่',
    admin: 'ผู้ดูแล'
  };

  let currentTab = 'home';
  let meetings = [];
  let profile = {};

  function $(id) {
    return document.getElementById(id);
  }

  function showScreen(id) {
    document.querySelectorAll('.screen').forEach((s) => s.classList.remove('active'));
    const el = $(id);
    if (el) el.classList.add('active');
  }

  function toast(msg) {
    const t = $('toast');
    if (!t) return;
    t.textContent = msg;
    t.classList.remove('hidden');
    setTimeout(() => t.classList.add('hidden'), 2800);
  }

  function formatDate(val) {
    if (!val) return '—';
    let dt;
    if (val._seconds) dt = new Date(val._seconds * 1000);
    else if (val.seconds) dt = new Date(val.seconds * 1000);
    else dt = new Date(val);
    if (isNaN(dt.getTime())) return '—';
    return dt.toLocaleDateString('th-TH', { day: 'numeric', month: 'short', year: 'numeric' });
  }

  function esc(s) {
    return String(s || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  function parseHash() {
    const h = (location.hash || '').replace(/^#/, '');
    const m = h.match(/^meeting\/(.+)$/);
    return m ? m[1] : null;
  }

  async function loadMeetings(queueOnly) {
    const q = queueOnly ? '?queue=approval' : '';
    const data = await MeetdocAuth.api('/api/meetdoc/meetings' + q);
    meetings = data.meetings || [];
    profile.meetdocRole = data.meetdocRole;
    return meetings;
  }

  function renderList(container, list) {
    if (!list.length) {
      container.innerHTML = '<p class="empty">ไม่มีรายการ</p>';
      return;
    }
    container.innerHTML = list
      .map(
        (m) =>
          '<article class="meeting-card" data-id="' +
          esc(m.id) +
          '"><h3>' +
          esc(m.title) +
          '</h3><p class="meta">' +
          esc(formatDate(m.meetingDate)) +
          ' · ' +
          esc(m.committeeBoard || '') +
          '</p><span class="status-pill">' +
          esc(STATUS_LABELS[m.status] || m.status) +
          '</span></article>'
      )
      .join('');
    container.querySelectorAll('.meeting-card').forEach((card) => {
      card.addEventListener('click', () => openMeeting(card.getAttribute('data-id')));
    });
  }

  async function renderHome() {
    const root = $('pageRoot');
    await loadMeetings(currentTab === 'queue');
    renderList(root, meetings);
    const tabQ = $('tabQueue');
    if (tabQ) tabQ.style.display = profile.canApprove ? '' : 'none';
  }

  async function openMeeting(id) {
    location.hash = 'meeting/' + id;
    const data = await MeetdocAuth.api('/api/meetdoc/meetings/' + id);
    const m = data.meeting;
    $('detailTitle').textContent = m.title || 'รายละเอียด';
    const root = $('detailRoot');
    let html = '<div class="detail-section"><p><strong>วันที่:</strong> ' + esc(formatDate(m.meetingDate)) + '</p>';
    html += '<p><strong>คณะ:</strong> ' + esc(m.committeeBoard) + '</p>';
    html += '<p><strong>สถานะ:</strong> ' + esc(STATUS_LABELS[m.status] || m.status) + '</p></div>';

    if ((m.agendaItems || []).length) {
      html += '<div class="detail-section"><h4>วาระการประชุม</h4>';
      m.agendaItems.forEach((a) => {
        html += '<div class="agenda-item"><strong>' + (a.order || '') + '.</strong> ' + esc(a.title) + '</div>';
      });
      html += '</div>';
    }

    html += '<div class="detail-section"><h4>เอกสาร PDF</h4>';
    if (m.files && m.files.agenda && m.files.agenda.hasFile) {
      html +=
        '<div class="file-row"><span>วาระการประชุม</span><button type="button" class="btn btn-sm btn-primary md-open-pdf" data-kind="agenda">เปิด</button></div>';
    }
    if (m.files && m.files.report && m.files.report.hasFile) {
      html +=
        '<div class="file-row"><span>รายงานการประชุม</span><button type="button" class="btn btn-sm btn-primary md-open-pdf" data-kind="report">เปิด</button></div>';
    }
    if (!(m.files && (m.files.agenda || m.files.report))) {
      html += '<p class="empty" style="padding:0">ยังไม่มีไฟล์</p>';
    }
    html += '</div>';

    const canApprove =
      profile.canApprove &&
      ((m.status === 'approval_step1' && profile.meetdocRole === 'manager') ||
        (m.status === 'approval_step2' && profile.meetdocRole === 'committee') ||
        (m.status === 'approval_step3' && profile.meetdocRole === 'committee') ||
        profile.meetdocRole === 'admin');

    if (canApprove && m.status && m.status.startsWith('approval_')) {
      html += '<div class="detail-section"><h4>การอนุมัติ</h4>';
      const step = m.status === 'approval_step1' ? 1 : m.status === 'approval_step2' ? 2 : 3;
      html +=
        '<button type="button" class="btn btn-approve" id="btnApprove" data-step="' +
        step +
        '">อนุมัติขั้น ' +
        step +
        '</button>';
      html += '<button type="button" class="btn btn-reject" id="btnReject">ส่งกลับแก้</button></div>';
    }

    root.innerHTML = html;
    showScreen('detailScreen');

    root.querySelectorAll('.md-open-pdf').forEach((btn) => {
      btn.addEventListener('click', async () => {
        try {
          const kind = btn.getAttribute('data-kind');
          const f = await MeetdocAuth.api('/api/meetdoc/meetings/' + id + '/file?kind=' + kind);
          if (f.url) window.open(f.url, '_blank', 'noopener');
        } catch (e) {
          toast(e.message || 'เปิดไฟล์ไม่สำเร็จ');
        }
      });
    });

    const appr = $('btnApprove');
    if (appr)
      appr.addEventListener('click', async () => {
        const step = parseInt(appr.getAttribute('data-step'), 10);
        try {
          await MeetdocAuth.api('/api/meetdoc/meetings/' + id + '/approve', {
            method: 'POST',
            body: { step }
          });
          toast('อนุมัติแล้ว');
          await openMeeting(id);
          await renderHome();
        } catch (e) {
          toast(e.message || 'อนุมัติไม่สำเร็จ');
        }
      });

    const rej = $('btnReject');
    if (rej)
      rej.addEventListener('click', async () => {
        if (!confirm('ส่งกลับแก้รายงาน?')) return;
        try {
          await MeetdocAuth.api('/api/meetdoc/meetings/' + id + '/reject', { method: 'POST', body: {} });
          toast('ส่งกลับแก้แล้ว');
          history.back();
          await renderHome();
        } catch (e) {
          toast(e.message || 'ดำเนินการไม่สำเร็จ');
        }
      });
  }

  function bindUi() {
    $('btnPinLogin').addEventListener('click', async () => {
      const err = $('loginError');
      err.classList.add('hidden');
      try {
        await MeetdocAuth.loginPin($('inpUsername').value.trim(), $('inpPin').value.trim());
        await enterApp();
      } catch (e) {
        let msg = e.message || 'เข้าสู่ระบบไม่สำเร็จ';
        if (msg === 'login_failed') msg = 'ชื่อผู้ใช้หรือรหัส PIN ไม่ถูกต้อง';
        err.textContent = msg;
        err.classList.remove('hidden');
      }
    });

    $('btnLineLogin').addEventListener('click', async () => {
      const err = $('loginError');
      err.classList.add('hidden');
      try {
        await MeetdocAuth.lineLoginFlow();
        await enterApp();
      } catch (e) {
        err.textContent = e.message || 'LINE login failed';
        err.classList.remove('hidden');
      }
    });

    $('btnLogout').addEventListener('click', () => {
      MeetdocAuth.clearSession();
      if (typeof liff !== 'undefined' && liff.isLoggedIn && liff.isLoggedIn()) liff.logout();
      location.hash = '';
      showScreen('loginScreen');
    });

    $('btnBack').addEventListener('click', () => {
      location.hash = '';
      showScreen('appScreen');
      renderHome();
    });

    document.querySelectorAll('.tab').forEach((tab) => {
      tab.addEventListener('click', () => {
        document.querySelectorAll('.tab').forEach((t) => t.classList.remove('active'));
        tab.classList.add('active');
        currentTab = tab.getAttribute('data-tab');
        renderHome();
      });
    });
  }

  async function enterApp() {
    profile = MeetdocAuth.getProfile();
    try {
      const probe = await MeetdocAuth.api('/api/meetdoc/meetings');
      if (probe.canManage != null) profile.canManage = !!probe.canManage;
    } catch (_) {}
    if (profile.canManage && global.MeetdocManage) {
      try {
        await MeetdocManage.enter(profile);
        return;
      } catch (e) {
        console.error('[Meetdoc] manage mode failed', e);
        toast(e.message || 'โหลดโหมดจัดการไม่สำเร็จ — ใช้มุมมองอ่านอย่างเดียว');
      }
    }
    $('headerName').textContent = profile.fullname || profile.username || '—';
    $('headerRole').textContent = ROLE_LABELS[profile.meetdocRole] || profile.meetdocRole || '—';
    showScreen('appScreen');
    const mid = parseHash();
    if (mid) await openMeeting(mid);
    else await renderHome();
  }

  async function boot() {
    bindUi();
    try {
      if (location.search.indexOf('liff.state') >= 0 || (typeof liff !== 'undefined' && !MeetdocAuth.getToken())) {
        try {
          await MeetdocAuth.initLiff();
          if (liff.isLoggedIn()) {
            const p = await liff.getProfile();
            await MeetdocAuth.loginLine(p.userId);
            await enterApp();
            return;
          }
        } catch (_) {}
      }
      if (await MeetdocAuth.restoreSession()) {
        profile = MeetdocAuth.getProfile();
        await enterApp();
        return;
      }
    } catch (_) {}
    showScreen('loginScreen');
  }

  window.addEventListener('hashchange', () => {
    const mid = parseHash();
    if (mid && MeetdocAuth.getToken()) openMeeting(mid);
  });

  boot();
})();
