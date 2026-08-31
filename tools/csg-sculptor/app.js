// app.js — Main orchestrator for CSG Sculptor tool.

import { CSGEngine } from "./csg.js";
import { CutterTool } from "./cutter.js";
import { exportMeshToOBJ } from "./exporter.js";

const canvas = document.getElementById('stage');
const scene = canvas.getContext('scene');

// --- Scene Environment & Lighting ---
scene.setAmbient([0.1, 0.12, 0.16]);
scene.setToneMap({ mode: 'aces', exposure: 1.15 });

// Key Light (Sun with soft shadows)
const keyLight = scene.createLight({
    type: 'directional',
    direction: [-0.4, -0.9, -0.4],
    color: [1.0, 0.98, 0.94],
    intensity: 2.8,
    castsShadow: true,
    name: 'sun'
});

// Cool Fill Light
scene.createLight({
    type: 'directional',
    direction: [0.6, -0.4, 0.6],
    color: [0.4, 0.65, 0.95],
    intensity: 1.2,
    name: 'fill'
});

// Studio Backlight / Rim
scene.createLight({
    type: 'directional',
    direction: [0.0, 0.8, -0.8],
    color: [0.8, 0.5, 0.4],
    intensity: 0.6,
    name: 'rim'
});

// Ground Grid Disk
scene.createMesh({
    mesh: Mesh.cylinder(12.0, 0.05, 32),
    color: '#0e121a',
    roughness: 0.8,
    metalness: 0.2,
    y: -2.0
});

// Outer Accent Ring
scene.createMesh({
    mesh: Mesh.torus(12.0, 0.06, 64, 16),
    color: '#1e293b',
    emissive: 0.2,
    emissiveColor: '#00f2fe',
    y: -1.95
});

// --- Camera Setup ---
const startRot = Camera.quatMul(
    Camera.quatFromAxis(0, 1, 0, -0.45),
    Camera.quatFromAxis(1, 0, 0, -0.32)
);

const cam = Camera.createOrbit({
    target: [0, 0, 0],
    rot: startRot,
    dist: 8.5,
    fov: 45,
    near: 0.1,
    far: 150
});

// --- Instantiate Core Engines ---
const csg = new CSGEngine(scene);
const cutter = new CutterTool(scene);

csg.initWorkpiece('box');

// Toast notification helper
let toastTimeout = null;
function showToast(msg) {
    const el = document.getElementById('status-toast');
    if (!el) return;
    el.textContent = msg;
    el.style.opacity = '1';
    if (toastTimeout) clearTimeout(toastTimeout);
    toastTimeout = setTimeout(() => {
        el.style.opacity = '0';
    }, 2800);
}

function updateStats() {
    const stats = csg.getStats();
    const vEl = document.getElementById('stat-verts');
    const tEl = document.getElementById('stat-tris');
    if (vEl) vEl.textContent = stats.verts.toLocaleString();
    if (tEl) tEl.textContent = stats.tris.toLocaleString();

    const undoBtn = document.getElementById('btn-undo');
    const redoBtn = document.getElementById('btn-redo');
    if (undoBtn) undoBtn.disabled = csg.undoStack.length === 0;
    if (redoBtn) redoBtn.disabled = csg.redoStack.length === 0;
}

// --- Execute Boolean Cut ---
function executeBoolean() {
    const cutterMesh = cutter.getTransformedMesh();
    const op = cutter.operation;
    const ok = csg.applyBoolean(cutterMesh, op);

    if (ok) {
        showToast(`Applied ${op.toUpperCase()} successfully`);
        updateStats();
    } else {
        showToast(`Boolean ${op} failed or empty intersection`);
    }
}

// --- Bind UI Events ---
function bindUI() {
    // Operation buttons
    const opBtns = document.querySelectorAll('.tool-btn[data-op]');
    opBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            opBtns.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            const op = btn.dataset.op;
            cutter.setOperation(op);
            showToast(`Mode: ${op.toUpperCase()}`);
        });
    });

    // Execute Boolean button
    document.getElementById('btn-execute')?.addEventListener('click', () => {
        executeBoolean();
    });

    // Undo / Redo
    document.getElementById('btn-undo')?.addEventListener('click', () => {
        const label = csg.undo();
        if (label) showToast(`Undo: ${label}`);
        updateStats();
    });

    document.getElementById('btn-redo')?.addEventListener('click', () => {
        const label = csg.redo();
        if (label) showToast(`Redo: ${label}`);
        updateStats();
    });

    // Export OBJ
    document.getElementById('btn-export')?.addEventListener('click', () => {
        if (!csg.currentMesh) return;
        try {
            const filename = exportMeshToOBJ(csg.currentMesh, 'sculpture');
            showToast(`Exported ${filename}`);
        } catch (err) {
            showToast(`Export failed: ${err.message}`);
        }
    });

    // Cutter shape buttons
    const shapeBtns = document.querySelectorAll('.shape-btn[data-shape]');
    shapeBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            shapeBtns.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            cutter.setShape(btn.dataset.shape);
            showToast(`Cutter: ${btn.dataset.shape}`);
        });
    });

    // Gizmo mode buttons
    const gizmoBtns = document.querySelectorAll('.gizmo-btn[data-mode]');
    gizmoBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            gizmoBtns.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            cutter.setGizmoMode(btn.dataset.mode);
        });
    });

    // Snap toggle
    document.getElementById('snap-toggle')?.addEventListener('change', (e) => {
        cutter.useSnap = e.target.checked;
    });

    // Preset selection
    document.getElementById('preset-select')?.addEventListener('change', (e) => {
        csg.initWorkpiece(e.target.value);
        cutter.resetTransform();
        updateStats();
        showToast(`Loaded ${e.target.value} blank`);
    });

    // Material theme selection
    document.getElementById('material-select')?.addEventListener('change', (e) => {
        csg.setMaterialTheme(e.target.value);
    });

    // Cutter dimension sliders
    const wSl = document.getElementById('cut-w');
    const hSl = document.getElementById('cut-h');
    const dSl = document.getElementById('cut-d');

    wSl?.addEventListener('input', (e) => {
        const v = parseFloat(e.target.value);
        document.getElementById('cut-w-val').textContent = v.toFixed(2) + 'm';
        cutter.setDimension('width', v);
        cutter.setDimension('radius', v * 0.6);
    });

    hSl?.addEventListener('input', (e) => {
        const v = parseFloat(e.target.value);
        document.getElementById('cut-h-val').textContent = v.toFixed(2) + 'm';
        cutter.setDimension('height', v);
    });

    dSl?.addEventListener('input', (e) => {
        const v = parseFloat(e.target.value);
        document.getElementById('cut-d-val').textContent = v.toFixed(2) + 'm';
        cutter.setDimension('depth', v);
    });

    // Camera Navigation Input
    let isRightDown = false, isMiddleDown = false;
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());

    canvas.addEventListener('mousedown', (e) => {
        if (e.button === 2) isRightDown = true;
        if (e.button === 1) isMiddleDown = true;
    });

    window.addEventListener('mouseup', (e) => {
        if (e.button === 2) isRightDown = false;
        if (e.button === 1) isMiddleDown = false;
    });

    window.addEventListener('mousemove', (e) => {
        if (isRightDown && typeof Camera !== 'undefined' && Camera.orbitLook) {
            Camera.orbitLook(cam, e.movementX, e.movementY);
        }
        if (isMiddleDown && typeof Camera !== 'undefined' && Camera.orbitPan) {
            Camera.orbitPan(cam, e.movementX, e.movementY);
        }
    });

    canvas.addEventListener('wheel', (e) => {
        e.preventDefault();
        cam.dist = Math.max(2.0, Math.min(60.0, cam.dist * Math.exp(e.deltaY * 0.001)));
    }, { passive: false });

    // Keyboard shortcuts
    window.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            executeBoolean();
        } else if ((e.ctrlKey || e.metaKey) && (e.key === 'z' || e.key === 'Z')) {
            e.preventDefault();
            if (e.shiftKey) {
                const label = csg.redo();
                if (label) showToast(`Redo: ${label}`);
            } else {
                const label = csg.undo();
                if (label) showToast(`Undo: ${label}`);
            }
            updateStats();
        } else if ((e.ctrlKey || e.metaKey) && (e.key === 'y' || e.key === 'Y')) {
            e.preventDefault();
            const label = csg.redo();
            if (label) showToast(`Redo: ${label}`);
            updateStats();
        } else if (e.key === 'w' || e.key === 'W') {
            cutter.setGizmoMode('translate');
            updateGizmoActiveBtn('translate');
        } else if (e.key === 'e' || e.key === 'E') {
            cutter.setGizmoMode('rotate');
            updateGizmoActiveBtn('rotate');
        } else if (e.key === 'r' || e.key === 'R') {
            cutter.setGizmoMode('scale');
            updateGizmoActiveBtn('scale');
        }
    });
}

function updateGizmoActiveBtn(mode) {
    const btns = document.querySelectorAll('.gizmo-btn[data-mode]');
    btns.forEach(b => b.classList.toggle('active', b.dataset.mode === mode));
}

bindUI();
updateStats();

// --- Main Render Loop ---
function frame() {
    // Camera view submission
    if (typeof Camera !== 'undefined' && Camera.orbitViewOpts) {
        scene.setCamera(Camera.orbitViewOpts(cam, canvas));
    }

    requestAnimationFrame(frame);
}

requestAnimationFrame(frame);

export { scene, cam, csg, cutter };
