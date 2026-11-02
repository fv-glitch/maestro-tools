"""Run sheet for the window wall: cut plan diagrams + which program runs where. Usage: runsheet.py plan.json out/index.json parts.json out.html"""
import json, html, sys
from plan import SHEET_L, SHEET_W, TRIM, KERF, NARROW, strip_cap, sheet_cap
from geom import rip_layout, cross_layout
import diagram
plan = json.load(open(sys.argv[1])); idx = json.load(open(sys.argv[2])); parts = {p['id']: p for p in json.load(open(sys.argv[3]))['parts']}
esc = html.escape; fmt = diagram.fmt
strip_prog = dict(idx['strips'])
progs = {}
for p in idx['programs']:
    if p['dir'] == 'parts': progs.setdefault(p['part'], []).append(p)
narrow_machined = [i for i, p in parts.items() if min(p['L'], p['W']) < NARROW and p['ops']]

out = []
for T, r in plan['plans'].items():
    mat = '18 mm whiteboard' if T == '18' else '9 mm MDF'
    out.append(f'<h2>{mat}: {len(r["sheets"])} sheets</h2>')
    for si, sh in enumerate(r['sheets'], 1):
        tag = f'T{T} sheet {si}'; lay = rip_layout(sh)
        out.append(f'<section class="sheet"><h3>{esc(tag)}</h3>')
        out.append(diagram.sheet_svg(sh, ''))
        out.append(f'<p><b>1. Rip:</b> <code>Saw {esc(tag)} - Rip.pgmx</code> &middot; {len(lay["cuts"])} cuts at Y '
                   + ', '.join(fmt(c) for c in lay['cuts']) + ' (blade centre, from the Y0 edge against the stops)</p>')
        out.append('<table><tr><th>Strip</th><th>Width</th><th>2. Crosscut program</th><th>Pieces (X0 end first) &rarr; part programs</th></tr>')
        k = 0
        for st in lay['strips']:
            if st.get('block'): continue
            k += 1; pr = strip_prog[f'{tag} strip {k}']
            pcs = []
            for p in st['pieces']:
                ps = progs.get(p['id'], [])
                pcs.append(f'<b>{esc(p["id"])}</b>{"*" if p["turned"] else ""} {fmt(p["along"])}' + (' <span class="pg">' + ' + '.join(esc(q['setup']) for q in ps) + '</span>' if ps else ' <span class="nm">saw only</span>'))
            out.append(f'<tr><td>{k}</td><td>{fmt(st["w"])}</td><td><code>{esc(pr)}.pgmx</code></td><td>{" &middot; ".join(pcs)}</td></tr>')
        out.append('</table>')
        blk = [st for st in lay['strips'] if st.get('block')]
        if blk:
            out.append(f'<p class="warn"><b>Table saw block</b> (Y {fmt(lay["block"][0])} to the far edge): '
                       + '; '.join(f'{fmt(st["w"])} wide: ' + ', '.join(f'{esc(p["id"])} {fmt(p["along"])}' for p in st['pieces']) for st in blk) + '</p>')
        out.append('</section>')

rows = []
for i, p in parts.items():
    ps = progs.get(i, [])
    rows.append(f'<tr><td>{esc(i)}</td><td>{p["qty"]}</td><td>{fmt(p["L"])} x {fmt(p["W"])} x {fmt(p["T"])}</td><td>{esc(", ".join(n.replace("_", " ") for n in p["names"]))}</td>'
                f'<td>{"<br>".join("<code>" + esc(q["file"]) + "</code> " + esc(q["summary"]) for q in ps) or "saw only"}</td></tr>')

page = f'''<!doctype html><meta charset="utf-8"><title>Window wall run sheet</title>
<style>
body{{font:13px/1.45 system-ui,sans-serif;margin:24px;color:#1b2230;max-width:1100px}} h1{{font-size:22px}} h2{{margin-top:34px;border-bottom:2px solid #1b2230}}
h3{{margin:18px 0 0}} svg{{display:block;margin:6px 0;max-width:100%;height:auto}} table{{border-collapse:collapse;width:100%;margin:8px 0}}
th,td{{border-bottom:1px solid #dde2ea;padding:4px 6px;text-align:left;vertical-align:top}} code{{font-size:12px}} .pg{{color:#2f5fd0}} .nm{{color:#888}}
.warn{{background:#fff4dc;border-left:4px solid #c9a227;padding:6px 10px}} .sheet{{break-inside:avoid;page-break-inside:avoid}}
ul li{{margin:3px 0}}
</style>
<h1>Window wall library: M100 run sheet</h1>
<p>2400 x 1200 sheets, 5 mm trim, E015 blade (3.15 kerf). <b>1.</b> Rip the sheet: every rip runs off both ends.
<b>2.</b> Lay each strip against the stops on its own and run its crosscut program: every cut runs off both sides.
<b>3.</b> Machine each piece with its part programs (F1 first: notches, housings, dowels, edge dowels, screw marks; then turn it over about X for F0).
* = piece turned on the sheet (its W runs along the strip).</p>
<h2>Check before the first run</h2>
<ul>
<li><b>Pods:</b> keep every saw line and every notch corner clear of pods. Saw cuts go 0.2 below the panel, notches 18.2 (through).</li>
<li><b>Untested in Maestro:</b> open one part program and one saw program first, check the simulation, and save. Programs were built from your proven steps (show-door E016 pocket, TDR drills, APEX hinge boring and saw cuts), but these exact files have not been opened in Maestro yet.</li>
<li><b>BoardT</b> (each part program) is the measured board thickness; housings are cut BoardT + 0.2 wide (18.2 at the default 18). Set it in Maestro before running.</li>
<li><b>Narrow parts with edge dowels</b> ({", ".join(narrow_machined)}): 60 wide, too narrow for pods. Their programs are there, but they need a jig or clamping, or drill those holes by hand.</li>
<li><b>Notch corners</b> keep R4 from the 8 mm cutter (the package allowed for R5), and housing ends stop with R4.</li>
<li><b>Trim slivers</b> (5 mm) come loose during the first rip and the first crosscut.</li>
</ul>
{"".join(out)}
<h2>Part programs</h2>
<table><tr><th>Id</th><th>Qty</th><th>Size</th><th>Parts</th><th>Programs</th></tr>{"".join(rows)}</table>'''
open(sys.argv[4], 'w').write(page)
print('ok', len(page))
