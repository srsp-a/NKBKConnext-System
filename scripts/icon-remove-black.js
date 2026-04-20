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
/** แถบริมวงในด้านใน — ตัดขอบวงดำหนาที่หุ้มโลโก้ (ไม่แตะส่วนกลางที่มีตัวหนังสือ) */
const OUTER_RING_FRAC = 0.058;
const RING_LUM_MAX = 62;
const RING_RGB_MAX = 98;

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
        const band = Math.max(3, Math.round(r * OUTER_RING_FRAC));
        const innerR = Math.max(1, r - band);
        const innerEdgeSq = innerR * innerR;

        img.scan(0, 0, w, h, function (x, y, idx) {
          const dx = x - cx;
          const dy = y - cy;
          const distSq = dx * dx + dy * dy;
          const red = this.bitmap.data[idx];
          const green = this.bitmap.data[idx + 1];
          const blue = this.bitmap.data[idx + 2];
          // เฉพาะพิกเซลที่อยู่นอกวงกลม (มุม/ขอบสี่เหลี่ยม) และเป็นสีดำ → ทำให้โปร่งใส
          if (distSq > rSq) {
            if (red <= BLACK_THRESHOLD && green <= BLACK_THRESHOLD && blue <= BLACK_THRESHOLD) {
              this.bitmap.data[idx + 3] = 0;
            }
            return;
          }
          // ขอบวงด้านใน: เฉพาะชั้นนอกของวงกลม + สีเข้ม → ตัดขอบดำหนา (ไม่กินโซนชมพูที่สว่าง)
          if (distSq >= innerEdgeSq) {
            const lum = 0.299 * red + 0.587 * green + 0.114 * blue;
            if (lum < RING_LUM_MAX && red < RING_RGB_MAX && green < RING_RGB_MAX && blue < RING_RGB_MAX) {
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
