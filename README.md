# Maestro Tools

Standalone CNC/CAM tools for the SCM Maestro programs used at Central ITM.
Desktop app: Electron + TypeScript. Feed it job info, get `.pgmx` programs out.

## Tools

| Tool | Status |
|---|---|
| **Engine** - read/write `.pgmx`, exact-text edits, clone steps across programs, parameters, groups, validators | done, parity-tested |
| Door + jamb generator - job inputs to matching door and jamb programs | next |
| Hardware fitter - caliper readings to perfect-fit pockets / macros | planned |
| Program checker - hinge alignment, single-pass plunges, start points, file health | planned |
| DXF / logo tools | planned |

## Run

```
npm install
npm test        # engine + parity tests
npm start       # build and open the app
```

## Parity tests

`tests/parity.test.ts` replays the real builds from Oct 30 2026 (flush pull parameter, Schlage Amelia
latch set, groups, spindle helix, start point, jamb strike) and requires the output XML to be
**byte-identical** to the files that were opened in Maestro and run on the machine.

The fixtures are real shop programs and are **not committed**. Put them in `./fixtures/`
(`door-1430.pgmx`, `door-lt1.pgmx`, ..., `itm-final.pgmx`, `jamb-orig.pgmx`, `jamb-sk1.pgmx`);
tests skip when they are missing.

## Layout

```
src/engine/   archive (zip), pgmx (exact-text editing), params (variables/expressions),
              geometry (records + toolpaths), validate (safety checks), pyfmt (number format)
src/ops/      operations built on the engine (recorded.ts = the proven Oct-2026 builds)
src/main/     Electron main + preload
src/renderer/ UI
```
