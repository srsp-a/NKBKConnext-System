# ตัวติดตั้ง + อัปเดต (Firebase Hosting — generic feed)

คู่มือปล่อยเวอร์ชันและโครงสร้างไฟล์: **`docs/FIREBASE_DESKTOP_UPDATES.md`**

## แนวทางที่แนะนำ

1. **แจกไฟล์ติดตั้ง** ใน `dist/` ชื่อแบบ `NKBKConnext System Setup x.x.x.exe`  
2. ผู้ใช้ **ติดตั้งครั้งเดียว** ลง Program Files (หรือโฟลเดอร์ที่เลือก)  
3. **อัปเดต** ผ่าน **HTTPS generic URL** — `electron-updater` อ่าน `latest.yml` จากโฟลเดอร์ที่โฮสต์บน Firebase (ค่าเริ่มต้นใน `package.json` → `build.publish.url`)  
4. **Portable** ใช้ **`desktop-update-manifest.json`** ในโฟลเดอร์เดียวกัน  
5. **monitor-config / API login** ตั้งที่เซิร์ฟเวอร์แล้ว — ไม่ต้องพึ่งไฟล์ config ฝั่งเครื่องลูกข่ายมากนักเมื่อใช้ remote login

## Build

- `build-installer.bat` หรือ `npm run build` / `npm run build:installer` → สร้าง **NSIS Setup** (`dist/*Setup*.exe`)  
- `npm run build:portable` → สร้าง **Portable .exe** แยกต่างหาก (ถ้าต้องการ)  
- Log แสดงบนหน้าต่าง CMD และบันทึก `build-last.log` — ถ้าไม่มี `dist` ให้ดู error ใน log  
- โฟลเดอร์ไม่บีบอัดทดสอบ: `npm run build:unpacked` → `dist/win-unpacked/`

## อัปเดตฝั่งผู้ใช้

- หลังเปิดแอป ~5 วินาที จะเช็ก feed generic อัตโนมัติ  
- **หน้า login**: ถ้ามีเวอร์ชันใหม่ (Portable จาก manifest / NSIS จาก updater) จะมีแถบแจ้ง  
- **เมนูถาด**: ตรวจสอบอัปเดต — Portable โหลดจาก manifest / NSIS ผ่าน electron-updater  

## ปล่อยเวอร์ชันใหม่

1. เพิ่ม `version` ใน `package.json`  
2. `npm run build:installer`  
3. คัดลอกไฟล์จาก `dist/` ขึ้น **`public-cms/desktop-app-updates/`** — แก้ **`desktop-update-manifest.json`** — `firebase deploy --only hosting:main`  

ไม่ต้องใช้ **`GH_TOKEN`** สำหรับ flow หลัก
