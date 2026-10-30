# Maestro Tools - rules for working on this repo

Generates and edits SCM Maestro `.pgmx` programs that run on a real CNC. Mistakes cut real doors.
Shane (the owner) is a CNC operator and developer; he is locked to his current Maestro version,
so the file format is stable.

## Hard rules

1. **Never parse-and-reserialise the program XML.** Maestro's DataContract reader is strict about
   element order and rejects stray text ("Expecting state 'Element'.. Encountered 'Text'").
   All edits are surgical text splices (`src/engine/pgmx.ts`). Validators may parse read-only.
2. **Every build passes `assertSafe(before, after)`** (no stray text, balanced tags, no NEW duplicate
   Key IDs - TestingJamb ships with three and that's fine).
3. **Numbers are written with `pyRepr`** (Python repr layout). Keeps output byte-identical to the
   proven builds; do not switch to `String(n)`.
4. **Regex replacements on `_serializationGeometryDescription` must replace only the opening tag**
   (first match). Matching the closing tag too is what broke a file on Oct 30.
5. **Clone proven steps, never invent structure.** Templates live in Shane's programs/macros
   (e.g. ITM `Beta-Optimised - Final.pgmx`: Albo pilots, AlboPassage spindle helix, Futura barrel
   bore, AlboLatch faceplate pocket + 3mm routing). Remap all Key IDs via `cloneBlocks`.
6. **Keep composite element keys when an operation's `StartMachiningPoint` references them**
   (`setMembers(..., keepKeys=true)`), otherwise Maestro starts the profile somewhere else.
   Profile start: `MiddleOfMostLengthElement`, or an ElementKey on the long edge inside the part.
7. **Keep strategy flags from circle templates**: ITM circles use `IsHelicStrategy=true` with
   `AllowMultiplePasses=false`. Turning the helix off makes Maestro plunge full depth in one pass.
8. **Prefer Shane's macros (VisualSubProgram instances, `.xsp` in MaestroLab\Macros\User) and their
   parameters** over hand-editing their expanded steps. Disabled instances hold no steps; Maestro
   expands them from the macro file.
9. **Back plane (the dy1 edge): plane x = dx1 - world X**, plane y = world Z (thickness).
10. **Never overwrite a source program.** Write new files; Shane edits in Maestro between runs.
11. Parity tests must stay byte-identical. If an engine change alters output, it needs a reason
    and a machine test, not a fixture update.

## Coordinates and conventions

- Door: X along the length (X0 = bottom), Y across the width, Z thickness (top face Z = dz1).
- Jamb programs model the jamb as 0.1 thick; cuts go to negative Z. Jamb X = door X + footclearance + shiftcut (28 + 10).
- Fit clearance: measured size + 0.1 per side (16mm E019); flare relief step ~2.5 deep only when the part has a shoulder.
- Tools (def.tlgx): E016 8mm, E017 3mm, E019 16mm, E022 3mm drill (2149904617), E024 8mm drill (2149911873), E025 10mm drill.

## Hands, masters and the generator

- Door: ONE LH-hinge door program for both hands; hardware is machined on the other side.
  Handle at `height` for one hand, `dx1 - height` for the other (door turned end for end); when the
  handle is dead centre both hands are the same program. Which hand gets `height` is a setting.
- Jamb: separate LH and RH masters (they differ in which steps Maestro has enabled + expanded).
  Choose the hand by master file - never flip LH/RH variables in a jamb and trust it.
  Jamb Lockposition is always the real height off the floor.
- APEX = Windsor Apex range: Futura door macros + ApexStriker1 on the jamb.
- Generator sets input variables, recomputes derived variables (engine/formula.ts evaluates
  Maestro's formula language; trig is in degrees), writes new files, and runs the alignment check
  on the STORED machining plus job-intent rows. If any formula on a macro/step reads a changed
  variable the result is PROVISIONAL until Shane opens + saves both files in Maestro and re-checks.
  UNTESTED: whether Maestro re-evaluates everything on open - confirm on scm-pc before relying on it.

## Renderer

- Plain scripts, no ES modules (Chromium blocks module scripts from file://, which is how Electron
  loads the UI). The 3D viewer + three.js are bundled to one IIFE by esbuild in scripts/copy-renderer.mjs.
- Same UI for desktop and web: window.maestro is the Electron preload bridge or web-bridge.js (fetch).
- Viewers draw STORED toolpaths (what Maestro last computed), never re-derived geometry.

## Known open item

Hinges in the APEX masters (checker output): centre pocket+screws 0.4 low on the jamb at any length
(door centre hinge is a fixed 945.4, jamb Hinge C is a fixed 945); top pocket +0.2 (door follows
dx1-150-89.2, jamb is a fixed 1741 so it drifts when the door is not 1980); bottom screws -0.1.
Fix pending Shane's go-ahead.
