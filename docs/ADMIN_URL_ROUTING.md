# Admin Panel — URL routing (path-based)

อัปเดต: 2026-05-29

## หลักการ

- **ใช้ path URL** ไม่ใช้ hash (`#`)
- ตัวอย่าง: `https://admin.nkbkcoop.com/meetingdocs`
- แดชบอร์ด: `https://admin.nkbkcoop.com/` (root)

## เทคนิค

1. Firebase Hosting (`hosting-dist/admin`) มี rewrite `**` → `/index.html`
2. ใน [`Github/V2/admin/index.html`](../Github/V2/admin/index.html):
   - `ADMIN_SECTIONS` — รายการ section ที่รองรับ
   - `getSectionFromPath()` — อ่านจาก `location.pathname` (hash เก่าจะถูก `replaceState` เป็น path)
   - `showSection()` — `history.replaceState` เป็น `/section`
   - `syncAdminNavHrefs()` — ตั้ง `href` ของ `.nav-item[data-section]` เป็น path

## วาระ/รายงานประชุม

| รายการ | ค่า |
|--------|-----|
| Section key | `meetingdocs` |
| URL | `/meetingdocs` |
| ไฟล์ | `meeting-docs.js`, `meeting-docs.css` |
| เมนู | หลัง «โครงสร้างกรรมการ» |

## Deploy

จาก repo `it`:

```powershell
cd c:\Users\PC\Downloads\NKBK\it
node scripts/prepare-hosting-deploy.js
.\scripts\deploy-hosting-static.ps1 admin
```

หรือ deploy ทั้งชุดตาม `docs/PHASE3_FIREBASE_HOSTING.md`

## หมายเหตุ

- ลิงก์ LINE ยังไป `/line/...` แยกต่างหาก
- อย่าแชร์ลิงก์แบบ `#section` — ระบบจะ redirect เป็น path อัตโนมัติเมื่อโหลดเวอร์ชันใหม่
