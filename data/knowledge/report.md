# Relatório de ingestão das cartilhas do Inep

Gerado por `scripts/cartilhas/ingest.py`. Este relatório é determinístico (sem datas) para permitir diff entre execuções.

## Resumo por PDF

| Ano | Páginas | Redações | Nota documentada | Chunks (ok/parciais) | Indexados | Validação | Avisos |
|---|---|---|---|---|---|---|---|
| 2018 | 52 | 9 | 1000 | 75/0 | 51 | passed_with_warnings | 2 |
| 2019 | 49 | 7 | 1000 | 74/0 | 58 | passed | 0 |
| 2020 | 52 | 7 | 1000 | 78/0 | 61 | passed_with_warnings | 2 |
| 2022 | 46 | 7 | 1000 | 86/0 | 60 | passed_with_warnings | 1 |
| 2023 | 52 | 10 | 1000 | 96/1 | 74 | passed | 0 |
| 2024 | 70 | 10 | 1000 | 92/15 | 53 | passed_with_warnings | 1 |
| 2025 | 78 | 10 | não documentada | 112/12 | 69 | passed_with_warnings | 1 |
| 2026 | 82 | 10 | não documentada | 120/0 | 110 | passed_with_warnings | 1 |

Total: 761 chunks, 536 indexados, 70 redações comentadas disponíveis.

## Conteúdo extraído

Categorias: `orientacao` (A), `redacao_comentada` (B), `exemplo` (C).

| Ano | Orientações | Exemplos | Redações | Comentários | Tema |
|---|---|---|---|---|---|
| 2018 | 46 | 0 | 9 | 20 | Desafios para a formação educacional de surdos no Brasil |
| 2019 | 49 | 0 | 7 | 18 | Manipulação do comportamento do usuário pelo controle de dados na internet |
| 2020 | 49 | 0 | 7 | 22 | — |
| 2022 | 52 | 0 | 7 | 27 | Invisibilidade e registro civil: garantia de acesso à cidadania no Brasil |
| 2023 | 50 | 0 | 10 | 37 | Desafios para a valorização de comunidades e povos tradicionais no Brasil |
| 2024 | 61 | 0 | 10 | 36 | Desafios para o enfrentamento da invisibilidade do trabalho de cuidado realizado pela mulher no Brasil |
| 2025 | 59 | 18 | 10 | 37 | Desafios para a valorização da herança africana no Brasil |
| 2026 | 52 | 16 | 10 | 42 | Perspectivas acerca do envelhecimento na sociedade brasileira |

## Revisão manual necessária

### 2018

- páginas lidas por OCR (`eng`, sem validação; texto não indexado): [30]

### 2020

- páginas lidas por OCR (`eng`, sem validação; texto não indexado): [19, 34]
- páginas cuja ordem de leitura foi corrigida pela posição visual (conferir pareamento redação/comentário): [15, 33]
- problemas de estrutura: tema da proposta não localizado no texto extraído
- theme_found: tema: None

### 2022

- páginas lidas por OCR (`eng`, sem validação; texto não indexado): [15]
- páginas cuja ordem de leitura foi corrigida pela posição visual (conferir pareamento redação/comentário): [11, 28]

### 2023

- páginas de conteúdo com glifos ilegíveis (blocos excluídos do índice): [6, 11, 27]
- páginas cuja ordem de leitura foi corrigida pela posição visual (conferir pareamento redação/comentário): [15, 16, 17, 19, 23, 28, 33, 46]

### 2024

- páginas de conteúdo com glifos ilegíveis (blocos excluídos do índice): [7, 16, 18, 34]
- redação 10 (Matheus Almeida Barros) com trechos ilegíveis
- páginas cuja ordem de leitura foi corrigida pela posição visual (conferir pareamento redação/comentário): [36]

### 2025

- páginas de conteúdo com glifos ilegíveis (blocos excluídos do índice): [7, 16, 24, 40]
- páginas cuja ordem de leitura foi corrigida pela posição visual (conferir pareamento redação/comentário): [24, 42]

### 2026

- páginas cuja ordem de leitura foi corrigida pela posição visual (conferir pareamento redação/comentário): [43]
- header_year_consistent: cabeçalho com ano diferente de 2026: ['2025']

## Rubrica canônica e variações entre edições

Baseline: 2026.

| Ano | níveis idênticos | níveis só redação | níveis alterados | níveis ilegíveis | regras de anulação idênticas/redação | anulação fora do baseline | baseline ausente |
|---|---|---|---|---|---|---|---|
| 2018 | 30 | 0 | 0 | 0 | 2/3 | 4 | 5 |
| 2019 | 29 | 1 | 0 | 0 | 2/3 | 5 | 5 |
| 2020 | 28 | 2 | 0 | 0 | 3/4 | 4 | 3 |
| 2022 | 29 | 1 | 0 | 0 | 3/3 | 6 | 4 |
| 2023 | 29 | 1 | 0 | 0 | 3/3 | 6 | 4 |
| 2024 | 27 | 1 | 0 | 2 | 8/2 | 0 | 0 |
| 2025 | 28 | 0 | 0 | 2 | 10/0 | 0 | 0 |
| 2026 | 30 | 0 | 0 | 0 | 10/0 | 0 | 0 |

Níveis `unreadable_in_source_extraction` não puderam ser comparados: a extração do PDF dessa edição está ilegível nesse trecho e não foi adivinhada.

## Pendências de infraestrutura

- Nenhuma operação Cloudflare foi executada: a base é empacotada com o Worker como JSON estático (sem D1/Vectorize/Workers AI novos).
- OCR com idioma português (`por`) não está instalado; o OCR usa `eng`, portanto nunca é indexado.
- Fontes Arial (2024/2025) sem arquivo de referência: as linhas afetadas ficam fora do índice. Para recuperá-las, gere uma tabela com `build_glyph_table.py --fonts-dir <pasta com Arial TTF licenciado>`.
