import {it,expect} from 'vitest'
import {interpretMatchQuestion} from '../assistant-model'
import {emptyAssistantFilters} from '../assistant-filters'
// Explicit opt-in: this uses a real API key and incurs API usage.
it.skipIf(process.env.RUN_MATCH_ASSISTANT_LIVE!=='1')('interprets the real Coello request and follow-up',async()=>{const first=await interpretMatchQuestion('Give me all matches where Coello lost this year',emptyAssistantFilters);expect(first.disposition).toBe('search');expect(first.filters.player_name).toMatch(/Coello/i);expect(first.filters.outcome).toBe('lost');expect(first.filters.start_date).toBe(new Intl.DateTimeFormat('en',{timeZone:'Europe/Madrid',year:'numeric'}).format(new Date())+'-01-01');const second=await interpretMatchQuestion('Only finals',{...first.filters,player_name:'Arturo Coello'});expect(second.filters.round).toBe('final');expect(second.filters.outcome).toBe('lost');expect(second.filters.player_name).toBe('Arturo Coello')},70000)
