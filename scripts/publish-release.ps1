# Build แพ็กเกจเดสก์ท็อป — จากนั้นอัปโหลดขึ้น Firebase Hosting (คู่มือ: docs/FIREBASE_DESKTOP_UPDATES.md)
# เดิมสคริปต์นี้ต้องการ GH_TOKEN เพื่อ publish ขึ้น GitHub — ตอนนี้ npm run release = publish never (ไม่ใช้ token)
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root
npm run release
Write-Host ''
Write-Host 'Build เสร็จแล้ว — คัดลอกไฟล์จาก dist/ → public-cms/desktop-app-updates/ แล้ว firebase deploy --only hosting:main' -ForegroundColor Green
Write-Host '(ถ้ายังใช้ GitHub Release ให้ตั้ง GH_TOKEN + เปลี่ยน build.publish เป็น github และใช้ electron-builder --publish always)' -ForegroundColor DarkGray
