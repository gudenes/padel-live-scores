import {describe, it, expect} from 'vitest'
import {previewBirthplace, summarizePreview, catalogueSource, type PreviewPlayer} from '../birthplace-preview'
const player: PreviewPlayer = {id:'test',name:'Test player',country:'ES',birthplace:null,ranking:null,profile_status:'ok'}
const resolve = (birthplace: string | null, country = 'ES') => previewBirthplace({...player,birthplace,country})
describe('read-only birthplace proposals', () => {
  it('uses the complete pinned official catalogue', () => {
    expect(catalogueSource.count).toBe(8132)
    expect(catalogueSource.catalunya).toBe(947)
  })
  it.each(['Castellar del Vallès','Cambrils','Berga','la Garriga','Ripoll','Sant Fruitós de Bages','Tornabous','Valls','Vic','Hospitalet de LLobregat'])('finds omitted Catalan municipalities: %s', name => {
    expect(resolve(name).status).toBe('catalunya')
    expect(resolve(name).candidates[0].region).toBe('09')
  })
  it('matches accents, whitespace, official articles and supported aliases', () => {
    expect(resolve(' CASTELLAR DEL VALLES ').candidates[0].id).toBe(resolve('Castellar del Vallès').candidates[0].id)
    expect(resolve('Gerona').candidates[0].name).toBe('Girona')
    expect(resolve("L'Hospitalet de Llobregat").candidates[0].id).toBe('08101')
    expect(resolve('Lérida').candidates[0].id).toBe('25120')
  })
  it('does not use nationality as birth country', () => {
    expect(resolve('Vic','AE').status).toBe('catalunya')
    expect(resolve('Barcelona','IT').status).toBe('catalunya')
    expect(resolve(null,'ES').status).toBe('missing')
    expect(resolve('Barcelona').reason).toContain('birth country must be verified')
  })
  it('only strips explicit Spain suffixes, never arbitrary substrings', () => {
    expect(resolve('Barcelona, Spain').reason).toContain('Spain is explicit')
    expect(resolve('Barcelona, Venezuela').status).toBe('review')
    expect(resolve('Vilanova').status).toBe('review')
    expect(resolve('Victoria').status).not.toBe('catalunya')
  })
  it.each([null,'','  ','-','—','N/A'])('recognizes missing placeholders %s', value => {
    expect(resolve(value).status).toBe('missing')
  })
  it('does not classify foreign or region-level text as outside Catalunya', () => {
    expect(resolve('Buenos Aires').status).toBe('review')
    expect(resolve('Catalunya').status).toBe('review')
  })
  it('keeps counts exhaustive and does not modify the input', () => {
    const source = Object.freeze({...player,birthplace:'Cambrils'})
    expect(previewBirthplace(source).status).toBe('catalunya')
    const summary = summarizePreview([resolve('Cambrils'),resolve('Madrid'),resolve('Buenos Aires'),resolve(null)])
    expect(summary).toEqual({catalunya:1,other:1,review:1,missing:1})
  })
})
