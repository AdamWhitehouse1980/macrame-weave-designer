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
  _history = []; _histIdx = -1;
  syncInputsFromState();
  renderAll();
  pushHistory();
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

// ── Canvas rendering ──────────────────────────────────────────────────────────

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

// ── Undo / Redo ───────────────────────────────────────────────────────────────
let _history = [];
let _histIdx = -1;

function pushHistory() {
  _history = _history.slice(0, _histIdx + 1);
  _history.push(JSON.parse(JSON.stringify(state.cellOverrides)));
  if (_history.length > 50) _history.shift(); else _histIdx++;
}

function undo() {
  if (_histIdx <= 0) return;
  _histIdx--;
  state.cellOverrides = JSON.parse(JSON.stringify(_history[_histIdx]));
  scheduleRender();
}

function redo() {
  if (_histIdx >= _history.length - 1) return;
  _histIdx++;
  state.cellOverrides = JSON.parse(JSON.stringify(_history[_histIdx]));
  scheduleRender();
}

// ── Auto-save ─────────────────────────────────────────────────────────────────
let _autosaveTimer = null;

function scheduleAutosave() {
  clearTimeout(_autosaveTimer);
  _autosaveTimer = setTimeout(() => {
    try {
      localStorage.setItem('mwd-autosave', JSON.stringify({
        cols: state.cols, rows: state.rows, cellSize: state.cellSize,
        framePad: state.framePad, weaveType: state.weaveType,
        warpColors: state.warpColors, weftColors: state.weftColors,
        cellOverrides: state.cellOverrides,
        palettes: state.palettes, activePaletteId: state.activePaletteId,
        currentProjectName: state.currentProjectName,
      }));
    } catch {}
  }, 1500);
}

function tryRestoreAutosave() {
  try {
    const raw = localStorage.getItem('mwd-autosave');
    if (!raw) return false;
    const d = JSON.parse(raw);
    state.cols            = d.cols            ?? state.cols;
    state.rows            = d.rows            ?? state.rows;
    state.cellSize        = d.cellSize        ?? state.cellSize;
    state.framePad        = d.framePad        ?? state.framePad;
    state.weaveType       = d.weaveType       ?? state.weaveType;
    state.warpColors      = d.warpColors      ?? state.warpColors;
    state.weftColors      = d.weftColors      ?? state.weftColors;
    state.cellOverrides   = d.cellOverrides   ?? {};
    state.palettes        = d.palettes        ?? state.palettes;
    state.activePaletteId = d.activePaletteId ?? state.activePaletteId;
    state.currentProjectName = d.currentProjectName ?? state.currentProjectName;
    return true;
  } catch { return false; }
}

// ── Export ────────────────────────────────────────────────────────────────────
function exportPNG() {
  const canvas = document.getElementById('weave-canvas');
  const a = document.createElement('a');
  a.href = canvas.toDataURL('image/png');
  a.download = (state.currentProjectName || 'weave').replace(/[^a-z0-9_\-]/gi, '_') + '.png';
  a.click();
}

function scheduleRender() {
  if (!_rafPending) {
    _rafPending = true;
    requestAnimationFrame(() => { _rafPending = false; renderWeave(); });
  }
}

// Convert page pointer coordinates → { c, r } in the woven zone, or null.
function cellFromPointer(clientX, clientY) {
  const canvas = document.getElementById('weave-canvas');
  if (!canvas) return null;
  const rect = canvas.getBoundingClientRect();
  if (rect.width === 0) return null;
  const px = clientX - rect.left;
  const py = clientY - rect.top;
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

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

function renderWeave() {
  const canvas = document.getElementById('weave-canvas');
  const dpr = window.devicePixelRatio || 1;
  const cs = state.cellSize;
  const cols = state.cols;
  const rows = state.rows;
  const W = HEADER + cols * cs + HEADER;
  const H = HEADER + rows * cs + HEADER;

  canvas.width = W * dpr;
  canvas.height = H * dpr;
  canvas.style.width = W + 'px';
  canvas.style.height = H + 'px';

  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  const GF = 0.36;
  const SF = 0.20;
  const fp = state.framePad;
  const sw = cs * SF;

  // Precompute colour lookups to avoid repeated segment scans
  const wc = Array.from({length: cols}, (_, c) =>
    Array.from({length: rows}, (_, r) => warpColorAt(c, r))
  );
  const fc = Array.from({length: rows}, (_, r) =>
    Array.from({length: cols}, (_, c) => weftColorAt(r, c))
  );

  function isCornerPad(c, r) {
    return (c < fp || c >= cols - fp) && (r < fp || r >= rows - fp);
  }
  function padIsWarp(c, r) {
    return r < fp || r >= rows - fp;
  }
  function isOtherType(nc, nr, currentIsWarp) {
    if (nc < 0 || nc >= cols || nr < 0 || nr >= rows) return false;
    if (isCornerPad(nc, nr)) return false;
    if (isPadCell(nc, nr)) return padIsWarp(nc, nr) !== currentIsWarp;
    return warpOnTop(nc, nr) !== currentIsWarp;
  }

  function drawRopeCell(x, y, isWarp, color) {
    ctx.fillStyle = color;
    ctx.fillRect(x, y, cs, cs);
    if (isWarp) {
      const gw = cs * GF;
      const hl = ctx.createLinearGradient(x, 0, x + gw, 0);
      hl.addColorStop(0, 'rgba(255,255,255,0.25)');
      hl.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = hl;
      ctx.fillRect(x, y, gw, cs);
      const sh = ctx.createLinearGradient(x + cs, 0, x + cs - gw, 0);
      sh.addColorStop(0, 'rgba(0,0,0,0.25)');
      sh.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = sh;
      ctx.fillRect(x + cs - gw, y, gw, cs);
    } else {
      const gh = cs * GF;
      const hl = ctx.createLinearGradient(0, y, 0, y + gh);
      hl.addColorStop(0, 'rgba(255,255,255,0.25)');
      hl.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = hl;
      ctx.fillRect(x, y, cs, gh);
      const sh = ctx.createLinearGradient(0, y + cs, 0, y + cs - gh);
      sh.addColorStop(0, 'rgba(0,0,0,0.25)');
      sh.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = sh;
      ctx.fillRect(x, y + cs - gh, cs, gh);
    }
  }

  function shadowH(x0, x1, y, h, alpha) {
    const g = ctx.createLinearGradient(x0, 0, x1, 0);
    g.addColorStop(0, `rgba(0,0,0,${alpha})`);
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect(Math.min(x0, x1), y, sw, h);
  }
  function shadowV(x, y0, y1, w, alpha) {
    const g = ctx.createLinearGradient(0, y0, 0, y1);
    g.addColorStop(0, `rgba(0,0,0,${alpha})`);
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect(x, Math.min(y0, y1), w, sw);
  }

  function addCrossingShadows(x, y, c, r, top, isWoven) {
    if (!top) {
      if (isOtherType(c - 1, r, false)) shadowH(x, x + sw, y, cs, 0.4);
      if (isOtherType(c + 1, r, false)) shadowH(x + cs, x + cs - sw, y, cs, 0.4);
      if (isWoven) {
        shadowV(x, y, y + sw, cs, 0.22);
        shadowV(x, y + cs, y + cs - sw, cs, 0.22);
      }
    } else {
      if (isOtherType(c, r - 1, true)) shadowV(x, y, y + sw, cs, 0.4);
      if (isOtherType(c, r + 1, true)) shadowV(x, y + cs, y + cs - sw, cs, 0.4);
      if (isWoven) {
        shadowH(x, x + sw, y, cs, 0.22);
        shadowH(x + cs, x + cs - sw, y, cs, 0.22);
      }
    }
  }

  const themeBg = getComputedStyle(document.documentElement).getPropertyValue('--bg').trim();

  // ── Background ──
  ctx.fillStyle = themeBg;
  ctx.fillRect(0, 0, W, H);

  // ── Cell grid ──
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const x = HEADER + c * cs;
      const y = HEADER + r * cs;

      if (isPadCell(c, r)) {
        if (isCornerPad(c, r)) {
          ctx.fillStyle = themeBg;
          ctx.fillRect(x, y, cs, cs);
        } else {
          const pw = padIsWarp(c, r);
          drawRopeCell(x, y, pw, pw ? wc[c][r] : fc[r][c]);
          addCrossingShadows(x, y, c, r, pw, false);
        }
        continue;
      }

      const top = warpOnTop(c, r);
      drawRopeCell(x, y, top, top ? wc[c][r] : fc[r][c]);
      addCrossingShadows(x, y, c, r, top, true);
    }
  }

  // ── Warp headers ──
  ctx.textAlign = 'center';
  ctx.textBaseline = 'bottom';
  for (let c = 0; c < cols; c++) {
    const x = HEADER + c * cs;
    const color = wc[c][0];
    const selected = isSelectedRope('warp', c);
    ctx.fillStyle = color;
    roundRect(ctx, x + 1, 1, cs - 2, HEADER - 2, 3);
    ctx.fill();
    if (selected) {
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 2;
      ctx.stroke();
    }
    if (cs >= 16) {
      ctx.font = `600 ${Math.max(7, Math.floor(cs * 0.36))}px sans-serif`;
      ctx.fillStyle = contrastColor(color);
      ctx.fillText(String(c + 1), x + cs / 2, HEADER - 4);
    }
  }

  // ── Weft headers ──
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  for (let r = 0; r < rows; r++) {
    const y = HEADER + r * cs;
    const color = fc[r][0];
    const selected = isSelectedRope('weft', r);
    ctx.fillStyle = color;
    roundRect(ctx, 1, y + 1, HEADER - 2, cs - 2, 3);
    ctx.fill();
    if (selected) {
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 2;
      ctx.stroke();
    }
    if (cs >= 16) {
      ctx.font = `600 ${Math.max(7, Math.floor(cs * 0.34))}px sans-serif`;
      ctx.fillStyle = contrastColor(color);
      ctx.fillText(String(r + 1), HEADER / 2, y + cs / 2);
    }
  }

  // ── Bottom warp headers (mirror of top) ──
  const bottomY = HEADER + rows * cs;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  for (let c = 0; c < cols; c++) {
    const x = HEADER + c * cs;
    const color = wc[c][rows - 1];
    const selected = isSelectedRope('warp', c);
    ctx.fillStyle = color;
    roundRect(ctx, x + 1, bottomY + 1, cs - 2, HEADER - 2, 3);
    ctx.fill();
    if (selected) { ctx.strokeStyle = '#fff'; ctx.lineWidth = 2; ctx.stroke(); }
    if (cs >= 16) {
      ctx.font = `600 ${Math.max(7, Math.floor(cs * 0.36))}px sans-serif`;
      ctx.fillStyle = contrastColor(color);
      ctx.fillText(String(c + 1), x + cs / 2, bottomY + 5);
    }
  }

  // ── Right weft headers (mirror of left) ──
  const rightX = HEADER + cols * cs;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  for (let r = 0; r < rows; r++) {
    const y = HEADER + r * cs;
    const color = fc[r][cols - 1];
    const selected = isSelectedRope('weft', r);
    ctx.fillStyle = color;
    roundRect(ctx, rightX + 1, y + 1, HEADER - 2, cs - 2, 3);
    ctx.fill();
    if (selected) { ctx.strokeStyle = '#fff'; ctx.lineWidth = 2; ctx.stroke(); }
    if (cs >= 16) {
      ctx.font = `600 ${Math.max(7, Math.floor(cs * 0.34))}px sans-serif`;
      ctx.fillStyle = contrastColor(color);
      ctx.fillText(String(r + 1), rightX + HEADER / 2, y + cs / 2);
    }
  }

  // ── Corners (all four) ──
  ctx.fillStyle = themeBg;
  ctx.fillRect(0, 0, HEADER, HEADER);
  ctx.fillRect(rightX, 0, HEADER, HEADER);
  ctx.fillRect(0, bottomY, HEADER, HEADER);
  ctx.fillRect(rightX, bottomY, HEADER, HEADER);

  scheduleAutosave();
}

function setupCanvasEvents() {
  const canvas = document.getElementById('weave-canvas');

  function getZone(px, py) {
    const cs = state.cellSize;
    const cols = state.cols, rows = state.rows;
    const warpEnd = HEADER + cols * cs;
    const weftEnd = HEADER + rows * cs;
    const inWarpBand = px >= HEADER && px < warpEnd;
    const inWeftBand = py >= HEADER && py < weftEnd;
    if (inWarpBand && (py < HEADER || py >= weftEnd)) {
      return { zone: 'warp-header', c: Math.floor((px - HEADER) / cs) };
    }
    if (inWeftBand && (px < HEADER || px >= warpEnd)) {
      return { zone: 'weft-header', r: Math.floor((py - HEADER) / cs) };
    }
    if (inWarpBand && inWeftBand) {
      return { zone: 'weave', c: Math.floor((px - HEADER) / cs), r: Math.floor((py - HEADER) / cs) };
    }
    return { zone: 'corner' };
  }

  canvas.addEventListener('pointerdown', e => {
    const rect = canvas.getBoundingClientRect();
    const hit = getZone(e.clientX - rect.left, e.clientY - rect.top);
    const additive = e.metaKey || e.ctrlKey || e.shiftKey;

    if (hit.zone === 'warp-header') {
      if (hit.c >= 0 && hit.c < state.cols) selectRope('warp', hit.c, additive);
      return;
    }
    if (hit.zone === 'weft-header') {
      if (hit.r >= 0 && hit.r < state.rows) selectRope('weft', hit.r, additive);
      return;
    }
    if (hit.zone !== 'weave') return;

    const { c, r } = hit;
    const fp = state.framePad;
    if (c < fp || c >= state.cols - fp || r < fp || r >= state.rows - fp) return;

    e.preventDefault();
    canvas.setPointerCapture(e.pointerId);
    _painting = true;
    _axis = null;
    _painted.clear();
    _startX = e.clientX; _startY = e.clientY;
    _startC = c; _startR = r;
    toggleCellOverride(c, r);
    _sourceDepth = warpOnTop(c, r);
    _painted.add(`${c},${r}`);
    scheduleRender();
  });

  canvas.addEventListener('pointermove', e => {
    if (!_painting) return;
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

  const stopPaint = () => {
    if (_painting) pushHistory();
    _painting = false;
    _painted.clear();
  };
  canvas.addEventListener('pointerup', stopPaint);
  window.addEventListener('pointerup', stopPaint);

  canvas.addEventListener('mousemove', e => {
    const rect = canvas.getBoundingClientRect();
    const { zone } = getZone(e.clientX - rect.left, e.clientY - rect.top);
    canvas.style.cursor =
      zone === 'warp-header' || zone === 'weft-header' ? 'pointer' :
      zone === 'weave' ? 'crosshair' : 'default';
  });
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
  document.getElementById('project-name-input').value = state.currentProjectName;
}

// ── Full render ───────────────────────────────────────────────────────────────

function renderAll() {
  renderPalette();
  renderWeave();
  renderRopeSegmentEditor();
}

// ── Init & event wiring ───────────────────────────────────────────────────────

function applyTheme(dark) {
  document.documentElement.classList.toggle('dark', dark);
  document.getElementById('btn-theme').textContent = dark ? '☽' : '☀︎';
  localStorage.setItem('mwd-theme', dark ? 'dark' : 'light');
}

function init() {
  applyTheme(localStorage.getItem('mwd-theme') === 'dark');

  if (tryRestoreAutosave()) {
    syncInputsFromState();
    renderAll();
  } else {
    initRopeColors();
    syncInputsFromState();
    renderAll();
  }
  pushHistory(); // baseline snapshot

  setupCanvasEvents();

  // ── Keyboard shortcuts ──
  document.addEventListener('keydown', e => {
    const cmd = e.metaKey || e.ctrlKey;
    if (cmd && e.key === 'z' && !e.shiftKey) { e.preventDefault(); undo(); return; }
    if (cmd && (e.key === 'Z' || (e.key === 'z' && e.shiftKey))) { e.preventDefault(); redo(); return; }
    if (cmd && e.key === 's') { e.preventDefault(); document.getElementById('btn-save').click(); return; }
    if (e.key === 'Escape' && !cmd) {
      if (state.selectedRopes.length) {
        state.selectedRopes = [];
        renderWeave();
        renderRopeSegmentEditor();
      }
    }
  });

  document.getElementById('btn-theme').addEventListener('click', () => {
    applyTheme(!document.documentElement.classList.contains('dark'));
    renderWeave();
  });

  document.getElementById('btn-undo').addEventListener('click', undo);
  document.getElementById('btn-redo').addEventListener('click', redo);
  document.getElementById('btn-export').addEventListener('click', exportPNG);

  document.getElementById('project-name-input').addEventListener('change', e => {
    state.currentProjectName = e.target.value.trim() || 'Untitled Design';
    e.target.value = state.currentProjectName;
    scheduleAutosave();
  });

  document.getElementById('btn-select-all-warp').addEventListener('click', () => selectAllRopes('warp'));
  document.getElementById('btn-select-all-weft').addEventListener('click', () => selectAllRopes('weft'));

  document.getElementById('input-cols').addEventListener('input', e => {
    const v = Math.max(4, Math.min(80, +e.target.value));
    if (!v || v === state.cols) return;
    state.cols = v;
    ensureRopeLengths();
    state.selectedRopes = state.selectedRopes.filter(r => !(r.type === 'warp' && r.index >= state.cols));
    renderAll();
  });

  document.getElementById('input-rows').addEventListener('input', e => {
    const v = Math.max(4, Math.min(80, +e.target.value));
    if (!v || v === state.rows) return;
    state.rows = v;
    ensureRopeLengths();
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
    state.cellOverrides = {};
    pushHistory();
    renderWeave();
  });

  document.getElementById('btn-save').addEventListener('click', () => {
    const name = prompt('Save design as:', state.currentProjectName);
    if (name) {
      saveProject(name);
      document.getElementById('project-name-input').value = state.currentProjectName;
    }
  });

  document.getElementById('btn-load').addEventListener('click', openLoadModal);

  document.getElementById('btn-new').addEventListener('click', () => {
    if (!confirm('Start a new design? Unsaved changes will be lost.')) return;
    state.cols = 40; state.rows = 40; state.framePad = 2;
    state.cellSize = 22;
    state.selectedRopes = [];
    state.currentProjectName = 'Untitled Design';
    initRopeColors();
    _history = []; _histIdx = -1;
    syncInputsFromState();
    renderAll();
    pushHistory();
  });

  document.getElementById('btn-duplicate').addEventListener('click', () => {
    const name = prompt('Duplicate design as:', state.currentProjectName + ' copy');
    if (name) { saveProject(name); document.getElementById('project-name-input').value = state.currentProjectName; }
  });

  document.getElementById('btn-modal-close').addEventListener('click', closeModal);
  document.getElementById('modal-overlay').addEventListener('click', e => {
    if (e.target === document.getElementById('modal-overlay')) closeModal();
  });

  document.getElementById('btn-new-palette').addEventListener('click', () => openPaletteEditor(null));

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
