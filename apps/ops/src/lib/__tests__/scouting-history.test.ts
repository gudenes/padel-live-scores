import {it,expect} from 'vitest'
import {historyJson} from '../scouting/history'
it('ignores object key order at every depth without changing event order or values',()=>{
 expect(historyJson({events:[{kind:'score',seed:{game:{a:15,b:0}}}],version:1})).toBe(historyJson({version:1,events:[{seed:{game:{b:0,a:15}},kind:'score'}]}))
 expect(historyJson([{id:'a'},{id:'b'}])).not.toBe(historyJson([{id:'b'},{id:'a'}]))
 expect(historyJson({player:0})).not.toBe(historyJson({player:1}))
})
