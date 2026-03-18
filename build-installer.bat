@echo off
setlocal EnableExtensions EnableDelayedExpansion
chcp 65001 >nul
title Build - NKBKConnext System
cd /d "%~dp0"

set "LOG=%~dp0build-last.log"
set "OUT=%TEMP%\nkbk_build_%RANDOM%.out"
echo === Build %date% %time% ===> "%LOG%"

echo.
echo  ========================================
echo   Build NKBKConnext System ^(ตัวติดตั้ง NSIS เท่านั้น^)
echo   Log: build-last.log
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

echo  ปิดแอป NKBKConnext ก่อน — จะลบ dist แล้ว build ใหม่
echo  ผล build จะแสดงด้านล่างนี้ ^(และบันทึกใน build-last.log^)
echo.
taskkill /IM "NKBKConnext System.exe" /F >> "%LOG%" 2>&1
timeout /t 2 /nobreak >nul

if exist "dist" (
    echo  กำลังลบ dist เดิม...
    rd /s /q "dist" >> "%LOG%" 2>&1
)
if exist "dist" (
    echo.
    echo  [ผิดพลาด] ลบ dist ไม่ได้ — ปิดแอปและ Explorer ที่เปิด dist แล้วลองใหม่
    pause
    exit /b 1
)

echo  -------- npm run build:installer --------
echo.
call npm.cmd run build:installer > "%OUT%" 2>&1
set "ERR=!errorlevel!"
type "%OUT%"
type "%OUT%" >> "%LOG%"
del "%OUT%" 2>nul

if !ERR! neq 0 (
    echo.
    echo  -------- ลอง build:unpacked ^(โฟลเดอร์ win-unpacked^) --------
    call npm.cmd run build:unpacked > "%OUT%" 2>&1
    set "ERR=!errorlevel!"
    type "%OUT%"
    type "%OUT%" >> "%LOG%"
    del "%OUT%" 2>nul
)

if !ERR! neq 0 (
    echo.
    echo  [ผิดพลาด] build ไม่สำเร็จ — ดูข้อความด้านบน / ท้าย build-last.log
    notepad "%LOG%" 2>nul
    pause
    exit /b 1
)

set "HAS_SETUP=0"
for /f "delims=" %%F in ('dir /b /a-d "%~dp0dist\*Setup*.exe" 2^>nul') do set "HAS_SETUP=1"

if "!HAS_SETUP!"=="1" (
    echo.
    echo  สำเร็จ — แจกไฟล์ติดตั้งใน dist ^(*Setup*.exe^)
    echo  ติดตั้งครั้งเดียว อัปเดตผ่าน GitHub ^(เมนูถาด: ตรวจสอบอัปเดต / แจ้งบนหน้า login^)
) else (
    echo.
    echo  [ผิดพลาด] ไม่พบ *Setup*.exe ใน dist — ดู log ด้านบน ^(มักเป็น NSIS หรือ path^)
    if exist "dist\win-unpacked\NKBKConnext System.exe" echo  พบแต่ win-unpacked ไม่มี installer
    notepad "%LOG%" 2>nul
    pause
    exit /b 1
)

echo.
explorer "dist"
pause
exit /b 0
