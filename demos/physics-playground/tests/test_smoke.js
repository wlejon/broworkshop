// tests/test_smoke.js — behavioural smoke test for Physics Playground.
//
// Every assertion here measures a DIFFERENCE that only the feature under test
// can explain. "It did not throw" proves nothing about a physics API; a body
// in a low-gravity field has to actually fall more slowly than an identical
// body outside it, or the field is not installed no matter what
// setAreaOverride returned.
//
// The experiments are all paired: same shape, same drop height, same duration,
// one variable. Playback under advanceTime() is deterministic, so the numbers
// below are reproducible run to run.

const app = await import('/app/app.js');

let failures = 0;
function check(name, ok, detail) {
    if (ok) {
        console.log(`  PASS  ${name}${detail ? ' — ' + detail : ''}`);
    } else {
        failures++;
        console.log(`  FAIL  ${name}${detail ? ' — ' + detail : ''}`);
    }
}

// Settle the app: let bindHud's pushes reach the engine and the first frames run.
advanceTime(200);

const y = (t) => Physics.getTransform(t).position.y;
const x = (t) => Physics.getTransform(t).position.x;

// A clean slate between experiments — spawned bodies only, never the stage.
function reset() {
    app.clearAll();
    advanceTime(120);
}

console.log('--- scaffold -------------------------------------------------');
check('scene context', !!app.scene, typeof app.scene);
check('stage lanes built', Object.keys(app.stage.lanes).length === 3,
      Object.keys(app.stage.lanes).join(','));
check('ice is slick', app.stage.lanes.ice.friction < 0.1,
      `mu=${app.stage.lanes.ice.friction}`);
check('rubber is bouncy', app.stage.lanes.rubber.restitution > 0.8,
      `e=${app.stage.lanes.rubber.restitution}`);
check('six collision layers', app.LAYER_NAMES.length === 6, app.LAYER_NAMES.join(','));
check('three area zones', app.AREA_DEFS.length === 3,
      app.AREA_DEFS.map(d => d.key).join(','));

console.log('--- spawning + registry --------------------------------------');
reset();
const s1 = app.spawn('box', { x: 0, y: 6, z: 0 }, { layer: 'player' });
const s2 = app.spawn('compound', { x: 2, y: 6, z: 0 }, { layer: 'debris' });
check('body count tracks spawns', app.bodyCount() === 2, `n=${app.bodyCount()}`);
check('registry keyed by tag', app.bodies.get(s1.tag).kind === 'box');
check('compound spawns', app.bodies.get(s2.tag).kind === 'compound');
app.despawn(s2.tag);
check('despawn removes one', app.bodyCount() === 1, `n=${app.bodyCount()}`);
app.clearAll();
check('clearAll empties registry', app.bodyCount() === 0);
check('clearAll spares the stage', Physics.getTransform(app.stage.lanes.ice.body) !== undefined,
      'ice lane body still alive');

console.log('--- low-gravity area field -----------------------------------');
// Same sphere, same height, same second of simulation. The only difference is
// which volume it is inside. The low-gravity zone sits at x=8, z=-6.
reset();
app.setAreaEnabled('lowgrav', true);
app.setAreaParam('lowgrav', 'gravityScale', 0.12);
{
    const inZone  = app.spawn('sphere', { x: 8,  y: 8.5, z: -6 }, { layer: 'player', linearDamping: 0 });
    const outZone = app.spawn('sphere', { x: -8, y: 8.5, z: -6 }, { layer: 'player', linearDamping: 0 });
    advanceTime(1000);
    const dIn  = 8.5 - y(inZone.tag);
    const dOut = 8.5 - y(outZone.tag);
    check('low-gravity body falls measurably slower',
          dIn < dOut * 0.5,
          `fell ${dIn.toFixed(3)} m inside vs ${dOut.toFixed(3)} m outside`);

    // And the field is genuinely the cause: switch it off, re-drop, converge.
    reset();
    app.setAreaEnabled('lowgrav', false);
    const off = app.spawn('sphere', { x: 8, y: 8.5, z: -6 }, { layer: 'player', linearDamping: 0 });
    advanceTime(1000);
    const dOff = 8.5 - y(off.tag);
    check('disabling the zone restores normal fall',
          Math.abs(dOff - dOut) < 0.25,
          `fell ${dOff.toFixed(3)} m with zone off vs ${dOut.toFixed(3)} m outside`);
    app.setAreaEnabled('lowgrav', true);
}

console.log('--- water / damping area field -------------------------------');
// The water tank sits at x=8, z=0 with its top at y=5. A body dropped into it
// has to end up higher than a body that fell the same second in free air.
reset();
app.setAreaEnabled('water', true);
{
    const wet = app.spawn('sphere', { x: 8,  y: 4.5, z: 0 }, { layer: 'player', linearDamping: 0 });
    const dry = app.spawn('sphere', { x: -8, y: 4.5, z: 0 }, { layer: 'player', linearDamping: 0 });
    advanceTime(1000);
    const dWet = 4.5 - y(wet.tag);
    const dDry = 4.5 - y(dry.tag);
    check('high-damping zone measurably slows a body',
          dWet < dDry * 0.6,
          `sank ${dWet.toFixed(3)} m in water vs ${dDry.toFixed(3)} m in air`);
}

console.log('--- point-gravity well ---------------------------------------');
// The well is centred at (9, 5.5, 6) in 'combine' mode, so it ADDS to world
// gravity. A body released level with the centre but offset in +X should be
// pulled back toward the centre — i.e. its X must decrease.
reset();
app.setAreaEnabled('well', true);
app.setAreaParam('well', 'gravityStrength', 40);
// gravityFactor stays at 1: per the API docs a body with gravityFactor 0
// floats through EVERY field, the area's included, so zeroing it to cancel
// world gravity would also cancel the thing under test. Instead we measure X
// only — world gravity is purely -Y and cannot move a body sideways, so any
// X displacement is the well and nothing else.
{
    const pulled = app.spawn('sphere', { x: 12.5, y: 5.5, z: 6 }, { layer: 'player', linearDamping: 0 });
    const freeF  = app.spawn('sphere', { x: -8,   y: 5.5, z: 6 }, { layer: 'player', linearDamping: 0 });
    advanceTime(700);
    const moved = 12.5 - x(pulled.tag);
    const drift = Math.abs(-8 - x(freeF.tag));
    check('point gravity pulls a body toward the well centre',
          moved > 0.3 && drift < 0.05,
          `moved ${moved.toFixed(3)} m inward; control drifted ${drift.toFixed(4)} m`);
    app.setAreaParam('well', 'gravityStrength', 26);
}

console.log('--- restitution ----------------------------------------------');
// Same drop height onto the same concrete lane, restitution the only variable.
// Apex is sampled after the first impact so it is a rebound height, not the
// tail of the initial fall.
reset();
app.setAreaEnabled('lowgrav', false);
app.setAreaEnabled('water', false);
app.setAreaEnabled('well', false);
{
    // Both clear of the ramps (which end at x=-11) and clear of the water
    // tank (x=4..12), so the concrete lane is the only thing they touch.
    // A 5.55 m fall takes ~1.06 s, so sampling starts at frame 80 — anything
    // earlier would record the tail of the initial drop as if it were a bounce.
    const bouncy = app.spawn('sphere', { x: 0,  y: 6, z: 0 },
        { layer: 'player', restitution: 0.95, restitutionCombine: 'max', linearDamping: 0 });
    const dead   = app.spawn('sphere', { x: -4, y: 6, z: 0 },
        { layer: 'player', restitution: 0.0, restitutionCombine: 'min', linearDamping: 0 });
    let apexB = 0, apexD = 0;
    for (let i = 0; i < 240; i++) {
        advanceTime(16);
        if (i > 80) {                       // past the first contact
            apexB = Math.max(apexB, y(bouncy.tag));
            apexD = Math.max(apexD, y(dead.tag));
        }
    }
    check('high-restitution ball rebounds higher than a dead one',
          apexB > apexD * 3 && apexB > 1.0,
          `apex ${apexB.toFixed(3)} m vs ${apexD.toFixed(3)} m`);
}

console.log('--- runtime friction -----------------------------------------');
// One box, one launch velocity, one lane. setFriction is applied AFTER the
// body exists, so this proves the runtime setter — not the create option.
// Launched from x=-9: downfield of the ramps (which end at x=-11) so nothing
// is in the way, and at 8 m/s over 1.2 s the slick case stops short of the
// water tank at x=4 while the grippy case never gets near it. Both zones are
// off here anyway, but keeping the run clear of them makes the number mean
// only one thing.
function slideDistance(friction) {
    reset();
    const b = app.spawn('box', { x: -9, y: 0.42, z: 0 },
        { layer: 'player', friction: 0.5, restitution: 0, linearDamping: 0, angularDamping: 0 });
    Physics.setFriction(b.tag, friction);
    Physics.activate(b.tag);
    Physics.setLinearVelocity(b.tag, 8, 0, 0);
    advanceTime(1200);
    return x(b.tag) - (-9);
}
{
    const slick = slideDistance(0.02);
    const grip  = slideDistance(1.5);
    check('runtime setFriction changes slide distance',
          slick > grip * 1.8,
          `slid ${slick.toFixed(3)} m at mu=0.02 vs ${grip.toFixed(3)} m at mu=1.5`);
    check('getBodyProperties round-trips the runtime setters', (() => {
        reset();
        const b = app.spawn('box', { x: 0, y: 6, z: 0 }, { layer: 'player' });
        Physics.setMass(b.tag, 42);
        Physics.setFriction(b.tag, 0.77);
        Physics.setRestitution(b.tag, 0.66);
        Physics.setLinearDamping(b.tag, 1.25);
        Physics.setAngularDamping(b.tag, 2.5);
        Physics.setGravityFactor(b.tag, 0.5);
        const p = Physics.getBodyProperties(b.tag);
        return Math.abs(p.mass - 42) < 0.01 && Math.abs(p.friction - 0.77) < 0.01 &&
               Math.abs(p.restitution - 0.66) < 0.01 && Math.abs(p.linearDamping - 1.25) < 0.01 &&
               Math.abs(p.angularDamping - 2.5) < 0.01 && Math.abs(p.gravityFactor - 0.5) < 0.01;
    })(), 'mass/friction/restitution/damping/gravityFactor all read back');
}

console.log('--- gravityFactor --------------------------------------------');
reset();
{
    const floaty = app.spawn('sphere', { x: 0,  y: 8, z: 0 }, { layer: 'player', linearDamping: 0 });
    const normal = app.spawn('sphere', { x: -4, y: 8, z: 0 }, { layer: 'player', linearDamping: 0 });
    app.select(floaty.tag);
    app.setSelectedProp('gravityFactor', 0.0);      // through the HUD's own path
    advanceTime(900);
    check('setGravityFactor(0) via the HUD path makes a body float',
          Math.abs(y(floaty.tag) - 8) < 0.05 && y(normal.tag) < 5.5,
          `floaty y=${y(floaty.tag).toFixed(3)}, normal y=${y(normal.tag).toFixed(3)}`);
    app.select(null);
}

console.log('--- collision layer matrix -----------------------------------');
// A projectile dropped onto a scenery ramp. With the pair enabled it must come
// to rest ON the ramp; with the pair disabled it must fall clean past it. The
// ramps span x=-21..-11 at z=0 with their surface around y=2.2.
function dropOntoRamp() {
    reset();
    const b = app.spawn('sphere', { x: -16, y: 7, z: 0 },
        { layer: 'projectile', friction: 1.5, restitution: 0, linearDamping: 0 });
    advanceTime(1400);
    return y(b.tag);
}
{
    app.setPair('projectile', 'scenery', true);
    const blocked = dropOntoRamp();
    app.setPair('projectile', 'scenery', false);
    const through = dropOntoRamp();
    check('layer pair ON stops a projectile on the ramp',
          blocked > 1.0, `rested at y=${blocked.toFixed(3)}`);
    check('layer pair OFF lets it pass through',
          through < 0.5, `fell to y=${through.toFixed(3)}`);
    check('layer matrix change is what moved it',
          blocked - through > 1.5,
          `${blocked.toFixed(3)} m vs ${through.toFixed(3)} m — delta ${(blocked - through).toFixed(3)} m`);

    check('setPair keeps the matrix symmetric',
          app.collides('projectile', 'scenery') === app.collides('scenery', 'projectile'));
    app.resetLayers();
    check('resetLayers restores the default pair', app.collides('projectile', 'scenery') === false);
    check('defaults keep debris off itself', app.collides('debris', 'debris') === false);
    check('defaults keep player colliding with all', app.collides('player', 'debris') === true);
}

console.log('--- step rate + interpolation --------------------------------');
// With interpolation OFF the render-side transform must equal the stepped
// transform exactly. With it ON, at a deliberately slow step rate, the two
// must disagree at least once across a run of frames — that disagreement IS
// the smoothing.
reset();
{
    app.setStepRate(15);
    check('setStepRate records the rate', app.state.stepHz === 15);

    app.setInterpolation(false);
    const a = app.spawn('sphere', { x: 0, y: 40, z: 0 }, { layer: 'player', linearDamping: 0 });
    let mismatchesOff = 0;
    for (let i = 0; i < 24; i++) {
        advanceTime(16);
        const t = Physics.getTransform(a.tag).position.y;
        const r = Physics.getTransform(a.tag, { interpolated: true }).position.y;
        if (Math.abs(t - r) > 1e-6) mismatchesOff++;
    }
    check('interpolation off: render pose == stepped pose',
          mismatchesOff === 0, `${mismatchesOff} frames differed`);

    reset();
    app.setInterpolation(true);
    const b = app.spawn('sphere', { x: 0, y: 40, z: 0 }, { layer: 'player', linearDamping: 0 });
    let mismatchesOn = 0;
    for (let i = 0; i < 24; i++) {
        advanceTime(16);
        const t = Physics.getTransform(b.tag).position.y;
        const r = Physics.getTransform(b.tag, { interpolated: true }).position.y;
        if (Math.abs(t - r) > 1e-6) mismatchesOn++;
    }
    check('interpolation on at 15 Hz: render pose leads/lags the stepped pose',
          mismatchesOn > 4, `${mismatchesOn}/24 frames blended`);
    check('getInterpolation reflects the toggle', Physics.getInterpolation() === true);

    app.setInterpolation(false);
    app.setStepRate(60);
}

console.log('--- scene sync -----------------------------------------------');
// The PhysicsNode visuals have to actually track the bodies, or the whole
// sandbox renders at the origin.
reset();
{
    const e = app.spawn('sphere', { x: 6, y: 5, z: 3 }, { layer: 'player', linearDamping: 0 });
    advanceTime(300);
    app.scene.syncPhysics();
    const p = Physics.getTransform(e.tag).position;
    check('PhysicsNode visual tracks its body',
          Math.abs(e.node.x - p.x) < 1e-3 && Math.abs(e.node.y - p.y) < 1e-3,
          `node (${e.node.x.toFixed(3)}, ${e.node.y.toFixed(3)}) vs body (${p.x.toFixed(3)}, ${p.y.toFixed(3)})`);
}

console.log('--- material race + stress -----------------------------------');
reset();
{
    // A controlled experiment, so every field is off: identical balls, identical
    // ramps, identical release height. Only the lane surface differs.
    for (const k of ['lowgrav', 'water', 'well']) app.setAreaEnabled(k, false);
    const racers = app.materialRace(app.stage);
    check('material race drops one ball per lane', racers.length === 3);
    advanceTime(6000);
    const byLane = {};
    for (let i = 0; i < racers.length; i++) byLane[app.stage.MATERIALS[i].key] = x(racers[i].tag);
    console.log(`        ice x=${byLane.ice.toFixed(2)}  concrete x=${byLane.concrete.toFixed(2)}  rubber x=${byLane.rubber.toFixed(2)}`);
    check('every racer made it off its ramp onto the lane',
          byLane.ice > -11 && byLane.concrete > -11 && byLane.rubber > -11,
          'all past the ramp exit at x=-11');
    // A real margin, not a tie broken in the third decimal: the slick lane has
    // to carry the box metres further, or friction is not doing the work.
    check('ice carries a sliding box far further than concrete',
          byLane.ice - byLane.concrete > 3.0,
          `ice x=${byLane.ice.toFixed(2)} vs concrete x=${byLane.concrete.toFixed(2)} ` +
          `(+${(byLane.ice - byLane.concrete).toFixed(2)} m)`);

    reset();
    app.rain(120);
    check('rain spawns the requested count', app.bodyCount() === 120, `n=${app.bodyCount()}`);
    advanceTime(1500);
    app.scene.syncPhysics();
    check('stress pile survives simulation', app.bodyCount() === 120);
    app.clearAll();
    check('cleanup', app.bodyCount() === 0);
}

console.log('--- ragdolls: joints hold ------------------------------------');
// A ragdoll dropped limp has to do two things at once: end up on the floor,
// and stay ASSEMBLED. The second is the interesting one — every parent/child
// distance is owned by a swing-twist constraint, so if the joints were not
// really there the parts would simply fall as thirteen independent capsules
// and the distances would scatter.
reset();
{
    const SPAWN_Y = 4;
    const e = app.spawnRagdoll({ x: 0, y: SPAWN_Y, z: 0 });
    check('ragdoll has the full humanoid part set',
          e.rd.partCount === app.PART_NAMES.length && e.rd.partCount === 12,
          `${e.rd.partCount} parts`);
    check('part bodies are ordinary bodies',
          typeof Physics.getBodyProperties(e.rd.partBody(0)).mass === 'number',
          `pelvis mass ${Physics.getBodyProperties(e.rd.partBody(0)).mass.toFixed(2)} kg`);
    check('findPart maps a part body tag back to its ragdoll',
          app.findPart(e.rd.partBody(5)).index === 5 && app.findPart(e.rd.partBody(5)).entry === e);

    const partPos = (i) => Physics.getTransform(e.rd.partBody(i)).position;
    const restBind = app.jointResidual(e);
    check('the rig starts with its joints exactly closed',
          restBind < 1e-3, `worst pivot residual ${(restBind * 1000).toFixed(3)} mm at spawn`);

    advanceTime(4000);

    let maxY = -Infinity;
    for (let i = 0; i < e.rd.partCount; i++) maxY = Math.max(maxY, partPos(i).y);
    check('a dropped ragdoll comes to rest below its spawn height',
          maxY < SPAWN_Y - 1.0,
          `highest part rests at y=${maxY.toFixed(3)} (spawned at y=${SPAWN_Y})`);

    // Joints hold: every constraint's shared pivot, reconstructed from the
    // parent and from the child, still agrees to within millimetres after a
    // 4 m drop and a landing. Centre-to-centre distance would be the wrong
    // measure — a rotating hip changes it legitimately.
    const worst = app.jointResidual(e);
    check('joints still hold every part pair after the landing',
          worst < 0.02,
          `worst pivot residual ${(worst * 1000).toFixed(2)} mm across ${e.rd.partCount - 1} joints`);

    // ...and the parts really did move relative to each other, so the residual
    // above is not just measuring a rigid body that never articulated.
    const headBend = app.poseError(e, 'stand');
    check('the ragdoll articulated rather than falling as one rigid lump',
          headBend > 0.1, `mean joint angle off bind ${(headBend * 180 / Math.PI).toFixed(1)}°`);
}

console.log('--- ragdolls: per-part impulse -------------------------------');
// An impulse on ONE part is the whole reason part bodies are exposed. It has
// to move that part far more than a part at the other end of the joint chain —
// if it moved everything equally the impulse landed on the ragdoll, not a limb.
reset();
{
    const e = app.spawnRagdoll({ x: 0, y: 4, z: 0 });
    advanceTime(3000);                            // let it settle, limp
    const at = (i) => Physics.getTransform(e.rd.partBody(i)).position;
    const near = app.PART_NAMES.indexOf('lowerArmR');
    const far  = app.PART_NAMES.indexOf('lowerLegL');
    const n0 = at(near), f0 = at(far);

    // A short window on purpose. An impulse on a forearm reaches the far leg
    // through the joint chain within a few hundred milliseconds — correct
    // physics, useless as a measurement of WHERE the impulse landed. 150 ms is
    // while "this limb and not that one" is still true.
    app.punchPart(e, near, { x: 0.2, y: 1, z: 0 }, 30);
    advanceTime(150);

    const n1 = at(near), f1 = at(far);
    const dNear = Math.hypot(n1.x - n0.x, n1.y - n0.y, n1.z - n0.z);
    const dFar  = Math.hypot(f1.x - f0.x, f1.y - f0.y, f1.z - f0.z);
    check('an impulse moves the struck part far more than a distant one',
          dNear > dFar * 3 && dNear > 0.1,
          `lowerArmR moved ${dNear.toFixed(3)} m, lowerLegL moved ${dFar.toFixed(3)} m`);
}

console.log('--- ragdolls: pose drive -------------------------------------');
// driveToPose powers the JOINTS toward a pose's parent-relative rotations. It
// does not move the ragdoll anywhere, so the measurement is the joint-angle
// error against the target — the exact quantity the motors are solving.
reset();
{
    const e = app.spawnRagdoll({ x: 0, y: 4, z: 0 });
    advanceTime(3000);                            // land, limp, joints splayed
    const before = app.poseError(e, 'stand');
    app.driveRagdoll(e, 'stand', false, { frequency: 20, damping: 1 });
    advanceTime(2000);
    const after = app.poseError(e, 'stand');
    check('motorised driveToPose measurably closes the joint-angle error',
          after < before * 0.6 && before > 0.05,
          `mean joint error ${(before * 180 / Math.PI).toFixed(1)}° -> ` +
          `${(after * 180 / Math.PI).toFixed(1)}°`);

    // Motors persist, so going limp has to be observable too: released, the
    // ragdoll sags back out of the pose under its own weight.
    app.stopDrive(e);
    advanceTime(1500);
    check('stopDrive releases the motors and the pose decays',
          app.poseError(e, 'stand') > after,
          `error back to ${(app.poseError(e, 'stand') * 180 / Math.PI).toFixed(1)}°`);
}

// Kinematic drive is the other half of the pair, and it IS positional: it sets
// part velocities to reach the target transforms, so a heap on the floor
// genuinely stands up. That is the difference the HUD checkbox is showing.
reset();
{
    const e = app.spawnRagdoll({ x: 0, y: 4, z: 0 });
    advanceTime(3000);
    const head = app.PART_NAMES.indexOf('head');
    const headY = () => Physics.getTransform(e.rd.partBody(head)).position.y;
    const down = headY();

    app.driveRagdoll(e, 'stand', true);
    // Kinematic tracking is incremental pursuit — it must be re-issued every
    // step, which is what app.js's updateRagdolls does per frame. advanceTime
    // pumps that loop for us.
    advanceTime(2000);
    const up = headY();
    check('kinematic drive stands a fallen ragdoll up',
          up > down + 0.8 && up > 1.4,
          `head y ${down.toFixed(3)} -> ${up.toFixed(3)}`);
    app.stopDrive(e);
}

console.log('--- cloth: pinning ------------------------------------------');
// The cleanest proof in this whole file. A pinned vertex carries invMass 0, so
// it does not move approximately — it does not move AT ALL. Exact equality is
// the assertion; anything looser would also pass on a merely stiff cloth.
reset();
{
    const c = app.buildCloth('corners');
    const pins = app.pinIndices('corners');
    const v0 = c.sb.vertices().slice();
    advanceTime(2500);
    const v1 = c.sb.vertices();

    let moved = 0;
    for (const i of pins) {
        if (v0[i * 3] !== v1[i * 3] || v0[i * 3 + 1] !== v1[i * 3 + 1] || v0[i * 3 + 2] !== v1[i * 3 + 2]) moved++;
    }
    check('pinned cloth vertices are EXACTLY unchanged',
          moved === 0, `${pins.length} pinned corners, ${moved} moved`);

    // ...while the sheet between them sags under gravity.
    const mid = Math.floor(app.CLOTH.gridZ / 2) * app.CLOTH.gridX + Math.floor(app.CLOTH.gridX / 2);
    const sag = v0[mid * 3 + 1] - v1[mid * 3 + 1];
    check('the unpinned sheet sags under gravity',
          sag > 0.15, `centre dropped ${sag.toFixed(3)} m`);

    check('cloth topology matches the requested grid',
          c.topo.gridX === app.CLOTH.gridX && c.sb.vertexCount === app.CLOTH.gridX * app.CLOTH.gridZ,
          `${c.sb.vertexCount} vertices, grid ${c.topo.gridX}x${c.topo.gridZ}`);

    // Releasing the pins has to change the outcome, or 'pinned' meant nothing.
    const free = app.buildCloth('none');
    const f0 = free.sb.vertices().slice();
    advanceTime(1200);
    const f1 = free.sb.vertices();
    const fell = f0[1] - f1[1];
    check('an unpinned cloth falls as a whole instead of hanging',
          fell > 1.5, `corner fell ${fell.toFixed(3)} m`);
}

console.log('--- cloth: setVertexVelocity --------------------------------');
// Direct vertex control: kick the +X half of the sheet and nothing else. The
// untouched half staying put is what makes this a proof rather than a nudge.
reset();
{
    const c = app.buildCloth('corners');
    // Settle first, and settle properly: at 4 s the sheet is still swinging
    // ~3 cm per 250 ms, which would drown the signal. By 10 s it is dead still.
    advanceTime(10000);
    const before = c.sb.vertices().slice();
    const hit = new Set(app.gustCloth(9));
    check('gust targets a region, not the whole sheet',
          hit.size > 8 && hit.size < c.sb.vertexCount - 8,
          `${hit.size} of ${c.sb.vertexCount} vertices kicked`);

    // A short window on purpose. The cloth's edges are rigid, so momentum from
    // the kicked half reaches the far corners within about 100 ms and after
    // that the whole sheet is swinging — which is correct physics and useless
    // as a measurement. The first 50 ms is where "this region and not that one"
    // is still true.
    advanceTime(50);
    const after = c.sb.vertices();
    const meanDisp = (pred) => {
        let s = 0, n = 0;
        for (let i = 0; i < c.sb.vertexCount; i++) {
            if (!pred(i)) continue;
            s += Math.hypot(after[i * 3] - before[i * 3],
                            after[i * 3 + 1] - before[i * 3 + 1],
                            after[i * 3 + 2] - before[i * 3 + 2]);
            n++;
        }
        return n ? s / n : 0;
    };
    const pins = new Set(app.pinIndices('corners'));
    const dHit  = meanDisp(i => hit.has(i));
    const dRest = meanDisp(i => !hit.has(i) && !pins.has(i));
    check('setVertexVelocity displaces the targeted region far more',
          dHit > dRest * 3 && dHit > 0.1,
          `in 50 ms the kicked region moved ${dHit.toFixed(3)} m, ` +
          `the untouched half ${dRest.toFixed(3)} m`);
}

console.log('--- pressurized soft body ------------------------------------');
// One closed icosphere, one drop height, one variable: the gas coefficient.
// Rebound is measured as the mean vertex height after the first contact — a
// soft body has no single "position" worth trusting while it is squashing.
reset();
{
    function rebound(pressure) {
        app.destroySoft('ball');
        const b = app.buildBall(pressure, { position: { x: 15, y: 6, z: 0 } });
        let apex = 0;
        for (let i = 0; i < 190; i++) {
            advanceTime(16);
            if (i > 85) apex = Math.max(apex, app.meanHeight(b));   // past first contact
        }
        return apex;
    }
    const limp = rebound(300);
    const firm = rebound(6000);
    check('higher pressure measurably increases rebound height',
          firm > limp * 1.25 && firm - limp > 0.15,
          `apex ${limp.toFixed(3)} m at p=300 vs ${firm.toFixed(3)} m at p=6000`);

    // setVertex is the other half of per-vertex control: a hard teleport of one
    // cap toward the centre, i.e. a dent.
    // The dent is measured as the cap's mean RADIUS from the ball's own
    // centroid. Height would be the wrong measure twice over: the ball is
    // settling onto the lane, and it is rolling, so a fixed vertex set drifts
    // away from the top. Radius is invariant to both.
    const b = app.buildBall(3000, { position: { x: 15, y: 6, z: 0 } });
    advanceTime(1600);

    const cap = app.poke(b, 0.0);            // zero depth: selects the cap only
    const before = app.regionRadius(b, cap);
    const dented = app.poke(b, 0.35);
    const after = app.regionRadius(b, dented);
    check('poke dents a cap of vertices with setVertex',
          dented.length > 4 && before - after > 0.15,
          `${dented.length} vertices pushed in; cap radius ` +
          `${before.toFixed(3)} m -> ${after.toFixed(3)} m`);
    check('the dent recovers as pressure pushes back', (() => {
        advanceTime(800);
        return app.regionRadius(b, dented) > after + 0.05;
    })(), `cap radius recovers to ${app.regionRadius(b, dented).toFixed(3)} m`);
}

console.log('--- soft/ragdoll cleanup -------------------------------------');
reset();
{
    app.spawnRagdoll({ x: 0, y: 4, z: 0 });
    app.spawnRagdoll({ x: 2, y: 5, z: 0 });
    app.buildCloth('corners');
    app.buildBall(2500);
    check('ragdoll + soft registries populated',
          app.ragdollCount() === 2 && app.totalPartCount() === 2 * app.PART_NAMES.length &&
          app.softBodies.size === 2,
          `${app.ragdollCount()} ragdolls / ${app.totalPartCount()} parts / ${app.softBodies.size} soft`);
    app.clearAll();
    check('clearAll sweeps ragdolls and soft bodies too',
          app.ragdollCount() === 0 && app.softBodies.size === 0 && app.bodyCount() === 0);
}

console.log('--- sixdof: locked axes vs free axes --------------------------');
// The cleanest binary in the file after the cloth pins. A SixDOF axis that is
// LOCKED does not move approximately — it holds to the bit, exactly like an
// invMass-0 vertex. So the assertion is exact equality on the locked axes while
// the free one travels metres under the same motor.
reset();
{
    const off = (a) => app.machineOffset('piston', a);
    // Defaults: translationY limited 0..4.5, everything else locked.
    app.driveMotor('piston', 'translationY', 3.0, { maxForce: 120000, frequency: 5, damping: 1 });
    advanceTime(2500);
    const y = off('translationY');
    check('a sixdof position motor drives its axis to the target',
          Math.abs(y - 3.0) < 0.12,
          `translationY offset ${y.toFixed(4)} m, target 3.000 m`);

    check('the locked axes did not move AT ALL while the free one travelled 3 m',
          off('translationX') === 0 && off('translationZ') === 0,
          `tX ${off('translationX')} · tZ ${off('translationZ')} (exact zeros) vs tY ${y.toFixed(3)}`);

    // ...and the motor HOLDS. Load the 120 kg platform with 3 crates of 40 kg
    // each and it must still be at the target a second later.
    app.loadPiston(3);
    advanceTime(2500);
    const loaded = off('translationY');
    check('the position motor holds its target against gravity under load',
          Math.abs(loaded - 3.0) < 0.20,
          `still at ${loaded.toFixed(4)} m carrying 3 x 40 kg crates`);

    // Freeing a locked axis has to change the outcome, or "locked" meant
    // nothing. translationX freed, the loaded platform slides off its own lift.
    app.setAxis('piston', 'translationX', 'free');
    Physics.addImpulse(app.machines.get('piston').body, 900, 0, 0);
    advanceTime(1000);
    const freed = off('translationX');
    check('freeing a locked axis lets the same body move along it',
          Math.abs(freed) > 0.4,
          `translationX travelled ${freed.toFixed(3)} m once freed (was exactly 0 locked)`);

    // Re-locking pins the axis WHERE IT IS, not back at zero — a rebuilt
    // constraint takes its frames from the bodies' current transforms, so a
    // displaced body stays displaced and simply stops moving. That is the
    // honest behaviour, so the assertion is "frozen", not "recentred".
    app.setAxis('piston', 'translationX', 'locked');
    advanceTime(200);
    const pinned = app.machineOffset('piston', 'translationX');
    Physics.addImpulse(app.machines.get('piston').body, 900, 0, 0);
    advanceTime(900);
    const held = app.machineOffset('piston', 'translationX');
    // NOT bit-exact: a locked SixDOF axis is a solved constraint, not a
    // welded one, so a hard impulse buys a few millimetres of drift. What
    // matters is the ratio — the same shove moves the free axis metres and the
    // locked one centimetres.
    check('re-locking pins the axis where it is — frozen, not recentred',
          Math.abs(held - pinned) < Math.abs(freed) * 0.02,
          `held at ${pinned.toFixed(4)} m through the same shove that moved it ` +
          `${Math.abs(freed).toFixed(2)} m when free (drift ${((held - pinned) * 1000).toFixed(3)} mm)`);
    app.driveMotor('piston', 'translationY', 0.0);
    app.clearMachineDebris();
}

console.log('--- sixdof: velocity motor + rebuild ---------------------------');
// The other motor kind. A velocity motor on the crane's free rotationY has to
// turn the mast continuously, and reversing the target has to reverse it.
reset();
{
    const yaw = () => app.machineOffset('crane', 'rotationY');
    app.setMotor('crane', 'rotationY', { type: 'velocity', target: 0.8, maxTorque: 40000 });
    advanceTime(400);
    const a0 = yaw();
    advanceTime(600);
    const a1 = yaw();
    app.setMotor('crane', 'rotationY', { type: 'velocity', target: -0.8, maxTorque: 40000 });
    advanceTime(400);
    const a2 = yaw();
    advanceTime(600);
    const a3 = yaw();
    check('a velocity motor turns the crane, and reversing the target reverses it',
          a1 - a0 > 0.2 && a3 - a2 < -0.2,
          `+${(a1 - a0).toFixed(3)} rad forward, ${(a3 - a2).toFixed(3)} rad reversed`);

    // Locking the driven axis has to stop it dead, which also proves the
    // destroy-and-rebuild path the axis grid runs on every click.
    app.setAxis('crane', 'rotationY', 'locked');
    const b0 = yaw();
    advanceTime(800);
    check('locking the driven axis stops the motor (constraint rebuild path)',
          Math.abs(yaw() - b0) < 0.02,
          `moved ${(yaw() - b0).toFixed(5)} rad in 0.8 s with the axis locked`);
    app.setAxis('crane', 'rotationY', 'free');
    app.setMotor('crane', 'rotationY', { type: 'velocity', target: 0, maxTorque: 40000 });
}

console.log('--- collideConnected -------------------------------------------');
// Two 0.5 m spheres on a rope capped at 0.4 m. The flag decides whether the
// rope or the contact wins, and the centre separation says which.
reset();
{
    app.setCollideConnected(false);
    advanceTime(1500);
    const off = app.collideSeparation();
    app.setCollideConnected(true);
    advanceTime(1500);
    const on = app.collideSeparation();
    check('collideConnected OFF lets the jointed pair interpenetrate',
          Math.abs(off - 0.4) < 0.02,
          `centres ${off.toFixed(4)} m apart — the rope's 0.4 m cap, well inside the 1.0 m of radii`);
    check('collideConnected ON pushes them apart past the rope\'s own limit',
          on - off > 0.15,
          `${off.toFixed(4)} m off vs ${on.toFixed(4)} m on — contact beat the constraint`);
    app.setCollideConnected(false);
}

console.log('--- gear / rackAndPinion / pulley -------------------------------');
// Three constraint types that shipped in the binding layer and that no
// broworkshop app had ever called. All three measured, none faked.
reset();
{
    const g = app.mechanisms.get('gears');

    /**
     * Mean signed spin rate of each gear about its axle, rad/s.
     *
     * Angular velocity, not integrated quaternion deltas. Two reasons, both
     * learned the hard way. An unsigned quaternion angle cannot tell a gear
     * turning forwards from one ringing back and forth, so integrating |dq|
     * over a window silently counts the spin-up oscillation as travel and
     * reports a driven gear turning 19% FASTER than its driver at ratio 1:1.
     * And the axle here is +Z, so the one component that matters is readable
     * directly and exactly.
     *
     * The 2.5 s spin-up matters too: the coupling is solved, not machined, so
     * the driven gear rings for a second or so after the motor starts before
     * settling onto the exact ratio.
     */
    function gearRates(ratio) {
        // Dead stop first. The gears carry gravityFactor 0 and no damping, so
        // they coast forever, and a gear constraint locks the two hinge angles
        // as they are when it is CREATED — re-coupling mid-spin would bake the
        // current transient into the measurement.
        app.resetGears();
        advanceTime(100);
        app.setGearRatio(ratio);
        app.setGearDrive(1.0);
        advanceTime(2500);                      // spin up AND let the ringing die
        let wa = 0, wb = 0;
        for (let i = 0; i < 20; i++) {
            advanceTime(50);
            wa += Physics.getVelocity(g.driver.tag).angular.z;
            wb += Physics.getVelocity(g.driven.tag).angular.z;
        }
        return [wa / 20, wb / 20];
    }

    const [wA, wB] = gearRates(1.0);
    check('a gear constraint couples two hinges 1:1',
          Math.abs(wA) > 0.5 && Math.abs(Math.abs(wA) - Math.abs(wB)) < 0.02,
          `driver ${wA.toFixed(4)} rad/s, driven ${wB.toFixed(4)} rad/s — ` +
          `equal and opposite, as meshing gears must be`);

    const [wA2, wB2] = gearRates(2.0);
    check('the gear ratio is exactly rate(A)/rate(B)',
          Math.abs(Math.abs(wA2 / wB2) - 2.0) < 0.02,
          `ratio 2.0 measured ${Math.abs(wA2 / wB2).toFixed(4)} ` +
          `(${wA2.toFixed(3)} vs ${wB2.toFixed(3)} rad/s)`);

    const [wA3, wB3] = gearRates(0.5);
    check('and it follows the ratio the other way too',
          Math.abs(Math.abs(wA3 / wB3) - 0.5) < 0.02,
          `ratio 0.5 measured ${Math.abs(wA3 / wB3).toFixed(4)}`);

    app.resetGears();
    app.setGearRatio(2.0);
    app.setGearDrive(0);

    // Rack & pinion: drive the pinion, the rack translates. Park it at the
    // centre of its travel first — a rack driven at a constant rate reaches its
    // slider limit in a couple of seconds and then measures nothing.
    app.resetRack();
    advanceTime(200);
    app.setRackDrive(2.0);
    const r0 = app.rackOffset();
    advanceTime(900);
    const r1 = app.rackOffset();
    app.setRackDrive(-2.0);
    advanceTime(1400);
    const r2 = app.rackOffset();
    // Sign-agnostic: which way a positive pinion rate pushes the rack is a
    // convention of the axis pair, and the demo only claims that the pinion
    // MOVES the rack and that reversing the pinion reverses the rack.
    check('a rackAndPinion constraint turns pinion rotation into rack travel',
          Math.abs(r1 - r0) > 0.4 && Math.sign(r2 - r1) === -Math.sign(r1 - r0) &&
          Math.abs(r2 - r1) > 0.4,
          `rack ${r0.toFixed(3)} -> ${r1.toFixed(3)} -> ${r2.toFixed(3)} m ` +
          `(${(r1 - r0).toFixed(3)} m driven, ${(r2 - r1).toFixed(3)} m reversed)`);
    app.setRackDrive(0);

    // Pulley: no motor at all. 120 kg one side, 25 kg the other, one rope.
    app.resetPulley();
    const p = app.mechanisms.get('pulley');
    const hy = () => Physics.getTransform(p.heavy.tag).position.y;
    const ly = () => Physics.getTransform(p.light.tag).position.y;
    const h0 = hy(), l0 = ly();
    advanceTime(2000);
    check('a pulley hauls the light side up as the heavy side descends',
          hy() < h0 - 0.5 && ly() > l0 + 0.5,
          `heavy ${h0.toFixed(2)} -> ${hy().toFixed(2)} m, light ${l0.toFixed(2)} -> ${ly().toFixed(2)} m`);
}

console.log('--- breakable constraints ---------------------------------------');
// The identical impact, twice, with only the threshold changed. That is the
// whole feature and it is the whole test.
reset();
function smashAt(threshold) {
    app.rebuildBridge();
    app.setBreakThreshold(threshold);
    advanceTime(600);                          // let the deck settle first
    const settled = app.brokenCount();
    app.dropWreckingBall(900, 12);
    advanceTime(3000);
    return { settled, broken: app.brokenCount(), joints: app.jointCount() };
}
{
    const tough = smashAt(30000);
    check('a high breakingImpulse survives the impact intact',
          tough.broken === 0,
          `0 of ${tough.joints} joints broke under a 900 kg ball at 30000 N·s`);

    const fragile = smashAt(400);
    check('the identical impact at a low threshold snaps joints',
          fragile.broken > 0,
          `${fragile.broken} of ${fragile.joints} joints broke at 400 N·s`);
    check('the threshold is what changed the outcome',
          fragile.broken > tough.broken,
          `${tough.broken} broken at 30000 N·s vs ${fragile.broken} at 400 N·s`);
    check('getBrokenConstraints reported the handles, and they are bridge joints',
          app.bridge.log.length === fragile.broken &&
          app.bridge.log.every(o => app.bridge.joints.some(j => j.handle === o.handle)),
          `${app.bridge.log.length} logged: ` +
          app.bridge.log.slice(0, 4).map(o => `${o.kind}#${o.index}`).join(', '));
    check('the deck actually fell where its joints let go',
          (() => {
              // At least one plank has to be below the deck line; a "broken"
              // structure that never moved would mean the report is cosmetic.
              const y = app.bridge.planks.map(p => Physics.getTransform(p.tag).position.y);
              return Math.min(...y) < app.BRIDGE.y - 1.0;
          })(),
          `lowest plank y=${Math.min(...app.bridge.planks.map(p => Physics.getTransform(p.tag).position.y)).toFixed(2)} ` +
          `(deck line ${app.BRIDGE.y})`);

    // Rebuild has to be a real reset, not a repaint.
    app.rebuildBridge();
    app.setBreakThreshold(30000);
    advanceTime(600);
    check('rebuild restores an unbroken bridge at the deck line',
          app.brokenCount() === 0 && app.rubble.size === 0 &&
          Math.abs(Physics.getTransform(app.bridge.planks[6].tag).position.y - app.BRIDGE.y) < 0.4,
          `${app.jointCount()} joints, 0 broken, ${app.rubble.size} rubble bodies`);
    app.setBreakThreshold(900);
}

console.log('--- contact manifolds -------------------------------------------');
// getContacts() is drained by app.js's frame loop and fanned out from there, so
// the test reads the same log the HUD reads — which means it exercises the real
// path rather than a private drain of its own.
reset();
{
    app.setContactDrawAll(true);
    app.setContactFocus(null);
    app.clearContacts();

    // A three-box stack settling onto the concrete lane.
    const stack = [];
    for (let i = 0; i < 3; i++) {
        stack.push(app.spawn('box', { x: 0, y: 0.42 + i * 0.85, z: 0 },
            { layer: 'player', friction: 0.9, restitution: 0.0 }));
    }
    advanceTime(2000);

    const tags = new Set(stack.map(s => s.tag));
    const mine = app.contactLog.filter(c => tags.has(c.body1) || tags.has(c.body2));
    check('resting-stack contacts carry a non-empty manifold',
          mine.length > 0 && mine.every(c => c.n > 0),
          `${mine.length} events, ${mine.map(c => c.n).join('/')} points each`);
    check('every manifold normal is a unit vector',
          mine.every(c => c.normal &&
              Math.abs(Math.hypot(c.normal.x, c.normal.y, c.normal.z) - 1) < 1e-3),
          `e.g. (${mine[0].normal.x.toFixed(3)}, ${mine[0].normal.y.toFixed(3)}, ${mine[0].normal.z.toFixed(3)})`);
    check('a stack on a flat lane reports a near-vertical normal',
          mine.some(c => Math.abs(c.normal.y) > 0.95),
          `max |n.y| = ${Math.max(...mine.map(c => Math.abs(c.normal.y))).toFixed(4)}`);
    check('penetration is a plausible sub-centimetre depth (or a speculative negative)',
          mine.every(c => Math.abs(c.penetration) < 0.1),
          `worst |penetration| ${(Math.max(...mine.map(c => Math.abs(c.penetration))) * 1000).toFixed(2)} mm; ` +
          `${mine.filter(c => c.penetration < 0).length} speculative`);
}

console.log('--- contact impulse scales with impact ---------------------------');
// The number the effects hang off. Same sphere, same mass, same lane — only
// the closing speed differs, and the estimate has to follow it.
function impactImpulse(speed) {
    reset();
    app.setContactDrawAll(true);
    app.clearContacts();
    const b = app.spawn('sphere', { x: 0, y: 3.0, z: 0 },
        { layer: 'player', mass: 20, restitution: 0.0, linearDamping: 0 });
    Physics.setLinearVelocity(b.tag, 0, -speed, 0);
    Physics.activate(b.tag);
    advanceTime(1600);
    const mine = app.contactLog.filter(c => c.body1 === b.tag || c.body2 === b.tag);
    return mine.length ? Math.max(...mine.map(c => c.impulse)) : 0;
}
{
    const slow = impactImpulse(2);
    const fast = impactImpulse(40);
    check('the impulse estimate is measurably larger for a fast impact',
          fast > slow * 2.5 && slow > 0,
          `${slow.toFixed(1)} kg·m/s at 2 m/s vs ${fast.toFixed(1)} at 40 m/s ` +
          `(x${(fast / slow).toFixed(2)})`);

    // Camera shake is derived from it too. Sampled frame by frame during the
    // impact, because the shake decays ~14% per frame by design — read it a
    // second later and it is legitimately back to zero.
    reset();
    app.setContactDrawAll(true);
    app.clearContacts();
    const hammer = app.spawn('sphere', { x: 0, y: 3.0, z: 0 },
        { layer: 'player', mass: 40, restitution: 0.0, linearDamping: 0 });
    Physics.setLinearVelocity(hammer.tag, 0, -45, 0);
    Physics.activate(hammer.tag);
    let peakShake = 0, peakMeter = 0;
    for (let i = 0; i < 40; i++) {
        advanceTime(16);
        peakShake = Math.max(peakShake, Math.hypot(...app.shakeOffset(i * 0.016)));
        peakMeter = Math.max(peakMeter, app.contactState.peakImpulse);
    }
    // The HUD meter reads the same estimate the effects are scaled by, so a
    // 40 kg mass arriving at 45 m/s has to register as a large number on it.
    check('the HUD impact meter tracks the same impulse estimate',
          peakMeter > 200,
          `meter peaked at ${peakMeter.toFixed(1)} N·s for a 40 kg body at 45 m/s`);
    advanceTime(3000);
    const shakenLater = Math.hypot(...app.shakeOffset(0.25));
    check('contact-driven camera shake fires on impact and decays to rest',
          peakShake > 0.002 && shakenLater === 0,
          `peak |shake| ${peakShake.toFixed(4)} during the hit, ${shakenLater.toFixed(4)} once settled`);

    app.setContactDrawAll(false);
}

console.log('--- chunk 3 cleanup ---------------------------------------------');
// "Clear all" has to mean all three chunks. The machines themselves are
// fixtures like the lanes, but everything they PRODUCE is the user's mess.
{
    app.rain(20);
    app.spawnRagdoll({ x: 0, y: 4, z: 0 });
    app.buildCloth('corners');
    app.craneLoad();
    app.loadPiston(2);
    app.fireTurret();
    app.setBreakThreshold(300);
    app.dropWreckingBall(900, 10);
    advanceTime(2000);
    check('chunk 3 produced debris, rubble and broken joints to clean up',
          app.machineDebris.size >= 4 && app.rubble.size >= 1 && app.brokenCount() > 0,
          `${app.machineDebris.size} machine debris, ${app.rubble.size} rubble, ${app.brokenCount()} broken joints`);

    app.clearAll();
    advanceTime(200);
    check('clearAll sweeps every chunk-3 object and repairs the bridge',
          app.bodyCount() === 0 && app.ragdollCount() === 0 && app.softBodies.size === 0 &&
          app.machineDebris.size === 0 && app.rubble.size === 0 &&
          app.brokenCount() === 0 && app.contactLog.length === 0,
          `bodies ${app.bodyCount()} · debris ${app.machineDebris.size} · rubble ${app.rubble.size} · ` +
          `broken ${app.brokenCount()} · contact log ${app.contactLog.length}`);
    check('the machines themselves survive clear all (they are fixtures)',
          app.machines.size === 4 && app.mechanisms.size === 3 &&
          Physics.getBodyProperties(app.machines.get('piston').body) !== undefined,
          `${app.machines.size} sixdof machines, ${app.mechanisms.size} bench mechanisms`);
    app.setBreakThreshold(900);
}

// A frame for the record — the sandbox as a human first sees it. Zones back
// on, because their translucent hulls are half of what the picture is for.
reset();
for (const k of ['lowgrav', 'water', 'well']) app.setAreaEnabled(k, true);
app.materialRace(app.stage);
app.rain(30);
app.setClothPins('corners');
app.setPressure(2500);
app.dropRagdollRain(3);
advanceTime(2500);
app.scene.syncPhysics();
advanceTime(100);
screenshot('physics_playground.png');

// ...and one per bay, because the three chunks live 36 m apart and a single
// frame of the sandbox says nothing about the crane or the bridge.
// The axis-grid tests above deliberately left the piston displaced off its own
// lift; the screenshots are meant to show the app as a human meets it.
app.resetMachines();
advanceTime(800);

app.focusView('machines');
app.craneLoad();
app.loadPiston(2);
advanceTime(1500);
screenshot('physics_playground_machines.png');

app.focusView('bench');
advanceTime(600);
screenshot('physics_playground_bench.png');

app.focusView('bridge');
app.setBreakThreshold(400);
app.dropWreckingBall(900, 12);
advanceTime(2200);
screenshot('physics_playground_bridge.png');
app.focusView('sandbox');

console.log('==============================================================');
console.log(failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`);
assert(failures === 0, `${failures} check(s) failed`);
