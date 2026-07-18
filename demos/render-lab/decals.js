// decals.js — projected decals.
//
// A decal in bro is a box volume, not a quad: the renderer reconstructs each
// opaque pixel's world position from the depth buffer, discards everything
// outside the unit box [-0.5,0.5]^3 (scaled by the node), and blends
// `texture * modulate` onto what is already lit. Two consequences drive the
// whole design of this module:
//
//   1. The box must STRADDLE the receiving surface. A box that merely sits on
//      top of the floor projects onto nothing, because no reconstructed pixel
//      falls inside it. Every decal here is centred on the hit point, so half
//      the box is above the surface and half below.
//   2. Projection runs down the node's local -Y. Aiming a decal at a wall is
//      therefore a rotation problem, not a position problem — see
//      `orientFromNormal` below.
//
// createDecal takes raw pixel data ({ width, height, data: Uint8Array }), so
// unlike the colour LUTs in chunk 1 these textures are generated in-process
// and never touch the filesystem.

// --- procedural textures -----------------------------------------------------
// Three decals, each chosen to exercise a different part of the blend: an
// impact splat (hard alpha, dark core), a grime patch (soft, wide, low alpha)
// and a blob shadow (pure alpha ramp, tinted black by `modulate`).

const TEX = 128;

const clamp01 = (v) => v < 0 ? 0 : v > 1 ? 1 : v;
const smoothstep = (a, b, x) => {
    const t = clamp01((x - a) / (b - a));
    return t * t * (3 - 2 * t);
};

/** Deterministic LCG — the pre-placed decals must look identical every run. */
function rng(seed) {
    let s = seed >>> 0;
    return () => {
        s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
        return s / 4294967296;
    };
}

/** Bilinear value noise on a `cells`-wide lattice, smoothstep-interpolated. */
function valueNoise(size, cells, seed) {
    const rand = rng(seed);
    const stride = cells + 1;
    const grid = new Float32Array(stride * stride);
    for (let i = 0; i < grid.length; ++i) grid[i] = rand();

    const out = new Float32Array(size * size);
    for (let y = 0; y < size; ++y) {
        const fy = y / size * cells;
        const y0 = Math.floor(fy), sy = smoothstep(0, 1, fy - y0);
        for (let x = 0; x < size; ++x) {
            const fx = x / size * cells;
            const x0 = Math.floor(fx), sx = smoothstep(0, 1, fx - x0);
            const a = grid[y0 * stride + x0],       b = grid[y0 * stride + x0 + 1];
            const c = grid[(y0 + 1) * stride + x0], d = grid[(y0 + 1) * stride + x0 + 1];
            const top = a + (b - a) * sx;
            out[y * size + x] = top + ((c + (d - c) * sx) - top) * sy;
        }
    }
    return out;
}

/** Sum of octaves — one call gives the mottling every one of these textures wants. */
function fbm(size, cells, octaves, seed) {
    const out = new Float32Array(size * size);
    let amp = 1, total = 0;
    for (let o = 0; o < octaves; ++o) {
        const layer = valueNoise(size, cells << o, seed + o * 977);
        for (let i = 0; i < out.length; ++i) out[i] += layer[i] * amp;
        total += amp;
        amp *= 0.5;
    }
    for (let i = 0; i < out.length; ++i) out[i] /= total;
    return out;
}

/**
 * Walk every texel with a callback returning [r, g, b, a] in 0..1, where
 * `u`/`v` are centred coordinates in -1..1 and `r` is the radius from centre.
 */
function bake(fn) {
    const data = new Uint8Array(TEX * TEX * 4);
    for (let y = 0; y < TEX; ++y) {
        for (let x = 0; x < TEX; ++x) {
            const i = y * TEX + x;
            const u = (x + 0.5) / TEX * 2 - 1;
            const v = (y + 0.5) / TEX * 2 - 1;
            const px = fn(u, v, Math.hypot(u, v), i);
            data[i * 4 + 0] = clamp01(px[0]) * 255;
            data[i * 4 + 1] = clamp01(px[1]) * 255;
            data[i * 4 + 2] = clamp01(px[2]) * 255;
            data[i * 4 + 3] = clamp01(px[3]) * 255;
        }
    }
    return { width: TEX, height: TEX, data };
}

/** Bullet/impact splat: black punch-through core, radiating cracks, soot halo. */
function makeImpactTexture() {
    const n = fbm(TEX, 6, 3, 1171);
    return bake((u, v, r, i) => {
        const ang = Math.atan2(v, u);
        // Six cracks, warped by noise so they are not a clean asterisk.
        const spoke = Math.abs(Math.sin(ang * 3 + n[i] * 5.5));
        const core  = 1 - smoothstep(0.05, 0.17, r);
        const crack = (1 - smoothstep(0.14, 0.60, r)) * Math.pow(1 - spoke, 9);
        const soot  = (1 - smoothstep(0.08, 0.52, r)) * (0.30 + 0.55 * n[i]);

        let a = clamp01(core + crack * 0.95 + soot * 0.5);
        a *= 1 - smoothstep(0.60, 0.80, r);      // fade before the box edge

        // Soot is warm-grey, the core is near-black.
        const shade = 0.05 + 0.16 * n[i] * (1 - core);
        return [shade * 1.05, shade * 0.98, shade * 0.90, a];
    });
}

/** Grime / oil stain: wide, soft, low-contrast — reads as surface history. */
function makeGrimeTexture() {
    const n = fbm(TEX, 4, 4, 5507);
    const m = fbm(TEX, 3, 2, 9013);
    return bake((u, v, r, i) => {
        // A noisy radius makes the patch outline irregular instead of circular.
        const edge = 0.52 + (m[i] - 0.5) * 0.34;
        let a = (1 - smoothstep(edge * 0.45, edge, r)) * (0.25 + 0.75 * n[i]);
        a = clamp01(a * 0.85);
        const t = n[i];
        return [0.20 + 0.16 * t, 0.16 + 0.13 * t, 0.11 + 0.09 * t, a];
    });
}

/** Blob shadow: white with a radial alpha ramp; `modulate` tints it black. */
function makeBlobTexture() {
    return bake((u, v, r) => [1, 1, 1, (1 - smoothstep(0.06, 0.50, r)) * 0.92]);
}

// --- decal kinds -------------------------------------------------------------
// `size` is the box in world units: [footprint, depth along the projection
// axis, footprint]. The middle component is the only one that matters for
// whether the decal lands — it is the straddle thickness.

const KINDS = {
    impact: {
        label: 'impact splat',
        texture: null,                  // baked lazily on first use
        make: makeImpactTexture,
        tint: [1, 1, 1],
        size: [0.95, 0.80, 0.95],
        upperFade: 1.0, lowerFade: 1.0, normalFade: 0.0,
    },
    grime: {
        label: 'grime patch',
        texture: null,
        make: makeGrimeTexture,
        tint: [1, 1, 1],
        size: [2.60, 1.00, 2.60],
        upperFade: 1.2, lowerFade: 1.2, normalFade: 0.20,
    },
    blob: {
        label: 'blob shadow',
        texture: null,
        make: makeBlobTexture,
        tint: [0, 0, 0],
        size: [1.90, 1.30, 1.90],
        upperFade: 0.8, lowerFade: 0.8, normalFade: 0.35,
    },
};

function textureFor(kind) {
    const k = KINDS[kind];
    if (!k.texture) k.texture = k.make();
    return k.texture;
}

// --- orientation -------------------------------------------------------------

/**
 * Euler angles (degrees) that rotate the decal's local +Y onto a surface
 * normal, so its -Y projection axis fires INTO the surface.
 *
 * The engine composes node rotation as R = Rz·Ry·Rx (bromath's `qfromEuler`
 * is intrinsic Z-Y-X), so with rz = 0 the local +Y axis lands at
 *   (sin(rx)·sin(ry),  cos(rx),  sin(rx)·cos(ry))
 * which inverts directly: rx = acos(n.y), ry = atan2(n.x, n.z).
 *
 * The pole here is a horizontal surface (n = ±Y), where ry becomes free —
 * exactly the opposite of `node.lookAt()`, whose pole is straight down. Since
 * floors are the common case, that free angle is handed back as `spin`, a
 * roll of the texture in the floor plane. On walls the roll is pinned; with
 * only an Euler triple there is no clean slot for a roll about an arbitrary
 * normal, and the textures are radially symmetric enough not to care.
 */
function orientFromNormal(n, spin) {
    const ny = Math.max(-1, Math.min(1, n[1]));
    const horiz = Math.hypot(n[0], n[2]);
    const DEG = 180 / Math.PI;
    return {
        rx: Math.acos(ny) * DEG,
        ry: horiz < 1e-5 ? (spin || 0) : Math.atan2(n[0], n[2]) * DEG,
    };
}

// --- system ------------------------------------------------------------------

let _scene = null;
const _decals = [];              // { node, kind, size:[x,y,z], tint:[r,g,b] }
let _cfg = { enabled: true, kind: 'impact', opacity: 1.0, sizeScale: 1.0 };
let _master = true;              // last master A/B flag pushed by applyDecals
let _visible = true;             // _master && _cfg.enabled

/**
 * Drop a decal centred on a surface point, oriented to its normal.
 * `point` and `normal` are world space; the box is centred ON the point so it
 * straddles the surface (see the module header).
 */
export function placeAt(point, normal, kind, spin) {
    const k = KINDS[kind] || KINDS.impact;
    const { rx, ry } = orientFromNormal(normal, spin);
    const size = k.size.slice();

    const node = _scene.createDecal({
        name: `decal_${kind}_${_decals.length}`,
        texture: textureFor(kind),
        x: point[0], y: point[1], z: point[2],
        rx, ry,
        size: [size[0] * _cfg.sizeScale, size[1], size[2] * _cfg.sizeScale],
        modulate: [k.tint[0], k.tint[1], k.tint[2], _cfg.opacity],
        upperFade: k.upperFade,
        lowerFade: k.lowerFade,
        normalFade: k.normalFade,
    });
    node.visible = _visible;

    const entry = { node, kind, size, tint: k.tint };
    _decals.push(entry);
    return entry;
}

/**
 * Place a decal wherever a world-space ray first hits opaque geometry.
 * Returns the entry, or null on a miss.
 */
export function placeFromRay(origin, dir, kind, spin) {
    const hit = _scene.raycast(origin, dir, 240);
    if (!hit) return null;
    return placeAt(hit.position, hit.normal, kind || _cfg.kind, spin);
}

/** Place from canvas-local pixel coordinates (the click path). */
export function placeAtPixel(px, py, kind) {
    const ray = _scene.unprojectLocal(px, py);
    if (!ray) return null;
    // A pseudo-random roll keeps repeated clicks on the floor from stamping a
    // visibly identical texture every time.
    const spin = (px * 37 + py * 61) % 360;
    return placeFromRay(ray.origin, ray.dir, kind, spin);
}

/** Remove every decal node. */
export function clearDecals() {
    for (const d of _decals) d.node.destroy();
    _decals.length = 0;
}

/** Live decal count — the HUD readout and the smoke test both read this. */
export function decalCount() {
    return _decals.length;
}

/**
 * Push HUD state onto the existing decal nodes. `on` is the master A/B flag:
 * with the post stack bypassed the decals go with it, so the A/B really does
 * show the raw forward render.
 */
export function applyDecals(cfg, on) {
    _cfg = cfg;
    _master = on;
    _visible = on && cfg.enabled;
    for (const d of _decals) {
        d.node.visible = _visible;
        d.node.modulate = [d.tint[0], d.tint[1], d.tint[2], cfg.opacity];
        d.node.scaleX = d.size[0] * cfg.sizeScale;
        d.node.scaleY = d.size[1];              // straddle depth stays fixed
        d.node.scaleZ = d.size[2] * cfg.sizeScale;
    }
    const n = document.getElementById('decalCount');
    if (n) n.textContent = `${_decals.length} placed`;
}

/** Names + labels for the HUD's type selector. */
export function decalKinds() {
    return Object.entries(KINDS).map(([id, k]) => [id, k.label]);
}

/**
 * Build the decal system and stamp a starting set, so the feature is visible
 * before anyone clicks. Receivers are chunk 1's polished floor slab (top at
 * y = 0.10) and the plaster side walls (inner faces at x = ±11.6).
 */
export function initDecals(scene, canvas) {
    _scene = scene;

    // Three receiver heights matter here, and contrast decides where a decal
    // actually reads. The courtyard slab is nearly black (#20242a), so dark
    // decals vanish on it; the sunlit outer ground and the tan plaster walls
    // are the surfaces where a dark splat is unmistakable. The pre-placed set
    // is weighted accordingly, with only the contact shadows left on the slab.
    const SLAB_Y = 0.10;      // polished courtyard slab (chunk 1)
    const GROUND_Y = 0.0;     // the big rough plane outside the slab
    const UP = [0, 1, 0];

    // Sunlit apron in front of the courtyard — the highest-contrast floor in
    // the scene, and it sits in the lower third of the default framing.
    // Everything here stays clear of the mirror strip (z = 1.5 .. 5.7).
    for (const [x, z, spin] of [[-9.6, 5.2, 15], [8.4, 4.4, 200], [-2.4, 8.6, 95]]) {
        placeAt([x, GROUND_Y, z], UP, 'grime', spin);
    }
    for (const [x, z, spin] of [[3.2, 7.4, 0], [-5.2, 6.9, 140], [1.4, 9.6, 70],
                                [-7.8, 8.2, 250]]) {
        placeAt([x, GROUND_Y, z], UP, 'impact', spin);
    }

    // A little wear inside the courtyard proper. Subtle by design — the dark
    // slab is exactly the surface that shows how much receiver albedo matters.
    placeAt([-5.4, SLAB_Y, -1.2], UP, 'grime', 15);
    placeAt([ 2.8, SLAB_Y, -3.4], UP, 'grime', 200);
    placeAt([ 4.9, SLAB_Y, -4.6], UP, 'impact', 210);

    // Blob shadows under the two big metal props — the cheap contact cue that
    // sells them as resting on the floor rather than hovering.
    placeAt([-4.5, SLAB_Y, -6.5], UP, 'blob', 0);
    placeAt([ 4.5, SLAB_Y, -6.5], UP, 'blob', 0);

    // Wall decals prove the orientation math: these project sideways along the
    // wall normal rather than down. The plaster is the brightest receiver in
    // the scene, so this is where the projection is easiest to read.
    placeAt([-11.6, 2.6, -5.5], [1, 0, 0], 'grime');
    placeAt([-11.6, 3.4, -2.5], [1, 0, 0], 'impact');
    placeAt([-11.6, 1.8, -8.2], [1, 0, 0], 'impact');
    placeAt([ 11.6, 2.2, -6.5], [-1, 0, 0], 'grime');
    placeAt([ 11.6, 3.1, -3.0], [-1, 0, 0], 'impact');
    placeAt([ 11.6, 1.6, -8.4], [-1, 0, 0], 'impact');

    // Back wall, inner face at z = -11.6 — these face the camera head-on.
    placeAt([-6.0, 3.6, -11.6], [0, 0, 1], 'impact');
    placeAt([-5.2, 2.9, -11.6], [0, 0, 1], 'impact');
    placeAt([ 6.4, 2.8, -11.6], [0, 0, 1], 'grime');

    // Click-to-place. Left is the only free mouse button in this app — chunk 1
    // deliberately left it unbound for exactly this.
    canvas.addEventListener('mousedown', (e) => {
        if (e.button !== 0) return;
        e.preventDefault();
        const rect = canvas.getBoundingClientRect();
        placeAtPixel(e.clientX - rect.left, e.clientY - rect.top, _cfg.kind);
        applyDecals(_cfg, _master);
    });
}
