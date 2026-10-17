// Captures of the forest, made in headless bro (the clock is virtual: every
// frame is 1/30 s, so a capture is the same on any machine).
//
//   bro-headless --width 1280 --height 720 demos/forest demos/forest/capture.js -- \
//       still <shot[,shot...]> [label=forest] [wind=breeze] [tier=auto] [sky=golden]
//   bro-headless ... capture.js -- trace [label=forest] [wind=breeze] [far=impostors|sprites] [budget]
//       GPU ms per frame along the whole flight: max, p95 and mean, a line a
//       second with the trees at each tier, and <label>_trace.json; `far`
//       picks the far tier (sprites: the clumps and crowns before impostors),
//       `budget` overrides the leaves' vertex budget (millions)
//   bro-headless ... capture.js -- video [label=forest] [wind=breeze] [fps=30]
//       the flight as <label>.webm
//   bro-headless ... capture.js -- handover <leaves|cards|clumps|crowns|impostors> [label=forest] [frames=12]
//       a dolly out from a tree through the distances where it hands over
//       from one tier to the next: <label>_handover_<which>_strip.png
//   bro-headless ... capture.js -- compare <shot[,shot...]> [label=forest] [wind=gusty] [sky=noon]
//       the forced Leaves tier beside By size, the middle half of each view:
//       <label>_<shot>_<sky>_compare.png
//
// Everything goes to demos/forest/captures/.

import { forest, setWind, setShot, sky, flight, flightAt, FLIGHT_SECONDS, vp } from "/app/forest.js";

const argv = (bro.app && bro.app.argv) || [];
const [mode = 'still', a1, a2, a3, a4] = argv;
const OUT = bro.resolvePath('/app/captures').replace(/\\/g, '/');

document.body.classList.add('clean');
flush();

const fps = 30;
function step(seconds) {
    const n = Math.max(1, Math.round(seconds * fps));
    for (let i = 0; i < n; i++) advanceTime(1000 / fps);
}

function setup(wind, tier, time) {
    setWind(wind || 'breeze');
    sky.apply(time || 'golden');
    forest.node.setForestTier(tier || 'auto');
}

function stills() {
    const label = a2 || 'forest';
    setup(a3, a4, argv[5]);
    for (const s of (a1 || 'above').split(',')) {
        setShot(s);
        step(1.5);
        flush();
        const file = `${OUT}/${label}_${s}.png`;
        screenshot(file);
        console.log(`${file}: ${JSON.stringify(forest.node.forestStats())}`);
    }
}

const pct = (sorted, p) => sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))];

function trace() {
    const label = a1 || 'forest';
    setup(a2);
    // The far tier: impostors (the default), or the older clump and crown sprites.
    forest.node.setForestLod({ impostors: a3 === 'sprites' ? 0 : 1 });
    if (a4) forest.node.setForestLod({ budget: +a4 });
    // Warm: one pass over the flight at a frame a second, so pipelines and
    // the shadow atlas exist before anything is timed.
    flight.on = true;
    flight.speed = 0;
    for (let t = 0; t <= FLIGHT_SECONDS; t += 1) { flight.t = t; advanceTime(1000 / fps); flush(); }
    flight.t = 0;
    for (let i = 0; i < 10; i++) { advanceTime(1000 / fps); flush(); }
    perf.gpuFrameMs();
    flight.speed = 1;
    const frames = [];
    const n = Math.round(FLIGHT_SECONDS * fps);
    for (let i = 0; i <= n; i++) {
        flight.t = i / fps;
        advanceTime(1000 / fps);
        flush();
        const ms = perf.gpuFrameMs();
        const s = forest.node.forestStats();
        frames.push({ t: +(i / fps).toFixed(3), ms, eye: flightAt(i / fps).eye.map((v) => +v.toFixed(1)),
                      trees: [s.trees.leaves, s.trees.clumps, s.trees.crowns, s.trees.impostors], culled: s.culled,
                      vertices: s.vertices, shadowVertices: s.shadowVertices, draws: s.draws });
    }
    const ms = frames.map((f) => f.ms).sort((a, b) => a - b);
    const mean = ms.reduce((a, b) => a + b, 0) / ms.length;
    for (let sec = 0; sec <= FLIGHT_SECONDS; sec++) {
        const fr = frames.filter((f) => f.t >= sec && f.t < sec + 1);
        if (!fr.length) continue;
        const worst = fr.reduce((a, b) => (b.ms > a.ms ? b : a));
        console.log(`t=${String(sec).padStart(2)}s  eye y ${worst.eye[1].toFixed(0).padStart(4)}  ` +
                    `max ${worst.ms.toFixed(2)} ms  trees L/C/R/I ${worst.trees.join('/')}  ` +
                    `${(worst.vertices / 1e6).toFixed(1)} M verts, ${(worst.shadowVertices / 1e6).toFixed(1)} M shadow, ${worst.draws} draws`);
    }
    const summary = { frames: frames.length, max: ms[ms.length - 1], p95: pct(ms, 0.95), p50: pct(ms, 0.5), mean,
                      width: innerWidth, height: innerHeight, trees: forest.node.forestStats().treeCount };
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

// The tree the handover strips dolly from: the one nearest the glade's
// far edge, seen across the glade.
function subject() {
    const inst = forest.trees, spec = forest.emit.specimens;
    let best = 0, bd = Infinity;
    for (let i = 0; i < inst.length / 8; i++) {
        const d = Math.hypot(inst[i * 8] - 40, inst[i * 8 + 2] - 30);
        if (d < bd) { bd = d; best = i; }
    }
    const s = inst[best * 8 + 5] | 0, sc = inst[best * 8 + 3];
    const h = spec[s * 16 + 6] * sc;
    return { index: best, specimen: s, scale: sc,
             top: [inst[best * 8], inst[best * 8 + 1] + h * 0.6, inst[best * 8 + 2]] };
}

// The view's pixels per metre at distance d (the forest node's measure).
const pxPerMetre = (d) => (innerHeight / 2) / Math.tan(vp.cam.fov * Math.PI / 360) / d;

// The distance at which the subject's lod crosses `f(lod)` = true, by bisection.
function distanceWhere(sub, f) {
    let lo = 1, hi = 3000;
    for (let i = 0; i < 40; i++) {
        const mid = Math.sqrt(lo * hi);
        if (f(forest.node.forestTreeLod(sub.specimen, pxPerMetre(mid) * sub.scale))) hi = mid; else lo = mid;
    }
    return hi;
}

const HANDOVERS = {
    leaves: (l) => l.widening > 1.05,      // full leaves start thinning
    cards: (l) => l.card,                  // the leaves turn to cards
    clumps: (l) => l.leaves < 0.5,         // half way to clumps (the clumps' own share falls again past the crowns)
    crowns: (l) => l.crowns > 0.5,         // half way to crowns
    impostors: (l) => l.impostors > 0.5,   // half way to impostors
};

function handover() {
    const which = a1 || 'clumps', label = a2 || 'forest', frames = +(a3 || 12);
    setup('breeze');
    flight.on = false;
    const sub = subject();
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
        const l = forest.node.forestTreeLod(sub.specimen, pxPerMetre(d) * sub.scale);
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
                    `L ${s.l.leaves.toFixed(2)} C ${s.l.clumps.toFixed(2)} R ${s.l.crowns.toFixed(2)} I ${s.l.impostors.toFixed(2)}`;
        g.fillStyle = '#000'; g.fillText(txt, x + 6, y + 17);
        g.fillStyle = '#fff'; g.fillText(txt, x + 5, y + 16);
    });
    advanceTime(30);
    flush();
    const file = `${OUT}/${label}_handover_${which}_strip.png`;
    screenshot(file);
    console.log(file);
}

// Side by side at each shot: the forced "Leaves" tier on the left, "By size"
// on the right, the middle half of each view at full resolution, a frame
// apart. <label>_<shot>_<sky>_compare.png.
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
        forest.node.setForestTier('auto');
        step(1.5);
        flush();
        const panes = [];
        for (const tier of ['leaves', 'auto']) {
            forest.node.setForestTier(tier);
            for (let k = 0; k < 2; k++) { advanceTime(1000 / fps); flush(); }
            panes.push(shrink(frameImage(), half, H, [0.5, 0.5, half / W]));
        }
        forest.node.setForestTier('auto');
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
        const file = `${OUT}/${label}_${s}_${time}_compare.png`;
        screenshot(file);
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
    const show = (g, t) => { forest.grass.visible = g; forest.node.visible = t; };
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

if (mode === 'compare') compare(); else if (mode === 'parts') parts(); else if (mode === 'trace') trace(); else if (mode === 'video') video(); else if (mode === 'handover') handover(); else stills();
