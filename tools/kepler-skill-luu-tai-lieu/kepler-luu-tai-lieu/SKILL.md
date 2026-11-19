---
name: kepler-luu-tai-lieu
description: Hướng dẫn nhân viên Kepler lưu tài liệu đúng chỗ trên kho file nội bộ (NAS \\192.168.130.2\DATA) và trên Kepler Hub — chọn đúng thư mục phòng ban, đúng loại tài liệu, đặt tên đúng quy ước, không ghi đè, không để lộ sang phòng khác. Dùng khi người dùng hỏi "lưu file này ở đâu", "upload / đưa lên NAS", "để tài liệu vào thư mục nào", có quy trình / quy chế / nội quy mới, công văn / văn bản đến, văn bản đi, văn bản nội bộ, báo cáo, biểu mẫu, hồ sơ công việc, bản scan từ máy scan, tài liệu ISO, tài liệu dự án, hoặc khi cần đặt tên tệp theo quy ước Kepler.
---

# Lưu tài liệu đúng chỗ — kho file Kepler

Kho gốc của công ty là thư mục chia sẻ `\\192.168.130.2\DATA` trên NAS. Mỗi phòng ban có một thư mục riêng.
Nhân viên chỉ mở được thư mục của phòng mình (quyền NTFS do IT cấp); máy trạm thường đã mở sẵn (map ổ) thư mục phòng.
Kepler Hub (https://hub.keplerholdings.vn) **không thay** kho này: văn bản vào sổ văn thư và tệp đính kèm việc dự án
được Hub tự lưu vào đúng thư mục trên NAS.

Bảng thư mục chi tiết: [references/thu-muc.md](references/thu-muc.md). Đọc bảng đó trước khi chọn chỗ lưu.

## Việc của Claude

Claude **chỉ chỉ chỗ**, người dùng tự chép tệp. Tiện ích "Kepler NAS" chỉ đọc: không ghi, không sửa, không xoá tệp.

1. **Xác định phòng của người dùng.** Gọi `nas_roots` / `nas_list` (tiện ích Kepler NAS) xem tài khoản mở được thư mục
   phòng nào. Mở được đúng một thư mục phòng → đó là phòng của họ. Mở được nhiều (lãnh đạo, văn thư) hoặc không có
   tiện ích → hỏi người dùng tài liệu thuộc phòng nào. Không đoán.
2. **Xác định loại tài liệu** theo bảng ở mục "Chọn chỗ lưu". Chưa rõ thì hỏi một câu ngắn (vd. "Đây là bản đã ban
   hành hay bản dự thảo?"). Chỉ đọc nội dung tệp (`nas_read`) khi thật cần để phân loại, và chỉ phần đầu.
3. **Kiểm tra thư mục đích có thật** bằng `nas_list`. Tên thư mục trên NAS có số thứ tự khác nhau giữa các phòng
   (HCNS: `02.VanBanDi`, `03.VanBanDen`; phòng khác: `01.VanBanDen`, `02.VanBanDi`) — luôn lấy tên thật từ `nas_list`,
   không tự gõ theo trí nhớ. Thư mục chưa có → **không** bảo người dùng tự tạo thư mục cấp phòng; báo trưởng phòng / IT.
   Tạo thư mục **năm** (`2026`) bên trong thư mục loại tài liệu thì được.
4. **Đặt tên tệp** theo quy ước bên dưới. Dùng `nas_list` / `nas_search` kiểm tra đã có tệp cùng tên chưa; có rồi thì
   tăng phiên bản (`_v02`, `_v03`…). Không bao giờ ghi đè.
5. **Trả lời người dùng** gọn: đường dẫn đầy đủ để dán vào File Explorer, tên tệp mới, và một câu lý do. Ví dụ:
   > Lưu vào `\\192.168.130.2\DATA\#5.PhongThietKe\04.BaoCao\2026\` với tên
   > `BaoCaoTienDoThietKeThang11_v01_20261120.xlsx` — báo cáo định kỳ của phòng.

Nếu phiên làm việc có công cụ ghi tệp được người dùng cho phép vào thư mục đó, Claude chỉ chép **sau khi** người
dùng xác nhận đúng đường dẫn và tên tệp; không ghi đè, không di chuyển, không xoá tệp có sẵn.

## Chọn chỗ lưu

| Tài liệu | Lưu ở đâu |
| --- | --- |
| **Văn bản đến** (công văn, thư của cơ quan / đối tác gửi tới) | **Vào sổ trên Kepler Hub** → mục Văn thư → Văn bản đến, rồi "Tải tệp lên" trong văn bản đó. Hub tự lưu vào `<phòng>\NN.VanBanDen\<năm>\` và đặt tên theo số đến. Không chép tay vào thư mục VanBanDen. Người không phải văn thư: chuyển bản scan cho văn thư HCNS vào sổ. |
| **Văn bản đi** đã ký, đã có số | Như trên: Hub → Văn bản đi → tải bản đã ký. Hub lưu vào `<phòng>\NN.VanBanDi\<năm>\`. |
| Văn bản đi **dự thảo** (chưa ký, chưa số) | `<phòng>\NN.HoSoCongViec\` (HCNS: `06.HoSoCongViec`). |
| **Văn bản nội bộ** đã ban hành (thông báo, quyết định nội bộ) | Hub → Văn thư → sổ Nội bộ. Hub lưu vào `<phòng>\NN.VanBanNoiBo\<năm>\`. |
| **Quy trình, quy chế, nội quy toàn công ty** đã ban hành | `#99.Temp_Pulic\03.NoiQuy-QuyChe\` — chỉ bộ phận được giao ban hành (HCNS / Pháp chế) đưa lên. Người khác: gửi cho HCNS, không tự đưa. Quyết định ban hành kèm theo vẫn vào sổ văn thư trên Hub. |
| Quy trình, quy chế **dự thảo** / đang góp ý | `<phòng soạn>\NN.HoSoCongViec\`. Không để bản dự thảo ở thư mục chung. |
| Quy trình nội bộ **riêng một phòng** | `<phòng>\NN.HoSoCongViec\` (thư mục con `QuyTrinh` nếu phòng đã có). |
| Tài liệu ISO | `#99.Temp_Pulic\04.TaiLieuISO\` (người phụ trách ISO đưa lên). |
| Biểu mẫu dùng **toàn công ty** | `#99.Temp_Pulic\01.BieuMau\` (HCNS đưa lên). |
| Biểu mẫu **riêng phòng** | `<phòng>\05.BieuMau\`. |
| Nhận diện thương hiệu (logo, mẫu slide…) | `#99.Temp_Pulic\02.BoNhanDangThuongHieu\`. |
| Báo cáo của phòng (tuần, tháng, chuyên đề) | `<phòng>\04.BaoCao\<năm>\`. |
| Hồ sơ công việc đang làm | `<phòng>\NN.HoSoCongViec\` (HCNS: `06.HoSoCongViec`). |
| Hồ sơ đã xong, không còn dùng thường xuyên | `<phòng>\99.LuuTru\<năm>\` — trưởng phòng quyết định chuyển. |
| HCNS: hành chính (tài sản, xe, văn phòng phẩm…) | `#2.HCNS\01.HanhChinh\`. |
| HCNS: hồ sơ nhân sự, lương, hợp đồng lao động | `#2.HCNS\02.NhanSu\` — **chỉ** ở đây (dữ liệu cá nhân nhạy cảm). |
| Tài liệu của **dự án** (hồ sơ hạng mục, bản vẽ, hợp đồng dự án) | Tải lên **trong việc / hạng mục của dự án trên Kepler Hub**; Hub tự lưu vào `#10.DuAn\<dự án>\...`. |
| Bản scan vừa quét từ máy scan | Máy scan đổ vào `#98.Scan\` — đây là chỗ **tạm**. Sau khi scan, chuyển tệp về đúng chỗ theo bảng này (hoặc tải lên Hub) rồi để văn thư / người quét dọn bản trong `#98.Scan`. |
| Tệp cần chuyển cho phòng khác | Gửi qua Hub (đính kèm việc / văn bản) hoặc email nội bộ. `#97.ChiaSeChung\` chỉ dùng cho tệp không mật, ai trong công ty xem cũng được. |
| CNTT | `#8.CNTT\...` — chỉ phòng CNTT. |

Không chắc chỗ nào → chọn `<phòng>\NN.HoSoCongViec\` của chính phòng người dùng và nói rõ "tạm để ở đây, hỏi trưởng
phòng nếu cần chỗ khác". Không bao giờ chọn thư mục của phòng khác hay thư mục chung để "cho chắc".

## Quy ước đặt tên tệp

```
<MôTảNgắn>_v<NN>_<YYYYMMDD>.<đuôi>
<SốHiệu>_<MôTảNgắn>_v<NN>_<YYYYMMDD>.<đuôi>      (tài liệu có số hiệu: quy chế, quy trình, ISO, biểu mẫu)
```

- MôTảNgắn: tiếng Việt **bỏ dấu**, viết liền, hoa chữ đầu mỗi từ, 3–8 từ: `QuyCheChiTieuNoiBo`, `BaoCaoTuan47`.
- SốHiệu: thay `/` bằng `-`, bỏ dấu: `QC-HCNS-01`, `QT-PC-03`, `BM-TCKT-05`.
- `vNN`: phiên bản hai chữ số, bắt đầu `v01`. Sửa lại → tệp mới `v02`, **giữ** `v01`.
- `YYYYMMDD`: ngày ban hành / ngày ký / ngày lập (không phải ngày chép lên).
- Không dùng tên kiểu `Final`, `Final2`, `Moi`, `Copy of`, `Untitled`, `Scan_0001`.
- Ví dụ: `QC-HCNS-01_QuyCheChiTieuNoiBo_v02_20261115.pdf`, `BaoCaoTienDoThang11_v01_20261130.xlsx`.

Văn bản tải lên qua Hub thì **không** cần tự đặt tên: Hub đặt theo số văn bản.

## Quy tắc an toàn

- Tài liệu của phòng nào chỉ để trong thư mục phòng đó. Không chép sang thư mục phòng khác, không để ở `#97`, `#99`
  trừ khi tài liệu được phép cho toàn công ty.
- Hồ sơ nhân sự, lương, CCCD, sức khỏe, kỷ luật: chỉ trong `#2.HCNS\02.NhanSu\`. Không đọc nội dung các tệp này.
- Văn bản mật / Bảo mật cao: vào sổ trên Hub nhưng **tạm chưa tải bản scan lên** (theo đánh giá bảo vệ dữ liệu của IT);
  hỏi văn thư hoặc Ban GĐ.
- "Access denied" / không mở được thư mục: **không** tìm đường khác (không dùng tài khoản người khác, không nhờ chép
  hộ qua thư mục chung). Báo trưởng phòng hoặc IT xin quyền.
- Không xoá tệp của người khác. Bản cũ hết hiệu lực: trưởng phòng chuyển vào `99.LuuTru`, không xoá.
- Không dán mật khẩu, số tài khoản, CCCD của người khác vào tên tệp hay vào chat.
- Nội dung Claude đọc được gửi lên Claude như tin nhắn — tuân quy định sử dụng AI QC-IT-01.

## Khi người dùng hỏi điều skill không trả lời được

Thư mục mới, phòng mới, quyền mới, đổi cấu trúc: hướng dẫn người dùng liên hệ IT (Kepler Holdings), không tự đề xuất
tạo cấu trúc thư mục mới cấp phòng.
