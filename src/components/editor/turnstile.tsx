import { useEffect, useRef } from 'react'

type TurnstileApi = {
  render: (
    container: HTMLElement,
    options: {
      sitekey: string
      callback?: (token: string) => void
      'expired-callback'?: () => void
      'error-callback'?: () => void
    },
  ) => string
  reset: (widgetId?: string) => void
  remove?: (widgetId?: string) => void
}

declare global {
  interface Window {
    turnstile?: TurnstileApi
  }
}

export function Turnstile({
  siteKey,
  onToken,
  reset,
}: {
  siteKey: string
  onToken: (v: string) => void
  reset: number
}) {
  const turnstileContainerRef = useRef<HTMLDivElement>(null),
    turnstileWidgetIdRef = useRef<string | null>(null)
  useEffect(() => {
    const container = turnstileContainerRef.current
    if (!siteKey || !container) {
      onToken('')
      return
    }

    let cancelled = false
    const mountWidget = () => {
      if (cancelled || !window.turnstile || !turnstileContainerRef.current) {
        return
      }
      if (turnstileWidgetIdRef.current) {
        try {
          window.turnstile.remove?.(turnstileWidgetIdRef.current)
        } catch {
          // Ignore widget cleanup errors on remount.
        }
        turnstileWidgetIdRef.current = null
      }
      turnstileContainerRef.current.innerHTML = ''
      turnstileWidgetIdRef.current = window.turnstile.render(
        turnstileContainerRef.current,
        {
          sitekey: siteKey,
          callback: (token: string) => onToken(token),
          'expired-callback': () => onToken(''),
          'error-callback': () => onToken(''),
        },
      )
    }

    if (window.turnstile) {
      mountWidget()
    } else {
      const existingScript = document.querySelector<HTMLScriptElement>(
        'script[data-turnstile-script="true"]',
      )
      if (existingScript) {
        existingScript.addEventListener('load', mountWidget, { once: true })
      } else {
        const script = document.createElement('script')
        script.src =
          'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit'
        script.async = true
        script.defer = true
        script.dataset.turnstileScript = 'true'
        script.addEventListener('load', mountWidget, { once: true })
        document.head.appendChild(script)
      }
    }

    return () => {
      cancelled = true
    }
  }, [siteKey, onToken])

  useEffect(() => {
    if (turnstileWidgetIdRef.current) {
      window.turnstile?.reset(turnstileWidgetIdRef.current)
      onToken('')
    }
  }, [reset, onToken])
  return <div ref={turnstileContainerRef} />
}
