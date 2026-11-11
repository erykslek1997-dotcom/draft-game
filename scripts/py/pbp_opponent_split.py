"""
2026-11-11 (the user: "na słabe zespoły w RS nikt się tak dobrze nie przygotowuje, stąd łatwiej takim
graczom nabijać statystyki"): each player-season's shooting split by the opponent's strength, from
NBA.com play-by-play (shufinskiy/nba_data `nbastats_YYYY`). Opponents are cut in thirds by their
season SRS (BBRef team_advanced.csv); per tier: field goals made / attempted, threes made, free
throws made / attempted, points, games.

  python3 -I scripts/py/pbp_opponent_split.py <dir with nbastats_*.tar.xz> <team_advanced.csv> <out.json>
"""
import csv, io, json, os, re, sys, tarfile
from collections import defaultdict

def season_rows(path):
    with tarfile.open(path, 'r:xz') as t:
        for m in t.getmembers():
            if m.name.endswith('.csv'):
                yield from csv.DictReader(io.TextIOWrapper(t.extractfile(m), encoding='utf-8', newline=''))

def main(src, team_csv, out):
    srs = {}
    for r in csv.DictReader(open(team_csv, encoding='utf-8')):
        end = int(r['SEASON'][:4]) + 1
        srs[(end, r['team'].replace('*', '').strip())] = float(r['srs'])
    files = sorted(f for f in os.listdir(src) if re.fullmatch(r'nbastats_\d{4}\.tar\.xz', f))
    result = {}
    for f in files:
        end = int(f[9:13]) + 1
        teams = sorted(v for (y, n), v in srs.items() if y == end)
        if not teams:
            continue
        lo, hi = teams[len(teams) // 3], teams[2 * len(teams) // 3]
        tier_of = {n: (0 if v <= lo else 2 if v >= hi else 1) for (y, n), v in srs.items() if y == end}
        name_of = {}  # team id -> full name
        game_teams = defaultdict(set)
        rows = []
        for r in season_rows(os.path.join(src, f)):
            tid = r['PLAYER1_TEAM_ID']
            if tid and r['PLAYER1_TEAM_CITY'] and r['PLAYER1_TEAM_NICKNAME']:
                city = {'LA': 'Los Angeles'}.get(r['PLAYER1_TEAM_CITY'], r['PLAYER1_TEAM_CITY'])
                name_of[tid] = f"{city} {r['PLAYER1_TEAM_NICKNAME']}"
                game_teams[r['GAME_ID']].add(tid)
            if r['EVENTMSGTYPE'] in ('1', '2', '3') and r['PLAYER1_NAME'] and tid:
                rows.append((r['GAME_ID'], tid, r['PLAYER1_NAME'], r['EVENTMSGTYPE'], (r['HOMEDESCRIPTION'] or '') + (r['VISITORDESCRIPTION'] or '')))
        acc = defaultdict(lambda: [[0] * 7 for _ in range(3)])  # per tier: fgm fga 3pm ftm fta pts games
        seen = set()
        for g, tid, name, typ, desc in rows:
            opp = [t for t in game_teams[g] if t != tid]
            if not opp:
                continue
            oname = name_of.get(opp[0])
            tier = tier_of.get(oname)
            if tier is None:
                continue
            a = acc[name][tier]
            if (name, g) not in seen:
                seen.add((name, g)); a[6] += 1
            three = '3PT' in desc
            if typ == '1':
                a[0] += 1; a[1] += 1; a[5] += 3 if three else 2
                if three: a[2] += 1
            elif typ == '2':
                a[1] += 1
            else:
                a[4] += 1
                if 'MISS' not in desc: a[3] += 1; a[5] += 1
        for name, v in acc.items():
            result[f'{name}|{end}'] = v
        missing = sorted({n for n in name_of.values() if n not in tier_of})
        print(f, len(acc), 'players; unmatched teams:', missing, file=sys.stderr, flush=True)
    json.dump(result, open(out, 'w'))

if __name__ == '__main__':
    main(*sys.argv[1:4])
