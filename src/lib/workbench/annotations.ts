import type { CorrectionResult } from '@/lib/correction'
import { competenceIds } from './view-model'
import type { Annotation } from './types'
/** Mapping preserves UTF-16 offsets in the original snapshot; matches only baseline punctuation/space normalization. */
function indexed(text: string) {
  let value = ''
  const offsets: Array<[number, number]> = []
  for (let i = 0; i < text.length; i++) {
    let c = text[i]
      .replace(/[“”„‟]/g, '"')
      .replace(/[‘’‚‛]/g, "'")
      .replace(/[–—]/g, '-')
    if (/\s/.test(c)) {
      if (value.endsWith(' ')) {
        offsets[offsets.length - 1][1] = i + 1
        continue
      }
      c = ' '
    }
    value += c
    offsets.push([i, i + 1])
  }
  return { value, offsets }
}
export function locateQuotes(
  text: string,
  quote: string,
): Array<{ start: number; end: number }> {
  const found: Array<{ start: number; end: number }> = []
  let offset = 0
  while (quote) {
    const start = text.indexOf(quote, offset)
    if (start < 0) break
    found.push({ start, end: start + quote.length })
    offset = start + 1
  }
  if (found.length || !quote.trim()) return found
  const input = indexed(text),
    q = indexed(quote).value.trim()
  offset = 0
  while (q) {
    const at = input.value.indexOf(q, offset)
    if (at < 0) break
    found.push({
      start: input.offsets[at][0],
      end: input.offsets[at + q.length - 1][1],
    })
    offset = at + 1
  }
  return found
}
export function realAnnotations(
  text: string,
  result: CorrectionResult,
): Annotation[] {
  return result.competencies.flatMap((c) => [
    ...c.problems.flatMap((p, i) =>
      p.quote
        ? locateQuotes(text, p.quote).map((range, n) => ({
            ...range,
            id: `${c.id}-problem-${i}-${n}`,
            competency: competenceIds[c.id],
            kind: 'issue' as const,
            label: 'Ponto a revisar',
            message: p.description,
          }))
        : [],
    ),
    ...c.evidence.flatMap((q, i) =>
      locateQuotes(text, q).map((range, n) => ({
        ...range,
        id: `${c.id}-evidence-${i}-${n}`,
        competency: competenceIds[c.id],
        kind: 'evidence' as const,
        label: 'Evidência textual',
        message: 'Trecho citado na avaliação. Não implica elogio.',
      })),
    ),
  ])
}
