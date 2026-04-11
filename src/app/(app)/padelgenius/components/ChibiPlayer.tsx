'use client'

import React from 'react'

export type PlayerRole = 'you' | 'partner' | 'opponent1' | 'opponent2'

export interface ChibiPlayerProps {
  role: PlayerRole
  x: number       // SVG x position (already transformed)
  y: number       // SVG y position (already transformed)
  scale: number   // depth-based scale (0.5 far .. 1.2 near)
  jerseyColor?: string
}

/** Skin tone palette — alternates by role for visual variety */
const SKIN: Record<PlayerRole, string> = {
  you: '#FFD5A8',
  partner: '#FFD5A8',
  opponent1: '#FFD5A8',
  opponent2: '#8D6E4C',
}

const SKIN_SHADOW: Record<PlayerRole, string> = {
  you: '#EECAA0',
  partner: '#EECAA0',
  opponent1: '#EECAA0',
  opponent2: '#7A5C3D',
}

const HAIR: Record<PlayerRole, string> = {
  you: '#1a1a2e',
  partner: '#F1C40F',
  opponent1: '#C0392B',
  opponent2: '#2C1810',
}

const DEFAULT_JERSEY: Record<PlayerRole, string> = {
  you: '#2980B9',
  partner: '#2980B9',
  opponent1: '#E74C3C',
  opponent2: '#E74C3C',
}

/**
 * ChibiPlayer — a single chibi character rendered as SVG.
 *
 * Opponents face the camera (big eyes visible).
 * "You" and "partner" face away (back of head, hair only).
 */
export default function ChibiPlayer({ role, x, y, scale, jerseyColor }: ChibiPlayerProps) {
  const facing = role === 'you' || role === 'partner' ? 'away' : 'toward'
  const skin = SKIN[role]
  const skinShadow = SKIN_SHADOW[role]
  const hair = HAIR[role]
  const jersey = jerseyColor && role === 'you' ? jerseyColor : DEFAULT_JERSEY[role]
  const racketSide = role === 'opponent2' || role === 'partner' ? 'left' : 'right'

  // Shadow ellipse size scales with the character
  const shadowRx = 14 * scale
  const shadowRy = 4.5 * scale

  return (
    <g transform={`translate(${x}, ${y}) scale(${scale})`}>
      {/* Ground shadow */}
      <ellipse cx={0} cy={46} rx={shadowRx / scale} ry={shadowRy / scale} fill="rgba(0,0,0,0.25)" />

      {/* Legs */}
      <rect x={-6} y={28} width={5} height={12} rx={2} fill={skin} />
      <rect x={1} y={28} width={5} height={12} rx={2} fill={skinShadow} />
      {/* Shoes */}
      <rect x={-7} y={37} width={6} height={5} rx={2} fill={jersey} />
      <rect x={1} y={37} width={6} height={5} rx={2} fill={jersey} />

      {/* Body / jersey */}
      <rect x={-10} y={10} width={20} height={22} rx={4} fill={jersey} />
      {/* Collar highlight */}
      <rect x={-10} y={10} width={20} height={6} rx={3} fill="rgba(255,255,255,0.12)" />

      {facing === 'away' && (
        <>
          {/* Back number (subtle) */}
          <text
            x={0}
            y={28}
            textAnchor="middle"
            fill="rgba(255,255,255,0.2)"
            fontSize={14}
            fontWeight={900}
          >
            {role === 'you' ? '7' : '5'}
          </text>
        </>
      )}

      {/* Arms */}
      {facing === 'away' ? (
        <>
          <rect x={-16} y={14} width={7} height={14} rx={3} fill={skin} transform="rotate(-8, -12, 20)" />
          <rect x={9} y={14} width={7} height={14} rx={3} fill={skinShadow} transform="rotate(8, 12, 20)" />
        </>
      ) : (
        <>
          <rect x={-14} y={14} width={6} height={12} rx={3} fill={skin} transform="rotate(-5, -11, 20)" />
          <rect x={8} y={14} width={6} height={12} rx={3} fill={skin} transform="rotate(5, 11, 20)" />
        </>
      )}

      {/* Head */}
      <circle cx={0} cy={4} r={12} fill={skin} />

      {facing === 'toward' ? (
        <>
          {/* Hair (front-facing) */}
          <path
            d="M-12,0 Q-10,-12 -4,-14 L-2,-6 Q0,-15 2,-6 L4,-14 Q10,-12 12,0 Q6,-6 0,-8 Q-6,-6 -12,0Z"
            fill={hair}
          />
          {/* Eyes */}
          <ellipse cx={-4} cy={3} rx={2.2} ry={2.8} fill="#fff" />
          <circle cx={-3.5} cy={3.5} r={1.3} fill="#222" />
          <circle cx={-3} cy={2.5} r={0.5} fill="#fff" />
          <ellipse cx={4} cy={3} rx={2.2} ry={2.8} fill="#fff" />
          <circle cx={4.5} cy={3.5} r={1.3} fill="#222" />
          <circle cx={5} cy={2.5} r={0.5} fill="#fff" />
          {/* Mouth */}
          <path d="M-2,8 Q0,10 2,8" stroke={role === 'opponent2' ? '#6d4e36' : '#b37656'} strokeWidth={0.8} fill="none" />
        </>
      ) : (
        <>
          {/* Hair (back-of-head, full coverage) */}
          <path
            d={`M-12,4 Q-12,-12 -6,-16 L-4,-8 Q-1,-18 2,-8 L4,-16 Q12,-12 12,-2 Q12,4 12,4
                Q8,-2 4,-4 Q0,-8 -4,-4 Q-8,-2 -12,4Z`}
            fill={hair}
          />
          {/* Side tufts */}
          <path d="M-12,4 Q-16,0 -14,-6 Q-12,-2 -12,4Z" fill={hair} />
          <path d="M12,4 Q16,0 14,-6 Q12,-2 12,4Z" fill={hair} />
          {/* Spikes on top for "you" */}
          {role === 'you' && (
            <>
              <path d="M-4,-14 L-6,-22 L-1,-16Z" fill={hair} opacity={0.85} />
              <path d="M-1,-16 L1,-24 L4,-16Z" fill={hair} />
              <path d="M4,-14 L7,-21 L8,-12Z" fill={hair} opacity={0.85} />
            </>
          )}
        </>
      )}

      {/* Racket */}
      {racketSide === 'right' ? (
        <g transform="rotate(-20, 14, 12)">
          <ellipse cx={14} cy={6} rx={5} ry={7} fill="none" stroke={jersey} strokeWidth={1.5} />
          <line x1={14} y1={13} x2={14} y2={22} stroke="#888" strokeWidth={2} strokeLinecap="round" />
        </g>
      ) : (
        <g transform="rotate(20, -14, 12)">
          <ellipse cx={-14} cy={6} rx={5} ry={7} fill="none" stroke={jersey} strokeWidth={1.5} />
          <line x1={-14} y1={13} x2={-14} y2={22} stroke="#888" strokeWidth={2} strokeLinecap="round" />
        </g>
      )}
    </g>
  )
}
