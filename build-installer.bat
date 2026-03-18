@echo off
setlocal EnableExtensions
chcp 65001 >nul
title Build - NKBKConnext System
cd /d "%~dp0"

set "LOG=%~dp0build-last.log"
echo === Build %date% %time% ===> "%LOG%"

echo.
echo  ========================================
echo   Build NKBKConnext System
echo  บันทึก log: build-last.log
echo  ========================================
echo.

where node >nul 2>nul
if errorlevel 1 (
    echo  ไม่พบ Node.js - https://nodejs.org
    pause
    exit /b 1
)
where npm.cmd >nul 2>nul
if errorlevel 1 (
    echo  ไม่พบ npm.cmd
    pause
    exit /b 1
)

if not exist "node_modules" (
    echo  กำลัง npm install...
    call npm.cmd install >> "%LOG%" 2>&1
    if errorlevel 1 (
        echo  npm install ล้มเหลว - ดู build-last.log
        pause
        exit /b 1
    )
)

echo  ปิดแอป NKBKConnext ก่อน — สคริปต์จะลบ dist เดิมแล้ว build ใหม่ทั้งหมด
echo.
taskkill /IM "NKBKConnext System.exe" /F >> "%LOG%" 2>&1
timeout /t 2 /nobreak >nul

if exist "dist" (
    echo  กำลังลบ dist เดิม...
    rd /s /q "dist" >> "%LOG%" 2>&1
)
if exist "dist" (
    echo.
    echo  [ผิดพลาด] ลบโฟลเดอร์ dist ไม่ได้ — มักเพราะยังเปิดแอปหรือ Explorer อยู่ใน dist
    echo  ปิด NKBKConnext System และปิดหน้าต่างที่เปิด dist\win-unpacked แล้วรันใหม่
    echo.
    pause
    exit /b 1
)

echo  กำลัง build โปรดรอ 1-3 นาที...
echo.
call npm.cmd run build:installer >> "%LOG%" 2>&1
if errorlevel 1 (
    echo.
    echo  build แบบเต็มล้มเหลว — ลองแบบ portable อย่างเดียว...
    call npm.cmd run build:portable >> "%LOG%" 2>&1
)

if errorlevel 1 (
    echo.
    echo  [ผิดพลาด] build ไม่สำเร็จ ^(npm errorlevel^)
    echo  เปิด build-last.log ดู error ท้ายไฟล์
    echo.
    notepad "%LOG%" 2>nul
    pause
    exit /b 1
)

if not exist "dist\win-unpacked\NKBKConnext System.exe" (
    echo.
    echo  [ผิดพลาด] ไม่มี dist\win-unpacked\NKBKConnext System.exe
    echo  เปิด build-last.log ดู error ท้ายไฟล์
    echo.
    notepad "%LOG%" 2>nul
    pause
    exit /b 1
)

echo.
echo  สำเร็จ — dist ถูกสร้างใหม่ มี NKBKConnext System.exe ใน dist\win-unpacked\
echo  ตัวติดตั้ง NSIS อยู่ใน dist\ ^(ถ้า build ผ่าน^)
echo.
explorer "dist\win-unpacked"
pause
exit /b 0
