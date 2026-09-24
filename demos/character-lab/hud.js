// hud.js — the switchboard and the instrument panel.
//
// Data flows one way: control -> `tune` / `sense` / an engine call -> the
// character. Nothing reads back out of the DOM, so a test can poke `tune`
// directly and take exactly the path a slider does.
//
// The Controller sliders are the interesting ones. CharacterVirtual takes
// maxSlopeAngle / stepUp / stickToFloor / maxStrength at construction and the
// JS binding exposes no setters, so those sliders schedule a rebuild (one per
// frame, see lab.js). The rebuild carries position, velocity and stance
// across, so from the user's side it is a live parameter change.

import { $, bindControl, tabs } from "/lib/kit/index.js";
import {
    view, requestRebuild, requestTerrain, teleport, resetToSpawn, applyStanceVisual, characterAvatar,
    tune, charState, RADIUS, STAND_HALF, sense, qState,
    crowd, crowdState, setCrowdSize, setCrowdPhysical, resetCrowd, PLAZA,
    ballLab, ballState, launchBall, clearBall, BALL_LAB,
    terrain, terrainState, regenerateTerrain, heightAt, TERRAIN_WALK,
} from "/app/lab.js";

const m = (d) => (v) => v.toFixed(d) + ' m';
const ms = (d) => (v) => v.toFixed(d) + ' m/s';

// [id, apply(value), fmt, kind]; kind 'rebuild' schedules a controller
// rebuild, 'terrain' stages a heightfield regeneration.
const CONTROLS = [
    ['tMaxSlope', (v) => { tune.maxSlopeAngle = v; }, (v) => v.toFixed(0) + '°', 'rebuild'],
    ['tStepUp',   (v) => { tune.stepUp = v; }, m(2), 'rebuild'],
    ['tStick',    (v) => { tune.stickToFloor = v; }, m(2), 'rebuild'],
    ['tStrength', (v) => { tune.maxStrength = v; }, (v) => v.toFixed(0) + ' N', 'rebuild'],
    ['tSpeed',    (v) => { tune.moveSpeed = v; }, ms(1)],
    ['tJump',     (v) => { tune.jumpSpeed = v; }, ms(1)],
    // A real engine call: the character integrates world gravity itself.
    ['tGravity',  (v) => { tune.gravity = v; Physics.setGravity(0, -v, 0); }, (v) => v.toFixed(2)],
    ['cRigged',   (on) => { tune.riggedAvatar = on; applyStanceVisual(); }],
    ['cBones',    (on) => { const a = characterAvatar(); if (a) a.overlay.setEnabled(on); }],
    // Sensing: stateless queries, so every switch takes effect next frame.
    ['qForward',  (on) => { sense.forwardCast = on; }],
    ['qLedge',    (on) => { sense.ledgeProbe = on; }],
    ['qProx',     (on) => { sense.proximity = on; }],
    ['qRay',      (on) => { sense.lookRay = on; }],
    ['qDraw',     (on) => { sense.drawVolumes = on; }],
    ['qCastDist', (v) => { sense.castDistance = v; }, m(1)],
    ['qProxR',    (v) => { sense.proxRadius = v; }, m(1)],
    ['qAhead',    (v) => { sense.ledgeAhead = v; }, m(2)],
    ['qRayH',     (v) => { sense.rayHeight = v; }, (v) => (v >= 0 ? '+' : '') + v.toFixed(2) + ' m'],
    ['qIgnoreSelf',  (on) => { sense.ignoreSelf = on; }],
    ['qIgnoreProps', (on) => { sense.ignoreProps = on; }],
    ['qMovingOnly',  (on) => { sense.movingOnly = on; }],
    // The size slider creates and destroys real Jolt characters immediately;
    // setCrowdSize only touches the pool entries that change.
    ['cCount',    (v) => setCrowdSize(v), (v) => v.toFixed(0)],
    ['cSpeed',    (v) => { crowd.speed = v; }, ms(1)],
    ['cPhysical', (on) => setCrowdPhysical(on)],
    // innerBody is a construction option too. A ball in flight is cleared
    // first: it would resolve against a body that no longer exists.
    ['cInner',    (on) => {
        if (tune.innerBody === on) return;
        tune.innerBody = on;
        clearBall();
        requestRebuild();
    }],
    ['bSpeed',    (v) => { ballLab.speed = v; }, ms(1)],
    // A heightfield body is immutable: the sliders stage, a regeneration applies.
    ['tAmp',      (v) => { terrain.amplitude = v; }, m(1), 'terrain'],
    ['tFreq',     (v) => { terrain.frequency = v; }, (v) => v.toFixed(3), 'terrain'],
    ['optLabels', (on) => { view.labels = on; }],
    ['optInterp', (on) => { view.interpolation = on; Physics.setInterpolation(on); }],
];

export function bindHud() {
    tabs('#tabs');
    for (const [id, apply, fmt, kind] of CONTROLS) {
        const c = bindControl('#' + id, {
            out: fmt ? '#' + id + 'V' : null, fmt,
            onChange: (v) => {
                apply(v);
                if (kind === 'rebuild') requestRebuild();
                if (kind === 'terrain') requestTerrain();
            },
        });
        // Push the panel's initial value, without scheduling anything.
        if (!kind) apply(c.value);
    }

    const goTo = (x, footY, z) => teleport(x, footY + RADIUS + STAND_HALF, z);
    $('#btnReset').onclick = () => { resetToSpawn(); resetCrowd(); };
    // Three zones are 30-90 m from spawn; walking there each time is a chore.
    $('#btnGoCrowd').onclick = () => { goTo(PLAZA.x, 0, PLAZA.z + PLAZA.radius + 2.5); resetCrowd(); };
    $('#btnGoBall').onclick = () => goTo(BALL_LAB.x, 0, BALL_LAB.z);
    // Drop in ABOVE the hill: the surface height at the landing spot is known.
    $('#btnGoTerrain').onclick = () =>
        goTo(TERRAIN_WALK.x, heightAt(TERRAIN_WALK.x, TERRAIN_WALK.z) + 0.6, TERRAIN_WALK.z);
    $('#btnLaunch').onclick = () => launchBall();
    $('#btnRegen').onclick = () => regenerateTerrain();

    if (!characterAvatar()) {
        $('#cRigged').disabled = true;
        $('#cBones').disabled = true;
    }
}

// --- readout ---------------------------------------------------------------------

const v3 = (v) => `${v.x.toFixed(2)} ${v.y.toFixed(2)} ${v.z.toFixed(2)}`;

function set(id, text, cls) {
    const el = document.getElementById(id);
    if (!el) return;
    el.textContent = text;
    el.className = cls || '';
}

export function updateReadout(fps) {
    const s = charState;
    set('roPos', v3(s.position));
    set('roVel', v3(s.velocity));
    set('roSpeed', s.speed.toFixed(2) + ' m/s');
    set('roGround', s.groundState, s.groundState === 'onGround' ? 'good' : s.groundState === 'onSteepGround' ? 'hot' : '');
    set('roGrounded', String(s.isGrounded), s.isGrounded ? 'good' : 'hot');
    set('roNormal', v3(s.groundNormal));
    // Hot the moment it crosses the limit the engine is about to act on.
    set('roSlope', s.slopeDeg.toFixed(1) + '°', s.slopeDeg > tune.maxSlopeAngle ? 'hot' : '');
    set('roBody', String(s.groundBodyId));
    const gv = s.groundVelocity;
    set('roPlatform', v3(gv), Math.hypot(gv.x, gv.y, gv.z) > 0.01 ? 'good' : '');
    set('roStance', s.stance, s.stance === 'crouching' ? 'good' : '');
    set('roBlocked', s.blocked ? 'YES' : 'no', s.blocked ? 'hot' : '');
    set('roStandBlocked', s.standBlocked ? 'YES' : 'no', s.standBlocked ? 'hot' : '');
    const a = characterAvatar();
    set('roAvatar', a ? (tune.riggedAvatar ? a.state || '—' : 'hidden') : 'no Rig');

    set('stGround', s.groundState);
    set('stSpeed', s.horizontalSpeed.toFixed(2) + ' m/s');
    set('stStance', s.stance);
    if (fps !== undefined) set('fps', fps.toFixed(0));

    updateSensors();
    updateCrowd();
    updateBall();
    updateTerrain();
}

function updateCrowd() {
    const c = crowdState;
    set('coCount', String(c.active) + (c.physical ? '' : ' (ghosts)'),
        c.physical && c.active ? 'good' : (c.active ? 'hot' : ''));
    set('coSpeed', c.meanSpeed.toFixed(2) + ' m/s', crowd.speed > 0.1 && c.meanSpeed < crowd.speed * 0.7 ? 'hot' : '');
    set('coTouch', String(c.touchingPlayer), c.touchingPlayer ? 'hot' : '');
    // The headline: the fraction of the commanded speed the player gets.
    set('coThrough', (c.playerThrough * 100).toFixed(0) + '%', c.playerThrough < 0.7 ? 'hot' : 'good');
}

function updateBall() {
    const b = ballState;
    set('boTag', b.selfTag > 0 ? String(b.selfTag) : 'none (-1)', b.selfTag > 0 ? 'good' : 'hot');
    set('boSeen', b.selfVisible ? 'YES' : 'no', b.selfVisible ? 'good' : 'hot');
    set('boVerdict', b.verdict, b.verdict === 'DEFLECTED' ? 'good' : b.verdict === 'PASSED THROUGH' ? 'hot' : '');
    set('boPast', b.shots ? b.past.toFixed(2) + ' m' : '—', b.past > 1.2 ? 'hot' : '');
    set('boMin', b.minDist === Infinity ? '—' : b.minDist.toFixed(2) + ' m');
}

function updateTerrain() {
    const t = terrainState;
    set('toOn', t.onTerrain ? 'yes' : 'no', t.onTerrain ? 'good' : '');
    set('toMeas', t.slopeMeasured.toFixed(1) + '°', t.slopeMeasured > tune.maxSlopeAngle ? 'hot' : '');
    set('toAna', t.onTerrain ? t.slopeAnalytic.toFixed(1) + '°' : '—');
    // Engine normal vs the height function's derivative: a couple of degrees is
    // quantization; a big number would mean collision is not what is drawn.
    set('toErr', t.onTerrain && charState.isGrounded ? t.slopeError.toFixed(1) + '°' : '—',
        t.slopeError > 12 ? 'hot' : 'good');
    set('toY', t.onTerrain ? t.groundY.toFixed(2) + ' m' : '—');
}

let proxSig = '';

// Every line is a field off a query result: nothing smoothed or debounced.
function updateSensors() {
    const sw = qState.sweep;
    set('qoSweep', sense.forwardCast ? (sw ? sw.name : 'clear') : 'off', sense.forwardCast ? (sw ? 'hot' : 'good') : '');
    set('qoSweepD', sw ? sw.dist.toFixed(2) + ' m' : (sense.forwardCast ? '> ' + sense.castDistance.toFixed(1) + ' m' : '—'));

    const l = qState.ledge;
    set('qoLedge', !sense.ledgeProbe ? 'off' : (l && l.isLedge ? 'LEDGE' : 'flat'),
        !sense.ledgeProbe ? '' : (l && l.isLedge ? 'hot' : 'good'));
    set('qoDrop', !l ? '—' : (l.drop === Infinity ? 'no floor' : l.drop.toFixed(2) + ' m'), l && l.isLedge ? 'hot' : '');

    const prox = qState.prox;
    set('qoProxN', sense.proximity ? String(prox.length) : 'off', sense.proximity && prox.length ? 'good' : '');
    const sig = prox.map((o) => o.bodyId + ':' + o.dist.toFixed(1)).join(',');
    if (sig !== proxSig) {
        proxSig = sig;
        const host = $('#qoProxList');
        host.textContent = '';
        for (const o of prox) {
            const row = document.createElement('div');
            row.className = 'row';
            const nm = document.createElement('span');
            nm.textContent = o.name;
            const d = document.createElement('b');
            d.textContent = o.dist.toFixed(2) + ' m';
            row.appendChild(nm);
            row.appendChild(d);
            host.appendChild(row);
        }
    }

    // Read the two ray rows together: with ignoreBody off, both say SELF.
    const r = qState.ray, raw = qState.rayUnfiltered;
    set('qoRay', !sense.lookRay ? 'off' : (r ? r.name : 'nothing'), r && r.name.startsWith('SELF') ? 'hot' : (r ? 'good' : ''));
    set('qoRayD', r ? r.dist.toFixed(2) + ' m' : '—');
    set('qoRayRaw', !sense.lookRay ? 'off' : (raw ? raw.name : 'nothing'), raw && raw.name.startsWith('SELF') ? 'hot' : '');
    set('qoRayRawD', raw ? raw.dist.toFixed(2) + ' m' : '—');

    const pk = qState.pick;
    set('qoPick', pk ? pk.name : 'click a body', pk ? 'good' : '');
}
