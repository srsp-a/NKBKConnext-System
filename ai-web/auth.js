(function () {
  'use strict';

  const TOKEN_KEY = 'nkbk_ai_token';
  const PROFILE_KEY = 'nkbk_ai_profile';
  let liffId = '';
  let linkAccountUrl = 'https://liff.line.me/2008951184-870KgFSE';

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

  function clearLiffSession() {
    try {
      if (typeof liff !== 'undefined' && liff.isLoggedIn && liff.isLoggedIn()) liff.logout();
    } catch (_) {}
  }

  function startLineLogin() {
    if (typeof liff === 'undefined' || !liff.login) {
      showAuthError('LIFF SDK ยังไม่พร้อม');
      return;
    }
    liff.login({ redirectUri: window.location.href.split('#')[0] });
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

  async function loginWithLiffToken(idToken) {
    const r = await fetch('/api/ai-liff-login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ idToken })
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok || !data.ok || !data.token) {
      const msg = data.message || 'เข้าสู่ระบบไม่สำเร็จ';
      const tokenInvalid = r.status === 401 || /token|หมดอายุ|id_token/i.test(msg);
      if (tokenInvalid) {
        clearLiffSession();
        const err = new Error('เซสชัน LINE หมดอายุ — กด「เข้าสู่ระบบด้วย LINE」อีกครั้ง');
        err.tokenExpired = true;
        throw err;
      }
      const needsLink =
        r.status === 403 &&
        /ผูก|link|ไม่พบบัญชี|ยังไม่ได้ผูก/i.test(msg);
      const err = new Error(msg);
      err.needsLinkAccount = needsLink;
      err.linkAccountUrl = data.linkAccountUrl || linkAccountUrl;
      throw err;
    }
    sessionStorage.setItem(TOKEN_KEY, data.token);
    const profile = {
      username: data.username,
      displayName: data.displayName || '',
      pictureUrl: data.pictureUrl || ''
    };
    sessionStorage.setItem(PROFILE_KEY, JSON.stringify(profile));
    return profile;
  }

  async function tryExistingSession() {
    const token = sessionStorage.getItem(TOKEN_KEY);
    if (!token) return false;
    const r = await fetch('/api/nkbk-ai-status', {
      headers: { 'X-Monitor-Token': token },
      cache: 'no-store'
    });
    const data = await r.json().catch(() => ({}));
    if (!data.ok) {
      sessionStorage.removeItem(TOKEN_KEY);
      sessionStorage.removeItem(PROFILE_KEY);
      return false;
    }
    let profile = {};
    try {
      profile = JSON.parse(sessionStorage.getItem(PROFILE_KEY) || '{}');
    } catch (_) {}
    showApp(profile);
    return true;
  }

  async function initLiff() {
    showAuthLoading(true);
    await fetchConfig();
    await liff.init({ liffId, withLoginOnExternalBrowser: true });

    if (!liff.isLoggedIn()) {
      showAuthLoading(false);
      el('authActions')?.classList.remove('hidden');
      return;
    }

    const idToken = liff.getIDToken();
    if (!idToken || isIdTokenExpired(idToken)) {
      clearLiffSession();
      showAuthLoading(false);
      el('authActions')?.classList.remove('hidden');
      showAuthError('เซสชัน LINE หมดอายุ — กด「เข้าสู่ระบบด้วย LINE」อีกครั้ง');
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
      console.error('[auth]', e);
      showAuthError(e.message || 'เชื่อมต่อไม่สำเร็จ', {
        needsLinkAccount: !!e.needsLinkAccount,
        linkAccountUrl: e.linkAccountUrl || linkAccountUrl
      });
    }
  }

  el('btnLineLogin')?.addEventListener('click', () => {
    startLineLogin();
  });

  el('btnAuthRetry')?.addEventListener('click', () => {
    el('authError')?.classList.add('hidden');
    boot();
  });

  el('btnLogout')?.addEventListener('click', async () => {
    const token = sessionStorage.getItem(TOKEN_KEY);
    try {
      if (token) {
        await fetch('/api/monitor-logout', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token })
        });
      }
    } catch (_) {}
    sessionStorage.removeItem(TOKEN_KEY);
    sessionStorage.removeItem(PROFILE_KEY);
    try {
      if (typeof liff !== 'undefined' && liff.isLoggedIn && liff.isLoggedIn()) liff.logout();
    } catch (_) {}
    location.reload();
  });

  boot();
})();
