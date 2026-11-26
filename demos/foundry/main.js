// demos/foundry/main.js — Wires the sunlit Foundry Assembly Bay, 3D part/socket
// picking, Nameplate Inspector, and full-viewport HDR Battle Arena.

import { boot } from "/lib/kit/app.js";
import { sceneViewport, orbitRotation, localPoint, Camera } from "/lib/kit/viewport3d.js";
import { pickRay } from "/lib/kit/dynamics3d.js";
import { skyEnvironment, sunDirection } from "/lib/kit/sky.js";
import { fixedStep, fpsMeter } from "/lib/kit/ui.js";
import { compileMachine } from "/lib/machine/compiler.js";
import { createFoundryBay } from "/app/bay.js";
import { createArena } from "/app/arena.js";

boot();

const $ = (id) => document.getElementById(id);
const vp = sceneViewport('#stage', {
    orbit: { target: [0, 1.5, 0], dist: 9.5, fov: 46, near: 0.3, far: 1200, rot: orbitRotation(0.65, -0.32) },
    controls: { minDist: 2.0, maxDist: 160 },
});

const scene = vp.scene;
skyEnvironment(scene, { hdri: 'kloofendal_43d_clear_puresky', intensity: 1.05, fallbackAmbient: [0.22, 0.25, 0.30] });
scene.setSSAO({ enabled: true, radius: 0.65, intensity: 0.85, bias: 0.02 });
const sun = scene.createLight({ type: 'directional', direction: sunDirection(42, 130), color: [1.0, 0.96, 0.90], intensity: 2.8 });
sun.castsShadow = true;
scene.createLight({ type: 'directional', direction: [-0.6, -0.3, -0.5], color: [0.55, 0.72, 0.98], intensity: 0.75 });

const bay = createFoundryBay(scene, vp);
const arena = createArena(scene);

let mode = 'bay';
let activeTier = 3;
let followCam = true;
let turretYaw = 0, turretPitch = 0.16;
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

function refreshSelectionUI() {
    const cn = bay.selectedCompiledNode();
    $('sel-part-name').textContent = cn ? `${cn.rawId} (${cn.material})` : '—';
    $('sel-socket-badge').textContent = bay.state.selectedSocket || '+Y';
    if (cn && cn.material) $('alloy-select').value = cn.material;
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

    refreshSelectionUI();

    const pDiv = $('np-ports');
    pDiv.innerHTML = '';
    for (const p of c.ports.slice(0, 7)) {
        const row = document.createElement('div');
        row.className = 'f-port';
        row.innerHTML = `<span>${p.id}</span><span class="ptype">${p.type}</span>`;
        pDiv.appendChild(row);
    }

    const hDiv = $('np-hints');
    hDiv.innerHTML = '';
    for (const h of c.hints) {
        const el = document.createElement('div');
        el.className = 'f-hint';
        el.textContent = h;
        hDiv.appendChild(el);
    }

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
    document.body.classList.add('battle-mode');
    bay.setVisible(false);
    $('mode-bay').classList.remove('active');
    $('mode-battle').classList.add('active');
    const enemyBp = bay.resolver($('enemy-select').value);
    const enemyCompiled = compileMachine(enemyBp, bay.resolver);
    arena.spawnMatch(bay.state.compiled, enemyCompiled);
    followCam = true;
    spadeLatch = false;
    vp.reframe([0, 2.5, 22], 24, { yaw: 0.35, pitch: -0.26 });
    $('hud-overlay').innerHTML =
        `<b>Battle Arena: ${bay.state.compiled.name} vs ${enemyCompiled.name}</b><br>` +
        'W/S: drive/walk · A/D: turn · Q/E: turret · Z/C: elevate · Space / Click: fire / ram<br>' +
        'R: spades / flywheel clutch · Tab: follow/free cam · V: live stress';
    $('status').textContent = `Battle live: ${bay.state.compiled.name} vs ${enemyCompiled.name}`;
}

function enterBay() {
    mode = 'bay';
    document.body.classList.remove('battle-mode');
    arena.cleanup();
    bay.setVisible(true);
    $('mode-battle').classList.remove('active');
    $('mode-bay').classList.add('active');
    const ext = bay.state.compiled.bounds.max, min = bay.state.compiled.bounds.min;
    const span = Math.max(3.5, Math.hypot(ext[0] - min[0], ext[1] - min[1], ext[2] - min[2]));
    vp.reframe([0, (ext[1] - min[1]) * 0.46, 0], Math.max(4.5, span * 1.25), { yaw: 0.65, pitch: -0.32 });
    $('hud-overlay').innerHTML =
        '<b>Assembly Bay</b> — Left-click any part or cyan face socket to select &amp; snap.<br>' +
        'Right-drag: orbit · Middle-drag: pan · Wheel: zoom · Toggle <b>Bench Test</b> or <b>Battle Arena</b>.';
    $('status').textContent = 'Assembly Bay ready';
}

$('mode-bay').addEventListener('click', enterBay);
$('mode-battle').addEventListener('click', launchBattle);
$('btn-reset-arena').addEventListener('click', launchBattle);
$('chk-live-stress').addEventListener('change', (e) => arena.setStressOverlay(e.target.checked));
$('chk-bench').addEventListener('change', (e) => { bay.state.benchTest = e.target.checked; });

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

$('chk-mirror').addEventListener('change', (e) => { bay.state.mirrorX = e.target.checked; });
$('btn-apply-alloy').addEventListener('click', () => { bay.setSelectedAlloy($('alloy-select').value); refreshInspector(); });
$('btn-add-plate').addEventListener('click', () => { bay.addArmorPlate(); refreshInspector(); });
$('btn-attach-unit').addEventListener('click', () => { bay.attachUnit($('embed-select').value); refreshInspector(); });
$('btn-delete-part').addEventListener('click', () => { bay.deleteSelected(); refreshInspector(); });
$('btn-undo').addEventListener('click', () => { bay.undo(); refreshInspector(); });
$('btn-revert').addEventListener('click', () => { bay.loadPreset(bay.state.presetId); refreshInspector(); });

$('nudge-xm').addEventListener('click', () => { bay.nudgeSelected(-0.25, 0, 0); refreshInspector(); });
$('nudge-xp').addEventListener('click', () => { bay.nudgeSelected(0.25, 0, 0); refreshInspector(); });
$('nudge-ym').addEventListener('click', () => { bay.nudgeSelected(0, -0.25, 0); refreshInspector(); });
$('nudge-yp').addEventListener('click', () => { bay.nudgeSelected(0, 0.25, 0); refreshInspector(); });
$('nudge-zm').addEventListener('click', () => { bay.nudgeSelected(0, 0, -0.25); refreshInspector(); });
$('nudge-zp').addEventListener('click', () => { bay.nudgeSelected(0, 0, 0.25); refreshInspector(); });

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

vp.canvas.addEventListener('mousedown', (e) => {
    if (e.button !== 0) return;
    if (mode === 'battle') { fireQueued = true; return; }
    const pt = localPoint(vp.canvas, e);
    const ray = pickRay(vp, pt.x, pt.y);
    if (bay.handleClick(ray)) refreshSelectionUI();
});

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

const fps = fpsMeter();
const stepFixed = fixedStep(1 / 60, 4);
let frameCounter = 0;

vp.onFrame((dt, t) => {
    fps.tick();
    if (mode === 'bay') {
        bay.tick(t);
    } else if (mode === 'battle' && arena.active) {
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
