# เมนู "ลางาน" ใน NKBKConnext (Desktop)

เอกสารนี้สรุปฟีเจอร์ของแท็บ "ลางาน" ในแอปเดสก์ท็อป และความเชื่อมโยงกับ Firestore ของระบบ V2

## 1. สิ่งที่ทำได้ในแท็บ "ลางาน"

### A. สำหรับผู้ใช้ทุกคน (ที่ล็อกอินแล้ว)
- **ยอดลาคงเหลือปีนี้** — แสดงแยกตามประเภทการลา (พร้อมเปอร์เซ็นต์ใช้ไปแล้ว)
- **รายการลาของฉัน** — การลาทั้งหมดของตัวเอง (ย้อนหลัง + ปัจจุบัน) สามารถกรองตามสถานะ
  - `pending` / `approved_lv1` / `approved` / `rejected` / `cancelled`

### B. สำหรับผู้อนุมัติ (`users.canApproveLeave == true` + ตำแหน่งเข้าเกณฑ์)
- **คำขอรออนุมัติของฉัน** — list คำขอที่ต้องอนุมัติ พร้อมปุ่ม **อนุมัติ / ไม่อนุมัติ**
- การระบุระดับ approver (อิงจาก `users.position`):
  - **Level 1 (ผู้จัดการ)**: position มี "ผู้จัดการ" และไม่มี "รอง" — อนุมัติขั้นสุดท้าย + **หักยอดลา**
  - **Level 2 (รองผู้จัดการ/หัวหน้า)**: position มี "รองผู้จัดการ" หรือ "หัวหน้า" — อนุมัติระดับกลาง (status → `approved_lv1`)

## 2. Firestore collections ที่ใช้

| Collection | Field / doc id | ใช้ทำอะไร |
|---|---|---|
| `users/{uid}` | `canApproveLeave`, `position`, `fullname`, `department` | ระบุว่าใครเป็น approver |
| `leaves/{id}` | `userId`, `type`, `partial`, `startDate`, `endDate`, `durationDays`, `status`, `reason`, `userName`, `userDept`, `createdAt` | ข้อมูลคำขอลา |
| `leaves/{id}` | `approvedByLevel1` / `approvedAtLevel1` / `approverName1` | หลังผู้จัดการอนุมัติ |
| `leaves/{id}` | `approvedByLevel2` / `approvedAtLevel2` / `approverName2` | หลังหัวหน้า/รองอนุมัติ |
| `leaves/{id}` | `rejectedAt` / `rejectedBy` / `rejectedByName` / `rejectReason` | หลังปฏิเสธ |
| `leave_types/{id}` | `nameTH`, `yearlyQuota`, `order` | ประเภทการลา |
| `leave_balances/{userId_YYYY}` | `items.{typeId}.{quota,used,remaining}` | โควต้า/ใช้ไป/คงเหลือ (ปีปฏิทิน) |

## 3. Endpoints ใน desktop (`it/server.js`)

ทุก endpoint ต้องส่ง header `X-Monitor-Token` (จาก monitor session) — ใช้ Firebase Admin SDK บนเครื่อง (ต้องมี `firebase-service-account.json`)

| Method | Path | หน้าที่ |
|---|---|---|
| `GET` | `/api/monitor-my-leaves` | รายการลาของ user ปัจจุบัน |
| `GET` | `/api/monitor-my-leave-balance` | ยอดลาคงเหลือรายประเภท (ปีปัจจุบัน) |
| `GET` | `/api/monitor-leave-pending-approvals` | คำขอที่ user คนนี้ต้องอนุมัติ (`canApprove=false` ถ้าไม่ใช่ approver) |
| `POST` | `/api/monitor-leave-approve` | อนุมัติ (body: `{leaveId}`) — Level 1 → `approved` + หักยอด; Level 2 → `approved_lv1` |
| `POST` | `/api/monitor-leave-reject` | ไม่อนุมัติ (body: `{leaveId, reason?}`) — เขียนฟิลด์ reject ครบ |

### การระบุระดับใน endpoint
ใช้ helper `_leaveClassify(user)` ที่ mirrors logic ใน `V2/leave/index.html → toggleApproveCard`

### การหักยอดเมื่ออนุมัติ Level 1
เมื่อ status เป็น `approved` จะอ่านเอกสาร `leave_balances/{userId}_{year}` → เพิ่ม `items[typeId].used += durationDays` → คำนวณ `remaining = quota - used` → `set({items}, { merge: true })` (เหมือน `approveLeave` ใน V2)

## 4. โฟลว์การอนุมัติ (mirror ของ V2 LIFF)

```
พนักงานสร้างคำขอ (ผ่าน LIFF / web)
    ↓ status = 'pending'
    ↓
หัวหน้า (Level 2) อนุมัติ?
    ↓ ใช่ → status = 'approved_lv1'
    ↓
ผู้จัดการ (Level 1) อนุมัติ?
    ↓ ใช่ → status = 'approved' + หักยอดลา
    ↓
จบ
```

**กรณีผู้จัดการอนุมัติก่อน** (ข้าม Level 2): Desktop endpoint ยอมรับได้ — ถ้า Level 1 เจอ status `pending` ก็อนุมัติเลย → `approved` + หักยอด (V2 มี `acknowledgeLeave` ให้หัวหน้ารับทราบทีหลัง แต่ desktop ยังไม่ implement — ข้อมูลยังถูกต้อง)

## 5. Permission

- แท็บ `leave` อยู่ใน `config/menu_permissions.menus` (default order=3) — ตั้งค่าได้ที่หน้าแอดมิน /admin/#permissions
- ถ้า role/position ถูก deny จาก matrix → แท็บ "ลางาน" จะถูกซ่อนในแอป

## 6. Security

- Desktop endpoint ตรวจสอบ `X-Monitor-Token` กับ `MONITOR_SESSIONS` (in-memory)
- ตรวจ `canApproveLeave` + `position` ก่อนอนุมัติ/ปฏิเสธเสมอ
- ป้องกันอนุมัติใบของตัวเอง (check `d.userId === u.id`)
- Firestore rules ปัจจุบันอนุญาตให้อ่าน `leaves` ได้ทั่วไป และเขียนต้อง login — ปลอดภัยพอสำหรับเดสก์ท็อปที่ผ่าน server

## 7. ยังไม่ implement (deferred)

- สร้างคำขอลาใหม่จากเดสก์ท็อป (ปัจจุบันใช้ LIFF/web — ไม่มีกล่อง form)
- ยกเลิกคำขอของตัวเอง
- อัปโหลดไฟล์แนบ
- `acknowledgeLeave` สำหรับหัวหน้า (เมื่อผู้จัดการอนุมัติก่อน)

ถ้าต้องการ feature เหล่านี้ แจ้งเพิ่มได้ — เพิ่ม endpoint และ UI ได้ไม่ยาก
