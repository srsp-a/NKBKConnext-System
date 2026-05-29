# Deploy Meetdoc + Meeting Docs Production

## สาเหตุ `login_failed` บน Meetdoc

- `api-line.nkbkcoop.com/api/meetdoc-login` บน production **ยังเป็นโค้ดเก่า** (ตอบ `{ "status": "ok" }`)
- Meetdoc ใช้ **`https://monitor-api.nkbkcoop.com`** เป็นหลัก + `meetdoc-exchange` หลัง `monitor-login`

## ขั้นตอน (บัญชี Owner โปรเจกต์ — เช่น gloszilla@gmail.com)

```powershell
cd C:\Users\PC\Downloads\NKBK\it
firebase login
node scripts/prepare-functions-deploy.js
node scripts/prepare-hosting-deploy.js

firebase deploy --only storage
firebase deploy --only "functions:monitorApi,functions:lineApi,functions:meetingCronReminders,functions:onCommitteeMeetingUpdated"
firebase deploy --only "hosting:admin,hosting:meetdoc"
```

## หลัง deploy

1. ทดสอบ `POST https://monitor-api.nkbkcoop.com/api/meetdoc-login` ต้องได้ `{ "ok": true, "token": "...", "canManage": true|false }`
2. ทดสอบ `POST https://monitor-api.nkbkcoop.com/api/meetdoc/firebase-token` พร้อม header `X-Meetdoc-Token` — ผู้ดูแล/ผู้รับผิดชอบต้องได้ `{ "ok": true, "customToken": "..." }`
3. เปิด https://meetdoc.nkbkcoop.com — **ผู้ดูแล / ผู้รับผิดชอบ (ใน config/meetingdocs.editors)** จะเห็น UI จัดการวาระ/รายงานเหมือน admin `/meetingdocs` (แท็บ ภาพรวม, รายการ, ปฏิทิน, มติ, ตั้งค่า)
4. กรรมการ/ผู้อนุมัติ — มุมมองอ่านและอนุมัติ (รายการ / รออนุมัติ)
5. Firebase Console → Hosting → meetdoc-nkbkcoop → custom domain **meetdoc.nkbkcoop.com**

## LINE Login (LIFF)

Meetdoc ใช้ **LIFF** ไม่ใช่ OAuth Callback แบบ `/line/callback`

| ค่าใน LINE Developers | ค่าที่ใช้ |
|----------------------|-----------|
| **LIFF Endpoint URL** | `https://meetdoc.nkbkcoop.com/` |
| **LIFF ID** | ตรงกับ `meetdoc/auth.js` → `LIFF_ID` (ปัจจุบัน `2008951184-zlFZf7gn`) |

- **ไม่ต้อง** ตั้ง Callback เป็น `https://meetdoc.nkbkcoop.com/line/callback` สำหรับ LIFF
- หลังล็อกอิน LINE จะกลับมาที่หน้าแรกของ Meetdoc (`redirectUri` = URL หน้าเดียวกัน)

## ทดสอบเร็ว

```powershell
Invoke-RestMethod -Uri "https://monitor-api.nkbkcoop.com/api/meetdoc-login" -Method POST `
  -Body '{"username":"007368","pin":"YOUR_PIN"}' -ContentType "application/json"
```
