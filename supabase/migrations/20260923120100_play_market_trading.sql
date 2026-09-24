-- Play prediction market — market instances and trading.

CREATE TABLE markets (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  public_id      text UNIQUE NOT NULL DEFAULT encode(gen_random_bytes(8), 'hex'),
  season_id      uuid NOT NULL REFERENCES market_seasons(id),
  template_id    uuid NOT NULL REFERENCES market_templates(id),

  match_id       uuid REFERENCES matches(id) ON DELETE CASCADE,
  tournament_id  uuid REFERENCES tournaments(id) ON DELETE CASCADE,
  category       text CHECK (category IN ('men','women')),
  tokens         jsonb NOT NULL DEFAULT '{}',

  -- Frozen at creation. Editing the template must never reach back.
  resolver_key    text          NOT NULL,
  resolver_params jsonb         NOT NULL DEFAULT '{}',
  lmsr_b          numeric(12,4) NOT NULL CHECK (lmsr_b > 0),
  seed_prob       numeric(5,4)  NOT NULL CHECK (seed_prob > 0 AND seed_prob < 1),
  seed_source     text          NOT NULL,

  q_yes          numeric(14,4) NOT NULL DEFAULT 0,
  q_no           numeric(14,4) NOT NULL DEFAULT 0,
  volume_guacas  bigint  NOT NULL DEFAULT 0,
  position_count integer NOT NULL DEFAULT 0,

  -- 'held' is a TERMINAL-until-operator state. It exists because the hold
  -- rule is otherwise unenforceable: without a persisted status, a market
  -- whose answer flapped reverts to 'proposed' and auto-settles once the
  -- answer flaps back. Verified during execution — see Task 9.
  status         text NOT NULL DEFAULT 'open'
                 CHECK (status IN ('open','locked','proposed','held','settled','void')),
  locks_at       timestamptz NOT NULL,

  proposed_outcome  boolean,
  proposed_at       timestamptz,
  proposed_evidence jsonb,
  settles_at        timestamptz,
  outcome           boolean,
  settled_at        timestamptz,
  settled_by        text,
  void_reason       text,
  hold_reason       text,

  created_at     timestamptz NOT NULL DEFAULT now(),
  CHECK ((match_id IS NULL) <> (tournament_id IS NULL))
);

CREATE INDEX markets_status_locks_idx ON markets (status, locks_at);
CREATE INDEX markets_season_status_idx ON markets (season_id, status);
CREATE INDEX markets_match_idx ON markets (match_id) WHERE match_id IS NOT NULL;

-- Idempotency guard: the generator can run repeatedly without duplicating.
CREATE UNIQUE INDEX markets_one_per_template_match
  ON markets (template_id, match_id, category) WHERE match_id IS NOT NULL;
CREATE UNIQUE INDEX markets_one_per_template_tournament
  ON markets (template_id, tournament_id, category, (tokens->>'pair_key'))
  WHERE tournament_id IS NOT NULL;

CREATE TABLE market_trades (
  id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  market_id    uuid NOT NULL REFERENCES markets(id) ON DELETE CASCADE,
  user_id      uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  side         text NOT NULL CHECK (side IN ('yes','no')),
  direction    text NOT NULL CHECK (direction IN ('buy','sell')),
  shares       numeric(14,4) NOT NULL CHECK (shares > 0),
  cost_guacas  integer NOT NULL,
  price        numeric(5,4) NOT NULL,
  q_yes_after  numeric(14,4) NOT NULL,
  q_no_after   numeric(14,4) NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX market_trades_market_idx ON market_trades (market_id, created_at DESC);
CREATE INDEX market_trades_user_idx ON market_trades (user_id, created_at DESC);

CREATE TABLE market_positions (
  market_id    uuid NOT NULL REFERENCES markets(id) ON DELETE CASCADE,
  user_id      uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  yes_shares   numeric(14,4) NOT NULL DEFAULT 0,
  no_shares    numeric(14,4) NOT NULL DEFAULT 0,
  cost_basis   integer NOT NULL DEFAULT 0,
  realised_pnl integer NOT NULL DEFAULT 0,
  updated_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (market_id, user_id)
);

CREATE INDEX market_positions_user_idx ON market_positions (user_id)
  WHERE yes_shares > 0 OR no_shares > 0;
