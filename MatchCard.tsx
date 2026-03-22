'use client'
// src/app/components/MatchCard.tsx
// Mobile live score card — tap to expand/collapse

import { useState } from 'react'
import { Match, getCurrentScore, pairName } from '@/types/match'

interface MatchCardProps {
  match: Match
  viewerCount: number
}

export default function MatchCard({ match, viewerCount }: MatchCardProps) {
  const [expanded, setExpanded] = useState(false)
  const { pair1Sets, pair2Sets, currentSet, currentGame } = getCurrentScore(match)

  const pair1 = pairName(match.pair1_player1, match.pair1_player2)
  const pair2 = pairName(match.pair2_player1, match.pair2_player2)
  const currentPoint = currentGame?.points?.slice(-1)[0] ?? '0:0'
  const [p1Point, p2Point] = currentPoint.split(':')

  return (
    <div
      className="bg-white dark:bg-zinc-900 rounded-2xl shadow-sm border border-zinc-100 dark:border-zinc-800 overflow-hidden active:scale-[0.99] transition-transform"
      onClick={() => setExpanded(!expanded)}
    >
      {/* ── Header bar ── */}
      <div className="flex items-center justify-between px-4 pt-3 pb-1">
        <span className="text-xs font-medium text-emerald-600 uppercase tracking-wide">
          {match.round ?? 'Live'}
        </span>
        <div className="flex items-center gap-2">
          {viewerCount > 0 && (
            <span className="text-xs text-zinc-400 flex items-center gap-1">
              <span className="inline-block w-1.5 h-1.5 rounded-full bg-emerald-400" />
              {viewerCount} watching
            </span>
          )}
          <span className="text-xs text-zinc-400">{match.court}</span>
        </div>
      </div>

      {/* ── Main score row ── */}
      <div className="px-4 py-2">
        {/* Pair 1 */}
        <div className="flex items-center justify-between py-1.5">
          <span className="text-base font-semibold text-zinc-800 dark:text-zinc-100 flex-1 truncate">
            {pair1}
          </span>
          <div className="flex items-center gap-3 ml-2">
            {/* Set scores */}
            {(match.sets ?? []).map((set) => (
              <span
                key={set.set_number}
                className={`text-sm w-5 text-center font-mono ${
                  set.is_current
                    ? 'text-zinc-800 dark:text-zinc-100 font-bold'
                    : 'text-zinc-400'
                }`}
              >
                {set.set_score
                  ? set.set_score.split('-')[0]
                  : set.pair1_games ?? 0}
              </span>
            ))}
            {/* Current game point */}
            <span className="text-lg font-bold text-emerald-600 w-8 text-center font-mono">
              {currentSet ? p1Point : pair1Sets}
            </span>
          </div>
        </div>

        {/* Divider */}
        <div className="border-t border-zinc-50 dark:border-zinc-800" />

        {/* Pair 2 */}
        <div className="flex items-center justify-between py-1.5">
          <span className="text-base font-semibold text-zinc-800 dark:text-zinc-100 flex-1 truncate">
            {pair2}
          </span>
          <div className="flex items-center gap-3 ml-2">
            {(match.sets ?? []).map((set) => (
              <span
                key={set.set_number}
                className={`text-sm w-5 text-center font-mono ${
                  set.is_current
                    ? 'text-zinc-800 dark:text-zinc-100 font-bold'
                    : 'text-zinc-400'
                }`}
              >
                {set.set_score
                  ? set.set_score.split('-')[1]
                  : set.pair2_games ?? 0}
              </span>
            ))}
            <span className="text-lg font-bold text-emerald-600 w-8 text-center font-mono">
              {currentSet ? p2Point : pair2Sets}
            </span>
          </div>
        </div>
      </div>

      {/* ── Expanded detail ── */}
      {expanded && (
        <div className="border-t border-zinc-100 dark:border-zinc-800 px-4 py-3 bg-zinc-50 dark:bg-zinc-950">
          {(match.sets ?? []).map((set) => (
            <div key={set.set_number} className="mb-3 last:mb-0">
              <div className="flex items-center gap-2 mb-1.5">
                <span className="text-xs font-semibold text-zinc-500 uppercase tracking-wider">
                  Set {set.set_number}
                </span>
                {set.set_score && (
                  <span className="text-xs font-mono text-zinc-400">
                    {set.set_score}
                  </span>
                )}
                {set.is_current && (
                  <span className="text-xs text-emerald-600 font-medium">
                    • In progress
                  </span>
                )}
              </div>

              {/* Games grid */}
              <div className="flex flex-wrap gap-1.5">
                {(set.games ?? []).map((game) => (
                  <div
                    key={game.game_number}
                    className={`rounded-lg px-2 py-1 text-xs font-mono ${
                      game.is_current
                        ? 'bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-400 font-bold ring-1 ring-emerald-300 dark:ring-emerald-700'
                        : 'bg-white dark:bg-zinc-800 text-zinc-500 dark:text-zinc-400'
                    }`}
                  >
                    {game.points?.slice(-1)[0] ?? '0:0'}
                  </div>
                ))}
              </div>
            </div>
          ))}

          {/* Full player names */}
          <div className="mt-3 pt-3 border-t border-zinc-200 dark:border-zinc-800 grid grid-cols-2 gap-2">
            <div>
              <p className="text-xs text-zinc-400 mb-0.5">Pair 1</p>
              <p className="text-xs font-medium text-zinc-700 dark:text-zinc-300">
                {match.pair1_player1?.name}
              </p>
              <p className="text-xs font-medium text-zinc-700 dark:text-zinc-300">
                {match.pair1_player2?.name}
              </p>
            </div>
            <div>
              <p className="text-xs text-zinc-400 mb-0.5">Pair 2</p>
              <p className="text-xs font-medium text-zinc-700 dark:text-zinc-300">
                {match.pair2_player1?.name}
              </p>
              <p className="text-xs font-medium text-zinc-700 dark:text-zinc-300">
                {match.pair2_player2?.name}
              </p>
            </div>
          </div>
        </div>
      )}

      {/* ── Expand indicator ── */}
      <div className="flex justify-center pb-2 pt-1">
        <span className="text-zinc-300 dark:text-zinc-700 text-xs">
          {expanded ? '▲' : '▼'}
        </span>
      </div>
    </div>
  )
}
