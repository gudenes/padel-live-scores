import Image from 'next/image'
import styles from './TournamentMarketArtwork.module.css'

/** Unknown artwork must retain all subjects and text, rather than guess a focal point.
 * Both layers share one source; the browser reuses the image request.
 */
export default function TournamentMarketArtwork({src,alt}:{src:string;alt:string}) {
  return <div className={styles.frame}>
    <Image src={src} alt="" aria-hidden fill unoptimized className={styles.fill} sizes="(max-width:500px) 100vw, 420px" />
    <Image src={src} alt={alt} fill unoptimized className={styles.artwork} sizes="(max-width:500px) 100vw, 420px" />
  </div>
}
