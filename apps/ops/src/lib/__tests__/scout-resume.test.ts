// @vitest-environment jsdom
import {it,expect,vi,afterEach} from 'vitest'
import {confirmResume} from '../../../public/scout-web/resume-warning.mjs'
afterEach(()=>{document.body.innerHTML='';vi.restoreAllMocks()})
it('does not interrupt the original scouter',async()=>{expect(await confirmResume(null)).toBe(true);expect(document.querySelector('dialog')).toBeNull()})
it('requires explicit confirmation and renders creator text safely',async()=>{
 HTMLDialogElement.prototype.showModal=function(){this.open=true}
 HTMLDialogElement.prototype.close=function(){this.open=false}
 const pending=confirmResume({creator:'<b>other@example.com</b>',unknown:false})
 expect(document.querySelector('#resume-warning-description')?.textContent).toContain('<b>other@example.com</b>')
 expect(document.querySelector('#resume-warning-description b')).toBeNull()
 expect(document.activeElement).toBe(document.querySelector('[data-cancel]'))
 document.querySelector<HTMLButtonElement>('[data-continue]')!.click()
 expect(await pending).toBe(true);expect(document.querySelector('dialog')).toBeNull()
})
it('allows cancelling an unknown-owner legacy session',async()=>{
 HTMLDialogElement.prototype.showModal=function(){this.open=true}
 HTMLDialogElement.prototype.close=function(){this.open=false}
 const pending=confirmResume({creator:'Another scouter',unknown:true})
 expect(document.querySelector('dialog')?.textContent).toContain('original scouter is unknown')
 document.querySelector<HTMLButtonElement>('[data-cancel]')!.click()
 expect(await pending).toBe(false)
})
