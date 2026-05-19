# Popup / Modal Dialogs — NKBKConnext System

เอกสารรวมทุก **popup/dialog** ที่ใช้ในระบบ (ทั้ง desktop app + V2 admin web) — บอกที่ตั้ง, ฟังก์ชันที่ใช้, และหลักในการเลือกใช้

> ห้ามใช้ `window.confirm()` / `window.alert()` / `window.prompt()` ตรงๆ ในโค้ดใหม่ — ใช้ helper ด้านล่างแทนเสมอ เพื่อให้ UI เนียนและเข้ากับธีมของระบบ

## 1. Desktop App (`it/public/`)

### `window.nkbkConfirm({ title, message, okText, cancelText, variant, icon })`
Modal ถามยืนยัน (OK/Cancel) — คืน `Promise<boolean>`

```js
const ok = await window.nkbkConfirm({
  title: 'ลบไฟล์นี้?',
  message: 'ย้อนกลับไม่ได้',
  okText: 'ลบ', cancelText: 'ยกเลิก',
  variant: 'danger'
});
if (!ok) return;
```

### `window.nkbkAlert({ title, message, variant } | 'text')`
Modal แจ้งเตือน (ปุ่มเดียว "ตกลง") — คืน `Promise<true>`

```js
await window.nkbkAlert({ title: 'สำเร็จ', message: 'บันทึกแล้ว', variant: 'success' });
// หรือสั้นๆ
await window.nkbkAlert('เกิดข้อผิดพลาด');
```

### `window.nkbkPrompt({ title, message, placeholder, defaultValue, okText, cancelText, variant })`
Modal ให้กรอกข้อความ — คืน `Promise<string | null>` (null = ยกเลิก)

```js
const reason = await window.nkbkPrompt({
  title: 'เหตุผลที่ไม่อนุมัติ',
  placeholder: 'เช่น เอกสารไม่ครบ',
  okText: 'ถัดไป', variant: 'warning'
});
if (reason === null) return; // ยกเลิก
```

### Variants ที่รองรับ
- `success` — เขียว (default สำหรับ confirm)
- `danger` — แดง (ลบ/ยืนยันอันตราย)
- `warning` — เหลือง (ถามก่อนออก)
- `info` — ฟ้า (แจ้งข้อมูล)

### Keyboard
- **Esc** = cancel
- **Enter** = ok / submit

### Styling
อยู่ใน `public/styles.css` หมวด `/* Unified app modal */` — แก้สี/ขนาดได้ที่:
- `.nkbk-modal-backdrop` — พื้นหลัง blur
- `.nkbk-modal` — กล่อง (gradient dark)
- `.nkbk-modal-btn-ok` / `-cancel` — ปุ่ม

---

## 2. V2 Admin Web (`V2/admin/index.html`)

### `window.confirmDialog({ title, message, okText, cancelText, variant })`
รูปแบบเดียวกับ desktop — ใช้สำหรับหน้าแอดมิน (ไม่ใช่ใน desktop app)

### `window.showConfirm(message, title?, type?)`
Legacy helper เก่าใน V2 admin — ยังใช้ได้ แต่แนะนำ `confirmDialog` สำหรับโค้ดใหม่

### `showToast(message, type)`
Toast แจ้งเตือนแบบ non-blocking

---

## 3. ตารางการใช้งานปัจจุบัน (Desktop App)

| จุดในแอป | ประเภท | Variant | ฟังก์ชัน |
|---|---|---|---|
| อนุมัติคำขอลา | confirm | success | `nkbkConfirm` |
| ไม่อนุมัติการลา (กรอกเหตุผล) | prompt → confirm | warning → danger | `nkbkPrompt` + `nkbkConfirm` |
| ดึงข้อมูลใบลาไม่สำเร็จ | alert | danger | `nkbkAlert` |
| ลาก POP-UP ถูกบล็อก | alert | warning | `nkbkAlert` |
| การลา — ผิดพลาดทั่วไป | alert | danger | `nkbkAlert` |

---

## 4. จุดที่ยัง**ไม่**ควรใช้ `nkbkModal`

### 4.1 Electron native `dialog` (main process)
`electron-main.js` ที่เรียก `dialog.showMessageBox()` ใช้ native Windows dialog — เหมาะกับ:
- ข้อผิดพลาดระดับระบบ (crash, file system error)
- การแจ้งก่อนรันคำสั่งระบบ (shortcut, startup)

### 4.2 Update overlay (`public/update-flow-overlay.js`)
Overlay เต็มจอสำหรับอัปเดต — มี style เฉพาะตัวเอง (ไม่ใช้ `.nkbk-modal`)
- ปัจจุบัน auto-install เมื่อ download เสร็จ (v1.0.7+) — ไม่ต้องมีปุ่ม
- `.nkbk-upd-panel[data-panel="ready"]` — พร้อมติดตั้ง → auto-quit 1.2s
- `.nkbk-upd-panel[data-panel="err"]` — ข้อผิดพลาดการดาวน์โหลด

### 4.3 Toast notification (`public/app.js`)
Non-modal toast ที่เด้งมุมจอ — ใช้ `showNotifToast(item)` หรือ Native Windows Toast ผ่าน `electronAPI.showNativeNotification()`

---

## 5. Checklist ตอนเพิ่ม popup ใหม่

1. **ต้องถามยืนยันก่อนทำงานที่ย้อนกลับไม่ได้** (ลบ, ส่ง, เปลี่ยน role ฯลฯ) → `nkbkConfirm`
2. **เลือก variant ให้ตรง**:
   - ลบ/ยืนยันอันตราย → `danger`
   - ข้อมูลทั่วไป → `info`
   - สำเร็จ → `success`
3. **ข้อความชัด** — title สั้น, message อธิบายผลที่จะเกิดขึ้น
4. **เขียน okText เฉพาะกับแต่ละ case** (ไม่ใช้ "OK" เสมอ) เช่น `ลบ`, `ส่ง`, `อนุมัติ`, `ไม่อนุมัติ`
5. **หลัง action เสร็จ** — ถ้า error ใช้ `nkbkAlert` variant danger
6. **ถ้าเป็นข้อความสำเร็จสั้นๆ** — ใช้ toast แทน modal

## 6. ตัวอย่างโค้ด

```js
// ลบรายการ
async function deleteItem(id) {
  const ok = await window.nkbkConfirm({
    title: 'ลบรายการนี้?',
    message: 'ข้อมูลจะถูกลบถาวรและย้อนกลับไม่ได้',
    okText: 'ลบ', cancelText: 'ยกเลิก', variant: 'danger'
  });
  if (!ok) return;
  try {
    await api.delete(id);
    // สำเร็จ → ใช้ toast (ไม่ใช้ modal)
    showNotifToast({ title: 'ลบเรียบร้อย', severity: 'success' });
  } catch (e) {
    await window.nkbkAlert({ title: 'ลบไม่สำเร็จ', message: e.message, variant: 'danger' });
  }
}
```

## 7. จุดที่ต้องตรวจเวลาปรับ UI

- `public/styles.css` → section "Unified app modal"
- `public/app.js` → function `nkbkModalShow` (ประมาณบรรทัด 1073+)
- อย่าลืมว่าการปรับ CSS ของ `.nkbk-modal-backdrop z-index: 120000` ต้องสูงกว่า `.notif-panel z-index: 90000` ไม่งั้นจะถูก notification panel ทับ
