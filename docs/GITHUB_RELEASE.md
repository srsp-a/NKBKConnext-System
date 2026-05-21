# GitHub: srsp-a/NKBKConnext-System

**หมายเหตุ:** คำสั่ง `cd path\to\it` หรือ `cd path/to/it` ในเอกสารนี้หมายถึง **โฟลเดอร์รากของโปรเจกต์ที่มีไฟล์ `package.json`** — ไม่ใช่พิมพ์ตามตัวอักษร ให้แทนด้วย path จริงบนเครื่องคุณ เช่น `cd C:\Users\PC\Downloads\NKBK\it`

## v1.0.7 — หมายเหตุปล่อย

- **แก้ `no_session` / ภาพรวมว่างหลังล็อกอิน:** เมื่อล็อกอินผ่านโปร็กซี่ไป Monitor API แล้วได้โทเคน ระบบจะเก็บ session ใน RAM ของ `server.js` บนเครื่องด้วย — `/api/monitor-me` และเมนูที่ใช้โทเคน (เช่น **ลางาน**) ไม่พึ่งแค่การเรียก `/api/monitor-me` จาก Node ไปเซิร์ฟเวอร์ภายนอกอย่างเดียว
- **เข้มงวดหลังโหลดโปรไฟล์:** ถ้าทุกความพยายาม `/api/monitor-me` ไม่ได้ `ok` จะล้างโทเคนและส่งกลับหน้า login แทนการเปิดแอปในสภาพข้อมูลผู้ใช้ว่าง

ตั้งค่า tag release เป็น **`v1.0.7`** ให้ตรงกับ `version` ใน `package.json` *(ถ้ายังใช้ GitHub tag — การอัปเดตแอปหลักใช้ Firebase ตาม `docs/FIREBASE_DESKTOP_UPDATES.md`)*

**การอัปเดตแอปเดสก์ท็อป:** ใช้ **Firebase Hosting** — ไม่บังคับ GitHub Release — ดู **`docs/FIREBASE_DESKTOP_UPDATES.md`**

## ถ้า push ไม่ได้: Permission denied (SSH เป็น user อื่น)

เครื่องที่ SSH ผูกกับบัญชีอื่น (เช่น gloszilla-ai) จะ push ไป srsp-a ไม่ได้

**ทางแก้:** ใช้ HTTPS + Personal Access Token ของบัญชี **srsp-a**

```bat
cd path\to\it
git remote set-url origin https://github.com/srsp-a/NKBKConnext-System.git
git push -u origin main
```

Username: `srsp-a` — Password: ใส่ **token** (ไม่ใช่รหัสผ่าน GitHub)

## เชื่อม repo ครั้งแรก (ถ้ายังไม่ได้ทำ)

```bash
cd path/to/it
git init
git remote add origin git@github.com:srsp-a/NKBKConnext-System.git
git add .
git commit -m "Initial commit"
git branch -M main
git push -u origin main
```

(ในโปรเจกต์นี้ commit แรกทำไว้แล้ว — เหลือแค่ `git push`)

## ปล่อยเวอร์ชันแอปเดสก์ท็อป (หลัก — Firebase Hosting)

คู่มือเต็ม: **`docs/FIREBASE_DESKTOP_UPDATES.md`**

```bat
cd path\to\it
npm pkg set version=1.0.8
npm run build:installer
```

จากนั้นคัดลอกจาก **`dist/`** ไปที่ **`public-cms/desktop-app-updates/`** ใน repo — แก้ **`desktop-update-manifest.json`** (Portable) — แล้ว:

```bat
firebase deploy --only hosting:main
```

คำสั่ง **`npm run release`** build เท่านั้น (`publish never`) — **ไม่ใช้ `GH_TOKEN`**

## (ทางเลือก) อัปโหลดขึ้น GitHub Release

หากยังต้องการแจกผ่าน GitHub:

1. แก้เลขเวอร์ชันใน `package.json`
2. สร้าง Personal Access Token — สิทธิ์ `repo`
3. เปลี่ยน `build.publish` ใน `package.json` กลับเป็น `provider: github` แล้วใช้ `electron-builder --win --publish always` พร้อม `GH_TOKEN`

หรือ build ด้วย `npm run build:installer` แล้วแนบไฟล์ใน `dist/` ขึ้น Release ด้วยมือ

## แอปแบบ Portable บนเครื่องลูก

- หน้า **ล็อกอิน** อ่าน **`desktop-update-manifest.json`** จาก URL feed เดียวกับตัวติดตั้ง — มีเวอร์ชันใหม่จะแจ้งให้ดาวน์โหลด
- เมนูถาด → **ตรวจสอบอัปเดต** — ดาวน์โหลด Portable หรือเปิดหน้าโฟลเดอร์บน Hosting

แอปแบบติดตั้ง (NSIS) ใช้ **electron-updater** กับ **`latest.yml`** ในโฟลเดอร์เดียวกัน — เวอร์ชันใน `latest.yml` ต้องสูงกว่าแอปที่รันอยู่
