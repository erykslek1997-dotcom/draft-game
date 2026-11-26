# D-TAL vs D-RAPM (and O-TAL vs O-RAPM), groups by the engine's O/D on the player's OTHER windows.
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
def g(r):
  if r['oo']<50 and r['od']>=80: return 'spec D'
  if r['oo']>=80 and r['od']<40: return 'spec O'
  return 'rest'
for xk,yk in [('rd','d'),('ro','o')]:
  x=[r[xk] for r in P];y=[r[yk] for r in P];mx,my=s.mean(x),s.mean(y)
  b=sum((a-mx)*(c-my) for a,c in zip(x,y))/sum((a-mx)**2 for a in x)
  print(f'{yk} ~ {xk}: r {s.correlation(x,y):.3f}',' '.join(f"{k} {s.mean(r[yk]-my-b*(r[xk]-mx) for r in P if g(r)==k):+.1f}" for k in ['spec D','rest','spec O']))
# reverse fit (D-RAPM on D-TAL): a real bias shows as specialists' D-RAPM BELOW the line too
for xk,yk in [('d','rd'),('o','ro')]:
  x=[r[xk] for r in P];y=[r[yk] for r in P];mx,my=s.mean(x),s.mean(y)
  b=sum((a-mx)*(c-my) for a,c in zip(x,y))/sum((a-mx)**2 for a in x)
  print(f'reverse {yk} ~ {xk}:',' '.join(f"{k} {s.mean(r[yk]-my-b*(r[xk]-mx) for r in P if g(r)==k):+.2f}" for k in ['spec D','rest','spec O']))
