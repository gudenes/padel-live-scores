-- Additive derived data: original players.birthplace and updated_at are untouched.
-- All automatic matches are proposals, never verified birth countries.
create table public.birthplace_municipalities (
  id text primary key check (id ~ '^[0-9]{5}$'),
  name text not null,
  country_code text not null default 'ES' check (country_code = 'ES'),
  province_code text not null,
  region_code text not null,
  source_url text not null default 'https://www.ine.es/daco/daco42/codmun/diccionario26.xlsx',
  reference_date date not null default '2026-01-01'
);
create table public.birthplace_aliases (
  name_key text not null,
  municipality_id text not null references public.birthplace_municipalities(id),
  method text not null check (method in ('exact','alias')),
  primary key(name_key, municipality_id)
);
create table public.player_birthplaces (
  player_id uuid primary key references public.players(id) on delete cascade,
  raw_birthplace text,
  status text not null check (status in ('missing','unresolved','ambiguous','proposed','verified')),
  municipality_id text references public.birthplace_municipalities(id),
  candidate_ids text[] not null default '{}',
  reason text not null,
  normalization_version text not null default 'ine-2026-v1',
  normalized_at timestamptz not null default now(),
  verification_source text,
  verified_at timestamptz,
  check ((status in ('proposed','verified')) = (municipality_id is not null)),
  check (status <> 'verified' or (nullif(trim(verification_source),'') is not null and verified_at is not null))
);
create index player_birthplaces_status_idx on public.player_birthplaces(status);
create index player_birthplaces_municipality_idx on public.player_birthplaces(municipality_id);
create index birthplace_municipalities_region_idx on public.birthplace_municipalities(country_code,region_code);
alter table public.birthplace_municipalities enable row level security;
alter table public.birthplace_aliases enable row level security;
alter table public.player_birthplaces enable row level security;
-- Internal admin/server access only; no new public player-data exposure.
revoke all on public.birthplace_municipalities, public.birthplace_aliases, public.player_birthplaces from anon, authenticated;
grant select, insert, update, delete on public.birthplace_municipalities, public.birthplace_aliases, public.player_birthplaces to service_role;
-- MUNICIPALITY_SEED
-- ALIAS_SEED
create function public.birthplace_name_key(value text) returns text
language sql immutable strict parallel safe set search_path = pg_catalog as $$
  select trim(regexp_replace(translate(lower(regexp_replace(normalize(value, NFD), U&'[\0300-\036f]', '', 'g')), '’‘`', repeat(chr(39),3)), '[[:space:]]+', ' ', 'g'));
$$;
create function public.refresh_player_birthplace(target_id uuid, raw_value text) returns void
language plpgsql security definer set search_path = pg_catalog, public as $$
declare
  place_key text := public.birthplace_name_key(coalesce(raw_value,''));
  candidates text[] := '{}';
  result_status text;
  selected_id text;
  explanation text;
  explicit_spain boolean := false;
  match_method text;
begin
  -- Reprocessing an unchanged value must not discard a reviewed decision.
  if exists(select 1 from public.player_birthplaces where player_id=target_id and status='verified' and raw_birthplace is not distinct from raw_value) then return; end if;
  if place_key = any(array['','-','—','n/a','unknown','null','not recorded']) then
    result_status := 'missing'; explanation := 'No usable birthplace recorded. Needs source enrichment.';
  else
    explicit_spain := place_key ~ ',\s*(espana|spain|es)$';
    if explicit_spain then place_key := trim(regexp_replace(place_key, ',\s*(espana|spain|es)$', '')); end if;
    select coalesce(array_agg(municipality_id order by municipality_id), '{}'), min(method) into candidates, match_method from public.birthplace_aliases where name_key=place_key;
    if cardinality(candidates)=0 then
      result_status := 'unresolved'; explanation := 'No exact municipality or supported alias in the Spain catalogue. May be abroad, a region, a typo or a missing alias.';
    elsif cardinality(candidates)>1 then
      result_status := 'ambiguous'; explanation := 'Multiple Spanish municipalities share this name. Birth province or country evidence is needed.';
    else
      result_status := 'proposed'; selected_id := candidates[1];
      explanation := case when match_method='alias' then 'Known alias' else 'Exact normalized name' end || ' → INE ' || selected_id || '. ' ||
        case when explicit_spain then 'Spain is explicit in the recorded text.'
        when place_key=any(array['barcelona','cordoba','santiago','cuenca','guadalajara','cartagena','merida','leon','toledo','valencia','granada','madrid']) then 'International namesake exists: birth country must be verified.'
        else 'Birth country is not explicit; verify against the source.' end || ' Proposed mapping only; nationality was not used.';
    end if;
  end if;
  insert into public.player_birthplaces(player_id,raw_birthplace,status,municipality_id,candidate_ids,reason)
    values(target_id,raw_value,result_status,selected_id,candidates,explanation)
  on conflict(player_id) do update set raw_birthplace=excluded.raw_birthplace,status=excluded.status,municipality_id=excluded.municipality_id,candidate_ids=excluded.candidate_ids,reason=excluded.reason,normalization_version='ine-2026-v1',normalized_at=now(),verification_source=null,verified_at=null;
end;
$$;
create function public.sync_player_birthplace() returns trigger
language plpgsql security definer set search_path = pg_catalog, public as $$
begin
  if TG_OP='UPDATE' then
    if NEW.birthplace is not distinct from OLD.birthplace then return NEW; end if;
  end if;
  perform public.refresh_player_birthplace(NEW.id,NEW.birthplace);
  return NEW;
end;
$$;
revoke all on function public.birthplace_name_key(text), public.refresh_player_birthplace(uuid,text), public.sync_player_birthplace() from public, anon, authenticated;
grant execute on function public.birthplace_name_key(text), public.refresh_player_birthplace(uuid,text) to service_role;
create trigger trg_player_birthplace_normalization after insert or update of birthplace on public.players for each row execute function public.sync_player_birthplace();
-- SELECT invokes only the derived-row writer; no UPDATE to players or its timestamps.
select public.refresh_player_birthplace(id,birthplace) from public.players;
comment on table public.player_birthplaces is 'Derived birthplace proposals; nationality is never birth-country evidence. Only status=verified has independently reviewed evidence. Recomputed on raw birthplace changes.';
