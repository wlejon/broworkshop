// session.js — everything multiplayer, all of it bro.net.sync: spawn/despawn
// replication, per-object authority, interpolated state sync and RPC. There
// is no hand-rolled protocol.
//
// One instance hosts; the others join. Each player drives a coloured capsule
// (WASD / arrows); the host spawns gold pickups; touching one despawns it
// and scores a point.
//
// Tests import this module (never main.js) and read `session`.
import { registerTypes, nodes, PORT } from "/app/net-types.js";
import { ARENA } from "/app/arena.js";

const sync = bro.net.sync;

const SPAWN_RING = 3.5;
const PICKUP_SPOTS = [[5, 0], [-5, 0], [0, 5], [0, -5], [6.5, 6.5]];
const SPEED = 6;           // units / second
const GRAB_RADIUS = 1.1;
const HOST_SELF = 0;       // sentinel conn for the host's own grabs

let myAvatar = null;             // the player object THIS instance drives
let address = null;              // client: the host we joined
const playersByConn = new Map(); // host only: client conn -> player object
const held = new Set();

export const session = {
    PORT, PICKUP_SPOTS, GRAB_RADIUS,
    get active() { return sync.active; },
    get isHost() { return sync.isHost; },
    get me() { return myAvatar; },
    /** Players by slot. */
    players: () => sync.objects().filter((o) => sync.typeOf(o) === 'player').sort((a, b) => a.slot - b.slot),
    pickups: () => sync.objects().filter((o) => sync.typeOf(o) === 'pickup'),
    /** One line: role/connection, player and pickup counts. */
    describe() {
        let conn;
        if (sync.isHost) conn = 'Hosting on :' + PORT;
        else if (sync.hostConn != null) conn = 'Connected to ' + address;
        else conn = (myAvatar ? 'Lost host ' : 'Connecting to ') + address;
        const np = session.players().length, nk = session.pickups().length;
        return conn + ' · ' + np + ' player' + (np === 1 ? '' : 's') +
               ' · ' + nk + ' pickup' + (nk === 1 ? '' : 's');
    },
    init,
    host,
    join,
    tick,
};

/** Register the replicated types (both ends, before connecting) and the RPCs. */
function init(scene) {
    registerTypes(scene);

    // Grab flow: the toucher reports the grab to the host ('grab',
    // client -> host). The host checks the pickup is still live, despawns it
    // everywhere, and awards the point: directly for its own avatar, or via
    // 'award' (host -> that client, callTo), because each client is the
    // authority over its own score prop.
    sync.rpc('grab', (fromConn, pickupId) => {
        if (sync.isHost) hostGrab(fromConn, pickupId);
    });
    sync.rpc('award', (fromConn, points) => {
        if (myAvatar) myAvatar.score += points | 0;
    });

    window.addEventListener('keydown', (e) => held.add(e.key.toLowerCase()));
    window.addEventListener('keyup', (e) => held.delete(e.key.toLowerCase()));
    window.addEventListener('blur', () => held.clear());
}

function spawnPlayer(slot) {
    const angle = slot * 2.4;   // deterministic ring placement
    return sync.spawn('player', {
        x: Math.round(Math.cos(angle) * SPAWN_RING * 10) / 10,
        z: Math.round(Math.sin(angle) * SPAWN_RING * 10) / 10,
        slot,
        score: 0,
    });
}

function host() {
    sync.host({ port: PORT });

    let nextSlot = 0;
    myAvatar = spawnPlayer(nextSlot++);
    for (const [x, z] of PICKUP_SPOTS) sync.spawn('pickup', { x, z });

    // Each connecting client gets its own avatar with authority over it, so
    // its local writes (movement, score) replicate to everyone.
    bro.net.onconnect = (conn) => {
        const p = spawnPlayer(nextSlot++);
        sync.setAuthority(p, conn);
        playersByConn.set(conn, p);
    };
    bro.net.ondisconnect = (conn) => {
        const p = playersByConn.get(conn);
        if (p) sync.despawn(p);
        playersByConn.delete(conn);
    };
}

/** Join `addr` ("ip" or "ip:port"). Throws on an empty address. */
function join(addr) {
    addr = (addr || '').trim();
    if (!addr) throw new Error('Enter a host address');
    if (!addr.includes(':')) addr += ':' + PORT;
    address = addr;
    sync.join({ address: addr });
}

function hostGrab(fromConn, pickupId) {
    const pickup = sync.get(pickupId);
    if (!pickup || sync.typeOf(pickup) !== 'pickup') return;  // already taken
    sync.despawn(pickup);
    if (fromConn === HOST_SELF) myAvatar.score += 1;
    else if (playersByConn.has(fromConn)) sync.callTo(fromConn, 'award', 1);
}

function moveAvatar(dt) {
    let dx = 0, dz = 0;
    if (held.has('w') || held.has('arrowup')) dz -= 1;
    if (held.has('s') || held.has('arrowdown')) dz += 1;
    if (held.has('a') || held.has('arrowleft')) dx -= 1;
    if (held.has('d') || held.has('arrowright')) dx += 1;
    if (!dx && !dz) return;
    const inv = 1 / Math.hypot(dx, dz);
    const lim = ARENA - 0.6;
    // Assigning the declared props is all it takes; sync replicates them.
    myAvatar.x = Math.max(-lim, Math.min(lim, myAvatar.x + dx * inv * SPEED * dt));
    myAvatar.z = Math.max(-lim, Math.min(lim, myAvatar.z + dz * inv * SPEED * dt));
}

function checkPickups() {
    for (const obj of session.pickups()) {
        if (obj.claimed) continue;
        const dx = obj.x - myAvatar.x, dz = obj.z - myAvatar.z;
        if (dx * dx + dz * dz > GRAB_RADIUS * GRAB_RADIUS) continue;
        obj.claimed = true;   // local-only guard (undeclared prop, not synced)
        if (sync.isHost) hostGrab(HOST_SELF, sync.idOf(obj));
        else sync.call('grab', sync.idOf(obj));
    }
}

/** Per frame: find / drive my avatar, grab pickups, mirror state into the scene. */
function tick(dt) {
    if (!sync.active) return;

    // A client learns which avatar is "mine" by authority: the host handed
    // this connection authority over exactly one player object.
    if (!myAvatar && !sync.isHost) {
        myAvatar = session.players().find((o) => sync.isAuthority(o)) || null;
    }
    if (myAvatar) {
        moveAvatar(dt);
        checkPickups();
    }

    for (const obj of sync.objects()) {
        const node = nodes.get(obj);
        if (!node) continue;
        node.x = obj.x;
        node.z = obj.z;
        if (sync.typeOf(obj) === 'pickup') node.rotationY += 1.6 * dt;  // local spin
    }
}
