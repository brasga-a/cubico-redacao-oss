import ReactMarkdown from 'react-markdown'
import type { Components } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { cn } from '@/lib/utils'

/**
 * Model output is untrusted: no raw HTML is rendered (react-markdown drops it unless a
 * rehype-raw plugin is added, which we don't), URLs go through the library's safe
 * transform, links open in a new tab without referrer, and images are shown as links.
 */
const components: Components = {
  p: ({ node: _node, ...props }) => <p className="leading-relaxed" {...props} />,
  a: ({ node: _node, ...props }) => (
    <a
      {...props}
      target="_blank"
      rel="noopener noreferrer nofollow"
      className="font-medium underline underline-offset-3"
    />
  ),
  img: ({ src, alt }) =>
    typeof src === 'string' ? (
      <a href={src} target="_blank" rel="noopener noreferrer nofollow" className="underline underline-offset-3">
        {alt || 'imagem'}
      </a>
    ) : null,
  ul: ({ node: _node, ...props }) => <ul className="list-disc space-y-1 pl-5" {...props} />,
  ol: ({ node: _node, ...props }) => <ol className="list-decimal space-y-1 pl-5" {...props} />,
  h1: ({ node: _node, ...props }) => <h3 className="text-base font-semibold" {...props} />,
  h2: ({ node: _node, ...props }) => <h3 className="text-base font-semibold" {...props} />,
  h3: ({ node: _node, ...props }) => <h4 className="text-sm font-semibold" {...props} />,
  blockquote: ({ node: _node, ...props }) => (
    <blockquote className="border-l-2 pl-3 text-muted-foreground" {...props} />
  ),
  pre: ({ node: _node, ...props }) => (
    <pre
      className="overflow-x-auto rounded-lg bg-muted p-3 font-mono text-[13px] leading-relaxed"
      {...props}
    />
  ),
  code: ({ node: _node, className, ...props }) => (
    <code
      className={cn(
        'font-mono text-[13px]',
        !className && 'rounded bg-muted px-1 py-0.5',
        className,
      )}
      {...props}
    />
  ),
  table: ({ node: _node, ...props }) => (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-left text-[13px]" {...props} />
    </div>
  ),
  th: ({ node: _node, ...props }) => <th className="border-b px-2 py-1.5 font-medium" {...props} />,
  td: ({ node: _node, ...props }) => <td className="border-b px-2 py-1.5 align-top" {...props} />,
}

export function ChatMarkdown({ children }: { children: string }) {
  return (
    <div className="flex min-w-0 flex-col gap-3 text-sm">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
        {children}
      </ReactMarkdown>
    </div>
  )
}
