#!/usr/bin/env python3
"""Dev-only: builds the outline-signature -> text table used to decode PDF fonts
that were embedded without a ToUnicode map (Identity-H, glyph ids as char codes).

The Inep 2023-2025 cartilhas embed subsets of Adobe Source Sans Pro (SIL OFL 1.1).
Subsetting keeps glyph outlines byte-for-byte, so an outline hash identifies the
character without OCR and without guessing. The table is committed; the pipeline
never needs the network. Re-run only if a new PDF uses another font.

Usage:
  uv run --with fonttools python3 scripts/cartilhas/build_glyph_table.py \
      --fonts-dir <dir with SourceSansPro-*.ttf> --out scripts/cartilhas/glyph_tables/source-sans-pro-2.045.json
"""
from __future__ import annotations

import argparse
import json
import sys
import unicodedata
from pathlib import Path

from fontTools.ttLib import TTFont

try:  # allow running as a script
    from glyphs import outline_signature
except ImportError:  # pragma: no cover
    sys.path.insert(0, str(Path(__file__).parent))
    from glyphs import outline_signature


def wanted(cp: int) -> bool:
    """Only characters that can occur in Brazilian Portuguese prose are kept."""
    return (
        0x20 <= cp <= 0x24F
        or 0x2010 <= cp <= 0x2044
        or cp in (0x20AC, 0x2122, 0x2212, 0x2260, 0x2264, 0x2265)
        or 0xFB00 <= cp <= 0xFB06
    )


def preference(cp: int) -> tuple[int, int]:
    if cp < 0x80:
        return (0, cp)
    if cp < 0x100:
        return (1, cp)
    if cp < 0x2000:
        return (2, cp)
    return (3, cp)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--fonts-dir", required=True)
    ap.add_argument("--out", required=True)
    args = ap.parse_args()

    table: dict[str, str] = {}
    conflicts: list[str] = []
    for path in sorted(Path(args.fonts_dir).glob("*.ttf")):
        font = TTFont(path)
        cmap = font.getBestCmap()
        by_glyph: dict[str, list[int]] = {}
        for cp, name in cmap.items():
            by_glyph.setdefault(name, []).append(cp)
        glyf = font["glyf"]
        for name, cps in by_glyph.items():
            if glyf[name].numberOfContours == 0:
                continue
            cps = [c for c in cps if wanted(c)]
            if not cps:
                continue
            cp = min(cps, key=preference)
            ch = chr(cp)
            if unicodedata.category(ch).startswith(("C", "Z")) and cp != 0x20:
                continue
            sig = outline_signature(font, name)
            if sig is None:
                continue
            text = unicodedata.normalize("NFKC", ch) if 0xFB00 <= cp <= 0xFB06 else ch
            if sig in table and table[sig] != text:
                # identical outline, different character (e.g. hyphen vs soft hyphen,
                # letter O vs ordinal): keep the lower code point preference.
                if preference(ord(text[0])) < preference(ord(table[sig][0])):
                    conflicts.append(f"{sig}: {table[sig]!r} -> {text!r}")
                    table[sig] = text
                else:
                    conflicts.append(f"{sig}: kept {table[sig]!r} over {text!r}")
                continue
            table[sig] = text
    payload = {
        "source": "Adobe Source Sans Pro 2.045 (SIL OFL 1.1) - https://github.com/adobe-fonts/source-sans",
        "signature": "md5(repr((coordinates, flags))) of the flattened glyf outline",
        "glyphs": dict(sorted(table.items())),
    }
    Path(args.out).write_text(json.dumps(payload, ensure_ascii=False, indent=0, sort_keys=True) + "\n", encoding="utf-8")
    print(f"{len(table)} outline signatures written; {len(conflicts)} duplicate-outline decisions")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
