"""
2026-11-11: is padding stats against weak teams a trait of the player, or noise? For each
player-season (from pbp_opponent_split.py) the gap between his true shooting and his points a game
against the weakest third of the league and the strongest third, then the correlation of that gap
between the same player's consecutive seasons (enough shots in both tiers in both seasons). A trait
shows as a clearly positive correlation; noise as ~0. Also lists the biggest steady "bullies" and
"risers" over 3+ seasons.

  python3 -I scripts/py/opponent_split_persistence.py <split_all.json>
"""
import json, sys, math
from collections import defaultdict

MIN_FGA = 150

def ts(t):
    fgm, fga, tpm, ftm, fta, pts, g = t
    d = 2 * (fga + 0.44 * fta)
    return pts / d if d else None

def corr(xs, ys):
    n = len(xs)
    mx, my = sum(xs) / n, sum(ys) / n
    sxy = sum((x - mx) * (y - my) for x, y in zip(xs, ys))
    sx = math.sqrt(sum((x - mx) ** 2 for x in xs)); sy = math.sqrt(sum((y - my) ** 2 for y in ys))
    return sxy / (sx * sy) if sx and sy else float('nan')

data = json.load(open(sys.argv[1]))
gap = {}
for k, tiers in data.items():
    weak, mid, strong = tiers
    if weak[1] < MIN_FGA or strong[1] < MIN_FGA or not weak[6] or not strong[6]:
        continue
    gap[k] = (ts(weak) - ts(strong), weak[5] / weak[6] - strong[5] / strong[6])
league_ts = [v[0] for v in gap.values()]
league_pts = [v[1] for v in gap.values()]
print(f'player-seasons {len(gap)}: mean TS gap (weak minus strong) {sum(league_ts)/len(league_ts):+.3f}, mean points gap {sum(league_pts)/len(league_pts):+.2f}')
pairs_ts, pairs_pts = ([], []), ([], [])
by_player = defaultdict(list)
for k, v in gap.items():
    name, y = k.rsplit('|', 1)
    by_player[name].append((int(y), v))
    nxt = gap.get(f'{name}|{int(y) + 1}')
    if nxt:
        pairs_ts[0].append(v[0]); pairs_ts[1].append(nxt[0])
        pairs_pts[0].append(v[1]); pairs_pts[1].append(nxt[1])
print(f'consecutive pairs {len(pairs_ts[0])}: year-to-year correlation of the TS gap {corr(*pairs_ts):+.3f}, of the points gap {corr(*pairs_pts):+.3f}')
steady = []
for name, seasons in by_player.items():
    if len(seasons) < 3:
        continue
    t = sum(v[0] for _, v in seasons) / len(seasons); p = sum(v[1] for _, v in seasons) / len(seasons)
    steady.append((p, t, len(seasons), name))
steady.sort()
print('biggest risers (score more against strong teams):', ', '.join(f'{n} {p:+.1f} pts/{t:+.3f} TS ({k})' for p, t, k, n in steady[:8]))
print('biggest bullies (score more against weak teams):', ', '.join(f'{n} {p:+.1f} pts/{t:+.3f} TS ({k})' for p, t, k, n in steady[-8:][::-1]))
