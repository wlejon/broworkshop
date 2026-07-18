// lod.js — discrete LOD chains and camera-distance visibility gating.
//
// These are two different mechanisms that people constantly conflate, so the
// app builds a separate field of props for each and puts them side by side:
//
//   setLodMeshes([{mesh, maxDist}, ...])
//         ONE node, several geometries. Every frame the renderer measures the
//         camera distance to the node's world origin and draws the first level
//         whose `maxDist` exceeds it; past the last threshold the coarsest
//         level keeps drawing. The node never disappears. Culling bounds are
//         the union of all levels, so a switch cannot pop the silhouette, and
//         the shadow pass is forced to the SAME level as the colour pass.
//
//   visibilityRange = {begin, end, margin}
//         ANY node, one geometry, a hard on/off window on camera distance.
//         `margin` is hysteresis, not a fade: once shown the node stays shown
//         until distance leaves [begin-margin, end+margin), once hidden it
//         stays hidden until distance enters [begin+margin, end-margin). That
//         is what stops a prop strobing when the camera hovers on a boundary.
//         The gate is independent of `visible` — both must pass — and it
//         prunes the whole subtree.
//
// The classic combination is the detail/imposter swap, which the pop field
// below builds literally: a detailed node gated 0..cutoff and a cheap stand-in
// gated cutoff..infinity, sharing one margin so exactly one of them draws.
//
// Two honest notes about what LOD is NOT:
//   - The base mesh passed to createMesh stays the raycast/picking source; the
//     chain only replaces what is RENDERED. Decal placement therefore keeps
//     hitting the high-poly silhouette no matter which level is on screen.
//   - There is no per-level material. LOD levels carry GEOMETRY only.
//
// That second point is what shapes the debug view below. A MeshNode's `color`
// is fixed at creation — the `color` property is LightNode-only, and writing
// it on a mesh is silently a no-op — so per-level tinting cannot be done by
// assigning a colour per frame. The way through is a one-uniform fragment
// chunk (see shaders.js for the full setShader contract): install it on the
// props while the debug view is on, then push a `u_lodTint` per node from the
// level the renderer actually chose. Reading `lodLevel` back to drive it is
// also the proof that the readout is the renderer's decision and not a JS
// re-implementation of it.

// Level palette for the debug view: green = full detail, amber = mid,
// red = coarsest. Deliberately garish; this is an inspection mode.
const LEVEL_TINTS = [
    [0.36, 0.88, 0.54],
    [0.94, 0.76, 0.29],
    [0.90, 0.34, 0.25],
];

const LOD_TINT_FRAG = `
uniform vec3 u_lodTint;

void userFragment(inout vec3 baseColor, inout vec3 normal,
                  inout float metallic, inout float roughness,
                  inout vec3 emissive, inout float alpha) {
    // Flat, unmissable, still lit — the shape has to stay readable so the
    // geometry change is what you notice, with the colour only confirming it.
    baseColor = u_lodTint;
    metallic  = 0.0;
    roughness = 0.65;
    emissive += u_lodTint * 0.22;
}`;

// Base thresholds in world units, before the HUD's distance multiplier. The
// default orbit sits ~24 units back, so at multiplier 1.0 the near props are
// already at level 0 and the far end of the avenue is at level 2 — the field
// shows all three levels at once rather than one flat band.
const BASE_THRESHOLDS = [30, 55, 1e30];

let _scene = null;
let _meshes = null;          // { hi, mid, lo } — built once, reused per prop
let _props = [];             // LOD chain props
let _pairs = [];             // { detail, imposter, z } visibility-range pairs
let _debugColors = false;
let _distScale = 1.0;

// --- geometry ---------------------------------------------------------------

/**
 * Three genuinely different geometries, not three tessellations of the same
 * silhouette. A viewer should be able to name the current level from across
 * the room with the debug colours off:
 *
 *   level 0  a smooth 32x24 UV sphere      (1472 tris)
 *   level 1  a coarse 10x7 sphere — visibly faceted, still round
 *   level 2  a box — unmistakably not a sphere
 *
 * A production chain would of course be three bakes of one asset (Mesh's
 * simplify() does exactly that), but three shapes make the switch legible,
 * which is the point of a lab.
 */
function buildLodMeshes() {
    return {
        hi:  Mesh.sphere(0.75, 32, 24),
        mid: Mesh.sphere(0.75, 10, 7),
        lo:  Mesh.box(0.62, 0.62, 0.62),
    };
}

/** Re-install every chain with thresholds scaled by the HUD multiplier. */
function installChains() {
    const t = BASE_THRESHOLDS;
    const s = _distScale;
    for (const p of _props) {
        p.node.setLodMeshes([
            { mesh: _meshes.hi,  maxDist: t[0] * s },
            { mesh: _meshes.mid, maxDist: t[1] * s },
            { mesh: _meshes.lo,  maxDist: t[2] },      // last level: never ends
        ]);
    }
}

// --- build ------------------------------------------------------------------

/**
 * Build both fields. LOD props march down the avenue outside the colonnade so
 * they never overlap the existing pillars; the pop pairs run down the middle
 * between them, which puts a swapping prop and a switching prop in the same
 * frame at the same depth.
 */
export function buildLodField(scene, handles) {
    _scene = scene;
    _meshes = buildLodMeshes();

    // --- LOD chain props ---------------------------------------------------
    // Six depth bands, both sides — twelve props spanning z = -8 .. -58, which
    // is the same corridor the fog and DoF sections already grade against.
    //
    // x = +-2.3 is not a cosmetic choice. The courtyard's back wall has a
    // 6-unit opening at z = -12, and from the default orbit that opening is a
    // window: it clips the avenue to roughly |x| < 3.6 at the first band. Park
    // the field at the sides of the avenue and ten of the twelve props are
    // behind masonry, which makes the whole LOD readout unverifiable by eye.
    for (let i = 0; i < 6; ++i) {
        const z = -8 - i * 10;
        for (const sx of [-1, 1]) {
            const x = sx * 2.3;

            // A plinth so the orb reads as a placed object rather than a
            // floating ball. The plinth has no chain — it is the fixed
            // reference that makes the orb's geometry change obvious.
            scene.createMesh({
                mesh: 'box',
                halfW: 0.5, halfH: 0.35, halfD: 0.5,
                x, y: 0.35, z,
                color: '#3c4149', metallic: 0, roughness: 0.8,
            });

            const node = scene.createMesh({
                data: _meshes.hi,           // base mesh = highest detail, so
                name: `lodProp${i}${sx > 0 ? 'R' : 'L'}`,   // picking stays exact
                x, y: 1.45, z,
                color: '#9db4d0',
                metallic: 0.15, roughness: 0.35,
            });
            _props.push({ node, x, z, tint: -1 });
        }
    }
    installChains();

    // --- visibility-range detail/imposter pairs ----------------------------
    // Both halves of each pair sit at the SAME spot. Only one draws, and the
    // HUD's cutoff slider decides which — dragging it walks a visible swap
    // down the avenue instead of asking the user to fly the camera.
    for (let i = 0; i < 8; ++i) {
        const z = -13 - i * 6;
        // Down the middle, alternating sides, so the pairs interleave with the
        // LOD props at +-2.3 instead of stacking into a wall.
        const x = (i % 2 === 0 ? -1 : 1) * 0.95;

        // Detail: a fluted obelisk — a tapered cylinder with a cap, high
        // segment count, clearly an object with silhouette detail.
        const detail = scene.createMesh({
            mesh: 'cylinder',
            radius: 0.34, halfHeight: 1.15, segments: 28,
            name: `popDetail${i}`,
            x, y: 1.15, z,
            color: '#c6b89a', metallic: 0.1, roughness: 0.45,
        });

        // Imposter: a flat slab of roughly the same footprint and value. From
        // far away it holds the composition; up close it is obviously a fake.
        const imposter = scene.createMesh({
            mesh: 'box',
            halfW: 0.34, halfH: 1.15, halfD: 0.06,
            name: `popImposter${i}`,
            x, y: 1.15, z,
            color: '#7d6f5c', metallic: 0, roughness: 0.9,
        });

        _pairs.push({ detail, imposter, x, z });
    }
    setVisibilityCutoff(46, 3);

    handles.lodProps = _props.map((p) => p.node);
    handles.popPairs = _pairs;
    return { props: _props, pairs: _pairs };
}

// --- controls ---------------------------------------------------------------

/**
 * Scale every LOD threshold. Below 1.0 the whole field drops to coarser
 * levels without the camera moving an inch — which is the only practical way
 * to inspect a LOD switch, since the alternative is flying 30 units and losing
 * your reference frame.
 */
export function setLodDistanceScale(scale) {
    if (Math.abs(scale - _distScale) < 1e-6) return;
    _distScale = scale;
    installChains();
}

/**
 * Colour props by their live `lodLevel`. Installing and clearing the tint
 * chunk is the edge; the per-frame work is one uniform write per prop, which
 * is why tickLod can afford to do it unconditionally while the view is on.
 * All twelve props share identical chunk source, so they share ONE compiled
 * program per pipeline flavour — uniform values stay per-node.
 */
export function setLodDebugColors(on) {
    const want = !!on;
    if (want === _debugColors) return;
    _debugColors = want;
    for (const p of _props) {
        if (want) {
            p.node.setShader({ fragment: LOD_TINT_FRAG,
                               uniforms: { u_lodTint: LEVEL_TINTS[0] } });
        } else {
            p.node.clearShader();
        }
        p.tint = -1;
    }
}

/**
 * Move the detail/imposter swap distance for every pair at once. `margin` is
 * the hysteresis band — set it to 0 from the HUD to watch the boundary strobe,
 * which is the most direct demonstration of what the margin buys.
 */
export function setVisibilityCutoff(cutoff, margin) {
    for (const p of _pairs) {
        p.detail.visibilityRange   = { begin: 0,      end: cutoff, margin };
        p.imposter.visibilityRange = { begin: cutoff, end: 1e30,   margin };
    }
}

/** Gate the whole pop field off (both halves) without touching the cutoff. */
export function setPopFieldEnabled(on) {
    for (const p of _pairs) {
        p.detail.visible = !!on;
        p.imposter.visible = !!on;
    }
}

// --- per-frame --------------------------------------------------------------

/**
 * Read back what the renderer actually chose last frame. `lodLevel` is a
 * render-time result, not a setting, so this is the only honest source for the
 * HUD readout — and re-tinting from it proves the readout is not a JS
 * re-implementation of the renderer's decision.
 *
 * @returns {{levels: number[], counts: number[]}}
 */
export function tickLod() {
    const counts = [0, 0, 0];
    const levels = new Array(_props.length);

    for (let i = 0; i < _props.length; ++i) {
        const p = _props[i];
        const lv = p.node.lodLevel | 0;
        levels[i] = lv;
        if (lv >= 0 && lv < 3) counts[lv]++;
        if (_debugColors) {
            const t = Math.max(0, Math.min(2, lv));
            if (p.tint !== t) {
                p.node.setShaderUniform('u_lodTint', LEVEL_TINTS[t]);
                p.tint = t;
            }
        }
    }

    return { levels, counts };
}

/** The LOD chain props (tests read `lodLevel` off these). */
export function lodProps() { return _props.map((p) => p.node); }

/** The detail/imposter pairs. */
export function popPairs() { return _pairs; }

/** Current threshold multiplier. */
export function lodDistanceScale() { return _distScale; }
