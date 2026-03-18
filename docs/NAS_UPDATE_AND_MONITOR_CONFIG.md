# วิธีอัปเดต line-webhook บน NAS + ตั้งค่า monitor-config

## สองส่วนที่ต้องทำ

| ส่วน | ทำที่ไหน | ทำอะไร |
|------|----------|--------|
| **1. อัปเดต line-webhook** | บน NAS (โฟลเดอร์ `web\line-webhook`) | ให้มี API ล็อกอิน Monitor แล้ว restart server |
| **2. monitor-config.json** | **บนเครื่องลูก** (ที่ติดตั้งแอป NKBKConnext) | วางข้างไฟล์ `.exe` เพื่อให้แอปล็อกอินผ่าน API |

---

## ส่วนที่ 1: อัปเดต line-webhook บน NAS

### ขั้นที่ 1 — คัดลอกไฟล์ server.js ไปที่ NAS

1. บนเครื่องคุณ เปิดโฟลเดอร์ **V2** ที่มีโค้ดล่าสุด (ที่มี Monitor API):
   - เช่น `C:\Users\PC\Downloads\NKBK\Github\V2\line-webhook\`
2. เปิดโฟลเดอร์บน NAS ตามภาพที่ส่งมา:
   - **Network → NKBKCOOP-DRIVE → web → line-webhook**
3. **คัดลอกไฟล์ `server.js`** จากโฟลเดอร์ V2 ไป **วางทับ** ที่โฟลเดอร์ `line-webhook` บน NAS  
   (ลากวาง หรือ Copy แล้ว Paste ในโฟลเดอร์ `web\line-webhook`)

ถ้าโฟลเดอร์ `web` บน NAS sync กับ Git อยู่ ก็ให้ **pull โค้ดล่าสุด** ในโฟลเดอร์นั้นแทนได้

### ขั้นที่ 2 — Restart line-webhook บน NAS

หลังอัปเดตไฟล์แล้ว ต้อง **restart กระบวนการ Node.js** ที่รัน line-webhook ถึงจะใช้โค้ดใหม่

**วิธีที่ 1: ผ่าน DSM (แนะนำถ้าไม่เคยใช้ SSH)**

1. เข้า **DSM** (เปิดเบราว์เซอร์ ใส่ IP ของ NAS เช่น `http://192.168.x.x:5000`)
2. ล็อกอินด้วยบัญชี admin ของ NAS
3. ไปที่ **Package Center** → หาแพ็กเกจที่ใช้รัน Node (เช่น **Node.js** หรือ **Node.js v18/v20**) แล้วดูว่ามีปุ่ม Restart หรือไม่  
   **หรือ**
4. ไปที่ **Control Panel → Task Scheduler**  
   - ถ้ามี Task ที่รัน line-webhook อยู่ (เช่นรัน `node server.js`) ให้กด **Run** หนึ่งครั้ง แล้วดูว่า Task เดิมจะ stop เองหรือต้อง Stop แล้ว Run ใหม่ (แล้วแต่ที่ตั้งไว้)

**วิธีที่ 2: ผ่าน SSH (ถ้ามีเปิดไว้)**

1. เปิด Command Prompt หรือ PowerShell แล้วพิมพ์:
   ```bash
   ssh admin@IP_OF_NAS
   ```
   (แทน `admin` และ `IP_OF_NAS` ด้วย user และ IP จริง)
2. พิมพ์รหัสผ่านเมื่อถาม
3. รันคำสั่ง:
   ```bash
   pkill -f "node server.js"
   cd /volume1/web/line-webhook
   nohup node server.js &
   ```
   หรือถ้าใช้ path อื่น (เช่น `/volume1/web/line-webhook` ตามที่ตั้งไว้) ให้ใช้ path นั้น

**หมายเหตุ:** path จริงอาจเป็น `\\NKBKCOOP-DRIVE\web` แปลงเป็นใน NAS เป็น `/volume1/web` หรืออื่นแล้วแต่การ mount — ถ้าไม่แน่ใจ path ใน SSH ให้ดูจาก Task Scheduler ว่าตั้ง `cd` ไปที่ไหน

### ขั้นที่ 3 — ทดสอบว่า API ทำงาน

บนเครื่องที่ออกเน็ตได้ เปิดเบราว์เซอร์ไปที่:

- `https://api.nkbkcoop.com/api/monitor-me`  
  (หรือ URL ที่ reverse proxy ชี้มาที่ line-webhook)

ถ้าไม่ error แปลว่า server รันอยู่ (อาจได้ response เป็น JSON ประมาณ `{"ok":false}` ก็ถือว่า endpoint ทำงาน)

---

## ส่วนที่ 2: monitor-config.json บนเครื่องลูก

**ตั้งแต่ build ใหม่:** ตัวติดตั้งจะแพ็ก **`monitor-config.json`** ไว้ข้าง `NKBKConnext System.exe` อัตโนมัติ (ชี้ `https://api.nkbkcoop.com`) — **ไม่ต้องสร้างมือ** หลังติดตั้งแล้วล็อกอินผ่าน API ได้ทันที (ถ้า line-webhook บน NAS อัปเดตแล้ว)

ถ้าใช้ **build เก่า** หรือลบไฟล์ไปแล้ว: สร้าง `monitor-config.json` ข้าง `.exe` เนื้อหา `{"monitorApiUrl": "https://api.nkbkcoop.com"}`

**ถ้าต้องการล็อกอินแบบ local** (ใช้ไฟล์ firebase-service-account บนเครื่อง): ลบหรือเปลี่ยนชื่อ `monitor-config.json` ออกจากโฟลเดอร์แอป

---

## สรุป

| ขั้นตอน | ทำที่ | สรุป |
|--------|--------|------|
| 1 | เครื่องคุณ (V2) → NAS (web\line-webhook) | คัดลอก `server.js` ไปทับที่ NAS |
| 2 | NAS (DSM หรือ SSH) | Restart กระบวนการ line-webhook |
| 3 | เครื่องลูก (ที่รันแอป) | วาง `monitor-config.json` ข้าง `.exe` ว่า `{"monitorApiUrl": "https://api.nkbkcoop.com"}` |

ถ้า line-webhook บน NAS ไม่ได้รันด้วย Task Scheduler หรือแพ็กเกจใน DSM แต่รันด้วยวิธีอื่น (เช่น service ฝั่ง Docker) ให้ใช้วิธี Stop/Start ตามที่ตั้งไว้สำหรับวิธีนั้น
