// map.js — GridKeep's hand-authored map, procedural tileset atlas and
// instanced object meshes. buildWorld(scene) returns an authored TileWorld
// plus its object kinds; the rules in sim.js only read and flag it.

import { seededRandom } from "/lib/arcade/grid.js";

export const TILE = { GRASS: 1, DIRT: 2, ROCK: 3, WATER: 4, BASE: 5, SPAWN: 6, EGRASS: 7 };

export const FLAG_BLOCK = 1;   // impassable to creeps (water, rocks, hills, towers)
export const FLAG_NOBUILD = 2; // no towers here (water, rocks, spawn, base)
export const FLAG_TOWER = 4;   // a tower stands here

export const MAP_W = 20, MAP_H = 14;
export const CELL = 1.0;         // cellSize
export const HSTEP = 0.4;        // heightStep

// w water (animated border), g grass (buildable), r rock (blocked),
// e elevated grass (blocked to creeps, buildable, +1 range), s spawn, b base.
const MAP_ROWS = [
    "wwwwwwwwwwwwwwwwwwww",
    "wgggggggggrgggeegggw",
    "wggggrgggggggggeeggw",
    "wggggggggggggggggggw",
    "wgggggggrrgggggggggw",
    "wsgggggggggggggrgggw",
    "wsggggggggggggggggbw",
    "wsggggggggggggggggew",
    "wgggggrrgggggggrgggw",
    "wggggggggggggggggggw",
    "wggggrggggggggggggew",
    "wggeegggggggrgggggew",
    "wggeeggggggggggggggw",
    "wwwwwwwwwwwwwwwwwwww",
];
const CHAR_TILE = {
    w: TILE.WATER, g: TILE.GRASS, r: TILE.ROCK,
    e: TILE.EGRASS, s: TILE.SPAWN, b: TILE.BASE,
};

export const SPAWNS = [{ x: 1, y: 5 }, { x: 1, y: 6 }, { x: 1, y: 7 }];
export const BASE = { x: 18, y: 6 };

// ── Atlas ────────────────────────────────────────────────────────────────
// Animated tiles need an atlas, so the palette is a tiny procedural RGBA
// atlas: 16x16 flat-noise cells, four of them water animation frames.
// atlasInset fights bilinear bleeding between cells.

const APX = 16, ACOLS = 8, AROWS = 2;
const A = { GRASS: 1, DIRT: 2, ROCK: 3, WATER0: 4, BASE: 8, SPAWN: 9, CLIFF: 10, EGRASS: 11 };

// tile id -> atlas cell (water points at frame 0; the animation cycles it)
const TILE_ATLAS = [0, A.GRASS, A.DIRT, A.ROCK, A.WATER0, A.BASE, A.SPAWN, A.EGRASS];

function makeAtlas() {
    const w = ACOLS * APX, h = AROWS * APX;
    const buf = new Uint8Array(w * h * 4);
    const rng = seededRandom(0x9E3779B9);
    const noise = (amt) => (rng() - 0.5) * 2 * amt;
    const rim = (px, py, band) => px < band || py < band || px >= APX - band || py >= APX - band;
    function paint(cell, fn) {
        const cx = (cell % ACOLS) * APX, cy = Math.floor(cell / ACOLS) * APX;
        for (let py = 0; py < APX; py++) {
            for (let px = 0; px < APX; px++) {
                const [r, g, b] = fn(px, py);
                const i = ((cy + py) * w + cx + px) * 4;
                buf[i] = Math.max(0, Math.min(255, r | 0));
                buf[i + 1] = Math.max(0, Math.min(255, g | 0));
                buf[i + 2] = Math.max(0, Math.min(255, b | 0));
                buf[i + 3] = 255;
            }
        }
    }
    paint(A.GRASS, () => {
        const n = noise(10), tuft = rng() < 0.06 ? -18 : 0;
        return [88 + n + tuft, 150 + n * 1.3 + tuft, 62 + n + tuft];
    });
    paint(A.DIRT, () => {
        const n = noise(9);
        return [124 + n, 98 + n, 60 + n * 0.7];
    });
    paint(A.ROCK, () => {
        const n = noise(8), crack = rng() < 0.05 ? -25 : 0;
        return [108 + n + crack, 110 + n + crack, 116 + n + crack];
    });
    // Water frames: a shimmer band that drifts per frame.
    for (let f = 0; f < 4; f++) {
        paint(A.WATER0 + f, (px, py) => {
            const wave = Math.sin((px + f * 4) * 0.5 + py * 0.9);
            const n = noise(6);
            return wave > 0.82
                ? [110 + n, 178 + n, 224 + n]
                : [36 + n + wave * 5, 92 + n + wave * 7, 152 + n + wave * 8];
        });
    }
    paint(A.BASE, (px, py) => {   // gold pad
        const edge = rim(px, py, 2) ? -55 : 0, n = noise(8);
        return [198 + n + edge, 158 + n + edge, 62 + n * 0.6 + edge];
    });
    paint(A.SPAWN, (px, py) => {  // violet pad
        const edge = rim(px, py, 2) ? -40 : 0, n = noise(8);
        return [128 + n + edge, 66 + n + edge, 152 + n + edge];
    });
    paint(A.CLIFF, (px, py) => {  // strata
        const strata = py % 5 === 0 ? -22 : 0, n = noise(7);
        return [96 + n + strata, 78 + n + strata, 54 + n * 0.8 + strata];
    });
    paint(A.EGRASS, () => {       // brighter, drier hilltop grass
        const n = noise(9);
        return [110 + n, 164 + n, 84 + n];
    });
    return { pixels: buf, width: w, height: h };
}

// ── World ────────────────────────────────────────────────────────────────

/** A new TileWorld on `scene` with the map authored: { world, kinds }. */
export function buildWorld(scene) {
    const atlas = makeAtlas();
    const world = scene.createTileWorld({
        width: MAP_W, height: MAP_H,
        cellSize: CELL, heightStep: HSTEP, chunkSize: 10,
        baseLevel: -2, aoStrength: 0.5,
        atlasPixels: atlas.pixels, atlasWidth: atlas.width, atlasHeight: atlas.height,
        atlasColumns: ACOLS, atlasRows: AROWS,
        tileAtlas: TILE_ATLAS,
        cliffCell: A.CLIFF,
        atlasInset: 0.5,
        animations: [{ id: TILE.WATER, fps: 3, frames: [A.WATER0, A.WATER0 + 1, A.WATER0 + 2, A.WATER0 + 3] }],
    });

    // Worn dirt patches through the grass are visual only: dirt is walkable
    // and buildable like grass.
    const dirt = seededRandom(0x5EED);
    for (let y = 0; y < MAP_H; y++) {
        const row = MAP_ROWS[y];
        if (row.length !== MAP_W) throw new Error("MAP_ROWS[" + y + "] length " + row.length);
        for (let x = 0; x < MAP_W; x++) {
            let id = CHAR_TILE[row[x]];
            if (id === TILE.GRASS && dirt() < 0.10) id = TILE.DIRT;
            world.setTile(x, y, id, 0);
            world.setElevation(x, y, id === TILE.WATER ? -1 : id === TILE.EGRASS ? 1 : 0);
            if (id === TILE.WATER || id === TILE.ROCK || id === TILE.EGRASS) world.setFlag(x, y, FLAG_BLOCK, true);
            if (id === TILE.WATER || id === TILE.ROCK || id === TILE.SPAWN || id === TILE.BASE)
                world.setFlag(x, y, FLAG_NOBUILD, true);
        }
    }

    const kinds = registerKinds(world);
    placeDecor(world, kinds);
    world.rebuild();
    world.rebuildObjects();
    return { world, kinds };
}

// Rocks on rock cells, the keep on the base, portals on the spawns.
function placeDecor(world, kinds) {
    const rng = seededRandom(0xBADC0DE);
    for (let y = 0; y < MAP_H; y++) {
        for (let x = 0; x < MAP_W; x++) {
            if (world.getTile(x, y, 0) !== TILE.ROCK) continue;
            const n = 1 + Math.floor(rng() * 2);
            for (let i = 0; i < n; i++) {
                world.addObject(kinds.rock, x, y, {
                    yaw: rng() * 6.28, scale: 0.75 + rng() * 0.5,
                    offsetX: (rng() - 0.5) * 0.4, offsetZ: (rng() - 0.5) * 0.4,
                });
            }
        }
    }
    world.addObject(kinds.keep, BASE.x, BASE.y, { yaw: -Math.PI / 2, scale: 1.35 });
    for (const s of SPAWNS) world.addObject(kinds.portal, s.x, s.y, { yaw: 0, scale: 1.2 });
}

// ── Object kinds ─────────────────────────────────────────────────────────
// Towers and creeps are white-ish; per-instance colour carries type + level.
// Creeps are authored facing +Z (yaw = travel direction).

function registerKinds(world) {
    const M = Mesh;
    const add = (mesh, look) => world.addObjectKind(mesh, look);
    const white = (extra) => Object.assign({ color: [1, 1, 1, 1] }, extra);
    const kinds = {
        rock: add(M.rock(0.30, 11, 2).translate(0, 0.16, 0),
            { color: [0.52, 0.53, 0.58, 1], roughness: 1.0 }),
        keep: add(M.merge([
            M.box(0.30, 0.06, 0.30).translate(0, 0.06, 0),                                  // plinth
            M.box(0.22, 0.24, 0.22).translate(0, 0.34, 0),                                  // keep
            M.cone(0.30, 0.34, 4, 1, true).rotate(0, 1, 0, Math.PI / 4).translate(0, 0.58, 0), // roof
            M.cylinder(0.015, 0.14, 5).translate(0, 1.02, 0),                               // flag pole
            M.box(0.075, 0.045, 0.004).translate(0.09, 1.10, 0),                            // flag
        ]), { color: [0.92, 0.78, 0.42, 1], roughness: 0.6 }),
        portal: add(M.merge([
            M.torus(0.30, 0.055, 20, 10).rotate(0, 0, 1, Math.PI / 2).translate(0, 0.36, 0), // ring
            M.box(0.06, 0.05, 0.34).translate(0, 0.05, 0),                                  // sill
        ]), { color: [0.70, 0.36, 0.85, 1], roughness: 0.5, metallic: 0.2 }),

        arrow: add(M.merge([
            M.cylinder(0.24, 0.09, 10).translate(0, 0.09, 0),
            M.cylinder(0.15, 0.24, 8).translate(0, 0.42, 0),
            M.cone(0.21, 0.30, 8, 1, true).translate(0, 0.66, 0),
        ]), white({ roughness: 0.8 })),
        cannon: add(M.merge([
            M.cylinder(0.26, 0.10, 10).translate(0, 0.10, 0),
            M.sphere(0.18, 12, 8).translate(0, 0.32, 0),
            M.cylinder(0.065, 0.17, 8).rotate(1, 0, 0, Math.PI / 2).translate(0, 0.36, 0.22), // barrel +Z
        ]), white({ roughness: 0.5, metallic: 0.4 })),
        frost: add(M.merge([
            M.cylinder(0.22, 0.08, 8).translate(0, 0.08, 0),
            M.cone(0.15, 0.36, 6, 1, false).translate(0, 0.28, 0),                          // crystal up
            M.cone(0.15, 0.16, 6, 1, false).rotate(1, 0, 0, Math.PI).translate(0, 0.28, 0), // crystal down
        ]), white({ roughness: 0.3, metallic: 0.1 })),

        normal: add(M.merge([
            M.capsule(0.14, 0.08, 10, 6).rotate(1, 0, 0, Math.PI / 2).translate(0, 0.16, 0), // slug body
            M.sphere(0.10, 8, 6).translate(0, 0.24, 0.14),                                  // head
        ]), white({ roughness: 0.85 })),
        fast: add(M.merge([
            M.cone(0.11, 0.34, 8, 1, true).rotate(1, 0, 0, Math.PI / 2).translate(0, 0.14, 0.03), // dart
            M.sphere(0.07, 8, 6).translate(0, 0.16, -0.10),
        ]), white({ roughness: 0.7 })),
        tank: add(M.merge([
            M.box(0.17, 0.11, 0.20).translate(0, 0.13, 0),
            M.sphere(0.13, 10, 8).translate(0, 0.27, 0),
        ]), white({ roughness: 0.9 })),

        projArrow: add(M.merge([
            M.cylinder(0.028, 0.10, 6).rotate(1, 0, 0, Math.PI / 2),
            M.cone(0.05, 0.09, 6, 1, true).rotate(1, 0, 0, Math.PI / 2).translate(0, 0, 0.10),
        ]), { color: [1, 0.9, 0.55, 1], roughness: 0.4 }),
        projCannon: add(M.sphere(0.09, 8, 6),
            { color: [0.22, 0.22, 0.24, 1], roughness: 0.6, metallic: 0.3 }),
        projFrost: add(M.cone(0.05, 0.18, 5, 1, true).rotate(1, 0, 0, Math.PI / 2),
            { color: [0.65, 0.88, 1, 1], roughness: 0.2 }),
    };
    kinds.boss = kinds.tank;   // the boss reuses the tank silhouette, scaled up
    return kinds;
}
