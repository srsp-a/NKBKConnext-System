# Firestore — Scheduled Backup

## สถานะปัจจุบัน

- **โปรเจกต์:** `admin-panel-nkbkcoop-cbf10`
- **ความถี่:** รายวัน (daily)
- **เก็บ:** **30 วัน** (`30d` / `2592000s`)
- **Schedule ID:** `f50a4f75-284b-47d0-be8f-320b6bfabc29`
- **บัญชี Owner:** `gloszilla@gmail.com`

ดูใน GCP (ล็อกอิน gloszilla → แท็บ **All** เลือกโปรเจกต์):  
https://console.cloud.google.com/firestore/databases/-default-/disaster-recovery?project=admin-panel-nkbkcoop-cbf10

## สร้าง schedule ครั้งแรก

```powershell
gcloud auth login
gcloud config set account gloszilla@gmail.com
cd NKBK\it
.\scripts\setup-firestore-backup.ps1
```

## เปลี่ยนระยะเก็บ (เช่น 60 วัน)

```powershell
gcloud config set account gloszilla@gmail.com
gcloud config set project admin-panel-nkbkcoop-cbf10
gcloud firestore backups schedules update `
  --database="(default)" `
  --backup-schedule=f50a4f75-284b-47d0-be8f-320b6bfabc29 `
  --retention=60d
```

สูงสุดประมาณ **14 สัปดาห์** (~98 วัน)

## หมายเหตุ

- ต้องแผน **Blaze**
- Service account ใน `firebase-service-account.json` **ไม่มีสิทธิ์** จัดการ schedule — ใช้บัญชี Owner
- Backup ครอบคลุม **ทั้ง database** (users, leaves, cms_* ฯลฯ)
- โปรเจกต์นี้ **ไม่ได้อยู่ในองค์กร sirasupa.com** — อยู่ภายใต้ `gloszilla@gmail.com` (เลือกโปรเจกต์ใน GCP แท็บ All)
