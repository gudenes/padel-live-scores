export type ParsedPrize = {
  amount: number
  currency: 'EUR' | 'USD' | 'OTHER'
}

export function parsePrizeMoneyText(input: string | null | undefined): ParsedPrize | null {
  return null
}
