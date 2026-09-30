import type { Metadata } from 'next'
import { betaCopy, betaLocale } from '@/lib/beta-copy'
import BetaSignup from './signup'

type Props = { params: Promise<{ locale: string }> }

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const copy = betaCopy[betaLocale((await params).locale)]
  return { title: `${copy.formTitle} — Padel Predictor Market`, description: copy.intro }
}

export default async function BetaPage({ params }: Props) {
  return <BetaSignup locale={betaLocale((await params).locale)} />
}
