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
// shader reads a column in a few loads, whatever its footprint.
//
// Light, per step of the march: the sun through the cloud between the
// point and it (the column above up to its top, then the column toward the
// sun: bright tops, shaded far sides, grey bases), scattered in a two-lobed
// phase (the silver lining toward the sun), with the light scattered many
// times as two-stream diffusion carries it in; the sky from above through
// the depth over the point; integrated over each step in closed form
// (Hillaire 2016).

export const CLOUD_BASE = 1500;       // m above the sea
export const CLOUD_DEPTH = 2600;      // m from the base to the tallest tops
const CLOUD_SIGMA = 0.03;             // extinction inside a cloud, 1/m
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

// The column's octaves (clouds.bk column): wavelength and amplitude.
const OCTAVES = [];
for (let k = 0, w = 2.0e6, a = 0.48; k < 7; k++, w /= 2, a *= 0.6) OCTAVES.push([w, a]);
for (let k = 0, w = 12800, a = 0.32; k < 10; k++, w /= 2, a *= 0.62) OCTAVES.push([w, a]);

// The detail's noise (cloudNoise): gradient noise (Perlin 2002's gradients)
// over a lattice tiling every NOISE_PERIOD units, sampled NOISE_CELL texels
// a unit into NOISE_TEXELS^3 texels, its z slices one after another, scaled
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
    for (let i = 0; i < out.length; i++) out[i] = (out[i] - mean) * scale;
    return out;
}

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

// The cloud field, for the volume and the ground. Positions are about the
// planet's centre, in metres.
// With `filtered` the levels are read through the texture u_cloudLevels
// (bound by createClouds to the volume), else from the map's buffer.
export const cloudGlsl = (radius, filtered = false) => `
    const float CLOUD_R = ${radius.toFixed(1)};
    const float CLOUD_BASE = ${CLOUD_BASE.toFixed(1)};
    const float CLOUD_DEPTH = ${CLOUD_DEPTH.toFixed(1)};
    const float CLOUD_SIGMA = ${CLOUD_SIGMA};
    // The share of the height a column's amount must exceed to hold cloud:
    // What a column must hold to reach the layer's height s (0 base, 1 top):
    // CLOUD_FLOOR at the base, rising as s^2 (rounded tops) and without bound
    // toward the top, so the most a column holds only lifts its top nearer
    // it, and an overcast has the relief of what its columns hold, not a
    // flat ceiling.
    const float CLOUD_FLOOR = 0.02, CLOUD_CURVE = 0.7;
    float cloudNeed(float s) {
        float s2 = min(s * s, 0.999);
        return CLOUD_FLOOR + CLOUD_CURVE * s2 / (1.0 - s2);
    }
    // Its rate per unit of s.
    float cloudNeedSlope(float s) {
        float d = max(1.0 - s * s, 0.001);
        return 2.0 * CLOUD_CURVE * s / (d * d);
    }
    // The column field (clouds.bk): two floats a texel, the amount and the
    // variance of the octaves too fine for the texel. u_cloudHead holds,
    // for level k, its plane origin, texel spacing and gradientBound; at
    // CLOUD_LEVELS, the globe's spacing and bound; after it, each level's
    // origin in texels (where its wrapped grid starts). u_cloudA/E/F is the
    // eye's face (faceFrame).
    buffer vec2 u_cloudMap[];
    buffer vec4 u_cloudHead[];
    uniform vec3 u_cloudA;
    uniform vec3 u_cloudE;
    uniform vec3 u_cloudF;
    const int CLOUD_LEVELS = ${LEVELS}, CLOUD_N = ${N}, CLOUD_FACE = ${FACE + 2};
    const int CLOUD_GLOBE = ${GLOBE_BASE}, CLOUD_FACE_TEXELS = ${FACE_TEXELS};
    const float CLOUD_DELTA0 = ${DELTA0};

    vec2 cloudTexel(int i) { return u_cloudMap[i]; }

    // The cloud's own relief, in three dimensions: the column is the same
    // at every height, so its sides would be its pattern drawn straight up
    // (walls streaked toward the zenith seen from under them). Octaves of
    // gradient noise over space are added to the column's amount, billows
    // of a few hundred metres in its sides, base and tops (the erosion of
    // Schneider's Nubis), in proportion to the column's amount up to
    // CLOUD_DETAIL_FULL, so a column barely short of cloud stays clear (and
    // no further: a thin column's cloud near the base, where the need is
    // flat, spans a tall range of heights, and with the detail weak there
    // it hung under the bases as curtains of its own pattern). A
    // column read alone (cloudColumn) carries their variance as unresolved,
    // so the shadows, the light's tops and far pixels see what they average
    // to; where a sample resolves them (cloudDetailed, for the occupancy)
    // they are added and their share of the variance taken back out.
    const vec3 CLOUD_DETAIL[2] = vec3[2](vec3(480.0, 0.07, 0.0), vec3(190.0, 0.04, 17.0));
    const float CLOUD_DETAIL_VAR = ${NOISE_VAR} * (0.07 * 0.07 + 0.04 * 0.04);
    const float CLOUD_DETAIL_FULL = 0.04;
    float cloudDetailScale(float F) { return clamp(F / CLOUD_DETAIL_FULL, 0.0, 1.0); }

    // Bilinear over a level's grid of n texels a row from texel base, at
    // texel coordinates t (within [0, n - 1)).
    vec2 cloudBilinear(int base, int n, vec2 t) {
        vec2 c = floor(t), f = t - c;
        int i = base + int(c.y) * n + int(c.x);
        return mix(mix(cloudTexel(i), cloudTexel(i + 1), f.x),
                   mix(cloudTexel(i + n), cloudTexel(i + n + 1), f.x), f.y);
    }

    // The globe level at the unit direction q: its face, the largest axis.
    vec2 cloudGlobe(vec3 q) {
        vec3 m = abs(q);
        int axis = m.x >= m.y && m.x >= m.z ? 0 : (m.y >= m.z ? 1 : 2);
        float z = q[axis];
        int face = axis + (z < 0.0 ? 3 : 0);
        vec2 uv = vec2(q[(axis + 1) % 3], q[(axis + 2) % 3]) / abs(z);
        float delta = u_cloudHead[CLOUD_LEVELS].x;
        vec2 t = clamp((uv + 1.0 + delta) / delta, vec2(0.0), vec2(float(CLOUD_FACE) - 1.001));
        return cloudBilinear(CLOUD_GLOBE + face * CLOUD_FACE_TEXELS, CLOUD_FACE, t);
    }

    // Level k at the plane point uv, false outside its grid. Its grid wraps:
    // texel p of it (counted from the plane's origin) is in slot p mod n.
${filtered ? `
    // The levels as the slices of a texture the engine copies from the map
    // each render: one filtered fetch, the wrap its repeat.
    uniform sampler2DArray u_cloudLevels;
    bool cloudLevel(int k, vec2 uv, out vec2 c) {
        vec4 h = u_cloudHead[k];
        vec2 t = (uv - h.xy) / h.z;
        if (any(lessThan(t, vec2(0.0))) || any(greaterThanEqual(t, vec2(float(CLOUD_N) - 1.001)))) return false;
        vec2 p = t + u_cloudHead[CLOUD_LEVELS + 1 + k].xy + 0.5;
        c = textureLod(u_cloudLevels, vec3(p / float(CLOUD_N), float(k)), 0.0).rg;
        return true;
    }` : `
    vec2 cloudLevelTexel(int base, ivec2 p) {
        p &= ivec2(CLOUD_N - 1);
        return cloudTexel(base + p.y * CLOUD_N + p.x);
    }
    bool cloudLevel(int k, vec2 uv, out vec2 c) {
        vec4 h = u_cloudHead[k];
        vec2 t = (uv - h.xy) / h.z;
        if (any(lessThan(t, vec2(0.0))) || any(greaterThanEqual(t, vec2(float(CLOUD_N) - 1.001)))) return false;
        vec2 fl = floor(t), f = t - fl;
        ivec2 p = ivec2(fl) + ivec2(u_cloudHead[CLOUD_LEVELS + 1 + k].xy);
        int base = k * CLOUD_N * CLOUD_N;
        c = mix(mix(cloudLevelTexel(base, p), cloudLevelTexel(base, p + ivec2(1, 0)), f.x),
                mix(cloudLevelTexel(base, p + ivec2(0, 1)), cloudLevelTexel(base, p + ivec2(1, 1)), f.x), f.y);
        return true;
    }`}

    // The column's amount F at the layer point q (unit direction from the
    // centre) resolved at a footprint of w metres, and the variance of what
    // is finer: between the two levels whose footprints bracket w, as a
    // mip's levels blend, or the finest level holding q if neither does.
    // False when even 3.4 deviations of what is finer cannot lift it to
    // need, with clear the distance (m) within which the level's own
    // amount cannot either, given that need falls by at most drop a metre
    // along the way: how far a ray may step and find no cloud. Never finer
    // than CLOUD_COLUMN_MIN: below it the cloud is the detail's, in three
    // dimensions, and the column's own octaves there its variance.
    const float CLOUD_COLUMN_MIN = 60.0;
    bool cloudColumn(vec3 q, float w, float need, float drop, out float F, out float variance, out float clear) {
        w = max(w, CLOUD_COLUMN_MIN);
        vec2 c = vec2(0.0);
        int k = CLOUD_LEVELS;
        float z = dot(q, u_cloudA);
        if (z > 0.1) {
            vec2 uv = vec2(dot(q, u_cloudE), dot(q, u_cloudF)) / z;
            float d = 1.0 + dot(uv, uv);
            float stretch = sqrt(1.0 + max(uv.x * uv.x, uv.y * uv.y)) / d;
            float l = clamp(log2(w / (2.0 * CLOUD_R * CLOUD_DELTA0 * stretch)), 0.0, float(CLOUD_LEVELS));
            int k0 = int(l);
            float frac = l - float(k0);
            for (k = k0; k < CLOUD_LEVELS; k++) {
                if (cloudLevel(k, uv, c)) break;
                frac = 0.0;
            }
            if (k < CLOUD_LEVELS && frac > 0.0) {
                vec2 c1;
                if (k + 1 == CLOUD_LEVELS) c1 = cloudGlobe(q);
                else if (!cloudLevel(k + 1, uv, c1)) c1 = c;
                c = mix(c, c1, frac);
            }
        }
        if (k == CLOUD_LEVELS) c = cloudGlobe(q);
        F = c.x;
        float g = cloudDetailScale(F);
        variance = c.y + CLOUD_DETAIL_VAR * g * g;
        float reach = 3.4 * sqrt(variance);
        if (F + reach < need) {
            clear = (need - F - reach) / (u_cloudHead[k].w + drop);
            return false;
        }
        clear = 0.0;
        return true;
    }

    // The share of the layer's height s (0 base, 1 top) holding cloud in a
    // column of amount F with unresolved variance v: 0 or 1 when resolved,
    // the chance of cloud otherwise (a logistic in place of the normal CDF).
    float cloudOccupancy(float F, float v, float s) {
        if (s < 0.0 || s > 1.0) return 0.0;
        float need = cloudNeed(s);
        return 1.0 / (1.0 + exp(-1.7 * (F - need) / sqrt(v + 1e-5)));
    }

    // The height share the column's cloud reaches (for the light through it):
    // where cloudNeed(s) = F.
    float cloudTop(float F) {
        float x = max(F - CLOUD_FLOOR, 0.0) / CLOUD_CURVE;
        return sqrt(x / (1.0 + x));
    }

    // What the clouds leave of the sun at the ground point g (about the
    // centre, at altitude h): the sun's ray crosses the layer's lower part
    // at q; the share of sky the clouds fill there (at the ground's
    // footprint w) passes what a cloud of the column's depth above g lets
    // through, the light it scatters forward included: two-stream
    // diffusion's 1 / (1 + 0.75 (1 - g) tau), g = 0.85.
    float cloudShadow(vec3 g, float h, vec3 toSun, float w) {
        float mu = dot(toSun, normalize(g));
        if (mu <= 0.02) return 1.0;
        float t = max(CLOUD_BASE + 0.2 * CLOUD_DEPTH - h, 0.0) / mu;
        vec3 q = normalize(g + toSun * t);
        float sh = clamp((h - CLOUD_BASE) / CLOUD_DEPTH, 0.0, 1.0);
        float F, v, clear;
        if (!cloudColumn(q, max(w, 30.0), cloudNeed(sh), 0.0, F, v, clear)) return 1.0;
        float thick = CLOUD_BASE + cloudTop(F) * CLOUD_DEPTH - max(h, CLOUD_BASE);
        if (thick <= 0.0) return 1.0;
        float fill = cloudOccupancy(F, v, sh);
        float tau = CLOUD_SIGMA * thick / mu;
        return 1.0 - fill * (1.0 - 1.0 / (1.0 + 0.1125 * tau));
    }
`;

const volumeGlsl = (radius) => cloudGlsl(radius, true) + `
    uniform vec3 u_camHi;
    uniform vec3 u_camLo;
    uniform float u_camAlt;     // the eye's altitude over CLOUD_R
    uniform float u_pixel;      // the angle a pixel spans (rad)

    // The detail's noise: gradient noise tiling every NOISE_PERIOD lattice
    // units, NOISE_CELL texels a unit (noiseSlices), its z slices an array
    // the hardware filters across x and y; z is mixed by hand.
    uniform sampler2DArray u_cloudNoise;
    float cloudNoise(vec3 p) {
        vec3 t = p * ${NOISE_CELL}.0;
        float z = floor(t.z), f = t.z - z;
        vec2 uv = (t.xy + 0.5) / ${NOISE_TEXELS}.0;
        float l0 = mod(z, ${NOISE_TEXELS}.0), l1 = mod(z + 1.0, ${NOISE_TEXELS}.0);
        return mix(textureLod(u_cloudNoise, vec3(uv, l0), 0.0).r, textureLod(u_cloudNoise, vec3(uv, l1), 0.0).r, f);
    }
    // The column's (F, variance) as cloudColumn read them, with the detail
    // a footprint of w metres resolves at P (about the centre): the octaves
    // at full weight from 4 footprints a wavelength, none at 2.
    vec2 cloudDetailed(vec3 P, float w, float F, float variance) {
        float g = cloudDetailScale(F);
        vec2 r = vec2(F, variance);
        for (int k = 0; k < 2 && g > 0.0; k++) {
            vec3 o = CLOUD_DETAIL[k];
            float a = clamp(o.x / w * 0.5 - 1.0, 0.0, 1.0);
            if (a <= 0.0) break;
            r.x += a * g * o.y * cloudNoise(P / o.x + o.z);
            r.y -= a * a * g * g * o.y * o.y * ${NOISE_VAR};
        }
        r.y = max(r.y, 0.0);
        return r;
    }

    // The ray's distances to the sphere at altitude hs: false when it misses.
    // Written from the eye's altitude hc, so nothing squares a radius.
    bool cloudShell(float hc, float hs, float mu, out float tNear, out float tFar) {
        float r0 = CLOUD_R + hc;
        float b = r0 * mu;
        float c = (hc - hs) * (2.0 * CLOUD_R + hc + hs);   // r0^2 - r^2
        float disc = b * b - c;
        if (disc < 0.0) return false;
        float sq = sqrt(disc);
        float q = b > 0.0 ? -b - sq : -b + sq;
        float t1 = q, t2 = abs(q) > 0.0 ? c / q : 0.0;
        tNear = min(t1, t2);
        tFar = max(t1, t2);
        return true;
    }

    // The light a step of length dt scatters toward the eye, per unit of the
    // source at its start, from a medium of extinction sigma whose light
    // dims along the step at a further rate: sigma * the integral over x of
    // exp(-(sigma + rate) x). Four sub-columns at once,
    // each its own length.
    vec4 cloudStep(vec4 sigma, vec4 rate, vec4 dt) {
        vec4 r = sigma + rate;
        bvec4 some = greaterThan(abs(r), vec4(1e-7));
        vec4 rs = mix(vec4(1.0), r, some);
        return mix(sigma * dt, sigma * (1.0 - exp(-rs * dt)) / rs, some);
    }

    // How far the column's amount passes what the height needs, in
    // deviations of what the footprint leaves unresolved (the occupancy's
    // logistic argument over 1.7), at distance t along the ray from the eye
    // (an altitude of hc, mu the cosine to up) at a footprint of w metres;
    // -10 outside the layer.
    float cloudExcessAt(vec3 eye, vec3 dir, float t, float hc, float mu, float w) {
        vec3 P = eye + dir * t;
        float rp = length(P);
        float h = hc + (2.0 * (CLOUD_R + hc) * mu * t + t * t) / (rp + CLOUD_R + hc);
        float s = (h - CLOUD_BASE) / CLOUD_DEPTH;
        if (s < 0.0 || s > 1.0) return -10.0;
        float F, v, clear;
        cloudColumn(P / rp, w, cloudNeed(s), 0.0, F, v, clear);
        vec2 fd = cloudDetailed(P, w, F, v);
        return (fd.x - cloudNeed(s)) / sqrt(fd.y + 1e-5);
    }
    // The excess where the occupancy is 0.003, cloudOccupancy's threshold
    // for cloud: ln(0.003 / 0.997) / 1.7.
    const float CLOUD_EDGE = -3.415;

    float hgPhase(float g, float c) {
        float k = 1.0 + g * g - 2.0 * g * c;
        return (1.0 - g * g) / (12.566 * k * sqrt(k));
    }

    void userVolume(vec3 dir, float sceneDist, inout vec3 radiance, inout float transmittance, inout float depth) {
        vec3 up = normalize(u_camHi + u_camLo);
        float mu = dot(dir, up);
        float hc = u_camAlt;
        float lo = CLOUD_BASE, hi = CLOUD_BASE + CLOUD_DEPTH;
        float bn, bf, tn, tf;
        bool base = cloudShell(hc, lo, mu, bn, bf);
        if (!cloudShell(hc, hi, mu, tn, tf)) return;
        float t0, t1;
        if (hc > hi) {
            if (tn < 0.0) return;
            t0 = tn;
            t1 = base && bn > 0.0 ? bn : tf;
        } else if (hc >= lo) {
            t0 = 0.0;
            t1 = base && bn > 0.0 ? bn : tf;
        } else {
            t0 = base ? bf : 0.0;
            t1 = tf;
        }
        t1 = min(t1, min(sceneDist, t0 + 6.0e5));
        if (t1 <= t0) return;

        vec3 toSun = sceneToSun();
        float cosSun = dot(dir, toSun);
        // Single scattering's forward and back lobes (the silver lining; the
        // dimmer glow away from the sun).
        float phase = mix(hgPhase(-0.25, cosSun), hgPhase(0.8, cosSun), 0.7);
        vec3 eye = u_camHi + u_camLo;
        vec3 sun = vec3(0.0), sky = vec3(0.0);
        float litAt = -1.0e9;

        // Steps grow with the distance (a pixel's footprint grows with it,
        // and the field with it): 4% of the distance ahead, at least 20 m, a
        // step landing in cloud backing up to find its edge. Started at a
        // per-pixel offset, so a step's edge is grain, not bands.
        uint hp = uint(gl_FragCoord.x) * 1973u + uint(gl_FragCoord.y) * 9277u;
        hp = (hp ^ (hp >> 13)) * 0x5bd1e995u;
        // Moved on by the golden ratio each render, so a pixel's offsets
        // cover the step evenly over the renders the engine's
        // reconstruction averages (camera.frame.x).
        float jitter = fract(float((hp ^ (hp >> 15)) & 1023u) / 1024.0 + 0.618034 * camera.frame.x);
        // A pixel's ray through cloud its footprint cannot resolve crosses
        // cloudy columns and clear ones, and its light is the average over
        // them, not that of a thinner cloud everywhere: 30% cover passes 70%
        // of the light behind it, where a 30% density over kilometres passes
        // none. Columns are cloudy up to their tops (each holds cloud at every
        // height below the highest it holds; climate models' maximum
        // overlap, Geleyn and Hollingsworth 1979), so the ray is marched as
        // four sub-columns ranked by their amount, the cloudiest first to fill
        // as the occupancy rises: sub-column j is cloud, in full density,
        // where the occupancy passes its rank,
        // with its own transmittance and its own depth into the cloud. A
        // resolved field (occupancy 0 or 1) marches as one.
        const vec4 RANK = vec4(3.0, 2.0, 1.0, 0.0);
        // Each sub-column's amount about the column's, at its rank's quantile
        // of the occupancy's logistic, in deviations: ln(p / (1 - p)) / 1.7
        // at p = 1/8, 3/8, 5/8, 7/8.
        const vec4 QUANTILE = vec4(-1.1446, -0.3011, 0.3011, 1.1446);
        float t = t0;
        float sumT = 0.0, sumW = 0.0;
        vec3 L = vec3(0.0);
        // A sub-column part filled is part cover, not a thinner cloud: in
        // the cloud the ray is crossing, the share of its columns that hold
        // cloud is the most it has filled (cover, maximum overlap again), and
        // that share is crossed at the density of the fill over the cover,
        // its transmittance Tc; the rest is clear. Where the sub-column leaves
        // the cloud the mixture folds into T, what is seen through before it.
        vec4 T = vec4(1.0), cover = vec4(0.0), Tc = vec4(1.0);
        // At least a dozen steps across the layer, so its profile is sampled
        // and not hit or missed by the jitter of one step.
        float dtMax = clamp((t1 - t0) / 12.0, 20.0, 4000.0);
        float first = clamp(t0 * 0.06, 20.0, dtMax) * jitter;
        t += first;
        // Inside cloud, steps of an optical depth of at most 4 in its
        // densest sub-column still seen through.
        const float CLOUD_STEP = 4.0 / CLOUD_SIGMA;
        float inStep = CLOUD_STEP;
        float tPrev = t, fineUntil = -1.0;
        bool inCloud = false;
        // Which sub-columns the last sample found in cloud.
        vec4 inside = vec4(0.0);
        // The sun tap's tops (below), for the cloud the ray is in.
        vec4 tapTop = vec4(0.0);
        for (int i = 0; i < 96 && t < t1; i++) {
            float dt = clamp(t * 0.06, 20.0, dtMax);
            if (inCloud) dt = min(dt, inStep);
            else if (t < fineUntil) dt = min(dt, CLOUD_STEP);
            // The field at the pixel's footprint, not the step's: a step only
            // places samples (the jitter and the edge search keep it from
            // drawing contours), and the field read at it blurred every cloud
            // to tens of metres.
            float w = max(t * u_pixel, 1.0);
            vec3 P = eye + dir * t;
            float rp = length(P);
            float h = hc + (2.0 * (CLOUD_R + hc) * mu * t + t * t) / (rp + CLOUD_R + hc);
            float s = (h - lo) / CLOUD_DEPTH;
            if (s >= 0.0 && s <= 1.0) {
                float F, v, clear;
                // No cloud this high: on as far as the field provably
                // stays below the ray, rising at most by its gradient
                // bound along the layer while what the ray's height needs
                // falls as it descends.
                float drop = cloudNeedSlope(s) * max(-dot(dir, P / rp), 0.0) / CLOUD_DEPTH;
                if (!cloudColumn(P / rp, w, cloudNeed(s), drop, F, v, clear)) {
                    tPrev = t + clear;   // proved empty this far
                    inCloud = false;
                    inside = vec4(0.0);
                    T *= 1.0 - cover + cover * Tc;
                    cover = vec4(0.0);
                    Tc = vec4(1.0);
                    t += max(dt, clear);
                    continue;
                }
                vec2 fd = cloudDetailed(P, w, F, v);
                float occ = cloudOccupancy(fd.x, fd.y, s);
                if (occ > 0.003) {
                    // A step that lands in cloud has passed its edge since
                    // the last point known clear: the gap halved five times
                    // finds it, and the cloud is taken from there, on at
                    // most CLOUD_STEP until it is crossed, so its edge is
                    // where the field puts it and not where the step fell
                    // (every step's reach drew a contour across the tops).
                    if (!inCloud && t - tPrev > 1.0) {
                        float a = tPrev, b = t;
                        for (int k = 0; k < 5; k++) {
                            float m = 0.5 * (a + b);
                            if (cloudExcessAt(eye, dir, m, hc, mu, w) > CLOUD_EDGE) b = m;
                            else a = m;
                        }
                        // The sample is taken there, at the same footprint.
                        fineUntil = t;
                        t = b;
                        tPrev = b;
                        P = eye + dir * t;
                        rp = length(P);
                        h = hc + (2.0 * (CLOUD_R + hc) * mu * t + t * t) / (rp + CLOUD_R + hc);
                        s = (h - lo) / CLOUD_DEPTH;
                        cloudColumn(P / rp, w, cloudNeed(s), 0.0, F, v, clear);
                        fd = cloudDetailed(P, w, F, v);
                        occ = max(cloudOccupancy(fd.x, fd.y, s), 0.0031);
                        dt = min(dt, CLOUD_STEP);
                    }
                    inCloud = true;
                    vec4 fill = clamp(occ * 4.0 - RANK, 0.0, 1.0);
                    // A sub-column out of cloud again folds its mixture.
                    vec4 gone = vec4(equal(fill, vec4(0.0))) * vec4(greaterThan(cover, vec4(0.0)));
                    T *= mix(vec4(1.0), 1.0 - cover + cover * Tc, gone);
                    cover *= 1.0 - gone;
                    Tc = mix(Tc, vec4(1.0), gone);
                    // More cover: the columns it adds are clear so far.
                    vec4 grown = max(cover, fill);
                    Tc = mix(vec4(1.0), (cover * Tc + grown - cover) / max(grown, 1e-4), greaterThan(grown, vec4(0.0)));
                    cover = grown;
                    vec4 sigma = CLOUD_SIGMA * fill / max(cover, 1e-4);
                    vec3 upP = P / rp;
                    float muS = max(dot(toSun, upP), 0.04);
                    // The cloud between the point and the sun: the column
                    // above it up to the sub-column's own top (bright tops,
                    // dark bases), at the sun's slant, deepening along the
                    // step as the ray descends and thinning as it rises.
                    float descent = -dot(dir, upP);
                    float dev = sqrt(v);
                    vec4 top = vec4(cloudTop(F + dev * QUANTILE.x), cloudTop(F + dev * QUANTILE.y),
                                    cloudTop(F + dev * QUANTILE.z), cloudTop(F + dev * QUANTILE.w));
                    vec4 above = max(top - s, 0.0) * CLOUD_DEPTH;
                    // And the cloud the sun's ray meets on its way out, which
                    // shades a top's far side behind the bumps toward the
                    // sun: one tap where the ray has climbed 200 m over
                    // this column's highest top. The ray's first half
                    // passes through this column, its second through that
                    // one, each up to its own tops.
                    float rise = max(top.w - s, 0.0) * CLOUD_DEPTH + 200.0;
                    float sMid = s + 0.5 * rise / CLOUD_DEPTH, sOut = s + rise / CLOUD_DEPTH;
                    vec3 Pl = P + toSun * (rise / muS);
                    // Taken where the ray enters a cloud and kept while it
                    // stays in it: the steps after are seen through the
                    // cloud in front.
                    if (inside == vec4(0.0)) {
                        float Fl, vl, cl;
                        tapTop = vec4(0.0);
                        if (cloudColumn(normalize(Pl), max(w, 0.25 * rise / muS), CLOUD_FLOOR, 0.0, Fl, vl, cl)) {
                            float devL = sqrt(vl);
                            tapTop = vec4(cloudTop(Fl + devL * QUANTILE.x), cloudTop(Fl + devL * QUANTILE.y),
                                          cloudTop(Fl + devL * QUANTILE.z), cloudTop(Fl + devL * QUANTILE.w));
                        }
                    }
                    vec4 topL = tapTop;
                    vec4 path = (clamp(top, s, sMid) - s) + (clamp(topL, sMid, sOut) - sMid);
                    vec4 tauSun = CLOUD_SIGMA * path * CLOUD_DEPTH / muS;
                    vec4 rate = mix(vec4(0.0), vec4(CLOUD_SIGMA * descent / muS), greaterThan(above, vec4(0.0)));
                    // A sub-column the ray came down into since the last
                    // sample is integrated from the top it crossed, where
                    // the sun's depth is nothing: a sample lands anywhere up
                    // to a step below a top, and how deep would set how much
                    // sun the whole step sees (contours of the step on every
                    // top, or with the jitter, grain).
                    vec4 back = descent > 0.05 ? (1.0 - inside) * min(above / descent, vec4(t - tPrev)) : vec4(0.0);
                    tauSun = max(tauSun - rate * back, 0.0);
                    vec4 len = dt + back;
                    // The sun and the sky through the air, taken where the ray
                    // first meets cloud and again every 20 km along it: they
                    // change over the air, not over a cloud.
                    if (t > litAt + 20000.0) {
                        vec3 pos = dir * t;
                        sun = volumeSunLight(pos);
                        // The sky's radiance (its irradiance over pi) scattered
                        // evenly from the hemisphere above: half of it.
                        sky = 0.5 * volumeSkyLight(pos, upP);
                        litAt = t;
                    }
                    // Over the step, in closed form (Hillaire 2016, with the
                    // sun's depth changing linearly along it): a step the
                    // size of a cloud still lights its top as brightly as its
                    // first metres are lit. Single scattering in the phase;
                    // the light scattered many times as what reaches that
                    // depth: near a surface it falls fast with the depth the
                    // sun crossed (the first few scatterings, Wrenninge's
                    // octaves: a top's far side is in its own shade), deep
                    // in, as slowly as diffusion through a thick slab carries
                    // it, 1 / (1 + 0.75 (1 - g) tau) (cloudShadow's), so a
                    // deck's top glows near white (thick cloud reflects some
                    // 85%) and its base is a lit grey, not black. The sky
                    // the same, through the depth straight up.
                    vec4 stepT = exp(-sigma * len);
                    vec4 fillStep = cloudStep(sigma, vec4(0.0), len);
                    vec4 bySun = phase * exp(-tauSun) * cloudStep(sigma, rate, len)
                               + (0.85 * muS / 3.14159) * (0.55 * exp(-0.6 * tauSun) + 0.45 / (1.0 + 0.1125 * tauSun)) * fillStep;
                    vec4 bySky = fillStep / (1.0 + 0.1125 * muS * tauSun);
                    vec4 W = T * cover * Tc;
                    L += 0.25 * (sun * dot(W, bySun) + sky * dot(W, bySky));
                    float wgt = 0.25 * dot(W, 1.0 - stepT);
                    sumT += wgt * t;
                    sumW += wgt;
                    Tc *= stepT;
                    inside = vec4(greaterThan(fill, vec4(0.0)));
                    vec4 seen = T * (1.0 - cover + cover * Tc);
                    if (max(max(seen.x, seen.y), max(seen.z, seen.w)) < 0.004) break;
                    // The next step by the densest sub-column whose cloud
                    // is still seen: one gone dark no longer needs it
                    // sampled finely, and in part cover the clear ones
                    // would otherwise be crossed at its pace.
                    vec4 dense = fill * vec4(greaterThan(T * cover * Tc, vec4(0.004)));
                    inStep = CLOUD_STEP / max(max(max(dense.x, dense.y), max(dense.z, dense.w)), 0.05);
                } else {
                    inCloud = false;
                    inside = vec4(0.0);
                    T *= 1.0 - cover + cover * Tc;
                    cover = vec4(0.0);
                    Tc = vec4(1.0);
                }
            } else {
                inCloud = false;
                inside = vec4(0.0);
                T *= 1.0 - cover + cover * Tc;
                cover = vec4(0.0);
                Tc = vec4(1.0);
            }
            tPrev = t;
            t += dt;
        }
        T *= 1.0 - cover + cover * Tc;
        float Tm = 0.25 * (T.x + T.y + T.z + T.w);
        radiance = L;
        transmittance = Tm < 0.004 ? 0.0 : Tm;
        depth = sumW > 0.0 ? sumT / sumW : 0.0;
    }
`;

// The clouds' volume in `scene`, its column field produced by `kernel`
// (clouds.bk k_cloud_level) and bound to it and to each of `readers` (nodes
// whose chunks include cloudGlsl, for the shadows). update() each frame with
// the eye about the planet's centre (f64), its altitude and the view's pixel
// angle.
export function createClouds(scene, radius, kernel, readers) {
    const node = scene.createVolume({ fragment: volumeGlsl(radius), name: 'clouds' });
    node.setShaderTexture('u_cloudNoise', { data: noiseSlices(), width: NOISE_TEXELS, height: NOISE_TEXELS, layers: NOISE_TEXELS, repeat: true });
    const nodes = [node, ...readers];
    const map = bro.kernel.createBuffer((GLOBE_BASE + 6 * FACE_TEXELS) * 8);
    // u_cloudHead: LEVELS + 1 headers, then each level's grid origin in
    // texels (where its wrapped grid starts).
    const head = new Float32Array(4 * (2 * LEVELS + 1));
    const headBuffer = bro.kernel.createBuffer(head.byteLength);
    // Texels [x0, x0 + w) x [y0, y0 + h) of the grid of n a row at texel base.
    const dispatch = (base, n, x0, y0, w, h, frame, o, delta) => {
        if (w > 0 && h > 0) kernel.dispatch([w, h], map, base, n, x0, y0,
            frame.a[0], frame.a[1], frame.a[2], frame.e[0], frame.e[1], frame.e[2], frame.f[0], frame.f[1], frame.f[2],
            o, delta, radius);
    };

    for (let i = 0; i < 6; i++) dispatch(GLOBE_BASE + i * FACE_TEXELS, FACE + 2, 0, 0, FACE + 2, FACE + 2, faceFrame(i), -1 - DELTA_GLOBE, DELTA_GLOBE);
    head[4 * LEVELS] = DELTA_GLOBE;
    head[4 * LEVELS + 3] = gradientBound(2 * radius * DELTA_GLOBE * 0.35);

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
            for (const n of nodes) {
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
            } else {
                // The columns stepped onto, then the rows over the columns
                // kept.
                if (ox > px) dispatch(base, N, px + N, oy, ox - px, N, frame, 0, delta);
                else dispatch(base, N, ox, oy, px - ox, N, frame, 0, delta);
                const kx = Math.max(ox, px), kw = Math.min(ox, px) + N - kx;
                if (oy > py) dispatch(base, N, kx, py + N, kw, oy - py, frame, 0, delta);
                else dispatch(base, N, kx, oy, kw, py - oy, frame, 0, delta);
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
    for (const n of nodes) {
        n.setShaderBuffer('u_cloudMap', map);
        n.setShaderBuffer('u_cloudHead', headBuffer);
    }
    node.setShaderTexture('u_cloudLevels', { buffer: map, width: N, height: N, layers: LEVELS, channels: 2, repeat: true });
    return {
        node,
        // The clipmap, for tests: its buffer, the level headers (u_cloudHead)
        // and layout, and the eye's face.
        map, head, layout: { levels: LEVELS, n: N, globe: GLOBE_BASE, faceTexels: FACE_TEXELS },
        get face() { return face; },
        update(eye, altitude, pixelAngle) {
            produce(eye);
            for (let k = 0; k < 3; k++) {
                hi[k] = Math.fround(eye[k]);
                lo[k] = eye[k] - hi[k];
            }
            node.setShaderUniform('u_camHi', hi);
            node.setShaderUniform('u_camLo', lo);
            node.setShaderUniform('u_camAlt', altitude);
            node.setShaderUniform('u_pixel', pixelAngle);
        },
    };
}
