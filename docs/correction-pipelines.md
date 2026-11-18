# Arquiteturas de correção (`single` × `dual-review`)

Infraestrutura experimental para comparar duas arquiteturas. Ela **não pressupõe** que a dupla revisão seja melhor; o objetivo é medir.

> **Atualização (05/11/2026):** o seletor do editor agora escolhe só o **modelo** de uma correção única: `modelChoice` = `argon` ("Padrão · mais caro, mas não garante uma nota mais precisa") ou `flash` (`gemini-3.8-flash`, "Mais barato · se estiver indisponível, o Argon corrige no lugar"). Se o 3.8 Flash estiver sobrecarregado, a correção cai para o Argon, e a página da avaliação avisa ("Gemini 3.8 Flash indisponível · corrigida pelo Gemini 4 Argon"). O modelo que respondeu fica em `evaluations.model_id` e em `result.execution.model`. A dupla revisão saiu da interface, pela disponibilidade instável do 3.8 Flash; o código e os testes continuam no servidor para experimentos (um pedido com `pipeline: 'dual-review'` ainda é aceito).

| Id | Nome na interface | Fluxo | Modelo |
|---|---|---|---|
| `single` (padrão) | Correção padrão | Redação → corretor → resultado | `gemini-4-argon`, com o fallback existente (`GEMINI_FALLBACK_MODEL`) |
| `dual-review` | Dupla revisão (Experimental) | Redação → corretor → auditor → resultado validado | `gemini-3.8-flash` nas duas etapas, sem fallback |

Os ids são **arquiteturas**, não versões de prompt. As variantes de prompt (`calibrated`/`baseline`) continuam separadas, em `correctEssay(..., { variant })`. O cliente envia só o id, validado por Zod (`correctionPipelineSchema`). Modelo, prompt e parâmetros são definidos no servidor.

## Onde está

- `src/server/pipeline.server.ts`: orquestração (`runPipeline`), orçamento de tempo, métricas por etapa e a chamada do auditor.
- `src/server/audit.server.ts`: prompt do auditor, schema e composição determinística (`composeAudit`).
- `src/server/correction.server.ts`: o corretor de sempre. Ganhou opções definidas só no servidor (modelo, fallback, sinal, prazo) e soma todas as tentativas faturáveis.
- `src/server/correction-flow.server.ts`: grava no ledger e no histórico (`executionMetadata`).
- `migrations/0005_correction_pipeline.sql`: só acrescenta colunas.
- `src/lib/workbench/pipeline.ts` e o seletor em `src/components/screens/editor-screen.tsx`: interface.

## Pipeline `single` (grupo de controle)

É a mesma chamada de antes: prompt `2026.2-calibrated`, Argon e fallback. Um teste fixa o hash do prompt calibrado, para que ele não mude sem querer. A única novidade é o bloco opcional `execution` no resultado.

## Pipeline `dual-review`

1. **Corretor** (Flash, prompt calibrado, mesmo schema e mesmas validações). Uma falha aqui segue o tratamento de erro existente.
2. **Auditor** (Flash). Recebe a redação, o tema, a rubrica oficial (as mesmas seções normativas do corretor) e a primeira avaliação, com os achados numerados. Por competência, responde:
   - se cada achado existe e se a citação o sustenta (confirmar, rejeitar ou reclassificar);
   - se o texto atende ao nível acima e ao nível atual;
   - se o corretor deixou passar algum problema;
   - a decisão (manter, aumentar ou reduzir), com nota e justificativa.

   O prompt é simétrico. Ele lembra, por exemplo, que a ausência de desvios não basta para as notas altas de C2, C3 e C5.
3. **Composição no backend** (`composeAudit`), sem terceira chamada ao modelo. Uma mudança de nota só é aplicada se:
   - a decisão bate com a direção da mudança;
   - a nota está na escala do ENEM;
   - há justificativa;
   - **para reduzir**, sobra ao menos um desvio verificável (do corretor e confirmado, novo com citação literal, ou estrutural);
   - **para aumentar**, algum desvio foi rejeitado ou reclassificado, ou há uma citação literal que sustenta o descritor superior.

   Uma proposta recusada mantém a nota e o feedback originais daquela competência, e o motivo é registrado (`rejection`). O resultado final passa pelo `validateCorrection` (citações exatas, anulação, total recalculado).
4. **Falha do auditor** (erro do provedor, JSON inválido, competência faltando, tempo esgotado): o resultado do corretor é mantido com `auditStatus: 'failed'`. A interface mostra "auditoria não concluída (resultado do primeiro corretor)", e nunca "dupla revisão".
5. **Redação anulada:** não é auditada (`skipped`).

**Tempo.** O orçamento total é de 165 s, abaixo dos 3 min que a reserva de cota dura. O corretor tem no máximo 100 s, e a auditoria só começa se sobrarem ao menos 20 s. Esperar o `fetch` não conta como tempo de CPU no Workers; a requisição dura enquanto o cliente estiver conectado.

**Cota.** Uma correção conta como uma operação do usuário, mesmo com duas inferências. A idempotência por `requestId` não muda: um `requestId` repetido devolve o resultado salvo sem nova inferência.

## Consumo

- As duas etapas usam o `gemini-3.8-flash`, conferido na página oficial de preços em 05/11/2026: entrada US$ 0,75, saída (incluindo raciocínio) US$ 3,75 e leitura de cache US$ 0,075 por milhão de tokens até 31/12/2026; US$ 1,50, US$ 7,50 e US$ 0,15 a partir de 01/01/2027. As tarifas de `gemini-2.5-pro` (descontinuado; redirecionado ao 3.8 Flash a partir de 01/12/2026) e do `gemini-3.6-flash` continuam cadastradas.
- Cada etapa registra modelo, tentativas, tokens (entrada, saída, raciocínio, cache), custo e latência. O total soma as etapas; nada é sobrescrito.
- O fallback do corretor `single` agora soma o consumo da tentativa que falhou.

## Como saber qual pipeline gerou cada avaliação

- **Interface:** a página da avaliação mostra "Dupla revisão · …" quando for o caso. O seletor e a detecção de "já corrigida" consideram o pipeline, então o mesmo texto pode ser avaliado pelas duas arquiteturas.
- **`evaluations`** (histórico, opt-in): `pipeline`, `prompt_version`, `audit_status` e `execution_json`, que guarda as etapas, as notas antes e depois, as mudanças e as justificativas do auditor. Avaliações antigas ficam como `single` / `NULL`.
- **`usage_ledger`** (sempre gravado): `pipeline`, `stages_json` e `audit_json`. Este último traz notas, decisões e motivos de recusa, **sem texto da redação nem das justificativas**.
- **Resultado** (`CorrectionResult.execution`): `pipeline`, `auditStatus` e `changedCompetencies`.

Exemplo de consulta:

```sql
SELECT pipeline, audit_status, total_score, json_extract(execution_json, '$.audit.initialTotal') AS inicial
FROM evaluations ORDER BY created_at DESC;
```

## Limitações

- Nenhuma chamada real da dupla revisão foi feita: os testes usam etapas simuladas. A qualidade do auditor, a obediência ao schema e o custo real **não foram medidos**.
- O custo esperado (estimativa, não medição) é de uns US$ 0,05 a 0,06 por correção: corretor ~US$ 0,02 a 0,03 e auditor ~US$ 0,025 a 0,03, já que o auditor reenvia a rubrica, a redação e a primeira avaliação. A maior incerteza são os tokens de raciocínio do Flash. A opção aparece no seletor com o selo "Experimental".
- O prompt do auditor é novo e não foi calibrado. As regras de composição limitam mudanças sem fundamento, mas não garantem que as mudanças aceitas estejam certas.
- A tela do editor não tem teste automatizado de componente (o projeto não tem testing-library). A lógica de seleção está em funções puras testadas.
