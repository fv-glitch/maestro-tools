/**
 * Stringer programs. The template is Shane's first stair test (fixtures/stair-test.pgmx, made in Maestro from
 * test-stringer-3R-v2.dxf): step 'Outline Pocket' = every tread and riser housing as ONE ClosedPocket on the
 * Top plane, E019, 12 deep, 2 levels of 6, with the toolpath Maestro computed.
 *
 * That project has no bars/cups and no Xn park move, so the M100 rejects it. Here the step is cloned onto the
 * emptied TestingDoorReal (blankProgram), which carries TDR's setup. Shane sets the bars and cups by hand at the
 * machine, so the setup is only there to keep the machine happy.
 *
 * We cannot compute a polygon pocket toolpath yet, so only the stair the template was drawn for can be written:
 * the geometry and toolpath are cloned unchanged and are only re-pointed at TDR's workpiece, Top plane and layer.
 */
import { Ids, blocks, cloneBlocks, renameStep, splice, NS_PROJECT } from '../engine/pgmx';
import { blankProgram, planeId } from './cabinet';
import { housedStringer, type StairInput } from './stair';

const UTIL = 'http://schemas.datacontract.org/2004/07/ScmGroup.XCam.MachiningDataModel.Utility';

/** The stair the template pocket was drawn for (test-stringer-3R-v2.dxf). */
export const TEST_STAIR: StairInput = { totalRise: 540, treadT: 32, riserT: 18, stringerW: 290, stringerT: 42 };
export const TEST_STEP = 'Outline Pocket';

const idOf = (t: string, objectType: string, re = ''): string => {
  const m = new RegExp(`<Key[^>]*><ID>(\\d+)</ID><ObjectType>ScmGroup\\.XCam\\.MachiningDataModel\\.${objectType}</ObjectType></Key>${re}`, 's').exec(t);
  if (!m) throw new Error('no ' + objectType); return m[1];
};

/**
 * Test stringer: TDR blank of L x 290 x 42 plus the cloned housing pocket. L is the stringer length rounded
 * up to the next whole mm (the level end cuts are not machined).
 */
export function testStringerProgram(tdr: string, stairPgmxXml: string): { xml: string; L: number; W: number; T: number } {
  const lay = housedStringer(TEST_STAIR);
  const L = Math.ceil(lay.length), W = TEST_STAIR.stringerW, T = TEST_STAIR.stringerT;
  const base = blankProgram(tdr, L, W, T);
  const src = blocks(stairPgmxXml, TEST_STEP);
  // external refs of the template step -> the blank's own objects
  const geo = src[2];
  const refs: [string, string][] = [
    [/<a:WorkPieceID[^>]*><b:ID>(\d+)/.exec(geo)![1], idOf(base, 'ProjectModule\\.WorkPiece')],
    [/<a:PlaneID[^>]*><b:ID>(\d+)/.exec(geo)![1], planeId(base, 'Top')],
    [/<a:LayerID[^>]*><b:ID>(\d+)/.exec(geo)![1], idOf(base, 'Layers\\.Layer')],
  ];
  if (planeId(stairPgmxXml, 'Top') !== refs[1][0]) throw new Error('template pocket is not on the Top plane');
  const ids = new Ids(base, stairPgmxXml);
  let [st, fm, gm, om] = cloneBlocks(ids, src).map((b) => refs.reduce((s, [a, z]) => s.split('>' + a + '<').join('>' + z + '<'), b));
  st = renameStep(st, 'E019 16mm - Stringer housings', true);
  const group = `<Executable i:type="a:ExecutableGroup" xmlns:a="${NS_PROJECT}"><Key xmlns="${UTIL}"><ID>${ids.take()}</ID>` +
    `<ObjectType>ScmGroup.XCam.MachiningDataModel.ProjectModule.ExecutableGroup</ObjectType></Key><Name xmlns="${UTIL}">Stringer</Name>` +
    `<Description/><IsEnabled>true</IsEnabled><Priority>0</Priority><Elements>${st}</Elements></Executable>`;
  const park = base.indexOf('<Executable i:type="Xn">');
  const at = (tag: string) => base.indexOf(`</${tag}>`);
  const xml = splice(base, [[park, park, group], [at('Features'), at('Features'), fm], [at('Geometries'), at('Geometries'), gm], [at('Operations'), at('Operations'), om]]);
  return { xml, L, W, T };
}
