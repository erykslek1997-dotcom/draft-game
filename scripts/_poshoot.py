# 2026-11-26 (the user: how did teams that went deep in the playoffs shoot?): playoff teams 1997+, their
# three-point attempt rate and true shooting against the league that season, by series won; and whether
# shooting predicts series wins beyond the team's SRS.
import csv, json, sys, numpy as np
rows=list(csv.DictReader(open('src/data/raw/bbref/team_advanced.csv')))
po={(p['season'],p['team']):p['seriesWins'] for p in json.load(open('src/data/playoffSeriesOutcomes.json'))}
by={}
for r in rows:
    if r['team']=='League Average' or not r['fg3a_per_fga_pct']: continue
    by.setdefault(r['SEASON'],[]).append(r)
T=[]
for s,L in by.items():
    end=int(s[:4])+1
    a=np.array([float(r['fg3a_per_fga_pct']) for r in L]); t=np.array([float(r['ts_pct']) for r in L])
    for r,x,y in zip(L,a,t):
        k=(end,r['team'].rstrip('*'))
        if k not in po: continue
        T.append(dict(end=end,team=k[1],sw=po[k],srs=float(r['srs']),r3=(x-a.mean())/a.std(),ts=(y-t.mean())/t.std(),rank3=int((a>x).sum())+1,n=len(L)))
print('playoff teams', len(T), 'seasons', min(t['end'] for t in T), '-', max(t['end'] for t in T))
for lo in (1997,2010):
    S=[t for t in T if t['end']>=lo]
    print(f'\nfrom {lo}: n {len(S)}')
    for sw,lab in [(4,'champion'),(3,'lost finals'),(2,'conf finals'),(1,'2nd round'),(0,'1st round out')]:
        g=[t for t in S if t['sw']==sw]
        if g: print(f"  {lab:14} n {len(g):3}  3PA rate z {np.mean([t['r3'] for t in g]):+.2f} (rank {np.median([t['rank3'] for t in g]):.0f}/30)  TS z {np.mean([t['ts'] for t in g]):+.2f}  SRS {np.mean([t['srs'] for t in g]):+.1f}")
    y=np.array([t['sw'] for t in S],float)
    def ols(cols):
        X=np.c_[np.ones(len(S)),*cols]; c=np.linalg.lstsq(X,y,rcond=None)[0]; return c, np.corrcoef(X@c,y)[0,1]
    srs=np.array([t['srs'] for t in S]); r3=np.array([t['r3'] for t in S]); ts=np.array([t['ts'] for t in S])
    for name,cols in [('SRS',[srs]),('SRS + 3PA rate',[srs,r3]),('SRS + TS',[srs,ts]),('SRS + 3PA rate + TS',[srs,r3,ts])]:
        c,r=ols(cols); print(f"  series wins ~ {name:20} r {r:.3f}  coef {' '.join(f'{v:+.3f}' for v in c[1:])}")
    lowest=[t for t in S if t['rank3']>=25 and t['sw']>=3]
    print('  finalists with a bottom-6 three-point rate:', ', '.join(f"{t['end']} {t['team']}" for t in lowest) or 'none')
