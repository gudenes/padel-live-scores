type PatchInput = {
  tournamentId: string
  prizeMoneyEur: number | null
}

type ValidationResult =
  | { ok: true; value: PatchInput }
  | { ok: false; reason: string }

export function validatePatchInput(body: unknown): ValidationResult {
  if (body == null || typeof body !== 'object') {
    return { ok: false, reason: 'body must be a JSON object' }
  }
  const b = body as Record<string, unknown>

  if (typeof b.tournamentId !== 'string' || b.tournamentId.length === 0) {
    return { ok: false, reason: 'tournamentId must be a non-empty string' }
  }

  const p = b.prizeMoneyEur
  if (p === null) {
    return { ok: true, value: { tournamentId: b.tournamentId, prizeMoneyEur: null } }
  }
  if (typeof p !== 'number' || !Number.isInteger(p) || p < 0) {
    return { ok: false, reason: 'prizeMoneyEur must be null or a non-negative integer' }
  }
  return { ok: true, value: { tournamentId: b.tournamentId, prizeMoneyEur: p } }
}
