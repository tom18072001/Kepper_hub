# Nâng cấp Kepper Hub trên máy chạy Windows (Docker Desktop): sao lưu → giữ image cũ để quay lại → lấy mã → build → khởi động → kiểm tra.
# Dùng (PowerShell, trong thư mục kepper):   powershell -ExecutionPolicy Bypass -File deploy\upgrade.ps1 [-Branch main]
# Nên chạy ngoài giờ nộp báo cáo (không chạy chiều thứ Sáu / sáng thứ Hai).
param([string]$Branch = "")
$ErrorActionPreference = "Stop"
Set-Location (Split-Path $PSScriptRoot -Parent)
$stamp = Get-Date -Format "yyyyMMdd-HHmm"

Write-Host "==> 1/5 Sao lưu CSDL + tệp đính kèm trước khi nâng cấp"
docker compose build backup | Out-Null
docker compose run --rm -e BACKUP_ONCE=1 backup
if ($LASTEXITCODE -ne 0) { throw "Sao lưu lỗi — DỪNG nâng cấp (dữ liệu hiện tại không đổi)." }

Write-Host "==> 2/5 Giữ image hiện tại để quay lại"
$cid = docker compose ps -q app
$rollback = $null; $curTag = $null
if ($cid) {
  $imgId = docker inspect -f "{{.Image}}" $cid
  $curTag = docker inspect -f "{{.Config.Image}}" $cid
  $rollback = "kepper-app:rollback-$stamp"
  docker image tag $imgId $rollback
  Write-Host "    image cũ: $rollback ($curTag)"
}

Write-Host "==> 3/5 Lấy mã mới"
git fetch origin
if ($Branch) { git checkout $Branch }
git pull --ff-only
if ($LASTEXITCODE -ne 0) { throw "git pull lỗi — xử lý thay đổi cục bộ rồi chạy lại." }
git log --oneline -1

Write-Host "==> 4/5 Build và khởi động (migration tự chạy khi app khởi động)"
docker compose up -d --build
if ($LASTEXITCODE -ne 0) { throw "docker compose up lỗi." }

Write-Host "==> 5/5 Chờ app sẵn sàng"
$ok = $false
for ($i = 0; $i -lt 36; $i++) {
  Start-Sleep -Seconds 5
  $st = docker compose ps app --format "{{.Status}}"
  if ($st -match "healthy" -and $st -notmatch "unhealthy") { $ok = $true; break }
}
if (-not $ok) {
  Write-Host "!! App chưa sẵn sàng sau 3 phút. 40 dòng log cuối:" -ForegroundColor Red
  docker compose logs app --tail 40
  Write-Host "!! Quay lại bản cũ:" -ForegroundColor Yellow
  if ($rollback) { Write-Host "     docker image tag $rollback $curTag" }
  Write-Host "     docker compose stop app"
  Write-Host "     docker compose --profile restore run --rm -e RESTORE_FROM=/backups/<thư mục mới nhất> restore"
  Write-Host "     docker compose up -d --no-build app"
  exit 1
}
Write-Host "OK — Kepper Hub đã nâng cấp. Image cũ giữ ở $rollback (xoá khi ổn định: docker image rm $rollback)." -ForegroundColor Green
