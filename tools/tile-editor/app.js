import "/lib/camera.js";
import { createEditor, GROUND_IDS, OVERLAY_IDS, atlasCellPxRect, OVERLAY_THUMB_CELL } from "/app/editor.js";
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
const saveStatusEl = document.getElementById('save-status');

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
let selectedKind = 'tree';
let pathStart = null;

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

function applyBrush(hit) {
    if (!hit) return;
    if (mode === 'ground') editor.paintGround(hit.x, hit.y, groundId);
    else if (mode === 'elevation') editor.raiseElevation(hit.x, hit.y, elevDir);
    else if (mode === 'overlay') editor.paintOverlay(hit.x, hit.y, overlayId);
    else if (mode === 'tint') {
        const rgb = hexToRgb01(tintColorInput.value);
        editor.paintTint(hit.x, hit.y, rgb[0], rgb[1], rgb[2], parseFloat(tintAlphaInput.value));
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
    leftDown = true;
    lastPaintKey = null;
    if (hit) { applyBrush(hit); lastPaintKey = hit.x + ',' + hit.y; }
});
document.addEventListener('mouseup', (e) => {
    if (e.button === 2) rightDown = false;
    if (e.button === 1) middleDown = false;
    if (e.button === 0) leftDown = false;
    updatePointerLock();
});
document.addEventListener('mousemove', (e) => {
    if (rightDown) Camera.orbitLook(cam, e.movementX, e.movementY);
    if (middleDown) Camera.orbitPan(cam, e.movementX, e.movementY);
    if (leftDown && mode !== 'object' && mode !== 'pathfind') {
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
    object: document.getElementById('sec-object'),
    pathfind: document.getElementById('sec-pathfind'),
};
const modeButtons = Array.from(document.querySelectorAll('.mode-btn'));
modeButtons.forEach((btn) => {
    btn.addEventListener('click', () => {
        mode = btn.dataset.mode;
        modeButtons.forEach((b) => b.classList.toggle('accent', b === btn));
        for (const key in modeSections) modeSections[key].style.display = (key === mode) ? 'block' : 'none';
        if (mode !== 'pathfind') pathStart = null;
    });
});
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

document.getElementById('btn-new-map').addEventListener('click', () => {
    const width = Math.max(4, Math.min(200, parseInt(mapWidthInput.value, 10) || 48));
    const height = Math.max(4, Math.min(200, parseInt(mapHeightInput.value, 10) || 48));
    const cellSize = Math.max(0.25, Math.min(4, parseFloat(mapCellSizeInput.value) || 1));
    editor.newMap({ width, height, topology: newMapTopology, cellSize });
    frameCameraToMap(cam);
    flashMapStatus(`New ${newMapTopology} map (${width}x${height}).`);
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

buildSwatchRow(document.getElementById('ground-swatches'), GROUND_SWATCH_DEFS, editor.atlas, (id) => {
    groundId = id;
});
buildSwatchRow(document.getElementById('overlay-swatches'), OVERLAY_SWATCH_DEFS, editor.atlas, (id) => {
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

function flashStatus(msg) {
    saveStatusEl.textContent = msg;
    setTimeout(() => { if (saveStatusEl.textContent === msg) saveStatusEl.textContent = ''; }, 2000);
}
document.getElementById('btn-save').addEventListener('click', () => {
    editor.saveMap();
    flashStatus('Saved.');
});
document.getElementById('btn-load').addEventListener('click', () => {
    flashStatus(editor.loadMap() ? 'Loaded.' : 'No saved map.');
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
