-- supabase/migrations/20260410_signup_telegram_webhook.sql
-- Fires a Telegram notification via our API webhook whenever a new profile is created.
-- Uses pg_net to make an async HTTP POST from inside the trigger.

-- Ensure pg_net extension is available (enabled by default on Supabase)
CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;

-- Trigger function: POST to /api/webhooks/new-signup with the new profile row
CREATE OR REPLACE FUNCTION public.notify_new_signup()
RETURNS trigger AS $$
DECLARE
  site_url text := current_setting('app.settings.site_url', true);
  cron_secret text := current_setting('app.settings.cron_secret', true);
  payload jsonb;
BEGIN
  -- Build the Supabase Database Webhook-style payload
  payload := jsonb_build_object(
    'type', 'INSERT',
    'table', TG_TABLE_NAME,
    'schema', TG_TABLE_SCHEMA,
    'record', jsonb_build_object(
      'id', NEW.id,
      'display_name', NEW.display_name,
      'avatar_url', NEW.avatar_url,
      'created_at', NEW.created_at
    ),
    'old_record', null
  );

  -- Fire-and-forget HTTP POST via pg_net
  IF site_url IS NOT NULL AND cron_secret IS NOT NULL THEN
    PERFORM net.http_post(
      url := site_url || '/api/webhooks/new-signup',
      body := payload,
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || cron_secret
      )
    );
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Attach to profiles table (fires after the handle_new_user trigger inserts the row)
CREATE TRIGGER on_profile_created_notify
  AFTER INSERT ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.notify_new_signup();
