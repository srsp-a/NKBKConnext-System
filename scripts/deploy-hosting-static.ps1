# เตรียมไฟล์จาก V2 แล้ว deploy static Hosting ทุก site
$ErrorActionPreference = "Stop"
$Project = "admin-panel-nkbkcoop-cbf10"
$Root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
Set-Location $Root

node scripts/prepare-hosting-deploy.js
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

$config = Get-Content "hosting-sites.config.json" -Raw | ConvertFrom-Json
$only = $args -join ","
if ($only) {
  $targets = ($only -split "," | ForEach-Object { $_.Trim() }) -join ","
  firebase deploy --only "hosting:$targets" --project $Project
} else {
  $targets = ($config.sites | ForEach-Object { "hosting:$($_.target)" }) -join ","
  firebase deploy --only $targets --project $Project
}
