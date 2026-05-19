# Firestore scheduled backup (requires gcloud login as project Owner)
$ErrorActionPreference = "Stop"
$Project = "admin-panel-nkbkcoop-cbf10"
$Database = "(default)"
$Retention = "30d"

Write-Host "Project: $Project"
Write-Host "Run first: gcloud auth login (Owner account)"
Write-Host ""

gcloud config set project $Project

$listOut = gcloud firestore backups schedules list --database=$Database --format="value(name)" 2>&1
if ($LASTEXITCODE -ne 0) {
  Write-Host $listOut
  Write-Host "PERMISSION_DENIED? Run: gcloud auth login"
  Write-Host "Or use Console: Firestore > Backups > Create schedule"
  exit 1
}

if ($listOut) {
  Write-Host "Schedule already exists:"
  gcloud firestore backups schedules list --database=$Database
  exit 0
}

Write-Host "Creating daily backup (retention $Retention) ..."
gcloud firestore backups schedules create `
  --database=$Database `
  --recurrence=daily `
  --retention=$Retention

if ($LASTEXITCODE -eq 0) {
  Write-Host "OK - see Firestore > Backups in Console"
  gcloud firestore backups schedules list --database=$Database
} else {
  Write-Host "Failed - see docs/FIRESTORE_BACKUP.md"
  exit 1
}
