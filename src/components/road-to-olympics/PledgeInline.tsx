'use client'

import { useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'
import PledgeFormModal from './PledgeFormModal'
import { GREEN, GREEN_DIM, CHUNKY } from '@/components/home/shared'

interface Props {
  initialCount: number
}

export default function PledgeInline({ initialCount }: Props) {
  const t = useTranslations('roadToOlympics.pledge')
  const [count, setCount] = useState(initialCount)
  const [open, setOpen] = useState(false)

  // Refetch the count: on mount (in case SSR was stale), and again whenever
  // the modal closes (handles both submit and cancel — at most one extra
  // round-trip per session).
  function refresh() {
    fetch('/api/road-to-olympics/pledges/count', { cache: 'no-store' })
      .then((r) => r.json())
      .then((j) => { if (typeof j.count === 'number') setCount(j.count) })
      .catch(() => {})
  }
  useEffect(() => { refresh() }, [])

  function handleClose() {
    setOpen(false)
    refresh()
  }

  return (
    <>
      <div style={{
        background: GREEN_DIM,
        border: '1px solid rgba(126,211,33,0.25)',
        clipPath: CHUNKY.card,
        padding: '12px 14px',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        gap: 12,
        marginBottom: 12,
      }}>
        <div style={{ fontSize: 13, color: '#ccc', lineHeight: 1.4 }}>
          <strong style={{ color: GREEN, fontWeight: 800 }}>
            {count.toLocaleString('en-US')}
          </strong>{' '}
          {t('inlineSuffix')}
          <br />
          {t('inlineSub')}
        </div>
        <button
          type="button"
          onClick={() => setOpen(true)}
          style={{
            background: GREEN, color: '#0a0a0a', fontWeight: 800,
            fontSize: 11, padding: '7px 14px', clipPath: CHUNKY.button,
            letterSpacing: 0.5, border: 0, whiteSpace: 'nowrap', cursor: 'pointer',
          }}
        >
          {t('ctaPrimary')}
        </button>
      </div>

      {open && <PledgeFormModal onClose={handleClose} />}
    </>
  )
}
