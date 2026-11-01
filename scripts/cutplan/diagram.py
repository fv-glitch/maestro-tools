import json, html, sys
from plan import SHEET_L, SHEET_W, TRIM, KERF, NARROW
from geom import rip_layout, cross_layout
FAM = {'DTL': '#dbe7f7', 'DTR': '#e3f1e0', 'T2': '#f7e6d6', 'T3': '#efe1f5', 'UHP': '#fbeec2', 'UWR': '#d9f0f0', 'DBL': '#f6dde3', 'SCR': '#e8e8e8'}
def fam(i): return FAM.get(i.split('-')[0], '#eee')
def esc(s): return html.escape(str(s))
def fmt(v): return ('%.2f' % v).rstrip('0').rstrip('.')

def sheet_svg(sheet, title):
    s = 0.36; W, H = SHEET_L * s, SHEET_W * s; lay = rip_layout(sheet)
    o = [f'<svg viewBox="-60 -30 {W + 70} {H + 50}" width="{W + 70:.0f}" xmlns="http://www.w3.org/2000/svg" font-family="system-ui,sans-serif">',
         f'<text x="0" y="-10" font-size="13" font-weight="600">{esc(title)}</text>',
         f'<rect x="0" y="0" width="{W}" height="{H}" fill="#f4f1ea" stroke="#555"/>']
    # Y is drawn upward from the bottom edge (Y0 at the bottom, against the stops)
    Y = lambda y: H - y * s
    for st in lay['strips']:
        cx = cross_layout(st)
        for p in cx['pieces']:
            x0, y0 = p['x0'] * s, Y(st['y0'] + st['w'])
            o.append(f'<rect x="{x0:.1f}" y="{y0:.1f}" width="{p["along"] * s:.1f}" height="{st["w"] * s:.1f}" fill="{fam(p["id"])}" stroke="#333" stroke-width=".6"/>')
            if p['along'] * s > 26 and st['w'] * s > 9:
                fs = min(10, st['w'] * s * 0.42, p['along'] * s / 5.2)
                o.append(f'<text x="{x0 + 2:.1f}" y="{y0 + fs + 1:.1f}" font-size="{fs:.1f}">{esc(p["id"])}{"*" if p["turned"] else ""}</text>')
                if st['w'] * s > 2.3 * fs: o.append(f'<text x="{x0 + 2:.1f}" y="{y0 + 2 * fs + 2:.1f}" font-size="{fs * .85:.1f}" fill="#555">{fmt(p["along"])}x{fmt(st["w"])}</text>')
        if st.get('block'): continue
    if lay['block']:
        b0, b1 = lay['block']
        o.append(f'<rect x="0" y="{Y(b1):.1f}" width="{W}" height="{(b1 - b0) * s:.1f}" fill="none" stroke="#b00" stroke-dasharray="5 3"/>')
        o.append(f'<text x="{W - 4}" y="{Y(b1) - 3:.1f}" font-size="9" fill="#b00" text-anchor="end">table saw block</text>')
    for i, c in enumerate(lay['cuts'], 1):
        o.append(f'<line x1="-8" x2="{W + 8}" y1="{Y(c):.1f}" y2="{Y(c):.1f}" stroke="#c00" stroke-width=".8"/>')
        o.append(f'<text x="-56" y="{Y(c) + 3:.1f}" font-size="9" fill="#c00">R{i} {fmt(c)}</text>')
    o.append('</svg>')
    return '\n'.join(o)

if __name__ == '__main__':
    P = json.load(open('plan.json'))
    body = []
    for T, r in P['plans'].items():
        mat = '18 mm whiteboard' if T == '18' else '9 mm MDF'
        body.append(f'<h2>{mat}: {len(r["sheets"])} sheets, {r["pieces"]} pieces, {r["strips"]} strips, yield {r["yield"] * 100:.0f}%</h2>')
        for i, sh in enumerate(r['sheets'], 1):
            body.append(sheet_svg(sh, f'T{T} sheet {i}'))
    page = f'''<!doctype html><meta charset="utf-8"><title>Window wall cut plan</title>
    <style>body{{font:14px system-ui,sans-serif;margin:24px;color:#222}} svg{{display:block;margin:10px 0 26px;max-width:100%;height:auto}}</style>
    <h1>Window wall: sheet cutting on the M100</h1>
    <p>2400 x 1200 sheets, 5 mm trim, E015 kerf 3.15. Rip lines R (blade centre, mm from Y0) run off both ends; strips are then crosscut one at a time.
    * = part turned (its W runs along the strip). Red dashed = narrow pieces, ripped off as one block and finished on the table saw.</p>
    {"".join(body)}'''
    open(sys.argv[1], 'w').write(page)
