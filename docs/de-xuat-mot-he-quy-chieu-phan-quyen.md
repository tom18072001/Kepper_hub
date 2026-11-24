# Đề xuất: đưa phân quyền Kepler Hub về MỘT hệ quy chiếu

> Trạng thái: **ĐÃ DUYỆT 24/11/2026** (chủ dự án duyệt khuyến nghị Q1–Q6, tên "Ban Tổng Giám đốc", "Người đứng tên dự án"). Giai đoạn 2 (sửa mã) trong PR nhánh `kepper/mot-he-quy-chieu-ma`; mục 11 ghi phần đã làm và phần chờ PR #40. Rà trên `main` 42cad4a (24/11/2026), có xem trước PR #39 (Tài liệu dự án, đã merge) và PR #40 (Báo cáo tuần).
> Bản sửa sau nghiệm thu vòng 1, có số liệu thật đo ngày 24/11. Tài liệu chỉ ghi số và mã tài khoản, không có tên người.

---

## 1. Tóm tắt một trang

**Vấn đề.** Câu hỏi "người này là ai trong công ty" hiện được trả lời theo **nhiều cách khác nhau**, tuỳ màn hình:

| Câu hỏi | Cách 1 | Cách 2 | Cách 3 | Cách 4 |
|---|---|---|---|---|
| Có phải **Ban Tổng Giám đốc** không? | vai tài khoản = "Ban giám đốc" (`director`) — văn thư, tài liệu dự án, MTL, báo cáo tuần, nhân sự, đối tác | có quyền "toàn tổ chức" — xem mọi việc, KPI, người duyệt cấp Ban GĐ | ô đánh dấu **"Ban Giám đốc toàn quyền"** — sửa kế hoạch, duyệt gia hạn mọi việc | là **"PGĐ phụ trách"** của bộ phận — chỉ đạo việc của bộ phận đó |
| Có phải **lãnh đạo bộ phận** không? | có quyền "Duyệt công việc" phạm vi phòng — trên một việc, hàng chờ duyệt | có quyền "Xem tổng hợp giao việc" — báo cáo tuần, nhân sự, đối tác, văn thư | vai "Trưởng phòng" / "Phó phòng" — cây tổ chức, chọn người giao | |

Từ đó mới sinh ra cặp "Ban Giám đốc" và "Ban Giám đốc toàn quyền". Các cách không ăn khớp nhau, và điều này **đang gây lộ quyền trên bản thật** (mục 3, điểm 1).

**Đề xuất.** Chỉ còn **một trục vai** để trả lời "người này là ai trong công ty":

> **Ban Tổng Giám đốc (BTGĐ) · Lãnh đạo bộ phận · Nhân viên · Quản trị hệ thống**

Thành viên BTGĐ có thêm **phạm vi phụ trách**: "Toàn công ty" hoặc "các bộ phận được chọn". Đây là một thuộc tính của vai, không phải vai mới.

Bên cạnh trục vai, người dùng còn có **quan hệ với từng việc / dự án** (người giao, người chủ trì…) và **kiêm nhiệm** do BTGĐ giao (thư ký giao ban, PMO…). Hai thứ này **không phải vai**; mục 2 giải thích vì sao.

Quyền của một người = vai + quan hệ với việc / dự án + kiêm nhiệm. Không còn nguồn nào khác. Bảng "Phân quyền" chỉnh từng ô cho từng người bỏ đi; quyền suy hoàn toàn từ vai.

**Ảnh hưởng thật** (production, 24/11; chi tiết ở mục 7, 9):
- Chỉ **1 tài khoản** bị ảnh hưởng về quyền. Đó là tài khoản PMO (`user#6`) đang mang vai Ban giám đốc (câu Q1).
- Các thay đổi Q2, Q3, Q4 và "Người xem chỉ xem" hiện **không ảnh hưởng ai**.
- Dữ liệu còn nhỏ (13 tài khoản), nên làm bây giờ là ít rủi ro nhất.

**Cần chủ dự án quyết 6 câu** (mục 8). Sửa mã chỉ bắt đầu sau khi chủ dự án duyệt và PR #40 merge.

---

## 2. Vì sao đây là MỘT hệ quy chiếu

Chủ dự án nêu năm khái niệm đang bị đặt ngang hàng nhau. Sau khi đổi, chúng nằm như sau:

| Khái niệm chủ dự án nêu | Sau khi đổi |
|---|---|
| Ban Tổng Giám đốc | **Vai** (trên trục vai) |
| Ban Tổng Giám đốc toàn quyền | **Không còn là khái niệm riêng.** Chỉ là phạm vi phụ trách "Toàn công ty" của một thành viên BTGĐ |
| Trưởng bộ phận | **Vai** Lãnh đạo bộ phận. "Trưởng phòng", "Trưởng ban", "Phó phòng"… chỉ là chức danh |
| Nhân viên | **Vai** |
| Người giao | **Không phải vai.** Chỉ là quan hệ của một người với **một việc**. Cùng loại với "người chủ trì", "người phối hợp" |

Như vậy chỉ có **MỘT trục** trả lời "là ai trong công ty", gồm 4 vai. Mỗi tài khoản có đúng một vai.

Hai thứ còn lại **không phải trục thứ hai hay thứ ba**:
- **Quan hệ với việc / dự án** trả lời "liên quan gì tới việc này". Một người có vai Nhân viên có thể là người giao của việc này, người chủ trì của việc kia. Vai của người đó không đổi.
- **Kiêm nhiệm** là nhiệm vụ cụ thể BTGĐ giao thêm trong một mảng (ví dụ PMO, thư ký giao ban). Nó không đổi vai, chỉ mở thêm đúng chức năng của mảng đó.

Quy tắc dùng từ: chỉ chữ **"vai"** mới nói về "là ai trong công ty". Không gọi người giao, chủ dự án hay PMO là "vai".

---

## 3. Bức tranh hiện tại: mọi khái niệm phân quyền đang có

### 3.1 Vai tài khoản (`User.role`) và các cờ

| Khái niệm | Giá trị / tên hiển thị | Nơi định nghĩa | Ghi chú |
|---|---|---|---|
| Vai tài khoản | `admin` Quản trị hệ thống · `director` Ban giám đốc · `manager` Trưởng phòng · `deputy` Phó phòng · `member` Nhân viên | `app/server/prisma/schema.prisma` (User.role), `lib/permissions.js` ROLES, `web/js/util.js` ROLE_LABEL | Trên giao diện Quản trị gọi là **"Nhóm tài khoản"** / cột **"Nhóm"** |
| Quản trị gốc | `User.isRootAdmin` | schema, `permissions.js` | Quản trị IT, không xem nội dung nghiệp vụ |
| Quản trị IT | `isItAdmin` = quản trị gốc hoặc vai `admin` | `permissions.js` | QĐ 16/10/2026: không có quyền nghiệp vụ |
| **Ban Giám đốc toàn quyền** | `User.boardAll` | schema, `routes/admin.js`, `services/task-access.js`, `services/approval.js` | Ban GĐ của **mọi** việc |
| **PGĐ phụ trách** | `Department.supervisorId` | schema, `routes/admin.js` (màn Phòng ban) | Ban GĐ của việc **do bộ phận đó chủ trì**. Phải là tài khoản vai `director` |

### 3.2 Bộ quyền chi tiết (`lib/permissions.js`)

- 14 quyền như `work.view`, `work.edit`, `work.approve`, `projects.manage`, `reports.*`, `admin.*`.
- Mỗi quyền có phạm vi `UNIT` (bộ phận mình) hoặc `SYSTEM` (toàn tổ chức).
- `ROLE_PROFILES` là bộ quyền mặc định của vai, **chỉ áp lúc tạo tài khoản**. Sau đó quyền được chỉnh từng ô ở màn **Phân quyền** (bảng `UserPermission`).
- Như vậy có **hai nguồn sự thật song song**: tên vai và bộ quyền thật.
- `manager` và `deputy` có bộ quyền giống hệt nhau.

### 3.3 Chính sách dữ liệu (`lib/policy.js`)

- `DATASETS`: 21 tập dữ liệu có nhãn. Hành động: `view`, `edit`, `export`, `ai`, `external`.
- Các danh sách chặn: `NEVER_AI` (rỗng), `NEVER_EXTERNAL` (13 tập), `NEVER_AI_FIELDS` (CCCD, lương).
- "Chủ thể" của chính sách dựng ở `services/weekly-data.js rolesOf()`, với hai cờ quan trọng:
  - `director` = **chuỗi vai** `director` (không xét bộ quyền);
  - `leader` = có quyền "Xem tổng hợp giao việc".

### 3.4 Quyền theo đối tượng

**Dự án** (`services/access.js`):
- Thành viên `OWNER` "Chủ dự án" / `MEMBER` "Thành viên" / `VIEWER` "Người xem".
- `Project.leadId` "Trưởng dự án".
- Chế độ hiển thị: "Cả phòng ban" / "Chỉ thành viên" / "Toàn công ty" / "Sổ giao việc".

**Một việc** (`services/task-access.js`, chốt 20/11/2026) có 7 vai A / B / L / S / D / O / U:
- **B** = Ban GĐ toàn quyền + PGĐ phụ trách bộ phận chủ trì;
- **O** gồm cả "tài khoản vai director không thuộc B".

**Người duyệt** (`services/approval.js`, `task-rules.js`) có 7 loại cấp duyệt. Trong đó "Ban giám đốc", "Người giao / PGĐ phụ trách" và "Ban Giám đốc của việc" chồng lấn nhau.

**Uỷ quyền** (`Delegation`): người được uỷ quyền xem và duyệt thay trong thời hạn.

### 3.5 Danh sách cấu hình riêng từng mảng (kiêm nhiệm)

| Kiêm nhiệm | Nơi cấu hình | Cách xác định |
|---|---|---|
| Thư ký giao ban | Thiết lập giao ban (`weekly-data.js`) | **Cả một bộ phận** |
| PMO | Thiết lập giao ban | Danh sách người. Tài khoản vai `director` **không** được tính là PMO |
| Phụ trách nhân sự | Thiết lập HRM (`hrm.js`) | Danh sách người |
| Văn thư, Pháp chế | Thiết lập Văn thư (`vanthu.js`) | Danh sách người |

### 3.6 Giao diện quản trị (`web/js/views/admin.js`, `routes/admin.js`)

- **Tài khoản**: cột "Nhóm" (= vai), cột "Phòng ban", nhãn "BGĐ toàn quyền".
- **Phân quyền**: bảng có cột **"Nhóm"**, nhưng ở đây là nhóm quyền (Công việc / Dự án…), **không phải vai**. Có ô "Ban Giám đốc toàn quyền".
- **Phòng ban**: cột "PGĐ phụ trách".

### 3.7 Các chỗ so thẳng chuỗi vai hoặc tự suy "Ban GĐ" / "lãnh đạo"

| Cách suy | Nơi dùng (`app/server/src`, không tính test) |
|---|---|
| `role === 'director'` | `weekly-data.js`, `hrm.js`, `routes/hrm.js`, `vanthu.js` (qua subject), `routes/vanthu.js`, `mtl-guard.js`, `routes/reports.js` (xuất MTL), `routes/projects.js` (tạo dự án MTL), `task-access.js` (vai O), `routes/admin.js`, `routes/profile.js`, `routes/approvals.js`, `workitems.js`, `lib/project-docs.js` (PR #39) |
| quyền phạm vi `SYSTEM` | `access.js` (xem mọi việc), `routes/kpi.js` + `routes/analytics.js` (KPI), `approval.js` (người duyệt cấp Ban GĐ) |
| `boardAll` | `task-access.js`, `approval.js`, `task-rules.js`, `routes/approvals.js` |
| `work.approve` phạm vi phòng | `access.js isDeptLeader`, `task-access.js`, `routes/approvals.js`, `routes/dashboard.js` |
| `work.approve` mọi phạm vi | `approval.js` (cấp "Trưởng phòng") |
| `reports.summary` | `weekly-data.js`, `hrm.js isLeader`, CRM, Văn thư |
| tên `manager` / `deputy` | `routes/profile.js`, `workitems.js` |

---

## 4. Các chỗ mâu thuẫn, trùng lặp, gây rối

1. **Hai hệ quy chiếu cho "Ban Tổng Giám đốc" đang gây lộ quyền trên bản thật.**
   - Tài khoản PMO `user#6` mang vai `director`, nhưng bộ quyền đã bị **thu hẹp** về mức nhân viên: xem / sửa / dashboard chỉ trong bộ phận; không có quyền toàn tổ chức, quản lý dự án, KPI, tổng hợp, xuất.
   - Những chỗ đọc **bộ quyền** chặn đúng. Nhờ vậy tài khoản này **không** xem được KPI & phân tích và **không** xem mọi dự án qua danh sách công việc.
   - Nhưng những chỗ so **chuỗi vai** `role === 'director'` bỏ qua phần thu hẹp đó, nên tài khoản vẫn được:
     - **Văn thư**: xem văn bản **mọi mức mật**, kể cả Hạn chế và Bảo mật cao; vào sổ, sửa, huỷ, đổi trạng thái. Mảng này **đang bật trên production**.
     - **Tài liệu dự án**: xem **mọi dự án, kể cả thư mục NAS** (`lib/project-docs.js canViewDocs`, đã deploy 24/11).
     - **MTL**: các chức năng dành cho Ban GĐ (`mtl-guard.js`, tạo dự án MTL, xuất MTL).
     - **Báo cáo tuần**: được coi là Ban GĐ. Không phải lập báo cáo; xem bản đầy đủ; kết luận giao ban; chọn thư ký và PMO.
     - **Trên một việc**: vai O, tức xem đầy đủ và bình luận mọi việc nó thấy.
     - **Nhân sự, Đối tác**: xem hồ sơ, hợp đồng, đối tác mọi bộ phận. Hiện **tắt** trên production, nhưng sẽ lộ ngay khi bật.

   Đây là bằng chứng cụ thể của "hai hệ quy chiếu". Cùng một người bị coi là Ban GĐ ở màn này, là nhân viên ở màn khác. Đây cũng là lý do nên làm Q1 sớm.
2. **Ba định nghĩa "lãnh đạo bộ phận"**: theo `work.approve` phạm vi phòng, `work.approve` mọi phạm vi, và `reports.summary`. Ai được chỉnh quyền riêng có thể là lãnh đạo ở màn này mà không là lãnh đạo ở màn khác.
3. **Tên vai và quyền thật tách rời.** Nhìn vai không biết người đó làm được gì. Ví dụ ở điểm 1: vai ghi "Ban giám đốc", quyền thật là của nhân viên.
4. **"Trưởng phòng" và "Phó phòng" là hai vai có quyền y hệt nhau.**
5. **Ba loại cấp duyệt Ban GĐ chồng lấn.** Cấp "Người giao / PGĐ phụ trách" còn trộn quan hệ với việc (người giao) với vai tổ chức (PGĐ).
6. **"Trưởng dự án" và "Chủ dự án"** là cặp từ gần nghĩa ở cấp dự án.
7. **"Người xem" (VIEWER) của dự án không thật sự chỉ xem.** Họ vẫn sửa được nếu cùng bộ phận, ở sổ giao việc, hoặc là Ban GĐ.
8. **Chính sách KPI lệch quyết định.** `policy.js` còn cho lãnh đạo bộ phận xem KPI người trong bộ phận. Route thật thì chỉ cho Ban GĐ.
9. **Từ ngữ:**
   - "Nhóm" dùng cho cả vai lẫn nhóm quyền, trên cùng một màn hình.
   - "Ban" vừa là Ban Giám đốc, vừa là tên đơn vị (Ban Tổng Giám đốc, Ban Đầu tư…), vừa nằm trong "phòng ban".
   - Đơn vị có 4 tên: phòng ban, phòng, bộ phận, đơn vị.
   - Lãnh đạo có 4 tên: trưởng phòng, lãnh đạo phòng, lãnh đạo bộ phận, trưởng bộ phận.
   - Mã nguồn và giao diện viết "Ban giám đốc / PGĐ", còn công ty dùng "**Ban Tổng Giám đốc / Phó Tổng Giám đốc**".
10. **Thư ký giao ban chọn theo bộ phận**, các kiêm nhiệm khác chọn theo người (Q5).
11. **Tài liệu `docs/`** dùng lẫn các từ trên: `data-protection-assessment.md`, `huong-dan-su-dung/lanh-dao.md`, `PLAN-kepper.md`.

---

## 5. Đề xuất: một hệ quy chiếu duy nhất

### 5.1 Nguyên tắc

1. **Vai quyết định quyền chung.** Không còn chỉnh quyền từng ô cho từng người. Ngoại lệ thật sự cần thì giao **kiêm nhiệm** hoặc **quan hệ với dự án**.
2. **Mỗi câu hỏi chỉ hỏi một chỗ.** Trong mã có đúng một hàm cho mỗi câu hỏi, đặt ở `lib/permissions.js`:
   - `isBoard(user)`: có phải BTGĐ;
   - `boardScope(user)`: BTGĐ phụ trách toàn công ty hay những bộ phận nào;
   - `isDeptLeader(user)`: có phải lãnh đạo bộ phận;
   - `isItAdmin(user)`: có phải quản trị hệ thống.

   Mọi nơi khác gọi các hàm này. Có test quét mã cấm so chuỗi vai ngoài `permissions.js`.
3. **Quan hệ với việc không phải vai.** BTGĐ và lãnh đạo bộ phận có quyền trên một việc **qua vai của họ**, không qua loại cấp duyệt riêng.
4. **Vai BTGĐ trùng đúng thành viên bộ phận Ban Tổng Giám đốc (mã BTGD).** Sau Q1, trên production đúng 3 tài khoản vai BTGĐ, cả 3 thuộc bộ phận BTGD, và bộ phận này không có ai khác. Để giữ quy tắc này, khi quản trị gán vai BTGĐ cho người ngoài bộ phận BTGD, hoặc chuyển người vào / ra bộ phận BTGD mà vai không khớp, hệ thống **hiện cảnh báo** và yêu cầu xác nhận. Đây là cảnh báo, không chặn cứng, phòng khi cơ cấu thay đổi. Thao tác ghi nhật ký và thông báo BTGĐ như hiện nay.
5. Giữ nguyên các quyết định nghiệp vụ đã chốt. Chỗ nào buộc phải đổi đều ghi ở mục 7 và 8.

### 5.2 Bảng thuật ngữ thống nhất (một từ cho một khái niệm)

| Dùng từ | Nghĩa | KHÔNG dùng nữa |
|---|---|---|
| **Vai** | Câu trả lời duy nhất cho "là ai trong công ty": 4 vai | "Nhóm", "Nhóm tài khoản", "vai trò hệ thống"; gọi người giao, chủ dự án, PMO là "vai" |
| **Bộ phận** | Một đơn vị trong cơ cấu. Dùng từ chung vì công ty đặt tên đơn vị là cả "Ban …" (Ban Tổng Giám đốc, Ban Đầu tư, Ban Tài chính – Kế toán…), cả "Phòng …" (Phòng Tổng hợp…), cả tên không tiền tố (Hành chính – Nhân sự…). Tên riêng của từng đơn vị giữ nguyên | "Phòng ban", "phòng", "đơn vị" khi nói chung |
| **Ban Tổng Giám đốc (BTGĐ)** | Vai của Tổng Giám đốc và các Phó Tổng Giám đốc | "Ban giám đốc", "Ban GĐ", "BGĐ", "Ban Giám đốc toàn quyền" |
| **Tổng Giám đốc**, **Phó Tổng Giám đốc** | Chức danh trong vai BTGĐ | "Giám đốc", "PGĐ" |
| **Phạm vi phụ trách** | Phần việc một thành viên BTGĐ chỉ đạo: **Toàn công ty** hoặc **các bộ phận được chọn** | "toàn quyền" |
| **Phó Tổng Giám đốc phụ trách** (bộ phận X) | Thành viên BTGĐ có bộ phận X trong phạm vi phụ trách | "PGĐ phụ trách" |
| **BTGĐ phụ trách** (của một việc) | Thành viên BTGĐ có phạm vi gồm bộ phận chủ trì việc đó, hoặc phụ trách Toàn công ty | "Ban Giám đốc của việc", "B" |
| **Lãnh đạo bộ phận** | Vai của trưởng / phó bộ phận. "Trưởng phòng", "Trưởng ban", "Phó phòng"… chỉ là **chức danh** | "Trưởng phòng", "Phó phòng" khi dùng làm vai; "trưởng bộ phận", "lãnh đạo phòng" |
| **Nhân viên** | Vai của mọi người còn lại | |
| **Quản trị hệ thống** | Vai IT, không xem nội dung nghiệp vụ. "Quản trị gốc" là tài khoản quản trị đầu tiên | |
| **Người giao / Người chủ trì / Người phối hợp** | Quan hệ với **một việc** | |
| **Chủ dự án / Thành viên / Người xem** | Quan hệ với **một dự án**. Người xem chỉ xem | "Trưởng dự án" |
| **Người đứng tên dự án** | Một Chủ dự án được ghi tên trên dự án (`Project.leadId`). Dùng cho cấp duyệt và hiển thị; luôn là Chủ dự án | "Trưởng dự án", "Chủ dự án chính" |
| **Kiêm nhiệm** | Nhiệm vụ BTGĐ giao thêm: Thư ký giao ban, PMO, Phụ trách nhân sự, Văn thư, Pháp chế | "vai trò giao ban" |
| **Mảng** | Nhóm chức năng trên màn quản trị (Công việc, Dự án, Báo cáo, Quản trị) | "Nhóm" (cột bảng quyền) |

### 5.3 Bảng ánh xạ cũ → mới

| Cũ | Mới | Dữ liệu |
|---|---|---|
| vai `director` "Ban giám đốc" | **Ban Tổng Giám đốc** | giữ giá trị `director` |
| ô "Ban Giám đốc toàn quyền" (`boardAll`) | BTGĐ, phạm vi phụ trách = **Toàn công ty** | giữ cột `boardAll`, đổi cách hiện và cách nhập |
| "PGĐ phụ trách" của bộ phận (`Department.supervisorId`) | BTGĐ, phạm vi phụ trách = **các bộ phận đó** | giữ cột, nhập từ một chỗ (5.6). Với người phụ trách Toàn công ty, danh sách bộ phận không đổi quyền gì, chỉ dùng để hiện cây tổ chức |
| vai `director` không phụ trách gì (`user#6`, PMO, thuộc Phòng Tổng hợp) | **Q1**: vai Nhân viên + kiêm nhiệm PMO (khuyến nghị). Khớp đúng bộ quyền đã thu hẹp hiện nay | sửa 1 tài khoản trên Quản trị, thêm vào danh sách PMO |
| vai `manager` "Trưởng phòng" | **Lãnh đạo bộ phận** | giữ `manager` |
| vai `deputy` "Phó phòng" | **Lãnh đạo bộ phận** | migration `deputy` → `manager` (production: 0 tài khoản) |
| vai `member` | **Nhân viên** | giữ |
| vai `admin`, `isRootAdmin` | **Quản trị hệ thống** (quản trị gốc) | giữ |
| Bộ quyền từng người (`UserPermission`, màn Phân quyền) | **Bỏ chỉnh tay**: quyền = bảng quyền của vai (5.4). Màn Phân quyền chỉ để xem | giữ bảng dữ liệu, mã không đọc nữa; xoá ở một bản sau |
| Vai trên việc A / B / L / S / D / O / U | Người giao · BTGĐ phụ trách · Người chủ trì · Người phối hợp · Lãnh đạo bộ phận chủ trì · Chủ dự án · Người khác | O bỏ điều kiện "vai director không thuộc B". BTGĐ xem đầy đủ mọi việc theo vai |
| Cấp duyệt `DIRECTOR`, `SUPERVISOR`, `BOARD` | gộp thành một cấp **BTGĐ phụ trách** (cùng người duyệt cho cấp dự án `DIRECTOR` và cấp ảo `BOARD` của việc mốc / găng) | migration đổi `SUPERVISOR` → `DIRECTOR` (production: 0 dòng) |
| Cấp duyệt "Trưởng phòng" (`DEPARTMENT_MANAGER`) | **Lãnh đạo bộ phận chủ trì** | đổi nhãn |
| Cấp duyệt "Trưởng dự án" (`PROJECT_LEAD`) | **Người đứng tên dự án** | đổi nhãn |
| Cấp duyệt "Người giao việc", "Người được chỉ định" | giữ | |
| Thành viên dự án `VIEWER` | **Người xem: chỉ xem** | sửa `access.js` (production: 0 dòng VIEWER) |
| Thư ký, PMO, Phụ trách nhân sự, Văn thư, Pháp chế | **Kiêm nhiệm**: cấu hình ở từng mảng như cũ, gom hiển thị ở hồ sơ tài khoản | không đổi dữ liệu |

Các tên quyền kỹ thuật (`work.view`, `reports.kpi`…) có thể giữ **bên trong mã** làm tên ô của ma trận. Nhưng chúng được suy từ vai, không lưu riêng cho từng người và không hiện như một khái niệm thứ hai.

### 5.4 Ma trận quyền: vai × chức năng chính

Ký hiệu: ✔ được · — không · *(chữ nghiêng)* điều kiện.
"Việc liên quan" = mình là người giao, người chủ trì, người phối hợp, hoặc lãnh đạo bộ phận chủ trì / phối hợp.

| Chức năng | Ban Tổng Giám đốc | Lãnh đạo bộ phận | Nhân viên | Quản trị hệ thống |
|---|---|---|---|---|
| **Xem dự án, việc** | ✔ toàn công ty, xem đầy đủ mọi việc | dự án của bộ phận, dự án dùng chung, dự án mình là thành viên; trên sổ giao việc: việc liên quan | như lãnh đạo bộ phận, trừ việc của bộ phận trên sổ giao việc mà mình không liên quan | — |
| **Tạo dự án** | ✔ mọi bộ phận, kể cả MTL | ✔ trong bộ phận mình (không phải MTL) | — | — |
| **Quản lý dự án** (thành viên, cột, quy trình duyệt, nhập MTL) | ✔ | *Chủ dự án*; dự án thường của bộ phận mình | *Chủ dự án* | — |
| **Kế hoạch của một việc** (tên, hạn, mốc, đường găng, người chủ trì…), xoá, lặp lại | *BTGĐ phụ trách* của việc | *Người giao* | *Người giao* | — |
| **Chọn người cho bước giao về bộ phận** | — | *Lãnh đạo bộ phận chủ trì* | — | — |
| **Cập nhật tiến độ, gửi duyệt, đề nghị gia hạn** | *Người chủ trì* | *Người chủ trì* | *Người chủ trì* | — |
| **Duyệt hoàn thành + chấm mức** | *Người giao*; việc mốc / đường găng: *BTGĐ phụ trách* | *Người giao*; *Lãnh đạo bộ phận chủ trì* khi người giao đã nghỉ | *Người giao* | — |
| **Duyệt gia hạn** | *BTGĐ phụ trách* | — | — | — |
| **Bình luận** | ✔ | *việc liên quan* | *việc liên quan* | — |
| **Báo cáo tuần: lập / gửi** | — (BTGĐ không lập) | ✔ bộ phận mình | ✔ bộ phận mình | — |
| **Bản tổng hợp giao ban: tóm tắt** | ✔ | ✔ | — | — |
| **Bản tổng hợp: đầy đủ** (chi tiết mọi bộ phận, dòng "hệ thống tự bổ sung") | ✔ | *kiêm nhiệm Thư ký / PMO* | *kiêm nhiệm Thư ký / PMO* | — |
| **Gửi tổng hợp qua email / Teams** | ✔ chỉ bản tóm tắt | *Thư ký*, chỉ bản tóm tắt | *Thư ký*, chỉ bản tóm tắt | — |
| **Email tổng hợp gửi các trưởng bộ phận** | việc thuộc dự án kín ("Chỉ thành viên" / "Sổ giao việc"): **chỉ đếm, không nêu tên**; việc thuộc dự án thường: nêu tên ở mục nguy cơ chậm; dòng "hệ thống tự bổ sung": chỉ đếm | ← cùng quy tắc | ← | — |
| **Kết luận giao ban, chọn Thư ký / PMO** | ✔ (Thư ký ghi điểm danh, Action Log) | — | — | — |
| **KPI & phân tích** (mọi người, mọi bộ phận) | ✔ | — | — | — |
| **KPI của chính mình** | ✔ | ✔ | ✔ | — |
| **Tài liệu dự án** (Hub + NAS) | ✔ mọi dự án | *thành viên dự án* | *thành viên dự án* | — |
| **Văn thư** | ✔ mọi mức mật | như nhân viên; thêm vào sổ dãy D7 của bộ phận, đổi bước xử lý văn bản của bộ phận | Công khai / Nội bộ; Hạn chế của bộ phận mình; văn bản mình xử lý. *Văn thư*: vào sổ. *Pháp chế*: văn bản được chuyển | — |
| **Nhân sự: hồ sơ, hợp đồng** *(đang tắt)* | ✔ xem; sửa hồ sơ của người Phụ trách nhân sự | trường cơ bản của người trong bộ phận | của mình; *Phụ trách nhân sự*: mọi người trừ chính mình | — |
| **Nhân sự: số CCCD** *(đang tắt)* | — | — | của mình; *Phụ trách nhân sự* | — |
| **Nghỉ phép, chấm công: duyệt** *(đang tắt)* | ✔ mọi đơn (đơn của lãnh đạo bộ phận do BTGĐ duyệt) | ✔ nhân viên bộ phận mình | *Phụ trách nhân sự* (ghi nhận) | — |
| **Đối tác (CRM)** *(đang tắt)* | ✔ mọi bộ phận | bộ phận mình, gồm giá trị hợp đồng | đối tác bộ phận mình (trừ giá trị hợp đồng), đối tác mình phụ trách | — |
| **Quản trị: tài khoản, bộ phận, nhãn, nhật ký hệ thống** | — | — | — | ✔ |
| **Gán vai, phạm vi phụ trách của BTGĐ** | — | — | — | ✔ (BTGĐ được thông báo; cảnh báo nếu vai BTGĐ lệch bộ phận BTGD) |

Đối chiếu các quyết định đã chốt:

| Quyết định | Trong ma trận |
|---|---|
| KPI & phân tích chỉ Ban TGĐ | chỉ cột BTGĐ. Sửa `policy.js` cho khớp |
| Tài liệu dự án: thành viên dự án + Ban TGĐ | "Ban TGĐ" = vai BTGĐ. Sau Q1, tài khoản PMO không còn lọt vào |
| Quản trị IT không xem nội dung nghiệp vụ | cột Quản trị hệ thống chỉ có dòng Quản trị |
| Báo cáo tuần: email chỉ bản tóm tắt; "hệ thống tự bổ sung" chỉ ở bản đầy đủ (trong email chỉ đếm); email không nêu tên việc thuộc dự án kín | dòng "Bản tổng hợp", "Gửi tổng hợp", "Email tổng hợp" (thực thi trong PR #40) |
| Quyền tối thiểu trên một việc (20/11/2026) | giữ nguyên bảng; chỉ đổi tên (B → BTGĐ phụ trách) và bỏ ngoại lệ "director không thuộc B" ở O |

### 5.5 Kiêm nhiệm: cố ý giữ ít và rõ

| Kiêm nhiệm | Ai chỉ định | Thêm được gì |
|---|---|---|
| Thư ký giao ban | BTGĐ (chọn **bộ phận** thư ký) | Bản tổng hợp đầy đủ, nộp thay bộ phận khác, điểm danh, Action Log, gửi bản tóm tắt ra ngoài |
| PMO | BTGĐ (chọn người) | Bản tổng hợp đầy đủ |
| Phụ trách nhân sự | BTGĐ | Hồ sơ, hợp đồng, CCCD, chấm công (trừ của chính mình) |
| Văn thư | BTGĐ | Vào sổ, sửa, huỷ văn bản; xem văn bản Hạn chế |
| Pháp chế | BTGĐ | Xem văn bản Hạn chế được chuyển cho Pháp chế |

Hồ sơ tài khoản hiện thêm dòng "Kiêm nhiệm: …", chỉ để xem.

### 5.6 Giao diện quản trị sau khi đổi

- **Tài khoản**: các cột **Vai**, **Bộ phận**, **Phụ trách** (chỉ với BTGĐ: "Toàn công ty" hoặc tên các bộ phận), **Kiêm nhiệm**. Ô chọn "Vai" có 4 lựa chọn. Có cảnh báo khi vai BTGĐ lệch bộ phận BTGD.
- **Phạm vi phụ trách** nhập ở **một chỗ**: khi sửa tài khoản BTGĐ. Màn Bộ phận chỉ hiện "Phó Tổng Giám đốc phụ trách".
- **Phân quyền**: bỏ ô tick từng quyền và ô "Ban Giám đốc toàn quyền". Thay bằng **bảng quyền của vai, chỉ đọc** (bảng 5.4).

---

## 6. Thay đổi mã, dữ liệu, giao diện, tài liệu (giai đoạn 2)

Chỉ làm sau khi chủ dự án duyệt và PR #40 merge (#39 đã merge). Làm trên nhánh mới từ `main` mới nhất, kết thúc bằng 1 PR.

| Hạng mục | Nội dung | Tệp chính |
|---|---|---|
| Hàm vai duy nhất | `isBoard`, `boardScope`, `isDeptLeader`, `isItAdmin`; `permissionScope()` đọc bảng quyền theo vai | `lib/permissions.js` |
| Thay mọi chỗ tự suy | khoảng 40 chỗ ở 3.7 chuyển sang gọi hàm vai | `weekly-data.js`, `hrm.js`, `vanthu.js`, `crm.js`, `mtl-guard.js`, `reports.js`, `projects.js`, `workitems.js`, `profile.js`, `approvals.js`, `approval.js`, `task-access.js`, `access.js`, `dashboard.js`, `kpi.js`, `analytics.js`, `project-docs.js`, `admin.js` |
| Chính sách dữ liệu | subject dựng từ hàm vai; sửa `kpi.person` cho đúng "chỉ BTGĐ" | `lib/policy.js` |
| Vai trên việc | O bỏ `role === 'director'` | `task-access.js` |
| Người xem dự án | chỉ xem | `access.js` |
| Cấp duyệt | còn 5 loại: Người giao · BTGĐ phụ trách · Lãnh đạo bộ phận chủ trì · Người đứng tên dự án · Người được chỉ định | `approval.js`, `task-rules.js`, `util.js`, màn quy trình duyệt |
| Cảnh báo vai BTGĐ / bộ phận BTGD | khi tạo / sửa tài khoản và khi đổi bộ phận | `routes/admin.js`, `views/admin.js` |
| Migration | `deputy` → `manager`; `approverType` `SUPERVISOR` → `DIRECTOR`; không xoá `UserPermission`. Trên production cả hai migration đổi 0 dòng | `prisma/migrations/…` |
| Giao diện | đổi từ ngữ theo 5.2; màn Tài khoản / Phân quyền / Bộ phận theo 5.6 | `web/js/util.js`, `views/admin.js`, `settings.js`, `dispatch-panel.js`, `weekly.js`, `hrm.js`, `crm.js`, `vanthu.js`, `shell.js` |
| Test chốt ma trận | **test mới**: mỗi vai (+ kiêm nhiệm chính) × mỗi endpoint quan trọng → được / bị chặn, so với bảng 5.4; có ca "vai BTGĐ nhưng bộ quyền cũ thu hẹp" để chứng minh hết lệch. Test quét mã cấm `role === '…'` ngoài `permissions.js`. Sửa các test cũ và e2e đổi nhãn | `lib/role-matrix.test.js` (mới), `app/e2e/*` |
| Tài liệu | `data-protection-assessment.md`, `huong-dan-su-dung/*`, `PLAN-kepper.md` | `docs/` |

**Ước lượng:** khoảng 3–4 ngày làm của một phiên agent, cộng một vòng nghiệm thu.

**Rủi ro và cách giảm:**

| Rủi ro | Cách giảm |
|---|---|
| Mất hoặc thêm quyền ngoài ý muốn khi bỏ bộ quyền từng người | Đã đo: chỉ `user#1` (quản trị gốc, không ảnh hưởng) và `user#6` lệch vai. Test ma trận chốt từng ô |
| **Làm Q2 mà không làm Q1 sẽ MỞ RỘNG quyền của `user#6`** (quyền theo vai `director` = toàn công ty) | Q1 và Q2 phải làm cùng một lần phát hành. Nếu Q1 chọn giữ vai BTGĐ thì phải quyết lại Q2 |
| Đổi chữ "Phòng ban" → "Bộ phận" | đổi một lần, có ghi chú phát hành, sửa tài liệu hướng dẫn cùng lúc |
| Luồng cấp quyền thay đổi (CLAUDE.md yêu cầu chủ dự án đồng ý) | ghi rõ ở Q2. Tiêu chí đăng nhập / mật khẩu **không** đổi |

---

## 7. Ai mất, ai được thêm quyền (production 24/11)

13 tài khoản đang hoạt động: 4 vai `director`, 3 `manager`, 0 `deputy`, 5 `member`, 1 `admin`.

| Tài khoản | Hiện nay | Sau khi đổi |
|---|---|---|
| `user#2` (bộ phận BTGD) | `director`, Ban GĐ toàn quyền, không phụ trách bộ phận nào | BTGĐ, phụ trách **Toàn công ty**. **Không đổi quyền** |
| `user#3` (bộ phận BTGD) | `director`, PGĐ phụ trách 4 bộ phận | BTGĐ, phụ trách **4 bộ phận đó**. **Không đổi quyền** |
| `user#4` (bộ phận BTGD) | `director`, Ban GĐ toàn quyền + PGĐ phụ trách 4 bộ phận | BTGĐ, phụ trách **Toàn công ty** (4 bộ phận vẫn hiện trên cây tổ chức). **Không đổi quyền** |
| **`user#6`** (Phòng Tổng hợp, PMO) | vai `director`, nhưng bộ quyền đã thu hẹp về mức nhân viên | **Q1 (khuyến nghị): Nhân viên + kiêm nhiệm PMO.** Quyền theo bộ quyền **giữ nguyên** (vốn đã là mức nhân viên). Chỉ **mất** những gì đang lọt qua chuỗi vai (mục 4, điểm 1): văn thư mọi mức mật, tài liệu dự án mọi dự án / NAS, chức năng Ban GĐ ở MTL và báo cáo tuần, vai O trên mọi việc. **Giữ / có**: bản tổng hợp giao ban đầy đủ (qua PMO), Chủ dự án ở dự án mình được giao, người giao của các việc đã giao. **Phải** tham gia lập báo cáo tuần của Phòng Tổng hợp |
| 3 tài khoản `manager` | Trưởng phòng | Lãnh đạo bộ phận. **Không đổi quyền** |
| 5 tài khoản `member` | Nhân viên | **Không đổi** |
| `user#1` (quản trị gốc) và 1 tài khoản `admin` | bộ quyền của `user#1` thiếu `admin.*`, nhưng cờ quản trị gốc đã đủ | **Không đổi** |

Theo từng câu hỏi:

| Thay đổi | Số tài khoản / dữ liệu bị ảnh hưởng |
|---|---|
| Q1 — vai của tài khoản PMO | **1** (`user#6`) |
| Q2 — bỏ quyền từng người | **0** nếu làm cùng Q1 (`user#1` là quản trị gốc; `user#6` đã xử lý ở Q1) |
| Q3 — gộp Phó phòng | **0** (không có tài khoản `deputy`) |
| Q4 — gộp cấp duyệt Ban GĐ | **0** (0 quy trình duyệt, 0 phiếu) |
| Người xem chỉ xem | **0** (0 thành viên vai Người xem) |
| Q6 — đổi chữ | không đổi quyền |

Không ai **được thêm** quyền nghiệp vụ.

---

## 8. Câu hỏi chủ dự án cần quyết

| # | Câu hỏi | Khuyến nghị |
|---|---|---|
| **Q1** | Tài khoản PMO (`user#6`, Phòng Tổng hợp) đang mang vai Ban giám đốc: đổi sang Nhân viên + kiêm nhiệm PMO? | **Đổi.** Vai BTGĐ khi đó trùng đúng 3 thành viên bộ phận BTGD, từ "toàn quyền" biến mất, và chặn được các lỗ ở mục 4, điểm 1. Nên làm sớm |
| **Q2** | Bỏ chỉnh quyền từng người, để quyền hoàn toàn theo vai? (đổi luồng cấp quyền, cần chủ dự án đồng ý theo CLAUDE.md) | **Đồng ý**, làm cùng Q1 |
| **Q3** | Gộp "Trưởng phòng" và "Phó phòng" thành vai "Lãnh đạo bộ phận"? | **Gộp** (hiện không có Phó phòng nào) |
| **Q4** | Gộp ba cấp duyệt Ban GĐ thành một cấp "BTGĐ phụ trách"? | **Gộp** (chưa có quy trình duyệt nào dùng) |
| **Q5** | Thư ký giao ban vẫn chọn theo **bộ phận**? | **Giữ theo bộ phận**, đúng quy chế giao ban |
| **Q6** | Dùng từ chung "Bộ phận" thay "Phòng ban"; "Ban Tổng Giám đốc / Phó Tổng Giám đốc" thay "Ban giám đốc / PGĐ"? | **Đổi**: khớp từ ngữ công ty, một từ cho một khái niệm |

---

## 9. Kiểm tra trên bản thật (chỉ đọc)

Đã chạy ngày 24/11 bởi phiên nghiệm thu. Kết quả chỉ ghi số và mã tài khoản. Tên người **không** đưa vào git.

| Kiểm tra | Kết quả |
|---|---|
| 8.1 Vai, toàn quyền, bộ phận phụ trách | 13 tài khoản hoạt động: 4 `director`, 3 `manager`, 0 `deputy`, 5 `member`, 1 `admin`. `user#2`: toàn quyền, 0 bộ phận; `user#3`: 4 bộ phận; `user#4`: toàn quyền + 4 bộ phận (ba người này thuộc bộ phận BTGD); `user#6`: không toàn quyền, 0 bộ phận, thuộc Phòng Tổng hợp |
| 8.2 Bộ quyền khác vai | 2 tài khoản: `user#1` (quản trị gốc) thiếu `admin.*`, không ảnh hưởng; `user#6` thu hẹp: `work.view` / `work.edit` / `reports.dashboard` chỉ phạm vi bộ phận; thiếu `work.*` toàn tổ chức, `projects.manage`, `reports.kpi` / `summary` / `export` |
| 8.3 Quy trình duyệt | `ApprovalStep`: 0 dòng; `ApprovalRequest`: 0 phiếu |
| 8.4 Thành viên dự án, Phó phòng | `ProjectMember`: MEMBER 7, OWNER 1, VIEWER 0; `deputy`: 0 |
| Mảng đang bật | chỉ `MODULES=vanthu`; HRM và CRM đang tắt |
| Danh mục bộ phận | tên đơn vị có cả "Ban …" (gồm Ban Tổng Giám đốc — mã BTGD), "Phòng …" và tên không tiền tố. Đây là lý do dùng từ chung "Bộ phận" |

Trước khi phát hành giai đoạn 2, chạy lại các truy vấn này để chắc số liệu chưa đổi:

```sql
SELECT u.id, u.role, u."boardAll", u."departmentId", COUNT(d.id) AS so_bo_phan_phu_trach
FROM "User" u LEFT JOIN "Department" d ON d."supervisorId" = u.id
WHERE u."isActive" GROUP BY u.id ORDER BY u.role;
SELECT "approverType", COUNT(*) FROM "ApprovalStep" GROUP BY 1;
SELECT COUNT(*) FROM "ApprovalRequest" WHERE status = 'PENDING';
SELECT role, COUNT(*) FROM "ProjectMember" GROUP BY 1;
-- Bộ quyền khác vai: script node so UserPermission với ROLE_PROFILES (lib/permissions.js).
```

---

## 10. Đánh giá bảo vệ dữ liệu (Data Protection Gate, tóm tắt)

| Lớp | Ảnh hưởng của đề xuất |
|---|---|
| GOV (quản trị) | Một nguồn quyền duy nhất, ma trận công khai trong hệ thống, test chốt từng ô |
| PRE (phòng ngừa) | Đóng lỗ "vai và bộ quyền lệch nhau" (mục 4, điểm 1). Tài khoản PMO thôi xem văn bản Hạn chế / Bảo mật cao và tài liệu mọi dự án: **tối thiểu hoá dữ liệu** (Nghị định 13/2023, Luật BVDLCN). Chặn trước rủi ro lộ hồ sơ nhân sự khi bật HRM |
| DET (phát hiện) | Đổi vai, phạm vi phụ trách, kiêm nhiệm đều ghi nhật ký và báo BTGĐ. Thêm cảnh báo vai BTGĐ lệch bộ phận BTGD. Giữ nhật ký ≥ 12 tháng |
| PRI (riêng tư) | Không thêm tập dữ liệu, không đổi nhãn. KPI cá nhân vẫn chỉ BTGĐ |
| RES (ứng phó) | Migration không xoá dữ liệu, có thể quay lại bản cũ. Việc tài khoản PMO đã xem được văn bản mật trước đây là **quyền cấp sai, không phải sự cố rò rỉ ra ngoài**. Nên rà nhật ký truy cập văn thư / tài liệu dự án của tài khoản này để xác nhận |

Ở giai đoạn 2, cập nhật mục "Quy định phân quyền" trong `docs/data-protection-assessment.md` theo bảng 5.4. Không có chuyển dữ liệu xuyên biên giới mới.

---

## 11. Giai đoạn 2 — đã làm (PR nhánh `kepper/mot-he-quy-chieu-ma`)

| Hạng mục | Đã làm |
|---|---|
| Một nguồn vai | `lib/permissions.js`: `isBoard`, `isDeptLeader`, `isItAdmin`, `roleOf`, `roleRank`, `rolesWith`, `BOARD_WHERE` / `LEADER_WHERE` / `NOT_IT_WHERE` / `IT_WHERE`, `boardDeptMismatch`. `permissionScope()` đọc bảng quyền **theo vai** (bảng `UserPermission` giữ nguyên, không đọc) |
| Bỏ chỉnh quyền từng người (Q2) | `PUT /api/admin/users/:id/permissions` → 410 `PERMISSIONS_BY_ROLE`; màn "Quyền" chỉ xem; tạo tài khoản không ghi bộ quyền; đổi vai ghi nhật ký số quyền thêm / bớt |
| Phạm vi phụ trách | `PUT /api/admin/users/:id/scope { all, departmentIds }` — chỉ tài khoản vai BTGĐ; màn Bộ phận chỉ hiện (chọn Phó TGĐ ở bộ phận → 422 `SUPERVISOR_VIA_USER`); rời vai BTGĐ thì tự bỏ phạm vi |
| Cảnh báo vai / bộ phận BTGĐ | tạo / sửa tài khoản lệch → 422 `BOARD_DEPT_MISMATCH` trừ khi xác nhận; danh sách tài khoản hiện "Lệch bộ phận BTGĐ"; mã bộ phận BTGĐ: `BTGD` (dữ liệu giả: `BGD`) |
| Gộp vai, cấp duyệt (Q3, Q4) | migration `20261125090000_mot_truc_vai`: `deputy` → `manager`; cấp duyệt `SUPERVISOR` → `DIRECTOR` ("BTGĐ phụ trách" = phụ trách Toàn công ty + Phó TGĐ phụ trách bộ phận chủ trì; chưa ai → mọi BTGĐ) |
| Người xem chỉ xem | `services/access.js`: thành viên `VIEWER` không sửa, không quản lý |
| KPI | `lib/policy.js kpi.person`: chỉ BTGĐ + chính mình |
| Chỗ so chuỗi vai | đã chuyển sang hàm vai: approval, task-access, access, approvals, items, projects, workitems, mtl-guard, project-docs, documents, hrm, vanthu, crm, profile, work, ops, admin, kpi, mtl, register, sprint, dispatch |
| Thuật ngữ | Ban Tổng Giám đốc / Phó TGĐ phụ trách / Bộ phận / Vai / Người đứng tên dự án / Lãnh đạo bộ phận chủ trì trên giao diện, thông báo, lỗi, tài liệu hướng dẫn |
| Kiêm nhiệm | trang Thông tin cá nhân hiện "Kiêm nhiệm" của chính mình |
| Test | `lib/role-matrix.test.js` (mỗi vai × chức năng theo bảng 5.4 + quét mã cấm so chuỗi vai / lọc theo bảng quyền từng người); `e2e/tests/17-ma-tran-vai.spec.js` (HTTP mỗi vai × endpoint quan trọng) |

**Chờ PR #40 merge rồi làm nốt** (cùng tệp với #40): `services/weekly-data.js` (`rolesOf` → hàm vai), `routes/reports.js` (xuất MTL), `services/alerts.js` (người nhận Ban TGĐ đang lọc theo bảng quyền), nhãn "Chờ BGĐ cho ý kiến" (`services/stage.js` ↔ `dashboard.test.js`), chữ trong `views/weekly.js`, `docs/data-protection-assessment.md`. Test quét mã đang để ba tệp đầu trong danh sách chờ.

**Thứ tự triển khai (bắt buộc)**: trên bản đang chạy, **trước khi** deploy PR này, quản trị đổi vai tài khoản PMO (`user#6`) trên giao diện Quản trị (có nhật ký, báo BTGĐ) sang vai chủ dự án chọn, và BTGĐ thêm tài khoản này vào danh sách PMO ở Thiết lập giao ban. Nếu deploy trước khi đổi vai, tài khoản này sẽ có quyền toàn công ty theo vai `director` (xem test "vai quyết định" trong `role-matrix.test.js`).
