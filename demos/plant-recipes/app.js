// Flora — procedural plant viewer with comprehensive control over
// archetypes, species, life-cycle stages, and forest mixes.

import "/app/recipes/lifecycle.js";
import "/app/recipes/core.js";
import "/app/recipes/species.js";
import "/app/recipes/tree.js";
import "/app/recipes/conifer.js";
import "/app/recipes/shrub.js";
import "/app/recipes/flower.js";
import "/app/recipes/grass.js";
import "/app/recipes/fern.js";
import "/app/recipes/succulent.js";
import "/app/recipes/vine.js";
import "/app/recipes/rosebush.js";
import "/app/recipes/cactus.js";
import "/app/recipes/palm.js";
import { Recipes } from "/app/recipes/index.js";
import { installSystemMenu } from "/lib/system-menu.js";

const canvas = document.getElementById('stage');
const scene = canvas.getContext('scene');

scene.setToneMap({ mode: 'aces', exposure: 1.02 });

// Studio IBL: a neutral bright HDR sky (shared with the lighting demo) gives
// every archetype orientation-dependent ambient — cool skylight from above,
// warm bounce below — plus a real horizon, instead of the old flat near-black
// void. Falls back to a tuned flat ambient if the HDR is missing so the app
// still runs.
const haveHDR = scene.setEnvironment({
    hdr: '../lighting-demo/hdri/kloofendal_43d_clear_puresky_2k.hdr',
    intensity: 0.85, rotation: 2.3,
});
if (!haveHDR) scene.setAmbient([0.30, 0.33, 0.36]);
scene.setFog({ start: 24, end: 110, color: [0.72, 0.78, 0.84] });

// ─── Orbit camera ─────────────────────────────────────────────────────────

const cam = {
    target: [0, 1, 0],
    theta:  Math.PI * 0.25,
    phi:    Math.PI * 0.30,
    radius: 6,
    fov:    50,
    near:   0.1,
    far:    2000,
};

function applyCamera() {
    const sp = Math.sin(cam.phi), cp = Math.cos(cam.phi);
    const st = Math.sin(cam.theta), ct = Math.cos(cam.theta);
    const eye = [
        cam.target[0] + cam.radius * sp * ct,
        cam.target[1] + cam.radius * cp,
        cam.target[2] + cam.radius * sp * st,
    ];
    scene.setCamera({
        position: eye, target: cam.target, up: [0, 1, 0],
        fov: cam.fov, near: cam.near, far: cam.far,
    });
}
applyCamera();

let dragMode = 0;
let lastX = 0, lastY = 0;
canvas.addEventListener('mousedown', (e) => {
    lastX = e.clientX; lastY = e.clientY;
    if (e.button === 2 || e.shiftKey) dragMode = 2;
    else if (e.button === 0)          dragMode = 1;
    e.preventDefault();
});
window.addEventListener('mouseup', () => { dragMode = 0; });
canvas.addEventListener('contextmenu', (e) => e.preventDefault());
canvas.addEventListener('mousemove', (e) => {
    if (!dragMode) return;
    const dx = e.clientX - lastX;
    const dy = e.clientY - lastY;
    lastX = e.clientX; lastY = e.clientY;
    if (dragMode === 1) {
        cam.theta += dx * 0.01;
        cam.phi   += dy * 0.01;
        const eps = 0.05;
        if (cam.phi < eps) cam.phi = eps;
        if (cam.phi > Math.PI - eps) cam.phi = Math.PI - eps;
    } else {
        const sp = Math.sin(cam.phi);
        const right = [-Math.sin(cam.theta), 0, Math.cos(cam.theta)];
        const fwd  = [sp * Math.cos(cam.theta), Math.cos(cam.phi), sp * Math.sin(cam.theta)];
        const up = [
            -fwd[1] * right[2],
            right[0] * fwd[2] - right[2] * fwd[0],
            -right[0] * fwd[1],
        ];
        const k = cam.radius * 0.0015;
        cam.target[0] += (-right[0] * dx + up[0] * dy) * k;
        cam.target[1] += (-right[1] * dx + up[1] * dy) * k;
        cam.target[2] += (-right[2] * dx + up[2] * dy) * k;
    }
    applyCamera();
});
canvas.addEventListener('wheel', (e) => {
    const f = Math.exp(e.deltaY * 0.001);
    cam.radius *= f;
    if (cam.radius < 0.3) cam.radius = 0.3;
    if (cam.radius > 500) cam.radius = 500;
    applyCamera();
    e.preventDefault();
}, { passive: false });

// ─── Lights & ground ──────────────────────────────────────────────────────

// Key sun (CSM-shadowed) — warm, angled to rake form across the plant.
const keyLight = scene.createLight({
    type: 'directional',
    direction: [-0.42, -0.82, -0.35],
    color: [1.0, 0.96, 0.88],
    intensity: 3.0,
    castsShadow: true,
});
keyLight.cascadeCount = 4;
keyLight.cascadeSplitLambda = 0.75;
scene.setShadowQuality(4096, 3);

// Cool sky-toned fill from the opposite side (no shadow) so the shaded side
// reads with depth instead of crushing to black.
scene.createLight({
    type: 'directional',
    direction: [0.55, -0.3, 0.45],
    color: [0.55, 0.68, 0.85],
    intensity: 0.6,
});

let groundNode = null;
function resizeGroundFor(half) {
    if (groundNode && groundNode.destroy) groundNode.destroy();
    groundNode = scene.createMesh({
        mesh: 'plane',
        halfW: half, halfD: half, y: 0,
        color: '#9aa18f', metallic: 0, roughness: 0.95,
        receivesShadow: true,
    });
}
resizeGroundFor(10);

// ─── Stage definitions ────────────────────────────────────────────────────

const STAGES = Recipes.STAGES;

// Map archetype → which stages it actually supports (for the stage bar).
function stagesForArchetype(archetype, opts) {
    switch (archetype) {
        case 'tree':
            return (opts && opts.bloomColor)
                ? Recipes._TreeStages.FLOWERING_TREE_STAGES
                : Recipes._TreeStages.DEFAULT_TREE_STAGES;
        case 'conifer':   return ['seed','sprout','seedling','juvenile','mature','flowering','fruiting'];
        case 'shrub':     return (opts && (opts.bloomColor || opts.fruitColor))
                                ? ['seed','sprout','seedling','juvenile','mature','flowering','fruiting','senescent']
                                : ['seed','sprout','seedling','juvenile','mature','senescent'];
        case 'flower':    return ['seed','sprout','seedling','juvenile','mature','flowering','fruiting','senescent'];
        case 'grassTuft': return ['seed','sprout','seedling','juvenile','mature','flowering','senescent'];
        case 'fern':      return ['seed','sprout','seedling','juvenile','mature','senescent'];
        case 'succulent': return ['seed','sprout','seedling','juvenile','mature','flowering'];
        case 'vine':      return (opts && (opts.bloomColor || opts.fruitColor))
                                ? ['seed','sprout','seedling','juvenile','mature','flowering','fruiting']
                                : ['seed','sprout','seedling','juvenile','mature'];
        case 'rosebush':  return STAGES;
        case 'cactus':    return ['seed','sprout','seedling','juvenile','mature','flowering','fruiting'];
        case 'palm':      return ['seed','sprout','seedling','juvenile','mature','flowering','fruiting'];
    }
    return STAGES;
}

// ─── Parameter schema ─────────────────────────────────────────────────────

const fmtInt = (v) => `${v | 0}`;
const fmt2 = (v) => v.toFixed(2);
const fmt3 = (v) => v.toFixed(3);

// `group` field routes the row into a collapsible <details> section.
const archetypeSchema = {
    tree: [
        { key: 'height',         label: 'height',         type: 'range', min: 1.5, max: 80, step: 0.5,  default: 6,    fmt: fmt2, group: 'general' },
        { key: 'trunkRadius',    label: 'trunk radius',   type: 'range', min: 0.05, max: 4, step: 0.05, default: 0.18, fmt: fmt2, group: 'general' },
        { key: 'canopyRadius',   label: 'canopy radius',  type: 'range', min: 0.5, max: 25, step: 0.2, default: 3,    fmt: fmt2, group: 'general' },
        { key: 'canopyShape',    label: 'canopy shape',   type: 'select', options: Recipes.CANOPY_SHAPES, default: 'round', group: 'general' },
        { key: 'blobCount',      label: 'blob count',     type: 'int',   min: 1, max: 7, default: 3, group: 'advanced' },
        { key: 'canopyColor',    label: 'canopy color',   type: 'color', default: '#4f8c39', group: 'appearance' },
        { key: 'trunkColor',     label: 'trunk color',    type: 'color', default: '#6b4828', group: 'appearance' },
        { key: 'leafShape',      label: 'leaf shape',     type: 'select', options: ['oval','pointed','lobed','frond','needle'], default: 'oval', group: 'appearance' },
        { key: 'foliageStyle',   label: 'foliage style',  type: 'select', options: ['blobs','leaves'], default: 'blobs', group: 'appearance' },
        { key: 'bloomColor',     label: 'bloom color',    type: 'color', default: '#f7c8d8', group: 'lifecycle' },
        { key: 'fruitColor',     label: 'fruit color',    type: 'color', default: '#a01030', group: 'lifecycle' },
    ],
    conifer: [
        { key: 'height',           label: 'height',          type: 'range', min: 2, max: 110, step: 0.5, default: 8, fmt: fmt2, group: 'general' },
        { key: 'trunkRadius',      label: 'trunk radius',    type: 'range', min: 0.04, max: 4, step: 0.05, default: 0.15, fmt: fmt2, group: 'general' },
        { key: 'layers',           label: 'cone layers',     type: 'int',   min: 3, max: 16, default: 7, group: 'general' },
        { key: 'baseCanopyRadius', label: 'base radius',     type: 'range', min: 0.5, max: 18, step: 0.2, default: 2.5, fmt: fmt2, group: 'general' },
        { key: 'coneShape',        label: 'cone shape',      type: 'select', options: ['soft','sharp','tight','spreading','columnar'], default: 'soft', group: 'general' },
        { key: 'canopyColor',      label: 'needle color',    type: 'color', default: '#2e6633', group: 'appearance' },
        { key: 'trunkColor',       label: 'trunk color',     type: 'color', default: '#5a3e22', group: 'appearance' },
    ],
    shrub: [
        { key: 'height',     label: 'height',      type: 'range', min: 0.4, max: 3, step: 0.05, default: 1.5, fmt: fmt2, group: 'general' },
        { key: 'radius',     label: 'radius',      type: 'range', min: 0.3, max: 2.5, step: 0.05, default: 1.2, fmt: fmt2, group: 'general' },
        { key: 'blobCount',  label: 'blob count',  type: 'int',   min: 2, max: 9, default: 5, group: 'general' },
        { key: 'canopyColor',label: 'canopy color',type: 'color', default: '#52943d', group: 'appearance' },
        { key: 'bloomColor', label: 'bloom color', type: 'color', default: '#df3a51', group: 'lifecycle' },
        { key: 'fruitColor', label: 'fruit color', type: 'color', default: '#cc1418', group: 'lifecycle' },
    ],
    grassTuft: [
        { key: 'bladeCount', label: 'blades',      type: 'int',   min: 3, max: 30, default: 12, group: 'general' },
        { key: 'height',     label: 'height',      type: 'range', min: 0.1, max: 2, step: 0.02, default: 0.4, fmt: fmt2, group: 'general' },
        { key: 'baseRadius', label: 'base radius', type: 'range', min: 0.02, max: 0.4, step: 0.01, default: 0.08, fmt: fmt2, group: 'general' },
        { key: 'bladeWidth', label: 'blade width', type: 'range', min: 0.005, max: 0.04, step: 0.001, default: 0.012, fmt: fmt3, group: 'general' },
        { key: 'bend',       label: 'bend',        type: 'range', min: 0, max: 1.5, step: 0.05, default: 0.6, fmt: fmt2, group: 'general' },
        { key: 'color',      label: 'color',       type: 'color', default: '#5e9e36', group: 'appearance' },
        { key: 'plumeColor', label: 'plume color', type: 'color', default: '#d8c89f', group: 'lifecycle' },
    ],
    vine: [
        { key: 'length',      label: 'length',       type: 'range', min: 1, max: 12, step: 0.2, default: 6, fmt: fmt2, group: 'general' },
        { key: 'radius',      label: 'stem radius',  type: 'range', min: 0.01, max: 0.15, step: 0.005, default: 0.04, fmt: fmt3, group: 'general' },
        { key: 'helixRadius', label: 'helix radius', type: 'range', min: 0.1, max: 1.5, step: 0.05, default: 0.5, fmt: fmt2, group: 'general' },
        { key: 'turns',       label: 'turns',        type: 'range', min: 0.5, max: 8, step: 0.25, default: 3, fmt: fmt2, group: 'general' },
        { key: 'leafColor',   label: 'leaf color',   type: 'color', default: '#56822a', group: 'appearance' },
        { key: 'bloomColor',  label: 'bloom color',  type: 'color', default: '#c4a8e6', group: 'lifecycle' },
        { key: 'fruitColor',  label: 'fruit color',  type: 'color', default: '#3a1a4a', group: 'lifecycle' },
    ],
    fern: [
        { key: 'leafletPairs',  label: 'leaflet pairs', type: 'int',   min: 4, max: 30, default: 14, group: 'general' },
        { key: 'length',        label: 'length',        type: 'range', min: 0.5, max: 3, step: 0.1, default: 1.5, fmt: fmt2, group: 'general' },
        { key: 'stemRadius',    label: 'stem radius',   type: 'range', min: 0.005, max: 0.04, step: 0.001, default: 0.012, fmt: fmt3, group: 'general' },
        { key: 'leafletLength', label: 'leaflet len',   type: 'range', min: 0.1, max: 0.7, step: 0.02, default: 0.32, fmt: fmt2, group: 'general' },
        { key: 'curvature',     label: 'curvature',     type: 'range', min: 0.2, max: 3, step: 0.1, default: 1.4, fmt: fmt2, group: 'general' },
        { key: 'leafColor',     label: 'leaf color',    type: 'color', default: '#3e6a2c', group: 'appearance' },
    ],
    succulent: [
        { key: 'leafCount',     label: 'leaf count',    type: 'int',   min: 5, max: 80, default: 24, group: 'general' },
        { key: 'leafLength',    label: 'leaf length',   type: 'range', min: 0.1, max: 1.0, step: 0.02, default: 0.35, fmt: fmt2, group: 'general' },
        { key: 'leafWidth',     label: 'leaf width',    type: 'range', min: 0.02, max: 0.18, step: 0.005, default: 0.06, fmt: fmt3, group: 'general' },
        { key: 'leafThickness', label: 'leaf thick',    type: 'range', min: 0.005, max: 0.06, step: 0.002, default: 0.02, fmt: fmt3, group: 'general' },
        { key: 'tilt',          label: 'tilt',          type: 'range', min: 0, max: 1.4, step: 0.05, default: 0.6, fmt: fmt2, group: 'general' },
        { key: 'color',         label: 'leaf color',    type: 'color', default: '#5a8e6a', group: 'appearance' },
        { key: 'flowerColor',   label: 'flower color',  type: 'color', default: '#fbcd5a', group: 'lifecycle' },
    ],
    flower: [
        { key: 'stemLength',  label: 'stem length',  type: 'range', min: 0.2, max: 1.6, step: 0.05, default: 0.9, fmt: fmt2, group: 'general' },
        { key: 'stemRadius',  label: 'stem radius',  type: 'range', min: 0.005, max: 0.05, step: 0.001, default: 0.012, fmt: fmt3, group: 'general' },
        { key: 'headSize',    label: 'head size',    type: 'range', min: 0.05, max: 0.6, step: 0.01, default: 0.18, fmt: fmt2, group: 'general' },
        { key: 'petalCount',  label: 'petal count',  type: 'int',   min: 3, max: 24, default: 8, group: 'general' },
        { key: 'layers',      label: 'petal layers', type: 'int',   min: 1, max: 5, default: 1, group: 'general' },
        { key: 'petalShape',  label: 'petal shape',  type: 'select', options: ['petal','oval','pointed','lobed'], default: 'petal', group: 'general' },
        { key: 'petalBend',   label: 'petal bend',   type: 'range', min: -1, max: 1, step: 0.05, default: 0.5, fmt: fmt2, group: 'advanced' },
        { key: 'petalCurl',   label: 'petal curl',   type: 'range', min: 0, max: 0.6, step: 0.02, default: 0.10, fmt: fmt2, group: 'advanced' },
        { key: 'petalColor',  label: 'petal color',  type: 'color', default: '#ea527a', group: 'appearance' },
        { key: 'centerColor', label: 'center color', type: 'color', default: '#ffd233', group: 'appearance' },
        { key: 'stemColor',   label: 'stem color',   type: 'color', default: '#3d6e22', group: 'appearance' },
    ],
    rosebush: [
        { key: 'bushHeight',  label: 'bush height',  type: 'range', min: 0.3, max: 3.0, step: 0.05, default: 1.0, fmt: fmt2, group: 'general' },
        { key: 'bushRadius',  label: 'bush radius',  type: 'range', min: 0.2, max: 2.0, step: 0.05, default: 0.8, fmt: fmt2, group: 'general' },
        { key: 'canes',       label: 'canes',        type: 'int',   min: 1, max: 8, default: 4, group: 'general' },
        { key: 'attractorCount', label: 'branch density', type: 'int', min: 30, max: 240, default: 90, group: 'advanced' },
        { key: 'petalCount',  label: 'petal count',  type: 'int',   min: 5, max: 24, default: 12, group: 'general' },
        { key: 'bloomLayers', label: 'bloom layers', type: 'int',   min: 1, max: 6, default: 4, group: 'general' },
        { key: 'petalColor',  label: 'petal color',  type: 'color', default: '#d11f3a', group: 'appearance' },
        { key: 'leafColor',   label: 'leaf color',   type: 'color', default: '#2c5328', group: 'appearance' },
        { key: 'stemColor',   label: 'stem color',   type: 'color', default: '#5a3e22', group: 'appearance' },
        { key: 'thornColor',  label: 'thorn color',  type: 'color', default: '#5a3820', group: 'appearance' },
        { key: 'petalBend',   label: 'petal bend',   type: 'range', min: 0, max: 1, step: 0.05, default: 0.55, fmt: fmt2, group: 'advanced' },
        { key: 'petalCurl',   label: 'petal curl',   type: 'range', min: 0, max: 0.6, step: 0.02, default: 0.30, fmt: fmt2, group: 'advanced' },
        { key: 'hipColor',    label: 'hip color',    type: 'color', default: '#b81818', group: 'lifecycle' },
    ],
    cactus: [
        { key: 'shape',       label: 'shape',        type: 'select', options: ['barrel','pricklyPear','saguaro','hedgehog'], default: 'barrel', group: 'general' },
        { key: 'height',      label: 'height',       type: 'range', min: 0.2, max: 8, step: 0.05, default: 1.2, fmt: fmt2, group: 'general' },
        { key: 'radius',      label: 'radius',       type: 'range', min: 0.1, max: 1.0, step: 0.02, default: 0.45, fmt: fmt2, group: 'general' },
        { key: 'ribs',        label: 'ribs (barrel)',type: 'int',   min: 6, max: 24, default: 14, group: 'advanced' },
        { key: 'pads',        label: 'pads (pear)',  type: 'int',   min: 1, max: 12, default: 4, group: 'advanced' },
        { key: 'arms',        label: 'arms (saguaro)', type: 'int', min: 0, max: 6, default: 2, group: 'advanced' },
        { key: 'color',       label: 'body color',   type: 'color', default: '#4a7d3a', group: 'appearance' },
        { key: 'flowerColor', label: 'flower color', type: 'color', default: '#fbcd3a', group: 'lifecycle' },
        { key: 'fruitColor',  label: 'fruit color',  type: 'color', default: '#c45a4e', group: 'lifecycle' },
    ],
    palm: [
        { key: 'height',      label: 'height',       type: 'range', min: 1.5, max: 16, step: 0.2, default: 7, fmt: fmt2, group: 'general' },
        { key: 'trunkRadius', label: 'trunk radius', type: 'range', min: 0.05, max: 0.5, step: 0.01, default: 0.18, fmt: fmt2, group: 'general' },
        { key: 'fronds',      label: 'fronds',       type: 'int',   min: 4, max: 24, default: 12, group: 'general' },
        { key: 'frondLength', label: 'frond length', type: 'range', min: 0.5, max: 3.5, step: 0.1, default: 2.2, fmt: fmt2, group: 'general' },
        { key: 'trunkColor',  label: 'trunk color',  type: 'color', default: '#7a5a3c', group: 'appearance' },
        { key: 'frondColor',  label: 'frond color',  type: 'color', default: '#3a6a2a', group: 'appearance' },
        { key: 'fruitColor',  label: 'fruit color',  type: 'color', default: '#5e3a18', group: 'lifecycle' },
    ],
};

const ARCHETYPES = Object.keys(archetypeSchema);

const commonSchema = [
    { key: 'archetype', label: 'type',    type: 'select', options: ARCHETYPES, default: 'tree', group: '_' },
    { key: 'species',   label: 'species', type: 'select', options: [], default: '', group: '_' },
    { key: 'age',       label: 'age',     type: 'range', min: 0, max: 1, step: 0.005, default: 1, fmt: fmt2, group: '_' },
    { key: 'seed',      label: 'seed',    type: 'int',   min: 0, max: 99999, default: 1, group: '_' },
];

const forestSchema = [
    { key: 'archetype',    label: 'type',    type: 'select', options: ARCHETYPES, default: 'tree', group: '_' },
    { key: 'species',      label: 'species', type: 'select', options: [], default: '', group: '_' },
    { key: 'speciesMix',   label: 'mix',     type: 'select', options: ['single','mixed-genus','random'], default: 'mixed-genus', group: '_' },
    { key: 'count',        label: 'count', type: 'int', min: 1, max: 250, default: 32, group: 'forest' },
    { key: 'patchSize',    label: 'patch size', type: 'range', min: 6, max: 300, step: 1, default: 60, fmt: fmt2, group: 'forest' },
    { key: 'jitter',       label: 'packing', type: 'range', min: 0, max: 1, step: 0.02, default: 0.55, fmt: fmt2, group: 'forest' },
    { key: 'sharing',      label: 'canopy sharing', type: 'range', min: 0, max: 1, step: 0.02, default: 0.85, fmt: fmt2, group: 'forest' },
    { key: 'canopyGap',    label: 'canopy gap', type: 'range', min: 0, max: 2, step: 0.05, default: 0.4, fmt: fmt2, group: 'forest' },
    { key: 'maxCanopyR',   label: 'max canopy R', type: 'range', min: 1, max: 25, step: 0.2, default: 9, fmt: fmt2, group: 'forest' },
    { key: 'baseHeight',   label: 'tree height', type: 'range', min: 2, max: 60, step: 0.5, default: 14, fmt: fmt2, group: 'forest' },
    { key: 'baseTrunkR',   label: 'trunk radius', type: 'range', min: 0.05, max: 3, step: 0.05, default: 0.45, fmt: fmt2, group: 'forest' },
    { key: 'sizeJitter',   label: 'size jitter', type: 'range', min: 0, max: 1, step: 0.02, default: 0.45, fmt: fmt2, group: 'forest' },
    { key: 'shapeMix',     label: 'shape mix', type: 'select',
      options: ['round-only','broadleaf-mix','all-shapes'], default: 'broadleaf-mix', group: 'forest' },
    { key: 'ageJitter',    label: 'age jitter', type: 'range', min: 0, max: 0.6, step: 0.02, default: 0.15, fmt: fmt2, group: 'forest' },
    { key: 'age',          label: 'age',   type: 'range', min: 0, max: 1, step: 0.005, default: 1, fmt: fmt2, group: '_' },
    { key: 'seed',         label: 'seed',  type: 'int',   min: 0, max: 99999, default: 1, group: '_' },
];

const GROUP_ORDER = ['_', 'general', 'lifecycle', 'appearance', 'advanced', 'forest'];
const GROUP_LABELS = { '_': '', general: 'General', lifecycle: 'Life cycle', appearance: 'Appearance', advanced: 'Advanced', forest: 'Forest' };

// ─── Mode + parameter state ───────────────────────────────────────────────

let mode = 'single';
const state = {};
const inputs = {};

function mulberry32(seed) {
    let s = (seed >>> 0) || 1;
    return function () {
        s = (s + 0x6D2B79F5) >>> 0;
        let t = s;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

function hexToRgb(hex) {
    const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(String(hex || ''));
    if (!m) return [0.4, 0.6, 0.3];
    return [parseInt(m[1], 16) / 255, parseInt(m[2], 16) / 255, parseInt(m[3], 16) / 255];
}

function setDefaults() {
    const archSchema = archetypeSchema[state.archetype || 'tree'] || [];
    const schema = mode === 'single' ? commonSchema.concat(archSchema) : forestSchema;
    for (const f of schema) {
        if (state[f.key] === undefined) state[f.key] = f.default;
    }
    // Default species: first one from the table.
    const list = Recipes.speciesList(state.archetype) || [];
    if (state.species === undefined || state.species === '') {
        state.species = list[0] || '';
    }
}

function clearStateForArchetypeSwitch() {
    const keep = new Set(['archetype','age','seed','count','patchSize','jitter','sharing',
        'canopyGap','maxCanopyR','baseHeight','baseTrunkR','sizeJitter','shapeMix','speciesMix','ageJitter']);
    for (const k of Object.keys(state)) {
        if (!keep.has(k)) delete state[k];
    }
}

// Build the species options for the current archetype.
function speciesOptions() {
    const list = Recipes.speciesList(state.archetype || 'tree') || [];
    return [''].concat(list);   // '' = no species (use raw archetype defaults)
}

// ─── Stage indicator bar ──────────────────────────────────────────────────

function buildStageBar() {
    const bar = document.getElementById('stage-bar');
    bar.innerHTML = '';
    const arch = state.archetype || 'tree';
    const supported = stagesForArchetype(arch, currentBuildOpts());
    const supportedSet = new Set(supported);

    // Map age01 → which stage of `supported`
    const r = Recipes.resolveStage(supported, state.age ?? 1);
    const activeStage = r.stage;

    for (const s of STAGES) {
        const pill = document.createElement('div');
        pill.className = 'stagepill';
        pill.textContent = s;
        if (supportedSet.has(s)) {
            pill.classList.add('supported');
            if (s === activeStage) pill.classList.add('active');
            pill.addEventListener('click', () => {
                // Jump age to centre of this stage in the supported list.
                const idx = supported.indexOf(s);
                if (idx < 0) return;
                state.age = (idx + 0.5) / supported.length;
                if (inputs.age) inputs.age.value = state.age;
                regenerate(false);
            });
        } else {
            pill.classList.add('disabled');
        }
        bar.appendChild(pill);
    }
}

function currentBuildOpts() {
    // Snapshot of state with species applied (for determining which stages
    // are supported — e.g. trees only have flowering+fruiting if the
    // species defines bloom/fruit colors). Returns a *plain* options
    // object the dispatchers will receive.
    const opts = { archetype: state.archetype, species: state.species };
    const archSchema = archetypeSchema[state.archetype] || [];
    for (const f of archSchema) {
        if (state[f.key] !== undefined) opts[f.key] = state[f.key];
    }
    const SP = (typeof Recipes !== 'undefined' ? Recipes.Species : null);
    if (opts.species && SP && SP[opts.archetype] && SP[opts.archetype][opts.species]) {
        Object.assign(opts, SP[opts.archetype][opts.species], opts);
    }
    return opts;
}

// ─── Panel build ──────────────────────────────────────────────────────────

function buildPanel() {
    const params = document.getElementById('params');
    params.innerHTML = '';
    for (const k of Object.keys(inputs)) delete inputs[k];

    const archSchema = archetypeSchema[state.archetype || 'tree'] || [];
    const schema = mode === 'single' ? commonSchema.concat(archSchema) : forestSchema;

    // Group rows by their `group` field; render each non-underscore group
    // inside a <details>. Underscore = always-shown common controls.
    const groupedRows = {};
    for (const f of schema) {
        const g = f.group || 'general';
        if (!groupedRows[g]) groupedRows[g] = [];
        groupedRows[g].push(f);
    }

    for (const g of GROUP_ORDER) {
        const rows = groupedRows[g];
        if (!rows || rows.length === 0) continue;
        if (g === '_') {
            for (const f of rows) params.appendChild(buildRow(f));
        } else {
            const det = document.createElement('details');
            det.className = 'group';
            det.open = (g === 'general' || g === 'lifecycle' || g === 'forest');
            const sum = document.createElement('summary');
            sum.textContent = GROUP_LABELS[g];
            det.appendChild(sum);
            for (const f of rows) det.appendChild(buildRow(f));
            params.appendChild(det);
        }
    }

    buildStageBar();
}

function buildRow(f) {
    const row = document.createElement('div');
    row.className = 'row';
    const lab = document.createElement('label');
    lab.textContent = f.label;
    row.appendChild(lab);

    let val = state[f.key];
    if (f.key === 'species') {
        // Species select uses dynamic options based on archetype.
        const sel = document.createElement('select');
        for (const opt of speciesOptions()) {
            const o = document.createElement('option');
            o.value = opt; o.textContent = opt || '(none)';
            if (opt === val) o.selected = true;
            sel.appendChild(o);
        }
        sel.addEventListener('change', () => {
            state.species = sel.value;
            buildStageBar();
            regenerate(false);
        });
        row.appendChild(sel);
        inputs[f.key] = sel;
        return row;
    }

    if (f.type === 'range') {
        const inp = document.createElement('input');
        inp.type = 'range';
        inp.min = f.min; inp.max = f.max; inp.step = f.step;
        inp.value = val;
        const out = document.createElement('span');
        out.className = 'v';
        const fmt = f.fmt || fmt2;
        out.textContent = fmt(parseFloat(val));
        inp.addEventListener('input', () => {
            const v = parseFloat(inp.value);
            state[f.key] = v;
            out.textContent = fmt(v);
            if (f.key === 'age') buildStageBar();
            scheduleRegen();
        });
        row.appendChild(inp); row.appendChild(out);
        inputs[f.key] = inp;
    } else if (f.type === 'int') {
        const inp = document.createElement('input');
        inp.type = 'number';
        inp.min = f.min; inp.max = f.max; inp.step = 1;
        inp.value = val;
        inp.addEventListener('change', () => {
            const v = parseInt(inp.value, 10);
            state[f.key] = isNaN(v) ? f.default : v;
            scheduleRegen();
        });
        row.appendChild(inp);
        inputs[f.key] = inp;
    } else if (f.type === 'select') {
        const sel = document.createElement('select');
        for (const opt of f.options) {
            const o = document.createElement('option');
            o.value = opt; o.textContent = opt;
            if (opt === val) o.selected = true;
            sel.appendChild(o);
        }
        sel.addEventListener('change', () => {
            state[f.key] = sel.value;
            if (f.key === 'archetype') {
                clearStateForArchetypeSwitch();
                state.archetype = sel.value;
                state.species = ''; // reset; setDefaults picks first
                setDefaults();
                buildPanel();
                regenerate(true);
            } else if (f.key === 'shape') {
                regenerate(false);
            } else {
                buildStageBar();
                regenerate(false);
            }
        });
        row.appendChild(sel);
        inputs[f.key] = sel;
    } else if (f.type === 'color') {
        const inp = document.createElement('input');
        inp.type = 'color';
        inp.value = val;
        inp.addEventListener('input', () => {
            state[f.key] = inp.value;
            scheduleRegen();
        });
        row.appendChild(inp);
        inputs[f.key] = inp;
    }
    return row;
}

// ─── Plant generation ─────────────────────────────────────────────────────

let plantNodes = [];

function destroyNodes() {
    for (const n of plantNodes) { n.destroy && n.destroy(); }
    plantNodes = [];
}

function spawnPart(part, tx, ty, tz) {
    if (!part.mesh) return null;
    return scene.createMesh({
        data: part.mesh,
        x: tx || 0, y: ty || 0, z: tz || 0,
        color: part.color || [0.6, 0.6, 0.6],
        metallic: part.metallic ?? 0.0,
        roughness: part.roughness ?? 0.9,
        twoSided: part.twoSided ?? true,
        castsShadow: true, receivesShadow: true,
    });
}

function buildSinglePlantOpts() {
    const archSchema = archetypeSchema[state.archetype] || [];
    const opts = { seed: state.seed | 0, age01: state.age, species: state.species || undefined };
    for (const f of archSchema) {
        let v = state[f.key];
        if (v === undefined) continue;
        opts[f.key] = v;
    }
    return opts;
}

function regenerateSingle() {
    destroyNodes();
    const t0 = performance.now();
    const opts = buildSinglePlantOpts();
    let result;
    try {
        result = Recipes[state.archetype](opts);
    } catch (e) {
        console.error('flora: recipe error', e);
        document.getElementById('stats').textContent = 'error: ' + e.message;
        return null;
    }
    if (!result) return null;
    if (result.aabbMin && result.aabbMax) {
        const footprint = Math.max(
            Math.abs(result.aabbMin[0]), Math.abs(result.aabbMax[0]),
            Math.abs(result.aabbMin[2]), Math.abs(result.aabbMax[2]),
        );
        resizeGroundFor(Math.max(2, footprint * 3));
    }
    const ms = performance.now() - t0;
    let partCount = 0, triCount = 0;
    if (result.parts) {
        for (const p of result.parts) {
            const node = spawnPart(p, 0, 0, 0);
            if (node) {
                plantNodes.push(node);
                partCount++;
                if (p.mesh && p.mesh.triangleCount !== undefined) triCount += p.mesh.triangleCount;
            }
        }
    }
    document.getElementById('stats').textContent =
        `${state.archetype}${state.species ? ' · ' + state.species : ''} · ${ms.toFixed(1)} ms · ${partCount} parts · ${triCount} tris`;
    return result;
}

function fitCameraToBounds(min, max) {
    const cx = (max[0] + min[0]) * 0.5;
    const cy = (max[1] + min[1]) * 0.5;
    const cz = (max[2] + min[2]) * 0.5;
    const sx = max[0] - min[0], sy = max[1] - min[1], sz = max[2] - min[2];
    const ext = Math.max(sx, sy, sz);
    cam.target = [cx, cy, cz];
    cam.radius = Math.max(0.4, ext * 2.0);
    applyCamera();
}

// ─── Forest mode ──────────────────────────────────────────────────────────

const TREE_LIKE = new Set(['tree','conifer','shrub','rosebush']);
const BROADLEAF_SHAPES = ['round','oval','umbrella','vase','spreading','irregular','weeping'];

function pickShape(rng, mix) {
    if (mix === 'round-only') return 'round';
    const list = mix === 'all-shapes' ? Recipes.CANOPY_SHAPES : BROADLEAF_SHAPES;
    return list[(rng() * list.length) | 0];
}

function pickSpecies(archetype, mix, rng, pinned) {
    const list = Recipes.speciesList(archetype) || [];
    if (list.length === 0) return '';
    if (mix === 'single') return pinned || list[0];
    return list[(rng() * list.length) | 0];
}

function regenerateForest() {
    destroyNodes();
    const archetype = state.archetype;
    const count = Math.max(1, state.count | 0);
    const patch = state.patchSize;
    const jitter = state.jitter;
    const sharing = state.sharing;
    const gapWidth = state.canopyGap;
    const maxCanopyR = state.maxCanopyR;
    const sizeJitter = state.sizeJitter;
    const shapeMix = state.shapeMix;
    const speciesMix = state.speciesMix || 'mixed-genus';
    const ageJitter = state.ageJitter ?? 0;
    const baseSeed = state.seed | 0;
    const age = state.age;

    resizeGroundFor(Math.max(10, patch * 0.7));

    const useForestSize = TREE_LIKE.has(archetype);
    const baseHeight = useForestSize ? state.baseHeight :
        archetype === 'shrub' ? 1.5 : 4;
    const baseTrunk = useForestSize ? state.baseTrunkR :
        archetype === 'shrub' ? 0.06 : 0.18;
    const maxR = useForestSize ? maxCanopyR : (archetype === 'shrub' ? 1.2 : 1.5);

    const placeRng = mulberry32(baseSeed * 7919);
    const placeGap = gapWidth + maxR * 0.05;
    const minDesired = useForestSize ? 0.45 : 0.7;
    const desired = [];
    for (let i = 0; i < count; i++) {
        const sizeT = Math.pow(placeRng(), 1.4);
        const sizeFrac = 1 - sizeT * (1 - minDesired);
        const sjit = 1 + (placeRng() - 0.5) * sizeJitter * 0.5;
        desired.push(Math.max(0.4, maxR * sizeFrac * sjit));
    }
    const overlapAllow = 0.7 + jitter * 0.25;
    desired.sort((a, b) => b - a);

    const positions = [];
    const placedR = [];
    for (const r of desired) {
        if (positions.length >= count) break;
        let placed = false;
        const maxAttempts = 40;
        for (let attempt = 0; attempt < maxAttempts; attempt++) {
            const x = (placeRng() - 0.5) * patch;
            const z = (placeRng() - 0.5) * patch;
            let ok = true;
            for (let i = 0; i < positions.length; i++) {
                const dx = x - positions[i][0];
                const dz = z - positions[i][1];
                const d = Math.sqrt(dx * dx + dz * dz);
                if (d < (r + placedR[i]) * overlapAllow + placeGap) { ok = false; break; }
            }
            if (ok) { positions.push([x, z]); placedR.push(r); placed = true; break; }
        }
    }

    const trees = positions.map((pos, i) => {
        const r = mulberry32(baseSeed * 31 + i * 1009 + 17);
        const sizeFrac = placedR[i] / Math.max(0.001, maxR);
        const corrH = 0.55 + 0.45 * sizeFrac;
        const heightK = corrH * (1 + (r() - 0.5) * sizeJitter * 0.4);
        const trunkK  = corrH * (1 + (r() - 0.5) * sizeJitter * 0.3);
        const species = pickSpecies(archetype, speciesMix, r, state.species);
        return {
            x: pos[0], z: pos[1],
            height: Math.max(0.5, baseHeight * heightK),
            trunkRadius: Math.max(0.03, baseTrunk * trunkK),
            desiredR: placedR[i],
            canopyRadius: placedR[i],
            shape: pickShape(r, shapeMix),
            blobCount: 2 + ((r() * 4) | 0),
            seed: (baseSeed * 17 + i * 113 + 1) | 0,
            colorJ: (r() - 0.5) * 0.08,
            shiftX: 0, shiftZ: 0, asym: 0,
            species,
            age01: Math.max(0, Math.min(1, age + (r() - 0.5) * ageJitter * 2)),
        };
    });

    if (TREE_LIKE.has(archetype) && trees.length > 1) {
        const minR = 0.3;
        const cur = trees.map((t) => t.desiredR);
        for (let iter = 0; iter < 6; iter++) {
            const next = new Array(trees.length);
            for (let i = 0; i < trees.length; i++) {
                let avail = Infinity;
                for (let j = 0; j < trees.length; j++) {
                    if (i === j) continue;
                    const dx = trees[i].x - trees[j].x;
                    const dz = trees[i].z - trees[j].z;
                    const d = Math.sqrt(dx*dx + dz*dz);
                    const a = d - cur[j] - gapWidth;
                    if (a < avail) avail = a;
                }
                if (!isFinite(avail)) avail = trees[i].desiredR;
                next[i] = Math.max(minR, Math.min(trees[i].desiredR, avail));
            }
            for (let i = 0; i < trees.length; i++) {
                cur[i] = cur[i] + (next[i] - cur[i]) * 0.7;
            }
        }
        for (let i = 0; i < trees.length; i++) {
            const desired = trees[i].desiredR;
            trees[i].canopyRadius = Math.max(minR, desired + (cur[i] - desired) * sharing);
        }

        for (let i = 0; i < trees.length; i++) {
            const t = trees[i];
            let lx = 0, lz = 0, w = 0;
            for (let j = 0; j < trees.length; j++) {
                if (i === j) continue;
                const o = trees[j];
                const dx = t.x - o.x, dz = t.z - o.z;
                const d = Math.sqrt(dx * dx + dz * dz);
                const reach = (t.canopyRadius + o.canopyRadius) * 1.4;
                if (d <= 1e-3 || d >= reach) continue;
                const wt = 1 - d / reach;
                lx += (dx / d) * wt; lz += (dz / d) * wt; w += wt;
            }
            const llen = Math.sqrt(lx * lx + lz * lz);
            if (llen > 1e-6 && w > 0) {
                const mag = t.canopyRadius * 0.18 * sharing;
                t.shiftX = (lx / llen) * mag;
                t.shiftZ = (lz / llen) * mag;
                t.asym = sharing * 0.6 * Math.min(1, w);
            }
        }
    }

    const aabb = { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] };
    const t0 = performance.now();
    let totalParts = 0, totalTris = 0;
    for (const t of trees) {
        const opts = {
            seed: t.seed,
            age01: t.age01,
            species: t.species,
            height: t.height,
            trunkRadius: t.trunkRadius,
            canopyRadius: t.canopyRadius,
            canopyShape: t.shape,
            blobCount: t.blobCount,
            canopyShift: [t.shiftX, 0, t.shiftZ],
            canopyAsymmetry: t.asym,
            radius: t.canopyRadius,
            bushHeight: t.height * 0.5,
            bushRadius: t.canopyRadius,
        };
        let result;
        try { result = Recipes[archetype](opts); }
        catch (e) { console.error('flora: forest recipe error', e); continue; }
        if (!result || !result.parts) continue;
        for (const p of result.parts) {
            const node = spawnPart(p, t.x, 0, t.z);
            if (node) {
                plantNodes.push(node); totalParts++;
                if (p.mesh && p.mesh.triangleCount !== undefined) totalTris += p.mesh.triangleCount;
            }
        }
        const mn = result.aabbMin, mx = result.aabbMax;
        if (mn && mx) {
            if (t.x + mn[0] < aabb.min[0]) aabb.min[0] = t.x + mn[0];
            if (t.z + mn[2] < aabb.min[2]) aabb.min[2] = t.z + mn[2];
            if (mn[1]       < aabb.min[1]) aabb.min[1] = mn[1];
            if (t.x + mx[0] > aabb.max[0]) aabb.max[0] = t.x + mx[0];
            if (t.z + mx[2] > aabb.max[2]) aabb.max[2] = t.z + mx[2];
            if (mx[1]       > aabb.max[1]) aabb.max[1] = mx[1];
        }
    }
    const ms = performance.now() - t0;
    document.getElementById('stats').textContent =
        `forest · ${trees.length} ${archetype}${trees.length === 1 ? '' : 's'} · ${ms.toFixed(0)} ms · ${totalParts} parts · ${totalTris} tris`;

    if (!isFinite(aabb.min[0])) {
        aabb.min = [-patch * 0.5, 0, -patch * 0.5];
        aabb.max = [patch * 0.5, baseHeight, patch * 0.5];
    }
    return { aabbMin: aabb.min, aabbMax: aabb.max };
}

// ─── Lifecycle preview animation ──────────────────────────────────────────

let animActive = false;
let animStart = 0;
const ANIM_PERIOD_MS = 12000;

function animTick(t) {
    if (!animActive) return;
    const elapsed = (t - animStart) % ANIM_PERIOD_MS;
    const p = elapsed / ANIM_PERIOD_MS;        // 0..1
    state.age = p;
    if (inputs.age) inputs.age.value = p;
    buildStageBar();
    regenerate(false);
    requestAnimationFrame(animTick);
}

function setAnimActive(on) {
    animActive = on;
    const btn = document.getElementById('anim');
    btn.classList.toggle('on', !!on);
    btn.textContent = on ? '■ Cycle' : '▶ Cycle';
    if (on) {
        animStart = performance.now();
        requestAnimationFrame(animTick);
    }
}

// ─── Regenerate + scheduling ──────────────────────────────────────────────

let regenTimer = null;
function scheduleRegen() {
    if (regenTimer) return;
    regenTimer = setTimeout(() => { regenTimer = null; regenerate(false); }, 16);
}

let needFitCamera = true;
function regenerate(refit) {
    const result = mode === 'single' ? regenerateSingle() : regenerateForest();
    if ((refit || needFitCamera) && result && result.aabbMin && result.aabbMax) {
        fitCameraToBounds(result.aabbMin, result.aabbMax);
        needFitCamera = false;
    }
}

// ─── Tabs + actions ───────────────────────────────────────────────────────

document.querySelectorAll('.tab').forEach((t) => {
    t.addEventListener('click', () => {
        const next = t.getAttribute('data-mode');
        if (next === mode) return;
        document.querySelectorAll('.tab').forEach((x) => x.classList.remove('active'));
        t.classList.add('active');
        mode = next;
        for (const k of Object.keys(state)) delete state[k];
        setDefaults();
        buildPanel();
        needFitCamera = true;
        regenerate(true);
    });
});

document.getElementById('regen').addEventListener('click', () => regenerate(true));
document.getElementById('fit').addEventListener('click', () => {
    needFitCamera = true;
    regenerate(true);
});
document.getElementById('reseed').addEventListener('click', () => {
    state.seed = (Math.random() * 99999) | 0;
    if (inputs.seed) inputs.seed.value = state.seed;
    regenerate(false);
});
document.getElementById('reset').addEventListener('click', () => {
    for (const k of Object.keys(state)) delete state[k];
    setDefaults();
    buildPanel();
    needFitCamera = true;
    regenerate(true);
});
document.getElementById('anim').addEventListener('click', () => setAnimActive(!animActive));

// ─── Boot ─────────────────────────────────────────────────────────────────

installSystemMenu();
setDefaults();
buildPanel();
regenerate(true);

// Expose for headless test scripts.
globalThis.__floraState = state;
globalThis.__floraSetMode = (m) => {
    if (m === mode) return;
    document.querySelectorAll('.tab').forEach((x) => x.classList.remove('active'));
    document.querySelector(`.tab[data-mode="${m}"]`).classList.add('active');
    mode = m;
    for (const k of Object.keys(state)) delete state[k];
    setDefaults(); buildPanel(); needFitCamera = true; regenerate(true);
};
globalThis.__floraSetState = (patch) => {
    if (patch.archetype && patch.archetype !== state.archetype) {
        for (const k of Object.keys(state)) delete state[k];
        Object.assign(state, patch);
        setDefaults();
    } else {
        Object.assign(state, patch);
    }
    needFitCamera = true;
    buildPanel();
    regenerate(true);
};
globalThis.__floraRegenerate = () => regenerate(false);
globalThis.__floraStats = () => ({
    parts: plantNodes.length,
    text: document.getElementById('stats').textContent,
});
