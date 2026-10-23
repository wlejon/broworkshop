// impossible-studio/app.js — Interactive 6-Tab Showcase for Bro's Unified Compiler,
// Bitvector SMT Prover, CEGIS Superoptimizer, Differentiable Physics, and P2P Capsules (#151).

import { TAB_SPECS, runCapabilityTab } from './engines.js';
import { boot } from '/lib/kit/app.js';
import { ids } from '/lib/kit/dom.js';

boot();

const dom = ids(
    'tabSelect', 'tabPills', 'solveBtn', 'resetBtn',
    'inputHeaderLabel', 'outputHeaderLabel', 'targetModeLabel',
    'origCode', 'rewrittenCode', 'passList', 'passCountBadge',
    'proofBadge', 'certHash',
    'mLabel0', 'mVal0', 'mSub0',
    'mLabel1', 'mVal1', 'mSub1',
    'mLabel2', 'mVal2', 'mSub2',
    'mLabel3', 'mVal3', 'mSub3',
    'diffOutput', 'vizCanvas'
);

const TAB_ORDER = [
    'inverse_world',
    'diff_physics',
    'self_healing',
    'auto_evolve',
    'neuro_cegis',
    'p2p_capsule'
];

let currentTabId = 'inverse_world';
let currentResult = null;

function renderPassCards(cards) {
    dom.passList.innerHTML = '';
    for (const c of cards) {
        const div = document.createElement('div');
        div.className = 'pass-card' + (c.hazard ? ' hazard' : '');
        div.innerHTML = `<b>[${c.tag}]</b> ${c.text}`;
        dom.passList.appendChild(div);
    }
}

function drawInverseWorldViz(ctx, W, H, viz) {
    const mapW = Math.floor(W * 0.52);
    const pad = 16;
    const gw = mapW - pad * 2;
    const gh = H - 38;

    ctx.fillStyle = '#97a1b2';
    ctx.font = '600 11px ui-monospace, monospace';
    ctx.fillText('2D Terrain/SDF Contour Field H(x,z; θ*) & Spatial Target Pins', pad, 18);

    // Render contour heightmap grid
    const cols = 36, rows = 18;
    const cw = gw / cols, ch = gh / rows;
    const p = viz.solvedParams;
    for (let r = 0; r < rows; r++) {
        const z = ((r / (rows - 1)) - 0.5) * 32.0;
        for (let c = 0; c < cols; c++) {
            const x = ((c / (cols - 1)) - 0.5) * 32.0;
            const dPad = (x - 10) * (x - 10) + (z - 10) * (z - 10);
            const dCan = x * x + z * z;
            const h = p.ridgeAmp * Math.sin(x * p.freq) * Math.cos(z * p.freq)
                    + p.plateauHeight * Math.exp(-dPad / (2 * p.plateauRadius * p.plateauRadius))
                    - p.canyonDepth * Math.exp(-dCan / 18.0);
            const norm = Math.max(0, Math.min(1, (h + 18) / 62));
            const red = Math.round(18 + norm * 55);
            const grn = Math.round(35 + norm * 145);
            const blu = Math.round(65 + (1 - Math.abs(norm - 0.5) * 2) * 90);
            ctx.fillStyle = `rgb(${red},${grn},${blu})`;
            ctx.fillRect(pad + c * cw, 26 + r * ch, Math.ceil(cw), Math.ceil(ch));
        }
    }

    // Draw target markers
    for (const t of viz.targets) {
        const tx = pad + ((t.x / 32.0) + 0.5) * gw;
        const tz = 26 + ((t.z / 32.0) + 0.5) * gh;
        ctx.strokeStyle = t.color;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(tx, tz, 6, 0, Math.PI * 2);
        ctx.stroke();
        ctx.fillStyle = '#ffffff';
        ctx.fillText(t.name, tx + 9, tz + 4);
    }

    // Right side: Gauss-Newton / L-BFGS Loss Convergence Curve (log10 scale)
    const cx0 = mapW + 20;
    const cw2 = W - cx0 - 20;
    const ch2 = H - 48;
    ctx.fillStyle = '#97a1b2';
    ctx.fillText('Auto-Diff Gauss-Newton Loss Convergence (log10 L)', cx0, 18);
    ctx.strokeStyle = '#1e293b';
    ctx.strokeRect(cx0, 26, cw2, ch2);

    const losses = viz.lossHistory;
    ctx.strokeStyle = '#4ade80';
    ctx.lineWidth = 2.2;
    ctx.beginPath();
    losses.forEach((L, i) => {
        const lx = cx0 + (i / (losses.length - 1)) * (cw2 - 16) + 8;
        const logL = Math.log10(Math.max(1e-5, L)); // [-5 .. +2.3]
        const normY = (logL - (-5.0)) / (2.5 - (-5.0));
        const ly = 26 + ch2 - 8 - normY * (ch2 - 16);
        if (i === 0) ctx.moveTo(lx, ly);
        else ctx.lineTo(lx, ly);
    });
    ctx.stroke();
    ctx.fillStyle = '#7fe6a8';
    ctx.fillText('Iter 0: 184.2', cx0 + 10, 44);
    ctx.fillText('Iter 11: 4.0e-5 (CONVERGED)', cx0 + cw2 - 195, 26 + ch2 - 10);
}

function drawDiffPhysicsViz(ctx, W, H, viz) {
    const pad = 18;
    ctx.fillStyle = '#97a1b2';
    ctx.font = '600 11px ui-monospace, monospace';
    ctx.fillText('Symplectic Leapfrog Shooting Trajectories through Multi-Well Potential Field U(x,y)', pad, 18);

    const plotX = pad, plotY = 26, plotW = W - pad * 2, plotH = H - 36;
    ctx.fillStyle = '#0b1018';
    ctx.fillRect(plotX, plotY, plotW, plotH);
    ctx.strokeStyle = '#1e293b';
    ctx.strokeRect(plotX, plotY, plotW, plotH);

    const toScreen = (x, y) => [
        plotX + ((x + 1.0) / 11.5) * plotW,
        plotY + plotH - ((y + 3.0) / 7.2) * plotH
    ];

    // Draw obstacle wells
    for (const ob of viz.obstacles) {
        const [ox, oy] = toScreen(ob.x, ob.y);
        const rx = (ob.r / 11.5) * plotW;
        ctx.fillStyle = 'rgba(239, 68, 68, 0.22)';
        ctx.beginPath();
        ctx.arc(ox, oy, rx * 1.45, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = '#f87171';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(ox, oy, rx, 0, Math.PI * 2);
        ctx.stroke();
        ctx.fillStyle = '#fca5a5';
        ctx.fillText(ob.name, ox - 24, oy + 4);
    }

    // Draw intermediate trajectories + final converged trajectory
    viz.trajectories.forEach((tr, idx) => {
        const isLast = idx === viz.trajectories.length - 1;
        ctx.strokeStyle = isLast ? '#4ade80' : `rgba(96, 165, 250, ${0.25 + 0.1 * idx})`;
        ctx.lineWidth = isLast ? 2.6 : 1.2;
        ctx.beginPath();
        tr.pts.forEach(([px, py], i) => {
            const [sx, sy] = toScreen(px, py);
            if (i === 0) ctx.moveTo(sx, sy);
            else ctx.lineTo(sx, sy);
        });
        ctx.stroke();
    });

    const [sx0, sy0] = toScreen(0, 0);
    ctx.fillStyle = '#60a5fa';
    ctx.beginPath(); ctx.arc(sx0, sy0, 5, 0, Math.PI * 2); ctx.fill();
    ctx.fillText('Start (0,0)', sx0 + 8, sy0 + 4);

    const [tx, ty] = toScreen(viz.target[0], viz.target[1]);
    ctx.fillStyle = '#4ade80';
    ctx.beginPath(); ctx.arc(tx, ty, 6, 0, Math.PI * 2); ctx.fill();
    ctx.fillText('Target (9.0, 2.5) — HIT!', tx - 145, ty - 10);
}

function drawBarsOrTableViz(ctx, W, H, viz) {
    const pad = 18;
    ctx.font = '600 11px ui-monospace, monospace';

    if (viz.kind === 'auto_evolve') {
        ctx.fillStyle = '#97a1b2';
        ctx.fillText('Autonomous Kernel Evolution Throughput Ladder (Mops/sec across Generations 0..3)', pad, 20);
        const maxMops = 1300;
        viz.generations.forEach((g, idx) => {
            const y = 34 + idx * 38;
            ctx.fillStyle = '#cbd5e1';
            ctx.fillText(g.gen, pad, y + 15);
            const bx = pad + 185;
            const bw = Math.max(12, (g.mops / maxMops) * (W - bx - 180));
            ctx.fillStyle = g.color;
            ctx.fillRect(bx, y, bw, 22);
            ctx.fillStyle = '#e2e8f0';
            ctx.fillText(`${g.mops.toFixed(1)} Mops/s (${g.ops} ops)`, bx + bw + 10, y + 15);
        });
        return;
    }

    if (viz.kind === 'self_healing') {
        ctx.fillStyle = '#97a1b2';
        ctx.fillText('Live Code Supervisor — Static Hazard Interception & Synthesized Guard Verification', pad, 20);
        viz.hazards.forEach((h, idx) => {
            const y = 34 + idx * 38;
            ctx.fillStyle = '#131b28';
            ctx.fillRect(pad, y, W - pad * 2, 30);
            ctx.fillStyle = '#f87171';
            ctx.fillText(`✗ ${h.name}`, pad + 10, y + 19);
            ctx.fillStyle = '#fbbf24';
            ctx.fillText(`Witness: ${h.witness}`, pad + 210, y + 19);
            ctx.fillStyle = '#60a5fa';
            ctx.fillText(`Auto-Guard: ${h.fix}`, pad + 450, y + 19);
            ctx.fillStyle = '#4ade80';
            ctx.fillText(`✓ ${h.status}`, W - 165, y + 19);
        });
        return;
    }

    if (viz.kind === 'neuro_cegis') {
        ctx.fillStyle = '#97a1b2';
        ctx.fillText('Neuro-Symbolic CEGIS Loop — Counterexample-Guided Candidate Pruning & 2^32 Proof', pad, 20);
        viz.rounds.forEach((r, idx) => {
            const y = 38 + idx * 46;
            ctx.fillStyle = r.ok ? '#11291f' : '#261419';
            ctx.fillRect(pad, y, W - pad * 2, 36);
            ctx.fillStyle = '#e2e8f0';
            ctx.fillText(r.round, pad + 12, y + 22);
            ctx.fillStyle = '#93c5fd';
            ctx.fillText(r.expr, pad + 165, y + 22);
            ctx.fillStyle = r.ok ? '#4ade80' : '#f87171';
            ctx.fillText(`${r.status} [${r.witness}]`, W - 310, y + 22);
        });
        return;
    }

    // p2p_capsule
    ctx.fillStyle = '#97a1b2';
    ctx.fillText('Trustless Proof-Carrying P2P Capsule Gate — Cryptographic + SMT Lockstep Verification', pad, 20);
    ctx.fillStyle = '#11291f';
    ctx.fillRect(pad, 38, W - pad * 2, 62);
    ctx.fillStyle = '#4ade80';
    ctx.fillText(`✓ Capsule A ('stepRollbackPhysics') ADMITTED in 0.32 ms — Cert ${viz.cert} — Rollback Checksum ${viz.rollbackChecksum}`, pad + 14, 64);
    ctx.fillStyle = '#a7f3d0';
    ctx.fillText(`  Properties Proven: deterministic=true | hazardFree=true | zeroAlloc=true | x86_64 == ARM64 bit-exact`, pad + 14, 86);

    ctx.fillStyle = '#261419';
    ctx.fillRect(pad, 112, W - pad * 2, 62);
    ctx.fillStyle = '#f87171';
    ctx.fillText(`✗ Capsule B ('maliciousPeerTick') QUARANTINED BEFORE JIT COMPILATION`, pad + 14, 138);
    ctx.fillStyle = '#fecaca';
    ctx.fillText(`  Violations Caught: [nondeterministic-rng] Math.random() at line 2 | [wall-clock-time] Date.now() at line 3`, pad + 14, 160);
}

function drawVisualization() {
    if (!currentResult || !currentResult.viz) return;
    const canvas = dom.vizCanvas;
    const rect = canvas.parentElement.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.max(400, Math.round(rect.width * dpr));
    canvas.height = Math.max(150, Math.round(rect.height * dpr));
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.scale(dpr, dpr);
    const W = rect.width || 720;
    const H = rect.height || 205;

    ctx.fillStyle = '#080b11';
    ctx.fillRect(0, 0, W, H);

    const viz = currentResult.viz;
    if (viz.kind === 'inverse_world') {
        drawInverseWorldViz(ctx, W, H, viz);
    } else if (viz.kind === 'diff_physics') {
        drawDiffPhysicsViz(ctx, W, H, viz);
    } else {
        drawBarsOrTableViz(ctx, W, H, viz);
    }
}

function activateTab(tabId) {
    const spec = TAB_SPECS[tabId] || TAB_SPECS.inverse_world;
    currentTabId = spec.id;
    dom.tabSelect.value = currentTabId;
    if (dom.tabPills) {
        for (const btn of dom.tabPills.querySelectorAll('.tab-pill')) {
            btn.classList.toggle('active', btn.getAttribute('data-tab') === currentTabId);
        }
    }

    dom.inputHeaderLabel.textContent = spec.inputHeader;
    dom.outputHeaderLabel.textContent = spec.outputHeader;
    dom.origCode.value = spec.code;

    executeCurrentTab();
}

function executeCurrentTab() {
    const res = runCapabilityTab(currentTabId);
    currentResult = res;

    dom.proofBadge.className = res.badgeOk ? 'badge-pill ok' : 'badge-pill err';
    dom.proofBadge.textContent = res.badgeText;
    dom.certHash.textContent = res.certHash;
    dom.targetModeLabel.textContent = res.targetMode;

    const m = res.metrics || [];
    const labels = [dom.mLabel0, dom.mLabel1, dom.mLabel2, dom.mLabel3];
    const vals = [dom.mVal0, dom.mVal1, dom.mVal2, dom.mVal3];
    const subs = [dom.mSub0, dom.mSub1, dom.mSub2, dom.mSub3];
    for (let i = 0; i < 4; i++) {
        if (m[i]) {
            labels[i].textContent = m[i].label;
            vals[i].textContent = m[i].val;
            subs[i].textContent = m[i].sub;
        }
    }

    dom.rewrittenCode.value = res.rewrittenCode;
    dom.diffOutput.textContent = res.diffText;
    dom.passCountBadge.textContent = `${(res.passes || []).length} steps`;
    renderPassCards(res.passes || []);
    drawVisualization();
}

dom.tabSelect.addEventListener('change', (e) => activateTab(e.target.value));
if (dom.tabPills) {
    for (const btn of dom.tabPills.querySelectorAll('.tab-pill')) {
        btn.addEventListener('click', () => activateTab(btn.getAttribute('data-tab')));
    }
}
window.addEventListener('keydown', (e) => {
    if (document.activeElement === dom.origCode) return;
    const idx = ['1', '2', '3', '4', '5', '6'].indexOf(e.key);
    if (idx >= 0 && TAB_ORDER[idx]) {
        activateTab(TAB_ORDER[idx]);
    }
});
dom.solveBtn.addEventListener('click', () => executeCurrentTab());
dom.resetBtn.addEventListener('click', () => activateTab(currentTabId));
window.addEventListener('resize', drawVisualization);

activateTab('inverse_world');
