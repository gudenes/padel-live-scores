'use client'

import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

export function MethodologyMarkdown({ source }: { source: string }) {
  return (
    <div className="methodology-md" style={{ maxWidth: 900, lineHeight: 1.6, color: 'var(--text-2)' }}>
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{source}</ReactMarkdown>
      <style>{`
        .methodology-md h1 { font-size: 22px; font-weight: 700; margin: 32px 0 12px; color: var(--text-1); }
        .methodology-md h2 { font-size: 18px; font-weight: 700; margin: 28px 0 10px; color: var(--text-1); }
        .methodology-md h3 { font-size: 15px; font-weight: 700; margin: 20px 0 8px; color: var(--text-1); }
        .methodology-md a { color: var(--lime-text); }
        .methodology-md table { border-collapse: collapse; margin: 12px 0; font-size: 13px; }
        .methodology-md th, .methodology-md td { padding: 6px 10px; border: 1px solid var(--border-card); text-align: left; }
        .methodology-md th { background: var(--bg-card-2); color: var(--text-1); }
        .methodology-md code { background: var(--bg-sunken); padding: 1px 4px; border-radius: var(--r-xs); font-size: 12px; }
        .methodology-md pre { background: var(--bg-sunken); padding: 12px; border-radius: var(--r-sm); overflow: auto; }
        .methodology-md ul, .methodology-md ol { padding-left: 24px; }
      `}</style>
    </div>
  )
}
