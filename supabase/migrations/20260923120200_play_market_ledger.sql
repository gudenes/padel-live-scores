-- Play prediction market — ledger, balance cache, audit log, RLS.

CREATE TABLE guaca_ledger (
  id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id    uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  season_id  uuid NOT NULL REFERENCES market_seasons(id),
  kind       text NOT NULL CHECK (kind IN (
               'signup_grant','daily_stipend','referral','achievement',
               'trade_buy','trade_sell','settlement','refund',
               'cosmetic','market_fee','season_reset')),
  amount     integer NOT NULL,
  market_id  uuid REFERENCES markets(id) ON DELETE SET NULL,
  trade_id   bigint REFERENCES market_trades(id) ON DELETE SET NULL,
  memo       text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX guaca_ledger_user_season_idx ON guaca_ledger (user_id, season_id);
CREATE INDEX guaca_ledger_kind_idx ON guaca_ledger (kind, created_at DESC);

CREATE TABLE user_guaca_balance (
  user_id    uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  season_id  uuid NOT NULL REFERENCES market_seasons(id),
  balance    integer NOT NULL DEFAULT 0 CHECK (balance >= 0),
  locked     integer NOT NULL DEFAULT 0 CHECK (locked >= 0),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, season_id)
);

CREATE TABLE market_audit_log (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  market_id   uuid REFERENCES markets(id) ON DELETE SET NULL,
  template_id uuid REFERENCES market_templates(id) ON DELETE SET NULL,
  actor       text NOT NULL,
  action      text NOT NULL,
  -- NOT NULL by design: an override without a stated reason is exactly the
  -- thing we will want in six months and not have.
  reason      text NOT NULL,
  before      jsonb,
  after       jsonb,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX market_audit_log_market_idx ON market_audit_log (market_id, created_at DESC);

-- ── RLS ────────────────────────────────────────────────────────────────
-- Browser reads open markets; everything else is own-rows-only or
-- service-role-only. All writes go through service-role API routes.

ALTER TABLE markets              ENABLE ROW LEVEL SECURITY;
ALTER TABLE market_trades        ENABLE ROW LEVEL SECURITY;
ALTER TABLE market_positions     ENABLE ROW LEVEL SECURITY;
ALTER TABLE guaca_ledger         ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_guaca_balance   ENABLE ROW LEVEL SECURITY;
ALTER TABLE market_templates     ENABLE ROW LEVEL SECURITY;
ALTER TABLE market_limits        ENABLE ROW LEVEL SECURITY;
ALTER TABLE market_seasons       ENABLE ROW LEVEL SECURITY;
ALTER TABLE market_audit_log     ENABLE ROW LEVEL SECURITY;

CREATE POLICY markets_public_read ON markets
  FOR SELECT TO anon, authenticated USING (true);

CREATE POLICY seasons_public_read ON market_seasons
  FOR SELECT TO anon, authenticated USING (true);

CREATE POLICY trades_own_read ON market_trades
  FOR SELECT TO authenticated USING (user_id = auth.uid());

CREATE POLICY positions_own_read ON market_positions
  FOR SELECT TO authenticated USING (user_id = auth.uid());

CREATE POLICY ledger_own_read ON guaca_ledger
  FOR SELECT TO authenticated USING (user_id = auth.uid());

CREATE POLICY balance_own_read ON user_guaca_balance
  FOR SELECT TO authenticated USING (user_id = auth.uid());

-- market_templates, market_limits and market_audit_log get NO policies:
-- RLS enabled with zero policies denies anon/authenticated entirely, while
-- the service role bypasses RLS. That is the intended access shape.
