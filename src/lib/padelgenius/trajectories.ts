// src/lib/padelgenius/trajectories.ts
import type { IntroAnimation, Trajectory, TrajectoryStyle } from './types'

/**
 * Resolve the ordered segment list for an intro animation, falling back to
 * the legacy `trajectory + bounce` shape when `segments` is absent. Returns
 * an empty array when no intro is configured.
 */
export function introSegments(intro: IntroAnimation | undefined | null): Trajectory[] {
  if (!intro) return []
  if (intro.segments && intro.segments.length > 0) return intro.segments
  const legs: Trajectory[] = []
  if (intro.trajectory) legs.push(intro.trajectory)
  if (intro.bounce) legs.push(intro.bounce)
  return legs
}

type Point = [number, number]

/**
 * Returns an SVG path `d` string for the given trajectory style and endpoints.
 *
 * When `controlPoint` is provided (already in SVG coords), it overrides the
 * style's preset curve as a quadratic Bezier through (from, controlPoint, to).
 * Style still drives visual decorations elsewhere (dashes, spin markers, etc.).
 */
export function trajectoryPath(
  style: TrajectoryStyle,
  from: Point,
  to: Point,
  controlPoint?: Point,
): string {
  const [x1, y1] = from
  const [x2, y2] = to

  // User-provided apex always wins — quadratic Bezier through it.
  if (controlPoint) {
    const [cx, cy] = controlPoint
    return `M ${x1} ${y1} Q ${cx} ${cy} ${x2} ${y2}`
  }

  switch (style) {
    case 'cross':
      return `M ${x1} ${y1} L ${x2} ${y2}`

    case 'flat': {
      // Slight asymmetric arc (was a straight line; matches the prior bandeja
      // curvature so every drive feels organic rather than ruler-straight).
      const cx = x1 + (x2 - x1) * 0.7
      const cy = y1 + (y2 - y1) * 0.3 - 20
      return `M ${x1} ${y1} Q ${cx} ${cy} ${x2} ${y2}`
    }

    case 'lob': {
      // Tall arch — control point is high above the midpoint
      const cx = (x1 + x2) / 2
      const cy = Math.min(y1, y2) - 120
      return `M ${x1} ${y1} Q ${cx} ${cy} ${x2} ${y2}`
    }

    case 'bandeja': {
      // Much deeper slice now — control point pulled noticeably higher so the
      // arc reads as a clear over-the-shoulder defensive shot rather than a
      // gentle drive.
      const cx = x1 + (x2 - x1) * 0.7
      const cy = y1 + (y2 - y1) * 0.3 - 55
      return `M ${x1} ${y1} Q ${cx} ${cy} ${x2} ${y2}`
    }

    case 'vibora': {
      // Steeper, more aggressive — control point lower (more downward bend)
      const cx = x1 + (x2 - x1) * 0.5
      const cy = y1 + (y2 - y1) * 0.5 + 10
      return `M ${x1} ${y1} Q ${cx} ${cy} ${x2} ${y2}`
    }

    case 'smash':
      // Steep downward straight line — same path as flat but caller styles it thicker/red
      return `M ${x1} ${y1} L ${x2} ${y2}`

    case 'chiquita': {
      // Short low arc — small bump
      const cx = (x1 + x2) / 2
      const cy = Math.min(y1, y2) - 25
      return `M ${x1} ${y1} Q ${cx} ${cy} ${x2} ${y2}`
    }

    case 'wall-bounce': {
      // L start → bounce off back wall (at y_min) → L end
      const bounceY = Math.min(y1, y2) - 30
      const bounceX = x1 + (x2 - x1) * 0.5
      return `M ${x1} ${y1} L ${bounceX} ${bounceY} L ${x2} ${y2}`
    }
  }
}

/** Per-style render hints (for the renderer to pick stroke/decor). */
export const TRAJECTORY_DECOR: Record<TrajectoryStyle, {
  strokeWidth: number
  dashed: boolean
  spinMarkers: number  // 0, 1, or 2
  bolt: boolean
  star: boolean
  rays: boolean
  isWinner: boolean    // smash is red, others use state color
}> = {
  flat:         { strokeWidth: 4, dashed: false, spinMarkers: 0, bolt: false, star: false, rays: false, isWinner: false },
  lob:          { strokeWidth: 4, dashed: true,  spinMarkers: 0, bolt: false, star: false, rays: false, isWinner: false },
  bandeja:      { strokeWidth: 4, dashed: false, spinMarkers: 1, bolt: false, star: false, rays: false, isWinner: false },
  vibora:       { strokeWidth: 4, dashed: false, spinMarkers: 2, bolt: true,  star: false, rays: false, isWinner: false },
  smash:        { strokeWidth: 6, dashed: false, spinMarkers: 0, bolt: false, star: true,  rays: true,  isWinner: true  },
  chiquita:     { strokeWidth: 4, dashed: false, spinMarkers: 0, bolt: false, star: false, rays: false, isWinner: false },
  'wall-bounce':{ strokeWidth: 4, dashed: false, spinMarkers: 0, bolt: false, star: true,  rays: false, isWinner: false },
  cross:        { strokeWidth: 4, dashed: false, spinMarkers: 0, bolt: false, star: false, rays: false, isWinner: false },
}
