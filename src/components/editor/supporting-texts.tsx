import { useRef } from 'react'
import { Plus, Trash } from 'lucide-react'
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { useAutosize } from '@/hooks/use-autosize'
import { toRoman } from '@/lib/workbench/text'

const MAX_TEXTS = 4

type Props = {
  texts: string[]
  onChange: (texts: string[]) => void
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function SupportingTexts({
  texts,
  onChange,
  open,
  onOpenChange,
}: Props) {
  const filled = texts.filter((t) => t.trim()).length

  const add = () => {
    onChange([...texts, ''])
    requestAnimationFrame(() => {
      document.getElementById(`supporting-${texts.length}`)?.focus()
    })
  }

  return (
    <Accordion
      value={open ? ['texts'] : []}
      onValueChange={(v) => onOpenChange(v.includes('texts'))}
    >
      <AccordionItem value="texts" className="border-b-0">
        <AccordionTrigger className="items-center py-3 hover:text-foreground">
          <span className="flex items-center gap-2">
            Textos motivadores
            <Badge variant="muted" className="font-normal">
              {filled
                ? `${filled} ${filled === 1 ? 'texto' : 'textos'}`
                : 'Opcional'}
            </Badge>
          </span>
        </AccordionTrigger>
        <AccordionContent className="space-y-3 pb-2">
          <p className="text-[13px] leading-relaxed text-muted-foreground text-pretty">
            Cole os textos da coletânea. Eles ajudam a identificar trechos
            copiados, que não contam na correção.
          </p>
          {texts.map((text, i) => (
            <SupportingTextItem
              key={i}
              index={i}
              value={text}
              onChange={(value) =>
                onChange(texts.map((t, j) => (j === i ? value : t)))
              }
              onRemove={() => onChange(texts.filter((_, j) => j !== i))}
            />
          ))}
          {texts.length < MAX_TEXTS ? (
            <Button variant="outline" size="sm" onClick={add}>
              <Plus />
              Adicionar texto motivador
            </Button>
          ) : (
            <p className="text-[13px] text-muted-foreground">
              Limite de {MAX_TEXTS} textos motivadores.
            </p>
          )}
        </AccordionContent>
      </AccordionItem>
    </Accordion>
  )
}

function SupportingTextItem({
  index,
  value,
  onChange,
  onRemove,
}: {
  index: number
  value: string
  onChange: (value: string) => void
  onRemove: () => void
}) {
  const ref = useRef<HTMLTextAreaElement>(null)
  useAutosize(ref, value)
  const label = `Texto ${toRoman(index + 1)}`
  return (
    <div className="rounded-lg border bg-background transition-[border-color,box-shadow] duration-150 ease-out focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/15">
      <div className="flex items-center justify-between py-1 pl-3 pr-1">
        <label
          htmlFor={`supporting-${index}`}
          className="font-mono text-[11px] font-medium text-muted-foreground"
        >
          {label.toUpperCase()}
        </label>
        <Button
          variant="subtle"
          size="icon-sm"
          onClick={onRemove}
          aria-label={`Remover ${label}`}
        >
          <Trash className="size-3.5" />
        </Button>
      </div>
      <textarea
        ref={ref}
        id={`supporting-${index}`}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        rows={3}
        placeholder="Cole aqui o texto motivador…"
        className="block max-h-80 min-h-20 w-full resize-none bg-transparent px-3 pb-3 text-base leading-relaxed outline-none placeholder:text-muted-foreground/80 focus-visible:outline-none sm:text-sm"
      />
    </div>
  )
}
