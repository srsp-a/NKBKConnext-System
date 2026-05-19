# Monitor API — Firebase Phase 1 (เสร็จแล้ว)

> **URL หลัก:** https://monitor-api.nkbkcoop.com  
> **Hosting สำรอง:** https://monitor-api-nkbkcoop.web.app  
> **Deploy:** `firebase deploy --only functions:monitorApi,hosting:monitor` (จาก repo `NKBK/it`)

---

## สถานะ

| รายการ | สถานะ |
|--------|--------|
| Functions + Hosting | ✅ |
| โดเมน `monitor-api.nkbkcoop.com` | ✅ |
| ล็อกอิน user/PIN | ✅ |
| LINE Login | ✅ |
| `build-includes/monitor-config.json` | ✅ ชี้โดเมนใหม่ |
| Firestore `config/line_settings` | ✅ `monitorApiUrl` → Firebase |
| แอป 2–3 เครื่อง | ⬜ อัปเดตตอนเปลี่ยนเวอร์ชันโปรแกรม (build ใหม่มี config ใน installer) |
| ปิด Plesk `nkbk.srsp.app/monitor-api` | ✅ (ตรวจแล้ว HTTP 404) |

---

## แอป NKBKConnext (เครื่องที่ยังไม่ได้อัปเดต)

คัดลอก **`build-includes/monitor-config.json`** → ข้าง `NKBKConnext System.exe` เป็น **`monitor-config.json`**

```json
{
  "monitorApiUrl": "https://monitor-api.nkbkcoop.com",
  "programSyncAliases": [],
  "systemSnapshotUploadSecret": "<ค่าเดียวกับ Firebase secret>",
  "monitorSystemPublicReadKey": "<ค่าเดียวกับ secret>"
}
```

- **อย่าใส่** `lineLoginChannelId` / `lineLoginChannelSecret` บนเครื่องลูก  
- **ไม่ต้อง** build `.exe` ใหม่ — รีสตาร์ทแอปพอ

---

## LINE Developers

Callback (Monitor):

`https://monitor-api.nkbkcoop.com/api/line-login-callback`

Callback (Portal — เก็บไว้):

`https://api-line.nkbkcoop.com/line/callback`

---

## หน้า workstations

```
https://monitor-api.nkbkcoop.com/workstations.html?key=MONITOR_SYSTEM_PUBLIC_READ_KEY
```

---

## Firestore (Admin) — อัปเดตแล้ว

`config/line_settings.monitorApiUrl` = `https://monitor-api.nkbkcoop.com`  
(`callbackUrl` / `webhookUrl` ของ Portal ไม่เปลี่ยน)

รันซ้ำได้: `node scripts/update-line-settings-firestore.js`

---

## เช็กสุขภาพ API

```powershell
cd NKBK\it
.\scripts\verify-monitor-api.ps1
```

---

## ปิด Plesk (เมื่อพร้อม)

1. ทดสอบ sync สเปก + ล็อกอิน + LINE บนทั้ง 3 เครื่อง  
2. ปิด Node app `monitor-api` บน Plesk / ลบ DNS ชี้ `nkbk.srsp.app/monitor-api`  
3. Phase ถัดไป: ย้าย `line-webhook` → Firebase (`Github/V2/docs/FIREBASE_MIGRATION_PLAN.md` Phase 2)
