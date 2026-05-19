# อ่าน monitor-api/.env แล้วตั้ง Firebase Secret Manager (ไม่แสดงค่า)
$ErrorActionPreference = 'Stop'
$project = 'admin-panel-nkbkcoop-cbf10'
$envPath = Join-Path $PSScriptRoot '..\monitor-api\.env'
$names = @(
  'MONITOR_SYSTEM_UPLOAD_SECRET',
  'MONITOR_SYSTEM_PUBLIC_READ_KEY',
  'LINE_LOGIN_CHANNEL_ID',
  'LINE_LOGIN_CHANNEL_SECRET'
)

if (-not (Test-Path $envPath)) {
  Write-Error "ไม่พบ $envPath"
}

$map = @{}
Get-Content $envPath -Encoding UTF8 | ForEach-Object {
  if ($_ -match '^\s*([^#=]+)=(.*)$') {
    $map[$matches[1].Trim()] = $matches[2].Trim()
  }
}

foreach ($name in $names) {
  if (-not $map[$name]) {
    Write-Warning "ข้าม $name (ไม่มีใน .env)"
    continue
  }
  Write-Host "Setting secret: $name"
  $map[$name] | firebase functions:secrets:set $name --project $project --force
}

Write-Host "Done."
