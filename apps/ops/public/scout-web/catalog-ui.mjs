const normalize = s => String(s ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
export const premier = t => /premier|\bp[12]\b|\bmajor\b/i.test(`${t.level ?? ''} ${t.name}`) && !/^FIP\b/i.test(t.name);
export const searchMatches = (text, query) => normalize(query).split(' ').filter(Boolean).every(word => normalize(text).includes(word));
export function filterTournaments(all, query, premierOnly) {
 return all.filter(t => (!premierOnly || premier(t)) && searchMatches(`${t.name} ${t.country ?? ''} ${t.location ?? ''} ${t.level ?? ''} ${t.startsAt ?? ''}`, query));
}
export function filterMatches(all, query, category = '', round = '') {
 return all.filter(m => (!category || m.category === category) && (!round || m.round === round) && searchMatches(`${m.names.join(' ')} ${m.round ?? ''} ${m.category ?? ''} ${m.status ?? ''}`, query));
}
export function catalogUI({$, act}) {
 let activeId = '', lastState = null, lastBusy = false, tournamentsKey = '', matchesKey = '';
 const currentYear = new Date().getFullYear();
 for (let year = currentYear + 1; year >= 2020; year--) $('catalog-year').add(new Option(String(year), String(year)));
 for (const id of ['tournament-search', 'match-search', 'premier-only', 'match-category', 'match-round']) {
  $(id).addEventListener(['tournament-search', 'match-search'].includes(id) ? 'input' : 'change', () => { if (lastState) render(lastState, lastBusy); });
 }
 $('clear-catalog').onclick = () => { for (const id of ['tournament-search', 'match-search']) $(id).value = ''; $('tournament').value = ''; $('match-select').value = ''; act({type:'clear-catalog'}); };
 $('reload-matches').onclick = () => act({type:'load-matches',tournamentId:$('tournament').value});
 $('switch-match').onclick = () => act({type:'leave-match'});
 $('load-tournaments').onclick = () => act({type: 'load-tournaments', year: $('catalog-year').value});
 const chooseTournament = id => {
  $('tournament').value = id;
  $('match-search').value = ''; $('match-category').value = ''; $('match-round').value = '';
  $('match-select').replaceChildren(new Option('Choose match', ''));
  matchesKey = '';
  if (id) act({type: 'load-matches', tournamentId: id});
 };
 $('tournament').onchange = () => chooseTournament($('tournament').value);
 $('select-match').onclick = () => act({type: 'select-match', tournamentId: $('tournament').value, matchId: $('match-select').value});
 function result(id, selected, lines, meta, disabled, choose) {
  const button = document.createElement('button');
  button.type = 'button'; button.className = 'ui-btn catalog-result'; button.setAttribute('aria-pressed', String(selected)); button.disabled = disabled;
  for (const line of lines) { const span = document.createElement('span'); span.textContent = line; button.append(span); }
  const small = document.createElement('small'); small.textContent = meta; button.append(small);
  button.dataset.id = id;
  button.onclick = () => { const parent = button.parentElement; choose(id); const current = [...parent.children].find(el => el.dataset.id === id); if (current && !current.disabled) current.focus(); };
  return button;
 }
 function render(state, busy) {
  lastState = state; lastBusy = busy;
  if (state.selectedMatch?.id && state.selectedMatch.id !== activeId) { activeId = state.selectedMatch.id; $('catalog-panel').open = false; $('video-panel').open = true; }
  if (!state.selectedMatch && activeId) { activeId = ''; $('connection-settings').open = true; $('catalog-panel').open = true; }
  $('switch-match').disabled = busy || !!state.pending || !state.selectedMatch;
  const disabled = busy || !!state.pending;
  const all = state.catalog?.tournaments ?? [];
  const oldTournament = $('tournament').value || state.selectedMatch?.tournamentId;
  // Keep browsing selection separate from search results and from the active scouting session.
  $('tournament').replaceChildren(new Option('Choose tournament', ''), ...all.map(t => new Option(t.name, t.id)));
  if (all.some(t => t.id === oldTournament)) $('tournament').value = oldTournament;
  const id = $('tournament').value;
  const tournaments = filterTournaments(all, $('tournament-search').value, $('premier-only').checked);
  const tk = JSON.stringify([tournaments, id, disabled]);
  if (tk !== tournamentsKey) {
   tournamentsKey = tk;
   $('tournament-results').replaceChildren(...tournaments.map(t => result(t.id, t.id === id, [t.name], [t.location, t.country, t.startsAt?.slice(0, 10)].filter(Boolean).join(' · '), disabled, chooseTournament)));
  }
  $('tournament-count').textContent = !all.length ? 'Load tournaments to start searching.' : `${tournaments.length} tournament${tournaments.length === 1 ? '' : 's'}${!tournaments.length ? ' found. Try another search or turn off Premier Padel only.' : ''}`;
  $('tournament-choice').textContent = id ? `Matches in: ${all.find(t => t.id === id)?.name ?? ''}` : '';
  const loaded = state.catalog?.matchesByTournament?.[id];
  const available = loaded ?? [];
  const rounds = [...new Set(available.map(m => m.round).filter(Boolean))];
  const round = $('match-round').value;
  if (JSON.stringify(rounds) !== $('match-round').dataset.rounds) {
   $('match-round').dataset.rounds = JSON.stringify(rounds);
   $('match-round').replaceChildren(new Option('All rounds', ''), ...rounds.map(r => new Option(r, r)));
   if (rounds.includes(round)) $('match-round').value = round;
  }
  const matches = filterMatches(available, $('match-search').value, $('match-category').value, $('match-round').value);
  const oldMatch = $('match-select').value || (state.selectedMatch?.tournamentId === id ? state.selectedMatch.id : '');
  $('match-select').replaceChildren(new Option('Choose match', ''), ...matches.map(m => new Option(m.names.join(' / '), m.id)));
  if (matches.some(m => m.id === oldMatch)) $('match-select').value = oldMatch;
  const mk = JSON.stringify([id, matches, $('match-select').value, disabled]);
  if (mk !== matchesKey) {
   matchesKey = mk;
   $('match-results').replaceChildren(...matches.map(m => result(m.id, m.id === $('match-select').value, [m.names.slice(0, 2).join(' / '), `vs ${m.names.slice(2).join(' / ')}`], [m.category === 'men' ? 'Men' : m.category === 'women' ? 'Women' : m.category, m.round, m.status].filter(Boolean).join(' · '), disabled, matchId => { $('match-select').value = matchId; render(lastState, lastBusy); })));
  }
  $('match-count').textContent = !id ? 'Choose a tournament to see its matches.' : loaded === undefined ? (busy ? 'Loading matches…' : 'Matches unavailable. Select the tournament to retry.') : !available.length ? 'No linked matches available for this tournament.' : !matches.length ? 'No matches found. Try fewer names or change the draw / round filters.' : `${matches.length} of ${available.length} matches · select one below`;
  for (const control of ['load-tournaments', 'catalog-year', 'tournament', 'match-select', 'tournament-search', 'premier-only']) $(control).disabled = disabled;
  for (const control of ['match-search', 'match-category', 'match-round']) $(control).disabled = disabled || !id;
  $('clear-catalog').disabled = busy; $('reload-matches').disabled = disabled || !id;
  $('select-match').disabled = disabled || !$('match-select').value;
  $('selected-match').textContent = state.selectedMatch ? `Scouting: ${state.selectedMatch.tournamentName} · ${state.selectedMatch.names.slice(0, 2).join(' / ')} vs ${state.selectedMatch.names.slice(2).join(' / ')}` : 'No match selected';
 }
 return render;
}
