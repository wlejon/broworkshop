// The frame rate in a real window: `bro demos/metropolis --bench`.
// Goes fullscreen, then shows each view (street and walk on the canyon road
// beside the most towers, the flyover, a 60 m/s low fly) by day and night for
// WARM + MEASURE seconds, logs `BENCH <time> <view>: fps, mean / p99 / max ms`
// from Date.now() in each frame's rAF (vsync is off in bro.json, so frames
// run unthrottled; `clock still` counts frames whose rAF time did not move),
// and closes the window.
import { riverCenterX, terrainHeight as g } from '../world/terrain_field.js';
import { massRecord } from '../../../lib/city/interior.js';

const WARM = 3, MEASURE = 12;

export async function run(m) {
    bro.window.fullscreen = true;
    document.getElementById('hud').hidden = true;
    const rx = riverCenterX(0);
    const D = m.city.masses.data, nM = D.length / 16, towers = [];
    for (let i = 0; i < nM; i++) { const M = massRecord(D, i); if (M.h > 40) towers.push(M); }
    let road = null, len = 0, bestScore = -1;
    for (const e of m.city.graph.edges) {
        if (e.kind === 'bridge') continue;
        const p = e.pts, n = p.length / 2, mx = p[(n >> 1) * 2], mz = p[(n >> 1) * 2 + 1];
        let l = 0; for (let i = 1; i < n; i++) l += Math.hypot(p[2 * i] - p[2 * i - 2], p[2 * i + 1] - p[2 * i - 1]);
        if (l < 150) continue;
        let score = 0;
        for (const M of towers) if (Math.abs(M.cx - mx) < 60 && Math.abs(M.cz - mz) < 60 && Math.hypot(M.cx - mx, M.cz - mz) < 40 + Math.max(M.hw, M.hd)) score++;
        if (score > bestScore) { bestScore = score; len = l; road = e; }
    }
    const along = (s0) => {
        s0 = ((s0 % len) + len) % len;
        const p = road.pts, n = p.length / 2;
        let acc = 0;
        for (let i = 1; i < n; i++) {
            const l = Math.hypot(p[2 * i] - p[2 * i - 2], p[2 * i + 1] - p[2 * i - 1]);
            if (acc + l >= s0 || i === n - 1) { const t = Math.min(1, (s0 - acc) / l); return [p[2 * i - 2] + (p[2 * i] - p[2 * i - 2]) * t, p[2 * i - 1] + (p[2 * i + 1] - p[2 * i - 1]) * t]; }
            acc += l;
        }
    };
    const roadView = (s0, h) => { const [x, z] = along(s0), [tx, tz] = along(s0 + 60); return [[x, g(x, z) + h, z], [tx, g(tx, tz) + h + 1, tz]]; };
    const views = {
        street: () => roadView(len * 0.3, 1.7),
        walk: (t) => roadView(len * 0.2 + t * 1.5, 1.7),
        flyover: () => [[rx + 300, 420, 900], [rx - 400, 0, 0]],
        fly: (t) => { const z = 600 - t * 60; return [[rx - 300, 60, z], [rx - 400, 30, z - 200]]; },
    };
    // --bench-probe: time the frame's update calls, report those over 4 ms.
    const slow = [];
    if (bro.app.argv.includes('--bench-probe')) {
        for (const [o, k] of [[m.terrain, 'terrain'], [m.cars, 'cars'], [m.sky, 'sky'], [m.interiors, 'interiors']]) {
            const f = o.update.bind(o);
            o.update = (...a) => { const t = Date.now(); const r = f(...a); const d = Date.now() - t; if (d > 4) slow.push(`${k} ${d}`); return r; };
        }
    }
    let view = null, t0 = 0, stamps = null, clocks = null;
    const loop = (now) => {
        if (view) { m.lookAt(...view((now - t0) / 1000)); stamps?.push(Date.now()); clocks?.push(now); }
        requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
    const wait = (s) => new Promise((r) => setTimeout(r, s * 1000));
    await wait(2);
    // --bench-view=day:fly runs that view alone; with BRO_CONTROL=1 each
    // view's flight-recorder summary (bro-ctl trace, --grant spawn) follows its
    // line, and with --bench-profile a native profile of its measured seconds
    // (bro-ctl profile: perf).
    const only = bro.app.argv.find((a) => a.startsWith('--bench-view='))?.slice(13);
    const cp = process.env.BRO_CONTROL ? require('child_process') : null;
    for (const tm of ['day', 'night']) {
        m.setTimeMode(tm);
        for (const [name, v] of Object.entries(views)) {
            if (only && only !== `${tm}:${name}`) continue;
            t0 = performance.now(); view = v; stamps = null;
            await wait(WARM);
            stamps = []; clocks = [];
            const prof = cp && bro.app.argv.includes('--bench-profile') ? new Promise((r) => cp.exec(`bro-ctl -s ${process.pid} profile ${MEASURE - 1} --top=45`, { maxBuffer: 1 << 22 }, (e, out) => r(e ? `bro-ctl profile: ${e.message}` : String(out)))) : null;
            await wait(MEASURE);
            const s = stamps, c = clocks; stamps = null; clocks = null;
            let still = 0; for (let i = 1; i < c.length; i++) if (c[i] === c[i - 1]) still++;
            const d = []; for (let i = 1; i < s.length; i++) d.push(s[i] - s[i - 1]);
            const mean = (s[s.length - 1] - s[0]) / d.length;
            d.sort((a, b) => a - b);
            console.log(`BENCH ${tm} ${name}: ${(1000 / mean).toFixed(0)} fps, mean ${mean.toFixed(2)} p99 ${d[Math.floor(d.length * 0.99)].toFixed(2)} max ${d[d.length - 1].toFixed(2)} ms, over 5 ms ${d.filter((x) => x > 5).length} over 10 ms ${d.filter((x) => x > 10).length}, clock still ${still} (${d.length} frames, ${innerWidth}x${innerHeight} @${devicePixelRatio})`);
            if (slow.length) { console.log(`SLOW ${slow.join(', ')}`); slow.length = 0; }
            // (async: bro-ctl is answered by this thread)
            if (prof) console.log(await prof);
            if (cp) console.log(await new Promise((r) => cp.exec(`bro-ctl -s ${process.pid} trace ${MEASURE} --worst=6`, (e, out) => r(e ? `bro-ctl trace: ${e.message}` : String(out)))));
        }
    }
    window.close();
}
