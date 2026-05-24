#!/usr/bin/env node
// apps/ops/scripts/sync-ocr-calibrations.mjs
//
// Copies apps/ocr-worker/calibrations/*.json into apps/ops/calibrations/
// so the snapshot-detail API route can read them at runtime.
//
// Why this exists:
//   - Single source of truth is apps/ocr-worker/calibrations/ (the Python
//     worker uses those files to crop the scoreboard).
//   - The admin app needs the same JSONs to render the calibration overlay
//     on the snapshot drawer.
//   - Turbopack's outputFileTracingIncludes rejects globs that navigate
//     outside the Next project root (`../ocr-worker/...`).
//
// Solution: a tiny sync script wired into prebuild + predev. The destination
// directory is gitignored — checked-in code stays in apps/ocr-worker/ only.
//
// Run on every build/dev start. If the source dir is missing, exit 0 with a
// warning (lets the apps/ops package build even when the OCR worker has been
// removed or relocated).

import { mkdir, readdir, copyFile, stat } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const SRC = path.resolve(__dirname, '..', '..', 'ocr-worker', 'calibrations')
const DEST = path.resolve(__dirname, '..', 'calibrations')

async function main() {
  let srcStat
  try {
    srcStat = await stat(SRC)
  } catch {
    console.warn(
      `[sync-ocr-calibrations] source dir missing (${SRC}), skipping. ` +
        `Snapshot drawer overlay will render with calibrationError messages.`,
    )
    return
  }
  if (!srcStat.isDirectory()) {
    console.warn(`[sync-ocr-calibrations] ${SRC} is not a directory, skipping.`)
    return
  }

  await mkdir(DEST, { recursive: true })
  const entries = await readdir(SRC)
  const jsonFiles = entries.filter((e) => e.endsWith('.json'))

  if (jsonFiles.length === 0) {
    console.warn(`[sync-ocr-calibrations] no calibration JSONs found in ${SRC}`)
    return
  }

  for (const file of jsonFiles) {
    await copyFile(path.join(SRC, file), path.join(DEST, file))
  }
  console.log(
    `[sync-ocr-calibrations] copied ${jsonFiles.length} file(s): ${jsonFiles.join(', ')}`,
  )
}

main().catch((e) => {
  console.error(`[sync-ocr-calibrations] failed: ${e?.message ?? e}`)
  process.exit(1)
})
