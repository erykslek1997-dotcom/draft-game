import json, sys, numpy as np
for f in sys.argv[1:]:
    R=json.load(open(f)); keys=[k for k in R[0] if k not in('srs','ovr','spacing')]
    X=np.array([[r[k] for k in keys] for r in R],float); y=np.array([r['srs'] for r in R]); o=np.array([r['ovr'] for r in R])
    A=np.c_[np.ones(len(R)),X]; cf=np.linalg.lstsq(A,o,rcond=None)[0]; w=cf[1:]
    print(f.split('/')[-1], 'n',len(R),'r(ovr)',round(np.corrcoef(o,y)[0,1],3), 'ovr rebuilt r', round(np.corrcoef(A@cf,o)[0,1],4))
    print(f"{'part':10} {'weight':>7} {'sd*w':>6} {'r(srs)':>7} {'r w/o':>6} {'best x':>7}")
    for i,k in enumerate(keys):
        if X[:,i].std()==0: print(f"{k:10} const"); continue
        wo=o-w[i]*X[:,i]
        B=np.c_[np.ones(len(R)),wo,X[:,i]]; c=np.linalg.lstsq(B,y,rcond=None)[0]; bw=(c[2]/c[1])/w[i] if abs(w[i])>1e-9 else float('nan')
        print(f"{k:10} {w[i]:7.3f} {w[i]*X[:,i].std():6.2f} {np.corrcoef(X[:,i],y)[0,1]:7.3f} {np.corrcoef(wo,y)[0,1]:6.3f} {bw:7.2f}")
    C=np.corrcoef(X.T)
    pairs=sorted([(abs(C[i,j]),keys[i],keys[j],C[i,j]) for i in range(len(keys)) for j in range(i+1,len(keys)) if not np.isnan(C[i,j])],reverse=True)[:10]
    print('top correlated parts:', ', '.join(f"{a}-{b} {c:.2f}" for _,a,b,c in pairs)); print()
