"""Kerf positions for the plan: every cut is a blade centre line; kerf = [c - KERF/2, c + KERF/2]."""
import json
from plan import SHEET_L, SHEET_W, TRIM, KERF, NARROW

def rip_layout(sheet):
    """strips placed from Y0: trim kerf, strip, kerf, strip ... ; narrow strips form one block at the end"""
    y = TRIM; cuts = []; strips = []
    wide = [s for s in sheet if s['w'] >= NARROW]; narrow = [s for s in sheet if s['w'] < NARROW]
    cuts.append(y + KERF / 2); y += KERF                       # trim the factory edge
    for s in wide:
        strips.append({**s, 'y0': y}); y += s['w']
        cuts.append(y + KERF / 2); y += KERF                   # cut it free
    block = None
    if narrow:
        b0 = y
        for s in narrow:
            strips.append({**s, 'y0': y, 'block': True}); y += s['w'] + KERF   # these kerfs are table-saw cuts
        block = (b0, SHEET_W)                                  # the block runs to the sheet edge (trim done on the table saw)
    return {'cuts': cuts, 'strips': strips, 'block': block, 'offcut': (y, SHEET_W) if not narrow else None}

def cross_layout(strip):
    x = TRIM; cuts = [x + KERF / 2]; x += KERF; pcs = []
    for p in strip['pieces']:
        pcs.append({**p, 'x0': x}); x += p['along']
        cuts.append(x + KERF / 2); x += KERF
    return {'cuts': cuts, 'pieces': pcs, 'offcut': (x, SHEET_L)}
