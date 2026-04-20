# Monitor API (โปรเจกต์ it)

API ล็อกอินแอป **NKBKConnext (Monitor)** — อยู่ใต้โปรเจกต์ **it** (ระบบโปรแกรม Monitor)  
ใช้ **Firestore เดียวกับระบบ** แยก deploy ได้ ไม่ต้องรัน line-webhook (Plesk, Cloud Run ฯลฯ)

## โฟลเดอร์

```
it/
├── monitor-api/     ← API นี้ (แยกจาก line-webhook)
│   ├── package.json
│   ├── server.js
│   └── README.md
├── public/
├── server.js        ← แอป Electron + proxy
└── ...
```

## CORS (แอป Monitor เรียกตรงจาก Chromium)

แอป NKBKConnext จะส่ง `monitorApiUrl` ไปหน้า login แล้วให้ **เบราว์เซอร์ใน Electron เรียก `POST /api/monitor-login` ตรงที่โดเมนนี้** (ไม่ผ่าน Node บนเครื่องลูก) เพื่อหลบกรณี Cloudflare บล็อก request แบบ “ไคลเอนต์เซิร์ฟเวอร์”

โค้ดใน `server.js` เปิด `Access-Control-Allow-Origin: *` แล้ว — **ต้อง deploy เวอร์ชันนี้ขึ้น nkbk.srsp.app** ถ้าเซิร์ฟเวอร์ยังเป็น build เก่าไม่มี CORS หน้า login จะ fallback ไปโพรซีในแอปเหมือนเดิม

## Endpoints

| Method | Path | คำอธิบาย |
|--------|------|----------|
| GET | `/` | Health check |
| GET | `/api/monitor-public-config` | `{ lineLoginEnabled }` — แอปเดสก์ท็อปใช้ร่วมกับ `monitorApiUrl` |
| GET | `/api/line-login-start?return_origin=http://127.0.0.1:พอร์ต` | เริ่ม LINE Login (แอปเรียกผ่าน proxy ใน `it/server.js`) |
| GET | `/api/line-login-poll?state=...` | ดึงผล token หลัง LINE |
| GET | `/api/line-login-callback` | Callback จาก LINE — **ต้องลงทะเบียน URL นี้ใน LINE Developers** (ให้ตรงกับ `MONITOR_PUBLIC_ORIGIN` + path) |
| POST | `/api/monitor-login` | ล็อกอิน (username + pin 6 หลัก) |
| GET | `/api/monitor-me` | ตรวจสอบ session (Header: `X-Monitor-Token`) — คืน `username`, `fullname`, `email`, `group`, `role` |
| POST | `/api/monitor-logout` | ออกจากระบบ |
| POST | `/api/monitor-system-snapshot` | แอป Monitor อัปโหลดสเปกเครื่อง (Header: `X-Monitor-System-Secret`) — เก็บใน memory เพื่อแสดงบนเว็บ |
| GET | `/api/monitor-system-snapshots?key=...` | ดึงรายการ snapshot ทั้งหมด (ต้องตรง `MONITOR_SYSTEM_PUBLIC_READ_KEY`) |
| GET | `/workstations.html?key=...` | หน้าเว็บแสดงการ์ดสถานะเครื่อง |

### แสดงข้อมูลระบบจากแอปบนเว็บ (nkbk.srsp.app)

1. **บนเซิร์ฟเวอร์ (Plesk / env)** ตั้งค่า:
   - `MONITOR_SYSTEM_UPLOAD_SECRET` = รหัสลับยาว ๆ (ใช้ยืนยันตอนแอป **POST** สเปก)
   - `MONITOR_SYSTEM_PUBLIC_READ_KEY` = รหัสสำหรับ **เปิดดู** บนเว็บ (ใส่ใน URL `?key=`)
   - ทั้งสองค่าควร **คนละค่า** เพื่อความปลอดภัย (หรือใช้ค่าเดียวกันได้ถ้ารับความเสี่ยง)

2. **บนเครื่องที่รันแอป** แก้ `monitor-config.json` ข้าง `.exe`:
   - `systemSnapshotUploadSecret` ต้อง **ตรงกับ** `MONITOR_SYSTEM_UPLOAD_SECRET` บนเซิร์ฟเวอร์
   - `monitorApiUrl` ชี้ `https://nkbk.srsp.app` (หรือ URL ที่ deploy monitor-api)

3. เปิดแอป NKBKConnext ค้างไว้ — แอปจะ **อัปโหลดสเปกทุก ~5 นาที** (ปรับ `MONITOR_SYSTEM_WEB_PUSH_INTERVAL_MS` ได้)

4. เปิดเบราว์เซอร์:  
   `https://nkbk.srsp.app/workstations.html?key=MONITOR_SYSTEM_PUBLIC_READ_KEY`

หมายเหตุ: ข้อมูลเก็บใน **memory** บนโปรเซส Node — รีสตาร์ทแอป API จะล้างรายการ (แต่ละเครื่องจะอัปโหลดใหม่เมื่อเปิด Monitor)  
สำหรับ **แอดมิน / Firestore การ์ดคอม** ยังใช้การซิงก์ `programs` จาก `it/server.js` ตามเดิม

## การรัน

```bash
cd monitor-api
npm install
npm start
```

พอร์ตเริ่มต้น **3002** (หรือใช้ `PORT` จาก environment เช่นบน Plesk)

### ไฟล์ `.env` (แนะนำเมื่อ Plesk จำกัดความยาวช่อง Environment)

โค้ดจะโหลด **`monitor-api/.env`** อัตโนมัติ (ข้าง `server.js`) — ใส่รหัสลับยาว ๆ ได้เต็มที่

1. คัดลอก **`.env.example`** → ตั้งชื่อ **`.env`**
2. แก้ค่า `FIREBASE_API_KEY`, `MONITOR_SYSTEM_UPLOAD_SECRET`, `MONITOR_SYSTEM_PUBLIC_READ_KEY`  
   **LINE Login (ให้เครื่องลูกไม่ต้องใส่คีย์ LINE ใน monitor-config):** `LINE_LOGIN_CHANNEL_ID`, `LINE_LOGIN_CHANNEL_SECRET` และ **`MONITOR_PUBLIC_ORIGIN`** (เช่น `https://nkbk.srsp.app`) หรือตั้ง **`LINE_LOGIN_CALLBACK_URL`** เต็ม ๆ ให้ตรงกับ Callback URL ใน LINE Developers (รวม path `/monitor-api` ถ้ามี)
3. อัปโหลด **`.env`** ไปโฟลเดอร์เดียวกับ `server.js` บน server (File Manager / FTP)
4. รัน **`npm install`** ให้มีแพ็กเกจ `dotenv`
5. ใน Plesk **ไม่ต้อง** พิมพ์ env ยาว ๆ ในช่อง UI ก็ได้ (หรือเว้นว่างแล้วใช้แค่ไฟล์ `.env`)

> อย่า commit ไฟล์ `.env` ขึ้น Git — มีใน `.gitignore` แล้ว

## Deploy บน Plesk (เช่น nkbk.srsp.app)

1. อัปโหลดโฟลเดอร์ **`monitor-api`** ขึ้น server (ให้มีโฟลเดอร์ `public` ด้านในด้วย)
2. ตั้งค่า Node.js:
   - **Application Root:** `/nkbk.srsp.app/monitor-api`
   - **Application Startup File:** `server.js`
   - **Document Root:** `/nkbk.srsp.app/monitor-api/public` (ต้องเป็นโฟลเดอร์ย่อยใน Application Root)
3. รัน `npm install` ในโฟลเดอร์ monitor-api (หรือใช้ "Run Node.js commands" ใน Plesk)
4. Enable Node.js

จากนั้นตั้งค่าแอป Monitor ใน `monitor-config.json` ให้ชี้มาที่ URL นี้ (เช่น `https://nkbk.srsp.app`)

### `Cannot GET /workstations.html`

แปลว่า request ไปถึง **Express** แต่ไม่มีไฟล์หรือโค้ดยังเก่า

1. ใน File Manager ดูว่ามี **`monitor-api/public/workstations.html`** จริงหรือไม่ — ถ้าไม่มี ให้อัปโหลดทั้งโฟลเดอร์ **`public`** จาก repo
2. อัปโหลด **`server.js` เวอร์ชันล่าสุด** (มี route `/workstations.html` + `express.static`)
3. **รีสตาร์ท** Node.js หลังอัปโหลด
4. ถ้า Plesk ให้ URL แอปเป็นโฟลเดอร์ย่อย (เช่น `https://nkbk.srsp.app/monitor-api/`) ให้เปิด  
   `https://nkbk.srsp.app/monitor-api/workstations.html?key=...` ไม่ใช่ root โดเมน

## ถ้าแอป Monitor ขึ้น HTTP 403 ตอนล็อกอิน

โฮสต์ (Nginx/Plesk/WAF) อาจบล็อก **POST** ไปที่ `/api/monitor-login` ให้ตรวจว่า:

- **Nginx / reverse proxy:** ต้องส่ง **ทุก method** (GET และ POST) ไปที่แอป Node ไม่ใช่แค่ GET  
  ตัวอย่าง: `proxy_pass http://127.0.0.1:3002;` และไม่มี rule ที่บล็อก `POST /api/*`
- **Plesk:** ตรวจว่า Node.js app ได้รับ request ทุก path (รวม `/api/monitor-login`) ไม่ให้แค่ Document Root รับแบบ static
- **WAF / Security:** ปิด rule ที่ห้าม POST ไปที่ path `/api/*` หรือใส่ข้อยกเว้นให้โดเมนนี้
