# 2026-11-28 (the user: "nie masz jak odtworzyć RAPM?"): every five-man lineup of every team-season from pbpstats
# (api.pbpstats.com, Darryl Blackport), 2000-01 .. 2025-26 — player ids, possessions both ways, points both ways —
# for a lineup-level ridge RAPM. Writes src/data/raw/pbpLineups/<season>-<teamId>.json (only those fields).
import json, os, sys, time, urllib.request, concurrent.futures as cf
OUT = os.environ.get('OUT') or os.path.join(os.path.dirname(__file__), '..', 'src', 'data', 'raw', 'pbpLineups')
os.makedirs(OUT, exist_ok=True)
teams = [t['id'] for t in json.load(urllib.request.urlopen('https://api.pbpstats.com/get-teams/nba', timeout=90))['teams']]
seasons = [f"{y}-{str(y + 1)[2:]}" for y in range(int(os.environ.get("FROM", 2000)), 2026)]
def job(s, t):
    f = os.path.join(OUT, f"{s}-{t}.json")
    if os.path.exists(f): return 'skip'
    url = f"https://api.pbpstats.com/get-totals/nba?Season={s}&SeasonType=Regular%20Season&Type=Lineup&TeamId={t}"
    for k in range(4):
        try:
            d = json.load(urllib.request.urlopen(url, timeout=240))
            rows = [[r['EntityId'], r.get('OffPoss', 0), r.get('DefPoss', 0), r.get('Points', 0), r.get('OpponentPoints', 0)] for r in d.get('multi_row_table_data', [])]
            if rows: json.dump(rows, open(f, 'w')); return len(rows)
            return 'empty'
        except Exception as e:
            time.sleep(5 * (k + 1))
    return 'fail'
with cf.ThreadPoolExecutor(int(sys.argv[1]) if len(sys.argv) > 1 else 4) as ex:
    futs = {ex.submit(job, s, t): (s, t) for s in seasons for t in teams}
    done = 0
    for fu in cf.as_completed(futs):
        done += 1
        if done % 50 == 0: print(done, '/', len(futs), flush=True)
print('done')
