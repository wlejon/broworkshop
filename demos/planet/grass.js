// Planet grass: blades about the eye, standing on a field of the ground's
// true surface (grass.bk k_grass_field) that follows the eye on a lattice
// fixed to the world, so a blade stays where it grew as the eye moves.
//
// The field is a grid of points on the gnomonic plane of the eye's cube
// face (as the clouds' clipmap, clouds.js), spaced about a metre (a power of
// two of the plane's units, so the lattice holds still), produced again when
// the eye has moved SNAP points or the sun has turned. Each point holds its
// place, how much of the ground there grows grass (ground.bk grass_cover:
// grassland past the beach, less rock and snow), its albedo, and how much of
// the sun's disc it sees over the terrain.
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

const N = 128;             // field cells along an edge
const P = N + 1;           // field points along an edge
const SNAP = 8;            // points the eye moves before the field is produced again
const SPACING = 1.0;       // metres between field points, about (a power of two of the plane's units)
const THIN = 6;            // metres out to which every blade stands
const NEAR = 12;           // metres: the dense cells inside, the sparse ones out to FAR
const FAR = 40;            // metres: no blade stands past it
const DENSE = 64;          // blades in a near cell
const SPARSE = 32;         // and in a far one: what stands of the dense ones at NEAR
const SHOWN_BELOW = 120;   // metres of altitude above which no grass is drawn

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
// root 2 of SPACING).
function cellRing(r0, r1) {
    const out = [], near = 0.7071 * SPACING, far = 1.4143 * SPACING;
    const lo = r0 / far - SNAP / 2 - 1, hi = r1 / near + SNAP / 2 + 1, reach = Math.ceil(hi);
    for (let dy = -reach; dy < reach; dy++)
        for (let dx = -reach; dx < reach; dx++) {
            const d = Math.hypot(dx + 0.5, dy + 0.5);
            if (d >= lo && d < hi) out.push(dx, dy);
        }
    return new Int32Array(out);
}

const vertex = `buffer float u_field[];
    buffer int u_cells[];
    uniform vec3 u_camHi;
    uniform vec3 u_camLo;
    uniform vec3 u_oHi;
    uniform vec3 u_oLo;
    uniform vec2 u_lattice;   // the field's point 0 on the world's lattice
    uniform float u_time;
    uniform float u_blades;   // this cell's blades
    uniform vec2 u_band;      // the distances this node draws over: blades from r0, none past r1
    out vec3 v_col;
    out float v_t;
    out float v_lit;
    uint pcg(uint v) {
        uint s = v * 747796405u + 2891336453u;
        uint w = ((s >> ((s >> 28u) + 4u)) ^ s) * 277803737u;
        return (w >> 22u) ^ w;
    }
    float rnd(inout uint s) { s = pcg(s); return float(s) * (1.0 / 4294967296.0); }
    void fieldPoint(int x, int y, out vec3 p, out float cover, out vec3 albedo, out float lit) {
        int k = (y * ${P} + x) * 8;
        p = vec3(u_field[k], u_field[k + 1], u_field[k + 2]);
        cover = u_field[k + 3];
        albedo = vec3(u_field[k + 4], u_field[k + 5], u_field[k + 6]);
        lit = u_field[k + 7];
    }
    void userVertex(inout vec3 pos, inout vec3 normal, inout vec2 uv) {
        ivec2 cell = ivec2(u_cells[2 * gl_InstanceIndex], u_cells[2 * gl_InstanceIndex + 1]) + ivec2(${N / 2});
        int b = int(pos.x + 0.5);
        float t = pos.y, side = pos.z;
        ivec2 world = cell + ivec2(u_lattice);
        uint seed = pcg(uint(world.x) * 73856093u ^ uint(world.y) * 19349663u ^ uint(b) * 83492791u);
        vec2 at = vec2(rnd(seed), rnd(seed));
        cell = clamp(cell, ivec2(0), ivec2(${N - 1}));
        vec3 p00, p10, p01, p11, a00, a10, a01, a11;
        float c00, c10, c01, c11, l00, l10, l01, l11;
        fieldPoint(cell.x, cell.y, p00, c00, a00, l00);
        fieldPoint(cell.x + 1, cell.y, p10, c10, a10, l10);
        fieldPoint(cell.x, cell.y + 1, p01, c01, a01, l01);
        fieldPoint(cell.x + 1, cell.y + 1, p11, c11, a11, l11);
        vec3 base = mix(mix(p00, p10, at.x), mix(p01, p11, at.x), at.y);
        float cover = mix(mix(c00, c10, at.x), mix(c01, c11, at.x), at.y);
        vec3 albedo = mix(mix(a00, a10, at.x), mix(a01, a11, at.x), at.y);
        v_lit = mix(mix(l00, l10, at.x), mix(l01, l11, at.x), at.y);
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

// The grass in `scene`, its field produced by `kernel` (grass.bk
// k_grass_field) at `octaves` of the ground's. Its nodes read the clouds'
// field (createClouds' readers). update() each frame with the eye about the
// planet's centre (f64), its altitude and the unit direction to the sun.
export function createGrass(scene, radius, kernel, octaves, seed) {
    const field = bro.kernel.createBuffer(P * P * 8 * 4);
    const bands = [
        { blades: DENSE, band: [0, NEAR], cells: cellRing(0, NEAR) },
        { blades: SPARSE, band: [NEAR, FAR], cells: cellRing(NEAR, FAR) },
    ];
    const nodes = bands.map(({ blades, band, cells }) => {
        const node = scene.createInstancedMesh({ mesh: bladeCell(blades), color: [1, 1, 1],
                                                 castsShadow: false, receivesShadow: false, doubleSided: true });
        node.setShader({ vertex, fragment: fragment(radius) });
        node.cullMargin = 4 * radius;   // the shader places the blades
        node.setShaderBuffer('u_field', field);
        node.setShaderBuffer('u_cells', bro.kernel.createBuffer(cells));
        node.setShaderUniform('u_blades', blades);
        node.setShaderUniform('u_band', band);
        node.count = cells.length / 2;
        node.setInstanceCount(0);
        return node;
    });

    let face = -1, delta = 0, ui = NaN, vi = NaN, shown = false;
    const sun = [0, 0, 0];
    const hi = [0, 0, 0], lo = [0, 0, 0];

    function faceOf(eye) {
        const m = eye.map(Math.abs);
        const best = m[0] >= m[1] && m[0] >= m[2] ? 0 : (m[1] >= m[2] ? 1 : 2);
        if (face >= 0 && m[face % 3] * 1.05 >= m[best] && Math.sign(eye[face % 3]) === (face < 3 ? 1 : -1)) return face;
        return best + (eye[best] < 0 ? 3 : 0);
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
        const turned = sun[0] * toSun[0] + sun[1] * toSun[1] + sun[2] * toSun[2] < 0.999999;
        if (fc === face && dl === delta && nu === ui && nv === vi && !turned) return;
        face = fc;
        delta = dl;
        ui = nu;
        vi = nv;
        sun.splice(0, 3, ...toSun);
        const c = [0, 0, 0];
        for (let k = 0; k < 3; k++) c[k] = frame.a[k] + frame.e[k] * ui * dl + frame.f[k] * vi * dl;
        const len = Math.hypot(c[0], c[1], c[2]);
        const origin = c.map((x) => x / len * radius);
        const u0 = (ui - N / 2) * dl, v0 = (vi - N / 2) * dl;
        kernel.dispatch([P, P], field,
            frame.a[0], frame.a[1], frame.a[2], frame.e[0], frame.e[1], frame.e[2], frame.f[0], frame.f[1], frame.f[2],
            u0, v0, dl, origin[0], origin[1], origin[2], toSun[0], toSun[1], toSun[2], radius, octaves, seed);
        for (let k = 0; k < 3; k++) {
            hi[k] = Math.fround(origin[k]);
            lo[k] = origin[k] - hi[k];
        }
        for (const n of nodes) {
            n.setShaderUniform('u_oHi', hi);
            n.setShaderUniform('u_oLo', lo);
            n.setShaderUniform('u_lattice', [ui - N / 2, vi - N / 2]);
        }
    }

    return {
        nodes,
        field,
        update(eye, altitude, toSun, camHi, camLo, time) {
            const show = altitude < SHOWN_BELOW;
            if (show !== shown) {
                shown = show;
                for (const n of nodes) n.setInstanceCount(show ? n.count : 0);
            }
            if (!show) return;
            produce(eye, toSun);
            for (const n of nodes) {
                n.setShaderUniform('u_camHi', camHi);
                n.setShaderUniform('u_camLo', camLo);
                n.setShaderUniform('u_time', time);
            }
        },
    };
}
