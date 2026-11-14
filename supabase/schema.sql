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

-- The leaderboard as the game reads it: score + nickname in one query.
create or replace view public.daily_leaderboard
with (security_invoker = true) as
select s.mode, s.day, s.overall, s.place, s.field, s.points, s.draft_points, s.season_points, s.streak_points, s.created_at, s.user_id, p.nickname, s.verified
from public.daily_scores s
join public.profiles p on p.id = s.user_id;

grant select on public.daily_leaderboard to anon, authenticated;

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

-- 2026-11-12: limits on writes, so nobody can flood the server. Every write a player makes is logged
-- for a day; too many in a window and the write is refused ("rate limit"). The log is private (no
-- policies: only the functions below, running as the owner, can touch it).
create table if not exists public.rate_events (
  user_id uuid not null,
  kind text not null,
  at timestamptz not null default now()
);
create index if not exists rate_events_lookup on public.rate_events (user_id, kind, at);
alter table public.rate_events enable row level security;

create or replace function public.rate_check(p_kind text, p_max int, p_window interval) returns void
language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
begin
  -- The checker (secret key) and SQL Editor have no user: not limited.
  if uid is null then return; end if;
  delete from rate_events where user_id = uid and at < now() - interval '1 day';
  if (select count(*) from rate_events where user_id = uid and kind = p_kind and at > now() - p_window) >= p_max then
    raise exception 'rate limit: too many % requests, try again later', p_kind using errcode = 'P0001';
  end if;
  insert into rate_events (user_id, kind) values (uid, p_kind);
end $$;

revoke all on function public.rate_check(text, int, interval) from public, anon, authenticated;

create or replace function public.rate_limit_writes() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_table_name = 'daily_scores' then
    perform rate_check('score', 20, interval '10 minutes');
    perform rate_check('score_day', 120, interval '1 day');
  elsif tg_table_name = 'draft_results' then
    perform rate_check('draft', 15, interval '10 minutes');
  elsif tg_table_name = 'profiles' then
    perform rate_check('profile', 10, interval '1 day');
  end if;
  return new;
end $$;

drop trigger if exists daily_scores_rate on public.daily_scores;
create trigger daily_scores_rate before insert or update on public.daily_scores
for each row execute function public.rate_limit_writes();

drop trigger if exists draft_results_rate on public.draft_results;
create trigger draft_results_rate before insert or update on public.draft_results
for each row execute function public.rate_limit_writes();

drop trigger if exists profiles_rate on public.profiles;
create trigger profiles_rate before insert or update on public.profiles
for each row execute function public.rate_limit_writes();

-- Guests (anonymous sign-in, for multiplayer without an account) play but don't post: only real
-- accounts write profiles, scores and the career.
drop policy if exists "own profile insert" on public.profiles;
create policy "own profile insert" on public.profiles for insert with check (auth.uid() = id and coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false) = false);

drop policy if exists "own score insert" on public.daily_scores;
create policy "own score insert" on public.daily_scores for insert with check (
  auth.uid() = user_id
  and coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false) = false
  and day between (now() at time zone 'utc')::date - 1 and (now() at time zone 'utc')::date + 1
);

drop policy if exists "own result insert" on public.draft_results;
create policy "own result insert" on public.draft_results for insert with check (
  auth.uid() = user_id
  and coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false) = false
  and created_at > now() - interval '1 hour'
);

-- ============================================================================================
-- 2026-11-12: unique names and multiplayer (Mini Draft with friends). Safe to run again.
-- ============================================================================================

-- Names are unique, ignoring case. (If this fails, two profiles already share a name: rename one.)
create unique index if not exists profiles_nickname_unique on public.profiles (lower(nickname));

-- A room: a Mini Draft board (its seed) that up to max_players people draft together; the other
-- teams are CPU GMs. The code is what friends type or open as ?room=CODE.
create table if not exists public.mp_rooms (
  id uuid primary key default gen_random_uuid(),
  code text not null unique check (code ~ '^[A-Z2-9]{5}$'),
  host uuid not null references auth.users (id) on delete cascade,
  seed bigint not null,
  max_players int not null default 4 check (max_players between 2 and 16),
  clock_s int not null default 120 check (clock_s between 15 and 600),
  status text not null default 'lobby' check (status in ('lobby', 'draft', 'done')),
  started_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.mp_members (
  room_id uuid not null references public.mp_rooms (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  nickname text not null check (char_length(nickname) between 2 and 24),
  level int not null default 1 check (level between 1 and 999),
  slot int check (slot between 0 and 15),
  joined_at timestamptz not null default now(),
  last_seen timestamptz not null default now(),
  primary key (room_id, user_id)
);

create table if not exists public.mp_picks (
  room_id uuid not null references public.mp_rooms (id) on delete cascade,
  pick_no int not null check (pick_no between 1 and 80),
  player_id text not null check (char_length(player_id) <= 80),
  by_user uuid not null,
  made_at timestamptz not null default now(),
  primary key (room_id, pick_no)
);

alter table public.mp_rooms enable row level security;
alter table public.mp_members enable row level security;
alter table public.mp_picks enable row level security;

-- Only members see a room; every write goes through the functions below.
create or replace function public.mp_is_member(p_room uuid) returns boolean
language sql security definer stable set search_path = public as $$
  select exists (select 1 from mp_members where room_id = p_room and user_id = auth.uid());
$$;

drop policy if exists "members read rooms" on public.mp_rooms;
create policy "members read rooms" on public.mp_rooms for select using (public.mp_is_member(id));
drop policy if exists "members read members" on public.mp_members;
create policy "members read members" on public.mp_members for select using (public.mp_is_member(room_id));
drop policy if exists "members read picks" on public.mp_picks;
create policy "members read picks" on public.mp_picks for select using (public.mp_is_member(room_id));

-- Live updates (Realtime) for picks, members and the room's status.
do $$ begin
  alter publication supabase_realtime add table public.mp_picks, public.mp_members, public.mp_rooms;
exception when duplicate_object then null; end $$;

-- How many people are in live rooms right now (the free plan holds 200 live connections).
create or replace function public.mp_live_players() returns int
language sql security definer stable set search_path = public as $$
  select count(*)::int from mp_members m join mp_rooms r on r.id = m.room_id
  where r.status <> 'done' and m.last_seen > now() - interval '1 minute';
$$;

-- 2026-11-12: a room is a Mini (16 teams) or a Duel (2 teams, one each).
alter table public.mp_rooms add column if not exists teams int not null default 16 check (teams in (2, 16));
alter table public.mp_rooms add column if not exists cap numeric not null default 70 check (cap between 40 and 120);
drop function if exists public.mp_create(bigint, text, int, int, int);
drop function if exists public.mp_create(bigint, text, int, int, int, int);
drop function if exists public.mp_create(bigint, text, int, int, int, int, numeric);
-- 2026-11-13: the All-Time Draft online (16 teams, 9 rounds, up to 8 people).
alter table public.mp_rooms add column if not exists rounds int not null default 5 check (rounds in (5, 9));
alter table public.mp_picks drop constraint if exists mp_picks_pick_no_check;
alter table public.mp_picks add constraint mp_picks_pick_no_check check (pick_no between 1 and 144);
-- A player's final roster (spans) and rotation after the draft, for the shared season.
alter table public.mp_members add column if not exists final jsonb check (final is null or octet_length(final::text) < 8000);

create or replace function public.mp_create(p_seed bigint, p_nick text, p_level int, p_max int default 4, p_clock int default 120, p_teams int default 16, p_cap numeric default 70, p_rounds int default 5) returns text
language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  v_code text;
  v_room uuid;
  i int;
begin
  if uid is null then raise exception 'not signed in' using errcode = 'P0001'; end if;
  perform rate_check('room', 10, interval '1 hour');
  if mp_live_players() >= 180 then raise exception 'server_full' using errcode = 'P0001'; end if;
  -- Old rooms go: nobody plays a Mini Draft for a day.
  delete from mp_rooms where created_at < now() - interval '1 day';
  for i in 1..20 loop
    v_code := (select string_agg(substr('ABCDEFGHJKLMNPQRSTUVWXYZ23456789', 1 + floor(random() * 32)::int, 1), '') from generate_series(1, 5));
    begin
      insert into mp_rooms (code, host, seed, max_players, clock_s, teams, cap, rounds)
      values (v_code, uid, p_seed, case when p_teams = 2 then 2 else least(p_max, 8) end, p_clock, case when p_teams = 2 then 2 else 16 end, p_cap,
              case when p_rounds = 9 and p_teams = 16 then 9 else 5 end) returning id into v_room;
      exit;
    exception when unique_violation then v_room := null;
    end;
  end loop;
  if v_room is null then raise exception 'no free code' using errcode = 'P0001'; end if;
  insert into mp_members (room_id, user_id, nickname, level) values (v_room, uid, left(trim(p_nick), 24), greatest(1, least(999, p_level)));
  return v_code;
end $$;

-- Joins by code; joining a room you are already in (a refresh) just says hello again.
create or replace function public.mp_join(p_code text, p_nick text, p_level int) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  r mp_rooms;
begin
  if uid is null then raise exception 'not signed in' using errcode = 'P0001'; end if;
  select * into r from mp_rooms where code = upper(trim(p_code)) for update;
  if r.id is null then raise exception 'not_found' using errcode = 'P0001'; end if;
  if exists (select 1 from mp_members where room_id = r.id and user_id = uid) then
    update mp_members set last_seen = now() where room_id = r.id and user_id = uid;
    return r.id;
  end if;
  perform rate_check('join', 30, interval '1 hour');
  if r.status <> 'lobby' then raise exception 'started' using errcode = 'P0001'; end if;
  if (select count(*) from mp_members where room_id = r.id) >= r.max_players then raise exception 'full' using errcode = 'P0001'; end if;
  if mp_live_players() >= 180 then raise exception 'server_full' using errcode = 'P0001'; end if;
  insert into mp_members (room_id, user_id, nickname, level) values (r.id, uid, left(trim(p_nick), 24), greatest(1, least(999, p_level)));
  return r.id;
end $$;

create or replace function public.mp_leave(p_room uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  r mp_rooms;
begin
  select * into r from mp_rooms where id = p_room;
  if r.id is null then return; end if;
  -- In the lobby you simply leave (the host's leaving closes the room); once the draft is on,
  -- your team stays and the CPU drafts for it.
  if r.status = 'lobby' then
    if r.host = auth.uid() then delete from mp_rooms where id = p_room;
    else delete from mp_members where room_id = p_room and user_id = auth.uid();
    end if;
  else
    update mp_members set last_seen = now() - interval '1 hour' where room_id = p_room and user_id = auth.uid();
  end if;
end $$;

-- The host starts: every member gets a random team (draft slot) of the sixteen.
create or replace function public.mp_start(p_room uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  r mp_rooms;
begin
  select * into r from mp_rooms where id = p_room for update;
  if r.id is null or r.host <> auth.uid() then raise exception 'not the host' using errcode = 'P0001'; end if;
  if r.status <> 'lobby' then return; end if;
  -- A shuffled list of the sixteen slots, one per member.
  with slots as (select g as slot, row_number() over (order by random()) as rn from generate_series(0, r.teams - 1) g),
       ppl as (select user_id, row_number() over (order by random()) as rn from mp_members where room_id = p_room)
  update mp_members m set slot = slots.slot from ppl join slots using (rn)
  where m.room_id = p_room and m.user_id = ppl.user_id;
  update mp_rooms set status = 'draft', started_at = now() where id = p_room;
end $$;

-- A pick. Your own team's whenever it's on the clock; a CPU team's (or a team whose player ran out
-- of time or left) by anyone in the room: the game picks for it the same way on every screen.
create or replace function public.mp_pick(p_room uuid, p_pick int, p_player text) returns boolean
language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  r mp_rooms;
  v_done int;
  v_slot int;
  v_owner mp_members;
  v_since timestamptz;
begin
  select * into r from mp_rooms where id = p_room for update;
  if r.id is null or r.status <> 'draft' then return false; end if;
  if not exists (select 1 from mp_members where room_id = p_room and user_id = uid) then raise exception 'not in this room' using errcode = 'P0001'; end if;
  select count(*), max(made_at) into v_done, v_since from mp_picks where room_id = p_room;
  if p_pick <> v_done + 1 or p_pick > r.teams * r.rounds then return false; end if;
  -- The snake: rounds alternate direction.
  v_slot := case when ((p_pick - 1) / r.teams) % 2 = 0 then (p_pick - 1) % r.teams else r.teams - 1 - (p_pick - 1) % r.teams end;
  select * into v_owner from mp_members where room_id = p_room and slot = v_slot;
  if v_owner.user_id is not null and v_owner.user_id <> uid
     and coalesce(v_since, r.started_at) > now() - make_interval(secs => r.clock_s)
     and v_owner.last_seen > now() - interval '30 seconds' then
    return false;
  end if;
  insert into mp_picks (room_id, pick_no, player_id, by_user) values (p_room, p_pick, p_player, uid)
  on conflict do nothing;
  if not found then return false; end if;
  if p_pick = r.teams * r.rounds then update mp_rooms set status = 'done' where id = p_room; end if;
  return true;
end $$;

-- "Still here", every few seconds; returns the server's clock so every screen counts the same.
create or replace function public.mp_ping(p_room uuid) returns timestamptz
language plpgsql security definer set search_path = public as $$
begin
  update mp_members set last_seen = now() where room_id = p_room and user_id = auth.uid();
  return now();
end $$;

-- 2026-11-12: the tournament goes round by round for the whole room: each player's rounds seen.
alter table public.mp_members add column if not exists tourney int not null default 0 check (tourney between 0 and 10);

create or replace function public.mp_tourney(p_room uuid, p_rounds int) returns void
language plpgsql security definer set search_path = public as $$
begin
  update mp_members set tourney = greatest(tourney, least(p_rounds, 10)), last_seen = now()
  where room_id = p_room and user_id = auth.uid() and tourney < least(p_rounds, 10);
end $$;
revoke all on function public.mp_tourney(uuid, int) from public, anon;
grant execute on function public.mp_tourney(uuid, int) to authenticated;

revoke all on function public.mp_create(bigint, text, int, int, int, int, numeric, int), public.mp_join(text, text, int), public.mp_leave(uuid),
  public.mp_start(uuid), public.mp_pick(uuid, int, text), public.mp_ping(uuid), public.mp_live_players() from public, anon;
grant execute on function public.mp_create(bigint, text, int, int, int, int, numeric, int), public.mp_join(text, text, int), public.mp_leave(uuid),
  public.mp_start(uuid), public.mp_pick(uuid, int, text), public.mp_ping(uuid) to authenticated;

-- 2026-11-13: your final roster and rotation after an All-Time room's draft (everyone's season
-- needs everyone's five). Only your own row, only once the draft is over.
create or replace function public.mp_final(p_room uuid, p_final jsonb) returns void
language plpgsql security definer set search_path = public as $$
begin
  if octet_length(p_final::text) >= 8000 then raise exception 'too big' using errcode = 'P0001'; end if;
  update mp_members m set final = p_final, last_seen = now()
  from mp_rooms r
  where m.room_id = p_room and m.user_id = auth.uid() and r.id = p_room and r.status = 'done';
end $$;
revoke all on function public.mp_final(uuid, jsonb) from public, anon;
grant execute on function public.mp_final(uuid, jsonb) to authenticated;

-- 2026-11-13: years changed live in an All-Time room. A swap is logged with the number of picks
-- in when it was made; every screen replays it at that point, so the boards stay the same.
create table if not exists public.mp_swaps (
  id bigserial primary key,
  room_id uuid not null references public.mp_rooms (id) on delete cascade,
  at_pick int not null check (at_pick between 0 and 144),
  slot int not null check (slot between 0 and 15),
  player_name text not null check (char_length(player_name) <= 80),
  span_id text not null check (char_length(span_id) <= 80),
  made_at timestamptz not null default now()
);
create index if not exists mp_swaps_room on public.mp_swaps (room_id, id);
alter table public.mp_swaps enable row level security;
drop policy if exists "members read swaps" on public.mp_swaps;
create policy "members read swaps" on public.mp_swaps for select using (public.mp_is_member(room_id));
do $$ begin
  alter publication supabase_realtime add table public.mp_swaps;
exception when duplicate_object then null; end $$;

create or replace function public.mp_swap(p_room uuid, p_at int, p_player text, p_span text) returns boolean
language plpgsql security definer set search_path = public as $$
declare
  v_slot int;
begin
  select slot into v_slot from mp_members where room_id = p_room and user_id = auth.uid();
  if v_slot is null then return false; end if;
  if not exists (select 1 from mp_rooms where id = p_room and status = 'draft') then return false; end if;
  perform rate_check('swap', 60, interval '10 minutes');
  -- Logged at the board as it stands now (2026-11-13: no refusals to retry): a pick that slipped
  -- in first just means the swap goes in after it. Every screen checks it against the cap anyway.
  perform 1 from mp_rooms where id = p_room for update;
  insert into mp_swaps (room_id, at_pick, slot, player_name, span_id)
  values (p_room, (select count(*) from mp_picks where room_id = p_room), v_slot, p_player, p_span);
  return true;
end $$;
revoke all on function public.mp_swap(uuid, int, text, text) from public, anon;
grant execute on function public.mp_swap(uuid, int, text, text) to authenticated;
