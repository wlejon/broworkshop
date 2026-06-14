// Species presets per archetype. A species is a partial parameter object
// merged on top of archetype defaults at recipe entry. The UI exposes a
// "species" dropdown populated from the keys of `Species[archetype]`.
//
// Keep these decorative-only — geometry shapes live in the recipes.

import { FloraCore } from "/app/recipes/core.js";

const C = FloraCore.PALETTE;

export const Species = {
    tree: {
        oak:     { canopyShape: 'spreading', canopyColor: '#3d6e26', trunkRadius: 0.22, leafShape: 'lobed',
                   senescentTint: 0.7, senescentPhase: 0.55, bloomColor: null },
        maple:   { canopyShape: 'round',     canopyColor: '#4a7a25', leafShape: 'lobed',
                   senescentTint: 0.85, senescentPhase: 0.85, bloomColor: null },
        birch:   { canopyShape: 'oval',      canopyColor: '#6fa336', leafShape: 'oval',
                   trunkColor: '#d8d4c4', senescentTint: 0.7, senescentPhase: 0.05, bloomColor: null },
        willow:  { canopyShape: 'weeping',   canopyColor: '#7aa44c', leafShape: 'pointed',
                   senescentTint: 0.55, senescentPhase: 0.10, bloomColor: null },
        cherry:  { canopyShape: 'round',     canopyColor: '#5b8a30', leafShape: 'oval',
                   bloomShape: 'petal', bloomColor: '#f7c8d8', bloomDensity: 1.0, bloomLayers: 2,
                   fruitColor: '#a01030', fruitRadius: 0.05,
                   senescentTint: 0.7, senescentPhase: 0.55 },
        ginkgo:  { canopyShape: 'umbrella',  canopyColor: '#8fae3a', leafShape: 'lobed',
                   senescentTint: 0.95, senescentPhase: 0.05, bloomColor: null },
        poplar:  { canopyShape: 'columnar',  canopyColor: '#5e8e36', leafShape: 'oval',
                   senescentTint: 0.7, senescentPhase: 0.30, bloomColor: null },
        baobab:  { canopyShape: 'umbrella',  canopyColor: '#7a9a3a', trunkRadius: 1.2, canopyRadius: 8,
                   leafShape: 'lobed', senescentTint: 0.5, senescentPhase: 0.55, bloomColor: null },
        magnolia:{ canopyShape: 'round',     canopyColor: '#3f6f30', leafShape: 'oval',
                   bloomShape: 'petal', bloomColor: '#f7e8ee', bloomDensity: 0.85, bloomLayers: 3,
                   bloomRadius: 0.18, fruitColor: '#9c2810', fruitRadius: 0.06,
                   senescentTint: 0.6, senescentPhase: 0.5 },
        jacaranda:{canopyShape: 'spreading', canopyColor: '#5b7e2c', leafShape: 'pointed',
                   bloomShape: 'petal', bloomColor: '#7e6cd6', bloomDensity: 1.0, bloomLayers: 2,
                   senescentTint: 0.5, senescentPhase: 0.3 },
    },
    conifer: {
        pine:    { canopyColor: '#2f5a30', layers: 7, baseCanopyRadius: 2.5, coneShape: 'soft' },
        spruce:  { canopyColor: '#274d2a', layers: 9, baseCanopyRadius: 2.2, coneShape: 'sharp' },
        fir:     { canopyColor: '#2a5238', layers: 8, baseCanopyRadius: 2.4, coneShape: 'tight' },
        cedar:   { canopyColor: '#3a5a30', layers: 6, baseCanopyRadius: 3.0, coneShape: 'spreading' },
        juniper: { canopyColor: '#3f5d3a', layers: 5, baseCanopyRadius: 1.8, coneShape: 'soft' },
        redwood: { canopyColor: '#26492a', layers: 12, baseCanopyRadius: 4.5, coneShape: 'sharp',
                   trunkRadius: 1.0, height: 60 },
        cypress: { canopyColor: '#33502c', layers: 14, baseCanopyRadius: 1.4, coneShape: 'columnar' },
    },
    rosebush: {
        tea:        { stemColor: '#5e3d28', leafColor: '#2b4f24', petalColor: '#d11f3a',
                      bushHeight: 1.0, bushRadius: 0.8, bloomLayers: 4, petalCount: 12 },
        climbing:   { stemColor: '#6b4528', leafColor: '#365829', petalColor: '#e25578',
                      bushHeight: 2.4, bushRadius: 1.2, bloomLayers: 3, petalCount: 10 },
        shrub:      { stemColor: '#574028', leafColor: '#2f5128', petalColor: '#f47ab1',
                      bushHeight: 1.4, bushRadius: 1.4, bloomLayers: 3, petalCount: 8 },
        miniature:  { stemColor: '#5e4028', leafColor: '#2f4d24', petalColor: '#fbb1c7',
                      bushHeight: 0.55, bushRadius: 0.45, bloomLayers: 3, petalCount: 8,
                      bloomScale: 0.65 },
        wild:       { stemColor: '#6b4e2c', leafColor: '#2c4d22', petalColor: '#fbe6c8',
                      bushHeight: 1.6, bushRadius: 1.6, bloomLayers: 1, petalCount: 5,
                      petalCurl: 0.05, petalBend: 0.2 },
    },
    flower: {
        daisy:    { petalColor: '#fafbf2', centerColor: '#f3c218', petalCount: 14, layers: 1,
                    petalShape: 'oval', stemHeightMul: 1.0, headSizeMul: 1.0,
                    petalBend: 0.25, petalCurl: 0.05 },
        sunflower:{ petalColor: '#fbc842', centerColor: '#5b3010', petalCount: 22, layers: 1,
                    petalShape: 'pointed', stemHeightMul: 1.6, headSizeMul: 2.4,
                    petalBend: 0.55, petalCurl: 0.0 },
        tulip:    { petalColor: '#d62a31', centerColor: '#3d3010', petalCount: 6,  layers: 1,
                    petalShape: 'petal', stemHeightMul: 1.1, headSizeMul: 1.1,
                    petalBend: -0.4, petalCurl: 0.15 },
        lily:     { petalColor: '#fbeacd', centerColor: '#aa6612', petalCount: 6, layers: 1,
                    petalShape: 'pointed', stemHeightMul: 1.3, headSizeMul: 1.3,
                    petalBend: -0.3, petalCurl: 0.25 },
        poppy:    { petalColor: '#dc2a26', centerColor: '#181410', petalCount: 4, layers: 1,
                    petalShape: 'petal', stemHeightMul: 1.2, headSizeMul: 1.0,
                    petalBend: 0.45, petalCurl: 0.10 },
        daffodil: { petalColor: '#f7d128', centerColor: '#f08a14', petalCount: 6, layers: 2,
                    petalShape: 'pointed', stemHeightMul: 1.0, headSizeMul: 0.9,
                    petalBend: 0.30, petalCurl: 0.20 },
        cosmos:   { petalColor: '#f070ad', centerColor: '#f3c218', petalCount: 8, layers: 1,
                    petalShape: 'oval', stemHeightMul: 1.4, headSizeMul: 1.0,
                    petalBend: 0.20, petalCurl: 0.05 },
    },
    cactus: {
        barrel:     { color: '#4a7d3a', shape: 'barrel',     ribs: 14, height: 1.2, radius: 0.45,
                      flowerColor: '#fbcd3a' },
        pricklyPear:{ color: '#52823a', shape: 'pricklyPear', pads: 4, padW: 0.6, padH: 0.7,
                      flowerColor: '#f6921a' },
        saguaro:    { color: '#3e6c33', shape: 'saguaro',    height: 4.0, radius: 0.35, arms: 2,
                      flowerColor: '#f7eedd' },
        hedgehog:   { color: '#4f7c3a', shape: 'hedgehog',   height: 0.32, radius: 0.30,
                      flowerColor: '#e94f8a' },
    },
    palm: {
        coconut: { trunkColor: '#7a5a3c', frondColor: '#3a6a2a', height: 7,  fronds: 12, fruitColor: '#5e3a18', fruitRadius: 0.16 },
        date:    { trunkColor: '#6c4a2a', frondColor: '#476f28', height: 8,  fronds: 14, fruitColor: '#a04514', fruitRadius: 0.05 },
        fan:     { trunkColor: '#705840', frondColor: '#3f6a32', height: 5,  fronds: 10, fronShape: 'fan',
                   fruitColor: null },
    },
    shrub: {
        boxwood:   { canopyColor: '#3f6a30', height: 1.0, radius: 1.0, blobCount: 6 },
        lavender:  { canopyColor: '#7a8a4a', height: 0.7, radius: 0.6, blobCount: 4,
                     bloomShape: 'pointed', bloomColor: '#9072c8', bloomDensity: 1.0 },
        hydrangea: { canopyColor: '#3f6f3a', height: 1.4, radius: 1.4, blobCount: 6,
                     bloomShape: 'petal', bloomColor: '#90a4d6', bloomDensity: 0.95, bloomLayers: 3,
                     bloomRadius: 0.18 },
        holly:     { canopyColor: '#22512a', height: 1.6, radius: 1.2, blobCount: 7,
                     fruitColor: '#cc1418', fruitRadius: 0.04 },
        hibiscus:  { canopyColor: '#3a6e36', height: 1.6, radius: 1.4, blobCount: 5,
                     bloomShape: 'petal', bloomColor: '#df3a51', bloomDensity: 0.85, bloomLayers: 1,
                     petalCount: 5, bloomRadius: 0.18 },
    },
    fern: {
        sword:      { stemColor: '#3a5a26', leafColor: '#345a26', leafletPairs: 16, length: 1.8, leafletLength: 0.30, curvature: 1.4 },
        lady:       { stemColor: '#3a5a26', leafColor: '#3e6a2c', leafletPairs: 18, length: 1.4, leafletLength: 0.22, curvature: 1.7 },
        ostrich:    { stemColor: '#3a5a26', leafColor: '#3a5828', leafletPairs: 22, length: 2.2, leafletLength: 0.34, curvature: 1.0 },
        maidenhair: { stemColor: '#3a4a26', leafColor: '#5a8a3a', leafletPairs: 12, length: 0.9, leafletLength: 0.18, curvature: 2.0 },
    },
    grassTuft: {
        fescue:    { color: '#3a6e22', height: 0.45, bladeCount: 14, bladeWidth: 0.012, bend: 0.5 },
        ryegrass:  { color: '#4a7e2a', height: 0.55, bladeCount: 10, bladeWidth: 0.014, bend: 0.45 },
        pampas:    { color: '#a89860', height: 1.6, bladeCount: 24, bladeWidth: 0.020, bend: 0.7,
                     plumeColor: '#d8c89f' },
        sedge:     { color: '#456e2a', height: 0.35, bladeCount: 12, bladeWidth: 0.010, bend: 0.6 },
    },
    succulent: {
        echeveria: { color: '#5a8e6a', leafCount: 32, leafLength: 0.32, leafWidth: 0.10, leafThickness: 0.025, tilt: 0.55 },
        agave:     { color: '#7a9a72', leafCount: 18, leafLength: 0.85, leafWidth: 0.10, leafThickness: 0.030, tilt: 0.45 },
        sedum:     { color: '#7aae7a', leafCount: 60, leafLength: 0.18, leafWidth: 0.05, leafThickness: 0.018, tilt: 0.85 },
        aloe:      { color: '#5a8a4a', leafCount: 12, leafLength: 0.95, leafWidth: 0.10, leafThickness: 0.030, tilt: 0.30 },
    },
    vine: {
        ivy:         { canopyColor: '#3a5a26', leafColor: '#3a6a2a', length: 6,  helixRadius: 0.45, turns: 3.5 },
        grape:       { canopyColor: '#4a6a26', leafColor: '#4a7a2a', length: 5,  helixRadius: 0.50, turns: 2.5,
                       fruitColor: '#3a1a4a', fruitRadius: 0.04 },
        morningGlory:{ canopyColor: '#4a7a2a', leafColor: '#4a7a2a', length: 4,  helixRadius: 0.40, turns: 4.0,
                       bloomShape: 'petal', bloomColor: '#7a6cd6', bloomDensity: 0.7 },
        wisteria:    { canopyColor: '#4a6e2a', leafColor: '#56822a', length: 7,  helixRadius: 0.55, turns: 3.0,
                       bloomShape: 'petal', bloomColor: '#c4a8e6', bloomDensity: 1.0, droop: true },
    },
};

function applySpecies(archetype, species, opts) {
    const table = Species[archetype];
    if (!table) return opts;
    const preset = table[species];
    if (!preset) return opts;
    const merged = Object.assign({}, preset, opts);
    // Preserve user overrides — opts wins if it explicitly set the key.
    return merged;
}

function speciesList(archetype) {
    return Object.keys(Species[archetype] || {});
}

export const FloraSpecies = { applySpecies, speciesList };
