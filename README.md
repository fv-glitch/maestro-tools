# Maestro Tools

Standalone CNC/CAM tools for the SCM Maestro programs used at Central ITM.
Desktop app: Electron + TypeScript. Feed it job info, get `.pgmx` programs out.

## Panel jobs (carcass / flat-pack)

`panels` turns a CNC package (`parts.json`: outline, pockets, face holes, edge holes per part, two setups F1/F0)
into one program per part per setup, plus saw programs from a cut plan (`scripts/cutplan`):

- blank program = TestingDoorReal emptied to a bare workpiece (park move, planes, setup kept)
- notches (through, E016) from the outline; housings/rebates as rectangle pockets (E016) - housing walls follow
  the `BoardT` variable (cut BoardT + 0.2 wide); 8 mm dowels (E024), 3 mm screw marks (E022); horizontal 8 mm edge
  dowels (E024) on the Left/Right/Front/Back planes; F0 setup = part turned over about X (y -> W - y)
- saw: rips along X per sheet, crosscuts along Y per strip (E015, blade centre on the plan's kerf, runs 100 past both ends)

```
node dist/cli.js panels parts.json plan.json out --base TestingDoorReal.pgmx --itm "Beta-Optimised - Final.pgmx" --apex "APEX Passage.pgmx"
```

## Tools

| Tool | Status |
|---|---|
| **Engine** - read/write `.pgmx`, exact-text edits, clone steps across programs, parameters, groups, validators | done, parity-tested |
| **Door + jamb generator** - job form to matching door + jamb programs (Windsor Apex so far), with alignment check | v1, needs a first run in Maestro |
| Hardware fitter - caliper readings to perfect-fit pockets / macros | planned |
| **Program checker** - door vs jamb hinges, screws, latch/strike, against the job | door/jamb alignment done |
| **Web service** - the same app served from a homelab (Docker), upload/download | v1 |
| **Viewer** - open any .pgmx: 2D (faces unfolded around the top) or 3D (orbit around the part), stored toolpaths by tool, step tree with groups, hide/highlight, mouse + touch. **Cut size**: the material each step removes at the real tool width (from the program's tool library), coloured by depth, with the size of each cut (e.g. `57.33 x 25.44 (X x Z), 3.06 deep`); 3D shows the simulated pockets and bores | v3 |
| DXF / logo tools | planned |

## Run

```
npm install
npm test        # engine + parity + generator tests
npm start       # build and open the app
```

Command line (after `npm run build`):

```
node dist/cli.js check "door.pgmx" "jamb.pgmx" [--door-x0 top]
node dist/cli.js generate job.json masters.json <outDir> [--height-hand LH|RH]
node dist/cli.js vars "program.pgmx"      # variables and formulas
node dist/cli.js steps "program.pgmx"     # enabled machining with extents
node dist/cli.js safe "program.pgmx"      # file-health checks
```

### First run on scm-pc

1. Setup tab: pick the APEX Passage door master, the LH and RH 112 28mm APEX Strike jambs, an output folder.
2. Generate a job with a different handle height (e.g. 1000). It will say PROVISIONAL.
3. Open both generated files in Maestro, save them, press Re-check. If the latch/strike rows now
   read 1000, Maestro re-evaluates on open and the generator is good to use.

## Parity tests

`tests/parity.test.ts` replays the real builds from Oct 30 2026 (flush pull parameter, Schlage Amelia
latch set, groups, spindle helix, start point, jamb strike) and requires the output XML to be
**byte-identical** to the files that were opened in Maestro and run on the machine.

The fixtures in `./fixtures/` are real shop programs: the before/after files of each proven build,
the APEX Passage door + LH/RH APEX Strike jamb masters, the ITM show door (template source) and
TestingDoorReal. They are left out of the Docker image and the installers.

## Layout

```
src/engine/   archive (zip), pgmx (exact-text editing), params (variables/expressions),
              geometry (records + toolpaths), validate (safety checks), pyfmt (number format)
src/ops/      operations built on the engine (recorded.ts = the proven Oct-2026 builds)
src/main/     Electron main + preload
src/renderer/ UI
```

## Install on Windows (no Node / npm needed)

Download from the repo's **Releases** page:

- `Maestro Tools-Setup-<version>.exe` - installer, adds Start menu + desktop shortcuts
- `Maestro Tools-Portable-<version>.exe` - single file, runs from anywhere (USB stick, shared folder)

Windows SmartScreen may warn because the app is not code-signed: More info -> Run anyway.

Building the installers (Linux needs Wine incl. 32-bit: `apt install wine64 wine32:i386`):

```
npm run dist        # -> release/Maestro Tools-Setup-x.y.z.exe and -Portable-x.y.z.exe
```

## Run as a web service (homelab)

Same app in a browser; files move by upload and download. Masters are uploaded once in Setup and
kept on the server (never modified). Uploads and generated files are cleaned up after a week.

```
git clone https://github.com/fv-glitch/maestro-tools && cd maestro-tools
docker compose up -d --build        # http://<host>:8080
```

- Data (masters, settings, recent files) lives in `./data`.
- Set `MT_PASSWORD` in `docker-compose.yml` to require a password (any user name).
- Without Docker: `npm install && npm run serve` (`PORT`, `DATA_DIR`, `MT_PASSWORD` env vars).
