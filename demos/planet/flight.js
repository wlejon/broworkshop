// The flight: the eye lifts off at the ground shot's spot, climbs out of the
// air to `hmax=` (250 km) and comes down again to land downrange, a ship's
// path seen from its cockpit (no ship is drawn), flown as a player would
// see it: a frame every 1/30 s of the flight's clock, paced
// to the wall's, each shown as it is with whatever has come in (no frame
// waits for the scene to load). Its speeds are the ones descent.js measured
// the planet can be flown at with every frame's detail in, by height band
// (its "max speed" lines; `fast=` times them): what the flight records is
// whether that holds when nothing waits, the work still pending a frame
// and its GPU time.
//
// dur=<s> flies it in that many seconds instead, whatever the bands allow,
// out to hmax= 20,000 km by default (the whole planet in view) and back.
//
// bro-headless --grant files --width 1280 --height 720 demos/planet demos/planet/flight.js -- [tag=x] [dur=30] [fast=1] [hmax=250000] [from=s] [to=s] [sub=12] [capture=0] [passes=1]
//
// Out: captures/planet_flight<_tag>.webm; captures/planet_flight<_tag>.csv
// a row a frame: frame, time s, height m, ground speed m/s, climb m/s, wall
// ms, render GPU ms, the work pending (perf.pendingWork); and the log's
// summary by height band: the share of frames shown with work pending, by
// kind, and the GPU time.
//
// from=<s> to=<s>: only that part of the flight (its first view settled).
// capture=0: no video, its GPU times a player's (see CAPTURE); passes=1:
// the dearest passes on each second's line. inspect=change|normals|stats:
// each frame compared with the one before on the world (scene.inspectFrame:
// what rose, sank, appeared or vanished, surfaces whose shape or look
// changed in place, the camera's turn and roll), its numbers on the rows,
// the worst frames in the summary, and the change map or the normals as
// captures/planet_flight<_tag>_<kind>.webm. hold=1: the eye held at from='s
// view while the world's clock runs on to to=, the control for inspect=:
// whatever changes then is the world's own (wind, flicker, loading).
// track=auto: lift off under a weather system's margin and land at the
// ground shot, turning to its view on the way down. spot=auto: the landing
// moved to the most open spot near it, as the render sees it. The landing
// is expected from the first frame (scene.expect); expect=0 leaves it to
// the eye's own wants.
import { setShot, holdView, still, land, scene, R } from "/app/world.js";

const fs = require("fs");
const argv = (bro.app && bro.app.argv) || [];
const opt = (key, d) => {
    const a = argv.find((s) => typeof s === 'string' && s.startsWith(key + '='));
    return a ? a.slice(key.length + 1) : d;
};
const OUT = bro.resolvePath('/app/captures').replace(/\\/g, '/');
const tag = opt('tag') ? `_${opt('tag')}` : '';
const fps = 30, dt = 1 / fps;
const DUR = +opt('dur', 0);
const fast = +opt('fast', 1), HMAX = +opt('hmax', DUR > 0 ? 2e7 : 2.5e5), SUB = Math.max(1, Math.round(+opt('sub', 1)));
const PASSES = opt('passes', '0') !== '0';

const add = (a, b) => a.map((v, i) => v + b[i]);
const sub = (a, b) => a.map((v, i) => v - b[i]);
const mul = (a, s) => a.map((v) => v * s);
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const unit = (a) => mul(a, 1 / Math.hypot(a[0], a[1], a[2]));
const smooth = (e) => { e = Math.max(0, Math.min(1, e)); return e * e * (3 - 2 * e); };

document.body.classList.add('clean');
bro.menu.hide();
flush();
perf.settle({ maxFrames: 300, kinds: ['land processes'] });

// The speeds the descent measured (demos/planet/descent.js, its "max
// speed" by band, 2026-10-26): [height m, ground m/s, climb or descent m/s]
// at each band's middle, read between them on the logs.
const SPEEDS = [[30, 3.5, 21], [316, 3.5, 21], [3160, 67, 397], [31600, 260, 1500], [316000, 1100, 6200]];
function capAt(h) {
    const l = Math.log(Math.max(h, 1));
    if (h <= SPEEDS[0][0]) return [SPEEDS[0][1], SPEEDS[0][2]];
    for (let j = 1; j < SPEEDS.length; j++) {
        const a = SPEEDS[j - 1], b = SPEEDS[j];
        if (h <= b[0]) {
            const s = (l - Math.log(a[0])) / (Math.log(b[0]) - Math.log(a[0]));
            return [Math.exp(Math.log(a[1]) + s * (Math.log(b[1]) - Math.log(a[1]))),
                    Math.exp(Math.log(a[2]) + s * (Math.log(b[2]) - Math.log(a[2])))];
        }
    }
    const z = SPEEDS[SPEEDS.length - 1];
    return [z[1], z[2]];
}

// A climb out of `HMAX`'s air from the ground, by frame: the height and the
// ground covered. The eye rises straight up (none across under 150 m, all
// of the band's by 600 m), as fast as the band allows, slowing near the
// ground and near the top (0.4 of the height a second there, and no more
// than ACCEL's change a second).
const ACCEL = 25;
function climb() {
    const hs = [0], ss = [0];
    let h = 0, s = 0, v = 0;
    while (h < HMAX - 0.5) {
        const [g, c] = capAt(h);
        const want = Math.min(c * fast, 0.4 * h + 1.5, 0.4 * (HMAX - h) + 0.5);
        v = Math.min(want, v + ACCEL * dt);
        h = Math.min(HMAX, h + v * dt);
        s += g * fast * smooth((h - 150) / 450) * dt;
        hs.push(h);
        ss.push(s);
    }
    return { hs, ss };
}
// dur=<s>: the climb takes half of it whatever the bands allow, its eye's
// height (over 1.8 m) rising by the same ratio each moment, eased at the
// ground and at the top; forward at 0.3 of its height a second (none under
// 150 m, all by 600 m, at most 20 km/s).
function climbTimed() {
    const n = Math.max(2, Math.round(DUR / 2 * fps));
    const hs = [0], ss = [0];
    const l0 = Math.log(1.8), l1 = Math.log(HMAX + 1.8);
    let s = 0;
    for (let i = 1; i <= n; i++) {
        const u = i / n, e = u * u * u * (u * (6 * u - 15) + 10);
        const h = Math.exp(l0 + (l1 - l0) * e) - 1.8;
        s += Math.min(0.3 * h, 2e4) * smooth((h - 150) / 450) * dt;
        hs.push(h);
        ss.push(s);
    }
    // land=<km>: the landing that far downrange, the way beyond the climb's
    // own covered high up (over some 100 km, all of it over 1000 km), so
    // the ground near either end is flown as before.
    const LAND = landAt() * 1000;
    if (LAND > 2 * s) {
        const w = hs.map((h) => smooth((Math.log(Math.max(h, 1)) - Math.log(1e5)) / (Math.log(1e6) - Math.log(1e5))));
        const total = w.reduce((a, x) => a + x, 0) - w[0];
        const extra = (LAND / 2 - s) / total;
        let add_ = 0;
        for (let i = 1; i < ss.length; i++) {
            add_ += extra * w[i];
            ss[i] += add_;
        }
    }
    return { hs, ss };
}
// The ground shot's spot and its way, on the body: the lift-off, or with
// track=auto the landing.
setShot('ground');
const shot = unit(scene.toBody(still.view.eye));
const shotWay = (() => {
    const d = sub(scene.toBody(still.view.look), scene.toBody(still.view.eye));
    return unit(sub(d, mul(shot, dot(d, shot))));
})();

// The land's height over the datum under body direction `d` (the place
// frame's land, its curve included: anywhere on the body), under 0 at sea.
function aboveSea(d) {
    const p = scene.toPlace(mul([d[0], d[1], d[2]], R));
    const g = land.landHeight(p[0], p[2]);
    return Number.isFinite(g) ? g - p[1] : -1;
}

// A weather system's broken margin along a great circle from `from` set
// off along `dir`: the first point (1000 to 4000 km) where its slabs (the
// cover's share as world.js's deck reads it, smoothstep(0.2, 0.8, cover))
// are between 0.35 and 0.9 and little heaped (convect under 0.15), over
// land, over 10 km of track; [km, cover, convect], or null.
function marginAlong(from, dir) {
    // (The cover is baked a face a frame once the deck's shaders are in.)
    for (let k = 0; k < 2000 && !(scene.cloudStats() || {}).covered; k++) advanceTime(16);
    const ks = [];
    for (let km = 1000; km <= 4000; km += 5) ks.push(km);
    const dirs = new Float64Array(ks.length * 3);
    ks.forEach((km, i) => {
        const th = km * 1000 / R;
        dirs.set(add(mul(from, Math.cos(th)), mul(dir, Math.sin(th))), i * 3);
    });
    const c = scene.cloudCoverAt(dirs);
    if (!c) return null;
    const ok = ks.map((_, i) => {
        const share = smooth((c[i * 4] - 0.2) / 0.6);
        return share >= 0.35 && share <= 0.9 && c[i * 4 + 1] < 0.15 && aboveSea(dirs.subarray(i * 3, i * 3 + 3)) > 20;
    });
    for (let i = 0; i + 2 < ks.length; i++)
        if (ok.slice(i, i + 3).every(Boolean)) return [ks[i + 1], c[(i + 1) * 4], c[(i + 1) * 4 + 1]];
    return null;
}

// track=auto: the flight lifts off under a weather system's broken margin
// and lands at the ground shot, looking its way: of the bearings from the
// shot (every 5 degrees) whose great circle meets a margin, the one
// nearest straight behind it, so the landing's view is the shot's or near.
// land=auto: the ground shot's lift-off, landing at the first margin
// straight downrange.
let up0 = shot, way = shotWay, LAND_KM = +opt('land', 0) || 0, LAND_SHOT = false;
if (opt('track', '') === 'auto') {
    const side = cross3(shot, shotWay);
    let best = null;
    for (let b = 0; b < 360; b += 5) {
        const a = b * Math.PI / 180;
        const t = add(mul(shotWay, Math.cos(a)), mul(side, Math.sin(a)));
        const m = marginAlong(shot, t);
        const off = ((b - 180) % 360 + 360) % 360;
        const away = Math.min(off, 360 - off);
        if (m && (!best || away < best.away)) best = { b, t, m, away };
    }
    if (best) {
        const th = best.m[0] * 1000 / R;
        up0 = add(mul(shot, Math.cos(th)), mul(best.t, Math.sin(th)));
        way = unit(sub(shot, mul(up0, dot(shot, up0))));
        LAND_KM = best.m[0];
        LAND_SHOT = true;
        console.log(`flight: track=auto: lift-off ${best.m[0]} km from the ground shot at bearing ${best.b} (${best.away} off straight behind; cover ${best.m[1].toFixed(2)}, convect ${best.m[2].toFixed(2)}), landing at the shot`);
    } else {
        console.log('flight: track=auto: no broken margin within 4000 km of the shot');
    }
} else if (opt('land', '') === 'auto') {
    const m = marginAlong(shot, shotWay);
    LAND_KM = m ? m[0] : 0;
    console.log(m ? `flight: land=auto: ${m[0]} km downrange (cover ${m[1].toFixed(2)}, convect ${m[2].toFixed(2)})`
                  : 'flight: land=auto: no broken margin within 4000 km');
}
// spot=auto: the landing moved to the most open spot within 180 m of it,
// as the render sees it (scene.inspectFrame's median distance): straight
// down from 40 m, open ground reads 40 m and a wood's crowns 15 to 20, and
// at eye level along the shot's way, the further the view goes the better.
// Of the spots open overhead (a crown's leaves would fill the view the last
// second down), the one that sees furthest; none open, the most open.
if (opt('spot', '') === 'auto' && LAND_KM > 0) {
    const th = LAND_KM * 1000 / R;
    const E = add(mul(up0, Math.cos(th)), mul(way, Math.sin(th)));
    const fe = unit(sub(shotWay, mul(E, dot(shotWay, E)))), fn = cross3(E, fe);
    scene.setInspect(true);
    const probe = (d, eyeH, look, upB) => {
        const eyeB = mul(d, R + groundAt(d) + eyeH);
        show({ eye: scene.toPlace(eyeB), look: scene.toPlace(add(eyeB, mul(look, 100))), near: 0.1, far: 4e5,
               up: sub(scene.toPlace(add(eyeB, upB)), scene.toPlace(eyeB)) });
        for (let k = 0; k < 20; k++) advanceTime(16);
        const ins = scene.inspectFrame({});
        return ins ? +ins.medianDist : 0;
    };
    let best = null;
    for (let y = -180; y <= 180; y += 60) {
        for (let x = -180; x <= 180; x += 60) {
            const d = unit(add(E, mul(add(mul(fe, x), mul(fn, y)), 1 / R)));
            if (aboveSea(d) < 1) continue;
            const f = unit(sub(fe, mul(d, dot(fe, d))));
            const down = probe(d, 40, mul(d, -1), f);
            const p = -Math.PI / 180;   // (pitch(1.8)'s: a degree up)
            const ahead = probe(d, 1.8, add(mul(f, Math.cos(p)), mul(d, -Math.sin(p))), d);
            const open = Math.min(down / 38, 1);
            const score = open >= 1 ? 1e6 + ahead : open;
            if (!best || score > best.score) best = { d, x, y, down, ahead, score };
        }
    }
    scene.setInspect(false);
    if (best) {
        way = unit(sub(best.d, mul(up0, dot(best.d, up0))));
        LAND_KM = Math.acos(Math.min(1, dot(up0, best.d))) * R / 1000;
        console.log(`flight: spot=auto: landing ${best.x} m along, ${best.y} m across the shot's way: ${best.down.toFixed(0)} m clear under 40 m, ${best.ahead.toFixed(0)} m seen ahead`);
    }
}
function landAt() { return LAND_KM; }
const up = DUR > 0 ? climbTimed() : climb();
// The flight: the climb, then the same climb backwards down to the landing.
const N = 2 * (up.hs.length - 1) + 1;
const S = 2 * up.ss[up.ss.length - 1];
const flightAt0 = (i) => (i < up.hs.length ? { h: up.hs[i], s: up.ss[i] }
                                           : { h: up.hs[N - 1 - i], s: S - up.ss[N - 1 - i] });
// (Between frames too, for the engine frames a video frame is made of.)
const flightAt = (x) => {
    // (Within the flight: the first frame's engine frames before it are its own.)
    x = Math.max(0, Math.min(x, N - 1));
    const i = Math.floor(x), f = x - i;
    const a = flightAt0(i);
    if (f === 0) return a;
    const b = flightAt0(Math.min(i + 1, N - 1));
    return { h: a.h + f * (b.h - a.h), s: a.s + f * (b.s - a.s) };
};
console.log(`flight: ${N} frames (${(N / fps / 60).toFixed(1)} min) to ${(HMAX / 1000).toFixed(0)} km, ${(S / 1000).toFixed(0)} km downrange`);

// map=<km>: the weather's map about the flight (the clouds' cover as baked,
// scene.cloudCoverAt), azimuthal about the lift-off out to that many
// kilometres, downrange to the right: white and blue-grey the slabs (the
// fronts, the lows, the decks), yellow the heaps, brighter as their tops
// reach higher; the ground track red from the lift-off (green) to the
// landing (magenta), rings every 500 km. captures/planet_flight<_tag>_map.png.
function weatherMap(km) {
    const side = cross3(up0, way);
    const M = 800, Rm = km * 1000;
    const dirs = new Float64Array(M * M * 3);
    for (let y = 0; y < M; y++) {
        for (let x = 0; x < M; x++) {
            const mx = ((x + 0.5) / M * 2 - 1) * Rm, mz = (1 - (y + 0.5) / M * 2) * Rm;
            const d = Math.hypot(mx, mz), th = d / R;
            const t = d > 0 ? add(mul(way, mx / d), mul(side, mz / d)) : way;
            const v = add(mul(up0, Math.cos(th)), mul(t, Math.sin(th)));
            dirs.set(v, (y * M + x) * 3);
        }
    }
    const c = scene.cloudCoverAt(dirs);
    if (!c) { console.log('flight: map: the clouds\' cover is not baked'); return; }
    const px = new Uint8Array(M * M * 4);
    for (let i = 0; i < M * M; i++) {
        const cover = c[i * 4], conv = c[i * 4 + 1], tops = c[i * 4 + 2];
        const k = cover * (0.55 + 0.45 * tops);
        const col = [0.75 + 0.25 * conv, 0.82 + 0.03 * conv, 1.0 - 0.6 * conv];
        for (let j = 0; j < 3; j++) px[i * 4 + j] = Math.round(255 * Math.min(1, [0.05, 0.07, 0.14][j] * (1 - k) + col[j] * k));
        px[i * 4 + 3] = 255;
        const x = i % M, y = (i / M) | 0;
        const r = Math.hypot((x + 0.5) / M * 2 - 1, (y + 0.5) / M * 2 - 1) * km;
        if (Math.abs(r / 500 - Math.round(r / 500)) * 500 < km / M) for (let j = 0; j < 3; j++) px[i * 4 + j] = Math.min(255, px[i * 4 + j] + 40);
    }
    const dot_ = (mx, rgb, size) => {
        const x0 = Math.round((mx / Rm * 0.5 + 0.5) * M), y0 = M / 2;
        for (let dy = -size; dy <= size; dy++) for (let dx = -size; dx <= size; dx++) {
            const x = x0 + dx, y = y0 + dy;
            if (x >= 0 && x < M && y >= 0 && y < M) px.set(rgb, (y * M + x) * 4);
        }
    };
    for (let s = 0; s <= S; s += Math.max(S / 400, 1)) dot_(s, [255, 40, 40], 0);
    dot_(0, [40, 255, 60], 3);
    dot_(S, [255, 60, 255], 3);
    bro.image.encodePngFile(`${OUT}/planet_flight${tag}_map.png`, px, M, M, 4);
    console.log(`flight: map ${km} km about the lift-off, captures/planet_flight${tag}_map.png`);
}
function cross3(a, b) { return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]; }

// The ground (or the sea) under a body direction, over the datum (0 where
// the place's grid does not reach: high up, where it does not show).
function groundAt(radial) {
    const p = scene.toPlace(mul(radial, R));
    if (Math.hypot(p[0], p[2]) > 2e5) return 0;
    const g = land.landHeight(p[0], p[2]) + (p[0] ** 2 + p[2] ** 2) / (2 * R);
    return Number.isFinite(g) ? Math.max(g, 0) : 0;
}

// The view's pitch below level by height, as descent.js's: level near the
// ground, looking down more as the eye climbs.
const PITCH = [[1.8e7, 90], [1.2e6, 62], [9e4, 21], [1500, 3], [1.8, -1]];
function pitch(h) {
    const l = Math.log(Math.max(h, 1.8));
    for (let j = 1; j < PITCH.length; j++) {
        const a = PITCH[j - 1], b = PITCH[j];
        if (h >= b[0]) return (a[1] + (b[1] - a[1]) * smooth((Math.log(a[0]) - l) / (Math.log(a[0]) - Math.log(b[0])))) * Math.PI / 180;
    }
    return PITCH[PITCH.length - 1][1] * Math.PI / 180;
}

// Frame i: the eye on the path, looking on down its way, held in the place
// frame as it is now.
function frameAt(i) {
    const a = flightAt(i), b = flightAt(Math.min(i + 1, N - 1)), z = flightAt(Math.max(i - 1, 0));
    const th = a.s / R;
    const r = add(mul(up0, Math.cos(th)), mul(way, Math.sin(th)));
    let f = unit(sub(way, mul(r, dot(way, r))));
    // Landing at the shot, the view turns from the way to the shot's own
    // (about the eye's up, by the height's log from 3 km to 30 m), so the
    // flight ends in the view the ground shot is.
    if (LAND_SHOT && i > N / 2) {
        const fs = unit(sub(shotWay, mul(r, dot(shotWay, r))));
        const turn = Math.atan2(dot(cross3(f, fs), r), dot(f, fs));
        const k = smooth((Math.log(3000) - Math.log(Math.max(a.h, 1))) / (Math.log(3000) - Math.log(30)));
        f = add(mul(f, Math.cos(k * turn)), mul(cross3(r, f), Math.sin(k * turn)));
    }
    const eyeB = mul(r, R + groundAt(r) + a.h + 1.8);
    const p = pitch(a.h + 1.8);
    const look = add(mul(f, Math.cos(p)), mul(r, -Math.sin(p)));
    const eye = scene.toPlace(eyeB);
    const at = scene.toPlace(add(eyeB, mul(look, 100)));
    // The view's own up, square to the look at every pitch: the body's up
    // was the look's own line straight down at the top, and the view's roll
    // there undefined, spinning the planet about the screen's middle.
    const upB = add(mul(f, Math.sin(p)), mul(r, Math.cos(p)));
    const upP = sub(scene.toPlace(add(eyeB, upB)), scene.toPlace(eyeB));
    const horizon = Math.sqrt(2 * R * a.h + a.h ** 2);
    return {
        h: a.h, ground: (b.s - z.s) * fps / 2, climb: (b.h - z.h) * fps / 2,
        eye, look: at, up: upP, near: Math.max(0.1, Math.min(1e4, 0.01 * a.h)), far: Math.max(4e5, 4 * horizon + 4e5),
    };
}
function show(v) {
    holdView(v.eye, v.look, v.near, v.far, v.up);
}

const I0 = Math.max(0, Math.round(+opt('from', 0) * fps)), I1 = Math.min(N - 1, Math.round(+opt('to', N / fps) * fps));
const W = window.innerWidth, H = window.innerHeight;
// (capture=0: no video, every engine frame paced to the wall's clock as a
// player's at fps * sub. Encoding a frame takes the CPU a few hundred ms
// while the GPU waits, and the GPU drops to its idle clocks between frames
// (P8, 210 MHz on the 4090), so a captured run's GPU times are its clocks'
// as much as its work's, up to ten times a player's; only an uncaptured
// run's are a player's.)
const CAPTURE = opt('capture', '1') !== '0';
const enc = CAPTURE ? new VideoEncoder({ path: `${OUT}/planet_flight${tag}.webm`, width: W, height: H, fps, quality: opt('quality', 'good') }) : null;
// (inspect=, hold=: see the head.)
const HOLD = opt('hold', '0') !== '0';
const INSPECT = opt('inspect', '');
const INSPECT_IMAGE = INSPECT === 'change' || INSPECT === 'normals' ? INSPECT : null;
const encI = INSPECT_IMAGE ? new VideoEncoder({ path: `${OUT}/planet_flight${tag}_${INSPECT_IMAGE}.webm`, width: W, height: H, fps, quality: opt('quality', 'good') }) : null;
const INSPECT_COLS = ['same', 'rose', 'sank', 'appeared', 'vanished', 'newView', 'normalMoved', 'lumaMoved', 'skyLuma', 'turnDeg', 'rollDeg', 'travel', 'medianDist'];
const SLOT = 1000 / fps / SUB;
let due = 0;
function step() {
    advanceTime(SLOT);
    if (CAPTURE) return;
    const now = perf.now();
    due = Math.max(due + SLOT, now);
    if (due > now) wallSleep(due - now);
}
const rows = ['frame,t,height_m,ground_mps,climb_mps,wall_ms,render_gpu_ms,pending' + (INSPECT ? ',' + INSPECT_COLS.join(',') : '')];
// A frame's wall time by part: the engine frame, reading its GPU time,
// handing it to the encoder, asking what is pending.
const parts = [];
const log = [];
// (The first view settled: the flight starts with the pad's scene in. A
// flight from a later frame first runs the world's clock to it, a second
// at a time: the clouds drift with the wind, so a stretch of the flight
// shows the skies the whole flight would.)
show(frameAt(I0));
for (let s = I0 / fps; s > 0; s -= 1) advanceTime(1000 * Math.min(s, 1));
perf.settle({ maxFrames: 8000 });
perf.gpuFrameMs();
if (+opt('map', 0) > 0) weatherMap(+opt('map', 0));
if (INSPECT) scene.setInspect(true);
// The landing expected from the first frame (scene.expect): its ground made
// while the eye is high and wants little, as a ship's autopilot knows where
// it is going. expect=0: the eye's own wants alone.
const landing = opt('expect', '1') !== '0' && scene.expect
    ? scene.expect(scene.toBody(frameAt(N - 1).eye), { within: (N - 1 - I0) / fps }) : null;
let landingReady = -1;
const t00 = perf.now();
due = t00;
for (let i = I0; i <= I1; i++) {
    const t0 = perf.now();
    // Each video frame `sub` engine frames, so the world's services get the
    // frames a player at fps * sub would give them (12: 360 fps); the
    // render's GPU time the worst of them.
    let gpu = 0;
    for (let k = 1; k < SUB; k++) {
        show(frameAt(HOLD ? I0 : i - 1 + k / SUB));
        step();
        gpu = Math.max(gpu, perf.gpuFrameMs());
    }
    const v = frameAt(HOLD ? I0 : i);
    show(v);
    const ta = perf.now();
    step();
    const tb = perf.now();
    // (The capture draws the frame; its GPU time is then that render's.)
    if (CAPTURE) enc.addViewportFrame();
    const tc = perf.now();
    gpu = Math.max(gpu, perf.gpuFrameMs());
    const td = perf.now();
    const pending = perf.pendingWork();
    parts.push([tb - ta, td - tc, tc - tb, perf.now() - td]);
    // (After the frame's own timing: the comparison is the CPU's, seconds of
    // it at 1080p, and not the player's.)
    const ins = INSPECT ? scene.inspectFrame({ image: INSPECT_IMAGE }) : null;
    if (encI) {
        if (ins && ins.image) encI.addFrameRGBA(ins.image);
        else encI.addViewportFrame();
    }
    const wall = perf.now() - t0;
    // (Paced to the wall's clock: the scene's workers get a frame's time.)
    if (CAPTURE && wall < 1000 / fps) wallSleep(1000 / fps - wall);
    const row = [i, (i / fps).toFixed(3), v.h.toFixed(1), v.ground.toFixed(2), v.climb.toFixed(2), wall.toFixed(1), gpu.toFixed(2), `"${pending.join('; ')}"`];
    if (INSPECT) for (const k of INSPECT_COLS) row.push(ins && ins.compared ? (+ins[k]).toPrecision(4) : '');
    rows.push(row.join(','));
    log.push({ i, h: v.h, gpu, pending, wall, ins: ins && ins.compared ? ins : null });
    if (landing && landingReady < 0 && landing.ready) {
        landingReady = i;
        console.log(`flight: the landing's regions all made by ${(i / fps).toFixed(1)} s, the eye ${Math.round(v.h)} m up`);
    }
    if (i % fps === 0) {
        console.log(`flight ${i}/${N}: ${Math.round(v.h)} m, ${v.ground.toFixed(0)} m/s across, ${v.climb.toFixed(0)} m/s up, render ${gpu.toFixed(2)} ms GPU${pending.length ? `, pending ${pending.join('; ')}` : ''}, ${((perf.now() - t00) / 1000).toFixed(0)} s in`);
        if (PASSES) {
            const p = perf.gpuPasses();
            console.log('  passes ' + Object.entries(p).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([n, ms]) => `${n} ${ms.toFixed(2)}`).join(', '));
            const cs = scene.cullStats();
            console.log(`  world budget ${cs.worldBudgetMs.toFixed(2)} ms, spent ${cs.worldSpentMs.toFixed(2)}, ${cs.worldJobs} jobs, ${cs.worldQueued} queued, land fills ${cs.landFills}; ` +
                Object.entries(cs.worldKindMs || {}).map(([n, ms]) => `${n} ${ms.toFixed(3)}`).join(', '));
        }
    }
}
if (CAPTURE) {
    enc.finish();
    screenshot(`${OUT}/planet_flight${tag}_end.png`);
}
if (encI) encI.finish();
fs.writeFileSync(`${OUT}/planet_flight${tag}.csv`, rows.join('\n') + '\n');

// By height band: how many frames were shown with work pending, by kind,
// and the GPU's time.
const BANDS = [[1e5, Infinity], [1e4, 1e5], [1e3, 1e4], [100, 1e3], [10, 100], [0, 10]];
const fmt = (m) => (m >= 1000 ? `${(m / 1000).toFixed(m >= 1e5 ? 0 : 1)} km` : `${m.toFixed(m >= 10 ? 0 : 1)} m`);
// (A frame's wall time is what the scene's loaders had for it: more than
// 1/fps here, with the encoding, says how much the run flatters a player.)
const walls = log.map((x) => x.wall).sort((a, b) => a - b);
console.log(`flight: ${log.length} frames in ${((perf.now() - t00) / 1000).toFixed(0)} s (a frame's wall median ${walls[walls.length >> 1].toFixed(0)} ms, ${(1000 / fps).toFixed(0)} ms in real time); captures/planet_flight${tag}${CAPTURE ? '.webm, ' : '.'}csv` +
    (CAPTURE ? ' (GPU times at the clocks capture leaves the GPU: capture=0 for a player\'s)' : ''));
{
    const med = (k) => { const a = parts.map((p) => p[k]).sort((x, y) => x - y); return a[a.length >> 1].toFixed(1); };
    const mean = (k) => (parts.reduce((s, p) => s + p[k], 0) / parts.length).toFixed(1);
    console.log(`  a frame's wall by part, median / mean ms: engine frame ${med(0)} / ${mean(0)}, GPU time read ${med(1)} / ${mean(1)}, ` +
        `to the encoder ${med(2)} / ${mean(2)}, pending asked ${med(3)} / ${mean(3)}`);
}
if (INSPECT) {
    // The frames where the most of the world changed between two frames
    // that should not have: what moved (rose, sank, appeared, vanished),
    // surfaces whose shape or look changed in place, and the camera's own
    // turn and roll (a spin shows there, not in the world).
    const pct = (f) => `${(100 * f).toFixed(1)}%`;
    const worst = (key, label, n = 8) => {
        const xs = log.filter((x) => x.ins).sort((a, b) => key(b.ins) - key(a.ins)).slice(0, n);
        console.log(`  inspect, ${label}: ` + xs.map((x) => `${(x.i / fps).toFixed(2)} s (${fmt(x.h)}) ${pct(key(x.ins))}`).join(', '));
    };
    worst((s) => s.rose + s.sank + s.appeared + s.vanished, 'moved');
    worst((s) => s.same * s.normalMoved, 'shape changed in place');
    worst((s) => s.same * s.lumaMoved, 'look changed in place');
    worst((s) => s.sky * s.skyLuma, 'sky luma change');
    const turns = log.filter((x) => x.ins).sort((a, b) => Math.abs(b.ins.rollDeg) - Math.abs(a.ins.rollDeg)).slice(0, 5);
    console.log('  inspect, roll: ' + turns.map((x) => `${(x.i / fps).toFixed(2)} s ${x.ins.rollDeg.toFixed(2)} deg (turn ${x.ins.turnDeg.toFixed(2)})`).join(', '));
}
for (const [lo, hi] of BANDS) {
    const fs_ = log.filter((x) => x.h >= lo && x.h < hi);
    if (!fs_.length) continue;
    const kinds = {};
    for (const x of fs_) for (const p of x.pending) { const k = p.split(':')[0]; kinds[k] = (kinds[k] || 0) + 1; }
    const late = fs_.filter((x) => x.pending.length).length;
    const gpu = fs_.map((x) => x.gpu).sort((a, b) => a - b);
    console.log(`  ${fmt(lo).padStart(7)} - ${hi === Infinity ? 'top' : fmt(hi)}: ${fs_.length} frames, ${late} shown with work pending ` +
        `(${Object.entries(kinds).map(([k, n]) => `${k} ${n}`).join(', ') || 'none'}); render GPU median ${gpu[gpu.length >> 1].toFixed(2)} ms, worst ${gpu[gpu.length - 1].toFixed(2)}`);
}
