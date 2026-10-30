/**
 * The real builds from Oct 30 2026, ported step for step from the Python that produced them.
 * Each takes program XML and returns the new XML. The parity tests run them on the same inputs and
 * require byte-identical output, which proves the engine before it is used for new tools.
 *
 * They double as worked examples of the building blocks:
 *   addDummyHandleParameter  - project variable + point/circle expressions
 *   latchHandleSet           - cloning ITM templates across files, helix bore, faceplate pocket/profile, drills, Other Side copies
 *   groupSteps               - wrapping steps in ExecutableGroups
 *   spindleHelix             - copying a proven helix toolpath to a new centre/depth
 *   cornersStartPoint        - profile start-point setting
 *   jambStrikeInAmelia       - rect pockets with levels, composite-element expressions
 *                              (historical: it edited the Amelia subprogram's expanded steps - the right
 *                               way is a new instance with parameters; kept as an engine test)
 */
import {
  Ids, blocks, cloneBlocks, renameStep, ln, vline, setDesc, setMembers, setTrajectory, trajectoryRecords,
  setGeoDesc, setGeoName, setDepth, setOpValue, splice, stepParts, NS_PROJECT,
} from '../engine/pgmx';
import { Expressions, makeVariable, insertVariables, geometryRef } from '../engine/params';
import { rectRecords, circleRecord, circleBoundary, circleLoop, rectPocketPath, rectProfileTop, mapRecord } from '../engine/geometry';
import { pyRepr as r, pyRound, pyInt } from '../engine/pyfmt';

const GEO = 'ScmGroup.XCam.MachiningDataModel.Geometry.';
const num = (t: string, name: string) => parseFloat(new RegExp('Utility">' + name + '</Name>.*?<a:Value[^>]*>([^<]*)', 's').exec(t)![1]);
const stepBlock = (t: string, name: string) => { const p = stepParts(t, name); return p; };

// ---------------------------------------------------------------- DummyHandleX parameter (dh2 -> dh3)
export function addDummyHandleParameter(t: string): string {
  const VAR = 'DummyHandleX', VAL = 990, OFF = 14.337;
  if (t.includes('>' + VAR + '<')) throw new Error(VAR + ' already exists');
  const ids = new Ids(t);
  const nv = makeVariable(ids, t, 'Handle', VAR, String(VAL));
  const ex = new Expressions(t, ids);
  const geoOf = (step: string) => {
    const p = stepBlock(t, step);
    const m = /<GeometryID[^>]*><b:ID>(\d+)<\/b:ID><b:ObjectType>([^<]+)/.exec(p.feature.text)!;
    return [m[1], m[2]];
  };
  let [g, o] = geoOf('E019 16mm - Dummy handle clip recess');
  ex.prop('CenterX', g, o, VAR);
  for (const [name, sign] of [['Dummy pilot 1 RH hung', '-'], ['Dummy pilot 2 RH hung', '+'], ['Dummy pilot 1 LH hung', '-'], ['Dummy pilot 2 LH hung', '+']]) {
    [g, o] = geoOf('E022 3mm Drill - ' + name);
    ex.prop('X', g, o, `${VAR}${sign}${OFF}`);
  }
  const t2 = t.replace('</Variables>', nv + '</Variables>');
  return ex.insertInto(t2);
}

// ---------------------------------------------------------------- QuickFix privacy latch set (1430 -> lt1)
export function latchHandleSet(t: string, itm: string, toolLib: string): string {
  const VAR = 'LatchHandleX', XH = 990.0;
  const DX = num(t, 'dx1'), DY = num(t, 'dy1'), DZ = num(t, 'dz1'); const TOP = DZ, CLR = TOP + 50;
  const YH = DY - 60;
  const O = 40.55 / 2 / Math.sqrt(2);
  const FP_L = 57.13 + 0.2, FP_W = 25.24 + 0.2, FP_D = 2.96 + 0.1;
  const BORE_D = 85.0, HALF = 20.0, ZC = DZ / 2;
  const E024 = /<(?:\w+:)?ID>(\d+)<\/(?:\w+:)?ID><(?:\w+:)?ObjectType>ScmGroup\.XCam\.ToolDataModel\.Tool\.CuttingTool<\/(?:\w+:)?ObjectType>(?:(?!<\/Key>).){0,300}?<(?:\w+:)?Name>E024</s.exec(toolLib)?.[1]
    ?? [...toolLib.slice(0, toolLib.indexOf('>E024<')).matchAll(/<(?:\w+:)?ID>(\d+)<\//g)].pop()![1];
  const ids = new Ids(t, itm);
  const steps: string[] = [], feats: string[] = [], geos: string[] = [], ops: string[] = [];
  const add = (st: string, fs: string[], gs: string[], os: string[]) => { steps.push(st); feats.push(...fs); geos.push(...gs); ops.push(...os); };
  const ex = new Expressions(t, ids);
  const expr = (gm: string, prop: string, value: string, elem?: number) => {
    const [g, o] = geometryRef(gm);
    if (elem === undefined) ex.prop(prop, g, o, value); else ex.element(elem, prop, g, o, value);
  };
  const spindle = (name: string, x: number, y: number, en: boolean) => {
    let [st, fm, gm, om] = cloneBlocks(ids, blocks(itm, 'E019 16mm - Pocket(4)-AlboPassage(2)'));
    const rad = 12.5, rr = rad - 8, circ = circleRecord(x, y, rad);
    gm = setGeoName(setGeoDesc(gm, circ), name.split(' - ')[1].replace(/ /g, ''));
    fm = setDepth(setMembers(ids, fm, circleBoundary(circ)), HALF);
    const n = Math.ceil(HALF / 4); const zs = Array.from({ length: n }, (_, k) => TOP - HALF * (k + 1) / n); const path: string[] = [];
    zs.forEach((zz, k) => { path.push(...circleLoop(x, y, zz, rr)); if (k < n - 1) path.push(ln(x, y + rr, zz, 0, 0, -1, zz - zs[k + 1])); });
    om = setTrajectory(ids, om, path);
    om = setDesc(om, 'Approach', ln(x, y + rr, CLR, 0, 0, -1, CLR - zs[0]), CLR - zs[0]);
    om = setDesc(om, 'Lift', ln(x, y + rr, zs[n - 1], 0, 0, 1, CLR - zs[n - 1]), CLR - zs[n - 1]);
    om = om.replace(/(<b:IsHelicStrategy>)true(<)/g, '$1false$2');
    om = setOpValue(om, 'AxialCuttingDepth', r(HALF / n));
    add(renameStep(st, name, en), [fm], [gm], [om]); return gm;
  };
  const drill = (name: string, x: number, y: number, d: number, en: boolean) => {
    let [st, fm, gm, om] = cloneBlocks(ids, blocks(itm, 'E022 3mm Drill - Boring(1)-AlboPassageScrews(1)'));
    gm = gm.replace(/(<a:_x>)[^<]*(<\/a:_x><a:_y>)[^<]*(<\/a:_y>)/, (_m, a, b, c) => a + r(x) + b + r(y) + c);
    gm = setGeoName(gm, name.split(' - ')[1].replace(/ /g, ''));
    fm = setDepth(fm, d).replace(/(<a:Diameter>)[^<]*(<)/, (_m, a, b) => a + '8' + b);
    om = om.replace(/(<ToolKey[^>]*><b:ID>)\d+(<\/b:ID><b:ObjectType>[^<]*<\/b:ObjectType><b:Name>)E022(<)/, (_m, a, b, c) => a + E024 + b + 'E024' + c);
    om = setDesc(om, 'Approach', ln(x, y, CLR, 0, 0, -1, CLR - TOP), CLR - TOP);
    om = setTrajectory(ids, om, [ln(x, y, TOP, 0, 0, -1, d)]);
    om = setDesc(om, 'Lift', ln(x, y, TOP - d, 0, 0, 1, CLR - TOP + d), CLR - TOP + d);
    add(renameStep(st, name, en), [fm], [gm], [om]); return gm;
  };
  for (const [Y, sfx, en] of [[(y: number) => y, '', true], [(y: number) => DY - y, ' Other Side', false]] as [(y: number) => number, string, boolean][]) {
    let g = spindle('E019 16mm - Latch spindle hole' + sfx, XH, Y(YH), en); expr(g, 'CenterX', VAR);
    for (const [nm, dx, dy, on] of [['QF stud 1 RH hung', -O, -O, true], ['QF stud 2 RH hung', O, O, true], ['QF stud 1 LH hung', -O, O, false], ['QF stud 2 LH hung', O, -O, false]] as [string, number, number, boolean][]) {
      g = drill('E024 8mm Drill - ' + nm + sfx, XH + dx, Y(YH + dy), HALF, en && on);
      expr(g, 'X', `${VAR}${dx > 0 ? '+' : '-'}${r(pyRound(Math.abs(dx), 3))}`);
    }
    g = drill('E024 8mm Drill - Privacy PR hole' + sfx, XH, Y(YH + 20), HALF, en); expr(g, 'X', VAR);
  }
  // Back edge: barrel bore, cloned from the Futura latch hole, helix truncated to depth
  {
    let [st, fm, gm, om] = cloneBlocks(ids, blocks(itm, 'E019 16mm - Pocket(8)-FuturaLatchHole'));
    const XP = DX - XH;
    gm = setGeoName(setGeoDesc(gm, `2 ${r(XP)} ${r(ZC)} 0 -0 0 1 0 -1 0 1 0 0 12.5\n`), 'LatchBarrelBore'); fm = setDepth(fm, BORE_D);
    const arcs = [.../<b:Type>TrajectoryPath<\/b:Type>.*?<\/b:Toolpath>/s.exec(om)![0].matchAll(/string>([^<]+)</g)].map((m) => m[1]);
    if (arcs.length !== 90) throw new Error('unexpected Futura helix');
    om = setTrajectory(ids, om, arcs.slice(0, BORE_D).map((rec) => mapRecord(rec, { 1: (v) => v + XH - 590, 3: (v) => v + ZC - 18.5 })));
    const zs = 14 + ZC - 18.5;
    om = setDesc(om, 'Approach', ln(XH, DY + 20, zs, 0, -1, 0, 20), 20);
    om = setDesc(om, 'Lift', ln(XH, DY - BORE_D, zs, 0, 1, 0, BORE_D + 20), BORE_D + 20);
    add(renameStep(st, 'E019 16mm - Latch barrel bore', true), [fm], [gm], [om]); expr(gm, 'CenterX', 'dx1-' + VAR);
  }
  // Back edge: faceplate pocket (8mm) + 3mm corner pass sharing one outline
  {
    const b1 = blocks(itm, 'E016 8mm - Pocket(5)-AlboLatch(1)'), b2 = blocks(itm, 'E017 3mm - Routing(11)-AlboLatch(1)');
    if (b1[2] !== b2[2]) throw new Error('faceplate templates no longer share geometry');
    let [st1, fm1, gm, om1, st2, fm2, om2] = cloneBlocks(ids, [b1[0], b1[1], b1[2], b1[3], b2[0], b2[1], b2[3]]);
    const XP = DX - XH;
    const hx = FP_L / 2, hz = FP_W / 2;
    const x0 = XP - hx, x1 = XP + hx, y0 = ZC - hz, y1 = ZC + hz;
    const rect = [`8 0 ${r(FP_L)}\n1 ${r(x0)} ${r(y1)} 0 1 0 0 \n`, `8 0 ${r(FP_W)}\n1 ${r(x1)} ${r(y1)} 0 0 -1 0 \n`, `8 0 ${r(FP_L)}\n1 ${r(x1)} ${r(y0)} 0 -1 0 0 \n`, `8 0 ${r(FP_W)}\n1 ${r(x0)} ${r(y0)} 0 0 1 0 \n`];
    gm = setGeoName(setMembers(ids, gm, rect), 'LatchFaceplate'); fm1 = setDepth(setMembers(ids, fm1, rect), FP_D);
    const YF = DY - FP_D; const loops = [12, 8, 4].filter((d) => hz - d > 0).map((d) => [hx - d, hz - d]); const Sz = ZC + loops[0][1]; const path: string[] = [];
    loops.forEach(([lx, lz], i) => {
      const xr = XH + lx;
      if (i) path.push(ln(XH + loops[i - 1][0], YF, Sz, 1, 0, 0, lx - loops[i - 1][0]));
      path.push(ln(xr, YF, Sz, 0, 0, -1, Sz - (ZC - lz)), ln(xr, YF, ZC - lz, -1, 0, 0, 2 * lx), ln(XH - lx, YF, ZC - lz, 0, 0, 1, 2 * lz), ln(XH - lx, YF, ZC + lz, 1, 0, 0, 2 * lx));
      if (ZC + lz - Sz > 1e-9) path.push(ln(xr, YF, ZC + lz, 0, 0, -1, ZC + lz - Sz));
    });
    om1 = setTrajectory(ids, om1, path); const xe = XH + loops[loops.length - 1][0];
    om1 = setDesc(om1, 'Approach', ln(XH + loops[0][0], DY + 20, Sz, 0, -1, 0, 20 + FP_D), 20 + FP_D);
    om1 = setDesc(om1, 'Lift', ln(xe, YF, Sz, 0, 1, 0, 20 + FP_D), 20 + FP_D);
    const RD = FP_D - 0.1, YR = DY - RD, rx = hx - 1.5, rz = hz - 1.5;
    fm2 = setDepth(fm2, RD);
    om2 = setTrajectory(ids, om2, [ln(XH - rx, YR, ZC + rz, -1, 0, 0, rx, true), ln(XH - rx, YR, ZC - rz, 0, 0, -1, 2 * rz, true), ln(XH + rx, YR, ZC - rz, 1, 0, 0, 2 * rx, true),
      ln(XH + rx, YR, ZC + rz, 0, 0, 1, 2 * rz, true), ln(XH, YR, ZC + rz, -1, 0, 0, rx, true)]);
    om2 = setDesc(om2, 'Approach', ln(XH, DY + 20, ZC + rz, 0, -1, 0, 20 + RD), 20 + RD);
    om2 = setDesc(om2, 'Lift', ln(XH, YR, ZC + rz, 0, 1, 0, 20 + RD), 20 + RD);
    steps.push(renameStep(st1, 'E016 8mm - Latch faceplate pocket', true), renameStep(st2, 'E017 3mm - Latch faceplate corners', true));
    feats.push(fm1, fm2); geos.push(gm); ops.push(om1, om2);
    [[-hx, hx], [hx, hx], [hx, -hx], [-hx, -hx]].forEach(([sx, exx], i) => {
      for (const [prop, v] of [['StartX', sx], ['EndX', exx]] as [string, number][]) expr(gm, prop, `dx1-${VAR}${v > 0 ? '+' : '-'}${r(pyRound(Math.abs(v), 3))}`, i);
    });
  }
  const keys = ['E019 16mm - Latch spindle', 'E019 16mm - Latch barrel', 'E016', 'E017', 'E024 8mm Drill - QF', 'E024 8mm Drill - Privacy'];
  const order = (s: string) => keys.findIndex((k) => s.includes('Utility">' + k));
  const sorted = [...steps.filter((s) => !s.includes('Other Side'))].sort((a, b) => order(a) - order(b))
    .concat([...steps.filter((s) => s.includes('Other Side'))].sort((a, b) => order(a) - order(b)));
  const nv = makeVariable(ids, t, 'DummyHandleX', VAR, pyInt(XH));
  let t2 = t;
  for (const nm of ['E019 16mm - Flush pull cup', 'E019 16mm - Flush pull lip recess', 'E019 16mm - Dummy handle clip recess', 'E022 3mm Drill - Dummy pilot 1 RH hung',
    'E022 3mm Drill - Dummy pilot 2 RH hung', 'E022 3mm Drill - Dummy pilot 1 LH hung', 'E022 3mm Drill - Dummy pilot 2 LH hung']) {
    t2 = t2.split('Utility">' + nm + '</Name><Description/><IsEnabled>true').join('Utility">' + nm + '</Name><Description/><IsEnabled>false');
  }
  const hp = t2.indexOf('Utility">Park Right(2)(1)</Name>'); const END = t2.lastIndexOf('<Executable', hp);
  return splice(t2, [
    [END, END, sorted.join('')],
    ...[['</ManufacturingFeature>', feats], ['</a:GeomGeometry>', geos], ['</Operation>', ops]].map(([tag, list]) => {
      const p = t2.lastIndexOf(tag as string) + (tag as string).length; return [p, p, (list as string[]).join('')] as [number, number, string];
    }),
    [t2.indexOf('</Variables>'), t2.indexOf('</Variables>'), nv],
    [t2.indexOf('</Expressions>'), t2.indexOf('</Expressions>'), ex.items.join('')],
  ]);
}

// ---------------------------------------------------------------- groups (lt1 -> gp1)
export function groupSteps(t: string, groups: [string, (name: string) => boolean][]): string {
  const names = [...t.matchAll(/Utility">([^<]*)<\/Name><Description\/><IsEnabled>(\w+)/g)].map((m) => m[1]);
  const spans: [number, number, string][] = [];
  for (const [g, f] of groups) for (const n of names.filter(f)) {
    const h = t.indexOf('Utility">' + n + '</Name>'); const a0 = t.lastIndexOf('<Executable', h); const b0 = t.indexOf('</Executable>', h) + 13;
    if (!t.slice(a0, a0 + 60).includes('MachiningWorkingStep') || (t.slice(a0, b0).match(/<Executable/g) ?? []).length !== 1) throw new Error('not a plain step: ' + n);
    spans.push([a0, b0, g]);
  }
  spans.sort((a, b) => a[0] - b[0]);
  for (let i = 1; i < spans.length; i++) if (spans[i - 1][1] !== spans[i][0]) throw new Error('steps not contiguous');
  const ids = new Ids(t);
  let out = '';
  for (const [g] of groups) {
    const body = spans.filter((s) => s[2] === g).map(([a, b]) => t.slice(a, b)).join('');
    out += `<Executable i:type="a:ExecutableGroup" xmlns:a="${NS_PROJECT}"><Key xmlns="http://schemas.datacontract.org/2004/07/ScmGroup.XCam.MachiningDataModel.Utility"><ID>${ids.take()}</ID>` +
      `<ObjectType>ScmGroup.XCam.MachiningDataModel.ProjectModule.ExecutableGroup</ObjectType></Key><Name xmlns="http://schemas.datacontract.org/2004/07/ScmGroup.XCam.MachiningDataModel.Utility">${g}</Name>` +
      `<Description/><IsEnabled>true</IsEnabled><Priority>0</Priority><Elements>${body}</Elements></Executable>`;
  }
  return t.slice(0, spans[0][0]) + out + t.slice(spans[spans.length - 1][1]);
}

const isLatch = (n: string) => n.startsWith('E0') && (n.includes('Latch') || n.includes('QF stud') || n.includes('PR hole'));
export const HANDLE_GROUPS: [string, (n: string) => boolean][] = [
  ['Flush pull', (n) => n.includes('Flush pull')],
  ['Dummy handle', (n) => n.includes('Dummy')],
  ['Latch handle', (n) => isLatch(n) && !n.includes('Other Side')],
  ['Latch handle Other Side', (n) => isLatch(n) && n.includes('Other Side')],
];

// ---------------------------------------------------------------- spindle helix (gp1 -> hx1)
export function spindleHelix(t: string, itm: string, stepNames: string[]): string {
  const tarcs = trajectoryRecords(blocks(itm, 'E019 16mm - Pocket(4)-AlboPassage(2)')[3]);
  if (tarcs.length !== 40) throw new Error('unexpected ITM helix');
  const TOP = 38.0, CLR = TOP + 50;
  const ids = new Ids(t);
  const edits: [number, number, string][] = [];
  for (const name of stepNames) {
    const p = stepParts(t, name);
    const D = parseFloat(/<EndDepth>([^<]*)/.exec(p.feature.text)![1]); const n = Math.round(D);
    if (Math.abs(D - n) > 1e-9 || n > 40) throw new Error('depth must be a whole number up to 40');
    const c = new RegExp('<b:ID>(\\d+)</b:ID><b:ObjectType>' + GEO.replace(/\./g, '\\.') + 'GeomCircle').exec(p.feature.text)![1];
    const g = new RegExp('<Key[^>]*><ID>' + c + '</ID>.*?_serializationGeometryDescription>2 ([^ ]+) ([^ ]+) ', 's').exec(t)!;
    const X = parseFloat(g[1]), Y = parseFloat(g[2]);
    const arcs = tarcs.slice(0, n).map((rec) => mapRecord(rec, { 1: (v) => v + X - 1190, 2: (v) => v + Y - 750 }));
    let o = setTrajectory(ids, p.operation.text, arcs);
    o = setDesc(o, 'Approach', vline(X + 4.5, Y, CLR, -1, CLR - TOP), CLR - TOP);
    o = setDesc(o, 'Lift', vline(X + 4.5, Y, TOP - n, 1, CLR - TOP + n), CLR - TOP + n);
    o = o.replace(/(<b:IsHelicStrategy>)false(<)/, '$1true$2');
    o = setOpValue(o, 'AxialCuttingDepth', '2');
    edits.push([p.operation.start, p.operation.end, o]);
  }
  return splice(t, edits);
}

// ---------------------------------------------------------------- profile start point (hx1 -> sp1)
export function setStartPoint(t: string, stepName: string, from: string, to: string): string {
  const p = stepParts(t, stepName);
  const re = new RegExp('(<StartMachiningPointPosition>)' + from + '(<)');
  if (!re.test(p.operation.text)) throw new Error('start point is not ' + from);
  return splice(t, [[p.operation.start, p.operation.end, p.operation.text.replace(re, '$1' + to + '$2')]]);
}

// ---------------------------------------------------------------- jamb strike (TestingJamb -> sk1)
export function jambStrikeInAmelia(t: string): string {
  const gv = (n: string) => parseFloat(new RegExp('<Name xmlns="[^"]*">' + n + '</Name>.*?<a:Value[^>]*>([^<]*)', 's').exec(t)![1]);
  const TOP = gv('dz1'), CLR = TOP + 50, LOCKP = gv('LockP'), T = 38.0;
  const YL = 7.45 + T / 2;
  const PL = 55.79 + 0.2, PW = 42 + 0.2, PD = 1.6;
  const FLAT = 5.24 + 14.8 / 2;
  const BL = 31 + 0.2, BW = 22.77 + 0.2, BD = PD + 13 + 0.5;
  const xc = LOCKP, ycB = YL, ycP = YL + FLAT + 0.1 - PW / 2;
  const ids = new Ids(t);
  const edits: [number, number, string][] = [];
  // dust box
  let p = stepParts(t, 'DustboxProfilePocket'); const gidB = p.gid;
  const recsB = rectRecords(xc, ycB, BL, BW);
  const g2 = setMembers(ids, p.geometry.text, recsB); const f2 = setDepth(setMembers(ids, p.feature.text, recsB), BD);
  let pk = rectPocketPath(TOP, xc, ycB, BL, BW, BD, 2.667);
  let o2 = setTrajectory(ids, p.operation.text, pk.path); o2 = setOpValue(o2, 'AxialCuttingDepth', r(BD / pk.levels));
  o2 = setDesc(o2, 'Approach', ln(pk.start[0], pk.start[1], CLR, 0, 0, -1, CLR - pk.start[2]), CLR - pk.start[2]);
  o2 = setDesc(o2, 'Lift', ln(pk.end[0], pk.end[1], pk.end[2], 0, 0, 1, CLR - pk.end[2]), CLR - pk.end[2]);
  edits.push([p.geometry.start, p.geometry.end, g2], [p.feature.start, p.feature.end, f2], [p.operation.start, p.operation.end, o2]);
  // strike plate pocket + profile (shared outline)
  p = stepParts(t, 'StrikeProfilePocket'); const pr = stepParts(t, 'StrikeProfileRouting'); const gidP = p.gid;
  if (p.gid !== pr.gid) throw new Error('strike pocket and routing no longer share geometry');
  const recsP = rectRecords(xc, ycP, PL, PW);
  const g3 = setMembers(ids, p.geometry.text, recsP); const f3 = setDepth(setMembers(ids, p.feature.text, recsP), PD);
  pk = rectPocketPath(TOP, xc, ycP, PL, PW, PD, 2.667);
  let o3 = setTrajectory(ids, p.operation.text, pk.path);
  o3 = setDesc(o3, 'Approach', ln(pk.start[0], pk.start[1], CLR, 0, 0, -1, CLR - pk.start[2]), CLR - pk.start[2]);
  o3 = setDesc(o3, 'Lift', ln(pk.end[0], pk.end[1], pk.end[2], 0, 0, 1, CLR - pk.end[2]), CLR - pk.end[2]);
  edits.push([p.geometry.start, p.geometry.end, g3], [p.feature.start, p.feature.end, f3], [p.operation.start, p.operation.end, o3]);
  const RD = PD - 0.1, zr = TOP - RD, rx = PL / 2 - 1.5, ry = PW / 2 - 1.5;
  const fR = setDepth(pr.feature.text, RD);
  let oR = setTrajectory(ids, pr.operation.text, rectProfileTop(xc, ycP, rx, ry, zr));
  oR = setDesc(oR, 'Approach', ln(xc, ycP + ry, CLR, 0, 0, -1, CLR - zr), CLR - zr);
  oR = setDesc(oR, 'Lift', ln(xc, ycP + ry, zr, 0, 0, 1, CLR - zr), CLR - zr);
  edits.push([pr.feature.start, pr.feature.end, fR], [pr.operation.start, pr.operation.end, oR]);
  let t2 = splice(t, edits);
  const nv = makeVariable(ids, t2, 'JambThickness', 'DoorThickness', pyInt(T));
  const ex = new Expressions(t2, ids);
  const f = (base: string, off: number) => `${base}${off >= 0 ? '+' : '-'}${r(pyRound(Math.abs(off), 4))}`;
  const LINE = '(7.45+DoorThickness/2)';
  const bind = (gid: string, L: number, W: number, ycoff: number) => {
    const X0 = f('LockP', -L / 2), X1 = f('LockP', L / 2), Y0 = f(LINE, ycoff - W / 2), Y1 = f(LINE, ycoff + W / 2);
    [[X0, Y1, X1, Y1], [X1, Y1, X1, Y0], [X1, Y0, X0, Y0], [X0, Y0, X0, Y1]].forEach(([sx, sy, exx, ey], i) => {
      for (const [prop, v] of [['StartX', sx], ['StartY', sy], ['EndX', exx], ['EndY', ey]]) ex.element(i, prop, gid, GEO + 'GeomCompositeCurve', v);
    });
  };
  bind(gidB, BL, BW, 0.0); bind(gidP, PL, PW, ycP - YL);
  t2 = t2.replace('</Variables>', nv + '</Variables>');
  return ex.insertInto(t2);
}
