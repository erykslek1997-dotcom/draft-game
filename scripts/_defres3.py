# TAL vs RAPM by profile, the profile read from the player's OTHER windows (no shared seasons) — no selection on the measured window's noise.
import json,statistics as s,sys,re
R=[r for r in json.load(open(sys.argv[1])) if r.get('rd') is not None]
for r in R:
  m=re.match(r'(.*) (\d{4})-(\d{2})$',r['n']);r['p']=m.group(1);a=int(m.group(2));r['ys']=set(range(a+1,a+4))
by={}
for r in R: by.setdefault(r['p'],[]).append(r)
for r in R:
  o=[q for q in by[r['p']] if not (q['ys']&r['ys'])]
  r['prof']=s.mean(q['rd']-q['ro'] for q in o) if o else None
P=[r for r in R if r['prof'] is not None]
x=[r['rapm'] for r in P];y=[r['tal'] for r in P];mx,my=s.mean(x),s.mean(y)
b=sum((a-mx)*(c-my) for a,c in zip(x,y))/sum((a-mx)**2 for a in x)
gap=sorted(r['prof'] for r in P);lo,hi=gap[len(gap)//10],gap[-len(gap)//10]
g=lambda r:'Dprof' if r['prof']>=hi else 'Oprof' if r['prof']<=lo else 'mid'
out={k:(s.mean(r['tal']-my-b*(r['rapm']-mx) for r in P if g(r)==k),sum(1 for r in P if g(r)==k)) for k in ['Dprof','mid','Oprof']}
print('n %d r %.3f'%(len(P),s.correlation(x,y)),' '.join(f'{k} {v:+.2f} (n {n})' for k,(v,n) in out.items()))
