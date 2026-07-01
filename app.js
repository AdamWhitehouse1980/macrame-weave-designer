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
  selectedRope: null,
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
  state.selectedRope = null;
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
  } else {
    base = (col + row) % 2 === 0;
  }
  return state.cellOverrides[`${col},${row}`] ? !base : base;
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

  svg.appendChild(el('rect', { x: 0, y: 0, width: W, height: H, fill: '#111' }));

  const OVER_FRAC = 0.82;
  const UNDER_FRAC = (1 - OVER_FRAC) / 2;
  const ROUND = Math.max(2, cs * 0.12);

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const x = HEADER + c * cs;
      const y = HEADER + r * cs;
      const warpCol = warpColorAt(c, r);
      const weftCol = weftColorAt(r, c);

      if (isPadCell(c, r)) {
        // Frame padding: show the rope colour of the dominant direction as a flat band
        const isLeftRight = c < state.framePad || c >= state.cols - state.framePad;
        const isTopBottom = r < state.framePad || r >= state.rows - state.framePad;

        if (isTopBottom && !isLeftRight) {
          // Warp rope passes through, show as vertical band
          svg.appendChild(el('rect', { x, y, width: cs, height: cs, fill: '#1a1a1a' }));
          svg.appendChild(el('rect', {
            x: x + cs * UNDER_FRAC, y,
            width: cs * OVER_FRAC, height: cs,
            rx: ROUND, ry: ROUND,
            fill: warpCol,
          }));
        } else if (isLeftRight && !isTopBottom) {
          // Weft rope passes through, show as horizontal band
          svg.appendChild(el('rect', { x, y, width: cs, height: cs, fill: '#1a1a1a' }));
          svg.appendChild(el('rect', {
            x, y: y + cs * UNDER_FRAC,
            width: cs, height: cs * OVER_FRAC,
            rx: ROUND, ry: ROUND,
            fill: weftCol,
          }));
        } else {
          // Corner: just dark
          svg.appendChild(el('rect', { x, y, width: cs, height: cs, fill: '#1a1a1a' }));
        }

        // Transparent click target for corner pad cells (no interaction needed)
        continue;
      }

      // ── Woven cell — nested SVG clips overflow to cell boundary ──
      const top = warpOnTop(c, r);
      const isOverridden = !!state.cellOverrides[`${c},${r}`];

      // Nested SVG provides a clipping viewport so ropes can extend freely
      // beyond their local bounds without bleeding into adjacent cells.
      const cell = document.createElementNS(SVG_NS, 'svg');
      cell.setAttribute('x', x);
      cell.setAttribute('y', y);
      cell.setAttribute('width', cs);
      cell.setAttribute('height', cs);
      cell.setAttribute('overflow', 'hidden');
      cell.style.cursor = 'pointer';

      // Local coords: 0,0 is top-left of this cell
      const EXT = cs * 0.04; // extension for seamless continuity

      if (top) {
        cell.appendChild(el('rect', { x: 0, y: 0, width: cs, height: cs * UNDER_FRAC, fill: weftCol }));
        cell.appendChild(el('rect', { x: 0, y: cs * (1 - UNDER_FRAC), width: cs, height: cs * UNDER_FRAC, fill: weftCol }));
        cell.appendChild(el('rect', {
          x: cs * UNDER_FRAC, y: -EXT,
          width: cs * OVER_FRAC, height: cs + EXT * 2,
          rx: ROUND, ry: ROUND, fill: warpCol,
        }));
        cell.appendChild(el('rect', {
          x: cs * UNDER_FRAC, y: -EXT,
          width: cs * OVER_FRAC, height: cs + EXT * 2,
          rx: ROUND, ry: ROUND, fill: 'rgba(0,0,0,0.18)',
          style: 'pointer-events:none',
        }));
        cell.appendChild(el('rect', {
          x: cs * UNDER_FRAC + 1, y: -EXT + 1,
          width: cs * OVER_FRAC * 0.35, height: cs + EXT * 2 - 2,
          rx: ROUND, ry: ROUND, fill: 'rgba(255,255,255,0.12)',
          style: 'pointer-events:none',
        }));
      } else {
        cell.appendChild(el('rect', { x: 0, y: 0, width: cs * UNDER_FRAC, height: cs, fill: warpCol }));
        cell.appendChild(el('rect', { x: cs * (1 - UNDER_FRAC), y: 0, width: cs * UNDER_FRAC, height: cs, fill: warpCol }));
        cell.appendChild(el('rect', {
          x: -EXT, y: cs * UNDER_FRAC,
          width: cs + EXT * 2, height: cs * OVER_FRAC,
          rx: ROUND, ry: ROUND, fill: weftCol,
        }));
        cell.appendChild(el('rect', {
          x: -EXT, y: cs * UNDER_FRAC,
          width: cs + EXT * 2, height: cs * OVER_FRAC,
          rx: ROUND, ry: ROUND, fill: 'rgba(0,0,0,0.18)',
          style: 'pointer-events:none',
        }));
        cell.appendChild(el('rect', {
          x: -EXT + 1, y: cs * UNDER_FRAC + 1,
          width: cs + EXT * 2 - 2, height: cs * OVER_FRAC * 0.35,
          rx: ROUND, ry: ROUND, fill: 'rgba(255,255,255,0.12)',
          style: 'pointer-events:none',
        }));
      }

      if (isOverridden) {
        cell.appendChild(el('circle', {
          cx: cs - 3, cy: 3, r: 2,
          fill: 'rgba(255,255,255,0.6)',
          style: 'pointer-events:none',
        }));
      }

      // Transparent hit rect covers the full cell for reliable clicking
      const hit = el('rect', { x: 0, y: 0, width: cs, height: cs, fill: 'transparent' });
      hit.addEventListener('click', () => { toggleCellOverride(c, r); renderWeave(); });
      cell.appendChild(hit);

      svg.appendChild(cell);
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
    g.addEventListener('click', () => selectRope('warp', c));
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
    g.addEventListener('click', () => selectRope('weft', r));
    svg.appendChild(g);
  }

  svg.appendChild(el('rect', { x: 0, y: 0, width: HEADER, height: HEADER, fill: '#111' }));
}

function isSelectedRope(type, index) {
  return state.selectedRope?.type === type && state.selectedRope?.index === index;
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
  if (!state.selectedRope) return;
  const { type, index } = state.selectedRope;
  if (type === 'warp') {
    state.warpColors[index][0].colorHex = state.selectedColorHex;
  } else {
    state.weftColors[index][0].colorHex = state.selectedColorHex;
  }
  renderWeave();
  renderRopeSegmentEditor();
}

// ── Rope segment editor ───────────────────────────────────────────────────────

function selectRope(type, index) {
  state.selectedRope = { type, index };
  renderWeave();
  renderRopeSegmentEditor();
}

function renderRopeSegmentEditor() {
  const panel = document.getElementById('rope-segment-editor');
  const hint = document.getElementById('rope-hint');
  const title = document.getElementById('rope-panel-title');
  panel.innerHTML = '';

  if (!state.selectedRope) {
    hint.classList.remove('hidden');
    title.textContent = 'Rope segments';
    return;
  }

  hint.classList.add('hidden');
  const { type, index } = state.selectedRope;
  const segs = type === 'warp' ? state.warpColors[index] : state.weftColors[index];
  const maxEnd = type === 'warp' ? state.rows : state.cols;
  title.textContent = type === 'warp' ? `Warp ${index + 1} segments` : `Weft ${index + 1} segments`;

  const palette = activePalette();

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

  document.getElementById('input-cols').addEventListener('change', e => {
    state.cols = Math.max(4, Math.min(80, +e.target.value));
    ensureRopeLengths();
    if (state.selectedRope?.type === 'warp' && state.selectedRope.index >= state.cols)
      state.selectedRope = null;
    renderAll();
  });

  document.getElementById('input-rows').addEventListener('change', e => {
    state.rows = Math.max(4, Math.min(80, +e.target.value));
    ensureRopeLengths();
    if (state.selectedRope?.type === 'weft' && state.selectedRope.index >= state.rows)
      state.selectedRope = null;
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
    state.selectedRope = null;
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
