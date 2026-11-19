-- Tìm nhanh (Ctrl K) không phân biệt dấu: "phong hop" khớp "Bảng phòng họp", "NOXH" khớp "NƠXH".
-- unaccent là extension contrib có sẵn trong image postgres:16-alpine và là extension "trusted" (PG ≥ 13):
-- chủ CSDL tạo được, không cần superuser. Không đổi bảng nào nên không cần sửa schema.prisma.
CREATE EXTENSION IF NOT EXISTS unaccent;
