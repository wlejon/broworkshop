// Observation vector for the Stompworld agent, built with
// bro.ai.game.grid.createObsWindow (a fixed footprint of cells around the
// hero, flattened into one Float32Array):
//
//   self block    9 floats (below)
//   tile layer    13 cols × 9 rows × 2 channels: solid, destructible
//   stomper layer 13 × 9 × 1
//   flyer layer   13 × 9 × 1
//   pickup layer  13 × 9 × 1
//
// Self block:
//   [0] vx / runSpeed          [1] vy / maxFall          [2] onGround
//   [3] facing (±1)            [4] coyote / coyoteTime   [5] buffer / jumpBuffer
//   [6] dx to pickup / 800 (0 once collected)            [7] dx to flag / 800
//   [8] hasWeapon
//
// Changing this layout invalidates saved checkpoints.

import { TILE, HERO_CFG } from "/app/rules.js";
import { GROUND_ID } from "/app/level.js";

const SELF_BLOCK_SIZE = 9;

function clamp(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }

// The window's callbacks read whichever sim build() was last called with.
let sim = null;
let win = null;
const self = new Float32Array(SELF_BLOCK_SIZE);

function cellOf(e) {
    return { col: Math.floor((e.x + e.w / 2) / TILE), row: Math.floor((e.y + e.h / 2) / TILE), value: 1 };
}
const NONE = { col: -1, row: -1, value: 0 };

function entityLayer(list) {
    return {
        channels: 1,
        enumerate: () => list().length,
        sample: (i) => {
            const e = list()[i];
            return e.alive ? cellOf(e) : NONE;
        },
    };
}

function ensureWindow() {
    if (win) return win;
    win = bro.ai.game.grid.createObsWindow({
        spec: {
            colsBehind: 2, colsAhead: 10, rowsUp: 4, rowsDown: 4,
            tileChannels: 2,
            selfBlockSize: SELF_BLOCK_SIZE,
        },
        tile: {
            normalize: new Float32Array([1, 1]),
            oob: new Float32Array([1, 0]),
            sample(c, r) {
                const tm = sim.tilemap;
                if (c < 0 || c >= tm.cols || r < 0 || r >= tm.rows) return false;
                const id = tm.data[r * tm.cols + c];
                if (!id || !tm.solidAt(c, r)) return [0, 0];
                return [1, id === GROUND_ID ? 0 : 1];
            },
        },
        layers: [
            entityLayer(() => sim.stompers),
            entityLayer(() => sim.flyers),
            {
                channels: 1,
                enumerate: () => (sim.pickup && !sim.pickupCollected ? 1 : 0),
                sample: () => cellOf(sim.pickup),
            },
        ],
    });
    return win;
}

/** Observation length. */
export function obsDim() { return ensureWindow().outDim; }

/**
 * The observation for the sim's current state. The returned array is
 * reused by the next call: slice() it to keep it.
 */
export function buildObs(s) {
    sim = s;
    const w = ensureWindow();
    const p = s.player;
    self[0] = clamp(p.vx / HERO_CFG.runSpeed, -1, 1);
    self[1] = clamp(p.vy / HERO_CFG.maxFall, -1, 1);
    self[2] = p.onGround ? 1 : 0;
    self[3] = p.facing < 0 ? -1 : 1;
    self[4] = clamp(p.coyote / HERO_CFG.coyoteTime, 0, 1);
    self[5] = clamp(p.buffer / HERO_CFG.jumpBuffer, 0, 1);
    self[6] = s.pickup && !s.pickupCollected ? clamp((s.pickup.x - p.x) / 800, -1, 1) : 0;
    self[7] = s.flag ? clamp((s.flag.x - p.x) / 800, -1, 1) : 0;
    self[8] = s.hasWeapon ? 1 : 0;
    return w.build(Math.floor((p.x + p.w / 2) / TILE), Math.floor((p.y + p.h / 2) / TILE), self);
}
