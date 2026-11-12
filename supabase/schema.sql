-- Draftverse online: the daily drafts' leaderboard (2026-11-11).
-- Paste the whole file into Supabase → SQL Editor → Run. Safe to run again.
--
-- Who can do what (Row Level Security):
--   * everyone, signed in or not, can READ profiles and scores (the leaderboard is public);
--   * a signed-in player can WRITE only his own profile and his own scores;
--   * a score is today's only; the same row is updated once the season adds its points.

-- A player's public name. id = the Google account's Supabase user id.
create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  nickname text not null check (char_length(nickname) between 2 and 24),
  created_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

drop policy if exists "profiles are public" on public.profiles;
create policy "profiles are public" on public.profiles for select using (true);

drop policy if exists "own profile insert" on public.profiles;
create policy "own profile insert" on public.profiles for insert with check (auth.uid() = id);

drop policy if exists "own profile update" on public.profiles;
create policy "own profile update" on public.profiles for update using (auth.uid() = id) with check (auth.uid() = id);

-- One result per player, mode and day (the same draft for everyone that day).
create table if not exists public.daily_scores (
  user_id uuid not null references auth.users (id) on delete cascade,
  mode text not null check (mode in ('mini', 'alltime', 'bomb')),
  day date not null,
  overall numeric(6, 2) not null check (overall between 0 and 150),
  place int not null check (place between 1 and 40),
  field int not null check (field between 2 and 40),
  points numeric(6, 1) not null default 0 check (points between 0 and 130),
  draft_points numeric(6, 1) not null default 0,
  season_points numeric(6, 1) not null default 0,
  streak_points numeric(6, 1) not null default 0,
  created_at timestamptz not null default now(),
  primary key (user_id, mode, day)
);

-- Columns added after the first version (safe to run again).
alter table public.daily_scores add column if not exists points numeric(6, 1) not null default 0;
alter table public.daily_scores add column if not exists draft_points numeric(6, 1) not null default 0;
alter table public.daily_scores add column if not exists season_points numeric(6, 1) not null default 0;
alter table public.daily_scores add column if not exists streak_points numeric(6, 1) not null default 0;

create index if not exists daily_scores_board on public.daily_scores (mode, day, points desc);

alter table public.daily_scores enable row level security;

drop policy if exists "scores are public" on public.daily_scores;
create policy "scores are public" on public.daily_scores for select using (true);

-- Only your own score, only for today (a day either side for time zones).
drop policy if exists "own score insert" on public.daily_scores;
create policy "own score insert" on public.daily_scores for insert with check (
  auth.uid() = user_id
  and day between (now() at time zone 'utc')::date - 1 and (now() at time zone 'utc')::date + 1
);

-- The season is played after the draft: the same row gets its season points later that day.
drop policy if exists "own score update" on public.daily_scores;
create policy "own score update" on public.daily_scores for update using (
  auth.uid() = user_id
  and day between (now() at time zone 'utc')::date - 1 and (now() at time zone 'utc')::date + 1
) with check (auth.uid() = user_id);

-- The leaderboard as the game reads it: score + nickname in one query.
create or replace view public.daily_leaderboard
with (security_invoker = true) as
select s.mode, s.day, s.overall, s.place, s.field, s.points, s.draft_points, s.season_points, s.streak_points, s.created_at, s.user_id, p.nickname
from public.daily_scores s
join public.profiles p on p.id = s.user_id;

grant select on public.daily_leaderboard to anon, authenticated;

-- This week's table: points summed per player and mode, Monday to Sunday (UTC).
create or replace view public.weekly_leaderboard
with (security_invoker = true) as
select s.mode, date_trunc('week', s.day)::date as week, s.user_id, p.nickname,
       sum(s.points) as points, count(*) as days
from public.daily_scores s
join public.profiles p on p.id = s.user_id
group by s.mode, date_trunc('week', s.day), s.user_id, p.nickname;

grant select on public.weekly_leaderboard to anon, authenticated;

-- 2026-11-11: the server check (scripts/verifyDaily.ts, hourly in GitHub Actions). The game sends
-- the draft's proof; only the checker (secret key) may set `verified`.
alter table public.daily_scores add column if not exists proof jsonb;
alter table public.daily_scores add column if not exists verified text not null default 'pending';

create or replace function public.daily_scores_keep_pending() returns trigger
language plpgsql as $$
begin
  if coalesce(current_setting('request.jwt.claims', true)::json ->> 'role', '') <> 'service_role' then
    new.verified := 'pending';
  end if;
  return new;
end $$;

drop trigger if exists daily_scores_keep_pending on public.daily_scores;
create trigger daily_scores_keep_pending before insert or update on public.daily_scores
for each row execute function public.daily_scores_keep_pending();

create or replace view public.daily_leaderboard
with (security_invoker = true) as
select s.mode, s.day, s.overall, s.place, s.field, s.points, s.draft_points, s.season_points, s.streak_points, s.created_at, s.user_id, p.nickname, s.verified
from public.daily_scores s
join public.profiles p on p.id = s.user_id;

-- 2026-11-12: every finished draft (dailies too) for the account's stats and XP; free drafts (not the
-- daily) also add a few points to the week's table, minus for the bottom half so grinding weak
-- drafts costs. Ids come from the game (one per draft and player), so a result is only counted once.
create table if not exists public.draft_results (
  id text not null check (char_length(id) between 8 and 80),
  user_id uuid not null references auth.users (id) on delete cascade,
  mode text not null check (mode in ('drawfive', 'mini', 'alltime', 'bomb')),
  daily boolean not null default false,
  place int not null check (place between 1 and 40),
  field int not null check (field between 2 and 40),
  overall numeric(6, 2) not null check (overall between 0 and 150),
  won boolean not null default false,
  title boolean not null default false,
  points numeric(4, 1) not null default 0 check (points between -8 and 8),
  xp int not null default 0 check (xp between 0 and 60),
  created_at timestamptz not null default now(),
  primary key (user_id, id)
);

create index if not exists draft_results_user on public.draft_results (user_id, created_at);

alter table public.draft_results enable row level security;

drop policy if exists "results are public" on public.draft_results;
create policy "results are public" on public.draft_results for select using (true);

drop policy if exists "own result insert" on public.draft_results;
create policy "own result insert" on public.draft_results for insert with check (auth.uid() = user_id and created_at > now() - interval '1 hour');

-- The season (a title) comes after the draft: the same row is updated within the day.
drop policy if exists "own result update" on public.draft_results;
create policy "own result update" on public.draft_results for update using (auth.uid() = user_id and created_at > now() - interval '1 day') with check (auth.uid() = user_id);

-- No more than 40 drafts a day per player (a cap on farming).
create or replace function public.draft_results_daily_cap() returns trigger
language plpgsql as $$
begin
  if (select count(*) from public.draft_results where user_id = new.user_id and created_at > now() - interval '1 day') >= 40 then
    raise exception 'daily draft cap reached';
  end if;
  return new;
end $$;

drop trigger if exists draft_results_daily_cap on public.draft_results;
create trigger draft_results_daily_cap before insert on public.draft_results
for each row execute function public.draft_results_daily_cap();

-- The week's table: the dailies' points plus the free drafts' (same columns as before).
create or replace view public.weekly_leaderboard
with (security_invoker = true) as
select x.mode, x.week, x.user_id, p.nickname, sum(x.points) as points, count(*) filter (where x.daily_row) as days
from (
  select s.mode, date_trunc('week', s.day)::date as week, s.user_id, s.points, true as daily_row from public.daily_scores s
  union all
  select r.mode, date_trunc('week', r.created_at at time zone 'utc')::date, r.user_id, r.points, false from public.draft_results r where not r.daily
) x
join public.profiles p on p.id = x.user_id
group by x.mode, x.week, x.user_id, p.nickname;
