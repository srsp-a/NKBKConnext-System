# GitHub: srsp-a/NKBKConnext-System

## เชื่อม repo ครั้งแรก (จากโฟลเดอร์ `it`)

```bash
cd path/to/it
git init
git remote add origin git@github.com:srsp-a/NKBKConnext-System.git
git add .
git commit -m "Initial commit"
git branch -M main
git push -u origin main
```

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
