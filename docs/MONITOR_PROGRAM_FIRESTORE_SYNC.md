# ซิงก์การ์ด “โปรแกรมและคอมฯ” ในแอดมิน (Firestore `programs`)

แอป NKBKConnext บน PC จะเขียนข้อมูลสด (OS, IP, RAM, Office ฯลฯ) ลง collection `programs` เป็นระยะ

## ทำไมแอดมินถึงไม่ขึ้น “Live” ทั้งที่เปิดแอปแล้ว

1. **ชื่อเครื่อง Windows ≠ ชื่อในการ์ดแอดมิน**  
   ตัวอย่าง: ใน Windows ชื่อเครื่องเป็น `GLOSZILLA-V` แต่ในแอดมินกำหนดเป็น `NKBK-GLOSZILLA`  
   ระบบจะค้นหาเอกสารที่ `device.computer_name` หรือ `name` **ตรงกับชื่อที่ลอง** — ถ้าไม่ตรง จะไปสร้าง/อัปเดตเอกสาร `ws_GLOSZILLA-V` แทน การ์ด UUID เดิมจึงไม่มี `nkbkConnextSync`

2. **แก้โดยใส่ชื่อในแอดมินเป็น alias** — แก้ไฟล์ **`monitor-config.json`** ข้าง `.exe` (หรือในโฟลเดอร์โปรเจกต์ตอน dev):

```json
{
  "monitorApiUrl": "https://nkbk.srsp.app",
  "programSyncAliases": ["NKBK-GLOSZILLA"]
}
```

หรือตั้ง environment (ตอนรันจาก cmd):

```text
set MONITOR_PROGRAM_SYNC_ALIASES=NKBK-GLOSZILLA
```

3. **แน่นอนที่สุด:** ตั้ง `MONITOR_PROGRAM_DOC_ID` เป็น **Document ID** ของการ์ดใน Firestore (UUID)

4. ต้องมี **`firebase-service-account.json`** ข้างแอป และแอปรันอยู่ (ซิงก์รอบแรกประมาณ 15 วินาที)

## ฟิลด์ที่ควรเห็นใน Firestore หลังซิงก์สำเร็จ

- `nkbkConnextSync: true`
- `connextHostname` (ชื่อจริงจาก Windows)
- `liveOsLabel`, `liveSoftwareLines`, `lastLiveSyncAt`, `liveTelemetry`

## หมายเหตุ

- เมื่อจับคู่กับการ์ดเดิมแล้ว ระบบ**จะไม่เขียนทับ** `name` / `device.computer_name` ใน Firestore (เก็บชื่อแสดงในแอดมินไว้)
- เอกสารใหม่แบบ `ws_<hostname>` ยังใช้ได้เมื่อยังไม่มีการ์ดในแอดมิน
