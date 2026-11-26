# 2026-11-26 (the user: threat from the arc opens the rim): real playoff teams 1997+ — do the engine's team spacing,
# rim pressure and their product predict series wins beyond Overall? And regular-season SRS the same way.
import json, sys, numpy as np
R=json.load(open(sys.argv[1])); po={(p['season'],p['team']):p['seriesWins'] for p in json.load(open('src/data/playoffSeriesOutcomes.json'))}
for lo in (1997, 2010):
    S=[r for r in R if r['end']>=lo and (r['end'],r['team']) in po]
    y=np.array([po[(r['end'],r['team'])] for r in S],float); o=np.array([r['ovr'] for r in S]); srs=np.array([r['srs'] for r in S])
    sp=np.array([r['spacing'] for r in S],float); rim=np.array([r['rim'] for r in S],float)
    z=lambda v:(v-v.mean())/v.std(); spz,rz=z(sp),z(rim)
    def ols(cols,yy=y):
        X=np.c_[np.ones(len(S)),*cols]; c=np.linalg.lstsq(X,yy,rcond=None)[0]; return c, np.corrcoef(X@c,yy)[0,1]
    print(f'from {lo}: playoff teams {len(S)}')
    for name,cols in [('Overall',[o]),('+ spacing',[o,spz]),('+ rim',[o,rz]),('+ spacing + rim',[o,spz,rz]),('+ spacing + rim + spacing*rim',[o,spz,rz,spz*rz]),('+ min(spacing,rim)',[o,np.minimum(spz,rz)])]:
        c,r=ols(cols); print(f'  series wins ~ {name:30} r {r:.3f}  coefs {" ".join(f"{v:+.3f}" for v in c[1:])}')
    c,r=ols([o]); res=y-(c[0]+c[1]*o)
    for a,b in [('low','low'),('low','high'),('high','low'),('high','high')]:
        m=((sp<np.median(sp)) if a=='low' else (sp>=np.median(sp)))&((rim<np.median(rim)) if b=='low' else (rim>=np.median(rim)))
        print(f'  spacing {a:4} rim {b:4}: n {m.sum():3d}  series wins left over vs Overall {res[m].mean():+.3f}')
