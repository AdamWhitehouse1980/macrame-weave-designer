// ── State ─────────────────────────────────────────────────────────────────────

const DEFAULT_PALETTES = [
  {
    id: 'natural',
    name: 'Natural Cotton',
    colors: [
      { hex: '#f5e6c8', name: 'Cream' },
      { hex: '#d4a96a', name: 'Caramel' },
      { hex: '#8b5e3c', name: 'Chestnut' },
      { hex: '#3d2b1f', name: 'Espresso' },
      { hex: '#c8bfb0', name: 'Stone' },
      { hex: '#7a8c7e', name: 'Sage' },
    ],
  },
  {
    id: 'bold',
    name: 'Bold & Modern',
    colors: [
      { hex: '#e63946', name: 'Crimson' },
      { hex: '#457b9d', name: 'Steel Blue' },
      { hex: '#2a9d8f', name: 'Teal' },
      { hex: '#e9c46a', name: 'Mustard' },
      { hex: '#264653', name: 'Dark Teal' },
      { hex: '#f4a261', name: 'Sandy' },
      { hex: '#ffffff', name: 'White' },
      { hex: '#1a1a1a', name: 'Black' },
    ],
  },
];

let state = {
  cols: 40,
  rows: 40,
  cellSize: 22,       // 28 * 0.8 ≈ 22
  framePad: 2,        // cells of padding at each end of every rope
  weaveType: 'plain',
  warpColors: [],
  weftColors: [],
  // cellOverrides: sparse map "col,row" -> true (flip z-depth at this cell)
  cellOverrides: {},
  palettes: JSON.parse(JSON.stringify(DEFAULT_PALETTES)),
  activePaletteId: 'natural',
  selectedColorHex: DEFAULT_PALETTES[0].colors[0].hex,
  selectedRopes: [], // array of { type, index }
  currentProjectName: 'Untitled Design',
};

// ── Persistence ───────────────────────────────────────────────────────────────

function saveProject(name) {
  const projects = loadProjects();
  const id = name.toLowerCase().replace(/\s+/g, '-') + '-' + Date.now();
  const existing = Object.values(projects).find(p => p.name === name);
  const key = existing ? existing.id : id;
  const entry = {
    id: key,
    name,
    savedAt: new Date().toISOString(),
    data: {
      cols: state.cols,
      rows: state.rows,
      cellSize: state.cellSize,
      framePad: state.framePad,
      weaveType: state.weaveType,
      warpColors: state.warpColors,
      weftColors: state.weftColors,
      cellOverrides: state.cellOverrides,
      palettes: state.palettes,
      activePaletteId: state.activePaletteId,
    },
  };
  localStorage.setItem('mwd-project-' + key, JSON.stringify(entry));
  state.currentProjectName = name;
  return key;
}

function loadProjects() {
  const out = {};
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (k && k.startsWith('mwd-project-')) {
      try {
        const p = JSON.parse(localStorage.getItem(k));
        out[p.id] = p;
      } catch {}
    }
  }
  return out;
}

function loadProject(id) {
  const raw = localStorage.getItem('mwd-project-' + id);
  if (!raw) return;
  const entry = JSON.parse(raw);
  const d = entry.data;
  state.cols = d.cols;
  state.rows = d.rows;
  state.cellSize = d.cellSize ?? state.cellSize;
  state.framePad = d.framePad ?? 2;
  state.weaveType = d.weaveType ?? 'plain';
  state.warpColors = d.warpColors;
  state.weftColors = d.weftColors;
  state.cellOverrides = d.cellOverrides ?? {};
  state.palettes = d.palettes ?? state.palettes;
  state.activePaletteId = d.activePaletteId ?? state.activePaletteId;
  state.currentProjectName = entry.name;
  state.selectedRopes = [];
  syncInputsFromState();
  renderAll();
}

function deleteProject(id) {
  localStorage.removeItem('mwd-project-' + id);
}

// ── Rope colour helpers ───────────────────────────────────────────────────────

function initRopeColors() {
  const palette = activePalette();
  const c0 = palette.colors[0]?.hex ?? '#cccccc';
  state.warpColors = Array.from({ length: state.cols }, () => [
    { colorHex: c0, end: state.rows },
  ]);
  state.weftColors = Array.from({ length: state.rows }, () => [
    { colorHex: c0, end: state.cols },
  ]);
  state.cellOverrides = {};
}

function ensureRopeLengths() {
  while (state.warpColors.length < state.cols) {
    const c = activePalette().colors[0]?.hex ?? '#cccccc';
    state.warpColors.push([{ colorHex: c, end: state.rows }]);
  }
  state.warpColors.length = state.cols;

  while (state.weftColors.length < state.rows) {
    const c = activePalette().colors[0]?.hex ?? '#cccccc';
    state.weftColors.push([{ colorHex: c, end: state.cols }]);
  }
  state.weftColors.length = state.rows;

  state.warpColors.forEach(segs => {
    if (segs.length) segs[segs.length - 1].end = state.rows;
  });
  state.weftColors.forEach(segs => {
    if (segs.length) segs[segs.length - 1].end = state.cols;
  });

  // Drop overrides that are now out of bounds
  for (const key of Object.keys(state.cellOverrides)) {
    const [c, r] = key.split(',').map(Number);
    if (c >= state.cols || r >= state.rows) delete state.cellOverrides[key];
  }
}

function warpColorAt(col, row) {
  const segs = state.warpColors[col] ?? [];
  for (const seg of segs) {
    if (row < seg.end) return seg.colorHex;
  }
  return segs[segs.length - 1]?.colorHex ?? '#888';
}

function weftColorAt(row, col) {
  const segs = state.weftColors[row] ?? [];
  for (const seg of segs) {
    if (col < seg.end) return seg.colorHex;
  }
  return segs[segs.length - 1]?.colorHex ?? '#888';
}

// Is this cell in the frame-padding zone?
function isPadCell(col, row) {
  const p = state.framePad;
  return col < p || col >= state.cols - p || row < p || row >= state.rows - p;
}

// Is warp on top at this cell? Respects per-cell overrides.
function warpOnTop(col, row) {
  let base;
  if (state.weaveType === 'plain') {
    base = (col + row) % 2 === 0;
  } else if (state.weaveType === 'twill') {
    base = ((col - row) % 4 + 4) % 4 < 2;
  } else if (state.weaveType === 'twill31') {
    base = ((col - row) % 4 + 4) % 4 < 3;
  } else if (state.weaveType === 'basket') {
    base = (Math.floor(col / 2) + Math.floor(row / 2)) % 2 === 0;
  } else if (state.weaveType === 'rib') {
    base = row % 2 === 0;
  } else {
    base = (col + row) % 2 === 0;
  }
  return state.cellOverrides[`${col},${row}`] ? !base : base;
}

// Base weave depth ignoring per-cell overrides — used by setDepth.
function baseWarpOnTop(col, row) {
  if (state.weaveType === 'plain')   return (col + row) % 2 === 0;
  if (state.weaveType === 'twill')   return ((col - row) % 4 + 4) % 4 < 2;
  if (state.weaveType === 'twill31') return ((col - row) % 4 + 4) % 4 < 3;
  if (state.weaveType === 'basket')  return (Math.floor(col / 2) + Math.floor(row / 2)) % 2 === 0;
  if (state.weaveType === 'rib')     return row % 2 === 0;
  return (col + row) % 2 === 0;
}

// Set cell to warpShouldBeOnTop, adding/removing override as needed. Returns true if changed.
function setDepth(col, row, warpShouldBeOnTop) {
  const key = `${col},${row}`;
  const needsOverride = baseWarpOnTop(col, row) !== warpShouldBeOnTop;
  const hasOverride = !!state.cellOverrides[key];
  if (hasOverride === needsOverride) return false;
  if (needsOverride) state.cellOverrides[key] = true;
  else delete state.cellOverrides[key];
  return true;
}

function toggleCellOverride(col, row) {
  const key = `${col},${row}`;
  if (state.cellOverrides[key]) {
    delete state.cellOverrides[key];
  } else {
    state.cellOverrides[key] = true;
  }
}

// ── SVG rendering ─────────────────────────────────────────────────────────────

const SVG_NS = 'http://www.w3.org/2000/svg';
const HEADER = 24;

// ── Paint state (click-and-drag depth toggling) ───────────────────────────────
let _painting = false;
let _sourceDepth = null; // warpOnTop value of the source cell after its toggle
let _axis = null;        // 'h' | 'v' | null (undecided until threshold crossed)
let _startX = 0;
let _startY = 0;
let _startC = 0;
let _startR = 0;
const _painted = new Set();
let _rafPending = false;

const AXIS_THRESHOLD = 8; // px of movement before axis locks

function scheduleRender() {
  if (!_rafPending) {
    _rafPending = true;
    requestAnimationFrame(() => { _rafPending = false; renderWeave(); });
  }
}

// Convert page pointer coordinates → { c, r } in the woven zone, or null.
function cellFromPointer(clientX, clientY) {
  const svgEl = document.getElementById('weave-svg');
  if (!svgEl) return null;
  const rect = svgEl.getBoundingClientRect();
  const vb = svgEl.viewBox.baseVal;
  if (!vb || rect.width === 0) return null;
  const px = (clientX - rect.left) * (vb.width / rect.width);
  const py = (clientY - rect.top) * (vb.height / rect.height);
  const cs = state.cellSize;
  const c = Math.floor((px - HEADER) / cs);
  const r = Math.floor((py - HEADER) / cs);
  if (c < 0 || c >= state.cols || r < 0 || r >= state.rows) return null;
  const fp = state.framePad;
  if (c < fp || c >= state.cols - fp || r < fp || r >= state.rows - fp) return null;
  return { c, r };
}

// Paint cell (c,r) to match the source depth. Skips cells already painted.
function doPaint(c, r) {
  const key = `${c},${r}`;
  if (_painted.has(key)) return;
  _painted.add(key);
  if (setDepth(c, r, _sourceDepth)) scheduleRender();
}

function el(tag, attrs = {}, children = []) {
  const e = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  for (const c of children) if (c) e.appendChild(c);
  return e;
}

function renderWeave() {
  const svg = document.getElementById('weave-svg');
  svg.innerHTML = '';

  const cs = state.cellSize;
  const cols = state.cols;
  const rows = state.rows;
  const W = HEADER + cols * cs;
  const H = HEADER + rows * cs;

  svg.setAttribute('width', W);
  svg.setAttribute('height', H);
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);

  // ── Gradient defs ──
  // 4 gradients only — one highlight and one shadow per rope direction.
  // Applied via objectBoundingBox so they scale to any rect size.
  const defs = document.createElementNS(SVG_NS, 'defs');
  [
    ['gWHL', '0','0','1','0', '#fff','0.25','#fff','0'  ],  // warp: left highlight
    ['gWSH', '0','0','1','0', '#000','0',   '#000','0.25'],  // warp: right shadow
    ['gFHL', '0','0','0','1', '#fff','0.25','#fff','0'  ],  // weft: top highlight
    ['gFSH', '0','0','0','1', '#000','0',   '#000','0.25'],  // weft: bottom shadow
    // Crossing shadows: cast by top rope onto adjacent under-rope cells
    ['gXL',  '0','0','1','0', '#000','0.4', '#000','0'  ],  // dark left → fade right
    ['gXR',  '0','0','1','0', '#000','0',   '#000','0.4'],  // fade left → dark right
    ['gXT',  '0','0','0','1', '#000','0.4', '#000','0'  ],  // dark top → fade down
    ['gXB',  '0','0','0','1', '#000','0',   '#000','0.4'],  // fade up → dark bottom
  ].forEach(([id, x1,y1,x2,y2, c1,o1,c2,o2]) => {
    const g = el('linearGradient', { id, x1, y1, x2, y2, gradientUnits: 'objectBoundingBox' });
    g.appendChild(el('stop', { offset: '0', 'stop-color': c1, 'stop-opacity': o1 }));
    g.appendChild(el('stop', { offset: '1', 'stop-color': c2, 'stop-opacity': o2 }));
    defs.appendChild(g);
  });
  svg.appendChild(defs);

  // ── Background ──
  svg.appendChild(el('rect', { x: 0, y: 0, width: W, height: H, fill: '#1a1a1a' }));

  // GF: rope gradient covers this fraction of the cell on each edge (~35% matches reference)
  const GF = 0.36;
  // SF: crossing shadow width as fraction of cell (8/40 = 20% from reference)
  const SF = 0.20;

  const pn = 'pointer-events:none';

  function drawRopeCell(x, y, isWarp, col) {
    svg.appendChild(el('rect', { x, y, width: cs, height: cs, fill: col }));
    if (isWarp) {
      const gw = cs * GF;
      svg.appendChild(el('rect', { x,        y, width: gw, height: cs, fill: 'url(#gWHL)', style: pn }));
      svg.appendChild(el('rect', { x: x+cs-gw, y, width: gw, height: cs, fill: 'url(#gWSH)', style: pn }));
    } else {
      const gh = cs * GF;
      svg.appendChild(el('rect', { x, y,        width: cs, height: gh, fill: 'url(#gFHL)', style: pn }));
      svg.appendChild(el('rect', { x, y: y+cs-gh, width: cs, height: gh, fill: 'url(#gFSH)', style: pn }));
    }
  }

  const fp = state.framePad;
  function isCornerPad(c, r) {
    return (c < fp || c >= cols - fp) && (r < fp || r >= rows - fp);
  }

  // Natural rope type of a pad cell: top/bottom rows extend warp, left/right columns extend weft.
  function padIsWarp(c, r) {
    return r < fp || r >= rows - fp;
  }

  // True if neighbour (nc,nr) is the OPPOSITE rope type from currentIsWarp.
  // Uses natural type for pad cells so warp-pad↔warp-woven is treated as same type (no shadow).
  function isOtherType(nc, nr, currentIsWarp) {
    if (nc < 0 || nc >= cols || nr < 0 || nr >= rows) return false;
    if (isCornerPad(nc, nr)) return false;
    if (isPadCell(nc, nr)) return padIsWarp(nc, nr) !== currentIsWarp;
    return warpOnTop(nc, nr) !== currentIsWarp;
  }

  const sw = cs * SF;
  const pnSoft = pn + '; opacity:0.55';

  // Crossing shadows in two tiers:
  //   PRIMARY (full strength, conditional) — at run boundaries in the rope's travel direction.
  //   SECONDARY (55% opacity, unconditional for woven cells) — perpendicular direction.
  //     Always applied regardless of neighbour type, so every cell in a multi-cell run
  //     gets identical shading (no alternating light/dark within a forced band).
  function addCrossingShadows(x, y, c, r, top, isWoven) {
    if (!top) {
      // weft on top — primary left/right at run entry/exit only
      if (isOtherType(c-1, r, false)) svg.appendChild(el('rect', { x,         y, width: sw, height: cs, fill: 'url(#gXL)', style: pn }));
      if (isOtherType(c+1, r, false)) svg.appendChild(el('rect', { x: x+cs-sw, y, width: sw, height: cs, fill: 'url(#gXR)', style: pn }));
      // secondary top/bottom: always for woven cells (warp column always passes under)
      if (isWoven) {
        svg.appendChild(el('rect', { x, y,         width: cs, height: sw, fill: 'url(#gXT)', style: pnSoft }));
        svg.appendChild(el('rect', { x, y: y+cs-sw, width: cs, height: sw, fill: 'url(#gXB)', style: pnSoft }));
      }
    } else {
      // warp on top — primary top/bottom at run entry/exit only
      if (isOtherType(c, r-1, true)) svg.appendChild(el('rect', { x, y,         width: cs, height: sw, fill: 'url(#gXT)', style: pn }));
      if (isOtherType(c, r+1, true)) svg.appendChild(el('rect', { x, y: y+cs-sw, width: cs, height: sw, fill: 'url(#gXB)', style: pn }));
      // secondary left/right: always for woven cells (weft row always passes under)
      if (isWoven) {
        svg.appendChild(el('rect', { x,         y, width: sw, height: cs, fill: 'url(#gXL)', style: pnSoft }));
        svg.appendChild(el('rect', { x: x+cs-sw, y, width: sw, height: cs, fill: 'url(#gXR)', style: pnSoft }));
      }
    }
  }

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const x = HEADER + c * cs;
      const y = HEADER + r * cs;
      const wCol = warpColorAt(c, r);
      const fCol = weftColorAt(r, c);

      if (isPadCell(c, r)) {
        if (isCornerPad(c, r)) {
          svg.appendChild(el('rect', { x, y, width: cs, height: cs, fill: '#1a1a1a' }));
        } else {
          const pw = padIsWarp(c, r);
          drawRopeCell(x, y, pw, pw ? wCol : fCol);
          addCrossingShadows(x, y, c, r, pw, false); // pad cells: primary boundary shadows only
        }
        continue;
      }

      const top = warpOnTop(c, r);
      drawRopeCell(x, y, top, top ? wCol : fCol);
      addCrossingShadows(x, y, c, r, top, true);

      const hit = el('rect', { x, y, width: cs, height: cs, fill: 'transparent', style: 'cursor:crosshair; pointer-events:all' });
      hit.addEventListener('pointerdown', e => {
        e.preventDefault();
        document.getElementById('weave-svg').setPointerCapture(e.pointerId);
        _painting = true;
        _axis = null;
        _painted.clear();
        _startX = e.clientX;
        _startY = e.clientY;
        _startC = c;
        _startR = r;
        // Toggle the source cell; its new depth becomes the paint target.
        toggleCellOverride(c, r);
        _sourceDepth = warpOnTop(c, r);
        _painted.add(`${c},${r}`);
        scheduleRender();
      });
      svg.appendChild(hit);
    }
  }

  // ── Warp headers ──
  for (let c = 0; c < cols; c++) {
    const x = HEADER + c * cs;
    const topColor = warpColorAt(c, 0);
    const g = document.createElementNS(SVG_NS, 'g');
    g.setAttribute('class', 'rope-header' + (isSelectedRope('warp', c) ? ' selected' : ''));
    g.appendChild(el('rect', {
      x: x + 1, y: 1, width: cs - 2, height: HEADER - 2,
      rx: 3, fill: topColor,
      stroke: isSelectedRope('warp', c) ? '#fff' : 'none', 'stroke-width': 2,
    }));
    if (cs >= 16) {
      g.appendChild(el('text', {
        x: x + cs / 2, y: HEADER - 5,
        'text-anchor': 'middle',
        fill: contrastColor(topColor),
        'font-size': Math.max(7, cs * 0.36),
        'font-family': 'sans-serif', 'font-weight': '600',
        style: 'pointer-events:none',
      }, [document.createTextNode(c + 1)]));
    }
    g.addEventListener('click', e => selectRope('warp', c, e.metaKey || e.ctrlKey || e.shiftKey));
    svg.appendChild(g);
  }

  // ── Weft headers ──
  for (let r = 0; r < rows; r++) {
    const y = HEADER + r * cs;
    const leftColor = weftColorAt(r, 0);
    const g = document.createElementNS(SVG_NS, 'g');
    g.setAttribute('class', 'rope-header' + (isSelectedRope('weft', r) ? ' selected' : ''));
    g.appendChild(el('rect', {
      x: 1, y: y + 1, width: HEADER - 2, height: cs - 2,
      rx: 3, fill: leftColor,
      stroke: isSelectedRope('weft', r) ? '#fff' : 'none', 'stroke-width': 2,
    }));
    if (cs >= 16) {
      g.appendChild(el('text', {
        x: HEADER / 2, y: y + cs / 2 + 4,
        'text-anchor': 'middle',
        fill: contrastColor(leftColor),
        'font-size': Math.max(7, cs * 0.34),
        'font-family': 'sans-serif', 'font-weight': '600',
        style: 'pointer-events:none',
      }, [document.createTextNode(r + 1)]));
    }
    g.addEventListener('click', e => selectRope('weft', r, e.metaKey || e.ctrlKey || e.shiftKey));
    svg.appendChild(g);
  }

  svg.appendChild(el('rect', { x: 0, y: 0, width: HEADER, height: HEADER, fill: '#111' }));
}

function isSelectedRope(type, index) {
  return state.selectedRopes.some(r => r.type === type && r.index === index);
}

function selectedRopeType() {
  return state.selectedRopes[0]?.type ?? null;
}

function selectRope(type, index, additive = false) {
  if (additive && (selectedRopeType() === type || state.selectedRopes.length === 0)) {
    if (isSelectedRope(type, index)) {
      state.selectedRopes = state.selectedRopes.filter(r => !(r.type === type && r.index === index));
    } else {
      state.selectedRopes = [...state.selectedRopes, { type, index }];
    }
  } else {
    state.selectedRopes = [{ type, index }];
  }
  renderWeave();
  renderRopeSegmentEditor();
}

function selectAllRopes(type) {
  const count = type === 'warp' ? state.cols : state.rows;
  state.selectedRopes = Array.from({ length: count }, (_, i) => ({ type, index: i }));
  renderWeave();
  renderRopeSegmentEditor();
}

function contrastColor(hex) {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return (r * 299 + g * 587 + b * 114) / 1000 > 128 ? '#1a1a1a' : '#ffffff';
}

// ── Palette helpers ───────────────────────────────────────────────────────────

function activePalette() {
  return state.palettes.find(p => p.id === state.activePaletteId) ?? state.palettes[0];
}

function renderPalette() {
  const sel = document.getElementById('palette-selector');
  sel.innerHTML = '';
  state.palettes.forEach(p => {
    const btn = document.createElement('button');
    btn.textContent = p.name;
    btn.className = 'small' + (p.id === state.activePaletteId ? ' active' : '');
    btn.addEventListener('click', () => {
      state.activePaletteId = p.id;
      state.selectedColorHex = activePalette().colors[0]?.hex ?? '#cccccc';
      renderPalette();
    });
    sel.appendChild(btn);
  });

  const sw = document.getElementById('palette-swatches');
  sw.innerHTML = '';
  activePalette().colors.forEach(c => {
    const div = document.createElement('div');
    div.className = 'swatch' + (c.hex === state.selectedColorHex ? ' selected' : '');
    div.style.background = c.hex;
    div.title = c.name;
    div.addEventListener('click', () => {
      state.selectedColorHex = c.hex;
      renderPalette();
      applyColorToSelected();
    });
    sw.appendChild(div);
  });
}

function applyColorToSelected() {
  if (!state.selectedRopes.length) return;
  state.selectedRopes.forEach(({ type, index }) => {
    const segs = type === 'warp' ? state.warpColors[index] : state.weftColors[index];
    if (segs) segs[0].colorHex = state.selectedColorHex;
  });
  renderWeave();
  renderRopeSegmentEditor();
}

// ── Rope segment editor ───────────────────────────────────────────────────────

function renderRopeSegmentEditor() {
  const panel = document.getElementById('rope-segment-editor');
  const hint = document.getElementById('rope-hint');
  const title = document.getElementById('rope-panel-title');
  panel.innerHTML = '';

  const sel = state.selectedRopes;

  if (!sel.length) {
    hint.classList.remove('hidden');
    title.textContent = 'Rope segments';
    return;
  }

  hint.classList.add('hidden');
  const type = sel[0].type;
  const palette = activePalette();

  // ── Multi-select: simplified colour-apply panel ──
  if (sel.length > 1) {
    const typeLabel = type === 'warp' ? 'warp' : 'weft';
    const indices = sel.map(r => r.index + 1).sort((a, b) => a - b);
    title.textContent = `${sel.length} ${typeLabel} ropes`;

    const info = document.createElement('div');
    info.className = 'multi-select-panel';
    info.innerHTML = `<strong>Click a colour to apply to all ${sel.length} selected ${typeLabel} ropes.</strong>`;

    const strip = document.createElement('div');
    strip.className = 'segment-strip';
    palette.colors.forEach(c => {
      const sw = document.createElement('div');
      sw.className = 'seg-swatch';
      sw.style.background = c.hex;
      sw.title = c.name;
      sw.addEventListener('click', () => {
        sel.forEach(({ type: t, index: i }) => {
          const segs = t === 'warp' ? state.warpColors[i] : state.weftColors[i];
          if (segs) segs[0].colorHex = c.hex;
        });
        renderWeave();
        renderRopeSegmentEditor();
      });
      strip.appendChild(sw);
    });
    info.appendChild(strip);
    panel.appendChild(info);
    return;
  }

  // ── Single-select: full segment editor ──
  const { index } = sel[0];
  const segs = type === 'warp' ? state.warpColors[index] : state.weftColors[index];
  const maxEnd = type === 'warp' ? state.rows : state.cols;
  title.textContent = type === 'warp' ? `Warp ${index + 1} segments` : `Weft ${index + 1} segments`;

  segs.forEach((seg, si) => {
    const row = document.createElement('div');
    row.className = 'segment-row';

    const lbl = document.createElement('label');
    const prevEnd = si === 0 ? 0 : segs[si - 1].end;
    lbl.textContent = `${prevEnd + 1}–${seg.end}`;
    row.appendChild(lbl);

    const strip = document.createElement('div');
    strip.className = 'segment-strip';
    palette.colors.forEach(c => {
      const sw = document.createElement('div');
      sw.className = 'seg-swatch' + (c.hex === seg.colorHex ? ' active-seg' : '');
      sw.style.background = c.hex;
      sw.title = c.name;
      sw.addEventListener('click', () => {
        seg.colorHex = c.hex;
        renderWeave();
        renderRopeSegmentEditor();
      });
      strip.appendChild(sw);
    });
    row.appendChild(strip);

    if (si === segs.length - 1 && maxEnd - prevEnd > 1) {
      const addBtn = document.createElement('button');
      addBtn.className = 'small add-seg-btn';
      addBtn.textContent = '+';
      addBtn.title = 'Split to add a colour change';
      addBtn.addEventListener('click', () => {
        const midpoint = prevEnd + Math.ceil((seg.end - prevEnd) / 2);
        const newSeg = { colorHex: seg.colorHex, end: seg.end };
        seg.end = midpoint;
        segs.splice(si + 1, 0, newSeg);
        renderWeave();
        renderRopeSegmentEditor();
      });
      row.appendChild(addBtn);
    }

    if (si > 0) {
      const delBtn = document.createElement('button');
      delBtn.className = 'small';
      delBtn.textContent = '×';
      delBtn.title = 'Remove this segment';
      delBtn.addEventListener('click', () => {
        segs[si - 1].end = seg.end;
        segs.splice(si, 1);
        renderWeave();
        renderRopeSegmentEditor();
      });
      row.appendChild(delBtn);
    }

    panel.appendChild(row);
  });
}

// ── Palette editor ────────────────────────────────────────────────────────────

let editingPalette = null;

function openPaletteEditor(paletteId) {
  const p = state.palettes.find(x => x.id === paletteId) ?? {
    id: 'palette-' + Date.now(),
    name: 'New Palette',
    colors: [{ hex: '#cccccc', name: 'Colour 1' }],
  };
  editingPalette = JSON.parse(JSON.stringify(p));
  document.getElementById('palette-name-input').value = editingPalette.name;
  document.getElementById('palette-editor').classList.remove('hidden');
  renderColorEditorList();
}

function renderColorEditorList() {
  const list = document.getElementById('color-editor-list');
  list.innerHTML = '';
  editingPalette.colors.forEach((c, i) => {
    const row = document.createElement('div');
    row.className = 'color-entry';
    const colorIn = document.createElement('input');
    colorIn.type = 'color';
    colorIn.value = c.hex;
    colorIn.addEventListener('input', () => { c.hex = colorIn.value; });
    const nameIn = document.createElement('input');
    nameIn.type = 'text';
    nameIn.value = c.name;
    nameIn.addEventListener('input', () => { c.name = nameIn.value; });
    const del = document.createElement('button');
    del.className = 'small';
    del.textContent = '×';
    del.addEventListener('click', () => {
      editingPalette.colors.splice(i, 1);
      renderColorEditorList();
    });
    row.appendChild(colorIn);
    row.appendChild(nameIn);
    row.appendChild(del);
    list.appendChild(row);
  });
}

// ── Load modal ────────────────────────────────────────────────────────────────

function openLoadModal() {
  const projects = loadProjects();
  const list = document.getElementById('project-list');
  list.innerHTML = '';

  if (Object.keys(projects).length === 0) {
    list.innerHTML = '<p style="color:var(--text-dim);font-size:12px">No saved designs yet.</p>';
  }

  Object.values(projects).sort((a, b) => b.savedAt.localeCompare(a.savedAt)).forEach(p => {
    const row = document.createElement('div');
    row.className = 'project-item';
    const info = document.createElement('div');
    info.innerHTML = `<div class="project-name">${p.name}</div><div class="project-meta">${new Date(p.savedAt).toLocaleString()}</div>`;
    const actions = document.createElement('div');
    actions.className = 'project-actions';
    const loadBtn = document.createElement('button');
    loadBtn.className = 'small';
    loadBtn.textContent = 'Load';
    loadBtn.addEventListener('click', e => {
      e.stopPropagation();
      loadProject(p.id);
      closeModal();
    });
    const delBtn = document.createElement('button');
    delBtn.className = 'small danger';
    delBtn.textContent = '×';
    delBtn.addEventListener('click', e => {
      e.stopPropagation();
      if (confirm(`Delete "${p.name}"?`)) {
        deleteProject(p.id);
        openLoadModal();
      }
    });
    actions.appendChild(loadBtn);
    actions.appendChild(delBtn);
    row.appendChild(info);
    row.appendChild(actions);
    row.addEventListener('click', () => { loadProject(p.id); closeModal(); });
    list.appendChild(row);
  });

  document.getElementById('modal-overlay').classList.remove('hidden');
}

function closeModal() {
  document.getElementById('modal-overlay').classList.add('hidden');
}

// ── Sync inputs ───────────────────────────────────────────────────────────────

function syncInputsFromState() {
  document.getElementById('input-cols').value = state.cols;
  document.getElementById('input-rows').value = state.rows;
  document.getElementById('input-cell-size').value = state.cellSize;
  document.getElementById('input-frame-pad').value = state.framePad;
  document.getElementById('select-weave').value = state.weaveType;
}

// ── Full render ───────────────────────────────────────────────────────────────

function renderAll() {
  renderPalette();
  renderWeave();
  renderRopeSegmentEditor();
}

// ── Init & event wiring ───────────────────────────────────────────────────────

function init() {
  initRopeColors();
  syncInputsFromState();
  renderAll();

  // One-time pointer listeners for paint dragging — survive SVG re-renders
  const svgEl = document.getElementById('weave-svg');
  svgEl.addEventListener('pointermove', e => {
    if (!_painting) return;
    // Lock axis once pointer has moved past threshold
    if (_axis === null) {
      const dx = Math.abs(e.clientX - _startX);
      const dy = Math.abs(e.clientY - _startY);
      if (dx < AXIS_THRESHOLD && dy < AXIS_THRESHOLD) return;
      _axis = dx >= dy ? 'h' : 'v';
    }
    const cell = cellFromPointer(e.clientX, e.clientY);
    if (!cell) return;
    if (_axis === 'h' && cell.r !== _startR) return;
    if (_axis === 'v' && cell.c !== _startC) return;
    doPaint(cell.c, cell.r);
  });
  const stopPaint = () => { _painting = false; _painted.clear(); };
  svgEl.addEventListener('pointerup', stopPaint);
  window.addEventListener('pointerup', stopPaint);

  document.getElementById('btn-select-all-warp').addEventListener('click', () => selectAllRopes('warp'));
  document.getElementById('btn-select-all-weft').addEventListener('click', () => selectAllRopes('weft'));

  document.getElementById('input-cols').addEventListener('change', e => {
    state.cols = Math.max(4, Math.min(80, +e.target.value));
    ensureRopeLengths();
    state.selectedRopes = state.selectedRopes.filter(r => !(r.type === 'warp' && r.index >= state.cols));
    renderAll();
  });

  document.getElementById('input-rows').addEventListener('change', e => {
    state.rows = Math.max(4, Math.min(80, +e.target.value));
    ensureRopeLengths();
    if (state.selectedRopes.some(r => r.type === 'weft' && r.index >= state.rows))
      state.selectedRopes = state.selectedRopes.filter(r => !(r.type === 'weft' && r.index >= state.rows));
    renderAll();
  });

  document.getElementById('input-cell-size').addEventListener('input', e => {
    state.cellSize = +e.target.value;
    renderWeave();
  });

  document.getElementById('input-frame-pad').addEventListener('change', e => {
    state.framePad = Math.max(0, Math.min(8, +e.target.value));
    renderWeave();
  });

  document.getElementById('select-weave').addEventListener('change', e => {
    state.weaveType = e.target.value;
    state.cellOverrides = {}; // reset depth overrides; colours are unaffected
    renderWeave();
  });

  document.getElementById('btn-save').addEventListener('click', () => {
    const name = prompt('Save design as:', state.currentProjectName);
    if (name) { saveProject(name); }
  });

  document.getElementById('btn-load').addEventListener('click', openLoadModal);

  document.getElementById('btn-new').addEventListener('click', () => {
    if (!confirm('Start a new design? Unsaved changes will be lost.')) return;
    state.cols = 40; state.rows = 40; state.framePad = 2;
    state.selectedRopes = [];
    state.currentProjectName = 'Untitled Design';
    initRopeColors();
    syncInputsFromState();
    renderAll();
  });

  document.getElementById('btn-duplicate').addEventListener('click', () => {
    const name = prompt('Duplicate design as:', state.currentProjectName + ' copy');
    if (name) { saveProject(name); alert(`Saved as "${name}"`); }
  });

  document.getElementById('btn-modal-close').addEventListener('click', closeModal);
  document.getElementById('modal-overlay').addEventListener('click', e => {
    if (e.target === document.getElementById('modal-overlay')) closeModal();
  });

  document.getElementById('btn-new-palette').addEventListener('click', () => {
    openPaletteEditor(null);
  });

  document.getElementById('btn-add-color').addEventListener('click', () => {
    if (!editingPalette) return;
    editingPalette.colors.push({ hex: '#888888', name: 'Colour ' + (editingPalette.colors.length + 1) });
    renderColorEditorList();
  });

  document.getElementById('btn-save-palette').addEventListener('click', () => {
    if (!editingPalette) return;
    editingPalette.name = document.getElementById('palette-name-input').value || editingPalette.name;
    const existing = state.palettes.findIndex(p => p.id === editingPalette.id);
    if (existing >= 0) state.palettes[existing] = editingPalette;
    else state.palettes.push(editingPalette);
    state.activePaletteId = editingPalette.id;
    document.getElementById('palette-editor').classList.add('hidden');
    renderPalette();
  });

  document.getElementById('btn-delete-palette').addEventListener('click', () => {
    if (!editingPalette || state.palettes.length <= 1) return;
    if (!confirm(`Delete palette "${editingPalette.name}"?`)) return;
    state.palettes = state.palettes.filter(p => p.id !== editingPalette.id);
    state.activePaletteId = state.palettes[0].id;
    document.getElementById('palette-editor').classList.add('hidden');
    editingPalette = null;
    renderPalette();
  });
}

init();
