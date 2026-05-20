// apps/ops/src/lib/operators.ts
// Operator allow-list check. One indexed lookup per session read.

import { pgPool } from './db'

export async function isUserOperator(userId: string | null | undefined): Promise<boolean> {
  if (!userId) return false
  const { rowCount } = await pgPool().query(
    'select 1 from public.operators where user_id = $1 limit 1',
    [userId],
  )
  return (rowCount ?? 0) > 0
}
