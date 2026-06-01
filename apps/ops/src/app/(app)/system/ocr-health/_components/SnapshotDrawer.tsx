'use client'
// apps/ops/src/app/(app)/system/ocr-health/_components/SnapshotDrawer.tsx
//
// Right-side drawer that pops open when an operator clicks a row in the
// "Recent snapshots" table. Shows:
//   - The retained PNG (if any) overlaid with the calibration bbox and the
//     per-cell columns, each tinted green/red based on whether the cell parsed.
//   - The pretty-printed parsed_score JSON.
//   - Header chips with stream label, capture time, worker version, ok/error.
//
// Closes on ESC or backdrop click. State lives in the parent — this is a
// dumb component driven by `snapshotId | null`.

import { useEffect, useState } from 'react'

interface ColumnSpec {
  x: number
  width: number
}

interface Calibration {
  stream_label?: string
  notes?: string
  scoreboard_bbox: [number, number, number, number]
  row_layout?: string
  pair_label_column?: ColumnSpec
  set_columns?: ColumnSpec[]
  current_set_column?: ColumnSpec
  current_game_column?: ColumnSpec
}

interface ParsedScore {
  pair1_label?: string | null
  pair2_label?: string | null
  sets_completed?: string[]
  current_set_games?: string | null
  current_game?: string | null
  parse_error?: boolean
}

interface SnapshotRow {
  id: number
  captured_at: string
  frame_at: string
  stream_label: string
  youtube_video_id: string
  court_label: string | null
  match_id: string | null
  tournament_id: string | null
  ocr_confidence: number | null
  parsed_score: ParsedScore
  raw_text: string | null
  worker_version: string
  frame_storage_path: string | null
}

interface DetailResponse {
  snapshot: SnapshotRow
  frameUrl: string | null
  calibration: Calibration | null
  calibrationError: string | null
}

interface Props {
  /** The parent only renders this component when a snapshot is open, with
   *  `key={snapshotId}` to force remount per snapshot. So `snapshotId` is
   *  always a real id here — no `| null` state to manage internally. */
  snapshotId: number
  onClose: () => void
}

export default function SnapshotDrawer({ snapshotId, onClose }: Props) {
  const [data, setData] = useState<DetailResponse | null>(null)
  const [error, setError] = useState<string | null>(null)
  const loading = data == null && error == null

  // Fetch on mount. Since the parent supplies `key={snapshotId}`, this only
  // fires once per snapshot — no need to depend on snapshotId here.
  useEffect(() => {
    let alive = true
    fetch(`/api/internal/ocr-snapshot/${snapshotId}`)
      .then(async (res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        return (await res.json()) as DetailResponse
      })
      .then((json) => {
        if (alive) setData(json)
      })
      .catch((e: unknown) => {
        if (alive) setError(e instanceof Error ? e.message : String(e))
      })
    return () => {
      alive = false
    }
  }, [snapshotId])

  // ESC closes the drawer
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <>
      {/* Backdrop */}
      <div
        onClick={onClose}
        style={{
          position: 'fixed',
          inset: 0,
          background: 'rgba(0, 0, 0, 0.35)',
          zIndex: 50,
        }}
      />
      {/* Drawer panel */}
      <div
        role="dialog"
        aria-label="OCR snapshot detail"
        style={{
          position: 'fixed',
          top: 0,
          right: 0,
          bottom: 0,
          width: 'min(720px, 90vw)',
          background: 'var(--bg-card)',
          boxShadow: '-4px 0 16px rgba(0,0,0,0.12)',
          zIndex: 51,
          overflowY: 'auto',
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        <header
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            padding: '16px 20px',
            borderBottom: '1px solid var(--border-card)',
          }}
        >
          <h3 style={{ margin: 0, fontSize: 16, fontWeight: 600, color: 'var(--text-1)' }}>
            Snapshot #{snapshotId}
          </h3>
          <button
            onClick={onClose}
            aria-label="Close drawer"
            style={{
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              fontSize: 20,
              color: 'var(--text-3)',
              lineHeight: 1,
              padding: 4,
            }}
          >
            ×
          </button>
        </header>

        <div style={{ padding: 20, flex: 1 }}>
          {loading && <div style={{ color: 'var(--text-3)' }}>Loading…</div>}
          {error && <div style={{ color: 'var(--live-text)' }}>Error: {error}</div>}
          {data && <DrawerBody data={data} />}
        </div>
      </div>
    </>
  )
}

function DrawerBody({ data }: { data: DetailResponse }) {
  const { snapshot, frameUrl, calibration, calibrationError } = data
  const isErr = snapshot.parsed_score?.parse_error === true

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      {/* Header chips */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
        <Chip label="Stream" value={snapshot.stream_label} mono />
        <Chip label="Captured" value={formatFullTime(snapshot.captured_at)} />
        <Chip label="Court" value={snapshot.court_label ?? '—'} />
        <Chip
          label="Confidence"
          value={
            snapshot.ocr_confidence != null
              ? snapshot.ocr_confidence.toFixed(2)
              : '—'
          }
        />
        <Chip
          label="Status"
          value={isErr ? 'parse_error' : 'ok'}
          tone={isErr ? 'error' : 'ok'}
        />
        <Chip label="Worker" value={snapshot.worker_version.slice(0, 10)} mono />
      </div>

      {/* Frame + overlay */}
      <Section title="Frame">
        {frameUrl ? (
          calibration ? (
            <FrameWithOverlay
              src={frameUrl}
              calibration={calibration}
              parsed={snapshot.parsed_score}
            />
          ) : (
            // Frame exists but no calibration — render the raw frame and warn
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={frameUrl}
                alt="OCR captured frame"
                style={{ width: '100%', borderRadius: 6 }}
              />
              <div style={{ fontSize: 12, color: 'var(--live-text)' }}>
                Calibration JSON missing for <code>{snapshot.stream_label}</code>
                {calibrationError ? `: ${calibrationError}` : ''}. Overlay
                disabled.
              </div>
            </div>
          )
        ) : (
          <EmptyHint>
            No frame stored for this snapshot. The worker only retains frames
            below the confidence threshold + a small random sample (default 1%).
            Set <code>OCR_FRAME_RETENTION_RATE=1.0</code> on the Railway service
            and wait for the next snapshot to see every frame here.
          </EmptyHint>
        )}
      </Section>

      {/* Parsed score JSON */}
      <Section title="Parsed score">
        <pre
          style={{
            background: 'var(--bg-card-2)',
            color: 'var(--text-2)',
            padding: 12,
            borderRadius: 6,
            fontSize: 12,
            overflowX: 'auto',
            margin: 0,
          }}
        >
          {JSON.stringify(snapshot.parsed_score, null, 2)}
        </pre>
      </Section>

      {snapshot.raw_text && (
        <Section title="Raw OCR text (V1 pipeline only)">
          <pre
            style={{
              background: 'var(--bg-card-2)',
              color: 'var(--text-2)',
              padding: 12,
              borderRadius: 6,
              fontSize: 12,
              overflowX: 'auto',
              margin: 0,
              whiteSpace: 'pre-wrap',
            }}
          >
            {snapshot.raw_text}
          </pre>
        </Section>
      )}
    </div>
  )
}

// ─── overlay rendering ─────────────────────────────────────────────────────

interface CellOverlay {
  label: string
  /** rectangle in scoreboard-relative pixel coords */
  x: number
  y: number
  width: number
  height: number
  parsedValue: string | null
  ok: boolean
}

/**
 * Render the frame image with the calibration bbox + per-cell overlays drawn
 * on top. The frame is rendered at its natural aspect ratio scaled to the
 * drawer width; overlays are scaled by `naturalWidth / displayedWidth` via a
 * ResizeObserver-free trick — we use percentage-based positioning relative to
 * a positioned wrapper, where each cell's coordinate space is the
 * scoreboard_bbox dimensions inflated to the full frame.
 *
 * Two coordinate systems involved:
 *   1. Frame pixel coords (e.g. 1920 × 1080) — the calibration scoreboard_bbox
 *      sits inside this space.
 *   2. Scoreboard-relative coords — each column's x/width is relative to the
 *      cropped scoreboard region (the worker's `crop` ndarray).
 *
 * We need to express overlays as % of the *frame*, so we offset the column
 * coords by scoreboard_bbox[x] / [y] first.
 */
function FrameWithOverlay({
  src,
  calibration,
  parsed,
}: {
  src: string
  calibration: Calibration
  parsed: ParsedScore
}) {
  const [imgSize, setImgSize] = useState<{ w: number; h: number } | null>(null)

  const [sbX, sbY, sbW, sbH] = calibration.scoreboard_bbox
  const rowHeight = Math.floor(sbH / 2)

  // Build the cell rectangles. Half the frame is pair1 (top), half is pair2
  // (bottom). Each column spans full row height.
  const cells: CellOverlay[] = []

  function addCell(
    label: string,
    col: ColumnSpec | undefined,
    rowIndex: 0 | 1,
    parsedValue: string | null,
  ) {
    if (!col) return
    cells.push({
      label,
      x: sbX + col.x,
      y: sbY + rowIndex * rowHeight,
      width: col.width,
      height: rowHeight,
      parsedValue,
      ok: parsedValue != null && parsedValue !== '',
    })
  }

  // Decompose current_set_games "2-0" into "2" (pair1) and "0" (pair2)
  const csParts = parsed.current_set_games?.split('-') ?? []
  const cgParts = parsed.current_game?.split('-') ?? []

  // Pair labels span the label column; the parsed string is the full name.
  addCell('Pair 1', calibration.pair_label_column, 0, parsed.pair1_label ?? null)
  addCell('Pair 2', calibration.pair_label_column, 1, parsed.pair2_label ?? null)

  // Set columns: parsed values come from sets_completed[i].split('-')[rowIndex]
  ;(calibration.set_columns ?? []).forEach((col, i) => {
    const completedScore = parsed.sets_completed?.[i] ?? null
    const parts = completedScore?.split('-') ?? []
    addCell(`Set ${i + 1}`, col, 0, parts[0] ?? null)
    addCell(`Set ${i + 1}`, col, 1, parts[1] ?? null)
  })

  addCell('Cur set', calibration.current_set_column, 0, csParts[0] ?? null)
  addCell('Cur set', calibration.current_set_column, 1, csParts[1] ?? null)
  addCell('Cur game', calibration.current_game_column, 0, cgParts[0] ?? null)
  addCell('Cur game', calibration.current_game_column, 1, cgParts[1] ?? null)

  // Scoreboard bbox itself, rendered as a yellow outline.
  const scoreboardOverlay = {
    x: sbX,
    y: sbY,
    width: sbW,
    height: sbH,
  }

  return (
    <div
      style={{
        position: 'relative',
        width: '100%',
        background: '#000',
        borderRadius: 6,
        overflow: 'hidden',
      }}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={src}
        alt="OCR captured frame"
        onLoad={(e) => {
          const t = e.target as HTMLImageElement
          setImgSize({ w: t.naturalWidth, h: t.naturalHeight })
        }}
        style={{ width: '100%', display: 'block' }}
      />
      {imgSize && (
        <>
          {/* scoreboard outline */}
          <div
            style={{
              position: 'absolute',
              left: `${(scoreboardOverlay.x / imgSize.w) * 100}%`,
              top: `${(scoreboardOverlay.y / imgSize.h) * 100}%`,
              width: `${(scoreboardOverlay.width / imgSize.w) * 100}%`,
              height: `${(scoreboardOverlay.height / imgSize.h) * 100}%`,
              border: '2px solid #facc15', // yellow-400
              boxSizing: 'border-box',
              pointerEvents: 'none',
            }}
          />
          {cells.map((cell, i) => (
            <div
              key={i}
              title={`${cell.label}: ${cell.parsedValue ?? 'null'}`}
              style={{
                position: 'absolute',
                left: `${(cell.x / imgSize.w) * 100}%`,
                top: `${(cell.y / imgSize.h) * 100}%`,
                width: `${(cell.width / imgSize.w) * 100}%`,
                height: `${(cell.height / imgSize.h) * 100}%`,
                border: `1.5px solid ${cell.ok ? '#22c55e' : '#ef4444'}`,
                background: cell.ok
                  ? 'rgba(34, 197, 94, 0.12)'
                  : 'rgba(239, 68, 68, 0.18)',
                boxSizing: 'border-box',
                pointerEvents: 'none',
                fontSize: 9,
                color: '#fff',
                textShadow: '0 0 2px rgba(0,0,0,0.9)',
                padding: '1px 2px',
                fontFamily: 'monospace',
                overflow: 'hidden',
                whiteSpace: 'nowrap',
              }}
            >
              {cell.parsedValue ?? '∅'}
            </div>
          ))}
        </>
      )}
    </div>
  )
}

// ─── small helpers (mirrors the parent file's pattern; kept local to avoid
//     touching the parent's helpers section) ───────────────────────────────

function Section({
  title,
  children,
}: {
  title: string
  children: React.ReactNode
}) {
  return (
    <div>
      <h4
        style={{
          fontSize: 13,
          fontWeight: 500,
          margin: '0 0 8px 0',
          color: 'var(--text-3)',
          textTransform: 'uppercase',
          letterSpacing: 0.5,
        }}
      >
        {title}
      </h4>
      {children}
    </div>
  )
}

function EmptyHint({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        fontSize: 13,
        color: 'var(--text-3)',
        border: '1px dashed var(--border-card)',
        borderRadius: 6,
        padding: 12,
        lineHeight: 1.5,
      }}
    >
      {children}
    </div>
  )
}

function Chip({
  label,
  value,
  mono,
  tone,
}: {
  label: string
  value: string
  mono?: boolean
  tone?: 'ok' | 'error'
}) {
  const color =
    tone === 'error'
      ? 'var(--live-text)'
      : tone === 'ok'
        ? 'var(--lime-text)'
        : 'var(--text-1)'
  return (
    <div
      style={{
        border: '1px solid var(--border-card)',
        borderRadius: 4,
        padding: '4px 8px',
        fontSize: 11,
        display: 'inline-flex',
        gap: 6,
        alignItems: 'baseline',
      }}
    >
      <span
        style={{
          color: 'var(--text-3)',
          textTransform: 'uppercase',
          letterSpacing: 0.5,
        }}
      >
        {label}
      </span>
      <span
        style={{
          fontFamily: mono ? 'monospace' : 'inherit',
          color,
          fontSize: 12,
        }}
      >
        {value}
      </span>
    </div>
  )
}

function formatFullTime(iso: string): string {
  try {
    return new Date(iso).toLocaleString([], {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    })
  } catch {
    return iso
  }
}
