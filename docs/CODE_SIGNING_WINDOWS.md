# ลงลายเซ็น Windows (Authenticode) สำหรับ NKBKConnext System

บันทึกไว้ทำภายหลัง — ช่วยลดการถูก **Smart App Control / SmartScreen** บล็อกเมื่อติดตั้งบนเครื่องอื่น

## สิ่งที่ต้องมี

- ใบรับรอง **Code Signing สำหรับ Microsoft Authenticode** จาก CA (เช่น DigiCert, Sectigo, SSL.com, GlobalSign)
- **OV**: มักได้ไฟล์ `.pfx` + รหัสผ่าน — เก็บนอก repo อย่า commit
- **EV**: มักอยู่บน USB token — ลงลายเซ็นได้เมื่อเสียบ token; โดยทั่วไป **SmartScreen / reputation ดีขึ้นเร็วกว่า OV**

โปรเจกต์ใช้ **electron-builder + NSIS** — ตั้งค่าแล้วรัน build ตามปกติ ตัว builder จะลงลายเซ็นให้ installer และแอปเมื่อมี env ครบ

## วิธี build แบบมีลายเซ็น (เครื่องตัวเอง)

ก่อน `npm run build` หรือ `npm run build:installer`:

**PowerShell**

```powershell
$env:CSC_LINK = "C:\path\to\certificate.pfx"
$env:CSC_KEY_PASSWORD = "รหัสผ่าน-pfx"
npm run build:installer
```

**cmd**

```bat
set CSC_LINK=C:\path\to\certificate.pfx
set CSC_KEY_PASSWORD=รหัสผ่าน-pfx
npm run build:installer
```

อ้างอิง: [electron-builder Code Signing](https://www.electron.build/code-signing)

บน CI (เช่น GitHub Actions) ใช้ Secrets แทนการใส่รหัสใน repo; บางทีเก็บ PFX เป็น base64 ใน secret แล้ว decode ก่อน build ตามเอกสาร electron-builder

## หลัง build

- อัปโหลด **Setup ที่ลงลายเซ็นแล้ว** ไป GitHub Release แทนไฟล์เก่า
- เครื่องลูกค้าอาจยังเตือนครั้งแรกจนกว่าไฟล์จะมี **reputation** — โดยเฉพาะ OV อาจใช้เวลา; EV มักดีขึ้นเร็วกว่า

## ทางเลือกอื่น

- **Azure Trusted Signing** — ลงลายเซ็นผ่านบริการ Microsoft แทนการถือไฟล์ PFX บนเครื่อง (ต้องตั้งค่า Azure + เอกสาร Microsoft)

## เกี่ยวกับผู้ใช้ที่โดน SAC บล็อกอยู่แล้ว

เป็นนโยบาย Windows 11 ไม่ใช่บั๊ก installer — นอกจากลายเซ็นแล้ว ผู้ใช้บางรายอาจต้องปรับ **Smart App Control** ใน Windows Security (ตามสิทธิ์องค์กร)
