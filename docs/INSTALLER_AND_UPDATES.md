# ตัวติดตั้ง + อัปเดต (GitHub)

## แนวทางที่แนะนำ

1. **แจกแค่ไฟล์ติดตั้ง** ใน `dist/` ชื่อแบบ `NKBKConnext System Setup x.x.x.exe`  
2. ผู้ใช้ **ติดตั้งครั้งเดียว** ลง Program Files (หรือโฟลเดอร์ที่เลือก)  
3. **อัปเดต** ผ่าน **GitHub Releases** — โปรแกรมใช้ `electron-updater` ตรวจจาก repo ใน `package.json`  
4. **monitor-config / API login** ตั้งที่เซิร์ฟเวอร์ (line-webhook) แล้ว — ไม่ต้องพึ่งไฟล์ config ฝั่งเครื่องลูกข่ายมากนักเมื่อใช้ remote login

## Build

- `build-installer.bat` → สร้าง **NSIS เท่านั้น** (ไฟล์ Setup ใน `dist/`)  
- Log แสดงบนหน้าต่าง CMD และบันทึก `build-last.log` — ถ้าไม่มี `dist` ให้ดู error ใน log  
- โฟลเดอร์ไม่บีบอัดทดสอบ: `npm run build:unpacked` → `dist/win-unpacked/`

## อัปเดตฝั่งผู้ใช้

- หลังเปิดแอป ~5 วินาที จะเช็ก GitHub อัตโนมัติ  
- **หน้า login**: ถ้ามีเวอร์ชันใหม่ จะมีแถบแจ้ง — กดดาวน์โหลดหรือข้ามไปก่อน  
- **เมนูถาด**: ตรวจสอบอัปเดต (เหมือนเดิม)

## ปล่อยเวอร์ชันใหม่

1. เพิ่ม `version` ใน `package.json`  
2. สร้าง tag บน GitHub แล้วอัปโหลดไฟล์ Setup ไปที่ Release  
3. หรือใช้ `npm run release` (publish always) ถ้าตั้ง token แล้ว
