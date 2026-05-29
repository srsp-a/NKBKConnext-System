# Checklist โดเมน Hosting (อัปเดต 2026-05-25)

## สถานะตรวจจากเครือข่าย

| โดเมน | สถานะ | หมายเหตุ |
|--------|--------|----------|
| admin.nkbkcoop.com | OK | Admin Panel |
| admin.nkbkcoop.com/portal | OK | Portal (path บน admin) |
| **portal.nkbkcoop.com** | **OK** | Hosting site `portal-nkbkcoop` (SSL พร้อมแล้ว) |
| admin.nkbkcoop.com/line | OK | LINE Management |
| link.nkbkcoop.com | OK | ผูกบัญชี LINE |
| leave.nkbkcoop.com | OK | LIFF ลา |
| register.nkbkcoop.com | OK | ลงทะเบียน |
| queue / random / q / qauto / payment | OK | Firebase Hosting |
| api-line.nkbkcoop.com | OK | LINE API + webhook |
| monitor-api.nkbkcoop.com | OK | Monitor API |
| **nkbkcoop.com** | **OK — CMS Firebase** | โดเมนหลักเว็บองค์กร · `/nkbkcoopmg` ดาวน์โหลดโปรแกรม |
| admin-panel-nkbkcoop-cbf10.web.app | OK | alias ทดสอบ / fallback |
| **meetdoc.nkbkcoop.com** | **รอ deploy** | พอร์ทัลวาระ/รายงานประชุม (กรรมการ) · Hosting `meetdoc-nkbkcoop` |

## Storage rules (meeting-docs PDF)

- กฎ `meeting-docs/**` อยู่ใน [`storage.rules`](../storage.rules) แล้ว
- Deploy ต้องใช้บัญชี Owner โปรเจกต์: `firebase login` แล้ว `firebase deploy --only storage` (SA ได้ 403)

## NAS ปิดแล้ว

- [x] Static → Firebase Hosting
- [x] LINE API → api-line
- [x] Monitor API → monitor-api
- [x] Firestore backup 30 วัน — `FIRESTORE_BACKUP.md`
- [x] CMS ข่าว 440 รายการ migrate จบ (2026-05-19)
- [x] สลับ nkbkcoop.com จาก WordPress → Firebase CMS (2026-05-25)
