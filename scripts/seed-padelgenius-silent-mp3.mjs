// scripts/seed-padelgenius-silent-mp3.mjs
// Generates 9 silent placeholder MP3 files for PadelGenius sound effects.
// Real cartoon clips will replace these before launch.
import { writeFileSync, mkdirSync } from 'node:fs'

// 417-byte minimal valid silent MP3 (0.1s, 32kbps mono 22050Hz)
const SILENT_MP3_B64 =
  '//uQxAAAAAAAAAAAAAAAAAAAAAAAWGluZwAAAA8AAAACAAACcQCqqqqqqqqqqqqqqqqqqqqqqqqqqqqq' +
  'qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq' +
  'qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq' +
  'AAAAAExhdmM1OC4xMy4xMDAAAAAAAAAAAAAAAJAkAAAAAAAAAAJxQshMmgAAAAAA/+xDEAAPAAAGkAAAA' +
  'IAAANIAAAAQAAA0gAAAAgAAA0gAAAACAAADSAAAAIAAANIAAAAgAAA0gAAAAIAAANIAAAAgAAA0gAAAA' +
  'IAAANIAAAAgAAA0gAAAAIAAANIAAAAgAAA0gAAAAIAAANIAAAAgAAA0gAAAAIAAANIAAAAgAAA0gAAAA' +
  'IAAANIAAAAgAAA0gAAAAIAAANIAAAAgAAA0gAAAAIAAANIAAAAgAAA0gAAAAIAAANIAAAAg='

const names = ['tap', 'confirm', 'swoosh-flat', 'swoosh-lob', 'swoosh-smash', 'correct', 'wrong', 'continue', 'complete']
const dir = 'public/padelgenius/sounds'
mkdirSync(dir, { recursive: true })
const buf = Buffer.from(SILENT_MP3_B64, 'base64')
for (const n of names) {
  writeFileSync(`${dir}/${n}.mp3`, buf)
  console.log(`wrote ${dir}/${n}.mp3 (${buf.length} bytes)`)
}
console.log('Done. Replace with real cartoon clips before launch.')
