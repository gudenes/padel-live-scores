'use client'
// Mock For You cards using the new paragraph format so the swipe gesture
// can be tested without depending on real DB content. DELETE when shipping.

import { ForYouTab } from '@/components/feed/foryou/ForYouTab'
import type { ForYouArticle } from '@/components/feed/foryou/ForYouCard'

const MOCK: ForYouArticle[] = [
  {
    id: 'mock-1',
    title: 'García & Jiménez light up London at FIP Silver opener',
    title_translations: {
      es: 'García y Jiménez deslumbran en el FIP Silver de Londres',
      pt: 'García e Jiménez brilham na abertura do FIP Silver de Londres',
      it: 'García e Jiménez accendono il FIP Silver di Londra',
      fr: 'García et Jiménez illuminent le FIP Silver de Londres',
    },
    source_url: 'https://www.padelfip.com/news/london-padel-open-2026/',
    source_name: 'FIP',
    favicon_url: 'https://www.google.com/s2/favicons?domain=padelfip.com&sz=64',
    image_url: 'https://www.padelfip.com/wp-content/uploads/2026/05/Jimenez-Casas.jpg.jpeg',
    published_at: new Date(Date.now() - 2 * 3600_000).toISOString(),
    language: 'en',
    summary_md: 'Top-seed pair **García & Jiménez** open the **FIP Silver HOP London Padel Open** on Friday, leading the men\'s draw. Main challengers **Arroyo & Martinez** earned their place through dominant qualifying performances. The women\'s draw is led by **Castelló**, supported by home-favourite British wildcards. Action runs Friday through Sunday with finals streamed live.',
    summary_translations: {
      es: 'La pareja cabeza de serie **García y Jiménez** abre el **FIP Silver HOP London Padel Open** el viernes, liderando el cuadro masculino. Sus principales rivales, **Arroyo y Martinez**, se ganaron su lugar tras dominar la fase de clasificación. El cuadro femenino lo lidera **Castelló**, con wildcards británicas locales. Los partidos se disputan de viernes a domingo, con las finales en directo.',
      pt: 'A dupla cabeça de chave **García e Jiménez** abre o **FIP Silver HOP London Padel Open** na sexta, liderando o quadro masculino. Os principais rivais **Arroyo e Martinez** garantiram sua vaga após dominarem a fase de classificação. O quadro feminino é liderado por **Castelló**, com wildcards britânicas locais. Jogos de sexta a domingo, finais transmitidas ao vivo.',
      it: 'La coppia testa di serie **García e Jiménez** apre il **FIP Silver HOP London Padel Open** venerdì, guidando il tabellone maschile. I principali sfidanti **Arroyo e Martinez** si sono guadagnati il posto dopo aver dominato le qualificazioni. Il tabellone femminile è guidato da **Castelló**, con wildcard britanniche locali. Gare da venerdì a domenica, finali in diretta.',
      fr: 'La paire tête de série **García et Jiménez** ouvre le **FIP Silver HOP London Padel Open** vendredi, en tête du tableau masculin. Les principaux challengers **Arroyo et Martinez** se sont qualifiés après avoir dominé les qualifications. Le tableau féminin est mené par **Castelló**, avec des wildcards britanniques locales. Matchs de vendredi à dimanche, finales en direct.',
    },
    tournament_level: 'FIP Silver',
  },
  {
    id: 'mock-2',
    title: 'Premier Padel announces 2027 schedule with three new venues',
    title_translations: {
      es: 'Premier Padel anuncia el calendario 2027 con tres nuevas sedes',
      pt: 'Premier Padel anuncia calendário 2027 com três novas sedes',
      it: 'Premier Padel annuncia il calendario 2027 con tre nuove sedi',
      fr: 'Premier Padel dévoile le calendrier 2027 avec trois nouvelles villes',
    },
    source_url: 'https://www.premierpadel.com/news/2027-schedule/',
    source_name: 'Premier Padel',
    favicon_url: 'https://www.google.com/s2/favicons?domain=premierpadel.com&sz=64',
    image_url: 'https://images.unsplash.com/photo-1554068865-24cecd4e34b8?w=1200&h=800&fit=crop',
    published_at: new Date(Date.now() - 5 * 3600_000).toISOString(),
    language: 'en',
    summary_md: '**Premier Padel** has unveiled **24 events** across 5 continents for the 2027 season. Three new venues join the tour: **Tokyo**, **São Paulo**, and **Cape Town**. The total prize pool grows by **18%** year-over-year — the largest jump since the tour\'s founding. The season finals return to **Madrid** for the third consecutive year, anchoring November.',
    summary_translations: {
      es: '**Premier Padel** ha desvelado **24 eventos** en 5 continentes para la temporada 2027. Tres nuevas sedes se suman al circuito: **Tokio**, **São Paulo** y **Ciudad del Cabo**. El pozo de premios crece un **18%** interanual, el mayor salto desde el inicio del tour. Las Finals vuelven a **Madrid** por tercer año consecutivo, anclando noviembre.',
      pt: 'A **Premier Padel** revelou **24 eventos** em 5 continentes para a temporada 2027. Três novas sedes entram no circuito: **Tóquio**, **São Paulo** e **Cidade do Cabo**. A premiação total cresce **18%** ano-a-ano, o maior salto desde a fundação do tour. As Finals voltam a **Madri** pelo terceiro ano seguido, ancorando novembro.',
      it: '**Premier Padel** ha svelato **24 eventi** in 5 continenti per la stagione 2027. Tre nuove sedi entrano nel circuito: **Tokyo**, **San Paolo** e **Città del Capo**. Il montepremi totale cresce del **18%** anno su anno, il più grande salto dalla nascita del tour. Le Finals tornano a **Madrid** per il terzo anno consecutivo, ancorando novembre.',
      fr: '**Premier Padel** a dévoilé **24 tournois** sur 5 continents pour la saison 2027. Trois nouvelles villes rejoignent le circuit : **Tokyo**, **São Paulo** et **Le Cap**. La dotation totale augmente de **18%** sur un an, le plus grand bond depuis la création du circuit. Les Finals retournent à **Madrid** pour la troisième année consécutive, ancrant novembre.',
    },
    tournament_level: 'Premier',
  },
  {
    id: 'mock-3',
    title: 'Bullpadel launches signature racket line with Coello & Tapia',
    title_translations: {
      es: 'Bullpadel estrena línea signature con Coello y Tapia',
      pt: 'Bullpadel lança linha signature com Coello e Tapia',
      it: 'Bullpadel lancia la linea signature con Coello e Tapia',
      fr: 'Bullpadel lance une gamme signature avec Coello et Tapia',
    },
    source_url: 'https://bullpadel.com/news/coello-tapia-signature-2026/',
    source_name: 'Bullpadel',
    favicon_url: 'https://www.google.com/s2/favicons?domain=bullpadel.com&sz=64',
    image_url: 'https://images.unsplash.com/photo-1626224583764-f87db24ac4ea?w=1200&h=800&fit=crop',
    published_at: new Date(Date.now() - 14 * 3600_000).toISOString(),
    language: 'en',
    summary_md: '**Bullpadel** debuts a signature racket line designed with **Coello & Tapia**, the world No. 1 pair. Three new models — **Vertex 04**, **Hack 04**, and **Neuron** — are each tuned for the duo\'s playing style. Global availability begins **June 1st**, with pre-orders open this week. The collaboration extends the brand\'s decade-long partnership with the Argentine duo.',
    summary_translations: {
      es: '**Bullpadel** estrena una línea signature diseñada con **Coello y Tapia**, la pareja Nº1 del mundo. Tres nuevos modelos — **Vertex 04**, **Hack 04** y **Neuron** — están afinados al estilo del dúo. Disponibilidad mundial desde el **1 de junio**, con pre-orders abiertas esta semana. La colaboración extiende una década de alianza de la marca con el dúo argentino.',
      pt: 'A **Bullpadel** estreia uma linha signature desenhada com **Coello e Tapia**, a dupla Nº1 do mundo. Três novos modelos — **Vertex 04**, **Hack 04** e **Neuron** — são ajustados ao estilo da dupla. Disponibilidade global a partir de **1º de junho**, com pré-vendas abertas esta semana. A colaboração estende a década de aliança da marca com a dupla argentina.',
      it: '**Bullpadel** lancia una linea signature progettata con **Coello e Tapia**, la coppia N°1 al mondo. Tre nuovi modelli — **Vertex 04**, **Hack 04** e **Neuron** — sono calibrati sullo stile del duo. Disponibilità globale dal **1° giugno**, con preordini aperti questa settimana. La collaborazione estende la decennale partnership del brand con il duo argentino.',
      fr: '**Bullpadel** dévoile une gamme signature conçue avec **Coello et Tapia**, la paire N°1 mondiale. Trois nouveaux modèles — **Vertex 04**, **Hack 04** et **Neuron** — sont adaptés au style du duo. Disponibilité mondiale dès le **1er juin**, avec les précommandes ouvertes cette semaine. La collaboration prolonge la décennie de partenariat de la marque avec le duo argentin.',
    },
    tournament_level: null,
  },
]

export default function ScratchForYou() {
  return (
    <div style={{ background: '#0a0a0a', minHeight: '100vh' }}>
      <div style={{
        position: 'fixed', top: 8, left: 8, zIndex: 50,
        padding: '4px 10px',
        background: '#F5A623', color: '#0a0a0a',
        fontSize: 10, fontWeight: 800, letterSpacing: '0.08em', textTransform: 'uppercase',
        clipPath: 'polygon(3% 5%, 97% 0%, 100% 95%, 0% 100%)',
        pointerEvents: 'none',
      }}>
        SCRATCH · mock paragraph format · delete before V1 ship
      </div>
      <ForYouTab articles={MOCK} exitHref="/feed" />
    </div>
  )
}
