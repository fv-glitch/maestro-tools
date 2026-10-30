# Maestro Tools

Standalone CNC/CAM tools for the SCM Maestro programs used at Central ITM.
Desktop app: Electron + TypeScript. Feed it job info, get `.pgmx` programs out.

## Tools

| Tool | Status |
|---|---|
| **Engine** - read/write `.pgmx`, exact-text edits, clone steps across programs, parameters, groups, validators | done, parity-tested |
| **Door + jamb generator** - job form to matching door + jamb programs (Windsor Apex so far), with alignment check | v1, needs a first run in Maestro |
| Hardware fitter - caliper readings to perfect-fit pockets / macros | planned |
| **Program checker** - door vs jamb hinges, screws, latch/strike, against the job | door/jamb alignment done |
| **Web service** - the same app served from a homelab (Docker), upload/download | v1 |
| **Viewer** - open any .pgmx: faces unfolded around the top, stored toolpaths by tool, step tree with groups, hide/highlight, zoom/pan | v1 |
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
