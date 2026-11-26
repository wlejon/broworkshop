// lib/cad/materials.js — Procedural PBR machined-metal texture & material library.
// Synthesizes tileable RGBA8 albedo, tangent-space normal, and glTF metallic-roughness
// maps purely in code so machined steel, turned brass, cast iron, ground chrome,
// anodized trusses, and braided hydraulic hoses render with authentic micro-surface detail.

function mulberry32(seed) {
    let a = seed >>> 0;
    return () => {
        a = (a + 0x6D2B79F5) >>> 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

function clampByte(v) {
    return v <= 0 ? 0 : v >= 255 ? 255 : (v + 0.5) | 0;
}

/** Smooth periodic 2D value noise on an NxN grid (tileable). */
function makePeriodicNoise(gridN, seed) {
    const rng = mulberry32(seed);
    const g = new Float32Array(gridN * gridN);
    for (let i = 0; i < g.length; i++) g[i] = rng();
    return (u, v) => {
        const x = ((u % 1) + 1) % 1 * gridN;
        const y = ((v % 1) + 1) % 1 * gridN;
        const x0 = Math.floor(x) % gridN, x1 = (x0 + 1) % gridN;
        const y0 = Math.floor(y) % gridN, y1 = (y0 + 1) % gridN;
        const fx = x - Math.floor(x), fy = y - Math.floor(y);
        const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
        const a = g[y0 * gridN + x0], b = g[y0 * gridN + x1];
        const c = g[y1 * gridN + x0], d = g[y1 * gridN + x1];
        return (a + (b - a) * sx) + ((c + (d - c) * sx) - (a + (b - a) * sx)) * sy;
    };
}

/** Build a tangent-space normal map from a tileable scalar heightfield H[y*N + x]. */
function heightToNormalMap(H, N, strength) {
    const data = new Uint8Array(N * N * 4);
    for (let y = 0; y < N; y++) {
        const ym = (y + N - 1) % N, yp = (y + 1) % N;
        for (let x = 0; x < N; x++) {
            const xm = (x + N - 1) % N, xp = (x + 1) % N;
            const dx = (H[y * N + xp] - H[y * N + xm]) * strength;
            const dy = (H[yp * N + x] - H[ym * N + x]) * strength;
            let nx = -dx, ny = -dy, nz = 1.0;
            const inv = 1.0 / Math.hypot(nx, ny, nz);
            nx *= inv; ny *= inv; nz *= inv;
            const i = (y * N + x) * 4;
            data[i] = clampByte((nx * 0.5 + 0.5) * 255);
            data[i + 1] = clampByte((ny * 0.5 + 0.5) * 255);
            data[i + 2] = clampByte((nz * 0.5 + 0.5) * 255);
            data[i + 3] = 255;
        }
    }
    return { width: N, height: N, data };
}

function generateTextureSet(spec) {
    const N = spec.size || 256;
    const albedo = new Uint8Array(N * N * 4);
    const mr = new Uint8Array(N * N * 4); // glTF: R=1, G=roughness, B=metallic, A=255
    const H = new Float32Array(N * N);

    const nCoarse = makePeriodicNoise(16, spec.seed + 11);
    const nMid = makePeriodicNoise(48, spec.seed + 37);
    const nFine = makePeriodicNoise(128, spec.seed + 97);
    const streak = makePeriodicNoise(64, spec.seed + 151);

    const [br, bg, bb] = spec.base;
    const [vr, vg, vb] = spec.variation || [0.06, 0.06, 0.06];

    for (let y = 0; y < N; y++) {
        const v = y / N;
        for (let x = 0; x < N; x++) {
            const u = x / N;
            let h = 0.5;
            let tone = 0;
            let roughDelta = 0;

            if (spec.pattern === 'brushed') {
                // Silky precision CNC-milled micro-striations (subtle, never noisy!)
                const s1 = streak(u * 0.25, v * 4.0);
                const s2 = nFine(u * 0.5, v * 6.0);
                const micro = Math.sin(v * Math.PI * 2 * 96 + s1 * 1.4) * 0.14;
                const blotch = nCoarse(u, v) - 0.5;
                h = 0.5 + (s1 - 0.5) * 0.22 + (s2 - 0.5) * 0.14 + micro;
                tone = (s1 - 0.5) * 0.42 + blotch * 0.25;
                roughDelta = (0.5 - s1) * 0.05 + blotch * 0.04;
            } else if (spec.pattern === 'cast') {
                // Fine micro-pebble sand-cast iron (tight high-frequency grain, never blobby)
                const c = nCoarse(u, v);
                const m = nMid(u * 2, v * 2);
                const f = nFine(u * 2, v * 2);
                h = c * 0.10 + m * 0.30 + f * 0.60;
                tone = (c - 0.5) * 0.35 + (f - 0.5) * 0.25;
                roughDelta = (0.5 - h) * 0.08;
            } else if (spec.pattern === 'braid') {
                // Cross-hatched braided steel-reinforced hydraulic hose
                const d1 = Math.sin((u + v) * Math.PI * 2 * 24);
                const d2 = Math.sin((u - v) * Math.PI * 2 * 24);
                const weave = Math.max(d1, d2);
                const f = nFine(u, v) - 0.5;
                h = 0.5 + weave * 0.32 + f * 0.08;
                tone = weave * 0.30 + f * 0.12;
                roughDelta = -weave * 0.08;
            } else if (spec.pattern === 'paint') {
                // Satin industrial enamel with very fine powder-coat micro-sheen
                const c = nCoarse(u, v);
                const f = nFine(u * 2, v * 2);
                h = 0.5 + (f - 0.5) * 0.22;
                tone = (c - 0.5) * 0.25 + (f - 0.5) * 0.14;
                roughDelta = (c - 0.5) * 0.05;
            } else if (spec.pattern === 'grid') {
                // Drafting bedplate: dark anodized steel with subtle machined T-slot grooves
                const f = nFine(u, v) - 0.5;
                const c = nCoarse(u, v) - 0.5;
                const gx = Math.min(u, 1 - u);
                const gy = Math.min(v, 1 - v);
                const line = (gx < 0.010 || gy < 0.010) ? 1 : 0;
                const subX = Math.abs((u * 4) % 1 - 0.5);
                const subY = Math.abs((v * 4) % 1 - 0.5);
                const sub = (subX > 0.494 || subY > 0.494) ? 1 : 0;
                h = 0.5 + f * 0.06 - line * 0.28 - sub * 0.08;
                tone = c * 0.16 + f * 0.08 + line * 0.45 + sub * 0.14;
                roughDelta = line * -0.10 + c * 0.04;
            } else {
                // Precision mirror-ground chrome / bearing steel
                const s = streak(u * 0.2, v * 2.4) - 0.5;
                h = 0.5 + s * 0.08;
                tone = s * 0.12;
                roughDelta = s * 0.02;
            }

            H[y * N + x] = h;
            const i = (y * N + x) * 4;
            albedo[i] = clampByte((br + tone * vr) * 255);
            albedo[i + 1] = clampByte((bg + tone * vg) * 255);
            albedo[i + 2] = clampByte((bb + tone * vb) * 255);
            albedo[i + 3] = 255;

            const rVal = Math.max(0.06, Math.min(0.96, spec.roughness + roughDelta));
            const mVal = Math.max(0.0, Math.min(1.0, spec.metallic));
            mr[i] = 255;
            mr[i + 1] = clampByte(rVal * 255);
            mr[i + 2] = clampByte(mVal * 255);
            mr[i + 3] = 255;
        }
    }

    return {
        texture: { width: N, height: N, data: albedo },
        normalTexture: heightToNormalMap(H, N, spec.normalStrength ?? 2.4),
        metallicRoughnessTexture: { width: N, height: N, data: mr },
    };
}

export const CAD_MATERIALS = {
    machined_steel: {
        name: 'Machined Steel 4140',
        density: 7850, yieldMPa: 655,
        base: [0.74, 0.77, 0.81], variation: [0.035, 0.035, 0.04],
        metallic: 0.94, roughness: 0.21, pattern: 'brushed', normalStrength: 0.28, seed: 101,
    },
    cast_iron: {
        name: 'Ductile Cast Iron',
        density: 7200, yieldMPa: 380,
        base: [0.15, 0.17, 0.20], variation: [0.03, 0.03, 0.035],
        metallic: 0.76, roughness: 0.48, pattern: 'cast', normalStrength: 0.62, seed: 202,
    },
    turned_brass: {
        name: 'C360 Bearing Brass',
        density: 8500, yieldMPa: 310,
        base: [0.86, 0.64, 0.24], variation: [0.04, 0.035, 0.025],
        metallic: 0.95, roughness: 0.19, pattern: 'brushed', normalStrength: 0.24, seed: 303,
    },
    chrome_shaft: {
        name: 'Hard-Chrome Shaft',
        density: 7900, yieldMPa: 880,
        base: [0.91, 0.93, 0.96], variation: [0.02, 0.02, 0.02],
        metallic: 0.98, roughness: 0.09, pattern: 'chrome', normalStrength: 0.12, seed: 404,
    },
    blued_steel: {
        name: 'Tempered Blued Steel',
        density: 7850, yieldMPa: 1120,
        base: [0.17, 0.23, 0.32], variation: [0.03, 0.035, 0.04],
        metallic: 0.92, roughness: 0.24, pattern: 'brushed', normalStrength: 0.26, seed: 505,
    },
    truss_slate: {
        name: 'Structural Truss Steel',
        density: 7850, yieldMPa: 520,
        base: [0.22, 0.27, 0.33], variation: [0.03, 0.03, 0.035],
        metallic: 0.74, roughness: 0.36, pattern: 'paint', normalStrength: 0.28, seed: 606,
    },
    industrial_amber: {
        name: 'Enamel Hydraulic Amber',
        density: 7850, yieldMPa: 480,
        base: [0.84, 0.44, 0.06], variation: [0.035, 0.025, 0.015],
        metallic: 0.14, roughness: 0.28, pattern: 'paint', normalStrength: 0.22, seed: 707,
    },
    copper_fitting: {
        name: 'Machined Copper',
        density: 8960, yieldMPa: 260,
        base: [0.82, 0.45, 0.24], variation: [0.035, 0.025, 0.02],
        metallic: 0.95, roughness: 0.22, pattern: 'brushed', normalStrength: 0.22, seed: 808,
    },
    rubber_hose: {
        name: 'Braided Hydraulic Hose',
        density: 1500, yieldMPa: 45,
        base: [0.11, 0.13, 0.16], variation: [0.03, 0.03, 0.03],
        metallic: 0.12, roughness: 0.76, pattern: 'braid', normalStrength: 0.95, seed: 909,
    },
    gunmetal_ordnance: {
        name: 'Ordnance Forged Steel',
        density: 8050, yieldMPa: 960,
        base: [0.28, 0.32, 0.37], variation: [0.035, 0.035, 0.04],
        metallic: 0.88, roughness: 0.26, pattern: 'brushed', normalStrength: 0.26, seed: 1010,
    },
    bedplate_grid: {
        name: 'Machined Test Bedplate',
        density: 7850, yieldMPa: 450,
        base: [0.12, 0.14, 0.18], variation: [0.09, 0.11, 0.13],
        metallic: 0.52, roughness: 0.44, pattern: 'grid', normalStrength: 0.48, seed: 1111,
    },
};

const texCache = new Map();

export function getCadMaterial(key) {
    const spec = CAD_MATERIALS[key] || CAD_MATERIALS.machined_steel;
    if (!texCache.has(key)) {
        texCache.set(key, generateTextureSet(spec));
    }
    const maps = texCache.get(key);
    return {
        color: [1, 1, 1],
        metallic: spec.metallic,
        roughness: spec.roughness,
        texture: maps.texture,
        normalTexture: maps.normalTexture,
        metallicRoughnessTexture: maps.metallicRoughnessTexture,
        castsShadow: true,
        receivesShadow: true,
    };
}

/** Stress heatmap tint RGB [0..1] for Physical-Form Stress Overlay (0 = cool steel, 0.6 = amber, 1+ = crimson). */
export function stressTintRgb(util) {
    const u = Math.max(0, Math.min(1.25, util || 0));
    if (u < 0.35) {
        const k = u / 0.35;
        return [0.30 + k * 0.15, 0.72 + k * 0.18, 0.92 - k * 0.25];
    }
    if (u < 0.75) {
        const k = (u - 0.35) / 0.40;
        return [0.45 + k * 0.53, 0.90 - k * 0.24, 0.67 - k * 0.55];
    }
    const k = Math.min(1, (u - 0.75) / 0.40);
    return [0.98, 0.66 - k * 0.50, 0.12];
}
