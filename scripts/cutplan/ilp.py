"""Exact-ish two-stage guillotine plan: strip patterns enumerated, sheets as an ILP (HiGHS)."""
import json, sys, itertools, pulp
from plan import SHEET_L, SHEET_W, TRIM, KERF, NARROW, strip_cap, sheet_cap

def solve(parts, T, max_sheets=None, time_limit=120):
    types = {}
    for p in parts:
        if p['T'] != T: continue
        L, W = p['L'], p['W']
        opts = set()
        for across, along in ((W, L), (L, W)):
            if min(L, W) < NARROW and across != min(L, W): continue        # narrow pieces run along their strip
            if along <= strip_cap(1) and across <= sheet_cap(1): opts.add((across, along))
        key = (max(L, W), min(L, W))
        t = types.setdefault(key, {'d': 0, 'opts': set(), 'ids': []})
        t['d'] += p['qty']; t['opts'] |= {(a if (L, W) == key or True else a, al) for a, al in opts}
        t['ids'] += [(p['id'], L, W, p['names'][0])] * p['qty']
    for t in types.values(): t['opts'] = sorted(t['opts'])
    widths = sorted({a for t in types.values() for a, _ in t['opts']})
    # strip patterns per width: multisets of (id) with along lengths fitting, bounded by demand
    patterns = []
    for w in widths:
        items = [(i, al) for i, t in types.items() for a, al in t['opts'] if a == w]
        def rec(k, used, n, length, cnt):
            if k == len(items):
                if n: patterns.append((w, dict(cnt)))
                return
            i, al = items[k]
            maxc = types[i]['d']
            c = 0
            while True:
                if c: 
                    if length + al * c > strip_cap(n + c) + 1e-9 or c > maxc: break
                cnt2 = dict(cnt); 
                if c: cnt2[i] = c
                rec(k + 1, used, n + c, length + al * c, cnt2)
                c += 1
        rec(0, None, 0, 0.0, {})
    # keep only maximal patterns (nothing more fits) - smaller ones are dominated
    def can_add(w, cnt):
        n = sum(cnt.values()); length = sum(c * dict(types[i]['opts'])[w] if False else c * next(al for a, al in types[i]['opts'] if a == w) for i, c in cnt.items())
        for i, t in types.items():
            for a, al in t['opts']:
                if a == w and cnt.get(i, 0) < t['d'] and length + al <= strip_cap(n + 1) + 1e-9: return True
        return False
    patterns = [p for p in patterns if not can_add(*p)]
    print(f'T{T}: {len(types)} types, widths {widths}, {len(patterns)} maximal strip patterns', file=sys.stderr)
    K = max_sheets or 12
    m = pulp.LpProblem('cut', pulp.LpMinimize)
    y = [pulp.LpVariable(f'y{j}', 0, cat='Integer') for j in range(len(patterns))]
    u = [pulp.LpVariable(f'u{k}', cat='Binary') for k in range(K)]
    x = {(k, w): pulp.LpVariable(f'x{k}_{wi}', 0, cat='Integer') for k in range(K) for wi, w in enumerate(widths)}
    # objective: sheets first, then strips (handling); later sheets cost slightly more so the last sheet is the emptiest
    m += pulp.lpSum((10000 + k) * u[k] for k in range(K)) + pulp.lpSum(y) * 10 - pulp.lpSum((K - k) * 0.0001 * w * x[k, w] for k in range(K) for w in widths)
    for i, t in types.items():
        m += pulp.lpSum(y[j] * p[1].get(i, 0) for j, p in enumerate(patterns)) >= t['d']
    for w in widths:
        m += pulp.lpSum(x[k, w] for k in range(K)) == pulp.lpSum(y[j] for j, p in enumerate(patterns) if p[0] == w)
    for k in range(K):
        # strips + one kerf each + the closing kerf + trims
        m += pulp.lpSum(x[k, w] * (w + KERF) for w in widths) <= (SHEET_W - 2 * TRIM - KERF) * u[k]
        if k: m += u[k] <= u[k - 1]
    m.solve(pulp.PULP_CBC_CMD(msg=0, timeLimit=time_limit))
    print('status', pulp.LpStatus[m.status], 'sheets', sum(round(v.value()) for v in u), 'strips', sum(round(v.value()) for v in y), file=sys.stderr)
    # assemble: strips with pieces, then distribute strips into sheets per x
    strips_by_w = {w: [] for w in widths}; need = {i: t['d'] for i, t in types.items()}
    for j, p in enumerate(patterns):
        for _ in range(round(y[j].value())):
            pcs = []
            for i, c in p[1].items():
                take = min(c, need[i]); need[i] -= take
                al = next(al for a, al in types[i]['opts'] if a == p[0])
                for _ in range(take):
                    pid, L, W, nm = types[i]['ids'].pop(0)
                    pcs.append({'id': pid, 'L': L, 'W': W, 'name': nm, 'across': p[0], 'along': al, 'turned': p[0] != W})
            if pcs: strips_by_w[p[0]].append({'w': p[0], 'pieces': sorted(pcs, key=lambda q: -q['along'])})
    sheets = []
    for k in range(K):
        if round(u[k].value()) == 0: continue
        sh = []
        for w in widths:
            for _ in range(round(x[k, w].value())):
                if strips_by_w[w]: sh.append(strips_by_w[w].pop(0))
        if sh: sheets.append(sorted(sh, key=lambda s: (s['w'] < NARROW, -s['w'])))
    assert all(v == 0 for v in need.values()) and not any(strips_by_w.values()), (need, strips_by_w)
    sheets.sort(key=lambda sh: sum(s['w'] for s in sh), reverse=True)
    used = sum(k[0] * k[1] * t['d'] for k, t in types.items())
    return {'T': T, 'pieces': sum(t['d'] for t in types.values()), 'strips': sum(len(s) for s in sheets), 'sheets': sheets,
            'yield': used / (len(sheets) * SHEET_L * SHEET_W)}

if __name__ == '__main__':
    from plan import show
    parts = json.load(open(sys.argv[1]))['parts']
    out = {}
    for T in (18, 9):
        r = solve(parts, T); show({**r, 'turned': []}); out[T] = r
    json.dump({'sheet': [SHEET_L, SHEET_W], 'trim': TRIM, 'kerf': KERF, 'narrow': NARROW, 'plans': out}, open('plan.json', 'w'), indent=1)
