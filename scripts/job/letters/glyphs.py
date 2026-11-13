"""A, B, C, D in the style of the Central ITM 'CENTRAL' lettering (heavy condensed, squared bowls).
Units: cap height 54 (as measured off CENTRAL_ITM_STACK_LOGO_BW.jpg), scaled to the letter height.
Writes letters.json: per letter the outline rings (exact letter, for the E017 finish pass), the island-free
pocket pieces (E016) and their contour-parallel toolpath rings, all in mm on a 200 x 200 blank."""
import json, math, sys
from shapely.geometry import Polygon, box, MultiPolygon
from shapely.geometry.polygon import orient
from shapely.ops import unary_union

H_MM = float(sys.argv[1]) if len(sys.argv) > 1 else 150.0
BLANK = 200.0
S = H_MM / 54.0
TOL = 0.05  # chord tolerance in mm for arcs

def rrect(x0, y0, x1, y1, r):
    """rectangle with corner radii r = (bottom-left, bottom-right, top-right, top-left) in letter units"""
    if not isinstance(r, (list, tuple)): r = (r, r, r, r)
    pts = []
    corners = [((x0, y0), r[0], math.pi, 1.5 * math.pi), ((x1, y0), r[1], 1.5 * math.pi, 2 * math.pi),
               ((x1, y1), r[2], 0, 0.5 * math.pi), ((x0, y1), r[3], 0.5 * math.pi, math.pi)]
    for (cx, cy), rr, a0, a1 in corners:
        if rr <= 0: pts.append((cx, cy)); continue
        ccx = cx + (rr if cx == x0 else -rr); ccy = cy + (rr if cy == y0 else -rr)
        rmm = rr * S; n = max(2, math.ceil((a1 - a0) / (2 * math.acos(1 - TOL / rmm))))
        pts += [(ccx + rr * math.cos(a0 + (a1 - a0) * i / n), ccy + rr * math.sin(a0 + (a1 - a0) * i / n)) for i in range(n + 1)]
    return Polygon(pts)

def glyph(ch):
    if ch == 'C':
        outer = rrect(0, 0, 31, 54, 11)
        cut = unary_union([rrect(13, 9.6, 19, 44.4, 2.5), box(16, 20.2, 32, 35.2)])
        return outer.difference(cut), []
    if ch == 'D':
        outer = rrect(0, 0, 31, 54, (0, 11, 11, 0))
        return outer.difference(rrect(12.5, 9.6, 18.5, 44.4, 2.5)), [27.0]
    if ch == 'B':
        # even bowls: same width, same corner radii, equal counters, middle bar centred
        body = unary_union([box(0, 0, 12.5, 54), rrect(0, 26.2, 30, 54, (0, 7, 9, 0)), rrect(0, 0, 30, 27.8, (0, 9, 7, 0))])
        holes = unary_union([rrect(12.5, 31.2, 18, 44.4, 2.2), rrect(12.5, 9.6, 18, 22.8, 2.2)])
        return body.difference(holes), [16.2, 37.8]
    if ch == 'A':
        outer = Polygon([(0, 0), (35, 0), (28, 54), (7, 54)])
        notch = Polygon([(11.65, 0), (23.35, 0), (22.5, 13.5), (12.5, 13.5)]).buffer(0)
        counter = Polygon([(14.15, 22.7), (20.85, 22.7), (17.5, 43.5)])
        return outer.difference(notch).difference(counter), [33.0]
    raise ValueError(ch)

def to_mm(g, w):
    """scale to mm and centre the letter's bounding box on the blank"""
    from shapely import affinity
    g = affinity.scale(g, S, S, origin=(0, 0))
    x0, y0, x1, y1 = g.bounds
    return affinity.translate(g, BLANK / 2 - (x0 + x1) / 2, BLANK / 2 - (y0 + y1) / 2)

def rings_of(g):
    ps = list(g.geoms) if isinstance(g, MultiPolygon) else [g]
    out = []
    for p in ps:
        p = orient(p, 1.0)
        out.append(list(p.exterior.coords)[:-1])
        out += [list(r.coords)[:-1] for r in p.interiors]
    return out

R16, STEP = 4.0, 4.0     # E016 radius, radial cutting depth (template RadialCuttingDepth 4)
R17 = 1.5                # E017 radius
OVER = 5.0               # pieces overlap 5 mm past each split line (> E016 radius, so corner residue never lines up)

def pocket_rings(piece):
    """contour-parallel rings, outermost first, as a tree: [(ring, children)]"""
    def level(region, d):
        g = region.buffer(-d, join_style='round', quad_segs=24)
        if g.is_empty: return []
        ps = list(g.geoms) if isinstance(g, MultiPolygon) else [g]
        out = []
        for p in ps:
            if p.area < 0.5: continue
            p = orient(p.simplify(0.01), 1.0)
            assert not p.interiors, 'offset ring with a hole'
            out.append(p)
        return out
    def tree(region, d):
        return [{'ring': list(p.exterior.coords)[:-1], 'kids': tree(p.buffer(R16, join_style='round', quad_segs=24).intersection(region), d + STEP)}
                for p in level(region, d)]
    # children: offsets of the piece at the next distance that lie inside this ring
    def build(d, parent_poly):
        ps = level(piece, d)
        res = []
        for p in ps:
            if parent_poly is not None and not parent_poly.buffer(1e-6).contains(p): continue
            res.append({'ring': list(p.exterior.coords)[:-1], 'kids': build(d + STEP, p)})
        return res
    return build(R16, None)

out = {}
for ch in 'ABCD':
    g, splits = glyph(ch)
    assert g.is_valid and isinstance(g, Polygon), ch
    gm = to_mm(g, None)
    # split lines in mm (same transform as the letter)
    x0, y0, x1, y1 = (g.bounds[0] * S, g.bounds[1] * S, g.bounds[2] * S, g.bounds[3] * S)
    dy = BLANK / 2 - (y0 + y1) / 2
    cuts = [c * S + dy for c in splits]
    edges = [-1e3] + cuts + [1e3]
    pieces = []
    for i in range(len(edges) - 1):
        lo = edges[i] - (OVER if i > 0 else 0); hi = edges[i + 1] + (OVER if i < len(edges) - 2 else 0)
        pc = gm.intersection(box(-1e3, lo, 1e3, hi))
        assert isinstance(pc, Polygon) and not pc.interiors, f'{ch} piece {i} is not simply connected'
        pieces.append(orient(pc, 1.0))
    assert unary_union(pieces).symmetric_difference(gm).area < 1e-6
    prof = gm.buffer(-R17, join_style='round', quad_segs=24)
    out[ch] = {
        'outline': rings_of(gm),                  # exact letter: exterior CCW, counters CW
        'profile': rings_of(orient(prof, 1.0)),   # E017 centre paths, same order
        'pieces': [{'boundary': list(p.exterior.coords)[:-1], 'tree': pocket_rings(p)} for p in pieces],
        'bounds': gm.bounds, 'area': gm.area,
    }
    print(ch, 'bounds', [round(v, 2) for v in gm.bounds], 'pieces', len(pieces), 'outline rings', len(out[ch]['outline']),
          'vertices', sum(len(r) for r in out[ch]['outline']))
json.dump({'height': H_MM, 'blank': BLANK, 'letters': out}, open('letters.json', 'w'))

# preview
import matplotlib; matplotlib.use('Agg')
import matplotlib.pyplot as plt
fig, axs = plt.subplots(1, 4, figsize=(16, 4.4), dpi=110)
for ax, ch in zip(axs, 'ABCD'):
    L = out[ch]
    ax.add_patch(plt.Rectangle((0, 0), BLANK, BLANK, fill=False, ec='k'))
    from matplotlib.path import Path
    from matplotlib.patches import PathPatch
    verts, codes = [], []
    for r in L['outline']:
        verts += r + [r[0]]; codes += [Path.MOVETO] + [Path.LINETO] * (len(r) - 1) + [Path.CLOSEPOLY]
    ax.add_patch(PathPatch(Path(verts, codes), fc='#222', ec='none'))
    def walk(t, col):
        for n in t:
            xs, ys = zip(*(n['ring'] + [n['ring'][0]])); ax.plot(xs, ys, color=col, lw=0.5); walk(n['kids'], col)
    for i, pc in enumerate(L['pieces']):
        walk(pc['tree'], ['#e33', '#3a3', '#36e'][i % 3])
    for r in L['profile']:
        xs, ys = zip(*(r + [r[0]])); ax.plot(xs, ys, color='#fc0', lw=0.7)
    ax.set_xlim(-5, 205); ax.set_ylim(-5, 205); ax.set_aspect('equal'); ax.set_title(ch); ax.axis('off')
fig.tight_layout(); fig.savefig('letters.png')
