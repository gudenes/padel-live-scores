/**
 * Parse a clock from an OOP/padelapi schedule label into 24-hour
 * `{ hours, minutes }`. Returns null for labels without an absolute time
 * ("Followed by", empty).
 *
 * Accepts both 12-hour ("Starting at 2:30 PM") and 24-hour
 * ("Starting at 12:00", "Not before 16:00") labels. 12-hour conversion
 * only runs when AM/PM is present — otherwise 12:00 is noon, not midnight.
 */
const TIME_RE = /(\d{1,2}):(\d{2})(?:\s*(AM|PM))?/i

export function parseScheduleClock(
  label: string,
): { hours: number; minutes: number } | null {
  const timeMatch = TIME_RE.exec(label)
  if (!timeMatch) return null
  let hours = parseInt(timeMatch[1]!, 10)
  const minutes = parseInt(timeMatch[2]!, 10)
  if (Number.isNaN(hours) || Number.isNaN(minutes) || minutes > 59) return null
  const ampm = timeMatch[3]?.toUpperCase()
  if (ampm) {
    if (hours < 1 || hours > 12) return null
    if (ampm === 'PM' && hours < 12) hours += 12
    if (ampm === 'AM' && hours === 12) hours = 0
  } else if (hours > 23) {
    return null
  }
  return { hours, minutes }
}
