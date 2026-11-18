"""Recovery of text from PDF fonts embedded without a ToUnicode map.

Some Inep cartilhas (2023-2025) embed Type0/Identity-H subsets of Source Sans Pro
without ToUnicode. Extractors then return glyph ids as characters (mojibake).
Subset fonts keep the original glyph outlines, so each glyph id is resolved by
hashing its outline and looking it up in a table built from the original font.

The repair happens on the in-memory document only (a ToUnicode CMap is attached
to the broken font objects); the original PDF is never written. Nothing is
guessed: a glyph that is not in the table maps to U+FFFD so that downstream
validation can flag the text instead of silently accepting it.
"""
from __future__ import annotations

import hashlib
import io
import json
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

TABLE_DIR = Path(__file__).parent / "glyph_tables"
UNRESOLVED = "\ue0ff"  # private-use sentinel: MuPDF ignores U+FFFD entries in ToUnicode


def outline_signature(font: Any, glyph_name: str) -> str | None:
    glyf = font["glyf"]
    glyph = glyf[glyph_name]
    if glyph.numberOfContours == 0:
        return None
    coords, _ends, flags = glyph.getCoordinates(glyf)
    return hashlib.md5(repr((list(coords), list(flags))).encode()).hexdigest()


def load_reference_table() -> dict[str, str]:
    table: dict[str, str] = {}
    for path in sorted(TABLE_DIR.glob("*.json")):
        table.update(json.loads(path.read_text(encoding="utf-8"))["glyphs"])
    return table


@dataclass
class RepairReport:
    repaired_fonts: list[str] = field(default_factory=list)
    unrepairable_fonts: list[str] = field(default_factory=list)
    unresolved_glyphs: dict[str, int] = field(default_factory=dict)


def _font_needs_repair(doc: Any, xref: int, font_type: str, encoding: str) -> bool:
    if font_type != "Type0" or encoding != "Identity-H":
        return False
    return "ToUnicode" not in doc.xref_object(xref)


def _glyph_map(doc: Any, xref: int, table: dict[str, str]) -> tuple[dict[int, str], int]:
    from fontTools.ttLib import TTFont  # lazy: only needed for broken fonts

    _n, _ext, _typ, buf = doc.extract_font(xref)
    if not buf:
        raise ValueError("font program is not embedded")
    font = TTFont(io.BytesIO(buf))
    glyf = font["glyf"]
    mapping: dict[int, str] = {}
    unresolved = 0
    for gid, gname in enumerate(font.getGlyphOrder()):
        if gname == ".notdef":
            continue
        if glyf[gname].numberOfContours == 0:
            mapping[gid] = " "  # outline-less glyphs are spacing glyphs
            continue
        sig = outline_signature(font, gname)
        if sig and sig in table:
            mapping[gid] = table[sig]
        else:
            mapping[gid] = UNRESOLVED
            unresolved += 1
    return mapping, unresolved


def _to_unicode_cmap(mapping: dict[int, str]) -> bytes:
    lines = [
        "/CIDInit /ProcSet findresource begin",
        "12 dict begin",
        "begincmap",
        "/CIDSystemInfo << /Registry (Adobe) /Ordering (UCS) /Supplement 0 >> def",
        "/CMapName /Adobe-Identity-UCS def",
        "/CMapType 2 def",
        "1 begincodespacerange",
        "<0000> <FFFF>",
        "endcodespacerange",
    ]
    items = sorted(mapping.items())
    for i in range(0, len(items), 100):
        chunk = items[i : i + 100]
        lines.append(f"{len(chunk)} beginbfchar")
        for gid, text in chunk:
            lines.append(f"<{gid:04X}> <{text.encode('utf-16-be').hex().upper()}>")
        lines.append("endbfchar")
    lines += ["endcmap", "CMapName currentdict /CMap defineresource pop", "end", "end"]
    return "\n".join(lines).encode("ascii")


def repair_document(doc: Any, table: dict[str, str] | None = None) -> RepairReport:
    """Attaches generated ToUnicode maps to broken Identity-H fonts (in memory only)."""
    table = table if table is not None else load_reference_table()
    report = RepairReport()
    seen: set[int] = set()
    for page in doc:
        for xref, _ext, ftype, basefont, _alias, encoding, *_rest in page.get_fonts(full=True):
            if xref in seen:
                continue
            seen.add(xref)
            if not _font_needs_repair(doc, xref, ftype, encoding):
                continue
            try:
                mapping, unresolved = _glyph_map(doc, xref, table)
            except Exception as exc:  # corrupt or unsupported font program
                report.unrepairable_fonts.append(f"{basefont}: {exc}")
                continue
            cmap_xref = doc.get_new_xref()
            doc.update_object(cmap_xref, "<< >>")
            doc.update_stream(cmap_xref, _to_unicode_cmap(mapping))
            doc.xref_set_key(xref, "ToUnicode", f"{cmap_xref} 0 R")
            report.repaired_fonts.append(basefont)
            if unresolved:
                report.unresolved_glyphs[basefont] = unresolved
    return report
