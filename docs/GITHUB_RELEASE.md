# GitHub: srsp-a/NKBKConnext-System

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

## ปล่อยเวอร์ชันใหม่ + อัปโหลดไฟล์ติดตั้งขึ้น GitHub Release

1. แก้เลขเวอร์ชันใน `package.json` (ฟิลด์ `version` เช่น `1.0.1`)
2. สร้าง Personal Access Token ที่ GitHub: **Settings → Developer settings → Tokens** — สิทธิ์ `repo`
3. ใน PowerShell/CMD (Windows):

```bat
cd path\to\it
set GH_TOKEN=ghp_xxxxxxxxxxxx
npm run release
```

คำสั่งนี้จะ build แล้วอัปโหลดไฟล์ใน `dist/` ขึ้น **Release** บน GitHub (สร้าง tag `v1.0.1` ตาม version)

หรือ build เองแล้วอัปโหลดมือ:

```bat
npm run build:installer
```

จากนั้นไปที่ GitHub → **Releases** → **Draft a new release** → Tag `v1.0.1` → แนบไฟล์ `.exe` และ `latest.yml` จากโฟลเดอร์ `dist`

## แอปบนเครื่องลูก

หลังติดตั้งจาก Release แรก แอปจะเช็คอัปเดตจาก GitHub อัตโนมัติ (หลังเปิด ~15 วินาที) หรือคลิกถาดระบบ → **ตรวจสอบอัปเดต**
