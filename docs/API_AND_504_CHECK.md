# ตรวจ API ล็อกอิน Monitor และเหตุ 504

## ในโปรเจกต์นี้ (NKBK/it และ NKBK/Github/V2)

### 1. API ล็อกอิน Monitor อยู่ที่ไหน
- **Path:** `Github/V2/line-webhook/server.js`
- **Endpoint:** `POST /api/monitor-login`
- **บรรทัดประมาณ:** 2462–2534
- **การทำงาน:** รับ `username` + `pin` (6 หลัก) → query Firebase collection `users` → ตรวจสิทธิ์ (เจ้าหน้าที่/กรรมการ/ผู้ดูแลระบบ) → ส่งกลับ `{ ok, token, username }` เป็น JSON

โค้ดใน V2 line-webhook **มี endpoint ครบ** และตอบเป็น JSON เสมอ

### 2. โฟลเดอร์ที่รัน exe กับ config
- **Portable:** ไฟล์ exe อยู่ที่ `it/dist/NKBKConnext System 1.0.0 Portable.exe`
- **Unpacked:** `it/dist/win-unpacked/NKBKConnext System.exe` และมี `monitor-config.json` อยู่ในโฟลเดอร์เดียวกัน
- **ที่มาของ config:** ตอน build ใช้ `build-includes/monitor-config.json` (หรือ fallback ใน `scripts/after-pack-monitor-config.js`) → คัดลอกไปที่ `win-unpacked/monitor-config.json`
- **ค่าใน config:** `{ "monitorApiUrl": "https://api.nkbkcoop.com" }` → แอปจะเรียกล็อกอินที่ API นี้

ถ้ารัน exe จากโฟลเดอร์ในโปรเจกต์ (เช่น `it/dist` หรือ `it/dist/win-unpacked`) จะใช้ `monitor-config.json` ในโฟลเดอร์นั้น

### 3. ทำไมได้ HTTP 504 (Gateway Timeout)
- **504** หมายถึง reverse proxy (เช่น Nginx) รอ **upstream** (เซิร์ฟเวอร์ที่รัน line-webhook) ไม่ทัน แล้วตัดตอบ 504
- **ไม่ใช่** แอป Monitor หรือโค้ดใน repo นี้ผิดโดยตรง แต่เป็นฝั่ง **เซิร์ฟเวอร์ที่โฮสต์ api.nkbkcoop.com**
- สาเหตุที่เป็นไปได้:
  1. บน NAS/เซิร์ฟเวอร์ **ไม่ได้รัน line-webhook** หรือรันแต่ไม่ได้รับ request ไปที่ path `/api/monitor-login`
  2. **Timeout ของ proxy สั้นเกินไป** (เช่น 60 วินาที) ขณะที่ Firebase query ช้า
  3. **line-webhook ล่มหรือค้าง** จึงไม่ตอบทัน
  4. **api.nkbkcoop.com** ชี้ไปที่โปรเจกต์อื่น (เช่น admin-panel-nkbkcoop) ที่ไม่มี route `/api/monitor-login` → proxy อาจส่งต่อไปที่อื่นแล้ว timeout

### 4. Repo admin-panel-nkbkcoop
- Repo **admin-panel-nkbkcoop** (`git@github.com:srsp-a/admin-panel-nkbkcoop.git`) **ไม่อยู่ใน workspace นี้** (เปิดเฉพาะ NKBK/it และ NKBK/Github/V2)
- ถ้า **api.nkbkcoop.com deploy จาก admin-panel-nkbkcoop** ต้องเช็คใน repo นั้นว่า:
  - มี route `POST /api/monitor-login` หรือไม่
  - หรือว่า api.nkbkcoop.com ต้อง **proxy ไปที่ line-webhook (V2)** แทน
- ถ้า deploy จาก **V2 line-webhook** ต้องให้แน่ใจว่าเซิร์ฟเวอร์รัน line-webhook ล่าสุด และ proxy ตั้ง timeout พอ (เช่น 90–120 วินาที)

### 5. ทางเลือกถ้าไม่อยากพึ่ง api.nkbkcoop.com ตอนนี้

#### A. ใช้ URL สำรอง (Fallback) — แก้ในแอป ไม่ต้องรอแก้ Nginx

แอป Monitor รองรับ **monitorApiUrlFallback** ใน `monitor-config.json`: ถ้าโดเมนหลัก (api.nkbkcoop.com) ตอบ 502/504 หรือ timeout แอปจะลอง URL สำรองอัตโนมัติ (เช่น IP NAS ใน LAN)

แก้ `monitor-config.json` ข้าง exe เป็น:

```json
{
  "monitorApiUrl": "https://api.nkbkcoop.com",
  "monitorApiUrlFallback": "http://192.168.1.244:3001"
}
```

(เปลี่ยน `192.168.1.244` ให้ตรง IP LAN ของ NAS)  
เมื่ออยู่ที่ออฟฟิศ ถ้าโดเมน timeout/504 จะลองเรียกตรง NAS เอง — ไม่ต้องเปลี่ยน config กลับไปกลับมา

#### A2. ชี้ตรงไป line-webhook บน NAS เท่านั้น (เมื่ออยู่ในออฟฟิศ)
แก้ `monitor-config.json` เป็น (เปลี่ยน IP ให้ตรง NAS):

```json
{ "monitorApiUrl": "http://192.168.1.244:3001" }
```

จะไม่ผ่าน `api.nkbkcoop.com` → ไม่โดน 504 จาก gateway (แต่ NAS ยังต้องออกเน็ตไป Firestore ได้อยู่ดี)

#### B. แก้ Nginx หน้า api.nkbkcoop.com (ผู้ดูแลเซิร์ฟเวอร์)

**สำคัญ:** `/line/webhook` กับ `/api/monitor-login` ต้องไปที่ **upstream เดียวกัน** (line-webhook พอร์ต 3001) ถ้า Nginx แยก `location /api/` ไปอีกเครื่อง จะได้ 502/504

ตัวอย่างให้ **ทั้ง site api.nkbkcoop.com** ส่งไป line-webhook เดียว + timeout ยาว:

```nginx
server {
    listen 443 ssl;
    server_name api.nkbkcoop.com;
    # ssl_certificate ...

    location / {
        proxy_pass http://127.0.0.1:3001;   # หรือ http://NAS_IP:3001 / tunnel
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_connect_timeout 30s;
        proxy_send_timeout 120s;
        proxy_read_timeout 120s;
    }
}
```

ถ้าตอนนี้ `/api/` ไปอีก upstream (เช่น admin พอร์ต 3000) ให้เพิ่ม **location เฉพาะ** ให้ `/api/monitor-login`, `/api/monitor-me`, `/api/monitor-logout` ไปที่ 3001 แทน:

```nginx
location ~ ^/api/monitor-(login|me|logout) {
    proxy_pass http://127.0.0.1:3001;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_connect_timeout 30s;
    proxy_send_timeout 120s;
    proxy_read_timeout 120s;
}
```

#### C. ล็อกอินแบบโลคัล (Firebase ในเครื่อง)
- วาง **firebase-service-account.json** ไว้โฟลเดอร์เดียวกับ exe
- ลบ `monitorApiUrl` ออกจาก **monitor-config.json** หรือใช้ `{ "monitorApiUrl": "" }` (ต้องไม่มีค่า URL)
- แอปจะใช้ Firebase จากไฟล์ในเครื่องแทน
