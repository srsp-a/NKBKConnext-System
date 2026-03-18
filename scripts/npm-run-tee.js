/**
 * รัน npm run <script> โดยแสดงบน console ทันที + เขียน build-last.log
 * (แก้ปัญหา build-installer.bat หน้าจอว่างระหว่างรอ electron-builder)
 */
const { spawn } = require("child_process");
const fs = require("fs");
const path = require("path");

const script = process.argv[2] || "build:installer";
const root = path.join(__dirname, "..");
const logPath = path.join(root, "build-last.log");
const log = fs.createWriteStream(logPath, { flags: "a" });

const child = spawn("npm", ["run", script], {
  shell: true,
  cwd: root,
  env: process.env,
});

function wire(stream, isErr) {
  stream.on("data", (buf) => {
    (isErr ? process.stderr : process.stdout).write(buf);
    log.write(buf);
  });
}
wire(child.stdout, false);
wire(child.stderr, true);

child.on("error", (err) => {
  console.error(err);
  log.write(String(err) + "\n");
  log.end();
  process.exit(1);
});

child.on("close", (code) => {
  log.end();
  process.exit(code === null ? 1 : code);
});
