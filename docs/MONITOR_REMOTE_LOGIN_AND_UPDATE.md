# ออกแบบ: ล็อกอิน Monitor ผ่าน API บนเซิร์ฟเวอร์ + อัปเดตระยะไกล

## ภาพรวม

1. **ล็อกอินผ่าน API บน V2** — แอป Monitor ไม่ต้องมีไฟล์ `firebase-service-account.json` บนเครื่องลูก คีย์อยู่ที่เซิร์ฟเวอร์ (api.nkbkcoop.com / line-webhook) เท่านั้น
2. **อัปเดตระยะไกล** — แอปตรวจสอบเวอร์ชันจากเซิร์ฟเวอร์ แล้วดาวน์โหลด/ติดตั้งอัปเดตได้

---

## ส่วนที่ 1: API ล็อกอิน Monitor บนเซิร์ฟเวอร์ (V2)

### ที่อยู่ API

- เซิร์ฟเวอร์: **line-webhook** บน NAS (โฮสต์ที่ **api.nkbkcoop.com** ตาม [ภาพรวมระบบ](https://admin.nkbkcoop.com/))
- Base URL ที่แอป Monitor จะเรียก: `https://api.nkbkcoop.com` (หรือตามที่ reverse proxy กำหนด)

### Endpoints ที่เพิ่มใน line-webhook

| Method | Path | คำอธิบาย |
|--------|------|----------|
| POST | `/api/monitor-login` | ส่ง `{ username, pin }` → ตรวจจาก Firestore `users` ( logic เดียวกับ installer-login) + ตรวจกลุ่ม เจ้าหน้าที่/กรรมการ/ผู้ดูแล → คืน `{ ok, token, username }` |
| GET | `/api/monitor-me` | Header `X-Monitor-Token: <token>` → คืน `{ ok, username }` หรือ 401 |
| POST | `/api/monitor-logout` | Header + body `token` → ลบ session |

- **Token**: สร้างแบบสุ่ม (เช่น crypto.randomBytes) เก็บในหน่วยความจำบนเซิร์ฟเวอร์ `Map<token, { username, createdAt }>` (ถ้าต้องการหมดอายุ เช่น 7 วัน ก็เช็คที่ `monitor-me`)
- **การตรวจ user**: ใช้ `firebaseQuery('users', 'username', ...)` และ `firebaseGetCollection('users')` + ตรวจ `pin` และกลุ่ม (เจ้าหน้าที่/กรรมการ/ผู้ดูแล) — ไม่ใช้ `monitor_users` ฝั่งเซิร์ฟเวอร์นี้ เพราะยึดข้อมูลจาก V2 `users` เลย
- **CORS**: ต้องอนุญาต header `X-Monitor-Token` ใน `Access-Control-Allow-Headers` สำหรับ `/api/monitor-*`

### แอป Monitor (Electron) เปลี่ยนอย่างไร

- ตั้งค่า **Base URL ของ Monitor API** ได้สองแบบ:
  1. **ตัวแปรสภาพแวดล้อม** `MONITOR_API_URL=https://api.nkbkcoop.com`
  2. **ไฟล์ config** วาง `monitor-config.json` ข้าง `NKBKConnext System.exe` หรือในโฟลเดอร์ userData ของแอป เนื้อหา: `{ "monitorApiUrl": "https://api.nkbkcoop.com" }`
- หน้า login: ถ้ามีค่า `monitorApiUrl` → เรียก `POST {monitorApiUrl}/api/monitor-login` แทน local
- หลังล็อกอิน: เก็บ `token` ใน localStorage (เหมือนเดิม)
- หน้า index: เรียก `GET {monitorApiUrl}/api/monitor-me` และ `POST .../api/monitor-logout` เมื่อตั้งค่าแล้ว
- **ถ้าไม่ตั้ง** — ทำงานแบบเดิม (ใช้ Firestore บนเครื่อง + ต้องมีไฟล์ service account)

### สรุปข้อดี

- ไม่ต้องแจกไฟล์ `firebase-service-account.json` ไปทุกเครื่อง
- User ใช้ชื่อผู้ใช้ + PIN เดียวกับใน V2 (เจ้าหน้าที่) ได้เลย
- คีย์ Firebase อยู่ที่เซิร์ฟเวอร์เดียว (api.nkbkcoop.com) ดูแลง่าย

---

## ส่วนที่ 2: อัปเดตระยะไกล (Remote Update)

### หลักการ

- ใช้ **electron-updater** (หรือ built-in auto-update ของ electron-builder) ให้แอปตรวจสอบว่ามีเวอร์ชันใหม่จาก “ที่โฮสต์อัปเดต” หรือไม่
- เมื่อมีเวอร์ชันใหม่: แจ้งผู้ใช้ → ดาวน์โหลด installer / portable → ปิดแอปแล้วติดตั้ง (หรือให้ผู้ใช้กด “อัปเดตตอนนี้”)

### ที่โฮสต์อัปเดต

- **แนะนำ: GitHub Releases** — ใช้ได้ทันที ไม่ต้องตั้งเซิร์ฟเวอร์เอง
  - สร้าง repo (เช่น `NKBKConnext-Monitor`) แล้วตั้ง `repository` ใน package.json
  - Build แล้วอัปโหลดไฟล์จาก `dist/` ขึ้น **Firebase Hosting** (`public-cms/desktop-app-updates/` → deploy hosting **main**) — ดู **`docs/FIREBASE_DESKTOP_UPDATES.md`** (`npm run release` = build เท่านั้น ไม่ใช้ GH_TOKEN)
  - แอปจะเช็คอัปเดตจาก URL generic / manifest (ไม่บังคับ GitHub Release)
- **ตัวเลือกอื่น**: โฟลเดอร์บน CDN/NAS เช่น `https://example.com/releases/` — ตั้ง `desktopUpdateFeedUrl` ใน `monitor-config.json`

### ไฟล์ที่ต้องมีบนเซิร์ฟเวอร์ (Windows)

- **latest.yml** — ไฟล์ที่ electron-updater อ่านเพื่อเช็คเวอร์ชัน (มี `version`, `path` หรือ `url` ของ installer, `sha512` ฯลฯ)
- **NKBKConnext System Setup x.x.x.exe** — ตัวติดตั้งที่ดาวน์โหลดได้จาก URL ใน latest.yml
- **desktop-update-manifest.json** — สำหรับแบบ **Portable** (`latestVersion`, `portableUrl`, `portableFileName`)

หลัง build ด้วย electron-builder จะได้ไฟล์เหล่านี้ใน `dist/` อยู่แล้ว — คัดลอกขึ้นโฟลเดอร์ที่โฮสต์ด้วย HTTPS (Firebase Hosting แนะนำ)

### การตั้งค่าในโปรเจกต์ (it) — Firebase generic feed

- **package.json**: `build.publish.provider` = **`generic`** และ `url` ชี้โฟลเดอร์บน Hosting (ค่าเริ่มต้นใน repo)
- **electron-main.js**: `electron-updater` + `setFeedURL({ provider: 'generic', url })` และตรวจ Portable จาก `desktop-update-manifest.json`
- เมื่อมีอัปเดต: dialog / overlay → ดาวน์โหลด → NSIS ใช้ `quitAndInstall()` ตามเดิม

### Flow การอัปเดต (Firebase Hosting)

1. แก้โค้ด → เพิ่ม `version` ใน package.json → `npm run build:installer`
2. คัดลอก `latest.yml`, `.exe`, `.blockmap` และแก้ `desktop-update-manifest.json` → `firebase deploy --only hosting:main` (หรือโฟลเดอร์ Hosting ของคุณ)
3. ผู้ใช้เปิดแอป → เช็ค feed → ถ้าเวอร์ชันใหม่กว่า แจ้งให้อัปเดต

---

## ลำดับการทำ (สรุป)

1. **V2 (line-webhook)**  
   - เพิ่ม `POST /api/monitor-login`, `GET /api/monitor-me`, `POST /api/monitor-logout`  
   - ใช้ logic user+PIN จาก `users` + ตรวจกลุ่ม  
   - เปิด CORS header `X-Monitor-Token`

2. **แอป Monitor (it)**  
   - อ่าน `MONITOR_API_URL` (env หรือ config)  
   - หน้า login / monitor-me ใช้ URL นี้เมื่อมีการตั้งค่า  
   - ไม่ต้องมีไฟล์ service account เมื่อใช้โหมด remote

3. **อัปเดตระยะไกล**  
   - ตั้งโฟลเดอร์โฮสต์อัปเดต (เช่น `releases/monitor`)  
   - ตั้ง `publish` ใน electron-builder + ใช้ autoUpdater ใน main process  
   - คู่มือการอัปโหลดไฟล์หลัง build (latest.yml + Setup exe)

เมื่อทำครบ เครื่องลูกไม่ต้องก๊อบไฟล์ service account และสามารถอัปเดตโปรแกรมจากเซิร์ฟเวอร์ได้จากที่เดียว
