-- 20260909180000_team_labels.sql
-- Short labels for a team's competition.
--
-- `teams.competition` holds the full name ("Series Nacionales de Pádel ·
-- Barcelona · Masculino 1000"), which overflows the hero badge and the points
-- widget. These two columns carry the compact forms. Both nullable: without
-- them the UI falls back to the derived short form, so teams imported without
-- labels keep working.

alter table public.teams
  add column if not exists badge_label text,
  add column if not exists short_name  text;

comment on column public.teams.badge_label is
  'Verbatim hero badge text, same in every locale (e.g. "Amador · SNP"). Null = compose from i18n + competition.';
comment on column public.teams.short_name is
  'Compact competition reference for labels (e.g. "SNP"). Null = fall back to competition.';

update public.teams
   set badge_label = 'Amador · SNP',
       short_name  = 'SNP'
 where slug = 'blue-padel-mataro';
