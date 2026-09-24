// HexFront board — the 3D side: the hex TileWorld (terrain mesh, trees and
// rocks), unit instances tinted by side, HP bar billboards, move / attack
// highlights and floating damage numbers. Reads the battle, never changes it.

import { MAP_W, MAP_H, TILE, UNIT_TYPES, authorMap } from "/app/rules.js";
import { seededRandom } from "/lib/arcade/grid.js";

const PALETTE = new Float32Array([
    0, 0, 0, 1,                // 0 empty
    0.42, 0.66, 0.29, 1,       // grass
    0.20, 0.44, 0.19, 1,       // forest floor
    0.63, 0.55, 0.33, 1,       // hill
    0.56, 0.56, 0.60, 1,       // mountain
    0.19, 0.40, 0.66, 1,       // water
]);

const SIDE_COLOR = { red: [0.88, 0.26, 0.20], blue: [0.28, 0.50, 0.95] };

export const TINT = {
    move: [0.45, 0.70, 1.55],
    target: [1.9, 0.30, 0.30],
    selected: [1.6, 1.45, 0.45],
};

/** Build the world on `scene`: terrain, decorations and unit kinds. */
export function createBoard(scene) {
    const world = scene.createTileWorld({
        width: MAP_W, height: MAP_H, topology: "hex",
        cellSize: 1.0, heightStep: 0.45, chunkSize: 16,
        baseLevel: -2, aoStrength: 0.4,
        palette: PALETTE,
    });
    authorMap(world);
    decorate(world);
    const kinds = unitKinds(world);
    world.rebuild();
    world.rebuildObjects();

    const hpBars = new Map();   // unit.id -> ShapeNode
    const popups = [];          // { node, x, z, y0, t }

    const topOf = (x, y) => {
        const p = world.cellCenterWorldXZ(x, y);
        const h = world.sampleHeight(p.x, p.z);
        return { x: p.x, y: h === null ? 0 : h, z: p.z };
    };

    /** Re-place unit instances and HP bars; acted units dim while the battle runs. */
    function sync(battle) {
        for (const k of Object.values(kinds)) world.clearObjects(k);
        for (const u of battle.units) {
            if (!u.alive) continue;
            const c = SIDE_COLOR[u.side];
            const dim = u.acted && !battle.turn.over ? 0.55 : 1.0;
            world.addObject(kinds[u.type], u.x, u.y, {
                yaw: u.side === "red" ? Math.PI / 2 : -Math.PI / 2,
                scale: 1.25,
                color: [c[0] * dim, c[1] * dim, c[2] * dim, 1],
            });
        }
        world.rebuildObjects();

        const live = new Set();
        for (const u of battle.units) {
            if (!u.alive) continue;
            live.add(u.id);
            const p = topOf(u.x, u.y);
            const frac = u.hp / UNIT_TYPES[u.type].hp;
            const fill = frac > 0.6 ? "#46d24a" : frac > 0.3 ? "#e6c33c" : "#e04430";
            let bar = hpBars.get(u.id);
            if (!bar) {
                bar = scene.createShape({ shape: "rect", width: 0.8, height: 0.09, fill, worldAnchor: [p.x, p.y + 1.18, p.z], billboard: "full" });
                hpBars.set(u.id, bar);
            }
            bar.worldAnchor = [p.x, p.y + 1.18, p.z];
            bar.width = Math.max(0.06, 0.8 * frac);
            bar.fillColor = fill;
        }
        for (const [id, bar] of hpBars) {
            if (!live.has(id)) { bar.destroy(); hpBars.delete(id); }
        }
    }

    function clearHighlights() {
        world.fillTint(0, 0, MAP_W - 1, MAP_H - 1, 1, 1, 1, 1);
        world.rebuild();
    }

    /** Tint cells ({x, y}); rgb multiplies the terrain colour. */
    function highlight(cells, rgb) {
        for (const c of cells) world.setTint(c.x, c.y, rgb[0], rgb[1], rgb[2], 1);
        world.rebuild();
    }

    /** A number rising off a unit's cell for ~0.5 s (advance with stepPopups). */
    function popup(x, y, text, color) {
        const p = topOf(x, y);
        const node = scene.createHtmlNode({
            width: 80, height: 30, pxPerUnit: 60,
            worldAnchor: [p.x, p.y + 1.5, p.z], billboard: "full",
            html: '<div style="color:' + color + ';font:bold 22px monospace;text-align:center;' +
                  'text-shadow:0 1px 3px #000">' + text + "</div>",
        });
        popups.push({ node, x: p.x, z: p.z, y0: p.y + 1.5, t: 0 });
    }

    function stepPopups(dt) {
        for (const q of popups) {
            q.t += dt;
            q.node.worldAnchor = [q.x, q.y0 + Math.min(0.6, q.t * 0.0012), q.z];
        }
        for (let i = popups.length - 1; i >= 0; i--) {
            if (popups[i].t >= 550) { popups[i].node.destroy(); popups.splice(i, 1); }
        }
    }

    /** Release every node this board made. */
    function destroy() {
        for (const bar of hpBars.values()) bar.destroy();
        hpBars.clear();
        for (const q of popups) q.node.destroy();
        popups.length = 0;
        world.destroy();
    }

    return { world, kinds, topOf, sync, clearHighlights, highlight, popup, stepPopups, destroy };
}

// Trees on forest cells, a rock per mountain; seeded so screenshots repeat.
function decorate(world) {
    const rng = seededRandom(0xC0FFEE);
    const tree = world.addObjectKind(
        Mesh.merge([
            Mesh.cylinder(0.05, 0.10, 6).translate(0, 0.10, 0),
            Mesh.cone(0.20, 0.52, 7, 1, true).translate(0, 0.16, 0),
        ]),
        { color: [0.16, 0.38, 0.16, 1], roughness: 0.95 });
    const rock = world.addObjectKind(
        Mesh.rock(0.22, 7, 2).translate(0, 0.14, 0),
        { color: [0.48, 0.48, 0.52, 1], roughness: 1.0 });
    for (let y = 0; y < MAP_H; y++) {
        for (let x = 0; x < MAP_W; x++) {
            const id = world.getTile(x, y, 0);
            if (id === TILE.FOREST) {
                const n = 2 + Math.floor(rng() * 2);
                for (let i = 0; i < n; i++) {
                    world.addObject(tree, x, y, {
                        yaw: rng() * Math.PI * 2, scale: 0.8 + rng() * 0.45,
                        offsetX: (rng() - 0.5) * 0.55, offsetZ: (rng() - 0.5) * 0.55,
                    });
                }
            } else if (id === TILE.MOUNTAIN) {
                world.addObject(rock, x, y, { yaw: rng() * 6.28, scale: 1.1 });
            }
        }
    }
}

// bro.mesh primitive assemblies with a white base, so the per-instance
// colour carries the side.
function unitKinds(world) {
    return {
        infantry: world.addObjectKind(
            Mesh.merge([
                Mesh.cylinder(0.26, 0.035, 12).translate(0, 0.035, 0),      // base puck
                Mesh.capsule(0.13, 0.13, 10, 6).translate(0, 0.40, 0),      // body
                Mesh.sphere(0.10, 10, 8).translate(0, 0.68, 0),             // head
            ]),
            { color: [1, 1, 1, 1], roughness: 0.75 }),
        tank: world.addObjectKind(
            Mesh.merge([
                Mesh.box(0.32, 0.10, 0.24).translate(0, 0.14, 0),           // hull
                Mesh.cylinder(0.15, 0.07, 12).translate(0, 0.31, 0),        // turret
                Mesh.cylinder(0.035, 0.20, 8).rotate(1, 0, 0, Math.PI / 2)
                    .translate(0, 0.31, 0.30),                              // barrel
            ]),
            { color: [1, 1, 1, 1], roughness: 0.6, metallic: 0.35 }),
        artillery: world.addObjectKind(
            Mesh.merge([
                Mesh.box(0.26, 0.07, 0.20).translate(0, 0.11, 0),           // carriage
                Mesh.cylinder(0.09, 0.05, 10).translate(0, 0.21, 0),        // mount
                Mesh.cylinder(0.05, 0.30, 8).rotate(1, 0, 0, Math.PI / 3)
                    .translate(0, 0.34, 0.18),                              // tilted barrel
            ]),
            { color: [1, 1, 1, 1], roughness: 0.6, metallic: 0.3 }),
    };
}
