'use client'

import React from 'react'
import { getThemeForDay } from '@/data/genius-themes'

interface WeekStripProps {
  completedDays: string[] // ISO date strings of completed days
}

const DAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
// JS getDay(): 0=Sun .. 6=Sat → map to Mon=0 .. Sun=6
const JS_DAY_TO_INDEX = [6, 0, 1, 2, 3, 4, 5]
// Index to JS getDay()
const INDEX_TO_JS_DAY = [1, 2, 3, 4, 5, 6, 0]

function getWeekDates(): Date[] {
  const now = new Date()
  const jsDay = now.getDay()
  const mondayOffset = jsDay === 0 ? -6 : 1 - jsDay
  const monday = new Date(now)
  monday.setDate(now.getDate() + mondayOffset)
  monday.setHours(0, 0, 0, 0)

  const dates: Date[] = []
  for (let i = 0; i < 7; i++) {
    const d = new Date(monday)
    d.setDate(monday.getDate() + i)
    dates.push(d)
  }
  return dates
}

function toIsoDate(d: Date): string {
  return d.toISOString().slice(0, 10)
}

export default function WeekStrip({ completedDays }: WeekStripProps) {
  const weekDates = getWeekDates()
  const todayStr = toIsoDate(new Date())
  const completedSet = new Set(completedDays)

  return (
    <div>
      <div style={{
        color: '#6889A5',
        fontSize: 11,
        fontWeight: 600,
        textTransform: 'uppercase' as const,
        letterSpacing: 0.5,
        marginBottom: 8,
      }}>
        This Week
      </div>
      <div style={{ display: 'flex', gap: 6 }}>
        {weekDates.map((date, i) => {
          const dateStr = toIsoDate(date)
          const isToday = dateStr === todayStr
          const isCompleted = completedSet.has(dateStr)
          const isFuture = date > new Date()
          const jsDayOfWeek = INDEX_TO_JS_DAY[i]
          const theme = getThemeForDay(jsDayOfWeek)

          return (
            <div
              key={i}
              style={{
                flex: 1,
                textAlign: 'center' as const,
                padding: '8px 4px',
                background: isToday ? '#1B4D3E' : '#262626',
                borderRadius: 10,
                border: isToday ? '1px solid rgba(56,200,255,0.3)' : '1px solid transparent',
              }}
            >
              <div style={{
                color: isToday ? '#38C8FF' : '#6889A5',
                fontSize: 10,
                fontWeight: isToday ? 700 : 400,
              }}>
                {DAY_LABELS[i]}
              </div>
              <div style={{ fontSize: 14, margin: '4px 0' }}>
                {theme.emoji}
              </div>
              <div style={{
                fontSize: 10,
                fontWeight: isToday || isCompleted ? 600 : 400,
                color: isCompleted
                  ? '#7ED321'
                  : isToday
                    ? '#38C8FF'
                    : '#4A6F8E',
              }}>
                {isCompleted ? '\u2713' : isToday ? 'NOW' : '\u2014'}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
