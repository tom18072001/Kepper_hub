# Playground CRM / HRM: một Kepper RIÊNG để dùng thử (cổng 4200, CSDL riêng, dữ liệu mẫu GIẢ) — không đụng bản đang chạy ở 4100.
# Dùng (PowerShell, trong thư mục kepper đang chạy):   powershell -ExecutionPolicy Bypass -File deploy\playground.ps1
#   Cập nhật bản thử:                                  (chạy lại lệnh trên)
#   Xoá hẳn bản thử (cả dữ liệu thử):                  docker compose -p kepper-play down -v
# Tài khoản thử: giamdoc, tb.phaply, nv.phaply, nv.hcns (phụ trách nhân sự)… mật khẩu mẫu 12345678 (đổi ở lần đăng nhập đầu).
param([string]$Branch = "kepper/playground-crm-hrm", [string]$Dir = "")
$ErrorActionPreference = "Continue"   # docker / git ghi tiến trình ra stderr; mỗi bước tự kiểm $LASTEXITCODE
$src = Split-Path $PSScriptRoot -Parent
if (-not $Dir) { $Dir = Join-Path (Split-Path $src -Parent) "kepper-play" }
function Hex32 { $b = New-Object byte[] 32; [Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($b); ($b | ForEach-Object { $_.ToString("x2") }) -join "" }

Write-Host "==> 1/4 Lấy mã nhánh $Branch (qua bản kepper đang có, không cần đăng nhập GitHub lại)"
git -C $src fetch origin "+refs/heads/${Branch}:refs/remotes/origin/${Branch}"
if ($LASTEXITCODE -ne 0) { throw "git fetch lỗi." }
if (-not (Test-Path (Join-Path $Dir ".git"))) {
  git init -q $Dir
  if ($LASTEXITCODE -ne 0) { throw "Không tạo được $Dir." }
}
# Bản thử chỉ theo mã nhánh thử (không sửa tay trong kepper-play): lấy từ bản kepper đang có rồi đặt cứng vào đó.
git -C $Dir fetch -q $src "+refs/remotes/origin/${Branch}:refs/remotes/src/play"
if ($LASTEXITCODE -ne 0) { throw "Không lấy được mã vào $Dir." }
git -C $Dir checkout -q -B play refs/remotes/src/play
git -C $Dir reset -q --hard refs/remotes/src/play
if ($LASTEXITCODE -ne 0) { throw "Không cập nhật được mã trong $Dir." }
git -C $Dir log --oneline -1

Set-Location $Dir
if (-not (Test-Path .env)) {
  Write-Host "==> 2/4 Tạo .env cho bản thử (khoá ngẫu nhiên, chỉ dùng trên máy này)"
  $lines = @(
    "COMPOSE_PROJECT_NAME=kepper-play",
    "APP_VERSION=play",            # image kepper-app:play — KHÔNG ghi đè image của bản đang chạy
    "APP_PORT=4200",
    "APP_ORIGIN=http://localhost:4200",
    "POSTGRES_HOST_PORT=5436",
    "POSTGRES_PASSWORD=$(Hex32)",
    "JWT_SECRET=$(Hex32)",
    "ROOT_ADMIN_USERNAME=admin",
    "ROOT_ADMIN_PASSWORD=$(Hex32)",
    "SEED_DEMO=true",
    "ALLOW_DEMO_SEED=yes",
    "MODULES=crm,hrm",
    "HR_ENC_KEY=$(Hex32)",
    "STORAGE_DRIVER=local",
    "LOG_PATH=./logs",
    "BACKUP_PATH=./backups"
  )
  [IO.File]::WriteAllLines((Join-Path $Dir ".env"), $lines)
} else { Write-Host "==> 2/4 Giữ .env hiện có của bản thử" }

Write-Host "==> 3/4 Build và chạy (chỉ postgres + app; bản thử không chạy sao lưu)"
docker compose -p kepper-play up -d --build postgres app
if ($LASTEXITCODE -ne 0) { throw "docker compose up lỗi." }

Write-Host "==> 4/4 Chờ sẵn sàng"
for ($i = 0; $i -lt 36; $i++) {
  Start-Sleep -Seconds 5
  $id = docker compose -p kepper-play ps -q app
  if ($id) { $h = docker inspect -f "{{.State.Health.Status}}" $id; if ($h -eq "healthy") { Write-Host "OK — bản thử: http://localhost:4200 (dữ liệu GIẢ). Bản đang chạy 4100 không đổi." -ForegroundColor Green; exit 0 } }
}
docker compose -p kepper-play logs app --tail 40
throw "Bản thử chưa sẵn sàng sau 3 phút."
