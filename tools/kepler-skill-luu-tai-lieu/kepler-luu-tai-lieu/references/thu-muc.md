# Bảng thư mục kho file `\\192.168.130.2\DATA`

Chụp ngày 20/11/2026. Tên thật có thể đổi: luôn kiểm tra bằng `nas_list` trước khi chỉ đường dẫn cho người dùng.
Nhân viên chỉ mở được thư mục phòng mình, nên `nas_list` của họ thường chỉ thấy một phần bảng này.

## Thư mục phòng ban

| Thư mục | Phòng | Mã trên Kepler Hub |
| --- | --- | --- |
| `#1.BOD` | Ban Tổng Giám đốc | BTGD |
| `#2.HCNS` | Hành chính – Nhân sự | HCNS |
| `#3.TaiChinh-KeToan` | Tài chính – Kế toán | TCKT |
| `#4.PhongPhapChe` | Pháp chế | PC |
| `#5.PhongThietKe` | Thiết kế | TKKT |
| `#6.PhongTongHop` | Tổng hợp | TH |
| `#7.PhongKinhTeXayDung` | Kinh tế xây dựng | KTXD |
| `#8.CNTT` | Công nghệ thông tin | — |
| `#9.BanDauTu` | Ban Đầu tư | BDT |
| `#11.PhatTrienDuAn` | Phát triển dự án | PTDA |

### Thư mục con chuẩn (BOD, TCKT, PC, TKKT, TH, KTXD, BDT, PTDA)

| Thư mục | Dùng cho |
| --- | --- |
| `01.VanBanDen` | Văn bản đến — Hub ghi vào, theo năm |
| `02.VanBanDi` | Văn bản đi đã ký — Hub ghi vào, theo năm |
| `03.HoSoCongViec` | Hồ sơ công việc đang làm, dự thảo |
| `03.VanBanNoiBo` | Văn bản nội bộ — Hub ghi vào, theo năm |
| `04.BaoCao` | Báo cáo của phòng, theo năm |
| `05.BieuMau` | Biểu mẫu riêng của phòng |
| `99.LuuTru` | Hồ sơ đã xong, lưu trữ |

### `#2.HCNS` (đánh số khác)

| Thư mục | Dùng cho |
| --- | --- |
| `01.HanhChinh` | Hành chính |
| `02.NhanSu` | Hồ sơ nhân sự, lương, hợp đồng lao động — dữ liệu cá nhân nhạy cảm |
| `02.VanBanDi` | Văn bản đi — Hub ghi vào |
| `03.VanBanDen` | Văn bản đến — Hub ghi vào |
| `04.BaoCao` | Báo cáo |
| `04.VanBanNoiBo` | Văn bản nội bộ — Hub ghi vào |
| `05.BieuMau` | Biểu mẫu của phòng |
| `06.HoSoCongViec` | Hồ sơ công việc |
| `99.LuuTru` | Lưu trữ |

### `#8.CNTT`

`01.Network`, `02.System`, `03.Helpdesk`, `04.Erp`, `05.DuAnCNTT`, `99.LuuTru`.

## Thư mục dùng chung

| Thư mục | Dùng cho | Ai đưa lên |
| --- | --- | --- |
| `#10.DuAn\<mã dự án>-<tên>` | Hồ sơ dự án — tải qua việc / hạng mục trên Kepler Hub | Hub |
| `#97.ChiaSeChung` | Trao đổi tệp không mật giữa các phòng | Mọi người (giả định) |
| `#98.Scan` | Máy scan đổ vào — chỗ tạm | Máy scan |
| `#99.Temp_Pulic\01.BieuMau` | Biểu mẫu toàn công ty | HCNS (giả định) |
| `#99.Temp_Pulic\02.BoNhanDangThuongHieu` | Logo, mẫu nhận diện | HCNS / Truyền thông (giả định) |
| `#99.Temp_Pulic\03.NoiQuy-QuyChe` | Quy chế, quy trình, nội quy đã ban hành | HCNS / Pháp chế (giả định) |
| `#99.Temp_Pulic\04.TaiLieuISO` | Tài liệu ISO | Người phụ trách ISO (giả định) |

"Giả định": quyền ghi của các thư mục này chưa được IT xác nhận. Người dùng không ghi được → đúng là họ không được
giao việc đưa lên; hướng dẫn gửi cho bộ phận phụ trách.
