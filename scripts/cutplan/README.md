# Sheet cut plan (M100 saw)

Two-stage guillotine plan for a parts.json package (window wall format): rip full-length strips on the
M100 with E015 (every rip runs off both ends), then crosscut each strip on its own against the stops.
Every strip only holds pieces of exactly its width, so no third cut is ever needed. Pieces may be
turned (no grain). Strips narrower than 100 mm come off the sheet as one block for the table saw.

```
pip install "pulp==2.9.0" --break-system-packages    # CBC solver bundled
python3 ilp.py parts.json                 # -> plan.json (optimal sheets, then fewest strips)
node ../../dist/cli.js panels parts.json plan.json out --base TestingDoorReal.pgmx --itm "Beta-Optimised - Final.pgmx" --apex "APEX Passage.pgmx"
python3 runsheet.py plan.json out/index.json parts.json out/RunSheet.html
```

Settings are at the top of plan.py: sheet 2400 x 1200, trim 5 per edge, kerf 3.15, narrow 100.
`plan.py` alone is a fast heuristic (no solver) for a quick look.
