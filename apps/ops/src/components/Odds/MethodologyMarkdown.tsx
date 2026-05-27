'use client'

import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

export function MethodologyMarkdown({ source }: { source: string }) {
  return (
    <div className="methodology-md" style={{ maxWidth: 900, lineHeight: 1.6 }}>
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{source}</ReactMarkdown>
      <style>{`
        .methodology-md h1 { font-size: 22px; font-weight: 700; margin: 32px 0 12px; }
        .methodology-md h2 { font-size: 18px; font-weight: 700; margin: 28px 0 10px; }
        .methodology-md h3 { font-size: 15px; font-weight: 700; margin: 20px 0 8px; }
        .methodology-md table { border-collapse: collapse; margin: 12px 0; font-size: 13px; }
        .methodology-md th, .methodology-md td { padding: 6px 10px; border: 1px solid var(--border-subtle); text-align: left; }
        .methodology-md code { background: var(--bg-canvas); padding: 1px 4px; border-radius: 2px; font-size: 12px; }
        .methodology-md pre { background: var(--bg-canvas); padding: 12px; border-radius: 4px; overflow: auto; }
        .methodology-md ul, .methodology-md ol { padding-left: 24px; }
      `}</style>
    </div>
  )
}
