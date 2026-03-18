# NKBKConnext System

**Repository:** [github.com/srsp-a/NKBKConnext-System](https://github.com/srsp-a/NKBKConnext-System)

แอป Electron สำหรับตรวจสอบและจัดการข้อมูลระบบ (CPU, RAM, ดิสก์, เครือข่าย ฯลฯ) — ล็อกอินด้วยชื่อผู้ใช้ + PIN เจ้าหน้าที่ V2

## Push โค้ดขึ้น GitHub (ครั้งแรก)

```bash
git remote -v
git push -u origin main
```

ถ้า push ไม่ได้เพราะ SSH เป็น user อื่น → ดู `push-to-github.bat` หรือ `docs/GITHUB_RELEASE.md`

## ปล่อยเวอร์ชัน (อัปโหลด installer)

```bat
set GH_TOKEN=ghp_xxxx
npm run release
```

รายละเอียด: [docs/GITHUB_RELEASE.md](docs/GITHUB_RELEASE.md)

---

## ระบบตรวจสอบสถานะ (เดิม)

โปรแกรมแสดงสถานะและข้อมูลระบบของคอมพิวเตอร์ เช่น ชื่อเครื่อง, Windows, CPU, RAM, ดิสก์, เครือข่าย, GPU และอื่นๆ

## การติดตั้ง

```bash
npm install
```

## การรัน

```bash
npm start
```

จากนั้นเปิดเบราว์เซอร์ที่ **http://localhost:3333**

## ฟีเจอร์

- **ระบบปฏิบัติการ / ชื่อเครื่อง** – Hostname, Windows เวอร์ชัน, Build, สถาปัตยกรรม, Uptime
- **CPU** – รุ่น, ความเร็ว, จำนวนคอร์, % การใช้งาน
- **หน่วยความจำ (RAM)** – ใช้แล้ว/คงเหลือ/รวม และเปอร์เซ็นต์การใช้งาน
- **โปรเซส** – จำนวนโปรเซสทั้งหมดและที่กำลังรัน
- **Hardware** – ผู้ผลิตเครื่อง, รุ่น, Serial, UUID
- **GPU** – รุ่นการ์ดจอและ VRAM
- **ดิสก์** – รายการดิสก์และขนาด
- **เครือข่าย** – IP, MAC ตาม interface
- **แบตเตอรี่** – ระดับและสถานะ (ถ้าเป็นโน้ตบุ๊ก)

อัปเดตอัตโนมัติทุก 5 วินาที หรือกดปุ่มรีเฟรชเมื่อต้องการ
