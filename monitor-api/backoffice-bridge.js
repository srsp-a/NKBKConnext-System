/**
 * Back Office login + reverse proxy for Admin Panel iframe (icoopsiam)
 */
const https = require('https');
const { URL } = require('url');
const crypto = require('crypto');
const { loadBackofficeCredentials, encryptSecret, decryptSecret } = require('./backoffice-creds');

const BACKOFFICE_ORIGIN = 'https://nkhadmin.icoopsiam.com';
const MANAGE_PATH = '/mobileadmin/manageuser/manageuseraccount';
const SESSION_TTL_MS = 25 * 60 * 1000;

/** @type {Map<string, { cookies: import('puppeteer').Protocol.Network.Cookie[], cookieHeader: string, uid: string, createdAt: number, lastUsed: number }>} */
const sessions = new Map();

const SESSION_CACHE_DOC = 'backoffice_session_cache';

/** Serialize Puppeteer login — avoid concurrent Chromium on one instance */
let _loginQueue = Promise.resolve();

function runLoginExclusive(fn) {
  const run = _loginQueue.then(fn, fn);
  _loginQueue = run.catch(() => {});
  return run;
}

async function persistSessionToFirestore(db, sid, uid, cookies) {
  if (!db || !sid) return;
  try {
    const snap = await db.collection('config').doc(SESSION_CACHE_DOC).get();
    const prev = snap.exists ? snap.data() || {} : {};
    const sessions = { ...(prev.sessions || {}) };
    const byUid = { ...(prev.byUid || {}) };
    const now = Date.now();
    sessions[sid] = {
      uid: String(uid || ''),
      cookiesEnc: encryptSecret(JSON.stringify(cookies || [])),
      expiresAt: now + SESSION_TTL_MS,
      lastUsed: now
    };
    byUid[String(uid || '')] = sid;
    await db.collection('config').doc(SESSION_CACHE_DOC).set(
      { sessions, byUid, updatedAt: new Date() },
      { merge: true }
    );
  } catch (e) {
    console.warn('[backoffice] persist session failed:', e.message);
  }
}

function hydrateSessionRecord(rec) {
  if (!rec || !rec.cookiesEnc) return null;
  try {
    const cookies = JSON.parse(decryptSecret(rec.cookiesEnc));
    if (!Array.isArray(cookies) || !cookies.length) return null;
    const expiresAt = Number(rec.expiresAt) || 0;
    if (expiresAt <= Date.now()) return null;
    return {
      cookies,
      cookieHeader: cookiesToHeader(cookies),
      uid: String(rec.uid || ''),
      createdAt: Number(rec.createdAt) || Date.now(),
      lastUsed: Date.now(),
      expiresAt
    };
  } catch (e) {
    return null;
  }
}

async function loadSessionFromFirestore(db, sid) {
  if (!db || !sid) return null;
  try {
    const snap = await db.collection('config').doc(SESSION_CACHE_DOC).get();
    if (!snap.exists) return null;
    const sessions = (snap.data() || {}).sessions || {};
    return hydrateSessionRecord(sessions[String(sid)]);
  } catch (e) {
    console.warn('[backoffice] load session failed:', e.message);
    return null;
  }
}

async function findValidSessionForUid(db, uid) {
  if (!db || !uid) return null;
  try {
    const snap = await db.collection('config').doc(SESSION_CACHE_DOC).get();
    if (!snap.exists) return null;
    const data = snap.data() || {};
    const sid = data.byUid && data.byUid[String(uid)];
    if (!sid) return null;
    const rec = hydrateSessionRecord((data.sessions || {})[sid]);
    if (!rec || rec.uid !== String(uid)) return null;
    return { sid: String(sid), ...rec };
  } catch (e) {
    return null;
  }
}

async function touchSessionInFirestore(db, sid) {
  if (!db || !sid) return;
  try {
    const snap = await db.collection('config').doc(SESSION_CACHE_DOC).get();
    if (!snap.exists) return;
    const sessions = { ...(snap.data().sessions || {}) };
    const rec = sessions[String(sid)];
    if (!rec) return;
    rec.lastUsed = Date.now();
    sessions[String(sid)] = rec;
    await db.collection('config').doc(SESSION_CACHE_DOC).set({ sessions }, { merge: true });
  } catch (_) {}
}

async function deleteSessionFromFirestore(db, sid, uid) {
  if (!db || !sid) return;
  sessions.delete(String(sid));
  try {
    const snap = await db.collection('config').doc(SESSION_CACHE_DOC).get();
    if (!snap.exists) return;
    const data = snap.data() || {};
    const cached = { ...(data.sessions || {}) };
    const byUid = { ...(data.byUid || {}) };
    delete cached[String(sid)];
    if (uid && byUid[String(uid)] === String(sid)) delete byUid[String(uid)];
    await db.collection('config').doc(SESSION_CACHE_DOC).set({ sessions: cached, byUid }, { merge: true });
  } catch (e) {
    console.warn('[backoffice] delete session failed:', e.message);
  }
}

function validateBackofficeCookies(cookies) {
  const cookieHeader = cookiesToHeader(cookies);
  if (!cookieHeader) return Promise.resolve(false);
  return new Promise((resolve) => {
    const opts = {
      hostname: 'nkhadmin.icoopsiam.com',
      port: 443,
      path: MANAGE_PATH,
      method: 'GET',
      headers: {
        cookie: cookieHeader,
        'accept-encoding': 'identity',
        'user-agent': 'Mozilla/5.0 (compatible; NKBK-BackOffice-Bridge/1.0)'
      },
      timeout: 20000
    };
    const req = https.request(opts, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const body = Buffer.concat(chunks).toString('utf8');
        const hasLogin = /id=["']form-login_username["']|#form-login_username/.test(body);
        const hasSearch = /search-bar-0|search-table|placeholder=["'][^"']*ค้นหา/.test(body);
        resolve(!hasLogin && (hasSearch || (res.statusCode === 200 && body.length > 500 && !hasLogin)));
      });
    });
    req.on('timeout', () => {
      req.destroy();
      resolve(false);
    });
    req.on('error', () => resolve(false));
    req.end();
  });
}

function putSessionInMemory(sid, record) {
  sessions.set(String(sid), {
    cookies: record.cookies,
    cookieHeader: record.cookieHeader,
    uid: record.uid,
    createdAt: record.createdAt || Date.now(),
    lastUsed: Date.now()
  });
}

const delay = (ms) => new Promise((r) => setTimeout(r, ms));

function newSessionId() {
  return crypto.randomBytes(24).toString('hex');
}

function cookiesToHeader(cookies) {
  return (cookies || [])
    .filter((c) => c && c.name)
    .map((c) => `${c.name}=${c.value}`)
    .join('; ');
}

function purgeExpiredSessions() {
  const now = Date.now();
  for (const [sid, s] of sessions.entries()) {
    if (now - s.lastUsed > SESSION_TTL_MS) sessions.delete(sid);
  }
}

function getSession(sid, uid) {
  purgeExpiredSessions();
  let s = sessions.get(String(sid || ''));
  if (!s) return null;
  if (uid && s.uid !== uid) return null;
  if (Date.now() - s.lastUsed > SESSION_TTL_MS) {
    sessions.delete(String(sid));
    return null;
  }
  s.lastUsed = Date.now();
  return s;
}

async function getSessionAsync(db, sid, uid) {
  let s = getSession(sid, uid);
  if (s) return s;
  const loaded = await loadSessionFromFirestore(db, sid);
  if (!loaded) {
    console.warn('[backoffice] session not found:', String(sid || '').slice(0, 8));
    return null;
  }
  if (uid && loaded.uid !== uid) return null;
  putSessionInMemory(sid, loaded);
  return getSession(sid, uid);
}

function isServerlessRuntime() {
  return !!(
    process.env.K_SERVICE ||
    process.env.FUNCTION_TARGET ||
    process.env.AWS_LAMBDA_FUNCTION_NAME ||
    process.env.LAMBDA_TASK_ROOT
  );
}

async function launchBrowserWithChromium() {
  const chromium = require('@sparticuz/chromium');
  const puppeteer = require('puppeteer-core');
  if (typeof chromium.setGraphicsMode === 'function') {
    chromium.setGraphicsMode(false);
  }
  const execPath = await chromium.executablePath();
  return puppeteer.launch({
    args: [...chromium.args, '--disable-dev-shm-usage', '--no-sandbox', '--disable-setuid-sandbox'],
    defaultViewport: chromium.defaultViewport,
    executablePath: execPath,
    headless: typeof chromium.headless === 'boolean' ? chromium.headless : true
  });
}

async function launchBrowserWithPuppeteer() {
  const puppeteer = require('puppeteer');
  return puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
  });
}

async function launchBrowser() {
  if (isServerlessRuntime()) {
    try {
      return await launchBrowserWithChromium();
    } catch (e) {
      throw new Error('Chromium บน Cloud Functions ไม่พร้อม: ' + (e.message || e));
    }
  }
  try {
    return await launchBrowserWithPuppeteer();
  } catch (e) {
    console.warn('[backoffice] puppeteer launch failed, trying @sparticuz/chromium:', e.message);
    return launchBrowserWithChromium();
  }
}

async function selectDatabaseIfNeeded(page, databaseLabel) {
  if (!databaseLabel) return;
  try {
    const selectors = [
      '.ant-select:not(.ant-select-disabled)',
      '[id*="database"] .ant-select',
      'div[class*="database"] .ant-select'
    ];
    let clicked = false;
    for (const sel of selectors) {
      const el = await page.$(sel);
      if (el) {
        await el.click();
        clicked = true;
        break;
      }
    }
    if (!clicked) return;
    await delay(600);
    await page.evaluate((label) => {
      const items = Array.from(
        document.querySelectorAll('.ant-select-item-option, .ant-select-item, [role="option"]')
      );
      const hit =
        items.find((el) => (el.textContent || '').trim() === label) ||
        items.find((el) => (el.textContent || '').includes(label));
      if (hit) hit.click();
    }, databaseLabel);
    await delay(400);
  } catch (e) {
    console.warn('[backoffice] database select skipped:', e.message);
  }
}

async function waitForManagePageReady(page) {
  for (let attempt = 0; attempt < 10; attempt++) {
    const loginUser = await page.$('#form-login_username');
    const searchEl = await page.$(
      'input#search-bar-0, input.search-table, input[placeholder*="ค้นหา"], input[placeholder*="Search"]'
    );
    if (searchEl && !loginUser) return true;
    if (!loginUser && attempt >= 3) return true;
    await delay(1200);
    if (loginUser) {
      await page.click('button.ant-btn-primary').catch(() => {});
      await delay(1500);
    }
    await page.goto(BACKOFFICE_ORIGIN + MANAGE_PATH, { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {});
    await delay(1000);
  }
  return false;
}

async function loginBackOfficeWithPuppeteer(creds) {
  return runLoginExclusive(async () => {
    let browser;
    try {
      browser = await launchBrowser();
      const page = await browser.newPage();
      await page.setViewport({ width: 1280, height: 800 });
      await page.setDefaultNavigationTimeout(45000);
      await page.setDefaultTimeout(25000);

      await page.goto(BACKOFFICE_ORIGIN + '/', { waitUntil: 'domcontentloaded', timeout: 35000 }).catch(() => {});
      await delay(1000);

      const loginUser = await page.$('#form-login_username');
      if (loginUser) {
        await selectDatabaseIfNeeded(page, creds.database);
        await page.click('#form-login_username', { clickCount: 3 }).catch(() => {});
        await page.type('#form-login_username', creds.username, { delay: 40 });
        await page.type('#form-login_password', creds.password, { delay: 40 });
        await Promise.all([
          page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {}),
          page.click('button.ant-btn-primary').catch(() => {})
        ]);
        await delay(2500);
      }

      await page.goto(BACKOFFICE_ORIGIN + MANAGE_PATH, { waitUntil: 'domcontentloaded', timeout: 35000 }).catch(() => {});
      await delay(1500);

      const ok = await waitForManagePageReady(page);
      if (!ok) {
        throw new Error('เข้าสู่ระบบ Back Office ไม่สำเร็จ — ตรวจ user/pass หรือฐานข้อมูล');
      }

      return await page.cookies();
    } finally {
      if (browser) await browser.close().catch(() => {});
    }
  });
}

async function createBackofficeSession(db, uid) {
  const uidStr = String(uid || '');
  const existing = await findValidSessionForUid(db, uidStr);
  if (existing) {
    const cookiesOk = await validateBackofficeCookies(existing.cookies);
    if (cookiesOk) {
      putSessionInMemory(existing.sid, existing);
      await touchSessionInFirestore(db, existing.sid);
      return {
        sid: existing.sid,
        expiresAt: new Date(Number(existing.expiresAt) || Date.now() + SESSION_TTL_MS).toISOString(),
        reused: true
      };
    }
    console.warn('[backoffice] cached session cookies invalid — re-login', existing.sid.slice(0, 8));
    await deleteSessionFromFirestore(db, existing.sid, uidStr);
  }

  const creds = await loadBackofficeCredentials(db);
  if (!creds) {
    throw new Error('ยังไม่ได้ตั้งค่า Back Office — ไปที่ ตั้งค่า → ความปลอดภัย');
  }
  const cookies = await loginBackOfficeWithPuppeteer(creds);
  const sid = newSessionId();
  const record = {
    cookies,
    cookieHeader: cookiesToHeader(cookies),
    uid: uidStr,
    createdAt: Date.now(),
    lastUsed: Date.now(),
    expiresAt: Date.now() + SESSION_TTL_MS
  };
  putSessionInMemory(sid, record);
  await persistSessionToFirestore(db, sid, uidStr, cookies);
  return { sid, expiresAt: new Date(record.expiresAt).toISOString(), reused: false };
}

function getProxyPublicOrigin(req) {
  const env = (process.env.MONITOR_PUBLIC_ORIGIN || '').trim().replace(/\/$/, '');
  if (env) return env;
  const proto = req.headers['x-forwarded-proto'] || req.protocol || 'https';
  const host = req.headers['x-forwarded-host'] || req.get('host');
  return `${proto}://${host}`.replace(/\/$/, '');
}

function normalizeMonitorBasePath() {
  const raw = (process.env.MONITOR_API_BASE_PATH || '').trim().replace(/\/+$/, '');
  if (!raw) return '';
  return raw.startsWith('/') ? raw : `/${raw}`;
}

function buildProxyPrefix(req, sid) {
  const origin = getProxyPublicOrigin(req);
  const bp = normalizeMonitorBasePath();
  return `${origin}${bp}/api/backoffice/proxy/${encodeURIComponent(sid)}`.replace(/([^:])\/{2,}/g, '$1/');
}

/** Root-absolute paths on icoopsiam (Next.js) must go through the proxy prefix */
const PROXY_ROOT_SEGMENTS = '(?:static|_next|mobileadmin|api)';

function rewriteRootAbsolutePaths(text, proxyPrefix) {
  if (!text || !proxyPrefix) return text;
  const esc = proxyPrefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const notProxied = `(?!${esc})`;

  text = text.replace(
    new RegExp(
      `(\\s(?:href|src|action|content|data-src|data-href)=["'])${notProxied}/(${PROXY_ROOT_SEGMENTS})`,
      'gi'
    ),
    `$1${proxyPrefix}/$2`
  );

  text = text.replace(
    new RegExp(`(["'])${notProxied}/(${PROXY_ROOT_SEGMENTS})/`, 'g'),
    `$1${proxyPrefix}/$2/`
  );

  text = text.replace(
    new RegExp(`url\\(\\s*(["']?)${notProxied}/(${PROXY_ROOT_SEGMENTS})`, 'gi'),
    `url($1${proxyPrefix}/$2`
  );

  text = text.replace(
    new RegExp(`(@import\\s+(?:url\\()?\\s*["']?)${notProxied}/(${PROXY_ROOT_SEGMENTS})`, 'gi'),
    `$1${proxyPrefix}/$2`
  );

  return text;
}

function rewriteBody(body, contentType, proxyPrefix, sid) {
  if (!body || !contentType) return body;
  const ct = contentType.toLowerCase();
  const origin = BACKOFFICE_ORIGIN;
  const originEsc = origin.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  let text = body.toString('utf8');

  if (ct.includes('text/html')) {
    const baseHref = `${proxyPrefix}/`;
    if (/<head[^>]*>/i.test(text) && !/<base\s/i.test(text)) {
      text = text.replace(/<head([^>]*)>/i, `<head$1><base href="${baseHref}">`);
    }
  }

  if (ct.includes('text/html') || ct.includes('javascript') || ct.includes('json') || ct.includes('css')) {
    text = text.replace(new RegExp(originEsc, 'g'), proxyPrefix);
    text = rewriteRootAbsolutePaths(text, proxyPrefix);
  }

  if (ct.includes('text/html')) {
    text = text.replace(/<meta[^>]+http-equiv=["']?content-security-policy["']?[^>]*>/gi, '');
  }

  return Buffer.from(text, 'utf8');
}

function filterRequestHeaders(headers, cookieHeader) {
  const out = { ...headers };
  delete out.host;
  delete out.connection;
  delete out.cookie;
  delete out['content-length'];
  if (cookieHeader) out.cookie = cookieHeader;
  out['accept-encoding'] = 'identity';
  return out;
}

function proxyUpstream(targetUrl, req, res, session, proxyPrefix) {
  return new Promise((resolve, reject) => {
    const url = new URL(targetUrl);
    const opts = {
      hostname: url.hostname,
      port: url.port || 443,
      path: url.pathname + url.search,
      method: req.method,
      headers: filterRequestHeaders(req.headers, session.cookieHeader)
    };

    const upstream = https.request(opts, (upRes) => {
      const chunks = [];
      upRes.on('data', (c) => chunks.push(c));
      upRes.on('end', () => {
        let body = Buffer.concat(chunks);
        const ct = upRes.headers['content-type'] || '';
        try {
          body = rewriteBody(body, ct, proxyPrefix, session);
        } catch (e) {
          console.warn('[backoffice] rewrite failed:', e.message);
        }

        const headers = { ...upRes.headers };
        delete headers['content-encoding'];
        delete headers['content-length'];
        delete headers['x-frame-options'];
        delete headers['content-security-policy'];
        headers['content-security-policy'] =
          "frame-ancestors 'self' https://admin.nkbkcoop.com https://*.nkbkcoop.com https://admin-panel-nkbkcoop-cbf10.web.app https://admin-panel-nkbkcoop-cbf10.firebaseapp.com";
        headers['content-length'] = String(body.length);

        if (headers.location) {
          let loc = headers.location;
          if (loc.startsWith(BACKOFFICE_ORIGIN)) {
            loc = proxyPrefix + loc.slice(BACKOFFICE_ORIGIN.length);
          } else if (loc.startsWith('/')) {
            loc = proxyPrefix + loc;
          }
          headers.location = loc;
        }

        res.status(upRes.statusCode || 502);
        Object.entries(headers).forEach(([k, v]) => {
          if (v != null && k.toLowerCase() !== 'transfer-encoding') {
            try {
              res.setHeader(k, v);
            } catch (_) {}
          }
        });
        res.send(body);
        resolve();
      });
    });

    upstream.on('error', reject);

    if (req.method === 'GET' || req.method === 'HEAD') {
      upstream.end();
    } else {
      const bufs = [];
      req.on('data', (c) => bufs.push(c));
      req.on('end', () => {
        const payload = Buffer.concat(bufs);
        if (payload.length) upstream.write(payload);
        upstream.end();
      });
      req.on('error', reject);
    }
  });
}

function originSlash(origin) {
  return origin.replace(/\/$/, '');
}

async function handleProxyRequest(req, res, sid, subPath, db) {
  const session = db ? await getSessionAsync(db, sid) : getSession(sid);
  if (!session) {
    res.status(401).send('Back Office session หมดอายุ — รีเฟรชหน้า จัดการสมาชิกสหกรณ์');
    return;
  }
  if (db) touchSessionInFirestore(db, sid).catch(() => {});

  let path = subPath || '/';
  if (!path.startsWith('/')) path = '/' + path;
  const qIdx = req.url.indexOf('?');
  const qs = qIdx >= 0 ? req.url.slice(qIdx) : '';
  const targetUrl = BACKOFFICE_ORIGIN + path + qs;
  const proxyPrefix = buildProxyPrefix(req, sid);

  try {
    await proxyUpstream(targetUrl, req, res, session, proxyPrefix);
  } catch (e) {
    console.error('[backoffice] proxy error:', e.message);
    if (!res.headersSent) {
      res.status(502).send('Back Office proxy error: ' + (e.message || e));
    }
  }
}

module.exports = {
  BACKOFFICE_ORIGIN,
  MANAGE_PATH,
  SESSION_TTL_MS,
  sessions,
  createBackofficeSession,
  getSession,
  getSessionAsync,
  buildProxyPrefix,
  getProxyPublicOrigin,
  handleProxyRequest,
  loginBackOfficeWithPuppeteer
};
