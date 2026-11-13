/**
 * Maestro .mixx cut lists (Mix projects).
 *
 * A .mixx is a zip:
 *   def.tlgx                     tool library (root)
 *   <n>/<program>.pgmx           a full copy of each program, one numbered folder each
 *   <list name>.xml              MixProject: one MixProjectElement per program
 * Elements point at their copy (PgmxFolder + PgmxName, PgmxPath empty), so a list keeps working without the
 * original programs; the copies are snapshots and do not follow later edits to the originals.
 *
 * Element layout and the per-kind constants (Field, MechanicalOptions, TableOptions, jamb blank size) are copied
 * from the owner's own 72427 list as saved by Maestro. Each element carries a copy of the program's variables
 * (all except the workpiece dims dx1..dz2) with Key ID 0, no description and FisicalUnitType UnitLess.
 */
import { readFileSync } from 'node:fs';
import * as path from 'node:path';
import { unzipSync, zipSync, type Zippable } from 'fflate';
import { readVariables, netDouble } from '../engine/variables';

export type MixKind = 'door' | 'jamb';
export interface MixEntry {
  pgmx: string;             // path to the program
  repetitions: number;
  kind: MixKind;
  folder?: number;          // folder number inside the .mixx (default: running count from firstFolder)
  size?: [number, number, number]; // blank DX/DY/DZ (default: door = dx1/dy1/dz1, jamb = dx1 x 503.4 x 29.85)
}
export interface MixOptions { listName: string; firstId?: number; firstFolder?: number; tlgx?: Uint8Array }

const U = 'http://schemas.datacontract.org/2004/07/ScmGroup.XCam.MachiningDataModel.Utility';
const KIND = {
  door: { field: 'LK', mech: '33751051', table: '11' },
  jamb: { field: 'EF', mech: '196618', table: '11' },
} as const;
const JAMB_BLANK = [503.4, 29.85]; // DY, DZ of every jamb element in the owner's list (DX = jamb dx1)

const dec = new TextDecoder('utf-8'); const enc = new TextEncoder();
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function programXml(bytes: Uint8Array): string {
  const files = unzipSync(bytes);
  const name = Object.keys(files).find((n) => n.endsWith('.xml') && !n.includes('/'));
  if (!name) throw new Error('no program XML inside');
  return dec.decode(files[name]);
}

/** The program's variables as a Mix element stores them. */
export function elementVariables(xml: string): string {
  const out: string[] = [];
  for (const v of readVariables(xml)) {
    if (/^d[xyz][12]$/.test(v.name)) continue;
    const m = new RegExp('<a:Variable><Key[^>]*><ID>' + v.id + '</ID>.*?</a:Variable>', 's').exec(xml);
    if (!m) throw new Error('variable block not found: ' + v.name);
    const b = m[0]
      .replace(/<Key[^>]*>.*?<\/Key>/s, `<Key xmlns="${U}"><ID>0</ID><ObjectType i:nil="true"/></Key>`)
      .replace(/<a:Description>[^<]*<\/a:Description>/, '<a:Description/>')
      .replace(/<a:FisicalUnitType>[^<]*<\/a:FisicalUnitType>/, '<a:FisicalUnitType>UnitLess</a:FisicalUnitType>');
    out.push(b);
  }
  return out.join('');
}

function maxId(xml: string): number { let m = 0; for (const x of xml.matchAll(/<ID>(\d+)<\/ID>/g)) m = Math.max(m, +x[1]); return m; }

export function buildMixx(entries: MixEntry[], o: MixOptions): Uint8Array {
  const progs = entries.map((e) => ({ e, bytes: new Uint8Array(readFileSync(e.pgmx)) }));
  const xmls = progs.map((p) => programXml(p.bytes));
  let id = o.firstId ?? Math.max(...xmls.map(maxId)) + 1;
  let folder = o.firstFolder ?? 1;
  const zip: Zippable = {};
  const tlgx = o.tlgx ?? unzipSync(progs[0].bytes)['def.tlgx'];
  if (!tlgx) throw new Error('no def.tlgx in the first program; pass one');
  zip['def.tlgx'] = [tlgx, { level: 6 }];
  const els: string[] = [];
  const used = new Set<number>();
  progs.forEach(({ e, bytes }, i) => {
    const xml = xmls[i]; const vals = Object.fromEntries(readVariables(xml).map((v) => [v.name, v.value]));
    const f = e.folder ?? folder++; if (used.has(f)) throw new Error('folder used twice: ' + f); used.add(f);
    const file = path.basename(e.pgmx); const stem = file.replace(/\.pgmx$/i, '');
    const k = KIND[e.kind];
    const size = e.size ?? (e.kind === 'door' ? [vals.dx1, vals.dy1, vals.dz1] : [vals.dx1, JAMB_BLANK[0], JAMB_BLANK[1]]);
    if (size.some((x) => !Number.isFinite(x))) throw new Error(stem + ': no blank size');
    if (!(e.repetitions >= 1 && Number.isInteger(e.repetitions))) throw new Error(stem + ': repetitions must be a whole number >= 1');
    zip[`${f}/${file}`] = [bytes, { level: 6 }];
    els.push(`<MixProjectElement><Key xmlns="${U}"><ID>${id++}</ID><ObjectType>ScmGroup.XCam.MachiningDataModel.ProjectModule.MixProjectElement</ObjectType></Key>` +
      `<Name xmlns="${U}">${esc(stem)}</Name><BX>0</BX><BY>0</BY><BZ>0</BZ><DX>${netDouble(size[0])}</DX><DY>${netDouble(size[1])}</DY><DZ>${netDouble(size[2])}</DZ>` +
      `<EnableFittingDrillsSimpleSplitting>false</EnableFittingDrillsSimpleSplitting><Field>${k.field}</Field><IsContinuosCycle>false</IsContinuosCycle>` +
      `<IsMM>true</IsMM><IsOddEvenExecution>false</IsOddEvenExecution><LoadWorkPieceOverturned>false</LoadWorkPieceOverturned><LongitudinalLoad>0</LongitudinalLoad>` +
      `<MechanicalOptions>${k.mech}</MechanicalOptions><OptimizationMode>NormalDirect</OptimizationMode><Order i:nil="true"/>` +
      `<OverturnersData xmlns:a="http://schemas.microsoft.com/2003/10/Serialization/Arrays"/><PgmxFolder>${f}</PgmxFolder><PgmxName>${esc(file)}</PgmxName><PgmxPath/>` +
      `<Repetitions>${e.repetitions}</Repetitions><ReportParameters/><TableOptions>${k.table}</TableOptions>` +
      `<Variables xmlns:a="http://schemas.datacontract.org/2004/07/ScmGroup.XCam.MachiningDataModel.Parametrics">${elementVariables(xml)}</Variables></MixProjectElement>`);
  });
  const list = `<MixProject xmlns="http://schemas.datacontract.org/2004/07/ScmGroup.XCam.MachiningDataModel.ProjectModule" xmlns:i="http://www.w3.org/2001/XMLSchema-instance">` +
    `<Key xmlns="${U}"><ID>0</ID><ObjectType i:nil="true"/></Key><Name xmlns="${U}"/><EdgxName/><ProjectElements>${els.join('')}</ProjectElements><TlgxName>def.tlgx</TlgxName></MixProject>`;
  zip[`${o.listName}.xml`] = [enc.encode(list), { level: 6 }];
  return zipSync(zip);
}

/** Summary of an existing .mixx: one row per element. */
export function readMixx(bytes: Uint8Array): { list: string; rows: { folder: string; name: string; repetitions: number; field: string; size: string; present: boolean }[] } {
  const files = unzipSync(bytes);
  const listName = Object.keys(files).find((n) => n.endsWith('.xml') && !n.includes('/'));
  if (!listName) throw new Error('no list XML in the .mixx');
  const t = dec.decode(files[listName]);
  const rows = [...t.matchAll(/<MixProjectElement>.*?<\/MixProjectElement>/gs)].map((m) => {
    const g = (tag: string) => new RegExp(`<${tag}>([^<]*)</${tag}>`).exec(m[0])?.[1] ?? '';
    const folder = g('PgmxFolder'), name = g('PgmxName').replace(/&amp;/g, '&');
    return { folder, name, repetitions: +g('Repetitions'), field: g('Field'), size: `${g('DX')} x ${g('DY')} x ${g('DZ')}`, present: `${folder}/${name}` in files };
  });
  return { list: listName, rows };
}
