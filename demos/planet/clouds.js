// The planet's clouds: one cloud field over the sphere, drawn as a volume
// (scene.createVolume) the view's rays march, and read by the ground for the
// clouds' shadows.
//
// The field is a cumulus layer. At a point of the layer the column holds an
// amount F: the weather (where cloud systems are, over thousands of km) plus
// octaves of detail down to a few tens of metres. Cloud fills the column from
// a flat base up to where its height needs more than F (rounded tops, the
// tallest where F is largest). Seen from any distance it is the same field:
// the octaves a pixel's footprint cannot resolve are replaced by what they
// average to, the chance that the unresolved detail would still put cloud
// there (their sum taken as Gaussian), so a far pixel sees the cloud
// fraction its patch of sky would have up close, and its rays pass through
// as many cloudy columns and clear ones as that fraction says (the march's
// sub-columns). Refinement only sharpens it, as the sea's waves turn into
// its roughness (Bruneton, Neyret and Holzschuch 2010). The field is
// produced by a kernel into a clipmap about the eye (clouds.bk), so a
// shader reads a column in a few loads, whatever its footprint. The view's
// rays march it, and are lit, in the volume's hook (clouds_volume.bk).

// The layer's shape is clouds.bk's (CLOUD_BASE, CLOUD_DEPTH), here for the
// near grid's gate and the tests.
export const CLOUD_BASE = 1500;       // m above the broad ground under it (clouds.bk k_cloud_lift)
export const CLOUD_DEPTH = 2600;      // m from the base to the tallest tops
const NEAR_RANGE = 1500;              // m from the eye the engine's near grid integrates (userMedium)
const NEAR_MARGIN = 300;              // m about the layer's heights the eye uses the grid within
const NOISE_VAR = 0.0728;             // the Perlin noise's variance (ground.bk PERLIN_VAR)
const NOISE_SLOPE = 2.5;              // a bound on its gradient, per lattice unit

// The column field is a clipmap (clouds.bk k_cloud_level): LEVELS grids of
// N x N texels about the eye on the gnomonic plane of the cube face it is
// over, each level's texels twice the last's, then the whole sphere as six
// faces of FACE + 2 texels (the faces' edges and a texel beyond). A texel
// holds the column at a footprint of two texels; the finest are DELTA0 of
// the plane apart (24 m at a face's centre, a footprint of 48 m: finer is
// the detail's, CLOUD_COLUMN_MIN), the sphere's as the coarsest
// level's next. A level follows the eye in steps of SNAP texels and
// produces only the texels it steps onto, its grid wrapping (k_cloud_level;
// N a power of two, as the shader wraps by a mask).
const LEVELS = 11, N = 512, SNAP = 32, FACE = 256;
const DELTA_GLOBE = 2 / (FACE - 1);
const DELTA0 = DELTA_GLOBE / 2 ** LEVELS;
const GLOBE_BASE = LEVELS * N * N;     // the first globe texel
const FACE_TEXELS = (FACE + 2) * (FACE + 2);

// The view's volume reads the same field from a tile cache (bro.tiles,
// clouds.bk k_cloud_tile): TILE cells a tile's edge and TILE_BORDER beyond
// it, a cell's column at a footprint of two cells, refined wherever a cell
// projects over TILE_PIXELS pixels, so every part of the view reads its own
// footprint, where the clipmap's levels about the eye fell coarser past an
// eighth of the eye's distance. TILE_LEVELS deep: 49 m footprints at a
// face's centre, the clipmap's finest. The ground's light stays on the
// clipmap (cloudGlsl) until its chunk is a module that can import tiles.bk.
const TILE = 64, TILE_BORDER = 1, TILE_CELLS = TILE + 2 * TILE_BORDER, TILE_LEVELS = 13;
const TILE_PIXELS = 1, TILE_CAPACITY = 6144, TILE_BUDGET_MS = 0.3, TILE_ATLAS = 2;

// The column's octaves (clouds.bk column): wavelength and amplitude.
const OCTAVES = [];
for (let k = 0, w = 2.0e6, a = 0.48; k < 7; k++, w /= 2, a *= 0.6) OCTAVES.push([w, a]);
for (let k = 0, w = 12800, a = 0.32; k < 10; k++, w /= 2, a *= 0.62) OCTAVES.push([w, a]);

// The detail's noise (cloudNoise): gradient noise (Perlin 2002's gradients)
// over a lattice tiling every NOISE_PERIOD units, sampled NOISE_CELL texels
// a unit into NOISE_TEXELS^3 texels (a 3D texture), its z slices one after another, scaled
// to NOISE_VAR's variance.
const NOISE_PERIOD = 16, NOISE_CELL = 4, NOISE_TEXELS = NOISE_PERIOD * NOISE_CELL;
function noiseSlices() {
    const P = NOISE_PERIOD, n = NOISE_TEXELS;
    const hash = new Uint8Array(P * P * P);
    for (let i = 0; i < hash.length; i++) {
        let h = Math.imul(i + 1, 0x9e3779b1);
        h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
        hash[i] = (h ^ (h >>> 13)) & 15;
    }
    const grad = (x, y, z, fx, fy, fz) => {
        const h = hash[((z % P) * P + (y % P)) * P + (x % P)];
        const a = h < 8 ? fx : fy;
        const b = h < 4 ? fy : (h === 12 || h === 14 ? fx : fz);
        return ((h & 1) ? -a : a) + ((h & 2) ? -b : b);
    };
    const fade = (t) => t * t * t * (t * (t * 6 - 15) + 10);
    const mix = (a, b, t) => a + (b - a) * t;
    const out = new Float32Array(n * n * n);
    let sum = 0, sum2 = 0;
    for (let k = 0; k < n; k++) for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
        const x = Math.floor(i / NOISE_CELL), y = Math.floor(j / NOISE_CELL), z = Math.floor(k / NOISE_CELL);
        const fx = (i % NOISE_CELL) / NOISE_CELL, fy = (j % NOISE_CELL) / NOISE_CELL, fz = (k % NOISE_CELL) / NOISE_CELL;
        const u = fade(fx), v = fade(fy), w = fade(fz);
        const x00 = mix(grad(x, y, z, fx, fy, fz), grad(x + 1, y, z, fx - 1, fy, fz), u);
        const x10 = mix(grad(x, y + 1, z, fx, fy - 1, fz), grad(x + 1, y + 1, z, fx - 1, fy - 1, fz), u);
        const x01 = mix(grad(x, y, z + 1, fx, fy, fz - 1), grad(x + 1, y, z + 1, fx - 1, fy, fz - 1), u);
        const x11 = mix(grad(x, y + 1, z + 1, fx, fy - 1, fz - 1), grad(x + 1, y + 1, z + 1, fx - 1, fy - 1, fz - 1), u);
        const val = mix(mix(x00, x10, v), mix(x01, x11, v), w);
        out[(k * n + j) * n + i] = val;
        sum += val;
        sum2 += val * val;
    }
    const mean = sum / out.length, scale = Math.sqrt(NOISE_VAR / (sum2 / out.length - mean * mean));
    let abs = 0, abs2 = 0;
    for (let i = 0; i < out.length; i++) {
        out[i] = (out[i] - mean) * scale;
        abs += Math.abs(out[i]);
        abs2 += out[i] * out[i];
    }
    BILLOW_MEAN = abs / out.length;
    BILLOW_VAR = abs2 / out.length - BILLOW_MEAN * BILLOW_MEAN;
    return out;
}
// The billows' noise (cloudDetailed): the noise's magnitude less its mean,
// and its variance, from the slices.
let BILLOW_MEAN = 0, BILLOW_VAR = 0;
const NOISE = noiseSlices();
// The variance the detail adds to a column at full amount (cloudGlsl's
// CLOUD_DETAIL_VAR, clouds.bk cloud_light's detail_var).
export const CLOUD_DETAIL_VAR = NOISE_VAR * (0.07 * 0.07 + 0.04 * 0.04) + BILLOW_VAR * (0.03 * 0.03 + 0.02 * 0.02);

// A bound on the gradient (per m along the layer) of the column resolved at
// footprint w: what a level's amount can change by within a distance.
function gradientBound(w) {
    let g = 0;
    for (const [wavelength, amp] of OCTAVES) {
        const r = Math.min(Math.max(wavelength / w * 0.5 - 1, 0), 1);
        g += r * amp * NOISE_SLOPE / wavelength;
    }
    return g;
}

// Cube face i (0..5): axis i % 3, its sign, and the plane's axes, the same
// in the kernel's dispatch and the shader.
export function faceFrame(i) {
    const axis = i % 3, sign = i < 3 ? 1 : -1;
    const a = [0, 0, 0], e = [0, 0, 0], f = [0, 0, 0];
    a[axis] = sign;
    e[(axis + 1) % 3] = 1;
    f[(axis + 2) % 3] = 1;
    return { a, e, f };
}

// The clouds' light on the ground (cloudLight), for the ground's chunk.
// Positions are about the planet's centre, in metres. The clipmap's levels
// are the column field's (clouds.bk): u_cloudHead holds, for level k, its
// plane origin, texel spacing and gradientBound; at CLOUD_LEVELS, the
// globe's spacing and bound; after it, each level's origin in texels (where
// its wrapped grid starts). u_cloudA/E/F is the eye's face (faceFrame).
export const cloudGlsl = (radius) => `
    const float CLOUD_R = ${radius.toFixed(1)};
    buffer vec4 u_cloudHead[];
    uniform vec3 u_cloudA;
    uniform vec3 u_cloudE;
    uniform vec3 u_cloudF;
    const int CLOUD_LEVELS = ${LEVELS}, CLOUD_N = ${N}, CLOUD_FACE = ${FACE + 2};
    const int CLOUD_GLOBE = ${GLOBE_BASE}, CLOUD_FACE_TEXELS = ${FACE_TEXELS};
    const float CLOUD_DELTA0 = ${DELTA0};

    // The globe level's face at the unit direction q (the largest axis), and
    // q's texel coordinates t on it.
    int cloudFace(vec3 q, out vec2 t) {
        vec3 m = abs(q);
        int axis = m.x >= m.y && m.x >= m.z ? 0 : (m.y >= m.z ? 1 : 2);
        // q's axes rotated so the face's comes first (a swizzle: a vector
        // indexed by a variable is kept in local memory, not registers).
        vec3 r = axis == 0 ? q : (axis == 1 ? q.yzx : q.zxy);
        float z = r.x;
        vec2 uv = r.yz / abs(z);
        float delta = u_cloudHead[CLOUD_LEVELS].x;
        t = clamp((uv + 1.0 + delta) / delta, vec2(0.0), vec2(float(CLOUD_FACE) - 1.001));
        return axis + (z < 0.0 ? 3 : 0);
    }

    // The level a footprint of w metres reads at the layer point q (0 the
    // finest, fractional between two, CLOUD_LEVELS the globe), and q's point
    // uv on the eye's face plane (the globe off it), as the volume reads the
    // field (clouds_volume.bk level_of).
    const float CLOUD_COLUMN_MIN = 60.0;
    float cloudLevelOf(vec3 q, float w, out vec2 uv) {
        uv = vec2(0.0);
        float z = dot(q, u_cloudA);
        if (z <= 0.1) return float(CLOUD_LEVELS);
        uv = vec2(dot(q, u_cloudE), dot(q, u_cloudF)) / z;
        float d = 1.0 + dot(uv, uv);
        float stretch = sqrt(1.0 + max(uv.x * uv.x, uv.y * uv.y)) / d;
        return clamp(log2(max(w, CLOUD_COLUMN_MIN) / (2.0 * CLOUD_R * CLOUD_DELTA0 * stretch)), 0.0, float(CLOUD_LEVELS));
    }

    // What the clouds leave of the ground's light (clouds.bk k_cloud_light),
    // over the column field's texels: the sun straight through (x),
    // scattered down (y), and the sky's (z). A level's grid wraps: texel p
    // of it (counted from the plane's origin) is in slot p mod n.
    buffer uint u_cloudLight[];
    vec3 cloudLightTexel(int base, ivec2 p) {
        p &= ivec2(CLOUD_N - 1);
        return unpackUnorm4x8(u_cloudLight[base + p.y * CLOUD_N + p.x]).xyz;
    }
    bool cloudLightLevel(int k, vec2 uv, out vec3 c) {
        vec4 h = u_cloudHead[k];
        vec2 t = (uv - h.xy) / h.z;
        if (any(lessThan(t, vec2(0.0))) || any(greaterThanEqual(t, vec2(float(CLOUD_N) - 1.001)))) return false;
        vec2 fl = floor(t), f = t - fl;
        ivec2 p = ivec2(fl) + ivec2(u_cloudHead[CLOUD_LEVELS + 1 + k].xy);
        int base = k * CLOUD_N * CLOUD_N;
        c = mix(mix(cloudLightTexel(base, p), cloudLightTexel(base, p + ivec2(1, 0)), f.x),
                mix(cloudLightTexel(base, p + ivec2(0, 1)), cloudLightTexel(base, p + ivec2(1, 1)), f.x), f.y);
        return true;
    }
    vec3 cloudLightGlobe(vec3 q) {
        vec2 t;
        int face = cloudFace(q, t);
        vec2 c = floor(t), f = t - c;
        int i = CLOUD_GLOBE + face * CLOUD_FACE_TEXELS + int(c.y) * CLOUD_FACE + int(c.x);
        return mix(mix(unpackUnorm4x8(u_cloudLight[i]).xyz, unpackUnorm4x8(u_cloudLight[i + 1]).xyz, f.x),
                   mix(unpackUnorm4x8(u_cloudLight[i + CLOUD_FACE]).xyz,
                       unpackUnorm4x8(u_cloudLight[i + CLOUD_FACE + 1]).xyz, f.x), f.y);
    }
    // At the ground point g over a footprint of w metres, between the levels
    // as the volume reads the field (clouds_volume.bk column).
    vec3 cloudLight(vec3 g, float w) {
        vec3 q = normalize(g);
        vec2 uv;
        float l = cloudLevelOf(q, w, uv);
        int k0 = int(l);
        float frac = l - float(k0);
        vec3 c = vec3(1.0, 0.0, 1.0);
        int k;
        for (k = k0; k < CLOUD_LEVELS; k++) {
            if (cloudLightLevel(k, uv, c)) break;
            frac = 0.0;
        }
        if (k == CLOUD_LEVELS) return cloudLightGlobe(q);
        if (frac > 0.0) {
            vec3 c1;
            if (k + 1 == CLOUD_LEVELS) c1 = cloudLightGlobe(q);
            else if (!cloudLightLevel(k + 1, uv, c1)) c1 = c;
            c = mix(c, c1, frac);
        }
        return c;
    }

`;

// The clouds' volume in `scene`, its column field produced by `module`'s
// k_cloud_level (clouds.bk) and its lift by k_cloud_lift once, both bound to
// it and to each of `readers` (nodes whose chunks include cloudGlsl, which
// read the clouds' light on the ground with cloudLight from k_cloud_light's
// clipmap). update() each frame with the eye about the planet's centre
// (f64), its altitude and the unit direction to the sun.
export function createClouds(scene, radius, module, readers, seed, hook) {
    const kernel = module.kernel('k_cloud_level');
    const node = scene.createVolume({
        module: hook.source, file: 'clouds_volume.bk', modules: hook.modules, name: 'clouds',
        uniforms: { radius, billow_mean: BILLOW_MEAN, billow_var: BILLOW_VAR, detail_var: CLOUD_DETAIL_VAR },
    });
    node.setShaderTexture('noise', { data: NOISE, width: NOISE_TEXELS, height: NOISE_TEXELS, depth: NOISE_TEXELS, repeat: true });
    const map = bro.kernel.createBuffer((GLOBE_BASE + 6 * FACE_TEXELS) * 8);
    // u_cloudHead: LEVELS + 1 headers, then each level's grid origin in
    // texels (where its wrapped grid starts).
    const head = new Float32Array(4 * (2 * LEVELS + 1));
    const headBuffer = bro.kernel.createBuffer(head.byteLength);
    // The clouds' light on the ground over the same texels (k_cloud_light,
    // u_cloudLight), one word each, for the sun toward toSun.
    const kLight = module.kernel('k_cloud_light');
    const light = bro.kernel.createBuffer((GLOBE_BASE + 6 * FACE_TEXELS) * 4);
    const toSun = [0, 0, 0];   // none yet: the first update lights them all
    // Texels [x0, x0 + w) x [y0, y0 + h) of the grid of n a row at texel base.
    const dispatch = (base, n, x0, y0, w, h, frame, o, delta) => {
        if (w > 0 && h > 0) kernel.dispatch([w, h], map, base, n, x0, y0,
            frame.a[0], frame.a[1], frame.a[2], frame.e[0], frame.e[1], frame.e[2], frame.f[0], frame.f[1], frame.f[2],
            o, delta, radius);
    };
    const dispatchLight = (base, n, x0, y0, w, h, frame, o, delta) => {
        if (w > 0 && h > 0) kLight.dispatch([w, h], light, base, n, x0, y0,
            frame.a[0], frame.a[1], frame.a[2], frame.e[0], frame.e[1], frame.e[2], frame.f[0], frame.f[1], frame.f[2],
            o, delta, radius, seed, toSun[0], toSun[1], toSun[2], CLOUD_DETAIL_VAR);
    };
    // A whole level's light (or a globe face's) marches the field at every
    // texel, about 4 ms of GPU: produced LIGHT_ROWS rows a frame (0.12 ms),
    // the finest level first and the globe last, and the queue reported to
    // the scene (setPendingWork) so a settle waits for it. A level stepping
    // over the field produces the light of the texels it steps onto with
    // their columns, at once.
    const LIGHT_ROWS = 32;
    let lightQueue = [];   // [level (LEVELS + face for the globe's), first row]
    const queueLight = (k) => {
        if (lightQueue.some((j) => j[0] === k)) return;
        const rows = k < LEVELS ? N : FACE + 2;
        for (let y = 0; y < rows; y += LIGHT_ROWS) lightQueue.push([k, y]);
        lightQueue.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    };
    const runLight = ([k, y]) => {
        if (k >= LEVELS) {
            const i = k - LEVELS, rows = Math.min(LIGHT_ROWS, FACE + 2 - y);
            dispatchLight(GLOBE_BASE + i * FACE_TEXELS, FACE + 2, 0, y, FACE + 2, rows, faceFrame(i), -1 - DELTA_GLOBE, DELTA_GLOBE);
            return;
        }
        if (!held[k]) return;
        const delta = DELTA0 * 2 ** k, ox = origins[2 * k], oy = origins[2 * k + 1];
        dispatchLight(k * N * N, N, ox, oy + y, N, Math.min(LIGHT_ROWS, N - y), faceFrame(face), 0, delta);
    };

    for (let i = 0; i < 6; i++) dispatch(GLOBE_BASE + i * FACE_TEXELS, FACE + 2, 0, 0, FACE + 2, FACE + 2, faceFrame(i), -1 - DELTA_GLOBE, DELTA_GLOBE);
    head[4 * LEVELS] = DELTA_GLOBE;
    head[4 * LEVELS + 3] = gradientBound(2 * radius * DELTA_GLOBE * 0.35);

    // The lift, on the globe level's faces, and each texel's direction for
    // the range about the eye.
    const lift = bro.kernel.createBuffer(6 * FACE_TEXELS * 4);
    const kLift = module.kernel('k_cloud_lift');
    const liftDirs = new Float32Array(6 * FACE_TEXELS * 3);
    for (let i = 0; i < 6; i++) {
        const fr = faceFrame(i);
        kLift.dispatch([FACE + 2, FACE + 2], lift, i * FACE_TEXELS, FACE + 2,
            fr.a[0], fr.a[1], fr.a[2], fr.e[0], fr.e[1], fr.e[2], fr.f[0], fr.f[1], fr.f[2],
            -1 - DELTA_GLOBE, DELTA_GLOBE, radius, seed);
        for (let y = 0; y < FACE + 2; y++) {
            for (let x = 0; x < FACE + 2; x++) {
                const u = -1 - DELTA_GLOBE + x * DELTA_GLOBE, v = -1 - DELTA_GLOBE + y * DELTA_GLOBE;
                const p = [0, 1, 2].map((c) => fr.a[c] + fr.e[c] * u + fr.f[c] * v);
                const l = Math.hypot(p[0], p[1], p[2]);
                liftDirs.set([p[0] / l, p[1] / l, p[2] / l], 3 * (i * FACE_TEXELS + y * (FACE + 2) + x));
            }
        }
    }
    const liftCpu = lift.read(new Float32Array(6 * FACE_TEXELS));
    // The least and most lift within a ray's reach of the eye (the volume
    // marches 600 km at most), found again once the eye has moved 20 km.
    const liftRange = [0, 0];
    let liftAt = null;
    function updateLiftRange(eye) {
        const r = Math.hypot(eye[0], eye[1], eye[2]);
        const e = [eye[0] / r, eye[1] / r, eye[2] / r];
        if (liftAt && e[0] * liftAt[0] + e[1] * liftAt[1] + e[2] * liftAt[2] > Math.cos(20000 / radius)) return;
        liftAt = e;
        const reach = Math.cos(Math.min(Math.PI, (6.5e5 + Math.sqrt(Math.max(0, r * r - radius * radius))) / radius));
        // And about the eye, for the near grid's gate: the texels within
        // the 20 km it may move and two texels more (the lift is bilinear
        // between them).
        const close = Math.cos(20000 / radius + 2 * DELTA_GLOBE);
        let lo = Infinity, hi = 0, nearLo = Infinity, nearHi = -Infinity;
        for (let i = 0; i < liftCpu.length; i++) {
            const c = e[0] * liftDirs[3 * i] + e[1] * liftDirs[3 * i + 1] + e[2] * liftDirs[3 * i + 2];
            if (c < reach) continue;
            lo = Math.min(lo, liftCpu[i]);
            hi = Math.max(hi, liftCpu[i]);
            if (c < close) continue;
            nearLo = Math.min(nearLo, liftCpu[i]);
            nearHi = Math.max(nearHi, liftCpu[i]);
        }
        liftRange[0] = Number.isFinite(lo) ? lo : 0;
        liftRange[1] = hi;
        liftNear[0] = Number.isFinite(nearLo) ? nearLo : liftRange[0];
        liftNear[1] = Number.isFinite(nearHi) ? nearHi : liftRange[1];
        node.setShaderUniform('lift_range', liftRange);
    }
    const liftNear = [0, 0];

    const kTile = module.kernel('k_cloud_tile');
    const cache = bro.tiles.createCache({
        domain: { type: 'cubeSphere', radius, center: [0, 0, 0] },
        tileSize: TILE, border: TILE_BORDER, capacity: TILE_CAPACITY, maxLevel: TILE_LEVELS,
        minHeight: CLOUD_BASE, maxHeight: CLOUD_BASE + CLOUD_DEPTH + Math.max(...liftCpu),
        pixelsPerCell: TILE_PIXELS, producePerUpdate: 64, produceBudgetMs: TILE_BUDGET_MS,
        layers: { column: 4 },
        produce(batch) {
            kTile.dispatch([TILE_CELLS, TILE_CELLS, batch.count], batch.table, this.layer('column'),
                           TILE_CELLS, TILE, TILE_BORDER, radius);
        },
    });
    // Per tile level: its cells' footprint at a face's centre, and the
    // column's gradient bound there (at the least stretch over a face).
    const bounds = new Float32Array(4 * (TILE_LEVELS + 1));
    for (let l = 0; l <= TILE_LEVELS; l++) {
        const w = 2 * radius * (2 / 2 ** l / TILE);
        bounds.set([w, gradientBound(w * 0.35)], 4 * l);
    }
    const boundsBuffer = bro.kernel.createBuffer(bounds);
    node.setShaderBuffer('lookup', cache.lookup);
    // Read as a texture array, TILE_ATLAS x TILE_ATLAS slots a layer (GPUs
    // commonly give 2048 layers), its two 16-bit halves filtered by the
    // hardware; only the slots each update produces are copied into it.
    node.setShaderTexture('columns', { buffer: cache.layer('column'), width: TILE_CELLS, height: TILE_CELLS,
                                       layers: TILE_CAPACITY, atlas: TILE_ATLAS, channels: 2, format: 'unorm16' });
    node.setShaderBuffer('bounds', boundsBuffer);

    let face = -1;
    // Each level's grid origin in texels, and whether it holds anything.
    const origins = new Int32Array(2 * LEVELS);
    const held = new Uint8Array(LEVELS);
    const hi = [0, 0, 0], lo = [0, 0, 0];

    // The eye's face: the axis it is most along, kept until another is 5%
    // more so (a change of face produces every level again).
    function faceOf(eye) {
        const m = eye.map(Math.abs);
        const best = m[0] >= m[1] && m[0] >= m[2] ? 0 : (m[1] >= m[2] ? 1 : 2);
        if (face >= 0 && m[face % 3] * 1.05 >= m[best] && Math.sign(eye[face % 3]) === (face < 3 ? 1 : -1)) return face;
        return best + (eye[best] < 0 ? 3 : 0);
    }

    function produce(eye) {
        const f = faceOf(eye);
        const frame = faceFrame(f);
        if (f !== face) {
            face = f;
            held.fill(0);
            for (const n of readers) {
                n.setShaderUniform('u_cloudA', frame.a);
                n.setShaderUniform('u_cloudE', frame.e);
                n.setShaderUniform('u_cloudF', frame.f);
            }
        }
        const z = eye[0] * frame.a[0] + eye[1] * frame.a[1] + eye[2] * frame.a[2];
        const u = (eye[0] * frame.e[0] + eye[1] * frame.e[1] + eye[2] * frame.e[2]) / z;
        const v = (eye[0] * frame.f[0] + eye[1] * frame.f[1] + eye[2] * frame.f[2]) / z;
        let moved = false;
        for (let k = 0; k < LEVELS; k++) {
            const delta = DELTA0 * 2 ** k, step = SNAP * delta;
            const ox = Math.round(u / step) * SNAP - N / 2, oy = Math.round(v / step) * SNAP - N / 2;
            const px = origins[2 * k], py = origins[2 * k + 1];
            if (held[k] && ox === px && oy === py) continue;
            const base = k * N * N;
            if (!held[k] || Math.abs(ox - px) >= N || Math.abs(oy - py) >= N) {
                dispatch(base, N, ox, oy, N, N, frame, 0, delta);
                queueLight(k);
            } else {
                // The columns stepped onto, then the rows over the columns
                // kept; their light with them.
                const both = (x0, y0, w, h) => {
                    dispatch(base, N, x0, y0, w, h, frame, 0, delta);
                    dispatchLight(base, N, x0, y0, w, h, frame, 0, delta);
                };
                if (ox > px) both(px + N, oy, ox - px, N);
                else both(ox, oy, px - ox, N);
                const kx = Math.max(ox, px), kw = Math.min(ox, px) + N - kx;
                if (oy > py) both(kx, py + N, kw, oy - py);
                else both(kx, oy, kw, py - oy);
            }
            origins[2 * k] = ox;
            origins[2 * k + 1] = oy;
            held[k] = 1;
            head.set([Math.fround(ox * delta), Math.fround(oy * delta), delta, gradientBound(2 * radius * delta * 0.35)], 4 * k);
            head.set([ox, oy], 4 * (LEVELS + 1 + k));
            moved = true;
        }
        if (moved) headBuffer.write(head);
    }

    headBuffer.write(head);
    for (const n of readers) {
        n.setShaderBuffer('u_cloudHead', headBuffer);
        n.setShaderBuffer('u_cloudLight', light);
    }
    node.setShaderTexture('lift_faces', { data: liftCpu, width: FACE + 2, height: FACE + 2, layers: 6, channels: 1 });
    return {
        node,
        // The clipmap, for tests: its buffer, the level headers (u_cloudHead)
        // and layout, and the eye's face.
        map, head, layout: { levels: LEVELS, n: N, globe: GLOBE_BASE, faceTexels: FACE_TEXELS },
        get face() { return face; },
        // The volume's tile cache.
        cache,
        // `view` is the camera as a tile cache takes it (TileCache.update).
        update(eye, altitude, sun, view) {
            cache.update(view);
            // A sun moved by a tenth of a degree lights everything anew.
            if (sun[0] * toSun[0] + sun[1] * toSun[1] + sun[2] * toSun[2] < Math.cos(0.1 * Math.PI / 180)) {
                toSun[0] = sun[0];
                toSun[1] = sun[1];
                toSun[2] = sun[2];
                lightQueue = [];
                for (let k = 0; k <= LEVELS + 5; k++) queueLight(k);
            }
            produce(eye);
            if (lightQueue.length) runLight(lightQueue.shift());
            scene.setPendingWork('cloud light', lightQueue.length);
            updateLiftRange(eye);
            for (let k = 0; k < 3; k++) {
                hi[k] = Math.fround(eye[k]);
                lo[k] = eye[k] - hi[k];
            }
            node.setShaderUniform('cam_hi', hi);
            node.setShaderUniform('cam_lo', lo);
            node.setShaderUniform('cam_alt', altitude);
            // The near grid while the eye is in the layer's heights or about
            // them, where a march takes its many steps close by; further
            // off, it crosses the air to the layer in one.
            const near = altitude > CLOUD_BASE + liftNear[0] - NEAR_MARGIN &&
                         altitude < CLOUD_BASE + CLOUD_DEPTH + liftNear[1] + NEAR_MARGIN;
            node.setShaderUniform('near_range', near ? NEAR_RANGE : 0);
        },
    };
}
