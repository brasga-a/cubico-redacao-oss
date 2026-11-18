#!/usr/bin/env python3
"""Reproducible ingestion of the INEP "Redação no Enem" cartilhas.

    PDF -> extraction -> validation -> normalization -> chunking -> indexing

Usage (from the repository root):

  uv run --with pymupdf --with fonttools python3 scripts/cartilhas/ingest.py run \
      --pdf-dir ../../data --out data/knowledge

  ... ingest.py run --only 2024 --force     # reprocess one edition
  ... ingest.py run --prune                  # drop outputs whose PDF no longer exists
  ... ingest.py verify                       # re-validate stored artifacts, no PDFs needed

The PDFs are only read, never modified. Re-running with unchanged PDFs reuses the stored
extraction and rewrites byte-identical artifacts (no timestamps in committed files).
"""
from __future__ import annotations

import argparse
import hashlib
import json
import re
import sys
import time
import traceback
from pathlib import Path
from typing import Any

sys.path.insert(0, str(Path(__file__).parent))

from glyphs import TABLE_DIR  # noqa: E402
from knowledge import PIPELINE_VERSION, build_document, dedupe  # noqa: E402
from pdftext import extract_document  # noqa: E402
from rubric import CANONICAL_YEAR, build_canonical, build_variants  # noqa: E402

PDF_NAME = re.compile(r"^cartilha_enem_(\d{4})\.pdf$")


# ---------------------------------------------------------------------------------------
# helpers
# ---------------------------------------------------------------------------------------
def dump(path: Path, data: Any, compact: bool = False) -> bool:
    """Writes deterministic JSON. Returns True when the file content changed."""
    if compact:  # runtime bundle: no indentation to keep the Worker small
        text = json.dumps(data, ensure_ascii=False, separators=(",", ":"), sort_keys=True) + "\n"
    else:
        text = json.dumps(data, ensure_ascii=False, indent=1, sort_keys=True) + "\n"
    path.parent.mkdir(parents=True, exist_ok=True)
    if path.exists() and path.read_text(encoding="utf-8") == text:
        return False
    path.write_text(text, encoding="utf-8")
    return True


def load(path: Path) -> Any:
    return json.loads(path.read_text(encoding="utf-8"))


def glyph_table_sha() -> str:
    h = hashlib.sha256()
    for p in sorted(TABLE_DIR.glob("*.json")):
        h.update(p.read_bytes())
    return h.hexdigest()[:16]


def discover_pdfs(pdf_dir: Path) -> dict[int, Path]:
    found: dict[int, Path] = {}
    for p in sorted(pdf_dir.glob("*.pdf")):
        m = PDF_NAME.match(p.name)
        if m:
            found[int(m.group(1))] = p
    return found


# ---------------------------------------------------------------------------------------
# validation
# ---------------------------------------------------------------------------------------
def check(checks: list[dict[str, str]], cid: str, ok: bool, detail: str, severity: str = "error") -> None:
    checks.append({"id": cid, "status": "passed" if ok else ("failed" if severity == "error" else "warning"), "detail": detail})


def validate_document(doc: dict[str, Any], chunks: list[dict[str, Any]]) -> dict[str, Any]:
    checks: list[dict[str, str]] = []
    year = doc["year"]
    rubric = doc["rubric"]
    check(checks, "competencies_I_to_V", sorted(rubric) == sorted(["I", "II", "III", "IV", "V"]), f"encontradas: {sorted(rubric)}")
    for cid in ("I", "II", "III", "IV", "V"):
        scores = [lv["score"] for lv in rubric.get(cid, {}).get("levels", [])]
        check(checks, f"levels_{cid}", scores == [200, 160, 120, 80, 40, 0], f"níveis: {scores}")
        unreadable = [lv["score"] for lv in rubric.get(cid, {}).get("levels", []) if lv["quality"] != "ok"]
        check(checks, f"levels_{cid}_readable", not unreadable, f"níveis ilegíveis na extração: {unreadable}" if unreadable else "todos legíveis", "warning")
    essays = doc["essays"]
    check(checks, "essays_found", len(essays) > 0, f"{len(essays)} redações")
    for e in essays:
        ok = bool(e["author"]) and bool(e["paragraphs"]) and bool(e["commentary"])
        check(checks, f"essay_{e['index']:02d}_paired", ok, f"autoria={bool(e['author'])} parágrafos={len(e['paragraphs'])} comentário={len(e['commentary'])}")
        n_par = len(e["paragraphs"])
        check(checks, f"essay_{e['index']:02d}_paragraph_count", 3 <= n_par <= 6, f"{n_par} parágrafos extraídos (esperado 3-6; confira a quebra de parágrafos)", "warning")
        if e["paragraphs"] and e["commentary"]:
            last_essay_page = max(p["pdfPages"][1] for p in e["paragraphs"])
            first_comment_page = min(p["pdfPages"][0] for p in e["commentary"])
            check(checks, f"essay_{e['index']:02d}_order", first_comment_page >= last_essay_page, f"redação até p.{last_essay_page}, comentário desde p.{first_comment_page}")
    no_prov = [c["id"] for c in chunks if not c.get("pdfPages") or not c.get("docId")]
    check(checks, "provenance_complete", not no_prov, f"{len(no_prov)} chunks sem proveniência")
    check(checks, "theme_found", bool(doc["theme"]), f"tema: {doc['theme']!r}", "warning")
    anomalies = doc["extraction"].get("headerYearAnomalies", [])
    check(checks, "header_year_consistent", not anomalies, f"cabeçalho com ano diferente de {year}: {anomalies}" if anomalies else "ok", "warning")
    partial = [c["id"] for c in chunks if c["quality"] != "ok"]
    check(checks, "partial_chunks_quarantined", True, f"{len(partial)} chunks parciais ficam fora do índice")
    check(checks, "ocr_not_validated", not doc["extraction"]["ocrPages"], f"páginas com OCR (não validado): {doc['extraction']['ocrPages']}" if doc["extraction"]["ocrPages"] else "nenhum OCR", "warning")
    failed = [c for c in checks if c["status"] == "failed"]
    warnings = [c for c in checks if c["status"] == "warning"]
    status = "failed" if failed else ("passed_with_warnings" if warnings else "passed")
    return {"status": status, "failed": len(failed), "warnings": len(warnings), "checks": checks}


def detect_year_identity(extraction: Any, year: int) -> list[str]:
    """Cartilha text must be about its own edition; returns the years found in headers/footers."""
    found: set[int] = set()
    for page in extraction.pages:
        for d in page.dropped:
            for y in re.findall(r"\b(20\d{2})\b", d["text"]):
                found.add(int(y))
    return sorted(str(y) for y in found if y != year)


# ---------------------------------------------------------------------------------------
# pipeline stages
# ---------------------------------------------------------------------------------------
def process_year(year: int, pdf: Path, out: Path, allow_ocr: bool, log: list[str]) -> tuple[dict[str, Any], list[dict[str, Any]]]:
    t0 = time.time()
    extraction = extract_document(pdf, year, allow_ocr=allow_ocr)
    model = build_document(extraction)
    doc = model.json
    doc["extraction"]["headerYearAnomalies"] = detect_year_identity(extraction, year)
    doc["validation"] = validate_document(doc, model.chunks)
    dump(out / "documents" / f"cartilha-{year}.json", doc)
    dump(out / "documents" / f"cartilha-{year}.chunks.json", model.chunks)
    log.append(f"{year}: extraído em {time.time() - t0:.1f}s, validação={doc['validation']['status']}")
    return doc, model.chunks


def assemble(out: Path, docs: dict[int, dict[str, Any]], chunks: list[dict[str, Any]]) -> dict[str, Any]:
    chunks = dedupe(chunks)
    chunks.sort(key=lambda c: (c["year"], c["id"]))
    dump(out / "kb" / "chunks.json", {"schemaVersion": 1, "pipelineVersion": PIPELINE_VERSION, "chunks": chunks})

    indexed = [c for c in chunks if c.get("indexed", True) and c["quality"] == "ok" and "supersededBy" not in c]
    essay_chunks = {c["id"]: c for c in chunks if c["kind"] == "essay"}
    essays: dict[str, Any] = {}
    for c in chunks:
        if c["kind"] != "commentary":
            continue
        e = essay_chunks.get(c["pairedEssayChunkId"])
        if e is not None and e["id"] not in essays:
            essays[e["id"]] = {
                "year": e["year"],
                "examYear": e.get("examYear"),
                "author": e.get("essayAuthor"),
                "scoreDocumented": e.get("scoreDocumented"),
                "theme": e.get("theme"),
                "pdfPages": e["pdfPages"],
                "printedPages": e["printedPages"],
                "excerpt": e["text"][:600],
                "commentChunkIds": e["commentChunkIds"],
                "quality": e["quality"],
            }
    index_fields = (
        "id", "category", "kind", "year", "examYear", "title", "section", "competencies", "competencySource", "theme", "text",
        "pdfPages", "printedPages", "checksum", "essayId", "essayAuthor", "scoreDocumented", "pairedEssayChunkId", "supersedes",
        "relatedVersions",
    )
    index_chunks = [{k: c[k] for k in index_fields if k in c} for c in indexed]
    index = {
        "schemaVersion": 1,
        "pipelineVersion": PIPELINE_VERSION,
        "source": "Inep/MEC — A Redação no Enem (Cartilha do Participante)",
        "documents": [{"id": d["id"], "year": d["year"], "file": d["file"], "sha256": d["sha256"], "theme": d["theme"]} for _y, d in sorted(docs.items())],
        "chunks": index_chunks,
        "essays": essays,
    }
    dump(out / "kb" / "index.json", index, compact=True)
    return {"indexed": len(index_chunks), "total": len(chunks), "essays": len(essays)}


def write_rubric(out: Path, docs: dict[int, dict[str, Any]]) -> dict[str, Any] | None:
    base = docs.get(CANONICAL_YEAR)
    if base is None:
        return None
    canonical = build_canonical(base)
    dump(out / "rubric" / f"canonical-{CANONICAL_YEAR}.json", canonical)
    dump(out / "rubric" / "variants.json", build_variants(docs, canonical))
    return canonical


# ---------------------------------------------------------------------------------------
# report
# ---------------------------------------------------------------------------------------
def build_report(out: Path, docs: dict[int, dict[str, Any]], all_chunks: list[dict[str, Any]], stats: dict[str, Any], run: dict[str, Any]) -> None:
    variants = load(out / "rubric" / "variants.json") if (out / "rubric" / "variants.json").exists() else None
    lines: list[str] = ["# Relatório de ingestão das cartilhas do Inep", ""]
    lines += [
        "Gerado por `scripts/cartilhas/ingest.py`. Este relatório é determinístico (sem datas) para permitir diff entre execuções.",
        "",
        "## Resumo por PDF",
        "",
        "| Ano | Páginas | Redações | Nota documentada | Chunks (ok/parciais) | Indexados | Validação | Avisos |",
        "|---|---|---|---|---|---|---|---|",
    ]
    by_doc: dict[int, list[dict[str, Any]]] = {}
    for c in all_chunks:
        by_doc.setdefault(c["year"], []).append(c)
    for y in sorted(docs):
        d = docs[y]
        cs = by_doc.get(y, [])
        ok = sum(1 for c in cs if c["quality"] == "ok")
        partial = len(cs) - ok
        idx = sum(1 for c in cs if c.get("indexed", True) and c["quality"] == "ok" and "supersededBy" not in c)
        score = d["samples"].get("scoreDocumented")
        lines.append(
            f"| {y} | {d['pageCount']} | {len(d['essays'])} | {score if score is not None else 'não documentada'} | {ok}/{partial} | {idx} | {d['validation']['status']} | {d['validation']['warnings']} |"
        )
    lines += ["", f"Total: {stats['total']} chunks, {stats['indexed']} indexados, {stats['essays']} redações comentadas disponíveis.", ""]
    lines += ["## Conteúdo extraído", "", "Categorias: `orientacao` (A), `redacao_comentada` (B), `exemplo` (C).", ""]
    lines += ["| Ano | Orientações | Exemplos | Redações | Comentários | Tema |", "|---|---|---|---|---|---|"]
    for y in sorted(docs):
        cs = by_doc.get(y, [])
        n = lambda cat, kind=None: sum(1 for c in cs if c["category"] == cat and (kind is None or c["kind"] == kind))  # noqa: E731
        lines.append(f"| {y} | {n('orientacao')} | {n('exemplo')} | {n('redacao_comentada', 'essay')} | {n('redacao_comentada', 'commentary')} | {docs[y]['theme'] or '—'} |")
    lines += ["", "## Revisão manual necessária", ""]
    any_manual = False
    for y in sorted(docs):
        d = docs[y]
        items: list[str] = []
        ex = d["extraction"]
        if ex["ocrPages"]:
            items.append(f"páginas lidas por OCR (`eng`, sem validação; texto não indexado): {ex['ocrPages']}")
        if ex["unrepairableFonts"]:
            items.append(f"fontes sem mapeamento Unicode e sem tabela de referência: {ex['unrepairableFonts']}")
        partial_pages = sorted({p for s in d["sections"] for b in s["blocks"] if b["quality"] != "ok" for p in range(b["pdfPages"][0], b["pdfPages"][1] + 1)})
        if partial_pages:
            items.append(f"páginas de conteúdo com glifos ilegíveis (blocos excluídos do índice): {partial_pages}")
        for e in d["essays"]:
            if any(p["quality"] != "ok" for p in e["paragraphs"] + e["commentary"]):
                items.append(f"redação {e['index']} ({e['author']}) com trechos ilegíveis")
        if ex["reorderedPages"]:
            items.append(f"páginas cuja ordem de leitura foi corrigida pela posição visual (conferir pareamento redação/comentário): {ex['reorderedPages']}")
        if d["problems"]:
            items.append("problemas de estrutura: " + "; ".join(d["problems"]))
        for c in d["validation"]["checks"]:
            if c["status"] != "passed" and c["id"] in ("header_year_consistent", "theme_found"):
                items.append(f"{c['id']}: {c['detail']}")
        if items:
            any_manual = True
            lines += [f"### {y}", ""] + [f"- {i}" for i in items] + [""]
    if not any_manual:
        lines += ["Nenhum item.", ""]
    if variants:
        lines += ["## Rubrica canônica e variações entre edições", "", f"Baseline: {variants['baselineYear']}.", "", "| Ano | níveis idênticos | níveis só redação | níveis alterados | níveis ilegíveis | regras de anulação idênticas/redação | anulação fora do baseline | baseline ausente |", "|---|---|---|---|---|---|---|---|"]
        for y, e in variants["editions"].items():
            s = e["levelSummary"]
            op = e["operationalRules"]["annulment"]
            lines.append(f"| {y} | {s.get('identical', 0)} | {s.get('wording_only', 0)} | {s.get('changed', 0)} | {s.get('unreadable_in_source_extraction', 0)} | {op['identical']}/{op['wordingOnly']} | {len(op['notInBaseline'])} | {len(op['baselineItemsMissing'])} |")
        lines += ["", "Níveis `unreadable_in_source_extraction` não puderam ser comparados: a extração do PDF dessa edição está ilegível nesse trecho e não foi adivinhada.", ""]
    lines += ["## Pendências de infraestrutura", "", "- Nenhuma operação Cloudflare foi executada: a base é empacotada com o Worker como JSON estático (sem D1/Vectorize/Workers AI novos).", "- OCR com idioma português (`por`) não está instalado; o OCR usa `eng`, portanto nunca é indexado.", "- Fontes Arial (2024/2025) sem arquivo de referência: as linhas afetadas ficam fora do índice. Para recuperá-las, gere uma tabela com `build_glyph_table.py --fonts-dir <pasta com Arial TTF licenciado>`.", ""]
    (out / "report.md").write_text("\n".join(lines), encoding="utf-8")
    dump(out / "report.json", {"documents": {str(y): {"validation": d["validation"], "pageCount": d["pageCount"], "essays": len(d["essays"]), "theme": d["theme"]} for y, d in sorted(docs.items())}, "stats": stats, "pipelineVersion": PIPELINE_VERSION})
    run_log = out / ".last-run.json"
    run_log.write_text(json.dumps(run, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")


# ---------------------------------------------------------------------------------------
# commands
# ---------------------------------------------------------------------------------------
def cmd_run(args: argparse.Namespace) -> int:
    out = Path(args.out)
    pdf_dir = Path(args.pdf_dir)
    manifest_path = out / "manifest.json"
    manifest: dict[str, Any] = load(manifest_path) if manifest_path.exists() else {"documents": {}}
    gsha = glyph_table_sha()
    reusable_pipeline = manifest.get("pipelineVersion") == PIPELINE_VERSION and manifest.get("glyphTable") == gsha
    pdfs = discover_pdfs(pdf_dir) if pdf_dir.exists() else {}
    if not pdfs:
        print(f"nenhum cartilha_enem_AAAA.pdf em {pdf_dir}; usando apenas artefatos já gerados", file=sys.stderr)
    only = {int(y) for y in args.only} if args.only else None
    log: list[str] = []
    statuses: dict[int, str] = {}
    failures: list[str] = []
    for year, pdf in sorted(pdfs.items()):
        if only and year not in only:
            continue
        sha = hashlib.sha256(pdf.read_bytes()).hexdigest()
        entry = manifest["documents"].get(str(year))
        stored = out / "documents" / f"cartilha-{year}.json"
        if not args.force and reusable_pipeline and entry and entry["sha256"] == sha and stored.exists() and (out / "documents" / f"cartilha-{year}.chunks.json").exists():
            statuses[year] = "inalterado"
            log.append(f"{year}: PDF inalterado (sha256 {sha[:12]}), extração reutilizada")
            continue
        try:
            doc, _chunks = process_year(year, pdf, out, not args.no_ocr, log)
            statuses[year] = "reprocessado" if entry else "novo"
            manifest["documents"][str(year)] = {"file": pdf.name, "sha256": sha}
        except Exception as exc:  # per-document failure must not hide the other documents
            failures.append(f"{year}: {exc!r}")
            log.append(f"{year}: FALHA {exc!r}\n{traceback.format_exc()}")
            statuses[year] = "falhou"
    # obsolete outputs: documents whose PDF is gone
    stored_years = sorted(int(m.group(1)) for p in (out / "documents").glob("cartilha-*.json") if (m := re.match(r"cartilha-(\d{4})\.json$", p.name)))
    for year in stored_years:
        if year not in pdfs and not (only and year not in only):
            if args.prune:
                for suffix in (".json", ".chunks.json"):
                    (out / "documents" / f"cartilha-{year}{suffix}").unlink(missing_ok=True)
                manifest["documents"].pop(str(year), None)
                statuses[year] = "removido (PDF ausente)"
                log.append(f"{year}: PDF ausente, saídas removidas (--prune)")
            else:
                statuses.setdefault(year, "PDF ausente (artefatos mantidos)")
    stored_years = sorted(int(m.group(1)) for p in (out / "documents").glob("cartilha-*.json") if (m := re.match(r"cartilha-(\d{4})\.json$", p.name)))
    docs = {y: load(out / "documents" / f"cartilha-{y}.json") for y in stored_years}
    chunks: list[dict[str, Any]] = []
    for y in stored_years:
        chunks += load(out / "documents" / f"cartilha-{y}.chunks.json")
    stats = assemble(out, docs, chunks)
    write_rubric(out, docs)
    manifest["pipelineVersion"] = PIPELINE_VERSION
    manifest["glyphTable"] = gsha
    manifest["documents"] = {k: v for k, v in sorted(manifest["documents"].items()) if int(k) in docs}
    dump(manifest_path, manifest)
    kb_chunks = load(out / "kb" / "chunks.json")["chunks"]
    build_report(out, docs, kb_chunks, stats, {"status": {str(k): v for k, v in sorted(statuses.items())}, "log": log, "failures": failures})
    for line in log:
        print(line)
    print("situação:", {y: s for y, s in sorted(statuses.items())})
    print(f"chunks: {stats['total']} (indexados {stats['indexed']}); relatório: {out / 'report.md'}")
    bad = [y for y, d in docs.items() if d["validation"]["status"] == "failed"]
    if bad or failures:
        print(f"VALIDAÇÃO FALHOU em {bad} {failures}", file=sys.stderr)
        return 1
    return 0


def cmd_verify(args: argparse.Namespace) -> int:
    out = Path(args.out)
    rc = 0
    for p in sorted((out / "documents").glob("cartilha-????.json")):
        doc = load(p)
        chunks = load(out / "documents" / p.name.replace(".json", ".chunks.json"))
        v = validate_document(doc, chunks)
        print(p.name, v["status"], f"avisos={v['warnings']}")
        if v["status"] == "failed":
            rc = 1
    return rc


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)
    run = sub.add_parser("run")
    run.add_argument("--pdf-dir", default="../../data")
    run.add_argument("--out", default="data/knowledge")
    run.add_argument("--only", nargs="*")
    run.add_argument("--force", action="store_true")
    run.add_argument("--prune", action="store_true")
    run.add_argument("--no-ocr", action="store_true")
    run.set_defaults(fn=cmd_run)
    ver = sub.add_parser("verify")
    ver.add_argument("--out", default="data/knowledge")
    ver.set_defaults(fn=cmd_verify)
    args = ap.parse_args()
    return args.fn(args)


if __name__ == "__main__":
    raise SystemExit(main())
