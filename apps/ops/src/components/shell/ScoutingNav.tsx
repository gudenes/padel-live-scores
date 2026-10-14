'use client'
import Link from 'next/link'
import MethodologyGuide from '../scouting/MethodologyGuide'
import {usePathname} from 'next/navigation'
import {Icon} from '../IconSprite'

export function ScoutingNav(){
 const path=usePathname()
 const methodology=path==='/scouting/methodology'
 return <nav className="horizontal-nav" aria-label="Scouting navigation">
  <Link href="/scouting" className="top-link" aria-current={!methodology?'page':undefined}><Icon id="users"/>Matches</Link>
  <MethodologyGuide/>
 </nav>
}
