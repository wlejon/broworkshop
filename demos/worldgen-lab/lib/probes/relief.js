// ═══ PROBE: relief — the elevation product as ground, not a map ══════════════
//
// The other probes draw the pipeline; this one draws the WORLD. It runs the full
// elevation() (all three nets) over the region and shows it three ways: a lit 3D
// heightfield you can orbit, the hypsometry (how much of the patch is ocean /
// lowland / mountain), and a cross-section through the middle. Elevation() is the
// heavy path — seconds per tile — so the request is capped and reported.

import "/lib/camera.js";                                   // installs global Camera
import { state, status } from "/app/lib/core.js";
import { el, mkRange } from "/app/lib/helpers.js";
import { registerProbe } from "/app/lib/registry.js";

const REQ_CAP = 320;           // native cells per axis — keep elevation() tractable
const MESH_N  = 160;           // heightfield grid resolution (downsampled)
const SPAN    = 200;           // world units the patch spans, for the orbit camera

// A terrain ramp in JS (the GPU LUT object is opaque), matching core.js's stops so
// the 3D surface and the 2D fields read the same. t is normalised elevation.
function terrainColor(t) {
    const stops = [
        [0.00,  12,  34,  74], [0.42, 28,  92, 140], [0.48, 232, 220, 156],
        [0.55,  96, 165,  92], [0.72, 74, 110,  70], [0.86, 150, 140, 128],
        [1.00, 252, 252, 252],
    ];
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    for (let i = 0; i < stops.length - 1; i++) {
        const a = stops[i], b = stops[i + 1];
        if (t <= b[0]) {
            const f = (t - a[0]) / (b[0] - a[0] || 1);
            return [(a[1] + (b[1] - a[1]) * f) / 255,
                    (a[2] + (b[2] - a[2]) * f) / 255,
                    (a[3] + (b[3] - a[3]) * f) / 255];
        }
    }
    return [1, 1, 1];
}

registerProbe({
    id: 'relief',
    name: 'Relief',
    blurb: 'The full elevation() output — every net in series — as a lit, orbitable 3D surface, its hypsometry, and a cross-section. Drag to orbit, wheel to zoom. This is the heavy path; a big extent is slow.',

    build(mount) {
        const h = { vexag: 2.0, node: null, sea: null, drag: null, auto: false, res: null };

        const bar = el('div', 'probe-bar');
        mkRange(bar, 'vertical ×', h.vexag, 0.5, 6, 0.5, (v) => { h.vexag = v; if (h.res) rebuildMesh(h); }, (v) => v.toFixed(1));
        const autoBtn = el('button', 'btn', '⟲ spin');
        autoBtn.onclick = () => { h.auto = !h.auto; autoBtn.classList.toggle('on', h.auto); };
        bar.appendChild(autoBtn);
        h.info = el('span', 'meta'); bar.appendChild(h.info);
        mount.appendChild(bar);

        const body = el('div', 'relief-body');

        // 3D
        const view = el('div', 'card grow');
        view.appendChild(el('div', 'card-title', '3D heightfield'));
        const vwrap = el('div', 'canvas-wrap fill');
        h.canvas = document.createElement('canvas');
        vwrap.appendChild(h.canvas);
        view.appendChild(vwrap);
        body.appendChild(view);

        // side: hypsometry + profile
        const side = el('div', 'relief-side');
        const hcard = el('div', 'card');
        hcard.appendChild(el('div', 'card-title', 'hypsometry'));
        h.hypso = document.createElement('canvas'); h.hypso.width = 300; h.hypso.height = 150;
        hcard.appendChild(h.hypso);
        h.hypNote = el('div', 'card-note'); hcard.appendChild(h.hypNote);
        side.appendChild(hcard);
        const pcard = el('div', 'card');
        pcard.appendChild(el('div', 'card-title', 'cross-section (mid row)'));
        h.profile = document.createElement('canvas'); h.profile.width = 300; h.profile.height = 150;
        pcard.appendChild(h.profile);
        side.appendChild(pcard);
        body.appendChild(side);

        mount.appendChild(body);

        // scene
        h.scene = h.canvas.getContext('scene');
        h.scene.setToneMap({ mode: 'aces', exposure: 1.0 });
        h.scene.setAmbient({ color: [0.11, 0.12, 0.15] });
        h.scene.createLight({ type: 'directional', direction: [-0.45, -0.9, -0.35], color: [1.0, 0.96, 0.88], intensity: 3.4, castsShadow: true });
        h.scene.createLight({ type: 'directional', direction: [0.6, -0.35, 0.5], color: [0.6, 0.74, 1.0], intensity: 0.9 });
        h.cam = Camera.createOrbit({ target: [0, 0, 0], dist: 260, fov: 45 });
        h.scene.setCamera(Camera.orbitViewOpts(h.cam, h.canvas));

        h.canvas.addEventListener('mousedown', (e) => { h.drag = { x: e.clientX, y: e.clientY }; e.preventDefault(); });
        h.canvas.addEventListener('contextmenu', (e) => e.preventDefault());
        window.addEventListener('mouseup', () => { h.drag = null; });
        window.addEventListener('mousemove', (e) => {
            if (!h.drag) return;
            const dx = e.clientX - h.drag.x, dy = e.clientY - h.drag.y;
            h.drag.x = e.clientX; h.drag.y = e.clientY;
            Camera.orbitLook(h.cam, dx, dy);
            h.scene.setCamera(Camera.orbitViewOpts(h.cam, h.canvas));
        });
        h.canvas.addEventListener('wheel', (e) => {
            h.cam.dist = Math.max(60, Math.min(700, h.cam.dist + e.deltaY * 0.25));
            h.scene.setCamera(Camera.orbitViewOpts(h.cam, h.canvas));
            e.preventDefault();
        });
        return h;
    },

    tick(h) {
        if (h.auto) { Camera.orbitLook(h.cam, 0.35, 0); h.scene.setCamera(Camera.orbitViewOpts(h.cam, h.canvas)); }
    },

    regen(h) {
        const w = state.world;
        if (!w) return;
        const cells = Math.min(REQ_CAP, state.region.extent);
        const c = { ci: state.region.i + state.region.extent / 2, cj: state.region.j + state.region.extent / 2 };
        const i0 = Math.round(c.ci - cells / 2), j0 = Math.round(c.cj - cells / 2);
        const capNote = cells < state.region.extent ? ' (capped from ' + state.region.extent + ')' : '';
        status('generating relief… ' + cells + '×' + cells + capNote + ' — the full pipeline, seconds');
        const t0 = performance.now();
        w.elevation(i0, j0, i0 + cells, j0 + cells, {
            onDone: (r) => {
                h.res = r;
                rebuildMesh(h);
                drawHypso(h, r);
                drawProfile(h, r);
                status('relief ready — ' + cells + '×' + cells + ' in ' + ((performance.now() - t0) / 1000).toFixed(1) + ' s');
            },
            onError: (m) => status('relief: ' + m, true),
        });
    },
});

// Build (or swap) the heightfield mesh from the elevation tile.
function rebuildMesh(h) {
    const r = h.res; if (!r) return;
    const W = r.width, H = r.height, d = r.data;
    const nx = Math.min(MESH_N, W), nz = Math.min(MESH_N, H);
    let lo = Infinity, hi = -Infinity;
    for (let i = 0; i < d.length; i++) { if (d[i] < lo) lo = d[i]; if (d[i] > hi) hi = d[i]; }
    const span = hi - lo || 1;
    const patchM = W * r.cellSize;
    const uPerM = SPAN / patchM;                          // world units per metre (horizontal)
    const positions = new Float32Array(nx * nz * 3);
    const colors = new Float32Array(nx * nz * 3);
    let p = 0, cptr = 0;
    for (let z = 0; z < nz; z++) {
        const sz = Math.min(H - 1, Math.round(z / (nz - 1) * (H - 1)));
        for (let x = 0; x < nx; x++) {
            const sx = Math.min(W - 1, Math.round(x / (nx - 1) * (W - 1)));
            const e = d[sz * W + sx];
            positions[p++] = (x / (nx - 1) - 0.5) * SPAN;
            positions[p++] = e * uPerM * h.vexag;         // sea level (0 m) → y 0
            positions[p++] = (z / (nz - 1) - 0.5) * SPAN;
            const col = terrainColor((e - lo) / span);
            colors[cptr++] = col[0]; colors[cptr++] = col[1]; colors[cptr++] = col[2];
        }
    }
    const indices = new Uint32Array((nx - 1) * (nz - 1) * 6);
    let ip = 0;
    for (let z = 0; z < nz - 1; z++) for (let x = 0; x < nx - 1; x++) {
        const a = z * nx + x, b = a + 1, cc = a + nx, dd = cc + 1;
        indices[ip++] = a; indices[ip++] = cc; indices[ip++] = b;
        indices[ip++] = b; indices[ip++] = cc; indices[ip++] = dd;
    }
    const meshOpts = { positions, indices, colors, recomputeNormals: true };
    if (h.node) h.node.updateMesh(meshOpts);
    else h.node = h.scene.createMesh({ ...meshOpts, roughness: 0.92, metallic: 0.0 });

    // a translucent sea plane at y = 0, sized to the patch
    // plane primitive defaults to 10 units across; scale it to span the patch.
    if (!h.sea) h.sea = h.scene.createMesh({ mesh: 'plane', scale: SPAN / 10, color: [0.16, 0.34, 0.52, 0.55], roughness: 0.25, twoSided: true, castsShadow: false });
    h.info.textContent = lo.toFixed(0) + ' … ' + hi.toFixed(0) + ' m  ·  ' + (patchM / 1000).toFixed(1) + ' km  ·  ×' + h.vexag.toFixed(1) + ' vertical';
}

function drawHypso(h, r) {
    const ctx = h.hypso.getContext('2d'), W = h.hypso.width, Ht = h.hypso.height;
    ctx.clearRect(0, 0, W, Ht); ctx.fillStyle = '#0a0c10'; ctx.fillRect(0, 0, W, Ht);
    const d = r.data; let lo = Infinity, hi = -Infinity, land = 0;
    for (let i = 0; i < d.length; i++) { if (d[i] < lo) lo = d[i]; if (d[i] > hi) hi = d[i]; if (d[i] > 0) land++; }
    const BINS = 56, bins = new Float32Array(BINS), span = hi - lo || 1;
    for (let i = 0; i < d.length; i++) bins[Math.min(BINS - 1, ((d[i] - lo) / span * BINS) | 0)]++;
    let peak = 0; for (let i = 0; i < BINS; i++) if (bins[i] > peak) peak = bins[i];
    for (let i = 0; i < BINS; i++) {
        const t = (i + 0.5) / BINS, e = lo + t * span;
        const col = terrainColor(t);
        ctx.fillStyle = 'rgb(' + (col[0] * 255 | 0) + ',' + (col[1] * 255 | 0) + ',' + (col[2] * 255 | 0) + ')';
        const bh = (bins[i] / peak) * (Ht - 12);
        ctx.fillRect(i / BINS * W, Ht - bh, W / BINS + 1, bh);
    }
    // sea level line
    if (lo < 0 && hi > 0) {
        const sx = (-lo) / span * W;
        ctx.strokeStyle = '#7fd0ff'; ctx.setLineDash([3, 3]);
        ctx.beginPath(); ctx.moveTo(sx, 0); ctx.lineTo(sx, Ht); ctx.stroke(); ctx.setLineDash([]);
    }
    h.hypNote.textContent = (100 * land / d.length).toFixed(0) + '% land  ·  ' + lo.toFixed(0) + ' … ' + hi.toFixed(0) + ' m';
}

function drawProfile(h, r) {
    const ctx = h.profile.getContext('2d'), W = h.profile.width, Ht = h.profile.height;
    ctx.clearRect(0, 0, W, Ht); ctx.fillStyle = '#0a0c10'; ctx.fillRect(0, 0, W, Ht);
    const row = (r.height >> 1) * r.width, d = r.data;
    let lo = Infinity, hi = -Infinity;
    for (let x = 0; x < r.width; x++) { const e = d[row + x]; if (e < lo) lo = e; if (e > hi) hi = e; }
    const span = hi - lo || 1;
    const yOf = (e) => Ht - 8 - ((e - lo) / span) * (Ht - 16);
    if (lo < 0 && hi > 0) { ctx.strokeStyle = 'rgba(127,208,255,0.5)'; ctx.beginPath(); ctx.moveTo(0, yOf(0)); ctx.lineTo(W, yOf(0)); ctx.stroke(); }
    ctx.beginPath();
    for (let x = 0; x < r.width; x++) {
        const px = x / (r.width - 1) * W, py = yOf(d[row + x]);
        x === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py);
    }
    ctx.lineTo(W, Ht); ctx.lineTo(0, Ht); ctx.closePath();
    ctx.fillStyle = 'rgba(120,170,120,0.35)'; ctx.fill();
    ctx.strokeStyle = '#cfe8b0'; ctx.lineWidth = 1.2; ctx.stroke();
}
