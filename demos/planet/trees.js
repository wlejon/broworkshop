// Planet trees: conifers about the eye wherever the ground is forest, each
// standing at its own site of a lattice fixed to the world (trees.bk
// k_tree_field), so a tree is the same tree from 2 m and from 2 km.
//
// The field is N x N sites on the gnomonic plane of the eye's cube face (as
// the grass's, grass.js), about SPACING metres apart (a power of two of the
// plane's units), each the ground's true surface at the site's hashed spot,
// whether a tree stands there and how large, and the colour variation there.
// It is produced again when the eye has moved SNAP sites, into a second
// buffer a slice a frame, and swapped in when it is whole, so no frame pays
// for all of it; the terrain's shadow on it (sun.js) follows the same way.
//
// The trees are drawn in blocks of B x B sites, one instance per block, the
// GPU building every tree from its site and a hash of it (as the grass's
// blades). A conifer is a cone of whorls: tiers of drooping branches, each a
// fan from the trunk out to a ragged rim, lit as the soft cone the crown is
// and darker inside and below, where the crown shades itself (Ghost of
// Tsushima's trees and the tiered silhouettes of spruce and fir are the
// models). Near, seven tiers of seven; out to MID, three of five; beyond, the
// cone's silhouette facing the eye; past FAR they shrink into the ground,
// whose forest colour is what they average to (ground.bk tree_cover).
import { faceFrame } from "/app/clouds.js";
import { createSunGrid } from "/app/sun.js";
import { stepped } from "/app/stepped.js";
import { constants, readApp } from "/app/shaders.js";

const N = 512;             // sites along an edge
const B = 8;               // sites along a block's edge
const SNAP = 16;           // sites the eye moves before the field is produced again
const SLICES = 16;         // frames a field's production takes, a slice of rows each
const SPACING = 8.0;       // metres between sites, about (a power of two of the plane's units)
const NEAR = 220;          // metres: the full trees inside
const MID = 800;           // the three-tier ones out to it
const FAR = 1900;          // the silhouettes out to it, shrinking over its last sixth
const SUN_STRIDE = 4;      // sites between the sun grid's points
const SUN_P = N / SUN_STRIDE + 1;
const SHOWN_BELOW = 2500;  // metres of altitude above which no tree is drawn
const MAX_TREE_H = 24;     // metres: the tallest tree (treeCrown at size 1)
const SHADOW_REACH = 64;   // metres: the farthest a crown's shadow is followed toward the sun
const SHADOW_STEPS = 14;   // and the most steps along it

// The meshes: per tree in a block (x its index), its parts by (y, z):
// y >= 0 tier y, z its rim vertex (-1 the tier's top, at the trunk);
// y = -1 the trunk (z 0..2 its foot, -1 its top); y = -2 the silhouette's
// corners (z 0..2).
function treeBlock(tiers, rim, trunk) {
    const pos = [], idx = [];
    for (let t = 0; t < B * B; t++) {
        if (tiers > 0) {
            for (let k = 0; k < tiers; k++) {
                const top = pos.length / 3;
                pos.push(t, k, -1);
                for (let i = 0; i < rim; i++) pos.push(t, k, i);
                for (let i = 0; i < rim; i++) idx.push(top, top + 1 + i, top + 1 + (i + 1) % rim);
            }
            if (trunk) {
                const foot = pos.length / 3;
                pos.push(t, -1, 0, t, -1, 1, t, -1, 2, t, -1, -1);
                for (let i = 0; i < 3; i++) idx.push(foot + 3, foot + i, foot + (i + 1) % 3);
            }
        } else {
            const c = pos.length / 3;
            pos.push(t, -2, 0, t, -2, 1, t, -2, 2);
            idx.push(c, c + 1, c + 2);
        }
    }
    const normals = new Float32Array(pos.length);
    for (let i = 1; i < normals.length; i += 3) normals[i] = 1;
    return new Mesh({ positions: new Float32Array(pos), normals, indices: new Uint32Array(idx) });
}

// The shaders: the trees' hook (trees_mesh.bk) and the crowns' module
// (tree_crown.bk), which the hook builds its trees from and the ground
// shades their shadows with, both reading this layout.
const LAYOUT = constants('planet::tree_layout', {
    N: ['i32', N], B: ['i32', B], FAR: ['f32', FAR], SUN_STRIDE: ['i32', SUN_STRIDE], SUN_P: ['i32', SUN_P],
    MAX_TREE_H: ['f32', MAX_TREE_H], SHADOW_REACH: ['f32', SHADOW_REACH], SHADOW_STEPS: ['i32', SHADOW_STEPS],
});
// What a reader of the trees' field imports (tree_crown.bk tree_shadow).
export const treeModules = { 'planet::tree_layout': LAYOUT, 'planet::tree_crown': readApp('tree_crown.bk') };
const HOOK = readApp('trees_mesh.bk');

const BLOCKS = N / B;           // blocks along an edge
// How far a tree of a block can stand from the block's centre on the
// sphere at the eye's ground: half its diagonal (a site is at most 1.41
// SPACING), the tree, and the relief between.
const BLOCK_REACH = 0.7072 * B * 1.4143 * SPACING + 30 + 250;

// The trees in `scene`, their field produced by `module` (trees.bk
// k_tree_field) and their sun grid, the terrain's shadow and the clouds'
// light, by `sunModule` (sun.bk) at `octaves` of the ground's; `readers`
// are nodes whose hooks import treeModules, bound to theirs.
// update() each frame with the eye about the planet's centre (f64), its
// altitude, the unit direction to the sun and the view's forward.
export function createTrees(scene, radius, module, sunModule, octaves, seed, net, readers = []) {
    const fieldKernel = module.kernel('k_tree_field');
    const fields = [bro.kernel.createBuffer(N * N * 7 * 4), bro.kernel.createBuffer(N * N * 7 * 4)];
    const sunGrid = createSunGrid(sunModule, SUN_P, net, 14);
    const bands = [
        { tiers: 7, rim: 7, trunk: true, band: [0, NEAR], ragged: true },
        { tiers: 3, rim: 5, trunk: false, band: [NEAR, MID], ragged: false },
        { tiers: 0, rim: 0, trunk: false, band: [MID, FAR], ragged: false },
    ];
    // Each band draws the blocks the CPU finds in its distances and in view,
    // listed afresh each frame (a few thousand blocks, against drawing all of
    // them in every band, most out of it or behind the eye).
    const lists = bands.map(() => ({ blocks: new Int32Array(2 * BLOCKS * BLOCKS), buffer: null, count: 0,
                                    found: new Int32Array(BLOCKS * BLOCKS), dist: new Float64Array(BLOCKS * BLOCKS) }));
    const nodes = bands.map(({ tiers, rim, trunk, band, ragged }, i) => {
        const node = scene.createInstancedMesh({
            mesh: treeBlock(tiers, rim, trunk), color: [1, 1, 1],
            castsShadow: false, receivesShadow: false, doubleSided: true,
            module: HOOK, file: 'trees_mesh.bk',
            modules: { ...treeModules, tree_band: constants('tree_band', { RAGGED: ['bool', ragged] }) },
        });
        node.cullMargin = 4 * radius;   // the shader places the trees
        node.drawOrder = 4;             // before the grass and the ground they hide
        node.setShaderBuffer('field', fields[0]);
        node.setShaderBuffer('sun', sunGrid.buffer);
        lists[i].buffer = bro.kernel.createBuffer(lists[i].blocks.byteLength);
        node.setShaderBuffer('blocks', lists[i].buffer);
        node.setShaderUniform('band', band);
        node.setShaderUniform('shape', [tiers, rim]);
        node.setInstanceCount(0);
        return node;
    });
    // The front field's block centres: unit directions, three a block.
    const centres = new Float64Array(3 * BLOCKS * BLOCKS);

    // The field shown (front); the production in flight, a step a frame
    // beside the frames (stepped.js: a whole field and its sun grid in one
    // frame lengthened it by 6 ms), shown once done.
    let front = 0, shown = false, ready = false;
    let face = -1, delta = 0, ui = NaN, vi = NaN;
    let production = null;
    const sun = [0, 0, 0];

    function faceOf(eye) {
        const m = eye.map(Math.abs);
        const best = m[0] >= m[1] && m[0] >= m[2] ? 0 : (m[1] >= m[2] ? 1 : 2);
        if (face >= 0 && m[face % 3] * 1.05 >= m[best] && Math.sign(eye[face % 3]) === (face < 3 ? 1 : -1)) return face;
        return best + (eye[best] < 0 ? 3 : 0);
    }

    // The sun grid's steps, and showing it.
    function sunSteps(plane, u0, v0, dl, toSun) {
        sun.splice(0, 3, ...toSun);
        return sunGrid.steps(plane, u0, v0, dl * SUN_STRIDE, toSun, radius, octaves, seed);
    }
    function showSun(lattice) {
        const buffer = sunGrid.swap();
        for (const n of nodes) {
            n.setShaderBuffer('sun', buffer);
            n.setShaderUniform('sun_lattice', lattice);
        }
    }

    let current = null;   // the field shown or in flight: its plane, origin, lattice
    function plan(eye, toSun) {
        const fc = faceOf(eye), frame = faceFrame(fc);
        const z = eye[0] * frame.a[0] + eye[1] * frame.a[1] + eye[2] * frame.a[2];
        const u = (eye[0] * frame.e[0] + eye[1] * frame.e[1] + eye[2] * frame.e[2]) / z;
        const v = (eye[0] * frame.f[0] + eye[1] * frame.f[1] + eye[2] * frame.f[2]) / z;
        const stretch = Math.sqrt(1 + Math.max(u * u, v * v)) / (1 + u * u + v * v);
        const dl = 2 ** Math.round(Math.log2(SPACING / (radius * stretch)));
        const nu = Math.round(u / (SNAP * dl)) * SNAP, nv = Math.round(v / (SNAP * dl)) * SNAP;
        const plane = [...frame.a, ...frame.e, ...frame.f];
        const jumped = fc !== face || dl !== delta;
        // A production begun is shown before the next begins, unless the eye
        // left its face or spacing: then the new one replaces it (background
        // jobs run in order, so the back field ends as the new one's).
        if ((jumped || nu !== ui || nv !== vi) && (jumped || !production)) {
            face = fc;
            delta = dl;
            ui = nu;
            vi = nv;
            const c = [0, 0, 0];
            for (let k = 0; k < 3; k++) c[k] = frame.a[k] + frame.e[k] * ui * dl + frame.f[k] * vi * dl;
            const len = Math.hypot(c[0], c[1], c[2]);
            const origin = c.map((x) => x / len * radius);
            const li = ui - N / 2, lj = vi - N / 2, u0 = li * dl, v0 = lj * dl;
            const back = 1 - front, out = fields[back];
            const hi = origin.map(Math.fround), lo = origin.map((x, k) => x - hi[k]);
            const steps = [];
            for (let s = 0; s < SLICES; s++) {
                const y0 = s * N / SLICES;
                steps.push(() => fieldKernel.dispatch([N, N / SLICES], out, ...plane, u0, v0, dl, ...origin,
                                                      radius, octaves, seed, li, lj, fc, y0, net));
            }
            steps.push(...sunSteps(plane, u0, v0, dl, toSun));
            production = stepped(steps, () => {
                front = back;
                for (let by = 0; by < BLOCKS; by++)
                    for (let bx = 0; bx < BLOCKS; bx++) {
                        const su = u0 + (bx + 0.5) * B * dl, sv = v0 + (by + 0.5) * B * dl, j = 3 * (by * BLOCKS + bx);
                        const x = frame.a[0] + frame.e[0] * su + frame.f[0] * sv;
                        const y = frame.a[1] + frame.e[1] * su + frame.f[1] * sv;
                        const z = frame.a[2] + frame.e[2] * su + frame.f[2] * sv;
                        const l = Math.hypot(x, y, z);
                        centres[j] = x / l;
                        centres[j + 1] = y / l;
                        centres[j + 2] = z / l;
                    }
                for (const n of nodes) {
                    n.setShaderBuffer('field', fields[front]);
                    n.setShaderUniform('o_hi', hi);
                    n.setShaderUniform('o_lo', lo);
                    n.setShaderUniform('lattice', [li, lj, fc]);
                }
                for (const n of readers) {
                    n.setShaderBuffer('tree_field', fields[front]);
                    n.setShaderUniform('tree_o_hi', hi);
                    n.setShaderUniform('tree_o_lo', lo);
                    n.setShaderUniform('tree_lattice', [li, lj, fc]);
                    n.setShaderUniform('tree_a', frame.a);
                    n.setShaderUniform('tree_e', frame.e);
                    n.setShaderUniform('tree_f', frame.f);
                    n.setShaderUniform('tree_uv', [u0, v0, dl]);
                }
                showSun([li, lj]);
                ready = true;
            });
            current = { plane, u0, v0, dl, li, lj };
            return;
        }
        const turned = sun[0] * toSun[0] + sun[1] * toSun[1] + sun[2] * toSun[2] < 0.999999;
        if (turned && !production && current) {
            const { plane: p, u0, v0, dl: d, li, lj } = current;
            production = stepped(sunSteps(p, u0, v0, d, toSun), () => showSun([li, lj]));
        }
    }

    // The blocks each band draws: a block's trees stand within BLOCK_REACH
    // of its centre on the sphere at the eye's ground, which is in the band's
    // distances and inside the cone `cone` (radians) about `forward`.
    // Blocks are tested a superblock (SUPER x SUPER blocks) at a time first,
    // and listed again only once the eye has moved LIST_MOVE metres or turned
    // LIST_TURN, the cone widened by LIST_SLACK so what comes into view
    // meanwhile is already listed.
    const SUPER = 8, SUPERS = BLOCKS / SUPER;
    const SUPER_REACH = 0.7072 * SUPER * B * 1.4143 * SPACING + 30 + 250;
    const LIST_MOVE = 8, LIST_TURN = 2 * Math.PI / 180, LIST_SLACK = 3 * Math.PI / 180;
    const last = { eye: [NaN, 0, 0], forward: [0, 0, 0], field: -1 };
    const counts = [0, 0, 0];
    const r0 = bands.map((b) => b.band[0]), r1 = bands.map((b) => b.band[1]);
    function listBlocks(eye, altitude, forward, cone) {
        const ex = eye[0], ey = eye[1], ez = eye[2];
        const fx = forward[0], fy = forward[1], fz = forward[2];
        const mx = ex - last.eye[0], my = ey - last.eye[1], mz = ez - last.eye[2];
        const turn = fx * last.forward[0] + fy * last.forward[1] + fz * last.forward[2];
        if (last.field === front && mx * mx + my * my + mz * mz < LIST_MOVE * LIST_MOVE && turn > Math.cos(LIST_TURN)) return;
        last.eye = [ex, ey, ez];
        last.forward = [fx, fy, fz];
        last.field = front;
        const ground = Math.sqrt(ex * ex + ey * ey + ez * ez) - altitude;
        const wide = cone + LIST_SLACK;
        const cosCone = Math.cos(wide), sinCone = Math.sin(wide);
        // Whether a ball `reach` about a point r (d away) is in the distances
        // and the cone: the angle off forward under cone + asin(reach / d),
        // that is cos(off) above that sum's cosine, or always once it passes pi.
        const seen = (rx, ry, rz, d, reach) => {
            if (d - reach > FAR) return false;
            if (d <= reach) return true;
            const s = reach / d, c = Math.sqrt(1 - s * s);
            const cosSum = cosCone * c - sinCone * s;
            if (sinCone * c + cosCone * s < 0 && cosSum < 0) return true;
            return rx * fx + ry * fy + rz * fz >= cosSum * d;
        };
        counts[0] = counts[1] = counts[2] = 0;
        for (let sb = 0; sb < SUPERS * SUPERS; sb++) {
            const sx = sb % SUPERS, sy = (sb - sx) / SUPERS;
            const cb = ((sy * SUPER + SUPER / 2) * BLOCKS + sx * SUPER + SUPER / 2) * 3;
            const qx = centres[cb] * ground - ex, qy = centres[cb + 1] * ground - ey, qz = centres[cb + 2] * ground - ez;
            if (!seen(qx, qy, qz, Math.sqrt(qx * qx + qy * qy + qz * qz), SUPER_REACH)) continue;
            for (let j = 0; j < SUPER * SUPER; j++) {
                const bxi = sx * SUPER + j % SUPER, byi = sy * SUPER + (j - j % SUPER) / SUPER;
                const b = 3 * (byi * BLOCKS + bxi);
                const rx = centres[b] * ground - ex, ry = centres[b + 1] * ground - ey, rz = centres[b + 2] * ground - ez;
                const d = Math.sqrt(rx * rx + ry * ry + rz * rz);
                if (!seen(rx, ry, rz, d, BLOCK_REACH)) continue;
                for (let i = 0; i < 3; i++) {
                    if (d + BLOCK_REACH < r0[i] || d - BLOCK_REACH > r1[i]) continue;
                    const n = counts[i];
                    lists[i].found[n] = byi * BLOCKS + bxi;
                    lists[i].dist[n] = d;
                    counts[i] = n + 1;
                }
            }
        }
        // Nearest first, so the depth test turns away what they hide.
        for (let i = 0; i < lists.length; i++) {
            const l = lists[i], n = counts[i];
            const order = Array.from({ length: n }, (_, k) => k).sort((p, q) => l.dist[p] - l.dist[q]);
            for (let k = 0; k < n; k++) {
                const b = l.found[order[k]];
                l.blocks[2 * k] = b % BLOCKS - BLOCKS / 2;
                l.blocks[2 * k + 1] = (b - b % BLOCKS) / BLOCKS - BLOCKS / 2;
            }
            l.count = n;
            if (n) l.buffer.write(l.blocks.subarray(0, 2 * n));
            nodes[i].setInstanceCount(n);
        }
    }

    return {
        nodes,
        // How far off the trees are drawn (0: not at all), the last sixth of
        // it shrinking: beyond, the ground draws the forest's average.
        get far() { return shown ? FAR : 0; },
        // cone: the half-angle of the view's diagonal, radians.
        update(eye, altitude, toSun, camHi, camLo, forward, cone, time) {
            const visible = altitude < SHOWN_BELOW;
            if (visible !== shown) {
                shown = visible;
                if (!visible) for (const n of nodes) n.setInstanceCount(0);
            }
            if (!visible) return;
            if (production && production.advance()) production = null;
            plan(eye, toSun);
            // (None drawn until the first field is there.)
            if (!ready) return;
            listBlocks(eye, altitude, forward, cone);
            for (const n of nodes) {
                n.setShaderUniform('cam_hi', camHi);
                n.setShaderUniform('cam_lo', camLo);
                n.setShaderUniform('cam_fwd', forward);
                n.setShaderUniform('time', time);
                n.setShaderUniform('to_sun', toSun);
            }
        },
    };
}
