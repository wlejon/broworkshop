// Tumble build aids — the scene-side guides that make building readable:
// the tinted build layer, the cursor cell highlight + piece ghost, the
// glowing drop zone under the spout, the goal beacon, and gold pads on a
// verified solution's cells (shown on an empty board only). No DOM.

import { PIECES } from "/app/pieces.js";
import { goalCenter } from "/app/levels.js";

const OK_GREEN = { color: "#4eff8f", emissive: 2.4, emissiveColor: [0.25, 1.0, 0.45] };
const BLOCKED_RED = { color: "#ff6b5a", emissive: 1.6, emissiveColor: [1.0, 0.3, 0.25] };

/**
 * Build the aids for `level` into `scene`. `padCells` are solution piece
 * cells ({ x, y, z }) to hint with gold pads.
 */
export function createAids(scene, level, padCells) {
    const bx = level.bounds.x, bz = level.bounds.z;
    const sp = level.spawner;
    const gc = goalCenter(level);

    const layerPlane = scene.createMesh({
        mesh: "plane",
        halfW: (bx[1] - bx[0] + 1) * 0.5, halfD: (bz[1] - bz[0] + 1) * 0.5,
        x: (bx[0] + bx[1]) * 0.5, y: 0.001, z: (bz[0] + bz[1]) * 0.5,
        color: "#243356", emissive: 0.35, emissiveColor: [0.35, 0.5, 0.95],
        metallic: 0.0, roughness: 1.0, name: "layer-plane",
    });
    const dropZone = scene.createMesh({
        mesh: "cylinder", radius: 0.48, halfHeight: 0.025, segments: 24,
        x: sp.x, y: 0.03, z: sp.z,
        color: "#ffc166", emissive: 1.8, emissiveColor: [1.0, 0.75, 0.25],
        metallic: 0.05, roughness: 0.55, name: "drop-zone",
    });
    // Compact beacon over the cup; stays lit while marbles run.
    scene.createMesh({
        mesh: "sphere", radius: 0.18, segments: 14, rings: 10,
        x: gc.x, y: level.goal.max[1] + 0.55, z: gc.z,
        color: "#7dffb0", emissive: 2.4, emissiveColor: [0.3, 1.0, 0.55],
        metallic: 0.05, roughness: 0.35, name: "goal-orb",
    });
    const highlight = scene.createMesh(Object.assign({
        mesh: "box", halfW: 0.48, halfH: 0.04, halfD: 0.48, x: 0, y: 0.08, z: 0,
        metallic: 0.0, roughness: 0.4, name: "cell-highlight",
    }, OK_GREEN));
    highlight.visible = false;

    const pads = [];
    (padCells || []).forEach((p, i) => {
        const y = p.y || 0;
        pads.push(scene.createMesh({
            mesh: "box", halfW: 0.44, halfH: 0.04, halfD: 0.44,
            x: p.x + 0.5, y: y + 0.07, z: p.z + 0.5,
            color: "#ffc166", emissive: 2.0, emissiveColor: [1.0, 0.72, 0.2],
            metallic: 0.05, roughness: 0.4, name: "suggest-" + i,
        }));
        pads.push(scene.createMesh({
            mesh: "sphere", radius: 0.1, segments: 10, rings: 8,
            x: p.x + 0.5, y: y + 0.28, z: p.z + 0.5,
            color: "#fff0c8", emissive: 2.5, emissiveColor: [1.0, 0.9, 0.5],
            metallic: 0.0, roughness: 0.5, name: "suggest-mark-" + i,
        }));
    });

    let ghost = null;
    let ghostType = null;

    function hideCursor() {
        highlight.visible = false;
        if (ghost) ghost.visible = false;
    }

    return {
        /** Move the build layer tint to cell row y. */
        setLayer(y) { layerPlane.y = y + 0.001; },

        /**
         * Show or hide the build-mode guides. Solution pads only show on an
         * empty board.
         */
        showBuild(on, boardEmpty) {
            layerPlane.visible = on;
            dropZone.visible = on;
            for (const p of pads) p.visible = on && boardEmpty;
            if (!on) hideCursor();
        },

        /** Cursor over cell (cx, cy, cz): highlight green if placeable, red if not. */
        hover(cx, cy, cz, valid, type) {
            const wx = cx + 0.5, wz = cz + 0.5;
            highlight.x = wx;
            highlight.y = cy + 0.08;
            highlight.z = wz;
            const look = valid ? OK_GREEN : BLOCKED_RED;
            highlight.color = look.color;
            highlight.emissive = look.emissive;
            highlight.emissiveColor = look.emissiveColor;
            highlight.visible = true;
            // A plain translucent cube reads as "this cell"; full-piece
            // previews looked like floating junk.
            if (ghostType !== type) {
                if (ghost) scene.destroyNode(ghost);
                const def = PIECES[type];
                ghost = def ? scene.createMesh({
                    mesh: "box", halfW: 0.42, halfH: 0.42, halfD: 0.42,
                    color: def.color, emissive: 1.4, emissiveColor: [0.5, 0.85, 1.0],
                    metallic: 0.05, roughness: 0.35, name: "place-ghost",
                }) : null;
                ghostType = type;
            }
            if (ghost) {
                ghost.x = wx;
                ghost.y = cy + 0.5;
                ghost.z = wz;
                ghost.emissive = valid ? 1.8 : 0.35;
                ghost.visible = true;
            }
        },

        hideCursor,
    };
}
