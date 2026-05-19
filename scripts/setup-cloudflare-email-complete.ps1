# ตั้ง Cloudflare secrets + deploy lineApi + ตรวจ /v1/health
$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
$project = 'admin-panel-nkbkcoop-cbf10'
$envPath = Join-Path $PSScriptRoot 'cloudflare-email.env'

if (-not (Test-Path $envPath)) {
  $token = Read-Host "วาง CLOUDFLARE_EMAIL_API_TOKEN (จาก Cloudflare Email Sending)"
  if (-not $token) { Write-Error 'ต้องมี API Token'; exit 1 }
  @"
CLOUDFLARE_ACCOUNT_ID=8a0b94549311bf009d36d5027460de9a
CLOUDFLARE_EMAIL_API_TOKEN=$token
"@ | Set-Content -Path $envPath -Encoding UTF8 -NoNewline
  Write-Host "สร้าง $envPath แล้ว"
}

& (Join-Path $PSScriptRoot 'set-cloudflare-email-secrets.ps1')

Push-Location $root
node scripts/prepare-functions-deploy.js
firebase deploy --only functions:lineApi --project $project
Pop-Location

Start-Sleep -Seconds 8
$health = Invoke-RestMethod -Uri 'https://api-line.nkbkcoop.com/v1/health' -TimeoutSec 20
Write-Host "Health:" ($health | ConvertTo-Json -Compress)
if (-not $health.configured) {
  Write-Error 'configured ยังเป็น false — รอ deploy สักครู่แล้วลองใหม่'
}
Write-Host 'OK — ทดสอบส่งอีเมลจาก Admin → ตั้งค่า → ระบบอีเมล'
