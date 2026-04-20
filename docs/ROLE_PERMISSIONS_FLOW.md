# ระบบสิทธิ์ (Role / Position / Menu) สำหรับ NKBKConnext

เอกสารนี้สรุปดีไซน์ของระบบสิทธิ์ที่ครอบคลุม **บทบาท (role)**, **ตำแหน่ง (position)**, และ **การอนุญาตใช้งานเมนู** ในแอปเดสก์ท็อป NKBKConnext ทั้งในปัจจุบันและเมนูที่จะเพิ่มในอนาคต

## 1. โมเดลข้อมูลปัจจุบัน (สรุปจากโค้ดจริง)

เอกสาร `users/{uid}` มี field สำคัญ:

| Field | ความหมาย | ค่าเดิม |
|---|---|---|
| `role` | บทบาท (ใช้โดย firestore.rules, admin web) | `ผู้ดูแลระบบ` / `ผู้ใช้` |
| `group` | กลุ่ม (ใช้โดย monitor / electron) | `เจ้าหน้าที่` / `กรรมการ` / `สมาชิก` |
| `position` | ตำแหน่ง (โหลดจาก collection `positions` หรือ `config/org.positions`) | เช่น `ผู้จัดการ`, `รองผู้จัดการ`, ... |

**การตรวจสิทธิ์เดิม** ใช้ string comparison เช่น
- `firestore.rules` → `isRoleAdmin() == role == 'ผู้ดูแลระบบ'`
- `admin/index.html` → `if (role !== 'ผู้ดูแลระบบ') reject`
- `it/server.js` → `v2UserMayAccessMonitor(u)` เทียบ `group`/`role` แบบตรงๆ

## 2. โมเดลข้อมูลใหม่

### 2.1 บทบาท (role) — 3 ระดับ

| Role | สิทธิ์พื้นฐาน |
|---|---|
| **ผู้ดูแลระบบ** | สูงสุด — เข้าถึงทุกอย่าง จัดการผู้ใช้ ตั้งค่าระบบ แก้สิทธิ์เมนู |
| **แอดมิน** | รอง — เข้าถึงทุกเมนูในแอป + จัดการข้อมูลทั่วไป แต่ไม่แก้โครงสิทธิ์/ไม่จัดการผู้ใช้ระดับสูง |
| **ผู้ใช้** | พื้นฐาน — เข้าถึงเฉพาะเมนูที่ได้รับอนุญาต |

> ในอนาคต: เพิ่มได้ไม่ยาก — ใช้เป็น array ใน `config/menu_permissions.roles` และ matrix ใน `rolePermissions[roleName]`

### 2.2 ตำแหน่ง (position) — 5 ระดับหลัก

| Position | ลำดับ (order) |
|---|---|
| ผู้จัดการ | 1 |
| รองผู้จัดการ | 2 |
| หัวหน้า | 3 |
| เจ้าหน้าที่ | 4 |
| พนักงาน | 5 |

> เก็บใน collection `positions/{id}` + fallback ใน `state.positions` — แก้ได้จากหน้า "โครงสร้างองค์กร" ของแอดมินเดิม

### 2.3 เมนูของแอปเดสก์ท็อป

ตารางปัจจุบัน + แผนเพิ่ม (ใช้ `id` เป็น key):

| `id` | ป้าย | หมายเหตุ |
|---|---|---|
| `overview` | ภาพรวม | แท็บปัจจุบัน |
| `webapp` | เว็บแอป | แท็บปัจจุบัน — รวม "เชื่อมต่อ NAS / Network Drive" และ "เชื่อมต่อกับเว็บไซต์" |
| `leave` | ลางาน | แท็บใหม่ — ดูการลาของตัวเอง + ยอดคงเหลือ; ผู้อนุมัติจะเห็น "คำขอรออนุมัติ" |
| `system` | ระบบ | แท็บปัจจุบัน |
| `storage` | จัดเก็บ | แท็บปัจจุบัน |
| `network` | เครือข่าย | แท็บปัจจุบัน — เครือข่ายทั่วไป + Speed Test |
| `software` | ซอฟต์แวร์ | แท็บปัจจุบัน |
| (future) | ... | เพิ่มใน matrix ได้ทันที ไม่ต้องแก้โค้ด |

## 3. Schema ใน Firestore

### เอกสาร `config/menu_permissions`

```json
{
  "roles": ["ผู้ดูแลระบบ", "แอดมิน", "ผู้ใช้"],
  "positions": ["ผู้จัดการ", "รองผู้จัดการ", "หัวหน้า", "เจ้าหน้าที่", "พนักงาน"],
  "menus": [
    { "id": "overview", "label": "ภาพรวม",    "order": 1 },
    { "id": "system",   "label": "ระบบ",      "order": 2 },
    { "id": "storage",  "label": "จัดเก็บ",   "order": 3 },
    { "id": "network",  "label": "เครือข่าย", "order": 4 },
    { "id": "software", "label": "ซอฟต์แวร์", "order": 5 }
  ],
  "rolePermissions": {
    "ผู้ดูแลระบบ": { "overview": true, "system": true, "storage": true, "network": true, "software": true },
    "แอดมิน":      { "overview": true, "system": true, "storage": true, "network": true, "software": true },
    "ผู้ใช้":      { "overview": true, "system": true, "storage": true, "network": false, "software": true }
  },
  "positionPermissions": {
    "ผู้จัดการ":    { "overview": true, "system": true, "storage": true, "network": true, "software": true },
    "รองผู้จัดการ": { "overview": true, "system": true, "storage": true, "network": true, "software": true },
    "หัวหน้า":      { "overview": true, "system": true, "storage": true, "network": true, "software": true },
    "เจ้าหน้าที่":  { "overview": true, "system": true, "storage": true, "network": false, "software": true },
    "พนักงาน":      { "overview": true, "system": true, "storage": false, "network": false, "software": true }
  },
  "defaultAllow": false,
  "updatedAt": "serverTimestamp",
  "updatedBy": "uid_of_admin"
}
```

### กฎการอนุญาต (Resolution)

สำหรับผู้ใช้ `u` ที่มี `role` + `position` เมื่อขอเข้าเมนู `m`:

1. ถ้า `role === "ผู้ดูแลระบบ"` → อนุญาตทุกเมนู (bypass)
2. ถ้า `role === "แอดมิน"` → อนุญาตทุกเมนู (bypass)
3. ไม่งั้น เช็ค **ทั้ง role และ position** ต้องอนุญาต
   - `rolePermissions[role][m] === true` **AND** `positionPermissions[position][m] === true`
4. ถ้าไม่เจอ role/position/menu ใน matrix → ใช้ `defaultAllow` (ดีฟอลต์ `false`)

> หมายเหตุ: **AND** — ให้ทั้งสองฝั่งยินยอมถึงผ่าน (ป้องกันกรณี admin ตั้ง role ให้ได้สิทธิ์แต่ตำแหน่งยังไม่ได้รับ)
> ถ้าต้องการ **OR** (ฝั่งใดฝั่งหนึ่งก็พอ) เปลี่ยนได้ในฟังก์ชัน resolve เท่านั้น

## 4. โฟลว์การทำงาน (End-to-end)

```
┌──────────────────┐
│ แอดมิน (เว็บ)    │
│ /admin/#settings │
│ → หน้า "สิทธิ์"   │
└────────┬─────────┘
         │ (1) บันทึก matrix
         ▼
┌──────────────────────┐
│ Firestore            │
│ config/menu_permissions │
└────────┬─────────────┘
         │ (2) อ่านตอน user login บน desktop
         ▼
┌────────────────────────┐
│ it/server.js           │
│ GET /api/me-permissions │─── resolve role+position → ส่ง allowedMenus[]
└────────┬───────────────┘
         ▼
┌────────────────────────┐
│ it/public/app.js       │
│ hide/show .tab-nav-btn │
│ ตาม data-tab ที่ไม่อยู่ │
│ ใน allowedMenus        │
└────────────────────────┘
```

### (1) แอดมินแก้สิทธิ์
- เปิดหน้า `#permissions` (ใหม่) บนเว็บ
- เห็นตาราง 2 ชุด: **Role × Menu** และ **Position × Menu** (checkbox)
- กด "บันทึก" → เขียน `config/menu_permissions` + timestamp

### (2) Desktop resolve สิทธิ์
- ตอน login/startup เรียก `/api/me-permissions` (ผ่าน monitor session token)
- Server อ่านเอกสารผู้ใช้ → อ่าน `config/menu_permissions` → resolve → ส่งกลับ
  ```json
  { "ok": true, "role": "ผู้ใช้", "position": "พนักงาน", "allowedMenus": ["overview","system","software"] }
  ```

### (3) Desktop apply
- ซ่อนแท็บที่ `data-tab` ไม่อยู่ใน `allowedMenus`
- ถ้าผู้ใช้ปัจจุบันอยู่บนแท็บที่ถูกซ่อน → สลับไปแท็บที่อนุญาตแท็บแรก

## 5. จุดที่ต้องแก้ในโค้ด

### Web admin (`V2/admin/index.html`)
- Dropdown `#urole` เพิ่ม option "แอดมิน"
- `submitUser` — รับ role ใหม่ (ไม่ต้อง validation พิเศษ)
- **หน้าใหม่** `#permissions-section` — ตาราง checkbox บันทึก `config/menu_permissions`
- `sidebar` เพิ่ม nav-item ไปหน้าใหม่

### Firestore rules (`firestore.rules`)
- `isRoleAdmin()` ครอบ `role in ['ผู้ดูแลระบบ','แอดมิน']`
- เพิ่มกฎ `match /config/menu_permissions { allow read: if signed-in; allow write: if isRoleAdmin() }`

### Desktop (`it/server.js` + `it/public/app.js`)
- Endpoint `GET /api/me-permissions` ต่อ session token → resolve
- `app.js` — หลัง login สำเร็จ call endpoint → `applyMenuPermissions(allowedMenus)`
- ฟังก์ชัน `applyMenuPermissions()` ซ่อน/แสดง `.tab-nav-btn` และ `.tab-panel`

### Login flows
- Web admin login (`/admin/login`): เพิ่ม "แอดมิน" เป็นบทบาทที่ผ่าน — บรรทัด ~18899 ใน index.html
- `v2UserMayAccessMonitor` — เพิ่ม `r === 'แอดมิน'` ในเงื่อนไข

### Migration
- ไม่ต้อง migrate เอกสาร users เดิม — ใครยังเป็น `ผู้ใช้` ก็คง `ผู้ใช้`, ใครเป็น `ผู้ดูแลระบบ` ก็คงเดิม
- Seed `config/menu_permissions` ครั้งแรก: ถ้าเอกสารไม่มี → สร้างจาก default matrix ในโค้ด

## 6. ความเข้ากันได้ย้อนหลัง

- ผู้ใช้เก่าที่มี role `ผู้ใช้` → ยังเข้าได้ แต่เมนูจะถูกจำกัดตาม matrix default
- ถ้า `config/menu_permissions` ยังไม่มี → `me-permissions` ส่ง `allowedMenus = [ทุกเมนู]` (เพื่อไม่ให้ผู้ใช้ถูกล็อกนอกแอปโดยไม่ตั้งใจ)
- เมื่อตั้ง `defaultAllow: false` + บันทึก matrix แล้ว ระบบจะบังคับจริง

## 7. แผนการ Rollout

1. **Phase 1 (ตอนนี้)**: แก้ dropdown/admin check + seed config/menu_permissions + สร้าง admin UI แก้ matrix + desktop ดึงสิทธิ์และซ่อนแท็บ
2. **Phase 2**: เพิ่มตัวเลือก `defaultAllow` / ตารางเมนูย่อย (sub-menu ของแต่ละแท็บ) / export-import matrix
3. **Phase 3**: Audit log เมื่อแอดมินแก้ matrix + แจ้งเตือน user ว่าเมนูถูกเปิด/ปิด

## 8. ความปลอดภัย

- Frontend ซ่อนแท็บเท่านั้น — **ต้องมีการเช็คสิทธิ์ซ้ำที่ server** สำหรับ endpoint sensitive (เช่น ลบ, แก้ข้อมูล)
- Firestore rules ต้องจำกัด write `config/menu_permissions` เฉพาะ `ผู้ดูแลระบบ` (ไม่ใช่ "แอดมิน") เพื่อไม่ให้แอดมินยกสิทธิ์ตัวเอง
- รหัสผ่านในเมนูที่เข้าไม่ได้ → ต้องไม่ถูกส่งกลับทาง API (กรองที่ endpoint)

## 9. Roadmap (ถ้าขยายในอนาคต)

- เพิ่ม custom permission ต่อผู้ใช้ (`users.{uid}.extraPermissions`) — override จาก role/position
- แบ่งสิทธิ์ **read** vs **write** ต่อเมนู (แทน allow/deny เดียว)
- กลุ่มตาม department/unit (ไม่ใช่แค่ role/position)
