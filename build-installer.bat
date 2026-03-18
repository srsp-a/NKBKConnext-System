@echo off
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

echo  กำลัง build โปรดรอ 1-3 นาที ปิดแอป NKBKConnext ก่อน
echo.
call npm.cmd run build:installer >> "%LOG%" 2>&1
set ERR=%errorlevel%

if exist "dist\win-unpacked\NKBKConnext System.exe" goto :ok

echo.
echo  build แบบเต็มไม่ได้ exe ลองแบบ portable อย่างเดียว...
call npm.cmd run build:portable >> "%LOG%" 2>&1

if not exist "dist\win-unpacked\NKBKConnext System.exe" (
    echo.
    echo  [ผิดพลาด] ยังไม่มี dist\win-unpacked\NKBKConnext System.exe
    echo  เปิด build-last.log ดู error ท้ายไฟล์
    echo.
    notepad "%LOG%" 2>nul
    pause
    exit /b 1
)

:ok
echo.
echo  สำเร็จ - มี NKBKConnext System.exe ใน dist\win-unpacked\
if %ERR% neq 0 echo  หมายเหตุ: ตัวติดตั้ง NSIS อาจสร้างไม่สำเร็จ ดู build-last.log
echo.
explorer "dist\win-unpacked"
pause
exit /b 0
