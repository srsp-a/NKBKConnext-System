# ปิด line-webhook บน NAS

> LINE API อยู่ที่ **https://api-line.nkbkcoop.com** (Firebase)  
> **`api.nkbkcoop.com`** ไม่ใช้สำหรับ LINE — ว่างไว้สำหรับงานอื่น

---

## ก่อนปิด NAS

1. ผูก **`api-line.nkbkcoop.com`** ใน Firebase Hosting (site `api-line-nkbkcoop`)
2. `.\scripts\verify-line-api.ps1 https://api-line.nkbkcoop.com`
3. LINE Developers → Webhook → `https://api-line.nkbkcoop.com/line/webhook`
4. ทดสอบ LIFF / ลา / push

---

## ปิด NAS

หยุด `line-webhook` port 3001 และ proxy เก่าไป NAS

---

## ตรวจ

```powershell
Invoke-RestMethod https://api-line.nkbkcoop.com/
```
