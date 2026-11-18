"""Semantic structure of a cartilha: blocks -> sections -> rubric, proposal, essays, comments.

Everything here is derived from the page records produced by pdftext.py and keeps the
page provenance of each element. Nothing is inferred when the layout does not support
it: the functions return explicit problems that the validation stage reports.
"""
from __future__ import annotations

import re
import statistics
import unicodedata
from collections import Counter
from dataclasses import dataclass, field
from typing import Any

from pdftext import DocumentExtraction, Line

LEVELS = (200, 160, 120, 80, 40, 0)
ROMAN = {"I": 1, "II": 2, "III": 3, "IV": 4, "V": 5}


def squash(text: str) -> str:
    """Uppercase, accent-less, alphanumeric-only key for tolerant heading matching."""
    t = unicodedata.normalize("NFKD", text)
    t = "".join(c for c in t if not unicodedata.combining(c))
    return re.sub(r"[^A-Z0-9]", "", t.upper())


@dataclass
class Block:
    kind: str  # heading | para | bullet | level
    text: str
    page: int
    page_end: int
    printed: str | None
    printed_end: str | None
    size: float
    bold: bool
    bad: bool = False
    x0: float = 0.0
    y0: float = 0.0
    ocr: bool = False
    body_x0: float = 0.0  # left edge of the block's latest line (continuation alignment)

    def pages(self) -> list[int]:
        return [self.page] if self.page == self.page_end else [self.page, self.page_end]


_BULLET = re.compile(r"^(?:[•◦·▪●■\-–—]|\d{1,2}\)|[a-z]\))\s*")
_LEVEL_MARK = re.compile(r"^(200|160|120|80|40|0)\s*pontos?$", re.I)
_TERMINAL = re.compile(r"[.!?:;”\"…)]$")


def _body_size(doc: DocumentExtraction) -> float:
    sizes = [round(l.size, 1) for p in doc.pages for l in p.lines if len(l.text) > 40 and not p.ocr]
    return statistics.mode(sizes) if sizes else 11.0


def _merge_level_lines(lines: list[Line]) -> list[Line]:
    """Tables split the score ("160") and the unit ("pontos") into two lines; join them."""
    out: list[Line] = []
    i = 0
    while i < len(lines):
        ln = lines[i]
        nxt = lines[i + 1] if i + 1 < len(lines) else None
        if nxt is not None and re.fullmatch(r"(200|160|120|80|40|0)", ln.text) and re.fullmatch(r"pontos?", nxt.text, re.I):
            out.append(Line(f"{ln.text} {nxt.text}", ln.x0, ln.y0, nxt.x1, nxt.y1, ln.size, ln.bold, ln.bad or nxt.bad))
            i += 2
            continue
        out.append(ln)
        i += 1
    return out


def build_blocks(doc: DocumentExtraction) -> list[Block]:
    body = _body_size(doc)
    blocks: list[Block] = []
    for rec in doc.pages:
        if rec.ocr or not rec.lines:
            continue
        current: Block | None = None
        prev: Line | None = None

        def flush() -> None:
            nonlocal current
            if current is not None:
                blocks.append(current)
            current = None

        for ln in _merge_level_lines(rec.lines):
            is_heading_line = ln.bold and (ln.size >= body * 0.95) and len(ln.text) <= 140
            if is_heading_line:
                if (
                    current is not None
                    and current.kind == "heading"
                    and prev is not None
                    and abs(prev.size - ln.size) < 0.6
                    and abs(ln.y0 - prev.y1) < ln.size * 1.2
                ):
                    sep = "" if current.text.endswith("-") else " "
                    current.text = (current.text[:-1] if sep == "" else current.text) + sep + ln.text
                    current.bad = current.bad or ln.bad
                else:
                    flush()
                    current = Block("heading", ln.text, rec.page, rec.page, rec.printed, rec.printed, ln.size, True, ln.bad, ln.x0, ln.y0)
            elif _LEVEL_MARK.match(ln.text):
                flush()
                current = Block("level", ln.text, rec.page, rec.page, rec.printed, rec.printed, ln.size, ln.bold, ln.bad, ln.x0, ln.y0)
                flush()
            else:
                # first-line indent is measured against the previous line, not against a page-wide
                # margin: pages mix essay text and commentary typeset at different left edges
                indented = prev is not None and ln.x0 - prev.x0 >= 10
                bullet = bool(_BULLET.match(ln.text))
                finished = prev is not None and bool(_TERMINAL.search(prev.text))
                starts_new = (
                    current is None
                    or current.kind in ("heading", "level")
                    # first-line indent starts a paragraph even when the author left the previous one
                    # unpunctuated (faithful transcriptions); inside a bullet the same offset is a hanging indent
                    or (indented and (current.kind != "bullet" or finished))
                    or bullet
                    or (prev is not None and ln.y0 - prev.y1 > max(ln.size, prev.size) * 0.9)
                )
                if starts_new:
                    flush()
                    current = Block("bullet" if bullet else "para", ln.text, rec.page, rec.page, rec.printed, rec.printed, ln.size, ln.bold, ln.bad, ln.x0, ln.y0, body_x0=ln.x0)
                else:
                    assert current is not None
                    joiner = "" if current.text.endswith("-") and current.text[-2:-1].isalpha() else " "
                    current.text = (current.text[:-1] if joiner == "" else current.text) + joiner + ln.text
                    current.bad = current.bad or ln.bad
                    current.body_x0 = ln.x0
            prev = ln
        # carry an open paragraph across the page break; merge on the next page if it continues
        if current is not None:
            blocks.append(current)
            current = None
    return _merge_across_pages(blocks)


def _merge_across_pages(blocks: list[Block]) -> list[Block]:
    out: list[Block] = []
    for blk in blocks:
        if (
            out
            and out[-1].kind == "bullet"
            and blk.kind == "para"
            and out[-1].page_end == blk.page
            and blk.text[:1].islower()
            and not _TERMINAL.search(out[-1].text)
        ):
            # wrapped tail of a list item typeset with a different line pitch
            out[-1].text += " " + blk.text
            out[-1].bad = out[-1].bad or blk.bad
            continue
        if (
            out
            and blk.kind == "para"
            and out[-1].kind in ("para", "bullet")
            and out[-1].page_end == blk.page - 1
            and not _TERMINAL.search(out[-1].text)
            and abs(blk.x0 - out[-1].body_x0) < 8  # aligned with the paragraph's body lines: a continuation
            and blk.text[:1].islower()
        ):
            prev = out[-1]
            joiner = "" if prev.text.endswith("-") and prev.text[-2:-1].isalpha() else " "
            prev.text = (prev.text[:-1] if joiner == "" else prev.text) + joiner + blk.text
            prev.page_end = blk.page
            prev.printed_end = blk.printed
            prev.bad = prev.bad or blk.bad
        else:
            out.append(blk)
    return out


# ---------------------------------------------------------------------------------------
# Sections
# ---------------------------------------------------------------------------------------
@dataclass
class Section:
    key: str  # apresentacao | matriz | competencia | recomendacoes | amostra | leia_mais
    competency: str | None
    title: str
    blocks: list[Block] = field(default_factory=list)


_COMP_HEAD = re.compile(r"^(?:1?\d?)COMPETENCIA(I{1,3}|IV|V|[1-5])$")


def split_sections(blocks: list[Block]) -> list[Section]:
    sections: list[Section] = []
    current: Section | None = None
    started = False
    for blk in blocks:
        key = squash(blk.text) if blk.kind == "heading" else ""
        new: Section | None = None
        if blk.kind == "heading":
            m = re.search(r"COMPETENCIA(I{1,3}|IV|V|[1-5])$", key)
            if key == "SUMARIO":
                started = False
                current = None
                continue
            if key == "APRESENTACAO":
                new = Section("apresentacao", None, blk.text)
                started = True
            elif re.match(r"^1?\d?MATRIZ", key) or key in {"PARAREDACAO2018", "AREDACAO", "DOENEM2026"}:
                continue  # chapter title: it can be typeset after the first competency heading
            elif m and len(key) <= 22 and re.match(r"^1?\d?COMPETENCIA", key):
                label = m.group(1)
                number = ROMAN.get(label) or int(label)
                new = Section("competencia", {1: "I", 2: "II", 3: "III", 4: "IV", 5: "V"}[number], blk.text)
            elif re.match(r"^(1\d?)?RECOMENDACOESGERAIS$", key):
                new = Section("recomendacoes", None, blk.text)
            elif "AMOSTRADEREDACOES" in key or key.startswith("2AMOSTRA"):
                new = Section("amostra", None, blk.text)
            elif key.startswith("LEIAMAIS"):
                new = Section("leia_mais", None, blk.text)
        if new is not None:
            # a repeated heading (e.g. a big title spread over a page) must not reopen a section
            if current is not None and current.key == new.key and current.competency == new.competency and not current.blocks:
                continue
            sections.append(new)
            current = new
            continue
        if started and current is not None:
            current.blocks.append(blk)
    return sections


# ---------------------------------------------------------------------------------------
# Rubric levels
# ---------------------------------------------------------------------------------------
@dataclass
class LevelDescriptor:
    score: int
    text: str
    page: int
    page_end: int
    printed: str | None
    quality: str  # ok | unreadable


def parse_levels(section: Section) -> tuple[list[LevelDescriptor], list[str]]:
    """Reads the six performance levels of a competency section.

    Returns the descriptors and a list of problems (missing/duplicated levels).
    """
    levels: dict[int, LevelDescriptor] = {}
    problems: list[str] = []
    blocks = section.blocks
    i = 0
    while i < len(blocks):
        blk = blocks[i]
        m = _LEVEL_MARK.match(blk.text) if blk.kind == "level" else None
        if not m:
            i += 1
            continue
        score = int(m.group(1))
        parts: list[Block] = []
        j = i + 1
        while j < len(blocks) and blocks[j].kind in ("para", "bullet") and not _is_note_start(blocks[j]):
            parts.append(blocks[j])
            j += 1
            # a level descriptor is a single paragraph in every edition
            break
        if not parts:
            problems.append(f"nível {score}: sem descritor")
        else:
            text = " ".join(p.text for p in parts)
            bad = any(p.bad for p in parts)
            if score in levels:
                problems.append(f"nível {score}: marcador duplicado")
            levels[score] = LevelDescriptor(
                score, text, parts[0].page, parts[-1].page_end, parts[0].printed, "unreadable" if bad else "ok"
            )
        i = j
    missing = [s for s in LEVELS if s not in levels]
    if missing:
        problems.append(f"níveis ausentes: {missing}")
    return [levels[s] for s in LEVELS if s in levels], problems


def _is_note_start(blk: Block) -> bool:
    return blk.kind == "heading"


# ---------------------------------------------------------------------------------------
# Proposal, essays and official commentary
# ---------------------------------------------------------------------------------------
_COMMENT_HEAD = re.compile(r"^COMENTARIOS?$")
_THEME = re.compile(r"sobre\s+o\s+tema\s*[“\"]([^”\"]{8,300})[”\"]", re.I | re.S)
_NOT_AUTHOR = ("INSTRUCOES", "PROPOSTA", "TEXTO", "LEIAMAIS", "COMENTARIO", "ATENCAO", "AMOSTRA", "REDACAOTEMA")


@dataclass
class Essay:
    index: int
    author: str | None
    title_page: int
    paragraphs: list[Block]
    comment: list[Block]
    problems: list[str] = field(default_factory=list)


@dataclass
class Samples:
    heading: str
    score_documented: int | None  # only when the cartilha itself states it
    score_statement: str | None  # the sentence that supports (or limits) the score claim
    exam_year: int | None
    proposal: list[Block]
    essays: list[Essay]
    theme: str | None
    problems: list[str]


def _author_name(blk: Block) -> str | None:
    t = blk.text.strip()
    t = re.sub(r"^(?:Reda[cç][aã]o\s+de\s+)", "", t, flags=re.I)
    t = re.sub(r"^\d{1,2}\s*[.)]\s*", "", t)
    t = t.strip(" :\t")
    key = squash(t)
    if not t or len(t) > 90 or any(key.startswith(k) for k in _NOT_AUTHOR):
        return None
    words = t.split()
    if not (2 <= len(words) <= 9):
        return None
    if not all(w[:1].isupper() or w.lower() in {"de", "da", "do", "dos", "das", "e"} for w in words):
        return None
    return t


_END_OF_COMMENT = re.compile(
    r"^(com certeza voc[eê] j[aá] ouviu falar|leia mais|reda[cç][aã]o do enem\s*$|a reda[cç][aã]o do enem\s*$|cartilha do participante)",
    re.I,
)
_SCORE_CLAIM = re.compile(r"(pontua[cç][aã]o m[aá]xima\s*[–—-]\s*1\.?000 pontos|nota 1\.?000|boas notas|receberam [^.]{0,40}nota)", re.I)


def _score_and_year(section: Section, blocks: list[Block], preceding: list[Block]) -> tuple[int | None, str | None, int | None]:
    """Reads the score/exam-year claims from the heading and the intro paragraphs.

    On some pages the intro paragraphs are typeset above the section heading, so the
    last blocks of the previous section are searched too.
    """
    candidates = [section.title] + [b.text for b in preceding[-8:] + blocks[:8] if b.kind in ("para", "heading")]
    exam_year = None
    for text in candidates:
        m = re.search(r"(?:edi[cç][aã]o de|DO ENEM)\s*(20\d{2})", text, re.I)
        if m:
            exam_year = int(m.group(1))
            break
    for text in candidates:
        claim = _SCORE_CLAIM.search(text)
        if claim:
            statement = re.sub(r"\s+", " ", text).strip()[:400]
            return (1000 if re.search(r"1\.?000", claim.group(0)) else None), statement, exam_year
    return None, None, exam_year


def parse_samples(section: Section, preceding: list[Block] | None = None) -> Samples:
    problems: list[str] = []
    blocks = section.blocks
    score, statement, exam_year = _score_and_year(section, blocks, preceding or [])
    comment_idx = [
        i for i, b in enumerate(blocks) if b.kind in ("heading", "para") and len(b.text) < 20 and _COMMENT_HEAD.match(squash(b.text))
    ]
    if not comment_idx:
        return Samples(section.title, score, statement, exam_year, blocks, [], None, ["nenhum marcador de comentário encontrado"])
    # author = last block before each comment marker that looks like a name, scanning back
    # to the previous comment marker. The essay body is everything between author and marker.
    starts: list[int] = []
    prev_end = 0
    for k, ci in enumerate(comment_idx):
        lo = prev_end
        found = None
        for i in range(lo, ci):
            if blocks[i].kind in ("heading", "para") and _author_name(blocks[i]) and (
                blocks[i].bold or blocks[i].kind == "heading"
            ):
                # accept the first name-like heading after the previous comment's end
                found = i
                break
        if found is None:
            problems.append(f"redação {k + 1}: autor(a) não identificado(a)")
            found = lo
        starts.append(found)
        # the comment continues until the next essay's author line: find it ahead of time
        nxt = comment_idx[k + 1] if k + 1 < len(comment_idx) else len(blocks)
        end = nxt
        for i in range(ci + 1, nxt):
            if blocks[i].kind in ("heading", "para") and _author_name(blocks[i]) and (
                blocks[i].bold or blocks[i].kind == "heading"
            ):
                end = i
                break
        prev_end = end
    essays: list[Essay] = []
    for k, ci in enumerate(comment_idx):
        start = starts[k]
        nxt_start = starts[k + 1] if k + 1 < len(starts) else len(blocks)
        # the next essay start is the end of this comment (trailing blocks after the last
        # comment belong to the comment until the section ends)
        author_blk = blocks[start]
        author = _author_name(author_blk) if author_blk.kind in ("heading", "para") else None
        body = [b for b in blocks[start + (1 if author else 0) : ci] if b.kind in ("para", "bullet")]
        comment = []
        for b in blocks[ci + 1 : nxt_start]:
            if _END_OF_COMMENT.match(b.text.strip()):
                break  # editorial text that follows the last comment ("Leia mais")
            if b.kind in ("para", "bullet"):
                comment.append(b)
        probs: list[str] = []
        if not body:
            probs.append("texto da redação vazio")
        if not comment:
            probs.append("comentário vazio")
        essays.append(Essay(k + 1, author, author_blk.page, body, comment, probs))
    proposal = blocks[: starts[0]]
    theme = None
    joined = " ".join(b.text for b in proposal)
    m = _THEME.search(joined)
    if m:
        theme = re.sub(r"\s+", " ", m.group(1)).strip()
    return Samples(section.title, score, statement, exam_year, proposal, essays, theme, problems)


_THEME_QUOTE = re.compile(r"tema[^“\"]{0,60}[“\"]([^”\"]{15,220})[”\"]", re.I)


def detect_theme(blocks: list[Block]) -> tuple[str | None, int | None]:
    """Most frequent quoted string that follows the word "tema" anywhere in the cartilha.

    Returns (theme, first page) or (None, None): the caller records the gap instead of
    guessing.
    """
    found: Counter[str] = Counter()
    first_page: dict[str, int] = {}
    for blk in blocks:
        if blk.kind not in ("para", "bullet", "heading"):
            continue
        for m in _THEME_QUOTE.finditer(blk.text):
            theme = re.sub(r"\s+", " ", m.group(1)).strip(" .,;")
            if theme[:1].isupper() and len(theme.split()) >= 3:
                found[theme] += 1
                first_page.setdefault(theme, blk.page)
    if not found:
        return None, None
    theme, _count = found.most_common(1)[0]
    return theme, first_page[theme]
