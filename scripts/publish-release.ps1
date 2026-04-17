# อัปโหลด build ขึ้น GitHub Releases (สร้าง tag v* ตาม package.json)
# ต้องใช้ PAT ของบัญชีที่มีสิทธิ์ repo — สร้างที่ GitHub Settings > Developer settings > Tokens (classic: scope repo)
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root
if (-not $env:GH_TOKEN) {
    Write-Host 'ยังไม่ได้ตั้ง GH_TOKEN' -ForegroundColor Yellow
    Write-Host '  PowerShell: $env:GH_TOKEN = "ghp_..."' -ForegroundColor Cyan
    Write-Host '  CMD:        set GH_TOKEN=ghp_...' -ForegroundColor Cyan
    exit 1
}
npm run release
