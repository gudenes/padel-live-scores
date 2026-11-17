-- CourtBit only identifies the serving pair; never invent a server_player_id.
alter table public.games add column if not exists serving_pair integer check (serving_pair in (1, 2));

-- Snapshot + optional observed point + last accepted state commit together.
-- Locking matches also serializes against the official results writer.
create or replace function public.apply_courtbit_snapshot(
  p_tournament uuid, p_match uuid, p_provider_id text, p_players uuid[],
  p_previous jsonb, p_snapshot jsonb, p_links jsonb, p_names text[],
  p_observed_at timestamptz, p_point_winner integer default null
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  m public.matches%rowtype;
  cached public.entity_external_ids%rowtype;
  item jsonb;
  link jsonb;
  set_uuid uuid;
  game_uuid uuid;
  point_num integer;
  ext text := p_tournament::text || ':' || p_provider_id;
  player_source text := 'courtbit_player:' || p_tournament::text;
  should_notify boolean := false;
  next_players uuid[];
  next_names text[];
  next_countries text[];
begin
  if cardinality(p_players) is distinct from 4 or cardinality(p_names) is distinct from 4
     or jsonb_typeof(p_snapshot->'participants') is distinct from 'array'
     or jsonb_array_length(p_snapshot->'participants') <> 4
     or coalesce(p_snapshot->>'status', '') not in ('live','done')
     or jsonb_typeof(p_snapshot->'sets') is distinct from 'array'
     or jsonb_array_length(p_snapshot->'sets') > 3
     or jsonb_typeof(p_links) is distinct from 'array' or jsonb_array_length(p_links) > 4
     or p_observed_at is null or p_provider_id is null or p_provider_id = ''
     or (p_point_winner is not null and p_point_winner not in (1,2)) then
    raise exception 'Invalid CourtBit snapshot';
  end if;
  select array_agg((p->>'playerId')::uuid order by ord), array_agg(p->>'name' order by ord),
         array_agg(p->>'country' order by ord)
    into next_players, next_names, next_countries
    from jsonb_array_elements(p_snapshot->'participants') with ordinality as x(p,ord);
  if (select count(distinct x) from unnest(next_players) x) <> (select count(x) from unnest(next_players) x)
     or exists(select 1 from unnest(next_names) n where n is null or trim(n)='') then
    raise exception 'Invalid CourtBit participants';
  end if;
  select * into m from public.matches where id = p_match and tournament_id = p_tournament for update;
  if not found then return jsonb_build_object('applied', false, 'reason', 'match_missing'); end if;
  if m.status::text not in ('scheduled','on_court','live') then
    return jsonb_build_object('applied', false, 'reason', 'terminal');
  end if;
  if array[m.pair1_player1_id,m.pair1_player2_id,m.pair2_player1_id,m.pair2_player2_id] is distinct from p_players then
    return jsonb_build_object('applied', false, 'reason', 'players_changed');
  end if;
  if array[m.pair1_player1_name,m.pair1_player2_name,m.pair2_player1_name,m.pair2_player2_name] is distinct from p_names then
    return jsonb_build_object('applied', false, 'reason', 'players_changed');
  end if;
  if exists(select 1 from jsonb_array_elements(p_snapshot->'participants') p where p->>'category' is distinct from m.category::text)
     or exists(select 1 from jsonb_array_elements(p_snapshot->'participants') p
        where p->>'playerId' is not null and not exists(select 1 from jsonb_array_elements(p_links) l where l=p))
     or exists(select 1 from jsonb_array_elements(p_links) l
        where l->>'playerId' is null or not exists(select 1 from jsonb_array_elements(p_snapshot->'participants') p where p=l)) then
    raise exception 'CourtBit participant mapping mismatch';
  end if;
  select * into cached from public.entity_external_ids
    where source = 'courtbit' and entity_type = 'match' and external_id = ext for update;
  if found and cached.entity_id <> p_match then
    return jsonb_build_object('applied', false, 'reason', 'provider_id_reused');
  end if;
  if coalesce(cached.metadata->'snapshot','null'::jsonb) is distinct from coalesce(p_previous,'null'::jsonb) then
    return jsonb_build_object('applied', false, 'reason', 'state_changed');
  end if;
  if cached.metadata->'snapshot' = p_snapshot and p_players is not distinct from next_players
     and p_names is not distinct from next_names then
    return jsonb_build_object('applied', false, 'reason', 'unchanged');
  end if;
  if cached.metadata->'snapshot'->>'status' = 'done' and p_snapshot->>'status' = 'live' then
    return jsonb_build_object('applied', false, 'reason', 'provider_completed');
  end if;
  if jsonb_array_length(coalesce(cached.metadata->'snapshot'->'sets','[]'::jsonb)) > 0
     and jsonb_array_length(p_snapshot->'sets') = 0 and p_snapshot->>'status' = 'live' then
    return jsonb_build_object('applied', false, 'reason', 'scores_unpublished');
  end if;
  if cached.metadata->>'observedAt' is not null and p_observed_at < (cached.metadata->>'observedAt')::timestamptz then
    return jsonb_build_object('applied', false, 'reason', 'stale_snapshot');
  end if;
  -- Official results remain authoritative, including their player links.
  if exists (select 1 from public.sets where match_id=p_match and score_source='api') then
    return jsonb_build_object('applied', false, 'reason', 'official_scores');
  end if;
  -- Only resolved identities get persistent provider/player mappings.
  -- Unresolved slots retain their raw names with null player FKs.
  for link in select * from jsonb_array_elements(p_links) loop
    if not ((link->>'playerId')::uuid = any(next_players)) or coalesce(link->>'slug','') = '' then
      raise exception 'CourtBit player mapping outside match';
    end if;
    insert into public.entity_external_ids(entity_type,entity_id,source,external_id,metadata)
    values ('player',(link->>'playerId')::uuid,player_source,link->>'slug',
      jsonb_build_object('name',link->>'name','country',link->>'country','category',link->>'category'))
    on conflict (source,entity_type,external_id) do nothing;
    if not exists (select 1 from public.entity_external_ids where source=player_source
      and entity_type='player' and external_id=link->>'slug' and entity_id=(link->>'playerId')::uuid
      and metadata->>'name'=link->>'name' and metadata->>'country'=link->>'country'
      and metadata->>'category'=link->>'category') then
      raise exception 'CourtBit player mapping conflict';
    end if;
  end loop;

  -- The compare-and-swap above protects all four old IDs and raw names.
  -- Clear an uncertain old link instead of notifying that profile's followers.
  -- Original links are retained in the audit metadata below for reconciliation.
  update public.matches set
    pair1_player1_id=next_players[1], pair1_player2_id=next_players[2],
    pair2_player1_id=next_players[3], pair2_player2_id=next_players[4],
    pair1_player1_name=next_names[1], pair1_player2_name=next_names[2],
    pair2_player1_name=next_names[3], pair2_player2_name=next_names[4],
    pair1_player1_country=next_countries[1], pair1_player2_country=next_countries[2],
    pair2_player1_country=next_countries[3], pair2_player2_country=next_countries[4]
  where id=p_match;
  if jsonb_array_length(p_snapshot->'sets') > 0 or p_snapshot->>'status'='done' then
    update public.sets set is_current=false where match_id=p_match;
    update public.games set is_current=false where match_id=p_match;
  end if;
  for item in select * from jsonb_array_elements(p_snapshot->'sets') loop
    insert into public.sets(match_id,set_number,pair1_games,pair2_games,set_score,is_current,score_source,updated_at)
    values (p_match,(item->>'number')::integer,(item->>'a')::integer,(item->>'b')::integer,
      item->>'score',coalesce((item->>'current')::boolean,false),'live',now())
    on conflict (match_id,set_number) do update set
      pair1_games=excluded.pair1_games,pair2_games=excluded.pair2_games,set_score=excluded.set_score,
      is_current=excluded.is_current,score_source='live',updated_at=now();
  end loop;
  -- Reject a regressed set count instead of leaving phantom future sets on UI.
  if exists(select 1 from public.sets where match_id=p_match and set_number > jsonb_array_length(p_snapshot->'sets'))
     and jsonb_array_length(p_snapshot->'sets') > 0 then
    raise exception 'CourtBit set count regressed; reconcile correction';
  end if;
  if p_snapshot->'game' is distinct from 'null'::jsonb and p_snapshot->'game' is not null then
    item := p_snapshot->'game';
    select id into strict set_uuid from public.sets where match_id=p_match and set_number=(item->>'set')::integer;
    insert into public.games(match_id,set_id,game_number,game_score,is_current,is_tiebreak,serving_pair,server_player_id,points,updated_at)
    values (p_match,set_uuid,(item->>'number')::integer,item->>'score',true,(item->>'tiebreak')::boolean,
      (item->>'servingPair')::integer,null,null,now())
    on conflict (set_id,game_number) do update set game_score=excluded.game_score,is_current=true,
      is_tiebreak=excluded.is_tiebreak,serving_pair=excluded.serving_pair,server_player_id=null,points=null,updated_at=now()
    returning id into game_uuid;
    -- Never log an initial snapshot as a point. CAS + row lock + one
    -- transaction make retries idempotent, including a crash after commit.
    if p_point_winner is not null and p_previous->'game'->>'set'=item->>'set'
       and p_previous->'game'->>'number'=item->>'number'
       and p_previous->'sets'=p_snapshot->'sets'
       and p_previous->'providerPlayers'=p_snapshot->'providerPlayers'
       and p_previous->>'orientation'=p_snapshot->>'orientation'
       and p_previous->'game'->>'score' is distinct from item->>'score' then
      select coalesce(max(point_number),0)+1 into point_num from public.match_points where game_id=game_uuid;
      insert into public.match_points(match_id,set_id,game_id,point_number,winner_pair,score_after,source)
      values (p_match,set_uuid,game_uuid,point_num,p_point_winner,item->>'score','padelgod');
    end if;
  end if;
  if p_snapshot->>'status'='live' then
    should_notify := m.status::text='scheduled';
    update public.matches set status='live',updated_at=now() where id=p_match;
  else
    -- CourtBit final snapshot is retained; FIP owns terminal status/winner
    -- and the existing elimination/title notification path.
    update public.matches set updated_at=now() where id=p_match;
  end if;
  insert into public.entity_external_ids(entity_type,entity_id,source,external_id,metadata)
  values ('match',p_match,'courtbit',ext,jsonb_build_object('snapshot',p_snapshot,'observedAt',p_observed_at,
    'identityBefore',coalesce(cached.metadata->'identityBefore',jsonb_build_object('ids',p_players,'names',p_names))))
  on conflict (source,entity_type,external_id) do update set metadata=excluded.metadata,last_seen_at=now();
  return jsonb_build_object('applied',true,'notify',should_notify);
end $$;
revoke all on function public.apply_courtbit_snapshot(uuid,uuid,text,uuid[],jsonb,jsonb,jsonb,text[],timestamptz,integer) from public,anon,authenticated;
grant execute on function public.apply_courtbit_snapshot(uuid,uuid,text,uuid[],jsonb,jsonb,jsonb,text[],timestamptz,integer) to service_role;
