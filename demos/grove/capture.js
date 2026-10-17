// Motion captures of the grove, made in headless bro: a strip (a time series
// tiled into one image, so motion can be judged from a still) and a webm.
//
//   bro-headless --width 1280 --height 720 demos/grove demos/grove/capture.js -- \
//       strip <shot> [label] [span=3] [frames=12] [crop=cx,cy,w|-] [path=gpu] [wind=breeze] [legacy]
//   bro-headless --width 1280 --height 720 demos/grove demos/grove/capture.js -- \
//       video <shot[,shot...]> [label] [seconds=6] [fps=30] [path=gpu] [wind=breeze] [legacy]
//   bro-headless --width 1280 --height 720 demos/grove demos/grove/capture.js -- \
//       still <shot[,shot...]> [label] [path=gpu] [wind=breeze]
//   bro-headless --width 1280 --height 720 demos/grove demos/grove/capture.js -- \
//       perf <shot[,shot...]> [wind=breeze]   (GPU ms per frame, and the grass's, leaves' and bark's shares)
//   bro-headless --width 1280 --height 720 demos/grove demos/grove/capture.js -- \
//       species <name[,name...]|all> [label=species] [skies=noon,golden] [tier=auto]
//       (each conifer and shrub preset close, mid and far: <label>_<name>_<sky>.jpg)
//   bro-headless --width 1280 --height 720 demos/grove demos/grove/capture.js -- \
//       herbs <name[,name...]|all> [label=herb] [skies=noon,golden] [sil]
//       (each herb preset alone in the meadow at 1, 3, 10 and 30 m: <label>_<name>_<sky>.jpg;
//       `meadow` for the meadow's own mix, views=0.5,3,30,150 from knee height out)
//   bro-headless --width 960 --height 540 demos/grove demos/grove/capture.js -- \
//       swayprofile <name[,name...]> [label=sway] [dist=20] [seconds=6] [wind=gusty]
//       (how far each eighth of a plant's height moves in the wind, side on)
//
// Several commands in one boot: join them with `+`, e.g.
//   capture.js -- still grove,tree,meadow + strip close + perf grove
// The grown grove is cached (world.grow under bro.app.cacheDir), so a boot
// is about a second once grown; BRO_SCENE_SHADER_SOURCE=1 takes bro's scene
// shaders from its source tree, so a .glsl edit needs no rebuild.
//
// Strips go to demos/grove/captures/<label>_<shot>_strip[_crop].png, videos to
// demos/grove/captures/<label>.webm. `legacy` draws the mesh path with the
// single-sine wind apps had before the vegetation path (the "before"). The
// clock is virtual: every frame is 1/fps s, so a capture is the same on any
// machine.

import { grove, draw, setWind, setShot, sky, vp, groundHeight, ground, PRESET_PLANTS, WINDS, MEADOW_HERBS } from "/app/grove.js";

const argv = (bro.app && bro.app.argv) || [];
// The command now running (see the end: several join with `+`).
let mode, shotsA, label, a3, a4, a5, a6, a7, a8;
let cmdArgs = [];   // the command's arguments as given (its key=value ones)
const OUT = bro.resolvePath('/app/captures').replace(/\\/g, '/');

document.body.classList.add('clean');
flush();

const fps = 30;
function step(seconds) {
    const n = Math.max(1, Math.round(seconds * fps));
    for (let i = 0; i < n; i++) advanceTime(1000 / fps);
}

function setup(path, wind, legacy) {
    grove.legacyWind = legacy;
    draw(path);
    setWind(wind);
    sky.apply('golden');
}

// Box-downsample frame `g` ({width, height, data}, top row first), optionally a
// crop (centre cx, cy in 0..1, width cw as a fraction), into tw x th RGBA.
function shrink(g, tw, th, crop) {
    const [cx, cy, cw] = crop || [0.5, 0.5, 1];
    // The frame carries the window's title bar above the page: skip it.
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

// A composite to look at, as a JPEG at quality 95 (the page only, no title
// bar). Four full panes of grass are 4 to 5 MB as a PNG, past what an image
// viewer such as a model's image input takes whole: it re-encodes them, and
// the re-encode posterises every smooth sky and haze into contoured bands
// that are not in the frame. At quality 95 the same frame is about 1.4 MB
// and reaches the viewer as it is.
function saveView(file) {
    const g = frameImage();
    const top = Math.max(0, g.height - innerHeight);
    const px = new Uint8Array(g.data.buffer, g.data.byteOffset + top * g.width * 4, (g.height - top) * g.width * 4);
    bro.image.encodeJpegFile(file, px, g.width, g.height - top, 4, 95);
}

function strip() {
    const span = +(a3 || 3), frames = +(a4 || 12);
    const crop = a5 && a5 !== '-' ? a5.split(',').map(Number) : null;
    const path = a6 || 'gpu', wind = a7 || 'breeze', legacy = a8 === 'legacy';
    setup(path, wind, legacy);
    setShot(shotsA);
    step(2);   // warm: shadows settle, the gusts are under way
    const W = innerWidth, H = innerHeight;
    const cols = 4, rows = Math.ceil(frames / cols), gap = 4;
    const tw = Math.floor((W - gap * (cols + 1)) / cols);
    const th = Math.floor(Math.min(tw * 9 / 16, (H - gap * (rows + 1)) / rows));
    const grabs = [];
    const dt = span / Math.max(1, frames - 1);
    let t = 0;
    for (let i = 0; i < frames; i++) {
        if (i) { step(dt); t += dt; }
        flush();
        grabs.push({ t, px: shrink(frameImage(), tw, th, crop) });
    }
    const cv = document.createElement('canvas');
    cv.width = W; cv.height = H;
    cv.style.cssText = `position:absolute;left:0;top:0;width:${W}px;height:${H}px;z-index:10`;
    document.body.append(cv);
    const g = cv.getContext('2d');
    g.fillStyle = '#111';
    g.fillRect(0, 0, W, H);
    g.font = '600 14px system-ui';
    grabs.forEach((s, i) => {
        const x = gap + (i % cols) * (tw + gap), y = gap + Math.floor(i / cols) * (th + gap);
        const im = g.createImageData(tw, th);
        im.data.set(s.px);
        g.putImageData(im, x, y);
        const txt = `${label} ${shotsA}  t=${s.t.toFixed(2)}s`;
        g.fillStyle = '#000'; g.fillText(txt, x + 6, y + 17);
        g.fillStyle = '#fff'; g.fillText(txt, x + 5, y + 16);
    });
    advanceTime(30);
    flush();
    const file = `${OUT}/${label}_${shotsA}_strip${crop ? '_crop' : ''}.png`;
    screenshot(file);
    console.log(`${file}: ${frames} frames over ${span}s`);
}

function video() {
    const seconds = +(a3 || 6), vfps = +(a4 || 30);
    const path = a5 || 'gpu', wind = a6 || 'breeze', legacy = a7 === 'legacy';
    setup(path, wind, legacy);
    const shots = shotsA.split(',');
    setShot(shots[0]);
    step(2);
    const file = `${OUT}/${label}.webm`;
    // The encoder takes the whole viewport (the window's title bar included).
    const vp0 = frameImage();
    const enc = new VideoEncoder({ path: file, width: vp0.width, height: vp0.height, fps: vfps, quality: 'good' });
    let n = 0;
    const t0 = perf.now();
    for (const s of shots) {
        setShot(s);
        for (let i = 0; i < Math.round(seconds * vfps); i++, n++) {
            advanceTime(1000 / vfps);
            flush();
            enc.addViewportFrame();
        }
    }
    enc.finish();
    console.log(`${file}: ${n} frames in ${((perf.now() - t0) / 1000).toFixed(1)} s ${enc.lastError || ''}`);
}

// One full-size frame of each shot: <label>_<shot>.png.
function stills() {
    const path = a3 || 'gpu', wind = a4 || 'breeze';
    setup(path, wind, false);
    console.log(`${path}: ${JSON.stringify(grove.stats)}`);
    for (const s of shotsA.split(',')) {
        setShot(s);
        step(2);
        flush();
        const file = `${OUT}/${label}_${s}.png`;
        screenshot(file);
        console.log(file);
    }
}

// Each preset (PRESET_PLANTS) at four distances, seen from the meadow with
// every other plant hidden: <label>_<name>_<sky>.jpg (saveView), four panes, the middle
// quarter of each view. A tree is seen from 5, 20, 60 and 150 m, a shrub
// from 2.5, 6, 20 and 60 m. The eye stays within 60 m (over the grove's
// ground); further views narrow the field of view to the size the plant
// would have, so it draws the tier that distance gives it (the haze is the
// 60 m eye's). `sil` adds <label>_<name>_sil.jpg: the same four views with
// the ground, grass and sky gone and the plant flat black on white, to
// judge its form apart from its shading. `tier` forces a forest tier
// (auto, leaves, ...).
//   species <name,...|all> [label=species] [skies=noon,golden] [tier=auto] [sil]
function species() {
    const names = !shotsA || shotsA === 'all' ? PRESET_PLANTS.map((p) => p.name) : shotsA.split(',');
    const skies = (a3 || 'noon,golden').split(',');
    const tier = a4 || 'auto';
    const sil = a5 === 'sil';
    const W = innerWidth, H = innerHeight, pane = Math.floor(W / 4);
    const FAR_EYE = 60, FOV = vp.cam.fov || 45;
    const tanHalf = Math.tan(FOV * Math.PI / 360);
    // Point of view: [name, distance] per habit.
    const VIEWS = { tree: [5, 20, 60, 150], shrub: [2.5, 6, 20, 60] };
    // Hidden for a silhouette (the roller stays: a scene with nothing in it
    // to draw is not rendered at all, and the ball is the same in both frames).
    const others = () => [...grove.nodes, ...grove.presets.map((q) => q.node), grove.grass, ground];
    const grab = () => shrink(frameImage(), pane, H, [0.5, 0.5, pane / W]);
    const compose = (panes, captions, file) => {
        const cv = document.createElement('canvas');
        cv.width = W; cv.height = H;
        cv.style.cssText = `position:absolute;left:0;top:0;width:${W}px;height:${H}px;z-index:10`;
        document.body.append(cv);
        const g = cv.getContext('2d');
        g.font = '600 14px system-ui';
        panes.forEach((px, k) => {
            const im = g.createImageData(pane, H);
            im.data.set(px);
            g.putImageData(im, k * pane, 0);
            g.fillStyle = '#000'; g.fillText(captions[k], k * pane + 9, 21);
            g.fillStyle = '#fff'; g.fillText(captions[k], k * pane + 8, 20);
        });
        g.fillStyle = '#888';
        for (let k = 1; k < 4; k++) g.fillRect(k * pane - 1, 0, 2, H);
        advanceTime(30);
        flush();
        saveView(file);
        cv.remove();
        console.log(file);
    };
    const visible = new Map();
    for (const time of skies) {
        setup('gpu', 'breeze', false);
        sky.apply(time);
        for (const p of grove.presets) p.node.setForestTier(tier);
        for (const name of names) {
            const p = PRESET_PLANTS.find((q) => q.name === name);
            if (!p) { console.log(`species: no ${name}`); continue; }
            const part = grove.presets.find((q) => q.rows.some((r) => r.plant === p));
            const row = part.rows.find((r) => r.plant === p);
            const h = row.height;
            const shrub = (p.habit || (h < 3 ? 'shrub' : 'tree')) === 'shrub';
            const views = VIEWS[shrub ? 'shrub' : 'tree'];
            const target = [p.x, groundHeight(p.x, p.z) + h * 0.5, p.z];
            const yaw = Math.atan2(-p.x, -p.z);
            // A shrub stands in the meadow's grass (cleared round it by its
            // own ground cover, grove.js growGrass): the view looks down on
            // it from nearer (the grove's ground ends some 40 m out).
            const grassWas = grove.grass ? grove.grass.visible : false;
            // Only this plant: its own node, holding only its own tree.
            for (const n of grove.nodes) n.visible = false;
            for (const q of grove.presets) q.node.visible = q === part;
            part.node.setTrees(new Float32Array(row.row));
            const shaded = [], flat = [], captions = [];
            for (const d of views) {
                const eye = Math.min(d, shrub ? 15 : FAR_EYE);
                vp.cam.fov = 2 * Math.atan(tanHalf * d / eye) * 180 / Math.PI;
                // A slight look up from close by (the crown against the sky), down from far.
                vp.reframe(target, eye, { yaw, pitch: shrub ? -0.3 : d <= 5 ? 0.08 : -0.06 - 0.0004 * d });
                step(1);
                flush();
                shaded.push(grab());
                captions.push(`${name} ${time} ${d} m (h ${h.toFixed(1)} m)`);
                if (!sil || time !== skies[0]) continue;
                for (const n of others()) { visible.set(n, n.visible); if (n !== part.node) n.visible = false; }
                flush();
                const a = grab();
                part.node.visible = false;
                flush();
                const b = grab();
                for (let i = 0; i < a.length; i += 4) {
                    const diff = Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2]);
                    const v = diff > 6 ? 0 : 255;
                    a[i] = a[i + 1] = a[i + 2] = v;
                }
                flat.push(a);
                for (const [n, v] of visible) n.visible = v;
                visible.clear();
            }
            vp.cam.fov = FOV;
            compose(shaded, captions, `${OUT}/${label}_${name}_${time}${tier === 'auto' ? '' : '_' + tier}.jpg`);
            if (flat.length) compose(flat, captions.map((c) => c.replace(` ${time} `, ' silhouette ')), `${OUT}/${label}_${name}_sil.jpg`);
            part.node.setTrees(new Float32Array(part.rows.flatMap((r) => r.row)));
            for (const n of grove.nodes) n.visible = true;
            for (const q of grove.presets) q.node.visible = true;
            if (grove.grass) grove.grass.visible = grassWas;
        }
        for (const p of grove.presets) p.node.setForestTier('auto');
    }
}

// Each herb preset (broflora's: ferns, wildflowers, forbs) alone in the
// meadow at 1, 3, 10 and 30 m, at each sky: the meadow's grass node draws
// only that species, everywhere it can (its light and colonies set aside),
// at full density. `sil` adds a silhouette row (the herbs against the same
// frame without them). <label>_<name>_<sky>.jpg, <label>_<name>_sil.jpg.
//   herbs <name[,name...]|all> [label=herb] [skies=noon,golden] [sil]
function herbs() {
    // `meadow`: the meadow's own mix of herbs (MEADOW_HERBS, each where its
    // light and colonies put it), not one species alone.
    const names = !shotsA || shotsA === 'all' ? bro.flora.herbPresets() : shotsA.split(',');
    const speciesOf = (name) => name === 'meadow' ? MEADOW_HERBS
        : [{ preset: name, shade: 0, shadeRange: 1, patchCover: 1, abundance: 1 }];
    const sil = cmdArgs.includes('sil');
    const skyList = a3 && a3 !== 'sil' && !a3.includes('=') ? a3.split(',') : ['noon', 'golden'];
    const W = innerWidth, H = innerHeight, pane = Math.floor(W / 4);
    const grab = () => shrink(frameImage(), pane, H, [0.5, 0.5, pane / W]);
    // Distance and pitch: the far view looks down over the shrubs.
    const PITCH = { 0.5: -0.25, 1: -0.5, 3: -0.32, 10: -0.16, 30: -0.2, 60: -0.16, 150: -0.12 };
    const dists = (cmdArgs.find((s) => s.startsWith('views=')) || 'views=1,3,10,30').slice(6).split(',').map(Number);
    const VIEWS = dists.map((d) => [d, PITCH[d] !== undefined ? PITCH[d] : -0.2]);
    const at = [-1, 13.5];
    const g = grove.grass;
    const compose = (panes, captions, file) => {
        const cv = document.createElement('canvas');
        cv.width = W; cv.height = H;
        cv.style.cssText = `position:absolute;left:0;top:0;width:${W}px;height:${H}px;z-index:10`;
        document.body.append(cv);
        const c = cv.getContext('2d');
        c.font = '600 14px system-ui';
        panes.forEach((px, k) => {
            const im = c.createImageData(pane, H);
            im.data.set(px);
            c.putImageData(im, k * pane, 0);
            c.fillStyle = '#000'; c.fillText(captions[k], k * pane + 9, 21);
            c.fillStyle = '#fff'; c.fillText(captions[k], k * pane + 8, 20);
        });
        c.fillStyle = '#888';
        for (let k = 1; k < 4; k++) c.fillRect(k * pane - 1, 0, 2, H);
        advanceTime(30);
        flush();
        saveView(file);
        cv.remove();
        console.log(file);
    };
    const wind = (cmdArgs.find((s) => s.startsWith('wind=')) || 'wind=breeze').slice(5);
    // The plants alone in a short sward (a grazed meadow's): no trees or
    // shrubs in the way of the far views, the grass not over the herbs.
    const grassHeight = g.grassParams().height;
    g.setGrass({ height: 0.16 });
    const trees = () => [...grove.nodes, ...grove.presets.map((q) => q.node)];
    for (const time of skyList) {
        setup('gpu', wind, false);
        sky.apply(time);
        for (const n of trees()) n.visible = false;
        for (const name of names) {
            const p = name === 'meadow' ? { height: 0.5 } : bro.flora.herbPreset(name);
            if (!p) { console.log(`herbs: no ${name}`); continue; }
            // This species alone, wherever the meadow's herbs grow.
            g.setHerbs({ species: speciesOf(name) });
            const shaded = [], flat = [], captions = [];
            for (const [d, pitch] of VIEWS) {
                const target = [at[0], groundHeight(at[0], at[1]) + Math.min(p.height * 0.5, 0.4), at[1]];
                // From the bowl's middle out toward the hills (the eye stays
                // over the meadow).
                vp.reframe(target, d, { yaw: Math.PI - 0.3, pitch });
                step(1);
                flush();
                shaded.push(grab());
                captions.push(`${name} ${time} ${d} m (h ${p.height.toFixed(2)} m)`);
                if (!sil || time !== skyList[0]) continue;
                ground.visible = false;
                flush();
                const a = grab();
                g.setHerbs({ species: [] });
                flush();
                const b = grab();
                g.setHerbs({ species: speciesOf(name) });
                ground.visible = true;
                for (let i = 0; i < a.length; i += 4) {
                    const diff = Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2]);
                    const v = diff > 6 ? 0 : 255;
                    a[i] = a[i + 1] = a[i + 2] = v;
                }
                flat.push(a);
            }
            compose(shaded, captions, `${OUT}/${label}_${name}_${time}.jpg`);
            if (flat.length) compose(flat, captions.map((c) => c.replace(` ${time} `, ' silhouette ')), `${OUT}/${label}_${name}_sil.jpg`);
        }
        g.setHerbs({ species: MEADOW_HERBS });
    }
    g.setGrass({ height: grassHeight });
    draw('gpu');
    for (const q of grove.presets) q.node.visible = true;
}

// How far each part of a plant moves in the wind, by height: the plant
// alone, seen side on across the wind from `dist` m (default 20), for
// `seconds` (default 6) of `wind` (default gusty). Each frame's silhouette
// (a frame with it against one without) gives, per row, its left and right
// edges; a band's amplitude is the RMS over time of those edges about their
// mean (metres, through the view's scale), the band's eighth of the plant's
// height from the ground up. Prints one line per plant and writes
// <label>_swayprofile.json.
//   swayprofile <name,...> [label=sway] [dist=20] [seconds=6] [wind=gusty]
function swayProfile() {
    const names = (shotsA || 'fir,spruce,cedar').split(',');
    const dist = +(a3 || 20), seconds = +(a4 || 6), wind = a5 || 'gusty';
    setup('gpu', wind, false);
    sky.apply('noon');
    const W = innerWidth, H = innerHeight, FOV = vp.cam.fov || 45;
    const others = [...grove.nodes, ...grove.presets.map((q) => q.node), grove.grass, ground];
    const out = {};
    for (const name of names) {
        const p = PRESET_PLANTS.find((q) => q.name === name);
        if (!p) { console.log(`swayprofile: no ${name}`); continue; }
        const part = grove.presets.find((q) => q.rows.some((r) => r.plant === p));
        const row = part.rows.find((r) => r.plant === p);
        const h = row.height, base = groundHeight(p.x, p.z);
        const wd = WINDS[wind].wind.direction || WINDS.gusty.wind.direction;
        // Across the wind: the camera looks along the wind's perpendicular.
        const yaw = Math.atan2(wd[0], wd[2]) + Math.PI * 0.5;
        const was = new Map(others.map((n) => [n, n.visible]));
        for (const n of others) n.visible = n === part.node;
        part.node.setTrees(new Float32Array(row.row));
        // The whole plant in frame: back off until its height fills 80% of the view.
        const eye = Math.max(dist, h / 0.8 / (2 * Math.tan(FOV * Math.PI / 360)));
        vp.cam.fov = FOV;
        vp.reframe([p.x, base + h * 0.5, p.z], eye, { yaw, pitch: 0 });
        step(2);
        const mPerPx = 2 * eye * Math.tan(FOV * Math.PI / 360) / H;
        const frames = Math.round(seconds * fps);
        const L = [], R = [];
        for (let f = 0; f < frames; f++) {
            advanceTime(1000 / fps);
            part.node.visible = true; flush();
            const a = frameImage();
            part.node.visible = false; flush();
            const b = frameImage();
            const top = a.height - H;
            const l = new Float32Array(H).fill(NaN), r = new Float32Array(H).fill(NaN);
            for (let y = 0; y < H; y++) {
                const o0 = (y + top) * a.width * 4;
                for (let x = 0; x < W; x++) {
                    const o = o0 + x * 4;
                    if (Math.abs(a.data[o] - b.data[o]) + Math.abs(a.data[o + 1] - b.data[o + 1]) + Math.abs(a.data[o + 2] - b.data[o + 2]) > 6) {
                        if (isNaN(l[y])) l[y] = x;
                        r[y] = x;
                    }
                }
            }
            L.push(l); R.push(r);
        }
        // Rows to heights: the plant's base and top in the view, from the frames' mean extents.
        const rowsHit = [];
        for (let y = 0; y < H; y++) if (L.every((l) => !isNaN(l[y]))) rowsHit.push(y);
        const yTop = rowsHit[0], yBot = rowsHit[rowsHit.length - 1];
        const bands = new Array(8).fill(0).map(() => ({ s: 0, n: 0 }));
        for (const y of rowsHit) {
            const band = Math.min(7, Math.floor((yBot - y) / Math.max(1, yBot - yTop) * 8));
            for (const E of [L, R]) {
                let m = 0;
                for (const e of E) m += e[y];
                m /= E.length;
                for (const e of E) { bands[band].s += (e[y] - m) * (e[y] - m); bands[band].n++; }
            }
        }
        const amp = bands.map((b) => b.n ? Math.sqrt(b.s / b.n) * mPerPx : 0);
        out[name] = { height: h, eye, wind, amp };
        console.log(`${name} (h ${h.toFixed(1)} m, ${eye.toFixed(0)} m off, ${wind}): RMS edge motion by height band, low to high (cm): ` +
                    amp.map((v) => (100 * v).toFixed(1)).join(' '));
        part.node.setTrees(new Float32Array(part.rows.flatMap((r) => r.row)));
        for (const [n, v] of was) n.visible = v;
    }
    vp.cam.fov = FOV;
    require('fs').writeFileSync(`${OUT}/${label}_swayprofile.json`, JSON.stringify(out, null, 1));
}

// GPU ms per frame at each shot (perf.gpuFrameMs, the scene's timestamp
// queries): the whole frame, then without the grass, without the grass and
// the leaves, and without the grass and the plants, so each part's cost is
// the difference.
function perfShots() {
    setup('gpu', a3 || 'breeze', false);
    const n = 60;
    const [bark, leaves] = grove.nodes;
    const show = (g, l, b) => { grove.grass.visible = g; leaves.visible = l; bark.visible = b; };
    const cases = { all: [true, true, true], noGrass: [false, true, true], noLeaves: [false, false, true], bare: [false, false, false] };
    for (const s of shotsA.split(',')) {
        setShot(s);
        step(1);
        const ms = {};
        for (const [k, c] of Object.entries(cases)) {
            show(...c);
            for (let i = 0; i < 5; i++) { advanceTime(1000 / fps); flush(); }
            perf.gpuFrameMs();
            let sum = 0;
            for (let i = 0; i < n; i++) { advanceTime(1000 / fps); flush(); sum += perf.gpuFrameMs(); }
            ms[k] = sum / n;
        }
        show(true, true, true);
        const st = grove.grass.grassStats();
        console.log(`${s}: ${ms.all.toFixed(2)} ms, ${ms.noGrass.toFixed(2)} without grass (grass ${(ms.all - ms.noGrass).toFixed(2)}, ` +
                    `leaves ${(ms.noGrass - ms.noLeaves).toFixed(2)}, bark ${(ms.noLeaves - ms.bare).toFixed(2)}, rest ${ms.bare.toFixed(2)}); ` +
                    `grass instances ${st.instances.join(' / ')}`);
    }
}

// Several commands joined by `+` run one after another in this one boot,
// each from the page as the boot left it (any overlay removed; each sets
// its own path and wind); the virtual clock runs on between them.
const MODES = { strip, video, still: stills, perf: perfShots, species, herbs, swayprofile: swayProfile };
const commands = [[]];
for (const a of argv) a === '+' ? commands.push([]) : commands[commands.length - 1].push(a);
for (const cmd of commands) {
    [mode = 'strip', shotsA = 'grove', label = 'grove', a3, a4, a5, a6, a7, a8] = cmd;
    cmdArgs = cmd;
    const before = new Set(document.body.children);
    (MODES[mode] || strip)();
    for (const el of [...document.body.children]) if (!before.has(el)) el.remove();
    flush();
}
