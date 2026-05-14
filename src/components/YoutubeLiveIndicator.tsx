// src/components/YoutubeLiveIndicator.tsx
//
// Page-level YouTube live indicator. Pill on the left of EN VIVO that
// expands an inline panel listing the channels currently broadcasting.
// Implementation lives in Task 6 of the plan.

export interface LiveChannel {
  videoId: string
  title: string
  channel: {
    id: string
    name: string
    abbreviation: string
    colorHex: string
    displayOrder: number
  }
}
