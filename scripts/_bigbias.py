# Bigs' TAL over APBR RAPM (reverse fit) by rebounds a game; plus r(TAL, RAPM).
import json,statistics as s,sys
R=[r for r in json.load(open(sys.argv[1])) if r.get('rapm') is not None]
x=[r['tal'] for r in R];y=[r['rapm'] for r in R];mx,my=s.mean(x),s.mean(y)
b=sum((a-mx)*(c-my) for a,c in zip(x,y))/sum((a-mx)**2 for a in x)
for r in R: r['res']=-(r['rapm']-my-b*(r['tal']-mx))/b
B=[r for r in R if r['pos'] in('C','PF')]
out=[]
for lo,hi in [(0,6),(6,9),(9,30)]:
  g=[r['res'] for r in B if lo<=r['reb']<hi]; out.append(f'reb {lo}-{hi} {s.mean(g):+.1f}')
print('r %.3f |'%s.correlation(x,y),' | '.join(out))
