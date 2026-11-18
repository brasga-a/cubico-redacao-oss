export { cn } from "cn"

export function pluralize(count: number, singular: string, plural: string) {
  return `${count.toLocaleString('pt-BR')} ${count === 1 ? singular : plural}`
}

export function formatDate(iso: string, options?: Intl.DateTimeFormatOptions) {
  return new Intl.DateTimeFormat(
    'pt-BR',
    options ?? { day: '2-digit', month: 'short', year: 'numeric' },
  ).format(new Date(iso))
}

export function formatDateTime(iso: string) {
  return new Intl.DateTimeFormat('pt-BR', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(iso))
}
