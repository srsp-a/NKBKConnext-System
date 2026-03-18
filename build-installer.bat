@echo off
setlocal EnableExtensions EnableDelayedExpansion
chcp 65001 >nul
title Build - NKBKConnext System
cd /d "%~dp0"

set "LOG=%~dp0build-last.log"
> "%LOG%" echo === Build %date% %time% ===

echo.
echo  ========================================
echo   Build NKBKConnext System ^(NSIS installer^)
echo   Log: build-last.log
echo  ========================================
echo.
echo  *** ช่วง build จะมีข้อความยาวๆ ด้านล่าง — ใช้เวลาประมาณ 2-15 นาที ***
echo  *** อย่าปิดหน้าต่างนี้ ถ้ายังไม่จบ ***
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
    echo  กำลัง npm install ^(ครั้งแรกอาจนาน^)...
    call npm.cmd install
    if errorlevel 1 (
        echo  npm install ล้มเหลว
        pause
        exit /b 1
    )
)

echo  ปิดแอป NKBKConnext ก่อน — จะลบ dist แล้ว build
echo.
taskkill /IM "NKBKConnext System.exe" /F >> "%LOG%" 2>&1
timeout /t 2 /nobreak >nul

if exist "dist" (
    echo  กำลังลบ dist เดิม...
    rd /s /q "dist"
)
if exist "dist" (
    echo.
    echo  [ผิดพลาด] ลบ dist ไม่ได้ — ปิดแอปและ Explorer ที่เปิด dist
    pause
    exit /b 1
)

echo.
echo  -------- npm run build:installer --------
echo.

node "%~dp0scripts\npm-run-tee.js" build:installer
set "ERR=!errorlevel!"

if !ERR! neq 0 (
    echo.
    echo  -------- ลอง build:unpacked --------
    node "%~dp0scripts\npm-run-tee.js" build:unpacked
    set "ERR=!errorlevel!"
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
    echo  สำเร็จ — ไฟล์ติดตั้งใน dist: *Setup*.exe
) else (
    echo.
    echo  [ผิดพลาด] ไม่พบ *Setup*.exe ใน dist
    if exist "dist\win-unpacked\NKBKConnext System.exe" echo  พบแต่ win-unpacked
    notepad "%LOG%" 2>nul
    pause
    exit /b 1
)

echo.
explorer "dist"
echo  กดปุ่มใดๆ เพื่อปิดหน้าต่าง...
pause >nul
exit /b 0
