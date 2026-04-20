@echo off
setlocal EnableExtensions EnableDelayedExpansion
chcp 65001 >nul
title Build - NKBKConnext System (NSIS Setup)
cd /d "%~dp0"

set "LOG=%~dp0build-last.log"
> "%LOG%" echo === Build %date% %time% ===

echo.
echo  ========================================
echo   Build ตัวติดตั้ง NSIS ^(Setup.exe^)
echo   ผลลัพธ์: dist\*Setup*.exe
echo   Log: build-last.log
echo   หมายเหตุ: ไฟล์ firebase-service-account.json ไม่แพ็กใน Setup — วางหลังติดตั้งเอง
echo  ========================================
echo.
echo  *** ใช้เวลาประมาณ 2-15 นาที — อย่าปิดหน้าต่าง ***
echo.

where node >nul 2>nul
if errorlevel 1 (
    echo  ไม่พบ Node.js
    pause
    exit /b 1
)
where npm.cmd >nul 2>nul
if errorlevel 1 (
    echo  ไม่พบ npm
    pause
    exit /b 1
)

if not exist "node_modules" (
    call npm.cmd install
    if errorlevel 1 ( pause & exit /b 1 )
)

taskkill /IM "NKBKConnext System.exe" /F >> "%LOG%" 2>&1
timeout /t 2 /nobreak >nul
if exist "dist" rd /s /q "dist"
if exist "dist" (
    echo  ลบ dist ไม่ได้ — ปิดแอป/Explorer
    pause
    exit /b 1
)

echo.
node "%~dp0scripts\npm-run-tee.js" build:installer
set "ERR=!errorlevel!"

if !ERR! neq 0 (
    echo  ลอง build โฟลเดอร์ win-unpacked...
    node "%~dp0scripts\npm-run-tee.js" build:dir
    set "ERR=!errorlevel!"
)

if !ERR! neq 0 (
    notepad "%LOG%" 2>nul
    pause
    exit /b 1
)

set "HAS=0"
for /f "delims=" %%F in ('dir /b /a-d "%~dp0dist\*Setup*.exe" 2^>nul') do set "HAS=1"

if "!HAS!"=="1" (
    echo.
    echo  สำเร็จ — แจกไฟล์ *Setup*.exe ใน dist ให้ผู้ใช้รันเพื่อติดตั้งลงเครื่อง
) else (
    echo  ไม่พบ *Setup*.exe
    notepad "%LOG%" 2>nul
    pause
    exit /b 1
)

explorer "dist"
pause >nul
exit /b 0
