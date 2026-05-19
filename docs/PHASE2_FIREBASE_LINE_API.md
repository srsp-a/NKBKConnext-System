# Phase 2 — LINE API บน Firebase (`api-line.nkbkcoop.com`)

> โดเมน **`api.nkbkcoop.com`** — **ว่างไว้** สำหรับงานอื่นในอนาคต (ไม่ deploy LINE API ที่นี่)

---

## URL

| รายการ | ค่า |
|--------|-----|
| โดเมนหลัก | **https://api-line.nkbkcoop.com** |
| Hosting ชั่วคราว | https://api-line-nkbkcoop.web.app |
| Webhook LINE | `https://api-line.nkbkcoop.com/line/webhook` |
| LINE Login callback | `https://api-line.nkbkcoop.com/line/callback` |
| Functions | `lineApi`, `lineCronAttendance*` |

---

## Deploy

```bash
cd NKBK/it
firebase hosting:sites:create api-line-nkbkcoop --project admin-panel-nkbkcoop-cbf10
firebase target:apply hosting line api-line-nkbkcoop --project admin-panel-nkbkcoop-cbf10
node scripts/prepare-functions-deploy.js
firebase deploy --only "functions:lineApi,functions:lineCronAttendanceNotify,functions:lineCronAttendanceScan,functions:lineCronAttendanceAutoFetch,hosting:line" --project admin-panel-nkbkcoop-cbf10
```

---

## Firestore

```bash
node scripts/update-line-settings-firestore.js
```

อัปเดต `config/line_settings`: `webhookUrl`, `callbackUrl`, `monitorApiUrl`

---

## LINE Developers

| ประเภท | URL |
|--------|-----|
| Messaging Webhook | `https://api-line.nkbkcoop.com/line/webhook` |
| Login callback (Portal) | `https://api-line.nkbkcoop.com/line/callback` |
| Monitor Login | `https://monitor-api.nkbkcoop.com/api/line-login-callback` (คนละโดเมน) |

---

## ทดสอบ

```powershell
.\scripts\verify-line-api.ps1 https://api-line-nkbkcoop.web.app
```
