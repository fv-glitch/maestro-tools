#!/usr/bin/env node
/**
 * maestro-tools command line.
 *   check <door.pgmx> <jamb.pgmx> [--door-x0 top]   door vs jamb alignment from the stored machining
 *   vars <file.pgmx>                                variables and their formulas
 *   steps <file.pgmx>                               enabled machining: macro, plane, depth, extents
 *   safe <file.pgmx>                                file-health checks Maestro cares about
 *   generate <job.json> <masters.json> <outDir> [--height-hand LH|RH]
 */
import { readPgmx, getXml } from './engine/archive';
import { alignDoorJamb, formatReport } from './check/alignment';
import { readVariables } from './engine/variables';
import { machiningOf } from './check/machining';
import { strayTextProblems, duplicateIds } from './engine/validate';
import { generate, type Job, type Masters } from './ops/generate';
import { readFileSync } from 'node:fs';

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
  } else { console.log(readFileSync(__filename, 'utf8').split('\n').slice(2, 9).join('\n')); process.exitCode = 1; }
} catch (e) { console.error('error:', (e as Error).message); process.exitCode = 1; }
