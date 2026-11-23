// lib/city/buildings.js — a building's masses from its lot, packed for the GPU.
//
// buildMasses(lots, field) -> { data: Float32Array (MASS_FLOATS a mass), count, buildings }
// A mass is an oriented box, local +z facing the street, standing on y0 with
// `plinth` metres of foundation below (so it meets falling ground), with a
// facade style the shader draws (floors, bays, windows, rooms behind them)
// and a roof (flat with a parapet, or gable / hip over the box).
//
// Layout of one mass (4 x vec4<f32>):
//   0: cx, y0, cz, yaw
//   1: halfW (local x), height (walls, y0 up), halfD (local z), floorH
//   2: groundH (the ground floor's height), plinth, seed (0..1), style
//   3: roof (0 flat, 1 gable, 2 hip), roofH, flags (1: street front, 2: shop ground floor), hue (0..1)
// A building is the masses it owns: [first, count] plus its footprint and kind,
// which the near-field (interiors, collision) reads.

import { rng } from "./field.js";

export const MASS_FLOATS = 16;

export const STYLE = {
    glass: 0,        // curtain-wall tower: mullion grid, spandrel bands
    office: 1,       // concrete frame grid, deep punched windows
    brick: 2,        // brick midrise, punched windows, cornice
    stone: 3,        // limestone classic, tall windows
    stucco: 4,       // rendered apartments, balconies
    rowhouse: 5,     // brick terraces, 2-3 floors
    siding: 6,       // timber-sided house
    plaster: 7,      // plastered house
    industrial: 8,   // corrugated metal shed, clerestory band
};

export function buildMasses(lots, field, opts = {}) {
    const out = [];
    const buildings = [];
    const push = (b, cx, cz, yaw, hw, hd, y0, h, floorH, groundH, plinth, seed, style, roof, roofH, flags, hue) => {
        out.push(cx, y0, cz, yaw, hw, h, hd, floorH, groundH, plinth, seed, style, roof, roofH, flags, hue);
        b.count++;
    };
    // Local (lx, lz) of a lot to world.
    const toW = (L, lx, lz) => {
        const c = Math.cos(L.yaw), s = Math.sin(L.yaw);
        return [L.x + c * lx + s * lz, L.z - s * lx + c * lz];
    };

    lots.forEach((L, li) => {
        const R = rng(((li + 1) * 2246822519) >>> 0);
        const seed = () => R();
        const y0 = L.yf;                      // stand at the street front's height (cut into a rise behind)
        const plinth = y0 - L.y0 + 1.2;       // and reach below the lowest corner
        const hw = L.w * 0.5, hd = L.d * 0.5;
        const b = { lot: li, first: out.length / MASS_FLOATS, count: 0, zone: L.zone, x: L.x, z: L.z, yaw: L.yaw, w: L.w, d: L.d, y0 };
        const dens = L.dens;
        const hue = R();

        if (L.zone === 'tower') {
            // Podium to the street, a shaft set back over it, sometimes a crown.
            const podF = 2 + Math.floor(R() * 3);
            const podH = 5.2 + (podF - 1) * 4.2;
            const style = R() < 0.62 ? STYLE.glass : (R() < 0.5 ? STYLE.office : STYLE.stone);
            push(b, L.x, L.z, L.yaw, hw, hd, y0, podH, 4.2, 5.2, plinth, seed(), style === STYLE.glass ? STYLE.stone : style, 0, 1.1, 3, hue);
            const tall = Math.pow(Math.max(0, dens - 0.45) / 0.55, 1.6);
            const floors = Math.round(10 + tall * 46 * (0.55 + R() * 0.9) + R() * 8);
            const fh = style === STYLE.glass ? 3.9 : 3.7;
            const sw = hw * (0.62 + R() * 0.2), sd = hd * (0.6 + R() * 0.2);
            const sh = floors * fh;
            const shift = (hd - sd) * (R() - 0.5) * 0.6;
            const [tx, tz] = toW(L, 0, shift);
            if (floors > 26 && R() < 0.55) {
                const lower = Math.round(sh * (0.55 + R() * 0.2) / fh) * fh;
                push(b, tx, tz, L.yaw, sw, sd, y0 + podH, lower, fh, fh, 0.2, seed(), style, 0, 1.2, 0, hue);
                push(b, tx, tz, L.yaw, sw * 0.76, sd * 0.76, y0 + podH + lower, sh - lower, fh, fh, 0.2, seed(), style, 0, 1.6, 0, hue);
            } else {
                push(b, tx, tz, L.yaw, sw, sd, y0 + podH, sh, fh, fh, 0.2, seed(), style, 0, 1.4, 0, hue);
            }
        } else if (L.zone === 'urban') {
            const floors = 4 + Math.floor(R() * (3 + dens * 9));
            const style = [STYLE.brick, STYLE.stone, STYLE.stucco, STYLE.office][Math.floor(R() * 4)];
            const fh = style === STYLE.office ? 3.6 : 3.3;
            push(b, L.x, L.z, L.yaw, hw, hd, y0, 4.6 + (floors - 1) * fh, fh, 4.6, plinth, seed(), style, 0, 0.9, 3, hue);
        } else if (L.zone === 'mixed') {
            const floors = 2 + Math.floor(R() * 4);
            const style = [STYLE.brick, STYLE.brick, STYLE.stucco, STYLE.stone][Math.floor(R() * 4)];
            push(b, L.x, L.z, L.yaw, hw, hd, y0, 4.3 + (floors - 1) * 3.2, 3.2, 4.3, plinth, seed(), style, 0, 0.8, 3, hue);
        } else if (L.zone === 'rowhouse') {
            const floors = 2 + Math.floor(R() * 2);
            const pitched = R() < 0.55;
            const h = 3.1 * floors + 0.4;
            push(b, L.x, L.z, L.yaw, hw, hd, y0, h, 3.1, 3.5, plinth, seed(), STYLE.rowhouse, pitched ? 1 : 0, pitched ? 2.6 : 0.6, 1, hue);
        } else if (L.zone === 'house') {
            // A house set back in its yard, a garage beside it sometimes.
            const floors = R() < 0.55 ? 2 : 1;
            const bw = Math.min(hw - 1.5, 4.5 + R() * 2.5), bd = Math.min(hd - 4, 4.2 + R() * 2.2);
            if (bw < 3 || bd < 3) return;
            const front = hd - bd - (1.5 + R() * 2.5);
            const [cx, cz] = toW(L, (R() - 0.5) * (hw - bw - 1), front);
            const style = R() < 0.55 ? STYLE.siding : STYLE.plaster;
            const roof = R() < 0.6 ? 1 : 2;
            push(b, cx, cz, L.yaw, bw, bd, y0, floors * 2.9 + 0.5, 2.9, 3.4, plinth, seed(), style, roof, 2.2 + R() * 1.4, 1, hue);
            if (R() < 0.5 && hw - bw > 4) {
                const gx = (bw + 2) * (R() < 0.5 ? -1 : 1);
                const [gx2, gz2] = toW(L, gx, front + bd - 3.2);
                push(b, gx2, gz2, L.yaw, 1.9, 3.0, y0, 2.7, 2.7, 2.7, plinth, seed(), style, 0, 0.3, 1, hue);
            }
        } else if (L.zone === 'industrial') {
            const h = 7 + R() * 6;
            push(b, L.x, L.z, L.yaw, hw * 0.92, hd * 0.92, y0, h, h, h, plinth, seed(), STYLE.industrial, R() < 0.5 ? 1 : 0, R() < 0.5 ? 1.6 : 0.5, 1, hue);
        }
        if (b.count) buildings.push(b);
    });

    return { data: new Float32Array(out), count: out.length / MASS_FLOATS, buildings };
}
