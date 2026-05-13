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
}

export interface PlayerPosition {
  role: PlayerRole
  x: number // 0–100
  y: number // 0–100
}

export interface Outcome {
  ball: { x: number; y: number }
  trajectory: Trajectory
  playerOverrides?: PlayerPosition[]
}

export interface QuestionOption {
  id: OptionId
  label: string
  direction: string
  letter: { x: number; y: number }
  isCorrect: boolean
  outcome: Outcome
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

export interface CourtConfig {
  name: string
  active: boolean
  imageUrl: string
  bounds: CourtBounds
  zones: CourtZones
  visualSystem: VisualSystem
  branding: BrandingSlots
}
