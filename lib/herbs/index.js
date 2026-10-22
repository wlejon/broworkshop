// herbs — a grass node's herb layer as a module of its own: ferns,
// wildflowers, forbs and ground cover from broflora's herb species
// (bro.flora.herbRecords), each grown, swayed and cut per pixel on the GPU.
//
//   import { herbModule } from "/lib/herbs/index.js";
//   scene.createGrass({ ground: land, ...,
//       herbs: herbModule({ species: ['bracken', 'woodsorrel', { preset: 'daisy', abundance: 1.5 }, 'poppy'] }),
//   });
//
// Where they grow and how thickly is the land's (its surface module's
// LandSurface.herbs, docs/land-api.js).
//
// The engine owns where a herb layer is drawn and how (the cells, rings,
// hand-overs, far tier, turf, lighting); this module says what the plants
// are: the GLSL bro compiles into the grass node's cover shaders (the
// contract is bro's shaders/ground/scene_herb_layer.glsl, the reference
// docs/vegetation-api.js "Herbs"). A world with other low plants (pebbles,
// coral, alien fronds) writes its own module the same way.
//
//   stand.glsl.js    which species stands in a cell, the far look
//   build.glsl.js    a plant's cards: stems, blooms, leaves; their sway
//   surface.glsl.js  a card cut to its leaf, stem or bloom, and lit
//
// herbModule({ species, swardHeight }) -> { source, data, height }:
//   species      up to 12 broflora herb species: preset names, or
//                { preset, ...HerbSpecies fields } as bro.flora.herbPreset
//                takes them, or a Float32Array of bro.flora.herbRecords
//   swardHeight  the grass's height (m, createGrass's height): how much of
//                each plant shows over the blades from afar

import { STAND } from "./stand.glsl.js";
import { BUILD } from "./build.glsl.js";
import { SURFACE } from "./surface.glsl.js";

const MAX = 12;            // stand.glsl.js HERB_MAX
const RECORD = 56;         // floats a herbRecord (14 vec4s)
const MEAN_STEPS = 5;      // HERB_MEAN_STEPS
const MEAN_AT = 169;       // HERB_MEAN_AT: 1 + MAX * 14
const MEAN_FLOATS = 12;    // a step's three vec4s
const CELL = 0.35;         // the herbs' grid (GrassNode::kHerbCell, grass.herbInfo.y)

export const SOURCE = STAND + BUILD + SURFACE;

export function herbModule({ species = [], swardHeight = 0.4 } = {}) {
    let rec = species instanceof Float32Array ? species : null;
    if (!rec) {
        const list = Array.isArray(species) ? species : [species];
        const flora = globalThis.bro && globalThis.bro.flora;
        rec = list.length && flora && typeof flora.herbRecords === 'function' ? flora.herbRecords(list)
                                                                              : new Float32Array(0);
    }
    const n = Math.min(Math.floor(rec.length / RECORD), MAX);
    const data = new Float32Array((MEAN_AT + MEAN_STEPS * 3) * 4);
    data[0] = n;
    data.set(rec.subarray(0, n * RECORD), 4);
    meanTable(rec, n, swardHeight, data, MEAN_AT * 4);
    let height = 0;
    for (let i = 0; i < n; i++) height = Math.max(height, rec[i * RECORD + 1]);
    return { source: SOURCE, data, height };
}

// The herbs' mean over their colonies, by the canopy (stand.glsl.js
// herbFarMean reads it): at each of MEAN_STEPS canopies, over every set of
// species whose colonies overlap a point (each inside its own with its
// patchCover's chance),
//   0  x the exponent of their cover from above where any grow, yzw their
//      leaves' mean colour
//   1  x their blooms' share of that cover, yzw the blooms' mean colour
//   2  x their side silhouette a cell where any grow, y the blooms' share
//      of it, z the chance any grow, w their leaves' mean top
// Seen across, the grass hides what of the herbs stands lower than its top
// (its blades arch: about 0.7 of their length up): a leaf's side as far as
// its leaves' top rises over it, a bloom as it stands over it.
function meanTable(rec, n, swardHeight, out, at) {
    if (n <= 0) return;
    const cellArea = CELL * CELL;
    const sward = 0.7 * Math.max(swardHeight, 0.01);
    const clamp = (v, a, b) => Math.min(Math.max(v, a), b);
    for (let step = 0; step < MEAN_STEPS; step++) {
        const canopy = step / (MEAN_STEPS - 1);
        // A species' weight inside a colony, its ground per plant, its
        // chance of being inside one; its side silhouette per cell and its
        // blooms' share of that.
        const w = [], a = [], bs = [], p = [], sa = [], sbs = [];
        for (let i = 0; i < n; i++) {
            const r = rec.subarray(i * RECORD, (i + 1) * RECORD);
            const dl = (canopy - r[36]) / Math.max(r[37], 0.05);
            let light = Math.exp(-dl * dl);
            if (light < 0.03) light = 0;
            const spacing = r[48] > 0 ? r[48] : 1.6 * Math.max(r[2], 0.02);
            const occupy = Math.min(1, (CELL / spacing) * (CELL / spacing));
            w[i] = r[38] > 0 ? r[38] * light * occupy : 0;
            const foot = Math.PI * r[2] * r[2] / cellArea;
            a[i] = w[i] * r[42] * foot;
            const side = w[i] * Math.max(r[49], 0) * foot;
            const sideBloom = side * clamp(r[50], 0, 1);
            const leafOver = clamp(1 - sward / Math.max(r[51], 0.01), 0, 1);
            const bloomOver = clamp((r[1] - 0.6 * sward) / (0.8 * sward), 0, 1);
            sa[i] = (side - sideBloom) * leafOver + sideBloom * bloomOver;
            bs[i] = clamp(r[41], 0, 1);
            sbs[i] = sa[i] > 0 ? sideBloom * bloomOver / sa[i] : 0;
            p[i] = clamp(r[40], 0, 1);
        }
        let expo = 0, coverW = 0, bloomW = 0, present = 0, sideX = 0, sideBloomX = 0, top = 0, leafW = 0;
        const leaf = [0, 0, 0], bloom = [0, 0, 0];
        for (let set = 0; set < (1 << n); set++) {
            let prob = 1, sum = 0, area = 0, leafA = 0, bloomA = 0, side = 0, sideB = 0, hgt = 0;
            const lc = [0, 0, 0], bc = [0, 0, 0];
            for (let i = 0; i < n; i++) {
                const inside = (set >> i) & 1;
                prob *= inside ? p[i] : 1 - p[i];
                if (!inside || w[i] <= 0) continue;
                const o = i * RECORD;
                sum += w[i];
                area += a[i];
                side += sa[i];
                sideB += sa[i] * sbs[i];
                hgt += w[i] * rec[o + 51];
                leafA += a[i] * (1 - bs[i]);
                bloomA += a[i] * bs[i];
                for (let c = 0; c < 3; c++) {
                    lc[c] += a[i] * (1 - bs[i]) * rec[o + 16 + c];
                    bc[c] += a[i] * bs[i] * rec[o + 28 + c];
                }
            }
            if (prob <= 0) continue;
            if (sum <= 0) { expo += prob; continue; }
            // The cover at full density (exp of minus it, averaged: the
            // exponent stands for the mean cover, not the mean exponent).
            const k = Math.min(sum, 1) / sum;
            const x = k * area;
            const cover = 1 - Math.exp(-x);
            expo += prob * Math.exp(-x);
            coverW += prob * cover;
            // Seen from the side, where any herbs grow (the colonies' share
            // of the ground caps what a grazing view can see of them).
            present += prob;
            sideX += prob * k * side;
            sideBloomX += prob * k * sideB;
            top += prob * hgt / sum;
            if (area <= 0) continue;
            const share = bloomA / area;
            bloomW += prob * cover * share;
            leafW += prob * cover * (1 - share);
            for (let c = 0; c < 3; c++) {
                if (leafA > 0) leaf[c] += prob * cover * (1 - share) * lc[c] / leafA;
                if (bloomA > 0) bloom[c] += prob * cover * share * bc[c] / bloomA;
            }
        }
        const o = at + step * MEAN_FLOATS;
        // From above: the effective exponent where they grow, so that
        // present x (1 - exp(-it)) is the mean cover.
        const inside = present > 1e-6 ? Math.min((1 - expo) / present, 0.999) : 0;
        out[o] = -Math.log(1 - inside);
        for (let c = 0; c < 3; c++) {
            out[o + 1 + c] = leafW > 0 ? leaf[c] / leafW : 0;
            out[o + 5 + c] = bloomW > 0 ? bloom[c] / bloomW : 0;
        }
        out[o + 4] = coverW > 0 ? bloomW / coverW : 0;
        out[o + 8] = present > 1e-6 ? sideX / present : 0;
        out[o + 9] = sideX > 1e-9 ? sideBloomX / sideX : 0;
        out[o + 10] = present;
        out[o + 11] = present > 1e-6 ? top / present : 0;
    }
}
