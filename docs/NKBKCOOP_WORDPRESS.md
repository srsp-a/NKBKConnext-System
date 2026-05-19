# nkbkcoop.com (WordPress) vs Firebase

## สถานะปัจจุบัน

| URL | โฮสต์จริง | หมายเหตุ |
|-----|-----------|----------|
| https://nkbkcoop.com/ | **WordPress** (PHP + ฐานข้อมูล) ผ่าน **Cloudflare** | มี `wp-json`, `PHPSESSID` — **ไม่ใช่** Firebase Hosting |
| https://nkbkcoop-web.web.app | Firebase (ไฟล์ `index.html` จาก V2 — หน้า dev เท่านั้น) | ไม่ใช่เว็บองค์กรเต็มรูปแบบ |

ระบบ Admin / LINE / ลา / คิว แยก subdomain ไป Firebase แล้ว — **คนละส่วนกับเว็บหลัก WordPress**

---

## ย้าย WordPress ไป Firebase Hosting + Storage ได้ไหม?

### Firebase Hosting

- รองรับ **ไฟล์ static** (HTML, CSS, JS) + rewrite ไป Functions
- **ไม่รัน PHP / WordPress / MySQL** โดยตรง

ดังนั้น **ย้าย WordPress แบบยกเครื่องทั้งก้อนไป Hosting อย่างเดียว — ทำไม่ได้**

### Firebase Storage

- ใช้เก็บ **รูป/ไฟล์** (แทนหรือคู่กับ Cloudinary ใน Admin)
- **ไม่แทน** WordPress + ฐานข้อมูลข่าว/หน้าเว็บ

---

## ทางเลือกที่ทำได้

### A) เก็บ WordPress แต่ย้ายออกจาก NAS (แนะนำถ้าต้องการ WP ต่อ)

| ขั้น | รายละเอียด |
|------|------------|
| 1 | Backup WordPress (ไฟล์ + MySQL) จาก NAS |
| 2 | โฮสต์ใหม่: Cloudways, Hostinger, Plesk cloud, หรือ VPS + Docker |
| 3 | ชี้ **Cloudflare** (ที่ใช้อยู่) ไป origin ใหม่ |
| 4 | ปิด NAS — เว็บหลักไม่เกี่ยว Firebase Hosting |

เหมาะเมื่อต้องการ **แก้ข่าว/หน้าใน WP Admin** ต่อ

### B) ทำเว็บหลักใหม่บน Firebase (ไม่ใช้ WordPress)

| ขั้น | รายละเอียด |
|------|------------|
| 1 | ออกแบบเว็บ static หรือ Jamstack (ข่าวจาก Firestore / Headless CMS) |
| 2 | Deploy ขึ้น site `nkbkcoop-web` + ผูก `nkbkcoop.com` |
| 3 | รูปในเนื้อหา → **Firebase Storage** + Rules |
| 4 | ปิด WordPress หลังทดสอบ SEO/ลิงก์เดิม |

เหมาะเมื่อต้องการ **รวม stack บน Firebase** และยอมสร้างเว็บใหม่

### C) Static export จาก WordPress (จำกัด)

- ปลั๊กอินเช่น Simply Static → อัปโหลด HTML ขึ้น Firebase Hosting
- ฟอร์ม/ค้นหา/แจ้งโอนแบบ dynamic อาจพัง — ต้องทดสอบทีละหน้า
- ลิงก์ภายในและข่าวใหม่ต้อง export ใหม่ทุกครั้ง

### D) Hybrid (ใช้บ่อย)

- **nkbkcoop.com** → WordPress บนโฮสต์ที่รองรับ PHP (ไม่ใช่ NAS)
- **admin / api-line / leave / link** → Firebase (ทำแล้ว)
- รูปใน Admin → ค่อยย้าย Cloudinary → **Firebase Storage**

---

## สรุปคำแนะนำ

| เป้าหมาย | แนะนำ |
|----------|--------|
| ปิด NAS แต่เว็บหลักเหมือนเดิม | **A** — ย้าย WP ไปโฮสต์ WordPress |
| ทุกอย่างบน Firebase | **B** — สร้างเว็บหลักใหม่ + Storage (ไม่ยก WP ตรง ๆ) |
| เร็วที่สุด ไม่แตะ WP | คง WP บนโฮสต์ใหม่ + DNS Cloudflare |

**อย่า** ผูก `nkbkcoop.com` ไป site `nkbkcoop-web` ตอนนี้ — จะทับเว็บองค์กร WordPress ด้วยหน้า dev ไม่กี่ลิงก์

---

## ขั้นถัดไป (ถ้าเลือก Firebase สำหรับเว็บหลัก)

1. เก็บรายการ URL สำคัญจาก WP (ข่าว, แจ้งโอน, ดาวน์โหลด)
2. ตัดสินใจข่าว: Firestore collection / Google Doc / Headless WP
3. เปิด Firebase Storage + Rules
4. ออกแบบหน้าแรก static แล้ว deploy `nkbkcoop-web`
5. สลับ DNS `nkbkcoop.com` หลังทดสอบ
