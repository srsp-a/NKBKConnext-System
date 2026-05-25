/**
 * ปลดล็อคแอปสมาชิกที่ Back Office (nkhadmin.icoopsiam.com) ด้วย Puppeteer
 * ใช้เมื่อสั่งผ่าน LINE (คำสั่ง "ปลดล็อค 7368") — ระบบทำงานที่ backend ไม่ต้องเปิดเบราว์เซอร์
 *
 * Credentials: Firestore config/backoffice_secrets (Admin SDK) → env vars → ไม่มี fallback ในโค้ด
 */

const BACKOFFICE = {
  loginUrl: 'https://nkhadmin.icoopsiam.com/',
  manageUrl: 'https://nkhadmin.icoopsiam.com/mobileadmin/manageuser/manageuseraccount'
};

function normalizeMemberId(memberId) {
  const num = String(memberId || '').replace(/\D/g, '').slice(0, 8);
  return num.padStart(8, '0') || '';
}

const delay = (ms) => new Promise((r) => setTimeout(r, ms));

async function resolveBackofficeCreds() {
  try {
    const { loadBackofficeCredentials } = require('../monitor-api/backoffice-creds');
    const admin = require('firebase-admin');
    if (!admin.apps.length) {
      try {
        admin.initializeApp();
      } catch (e) {
        if (!/already exists/i.test(e.message)) throw e;
      }
    }
    const creds = await loadBackofficeCredentials(admin.firestore());
    if (creds) return creds;
  } catch (e) {
    console.warn('[backoffice-unlock] Firestore creds:', e.message);
  }
  const username = (process.env.BACKOFFICE_USERNAME || '').trim();
  const password = (process.env.BACKOFFICE_PASSWORD || '').trim();
  if (username && password) {
    return {
      username,
      password,
      database: (process.env.BACKOFFICE_DATABASE || 'ฐานข้อมูลหลัก').trim()
    };
  }
  return null;
}

async function runBackOfficeUnlock(memberId) {
  const id8 = normalizeMemberId(memberId);
  if (!id8) {
    return { ok: false, error: 'เลขสมาชิกไม่ถูกต้อง' };
  }

  const loginCreds = await resolveBackofficeCreds();
  if (!loginCreds) {
    return { ok: false, error: 'ยังไม่ได้ตั้งค่า Back Office ใน Admin Panel' };
  }

  let puppeteer;
  try {
    puppeteer = require('puppeteer');
  } catch (e) {
    return { ok: false, error: 'Puppeteer not installed. Run: npm install puppeteer' };
  }

  let browser;
  try {
    browser = await puppeteer.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
    });
    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 800 });
    await page.setDefaultNavigationTimeout(30000);
    await page.setDefaultTimeout(15000);

    await page.goto(BACKOFFICE.manageUrl, { waitUntil: 'networkidle2' }).catch(() => {});

    const loginUser = await page.$('#form-login_username');
    if (loginUser) {
      await page.type('#form-login_username', loginCreds.username, { delay: 50 });
      await page.type('#form-login_password', loginCreds.password, { delay: 50 });
      await Promise.all([
        page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 20000 }).catch(() => {}),
        page.click('button.ant-btn-primary')
      ]);
      await delay(2000);
    }

    await page.goto(BACKOFFICE.manageUrl, { waitUntil: 'networkidle2' }).catch(() => {});
    await delay(1500);

    const searchSel = 'input#search-bar-0, input[placeholder*="ค้นหา"], input.search-table';
    const searchEl = await page.$(searchSel);
    if (!searchEl) {
      await browser.close();
      return { ok: false, error: 'ไม่พบช่องค้นหา (อาจเปลี่ยน selector)' };
    }
    await searchEl.click({ clickCount: 3 });
    await page.type(searchSel, id8, { delay: 80 });
    await page.keyboard.press('Enter');
    await delay(2500);

    const rowSel = 'tr.user-row, table tbody tr';
    await page.waitForSelector(rowSel, { timeout: 8000 }).catch(() => null);
    const rows = await page.$$(rowSel);
    if (!rows || rows.length === 0) {
      await browser.close();
      return { ok: false, error: 'ไม่พบรายการสมาชิกหลังค้นหา' };
    }

    const actionCell = await rows[0].$('td:nth-child(5), td:last-child');
    const menuTrigger = await (actionCell || rows[0]).$('i.anticon, button, [role="button"], .ant-dropdown-trigger');
    if (!menuTrigger) {
      await browser.close();
      return { ok: false, error: 'ไม่พบปุ่มเมนูในแถว' };
    }
    await menuTrigger.click();
    await delay(800);

    const clicked = await page.evaluate(() => {
      const items = Array.from(document.querySelectorAll('li.MuiMenuItem-root, li[role="menuitem"], ul.MuiList-root li, .MuiMenu-list li'));
      const unlock = items.find(el => /ปลดล็อค|ล็อคบัญชี/.test(el.textContent || ''));
      if (unlock) {
        unlock.click();
        return true;
      }
      return false;
    }).catch(() => false);
    if (!clicked) {
      await page.keyboard.press('Escape');
      await browser.close();
      return { ok: false, error: 'ไม่พบเมนูปลดล็อค/ล็อคบัญชี' };
    }
    await delay(1500);
    await browser.close();

    return { ok: true, memberId: id8 };
  } catch (err) {
    if (browser) await browser.close().catch(() => {});
    return { ok: false, error: err.message || String(err) };
  }
}

module.exports = { runBackOfficeUnlock, normalizeMemberId };
