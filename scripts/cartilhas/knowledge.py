"""Normalized document model, semantic chunking and cross-edition deduplication.

Categories (the three kinds of evidence the corrector may retrieve):
  orientacao         official guidance: competency explanations, recommendations, rules
  redacao_comentada  sample essays and their official INEP commentary (kept paired)
  exemplo            worked examples used by the INEP text to show a problem or good practice

Every chunk carries verbatim INEP text only. Metadata that is *derived* by rules (the
competencies a commentary paragraph talks about) is labelled as such.
"""
from __future__ import annotations

import hashlib
import re
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from pdftext import DocumentExtraction
from structure import (
    Block,
    Section,
    build_blocks,
    detect_theme,
    parse_levels,
    parse_samples,
    split_sections,
    squash,
)

PIPELINE_VERSION = 1
COMPETENCIES = ("I", "II", "III", "IV", "V")
MAX_CHUNK_CHARS = 1500
MIN_CHUNK_CHARS = 220

_EXAMPLE_START = re.compile(r"^(exemplos?\b|veja (um|outro|mais um|outros) exemplos?|exemplo:)", re.I)

# Rule-based competency tags for free prose (commentary, general recommendations).
_KEYWORDS: dict[str, tuple[str, ...]] = {
    "I": (
        "modalidade escrita",
        "convencoes da escrita",
        "desvio",
        "estrutura sintatica",
        "ortografia",
        "concordancia",
        "regencia",
        "pontuacao",
        "crase",
        "escolha de registro",
        "norma padrao",
        "norma-padrao",
        "escolha vocabular",
        "acentuacao",
        "periodo",
        "competencia i ",
        "competencia 1",
    ),
    "II": (
        "repertorio",
        "tangenci",
        "fuga ao tema",
        "fuga total",
        "tipo textual",
        "tipologia",
        "estrutura dissertativo",
        "texto dissertativo-argumentativo",
        "compreensao da proposta",
        "recorte tematico",
        "abordagem do tema",
        "tema e abordado",
        "competencia ii ",
        "competencia 2",
    ),
    "III": (
        "projeto de texto",
        "argumentacao",
        "argumentos",
        "autoria",
        "progressao",
        "coerencia",
        "informacoes, fatos e opinioes",
        "desenvolvimento dos argumentos",
        "competencia iii",
        "competencia 3",
    ),
    "IV": (
        "coesao",
        "conectivo",
        "operador argumentativ",
        "operadores argumentativ",
        "referenciacao",
        "recursos coesivos",
        "elementos coesivos",
        "mecanismos linguisticos",
        "competencia iv",
        "competencia 4",
    ),
    "V": (
        "proposta de intervencao",
        "agente",
        "direitos humanos",
        "detalhamento",
        "acao interventiva",
        "intervencao",
        "competencia v ",
        "competencia 5",
    ),
}
_COMP_MENTION = re.compile(r"compet[eê]ncias?\s+((?:I{1,3}|IV|V|[1-5])(?:\s*(?:,|e|a)\s*(?:I{1,3}|IV|V|[1-5]))*)", re.I)
_ARABIC = {"1": "I", "2": "II", "3": "III", "4": "IV", "5": "V"}


def norm_text(text: str) -> str:
    return squash_keep_spaces(text)


def squash_keep_spaces(text: str) -> str:
    import unicodedata

    t = unicodedata.normalize("NFKD", text.lower())
    t = "".join(c for c in t if not unicodedata.combining(c))
    return re.sub(r"[^a-z0-9]+", " ", t).strip()


def checksum(text: str) -> str:
    return hashlib.sha256(norm_text(text).encode("utf-8")).hexdigest()[:16]


def derive_competencies(text: str, section_competency: str | None = None) -> tuple[list[str], str]:
    """Returns (competencies, source) where source says how they were assigned."""
    if section_competency:
        return [section_competency], "section"
    t = " " + squash_keep_spaces(text) + " "
    mentions: list[str] = []
    for m in _COMP_MENTION.finditer(text):
        for token in re.findall(r"I{1,3}|IV|V|[1-5]", m.group(1), re.I):
            roman = _ARABIC.get(token, token.upper())
            if roman in COMPETENCIES and roman not in mentions:
                mentions.append(roman)
    scores = {c: sum(t.count(" " + k.strip() + " ") if k.endswith(" ") else t.count(k) for k in kws) for c, kws in _KEYWORDS.items()}
    top = max(scores.values()) if scores else 0
    ranked = [c for c, n in sorted(scores.items(), key=lambda kv: -kv[1]) if n > 0 and n >= max(1, 0.5 * top)]
    out = list(dict.fromkeys(mentions + ranked))[:3]
    return out, "keyword_rule" if out else "none"


def _page_span(blocks: list[Block]) -> dict[str, Any]:
    pages = [b.page for b in blocks] + [b.page_end for b in blocks]
    printed = [b.printed for b in blocks if b.printed] + [b.printed_end for b in blocks if b.printed_end]
    return {
        "pdfPages": [min(pages), max(pages)],
        "printedPages": [printed[0], printed[-1]] if printed else None,
    }


def _block_text(b: Block) -> str:
    return ("- " + re.sub(r"^[•◦·▪●■\-–—]\s*", "", b.text)) if b.kind == "bullet" else b.text


@dataclass
class DocModel:
    year: int
    json: dict[str, Any]
    chunks: list[dict[str, Any]]
    problems: list[str]


def _consumed_level_blocks(section: Section) -> set[int]:
    used: set[int] = set()
    for i, b in enumerate(section.blocks):
        if b.kind == "level":
            used.add(id(b))
            if i + 1 < len(section.blocks) and section.blocks[i + 1].kind in ("para", "bullet"):
                used.add(id(section.blocks[i + 1]))
    return used


def _sub_heading(b: Block) -> bool:
    return b.kind == "heading" and not squash(b.text).startswith("ATENCAO")


def _group_by_heading(blocks: list[Block], skip: set[int]) -> list[tuple[str | None, list[Block]]]:
    """Groups consecutive blocks under their latest sub-heading."""
    groups: list[tuple[str | None, list[Block]]] = []
    title: str | None = None
    current: list[Block] = []
    for b in blocks:
        if id(b) in skip:
            continue
        if _sub_heading(b):
            if current:
                groups.append((title, current))
            title = b.text
            current = []
            continue
        current.append(b)
    if current:
        groups.append((title, current))
    return groups


def _split_by_size(blocks: list[Block]) -> list[list[Block]]:
    parts: list[list[Block]] = []
    cur: list[Block] = []
    size = 0
    for b in blocks:
        length = len(b.text) + 1
        if cur and size + length > MAX_CHUNK_CHARS:
            parts.append(cur)
            cur, size = [], 0
        cur.append(b)
        size += length
    if cur:
        parts.append(cur)
    # merge a tiny trailing part into its predecessor
    if len(parts) > 1 and sum(len(b.text) for b in parts[-1]) < MIN_CHUNK_CHARS:
        parts[-2].extend(parts.pop())
    return parts


def build_document(extraction: DocumentExtraction) -> DocModel:
    year = extraction.year
    doc_id = f"cartilha-{year}"
    problems: list[str] = []
    blocks = build_blocks(extraction)
    sections = split_sections(blocks)
    theme, theme_page = detect_theme(blocks)
    if theme is None:
        problems.append("tema da proposta não localizado no texto extraído")

    rubric: dict[str, Any] = {}
    chunks: list[dict[str, Any]] = []
    out_sections: list[dict[str, Any]] = []
    seq = 0

    def new_chunk(category: str, kind: str, title: str, text: str, blks: list[Block], competencies: list[str], comp_source: str, section_title: str, extra: dict[str, Any] | None = None) -> dict[str, Any]:
        nonlocal seq
        seq += 1
        span = _page_span(blks)
        bad = any(b.bad for b in blks)
        chunk: dict[str, Any] = {
            "id": f"{year}.{category[:4]}.{seq:04d}",
            "docId": doc_id,
            "year": year,
            "category": category,
            "kind": kind,
            "title": title,
            "section": section_title,
            "competencies": competencies,
            "competencySource": comp_source,
            "theme": None,
            "text": text,
            "checksum": checksum(text),
            "origin": "inep_verbatim",
            "quality": "partial" if bad else "ok",
            **span,
        }
        if extra:
            chunk.update(extra)
        return chunk

    for sec in sections:
        if sec.key in ("competencia", "recomendacoes", "apresentacao"):
            skip: set[int] = set()
            if sec.key == "competencia":
                levels, lv_problems = parse_levels(sec)
                skip = _consumed_level_blocks(sec)
                for p in lv_problems:
                    problems.append(f"Competência {sec.competency}: {p}")
                head = [b for b in sec.blocks[:8] if b.kind == "heading"]
                title_blocks: list[Block] = []
                for b in sec.blocks:
                    if b.kind == "heading" and not squash(b.text).startswith("ATENCAO"):
                        title_blocks.append(b)
                    else:
                        break
                rubric[sec.competency or "?"] = {
                    "heading": sec.title,
                    "officialTitle": " ".join(b.text for b in title_blocks) or None,
                    "levels": [
                        {
                            "score": lv.score,
                            "text": lv.text,
                            "pdfPages": [lv.page, lv.page_end],
                            "printedPage": lv.printed,
                            "quality": lv.quality,
                        }
                        for lv in levels
                    ],
                }
                _ = head
                skip |= {id(b) for b in title_blocks}
            out_sections.append(
                {
                    "key": sec.key,
                    "competency": sec.competency,
                    "title": sec.title,
                    "blocks": [
                        {"kind": b.kind, "text": b.text, **_page_span([b]), "quality": "partial" if b.bad else "ok", "role": "rubric_level" if id(b) in skip else "content"}
                        for b in sec.blocks
                    ],
                }
            )
            groups = _group_by_heading(sec.blocks, skip)
            for gtitle, gblocks in groups:
                # category C: worked examples inside the group
                example_idx = [i for i, b in enumerate(gblocks) if b.kind == "para" and _EXAMPLE_START.match(b.text)]
                heading_title = gtitle or sec.title
                if gtitle and _EXAMPLE_START.match(gtitle):
                    example_idx = [0] + example_idx
                    example_idx = sorted(set(example_idx))
                # split group: before first example -> guidance, each example -> category C
                cuts = example_idx + [len(gblocks)]
                leading = gblocks[: cuts[0]] if example_idx else gblocks
                if example_idx and gtitle and _EXAMPLE_START.match(gtitle):
                    leading = []
                for part in _split_by_size(leading) if leading else []:
                    text = "\n".join(_block_text(b) for b in part)
                    if len(text) < 40:
                        continue
                    comps, src = derive_competencies(heading_title + " " + text, sec.competency)
                    chunks.append(new_chunk("orientacao", "guidance", heading_title, text, part, comps, src, sec.title))
                for a, z in zip(cuts[:-1], cuts[1:]) if example_idx else []:
                    part = gblocks[a:z]
                    if not part:
                        continue
                    text = "\n".join(_block_text(b) for b in part)
                    marker = gtitle if (gtitle and _EXAMPLE_START.match(gtitle) and a == 0) else part[0].text
                    comps, src = derive_competencies(heading_title + " " + text, sec.competency)
                    for sub in _split_by_size(part):
                        chunks.append(
                            new_chunk(
                                "exemplo",
                                "worked_example",
                                (gtitle if gtitle and _EXAMPLE_START.match(gtitle) else marker)[:160],
                                "\n".join(_block_text(b) for b in sub),
                                sub,
                                comps,
                                src,
                                sec.title,
                            )
                        )
            # general-recommendation / presentation text has no competency anchor; derived tags apply
    # --- samples ----------------------------------------------------------------------
    essays_json: list[dict[str, Any]] = []
    samples_meta: dict[str, Any] = {}
    sample_sections = [i for i, s in enumerate(sections) if s.key == "amostra"]
    if not sample_sections:
        problems.append("seção de redações comentadas não localizada")
    else:
        i = sample_sections[0]
        sm = parse_samples(sections[i], sections[i - 1].blocks if i > 0 else [])
        problems += [f"amostra: {p}" for p in sm.problems]
        samples_meta = {
            "heading": sm.heading,
            "examYear": sm.exam_year,
            "scoreDocumented": sm.score_documented,
            "scoreStatement": sm.score_statement,
        }
        for essay in sm.essays:
            eid = f"{year}.essay.{essay.index:02d}"
            for p in essay.problems:
                problems.append(f"redação {essay.index}: {p}")
            ebl = essay.paragraphs
            cbl = essay.comment
            essay_text = "\n\n".join(b.text for b in ebl)
            essays_json.append(
                {
                    "id": eid,
                    "index": essay.index,
                    "author": essay.author,
                    "scoreDocumented": sm.score_documented,
                    "scoreStatement": sm.score_statement,
                    "paragraphs": [{"text": b.text, **_page_span([b]), "quality": "partial" if b.bad else "ok"} for b in ebl],
                    "commentary": [{"text": b.text, **_page_span([b]), "quality": "partial" if b.bad else "ok"} for b in cbl],
                }
            )
            if not ebl or not cbl:
                continue
            title = f"Redação {essay.index}" + (f" — {essay.author}" if essay.author else "")
            base = {
                "essayId": eid,
                "essayAuthor": essay.author,
                "scoreDocumented": sm.score_documented,
                "examYear": sm.exam_year,
                "theme": theme,
                "indexed": False,  # essay bodies are reached through their commentary, never as search hits
            }
            essay_chunk = new_chunk("redacao_comentada", "essay", title, essay_text, ebl, ["I", "II", "III", "IV", "V"], "essay_scope", sm.heading, base)
            essay_chunk["id"] = eid
            essay_chunk["commentChunkIds"] = []
            chunks.append(essay_chunk)
            # commentary: whole paragraphs, grouped up to the size limit, tagged per group
            groups: list[list[Block]] = []
            cur: list[Block] = []
            size = 0
            for b in cbl:
                if cur and size + len(b.text) > MAX_CHUNK_CHARS:
                    groups.append(cur)
                    cur, size = [], 0
                cur.append(b)
                size += len(b.text) + 1
            if cur:
                groups.append(cur)
            for gi, grp in enumerate(groups, 1):
                text = "\n\n".join(b.text for b in grp)
                comps, src = derive_competencies(text)
                c = new_chunk(
                    "redacao_comentada",
                    "commentary",
                    f"Comentário oficial do INEP — {title} ({gi}/{len(groups)})",
                    text,
                    grp,
                    comps or ["I", "II", "III", "IV", "V"],
                    src if comps else "essay_scope",
                    sm.heading,
                    {**base, "indexed": True, "pairedEssayChunkId": eid, "indexed": True},
                )
                c["id"] = f"{eid}.comment.{gi:02d}"
                essay_chunk["commentChunkIds"].append(c["id"])
                chunks.append(c)
    # theme on every chunk of the edition (metadata filter)
    for c in chunks:
        c["theme"] = theme

    page_status = {str(p.page): p.status for p in extraction.pages}
    document = {
        "schemaVersion": 1,
        "pipelineVersion": PIPELINE_VERSION,
        "id": doc_id,
        "year": year,
        "file": extraction.file,
        "sha256": extraction.sha256,
        "pageCount": extraction.page_count,
        "publisher": "Inep/MEC",
        "theme": theme,
        "themePdfPage": theme_page,
        "samples": samples_meta,
        "extraction": {
            "method": "native_text",
            "repairedFonts": extraction.repaired_fonts,
            "unrepairableFonts": extraction.unrepairable_fonts,
            "ocrPages": extraction.ocr_pages,
            "runningHeadersFooters": extraction.boilerplate,
            "reorderedPages": [p.page for p in extraction.pages if "reordered_by_position" in p.flags],
            "pageStatus": page_status,
            "pagesWithPrintedNumber": {str(p.page): p.printed for p in extraction.pages if p.printed},
        },
        "rubric": rubric,
        "sections": out_sections,
        "essays": essays_json,
        "problems": problems,
    }
    return DocModel(year=year, json=document, chunks=chunks, problems=problems)


# ---------------------------------------------------------------------------------------
# Deduplication across editions
# ---------------------------------------------------------------------------------------
def _shingles(text: str, n: int = 4) -> set[str]:
    words = norm_text(text).split()
    if len(words) <= n:
        return {" ".join(words)}
    return {" ".join(words[i : i + n]) for i in range(len(words) - n + 1)}


def jaccard(a: set[str], b: set[str]) -> float:
    if not a or not b:
        return 0.0
    return len(a & b) / len(a | b)


EQUIVALENT = 0.85
RELATED = 0.55


def dedupe(chunks: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Marks chunks as superseded by a newer equivalent one and links related versions.

    Only guidance/example chunks are compared: essays and their commentary are unique
    editorial pieces. Equivalent text (exact after normalization, or >= 0.85 shingle
    similarity) keeps the newest edition as the indexed version; older ones stay in the
    data (``supersededBy``) so provenance is never lost. Text that overlaps partly is kept
    as a distinguishable version and cross-linked with ``related``.
    """
    pool = [c for c in chunks if c["category"] in ("orientacao", "exemplo") and c["quality"] == "ok"]
    shingles = {c["id"]: _shingles(c["text"]) for c in pool}
    by_year = sorted(pool, key=lambda c: (-c["year"], c["id"]))
    kept: list[dict[str, Any]] = []
    for c in by_year:  # newest first: the first occurrence is the canonical one
        winner = None
        best = 0.0
        related: list[tuple[float, dict[str, Any]]] = []
        for k in kept:
            if k["category"] != c["category"]:
                continue
            if not (set(k["competencies"]) & set(c["competencies"])) and k["competencies"] and c["competencies"]:
                continue
            sim = 1.0 if k["checksum"] == c["checksum"] else jaccard(shingles[k["id"]], shingles[c["id"]])
            if sim >= EQUIVALENT and sim > best:
                winner, best = k, sim
            elif sim >= RELATED:
                related.append((sim, k))
        if winner is not None:
            c["supersededBy"] = winner["id"]
            c["similarity"] = round(best, 3)
            winner.setdefault("supersedes", []).append(
                {"id": c["id"], "year": c["year"], "pdfPages": c["pdfPages"], "printedPages": c["printedPages"], "similarity": round(best, 3)}
            )
        else:
            if related:
                related.sort(key=lambda t: -t[0])
                c["relatedVersions"] = [
                    {"id": k["id"], "year": k["year"], "similarity": round(s, 3)} for s, k in related[:3]
                ]
            kept.append(c)
    for c in chunks:
        c.setdefault("supersedes", []) if False else None
    return chunks
