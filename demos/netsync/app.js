// Net Sync Arena — a two-instance multiplayer demo of bro.net.sync.
//
// One instance hosts, others join. Each player drives a colored capsule
// (WASD / arrows); the host spawns gold pickups; touching one despawns it
// via RPC and bumps your score. Everything multiplayer here — spawn/despawn
// replication, per-object authority, interpolated state sync, and RPC —
// is bro.net.sync; there is no hand-rolled protocol.

import { installSystemMenu } from "/lib/system-menu.js";
import { registerTypes, colorOf, nodes, PORT } from "/app/net-types.js";

installSystemMenu();

const sync = bro.net.sync;

// --- Scene -------------------------------------------------------------------

const canvas = document.getElementById('stage');
const scene = canvas.getContext('scene');

const ARENA = 9;              // players are clamped to [-ARENA, ARENA] on x/z

scene.setCamera({ position: [0, 17, 14.5], target: [0, 0, 0], fov: 50 });
scene.setAmbient([0.10, 0.11, 0.13]);
scene.setToneMap({ mode: 'aces', exposure: 1.1 });

scene.createLight({
    type: 'directional',
    direction: [-0.45, -1.0, -0.35],
    color: [1.0, 0.97, 0.9],
    intensity: 2.6,
});

// Arena floor + a contrasting inner mat so motion reads against the ground.
scene.createMesh({
    mesh: 'plane', halfW: ARENA + 1, halfD: ARENA + 1, y: 0,
    color: '#262c38', metallic: 0.0, roughness: 0.9,
});
scene.createMesh({
    mesh: 'plane', halfW: ARENA - 1.5, halfD: ARENA - 1.5, y: 0.02,
    color: '#303848', metallic: 0.0, roughness: 0.85,
});

// Corner pillars for depth cues.
for (const [px, pz] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) {
    scene.createMesh({
        mesh: 'box', halfW: 0.35, halfH: 1.2, halfD: 0.35,
        x: px * ARENA, y: 1.2, z: pz * ARENA,
        color: '#3d4a63', metallic: 0.1, roughness: 0.6,
    });
}

registerTypes(scene);

// --- DOM ----------------------------------------------------------------------

const lobbyEl = document.getElementById('lobby');
const lobbyStatusEl = document.getElementById('lobbyStatus');
const hudEl = document.getElementById('hud');
const controlsEl = document.getElementById('controls');
const statusEl = document.getElementById('status');
const scoresEl = document.getElementById('scores');
const hostBtn = document.getElementById('hostBtn');
const joinBtn = document.getElementById('joinBtn');
const addressInput = document.getElementById('address');

function enterArena() {
    lobbyEl.classList.add('hidden');
    hudEl.classList.remove('hidden');
    controlsEl.classList.remove('hidden');
}

function lobbyError(msg) {
    lobbyStatusEl.classList.add('error');
    lobbyStatusEl.textContent = msg;
}

// --- Session ------------------------------------------------------------------

let myAvatar = null;            // the player object THIS instance drives
let statusText = '';
const playersByConn = new Map();  // host only: client conn -> player object

const SPAWN_RING = 3.5;
function spawnPlayer(slot) {
    const angle = slot * 2.4;   // deterministic ring placement
    return sync.spawn('player', {
        x: Math.round(Math.cos(angle) * SPAWN_RING * 10) / 10,
        z: Math.round(Math.sin(angle) * SPAWN_RING * 10) / 10,
        slot,
        score: 0,
    });
}

const PICKUP_SPOTS = [[5, 0], [-5, 0], [0, 5], [0, -5], [6.5, 6.5]];

function startHost() {
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

    statusText = `Hosting on :${PORT}`;
    enterArena();
}

function startJoin(address) {
    if (!address) return lobbyError('Enter a host address');
    if (!address.includes(':')) address += ':' + PORT;
    sync.join({ address });
    statusText = `Connected to ${address}`;
    enterArena();
}

hostBtn.addEventListener('click', () => {
    try { startHost(); } catch (e) { lobbyError(String(e.message || e)); }
});
joinBtn.addEventListener('click', () => {
    try { startJoin(addressInput.value.trim()); } catch (e) { lobbyError(String(e.message || e)); }
});

// --- Pickups + score (RPC) ------------------------------------------------------
//
// Grab flow: the toucher reports the grab to the host ('grab', client->host).
// The host validates the pickup is still live, despawns it everywhere, and
// awards the point — directly for its own avatar, or via 'award' (host->that
// client, callTo) since each client is the authority over its own score prop.

sync.rpc('grab', (fromConn, pickupId) => {
    if (sync.isHost) hostGrab(fromConn, pickupId);
});

sync.rpc('award', (fromConn, points) => {
    if (myAvatar) myAvatar.score += points | 0;
});

const HOST_SELF = 0;   // sentinel conn for the host's own grabs

function hostGrab(fromConn, pickupId) {
    const pickup = sync.get(pickupId);
    if (!pickup || sync.typeOf(pickup) !== 'pickup') return;  // already taken
    sync.despawn(pickup);
    if (fromConn === HOST_SELF) {
        myAvatar.score += 1;
    } else if (playersByConn.has(fromConn)) {
        sync.callTo(fromConn, 'award', 1);
    }
}

// --- Input ----------------------------------------------------------------------

const held = new Set();
window.addEventListener('keydown', (e) => held.add(e.key.toLowerCase()));
window.addEventListener('keyup', (e) => held.delete(e.key.toLowerCase()));

const SPEED = 6;                 // units/sec
const GRAB_RADIUS = 1.1;

function moveAvatar(dt) {
    let dx = 0, dz = 0;
    if (held.has('w') || held.has('arrowup')) dz -= 1;
    if (held.has('s') || held.has('arrowdown')) dz += 1;
    if (held.has('a') || held.has('arrowleft')) dx -= 1;
    if (held.has('d') || held.has('arrowright')) dx += 1;
    if (!dx && !dz) return;
    const inv = 1 / Math.hypot(dx, dz);
    const lim = ARENA - 0.6;
    // Assigning the declared props is all it takes — sync replicates them.
    myAvatar.x = Math.max(-lim, Math.min(lim, myAvatar.x + dx * inv * SPEED * dt));
    myAvatar.z = Math.max(-lim, Math.min(lim, myAvatar.z + dz * inv * SPEED * dt));
}

function checkPickups() {
    for (const obj of sync.objects()) {
        if (sync.typeOf(obj) !== 'pickup' || obj.claimed) continue;
        const dx = obj.x - myAvatar.x, dz = obj.z - myAvatar.z;
        if (dx * dx + dz * dz > GRAB_RADIUS * GRAB_RADIUS) continue;
        obj.claimed = true;   // local-only guard (undeclared prop, not synced)
        if (sync.isHost) hostGrab(HOST_SELF, sync.idOf(obj));
        else sync.call('grab', sync.idOf(obj));
    }
}

// --- HUD -------------------------------------------------------------------------

let lastHud = '';
function updateHud() {
    const players = sync.objects()
        .filter((o) => sync.typeOf(o) === 'player')
        .sort((a, b) => a.slot - b.slot);
    const pickupsLeft = sync.objects().filter((o) => sync.typeOf(o) === 'pickup').length;

    const rows = players.map((p) => `
        <div class="row">
            <span class="dot" style="background:${colorOf(p.slot)}"></span>
            <span>P${p.slot + 1}${p === myAvatar ? ' (you)' : ''}</span>
            <span class="pts">${p.score}</span>
        </div>`).join('');
    const statusLine =
        `${statusText} &middot; ${players.length} player${players.length === 1 ? '' : 's'}` +
        ` &middot; ${pickupsLeft} pickup${pickupsLeft === 1 ? '' : 's'}`;
    if (statusLine + rows !== lastHud) {
        lastHud = statusLine + rows;
        statusEl.innerHTML = statusLine;
        scoresEl.innerHTML = rows;
    }
}

// --- Main loop ---------------------------------------------------------------------

let lastTs = 0;
function tick(ts) {
    requestAnimationFrame(tick);
    const dt = lastTs ? Math.min((ts - lastTs) / 1000, 0.05) : 0;
    lastTs = ts;
    if (!sync.active) return;

    // A client learns which avatar is "mine" by authority: the host handed
    // this connection authority over exactly one player object.
    if (!myAvatar && !sync.isHost) {
        myAvatar = sync.objects().find(
            (o) => sync.typeOf(o) === 'player' && sync.isAuthority(o)) || null;
    }

    if (myAvatar) {
        moveAvatar(dt);
        checkPickups();
    }

    // Mirror replicated state into the scene (and spin pickups locally).
    for (const obj of sync.objects()) {
        const node = nodes.get(obj);
        if (!node) continue;
        node.x = obj.x;
        node.z = obj.z;
        if (sync.typeOf(obj) === 'pickup') node.rotationY += 1.6 * dt;
    }

    updateHud();
}
requestAnimationFrame(tick);
