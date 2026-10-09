-- Additive: existing public.operators remain full administrators, untouched.
create table public.scouting_staff_grants (
 email text primary key check (email=lower(trim(email))),
 user_id uuid unique references public.users(id),
 role text not null default 'scouter' check (role in ('viewer','scouter','admin')),
 status text not null default 'active' check (status in ('active','suspended')),
 granted_by uuid not null references public.users(id),
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now()
);
create table public.scouting_access_audit (
 id bigint generated always as identity primary key,
 actor_user_id uuid not null references public.users(id),
 action text not null, target text not null, details jsonb not null default '{}',
 created_at timestamptz not null default now()
);
alter table public.scouting_staff_grants enable row level security;
alter table public.scouting_access_audit enable row level security;
revoke all on public.scouting_staff_grants, public.scouting_access_audit from anon, authenticated;
grant select,insert,update on public.scouting_staff_grants to service_role;
grant select on public.operators to service_role;
grant select,insert on public.scouting_access_audit to service_role;
grant usage,select on sequence public.scouting_access_audit_id_seq to service_role;

alter table public.operator_video_scouting_sessions
 add column creator_user_id uuid references public.users(id),
 add column assigned_scouter_user_id uuid references public.users(id),
 add column updated_by_user_id uuid references public.users(id);
alter table public.operator_manual_video_scouting_sessions
 add column creator_user_id uuid references public.users(id),
 add column assigned_scouter_user_id uuid references public.users(id),
 add column updated_by_user_id uuid references public.users(id);
alter table public.operator_manual_scouting_matches add column creator_user_id uuid references public.users(id);
-- Legacy sessions remain unassigned and admin-editable. Never guess historical ownership.

-- Enforce current grants and assignment atomically at the database write, including
-- revocation/reassignment racing with an in-flight extension save.
create function public.enforce_scouting_assignment() returns trigger language plpgsql as $$
declare actor uuid; actor_role text;
begin
 actor := new.updated_by_user_id;
 -- Compatibility for old administrator-only code during rollout/rollback.
 if actor is null then
   if TG_OP='UPDATE' and old.updated_by_user_id is not null then
     raise exception 'Authenticated actor required' using errcode='42501';
   end if;
   return new;
 end if;
 if not exists(select 1 from public.operators where user_id=actor) then
   select role into actor_role from public.scouting_staff_grants where user_id=actor and status='active' for share;
   if not found or actor_role='viewer' then raise exception 'Scouting access revoked' using errcode='42501'; end if;
   if actor_role='scouter' then
   if TG_OP='INSERT' then
     if new.assigned_scouter_user_id is distinct from actor or new.creator_user_id is distinct from actor then
       raise exception 'Invalid scouting assignment' using errcode='42501';
     end if;
   elsif old.assigned_scouter_user_id is distinct from actor or new.assigned_scouter_user_id is distinct from old.assigned_scouter_user_id then
     raise exception 'This session is assigned to another scouter' using errcode='42501';
   end if;
 end if;
 end if;
 if TG_OP='UPDATE' and new.creator_user_id is distinct from old.creator_user_id then
   raise exception 'Session creator is immutable' using errcode='42501';
 end if;
 insert into public.scouting_access_audit(actor_user_id,action,target,details)
 values(actor,case when TG_OP='UPDATE' and new.assigned_scouter_user_id is distinct from old.assigned_scouter_user_id then 'session.reassigned' else 'session.saved' end,
 TG_TABLE_NAME||':'||new.match_id,jsonb_build_object('revision',new.revision,'assignedTo',new.assigned_scouter_user_id));
 return new;
end $$;
create trigger scouting_assignment before insert or update on public.operator_video_scouting_sessions for each row execute function public.enforce_scouting_assignment();
create trigger manual_scouting_assignment before insert or update on public.operator_manual_video_scouting_sessions for each row execute function public.enforce_scouting_assignment();
