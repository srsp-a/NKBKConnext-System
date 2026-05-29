/**
 * คัดลอกไฟล์อัปเดตจาก dist/ → public-cms/desktop-app-updates/
 * และอัปเดต desktop-update-manifest.json ให้ตรงกับ package.json version
 *
 * ใช้หลัง: npm run build (หรือ build:installer + build:portable)
 *
 * ซิงก์เฉพาะไฟล์ของเวอร์ชันปัจจุบันใน package.json เท่านั้น (ไม่ดึง exe เก่าใน dist/)
 *
 * URL สาธารณะปลายทาง (ไม่มี slash ท้าย):
 *   env DESKTOP_UPDATE_PUBLIC_BASE_URL หรือค่าเริ่มต้น Firebase Hosting main
 */
'use strict';

const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const distDir = path.join(root, 'dist');
const destDir = path.join(root, 'public-cms', 'desktop-app-updates');

const BASE =
  String(process.env.DESKTOP_UPDATE_PUBLIC_BASE_URL || '').trim().replace(/\/$/, '') ||
  'https://nkbkcoop.com/desktop-app-updates';

/** ชื่อไฟล์ที่เก็บในโฟลเดอร์ปล่อยอัปเดตไว้เสมอ (ไม่ลบตอนซิงก์) */
const KEEP_IN_DEST = new Set(['README.md', '.gitkeep']);

function encPathSegment(name) {
  return encodeURIComponent(name).replace(/%20/g, '%20');
}

if (!fs.existsSync(distDir)) {
  console.error('[sync-desktop-updates] ไม่พบโฟลเดอร์ dist/ — รัน npm run build ก่อน');
  process.exit(1);
}

const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const version = String(pkg.version || '0.0.0').trim();
const productName = String((pkg.build && pkg.build.productName) || pkg.productName || 'App').trim();

const setupExe = `${productName} Setup ${version}.exe`;
const setupBlockmap = `${setupExe}.blockmap`;
const portableExe = `${productName} ${version} Portable.exe`;
const latestYml = 'latest.yml';

const requiredFromDist = [latestYml, setupExe, setupBlockmap, portableExe];

for (const name of requiredFromDist) {
  const p = path.join(distDir, name);
  if (!fs.existsSync(p)) {
    console.error('[sync-desktop-updates] ไม่พบใน dist/:', name);
    console.error('  รัน npm run build (NSIS + portable) หรือ build:installer + build:portable');
    process.exit(1);
  }
}

fs.mkdirSync(destDir, { recursive: true });

for (const name of fs.readdirSync(destDir)) {
  if (KEEP_IN_DEST.has(name)) continue;
  const p = path.join(destDir, name);
  try {
    if (fs.statSync(p).isFile()) fs.unlinkSync(p);
  } catch (_) {
    /* ignore */
  }
}

for (const name of requiredFromDist) {
  fs.copyFileSync(path.join(distDir, name), path.join(destDir, name));
  console.log('[sync-desktop-updates] copied:', name);
}

const portableUrl = `${BASE}/${encPathSegment(portableExe)}`;

const manifestPath = path.join(destDir, 'desktop-update-manifest.json');
const manifest = {
  latestVersion: version,
  portableUrl,
  portableFileName: portableExe
};

fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n', 'utf8');
console.log('[sync-desktop-updates] wrote:', path.relative(root, manifestPath), manifest);

console.log('[sync-desktop-updates] เสร็จแล้ว — ถัดไป: firebase deploy --only hosting:main');
