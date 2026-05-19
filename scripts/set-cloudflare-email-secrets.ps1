# ตั้ง Firebase Secret สำหรับ Cloudflare Email (lineApi)
$ErrorActionPreference = 'Stop'
$project = 'admin-panel-nkbkcoop-cbf10'
$envPath = Join-Path $PSScriptRoot 'cloudflare-email.env'
$names = @('CLOUDFLARE_ACCOUNT_ID', 'CLOUDFLARE_EMAIL_API_TOKEN')

if (-not (Test-Path $envPath)) {
  Write-Error @"
ไม่พบ $envPath
คัดลอกจาก cloudflare-email.env.example แล้วใส่ Account ID + API Token จาก Cloudflare Email Sending
"@
}

$map = @{}
Get-Content $envPath -Encoding UTF8 | ForEach-Object {
  if ($_ -match '^\s*([^#=]+)=(.*)$') {
    $map[$matches[1].Trim()] = $matches[2].Trim().Trim('"').Trim("'")
  }
}

foreach ($name in $names) {
  if (-not $map[$name]) {
    if ($name -eq 'CLOUDFLARE_ACCOUNT_ID') {
      Write-Warning "ข้าม $name (ว่างใน .env — อาจตั้งไว้แล้ว)"
      continue
    }
    Write-Error "ขาด $name ใน cloudflare-email.env — สร้างจาก Cloudflare Email Sending → API Tokens"
  }
  Write-Host "Setting secret: $name"
  $map[$name] | firebase functions:secrets:set $name --project $project --force
}

Write-Host @"

เสร็จ — deploy lineApi:
  cd NKBK\it
  node scripts/prepare-functions-deploy.js
  firebase deploy --only functions:lineApi --project $project

ทดสอบ: Invoke-WebRequest https://api-line.nkbkcoop.com/v1/health
  ควรได้ configured: true
"@
