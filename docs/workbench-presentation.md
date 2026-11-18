# Cúbico — apresentação

Estrutura e estilos adaptados de ENEMEssayGrader, commit `5afd302b8346da860bebc0835ce87722b37dcffb`, fornecido como referência visual pelo proprietário dos projetos. Primitives portadas para Base UI; nenhum import de Radix, avaliador demonstrativo, identidade demonstrativa ou armazenamento do protótipo.

Os componentes recebem dados/callbacks tipados. O adaptador `evaluationView` apenas compõe apresentação; não gera notas. `realAnnotations` localiza citações verificadas em UTF-16, sem transformar evidência em elogio. Intervalos do ambiente visual são fornecidos por fixtures verificáveis. `annotationSegments` apenas renderiza intervalos sem duplicar o texto em sobreposições.

As páginas reais estão em `src/routes`: login e layout autenticado, editor, histórico, avaliação por ID e processamento. As composições ficam em `src/components/screens`; o contexto compartilhado usa Better Auth, server functions e histórico IndexedDB opt-in, sem selecionar telas por estado. O antigo `app.tsx` foi removido. O entrypoint de testes em `visual/` é independente, iniciado por `bun run visual:dev` em `http://127.0.0.1:3200/visual/index.html`. A implementação de histórico/auth/inferência não é substituída por este ambiente. Não há rota de fixtures no Worker de produção. O build de produção é testado para ausência de identificadores/dados de fixtures e exclui suas classes do scan Tailwind.

A branch já inclui a integração, adaptador de citações, IndexedDB e AI SDK. Isso não concede aprovação visual nem homologação autenticada. O harness mantém dados de teste separados, sem bypass na aplicação.

A organização e os testes das rotas estão em `docs/routing-refactor.md`.
