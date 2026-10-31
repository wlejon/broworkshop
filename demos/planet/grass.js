// Planet grass: blades about the eye, standing on a field of the ground's
// true surface (grass.bk k_grass_field) that follows the eye on a lattice
// fixed to the world, so a blade stays where it grew as the eye moves.
//
// The field is a grid of points on the gnomonic plane of the eye's cube
// face (as sun.js's grids), spaced about a metre (a power of
// two of the plane's units, so the lattice holds still), produced again when
// the eye has moved SNAP points. Each point holds its place, how much of the
// ground there grows grass (ground.bk grass_cover: grassland past the beach,
// less rock and snow) and the sward's albedo (the ground's without its rock,
// which the ground mixes in where the blades are fewer). How much of the sun's disc the ground
// sees over the terrain is a grid SUN_STRIDE times coarser (sun.js; a
// terrain's shadow is soft over a few metres), produced the frame after the
// field or when the sun has turned, so the two do not land in one frame.
//
// The blades are drawn in cells, one instance per field cell, many blades
// each (Ghost of Tsushima's grass, Sucker Punch 2021: the GPU builds every
// blade from a hash of its index, nothing per blade is stored): each blade
// at a hashed spot in its cell, on the cell's surface between its four
// points, of the albedo there, varied about it as the ground's albedo is the
// mean of the blades over it. Farther out fewer blades stand, THIN / d
// of them, each wider by the square root of what was dropped, the last ones
// shrinking into the ground rather than vanishing; past FAR they are all
// gone and the ground's colour is what is left. A blade is a tapered strip
// of three segments, bent toward its facing by its own amount and swayed by
// a gusting breeze.
import { faceFrame } from "/app/clouds.js";
import { createSunGrid } from "/app/sun.js";
import { stepped } from "/app/stepped.js";
import { constants, readApp } from "/app/shaders.js";

const N = 128;             // field cells along an edge
const P = N + 1;           // field points along an edge
const SNAP = 8;            // points the eye moves before the field is produced again
const SPACING = 1.0;       // metres between field points, about (a power of two of the plane's units)
const THIN = 6;            // metres out to which every blade stands
const NEAR = 12;           // metres: the dense cells inside, the sparse ones out to FAR
const FAR = 40;            // metres: no blade stands past it
const DENSE = 128;         // blades in a near cell
const SPARSE = 64;         // and in a far one: what stands of the dense ones at NEAR

// A blade cell: `blades` strips of three segments, x the blade's index, y
// its height share (0 root .. 1 tip), z its side (-1, 1; 0 at the tip).
function bladeCell(blades) {
    const pos = [], idx = [];
    for (let b = 0; b < blades; b++) {
        const base = pos.length / 3;
        for (let s = 0; s < 3; s++) pos.push(b, s / 3, -1, b, s / 3, 1);
        pos.push(b, 1, 0);
        for (let s = 0; s < 2; s++) {
            const a = base + 2 * s;
            idx.push(a, a + 1, a + 3, a, a + 3, a + 2);
        }
        idx.push(base + 4, base + 5, base + 6);
    }
    const normals = new Float32Array(pos.length);
    for (let i = 1; i < normals.length; i += 3) normals[i] = 1;
    return new Mesh({ positions: new Float32Array(pos), normals, indices: new Uint32Array(idx) });
}

// The cells about the field's centre that may hold a blade r0 to r1 metres
// from the eye, as offsets from the centre's cell, two ints each: the eye is
// up to SNAP / 2 cells off the centre, and a cell is as little as 0.71 m
// (the spacing is a power of two of the plane's units, within a factor
// root 2 of SPACING). Sorted by their angle about the centre (the angles
// beside them), so the cells toward the view are one run.
function cellRing(r0, r1) {
    const out = [], near = 0.7071 * SPACING, far = 1.4143 * SPACING;
    const lo = r0 / far - SNAP / 2 - 1, hi = r1 / near + SNAP / 2 + 1, reach = Math.ceil(hi);
    for (let dy = -reach; dy < reach; dy++)
        for (let dx = -reach; dx < reach; dx++) {
            const d = Math.hypot(dx + 0.5, dy + 0.5);
            if (d >= lo && d < hi) out.push([Math.atan2(dy + 0.5, dx + 0.5), dx, dy]);
        }
    out.sort((a, b) => a[0] - b[0]);
    return { cells: new Int32Array(out.flatMap((c) => [c[1], c[2]])), angles: Float64Array.from(out, (c) => c[0]) };
}

// The first index of sorted `angles` at or past a.
function lowerBound(angles, a) {
    let lo = 0, hi = angles.length;
    while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (angles[mid] < a) lo = mid + 1; else hi = mid;
    }
    return lo;
}

const SUN_STRIDE = 4;      // field points between the sun grid's
const SUN_P = N / SUN_STRIDE + 1;

// The ground under the blades, between them and in their shade: GRASS_FLOOR
// of what the blades average to (grass_floor.bk, which a reader imports).
const GRASS_FLOOR = 0.55;

// The shaders: the blades' hook (grass_mesh.bk) and the floor's module,
// both reading this layout.
const LAYOUT = constants('planet::grass_layout', {
    N: ['i32', N], P: ['i32', P], THIN: ['f32', THIN], FAR: ['f32', FAR], DENSE: ['f32', DENSE],
    SUN_STRIDE: ['i32', SUN_STRIDE], SUN_P: ['i32', SUN_P], GRASS_FLOOR: ['f32', GRASS_FLOOR],
});
// What a reader of the grass's field imports (grass_floor.bk grass_floor).
export const grassModules = { 'planet::grass_layout': LAYOUT, 'planet::grass_floor': readApp('grass_floor.bk') };
const HOOK = readApp('grass_mesh.bk');

// The grass in `scene`, its field produced by `module` (grass.bk
// k_grass_field) and its sun grid, the terrain's shadow and the clouds'
// light, by `sunModule` (sun.bk) at `octaves` of the ground's; `readers` are
// nodes whose hooks import grassModules, bound to its field. update() each
// frame with the eye about the planet's centre (f64), its altitude and the
// unit direction to the sun.
export function createGrass(scene, radius, module, sunModule, octaves, seed, net, readers = []) {
    const fieldKernel = module.kernel('k_grass_field'), heightsKernel = module.kernel('k_grass_heights');
    const sunGrid = createSunGrid(sunModule, SUN_P, net, 4);
    const field = bro.kernel.createBuffer(P * P * 7 * 4), heights = bro.kernel.createBuffer((P + 2) * (P + 2) * 4);
    const bands = [
        { blades: DENSE, band: [0, NEAR], ring: cellRing(0, NEAR) },
        { blades: SPARSE, band: [NEAR, FAR], ring: cellRing(NEAR, FAR) },
    ];
    const nodes = bands.map(({ blades, band, ring }) => {
        const node = scene.createInstancedMesh({
            mesh: bladeCell(blades), color: [1, 1, 1],
            castsShadow: false, receivesShadow: false, doubleSided: true,
            module: HOOK, file: 'grass_mesh.bk', modules: { 'planet::grass_layout': LAYOUT },
        });
        node.cullMargin = 4 * radius;   // the shader places the blades
        node.drawOrder = 6;             // before the ground it hides
        node.setShaderBuffer('field', field);
        node.setShaderBuffer('sun', sunGrid.buffer);
        node.setShaderBuffer('cells', bro.kernel.createBuffer(ring.cells));
        node.setShaderUniform('blades', blades);
        node.setShaderUniform('band', band);
        node.count = ring.angles.length;
        node.angles = ring.angles;
        node.setShaderUniform('cell_count', node.count);
        node.setShaderUniform('first', 0);
        node.reach = band[1];
        node.shown = false;
        node.setInstanceCount(0);
        return node;
    });

    // The sun grid follows the field, a step a frame beside the frames
    // (stepped.js), shown once done.
    let face = -1, delta = 0, ui = NaN, vi = NaN, sunDue = false, sunProduction = null;
    const sun = [0, 0, 0];
    const hi = [0, 0, 0], lo = [0, 0, 0];

    function faceOf(eye) {
        const m = eye.map(Math.abs);
        const best = m[0] >= m[1] && m[0] >= m[2] ? 0 : (m[1] >= m[2] ? 1 : 2);
        if (face >= 0 && m[face % 3] * 1.05 >= m[best] && Math.sign(eye[face % 3]) === (face < 3 ? 1 : -1)) return face;
        return best + (eye[best] < 0 ? 3 : 0);
    }

    // Each node's run of cells toward the view: the azimuths the view's
    // cone covers on the ground about the eye (all of them when it takes
    // in the ground straight below or the sky straight above), widened by
    // how far the eye is off the field's centre as seen from the band's
    // nearest cells, taken in the lattice's own angles.
    const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
    function aim(eye, forward, cone) {
        const frame = faceFrame(face);
        const at = (u, v) => {
            const p = [0, 1, 2].map((k) => frame.a[k] + frame.e[k] * u + frame.f[k] * v);
            const l = Math.hypot(p[0], p[1], p[2]);
            return p.map((x) => x / l);
        };
        const z = dot(eye, frame.a), u = dot(eye, frame.e) / z, v = dot(eye, frame.f) / z;
        const here = at(u, v), tx = at(u + delta, v), ty = at(u, v + delta);
        const ex = tx.map((x, k) => (x - here[k]) * radius), ey = ty.map((x, k) => (x - here[k]) * radius);
        const up = here, fu = dot(forward, up);
        const flat = forward.map((x, k) => x - up[k] * fu);
        // flat = a ex + b ey, least squares over the two axes.
        const xx = dot(ex, ex), xy = dot(ex, ey), yy = dot(ey, ey), fx = dot(flat, ex), fy = dot(flat, ey);
        const det = xx * yy - xy * xy;
        const a = (fx * yy - fy * xy) / det, b = (fy * xx - fx * xy) / det;
        const azimuth = Math.atan2(b, a);
        const elevation = Math.asin(Math.max(-1, Math.min(1, fu)));
        const cell = Math.sqrt(Math.sqrt(xx * yy));
        const off = Math.hypot(u / delta - ui, v / delta - vi) * cell;
        for (const n of nodes) {
            if (!n.shown) continue;
            const r0 = n.reach === NEAR ? 0 : NEAR;
            let half = Math.PI;
            if (r0 > off && Math.abs(elevation) + cone < 1.4) {
                // The lattice is skewed off a face's centre: a little more.
                half = Math.asin(Math.min(1, Math.sin(cone) / Math.cos(elevation))) + Math.asin(off / (r0 - off)) + 0.2;
            }
            let first = 0, count = n.count;
            if (half < Math.PI) {
                const wrap = (x) => x - 2 * Math.PI * Math.floor((x + Math.PI) / (2 * Math.PI));
                first = lowerBound(n.angles, wrap(azimuth - half));
                const end = lowerBound(n.angles, wrap(azimuth + half));
                count = (end - first + n.count) % n.count;
            }
            n.setShaderUniform('first', first);
            if (count !== n.instanceCount) n.setInstanceCount(count);
        }
    }

    function produce(eye, toSun) {
        const fc = faceOf(eye), frame = faceFrame(fc);
        const z = eye[0] * frame.a[0] + eye[1] * frame.a[1] + eye[2] * frame.a[2];
        const u = (eye[0] * frame.e[0] + eye[1] * frame.e[1] + eye[2] * frame.e[2]) / z;
        const v = (eye[0] * frame.f[0] + eye[1] * frame.f[1] + eye[2] * frame.f[2]) / z;
        // The plane's spacing for about SPACING metres here, a power of two.
        const stretch = Math.sqrt(1 + Math.max(u * u, v * v)) / (1 + u * u + v * v);
        const dl = 2 ** Math.round(Math.log2(SPACING / (radius * stretch)));
        const step = SNAP * dl;
        const nu = Math.round(u / step) * SNAP, nv = Math.round(v / step) * SNAP;
        const plane = [...frame.a, ...frame.e, ...frame.f];
        const jumped = fc !== face || dl !== delta;
        if (jumped || nu !== ui || nv !== vi) {
            face = fc;
            delta = dl;
            ui = nu;
            vi = nv;
            const c = [0, 0, 0];
            for (let k = 0; k < 3; k++) c[k] = frame.a[k] + frame.e[k] * ui * dl + frame.f[k] * vi * dl;
            const len = Math.hypot(c[0], c[1], c[2]);
            const origin = c.map((x) => x / len * radius);
            heightsKernel.dispatch([P + 2, P + 2], heights, ...plane, (ui - N / 2) * dl, (vi - N / 2) * dl, dl,
                                   radius, octaves, seed, net);
            fieldKernel.dispatch([P, P], field, heights, ...plane, (ui - N / 2) * dl, (vi - N / 2) * dl, dl,
                                 ...origin, radius, octaves, seed, net);
            for (let k = 0; k < 3; k++) {
                hi[k] = Math.fround(origin[k]);
                lo[k] = origin[k] - hi[k];
            }
            for (const n of nodes) {
                n.setShaderUniform('o_hi', hi);
                n.setShaderUniform('o_lo', lo);
                n.setShaderUniform('lattice', [ui - N / 2, vi - N / 2]);
            }
            for (const n of readers) {
                n.setShaderBuffer('grass_field', field);
                n.setShaderUniform('grass_a', frame.a);
                n.setShaderUniform('grass_e', frame.e);
                n.setShaderUniform('grass_f', frame.f);
                n.setShaderUniform('grass_uv', [(ui - N / 2) * dl, (vi - N / 2) * dl, dl]);
            }
            // The sun grid follows, read about its own lattice until shown.
            sunDue = true;
        }
        if (sunProduction && sunProduction.advance()) sunProduction = null;
        const turned = sun[0] * toSun[0] + sun[1] * toSun[1] + sun[2] * toSun[2] < 0.999999;
        // A grid begun is shown before the next begins: begun again at each
        // of the field's steps, a fast eye would leave it never shown.
        if (sunProduction || (!sunDue && !turned)) return;
        sunDue = false;
        sun.splice(0, 3, ...toSun);
        const lattice = [ui - N / 2, vi - N / 2];
        const steps = sunGrid.steps(plane, lattice[0] * dl, lattice[1] * dl, dl * SUN_STRIDE, toSun, radius, octaves, seed);
        sunProduction = stepped(steps, () => {
            const buffer = sunGrid.swap();
            for (const n of nodes) {
                n.setShaderBuffer('sun', buffer);
                n.setShaderUniform('sun_lattice', lattice);
            }
        });
    }

    return {
        nodes,
        field,
        // cone: the half-angle of the view's diagonal, radians.
        update(eye, altitude, toSun, camHi, camLo, forward, cone, time) {
            // A band whose blades all stand farther than its reach (with a
            // quarter more for the ground rising about the eye) draws none.
            let any = false;
            for (const n of nodes) {
                const show = altitude < 1.25 * n.reach;
                if (show !== n.shown) {
                    n.shown = show;
                    n.setInstanceCount(show ? n.count : 0);
                }
                any = any || show;
            }
            if (!any) return;
            produce(eye, toSun);
            aim(eye, forward, cone);
            for (const n of nodes) {
                n.setShaderUniform('cam_hi', camHi);
                n.setShaderUniform('cam_lo', camLo);
                n.setShaderUniform('time', time);
                n.setShaderUniform('cam_fwd', forward);
                n.setShaderUniform('cos_view', Math.cos(Math.min(cone + 0.1, Math.PI)));
            }
        },
    };
}
