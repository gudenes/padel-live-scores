-- supabase/migrations/20260520120100_seed_initial_operator.sql
-- Seed the first operator from the INITIAL_OPERATOR_EMAIL env var.
-- Idempotent — re-running is a no-op once the row exists.

do $$
declare
  v_email text := current_setting('app.initial_operator_email', true);
  v_user_id uuid;
begin
  -- Fallback to env var via psql -v: e.g. psql -v initial_operator_email="$INITIAL_OPERATOR_EMAIL"
  if v_email is null or v_email = '' then
    v_email := coalesce(nullif(current_setting('initial_operator_email', true), ''), null);
  end if;

  if v_email is null or v_email = '' then
    raise notice 'INITIAL_OPERATOR_EMAIL not set — skipping seed';
    return;
  end if;

  select id into v_user_id from public.users where lower(email) = lower(v_email) limit 1;

  if v_user_id is null then
    raise notice 'No users row for email % yet — operator must sign in first via Google/magic-link', v_email;
    return;
  end if;

  insert into public.operators (user_id) values (v_user_id) on conflict do nothing;
  raise notice 'Operator seeded for %', v_email;
end$$;
