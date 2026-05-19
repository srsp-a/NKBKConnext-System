# สร้าง Firebase Hosting sites + target:apply ตาม hosting-sites.config.json
$ErrorActionPreference = "Stop"
$Project = "admin-panel-nkbkcoop-cbf10"
$Root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
Set-Location $Root

$config = Get-Content "hosting-sites.config.json" -Raw | ConvertFrom-Json

foreach ($site in $config.sites) {
  $id = $site.siteId
  $target = $site.target
  Write-Host "`n=== $target -> $id ($($site.domain)) ===" -ForegroundColor Cyan

  firebase hosting:sites:create $id --project $Project 2>&1 | ForEach-Object {
    if ($_ -match "already exists") { Write-Host "  (site exists)" -ForegroundColor DarkYellow }
    else { $_ }
  }

  firebase target:apply hosting $target $id --project $Project
}

Write-Host "`nDone. Add custom domains in Firebase Console for each site." -ForegroundColor Green
