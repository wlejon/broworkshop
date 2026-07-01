// editor.js — TileWorld setup, atlas generation, brush operations, object
// placement, pathfind query, and save/load for the tile-editor tool.
//
// Ground tile ids: 1 grass, 2 dirt, 3 stone, 4 sand, 5 water (animated).
// Overlay (layer 1) tile ids: 20 road (autotiled, edge mode), 21 crop.
// Flag bit 1 marks "blocks pathfinding" — set automatically on stone/water.

export const GROUND_IDS = { grass: 1, dirt: 2, stone: 3, sand: 4, water: 5 };
export const OVERLAY_IDS = { road: 20, crop: 21 };
export const BLOCK_BIT = 1;

const MAP_W = 48, MAP_H = 48;
const CELL_SIZE = 1.0, HEIGHT_STEP = 0.5, CHUNK_SIZE = 16;

const ATLAS_COLS = 8, ATLAS_ROWS = 6, CELL_PX = 32;
const CLIFF_CELL = 9;
const ROAD_VARIANT_BASE = 10;   // 16 cells, 10..25
const CROP_CELL = 40;
const WATER_FRAMES = [5, 6, 7, 8];

// ---------------------------------------------------------------------------
// Procedural tileset — no binary asset; matches stompworld's baked-canvas
// precedent. Road edge-variant cells encode the 4-bit neighbour mask (bit0=E,
// bit1=N, bit2=W, bit3=S) as tick marks toward the joined edges, so autotile
// borders are visually legible without real art.
// ---------------------------------------------------------------------------

function buildAtlas() {
    const w = ATLAS_COLS * CELL_PX, h = ATLAS_ROWS * CELL_PX;
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const ctx = c.getContext('2d');
    ctx.imageSmoothingEnabled = false;
    ctx.fillStyle = '#111'; ctx.fillRect(0, 0, w, h);

    function rect(i) {
        return [(i % ATLAS_COLS) * CELL_PX, Math.floor(i / ATLAS_COLS) * CELL_PX, CELL_PX, CELL_PX];
    }
    function fill(i, color) {
        const [x, y, cw, ch] = rect(i);
        ctx.fillStyle = color; ctx.fillRect(x, y, cw, ch);
    }

    fill(GROUND_IDS.grass, '#4a8f3c');
    fill(GROUND_IDS.dirt, '#6b4a2c');
    fill(GROUND_IDS.stone, '#8c8c94');
    fill(GROUND_IDS.sand, '#d8c27a');
    const waterShades = ['#2f6fb0', '#3a7dc0', '#4589cc', '#3a7dc0'];
    WATER_FRAMES.forEach((cell, i) => fill(cell, waterShades[i]));
    fill(CLIFF_CELL, '#3a3a3f');

    for (let v = 0; v < 16; v++) {
        const idx = ROAD_VARIANT_BASE + v;
        const [x, y, cw, ch] = rect(idx);
        ctx.fillStyle = '#5a5248';
        ctx.fillRect(x, y, cw, ch);
        ctx.strokeStyle = '#d8d0c0';
        ctx.lineWidth = 3;
        const cx = x + cw / 2, cy = y + ch / 2;
        ctx.beginPath();
        if (v & 1) { ctx.moveTo(cx, cy); ctx.lineTo(x + cw, cy); }   // E
        if (v & 2) { ctx.moveTo(cx, cy); ctx.lineTo(cx, y); }        // N
        if (v & 4) { ctx.moveTo(cx, cy); ctx.lineTo(x, cy); }        // W
        if (v & 8) { ctx.moveTo(cx, cy); ctx.lineTo(cx, y + ch); }   // S
        ctx.stroke();
    }

    fill(CROP_CELL, '#9bbf3a');
    {
        const [x, y] = rect(CROP_CELL);
        ctx.fillStyle = '#5f7a1f';
        for (let ry = 0; ry < 3; ry++)
            for (let rx = 0; rx < 3; rx++)
                ctx.fillRect(x + 4 + rx * 10, y + 4 + ry * 10, 4, 4);
    }

    const img = ctx.getImageData(0, 0, w, h);
    return { pixels: img.data, width: w, height: h };
}

function buildTileAtlasTable() {
    const table = new Array(CROP_CELL + 1).fill(0);
    for (const id of Object.values(GROUND_IDS)) table[id] = id;   // identity
    table[OVERLAY_IDS.crop] = CROP_CELL;
    // OVERLAY_IDS.road is left at 0 — it always resolves through the autotile
    // rule below, so its tileAtlas entry is never read.
    return table;
}

function buildRoadAutotileRule() {
    const cells = [];
    for (let v = 0; v < 16; v++) cells.push(ROAD_VARIANT_BASE + v);
    return { id: OVERLAY_IDS.road, layer: 1, mode: 'edge', cells };
}

// ---------------------------------------------------------------------------

export function createEditor(scene) {
    const atlas = buildAtlas();

    const world = scene.createTileWorld({
        width: MAP_W, height: MAP_H,
        layers: ['ground', 'overlay'],
        cellSize: CELL_SIZE, heightStep: HEIGHT_STEP, chunkSize: CHUNK_SIZE,
        aoStrength: 0.45,
        atlasPixels: atlas.pixels, atlasWidth: atlas.width, atlasHeight: atlas.height,
        atlasColumns: ATLAS_COLS, atlasRows: ATLAS_ROWS,
        cliffCell: CLIFF_CELL,
        tileAtlas: buildTileAtlasTable(),
        autotiles: [buildRoadAutotileRule()],
        overlays: [{}, { opacity: 0.9 }],
        animations: [{ id: GROUND_IDS.water, fps: 2, frames: WATER_FRAMES }],
    });

    let dirty = false;
    function markDirty() { dirty = true; }
    function rebuildIfDirty() {
        if (!dirty) return;
        world.rebuild();
        dirty = false;
    }

    // ---- ground brush -----------------------------------------------------

    function paintGround(x, y, id) {
        world.setTile(x, y, id, 0);
        const blocked = id === GROUND_IDS.stone || id === GROUND_IDS.water;
        world.setFlag(x, y, BLOCK_BIT, blocked);
        markDirty();
    }
    function fillGround(x0, y0, x1, y1, id) {
        world.fillTile(x0, y0, x1, y1, id, 0);
        const blocked = id === GROUND_IDS.stone || id === GROUND_IDS.water;
        for (let y = Math.min(y0, y1); y <= Math.max(y0, y1); y++)
            for (let x = Math.min(x0, x1); x <= Math.max(x0, x1); x++)
                world.setFlag(x, y, BLOCK_BIT, blocked);
        markDirty();
    }

    // ---- elevation brush ----------------------------------------------

    function raiseElevation(x, y, dir) {
        const level = Math.max(-4, Math.min(8, world.getElevation(x, y) + dir));
        world.setElevation(x, y, level);
        markDirty();
    }

    // ---- overlay brush ------------------------------------------------

    function paintOverlay(x, y, id) {
        world.setTile(x, y, id, 1);
        markDirty();
    }

    // ---- tint brush -----------------------------------------------------

    function paintTint(x, y, r, g, b, a) {
        world.setTint(x, y, r, g, b, a);
        markDirty();
    }

    // ---- objects --------------------------------------------------------

    const objectKinds = {};
    function registerObjectKinds() {
        objectKinds.tree = world.addObjectKind(
            Mesh.cone(0.3, 0.9, 8, 1, true), { color: [0.2, 0.5, 0.2, 1] });
        objectKinds.rock = world.addObjectKind(
            Mesh.cylinder(0.3, 0.2, 7), { color: [0.55, 0.55, 0.58, 1] });
        objectKinds.crate = world.addObjectKind(
            Mesh.box(0.3, 0.3, 0.3), { color: [0.55, 0.35, 0.18, 1] });
    }
    registerObjectKinds();

    function placeObject(kindName, x, y) {
        const kind = objectKinds[kindName];
        if (kind === undefined || kind < 0) return;
        world.addObject(kind, x, y, {
            yaw: Math.random() * Math.PI * 2,
            scale: 0.85 + Math.random() * 0.3,
        });
        world.rebuildObjects();
    }
    function clearAllObjects() {
        world.clearObjects(-1);
        world.rebuildObjects();
    }

    // ---- pathfind query ---------------------------------------------------

    let pathMarkers = [];
    function clearPathMarkers() {
        for (const m of pathMarkers) m.destroy();
        pathMarkers = [];
    }
    function queryPath(x0, y0, x1, y1) {
        clearPathMarkers();
        const nav = world.toNavGrid({ blockMask: BLOCK_BIT, padding: 0.1 });
        if (!nav) return null;
        const cs = CELL_SIZE;
        const wx0 = (x0 + 0.5) * cs, wz0 = (y0 + 0.5) * cs;
        const wx1 = (x1 + 0.5) * cs, wz1 = (y1 + 0.5) * cs;
        const path = nav.findPath(wx0, wz0, wx1, wz1);
        if (!Array.isArray(path)) return null;
        for (const p of path) {
            let gx = Math.floor(p.x / cs), gy = Math.floor(p.z / cs);
            gx = Math.max(0, Math.min(MAP_W - 1, gx));
            gy = Math.max(0, Math.min(MAP_H - 1, gy));
            let py = world.sampleHeight(p.x, p.z);
            if (py === null) py = 0;
            pathMarkers.push(scene.createMesh({
                mesh: 'box', x: p.x, y: py + 0.12, z: p.z,
                scale: 0.15, color: '#ffe066',
            }));
        }
        return path;
    }

    // ---- save / load --------------------------------------------------

    function bytesToBase64(bytes) {
        let bin = '';
        for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
        return btoa(bin);
    }
    function base64ToBytes(b64) {
        const bin = atob(b64);
        const out = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
        return out;
    }
    const SAVE_KEY = 'tile-editor:map';
    function saveMap() {
        localStorage.setItem(SAVE_KEY, bytesToBase64(world.save()));
        return true;
    }
    function loadMap() {
        const b64 = localStorage.getItem(SAVE_KEY);
        if (!b64) return false;
        const ok = world.load(base64ToBytes(b64));
        if (ok) markDirty();
        return ok;
    }

    // ---- initial authored map ------------------------------------------

    function authorInitialMap() {
        fillGround(0, 0, MAP_W - 1, MAP_H - 1, GROUND_IDS.grass);
        world.fillElevation(0, 0, MAP_W - 1, MAP_H - 1, 0);

        // A stone-topped mesa.
        world.fillElevation(10, 8, 26, 22, 3);
        fillGround(10, 8, 26, 22, GROUND_IDS.stone);

        // A sandy lowland.
        world.fillElevation(30, 4, 44, 16, -1);
        fillGround(30, 4, 44, 16, GROUND_IDS.sand);

        // A river band across the map.
        fillGround(0, 30, MAP_W - 1, 32, GROUND_IDS.water);

        // A road connecting the mesa to the river crossing.
        for (let x = 12; x <= 34; x++) paintOverlay(x, 24, OVERLAY_IDS.road);
        for (let y = 24; y <= 30; y++) paintOverlay(34, y, OVERLAY_IDS.road);

        world.rebuild();
        dirty = false;
    }
    authorInitialMap();

    return {
        world,
        paintGround, fillGround, raiseElevation, paintOverlay, paintTint,
        placeObject, clearAllObjects,
        queryPath, clearPathMarkers,
        saveMap, loadMap,
        rebuildIfDirty,
        mapWidth: MAP_W, mapHeight: MAP_H, cellSize: CELL_SIZE,
    };
}
