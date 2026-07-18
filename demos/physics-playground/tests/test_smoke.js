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

// A frame for the record — the sandbox as a human first sees it. Zones back
// on, because their translucent hulls are half of what the picture is for.
reset();
for (const k of ['lowgrav', 'water', 'well']) app.setAreaEnabled(k, true);
app.materialRace(app.stage);
app.rain(30);
advanceTime(2500);
app.scene.syncPhysics();
advanceTime(100);
screenshot('physics_playground.png');

console.log('==============================================================');
console.log(failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`);
assert(failures === 0, `${failures} check(s) failed`);
