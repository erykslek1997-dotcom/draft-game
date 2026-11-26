# 2026-11-26 (the user: spacing): does the five's spacing add to the judge beyond Overall? Also beside talent alone.
import json, sys, numpy as np
for f in sys.argv[1:]:
    R=json.load(open(f)); y=np.array([r['srs'] for r in R]); o=np.array([r['ovr'] for r in R]); sp=np.array([r['spacing'] for r in R],float); t=np.array([r['talent'] for r in R],float); off=np.array([r['offense'] for r in R],float)
    def fit(cols):
        B=np.c_[np.ones(len(R)),*cols]; c=np.linalg.lstsq(B,y,rcond=None)[0]; return c, np.corrcoef(B@c,y)[0,1]
    c,r=fit([o,sp]); print(f.split('/')[-1], 'n',len(R), f"r(ovr) {np.corrcoef(o,y)[0,1]:.3f}  ovr+spacing {r:.3f}  spacing worth {c[2]/c[1]:+.3f} Overall per spacing point")
    c,r=fit([t,sp]); print(f"   talent {np.corrcoef(t,y)[0,1]:.3f}  talent+spacing {r:.3f}   r(spacing,srs) {np.corrcoef(sp,y)[0,1]:.3f}  r(spacing,talent) {np.corrcoef(sp,t)[0,1]:.3f}  spacing sd {sp.std():.1f}")
    for lo,hi in [(0,50),(50,70),(70,85),(85,101)]:
        m=(sp>=lo)&(sp<hi)
        if m.sum()>5: res=y[m]-np.polyval(np.polyfit(o,y,1),o[m]); print(f"   spacing {lo}-{hi}: n {m.sum():3d}  SRS left over vs Overall {res.mean():+.2f}")
