# Artefatos pedagógicos — ENEM 2026

Fonte: INEP/MEC, **A Redação do Enem 2026 — Cartilha do(a) participante**.
Publicação oficial: https://www.gov.br/inep/pt-br/centrais-de-conteudo/acervo-linha-editorial/publicacoes-institucionais/avaliacoes-e-exames-da-educacao-basica/a-redacao-do-enem-2026-cartilha-do-a-participante

Estes JSONs são os artefatos existentes no workspace original, preservados byte a byte. Não foram regenerados nem substituídos por material demonstrativo. A rubrica inclui referência de páginas; exemplos preservam atribuição dos autores e comentários do INEP. O índice tem **68 chunks** (o README legado dizia 74).

O expediente do PDF local autoriza reprodução total ou parcial com citação da fonte. Essa permissão e a atribuição ao INEP e aos autores são preservadas; estes textos não são apresentados como autoria do projeto ou como nova norma. Não atribuímos uma licença MIT ao conteúdo de terceiros.

SHA-256 do PDF de origem local (não necessário ao runtime): `5708d8df9a3b0046cbf3d835e023f9eb89be08d295cb01ce5afeac77496211ad`.

| Artefato | SHA-256 |
| --- | --- |
| rubric-2026.json | 129310d2bd1e4f9b1d3f15b841d007870dd95d8525d9739480103640a1ad1168 |
| extracted/commented-essays-2026.json | 0f0244bcbd652f5f38522a62ca7f8d15a57d36168184eeb529d28d5c97e23e05 |
| extracted/rag-index-2026.json | e82606055a04a83642c3f112cf59465c83f3b87e3e21d6d41583d5da5d4fd11a |

Os hashes coincidem com o plano anterior. O flag `reviewed` foi preservado, não habilitado nesta migração; integridade do artefato não significa nova auditoria pedagógica independente. Dados privados e credenciais não fazem parte desta pasta.

## Base de conhecimento multi-edição (2018–2026)

`data/knowledge/` contém a base gerada por `scripts/cartilhas/ingest.py` a partir de todas as cartilhas disponíveis (rubrica canônica, comentários e orientações com proveniência por página). É ela que alimenta a recuperação em runtime. Os artefatos acima (`rubric-2026.json`, `extracted/*-2026.json`) são anteriores a esse pipeline: `rubric-2026.json` ainda é a rubrica usada no prompt do corretor (seus descritores foram conferidos como idênticos aos do PDF); `extracted/*` não são mais usados em runtime. Detalhes, limites e como atualizar: [docs/knowledge-base.md](../docs/knowledge-base.md).
