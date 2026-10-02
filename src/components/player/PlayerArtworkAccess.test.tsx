import React from 'react'
import {renderToStaticMarkup} from 'react-dom/server'
import {afterEach,expect,it,vi} from 'vitest'
import {PlayerFigure} from '../PlayerAvatar'
afterEach(()=>vi.unstubAllEnvs())
it('keeps legacy profile artwork outside the approved Play experience',()=>{
 vi.stubEnv('NODE_ENV','production')
 expect(renderToStaticMarkup(<PlayerFigure outfit="face-06"/>)).not.toContain('data-avatar-renderer="a01"')
 expect(renderToStaticMarkup(<PlayerFigure outfit="face-06" approvedArtwork/>)).toContain('data-avatar-renderer="a01"')
})
