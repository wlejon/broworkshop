// Terrain parameters: the defaults, the presets, the material palette, and
// the scene.createTerrain options they make.

export const MESH_MODES = { 0: 'smooth', 1: 'flat-shaded', 2: 'terraced', 3: 'blocky' };

// Material colours as the pickers show them (sRGB hex); id 0 is air.
export const MATERIALS = ['grass', 'dirt', 'stone', 'bedrock', 'sand'];
export const DEFAULT_COLORS = { grass: '#6bb345', dirt: '#85572e', stone: '#8c8c94', bedrock: '#2e2e33', sand: '#dbc77d' };

const BASE = {
    frequency: 0.035, octaves: 5, gain: 0.50, lacunarity: 2.0,
    baseHeight: 18, heightAmplitude: 16, seaLevel: 14, cellSize: 1.0,
    chunkSizeX: 64, chunkSizeY: 48, chunkSizeZ: 64,
    loadRadius: 4, unloadRadius: 6, maxLoadsPerUpdate: 2,
    meshMode: 0, terraceStep: 1.0,
};

export const PRESETS = {
    default:   { label: 'Smooth' },
    lowpoly:   { label: 'Low-Poly', frequency: 0.025, octaves: 4, baseHeight: 24, heightAmplitude: 20, cellSize: 2.0,
                 chunkSizeX: 32, chunkSizeZ: 32, loadRadius: 6, unloadRadius: 8, meshMode: 1 },
    terraced:  { label: 'Terraced', frequency: 0.030, baseHeight: 24, heightAmplitude: 20, seaLevel: 10, meshMode: 2, terraceStep: 2.0 },
    blocky:    { label: 'Blocky', meshMode: 3 },
    mountains: { label: 'Mountains', frequency: 0.020, octaves: 8, gain: 0.55, lacunarity: 2.2,
                 baseHeight: 48, heightAmplitude: 44, seaLevel: 16, chunkSizeY: 96 },
    islands:   { label: 'Islands', frequency: 0.045, octaves: 4, gain: 0.45,
                 baseHeight: 12, heightAmplitude: 14, seaLevel: 18, loadRadius: 5, unloadRadius: 7 },
    flat:      { label: 'Flat Plains', frequency: 0.01, octaves: 2, gain: 0.3, baseHeight: 20, heightAmplitude: 3, seaLevel: 8 },
    alien:     { label: 'Alien', frequency: 0.08, octaves: 6, gain: 0.70, lacunarity: 3.0,
                 baseHeight: 24, heightAmplitude: 20, seaLevel: 6 },
};

/** A preset's full parameter set (every preset is BASE plus its changes). */
export function presetValues(name) {
    const p = Object.assign({}, BASE, PRESETS[name]);
    delete p.label;
    return p;
}

/** The live configuration: parameters, seed and the palette's colours. */
export function defaultConfig() {
    return Object.assign(presetValues('default'), { seed: 1337 }, DEFAULT_COLORS);
}

// The PBR shader wants linear base colours; the pickers are sRGB.
const toLinear = (c) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));

function linearPalette(cfg) {
    const pal = [0, 0, 0, 0];
    for (const m of MATERIALS) {
        const v = parseInt(cfg[m].slice(1), 16);
        pal.push(toLinear((v >> 16 & 255) / 255), toLinear((v >> 8 & 255) / 255), toLinear((v & 255) / 255), 1);
    }
    return pal;
}

/** scene.createTerrain / terrain.configure options for a config. */
export function terrainOptions(cfg) {
    // Columns span baseHeight +/- heightAmplitude cells; grow the chunk's
    // height so peaks never clip at its top.
    const chunkY = Math.max(cfg.chunkSizeY, cfg.baseHeight + cfg.heightAmplitude + 2);
    return {
        chunkSize: [cfg.chunkSizeX, chunkY, cfg.chunkSizeZ],
        cellSize: cfg.cellSize,
        loadRadius: cfg.loadRadius,
        unloadRadius: cfg.unloadRadius,
        maxLoadsPerUpdate: cfg.maxLoadsPerUpdate,
        seed: cfg.seed,
        noise: { frequency: cfg.frequency, octaves: cfg.octaves, gain: cfg.gain, lacunarity: cfg.lacunarity },
        baseHeight: cfg.baseHeight,
        heightAmplitude: cfg.heightAmplitude,
        seaLevel: cfg.seaLevel,
        meshMode: cfg.meshMode,
        terraceStep: cfg.terraceStep,
        palette: linearPalette(cfg),
    };
}
