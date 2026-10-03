/** Only real, previously seen balances animate; never invent a first-visit reward. */
export function rememberWalletBalance(storage: Pick<Storage, 'getItem' | 'setItem'>, walletKey: string, balance: number): number | null {
  if (!walletKey || !Number.isFinite(balance) || balance < 0) return null
  const key = `pn:wallet-seen:v1:${walletKey}`
  try {
    const raw = storage.getItem(key)
    const previous = raw === null ? NaN : Number(raw)
    storage.setItem(key, String(balance))
    return Number.isFinite(previous) && previous >= 0 && previous !== balance ? previous : null
  } catch { return null } // Storage being disabled must never block the wallet.
}
