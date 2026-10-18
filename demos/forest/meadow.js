// The meadow's captures and measures (capture.js commands): stills across
// it at true scale, and its look by distance.
//
//   meadow [label=meadow] [skies=noon,golden] [wind=breeze]
//       a flowering plant at 0.5 and 3 m, the meadow's ground at 30, 60 and
//       150 m, two skims low over it (8 m up, 60 and 150 m out) and a view
//       under the trees: <label>_meadow_<sky>_<d>m.jpg,
//       <label>_meadow_<sky>_skim<d>.jpg, <label>_understory_<sky>.jpg.
//   meadowbands [label=meadowbands] [skies=noon,golden] [herbs=on|off]
//       standing in the meadow (eye 1.7 m, several places and ways, the
//       trees hidden, still air): per 1 m band of ground distance to 200 m
//       the mean colour and local contrast of the meadow's ground. Each view
//       is drawn twice, the second with every ring and the herbs' hand-over
//       moved out by 1.3 (as the grove's grassbands), so a ring's step shows
//       apart from the ground's own patches; and the tone of each octave of
//       distance against the 2-4 m band (the near look): <label>_meadowbands.json.
//   meadowtone [label=meadowtone] [skies=noon,golden] [herbs=on|off] [angle=8]
//       the same ground at one angle of view from 3 to 150 m away: the
//       centre of the frame looking down `angle` degrees at points in the
//       meadow, the eye d m off; mean colour against 3 m's. Only distance
//       (the level of detail) differs: <label>_meadowtone.json.

import { forest, setShot, sky, vp, groundHeight, GRASS_RANGE, HERBS, HERB_RANGE, meadowAt, MEADOW_LOOK,
         holdView, meadowShare, MEADOW } from "/app/forest.js";

const FLOWERS = ['daisy', 'poppy', 'yarrow', 'foxglove', 'bluebell', 'plantain'];

export function meadowCommands(ctx) {
    const { setup, step, saveJpeg, OUT, pos, opt } = ctx;

    function shots() {
        const label = pos(1) || 'meadow';
        for (const time of (pos(2) || 'noon,golden').split(',')) {
            setup(pos(3) || 'breeze', 'auto', time);
            // grass={json}: a look to try (setGrass's keys).
            if (opt('grass')) forest.grass.setGrass(JSON.parse(opt('grass')));
            setShot('meadow');
            step(1.5);
            // The flowering plant nearest a point a few metres in.
            const [px, pz] = meadowAt(5);
            const plants = forest.grass.herbPlants(px, pz, 5);
            const plant = plants.find((q) => FLOWERS.includes(HERBS[q.species])) || plants[0];
            const views = [0.5, 3, 30, 60, 150, 'skim60', 'skim150'];
            for (const d of views) {
                let eye, look, what;
                if (typeof d === 'string') {
                    // Low over the meadow, 8 m up, looking out across it.
                    const out = +d.slice(4);
                    const t = meadowAt(out);
                    look = [t[0], groundHeight(t[0], t[1]), t[1]];
                    const e = meadowAt(Math.max(out - 70, -10));
                    eye = [e[0], groundHeight(e[0], e[1]) + 8, e[1]];
                    what = `skimming, ${out} m out`;
                } else if (d < 10 && plant) {
                    const name = HERBS[plant.species];
                    const h = bro.flora.herbPreset(name).height;
                    look = [plant.x, plant.y + Math.min(0.6 * h, 0.5), plant.z];
                    // From the meadow's edge, looking a little down at it.
                    const pitch = d < 1 ? 0.45 : 0.5;
                    eye = [look[0] - MEADOW_LOOK[0] * d * Math.cos(pitch), look[1] + d * Math.sin(pitch),
                           look[2] - MEADOW_LOOK[1] * d * Math.cos(pitch)];
                    what = name;
                } else {
                    // From d m off, a little above the meadow (as the grove's
                    // herb views): its ground at 30 and 60, the far edge at 150.
                    const pitch = d >= 150 ? 0.12 : d >= 60 ? 0.22 : 0.2;
                    const t = meadowAt(d);
                    look = [t[0], groundHeight(t[0], t[1]) + (d >= 150 ? 2.5 : 0.3), t[1]];
                    eye = [look[0] - MEADOW_LOOK[0] * d * Math.cos(pitch), look[1] + d * Math.sin(pitch),
                           look[2] - MEADOW_LOOK[1] * d * Math.cos(pitch)];
                    eye[1] = Math.max(eye[1], groundHeight(eye[0], eye[2]) + 1.7);
                    what = d >= 150 ? 'the far edge' : 'the ground';
                }
                holdView(eye, look);
                step(1);
                flush();
                console.log(`meadow ${time} ${d}: ${what}`);
                saveJpeg(typeof d === 'string' ? `${OUT}/${label}_meadow_${time}_${d}.jpg`
                                               : `${OUT}/${label}_meadow_${time}_${d}m.jpg`);
            }
            setShot('understory');
            step(1.5);
            flush();
            saveJpeg(`${OUT}/${label}_understory_${time}.jpg`);
        }
    }

    // --- the measures ---------------------------------------------------------------

    const MAXD = 200, S = 1.3;
    const zero = () => ({ n: 0, r: 0, g: 0, b: 0, c: 0 });
    const lumaOf = (q) => (0.2126 * q.r + 0.7152 * q.g + 0.0722 * q.b) / q.n;
    // Saturation of a mean colour: (max - min) / max.
    const satOf = (q) => {
        const r = q.r / q.n, g = q.g / q.n, b = q.b / q.n, M = Math.max(r, g, b);
        return M > 0 ? (M - Math.min(r, g, b)) / M : 0;
    };
    // Hue in degrees (yellow 60, green 120).
    const hueOf = (q) => {
        const r = q.r / q.n, g = q.g / q.n, b = q.b / q.n, M = Math.max(r, g, b), m = Math.min(r, g, b);
        if (M - m < 1e-6) return 0;
        let h = M === r ? (g - b) / (M - m) : M === g ? 2 + (b - r) / (M - m) : 4 + (r - g) / (M - m);
        return ((h * 60) + 360) % 360;
    };
    const fmt = (q) => `luma ${lumaOf(q).toFixed(1)} sat ${satOf(q).toFixed(3)} hue ${hueOf(q).toFixed(1)} rgb ` +
                       `${(q.r / q.n).toFixed(0)},${(q.g / q.n).toFixed(0)},${(q.b / q.n).toFixed(0)} contrast ${(q.c / q.n).toFixed(1)}`;
    const add = (to, from) => from.forEach((q, i) => { for (const k in q) to[i][k] += q[k]; });
    const sum = (bins, a, b) => {
        const m = zero();
        for (let i = Math.max(0, Math.floor(a)); i < Math.min(bins.length, Math.ceil(b)); i++) for (const k in m) m[k] += bins[i][k];
        return m;
    };

    // Hide every tree and shrub: the meadow's ground alone. Returns the undo.
    function plantsHidden() {
        const was = forest.parts.map((p) => p.node.visible);
        forest.parts.forEach((p) => { p.node.visible = false; });
        return () => forest.parts.forEach((p, k) => { p.node.visible = was[k]; });
    }
    function herbsAt(scale, on) {
        if (!on) { forest.grass.setHerbs({ species: [] }); return; }
        forest.grass.setHerbs({ species: HERBS, range: HERB_RANGE * scale, far: 3 * HERB_RANGE * scale });
    }

    // The ground distance and meadow share of the frame's pixel (x, y), or null.
    function groundAt(x, y) {
        const ray = vp.ray(x + 0.5, y + 0.5);
        if (!ray || ray.dir[1] >= -1e-3) return null;
        let t = (ray.origin[1] - groundHeight(ray.origin[0], ray.origin[2])) / -ray.dir[1];
        let gx = 0, gz = 0;
        for (let k = 0; k < 5; k++) {
            gx = ray.origin[0] + ray.dir[0] * t; gz = ray.origin[2] + ray.dir[2] * t;
            t = (ray.origin[1] - groundHeight(gx, gz)) / -ray.dir[1];
        }
        if (!(t > 0)) return null;
        return { d: t * Math.hypot(ray.dir[0], ray.dir[2]), share: meadowShare(gx, gz) };
    }
    // Per pixel of a 2-px lattice: its band (or -1), worked out once a view.
    function bandMap(W, H) {
        const m = new Int16Array(Math.ceil(W / 2) * Math.ceil(H / 2)).fill(-1);
        for (let y = 0, k = 0; y < H; y += 2)
            for (let x = 0; x < W; x += 2, k++) {
                if (x >= W - 1) continue;
                const g = groundAt(x, y);
                if (g && g.share > 0.92 && g.d < MAXD) m[k] = Math.floor(g.d);
            }
        return m;
    }
    function measure(map, W, H) {
        flush();
        const img = frameImage();
        const top = img.height - H;
        const bins = new Array(MAXD).fill(0).map(zero);
        const l = (q) => 0.2126 * img.data[q] + 0.7152 * img.data[q + 1] + 0.0722 * img.data[q + 2];
        for (let y = 0, k = 0; y < H; y += 2)
            for (let x = 0; x < W; x += 2, k++) {
                const band = map[k];
                if (band < 0) continue;
                const o = ((y + top) * img.width + x) * 4;
                const bn = bins[band];
                bn.n++; bn.r += img.data[o]; bn.g += img.data[o + 1]; bn.b += img.data[o + 2];
                bn.c += Math.abs(l(o) - l(o + 4));
            }
        return bins;
    }
    const OCTAVES = [[2, 4], [4, 8], [8, 16], [16, 32], [32, 64], [64, 100], [100, 150], [150, 200]];

    function bands() {
        const lab = pos(1) || 'meadowbands';
        const skies = (pos(2) || 'noon,golden').split(',');
        const herbs = opt('herbs') !== 'off';
        const W = innerWidth, H = innerHeight;
        const restore = plantsHidden();
        const range0 = GRASS_RANGE;
        const edges = [7, 20, 55, 150].map((e) => e * range0 / 150).concat(herbs ? [3 * HERB_RANGE] : []);
        // Eyes along the meadow's edge and from its far side back, looking
        // across it, each two ways.
        const views = [];
        const side = [-MEADOW_LOOK[1], MEADOW_LOOK[0]];
        for (const off of [-25, 0, 25])
            for (const back of [false, true])
                for (const turn of [-0.25, 0.2]) {
                    const along = back ? 165 : -5;
                    const p = meadowAt(along);
                    const eye = [p[0] + side[0] * off, 0, p[1] + side[1] * off];
                    eye[1] = groundHeight(eye[0], eye[2]) + 1.7;
                    const dir = back ? [-MEADOW_LOOK[0], -MEADOW_LOOK[1]] : MEADOW_LOOK;
                    const c = Math.cos(turn), s = Math.sin(turn);
                    const dx = dir[0] * c - dir[1] * s, dz = dir[0] * s + dir[1] * c;
                    // Looking a little down: the horizon high in the frame.
                    const look = [eye[0] + dx * 50, eye[1] - 50 * Math.tan(0.09), eye[2] + dz * 50];
                    views.push({ eye, look, way: [dx, dz] });
                }
        const out = { herbs, skies: {} };
        for (const time of skies) {
            setup('still', 'auto', time);
            const A = new Array(MAXD).fill(0).map(zero), B = new Array(MAXD).fill(0).map(zero);
            // The same split by the way the eye looks: the sun behind it or
            // ahead (the views look either way across the meadow).
            const half = { behind: new Array(MAXD).fill(0).map(zero), ahead: new Array(MAXD).fill(0).map(zero) };
            const sunDir = sky.sun.direction;   // from the sun
            views.forEach((v, i) => {
                holdView(v.eye, v.look);
                forest.grass.setGrass({ range: range0 });
                herbsAt(1, herbs);
                step(0.4);
                flush();
                const map = bandMap(W, H);
                const bins = measure(map, W, H);
                add(A, bins);
                add(v.way[0] * sunDir[0] + v.way[1] * sunDir[2] > 0 ? half.behind : half.ahead, bins);
                // The first view each way (the sun behind the eye, then ahead).
                if (i === 0 || i === 2) ctx.saveJpeg(`${OUT}/${lab}_${time}_view${i}.jpg`);
                forest.grass.setGrass({ range: range0 * S });
                herbsAt(S, herbs);
                step(0.4);
                add(B, measure(map, W, H));
            });
            forest.grass.setGrass({ range: range0 });
            herbsAt(1, true);
            const res = { octaves: [], edges: [] };
            const near = sum(A, 2, 4);
            console.log(`${time} (herbs ${herbs ? 'on' : 'off'}): the meadow by distance, against 2-4 m (${fmt(near)})`);
            for (const [a, b] of OCTAVES) {
                const q = sum(A, a, b);
                if (q.n < 200) continue;
                const r = { from: a, to: b, luma: lumaOf(q), sat: satOf(q), hue: hueOf(q),
                            rgb: ['r', 'g', 'b'].map((k) => q[k] / q.n), contrast: q.c / q.n,
                            lumaPct: 100 * (lumaOf(q) / lumaOf(near) - 1), satPct: 100 * (satOf(q) / satOf(near) - 1),
                            hueShift: hueOf(q) - hueOf(near) };
                // Each half against its own 2-4 m.
                for (const k of ['behind', 'ahead']) {
                    const h = sum(half[k], a, b), h0 = sum(half[k], 2, 4);
                    if (h.n < 100 || h0.n < 100) continue;
                    r[k] = { lumaPct: 100 * (lumaOf(h) / lumaOf(h0) - 1), satPct: 100 * (satOf(h) / satOf(h0) - 1), luma: lumaOf(h) };
                }
                res.octaves.push(r);
                const sp = (x) => `${x >= 0 ? '+' : ''}${x.toFixed(1)}%`;
                const halves = ['behind', 'ahead'].filter((k) => r[k]).map((k) => `sun ${k} ${sp(r[k].lumaPct)}/${sp(r[k].satPct)}`).join(', ');
                console.log(`  ${a}-${b} m: luma ${r.lumaPct >= 0 ? '+' : ''}${r.lumaPct.toFixed(1)}%, sat ` +
                            `${r.satPct >= 0 ? '+' : ''}${r.satPct.toFixed(1)}%, hue ${r.hueShift >= 0 ? '+' : ''}${r.hueShift.toFixed(1)} deg; ${halves}   (${fmt(q)})`);
            }
            for (const k of ['behind', 'ahead']) {
                const h0 = sum(half[k], 2, 4);
                if (h0.n >= 100) console.log(`  sun ${k}: 2-4 m ${fmt(h0)}`);
            }
            for (const e of edges) {
                const a = sum(A, e, S * e), b = sum(B, e, S * e);
                const ca = sum(A, 0.75 * e, e), cb = sum(B, 0.75 * e, e);
                if (a.n < 200 || ca.n < 200) continue;
                const r = { edge: e, lumaPct: 100 * (lumaOf(a) / lumaOf(b) - 1), satPct: 100 * (satOf(a) / satOf(b) - 1),
                            hueShift: hueOf(a) - hueOf(b), rgb: ['r', 'g', 'b'].map((k) => a[k] / a.n - b[k] / b.n),
                            contrastPct: 100 * ((a.c / a.n) / (b.c / b.n) - 1), controlLumaPct: 100 * (lumaOf(ca) / lumaOf(cb) - 1) };
                res.edges.push(r);
                console.log(`  edge ${e.toFixed(0)} m: outer vs inner over the same ground: luma ${r.lumaPct >= 0 ? '+' : ''}${r.lumaPct.toFixed(1)}%, ` +
                            `sat ${r.satPct >= 0 ? '+' : ''}${r.satPct.toFixed(1)}%, hue ${r.hueShift.toFixed(1)}, rgb ${r.rgb.map((x) => x.toFixed(1)).join(',')}, ` +
                            `contrast ${r.contrastPct >= 0 ? '+' : ''}${r.contrastPct.toFixed(1)}% (control ${r.controlLumaPct >= 0 ? '+' : ''}${r.controlLumaPct.toFixed(1)}%)`);
            }
            res.bands = A.map((q, i) => (q.n < 50 ? null : { d: i, luma: lumaOf(q), sat: satOf(q), hue: hueOf(q), contrast: q.c / q.n }));
            out.skies[time] = res;
        }
        restore();
        require('fs').writeFileSync(`${OUT}/${lab}_meadowbands.json`, JSON.stringify(out));
    }

    // Points well inside the meadow (a fixed scatter), where a view `d` m off
    // at its angle still has meadow under the eye's line.
    function tonePoints() {
        const pts = [];
        let s = 0x2545;
        const rnd = () => { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff; };
        while (pts.length < 14) {
            const a = rnd() * 6.2832, r = Math.sqrt(rnd()) * MEADOW.r * 0.55;
            const x = MEADOW.x + Math.cos(a) * r, z = MEADOW.z + Math.sin(a) * r;
            if (meadowShare(x, z) > 0.98) pts.push([x, z, rnd() * 6.2832]);
        }
        return pts;
    }
    function tone() {
        const lab = pos(1) || 'meadowtone';
        const skies = (pos(2) || 'noon,golden').split(',');
        const herbs = opt('herbs') !== 'off';
        const angle = (+opt('angle') || 8) * Math.PI / 180;
        const W = innerWidth, H = innerHeight;
        const restore = plantsHidden();
        const dists = [3, 10, 30, 60, 100, 150];
        const pts = tonePoints();
        const out = { herbs, angle: angle * 180 / Math.PI, skies: {} };
        // The middle of the frame: a box a fifth of its height, as wide.
        const bw = Math.round(H * 0.2), x0 = Math.round(W / 2 - bw / 2), y0 = Math.round(H / 2 - bw / 2);
        for (const time of skies) {
            setup('still', 'auto', time);
            herbsAt(1, herbs);
            const res = [];
            for (const d of dists) {
                const q = zero();
                pts.forEach(([x, z, yaw], i) => {
                    // Toward the sun's side and away alike: each point its own way.
                    const look = [x, groundHeight(x, z), z];
                    const eye = [x - Math.cos(yaw) * d * Math.cos(angle), look[1] + d * Math.sin(angle), z - Math.sin(yaw) * d * Math.cos(angle)];
                    eye[1] = Math.max(eye[1], groundHeight(eye[0], eye[2]) + 0.25);
                    holdView(eye, look);
                    step(0.3);
                    flush();
                    const img = frameImage();
                    const top = img.height - H;
                    const l = (o) => 0.2126 * img.data[o] + 0.7152 * img.data[o + 1] + 0.0722 * img.data[o + 2];
                    for (let y = y0; y < y0 + bw; y++)
                        for (let x2 = x0; x2 < x0 + bw; x2++) {
                            const o = ((y + top) * img.width + x2) * 4;
                            q.n++; q.r += img.data[o]; q.g += img.data[o + 1]; q.b += img.data[o + 2];
                            q.c += Math.abs(l(o) - l(o + 4));
                        }
                    if (i === 0) ctx.saveJpeg(`${OUT}/${lab}_${time}_${d}m.jpg`);
                });
                res.push({ d, q });
            }
            const q0 = res[0].q;
            console.log(`${time} (herbs ${herbs ? 'on' : 'off'}, ${(angle * 180 / Math.PI).toFixed(0)} deg): the same ground by distance, against 3 m (${fmt(q0)})`);
            out.skies[time] = res.map(({ d, q }) => {
                const r = { d, luma: lumaOf(q), sat: satOf(q), hue: hueOf(q), contrast: q.c / q.n,
                            lumaPct: 100 * (lumaOf(q) / lumaOf(q0) - 1), satPct: 100 * (satOf(q) / satOf(q0) - 1),
                            hueShift: hueOf(q) - hueOf(q0), contrastPct: 100 * ((q.c / q.n) / (q0.c / q0.n) - 1) };
                console.log(`  ${d} m: luma ${r.lumaPct >= 0 ? '+' : ''}${r.lumaPct.toFixed(1)}%, sat ${r.satPct >= 0 ? '+' : ''}${r.satPct.toFixed(1)}%, ` +
                            `hue ${r.hueShift >= 0 ? '+' : ''}${r.hueShift.toFixed(1)}, contrast ${r.contrastPct >= 0 ? '+' : ''}${r.contrastPct.toFixed(0)}%   (${fmt(q)})`);
                return r;
            });
        }
        restore();
        require('fs').writeFileSync(`${OUT}/${lab}_meadowtone.json`, JSON.stringify(out));
    }

    return { meadow: shots, meadowbands: bands, meadowtone: tone };
}
