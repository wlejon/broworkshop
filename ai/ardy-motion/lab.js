// ARDY Motion — text to G1 humanoid motion, rendered as a live skeleton.
//
// Type a prompt, Generate: the worker encodes it with LLM2Vec, rolls out the
// ARDY autoregressive diffusion motion model and returns per-frame world
// joint positions for the 34-joint Unitree G1 (bro.motion). The skeleton is
// drawn position-only (joint spheres + beads interpolated along each bone),
// so every node is placed straight from the positions the engine's forward
// kinematics produced, and the clip plays back at its native 25 fps.

import { boot } from "/lib/kit/app.js";
import { ids, clear, h } from "/lib/kit/dom.js";
import { deviceBadge, modelRow } from "/lib/kit/ml.js";
import { sceneViewport, Camera } from "/lib/kit/viewport3d.js";
import { workerClient } from "/lib/kit/worker-rpc.js";

export const ARDY = ['brodiffusion/weights/ardy-g152'];
export const LLM2VEC = ['brolm/weights/llm2vec-llama3-8b'];
const BEADS_PER_BONE = 4;

/** Live app state (tests read it). */
export const lab = {
    ready: false,       // pipeline loaded in the worker
    device: '',
    busy: false,        // a load or generate is in flight
    clip: null,         // last clip { frames, joints, fps, positions, parents, footContacts }
    frame: 0,           // shown frame
    playing: false,
    joints: [],         // joint sphere nodes
    bones: [],          // { a, c, beads: [node] }
    clips: 0,           // clips received
    error: '',
    ui: null,
};

export function start() {
    const { status } = boot();
    const badge = deviceBadge('#device');
    const el = ids('prompt', 'chips', 'frames', 'cfg', 'steps', 'seed', 'random-seed', 'gen', 'play',
                   'auto-orbit', 'feet', 'scrub', 'frame', 'clip-info');
    const vp = sceneViewport('#view', {
        orbit: { target: [0, 0.9, 0], dist: 4.2, fov: 45 },
        controls: { orbitButton: 0, panButton: 1, minDist: 1.5, maxDist: 14 },
    });
    const scene = vp.scene;
    scene.setAmbient([0.24, 0.25, 0.30]);
    scene.createLight({ type: 'directional', direction: [-0.4, -1.0, -0.55], intensity: 2.4, color: [1.0, 0.98, 0.94] });
    scene.createLight({ type: 'directional', direction: [0.6, -0.35, 0.5], intensity: 0.7, color: [0.68, 0.78, 1.0] });
    scene.setToneMap({ mode: 'aces', exposure: 1.1 });
    scene.createMesh({ mesh: 'plane', halfW: 8, halfD: 8, y: 0, color: [0.14, 0.15, 0.19], roughness: 0.96, metallic: 0 });

    const off = { x: 0, y: 0, z: 0 };
    let playT = 0;
    const rpc = workerClient('motion-worker.js');

    const row = modelRow('#model-bar', {
        fields: [
            { id: 'ardy-dir', label: 'motion', what: 'ARDY G1 motion model', candidates: ARDY, probe: 'config.yaml', width: 320 },
            { id: 'enc-dir', label: 'text encoder', what: 'LLM2Vec-Llama3-8B', candidates: LLM2VEC, width: 320 },
        ],
        onLoad: ([checkpoint, textEncoder]) => load(checkpoint, textEncoder),
        onMissing: (m) => { lab.error = m; status.error(m); },
    });

    function refresh() {
        el.gen.disabled = !lab.ready || lab.busy;
        el.play.disabled = !lab.clip;
        el.play.textContent = lab.playing ? 'Pause' : 'Play';
        el.scrub.disabled = !lab.clip;
    }

    async function load(checkpoint, textEncoder) {
        lab.ready = false; lab.busy = true; lab.error = '';
        row.busy(true); row.meta('');
        refresh();
        status.busy('loading text encoder + motion model… (an 8B encoder: the first load is slow)');
        try {
            await rpc.ready;
            const r = await rpc.request({ type: 'load', checkpoint, textEncoder, device: 'cuda' });
            lab.ready = true;
            lab.device = r.device || '';
            if (lab.device) badge.set(lab.device);
            row.meta('ready · ' + lab.device);
            status.ok('ready · type a prompt and Generate');
        } catch (e) {
            lab.error = 'load failed: ' + e.message;
            status.error(lab.error);
        }
        lab.busy = false;
        row.busy(false);
        refresh();
    }

    async function generate() {
        if (!lab.ready || lab.busy) return;
        const text = el.prompt.value.trim();
        if (!text) { status.error('type a prompt'); return; }
        if (el.randomSeed.checked) el.seed.value = String((Math.random() * 1e9) | 0);
        const opts = {
            frames: parseInt(el.frames.value, 10) || 104,
            steps: parseInt(el.steps.value, 10) || 10,
            cfg: parseFloat(el.cfg.value) || 2.5,
            seed: parseInt(el.seed.value, 10) || 0,
        };
        lab.busy = true; lab.playing = false; lab.error = '';
        refresh();
        status.busy('generating ' + opts.frames + ' frames…');
        try {
            const r = await rpc.request({ type: 'generate', text, opts });
            showClip(r.clip, text, opts, r.ms);
        } catch (e) {
            lab.error = 'generate failed: ' + e.message;
            status.error(lab.error);
        }
        lab.busy = false;
        refresh();
    }

    // ── skeleton ─────────────────────────────────────────────────────────
    function buildSkeleton(J, parents) {
        for (const n of lab.joints) n.destroy();
        for (const b of lab.bones) for (const n of b.beads) n.destroy();
        lab.joints = []; lab.bones = [];
        for (let j = 0; j < J; j++) {
            lab.joints.push(scene.createMesh({ mesh: 'sphere', radius: 0.035, segments: 12, rings: 8,
                                               color: [0.98, 0.56, 0.16], roughness: 0.5, emissive: 0.12 }));
        }
        for (let j = 0; j < J; j++) {
            if (parents[j] < 0) continue;
            const beads = [];
            for (let k = 0; k < BEADS_PER_BONE; k++) {
                beads.push(scene.createMesh({ mesh: 'sphere', radius: 0.022, segments: 8, rings: 6,
                                              color: [0.55, 0.70, 0.98], roughness: 0.6 }));
            }
            lab.bones.push({ a: parents[j], c: j, beads });
        }
    }

    // Centre the walk horizontally, drop the feet onto the floor, and frame on
    // the figure's height (not its drift) so the humanoid fills the view.
    function frameClip() {
        const P = lab.clip.positions, n = (P.length / 3) | 0;
        const mn = [1e9, 1e9, 1e9], mx = [-1e9, -1e9, -1e9];
        for (let i = 0; i < n; i++) for (let a = 0; a < 3; a++) {
            const v = P[i * 3 + a];
            if (v < mn[a]) mn[a] = v;
            if (v > mx[a]) mx[a] = v;
        }
        off.x = -(mn[0] + mx[0]) / 2; off.y = -mn[1]; off.z = -(mn[2] + mx[2]) / 2;
        const height = Math.max(0.5, mx[1] - mn[1]);
        vp.reframe([0, height * 0.5, 0], Math.max(2.4, height * 2.2));
    }

    function pose(f) {
        const c = lab.clip, J = c.joints, P = c.positions, base = f * J * 3;
        const gp = (j) => [P[base + j * 3] + off.x, P[base + j * 3 + 1] + off.y, P[base + j * 3 + 2] + off.z];
        for (let j = 0; j < J; j++) {
            const q = gp(j), nd = lab.joints[j];
            nd.x = q[0]; nd.y = q[1]; nd.z = q[2];
        }
        for (const b of lab.bones) {
            const a = gp(b.a), e = gp(b.c), m = b.beads.length;
            for (let k = 0; k < m; k++) {
                const t = (k + 1) / (m + 1), nd = b.beads[k];
                nd.x = a[0] + (e[0] - a[0]) * t; nd.y = a[1] + (e[1] - a[1]) * t; nd.z = a[2] + (e[2] - a[2]) * t;
            }
        }
        lab.frame = f;
        el.frame.textContent = (f + 1) + ' / ' + c.frames;
        if (+el.scrub.value !== f) el.scrub.value = String(f);
        if (el.feet.checked && c.footContacts) {
            const fc = c.footContacts, on = (i) => fc[f * 4 + i] > 0.5;
            contactsEl.textContent = 'L ' + (on(0) || on(1) ? '●' : '○') + '   R ' + (on(2) || on(3) ? '●' : '○');
        } else contactsEl.textContent = '—';
    }

    let contactsEl = null;
    function showClip(c, text, opts, ms) {
        lab.clip = c;
        lab.clips++;
        buildSkeleton(c.joints, c.parents);
        frameClip();
        el.scrub.max = String(c.frames - 1);
        clear(el.clipInfo);
        const kv = (k, v) => h('div', null, h('span', null, k), h('b', null, v));
        contactsEl = h('b', null, '—');
        for (const n of [
            kv('prompt', text.length > 28 ? text.slice(0, 27) + '…' : text),
            kv('frames', c.frames + ' @ ' + c.fps + ' fps (' + (c.frames / c.fps).toFixed(1) + ' s)'),
            kv('joints', String(c.joints)),
            kv('seed · cfg · steps', opts.seed + ' · ' + opts.cfg + ' · ' + opts.steps),
            kv('generated in', (ms / 1000).toFixed(1) + ' s'),
            h('div', null, h('span', null, 'foot contact'), contactsEl),
        ]) el.clipInfo.appendChild(n);
        playT = 0;
        pose(0);
        lab.playing = true;
        status.ok('playing · ' + c.frames + ' frames @ ' + c.fps + ' fps');
    }

    vp.onFrame((dt) => {
        if (el.autoOrbit.checked && !(vp.controls && vp.controls.dragging)) Camera.orbitLook(vp.cam, -(0.30 * dt) / vp.cam.yawSpeed, 0);
        if (lab.playing && lab.clip) {
            playT += dt * lab.clip.fps;
            const f = Math.floor(playT) % lab.clip.frames;
            if (f !== lab.frame) pose(f);
        }
    });

    // ── wiring ───────────────────────────────────────────────────────────
    el.gen.onclick = generate;
    el.prompt.addEventListener('keydown', (e) => { if (e.key === 'Enter') generate(); });
    for (const b of el.chips.querySelectorAll('button')) {
        b.onclick = () => { el.prompt.value = b.textContent; generate(); };
    }
    el.play.onclick = () => {
        if (!lab.clip) return;
        lab.playing = !lab.playing;
        playT = lab.frame;
        refresh();
    };
    el.scrub.addEventListener('input', () => {
        if (!lab.clip) return;
        lab.playing = false;
        playT = +el.scrub.value;
        pose(+el.scrub.value);
        refresh();
    });
    el.feet.addEventListener('change', () => { if (lab.clip) pose(lab.frame); });

    lab.ui = { status, row, badge, vp, rpc, generate, pose };
    refresh();
    status.busy('starting worker…');
    row.autoLoad();
}
