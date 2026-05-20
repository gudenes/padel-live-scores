// GET + PUT for /api/ops/docs/[slug] — small key-value store for
// operator-editable reference docs (coverage capability matrix in v1).
//
// Auth: ops_token cookie via checkOpsAuth (same pattern as every other
// /api/ops/* route). Underlying writes use the service-role key, bypassing
// RLS — RLS is defence-in-depth, not the primary access gate.

const MAX_CONTENT_LEN = 200_000

type PutInput = { content: string }

type ValidationResult =
  | { ok: true; value: PutInput }
  | { ok: false; reason: string }

export function validatePutInput(body: unknown): ValidationResult {
  if (body == null || typeof body !== 'object' || Array.isArray(body)) {
    return { ok: false, reason: 'body must be a JSON object' }
  }
  const b = body as Record<string, unknown>
  if (typeof b.content !== 'string') {
    return { ok: false, reason: 'content must be a string' }
  }
  if (b.content.length > MAX_CONTENT_LEN) {
    return { ok: false, reason: `content exceeds max length of ${MAX_CONTENT_LEN}` }
  }
  return { ok: true, value: { content: b.content } }
}
