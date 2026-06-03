'use client'

import { useState, useEffect } from 'react'
import { Field, Button } from '@/components/ui'

interface BulkActionsBarProps {
  selectedCount: number
  selectedIds: string[]
  onClearSelection: () => void
  onBulkComplete: () => void
  onMergeSelected: (ids: string[]) => void
}

interface Brand {
  id: string
  name: string
  logo_url?: string
}

interface Racket {
  id: string
  model: string
  year?: number
  brand_id: string
}

export default function BulkActionsBar({
  selectedCount,
  selectedIds,
  onClearSelection,
  onBulkComplete,
  onMergeSelected,
}: BulkActionsBarProps) {
  const [showModal, setShowModal] = useState(false)
  const [brands, setBrands] = useState<Brand[]>([])
  const [rackets, setRackets] = useState<Racket[]>([])
  const [selectedBrandId, setSelectedBrandId] = useState('')
  const [selectedRacketId, setSelectedRacketId] = useState('')
  const [loading, setLoading] = useState(false)
  const [assigning, setAssigning] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!showModal) return
    setLoading(true)
    fetch('/api/internal/brands')
      .then((r) => r.json())
      .then((data) => {
        setBrands(data.brands ?? [])
        setLoading(false)
      })
      .catch(() => {
        setError('Failed to load brands')
        setLoading(false)
      })
  }, [showModal])

  useEffect(() => {
    if (!selectedBrandId) {
      setRackets([])
      setSelectedRacketId('')
      return
    }
    fetch(`/api/internal/rackets?brand_id=${selectedBrandId}`)
      .then((r) => r.json())
      .then((data) => {
        setRackets(data.rackets ?? [])
        setSelectedRacketId('')
      })
      .catch(() => setError('Failed to load rackets'))
  }, [selectedBrandId])

  function openModal() {
    setShowModal(true)
    setSelectedBrandId('')
    setSelectedRacketId('')
    setRackets([])
    setError(null)
  }

  function closeModal() {
    setShowModal(false)
    setError(null)
  }

  async function handleAssign() {
    if (!selectedRacketId) return
    setAssigning(true)
    setError(null)
    try {
      const res = await fetch('/api/internal/player-equipment', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ player_ids: selectedIds, racket_id: selectedRacketId }),
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error ?? 'Assignment failed')
        return
      }
      closeModal()
      onClearSelection()
      onBulkComplete()
    } catch {
      setError('Network error — please try again')
    } finally {
      setAssigning(false)
    }
  }

  if (selectedCount === 0) return null

  return (
    <>
      {/* Info bar */}
      <div
        style={{
          background: 'var(--bg-sel)',
          border: '1px solid var(--lime-border)',
          borderRadius: 'var(--r-sm)',
          padding: '10px 16px',
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          marginBottom: 12,
        }}
      >
        <span style={{ color: 'var(--lime-text)', fontWeight: 600, fontSize: 14 }}>
          {selectedCount} selected
        </span>
        <div style={{ flex: 1 }} />
        {selectedCount === 2 && (
          <Button variant="primary" size="sm" onClick={() => onMergeSelected(selectedIds)}>
            Merge selected
          </Button>
        )}
        <Button variant="primary" size="sm" onClick={openModal}>
          Assign Equipment
        </Button>
        <Button size="sm" onClick={onClearSelection}>
          Clear
        </Button>
      </div>

      {/* Modal overlay */}
      {showModal && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.5)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1000,
          }}
          onClick={(e) => {
            if (e.target === e.currentTarget) closeModal()
          }}
        >
          <div
            style={{
              background: 'var(--bg-surface)',
              border: '1px solid var(--border-card)',
              borderRadius: 'var(--r-lg)',
              padding: 28,
              width: 400,
              maxWidth: '90vw',
              boxShadow: 'var(--shadow-lg)',
            }}
          >
            <h3 style={{ margin: '0 0 6px', color: 'var(--text-1)', fontSize: 18, fontWeight: 700 }}>
              Assign Equipment
            </h3>
            <p style={{ margin: '0 0 20px', color: 'var(--text-2)', fontSize: 13 }}>
              Assigning to {selectedCount} player{selectedCount !== 1 ? 's' : ''}. This will end any current assignment.
            </p>

            {loading ? (
              <p style={{ color: 'var(--text-2)', fontSize: 13 }}>Loading brands...</p>
            ) : (
              <>
                {/* Brand dropdown */}
                <div style={{ marginBottom: 12 }}>
                  <Field label="Brand">
                    <select
                      className="ui-select"
                      value={selectedBrandId}
                      onChange={(e) => setSelectedBrandId(e.target.value)}
                    >
                      <option value="">Select a brand...</option>
                      {brands.map((b) => (
                        <option key={b.id} value={b.id}>
                          {b.name}
                        </option>
                      ))}
                    </select>
                  </Field>
                </div>

                {/* Racket dropdown */}
                <div style={{ marginBottom: 20 }}>
                  <Field label="Racket">
                    <select
                      className="ui-select"
                      value={selectedRacketId}
                      onChange={(e) => setSelectedRacketId(e.target.value)}
                      disabled={!selectedBrandId}
                    >
                      <option value="">
                        {selectedBrandId ? 'Select a racket...' : 'Select brand first'}
                      </option>
                      {rackets.map((r) => (
                        <option key={r.id} value={r.id}>
                          {r.model}{r.year ? ` (${r.year})` : ''}
                        </option>
                      ))}
                    </select>
                  </Field>
                </div>
              </>
            )}

            {error && (
              <p style={{ color: 'var(--live-text)', fontSize: 13, marginBottom: 12 }}>{error}</p>
            )}

            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
              <Button onClick={closeModal}>Cancel</Button>
              <Button
                variant="primary"
                onClick={handleAssign}
                disabled={!selectedRacketId || assigning}
              >
                {assigning ? 'Assigning...' : 'Assign'}
              </Button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
