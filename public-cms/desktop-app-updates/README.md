# โฟลเดอร์อัปเดตแอป NKBKConnext (Hosting main)

หลัง `npm run build:installer` ให้คัดลอกจาก **`dist/`** มาวางที่นี่แล้วแก้ **`desktop-update-manifest.json`** (Portable)  
จากนั้น deploy:

```bash
firebase deploy --only hosting:main
```

ลิงก์สาธารณะเริ่มต้น:

`https://admin-panel-nkbkcoop-cbf10.web.app/desktop-app-updates/`

คู่มือเต็ม: `docs/FIREBASE_DESKTOP_UPDATES.md`
