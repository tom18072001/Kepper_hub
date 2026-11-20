# Chụp lại ảnh hướng dẫn

Ảnh trong `anh/` chụp tự động bằng Playwright trên **bản cài thử riêng, dữ liệu giả**. Không chụp trên bản chạy thật.

Script: [`app/e2e/huong-dan/chup-anh.mjs`](../../app/e2e/huong-dan/chup-anh.mjs). Script tự từ chối nếu địa chỉ không phải `localhost` / `127.0.0.1`, hoặc không có dự án mẫu "Khu nhà ở Bình Minh (giả)". Script **đổi dữ liệu thử** (tạo việc nhánh, gửi duyệt, duyệt, vào sổ văn bản giả, đơn nghỉ giả), nên mỗi lần chụp nên dựng bản thử mới.

## 1. Dựng bản thử (Docker, cổng 4530)

Tạo tệp `.env` riêng **ngoài repo** (ví dụ `..\kepper-guide.env`), khoá sinh ngẫu nhiên:

```
COMPOSE_PROJECT_NAME=kepper-guide
APP_VERSION=guide
APP_PORT=4530
APP_ORIGIN=http://localhost:4530
POSTGRES_HOST_PORT=5530
POSTGRES_PASSWORD=<chuỗi ngẫu nhiên>
JWT_SECRET=<chuỗi ngẫu nhiên>
ROOT_ADMIN_PASSWORD=<chuỗi ngẫu nhiên>
SEED_DEMO=true
ALLOW_DEMO_SEED=yes
MODULES=vanthu,crm,hrm
HR_ENC_KEY=<64 ký tự hex ngẫu nhiên>
ORG_NAME=Kepler Holdings (bản thử)
LOG_PATH=<thư mục tạm>/logs
NAS_PATH=<thư mục tạm>/nas
NAS_ROOT=/data/nas
VANTHU_NAS_PATH=<thư mục tạm>/vanthu
VANTHU_NAS_ROOT=/data/vanthu
BRANDING_PATH=<thư mục tạm>/branding
BACKUP_PATH=<thư mục tạm>/backups
```

Chạy từ thư mục gốc repo:

```powershell
docker compose -p kepper-guide --env-file ..\kepper-guide.env up -d --build postgres app
```

Đợi `http://localhost:4530/api/health` trả `ok`, rồi tạo dữ liệu dự án mẫu (đặt mật khẩu chung `Play@2026` cho tài khoản mẫu, tạo dự án BM):

```powershell
docker exec -e BASE=http://127.0.0.1:4000 -e OUT=/tmp/journal.json kepper-guide-app-1 node scripts/simulate-project.mjs
```

## 2. Chụp

```powershell
cd app\e2e; npm ci; $env:BASE = "http://localhost:4530"; node huong-dan/chup-anh.mjs
```

- Chỉ chụp một nhóm: `$env:ONLY = "04-du-an,20-lanh-dao"` trước lệnh `node`.
- Ảnh ghi vào `docs/huong-dan-su-dung/anh/` (ghi đè tệp cùng tên). Khung đỏ có số là chỗ bấm.
- Cần Chromium của Playwright (`npx playwright install chromium`).

## 3. Chụp lại từ đầu

```powershell
docker compose -p kepper-guide --env-file ..\kepper-guide.env down -v
```

rồi làm lại bước 1–2. Xong việc thì `down -v` để xoá hẳn bản thử.

## Ảnh Claude desktop (chụp tay)

| Tệp | Nội dung |
|---|---|
| `anh/claude-01-cai-tien-ich.png` | Hộp cài tiện ích Kepler Hub, nút Install |
| `anh/claude-02-cau-hinh.png` | Cấu hình tiện ích: Địa chỉ Kepler Hub đã điền, ô Token trống |
| `anh/claude-03-chua-ket-noi.png` | Claude báo "Chưa kết nối Kepler Hub… bấm Cho phép (mã …)" |
| `anh/claude-04-skills.png` | Settings → Capabilities → Skills có `kepler-hub`, `kepler-luu-tai-lieu` |
| `anh/claude-05-toi-la-ai.png` | Claude trả lời "Tôi là ai trong Kepler Hub?" |

Chụp bằng tài khoản thử hoặc che họ tên, email, token. Kết nối Claude tới bản thử 4530 (Địa chỉ Kepler Hub = `http://localhost:4530`, tài khoản mẫu) để ảnh chỉ có dữ liệu giả.
