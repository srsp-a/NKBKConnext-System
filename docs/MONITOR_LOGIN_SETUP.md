# การตั้งค่าล็อกอิน Monitor (ชื่อผู้ใช้ + รหัส PIN 6 หลัก)

ระบบใช้ Firestore โปรเจกต์เดียวกับ V2

## ล็อกอินหลัก: เจ้าหน้าที่ V2 (ไม่ต้องสร้างซ้ำ)

- ใช้ **ชื่อผู้ใช้ + PIN 6 หลักเดียวกับที่ตั้งใน V2** (หน้าแก้ไขเจ้าหน้าที่) — อ่านจาก collection **`users`**
- เฉพาะกลุ่ม **เจ้าหน้าที่ / กรรมการ / ผู้ดูแลระบบ** (หรือไม่มีฟิลด์ `group`) — บัญชี `group` เป็น **สมาชิก** เข้าไม่ได้
- ถ้าชื่อผู้ใช้เป็นตัวเลขล้วน ระบบจะจัดเป็น 6 หลักแบบเดียวกับ V2 (เช่น `7368` → `007368`)

## บัญชีพิเศษ (ทางเลือก): collection `monitor_users`

ใช้เมื่อต้องการบัญชีที่**ไม่มีใน `users`** — สร้างด้วย `npm run create-monitor-user`

## โหมดล็อกอินผ่านเซิร์ฟเวอร์ (ไม่ต้องมีไฟล์ service account บนเครื่อง)

ถ้าแอป Monitor ตั้งค่าให้เรียก API บนเซิร์ฟเวอร์ (V2 / api.nkbkcoop.com) จะ**ไม่ต้องวางไฟล์ firebase-service-account.json** บนเครื่องลูก — เจ้าหน้าที่ล็อกอินด้วยชื่อ+PIN เดียวกับ V2 ได้เลย ดูรายละเอียดใน [MONITOR_REMOTE_LOGIN_AND_UPDATE.md](MONITOR_REMOTE_LOGIN_AND_UPDATE.md)

**อย่าวางไฟล์ service account ในชื่อ `monitor-config.json`** — ไฟล์นี้ต้องมีแค่ `{"monitorApiUrl":"..."}` เท่านั้น ถ้าวาง JSON คีย์ Firebase ผิดไฟล์ แอปจะไม่เห็น URL และจะไปถาม `firebase-service-account.json` แทน

- **ตัวติดตั้งใหม่:** มี **`monitor-config.json`** แพ็กมาข้าง `.exe` อยู่แล้ว (ชี้ api.nkbkcoop.com) — build ใหม่จาก repo นี้
- หรือตั้ง `MONITOR_API_URL` แทนได้

## 1. ไฟล์ Service Account (เมื่อไม่ใช้โหมด API เซิร์ฟเวอร์)

1. เปิด [Firebase Console](https://console.firebase.google.com/) เลือกโปรเจกต์ **admin-panel-nkbkcoop-cbf10**
2. ไปที่ **Project settings** (ไอคอนเฟือง) > **Service accounts**
3. กด **Generate new private key** แล้วดาวน์โหลดไฟล์ JSON
4. เปลี่ยนชื่อไฟล์เป็น **`firebase-service-account.json`**

### รันแบบโปรเจกต์ (npm start / node server.js)
วางไฟล์ไว้ที่โฟลเดอร์โปรเจกต์ (ระดับเดียวกับ `server.js`)

### แอปที่ติดตั้งแล้ว (หลัง build / Setup)
ไฟล์นี้**ไม่ถูกแพ็กเข้า installer** (เพื่อความปลอดภัย) ต้องคัดลอก **`firebase-service-account.json`** ไปวางอย่างใดอย่างหนึ่ง:

1. **ข้างไฟล์โปรแกรม** — โฟลเดอร์เดียวกับ `NKBKConnext System.exe` (เช่น `C:\Program Files\...\NKBKConnext System\`)
2. **โฟลเดอร์ข้อมูลแอป** — เปิด `%AppData%` แล้วเข้าโฟลเดอร์ชื่อแอป (เช่น `NKBKConnext System`) วางไฟล์ไว้ที่นั่น

จากนั้นปิดแอปแล้วเปิดใหม่

หรือกำหนด path ผ่านตัวแปรสภาพแวดล้อม:
```bash
set FIREBASE_SERVICE_ACCOUNT_PATH=C:\path\to\your\service-account.json
```

## 2. บัญชีพิเศษใน `monitor_users` (ไม่บังคับ)

ถ้าต้องการให้คนเข้า Monitor โดย**ไม่มีบัญชีใน `users`** ค่อยรัน:

```bash
npm run create-monitor-user -- <username> <pin 6 หลัก>
```

## 3. โครงสร้าง Firestore

- **Collection:** `monitor_users`
- **Document ID:** ชื่อผู้ใช้ (ตัวเล็ก, ไม่มีช่องว่าง) เช่น `admin`
- **Fields:**
  - `pinHash` (string) — รหัส PIN ที่ hash แล้ว
  - `salt` (string) — ค่า salt สำหรับ hash
  - `createdAt` (timestamp) — optional

## 4. การล็อกอินในแอป

- หน้า login: กรอก **ชื่อผู้ใช้** และ **รหัส PIN 6 หลัก**
- หลังล็อกอินสำเร็จ แอปจะเก็บ token ใน localStorage และใช้ตรวจสอบที่ `/api/monitor-me`
- ออกจากระบบ: กดปุ่ม "ออกจากระบบ" ที่ footer
