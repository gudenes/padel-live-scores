// src/lib/padelgenius/trajectories.ts
import type { TrajectoryStyle } from './types'

type Point = [number, number]

/** Returns an SVG path `d` string for the given trajectory style and endpoints. */
export function trajectoryPath(style: TrajectoryStyle, from: Point, to: Point): string {
  const [x1, y1] = from
  const [x2, y2] = to

  switch (style) {
    case 'flat':
    case 'cross':
      return `M ${x1} ${y1} L ${x2} ${y2}`

    case 'lob': {
      // Tall arch — control point is high above the midpoint
      const cx = (x1 + x2) / 2
      const cy = Math.min(y1, y2) - 120
      return `M ${x1} ${y1} Q ${cx} ${cy} ${x2} ${y2}`
    }

    case 'bandeja': {
      // Gentle slice — control point pulls slightly above and along the path
      const cx = x1 + (x2 - x1) * 0.7
      const cy = y1 + (y2 - y1) * 0.3 - 20
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
