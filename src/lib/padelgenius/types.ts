// src/lib/padelgenius/types.ts

export type PlayerRole = 'you' | 'partner' | 'opponent1' | 'opponent2'

export type TrajectoryStyle =
  | 'flat'
  | 'lob'
  | 'bandeja'
  | 'vibora'
  | 'smash'
  | 'chiquita'
  | 'wall-bounce'
  | 'cross'

export type Theme = 'shots' | 'positioning' | 'rules' | 'communication' | 'mixed'
export type Difficulty = 1 | 2 | 3
export type OptionId = 'a' | 'b' | 'c' | 'd'

export interface Trajectory {
  from: [number, number]
  to: [number, number]
  style: TrajectoryStyle
  /**
   * Optional curve control point in court coords (0–100). When set, the
   * trajectory bends through this point as a quadratic Bezier, overriding
   * the style's preset curve. Style still drives visual decorations (dashes,
   * spin markers, bolt/star, impact rays). Useful to tune the apex of a lob,
   * the wall-hit spot on a wall-bounce, or any custom shape.
   */
  controlPoint?: [number, number]
}

export interface PlayerPosition {
  role: PlayerRole
  x: number // 0–100
  y: number // 0–100
}

export interface Outcome {
  ball: { x: number; y: number }
  /**
   * Optional shot trajectory for this option. When omitted, the play screen
   * shows the reveal banner without rendering any flight path or ball motion
   * — useful for rules / positioning / communication questions where the
   * answer isn't a shot.
   */
  trajectory?: Trajectory
  playerOverrides?: PlayerPosition[]
  /**
   * Optional per-option setup-ball position. When set, the play screen renders
   * the ball at this position the moment the user selects this option (preview
   * phase), animating from its previous spot. Falls back to question.court.ball
   * when unset.
   */
  setupBall?: { x: number; y: number }
}

export interface QuestionOption {
  id: OptionId
  label: string
  direction: string
  letter: { x: number; y: number }
  isCorrect: boolean
  outcome: Outcome
}

/**
 * Optional intro animation that plays once when the question first appears,
 * before the player can tap an option. Useful for rules / scenario questions
 * — e.g. "the ball hits the back glass" — where seeing the play helps the
 * player make sense of the prompt.
 */
export interface IntroAnimation {
  /**
   * Ordered list of trajectory legs. Each leg's `from` should match the
   * previous leg's `to` for visual continuity (the editor enforces this on
   * write). One segment is enough; multi-segment is for scenarios like
   * "bounces on floor → hits back glass → comes back" or multi-wall plays.
   */
  segments?: Trajectory[]
  /**
   * @deprecated Use `segments` instead. Kept for back-compat with intros
   * authored before the multi-segment refactor.
   */
  trajectory?: Trajectory
  /**
   * @deprecated Use `segments` instead. Kept for back-compat with intros
   * authored before the multi-segment refactor.
   */
  bounce?: Trajectory
  /** Total animation duration in ms across all segments. Default 1500. */
  durationMs?: number
}

export interface Question {
  id: number
  prompt: string
  theme: Theme
  difficulty: Difficulty
  court: {
    players: PlayerPosition[]
    ball?: { x: number; y: number }
    trajectory?: Trajectory
    intro?: IntroAnimation
  }
  options: QuestionOption[]
  explanation: {
    title: string
    body: string
    proTip?: string
  }
}

export interface CourtBounds {
  backGlassY: number
  backServiceY: number
  netY: number
  nearServiceY: number
  nearGlassY: number
  farLeftX: number
  farRightX: number
  nearLeftX: number
  nearRightX: number
}

export interface CourtZones {
  attackDepth: number
  transitionDepth: number
}

export interface VisualSystem {
  playerBaseSize: number
  scaleCurveMin: number
  scaleCurveMax: number
  letterRadius: number
  progressBarTilt: number
}

export interface SlotConfig {
  logoUrl: string
  scale: number // 0.5–2.0
}

export interface BrandingSlots {
  backWall: SlotConfig | null
  sideGlassLeft: SlotConfig | null
  sideGlassRight: SlotConfig | null
  netBand: SlotConfig | null
  floorCenter: SlotConfig | null
}

/**
 * Optional per-style trajectory line assets. Each value is a SlotConfig
 * (image url + scale). When set, the play screen renders the image as a
 * trajectory decoration instead of the procedural SVG path stroke.
 * Asset should be drawn horizontally (from = left edge, to = right edge);
 * the renderer rotates/scales it to fit the actual from→to vector.
 */
export type TrajectoryAssets = Partial<Record<TrajectoryStyle, SlotConfig>>

/**
 * Per-style visual override for the procedural (non-asset) trajectory line.
 * Lets the admin tune color, thickness, dash pattern, and decoration
 * intensity for each shot style without uploading custom artwork. All fields
 * optional — anything left undefined keeps the built-in default for that style.
 */
export interface TrajectoryStyleOverride {
  /** Hex color (e.g. "#1e88e5"). When set, replaces both the style default and the state-based color. */
  color?: string
  /** Stroke width in SVG units. Default is style-specific (3–7). */
  strokeWidth?: number
  /** Force dashed (true) or solid (false). Undefined uses the style's default. */
  dashed?: boolean
  /** Master switch for spin markers / bolts / stars / impact rays. Defaults to true. */
  showDecorations?: boolean
}

export type TrajectoryOverrides = Partial<Record<TrajectoryStyle, TrajectoryStyleOverride>>

export interface CourtConfig {
  name: string
  active: boolean
  imageUrl: string
  bounds: CourtBounds
  zones: CourtZones
  visualSystem: VisualSystem
  branding: BrandingSlots
  trajectoryAssets?: TrajectoryAssets
  trajectoryOverrides?: TrajectoryOverrides
}
