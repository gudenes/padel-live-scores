import { expect, it } from 'vitest'
import { rememberWalletBalance } from '../wallet-motion'
function store(){const values=new Map<string,string>();return {getItem:(key:string)=>values.get(key)??null,setItem:(key:string,value:string)=>{values.set(key,value)}}}
it('establishes a baseline, detects gains and decreases, and never replays a seen balance',()=>{
 const storage=store()
 expect(rememberWalletBalance(storage,'a:season',6780)).toBeNull()
 expect(rememberWalletBalance(storage,'a:season',7160)).toBe(6780)
 expect(rememberWalletBalance(storage,'a:season',7160)).toBeNull()
 expect(rememberWalletBalance(storage,'a:season',7040)).toBe(7160)
})
it('isolates accounts and season resets',()=>{
 const storage=store();rememberWalletBalance(storage,'a:1',6780)
 expect(rememberWalletBalance(storage,'b:1',7000)).toBeNull()
 expect(rememberWalletBalance(storage,'a:2',7000)).toBeNull()
})
it('ignores unavailable balances and storage failures',()=>{
 const storage=store();rememberWalletBalance(storage,'a',10)
 expect(rememberWalletBalance(storage,'a',NaN)).toBeNull()
 expect(rememberWalletBalance(storage,'a',15)).toBe(10)
 expect(rememberWalletBalance({getItem(){throw Error('blocked')},setItem(){}},'a',20)).toBeNull()
})
