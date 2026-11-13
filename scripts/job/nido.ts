// 72427 Nido doors from the 72225 Nido RH doors (2200, 4 hinges, macros), set up like NidoOptimise:
//   - Doorknob (and, for LH, the hand formulas) -> stored instance coordinates + expanded steps moved, plane-aware
//   - latch: faceplate pocket + routing taken out of each enabled latch instance (drill-out kept), as NidoOptimise
//   - NidoVergePlate: Dep 4.5, features 4.5, toolpaths = NidoOptimise's (Maestro-computed at 4.5) moved into place
//   - --8427: the 8mm E024 holes taken out of the face instances; plate pilots (E022 3mm, 3 deep, cloned from the
//     Nido8423 dummy) added after each face, X/Y driven by expressions (LH Doorknob-135/+65, RH dx1-Doorknob+135/-65)
import { readPgmx, getXml, writePgmx } from '../../src/engine/archive';
import { Ids, cloneBlocks } from '../../src/engine/pgmx';
import { assertSafe } from '../../src/engine/validate';
import { setVariables, variableValues, expressions } from '../../src/engine/variables';
import { evaluate } from '../../src/engine/formula';
import { stepBlocks, translateGeometry, translateOperation, splice, one, r6 } from './lib';

const args = process.argv.slice(2);
const flag = (f: string) => { const i = args.indexOf(f); if (i < 0) return false; args.splice(i, 1); return true; };
const LH = flag('--lh'), N8427 = flag('--8427'), KEEP = flag('--keep-latch-plate');
const [basePath, optPath, dummyPath, out, name, knobS] = args;
const KNOB = +knobS;
const a = readPgmx(basePath); const orig = getXml(a);
const opt = getXml(readPgmx(optPath)); const dummy = getXml(readPgmx(dummyPath));
const log: string[] = [];

type Inst = { id: string; name: string; enabled: boolean; start: number; end: number; text: string };
const instances = (t: string): Inst[] => [...t.matchAll(/<Executable i:type="VisualSubProgram"><Key[^>]*><ID>(\d+)<\/ID>.*?<Name[^>]*>([^<]*)<\/Name><Description\/><IsEnabled>(\w+)/gs)].map((m) => {
  const end = t.indexOf('</FileName></Executable>', m.index!) + '</FileName></Executable>'.length;
  return { id: m[1], name: m[2], enabled: m[3] === 'true', start: m.index!, end, text: t.slice(m.index!, end) };
});
const expanded = (t: string, i: Inst) => { const es = i.text.indexOf('<Elements>'); return es >= 0 && es < 3000 ? stepBlocks(t, i.text.slice(es, i.text.indexOf('</Elements>'))) : null; };
const planeName = (t: string, g: string) => { const pid = one(/<a:PlaneID[^>]*><b:ID>(\d+)/, g, 'plane id')[1]; return one(new RegExp('<Plane[^>]*><Key[^>]*><ID>' + pid + '</ID><ObjectType>[^<]*</ObjectType></Key><Name[^>]*>([^<]*)<'), t, 'plane ' + pid)[1]; };
// plane delta -> world delta for toolpaths (Back: plane x = dx1 - X, plane y = Z)
const worldDelta = (pl: string, dx: number, dy: number): [number, number, number] => {
  if (pl === 'Top') return [dx, dy, 0];
  if (pl === 'Back') return [-dx, 0, dy];
  throw new Error('plane ' + pl + ' not handled');
};
const replaceUnique = (t: string, edits: [number, number, string][], blk: string, nb: string) => {
  const at = t.indexOf(blk); if (at < 0 || t.indexOf(blk, at + 1) >= 0) throw new Error('block not unique');
  if (!edits.some((e) => e[0] === at)) edits.push([at, at + blk.length, nb]);
};
const removeBlock = (t: string, edits: [number, number, string][], blk: string) => replaceUnique(t, edits, blk, '');

// ---- 1. hand formulas (LH) + Doorknob: move instances
let t = orig;
{
  const before = variableValues(t);
  t = setVariables(t, { Doorknob: KNOB }).xml;
  const after = variableValues(t);
  const lhMap: Record<string, string> = { 'dx1-Doorknob': 'Doorknob', 'dx1-Doorknob+80': 'Doorknob-80', 'Doorknob': 'dx1-Doorknob', 'Doorknob-80': 'dx1-Doorknob+80' };
  const ins = instances(t); const edits: [number, number, string][] = [];
  for (const e of [...t.matchAll(/<a:Expression>.*?<\/a:Expression>/gs)]) {
    const ex = e[0]; const ref = one(/<a:ReferencedObject[^>]*><b:ID>(\d+)<\/b:ID><b:ObjectType>([^<]*)/, ex, 'ref');
    const inst = ins.find((i) => i.id === ref[1]); const formula = one(/<a:Value>([^<]*)</, ex, 'value')[1];
    const before0 = (() => { try { return evaluate(formula, before); } catch { return NaN; } })();
    let nf = formula;
    const isX = /<a:Name>CoordinateX<\/a:Name>/.test(ex), isY = /<a:Name>CoordinateY<\/a:Name>/.test(ex);
    if (LH && inst && isX && /^(7202|WindsorGalaxy|NidoVergePlate)/.test(inst.name)) {
      if (!(formula in lhMap)) throw new Error(`${inst.name}: no LH form for ${formula}`);
      nf = lhMap[formula];
      edits.push([e.index! + ex.indexOf('<a:Value>') + 9, e.index! + ex.indexOf('<a:Value>') + 9 + formula.length, nf]);
    }
    if (Number.isNaN(before0)) continue;
    let n: number; try { n = evaluate(nf, after); } catch { continue; }
    if (Math.abs(n - before0) < 1e-9) continue;
    if (/Variable|WorkPiece/.test(ref[2])) continue;
    if (!inst || !(isX || isY)) throw new Error(`${ref[2]} ${formula} changes and is not an instance coordinate`);
    const fm = one(isX ? /(<ModifyInfos><CoordinateX>)([^<]+)(<)/ : /(<ModifyInfos><CoordinateX>[^<]*<\/CoordinateX><CoordinateY>)([^<]+)(<)/, inst.text, inst.name);
    if (Math.abs(+fm[2] - before0) > 1e-6) throw new Error(`${inst.name}: stored ${fm[2]} is not ${before0}`);
    const p = inst.start + fm.index! + fm[1].length; edits.push([p, p + fm[2].length, r6(n)]);
    const d = n - before0; const b = expanded(t, inst); let k = 0;
    if (b) {
      const pl = planeName(t, b.geometries[0]); const [wx, wy, wz] = worldDelta(pl, isX ? d : 0, isY ? d : 0);
      for (const g of b.geometries) { if (planeName(t, g) !== pl) throw new Error('mixed planes'); replaceUnique(t, edits, g, translateGeometry(g, isX ? d : 0, isY ? d : 0)); }
      for (const o of b.operations) replaceUnique(t, edits, o, translateOperation(o, wx, wy, wz));
      k = b.steps.length;
    }
    log.push(`${inst.name}${inst.enabled ? '' : ' (off)'}: ${isX ? 'X' : 'Y'} ${nf !== formula ? formula + ' -> ' + nf + ', ' : ''}${before0} -> ${n}${k ? `, ${k} steps moved` : ''}`);
  }
  t = splice(t, edits);
}

const ids = new Ids(t, opt, dummy);
const gone = new Set<string>();
const dropSteps = (t: string, edits: [number, number, string][], inst: Inst, keep: (feat: string) => boolean) => {
  const b = expanded(t, inst)!;
  const keptG = new Set<string>(); const drop: number[] = [];
  b.steps.forEach((s, i) => { if (keep(b.features[i])) keptG.add(one(/<GeometryID[^>]*><b:ID>(\d+)/, b.features[i], 'gid')[1]); else drop.push(i); });
  for (const i of drop) {
    removeBlock(t, edits, b.steps[i]); removeBlock(t, edits, b.features[i]); removeBlock(t, edits, b.operations[i]);
    for (const id of [b.steps[i], b.features[i], b.operations[i]].map((x) => one(/<Key[^>]*><ID>(\d+)/, x, 'id')[1])) gone.add(id);
  }
  for (const g of b.geometries) { const gid = one(/<Key[^>]*><ID>(\d+)/, g, 'gid')[1]; if (!keptG.has(gid)) { removeBlock(t, edits, g); gone.add(gid); } }
  return drop.map((i) => one(/<Name[^>]*>([^<]*)</, b.steps[i], 'n')[1]);
};

// ---- 2. latch faceplate out, plate at 4.5, (8427) 8mm holes out
{
  const edits: [number, number, string][] = [];
  const optStep = (nm: string) => stepBlocks(opt, one(new RegExp('<Executable i:type="a:MachiningWorkingStep"[^>]*><Key[^>]*><ID>\\d+</ID><ObjectType>[^<]*</ObjectType></Key><Name[^>]*>' + nm.replace(/[()]/g, '\\$&') + '</Name>.*?</Executable>', 's'), opt, nm)[0]);
  const optPocket = optStep('Pocket(2)-NidoVergePlate'), optRout = optStep('Routing(1)-NidoVergePlate');
  const optCx = (() => { const xs = [...optPocket.geometries[0].matchAll(/\n1 (\S+) /g)].map((m) => +m[1]); return (Math.min(...xs) + Math.max(...xs)) / 2; })();
  const optV = variableValues(opt); const V = variableValues(t);
  for (const inst of instances(t).filter((i) => i.enabled)) {
    if (KEEP && /^(WindsorGalaxy|NidoVergePlate)/.test(inst.name)) continue;
    if (/^WindsorGalaxy.*Latch/.test(inst.name)) {
      const dropped = dropSteps(t, edits, inst, (f) => /i:type="a:ClosedPocket"/.test(f) && /<EndDepth>85<\/EndDepth>/.test(f));
      log.push(`${inst.name}: faceplate out (${dropped.join(', ')})`);
    } else if (/^NidoVergePlate/.test(inst.name)) {
      const b = expanded(t, inst)!;
      const pm = one(/(<Name>Dep<\/Name><ParameterType>UserDefined<\/ParameterType><_serializedDefaultValue[^>]*>[^<]*<\/_serializedDefaultValue><_serializedValue[^>]*>)([^<]+)(<)/, inst.text, 'Dep');
      if (pm[2] !== '4.2') throw new Error(`${inst.name} Dep ${pm[2]}`);
      edits.push([inst.start + pm.index! + pm[1].length, inst.start + pm.index! + pm[1].length + 3, '4.5']);
      const xs = [...b.geometries[0].matchAll(/\n1 (\S+) /g)].map((m) => +m[1]); const cx = (Math.min(...xs) + Math.max(...xs)) / 2;
      const dX = (V.dx1 - cx) - (optV.dx1 - optCx), dY = V.dy1 - optV.dy1;
      b.features.forEach((f, i) => {
        const nf = f.replace('<EndDepth>4.2</EndDepth><StartDepth>4.2</StartDepth>', '<EndDepth>4.5</EndDepth><StartDepth>4.5</StartDepth>');
        if (nf === f) throw new Error('plate feature depth not 4.2');
        replaceUnique(t, edits, f, nf);
        const src = /GeneralProfileFeature/.test(f) ? optRout : optPocket;
        const oid = one(/<Key[^>]*><ID>(\d+)/, b.operations[i], 'oid')[1];
        const [c] = cloneBlocks(ids, [src.operations[0]]);
        const no = translateOperation(c.replace(/(<Key[^>]*><ID>)\d+(<)/, `$1${oid}$2`), dX, dY, 0);
        replaceUnique(t, edits, b.operations[i], no);
      });
      log.push(`${inst.name}: Dep 4.5, toolpaths from NidoOptimise moved ${r6(dX)} / ${r6(dY)}`);
    } else if (N8427 && /^7202no8mmholeAdjustableDepth/.test(inst.name)) {
      // holes out the durable way: PilotsFromCenter 0 puts both drills on the handle centre, inside the drill-out
      // (Maestro re-expands macros on save, so steps taken out of an instance come back)
      const pm = one(/(<Name>PilotsFromCenter<\/Name><ParameterType>UserDefined<\/ParameterType><_serializedDefaultValue[^>]*>[^<]*<\/_serializedDefaultValue><_serializedValue[^>]*>)([^<]+)(<)/, inst.text, 'PilotsFromCenter');
      edits.push([inst.start + pm.index! + pm[1].length, inst.start + pm.index! + pm[1].length + pm[2].length, '0']);
      const cx = +one(/<ModifyInfos><CoordinateX>([^<]+)</, inst.text, 'x')[1];
      const b = expanded(t, inst)!; const moved: string[] = [];
      b.features.forEach((f, i) => {
        if (!/i:type="a:RoundHole"/.test(f)) return;
        const g = b.geometries.find((x) => x.includes(`<ID>${one(/<GeometryID[^>]*><b:ID>(\d+)/, f, 'gid')[1]}</ID>`))!;
        const d = cx - +one(/<a:_x>([^<]+)</, g, 'x')[1];
        if (Math.abs(Math.abs(d) - +pm[2]) > 1e-6) throw new Error('hole not at PilotsFromCenter');
        replaceUnique(t, edits, g, translateGeometry(g, d, 0)); replaceUnique(t, edits, b.operations[i], translateOperation(b.operations[i], d, 0, 0));
        moved.push(one(/<Name[^>]*>([^<]*)</, b.steps[i], 'n')[1]);
      });
      log.push(`${inst.name}: PilotsFromCenter ${pm[2]} -> 0 (${moved.join(', ')} on the centre)`);
    }
  }
  for (const e of t.matchAll(/<a:Expression>.*?<\/a:Expression>/gs)) {
    const ref = one(/<a:ReferencedObject[^>]*><b:ID>(\d+)/, e[0], 'ref')[1]; if (gone.has(ref)) edits.push([e.index!, e.index! + e[0].length, '']);
  }
  t = splice(t, edits);
  for (const id of gone) if (t.includes(`>${id}<`)) throw new Error('dangling reference to ' + id);
}

// ---- 3. (8427) plate pilots after each face
if (N8427) {
  const di = dummy.indexOf('>Nido8423LH</Name>'); const ds = dummy.lastIndexOf('<Executable i:type="VisualSubProgram">', di);
  const dInst = dummy.slice(ds, dummy.indexOf('</Elements>', ds));
  const tpl = stepBlocks(dummy, one(/<Executable i:type="a:MachiningWorkingStep"[^>]*><Key[^>]*><ID>\d+<\/ID><ObjectType>[^<]*<\/ObjectType><\/Key><Name[^>]*>Boring\(3\)<\/Name>.*?<\/Executable>/s, dInst, 'dummy pilot')[0]);
  const tg = tpl.geometries[0]; const tx = +one(/<a:_x>([^<]+)</, tg, 'x')[1], ty = +one(/<a:_y>([^<]+)</, tg, 'y')[1];
  const exTpl = [...t.matchAll(/<a:Expression>.*?<\/a:Expression>/gs)].map((m) => m[0]).find((e) => e.includes('<a:Name>Length</a:Name>'))!;
  let en = Math.max(...[...t.matchAll(/>\[Expression\]\((\d+)\)</g)].map((m) => +m[1]), 0);
  const V = variableValues(t);
  const fx = LH ? ['Doorknob-135', 'Doorknob+65'] : ['dx1-Doorknob+135', 'dx1-Doorknob-65'];
  const edits: [number, number, string][] = []; const feats: string[] = [], geos: string[] = [], ops: string[] = [], exprs: string[] = [];
  const faces = instances(t).filter((i) => i.enabled && /^7202no8mmholeAdjustableDepth/.test(i.name));
  if (faces.length !== 2) throw new Error('expected 2 faces, got ' + faces.map((f) => f.name));
  for (const face of faces) {
    const yEx = [...t.matchAll(/<a:Expression>.*?<\/a:Expression>/gs)].map((m) => m[0]).find((e) => e.includes(`<b:ID>${face.id}</b:ID>`) && e.includes('<a:Name>CoordinateY</a:Name>'));
    const fy = yEx ? one(/<a:Value>([^<]*)</, yEx, 'y')[1] : null;
    const Y = +one(/<ModifyInfos><CoordinateX>[^<]*<\/CoordinateX><CoordinateY>([^<]+)</, face.text, 'face y')[1];
    if (fy && Math.abs(evaluate(fy, V) - Y) > 1e-6) throw new Error('face y');
    const layer = one(/<a:LayerID[^>]*><b:ID>(\d+)/, expanded(t, face)!.geometries[0], 'layer')[1];
    const sfx = face.name.slice('7202no8mmholeAdjustableDepth'.length);
    const steps: string[] = [];
    fx.forEach((f, k) => {
      const X = evaluate(f, V);
      const [s, fe, g, o] = cloneBlocks(ids, [tpl.steps[0], tpl.features[0], tg, tpl.operations[0]]);
      steps.push(s.replace(/(<Name[^>]*>)Boring\(3\)(<)/, `$1Pilot${k ? '(1)' : ''}-Nido8427Plate${sfx}$2`));
      feats.push(fe);
      const gg = translateGeometry(g, X - tx, Y - ty).replace(/(<a:LayerID[^>]*><b:ID>)\d+(<)/, `$1${layer}$2`).replace(/(<Key[^>]*><ID>\d+<\/ID><ObjectType>[^<]*<\/ObjectType><\/Key><Name[^>]*>)[^<]*(<)/, '$1Nido8427Plate$2');
      geos.push(gg); ops.push(translateOperation(o, X - tx, Y - ty, 0));
      const gid = one(/<Key[^>]*><ID>(\d+)/, gg, 'gid')[1];
      const mk = (prop: string, v: string) => exTpl.replace(/<ID>\d+<\/ID>/, `<ID>${ids.take()}</ID>`).replace(/\[Expression\](\(\d+\))?/, `[Expression](${++en})`)
        .replace('<a:Name>Length</a:Name>', `<a:Name>${prop}</a:Name>`).replace(/(<a:ReferencedObject[^>]*><b:ID>)\d+(<\/b:ID><b:ObjectType>)[^<]*/, `$1${gid}$2ScmGroup.XCam.MachiningDataModel.Geometry.GeomCartesianPoint`)
        .replace(/<a:Value>[^<]*</, `<a:Value>${v}<`);
      exprs.push(mk('X', f)); if (fy) exprs.push(mk('Y', fy));
      log.push(`Pilot${k ? '(1)' : ''}-Nido8427Plate${sfx}: ${r6(X)} / ${r6(Y)}  (X = ${f}${fy ? ', Y = ' + fy : ''})`);
    });
    edits.push([face.end, face.end, steps.join('')]);
  }
  const at = (tag: string) => t.indexOf(`</${tag}>`);
  edits.push([at('Features'), at('Features'), feats.join('')], [at('Geometries'), at('Geometries'), geos.join('')], [at('Operations'), at('Operations'), ops.join('')], [at('Expressions'), at('Expressions'), exprs.join('')]);
  t = splice(t, edits);
}

assertSafe(orig, t);
writePgmx(a, t, out, name);
console.log(name + '\n  ' + log.join('\n  '));
