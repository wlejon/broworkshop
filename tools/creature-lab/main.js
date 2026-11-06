// Creature Lab, live: a scenario run once on the GPU (the same recording
// the sheets read) and played back through the creature's batch mesh, with
// a scrub bar, playback speed, an orbit camera (right-drag orbit, middle-drag
// pan, wheel zoom), a second version beside it for A/B, the run's metric
// flags, and any sheet of the shown runs, drawn on demand.
//
// globalThis.creatureLab drives it from a headless test: load(), setTime(),
// state, dispose().

import { sceneViewport } from "/lib/kit/viewport3d.js";
import { loadCreature, appPath } from "./lab/creature.js";
import { runScenario, groundHeights } from "./lab/run.js";
import { scenariosFor } from "./lab/scenarios.js";
import { drawBatch } from "./lab/batch.js";
import { ROWS } from "./lab/skeleton.js";
import { T, TELE } from "./lab/contract.js";
import { analyzeRun, sheet } from "./lab/commands.js";

const fs = require('fs');
const $ = (id) => document.getElementById(id);

// Specs on offer: every creature entry, each of its variants, and snapshots.
function specs() {
    const out = [];
    for (const f of fs.readdirSync(appPath('creatures')).sort()) if (f.endsWith('.js')) out.push(f.slice(0, -3));
    return out;
}

const vp = sceneViewport('#view', { orbit: { target: [0, 0.8, 0], dist: 4.2, near: 0.05, far: 400 } });
const scene = vp.scene;
scene.setAmbient({ color: [0.85, 0.9, 1.0], intensity: 0.45 });
const sun = scene.createLight({ type: 'directional', direction: [0.4, -0.8, 0.45], intensity: 2.4, castShadow: true });

const S = {
    runs: [],          // [{ creature, rec, poseBuf, node, offset }]
    ground: null,
    t: 0, playing: true, speed: 1, steps: 0, dt: 1 / 120,
    scenario: 'walk', specA: 'deer', specB: '', show: 'a',
    disposed: false,
    sheet: null,       // the sheet last opened: { width, height, png, canvas, ... }
};

function status(s) { $('status').textContent = s; }

function clearRuns() {
    for (const r of S.runs) { try { r.node.destroy(); } catch (_) { r.node.visible = false; } r.poseBuf.destroy(); }
    S.runs = [];
    if (S.ground) { try { S.ground.destroy(); } catch (_) { S.ground.visible = false; } S.ground = null; }
}

// The ground the run crossed: one heightfield over its path, a 0.5 m checker.
function groundMesh(rec) {
    let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
    for (let k = 0; k < rec.steps; k++) {
        const x = rec.tele[k * TELE + T.POS], z = rec.tele[k * TELE + T.POS + 2];
        x0 = Math.min(x0, x); x1 = Math.max(x1, x); z0 = Math.min(z0, z); z1 = Math.max(z1, z);
    }
    const m = 4, st = 0.25;
    x0 -= m; x1 += m; z0 -= m; z1 += m;
    const nx = Math.ceil((x1 - x0) / st), nz = Math.ceil((z1 - z0) / st);
    const xz = new Float32Array((nx + 1) * (nz + 1) * 2);
    for (let j = 0; j <= nz; j++) for (let i = 0; i <= nx; i++) { const q = 2 * (j * (nx + 1) + i); xz[q] = x0 + i * st; xz[q + 1] = z0 + j * st; }
    const h = groundHeights(rec.env, xz);
    const pos = [], nrm = [], col = [], idx = [];
    for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
        const P = (a, b) => [x0 + (i + a) * st, h[(j + b) * (nx + 1) + i + a], z0 + (j + b) * st];
        const q = [P(0, 0), P(1, 0), P(1, 1), P(0, 1)];
        const ax = q[1].map((v, c) => v - q[0][c]), az = q[3].map((v, c) => v - q[0][c]);
        let n = [az[1] * ax[2] - az[2] * ax[1], az[2] * ax[0] - az[0] * ax[2], az[0] * ax[1] - az[1] * ax[0]];
        const l = Math.hypot(...n) || 1;
        n = n.map((v) => (n[1] < 0 ? -v : v) / l);
        const c = (Math.floor((x0 + i * st) / 0.5 + 1000) + Math.floor((z0 + j * st) / 0.5 + 1000)) % 2 ? 0.30 : 0.22;
        const b = pos.length / 3;
        for (const p of q) { pos.push(...p); nrm.push(...n); col.push(c * 0.95, c, c * 0.85, 1); }
        idx.push(b, b + 2, b + 1, b, b + 3, b + 2);
    }
    return new Mesh({ positions: new Float32Array(pos), normals: new Float32Array(nrm), colors: new Float32Array(col), indices: new Uint32Array(idx) });
}

async function load(specA = S.specA, specB = S.specB, scenario = S.scenario) {
    clearRuns();
    S.specA = specA; S.specB = specB; S.scenario = scenario;
    $('specA').value = specA; $('specB').value = specB; $('scenario').value = scenario;
    status(`running ${scenario}...`);
    const list = [specA, ...(specB ? [specB] : [])];
    const flags = [];
    for (let i = 0; i < list.length; i++) {
        const creature = await loadCreature(list[i]);
        const rec = runScenario(creature, scenario);
        const nb = creature.skel.count;
        const poseBuf = bro.kernel.createBuffer(nb * ROWS * 4);
        // B stands 1.2 m to A's left (its own ground under it is the same ground).
        const offset = i === 0 ? 0 : 1.2;
        const row = new Float32Array([1, 0, 0, offset, 0, 1, 0, 0, 0, 0, 1, 0, 1, 1, 1, 1]);
        const node = drawBatch(scene, creature, poseBuf, 1, { rows: row, shadows: true });
        S.runs.push({ creature, rec, poseBuf, node, offset });
        const r = analyzeRun(rec);
        flags.push(`${list[i]}: ${r.flags.length ? r.flags.map((f) => '- ' + f).join('\n') : 'clean'}`);
    }
    S.ground = scene.createMesh({ mesh: groundMesh(S.runs[0].rec), color: [1, 1, 1], vertexColorTint: true, roughness: 1, castsShadow: false });
    S.steps = S.runs[0].rec.steps;
    S.dt = S.runs[0].rec.dt;
    $('scrub').max = String(S.steps - 1);
    $('flags').textContent = flags.join('\n\n');
    $('sub').textContent = `${list.join(' vs ')} · ${scenario} · ${scenariosFor(S.runs[0].creature)[scenario].about || ''}`;
    setTime(0);
    applyShow();
    status(`${scenario}: ${S.steps} steps, ${(S.steps * S.dt).toFixed(1)} s`);
}

function applyShow() {
    S.runs.forEach((r, i) => { r.node.visible = S.show === 'ab' || (S.show === 'a' ? i === 0 : i === 1); });
}

function setTime(t) {
    if (!S.runs.length) return;
    S.t = Math.max(0, Math.min(t, (S.steps - 1) * S.dt));
    const k = Math.min(S.steps - 1, Math.round(S.t / S.dt));
    for (const r of S.runs) {
        const n = r.creature.skel.count * ROWS;
        r.poseBuf.write(r.rec.pose.subarray(k * n, (k + 1) * n));
    }
    $('scrub').value = String(k);
    $('tval').textContent = `${S.t.toFixed(2)} s`;
    if ($('follow').checked) {
        const rec = S.runs[0].rec;
        const p = [rec.tele[k * TELE + T.POS] + (S.show === 'ab' ? 0.6 : S.show === 'b' ? 1.2 : 0), rec.tele[k * TELE + T.POS + 1], rec.tele[k * TELE + T.POS + 2]];
        vp.reframe([p[0], p[1] - 0.1, p[2]], vp.cam.dist);
    }
}

vp.onFrame((dt) => {
    if (S.disposed || !S.runs.length || !S.playing) return;
    let t = S.t + dt * S.speed;
    if (t > (S.steps - 1) * S.dt) t = 0;
    setTime(t);
});

// The sheet of the shown run (both, A/B, when both show), drawn now from the
// runs on screen: the same code and recording cli.js draws from.
function openSheet() {
    const kind = $('kind').value;
    const runs = S.show === 'ab' ? S.runs : S.runs.filter((_, i) => (S.show === 'b' ? i === 1 : i === 0));
    const body = $('sheetBody');
    try {
        const t0 = Date.now();
        const s = sheet(kind, runs.map((r) => r.rec), null);
        S.sheet = s;
        const img = document.createElement('img');
        img.src = URL.createObjectURL(new Blob([s.png], { type: 'image/png' }));
        body.replaceChildren(img);
        status(`${kind} sheet: ${s.width}x${s.height} in ${Date.now() - t0} ms`);
    } catch (e) {
        const p = document.createElement('div');
        p.className = 'note';
        p.textContent = `the ${kind} sheet failed: ${e.message}`;
        body.replaceChildren(p);
    }
    $('sheet').classList.add('open');
}

// --- controls -----------------------------------------------------------------
function fill(sel, items, value) {
    sel.innerHTML = '';
    for (const it of items) { const o = document.createElement('option'); o.value = it; o.textContent = it || '(none)'; sel.append(o); }
    sel.value = value;
}

async function init() {
    const sp = specs();
    const first = await loadCreature(S.specA);
    const variants = Object.keys(first.def.variants || {}).map((v) => `${S.specA}:${v}`);
    fill($('specA'), [...sp, ...variants], S.specA);
    fill($('specB'), ['', ...sp, ...variants], S.specB);
    fill($('scenario'), Object.keys(scenariosFor(first)), S.scenario);
    $('specA').onchange = () => load($('specA').value, S.specB, S.scenario);
    $('specB').onchange = () => { S.show = $('specB').value ? 'ab' : 'a'; $('show').value = S.show; load(S.specA, $('specB').value, S.scenario); };
    $('show').onchange = () => { S.show = $('show').value; applyShow(); };
    $('scenario').onchange = () => load(S.specA, S.specB, $('scenario').value);
    $('play').onclick = () => { S.playing = !S.playing; $('play').textContent = S.playing ? 'pause' : 'play'; };
    $('restart').onclick = () => setTime(0);
    $('scrub').oninput = () => { S.playing = false; $('play').textContent = 'play'; setTime(+$('scrub').value * S.dt); };
    $('speed').oninput = () => { S.speed = +$('speed').value; $('sval').textContent = `${S.speed.toFixed(2)}x`; };
    $('open').onclick = openSheet;
    $('close').onclick = () => $('sheet').classList.remove('open');
    await load();
}

globalThis.creatureLab = {
    state: S, load, setTime, applyShow, openSheet,
    setShow(v) { S.show = v; $('show').value = v; applyShow(); },
    dispose() {
        S.disposed = true;
        clearRuns();
        try { sun.destroy(); } catch (_) { /* gone with the page */ }
        globalThis.creatureLab = null;
    },
    ready: null,
    // Build the controls and load the first run (once).
    start() {
        if (!this.ready) this.ready = init().catch((e) => { status(`error: ${e.message}`); throw e; });
        return this.ready;
    },
};
// Windowed it starts at once. Headless it waits for start(): a cli.js run
// (which takes the page over for its sheets) pays nothing for the live view.
// (A window installs the headless globals too, for its self-tests, so the
// display mode is what tells them apart.)
if (bro.window.displayMode !== 'headless') globalThis.creatureLab.start();
else status('headless: creatureLab.start() loads the live view');
