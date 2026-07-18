// hud.js — the switchboard.
//
// One direction only: DOM control → `state` → the player facade. Nothing in
// here reads the engine to decide what to do, which is what makes the smoke
// test honest — a test can set `state` and call the same apply functions the
// HUD calls, and it exercises the real path.
//
// The readout is the exception and deliberately so: it polls the engine every
// frame rather than echoing `state`, because a crossfade means the clip the
// user asked for and the clip actually driving the bones are different things
// for a moment, and the panel should show the truth.

export const state = {
    clip: 'idle',
    loop: true,
    speed: 1.0,
    fade: 0.35,
    fadeTarget: 'walk',
    showBones: false,
    showSkin: true,

    // Blending. `base` names what is driving the base track: a clip name, or
    // one of the registered blend spaces. The two axis values persist across
    // base switches because the PARAMETER lives on the space, not on the
    // playback — leaving a space and coming back resumes at the same mix.
    base: 'idle',
    speedAxis: 0.0,
    dirX: 0.0,
    dirY: 1.0,

    // State machine + root motion. `stateSpeed` is the machine's own parameter
    // and is deliberately separate from `speedAxis` above: the blend-space
    // section drives the axis directly with the machine out of the picture,
    // while this one drives it THROUGH the machine, which also decides whether
    // the character should be idling, moving or crouch-moving at that speed.
    stateSpeed: 0.0,
    crouch: false,
    rootMotion: false,
    camera: 'orbit',
    cinematic: false,
};

/**
 * Live root-motion telemetry, owned by the app's frame loop and rendered here.
 * `distance` is the world-space path length the node has actually travelled;
 * `markers` counts the stage's 1.5 m blocks the character has passed.
 */
export const motion = { distance: 0, markers: 0, z: 0 };

// The three layer slots the HUD exposes. Slot 0 is left free on purpose:
// play(name, { mask }) is shorthand for layer 0, so leaving it empty means the
// HUD's rows and that legacy form can never collide.
//
// The defaults are chosen to be mutually DISJOINT — right arm, left arm, head
// — so switching all three on at once over a walking blend gives four
// independent things happening on one skeleton, which is the whole pitch.
export const LAYER_ROWS = [
    { slot: 1, clip: 'wave',  mask: 'right arm' },
    { slot: 2, clip: 'point', mask: 'left arm'  },
    { slot: 3, clip: 'nod',   mask: 'head only' },
];

let player = null;
let overlay = null;
let character = null;
let masks = null;
let machine = null;
let cameras = null;

const $ = (id) => document.getElementById(id);

/** Wire every control. Called once, after the scene and player exist. */
export function bindHud(p, o, c, m, sm, cams) {
    player = p;
    overlay = o;
    character = c;
    masks = m;
    machine = sm;
    cameras = cams;

    buildClipGrid();
    buildFadeTargets();
    buildBlendControls();
    buildLayerRows();
    buildStateGraph();
    buildStateControls();
    buildRootMotion();
    buildCameraControls();
    buildCollapsibles();

    $('boneCount').textContent = `${character.boneCount} bones`;
    $('clipCount').textContent = `${player.names.length} clips`;

    // --- transport -----------------------------------------------------------
    $('btnPlay').addEventListener('click', () => player.resume());
    $('btnPause').addEventListener('click', () => player.pause());
    $('btnStop').addEventListener('click', () => player.stop(0.15));

    bindCheck('loopOn', (v) => { state.loop = v; player.loop = v; });

    bindRange('speed', (v) => {
        state.speed = v;
        player.speed = v;
    }, (v) => v.toFixed(2) + '×');

    // Scrubbing has to suppress the readout's own write-back, or the slider
    // fights the playhead. `scrubbing` is that latch.
    const scrub = $('scrub');
    scrub.addEventListener('input', () => {
        scrubbing = true;
        const t = parseFloat(scrub.value);
        player.seekNormalized(t);
        $('scrubV').textContent = t.toFixed(3);
    });
    scrub.addEventListener('change', () => { scrubbing = false; });

    // --- crossfade -----------------------------------------------------------
    bindRange('fade', (v) => { state.fade = v; }, (v) => v.toFixed(2) + ' s');
    $('fadeTarget').addEventListener('change', (e) => {
        state.fadeTarget = e.target.value;
    });
    $('btnFade').addEventListener('click', () => crossfade(state.fadeTarget));

    // --- rig -----------------------------------------------------------------
    bindCheck('bonesOn', (v) => { state.showBones = v; overlay.setEnabled(v); });
    bindCheck('skinOn',  (v) => { state.showSkin = v; character.node.visible = v; });

    // Push every default so the first frame already matches the panel.
    player.loop = state.loop;
    player.speed = state.speed;
    overlay.setEnabled(state.showBones);
    character.node.visible = state.showSkin;
}

let scrubbing = false;

// ── Actions the HUD and the tests share ──────────────────────────────────────

/** Hard cut to a clip and mark it active in the grid. */
export function selectClip(name) {
    state.clip = name;
    state.base = name;
    player.play(name, 0);
    markActive(name);
    markSpace('');
}

/** Blend into a clip over the HUD's current fade duration. */
export function crossfade(name, fade = state.fade) {
    state.clip = name;
    state.base = name;
    player.crossfadeTo(name, fade);
    markActive(name);
    markSpace('');
}

/**
 * Put a blend SPACE on the base track. Identical machinery to selectClip —
 * play() does not distinguish — and pushing the current axis value right after
 * means the character arrives at the mix the sliders already show rather than
 * at whatever the space was last left at.
 */
export function selectSpace(name, fade = state.fade) {
    state.base = name;
    player.playSpace(name, fade);
    if (name === 'directional') player.setDirection(state.dirX, state.dirY);
    else                        player.setLocomotion(state.speedAxis, name);
    markActive('');
    markSpace(name);
}

/** Move the 1D speed axis (and mirror it into the slider). */
export function setSpeedAxis(v) {
    state.speedAxis = v;
    const space = state.base === 'locomotionCrouch' ? 'locomotionCrouch' : 'locomotion';
    player.setLocomotion(v, space);
    const el = $('speedAxis');
    if (el) { el.value = String(v); $('speedAxisV').textContent = v.toFixed(2) + ' m/s'; }
}

/** Move the 2D directional axis (and mirror it into the pad dot). */
export function setDirection(x, y) {
    state.dirX = x;
    state.dirY = y;
    player.setDirection(x, y);
    positionPadDot();
    const out = $('dirV');
    if (out) out.textContent = `${x.toFixed(2)}, ${y.toFixed(2)}`;
}

/**
 * Turn a layer slot on or off. The row's remembered clip and mask are used, so
 * toggling is idempotent and the test can drive exactly what the checkbox does.
 */
export function setLayerEnabled(slot, on, fade = 0.2) {
    const row = LAYER_ROWS.find((r) => r.slot === slot);
    if (!row) throw new Error(`no layer row for slot ${slot}`);
    row.enabled = !!on;
    if (on) player.playLayer(slot, row.clip, row.mask,
                             { weight: row.weight === undefined ? 1 : row.weight,
                               fadeTime: fade });
    else    player.stopLayer(slot, fade);
    syncLayerRow(row);
}

/** Live weight for a running layer. */
export function setLayerWeight(slot, w) {
    const row = LAYER_ROWS.find((r) => r.slot === slot);
    row.weight = w;
    if (row.enabled) player.setLayerWeight(slot, w);
    syncLayerRow(row);
}

/** Swap which mask preset a layer uses; restarts the layer if it is live. */
export function setLayerMask(slot, mask) {
    const row = LAYER_ROWS.find((r) => r.slot === slot);
    row.mask = mask;
    // A mask is captured at playLayer time, so changing it means replaying the
    // slot. playLayer replaces a slot atomically, so this never flickers.
    if (row.enabled) player.playLayer(slot, row.clip, mask,
                                      { weight: row.weight, fadeTime: 0 });
    syncLayerRow(row);
}

/** Swap which clip a layer plays. */
export function setLayerClip(slot, clip) {
    const row = LAYER_ROWS.find((r) => r.slot === slot);
    row.clip = clip;
    if (row.enabled) player.playLayer(slot, clip, row.mask,
                                      { weight: row.weight, fadeTime: 0 });
    syncLayerRow(row);
}

// ── Control plumbing ─────────────────────────────────────────────────────────

function buildClipGrid() {
    const grid = $('clipGrid');
    grid.textContent = '';
    for (const name of player.names) {
        const b = document.createElement('button');
        b.textContent = name;
        b.dataset.clip = name;
        b.addEventListener('click', () => selectClip(name));
        grid.appendChild(b);
    }
}

function buildFadeTargets() {
    const sel = $('fadeTarget');
    sel.textContent = '';
    for (const name of player.names) {
        const o = document.createElement('option');
        o.value = name;
        o.textContent = name;
        if (name === state.fadeTarget) o.selected = true;
        sel.appendChild(o);
    }
}

function markActive(name) {
    for (const b of $('clipGrid').children) {
        b.classList.toggle('active', b.dataset.clip === name);
    }
}

function markSpace(name) {
    for (const b of $('spaceRow').children) {
        b.classList.toggle('active', b.dataset.space === name);
    }
}

// ── Blend-space controls ─────────────────────────────────────────────────────

// The nine presets on the 2D pad. Dragging is the fun way to use the pad, but
// precise corners are the way to SEE what it does — and a preset is something
// the smoke test can drive exactly, which dragging is not.
const PAD_PRESETS = [
    ['↖', -0.7,  0.7], ['↑',  0,  1], ['↗',  0.7,  0.7],
    ['←',  -1,   0  ], ['•',  0,  0], ['→',  1,    0  ],
    ['↙', -0.7, -0.7], ['↓',  0, -1], ['↘',  0.7, -0.7],
];

function buildBlendControls() {
    // Base-track selector: each button is just play(name) with a fade. That a
    // blend space goes on the base track through the SAME call as a clip is
    // the point being made, so the buttons sit in one row together.
    const row = $('spaceRow');
    row.textContent = '';
    for (const [space, label] of [['locomotion', '1D speed'],
                                  ['directional', '2D direction'],
                                  ['locomotionCrouch', '1D crouch']]) {
        const b = document.createElement('button');
        b.textContent = label;
        b.dataset.space = space;
        b.addEventListener('click', () => selectSpace(space));
        row.appendChild(b);
    }

    const axis = $('speedAxis');
    axis.addEventListener('input', () => setSpeedAxis(parseFloat(axis.value)));
    $('speedAxisV').textContent = state.speedAxis.toFixed(2) + ' m/s';

    // --- the 2D pad ----------------------------------------------------------
    // Pointer events rather than mouse events: they cover mouse and touch with
    // one path, and setPointerCapture keeps the drag alive when the cursor
    // leaves the little 132 px square, which it constantly does.
    const pad = $('pad');
    const dragTo = (ev) => {
        const r = pad.getBoundingClientRect();
        const x = ((ev.clientX - r.left) / r.width) * 2 - 1;
        // Screen Y grows downward; the axis grows forward, hence the flip.
        const y = 1 - ((ev.clientY - r.top) / r.height) * 2;
        setDirection(clampAxis(x), clampAxis(y));
    };
    pad.addEventListener('pointerdown', (ev) => {
        pad.setPointerCapture(ev.pointerId);
        padDragging = true;
        dragTo(ev);
        ev.preventDefault();
    });
    pad.addEventListener('pointermove', (ev) => { if (padDragging) dragTo(ev); });
    pad.addEventListener('pointerup', (ev) => {
        padDragging = false;
        pad.releasePointerCapture(ev.pointerId);
    });

    const presets = $('padPresets');
    presets.textContent = '';
    for (const [label, x, y] of PAD_PRESETS) {
        const b = document.createElement('button');
        b.textContent = label;
        b.title = `${x}, ${y}`;
        b.addEventListener('click', () => setDirection(x, y));
        presets.appendChild(b);
    }

    positionPadDot();
    $('dirV').textContent = `${state.dirX.toFixed(2)}, ${state.dirY.toFixed(2)}`;
}

let padDragging = false;
const clampAxis = (v) => (v < -1 ? -1 : (v > 1 ? 1 : v));

function positionPadDot() {
    const dot = $('padDot');
    if (!dot) return;
    dot.style.left = `${(state.dirX + 1) * 50}%`;
    dot.style.top  = `${(1 - state.dirY) * 50}%`;
}

// ── Layer rows ───────────────────────────────────────────────────────────────

function buildLayerRows() {
    const host = $('layerRows');
    host.textContent = '';

    for (const row of LAYER_ROWS) {
        row.enabled = false;
        row.weight = 1.0;

        const el = document.createElement('div');
        el.className = 'layer';

        // Header: enable + slot + which clip.
        const head = document.createElement('label');
        head.className = 'layerHead';
        const cb = document.createElement('input');
        cb.type = 'checkbox';
        cb.addEventListener('change', () => setLayerEnabled(row.slot, cb.checked));
        head.appendChild(cb);
        head.appendChild(document.createTextNode(` slot ${row.slot} `));

        const clipSel = document.createElement('select');
        for (const name of player.names) {
            const o = document.createElement('option');
            o.value = name; o.textContent = name;
            if (name === row.clip) o.selected = true;
            clipSel.appendChild(o);
        }
        clipSel.addEventListener('change', () => setLayerClip(row.slot, clipSel.value));
        head.appendChild(clipSel);
        el.appendChild(head);

        // Mask preset. This is the control that makes masking explorable —
        // the same clip on the same layer reads completely differently as
        // "right arm" versus "upper body" versus "full body".
        const maskLbl = document.createElement('label');
        maskLbl.appendChild(document.createTextNode('mask '));
        const maskSel = document.createElement('select');
        for (const name of masks.names) {
            const o = document.createElement('option');
            o.value = name; o.textContent = name;
            if (name === row.mask) o.selected = true;
            maskSel.appendChild(o);
        }
        maskSel.addEventListener('change', () => setLayerMask(row.slot, maskSel.value));
        maskLbl.appendChild(maskSel);
        el.appendChild(maskLbl);

        const wLbl = document.createElement('label');
        wLbl.appendChild(document.createTextNode('weight '));
        const w = document.createElement('input');
        w.type = 'range'; w.min = '0'; w.max = '1'; w.step = '0.01'; w.value = '1';
        w.className = 'lw';
        w.addEventListener('input', () => setLayerWeight(row.slot, parseFloat(w.value)));
        wLbl.appendChild(w);
        const wv = document.createElement('span');
        wv.className = 'v';
        wLbl.appendChild(wv);
        el.appendChild(wLbl);

        // The bones this layer claims, spelled out. A mask is abstract until
        // you can see the list shrink from twenty names to three.
        const bones = document.createElement('div');
        bones.className = 'bones';
        el.appendChild(bones);

        host.appendChild(el);
        row.ui = { cb, clipSel, maskSel, weight: w, weightV: wv, bones, el };
        syncLayerRow(row);
    }
}

function syncLayerRow(row) {
    const ui = row.ui;
    if (!ui) return;
    ui.cb.checked = !!row.enabled;
    ui.clipSel.value = row.clip;
    ui.maskSel.value = row.mask;
    ui.weight.value = String(row.weight);
    ui.weightV.textContent = row.weight.toFixed(2);
    ui.el.classList.toggle('on', !!row.enabled);

    const list = masks.bones(row.mask);
    ui.bones.textContent = `${list.length} bones · ` +
        (list.length > 6 ? list.slice(0, 5).join(' ') + ' …' : list.join(' '));
}

// ── State machine ────────────────────────────────────────────────────────────
//
// The graph, drawn. A state machine is the most invisible thing in this app —
// without a picture, "the character is walking" and "the character is in the
// `move` state, having arrived from `idle` 0.4 s ago over a 0.25 s fade" look
// identical. So: a node per state with the active one lit, an edge list, the
// last transition called out, and a timestamped log. The log in particular is
// what turns the parameter sliders from "they change the animation" into "they
// change the STATE, and here is the transition that fired".

const STATE_BLURB = {
    idle:       'clip · the neutral state',
    move:       'blend space · speed axis',
    moveCrouch: 'blend space · crouched, phase-synced with move',
    jump:       'one-shot · autoAdvance → move',
    wave:       'one-shot · autoAdvance, returns to the previous state',
};

function buildStateGraph() {
    const host = $('stateNodes');
    host.textContent = '';
    for (const name of machine.names) {
        const b = document.createElement('button');
        b.className = 'stateNode';
        b.dataset.state = name;
        b.textContent = name;
        b.title = `travel('${name}') — ${STATE_BLURB[name] || ''}`;
        // Every state node is also its own travel button: clicking a state in
        // the graph is the manual path, and it goes through exactly the same
        // authored transitions the parameter driver uses.
        b.addEventListener('click', () => travelTo(name));
        host.appendChild(b);
    }

    // The edge list, rendered from the machine's own transition definition
    // rather than retyped — if the graph changes, this changes with it.
    const edges = $('stateEdges');
    edges.textContent = '';
    for (const t of machine.transitions) {
        const e = document.createElement('div');
        e.className = 'edge';
        const tags = [];
        if (t.fade) tags.push(`${t.fade.toFixed(2)}s`);
        if (t.syncPhase) tags.push('sync');
        if (t.autoAdvance) tags.push('auto');
        e.innerHTML = '';
        e.textContent = `${t.from} → ${t.to}` + (tags.length ? `  ${tags.join(' · ')}` : '');
        e.dataset.from = t.from;
        e.dataset.to = t.to;
        if (t.autoAdvance) e.classList.add('auto');
        edges.appendChild(e);
    }

    machine.onChange((from, to) => appendLog(from, to));
}

function buildStateControls() {
    // The parameter drivers. These do NOT name a state — they move a number
    // and a boolean, and the machine's driver decides what that implies.
    bindRange('stateSpeed', (v) => {
        state.stateSpeed = v;
        machine.setSpeed(v);
    }, (v) => v.toFixed(2) + ' m/s');

    bindCheck('crouchOn', (v) => { state.crouch = v; machine.setCrouch(v); });

    $('btnJump').addEventListener('click', () => trigger('jump'));
    $('btnWave').addEventListener('click', () => trigger('wave'));
    $('btnClearLog').addEventListener('click', () => {
        machine.log.length = 0;
        $('stateLog').textContent = '';
    });
}

/** Manual travel from the graph's state buttons. */
export function travelTo(name) {
    machine.travel(name);
    markState();
    return name;
}

/** Fire a one-shot from the HUD's trigger buttons. */
export function trigger(name) {
    machine.trigger(name);
    markState();
    return name;
}

/** Drive the machine's speed parameter (the automatic-transition path). */
export function setStateSpeed(v) {
    state.stateSpeed = v;
    machine.setSpeed(v);
    const el = $('stateSpeed');
    if (el) { el.value = String(v); $('stateSpeedV').textContent = v.toFixed(2) + ' m/s'; }
    return v;
}

/** Drive the machine's crouch parameter. */
export function setCrouch(on) {
    state.crouch = !!on;
    machine.setCrouch(state.crouch);
    const el = $('crouchOn');
    if (el) el.checked = state.crouch;
    return state.crouch;
}

function appendLog(from, to, note) {
    const host = $('stateLog');
    if (!host) return;
    const line = document.createElement('div');
    line.className = 'logLine';
    const t = machine.lastChange.at;
    line.textContent = note
        ? `${t.toFixed(2)}s  ${note}`
        : `${t.toFixed(2)}s  ${from === null ? '(resumed)' : from} → ${to}`;
    if (note) line.classList.add('note');
    host.appendChild(line);
    while (host.children.length > 24) host.removeChild(host.firstChild);
    // Newest line stays in view; the log is a tail, not an archive.
    host.scrollTop = host.scrollHeight;
}

function markState() {
    const cur = machine.state;
    for (const b of $('stateNodes').children) {
        b.classList.toggle('active', b.dataset.state === cur);
    }
    const last = machine.lastChange;
    for (const e of $('stateEdges').children) {
        e.classList.toggle('fired', e.dataset.from === last.from && e.dataset.to === last.to);
    }
}

// ── Root motion ──────────────────────────────────────────────────────────────
//
// The app's showpiece, and the control that matters most is a single checkbox.
// Off: the gait's displacement stays in the pose, the node never moves, and
// the character treadmills between the markers forever. On: the engine pulls
// that displacement out of the pose and hands it to the app, which walks the
// node down the run. Same clips, same speed parameter, same state machine —
// one flag, and the character starts actually going somewhere.

function buildRootMotion() {
    bindCheck('rootMotionOn', (v) => {
        state.rootMotion = v;
        machine.setRootMotion(v);
        if (!v) resetJourney();
    });
    $('btnResetPos').addEventListener('click', () => resetJourney());
}

/** Send the character back to the start of the run and zero the odometer. */
export function resetJourney() {
    player.resetTransform();
    motion.distance = 0;
    motion.markers = 0;
    motion.z = 0;
    return motion;
}

/** Toggle root motion from code (the HUD checkbox routes through here too). */
export function setRootMotion(on) {
    state.rootMotion = !!on;
    machine.setRootMotion(state.rootMotion);
    const el = $('rootMotionOn');
    if (el) el.checked = state.rootMotion;
    if (!state.rootMotion) resetJourney();
    return state.rootMotion;
}

// ── Cameras ──────────────────────────────────────────────────────────────────

function buildCameraControls() {
    const row = $('cameraRow');
    row.textContent = '';
    for (const [key, label] of [['orbit', 'orbit'], ['follow', 'follow'], ['wide', 'wide']]) {
        const b = document.createElement('button');
        b.textContent = label;
        b.dataset.camera = key;
        b.addEventListener('click', () => selectCamera(key));
        row.appendChild(b);
    }
    bindCheck('cineOn', (v) => {
        state.cinematic = v;
        cameras.setCinematic(v);
        // A cinematic that nobody is looking through is a waste, so arming it
        // also cuts to the camera it flies.
        if (v && cameras.active !== 'wide') selectCamera('wide');
    });
    markCamera();
}

/** Cut to a camera node. `scene.activeCamera` is the truth the readout shows. */
export function selectCamera(key) {
    state.camera = key;
    cameras.select(key);
    markCamera();
    return key;
}

function markCamera() {
    for (const b of $('cameraRow').children) {
        b.classList.toggle('active', b.dataset.camera === cameras.active);
    }
}

// ── Collapsible groups ───────────────────────────────────────────────────────
//
// The panel now carries six groups and does not fit on a laptop screen. Each
// group header toggles its body, and the ones this chunk adds start OPEN while
// the earlier ones start collapsed — so the app opens showing what is new
// without hiding the rest behind a scroll.

function buildCollapsibles() {
    for (const head of document.querySelectorAll('#hud .group')) {
        const body = document.getElementById(head.dataset.body);
        if (!body) continue;
        const apply = () => {
            const open = !head.classList.contains('closed');
            body.style.display = open ? '' : 'none';
        };
        head.addEventListener('click', () => {
            head.classList.toggle('closed');
            apply();
        });
        if (head.dataset.start === 'closed') head.classList.add('closed');
        apply();
    }
}

function bindRange(id, apply, fmt) {
    const el = $(id);
    const out = $(id + 'V');
    const push = () => {
        const v = parseFloat(el.value);
        apply(v);
        if (out) out.textContent = fmt ? fmt(v) : String(v);
    };
    el.addEventListener('input', push);
    push();
}

function bindCheck(id, apply) {
    const el = $(id);
    el.addEventListener('change', () => apply(el.checked));
    apply(el.checked);
}

// ── Readout ──────────────────────────────────────────────────────────────────

/**
 * Refresh the live panel from the ENGINE, not from `state`. Called at a
 * readable rate rather than every frame — a 60 Hz clock is unreadable.
 */
export function updateReadout() {
    const clip = player.currentClip;
    $('stClip').textContent = clip || '(stopped)';
    $('stTime').textContent = player.duration > 0
        ? `${player.currentTime.toFixed(2)} / ${player.duration.toFixed(2)}s`
        : '—';
    $('stPlaying').textContent = player.playing ? 'yes' : 'no';

    if (!scrubbing) {
        const n = player.normalizedTime;
        $('scrub').value = String(n);
        $('scrubV').textContent = n.toFixed(3);
    }

    renderBlendMix();
    renderState();
    renderMotion();
    renderCamera();
}

/**
 * The machine's live state. Read from `node.state` rather than from the last
 * thing the HUD asked for, because they differ in exactly the interesting
 * cases: while a one-shot is auto-advancing, and after a manual play() has
 * SUSPENDED the machine (node.state goes null and the definition survives).
 */
function renderState() {
    const cur = machine.state;
    $('stState').textContent = cur === null ? '(suspended)' : cur;
    const last = machine.lastChange;
    $('stLast').textContent = last.to
        ? `${last.from === null ? '(resumed)' : last.from} → ${last.to}`
        : '—';
    markState();
}

function renderMotion() {
    $('rmDist').textContent = `${motion.distance.toFixed(2)} m`;
    $('rmMarkers').textContent = `${motion.markers}/7 markers`;
    $('rmZ').textContent = `node z ${motion.z.toFixed(2)}`;
}

function renderCamera() {
    // scene.activeCamera, not the button that was last clicked — those come
    // apart the moment anything calls setCamera().
    const active = cameras.active;
    $('stCamera').textContent = active || '(imperative view)';
    const p = cameras.activePosition();
    $('camPos').textContent = p
        ? `[${p.map((v) => v.toFixed(1)).join(', ')}]`
        : '—';
    markCamera();
}

/**
 * The blend readout: base composition as weight bars, plus a row per live
 * layer. This is `blendState()` rendered literally, and it is the most useful
 * thing in the panel — a blend space is otherwise invisible machinery, and
 * watching walk hand weight to run as the slider crosses 1.6 m/s is what turns
 * "there is a blend space" into something you can actually see happening.
 */
function renderBlendMix() {
    const bs = player.blendState();
    const host = $('baseMix');

    const rows = bs.clips || [];
    // Rebuild only when the SET of clips changes; otherwise just move the
    // bars. The composition changes a handful of times a session, the weights
    // change every frame, and rebuilding DOM per frame for the latter would be
    // the one expensive thing in an app that is otherwise zero-JS-per-frame.
    const key = rows.map((c) => c.name).join('|');
    if (host.dataset.key !== key) {
        host.textContent = '';
        host.dataset.key = key;
        for (const c of rows) {
            const line = document.createElement('div');
            line.className = 'mix';
            const nm = document.createElement('span');
            nm.className = 'mixName';
            nm.textContent = c.name;
            const track = document.createElement('div');
            track.className = 'mixTrack';
            const fill = document.createElement('div');
            fill.className = 'mixFill';
            track.appendChild(fill);
            const val = document.createElement('span');
            val.className = 'mixVal';
            line.appendChild(nm); line.appendChild(track); line.appendChild(val);
            host.appendChild(line);
        }
    }
    rows.forEach((c, i) => {
        const line = host.children[i];
        if (!line) return;
        line.querySelector('.mixFill').style.width = `${Math.round(c.weight * 100)}%`;
        line.querySelector('.mixVal').textContent = c.weight.toFixed(2);
    });

    const sum = rows.reduce((a, c) => a + c.weight, 0);
    $('mixSum').textContent = rows.length
        ? `${rows.length} clip${rows.length === 1 ? '' : 's'} · Σ ${sum.toFixed(2)}`
        : 'base track idle';
    $('mixPhase').textContent = bs.pos
        ? `pos [${bs.pos.map((v) => v.toFixed(2)).join(', ')}] · phase ${bs.phase.toFixed(2)}`
        : `phase ${(bs.phase || 0).toFixed(2)}`;

    const live = bs.layers || [];
    $('layerSlots').textContent = `${live.length}/${LAYER_ROWS.length}`;
    $('layerCount').textContent = live.length
        ? `${live.length} live: ` + live.map((l) => `${l.slot}:${l.name} ${l.weight.toFixed(2)}`).join(' · ')
        : 'no layers — base track only';
}

export function setFps(fps) {
    $('fps').textContent = fps.toFixed(0) + ' fps';
}
