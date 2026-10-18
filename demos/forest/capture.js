// Captures of the forest, made in headless bro (the clock is virtual: every
// frame is 1/30 s, so a capture is the same on any machine).
//
//   bro-headless --width 1280 --height 720 demos/forest demos/forest/capture.js -- \
//       still <shot[,shot...]> [label=forest] [wind=breeze] [tier=auto] [sky=golden]
//   bro-headless ... capture.js -- trace [label=forest] [wind=breeze] [budget]
//       GPU ms per frame along the whole flight: max, p95 and mean, a line a
//       second with the trees at each tier, and <label>_trace.json; `budget`
//       overrides the leaves' vertex budget (millions)
//   bro-headless ... capture.js -- video [label=forest] [wind=breeze] [fps=30]
//       the flight as <label>.webm
//   bro-headless ... capture.js -- handover <leaves|cards|clumps|crowns> [label=forest] [frames=12]
//       a dolly out from a tree through the distances where it hands over
//       from one tier to the next: <label>_handover_<which>_strip.png
//   bro-headless ... capture.js -- tiers <m[,m...]> [label=forest] [wind=still] [sky=golden] [part=...] [shadow=0]
//       the handover's subject alone at each distance, forced Leaves, By
//       size, forced Clumps and forced Crowns side by side, each with the
//       tree's mean luminance and cover: <label>_tiers_<part>.png (a value
//       and silhouette check across the tiers; shadow=0: it casts none)
//   bro-headless ... capture.js -- compare <shot[,shot...]> [label=forest] [wind=gusty] [sky=noon]
//       the forced Leaves tier beside By size, the middle half of each view:
//       <label>_<shot>_<sky>_compare.jpg
//   bro-headless ... capture.js -- meadow [label=meadow] [skies=noon,golden] [wind=breeze]
//       the meadow from its edge at 0.5, 3, 30, 60 and 150 m, and a view
//       under the trees: full-frame JPEGs <label>_meadow_<sky>_<d>m.jpg,
//       <label>_understory_<sky>.jpg
//   bro-headless ... capture.js -- metrics [shots=canopy,skim,glade,trunks] [label=forest] [skies=noon,golden] [wind=breeze]
//       Leaves against By size from the same views, per band of distance to
//       the crowns (10-20, 20-40, 40-80, 80-160 m): luminance, colour, local
//       contrast at three scales, hard edges, flat patches, blockiness; a
//       table per shot and <label>_metrics.json (see metrics() below)
//
// Any command also takes `lod={...}` (setForestLod's fields, JSON) to try a
// level of detail without a rebuild and `hide=grass,...` (forest.* nodes to
// hide, to take one part's cost out of a trace; `herbs` the grass's low
// plants); compare takes
// `crop=cx,cy,w` (fractions of the view; w 0.25 is a quarter blown up
// twice), trace `warm=<frames a second of the flight>` and `hold=<frames>`.
// With BRO_SCENE_GPU_PASSES=<ms> a trace logs each frame over <ms> pass by
// pass (bro/docs/headless.md).
//
// Everything goes to demos/forest/captures/.
//
// Several commands in one boot: join them with `+`, e.g.
//   capture.js -- still above,glade + handover clumps + compare trunks
// Each starts from the page as the boot left it (overlays gone, the level of
// detail and tier restored); the virtual clock runs on between them.
//
// The iteration loop (a boot is ~5 s, most of it the grass bake):
//   - the nursery is grown once and cached (world.grow's cache under
//     bro.app.cacheDir, keyed by the nursery and broflora's step source), so
//     only a change to the growth pays the ~5 s grow again;
//   - BRO_SCENE_SHADER_SOURCE=1 compiles bro's scene shaders from its source
//     tree at start-up, so a .glsl edit needs no rebuild
//     (bro/docs/hot-reload.md);
//   - chain the views you are judging into one run with `+`.

import { forest, setWind, setShot, sky, flight, flightAt, FLIGHT_SECONDS, vp, groundHeight, GRASS_RANGE,
         setTier, setLod, forestStats, HERBS, HERB_RANGE, meadowAt, MEADOW_LOOK, holdView, still } from "/app/forest.js";

const argv = (bro.app && bro.app.argv) || [];
// The command now running: its mode and arguments (see run() at the end).
let args = [], mode = 'still', a1, a2, a3, a4;
const OUT = bro.resolvePath('/app/captures').replace(/\\/g, '/');

document.body.classList.add('clean');
flush();

const fps = 30;
function step(seconds) {
    const n = Math.max(1, Math.round(seconds * fps));
    for (let i = 0; i < n; i++) advanceTime(1000 / fps);
}

// The command's `key=value` argument, if any.
const opt = (key) => {
    const a = args.find((s) => typeof s === 'string' && s.startsWith(key + '='));
    return a ? a.slice(key.length + 1) : undefined;
};

function setup(wind, tier, time) {
    setWind(wind || 'breeze');
    sky.apply(time || 'golden');
    setTier(tier || 'auto');
    if (opt('lod')) setLod(JSON.parse(opt('lod')));
    // A forest.* node, or a part of the forest by name (needle, shrub, ...).
    for (const k of (opt('hide') || '').split(',').filter(Boolean)) {
        // `herbs`: the grass's low plants (and the blades and turf that stand in for them).
        if (k === 'herbs') { forest.grass.setHerbs({ species: [] }); continue; }
        const part = forest.parts.find((p) => p.name === k);
        (part ? part.node : forest[k]).visible = false;
    }
}

function stills() {
    const label = a2 || 'forest';
    setup(a3, a4, args[5]);
    for (const s of (a1 || 'above').split(',')) {
        let name = s;
        if (s[0] === '@') {
            // A view of its own: @x/h/z/lookx/lookh/lookz (h over the ground).
            const [ex, eh, ez, lx, lh, lz] = s.slice(1).split('/').map(Number);
            flight.on = false;
            vp.onView((view) => {
                if (flight.on) return;
                view.position = [ex, groundHeight(ex, ez) + eh, ez];
                view.target = [lx, groundHeight(lx, lz) + lh, lz];
                view.up = [0, 1, 0];
            });
            name = 'at' + s.slice(1).replace(/\//g, '_');
        } else {
            setShot(s);
        }
        step(1.5);
        flush();
        const file = `${OUT}/${label}_${name}.png`;
        screenshot(file);
        console.log(`${file}: ${JSON.stringify(forestStats())}`);
    }
}

const pct = (sorted, p) => sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))];

function trace() {
    const label = a1 || 'forest';
    setup(a2);
    if (a3) setLod({ budget: +a3 });
    // Warm: one pass over the flight at a frame a second (warm= frames a
    // visit), so pipelines and the shadow atlas exist before anything is
    // timed; then the first view, rendered until ten seconds of wall time
    // have passed since the trace began (hold= frames at the least). On this
    // Windows/NVIDIA box the fragment-heavy forest draws run 3 to 10 times
    // slower in a staircase starting about 8 s after the device comes up,
    // whatever is drawn (the same in the build before this one, and gone
    // when the GPU has been busy past it): driver or OS side, not the
    // frame's, so the timed flight starts after it.
    const warmFrom = perf.now();
    flight.on = true;
    flight.speed = 0;
    for (let t = 0; t <= FLIGHT_SECONDS; t += 1) {
        flight.t = t;
        for (let k = 0; k < (+opt('warm') || 1); k++) { advanceTime(1000 / fps); flush(); }
    }
    flight.t = 0;
    for (let i = 0; i < (+opt('hold') || 10) || perf.now() - warmFrom < 10000; i++) { advanceTime(1000 / fps); flush(); }
    perf.gpuFrameMs();
    flight.speed = 1;
    const frames = [];
    const n = Math.round(FLIGHT_SECONDS * fps);
    for (let i = 0; i <= n; i++) {
        flight.t = i / fps;
        const c0 = perf.now();
        advanceTime(1000 / fps);
        flush();
        const cpu = perf.now() - c0;
        const ms = perf.gpuFrameMs();
        const s = forestStats();
        frames.push({ t: +(i / fps).toFixed(3), ms, cpu: +cpu.toFixed(2), eye: flightAt(i / fps).eye.map((v) => +v.toFixed(1)),
                      trees: [s.trees.leaves, s.trees.clumps, s.trees.crowns], culled: s.culled,
                      vertices: s.vertices, shadowVertices: s.shadowVertices, draws: s.draws });
    }
    const ms = frames.map((f) => f.ms).sort((a, b) => a - b);
    const mean = ms.reduce((a, b) => a + b, 0) / ms.length;
    for (let sec = 0; sec <= FLIGHT_SECONDS; sec++) {
        const fr = frames.filter((f) => f.t >= sec && f.t < sec + 1);
        if (!fr.length) continue;
        const worst = fr.reduce((a, b) => (b.ms > a.ms ? b : a));
        console.log(`t=${String(sec).padStart(2)}s  eye y ${worst.eye[1].toFixed(0).padStart(4)}  ` +
                    `max ${worst.ms.toFixed(2)} ms  trees L/C/R ${worst.trees.join('/')}  ` +
                    `${(worst.vertices / 1e6).toFixed(1)} M verts, ${(worst.shadowVertices / 1e6).toFixed(1)} M shadow, ${worst.draws} draws`);
    }
    const summary = { frames: frames.length, max: ms[ms.length - 1], p95: pct(ms, 0.95), p50: pct(ms, 0.5), mean,
                      width: innerWidth, height: innerHeight, trees: forestStats().treeCount };
    console.log(`flight GPU ms: max ${summary.max.toFixed(2)}, p95 ${summary.p95.toFixed(2)}, ` +
                `median ${summary.p50.toFixed(2)}, mean ${mean.toFixed(2)} over ${frames.length} frames`);
    const file = `${OUT}/${label}_trace.json`;
    require('fs').writeFileSync(file, JSON.stringify({ summary, frames }, null, 1));
    console.log(file);
}

function video() {
    const label = a1 || 'forest';
    setup(a2);
    const vfps = +(a3 || 30);
    fly(0);
    flight.speed = 0;
    step(1);
    const file = `${OUT}/${label}.webm`;
    const vp0 = frameImage();
    const enc = new VideoEncoder({ path: file, width: vp0.width, height: vp0.height, fps: vfps, quality: 'good' });
    const n = Math.round(FLIGHT_SECONDS * vfps);
    const t0 = perf.now();
    for (let i = 0; i <= n; i++) {
        flight.t = i / vfps;
        advanceTime(1000 / vfps);
        flush();
        enc.addViewportFrame();
    }
    enc.finish();
    console.log(`${file}: ${n + 1} frames in ${((perf.now() - t0) / 1000).toFixed(1)} s ${enc.lastError || ''}`);
}
function fly(t) { flight.on = true; flight.t = t; flight.speed = 1; }

// Box-downsample a crop (centre cx, cy in 0..1 of the view, width cw as a
// fraction) of frame `g` into tw x th RGBA.
function shrink(g, tw, th, crop) {
    const [cx, cy, cw] = crop;
    const top = Math.max(0, g.height - innerHeight), H = g.height - top;
    const sw = g.width * cw, sh = sw * th / tw;
    const x0 = cx * g.width - sw / 2, y0 = top + cy * H - sh / 2;
    const out = new Uint8ClampedArray(tw * th * 4);
    const k = Math.max(1, Math.min(4, Math.floor(sw / tw)));
    for (let y = 0; y < th; y++) for (let x = 0; x < tw; x++) {
        let r = 0, gg = 0, b = 0, n = 0;
        for (let j = 0; j < k; j++) for (let i = 0; i < k; i++) {
            const sx = Math.floor(x0 + (x + (i + 0.5) / k) * sw / tw), sy = Math.floor(y0 + (y + (j + 0.5) / k) * sh / th);
            if (sx < 0 || sy < 0 || sx >= g.width || sy >= g.height) continue;
            const o = (sy * g.width + sx) * 4;
            r += g.data[o]; gg += g.data[o + 1]; b += g.data[o + 2]; n++;
        }
        const o = (y * tw + x) * 4;
        out[o] = r / (n || 1); out[o + 1] = gg / (n || 1); out[o + 2] = b / (n || 1); out[o + 3] = 255;
    }
    return out;
}

// The tree the handover strips dolly from, seen across the glade (of
// forest.parts' `part=<name>`, the broadleaves by default): of the part's
// 40 trees nearest the glade's far edge, the one standing clearest of the
// others of every part (a needle tree among broadleaves was hidden behind
// them).
function subject() {
    const part = forest.parts.find((p) => p.name === opt('part')) || forest.parts[0];
    const inst = part.trees, spec = part.emit.specimens;
    const near = [];
    for (let i = 0; i < inst.length / 8; i++) near.push([Math.hypot(inst[i * 8] - 40, inst[i * 8 + 2] - 30), i]);
    near.sort((a, b) => a[0] - b[0]);
    let best = near[0][1], bestClear = -1;
    for (const [d, i] of near.slice(0, 40)) {
        let clear = Infinity;
        for (const p of forest.parts) {
            const t = p.trees;
            for (let j = 0; j < t.length / 8; j++) {
                if (p === part && j === i) continue;
                const c = Math.hypot(t[j * 8] - inst[i * 8], t[j * 8 + 2] - inst[i * 8 + 2]);
                if (c < clear) clear = c;
            }
        }
        // Clear, and not far from the spot.
        const score = Math.min(clear, 12) - 0.05 * d;
        if (score > bestClear) { bestClear = score; best = i; }
    }
    const s = inst[best * 8 + 5] | 0, sc = inst[best * 8 + 3];
    const h = spec[s * 16 + 6] * sc;
    return { index: best, specimen: s, scale: sc, node: part.node, part: part.name, height: h,
             top: [inst[best * 8], inst[best * 8 + 1] + h * 0.6, inst[best * 8 + 2]] };
}

// The view's pixels per metre at distance d (the forest node's measure).
const pxPerMetre = (d) => (innerHeight / 2) / Math.tan(vp.cam.fov * Math.PI / 360) / d;

// The distance at which the subject's lod crosses `f(lod)` = true, by bisection.
function distanceWhere(sub, f) {
    let lo = 1, hi = 3000;
    for (let i = 0; i < 40; i++) {
        const mid = Math.sqrt(lo * hi);
        if (f(sub.node.forestTreeLod(sub.specimen, pxPerMetre(mid) * sub.scale))) hi = mid; else lo = mid;
    }
    return hi;
}

const HANDOVERS = {
    leaves: (l) => l.widening > 1.05,      // full leaves start thinning
    cards: (l) => l.card,                  // the leaves turn to cards
    clumps: (l) => l.leaves < 0.5,         // half way to clumps (the clumps' own share falls again past the crowns)
    crowns: (l) => l.crowns > 0.5,         // half way to crowns
};

function handover() {
    const which = a1 || 'clumps', label = a2 || 'forest', frames = +(a3 || 12);
    setup('breeze');
    flight.on = false;
    const sub = subject();
    // Another part's subject is judged alone: the parts in front of it
    // (broadleaves before a conifer) are hidden for the strip.
    const hidden = opt('part') ? forest.parts.filter((p) => p.name !== sub.part && p.node.visible) : [];
    for (const p of hidden) p.node.visible = false;
    const dMid = distanceWhere(sub, HANDOVERS[which]);
    const d0 = dMid / 1.35, d1 = dMid * 1.35;
    console.log(`handover ${which}: tree ${sub.index} (specimen ${sub.specimen}, scale ${sub.scale.toFixed(2)}) at ${dMid.toFixed(1)} m; ` +
                `dolly ${d0.toFixed(1)} .. ${d1.toFixed(1)} m`);
    const yaw = Math.atan2(40 - 12, 30 - 18) + Math.PI, pitch = -0.32;
    const W = innerWidth, H = innerHeight;
    const cols = 4, rows = Math.ceil(frames / cols), gap = 4;
    const tw = Math.floor((W - gap * (cols + 1)) / cols);
    const th = Math.floor(Math.min(tw * 9 / 16, (H - gap * (rows + 1)) / rows));
    const grabs = [];
    for (let i = 0; i < frames; i++) {
        const d = d0 * Math.pow(d1 / d0, i / Math.max(1, frames - 1));
        vp.reframe(sub.top, d, { yaw, pitch });
        for (let k = 0; k < 3; k++) { advanceTime(1000 / fps); flush(); }
        const l = sub.node.forestTreeLod(sub.specimen, pxPerMetre(d) * sub.scale);
        // A crop that holds about the tree's crown at the middle distance.
        const cw = Math.min(1, Math.max(0.12, 14 * pxPerMetre(dMid) * sub.scale / W));
        grabs.push({ d, l, px: shrink(frameImage(), tw, th, [0.5, 0.5, cw]) });
    }
    const cv = document.createElement('canvas');
    cv.width = W; cv.height = H;
    cv.style.cssText = `position:absolute;left:0;top:0;width:${W}px;height:${H}px;z-index:10`;
    document.body.append(cv);
    const g = cv.getContext('2d');
    g.fillStyle = '#111';
    g.fillRect(0, 0, W, H);
    g.font = '600 13px system-ui';
    grabs.forEach((s, i) => {
        const x = gap + (i % cols) * (tw + gap), y = gap + Math.floor(i / cols) * (th + gap);
        const im = g.createImageData(tw, th);
        im.data.set(s.px);
        g.putImageData(im, x, y);
        const txt = `${which} ${s.d.toFixed(0)} m  w ${s.l.widening.toFixed(1)}${s.l.card ? ' card' : ''}  ` +
                    `L ${s.l.leaves.toFixed(2)} C ${s.l.clumps.toFixed(2)} R ${s.l.crowns.toFixed(2)}`;
        g.fillStyle = '#000'; g.fillText(txt, x + 6, y + 17);
        g.fillStyle = '#fff'; g.fillText(txt, x + 5, y + 16);
    });
    advanceTime(30);
    flush();
    const file = `${OUT}/${label}_handover_${which}${sub.part === 'broadleaf' ? '' : '_' + sub.part}_strip.png`;
    screenshot(file);
    console.log(file);
    for (const p of hidden) p.node.visible = true;
}

// One tree of a part (`part=`, as the handover's subject, its part alone)
// at each distance (m, comma separated), a row a distance: forced Leaves,
// By size, forced Clumps, forced Crowns. Each pane is labelled with the
// tree's mean luminance and its cover (the pixels it changes against the
// view with its part hidden): <label>_tiers_<part>.png, the values for a
// silhouette and value check across the tiers.
function tiers() {
    const ds = (a1 || '15,30,60,120').split(',').map(Number), label = a2 || 'forest';
    setup(a3 || 'still', 'auto', a4 || 'golden');
    flight.on = false;
    const sub = subject();
    const hidden = forest.parts.filter((p) => p.name !== sub.part && p.node.visible);
    for (const p of hidden) p.node.visible = false;
    // The subject alone in its node, so the cover is its own.
    const part = forest.parts.find((p) => p.name === sub.part);
    sub.node.setTrees(part.trees.slice(sub.index * 8, sub.index * 8 + 8));
    if (opt('shadow') === '0') sub.node.castsShadow = false;
    const yaw = Math.atan2(40 - 12, 30 - 18) + Math.PI, pitch = -0.12;
    const W = innerWidth, H = innerHeight;
    const names = ['leaves', 'auto', 'clumps', 'crowns'];
    const cols = names.length, rows = ds.length, gap = 4;
    const tw = Math.floor((W - gap * (cols + 1)) / cols);
    const th = Math.floor(Math.min(tw * 9 / 16, (H - gap * (rows + 1)) / rows));
    const grab = () => { for (let k = 0; k < 3; k++) { advanceTime(1000 / fps); flush(); } return frameImage(); };
    const panes = [];
    for (const d of ds) {
        vp.reframe(sub.top, d, { yaw, pitch });
        sub.node.visible = false;
        const bg = grab();
        sub.node.visible = true;
        const cw = Math.min(1, Math.max(0.1, 1.6 * sub.height * pxPerMetre(d) / W));
        const bgPx = shrink(bg, tw, th, [0.5, 0.5, cw]);
        for (const n of names) {
            sub.node.setForestTier(n);
            const px = shrink(grab(), tw, th, [0.5, 0.5, cw]);
            let sum = 0, cover = 0;
            for (let i = 0; i < tw * th; i++) {
                const o = i * 4;
                const dl = Math.abs(px[o] - bgPx[o]) + Math.abs(px[o + 1] - bgPx[o + 1]) + Math.abs(px[o + 2] - bgPx[o + 2]);
                if (dl < 12) continue;
                cover++;
                sum += 0.2126 * px[o] + 0.7152 * px[o + 1] + 0.0722 * px[o + 2];
            }
            const Y = cover ? sum / cover : 0;
            panes.push({ px, txt: `${n} ${d} m  Y ${Y.toFixed(1)}  cover ${(100 * cover / (tw * th)).toFixed(1)}%` });
            const st = sub.node.forestStats();
            console.log(`tiers ${sub.part} ${d} m ${n}: Y ${Y.toFixed(1)} cover ${(100 * cover / (tw * th)).toFixed(1)}% ` +
                        `(leaves ${st.leaves}, entries ${st.entries}, shadowV ${st.shadowVertices}, detail ${st.detail.toFixed(2)}) ` +
                        JSON.stringify(sub.node.forestTreeLod(sub.specimen, pxPerMetre(d) * sub.scale)));
        }
        sub.node.setForestTier('auto');
    }
    const cv = document.createElement('canvas');
    cv.width = W; cv.height = H;
    cv.style.cssText = `position:absolute;left:0;top:0;width:${W}px;height:${H}px;z-index:10`;
    document.body.append(cv);
    const g = cv.getContext('2d');
    g.fillStyle = '#111';
    g.fillRect(0, 0, W, H);
    g.font = '600 13px system-ui';
    panes.forEach((s, i) => {
        const x = gap + (i % cols) * (tw + gap), y = gap + Math.floor(i / cols) * (th + gap);
        const im = g.createImageData(tw, th);
        im.data.set(s.px);
        g.putImageData(im, x, y);
        g.fillStyle = '#000'; g.fillText(s.txt, x + 6, y + 17);
        g.fillStyle = '#fff'; g.fillText(s.txt, x + 5, y + 16);
    });
    advanceTime(30);
    flush();
    const file = `${OUT}/${label}_tiers_${sub.part}.png`;
    screenshot(file);
    console.log(file);
    for (const p of hidden) p.node.visible = true;
    sub.node.setTrees(part.trees);
}

// Side by side at each shot: the forced "Leaves" tier on the left, "By size"
// on the right, the middle half of each view at full resolution, a frame
// apart. <label>_<shot>_<sky>_compare.jpg.
function compare() {
    const label = a2 || 'forest', time = a4 || 'noon';
    setup(a3 || 'gusty', 'auto', time);
    const W = innerWidth, H = innerHeight, half = Math.floor(W / 2);
    const cv = document.createElement('canvas');
    cv.width = W; cv.height = H;
    cv.style.cssText = `position:absolute;left:0;top:0;width:${W}px;height:${H}px;z-index:10;display:none`;
    document.body.append(cv);
    const g = cv.getContext('2d');
    g.font = '600 14px system-ui';
    for (const s of (a1 || 'above').split(',')) {
        setShot(s);
        cv.style.display = 'none';
        setTier('auto');
        step(1.5);
        flush();
        const panes = [];
        for (const tier of ['leaves', 'auto']) {
            setTier(tier);
            for (let k = 0; k < 2; k++) { advanceTime(1000 / fps); flush(); }
            panes.push(shrink(frameImage(), half, H, opt('crop') ? opt('crop').split(',').map(Number) : [0.5, 0.5, half / W]));
        }
        setTier('auto');
        cv.style.display = 'block';
        panes.forEach((px, i) => {
            const im = g.createImageData(half, H);
            im.data.set(px);
            g.putImageData(im, i * half, 0);
            const txt = i ? 'By size' : 'Leaves';
            g.fillStyle = '#000'; g.fillText(txt, i * half + 9, 21);
            g.fillStyle = '#fff'; g.fillText(txt, i * half + 8, 20);
        });
        g.fillStyle = '#111';
        g.fillRect(half - 1, 0, 2, H);
        advanceTime(30);
        flush();
        // JPEG at quality 95 (about 1.4 MB): a PNG of this (about 6 MB) is
        // over the image viewer's limit, and its re-encode bands the sky.
        const file = `${OUT}/${label}_${s}_${time}_compare.jpg`;
        const g2 = frameImage();
        const top = Math.max(0, g2.height - innerHeight);
        const px = new Uint8Array(g2.data.buffer, g2.data.byteOffset + top * g2.width * 4, (g2.height - top) * g2.width * 4);
        bro.image.encodeJpegFile(file, px, g2.width, g2.height - top, 4, 95);
        console.log(file);
    }
}

// GPU ms at flight times (comma separated, s): the whole frame, then without
// the grass, without the trees, and without both, so each part's cost is the
// difference.
function parts() {
    setup(a2);
    flight.on = true;
    flight.speed = 0;
    const show = (g, t) => { forest.grass.visible = g; for (const p of forest.parts) p.node.visible = t; };
    const cases = { all: [true, true], noGrass: [false, true], noTrees: [true, false], bare: [false, false] };
    for (const t of (a1 || '0,7.5,15,22,30').split(',').map(Number)) {
        flight.t = t;
        const ms = {};
        for (const [k, c] of Object.entries(cases)) {
            show(...c);
            for (let i = 0; i < 8; i++) { advanceTime(1000 / fps); flush(); }
            perf.gpuFrameMs();
            let sum = 0;
            for (let i = 0; i < 30; i++) { advanceTime(1000 / fps); flush(); sum += perf.gpuFrameMs(); }
            ms[k] = sum / 30;
        }
        show(true, true);
        const st = forest.grass.grassStats();
        console.log(`t=${t}: ${ms.all.toFixed(2)} ms; grass ${(ms.all - ms.noGrass).toFixed(2)}, trees ${(ms.all - ms.noTrees).toFixed(2)}, ` +
                    `rest ${ms.bare.toFixed(2)}; grass instances ${st.instances.join(' / ')}`);
    }
}

// GPU ms held at flight times (comma separated, s; default the canopy dive's
// worst, 11 and 12): after the trace's ten-second warm, the mean over 60
// frames at each, for a quick A/B of one view's cost (with
// BRO_SCENE_GPU_PASSES set, its passes too).
function hold() {
    setup(a2);
    flight.on = true;
    flight.speed = 0;
    const times = (a1 || '11,12').split(',').map(Number);
    const warmFrom = perf.now();
    flight.t = times[0];
    while (perf.now() - warmFrom < 10000) { advanceTime(1000 / fps); flush(); }
    for (const t of times) {
        flight.t = t;
        for (let i = 0; i < 10; i++) { advanceTime(1000 / fps); flush(); }
        perf.gpuFrameMs();
        const ms = [];
        for (let i = 0; i < 60; i++) { advanceTime(1000 / fps); flush(); ms.push(perf.gpuFrameMs()); }
        ms.sort((a, b) => a - b);
        console.log(`hold t=${t}: mean ${(ms.reduce((a, b) => a + b, 0) / ms.length).toFixed(2)} ms, ` +
                    `median ${ms[30].toFixed(2)}, max ${ms[59].toFixed(2)}`);
    }
}

// --- metrics: Leaves against By size, by distance --------------------------------
//
// Each shot is drawn twice from the same view, the forced Leaves tier and By
// size, and every pixel a crown covers is given the distance along its ray to
// the nearest crown (each tree's crown as the upright ellipsoid round its
// clumps, ray-cast on the CPU; the same mask for both frames). Per band of
// distance, each frame's:
//   Y         mean luminance (Rec. 709 weights on the sRGB values, 0..255),
//             and the mean r g b (drgb: the distance between the frames')
//   d1 d3 d9  local contrast at three scales: the rms of luminance less its
//             1 px box blur, of the 1 px blur less the 3 px, and of the 3 px
//             less the 9 px, so leaf sparkle, leaf clusters and crown masses
//             are told apart
//   hard      % of pixels with a luminance step over 40 to a neighbour
//   flat      % of pixels whose 3 x 3 neighbourhood spans under 4 levels:
//             posterised, painted patches
//   block     the luminance's second difference at a 2 px lag over that at
//             1 px (about 1 for fine noise; it rises as the picture is made of
//             magnified texels or big flat pieces)
// Each shot also measures its ground (groundStats, below).
// `bands` among the arguments also writes <label>_<shot>_<sky>_bands.png, the
// By size frame tinted by band (10-20 red, 20-40 yellow, 40-80 green, 80-160
// blue), to check the mask.

const BANDS = [[10, 20], [20, 40], [40, 80], [80, 160]];

// Every part's crowns (broadleaves, conifers, shrubs) into one mask.
// The view's eye and look-at point: the flight's, or a held view's.
const viewNow = () => (still.view && !flight.on ? still.view : flightAt(flight.t));

function crownDepth(W, H) {
    const depth = new Float32Array(W * H);
    for (const p of forest.parts) partDepth(W, H, p.trees, p.emit, depth);
    return depth;
}

function partDepth(W, H, inst, em, depth) {
    const spec = em.specimens, clumps = em.clumps;
    const { eye, look } = viewNow();
    const crowns = [];
    for (let s = 0; s < em.specimenCount; s++) {
        const c0 = spec[s * 16 + 2], cn = spec[s * 16 + 3];
        const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
        for (let c = c0; c < c0 + cn; c++) for (let k = 0; k < 3; k++) {
            lo[k] = Math.min(lo[k], clumps[c * 8 + k] - clumps[c * 8 + 3]);
            hi[k] = Math.max(hi[k], clumps[c * 8 + k] + clumps[c * 8 + 3]);
        }
        crowns.push(cn ? { c: lo.map((v, k) => (v + hi[k]) / 2), a: Math.max(hi[0] - lo[0], hi[2] - lo[2]) / 2,
                           b: (hi[1] - lo[1]) / 2 } : null);
    }
    const norm = (v) => { const l = Math.hypot(v[0], v[1], v[2]); return [v[0] / l, v[1] / l, v[2] / l]; };
    const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
    const fw = norm([look[0] - eye[0], look[1] - eye[1], look[2] - eye[2]]);
    const rt = norm(cross(fw, [0, 1, 0])), up = cross(rt, fw);
    const ty = Math.tan(vp.cam.fov * Math.PI / 360), tx = ty * W / H;
    const ppm = (H / 2) / ty;
    for (let i = 0; i < inst.length / 8; i++) {
        const o = i * 8, cr = crowns[inst[o + 5] | 0];
        if (!cr) continue;
        const sc = inst[o + 3], yaw = inst[o + 4], co = Math.cos(yaw), sn = Math.sin(yaw);
        const C = [inst[o] + sc * (cr.c[0] * co + cr.c[2] * sn), inst[o + 1] + sc * cr.c[1],
                   inst[o + 2] + sc * (-cr.c[0] * sn + cr.c[2] * co)];
        const a = cr.a * sc, b = cr.b * sc, R = Math.max(a, b);
        const rel = [C[0] - eye[0], C[1] - eye[1], C[2] - eye[2]];
        const z = rel[0] * fw[0] + rel[1] * fw[1] + rel[2] * fw[2];
        if (z < -R) continue;
        let x0 = 0, x1 = W - 1, y0 = 0, y1 = H - 1;
        if (z > 2 * R) {
            const sx = (rel[0] * rt[0] + rel[1] * rt[1] + rel[2] * rt[2]) / z, sy = (rel[0] * up[0] + rel[1] * up[1] + rel[2] * up[2]) / z;
            const px = W / 2 + sx * ppm, py = H / 2 - sy * ppm, pr = R * ppm / (z - R) + 2;
            x0 = Math.max(0, Math.floor(px - pr)); x1 = Math.min(W - 1, Math.ceil(px + pr));
            y0 = Math.max(0, Math.floor(py - pr)); y1 = Math.min(H - 1, Math.ceil(py + pr));
            if (x0 > x1 || y0 > y1) continue;
        }
        // In the ellipsoid's unit-sphere space.
        const ox = -rel[0] / a, oy = -rel[1] / b, oz = -rel[2] / a;
        const cc = ox * ox + oy * oy + oz * oz - 1;
        for (let y = y0; y <= y1; y++) {
            const v = (1 - 2 * (y + 0.5) / H) * ty;
            for (let x = x0; x <= x1; x++) {
                const u = (2 * (x + 0.5) / W - 1) * tx;
                let dx = fw[0] + rt[0] * u + up[0] * v, dy = fw[1] + rt[1] * u + up[1] * v, dz = fw[2] + rt[2] * u + up[2] * v;
                const l = Math.hypot(dx, dy, dz);
                dx /= l; dy /= l; dz /= l;
                const qx = dx / a, qy = dy / b, qz = dz / a;
                const A = qx * qx + qy * qy + qz * qz, B = ox * qx + oy * qy + oz * qz;
                const disc = B * B - A * cc;
                if (disc < 0) continue;
                const t = (-B - Math.sqrt(disc)) / A;
                if (t < 0.5) continue;   // inside a crown: not a view of it
                const k = y * W + x;
                if (depth[k] !== 0 && t >= depth[k]) continue;
                if (eye[1] + dy * t < groundHeight(eye[0] + dx * t, eye[2] + dz * t) - 0.5) continue;
                depth[k] = t;
            }
        }
    }
}

// Luminance and colour of frame `g` (the view's rows, past any band above).
function lumaOf(g, W, H) {
    const top = Math.max(0, g.height - H);
    const Y = new Float32Array(W * H), rgb = new Float32Array(W * H * 3);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
        const o = ((y + top) * g.width + x) * 4, k = y * W + x;
        const r = g.data[o], gg = g.data[o + 1], b = g.data[o + 2];
        Y[k] = 0.2126 * r + 0.7152 * gg + 0.0722 * b;
        rgb[k * 3] = r; rgb[k * 3 + 1] = gg; rgb[k * 3 + 2] = b;
    }
    return { Y, rgb };
}

// A separable box blur of radius r.
function boxBlur(src, W, H, r) {
    const tmp = new Float32Array(W * H), out = new Float32Array(W * H);
    for (let y = 0; y < H; y++) {
        let acc = 0, n = 0;
        for (let x = -r; x < W + r; x++) {
            if (x + r < W && x + r >= 0) { acc += src[y * W + x + r]; n++; }
            if (x - r - 1 >= 0 && x - r - 1 < W) { acc -= src[y * W + x - r - 1]; n--; }
            if (x >= 0 && x < W) tmp[y * W + x] = acc / n;
        }
    }
    for (let x = 0; x < W; x++) {
        let acc = 0, n = 0;
        for (let y = -r; y < H + r; y++) {
            if (y + r < H && y + r >= 0) { acc += tmp[(y + r) * W + x]; n++; }
            if (y - r - 1 >= 0 && y - r - 1 < H) { acc -= tmp[(y - r - 1) * W + x]; n--; }
            if (y >= 0 && y < H) out[y * W + x] = acc / n;
        }
    }
    return out;
}

function bandStats(img, depth, W, H, bands = BANDS) {
    const { Y, rgb } = img;
    const b1 = boxBlur(Y, W, H, 1), b3 = boxBlur(Y, W, H, 3), b9 = boxBlur(Y, W, H, 9);
    // One pass, each pixel into its band's sums.
    const acc = bands.map(() => new Float64Array(13));
    for (let y = 2; y < H - 2; y++) for (let x = 2; x < W - 2; x++) {
        const k = y * W + x, d = depth[k];
        if (!(d >= bands[0][0] && d < bands[bands.length - 1][1])) continue;
        let bi = 0;
        while (d >= bands[bi][1]) bi++;
        const A = acc[bi];
        A[0]++;
        A[1] += Y[k]; A[2] += rgb[k * 3]; A[3] += rgb[k * 3 + 1]; A[4] += rgb[k * 3 + 2];
        const e1 = Y[k] - b1[k], e3 = b1[k] - b3[k], e9 = b3[k] - b9[k];
        A[5] += e1 * e1; A[6] += e3 * e3; A[7] += e9 * e9;
        if (Math.max(Math.abs(Y[k + 1] - Y[k]), Math.abs(Y[k + W] - Y[k])) > 40) A[8]++;
        let mn = 255, mx = 0;
        for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) {
            const v = Y[k + j * W + i];
            if (v < mn) mn = v;
            if (v > mx) mx = v;
        }
        if (mx - mn < 4) A[9]++;
        const a1 = Y[k + 1] - 2 * Y[k] + Y[k - 1], c1 = Y[k + W] - 2 * Y[k] + Y[k - W];
        const a2 = Y[k + 2] - 2 * Y[k] + Y[k - 2], c2 = Y[k + 2 * W] - 2 * Y[k] + Y[k - 2 * W];
        A[10] += a1 * a1 + c1 * c1;
        A[11] += a2 * a2 + c2 * c2;
    }
    return bands.map(([lo, hi], bi) => {
        const [n, sY, sr, sg, sb, s1, s3, s9, hard, flat, l1, l2] = acc[bi];
        if (n < 200) return null;
        const f = (v) => +v.toFixed(2);
        return { band: `${lo}-${hi}`, px: n, Y: f(sY / n), rgb: [f(sr / n), f(sg / n), f(sb / n)],
                 d1: f(Math.sqrt(s1 / n)), d3: f(Math.sqrt(s3 / n)), d9: f(Math.sqrt(s9 / n)),
                 hard: f(100 * hard / n), flat: f(100 * flat / n), block: f(Math.sqrt(l2 / Math.max(l1, 1e-6))) };
    });
}

// The ground, measured the same way in the By size frame: its pixels (the
// terrain's ray hits, ray-marched on the CPU through groundHeight, less any
// the crown mask covers) in bands that are the grass's rings (7, 20, 55 and
// 150 m at a range of 150, scaled with it; past the last only the turf), each
// band's Y, rgb and d1 d3 d9 (whether the turf keeps texture with distance),
// and at each ring's edge the step in mean colour from the 15% inside it to
// the 15% outside, beside the same step 1.3 times nearer and further (a band
// at the boundary shows as a step well over those: seam dY / drgb (around)).
const RING_EDGES = [7, 20, 55, 150];

function groundDepth(W, H, crowns) {
    const { eye, look } = viewNow();
    const norm = (v) => { const l = Math.hypot(v[0], v[1], v[2]); return [v[0] / l, v[1] / l, v[2] / l]; };
    const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
    const fw = norm([look[0] - eye[0], look[1] - eye[1], look[2] - eye[2]]);
    const rt = norm(cross(fw, [0, 1, 0])), up = cross(rt, fw);
    const ty = Math.tan(vp.cam.fov * Math.PI / 360), tx = ty * W / H;
    const depth = new Float32Array(W * H);
    // groundHeight stays inside +-12 m: march only that slab, in steps of 3%
    // of the distance, then bisect the crossing.
    const SLAB = 12, FAR_T = 400;
    for (let y = 0; y < H; y++) {
        const v = (1 - 2 * (y + 0.5) / H) * ty;
        for (let x = 0; x < W; x++) {
            if (crowns[y * W + x] > 0) continue;
            const u = (2 * (x + 0.5) / W - 1) * tx;
            const d = norm([fw[0] + rt[0] * u + up[0] * v, fw[1] + rt[1] * u + up[1] * v, fw[2] + rt[2] * u + up[2] * v]);
            let t = 0.05;
            if (eye[1] > SLAB) { if (d[1] >= 0) continue; t = (eye[1] - SLAB) / -d[1]; }
            const above = (s) => eye[1] + d[1] * s - groundHeight(eye[0] + d[0] * s, eye[2] + d[2] * s);
            if (above(t) < 0) continue;
            while (t < FAR_T) {
                if (eye[1] + d[1] * t < -SLAB) break;
                const t2 = t + Math.max(0.03 * t, 0.05);
                if (above(t2) < 0) {
                    let a = t, b = t2;
                    for (let i = 0; i < 6; i++) { const m = (a + b) / 2; if (above(m) < 0) b = m; else a = m; }
                    depth[y * W + x] = (a + b) / 2;
                    break;
                }
                t = t2;
            }
        }
    }
    return depth;
}

function groundStats(img, depth, W, H) {
    const k = GRASS_RANGE / 150, edges = RING_EDGES.map((e) => e * k);
    const bands = [[2, edges[0]], ...edges.slice(1).map((e, i) => [edges[i], e]), [edges[3], 400]];
    const stats = bandStats(img, depth, W, H, bands);
    const { Y, rgb } = img;
    // The step across distance x, from the 15% inside it to the 15% outside.
    const step = (x) => {
        const s = [new Float64Array(5), new Float64Array(5)];
        for (let i = 0; i < W * H; i++) {
            const d = depth[i];
            if (!(d > x * 0.85 && d < x * 1.15)) continue;
            const A = s[d < x ? 0 : 1];
            A[0]++; A[1] += Y[i]; A[2] += rgb[i * 3]; A[3] += rgb[i * 3 + 1]; A[4] += rgb[i * 3 + 2];
        }
        if (s[0][0] < 100 || s[1][0] < 100) return null;
        const m = s.map((A) => [A[1] / A[0], A[2] / A[0], A[3] / A[0], A[4] / A[0]]);
        return { dY: m[1][0] - m[0][0], drgb: Math.hypot(m[1][1] - m[0][1], m[1][2] - m[0][2], m[1][3] - m[0][3]) };
    };
    // Each edge's step against the same step a little inside and outside it
    // (the view's own changes with distance: a glade's edge, shade): a seam
    // is an edge whose drgb stands well over its controls'.
    const seams = edges.map((e) => {
        const at = step(e), ctl = [step(e / 1.3), step(e * 1.3)].filter(Boolean);
        if (!at || !ctl.length) return null;
        return { edge: +e.toFixed(1), dY: +at.dY.toFixed(2), drgb: +at.drgb.toFixed(2),
                 control: +(ctl.reduce((a, c) => a + c.drgb, 0) / ctl.length).toFixed(2) };
    });
    return { bands: stats, seams };
}

function bandsImage(g, depth, W, H, file) {
    const tints = [[255, 60, 60], [255, 220, 40], [60, 220, 90], [70, 120, 255]];
    const top = Math.max(0, g.height - H);
    const cv = document.createElement('canvas');
    cv.width = W; cv.height = H;
    cv.style.cssText = `position:absolute;left:0;top:0;width:${W}px;height:${H}px;z-index:10`;
    document.body.append(cv);
    const c = cv.getContext('2d');
    const im = c.createImageData(W, H);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
        const k = y * W + x, o = ((y + top) * g.width + x) * 4, d = depth[k];
        const b = BANDS.findIndex(([lo, hi]) => d >= lo && d < hi);
        for (let j = 0; j < 3; j++) im.data[k * 4 + j] = b < 0 ? g.data[o + j] * 0.5 : 0.55 * g.data[o + j] + 0.45 * tints[b][j];
        im.data[k * 4 + 3] = 255;
    }
    c.putImageData(im, 0, 0);
    advanceTime(30);
    flush();
    screenshot(file);
    cv.remove();
}

function metrics() {
    const shots = (a1 || 'canopy,skim,glade,trunks').split(','), label = a2 || 'forest';
    const skies = (a3 || 'noon,golden').split(',');
    const W = innerWidth, H = innerHeight;
    const out = [];
    const keys = ['Y', 'd1', 'd3', 'd9', 'hard', 'flat', 'block'];
    console.log(`metrics ${label}: Leaves/By size per band${keys.map((k) => k.padStart(13)).join('')}`);
    for (const time of skies) {
        setup(a4 || 'breeze', 'auto', time);
        for (const s of shots) {
            setShot(s);
            setTier('auto');
            step(1.5);
            flush();
            // The mask at half resolution (a quarter of the rays), each value
            // standing for its 2 x 2 pixels.
            const half = crownDepth(W >> 1, H >> 1), depth = new Float32Array(W * H);
            for (let y = 0; y < H; y++) for (let x = 0; x < W; x++)
                depth[y * W + x] = half[Math.min(y >> 1, (H >> 1) - 1) * (W >> 1) + Math.min(x >> 1, (W >> 1) - 1)];
            const frames = {};
            let last = null, lastLuma = null;
            for (const tier of ['leaves', 'auto']) {
                setTier(tier);
                for (let k = 0; k < 2; k++) { advanceTime(1000 / fps); flush(); }
                last = frameImage();
                lastLuma = lumaOf(last, W, H);
                frames[tier] = bandStats(lastLuma, depth, W, H);
            }
            const gHalf = groundDepth(W >> 1, H >> 1, half), gDepth = new Float32Array(W * H);
            for (let y = 0; y < H; y++) for (let x = 0; x < W; x++)
                gDepth[y * W + x] = gHalf[Math.min(y >> 1, (H >> 1) - 1) * (W >> 1) + Math.min(x >> 1, (W >> 1) - 1)];
            const ground = groundStats(lastLuma, gDepth, W, H);
            const st = forestStats();
            if (args.includes('bands')) bandsImage(last, depth, W, H, `${OUT}/${label}_${s}_${time}_bands.png`);
            setTier('auto');
            console.log(`${s} ${time}: detail ${st.detail.toFixed(2)}, trees L/C/R ${st.trees.leaves}/${st.trees.clumps}/${st.trees.crowns}`);
            BANDS.forEach((b, i) => {
                const L = frames.leaves[i], A = frames.auto[i];
                if (!L || !A) return;
                const cells = keys.map((k) => `${L[k].toFixed(1)}/${A[k].toFixed(1)}`.padStart(13)).join('');
                const dc = Math.hypot(A.rgb[0] - L.rgb[0], A.rgb[1] - L.rgb[1], A.rgb[2] - L.rgb[2]);
                console.log(`  ${(L.band + ' m').padEnd(9)} ${String(L.px).padStart(7)} px ${cells}   drgb ${dc.toFixed(1)}`);
                out.push({ shot: s, sky: time, band: L.band, leaves: L, bySize: A, drgb: +dc.toFixed(2) });
            });
            for (const G of ground.bands) {
                if (!G) continue;
                console.log(`  ground ${(G.band + ' m').padEnd(11)} ${String(G.px).padStart(7)} px  Y ${G.Y.toFixed(1)}  ` +
                            `rgb ${G.rgb.map((c) => c.toFixed(0)).join(' ')}  d1/d3/d9 ${G.d1.toFixed(1)}/${G.d3.toFixed(1)}/${G.d9.toFixed(1)}`);
            }
            const seams = ground.seams.filter(Boolean);
            if (seams.length)
                console.log(`  ground seams: ${seams.map((m) => `${m.edge} m dY ${m.dY.toFixed(1)} drgb ${m.drgb.toFixed(1)} (around ${m.control.toFixed(1)})`).join(', ')}`);
            out.push({ shot: s, sky: time, ground });
        }
    }
    const file = `${OUT}/${label}_metrics.json`;
    require('fs').writeFileSync(file, JSON.stringify(out, null, 1));
    console.log(file);
}

// The herbs' hand-over to the grass, measured: the same view with the herb
// plants drawn all the way out (range 200) and as the forest draws them
// (handing over to the blades and the turf), per band of ground distance:
// luminance, mean colour, local contrast at 1, 3 and 9 px, and the colour
// step between them (drgb). Writes <label>_herbmetrics.json.
//   herbs [shots=glade,trunks] [label=forest] [skies=noon,golden] [wind=breeze]
const HERB_BANDS = [[2, 12], [12, 24], [24, 40], [40, 80], [80, 150]];
function herbMetrics() {
    const shots = (a1 || 'glade,trunks').split(','), label = a2 || 'forest';
    const skies = (a3 || 'noon,golden').split(',');
    const W = innerWidth, H = innerHeight;
    const g = forest.grass, range0 = HERB_RANGE;
    const out = [];
    console.log(`herbs ${label}: plants to 200 m / handed over, per band    Y      rgb      d1/d3/d9   drgb`);
    for (const time of skies) {
        setup(a4 || 'breeze', 'auto', time);
        for (const s of shots) {
            if (s[0] === '@') {
                // A view of its own: @x/h/z/lookx/lookh/lookz (h over the ground).
                const [ex, eh, ez, lx, lh, lz] = s.slice(1).split('/').map(Number);
                holdView([ex, groundHeight(ex, ez) + eh, ez], [lx, groundHeight(lx, lz) + lh, lz]);
            } else {
                setShot(s);
            }
            step(1.5);
            flush();
            const half = crownDepth(W >> 1, H >> 1);
            const gHalf = groundDepth(W >> 1, H >> 1, half), depth = new Float32Array(W * H);
            for (let y = 0; y < H; y++) for (let x = 0; x < W; x++)
                depth[y * W + x] = gHalf[Math.min(y >> 1, (H >> 1) - 1) * (W >> 1) + Math.min(x >> 1, (W >> 1) - 1)];
            const st = {};
            for (const [key, range] of [['full', 200], ['handover', range0]]) {
                g.setHerbs({ species: HERBS, range });
                for (let k = 0; k < 2; k++) { advanceTime(1000 / fps); flush(); }
                st[key] = bandStats(lumaOf(frameImage(), W, H), depth, W, H, HERB_BANDS);
            }
            g.setHerbs({ species: HERBS, range: range0 });
            console.log(`${s} ${time}:`);
            HERB_BANDS.forEach((b, i) => {
                const F = st.full[i], A = st.handover[i];
                if (!F || !A) return;
                const dc = Math.hypot(A.rgb[0] - F.rgb[0], A.rgb[1] - F.rgb[1], A.rgb[2] - F.rgb[2]);
                const rgb = (q) => q.rgb.map((c) => c.toFixed(0)).join(',');
                console.log(`  ${(F.band + ' m').padEnd(9)} ${String(F.px).padStart(7)} px  Y ${F.Y.toFixed(1)}/${A.Y.toFixed(1)}  ` +
                            `${rgb(F)} / ${rgb(A)}  ${F.d1.toFixed(1)}/${F.d3.toFixed(1)}/${F.d9.toFixed(1)} vs ` +
                            `${A.d1.toFixed(1)}/${A.d3.toFixed(1)}/${A.d9.toFixed(1)}  drgb ${dc.toFixed(1)}`);
                out.push({ shot: s, sky: time, band: F.band, full: F, handover: A, drgb: +dc.toFixed(2) });
            });
        }
    }
    const file = `${OUT}/${label}_herbmetrics.json`;
    require('fs').writeFileSync(file, JSON.stringify(out, null, 1));
    console.log(file);
}

// The frame as a JPEG at quality 95 (a PNG of a full frame is over the image
// viewer's limit, and its re-encode bands the sky).
function saveJpeg(file) {
    const g = frameImage();
    const top = Math.max(0, g.height - innerHeight);
    const px = new Uint8Array(g.data.buffer, g.data.byteOffset + top * g.width * 4, (g.height - top) * g.width * 4);
    bro.image.encodeJpegFile(file, px, g.width, g.height - top, 4, 95);
    console.log(file);
}

// The meadow at true scale, from its edge across it: a flowering plant at
// 0.5 and 3 m, the meadow's ground at 30 and 60 m, the trees on its far
// side at 150 m; and a view under the trees. Full frames at each sky:
// <label>_meadow_<sky>_<d>m.jpg, <label>_understory_<sky>.jpg.
//   meadow [label=meadow] [skies=noon,golden] [wind=breeze]
const FLOWERS = ['daisy', 'poppy', 'yarrow', 'foxglove', 'bluebell', 'plantain'];
function meadowShots() {
    const label = a1 || 'meadow';
    for (const time of (a2 || 'noon,golden').split(',')) {
        setup(a3 || 'breeze', 'auto', time);
        setShot('meadow');
        step(1.5);
        // The flowering plant nearest a point a few metres in.
        const [px, pz] = meadowAt(5);
        const plants = forest.grass.herbPlants(px, pz, 5);
        const plant = plants.find((q) => FLOWERS.includes(HERBS[q.species])) || plants[0];
        for (const d of [0.5, 3, 30, 60, 150]) {
            let eye, look, what;
            if (d < 10 && plant) {
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
            console.log(`meadow ${time} ${d} m: ${what}`);
            saveJpeg(`${OUT}/${label}_meadow_${time}_${d}m.jpg`);
        }
        setShot('understory');
        step(1.5);
        flush();
        saveJpeg(`${OUT}/${label}_understory_${time}.jpg`);
    }
}

// Several commands joined by `+` run one after another in this one boot.
// Between them the page is put back as the boot left it: any overlay a
// command drew is removed and the forest's level of detail restored (the
// clock runs on, so wind and the flight's motion continue from there).
const MODES = { still: stills, trace, video, handover, compare, parts, hold, metrics, tiers, herbs: herbMetrics,
                meadow: meadowShots };
const lod0 = forest.parts.map((p) => p.node.forestLod());
const commands = [[]];
for (const a of argv) a === '+' ? commands.push([]) : commands[commands.length - 1].push(a);
for (const cmd of commands) {
    args = cmd;
    // The positional arguments; `key=value` options (opt()) may sit anywhere.
    [mode = 'still', a1, a2, a3, a4] = cmd.filter((a) => !/^[a-z]+=/.test(a));
    const before = new Set(document.body.children);
    (MODES[mode] || stills)();
    for (const el of [...document.body.children]) if (!before.has(el)) el.remove();
    forest.parts.forEach((p, k) => p.node.setForestLod(lod0[k]));
    setTier('auto');
    flush();
}
