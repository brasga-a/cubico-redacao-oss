// Illustrative editor example from ENEMEssayGrader 5afd302; no evaluation or score is bundled.
import type { Draft } from './types'

export const SAMPLE_DRAFT: Omit<Draft, 'updatedAt'> = {
  topic: 'Desafios para a valorização da herança africana no Brasil',
  title: '',
  supportingTexts: [
    'A Lei nº 10.639/2003 alterou a Lei de Diretrizes e Bases da Educação Nacional para incluir no currículo oficial da rede de ensino a obrigatoriedade da temática "História e Cultura Afro-Brasileira".',
  ],
  essay: [
    'A Lei nº 10.639, de 2003, tornou obrigatório o ensino de história e cultura afro-brasileira nas escolas do país. Contudo, duas décadas depois, a herança africana ainda é tratada de forma superficial e, muitas vezes, estereotipada. Nesse sentido, é fundamental analisar os desafios para a valorização desse legado, os quais estão ligados ao racismo estrutural e à aplicação insuficiente da legislação educacional.',
    'Em primeiro lugar, cabe destacar que o racismo estrutural dificulta o reconhecimento das contribuições africanas. Segundo o jurista Silvio Almeida, o racismo não é um ato isolado, mas um processo que se manifesta nas instituições e nas relações cotidianas. Dessa forma, manifestações como o candomblé e a capoeira ainda são alvo de preconceito, o que contribui para a invisibilidade da cultura negra, já que parte da população associa a cultura negra ao atraso, e não à formação da identidade nacional. Houveram avanços, como o tombamento de terreiros, porém eles não alteram essa visão de forma ampla.',
    'Além disso, a negligência na aplicação da lei agrava o problema. A nível de escola, muitos professores não recebem formação adequada para abordar a temática, e o conteúdo acaba restrito a datas comemorativas, como o Dia da Consciência Negra. Isso ocorre em um contexto onde os materiais didáticos priorizam a perspectiva europeia, por isso os estudantes crescem sem conhecer a importância dos povos africanos para a ciência, a culinária e a língua portuguesa.',
    'Portanto, é necessário superar esses desafios. Para isso, o Ministério da Educação deve promover a formação continuada de professores, por meio de cursos gratuitos sobre história e cultura afro-brasileira, a fim de garantir que a lei seja cumprida de maneira efetiva. Além disso, a mídia deve divulgar campanhas que valorizem as tradições de matriz africana. Assim, a herança africana será reconhecida como parte essencial da identidade brasileira.',
  ].join('\n\n'),
}
