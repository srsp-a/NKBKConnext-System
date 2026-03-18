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
  - Build แล้วอัปโหลดด้วย `electron-builder --win -p` (ต้องมี `GH_TOKEN`) หรืออัปโหลดไฟล์จาก `dist/` ขึ้น Release เอง
  - แอปจะเช็คอัปเดตจาก GitHub ได้อัตโนมัติ (repo แบบ public ไม่ต้องใส่ token)
- **ตัวเลือกอื่น**: โฟลเดอร์บน NAS เช่น `https://api.nkbkcoop.com/releases/monitor/` (ตั้ง `publish.provider: "generic"`)

### ไฟล์ที่ต้องมีบนเซิร์ฟเวอร์ (Windows)

- **latest.yml** — ไฟล์ที่ electron-updater อ่านเพื่อเช็คเวอร์ชัน (มี `version`, `path` หรือ `url` ของ installer, `sha512` ฯลฯ)
- **NKBKConnext System Setup x.x.x.exe** — ตัวติดตั้งที่ดาวน์โหลดได้จาก URL ใน latest.yml

หลัง build ด้วย electron-builder จะได้ไฟล์เหล่านี้ใน `dist/` อยู่แล้ว — แค่อัปโหลดขึ้นโฟลเดอร์ releases/monitor และให้ URL สาธารณะอ่านได้ (HTTPS แนะนำ)

### การตั้งค่าในโปรเจกต์ (it) — ใช้ GitHub

- **package.json**: ตั้ง `repository` ให้ชี้ไปที่ repo จริง (เช่น `"url": "https://github.com/your-org/NKBKConnext-Monitor.git"`) และมี `build.publish`: `{ "provider": "github", "releaseType": "release" }` (ใส่ไว้แล้ว)
- **electron-main.js**: ติดตั้ง `electron-updater` แล้วเรียก `autoUpdater.checkForUpdates()` หลังแอปพร้อม (และเพิ่มปุ่ม/เมนู “ตรวจสอบอัปเดต” ได้)
- เมื่อมีอัปเดต: แสดง dialog “มีเวอร์ชันใหม่ xxx ต้องการดาวน์โหลดและติดตั้งไหม?” → ดาวน์โหลดแล้ว `quitAndInstall()`

### Flow การอัปเดต (GitHub)

1. แก้โค้ด → เพิ่ม `version` ใน package.json (เช่น 1.0.1) → build: `npm run build:installer`
2. สร้าง Release บน GitHub: Tag เช่น `v1.0.1` แล้วอัปโหลดไฟล์จาก `dist/` (ไฟล์ `.exe` และ `latest.yml`) หรือใช้คำสั่ง `GH_TOKEN=xxx npm run build:installer -- -p` ให้อัปโหลดขึ้น Release ให้อัตโนมัติ
3. ผู้ใช้เปิดแอป → แอปเช็คจาก GitHub Releases → ถ้าเวอร์ชันใหม่กว่า แจ้งให้อัปเดต → ดาวน์โหลดและติดตั้ง

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
