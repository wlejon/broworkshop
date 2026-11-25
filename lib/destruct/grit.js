// lib/destruct/grit.js — the fine scale of things breaking: crumbs and
// shards the broken bodies shed as they move, each a small lit box, falling
// to the ground, lying a while, and gone (grit.bk: one kernel a frame, on the
// GPU; nothing of it is read back, and the solver knows nothing of it).
//
// createGrit(scene, { max, reach }) -> { update(state), count(), node, destroy() }
//   max    the crumbs there can be at once (65536)
//   reach  how far from the eye (m) a body sheds them and they are drawn (140)
//   state  { rows, built, pieces, na, nb, units, dt, blend, span, ground, eye }
//     eye            where the picture is seen from ([x, y, z]): only bodies
//                    within `reach` of it shed (absent: every body does)
//     rows           the solver's k_show rows the picture is drawn from
//     built, pieces  the bodies' spheres as the picture draws them, the
//                    bodies as built (na of them) and the pieces (nb, bodies
//                    `units` on)
//     dt             the seconds the picture has gone on since the last
//                    update (the picture's, not the frame's: crumbs keep to
//                    the pieces' clock)
//     blend, span    how far the picture is between the rows' two showings,
//                    and the seconds between them
//     ground         { buffer, origin, dim, cell }: the solver's heights

const HOOK = `
module hook;
import mesh;

// Per crumb, 2 x vec4 (grit.bk's S): (where it is, the seconds it has left), (how fast it goes, its seed).
@binding(4, 14) var grit: read_buffer<vec4<f32>>;

fn h1(x: f32) -> f32 { return fract(sin(x * 91.7 + 3.1) * 43758.5453); }

fn qrot(q: vec4<f32>, v: vec3<f32>) -> vec3<f32> {
    let t = 2.0 * cross(q.xyz, v);
    return v + q.w * t + cross(q.xyz, t);
}

pub fn vertex(v_in: mesh::Vertex) -> mesh::Vertex {
    var v = v_in;
    let a = grit[v.instance_index * 2];
    let b = grit[v.instance_index * 2 + 1];
    let seed = b.w;
    if (a.w <= 0.0) {
        v.pos = vec3<f32>(0.0, -100000.0, 0.0);
        return v;
    }
    // Most are small, a hand across; the odd one is a lump half a metre
    // wide. A fifth are shards: thin, and longer than they are wide.
    let big = seed * seed * seed * seed;
    let size = 0.04 + 0.24 * big;
    let shard = h1(seed * 7.0) < 0.2;
    var half = vec3<f32>(1.0, 0.45 + 0.5 * h1(seed * 3.0), 0.6 + 0.4 * h1(seed * 5.0)) * size;
    if (shard) { half = vec3<f32>(1.6, 0.08, 0.5 + 0.6 * h1(seed * 5.0)) * size; }
    // It turns as it goes and lies as it stopped: its turn is by how far it has come.
    let axis = normalize(vec3<f32>(h1(seed * 11.0) - 0.5, h1(seed * 13.0) - 0.5, h1(seed * 17.0) - 0.5) + vec3<f32>(0.001, 0.0, 0.0));
    let turn = seed * 40.0 + (a.x + a.y + a.z) * (1.5 + 3.0 * h1(seed * 19.0));
    let q = vec4<f32>(axis * sin(0.5 * turn), cos(0.5 * turn));
    // Its last second it sinks into the ground it lies on.
    let sink = clamp(1.0 - a.w, 0.0, 1.0) * 2.5 * size;
    v.pos = qrot(q, v.pos * 2.0 * half) + a.xyz + vec3<f32>(0.0, half.y - sink, 0.0);
    v.normal = qrot(q, v.normal);
    v.v0 = vec4<f32>(seed, select(shard, 1.0, 0.0), 0.0, 0.0);
    return v;
}

pub fn fragment(v: mesh::Vertex, s_in: mesh::Surface) -> mesh::Surface {
    var s = s_in;
    let seed = v.v0.x;
    // Broken concrete and plaster, each its own grey, dusted; a shard is glass.
    let tone = 0.24 + 0.26 * h1(seed * 23.0);
    s.base_color = vec3<f32>(tone, tone * 0.98, tone * 0.94);
    s.roughness = 0.92;
    s.metallic = 0.0;
    if (v.v0.y > 0.5) {
        s.base_color = vec3<f32>(0.10, 0.16, 0.17);
        s.roughness = 0.12;
    }
    s.emissive = vec3<f32>(0.0, 0.0, 0.0);
    return s;
}
`;

function boxMesh() {
    // A unit box, four vertices a face (flat faces).
    const P = [], Nn = [], I = [];
    const faces = [
        [[1, 0, 0], [0, 1, 0], [0, 0, 1]], [[-1, 0, 0], [0, 0, 1], [0, 1, 0]],
        [[0, 1, 0], [0, 0, 1], [1, 0, 0]], [[0, -1, 0], [1, 0, 0], [0, 0, 1]],
        [[0, 0, 1], [1, 0, 0], [0, 1, 0]], [[0, 0, -1], [0, 1, 0], [1, 0, 0]],
    ];
    for (const [n, a, b] of faces) {
        const k = P.length / 3;
        for (const [sa, sb] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
            P.push(0.5 * (n[0] + sa * a[0] + sb * b[0]), 0.5 * (n[1] + sa * a[1] + sb * b[1]), 0.5 * (n[2] + sa * a[2] + sb * b[2]));
            Nn.push(...n);
        }
        I.push(k, k + 1, k + 2, k, k + 2, k + 3);
    }
    return new bro.mesh.Mesh({ positions: new Float32Array(P), normals: new Float32Array(Nn), indices: new Uint32Array(I) });
}

export async function createGrit(scene, { max = 1 << 16, reach = 140 } = {}) {
    const src = require('fs').readFileSync(bro.resolvePath('/lib/destruct/grit.bk'), 'utf8');
    const kernel = bro.kernel.compile(src, { file: 'lib/destruct/grit.bk' }).kernel('k_grit');
    const state = bro.kernel.createBuffer(max * 32);
    const nowhere = new Float32Array(max * 4);
    for (let i = 0; i < max; i++) nowhere[4 * i + 1] = -1e5;
    const spheres = bro.kernel.createBuffer(nowhere);
    const node = scene.createInstancedMesh({
        name: 'destruct_grit', mesh: boxMesh(), capacity: max, instances: new Float32Array(0),
        color: [1, 1, 1], castsShadow: false, receivesShadow: true,
    });
    node.setCullBounds([-20000, -1000, -20000], [20000, 2000, 20000]);
    await node.setShaderAsync({ module: HOOK, file: 'lib/destruct/grit.js (crumbs)' });
    node.setShaderBuffer('grit', state);
    node.setInstanceCullSpheres(spheres, { maxDistance: reach, fade: 0.3 });
    node.setInstanceCount(max);
    let frame = 0;
    return {
        node,
        /** How many crumbs there are (read back from the GPU: for a test or a look, not each frame). */
        count() {
            const a = new Float32Array(max * 8);
            state.read(a);
            let n = 0;
            for (let i = 0; i < max; i++) if (a[8 * i + 3] > 0) n++;
            return n;
        },
        update(s) {
            if (!(s.dt > 0) || !s.ground) return;
            frame++;
            // (With no eye given, every body sheds.)
            const e = s.eye ?? [0, 0, 0], shed = s.eye ? reach : 1e9, g = s.ground;
            // (A long stretch at once, a picture catching up, is taken as a few short ones' worth: a crumb's
            // fall is stepped, and a step of a tenth of a second is a coarse one.)
            kernel.dispatch(max, state, spheres, s.rows, s.built, s.pieces, g.buffer,
                            s.na, s.nb, s.units, frame, Math.min(s.dt, 0.05), s.blend, s.span,
                            e[0], e[1], e[2], shed, g.origin[0], g.origin[1], g.origin[2], g.cell, g.dim);
            // (Bound again: what moves is drawn where it is.)
            node.setInstanceCullSpheres(spheres, { maxDistance: reach, fade: 0.3 });
        },
        destroy() { node.destroy(); },
    };
}
