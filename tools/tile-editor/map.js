// map.js — the document: a scene.createTileWorld map, the edits a brush makes
// to it, props, the pathfinding query, undo strokes and the project format.
// No DOM beyond the atlas canvas.
//
// Undo works in strokes: beginStroke() .. endStroke() brackets a drag (or one
// rect / flood fill), every cell it touches is snapshotted once before its
// first change, and endStroke() records one History entry swapping the
// before / after snapshots. Prop placements are their own entries.

import "/lib/history.js";
import {
    GROUND_IDS, OVERLAY_IDS, BLOCKING_GROUND, ATLAS_COLS, ATLAS_ROWS, CLIFF_CELL, WATER_FRAMES,
    buildAtlas, tileAtlasTable, roadAutotile,
} from "./atlas.js";

export const BLOCK_BIT = 1;
export const LAYER = { ground: 0, overlay: 1 };
export const ELEVATION_RANGE = [-4, 8];

/** Prop kinds: mesh + colour. */
const PROP_KINDS = {
    tree:  { mesh: () => Mesh.cone(0.3, 0.9, 8, 1, true), color: [0.2, 0.5, 0.2, 1] },
    rock:  { mesh: () => Mesh.cylinder(0.3, 0.2, 7),      color: [0.55, 0.55, 0.58, 1] },
    crate: { mesh: () => Mesh.box(0.3, 0.3, 0.3),         color: [0.55, 0.35, 0.18, 1] },
};
export const PROP_NAMES = Object.keys(PROP_KINDS);

export const DEFAULT_CONFIG = {
    width: 48, height: 48, topology: 'square', cellSize: 1, heightStep: 0.5, chunkSize: 16,
};
export const PROJECT_SCHEMA = 2;   // 2 adds tints + props (1 had only the grid)

const WHITE = [1, 1, 1, 1];

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

// Offset (odd-r) -> axial hex coordinates, mirroring TileWorld's hex layout.
function hexDistance(x0, y0, x1, y1) {
    const q0 = x0 - (y0 - (y0 & 1)) / 2, q1 = x1 - (y1 - (y1 & 1)) / 2;
    const dq = q1 - q0, dr = y1 - y0;
    return (Math.abs(dq) + Math.abs(dq + dr) + Math.abs(dr)) / 2;
}

/**
 * The tile map on `scene`. opts: { config } (DEFAULT_CONFIG overrides).
 * Returns the map API (see the object literal at the bottom).
 */
export function createTileMap(scene, opts) {
    const o = opts || {};
    const atlas = buildAtlas();
    let cfg = Object.assign({}, DEFAULT_CONFIG, o.config);

    const worldOptions = () => ({
        width: cfg.width, height: cfg.height, topology: cfg.topology,
        layers: ['ground', 'overlay'],
        cellSize: cfg.cellSize, heightStep: cfg.heightStep, chunkSize: cfg.chunkSize,
        aoStrength: 0.45,
        atlasPixels: atlas.pixels, atlasWidth: atlas.width, atlasHeight: atlas.height,
        atlasColumns: ATLAS_COLS, atlasRows: ATLAS_ROWS,
        cliffCell: CLIFF_CELL,
        tileAtlas: tileAtlasTable(),
        autotiles: [roadAutotile()],
        overlays: [{}, { opacity: 0.9 }],
        animations: [{ id: GROUND_IDS.water, fps: 2, frames: WATER_FRAMES }],
    });
    const world = scene.createTileWorld(worldOptions());
    const history = new History({ limit: 200 });

    let dirty = false;
    const markDirty = () => { dirty = true; };
    function rebuildIfDirty() {
        if (!dirty) return false;
        world.rebuild();
        dirty = false;
        return true;
    }

    const inBounds = (x, y) => x >= 0 && y >= 0 && x < cfg.width && y < cfg.height;
    const rectCells = (x0, y0, x1, y1) => {
        const cells = [];
        for (let y = Math.max(0, Math.min(y0, y1)); y <= Math.min(cfg.height - 1, Math.max(y0, y1)); y++)
            for (let x = Math.max(0, Math.min(x0, x1)); x <= Math.min(cfg.width - 1, Math.max(x0, x1)); x++)
                cells.push([x, y]);
        return cells;
    };

    // ---- strokes -------------------------------------------------------------

    let stroke = null;      // { label, before: Map key -> snapshot }
    const key = (x, y) => x + ',' + y;
    function tintOf(x, y) {
        const t = world.getTint(x, y);
        return t ? [t.r, t.g, t.b, t.a] : WHITE.slice();
    }
    function snapshot(x, y) {
        return {
            x, y,
            ground: world.getTile(x, y, LAYER.ground),
            overlay: world.getTile(x, y, LAYER.overlay),
            elevation: world.getElevation(x, y),
            blocked: world.hasFlag(x, y, BLOCK_BIT),
            tint: tintOf(x, y),
        };
    }
    function restore(s) {
        world.setTile(s.x, s.y, s.ground, LAYER.ground);
        world.setTile(s.x, s.y, s.overlay, LAYER.overlay);
        world.setElevation(s.x, s.y, s.elevation);
        world.setFlag(s.x, s.y, BLOCK_BIT, s.blocked);
        world.setTint(s.x, s.y, s.tint[0], s.tint[1], s.tint[2], s.tint[3]);
    }
    function touch(x, y) {
        if (stroke && !stroke.before.has(key(x, y))) stroke.before.set(key(x, y), snapshot(x, y));
    }

    // ---- props -----------------------------------------------------------------
    // Placements are kept in JS: TileWorld has no removeObject and drops
    // placements on load(), so the list is what undo and save replay.

    let kinds = {};
    let props = [];         // { kind, x, y, yaw, scale }
    function registerKinds() {
        kinds = {};
        for (const name of PROP_NAMES) {
            const k = PROP_KINDS[name];
            kinds[name] = world.addObjectKind(k.mesh(), { color: k.color });
        }
    }
    function replaceProps(list) {
        props = list.slice();
        world.clearObjects(-1);
        for (const p of props) world.addObject(kinds[p.kind], p.x, p.y, { yaw: p.yaw, scale: p.scale });
        world.rebuildObjects();
    }
    registerKinds();

    // ---- path query --------------------------------------------------------------

    let markers = [];
    function clearPath() {
        for (const m of markers) m.destroy();
        markers = [];
    }
    function marker(x, z, size, color) {
        const y = world.sampleHeight(x, z);
        markers.push(scene.createMesh({ mesh: 'box', x, y: (y == null ? 0 : y) + 0.12, z, scale: size, color }));
    }

    // ---- (re)configure --------------------------------------------------------------

    function reconfigure(next) {
        cfg = Object.assign({}, cfg, next);
        // configure() is a full reset: it drops the registered prop kinds too.
        world.configure(worldOptions());
        registerKinds();
        replaceProps([]);
        clearPath();
        history.clear();
        stroke = null;
    }

    const map = {
        world, atlas, history,
        get config() { return Object.assign({}, cfg); },
        get props() { return props.slice(); },
        inBounds,
        rebuildIfDirty,

        // -- strokes
        /** Start collecting cell changes into one undo entry. */
        beginStroke(label) { stroke = { label, before: new Map() }; },
        /** Record the stroke (if it changed anything). Returns the entry's cell count. */
        endStroke() {
            const s = stroke;
            stroke = null;
            if (!s || s.before.size === 0) return 0;
            const before = Array.from(s.before.values());
            const after = before.map((b) => snapshot(b.x, b.y));
            history.record(s.label,
                () => { after.forEach(restore); markDirty(); },
                () => { before.forEach(restore); markDirty(); });
            return before.length;
        },
        /** Abandon the stroke, putting every touched cell back. */
        cancelStroke() {
            const s = stroke;
            stroke = null;
            if (!s) return;
            for (const b of s.before.values()) restore(b);
            markDirty();
        },
        get inStroke() { return !!stroke; },

        // -- cell edits (call inside a stroke to make them undoable)
        paintGround(x, y, id) {
            if (!inBounds(x, y)) return;
            touch(x, y);
            world.setTile(x, y, id, LAYER.ground);
            world.setFlag(x, y, BLOCK_BIT, BLOCKING_GROUND.has(id));
            markDirty();
        },
        paintOverlay(x, y, id) {
            if (!inBounds(x, y)) return;
            touch(x, y);
            world.setTile(x, y, id, LAYER.overlay);
            markDirty();
        },
        /** Raise (dir 1) or lower (dir -1) one step, clamped to ELEVATION_RANGE. */
        raise(x, y, dir) {
            if (!inBounds(x, y)) return;
            touch(x, y);
            const level = Math.max(ELEVATION_RANGE[0], Math.min(ELEVATION_RANGE[1], world.getElevation(x, y) + dir));
            world.setElevation(x, y, level);
            markDirty();
        },
        paintTint(x, y, rgba) {
            if (!inBounds(x, y)) return;
            touch(x, y);
            world.setTint(x, y, rgba[0], rgba[1], rgba[2], rgba[3]);
            markDirty();
        },
        /** Block / unblock pathfinding regardless of the ground. */
        paintFlag(x, y, on) {
            if (!inBounds(x, y)) return;
            touch(x, y);
            world.setFlag(x, y, BLOCK_BIT, on);
            markDirty();
        },
        /** Apply `fn(x, y)` to every cell of the rectangle. */
        fillRect(x0, y0, x1, y1, fn) {
            for (const [x, y] of rectCells(x0, y0, x1, y1)) fn(x, y);
        },
        /**
         * Cells connected to (x, y) with its tile id on `layer`
         * (TileWorld.floodFill; 4- or 6-connected by topology).
         */
        floodCells(x, y, layer) {
            return world.floodFill(x, y, { layer }).map((c) => [c.x, c.y]);
        },
        /** Tile id on `layer` at (x, y). */
        tileAt(x, y, layer) { return world.getTile(x, y, layer); },
        /**
         * Brush footprint: cells within `radius` of (cx, cy) (hex distance on
         * hex maps, Euclidean on square ones), clipped to the map.
         */
        cellsInRadius(cx, cy, radius) {
            const cells = [];
            for (let y = cy - radius; y <= cy + radius; y++) {
                for (let x = cx - radius; x <= cx + radius; x++) {
                    if (!inBounds(x, y)) continue;
                    const d = cfg.topology === 'hex' ? hexDistance(cx, cy, x, y) : Math.hypot(x - cx, y - cy);
                    if (d <= radius + 1e-6) cells.push([x, y]);
                }
            }
            return cells;
        },

        // -- props
        /** Place a prop (undoable); returns the placement or null. */
        placeProp(kind, x, y, rnd) {
            if (kinds[kind] == null || kinds[kind] < 0 || !inBounds(x, y)) return null;
            const r = rnd || Math.random;
            const p = { kind, x, y, yaw: r() * Math.PI * 2, scale: 0.85 + r() * 0.3 };
            const prev = props, next = props.concat([p]);
            replaceProps(next);
            history.record('Place ' + kind, () => replaceProps(next), () => replaceProps(prev));
            return p;
        },
        /** Remove every prop (undoable). */
        clearProps() {
            if (!props.length) return;
            const prev = props;
            replaceProps([]);
            history.record('Clear props', () => replaceProps([]), () => replaceProps(prev));
        },

        // -- path query
        /** Marker on the start cell of a pending query. */
        markStart(x, y) {
            clearPath();
            const c = world.cellCenterWorldXZ(x, y);
            if (c) marker(c.x, c.z, 0.3, '#66e0ff');
        },
        /** Nav-grid path between two cells, drawn as markers; the waypoints or null. */
        queryPath(x0, y0, x1, y1) {
            clearPath();
            const nav = world.toNavGrid({ blockMask: BLOCK_BIT, padding: 0.1 });
            const a = world.cellCenterWorldXZ(x0, y0), b = world.cellCenterWorldXZ(x1, y1);
            if (!nav || !a || !b) return null;
            const path = nav.findPath(a.x, a.z, b.x, b.z);
            if (!Array.isArray(path)) return null;
            for (const p of path) marker(p.x, p.z, 0.15, '#ffe066');
            return path;
        },
        clearPath,
        get markerCount() { return markers.length; },

        // -- documents
        /** A fresh map of flat grass (a blank grid has nothing to pick). */
        newMap(next) {
            reconfigure(next || {});
            world.fillTile(0, 0, cfg.width - 1, cfg.height - 1, GROUND_IDS.grass, LAYER.ground);
            world.fillElevation(0, 0, cfg.width - 1, cfg.height - 1, 0);
            world.rebuild();
            dirty = false;
        },
        /** Project data: config, the grid bytes, non-white tints, props. */
        serialize() {
            const tints = [];
            for (let y = 0; y < cfg.height; y++) {
                for (let x = 0; x < cfg.width; x++) {
                    const t = tintOf(x, y);
                    if (t[0] < 1 || t[1] < 1 || t[2] < 1 || t[3] < 1) tints.push([x, y].concat(t));
                }
            }
            return { config: map.config, gridBytes: bytesToBase64(world.save()), tints, props: props.slice() };
        },
        deserialize(data) {
            reconfigure(data.config || {});
            if (!world.load(base64ToBytes(data.gridBytes))) throw new Error('tile-editor: corrupt map data');
            for (const t of data.tints || []) world.setTint(t[0], t[1], t[2], t[3], t[4], t[5]);
            replaceProps(data.props || []);
            world.rebuild();
            dirty = false;
        },

        /** The starter map: mesa, lowland, river + bridge, meadow, plaza, road. */
        authorDemo() {
            map.newMap();
            const W = cfg.width;
            const fill = (x0, y0, x1, y1, id) => map.fillRect(x0, y0, x1, y1, (x, y) => map.paintGround(x, y, id));
            world.fillElevation(10, 8, 26, 22, 3);
            fill(10, 8, 26, 22, GROUND_IDS.stone);
            world.fillElevation(30, 4, 44, 16, -1);
            fill(30, 4, 44, 16, GROUND_IDS.sand);
            fill(0, 30, W - 1, 32, GROUND_IDS.water);
            fill(33, 29, 35, 33, GROUND_IDS.wood);
            fill(2, 2, 8, 8, GROUND_IDS.lush);
            fill(14, 26, 20, 32, GROUND_IDS.plaza);
            for (let x = 12; x <= 34; x++) map.paintOverlay(x, 24, OVERLAY_IDS.road);
            for (let y = 24; y <= 30; y++) map.paintOverlay(34, y, OVERLAY_IDS.road);
            world.rebuild();
            dirty = false;
        },
    };
    return map;
}
