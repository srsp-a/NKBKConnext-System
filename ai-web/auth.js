(function () {
  'use strict';

  const store = window.NkbkAiAuthStore;
  const LOGIN_GUARD_KEY = 'nkbk_ai_login_guard';
  const LOGIN_GUARD_MAX = 4;
  const LOGIN_GUARD_WINDOW_MS = 120000;

  let liffId = '';
  let linkAccountUrl = 'https://liff.line.me/2008951184-870KgFSE';
  let liffBootPromise = null;

  function el(id) {
    return document.getElementById(id);
  }

  function showAuthLoading(on) {
    const loading = el('authLoading');
    const actions = el('authActions');
    const err = el('authError');
    if (loading) loading.classList.toggle('hidden', !on);
    if (actions) actions.classList.toggle('hidden', on);
    if (err) err.classList.add('hidden');
  }

  function showAuthError(msg, opts) {
    showAuthLoading(false);
    const err = el('authError');
    const msgEl = el('authErrorMsg');
    const linkBtn = el('btnLinkAccount');
    const options = opts && typeof opts === 'object' ? opts : {};
    if (msgEl) msgEl.textContent = msg || 'เกิดข้อผิดพลาด';
    if (linkBtn) {
      const showLink = !!options.needsLinkAccount;
      linkBtn.classList.toggle('hidden', !showLink);
      if (showLink) {
        linkBtn.href = options.linkAccountUrl || linkAccountUrl;
      }
    }
    if (err) err.classList.remove('hidden');
  }

  function showApp(profile) {
    el('authScreen')?.classList.add('hidden');
    el('appRoot')?.classList.remove('hidden');
    if (profile) {
      const name = profile.displayName || profile.username || 'ผู้ใช้';
      ['sidebarProfileName', 'sidebarProfileMenuName'].forEach((id) => {
        const node = el(id);
        if (node) node.textContent = name;
      });
      const initials =
        name.trim().split(/\s+/).length > 1
          ? (name.trim().split(/\s+/)[0][0] + name.trim().split(/\s+/)[1][0]).toUpperCase()
          : name.slice(0, 2).toUpperCase();
      ['sidebarProfileAvatar', 'sidebarProfileMenuAvatar'].forEach((id) => {
        const av = el(id);
        if (!av) return;
        if (profile.pictureUrl) {
          av.innerHTML = '<img src="' + profile.pictureUrl.replace(/"/g, '&quot;') + '" alt="">';
        } else {
          av.textContent = initials || 'U';
        }
      });
    }
    window.dispatchEvent(new CustomEvent('nkbk-ai-auth-ready'));
  }

  function decodeIdTokenPayload(idToken) {
    try {
      const part = String(idToken || '').split('.')[1];
      if (!part) return null;
      const json = atob(part.replace(/-/g, '+').replace(/_/g, '/'));
      return JSON.parse(json);
    } catch (_) {
      return null;
    }
  }

  function isIdTokenExpired(idToken) {
    const payload = decodeIdTokenPayload(idToken);
    if (!payload || !payload.exp) return false;
    return payload.exp * 1000 < Date.now() + 30000;
  }

  /** LIFF redirect URI ต้องตรงกับที่ลงทะเบียน — ห้ามมี query/hash */
  function redirectUri() {
    return window.location.origin + window.location.pathname;
  }

  function cleanAuthUrlParams() {
    try {
      const u = new URL(window.location.href);
      const drop = [
        'code',
        'state',
        'liffClientId',
        'liff.state',
        'liffState',
        'friendship_status_changed',
        'context_token'
      ];
      let changed = false;
      drop.forEach((key) => {
        if (u.searchParams.has(key)) {
          u.searchParams.delete(key);
          changed = true;
        }
      });
      if (changed) {
        const next = u.pathname + (u.searchParams.toString() ? '?' + u.searchParams.toString() : '');
        history.replaceState(null, '', next);
      }
    } catch (_) {}
  }

  function readLoginGuard() {
    try {
      const raw = sessionStorage.getItem(LOGIN_GUARD_KEY);
      if (!raw) return { count: 0, at: 0 };
      const parsed = JSON.parse(raw);
      const at = Number(parsed.at) || 0;
      const count = Number(parsed.count) || 0;
      if (Date.now() - at > LOGIN_GUARD_WINDOW_MS) return { count: 0, at: 0 };
      return { count, at };
    } catch (_) {
      return { count: 0, at: 0 };
    }
  }

  function resetLoginGuard() {
    try {
      sessionStorage.removeItem(LOGIN_GUARD_KEY);
    } catch (_) {}
  }

  function markLoginRedirect() {
    try {
      const g = readLoginGuard();
      sessionStorage.setItem(
        LOGIN_GUARD_KEY,
        JSON.stringify({ count: g.count + 1, at: g.at || Date.now() })
      );
    } catch (_) {}
  }

  function canAutoLineLogin() {
    return readLoginGuard().count < LOGIN_GUARD_MAX;
  }

  function clearLiffSession() {
    try {
      if (typeof liff !== 'undefined' && liff.isLoggedIn && liff.isLoggedIn()) liff.logout();
    } catch (_) {}
  }

  function requestLineLogin() {
    if (typeof liff === 'undefined' || !liff.login) {
      showAuthError('LIFF SDK ยังไม่พร้อม');
      return false;
    }
    if (!canAutoLineLogin()) {
      showAuthLoading(false);
      showAuthError(
        'เข้าสู่ระบบไม่สำเร็จหลายครั้ง — กรุณารอ 1–2 นาที แล้วกด "ลองใหม่" หรือปิดแท็บแล้วเปิดใหม่',
        {}
      );
      return false;
    }
    markLoginRedirect();
    showAuthLoading(true);
    liff.login({ redirectUri: redirectUri() });
    return true;
  }

  function startLineLogin() {
    requestLineLogin();
  }

  async function fetchConfig() {
    const r = await fetch('/api/ai-web-config', { cache: 'no-store' });
    const data = await r.json().catch(() => ({}));
    if (!data.ok) throw new Error(data.message || 'โหลด config ไม่สำเร็จ');
    liffId = String(data.liffId || '').trim();
    if (data.linkAccountUrl) linkAccountUrl = String(data.linkAccountUrl).trim() || linkAccountUrl;
    if (!liffId) throw new Error('ยังไม่ได้ตั้งค่า LIFF ID บนเซิร์ฟเวอร์ (AI_LIFF_ID)');
    return data;
  }

  async function ensureLiffReady() {
    if (liffBootPromise) return liffBootPromise;
    liffBootPromise = (async () => {
      await fetchConfig();
      await liff.init({ liffId, withLoginOnExternalBrowser: true });
    })();
    return liffBootPromise;
  }

  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  async function loginWithLiffToken(idToken, opts) {
    const options = opts && typeof opts === 'object' ? opts : {};
    const r = await fetch('/api/ai-liff-login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ idToken })
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok || !data.ok || !data.token) {
      const msg = data.message || 'เข้าสู่ระบบไม่สำเร็จ';
      const tokenInvalid =
        r.status === 401 || data.code === 'token_expired' || data.code === 'token_invalid';
      if (tokenInvalid && options.allowAutoRelogin !== false) {
        clearLiffSession();
        if (requestLineLogin()) {
          const err = new Error('กำลังเชื่อมต่อ LINE ใหม่...');
          err.tokenExpired = true;
          throw err;
        }
        const err = new Error(msg);
        err.tokenExpired = true;
        throw err;
      }
      const needsLink =
        r.status === 403 &&
        (data.needsLinkAccount || /ผูก|link|ไม่พบบัญชี|ยังไม่ได้ผูก/i.test(msg));
      const err = new Error(msg);
      err.needsLinkAccount = needsLink;
      err.linkAccountUrl = data.linkAccountUrl || linkAccountUrl;
      throw err;
    }
    store.setToken(data.token);
    const profile = {
      username: data.username,
      displayName: data.displayName || '',
      pictureUrl: data.pictureUrl || ''
    };
    store.setProfile(profile);
    resetLoginGuard();
    cleanAuthUrlParams();
    return profile;
  }

  async function verifyMonitorToken(token) {
    const r = await fetch('/api/nkbk-ai-status', {
      headers: { 'X-Monitor-Token': token },
      cache: 'no-store'
    });
    const data = await r.json().catch(() => ({}));
    return { ok: !!(r.ok && data.ok), status: r.status, data };
  }

  async function tryExistingSession() {
    const token = store.getToken();
    if (!token) return false;
    for (let attempt = 0; attempt < 4; attempt++) {
      if (attempt > 0) await sleep(350 * attempt);
      const result = await verifyMonitorToken(token);
      if (result.ok) {
        resetLoginGuard();
        cleanAuthUrlParams();
        showApp(store.getProfile());
        return true;
      }
      if (result.status !== 401 || result.data.reason !== 'no_session') break;
    }
    store.clear();
    return false;
  }

  async function refreshLineSession() {
    await ensureLiffReady();
    if (!liff.isLoggedIn()) {
      showAuthLoading(false);
      el('authActions')?.classList.remove('hidden');
      return false;
    }
    const idToken = liff.getIDToken();
    if (!idToken || isIdTokenExpired(idToken)) {
      clearLiffSession();
      requestLineLogin();
      return false;
    }
    const profile = await loginWithLiffToken(idToken);
    showApp(profile);
    return true;
  }

  async function initLiff() {
    showAuthLoading(true);
    await ensureLiffReady();

    if (!liff.isLoggedIn()) {
      showAuthLoading(false);
      el('authActions')?.classList.remove('hidden');
      return;
    }

    const idToken = liff.getIDToken();
    if (!idToken || isIdTokenExpired(idToken)) {
      clearLiffSession();
      requestLineLogin();
      return;
    }
    const profile = await loginWithLiffToken(idToken);
    showApp(profile);
  }

  async function boot() {
    try {
      if (await tryExistingSession()) return;
      await initLiff();
    } catch (e) {
      if (e && e.tokenExpired) return;
      console.error('[auth]', e);
      if (store.getToken()) {
        store.clear();
        try {
          if (await refreshLineSession()) return;
        } catch (retryErr) {
          if (retryErr && retryErr.tokenExpired) return;
          console.error('[auth] retry', retryErr);
        }
      }
      showAuthError(e.message || 'เชื่อมต่อไม่สำเร็จ', {
        needsLinkAccount: !!e.needsLinkAccount,
        linkAccountUrl: e.linkAccountUrl || linkAccountUrl
      });
    }
  }

  el('btnLineLogin')?.addEventListener('click', () => {
    resetLoginGuard();
    startLineLogin();
  });

  el('btnAuthRetry')?.addEventListener('click', () => {
    resetLoginGuard();
    el('authError')?.classList.add('hidden');
    boot();
  });

  el('btnLogout')?.addEventListener('click', async () => {
    const token = store.getToken();
    try {
      if (token) {
        await fetch('/api/monitor-logout', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token })
        });
      }
    } catch (_) {}
    store.clear();
    resetLoginGuard();
    clearLiffSession();
    location.href = redirectUri();
  });

  boot();
})();
