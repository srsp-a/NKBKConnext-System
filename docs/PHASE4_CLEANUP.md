# Phase 4 — ทำความสะอาด + เอกสาร + ความปลอดภัย

> อัปเดต: 2026-05-19  
> NAS ปิดแล้ว · Phase 3 ครบ (รวม `portal.nkbkcoop.com`)

---

## สิ่งที่ทำใน Phase 4 (รอบนี้)

### 1. อัปเดตเอกสารโดเมนและสถานะ

- `docs/MIGRATION_STATUS.md` — ภาพรวม + ลำดับงานต่อไป
- `docs/HOSTING_DOMAIN_CHECKLIST.md` — portal = OK, backup 30 วัน
- `Github/V2/docs/DOMAINS.md` — สถาปัตยกรรมหลังย้าย Firebase (ไม่พึ่ง NAS)
- `Github/V2/docs/FIREBASE_MIGRATION_PLAN.md` — เช็คลิสต์ Phase 3/4

### 2. ความปลอดภัย Firebase (แนวทาง — ไม่ลบ apiKey ออกจาก client)

Firebase Web SDK **ต้องมี apiKey ใน client** — ปลอดภัยเมื่อจำกัดที่ Console:

| ขั้นตอน | ที่ทำ |
|---------|--------|
| จำกัด API key | [Google Cloud Console → APIs & Services → Credentials](https://console.cloud.google.com/apis/credentials?project=admin-panel-nkbkcoop-cbf10) → API key → **Application restrictions** = HTTP referrers → เพิ่ม `https://admin.nkbkcoop.com/*`, `https://*.nkbkcoop.com/*`, `https://admin-panel-nkbkcoop-cbf10.web.app/*`, `http://localhost:*` |
| Authorized domains | [Firebase → Authentication → Settings](https://console.firebase.google.com/project/admin-panel-nkbkcoop-cbf10/authentication/settings) → มีโดเมน production + localhost |
| App Check (แนะนำ) | [Firebase → App Check](https://console.firebase.google.com/project/admin-panel-nkbkcoop-cbf10/appcheck) — เปิดสำหรับ Firestore / Storage ภายหลัง |
| อย่าใส่ secret ใน static | LINE channel secret, service account — อยู่ Functions env / Secret Manager เท่านั้น |

### 3. Monitoring & backup

| รายการ | สถานะ |
|--------|--------|
| Firestore scheduled backup | รายวัน 30 วัน — `FIRESTORE_BACKUP.md` |
| ดู backup | GCP → Firestore → Disaster recovery (บัญชี `gloszilla`, แท็บ **All** เลือกโปรเจกต์) |
| Functions logs | [Cloud Logging](https://console.cloud.google.com/logs?project=admin-panel-nkbkcoop-cbf10) — filter `resource.type="cloud_function"` |
| Hosting / uptime | ตรวจด้วนมือหรือ UptimeRobot สำหรับ admin, api-line, monitor-api |
| Billing alerts | [Billing → Budgets](https://console.cloud.google.com/billing) — ตั้งงบเตือน Blaze |

### 4. อีเมล (แผนถัดไป — ยังไม่ implement)

ดู `PHASE4_EMAIL_ROADMAP.md` และ `Github/V2/docs/email-cloudflare-design.md`

---

## Checklist Phase 4 (สำหรับทีม)

- [x] อัปเดตเอกสารโดเมน / สถานะ migration
- [x] บันทึกภาพรวม `MIGRATION_STATUS.md`
- [ ] จำกัด Firebase API key ที่ Google Cloud Console (ทำมือ 5 นาที)
- [ ] ตรวจ Authorized domains ครบ
- [x] โค้ด Cloudflare Email API (`line-webhook/org-email.js` + Admin เรียก `/v1/send`)
- [ ] ตั้ง Cloudflare secrets + deploy (ดู `PHASE4_CLOUDFLARE_EMAIL_SETUP.md`)
- [ ] (ถัดไป) Firebase App Check
- [ ] (ถัดไป) CMS migrate 440 ข่าวจบ + ผูก nkbkcoop.com
