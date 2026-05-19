# รายการโดเมนและ URL — NKBK



เอกสารฉบับเต็ม (ครอบคลุม **V2 + it + NAS + ภายนอก**) อยู่ที่:



**`NKBK/Github/V2/docs/DOMAINS.md`**



---



## สรุปเฉพาะ repo นี้ (`NKBK/it` — NKBKConnext Monitor)



| โดเมน / URL | ใช้งาน |

|------------|--------|

| `https://api-line.nkbkcoop.com` | LINE API (webhook, portal callback) — Firebase |

| `https://api.nkbkcoop.com` | **ว่างไว้** — งานอื่นในอนาคต (ไม่ใช้ LINE) |

| `https://monitor-api.nkbkcoop.com` | Monitor API บน Firebase (หลัก) — `build-includes/monitor-config.json` |

| `https://monitor-api-nkbkcoop.web.app` | Hosting สำรอง Firebase |

| `https://nkbk.srsp.app/monitor-api` | Plesk เก่า — ปิดแล้ว |

| `http://localhost:3333` | หน้าเว็บในแอป |

| `http://oa.nkbkcoop.com/nkh` | ระบบสมาชิกเก่า (default web URL) |

| `https://led-ck.com` | ล็อกอินอีกระบบ (รองรับใน Electron) |



**ไฟล์ config**



- `build-includes/monitor-config.json` — ชี้ `monitor-api.nkbkcoop.com`

- `docs/MONITOR_FIREBASE_ROLLOUT.md` — คู่มืออัปเดตแอป + LINE

- `docs/PHASE2_FIREBASE_LINE_API.md` — deploy LINE API ที่ `api-line.nkbkcoop.com`



**เอกสารเพิ่ม**



- [MONITOR_REMOTE_LOGIN_AND_UPDATE.md](MONITOR_REMOTE_LOGIN_AND_UPDATE.md)

- [API_AND_504_CHECK.md](API_AND_504_CHECK.md)

- แผนย้ายทั้งระบบไป Firebase: **`NKBK/Github/V2/docs/FIREBASE_MIGRATION_PLAN.md`**

- ขั้นตอน deploy Monitor API (Phase 1): **`docs/FIREBASE_SETUP.md`**

