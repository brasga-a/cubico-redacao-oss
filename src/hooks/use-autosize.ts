import { useLayoutEffect } from 'react'
import type { RefObject } from 'react'

const supportsFieldSizing =
  typeof CSS !== 'undefined' && CSS.supports('field-sizing', 'content')

/** Grows a textarea with its content. Uses CSS `field-sizing` where available. */
export function useAutosize(
  ref: RefObject<HTMLTextAreaElement | null>,
  value: string,
) {
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    if (supportsFieldSizing) {
      el.style.setProperty('field-sizing', 'content')
      return
    }
    const scrollY = window.scrollY
    el.style.height = 'auto'
    el.style.height = `${el.scrollHeight}px`
    if (window.scrollY !== scrollY) window.scrollTo({ top: scrollY })
  }, [ref, value])
}
