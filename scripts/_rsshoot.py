# 2026-11-26: real NBA since 2010 — where the regular season's best teams sat by three-point rate and by shooting.
import csv, numpy as np
rows=[r for r in csv.DictReader(open('src/data/raw/bbref/team_advanced.csv')) if r['team']!='League Average' and r['fg3a_per_fga_pct']]
by={}
for r in rows: by.setdefault(r['SEASON'],[]).append(r)
top3=[];bot=0;n=0;top8bot=0;n8=0
for s,L in by.items():
    if int(s[:4])+1<2010: continue
    L=sorted(L,key=lambda r:-float(r['wins'])/(float(r['wins'])+float(r['losses'])))
    a=sorted(float(r['fg3a_per_fga_pct']) for r in L); N=len(L)
    rank=lambda r: a.index(float(r['fg3a_per_fga_pct']))+1  # 1 = fewest threes
    for r in L[:3]: n+=1; bot+= rank(r)<=round(N*0.2); top3.append(rank(r)/N)
    for r in L[:8]: n8+=1; top8bot+= rank(r)<=round(N*0.2)
print(f'top-3 records since 2010: {n}, in the bottom 20% by 3PA rate {bot} ({100*bot/n:.0f}%); top-8: {top8bot}/{n8} ({100*top8bot/n8:.0f}%); median 3PA percentile of top-3 {np.median(top3)*100:.0f}')
