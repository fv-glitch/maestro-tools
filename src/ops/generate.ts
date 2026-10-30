/**
 * Door + jamb generator, v1.
 *
 * Copies Shane's masters and sets the job's variables. Derived variables are recomputed here;
 * macro placements, hinge positions etc. are re-evaluated by Maestro when it opens the file.
 * The alignment check then reads the machining stored in the generated files - if Maestro has not
 * yet applied a size change, the check shows it (re-check after opening and saving in Maestro).
 *
 * Hands (Shane, Oct 31 2026): one LH-hinge door program serves both hands; the hardware is machined
 * on the other side. The handle is at `height` for one hand and at `dx1 - height` for the other
 * (door turned end for end). The jamb uses the LH or RH master; Lockposition is always the real height.
 */
import { readPgmx, getXml, writePgmx } from '../engine/archive';
import { setVariables, dependents, variableValues } from '../engine/variables';
import { assertSafe } from '../engine/validate';
import { alignDoorJamb, type AlignmentReport, type DoorEnd } from '../check/alignment';
import * as path from 'node:path';

export interface Job {
  jobNo: string; customer: string; quantity?: number;
  hand: 'LH' | 'RH';
  length: number; width: number; thickness: number; solidCore: boolean;
  range: 'APEX';                       // Windsor Apex: Futura door macros + ApexStriker1
  handleHeight: number;                // from the floor
  jamb: { width: number; thickness: number; footClearance: number; mitre: boolean };
}

export interface Masters { door: string; jambLH: string; jambRH: string }
/** Which hand gets handle = height (door X0 at the bottom). The other hand gets dx1 - height. */
export interface GenOptions { heightHand: 'LH' | 'RH'; outDir: string }

export interface Generated {
  doorPath: string; jambPath: string;
  doorChanges: { name: string; from: string; to: string; derived: boolean }[];
  jambChanges: { name: string; from: string; to: string; derived: boolean }[];
  /** Formulas on macros/steps that read a changed variable - Maestro re-evaluates these on open. */
  pendingInMaestro: { door: number; jamb: number };
  /**
   * 'final'      : nothing for Maestro to re-evaluate; the alignment below is what will cut.
   * 'provisional': open both files in Maestro, save, and run the check again before cutting -
   *                the stored machining (and so this alignment) may still be the master's.
   */
  status: 'final' | 'provisional';
  alignment: AlignmentReport;
}

const safe = (s: string) => s.replace(/[\\/:*?"<>|]+/g, '-').trim();

export function jobStem(job: Job, part: 'Door' | 'Jamb'): string {
  return safe([job.jobNo, job.customer, part, job.hand].filter(Boolean).join(' '));
}

export function generate(job: Job, masters: Masters, opt: GenOptions): Generated {
  if (job.range !== 'APEX') throw new Error('only the APEX range is set up so far');
  if (job.handleHeight <= 0 || job.handleHeight >= job.length) throw new Error('handle height must be inside the door');
  const doorX0: DoorEnd = job.hand === opt.heightHand ? 'bottom' : 'top';

  const da = readPgmx(masters.door); const d0 = getXml(da);
  const dv = variableValues(d0);
  const doorInputs: Record<string, number> = {
    dx1: job.length, DoorSize: job.width, dz1: job.thickness,
    Doorknob: doorX0 === 'bottom' ? job.handleHeight : job.length - job.handleHeight,
  };
  if ('SC' in dv) doorInputs.SC = job.solidCore ? 1 : 0;
  if ('LH' in dv) { doorInputs.LH = job.hand === 'LH' ? 1 : 0; doorInputs.RH = job.hand === 'RH' ? 1 : 0; }
  const door = setVariables(d0, doorInputs);
  assertSafe(d0, door.xml);

  const ja = readPgmx(job.hand === 'LH' ? masters.jambLH : masters.jambRH); const j0 = getXml(ja);
  const jambInputs: Record<string, number> = {
    doorlength: job.length, Lockposition: job.handleHeight, JambWidth: job.jamb.width, JambThickness: job.jamb.thickness,
    footclearance: job.jamb.footClearance, Mitre: job.jamb.mitre ? 1 : 0, SC: job.solidCore ? 1 : 0,
  };
  // The LH/RH jamb masters differ in which steps Maestro has enabled and expanded, so the hand is
  // chosen by master file, never by flipping LH/RH here.
  const jv = variableValues(j0);
  if (jv.LH !== (job.hand === 'LH' ? 1 : 0) || jv.RH !== (job.hand === 'RH' ? 1 : 0)) {
    throw new Error(`jamb master for ${job.hand} has LH=${jv.LH} RH=${jv.RH} - wrong master file?`);
  }
  const jamb = setVariables(j0, jambInputs);
  assertSafe(j0, jamb.xml);

  const doorStem = jobStem(job, 'Door'), jambStem = jobStem(job, 'Jamb');
  const doorPath = path.join(opt.outDir, doorStem + '.pgmx'), jambPath = path.join(opt.outDir, jambStem + '.pgmx');
  for (const p of [doorPath, jambPath]) if ([masters.door, masters.jambLH, masters.jambRH].some((m) => path.resolve(m) === path.resolve(p))) throw new Error('refusing to overwrite a master: ' + p);
  writePgmx(da, door.xml, doorPath, doorStem);
  writePgmx(ja, jamb.xml, jambPath, jambStem);

  const pending = { door: dependents(door.xml, door.changes.map((c) => c.name)).length, jamb: dependents(jamb.xml, jamb.changes.map((c) => c.name)).length };
  return {
    doorPath, jambPath, doorChanges: door.changes, jambChanges: jamb.changes, pendingInMaestro: pending,
    status: pending.door + pending.jamb === 0 ? 'final' : 'provisional',
    alignment: alignDoorJamb(door.xml, jamb.xml, doorX0, { handleHeight: job.handleHeight }),
  };
}
