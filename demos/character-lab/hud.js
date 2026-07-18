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

import { tune, charState, rebuild, resetToSpawn, teleport,
         RADIUS, STAND_HALF } from "/app/character.js";
import { sense, qState } from "/app/queries.js";
import { crowd, crowdState, setCrowdSize, setCrowdPhysical, resetCrowd, PLAZA }
    from "/app/crowd.js";
import { ballLab, ballState, launchBall, clearBall, BALL_LAB } from "/app/innerbody.js";
import { terrain, terrainState, regenerateTerrain, heightAt, TERRAIN_WALK }
    from "/app/terrain.js";

export const view = { labels: true, interpolation: true };

const $ = (id) => document.getElementById(id);

/** Rebuilds are coalesced to one per frame: dragging a slider fires `input`
 *  on every pixel, and tearing down a Jolt character per pixel is silly. */
let rebuildPending = false;

/** Terrain sliders stage a shape change; the heightfield body is immutable, so
 *  the actual rebuild is deferred to one call per frame the same way. */
let terrainDirty = false;

/** True when the terrain sliders have moved since the last regeneration —
 *  the HUD button glows via this, and the frame driver consumes it. */
export function terrainNeedsRegen() { return terrainDirty; }

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

    // --- sensing -------------------------------------------------------------
    // None of these rebuild anything: a query is a stateless call against the
    // physics world, so every switch here takes effect on the very next frame.
    check('qForward',  (on) => { sense.forwardCast = on; });
    check('qLedge',    (on) => { sense.ledgeProbe = on; });
    check('qProx',     (on) => { sense.proximity = on; });
    check('qRay',      (on) => { sense.lookRay = on; });
    check('qDraw',     (on) => { sense.drawVolumes = on; });
    slider('qCastDist', (v) => { sense.castDistance = v; }, (v) => v.toFixed(1) + ' m');
    slider('qProxR',    (v) => { sense.proxRadius = v; },   (v) => v.toFixed(1) + ' m');
    slider('qAhead',    (v) => { sense.ledgeAhead = v; },   (v) => v.toFixed(2) + ' m');
    slider('qRayH',     (v) => { sense.rayHeight = v; },
           (v) => (v >= 0 ? '+' : '') + v.toFixed(2) + ' m');

    // The filter switches. These are the app's argument: the readout shows the
    // same ray with and without them, so flipping one changes a number on
    // screen and nothing else.
    check('qIgnoreSelf',  (on) => { sense.ignoreSelf = on; });
    check('qIgnoreProps', (on) => { sense.ignoreProps = on; });
    check('qMovingOnly',  (on) => { sense.movingOnly = on; });

    // --- crowd ---------------------------------------------------------------
    // The size slider creates and destroys real Jolt characters, so it is
    // applied immediately rather than coalesced: setCrowdSize is idempotent and
    // only touches the pool entries that actually changed state.
    slider('cCount', (v) => setCrowdSize(v), (v) => v.toFixed(0));
    slider('cSpeed', (v) => { crowd.speed = v; }, (v) => v.toFixed(1) + ' m/s');
    check('cPhysical', (on) => setCrowdPhysical(on));

    // --- inner body ----------------------------------------------------------
    // innerBody is a construction option like the ones above, so its checkbox
    // schedules a rebuild. The ball in flight is cleared first: a shot fired at
    // the old character would resolve against a body that no longer exists.
    check('cInner', (on) => {
        if (tune.innerBody === on) return;
        tune.innerBody = on;
        clearBall();
        rebuildPending = true;
    });
    slider('bSpeed', (v) => { ballLab.speed = v; }, (v) => v.toFixed(1) + ' m/s');

    // --- terrain -------------------------------------------------------------
    // A heightfield body is immutable, so both sliders only stage the numbers;
    // the rebuild happens on the button (or on release, via the same call).
    slider('tAmp',  (v) => { terrain.amplitude = v; }, (v) => v.toFixed(1) + ' m', false, true);
    slider('tFreq', (v) => { terrain.frequency = v; }, (v) => v.toFixed(3), false, true);

    check('optLabels', (on) => { view.labels = on; });
    check('optInterp', (on) => {
        view.interpolation = on;
        Physics.setInterpolation(on);
    });

    $('btnReset').addEventListener('click', () => { resetToSpawn(); resetCrowd(); });

    // Teleports. Three zones are 30-90 m from spawn and walking there every
    // time to check one behaviour is a waste of the reader's patience.
    $('btnGoCrowd').addEventListener('click', () => {
        goTo(PLAZA.x, 0, PLAZA.z + PLAZA.radius + 2.5);
        resetCrowd();
    });
    $('btnGoBall').addEventListener('click', () => goTo(BALL_LAB.x, 0, BALL_LAB.z));
    $('btnGoTerrain').addEventListener('click', () => {
        // Drop in ABOVE the hill: the heightfield's surface height at the
        // landing spot is known, so this lands on the ground rather than
        // inside it.
        goTo(TERRAIN_WALK.x, heightAt(TERRAIN_WALK.x, TERRAIN_WALK.z) + 0.6,
             TERRAIN_WALK.z);
    });

    $('btnLaunch').addEventListener('click', () => launchBall());
    $('btnRegen').addEventListener('click', () => { regenerateTerrain(); terrainDirty = false; });

    // Push every control once so the first frame already matches the panel.
    for (const el of document.querySelectorAll('#hud input')) {
        el.dispatchEvent(new Event(el.type === 'checkbox' ? 'change' : 'input'));
    }
    rebuildPending = false;   // the initial push must not rebuild before frame 1
    terrainDirty = false;

    function goTo(x, footY, z) {
        teleport(x, footY + RADIUS + STAND_HALF, z);
    }

    function slider(id, apply, fmt, needsRebuild, dirtiesTerrain) {
        const el = $(id), out = $(id + 'V');
        el.addEventListener('input', () => {
            const v = parseFloat(el.value);
            apply(v);
            if (out) out.textContent = fmt(v);
            if (needsRebuild) rebuildPending = true;
            if (dirtiesTerrain) terrainDirty = true;
        });
    }
    function check(id, apply) {
        const el = $(id);
        el.addEventListener('change', () => apply(!!el.checked));
    }

    return () => {
        if (rebuildPending) { rebuildPending = false; rebuild(scene); }
        if (terrainDirty) { terrainDirty = false; regenerateTerrain(); }
    };
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
    updateSensors();
    updateCrowd();
    updateBall();
    updateTerrain();
}

// --- crowd readout -----------------------------------------------------------

function updateCrowd() {
    const c = crowdState;
    set('coCount', String(c.active) + (c.physical ? '' : ' (ghosts)'),
        c.physical && c.active ? 'good' : (c.active ? 'hot' : ''));
    // A crowd that is achieving its commanded wander speed is a crowd with
    // room; the shortfall is the NPCs blocking each other.
    set('coSpeed', c.meanSpeed.toFixed(2) + ' m/s',
        crowd.speed > 0.1 && c.meanSpeed < crowd.speed * 0.7 ? 'hot' : '');
    set('coTouch', String(c.touchingPlayer), c.touchingPlayer ? 'hot' : '');
    // The headline: what fraction of the commanded speed the player is
    // actually getting. 1.00 in the open, a third of that inside the group.
    set('coThrough', (c.playerThrough * 100).toFixed(0) + '%',
        c.playerThrough < 0.7 ? 'hot' : 'good');
}

// --- inner body readout ------------------------------------------------------

function updateBall() {
    const b = ballState;
    set('boTag', b.selfTag > 0 ? String(b.selfTag) : 'none (-1)',
        b.selfTag > 0 ? 'good' : 'hot');
    set('boSeen', b.selfVisible ? 'YES' : 'no', b.selfVisible ? 'good' : 'hot');
    set('boVerdict', b.verdict,
        b.verdict === 'DEFLECTED' ? 'good' :
        b.verdict === 'PASSED THROUGH' ? 'hot' : '');
    set('boPast', b.shots ? b.past.toFixed(2) + ' m' : '—',
        b.past > 1.2 ? 'hot' : '');
    set('boMin', b.minDist === Infinity ? '—' : b.minDist.toFixed(2) + ' m');
}

// --- terrain readout ---------------------------------------------------------

function updateTerrain() {
    const t = terrainState;
    set('toOn', t.onTerrain ? 'yes' : 'no', t.onTerrain ? 'good' : '');
    set('toMeas', t.slopeMeasured.toFixed(1) + '°',
        t.slopeMeasured > tune.maxSlopeAngle ? 'hot' : '');
    set('toAna', t.onTerrain ? t.slopeAnalytic.toFixed(1) + '°' : '—');
    // The disagreement between the engine's normal and the derivative of the
    // height function. A couple of degrees is heightfield quantization; a big
    // number would mean the collision surface is not the surface on screen.
    set('toErr', t.onTerrain && charState.isGrounded
        ? t.slopeError.toFixed(1) + '°' : '—',
        t.slopeError > 12 ? 'hot' : 'good');
    set('toY', t.onTerrain ? t.groundY.toFixed(2) + ' m' : '—');
}

// --- sensor readout ----------------------------------------------------------
// Every line here is a field off a query result. Nothing is derived, smoothed
// or debounced: if the number flickers, the query flickers, and that is worth
// seeing.

let proxSig = '';   // last rendered overlap list, to avoid rebuilding the DOM

function updateSensors() {
    // Forward sweep. "clear" is a real answer, not a missing one — it means the
    // character can walk the full cast distance without touching anything.
    const sw = qState.sweep;
    set('qoSweep', sense.forwardCast ? (sw ? sw.name : 'clear') : 'off',
        sense.forwardCast ? (sw ? 'hot' : 'good') : '');
    set('qoSweepD', sw ? sw.dist.toFixed(2) + ' m'
                       : (sense.forwardCast ? '> ' + sense.castDistance.toFixed(1) + ' m' : '—'));

    // Ledge probe. An infinite drop means the probe found no floor at all
    // within its reach, which off the side of the platform is the honest answer.
    const l = qState.ledge;
    set('qoLedge', !sense.ledgeProbe ? 'off' : (l && l.isLedge ? 'LEDGE' : 'flat'),
        !sense.ledgeProbe ? '' : (l && l.isLedge ? 'hot' : 'good'));
    set('qoDrop', !l ? '—'
        : (l.drop === Infinity ? 'no floor' : l.drop.toFixed(2) + ' m'),
        l && l.isLedge ? 'hot' : '');

    // Proximity. The count is the headline; the list under it is who.
    const prox = qState.prox;
    set('qoProxN', sense.proximity ? String(prox.length) : 'off',
        sense.proximity && prox.length ? 'good' : '');
    const sig = prox.map((o) => o.bodyId + ':' + o.dist.toFixed(1)).join(',');
    if (sig !== proxSig) {
        proxSig = sig;
        const host = $('qoProxList');
        if (host) {
            host.textContent = '';
            for (const o of prox) {
                const row = document.createElement('div');
                const nm = document.createElement('span');
                nm.textContent = o.name;
                const d = document.createElement('b');
                d.textContent = o.dist.toFixed(2) + ' m';
                row.appendChild(nm);
                row.appendChild(d);
                host.appendChild(row);
            }
        }
    }

    // The two ray rows. Read them together: with ignoreBody off, "filtered"
    // collapses onto "no filter" and both say SELF at 0.00 m.
    const r = qState.ray, raw = qState.rayUnfiltered;
    set('qoRay', !sense.lookRay ? 'off' : (r ? r.name : 'nothing'),
        r && r.name.startsWith('SELF') ? 'hot' : (r ? 'good' : ''));
    set('qoRayD', r ? r.dist.toFixed(2) + ' m' : '—');
    set('qoRayRaw', !sense.lookRay ? 'off' : (raw ? raw.name : 'nothing'),
        raw && raw.name.startsWith('SELF') ? 'hot' : '');
    set('qoRayRawD', raw ? raw.dist.toFixed(2) + ' m' : '—');

    const pk = qState.pick;
    set('qoPick', pk ? pk.name : 'click a body', pk ? 'good' : '');
}

export function setFps(fps) {
    $('fps').textContent = fps.toFixed(0) + ' fps';
}
