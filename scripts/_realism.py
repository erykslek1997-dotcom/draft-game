# 2026-11-26 (the user: every value the engine reads, tuned against real NBA): for each team feature, how much it
# says about success beyond Overall — on real teams (SRS; playoff series 1997+) and in simulated leagues (margin;
# series). Standardised: the change in outcome z-score per feature z-score, holding Overall fixed.
# Where real and game disagree, the game's mechanics (or the Overall) weigh that feature wrong.
import json, sys, numpy as np
real=json.load(open(sys.argv[1])); sim=json.load(open(sys.argv[2]))
po={(p['season'],p['team']):p['seriesWins'] for p in json.load(open('src/data/playoffSeriesOutcomes.json'))}
feats=[k for k in sim[0] if k not in('league','winPct','margin','seriesWins','champion','ovr') and k in real[0]]
z=lambda v:(v-v.mean())/(v.std() or 1)
def beyond(rows,out,f,group=None):
    y=z(np.array([r[out] for r in rows],float)); o=z(np.array([r['ovr'] for r in rows],float)); x=np.array([r[f] for r in rows],float)
    if x.std()==0: return float('nan')
    X=np.c_[np.ones(len(rows)),o,z(x)]; return np.linalg.lstsq(X,y,rcond=None)[0][2]
def alone(rows,out,f):
    x=np.array([r[f] for r in rows],float); y=np.array([r[out] for r in rows],float)
    return float('nan') if x.std()==0 else np.corrcoef(x,y)[0,1]
rp=[dict(r,seriesWins=po[(r['end'],r['team'])]) for r in real if (r['end'],r['team']) in po]
modern=[r for r in real if r['end']>=2010]
sp=[r for r in sim if r['seriesWins']>0 or True]
print(f"real teams {len(real)} (2010+: {len(modern)}), real playoff teams {len(rp)}, simulated teams {len(sim)} in {len(set(r['league'] for r in sim))} leagues")
print(f"{'feature':14} {'r SRS':>6} {'r game':>6} | beyond Overall: {'SRS':>6} {'SRS10+':>6} {'game':>6} | {'series':>6} {'g.ser':>6}")
for f in feats:
    a=[alone(real,'srs',f),alone(sim,'margin',f),beyond(real,'srs',f),beyond(modern,'srs',f),beyond(sim,'margin',f),beyond(rp,'seriesWins',f),beyond(sim,'seriesWins',f)]
    flag=' <-' if abs(a[3]-a[4])>0.08 or abs(a[5]-a[6])>0.10 else ''
    print(f"{f:14} {a[0]:6.2f} {a[1]:6.2f} | {'':15} {a[2]:+6.2f} {a[3]:+6.2f} {a[4]:+6.2f} | {a[5]:+6.2f} {a[6]:+6.2f}{flag}")
print(f"\nOverall vs outcome: real SRS r {np.corrcoef([r['ovr'] for r in real],[r['srs'] for r in real])[0,1]:.3f}, game margin r {np.corrcoef([r['ovr'] for r in sim],[r['margin'] for r in sim])[0,1]:.3f}")
