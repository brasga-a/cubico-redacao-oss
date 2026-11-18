# Base de conhecimento das cartilhas do Inep (2018–2026)

Pipeline reproduzível que transforma as cartilhas oficiais de redação do ENEM em (1) uma **rubrica canônica estruturada** e (2) uma **base de evidências pedagógicas** recuperável pelo corretor. A rubrica é independente da recuperação; a recuperação nunca define a nota.

```
PDF → extração → validação → normalização → chunking → indexação
```

## Como executar

Pré-requisitos: `uv` (instala `pymupdf` e `fonttools` sob demanda). Os PDFs **não** ficam no repositório: por padrão são lidos de `../../data/cartilha_enem_AAAA.pdf` (`--pdf-dir` para outro local). Nenhum PDF é alterado.

```fish
bun run kb:ingest                       # processa todos os PDFs encontrados
uv run --with pymupdf --with fonttools python3 scripts/cartilhas/ingest.py run --only 2024 --force
uv run --with pymupdf --with fonttools python3 scripts/cartilhas/ingest.py run --prune   # remove saídas de PDFs que sumiram
bun run kb:verify                       # revalida os artefatos já gerados (sem PDFs)
bun run kb:test                         # testes do pipeline (Python); os que usam PDFs são pulados se ausentes
bun test                                # testes de artefatos, índice, recuperação e rubrica
```

Atualizar uma edição: coloque o novo `cartilha_enem_AAAA.pdf` em `../../data` e rode `bun run kb:ingest`. Só PDFs com SHA-256 diferente do `manifest.json` (ou com `--force`, ou com a tabela de glifos/versão do pipeline alterada) são reprocessados; as demais edições reutilizam a extração guardada. Reexecutar sem mudanças gera arquivos **byte a byte idênticos** (verificado por teste). Uma falha em um PDF não interrompe os demais: é registrada por documento e o comando termina com código 1.

Edição inexistente em `data/` (hoje, 2021) simplesmente não aparece; nada é inventado.

## Artefatos (`data/knowledge/`, versionados)

| Arquivo | Conteúdo |
|---|---|
| `documents/cartilha-AAAA.json` | Modelo normalizado da edição: seções e blocos com página PDF e página impressa, descritores por competência, redações, comentários, status de qualidade por bloco e resultado da validação. |
| `documents/cartilha-AAAA.chunks.json` | Chunks antes da deduplicação (permitem reindexar sem os PDFs). |
| `kb/chunks.json` | Todos os chunks, inclusive os substituídos (`supersededBy`) e os parciais em quarentena. |
| `kb/index.json` | Índice de runtime (só chunks válidos, não duplicados). É o único arquivo importado pelo Worker (~0,9 MB, ~0,2 MB gzip). |
| `rubric/canonical-2026.json` | Rubrica canônica. |
| `rubric/variants.json` | Comparação de cada edição com a canônica. |
| `manifest.json`, `report.md`, `report.json` | SHA-256 dos PDFs, versão do pipeline e relatório (sem datas, para permitir `git diff`). |

Não há embeddings: nada derivado pesado é versionado. O log de execução com tempos fica em `data/knowledge/.last-run.json` (ignorado pelo git). `scripts/cartilhas/__pycache__` também.

## Extração

Texto nativo sempre que existe; OCR só em página sem texto nativo e com imagem grande, e nunca é indexado (o Tesseract local só tem `eng`).

- **Cabeçalhos e rodapés** removidos por repetição entre páginas (não por coordenadas fixas); as linhas removidas ficam registradas em cada página.
- **Página impressa** = página cuja numeração concorda com o deslocamento PDF→impressa estimado no documento inteiro (hoje sempre −2). Um número solto no rodapé que não concorda (ex.: o "19" de "Covid-19") permanece como conteúdo.
- **Ordem de leitura**: o fluxo de conteúdo de alguns PDFs (2023) emite o comentário *antes* da redação. Se blocos de largura total contradizem a ordem visual, a página é reordenada pela posição; essas páginas aparecem no relatório para conferência. Há teste garantindo o pareamento correto.
- **Fontes quebradas (2023, 2024, 2025)**: 30–50 % do texto dessas edições saía como mojibake (fontes Source Sans Pro `Identity-H` sem `ToUnicode`). Os subsets mantêm os contornos originais dos glifos, então cada glifo é identificado pelo hash do contorno contra a fonte original da Adobe (OFL) — sem OCR e sem adivinhar. A tabela (`scripts/cartilhas/glyph_tables/`) é versionada; `build_glyph_table.py` a gera. O reparo acontece só em memória.
- **O que não foi recuperável**: fontes Arial `Identity-H` de 2024/2025 (referências, alguns descritores de nível, partes de redações). Sem fonte de referência, essas linhas ficam sinalizadas (`partial`), **fora do índice**, e listadas no relatório. Para recuperá-las: `build_glyph_table.py --fonts-dir <pasta com Arial TTF licenciado>`.
- Parágrafos: recuo de primeira linha (medido contra a linha anterior), marcador de lista e espaçamento; continuações de lista e de página são unidas.

## Rubrica canônica

2026 é a versão canônica (verificada contra o PDF). Contém só texto do Inep: título oficial de cada competência, os seis descritores (0/40/80/120/160/200) com página, as notas "ATENÇÃO!" e as regras operacionais (10 condições de anulação, 4 itens de discrepância). Os efeitos explícitos sobre a nota são lidos de forma determinística:

| Regra (fonte: página do PDF 2026) | Efeito |
|---|---|
| Tangenciamento ao tema (p. 27) | Competências II, III e V ≤ 40 |
| Fuga ao tema / não atendimento ao tipo textual (p. 29) | Todas as competências e a nota final = 0 |
| Predominância de outro tipo textual (p. 28) | Todas = 0 |
| Desrespeito aos direitos humanos (p. 40) | Competência V = 0 |

`src/server/rubric.server.ts` expõe a rubrica (validada com Zod) e `applyScoreCeilings`, função pura que aplica esses efeitos e nunca aumenta nota. **Ela ainda não está ligada ao corretor**: o contrato de resposta atual não traz um sinal de tangenciamento/direitos humanos, e adicioná-lo muda o contrato (fora do escopo). Hoje continua valendo `validateCorrection` (nota 0 quando a anulação textual é marcada).

As variações entre edições ficam em `variants.json`, sem contaminar a base. Resultado: dos 30 descritores (5 competências × 6 níveis), **nenhum mudou de forma substantiva em 2018–2026** (apenas 1–2 por edição com ajuste de redação; 2 por edição em 2024/2025 ilegíveis na extração). As regras operacionais de anulação variam entre edições (ex.: "extensão de até 7 linhas" em 2018 vs. "7 manuscritas, ou 10 digitadas" em 2026); cada diferença está em `variants.json` e resumida no relatório.

**Conferência do runtime**: o corretor ainda usa `data/rubric-2026.json` (anterior a este trabalho). Os 30 descritores e os 5 títulos desse arquivo são **idênticos** ao canônico (teste `descriptors used by the corrector prompt match…`). Os campos `summary`, `evaluatedAspects` e `recommendations` desse arquivo foram escritos à mão no script antigo, não são texto do Inep, e `reviewed: true` não é uma auditoria pedagógica. Não foi alterado: trocar a rubrica do prompt é decisão de produto.

## Base de conhecimento

| Categoria | Origem | Chunking |
|---|---|---|
| `orientacao` (A) | Explicações por competência, recomendações gerais, regras e FAQ da Apresentação | Por sub-título; ≤ 1.500 caracteres, nunca atravessando seções; tabelas de nível ficam só na rubrica |
| `redacao_comentada` (B) | Redação + comentário oficial | A redação nunca é fragmentada (registro `kind: essay`, não pesquisável); o comentário vira chunks de parágrafos inteiros ligados à redação (`essayId`) |
| `exemplo` (C) | Blocos "Exemplo…/Veja um exemplo…" (2025–2026) | Exemplo + análise juntos |

Cada chunk tem `id` estável (`AAAA.categoria.NNNN`, `AAAA.essay.NN[.comment.NN]`), `checksum` do texto normalizado, `year`, `docId`, `pdfPages`, `printedPages`, `section`, `competencies`, `theme`, `quality` e `origin: inep_verbatim`. O texto é sempre do Inep; metadados **derivados** são rotulados: `competencySource` = `section` (a seção diz), `keyword_rule` (regra de palavras-chave sobre o parágrafo) ou `essay_scope` (comentário sem competência específica).

**Notas**: só é registrada nota quando a cartilha a declara. 2018–2024 dizem "nota 1.000" (2024: "pontuação máxima — 1.000 pontos — na edição de 2023"). **2025 e 2026 dizem "boas notas"**: `scoreDocumented: null`. Nenhuma nota por competência é divulgada em edição alguma.

**Deduplicação**: texto equivalente entre edições (checksum igual ou ≥ 0,85 de similaridade em shingles de 4 palavras) mantém só a edição mais recente no índice; as anteriores ficam em `supersedes` (ano e páginas) e em `chunks.json` (`supersededBy`). Texto parcialmente sobreposto (≥ 0,55) permanece como versão distinguível e recebe `relatedVersions`. Redações e comentários não são deduplicados.

**Qualidade**: chunk com qualquer bloco ilegível é `partial` e vai para quarentena (fora do índice). Hoje: 1 (2023), 15 (2024), 12 (2025) chunks.

## Recuperação (`src/server/knowledge.server.ts`)

BM25 sobre tokens sem acento e com stemming leve, mais filtros de metadados (competência, categoria, ano, tema). Não há embeddings, Vectorize, Workers AI nem D1: o índice é JSON empacotado no Worker (o bundle de `rag.server` ficou em ~0,98 MB / 0,21 MB gzip). Justificativa: ~540 chunks; busca lexical com filtros por competência resolve as consultas exigidas, sem novo binding nem dependência de API para reindexar. A interface (`searchKnowledge`) esconde o motor; trocar por híbrido/vetorial é local.

- Retorna `{status: 'ok', hits}` com fonte, páginas PDF/impressas, citação, edições anteriores equivalentes e, para comentários, a redação (autor, trecho, nota documentada); ou `{status: 'no_evidence', reason}`.
- Sem preenchimento: corta resultados abaixo de um piso absoluto e de 40 % do melhor score.
- Versões relacionadas colapsam para a mais recente.

Exemplos reais (índice atual):

| Consulta | Resultado |
|---|---|
| "repertório sociocultural produtivo repertório de bolso" | Competência II — 2026 p. 16 (orientação), 2026 p. 22 e 2025 p. 21-22 (exemplos) |
| "coesão conectivos operadores argumentativos" | Competência IV — 2026 p. 33-34 (também em 2022–2025), comentários 2025 p. 67 e 2026 p. 61 |
| "proposta de intervenção agente ação meio efeito detalhamento" | Competência V — 2026 p. 35-36; comentário 2026 p. 47 (Redação 2); 2019 p. 23-24 |
| "receita de bolo de chocolate" | `no_evidence` |

### Integração com o corretor

> **Atualização (prompt `2026.2-calibrated`, ver [grading-calibration.md](grading-calibration.md)):** o prompt agora usa os descritores e trechos literais da cartilha, e nenhum resultado de `retrieveExamples`/`analyzeEssayDiagnostics` vai mais ao modelo: as heurísticas sinalizavam problemas em C1/C4 em todas as 70 redações oficiais. As referências da interface são buscadas depois da correção (`retrieveGuidanceForFindings`). O texto abaixo descreve o fluxo anterior, mantido como variante `baseline` para o benchmark.

`retrieveExamples(essay, limit)` (em `rag.server.ts`, mesma assinatura) era chamado por `correction.server.ts`; a saída estruturada do corretor, o contrato `CorrectionResult` e o frontend não mudaram. O diagnóstico por regras (`analyzeEssayDiagnostics`) apenas **roteia** a busca: monta consultas a partir da *descrição dos problemas* (ex.: "proposta de intervenção agente ação…"), **não do texto do aluno** — por isso o resultado não depende de a redação se parecer com redações nota 1.000 nem do tema. Os trechos entram no prompt como dados não normativos (já era assim) e `references` (≤ 3) continua validado por Zod.

Mudanças de comportamento a registrar: (1) deixa de preencher sempre 3 exemplos — pode retornar menos ou nenhum; (2) os exemplos agora vêm de 8 edições, com `year`, `category`, páginas e `scoreDocumented`; (3) o JSON de referências no prompt carrega esses campos extras. O texto do prompt, o modelo e a rubrica do prompt não foram alterados. Os artefatos antigos (`data/extracted/*-2026.json`) ficaram sem uso em runtime e foram mantidos por causa dos testes que os verificam.

## Anomalias encontradas nas fontes

- 2023/2024/2025: fontes sem `ToUnicode` (tratado acima). 2024/2025: Arial irrecuperável sem fonte de referência.
- 2023: comentário antes da redação no fluxo de texto (tratado).
- 2026: cabeçalho da p. 79 diz "A REDAÇÃO DO ENEM 2025", e o sumário (p. 5) herda "REDAÇÃO DO ENEM 2023 — com dislexia". Não foram corrigidos; o relatório avisa.
- 2018 p. 30, 2020 p. 19 e p. 34, 2022 p. 15: página-imagem (OCR `eng`, não validado, não indexado).
- 2020: tema da proposta não localizado no texto (consta como `null`).
- Algumas redações reproduzem desvios do estudante (ex.: 2025, redação 4); o texto não é corrigido.

## Pendências

- Nenhuma operação Cloudflare foi feita (nem build `cf`, nem deploy, nem D1). A base é só um JSON no bundle. Quando houver deploy, o `cf deploy --dry-run` deve confirmar o tamanho do Worker.
- Revisão pedagógica humana: tudo está `auto_validated`; nenhum chunk é `human_reviewed`.
- Pacote de idioma `por` do Tesseract (OCR de páginas-imagem) e fonte Arial de referência (ver acima).
- Decidir se o contrato do corretor ganha sinais de tangenciamento/direitos humanos para ligar `applyScoreCeilings`.
- ~~Decidir se `data/rubric-2026.json` deve ser substituído pela rubrica canônica no prompt.~~ Feito: o prompt usa só os descritores e trechos literais (ver grading-calibration.md).
