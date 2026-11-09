# Job tools

Scripts written while doing real jobs, kept so the next job starts from them. They work by text splices like the
engine (no reserialising) and every write goes through `assertSafe`. Run with `npx tsx scripts/job/<script>.ts ...`
from the repo root. They are not covered by the parity tests; check every output with the reviewers below.

## Changing programs

| Script | What it does |
|---|---|
| `applyvars.ts src out name Var=val ... [--resize] [--size-free=MacroA,MacroB]` | **Use this one.** Set variables and bring the stored program up to date: instance placements, hinge x/y parameters, straight cut lines (all plane-aware), and with `--resize` the workpiece box, planes and saw lines that change length. Refuses anything else that changes, then refuses to write if anything is left stale. Checked: 810 Cut -> 760 / 710 comes out byte-identical to the programs Maestro saved. `--size-free` names macros whose expansion does not depend on dx1/dy1/dz1 (PhoenixDummy, MRUdoorhinge89mmLeft, ShanesHingeHoles: Maestro's own expansions are identical at 510/660/810). |
| `stale.ts file [--all]` | Read only: every stored value that has a formula (placements, parameters, lines, points, box, depths, enabling) compared with the formula. Maestro-saved programs come out 0 stale. |
| `stepsoff.ts src out name "Step" ...` | Turn plain steps off (saw cuts that run separately, a magnet bore); refuses steps whose enabling is an expression. |
| `cloneinst.ts target source out name Instance --after X [--off A,B]` | Copy an enabled macro instance with its steps and expressions from a program of the same master (planes/layers/workpiece checked). |
| `setvars.ts src out name Var=val ...` | (older) | Set input variables; instances placed by `ModifyInfos.CoordinateX/Y` expressions get the new stored value and their expanded geometry/toolpaths moved. Refuses any other expression that changes. **Top plane only** for toolpath moves; `nido.ts` has the plane-aware version. |
| `nido.ts base optimise dummy out name knob [--lh] [--8427] [--keep-latch-plate]` | Nido door from a 72225-style RH Nido door: Doorknob, LH hand formulas (`dx1-Doorknob` <-> `Doorknob`, lock +/-80), plane-aware moves (Back plane: world dX = -plane dx, world dZ = plane dy), latch faceplate out / NidoVergePlate at 4.5 from NidoOptimise's toolpaths, `--8427` long plate (PilotsFromCenter 0 + plate pilots as plain steps with X/Y expressions). |
| `holes.ts target source out name "Inst1,Inst2" [--disable "A,B"]` | Turn on disabled instances (hinge holes) by copying the expanded steps of the same enabled instance from a sibling program of the same master (same instance ID and parameters, checked); `--disable` turns instances off the way Maestro stores them. |
| `fixhinge.ts src out name` | Put enabled hinge instances back on CoordinateY 0 (stray 1 mm offsets), moving their expanded steps. |
| `fixaxis.ts` | Reset ToolAxis vectors that an earlier tool translated by mistake. |
| `rhmacro.ts lh.xsp out.xsp` / `rhdoor.ts` | Nido8423RHv2: the LH dummy rose with the plate pilots mirrored in X (RH = LH rose, pilots +135/-65). |
| `rename.ts src dir stem` | Save-as under a new name (renames the inner program entries). |

## Reviewing (read only)

| Script | What it does |
|---|---|
| `steps_table.py file.pgmx` | Every enabled step in workplan order (also exploded steps), with plane, depth, diameter, tool and extents; parks and messages shown, so face order around the Unlock message can be checked. |
| `compare_saved.py saved.pgmx ours.pgmx` | What changed between two versions of a program: steps matched by type, plane and extents; depth/diameter/tool changes, new and removed steps. |
| `align_exploded.py door.pgmx jamb.pgmx LH|RH` | Door vs jamb for programs whose macros were broken up (the `check` CLI needs macro names): hinge pockets, hinge screws, latch/lock vs strikes. |
| `toolpath_on_geometry.py file.pgmx` | Toolpath centre vs geometry centre in world X for every step (circle pocket spirals and the notched dummy pocket show a small offset; that is normal). |

Cut lists: `npx tsx src/cli.ts mixx <list.json> <out.mixx>` and `mixx-read <file.mixx>` (src/ops/mixx.ts).
