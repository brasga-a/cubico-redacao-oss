"""Tests for the cartilha ingestion pipeline.

Run from the repository root:
  uv run --with pymupdf --with fonttools python3 -m unittest discover -s scripts/cartilhas/tests -v

Tests that need the real PDFs are skipped when they are not available (the PDFs are not in
the repository). Set CARTILHAS_DIR to point at them; the default is ../../data (workspace root).
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import shutil
import sys
import tempfile
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent))

import ingest  # noqa: E402
from glyphs import UNRESOLVED, _to_unicode_cmap, load_reference_table  # noqa: E402
from knowledge import checksum, dedupe, derive_competencies  # noqa: E402
from pdftext import extract_document, is_bad_text, ocr_needed  # noqa: E402
from structure import Block, Section, parse_levels, squash  # noqa: E402

REPO = HERE.parents[2]
PDF_DIR = Path(os.environ.get("CARTILHAS_DIR", REPO.parents[1] / "data"))
NEEDS_PDFS = unittest.skipUnless((PDF_DIR / "cartilha_enem_2026.pdf").exists(), "PDFs não disponíveis")


def block(kind: str, text: str, page: int = 1) -> Block:
    return Block(kind, text, page, page, str(page), str(page), 11.0, kind in ("heading", "level"))


class UnitTests(unittest.TestCase):
    def test_bad_text_detection_flags_unreadable_glyphs(self) -> None:
        self.assertFalse(is_bad_text("A proposta de intervenção respeita os direitos humanos."))
        self.assertTrue(is_bad_text("Demonstra " + UNRESOLVED + " domínio"))
        self.assertTrue(is_bad_text("\x14 /*-\x01"))
        self.assertTrue(is_bad_text("ѹѷѹѻ"))

    def test_ocr_is_a_last_resort(self) -> None:
        self.assertFalse(ocr_needed(text_chars=1800, image_area_ratio=0.9))
        self.assertFalse(ocr_needed(text_chars=0, image_area_ratio=0.05))
        self.assertTrue(ocr_needed(text_chars=0, image_area_ratio=0.64))

    def test_competency_derivation_is_labelled(self) -> None:
        self.assertEqual(derive_competencies("qualquer texto", "II"), (["II"], "section"))
        comps, src = derive_competencies("A proposta de intervenção apresenta agente, ação e direitos humanos.")
        self.assertIn("V", comps)
        self.assertEqual(src, "keyword_rule")
        comps, src = derive_competencies("Texto sem relação com nenhum critério.")
        self.assertEqual((comps, src), ([], "none"))

    def test_checksum_ignores_formatting(self) -> None:
        self.assertEqual(checksum("Coesão — textual,  é!"), checksum("coesao textual e"))

    def test_levels_require_all_six_and_report_gaps(self) -> None:
        full = Section("competencia", "I", "1.1 COMPETÊNCIA I")
        for score in (200, 160, 120, 80, 40):
            full.blocks += [block("level", f"{score} pontos"), block("para", f"descritor {score}")]
        full.blocks += [block("level", "0 ponto"), block("para", "descritor 0")]
        levels, problems = parse_levels(full)
        self.assertEqual([lv.score for lv in levels], [200, 160, 120, 80, 40, 0])
        self.assertEqual(problems, [])

        broken = Section("competencia", "I", "1.1")
        broken.blocks = [block("level", "200 pontos"), block("para", "x"), block("level", "160 pontos")]
        levels, problems = parse_levels(broken)
        self.assertTrue(any("ausentes" in p for p in problems))
        self.assertTrue(any("sem descritor" in p for p in problems))

    def test_dedupe_keeps_newest_equivalent_and_preserves_older_provenance(self) -> None:
        def chunk(year: int, cid: str, text: str, category: str = "orientacao", quality: str = "ok") -> dict:
            return {"id": cid, "year": year, "category": category, "kind": "guidance", "competencies": ["IV"],
                    "text": text, "checksum": checksum(text), "quality": quality, "pdfPages": [year % 100, year % 100], "printedPages": None}

        same = "A coesão textual é construída pelo uso de operadores argumentativos que estabelecem relações lógicas entre as ideias do texto."
        changed = "A coesão textual exige operadores argumentativos adequados. Em 2026 a cartilha acrescenta orientações novas sobre referenciação, retomada por pronomes e uso de sinônimos."
        chunks = [
            chunk(2018, "2018.a", same),
            chunk(2026, "2026.a", same + "."),
            chunk(2019, "2019.b", changed.replace("2026", "2019")),
            chunk(2026, "2026.b", changed),
            chunk(2024, "2024.p", same, quality="partial"),
            chunk(2018, "2018.essay", same, category="redacao_comentada"),
        ]
        dedupe(chunks)
        by_id = {c["id"]: c for c in chunks}
        self.assertEqual(by_id["2018.a"]["supersededBy"], "2026.a")
        self.assertEqual(by_id["2026.a"]["supersedes"][0]["year"], 2018)
        self.assertNotIn("supersededBy", by_id["2026.a"])
        # a pedagogically different version stays distinguishable
        self.assertNotIn("supersededBy", by_id["2019.b"])
        # partial and editorial (essay) chunks are never folded
        self.assertNotIn("supersededBy", by_id["2024.p"])
        self.assertNotIn("supersededBy", by_id["2018.essay"])

    def test_glyph_table_and_cmap(self) -> None:
        table = load_reference_table()
        self.assertGreater(len(table), 1000)
        self.assertTrue({"a", "ç", "ã", "é", "Ç"}.issubset(set(table.values())))
        cmap = _to_unicode_cmap({1: " ", 28: "a", 300: "fi"}).decode("ascii")
        self.assertIn("beginbfchar", cmap)
        self.assertIn("<001C> <0061>", cmap)
        self.assertIn("<012C> <00660069>", cmap)

    def test_squash_is_tolerant_to_accents_and_spacing(self) -> None:
        self.assertEqual(squash("1.1 COMPETÊNCIA  II"), "11COMPETENCIAII")


@NEEDS_PDFS
class PdfTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.extractions = {y: extract_document(PDF_DIR / f"cartilha_enem_{y}.pdf", y, allow_ocr=False) for y in (2019, 2023, 2024, 2026)}

    def test_source_pdfs_are_never_modified(self) -> None:
        path = PDF_DIR / "cartilha_enem_2024.pdf"
        before = hashlib.sha256(path.read_bytes()).hexdigest()
        extract_document(path, 2024, allow_ocr=False)
        self.assertEqual(before, hashlib.sha256(path.read_bytes()).hexdigest())

    def test_broken_fonts_are_recovered_without_guessing(self) -> None:
        text = "\n".join(line.text for line in self.extractions[2024].page_by_number(20).lines)
        self.assertIn("No Enem 2023, foi configurado como tangenciamento ao tema", text)
        self.assertIn("sobrecarga a ele associada", text)
        self.assertEqual([l.text for l in self.extractions[2024].page_by_number(20).lines if l.bad], [])
        self.assertTrue(self.extractions[2024].repaired_fonts)

    def test_unrecoverable_text_is_flagged_not_validated(self) -> None:
        # 2024 page 18 uses an Arial subset without reference outlines
        page = self.extractions[2024].page_by_number(18)
        self.assertEqual(page.status, "degraded")
        self.assertTrue(any(l.bad for l in page.lines))

    def test_running_headers_removed_and_printed_page_kept(self) -> None:
        page = self.extractions[2026].page_by_number(44)
        self.assertEqual(page.printed, "42")
        self.assertTrue(any(d["reason"] == "running_header_footer" for d in page.dropped))
        self.assertFalse(any("CARTILHA DO PARTICIPANTE" in l.text for l in page.lines))

    def test_stream_order_is_corrected_so_comments_follow_their_essay(self) -> None:
        # 2023 emits the commentary before the essay in the content stream
        from knowledge import build_document

        doc = build_document(self.extractions[2023]).json
        first = doc["essays"][0]
        self.assertEqual(first["author"], "NICOLE CARVALHO ALMEIDA")
        self.assertIn("No Brasil, o Artigo 1º", first["paragraphs"][0]["text"])
        self.assertIn("A participante demonstra excelente domínio", first["commentary"][0]["text"])
        self.assertIn(28, doc["extraction"]["reorderedPages"])

    def test_2026_structure_and_provenance(self) -> None:
        from knowledge import build_document

        model = build_document(self.extractions[2026])
        doc = model.json
        self.assertEqual(sorted(doc["rubric"]), ["I", "II", "III", "IV", "V"])
        for comp in doc["rubric"].values():
            self.assertEqual([lv["score"] for lv in comp["levels"]], [200, 160, 120, 80, 40, 0])
        self.assertEqual(len(doc["essays"]), 10)
        self.assertIsNone(doc["samples"]["scoreDocumented"])  # recent samples are not assumed to be 1000
        for chunk in model.chunks:
            self.assertEqual(len(chunk["pdfPages"]), 2)
            self.assertEqual(chunk["docId"], "cartilha-2026")
            self.assertEqual(len(chunk["checksum"]), 16)

    def test_2019_scores_are_documented_by_the_cartilha(self) -> None:
        from knowledge import build_document

        doc = build_document(self.extractions[2019]).json
        self.assertEqual(doc["samples"]["scoreDocumented"], 1000)
        self.assertEqual(doc["samples"]["examYear"], 2018)
        self.assertIn("Manipulação do comportamento do usuário", doc["theme"])


@NEEDS_PDFS
class IngestionTests(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp = Path(tempfile.mkdtemp())
        self.pdfs = self.tmp / "pdfs"
        self.pdfs.mkdir()
        os.symlink(PDF_DIR / "cartilha_enem_2019.pdf", self.pdfs / "cartilha_enem_2019.pdf")
        self.out = self.tmp / "out"

    def tearDown(self) -> None:
        shutil.rmtree(self.tmp, ignore_errors=True)

    def args(self, **kw: object) -> argparse.Namespace:
        base = dict(pdf_dir=str(self.pdfs), out=str(self.out), only=None, force=False, prune=False, no_ocr=True)
        base.update(kw)
        return argparse.Namespace(**base)

    def snapshot(self) -> dict[str, str]:
        return {
            str(p.relative_to(self.out)): hashlib.sha256(p.read_bytes()).hexdigest()
            for p in sorted(self.out.rglob("*"))
            if p.is_file() and p.name != ".last-run.json"
        }

    def status(self) -> dict[str, str]:
        return json.loads((self.out / ".last-run.json").read_text())["status"]

    def test_rerun_is_incremental_and_idempotent(self) -> None:
        self.assertEqual(ingest.cmd_run(self.args()), 0)
        self.assertEqual(self.status(), {"2019": "novo"})
        first = self.snapshot()
        self.assertEqual(ingest.cmd_run(self.args()), 0)
        self.assertEqual(self.status(), {"2019": "inalterado"})
        self.assertEqual(self.snapshot(), first)
        self.assertEqual(ingest.cmd_run(self.args(force=True)), 0)
        self.assertEqual(self.status(), {"2019": "reprocessado"})
        self.assertEqual(self.snapshot(), first)  # byte-identical: no duplicated entries

    def test_modified_pdf_is_reprocessed(self) -> None:
        ingest.cmd_run(self.args())
        manifest_path = self.out / "manifest.json"
        manifest = json.loads(manifest_path.read_text())
        manifest["documents"]["2019"]["sha256"] = "0" * 64  # pretend the stored hash is from an older file
        manifest_path.write_text(json.dumps(manifest))
        ingest.cmd_run(self.args())
        self.assertEqual(self.status(), {"2019": "reprocessado"})

    def test_obsolete_entries_are_kept_by_default_and_removed_with_prune(self) -> None:
        ingest.cmd_run(self.args())
        docs = self.out / "documents"
        for suffix in (".json", ".chunks.json"):  # fake an edition whose PDF disappeared
            shutil.copy(docs / f"cartilha-2019{suffix}", docs / f"cartilha-2018{suffix}")
        ingest.cmd_run(self.args())
        self.assertTrue((docs / "cartilha-2018.json").exists())
        self.assertIn("PDF ausente", self.status()["2018"])
        ingest.cmd_run(self.args(prune=True))
        self.assertFalse((docs / "cartilha-2018.json").exists())
        index = json.loads((self.out / "kb" / "index.json").read_text())
        self.assertEqual({d["year"] for d in index["documents"]}, {2019})

    def test_failure_is_reported_per_document(self) -> None:
        broken = self.pdfs / "cartilha_enem_2018.pdf"
        broken.write_bytes(b"%PDF-1.4 not really a pdf")
        rc = ingest.cmd_run(self.args())
        self.assertEqual(rc, 1)
        self.assertEqual(self.status()["2018"], "falhou")
        self.assertEqual(self.status()["2019"], "novo")  # the good document is still processed

    def test_stored_artifacts_never_contain_unreadable_glyphs(self) -> None:
        ingest.cmd_run(self.args())
        index = json.loads((self.out / "kb" / "index.json").read_text())
        for chunk in index["chunks"]:
            self.assertFalse(is_bad_text(chunk["text"].replace("\n", " ")), chunk["id"])


if __name__ == "__main__":
    unittest.main()
