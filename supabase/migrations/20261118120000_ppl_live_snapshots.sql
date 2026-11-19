-- PPL is authoritative for both live and final scores. Unlike CourtBit/FIP,
-- there is no second results writer to wait for. No migration is run by the worker.
create or replace function public.reconcile_ppl_event(p_event jsonb, p_fixtures jsonb)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  tournament uuid; season_year_value int := extract(year from (p_event->>'startsAt')::date);
  fixture jsonb; home_season uuid; away_season uuid; tie uuid; matched uuid; mapped uuid;
  key text; legacy_key text; candidates int; division text := p_event->>'league';
begin
  if division not in ('ppl','ppl-ii') or coalesce(p_event->>'slug','') !~ '^[a-z0-9]+(-[a-z0-9]+)*$'
     or (p_event->>'endsAt')::date < (p_event->>'startsAt')::date then raise exception 'Invalid PPL event'; end if;
  perform pg_advisory_xact_lock(hashtext('ppl-event:'||(p_event->>'slug')));
  select id into tournament from public.tournaments where external_id=p_event->>'slug';
  if tournament is not null and not exists(select 1 from public.tournaments where id=tournament and source='ppl'
    and level=case division when 'ppl' then 'ppl' else 'ppl_ii' end) then raise exception 'PPL event mapping conflict'; end if;
  if tournament is null then
    insert into public.tournaments(name,external_id,source,level,starts_at,ends_at)
    values(p_event->>'name',p_event->>'slug','ppl',case division when 'ppl' then 'ppl' else 'ppl_ii' end,
      (p_event->>'startsAt')::date,(p_event->>'endsAt')::date) returning id into tournament;
  else
    update public.tournaments set name=p_event->>'name',starts_at=(p_event->>'startsAt')::date,
      ends_at=(p_event->>'endsAt')::date where id=tournament;
  end if;
  for fixture in select * from jsonb_array_elements(p_fixtures) loop
    if fixture->>'home'=fixture->>'away' or fixture->>'category' not in ('men','women') then raise exception 'Invalid PPL fixture sides'; end if;
    -- Teams/seasons are curated once. Do not create an unknown franchise or
    -- assign an old season when a new season appears upstream.
    select ts.id into strict home_season from public.team_seasons ts join public.teams tm on tm.id=ts.team_id
      where tm.source='ppl' and tm.external_id=fixture->>'home' and ts.league=division and ts.season_year=season_year_value;
    select ts.id into strict away_season from public.team_seasons ts join public.teams tm on tm.id=ts.team_id
      where tm.source='ppl' and tm.external_id=fixture->>'away' and ts.league=division and ts.season_year=season_year_value;
    key := (fixture->>'stage')||'|'||coalesce(fixture->>'session','')||'|'||(fixture->>'home')||'|'||(fixture->>'away');
    legacy_key := (fixture->>'stage')||'|'||coalesce(fixture->>'session','null')||'|'||(fixture->>'home')||'|'||(fixture->>'away');
    -- Reuse either historical encoding; two ties are ambiguous even if only
    -- one currently has a match. Never manufacture a parallel confrontation.
    select count(*), min(id::text)::uuid into candidates,tie from public.league_ties
      where tournament_id=tournament and tie_key in (key,legacy_key);
    if candidates>1 then raise exception 'PPL ambiguous existing tie'; end if;
    if tie is null then
    insert into public.league_ties(tournament_id,tie_key,stage,session_number,home_team_season_id,away_team_season_id,scheduled_at)
    values(tournament,key,fixture->>'stage',(fixture->>'session')::int,home_season,away_season,(fixture->>'scheduledAt')::timestamptz)
    on conflict(tournament_id,tie_key) do update set scheduled_at=excluded.scheduled_at returning id into tie;
    else
      update public.league_ties set scheduled_at=(fixture->>'scheduledAt')::timestamptz where id=tie;
    end if;
    if not exists(select 1 from public.league_ties where id=tie and home_team_season_id=home_season and away_team_season_id=away_season)
      then raise exception 'PPL tie identity conflict'; end if;
    select count(*),min(id::text)::uuid into candidates,matched from public.matches where tie_id=tie and category=fixture->>'category';
    if candidates>1 then raise exception 'PPL ambiguous existing fixture'; end if;
    select entity_id into mapped from public.entity_external_ids where entity_type='match' and source='ppl' and external_id=fixture->>'id';
    if mapped is not null and mapped is distinct from matched then raise exception 'PPL changed fixture identity'; end if;
    if matched is null then
      insert into public.matches(tournament_id,tie_id,category,round,status,scheduled_at)
        values(tournament,tie,fixture->>'category',fixture->>'stage','scheduled',(fixture->>'scheduledAt')::timestamptz) returning id into matched;
    else
      update public.matches set scheduled_at=(fixture->>'scheduledAt')::timestamptz where id=matched and status='scheduled';
    end if;
    insert into public.entity_external_ids(entity_type,entity_id,source,external_id,metadata)
      values('match',matched,'ppl',fixture->>'id',jsonb_build_object('tournament',p_event->>'slug'))
      on conflict(source,entity_type,external_id) do nothing;
  end loop;
  return tournament;
end $$;
revoke all on function public.reconcile_ppl_event(jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.reconcile_ppl_event(jsonb,jsonb) to service_role;

create or replace function public.apply_ppl_snapshot(
  p_tournament uuid, p_match uuid, p_tie_key text, p_old_players uuid[],
  p_players uuid[], p_snapshot jsonb
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  m public.matches%rowtype;
  t public.league_ties%rowtype;
  old_snapshot jsonb;
  rev timestamptz := (p_snapshot->>'revision')::timestamptz;
  provider_id text := p_snapshot->>'providerId';
  item jsonb;
  participant jsonb;
  set_uuid uuid;
  idx integer;
  sid uuid;
begin
  select * into strict m from public.matches where id=p_match for update;
  select * into strict t from public.league_ties where id=m.tie_id;
  if m.tournament_id <> p_tournament or t.tournament_id <> p_tournament or t.tie_key <> p_tie_key
     or m.category <> p_snapshot->>'category' then raise exception 'PPL fixture identity conflict'; end if;
  if not exists(select 1 from public.tournaments where id=p_tournament and source='ppl'
      and external_id=p_snapshot->>'tournamentSlug'
      and level=case p_snapshot->>'league' when 'ppl' then 'ppl' when 'ppl-ii' then 'ppl_ii' end)
     then raise exception 'PPL tournament identity conflict'; end if;
  if provider_id is null or rev is null or p_snapshot->>'status' not in ('live','finished')
     or cardinality(p_players) <> 4 or (select count(distinct x) from unnest(p_players) x) <> 4
     or jsonb_array_length(p_snapshot->'players') <> 4 then raise exception 'Invalid PPL snapshot'; end if;
  if array[m.pair1_player1_id,m.pair1_player2_id,m.pair2_player1_id,m.pair2_player2_id] is distinct from p_old_players
     then return jsonb_build_object('applied',false,'reason','lineup_changed'); end if;
  if exists(select 1 from public.entity_external_ids where source='ppl' and entity_type='match'
     and external_id=provider_id and entity_id<>p_match) then raise exception 'PPL provider ID conflict'; end if;
  select metadata->'snapshot' into old_snapshot from public.entity_external_ids
    where source='ppl_live' and entity_type='match' and external_id=provider_id;
  if old_snapshot is not null and (old_snapshot->>'revision')::timestamptz >= rev then
    return jsonb_build_object('applied',false,'reason',case when old_snapshot=p_snapshot then 'unchanged' else 'stale_snapshot' end);
  end if;
  if m.status::text not in ('scheduled','live','on_court','finished') or
     (m.status::text='finished' and p_snapshot->>'status'<>'finished') then
    return jsonb_build_object('applied',false,'reason','terminal');
  end if;
  if jsonb_array_length(p_snapshot->'sets') not between 1 and 3 or
     (p_snapshot->>'status'='finished' and (coalesce((p_snapshot->>'winner')::int,0) not in (1,2) or p_snapshot->>'finishedAt' is null))
     then raise exception 'Invalid PPL final score'; end if;
  -- Validate all four profile links before any writes. No fuzzy matching in SQL.
  for idx in 1..4 loop
    participant := p_snapshot->'players'->(idx-1);
    if not exists(select 1 from public.players where id=p_players[idx] and category=p_snapshot->>'category')
       then raise exception 'PPL player category conflict'; end if;
    insert into public.entity_external_ids(entity_type,entity_id,source,external_id,metadata)
      values('player',p_players[idx],'ppl',participant->>'slug',
        jsonb_build_object('name',participant->>'name','category',participant->>'category'))
      on conflict(source,entity_type,external_id) do nothing;
    if not exists(select 1 from public.entity_external_ids where entity_type='player' and source='ppl'
      and external_id=participant->>'slug' and entity_id=p_players[idx]) then raise exception 'PPL player mapping conflict'; end if;
  end loop;
  update public.matches set pair1_player1_id=p_players[1],pair1_player2_id=p_players[2],
    pair2_player1_id=p_players[3],pair2_player2_id=p_players[4],
    started_at=coalesce(started_at,(p_snapshot->>'startedAt')::timestamptz),updated_at=now()
    where id=p_match;
  update public.sets set is_current=false where match_id=p_match;
  update public.games set is_current=false where match_id=p_match;
  for item in select * from jsonb_array_elements(p_snapshot->'sets') loop
    insert into public.sets(match_id,set_number,pair1_games,pair2_games,set_score,is_current,score_source,updated_at)
    values(p_match,(item->>'number')::int,(item->>'a')::int,(item->>'b')::int,
      case when (item->>'current')::boolean then null else (item->>'a')||'-'||(item->>'b') end,
      (item->>'current')::boolean,'api',now())
    on conflict(match_id,set_number) do update set pair1_games=excluded.pair1_games,pair2_games=excluded.pair2_games,
      set_score=excluded.set_score,is_current=excluded.is_current,score_source=excluded.score_source,updated_at=now();
  end loop;
  if exists(select 1 from public.sets where match_id=p_match and set_number>jsonb_array_length(p_snapshot->'sets'))
     then raise exception 'PPL regressed set count requires reconciliation'; end if;
  item := p_snapshot->'game';
  if item is not null and item <> 'null'::jsonb then
    select id into strict set_uuid from public.sets where match_id=p_match and set_number=(item->>'set')::int;
    insert into public.games(match_id,set_id,game_number,game_score,is_current,is_tiebreak,serving_pair,updated_at)
    values(p_match,set_uuid,(item->>'number')::int,item->>'score',true,(item->>'tiebreak')::boolean,(item->>'servingPair')::int,now())
    on conflict(set_id,game_number) do update set game_score=excluded.game_score,is_current=true,
      is_tiebreak=excluded.is_tiebreak,serving_pair=excluded.serving_pair,updated_at=now();
  end if;
  if p_snapshot->>'status'='finished' then
    update public.matches set status='finished',winner_pair=(p_snapshot->>'winner')::int,
      finished_at=(p_snapshot->>'finishedAt')::timestamptz,updated_at=now() where id=p_match;
    -- Derived franchise/participation records only; official ranking POINTS
    -- remain the responsibility of the separate published standings importer.
    -- Stable lock order serializes two courts finishing for the same teams.
    for sid in select x from unnest(array[t.home_team_season_id,t.away_team_season_id]) x order by x loop
      perform 1 from public.team_seasons where id=sid for update;
      with courts as (
        select lt.id, count(*) filter(where mm.winner_pair=case when lt.home_team_season_id=sid then 1 else 2 end) w,
          count(*) filter(where mm.winner_pair<>case when lt.home_team_season_id=sid then 1 else 2 end) l
        from public.league_ties lt join public.matches mm on mm.tie_id=lt.id
        where (lt.home_team_season_id=sid or lt.away_team_season_id=sid) and mm.status='finished' and mm.winner_pair in (1,2)
        group by lt.id
      ) update public.team_seasons set ties_played=(select count(*) from courts),
        ties_won=(select count(*) from courts where w>l),courts_won=coalesce((select sum(w) from courts),0),
        courts_lost=coalesce((select sum(l) from courts),0) where id=sid;
      insert into public.team_memberships(team_season_id,player_id,games_played,wins,losses)
      select sid,p.player_id,count(*),count(*) filter(where mm.winner_pair=case when lt.home_team_season_id=sid then 1 else 2 end),
        count(*) filter(where mm.winner_pair<>case when lt.home_team_season_id=sid then 1 else 2 end)
      from public.league_ties lt join public.matches mm on mm.tie_id=lt.id
      cross join lateral unnest(case when lt.home_team_season_id=sid then array[mm.pair1_player1_id,mm.pair1_player2_id]
        else array[mm.pair2_player1_id,mm.pair2_player2_id] end) p(player_id)
      where (lt.home_team_season_id=sid or lt.away_team_season_id=sid) and mm.status='finished' and mm.winner_pair in (1,2) and p.player_id is not null
      group by p.player_id on conflict(team_season_id,player_id) do update
        set games_played=excluded.games_played,wins=excluded.wins,losses=excluded.losses;
    end loop;
  else
    update public.matches set status='live',updated_at=now() where id=p_match;
  end if;
  insert into public.entity_external_ids(entity_type,entity_id,source,external_id,metadata)
    values('match',p_match,'ppl',provider_id,jsonb_build_object('tournament',p_snapshot->>'tournamentSlug'))
    on conflict(source,entity_type,external_id) do nothing;
  insert into public.entity_external_ids(entity_type,entity_id,source,external_id,metadata)
    values('match',p_match,'ppl_live',provider_id,jsonb_build_object('snapshot',p_snapshot))
    on conflict(source,entity_type,external_id) do update set metadata=excluded.metadata,last_seen_at=now();
  return jsonb_build_object('applied',true);
end $$;
revoke all on function public.apply_ppl_snapshot(uuid,uuid,text,uuid[],uuid[],jsonb) from public,anon,authenticated;
grant execute on function public.apply_ppl_snapshot(uuid,uuid,text,uuid[],uuid[],jsonb) to service_role;
