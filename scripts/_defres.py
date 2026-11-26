import json,statistics as s,sys
R=json.load(open(sys.argv[1]))
P=[r for r in R if r['rapm'] is not None]
x=[r['rapm'] for r in P];y=[r['tal'] for r in P];mx,my=s.mean(x),s.mean(y)
b=sum((a-mx)*(c-my) for a,c in zip(x,y))/sum((a-mx)**2 for a in x)
g=lambda r:'D' if r['d']-r['o']>=30 else 'S' if r['o']-r['d']>=30 else 'B'
out={k:s.mean(r['tal']-my-b*(r['rapm']-mx) for r in P if g(r)==k) for k in 'DBS'}
print('r(TAL,RAPM) %.3f'%s.correlation(x,y),' '.join(f'{k} {v:+.2f}' for k,v in out.items()))
