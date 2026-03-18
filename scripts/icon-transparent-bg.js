/**
 * ทำให้พื้นหลังไอคอนเป็นโปร่งใส (ไม่ขาว ไม่ดำ) — เฉพาะนอกรัศมีวงกลมโลโก้
 * แก้เฉพาะ assets/icon.png
 */
const path = require('path');
const fs = require('fs');

const APP_DIR = path.join(__dirname, '..');
const ICON_PATH = path.join(APP_DIR, 'assets', 'icon.png');

function run() {
  const Jimp = require('jimp');
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
      const r = Math.min(w, h) / 2;
      const rSq = r * r;

      img.scan(0, 0, w, h, function (x, y, idx) {
        const dx = x - cx;
        const dy = y - cy;
        if (dx * dx + dy * dy > rSq) {
          this.bitmap.data[idx + 3] = 0;
        }
      });

      img.write(ICON_PATH);
      console.log('OK: พื้นหลังไอคอนเป็นโปร่งใสแล้ว —', ICON_PATH);
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
