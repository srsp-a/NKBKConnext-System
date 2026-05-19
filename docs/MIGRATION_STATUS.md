# สถานะการย้าย NKBK → Firebase (ภาพรวม)

> อัปเดต: 2026-05-19  
> โปรเจกต์: `admin-panel-nkbkcoop-cbf10` (Owner: `gloszilla@gmail.com`)  
> **NAS ปิดแล้ว** — ทดสอบระบบบน Firebase ใช้งานได้

---

## ความคืบหน้าแต่ละ Phase

| Phase | หัวข้อ | สถานะ |
|-------|--------|--------|
| **0** | เตรียม Firebase | เสร็จ |
| **1** | Monitor API → `monitor-api.nkbkcoop.com` | เสร็จ (ข้าม bump installer) |
| **2** | LINE API → `api-line.nkbkcoop.com` | เสร็จ |
| **3** | Static V2 → Firebase Hosting | **เสร็จ** (รวม `portal.nkbkcoop.com`) |
| **4** | เอกสาร + อีเมล Cloudflare (แทน EmailJS) | **เสร็จ** — ส่งทดสอบจาก Admin ผ่าน (Workers Paid + onboard โดเมน) |
| **CMS** | เว็บองค์กร WP → Firestore | migrate **440/440** เสร็จ · ยังไม่ผูก `nkbkcoop.com` |

---

## ลำดับงานต่อไป (ตามที่ตกลง)

| ลำดับ | งาน | สถานะ |
|-------|-----|--------|
| 1 | รอ / ข้ามช่วงรอ | — |
| 2 | ปรับหน้า CMS ให้เหมือน WP | **รอคำสั่งคุณ** |
| 3 | NAS | **ปิดแล้ว** (ทดสอบผ่าน) |
| 4 | ผูก `nkbkcoop.com` | **ท้ายสุด** — เมื่อ CMS พร้อม |
| 5 | อีเมล Cloudflare | **เสร็จ** (2026-05-19) |
| 6 | Bump Monitor installer | **รอไปก่อน** |

---

## CMS (ทางเลือก B)

- ทดสอบ: https://admin-panel-nkbkcoop-cbf10.web.app  
- URL: `/news`, `/n/{id}` (ไม่มี `.html`)  
- Backup Firestore: รายวัน 30 วัน  

---

## Phase 4 — อีเมล (ขั้นตอนถัดไปสำหรับคุณ)

1. ตั้ง Cloudflare Email Sending สำหรับ `nkbkcoop.com` (ผู้ส่ง + API token)  
2. `scripts\cloudflare-email.env` → `.\scripts\set-cloudflare-email-secrets.ps1`  
3. Deploy lineApi:
   ```powershell
   cd NKBK\it
   node scripts/prepare-functions-deploy.js
   firebase deploy --only functions:lineApi --project admin-panel-nkbkcoop-cbf10
   ```
4. ตรวจ `https://api-line.nkbkcoop.com/v1/health` → `"configured": true`  
5. Admin → ตั้งค่า → ระบบอีเมล → ส่งทดสอบ (`https://admin-nkbkcoop.web.app`)

Admin static deploy แล้ว (2026-05-19) — ไม่ต้อง deploy admin ซ้ำจนกว่าจะแก้ UI อีก

รายละเอียด: `PHASE4_CLOUDFLARE_EMAIL_SETUP.md`

---

## เอกสารอ้างอิง

| ไฟล์ | เนื้อหา |
|------|---------|
| `PHASE4_CLEANUP.md` | Security, monitoring |
| `PHASE4_CLOUDFLARE_EMAIL_SETUP.md` | ตั้งค่าอีเมล |
| `PHASE4_EMAIL_ROADMAP.md` | แผนอีเมลระยะยาว |
| `FIRESTORE_BACKUP.md` | Backup 30 วัน |
| `NKBKCOOP_CMS_FIREBASE.md` | CMS |
| `Github/V2/docs/DOMAINS.md` | โดเมนทั้งหมด |
