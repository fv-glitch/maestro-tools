"""Two-stage guillotine cut plan for the window wall on the M100 saw (E015, 3.15 kerf).
Stage 1: rip full-length strips along the sheet's 2400 (cuts run off both ends).
Stage 2: crosscut each strip on its own against the stops (cuts run off both sides).
Every strip holds pieces of exactly its width (no third stage). Pieces may be turned (no grain).
Strips narrower than NARROW can't sit on pods: they come off the sheet as one block for the table saw."""
import json, itertools, random, sys
SHEET_L, SHEET_W, TRIM, KERF, NARROW = 2400.0, 1200.0, 5.0, 3.15, 100.0

def strip_cap(n): return SHEET_L - 2 * TRIM - (n + 1) * KERF
def sheet_cap(n): return SHEET_W - 2 * TRIM - (n + 1) * KERF

def binpack(items, size, cap, tries=300, seed=1):
    """1D bin packing (lengths with a kerf per item): best of FFD/BFD over shuffled tie orders"""
    rnd = random.Random(seed); best = None
    for t in range(tries):
        order = sorted(items, key=lambda q: (-size(q), rnd.random() if t else 0))
        if t > tries // 2: rnd.shuffle(order); order.sort(key=lambda q: -size(q) // 50)
        bins = []
        for q in order:
            fits = [b for b in bins if sum(map(size, b)) + size(q) <= cap(len(b) + 1) + 1e-9]
            if fits: (min if t % 2 else lambda f, key: f[0])(fits, key=lambda b: cap(len(b) + 1) - sum(map(size, b))).append(q)
            else: bins.append([q])
        # objective: fewest bins, then the emptiest last bin (more usable offcut)
        score = (len(bins), -max(cap(len(b)) - sum(map(size, b)) for b in bins))
        if best is None or score < best[0]: best = (score, bins)
    return best[1]

def pieces(parts, T):
    return [{'id': p['id'], 'L': p['L'], 'W': p['W'], 'name': p['names'][0]} for p in parts if p['T'] == T for _ in range(p['qty'])]

def layout(ps, turn, tries):
    cls = {}
    for p in ps:
        t = p['id'] in turn
        across, along = (p['L'], p['W']) if t else (p['W'], p['L'])
        cls.setdefault(across, []).append({**p, 'across': across, 'along': along, 'turned': t})
    strips = []
    for w, g in cls.items():
        if any(q['along'] > strip_cap(1) for q in g) or w > sheet_cap(1): return None
        strips += [{'w': w, 'pieces': sorted(b, key=lambda q: -q['along'])} for b in binpack(g, lambda q: q['along'], strip_cap, tries=tries)]
    sheets = binpack(strips, lambda s: s['w'], sheet_cap, tries=tries)
    # fewest sheets, then fewest strips (handling), then the biggest leftover on the last sheet
    spare = max(sheet_cap(len(sh)) - sum(s['w'] for s in sh) for sh in sheets)
    return (len(sheets), len(strips), -spare), sheets

def plan(parts, T, seed=1):
    ps = pieces(parts, T); rnd = random.Random(seed)
    ids = sorted({p['id'] for p in ps})
    dims = {p['id']: (p['L'], p['W']) for p in ps}
    # narrow pieces always run along their strip (across = the small side): they can't sit on pods
    free = [i for i in ids if min(dims[i]) >= NARROW and dims[i][0] != dims[i][1]]
    turn = {i for i in ids if dims[i][0] < dims[i][1]}            # across = smaller side by default
    turn = {i for i in turn if i not in free} | {i for i in free if dims[i][0] < dims[i][1]}
    best = layout(ps, turn, 10)
    for rnd_pass in range(6):                                   # hill-climb: flip one part (all its copies) at a time
        improved = False
        for i in rnd.sample(free, len(free)):
            t2 = turn ^ {i}; r = layout(ps, t2, 10)
            if r and r[0] < best[0]: best, turn, improved = r, t2, True
        if not improved: break
    score, sheets = layout(ps, turn, 200)
    for sh in sheets: sh.sort(key=lambda s: (s['w'] < NARROW, -s['w']))
    used = sum(p['L'] * p['W'] for p in ps)
    return {'T': T, 'pieces': len(ps), 'strips': sum(len(s) for s in sheets), 'sheets': sheets, 'turned': sorted(turn),
            'yield': used / (len(sheets) * SHEET_L * SHEET_W)}

def show(r):
    print(f"T{r['T']}: {r['pieces']} pieces, {r['strips']} strips, {len(r['sheets'])} sheets, yield {r['yield']*100:.1f}%, turned {len(r['turned'])} ids")
    for i, sh in enumerate(r['sheets'], 1):
        print(f"  sheet {i}: strips {[s['w'] for s in sh]}  spare {sheet_cap(len(sh)) - sum(s['w'] for s in sh):.1f}")
        for s in sh:
            print(f"     {s['w']:>6}: " + ', '.join(f"{p['id']}{'*' if p['turned'] else ''} {p['along']}" for p in s['pieces']) + f"   spare {strip_cap(len(s['pieces'])) - sum(p['along'] for p in s['pieces']):.1f}")

if __name__ == '__main__':
    parts = json.load(open(sys.argv[1]))['parts']
    out = {}
    for T in (18, 9):
        r = plan(parts, T); show(r); out[T] = r
    json.dump({'sheet': [SHEET_L, SHEET_W], 'trim': TRIM, 'kerf': KERF, 'narrow': NARROW, 'plans': out}, open('plan.json', 'w'), indent=1)
