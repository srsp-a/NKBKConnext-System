/**

 * Meetdoc auth — PIN + LINE (monitor-api.nkbkcoop.com)

 */

(function (global) {

  'use strict';



  const API_BASE = 'https://monitor-api.nkbkcoop.com';

  const API_FALLBACK = 'https://api-line.nkbkcoop.com';

  const LIFF_ID = '2008951184-zlFZf7gn';

  const TOKEN_KEY = 'meetdoc_token';

  const PROFILE_KEY = 'meetdoc_profile';



  let liffReady = false;



  function getToken() {

    return localStorage.getItem(TOKEN_KEY) || '';

  }



  function setSession(token, profile) {

    localStorage.setItem(TOKEN_KEY, token);

    localStorage.setItem(PROFILE_KEY, JSON.stringify(profile || {}));

  }



  function clearSession() {

    localStorage.removeItem(TOKEN_KEY);

    localStorage.removeItem(PROFILE_KEY);

  }



  function getProfile() {

    try {

      return JSON.parse(localStorage.getItem(PROFILE_KEY) || '{}');

    } catch (_) {

      return {};

    }

  }



  function isStaleLineWebhookBody(data) {

    return data && data.status === 'ok' && data.ok !== true && !data.token;

  }



  async function fetchJson(base, path, opts) {

    const o = opts || {};

    const headers = { 'Content-Type': 'application/json', ...(o.headers || {}) };

    const tok = getToken();

    if (tok) headers['X-Meetdoc-Token'] = tok;

    const res = await fetch(base + path, {

      method: o.method || 'GET',

      headers,

      body: o.body ? JSON.stringify(o.body) : undefined

    });

    const data = await res.json().catch(() => ({}));

    return { res, data };

  }



  async function api(path, opts) {

    const bases = [API_BASE, API_FALLBACK];

    let lastErr = null;

    for (const base of bases) {

      try {

        const { res, data } = await fetchJson(base, path, opts);

        if (isStaleLineWebhookBody(data)) {

          lastErr = new Error('meetdoc_api_not_deployed');

          continue;

        }

        if (!res.ok && data.ok !== true) {

          throw new Error(data.message || 'request_failed');

        }

        return data;

      } catch (e) {

        lastErr = e;

      }

    }

    throw lastErr || new Error('request_failed');

  }



  async function monitorLogin(username, pin) {

    const { res, data } = await fetchJson(API_BASE, '/api/monitor-login', {

      method: 'POST',

      body: { username, pin }

    });

    if (!data || data.ok !== true) {

      throw new Error((data && data.message) || 'ชื่อผู้ใช้หรือรหัส PIN ไม่ถูกต้อง');

    }

    return data;

  }



  async function loginPin(username, pin) {

    let pinError = null;

    try {

      const data = await api('/api/meetdoc-login', {

        method: 'POST',

        body: { username, pin }

      });

      if (data.ok) {

        setSession(data.token, {

          username: data.username,

          fullname: data.fullname,

          meetdocRole: data.meetdocRole,

          canApprove: data.canApprove,

          canManage: !!data.canManage

        });

        return data;

      }

      pinError = new Error(data.message || 'ชื่อผู้ใช้หรือรหัส PIN ไม่ถูกต้อง');

    } catch (e) {

      if (e.message !== 'meetdoc_api_not_deployed') {

        pinError = e;

      }

    }



    const mon = await monitorLogin(username, pin);

    try {

      const ex = await api('/api/meetdoc-exchange', {

        method: 'POST',

        body: { monitorToken: mon.token }

      });

      if (ex.ok) {

        setSession(ex.token, {

          username: ex.username || mon.username,

          fullname: ex.fullname || mon.fullname,

          meetdocRole: ex.meetdocRole,

          canApprove: ex.canApprove,

          canManage: !!ex.canManage

        });

        return ex;

      }

      pinError = new Error(ex.message || 'ไม่สามารถเปิด session Meetdoc ได้');

    } catch (e2) {

      if (e2.message === 'meetdoc_api_not_deployed') {

        throw new Error(

          'เซิร์ฟเวอร์ยังไม่ได้อัปเดต Meetdoc API — ผู้ดูแลระบบต้อง deploy functions:monitorApi (ดู docs/MEETDOC_DEPLOY.md)'

        );

      }

      throw pinError || e2;

    }

    throw pinError || new Error('เข้าสู่ระบบไม่สำเร็จ');

  }



  async function loginLine(lineUserId) {

    const data = await api('/api/meetdoc-line-login', {

      method: 'POST',

      body: { lineUserId }

    });

    if (!data.ok) throw new Error(data.message || 'ยังไม่ได้ผูกบัญชี LINE — ใช้ชื่อผู้ใช้ + PIN ก่อน');

    setSession(data.token, {

      fullname: data.fullname,

      meetdocRole: data.meetdocRole,

      canApprove: data.canApprove,

      canManage: !!data.canManage

    });

    return data;

  }



  async function initLiff() {

    if (LIFF_ID.indexOf('YOUR_') >= 0) return false;

    await liff.init({ liffId: LIFF_ID });

    liffReady = true;

    return true;

  }



  async function lineLoginFlow() {

    if (!liffReady) await initLiff();

    if (!liff.isLoggedIn()) {

      liff.login({ redirectUri: window.location.href.split('#')[0] });

      return null;

    }

    const profile = await liff.getProfile();

    return loginLine(profile.userId);

  }



  async function restoreSession() {

    const tok = getToken();

    if (!tok) return false;

    try {

      const data = await api('/api/meetdoc/meetings');

      if (data.ok) {

        const prof = getProfile();

        if (data.canManage != null) prof.canManage = !!data.canManage;

        setSession(getToken(), prof);

        return true;

      }

    } catch (_) {}

    clearSession();

    return false;

  }



  global.MeetdocAuth = {

    API_BASE,

    getToken,

    getProfile,

    setSession,

    clearSession,

    loginPin,

    loginLine,

    lineLoginFlow,

    initLiff,

    restoreSession,

    api

  };

})(typeof window !== 'undefined' ? window : global);


