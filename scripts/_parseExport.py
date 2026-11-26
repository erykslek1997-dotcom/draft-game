# 2026-11-26: the game's full draft export (text) -> JSON for the visual review page.
import re,json,sys
def parse(path):
  L=open(path).read().split('\n')
  sec=None;D={'seed':re.search(r'seed (\d+)',L[0]).group(1),'picks':[],'teams':[],'standings':[],'awards':[],'series':[],'champion':'','fmvp':''}
  team=None;rnd=None
  for l in L:
    if l.startswith('===='):
      sec=l.split('·')[0].strip('= ').strip() if '·' in l else l.strip('= ').strip(); continue
    if sec=='DRAFT':
      m=re.match(r'R(\d+) #\s*(\d+)\s+(\S+)\s+(?:\(YOU\) )?(.+?) (\d{4}-\d{2}) \((\w+)\) · ([\d.]+) caps(?: → played (\S+))?',l)
      if m: D['picks'].append(dict(r=int(m[1]),n=int(m[2]),code=m[3],name=m[4],span=m[5],pos=m[6],caps=float(m[7]),played=m[8]))
    elif sec=='TEAMS':
      m=re.match(r'#(\d+) (.+?) — overall (\d+) \(([\d.]+)\) · title (.+)$',l)
      if m:
        team=dict(rank=int(m[1]),name=m[2].replace(' (YOU)',''),you='(YOU)' in m[2],overall=float(m[4]),title=m[5],lines={},players=[]);D['teams'].append(team);continue
      if not team: continue
      if l.startswith('Talent ') and '·' in l: team['lines']['Talent']=l;continue
      m=re.match(r'^(Offense|Defense|Style|Fit inputs|Fit notes|Rotation notes): (.*)$',l)
      if m: team['lines'][m[1]]=m[2];continue
      m=re.match(r'^  (PG|SG|SF|PF|C) +(.+?) (\d{4}-\d{2}) \((\w+)\) · (\d+)m · TAL (\d+) (.+?) · O (\d+) / D (\d+) .*?SPC (\d+).*?· FGA ([\d.]+) · (.+?) · max',l)
      if m: team['players'].append(dict(slot=m[1],name=m[2],span=m[3],pos=m[4],min=int(m[5]),tal=int(m[6]),tier=m[7],o=int(m[8]),d=int(m[9]),spc=int(m[10]),caps=float(m[11]),roles=m[12]))
    elif sec=='REGULAR SEASON':
      m=re.match(r'\s*(\d+)\. (\S+)\s+(.+?) (\d+)-(\d+) · ([\d.]+) ([\d.]+) ([+-][\d.]+)',l)
      if m: D['standings'].append(dict(pl=int(m[1]),code=m[2],name=m[3].replace(' (YOU)',''),w=int(m[4]),l=int(m[5]),pf=float(m[6]),pa=float(m[7]),net=float(m[8])));continue
      m=re.match(r'  (MVP|DPOY|Sixth Man|ROY|MIP|All-NBA 1st|All-NBA 2nd|All-NBA 3rd|All-Defense 1st|All-Defensive 1st|Scoring title|Clutch[^:]*): (.+)$',l)
      if m: D['awards'].append([m[1],m[2]])
    elif sec=='PLAYOFFS':
      m=re.match(r'^(Quarterfinals|Semifinals|Finals):',l)
      if m: rnd=m[1];continue
      m=re.match(r'  \((\d+)\) (\S+) vs \((\d+)\) (\S+) · (\S+) wins (\d)-(\d) · expected margin ([+-][\d.]+) for (\S+)',l)
      if m and rnd: D['series'].append(dict(round=rnd,s1=int(m[1]),a=m[2],s2=int(m[3]),b=m[4],winner=m[5],w=int(m[6]),l=int(m[7]),exp=float(m[8]),fav=m[9]));continue
      m=re.match(r'Champion: (.+)$',l)
      if m: D['champion']=m[1]
      m=re.match(r'Finals MVP: (.+)$',l)
      if m: D['fmvp']=m[1]
  code={s['name']:s['code'] for s in D['standings']}
  for t in D['teams']: t['code']=code.get(t['name'],'')
  return D
out=[parse(p) for p in sys.argv[2:]]
open(sys.argv[1],'w').write(json.dumps(out,ensure_ascii=False))
for d in out: print(d['seed'],len(d['picks']),len(d['teams']),sum(len(t['players']) for t in d['teams']),len(d['standings']),len(d['series']),len(d['awards']),d['champion'])
