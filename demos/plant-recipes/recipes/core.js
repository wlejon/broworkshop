// Shared math, palette, and morphological primitives for procedural plants.
//
// Stage builders (in the per-archetype recipe files) compose these small
// pieces — a seed shape, a cotyledon pair, a bloom cluster, an autumn-tint
// helper, a thorn cluster — to construct each life-cycle stage.

(function (root) {

// ─── Math helpers ─────────────────────────────────────────────────────────

const TAU = Math.PI * 2;

function v3(x, y, z) { return [x, y, z]; }
function vAdd(a, b) { return [a[0]+b[0], a[1]+b[1], a[2]+b[2]]; }
function vSub(a, b) { return [a[0]-b[0], a[1]-b[1], a[2]-b[2]]; }
function vScale(a, s) { return [a[0]*s, a[1]*s, a[2]*s]; }
function vDot(a, b) { return a[0]*b[0] + a[1]*b[1] + a[2]*b[2]; }
function vCross(a, b) {
    return [a[1]*b[2]-a[2]*b[1], a[2]*b[0]-a[0]*b[2], a[0]*b[1]-a[1]*b[0]];
}
function vLen(a) { return Math.sqrt(vDot(a, a)); }
function vNorm(a) {
    const L = vLen(a);
    return L > 1e-8 ? [a[0]/L, a[1]/L, a[2]/L] : [0, 1, 0];
}
function vNormOr(a, fallback) {
    const L = vLen(a);
    return L > 1e-8 ? [a[0]/L, a[1]/L, a[2]/L] : fallback;
}

function clamp(x, lo, hi) { return x < lo ? lo : (x > hi ? hi : x); }
function lerp(a, b, t) { return a + (b - a) * t; }
function lerp3(a, b, t) { return [lerp(a[0],b[0],t), lerp(a[1],b[1],t), lerp(a[2],b[2],t)]; }

function mulberry32(seed) {
    let s = (seed >>> 0) || 1;
    return function () {
        s = (s + 0x6D2B79F5) >>> 0;
        let t = s;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

function smoothstep(edge0, edge1, x) {
    const t = clamp((x - edge0) / Math.max(1e-6, edge1 - edge0), 0, 1);
    return t * t * (3 - 2 * t);
}

// ─── AABB helpers ─────────────────────────────────────────────────────────

function emptyAabb() {
    return { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] };
}

function aabbInclude(aabb, p, r) {
    r = r || 0;
    if (p[0] - r < aabb.min[0]) aabb.min[0] = p[0] - r;
    if (p[1] - r < aabb.min[1]) aabb.min[1] = p[1] - r;
    if (p[2] - r < aabb.min[2]) aabb.min[2] = p[2] - r;
    if (p[0] + r > aabb.max[0]) aabb.max[0] = p[0] + r;
    if (p[1] + r > aabb.max[1]) aabb.max[1] = p[1] + r;
    if (p[2] + r > aabb.max[2]) aabb.max[2] = p[2] + r;
}

function finalizeAabb(aabb, fallback) {
    if (!isFinite(aabb.min[0])) {
        return { aabbMin: fallback.min, aabbMax: fallback.max };
    }
    return { aabbMin: aabb.min, aabbMax: aabb.max };
}

// ─── Color utilities ──────────────────────────────────────────────────────

function hexToRgb(hex) {
    if (Array.isArray(hex)) return hex.slice();
    const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(String(hex || ''));
    if (!m) return [0.4, 0.6, 0.3];
    return [parseInt(m[1], 16) / 255, parseInt(m[2], 16) / 255, parseInt(m[3], 16) / 255];
}

function tint(rgb, target, amount) {
    return [
        lerp(rgb[0], target[0], amount),
        lerp(rgb[1], target[1], amount),
        lerp(rgb[2], target[2], amount),
    ];
}

// Shift a color toward autumn (varies between yellow, orange, red by phase).
// `t` ∈ [0,1] — 0 = no shift, 1 = full autumn.
function autumnTint(rgb, t, phase) {
    if (t <= 0) return rgb.slice();
    const tt = clamp(t, 0, 1);
    const targets = [
        [0.86, 0.62, 0.18],   // yellow-orange
        [0.78, 0.32, 0.10],   // amber
        [0.62, 0.16, 0.10],   // red-brown
        [0.34, 0.22, 0.14],   // brown
    ];
    const p = clamp(phase || 0, 0, 0.999);
    const idx = Math.min(targets.length - 2, Math.floor(p * (targets.length - 1)));
    const local = p * (targets.length - 1) - idx;
    const target = lerp3(targets[idx], targets[idx + 1], local);
    return tint(rgb, target, tt);
}

// ─── Palette ──────────────────────────────────────────────────────────────

const PALETTE = {
    bark:        [0.42, 0.28, 0.16],
    barkLight:   [0.50, 0.36, 0.22],
    barkDark:    [0.30, 0.20, 0.12],
    barkBirch:   [0.85, 0.83, 0.76],
    barkPalm:    [0.50, 0.36, 0.22],
    barkRose:    [0.36, 0.26, 0.18],

    canopyOak:   [0.30, 0.55, 0.22],
    canopyMaple: [0.42, 0.62, 0.20],
    canopyPine:  [0.18, 0.40, 0.20],
    canopyShrub: [0.32, 0.58, 0.24],
    canopyVine:  [0.34, 0.56, 0.22],

    succulent:   [0.40, 0.62, 0.32],
    fernLeaf:    [0.30, 0.50, 0.22],
    grassBlade:  [0.36, 0.58, 0.22],

    seedBrown:   [0.42, 0.28, 0.14],
    seedTan:     [0.78, 0.62, 0.32],
    sprout:      [0.55, 0.78, 0.30],
    cotyledon:   [0.62, 0.82, 0.34],
    rosePink:    [0.92, 0.32, 0.45],
    roseRed:     [0.78, 0.10, 0.18],
    roseHip:     [0.72, 0.16, 0.10],
    sunflower:   [1.00, 0.78, 0.20],
    sunflowerCenter: [0.42, 0.18, 0.06],
    daisyWhite:  [0.96, 0.94, 0.86],
    tulipRed:    [0.86, 0.16, 0.18],
    cactusGreen: [0.32, 0.50, 0.28],
    cactusFlower:[0.95, 0.80, 0.30],
};

// ─── Geometry helpers ─────────────────────────────────────────────────────

function circleProfile(n, r) {
    const out = [];
    for (let i = 0; i < n; i++) {
        const a = TAU * i / n;
        out.push([Math.cos(a) * r, Math.sin(a) * r]);
    }
    return out;
}

function buildBlob(center, radius, seed, opts) {
    opts = opts || {};
    return Mesh.blob({
        radius,
        seed: seed | 0,
        nsub: opts.nsub ?? 2,
        scale: [opts.sx ?? 1, opts.sy ?? 1, opts.sz ?? 1],
        center,
    });
}

function buildCone(baseRadius, height, slices, stacks) {
    return Mesh.cone(baseRadius, height, slices || 12, stacks || 2, true);
}

// Build a tiny tapered tube along [from..to]. Used for seedling stems,
// thorns, cactus spines.
function tinyTube(from, to, baseR, tipR, sides) {
    const m = Mesh.tube([from, to], [baseR, tipR ?? baseR], sides ?? 5);
    return m;
}

// ─── Morphological primitives ─────────────────────────────────────────────
// Each returns `{parts: [...]}` so stage builders can spread them in.

// Seed sitting on the ground at (cx, 0, cz). `archetype` picks the rough
// shape; `species` overrides color from the species table when available.
function seedShape(opts) {
    const seed = opts.seed | 0 || 1;
    const radius = opts.radius ?? 0.06;
    const color = opts.color || PALETTE.seedBrown;
    const cx = opts.x ?? 0, cz = opts.z ?? 0;
    const sx = opts.sx ?? 1.1;
    const sy = opts.sy ?? 0.55;
    const sz = opts.sz ?? 1.1;
    // Sit the seed mostly on ground level (its bottom touches y=0).
    const cy = radius * sy * 0.55;
    const m = buildBlob([cx, cy, cz], radius, seed ^ 0xA1A1, { nsub: 2, sx, sy, sz });
    return {
        parts: [{ mesh: m, color, metallic: 0, roughness: 0.85 }],
        height: cy + radius * sy,
    };
}

// Two opposite cotyledon-shaped leaf cards on a tiny stem.
function cotyledonPair(opts) {
    const stemH = opts.stemH ?? 0.04;
    const stemR = opts.stemR ?? 0.005;
    const leafLen = opts.leafLen ?? 0.04;
    const leafW = opts.leafW ?? 0.025;
    const stemColor = opts.stemColor || PALETTE.sprout;
    const leafColor = opts.leafColor || PALETTE.cotyledon;

    const parts = [];
    const stem = Mesh.tube([[0, 0, 0], [0, stemH, 0]], [stemR, stemR * 0.7], 5);
    if (stem) parts.push({ mesh: stem, color: stemColor, metallic: 0, roughness: 0.85, twoSided: false });

    for (let i = 0; i < 2; i++) {
        const leaf = Mesh.leafCard('oval', {
            width: leafW, length: leafLen, bend: 0.15, fullUV: true,
            stemOffset: true, lengthSegments: 6,
        });
        stripVertexColors(leaf);
        leaf.rotate(0, 1, 0, Math.PI * 0.5);
        leaf.rotate(0, 0, 1, Math.PI * 0.5 + Math.PI * 0.06);
        leaf.rotate(0, 1, 0, i === 0 ? 0 : Math.PI);
        leaf.translate(0, stemH * 0.95, 0);
        parts.push({ mesh: leaf, color: leafColor, metallic: 0, roughness: 0.78 });
    }

    return { parts, height: stemH + leafLen * 0.4 };
}

// First true leaves: a thin stem with N small leaves arranged spirally.
function firstTrueLeaves(opts) {
    const seed = opts.seed | 0 || 1;
    const stemH = opts.stemH ?? 0.10;
    const stemR = opts.stemR ?? 0.006;
    const leafCount = Math.max(2, opts.leafCount ?? 4);
    const leafLen = opts.leafLen ?? 0.06;
    const leafW = opts.leafW ?? 0.03;
    const leafShape = opts.leafShape || 'oval';
    const stemColor = opts.stemColor || PALETTE.sprout;
    const leafColor = opts.leafColor || PALETTE.canopyShrub;

    const parts = [];
    const stem = Mesh.tube([[0, 0, 0], [0, stemH, 0]], [stemR * 1.1, stemR * 0.6], 5);
    if (stem) parts.push({ mesh: stem, color: stemColor, metallic: 0, roughness: 0.85, twoSided: false });

    const rng = mulberry32(seed);
    for (let i = 0; i < leafCount; i++) {
        const t = (i + 0.5) / leafCount;
        const a = i * 2.39996323 + rng() * 0.4;
        const leaf = Mesh.leafCard(leafShape, {
            width: leafW * (0.9 + rng() * 0.2),
            length: leafLen * (0.85 + rng() * 0.3),
            bend: 0.25,
            fullUV: true,
        });
        stripVertexColors(leaf);
        leaf.rotate(0, 1, 0, Math.PI * 0.5);
        leaf.rotate(0, 0, 1, Math.PI * 0.4);
        leaf.rotate(0, 1, 0, a);
        leaf.translate(0, stemH * (0.55 + 0.40 * t), 0);
        parts.push({ mesh: leaf, color: leafColor, metallic: 0, roughness: 0.78 });
    }
    return { parts, height: stemH + leafLen * 0.5 };
}

// A scatter of small spherical blooms attached to anchor points (typically
// branch tips or canopy-anchor positions). Used for cherry blossoms,
// magnolia, sunflower-on-tree clusters, etc. when geometry-heavy
// Mesh.flower() per anchor would be overkill.
function bloomCluster(opts) {
    const anchors = opts.anchors || [];
    const seed = opts.seed | 0 || 1;
    const color = opts.color || PALETTE.rosePink;
    const radius = opts.radius ?? 0.08;
    const density = clamp(opts.density ?? 1, 0, 1);
    const useFlower = opts.useFlower !== false;
    const petalCount = opts.petalCount ?? 6;
    const layers = opts.layers ?? 1;
    const centerColor = opts.centerColor || PALETTE.sunflower;
    const petalShape = opts.petalShape || 'petal';
    const rng = mulberry32(seed);

    const parts = [];
    for (let i = 0; i < anchors.length; i++) {
        if (rng() > density) continue;
        const a = anchors[i];
        if (useFlower && radius >= 0.05) {
            const head = Mesh.flower({
                petalCount,
                petalShape,
                petalLength: radius * 0.95,
                petalWidth:  radius * 0.55,
                petalCurl:   opts.petalCurl ?? 0.2,
                petalBend:   opts.petalBend ?? 0.5,
                layers,
                layerTwist:  0.45,
                centerRadius: radius * 0.30,
                centerHeight: radius * 0.18,
                centerColor,
            });
            if (head) {
                stripVertexColors(head);
                const tilt = (rng() - 0.5) * 0.6;
                const yaw = rng() * TAU;
                head.rotate(0, 1, 0, yaw);
                head.rotate(1, 0, 0, tilt);
                head.translate(a[0], a[1], a[2]);
                parts.push({ mesh: head, color, metallic: 0, roughness: 0.7 });
            }
        } else {
            // Lightweight dot — just a small displaced sphere.
            const blob = buildBlob([a[0], a[1], a[2]],
                radius * (0.7 + rng() * 0.4),
                (seed * 31 + i * 17) ^ 0xB100,
                { nsub: 1 });
            parts.push({ mesh: blob, color, metallic: 0, roughness: 0.7 });
        }
    }
    return { parts };
}

// Fruit cluster — a few small displaced spheres at anchor points.
function fruitCluster(opts) {
    const anchors = opts.anchors || [];
    const seed = opts.seed | 0 || 1;
    const color = opts.color || PALETTE.roseHip;
    const radius = opts.radius ?? 0.05;
    const density = clamp(opts.density ?? 0.8, 0, 1);
    const sag = opts.sag ?? 0.25;     // how much fruit hangs below the anchor
    const rng = mulberry32(seed);
    const parts = [];
    for (let i = 0; i < anchors.length; i++) {
        if (rng() > density) continue;
        const a = anchors[i];
        const r = radius * (0.75 + rng() * 0.5);
        const c = [a[0] + (rng() - 0.5) * radius * 0.4,
                   a[1] - r * sag,
                   a[2] + (rng() - 0.5) * radius * 0.4];
        const blob = buildBlob(c, r, (seed * 53 + i * 13) ^ 0xF210,
            { nsub: 1, sy: 1.05 });
        parts.push({ mesh: blob, color, metallic: 0, roughness: 0.55 });
    }
    return { parts };
}

// Thorns: a handful of tiny tapered tubes branching off a list of branch
// segments (or arbitrary positions+tangents). Used for rose, hawthorn.
function thornCluster(opts) {
    const segs = opts.segments || [];
    const positions = opts.positions || [];   // [{p, tangent}]
    const seed = opts.seed | 0 || 1;
    const length = opts.length ?? 0.025;
    const baseR = opts.baseR ?? 0.005;
    const density = opts.density ?? 0.4;      // per unit length on segs
    const color = opts.color || PALETTE.barkRose;
    const minRadius = opts.minRadius ?? 0;
    const rng = mulberry32(seed);

    const parts = [];
    function addThorn(from, tangent, side) {
        // Pick a perpendicular axis to tangent; rotate around tangent by `side`.
        const t = vNormOr(tangent, [0, 1, 0]);
        let ortho = vCross(t, [0, 0, 1]);
        if (vLen(ortho) < 0.3) ortho = vCross(t, [1, 0, 0]);
        ortho = vNorm(ortho);
        const bi = vCross(t, ortho);
        const c = Math.cos(side), s = Math.sin(side);
        const dir = vNorm([
            ortho[0] * c + bi[0] * s,
            ortho[1] * c + bi[1] * s,
            ortho[2] * c + bi[2] * s,
        ]);
        const tip = [from[0] + dir[0] * length,
                     from[1] + dir[1] * length,
                     from[2] + dir[2] * length];
        const m = Mesh.tube([from, tip], [baseR, baseR * 0.15], 4);
        if (m) parts.push({ mesh: m, color, metallic: 0, roughness: 0.6, twoSided: false });
    }

    // Spawn thorns along provided segments.
    for (const s of segs) {
        if (s.radius !== undefined && s.radius < minRadius) continue;
        const dx = s.to[0] - s.from[0];
        const dy = s.to[1] - s.from[1];
        const dz = s.to[2] - s.from[2];
        const len = Math.sqrt(dx*dx + dy*dy + dz*dz);
        if (len < 1e-3) continue;
        const expected = len * density;
        // Random Poisson-ish count.
        const n = Math.floor(expected) + (rng() < (expected - Math.floor(expected)) ? 1 : 0);
        for (let i = 0; i < n; i++) {
            const t = rng();
            const p = [s.from[0] + dx*t, s.from[1] + dy*t, s.from[2] + dz*t];
            addThorn(p, [dx/len, dy/len, dz/len], rng() * TAU);
        }
    }
    for (const pp of positions) {
        addThorn(pp.p || pp[0], pp.tangent || pp[1] || [0, 1, 0], (pp.side ?? rng() * TAU));
    }
    return { parts };
}

// Spines for cactus — short straight tubes/cones radiating from a surface.
function spineCluster(opts) {
    const seed = opts.seed | 0 || 1;
    const center = opts.center || [0, 0, 0];
    const surfaceRadius = opts.surfaceRadius ?? 0.5;
    const surfaceHeight = opts.surfaceHeight ?? surfaceRadius * 2;
    const count = Math.max(0, opts.count ?? 80);
    const length = opts.length ?? 0.04;
    const color = opts.color || [0.96, 0.94, 0.84];
    const yMin = opts.yMin ?? -surfaceHeight * 0.45;
    const yMax = opts.yMax ?? surfaceHeight * 0.45;
    const rng = mulberry32(seed);

    const parts = [];
    for (let i = 0; i < count; i++) {
        const a = rng() * TAU;
        const y = lerp(yMin, yMax, rng());
        // Project onto surface — for an oblate ellipsoid, scale radius by
        // sqrt(1 - (y/halfH)^2) (rough). Cylinder is fine for barrel.
        const halfH = (yMax - yMin) * 0.5;
        const yMid = (yMax + yMin) * 0.5;
        const k = Math.sqrt(Math.max(0, 1 - Math.pow((y - yMid) / Math.max(1e-3, halfH), 2)));
        const r = surfaceRadius * (0.85 + 0.15 * k);
        const from = [center[0] + Math.cos(a) * r * 0.99,
                      center[1] + y,
                      center[2] + Math.sin(a) * r * 0.99];
        const dir = [Math.cos(a), 0, Math.sin(a)];
        const tip = [from[0] + dir[0] * length,
                     from[1] + dir[1] * length * (rng() * 0.4 - 0.2),
                     from[2] + dir[2] * length];
        const m = Mesh.tube([from, tip], [length * 0.06, length * 0.01], 4);
        if (m) parts.push({ mesh: m, color, metallic: 0, roughness: 0.5, twoSided: false });
    }
    return { parts };
}

// Wither / drop foliage — produce nothing (helper present so callers can
// gate on it). Stage builders typically just thin their blob/leaf count and
// shift the canopy color via autumnTint for senescent stages.

// Mesh.leafCard bakes the windBend animation parameter into the red
// vertex-color channel (0 at base, 1 at tip). When the scene shader
// multiplies vertex color × material color, that turns leaf cards red
// where they should be the configured leaf/petal color. Until wind is
// wired into a shader uniform, we strip the colors so material color
// is used directly.
function stripVertexColors(mesh) {
    if (!mesh) return mesh;
    // Try to remove the colors buffer entirely. If the binding refuses,
    // we fall back to overwriting with white (which gives white output if
    // the shader uses vertex color verbatim, but greyscale-multiplies fine
    // if it multiplies). In practice on this engine, assigning an empty
    // array removes the buffer and the scene uses the material color.
    try { mesh.colors = new Float32Array(0); return mesh; } catch (e) {}
    try { mesh.colors = null; return mesh; } catch (e) {}
    return mesh;
}

root.FloraCore = {
    TAU,
    v3, vAdd, vSub, vScale, vDot, vCross, vLen, vNorm, vNormOr,
    clamp, lerp, lerp3,
    mulberry32, smoothstep,
    emptyAabb, aabbInclude, finalizeAabb,
    hexToRgb, tint, autumnTint,
    PALETTE,
    circleProfile, buildBlob, buildCone, tinyTube,
    seedShape, cotyledonPair, firstTrueLeaves,
    bloomCluster, fruitCluster, thornCluster, spineCluster,
    stripVertexColors,
};

})(this);
