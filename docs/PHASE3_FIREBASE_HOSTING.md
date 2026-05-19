# Phase 3 — Static บน Firebase Hosting (ทุก subdomain)

> **API** อยู่คนละ site: `monitor-api`, `api-line` (Functions)  
> **Static** จาก `Github/V2` → `hosting-dist/` → deploy ตาม `hosting-sites.config.json`

---

## โดเมน → Hosting site

| โดเมน | Site ID | โฟลเดอร์ V2 |
|--------|---------|-------------|
| admin.nkbkcoop.com | admin-nkbkcoop | `admin/` (+ `/portal`, `/line`) |
| portal.nkbkcoop.com | portal-nkbkcoop | `admin/portal/` |
| link.nkbkcoop.com | link-nkbkcoop | `link/` |
| leave.nkbkcoop.com | leave-nkbkcoop | `leave/` |
| register.nkbkcoop.com | register-nkbkcoop | `register/` |
| random.nkbkcoop.com | random-nkbkcoop | `random/` |
| queue.nkbkcoop.com | queue-nkbkcoop | `queue/` |
| q.nkbkcoop.com | q-nkbkcoop | `q/` |
| qauto.nkbkcoop.com | qauto-nkbkcoop | `qauto/` |
| payment.nkbkcoop.com | payment-nkbkcoop | `payment/` |
| nkbkcoop.com | nkbkcoop-web | `index.html` |

`api.nkbkcoop.com` — **ว่างไว้** (ไม่ deploy ใน Phase นี้)

---

## ครั้งแรก (สร้าง sites)

```powershell
cd NKBK\it
.\scripts\setup-hosting-sites.ps1
```

จากนั้นใน [Firebase Console → Hosting](https://console.firebase.google.com/project/admin-panel-nkbkcoop-cbf10/hosting) แต่ละ site → **Add custom domain** ตามตารางด้านบน (รอ SSL เหมือน api-line)

---

## Deploy ทุก static site

```powershell
.\scripts\deploy-hosting-static.ps1
```

Deploy เฉพาะบาง site:

```powershell
.\scripts\deploy-hosting-static.ps1 admin,link,leave
```

---

## หลัง DNS ชี้ Firebase

1. ทดสอบ `https://admin.nkbkcoop.com` (ล็อกอิน Admin)
2. `https://link.nkbkcoop.com` — ผูกบัญชี LINE
3. `https://leave.nkbkcoop.com` — LIFF ลา
4. ปิด Web Station / proxy เก่าบน NAS เมื่อครบ

---

## หมายเหตุ

- สคริปต์ `prepare-hosting-deploy.js` คัดลอก `shared/` เข้า site ที่ใช้ `/shared/auth-tracker.js`
- แก้ `portal` deploy: เปลี่ยน `../tailwind-output.css` → `./tailwind-output.css` อัตโนมัติ
- อัปเดต `firebase.json` hosting static: `node scripts/merge-firebase-hosting.js` (หลังแก้ `hosting-sites.config.json`)
