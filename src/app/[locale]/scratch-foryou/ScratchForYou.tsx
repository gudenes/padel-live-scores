'use client'
// src/app/[locale]/scratch-foryou/ScratchForYou.tsx
// Mock articles so we can see the ForYouTab + ForYouCard rendering
// with real components, real swipe gesture, real bookmark toggle.

import { ForYouTab } from '@/components/feed/foryou/ForYouTab'
import type { ForYouArticle } from '@/components/feed/foryou/ForYouCard'

const MOCK: ForYouArticle[] = [
  {
    id: 'mock-1',
    title: 'García & Jiménez light up London at FIP Silver opener',
    source_url: 'https://www.padelfip.com/news/london-padel-open-2026/',
    source_name: 'FIP',
    favicon_url: 'https://www.google.com/s2/favicons?domain=padelfip.com&sz=64',
    image_url: 'https://www.padelfip.com/wp-content/uploads/2026/05/Jimenez-Casas.jpg.jpeg',
    published_at: new Date(Date.now() - 2 * 3600_000).toISOString(),
    language: 'en',
    summary_md: [
      '• **Top-seed pair** begins FIP Silver HOP London Padel Open campaign on Friday, leading the men\'s draw',
      '• Arroyo & Martinez emerge as **main challengers** after qualifying-round dominance',
      '• Women\'s draw led by **Castelló** with home-favourite British wildcards in play',
    ].join('\n'),
    summary_translations: {
      es: [
        '• La **pareja cabeza de serie** inicia el FIP Silver HOP London Padel Open el viernes, liderando el cuadro masculino',
        '• Arroyo & Martinez emergen como **principales rivales** tras dominar la fase previa',
        '• Cuadro femenino liderado por **Castelló** con wildcards británicas en juego',
      ].join('\n'),
      pt: [
        '• A **dupla cabeça de chave** começa o FIP Silver HOP London Padel Open na sexta, liderando o quadro masculino',
        '• Arroyo & Martinez surgem como **principais desafiantes** após dominarem o qualifying',
        '• Quadro feminino liderado por **Castelló** com wildcards britânicas em jogo',
      ].join('\n'),
      it: [
        '• La **coppia teste di serie** inizia il FIP Silver HOP London Padel Open venerdì, guidando il tabellone maschile',
        '• Arroyo & Martinez emergono come **principali sfidanti** dopo il dominio nelle qualificazioni',
        '• Tabellone femminile guidato da **Castelló** con wildcard britanniche in gara',
      ].join('\n'),
      fr: [
        '• La **paire tête de série** entame le FIP Silver HOP London Padel Open vendredi en tête du tableau masculin',
        '• Arroyo & Martinez s\'imposent comme les **principaux challengers** après les qualifications',
        '• Tableau féminin mené par **Castelló** avec des wildcards britanniques en lice',
      ].join('\n'),
    },
    tournament_level: 'FIP Silver',
  },
  {
    id: 'mock-2',
    title: 'Premier Padel announces 2027 schedule with three new venues',
    source_url: 'https://www.premierpadel.com/news/2027-schedule/',
    source_name: 'Premier Padel',
    favicon_url: 'https://www.google.com/s2/favicons?domain=premierpadel.com&sz=64',
    image_url: 'https://images.unsplash.com/photo-1554068865-24cecd4e34b8?w=1200&h=800&fit=crop',
    published_at: new Date(Date.now() - 5 * 3600_000).toISOString(),
    language: 'en',
    summary_md: [
      '• Premier Padel unveils **24 events** across 5 continents for the 2027 season',
      '• **Three new venues** added: Tokyo, São Paulo, and Cape Town join the calendar',
      '• Prize pool grows by **18%** year-over-year, the largest jump since the tour\'s founding',
      '• Season finals return to Madrid for the third consecutive year',
    ].join('\n'),
    summary_translations: {
      es: [
        '• Premier Padel revela **24 eventos** en 5 continentes para la temporada 2027',
        '• **Tres nuevas sedes**: Tokio, São Paulo y Ciudad del Cabo se suman al calendario',
        '• El pozo de premios crece un **18%** interanual, el mayor salto desde el inicio del tour',
        '• Las Finals vuelven a Madrid por tercer año consecutivo',
      ].join('\n'),
      pt: [
        '• Premier Padel revela **24 eventos** em 5 continentes para a temporada 2027',
        '• **Três novas sedes**: Tóquio, São Paulo e Cidade do Cabo entram no calendário',
        '• Premiação cresce **18%** ano-a-ano, o maior salto desde a fundação do tour',
        '• Finals voltam a Madri pelo terceiro ano seguido',
      ].join('\n'),
      it: [
        '• Premier Padel svela **24 eventi** in 5 continenti per la stagione 2027',
        '• **Tre nuove sedi**: Tokyo, San Paolo e Città del Capo entrano nel calendario',
        '• Il montepremi cresce del **18%** anno su anno, il salto più grande dalla nascita del tour',
        '• Le Finals tornano a Madrid per il terzo anno consecutivo',
      ].join('\n'),
      fr: [
        '• Premier Padel dévoile **24 tournois** sur 5 continents pour la saison 2027',
        '• **Trois nouveaux sites** : Tokyo, São Paulo et Le Cap rejoignent le calendrier',
        '• La dotation augmente de **18%** sur un an, plus grand bond depuis la création du circuit',
        '• Les Finals retournent à Madrid pour la troisième année consécutive',
      ].join('\n'),
    },
    tournament_level: 'Premier',
  },
  {
    id: 'mock-3',
    title: 'Bullpadel launches signature racket line with Coello & Tapia',
    source_url: 'https://bullpadel.com/news/coello-tapia-signature-2026/',
    source_name: 'Bullpadel',
    favicon_url: 'https://www.google.com/s2/favicons?domain=bullpadel.com&sz=64',
    image_url: 'https://images.unsplash.com/photo-1626224583764-f87db24ac4ea?w=1200&h=800&fit=crop',
    published_at: new Date(Date.now() - 14 * 3600_000).toISOString(),
    language: 'en',
    summary_md: [
      '• Bullpadel debuts **Coello-Tapia signature line** designed with the world No. 1 pair',
      '• Three new models: **Vertex 04, Hack 04, and Neuron**, each tuned for the duo\'s playing styles',
      '• Available globally from June 1st with **pre-orders** opening this week',
    ].join('\n'),
    summary_translations: {
      es: [
        '• Bullpadel estrena la **línea signature Coello-Tapia** diseñada con la pareja Nº1 del mundo',
        '• Tres nuevos modelos: **Vertex 04, Hack 04 y Neuron**, cada uno ajustado al estilo del dúo',
        '• Disponible mundialmente desde el 1 de junio con **pre-orders** abiertas esta semana',
      ].join('\n'),
      pt: [
        '• Bullpadel estreia a **linha signature Coello-Tapia** desenhada com a dupla Nº1 do mundo',
        '• Três novos modelos: **Vertex 04, Hack 04 e Neuron**, cada um ajustado ao estilo da dupla',
        '• Disponível globalmente a partir de 1º de junho com **pré-vendas** abertas esta semana',
      ].join('\n'),
      it: [
        '• Bullpadel lancia la **linea signature Coello-Tapia** progettata con la coppia N°1 al mondo',
        '• Tre nuovi modelli: **Vertex 04, Hack 04 e Neuron**, ognuno calibrato sullo stile del duo',
        '• Disponibile globalmente dal 1° giugno con **pre-ordini** aperti questa settimana',
      ].join('\n'),
      fr: [
        '• Bullpadel dévoile la **gamme signature Coello-Tapia** conçue avec la paire N°1 mondiale',
        '• Trois nouveaux modèles : **Vertex 04, Hack 04 et Neuron**, chacun adapté au style du duo',
        '• Disponible dans le monde dès le 1er juin avec les **précommandes** ouvertes cette semaine',
      ].join('\n'),
    },
    tournament_level: null, // Brand article — no topic chip; renders without one
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
      }}>
        SCRATCH · mock data · delete before merge
      </div>
      <ForYouTab articles={MOCK} />
    </div>
  )
}
