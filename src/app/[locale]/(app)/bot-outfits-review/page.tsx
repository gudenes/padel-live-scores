import {notFound} from 'next/navigation'
import {PlayerFigure} from '@/components/PlayerAvatar'
import {simulationPlayerLook,simulationPlayerWardrobe} from '@/lib/player-outfit'

export default function BotOutfitsReview(){
 if(process.env.NODE_ENV!=='development')notFound()
 return <main style={{padding:20,background:'#181c18',color:'#f5f0df',minHeight:'100vh'}}>
  <h1 style={{fontSize:24}}>Bot wardrobe preview</h1>
  <p>Stable outfits using the existing fitted avatar artwork.</p>
  <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(140px,1fr))',gap:12}}>
   {Array.from({length:12},(_,i)=>{
    const identity=`bot-${i+1}`,wardrobe=simulationPlayerWardrobe(identity)
    return <article key={identity} style={{background:'#252a23',padding:12,borderRadius:12}}>
     <div style={{height:260}}><PlayerFigure outfit={simulationPlayerLook(identity)} wardrobe={wardrobe} approvedArtwork/></div>
     <strong>Look {i+1}</strong>
     <p style={{fontSize:12,color:'#b6c3a7'}}>{wardrobe.shirt} · {wardrobe.hat==='starter'?'No hat':wardrobe.hat}</p>
    </article>
   })}
  </div>
 </main>
}
