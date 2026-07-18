// terrain.js — a real heightfield, walked by the real controller.
//
// Every other floor in this app is a box. Boxes are the easy case: one plane,
// one normal, one slope. A heightfield is the case a game actually ships —
// thousands of quantized samples, a normal that changes under the capsule every
// step — and the point of this file is that the controller does not care. The
// same `maxSlopeAngle` that stopped it on the 65-degree ramp slab stops it on a
// hillside, and the same `groundNormal` readout reports the hill's gradient.
//
// The honesty guarantee is the height function. `heightAt()` is the ONLY place
// terrain elevation is defined; the collision body and the visual mesh are both
// generated from it in the same pass, from the same Float32Array. There is no
// second copy of the terrain to drift out of sync — regenerating rebuilds both
// from one array or neither.
//
// Two heightfield facts worth knowing, both from docs/physics-api.js and both
// confirmed against the runtime:
//
//   * `heights[z * n + x]` is row-major in GRID space, and the surface sits at
//     `position + scale * (x, h, z)`. The grid starts AT the body position and
//     grows in +X/+Z — it is NOT centred on it. Every world<->grid conversion
//     below goes through gridToWorld/worldToGrid so that offset is stated once.
//   * heightfields are always static. Changing the amplitude means destroying
//     the body and making a new one; there is no in-place height update.

import { charState } from "/app/character.js";

// The seam. The course's ground slab was shortened to end here, so the terrain
// picks up exactly where the flat world stops and the character can walk from
// one to the other without a step.
export const SEAM_Z = -20;

const N = 64;          // samples per side
const CELL = 1.2;      // metres per sample
const SPAN = CELL * (N - 1);
const X0 = -SPAN / 2;
const Z0 = SEAM_Z - SPAN;

/** Live tunables, bound to the Terrain section of the HUD. */
export const terrain = {
    amplitude: 3.4,    // metres, peak-to-mid
    frequency: 0.085,  // radians per metre
    /** Grid resolution and extent are fixed; these are the two knobs that
     *  change the SHAPE, which is the thing the controller reacts to. */
    seed: 1,
};

/** Live readout. `slopeMeasured` comes from the engine's groundNormal;
 *  `slopeAnalytic` is computed from the same height function the body was
 *  built from. Watching those two agree is the proof the collision surface is
 *  the surface on screen. */
export const terrainState = {
    onTerrain: false,
    groundY: 0,
    slopeMeasured: 0,
    slopeAnalytic: 0,
    slopeError: 0,
    rebuilds: 0,
    tag: -1,
};

let heights = null;
let body = -1;
let meshNode = null;
let sceneRef = null;

// --- the height function -----------------------------------------------------

/** Grid index -> world XZ. */
const gridToWorldX = (ix) => X0 + ix * CELL;
const gridToWorldZ = (iz) => Z0 + iz * CELL;

/**
 * Elevation at a world XZ. Two sine lobes at different rates and orientations,
 * which is enough to produce ridges, saddles and a couple of faces steep enough
 * to trip the slope limit — the interesting cases — without needing noise.
 *
 * The near edge is tapered to zero over the last 9 m so the terrain meets the
 * flat course at the seam. Without it there is a cliff at z = -20 and the
 * character can never get onto the hills in the first place.
 */
export function heightAt(wx, wz) {
    const f = terrain.frequency;
    const s = terrain.seed;
    const base =
        Math.sin(wx * f + s) * Math.cos(wz * f * 0.85) +
        0.55 * Math.sin((wx + wz * 1.3) * f * 1.9 + s * 2.1) +
        0.30 * Math.cos(wx * f * 2.7 - wz * f * 1.1);
    // smoothstep taper: 0 at the seam, 1 by 9 m in.
    const d = Math.max(0, Math.min(1, (SEAM_Z - wz) / 9));
    const taper = d * d * (3 - 2 * d);
    return terrain.amplitude * base * taper;
}

/**
 * Analytic slope in degrees at a world XZ, by central difference on heightAt.
 * This is the number the engine's groundNormal is checked against — the same
 * quantity derived two completely different ways.
 */
export function slopeAt(wx, wz) {
    const h = CELL * 0.5;
    const dx = (heightAt(wx + h, wz) - heightAt(wx - h, wz)) / (2 * h);
    const dz = (heightAt(wx, wz + h) - heightAt(wx, wz - h)) / (2 * h);
    // Surface normal of y = f(x,z) is (-df/dx, 1, -df/dz), normalized.
    const ny = 1 / Math.sqrt(dx * dx + dz * dz + 1);
    return Math.acos(Math.min(1, ny)) * 180 / Math.PI;
}

/** True when a world XZ is inside the terrain patch. */
export function onTerrain(wx, wz) {
    return wx >= X0 && wx <= X0 + SPAN && wz >= Z0 && wz <= Z0 + SPAN;
}

// --- build -------------------------------------------------------------------

/** Fill `heights` from heightAt over the grid. One array, two consumers. */
function sampleHeights() {
    if (!heights) heights = new Float32Array(N * N);
    for (let iz = 0; iz < N; ++iz) {
        const wz = gridToWorldZ(iz);
        for (let ix = 0; ix < N; ++ix) {
            heights[iz * N + ix] = heightAt(gridToWorldX(ix), wz);
        }
    }
    return heights;
}

/**
 * Triangulate the SAME array into world-space vertices. Winding is
 * (x,z) -> (x,z+1) -> (x+1,z), whose cross product points at +Y in a
 * right-handed Y-up world — the visible side is the side you walk on.
 *
 * Positions are absolute world coordinates and the node sits at the origin, so
 * a vertex and its heightfield sample are the same three numbers.
 */
function buildGeometry() {
    const positions = new Float32Array(N * N * 3);
    for (let iz = 0; iz < N; ++iz) {
        for (let ix = 0; ix < N; ++ix) {
            const o = (iz * N + ix) * 3;
            positions[o]     = gridToWorldX(ix);
            positions[o + 1] = heights[iz * N + ix];
            positions[o + 2] = gridToWorldZ(iz);
        }
    }
    const quads = (N - 1) * (N - 1);
    const indices = new Uint32Array(quads * 6);
    let k = 0;
    for (let iz = 0; iz < N - 1; ++iz) {
        for (let ix = 0; ix < N - 1; ++ix) {
            const a = iz * N + ix;
            const b = (iz + 1) * N + ix;
            const c = iz * N + ix + 1;
            const d = (iz + 1) * N + ix + 1;
            indices[k++] = a; indices[k++] = b; indices[k++] = c;
            indices[k++] = c; indices[k++] = b; indices[k++] = d;
        }
    }
    return { positions, indices };
}

/** Create (or recreate) the collision body from the current samples. */
function makeBody() {
    if (body > 0) { Physics.destroyBody(body); body = -1; }
    body = Physics.createBody({
        shape: 'heightfield',
        heights,
        sampleCount: N,
        scale: { x: CELL, y: 1, z: CELL },
        // The grid grows in +X/+Z from here, so this corner IS (X0, 0, Z0).
        position: { x: X0, y: 0, z: Z0 },
        friction: 0.9,
    });
    terrainState.tag = body;
    return body;
}

export function buildTerrain(scene) {
    sceneRef = scene;
    sampleHeights();
    makeBody();
    const g = buildGeometry();
    meshNode = scene.createMesh({
        positions: g.positions,
        indices: g.indices,
        recomputeNormals: true,
        color: '#4a5a44',
        metallic: 0,
        roughness: 0.95,
        name: 'terrain',
    });
    return { body, node: meshNode };
}

/**
 * Re-sample and rebuild after an amplitude/frequency change. Body and mesh are
 * regenerated from one fresh `heights` pass, in that order, so there is never a
 * frame where the collision and the picture disagree.
 */
export function regenerateTerrain() {
    if (!sceneRef) return;
    sampleHeights();
    makeBody();
    const g = buildGeometry();
    meshNode.updateMesh({ positions: g.positions, indices: g.indices },
                        { recomputeNormals: true });
    terrainState.rebuilds++;
}

/** Ground height under a world XZ, straight off the built body — a raycast, so
 *  it reads the COLLISION surface rather than the function it came from. */
export function probeGround(wx, wz) {
    const hit = Physics.raycastClosest(wx, 40, wz, 0, -1, 0, 90, { layers: ['static'] });
    return hit ? hit.position.y : null;
}

/** A place to stand that is on the hills but not on a cliff. */
export const TERRAIN_WALK = { x: 0, z: SEAM_Z - 14 };

// --- per-frame ---------------------------------------------------------------

/**
 * Refresh the terrain readout. Called every frame; when the character is off
 * the patch every field falls back to zero so the HUD never shows a stale hill.
 */
export function tickTerrain() {
    const p = charState.position;
    const on = onTerrain(p.x, p.z);
    terrainState.onTerrain = on;
    if (!on) {
        terrainState.groundY = 0;
        terrainState.slopeAnalytic = 0;
        terrainState.slopeMeasured = charState.slopeDeg;
        terrainState.slopeError = 0;
        return terrainState;
    }
    terrainState.groundY = heightAt(p.x, p.z);
    terrainState.slopeAnalytic = slopeAt(p.x, p.z);
    terrainState.slopeMeasured = charState.slopeDeg;
    terrainState.slopeError = charState.isGrounded
        ? Math.abs(terrainState.slopeMeasured - terrainState.slopeAnalytic) : 0;
    return terrainState;
}

export { N as TERRAIN_SAMPLES, CELL as TERRAIN_CELL, SPAN as TERRAIN_SPAN, X0, Z0 };
