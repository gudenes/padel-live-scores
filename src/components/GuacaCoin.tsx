import Image from 'next/image'

/** Shared Guacas currency icon; keep amounts as readable text beside it. */
export default function GuacaCoin({ size = 22 }: { size?: number }) {
  return <Image src="/play/currency/guaca-game-v1.webp" unoptimized alt="Guacas" width={size} height={size}
    style={{ display: 'inline-block', verticalAlign: 'middle', flexShrink: 0, width: size, height: size, objectFit: 'contain' }} />
}
