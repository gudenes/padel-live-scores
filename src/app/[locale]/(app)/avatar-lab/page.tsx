import { notFound } from 'next/navigation'
import WardrobeLab from '@/components/player/WardrobeLab'

export default function AvatarLabPage() {
  if (process.env.NODE_ENV === 'production') notFound()
  return <WardrobeLab />
}
