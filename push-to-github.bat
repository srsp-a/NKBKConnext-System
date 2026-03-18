@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo.
echo  Push ไปที่: git@github.com:srsp-a/NKBKConnext-System.git
echo  ต้องใช้บัญชี GitHub ที่เป็นเจ้าของ repo srsp-a/NKBKConnext-System
echo.
echo  ถ้า SSH ชี้ไป user อื่น (เช่น gloszilla-ai) ให้ใช้ทางเลือก:
echo   1) ตั้ง SSH key แยกสำหรับ srsp-a หรือ
echo   2) ใช้ HTTPS:
echo      git remote set-url origin https://github.com/srsp-a/NKBKConnext-System.git
echo      git push -u origin main
echo      (จะถาม username/password หรือ token)
echo.
pause
git push -u origin main
pause
