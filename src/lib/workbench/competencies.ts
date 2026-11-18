import type { CompetencyId } from './types'

export type CompetencyDefinition = {
  id: CompetencyId
  code: string
  name: string
  official: string
  focus: string[]
  /** Paraphrased INEP level descriptors, index = level (0–5). */
  levels: [string, string, string, string, string, string]
}

export const COMPETENCIES: CompetencyDefinition[] = [
  {
    id: 'c1',
    code: 'C1',
    name: 'Norma culta',
    official:
      'Demonstrar domínio da modalidade escrita formal da língua portuguesa.',
    focus: [
      'Ortografia e acentuação',
      'Concordância e regência',
      'Pontuação',
      'Registro formal',
    ],
    levels: [
      'Demonstra desconhecimento da modalidade escrita formal da língua portuguesa.',
      'Demonstra domínio precário da modalidade escrita formal, de forma sistemática, com diversificados e frequentes desvios gramaticais, de escolha de registro e de convenções da escrita.',
      'Demonstra domínio insuficiente da modalidade escrita formal, com muitos desvios gramaticais, de escolha de registro e de convenções da escrita.',
      'Demonstra domínio mediano da modalidade escrita formal, com alguns desvios gramaticais e de convenções da escrita.',
      'Demonstra bom domínio da modalidade escrita formal, com poucos desvios gramaticais e de convenções da escrita.',
      'Demonstra excelente domínio da modalidade escrita formal. Desvios gramaticais ou de convenções da escrita são aceitos somente como excepcionalidade e quando não caracterizam reincidência.',
    ],
  },
  {
    id: 'c2',
    code: 'C2',
    name: 'Tema e repertório',
    official:
      'Compreender a proposta de redação e aplicar conceitos das várias áreas de conhecimento para desenvolver o tema, dentro dos limites estruturais do texto dissertativo-argumentativo em prosa.',
    focus: [
      'Adequação ao tema',
      'Repertório sociocultural',
      'Estrutura dissertativo-argumentativa',
    ],
    levels: [
      'Fuga ao tema ou não atendimento à estrutura dissertativo-argumentativa.',
      'Apresenta o assunto tangenciando o tema ou demonstra domínio precário do texto dissertativo-argumentativo, com traços constantes de outros tipos textuais.',
      'Desenvolve o tema recorrendo à cópia de trechos dos textos motivadores ou apresenta domínio insuficiente do texto dissertativo-argumentativo, sem atender à estrutura com proposição, argumentação e conclusão.',
      'Desenvolve o tema por meio de argumentação previsível e apresenta domínio mediano do texto dissertativo-argumentativo, com proposição, argumentação e conclusão.',
      'Desenvolve o tema por meio de argumentação consistente e apresenta bom domínio do texto dissertativo-argumentativo, com proposição, argumentação e conclusão.',
      'Desenvolve o tema por meio de argumentação consistente, a partir de um repertório sociocultural produtivo, e apresenta excelente domínio do texto dissertativo-argumentativo.',
    ],
  },
  {
    id: 'c3',
    code: 'C3',
    name: 'Argumentação',
    official:
      'Selecionar, relacionar, organizar e interpretar informações, fatos, opiniões e argumentos em defesa de um ponto de vista.',
    focus: ['Projeto de texto', 'Desenvolvimento dos argumentos', 'Autoria'],
    levels: [
      'Apresenta informações, fatos e opiniões não relacionados ao tema e sem defesa de um ponto de vista.',
      'Apresenta informações, fatos e opiniões pouco relacionados ao tema ou incoerentes, sem defesa de um ponto de vista.',
      'Apresenta informações, fatos e opiniões relacionados ao tema, mas desorganizados ou contraditórios e limitados aos argumentos dos textos motivadores.',
      'Apresenta informações, fatos e opiniões relacionados ao tema, limitados aos argumentos dos textos motivadores e pouco organizados, em defesa de um ponto de vista.',
      'Apresenta informações, fatos e opiniões relacionados ao tema, de forma organizada, com indícios de autoria, em defesa de um ponto de vista.',
      'Apresenta informações, fatos e opiniões relacionados ao tema proposto, de forma consistente e organizada, configurando autoria, em defesa de um ponto de vista.',
    ],
  },
  {
    id: 'c4',
    code: 'C4',
    name: 'Coesão',
    official:
      'Demonstrar conhecimento dos mecanismos linguísticos necessários para a construção da argumentação.',
    focus: [
      'Conectivos entre parágrafos',
      'Conectivos entre frases',
      'Retomadas e repetições',
    ],
    levels: [
      'Não articula as informações.',
      'Articula as partes do texto de forma precária.',
      'Articula as partes do texto de forma insuficiente, com muitas inadequações, e apresenta repertório limitado de recursos coesivos.',
      'Articula as partes do texto de forma mediana, com inadequações, e apresenta repertório pouco diversificado de recursos coesivos.',
      'Articula as partes do texto com poucas inadequações e apresenta repertório diversificado de recursos coesivos.',
      'Articula bem as partes do texto e apresenta repertório diversificado de recursos coesivos.',
    ],
  },
  {
    id: 'c5',
    code: 'C5',
    name: 'Proposta de intervenção',
    official:
      'Elaborar proposta de intervenção para o problema abordado, respeitando os direitos humanos.',
    focus: ['Agente', 'Ação', 'Modo ou meio', 'Finalidade', 'Detalhamento'],
    levels: [
      'Não apresenta proposta ou apresenta proposta não relacionada ao tema ou ao assunto.',
      'Apresenta proposta de intervenção vaga, precária ou relacionada apenas ao assunto.',
      'Elabora, de forma insuficiente, proposta de intervenção relacionada ao tema, ou não articulada com a discussão desenvolvida no texto.',
      'Elabora, de forma mediana, proposta de intervenção relacionada ao tema e articulada à discussão desenvolvida no texto.',
      'Elabora bem proposta de intervenção relacionada ao tema e articulada à discussão desenvolvida no texto.',
      'Elabora muito bem proposta de intervenção, detalhada, relacionada ao tema e articulada à discussão desenvolvida no texto.',
    ],
  },
]

export const COMPETENCY_BY_ID = Object.fromEntries(
  COMPETENCIES.map((c) => [c.id, c]),
) as Record<CompetencyId, CompetencyDefinition>

export const LEVEL_SCORES = [0, 40, 80, 120, 160, 200] as const

export const PAST_TOPICS = [
  {
    year: 2025,
    topic: 'Perspectivas acerca do envelhecimento na sociedade brasileira',
  },
  {
    year: 2024,
    topic: 'Desafios para a valorização da herança africana no Brasil',
  },
  {
    year: 2023,
    topic:
      'Desafios para o enfrentamento da invisibilidade do trabalho de cuidado realizado pela mulher no Brasil',
  },
  {
    year: 2022,
    topic:
      'Desafios para a valorização de comunidades e povos tradicionais no Brasil',
  },
  {
    year: 2021,
    topic:
      'Invisibilidade e registro civil: garantia de acesso à cidadania no Brasil',
  },
  {
    year: 2020,
    topic: 'O estigma associado às doenças mentais na sociedade brasileira',
  },
  { year: 2019, topic: 'Democratização do acesso ao cinema no Brasil' },
]
