// Net Sync Arena — the lobby, hosting a session, driving the avatar with
// the keyboard, and grabbing a pickup through the host path. Joining needs a
// second instance, so only the join validation is covered here.
//
//   scripts/validate.sh demos/netsync
import { check, eq, near, test, done, frames, simUntil, q, text, setValue, clickOn, shot } from "/lib/kit/test.js";
import { session } from "/app/session.js";
import { nodes } from "/app/net-types.js";

const KEY = { d: 100, s: 115, w: 119,ArrowLeft: 0x40000050 };
const visible = (sel) => !q(sel).hidden;

frames(5);

test('lobby first, HUD hidden', () => {
    check(visible('#lobby') && !visible('#hud') && !visible('#controls'), 'lobby only');
    check(!session.active, 'no session yet');
    shot('lobby');
});

test('join refuses an empty address and stays in the lobby', () => {
    setValue('#address', '   ');
    clickOn('#joinBtn');
    eq(text('#lobbyStatus'), 'Enter a host address');
    check(q('#lobbyStatus').classList.contains('err'), 'shown as an error');
    check(visible('#lobby') && !session.active, 'still in the lobby');
});

test('host spawns my avatar and the pickups', () => {
    clickOn('#hostBtn');
    frames(3);
    check(!visible('#lobby') && visible('#hud') && visible('#controls'), 'arena shown');
    check(session.isHost && session.me, 'hosting with an avatar');
    eq(session.players().length, 1, 'one player');
    eq(session.pickups().length, session.PICKUP_SPOTS.length, 'pickups');
    eq(text('#status'), 'Hosting on :' + session.PORT + ' · 1 player · 5 pickups');
    check(/P1 \(you\)\s*0/.test(text('#scores')), 'score row: ' + text('#scores'));
});

test('holding a key moves the avatar and the node follows', () => {
    const me = session.me, z0 = me.z;
    keyDown(KEY.s, 0, 0);
    frames(20);
    keyUp(KEY.s, 0, 0);
    frames(2);
    check(me.z > z0 + 1, 'moved down: ' + z0 + ' -> ' + me.z);
    near(nodes.get(me).z, me.z, 1e-4, 'capsule node mirrors the synced prop');
    const z1 = me.z;
    frames(10);
    eq(me.z, z1, 'stops on release');
});

test('walking onto a pickup scores through the host', () => {
    const me = session.me;
    // Back up to the spawn row, then walk right into the (5, 0) pickup.
    keyDown(KEY.w, 0, 0);
    frames(20);
    keyUp(KEY.w, 0, 0);
    frames(2);
    check(Math.abs(me.z) < 0.2, 'back on the spawn row: ' + me.z);
    keyDown(KEY.d, 0, 0);
    check(simUntil(() => me.score === 1, 2000, 16), 'scored');
    keyUp(KEY.d, 0, 0);
    frames(3);
    eq(session.pickups().length, 4, 'pickup despawned');
    check(!session.pickups().some((p) => p.x === 5 && p.z === 0), 'the (5, 0) one');
    check(/4 pickups$/.test(text('#status')), 'status: ' + text('#status'));
    check(/P1 \(you\)\s*1/.test(text('#scores')), 'score row: ' + text('#scores'));
    shot('scored');
});

test('the avatar is clamped inside the arena', () => {
    const me = session.me;
    keyDown(KEY.ArrowLeft, 0, 0);
    frames(240);
    keyUp(KEY.ArrowLeft, 0, 0);
    frames(2);
    check(Math.abs(me.x + 8.4) < 1e-6, 'x at the left wall: ' + me.x);
});

done('netsync session');
