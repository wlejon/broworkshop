import "/lib/camera.js";
import { createEditor, GROUND_IDS, OVERLAY_IDS } from "/app/editor.js";

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

// ---------------------------------------------------------------------------
// Camera
// ---------------------------------------------------------------------------

const mapCenter = [editor.mapWidth * editor.cellSize / 2, 0, editor.mapHeight * editor.cellSize / 2];
const cam = Camera.createOrbit({ target: mapCenter, dist: 40, fov: 50 });

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

const groundSwatches = Array.from(document.querySelectorAll('#ground-swatches .swatch'));
groundSwatches.forEach((el) => {
    el.addEventListener('click', () => {
        groundId = parseInt(el.dataset.id, 10);
        selectSibling(groundSwatches, el);
    });
});
selectSibling(groundSwatches, groundSwatches[0]);

const overlaySwatches = Array.from(document.querySelectorAll('#overlay-swatches .swatch'));
overlaySwatches.forEach((el) => {
    el.addEventListener('click', () => {
        overlayId = parseInt(el.dataset.id, 10);
        selectSibling(overlaySwatches, el);
    });
});
selectSibling(overlaySwatches, overlaySwatches[0]);

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
