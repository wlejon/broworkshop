// What the sim worker and the page must agree on: the world box, the two
// species, the leaf / bloom geometry and the foliage placement. The GPU
// scatter node rebuilds each leaf's transform in the vertex shader from the
// same placement parameters the worker emitted with, so they live here once.

export const WORLD_SIZE = 16;      // metres; the ground is [-8, 8] x [-8, 8]
export const GRID_RES = 16;        // shadow grid cells per side
export const GRID_CELL = WORLD_SIZE / GRID_RES;
export const GRID_HEIGHT = 16;     // cells tall

// `flag` is what plant snapshots carry per plant (0 sun, 1 shade).
export const SPECIES = {
    sun: {
        flag: 0, color: [0.55, 0.78, 0.32],
        species: { shadeTolerance: 0.35, moduleMatureAge: 0.6, tropismG2: 0.12,
                   growthScale: 1.0, orthotropy: 0.4, rootVigorMax: 2.5,
                   apicalControl: 0.35, apicalControlMature: 0.3,
                   individualVariation: 0.18, maxAge: 60, seedingRadius: 0.0 },
    },
    shade: {
        flag: 1, color: [0.30, 0.62, 0.45],
        species: { shadeTolerance: 0.65, moduleMatureAge: 0.7, tropismG2: 0.12,
                   growthScale: 0.8, orthotropy: 0.48, rootVigorMax: 2.0,
                   apicalControl: 0.30, apicalControlMature: 0.3,
                   individualVariation: 0.16, maxAge: 70, seedingRadius: 0.0 },
    },
};

/** Species key for a plant's shadeTolerance (the flag the snapshots carry). */
export const speciesOf = (shadeTolerance) => (shadeTolerance >= 0.6 ? 'shade' : 'sun');

/** The branching prototypes: monopodial (sun), sympodial, a low tuft. */
export function prototypes() {
    const P = bro.flora.prototypes;
    return {
        mono: P.monopodial ? P.monopodial(3, 0.7) : P.whorl(5, 0.8),
        symp: P.sympodial ? P.sympodial(0.3, 0.75) : P.whorl(4, 0.7),
        tuft: P.whorl(3, 0.55),
    };
}

// Leaf placement along the twigs (emitScatterSegments / the scatter node).
export const FOLIAGE = {
    maxRadius: 0.035, minDepth: 2, perUnitLength: 120,
    upBias: 0.7, tiltJitter: 0.55, rollJitter: 0.9,
    baseScale: 1.0, scaleJitter: 0.3, scaleByRadius: 0.25, seed: 0x1eaf,
};

export const TUBE = { sides: 6, radiusScale: 1.0 };
export const BLOOM_CAP = 120;

export function leafCard() {
    return Mesh.leafCard('oval', {
        width: 0.13, length: 0.23, bend: 0.45,
        fullUV: true, shapedSilhouette: true, cup: 0.3,
        widthSegments: 3, lengthSegments: 6,
    });
}

// Leaf cards and flowers bake a wind-bend weight into vertex colours; with
// the colours gone the flat material colour shows.
export function stripVertexColors(mesh) {
    if (mesh) mesh.colors = new Float32Array(0);
    return mesh;
}

/** The bloom stamp: a five-petal flower and its golden eye. */
export function bloomBases() {
    const petals = stripVertexColors(Mesh.flower({
        petalCount: 5, petalShape: 'petal',
        petalLength: 0.13, petalWidth: 0.085, petalBend: 0.4,
        petalCup: 0.22, shapedPetals: true,
        outerTilt: -0.15, innerTilt: -0.12,
        centerRadius: 0.03, centerHeight: 0.02,
    }));
    const center = Mesh.sphere(0.03, 8, 6);
    center.scale(1, 0.5, 1);
    return { petals, center: stripVertexColors(center) };
}

/** A broflora world over the meadow box. */
export function createWorld(seed) {
    return bro.flora.createWorld({
        rngSeed: seed,
        climate: { annualTempBase: 15, annualPrecip: 1000 },
        shadow: {
            origin: [-WORLD_SIZE * 0.5, 0, -WORLD_SIZE * 0.5],
            cellSize: GRID_CELL, width: GRID_RES, height: GRID_HEIGHT, depth: GRID_RES, fill: 1.0,
        },
    });
}
