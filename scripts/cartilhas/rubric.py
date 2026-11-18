"""Canonical rubric (2026 baseline) and per-edition variants.

The canonical rubric holds INEP's own wording only: competency titles, the six level
descriptors, the official ATENÇÃO notes and the operational rules (annulment,
discrepancy). Every entry keeps its page provenance. Pedagogical explanations and the
commented essays live in the knowledge base, never here.

Rules that change between editions are not merged into the canonical matrix: they are
compared against the baseline and reported in the variants file.
"""
from __future__ import annotations

import re
from difflib import SequenceMatcher
from typing import Any

from knowledge import squash_keep_spaces
from structure import squash

CANONICAL_YEAR = 2026
SCORES = (0, 40, 80, 120, 160, 200)
_ROMAN_ORDER = ("I", "II", "III", "IV", "V")


def _source(doc: dict[str, Any], span: dict[str, Any]) -> dict[str, Any]:
    return {
        "docId": doc["id"],
        "year": doc["year"],
        "file": doc["file"],
        "pdfPages": span.get("pdfPages"),
        "printedPages": span.get("printedPages"),
    }


def _applies_to(text: str) -> list[str]:
    """Competencies named in an official sentence ("Competências II, III e V")."""
    found: list[str] = []
    for m in re.finditer(r"Compet[eê]ncias?\s+((?:I{1,3}|IV|V)(?:\s*(?:,|e)\s*(?:I{1,3}|IV|V))*)", text):
        for tok in re.findall(r"I{1,3}|IV|V", m.group(1)):
            if tok not in found:
                found.append(tok)
    return found


def _structured_rule(text: str) -> dict[str, Any] | None:
    """Deterministic reading of the explicit scoring effects in the official wording."""
    t = squash_keep_spaces(text)
    if "tangenciamento" in t and "impedindo" in t and re.search(r"nota acima de 40 pontos", t):
        return {"effect": "cap", "maxScore": 40, "appliesTo": _applies_to(text) or ["II", "III", "V"], "trigger": "tangenciamento_ao_tema"}
    if ("fuga ao tema" in t or "fuga total" in t) and "nota final" in t and re.search(r"\b0 zero\b|\b0\b", t) and "nao sera avaliada" in t:
        return {"effect": "total_zero", "maxScore": 0, "appliesTo": list(_ROMAN_ORDER), "trigger": "fuga_ao_tema_ou_tipo_textual"}
    if "predominancia de caracteristicas de outro tipo textual" in t and "nota 0" in t:
        return {"effect": "total_zero", "maxScore": 0, "appliesTo": list(_ROMAN_ORDER), "trigger": "predominancia_outro_tipo_textual"}
    if "desrespeitem os direitos humanos" in t and "nota 0" in t:
        return {"effect": "competency_zero", "maxScore": 0, "appliesTo": ["V"], "trigger": "desrespeito_direitos_humanos"}
    return None


def operational_rules(doc: dict[str, Any]) -> dict[str, list[dict[str, Any]]]:
    """Annulment and discrepancy bullets, grouped by the question heading that introduces them.

    A group ends at the first heading that is not a wrapped continuation of the group's own
    question (e.g. ATENÇÃO boxes and the next FAQ question), so advice bullets that follow
    the official list are never mistaken for rules.
    """
    groups: dict[str, list[dict[str, Any]]] = {"annulment": [], "discrepancy": []}

    def heading_group(key: str) -> str | None:
        if "RAZOESPARASEATRIBUIRNOTA0" in key or "RAZOESPARASEATRIBUIRNOTAZERO" in key:
            return "annulment"
        if "DISCREPANCIA" in key:
            return "discrepancy"
        return None

    for sec in doc["sections"]:
        if sec["key"] != "apresentacao":
            continue
        current: str | None = None
        prev_heading_matched = False
        for blk in sec["blocks"]:
            if blk["kind"] == "heading":
                key = squash(blk["text"])
                matched = heading_group(key)
                if matched:
                    current = matched
                    prev_heading_matched = True
                elif prev_heading_matched and blk["text"].rstrip().endswith("?") and len(blk["text"]) < 40:
                    pass  # wrapped tail of the same question ("A UMA REDAÇÃO?")
                else:
                    current = None
                    prev_heading_matched = False
                continue
            prev_heading_matched = False
            if blk["kind"] == "para" and re.match(r"(ATEN[CÇ][AÃ]O|IMPORTANTE)\b", blk["text"].strip(), re.I):
                current = None  # warning boxes open a different list (advice, not rules)
                continue
            if current and blk["kind"] == "bullet" and blk["quality"] == "ok":
                text = re.sub(r"^[•◦·\-–—]+\s*", "", blk["text"]).strip()
                groups[current].append({"text": text, "pdfPages": blk["pdfPages"], "printedPages": blk["printedPages"]})
    return groups


def build_canonical(doc: dict[str, Any]) -> dict[str, Any]:
    """Canonical rubric from the 2026 edition document model."""
    competencies = []
    notes_total = 0
    for cid in _ROMAN_ORDER:
        comp = doc["rubric"].get(cid)
        if comp is None:
            continue
        sec = next((s for s in doc["sections"] if s["key"] == "competencia" and s["competency"] == cid), None)
        notes = []
        if sec:
            for blk in sec["blocks"]:
                if squash(blk["text"]).startswith("ATENCAO") and blk["kind"] != "heading" and blk["quality"] == "ok":
                    rule = _structured_rule(blk["text"])
                    notes.append(
                        {
                            "text": blk["text"],
                            "source": _source(doc, blk),
                            "structured": rule,
                        }
                    )
        notes_total += len(notes)
        competencies.append(
            {
                "id": cid,
                "heading": comp["heading"],
                "officialTitle": comp["officialTitle"],
                "levels": [
                    {
                        "score": lv["score"],
                        "descriptor": lv["text"],
                        "quality": lv["quality"],
                        "source": _source(doc, {"pdfPages": lv["pdfPages"], "printedPages": [lv["printedPage"], lv["printedPage"]] if lv["printedPage"] else None}),
                    }
                    for lv in comp["levels"]
                ],
                "notes": notes,
            }
        )
    ops = operational_rules(doc)
    rules: list[dict[str, Any]] = []
    for kind in ("annulment", "discrepancy"):
        for i, item in enumerate(ops[kind], 1):
            rules.append({"id": f"{kind}.{i:02d}", "kind": kind, "text": item["text"], "source": _source(doc, item)})
    for comp in competencies:
        for j, note in enumerate(comp["notes"], 1):
            if note["structured"]:
                rules.append(
                    {
                        "id": f"cap.{comp['id']}.{j:02d}",
                        "kind": "score_effect",
                        "text": note["text"],
                        "source": note["source"],
                        "structured": note["structured"],
                    }
                )
    return {
        "schemaVersion": 1,
        "canonicalYear": CANONICAL_YEAR,
        "origin": "inep_verbatim",
        "reviewStatus": "auto_validated",
        "reviewNote": "Descritores extraídos do PDF e conferidos por testes automáticos; sem revisão pedagógica humana independente.",
        "scale": {"competencyScores": list(SCORES), "totalRange": [0, 1000], "competencies": list(_ROMAN_ORDER)},
        "document": {"id": doc["id"], "file": doc["file"], "sha256": doc["sha256"], "year": doc["year"]},
        "competencies": competencies,
        "rules": rules,
    }


def _similarity(a: str, b: str) -> float:
    return SequenceMatcher(None, squash_keep_spaces(a), squash_keep_spaces(b)).ratio()


def build_variants(docs: dict[int, dict[str, Any]], canonical: dict[str, Any]) -> dict[str, Any]:
    """Compares every edition with the canonical baseline without altering the baseline."""
    base_levels = {(c["id"], lv["score"]): lv["descriptor"] for c in canonical["competencies"] for lv in c["levels"]}
    out: dict[str, Any] = {"schemaVersion": 1, "baselineYear": canonical["canonicalYear"], "editions": {}}
    for year in sorted(docs):
        doc = docs[year]
        levels: list[dict[str, Any]] = []
        for cid in _ROMAN_ORDER:
            comp = doc["rubric"].get(cid)
            for lv in (comp or {}).get("levels", []):
                base = base_levels.get((cid, lv["score"]))
                if lv["quality"] != "ok":
                    status, sim = "unreadable_in_source_extraction", None
                elif base is None:
                    status, sim = "no_baseline", None
                else:
                    sim = round(_similarity(lv["text"], base), 3)
                    status = "identical" if sim == 1.0 else ("wording_only" if sim >= 0.9 else "changed")
                levels.append(
                    {
                        "competency": cid,
                        "score": lv["score"],
                        "status": status,
                        "similarity": sim,
                        "pdfPages": lv["pdfPages"],
                        **({"text": lv["text"]} if status in ("changed", "wording_only") else {}),
                    }
                )
        ops = operational_rules(doc)
        op_diff: dict[str, Any] = {}
        for kind in ("annulment", "discrepancy"):
            base_items = [r["text"] for r in canonical["rules"] if r["kind"] == kind]
            cur_items = [r["text"] for r in ops[kind]]
            matched_base: set[int] = set()
            identical = wording = 0
            not_in_baseline: list[str] = []
            for text in cur_items:
                scored = [(_similarity(text, b), i) for i, b in enumerate(base_items)]
                sim, idx = max(scored, default=(0.0, -1))
                if sim >= 0.999:
                    identical += 1
                    matched_base.add(idx)
                elif sim >= 0.7:
                    wording += 1
                    matched_base.add(idx)
                else:
                    not_in_baseline.append(text)
            missing = [b for i, b in enumerate(base_items) if i not in matched_base]
            op_diff[kind] = {
                "count": len(cur_items),
                "identical": identical,
                "wordingOnly": wording,
                "notInBaseline": not_in_baseline,
                "baselineItemsMissing": missing,
            }
        counts: dict[str, int] = {}
        for lv in levels:
            counts[lv["status"]] = counts.get(lv["status"], 0) + 1
        out["editions"][str(year)] = {"levelSummary": counts, "levels": levels, "operationalRules": op_diff}
    return out
