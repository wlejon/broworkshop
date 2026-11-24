// lib/city/buildings.js — a building's masses from its lot, packed for the GPU.
//
// buildMasses(lots, field) -> { data: Float32Array (MASS_FLOATS a mass), count, buildings }
// A mass is an oriented box, local +z facing the street, standing on y0 with
// `plinth` metres of foundation below (so it meets falling ground), with a
// facade style the shader draws (floors, bays, windows, rooms behind them)
// and a roof (flat with a parapet, or gable / hip over the box).
//
// A building is composed of several masses by its zone's forms:
//   tower       a podium to the street (or a plaza in front of a shaft that
//               comes down to the ground), and a shaft: straight, stepped
//               back in tiers, a slab, twin shafts or an L; crowned by plant
//               rooms, a pyramid, or (the tallest of a district) a spire.
//               Heights peak at the district cores (site.centers), with a
//               few towers standing well above their neighbours.
//   urban/mixed a street block's front, sometimes a lower wing behind it, an
//               attic storey set back from the street, a mansard or pitched
//               roof, plant and stair rooms on a flat roof.
//   rowhouse    a terrace house, sometimes a lower extension behind.
//   house       a house in its yard: a plain box, an L with a cross wing,
//               a porch, a chimney, a garage.
//   industrial  a shed (sawtooth bays or one span), an office block at its
//               front, a stack, silos.
// Parts touch or stand inside one another, never share a face's plane over
// an area both draw (that would flicker), and only the street front's masses
// carry the street flags (door, shop).
//
// Layout of one mass (4 x vec4<f32>):
//   0: cx, y0, cz, yaw
//   1: halfW (local x), height (walls, y0 up), halfD (local z), floorH
//   2: groundH (the ground floor's height), plinth, seed (0..1), style
//   3: roof (0 flat, 1 gable, 2 hip), roofH, flags (1: street front, 2: shop ground floor, 4: taken down, 8: hidden from view), hue (0..1)
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
    plant: 9,        // rooftop plant, stair rooms, stacks, silos: no windows, no rooms
};

const ROOF = { flat: 0, gable: 1, hip: 2 };
const FLAG = { street: 1, shop: 2 };

/** How much a district core lifts the towers at (x, z): 0 off every core, up to its weight at its middle. */
function corePeak(centers, x, z) {
    let p = 0;
    for (const c of centers ?? []) {
        const d = Math.hypot(x - c.x, z - c.z) / (c.r * 0.24);
        p = Math.max(p, (c.weight ?? 1) * Math.exp(-d * d));
    }
    return p;
}

export function buildMasses(lots, field, opts = {}) {
    const out = [];
    const buildings = [];
    const centers = field?.site?.centers ?? opts.centers ?? [];
    // Each core's landmark: the tower lot nearest its middle, made to stand
    // well over the towers around it (left to the draws, a core whose lots
    // fell differently could have none).
    const landmark = new Map();   // lot index -> its core's weight
    for (const c of centers) {
        let best = -1, bd = c.r * 0.6;
        lots.forEach((L, li) => {
            if (L.zone !== 'tower') return;
            const d = Math.hypot(L.x - c.x, L.z - c.z);
            if (d < bd) { bd = d; best = li; }
        });
        if (best >= 0) landmark.set(best, c.weight ?? 1);
    }

    lots.forEach((L, li) => {
        const R = rng(((li + 1) * 2246822519) >>> 0);
        const y0 = L.yf;                      // stand at the street front's height (cut into a rise behind)
        const plinth = y0 - L.y0 + 1.2;       // and reach below the lowest corner
        const hw = L.w * 0.5, hd = L.d * 0.5;
        const b = { lot: li, first: out.length / MASS_FLOATS, count: 0, zone: L.zone, x: L.x, z: L.z, yaw: L.yaw, w: L.w, d: L.d, y0 };
        const dens = L.dens;
        const hue = R();
        const c = Math.cos(L.yaw), s = Math.sin(L.yaw);

        // A mass at local (lx, lz) of the lot, standing at local height ly over
        // the street front (plinth: metres of wall below it, into what it stands on).
        const part = (lx, lz, mw, md, ly, h, o) => {
            out.push(L.x + c * lx + s * lz, y0 + ly, L.z - s * lx + c * lz, L.yaw + (o.turn ?? 0),
                mw, h, md, o.floorH ?? 3.3,
                o.groundH ?? o.floorH ?? 3.3, o.plinth ?? (ly > 0.01 ? 0.02 : plinth), R(), o.style,
                o.roof ?? ROOF.flat, o.roofH ?? 0.9, o.flags ?? 0, o.hue ?? hue);
            b.count++;
        };
        // Plant on a flat roof at local height top over a footprint [x0, x1] x [z0, z1]:
        // an overrun, a stair room, a tank or two, clear of the parapet.
        // (Each clear of the others by half a metre, so none share a wall.)
        const plant = (x0, x1, z0, z1, top, n, scale = 1) => {
            const placed = [];
            for (let k = 0; k < n; k++) {
                const w = (1.4 + R() * 2.6) * scale, d = (1.4 + R() * 2.2) * scale;
                const ax = (x1 - x0) * 0.5 - w - 1.2, az = (z1 - z0) * 0.5 - d - 1.2;
                if (ax < 0 || az < 0) return;
                const px = (x0 + x1) * 0.5 + (R() * 2 - 1) * ax, pz = (z0 + z1) * 0.5 + (R() * 2 - 1) * az;
                if (placed.some(([qx, qz, qw, qd]) => Math.abs(px - qx) < w + qw + 0.5 && Math.abs(pz - qz) < d + qd + 0.5)) continue;
                placed.push([px, pz, w, d]);
                const h = (2.2 + R() * 2.2) * Math.sqrt(scale);
                // (Concrete or render: plant's hues past the brick quarter.)
                part(px, pz, w, d, top, h, { style: STYLE.plant, floorH: h, roofH: 0.25, hue: 0.26 + R() * 0.48 });
            }
        };

        if (L.zone === 'tower') tower();
        else if (L.zone === 'urban' || L.zone === 'mixed') block();
        else if (L.zone === 'rowhouse') rowhouse();
        else if (L.zone === 'house') house();
        else if (L.zone === 'industrial') industrial();
        if (b.count) buildings.push(b);

        function tower() {
            const peak = corePeak(centers, L.x, L.z);
            const tall = Math.pow(Math.max(0, dens - 0.45) / 0.55, 1.4);
            // Floors: the density's share, lifted toward the cores; one in ten
            // stands far above its neighbours, most stay well below the peak.
            let floors = 8 + tall * 11 * (0.4 + R() * 0.8) + peak * 62 * (0.45 + R() * 0.75) + R() * 6;
            if (R() < 0.08) floors *= 1.6 + R() * 0.7;
            if (landmark.has(li)) floors = Math.max(floors, 50 + 45 * landmark.get(li));
            floors = Math.round(Math.min(110, floors));
            const style = R() < 0.6 ? STYLE.glass : (R() < 0.55 ? STYLE.office : STYLE.stone);
            const fh = style === STYLE.glass ? 3.9 : 3.7;
            // The podium: to the street, or none and a plaza before a shaft to the ground.
            const plaza = style === STYLE.glass && R() < 0.25 && hd > 18;
            const podF = 2 + Math.floor(R() * 3);
            const podH = plaza ? 0 : 5.2 + (podF - 1) * 4.2;
            if (!plaza) {
                const podStyle = style === STYLE.glass ? (R() < 0.6 ? STYLE.stone : STYLE.office) : style;
                part(0, 0, hw, hd, 0, podH, { style: podStyle, floorH: 4.2, groundH: 5.2, roofH: 1.1, flags: FLAG.street | FLAG.shop });
            }
            const base = podH;
            const sh = floors * fh;
            // The shaft's footprint: within the podium, or set back behind a plaza.
            let sw = hw * (0.6 + R() * 0.25), sd = hd * (0.58 + R() * 0.22);
            let sz = (hd - sd) * (R() - 0.5) * 0.6;
            if (plaza) { sw = hw * (0.7 + R() * 0.2); sd = hd * (0.55 + R() * 0.15); sz = -(hd - sd) + 1.5; }
            const shaftOpts = (h0, flags) => ({ style, floorH: fh, groundH: h0 > 0 ? fh : 5.6, roofH: 1.3, flags });
            const ground = plaza ? FLAG.street : 0;
            const form = R();
            let tops = [];   // [x, z, w, d, top] of each top for crowns
            if (floors > 30 && form < 0.4) {
                // Set back in tiers (two to four), each narrower than the one below.
                const tiers = 2 + Math.floor(R() * (floors > 55 ? 3 : 2));
                let y = base, w = sw, d = sd, left = sh;
                for (let t = 0; t < tiers; t++) {
                    const last = t === tiers - 1;
                    const th = last ? left : Math.round(left * (0.45 + R() * 0.2) / fh) * fh;
                    part(0, sz, w, d, y, th, shaftOpts(y, t === 0 ? ground : 0));
                    y += th; left -= th;
                    if (!last) { w *= 0.72 + R() * 0.12; d *= 0.72 + R() * 0.12; }
                }
                tops.push([0, sz, w, d, y]);
            } else if (form < 0.55 && hw > 16) {
                // A slab: wide to the street, thin behind.
                const w = hw * (0.82 + R() * 0.1), d = Math.max(7, hd * (0.32 + R() * 0.1));
                const h = Math.round(sh * 0.8 / fh) * fh;
                part(0, sz, w, d, base, h, shaftOpts(base, ground));
                tops.push([0, sz, w, d, base + h]);
            } else if (form < 0.68 && hw > 17) {
                // Twin shafts, one taller.
                const w = hw * (0.38 + R() * 0.06), d = sd;
                const gap = hw - 2 * w;
                const h1 = sh, h2 = Math.round(sh * (0.55 + R() * 0.3) / fh) * fh;
                const side = R() < 0.5 ? -1 : 1;
                part(side * (w + gap * 0.5), sz, w, d, base, h1, shaftOpts(base, ground));
                part(-side * (w + gap * 0.5), sz, w, d, base, h2, shaftOpts(base, ground));
                tops.push([side * (w + gap * 0.5), sz, w, d, base + h1], [-side * (w + gap * 0.5), sz, w, d, base + h2]);
            } else if (form < 0.8 && hw > 15 && hd > 18) {
                // An L: a wing along the street, a taller one along a side, touching.
                const side = R() < 0.5 ? -1 : 1;
                const aw = sw, ad = sd * 0.48;
                const bw = sw * 0.45, bd = sd - ad;
                const ha = Math.round(sh * (0.5 + R() * 0.25) / fh) * fh;
                part(0, sz + sd - ad, aw, ad, base, ha, shaftOpts(base, ground));
                part(side * (aw - bw), sz - ad, bw, bd, base, sh, shaftOpts(base, 0));
                tops.push([0, sz + sd - ad, aw, ad, base + ha], [side * (aw - bw), sz - ad, bw, bd, base + sh]);
            } else {
                part(0, sz, sw, sd, base, sh, shaftOpts(base, ground));
                tops.push([0, sz, sw, sd, base + sh]);
            }
            // Crowns on the highest top: a spire for a landmark, a pyramid, or plant rooms.
            tops.sort((a, b2) => b2[4] - a[4]);
            const [tx, tz, tw, td, top] = tops[0];
            const crown = R();
            const tallest = (floors > 60 && peak > 0.5) || landmark.has(li);
            if (tallest && crown < 0.5) {
                // A crown storey set in, then a spire.
                const cw = Math.min(tw, td) * 0.62;
                part(tx, tz, cw, cw, top, fh * 3, { style, floorH: fh, roofH: 0.6 });
                const spw = Math.max(0.6, cw * 0.12);
                part(tx, tz, spw, spw, top + fh * 3, 0.2, { style: STYLE.plant, floorH: 1, roof: ROOF.hip, roofH: 22 + R() * 40 });
            } else if (crown < 0.32 && Math.abs(tw - td) < Math.max(tw, td) * 0.35) {
                // A pyramid roof over a square-ish top, its height a share of its width.
                // (Its box inside the top, below its roof, so only the slopes show.)
                part(tx, tz, tw - 0.5, td - 0.5, top - 0.5, 0.3, { style: STYLE.plant, floorH: 1, roof: ROOF.hip, roofH: Math.min(tw, td) * (0.5 + R() * 0.7) });
            } else {
                // A plant storey set in, with louvres, and smaller plant on it.
                const pw = tw * (0.5 + R() * 0.25), pd = td * (0.5 + R() * 0.25);
                const ph = 4 + R() * 5;
                part(tx, tz, pw, pd, top, ph, { style: STYLE.plant, floorH: ph, roofH: 0.4 });
                plant(tx - pw, tx + pw, tz - pd, tz + pd, top + ph, 1 + Math.floor(R() * 2));
            }
            for (let k = 1; k < tops.length; k++) {
                const [x, z, w, d, t] = tops[k];
                plant(x - w, x + w, z - d, z + d, t, 1 + Math.floor(R() * 2), 1.2);
            }
            // Plant on the podium's roof in front of the shaft, where there is room.
            if (!plaza && hd - (sz + sd) > 6) plant(-hw, hw, sz + sd, hd, podH, R() < 0.5 ? 1 : 0);
        }

        function block() {
            const urban = L.zone === 'urban';
            // (A corner building stands a floor or two above its street.)
            const floors = (urban ? 4 + Math.floor(R() * (3 + dens * 9)) : 2 + Math.floor(R() * 4)) + (L.corner ? 1 + (R() < 0.4 ? 1 : 0) : 0);
            const style = urban ? [STYLE.brick, STYLE.stone, STYLE.stucco, STYLE.office][Math.floor(R() * 4)]
                : [STYLE.brick, STYLE.brick, STYLE.stucco, STYLE.stone][Math.floor(R() * 4)];
            const fh = style === STYLE.office ? 3.6 : (urban ? 3.3 : 3.2);
            const gh = urban ? 4.6 : 4.3;
            const flags = FLAG.street | FLAG.shop;
            // The street front: the whole lot, or its front with a lower wing behind.
            const wing = hd > 11 && R() < 0.5;
            const fd = wing ? hd * (0.55 + R() * 0.12) : hd;   // the front's half depth
            const fz = hd - fd;                                  // its centre, so it stands at the street
            // An attic storey or two, set back from the street (and from the
            // yard), its own walls to the party walls either side.
            const attic = floors >= 4 && R() < 0.35 ? 1 + (floors >= 7 && R() < 0.4 ? 1 : 0) : 0;
            const mainF = floors - attic;
            const mainH = gh + (mainF - 1) * fh;
            // A pitched or mansard roof on the old styles, not with an attic.
            const pitched = !attic && style !== STYLE.office && R() < (urban ? 0.3 : 0.5);
            const roof = pitched ? (R() < 0.5 ? ROOF.hip : ROOF.gable) : ROOF.flat;
            const roofH = pitched ? (roof === ROOF.hip ? 2.6 + R() * 1.6 : Math.min(fd, 9) * (0.45 + R() * 0.25)) : (urban ? 0.9 : 0.8);
            part(0, fz, hw, fd, 0, mainH, { style, floorH: fh, groundH: gh, roof, roofH, flags });
            if (attic) {
                const set = 1.8 + R() * 1.2;
                // (No foundation: its walls start on the roof, in the planes
                // of the walls below, above them.)
                part(0, fz - set * 0.5, hw, fd - set * 0.5 - 1.0, mainH, attic * fh, { style, floorH: fh, groundH: fh, roofH: 0.6, plinth: 0 });
            }
            if (wing) {
                // The wing: narrower, a floor or more lower, to one side or the middle.
                const ww = hw * (0.4 + R() * 0.25);
                // (On a corner lot, away from the cross street at its +x.)
                const wx = L.corner ? -(hw - ww) : R() < 0.6 ? (hw - ww) * (R() < 0.5 ? -1 : 1) : 0;
                const wd = (hd - fd) * (0.85 + R() * 0.15);
                const wf = Math.max(1, mainF - 1 - Math.floor(R() * 2));
                part(wx, -hd + wd, ww, wd, 0, gh + (wf - 1) * fh, { style, floorH: fh, groundH: gh, roofH: 0.7 });
            }
            if (!pitched) {
                const top = attic ? mainH + attic * fh : mainH;
                const az = attic ? fz - 1.4 : fz;
                const ad = attic ? fd - 2.4 : fd;
                plant(-hw, hw, az - ad, az + ad, top, R() < 0.65 ? 1 + Math.floor(R() * (urban ? 3 : 2)) : 0, urban ? 1 : 0.8);
            }
        }

        function rowhouse() {
            const floors = 2 + Math.floor(R() * 2);
            const pitched = R() < 0.55;
            const h = 3.1 * floors + 0.4;
            const ext = hd > 6 && R() < 0.5;
            const fd = ext ? hd * 0.72 : hd;
            part(0, hd - fd, hw, fd, 0, h, { style: STYLE.rowhouse, floorH: 3.1, groundH: 3.5, roof: pitched ? ROOF.gable : ROOF.flat, roofH: pitched ? 2.6 : 0.6, flags: FLAG.street });
            if (ext) {
                // A lower extension behind, narrower than the house.
                const ew = hw * (0.55 + R() * 0.25), ed = (hd - fd) * 0.95;
                part((hw - ew) * (R() < 0.5 ? -1 : 1), -hd + ed, ew, ed, 0, 3.4, { style: STYLE.rowhouse, floorH: 3.1, groundH: 3.4, roofH: 0.4 });
            }
        }

        function house() {
            // A house set back in its yard: a box or an L, a porch, a chimney, a garage sometimes.
            const floors = R() < 0.55 ? 2 : 1;
            const bw = Math.min(hw - 1.5, 4.5 + R() * 2.5), bd = Math.min(hd - 4, 4.2 + R() * 2.2);
            if (bw < 3 || bd < 3) return;
            const front = hd - bd - (1.5 + R() * 2.5);
            const bx = (R() - 0.5) * (hw - bw - 1);
            const style = R() < 0.55 ? STYLE.siding : STYLE.plaster;
            const roof = R() < 0.6 ? ROOF.gable : ROOF.hip;
            const h = floors * 2.9 + 0.5;
            const roofH = 2.2 + R() * 1.4;
            part(bx, front, bw, bd, 0, h, { style, floorH: 2.9, groundH: 3.4, roof, roofH, flags: FLAG.street });
            const shape = R();
            let wingSide = 0;
            if (shape < 0.45 && hw - Math.abs(bx) - bw > 1.5) {
                // A cross wing: its gable to the street at one end, standing forward.
                wingSide = R() < 0.5 ? -1 : 1;
                const ww = Math.min(bw * 0.45, 3.2 + R() * 1.0), wd = bd + 1.5 + R() * 1.5;
                // (Standing 0.4 m out past the house's side, so no wall of
                // the two lies in one plane.)
                const wx = bx + wingSide * (bw - ww + 0.4);
                const wz = front + bd - wd + 1.5 + R();
                // Turned a quarter, so its ridge runs to the street.
                part(wx, wz, wd, ww, 0, floors === 2 && R() < 0.6 ? h : 2.9 + 0.4, { style, floorH: 2.9, groundH: 3.4, roof: ROOF.gable, roofH: roofH * 0.9, turn: Math.PI / 2, flags: 0 });
            } else if (shape < 0.75) {
                // A porch over the door.
                const pw = Math.min(bw * 0.5, 2.2 + R()), pd = 1.0;
                part(bx, front + bd + pd, pw, pd, 0, 2.6, { style, floorH: 2.6, groundH: 2.6, roof: ROOF.hip, roofH: 0.7, flags: 0 });
            }
            if (R() < 0.45) {
                // A chimney through the roof at a gable end.
                const cx = bx + (bw - 0.9) * (R() < 0.5 ? -1 : 1) * (wingSide ? -1 : 1);
                part(cx, front + (R() - 0.5) * bd * 0.6, 0.38, 0.38, h - 0.5, roofH + 1.4, { style: STYLE.plant, floorH: 1, roofH: 0.15, hue: 0.07 });
            }
            if (R() < 0.5 && hw - bw - Math.abs(bx) > 4) {
                const gx = bx + (bw + 2) * (wingSide ? -wingSide : (R() < 0.5 ? -1 : 1));
                part(gx, front + bd - 3.2, 1.9, 3.0, 0, 2.7, { style, floorH: 2.7, groundH: 2.7, roofH: 0.3, flags: FLAG.street });
            }
        }

        function industrial() {
            const h = 7 + R() * 6;
            const sd = hd * 0.92;
            const extra = R();
            // Silos stand in a row beside the shed, which gives them its side.
            const silos = extra >= 0.07 && extra < 0.2 && hw > 16;
            const sr = 2.6 + R() * 1.4, sside = R() < 0.5 ? -1 : 1;
            const sw = silos ? hw * 0.92 - sr - 0.9 : hw * 0.92;   // the shed's half width
            const sx = silos ? -sside * (sr + 0.9) : 0;           // and its middle
            const office = hd > 20 && R() < 0.55;
            const od = office ? 4.5 + R() * 2.5 : 0;     // the office block's half depth, at the street
            const shedD = sd - od;                        // the shed's half depth behind it
            const shedZ = -sd + shedD;
            if (R() < 0.35 && shedD > 10) {
                // Sawtooth: bays across the shed, each a gable to the light, end to end.
                const n = Math.max(3, Math.round(shedD * 2 / (7 + R() * 4)));
                const bd = shedD / n;
                for (let k = 0; k < n; k++) {
                    const z = shedZ - shedD + bd * (2 * k + 1);
                    part(sx, z, sw, bd, 0, h, { style: STYLE.industrial, floorH: h, groundH: h, roof: ROOF.gable, roofH: Math.min(3.2, bd * 0.8), flags: k === n - 1 && !office ? FLAG.street : 0 });
                }
            } else {
                const pitched = R() < 0.5;
                part(sx, shedZ, sw, shedD, 0, h, { style: STYLE.industrial, floorH: h, groundH: h, roof: pitched ? ROOF.gable : ROOF.flat, roofH: pitched ? 1.6 : 0.5, flags: office ? 0 : FLAG.street });
                if (!pitched) plant(sx - sw, sx + sw, shedZ - shedD, shedZ + shedD, h, Math.floor(R() * 3), 1.3);
            }
            if (office) {
                // Offices at the street: two or three floors, narrower than the shed.
                const ow = sw * (0.45 + R() * 0.35);
                const oh = 4.2 + (1 + Math.floor(R() * 2)) * 3.5;
                part(sx + (sw - ow) * (R() - 0.5), sd - od, ow, od, 0, oh, { style: R() < 0.6 ? STYLE.office : STYLE.brick, floorH: 3.5, groundH: 4.2, roofH: 0.7, flags: FLAG.street });
            }
            if (extra < 0.07) {
                // A stack through the shed's roof at a back corner.
                const r = 0.8 + R() * 0.7;
                part(sx + (sw - r - 2) * (R() < 0.5 ? -1 : 1), -sd + r + 2.3, r, r, 0, 24 + R() * 30, { style: STYLE.plant, floorH: 2, roofH: 0.3, hue: 0.07 + R() * 0.1 });
            } else if (silos) {
                // The silos, from the back, as many as stand clear of the offices.
                const n = 2 + Math.floor(R() * 3), sh = h + 8 + R() * 14;
                for (let k = 0; k < n; k++) {
                    const z = -sd + sr + 0.5 + k * (2 * sr + 0.6);
                    if (z + sr > sd - 2 * od - 0.5) break;
                    part(sside * (hw * 0.92 - sr), z, sr, sr, 0, sh, { style: STYLE.plant, floorH: 3, roof: ROOF.hip, roofH: sr * 0.6, hue: 0.5 + R() * 0.3 });
                }
            }
        }
    });

    return { data: new Float32Array(out), count: out.length / MASS_FLOATS, buildings };
}
