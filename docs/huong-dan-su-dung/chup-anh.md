# Chụp lại ảnh hướng dẫn

Ảnh trong `anh/` chụp tự động bằng Playwright trên **bản cài thử riêng, dữ liệu giả**. Không chụp trên bản chạy thật.

Script: [`app/e2e/huong-dan/chup-anh.mjs`](../../app/e2e/huong-dan/chup-anh.mjs). Script tự từ chối nếu địa chỉ không phải `localhost` / `127.0.0.1`, hoặc không có dự án mẫu "Khu nhà ở Bình Minh (giả)". Script **đổi dữ liệu thử**: tạo việc nhánh, gửi duyệt, duyệt, vào sổ văn bản giả, đơn nghỉ giả; thiết lập văn thư mẫu (thêm pháp nhân DXA, chọn Văn thư, Pháp chế, Người phê duyệt khi các ô đang trống), 3 quy chế mẫu (2 đã phê duyệt, 1 dự thảo chờ phê duyệt); nộp báo cáo tuần mẫu của Ban Đối ngoại – GPMB có đề nghị hỗ trợ; đính kèm tệp giả vào việc BM-11, BM-15; một nhãn riêng mẫu của dự án BM; một việc giả của dự án KD trong Thùng rác. Chạy lại trên cùng bản thử được (mỗi nhóm tự kiểm dữ liệu đã có; chuỗi "báo cáo tiến độ → gửi duyệt → duyệt" mỗi lần lấy một việc còn mở, hết thì tạo việc giả mới), nhưng nên dựng bản thử mới cho mỗi đợt chụp.

## 1. Dựng bản thử (Docker, cổng 4530)

Tạo tệp `.env` riêng **ngoài repo** (ví dụ `..\kepler-guide.env`), khoá sinh ngẫu nhiên:

```
COMPOSE_PROJECT_NAME=kepler-guide
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
docker compose -p kepler-guide --env-file ..\kepler-guide.env up -d --build postgres app
```

Đợi `http://localhost:4530/api/health` trả `ok`, rồi tạo dữ liệu dự án mẫu (đặt mật khẩu chung `Play@2026` cho tài khoản mẫu, tạo dự án BM):

```powershell
docker exec -e BASE=http://127.0.0.1:4000 -e OUT=/tmp/journal.json kepler-guide-app-1 node scripts/simulate-project.mjs
```

## 2. Chụp

```powershell
cd app\e2e; npm ci
$env:BASE = "http://localhost:4530"
# Chỉ cần cho nhóm 30-quan-tri: mật khẩu quản trị gốc CỦA BẢN THỬ, đọc thẳng từ tệp .env (không in ra, không ghi vào tệp nào trong repo).
$env:ADMIN_PW = ((Get-Content ..\..\..\kepler-guide.env) -match '^ROOT_ADMIN_PASSWORD=') -replace '^ROOT_ADMIN_PASSWORD=', ''
node huong-dan/chup-anh.mjs
Remove-Item Env:ADMIN_PW
```

- Chỉ chụp một số nhóm: `$env:ONLY = "04-du-an,20-lanh-dao"` trước lệnh `node`. Tên nhóm: `01-dang-nhap`, `02-trang-chu`, `03-ket-noi`, `04-du-an`, `05-cap-nhat-nhanh`, `06-bao-cao-tuan`, `07-van-thu`, `08-nhan-su`, `09-doi-tac`, `10-nhac-viec`, `20-lanh-dao`, `30-du-an`, `30-tai-lieu`, `30-bao-cao-tuan`, `30-nhan-su-doi-tac`, `30-quan-tri`, `30-ca-nhan`. `ONLY=30` chụp mọi nhóm `30-`.
- Thiếu `ADMIN_PW`: nhóm `30-quan-tri` bị bỏ qua (có dòng cảnh báo), các nhóm khác vẫn chụp.
- Ảnh ghi vào `docs/huong-dan-su-dung/anh/` (ghi đè tệp cùng tên). Muốn chụp thử ra chỗ khác: `$env:OUT = "<thư mục tạm>"`. Khung đỏ có số là chỗ bấm.
- Cuối lần chạy script in số ảnh đã chụp và số nhóm lỗi (nếu có). Xem lại từng ảnh trước khi đưa vào repo.
- Cần Chromium của Playwright (`npx playwright install chromium`).

## 3. Chụp lại từ đầu

```powershell
docker compose -p kepler-guide --env-file ..\kepler-guide.env down -v
```

rồi làm lại bước 1–2. Xong việc thì `down -v` để xoá hẳn bản thử.

## Ảnh cho tài liệu thiết lập (nhóm `30-`)

Dùng trong [thiet-lap.md](thiet-lap.md). Tất cả chụp trên bản thử, dữ liệu giả.

| Nhóm | Tệp | Màn | Tài khoản |
|---|---|---|---|
| `30-du-an` | `30-du-an-nut-tao.png` | Menu trái, nút **+** ở nhóm Dự án | `giamdoc` (Ban Tổng Giám đốc) |
| | `30-du-an-tao.png` | Hộp **Tạo dự án**, kiểu Theo Master Timeline, Tháng T0 | `giamdoc` |
| | `30-du-an-tao-quy-trinh.png` | Hộp **Tạo dự án**, kiểu Quy trình công việc, nhóm Quy trình duyệt (2 cấp) | `tb.phaply` (Lãnh đạo bộ phận) |
| | `30-du-an-menu-khac.png` | Menu **Khác** trên trang dự án MTL BM | `pmo` (Chủ dự án) |
| | `30-mtl-t0-nguong.png` | Hộp **T0 & ngưỡng cảnh báo** | `pmo` |
| | `30-mtl-nhap-xem-truoc.png` | Hộp **Nhập Master Timeline từ Excel**, bước Xem trước (mẫu MTL bộ phận Ban Pháp lý) | `pmo` |
| | `30-mtl-giai-doan.png` | Tab **Giai đoạn**, nút Thiết lập giai đoạn | `pmo` |
| | `30-mtl-thiet-lap-giai-doan.png` | Hộp **Thiết lập giai đoạn** | `pmo` |
| | `30-cai-dat-du-an.png` | Màn **Cài đặt dự án BM** (đầu trang) | `pmo` |
| | `30-cai-dat-thong-tin-chung.png`, `30-cai-dat-xoa-du-an.png`, `30-cai-dat-cot-trang-thai.png`, `30-cai-dat-nhan.png`, `30-cai-dat-viec-lap-lai.png`, `30-cai-dat-thanh-vien.png` | Từng khối của Cài đặt dự án BM | `pmo` |
| | `30-cai-dat-quy-trinh-duyet.png` | Khối **Quy trình duyệt nhiều cấp** + một dòng Quy tắc tự động (dự án thường KD, chưa lưu) | `giamdoc` |
| `30-tai-lieu` | `30-tai-lieu-du-an.png` | Tài liệu → tab **Tài liệu dự án** | `giamdoc` |
| | `30-tai-lieu-mot-du-an.png` | Một dự án: hai nguồn tệp (Hub, NAS) | `giamdoc` |
| | `30-tai-lieu-theo-cong-viec.png` | **Theo công việc (tải lên Hub)** trong việc BM-11 | `giamdoc` |
| | `30-van-thu-thiet-lap.png` | **Thiết lập văn thư** (`#/vanthu/thiet-lap`) | `giamdoc` |
| | `30-van-thu-vao-so.png` | Hộp **Vào sổ văn bản** (điền thử, chưa lưu) | `nv.hcns` (Văn thư) |
| | `30-quy-che-danh-sach.png` | Tab **Quy chế, quy định nội bộ** | `giamdoc` |
| | `30-quy-che-tao-du-thao.png` | Hộp **Tạo dự thảo tài liệu nội bộ** (điền thử, chưa lưu) | `nv.hcns` |
| | `30-quy-che-phe-duyet.png` | Chi tiết dự thảo có nút **Phê duyệt** / **Trả lại** | `giamdoc` (Người phê duyệt) |
| `30-bao-cao-tuan` | `30-bao-cao-tuan-thiet-lap.png` | Khối **Thiết lập** cuối tab Tổng hợp | `giamdoc` |
| `30-nhan-su-doi-tac` | `30-nhan-su-thiet-lap.png` | Nhân sự → tab **Thiết lập** | `giamdoc` |
| | `30-doi-tac-them.png` | Hộp **Thêm đối tác** (Bộ phận phụ trách, Người phụ trách) | `giamdoc` |
| | `30-doi-tac-chi-tiet.png` | Đầu trang chi tiết đối tác: **Sửa**, **Ngừng theo dõi** | `tb.phaply` (Lãnh đạo bộ phận phụ trách) |
| | `30-doi-tac-sua.png` | Hộp **Sửa đối tác**, ô Người phụ trách | `tb.phaply` |
| `30-quan-tri` | `30-qt-tai-khoan.png` | Quản trị → **Tài khoản** (khung nhìn rộng cho vừa bảng) | `admin` (quản trị gốc bản thử) |
| | `30-qt-sua-tai-khoan.png` | Hộp **Sửa tài khoản** | `admin` |
| | `30-qt-quyen-phu-trach.png` | Hộp **Quyền & phụ trách** của tài khoản Ban Tổng Giám đốc | `admin` |
| | `30-qt-bo-phan.png`, `30-qt-nhan.png`, `30-qt-nhat-ky.png`, `30-qt-token-claude.png`, `30-qt-danh-muc.png` | Quản trị → **Bộ phận**, **Nhãn**, **Nhật ký hệ thống**, **Token Claude**, **Danh mục** | `admin` |
| `30-ca-nhan` | `30-ca-nhan-thong-tin.png` | **Thông tin cá nhân** | `nv.phaply` (Nhân viên) |
| | `30-ca-nhan-ket-noi-claude.png` | **Kết nối Claude** (một máy đã kết nối) | `nv.phaply` |
| | `30-ca-nhan-thong-bao.png` | Chuông thông báo | `nv.phaply` |
| | `30-ca-nhan-ghi-chu.png` | **Ghi chú của tôi** | `nv.phaply` |
| | `30-ca-nhan-phim-tat.png` | Bảng **Phím tắt** | `nv.phaply` |
| | `30-ca-nhan-thung-rac.png` | **Thùng rác** | `giamdoc` |

## Ảnh Claude desktop (chụp tay)

| Tệp | Nội dung | Tình trạng |
|---|---|---|
| `anh/claude-01-tien-ich-da-cai.png` | Settings → Customize → Connectors, dòng Kepler Hub có ✓ | Có (chụp máy thật, 20/11/2026) |
| `anh/claude-02-cau-hinh.png` | Cấu hình tiện ích: Địa chỉ Kepler Hub đã điền, ô Token trống | Có (chụp máy thật, 20/11/2026) |
| `anh/claude-04-skills-to-chuc.png` | Settings → Customize → Skills: hai skill "From your organization" | Có (chụp máy thật, 20/11/2026) |
| `anh/claude-04-skill-kep.png` | Gõ `/kep`: mỗi skill một dòng | Có (chụp máy thật, 20/11/2026) |
| `anh/claude-04-skill-bi-trung.png` | Gõ `/kep` thấy hai `kepler-hub` (minh hoạ lỗi cài trùng) | Có (chụp máy thật, 20/11/2026) |
| `anh/claude-06-token-tao.png`, `claude-06-token-sao-chep.png` | Tạo token thủ công; token đã được che phần giữa (token gốc đã xoá) | Có (chụp máy thật, 20/11/2026) |
| `anh/claude-03-chua-ket-noi.png` | Claude báo "Chưa kết nối Kepler Hub… bấm Cho phép (mã …)" | Chưa dùng (tài liệu hướng dẫn bằng chữ) |
| `anh/claude-05-toi-la-ai.png` | Claude trả lời "Tôi là ai trong Kepler Hub?" | Chưa dùng (tài liệu hướng dẫn bằng chữ) |

Chụp bằng tài khoản thử hoặc che họ tên, email, token. **Không** đưa ảnh có token đầy đủ vào repo; token đã lộ trong ảnh phải thu hồi ngay. Kết nối Claude tới bản thử 4530 (Địa chỉ Kepler Hub = `http://localhost:4530`, tài khoản mẫu) để ảnh chỉ có dữ liệu giả.
