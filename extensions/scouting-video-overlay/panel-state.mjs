// The worker retains the full record; normal UI replies need only undo labels
// and saved-session summaries. Explicit exports continue to receive all data.
export function panelState(state){
 return {...state,history:(state.history??[]).map(entry=>({type:entry.type})),sessions:Object.fromEntries(Object.entries(state.sessions??{}).map(([id,session])=>[id,{selectedMatch:session.selectedMatch,setup:{videoPageUrl:session.setup?.videoPageUrl,videoSourceUrl:session.setup?.videoSourceUrl},pointCount:(session.rallies??[]).filter(r=>r.point&&!r.undone).length}]))};
}
