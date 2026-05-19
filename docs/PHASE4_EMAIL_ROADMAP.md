# Phase 4 — อีเมลองค์กร (ถัดไป)

> ออกแบบเต็ม: `Github/V2/docs/email-cloudflare-design.md`  
> **ยังไม่ implement** — ทำหลัง CMS + โดเมนหลัก stabilizes

---

## เป้าหมาย

- เลิกส่งอีเมลจาก **EmailJS ในเบราว์เซอร์** (key โผล่ client)
- ส่งจาก **`notifications@nkbkcoop.com`** ผ่าน Cloudflare Email Sending
- เก็บเทมเพลตใน Firestore `email_templates` เหมือนเดิม

---

## แนะนำสถาปัตยกรรม

```
Admin / Portal / Leave
    → POST https://api.nkbkcoop.com/v1/email/send   (หรือ email-api.nkbkcoop.com)
    → Cloud Function ตรวจ Firebase Auth token
    → Cloudflare Email API ส่งจริง
```

ใช้ **`api.nkbkcoop.com`** (ว่างไว้) สำหรับ email API ได้ — ไม่ปนกับ LINE

---

## ลำดับ implement (เมื่อพร้อม)

1. สมัคร/เปิด Cloudflare Email Sending สำหรับ `nkbkcoop.com`
2. สร้าง Cloud Function `sendOrgEmail` ใน `it/functions`
3. แก้ `admin/index.html` — เรียก API แทน `emailjs.send()`
4. ทดสอบ: แจ้งลา, หมดอายุ, เทมเพลตจาก Firestore
5. ปิด/ลบ EmailJS keys จาก client

รีเซ็ตรหัสผ่านยังใช้ `sendPasswordResetEmail()` — ไม่เปลี่ยน
