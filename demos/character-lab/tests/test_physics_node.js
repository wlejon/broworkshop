// A PhysicsNode must carry its visual with its body, with no explicit sync.
//
// Isolated on purpose: this is an ENGINE check and it currently FAILS —
// createPhysicsNode ignores the documented `body: tag` option (it reads only
// `bodyId`, as a raw Jolt BodyID rather than a Physics.createBody tag), so the
// crates, barrels, platform and ball render at the origin. See
// ENGINE-ISSUES.md. Every other character-lab test passes without it.

import { check, test, done } from "/lib/kit/test.js";
import { world, charState, keys } from "/app/lab.js";
import { place } from "/app/tests/helpers.js";

advanceTime(64);
flush();

test('a shoved crate\'s PhysicsNode sits on its body', () => {
    const crate = world.props[0];
    const a = Physics.getTransform(crate).position;
    place(a.x, 0.02, a.z + 1.6);
    keys.w = true;
    for (let t = 0; t < 1600; t += 16) advanceTime(16);
    keys.w = false;
    advanceTime(64);
    const t = Physics.getTransform(crate).position;
    const n = world.propNodes[0];
    check(Math.hypot(t.x - a.x, t.z - a.z) > 0.1 || charState.isGrounded, 'the crate is a live body');
    check(Math.hypot(n.x - t.x, n.y - t.y, n.z - t.z) < 0.12,
        `node (${n.x.toFixed(2)}, ${n.y.toFixed(2)}, ${n.z.toFixed(2)}) vs body (${t.x.toFixed(2)}, ${t.y.toFixed(2)}, ${t.z.toFixed(2)})`);
});

test('the kinematic platform\'s PhysicsNode follows it', () => {
    const p = Physics.getTransform(world.platform.tag).position;
    const n = world.platform.node;
    check(Math.hypot(n.x - p.x, n.z - p.z) < 0.12, `node x ${n.x.toFixed(2)} vs body x ${p.x.toFixed(2)}`);
});

done('character-lab physics-node');
