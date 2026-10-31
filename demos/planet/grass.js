// Planet grass: blades about the eye, standing on a field of the ground's
// true surface (grass.bk k_grass_field) that follows the eye on a lattice
// fixed to the world, so a blade stays where it grew as the eye moves.
//
// The field is a grid of points on the gnomonic plane of the eye's cube
// face (as the clouds' clipmap, clouds.js), spaced about a metre (a power of
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

// The ground under the blades, for a node createGrass is given as a reader:
// grassFloor(P, d) is what the ground's colour is taken by at P (about the
// planet's centre, d from the eye) where blades stand: the ground between
// them, in their shade, GRASS_FLOOR of what the blades average to, as much
// as the field's cover there grows grass, and fading out as the blades do
// toward FAR, past which the ground is the blades' average itself.
export const GRASS_FLOOR = 0.55;
export const grassFloorBk = `
    fn grass_floor(p: vec3<f32>, d: f32) -> f32 {
        let fade = smoothstep(${FAR.toFixed(1)}, ${(FAR * 0.8).toFixed(1)}, d);
        if (fade <= 0.0 || params.grass_uv.z <= 0.0) { return 1.0; }
        let q = normalize(p);
        let f = (vec2<f32>(dot(q, params.grass_e), dot(q, params.grass_f)) / dot(q, params.grass_a) - params.grass_uv.xy) / params.grass_uv.z;
        if (f.x < 0.0 || f.y < 0.0 || f.x >= ${P - 1}.0 || f.y >= ${P - 1}.0) { return 1.0; }
        let i = vec2<i32>(f.x as i32, f.y as i32);
        let t = f - vec2<f32>(i.x as f32, i.y as f32);
        let k = (i.y * ${P} + i.x) * 7 + 3;
        let cover = mix(mix(grass_field[k], grass_field[k + 7], t.x),
                        mix(grass_field[k + ${P * 7}], grass_field[k + ${P * 7 + 7}], t.x), t.y);
        return mix(1.0, ${GRASS_FLOOR}, fade * cover);
    }`;

const grassHookBk = `module hook;
import mesh;

struct Params {
    cam_hi: vec3<f32>,
    cam_lo: vec3<f32>,
    o_hi: vec3<f32>,
    o_lo: vec3<f32>,
    lattice: vec2<f32>,
    sun_lattice: vec2<f32>,
    time: f32,
    blades: f32,
    band: vec2<f32>,
    cam_fwd: vec3<f32>,
    cos_view: f32,
    first: f32,
    cell_count: f32,
}
@binding(4, 0) var params: uniform<Params>;
@binding(4, 14) var field: read_buffer<f32>;
@binding(4, 15) var sun: read_buffer<u32>;
@binding(4, 16) var cells: read_buffer<i32>;

fn pcg(v: u32) -> u32 {
    let s = v * 747796405u + 2891336453u;
    let w = ((s >> ((s >> 28u) + 4u)) ^ s) * 277803737u;
    return (w >> 22u) ^ w;
}
fn rnd_val(s: u32) -> f32 {
    return (s as f32) * (1.0 / 4294967296.0);
}
struct FieldPoint {
    p: vec3<f32>,
    cover: f32,
    albedo: vec3<f32>,
}
fn field_point(x: i32, y: i32) -> FieldPoint {
    let k = (y * ${P} + x) * 7;
    return FieldPoint {
        p: vec3<f32>(field[k], field[k + 1], field[k + 2]),
        cover: field[k + 3],
        albedo: vec3<f32>(field[k + 4], field[k + 5], field[k + 6]),
    };
}
// The sun grid between its points, at field point f (sun.js: the
// terrain's sun, then the clouds' direct, scattered and sky).
fn sun_at(f: vec2<f32>) -> vec4<f32> {
    let s = clamp(f / ${SUN_STRIDE}.0, vec2<f32>(0.0), vec2<f32>(${SUN_P - 1}.0 - 1e-3));
    let i = vec2<i32>(s.x as i32, s.y as i32);
    let t = s - vec2<f32>(i.x as f32, i.y as f32);
    let k = i.y * ${SUN_P} + i.x;
    return mix(mix(unpack_unorm4x8(sun[k]), unpack_unorm4x8(sun[k + 1]), t.x),
               mix(unpack_unorm4x8(sun[k + ${SUN_P}]), unpack_unorm4x8(sun[k + ${SUN_P + 1}]), t.x), t.y);
}
pub fn vertex(v_in: mesh::Vertex) -> mesh::Vertex {
    var v = v_in;
    // The cells are sorted by their angle about the field's centre, and a
    // node draws the run of them toward the view, from first round.
    let ci = (v.instance_index + (params.first as i32)) % (params.cell_count as i32);
    var cell = vec2<i32>(cells[2 * ci], cells[2 * ci + 1]) + vec2<i32>(${N / 2});
    let b = (v.pos.x + 0.5) as i32;
    let t = v.pos.y;
    let side = v.pos.z;
    let world = cell + vec2<i32>(params.lattice.x as i32, params.lattice.y as i32);
    var seed = pcg((world.x as u32) * 73856093u ^ (world.y as u32) * 19349663u ^ (b as u32) * 83492791u);
    seed = pcg(seed);
    let at_x = rnd_val(seed);
    seed = pcg(seed);
    let at_y = rnd_val(seed);
    let at = vec2<f32>(at_x, at_y);
    cell = clamp(cell, vec2<i32>(0), vec2<i32>(${N - 1}));
    // A blade whose cell (under 1.5 m across) is out of this node's band
    // or the view, or that stands beyond what the distance keeps, is one
    // point: its triangles have no area, and it costs one field read.
    let k0 = (cell.y * ${P} + cell.x) * 7;
    let rel0 = (params.o_hi - params.cam_hi) + (params.o_lo - params.cam_lo) + vec3<f32>(field[k0], field[k0 + 1], field[k0 + 2]);
    let d0 = length(rel0);
    if (d0 < params.band.x - 1.5 || d0 > params.band.y + 1.5 || dot(rel0, params.cam_fwd) + 1.5 < params.cos_view * d0
        || (b as f32) + 0.5 > min(1.0, ${THIN}.0 / max(d0 - 1.5, 1e-6)) * ${DENSE}.0) {
        v.pos = vec3<f32>(0.0);
        v.normal = vec3<f32>(0.0, 0.0, 1.0);
        v.v0 = vec4<f32>(0.0);
        v.v1 = vec4<f32>(0.0);
        return v;
    }
    let fp00 = field_point(cell.x, cell.y);
    let fp10 = field_point(cell.x + 1, cell.y);
    let fp01 = field_point(cell.x, cell.y + 1);
    let fp11 = field_point(cell.x + 1, cell.y + 1);
    let base = mix(mix(fp00.p, fp10.p, at.x), mix(fp01.p, fp11.p, at.x), at.y);
    let cover = mix(mix(fp00.cover, fp10.cover, at.x), mix(fp01.cover, fp11.cover, at.x), at.y);
    let albedo = mix(mix(fp00.albedo, fp10.albedo, at.x), mix(fp01.albedo, fp11.albedo, at.x), at.y);
    let v_light = sun_at(vec2<f32>(cell.x as f32, cell.y as f32) + at + (params.lattice - params.sun_lattice));
    let rel = (params.o_hi - params.cam_hi) + (params.o_lo - params.cam_lo) + base;
    let up = normalize(params.o_hi + (params.o_lo + base));
    let d = length(rel);

    // How many stand here, of the dense cell's: all out to THIN, then
    // THIN / d (a blade's height on screen falls as 1 / d, so as many
    // per pixel would thin the cover); this cell's share of them, its blades taken in index
    // order, the last shrinking into the ground. Wider by the root of
    // what was dropped, so the cover holds.
    let keep = min(1.0, ${THIN}.0 / max(d, 1e-6));
    let share = keep * ${DENSE}.0 / params.blades * cover;
    var grow = clamp((share - ((b as f32) + 0.5) / params.blades) * params.blades, 0.0, 1.0);
    // This node's band (the sparse cells take over at NEAR, where they
    // stand as many as the dense), and the last fifth before FAR fading.
    grow *= step(params.band.x, d) * step(d, params.band.y) * smoothstep(${FAR.toFixed(1)}, ${(FAR * 0.8).toFixed(1)}, d);
    let wide = clamp(inversesqrt(keep), 1.0, 8.0);

    // The blade: its height, facing, bend and width from its hash.
    seed = pcg(seed);
    let height = mix(0.22, 0.55, rnd_val(seed)) * grow;
    seed = pcg(seed);
    let phi = 6.2831853 * rnd_val(seed);
    let tx = normalize(cross(up, abs(up.y) < 0.9 ? vec3<f32>(0.0, 1.0, 0.0) : vec3<f32>(1.0, 0.0, 0.0)));
    let ty = cross(up, tx);
    let facing = tx * cos(phi) + ty * sin(phi);
    let across = cross(up, facing);
    // A gusting breeze along tx, its phase moving over the ground.
    let w = mod(params.o_hi, 64.0) + mod(params.o_lo, 64.0) + base;
    let gust = 0.5 + 0.5 * sin(params.time * 1.3 - dot(w, tx) * 0.35 + 0.8 * sin(dot(w, ty) * 0.2 + params.time * 0.4));
    seed = pcg(seed);
    let sway = (0.10 + 0.25 * gust) + 0.06 * sin(params.time * 4.1 + rnd_val(seed) * 6.28);
    seed = pcg(seed);
    let bend = mix(0.12, 0.45, rnd_val(seed));
    let lean = facing * bend + tx * sway;
    // Along the blade, bent as a cantilever: up, then over.
    let spine = up * height * t + lean * height * t * t;
    let dspine = up * height + lean * height * 2.0 * t;
    let width = 0.028 * wide * (1.0 - t) * step(1e-4, height);
    v.pos = rel + spine + across * (side * width * 0.5);
    var n = normalize(cross(across, dspine + up * 1e-5));
    if (dot(n, facing) < 0.0) { n = -n; }
    // Rounded across the blade, and toward the sky: a field of blades
    // lights as the soft cover it is, not as flat cards.
    v.normal = normalize(n + across * side * 0.5 + up * 1.2);
    seed = pcg(seed);
    let v_col = albedo * exp(0.3 * (rnd_val(seed) - 0.5));
    v.v0 = vec4<f32>(v_col, t);
    v.v1 = v_light;
    return v;
}

pub fn fragment(v: mesh::Vertex, s_in: mesh::Surface) -> mesh::Surface {
    var s = s_in;
    let v_col = v.v0.xyz;
    let v_t = v.v0.w;
    let v_light = v.v1;
    // Darker toward the root, where the blades around shade it.
    s.base_color = v_col * mix(0.75, 1.1, v_t);
    // A two-sided blade's back face turns the normal down; a thin blade
    // passes light through, so either face lights as the sky side does.
    if (dot(s.normal, (params.cam_hi + params.cam_lo) + v.world_pos) < 0.0) {
        s.normal = -s.normal;
    }
    s.metallic = 0.0;
    s.roughness = 0.75;
    // The terrain's shadow and the clouds' light from the sun grid, which
    // takes the clouds as the ground's light does (sun.bk); and the sky the
    // blades around hide from a blade's lower part.
    s.sun_visibility *= v_light.x * v_light.y;
    s.sun_diffuse = v_light.z;
    s.sky_visibility *= mix(0.45, 1.0, v_t) * v_light.w;
    s.occluder_sun *= v_light.y;
    return s;
}`;

// The grass in `scene`, its field produced by `module` (grass.bk
// k_grass_field) and its sun grid, the terrain's shadow and the clouds'
// light, by `sunModule` (sun.bk) at `octaves` of the ground's; `readers` are
// nodes whose modules include grassFloorBk, bound to its field. update() each frame with the eye about the
// planet's centre (f64), its altitude and the unit direction to the sun.
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
            module: grassHookBk, file: 'grass_mesh.bk',
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
