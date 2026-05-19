# Firebase Setup — Monitor API (Phase 1)

> โปรเจกต์: `admin-panel-nkbkcoop-cbf10`  
> โฟลเดอร์ deploy: repo **`NKBK/it`**

---

## สิ่งที่ scaffold แล้ว

| ไฟล์ | หนาที่ |
|------|--------|
| `firebase.json` | Functions + Hosting (target `monitor`) |
| `.firebaserc` | โปรเจกต์ + hosting target `monitor-api-nkbkcoop` |
| `functions/index.js` | export `monitorApi` (Express) |
| `monitor-api/server.js` | ไม่ `listen()` เมื่อรันบน Functions |

---

## สถานะ deploy (ล่าสุด)

| รายการ | ค่า |
|--------|-----|
| URL หลัก | **https://monitor-api.nkbkcoop.com** |
| Hosting สำรอง | https://monitor-api-nkbkcoop.web.app |
| Function | `monitorApi` — `asia-southeast1`, `invoker: public` |
| Rollout แอป 3 เครื่อง | **`docs/MONITOR_FIREBASE_ROLLOUT.md`** |
| ทดสอบแล้ว | `GET /api/monitor-public-config`, `POST /api/monitor-login` (Firestore ทำงาน) |

---

## ขั้นตอนครั้งแรก (ทำครั้งเดียว)

### 1. ติดตั้ง CLI และล็อกอิน

```bash
npm install -g firebase-tools
firebase login
cd C:\Users\PC\Downloads\NKBK\it
firebase use admin-panel-nkbkcoop-cbf10
```

### 2. สร้าง Hosting site สำหรับ Monitor

ใน [Firebase Console → Hosting](https://console.firebase.google.com/project/admin-panel-nkbkcoop-cbf10/hosting):

1. **Add another site** (ถ้ายังไม่มี)
2. Site ID: **`monitor-api-nkbkcoop`** (ต้องตรง `.firebaserc` → `targets.hosting.monitor`)
3. ผูก custom domain **`monitor-api.nkbkcoop.com`** (DNS ตามที่ Console แนะนำ)

### 3. ตั้ง Secrets (Firebase Secret Manager)

```bash
cd functions
npm install
cd ..

firebase functions:secrets:set MONITOR_SYSTEM_UPLOAD_SECRET
firebase functions:secrets:set MONITOR_SYSTEM_PUBLIC_READ_KEY
firebase functions:secrets:set LINE_LOGIN_CHANNEL_ID
firebase functions:secrets:set LINE_LOGIN_CHANNEL_SECRET
firebase functions:secrets:set FIREBASE_API_KEY
```

คัดลอกค่าจาก `.env` เดิมบน Plesk (`monitor-api/.env`) ถ้ามี

ถ้ายังไม่มี LINE บน Monitor — ตั้งค่าว่างชั่วคราวไม่ได้ ให้ใส่ placeholder หรือลบ secrets ออกจาก `functions/index.js` ชั่วคราว

### 4. Deploy

```bash
cd C:\Users\PC\Downloads\NKBK\it
firebase deploy --only functions:monitorApi,hosting:monitor
```

ทดสอบ:

- `https://monitor-api-nkbkcoop.web.app/` (หรือ URL ที่ Hosting ให้)
- `POST .../api/monitor-login` ด้วย username + PIN

### 5. อัปเดตแอป 3 เครื่อง

แก้ `monitor-config.json` ข้าง `.exe`:

```json
{
  "monitorApiUrl": "https://monitor-api.nkbkcoop.com",
  "systemSnapshotUploadSecret": "ค่าเดียวกับ MONITOR_SYSTEM_UPLOAD_SECRET"
}
```

**LINE Developers** → Callback URL:

`https://monitor-api.nkbkcoop.com/api/line-login-callback`

---

## รันทดสอบบนเครื่อง (Emulator)

```bash
cd C:\Users\PC\Downloads\NKBK\it
# ใส่ค่าใน monitor-api/.env ก่อน (คัดลอกจาก .env.example)
firebase emulators:start --only functions,hosting
```

- Hosting: http://localhost:5000  
- Functions: ผ่าน rewrite จาก Hosting

---

## แก้ปัญหา

| อาการ | แนวทาง |
|--------|--------|
| Deploy บอกไม่มี hosting site | สร้าง site `monitor-api-nkbkcoop` ใน Console |
| Secret ไม่ครบ | `firebase functions:secrets:set ...` หรือเอาออกจาก array ใน `index.js` ชั่วคราว |
| 403 monitor-login | ตรวจ Firestore users + PIN; ดู Logs ใน Console → Functions |
| Snapshot ไม่ขึ้นเว็บ | ตรวจ `systemSnapshotUploadSecret` ตรงกันทั้งแอปและ Secret |

---

## ขั้นถัดไป (Phase 2)

ย้าย `Github/V2/line-webhook` → function `lineApi` + Hosting `api-line.nkbkcoop.com` (`api.nkbkcoop.com` ว่างไว้)  
ดู `Github/V2/docs/FIREBASE_MIGRATION_PLAN.md`
