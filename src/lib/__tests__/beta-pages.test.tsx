import React from 'react'
import {afterEach,beforeEach,expect,it,vi} from 'vitest'
const gate=vi.hoisted(()=>vi.fn())
vi.mock('@/lib/play-access',()=>({requirePlayAccess:gate}))
vi.mock('@/app/[locale]/(app)/profile/BetaPage',()=>({default:()=>null}))
vi.mock('@/app/[locale]/(app)/profile/LegacyPage',()=>({default:()=>null}))
vi.mock('@/app/[locale]/(app)/achievements/BetaPage',()=>({default:()=>null}))
vi.mock('@/app/[locale]/(app)/achievements/LegacyPage',()=>({default:()=>null}))
import Profile from '@/app/[locale]/(app)/profile/page'
import Achievements from '@/app/[locale]/(app)/achievements/page'
import BetaProfile from '@/app/[locale]/(app)/profile/BetaPage'
import LegacyProfile from '@/app/[locale]/(app)/profile/LegacyPage'
import BetaAchievements from '@/app/[locale]/(app)/achievements/BetaPage'
import LegacyAchievements from '@/app/[locale]/(app)/achievements/LegacyPage'
beforeEach(()=>vi.stubGlobal('React',React))
afterEach(()=>vi.unstubAllGlobals())
it('preserves the existing profile and achievements for non-invited users',async()=>{
 gate.mockResolvedValue(null)
 expect((await Profile()).type).toBe(LegacyProfile)
 expect((await Achievements()).type).toBe(LegacyAchievements)
})
it('shows the new profile and collection only after the server grants Play access',async()=>{
 gate.mockResolvedValue({userId:'invited'})
 expect((await Profile()).type).toBe(BetaProfile)
 expect((await Achievements()).type).toBe(BetaAchievements)
})
