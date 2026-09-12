-- 20260912180000_player_claims.sql
-- Vínculo entre uma conta logada e um registro de jogador ("meu perfil de
-- jogador"). O pedido entra em player_claims e é aprovado no admin; a
-- aprovação grava profiles.player_id.
--
-- Acesso: só por rotas de API com a service key. RLS habilitada sem policy
-- anon = deny-by-default no browser, igual a player_suggestions.

create table if not exists public.player_claims (
  id           uuid primary key default gen_random_uuid(),
  player_id    uuid not null references public.players(id) on delete cascade,
  player_name  text,
  user_id      uuid not null,
  user_email   text,
  note         text,
  status       text not null default 'pending'
    check (status in ('pending', 'approved', 'rejected')),
  reviewed_by  text,
  reviewed_at  timestamptz,
  review_note  text,
  created_at   timestamptz not null default now()
);

create index if not exists player_claims_pending_idx
  on public.player_claims (created_at desc) where status = 'pending';

-- Um pedido pendente por conta e jogador. Sem isto, tocar duas vezes no botão
-- gera duas linhas idênticas na fila do operador.
create unique index if not exists player_claims_pending_uk
  on public.player_claims (user_id, player_id) where status = 'pending';

alter table public.player_claims enable row level security;

comment on table public.player_claims is
  'Pedidos de vínculo conta→jogador, revisados na aba Claims do admin.';

alter table public.profiles
  add column if not exists player_id uuid references public.players(id) on delete set null;

-- A restrição que mais importa: um jogador pertence a no máximo uma conta.
-- Sem ela, dois pedidos aprovados por distração deixam duas contas donas do
-- mesmo jogador e nada no sistema reclama.
create unique index if not exists profiles_player_id_uk
  on public.profiles (player_id) where player_id is not null;

comment on column public.profiles.player_id is
  'Jogador vinculado a esta conta, aprovado via player_claims. NULL = conta sem perfil de jogador.';
