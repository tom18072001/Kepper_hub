# WorkHub — quản lý công việc Kanban cho công ty / phòng ban

> Branch `workhub-kanban` (tái cơ cấu từ hệ thống NQ57 trên `main`). Kế hoạch: [`docs/PLAN-workhub.md`](docs/PLAN-workhub.md) · Đánh giá bảo vệ dữ liệu: [`docs/data-protection-assessment.md`](docs/data-protection-assessment.md).

Một tổ chức, nhiều phòng ban. Mỗi phòng ban có các dự án; công việc được theo dõi trên bảng Kanban và nhiều kiểu xem khác, có duyệt nhiều cấp, đính kèm tệp, bình luận, dashboard số liệu dòng chảy.

## Tính năng (GĐ0 → GĐ3c)

| Nhóm | Nội dung |
|---|---|
| Kiểu xem | **Bảng Kanban** (kéo-thả, giới hạn WIP theo cột, chia làn theo người nhận/ưu tiên, thêm nhanh), **Danh sách** (sắp xếp cột), **Lịch** theo hạn, **Timeline** (Gantt gọn), **Việc của tôi** trên mọi dự án |
| Công việc | Mã việc theo dự án (KD-12), mô tả rich-text, ưu tiên, nhiều người nhận, nhãn, ngày bắt đầu/hạn, ước lượng, việc con, checklist, bình luận `@tàikhoản`, tệp đính kèm + xem trước PDF/ảnh/Word, lịch sử thay đổi, **xoá vào Thùng rác** (khôi phục trong 7 ngày, sau đó tự xoá hẳn) |
| Duyệt nhiều cấp | Cấu hình 1–5 cấp mỗi dự án (Trưởng dự án / Trưởng phòng / Ban giám đốc / người chỉ định). Kéo vào cột *Chờ duyệt* → gửi duyệt; duyệt hết các cấp → tự *Hoàn thành*; trả lại (bắt buộc lý do) → về cột trước. **Linh hoạt theo việc**: mặc định của dự án (vd. chỉ trưởng phòng), **quy tắc tự động** theo nhãn/ưu tiên (vd. nhãn "Hợp đồng" → cần giám đốc), trưởng phòng **chọn tay** cho từng việc (Không cần duyệt / 1 cấp / đủ cấp). Chọn người duyệt ngay khi tạo dự án; hiện tên người duyệt thực tế; chặn tự duyệt; khoá mức duyệt khi đang chờ |
| Tổ chức & quyền | Phòng ban (có cây trực thuộc), vai trò Quản trị / Ban giám đốc / Trưởng phòng / Nhân viên, phân quyền theo phạm vi *phòng ban* hoặc *toàn tổ chức*, dự án phạm vi Cả phòng ban / Chỉ thành viên / Toàn tổ chức, thành viên dự án (Chủ / Thành viên / Người xem) |
| Số liệu | Dashboard: việc mở, quá hạn, sắp đến hạn, chờ duyệt, throughput 8 tuần, cycle time, khối lượng theo người, việc tồn lâu, theo phòng ban |
| Tiếp nhận yêu cầu | Dự án bật "Nhận yêu cầu" xuất hiện ở mục **Gửi yêu cầu** cho mọi phòng ban; hộp **Tiếp nhận** của dự án: tiếp nhận (tạo việc, người gửi được báo tới khi hoàn thành) hoặc từ chối có lý do. Người gửi chỉ thấy trạng thái + mã việc, không thấy nội dung dự án |
| Chu kỳ | Sprint theo tuần/2 tuần mỗi dự án, chặn trùng thời gian, tiến độ (không tính việc huỷ), lọc "Chu kỳ hiện tại" trên mọi kiểu xem, chuyển việc chưa xong sang chu kỳ sau |
| Việc lặp lại | Đặt ngay trong việc ("Lặp lại việc này") hoặc khi tạo việc; mỗi ngày làm việc (T2–T6) / hằng ngày / hằng tuần (chọn thứ) / hằng tháng (chọn ngày hoặc ngày cuối tháng), nhiều người nhận, sửa lịch, tạo lúc 07:00 giờ Việt Nam, giao sẵn người nhận, hạn sau N ngày, "Tạo ngay", tạm dừng |
| Ghi chú của tôi | Tab trong *Việc của tôi*: ghi nhanh, hạn, ghim, đánh dấu xong, chuyển thành việc của dự án. **Chỉ chủ nhân xem được** (kể cả quản trị). Xoá 30 ngày sau khi tài khoản bị khoá |
| KPI | Chỉ Ban giám đốc: tỷ lệ đúng hạn, hoàn thành trong kỳ, thời gian xử lý, đang quá hạn, số lần bị trả lại — theo phòng ban và từng người; kỳ tháng/quý/năm/tuỳ chọn; mỗi lần xem ghi nhật ký |
| Sổ giao việc | Kiểu xem theo đúng mẫu "Sổ theo dõi, kiểm soát giao việc nội bộ": nhóm việc / việc nhánh, nguồn giao việc, người giao, chủ trì, phối hợp (người + đơn vị ghi tự do), ngày giao, hạn, tiến độ %, ngày hoàn thành thực tế, sản phẩm đầu ra, sản phẩm đã có, kết quả / khó khăn, đánh giá của người giao. Trạng thái hạn tự tính (Quá hạn / Sắp đến hạn / Đang thực hiện / HT đúng hạn / HT trễ hạn), lọc theo trạng thái. Nhập và xuất Excel đúng mẫu sổ. Mẫu nhóm việc sinh sẵn các việc nhánh |
| Kế hoạch năm | Nhập văn bản "Kế hoạch công tác năm" (.docx): mỗi nhiệm vụ trong bảng "Phân công công việc cụ thể" thành một dòng trong sổ (nhóm nhiệm vụ, kinh phí, thời gian, địa điểm, kết quả dự kiến, người chủ trì); các mốc "Tháng …: …" và việc "mỗi Quý" thành việc nhánh. Có xem trước |
| Tổng hợp giao việc | Theo cán bộ chủ trì: tổng việc, đang thực hiện, sắp đến hạn, quá hạn, HT đúng/trễ hạn, tỷ lệ đúng hạn, số việc phối hợp. Giám đốc xem toàn đơn vị, trưởng phòng xem phòng mình |
| Danh mục | Số ngày cảnh báo "Sắp đến hạn", danh sách nguồn giao việc, mẫu nhóm việc |
| Điều hành hai chiều | **Sổ giao việc của đơn vị** (phạm vi "Theo việc": mỗi người chỉ thấy việc liên quan đến mình). Ban Giám đốc **giao về phòng chủ trì** (kèm phòng phối hợp, văn bản căn cứ) hoặc giao thẳng cán bộ. Lãnh đạo phòng có hộp **Việc phòng được giao** để tiếp nhận, phân công. Cán bộ **báo cáo tiến độ** (khó khăn, kiến nghị — người giao trả lời), **xin gia hạn** (người giao duyệt, giữ hạn gốc; không tự lùi hạn), **nộp sản phẩm (phiếu trình)**. Lãnh đạo phòng chủ trì duyệt rồi trình Ban Giám đốc. Người giao / PGĐ phụ trách cho ý kiến và **xếp loại** |
| Loại nhiệm vụ | Kế hoạch năm / Đột xuất (theo chỉ đạo); lọc trong Sổ giao việc và Tổng hợp; có cột trong file Excel xuất / nhập |
| Bộ máy | Vai trò **Phó phòng** (quyền như trưởng phòng); **PGĐ phụ trách** từng phòng (nhận phiếu trình của phòng); **uỷ quyền có thời hạn** cho việc duyệt và tiếp nhận |
| Văn bản liên quan | Số, ký hiệu, ngày, trích yếu, nơi ban hành, liên kết của văn bản trên hệ thống văn bản điện tử (căn cứ giao việc, sản phẩm tham mưu, văn bản đã phát hành). Không nhập văn bản mật |
| Điều hành (GĐ3b) | Trang **Điều hành** cho Ban Giám đốc (mặc định là các phòng mình phụ trách, xem được toàn Trung tâm) và lãnh đạo phòng: chờ BGĐ cho ý kiến, kiến nghị chưa trả lời, đề nghị gia hạn, chờ phòng tiếp nhận, quá hạn, sắp đến hạn, chờ phòng duyệt, bị trả lại; bảng theo phòng chủ trì (Kế hoạch năm x/y, đột xuất, đúng hạn). **Khâu** của từng việc (chờ tiếp nhận → đang thực hiện → chờ phòng duyệt → chờ BGĐ → hoàn thành; bị trả lại) hiện ở sổ, hộp việc phòng, việc của tôi, file Excel. **Chờ tôi xử lý**: phiếu trình / đề nghị gia hạn (quyết định ngay trong danh sách) / kiến nghị. Panel việc có **thanh tóm tắt** (khâu, vai trò của tôi, hạn, nút việc cần làm tiếp) và biển "Bị trả lại" kèm lý do; nộp lại ghi **lần trình N** |
| Giao & chia việc (GĐ3b) | **Giao nhiều việc** một lần (lưới nhập, dán từ Excel; Văn phòng nhập thay mặt lãnh đạo); **hạn nộp phòng** (nội bộ, không muộn hơn hạn của người giao); **chia nhiều việc nhánh**; **áp mẫu** có xem trước (sửa tên, người, hạn từng việc, hạn tương đối theo ngày mốc); phòng phối hợp **cử cán bộ phối hợp**; người phối hợp chỉ báo phần mình. Người duyệt cấp Ban Giám đốc là **PGĐ phụ trách** phòng; không ai duyệt hai cấp của cùng phiếu |
| Số liệu (GĐ3b) | Dashboard, KPI, báo cáo tuần tính theo **đơn vị chủ trì**; KPI có Kế hoạch năm / Đột xuất / xếp loại và **điểm tổng hợp** (trọng số trong Danh mục); **Số liệu của tôi** trong Việc của tôi; Tổng hợp giao việc theo phòng + cán bộ, **xuất Excel**; báo cáo Word theo phòng, loại nhiệm vụ, khó khăn – kiến nghị, kỳ đến 1 quý. **Timeline** dạng Gantt theo Quý / Tháng / Tuần, gom việc nhánh theo việc cha, % tiến độ |
| Quản trị (GĐ3b) | Đổi vai trò → áp quyền mặc định của vai trò mới (cảnh báo quyền lệch); khoá tài khoản nghỉ việc có **bàn giao** (trả việc về phòng phân công lại, thu hồi uỷ quyền, bỏ PGĐ phụ trách — admin chỉ thấy số đếm); nhật ký có nhãn tiếng Việt, bộ lọc, ẩn nội dung nghiệp vụ với Admin IT, ghi đăng nhập sai |
| Giao diện (GĐ3c) | Panel việc theo **vai trò và khâu**: thanh tóm tắt (khâu, vai trò, hạn đếm ngược, **một** nút chính), vùng **"Cần bạn xử lý"** ngay trên (duyệt, quyết định gia hạn, trả lời kiến nghị, bị trả lại), các khối khác **thu gọn có nhớ theo người**; cột phải chỉ trường chính, còn lại vào "Thêm thông tin"; giữ vị trí cuộn khi cập nhật, báo "Có cập nhật mới" khi đang gõ; **bản nháp** không mất khi lỡ Esc; **Hoàn tác** khi xoá vào thùng rác / xoá mục checklist / gỡ văn bản. Bộ lọc dự án: chip nhanh + "Thêm bộ lọc" + chip đang áp, lưu URL, nhớ lần trước. Việc của tôi tách "Cần tôi làm" / "Đang chờ người khác"; Điều hành sắp khối theo vai trò |
| Phím tắt | `?` danh sách (tắt được phím một chữ), `Ctrl K` hoặc `/` tìm nhanh, `G` rồi `O/M/A/D/B/K/T/R/N/S` chuyển trang, `J/K` + `Enter` đi trong danh sách (cả khi panel đang mở), `C` tạo việc, trong panel `V` vùng cần xử lý, `S` trạng thái, `P` ưu tiên, `A` phân công, `D` hạn, `E` xin gia hạn, `R` báo cáo, `L` nhãn, `M` bình luận, `Ctrl Enter` gửi, `Esc` đóng từng lớp. Không chạy khi đang gõ / bộ gõ tiếng Việt đang ghép chữ |
| Bộ lọc đã lưu | Lưu kiểu xem + bộ lọc (riêng hoặc chia sẻ trong dự án) |
| Thời gian thực | Bảng, panel chi tiết và chuông thông báo tự cập nhật khi người khác thay đổi (không vẽ lại khi bạn đang gõ thêm nhanh hoặc đang kéo thẻ) |
| Báo cáo tuần | Xuất Word: việc hoàn thành trong kỳ, đang làm, chờ duyệt, quá hạn, kế hoạch tuần tới — theo phạm vi quyền (phòng ban / toàn tổ chức) |
| Nhãn | Nhãn chung (quản trị) + nhãn riêng dự án: gõ tên trong ô Nhãn để tạo ngay, quản lý trong Cài đặt dự án |
| Quản trị IT | Tài khoản admin chỉ quản trị (tài khoản, phòng ban, nhãn chung, nhật ký) — **không** xem/duyệt nội dung công việc, dự án, báo cáo |
| Khác | Thông báo trong app (giao việc, nhắc tên, duyệt, sắp đến hạn 8:00 hằng ngày), tìm nhanh `Ctrl+K`, xuất/nhập Excel, nhật ký hệ thống, dùng được trên di động |

## Chạy trên máy (Docker)

Yêu cầu: Docker Desktop (Windows/macOS) hoặc Docker Engine + Compose v2.

```bash
cp .env.example .env          # Windows PowerShell: copy .env.example .env
# Sửa .env: POSTGRES_PASSWORD, JWT_SECRET (openssl rand -hex 32), ROOT_ADMIN_PASSWORD
# Muốn có dữ liệu mẫu để dùng thử: SEED_DEMO=true
docker compose up -d --build
```

Mở http://localhost:4000, đăng nhập bằng `ROOT_ADMIN_USERNAME` / `ROOT_ADMIN_PASSWORD`.

**Dữ liệu mẫu cuối (bộ máy Trung tâm, GĐ3d)** — tên giả, mật khẩu mặc định, phải đổi khi đăng nhập lần đầu:

- Ban Giám đốc: `giamdoc` (Giám đốc), `pgd`, `pgd2` (Phó Giám đốc; PGĐ phụ trách: Văn phòng → Giám đốc, KHCN → `pgd`, Tài năng trẻ → `pgd2`).
- Văn phòng: `cvp` (Chánh VP), `pcvp` (Phó Chánh VP), `cv.vp1`. Phòng Khoa học Công nghệ: `tp.khcn`, `pp.khcn`, `cv.khcn1`, `cv.khcn2`. Phòng Tài năng trẻ: `tp.tnt`, `pp.tnt`, `cv.tnt1`.
- **Sổ giao việc Trung tâm "TT"** ở đủ các khâu (chờ phòng tiếp nhận, đang làm có báo cáo tiến độ / đề nghị gia hạn / kiến nghị, quá hạn, chờ phòng duyệt, chờ BGĐ cho ý kiến, đã xếp loại, nhóm việc có việc nhánh) kèm **Kế hoạch công tác năm 2027 (mẫu)**; mỗi phòng có một bảng Kanban **việc nội bộ**.

Tạo trên máy mới: `SEED_DEMO=true` khi khởi tạo, rồi `docker compose exec app npm run seed:showcase` và `docker compose exec app npm run tidy:demo`. Máy đang chạy bản cũ: chỉ cần `npm run tidy:demo -- --dry` (xem trước) rồi `npm run tidy:demo` — dự án mẫu cũ (Kinh doanh / Kỹ thuật / HCNS, sổ "GV", dự án thử tên toàn số) vào **Thùng rác** (tự xoá hẳn sau 7 ngày), tài khoản và phòng mẫu cũ bị **khoá**; mọi bước ghi nhật ký hệ thống. Chạy lại không tạo trùng. (Bộ mẫu cũ vẫn được `SEED_DEMO` tạo vì E2E dùng nó.)

Với `SEED_DEMO=true` có sẵn dữ liệu **giả**: tài khoản `giamdoc`, `tp.kinhdoanh`, `nv.kinhdoanh1`, `nv.kinhdoanh2`, `tp.kythuat`, `nv.kythuat`, `nv.hcns` — mật khẩu ban đầu `12345678`, phải đổi ở lần đăng nhập đầu.

Tuỳ chọn thêm MinIO và bộ xem trước Word (LibreOffice, image ~700 MB): đặt `STORAGE_DRIVER=minio`, `PREVIEW_URL=http://office-preview:4100`, `PREVIEW_TOKEN` (≥ 32 ký tự) trong `.env` rồi chạy `docker compose --profile full up -d --build`.

Dữ liệu nằm trong volume `workhub_pgdata` và `workhub_uploads`.

**Sao lưu tự động:** service `backup` chạy hằng ngày lúc `BACKUP_HOUR` (mặc định 02:00), ghi CSDL (`pg_dump`) + tệp đính kèm + tổng kiểm SHA-256 vào thư mục `./backups` (đổi bằng `BACKUP_PATH`), giữ `BACKUP_KEEP_DAYS` ngày. Nên chép `./backups` sang ổ hoặc máy khác (quy tắc 3-2-1).

```bash
docker compose exec backup sh -c 'BACKUP_ONCE=1 sh /deploy/backup.sh'        # sao lưu ngay
docker compose stop app                                                       # khôi phục: dừng app trước
docker compose --profile restore run --rm -e RESTORE_FROM=/backups/<thư-mục> restore
docker compose start app
```

## Chạy không cần Docker (phát triển)

```bash
cd app/server
cp .env.example .env          # trỏ DATABASE_URL tới PostgreSQL 14+
npm install
npx prisma migrate deploy
SEED_DEMO=true npm run seed
npm start                     # http://localhost:4000
```

**Gọn giao diện (GĐ3g).** Lãnh đạo vào thẳng **Tổng quan** (gộp Điều hành + việc chờ mình xử lý; một hàng chọn phạm vi Toàn Trung tâm / từng phòng; link "Số liệu chi tiết"). Thanh bên bỏ "Chờ tôi xử lý" và "Dashboard" với lãnh đạo (số việc chờ hiện ngay trên Tổng quan). Tạo việc chỉ để ngoài Tiêu đề · Giao cho · Hạn · Ưu tiên; ô **Giao cho** chọn được cả phòng hoặc giao thẳng một người (đại diện phòng). Các thao tác ít dùng (nhập / xuất Excel, giao nhiều việc, cài đặt, in) gộp vào nút **Khác**.

**Lịch công tác (GĐ3f).** Mục "Lịch công tác": lịch tuần của Trung tâm và từng phòng theo mẫu văn bản (Thời gian | Nội dung | Thành phần | Chủ trì | Địa điểm | Ghi chú), ô "Vắng mặt hôm nay" (lịch ngoài cơ quan + báo vắng), nhập lịch tuần từ Excel đúng mẫu, xuất Excel, in. Sửa lịch Trung tâm: Ban Giám đốc và Văn phòng; lịch phòng: lãnh đạo phòng; báo vắng: mỗi người cho mình. Mục "Gửi yêu cầu" đã bỏ khỏi giao diện.

**Lịch và cột tự do (GĐ3e).** Cột của bảng đặt tên tuỳ ý; nhóm "Cột tự do" chỉ để sắp xếp (không tính tiến độ, không gửi duyệt). Tạo dự án kiểu **Lịch tuần** (Thứ 2 … Cuối tuần) để báo ai ở / không ở văn phòng; trong Cài đặt có nút điền mẫu cột. Việc của tôi và Việc phòng được giao có kiểu xem **Lịch** theo tuần (việc trải từ ngày bắt đầu đến hạn) hoặc tháng.

## Kiểm thử

```bash
cd app/server && npm test                          # 108 unit test (node:test)
cd app/e2e && npm install && npx playwright install chromium
E2E_DATABASE_URL=postgresql://workhub:<mật khẩu>@127.0.0.1:5434/workhub_e2e npx playwright test
```

E2E tự **xoá và dựng lại** CSDL test (tên bắt buộc kết thúc `_e2e` hoặc `_test`), chạy server thật + Chromium. Chỉ giữ **16 kịch bản critical** (các kịch bản trùng lặp hoặc chỉ kiểm tra giao diện đã bỏ ở GĐ3b): đăng nhập/đổi mật khẩu, quản trị + phân quyền, tạo dự án + WIP + duyệt, Kanban kéo-thả + chặn WIP, chi tiết việc + chặn tệp giả mạo, duyệt nhiều cấp trả lại/hoàn thành, phân quyền dữ liệu giữa phòng ban + quyền xoá, header bảo mật/XSS, duyệt linh hoạt + chặn tự duyệt, quy tắc duyệt tự động + nhãn, quyền riêng tư ghi chú, admin IT không xem công việc + KPI giám đốc, sổ giao việc (nhập Kế hoạch năm Word + sổ Excel, trạng thái hạn, tiến độ, xuất sổ, phạm vi tổng hợp), giao việc về phòng (tiếp nhận → báo cáo → gia hạn → phiếu trình → phòng duyệt → BGĐ xếp loại), điều hành (giao nhiều việc, hạn nộp phòng, việc nhánh, người phối hợp bị chặn đổi trạng thái, trả lại → nộp lại, PGĐ phụ trách duyệt, gia hạn từ hàng chờ, phạm vi Điều hành, tìm kiếm), lịch công tác (nhập Excel, báo vắng, phân quyền sửa lịch). Tạo CSDL test trên Postgres của compose: `docker compose exec postgres createdb -U workhub workhub_e2e`.

## Cấu trúc

```
app/server/   Express 5 + Prisma (PostgreSQL)
  prisma/       schema.prisma + migrations/ (dùng prisma migrate, không db push)
  src/app.js    middleware bảo mật (helmet/CSP, CORS theo APP_ORIGIN, rate limit, trust proxy), lỗi JSON
  src/routes/   auth, admin, projects, items, attachments, approvals, me, dashboard, excel,
                intake, cycles, recurring, views, reports (Word), realtime (SSE)
  src/services/ access (quyền cấp dự án), workitems (tạo việc + chuyển trạng thái dùng chung), approval (duyệt nhiều cấp),
                recurring (lịch lặp), bus (sự kiện thời gian thực), events (audit/activity/thông báo)
  src/lib/      auth, permissions, rich-text (sanitize-html), files (allowlist + chữ ký tệp), storage, document-preview
app/web/      Giao diện JavaScript thuần (ES modules, không build): js/main.js + js/views/*
app/e2e/      Playwright
deploy/       backup.sh / restore.sh (dùng bởi service backup)
```

Đăng nhập, mật khẩu mặc định và luồng cấp quyền khi tạo tài khoản **giữ nguyên như bản NQ57** theo yêu cầu chủ dự án — xem mục rủi ro trong đánh giá bảo vệ dữ liệu.

## Data Protection Gate (bắt buộc)

Dự án tuân theo "Khung bảo vệ dữ liệu trong Quản trị dữ liệu".
- Trước khi chốt thiết kế, kịch bản hoặc thay đổi lớn về dữ liệu, AI/agent PHẢI chạy đánh giá bảo vệ dữ liệu
  (5 lớp, 25 năng lực GOV/PRE/DET/PRI/RES, pháp lý VN) và đưa khuyến nghị cho chủ dự án.
- Mọi tập dữ liệu mang nhãn nội bộ (Công khai/Nội bộ/Bảo mật/Hạn chế) + phân loại pháp lý; nhiều tiêu chí → mức cao nhất.
- Không dùng dữ liệu thật trên DEV/UAT; PII phải được che/token hóa trước khi vào log, index, môi trường phân tích.
- Nhật ký: xử lý dữ liệu cốt lõi/quan trọng ≥ 6 tháng; nhật ký hệ thống truy xuất ≥ 12 tháng; log làm chứng cứ phải bất biến (WORM, băm, ký số).
- Sự cố DLCN: thông báo ≤ 72 giờ. Chuyển xuyên biên giới / xử lý DLCN: hồ sơ đánh giá tác động.
- Kết quả đánh giá lưu tại: docs/data-protection-assessment.md
