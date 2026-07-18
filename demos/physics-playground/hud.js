// hud.js — the switchboard.
//
// One direction only: DOM control -> `state` -> a Physics.* call. Nothing
// reads back out of the engine to drive a control, with the single deliberate
// exception of the selected-body panel, which seeds its sliders from
// Physics.getBodyProperties so what you see is the body's real state rather
// than whatever the sliders last happened to say.
//
// That one-way discipline is what lets tests/test_smoke.js drive the app
// through exactly the code path a human uses — call setStepRate(15) and the
// test has provably exercised the same line the slider does.

import {
    LAYER_NAMES, SPAWN_LAYERS, LAYER_COLORS,
    getMatrix, setPair, resetLayers, collides,
} from '/app/layers.js';
import { AREA_DEFS, areas, setAreaEnabled, setAreaParam } from '/app/areas.js';
import { bodies, bodyCount, spawn, rain, materialRace, clearAll, despawn } from '/app/spawn.js';
import {
    ragdolls, ragdollCount, totalPartCount, spawnRagdoll, ragdollRain,
    driveRagdoll, stopDrive, poseError, punchPart, selectPart, selection,
    selectionLabel, clearRagdolls, PART_NAMES, POSE_NAMES,
} from '/app/ragdoll.js';
import {
    buildCloth, buildBall, setBallPressure, setPinSet, getCloth, getBall,
    gust, poke, clearSoftBodies, CLOTH, PIN_SETS,
} from '/app/softbody.js';
import {
    machines, mechanisms, AXIS_NAMES, AXIS_MODES, modeOf, setAxisMode, setMotor,
    machineOffset, setCollideConnected, getCollideConnected, collideSeparation,
    setGearDrive, setGearRatio, resetGears, setRackDrive, rackOffset, resetRack, resetPulley,
    fireTurret, craneLoad, loadPiston, clearMachineDebris, setShowAllAxes, resetMachines,
    setTurretTracking,
} from '/app/machines.js';
import {
    bridge, setThreshold, brokenCount, jointCount, dropWreckingBall,
    fireProjectile, rebuildBridge, clearRubble,
} from '/app/breakables.js';
import {
    state as cstate, recent as contactLog, setFocus as setContactFocus,
    clearContacts,
} from '/app/contacts.js';

const $ = (id) => document.getElementById(id);

export const state = {
    stepHz: 60,
    interpolation: false,
    spawnShape: 'box',
    spawnLayer: 'player',
    spawnFriction: 0.5,
    spawnRestitution: 0.35,
    selected: null,          // body tag or null
    frictionCombine: 'default',
    restitutionCombine: 'default',
    // Ragdoll / soft-body controls
    drivePose: 'stand',
    driveKinematic: false,
    motorFreq: 12,
    pinSet: 'corners',
    ballPressure: 2500,
    // Chunk 3 — machines, breakables, contacts
    craneSlew: 0.0,
    winchTarget: -2.0,
    pistonTarget: 0.0,
    turretTracking: true,
    collideConnected: false,
    gearSpeed: 2.5,
    gearRatio: 2.0,
    rackSpeed: 1.6,
    showAxes: true,
    breakThreshold: 900,
    contactsEnabled: true,
    contactDraw: true,
    contactDrawAll: false,
    contactEffects: true,
    contactMinImpulse: 6.0,
};

let stageRef = null;

// --- Simulation rate + interpolation ----------------------------------------
//
// setTimeStep is the demo's most important control. The engine steps the world
// at this fixed rate while rendering runs free, so at 15 Hz a body's true pose
// updates four times for every ~60 rendered frames — which is exactly the
// staircase that interpolation smooths over.

export function setStepRate(hz) {
    state.stepHz = hz;
    Physics.setTimeStep(1 / hz);
    if ($('stepHz')) $('stepHz').value = String(hz);
    if ($('stepHzVal')) $('stepHzVal').textContent = `${hz} Hz`;
    if ($('stStep')) $('stStep').textContent = `${hz} Hz`;
}

export function setInterpolation(on) {
    state.interpolation = !!on;
    Physics.setInterpolation(!!on);
    if ($('interp')) $('interp').checked = !!on;
    if ($('stInterp')) $('stInterp').textContent = on ? 'on' : 'off';
}

// --- Spawning ---------------------------------------------------------------

export function spawnCurrent(pos, extra = {}) {
    return spawn(state.spawnShape, pos, {
        layer: state.spawnLayer,
        friction: state.spawnFriction,
        restitution: state.spawnRestitution,
        ...extra,
    });
}

/** Drop one object above the middle of the stage. */
export function dropOne() {
    return spawnCurrent({ x: -2 + Math.random() * 4, y: 9, z: -2 + Math.random() * 4 });
}

// --- Selection --------------------------------------------------------------
//
// Selecting reads the body's ACTUAL properties back through
// getBodyProperties and pushes them into the sliders, so the panel is a live
// view of one body rather than a set of write-only knobs. Everything after
// that is a one-line setter.

export function select(tag) {
    state.selected = bodies.has(tag) ? tag : null;
    refreshSelection();
    return state.selected;
}

export function refreshSelection() {
    const info = $('selInfo');
    const panel = $('selControls');
    if (!info || !panel) return;

    const tag = state.selected;
    if (tag == null) {
        info.textContent = 'nothing selected — click a body';
        panel.classList.add('disabled');
        return;
    }
    const props = Physics.getBodyProperties(tag);
    const entry = bodies.get(tag);
    if (!props || !entry) {
        state.selected = null;
        info.textContent = 'nothing selected — click a body';
        panel.classList.add('disabled');
        return;
    }
    panel.classList.remove('disabled');

    const sw = `<span style="color:${LAYER_COLORS[entry.layer]}">■</span>`;
    info.innerHTML =
        `${sw} <b>#${tag}</b> ${entry.kind} on <b>${entry.layer}</b><br>` +
        `mass ${props.mass.toFixed(2)} kg · fric ${props.friction.toFixed(2)} · ` +
        `rest ${props.restitution.toFixed(2)}<br>` +
        `damp ${props.linearDamping.toFixed(2)}/${props.angularDamping.toFixed(2)} · ` +
        `grav x${props.gravityFactor.toFixed(2)}`;

    const put = (id, v, digits = 2) => {
        const el = $(id); if (el) el.value = String(v);
        const lbl = $(id + 'Val'); if (lbl) lbl.textContent = v.toFixed(digits);
    };
    put('pMass', props.mass);
    put('pFriction', props.friction);
    put('pRestitution', props.restitution);
    put('pLinDamp', props.linearDamping);
    put('pAngDamp', props.angularDamping);
    put('pGravFactor', props.gravityFactor);
}

/** Mutate one property on the selected body and re-read the result. */
export function setSelectedProp(name, value) {
    const tag = state.selected;
    if (tag == null) return false;
    switch (name) {
        case 'mass':           Physics.setMass(tag, value); break;
        case 'friction':       Physics.setFriction(tag, value); break;
        case 'restitution':    Physics.setRestitution(tag, value); break;
        case 'linearDamping':  Physics.setLinearDamping(tag, value); break;
        case 'angularDamping': Physics.setAngularDamping(tag, value); break;
        case 'gravityFactor':  Physics.setGravityFactor(tag, value); break;
        default: return false;
    }
    Physics.activate(tag);
    refreshSelection();
    return true;
}

const COMBINE_MODES = ['default', 'average', 'min', 'multiply', 'max'];

export function setCombine(which, mode) {
    const tag = state.selected;
    if (which === 'friction') {
        state.frictionCombine = mode;
        if (tag != null) Physics.setFrictionCombine(tag, mode);
    } else {
        state.restitutionCombine = mode;
        if (tag != null) Physics.setRestitutionCombine(tag, mode);
    }
    if (tag != null) Physics.activate(tag);
    syncCombineButtons();
    return true;
}

function syncCombineButtons() {
    for (const [rowId, cur] of [['fricCombineRow', state.frictionCombine],
                                ['restCombineRow', state.restitutionCombine]]) {
        const row = $(rowId);
        if (!row) continue;
        for (const b of row.querySelectorAll('button')) {
            b.classList.toggle('sel', b.dataset.mode === cur);
        }
    }
}

// --- Ragdolls ----------------------------------------------------------------
//
// One ragdoll is "the" ragdoll for the purposes of the panel: whichever one
// owns the selected part, falling back to the most recently spawned. Every
// control below acts on that one, which keeps the panel to three buttons
// instead of a list widget nobody would read.

function activeRagdoll() {
    if (selection.entry && ragdolls.has(selection.entry.id)) return selection.entry;
    let last = null;
    for (const e of ragdolls.values()) last = e;
    return last;
}

/** Drop a ragdoll above the middle of the stage, gently spun. */
export function dropRagdoll(pos) {
    const e = spawnRagdoll(pos || { x: -2 + Math.random() * 6, y: 5.5, z: -2 + Math.random() * 4 });
    refreshRagdollHud();
    return e;
}

export function dropRagdollRain(n = 5) {
    const out = ragdollRain(n);
    refreshRagdollHud();
    return out;
}

/**
 * Select one part of one ragdoll — the click-to-punch path, called from
 * app.js's raycast when the hit body turns out to belong to a ragdoll.
 */
export function selectRagdollPart(entry, index) {
    const r = selectPart(entry, index);
    // A part and a loose rigid body are mutually exclusive selections; leaving
    // both lit would make the two "poke" buttons ambiguous.
    if (r) { state.selected = null; refreshSelection(); }
    refreshRagdollHud();
    return r;
}

/**
 * Punch the selected part (or the head, if nothing is selected, because an
 * unaimed punch to the head is the most satisfying default there is).
 */
export function punchSelected(dir, strength = 12) {
    const e = activeRagdoll();
    if (!e) return false;
    const idx = selection.entry === e && selection.index >= 0 ? selection.index : PART_NAMES.indexOf('head');
    const ok = punchPart(e, idx, dir || { x: 1, y: 0.35, z: 0 }, strength);
    refreshRagdollHud();
    return ok;
}

export function driveSelected(poseName, kinematic) {
    const e = activeRagdoll();
    if (!e) return false;
    const pose = poseName || state.drivePose;
    const kin = kinematic == null ? state.driveKinematic : !!kinematic;
    state.drivePose = pose;
    state.driveKinematic = kin;
    const ok = driveRagdoll(e, pose, kin, { frequency: state.motorFreq, damping: 1.0 });
    refreshRagdollHud();
    return ok;
}

export function limpSelected() {
    const e = activeRagdoll();
    if (!e) return false;
    stopDrive(e);
    refreshRagdollHud();
    return true;
}

export function refreshRagdollHud() {
    if ($('stRagdolls')) $('stRagdolls').textContent = String(ragdollCount());
    if ($('stParts')) $('stParts').textContent = String(totalPartCount());

    const info = $('partInfo');
    if (info) {
        const sel = selectionLabel();
        info.textContent = sel
            ? `ragdoll #${sel.id} · part ${sel.index} of ${PART_NAMES.length} — ${sel.name}`
            : 'no part selected — click a limb';
    }

    const di = $('driveInfo');
    if (di) {
        const e = activeRagdoll();
        if (!e) di.textContent = 'no ragdoll';
        else if (e.drive.mode === 'off') di.textContent = `ragdoll #${e.id} — limp`;
        else {
            // Pose error is the only honest progress readout for a motorised
            // drive: the motors chase joint ANGLES, not world positions.
            const err = poseError(e, e.drive.pose);
            di.textContent =
                `#${e.id} — ${e.drive.mode === 'kinematic' ? 'kinematic' : 'motorised'} ` +
                `→ ${e.drive.pose} · pose error ${(err * 180 / Math.PI).toFixed(1)}°`;
        }
    }
}

// --- Soft bodies -------------------------------------------------------------

export function setClothPins(set) {
    state.pinSet = set;
    setPinSet(set);
    const row = $('pinRow');
    if (row) for (const b of row.querySelectorAll('button')) b.classList.toggle('sel', b.dataset.pin === set);
    if ($('pinHint') && PIN_SETS[set]) {
        $('pinHint').innerHTML =
            `<b>${set}</b> — ${PIN_SETS[set]}. Pinned vertices carry invMass 0: ` +
            `they do not move at all while the sheet between them sags.`;
    }
    return true;
}

/** Rain a few boxes into the middle of the cloth so it visibly deforms. */
export function dropOntoCloth(n = 5) {
    const c = getCloth();
    if (!c) return [];
    const out = [];
    for (let i = 0; i < n; i++) {
        out.push(spawn('box', {
            x: CLOTH.position.x + (Math.random() - 0.5) * 1.4,
            y: CLOTH.position.y + 3 + i * 0.6,
            z: CLOTH.position.z + (Math.random() - 0.5) * 1.4,
        }, { layer: 'player', friction: 0.8, restitution: 0.1, mass: 4 }));
    }
    refreshCount();
    return out;
}

export function gustCloth(strength = 6) {
    const c = getCloth();
    return c ? gust(c, strength) : [];
}

export function setPressure(p) {
    state.ballPressure = p;
    if ($('ballPressure')) $('ballPressure').value = String(p);
    if ($('ballPressureVal')) $('ballPressureVal').textContent = String(Math.round(p));
    return setBallPressure(p);
}

export function dropBall(pressure) {
    return setPressure(pressure == null ? state.ballPressure : pressure);
}

export function pokeBall(depth = 0.35) {
    const b = getBall();
    return b ? poke(b, depth) : [];
}

// --- Machines: the axis grid -------------------------------------------------
//
// One row per axis per machine, three buttons per row. This grid IS the SixDOF
// demo: it is the only place in broworkshop where a user can take a joint apart
// one degree of freedom at a time and watch the machine change behaviour.
//
// Flipping a button destroys and rebuilds the constraint (Jolt bakes the DoF
// layout at construction). The bodies are untouched, so a crane mid-slew keeps
// its momentum through the rebuild.

export function setAxis(key, axis, mode) {
    const ok = setAxisMode(key, axis, mode);
    syncAxisGrid();
    return ok;
}

/** Point one machine's motor at a target. The HUD's only motor entry point. */
export function driveMotor(key, axis, target, extra = {}) {
    const m = machines.get(key);
    if (!m) return false;
    const cur = m.motors[axis] || {};
    return setMotor(key, axis, { type: 'position', maxForce: 60000, maxTorque: 40000,
                                 frequency: 4, damping: 1, ...cur, ...extra, target });
}

function buildAxisGrid() {
    const host = $('axisGrid');
    if (!host) return;
    host.innerHTML = '';
    for (const m of machines.values()) {
        const box = document.createElement('div');
        box.className = 'machine';

        const h = document.createElement('div');
        h.className = 'mtitle';
        h.textContent = m.label;
        box.appendChild(h);

        const hint = document.createElement('div');
        hint.className = 'area-hint';
        hint.textContent = m.hint;
        box.appendChild(hint);

        for (const axis of AXIS_NAMES) {
            const row = document.createElement('div');
            row.className = 'axisrow';
            const lbl = document.createElement('span');
            // "translationY" -> "tY"; the grid is six rows deep per machine and
            // the full names would triple its height for no information.
            lbl.textContent = (axis.startsWith('translation') ? 't' : 'r') + axis.slice(-1);
            lbl.className = 'ax ax' + axis.slice(-1);
            row.appendChild(lbl);
            for (const mode of AXIS_MODES) {
                const b = document.createElement('button');
                b.textContent = mode === 'limited' ? 'lim' : mode;
                b.dataset.key = m.key; b.dataset.axis = axis; b.dataset.mode = mode;
                b.addEventListener('click', () => setAxis(m.key, axis, mode));
                row.appendChild(b);
            }
            box.appendChild(row);
        }
        host.appendChild(box);
    }
    syncAxisGrid();
}

function syncAxisGrid() {
    const host = $('axisGrid');
    if (!host) return;
    for (const b of host.querySelectorAll('button')) {
        const m = machines.get(b.dataset.key);
        b.classList.toggle('sel', !!m && modeOf(m.axes[b.dataset.axis]) === b.dataset.mode);
    }
}

// --- Breakables ---------------------------------------------------------------

export function setBreakThreshold(n) {
    state.breakThreshold = n;
    setThreshold(n);
    if ($('breakThresh')) $('breakThresh').value = String(n);
    if ($('breakThreshVal')) $('breakThreshVal').textContent = n >= 20000 ? '∞' : String(Math.round(n));
    if ($('breakHint')) {
        $('breakHint').textContent = n < 300
            ? 'fragile — the deck cannot even hold itself up'
            : n < 1500 ? 'realistic — a heavy impact tears it open'
            : n < 20000 ? 'tough — takes a full-speed shell'
            : 'indestructible — breakingImpulse this high never trips';
    }
    return true;
}

export function smashBridge() { return dropWreckingBall(900, 12); }
export function shootBridge() { return fireProjectile(70, 140); }

// --- Contacts ------------------------------------------------------------------

export function setContactsEnabled(on) { cstate.enabled = state.contactsEnabled = !!on; return true; }
export function setContactDraw(on)     { cstate.draw    = state.contactDraw    = !!on; return true; }
export function setContactDrawAll(on)  { cstate.drawAll = state.contactDrawAll = !!on; return true; }
export function setContactEffects(on)  { cstate.effects = state.contactEffects = !!on; return true; }
export function setContactThreshold(v) {
    cstate.minImpulse = state.contactMinImpulse = v;
    if ($('cMinImp')) $('cMinImp').value = String(v);
    if ($('cMinImpVal')) $('cMinImpVal').textContent = v.toFixed(1);
    return true;
}

/**
 * The chunk-3 readouts, refreshed on the same cadence as the fps counter —
 * three times a second, which is fast enough to feel live and slow enough that
 * rebuilding a table of contact rows costs nothing.
 */
export function refreshChunk3Hud() {
    // Machine offsets.
    const put = (id, txt) => { const el = $(id); if (el) el.textContent = txt; };
    put('mCrane', `${(machineOffset('crane', 'rotationY') * 180 / Math.PI).toFixed(0)}°`);
    put('mWinch', `${machineOffset('winch', 'translationY').toFixed(2)} m`);
    put('mPiston', `${machineOffset('piston', 'translationY').toFixed(2)} m`);
    const t = machines.get('turret');
    put('mTurret', t && t.aim ? `${(t.aim.yaw * 180 / Math.PI).toFixed(0)}° / ${(t.aim.pitch * 180 / Math.PI).toFixed(0)}°` : '—');

    // collideConnected: the measured separation IS the proof, so it is a live
    // number rather than a checkbox state echoed back.
    const sep = collideSeparation();
    put('ccSep', `${sep.toFixed(3)} m`);
    const ccHintEl = $('ccHint');
    if (ccHintEl) {
        ccHintEl.textContent = getCollideConnected()
            ? 'ON — contact wins: the spheres are pushed apart past the rope\'s own 0.4 m cap.'
            : 'OFF — the pair is excluded from collision, so the rope wins and the spheres merge to 0.40 m.';
    }

    put('mRack', `${rackOffset().toFixed(2)} m`);

    // Breakables.
    put('stBroken', `${brokenCount()} / ${jointCount()}`);
    const log = $('breakLog');
    if (log) {
        log.innerHTML = bridge.log.length
            ? bridge.log.slice(-6).reverse()
                .map(o => `<div>#${o.handle} <b>${o.kind}</b> ${o.index}</div>`).join('')
            : '<div class="dim">no joints broken</div>';
    }

    // Contacts.
    put('stContacts', String(cstate.lastCount));
    const meter = $('impactBar');
    if (meter) {
        const pct = Math.min(100, (cstate.peakImpulse / 600) * 100);
        meter.style.width = `${pct.toFixed(1)}%`;
    }
    put('impactVal', `${cstate.peakImpulse.toFixed(0)} N·s`);

    const list = $('contactList');
    if (list) {
        list.innerHTML = contactLog.length
            ? contactLog.slice(0, 6).map(c => {
                const n = c.normal
                    ? `${c.normal.x.toFixed(2)},${c.normal.y.toFixed(2)},${c.normal.z.toFixed(2)}` : '—';
                // Negative penetration is a SPECULATIVE contact — Jolt predicted
                // a touch it has not solved yet. Labelling it beats printing a
                // negative depth and letting the reader think it is a bug.
                const pen = c.penetration < 0
                    ? `<i>spec ${(c.penetration * 1000).toFixed(1)}mm</i>`
                    : `${(c.penetration * 1000).toFixed(1)}mm`;
                return `<div class="crow${c.focused ? ' hot' : ''}">` +
                       `<span>#${c.body1}·#${c.body2}</span>` +
                       `<span>${c.n}pt</span><span>${pen}</span>` +
                       `<span class="imp">${c.impulse.toFixed(0)}</span>` +
                       `<span class="nrm">n ${n}</span></div>`;
            }).join('')
            : '<div class="dim">no contacts yet — drop something</div>';
    }
}

// --- Readouts ---------------------------------------------------------------

export function setFps(v) { if ($('fps')) $('fps').textContent = `${v.toFixed(0)} fps`; }
export function refreshCount() { if ($('stBodies')) $('stBodies').textContent = String(bodyCount()); }

// --- Panel construction -----------------------------------------------------

function buildAreaPanel() {
    const host = $('areaList');
    if (!host) return;
    host.innerHTML = '';
    for (const def of AREA_DEFS) {
        const a = areas.get(def.key);
        const box = document.createElement('div');
        box.className = 'area' + (a.enabled ? '' : ' off');
        const c = def.color;
        box.style.borderLeftColor =
            `rgb(${Math.round(c[0] * 255)},${Math.round(c[1] * 255)},${Math.round(c[2] * 255)})`;

        const head = document.createElement('label');
        head.className = 'check';
        const cb = document.createElement('input');
        cb.type = 'checkbox';
        cb.checked = a.enabled;
        cb.addEventListener('change', () => {
            setAreaEnabled(def.key, cb.checked);
            box.classList.toggle('off', !cb.checked);
        });
        const nm = document.createElement('span');
        nm.textContent = def.label;
        head.appendChild(cb); head.appendChild(nm);
        box.appendChild(head);

        const hint = document.createElement('div');
        hint.className = 'area-hint';
        hint.textContent = def.hint;
        box.appendChild(hint);

        for (const ctl of def.controls) {
            const row = document.createElement('label');
            row.className = 'row';
            const lbl = document.createElement('span');
            lbl.textContent = ctl.label;
            const inp = document.createElement('input');
            inp.type = 'range';
            inp.min = String(ctl.min); inp.max = String(ctl.max); inp.step = String(ctl.step);
            inp.value = String(a.params[ctl.key]);
            const val = document.createElement('b');
            val.textContent = Number(a.params[ctl.key]).toFixed(2);
            inp.addEventListener('input', () => {
                const v = parseFloat(inp.value);
                setAreaParam(def.key, ctl.key, v);
                val.textContent = v.toFixed(2);
            });
            row.appendChild(lbl); row.appendChild(inp); row.appendChild(val);
            box.appendChild(row);
        }
        host.appendChild(box);
    }
}

function buildLayerMatrix() {
    const host = $('layerMatrix');
    if (!host) return;
    host.innerHTML = '';
    const n = LAYER_NAMES.length;

    host.appendChild(document.createElement('div'));   // empty top-left corner
    for (const name of LAYER_NAMES) {
        const h = document.createElement('div');
        h.className = 'mh';
        h.textContent = name.slice(0, 4);
        h.title = name;
        host.appendChild(h);
    }
    for (let i = 0; i < n; i++) {
        const r = document.createElement('div');
        r.className = 'mr';
        r.textContent = LAYER_NAMES[i];
        host.appendChild(r);
        for (let j = 0; j < n; j++) {
            const cell = document.createElement('div');
            if (i === j) cell.className = 'diag';
            const cb = document.createElement('input');
            cb.type = 'checkbox';
            cb.checked = collides(i, j);
            cb.dataset.i = String(i);
            cb.dataset.j = String(j);
            cb.addEventListener('change', () => {
                setPair(i, j, cb.checked);
                syncLayerMatrix();
            });
            cell.appendChild(cb);
            host.appendChild(cell);
        }
    }
}

/** Re-read the matrix into the checkboxes — needed because setPair writes
 *  BOTH cells of a symmetric pair, so flipping one moves two boxes. */
function syncLayerMatrix() {
    const host = $('layerMatrix');
    if (!host) return;
    const m = getMatrix();
    const n = LAYER_NAMES.length;
    for (const cb of host.querySelectorAll('input')) {
        cb.checked = m[(+cb.dataset.i) * n + (+cb.dataset.j)];
    }
}

function buildLayerButtons() {
    const row = $('layerRow');
    if (!row) return;
    row.innerHTML = '';
    for (const name of SPAWN_LAYERS) {
        const b = document.createElement('button');
        b.className = 'layer' + (name === state.spawnLayer ? ' sel' : '');
        b.style.borderLeftColor = LAYER_COLORS[name];
        b.textContent = name;
        b.dataset.layer = name;
        b.addEventListener('click', () => {
            state.spawnLayer = name;
            for (const o of row.querySelectorAll('button')) o.classList.toggle('sel', o === b);
        });
        row.appendChild(b);
    }
}

function buildCombineButtons() {
    for (const [rowId, which] of [['fricCombineRow', 'friction'], ['restCombineRow', 'restitution']]) {
        const row = $(rowId);
        if (!row) continue;
        row.innerHTML = '';
        const tag = document.createElement('span');
        tag.style.cssText = 'flex:0 0 100%;color:#7f8b99;font-size:10px';
        tag.textContent = which === 'friction' ? 'friction combine' : 'restitution combine';
        row.appendChild(tag);
        for (const mode of COMBINE_MODES) {
            const b = document.createElement('button');
            b.textContent = mode;
            b.dataset.mode = mode;
            b.addEventListener('click', () => setCombine(which, mode));
            row.appendChild(b);
        }
    }
    syncCombineButtons();
}

function buildLaneLegend() {
    const host = $('laneLegend');
    if (!host || !stageRef) return;
    host.innerHTML = '';
    for (const m of stageRef.MATERIALS) {
        const d = document.createElement('div');
        d.className = 'lane';
        d.innerHTML =
            `<span class="sw" style="background:${m.color}"></span>` +
            `<span class="ln">${m.label}</span>` +
            `<span class="lv">μ ${m.friction.toFixed(2)} · e ${m.restitution.toFixed(2)} — ${m.note}</span>`;
        host.appendChild(d);
    }
}

// --- Wiring -----------------------------------------------------------------

/**
 * Bind every control and push the initial state at the engine, so the first
 * simulated step already matches what the panel says.
 */
export function bindHud(stage) {
    stageRef = stage;

    buildLayerButtons();
    buildAreaPanel();
    buildLayerMatrix();
    buildCombineButtons();
    buildLaneLegend();
    buildAxisGrid();
    bindCollapsibles();

    $('stepHz').addEventListener('input', (e) => setStepRate(parseInt(e.target.value, 10)));
    $('interp').addEventListener('change', (e) => setInterpolation(e.target.checked));

    const shapeRow = $('shapeRow');
    for (const b of shapeRow.querySelectorAll('button')) {
        b.addEventListener('click', () => {
            state.spawnShape = b.dataset.shape;
            for (const o of shapeRow.querySelectorAll('button')) o.classList.toggle('sel', o === b);
        });
    }

    const bindSpawnSlider = (id, key, digits = 2) => {
        const el = $(id);
        el.addEventListener('input', () => {
            state[key] = parseFloat(el.value);
            $(id + 'Val').textContent = state[key].toFixed(digits);
        });
    };
    bindSpawnSlider('spawnFriction', 'spawnFriction');
    bindSpawnSlider('spawnRestitution', 'spawnRestitution');

    $('btnDrop').addEventListener('click', () => { dropOne(); refreshCount(); });
    $('btnRace').addEventListener('click', () => { materialRace(stageRef); refreshCount(); });
    $('btnRain').addEventListener('click', () => { rain(40); refreshCount(); });
    $('btnRain200').addEventListener('click', () => { rain(200); refreshCount(); });
    $('btnClear').addEventListener('click', () => { clearAll(); select(null); refreshCount(); });

    // Selected-body property sliders. Each is one setter plus a re-read, and
    // the re-read is what keeps the text readout honest about clamping —
    // setMass ignores values <= 0, for instance.
    const bindProp = (id, prop, digits = 2) => {
        const el = $(id);
        el.addEventListener('input', () => {
            const v = parseFloat(el.value);
            $(id + 'Val').textContent = v.toFixed(digits);
            setSelectedProp(prop, v);
        });
    };
    bindProp('pMass', 'mass');
    bindProp('pFriction', 'friction');
    bindProp('pRestitution', 'restitution');
    bindProp('pLinDamp', 'linearDamping');
    bindProp('pAngDamp', 'angularDamping');
    bindProp('pGravFactor', 'gravityFactor');

    // Two different pokes live in this panel — an impulse on the selected rigid
    // body and a setVertex dent on the soft ball. They had the same element id,
    // so getElementById resolved both bindings onto the soft-body button and
    // the rigid poke never fired at all.
    $('btnPokeBody').addEventListener('click', () => {
        if (state.selected == null) return;
        const p = Physics.getBodyProperties(state.selected);
        const k = Math.max(1, p ? p.mass : 1) * 6;
        Physics.addImpulse(state.selected, k * 0.6, k, 0);
    });
    $('btnDelete').addEventListener('click', () => {
        if (state.selected == null) return;
        despawn(state.selected);
        select(null);
        refreshCount();
    });

    $('btnResetLayers').addEventListener('click', () => { resetLayers(); syncLayerMatrix(); });

    // --- Ragdolls ---
    $('btnRagdoll').addEventListener('click', () => dropRagdoll());
    $('btnRagdollRain').addEventListener('click', () => dropRagdollRain(5));
    $('btnPunch').addEventListener('click', () => punchSelected({ x: 1, y: 0.3, z: 0 }, 14));
    $('btnUppercut').addEventListener('click', () => punchSelected({ x: 0.15, y: 1, z: 0 }, 20));
    $('btnClearRagdolls').addEventListener('click', () => { clearRagdolls(); refreshRagdollHud(); });

    const poseRow = $('poseRow');
    for (const b of poseRow.querySelectorAll('button')) {
        b.addEventListener('click', () => {
            state.drivePose = b.dataset.pose;
            for (const o of poseRow.querySelectorAll('button')) o.classList.toggle('sel', o === b);
        });
    }
    $('driveKinematic').addEventListener('change', (e) => {
        state.driveKinematic = e.target.checked;
        // Re-issue immediately if a drive is already running, so the checkbox
        // switches modes live rather than at the next button press — that
        // mid-drive switch is the clearest way to feel the difference.
        const r = activeRagdoll();
        if (r && r.drive.mode !== 'off') driveSelected();
    });
    const mf = $('motorFreq');
    mf.addEventListener('input', () => {
        state.motorFreq = parseFloat(mf.value);
        $('motorFreqVal').textContent = state.motorFreq.toFixed(1);
        const r = activeRagdoll();
        if (r && r.drive.mode === 'motor') driveSelected();
    });
    $('btnDrive').addEventListener('click', () => driveSelected());
    $('btnLimp').addEventListener('click', () => limpSelected());

    // --- Soft bodies ---
    const pinRow = $('pinRow');
    for (const b of pinRow.querySelectorAll('button')) {
        b.addEventListener('click', () => setClothPins(b.dataset.pin));
    }
    $('btnClothDrop').addEventListener('click', () => dropOntoCloth(5));
    $('btnGust').addEventListener('click', () => gustCloth(6));
    const bp = $('ballPressure');
    bp.addEventListener('input', () => setPressure(parseFloat(bp.value)));
    $('btnBallDrop').addEventListener('click', () => dropBall());
    $('btnPoke').addEventListener('click', () => pokeBall(0.35));
    $('btnSoftClear').addEventListener('click', () => clearSoftBodies());

    // --- Machines ---
    const bindMachineSlider = (id, fn, digits = 2, suffix = '') => {
        const el = $(id);
        if (!el) return;
        el.addEventListener('input', () => {
            const v = parseFloat(el.value);
            const lbl = $(id + 'Val');
            if (lbl) lbl.textContent = v.toFixed(digits) + suffix;
            fn(v);
        });
    };
    // Slew is a VELOCITY motor and the winch/piston are POSITION motors, which
    // is the contrast the two kinds of slider are here to make: one sets a rate
    // the machine holds forever, the others set a place it goes and stays.
    bindMachineSlider('craneSlew', (v) => {
        state.craneSlew = v;
        setMotor('crane', 'rotationY', { type: 'velocity', target: v, maxTorque: 40000 });
    }, 2, ' rad/s');
    bindMachineSlider('winchTarget', (v) => {
        state.winchTarget = v;
        setMotor('winch', 'translationY', { type: 'position', target: v, maxForce: 60000, frequency: 4, damping: 1 });
    }, 2, ' m');
    bindMachineSlider('pistonTarget', (v) => {
        state.pistonTarget = v;
        setMotor('piston', 'translationY', { type: 'position', target: v, maxForce: 120000, frequency: 5, damping: 1 });
    }, 2, ' m');
    bindMachineSlider('gearSpeed', (v) => { state.gearSpeed = v; setGearDrive(v); }, 1, ' rad/s');
    // Re-datum before re-coupling: a gear constraint locks the two hinge
    // angles as they are at creation, so changing the ratio mid-spin would
    // otherwise bake the current transient into the new coupling.
    bindMachineSlider('gearRatio', (v) => {
        state.gearRatio = v;
        resetGears(); setGearRatio(v); setGearDrive(state.gearSpeed);
    }, 1, ':1');
    bindMachineSlider('rackSpeed', (v) => { state.rackSpeed = v; setRackDrive(v); }, 1, ' rad/s');

    $('btnCraneLoad').addEventListener('click', () => craneLoad());
    $('btnPistonLoad').addEventListener('click', () => loadPiston(3));
    $('btnFireTurret').addEventListener('click', () => fireTurret(34));
    $('btnResetPulley').addEventListener('click', () => resetPulley());
    $('btnResetRack').addEventListener('click', () => { resetRack(); setRackDrive(state.rackSpeed); });
    $('btnClearMachines').addEventListener('click', () => clearMachineDebris());
    // The axis grid is a loaded gun by design: free the piston's tX and the
    // platform slides off its own lift. This is the way back.
    $('btnResetMachines').addEventListener('click', () => { resetMachines(); syncAxisGrid(); });
    $('turretTrack').addEventListener('change', (e) => {
        state.turretTracking = e.target.checked;
        setTurretTracking(e.target.checked);
    });
    $('showAxes').addEventListener('change', (e) => {
        state.showAxes = e.target.checked;
        setShowAllAxes(e.target.checked);
    });
    $('collideConnected').addEventListener('change', (e) => {
        state.collideConnected = e.target.checked;
        setCollideConnected(e.target.checked);
    });

    // --- Breakables ---
    $('breakThresh').addEventListener('input', (e) => setBreakThreshold(parseFloat(e.target.value)));
    $('btnSmash').addEventListener('click', () => smashBridge());
    $('btnShoot').addEventListener('click', () => shootBridge());
    $('btnRebuild').addEventListener('click', () => { rebuildBridge(); setBreakThreshold(state.breakThreshold); });
    $('btnClearRubble').addEventListener('click', () => clearRubble());

    // --- Contacts ---
    $('cEnabled').addEventListener('change', (e) => setContactsEnabled(e.target.checked));
    $('cDraw').addEventListener('change', (e) => setContactDraw(e.target.checked));
    $('cDrawAll').addEventListener('change', (e) => setContactDrawAll(e.target.checked));
    $('cEffects').addEventListener('change', (e) => setContactEffects(e.target.checked));
    $('cMinImp').addEventListener('input', (e) => setContactThreshold(parseFloat(e.target.value)));
    $('btnContactClear').addEventListener('click', () => { clearContacts(); setContactFocus(null); });

    // Push the panel's defaults at the engine before the first step.
    setStepRate(state.stepHz);
    setInterpolation(state.interpolation);
    refreshSelection();
    refreshCount();

    // The cloth and the ball are permanent fixtures rather than spawned on
    // demand — an empty "Soft bodies" panel would say nothing about what soft
    // bodies look like.
    setClothPins(state.pinSet);
    setPressure(state.ballPressure);
    refreshRagdollHud();

    // Chunk 3's defaults, pushed the same way: the machines' motors are already
    // running from buildMachines(), so this is about making the panel agree
    // with them rather than about starting anything.
    setBreakThreshold(state.breakThreshold);
    setContactThreshold(state.contactMinImpulse);
    setContactsEnabled(state.contactsEnabled);
    setContactDraw(state.contactDraw);
    setContactDrawAll(state.contactDrawAll);
    setContactEffects(state.contactEffects);
    setCollideConnected(state.collideConnected);
    refreshChunk3Hud();
}

// --- Collapsible sections ------------------------------------------------------
//
// The panel now has eleven sections and a human opening the app should not have
// to scroll past a 36-cell layer matrix to find the crane. Every <section>
// carrying a data-collapsible <h2> folds on click, and the ones marked
// data-start="closed" in the markup begin folded — so the default view is the
// three or four controls that make the demo make sense, with everything else
// one click away.

function bindCollapsibles() {
    for (const h of document.querySelectorAll('#hud h2[data-collapsible]')) {
        const sec = h.parentElement;
        const toggle = () => sec.classList.toggle('folded');
        h.addEventListener('click', toggle);
        if (h.dataset.start === 'closed') sec.classList.add('folded');
    }
}

export { COMBINE_MODES, syncLayerMatrix };
