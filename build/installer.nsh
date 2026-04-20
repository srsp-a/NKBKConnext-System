; หน้า Welcome แรก — แสดง sidebar ภาพเต็ม (ธีมโปรแกรม)
; หมายเหตุ: หน้า "เลือกติดตั้งให้ใคร" เป็น custom page ของ NSIS จึงไม่มีแถบภาพซ้าย (ข้อจำกัดของ electron-builder/NSIS)

!macro customWelcomePage
  ; ข้อความมุมล่างซ้ายของหน้าติดตั้ง (Modern UI)
  !define MUI_BRANDINGTEXT "© SIRASUPA CORPORATION (THAILAND) CO., LTD."
  !define MUI_WELCOMEPAGE_TITLE "NKBKConnext System"
  !define MUI_WELCOMEPAGE_TITLE_3LINES
  !define MUI_WELCOMEPAGE_TEXT "ระบบตรวจสอบและจัดการข้อมูลสหกรณ์$\r$\n$\r$\nกด Next เพื่อเริ่มติดตั้ง"
  !insertmacro MUI_PAGE_WELCOME
!macroend
