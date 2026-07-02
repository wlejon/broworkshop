import "/lib/camera.js";
import "/lib/project.js";
import { createEditor, GROUND_IDS, OVERLAY_IDS, BLOCK_BIT, atlasCellPxRect, OVERLAY_THUMB_CELL } from "/app/editor.js";
import { installSystemMenu } from "/lib/system-menu.js";

// =============================================================================
// Tile Editor — an interactive tools/ app that exercises the full
// scene.createTileWorld surface on one composed map: palette+atlas rendering,
// autotiling, multi-layer overlays with tint, animated tiles, GPU-instanced
// objects, ray->cell picking, elevation/AO cliffs, nav-grid pathfinding, and
// save/load.
// =============================================================================

const canvas = document.getElementById('c');
const scene  = canvas.getContext('scene');
const statsEl = document.getElementById('stats');
const fileStatusEl = document.getElementById('file-status');

scene.setToneMap({ mode: 'aces', exposure: 1.0, gamma: 2.2 });
scene.setAmbient([0.08, 0.09, 0.11]);
const sun = scene.createLight({
    type: 'directional',
    direction: [-0.4, -1.0, -0.3],
    color: [1.0, 0.96, 0.9],
    intensity: 3.0,
});
sun.castsShadow = true;

const editor = createEditor(scene);
installSystemMenu();

// ---------------------------------------------------------------------------
// Camera
// ---------------------------------------------------------------------------

// worldBounds() is topology-aware (a hex grid's extent isn't a clean
// width*cellSize box), so frame the camera from it rather than
// mapWidth/mapHeight*cellSize — works identically for square and hex.
function frameCameraToMap(camera) {
    const b = editor.world.worldBounds();
    const cx = (b.minX + b.maxX) / 2, cz = (b.minZ + b.maxZ) / 2;
    const dist = Math.max(10, Math.max(b.maxX - b.minX, b.maxZ - b.minZ) * 0.9);
    Camera.orbitReframe(camera, [cx, 0, cz], dist);
}

const cam = Camera.createOrbit({ target: [0, 0, 0], dist: 40, fov: 50 });
frameCameraToMap(cam);

let rightDown = false, middleDown = false;
function updatePointerLock() {
    const want = rightDown || middleDown;
    const locked = !!document.pointerLockElement;
    if (want && !locked) canvas.requestPointerLock();
    else if (!want && locked) document.exitPointerLock();
}

// ---------------------------------------------------------------------------
// Mode + brush state
// ---------------------------------------------------------------------------

let mode = 'ground';
let groundId = GROUND_IDS.grass;
let overlayId = OVERLAY_IDS.road;
let elevDir = 1;
let flagValue = true;
let brushRadius = 0;
let selectedKind = 'tree';
let pathStart = null;

// Modes that paint a single scalar value per cell and so support the shared
// brush-size/rect-fill/flood-fill machinery (object/pathfind pick instead).
const PAINT_MODES = new Set(['ground', 'elevation', 'overlay', 'tint', 'flags']);
const FLOOD_MODES = new Set(['ground', 'overlay']);   // id-based layers only
const EYEDROP_MODES = new Set(['ground', 'overlay']);

function hexToRgb01(hex) {
    const v = parseInt(hex.slice(1), 16);
    return [((v >> 16) & 255) / 255, ((v >> 8) & 255) / 255, (v & 255) / 255];
}

function cellFromEvent(e) {
    const rect = canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left, my = e.clientY - rect.top;
    const ray = scene.unprojectLocal(mx, my);
    if (!ray) return null;
    return editor.world.raycastCell(ray.origin, ray.dir, 1000);
}

function paintCell(x, y) {
    if (mode === 'ground') editor.paintGround(x, y, groundId);
    else if (mode === 'elevation') editor.raiseElevation(x, y, elevDir);
    else if (mode === 'overlay') editor.paintOverlay(x, y, overlayId);
    else if (mode === 'tint') {
        const rgb = hexToRgb01(tintColorInput.value);
        editor.paintTint(x, y, rgb[0], rgb[1], rgb[2], parseFloat(tintAlphaInput.value));
    } else if (mode === 'flags') {
        editor.paintFlag(x, y, BLOCK_BIT, flagValue);
    }
}

function applyBrush(hit) {
    if (!hit) return;
    for (const [x, y] of editor.cellsInRadius(hit.x, hit.y, brushRadius)) paintCell(x, y);
}

function applyRectFill(x0, y0, x1, y1) {
    if (mode === 'ground') editor.fillGround(x0, y0, x1, y1, groundId);
    else if (mode === 'elevation') editor.fillElevationDelta(x0, y0, x1, y1, elevDir);
    else if (mode === 'overlay') editor.fillOverlay(x0, y0, x1, y1, overlayId);
    else if (mode === 'tint') {
        const rgb = hexToRgb01(tintColorInput.value);
        editor.fillTint(x0, y0, x1, y1, rgb[0], rgb[1], rgb[2], parseFloat(tintAlphaInput.value));
    } else if (mode === 'flags') {
        editor.fillFlag(x0, y0, x1, y1, BLOCK_BIT, flagValue);
    }
}

function applyFloodFill(hit) {
    if (!hit || !FLOOD_MODES.has(mode)) return;
    if (mode === 'ground') editor.floodFill(0, hit.x, hit.y, groundId);
    else if (mode === 'overlay') editor.floodFill(1, hit.x, hit.y, overlayId);
}

function applyEyedropper(hit) {
    if (!hit || !EYEDROP_MODES.has(mode)) return;
    if (mode === 'ground') {
        groundId = editor.eyedrop(0, hit.x, hit.y);
        selectSibling(groundButtons, groundButtons.find((el) => Number(el.dataset.id) === groundId) || groundButtons[groundButtons.length - 1]);
    } else if (mode === 'overlay') {
        overlayId = editor.eyedrop(1, hit.x, hit.y);
        selectSibling(overlayButtons, overlayButtons.find((el) => Number(el.dataset.id) === overlayId) || overlayButtons[overlayButtons.length - 1]);
    }
}

function handlePathClick(hit) {
    if (!pathStart) {
        editor.clearPathMarkers();
        pathStart = { x: hit.x, y: hit.y };
    } else {
        editor.queryPath(pathStart.x, pathStart.y, hit.x, hit.y);
        pathStart = null;
    }
}

// ---------------------------------------------------------------------------
// Input
// ---------------------------------------------------------------------------

let leftDown = false;
let lastPaintKey = null;
let rectDragActive = false;
let rectStart = null;
let rectEnd = null;

const STROKE_LABELS = {
    ground: 'Paint ground', elevation: 'Raise elevation', overlay: 'Paint overlay',
    tint: 'Paint tint', flags: 'Paint flags',
};

canvas.addEventListener('mousedown', (e) => {
    if (e.button === 2) { rightDown = true; e.preventDefault(); updatePointerLock(); return; }
    if (e.button === 1) { middleDown = true; e.preventDefault(); updatePointerLock(); return; }
    if (e.button !== 0) return;

    const hit = cellFromEvent(e);
    if (mode === 'object') {
        if (hit) editor.placeObject(selectedKind, hit.x, hit.y);
        return;
    }
    if (mode === 'pathfind') {
        if (hit) handlePathClick(hit);
        return;
    }
    if (!PAINT_MODES.has(mode)) return;

    if (e.altKey) { applyEyedropper(hit); return; }
    if (e.ctrlKey) {
        if (!hit || !FLOOD_MODES.has(mode)) return;
        editor.beginStroke('Flood fill');
        applyFloodFill(hit);
        editor.endStroke();
        return;
    }
    if (e.shiftKey) {
        rectDragActive = true;
        rectStart = hit;
        rectEnd = hit;
        return;
    }

    leftDown = true;
    lastPaintKey = null;
    editor.beginStroke(STROKE_LABELS[mode] || 'Paint');
    if (hit) { applyBrush(hit); lastPaintKey = hit.x + ',' + hit.y; }
});
document.addEventListener('mouseup', (e) => {
    if (e.button === 2) rightDown = false;
    if (e.button === 1) middleDown = false;
    if (e.button === 0 && rectDragActive) {
        rectDragActive = false;
        if (rectStart && rectEnd) {
            editor.beginStroke('Rect fill');
            applyRectFill(rectStart.x, rectStart.y, rectEnd.x, rectEnd.y);
            editor.endStroke();
        }
        rectStart = null; rectEnd = null;
    }
    if (e.button === 0 && leftDown) { leftDown = false; editor.endStroke(); }
    updatePointerLock();
});
document.addEventListener('mousemove', (e) => {
    if (rightDown) Camera.orbitLook(cam, e.movementX, e.movementY);
    if (middleDown) Camera.orbitPan(cam, e.movementX, e.movementY);
    if (rectDragActive) {
        const hit = cellFromEvent(e);
        if (hit) rectEnd = hit;
        return;
    }
    if (leftDown && PAINT_MODES.has(mode)) {
        const hit = cellFromEvent(e);
        if (hit) {
            const key = hit.x + ',' + hit.y;
            if (key !== lastPaintKey) { applyBrush(hit); lastPaintKey = key; }
        }
    }
});
canvas.addEventListener('contextmenu', (e) => e.preventDefault());
canvas.addEventListener('wheel', (e) => {
    cam.dist = Math.max(4, Math.min(120, cam.dist * Math.exp(e.deltaY * 0.001)));
});

// ---------------------------------------------------------------------------
// Panel wiring
// ---------------------------------------------------------------------------

function selectSibling(list, selected) {
    for (const el of list) el.classList.toggle('selected', el === selected);
}

const modeSections = {
    ground: document.getElementById('sec-ground'),
    elevation: document.getElementById('sec-elevation'),
    overlay: document.getElementById('sec-overlay'),
    tint: document.getElementById('sec-tint'),
    flags: document.getElementById('sec-flags'),
    object: document.getElementById('sec-object'),
    pathfind: document.getElementById('sec-pathfind'),
};
const brushSectionEl = document.getElementById('sec-brush');
const modeButtons = Array.from(document.querySelectorAll('.mode-btn'));
modeButtons.forEach((btn) => {
    btn.addEventListener('click', () => {
        mode = btn.dataset.mode;
        modeButtons.forEach((b) => b.classList.toggle('accent', b === btn));
        for (const key in modeSections) modeSections[key].style.display = (key === mode) ? 'block' : 'none';
        brushSectionEl.style.display = PAINT_MODES.has(mode) ? 'block' : 'none';
        if (mode !== 'pathfind') pathStart = null;
    });
});
brushSectionEl.style.display = PAINT_MODES.has(mode) ? 'block' : 'none';
modeSections[mode].style.display = 'block';

// ---------------------------------------------------------------------------
// New Map
// ---------------------------------------------------------------------------

const mapWidthInput = document.getElementById('map-width');
const mapHeightInput = document.getElementById('map-height');
const mapCellSizeInput = document.getElementById('map-cellsize');
const mapStatusEl = document.getElementById('map-status');

let newMapTopology = editor.topology;
const topoButtons = Array.from(document.querySelectorAll('.topo-btn'));
topoButtons.forEach((el) => {
    el.addEventListener('click', () => {
        newMapTopology = el.dataset.topology;
        selectSibling(topoButtons, el);
    });
});
selectSibling(topoButtons, topoButtons.find((el) => el.dataset.topology === newMapTopology) || topoButtons[0]);

function flashMapStatus(msg) {
    mapStatusEl.textContent = msg;
    setTimeout(() => { if (mapStatusEl.textContent === msg) mapStatusEl.textContent = ''; }, 2500);
}

function readMapFormValues() {
    const width = Math.max(4, Math.min(200, parseInt(mapWidthInput.value, 10) || 48));
    const height = Math.max(4, Math.min(200, parseInt(mapHeightInput.value, 10) || 48));
    const cellSize = Math.max(0.25, Math.min(4, parseFloat(mapCellSizeInput.value) || 1));
    return { width, height, cellSize, topology: newMapTopology };
}

function syncMapFormFromEditor() {
    const c = editor.getConfig();
    mapWidthInput.value = c.width;
    mapHeightInput.value = c.height;
    mapCellSizeInput.value = c.cellSize;
    newMapTopology = c.topology;
    selectSibling(topoButtons, topoButtons.find((el) => el.dataset.topology === c.topology) || topoButtons[0]);
}

document.getElementById('btn-new-map').addEventListener('click', () => {
    const v = readMapFormValues();
    proj.new();
    flashMapStatus(`New ${v.topology} map (${v.width}x${v.height}).`);
});

// Crop+scale one atlas cell into a small pixelated thumbnail canvas.
function atlasThumbnail(atlas, cell, size) {
    const [cx, cy, cellPx] = atlasCellPxRect(cell);
    const crop = new Uint8ClampedArray(cellPx * cellPx * 4);
    for (let row = 0; row < cellPx; row++) {
        const srcOff = ((cy + row) * atlas.width + cx) * 4;
        crop.set(atlas.pixels.subarray(srcOff, srcOff + cellPx * 4), row * cellPx * 4);
    }
    const small = document.createElement('canvas');
    small.width = cellPx; small.height = cellPx;
    small.getContext('2d').putImageData(new ImageData(crop, cellPx, cellPx), 0, 0);

    const out = document.createElement('canvas');
    out.width = size; out.height = size;
    out.className = 'swatch-thumb';
    out.style.width = size + 'px';
    out.style.height = size + 'px';
    const octx = out.getContext('2d');
    octx.imageSmoothingEnabled = false;
    octx.drawImage(small, 0, 0, size, size);
    return out;
}

// Build a row of swatch buttons from atlas cells; `defs` entries are
// { id, label, cell } (cell omitted -> plain "erase" style swatch).
function buildSwatchRow(container, defs, atlas, onSelect) {
    container.innerHTML = '';
    const buttons = [];
    for (const def of defs) {
        const el = document.createElement('div');
        el.className = 'btn swatch';
        el.dataset.id = def.id;
        if (def.cell === undefined) {
            el.style.borderColor = '#555';
            const label = document.createElement('span');
            label.textContent = def.label;
            el.appendChild(label);
        } else {
            el.appendChild(atlasThumbnail(atlas, def.cell, 28));
            const label = document.createElement('span');
            label.textContent = def.label;
            el.appendChild(label);
        }
        el.addEventListener('click', () => {
            onSelect(def.id);
            selectSibling(buttons, el);
        });
        container.appendChild(el);
        buttons.push(el);
    }
    if (buttons.length) selectSibling(buttons, buttons[0]);
    return buttons;
}

const GROUND_SWATCH_DEFS = [
    { id: GROUND_IDS.grass, label: 'Grass', cell: GROUND_IDS.grass },
    { id: GROUND_IDS.dirt, label: 'Dirt', cell: GROUND_IDS.dirt },
    { id: GROUND_IDS.stone, label: 'Stone', cell: GROUND_IDS.stone },
    { id: GROUND_IDS.sand, label: 'Sand', cell: GROUND_IDS.sand },
    { id: GROUND_IDS.water, label: 'Water', cell: GROUND_IDS.water },
    { id: GROUND_IDS.wood, label: 'Wood', cell: GROUND_IDS.wood },
    { id: GROUND_IDS.plaza, label: 'Plaza', cell: GROUND_IDS.plaza },
    { id: GROUND_IDS.lush, label: 'Lush', cell: GROUND_IDS.lush },
    { id: 0, label: 'Erase' },
];
const OVERLAY_SWATCH_DEFS = [
    { id: OVERLAY_IDS.road, label: 'Road', cell: OVERLAY_THUMB_CELL.road },
    { id: OVERLAY_IDS.crop, label: 'Crop', cell: OVERLAY_THUMB_CELL.crop },
    { id: 0, label: 'Erase' },
];

const groundButtons = buildSwatchRow(document.getElementById('ground-swatches'), GROUND_SWATCH_DEFS, editor.atlas, (id) => {
    groundId = id;
});
const overlayButtons = buildSwatchRow(document.getElementById('overlay-swatches'), OVERLAY_SWATCH_DEFS, editor.atlas, (id) => {
    overlayId = id;
});

const elevButtons = Array.from(document.querySelectorAll('.elev-btn'));
elevButtons.forEach((el) => {
    el.addEventListener('click', () => {
        elevDir = parseInt(el.dataset.dir, 10);
        selectSibling(elevButtons, el);
    });
});
selectSibling(elevButtons, elevButtons[0]);

const flagButtons = Array.from(document.querySelectorAll('.flag-btn'));
flagButtons.forEach((el) => {
    el.addEventListener('click', () => {
        flagValue = el.dataset.value === '1';
        selectSibling(flagButtons, el);
    });
});
selectSibling(flagButtons, flagButtons[0]);

const brushRadiusInput = document.getElementById('brush-radius');
const brushRadiusVal = document.getElementById('brush-radius-val');
brushRadiusInput.addEventListener('input', () => {
    brushRadius = parseInt(brushRadiusInput.value, 10) || 0;
    brushRadiusVal.textContent = String(brushRadius);
});

const objectSwatches = Array.from(document.querySelectorAll('#object-swatches .swatch'));
objectSwatches.forEach((el) => {
    el.addEventListener('click', () => {
        selectedKind = el.dataset.kind;
        selectSibling(objectSwatches, el);
    });
});
selectSibling(objectSwatches, objectSwatches[0]);

document.getElementById('btn-clear-objects').addEventListener('click', () => editor.clearAllObjects());
document.getElementById('btn-clear-path').addEventListener('click', () => {
    editor.clearPathMarkers();
    pathStart = null;
});

const tintColorInput = document.getElementById('tint-color');
const tintAlphaInput = document.getElementById('tint-alpha');
const tintAlphaVal = document.getElementById('tint-alpha-val');
tintAlphaInput.addEventListener('input', () => {
    tintAlphaVal.textContent = parseFloat(tintAlphaInput.value).toFixed(2);
});

// ---------------------------------------------------------------------------
// Undo / redo
// ---------------------------------------------------------------------------

const btnUndo = document.getElementById('btn-undo');
const btnRedo = document.getElementById('btn-redo');
function updateHistoryButtons() {
    btnUndo.classList.toggle('disabled', !editor.history.canUndo());
    btnRedo.classList.toggle('disabled', !editor.history.canRedo());
}
editor.history.on('change', updateHistoryButtons);
updateHistoryButtons();
btnUndo.addEventListener('click', () => { editor.history.undo(); editor.rebuildIfDirty(); });
btnRedo.addEventListener('click', () => { editor.history.redo(); editor.rebuildIfDirty(); });
document.addEventListener('keydown', (e) => {
    if (!e.ctrlKey || e.key.toLowerCase() !== 'z') return;
    e.preventDefault();
    if (e.shiftKey) editor.history.redo(); else editor.history.undo();
    editor.rebuildIfDirty();
});

const proj = new Project({
    app: 'tile-editor',
    schema: 1,
    serialize: () => editor.serializeMap(),
    deserialize: (data) => editor.deserializeMap(data),
    onNew: () => editor.newMap(readMapFormValues()),
    history: editor.history,
});

function updateFileStatus() {
    fileStatusEl.textContent = proj.name + (proj.isDirty() ? ' *' : '');
}
proj.on('change', updateFileStatus);
proj.on('new', () => { syncMapFormFromEditor(); frameCameraToMap(cam); });
proj.on('loaded', () => { syncMapFormFromEditor(); frameCameraToMap(cam); });
updateFileStatus();

document.getElementById('btn-save').addEventListener('click', () => {
    if (proj.save() || proj.saveAs()) updateFileStatus();
});
document.getElementById('btn-save-as').addEventListener('click', () => {
    proj.saveAs();
});
document.getElementById('btn-open').addEventListener('click', () => {
    proj.open();
});

// ---------------------------------------------------------------------------
// Main loop
// ---------------------------------------------------------------------------

function frame(t) {
    editor.world.advance(16.0);
    editor.rebuildIfDirty();
    scene.setCamera(Camera.orbitViewOpts(cam, canvas));

    statsEl.textContent =
        'mode: ' + mode + '\n' +
        'chunks: ' + editor.world.chunkCount + '\n' +
        'verts: ' + editor.world.vertexCount + '\n' +
        'tris: ' + editor.world.triangleCount;

    requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
