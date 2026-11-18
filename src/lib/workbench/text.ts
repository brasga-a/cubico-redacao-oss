import type { TextStats } from './types'

const WORD_RE = /[\p{L}\p{N}]+(?:[-'’][\p{L}\p{N}]+)*/gu

export type Range = { start: number; end: number; text: string }

export function countWords(text: string) {
  return text.match(WORD_RE)?.length ?? 0
}

export function getParagraphs(text: string): Range[] {
  const result: Range[] = []
  const re = /[^\n]+/g
  let match: RegExpExecArray | null
  while ((match = re.exec(text))) {
    const raw = match[0]
    const leading = raw.length - raw.trimStart().length
    const trimmed = raw.trim()
    if (!trimmed) continue
    const start = match.index + leading
    result.push({ start, end: start + trimmed.length, text: trimmed })
  }
  return result
}

export function getSentences(paragraph: Range): Range[] {
  const result: Range[] = []
  const re = /[.!?…]+["”’)»]*(?=\s|$)/g
  let cursor = 0
  let match: RegExpExecArray | null
  const text = paragraph.text
  while ((match = re.exec(text))) {
    const end = match.index + match[0].length
    pushSentence(text, cursor, end, paragraph.start, result)
    cursor = end
  }
  if (cursor < text.length)
    pushSentence(text, cursor, text.length, paragraph.start, result)
  return result
}

function pushSentence(
  text: string,
  from: number,
  to: number,
  offset: number,
  out: Range[],
) {
  const slice = text.slice(from, to)
  const leading = slice.length - slice.trimStart().length
  const trimmed = slice.trim()
  if (!trimmed) return
  const start = offset + from + leading
  out.push({ start, end: start + trimmed.length, text: trimmed })
}

export function getTextStats(text: string): TextStats {
  const paragraphs = getParagraphs(text)
  return {
    words: countWords(text),
    characters: text.trim().length,
    paragraphs: paragraphs.length,
    sentences: paragraphs.reduce((sum, p) => sum + getSentences(p).length, 0),
  }
}

export function normalize(text: string) {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
}

export function tokenize(text: string): Range[] {
  const result: Range[] = []
  const re = new RegExp(WORD_RE.source, 'gu')
  let match: RegExpExecArray | null
  while ((match = re.exec(text))) {
    result.push({
      start: match.index,
      end: match.index + match[0].length,
      text: match[0],
    })
  }
  return result
}

/** Case-insensitive regex with Unicode-aware word boundaries (JS `\b` is ASCII-only). */
export function wordPattern(source: string, flags = 'giu') {
  return new RegExp(`(?<![\\p{L}\\p{N}])(?:${source})(?![\\p{L}\\p{N}])`, flags)
}

export function findAll(text: string, re: RegExp, offset = 0): Range[] {
  const result: Range[] = []
  const global = re.global ? re : new RegExp(re.source, re.flags + 'g')
  global.lastIndex = 0
  let match: RegExpExecArray | null
  while ((match = global.exec(text))) {
    if (match[0].length === 0) {
      global.lastIndex++
      continue
    }
    result.push({
      start: offset + match.index,
      end: offset + match.index + match[0].length,
      text: match[0],
    })
  }
  return result
}

export function toRoman(n: number) {
  return ['I', 'II', 'III', 'IV', 'V', 'VI'][n - 1] ?? String(n)
}
