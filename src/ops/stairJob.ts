/**
 * One stair job for the app and the web server: plan + checks, and (when the plan passes) a stringer program
 * written to outDir. The three templates (TestingDoorReal, the one-pocket stair test, the angled saw cuts) are the
 * owner's programs and are not in git. They are looked for, in order, in: MT_TEMPLATES, the caller's extra folders
 * (web: DATA_DIR/templates; desktop: <userData>/templates), then dist/templates (copied from a local fixtures/ at build).
 */
import { existsSync } from 'node:fs';
import * as path from 'node:path';
import { readPgmx, getXml, writePgmx } from '../engine/archive';
import { assertSafe } from '../engine/validate';
import { viewModelOf, type ViewModel } from '../view/model';
import { housedStringer, type StairInput } from './stair';
import { stringerProgram } from './stairProgram';

export interface StairForm extends StairInput { name?: string; saw?: boolean }
export interface StairResult {
  ok: boolean; problems: string[]; notes: string[];
  plan: { risers: number; treads: number; rise: number; going: number; pitchDeg: number; twoRG: number; totalGoing: number; nosing: number; housingDepth: number };
  stringer: { length: number; width: number; thickness: number; endCutAngle: number };
  file?: string; name?: string; view?: ViewModel;
}

export const TEMPLATE_FILES = { base: 'tdr-latest.pgmx', pocket: 'stair-test.pgmx', saw: 'stair-sawcuts.pgmx' };

/** First folder holding all three templates; the error names the files and every folder tried. */
export function templatesDir(extra: string[] = []): string {
  const tried = [process.env.MT_TEMPLATES, ...extra, path.join(__dirname, '..', 'templates')].filter((d): d is string => !!d);
  const files = Object.values(TEMPLATE_FILES);
  const d = tried.find((x) => files.every((f) => existsSync(path.join(x, f))));
  if (!d) throw new Error(`Stair templates not found. Put ${files.join(', ')} in one of: ${tried.join(' ; ')}`);
  return d;
}

const num = (v: unknown) => (v === undefined || v === null || v === '' ? undefined : Number(v));

export function stairJob(form: StairForm, outDir: string, tplDir = templatesDir()): StairResult {
  const s: StairInput = { totalRise: Number(form.totalRise), treadT: Number(form.treadT), riserT: Number(form.riserT), stringerW: Number(form.stringerW),
    stringerT: Number(form.stringerT), going: num(form.going), risers: num(form.risers), nosing: num(form.nosing) };
  for (const [k, v] of Object.entries(s)) if (v !== undefined && !(Number.isFinite(v) && v > 0)) throw new Error(`${k} must be a positive number`);
  const lay = housedStringer(s);
  const p = lay.plan;
  const res: StairResult = {
    ok: !lay.problems.length, problems: lay.problems, notes: p.notes,
    plan: { risers: p.risers, treads: p.treads, rise: p.rise, going: p.going, pitchDeg: p.pitchDeg, twoRG: p.twoRG, totalGoing: p.totalGoing, nosing: p.nosing, housingDepth: p.housingDepth },
    stringer: { length: Math.ceil(lay.length - 1e-9), width: s.stringerW, thickness: s.stringerT, endCutAngle: 90 - p.pitchDeg },
  };
  if (!res.ok) return res;
  const baseA = readPgmx(path.join(tplDir, TEMPLATE_FILES.base)); const base = getXml(baseA);
  const pocket = getXml(readPgmx(path.join(tplDir, TEMPLATE_FILES.pocket)));
  const saw = form.saw === false ? undefined : getXml(readPgmx(path.join(tplDir, TEMPLATE_FILES.saw)));
  const out = stringerProgram(base, pocket, s, undefined, saw);
  assertSafe(base, out.xml);
  const stem = (form.name?.trim() || `Stringer ${s.totalRise} ${p.risers}R`).replace(/[\\/:*?"<>|\u0000-\u001f]+/g, '-').slice(0, 120);
  const file = path.join(outDir, stem + '.pgmx');
  writePgmx(baseA, out.xml, file, stem);
  return { ...res, file, name: stem, view: viewModelOf(readPgmx(file), stem) };   // what the file holds, as written
}
