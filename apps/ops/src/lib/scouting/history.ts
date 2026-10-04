// JSONB storage may reorder object keys. Compare data, not serialization order;
// array order remains significant because scouting events form an ordered log.
export function historyJson(value:unknown):string {
  return JSON.stringify(value,(_key,item)=>{
    if(item&&typeof item==='object'&&!Array.isArray(item)){
      return Object.fromEntries(Object.keys(item).sort().map(key=>[key,item[key]]))
    }
    return item
  })??'null'
}
