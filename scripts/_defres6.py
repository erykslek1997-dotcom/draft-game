# Reverse fit: net RAPM on TAL; groups by engine O/D on OTHER windows. Overrated group = RAPM BELOW the line.
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
g=lambda r:'spec D' if r['oo']<50 and r['od']>=80 else 'spec O' if r['oo']>=80 and r['od']<40 else 'rest'
x=[r['tal'] for r in P];y=[r['rapm'] for r in P];mx,my=s.mean(x),s.mean(y)
b=sum((a-mx)*(c-my) for a,c in zip(x,y))/sum((a-mx)**2 for a in x)
out=[]
for k in ['spec D','rest','spec O']:
  v=[r['rapm']-my-b*(r['tal']-mx) for r in P if g(r)==k]; out.append(f'{k} {s.mean(v):+.2f}±{s.stdev(v)/len(v)**.5:.2f} RAPM (= {-s.mean(v)/b:+.1f} TAL)')
print('slope %.3f |'%b,' | '.join(out))
