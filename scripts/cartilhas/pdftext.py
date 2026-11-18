"""Page-level text extraction with provenance and quality flags.

Native PDF text is always preferred. Every page keeps its physical index and, when
printed, the page number shown in the cartilha. Running headers/footers are removed
by repetition (not by hard-coded coordinates) and the removed lines are kept in the
page record so the decision can be audited.
"""
from __future__ import annotations

import hashlib
import re
import shutil
import subprocess
import tempfile
from collections import Counter
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import pymupdf

from glyphs import UNRESOLVED, load_reference_table, repair_document

# Characters that can legitimately occur in the cartilhas (Portuguese prose, quotes, dashes).
_ALLOWED = re.compile(
    r"[A-Za-zÀ-ÿŒœŠšŸŽž0-9\s.,;:!?\-–—‑\"'“”„‘’‚()\[\]{}/\\%º°ª•·…«»&$+=*_#@<>^~|§¹²³€™¬±×÷½¼¾→←↑↓✓­  ​ −•●▪■–—◦○̀-ͯ]"
)
# Symbol-font glyphs (bullets/legend markers) in the private-use block F000-F0FF carry no text.
_SYMBOL_GLYPHS = re.compile("[-]")
# Wide candidate bands: a line is only dropped if the same text repeats on many pages.
_HEADER_BAND_TOP = 0.15
_HEADER_BAND_BOTTOM = 0.78
_BOLD_FONT = re.compile(r"bold|black|semibold|heavy", re.I)


@dataclass
class Line:
    text: str
    x0: float
    y0: float
    x1: float
    y1: float
    size: float
    bold: bool
    bad: bool = False  # contains unresolved/unexpected characters

    def to_json(self) -> dict[str, Any]:
        return {
            "text": self.text,
            "bbox": [round(self.x0, 1), round(self.y0, 1), round(self.x1, 1), round(self.y1, 1)],
            "size": round(self.size, 1),
            "bold": self.bold,
            "bad": self.bad,
        }


@dataclass
class PageRecord:
    page: int  # physical, 1-based
    printed: str | None
    lines: list[Line]
    dropped: list[dict[str, str]] = field(default_factory=list)
    flags: list[str] = field(default_factory=list)
    ocr: bool = False
    width: float = 0.0
    height: float = 0.0

    @property
    def status(self) -> str:
        if self.ocr:
            return "needs_review"
        if any(line.bad for line in self.lines):
            return "degraded"
        return "ok"

    def to_json(self) -> dict[str, Any]:
        return {
            "page": self.page,
            "printed": self.printed,
            "status": self.status,
            "flags": self.flags,
            "ocr": self.ocr,
            "dropped": self.dropped,
            "lines": [line.to_json() for line in self.lines],
        }


@dataclass
class DocumentExtraction:
    year: int
    file: str
    sha256: str
    page_count: int
    pages: list[PageRecord]
    repaired_fonts: list[str]
    unrepairable_fonts: list[str]
    boilerplate: list[str]
    ocr_pages: list[int]

    def page_by_number(self, n: int) -> PageRecord:
        return self.pages[n - 1]


def sha256_of(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as fh:
        for chunk in iter(lambda: fh.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def is_bad_text(text: str) -> bool:
    if UNRESOLVED in text:
        return True
    for ch in text:
        if ch in "\n\t":
            continue
        if ord(ch) < 32 or not _ALLOWED.match(ch):
            return True
    return False


def _norm_key(text: str) -> str:
    t = re.sub(r"[^a-zà-ÿ ]", "#", text.lower())
    return re.sub(r"[ #]+", " ", t).strip()


def _page_lines(page: Any) -> tuple[list[Line], list[Line]]:
    """Returns (lines in visual reading order, lines in content-stream order).

    Some cartilhas (2023) emit the official comment before the essay it refers to in the
    content stream; following the stream would pair the comment with the wrong essay.
    Whole blocks are therefore sorted by position (paragraphs and table cells stay
    intact). The stream order is kept so the stage can flag pages where the two differ
    after the running headers are removed.
    """
    blocks: list[tuple[float, float, list[Line]]] = []
    for block in page.get_text("dict")["blocks"]:
        if block.get("type") != 0:
            continue
        lines: list[Line] = []
        for ln in block.get("lines", []):
            spans = [s for s in ln["spans"] if s["text"]]
            if not spans:
                continue
            text = "".join(s["text"] for s in spans).replace("\u00a0", " ")
            text = _SYMBOL_GLYPHS.sub("", text)
            text = re.sub(r"[ \t]{2,}", " ", text).strip()
            if not text:
                continue
            chars = sum(len(s["text"]) for s in spans) or 1
            bold_chars = sum(len(s["text"]) for s in spans if _BOLD_FONT.search(s["font"]) or s["flags"] & 16)
            x0, y0, x1, y1 = ln["bbox"]
            lines.append(
                Line(
                    text=text,
                    x0=x0,
                    y0=y0,
                    x1=x1,
                    y1=y1,
                    size=max(s["size"] for s in spans),
                    bold=bold_chars / chars > 0.6,
                    bad=is_bad_text(text),
                )
            )
        if lines:
            blocks.append((min(l.y0 for l in lines), min(l.x0 for l in lines), lines))
    stream = [ln for _y, _x, lines in blocks for ln in lines]
    # Only full-width blocks (paragraphs) are compared: table cells and side labels are
    # legitimately emitted out of vertical order and must keep the stream order.
    wide = [b for b in blocks if max(l.x1 for l in b[2]) - b[1] > 0.45 * page.rect.width]
    inverted = any(wide[i + 1][0] < wide[i][0] - 8 for i in range(len(wide) - 1))
    if not inverted:
        return stream, stream
    ordered = sorted(blocks, key=lambda b: (round(b[0]), b[1]))
    return [ln for _y, _x, lines in ordered for ln in lines], stream


def ocr_needed(text_chars: int, image_area_ratio: float) -> bool:
    """OCR is a last resort: only for pages with (almost) no native text but a large image."""
    return text_chars < 40 and image_area_ratio >= 0.3


def _image_area_ratio(page: Any) -> float:
    area = page.rect.width * page.rect.height or 1.0
    total = 0.0
    for info in page.get_image_info():
        x0, y0, x1, y1 = info["bbox"]
        total += max(0.0, x1 - x0) * max(0.0, y1 - y0)
    return min(1.0, total / area)


def _ocr_lines(pdf_path: Path, page_number: int) -> list[Line]:
    """Tesseract fallback. Only the installed languages are used; output is never validated."""
    if not (shutil.which("pdftoppm") and shutil.which("tesseract")):
        return []
    with tempfile.TemporaryDirectory() as tmp:
        prefix = Path(tmp) / "p"
        subprocess.run(
            ["pdftoppm", "-r", "200", "-f", str(page_number), "-l", str(page_number), "-png", str(pdf_path), str(prefix)],
            check=True,
            capture_output=True,
        )
        image = next(Path(tmp).glob("p*.png"))
        res = subprocess.run(["tesseract", str(image), "-", "-l", "eng"], capture_output=True, text=True)
    return [
        Line(text=t.strip(), x0=0, y0=float(i), x1=0, y1=float(i), size=0, bold=False, bad=False)
        for i, t in enumerate(res.stdout.splitlines())
        if t.strip()
    ]


def extract_document(pdf_path: Path, year: int, allow_ocr: bool = True) -> DocumentExtraction:
    doc = pymupdf.open(pdf_path)
    repair = repair_document(doc, load_reference_table())
    pages: list[PageRecord] = []
    stream_orders: list[list[Line]] = []
    for index in range(len(doc)):
        page = doc[index]
        page_lines, stream_lines = _page_lines(page)
        record = PageRecord(
            page=index + 1,
            printed=None,
            lines=page_lines,
            width=page.rect.width,
            height=page.rect.height,
        )
        stream_orders.append(stream_lines)
        pages.append(record)

    # --- running header/footer detection by repetition -------------------------------
    counter: Counter[str] = Counter()
    for rec in pages:
        seen: set[str] = set()
        for ln in rec.lines:
            if ln.y1 <= rec.height * _HEADER_BAND_TOP or ln.y0 >= rec.height * _HEADER_BAND_BOTTOM:
                key = _norm_key(ln.text)
                if key and key not in seen:
                    seen.add(key)
                    counter[key] += 1
    threshold = max(3, int(0.25 * len(pages)))
    boilerplate = {k for k, c in counter.items() if c >= threshold}

    # Printed page numbers: digit-only lines in the header/footer bands are candidates, but
    # a lone number can also be content ("Covid-" / "19" wrapped onto its own line). The
    # physical-to-printed offset is estimated over the whole document and only candidates
    # that agree with it are accepted as page numbers; anything else stays content.
    candidates: dict[int, list[int]] = {}
    for idx, rec in enumerate(pages):
        for pos, ln in enumerate(rec.lines):
            in_band = ln.y1 <= rec.height * _HEADER_BAND_TOP or ln.y0 >= rec.height * _HEADER_BAND_BOTTOM
            nxt = rec.lines[pos + 1].text if pos + 1 < len(rec.lines) else ""
            if in_band and re.fullmatch(r"\d{1,3}", ln.text) and not re.match(r"pontos?$", nxt, re.I):
                candidates.setdefault(rec.page, []).append(int(ln.text))
    offsets = Counter(page - n for page, nums in candidates.items() for n in nums)
    offset = offsets.most_common(1)[0][0] if offsets else None

    for rec in pages:
        kept: list[Line] = []
        expected = None if offset is None else rec.page - offset
        for idx, ln in enumerate(rec.lines):
            in_band = ln.y1 <= rec.height * _HEADER_BAND_TOP or ln.y0 >= rec.height * _HEADER_BAND_BOTTOM
            next_text = rec.lines[idx + 1].text if idx + 1 < len(rec.lines) else ""
            is_level_score = bool(re.fullmatch(r"(200|160|120|80|40)", ln.text)) and bool(re.match(r"pontos?$", next_text, re.I))
            if in_band and not is_level_score and expected is not None and re.fullmatch(r"\d{1,3}", ln.text) and int(ln.text) == expected:
                if rec.printed is None:
                    rec.printed = ln.text
                rec.dropped.append({"text": ln.text, "reason": "page_number"})
            elif in_band and _norm_key(ln.text) in boilerplate:
                rec.dropped.append({"text": ln.text, "reason": "running_header_footer"})
            else:
                kept.append(ln)
        rec.lines = kept
        kept_ids = {id(l) for l in kept}
        stream_kept = [l for l in stream_orders[rec.page - 1] if id(l) in kept_ids]
        if [id(l) for l in stream_kept] != [id(l) for l in kept]:
            rec.flags.append("reordered_by_position")

    # --- OCR only where there is no native text ------------------------------------------
    ocr_pages: list[int] = []
    for rec in pages:
        chars = sum(len(ln.text) for ln in rec.lines)
        if allow_ocr and ocr_needed(chars, _image_area_ratio(doc[rec.page - 1])):
            lines = _ocr_lines(pdf_path, rec.page)
            if lines:
                rec.lines = lines
                rec.ocr = True
                rec.flags.append("ocr_eng_unvalidated")
                ocr_pages.append(rec.page)
        if any(ln.bad for ln in rec.lines):
            rec.flags.append("unreadable_glyphs")
        if not rec.lines:
            rec.flags.append("no_text")

    return DocumentExtraction(
        year=year,
        file=pdf_path.name,
        sha256=sha256_of(pdf_path),
        page_count=len(pages),
        pages=pages,
        repaired_fonts=repair.repaired_fonts,
        unrepairable_fonts=repair.unrepairable_fonts,
        boilerplate=sorted(boilerplate),
        ocr_pages=ocr_pages,
    )
