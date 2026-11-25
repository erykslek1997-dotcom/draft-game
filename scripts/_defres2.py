# TAL vs RAPM, players grouped by their RAPM profile (D-RAPM minus O-RAPM, top/bottom 10%) — independent of the engine.
import json,statistics as s,sys
R=[r for r in json.load(open(sys.argv[1])) if r.get('rd') is not None]
x=[r['rapm'] for r in R];y=[r['tal'] for r in R];mx,my=s.mean(x),s.mean(y)
b=sum((a-mx)*(c-my) for a,c in zip(x,y))/sum((a-mx)**2 for a in x)
gap=sorted(r['rd']-r['ro'] for r in R);lo,hi=gap[len(gap)//10],gap[-len(gap)//10]
g=lambda r:'Dprof' if r['rd']-r['ro']>=hi else 'Oprof' if r['rd']-r['ro']<=lo else 'mid'
out={k:s.mean(r['tal']-my-b*(r['rapm']-mx) for r in R if g(r)==k) for k in ['Dprof','mid','Oprof']}
print('r %.3f'%s.correlation(x,y),' '.join(f'{k} {v:+.2f}' for k,v in out.items()))
