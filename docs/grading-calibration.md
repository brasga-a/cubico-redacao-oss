# Calibração do corretor (prompt `2026.2-calibrated`)

Auditoria e recalibração do corretor ENEM, feitas em 05/11/2026. O modelo é o mesmo nas duas versões (`gemini-4-argon`), e a configuração de raciocínio não mudou. O schema público e o frontend também não mudaram. **Nada foi publicado.**

## 1. Diagnóstico

As evidências abaixo vêm de execuções offline, sem custo, sobre a base do INEP e sobre as 10 avaliações guardadas no D1 local.

| Causa | Evidência |
|---|---|
| **Heurísticas do RAG induziam problemas inexistentes.** `analyzeEssayDiagnostics` sinaliza qualquer período com 35 palavras ou mais, palavras repetidas 6 vezes ou mais e conectivos fora de uma lista fixa. As tags (`periodos_longos`, `estrutura_sintatica`, `repeticao_conectivos…`) iam no JSON de referências do prompt. | Rodando sobre as 70 redações das cartilhas: 69 receberam `periodos_excessivamente_longos`, e **todas as 70** levavam tags de problema em C1 e C4 para o prompt. O Caio levou tags de C1, C4 e C5 e recebeu 160 em C1, C3 e C4. |
| **O resumo da rubrica no prompt não era texto do INEP.** Os campos `summary`, `evaluatedAspects` e `recommendations` de `data/rubric-2026.json` são paráfrases mais rígidas que a cartilha. | "períodos… excessivamente longos que prejudiquem a fluidez", "articular… todos os parágrafos e os períodos internos" e "repetições viciosas" não aparecem na cartilha 2026. O INEP diz "repetição ou substituição inadequada de palavras" e "sem repetições desnecessárias". O `docs/knowledge-base.md` já registrava que esses campos "não são texto do Inep". |
| **C1: um desvio isolado custava um nível.** | Saída guardada para a Sabrina: "pontuais desvios… *impedem a atribuição do nível máximo*". O INEP, sobre a mesma redação: "*Há apenas um desvio* […] próclise" e "excelente domínio". Nos comentários oficiais de 2018 a 2024, a maioria das redações nota 1000 tem 1 ou 2 desvios citados pelo próprio INEP. |
| **C3: exigência literal entre introdução e desenvolvimento, e mistura com C5.** | Saída guardada: "promete-se discutir o papel do Estado… mas os parágrafos…" → 160. No Caio, "a conclusão propõe… problemas não discutidos" foi lançado em C3, mas é critério de C5. |
| **C4: uma repetição derrubava uma faixa.** | No Caio: "Há apenas pontual repetição lexical… *o que mantém a nota no nível 160*". O INEP diz que a mesma redação tem coesão "*sem inadequações*". |
| **A nota vinha antes da justificativa.** | No schema, `score` era o segundo campo, antes de `rationale` e `problems`. |
| **Sem distinção entre desvio e sugestão.** | Todo apontamento ia para `problems`, e uma oportunidade de melhoria contava como erro. |

Outros pontos auditados sem defeito: a validação Zod das notas permitidas, o total calculado no código e a verificação literal das citações. O `rubric.server.ts` (rubrica canônica e `applyScoreCeilings`) continua sem uso no corretor, como já estava documentado.

## 2. Mudanças

- **Rubrica no prompt** (`src/server/grading-guide.server.ts`): leva os descritores dos níveis (idênticos aos da cartilha), as regras oficiais de nota zero e efeito na nota, e 36 trechos **literais** da cartilha 2026, com página. As paráfrases saíram.
- **Procedimento de decisão** (orientação de método, sem critério numérico):
  - Cada achado é classificado como `desvio`, `oportunidade` ou `incerto`, e só `desvio` pode rebaixar a nota. Em C1, só é desvio o que contraria regra obrigatória; pontuação facultativa e variantes admitidas por gramáticas de referência contam como incerto.
  - Antes da nota, o modelo compara os descritores dos níveis vizinhos, em `levelComparison`.
  - Pesa frequência, gravidade, reincidência e impacto, nos termos da cartilha. "Reincidência" é a repetição do mesmo tipo de desvio. A orientação cita, literalmente, um comentário do INEP sobre desvio isolado.
  - As fronteiras entre competências ficam explícitas (C3 profunda × C4 superfície; ligação entre proposta e discussão é C5), e falta de exemplo é oportunidade, não lacuna de sentido.
  - O mesmo rigor vale nas duas direções. Não há nenhuma instrução para favorecer 1000.
- **Schema do modelo:** `score` passou a ser o último campo. Só `desvio` vira `problems`; oportunidades e incertezas vão para `suggestions`, e as incertezas aparecem como "Ponto a conferir, não considerado desvio". O contrato público não mudou.
- **RAG:** nada heurístico vai mais para o prompt. As referências da interface são buscadas depois da correção, nas competências com desvio comprovado. É determinístico e não custa chamada.
- O prompt anterior continua disponível como `variant: 'baseline'`, só para o benchmark.

## 3. Benchmark (`scripts/benchmark/`)

- **Gabarito.** Só conta como nota oficial o que a cartilha documenta: as edições de 2018 a 2024 publicam "redações nota 1.000", num total de 50. As cartilhas de 2025 e 2026 dizem apenas que as redações "receberam boas notas" (conferido na página renderizada). Por isso, **as notas 1000 de Caio e Sabrina são informadas pelo usuário**, e o benchmark não as trata como oficiais.
- **Divisão entre conjuntos.** A calibração (2018 a 2020) pôde orientar ajustes. A validação (2022 a 2024) só foi lida na comparação final. O diagnóstico reúne 2025 e 2026 e os casos locais.
- **Fidelidade das transcrições.** Encontrei 5 defeitos de extração do PDF na base, corrigidos no dataset e conferidos com o PDF: "recémaprovado", "f ísica", "livrearbítrio", "atenuarse" e "curtametragem". Sem a correção, o corretor apontava erros que a candidata não cometeu. A cópia do Caio usada nos testes locais difere da cartilha em uma palavra ("dos/das personagens").
- **Redações degradadas de propósito** (derivadas da validação), com expectativa de direção:
  - desvios frequentes de grafia e concordância → C1 ≤ 120;
  - sem o parágrafo da proposta → C5 ≤ 40;
  - texto num bloco só e sem conectivos iniciais → C4 ≤ 160.
- **Métricas:**
  - erro absoluto (total e por competência) e viés;
  - amplitude entre execuções;
  - desvios de C1 além dos listados pelo INEP;
  - descontos sem desvio apontado;
  - custo, latência e tokens.
- **Uso:**
  - `bun scripts/benchmark/run.ts --split validation --variant both --runs 2 --max-usd 4 --yes`: as chamadas são pagas. Sem `--yes` só mostra a estimativa, e o script aborta acima de `--max-usd`.
  - `bun scripts/benchmark/report.ts benchmark-results/*.jsonl [--local-d1 <sqlite>]`: gera o relatório, sem custo.

## 4. Resultados (mesmas redações, mesmo modelo, sem fallback)

Amostra: 12 redações da validação × 2 execuções × 2 versões, 9 degradadas × 2 versões e 6 casos de diagnóstico × 2 × 2. Gasto real: US$ 5,04, contando a calibração.

| Validação (nota oficial 1000) | Antigo | Recalibrado |
|---|---|---|
| Erro absoluto médio do total | 41,7 | **21,7** |
| Erro em C1 / C3 | 36,5 / 5,2 | **20,0 / 1,7** |
| Total exato (1000) | 9% | **46%** |
| C1 < 200 quando o INEP aponta ≤ 1 desvio | 90% | **55%** |
| Desvios de C1 além dos listados pelo INEP (média) | 2,57 | **1,58** |
| Mesmo total nas 2 execuções | 91% | 92% |
| Falhas por citação inexistente | 1 de 24 | 0 de 24 |

| Redações degradadas (dentro do esperado) | Antigo | Recalibrado |
|---|---|---|
| Geral | 63% | **78%** |
| C1 (desvios frequentes) | 3/3 | 3/3 |
| C5 (sem proposta) | 1/3 | 2/3 |
| C4 (bloco único) | 1/2 (1 falha técnica) | 2/3 |

| Diagnóstico | Antigo | Recalibrado |
|---|---|---|
| Caio (2026.essay.03) | 920, 920 | 1000, 1000 |
| Sabrina (2025.essay.10) | 960 | 960, 960 |
| Gerada por IA (local) | 1000, 1000 | 1000, 1000 |
| 2026.essay.01 (o INEP diz que C1 não é máxima) | C1 160 / 160 ✔ | **C1 200 / 200 ✘** |
| Envelhecimento local A / B | 960, 920 / 920, 920 | 960, 960 / 960, 920 |

O recalibrado não sobe tudo: nas redações degradadas, C1 e C4 caíram como esperado, e a proposta removida levou C5 a 0–80.

## 5. Onde ainda falha

- **C1 ainda é a maior fonte de erro.** Em metade das execuções da validação, o C1 ficou em 160. Parte dos desvios apontados é real, mas não foi citada pelo INEP (por exemplo, "construírem ser verdadeiro eu", "por meio de pesquisar"), e parte é falso positivo (um desvio de hífen ligado a um trecho que não tem relação com ele). O critério do INEP para 200 com 2 ou 3 desvios isolados não é reproduzido de forma consistente.
- **Ficou mais permissivo num caso.** Em `2026.essay.01`, o INEP aponta "alguns problemas de concordância nominal e verbal, pontuação…" que "não permitem a avaliação no nível máximo". O antigo deu 160, e o recalibrado deu 200 nas duas execuções. É o risco oposto ao corrigido e precisa de mais casos abaixo de 1000 para medir direito.
- **Redação gerada por IA:** 1000 nas duas versões. Sem nota oficial, não dá para dizer se é erro.
- **Proposta removida:** em `2022.essay.01`, as duas versões deram C5 = 80 (esperado ≤ 40); o antigo errou também em `2022.essay.02`.
- **Bloco único:** em `2022.essay.01`, as duas versões mantiveram C4 = 200 mesmo sem paragrafação nem conectivos iniciais.
- **Amostra pequena:** 12 das 27 redações da validação e 2 execuções cada. A diferença no total exato (9% → 46%) é grande, mas os intervalos de confiança são largos.
- **Falta de casos fracos oficiais:** o INEP só publica redações nota 1000 completas, por isso a permissividade foi medida com degradações sintéticas e um único caso diagnóstico.

## 6. Custo e latência

| | Antigo | Recalibrado |
|---|---|---|
| Custo médio por correção | US$ 0,044 | **US$ 0,057 (+27%)** |
| Tokens de entrada | 8,8 mil | 12,3 mil (o guia literal é maior) |
| Tokens de saída | 2,5 mil | 3,4 mil (achados classificados e `levelComparison`) |
| Latência mediana / p90 | 33,5 s / 52,1 s | 41,0 s / 48,3 s |

O modelo usou 0 tokens de raciocínio nas execuções recalibradas, contra 260 em média no antigo. A configuração de raciocínio é a mesma nas duas, e não foi alterada.

## 7. Verificações

- `bun test`: 144 testes. Os novos cobrem:
  - os trechos literais e a citação literal do INEP no guia;
  - a ausência de paráfrases, tags, redações e tolerâncias numéricas no prompt;
  - o mapeamento dos achados, os limites de texto e as referências pós-correção;
  - o dataset, as correções de transcrição, as degradações e as métricas.
- `bun x tsc --noEmit` sem erros, e `bun run lint` só com o erro antigo de `theme-provider.tsx:91`.
