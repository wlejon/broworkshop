// demos/foundry/main.js — Wires the Foundry Assembly Bay (ACES studio lighting,
// 3D part/socket picking, bro.gizmo dragging, alloy swatches, Nameplate Inspector)
// and full-viewport Proving Ground Battle Arena with tactical HUD.

import { boot } from "/lib/kit/app.js";
import { sceneViewport, orbitRotation, localPoint, Camera } from "/lib/kit/viewport3d.js";
import { pickRay } from "/lib/kit/dynamics3d.js";
import { skyEnvironment, sunDirection } from "/lib/kit/sky.js";
import { fixedStep, fpsMeter } from "/lib/kit/ui.js";
import { compileMachine } from "/lib/machine/compiler.js";
import { createFoundryBay, BAY_HERO_YAW, BAY_HERO_PITCH } from "/app/bay.js";
import { createArena } from "/app/arena.js";

boot();

const $ = (id) => document.getElementById(id);
const vp = sceneViewport('#stage', {
    orbit: { target: [0, 1.5, 0], dist: 8.8, fov: 44, near: 0.25, far: 1200, rot: orbitRotation(BAY_HERO_YAW, BAY_HERO_PITCH) },
    controls: { minDist: 1.6, maxDist: 160 },
});

const scene = vp.scene;
scene.setToneMap({ mode: 'aces' });
scene.setShadowQuality({ pcfTaps: 5 });
scene.setSSAO({ enabled: true, radius: 0.72, intensity: 1.10, bias: 0.015 });
scene.setBloom({ threshold: 1.12, intensity: 0.24, radius: 0.72, iterations: 4 });

// Key sun (illuminating front 3/4 face cleanly), cool steel rim from rear, and warm overhead bay lamp
const sun = scene.createLight({ type: 'directional', direction: sunDirection(44, 326), color: [1.0, 0.95, 0.88], intensity: 3.6 });
sun.castsShadow = true;
const rim = scene.createLight({ type: 'directional', direction: sunDirection(26, 142), color: [0.48, 0.72, 1.0], intensity: 1.25 });
const bayLamp = scene.createLight({ type: 'point', position: [5.5, 7.5, -6.5], color: [1.0, 0.86, 0.68], intensity: 28, range: 32 });

const BAY_MOODS = {
    atelier: {
        bg: '#0c1016',
        hdri: 'kloppenheim_06_puresky', envIntensity: 0.34, envRotation: 1.4,
        sunDir: sunDirection(44, 326), sunColor: [1.0, 0.95, 0.88], sunIntensity: 3.6,
        rimDir: sunDirection(24, 142), rimColor: [0.46, 0.72, 1.0], rimIntensity: 1.25,
        lampColor: [1.0, 0.88, 0.72], lampIntensity: 28,
        exposure: { mode: 'fixed', ev: 0.10 },
        fog: { mode: 'linear', start: 20, end: 52, color: [0.06, 0.075, 0.098] },
        bounce: [0.11, 0.12, 0.15],
    },
    foundry: {
        bg: '#130b08',
        hdri: 'belfast_sunset_puresky', envIntensity: 0.30, envRotation: 2.2,
        sunDir: sunDirection(40, 322), sunColor: [1.0, 0.78, 0.48], sunIntensity: 4.0,
        rimDir: sunDirection(24, 146), rimColor: [0.40, 0.66, 0.98], rimIntensity: 1.4,
        lampColor: [1.0, 0.64, 0.28], lampIntensity: 34,
        exposure: { mode: 'fixed', ev: 0.08 },
        fog: { mode: 'linear', start: 18, end: 48, color: [0.085, 0.055, 0.042] },
        bounce: [0.14, 0.09, 0.05],
    },
    daylight: {
        bg: '#1c2430',
        hdri: 'kloofendal_43d_clear_puresky', envIntensity: 0.45, envRotation: 2.0,
        sunDir: sunDirection(44, 332), sunColor: [1.0, 0.96, 0.88], sunIntensity: 3.8,
        rimDir: sunDirection(22, 150), rimColor: [0.58, 0.76, 0.98], rimIntensity: 0.85,
        lampColor: [1.0, 0.94, 0.84], lampIntensity: 14,
        exposure: { mode: 'fixed', ev: 0.15 },
        fog: { mode: 'linear', start: 26, end: 72, color: [0.14, 0.18, 0.23] },
        bounce: [0.15, 0.16, 0.19],
    },
};

let activeMood = 'atelier';

function applyBayLighting(moodKey = activeMood) {
    const m = BAY_MOODS[moodKey] || BAY_MOODS.atelier;
    activeMood = moodKey;
    vp.canvas.style.background = m.bg;
    skyEnvironment(scene, { hdri: m.hdri, intensity: m.envIntensity, rotation: m.envRotation, fallbackAmbient: [0.12, 0.14, 0.18] });
    sun.direction = m.sunDir; sun.color = m.sunColor; sun.intensity = m.sunIntensity;
    rim.direction = m.rimDir; rim.color = m.rimColor; rim.intensity = m.rimIntensity;
    bayLamp.color = m.lampColor; bayLamp.intensity = m.lampIntensity;
    scene.setExposure(m.exposure);
    scene.setFog(m.fog);
    if (typeof scene.setGroundBounce === 'function') scene.setGroundBounce(m.bounce);
}

function applyArenaLighting() {
    vp.canvas.style.background = '#1b222c';
    skyEnvironment(scene, { hdri: 'belfast_sunset_puresky', intensity: 0.48, rotation: 1.8, fallbackAmbient: [0.16, 0.18, 0.22] });
    sun.direction = sunDirection(28, 128);
    sun.color = [1.0, 0.89, 0.74];
    sun.intensity = 4.2;
    rim.direction = sunDirection(20, 305);
    rim.color = [0.52, 0.70, 0.96];
    rim.intensity = 0.80;
    bayLamp.intensity = 0;
    scene.setExposure({ mode: 'fixed', ev: 0.36 });
    scene.setFog({ mode: 'linear', start: 70, end: 230, color: [0.48, 0.52, 0.58] });
    if (typeof scene.setGroundBounce === 'function') scene.setGroundBounce([0.12, 0.13, 0.15]);
}

applyBayLighting('atelier');

let mode = 'bay';
let activeTier = 3;
let followCam = true;
let turretYaw = 0, turretPitch = 0.16;
let spadeLatch = false, fireQueued = false, clutchQueued = false;
const keys = new Set();

const bay = createFoundryBay(scene, vp, { onChanged: () => refreshInspector() });
const arena = createArena(scene);

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
    const sock = bay.state.selectedSocket || '+Y';
    $('sel-socket-badge').textContent = sock;
    for (const b of $('socket-dpad').querySelectorAll('button')) {
        b.classList.toggle('active', b.dataset.face === sock);
    }
    const activeMat = cn?.material || bay.state.activeAlloy;
    for (const b of $('alloy-swatches').querySelectorAll('button')) {
        b.classList.toggle('active', b.dataset.alloy === activeMat);
    }
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
        ? `Range [${j.lower.toFixed(2)}..${j.upper.toFixed(2)}], peak ${Math.round(ex.maxLoad)} / ${Math.round(ex.capacity)} (${(ex.stallMargin * 100).toFixed(0)}% margin)`
        : `${j.kind} motor rated to ${Math.round(j.maxEffort)}`;
}

function launchBattle() {
    mode = 'battle';
    document.body.classList.add('battle-mode');
    bay.setVisible(false);
    applyArenaLighting();
    $('mode-bay').classList.remove('active');
    $('mode-battle').classList.add('active');
    const enemyBp = bay.resolver($('enemy-select').value);
    const enemyCompiled = compileMachine(enemyBp, bay.resolver);
    arena.spawnMatch(bay.state.compiled, enemyCompiled);
    followCam = true;
    spadeLatch = false;
    vp.reframe([0, 2.4, 22], 21, { yaw: 0.34, pitch: -0.25 });
    $('hud-p-name').textContent = bay.state.compiled.name;
    $('hud-e-name').textContent = enemyCompiled.name;
    $('hud-p-pct').textContent = '100%';
    $('hud-e-pct').textContent = '100%';
    $('hud-p-bar').style.width = '100%';
    $('hud-e-bar').style.width = '100%';
    $('status').textContent = `Battle live: ${bay.state.compiled.name} vs ${enemyCompiled.name}`;
}

function enterBay() {
    mode = 'bay';
    document.body.classList.remove('battle-mode');
    arena.cleanup();
    applyBayLighting(activeMood);
    bay.setVisible(true);
    $('mode-battle').classList.remove('active');
    $('mode-bay').classList.add('active');
    bay.frameMachine(true);
    $('status').textContent = 'Assembly Bay ready — click parts or sockets, drag 3D arrows to edit';
}

$('mode-bay').addEventListener('click', enterBay);
$('mode-battle').addEventListener('click', launchBattle);
$('btn-reset-arena').addEventListener('click', launchBattle);
$('chk-live-stress').addEventListener('change', (e) => arena.setStressOverlay(e.target.checked));
$('chk-bench').addEventListener('change', (e) => { bay.state.benchTest = e.target.checked; });

for (const btn of $('mood-tabs').querySelectorAll('button')) {
    btn.addEventListener('click', () => {
        for (const b of $('mood-tabs').querySelectorAll('button')) b.classList.remove('active');
        btn.classList.add('active');
        activeMood = btn.dataset.mood;
        if (mode === 'bay') applyBayLighting(activeMood);
    });
}

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

for (const btn of $('socket-dpad').querySelectorAll('button')) {
    btn.addEventListener('click', () => {
        bay.setSelectedSocket(btn.dataset.face, true);
        refreshSelectionUI();
    });
}

for (const btn of $('alloy-swatches').querySelectorAll('button')) {
    btn.addEventListener('click', () => {
        bay.setSelectedAlloy(btn.dataset.alloy);
        refreshInspector();
    });
}

// Show CAD placement wireframe footprint while hovering Snap Unit / Armor Plate
for (const id of ['btn-attach-unit', 'btn-add-plate']) {
    $(id).addEventListener('mouseenter', () => { if (mode === 'bay') bay.setGhostPreview(true); });
    $(id).addEventListener('mouseleave', () => { if (mode === 'bay') bay.setGhostPreview(false); });
}

$('chk-mirror').addEventListener('change', (e) => { bay.state.mirrorX = e.target.checked; });
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
    if (typeof bro !== 'undefined' && bro.gizmo?.dragging) return;
    const pt = localPoint(vp.canvas, e);
    const ray = pickRay(vp, pt.x, pt.y);
    if (bay.handleClick(ray)) refreshSelectionUI();
});

let hoverTick = 0;
vp.canvas.addEventListener('mousemove', (e) => {
    if (mode !== 'bay' || e.buttons !== 0) return;
    if ((++hoverTick & 3) !== 0) return;
    const pt = localPoint(vp.canvas, e);
    const hit = bay.pickHover(pickRay(vp, pt.x, pt.y));
    vp.canvas.style.cursor = hit ? 'pointer' : 'default';
    if (hit) {
        $('status').textContent = hit.type === 'socket'
            ? `Hardpoint ${hit.socket} — click to target attachment face`
            : `Part: ${hit.label} — click to select & drag 3D arrows`;
    }
});

window.addEventListener('keydown', (e) => {
    if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT')) return;
    const k = e.key.toLowerCase();
    keys.add(k);
    if (mode === 'bay') {
        if (k === 'b') {
            $('chk-bench').checked = !$('chk-bench').checked;
            bay.state.benchTest = $('chk-bench').checked;
        } else if (k === 'delete' || k === 'backspace') {
            bay.deleteSelected(); refreshInspector();
        } else if (k === 'z' && (e.ctrlKey || e.metaKey)) {
            e.preventDefault(); bay.undo(); refreshInspector();
        } else if (k >= '1' && k <= '4') {
            const map = ['off', 'recoil', 'actuate', 'gravity'];
            const c = map[+k - 1];
            bay.state.loadCase = c;
            for (const b of $('loadcase-tabs').querySelectorAll('button')) b.classList.toggle('active', b.dataset.case === c);
            bay.render();
        }
    } else if (mode === 'battle') {
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
            if (++frameCounter % 6 === 0) {
                const pPct = Math.round(stats.playerIntegrity * 100);
                const ePct = Math.round(stats.enemyIntegrity * 100);
                $('stat-step').textContent = stats.stepMs.toFixed(2);
                $('stat-integrity').textContent = `Player ${pPct}% · Broken ${stats.playerBroken}`;
                $('stat-enemy').textContent = `${ePct}% (broken ${stats.enemyBroken})`;
                $('stat-shells').textContent = String(stats.shells);
                $('hud-p-pct').textContent = `${pPct}%`;
                $('hud-e-pct').textContent = `${ePct}%`;
                $('hud-p-bar').style.width = `${pPct}%`;
                $('hud-e-bar').style.width = `${ePct}%`;
            }
        }
    }
    if (++frameCounter % 15 === 0) {
        $('stat-fps').textContent = fps.fps ? fps.fps.toFixed(0) : '—';
    }
});

refreshCatalogUI();
refreshInspector();
