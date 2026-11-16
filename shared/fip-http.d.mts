import { Dispatcher } from 'undici'
export const FIP_USER_AGENT: string
export function isFipRequest(options: Pick<Dispatcher.DispatchOptions, 'origin'> & Partial<Pick<Dispatcher.DispatchOptions, 'path'>>): boolean
export function normalizeFipRestUrl(input: string): string
export class FipDispatcher extends Dispatcher {
  constructor(direct: Dispatcher, proxy: Dispatcher)
  dispatch(options: Dispatcher.DispatchOptions, handler: Dispatcher.DispatchHandler): boolean
}
export function installFipProxy(): void
