/**
 * แปลงพิกเซลสีดำที่อยู่ "นอกรัศมีวงกลม" (มุม/ขอบสี่เหลี่ยม) เป็นโปร่งใส
 * ไม่แตะส่วนภายในวงกลม เพื่อไม่ให้ตัวหนังสือบนโลโก้หาย
 * ใช้กับ assets/icon.png และ public/logo.png
 */
const fs = require('fs');
const path = require('path');

const APP_DIR = path.join(__dirname, '..');

// ถ้า R,G,B ต่ำกว่านี้ถือว่าเป็น "ดำ" (เฉพาะที่นอกรัศมีวงกลมจะทำให้โปร่งใส)
const BLACK_THRESHOLD = 45;

function processImage(filePath) {
  try {
    const Jimp = require('jimp');
    return Jimp.read(filePath)
      .then((img) => {
        const w = img.bitmap.width;
        const h = img.bitmap.height;
        const cx = w / 2;
        const cy = h / 2;
        const r = Math.min(w, h) / 2; // รัศมีวงกลมในภาพ
        const rSq = r * r;

        img.scan(0, 0, w, h, function (x, y, idx) {
          const dx = x - cx;
          const dy = y - cy;
          const distSq = dx * dx + dy * dy;
          // เฉพาะพิกเซลที่อยู่นอกวงกลม (มุม/ขอบสี่เหลี่ยม) และเป็นสีดำ → ทำให้โปร่งใส
          if (distSq > rSq) {
            const red = this.bitmap.data[idx];
            const green = this.bitmap.data[idx + 1];
            const blue = this.bitmap.data[idx + 2];
            if (red <= BLACK_THRESHOLD && green <= BLACK_THRESHOLD && blue <= BLACK_THRESHOLD) {
              this.bitmap.data[idx + 3] = 0;
            }
          }
        });
        img.write(filePath);
        console.log('OK:', filePath);
        return Promise.resolve();
      })
      .catch((err) => {
        console.error('Error:', filePath, err.message);
      });
  } catch (e) {
    console.error('Jimp not found. Run: npm install --save-dev jimp');
    process.exit(1);
  }
}

const iconPath = path.join(APP_DIR, 'assets', 'icon.png');
const logoPath = path.join(APP_DIR, 'public', 'logo.png');

const tasks = [];
if (fs.existsSync(iconPath)) tasks.push(processImage(iconPath));
if (fs.existsSync(logoPath)) tasks.push(processImage(logoPath));

if (tasks.length === 0) {
  console.log('No icon.png or logo.png found.');
  process.exit(0);
}

Promise.all(tasks).then(() => {
  console.log('Done. Black pixels set to transparent.');
});
