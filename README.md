# Macramé Weave Designer

A browser-based tool for designing woven patterns for vintage-style folding chairs. Plan colour layouts before a weaver builds the physical chair.

## Features

- Configurable warp (vertical) and weft (horizontal) rope counts
- Real over/under interlacing rendered in SVG — looks like actual macramé, not a spreadsheet
- Per-rope colour segmentation: assign multiple colours along a single rope strand
- Fixed colour palettes (Natural Cotton, Bold & Modern) — restricted to real available colours
- Create and edit custom palettes per supplier or material batch
- Plain and Twill (2/2) weave patterns
- Save/load named designs in browser localStorage
- Duplicate designs to test colourways quickly
- Zero dependencies — open `index.html` directly or serve with any static server

## Usage

```bash
# Serve locally
python3 -m http.server 7823
# Then open http://localhost:7823
```

Or just open `index.html` directly in your browser.

## Roadmap

- Tapered canvas shape (wider at top, for chair backs)
- Export as PNG / SVG
- More weave patterns (basket weave, herringbone)
- Per-segment length control (drag to resize split point)
