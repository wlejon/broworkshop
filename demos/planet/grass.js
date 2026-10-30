// Planet grass: blades about the eye, standing on a field of the ground's
// true surface (grass.bk k_grass_field) that follows the eye on a lattice
// fixed to the world, so a blade stays where it grew as the eye moves.
//
// The field is a grid of points on the gnomonic plane of the eye's cube
// face (as the clouds' clipmap, clouds.js), spaced about a metre (a power of
// two of the plane's units, so the lattice holds still), produced again when
// the eye has moved SNAP points. Each point holds its place, how much of the
// ground there grows grass (ground.bk grass_cover: grassland past the beach,
// less rock and snow) and its albedo. How much of the sun's disc the ground
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
import { cloudGlsl, faceFrame } from "/app/clouds.js";
import { createSunGrid } from "/app/sun.js";

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

const vertex = `buffer float u_field[];
    buffer float u_sun[];
    buffer int u_cells[];
    uniform vec3 u_camHi;
    uniform vec3 u_camLo;
    uniform vec3 u_oHi;
    uniform vec3 u_oLo;
    uniform vec2 u_lattice;   // the field's point 0 on the world's lattice
    uniform vec2 u_sunLattice;   // and the sun grid's
    uniform float u_time;
    uniform float u_blades;   // this cell's blades
    uniform vec2 u_band;      // the distances this node draws over: blades from r0, none past r1
    uniform vec3 u_camFwd;
    uniform float u_cosView;  // the cosine of the view's half diagonal, a little wider
    uniform float u_first;    // the first cell drawn, of u_cellCount
    uniform float u_cellCount;
    out vec3 v_col;
    out float v_t;
    out float v_lit;
    uint pcg(uint v) {
        uint s = v * 747796405u + 2891336453u;
        uint w = ((s >> ((s >> 28u) + 4u)) ^ s) * 277803737u;
        return (w >> 22u) ^ w;
    }
    float rnd(inout uint s) { s = pcg(s); return float(s) * (1.0 / 4294967296.0); }
    void fieldPoint(int x, int y, out vec3 p, out float cover, out vec3 albedo) {
        int k = (y * ${P} + x) * 7;
        p = vec3(u_field[k], u_field[k + 1], u_field[k + 2]);
        cover = u_field[k + 3];
        albedo = vec3(u_field[k + 4], u_field[k + 5], u_field[k + 6]);
    }
    // The sun grid between its points, at field point f.
    float sunAt(vec2 f) {
        vec2 s = clamp(f / ${SUN_STRIDE}.0, vec2(0.0), vec2(${SUN_P - 1}.0 - 1e-3));
        ivec2 i = ivec2(s);
        vec2 t = s - vec2(i);
        int k = i.y * ${SUN_P} + i.x;
        return mix(mix(u_sun[k], u_sun[k + 1], t.x), mix(u_sun[k + ${SUN_P}], u_sun[k + ${SUN_P + 1}], t.x), t.y);
    }
    void userVertex(inout vec3 pos, inout vec3 normal, inout vec2 uv) {
        // The cells are sorted by their angle about the field's centre, and a
        // node draws the run of them toward the view, from u_first round.
        int ci = (gl_InstanceIndex + int(u_first)) % int(u_cellCount);
        ivec2 cell = ivec2(u_cells[2 * ci], u_cells[2 * ci + 1]) + ivec2(${N / 2});
        int b = int(pos.x + 0.5);
        float t = pos.y, side = pos.z;
        ivec2 world = cell + ivec2(u_lattice);
        uint seed = pcg(uint(world.x) * 73856093u ^ uint(world.y) * 19349663u ^ uint(b) * 83492791u);
        vec2 at = vec2(rnd(seed), rnd(seed));
        cell = clamp(cell, ivec2(0), ivec2(${N - 1}));
        // A blade whose cell (under 1.5 m across) is out of this node's band
        // or the view, or that stands beyond what the distance keeps, is one
        // point: its triangles have no area, and it costs one field read.
        int k0 = (cell.y * ${P} + cell.x) * 7;
        vec3 rel0 = (u_oHi - u_camHi) + (u_oLo - u_camLo) + vec3(u_field[k0], u_field[k0 + 1], u_field[k0 + 2]);
        float d0 = length(rel0);
        if (d0 < u_band.x - 1.5 || d0 > u_band.y + 1.5 || dot(rel0, u_camFwd) + 1.5 < u_cosView * d0
            || float(b) + 0.5 > min(1.0, ${THIN}.0 / max(d0 - 1.5, 1e-6)) * ${DENSE}.0) {
            pos = vec3(0.0);
            normal = vec3(0.0, 0.0, 1.0);
            v_t = 0.0;
            v_col = vec3(0.0);
            v_lit = 0.0;
            return;
        }
        vec3 p00, p10, p01, p11, a00, a10, a01, a11;
        float c00, c10, c01, c11;
        fieldPoint(cell.x, cell.y, p00, c00, a00);
        fieldPoint(cell.x + 1, cell.y, p10, c10, a10);
        fieldPoint(cell.x, cell.y + 1, p01, c01, a01);
        fieldPoint(cell.x + 1, cell.y + 1, p11, c11, a11);
        vec3 base = mix(mix(p00, p10, at.x), mix(p01, p11, at.x), at.y);
        float cover = mix(mix(c00, c10, at.x), mix(c01, c11, at.x), at.y);
        vec3 albedo = mix(mix(a00, a10, at.x), mix(a01, a11, at.x), at.y);
        v_lit = sunAt(vec2(cell) + at + (u_lattice - u_sunLattice));
        vec3 rel = (u_oHi - u_camHi) + (u_oLo - u_camLo) + base;
        vec3 up = normalize(u_oHi + (u_oLo + base));
        float d = length(rel);

        // How many stand here, of the dense cell's: all out to THIN, then
        // THIN / d (a blade's height on screen falls as 1 / d, so as many
        // per pixel would thin the cover); this cell's share of them, its blades taken in index
        // order, the last shrinking into the ground. Wider by the root of
        // what was dropped, so the cover holds.
        float keep = min(1.0, ${THIN}.0 / max(d, 1e-6));
        float share = keep * ${DENSE}.0 / u_blades * cover;
        float grow = clamp((share - (float(b) + 0.5) / u_blades) * u_blades, 0.0, 1.0);
        // This node's band (the sparse cells take over at NEAR, where they
        // stand as many as the dense), and the last fifth before FAR fading.
        grow *= step(u_band.x, d) * step(d, u_band.y) * smoothstep(${FAR}.0, ${FAR * 0.8}, d);
        float wide = clamp(inversesqrt(keep), 1.0, 8.0);

        // The blade: its height, facing, bend and width from its hash.
        float height = mix(0.22, 0.55, rnd(seed)) * grow;
        float phi = 6.2831853 * rnd(seed);
        vec3 tx = normalize(cross(up, abs(up.y) < 0.9 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0)));
        vec3 ty = cross(up, tx);
        vec3 facing = tx * cos(phi) + ty * sin(phi);
        vec3 across = cross(up, facing);
        // A gusting breeze along tx, its phase moving over the ground.
        vec3 w = mod(u_oHi, 64.0) + mod(u_oLo, 64.0) + base;
        float gust = 0.5 + 0.5 * sin(u_time * 1.3 - dot(w, tx) * 0.35 + 0.8 * sin(dot(w, ty) * 0.2 + u_time * 0.4));
        float sway = (0.10 + 0.25 * gust) + 0.06 * sin(u_time * 4.1 + rnd(seed) * 6.28);
        float bend = mix(0.12, 0.45, rnd(seed));
        vec3 lean = facing * bend + tx * sway;
        // Along the blade, bent as a cantilever: up, then over.
        vec3 spine = up * height * t + lean * height * t * t;
        vec3 dspine = up * height + lean * height * 2.0 * t;
        float width = 0.014 * wide * (1.0 - t) * step(1e-4, height);
        pos = rel + spine + across * (side * width * 0.5);
        vec3 n = normalize(cross(across, dspine + up * 1e-5));
        if (dot(n, facing) < 0.0) n = -n;
        // Rounded across the blade, and toward the sky: a field of blades
        // lights as the soft cover it is, not as flat cards.
        normal = normalize(n + across * side * 0.5 + up * 1.2);
        v_t = t;
        v_col = albedo * exp(0.3 * (rnd(seed) - 0.5));
    }`;

const fragment = (radius) => `in vec3 v_col;
    in float v_t;
    in float v_lit;
    uniform vec3 u_camHi;
    uniform vec3 u_camLo;
    ${cloudGlsl(radius)}
    void userFragment(inout vec3 baseColor, inout vec3 normal, inout float metallic,
                      inout float roughness, inout vec3 emissive, inout float alpha) {
        // Darker toward the root, where the blades around shade it.
        baseColor = v_col * mix(0.75, 1.1, v_t);
        // A two-sided blade's back face turns the normal down; a thin blade
        // passes light through, so either face lights as the sky side does.
        if (dot(normal, (u_camHi + u_camLo) + vWorldPos) < 0.0) normal = -normal;
        metallic = 0.0;
        roughness = 0.75;
    }
    // The terrain's shadow from the field; the clouds' as the ground's; and
    // the sky the blades around hide from a blade's lower part.
    void userLight(vec3 toSun, inout float sunVisibility, inout float skyVisibility, inout vec3 skyNormal,
                   inout float occluderSun) {
        vec3 g = (u_camHi + u_camLo) + vWorldPos;
        float h = length(g) - CLOUD_R;
        vec3 up = normalize(g);
        float w = max(length(dFdx(vWorldPos)), length(dFdy(vWorldPos)));
        float clouds = cloudShadow(g, h, toSun, w);
        sunVisibility *= v_lit * clouds;
        skyVisibility *= mix(0.45, 1.0, v_t) * cloudShadow(g, h, up, w);
        occluderSun *= clouds;
    }`;

// The grass in `scene`, its field produced by `module` (grass.bk
// k_grass_field) and its sun grid by `sunModule` (sun.bk) at `octaves` of
// the ground's. Its nodes read the clouds'
// field (createClouds' readers). update() each frame with the eye about the
// planet's centre (f64), its altitude and the unit direction to the sun.
export function createGrass(scene, radius, module, sunModule, octaves, seed, net) {
    const fieldKernel = module.kernel('k_grass_field');
    const sunGrid = createSunGrid(sunModule, SUN_P, net);
    const field = bro.kernel.createBuffer(P * P * 7 * 4);
    const bands = [
        { blades: DENSE, band: [0, NEAR], ring: cellRing(0, NEAR) },
        { blades: SPARSE, band: [NEAR, FAR], ring: cellRing(NEAR, FAR) },
    ];
    const nodes = bands.map(({ blades, band, ring }) => {
        const node = scene.createInstancedMesh({ mesh: bladeCell(blades), color: [1, 1, 1],
                                                 castsShadow: false, receivesShadow: false, doubleSided: true });
        node.setShader({ vertex, fragment: fragment(radius) });
        node.cullMargin = 4 * radius;   // the shader places the blades
        node.setShaderBuffer('u_field', field);
        node.setShaderBuffer('u_sun', sunGrid.buffer);
        node.setShaderBuffer('u_cells', bro.kernel.createBuffer(ring.cells));
        node.setShaderUniform('u_blades', blades);
        node.setShaderUniform('u_band', band);
        node.count = ring.angles.length;
        node.angles = ring.angles;
        node.setShaderUniform('u_cellCount', node.count);
        node.setShaderUniform('u_first', 0);
        node.reach = band[1];
        node.shown = false;
        node.setInstanceCount(0);
        return node;
    });

    let face = -1, delta = 0, ui = NaN, vi = NaN, sunDue = -1;
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
            n.setShaderUniform('u_first', first);
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
            fieldKernel.dispatch([P, P], field, ...plane, (ui - N / 2) * dl, (vi - N / 2) * dl, dl,
                                 ...origin, radius, octaves, seed, net);
            for (let k = 0; k < 3; k++) {
                hi[k] = Math.fround(origin[k]);
                lo[k] = origin[k] - hi[k];
            }
            for (const n of nodes) {
                n.setShaderUniform('u_oHi', hi);
                n.setShaderUniform('u_oLo', lo);
                n.setShaderUniform('u_lattice', [ui - N / 2, vi - N / 2]);
            }
            // The sun grid follows a frame later, read about its own lattice
            // meanwhile, so the two dispatches do not land in one frame;
            // unless the field changed face or spacing and the old grid
            // means nothing.
            sunDue = jumped ? 0 : 1;
        }
        const turned = sun[0] * toSun[0] + sun[1] * toSun[1] + sun[2] * toSun[2] < 0.999999;
        if (turned && sunDue < 0) sunDue = 0;
        if (sunDue > 0) { sunDue--; return; }
        if (sunDue < 0) return;
        sunDue = -1;
        sun.splice(0, 3, ...toSun);
        for (const job of sunGrid.jobs(plane, (ui - N / 2) * dl, (vi - N / 2) * dl, dl * SUN_STRIDE, toSun, radius, octaves, seed)) job();
        for (const n of nodes) n.setShaderUniform('u_sunLattice', [ui - N / 2, vi - N / 2]);
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
                n.setShaderUniform('u_camHi', camHi);
                n.setShaderUniform('u_camLo', camLo);
                n.setShaderUniform('u_time', time);
                n.setShaderUniform('u_camFwd', forward);
                n.setShaderUniform('u_cosView', Math.cos(Math.min(cone + 0.1, Math.PI)));
            }
        },
    };
}
