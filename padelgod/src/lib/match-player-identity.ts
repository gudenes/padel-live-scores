/** Unknown slots are allowed; a known player can occupy only one match slot. */
export function hasDuplicatePlayerIds(ids: readonly (string | null | undefined)[]): boolean {
  const known = ids.filter((id): id is string => !!id);
  return new Set(known).size !== known.length;
}

export const MATCH_PLAYER_COLUMNS = [
  'pair1_player1_id', 'pair1_player2_id', 'pair2_player1_id', 'pair2_player2_id',
] as const;

/** Validate the final lineup, not just the changed slots of a partial patch. */
export function patchDuplicatesPlayer(
  existing: Partial<Record<typeof MATCH_PLAYER_COLUMNS[number], string | null>>,
  patch: Record<string, unknown>,
): boolean {
  return hasDuplicatePlayerIds(MATCH_PLAYER_COLUMNS.map((column) =>
    (Object.hasOwn(patch, column) ? patch[column] : existing[column]) as string | null | undefined,
  ));
}
