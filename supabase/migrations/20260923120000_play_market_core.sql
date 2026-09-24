-- Play prediction market — core configuration tables.
-- Spec: docs/superpowers/specs/2026-09-23-prediction-market-design.md

CREATE TABLE market_seasons (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name          text        NOT NULL,
  starts_at     timestamptz NOT NULL,
  ends_at       timestamptz NOT NULL,
  reset_balance integer     NOT NULL DEFAULT 10000,
  status        text        NOT NULL DEFAULT 'upcoming'
                CHECK (status IN ('upcoming','active','archived')),
  created_at    timestamptz NOT NULL DEFAULT now()
);

-- Exactly one active season, enforced by the database rather than by code.
CREATE UNIQUE INDEX market_seasons_one_active ON market_seasons (status)
  WHERE status = 'active';

CREATE TABLE market_templates (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  key             text UNIQUE NOT NULL,
  question_i18n   jsonb       NOT NULL,
  horizon         text        NOT NULL
                  CHECK (horizon IN ('pre-match','tournament','season','roster')),
  trigger         text        NOT NULL,
  lock_rule       text        NOT NULL
                  CHECK (lock_rule IN ('match_start','round_first_ball','final_start')),
  resolver_key    text        NOT NULL,
  seed_source     text        NOT NULL
                  CHECK (seed_source IN ('elo','projection','inplay','fip_rank','fixed')),
  max_loss_guacas integer     NOT NULL DEFAULT 5000 CHECK (max_loss_guacas > 0),
  params          jsonb       NOT NULL DEFAULT '{}',
  gates           jsonb       NOT NULL DEFAULT '{}',
  enabled         boolean     NOT NULL DEFAULT false,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

-- Single-row table. The boolean PK forces exactly one row: a second INSERT
-- collides on the primary key, so no code path can create competing limits.
CREATE TABLE market_limits (
  id                     boolean PRIMARY KEY DEFAULT true CHECK (id),
  max_open_markets       integer NOT NULL DEFAULT 15,
  max_new_per_day        integer NOT NULL DEFAULT 20,
  max_per_match          integer NOT NULL DEFAULT 3,
  max_per_tournament_day integer NOT NULL DEFAULT 8,
  max_subsidy_per_day    integer NOT NULL DEFAULT 250000,
  max_stake_user_market  integer NOT NULL DEFAULT 2000,
  updated_at             timestamptz NOT NULL DEFAULT now(),
  updated_by             text
);

INSERT INTO market_limits DEFAULT VALUES;
