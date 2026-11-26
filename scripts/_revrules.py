# 2026-11-26: each review rule on real teams — how often it fires and what the judge says beside the rest of Overall.
import json, sys, numpy as np
for f in sys.argv[1:]:
    R=json.load(open(f)); y=np.array([r['srs'] for r in R]); o=np.array([r['ovr'] for r in R])
    print(f.split('/')[-1], 'n', len(R))
    for k in [k for k in R[0] if k.startswith('rev_')]:
        x=np.array([r[k] for r in R],float)
        if x.std()==0: print(f"  {k:22} never"); continue
        B=np.c_[np.ones(len(R)),o,x]; c=np.linalg.lstsq(B,y,rcond=None)[0]
        # the engine charges W*hit (minus sign for penalties); c[2]/c[1] = Overall points the data wants per hit
        print(f"  {k:22} fires {np.mean(x!=0)*100:5.1f}%  data wants {c[2]/c[1]:+6.2f} Overall per hit")
