# Discord signup notifications

The existing database trigger on `public.users` calls `/api/webhooks/new-signup`.
That handler sends the existing Telegram alert and an optional Discord message.
Discord receives signup method and total user count, with no name or email.

## Enable

1. In the destination Discord text channel, open Edit Channel → Integrations → Webhooks, create a webhook, and copy its URL (requires Manage Webhooks permission).
2. Set the server secret `DISCORD_SIGNUP_WEBHOOK_URL` in the web app's hosting environment. Do not use a `NEXT_PUBLIC_` prefix or commit the URL.
3. Apply `20261123180000_signup_webhook_vault.sql`. In Supabase Vault, provision `signup_webhook_site_url` with the production origin and `signup_webhook_cron_secret` with the web app's `CRON_SECRET`. Update the Vault secret whenever that Railway secret rotates. Secret values must never be committed.
4. Deploy the updated app. The existing trigger on `public.users` reads those Vault secrets and sends an authenticated request after each signup. Legacy `app.settings.*` values remain a fallback.
5. Create a test account and verify a message arrives in the selected channel.

An invite URL cannot deliver messages. Remove the environment variable to disable Discord.
Delivery is best effort: Discord calls time out after five seconds; failures return HTTP 502.
There is no durable retry queue or deduplication, so a failed delivery may be lost and
manually replaying the database webhook can repeat messages in either destination.

API reference: https://discord.com/developers/docs/resources/webhook#execute-webhook
