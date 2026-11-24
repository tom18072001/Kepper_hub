# Đề xuất: đưa phân quyền Kepler Hub về MỘT hệ quy chiếu

> Trạng thái: **ĐỀ XUẤT — chờ chủ dự án duyệt.** Chưa sửa mã. Rà trên `main` 42cad4a (24/11/2026), có xem trước PR #39 (Tài liệu dự án) và PR #40 (Báo cáo tuần).
> Tài liệu chỉ dùng tên vai, không ghi tên người thật.

---

## 1. Tóm tắt một trang

**Vấn đề.** Câu hỏi "người này là ai trong công ty" hiện được trả lời theo **bốn cách khác nhau**, tuỳ màn hình:

| Câu hỏi | Cách 1 | Cách 2 | Cách 3 | Cách 4 |
|---|---|---|---|---|
| Có phải **Ban Giám đốc** không? | vai tài khoản = "Ban giám đốc" (báo cáo tuần, nhân sự, đối tác, văn thư, tài liệu dự án, MTL) | có quyền "toàn tổ chức" (xem mọi việc, KPI, người duyệt cấp Ban GĐ) | ô đánh dấu **"Ban Giám đốc toàn quyền"** (sửa kế hoạch, duyệt gia hạn mọi việc) | là **"PGĐ phụ trách"** của phòng (Ban GĐ của việc phòng đó) |
| Có phải **lãnh đạo bộ phận** không? | có quyền "Duyệt công việc" phạm vi phòng (trên một việc, hàng chờ duyệt) | có quyền "Xem tổng hợp giao việc" (báo cáo tuần, nhân sự, đối tác, văn thư) | vai "Trưởng phòng" / "Phó phòng" (cây tổ chức, chọn người giao) | |

Vì vậy mới có cặp từ khó hiểu "Ban Giám đốc" và "Ban Giám đốc toàn quyền". Lý do là có tài khoản mang vai Ban giám đốc nhưng thực chất làm PMO. Ngoài ra, cùng một màn Quản trị dùng chữ "Nhóm" cho hai thứ khác nhau, và "phòng ban" / "bộ phận" / "ban" / "đơn vị" lẫn lộn.

**Đề xuất.** Chỉ dùng một hệ quy chiếu, gồm **3 tầng tách bạch**. Mỗi tầng trả lời một câu hỏi, và mỗi khái niệm có một tên duy nhất:

```
Tầng 1  VAI (cố định theo tài khoản)  →  "Người này là ai trong công ty?"
        Ban Giám đốc · Lãnh đạo bộ phận · Nhân viên · Quản trị hệ thống
          └ Ban Giám đốc có thêm "phạm vi phụ trách": toàn công ty, hoặc một số bộ phận

Tầng 2  VAI TRÊN VIỆC / DỰ ÁN (theo từng việc)  →  "Người này liên quan gì tới việc này?"
        Người giao · Người chủ trì · Người phối hợp ; Chủ dự án · Thành viên · Người xem

Tầng 3  KIÊM NHIỆM (Ban GĐ chỉ định trong từng mảng)  →  "Người này được giao thêm nhiệm vụ gì?"
        Thư ký giao ban · PMO · Phụ trách nhân sự · Văn thư · Pháp chế
```

Quyền của một người = **vai** + **vai trên việc / dự án** + **kiêm nhiệm**, không còn nguồn nào khác. Bảng "Phân quyền" chỉnh từng ô cho từng người **bỏ đi**: quyền suy hoàn toàn từ vai.

**Thay đổi về người dùng** (chi tiết ở mục 6):
- Tài khoản đang mang vai Ban giám đốc nhưng không phụ trách gì (trên bản thật hiện có 1 tài khoản PMO) cần chủ dự án quyết lại vai. Đây là **câu hỏi Q1**.
- Mọi người khác **giữ nguyên quyền**, chỉ đổi tên gọi.
- Có thể có thay đổi nhỏ với người được chỉnh quyền riêng; cần chạy kiểm tra ở mục 8 trước khi làm.

**Cần chủ dự án quyết 5 câu hỏi** (mục 7). Sau khi duyệt mới sửa mã (giai đoạn 2), sau khi PR #39 và #40 đã merge.

---

## 2. Bức tranh hiện tại: mọi khái niệm phân quyền đang có

### 2.1 Vai tài khoản (`User.role`) và các cờ

| Khái niệm | Giá trị / tên hiển thị | Nơi định nghĩa | Ghi chú |
|---|---|---|---|
| Vai tài khoản | `admin` Quản trị hệ thống · `director` Ban giám đốc · `manager` Trưởng phòng · `deputy` Phó phòng · `member` Nhân viên | `app/server/prisma/schema.prisma` (User.role), `lib/permissions.js` ROLES, `web/js/util.js` ROLE_LABEL | Trên giao diện Quản trị gọi là **"Nhóm tài khoản"** / cột **"Nhóm"** |
| Quản trị gốc | `User.isRootAdmin` | schema, `permissions.js` | Quản trị IT, không xem nội dung nghiệp vụ |
| Quản trị IT | `isItAdmin` = quản trị gốc hoặc vai `admin` | `permissions.js` | QĐ 16/10/2026: không có quyền nghiệp vụ |
| **Ban Giám đốc toàn quyền** | `User.boardAll` | schema, `routes/admin.js` (PUT board-all), `services/task-access.js`, `services/approval.js` | Ban GĐ của **mọi** việc. Chọn trong màn Phân quyền |
| **PGĐ phụ trách** | `Department.supervisorId` | schema, `routes/admin.js` (màn Phòng ban) | Ban GĐ của việc **do phòng đó chủ trì**. Phải là tài khoản vai `director` |

### 2.2 Bộ quyền chi tiết (`lib/permissions.js`)

- 14 quyền như `work.view`, `work.edit`, `work.delete`, `work.approve`, `projects.manage`, `reports.dashboard | kpi | summary | export`, `admin.*`.
- Mỗi quyền có hành động (Xem / Thao tác) và **phạm vi** `UNIT` (phòng mình) hoặc `SYSTEM` (toàn tổ chức).
- `ROLE_PROFILES`: bộ quyền mặc định của từng vai, **chỉ áp khi tạo tài khoản**. Sau đó quyền được chỉnh từng ô cho từng người ở màn **Phân quyền** (bảng `UserPermission`).
- Như vậy có **hai nguồn sự thật song song**: tên vai (hiện trên màn hình) và bộ quyền thật (có thể khác vai). Màn Phân quyền phải có dòng "Quyền hiện tại khác quyền mặc định của nhóm…" chính vì chuyện này.
- `manager` và `deputy` có bộ quyền **giống hệt nhau**.

### 2.3 Chính sách dữ liệu (`lib/policy.js`)

- `DATASETS`: 21 tập dữ liệu có nhãn (Bảo mật / Nội bộ / Hạn chế…). Hành động: `view`, `edit`, `export`, `ai`, `external`.
- `NEVER_AI` (đang rỗng: AI dùng đúng quyền người dùng), `NEVER_EXTERNAL` (13 tập không gửi ra ngoài), `NEVER_AI_FIELDS` (CCCD, lương).
- "Chủ thể" của chính sách có các cờ `it, director, secretary, pmo, leader, hr, departmentId, userId`, dựng ở `services/weekly-data.js rolesOf()`:
  - `director` = vai `director`;
  - `leader` = **có quyền "Xem tổng hợp giao việc"** (bất kỳ phạm vi nào, nên gồm cả Ban GĐ).

### 2.4 Quyền theo đối tượng

**Dự án** (`services/access.js`):
- Thành viên dự án `OWNER` "Chủ dự án" / `MEMBER` "Thành viên" / `VIEWER` "Người xem".
- `Project.leadId` "Trưởng dự án".
- Chế độ hiển thị: "Cả phòng ban" / "Chỉ thành viên" / "Toàn công ty" / "Sổ giao việc" (`ASSIGNED`).
- Từ đó tính `canView`, `canEdit`, `canManage`, `canDelete`.

**Một việc** (`services/task-access.js`, chốt 20/11/2026) có 7 vai:
- **A** Người giao;
- **B** Ban GĐ của việc (= Ban GĐ toàn quyền + PGĐ phụ trách phòng chủ trì);
- **L** Người chủ trì;
- **S** Người phối hợp;
- **D** Lãnh đạo bộ phận chủ trì;
- **O** Chủ dự án / PMO (**gồm cả "tài khoản vai director không thuộc B"**);
- **U** Người khác.

**Người duyệt** (`services/approval.js`, `services/task-rules.js`) có **7 loại cấp duyệt**:
- Trưởng dự án · Trưởng phòng · Ban giám đốc · "Người giao / PGĐ phụ trách" · Người được chỉ định · Người giao việc · "Ban Giám đốc của việc".
- Ba loại "Ban giám đốc", "Người giao / PGĐ phụ trách" và "Ban Giám đốc của việc" chồng lấn nhau, và mỗi loại tính Ban GĐ theo một cách khác.

**Uỷ quyền** (`Delegation`): người nhận uỷ quyền xem và duyệt thay trong thời hạn.

### 2.5 Danh sách cấu hình riêng từng mảng (kiêm nhiệm)

| Kiêm nhiệm | Nơi cấu hình | Cách xác định |
|---|---|---|
| Thư ký giao ban | Thiết lập giao ban (`services/weekly-data.js`) | **Cả một bộ phận** (`secretaryDepartmentId`) |
| PMO | Thiết lập giao ban | Danh sách người. Khi chưa thiết lập thì tạm dùng "ai có quyền Xem tổng hợp toàn tổ chức" |
| Người phụ trách nhân sự | Thiết lập HRM (`services/hrm.js`) | Danh sách người |
| Văn thư, Pháp chế | Thiết lập Văn thư (`services/vanthu.js`) | Danh sách người |

### 2.6 Giao diện quản trị (`web/js/views/admin.js`, `routes/admin.js`)

- **Tài khoản**: cột "Nhóm" (= vai), cột "Phòng ban", nhãn "BGĐ toàn quyền". Ô chọn "Nhóm tài khoản".
- **Phân quyền** (theo từng tài khoản): bảng có cột **"Nhóm"**, nhưng ở đây "Nhóm" là nhóm quyền (Công việc / Dự án / Báo cáo / Quản trị) chứ **không phải vai**. Kèm ô "Ban Giám đốc toàn quyền" và nút "Khôi phục quyền theo vai trò".
- **Phòng ban**: cột "PGĐ phụ trách".

### 2.7 Các chỗ so thẳng chuỗi vai hoặc tự suy "Ban GĐ" / "lãnh đạo"

Đếm trên `app/server/src`, không tính test.

| Cách suy | Nơi dùng |
|---|---|
| `role === 'director'` | `weekly-data.js`, `hrm.js` (2), `routes/hrm.js`, `vanthu.js` (qua subject), `routes/vanthu.js`, `mtl-guard.js`, `routes/reports.js` (xuất MTL), `routes/projects.js` (tạo dự án MTL), `task-access.js` (vai O), `routes/admin.js` (5), `routes/profile.js`, `routes/approvals.js`, `workitems.js` (ai được làm người giao), `lib/project-docs.js` (PR #39) |
| quyền phạm vi `SYSTEM` | `access.js` (xem mọi việc), `routes/kpi.js` + `routes/analytics.js` (KPI), `approval.js` (`ctx.sys`: người duyệt cấp Ban GĐ) |
| `boardAll` | `task-access.js` (B), `approval.js` / `task-rules.js` (cấp duyệt mốc / đường găng), `routes/approvals.js` |
| `work.approve` phạm vi phòng = lãnh đạo | `access.js isDeptLeader`, `task-access.js`, `routes/approvals.js`, `routes/dashboard.js` |
| `work.approve` **mọi** phạm vi = lãnh đạo | `approval.js` (cấp "Trưởng phòng", người duyệt thay người giao) |
| `reports.summary` = lãnh đạo | `weekly-data.js`, `hrm.js isLeader`, CRM, Văn thư (qua subject) |
| `manager` / `deputy` theo tên | `routes/profile.js` (cây tổ chức), `workitems.js` |

---

## 3. Các chỗ mâu thuẫn, trùng lặp, gây rối

1. **Bốn định nghĩa "Ban Giám đốc"** (mục 1). Hệ quả thực tế:
   - một tài khoản PMO mang vai Ban giám đốc **được** xem hồ sơ, hợp đồng nhân sự, văn bản Bảo mật cao, KPI mọi người;
   - nhưng **không** được sửa kế hoạch việc.
   - Phải đẻ thêm "Ban Giám đốc toàn quyền" để phân biệt, và vai O phải có ngoại lệ "director không thuộc B".
2. **Ba định nghĩa "lãnh đạo bộ phận"** (theo `work.approve` phòng, `work.approve` mọi phạm vi, `reports.summary`). Ai được chỉnh quyền riêng có thể là lãnh đạo ở màn này mà không là lãnh đạo ở màn khác. Ví dụ: một nhân viên được cấp thêm "Duyệt công việc" thành lãnh đạo trên việc, nhưng ở báo cáo tuần và nhân sự thì không.
3. **Tên vai và quyền thật tách rời.** Màn hình ghi "Nhân viên" nhưng bộ quyền có thể là của trưởng phòng. Người đọc không thể biết ai làm được gì nếu chỉ nhìn vai.
4. **"Trưởng phòng" và "Phó phòng" là hai vai có quyền y hệt nhau.** Đây là khái niệm thừa; khác biệt chỉ nằm ở chức danh.
5. **Ba loại cấp duyệt Ban GĐ chồng lấn**: "Ban giám đốc", "Người giao / PGĐ phụ trách", "Ban Giám đốc của việc". Cấp "Người giao / PGĐ phụ trách" còn trộn **vai trên việc** (người giao) với **vai tổ chức** (PGĐ), đúng chỗ chủ dự án nói "người giao lẫn với vai tổ chức".
6. **"Trưởng dự án" và "Chủ dự án"** là hai khái niệm cấp dự án gần nghĩa nhau.
7. **"Người xem" (VIEWER) của dự án không thật sự chỉ xem.** Họ vẫn sửa được nếu cùng phòng, ở sổ giao việc, hoặc là Ban GĐ (`access.js`).
8. **Chính sách KPI lệch quyết định.** `policy.js` (`kpi.person`) còn cho lãnh đạo bộ phận xem KPI người trong phòng. Route thật (`kpi.js`, `analytics.js`) chỉ cho Ban GĐ, đúng quyết định "KPI & phân tích chỉ Ban GĐ". Tài liệu `data-protection-assessment.md` cần đối chiếu lại.
9. **Từ ngữ:**
   - **"Nhóm"** dùng cho cả vai tài khoản lẫn nhóm quyền, trên cùng một màn hình.
   - **"Ban"** vừa là Ban Giám đốc (nhóm người), vừa là tên bộ phận (ví dụ "Ban Tổng Giám đốc" là một phòng trong danh mục), vừa nằm trong chữ "phòng ban".
   - Đơn vị tổ chức có 4 tên: "phòng ban", "phòng", "bộ phận", "đơn vị". Lãnh đạo có 4 tên: "trưởng phòng", "lãnh đạo phòng", "lãnh đạo bộ phận", "trưởng bộ phận".
   - "Ban giám đốc" và "Ban Giám đốc" viết hoa không thống nhất. "PGĐ phụ trách" và "Phó Giám đốc phụ trách" cũng vậy.
   - Cấp duyệt "Trưởng phòng" thực ra gồm cả phó phòng.
10. **Thư ký giao ban xác định theo cả bộ phận**, các kiêm nhiệm khác theo người. Không sai, nhưng là cách thứ hai cho cùng một loại khái niệm (ghi nhận, đề xuất giữ: mục 7, Q5).
11. **Tài liệu `docs/`.**
    - `data-protection-assessment.md`, `huong-dan-su-dung/lanh-dao.md`, `PLAN-kepper.md` dùng lẫn "Ban giám đốc toàn quyền", "PGĐ phụ trách", "trưởng bộ phận", "lãnh đạo bộ phận", "Nhóm tài khoản".
    - `data-protection-assessment.md` còn mô tả "vai trò nghiệp vụ suy ra từ vai + phòng ban", trong khi mã thực tế suy ra từ bộ quyền.

---

## 4. Đề xuất: một hệ quy chiếu duy nhất

### 4.1 Nguyên tắc

1. **Vai quyết định quyền chung.** Không còn chỉnh quyền từng ô cho từng người. Muốn ai có thêm việc thì giao **kiêm nhiệm** hoặc **vai trên việc / dự án**, không cấp quyền rời.
2. **Mỗi câu hỏi chỉ hỏi một chỗ.** Trong mã có đúng **một hàm** cho mỗi câu hỏi, đặt ở `lib/permissions.js`:
   - `isBoard(user)`: có phải Ban Giám đốc;
   - `boardScope(user)`: Ban GĐ phụ trách toàn công ty hay những bộ phận nào;
   - `isDeptLeader(user)`: có phải lãnh đạo bộ phận;
   - `isItAdmin(user)`: có phải quản trị hệ thống.

   Mọi route và service gọi các hàm này. Cấm so chuỗi vai hay suy từ phạm vi quyền ở nơi khác (có test quét mã để chặn).
3. **Vai trên việc không lẫn với vai tổ chức.** "Người giao", "Người chủ trì", "Người phối hợp" chỉ là quan hệ với **một việc**. Ban GĐ và lãnh đạo bộ phận được quyền trên việc **qua vai của họ**, không qua một loại cấp duyệt riêng.
4. Giữ nguyên các quyết định nghiệp vụ đã chốt. Chỗ nào buộc phải đổi đều ghi rõ ở mục 6 và 7.

### 4.2 Bảng thuật ngữ thống nhất (một từ cho một khái niệm)

| Dùng từ | Nghĩa | KHÔNG dùng nữa |
|---|---|---|
| **Vai** | Vai của tài khoản trong công ty (một trong 4 vai) | "Nhóm", "Nhóm tài khoản", "vai trò hệ thống" |
| **Bộ phận** | Đơn vị trong cơ cấu (bảng Department) | "Phòng ban", "phòng", "đơn vị", "ban" khi chỉ đơn vị |
| **Ban Giám đốc (BGĐ)** | Vai của thành viên Ban Giám đốc. Viết hoa đúng như vậy | "Ban giám đốc", "Ban GĐ toàn quyền", "BGĐ toàn quyền" |
| **Phạm vi phụ trách** | Phần việc một thành viên BGĐ chỉ đạo: **Toàn công ty** hoặc **các bộ phận được chọn** | "toàn quyền", "PGĐ phụ trách" (thay bằng "BGĐ phụ trách bộ phận X") |
| **BGĐ phụ trách** (của một việc) | Thành viên BGĐ có phạm vi phụ trách gồm bộ phận chủ trì việc đó (hoặc toàn công ty) | "Ban Giám đốc của việc", "B", "Người giao / PGĐ phụ trách" |
| **Lãnh đạo bộ phận** | Vai của trưởng / phó bộ phận. "Trưởng phòng", "Phó phòng"… chỉ là **chức danh** hiển thị | "Trưởng phòng", "Phó phòng" (khi dùng làm vai), "trưởng bộ phận", "lãnh đạo phòng" |
| **Nhân viên** | Vai của mọi người còn lại | |
| **Quản trị hệ thống** | Vai IT: quản lý tài khoản, bộ phận, nhật ký; **không** xem nội dung nghiệp vụ. "Quản trị gốc" là tài khoản quản trị hệ thống đầu tiên (không khoá được) | |
| **Người giao / Người chủ trì / Người phối hợp** | Quan hệ với **một việc** | |
| **Chủ dự án / Thành viên / Người xem** | Quan hệ với **một dự án**. Người xem chỉ xem | "Trưởng dự án" (thay bằng "Chủ dự án chính": người đứng tên dự án, luôn là Chủ dự án) |
| **Kiêm nhiệm** | Nhiệm vụ BGĐ giao thêm trong từng mảng: Thư ký giao ban, PMO, Phụ trách nhân sự, Văn thư, Pháp chế | "vai trò giao ban", "người phụ trách nhân sự" (rút gọn: "Phụ trách nhân sự") |
| **Mảng** | Nhóm chức năng trên màn quản trị (Công việc, Dự án, Báo cáo, Quản trị) | "Nhóm" (cột bảng quyền) |

### 4.3 Bảng ánh xạ cũ → mới

| Cũ | Mới | Dữ liệu |
|---|---|---|
| vai `director` "Ban giám đốc" | **Ban Giám đốc** | giữ giá trị `director` |
| ô "Ban Giám đốc toàn quyền" (`boardAll`) | BGĐ, **phạm vi phụ trách = Toàn công ty** | giữ cột `boardAll`, chỉ đổi cách hiện và cách nhập |
| "PGĐ phụ trách" của phòng (`Department.supervisorId`) | BGĐ, **phạm vi phụ trách = các bộ phận đó** | giữ cột, nhập từ một chỗ (xem 4.6) |
| vai `director` không phụ trách gì (hiện là tài khoản PMO) | **Câu hỏi Q1**: đổi sang vai thật + kiêm nhiệm PMO (khuyến nghị) | sửa 1 tài khoản bằng tay trên Quản trị |
| vai `manager` "Trưởng phòng" | **Lãnh đạo bộ phận** (chức danh "Trưởng phòng") | giữ `manager` |
| vai `deputy` "Phó phòng" | **Lãnh đạo bộ phận** (chức danh "Phó phòng") | migration `deputy` → `manager`; chức danh giữ nguyên |
| vai `member` | **Nhân viên** | giữ |
| vai `admin`, `isRootAdmin` | **Quản trị hệ thống** (quản trị gốc) | giữ |
| Bộ quyền từng người (`UserPermission`, màn Phân quyền) | **Bỏ chỉnh tay**: quyền = bảng quyền của vai (mục 5). Màn Phân quyền chỉ còn để **xem** | giữ bảng dữ liệu (không xoá), mã không đọc nữa; xoá hẳn ở một bản sau |
| Vai trên việc A / B / L / S / D / O / U | Người giao · BGĐ phụ trách · Người chủ trì · Người phối hợp · Lãnh đạo bộ phận chủ trì · Chủ dự án · Người khác | O **bỏ** điều kiện "vai director không thuộc B": BGĐ đã xem đầy đủ mọi việc theo vai |
| Cấp duyệt "Ban giám đốc" (`DIRECTOR`), "Người giao / PGĐ phụ trách" (`SUPERVISOR`), "Ban Giám đốc của việc" (`BOARD`) | gộp thành **một** cấp: **BGĐ phụ trách** | migration đổi `DIRECTOR` và `SUPERVISOR` → `BOARD` (xem Q4) |
| Cấp duyệt "Trưởng phòng" (`DEPARTMENT_MANAGER`) | **Lãnh đạo bộ phận chủ trì** | đổi nhãn |
| Cấp duyệt "Trưởng dự án" (`PROJECT_LEAD`) | **Chủ dự án chính** | đổi nhãn |
| Cấp duyệt "Người giao việc" (`ASSIGNER`), "Người được chỉ định" (`USER`) | giữ | |
| Thành viên dự án `VIEWER` "Người xem" | **Người xem: chỉ xem**, không sửa trong mọi trường hợp | sửa `access.js` |
| Thư ký (bộ phận), PMO, Phụ trách nhân sự, Văn thư, Pháp chế | **Kiêm nhiệm**, cấu hình ở từng mảng như cũ, hiện gom ở hồ sơ tài khoản | không đổi dữ liệu |
| `reports.summary` / `work.approve` dùng để nhận ra lãnh đạo | `isDeptLeader(user)` = vai Lãnh đạo bộ phận | |
| quyền phạm vi `SYSTEM` dùng để nhận ra Ban GĐ | `isBoard(user)` = vai Ban Giám đốc | |

Sau khi đổi, các quyền chi tiết (`work.view`, `reports.kpi`…) vẫn có thể giữ **bên trong mã** làm tên kỹ thuật cho ma trận. Nhưng chúng được **suy từ vai**, không lưu riêng cho từng người và không hiện như một khái niệm thứ hai cho người dùng.

### 4.4 Ma trận quyền: vai × chức năng chính

Ký hiệu: ✔ được · — không · *(chữ nghiêng)* điều kiện.
"Việc liên quan" = mình là người giao, người chủ trì, người phối hợp, hoặc là lãnh đạo bộ phận chủ trì / phối hợp.

| Chức năng | Ban Giám đốc | Lãnh đạo bộ phận | Nhân viên | Quản trị hệ thống |
|---|---|---|---|---|
| **Xem dự án, việc** | ✔ toàn công ty, xem đầy đủ mọi việc | dự án của bộ phận, dự án dùng chung, dự án mình là thành viên; trên sổ giao việc: việc liên quan | như lãnh đạo bộ phận, trừ việc của bộ phận trên sổ giao việc mà mình không liên quan | — |
| **Tạo dự án** | ✔ mọi bộ phận, kể cả MTL | ✔ trong bộ phận mình (không phải MTL) | — | — |
| **Quản lý dự án** (thành viên, cột, quy trình duyệt, nhập MTL) | ✔ | *Chủ dự án*, hoặc dự án thường của bộ phận mình | *Chủ dự án* | — |
| **Kế hoạch của một việc** (tên, hạn, mốc, đường găng, người chủ trì…), xoá, lặp lại | *BGĐ phụ trách* của việc | *Người giao* | *Người giao* | — |
| **Chọn người cho bước giao về bộ phận** | — | *Lãnh đạo bộ phận chủ trì* | — | — |
| **Cập nhật tiến độ, gửi duyệt, đề nghị gia hạn** | *Người chủ trì* | *Người chủ trì* | *Người chủ trì* | — |
| **Duyệt hoàn thành + chấm mức** | *Người giao*; việc mốc / đường găng: *BGĐ phụ trách* | *Người giao*; *Lãnh đạo bộ phận chủ trì* khi người giao đã nghỉ | *Người giao* | — |
| **Duyệt gia hạn** | *BGĐ phụ trách* | — | — | — |
| **Bình luận** | ✔ | *việc liên quan* | *việc liên quan* | — |
| **Báo cáo tuần: lập / gửi** | — (BGĐ không lập) | ✔ bộ phận mình | ✔ bộ phận mình | — |
| **Bản tổng hợp giao ban: tóm tắt** | ✔ | ✔ | — | — |
| **Bản tổng hợp: đầy đủ** (chi tiết mọi bộ phận, dòng "hệ thống tự bổ sung") | ✔ | *kiêm nhiệm Thư ký / PMO* | *kiêm nhiệm Thư ký / PMO* | — |
| **Gửi tổng hợp qua email / Teams** | ✔ (chỉ bản tóm tắt) | *Thư ký* (chỉ bản tóm tắt) | *Thư ký* (chỉ bản tóm tắt) | — |
| **Kết luận giao ban, chọn Thư ký / PMO** | ✔ (Thư ký ghi điểm danh, Action Log) | — | — | — |
| **KPI & phân tích** (mọi người, mọi bộ phận) | ✔ | — | — | — |
| **KPI của chính mình** | ✔ | ✔ | ✔ | — |
| **Tài liệu dự án** (PR #39) | ✔ mọi dự án | *thành viên dự án* | *thành viên dự án* | — |
| **Nhân sự: hồ sơ, hợp đồng** | ✔ xem; sửa hồ sơ của người Phụ trách nhân sự | xem trường cơ bản của người trong bộ phận | của mình; *Phụ trách nhân sự*: mọi người, trừ chính mình | — |
| **Nhân sự: số CCCD** | — | — | của mình; *Phụ trách nhân sự* | — |
| **Nghỉ phép, chấm công: duyệt** | ✔ mọi đơn (đơn của lãnh đạo bộ phận do BGĐ duyệt) | ✔ nhân viên bộ phận mình | *Phụ trách nhân sự* (ghi nhận) | — |
| **Đối tác (CRM)** | ✔ mọi bộ phận | bộ phận mình; hợp đồng / giá trị của bộ phận mình | đối tác bộ phận mình (trừ giá trị hợp đồng), đối tác mình phụ trách | — |
| **Văn thư** | ✔ mọi mức mật | như nhân viên; thêm vào sổ dãy D7 của bộ phận, đổi bước xử lý văn bản bộ phận | văn bản Công khai / Nội bộ; văn bản Hạn chế của bộ phận mình; văn bản mình xử lý. *Văn thư*: vào sổ; *Pháp chế*: văn bản được chuyển | — |
| **Quản trị: tài khoản, bộ phận, nhãn, nhật ký hệ thống** | — | — | — | ✔ |
| **Chỉ định phạm vi phụ trách của BGĐ** | — | — | — | ✔ (Ban GĐ được thông báo, như hiện nay) |

Đối chiếu các quyết định đã chốt:

| Quyết định | Trong ma trận |
|---|---|
| KPI & phân tích chỉ Ban GĐ | dòng "KPI & phân tích": chỉ BGĐ. Sửa luôn `policy.js` cho khớp |
| Tài liệu dự án: thành viên dự án + Ban GĐ | dòng "Tài liệu dự án". "Ban GĐ" = vai BGĐ, không còn tài khoản PMO lọt vào |
| Admin IT không xem nội dung nghiệp vụ | cột Quản trị hệ thống chỉ có dòng Quản trị |
| Báo cáo tuần: email chỉ bản tóm tắt; "hệ thống tự bổ sung" chỉ ở bản đầy đủ | dòng "Bản tổng hợp" và "Gửi tổng hợp" |
| Quyền tối thiểu trên một việc (20/11/2026) | giữ nguyên bảng A / B / L / S / D / O / U, chỉ đổi tên (B → BGĐ phụ trách) và bỏ ngoại lệ "director không thuộc B" ở O |

### 4.5 Kiêm nhiệm: cố ý giữ ít và rõ

| Kiêm nhiệm | Ai chỉ định | Thêm được gì |
|---|---|---|
| Thư ký giao ban | BGĐ (chọn **bộ phận** thư ký) | Xem bản tổng hợp đầy đủ, nộp thay bộ phận khác, điểm danh, Action Log, gửi bản tóm tắt ra ngoài |
| PMO | BGĐ (chọn người) | Xem bản tổng hợp đầy đủ |
| Phụ trách nhân sự | BGĐ | Quản lý hồ sơ, hợp đồng, CCCD, chấm công (trừ của chính mình) |
| Văn thư | BGĐ | Vào sổ, sửa, huỷ văn bản; xem văn bản Hạn chế |
| Pháp chế | BGĐ | Xem văn bản Hạn chế được chuyển cho Pháp chế |

Chỉ BGĐ chỉ định kiêm nhiệm, quản trị hệ thống không làm được việc này. Hồ sơ tài khoản sẽ hiện thêm dòng "Kiêm nhiệm: …", chỉ để xem.

### 4.6 Giao diện quản trị sau khi đổi

- **Tài khoản**: cột **Vai**, cột **Bộ phận**, cột **Phụ trách** (chỉ với BGĐ: "Toàn công ty" hoặc tên các bộ phận), cột **Kiêm nhiệm**. Ô chọn "Vai" chỉ còn 4 lựa chọn.
- **Phạm vi phụ trách** nhập tại **một chỗ**: khi sửa tài khoản BGĐ, chọn "Toàn công ty" hoặc tick các bộ phận. Màn Bộ phận chỉ **hiện** "BGĐ phụ trách", không sửa ở đó nữa.
- **Phân quyền**: bỏ ô tick từng quyền và ô "Ban Giám đốc toàn quyền". Thay bằng **bảng quyền của vai, chỉ đọc** (chính bảng 4.4), để ai cũng tra được.

---

## 5. Thay đổi mã, dữ liệu, giao diện, tài liệu (giai đoạn 2)

Chỉ làm sau khi PR #39 và #40 đã merge và chủ dự án duyệt. Làm trên nhánh mới từ `main`, kết thúc bằng 1 PR.

| Hạng mục | Nội dung | Tệp chính |
|---|---|---|
| Hàm vai duy nhất | `isBoard`, `boardScope`, `isDeptLeader`, `isItAdmin`. `permissionScope()` đọc bảng quyền **theo vai** thay vì `UserPermission` | `lib/permissions.js` |
| Thay mọi chỗ tự suy | khoảng 40 chỗ ở mục 2.7 chuyển sang gọi hàm vai | `weekly-data.js`, `hrm.js`, `vanthu.js`, `crm.js`, `mtl-guard.js`, `reports.js`, `projects.js`, `workitems.js`, `profile.js`, `approvals.js`, `approval.js`, `task-access.js`, `access.js`, `dashboard.js`, `kpi.js`, `analytics.js`, `project-docs.js`, `admin.js` |
| Chính sách dữ liệu | subject dựng từ hàm vai; sửa `kpi.person` cho đúng "chỉ BGĐ" | `lib/policy.js` |
| Vai trên việc | O bỏ `role === 'director'`; BGĐ xem đầy đủ mọi việc | `task-access.js` |
| Người xem dự án | VIEWER chỉ xem | `access.js` |
| Cấp duyệt | còn 5 loại: Người giao · BGĐ phụ trách · Lãnh đạo bộ phận chủ trì · Chủ dự án chính · Người được chỉ định | `approval.js`, `task-rules.js`, `util.js` APPROVER, màn cài đặt quy trình duyệt |
| Migration | (1) `deputy` → `manager`; (2) `ApprovalStep.approverType` `DIRECTOR` / `SUPERVISOR` → `BOARD`; (3) không xoá `UserPermission` | `prisma/migrations/…` |
| Giao diện | đổi từ ngữ theo 4.2 (Vai, Bộ phận, BGĐ phụ trách, Mảng, Chủ dự án chính…); màn Tài khoản / Phân quyền / Bộ phận theo 4.6 | `web/js/util.js`, `views/admin.js`, `views/settings.js`, `views/dispatch-panel.js`, `views/weekly.js`, `views/hrm.js`, `views/crm.js`, `views/vanthu.js`, `shell.js` |
| Test chốt ma trận | **test mới**: mỗi vai (+ kiêm nhiệm chính) × mỗi endpoint quan trọng → được / bị chặn, so với bảng 4.4. Test quét mã cấm `role === '…'` ngoài `permissions.js`. Sửa `policy.test.js`, `task-access.test.js`, `permissions.test.js`, `admin.test.js`, e2e đổi nhãn | `app/server/src/lib/role-matrix.test.js` (mới), `app/e2e/*` |
| Tài liệu | `data-protection-assessment.md` (mục Quy định phân quyền + đánh giá tác động), `huong-dan-su-dung/lanh-dao.md`, `nhan-vien.md`, `PLAN-kepper.md`; thay chữ trong ghi chú `kepler-hub-quyen-toi-thieu.md` | `docs/` |

**Ước lượng:** khoảng 3–4 ngày làm của một phiên agent, cộng một vòng nghiệm thu. Phần tốn công nhất là đổi chữ trên giao diện, sửa e2e và viết test ma trận.

**Rủi ro và cách giảm:**

| Rủi ro | Cách giảm |
|---|---|
| Mất hoặc thêm quyền ngoài ý muốn khi bỏ bộ quyền từng người | Chạy kiểm tra 8.2 trên bản thật **trước**. Ai có quyền khác vai thì chủ dự án quyết từng người. Test ma trận chốt từng ô |
| Phiếu duyệt đang chờ ở cấp `DIRECTOR` / `SUPERVISOR` đổi người duyệt | Migration chỉ đổi loại cấp của quy trình. Phiếu đang chờ tính lại người duyệt theo BGĐ phụ trách. Kiểm 8.3 trước để biết có bao nhiêu phiếu |
| Gộp Phó phòng vào Lãnh đạo bộ phận làm cây tổ chức (hồ sơ) xếp Trưởng / Phó ngang nhau | Sắp theo chức danh; chấp nhận hiển thị chung tầng "Lãnh đạo bộ phận" |
| Đổi "Phòng ban" → "Bộ phận" trên giao diện làm người dùng quen tay bỡ ngỡ | Đổi một lần, có ghi chú phát hành; tài liệu hướng dẫn sửa cùng lúc |
| Đụng PR #39 / #40 | Chỉ bắt đầu sau khi hai PR merge, rẽ nhánh từ `main` mới nhất |
| Luồng cấp quyền khi tạo tài khoản thay đổi (CLAUDE.md yêu cầu chủ dự án đồng ý) | Ghi rõ ở Q2. Tiêu chí đăng nhập / mật khẩu **không** đổi |

---

## 6. Ai mất, ai được thêm quyền

| Đối tượng | Thay đổi |
|---|---|
| BGĐ phụ trách toàn công ty (hiện là "Ban GĐ toàn quyền") | **Không đổi quyền**, chỉ đổi tên |
| BGĐ phụ trách một số bộ phận (hiện là "PGĐ phụ trách") | **Không đổi quyền** |
| **Tài khoản vai Ban giám đốc nhưng không phụ trách gì** (hiện có 1 tài khoản PMO) | Theo Q1. **Nếu đổi sang vai thật + kiêm nhiệm PMO (khuyến nghị):** **mất** xem mọi dự án / việc ngoài dự án mình là thành viên, KPI & phân tích, hồ sơ và hợp đồng nhân sự mọi người, văn bản Hạn chế / Bảo mật cao, đối tác mọi bộ phận, tài liệu mọi dự án; **phải** lập báo cáo tuần cho bộ phận mình. **Giữ** bản tổng hợp giao ban đầy đủ (PMO), quyền Chủ dự án ở các dự án MTL mình điều phối, quyền người giao của các việc mình đã giao. Đây là thu hẹp theo nguyên tắc **tối thiểu quyền**: giảm rủi ro dữ liệu cá nhân, khớp quyết định "tài khoản này không là Ban Giám đốc của việc" (20/11/2026) |
| Lãnh đạo bộ phận (Trưởng / Phó) | **Không đổi quyền** (vốn đã giống nhau). Chỉ đổi tên vai; chức danh giữ nguyên |
| Nhân viên | **Không đổi** |
| Người có bộ quyền **khác** vai (được chỉnh tay) | Về đúng quyền của vai. Danh sách cụ thể lấy từ kiểm tra 8.2, chủ dự án duyệt từng người (đổi vai, giao kiêm nhiệm, hoặc chấp nhận mất) |
| Thành viên dự án vai "Người xem" | **Mất** quyền sửa việc trong dự án đó (trước đây sửa được nếu cùng bộ phận / ở sổ giao việc). Muốn sửa thì đổi thành "Thành viên" |
| BGĐ là người giao nhưng không phụ trách bộ phận chủ trì, ở cấp duyệt "Người giao / PGĐ phụ trách" cũ | Ở cấp gộp "BGĐ phụ trách" thì **không còn** là người duyệt. Vẫn duyệt ở cấp "Người giao" (chấm mức) nếu quy trình có cấp này. Phạm vi ảnh hưởng xem kiểm tra 8.3 |
| Quản trị hệ thống | **Không đổi** |

Không ai **được thêm** quyền nghiệp vụ mới. Riêng cột "Phạm vi phụ trách" giúp nhìn rõ quyền đang có, không mở thêm.

---

## 7. Câu hỏi chủ dự án cần quyết

| # | Câu hỏi | Khuyến nghị |
|---|---|---|
| **Q1** | Tài khoản PMO hiện mang vai Ban giám đốc: giữ vai BGĐ (phạm vi phụ trách: không có) hay đổi sang vai thật + kiêm nhiệm PMO? | **Đổi sang vai thật + kiêm nhiệm PMO.** Như vậy "Ban Giám đốc" chỉ còn một nghĩa, và từ "toàn quyền" biến mất hoàn toàn. Nếu chọn giữ, hệ quy chiếu vẫn một tầng, nhưng phải chấp nhận "có BGĐ không phụ trách gì" |
| **Q2** | Bỏ chỉnh quyền từng người, để quyền hoàn toàn theo vai? (Đổi "luồng cấp quyền", nên cần chủ dự án đồng ý theo CLAUDE.md) | **Đồng ý bỏ.** Ngoại lệ thật sự cần thì xử lý bằng kiêm nhiệm hoặc vai trên dự án |
| **Q3** | Gộp "Trưởng phòng" và "Phó phòng" thành một vai "Lãnh đạo bộ phận"? | **Gộp.** Quyền vốn giống hệt; khác biệt nằm ở chức danh |
| **Q4** | Gộp ba cấp duyệt Ban GĐ thành một cấp "BGĐ phụ trách"? | **Gộp**, sau khi xem kết quả kiểm tra 8.3 |
| **Q5** | Thư ký giao ban vẫn chọn theo **bộ phận** (như QC giao ban), hay chuyển sang chọn **người**? | **Giữ theo bộ phận** (đúng quy chế đang áp dụng, không làm phức tạp thêm) |
| Q6 (nhỏ) | Đổi chữ "Phòng ban" → "Bộ phận" trên toàn giao diện? | **Đổi**, để một từ cho một khái niệm |

---

## 8. Kiểm tra trên bản thật trước khi sửa mã (chỉ đọc)

Phiên nghiệm thu hoặc quản trị chạy trên máy chủ. **Kết quả không đưa vào git** vì có tên người thật.

```sql
-- 8.1 Vai, BGĐ toàn quyền, số bộ phận phụ trách của từng tài khoản đang hoạt động
SELECT u.username, u.role, u."boardAll", COUNT(d.id) AS so_bo_phan_phu_trach
FROM "User" u LEFT JOIN "Department" d ON d."supervisorId" = u.id
WHERE u."isActive" GROUP BY u.id ORDER BY u.role;

-- 8.2 Tài khoản có bộ quyền khác bộ mặc định của vai: so với ROLE_PROFILES bằng script node đọc lib/permissions.js
--      (liệt kê username + quyền thừa / thiếu).

-- 8.3 Quy trình duyệt và phiếu đang chờ theo loại cấp
SELECT "approverType", COUNT(*) FROM "ApprovalStep" GROUP BY 1;
SELECT s."approverType", COUNT(*) FROM "ApprovalRequest" r JOIN "ApprovalStep" s ON s."projectId" = (SELECT "projectId" FROM "WorkItem" w WHERE w.id = r."workItemId") AND s.level = r."currentLevel"
WHERE r.status = 'PENDING' GROUP BY 1;

-- 8.4 Số thành viên dự án vai Người xem; số tài khoản Phó phòng
SELECT role, COUNT(*) FROM "ProjectMember" GROUP BY 1;
SELECT COUNT(*) FROM "User" WHERE role = 'deputy';
```

Tên bảng và cột cần đối chiếu lại với `schema.prisma` lúc chạy (câu 8.3 viết theo cấu trúc hiện tại, có thể phải chỉnh).

---

## 9. Đánh giá bảo vệ dữ liệu (Data Protection Gate, tóm tắt)

| Lớp | Ảnh hưởng của đề xuất |
|---|---|
| GOV (quản trị) | Một nguồn quyền duy nhất, ma trận công khai trong hệ thống, test chốt từng ô. Dễ kiểm toán hơn hiện nay |
| PRE (phòng ngừa) | Bỏ cấp quyền rời từng người: giảm nguy cơ "quyền dư" khó thấy. Tài khoản PMO thôi xem hồ sơ, hợp đồng nhân sự và văn bản mật: **tối thiểu hoá dữ liệu cá nhân** (Nghị định 13/2023, Luật BVDLCN) |
| DET (phát hiện) | Đổi vai, đổi phạm vi phụ trách, chỉ định kiêm nhiệm đều ghi nhật ký và báo Ban GĐ (giữ cơ chế hiện có). Giữ nhật ký ≥ 12 tháng như quy định |
| PRI (riêng tư) | Không thêm tập dữ liệu, không đổi nhãn. KPI cá nhân vẫn chỉ BGĐ. Sửa `policy.js` cho khớp |
| RES (ứng phó) | Migration không xoá dữ liệu (`UserPermission` giữ lại), có thể quay lại bản cũ |

Ở giai đoạn 2, cập nhật mục "Quy định phân quyền" trong `docs/data-protection-assessment.md` theo bảng 4.4. Không có chuyển dữ liệu xuyên biên giới mới.
