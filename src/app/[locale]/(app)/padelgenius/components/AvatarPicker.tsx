'use client'

import React from 'react'
import { GENIUS_AVATARS, getUnlockedAvatars } from '@/data/genius-avatars'

interface AvatarPickerProps {
  currentAvatar: { icon: string; color: string; name: string }
  level: number
  onSelect: (icon: string, color: string, name: string) => void
  onClose: () => void
}

const COLOR_OPTIONS = [
  '#38C8FF', '#F472B6', '#7ED321', '#FFDD00', '#FF4655',
  '#9B59B6', '#E67E22', '#1ABC9C', '#3498DB', '#E74C3C',
]

export default function AvatarPicker({ currentAvatar, level, onSelect, onClose }: AvatarPickerProps) {
  const unlocked = getUnlockedAvatars(level)
  const unlockedIcons = new Set(unlocked.map(a => a.icon))

  return (
    <div style={{
      position: 'fixed',
      inset: 0,
      background: '#1A1A1A',
      zIndex: 100,
      display: 'flex',
      flexDirection: 'column' as const,
      overflow: 'auto',
    }}>
      {/* Header */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '16px 20px',
      }}>
        <button
          onClick={onClose}
          style={{
            background: 'none',
            border: 'none',
            color: '#6889A5',
            fontSize: 14,
            cursor: 'pointer',
            padding: 0,
          }}
        >
          &larr; Back
        </button>
        <div style={{ color: '#EEE4CE', fontSize: 16, fontWeight: 700 }}>
          Choose Avatar
        </div>
        <div style={{ width: 48 }} />
      </div>

      {/* Current avatar preview */}
      <div style={{ textAlign: 'center' as const, padding: '20px 0 30px' }}>
        <div style={{
          width: 80,
          height: 80,
          borderRadius: 20,
          background: `linear-gradient(135deg, ${currentAvatar.color}, ${currentAvatar.color}88)`,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: 40,
          margin: '0 auto',
          border: '3px solid rgba(255,255,255,0.2)',
        }}>
          {currentAvatar.icon}
        </div>
        <div style={{ color: '#EEE4CE', fontSize: 16, fontWeight: 700, marginTop: 10 }}>
          {currentAvatar.name}
        </div>
        <div style={{ color: '#6889A5', fontSize: 12, marginTop: 2 }}>
          Level {level}
        </div>
      </div>

      {/* Icon grid */}
      <div style={{ padding: '0 20px' }}>
        <div style={{
          color: '#6889A5',
          fontSize: 11,
          fontWeight: 600,
          textTransform: 'uppercase' as const,
          letterSpacing: 0.5,
          marginBottom: 10,
        }}>
          Icons
        </div>
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(5, 1fr)',
          gap: 10,
        }}>
          {GENIUS_AVATARS.map((avatar) => {
            const isUnlocked = unlockedIcons.has(avatar.icon)
            const isSelected = avatar.icon === currentAvatar.icon

            return (
              <button
                key={avatar.icon + avatar.name}
                onClick={() => {
                  if (isUnlocked) {
                    onSelect(avatar.icon, currentAvatar.color, avatar.name)
                  }
                }}
                style={{
                  width: '100%',
                  aspectRatio: '1',
                  borderRadius: 14,
                  border: isSelected ? '2px solid #38C8FF' : '2px solid transparent',
                  background: isUnlocked ? '#262626' : '#1F1F1F',
                  cursor: isUnlocked ? 'pointer' : 'default',
                  display: 'flex',
                  flexDirection: 'column' as const,
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 2,
                  opacity: isUnlocked ? 1 : 0.5,
                  position: 'relative' as const,
                  padding: 0,
                }}
              >
                <span style={{ fontSize: 24 }}>
                  {isUnlocked ? avatar.icon : '\uD83D\uDD12'}
                </span>
                {!isUnlocked && (
                  <span style={{ color: '#4A6F8E', fontSize: 9, fontWeight: 600 }}>
                    Lv.{avatar.minLevel}
                  </span>
                )}
                {isUnlocked && (
                  <span style={{ color: '#6889A5', fontSize: 9 }}>
                    {avatar.name}
                  </span>
                )}
              </button>
            )
          })}
        </div>
      </div>

      {/* Color picker */}
      <div style={{ padding: '24px 20px 40px' }}>
        <div style={{
          color: '#6889A5',
          fontSize: 11,
          fontWeight: 600,
          textTransform: 'uppercase' as const,
          letterSpacing: 0.5,
          marginBottom: 10,
        }}>
          Color
        </div>
        <div style={{ display: 'flex', gap: 10, justifyContent: 'center', flexWrap: 'wrap' as const }}>
          {COLOR_OPTIONS.map((color) => (
            <button
              key={color}
              onClick={() => onSelect(currentAvatar.icon, color, currentAvatar.name)}
              style={{
                width: 36,
                height: 36,
                borderRadius: '50%',
                background: `linear-gradient(135deg, ${color}, ${color}99)`,
                border: color === currentAvatar.color
                  ? '3px solid #fff'
                  : '3px solid transparent',
                cursor: 'pointer',
                padding: 0,
                boxShadow: color === currentAvatar.color
                  ? `0 0 12px ${color}55`
                  : 'none',
              }}
            />
          ))}
        </div>
      </div>
    </div>
  )
}
