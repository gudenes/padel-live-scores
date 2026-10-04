import {describe,it,expect} from 'vitest'
import {predictionRate,type PredictionRateRow} from '../prediction-rate'
const row=(r:Partial<PredictionRateRow>={}):PredictionRateRow=>({status:'settled',outcome:true,revision:1,payoutRevision:1,yesShares:20,noShares:0,...r})
describe('prediction rate',()=>{
 it('counts sides once regardless of shares',()=>{expect(predictionRate([row(),row({outcome:false}),row({yesShares:0,noShares:500,outcome:false})])).toEqual({correct:2,settled:3,percent:67})})
 it('excludes pending, refunds, unconfirmed corrections and exited positions',()=>{expect(predictionRate([row({status:'open'}),row({status:'void'}),row({revision:2}),row({yesShares:0}),row({outcome:null})])).toEqual({correct:0,settled:0,percent:null})})
 it('counts both held sides consistently with result cards',()=>{expect(predictionRate([row({noShares:10})])).toEqual({correct:1,settled:2,percent:50})})
})
