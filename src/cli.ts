#!/usr/bin/env node
/**
 * maestro-tools command line.
 *   check <door.pgmx> <jamb.pgmx> [--door-x0 top]   door vs jamb alignment from the stored machining
 *   vars <file.pgmx>                                variables and their formulas
 *   steps <file.pgmx>                               enabled machining: macro, plane, depth, extents
 *   safe <file.pgmx>                                file-health checks Maestro cares about
 *   generate <job.json> <masters.json> <outDir> [--height-hand LH|RH]
 *   panels <parts.json> <plan.json|-> <outDir> --base <TestingDoorReal.pgmx> --itm <ITM.pgmx> --apex <APEX Passage.pgmx>
 *   edit <in.pgmx> <edits.json> <out.pgmx> [--itm <ITM.pgmx> --tdr <TestingDoorReal.pgmx> --apex <APEX Passage.pgmx>]
 *                                                   add steps / turn steps on or off / rename; writes a NEW file
 *   stair <out.pgmx> --base <TestingDoorReal.pgmx> --template <stair-test.pgmx> [--saw <stair-sawcuts.pgmx>] --rise 2700 [--tread 32 --riser 18 --width 290 --thick 42 --going --risers --nosing]
 */
import { readPgmx, getXml } from './engine/archive';
import { alignDoorJamb, formatReport } from './check/alignment';
import { readVariables } from './engine/variables';
import { machiningOf } from './check/machining';
import { strayTextProblems, duplicateIds } from './engine/validate';
import { generate, type Job, type Masters } from './ops/generate';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import * as path from 'node:path';
import { writePgmx } from './engine/archive';
import { assertSafe } from './engine/validate';
import { loadTemplates } from './ops/cabinet';
import { stringerProgram } from './ops/stairProgram';
import { partPrograms, sawPrograms, stripPrograms, type Part, type PlanJSON, type Program } from './ops/panelJob';
import { editFile, needsTemplates, type Edit } from './ops/edit';

const [cmd, ...args] = process.argv.slice(2);
const flag = (n: string) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : undefined; };
const xml = (p: string) => getXml(readPgmx(p));
try {
  if (cmd === 'check') console.log(formatReport(alignDoorJamb(xml(args[0]), xml(args[1]), flag('--door-x0') === 'top' ? 'top' : 'bottom')));
  else if (cmd === 'vars') for (const v of readVariables(xml(args[0]))) console.log(`${v.name.padEnd(24)} ${v.valueText.padEnd(12)} ${v.formula ? '= ' + v.formula : ''}`);
  else if (cmd === 'steps') for (const m of machiningOf(xml(args[0])).filter((x) => x.enabled)) {
    const b = m.box ? `x ${m.box.x0.toFixed(2)}..${m.box.x1.toFixed(2)} y ${m.box.y0.toFixed(2)}..${m.box.y1.toFixed(2)}` : '';
    console.log(`${(m.macro ?? '-').padEnd(28)} ${m.step.padEnd(34)} ${m.feature.padEnd(22)} ${m.plane.padEnd(10)} d${m.depth ?? '-'} ${b}`);
  }
  else if (cmd === 'safe') { const t = xml(args[0]); const s = strayTextProblems(t); console.log(s.length ? s.join('\n') : 'no stray text'); console.log('duplicate key IDs:', [...duplicateIds(t)].join(', ') || 'none'); }
  else if (cmd === 'generate') {
    const job = JSON.parse(readFileSync(args[0], 'utf8')) as Job; const masters = JSON.parse(readFileSync(args[1], 'utf8')) as Masters;
    const g = generate(job, masters, { outDir: args[2], heightHand: (flag('--height-hand') as 'LH' | 'RH') ?? 'LH' });
    console.log('door ->', g.doorPath); for (const c of g.doorChanges) console.log(`   ${c.name}: ${c.from} -> ${c.to}${c.derived ? ' (calculated)' : ''}`);
    console.log('jamb ->', g.jambPath); for (const c of g.jambChanges) console.log(`   ${c.name}: ${c.from} -> ${c.to}${c.derived ? ' (calculated)' : ''}`);
    console.log(`status: ${g.status.toUpperCase()}` + (g.status === 'provisional' ? ` - open both in Maestro, save, then: check "${g.doorPath}" "${g.jambPath}" (${g.pendingInMaestro.door + g.pendingInMaestro.jamb} formulas to apply)` : ''));
    console.log(formatReport(g.alignment));
  } else if (cmd === 'panels') {
    const baseA = readPgmx(flag('--base')!); const base = getXml(baseA);
    const tp = loadTemplates(xml(flag('--itm')!), base, xml(flag('--apex')!));
    const parts = (JSON.parse(readFileSync(args[0], 'utf8')) as { parts: Part[] }).parts;
    const plan = args[1] !== '-' ? JSON.parse(readFileSync(args[1], 'utf8')) as PlanJSON : undefined;
    const out = args[2]; const index: Record<string, unknown>[] = [];
    const write = (dir: string, pr: Program) => {
      assertSafe(base, pr.xml); const stem = pr.name.replace(/[\\/:*?"<>|]/g, '_'); mkdirSync(path.join(out, dir), { recursive: true });
      writePgmx(baseA, pr.xml, path.join(out, dir, stem + '.pgmx'), stem); index.push({ dir, file: stem + '.pgmx', name: pr.name, part: pr.part, setup: pr.setup, summary: pr.summary }); console.log(dir + '/' + stem);
    };
    for (const p of parts) for (const pr of partPrograms(p, base, tp)) write('parts', pr);
    if (plan) for (const pr of sawPrograms(plan, base, tp)) write('saw', pr);
    writeFileSync(path.join(out, 'index.json'), JSON.stringify({ programs: index, strips: plan ? [...stripPrograms(plan)] : [] }, null, 1));
  } else if (cmd === 'edit') {
    const raw = JSON.parse(readFileSync(args[1], 'utf8')) as Edit[] | { edits: Edit[] };
    const edits = Array.isArray(raw) ? raw : raw.edits;
    let tp;
    if (needsTemplates(edits)) {
      const [itm, tdr, apex] = ['--itm', '--tdr', '--apex'].map(flag);
      if (!itm || !tdr || !apex) throw new Error('adding steps needs --itm, --tdr and --apex template programs');
      tp = loadTemplates(xml(itm), xml(tdr), xml(apex));
    }
    const r = editFile(args[0], edits, args[2], tp);
    for (const l of r.log) console.log('  ' + l);
    console.log('wrote', args[2]);
    console.log('status: PROVISIONAL - open it in Maestro, check the steps, save, then view it again before cutting');
    for (const n of r.notes) console.log('  * ' + n);
  } else if (cmd === 'stair') {
    const baseA = readPgmx(flag('--base')!); const base = getXml(baseA);
    const num = (n: string, d?: number) => { const v = flag(n); return v === undefined ? d : +v; };
    const s = { totalRise: num('--rise')!, treadT: num('--tread', 32)!, riserT: num('--riser', 18)!, stringerW: num('--width', 290)!, stringerT: num('--thick', 42)!,
      going: num('--going'), risers: num('--risers'), nosing: num('--nosing') };
    const out = stringerProgram(base, xml(flag('--template')!), s, undefined, flag('--saw') ? xml(flag('--saw')!) : undefined);
    assertSafe(base, out.xml); const stem = path.basename(args[0]).replace(/\.pgmx$/i, '');
    writePgmx(baseA, out.xml, args[0], stem);
    const p = out.layout.plan;
    console.log(`${p.risers} risers of ${p.rise.toFixed(1)}, going ${p.going.toFixed(1)}, pitch ${p.pitchDeg.toFixed(1)} deg; stringer ${out.L} x ${out.W} x ${out.T}`);
    for (const n of p.notes) console.log('note: ' + n);
    console.log('PROVISIONAL - open and save in Maestro before cutting');
  } else { console.log(readFileSync(__filename, 'utf8').split('\n').slice(2, 13).join('\n')); process.exitCode = 1; }
} catch (e) { console.error('error:', (e as Error).message); process.exitCode = 1; }
