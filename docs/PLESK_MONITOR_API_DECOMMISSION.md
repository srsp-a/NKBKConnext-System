# ปิด Monitor API บน Plesk (`nkbk.srsp.app/monitor-api`)

> ย้ายไป **https://monitor-api.nkbkcoop.com** (Firebase) แล้ว  
> **สถานะ (ตรวจ 2026-05-19):** `.../monitor-api/api/monitor-public-config` → **HTTP 404** (ปิดแล้ว) · Firebase ยัง **200 OK**

---

## ใน Plesk (ทำครั้งเดียว)

1. เข้า **Plesk** → โดเมน **`nkbk.srsp.app`**
2. **Node.js** (หรือ Application ที่รัน monitor-api)
3. **Stop / Disable** แอป `monitor-api` (หรือลบ application ถ้าไม่ใช้ path อื่นแล้ว)
4. (ถ้ามี) ลบ **Scheduled Tasks** / cron ที่เกี่ยวกับ monitor-api บน Plesk

## DNS (ถ้ามี subdomain แยก)

- ถ้า `nkbk.srsp.app/monitor-api` เป็น path ใต้โดเมนเดียว — หยุดแอปพอ
- ถ้ามี CNAME แยกชี้ Plesk โดยไม่จำเป็น — ลบหรือเปลี่ยนชี้

## ตรวจหลังปิด

```powershell
# ควรไม่ได้ JSON ของ Monitor API (หรือ 404/502)
curl.exe -sS -o NUL -w "%{http_code}" "https://nkbk.srsp.app/monitor-api/api/monitor-public-config"

# ต้องใช้ได้
curl.exe -sS "https://monitor-api.nkbkcoop.com/api/monitor-public-config"
```

## LINE Developers

ลบ Callback URL เก่าของ Plesk (ถ้ายังเหลือ):

- `https://nkbk.srsp.app/api/line-login-callback`
- `https://nkbk.srsp.app/monitor-api/api/line-login-callback`

เก็บ:

- `https://monitor-api.nkbkcoop.com/api/line-login-callback`
- `https://api-line.nkbkcoop.com/line/callback` (Portal)

---

**หมายเหตุ:** Agent ไม่มีสิทธิ์เข้า Plesk โดยตรง — ขั้นตอนด้านบนต้องกดใน Plesk Panel (หรือส่งให้ผู้ดูแลโฮสต์)
