// Forest layout: place `count` plants on a square patch with Poisson-style
// rejection (largest canopies first), then pack the canopies Voronoi-style —
// each crown shrinks toward the gap its neighbours leave (crown shyness) and
// leans toward open sky. Pure: returns plant descriptors, draws nothing.

import { speciesList, CANOPY_SHAPES } from "/app/recipes/index.js";
import { FloraCore } from "/app/recipes/core.js";

const { mulberry32 } = FloraCore;

// Archetypes that take the forest's size sliders and canopy packing.
export const TREE_LIKE = new Set(['tree', 'conifer', 'shrub', 'rosebush']);
const BROADLEAF_SHAPES = ['round', 'oval', 'umbrella', 'vase', 'spreading', 'irregular', 'weeping'];

function pickShape(rng, mix) {
    if (mix === 'round-only') return 'round';
    const list = mix === 'all-shapes' ? CANOPY_SHAPES : BROADLEAF_SHAPES;
    return list[(rng() * list.length) | 0];
}

function pickSpecies(archetype, mix, rng, pinned) {
    const list = speciesList(archetype);
    if (list.length === 0) return '';
    if (mix === 'single') return pinned || list[0];
    return list[(rng() * list.length) | 0];
}

// Rejection-sample positions for descending canopy radii.
function place(s, maxR, useForestSize) {
    const count = Math.max(1, s.count | 0);
    const rng = mulberry32((s.seed | 0) * 7919);
    const gap = s.canopyGap + maxR * 0.05;
    const minDesired = useForestSize ? 0.45 : 0.7;
    const desired = [];
    for (let i = 0; i < count; i++) {
        const sizeFrac = 1 - Math.pow(rng(), 1.4) * (1 - minDesired);
        const sjit = 1 + (rng() - 0.5) * s.sizeJitter * 0.5;
        desired.push(Math.max(0.4, maxR * sizeFrac * sjit));
    }
    desired.sort((a, b) => b - a);
    const overlapAllow = 0.7 + s.jitter * 0.25;
    const pos = [], radii = [];
    for (const r of desired) {
        for (let attempt = 0; attempt < 40; attempt++) {
            const x = (rng() - 0.5) * s.patchSize, z = (rng() - 0.5) * s.patchSize;
            let ok = true;
            for (let i = 0; i < pos.length && ok; i++) {
                const d = Math.hypot(x - pos[i][0], z - pos[i][1]);
                if (d < (r + radii[i]) * overlapAllow + gap) ok = false;
            }
            if (ok) { pos.push([x, z]); radii.push(r); break; }
        }
    }
    return { pos, radii };
}

// Shrink each canopy toward the room its neighbours leave, then lean it away
// from them. Mutates canopyRadius / shiftX / shiftZ / asym.
function packCanopies(trees, gapWidth, sharing) {
    const minR = 0.3;
    const cur = trees.map((t) => t.desiredR);
    for (let iter = 0; iter < 6; iter++) {
        const next = trees.map((t, i) => {
            let avail = Infinity;
            for (let j = 0; j < trees.length; j++) {
                if (i === j) continue;
                avail = Math.min(avail, Math.hypot(t.x - trees[j].x, t.z - trees[j].z) - cur[j] - gapWidth);
            }
            if (!isFinite(avail)) avail = t.desiredR;
            return Math.max(minR, Math.min(t.desiredR, avail));
        });
        for (let i = 0; i < trees.length; i++) cur[i] += (next[i] - cur[i]) * 0.7;
    }
    for (let i = 0; i < trees.length; i++) {
        trees[i].canopyRadius = Math.max(minR, trees[i].desiredR + (cur[i] - trees[i].desiredR) * sharing);
    }
    for (const t of trees) {
        let lx = 0, lz = 0, w = 0;
        for (const o of trees) {
            if (o === t) continue;
            const dx = t.x - o.x, dz = t.z - o.z, d = Math.hypot(dx, dz);
            const reach = (t.canopyRadius + o.canopyRadius) * 1.4;
            if (d <= 1e-3 || d >= reach) continue;
            const wt = 1 - d / reach;
            lx += (dx / d) * wt; lz += (dz / d) * wt; w += wt;
        }
        const llen = Math.hypot(lx, lz);
        if (llen > 1e-6 && w > 0) {
            const mag = t.canopyRadius * 0.18 * sharing;
            t.shiftX = (lx / llen) * mag;
            t.shiftZ = (lz / llen) * mag;
            t.asym = sharing * 0.6 * Math.min(1, w);
        }
    }
}

/**
 * Lay out a forest of `archetype` from the forest state (count, patchSize,
 * jitter, sharing, canopyGap, maxCanopyR, baseHeight, baseTrunkR, sizeJitter,
 * shapeMix, speciesMix, ageJitter, age, seed, species). Returns
 * [{ x, z, opts }] where opts goes straight to the recipe.
 */
export function layoutForest(archetype, s) {
    const forestSize = TREE_LIKE.has(archetype);
    const baseHeight = forestSize ? s.baseHeight : 4;
    const baseTrunk = forestSize ? s.baseTrunkR : 0.18;
    const maxR = forestSize ? s.maxCanopyR : 1.5;
    const baseSeed = s.seed | 0;
    const { pos, radii } = place(s, maxR, forestSize);

    const trees = pos.map((p, i) => {
        const r = mulberry32(baseSeed * 31 + i * 1009 + 17);
        const corrH = 0.55 + 0.45 * radii[i] / Math.max(0.001, maxR);
        const heightK = corrH * (1 + (r() - 0.5) * s.sizeJitter * 0.4);
        const trunkK = corrH * (1 + (r() - 0.5) * s.sizeJitter * 0.3);
        const species = pickSpecies(archetype, s.speciesMix || 'mixed-genus', r, s.species);
        return {
            x: p[0], z: p[1],
            height: Math.max(0.5, baseHeight * heightK),
            trunkRadius: Math.max(0.03, baseTrunk * trunkK),
            desiredR: radii[i], canopyRadius: radii[i],
            shape: pickShape(r, s.shapeMix),
            blobCount: 2 + ((r() * 4) | 0),
            seed: (baseSeed * 17 + i * 113 + 1) | 0,
            colorJ: r(),   // drawn to keep the seed -> forest mapping; not applied
            shiftX: 0, shiftZ: 0, asym: 0,
            species,
            age01: Math.max(0, Math.min(1, s.age + (r() - 0.5) * (s.ageJitter ?? 0) * 2)),
        };
    });
    if (forestSize && trees.length > 1) packCanopies(trees, s.canopyGap, s.sharing);

    return trees.map((t) => ({
        x: t.x, z: t.z,
        opts: {
            seed: t.seed, age01: t.age01, species: t.species,
            height: t.height, trunkRadius: t.trunkRadius,
            canopyRadius: t.canopyRadius, canopyShape: t.shape, blobCount: t.blobCount,
            canopyShift: [t.shiftX, 0, t.shiftZ], canopyAsymmetry: t.asym,
            radius: t.canopyRadius, bushHeight: t.height * 0.5, bushRadius: t.canopyRadius,
        },
    }));
}
