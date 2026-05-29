/**
 * Meetdoc — โหมดจัดการ (แอดมิน / ผู้รับผิดชอบ) ใช้ MeetingDocs เหมือน admin
 */
(function (global) {
  'use strict';

  const firebaseConfig = {
    apiKey: 'AIzaSyBEUdu_TdTfRvpBpVzdVoHqfQAtrIXAAAw',
    authDomain: 'admin-panel-nkbkcoop-cbf10.firebaseapp.com',
    projectId: 'admin-panel-nkbkcoop-cbf10',
    storageBucket: 'admin-panel-nkbkcoop-cbf10.firebasestorage.app',
    messagingSenderId: '201514361144',
    appId: '1:201514361144:web:e81bf4b50fd782b39d61cd'
  };

  let fbReady = false;

  function $(id) {
    return document.getElementById(id);
  }

  function showScreen(id) {
    document.querySelectorAll('.screen').forEach((s) => s.classList.remove('active'));
    const el = $(id);
    if (el) el.classList.add('active');
  }

  function showToast(msg, type) {
    const t = $('toast');
    if (!t) return;
    t.textContent = msg;
    t.className = 'toast' + (type === 'error' ? ' toast-error' : type === 'success' ? ' toast-ok' : '');
    t.classList.remove('hidden');
    setTimeout(() => t.classList.add('hidden'), 3200);
  }

  global.showToast = showToast;

  global.showConfirm = function (html, title) {
    return Promise.resolve(window.confirm((title ? title + '\n\n' : '') + String(html).replace(/<[^>]+>/g, '')));
  };

  global.callEmailApi = async function () {
    throw new Error('ส่งอีเมลทดสอบจาก Meetdoc ยังไม่รองรับ — ใช้ admin.nkbkcoop.com/meetingdocs');
  };

  global.siteConfig = { orgNameTH: 'สหกรณ์ออมทรัพย์สาธารณสุขหนองคาย จำกัด' };

  global.isAdminSession = function () {
    const p = MeetdocAuth.getProfile();
    return p && (p.meetdocRole === 'admin' || p.canManage);
  };

  function ensureFirebase() {
    if (fbReady) return Promise.resolve();
    if (typeof firebase === 'undefined') {
      return Promise.reject(new Error('Firebase SDK ไม่พร้อม'));
    }
    if (!firebase.apps.length) {
      firebase.initializeApp(firebaseConfig);
    }
    try {
      firebase.firestore().settings({ experimentalAutoDetectLongPolling: true, merge: true });
    } catch (_) {}
    fbReady = true;
    return Promise.resolve();
  }

  async function signInWithMeetdocToken() {
    const data = await MeetdocAuth.api('/api/meetdoc/firebase-token', { method: 'POST', body: {} });
    if (!data.ok || !data.customToken) {
      throw new Error(data.message || 'ไม่สามารถเชื่อม Firebase ได้');
    }
    await firebase.auth().signInWithCustomToken(data.customToken);
    const prof = MeetdocAuth.getProfile();
    prof.firebaseUid = data.uid;
    MeetdocAuth.setSession(MeetdocAuth.getToken(), prof);
  }

  async function loadAdminState() {
    const db = firebase.firestore();
    const usersSnap = await db.collection('users').limit(800).get();
    const users = [];
    usersSnap.forEach((doc) => {
      const d = doc.data();
      users.push({
        id: doc.id,
        _firestoreDocId: doc.id,
        ...d
      });
    });
    let committeeSets = [];
    let committeeGroups = [];
    let committeeSetsData = [];
    try {
      const orgSnap = await db.collection('config').doc('org').get();
      if (orgSnap.exists) {
        const cfg = orgSnap.data() || {};
        committeeSets = Array.isArray(cfg.committeeSets) ? cfg.committeeSets.slice() : [];
        committeeGroups = Array.isArray(cfg.committeeGroups) ? cfg.committeeGroups.slice() : [];
        committeeSetsData = Array.isArray(cfg.committeeSetsData) ? cfg.committeeSetsData.slice() : [];
      }
    } catch (e) {
      console.warn('[MeetdocManage] config/org', e.message);
    }
    global.state = {
      users,
      committeeSets,
      committeeGroups,
      committeeSetsData
    };
  }

  function bindManageHeader(profile) {
    const nameEl = $('manageHeaderName');
    const roleEl = $('manageHeaderRole');
    if (nameEl) nameEl.textContent = profile.fullname || profile.username || '—';
    if (roleEl) {
      roleEl.textContent = profile.meetdocRole === 'admin' ? 'ผู้ดูแล — จัดการเต็มรูปแบบ' : 'ผู้รับผิดชอบ — จัดการวาระ/รายงาน';
    }
    const logout = $('btnManageLogout');
    if (logout && !logout._bound) {
      logout._bound = true;
      logout.addEventListener('click', () => {
        MeetdocAuth.clearSession();
        if (firebase.auth().currentUser) firebase.auth().signOut().catch(() => {});
        if (typeof liff !== 'undefined' && liff.isLoggedIn && liff.isLoggedIn()) liff.logout();
        location.hash = '';
        location.reload();
      });
    }
  }

  async function enter(profile) {
    const root = $('meetingdocs-root');
    if (!root) throw new Error('meetingdocs-root missing');
    root.innerHTML =
      '<p class="manage-loading"><i class="fas fa-spinner fa-spin mr-2"></i>กำลังโหลดระบบจัดการวาระ/รายงาน…</p>';
    showScreen('manageScreen');
    bindManageHeader(profile || MeetdocAuth.getProfile());
    await ensureFirebase();
    await signInWithMeetdocToken();
    await loadAdminState();
    if (global.MeetingDocs && typeof MeetingDocs.init === 'function') {
      await MeetingDocs.init();
    } else {
      root.innerHTML = '<p class="text-red-600 p-6">ไม่พบโมดูล MeetingDocs</p>';
    }
  }

  global.MeetdocManage = { enter };
})(typeof window !== 'undefined' ? window : global);
