/**
 * เปลี่ยนพื้นหลังไอคอนจากดำเป็นขาว + มุมมน (สำหรับไอคอนบนเดสก์ท็อป)
 * แก้เฉพาะ assets/icon.png ไม่แตะ public/logo.png
 */
const path = require('path');

const APP_DIR = path.join(__dirname, '..');
const ICON_PATH = path.join(APP_DIR, 'assets', 'icon.png');

// พิกเซลที่โปร่งใสหรือดำมาก → เปลี่ยนเป็นขาว
const BLACK_THRESHOLD = 50;
const TRANSPARENT_THRESHOLD = 128;

// รัศมีมุมมน (เป็นสัดส่วนของความกว้าง) เช่น 0.15 = 15%
const CORNER_RADIUS_RATIO = 0.18;

function run() {
  const Jimp = require('jimp');
  const fs = require('fs');
  if (!fs.existsSync(ICON_PATH)) {
    console.log('ไม่พบ assets/icon.png');
    process.exit(0);
    return;
  }

  Jimp.read(ICON_PATH)
    .then((img) => {
      const w = img.bitmap.width;
      const h = img.bitmap.height;
      const cx = w / 2;
      const cy = h / 2;
      const logoR = Math.min(w, h) / 2; // รัศมีวงกลมโลโก้
      const logoRSq = logoR * logoR;
      const cornerR = Math.min(w, h) * CORNER_RADIUS_RATIO;

      // เปลี่ยนเป็นขาวเฉพาะ "พื้นหลัง" = นอกรัศมีวงกลมโลโก้ และเป็นดำ/โปร่งใส (ไม่แตะตัวหนังสือในวงกลม)
      img.scan(0, 0, w, h, function (x, y, idx) {
        const dx = x - cx;
        const dy = y - cy;
        const distSq = dx * dx + dy * dy;
        const outsideLogo = distSq > logoRSq;

        const red = this.bitmap.data[idx];
        const green = this.bitmap.data[idx + 1];
        const blue = this.bitmap.data[idx + 2];
        const alpha = this.bitmap.data[idx + 3];

        const isBlack = red <= BLACK_THRESHOLD && green <= BLACK_THRESHOLD && blue <= BLACK_THRESHOLD;
        const isTransparent = alpha < TRANSPARENT_THRESHOLD;

        if (outsideLogo && (isBlack || isTransparent)) {
          this.bitmap.data[idx] = 255;
          this.bitmap.data[idx + 1] = 255;
          this.bitmap.data[idx + 2] = 255;
          this.bitmap.data[idx + 3] = 255;
        }
      });

      // มุมมน: ทำให้พิกเซลในมุมทั้งสี่โปร่งใส (outside rounded rect)
      img.scan(0, 0, w, h, function (x, y, idx) {
        let outside = false;
        if (x < cornerR && y < cornerR) {
          const dx = cornerR - x;
          const dy = cornerR - y;
          outside = dx * dx + dy * dy > cornerR * cornerR;
        } else if (x >= w - cornerR && y < cornerR) {
          const dx = x - (w - cornerR);
          const dy = cornerR - y;
          outside = dx * dx + dy * dy > cornerR * cornerR;
        } else if (x < cornerR && y >= h - cornerR) {
          const dx = cornerR - x;
          const dy = y - (h - cornerR);
          outside = dx * dx + dy * dy > cornerR * cornerR;
        } else if (x >= w - cornerR && y >= h - cornerR) {
          const dx = x - (w - cornerR);
          const dy = y - (h - cornerR);
          outside = dx * dx + dy * dy > cornerR * cornerR;
        }
        if (outside) {
          this.bitmap.data[idx + 3] = 0;
        }
      });

      img.write(ICON_PATH);
      console.log('OK: พื้นหลังไอคอนเป็นสีขาว มุมมนแล้ว —', ICON_PATH);
      return Promise.resolve();
    })
    .catch((err) => {
      console.error('Error:', err.message);
      process.exit(1);
    });
}

try {
  run();
} catch (e) {
  console.error('Jimp not found. Run: npm install --save-dev jimp');
  process.exit(1);
}
