# ตั้งค่า Cloudflare Email (แทน EmailJS)

## 1) Cloudflare Dashboard — Onboard โดเมน (จำเป็น)

ถ้า error `email.sending_disabled` = **ยังไม่ได้เปิด Email Sending ให้โดเมน**

1. เปิด **Email Sending** (ไม่ใช่ Email Routing):
   - ลิงก์: https://dash.cloudflare.com/?to=/:account/email-service/sending  
   - หรือเมนูซ้าย: **Email Service** → **Email Sending** (Beta)
2. กด **Onboard Domain** → เลือก **nkbkcoop.com**
3. กด **Add records and onboard** (DNS บน `cf-bounce.nkbkcoop.com` — SPF/DKIM/DMARC)
4. รอสถานะโดเมน **Active** (มัก 5–15 นาที)
5. ผู้ส่งใน Admin ใช้ `@nkbkcoop.com` เช่น `support@nkbkcoop.com`

หมายเหตุ: ต้องใช้ **Cloudflare DNS** สำหรับโดเมนนี้ ([เอกสาร](https://developers.cloudflare.com/email-service/get-started/send-emails/))

## 2) API Token

1. สร้าง API Token (Email Sending — Read + Edit) หรือปุ่ม **Create Token** ในหน้า Email Sending
2. เก็บไว้ปลอดภัย → ใส่ Firebase (ดูด้านล่าง)

## 3) Cloud Functions (lineApi)

ตั้ง secrets บนโปรเจกต์ `admin-panel-nkbkcoop-cbf10` (ต้องทำก่อน deploy ครั้งถัดไป):

```powershell
cd NKBK\it\scripts
copy cloudflare-email.env.example cloudflare-email.env
# แก้ไข cloudflare-email.env ใส่ Account ID + API Token
.\set-cloudflare-email-secrets.ps1
```

หรือตั้งทีละตัว:

```powershell
firebase functions:secrets:set CLOUDFLARE_ACCOUNT_ID --project admin-panel-nkbkcoop-cbf10
firebase functions:secrets:set CLOUDFLARE_EMAIL_API_TOKEN --project admin-panel-nkbkcoop-cbf10
```

`functions/index.js` ผูก secrets เข้า `lineApi` แล้ว — หลัง deploy ค่าจะอยู่ใน `process.env`

| ตัวแปร | ค่า |
|--------|-----|
| `CLOUDFLARE_ACCOUNT_ID` | Account ID จาก Cloudflare |
| `CLOUDFLARE_EMAIL_API_TOKEN` | API token |

จากนั้น deploy:

```powershell
cd NKBK\it
node scripts/prepare-functions-deploy.js
firebase deploy --only functions:lineApi,firestore:rules --project admin-panel-nkbkcoop-cbf10
```

## 4) Admin Panel

ตั้งค่า → ระบบอีเมล:

- **From:** `notifications@nkbkcoop.com`
- **API Base:** `https://api-line.nkbkcoop.com`

ทดสอบส่งอีเมลจากหน้าตั้งค่า

## 5) API

| Method | Path | คำอธิบาย |
|--------|------|----------|
| GET | `/v1/health` | ตรวจว่าตั้งค่า Cloudflare แล้ว |
| POST | `/v1/send/test` | ทดสอบ (ต้อง Bearer Firebase token แอดมิน) |
| POST | `/v1/send` | ส่งตาม template |

Deploy Admin static:

```powershell
.\scripts\deploy-hosting-static.ps1 admin
```

## 6) ตรวจสอบ

```powershell
curl https://api-line.nkbkcoop.com/v1/health
```

ควรได้ `"configured": true` หลังใส่ secrets
