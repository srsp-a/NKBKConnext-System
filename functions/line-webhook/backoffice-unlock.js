/**
 * ปลดล็อคแอปสมาชิกที่ Back Office (nkhadmin.icoopsiam.com) ด้วย Puppeteer
 * ใช้เมื่อสั่งผ่าน LINE (คำสั่ง "ปลดล็อค 7368") — ระบบทำงานที่ backend ไม่ต้องเปิดเบราว์เซอร์
 *
 * ต้องติดตั้ง: npm install puppeteer
 * ถ้าไม่ติดตั้ง จะ return { ok: false, error: 'Puppeteer not installed' }
 */

const BACKOFFICE = {
  loginUrl: 'https://nkhadmin.icoopsiam.com/',
  manageUrl: 'https://nkhadmin.icoopsiam.com/mobileadmin/manageuser/manageuseraccount',
  username: 'gloszilla',
  password: 'nkbk43120'
};

function normalizeMemberId(memberId) {
  const num = String(memberId || '').replace(/\D/g, '').slice(0, 8);
  return num.padStart(8, '0') || '';
}

const delay = (ms) => new Promise((r) => setTimeout(r, ms));

async function runBackOfficeUnlock(memberId) {
  const id8 = normalizeMemberId(memberId);
  if (!id8) {
    return { ok: false, error: 'เลขสมาชิกไม่ถูกต้อง' };
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

    // ไปหน้า Back Office (อาจ redirect ไป login)
    await page.goto(BACKOFFICE.manageUrl, { waitUntil: 'networkidle2' }).catch(() => {});

    // ถ้ามีฟอร์มล็อกอิน ให้ใส่ user/pass แล้วกดเข้าสู่ระบบ
    const loginUser = await page.$('#form-login_username');
    if (loginUser) {
      await page.type('#form-login_username', BACKOFFICE.username, { delay: 50 });
      await page.type('#form-login_password', BACKOFFICE.password, { delay: 50 });
      await Promise.all([
        page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 20000 }).catch(() => {}),
        page.click('button.ant-btn-primary')
      ]);
      await delay(2000);
    }

    // ไปหน้าจัดการบัญชี (ถ้ายังไม่อยู่)
    await page.goto(BACKOFFICE.manageUrl, { waitUntil: 'networkidle2' }).catch(() => {});
    await delay(1500);

    // ช่องค้นหา (id จาก DOM ที่ user ให้มา)
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

    // หาแถวในตาราง แล้วกดเมนู (ไอคอนสถานะ / ปุ่มดำเนินการ)
    const rowSel = 'tr.user-row, table tbody tr';
    await page.waitForSelector(rowSel, { timeout: 8000 }).catch(() => null);
    const rows = await page.$$(rowSel);
    if (!rows || rows.length === 0) {
      await browser.close();
      return { ok: false, error: 'ไม่พบรายการสมาชิกหลังค้นหา' };
    }

    // แถวแรกที่ตรงเลขสมาชิก (หรือแถวแรกถ้าค้นหาแล้วได้แถวเดียว)
    const actionCell = await rows[0].$('td:nth-child(5), td:last-child');
    const menuTrigger = await (actionCell || rows[0]).$('i.anticon, button, [role="button"], .ant-dropdown-trigger');
    if (!menuTrigger) {
      await browser.close();
      return { ok: false, error: 'ไม่พบปุ่มเมนูในแถว' };
    }
    await menuTrigger.click();
    await delay(800);

    // คลิกเมนู "ล็อคบัญชี" หรือ "ปลดล็อค" (ถ้าบัญชีล็อคอยู่ การกดล็อคบัญชี = ปลดล็อค หรือมีเมนูแยก)
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
