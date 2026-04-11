// src/hooks/useGeniusProgress.ts
'use client'

import { useState, useEffect, useCallback } from 'react'
import { getRandomStarterAvatar } from '@/data/genius-avatars'
import { getLevelForXp } from '@/data/genius-levels'
import { adjustDifficulty } from '@/lib/genius-engine'

const STORAGE_KEY = 'pn_genius_progress'

export interface GeniusProgressState {
  todayDate: string
  todayAnswered: number[]
  todayCorrect: number
  totalXp: number
  level: number
  streak: number
  bestStreak: number
  lastPlayedDate: string
  answeredAll: number[]
  wrongAnswers: number[]
  currentDifficulty: 1 | 2 | 3
  recentAccuracy: number[]
  avatar: { icon: string; color: string; name: string }
}

function todayStr(): string {
  return new Date().toISOString().slice(0, 10)
}

function createDefaultProgress(): GeniusProgressState {
  const avatar = getRandomStarterAvatar()
  return {
    todayDate: todayStr(),
    todayAnswered: [],
    todayCorrect: 0,
    totalXp: 0,
    level: 1,
    streak: 0,
    bestStreak: 0,
    lastPlayedDate: '',
    answeredAll: [],
    wrongAnswers: [],
    currentDifficulty: 1,
    recentAccuracy: [],
    avatar: { icon: avatar.icon, color: avatar.colorFrom, name: avatar.name },
  }
}

function readProgress(): GeniusProgressState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return createDefaultProgress()
    const parsed = JSON.parse(raw) as GeniusProgressState
    // Reset daily state if new day
    if (parsed.todayDate !== todayStr()) {
      parsed.todayDate = todayStr()
      parsed.todayAnswered = []
      parsed.todayCorrect = 0
    }
    return parsed
  } catch {
    return createDefaultProgress()
  }
}

function writeProgress(state: GeniusProgressState): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
  } catch { /* ignore */ }
}

export function useGeniusProgress() {
  const [progress, setProgress] = useState<GeniusProgressState>(createDefaultProgress)
  const [loaded, setLoaded] = useState(false)

  // Hydrate from localStorage on mount
  useEffect(() => {
    const stored = readProgress()
    setProgress(stored)
    setLoaded(true)
  }, [])

  const save = useCallback((updater: (prev: GeniusProgressState) => GeniusProgressState) => {
    setProgress(prev => {
      const next = updater(prev)
      writeProgress(next)
      return next
    })
  }, [])

  const recordAnswer = useCallback((questionId: number, correct: boolean, xpEarned: number) => {
    save(prev => {
      const recentAccuracy = [...prev.recentAccuracy, correct ? 1 : 0].slice(-20)
      const newDifficulty = adjustDifficulty(prev.currentDifficulty, recentAccuracy)
      const totalXp = prev.totalXp + xpEarned
      const newLevel = getLevelForXp(totalXp).level

      return {
        ...prev,
        todayAnswered: [...prev.todayAnswered, questionId],
        todayCorrect: prev.todayCorrect + (correct ? 1 : 0),
        totalXp,
        level: newLevel,
        answeredAll: prev.answeredAll.includes(questionId) ? prev.answeredAll : [...prev.answeredAll, questionId],
        wrongAnswers: correct
          ? prev.wrongAnswers.filter(id => id !== questionId)
          : prev.wrongAnswers.includes(questionId) ? prev.wrongAnswers : [...prev.wrongAnswers, questionId],
        currentDifficulty: newDifficulty,
        recentAccuracy,
      }
    })
  }, [save])

  const completeDailyChallenge = useCallback(() => {
    save(prev => {
      const today = todayStr()
      const yesterday = new Date()
      yesterday.setDate(yesterday.getDate() - 1)
      const yesterdayStr = yesterday.toISOString().slice(0, 10)

      const isConsecutive = prev.lastPlayedDate === yesterdayStr || prev.lastPlayedDate === today
      const newStreak = isConsecutive ? prev.streak + 1 : 1

      return {
        ...prev,
        streak: newStreak,
        bestStreak: Math.max(prev.bestStreak, newStreak),
        lastPlayedDate: today,
      }
    })
  }, [save])

  const updateAvatar = useCallback((icon: string, color: string, name: string) => {
    save(prev => ({ ...prev, avatar: { icon, color, name } }))
  }, [save])

  const todayCompleted = progress.todayAnswered.length >= 5

  return {
    progress,
    loaded,
    recordAnswer,
    completeDailyChallenge,
    updateAvatar,
    todayCompleted,
  }
}
