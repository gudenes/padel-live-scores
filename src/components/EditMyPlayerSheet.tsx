'use client'
// src/components/EditMyPlayerSheet.tsx
// Folha de edição do próprio perfil: posição e raquete.
//
// Um lugar só, de propósito. A alternativa — tornar o widget de posição e o
// PlaysWithCard editáveis no lugar — deixaria dois componentes que renderizam
// tanto para o dono quanto para visitantes, com o modo dependendo de quem
// olha. É onde bug de permissão nasce.
//
// O catálogo (68 raquetes, 15 marcas) vem direto do cliente anon: as duas
// tabelas são públicas para leitura. Não há busca porque não há catálogo que
// a justifique.

import { useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'
import { supabase } from '@/lib/supabase'

const ORANGE = '#F5A623'
const GREEN = '#7ED321'
const MUTED = '#8A8A8A'
const CARD = '#141414'
const BG = '#0A0A0A'
const BORDER = '#1C1C1C'
const RED = '#FF4655'

type Side = 'drive' | 'backhand' | null

interface RacketRow {
  id: string
  model: string | null
  year: number | null
  brand: { name: string } | null
}

export interface EditMyPlayerSheetProps {
  open: boolean
  onClose: () => void
  initialSide: Side
  initialRacketId: string | null
  onSaved: () => void
}

export function EditMyPlayerSheet({
  open, onClose, initialSide, initialRacketId, onSaved,
}: EditMyPlayerSheetProps) {
  const t = useTranslations('amateur')
  const [side, setSide] = useState<Side>(initialSide)
  const [racketId, setRacketId] = useState<string | null>(initialRacketId)
  const [rackets, setRackets] = useState<RacketRow[]>([])
  const [saving, setSaving] = useState(false)
  const [failed, setFailed] = useState(false)

  // Reabrir a folha tem que refletir o que está gravado, não o que o usuário
  // digitou e abandonou da última vez. Isso é um reset disparado por uma
  // TRANSIÇÃO de prop (open false→true), não uma sincronização contínua —
  // por isso vive no corpo do render (o padrão que react-hooks aceita para
  // "ajustar estado quando uma prop muda"), e não num useEffect, que o lint
  // rejeita quando o setState é síncrono e incondicional no corpo do efeito.
  const [prevOpen, setPrevOpen] = useState(false)
  if (open !== prevOpen) {
    setPrevOpen(open)
    if (open) {
      setSide(initialSide)
      setRacketId(initialRacketId)
      setFailed(false)
    }
  }

  useEffect(() => {
    // O guard funcional em setRackets protege a escrita, não a chamada de
    // rede — sem isto, reabrir a folha refaz a consulta a cada vez. O
    // catálogo não muda dentro de uma sessão de edição, então uma vez basta.
    if (!open || rackets.length > 0) return
    let cancelled = false
    supabase
      .from('padel_rackets')
      .select('id, model, year, brand:padel_brands(name)')
      .order('model')
      .then(({ data }) => {
        if (cancelled) return
        setRackets(prev => (prev.length > 0 ? prev : (data ?? []) as unknown as RacketRow[]))
      })
    return () => { cancelled = true }
  }, [open, rackets.length])

  // Esc fecha, respeitando o mesmo guard do backdrop: um pedido em voo não
  // pode ser abandonado sem que o usuário veja o resultado.
  useEffect(() => {
    if (!open) return
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !saving) onClose()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [open, saving, onClose])

  if (!open) return null

  const byBrand = new Map<string, RacketRow[]>()
  for (const r of rackets) {
    const key = r.brand?.name ?? '—'
    const list = byBrand.get(key) ?? []
    list.push(r)
    byBrand.set(key, list)
  }
  const brands = [...byBrand.keys()].sort((a, b) => a.localeCompare(b))

  const save = async () => {
    setSaving(true)
    setFailed(false)
    const res = await fetch('/api/me/player', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ side, racketId }),
    }).catch(() => null)
    setSaving(false)
    if (res && res.ok) {
      onSaved()
      onClose()
      return
    }
    setFailed(true)
  }

  return (
    <div
      // Clicar fora durante um save em voo esconderia a falha (ela pintaria
      // numa folha já fechada) ou surpreenderia com um reload depois de o
      // usuário achar que cancelou. Ignora o backdrop até o save assentar.
      onClick={() => { if (!saving) onClose() }}
      style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)',
        display: 'flex', alignItems: 'flex-end', justifyContent: 'center', zIndex: 100,
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={t('editTitle')}
        style={{
          background: BG, width: '100%', maxWidth: 500, maxHeight: '85dvh',
          overflowY: 'auto', borderTop: `1px solid ${BORDER}`, padding: '16px 14px 24px',
        }}
      >
        <div style={{ fontSize: 14, fontWeight: 800, color: '#fff', marginBottom: 14 }}>
          {t('editTitle')}
        </div>

        <div style={{ fontSize: 9, color: MUTED, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 6 }}>
          {t('editPosition')}
        </div>
        <div style={{ display: 'flex', gap: 6, marginBottom: 18 }}>
          {([['drive', t('sideDrive')], ['backhand', t('sideBackhand')], [null, t('editNone')]] as const).map(
            ([value, label]) => (
              <button
                key={label}
                type="button"
                onClick={() => setSide(value as Side)}
                style={{
                  flex: 1, padding: '9px 6px', fontSize: 11, fontWeight: 700, cursor: 'pointer',
                  background: side === value ? ORANGE : CARD,
                  color: side === value ? '#1a0d00' : '#fff',
                  border: 'none', font: 'inherit',
                }}
              >
                {label}
              </button>
            ),
          )}
        </div>

        <div style={{ fontSize: 9, color: MUTED, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 6 }}>
          {t('editRacket')}
        </div>
        <button
          type="button"
          onClick={() => setRacketId(null)}
          style={{
            display: 'block', width: '100%', textAlign: 'left', padding: '8px 10px', marginBottom: 4,
            background: racketId === null ? ORANGE : CARD, color: racketId === null ? '#1a0d00' : MUTED,
            border: 'none', fontSize: 11, cursor: 'pointer', font: 'inherit',
          }}
        >
          {t('editNone')}
        </button>
        {brands.map(brand => (
          <div key={brand} style={{ marginTop: 10 }}>
            <div style={{ fontSize: 9, color: ORANGE, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 4 }}>
              {brand}
            </div>
            {(byBrand.get(brand) ?? []).map(r => (
              <button
                key={r.id}
                type="button"
                onClick={() => setRacketId(r.id)}
                style={{
                  display: 'block', width: '100%', textAlign: 'left', padding: '8px 10px', marginBottom: 3,
                  background: racketId === r.id ? ORANGE : CARD,
                  color: racketId === r.id ? '#1a0d00' : '#fff',
                  border: 'none', fontSize: 11, cursor: 'pointer', font: 'inherit',
                }}
              >
                {r.model ?? r.id}{r.year ? ` · ${r.year}` : ''}
              </button>
            ))}
          </div>
        ))}

        {failed && (
          <div role="alert" style={{ color: RED, fontSize: 11, marginTop: 12 }}>
            {t('editFailed')}
          </div>
        )}

        <button
          type="button"
          onClick={save}
          disabled={saving}
          style={{
            width: '100%', marginTop: 18, padding: '12px 0', background: GREEN, color: '#173404',
            border: 'none', fontSize: 13, fontWeight: 800, cursor: 'pointer', font: 'inherit',
          }}
        >
          {saving ? t('editSaving') : t('editSave')}
        </button>
      </div>
    </div>
  )
}
