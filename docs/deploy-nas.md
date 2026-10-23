# Chạy Kepper Hub trên NAS công ty

Dành cho quản trị hệ thống. Thay máy cá nhân (Docker Desktop, `http://localhost:4100`) bằng NAS công ty chạy liên tục,
nhân viên mở bằng laptop qua `https://kepper.<tên-miền-công-ty>`.
Đánh giá đầy đủ (có / chưa đáp ứng production 40–50 người): `docs/production-readiness.md`.

```
Laptop (trình duyệt, Claude Desktop)
   │ HTTPS 443 — chỉ trong mạng công ty / VPN (KHÔNG mở ra Internet)
   ▼
NAS: reverse proxy (DSM / QNAP / Caddy) ── giữ chứng chỉ, chuyển vào ──► 127.0.0.1:4100
   ├─ app (Node, uid 1000) ── tệp đính kèm, ảnh đại diện: <dữ liệu>/uploads ; nhật ký truy cập: <dữ liệu>/logs
   ├─ postgres 16 ─────────── <dữ liệu>/pgdata   (ổ của chính NAS, không đặt trên thư mục mạng)
   └─ backup (02:00 hằng ngày) ─► <dữ liệu>/backups ─► bản thứ hai NGOÀI NAS (USB / NAS khác / Hyper Backup)
```

## 1. NAS cần gì

| Hạng mục | Yêu cầu | Kiểm tra |
|---|---|---|
| Docker | Synology có **Container Manager** (DSM 7.2+, thường là dòng Plus / xs), QNAP có **Container Station**, hoặc máy Linux có Docker | SSH: `docker compose version` |
| CPU | x86_64 (khuyến nghị — build được ngay trên PC rồi chép sang); arm64 chạy được nhưng phải build trên NAS | `uname -m` |
| RAM | ≥ 4 GB (khuyến nghị 8 GB vì NAS còn phục vụ chia sẻ tệp) | `free -m` |
| Ổ trống | ≥ 20 GB cho CSDL, tệp đính kèm, 14 bản sao lưu | |
| Mạng | IP LAN cố định (đặt trước trên router / DHCP), tên `kepper.<tên-miền>` trỏ về IP đó (DNS nội bộ) | `nslookup kepper.<tên-miền>` từ laptop |
| Quản trị | SSH bật tạm khi cài; tài khoản quản trị NAS có 2FA | |

NAS dòng giá rẻ (ARM đời cũ, không có Container Manager) không chạy được — khi đó dùng một máy mini PC / máy chủ nhỏ chạy Linux.

## 2. Cài lần đầu (SSH vào NAS)

```sh
sudo -i
cd /volume1/docker                     # thư mục chia sẻ chỉ quản trị thấy (Synology); QNAP: /share/Container
git clone https://github.com/tom18072001/Kepper_hub.git kepper   # repo riêng tư: dùng deploy key chỉ đọc, hoặc chép mã nguồn qua thư mục chia sẻ
cd kepper && git checkout <nhánh đang dùng>
sh deploy/nas-setup.sh /volume1/kepper-data https://kepper.<tên-miền-công-ty>
vi .env                                # ROOT_ADMIN_PASSWORD, ORG_NAME, (MODULES, HR_ENC_KEY nếu bật HRM)
cp <logo> /volume1/kepper-data/branding/   # logo.png, mark.png — logo thật chỉ nằm trên NAS, không đưa vào git
docker compose up -d --build
docker compose ps                      # app: healthy
```

`deploy/nas-setup.sh` kiểm tra Docker / kiến trúc / RAM, từ chối thư mục nằm trên ổ mạng, tạo
`pgdata uploads logs backups backups-copy branding` đúng chủ (app chạy bằng uid 1000) và quyền (CSDL, bản sao lưu: 700),
tạo `.env` với khoá CSDL / phiên đăng nhập ngẫu nhiên (`chmod 600`). Không sửa `.env` đã có, không tự khởi động.

**NAS không ra được npm / build quá chậm** (chỉ khi NAS là x86_64): build trên PC rồi chép image sang.

```powershell
# Trên PC (thư mục kepper):
docker compose build app backup
docker save -o kepper-images.tar kepper-app:0.2.0 kepper-backup:0.2.0
```
```sh
# Trên NAS:
docker load -i kepper-images.tar && docker compose up -d --no-build
```

## 3. Biến cấu hình liên quan (`.env`)

| Biến | NAS có reverse proxy trên chính NAS | Ghi chú |
|---|---|---|
| `APP_ORIGIN` | `https://kepper.<tên-miền>` | Phải **đúng** địa chỉ người dùng gõ. Mở bằng địa chỉ khác (IP, http) → đăng nhập báo "Địa chỉ … chưa được phép". Địa chỉ đầu tiên được điền sẵn vào tiện ích Claude |
| `APP_BIND` | `127.0.0.1` | Chỉ proxy trên NAS vào được cổng 4100. Proxy ở máy khác: IP LAN của NAS + tường lửa chỉ cho IP proxy |
| `TRUST_PROXY` | `1` | Lấy IP thật của laptop (nhật ký truy cập, kiểm tra "cùng máy" khi kết nối Claude). Thiếu → mọi người cùng một IP |
| `PGDATA_PATH`, `UPLOADS_PATH` | thư mục trên ổ NAS | Để trống = volume Docker (dùng khi thư mục chia sẻ vướng ACL) |
| `LOG_PATH`, `BACKUP_PATH`, `BRANDING_PATH` | thư mục trên ổ NAS | Nhật ký truy cập giữ 400 ngày |
| `BACKUP_COPY_PATH` | ổ USB / NAS khác đã mount | Bản sao lưu thứ hai ngoài NAS (mục 7) |

Thử nhanh không có HTTPS (chỉ với dữ liệu giả): `APP_BIND=0.0.0.0`, `APP_ORIGIN=http://<IP-NAS>:4100`.
Mật khẩu đi trên Wi-Fi không mã hoá — không dùng cách này với dữ liệu thật.

## 4. HTTPS và reverse proxy

**Chứng chỉ** (chọn một):
1. Tên miền công ty + chứng chỉ Let's Encrypt xin bằng DNS (acme.sh + API của nhà cung cấp tên miền) hoặc chứng chỉ mua — laptop tin sẵn, không phải mở cổng nào ra Internet. *Khuyến nghị.*
2. CA nội bộ của công ty, cài chứng chỉ gốc lên laptop (GPO / Intune / cài tay).
3. Tính năng tự xin Let's Encrypt của NAS thường cần mở cổng 80 ra Internet — không khuyến nghị cho hệ thống chỉ dùng nội bộ.

**Synology DSM:** Control Panel → Login Portal → Advanced → Reverse Proxy → Create —
nguồn `HTTPS`, hostname `kepper.<tên-miền>`, cổng 443; đích `HTTP`, `localhost`, cổng `4100`.
Rồi Control Panel → Security → Certificate → Settings: gán chứng chỉ cho dịch vụ vừa tạo.
Không cần thêm header WebSocket: thông báo tức thời dùng SSE, máy chủ đã gửi `X-Accel-Buffering: no` và ping 25 giây (dưới mức chờ 60 giây của proxy).

**QNAP:** dùng Reverse Proxy của QTS (cùng thông số nguồn / đích như trên).
**Linux:** Caddy

```
kepper.<tên-miền> {
  tls /etc/ssl/kepper.crt /etc/ssl/kepper.key
  reverse_proxy 127.0.0.1:4100 { flush_interval -1 }
}
```

**Tường lửa NAS:** chỉ mở 443 trong mạng công ty. Không chuyển cổng 443 / 4100 từ router ra Internet — làm việc từ xa qua VPN.

## 5. Laptop nhân viên

- Lưu dấu trang `https://kepper.<tên-miền>`; đăng nhập lại một lần (phiên trên máy cũ không dùng được).
- Claude Desktop: tải tiện ích ở trang **Kết nối Claude** — địa chỉ Kepper điền sẵn theo `APP_ORIGIN`.
  Máy đã cài bản cũ (localhost): gỡ, cài lại; lần hỏi đầu Kepper mở trang "Cho phép" để kết nối.
- Ngoài văn phòng: VPN về công ty rồi mở như bình thường.
- Bật mã hoá ổ đĩa (BitLocker) — trình duyệt và tiện ích Claude giữ phiên / mã kết nối trong thư mục người dùng.

## 6. Chuyển dữ liệu từ máy đang chạy (PC) sang NAS

Làm ngoài giờ, báo trước cho mọi người; không để hai nơi cùng được dùng (dữ liệu tách đôi).

```powershell
# 1. Trên PC (C:\Users\admin\kepper): sao lưu một lần, dừng app để không ai ghi thêm
docker compose run --rm -e BACKUP_ONCE=1 backup
docker compose stop app
#    → chép thư mục mới nhất trong backups\ sang NAS: /volume1/kepper-data/backups/<thư mục>
```
```sh
# 2. Trên NAS (đã cài theo mục 2, đã chạy lần đầu)
docker compose stop app backup
docker compose --profile restore run --rm -e RESTORE_FROM=/backups/<thư mục> restore
docker compose up -d
```

- Tài khoản, mật khẩu, quyền giữ nguyên theo dữ liệu trên PC (kể cả quản trị gốc) — không đổi tiêu chí đăng nhập.
- `JWT_SECRET` mới → mọi người đăng nhập lại. Nếu PC đã bật HRM: **chép đúng `HR_ENC_KEY`** sang `.env` của NAS, sai khoá là mất số CCCD / lương đã mã hoá.
- Bản sao lưu đã mã hoá: thêm `-v <thư-mục-khoá>:/key:ro -e AGE_IDENTITY=/key/kepper-backup.key` vào lệnh restore.
- Giữ dữ liệu trên PC 30 ngày (đã dừng app) làm đường lui, sau đó xoá theo quy trình huỷ dữ liệu.

## 7. Sao lưu trên NAS (3-2-1-1-0)

1. Service `backup` chạy 02:00 hằng ngày vào `<dữ liệu>/backups`, giữ 14 ngày; NAS chạy liên tục nên không còn bỏ lỡ như trên PC.
2. **Bản thứ hai ngoài NAS** — RAID không phải sao lưu: `BACKUP_COPY=1` + `BACKUP_COPY_PATH` là ổ USB gắn NAS (vd. `/volumeUSB1/usbshare/kepper`),
   hoặc Hyper Backup / HBS chép `<dữ liệu>/backups` sang NAS khác. Lưu lên cloud nước ngoài = chuyển dữ liệu ra nước ngoài (cần hồ sơ đánh giá tác động) — ưu tiên đích trong nước.
3. **Bản không sửa được:** bật snapshot bất biến (immutable snapshot) cho thư mục `backups` — chống ransomware mã hoá luôn bản sao lưu.
4. **Mã hoá:** `BACKUP_AGE_RECIPIENT` (khoá công khai age); khoá bí mật cất ngoài NAS (két / ổ mã hoá).
5. **Thử khôi phục mỗi quý:** `docker compose --profile restore run --rm -e RESTORE_TEST=1 -e RESTORE_FROM=/backups/<thư mục> restore` — trang "Tình trạng vận hành" nhắc khi quá 3 tháng.

Thư mục dữ liệu nên nằm trên volume / thư mục chia sẻ **mã hoá** của NAS, chỉ tài khoản quản trị truy cập.

## 8. Nâng cấp

```sh
sudo sh deploy/upgrade.sh [nhánh]   # sao lưu → giữ image cũ → git pull → build → chờ healthy; lỗi thì in lệnh quay lại
```

## 9. Kiểm tra sau khi cài

- [ ] Laptop mở `https://kepper.<tên-miền>`: chứng chỉ hợp lệ, không cảnh báo.
- [ ] Đăng nhập từ 2 laptop khác nhau; thông báo tức thời hiện ngay (SSE qua proxy).
- [ ] Tệp nhật ký `<dữ liệu>/logs/access-<ngày>.jsonl` ghi IP LAN của laptop (không phải 172.x / 127.0.0.1) → `TRUST_PROXY` đúng.
- [ ] Đính kèm một tệp, đổi ảnh đại diện → được (thư mục uploads ghi được).
- [ ] Sáng hôm sau có thư mục mới trong `backups` (và bản sao ngoài NAS); trang "Tình trạng vận hành" không còn cảnh báo.
- [ ] Claude Desktop trên một laptop: tải tiện ích, hỏi một câu, bấm "Cho phép" → trả lời được.

## 10. Lỗi thường gặp

| Hiện tượng | Nguyên nhân | Sửa |
|---|---|---|
| Đăng nhập báo "Địa chỉ … chưa được phép" | Mở bằng địa chỉ không có trong `APP_ORIGIN` | Mở đúng địa chỉ, hoặc thêm vào `APP_ORIGIN` (dấu phẩy) rồi `docker compose up -d` |
| Log app: "Không ghi được /data/uploads" | Thư mục mount thuộc root | `sudo chown -R 1000:1000 <dữ liệu>/uploads <dữ liệu>/logs` |
| Postgres không khởi động, "Permission denied" | Thư mục chia sẻ vướng ACL / nằm trên ổ mạng | Để trống `PGDATA_PATH` (dùng volume Docker) — sao lưu vẫn ra `BACKUP_PATH` |
| Mọi người cùng một IP trong nhật ký | Thiếu `TRUST_PROXY=1` | Đặt rồi `docker compose up -d` |
| Thông báo không tự cập nhật | Proxy giữ đệm / cắt kết nối dài | Tắt buffering, timeout ≥ 60 giây cho `/api/stream` |
