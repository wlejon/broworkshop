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
};

let player = null;
let overlay = null;
let character = null;

const $ = (id) => document.getElementById(id);

/** Wire every control. Called once, after the scene and player exist. */
export function bindHud(p, o, c) {
    player = p;
    overlay = o;
    character = c;

    buildClipGrid();
    buildFadeTargets();

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
    player.play(name, 0);
    markActive(name);
}

/** Blend into a clip over the HUD's current fade duration. */
export function crossfade(name, fade = state.fade) {
    state.clip = name;
    player.crossfadeTo(name, fade);
    markActive(name);
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
}

export function setFps(fps) {
    $('fps').textContent = fps.toFixed(0) + ' fps';
}

// CHUNK 2: the blend-space controls go under a new "Blending" group — a 1D
// speed slider calling player.setLocomotion(), a 2D pad for strafe, and a
// layer row (slot / clip / weight / mask preset) per active layer.
// CHUNK 3: a state-machine group with one travel() button per state plus a
// live `node.state` readout, and a root-motion toggle with a consumed-distance
// counter next to the stage's marker run.
