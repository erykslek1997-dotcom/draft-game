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
