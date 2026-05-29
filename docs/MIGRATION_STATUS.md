# สถานะการย้าย NKBK → Firebase (ภาพรวม)

> อัปเดต: 2026-05-25  
> โปรเจกต์: `admin-panel-nkbkcoop-cbf10` (Owner: `gloszilla@gmail.com`)  
> **NAS ปิดแล้ว** — ทดสอบระบบบน Firebase ใช้งานได้  
> **Git:** commit + push `main` แล้ว (`it` `79eb2d1`, `V2` `d101e02`)

---

## ความคืบหน้าแต่ละ Phase

| Phase | หัวข้อ | สถานะ |
|-------|--------|--------|
| **0** | เตรียม Firebase | เสร็จ |
| **1** | Monitor API → `monitor-api.nkbkcoop.com` | เสร็จ (ข้าม bump installer) |
| **2** | LINE API → `api-line.nkbkcoop.com` | เสร็จ |
| **3** | Static V2 → Firebase Hosting | **เสร็จ** (รวม `portal.nkbkcoop.com`) |
| **4** | เอกสาร + อีเมล Cloudflare (แทน EmailJS) | **เสร็จ** — ส่งทดสอบจาก Admin ผ่าน (Workers Paid + onboard โดเมน) |
| **CMS** | เว็บองค์กร WP → Firestore | migrate **440/440** เสร็จ · **ผูก `nkbkcoop.com` แล้ว** (2026-05-25) |

---

## ลำดับงานต่อไป (ตามที่ตกลง)

| ลำดับ | งาน | สถานะ |
|-------|-----|--------|
| 1 | รอ / ข้ามช่วงรอ | — |
| 2 | ปรับหน้า CMS ให้เหมือน WP | **เสร็จ** (ธีม Tryo + หน้าแรกจาก WP page 27) |
| 3 | NAS | **ปิดแล้ว** (ทดสอบผ่าน) |
| 4 | ผูก `nkbkcoop.com` | **เสร็จ** (2026-05-25) |
| 5 | อีเมล Cloudflare | **เสร็จ** (2026-05-19) |
| 6 | Bump Monitor installer | **รอไปก่อน** |

---

## ตรวจสุขภาพระบบ (ล่าสุด)

| จุดตรวจ | URL / คำสั่ง | ผลที่คาดหวัง |
|---------|----------------|---------------|
| LINE API + อีเมล | `GET https://api-line.nkbkcoop.com/v1/health` | `"configured": true` |
| Monitor API | `https://monitor-api.nkbkcoop.com` | HTTP 200 |
| CMS หลัก | `https://nkbkcoop.com/` | HTTP 200 |
| CMS ทดสอบ (alias) | `https://admin-panel-nkbkcoop-cbf10.web.app/n/14499` | HTTP 200 |
| Admin อีเมล | Admin → ตั้งค่า → ระบบอีเมล → ส่งทดสอบ | ส่งสำเร็จ |

โดเมน Hosting อื่น ๆ: ตารางใน `HOSTING_DOMAIN_CHECKLIST.md`

---

## CMS (ทางเลือก B)

| รายการ | รายละเอียด |
|--------|-------------|
| โดเมนจริง | **https://nkbkcoop.com** — CMS Firebase (2026-05-25) |
| ทดสอบ (alias) | https://admin-panel-nkbkcoop-cbf10.web.app |
| URL | `/news`, `/n/{id}`, `/nkbkcoopmg` (rewrite → `post.html` ใน `firebase.json`) |
| ข้อมูล | Firestore `cms_posts`, `cms_pages`, `cms_categories`, `cms_site/settings` |
| รูป | Firebase Storage |
| Backup | Firestore รายวัน 30 วัน — `FIRESTORE_BACKUP.md`, `scripts/setup-firestore-backup.ps1` |

รายละเอียดเทคนิค: `NKBKCOOP_CMS_FIREBASE.md` · migrate: `scripts/migrate-wordpress-cms.js`

---

## Phase 4 — อีเมล Cloudflare (เสร็จแล้ว)

**สถาปัตยกรรม:** Admin → `https://api-line.nkbkcoop.com` → Cloud Function `lineApi` → `org-email.js` → Cloudflare Email Sending API

| รายการ | สถานะ |
|--------|--------|
| โดเมน `nkbkcoop.com` onboard (Sending) | เสร็จ — Enabled |
| Workers Paid | เสร็จ |
| Firebase secrets (`CLOUDFLARE_*`) | ตั้งแล้ว |
| Admin ลบ EmailJS, ใช้ `callEmailApi()` | deploy แล้ว |
| ส่งทดสอบจาก Admin | ผ่าน |

**ผู้ส่ง:** `support@nkbkcoop.com` (ไม่ใช้ Email Routing — คง MX Google ไว้)

### บำรุงรักษา (เมื่อเปลี่ยน token หรือแก้โค้ดอีเมล)

```powershell
cd NKBK\it
# แก้ scripts\cloudflare-email.env แล้ว:
.\scripts\set-cloudflare-email-secrets.ps1
node scripts/prepare-functions-deploy.js
firebase deploy --only functions:lineApi --project admin-panel-nkbkcoop-cbf10
```

ตรวจ: `https://api-line.nkbkcoop.com/v1/health` → `"configured": true`

Admin static — deploy ซ้ำเมื่อแก้ UI เท่านั้น:

```powershell
.\scripts\deploy-hosting-static.ps1 admin
```

รายละเอียดตั้งค่าครั้งแรก: `PHASE4_CLOUDFLARE_EMAIL_SETUP.md`  
แผนระยะยาว (ยังไม่ทำ): `PHASE4_EMAIL_ROADMAP.md`

---

## GitHub

| Repo | Remote | Branch ล่าสุด |
|------|--------|----------------|
| `NKBK/it` | [NKBKConnext-System](https://github.com/srsp-a/NKBKConnext-System) | `main` @ `79eb2d1` |
| `NKBK/Github/V2` | [admin-panel-nkbkcoop](https://github.com/srsp-a/admin-panel-nkbkcoop) | `main` @ `d101e02` |

ไม่ commit: `scripts/cloudflare-email.env`, service account keys, `hosting-dist/`, `functions/node_modules/`

### Admin URL (path-based, ไม่ใช้ `#`)

ดู [`docs/ADMIN_URL_ROUTING.md`](ADMIN_URL_ROUTING.md) — ตัวอย่างวาระประชุม: `https://admin.nkbkcoop.com/meetingdocs`

---

## ค้าง / ไม่บล็อกระบบหลัก

| รายการ | หมายเหตุ |
|--------|----------|
| Rotate Cloudflare API token | ถ้าเคยวาง token ในที่ไม่ปลอดภัย — รันขั้นตอนบำรุงรักษาด้านบน |
| ปรับ UI CMS | รอคำสั่ง |
| ผูก `nkbkcoop.com` | ท้ายสุด |
| Bump Monitor installer | เครื่องเก่าอาจยังชี้ URL เก่า — `MONITOR_FIREBASE_ROLLOUT.md` |
| Desktop `acknowledgeLeave` | deferred — `LEAVE_MENU_FLOW.md` |

---

## เอกสารอ้างอิง

| ไฟล์ | เนื้อหา |
|------|---------|
| `HOSTING_DOMAIN_CHECKLIST.md` | สถานะโดเมน + checklist สลับ nkbkcoop.com |
| `PHASE4_CLEANUP.md` | Security, monitoring |
| `PHASE4_CLOUDFLARE_EMAIL_SETUP.md` | ตั้งค่าอีเมล (ครั้งแรก / แก้ปัญหา) |
| `PHASE4_EMAIL_ROADMAP.md` | แผนอีเมลระยะยาว |
| `FIRESTORE_BACKUP.md` | Backup 30 วัน |
| `NKBKCOOP_CMS_FIREBASE.md` | CMS |
| `Github/V2/docs/DOMAINS.md` | โดเมนทั้งหมด |
