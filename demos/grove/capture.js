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
//       herbs <name[,name...]|all> [label=herb] [skies=noon,golden] [sil] [views=d,d,...] [aim=top]
//       (each herb preset alone in the meadow at 1, 3, 10 and 30 m: <label>_<name>_<sky>.jpg;
//       `meadow` for the meadow's own mix, views=0.5,3,30,150 from knee height out)
//   bro-headless --width 1280 --height 720 demos/grove demos/grove/capture.js -- \
//       grassfloor [label] [noon,golden] [0.3,1,3,8,20]
//       (the grass on the contrast floor, side and 45 degrees down: <label>_<sky>_<view>_<d>m.png)
//   bro-headless --width 1280 --height 720 demos/grove demos/grove/capture.js -- \
//       foliage <name[,name...]> [label=foliage] [skies=noon,golden] [views=inside,1,3,8] [wind=breeze]
//       (a crown up close, full frame, from inside it and 1, 3 and 8 m off its edge:
//       <label>_<name>_<sky>_<view>.png; `broadleaf` the grove's own tree, else a preset)
//   bro-headless --width 960 --height 540 demos/grove demos/grove/capture.js -- \
//       swayprofile <name[,name...]> [label=sway] [dist=20] [seconds=6] [wind=gusty]
//       (how far each eighth of a plant's height moves in the wind, side on)
//   bro-headless --width 1280 --height 720 demos/grove demos/grove/capture.js -- \
//       leanstrip <name> [label] [seconds=6] [frames=12] [wind=strong]
//       (a preset side on, still air then a wind set and held, tiled: the held lean)
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

import { grove, draw, setWind, setShot, sky, vp, groundHeight, ground, roller, PRESET_PLANTS, WINDS, MEADOW_HERBS, contrastFloor,
         SHOTS, PLANT_SCALE } from "/app/grove.js";

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
                // The leaves tier's silhouette too, for the shape's overlap.
                part.node.setForestTier('leaves');
                flush();
                const ref = grab();
                part.node.setForestTier(tier);
                part.node.visible = false;
                flush();
                const b = grab();
                const sh = shaded[shaded.length - 1];
                let n = 0, nRef = 0, both = 0, Y = 0;
                for (let i = 0; i < a.length; i += 4) {
                    const diff = Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2]);
                    const dRef = Math.abs(ref[i] - b[i]) + Math.abs(ref[i + 1] - b[i + 1]) + Math.abs(ref[i + 2] - b[i + 2]);
                    const v = diff > 6 ? 0 : 255;
                    if (v === 0) { n++; Y += 0.2126 * sh[i] + 0.7152 * sh[i + 1] + 0.0722 * sh[i + 2]; }
                    if (dRef > 6) { nRef++; if (v === 0) both++; }
                    a[i] = a[i + 1] = a[i + 2] = v;
                }
                // Its cover against the leaves tier's, the silhouettes'
                // overlap (intersection over union) and its value inside its
                // own silhouette (in this sky).
                console.log(`species ${name} ${d} m ${tier}: cover ${n} px (leaves ${nRef}) iou ` +
                            `${(both / Math.max(n + nRef - both, 1)).toFixed(3)} Y ${(n ? Y / n : 0).toFixed(1)}`);
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

// A plant's foliage up close, full frame: from just outside its crown at
// 1, 3 and 8 m from the crown's edge, and from inside it looking out and
// up (a broadleaf or a shrub, the forest node's leaves on their shoots and
// twigs): <label>_<name>_<sky>_<d>m.png and <label>_<name>_<sky>_inside.png.
// `broadleaf` is the grove's own tree nearest the 'tree' shot, drawn
// through the forest path; the others are presets (birch, holly,
// hydrangea, ...).
//   foliage <name[,name...]> [label=foliage] [skies=noon,golden] [views=inside,1,3,8] [wind=breeze]
function foliage() {
    const names = (shotsA || 'broadleaf,birch,hydrangea,holly').split(',');
    const skies = (a3 || 'noon,golden').split(',');
    const views = (a4 || 'inside,1,3,8').split(',');
    const wind = a5 || 'breeze';
    // The crown in world space of a forest node's tree: its centre and radius.
    const crownOf = (node, emit, row) => {
        const s = row[5] | 0, sp = emit.specimens, k = node.scale ? node.scale[0] : 1;
        const cx = sp[s * 16 + 8], cy = sp[s * 16 + 9], cz = sp[s * 16 + 10];
        const c = Math.cos(row[4]), sn = Math.sin(row[4]), sc = row[3];
        return { centre: [k * (row[0] + sc * (cx * c + cz * sn)), k * (row[1] + sc * cy), k * (row[2] + sc * (-cx * sn + cz * c))],
                 radius: k * sc * sp[s * 16 + 7], height: k * sc * sp[s * 16 + 6] };
    };
    for (const time of skies) {
        setup('forest', wind, false);
        sky.apply(time);
        for (const name of names) {
            let crown, yaw;
            if (name === 'broadleaf') {
                const { emit, node } = grove.forest;
                const t = SHOTS.tree.target, k = PLANT_SCALE;
                let best = 0, bd = Infinity;
                for (let i = 0; i < emit.instances.length / 8; i++) {
                    const d = Math.hypot(emit.instances[i * 8] * k - t[0], emit.instances[i * 8 + 2] * k - t[2]);
                    if (d < bd) { bd = d; best = i; }
                }
                crown = crownOf(node, emit, emit.instances.slice(best * 8, best * 8 + 8));
                yaw = SHOTS.tree.yaw;
            } else {
                const p = PRESET_PLANTS.find((q) => q.name === name);
                if (!p) { console.log(`foliage: no ${name}`); continue; }
                const part = grove.presets.find((q) => q.rows.some((r) => r.plant === p));
                crown = crownOf(part.node, part.emit, part.rows.find((r) => r.plant === p).row);
                yaw = Math.atan2(-p.x, -p.z);
            }
            const dir = [Math.sin(yaw), 0, Math.cos(yaw)], R = crown.radius, C = crown.centre;
            for (const v of views) {
                if (v === 'inside') {
                    // From a third of the way out of the crown's middle, looking out and up.
                    vp.reframe([C[0] + dir[0] * R, C[1] + 0.25 * R, C[2] + dir[2] * R], 0.7 * R, { yaw: yaw + Math.PI, pitch: 0.3 });
                } else {
                    // Its edge nearest the eye, d m off, level with the crown's middle.
                    const d = +v;
                    vp.reframe([C[0] + dir[0] * 0.8 * R, C[1], C[2] + dir[2] * 0.8 * R], d + 0.2 * R, { yaw, pitch: 0.04 });
                }
                step(1);
                flush();
                const file = `${OUT}/${label}_${name}_${time}_${v === 'inside' ? 'inside' : v + 'm'}.png`;
                screenshot(file);
                console.log(`${file}: crown r ${R.toFixed(2)} m, h ${crown.height.toFixed(1)} m`);
            }
        }
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
    const PITCH = { 0.5: -0.25, 1: -0.5, 3: -0.32, 10: -0.16, 30: -0.2, 60: -0.22, 150: -0.12 };
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
    // `range=`: where the plants hand over (the meadow's own when not given).
    const rangeArg = cmdArgs.find((s) => s.startsWith('range='));
    const range = rangeArg ? +rangeArg.slice(6) : undefined;
    // The roller (the meadow's grass mover) is not a herb: out of these views.
    const rollerWas = roller.node.visible;
    roller.node.visible = false;
    const trees = () => [...grove.nodes, ...grove.presets.map((q) => q.node)];
    for (const time of skyList) {
        setup('gpu', wind, false);
        sky.apply(time);
        for (const n of trees()) n.visible = false;
        for (const name of names) {
            const p = name === 'meadow' ? { height: 0.5 } : bro.flora.herbPreset(name);
            if (!p) { console.log(`herbs: no ${name}`); continue; }
            // This species alone, wherever the meadow's herbs grow.
            g.setHerbs({ species: speciesOf(name), range });
            const shaded = [], flat = [], captions = [];
            // The near views frame a plant: the one nearest the meadow's
            // middle (for the meadow, its nearest flowering one, a different
            // species each run of views).
            step(1);
            const plants = g.herbPlants(at[0], at[1], 12);
            const flowering = name === 'meadow'
                ? plants.filter((q) => q.species !== MEADOW_HERBS.indexOf('clover')) : plants;
            const plant = flowering[0] || plants[0];
            for (const [d, pitch] of VIEWS) {
                const near = plant && d < 2;
                const ph = near && name === 'meadow' ? bro.flora.herbPreset(MEADOW_HERBS[plant.species]).height : p.height;
                // `aim=top`: the near views on the plant's top (its blooms).
                const aimY = cmdArgs.includes('aim=top') ? ph * 0.9 : Math.min(ph * 0.5, 0.45);
                const target = near ? [plant.x, plant.y + aimY, plant.z]
                    : [at[0], groundHeight(at[0], at[1]) + Math.min(p.height * 0.5, 0.4), at[1]];
                // From the bowl's middle out toward the hills (the eye stays
                // over the meadow).
                vp.reframe(target, d, { yaw: Math.PI - 0.3, pitch });
                step(1);
                flush();
                shaded.push(grab());
                captions.push(`${name} ${time} ${d} m (h ${p.height.toFixed(2)} m)`);
                if (cmdArgs.includes('perf')) {
                    // GPU ms of the view, and without the herbs: their cost.
                    const ms = () => {
                        for (let i = 0; i < 4; i++) { advanceTime(1000 / fps); }
                        perf.gpuFrameMs();
                        let s = 0;
                        for (let i = 0; i < 30; i++) { advanceTime(1000 / fps); s += perf.gpuFrameMs(); }
                        return s / 30;
                    };
                    const all = ms();
                    const st = g.grassStats();
                    g.setHerbs({ species: [] });
                    const none = ms();
                    g.setHerbs({ species: speciesOf(name), range });
                    console.log(`perf ${name} ${time} ${d} m: ${all.toFixed(3)} ms, herbs ${(all - none).toFixed(3)} ms ` +
                                `(herb instances ${st.herbInstances.join(' / ')})`);
                }
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
    roller.node.visible = rollerWas;
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

// The grass on the contrast floor (grove.js contrastFloor: the ground one
// flat pale sand, a capture option, not the look), so the blades read one
// by one: from each distance (m), at each sky, seen from the side (eye a
// little over the blades) and looking down about 45 degrees. One full
// frame each: <label>_<sky>_<side|down>_<d>m.png.
//   grassfloor [label=grassfloor] [skies=noon,golden] [dists=0.3,1,3,8,20] [floor=normal]
// (`floor=normal`: the same shots over the grove's own ground.)
function grassFloor() {
    const arg = (i, d) => (cmdArgs[i] && !cmdArgs[i].includes('=') ? cmdArgs[i] : d);
    const contrast = !cmdArgs.includes('floor=normal');
    const lab = arg(1, 'grassfloor');
    const skies = arg(2, 'noon,golden').split(',');
    const dists = arg(3, '0.3,1,3,8,20').split(',').map(Number);
    const at = [-1, 13.5], base = groundHeight(at[0], at[1]);
    const grassH = grove.grass.grassParams().height;
    const wasRolling = roller.running;
    roller.running = false;
    if (roller.node) roller.node.visible = false;
    if (contrast) contrastFloor(true);
    for (const time of skies) {
        setup('gpu', 'breeze', false);
        sky.apply(time);
        for (const d of dists) {
            for (const view of ['side', 'down']) {
                // Side: the eye just over the blade tops (lower near), looking
                // across; down: 45 degrees onto the ground.
                const side = view === 'side';
                const pitch = side ? -Math.min(0.35, Math.atan2(Math.min(grassH * 0.8, 0.25 * d), d) + 0.04) : -Math.PI / 4;
                const target = [at[0], base + (side ? grassH * 0.35 : 0), at[1]];
                vp.reframe(target, d, { yaw: 0.6, pitch });
                step(1);
                flush();
                const file = `${OUT}/${lab}_${time}_${view}_${d}m.png`;
                screenshot(file);
                console.log(file);
            }
        }
    }
    if (contrast) contrastFloor(false);
    if (roller.node) roller.node.visible = true;
    roller.running = wasRolling;
}

// The grass's look by distance, to find steps where its rings hand over
// (7, 20 and 55 m at the default range): from knee and eye height across the
// meadow four ways (the plants and herbs hidden, still air), each pixel's
// ground distance from its ray, and per 1 m band the mean colour (8-bit
// sRGB) and local contrast (mean |difference| to the right-hand neighbour).
// Each view is drawn at the node's range and at 1.3 times it, which moves
// the rings' edges out: over the ground between an edge and 1.3 times it the
// two draws differ only in the ring drawing it, so the terrain's own
// patches drop out. Printed per edge (with a control band inside it, where
// both draw the same ring): <label>_grassbands.json.
//   grassbands [label=grassbands] [skies=noon,golden]
function grassBands() {
    const arg = (i, d) => (cmdArgs[i] && !cmdArgs[i].includes('=') ? cmdArgs[i] : d);
    const lab = arg(1, 'grassbands');
    const skies = arg(2, 'noon,golden').split(',');
    const trees = () => [...grove.nodes, ...grove.presets.map((q) => q.node)];
    grove.grass.setHerbs({ species: [] });
    const wasRolling = roller.running;
    roller.running = false;
    if (roller.node) roller.node.visible = false;
    const W = innerWidth, H = innerHeight, MAXD = 70, S = 1.3;
    const range0 = grove.grass.grassParams().range;
    const edges = [7, 20, 55].map((e) => e * range0 / 150);
    const at = [-2, 15.5];   // the open meadow in front of the grove (the roller's loop)
    const views = [];
    for (const yaw of [0, 1.57, 3.14, 4.71]) {
        views.push({ name: `knee${yaw.toFixed(1)}`, h: 0.5, yaw, pitch: -0.07 });
        views.push({ name: `eye${yaw.toFixed(1)}`, h: 1.7, yaw, pitch: -0.12 });
    }
    // Per 1 m band of ground distance: summed colour and contrast.
    const measure = () => {
        flush();
        const img = frameImage();
        const top = img.height - H;
        const bins = new Array(MAXD).fill(0).map(() => ({ n: 0, r: 0, g: 0, b: 0, c: 0 }));
        const l = (q) => 0.2126 * img.data[q] + 0.7152 * img.data[q + 1] + 0.0722 * img.data[q + 2];
        for (let y = 0; y < H; y += 2) {
            for (let x = 0; x < W - 1; x += 2) {
                const ray = vp.ray(x + 0.5, y + 0.5);
                if (!ray || ray.dir[1] >= -1e-3) continue;
                // March to the ground: fixed-point on its height.
                let t = (ray.origin[1] - groundHeight(ray.origin[0], ray.origin[2])) / -ray.dir[1];
                for (let k = 0; k < 4; k++) {
                    const gx = ray.origin[0] + ray.dir[0] * t, gz = ray.origin[2] + ray.dir[2] * t;
                    t = (ray.origin[1] - groundHeight(gx, gz)) / -ray.dir[1];
                }
                const d = t * Math.hypot(ray.dir[0], ray.dir[2]);
                if (!(d >= 0) || d >= MAXD) continue;
                const o = ((y + top) * img.width + x) * 4;
                const bn = bins[Math.floor(d)];
                bn.n++; bn.r += img.data[o]; bn.g += img.data[o + 1]; bn.b += img.data[o + 2];
                bn.c += Math.abs(l(o) - l(o + 4));
            }
        }
        return bins;
    };
    const out = {};
    for (const time of skies) {
        setup('gpu', 'still', false);
        sky.apply(time);
        for (const n of trees()) n.visible = false;
        // Every view twice: at the node's range and at S times it (the rings'
        // edges moved out), summed over the views.
        const A = new Array(MAXD).fill(0).map(() => ({ n: 0, r: 0, g: 0, b: 0, c: 0 }));
        const B = new Array(MAXD).fill(0).map(() => ({ n: 0, r: 0, g: 0, b: 0, c: 0 }));
        const add = (to, from) => from.forEach((q, i) => { for (const k of ['n', 'r', 'g', 'b', 'c']) to[i][k] += q[k]; });
        for (const v of views) {
            // The eye `h` over the ground at `at` (an orbit of 0.01 m about it).
            vp.reframe([at[0], groundHeight(at[0], at[1]) + v.h, at[1]], 0.01, { yaw: v.yaw, pitch: v.pitch });
            grove.grass.setGrass({ range: range0 });
            step(0.5);
            add(A, measure());
            if (v.yaw === 0) screenshot(`${OUT}/${lab}_${time}_${v.name}.png`);
            grove.grass.setGrass({ range: range0 * S });
            step(0.5);
            add(B, measure());
        }
        grove.grass.setGrass({ range: range0 });
        const luma = (q) => (0.2126 * q.r + 0.7152 * q.g + 0.0722 * q.b) / q.n;
        const sum = (bins, a, b) => {
            const m = { n: 0, r: 0, g: 0, b: 0, c: 0 };
            for (let i = Math.max(0, Math.floor(a)); i < Math.min(MAXD, Math.ceil(b)); i++) for (const k in m) m[k] += bins[i][k];
            return m;
        };
        // In [e, S e) the node at its range draws the outer ring, at S its
        // range the inner: the difference there is the rings' difference.
        // Below e both draw the inner ring (the control: noise between two
        // renders).
        const res = [];
        console.log(`${time}: per 1 m band, luma at range / at ${S} x range (contrast)`);
        console.log('  ' + A.map((q, i) => (q.n < 200 ? null : `${i}:${luma(q).toFixed(0)}/${luma(B[i]).toFixed(0)} (${(q.c / q.n).toFixed(1)}/${(B[i].c / B[i].n).toFixed(1)})`)).filter(Boolean).join(' '));
        for (const e of edges) {
            const a = sum(A, e, S * e), b = sum(B, e, S * e);
            const ca = sum(A, 0.6 * e, e), cb = sum(B, 0.6 * e, e);
            if (a.n < 200 || ca.n < 200) continue;
            const r = {
                edge: e, outerLuma: luma(a), innerLuma: luma(b), lumaPct: 100 * (luma(a) - luma(b)) / luma(b),
                rgb: ['r', 'g', 'b'].map((k) => a[k] / a.n - b[k] / b.n),
                contrastPct: 100 * (a.c / a.n - b.c / b.n) / (b.c / b.n),
                controlLumaPct: 100 * (luma(ca) - luma(cb)) / luma(cb),
            };
            res.push(r);
            console.log(`  ring edge ${e.toFixed(0)} m: outer ring vs inner over the same ground: luma ${r.lumaPct >= 0 ? '+' : ''}${r.lumaPct.toFixed(1)}%, ` +
                        `rgb ${r.rgb.map((x) => x.toFixed(1)).join(',')}, contrast ${r.contrastPct >= 0 ? '+' : ''}${r.contrastPct.toFixed(1)}% ` +
                        `(control ${r.controlLumaPct >= 0 ? '+' : ''}${r.controlLumaPct.toFixed(1)}%)`);
        }
        out[time] = res;
    }
    grove.grass.setHerbs({ species: MEADOW_HERBS });
    for (const n of trees()) n.visible = true;
    if (roller.node) roller.node.visible = true;
    roller.running = wasRolling;
    require('fs').writeFileSync(`${OUT}/${lab}_grassbands.json`, JSON.stringify(out));
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
            for (let i = 0; i < 5; i++) { advanceTime(1000 / fps); }
            perf.gpuFrameMs();
            let sum = 0;
            for (let i = 0; i < n; i++) { advanceTime(1000 / fps); sum += perf.gpuFrameMs(); }
            ms[k] = sum / n;
        }
        show(true, true, true);
        const st = grove.grass.grassStats();
        console.log(`${s}: ${ms.all.toFixed(2)} ms, ${ms.noGrass.toFixed(2)} without grass (grass ${(ms.all - ms.noGrass).toFixed(2)}, ` +
                    `leaves ${(ms.noGrass - ms.noLeaves).toFixed(2)}, bark ${(ms.noLeaves - ms.bare).toFixed(2)}, rest ${ms.bare.toFixed(2)}); ` +
                    `grass instances ${st.instances.join(' / ')}`);
    }
}

// A preset alone, side on to the wind, at golden hour: still air, then the
// wind set at t = 0 and held (`strong`: a steady 12 m/s with small gusts),
// tiled over `seconds`. The cyan line is the plant's axis at rest, so the
// held lean, how the top bends over the stem and any bounce read from the
// tiles. <label>_<name>_leanstrip.png.
//   leanstrip <name> [label] [seconds=6] [frames=12] [wind=strong]
function leanStrip() {
    const name = shotsA, seconds = +(a3 || 6), frames = +(a4 || 12), wind = a5 || 'strong';
    const p = PRESET_PLANTS.find((q) => q.name === name);
    if (!p) { console.log(`leanstrip: no ${name}`); return; }
    setup('gpu', 'still', false);
    const W = innerWidth, H = innerHeight, FOV = vp.cam.fov || 45;
    const part = grove.presets.find((q) => q.rows.some((r) => r.plant === p));
    const row = part.rows.find((r) => r.plant === p);
    const h = row.height, base = groundHeight(p.x, p.z);
    const others = [...grove.nodes, ...grove.presets.map((q) => q.node), grove.grass];
    const was = new Map(others.map((n) => [n, n.visible]));
    for (const n of others) n.visible = n === part.node;
    part.node.setTrees(new Float32Array(row.row));
    const wd = WINDS[wind].wind.direction;
    const yaw = Math.atan2(wd[0], wd[2]) + Math.PI * 0.5;
    // The plant fills 80% of the view's height, its root at the centre.
    const eye = h / 0.8 / (2 * Math.tan(FOV * Math.PI / 360));
    vp.reframe([p.x, base + h * 0.5, p.z], eye, { yaw, pitch: 0 });
    step(2);
    const cols = Math.min(frames + 1, 7), rows = Math.ceil((frames + 1) / cols), gap = 4;
    const tw = Math.floor((W - gap * (cols + 1)) / cols);
    const th = Math.floor((H - gap * (rows + 1)) / rows);
    const crop = [0.5, 0.5, (H * 0.92 * tw / th) / W];
    const grabs = [];
    flush();
    grabs.push({ t: null, px: shrink(frameImage(), tw, th, crop) });
    setWind(wind);
    const dt = seconds / frames;
    for (let i = 1; i <= frames; i++) {
        step(dt);
        flush();
        grabs.push({ t: i * dt, px: shrink(frameImage(), tw, th, crop) });
    }
    const cv = document.createElement('canvas');
    cv.width = W; cv.height = H;
    cv.style.cssText = `position:absolute;left:0;top:0;width:${W}px;height:${H}px;z-index:10`;
    document.body.append(cv);
    const g = cv.getContext('2d');
    g.fillStyle = '#111';
    g.fillRect(0, 0, W, H);
    g.font = '600 12px system-ui';
    grabs.forEach((s, i) => {
        const x = gap + (i % cols) * (tw + gap), y = gap + Math.floor(i / cols) * (th + gap);
        const im = g.createImageData(tw, th);
        im.data.set(s.px);
        g.putImageData(im, x, y);
        g.fillStyle = 'rgba(0,255,255,0.7)';
        g.fillRect(x + Math.floor(tw / 2), y + 20, 1, th - 20);
        const txt = s.t === null ? `${name} still` : `${name} ${wind} t=${s.t.toFixed(1)}s`;
        g.fillStyle = '#000'; g.fillText(txt, x + 5, y + 15);
        g.fillStyle = '#fff'; g.fillText(txt, x + 4, y + 14);
    });
    advanceTime(30);
    flush();
    const file = `${OUT}/${label}_${name}_leanstrip.png`;
    screenshot(file);
    console.log(`${file}: ${name} (h ${h.toFixed(1)} m), still then ${wind}, ${frames} frames over ${seconds} s`);
    part.node.setTrees(new Float32Array(part.rows.flatMap((r) => r.row)));
    for (const [n, v] of was) n.visible = v;
}

// Several commands joined by `+` run one after another in this one boot,
// each from the page as the boot left it (any overlay removed; each sets
// its own path and wind); the virtual clock runs on between them.
const MODES = { strip, video, still: stills, perf: perfShots, species, herbs, swayprofile: swayProfile, grassfloor: grassFloor,
                grassbands: grassBands, foliage, leanstrip: leanStrip };
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
