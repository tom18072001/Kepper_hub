# Nâng cấp Kepler Hub trên máy chạy Windows (Docker Desktop): sao lưu → giữ image cũ để quay lại → lấy mã → build → khởi động → kiểm tra.
# Dùng (PowerShell, trong thư mục kepper):   powershell -ExecutionPolicy Bypass -File deploy\upgrade.ps1 [-Branch main]
# Nên chạy ngoài giờ nộp báo cáo (không chạy chiều thứ Sáu / sáng thứ Hai).
param([string]$Branch = "")
# "Continue": lệnh docker / git ghi tiến trình ra stderr — với "Stop" PowerShell 5.1 coi đó là lỗi và dừng giữa chừng khi chuyển hướng log.
# Mỗi bước tự kiểm $LASTEXITCODE.
$ErrorActionPreference = "Continue"
Set-Location (Split-Path $PSScriptRoot -Parent)
$stamp = Get-Date -Format "yyyyMMdd-HHmm"

Write-Host "==> 0/5 Kiểm phân quyền trên CSDL đang chạy (dừng ở đây thì app cũ vẫn chạy) — deploy/precheck-roles-db.sh"
# Lần nâng cấp LÊN bản "một hệ quy chiếu" (20261124064031_mot_truc_vai): lấy mã mới TRƯỚC (git pull) rồi mới chạy script này — bản cũ chưa có bước 0.
if (-not (docker compose ps -q postgres)) { throw "Không đọc được CSDL (container postgres không chạy) — DỪNG nâng cấp. Bật postgres rồi chạy lại." }
# cmd /c chuyển NGUYÊN byte của tệp vào sh (PowerShell 5.1 nối ống sẽ thêm CRLF làm sh lỗi).
cmd /c "docker compose exec -T postgres sh -s < deploy\precheck-roles-db.sh"
if ($LASTEXITCODE -eq 1) { throw "Kiểm phân quyền chưa đạt — DỪNG nâng cấp (đổi vai các tài khoản được liệt kê trên màn Quản trị rồi chạy lại)." }
if ($LASTEXITCODE -ne 0) { throw "Không đọc được CSDL khi kiểm phân quyền (mã $LASTEXITCODE) — DỪNG nâng cấp." }

Write-Host "==> 1/5 Sao lưu CSDL + tệp đính kèm trước khi nâng cấp"
docker compose build backup | Out-Null
if ($LASTEXITCODE -ne 0) { throw "Build image sao lưu lỗi (cần mạng để cài age) — DỪNG nâng cấp." }
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
if ($Branch) { git checkout $Branch; if ($LASTEXITCODE -ne 0) { throw "git checkout $Branch lỗi." } }
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
  $id = docker compose ps -q app
  if ($id) { $h = docker inspect -f "{{.State.Health.Status}}" $id; if ($h -eq "healthy") { $ok = $true; break } }
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
Write-Host "OK — Kepler Hub đã nâng cấp. Image cũ giữ ở $rollback (xoá khi ổn định: docker image rm $rollback)." -ForegroundColor Green
