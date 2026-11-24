# Đề xuất: Quy chế, quy định nội bộ — metadata, phê duyệt của Tổng Giám đốc, cấp được xem

> Trạng thái: **CHỜ CHỦ DỰ ÁN DUYỆT** (giai đoạn 1 — chưa sửa mã). Rà trên `main` 0a3ca5c (24/11/2026), dùng mô hình phân quyền
> "một hệ quy chiếu" đã duyệt 24/11/2026 (PR #41). Giai đoạn 2 (sửa mã) chỉ bắt đầu sau khi chủ dự án duyệt **và** PR #41 merge.
> Tài liệu không chứa tên người, số liệu thật.

---

## 1. Tóm tắt một trang

**Chủ dự án yêu cầu:** tài liệu trong tab "Quy chế, quy định nội bộ" phải có thông tin mô tả (metadata); tạo xong là **Chưa phê duyệt**;
Tổng Giám đốc (TGĐ) bấm **Phê duyệt** thì thành **Đã phê duyệt** — không cần ký số; tài liệu chia **cấp**: cấp lãnh đạo thì nhân viên
không xem được, cấp nhân viên thì lãnh đạo vẫn xem.

**Hiện nay:** tab này là sổ văn bản nội bộ (dãy D5 Quyết định, D6 Ban Điều hành, D7 bộ phận). **Vào sổ là có số ngay, ban hành luôn**,
không có bước duyệt. Quyền xem theo **mức mật** (Công khai / Nội bộ / Hạn chế / Bảo mật cao) — vốn thiết kế cho văn bản đến / đi
(xem theo người xử lý, bộ phận xử lý), không theo vai.

**Đề xuất (5 ý chính):**

1. **Luồng:** Chưa phê duyệt → (TGĐ trả lại kèm lý do ↔ người soạn sửa, gửi lại) → **Đã phê duyệt** → Hiệu lực → Hết hiệu lực / thay thế.
   Mọi lần phê duyệt / trả lại đều ghi nhật ký (ai, lúc nào, lý do, dấu vân tay của tệp PDF lúc phê duyệt).
2. **Số chỉ cấp lúc phê duyệt.** Dự thảo chưa có số, không chiếm số trong sổ; bị trả lại hay huỷ cũng không làm "nhảy số".
3. **Ai phê duyệt:** danh sách **"Người phê duyệt"** trong Thiết lập văn thư, chỉ chọn được tài khoản vai Ban Tổng Giám đốc;
   đặt sẵn tài khoản TGĐ. Danh sách trống → thành viên Ban TGĐ phụ trách "Toàn công ty".
4. **Cấp được xem — theo đúng trục vai đã duyệt**, 3 cấp: **Mọi người** · **Lãnh đạo** (Lãnh đạo bộ phận + Ban TGĐ) · **Ban TGĐ**.
   Cấp cao xem được tài liệu cấp thấp. Quản trị hệ thống không xem nội dung. Trong sổ nội bộ, **"Cấp xem" thay hẳn "mức mật"** —
   chỉ một khái niệm, không chạy song song.
5. **Dự thảo** chỉ người soạn, người phê duyệt và Văn thư thấy (Văn thư cũng không vượt cấp xem theo vai của mình).

**Cần chủ dự án chốt 5 câu** (mục 9). Mỗi câu có khuyến nghị; chỉ cần trả lời "đồng ý khuyến nghị" nếu không có ý khác.

---

## 2. Trạng thái và luồng

```
 Người soạn tạo ──► [Chưa phê duyệt] ──(TGĐ bấm Phê duyệt)──► [Đã phê duyệt] ──(đến ngày hiệu lực)──► [Hiệu lực] ──► [Hết hiệu lực / thay thế]
                        ▲      │                                 cấp số ngay lúc này
                        │      └──(TGĐ bấm Trả lại + lý do)──► [Đã trả lại] ── người soạn sửa, bấm "Gửi lại" ──┘
                        └─────────────────────────────────────────────────────────────────────────────┘
```

| Trạng thái | Có số? | Ai thấy | Ghi chú |
|---|---|---|---|
| **Chưa phê duyệt** (dự thảo) | Không — hiện "Dự thảo" | Người soạn, Người phê duyệt, Văn thư | Sửa được; người phê duyệt nhận thông báo "có tài liệu chờ phê duyệt" |
| **Đã trả lại** | Không | Như trên | Bắt buộc ghi lý do; người soạn nhận thông báo |
| **Đã phê duyệt** | Có — cấp lúc bấm | Theo cấp xem (mục 4) | Khoá nội dung và tệp. Ngày ban hành = ngày phê duyệt |
| **Hiệu lực** | Có | Theo cấp xem | Tự chuyển khi đến "Ngày hiệu lực" (trống = ngay khi phê duyệt) |
| **Hết hiệu lực / thay thế** | Có | Theo cấp xem | Tự chuyển khi văn bản thay thế được phê duyệt; hoặc Văn thư đánh dấu |

- **Huỷ dự thảo:** người soạn / Văn thư huỷ được khi chưa phê duyệt — không mất số vì chưa có số.
- **Huỷ số** sau khi đã phê duyệt: giữ như hiện nay (Văn thư / Ban TGĐ, ghi lý do, số không cấp lại — QyĐ-GA-01 Điều 7.1.5).
- **Sửa sau khi đã phê duyệt:** không sửa nội dung / tệp. Muốn đổi → tạo bản mới, chọn "Thay thế văn bản số …", đi lại luồng phê duyệt.
  Chỉ Văn thư được sửa vài thông tin không đổi nghĩa (ghi chú, ngày hiệu lực nếu chưa đến) — mọi lần sửa đều ghi nhật ký.
- **Nhật ký** (sẵn có `DocEvent` + nhật ký hệ thống): thêm các mục *Gửi phê duyệt*, *Phê duyệt*, *Trả lại* (kèm lý do), *Gửi lại*.
  Lúc phê duyệt ghi kèm **mã băm SHA-256 của từng tệp** — chứng minh đúng bản PDF đó đã được duyệt, thay cho ký số.

## 3. Cấp số lúc phê duyệt (khuyến nghị)

- Hiện tại: bấm "Vào sổ" là có số. Nếu giữ vậy, dự thảo bị trả lại hay bỏ sẽ thành số **bị huỷ** trong sổ — sổ đầy số huỷ.
- Đề xuất: số cấp **ngay lúc Người phê duyệt bấm Phê duyệt**, theo đúng dãy D5 / D6 / D7, pháp nhân, năm — cùng cơ chế khoá chống trùng
  số đang dùng. Sổ đến / đi **không đổi** (vẫn có số ngay).
- Hệ quả tốt: tạo dự thảo không còn là "cấp số", nên có thể cho tạo dự thảo qua Claude mà không vi phạm nguyên tắc
  "vào sổ làm trên giao diện" (câu 9.4).

## 4. Cấp được xem — một trục vai, thay cho mức mật

**Ba cấp, xếp theo trục vai đã duyệt:**

| Cấp xem của tài liệu | Ban TGĐ | Lãnh đạo bộ phận | Nhân viên | Quản trị hệ thống |
|---|:-:|:-:|:-:|:-:|
| **Mọi người** | ✔ | ✔ | ✔ | — |
| **Lãnh đạo** | ✔ | ✔ | — | — |
| **Ban TGĐ** | ✔ | — | — | — |

- Cấp cao xem được tài liệu cấp thấp ("tài liệu của nhân viên thì lãnh đạo vẫn xem").
- Chỉ xét **vai**. Không xét bộ phận, không xét phạm vi phụ trách của thành viên Ban TGĐ, không xét kiêm nhiệm — để đơn giản và đúng một hệ quy chiếu.
- Ngoại lệ duy nhất: **người soạn** luôn xem được tài liệu mình soạn.
- Quản trị hệ thống (IT) không xem nội dung nghiệp vụ (giữ quyết định 16/10/2026).

**Thay thế, không ánh xạ:** trong sổ nội bộ, ô "Mức bảo mật" **bỏ khỏi giao diện**, thay bằng ô **"Cấp xem"**. Lý do không ánh xạ
(vd. Hạn chế = Lãnh đạo): cùng một chữ "Hạn chế" sẽ mang hai nghĩa ở hai sổ (sổ đến / đi: theo người xử lý; sổ nội bộ: theo vai) — chính là
kiểu "hai hệ quy chiếu" chủ dự án vừa yêu cầu bỏ. Sổ đến / đi giữ mức mật như cũ (đó là văn bản giao dịch, quyền theo người xử lý — ngoài
phạm vi đề xuất này). Danh sách "được xem đích danh" của mức Bảo mật cao **không dùng** cho sổ nội bộ.

## 5. Metadata tối thiểu

| Thông tin | Người nhập? | Bắt buộc | Ghi chú |
|---|---|:-:|---|
| **Loại** | ✔ | ✔ | Quy chế · Quy định · Quy trình · Hướng dẫn · Quyết định · Thông báo · Khác. Quyết định ký hiệu trong số (QC, QyĐ, QT, HD, QĐ, TB…) |
| **Tên / trích yếu** | ✔ | ✔ | Có sẵn |
| **Dãy số, pháp nhân, bộ phận soạn** | ✔ | ✔ | Có sẵn (D5 / D6 / D7; HLD / DXA) |
| **Cấp xem** | ✔ | ✔ | Mục 4. Mặc định "Mọi người" |
| **Tệp PDF** | ✔ | ✔ trước khi phê duyệt | Có sẵn. Không có tệp thì nút Phê duyệt bị khoá — TGĐ phải thấy đúng bản mình duyệt |
| **Mã tài liệu** | ✔ | — | Mã quản lý ổn định qua các phiên bản, vd. QC-IT-01, QyĐ-GA-01 |
| **Ngày hiệu lực** | ✔ | — | Trống = hiệu lực ngay khi phê duyệt |
| **Thay thế văn bản** | ✔ | — | Chọn từ sổ. Phiên bản tự suy: bản đầu là 1, mỗi lần thay thế +1 |
| Số hiệu | tự động | | Cấp lúc phê duyệt |
| Người soạn | tự động | | = người tạo |
| Người phê duyệt, ngày phê duyệt | tự động | | = người bấm Phê duyệt |

Bỏ khỏi form sổ nội bộ: "Người ký" (thay bằng Người phê duyệt), "Mức bảo mật" (thay bằng Cấp xem).

## 6. Ai làm được gì

Theo trục vai đã duyệt. *Nghiêng* = kiêm nhiệm hoặc quan hệ với tài liệu, không phải vai.

| Việc | Ban TGĐ | Lãnh đạo bộ phận | Nhân viên | Quản trị hệ thống |
|---|---|---|---|---|
| **Tạo dự thảo** | ✔ mọi dãy | ✔ dãy D7 của bộ phận mình | — (*Văn thư*: ✔ mọi dãy) | — |
| **Sửa / gửi lại / huỷ dự thảo** | *người soạn*; *Văn thư* | *người soạn* | *Văn thư* | — |
| **Phê duyệt / trả lại** | *Người phê duyệt* (chỉ chọn được trong vai Ban TGĐ) | — | — | — |
| **Xem dự thảo** | *người soạn*, *Người phê duyệt*, *Văn thư* | *người soạn*, *Văn thư* | *Văn thư* | — |
| **Xem tài liệu đã phê duyệt** | 3 cấp | Mọi người + Lãnh đạo | Mọi người | — |
| **Đánh dấu hết hiệu lực, huỷ số** | ✔ | — | *Văn thư* | — |
| **Chọn Người phê duyệt, Văn thư** (Thiết lập văn thư) | ✔ | — | — | — |

- *Văn thư* là kiêm nhiệm, có thể ở vai nào cũng được; ghi ở cột Nhân viên chỉ để thấy rằng nhân viên làm Văn thư cũng làm được.
- "Văn thư" xem dự thảo **trong giới hạn cấp xem theo vai** của chính họ: một Văn thư vai Nhân viên không xem dự thảo cấp Lãnh đạo / Ban TGĐ.
- Người soạn bao giờ cũng xem được dự thảo của mình.
- **Không ai khác bấm được Phê duyệt** — máy chủ trả lỗi 403, kể cả Ban TGĐ không có tên trong danh sách và kể cả qua Claude.

## 7. Claude / connector

- Hiện nay Claude chỉ đọc sổ (không thấy Bảo mật cao), không vào sổ, không tải tệp về.
- Sau khi đổi: Claude đọc tài liệu **đã phê duyệt** trong cấp xem của người dùng, **trừ cấp Ban TGĐ** (tương ứng chặn Bảo mật cao như cũ);
  không đọc dự thảo của người khác; **không bao giờ phê duyệt / trả lại / cấp số** (máy chủ chặn theo token, không chỉ ẩn nút).
- Tạo dự thảo qua Claude: xem câu 9.4.

## 8. Văn bản nội bộ đã có trong sổ

- Trước khi chuyển: chạy lệnh **đếm** văn bản NOIBO trên bản thật (chỉ đếm, không xuất nội dung). Hiện chưa chỉ định Văn thư nào nên
  dự kiến rất ít hoặc không có.
- Văn bản đã có **giữ nguyên số**, coi là **Đã phê duyệt** (ghi "ban hành trước khi có luồng phê duyệt", người phê duyệt để trống).
  Trạng thái Hiệu lực / Hết hiệu lực giữ nguyên.
- Cấp xem chuyển một lần theo mức mật cũ: Công khai, Nội bộ → **Mọi người**; Hạn chế → **Lãnh đạo**; Bảo mật cao → **Ban TGĐ**.
  Ghi một dòng nhật ký cho mỗi văn bản. Văn thư / Ban TGĐ rà lại cấp xem sau khi chuyển (nếu có văn bản).
- Migration chỉ thêm cột, không xoá dữ liệu; quay lại bản cũ được.

## 9. Câu hỏi cho chủ dự án

| # | Câu hỏi | Khuyến nghị |
|---|---|---|
| 9.1 | Ai được bấm Phê duyệt? | **Danh sách "Người phê duyệt"** trong Thiết lập văn thư, đặt sẵn tài khoản TGĐ; chỉ chọn được vai Ban TGĐ. Trống → Ban TGĐ phụ trách "Toàn công ty" |
| 9.2 | Mọi tài liệu trong tab (cả D7 của bộ phận) đều phải TGĐ duyệt? | **Có**, một luồng, một người duyệt — đơn giản. (Phương án khác: D7 do lãnh đạo bộ phận duyệt — thêm một luồng, không khuyến nghị) |
| 9.3 | Ba cấp xem "Mọi người / Lãnh đạo / Ban TGĐ", thay hẳn mức mật trong sổ nội bộ? | **Đồng ý** (mục 4) |
| 9.4 | Cho tạo **dự thảo** qua Claude (kèm công cụ tải PDF lên làm dự thảo)? | **Có, có điều kiện:** dự thảo không có số; chỉ người có quyền tạo trên giao diện mới tạo được qua Claude; cấp xem không vượt vai người dùng; ghi rõ "tạo qua Claude"; phê duyệt **chỉ** trên giao diện, do người. Nếu chưa muốn: để sau, phần còn lại không phụ thuộc |
| 9.5 | Văn bản đã có trong sổ nội bộ xử lý thế nào? | **Coi là Đã phê duyệt, giữ số**, chuyển cấp xem theo mức mật cũ (mục 8) |

## 10. Đánh giá bảo vệ dữ liệu (Data Protection Gate — rút gọn)

| Lớp | Đánh giá |
|---|---|
| GOV (quản trị) | Tập `vanthu.doc` — nhãn nội bộ giữ "theo văn bản"; với sổ nội bộ đổi thành theo **Cấp xem**. Người phê duyệt do Ban TGĐ chỉ định, ghi nhật ký thay đổi thiết lập |
| PRE (phòng ngừa) | Quyền xem kiểm ở máy chủ (danh sách, chi tiết, tệp, tìm kiếm, "gắn vào việc"); dự thảo không lọt danh sách; Claude không phê duyệt, không đọc cấp Ban TGĐ, không tải tệp về |
| DET (phát hiện) | Nhật ký phê duyệt / trả lại / tải tệp (sẵn có), kèm mã băm tệp lúc phê duyệt |
| PRI (riêng tư) | Quy chế thường không chứa dữ liệu cá nhân; quyết định nhân sự (D5) có thể có → đặt cấp Lãnh đạo / Ban TGĐ. Không đổi cách lưu tệp (NAS) |
| RES (ứng phó) | Migration chỉ thêm cột, quay lại được. Lưu nhật ký ≥ 12 tháng như quy định chung |

Pháp lý: không thay đổi việc chuyển dữ liệu ra ngoài; không ký số nên không thuộc Luật Giao dịch điện tử về chữ ký số — giá trị phê duyệt
dựa trên tài khoản + nhật ký. Giai đoạn 2 cập nhật `docs/data-protection-assessment.md`.

## 11. Phụ lục kỹ thuật (cho giai đoạn 2)

- `DocRecord`: `number`, `seq` cho phép trống (dự thảo); thêm `viewLevel` (ALL / LEADERS / BOARD), `approvedById`, `approvedAt`,
  `effectiveDate`, `docCode`, `replacesId`, `returnReason`. Trạng thái NOIBO: `DRAFT`, `RETURNED`, `APPROVED`, `EFFECTIVE`, `EXPIRED`
  (đổi `ISSUED` cũ → `APPROVED`). Cấu hình: `approverUserIds`.
- Hàm quyền dùng hàm vai của PR #41 (`isBoard`, `isDeptLeader`, `roleRank`, `boardAll`), không so chuỗi vai.
- API mới: `POST /api/vanthu/docs/:id/approve`, `/return`, `/resubmit`; cấp số chuyển từ lúc tạo sang lúc approve (cùng khoá `pg_advisory_xact_lock`).
- Test: ma trận 3 cấp xem × 4 vai (+ người soạn, Văn thư vai Nhân viên) cho danh sách / chi tiết / tệp / tìm / gắn việc;
  luồng phê duyệt (không phải Người phê duyệt → 403; qua token → 403; không có PDF → 422; số liên tục khi trả lại / huỷ dự thảo); e2e một vòng.
