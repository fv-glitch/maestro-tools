import sys
import os; sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from steps_table import extract
his=extract(sys.argv[1]); mine=extract(sys.argv[2])
H=[r for r in his if not r[0].startswith('X')]; M=[r for r in mine if not r[0].startswith('X')]
key=lambda r:(r[0],r[3] if not r[3].startswith('gen') and 'Generated' not in r[3] else 'gen',r[7])
mk={}
for r in M: mk.setdefault(key(r),[]).append(r)
used=set()
print('order:', ' > '.join(('['+r[1]+']') if r[0].startswith('X') else r[1].split('-')[0] for r in his))
for r in H:
    c=mk.get(key(r),[])
    c=[x for x in c if id(x) not in used]
    if not c: print('  NEW  ', r); continue
    m=c[0]; used.add(id(m))
    d=[(n,a,b) for n,a,b in zip(['depth','dia','tool'],r[4:7],m[4:7]) if str(a)!=str(b)]
    if d: print('  CHG  ', r[1][:45], r[3][:6], r[7], '; '.join(f'{n} {b}->{a}' for n,a,b in d))
for r in M:
    if id(r) not in used: print('  GONE ', r)
