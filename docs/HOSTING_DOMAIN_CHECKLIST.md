# Checklist โดเมน Hosting (อัปเดต 2026-05-19)

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
| **nkbkcoop.com** | **ยังเป็น WordPress** | CMS ทดสอบที่ `admin-panel-nkbkcoop-cbf10.web.app` |

## NAS ปิดแล้ว

- [x] Static → Firebase Hosting
- [x] LINE API → api-line
- [x] Monitor API → monitor-api
- [x] Firestore backup 30 วัน — `FIRESTORE_BACKUP.md`
- [x] CMS ข่าว 440 รายการ migrate จบ (2026-05-19)
- [ ] สลับ nkbkcoop.com จาก WordPress → Firebase CMS
