export const shots = {
  groundstroke:'Groundstroke', volley:'Volley', smash:'Smash', vibora:'Víbora', bandeja:'Bandeja', bajada:'Bajada', rulo:'Rulo', chiquita:'Chiquita', lob:'Lob', drop:'Drop shot', return:'Return', serve:'Serve',
  wall:'Wall return', gancho:'Gancho', half_volley:'Half-volley', block:'Block', contrapared:'Contrapared', other:'Other',
} as const
export type Shot = keyof typeof shots
export type ShotSide = 'forehand'|'backhand'
export const mainShots = Object.keys(shots).slice(0,12) as Shot[]
export const moreShots = Object.keys(shots).slice(12) as Shot[]
