import { readFileSync, writeFileSync } from 'node:fs';
import { unzipSync, zipSync, type Zippable } from 'fflate';

/**
 * A .pgmx is a zip: `<stem>.xml` (the program) plus def.tlgx (tool library), cfgx, lbsx, lbdx, epl, bmp, opt.
 * Entry order and every non-XML entry are kept exactly as they came in.
 */
export interface PgmxArchive {
  entries: { name: string; data: Uint8Array }[];
  xmlName: string;
}

const dec = new TextDecoder('utf-8');
const enc = new TextEncoder();

export function readPgmx(path: string): PgmxArchive {
  const files = unzipSync(readFileSync(path));
  const entries = Object.keys(files).map((name) => ({ name, data: files[name] }));
  const xml = entries.find((e) => e.name.endsWith('.xml') && !e.name.includes('/'));
  if (!xml) throw new Error(`${path}: no program XML inside`);
  return { entries, xmlName: xml.name };
}

export function getXml(a: PgmxArchive): string {
  return dec.decode(a.entries.find((e) => e.name === a.xmlName)!.data);
}

export function getEntryText(a: PgmxArchive, name: string): string {
  const e = a.entries.find((x) => x.name === name);
  if (!e) throw new Error(`no entry ${name}`);
  return dec.decode(e.data);
}

/**
 * Write a .pgmx with new program text. `newStem` renames the program-named entries
 * (<stem>.xml / .epl / .bmp / .opt) the way Maestro expects for a "save as".
 */
export function writePgmx(a: PgmxArchive, xml: string, path: string, newStem?: string): void {
  const oldStem = a.xmlName.replace(/\.xml$/, '');
  const out: Zippable = {};
  for (const e of a.entries) {
    const data = e.name === a.xmlName ? enc.encode(xml) : e.data;
    const name = newStem && e.name.startsWith(oldStem + '.') ? newStem + e.name.slice(oldStem.length) : e.name;
    out[name] = [data, { level: 6 }];
  }
  writeFileSync(path, zipSync(out));
}
