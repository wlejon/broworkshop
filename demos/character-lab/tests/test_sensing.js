// Sensing: shape casts, overlaps and rays run BEFORE a move, and their
// filters. Each check calls the query directly so a failure names the engine
// call; the numbers are MEASURED against the runtime, not taken from docs.

import { check, test, done, shot } from "/lib/kit/test.js";
import { scene, world, character, charState, resetToSpawn, sense, qState, setFacing, bodyName,
         forwardCast, ledgeProbe, proximity, lookRay, pickAlongRay } from "/app/lab.js";
import { place } from "/app/tests/helpers.js";

advanceTime(64);
flush();

const self = character.innerBody;
const f3 = (v) => v.toFixed(3);

test('forward shape cast: stops 1.2 m short of the tunnel jamb, clear on open ground', () => {
    const t = world.tunnel;
    place(t.x + 1.9, 0.02, t.entryZ);
    setFacing(0, -1);
    const into = forwardCast({ x: 0, z: -1 }, 5);
    check(into, 'hit the jamb');
    // Entry z 4.5, jamb face at 3.0, capsule radius 0.3: 1.2 m of travel.
    check(Math.abs(into.dist - 1.2) < 0.25, `dist ${f3(into.dist)}`);
    check(into.normal.z > 0.8, `normal points back (z ${f3(into.normal.z)})`);
    place(0, 0.02, 12);
    check(forwardCast({ x: 0, z: 1 }, 5) === null, 'open ground: no hit');
});

test('ledge probe: a 2 m drop at the gap lip, flat mid-slab', () => {
    const g = world.gap;
    place(g.x, g.topY, g.nearEdgeZ + 0.4);
    const edge = ledgeProbe({ x: 0, z: -1 }, 0.9, 0.45);
    check(edge && edge.isLedge, 'ledge at the lip');
    check(edge.drop > 1.7 && edge.drop < 2.4, `drop ${f3(edge.drop)} m`);
    place(g.x, g.topY, g.nearEdgeZ + 1.8);
    const flat = ledgeProbe({ x: 0, z: 1 }, 0.9, 0.45);
    check(flat && !flat.isLedge && Math.abs(flat.drop) < 0.12, `flat (drop ${f3(flat.drop)})`);
});

test('overlapShape finds exactly the props in range; layers and ignoreBody filter', () => {
    // A few metres clear of the pile: teleporting INTO it would measure the push.
    place(4.0, 0.02, 12.5);
    advanceTime(200);
    const p = charState.position, R = 5.0;
    const expected = world.props.filter((tag) => {
        const t = Physics.getTransform(tag).position;
        return Math.hypot(t.x - p.x, t.y - p.y, t.z - p.z) <= R - 0.5;
    });
    check(expected.length >= 3, `at least three props within ${R} m (${expected.length})`);
    const got = proximity(R, true).map((o) => o.bodyId);
    for (const tag of expected) check(got.includes(tag), `found ${bodyName(tag)}`);
    for (const id of got) check(world.props.includes(id) || id === world.platform.tag, `moving layer only (saw ${bodyName(id)})`);
    check(!got.includes(self), 'the character is not in its own sensor');
    const wide = proximity(R, false);
    check(wide.length > got.length, `dropping the layer filter widened it (${got.length} -> ${wide.length})`);
});

test('overlapPoint and the click pick resolve the right crate', () => {
    const c1 = Physics.getTransform(world.props[1]).position;
    const at = Physics.overlapPoint(c1.x, c1.y, c1.z);
    check(at.some((o) => o.bodyId === world.props[1]), `picked ${bodyName(world.props[1])} at its centre`);
    check(Physics.overlapPoint(c1.x, c1.y + 6, c1.z).length === 0, 'open air picks nothing');
    const picked = pickAlongRay(c1.x, c1.y + 8, c1.z, 0, -1, 0, 20);
    check(picked && picked.bodyId === world.props[1], `click-pick (${picked ? picked.name : 'null'})`);
    check(picked.viaOverlap, 'resolved by overlapPoint, not the ray alone');
});

// One ray, three filter configurations, three different bodies. From 3 m in
// +Z of the first crate at crate height, looking -Z:
//   no filter -> own inner body @ 0 m; ignoreBody -> the crate ~2.6 m;
//   + ignoreBodies: props -> the ramp slab ~11 m behind.
test('the filter proof: one ray, three filters, three bodies', () => {
    const c0 = Physics.getTransform(world.props[0]).position;
    place(c0.x, 0.02, c0.z + 3.0);
    advanceTime(200);
    setFacing(0, -1);
    const dir = { x: 0, z: -1 }, H = { height: -0.55 };
    const raw = lookRay(dir, 40, { ...H });
    const noSelf = lookRay(dir, 40, { ...H, ignoreSelf: true });
    const noProps = lookRay(dir, 40, { ...H, ignoreSelf: true, ignoreProps: true, propTags: world.props });
    check(raw && raw.bodyId === self && raw.dist < 0.05, `unfiltered hits SELF at 0 (${bodyName(raw && raw.bodyId)})`);
    check(noSelf && world.props.includes(noSelf.bodyId), `ignoreBody reaches a crate (${bodyName(noSelf && noSelf.bodyId)})`);
    check(noSelf.dist > 2.0 && noSelf.dist < 3.2, `crate ~2.6 m (${f3(noSelf.dist)})`);
    check(noProps && !world.props.includes(noProps.bodyId), 'ignoreBodies excluded every prop');
    check(noProps.dist > noSelf.dist + 5, `passed through to ${noProps.dist.toFixed(2)} m`);
    check(new Set([raw.bodyId, noSelf.bodyId, noProps.bodyId]).size === 3, 'three distinct bodies');
    console.log(`  filter proof: ${bodyName(raw.bodyId)} @ ${raw.dist.toFixed(2)} / ` +
        `${bodyName(noSelf.bodyId)} @ ${noSelf.dist.toFixed(2)} / ${bodyName(noProps.bodyId)} @ ${noProps.dist.toFixed(2)}`);
    const staticOnly = lookRay(dir, 40, { ...H, layers: ['static'] });
    check(staticOnly && staticOnly.bodyId === noProps.bodyId, 'layers:[static] lands on the same wall');
    const movingOnly = lookRay(dir, 40, { ...H, layers: ['moving'] });
    check(movingOnly && movingOnly.bodyId === self, 'layers:[moving] still sees the inner body');
});

test('the frame driver fills qState, and `sense` toggles act next frame', () => {
    resetToSpawn();
    advanceTime(200);
    Object.assign(sense, { forwardCast: true, ledgeProbe: true, proximity: true, lookRay: true,
                           ignoreSelf: true, ignoreProps: false, movingOnly: true });
    setFacing(0, -1);
    advanceTime(64);
    check(qState.ledge && Array.isArray(qState.prox), 'ledge + overlap results');
    check(qState.rayUnfiltered && qState.rayUnfiltered.bodyId === self, 'control ray hits self');
    check(qState.ray && qState.ray.bodyId !== self, `filtered ray is not self (${qState.ray && qState.ray.name})`);
    sense.ignoreSelf = false;
    advanceTime(64);
    check(qState.ray && qState.ray.bodyId === self, 'unchecking ignoreBody collapses the ray onto self');
    sense.ignoreSelf = true;
    advanceTime(64);
    check(qState.ray.bodyId !== self, 'rechecking restores it');

    sense.drawVolumes = false;
    advanceTime(64);
    const off = scene.cullStats().meshDrawn;
    sense.drawVolumes = true;
    advanceTime(64);
    check(scene.cullStats().meshDrawn > off, `query volumes are real geometry (${off} -> ${scene.cullStats().meshDrawn})`);

    const c = Physics.getTransform(world.props[0]).position;
    place(c.x, 0.02, c.z + 2.6);
    setFacing(0, -1);
    sense.proxRadius = 3.5;
    advanceTime(96);
    check(qState.prox.length > 0, `sensor sees the pile (${qState.prox.map((o) => o.name).join(', ')})`);
    shot('sensing');
});

done('character-lab sensing');
