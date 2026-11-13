-- CITYHOOD backend schema — run in Supabase (SQL Editor -> New query -> paste all -> Run). Safe to re-run.
-- Only the backend touches this data, with the secret (service_role) key. The website never talks to Supabase,
-- so the publishable/anon key gets NO access at all: row level security on every table, no public policies,
-- and table/sequence/function privileges revoked from anon and authenticated (see the end of this file).

create table if not exists public.cityhood_lands (
  land_id        bigint primary key,
  owner          text,
  activated      boolean     not null default false,
  hall_level     int         not null default 0,
  buildings      int         not null default 0,
  rate           bigint      not null default 0,      -- base $CITY / hour
  boost_bps      int         not null default 0,
  score          bigint      not null default 0,      -- whole $CITY invested
  total_claimed  numeric(78,0) not null default 0,    -- wei
  updated_at     timestamptz not null default now()
);
create index if not exists cityhood_lands_score_idx on public.cityhood_lands (score desc);
create index if not exists cityhood_lands_owner_idx on public.cityhood_lands (lower(owner));

create table if not exists public.cityhood_events (
  id            text primary key,                     -- txHash:logIndex
  block_number  bigint not null,
  log_index     int    not null,
  tx_hash       text   not null,
  event         text   not null,
  land_id       bigint,
  player        text,
  kind          int,
  level         int,
  amount        numeric(78,0),
  created_at    timestamptz not null default now()
);
create index if not exists cityhood_events_recent_idx on public.cityhood_events (block_number desc, log_index desc);
create index if not exists cityhood_events_land_idx on public.cityhood_events (land_id, block_number desc);

create table if not exists public.cityhood_sync (
  key   text primary key,
  value text not null
);

-- Mailbox news shown to every player (posted with POST /api/admin/announcements)
create table if not exists public.cityhood_announcements (
  id          bigint generated always as identity primary key,
  title       text not null,
  body        text not null,
  link        text,
  created_at  timestamptz not null default now()
);

alter table public.cityhood_lands         enable row level security;
alter table public.cityhood_events        enable row level security;
alter table public.cityhood_sync          enable row level security;
alter table public.cityhood_announcements enable row level security;

-- No public policies: the website reads everything through the backend API, never from Supabase directly.
-- (Older versions of this file allowed public reads; re-running this file removes those policies.)
drop policy if exists "public read lands"  on public.cityhood_lands;
drop policy if exists "public read events" on public.cityhood_events;
drop policy if exists "public read news"   on public.cityhood_announcements;

-- =====================================================================================
-- Citizenship (X login, tasks, referrals) + Grab Land (codes, allowlist, entries) + admin
-- All of these are private: RLS on, no public policies. Only the backend (service_role) touches them.
-- Safe to re-run.
-- =====================================================================================
create extension if not exists pgcrypto;

create table if not exists public.cityhood_users (
  id                 uuid primary key default gen_random_uuid(),
  x_id               text not null unique,
  username           text not null,
  name               text,
  avatar_url         text,
  followers          int,
  account_created_at timestamptz,
  referral_code      text not null unique,
  referred_by        uuid references public.cityhood_users(id) on delete set null,
  points             int  not null default 0 check (points >= 0),
  wallet_address     text unique,
  status             text not null default 'pending' check (status in ('pending','citizen','rejected','banned')),
  citizen_no         int unique,
  tier               text,
  admin_note         text,
  grab_code          text,
  approved_at        timestamptz,
  last_login_at      timestamptz,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);
create index if not exists cityhood_users_points_idx   on public.cityhood_users (points desc, created_at asc);
create index if not exists cityhood_users_status_idx   on public.cityhood_users (status);
create index if not exists cityhood_users_username_idx on public.cityhood_users (lower(username));

create table if not exists public.cityhood_tasks (
  id                 uuid primary key default gen_random_uuid(),
  kind               text not null check (kind in ('follow','like','repost','engage','quote','reply','post','art','daily','visit','custom')),
  title              text not null,
  description        text not null default '',
  points             int  not null default 0,
  target_url         text,
  x_handle           text,
  verify_mode        text not null default 'auto' check (verify_mode in ('auto','review','x_api')),
  verify_after_hours int  not null default 24,
  requires_link      boolean not null default false,
  required_text      text,
  active             boolean not null default true,
  sort               int  not null default 100,
  starts_at          timestamptz,
  ends_at            timestamptz,
  created_at         timestamptz not null default now()
);

-- v5: the "visit" task kind (open a website or any link). Safe to run again on an existing database.
alter table public.cityhood_tasks drop constraint if exists cityhood_tasks_kind_check;
alter table public.cityhood_tasks add constraint cityhood_tasks_kind_check
  check (kind in ('follow','like','repost','engage','quote','reply','post','art','daily','visit','custom'));

create table if not exists public.cityhood_submissions (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references public.cityhood_users(id) on delete cascade,
  task_id        uuid not null references public.cityhood_tasks(id) on delete cascade,
  status         text not null check (status in ('pending','in_review','verified','rejected')),
  tweet_url      text,
  tweet_id       text,
  verify_at      timestamptz,
  points_awarded int  not null default 0,
  review_note    text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  unique (user_id, task_id)
);
create index if not exists cityhood_submissions_due_idx    on public.cityhood_submissions (status, verify_at);
create index if not exists cityhood_submissions_tweet_idx  on public.cityhood_submissions (task_id, tweet_id);

create table if not exists public.cityhood_referrals (
  id          uuid primary key default gen_random_uuid(),
  referrer_id uuid not null references public.cityhood_users(id) on delete cascade,
  referee_id  uuid not null unique references public.cityhood_users(id) on delete cascade,
  code        text not null,
  points      int  not null default 0,
  created_at  timestamptz not null default now()
);
create index if not exists cityhood_referrals_referrer_idx on public.cityhood_referrals (referrer_id);

create table if not exists public.cityhood_bonuses (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references public.cityhood_users(id) on delete cascade,
  need       int  not null,
  bonus      int  not null,
  created_at timestamptz not null default now(),
  unique (user_id, need)
);

create table if not exists public.cityhood_settings (
  key        text primary key,
  value      jsonb,
  updated_at timestamptz not null default now()
);

create table if not exists public.cityhood_grab_codes (
  code       text primary key check (code ~ '^[0-9]{6}$'),
  label      text,
  batch      text,
  status     text not null default 'unused' check (status in ('unused','claimed','revoked')),
  wallet     text,
  user_id    uuid references public.cityhood_users(id) on delete set null,
  claimed_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists cityhood_grab_codes_status_idx on public.cityhood_grab_codes (status);
create index if not exists cityhood_grab_codes_batch_idx  on public.cityhood_grab_codes (batch);
create index if not exists cityhood_grab_codes_wallet_idx on public.cityhood_grab_codes (wallet);

create table if not exists public.cityhood_grab_wallets (
  wallet     text primary key check (wallet ~ '^0x[0-9a-f]{40}$'),
  source     text not null default 'admin',
  note       text,
  created_at timestamptz not null default now()
);

create table if not exists public.cityhood_grab_entries (
  wallet          text primary key,
  via             text not null,
  code            text,
  ip              text,
  entered_at      timestamptz not null default now(),
  last_voucher_at timestamptz,
  created_at      timestamptz not null default now()
);

create table if not exists public.cityhood_audit (
  id         uuid primary key default gen_random_uuid(),
  actor      text not null,
  action     text not null,
  detail     jsonb,
  created_at timestamptz not null default now()
);
create index if not exists cityhood_audit_recent_idx on public.cityhood_audit (created_at desc);

-- atomic helpers used by the backend
create or replace function public.cityhood_add_points(p_user uuid, p_delta int)
returns int language sql security definer set search_path = public as $$
  update public.cityhood_users set points = greatest(0, points + p_delta), updated_at = now() where id = p_user returning points;
$$;

create sequence if not exists public.cityhood_citizen_seq;
create or replace function public.cityhood_next_citizen_no()
returns int language sql security definer set search_path = public as $$
  select nextval('public.cityhood_citizen_seq')::int;
$$;
revoke all on function public.cityhood_add_points(uuid, int) from public, anon, authenticated;
revoke all on function public.cityhood_next_citizen_no() from public, anon, authenticated;

alter table public.cityhood_users        enable row level security;
alter table public.cityhood_tasks        enable row level security;
alter table public.cityhood_submissions  enable row level security;
alter table public.cityhood_referrals    enable row level security;
alter table public.cityhood_bonuses      enable row level security;
alter table public.cityhood_settings     enable row level security;
alter table public.cityhood_grab_codes   enable row level security;
alter table public.cityhood_grab_wallets enable row level security;
alter table public.cityhood_grab_entries enable row level security;
alter table public.cityhood_audit        enable row level security;

-- =====================================================================================
-- Lock-down: only the backend's secret key (service_role) can read or write CITYHOOD data.
-- RLS above already blocks the public keys; revoking the privileges as well means a forgotten policy
-- can never expose a table. Applies to every cityhood_* table and sequence, including ones added later.
-- =====================================================================================
do $$
declare r record;
begin
  for r in select tablename from pg_tables where schemaname = 'public' and tablename like 'cityhood\_%' loop
    execute format('alter table public.%I enable row level security', r.tablename);
    execute format('revoke all on table public.%I from anon, authenticated, public', r.tablename);
    execute format('grant all on table public.%I to service_role', r.tablename);
  end loop;
  for r in select sequence_name from information_schema.sequences where sequence_schema = 'public' and sequence_name like 'cityhood\_%' loop
    execute format('revoke all on sequence public.%I from anon, authenticated, public', r.sequence_name);
    execute format('grant all on sequence public.%I to service_role', r.sequence_name);
  end loop;
end $$;

grant execute on function public.cityhood_add_points(uuid, int) to service_role;
grant execute on function public.cityhood_next_citizen_no() to service_role;

-- Check (optional): both queries should come back as expected.
--   every table protected (rls = true):
--     select tablename, rowsecurity as rls from pg_tables where schemaname = 'public' and tablename like 'cityhood_%' order by 1;
--   no access for the public keys (0 rows):
--     select table_name, grantee, privilege_type from information_schema.role_table_grants
--     where table_schema = 'public' and table_name like 'cityhood_%' and grantee in ('anon', 'authenticated');
