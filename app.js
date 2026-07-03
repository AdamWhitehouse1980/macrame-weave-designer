// ── State ─────────────────────────────────────────────────────────────────────

const DEFAULT_PALETTES = [
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
  cols: 41,
  rows: 41,
  cellSize: 22,
  framePad: 2,
  weaveType: 'plain',
  warpColors: [],
  weftColors: [],
  cellOverrides: {},
  palettes: JSON.parse(JSON.stringify(DEFAULT_PALETTES)),
  activePaletteId: 'natural',
  selectedColorHex: DEFAULT_PALETTES[0].colors[0].hex,
  selectedRopes: [],
  currentProjectName: 'Untitled Design',
  gridDivisions: 0,
  mirrorH: false,
  mirrorV: false,
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
  _history.push({
    cellOverrides: JSON.parse(JSON.stringify(state.cellOverrides)),
    warpColors:    JSON.parse(JSON.stringify(state.warpColors)),
    weftColors:    JSON.parse(JSON.stringify(state.weftColors)),
  });
  if (_history.length > 50) _history.shift(); else _histIdx++;
}

function applySnapshot(snap) {
  state.cellOverrides = JSON.parse(JSON.stringify(snap.cellOverrides));
  state.warpColors    = JSON.parse(JSON.stringify(snap.warpColors));
  state.weftColors    = JSON.parse(JSON.stringify(snap.weftColors));
  scheduleRender();
  renderRopeSegmentEditor();
  renderPalette();
}

function undo() {
  if (_histIdx <= 0) return;
  _histIdx--;
  applySnapshot(_history[_histIdx]);
}

function redo() {
  if (_histIdx >= _history.length - 1) return;
  _histIdx++;
  applySnapshot(_history[_histIdx]);
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
        gridDivisions: state.gridDivisions,
        mirrorH: state.mirrorH, mirrorV: state.mirrorV,
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
    state.gridDivisions     = d.gridDivisions     ?? 0;
    state.mirrorH           = d.mirrorH           ?? false;
    state.mirrorV           = d.mirrorV           ?? false;
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

// Returns the mirror counterparts of (c,r) that are currently enabled and in-bounds.
function getMirrorCells(c, r) {
  const mc = state.cols - 1 - c;
  const mr = state.rows - 1 - r;
  const out = [];
  if (state.mirrorH && mc !== c && !isPadCell(mc, r))   out.push([mc, r]);
  if (state.mirrorV && mr !== r && !isPadCell(c, mr))   out.push([c, mr]);
  if (state.mirrorH && state.mirrorV && mc !== c && mr !== r && !isPadCell(mc, mr)) out.push([mc, mr]);
  return out;
}

// Paint cell (c,r) to match the source depth, plus any enabled mirrors.
function doPaint(c, r) {
  const key = `${c},${r}`;
  if (_painted.has(key)) return;
  _painted.add(key);
  if (setDepth(c, r, _sourceDepth)) scheduleRender();
  for (const [mc, mr] of getMirrorCells(c, r)) {
    const mk = `${mc},${mr}`;
    if (_painted.has(mk)) continue;
    _painted.add(mk);
    if (setDepth(mc, mr, _sourceDepth)) scheduleRender();
  }
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

  // ── Grid overlay ──
  if (state.gridDivisions > 0) {
    const n = state.gridDivisions;
    const isDark = document.documentElement.classList.contains('dark');
    ctx.strokeStyle = isDark ? 'rgba(255,255,255,0.55)' : 'rgba(0,0,0,0.40)';
    ctx.lineWidth = 1.5;
    ctx.setLineDash([6, 4]);
    // Overlay spans the inner woven area only (excluding frame padding on all sides)
    const x0 = HEADER + fp * cs;
    const y0 = HEADER + fp * cs;
    const innerW = (cols - 2 * fp) * cs;
    const innerH = (rows - 2 * fp) * cs;
    for (let i = 1; i < n; i++) {
      const x = x0 + innerW * i / n;
      ctx.beginPath(); ctx.moveTo(x, y0); ctx.lineTo(x, y0 + innerH); ctx.stroke();
      const y = y0 + innerH * i / n;
      ctx.beginPath(); ctx.moveTo(x0, y); ctx.lineTo(x0 + innerW, y); ctx.stroke();
    }
    ctx.setLineDash([]);
  }

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
    for (const [mc, mr] of getMirrorCells(c, r)) {
      _painted.add(`${mc},${mr}`);
      setDepth(mc, mr, _sourceDepth);
    }
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
    // ⌘/Ctrl+click: toggle individual rope in/out of selection
    if (isSelectedRope(type, index)) {
      state.selectedRopes = state.selectedRopes.filter(r => !(r.type === type && r.index === index));
    } else {
      state.selectedRopes = [...state.selectedRopes, { type, index }];
    }
  } else if (isSelectedRope(type, index) && state.selectedRopes.length === 1) {
    // Clicking the single already-selected rope → deselect all
    state.selectedRopes = [];
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

// ── Color extraction from image ───────────────────────────────────────────────
function extractDominantColors(img, maxColors = 6) {
  // Draw image scaled to max 300px for fast sampling with enough resolution
  const MAX = 300;
  const scale = Math.min(1, MAX / Math.max(img.width, img.height));
  const w = Math.round(img.width * scale);
  const h = Math.round(img.height * scale);
  const canvas = document.createElement('canvas');
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(img, 0, 0, w, h);

  const data = ctx.getImageData(0, 0, w, h).data;

  // Quantize each pixel into coarse buckets (step=24 → ~10 steps per channel)
  // This merges similar shades into the same bucket so large flat areas dominate
  const STEP = 24;
  const freq = new Map();
  const bucketRgb = new Map(); // store sum for averaging within bucket

  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] < 200) continue; // skip transparent
    const r = data[i], g = data[i + 1], b = data[i + 2];

    // Quantize
    const qr = Math.round(r / STEP) * STEP;
    const qg = Math.round(g / STEP) * STEP;
    const qb = Math.round(b / STEP) * STEP;
    const key = (qr << 16) | (qg << 8) | qb;

    freq.set(key, (freq.get(key) ?? 0) + 1);
    if (!bucketRgb.has(key)) bucketRgb.set(key, [0, 0, 0, 0]);
    const acc = bucketRgb.get(key);
    acc[0] += r; acc[1] += g; acc[2] += b; acc[3]++;
  }

  if (!freq.size) return ['#cccccc'];

  // Sort buckets by pixel count descending (most dominant area first)
  const sorted = [...freq.entries()].sort((a, b) => b[1] - a[1]);

  // Pick top colors, skipping any too visually similar to already-chosen ones
  const colorDist = (a, b) => Math.sqrt((a[0]-b[0])**2 + (a[1]-b[1])**2 + (a[2]-b[2])**2);
  const toHex = ([r, g, b]) => '#' + [r, g, b].map(v => Math.min(255, v).toString(16).padStart(2, '0')).join('');

  const chosen = [];
  for (const [key] of sorted) {
    const acc = bucketRgb.get(key);
    const n = acc[3];
    const avg = [Math.round(acc[0] / n), Math.round(acc[1] / n), Math.round(acc[2] / n)];
    // Skip if too similar to an already-chosen color (Euclidean distance < 40)
    if (chosen.every(c => colorDist(c, avg) >= 40)) {
      chosen.push(avg);
    }
    if (chosen.length >= maxColors) break;
  }

  return chosen.map(toHex);
}

function activePalette() {
  return state.palettes.find(p => p.id === state.activePaletteId) ?? state.palettes[0];
}

// ── Colour helpers ────────────────────────────────────────────────────────────
function countRopesWithHex(hex) {
  let n = 0;
  state.warpColors.forEach(segs => { if (segs?.[0]?.colorHex === hex) n++; });
  state.weftColors.forEach(segs => { if (segs?.[0]?.colorHex === hex) n++; });
  return n;
}

function selectAllRopesWithHex(hex) {
  state.selectedRopes = [];
  state.warpColors.forEach((segs, i) => {
    if (segs?.[0]?.colorHex === hex) state.selectedRopes.push({ type: 'warp', index: i });
  });
  state.weftColors.forEach((segs, r) => {
    if (segs?.[0]?.colorHex === hex) state.selectedRopes.push({ type: 'weft', index: r });
  });
  scheduleRender();
  renderRopeSegmentEditor();
}

function replaceRopeColor(oldHex, newHex) {
  state.warpColors.forEach(segs => { if (segs?.[0]?.colorHex === oldHex) segs[0].colorHex = newHex; });
  state.weftColors.forEach(segs => { if (segs?.[0]?.colorHex === oldHex) segs[0].colorHex = newHex; });
}

// ── Inline palette colour editor ──────────────────────────────────────────────
let _pceColorObj = null; // the palette color object being edited

function openInlineColorEditor(colorObj) {
  _pceColorObj = colorObj;
  const panel = document.getElementById('palette-inline-editor');
  const oldHex = colorObj.hex;
  const ropeCount = countRopesWithHex(oldHex);

  panel.innerHTML = '';
  panel.classList.remove('hidden');

  const title = document.createElement('div');
  title.className = 'pce-title';
  title.textContent = 'Edit colour';
  panel.appendChild(title);

  // Color picker + hex input row
  const row = document.createElement('div');
  row.className = 'pce-row';

  const colorIn = document.createElement('input');
  colorIn.type = 'color';
  colorIn.value = colorObj.hex;

  const hexIn = document.createElement('input');
  hexIn.type = 'text';
  hexIn.value = colorObj.hex;
  hexIn.placeholder = '#rrggbb';
  hexIn.className = 'pce-hex';

  const nameIn = document.createElement('input');
  nameIn.type = 'text';
  nameIn.value = colorObj.name;
  nameIn.placeholder = 'Colour name';

  // Sync color ↔ hex input
  colorIn.addEventListener('input', () => {
    hexIn.value = colorIn.value;
  });
  hexIn.addEventListener('input', () => {
    if (/^#[0-9a-fA-F]{6}$/.test(hexIn.value)) colorIn.value = hexIn.value;
  });

  row.appendChild(colorIn);
  row.appendChild(hexIn);
  row.appendChild(nameIn);
  panel.appendChild(row);

  // Rope count info
  if (ropeCount > 0) {
    const info = document.createElement('div');
    info.className = 'pce-rope-count';
    info.textContent = `Used in ${ropeCount} rope${ropeCount !== 1 ? 's' : ''} — will be updated automatically`;
    panel.appendChild(info);
  }

  // Actions
  const actions = document.createElement('div');
  actions.className = 'pce-actions';

  const saveBtn = document.createElement('button');
  saveBtn.textContent = 'Save';
  saveBtn.addEventListener('click', () => {
    const newHex = /^#[0-9a-fA-F]{6}$/.test(hexIn.value) ? hexIn.value.toLowerCase() : colorIn.value;
    const newName = nameIn.value.trim() || colorObj.name;
    pushHistory();
    if (newHex !== oldHex) replaceRopeColor(oldHex, newHex);
    colorObj.hex = newHex;
    colorObj.name = newName;
    if (state.selectedColorHex === oldHex) state.selectedColorHex = newHex;
    closeInlineColorEditor();
    renderPalette();
    scheduleRender();
    scheduleAutosave();
  });

  const cancelBtn = document.createElement('button');
  cancelBtn.textContent = 'Cancel';
  cancelBtn.addEventListener('click', closeInlineColorEditor);

  actions.appendChild(saveBtn);
  actions.appendChild(cancelBtn);
  panel.appendChild(actions);
}

function closeInlineColorEditor() {
  _pceColorObj = null;
  const panel = document.getElementById('palette-inline-editor');
  panel.classList.add('hidden');
  panel.innerHTML = '';
}

function renderPalette() {
  const sel = document.getElementById('palette-selector');
  sel.innerHTML = '';

  // ── Dropdown row ──
  const row = document.createElement('div');
  row.style.cssText = 'display:flex;align-items:center;gap:6px;margin-bottom:10px';

  const dropdown = document.createElement('select');
  dropdown.style.cssText = 'flex:1;font-size:12px';
  state.palettes.forEach(p => {
    const opt = document.createElement('option');
    opt.value = p.id;
    opt.textContent = p.name;
    opt.selected = p.id === state.activePaletteId;
    dropdown.appendChild(opt);
  });
  dropdown.addEventListener('change', () => {
    closeInlineColorEditor();
    state.activePaletteId = dropdown.value;
    state.selectedColorHex = activePalette().colors[0]?.hex ?? '#cccccc';
    renderPalette();
  });

  const dupBtn = document.createElement('button');
  dupBtn.className = 'icon-btn';
  dupBtn.title = 'Duplicate palette';
  dupBtn.textContent = '⧉';
  dupBtn.addEventListener('click', () => {
    const p = activePalette();
    const copy = JSON.parse(JSON.stringify(p));
    copy.id = 'palette-' + Date.now();
    copy.name = p.name + ' (copy)';
    state.palettes.push(copy);
    state.activePaletteId = copy.id;
    renderPalette();
    scheduleAutosave();
  });

  const renameBtn = document.createElement('button');
  renameBtn.className = 'icon-btn';
  renameBtn.title = 'Rename palette';
  renameBtn.textContent = '✎';
  renameBtn.addEventListener('click', () => {
    const p = activePalette();
    let renameRow = sel.querySelector('.palette-rename-row');
    if (renameRow) { renameRow.remove(); return; }
    renameRow = document.createElement('div');
    renameRow.className = 'palette-rename-row';
    renameRow.style.cssText = 'display:flex;gap:6px;margin-bottom:8px';
    const inp = document.createElement('input');
    inp.type = 'text';
    inp.value = p.name;
    inp.style.cssText = 'flex:1;font-size:12px;padding:3px 6px;border:1px solid var(--border);border-radius:4px;background:var(--bg-input,var(--bg));color:var(--text)';
    const confirmBtn = document.createElement('button');
    confirmBtn.className = 'icon-btn';
    confirmBtn.title = 'Save name';
    confirmBtn.textContent = '✓';
    confirmBtn.style.color = 'var(--accent)';
    const cancelBtn = document.createElement('button');
    cancelBtn.className = 'icon-btn';
    cancelBtn.title = 'Cancel';
    cancelBtn.textContent = '×';
    const commit = () => {
      const name = inp.value.trim();
      if (name && name !== p.name) { p.name = name; scheduleAutosave(); }
      renameRow.remove();
      renderPalette();
    };
    confirmBtn.addEventListener('click', commit);
    cancelBtn.addEventListener('click', () => renameRow.remove());
    inp.addEventListener('keydown', e => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') renameRow.remove(); });
    renameRow.appendChild(inp);
    renameRow.appendChild(confirmBtn);
    renameRow.appendChild(cancelBtn);
    row.insertAdjacentElement('afterend', renameRow);
    inp.focus();
    inp.select();
  });

  const deleteBtn = document.createElement('button');
  deleteBtn.className = 'icon-btn';
  deleteBtn.title = 'Delete palette';
  deleteBtn.textContent = '×';
  deleteBtn.style.color = 'var(--danger)';
  deleteBtn.addEventListener('click', () => {
    if (state.palettes.length <= 1) { alert('You need at least one palette.'); return; }
    if (!window.confirm(`Delete "${activePalette().name}"?`)) return;
    state.palettes = state.palettes.filter(p => p.id !== state.activePaletteId);
    state.activePaletteId = state.palettes[0].id;
    state.selectedColorHex = activePalette().colors[0]?.hex ?? '#cccccc';
    closeInlineColorEditor();
    renderPalette();
    scheduleAutosave();
  });

  row.appendChild(dropdown);
  row.appendChild(dupBtn);
  row.appendChild(renameBtn);
  row.appendChild(deleteBtn);
  sel.appendChild(row);

  const sw = document.getElementById('palette-swatches');
  sw.innerHTML = '';
  activePalette().colors.forEach(c => {
    const wrap = document.createElement('div');
    wrap.className = 'swatch-wrap';

    const div = document.createElement('div');
    div.className = 'swatch' + (c.hex === state.selectedColorHex ? ' selected' : '');
    div.style.background = c.hex;
    div.title = c.name;
    div.addEventListener('click', () => {
      if (_pceColorObj === c) { closeInlineColorEditor(); return; }
      closeInlineColorEditor();
      state.selectedColorHex = c.hex;
      renderPalette();
      applyColorToSelected();
    });

    const editBtn = document.createElement('button');
    editBtn.className = 'swatch-edit-btn';
    editBtn.title = 'Edit colour';
    editBtn.textContent = '✎';
    editBtn.addEventListener('click', e => {
      e.stopPropagation();
      if (_pceColorObj === c) { closeInlineColorEditor(); return; }
      openInlineColorEditor(c);
    });

    wrap.appendChild(div);
    wrap.appendChild(editBtn);
    sw.appendChild(wrap);
  });

  // "Select all ropes using this colour" button
  const existingBtn = document.getElementById('btn-select-by-color');
  if (existingBtn) existingBtn.remove();

  const ropeCount = countRopesWithHex(state.selectedColorHex);
  if (ropeCount > 0) {
    const dot = `<span class="color-dot" style="background:${state.selectedColorHex}"></span>`;
    const btn = document.createElement('button');
    btn.id = 'btn-select-by-color';
    btn.className = 'select-by-color-btn';
    btn.innerHTML = `${dot} Select all ${ropeCount} rope${ropeCount !== 1 ? 's' : ''} using this colour`;
    btn.addEventListener('click', () => selectAllRopesWithHex(state.selectedColorHex));
    sw.insertAdjacentElement('afterend', btn);
  }
}

function applyColorToSelected() {
  if (!state.selectedRopes.length) return;
  pushHistory();
  state.selectedRopes.forEach(({ type, index }) => {
    const segs = type === 'warp' ? state.warpColors[index] : state.weftColors[index];
    if (segs) segs[0].colorHex = state.selectedColorHex;
  });
  renderWeave();
  renderRopeSegmentEditor();
  scheduleAutosave();
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
        pushHistory();
        sel.forEach(({ type: t, index: i }) => {
          const segs = t === 'warp' ? state.warpColors[i] : state.weftColors[i];
          if (segs) segs[0].colorHex = c.hex;
        });
        renderWeave();
        renderRopeSegmentEditor();
        scheduleAutosave();
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
        pushHistory();
        seg.colorHex = c.hex;
        renderWeave();
        renderRopeSegmentEditor();
        scheduleAutosave();
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
  document.getElementById('select-grid-overlay').value = state.gridDivisions;
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

  document.getElementById('select-grid-overlay').addEventListener('change', e => {
    state.gridDivisions = +e.target.value;
    renderWeave();
  });

  function syncMirrorButtons() {
    document.getElementById('btn-mirror-h').classList.toggle('active', state.mirrorH);
    document.getElementById('btn-mirror-v').classList.toggle('active', state.mirrorV);
  }
  syncMirrorButtons();

  document.getElementById('btn-mirror-h').addEventListener('click', () => {
    state.mirrorH = !state.mirrorH; syncMirrorButtons(); scheduleAutosave();
  });
  document.getElementById('btn-mirror-v').addEventListener('click', () => {
    state.mirrorV = !state.mirrorV; syncMirrorButtons(); scheduleAutosave();
  });

  document.getElementById('btn-symmetrize').addEventListener('click', () => {
    if (!state.mirrorH && !state.mirrorV) return;
    pushHistory();
    const cols = state.cols, rows = state.rows;
    const midC = Math.floor((cols - 1) / 2);
    const midR = Math.floor((rows - 1) / 2);
    // Walk every cell in the primary (top-left) quadrant and propagate its depth to mirrors
    for (let r = state.framePad; r < rows - state.framePad; r++) {
      for (let c = state.framePad; c < cols - state.framePad; c++) {
        // Only process cells in the primary quadrant
        if (state.mirrorH && c > midC) continue;
        if (state.mirrorV && r > midR) continue;
        const depth = warpOnTop(c, r);
        const mc = cols - 1 - c;
        const mr = rows - 1 - r;
        if (state.mirrorH && mc !== c) setDepth(mc, r, depth);
        if (state.mirrorV && mr !== r) setDepth(c, mr, depth);
        if (state.mirrorH && state.mirrorV && mc !== c && mr !== r) setDepth(mc, mr, depth);
      }
    }
    scheduleRender();
    scheduleAutosave();
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
    state.cols = 41; state.rows = 41; state.framePad = 2;
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

  // ── Extract palette from image ──────────────────────────────────────────────
  document.getElementById('btn-extract-palette').addEventListener('click', () => {
    document.getElementById('input-palette-image').click();
  });

  document.getElementById('input-palette-image').addEventListener('change', e => {
    const file = e.target.files[0];
    if (!file) return;
    e.target.value = '';
    const img = new Image();
    img.onload = () => {
      const colors = extractDominantColors(img, 8);
      const palette = {
        id: 'palette-' + Date.now(),
        name: file.name.replace(/\.[^.]+$/, '').replace(/[-_]/g, ' '),
        colors: colors.map((hex, i) => ({ hex, name: 'Colour ' + (i + 1) })),
      };
      // Open the palette editor pre-filled with extracted colors
      editingPalette = palette;
      document.getElementById('palette-name-input').value = palette.name;
      document.getElementById('palette-editor').classList.remove('hidden');
      renderColorEditorList();
    };
    img.src = URL.createObjectURL(file);
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
