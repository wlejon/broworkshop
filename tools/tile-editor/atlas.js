// atlas.js — tile ids and the texture atlas the TileWorld draws from.
//
// Ground tile ids: 1 grass, 2 dirt, 3 stone, 4 sand, 5 water (animated),
// 9 wood, 10 plaza (tan tile), 11 lush grass. Overlay (layer 1) ids: 20 road
// (autotiled, edge mode), 21 crop. Ground ids double as their own atlas cell
// (identity-mapped by tileAtlasTable); the cliff, crop and road variants live
// at higher cells that no ground id uses.
//
// The art is Kenney's CC0 "Retro Textures Fantasy" (assets/tiles/, see
// LICENSE.txt there), composited at startup into one atlas canvas.

import { appPath } from "/lib/kit/ml.js";

export const GROUND_IDS = {
    grass: 1, dirt: 2, stone: 3, sand: 4, water: 5,
    wood: 9, plaza: 10, lush: 11,
};
export const OVERLAY_IDS = { road: 20, crop: 21 };
/** Ground that blocks pathfinding (sets BLOCK_BIT when painted). */
export const BLOCKING_GROUND = new Set([GROUND_IDS.stone, GROUND_IDS.water]);

// Cells are the source textures' native 64 px; 8x4 = 32 cells (about 30 used).
export const ATLAS_COLS = 8, ATLAS_ROWS = 4, CELL_PX = 64;
export const CLIFF_CELL = 12;
const CROP_CELL = 13;
const ROAD_VARIANT_BASE = 14;   // 16 cells, 14..29
export const WATER_FRAMES = [5, 6, 7, 8];
const TILE_ATLAS_TABLE_SIZE = 32;

/** Swatches for the ground and overlay brushes: { id, label, cell } (no cell = erase). */
export const GROUND_SWATCHES = [
    { id: GROUND_IDS.grass, label: 'Grass', cell: GROUND_IDS.grass },
    { id: GROUND_IDS.dirt,  label: 'Dirt',  cell: GROUND_IDS.dirt },
    { id: GROUND_IDS.stone, label: 'Stone', cell: GROUND_IDS.stone },
    { id: GROUND_IDS.sand,  label: 'Sand',  cell: GROUND_IDS.sand },
    { id: GROUND_IDS.water, label: 'Water', cell: GROUND_IDS.water },
    { id: GROUND_IDS.wood,  label: 'Wood',  cell: GROUND_IDS.wood },
    { id: GROUND_IDS.plaza, label: 'Plaza', cell: GROUND_IDS.plaza },
    { id: GROUND_IDS.lush,  label: 'Lush',  cell: GROUND_IDS.lush },
    { id: 0, label: 'Erase' },
];
export const OVERLAY_SWATCHES = [
    // Road has 16 autotile variants; the thumbnail is the crossroads one.
    { id: OVERLAY_IDS.road, label: 'Road', cell: ROAD_VARIANT_BASE + 15 },
    { id: OVERLAY_IDS.crop, label: 'Crop', cell: CROP_CELL },
    { id: 0, label: 'Erase' },
];

/** Minimap colour per ground id (0 = empty). */
export const MINIMAP_COLORS = {
    [GROUND_IDS.grass]: [110, 158, 92],
    [GROUND_IDS.dirt]:  [138, 100, 66],
    [GROUND_IDS.stone]: [150, 150, 158],
    [GROUND_IDS.sand]:  [214, 198, 158],
    [GROUND_IDS.water]: [86, 134, 196],
    [GROUND_IDS.wood]:  [140, 95, 55],
    [GROUND_IDS.plaza]: [196, 190, 172],
    [GROUND_IDS.lush]:  [58, 122, 50],
    0: [24, 24, 28],
};

/** Pixel rect [x, y, size] of atlas cell `cell`. */
export function cellRect(cell) {
    return [(cell % ATLAS_COLS) * CELL_PX, Math.floor(cell / ATLAS_COLS) * CELL_PX, CELL_PX];
}

// `new Image().src` decodes synchronously; appPath anchors the file to the
// app directory rather than a process-wide base.
function tileImage(name) {
    const img = new Image();
    img.src = appPath('assets/tiles/' + name + '.png');
    return img;
}

/** Composite the atlas: { pixels, width, height }. */
export function buildAtlas() {
    const w = ATLAS_COLS * CELL_PX, h = ATLAS_ROWS * CELL_PX;
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const ctx = c.getContext('2d');
    ctx.imageSmoothingEnabled = false;
    ctx.fillStyle = '#111'; ctx.fillRect(0, 0, w, h);
    const draw = (cell, img) => { const [x, y] = cellRect(cell); ctx.drawImage(img, x, y, CELL_PX, CELL_PX); };
    const wash = (cell, style) => { const [x, y] = cellRect(cell); ctx.fillStyle = style; ctx.fillRect(x, y, CELL_PX, CELL_PX); };

    const tex = {
        grass: tileImage('floor_ground_grass'), lush: tileImage('floor_ground_grass_overlay'),
        dirt: tileImage('floor_ground_dirt'), sand: tileImage('floor_ground_sand'),
        water: tileImage('floor_ground_water'), waterGreen: tileImage('floor_ground_water_green'),
        stone: tileImage('floor_stone'), wood: tileImage('floor_wood_planks'),
        plaza: tileImage('floor_tiles_tan_small'),
    };
    for (const k of ['grass', 'dirt', 'stone', 'sand', 'wood', 'plaza', 'lush']) draw(GROUND_IDS[k], tex[k]);

    // Water: 4 frames from the 2 sources, every other one lightened (shimmer).
    const waterSrc = [tex.water, tex.water, tex.waterGreen, tex.waterGreen];
    WATER_FRAMES.forEach((cell, i) => {
        draw(cell, waterSrc[i]);
        if (i % 2) wash(cell, 'rgba(255,255,255,0.12)');
    });

    // Cliff face: stone, darkened against the ground above it.
    draw(CLIFF_CELL, tex.stone);
    wash(CLIFF_CELL, 'rgba(0,0,0,0.35)');

    // Crop: dirt with a 3x3 leaf pattern.
    draw(CROP_CELL, tex.dirt);
    {
        const [x, y] = cellRect(CROP_CELL);
        ctx.fillStyle = '#5f9a2f';
        for (let ry = 0; ry < 3; ry++)
            for (let rx = 0; rx < 3; rx++) ctx.fillRect(x + 8 + rx * 20, y + 8 + ry * 20, 8, 8);
    }

    // Road variants: plaza with a stripe toward each joined edge. The variant
    // is the 4-bit neighbour mask (bit0 E, bit1 N, bit2 W, bit3 S).
    for (let v = 0; v < 16; v++) {
        const [x, y, s] = cellRect(ROAD_VARIANT_BASE + v);
        ctx.drawImage(tex.plaza, x, y, s, s);
        ctx.strokeStyle = 'rgba(216,208,192,0.85)';
        ctx.lineWidth = 6;
        const cx = x + s / 2, cy = y + s / 2;
        ctx.beginPath();
        if (v & 1) { ctx.moveTo(cx, cy); ctx.lineTo(x + s, cy); }
        if (v & 2) { ctx.moveTo(cx, cy); ctx.lineTo(cx, y); }
        if (v & 4) { ctx.moveTo(cx, cy); ctx.lineTo(x, cy); }
        if (v & 8) { ctx.moveTo(cx, cy); ctx.lineTo(cx, y + s); }
        ctx.stroke();
    }

    return { pixels: ctx.getImageData(0, 0, w, h).data, width: w, height: h };
}

/** tile id -> atlas cell. Road is left 0: it always resolves through its autotile rule. */
export function tileAtlasTable() {
    const table = new Array(TILE_ATLAS_TABLE_SIZE).fill(0);
    for (const id of Object.values(GROUND_IDS)) table[id] = id;
    table[OVERLAY_IDS.crop] = CROP_CELL;
    return table;
}

export function roadAutotile() {
    const cells = [];
    for (let v = 0; v < 16; v++) cells.push(ROAD_VARIANT_BASE + v);
    return { id: OVERLAY_IDS.road, layer: 1, mode: 'edge', cells };
}

/** A pixelated `size` px canvas showing atlas cell `cell`. */
export function atlasThumbnail(atlas, cell, size) {
    const [cx, cy, s] = cellRect(cell);
    const crop = new Uint8ClampedArray(s * s * 4);
    for (let row = 0; row < s; row++) {
        const off = ((cy + row) * atlas.width + cx) * 4;
        crop.set(atlas.pixels.subarray(off, off + s * 4), row * s * 4);
    }
    const small = document.createElement('canvas');
    small.width = s; small.height = s;
    small.getContext('2d').putImageData(new ImageData(crop, s, s), 0, 0);
    const out = document.createElement('canvas');
    out.width = size; out.height = size;
    out.className = 'thumb';
    out.style.width = size + 'px';
    out.style.height = size + 'px';
    const octx = out.getContext('2d');
    octx.imageSmoothingEnabled = false;
    octx.drawImage(small, 0, 0, size, size);
    return out;
}
