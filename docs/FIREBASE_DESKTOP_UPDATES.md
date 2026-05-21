# อัปเดต NKBKConnext Desktop — Firebase Hosting (ไม่พึ่ง GitHub Release)

แอปใช้ **electron-updater** โหมด **generic**: ดึง `latest.yml` + ตัวติดตั้ง `.exe` จาก URL สาธารณะบนโปรเจกต์ Firebase  
แบบ **Portable** ใช้ไฟล์ **`desktop-update-manifest.json`** ในโฟลเดอร์เดียวกัน

## URL เริ่มต้น

โฟลเดอร์บน Hosting (target **main**, `public-cms`):

`https://admin-panel-nkbkcoop-cbf10.web.app/desktop-app-updates/`

- **NSIS / ตัวติดตั้ง:** `${BASE}latest.yml` + ไฟล์ `.exe` และ `.exe.blockmap` ที่อ้างใน YAML  
- **Portable:** `${BASE}desktop-update-manifest.json`

## เปลี่ยน URL (ถ้าต้องการ)

| วิธี | ค่า |
|------|-----|
| `monitor-config.json` (ข้างไฟล์ exe / userData) | `"desktopUpdateFeedUrl": "https://โดเมนของคุณ/path/"` |
| ตัวแปรสภาพแวดล้อม | `DESKTOP_UPDATE_FEED_URL=https://.../` |
| เซิร์ฟเวอร์ในแอป | `DEFAULT_DESKTOP_UPDATE_FEED_URL` (ถ้าตั้งใน env ตอนรัน `server.js`) |

ค่าที่แอปได้จาก **`GET /api/config`** → `desktopUpdateFeedUrl` (มี fallback URL เดียวกับตารางด้านบน)

## ขั้นตอนปล่อยเวอร์ชัน

1. แก้ `version` ใน `package.json` (เช่น `1.0.8`)
2. Build Windows (แนะนำ — ได้ทั้ง NSIS + Portable):

```bat
cd path\to\it
npm run build
```

ถ้าต้องการแบ่งขั้น: `npm run build:installer` แล้ว `npm run build:portable`

3. **ซิงก์จาก `dist/` ไป `public-cms/desktop-app-updates/` + เขียน manifest อัตโนมัติ:**  
   จะคัดลอกเฉพาะของเวอร์ชันใน `package.json` (`latest.yml`, Setup + blockmap, Portable ของเวอร์ชันนั้น) และลบไฟล์เก่าในโฟลเดอร์ปลายทาง (ยกเว้น `README.md`)

```bat
npm run sync-desktop-updates
```

ถ้า Hosting ใช้โดเมนหรือ path อื่น (ไม่ใช่ค่าเริ่มต้นด้านบน):

```bat
set DESKTOP_UPDATE_PUBLIC_BASE_URL=https://โดเมนของคุณ/desktop-app-updates
npm run sync-desktop-updates
```

4. Deploy Hosting **main**:

```bat
firebase deploy --only hosting:main
```

หรือรวบเป็นเส้นเดียวหลังแก้เวอร์ชันแล้ว:

```bat
npm run publish-desktop-updates
```

ไฟล์ที่ควรอยู่ในโฟลเดอร์นี้หลังปล่อย:

| ไฟล์ | ใช้กับ |
|------|--------|
| `latest.yml` | แอปแบบติดตั้ง (NSIS) |
| `NKBKConnext System Setup x.x.x.exe` | ติดตั้งทับ |
| `*.exe.blockmap` | checksum |
| `desktop-update-manifest.json` | Portable |

ไฟล์ **`desktop-update-manifest.json`** ถูกสร้าง/อัปเดตโดย `npm run sync-desktop-updates` จากชื่อ Portable จริงใน `dist/` และ URL จาก `DESKTOP_UPDATE_PUBLIC_BASE_URL` (หรือค่าเริ่มต้น Firebase)

ถ้าต้องการแก้มือ (ไม่ใช้สคริปต์) ให้ตรงกับไฟล์ที่อัปโหลดจริง — ช่องว่างใน URL ให้เป็น `%20`:

```json
{
  "latestVersion": "1.0.8",
  "portableUrl": "https://admin-panel-nkbkcoop-cbf10.web.app/desktop-app-updates/NKBKConnext%20System%201.0.8%20Portable.exe",
  "portableFileName": "NKBKConnext System 1.0.8 Portable.exe"
}
```

## Cache / Headers

Hosting target **main** ตั้ง `Cache-Control: no-cache` สำหรับ `/desktop-app-updates/**` ใน `firebase.json` เพื่อให้ `latest.yml` และ manifest โหลดเวอร์ชันใหม่เร็วขึ้น

## หน้าแอดมิน — โปรแกรมและคอมพิวเตอร์

ใน repo **Admin (เช่น V2)** หน้า `#programs` มีแบนเนอร์ดาวน์โหลด **ตัวติดตั้ง (Setup)** เท่านั้น — ดึงเวอร์ชันจาก **`desktop-update-manifest.json`** แล้วสร้างลิงก์ `… Setup {version}.exe` จาก URL เดียวกับช่องทางอัปเดต desktop (มีปุ่มคัดลอกลิงก์ Setup)  

ถ้าต้องการให้แอดมินชี้โฟลเดอร์อื่น ให้ตั้งใน Firestore **`config/line_settings`** ฟิลด์ **`desktopUpdateFeedUrl`** (ไม่มี slash ท้าย — ระบบจะ normalize เหมือนแอป desktop)

## `npm run release`

ใน `package.json` ตั้งเป็น **`electron-builder --win --publish never`** — **ไม่ต้องใช้ `GH_TOKEN`**  
หลัง build ให้อัปโหลดไฟล์ขึ้น Firebase ตามขั้นตอนด้านบน

## CORS / HTTPS

Firebase Hosting เสิร์ฟ HTTPS อยู่แล้ว — เพียงพอสำหรับ electron-updater และการดาวน์โหลด Portable

## ถ้ายังอยากใช้ GitHub Release

เปลี่ยน `build.publish` ใน `package.json` กลับเป็น `provider: github` และใช้ workflow เดิมใน `docs/GITHUB_RELEASE.md` (ส่วนทางเลือก)
