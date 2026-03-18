/**
 * รันหลัง pack แต่ก่อน NSIS — วาง monitor-config.json ข้าง .exe ใน win-unpacked
 * (extraFiles จะไม่คัดลอกถ้าไม่มีไฟล์ต้นทาง จึงใช้ hook นี้ให้แน่ใจ)
 */
const fs = require("fs");
const path = require("path");

module.exports = async function afterPackMonitorConfig(context) {
  const { appOutDir, electronPlatformName } = context;
  if (electronPlatformName !== "win32") {
    return;
  }

  const dest = path.join(appOutDir, "monitor-config.json");
  const src = path.join(__dirname, "..", "build-includes", "monitor-config.json");

  let body;
  if (fs.existsSync(src)) {
    body = fs.readFileSync(src, "utf8");
  } else {
    body =
      JSON.stringify({ monitorApiUrl: "https://api.nkbkcoop.com" }, null, 2) + "\n";
    console.warn(
      "[afterPack] build-includes/monitor-config.json ไม่พบ — ใช้ค่าเริ่มต้น"
    );
  }

  fs.writeFileSync(dest, body, "utf8");
  console.log("[afterPack] monitor-config.json ->", dest);
};
