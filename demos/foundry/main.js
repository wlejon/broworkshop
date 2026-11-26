// demos/foundry/main.js — Wires the Foundry Assembly Bay UI, Compiled Nameplate
// inspector, Joint Extents Scrubber, and Live Battle Arena.

import { boot } from "/lib/kit/app.js";
import { sceneViewport, orbitRotation, Camera } from "/lib/kit/viewport3d.js";
import { fixedStep, fpsMeter } from "/lib/kit/ui.js";
import { createFoundryBay } from "/app/bay.js";
import { createArena } from "/app/arena.js";

boot();

const $ = (id) => document.getElementById(id);
const vp = sceneViewport('#stage', {
    orbit: { target: [0, 1.5, 0], dist: 11, fov: 48, near: 0.3, far: 1200, rot: orbitRotation(0.65, -0.32) },
    controls: { minDist: 2.5, maxDist: 160 },
});

const scene = vp.scene;
scene.setAmbient([0.14, 0.16, 0.20]);
const sun = scene.createLight({ type: 'directional', direction: [-0.45, -1.0, -0.35], color: [1.0, 0.96, 0.90], intensity: 3.1 });
sun.castsShadow = true;
scene.createLight({ type: 'directional', direction: [0.6, -0.35, 0.55], color: [0.48, 0.65, 0.95], intensity: 0.9 });

const bay = createFoundryBay(scene, vp);
const arena = createArena(scene);

let mode = 'bay'; // 'bay' | 'battle'
let activeTier = 3;
let followCam = false;
let turretYaw = 0, turretPitch = 0.18;
let spadeLatch = false, fireQueued = false, clutchQueued = false;
const keys = new Set();

function refreshCatalogUI() {
    const entries = bay.catalogList();
    $('catalog-count').textContent = String(entries.length);
    const list = $('catalog-list');
    list.innerHTML = '';
    const embedSel = $('embed-select');
    const prevEmbed = embedSel.value;
    embedSel.innerHTML = '';

    for (const e of entries) {
        if ((e.tier || 3) === activeTier) {
            const btn = document.createElement('button');
            btn.className = 'f-item' + (bay.state.presetId === e.id ? ' selected' : '');
            btn.innerHTML = `<span>${e.name}</span><span class="dim">T${e.tier || 3}</span>`;
            btn.addEventListener('click', () => {
                bay.loadPreset(e.id);
                refreshCatalogUI();
                refreshInspector();
                if (mode === 'battle') launchBattle();
            });
            list.appendChild(btn);
        }
        if ((e.tier || 1) <= 2) {
            const opt = document.createElement('option');
            opt.value = e.id;
            opt.textContent = `[T${e.tier}] ${e.name}`;
            embedSel.appendChild(opt);
        }
    }
    if (prevEmbed && [...embedSel.options].some((o) => o.value === prevEmbed)) embedSel.value = prevEmbed;
    const cur = bay.resolver(bay.state.presetId);
    $('catalog-desc').textContent = cur ? cur.description : '';
}

function refreshInspector() {
    const c = bay.state.compiled;
    if (!c) return;
    const np = c.nameplate;
    const rEl = $('np-rating');
    rEl.textContent = np.rating;
    rEl.className = `f-badge rate-${np.rating}`;
    $('np-name').textContent = c.name;
    $('np-mass').textContent = `${Math.round(np.massKg).toLocaleString()} kg`;
    $('np-cost').textContent = `$${np.cost.toLocaleString()}`;
    $('np-parts').textContent = `${np.partCount} / ${np.clusterCount}`;
    $('np-dofs').textContent = `${np.dofCount}`;
    $('np-tip').textContent = `${np.tipMargin >= 0 ? '+' : ''}${np.tipMargin.toFixed(2)} m`;
    $('np-util').textContent = `${(np.peakUtil * 100).toFixed(0)}%`;

    // Ports
    const pDiv = $('np-ports');
    pDiv.innerHTML = '';
    for (const p of c.ports.slice(0, 8)) {
        const row = document.createElement('div');
        row.className = 'f-port';
        row.innerHTML = `<span>${p.id}</span><span class="ptype">${p.type}</span>`;
        pDiv.appendChild(row);
    }

    // Hints
    const hDiv = $('np-hints');
    hDiv.innerHTML = '';
    for (const h of c.hints) {
        const el = document.createElement('div');
        el.className = 'f-hint';
        el.textContent = h;
        hDiv.appendChild(el);
    }

    // Joint extents dropdown
    const jSel = $('sweep-joint');
    jSel.innerHTML = '';
    if (!c.joints.length) {
        const o = document.createElement('option');
        o.value = '-1'; o.textContent = 'No articulated DOFs';
        jSel.appendChild(o);
        $('sweep-slider').disabled = true;
        $('sweep-val').textContent = '—';
        $('sweep-info').textContent = 'Pure rigid assembly';
    } else {
        $('sweep-slider').disabled = false;
        c.joints.forEach((j, idx) => {
            const o = document.createElement('option');
            o.value = String(idx);
            o.textContent = `${idx + 1}. ${j.role} (${j.kind})`;
            jSel.appendChild(o);
        });
        const idx = Math.max(0, Math.min(c.joints.length - 1, bay.state.sweepJointIdx));
        bay.state.sweepJointIdx = idx;
        jSel.value = String(idx);
        syncSweepReadout();
    }
}

function syncSweepReadout() {
    const c = bay.state.compiled;
    const idx = bay.state.sweepJointIdx;
    if (!c || idx < 0 || idx >= c.joints.length) return;
    const j = c.joints[idx];
    const slider = $('sweep-slider');
    slider.min = String(j.lower);
    slider.max = String(j.upper);
    const val = Math.max(j.lower, Math.min(j.upper, bay.state.sweepValue || 0));
    slider.value = String(val);
    $('sweep-val').textContent = j.kind === 'hinge' ? `${(val * 180 / Math.PI).toFixed(0)}°` : `${val.toFixed(2)}m`;
    const ex = c.extents.find((e) => e.jointId === j.id);
    $('sweep-info').textContent = ex
        ? `Range [${j.lower.toFixed(2)}..${j.upper.toFixed(2)}], peak load ${Math.round(ex.maxLoad)} / ${Math.round(ex.capacity)} (${(ex.stallMargin * 100).toFixed(0)}% margin)`
        : `${j.kind} motor rated to ${Math.round(j.maxEffort)}`;
}

function launchBattle() {
    mode = 'battle';
    bay.setVisible(false);
    $('mode-bay').classList.remove('active');
    $('mode-battle').classList.add('active');
    const enemyBp = bay.resolver($('enemy-select').value);
    const enemyCompiled = bay.loadPreset ? (() => {
        const tmp = bay.state.compiled;
        // Compile enemy without disturbing bay's active blueprint.
        return import('/lib/machine/compiler.js').then((m) => m.compileMachine(enemyBp, bay.resolver));
    })() : null;

    Promise.resolve(enemyCompiled).then((ec) => {
        arena.spawnMatch(bay.state.compiled, ec);
        followCam = false;
        vp.reframe([0, 4, 18], 38, { yaw: 0.45, pitch: -0.30 });
        $('hud-overlay').innerHTML =
            '<b>Battle Arena (Live Box3D + Destructible Bunkers)</b><br>' +
            'W/S: drive/walk · A/D: turn · Q/E: turret · Z/C: elevate<br>' +
            'Space / Click: fire / ram · R: spades / flywheel clutch · Tab: follow cam · V: stress';
        $('status').textContent = `Battle live: ${bay.state.compiled.name} vs ${ec.name}`;
    });
}

function enterBay() {
    mode = 'bay';
    arena.cleanup();
    bay.setVisible(true);
    $('mode-battle').classList.remove('active');
    $('mode-bay').classList.add('active');
    const ext = bay.state.compiled.bounds.max, min = bay.state.compiled.bounds.min;
    const span = Math.max(4, Math.hypot(ext[0] - min[0], ext[1] - min[1], ext[2] - min[2]));
    vp.reframe([0, (ext[1] - min[1]) * 0.45, 0], Math.max(8, span * 1.45), { yaw: 0.65, pitch: -0.32 });
    $('hud-overlay').innerHTML =
        '<b>Assembly Bay</b><br>' +
        'Right-drag: orbit · Middle-drag: pan · Wheel: zoom<br>' +
        'Inspect solved stress &amp; extents, modify parts/alloys, then enter Battle Arena.';
    $('status').textContent = 'Assembly Bay ready';
}

// Toolbar & Catalog wiring
$('mode-bay').addEventListener('click', enterBay);
$('mode-battle').addEventListener('click', launchBattle);
$('btn-reset-arena').addEventListener('click', () => { if (mode === 'battle') launchBattle(); else launchBattle(); });
$('chk-live-stress').addEventListener('change', (e) => arena.setStressOverlay(e.target.checked));

for (const btn of $('tier-tabs').querySelectorAll('button')) {
    btn.addEventListener('click', () => {
        for (const b of $('tier-tabs').querySelectorAll('button')) b.classList.remove('active');
        btn.classList.add('active');
        activeTier = +btn.dataset.tier;
        refreshCatalogUI();
    });
}

for (const btn of $('loadcase-tabs').querySelectorAll('button')) {
    btn.addEventListener('click', () => {
        for (const b of $('loadcase-tabs').querySelectorAll('button')) b.classList.remove('active');
        btn.classList.add('active');
        bay.state.loadCase = btn.dataset.case;
        if (mode === 'bay') bay.render();
    });
}

$('mount-slot').addEventListener('change', (e) => { bay.state.mountSlot = e.target.value; });
$('chk-mirror').addEventListener('change', (e) => { bay.state.mirrorX = e.target.checked; });
$('btn-apply-alloy').addEventListener('click', () => { bay.applyAlloyToFrame($('alloy-select').value); refreshInspector(); });
$('btn-add-plate').addEventListener('click', () => { bay.addArmorPlate(); refreshInspector(); });
$('btn-attach-unit').addEventListener('click', () => { bay.attachUnit($('embed-select').value); refreshInspector(); });
$('btn-undo').addEventListener('click', () => { bay.undo(); refreshInspector(); });
$('btn-revert').addEventListener('click', () => { bay.loadPreset(bay.state.presetId); refreshInspector(); });
$('btn-save-unit').addEventListener('click', () => {
    const saved = bay.saveAsCustomUnit($('custom-unit-name').value);
    $('custom-unit-name').value = '';
    activeTier = saved.tier;
    for (const b of $('tier-tabs').querySelectorAll('button')) b.classList.toggle('active', +b.dataset.tier === activeTier);
    bay.loadPreset(saved.id);
    refreshCatalogUI();
    refreshInspector();
    $('status').textContent = `Compiled & saved '${saved.name}' into catalog`;
});

$('sweep-joint').addEventListener('change', (e) => {
    bay.state.sweepJointIdx = +e.target.value;
    bay.state.sweepValue = 0;
    syncSweepReadout();
    if (mode === 'bay') bay.render();
});
$('sweep-slider').addEventListener('input', (e) => {
    bay.state.sweepValue = +e.target.value;
    syncSweepReadout();
    if (mode === 'bay') bay.render();
});

// Keyboard & click controls for Battle Arena
window.addEventListener('keydown', (e) => {
    const k = e.key.toLowerCase();
    keys.add(k);
    if (mode === 'battle') {
        if (k === 'r') { spadeLatch = !spadeLatch; clutchQueued = true; }
        else if (k === 'tab') { e.preventDefault(); followCam = !followCam; }
        else if (k === 'v') {
            const chk = $('chk-live-stress');
            chk.checked = !chk.checked;
            arena.setStressOverlay(chk.checked);
        }
    }
});
window.addEventListener('keyup', (e) => keys.delete(e.key.toLowerCase()));
vp.canvas.addEventListener('mousedown', (e) => { if (mode === 'battle' && e.button === 0) fireQueued = true; });

const fps = fpsMeter();
const stepFixed = fixedStep(1 / 60, 4);
let frameCounter = 0;

vp.onFrame((dt) => {
    fps.tick();
    if (mode === 'battle' && arena.active) {
        const throttle = (keys.has('w') ? 1 : 0) - (keys.has('s') ? 1 : 0);
        const steer = (keys.has('d') ? 1 : 0) - (keys.has('a') ? 1 : 0);
        if (keys.has('q')) turretYaw = Math.min(3.0, turretYaw + 1.6 * dt);
        if (keys.has('e')) turretYaw = Math.max(-3.0, turretYaw - 1.6 * dt);
        if (keys.has('z')) turretPitch = Math.min(0.85, turretPitch + 0.9 * dt);
        if (keys.has('c')) turretPitch = Math.max(-0.12, turretPitch - 0.9 * dt);
        const fire = keys.has(' ') || fireQueued;
        const clutchDump = clutchQueued;
        fireQueued = false; clutchQueued = false;

        let stats = null;
        stepFixed(dt, (h) => {
            stats = arena.step(h, { throttle, steer, turretYaw, turretPitch, spades: spadeLatch, fire, clutchDump });
        });
        if (stats) {
            if (followCam) Camera.orbitReframe(vp.cam, stats.playerPos, vp.cam.dist);
            if (++frameCounter % 8 === 0) {
                $('stat-step').textContent = stats.stepMs.toFixed(2);
                $('stat-integrity').textContent = `Player ${(stats.playerIntegrity * 100).toFixed(0)}% · Broken ${stats.playerBroken}`;
                $('stat-enemy').textContent = `${(stats.enemyIntegrity * 100).toFixed(0)}% (broken ${stats.enemyBroken})`;
                $('stat-shells').textContent = String(stats.shells);
            }
        }
    }
    if (++frameCounter % 15 === 0) {
        $('stat-fps').textContent = fps.fps ? fps.fps.toFixed(0) : '—';
    }
});

refreshCatalogUI();
refreshInspector();
