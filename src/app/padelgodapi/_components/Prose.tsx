// src/app/padelgodapi/_components/Prose.tsx
// Shared typographic styles for long-form docs content. Wrap page bodies
// with <Prose> so every <h2>, <p>, <code>, <table>, etc. picks up consistent
// spacing, contrast, and tone without repeating utility classes on every node.

import type { ReactNode } from 'react'

interface ProseProps {
  children: ReactNode
}

export function Prose({ children }: ProseProps) {
  return (
    <div
      className="
        max-w-3xl
        text-[var(--text-secondary)]
        leading-relaxed

        [&_h2]:mt-12 [&_h2]:mb-4 [&_h2]:font-display [&_h2]:text-2xl [&_h2]:font-bold
        [&_h2]:text-[var(--text-primary)] [&_h2]:tracking-tight
        [&_h2]:pb-2 [&_h2]:border-b [&_h2]:border-[var(--border-base)]

        [&_h3]:mt-8 [&_h3]:mb-3 [&_h3]:font-display [&_h3]:text-xl [&_h3]:font-semibold
        [&_h3]:text-[var(--text-primary)] [&_h3]:tracking-tight

        [&_h4]:mt-6 [&_h4]:mb-2 [&_h4]:text-base [&_h4]:font-semibold
        [&_h4]:text-[var(--text-primary)] [&_h4]:uppercase [&_h4]:tracking-wider [&_h4]:text-sm

        [&_p]:my-4
        [&_p_strong]:text-[var(--text-primary)] [&_p_strong]:font-semibold

        [&_ul]:my-4 [&_ul]:space-y-1 [&_ul]:pl-0 [&_ul]:list-none
        [&_ul>li]:relative [&_ul>li]:pl-5
        [&_ul>li]:before:absolute [&_ul>li]:before:left-0 [&_ul>li]:before:top-[0.6em]
        [&_ul>li]:before:h-1.5 [&_ul>li]:before:w-1.5
        [&_ul>li]:before:rounded-full [&_ul>li]:before:bg-[var(--color-accent)]

        [&_ol]:my-4 [&_ol]:space-y-1 [&_ol]:list-decimal [&_ol]:pl-6
        [&_ol_li]:marker:text-[var(--text-muted)]

        [&_a]:text-[var(--color-accent)] [&_a]:underline [&_a]:decoration-[var(--color-accent-border)]
        [&_a:hover]:decoration-[var(--color-accent)]

        [&_code]:rounded [&_code]:bg-[var(--bg-base)] [&_code]:px-1.5 [&_code]:py-0.5
        [&_code]:text-[13px] [&_code]:text-[var(--text-primary)]
        [&_code]:border [&_code]:border-[var(--border-base)]

        [&_pre]:my-6 [&_pre]:rounded-lg [&_pre]:border [&_pre]:border-[var(--border-base)]
        [&_pre]:bg-[var(--bg-card-alt)] [&_pre]:p-4 [&_pre]:overflow-x-auto
        [&_pre_code]:bg-transparent [&_pre_code]:border-0 [&_pre_code]:p-0 [&_pre_code]:text-sm

        [&_table]:my-6 [&_table]:w-full [&_table]:text-sm [&_table]:border-collapse
        [&_thead_th]:border-b [&_thead_th]:border-[var(--border-strong)]
        [&_thead_th]:bg-[var(--bg-subtle)] [&_thead_th]:px-3 [&_thead_th]:py-2
        [&_thead_th]:text-left [&_thead_th]:font-semibold [&_thead_th]:text-[var(--text-primary)]
        [&_thead_th]:text-xs [&_thead_th]:uppercase [&_thead_th]:tracking-wider
        [&_tbody_td]:border-b [&_tbody_td]:border-[var(--border-base)]
        [&_tbody_td]:px-3 [&_tbody_td]:py-2 [&_tbody_td]:align-top
        [&_tbody_tr:hover]:bg-[var(--bg-subtle)]

        [&_blockquote]:my-6 [&_blockquote]:border-l-2 [&_blockquote]:border-[var(--color-accent)]
        [&_blockquote]:pl-4 [&_blockquote]:italic [&_blockquote]:text-[var(--text-muted)]

        [&_hr]:my-10 [&_hr]:border-[var(--border-base)]
      "
    >
      {children}
    </div>
  )
}
