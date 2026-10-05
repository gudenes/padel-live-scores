// @vitest-environment jsdom
import {beforeEach,it,expect,vi} from 'vitest'
import {render,screen,fireEvent,cleanup} from '@testing-library/react'
import {NextIntlClientProvider} from 'next-intl'
import messages from '@/messages/en.json'
import ResultPanel from './ResultPanel'
vi.mock('@/components/player/shop/AvatarShop',()=>({ShopProfileFigure:()=>null}))
const result={id:'n',marketId:'m',question:'Will A win?',match:'A vs B',context:'Final',side:'yes',kind:'won' as const,paid:380,cost:200,delta:380}
beforeEach(()=>{cleanup();window.matchMedia=vi.fn().mockReturnValue({matches:false,addEventListener:vi.fn(),removeEventListener:vi.fn()});HTMLDialogElement.prototype.showModal=vi.fn(function(this:HTMLDialogElement){this.setAttribute('open','')});HTMLDialogElement.prototype.close=vi.fn(function(this:HTMLDialogElement){this.removeAttribute('open')})})
it('opens an accessible dialog and routes through the explicit result action',()=>{const close=vi.fn(),view=vi.fn();render(<NextIntlClientProvider locale="en" messages={messages}><ResultPanel preview result={result} onClose={close} onView={view}/></NextIntlClientProvider>);expect(screen.getByText('Well played!')).toBeTruthy();expect(screen.getByText('200 played · +180 net')).toBeTruthy();fireEvent.click(screen.getByRole('button',{name:/view result/i}));expect(view).toHaveBeenCalledOnce();fireEvent.click(screen.getByRole('button',{name:'Close result'}));expect(close).toHaveBeenCalledOnce()})
it('shows the original amount played on a loss without another deduction',()=>{render(<NextIntlClientProvider locale="en" messages={messages}><ResultPanel preview result={{...result,kind:'lost',paid:0,delta:0}} onClose={()=>{}} onView={()=>{}}/></NextIntlClientProvider>);expect(screen.getByText('Not this time')).toBeTruthy();expect(screen.getByText('200')).toBeTruthy();expect(screen.getByText('Your Guacas were used when you made this prediction.')).toBeTruthy();expect(screen.queryByText('Guacas received')).toBeNull()})

it('groups mixed outcomes and totals only the actual payouts',()=>{render(<NextIntlClientProvider locale="en" messages={messages}><ResultPanel preview result={result} results={[result,{...result,id:'loss',kind:'lost',paid:0,delta:0},{...result,id:'refund',kind:'refunded',paid:200,delta:200}]} onClose={()=>{}} onView={()=>{}}/></NextIntlClientProvider>);expect(screen.getByText('3 new results')).toBeTruthy();expect(screen.getByText('580')).toBeTruthy();expect(screen.getByRole('button',{name:/view results/i})).toBeTruthy();expect(screen.queryByText('Well played!')).toBeNull()})
