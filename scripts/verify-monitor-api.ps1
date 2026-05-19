# Monitor API health check (Firebase)
$base = "https://monitor-api.nkbkcoop.com"
$ok = $true

function Test-Json($name, $url) {
  try {
    $r = Invoke-RestMethod -Uri $url -TimeoutSec 20
    Write-Host "[OK] $name" -ForegroundColor Green
    return $r
  } catch {
    Write-Host "[FAIL] $name - $($_.Exception.Message)" -ForegroundColor Red
    $script:ok = $false
    return $null
  }
}

Write-Host "Monitor API: $base"
Write-Host ""
$root = Test-Json "GET /" "$base/"
if ($root) { Write-Host "  status=$($root.status) service=$($root.service)" }
$cfg = Test-Json "GET /api/monitor-public-config" "$base/api/monitor-public-config"
if ($cfg) { Write-Host "  lineLoginEnabled=$($cfg.lineLoginEnabled)" }

if ($ok) {
  Write-Host ""
  Write-Host "All checks passed." -ForegroundColor Green
  exit 0
}
Write-Host ""
Write-Host "Some checks failed." -ForegroundColor Red
exit 1
