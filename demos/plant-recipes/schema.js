// Parameter schemas: which controls each archetype shows, their ranges and
// defaults, and the panel group each lives in. A species preset overrides
// the defaults for the keys it names (lab.js).

import { ARCHETYPES, CANOPY_SHAPES } from "/app/recipes/index.js";

const f2 = (v) => (+v).toFixed(2);
const f3 = (v) => (+v).toFixed(3);

// Compact constructors: range, integer, select, colour.
const R = (key, label, min, max, step, def, group, fmt = f2) => ({ key, label, type: 'range', min, max, step, default: def, group, fmt });
const I = (key, label, min, max, def, group) => ({ key, label, type: 'int', min, max, default: def, group });
const S = (key, label, options, def, group) => ({ key, label, type: 'select', options, default: def, group });
const C = (key, label, def, group) => ({ key, label, type: 'color', default: def, group });

export const ARCHETYPE_SCHEMA = {
    tree: [
        R('height', 'height', 1.5, 80, 0.5, 6, 'general'),
        R('trunkRadius', 'trunk radius', 0.05, 4, 0.05, 0.18, 'general'),
        R('canopyRadius', 'canopy radius', 0.5, 25, 0.2, 3, 'general'),
        S('canopyShape', 'canopy shape', CANOPY_SHAPES, 'round', 'general'),
        I('blobCount', 'blob count', 1, 7, 3, 'advanced'),
        C('canopyColor', 'canopy color', '#4f8c39', 'appearance'),
        C('trunkColor', 'trunk color', '#6b4828', 'appearance'),
        S('leafShape', 'leaf shape', ['oval', 'pointed', 'lobed', 'frond', 'needle'], 'oval', 'appearance'),
        S('foliageStyle', 'foliage style', ['blobs', 'leaves'], 'leaves', 'appearance'),
        C('bloomColor', 'bloom color', '#f7c8d8', 'lifecycle'),
        C('fruitColor', 'fruit color', '#a01030', 'lifecycle'),
    ],
    conifer: [
        R('height', 'height', 2, 110, 0.5, 8, 'general'),
        R('trunkRadius', 'trunk radius', 0.04, 4, 0.05, 0.15, 'general'),
        I('layers', 'cone layers', 3, 16, 7, 'general'),
        R('baseCanopyRadius', 'base radius', 0.5, 18, 0.2, 2.5, 'general'),
        S('coneShape', 'cone shape', ['soft', 'sharp', 'tight', 'spreading', 'columnar'], 'soft', 'general'),
        C('canopyColor', 'needle color', '#2e6633', 'appearance'),
        C('trunkColor', 'trunk color', '#5a3e22', 'appearance'),
    ],
    shrub: [
        R('height', 'height', 0.4, 3, 0.05, 1.5, 'general'),
        R('radius', 'radius', 0.3, 2.5, 0.05, 1.2, 'general'),
        I('blobCount', 'blob count', 2, 9, 5, 'general'),
        C('canopyColor', 'canopy color', '#52943d', 'appearance'),
        C('bloomColor', 'bloom color', '#df3a51', 'lifecycle'),
        C('fruitColor', 'fruit color', '#cc1418', 'lifecycle'),
    ],
    grassTuft: [
        I('bladeCount', 'blades', 3, 30, 12, 'general'),
        R('height', 'height', 0.1, 2, 0.02, 0.4, 'general'),
        R('baseRadius', 'base radius', 0.02, 0.4, 0.01, 0.08, 'general'),
        R('bladeWidth', 'blade width', 0.005, 0.04, 0.001, 0.012, 'general', f3),
        R('bend', 'bend', 0, 1.5, 0.05, 0.6, 'general'),
        C('color', 'color', '#5e9e36', 'appearance'),
        C('plumeColor', 'plume color', '#d8c89f', 'lifecycle'),
    ],
    vine: [
        R('length', 'length', 1, 12, 0.2, 6, 'general'),
        R('radius', 'stem radius', 0.01, 0.15, 0.005, 0.04, 'general', f3),
        R('helixRadius', 'helix radius', 0.1, 1.5, 0.05, 0.5, 'general'),
        R('turns', 'turns', 0.5, 8, 0.25, 3, 'general'),
        C('leafColor', 'leaf color', '#56822a', 'appearance'),
        C('bloomColor', 'bloom color', '#c4a8e6', 'lifecycle'),
        C('fruitColor', 'fruit color', '#3a1a4a', 'lifecycle'),
    ],
    fern: [
        I('leafletPairs', 'leaflet pairs', 4, 30, 14, 'general'),
        R('length', 'length', 0.5, 3, 0.1, 1.5, 'general'),
        R('stemRadius', 'stem radius', 0.005, 0.04, 0.001, 0.012, 'general', f3),
        R('leafletLength', 'leaflet len', 0.1, 0.7, 0.02, 0.32, 'general'),
        R('curvature', 'curvature', 0.2, 3, 0.1, 1.4, 'general'),
        C('leafColor', 'leaf color', '#3e6a2c', 'appearance'),
    ],
    succulent: [
        I('leafCount', 'leaf count', 5, 80, 24, 'general'),
        R('leafLength', 'leaf length', 0.1, 1.0, 0.02, 0.35, 'general'),
        R('leafWidth', 'leaf width', 0.02, 0.18, 0.005, 0.06, 'general', f3),
        R('leafThickness', 'leaf thick', 0.005, 0.06, 0.002, 0.02, 'general', f3),
        R('tilt', 'tilt', 0, 1.4, 0.05, 0.6, 'general'),
        C('color', 'leaf color', '#5a8e6a', 'appearance'),
        C('flowerColor', 'flower color', '#fbcd5a', 'lifecycle'),
    ],
    flower: [
        R('stemLength', 'stem length', 0.2, 1.6, 0.05, 0.9, 'general'),
        R('stemRadius', 'stem radius', 0.005, 0.05, 0.001, 0.012, 'general', f3),
        R('headSize', 'head size', 0.05, 0.6, 0.01, 0.18, 'general'),
        I('petalCount', 'petal count', 3, 24, 8, 'general'),
        I('layers', 'petal layers', 1, 5, 1, 'general'),
        S('petalShape', 'petal shape', ['petal', 'oval', 'pointed', 'lobed'], 'petal', 'general'),
        R('petalBend', 'petal bend', -1, 1, 0.05, 0.5, 'advanced'),
        R('petalCurl', 'petal curl', 0, 0.6, 0.02, 0.10, 'advanced'),
        C('petalColor', 'petal color', '#ea527a', 'appearance'),
        C('centerColor', 'center color', '#ffd233', 'appearance'),
        C('stemColor', 'stem color', '#3d6e22', 'appearance'),
    ],
    rosebush: [
        R('bushHeight', 'bush height', 0.3, 3.0, 0.05, 1.0, 'general'),
        R('bushRadius', 'bush radius', 0.2, 2.0, 0.05, 0.8, 'general'),
        I('canes', 'canes', 1, 8, 4, 'general'),
        I('attractorCount', 'branch density', 30, 240, 90, 'advanced'),
        I('petalCount', 'petal count', 5, 24, 12, 'general'),
        I('bloomLayers', 'bloom layers', 1, 6, 4, 'general'),
        C('petalColor', 'petal color', '#d11f3a', 'appearance'),
        C('leafColor', 'leaf color', '#2c5328', 'appearance'),
        C('stemColor', 'stem color', '#5a3e22', 'appearance'),
        C('thornColor', 'thorn color', '#5a3820', 'appearance'),
        R('petalBend', 'petal bend', 0, 1, 0.05, 0.55, 'advanced'),
        R('petalCurl', 'petal curl', 0, 0.6, 0.02, 0.30, 'advanced'),
        C('hipColor', 'hip color', '#b81818', 'lifecycle'),
    ],
    cactus: [
        S('shape', 'shape', ['barrel', 'pricklyPear', 'saguaro', 'hedgehog'], 'barrel', 'general'),
        R('height', 'height', 0.2, 8, 0.05, 1.2, 'general'),
        R('radius', 'radius', 0.1, 1.0, 0.02, 0.45, 'general'),
        I('ribs', 'ribs (barrel)', 6, 24, 14, 'advanced'),
        I('pads', 'pads (pear)', 1, 12, 4, 'advanced'),
        I('arms', 'arms (saguaro)', 0, 6, 2, 'advanced'),
        C('color', 'body color', '#4a7d3a', 'appearance'),
        C('flowerColor', 'flower color', '#fbcd3a', 'lifecycle'),
        C('fruitColor', 'fruit color', '#c45a4e', 'lifecycle'),
    ],
    palm: [
        R('height', 'height', 1.5, 16, 0.2, 7, 'general'),
        R('trunkRadius', 'trunk radius', 0.05, 0.5, 0.01, 0.18, 'general'),
        I('fronds', 'fronds', 4, 24, 12, 'general'),
        R('frondLength', 'frond length', 0.5, 3.5, 0.1, 2.2, 'general'),
        C('trunkColor', 'trunk color', '#7a5a3c', 'appearance'),
        C('frondColor', 'frond color', '#3a6a2a', 'appearance'),
        C('fruitColor', 'fruit color', '#5e3a18', 'lifecycle'),
    ],
};

export const ARCHETYPE_NAMES = Object.keys(ARCHETYPES);

// The rows above the groups, in both modes.
export const COMMON_SCHEMA = [
    S('archetype', 'type', ARCHETYPE_NAMES, 'tree', 'top'),
    S('species', 'species', [], '', 'top'),
    R('age', 'age', 0, 1, 0.005, 1, 'top'),
    I('seed', 'seed', 0, 99999, 1, 'top'),
];

export const FOREST_SCHEMA = [
    S('speciesMix', 'mix', ['single', 'mixed-genus', 'random'], 'mixed-genus', 'top'),
    I('count', 'count', 1, 250, 32, 'forest'),
    R('patchSize', 'patch size', 6, 300, 1, 60, 'forest'),
    R('jitter', 'packing', 0, 1, 0.02, 0.55, 'forest'),
    R('sharing', 'canopy sharing', 0, 1, 0.02, 0.85, 'forest'),
    R('canopyGap', 'canopy gap', 0, 2, 0.05, 0.4, 'forest'),
    R('maxCanopyR', 'max canopy R', 1, 25, 0.2, 9, 'forest'),
    R('baseHeight', 'tree height', 2, 60, 0.5, 14, 'forest'),
    R('baseTrunkR', 'trunk radius', 0.05, 3, 0.05, 0.45, 'forest'),
    R('sizeJitter', 'size jitter', 0, 1, 0.02, 0.45, 'forest'),
    S('shapeMix', 'shape mix', ['round-only', 'broadleaf-mix', 'all-shapes'], 'broadleaf-mix', 'forest'),
    R('ageJitter', 'age jitter', 0, 0.6, 0.02, 0.15, 'forest'),
];

/** Panel groups in order: [name, caption, open by default]. */
export const GROUPS = [
    ['general', 'General', true], ['lifecycle', 'Life cycle', true], ['appearance', 'Appearance', false],
    ['advanced', 'Advanced', false], ['forest', 'Forest', true],
];

/** The rows shown for `mode` ('single' | 'forest') and archetype. */
export function schemaFor(mode, archetype) {
    return mode === 'single'
        ? COMMON_SCHEMA.concat(ARCHETYPE_SCHEMA[archetype] || [])
        : COMMON_SCHEMA.concat(FOREST_SCHEMA);
}

/** A kit params() spec entry for a schema row. */
export function toSpec(row) {
    if (row.type === 'range') return { label: row.label, min: row.min, max: row.max, step: row.step, fmt: row.fmt };
    if (row.type === 'int') return { label: row.label, type: 'number', step: 1 };
    if (row.type === 'select') return { label: row.label, options: row.options };
    return { label: row.label, type: 'color' };
}
