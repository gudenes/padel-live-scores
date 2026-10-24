'use client'
import Link from 'next/link'
import MethodologyGuide from '../scouting/MethodologyGuide'
import {usePathname} from 'next/navigation'
import {Icon} from '../IconSprite'

export function ScoutingNav(){
 const path=usePathname()
 const methodology=path==='/scouting/methodology'
 return <nav className="horizontal-nav" aria-label="Scouting navigation">
  <Link href="/scouting" className="top-link" aria-current={!methodology&&!path.startsWith('/scouting/players')?'page':undefined}><Icon id="users"/>Matches</Link>
  <Link href="/scouting/players" className="top-link" aria-current={path.startsWith('/scouting/players')?'page':undefined}><Icon id="users"/>Players</Link>
  <MethodologyGuide/>
 </nav>
}
