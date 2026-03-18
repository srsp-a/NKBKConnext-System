@echo off
chcp 65001 >nul
title NKBKConnext System
cd /d "%~dp0"

echo.
echo  ========================================
echo   NKBKConnext System
echo   ระบบตรวจสอบสถานะระบบ
echo  ========================================
echo.

where node >nul 2>nul
if %errorlevel% neq 0 (
    echo  [ผิดพลาด] ไม่พบ Node.js
    echo  กรุณาติดตั้ง Node.js ก่อน: https://nodejs.org
    echo.
    pause
    exit /b 1
)

if not exist "node_modules\electron" (
    echo  กำลังติดตั้งแพ็กเกจ... กรุณารอสักครู่
    echo.
    call npm install
    if %errorlevel% neq 0 (
        echo  ติดตั้งไม่สำเร็จ
        pause
        exit /b 1
    )
    echo.
)

echo  กำลังเปิดโปรแกรม...
echo  โปรแกรมจะแสดงที่แถบด้านล่าง (ถาดระบบ) เมื่อย่อ
echo  ดับเบิลคลิกไอคอนที่ถาดเพื่อเปิดหน้าต่างอีกครั้ง
echo.
start "" npm start
exit
