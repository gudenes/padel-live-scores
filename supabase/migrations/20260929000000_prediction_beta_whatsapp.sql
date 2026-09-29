-- Optional WhatsApp contact; existing signups retain their original consent.
alter table public.prediction_beta_signups
  add column whatsapp text check (whatsapp ~ '^\+[1-9][0-9]{6,14}$');
