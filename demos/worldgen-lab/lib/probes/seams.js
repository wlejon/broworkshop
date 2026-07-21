// ═══ PROBE: composition — where the infinite world stitches ══════════════════
//
// The world is a pure function of (seed, position), so any region can be read in
// any order and independently generated neighbours must agree where they meet.
// They only do because reconstruction pads outward and CROPS: the blur and the
// resampling reach past the requested edge, so the outermost cells of a naive
// read are built from truncated support. `margin` over-requests by a few cells
// and crops them, and the seam vanishes.
//
// This probe measures that directly. It reads one small window at several margins
// and diffs each against a deep-margin reference: the error lives in a thin rim
// and falls to bit-exact zero a few cells in. Then it reads two ADJACENT tiles
// independently and compares them to a single big read covering both — at margin
// 8 they compose exactly, at margin 0 there is a lip along the join. It is the
// heavy path many times over, so it runs on the button, not on every region move.

import { state, luts, status } from "/app/lib/core.js";
import { el, mkNumber, drawField } from "/app/lib/helpers.js";
import { registerProbe } from "/app/lib/registry.js";

const MARGINS = [0, 2, 4, 8, 16];
const REF_MARGIN = 32;         // the "read inside a much larger request" ground truth

registerProbe({
    id: 'seams',
    name: 'Composition',
    blurb: 'The tile seam. Read a window at several margins, diff each against a deep-margin reference — the edge error decays to bit-exact zero a few cells in — then check that two independently generated neighbours compose into a single big read.',

    build(mount) {
        const h = { n: 48, busy: false };

        const bar = el('div', 'probe-bar');
        mkNumber(bar, 'window', h.n, 8, (v) => { h.n = Math.max(16, v | 0); });
        h.run = el('button', 'btn primary', '▶ run seam test');
        h.run.onclick = () => run(h);
        bar.appendChild(h.run);
        h.meta = el('span', 'meta'); bar.appendChild(h.meta);
        mount.appendChild(bar);

        const body = el('div', 'seams-body');

        const dcard = el('div', 'card');
        dcard.appendChild(el('div', 'card-title', '|error| vs deep-margin reference (margin 0)'));
        h.diff = document.createElement('canvas'); h.diff.width = 220; h.diff.height = 220;
        h.diff.className = 'seam-diff';
        dcard.appendChild(h.diff);
        body.appendChild(dcard);

        const ccard = el('div', 'card');
        ccard.appendChild(el('div', 'card-title', 'edge error → 0'));
        h.decay = document.createElement('canvas'); h.decay.width = 380; h.decay.height = 160;
        h.decay.className = 'seam-decay';
        ccard.appendChild(h.decay);
        h.mtab = el('div', 'margin-table'); ccard.appendChild(h.mtab);
        h.seamNote = el('div', 'card-note'); ccard.appendChild(h.seamNote);
        body.appendChild(ccard);

        mount.appendChild(body);
        return h;
    },

    // Cheap: the heavy work is on the button. Just reflect the current region.
    regen(h) {
        h.meta.textContent = 'region (' + state.region.i + ', ' + state.region.j + ') · press run';
    },
});

// A queue of elevation() reads (one request at a time per world), then the maths.
function run(h) {
    const w = state.world;
    if (!w) { status('load a checkpoint first', true); return; }
    if (h.busy) return;
    h.busy = true; h.run.disabled = true;
    const n = h.n, i0 = state.region.i, j0 = state.region.j;
    const jobs = [];
    // reference + each margin over the SAME window (the edge-decay measurement)
    jobs.push({ key: 'ref', i1: i0, j1: j0, i2: i0 + n, j2: j0 + n, margin: REF_MARGIN });
    for (const m of MARGINS) jobs.push({ key: 'm' + m, i1: i0, j1: j0, i2: i0 + n, j2: j0 + n, margin: m });
    // one big read covering two tiles side by side, and the two tiles read alone,
    // at margin 0 and margin 8 — the neighbour-composition measurement.
    jobs.push({ key: 'big', i1: i0, j1: j0, i2: i0 + n, j2: j0 + 2 * n, margin: 8 });
    jobs.push({ key: 'L0', i1: i0, j1: j0, i2: i0 + n, j2: j0 + n, margin: 0 });
    jobs.push({ key: 'R0', i1: i0, j1: j0 + n, i2: i0 + n, j2: j0 + 2 * n, margin: 0 });
    jobs.push({ key: 'L8', i1: i0, j1: j0, i2: i0 + n, j2: j0 + n, margin: 8 });
    jobs.push({ key: 'R8', i1: i0, j1: j0 + n, i2: i0 + n, j2: j0 + 2 * n, margin: 8 });

    const got = {}, total = jobs.length;
    const next = () => {
        if (!jobs.length) { h.busy = false; h.run.disabled = false; analyse(h, got, n); return; }
        const j = jobs.shift();
        status('seam test: ' + j.key + '… (' + (total - jobs.length) + '/' + total + ')');
        w.elevation(j.i1, j.j1, j.i2, j.j2, {
            margin: j.margin,
            onDone: (r) => { got[j.key] = r.data; next(); },
            onError: (m) => { status('seam ' + j.key + ': ' + m, true); h.busy = false; h.run.disabled = false; },
        });
    };
    next();
}

function analyse(h, got, n) {
    const ref = got.ref;
    // per-margin: max |error| vs the deep-margin reference, and the decay by ring
    const rows = [];
    for (const m of MARGINS) {
        const a = got['m' + m];
        let maxD = 0; const ringMax = {};
        for (let z = 0; z < n; z++) for (let x = 0; x < n; x++) {
            const d = Math.abs(a[z * n + x] - ref[z * n + x]);
            if (d > maxD) maxD = d;
            const ring = Math.min(x, z, n - 1 - x, n - 1 - z);
            if (d > (ringMax[ring] || 0)) ringMax[ring] = d;
        }
        rows.push({ m, maxD, ringMax });
    }

    // |error| field for margin 0 — a thin bright rim, zero inside
    const m0 = got.m0, diff = new Float32Array(n * n);
    for (let i = 0; i < n * n; i++) diff[i] = Math.abs(m0[i] - ref[i]);
    drawField(h.diff, diff, n, n, luts().heat);

    drawDecay(h.decay, rows.find((r) => r.m === 0).ringMax, n);

    h.mtab.innerHTML = '';
    for (const r of rows) {
        const row = el('div', 'margin-row');
        row.appendChild(el('span', 'm-lbl', 'margin ' + r.m + (r.m === 8 ? ' (default)' : '')));
        row.appendChild(el('span', 'm-val', r.maxD < 1e-6 ? '0 (bit-exact)' : r.maxD.toFixed(3) + ' m'));
        if (r.m === 8) row.classList.add('on');
        h.mtab.appendChild(row);
    }

    // neighbour composition: how far each independently-read tile is from the one
    // big read covering both. Left tile occupies big columns [0, n); right [n, 2n).
    const big = got.big;
    const dev = (tile, offX) => {
        let mx = 0;
        for (let z = 0; z < n; z++) for (let x = 0; x < n; x++)
            mx = Math.max(mx, Math.abs(tile[z * n + x] - big[z * 2 * n + offX + x]));
        return mx;
    };
    const d0 = Math.max(dev(got.L0, 0), dev(got.R0, n));
    const d8 = Math.max(dev(got.L8, 0), dev(got.R8, n));
    h.seamNote.textContent =
        'two independent neighbours vs one big read — ' +
        'margin 0: ' + (d0 < 1e-6 ? '0' : d0.toFixed(3) + ' m') + ' (a lip along the join)   ·   ' +
        'margin 8: ' + (d8 < 1e-6 ? '0 — they compose exactly' : d8.toFixed(3) + ' m');
    h.meta.textContent = 'done — ' + n + '×' + n + ' window';
    status('seam test complete');
}

function drawDecay(cv, ringMax, n) {
    const ctx = cv.getContext('2d'), W = cv.width, H = cv.height;
    ctx.clearRect(0, 0, W, H); ctx.fillStyle = '#0a0c10'; ctx.fillRect(0, 0, W, H);
    const rings = Math.min(8, n >> 1);
    let peak = 0; for (let r = 0; r < rings; r++) if ((ringMax[r] || 0) > peak) peak = ringMax[r] || 0;
    peak = peak || 1;
    const x0 = 34, y0 = H - 22;
    ctx.strokeStyle = '#2a3a4a'; ctx.beginPath(); ctx.moveTo(x0, 12); ctx.lineTo(x0, y0); ctx.lineTo(W - 8, y0); ctx.stroke();
    ctx.fillStyle = '#8a97ad'; ctx.font = '10px monospace';
    ctx.fillText('cells from edge', W - 108, H - 6);
    ctx.save(); ctx.translate(11, y0); ctx.rotate(-Math.PI / 2); ctx.fillText('max |error| m', 0, 0); ctx.restore();
    ctx.fillStyle = '#cfe8b0'; ctx.fillText('peak ' + peak.toFixed(3) + ' m', x0 + 6, 20);
    ctx.strokeStyle = '#ffb054'; ctx.lineWidth = 1.5; ctx.beginPath();
    for (let r = 0; r < rings; r++) {
        const x = x0 + (r / (rings - 1)) * (W - x0 - 12);
        const y = y0 - ((ringMax[r] || 0) / peak) * (y0 - 20);
        r === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    }
    ctx.stroke();
    for (let r = 0; r < rings; r++) {
        const x = x0 + (r / (rings - 1)) * (W - x0 - 12);
        const y = y0 - ((ringMax[r] || 0) / peak) * (y0 - 20);
        ctx.fillStyle = '#ffb054'; ctx.fillRect(x - 2, y - 2, 4, 4);
        ctx.fillStyle = '#8a97ad'; ctx.fillText(String(r), x - 3, H - 8);
    }
}
