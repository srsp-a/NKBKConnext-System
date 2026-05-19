# เว็บองค์กร nkbkcoop.com → Firebase (ทางเลือก B)

ข้อมูลจาก WordPress อยู่ใน **Firestore** รูปใน **Storage** เว็บอ่านอยู่ **Firebase Hosting** (ยังไม่ผูกโดเมนหลัก)

## URL ชั่วคราว

- https://admin-panel-nkbkcoop-cbf10.web.app  
- https://admin-panel-nkbkcoop-cbf10.firebaseapp.com  

เมื่อเว็บพร้อมค่อยผูก `nkbkcoop.com` ใน Hosting > Add custom domain (อย่าผูกก่อน WP ยังอยู่)

## Collections

| Collection | เนื้อหา |
|------------|---------|
| `cms_posts` | ข่าว/ประกาศ |
| `cms_pages` | หน้าคงที่ |
| `cms_categories` | หมวดหมู่ |
| `cms_site/settings` | ชื่อเว็บ + เวลา migrate ล่าสุด |

Storage: `cms/wp/media/*` (อ่าน public)

**สำคัญ:** เปิด Firebase Storage ก่อน (Console → Storage → Get started) แล้วค่อย `firebase deploy --only storage` และรัน migrate อีกครั้งเพื่อย้ายรูปจาก WP

## ย้ายข้อมูลจาก WordPress

ต้องเข้า `https://nkbkcoop.com/wp-json/` ได้ (ผ่าน Cloudflare)

```powershell
cd NKBK\it
node scripts/migrate-wordpress-cms.js --all --posts-only
node scripts/migrate-wordpress-cms.js --limit=50
```

ลิงก์ข่าวสั้น: `https://admin-panel-nkbkcoop-cbf10.web.app/n/146` (ใช้ WP post id)
PDF ในข่าวจะแสดงฝังในหน้า (iframe) ไม่เปิดแท็บใหม่

## Deploy เว็บ CMS

```powershell
cd NKBK\it
firebase deploy --only hosting:main,firestore:rules,storage --project admin-panel-nkbkcoop-cbf10
```

## Backup อัตโนมัติ

ดู [FIRESTORE_BACKUP.md](./FIRESTORE_BACKUP.md) — รัน `.\scripts\setup-firestore-backup.ps1` หลัง `gcloud auth login` (บัญชี Owner)
