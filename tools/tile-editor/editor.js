// editor.js — TileWorld setup, atlas generation, brush operations, object
// placement, pathfind query, and save/load for the tile-editor tool.
//
// Ground tile ids: 1 grass, 2 dirt, 3 stone, 4 sand, 5 water (animated),
// 9 wood, 10 plaza (tan tile), 11 lush grass.
// Overlay (layer 1) tile ids: 20 road (autotiled, edge mode), 21 crop.
// Flag bit 1 marks "blocks pathfinding" — set automatically on stone/water.
// Ground tile ids double as their own atlas cell index (identity-mapped via
// buildTileAtlasTable below); everything else (cliff, crop, road variants)
// lives at higher, non-colliding cell indices.

import "/lib/history.js";

export const GROUND_IDS = {
    grass: 1, dirt: 2, stone: 3, sand: 4, water: 5,
    wood: 9, plaza: 10, lush: 11,
};
export const OVERLAY_IDS = { road: 20, crop: 21 };
export const BLOCK_BIT = 1;

const MAP_W = 48, MAP_H = 48;
const CELL_SIZE = 1.0, HEIGHT_STEP = 0.5, CHUNK_SIZE = 16;

// Atlas cells are laid out at the source textures' native 64px resolution —
// no rescale needed. 8x4 = 32 cells is comfortably more than the ~30 used.
const ATLAS_COLS = 8, ATLAS_ROWS = 4, CELL_PX = 64;
const CLIFF_CELL = 12;
const CROP_CELL = 13;
const ROAD_VARIANT_BASE = 14;   // 16 cells, 14..29
const WATER_FRAMES = [5, 6, 7, 8];
const TILE_ATLAS_TABLE_SIZE = 32;

// ---------------------------------------------------------------------------
// Real CC0 art (Kenney "Retro Textures Fantasy", tools/tile-editor/assets/tiles/
// — see LICENSE.txt there) composited at runtime into a single atlas canvas.
// Road autotile-variant cells encode the 4-bit neighbour mask (bit0=E, bit1=N,
// bit2=W, bit3=S) as tick marks toward the joined edges over the plaza base,
// so autotile borders stay visually legible; the crop overlay is dirt with a
// scattered leaf pattern over it.
// ---------------------------------------------------------------------------

// The engine's `Image` element decodes a file synchronously via broimage on
// `.src =`. Anchor relative paths against the real app directory (fs) rather
// than a bare 'assets/x.png' — `new Image().src` resolves against a
// process-global base that other contexts (e.g. system panels) can clobber.
let appBase = '';
try { appBase = require('fs').realpathSync('.'); } catch (e) { appBase = ''; }
function appPath(p) {
    if (/^[a-zA-Z]:[\\/]/.test(p) || p.charAt(0) === '/' || p.charAt(0) === '\\' || !appBase) return p;
    return appBase + '/' + p;
}
function loadTileImage(name) {
    const img = new Image();
    img.src = appPath('assets/tiles/' + name + '.png');
    return img;
}

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
    function draw(i, img) {
        const [x, y] = rect(i);
        ctx.drawImage(img, x, y, CELL_PX, CELL_PX);
    }

    const tex = {
        grass: loadTileImage('floor_ground_grass'),
        grassLush: loadTileImage('floor_ground_grass_overlay'),
        dirt: loadTileImage('floor_ground_dirt'),
        sand: loadTileImage('floor_ground_sand'),
        water: loadTileImage('floor_ground_water'),
        waterGreen: loadTileImage('floor_ground_water_green'),
        stone: loadTileImage('floor_stone'),
        wood: loadTileImage('floor_wood_planks'),
        plaza: loadTileImage('floor_tiles_tan_small'),
    };

    draw(GROUND_IDS.grass, tex.grass);
    draw(GROUND_IDS.dirt, tex.dirt);
    draw(GROUND_IDS.stone, tex.stone);
    draw(GROUND_IDS.sand, tex.sand);
    draw(GROUND_IDS.wood, tex.wood);
    draw(GROUND_IDS.plaza, tex.plaza);
    draw(GROUND_IDS.lush, tex.grassLush);

    // Water animation: 4 frames from the 2 source textures, alternating a
    // subtle lighten pass for a shimmer effect.
    const waterSrc = [tex.water, tex.water, tex.waterGreen, tex.waterGreen];
    const waterLighten = [0, 0.12, 0, 0.12];
    WATER_FRAMES.forEach((cell, i) => {
        draw(cell, waterSrc[i]);
        if (waterLighten[i] > 0) {
            const [x, y] = rect(cell);
            ctx.fillStyle = `rgba(255,255,255,${waterLighten[i]})`;
            ctx.fillRect(x, y, CELL_PX, CELL_PX);
        }
    });

    // Cliff face: stone, darkened for contrast against the ground above it.
    draw(CLIFF_CELL, tex.stone);
    {
        const [x, y] = rect(CLIFF_CELL);
        ctx.fillStyle = 'rgba(0,0,0,0.35)';
        ctx.fillRect(x, y, CELL_PX, CELL_PX);
    }

    // Crop overlay: dirt base with a scattered leaf pattern.
    draw(CROP_CELL, tex.dirt);
    {
        const [x, y] = rect(CROP_CELL);
        ctx.fillStyle = '#5f9a2f';
        for (let ry = 0; ry < 3; ry++)
            for (let rx = 0; rx < 3; rx++)
                ctx.fillRect(x + 8 + rx * 20, y + 8 + ry * 20, 8, 8);
    }

    // Road autotile variants: plaza base + tick marks toward joined edges.
    for (let v = 0; v < 16; v++) {
        const idx = ROAD_VARIANT_BASE + v;
        const [x, y, cw, ch] = rect(idx);
        ctx.drawImage(tex.plaza, x, y, cw, ch);
        ctx.strokeStyle = 'rgba(216,208,192,0.85)';
        ctx.lineWidth = 6;
        const cx = x + cw / 2, cy = y + ch / 2;
        ctx.beginPath();
        if (v & 1) { ctx.moveTo(cx, cy); ctx.lineTo(x + cw, cy); }   // E
        if (v & 2) { ctx.moveTo(cx, cy); ctx.lineTo(cx, y); }        // N
        if (v & 4) { ctx.moveTo(cx, cy); ctx.lineTo(x, cy); }        // W
        if (v & 8) { ctx.moveTo(cx, cy); ctx.lineTo(cx, y + ch); }   // S
        ctx.stroke();
    }

    const img = ctx.getImageData(0, 0, w, h);
    return { pixels: img.data, width: w, height: h };
}

function buildTileAtlasTable() {
    const table = new Array(TILE_ATLAS_TABLE_SIZE).fill(0);
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

// Atlas-cell pixel rect for a given cell index — used to crop swatch
// thumbnails out of the built atlas (see app.js).
export function atlasCellPxRect(cell) {
    return [(cell % ATLAS_COLS) * CELL_PX, Math.floor(cell / ATLAS_COLS) * CELL_PX, CELL_PX];
}
// A representative single cell to thumbnail each overlay id with (road has
// 16 autotile variants; show the all-sides-connected "crossroads" one).
export const OVERLAY_THUMB_CELL = { road: ROAD_VARIANT_BASE + 15, crop: CROP_CELL };

// ---------------------------------------------------------------------------

const DEFAULT_MAP_CONFIG = {
    width: MAP_W, height: MAP_H, topology: 'square',
    cellSize: CELL_SIZE, heightStep: HEIGHT_STEP, chunkSize: CHUNK_SIZE,
};

export function createEditor(scene, initialConfig) {
    const atlas = buildAtlas();
    let cfg = Object.assign({}, DEFAULT_MAP_CONFIG, initialConfig);

    // Full scene.createTileWorld() options for the current `cfg` — shared by
    // the initial construction and every later newMap() reconfigure so the
    // two can never drift apart.
    function tileWorldOptions() {
        return {
            width: cfg.width, height: cfg.height, topology: cfg.topology,
            layers: ['ground', 'overlay'],
            cellSize: cfg.cellSize, heightStep: cfg.heightStep, chunkSize: cfg.chunkSize,
            aoStrength: 0.45,
            atlasPixels: atlas.pixels, atlasWidth: atlas.width, atlasHeight: atlas.height,
            atlasColumns: ATLAS_COLS, atlasRows: ATLAS_ROWS,
            cliffCell: CLIFF_CELL,
            tileAtlas: buildTileAtlasTable(),
            autotiles: [buildRoadAutotileRule()],
            overlays: [{}, { opacity: 0.9 }],
            animations: [{ id: GROUND_IDS.water, fps: 2, frames: WATER_FRAMES }],
        };
    }

    const world = scene.createTileWorld(tileWorldOptions());

    let dirty = false;
    function markDirty() { dirty = true; }
    function rebuildIfDirty() {
        if (!dirty) return;
        world.rebuild();
        dirty = false;
    }

    // ---- undo/redo (per-stroke cell snapshots) -----------------------------
    //
    // TileWorld has getTile/getElevation/hasFlag but no getTint, so tint is
    // additionally shadowed here — paintTint is this app's only writer, so
    // the shadow stays authoritative. A "stroke" is a mousedown..mouseup drag
    // (or a single rect/flood-fill op); beginStroke/endStroke bracket it and
    // collapse every cell it touched into one history entry.
    const history = new History({ limit: 200 });
    const tintShadow = new Map();
    function cellKey(x, y) { return x + ',' + y; }
    function shadowTint(x, y) { return tintShadow.get(cellKey(x, y)) || [1, 1, 1, 1]; }

    let strokeTouched = null;
    let strokeLabel = '';

    function beginStroke(label) {
        strokeTouched = new Map();
        strokeLabel = label;
    }
    function captureCell(x, y) {
        if (!strokeTouched) return;
        const key = cellKey(x, y);
        if (strokeTouched.has(key)) return;   // keep first-seen (pre-stroke) state
        strokeTouched.set(key, cellSnapshot(x, y));
    }
    function cellSnapshot(x, y) {
        return {
            x, y,
            ground: world.getTile(x, y, 0),
            overlay: world.getTile(x, y, 1),
            elevation: world.getElevation(x, y),
            blocked: world.hasFlag(x, y, BLOCK_BIT),
            tint: shadowTint(x, y).slice(),
        };
    }
    function applyCellSnapshot(snap) {
        world.setTile(snap.x, snap.y, snap.ground, 0);
        world.setTile(snap.x, snap.y, snap.overlay, 1);
        world.setElevation(snap.x, snap.y, snap.elevation);
        world.setFlag(snap.x, snap.y, BLOCK_BIT, snap.blocked);
        world.setTint(snap.x, snap.y, snap.tint[0], snap.tint[1], snap.tint[2], snap.tint[3]);
        tintShadow.set(cellKey(snap.x, snap.y), snap.tint.slice());
    }
    function endStroke() {
        const before = strokeTouched;
        strokeTouched = null;
        if (!before || before.size === 0) return;
        const after = new Map();
        for (const snap of before.values()) after.set(cellKey(snap.x, snap.y), cellSnapshot(snap.x, snap.y));
        history.record(strokeLabel,
            () => { for (const s of after.values()) applyCellSnapshot(s); markDirty(); },
            () => { for (const s of before.values()) applyCellSnapshot(s); markDirty(); });
    }

    // ---- ground brush -----------------------------------------------------

    function paintGround(x, y, id) {
        captureCell(x, y);
        world.setTile(x, y, id, 0);
        const blocked = id === GROUND_IDS.stone || id === GROUND_IDS.water;
        world.setFlag(x, y, BLOCK_BIT, blocked);
        markDirty();
    }
    function fillGround(x0, y0, x1, y1, id) {
        for (let y = Math.min(y0, y1); y <= Math.max(y0, y1); y++)
            for (let x = Math.min(x0, x1); x <= Math.max(x0, x1); x++)
                captureCell(x, y);
        world.fillTile(x0, y0, x1, y1, id, 0);
        const blocked = id === GROUND_IDS.stone || id === GROUND_IDS.water;
        for (let y = Math.min(y0, y1); y <= Math.max(y0, y1); y++)
            for (let x = Math.min(x0, x1); x <= Math.max(x0, x1); x++)
                world.setFlag(x, y, BLOCK_BIT, blocked);
        markDirty();
    }

    // ---- elevation brush ----------------------------------------------

    function raiseElevation(x, y, dir) {
        captureCell(x, y);
        const level = Math.max(-4, Math.min(8, world.getElevation(x, y) + dir));
        world.setElevation(x, y, level);
        markDirty();
    }

    // ---- overlay brush ------------------------------------------------

    function paintOverlay(x, y, id) {
        captureCell(x, y);
        world.setTile(x, y, id, 1);
        markDirty();
    }

    // ---- tint brush -----------------------------------------------------

    function paintTint(x, y, r, g, b, a) {
        captureCell(x, y);
        world.setTint(x, y, r, g, b, a);
        tintShadow.set(cellKey(x, y), [r, g, b, a]);
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

    // ---- new map / topology switch / project save-load -----------------

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

    // Rebuild the grid from scratch with a new width/height/topology/cellSize
    // (world.configure() fully rebuilds the underlying grid, so no need to
    // destroy/recreate the TileWorld object itself). Shared by newMap() and
    // deserializeMap() — the two differ only in what fills the fresh grid.
    function reconfigure(newConfig) {
        cfg = Object.assign({}, cfg, newConfig);
        world.configure(tileWorldOptions());
        world.clearObjects(-1);
        world.rebuildObjects();
        clearPathMarkers();
        history.clear();
        tintShadow.clear();
    }

    // Starts filled with flat grass, not empty — picking (raycastCell) only
    // hits solid cells, so a truly blank grid would give the user nothing to
    // click on to start painting.
    function newMap(newConfig) {
        reconfigure(newConfig);
        fillGround(0, 0, cfg.width - 1, cfg.height - 1, GROUND_IDS.grass);
        world.fillElevation(0, 0, cfg.width - 1, cfg.height - 1, 0);
        world.rebuild();
        dirty = false;
    }

    // For lib/project.js's { serialize, deserialize }: the grid's tile/
    // elevation/flag/tint contents round-trip through world.save()/load();
    // everything else about the map (dimensions, topology, cell size) is
    // config that must be reconfigure()'d before loading the bytes back in.
    function serializeMap() {
        return { config: getConfigSnapshot(), gridBytes: bytesToBase64(world.save()) };
    }
    function deserializeMap(data) {
        reconfigure(data.config);
        world.load(base64ToBytes(data.gridBytes));
        world.rebuild();
        dirty = false;
    }
    function getConfigSnapshot() { return Object.assign({}, cfg); }

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
        // A wood bridge crossing it.
        fillGround(33, 29, 35, 33, GROUND_IDS.wood);

        // A lush meadow patch and a paved plaza, for texture variety.
        fillGround(2, 2, 8, 8, GROUND_IDS.lush);
        fillGround(14, 26, 20, 32, GROUND_IDS.plaza);

        // A road connecting the mesa to the river crossing.
        for (let x = 12; x <= 34; x++) paintOverlay(x, 24, OVERLAY_IDS.road);
        for (let y = 24; y <= 30; y++) paintOverlay(34, y, OVERLAY_IDS.road);

        world.rebuild();
        dirty = false;
    }
    authorInitialMap();

    return {
        world, atlas, history,
        paintGround, fillGround, raiseElevation, paintOverlay, paintTint,
        placeObject, clearAllObjects,
        queryPath, clearPathMarkers,
        rebuildIfDirty,
        newMap,
        serializeMap, deserializeMap,
        beginStroke, endStroke,
        getConfig: getConfigSnapshot,
        get mapWidth() { return cfg.width; },
        get mapHeight() { return cfg.height; },
        get cellSize() { return cfg.cellSize; },
        get topology() { return cfg.topology; },
    };
}
