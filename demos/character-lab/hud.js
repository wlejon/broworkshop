// hud.js — the switchboard and the instrument panel.
//
// Data flows one way: DOM control -> `tune` (or a direct engine call) -> the
// character. Nothing reads back out of the DOM, so the smoke test can poke
// `tune` directly and be certain it took exactly the path a human's mouse
// would have taken.
//
// The Controller sliders are the interesting ones. CharacterVirtual takes
// maxSlopeAngle / stepUp / stickToFloor / maxStrength at construction and the
// JS binding exposes no setters for them, so each of those sliders schedules a
// rebuild instead of a mutation. The rebuild carries position, velocity and
// stance across, so from the user's side it is indistinguishable from a live
// parameter change.

import { tune, charState, rebuild, resetToSpawn } from "/app/character.js";

export const view = { labels: true, interpolation: true };

const $ = (id) => document.getElementById(id);

/** Rebuilds are coalesced to one per frame: dragging a slider fires `input`
 *  on every pixel, and tearing down a Jolt character per pixel is silly. */
let rebuildPending = false;

export function bindHud(scene) {
    // --- construction-time tunables (each schedules a rebuild) --------------
    slider('tMaxSlope', (v) => { tune.maxSlopeAngle = v; }, (v) => v.toFixed(0) + '°', true);
    slider('tStepUp',   (v) => { tune.stepUp = v; },        (v) => v.toFixed(2) + ' m', true);
    slider('tStick',    (v) => { tune.stickToFloor = v; },  (v) => v.toFixed(2) + ' m', true);
    slider('tStrength', (v) => { tune.maxStrength = v; },   (v) => v.toFixed(0) + ' N', true);

    // --- per-frame tunables (free) -----------------------------------------
    slider('tSpeed',   (v) => { tune.moveSpeed = v; },  (v) => v.toFixed(1) + ' m/s');
    slider('tJump',    (v) => { tune.jumpSpeed = v; },  (v) => v.toFixed(1) + ' m/s');
    slider('tGravity', (v) => {
        tune.gravity = v;
        // Real engine call: the character integrates world gravity itself when
        // it is unsupported, so this changes both fall and slide behaviour.
        Physics.setGravity(0, -v, 0);
    }, (v) => v.toFixed(2));

    check('optLabels', (on) => { view.labels = on; });
    check('optInterp', (on) => {
        view.interpolation = on;
        Physics.setInterpolation(on);
    });

    $('btnReset').addEventListener('click', () => resetToSpawn());

    // Push every control once so the first frame already matches the panel.
    for (const el of document.querySelectorAll('#hud input')) {
        el.dispatchEvent(new Event(el.type === 'checkbox' ? 'change' : 'input'));
    }
    rebuildPending = false;   // the initial push must not rebuild before frame 1

    function slider(id, apply, fmt, needsRebuild) {
        const el = $(id), out = $(id + 'V');
        el.addEventListener('input', () => {
            const v = parseFloat(el.value);
            apply(v);
            if (out) out.textContent = fmt(v);
            if (needsRebuild) rebuildPending = true;
        });
    }
    function check(id, apply) {
        const el = $(id);
        el.addEventListener('change', () => apply(!!el.checked));
    }

    return () => { if (rebuildPending) { rebuildPending = false; rebuild(scene); } };
}

// --- readout ----------------------------------------------------------------

const v3 = (v) => `${v.x.toFixed(2)} ${v.y.toFixed(2)} ${v.z.toFixed(2)}`;

function set(id, text, cls) {
    const el = $(id);
    if (!el) return;
    el.textContent = text;
    el.className = cls || '';
}

export function updateReadout() {
    const s = charState;
    set('roPos', v3(s.position));
    set('roVel', v3(s.velocity));
    set('roSpeed', s.speed.toFixed(2) + ' m/s');
    set('roGround', s.groundState,
        s.groundState === 'onGround' ? 'good' :
        s.groundState === 'onSteepGround' ? 'hot' : '');
    set('roGrounded', s.isGrounded ? 'true' : 'false', s.isGrounded ? 'good' : 'hot');
    set('roNormal', v3(s.groundNormal));
    // The slope reads hot the moment it exceeds the configured limit, which is
    // the exact threshold the engine is about to act on.
    set('roSlope', s.slopeDeg.toFixed(1) + '°',
        s.slopeDeg > tune.maxSlopeAngle ? 'hot' : '');
    set('roBody', String(s.groundBodyId));
    set('roPlatform', v3(s.groundVelocity),
        Math.hypot(s.groundVelocity.x, s.groundVelocity.y, s.groundVelocity.z) > 0.01
            ? 'good' : '');
    set('roStance', s.stance, s.stance === 'crouching' ? 'good' : '');
    set('roBlocked', s.blocked ? 'YES' : 'no', s.blocked ? 'hot' : '');
    set('roStandBlocked', s.standBlocked ? 'YES' : 'no', s.standBlocked ? 'hot' : '');
}

export function setFps(fps) {
    $('fps').textContent = fps.toFixed(0) + ' fps';
}
