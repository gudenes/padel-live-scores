import {expect,it} from 'vitest'
import {settledNetWinnings} from '../settled-net-winnings'
it('counts net profit, losses, both sides and refunds; skips unpaid plays',()=>{
 const positions=[['a','winner',100],['b','winner',50],['a','loser',100],['r','refund',100],['p','pending',999]].map(([user_id,market_id,cost_basis])=>({user_id:String(user_id),market_id:String(market_id),cost_basis:Number(cost_basis)}))
 const scores=settledNetWinnings(positions,[
  {user_id:'a',market_id:'winner',yes_paid:180,no_paid:0},
  {user_id:'b',market_id:'winner',yes_paid:0,no_paid:0},
  {user_id:'a',market_id:'loser',yes_paid:0,no_paid:0},
  {user_id:'r',market_id:'refund',yes_paid:30,no_paid:70},
 ])
 expect(Object.fromEntries(scores)).toEqual({a:-20,b:-50,r:0})
})
it('uses corrected payout once and does not use wallet balance or shopping',()=>{
 const positions=[{user_id:'a',market_id:'m',cost_basis:100}]
 expect(settledNetWinnings(positions,[{user_id:'a',market_id:'m',yes_paid:200,no_paid:0}]).get('a')).toBe(100)
 expect(settledNetWinnings(positions,[{user_id:'a',market_id:'m',yes_paid:0,no_paid:0}]).get('a')).toBe(-100)
})
