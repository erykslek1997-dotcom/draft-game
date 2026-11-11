"""
2026-11-11 (the user: "pobieraj wszystko"): per player-season habits from NBA.com play-by-play
(shufinskiy/nba_data `nbastats_YYYY`, the season starting in YYYY), for the live game's broadcast:

  - made field goals, and how many came in transition (within TRANSITION_S seconds of a steal or a
    defensive rebound) and late in a possession (LATE_S seconds or more after it began);
  - who assisted his made field goals (passer name -> count);
  - clutch (fourth quarter or overtime, five minutes or less left, within five points before the
    play): field goals and threes made / attempted, free throws made / attempted, points.

A possession starts at a defensive rebound, a turnover, an opponent's made field goal or last
free throw, or a period start. Shot clock resets on offensive rebounds are ignored: "late" is time
since the possession began, an approximation.

  python3 -I scripts/py/pbp_tendencies.py <dir with nbastats_*.tar.xz> <out.json>
"""
import csv, io, json, re, subprocess, sys, tarfile
from collections import defaultdict

TRANSITION_S = 7
LATE_S = 18

def secs(pc):
    m, s = pc.split(':')
    return int(m) * 60 + int(s)

def season_rows(path):
    with tarfile.open(path, 'r:xz') as t:
        for m in t.getmembers():
            if m.name.endswith('.csv'):
                f = io.TextIOWrapper(t.extractfile(m), encoding='utf-8', newline='')
                yield from csv.DictReader(f)

def main(src_dir, out):
    import os
    files = sorted(f for f in os.listdir(src_dir) if re.fullmatch(r'nbastats_\d{4}\.tar\.xz', f))
    result = {}
    for f in files:
        end = int(f[9:13]) + 1
        made = defaultdict(int); trans = defaultdict(int); late = defaultdict(int)
        passers = defaultdict(lambda: defaultdict(int))
        clutch = defaultdict(lambda: [0, 0, 0, 0, 0, 0, 0])  # fgm fga 3pm 3pa ftm fta pts
        margin = 0
        game = None; start_t = 720; start_kind = 'period'; period = 0; last_miss_team = None
        for r in season_rows(os.path.join(src_dir, f)):
            if r['GAME_ID'] != game:
                game = r['GAME_ID']; period = 0; margin = 0
            typ = r['EVENTMSGTYPE']
            try:
                t = secs(r['PCTIMESTRING'])
            except Exception:
                continue
            if r['PERIOD'] != str(period):
                period = int(r['PERIOD']); start_t = t; start_kind = 'period'; last_miss_team = None
            team = r['PLAYER1_TEAM_ID']
            is_clutch = period >= 4 and t <= 300 and abs(margin) <= 5
            desc = (r['HOMEDESCRIPTION'] or '') + (r['VISITORDESCRIPTION'] or '')
            if is_clutch and typ in ('1', '2', '3') and r['PLAYER1_NAME']:
                c = clutch[r['PLAYER1_NAME']]
                three = '3PT' in desc
                if typ == '1':
                    c[0] += 1; c[1] += 1; c[6] += 3 if three else 2
                    if three: c[2] += 1; c[3] += 1
                elif typ == '2':
                    c[1] += 1
                    if three: c[3] += 1
                else:
                    c[5] += 1
                    if 'MISS' not in desc: c[4] += 1; c[6] += 1
            sm = r.get('SCOREMARGIN') or ''
            if sm:
                margin = 0 if sm == 'TIE' else int(sm) if sm.lstrip('-').isdigit() else margin
            if typ == '1':  # made field goal
                name = r['PLAYER1_NAME']
                if name:
                    made[name] += 1
                    el = start_t - t
                    if start_kind == 'live' and el <= TRANSITION_S: trans[name] += 1
                    if el >= LATE_S: late[name] += 1
                    if r['PLAYER2_NAME'] and r['PERSON2TYPE'] in ('4', '5'):
                        passers[name][r['PLAYER2_NAME']] += 1
                start_t = t; start_kind = 'dead'; last_miss_team = None
            elif typ == '2':  # miss
                last_miss_team = team
            elif typ == '4':  # rebound (team id in PLAYER1_TEAM_ID, or PLAYER1_ID for a team rebound)
                reb_team = team or r['PLAYER1_ID']
                if last_miss_team and reb_team and reb_team != last_miss_team:
                    start_t = t; start_kind = 'live'
                last_miss_team = None
            elif typ == '5':  # turnover; a steal names the thief as PLAYER2
                start_t = t; start_kind = 'live' if r['PLAYER2_NAME'] else 'dead'
            elif typ == '3':  # free throw: the last of a trip hands the ball over when made
                d = (r['HOMEDESCRIPTION'] or '') + (r['VISITORDESCRIPTION'] or '')
                m = re.search(r'(\d) of (\d)', d)
                if m and m.group(1) == m.group(2) and 'MISS' not in d:
                    start_t = t; start_kind = 'dead'
                if m and m.group(1) == m.group(2) and 'MISS' in d:
                    last_miss_team = team
        for name in set(made) | set(clutch):
            result[f'{name}|{end}'] = {
                'made': made[name], 'trans': trans[name], 'late': late[name],
                'passers': dict(sorted(passers[name].items(), key=lambda kv: -kv[1])[:5]),
                'clutch': clutch[name] if name in clutch else [0] * 7,
            }
        print(f, len(made), 'players', file=sys.stderr, flush=True)
    json.dump(result, open(out, 'w'))

if __name__ == '__main__':
    main(sys.argv[1], sys.argv[2])
