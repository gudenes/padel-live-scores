import {afterEach,beforeEach,expect,it,vi} from 'vitest'
import {analyticsChoice,chooseAnalytics,sharedReportEvent} from '../shared-report'
let values:Map<string,string>
beforeEach(()=>{values=new Map();const storage={getItem:(k:string)=>values.get(k)??null,setItem:(k:string,v:string)=>values.set(k,v)};vi.stubGlobal('localStorage',storage);vi.stubGlobal('sessionStorage',storage);vi.stubGlobal('window',{});vi.stubGlobal('fetch',vi.fn().mockResolvedValue({ok:true}));vi.stubEnv('NEXT_PUBLIC_POSTHOG_KEY','test-project')})
afterEach(()=>{vi.unstubAllGlobals();vi.unstubAllEnvs()})
it('does not send without consent or after decline',()=>{sharedReportEvent('shared_report_viewed');chooseAnalytics(false);sharedReportEvent('shared_report_viewed');expect(fetch).not.toHaveBeenCalled()})
it('expires old consent',()=>{values.set('pn_consent',JSON.stringify({analytics:true,decided_at:'2020-01-01'}));expect(analyticsChoice()).toBeNull()})
it('sends explicit events without URLs, emails, cookies or a referrer',()=>{chooseAnalytics(true);sharedReportEvent('shared_report_tab_selected',{tab:'Video review'});const [url,options]=vi.mocked(fetch).mock.calls[0];expect(url).toBe('https://eu.i.posthog.com/capture/');expect(options).toMatchObject({credentials:'omit',referrerPolicy:'no-referrer'});const payload=JSON.parse(options!.body as string);expect(payload.properties).toMatchObject({app_surface:'shared_report',tab:'Video review',$process_person_profile:false});expect(payload.properties).not.toHaveProperty('$current_url');expect(payload.properties).not.toHaveProperty('email')})
