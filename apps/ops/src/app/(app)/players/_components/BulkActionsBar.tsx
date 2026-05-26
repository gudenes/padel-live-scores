'use client'

import { useState, useEffect } from 'react'

interface BulkActionsBarProps {
  selectedCount: number
  selectedIds: string[]
  onClearSelection: () => void
  onBulkComplete: () => void
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
          background: '#f0f7ff',
          border: '1px solid #bfdbfe',
          borderRadius: 8,
          padding: '10px 16px',
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          marginBottom: 12,
        }}
      >
        <span style={{ color: '#1d4ed8', fontWeight: 600, fontSize: 14 }}>
          {selectedCount} selected
        </span>
        <div style={{ flex: 1 }} />
        <button
          onClick={openModal}
          style={{
            background: '#1d4ed8',
            color: '#fff',
            border: 'none',
            borderRadius: 6,
            padding: '6px 14px',
            fontSize: 13,
            fontWeight: 600,
            cursor: 'pointer',
          }}
        >
          Assign Equipment
        </button>
        <button
          onClick={onClearSelection}
          style={{
            background: 'transparent',
            color: '#6b7280',
            border: '1px solid #d1d5db',
            borderRadius: 6,
            padding: '6px 12px',
            fontSize: 13,
            cursor: 'pointer',
          }}
        >
          Clear
        </button>
      </div>

      {/* Modal overlay */}
      {showModal && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.45)',
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
              background: '#fff',
              borderRadius: 12,
              padding: 28,
              width: 400,
              maxWidth: '90vw',
              boxShadow: '0 20px 60px rgba(0,0,0,0.2)',
            }}
          >
            <h3 style={{ margin: '0 0 6px', color: '#111', fontSize: 18, fontWeight: 700 }}>
              Assign Equipment
            </h3>
            <p style={{ margin: '0 0 20px', color: '#6b7280', fontSize: 13 }}>
              Assigning to {selectedCount} player{selectedCount !== 1 ? 's' : ''}. This will end any current assignment.
            </p>

            {loading ? (
              <p style={{ color: '#6b7280', fontSize: 13 }}>Loading brands...</p>
            ) : (
              <>
                {/* Brand dropdown */}
                <label style={{ display: 'block', marginBottom: 12 }}>
                  <span style={{ fontSize: 12, fontWeight: 600, color: '#374151', display: 'block', marginBottom: 4 }}>
                    Brand
                  </span>
                  <select
                    value={selectedBrandId}
                    onChange={(e) => setSelectedBrandId(e.target.value)}
                    style={{
                      width: '100%',
                      padding: '8px 10px',
                      border: '1px solid #d1d5db',
                      borderRadius: 6,
                      fontSize: 14,
                      color: '#111',
                      background: '#fff',
                    }}
                  >
                    <option value="">Select a brand...</option>
                    {brands.map((b) => (
                      <option key={b.id} value={b.id}>
                        {b.name}
                      </option>
                    ))}
                  </select>
                </label>

                {/* Racket dropdown */}
                <label style={{ display: 'block', marginBottom: 20 }}>
                  <span style={{ fontSize: 12, fontWeight: 600, color: '#374151', display: 'block', marginBottom: 4 }}>
                    Racket
                  </span>
                  <select
                    value={selectedRacketId}
                    onChange={(e) => setSelectedRacketId(e.target.value)}
                    disabled={!selectedBrandId}
                    style={{
                      width: '100%',
                      padding: '8px 10px',
                      border: '1px solid #d1d5db',
                      borderRadius: 6,
                      fontSize: 14,
                      color: selectedBrandId ? '#111' : '#9ca3af',
                      background: selectedBrandId ? '#fff' : '#f9fafb',
                      cursor: selectedBrandId ? 'auto' : 'not-allowed',
                    }}
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
                </label>
              </>
            )}

            {error && (
              <p style={{ color: '#dc2626', fontSize: 13, marginBottom: 12 }}>{error}</p>
            )}

            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
              <button
                onClick={closeModal}
                style={{
                  background: 'transparent',
                  color: '#374151',
                  border: '1px solid #d1d5db',
                  borderRadius: 6,
                  padding: '8px 16px',
                  fontSize: 14,
                  cursor: 'pointer',
                }}
              >
                Cancel
              </button>
              <button
                onClick={handleAssign}
                disabled={!selectedRacketId || assigning}
                style={{
                  background: selectedRacketId && !assigning ? '#1d4ed8' : '#93c5fd',
                  color: '#fff',
                  border: 'none',
                  borderRadius: 6,
                  padding: '8px 18px',
                  fontSize: 14,
                  fontWeight: 600,
                  cursor: selectedRacketId && !assigning ? 'pointer' : 'not-allowed',
                }}
              >
                {assigning ? 'Assigning...' : 'Assign'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
