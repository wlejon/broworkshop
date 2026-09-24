// A PhysicsNode must carry its visual with its body, or every body in the
// playground renders at the origin.
//
// Isolated on purpose: this is an ENGINE check and it currently FAILS —
// createPhysicsNode ignores the `body: tag` option (it reads only `bodyId`,
// a raw Jolt BodyID). See ENGINE-ISSUES.md. The other playground tests
// measure bodies through Physics.getTransform and pass without it.

import { test, check, done } from "/lib/kit/test.js";
import { scene } from "/app/view.js";
import { spawn, clearAll } from "/app/sim/spawn.js";
import { spawnRagdoll } from "/app/sim/ragdolls.js";

advanceTime(200);

test('a spawned body\'s PhysicsNode sits on its body', () => {
    clearAll();
    const e = spawn('sphere', { x: 6, y: 5, z: 3 }, { linearDamping: 0 });
    advanceTime(300);
    scene.syncPhysics();
    const p = Physics.getTransform(e.tag).position;
    check(Math.hypot(e.node.x - p.x, e.node.y - p.y, e.node.z - p.z) < 1e-3,
        `node (${e.node.x.toFixed(3)}, ${e.node.y.toFixed(3)}, ${e.node.z.toFixed(3)}) vs body (${p.x.toFixed(3)}, ${p.y.toFixed(3)}, ${p.z.toFixed(3)})`);
});

test('ragdoll part nodes sit on their part bodies', () => {
    clearAll();
    const r = spawnRagdoll({ x: -3, y: 3, z: 1 });
    advanceTime(500);
    const p = Physics.getTransform(r.rd.partBody(0)).position, n = r.nodes[0];
    check(Math.hypot(n.x - p.x, n.y - p.y, n.z - p.z) < 1e-3,
        `pelvis node (${n.x.toFixed(2)}, ${n.y.toFixed(2)}, ${n.z.toFixed(2)}) vs body (${p.x.toFixed(2)}, ${p.y.toFixed(2)}, ${p.z.toFixed(2)})`);
});

done('physics-playground physics-node');
