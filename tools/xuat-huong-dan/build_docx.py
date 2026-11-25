# Xuất bộ hướng dẫn sử dụng (docs/huong-dan-su-dung/*.md) thành DOCX + PDF để gửi nhân viên.
# Nguồn sự thật là markdown; file trong dist/ là đầu ra — không sửa tay, sửa markdown rồi chạy lại.
#   pip install -r requirements-doc.txt
#   python build_docx.py                 # → dist/*.docx (+ *.pdf nếu có LibreOffice)
#   python build_docx.py --no-pdf
import argparse
import io
import datetime as dt
import re
import shutil
import subprocess
import sys
from pathlib import Path

from docx import Document
from docx.enum.section import WD_ORIENT
from docx.enum.table import WD_TABLE_ALIGNMENT
from docx.enum.text import WD_ALIGN_PARAGRAPH, WD_BREAK
from docx.oxml import OxmlElement
from docx.oxml.ns import qn
from docx.shared import Cm, Pt, RGBColor

HERE = Path(__file__).resolve().parent
SRC = HERE.parent.parent / "docs" / "huong-dan-su-dung"
OUT = HERE / "dist"

# (tệp nguồn, tên tệp xuất, tên bản dùng khi một bản nhắc tới bản kia)
BOOKS = [
    ("nhan-vien.md", "Kepler Hub - Huong dan su dung - Ban nhan vien", "Hướng dẫn sử dụng Kepler Hub — bản nhân viên"),
    ("lanh-dao.md", "Kepler Hub - Huong dan su dung - Ban lanh dao", "Hướng dẫn sử dụng Kepler Hub — bản lãnh đạo"),
    ("thiet-lap.md", "Kepler Hub - Huong dan thiet lap va quan tri", "Hướng dẫn thiết lập và quản trị Kepler Hub"),
]
NAMES = {src: label for src, _, label in BOOKS}

FONT = "Segoe UI"
MONO = "Consolas"
NAVY = RGBColor(0x0F, 0x2D, 0x4A)
GREY = RGBColor(0x55, 0x5F, 0x6B)
MAX_IMG_CM = 16.0


# ---------- Định dạng chung ----------
def setup(doc):
    sec = doc.sections[0]
    sec.orientation = WD_ORIENT.PORTRAIT
    sec.page_width, sec.page_height = Cm(21), Cm(29.7)
    sec.left_margin = sec.right_margin = Cm(2)
    sec.top_margin, sec.bottom_margin = Cm(2), Cm(2)
    st = doc.styles["Normal"]
    st.font.name = FONT
    st.element.rPr.rFonts.set(qn("w:eastAsia"), FONT)
    st.font.size = Pt(10.5)
    st.paragraph_format.space_after = Pt(4)
    st.paragraph_format.line_spacing = 1.15
    for lvl, size in ((1, 18), (2, 15), (3, 12.5), (4, 11)):
        h = doc.styles[f"Heading {lvl}"]
        h.font.name = FONT
        h.element.rPr.rFonts.set(qn("w:eastAsia"), FONT)
        h.font.size = Pt(size)
        h.font.bold = True
        h.font.color.rgb = NAVY
        h.paragraph_format.space_before = Pt(14 if lvl <= 2 else 10)
        h.paragraph_format.space_after = Pt(4)
        h.paragraph_format.keep_with_next = True


def field(run, instr):
    for kind, text in (("begin", None), (None, instr), ("separate", None), ("end", None)):
        if kind:
            el = OxmlElement("w:fldChar")
            el.set(qn("w:fldCharType"), kind)
        else:
            el = OxmlElement("w:instrText")
            el.set(qn("xml:space"), "preserve")
            el.text = text
        run._r.append(el)


def footer(doc, label):
    p = doc.sections[0].footer.paragraphs[0]
    p.alignment = WD_ALIGN_PARAGRAPH.CENTER
    r = p.add_run(f"{label}  ·  trang ")
    r.font.size, r.font.color.rgb = Pt(8.5), GREY
    r2 = p.add_run()
    r2.font.size, r2.font.color.rgb = Pt(8.5), GREY
    field(r2, "PAGE")


def shade(cell, hex_fill):
    tc = cell._tc.get_or_add_tcPr()
    sh = OxmlElement("w:shd")
    sh.set(qn("w:val"), "clear")
    sh.set(qn("w:color"), "auto")
    sh.set(qn("w:fill"), hex_fill)
    tc.append(sh)


def left_bar(par, color="C9A227"):
    ppr = par._p.get_or_add_pPr()
    bdr = OxmlElement("w:pBdr")
    left = OxmlElement("w:left")
    for k, v in (("w:val", "single"), ("w:sz", "18"), ("w:space", "8"), ("w:color", color)):
        left.set(qn(k), v)
    bdr.append(left)
    ppr.append(bdr)


# ---------- Chữ trong dòng: **đậm**, *nghiêng*, `mã`, [chữ](liên kết) ----------
INLINE = re.compile(r"(\*\*.+?\*\*|`[^`]+`|\[[^\]]+\]\([^)]+\)|(?<![\w*])\*[^*\s][^*]*?\*(?!\w))")


def link_text(text, target):
    if target.startswith("#"):
        return text
    doc_part = target.split("#", 1)[0]
    if doc_part in NAMES:
        return f"{text} (tài liệu “{NAMES[doc_part]}”)" if text.strip() != NAMES[doc_part] else text
    if re.match(r"https?://", target) and target not in text:
        return f"{text} ({target})"
    return text


def runs(par, text, bold=False, italic=False, size=None, color=None):
    for part in INLINE.split(text):
        if not part:
            continue
        b, i, mono = bold, italic, False
        if part.startswith("**") and part.endswith("**") and len(part) > 4:
            part, b = part[2:-2], True
        elif part.startswith("`") and part.endswith("`"):
            part, mono = part[1:-1], True
        elif part.startswith("[") and "](" in part and part.endswith(")"):
            t, target = part[1:].split("](", 1)
            runs(par, link_text(t, target[:-1]), bold, italic, size, color)
            continue
        elif part.startswith("*") and part.endswith("*") and len(part) > 2:
            part, i = part[1:-1], True
        r = par.add_run(part)
        r.bold, r.italic = b, i
        if mono:
            r.font.name = MONO
            r.font.size = Pt(9.5)
            r.font.color.rgb = RGBColor(0x8A, 0x1F, 0x11)
        elif size:
            r.font.size = size
        if color and not mono:
            r.font.color.rgb = color


# ---------- Khối ----------
def add_image(doc, rel, alt, base):
    path = (base / rel).resolve()
    if not path.exists():
        sys.exit(f"Thiếu ảnh: {path}")
    from PIL import Image

    with Image.open(path) as im:
        w_px = im.size[0]
    width = min(MAX_IMG_CM, w_px / 96 * 2.54)
    p = doc.add_paragraph()
    p.alignment = WD_ALIGN_PARAGRAPH.CENTER
    p.paragraph_format.keep_with_next = True
    p.add_run().add_picture(str(path), width=Cm(width))
    if alt:
        c = doc.add_paragraph()
        c.alignment = WD_ALIGN_PARAGRAPH.CENTER
        runs(c, alt, italic=True, size=Pt(9), color=GREY)


def add_table(doc, rows):
    cells = [[c.strip() for c in r.strip().strip("|").split("|")] for r in rows]
    head, body = cells[0], cells[1:]
    n = len(head)
    t = doc.add_table(rows=1 + len(body), cols=n)
    t.style = "Table Grid"
    t.alignment = WD_TABLE_ALIGNMENT.CENTER
    for ri, row in enumerate([head] + body):
        for ci in range(n):
            cell = t.rows[ri].cells[ci]
            cell.paragraphs[0].paragraph_format.space_after = Pt(0)
            runs(cell.paragraphs[0], row[ci] if ci < len(row) else "", bold=(ri == 0), size=Pt(9.5))
            if ri == 0:
                shade(cell, "E8EEF5")
    doc.add_paragraph().paragraph_format.space_after = Pt(2)


def add_code(doc, lines):
    for ln in lines or [""]:
        p = doc.add_paragraph()
        p.paragraph_format.space_after = Pt(0)
        p.paragraph_format.left_indent = Cm(0.5)
        r = p.add_run(ln)
        r.font.name, r.font.size = MONO, Pt(9)
    doc.paragraphs[-1].paragraph_format.space_after = Pt(6)


LIST = re.compile(r"^(\s*)([-*]|\d+\.)\s+(.*)$")


def build(src_name, label):
    base = SRC
    lines = (SRC / src_name).read_text(encoding="utf-8").splitlines()
    doc = Document()
    setup(doc)
    footer(doc, label)

    # Trang bìa
    title = next((l[2:].strip() for l in lines if l.startswith("# ")), label)
    for _ in range(6):
        doc.add_paragraph()
    p = doc.add_paragraph()
    p.alignment = WD_ALIGN_PARAGRAPH.CENTER
    r = p.add_run(title)
    r.bold, r.font.size, r.font.color.rgb = True, Pt(24), NAVY
    p = doc.add_paragraph()
    p.alignment = WD_ALIGN_PARAGRAPH.CENTER
    r = p.add_run("https://hub.keplerholdings.vn")
    r.font.size, r.font.color.rgb = Pt(12), GREY
    p = doc.add_paragraph()
    p.alignment = WD_ALIGN_PARAGRAPH.CENTER
    r = p.add_run(f"Kepler Holdings · cập nhật {dt.date.today():%d/%m/%Y}")
    r.font.size, r.font.color.rgb = Pt(11), GREY
    doc.add_paragraph().add_run().add_break(WD_BREAK.PAGE)

    i, n = 0, len(lines)
    skip_toc = False
    seen_h2 = False
    while i < n:
        line = lines[i]
        s = line.strip()
        if line.startswith("# "):  # tiêu đề tài liệu đã ở trang bìa
            i += 1
            continue
        if s.startswith("```"):
            j = i + 1
            while j < n and not lines[j].strip().startswith("```"):
                j += 1
            add_code(doc, lines[i + 1 : j])
            i = j + 1
            continue
        m = re.match(r"^(#{2,4})\s+(.*)$", line)
        if m:
            text = m.group(2).strip()
            skip_toc = text.lower() == "mục lục"
            if not skip_toc:
                lvl = len(m.group(1)) - 1
                h = doc.add_heading(level=lvl)
                if lvl == 1 and seen_h2:  # mỗi chương lớn sang trang mới
                    h.paragraph_format.page_break_before = True
                seen_h2 = seen_h2 or lvl == 1
                runs(h, text)
            i += 1
            continue
        if skip_toc:  # mục lục dạng liên kết không dùng được trên giấy: thay bằng danh sách đề mục ở trang bìa phía sau
            i += 1
            continue
        if re.fullmatch(r"-{3,}|\*{3,}", s):
            i += 1
            continue
        if s.startswith("|") and i + 1 < n and re.fullmatch(r"\|?\s*:?-{2,}.*", lines[i + 1].strip()):
            j = i + 2
            rows = [lines[i]]
            while j < n and lines[j].strip().startswith("|"):
                rows.append(lines[j])
                j += 1
            add_table(doc, rows)
            i = j
            continue
        im = re.fullmatch(r"!\[([^\]]*)\]\(([^)]+)\)", s)
        if im:
            add_image(doc, im.group(2), im.group(1), base)
            i += 1
            continue
        if s.startswith(">"):
            j = i
            buf = []
            while j < n and lines[j].strip().startswith(">"):
                buf.append(lines[j].strip()[1:].strip())
                j += 1
            for chunk in "\n".join(buf).split("\n\n"):
                if chunk.strip():
                    p = doc.add_paragraph()
                    p.paragraph_format.left_indent = Cm(0.4)
                    left_bar(p)
                    runs(p, " ".join(x.strip() for x in chunk.splitlines()), color=RGBColor(0x33, 0x3D, 0x47))
            i = j
            continue
        lm = LIST.match(line)
        if lm:
            indent = len(lm.group(1).replace("\t", "    "))
            ordered = lm.group(2)[0].isdigit()
            if ordered:  # giữ đúng số của nguồn: Word tự đánh số liên tục giữa các danh sách rời nhau
                p = doc.add_paragraph()
            else:
                p = doc.add_paragraph(style="List Bullet 2" if indent >= 2 else "List Bullet")
            p.paragraph_format.space_after = Pt(2)
            text = lm.group(3)
            j = i + 1  # dòng tiếp nối (thụt lề, không phải mục mới, không phải ảnh / bảng)
            while j < n and lines[j].strip() and lines[j].startswith("  ") and not LIST.match(lines[j]) \
                    and not lines[j].strip().startswith(("|", "![", "```")):
                text += " " + lines[j].strip()
                j += 1
            if ordered:
                p.paragraph_format.left_indent = Cm(0.63 + (0.63 if indent >= 2 else 0))
                p.paragraph_format.first_line_indent = Cm(-0.5)
                text = f"{lm.group(2)} {text}"
            runs(p, text)
            i = j
            continue
        if not s:
            i += 1
            continue
        j = i + 1
        text = s
        while j < n and lines[j].strip() and not re.match(r"^(#|\||!\[|>|```|\s*([-*]|\d+\.)\s)", lines[j]) \
                and not re.fullmatch(r"-{3,}", lines[j].strip()):
            text += " " + lines[j].strip()
            j += 1
        runs(doc.add_paragraph(), text)
        i = j
    return doc


def main():
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")
    ap = argparse.ArgumentParser()
    ap.add_argument("--no-pdf", action="store_true")
    ap.add_argument("--out", default=str(OUT))
    a = ap.parse_args()
    out = Path(a.out)
    out.mkdir(parents=True, exist_ok=True)
    made = []
    for src, name, label in BOOKS:
        f = out / f"{name}.docx"
        build(src, label).save(f)
        made.append(f)
        print(f"  ✓ {f.name}")
    soffice = shutil.which("soffice") or shutil.which("soffice.exe")
    if not a.no_pdf:
        if not soffice:
            print("  (không thấy LibreOffice — bỏ qua PDF)")
        for f in made if soffice else []:
            subprocess.run([soffice, "--headless", "--convert-to", "pdf", "--outdir", str(out), str(f)],
                           check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            print(f"  ✓ {f.with_suffix('.pdf').name}")


if __name__ == "__main__":
    main()
