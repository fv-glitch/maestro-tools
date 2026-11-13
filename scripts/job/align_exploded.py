import sys,re
import os; sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from steps_table import extract
door,jamb,leg=sys.argv[1],sys.argv[2],sys.argv[3]   # leg: RH (jamb y>=-10) or LH
import zipfile
z=zipfile.ZipFile(door); DX1=float(re.search(r'<a:Length>([^<]*)</a:Length>', z.read([n for n in z.namelist() if n.endswith('.xml')][0]).decode()).group(1))
D=[r for r in extract(door) if not r[0].startswith('X')]; Jr=[r for r in extract(jamb) if not r[0].startswith('X')]
def rng(r):
    m=re.match(r'x(\S+)\.\.(\S+) y(\S+)\.\.(\S+)',r[7]); return tuple(float(v) for v in m.groups())
onleg=lambda r: (rng(r)[2]>-15) if leg=='RH' else (rng(r)[2]<-15)
dh=sorted(rng(r)[0] for r in D if 'hinge' in r[1].lower() and r[0]=='ClosedPocket')
jh=sorted(rng(r)[0]-38 for r in Jr if r[0]=='ClosedPocket' and abs(rng(r)[1]-rng(r)[0]-89.2)<0.01 and onleg(r))
ds=sorted(rng(r)[0] for r in D if 'HingeHole' in r[1])
js=sorted(rng(r)[0]-38 for r in Jr if r[0]=='RoundHole' and onleg(r))
print('  hinge pockets door', dh); print('  hinge pockets jamb', jh, 'MATCH' if dh==[round(x,2) for x in jh] or all(abs(a-b)<0.01 for a,b in zip(dh,jh)) and len(dh)==len(jh) else 'DIFF')
print('  screws match' if len(ds)==len(js) and all(abs(a-b)<0.01 for a,b in zip(ds,js)) else f'  screws DIFF {ds} {js}', len(ds), len(js))
# latch(es): door Back-plane drill-outs (world X = 2200 - plane x centre); jamb strikes: Top pockets d16.5
dl=sorted(round(DX1-(rng(r)[0]+rng(r)[1])/2,2) for r in D if r[3]=='Back' and r[4]=='85')
st=sorted(round((rng(r)[0]+rng(r)[1])/2-38,2) for r in Jr if r[0]=='ClosedPocket' and r[4]=='16.5')
print('  latch/lock door', dl, ' strikes jamb', st, 'MATCH' if dl==st else 'DIFF')
