-- One-time static data repair. The renderer supplies pg_temp.ppl_repair_payload.
-- No persistent functions, live tables, provider mappings, triggers or jobs.
do $repair$
declare
  payload jsonb; e jsonb; f jsonb; result jsonb; s jsonb;
  tournament_id_ uuid; tie_id_ uuid; match_id_ uuid;
  home_id uuid; away_id uuid; sid uuid; ids uuid[]; old_ids uuid[];
  tie_key_ text; n int; match_status text; existing_winner int;
begin
  select body into strict payload from pg_temp.ppl_repair_payload;
  perform pg_advisory_xact_lock(hashtext('ppl-static-repair-2026-11-18'));
  if jsonb_array_length(payload->'events')<>2 or jsonb_array_length(payload->'finals')<>28 then
    raise exception 'Unexpected repair scope';
  end if;
  for e in select value from jsonb_array_elements(payload->'events') loop
    if e->'event'->>'slug' not in ('playa-del-carmen','mgm-pro-padel-league-las-vegas-2026')
      or e->'event'->>'league'<>'ppl' then raise exception 'Unexpected event'; end if;
    select id into tournament_id_ from public.tournaments where external_id=e->'event'->>'slug';
    if found then
      if not exists(select 1 from public.tournaments where id=tournament_id_ and source='ppl' and level='ppl') then
        raise exception 'Event identity conflict';
      end if;
      update public.tournaments set name=e->'event'->>'name', starts_at=(e->'event'->>'startsAt')::timestamptz,
        ends_at=(e->'event'->>'endsAt')::timestamptz where id=tournament_id_;
    else
      insert into public.tournaments(name,source,external_id,level,starts_at,ends_at,location,country,last_updated_by)
        values(e->'event'->>'name','ppl',e->'event'->>'slug','ppl',
          (e->'event'->>'startsAt')::timestamptz,(e->'event'->>'endsAt')::timestamptz,
          'Las Vegas','US','manual') returning id into tournament_id_;
    end if;
    -- Official Las Vegas event hero, bundled with this web release.
    if e->'event'->>'slug'='mgm-pro-padel-league-las-vegas-2026' then
      update public.tournaments set cover_image_url='/images/tournaments/ppl-las-vegas-2026.jpg'
        where id=tournament_id_;
    end if;
    for f in select value from jsonb_array_elements(e->'fixtures') loop
      select ts.id into strict home_id from public.team_seasons ts join public.teams t on t.id=ts.team_id
        where t.source='ppl' and t.external_id=f->>'home' and ts.league='ppl' and ts.season_year=2026;
      select ts.id into strict away_id from public.team_seasons ts join public.teams t on t.id=ts.team_id
        where t.source='ppl' and t.external_id=f->>'away' and ts.league='ppl' and ts.season_year=2026;
      if home_id=away_id or f->>'category' not in ('men','women') then raise exception 'Invalid fixture'; end if;
      tie_key_ := (f->>'stage')||'|'||coalesce(f->>'session','')||'|'||(f->>'home')||'|'||(f->>'away');
      -- Reuse the semantic tie, including older empty-vs-null tie-key formats.
      select count(*), min(id::text)::uuid into n,tie_id_ from public.league_ties
        where tournament_id=tournament_id_ and home_team_season_id=home_id and away_team_season_id=away_id
          and stage=f->>'stage' and session_number is not distinct from (f->>'session')::int;
      if n>1 then raise exception 'Ambiguous tie'; end if;
      if n=0 then
        insert into public.league_ties(tournament_id,tie_key,home_team_season_id,away_team_season_id,stage,session_number,scheduled_at)
          values(tournament_id_,tie_key_,home_id,away_id,f->>'stage',(f->>'session')::int,(f->>'scheduledAt')::timestamptz)
          returning id into tie_id_;
      end if;
      select count(*),min(id::text)::uuid into n,match_id_ from public.matches where tie_id=tie_id_ and category=f->>'category';
      if n>1 then raise exception 'Ambiguous match'; end if;
      if n=0 then
        insert into public.matches(tournament_id,tie_id,category,round,status,scheduled_at)
          values(tournament_id_,tie_id_,f->>'category',f->>'stage','scheduled',(f->>'scheduledAt')::timestamptz)
          returning id into match_id_;
      end if;
      select status::text,winner_pair,array[pair1_player1_id,pair1_player2_id,pair2_player1_id,pair2_player2_id]
        into match_status,existing_winner,old_ids from public.matches where id=match_id_ for update;
      if not exists(select 1 from public.matches where id=match_id_ and tournament_id=tournament_id_) then
        raise exception 'Match tournament conflict';
      end if;
      select value into result from jsonb_array_elements(payload->'finals')
        where value->>'providerId'=f->>'id';
      if result is null then
        -- Never regress a fixture that started after this capture.
        if match_status='scheduled' and existing_winner is null then
          update public.matches set scheduled_at=(f->>'scheduledAt')::timestamptz where id=match_id_;
        end if;
        continue;
      end if;
      if result->>'status'<>'finished' or result->>'tournamentSlug'<>e->'event'->>'slug'
        or result->>'category'<>f->>'category' or result->>'homeTeam'<>f->>'home' or result->>'awayTeam'<>f->>'away'
        or (result->>'winner')::int not in (1,2) or result->>'finishedAt' is null then raise exception 'Invalid final'; end if;
      if result->>'existingMatchId' is not null and (result->>'existingMatchId')::uuid<>match_id_ then
        raise exception 'Existing match identity changed';
      end if;
      if match_status not in ('scheduled','finished') or
        (existing_winner is not null and existing_winner<>(result->>'winner')::int) then raise exception 'Result conflict'; end if;
      select array_agg(value::uuid order by ordinal) into ids from jsonb_array_elements_text(result->'playerIds') with ordinality p(value,ordinal);
      if cardinality(ids)<>4 or (select count(distinct x) from unnest(ids) x)<>4
        or (select count(*) from public.players where id=any(ids) and category=f->>'category')<>4 then
        raise exception 'Player identity conflict';
      end if;
      if exists(select 1 from unnest(old_ids[1:2]) x where x is not null and not(x=any(ids[1:2])))
        or exists(select 1 from unnest(old_ids[3:4]) x where x is not null and not(x=any(ids[3:4]))) then
        raise exception 'Existing lineup conflict';
      end if;
      update public.matches set status='finished',winner_pair=(result->>'winner')::int,
        scheduled_at=(f->>'scheduledAt')::timestamptz,started_at=(result->>'startedAt')::timestamptz,
        finished_at=(result->>'finishedAt')::timestamptz,
        pair1_player1_id=ids[1],pair1_player2_id=ids[2],pair2_player1_id=ids[3],pair2_player2_id=ids[4]
        where id=match_id_;
      if exists(select 1 from public.sets where match_id=match_id_ and set_number>jsonb_array_length(result->'sets')) then
        raise exception 'Unexpected existing sets';
      end if;
      for s in select value from jsonb_array_elements(result->'sets') loop
        insert into public.sets(match_id,set_number,pair1_games,pair2_games,set_score,is_current,score_source)
          values(match_id_,(s->>'number')::int,(s->>'a')::int,(s->>'b')::int,(s->>'a')||'-'||(s->>'b'),false,'api')
          on conflict(match_id,set_number) do update set pair1_games=excluded.pair1_games,pair2_games=excluded.pair2_games,
            set_score=excluded.set_score,is_current=false,score_source=excluded.score_source;
      end loop;
    end loop;
    -- Earliest court in the tie; never let the second gender overwrite it.
    update public.league_ties lt set scheduled_at=(select min(scheduled_at) from public.matches where tie_id=lt.id)
      where lt.tournament_id=tournament_id_;
  end loop;
  -- Recompute participation across the affected PPL season. Official ranking
  -- points remain untouched: they are not derived from won/lost courts.
  for sid in select ts.id from public.team_seasons ts join public.teams t on t.id=ts.team_id
    where t.source='ppl' and ts.league='ppl' and ts.season_year=2026 order by ts.id loop
    with courts as (
      select lt.id, count(*) filter(where m.winner_pair=case when lt.home_team_season_id=sid then 1 else 2 end) w,
        count(*) filter(where m.winner_pair<>case when lt.home_team_season_id=sid then 1 else 2 end) l
      from public.league_ties lt join public.matches m on m.tie_id=lt.id
      where (lt.home_team_season_id=sid or lt.away_team_season_id=sid) and m.status='finished' and m.winner_pair in (1,2) group by lt.id
    ) update public.team_seasons set ties_played=(select count(*) from courts),ties_won=(select count(*) from courts where w>l),
      courts_won=coalesce((select sum(w) from courts),0),courts_lost=coalesce((select sum(l) from courts),0) where id=sid;
    update public.team_memberships set games_played=0,wins=0,losses=0 where team_season_id=sid;
    insert into public.team_memberships(team_season_id,player_id,games_played,wins,losses)
    select sid,p.id,count(*),count(*) filter(where m.winner_pair=case when lt.home_team_season_id=sid then 1 else 2 end),
      count(*) filter(where m.winner_pair<>case when lt.home_team_season_id=sid then 1 else 2 end)
    from public.league_ties lt join public.matches m on m.tie_id=lt.id
    cross join lateral unnest(case when lt.home_team_season_id=sid then array[m.pair1_player1_id,m.pair1_player2_id]
      else array[m.pair2_player1_id,m.pair2_player2_id] end) p(id)
    where (lt.home_team_season_id=sid or lt.away_team_season_id=sid) and m.status='finished' and m.winner_pair in (1,2) and p.id is not null
    group by p.id on conflict(team_season_id,player_id) do update set games_played=excluded.games_played,wins=excluded.wins,losses=excluded.losses;
  end loop;
end $repair$;
