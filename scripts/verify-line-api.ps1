# LINE API health check (Firebase)
$base = if ($args[0]) { $args[0].TrimEnd('/') } else { 'https://api-line-nkbkcoop.web.app' }
$ok = $true

function Test-Get($name, $url) {
  try {
    $r = Invoke-RestMethod -Uri $url -TimeoutSec 25
    Write-Host "[OK] $name" -ForegroundColor Green
  } catch {
    Write-Host "[FAIL] $name - $($_.Exception.Message)" -ForegroundColor Red
    $script:ok = $false
    return
  }
  if ($r.status) { Write-Host "  status=$($r.status) configured=$($r.configured)" }
}

Write-Host "LINE API: $base"
Write-Host ""
Test-Get "GET / (health)" "$base/"

if ($ok) {
  Write-Host ""
  Write-Host "All checks passed." -ForegroundColor Green
  exit 0
}
Write-Host ""
Write-Host "Some checks failed." -ForegroundColor Red
exit 1
