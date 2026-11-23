-- Supabase does not allow the app role to set database-wide app.settings.*.
-- Provision signup_webhook_site_url and signup_webhook_cron_secret in Vault
-- separately; never commit secret values. Keep legacy settings as a fallback.
CREATE OR REPLACE FUNCTION public.notify_new_signup()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  site_url text;
  cron_secret text;
BEGIN
  SELECT decrypted_secret INTO site_url
    FROM vault.decrypted_secrets WHERE name = 'signup_webhook_site_url';
  SELECT decrypted_secret INTO cron_secret
    FROM vault.decrypted_secrets WHERE name = 'signup_webhook_cron_secret';
  site_url := COALESCE(site_url, current_setting('app.settings.site_url', true));
  cron_secret := COALESCE(cron_secret, current_setting('app.settings.cron_secret', true));

  IF NULLIF(site_url, '') IS NOT NULL AND NULLIF(cron_secret, '') IS NOT NULL THEN
    PERFORM net.http_post(
      url := site_url || '/api/webhooks/new-signup',
      body := jsonb_build_object(
        'type', 'INSERT', 'table', TG_TABLE_NAME, 'schema', TG_TABLE_SCHEMA,
        'record', jsonb_build_object(
          'id', NEW.id, 'email', NEW.email, 'name', NEW.name, 'image', NEW.image
        ),
        'old_record', null
      ),
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || cron_secret
      ),
      timeout_milliseconds := 10000
    );
  END IF;
  RETURN NEW;
END;
$$;
