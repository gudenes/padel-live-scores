export const shots = {
  groundstroke:'Groundstroke', volley:'Volley', smash:'Smash', vibora:'Víbora', bandeja:'Bandeja', bajada:'Bajada', rulo:'Rulo', chiquita:'Chiquita', lob:'Lob', drop:'Drop shot', return:'Return', serve:'Serve',
  wall:'Wall return', gancho:'Gancho', half_volley:'Half-volley', block:'Block', contrapared:'Contrapared', other:'Other',
} as const
export type Shot = keyof typeof shots
export type ShotSide = 'forehand'|'backhand'
export const mainShots = Object.keys(shots).slice(0,12) as Shot[]
export const moreShots = Object.keys(shots).slice(12) as Shot[]

export const spanishShots:Record<Shot,string>={groundstroke:'Golpe de fondo',volley:'Volea',smash:'Remate',vibora:'Víbora',bandeja:'Bandeja',bajada:'Bajada de pared',rulo:'Rulo',chiquita:'Chiquita',lob:'Globo',drop:'Dejada',return:'Resto',serve:'Saque',wall:'Salida de pared',gancho:'Gancho',half_volley:'Bote pronto',block:'Bloqueo',contrapared:'Contrapared',other:'Otro'}
export const returnTypes={lob:'Globo',low:'Bajo'} as const
export const returnFailures={net:'A la red',long:'Fuera — largo',wide:'Fuera — lateral',wall:'Pared/reja directa',miss:'Sin contacto',unclear:'No se aprecia'} as const
export type ReturnType=keyof typeof returnTypes
export type ReturnFailure=keyof typeof returnFailures
