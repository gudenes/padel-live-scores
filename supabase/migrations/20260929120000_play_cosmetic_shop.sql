-- Account-owned cosmetics; wallet debit and entitlement commit in one transaction.
CREATE TABLE IF NOT EXISTS play_shop_catalog (
 id text PRIMARY KEY, slot text NOT NULL CHECK(slot IN ('racket','shoes','shorts','shirt','wrist','hat','sticker')),
 price integer NOT NULL CHECK(price>=0), wins integer NOT NULL CHECK(wins>=0)
);
CREATE TABLE IF NOT EXISTS play_wardrobes (
 user_id uuid PRIMARY KEY REFERENCES profiles(id) ON DELETE CASCADE,
 avatar text NOT NULL DEFAULT 'face-06', equipped jsonb NOT NULL DEFAULT '{}', updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS play_cosmetic_purchases (
 user_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
 item_id text NOT NULL REFERENCES play_shop_catalog(id), season_id uuid NOT NULL REFERENCES market_seasons(id),
 price integer NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(user_id,item_id)
);
ALTER TABLE play_shop_catalog ENABLE ROW LEVEL SECURITY;
ALTER TABLE play_wardrobes ENABLE ROW LEVEL SECURITY;
ALTER TABLE play_cosmetic_purchases ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON play_shop_catalog,play_wardrobes,play_cosmetic_purchases FROM anon,authenticated;
GRANT ALL ON play_shop_catalog,play_wardrobes,play_cosmetic_purchases TO service_role;
INSERT INTO play_shop_catalog(id,slot,price,wins) VALUES
('racket-starter','racket',0,0),
('racket-club','racket',350,0),
('racket-cobalt','racket',500,0),
('racket-sunset','racket',650,10),
('racket-champion','racket',800,25),
('shoes-starter','shoes',0,0),
('shoes-club','shoes',350,0),
('shoes-cobalt','shoes',500,0),
('shoes-sunset','shoes',650,10),
('shoes-champion','shoes',800,25),
('shorts-starter','shorts',0,0),
('shorts-club','shorts',350,0),
('shorts-cobalt','shorts',500,0),
('shorts-sunset','shorts',650,10),
('shorts-champion','shorts',800,25),
('shirt-starter','shirt',0,0),
('shirt-club','shirt',350,0),
('shirt-cobalt','shirt',500,0),
('shirt-sunset','shirt',650,10),
('shirt-champion','shirt',800,25),
('wrist-starter','wrist',0,0),
('wrist-club','wrist',350,0),
('wrist-cobalt','wrist',500,0),
('wrist-sunset','wrist',650,10),
('wrist-champion','wrist',800,25),
('hat-starter','hat',0,0),
('hat-club','hat',350,0),
('hat-cobalt','hat',500,0),
('hat-sunset','hat',650,10),
('hat-champion','hat',800,25),
('sticker-king','sticker',800,25),
('sticker-dejadas','sticker',650,10),
('hat-backwards','hat',650,0),
('hat-bandana','hat',550,0)
ON CONFLICT(id) DO UPDATE SET slot=excluded.slot,price=excluded.price,wins=excluded.wins;
CREATE OR REPLACE FUNCTION play_shop_update(p_user uuid,p_season uuid,p_action text DEFAULT 'read',p_item text DEFAULT NULL,p_avatar text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_item play_shop_catalog%ROWTYPE; v_balance integer; v_wins integer; v_avatar text; v_equipped jsonb; v_owned jsonb;
BEGIN
 IF NOT EXISTS(SELECT 1 FROM play_access WHERE user_id=p_user) THEN RAISE EXCEPTION 'not_found'; END IF;
 -- Same wallet lock used by market trades and settlement.
 SELECT balance INTO v_balance FROM user_guaca_balance WHERE user_id=p_user AND season_id=p_season FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'wallet_unavailable'; END IF;
 INSERT INTO play_wardrobes(user_id) VALUES(p_user) ON CONFLICT DO NOTHING;
 SELECT avatar,equipped INTO v_avatar,v_equipped FROM play_wardrobes WHERE user_id=p_user FOR UPDATE;
 SELECT count(*) INTO v_wins FROM market_positions pos JOIN markets m ON m.id=pos.market_id
 JOIN market_payouts payout ON payout.market_id=m.id AND payout.user_id=pos.user_id
 WHERE pos.user_id=p_user AND m.status='settled' AND m.settled_at IS NOT NULL
 AND m.settlement_revision=payout.revision AND pos.cost_basis>0 AND payout.yes_paid+payout.no_paid>pos.cost_basis;
 IF p_action IN ('buy','equip') THEN
  SELECT * INTO v_item FROM play_shop_catalog WHERE id=p_item;
  IF NOT FOUND THEN RAISE EXCEPTION 'invalid_item'; END IF;
  IF v_item.price>0 AND NOT EXISTS(SELECT 1 FROM play_cosmetic_purchases WHERE user_id=p_user AND item_id=p_item) THEN
   IF p_action='equip' THEN RAISE EXCEPTION 'not_owned'; END IF;
   IF v_wins<v_item.wins THEN RAISE EXCEPTION 'performance_locked'; END IF;
   IF v_balance<v_item.price THEN RAISE EXCEPTION 'insufficient_balance'; END IF;
   UPDATE user_guaca_balance SET balance=balance-v_item.price,updated_at=now() WHERE user_id=p_user AND season_id=p_season RETURNING balance INTO v_balance;
   INSERT INTO guaca_ledger(user_id,season_id,kind,amount,memo) VALUES(p_user,p_season,'cosmetic',-v_item.price,p_item);
   INSERT INTO play_cosmetic_purchases(user_id,item_id,season_id,price) VALUES(p_user,p_item,p_season,v_item.price);
  END IF;
  v_equipped=jsonb_set(v_equipped,ARRAY[v_item.slot],to_jsonb(p_item));
 ELSIF p_action='avatar' THEN
  IF p_avatar !~ '^face-(0[1-9]|10)$' THEN
   IF p_avatar !~ '^custom:[a-f0-9-]{36}$' OR NOT EXISTS(
    SELECT 1 FROM storage.objects WHERE bucket_id='play-avatars' AND name=p_user::text||'/'||substring(p_avatar from 8)||'.png'
   ) THEN RAISE EXCEPTION 'invalid_avatar'; END IF;
  END IF;
  IF p_avatar IS NULL THEN RAISE EXCEPTION 'invalid_avatar'; END IF;
  v_avatar=p_avatar;
 ELSIF p_action='remove_sticker' THEN v_equipped=v_equipped-'sticker';
 ELSIF p_action<>'read' THEN RAISE EXCEPTION 'invalid_action';
 END IF;
 UPDATE play_wardrobes SET avatar=v_avatar,equipped=v_equipped,updated_at=now() WHERE user_id=p_user;
 SELECT coalesce(jsonb_agg(id),'[]') INTO v_owned FROM play_shop_catalog c WHERE c.price=0 OR EXISTS(SELECT 1 FROM play_cosmetic_purchases p WHERE p.user_id=p_user AND p.item_id=c.id);
 RETURN jsonb_build_object('balance',v_balance,'owned',v_owned,'equipped',v_equipped,'avatar',v_avatar,'wins',v_wins);
END $$;
REVOKE ALL ON FUNCTION play_shop_update(uuid,uuid,text,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION play_shop_update(uuid,uuid,text,text,text) TO service_role;
