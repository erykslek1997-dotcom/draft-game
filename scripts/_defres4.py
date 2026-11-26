# Specialists by the engine's own O/D on OTHER windows (no shared seasons): TAL vs RAPM on the measured window.
import json,statistics as s,sys,re
R=[r for r in json.load(open(sys.argv[1])) if r.get('rd') is not None]
for r in R:
  m=re.match(r'(.*) (\d{4})-(\d{2})$',r['n']);r['p']=m.group(1);a=int(m.group(2));r['ys']=set(range(a+1,a+4))
by={}
for r in R: by.setdefault(r['p'],[]).append(r)
for r in R:
  o=[q for q in by[r['p']] if not (q['ys']&r['ys'])]
  r['oo']=s.mean(q['o'] for q in o) if o else None; r['od']=s.mean(q['d'] for q in o) if o else None
P=[r for r in R if r['oo'] is not None]
x=[r['rapm'] for r in P];y=[r['tal'] for r in P];mx,my=s.mean(x),s.mean(y)
b=sum((a-mx)*(c-my) for a,c in zip(x,y))/sum((a-mx)**2 for a in x)
def g(r):
  if r['oo']<50 and r['od']>=80: return 'spec D (O<50,D80+)'
  if r['oo']>=80 and r['od']<40: return 'spec O (O80+,D<40)'
  return 'rest'
for k in ['spec D (O<50,D80+)','rest','spec O (O80+,D<40)']:
  v=[r['tal']-my-b*(r['rapm']-mx) for r in P if g(r)==k]; print(f'{k:20s} n {len(v):4d} {s.mean(v):+.2f} ±{(s.stdev(v)/len(v)**.5):.2f}')
