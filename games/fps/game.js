// FPS Arena — multiplayer client on the arcade foundation.
// Server: server.js (authoritative, protocol unchanged).
// This file: shell plugin + scene + local predict + net interpolate + combat HUD.
// Layout: constants → session state → plugin → scene → remotes → input → net → HUD.

import { crosshair } from "/lib/crosshair.js";

// ── Constants (must match server) ────────────────────────────────────────

const ARENA_HALF = 20;
const WALL_H = 3;
const WALL_THICK = 0.5;
const PLAYER_RADIUS = 0.4;
const EYE_HEIGHT = 1.6;
const MOVE_SPEED = 6.0;

const MSG_INPUT = 0x01;
const MSG_STATE = 0x02;
const MSG_WELCOME = 0x03;
const MSG_EVENT = 0x04;
const MSG_NAMES = 0x05;

const EVT_KILL = 0;
const EVT_HIT = 1;
const EVT_SPAWN = 2;

const IN_FWD = 1;
const IN_BACK = 2;
const IN_LEFT = 4;
const IN_RIGHT = 8;
const IN_SHOOT = 16;

const OBSTACLES = [
    { x: -8, z: -8, hw: 1.5, hd: 1.5, hh: 1.5 },
    { x: 8, z: 8, hw: 1.5, hd: 1.5, hh: 1.5 },
    { x: -8, z: 8, hw: 1.0, hd: 3.0, hh: 1.0 },
    { x: 8, z: -8, hw: 3.0, hd: 1.0, hh: 1.0 },
    { x: 0, z: 0, hw: 1.0, hd: 1.0, hh: 2.5 },
    { x: -15, z: 0, hw: 0.5, hd: 4.0, hh: 1.5 },
    { x: 15, z: 0, hw: 0.5, hd: 4.0, hh: 1.5 },
    { x: 0, z: 15, hw: 4.0, hd: 0.5, hh: 1.5 },
    { x: 0, z: -15, hw: 4.0, hd: 0.5, hh: 1.5 },
];
const WALLS = [
    { x: 0, z: -ARENA_HALF, hw: ARENA_HALF, hd: WALL_THICK, hh: WALL_H },
    { x: 0, z: ARENA_HALF, hw: ARENA_HALF, hd: WALL_THICK, hh: WALL_H },
    { x: -ARENA_HALF, z: 0, hw: WALL_THICK, hd: ARENA_HALF, hh: WALL_H },
    { x: ARENA_HALF, z: 0, hw: WALL_THICK, hd: ARENA_HALF, hh: WALL_H },
];
const ALL_SOLIDS = OBSTACLES.concat(WALLS);

const PLAYER_COLORS = [
    "#e74c3c", "#3498db", "#2ecc71", "#f39c12",
    "#9b59b6", "#1abc9c", "#e67e22", "#e91e63",
];

const INTERP_DELAY = 100;
const INPUT_SEND_INTERVAL = 1000 / 60; // ms (shell dt is ms)

// ── Session / module state ───────────────────────────────────────────────

const session = {
    name: "Player",
    address: "127.0.0.1:27015",
};

let canvas = null;
let scene = null;
let sceneBuilt = false;
let netWired = false;
let inputWired = false;
let apiRef = null;

let myId = null;
let connected = false;
let serverConn = null;
let clientTick = 0;
let lastServerTick = 0;
let pointerLocked = false;

let localX = 0, localZ = 0;
let localYaw = 0, localPitch = 0;
let localHealth = 100;
let localAlive = true;
let localKills = 0;

let serverX = 0, serverZ = 0;
let hasServerPos = false;

const playerNames = new Map();
const remotePlayers = new Map();
let nextRemoteColor = 0;

let inputSendAccum = 0;
let frameCount = 0, fpsAccum = 0, fps = 0;
let damageFlashTimer = 0;
let pendingDisconnect = false;
let connectError = "";

/** @type {object|null} */
/** @type {object|null} Latest run (wiring + HUD). */
let activeRun = null;

export const game = {
    id: "fps",
    clearColor: "#000000",

    actions: [
        { name: "primary", label: "Shoot", defaults: ["Mouse0"] },
    ],

    create(ctx) {
        apiRef = ctx;
        ensureScene();
        ensureInputWiring();
        ensureNetWiring();

        // Read connect form
        const nameEl = document.getElementById("name-input");
        const addrEl = document.getElementById("address-input");
        const errEl = document.getElementById("error-msg");
        session.name = (nameEl && nameEl.value.trim()) || "Player";
        session.address = (addrEl && addrEl.value.trim()) || "127.0.0.1:27015";
        connectError = "";
        if (errEl) errEl.textContent = "";

        resetLocalState();
        pendingDisconnect = false;

        const run = {
            score: 0,
            play: ctx.play,
            highScore: ctx.highScore,
            save: ctx.save,
            connecting: true,
            connected: false,
        };
        activeRun = run;

        try {
            bro.net.init();
            bro.net.connect(session.address);
        } catch (e) {
            connectError = "Connect failed: " + (e && e.message ? e.message : e);
            if (errEl) errEl.textContent = connectError;
            run.connecting = false;
            pendingDisconnect = true;
        }

        return run;
    },

    update(run, dt, input) {
        activeRun = run;

        if (pendingDisconnect) {
            pendingDisconnect = false;
            teardownConnection();
            return {
                status: "gameover",
                result: { score: run.score, reason: connectError || "disconnected" },
            };
        }

        if (!connected || myId == null) return;

        // Shell dt is ms
        const dtSec = Math.min(dt / 1000, 0.05);

        frameCount++;
        fpsAccum += dtSec;
        if (fpsAccum >= 0.5) {
            fps = Math.round(frameCount / fpsAccum);
            frameCount = 0;
            fpsAccum = 0;
        }

        inputSendAccum += dt;
        if (inputSendAccum >= INPUT_SEND_INTERVAL) {
            inputSendAccum -= INPUT_SEND_INTERVAL;
            clientTick++;
            sendInput(input);
        }

        if (localAlive) moveLocal(dtSec, input);

        const bits = getInputBits(input);
        const isMoving = (bits & (IN_FWD | IN_BACK | IN_LEFT | IN_RIGHT)) !== 0;
        try {
            crosshair.setMoving(isMoving);
            if ((bits & IN_SHOOT) && localAlive) crosshair.addBloom(dtSec * 40);
        } catch (e) { /* crosshair optional */ }

        if (hasServerPos) {
            const errX = serverX - localX;
            const errZ = serverZ - localZ;
            const err2 = errX * errX + errZ * errZ;
            if (err2 > 9.0) {
                localX = serverX;
                localZ = serverZ;
            } else if (err2 > 0.0001) {
                const blend = Math.min(1.0, 5.0 * dtSec);
                localX += errX * blend;
                localZ += errZ * blend;
            }
        }

        interpolateRemotes();
        if (damageFlashTimer > 0) damageFlashTimer -= dtSec;

        run.score = localKills;
        run.connected = true;
        run.connecting = false;
        updateCombatHUD();
    },

    draw() {
        if (!scene || !canvas || !connected || myId == null) return;

        const fwdX = Math.sin(localYaw) * Math.cos(localPitch);
        const fwdY = Math.sin(localPitch);
        const fwdZ = -Math.cos(localYaw) * Math.cos(localPitch);

        const w = canvas.clientWidth || 1;
        const h = canvas.clientHeight || 1;

        scene.setCamera({
            fov: 90,
            aspect: w / h,
            near: 0.1,
            far: 200,
            position: [localX, EYE_HEIGHT, localZ],
            target: [localX + fwdX, EYE_HEIGHT + fwdY, localZ + fwdZ],
        });
    },

    hud(run) {
        return {
            // combat HUD is custom DOM; keep shell happy
        };
    },

    gameOverText(run, result) {
        const score = run ? run.score : 0;
        const reason = (result && result.reason) || "Disconnected";
        return reason + "\nKills: " + score;
    },

    onEnterScreen(name) {
        if (name === "pause" || name === "title" || name === "howto" || name === "gameover") {
            releasePointer();
            try { crosshair.hide(); } catch (e) { /* ignore */ }
        }
        if (name === "title" || name === "gameover") {
            // Leaving a match — drop the net connection if still open.
            if (connected || serverConn != null) teardownConnection();
        }
        if (name === "playing") {
            updateCombatHUD();
            if (connected) {
                try {
                    crosshair.configure({
                        style: "crossdot", size: 12, thickness: 2, gap: 3, dotSize: 1,
                        color: "#ffffff", opacity: 0.8, outline: true,
                        outlineThickness: 1, outlineColor: "#000000",
                        moveSpread: 8, fireBloom: 6, adsSpread: 1,
                        bloomDecay: 30, lerpSpeed: 10,
                    });
                    crosshair.show();
                } catch (e) { /* ignore */ }
            }
        }
        if (name === "title") {
            const errEl = document.getElementById("error-msg");
            if (errEl && connectError) errEl.textContent = connectError;
        }
    },

    cue(name, audio) {
        if (name === "hit") audio.tone(200, 0.08, "sawtooth", 0.45);
        else if (name === "kill") {
            audio.sequence([
                [520, 0.06, "square", 0.4],
                [780, 0.1, "square", 0.5],
            ]);
        }
    },
};

// ── Scene ────────────────────────────────────────────────────────────────

function ensureScene() {
    if (scene) return;
    canvas = document.getElementById("view") || document.querySelector("canvas");
    if (!canvas) throw new Error("fps: #view canvas missing");
    scene = canvas.getContext("scene");
    if (!scene) throw new Error("fps: scene context unavailable");

    function resizeCanvas() {
        const dpr = window.devicePixelRatio || 1;
        const w = Math.floor(window.innerWidth * dpr);
        const h = Math.floor(window.innerHeight * dpr);
        if (canvas.width !== w) canvas.width = w;
        if (canvas.height !== h) canvas.height = h;
    }
    window.addEventListener("resize", resizeCanvas);
    resizeCanvas();
}

function buildScene() {
    if (sceneBuilt || !scene) return;
    sceneBuilt = true;

    scene.createMesh({
        mesh: "plane", halfW: ARENA_HALF, halfD: ARENA_HALF,
        x: 0, y: 0, z: 0, color: "#2a2a3e",
    });

    const wallDefs = [
        { x: 0, y: WALL_H / 2, z: -ARENA_HALF, sx: ARENA_HALF * 2, sy: WALL_H, sz: WALL_THICK * 2 },
        { x: 0, y: WALL_H / 2, z: ARENA_HALF, sx: ARENA_HALF * 2, sy: WALL_H, sz: WALL_THICK * 2 },
        { x: -ARENA_HALF, y: WALL_H / 2, z: 0, sx: WALL_THICK * 2, sy: WALL_H, sz: ARENA_HALF * 2 },
        { x: ARENA_HALF, y: WALL_H / 2, z: 0, sx: WALL_THICK * 2, sy: WALL_H, sz: ARENA_HALF * 2 },
    ];
    for (const w of wallDefs) {
        scene.createMesh({
            mesh: "box", halfW: w.sx / 2, halfH: w.sy / 2, halfD: w.sz / 2,
            x: w.x, y: w.y, z: w.z, color: "#3a4a6e",
        });
    }

    for (const ob of OBSTACLES) {
        scene.createMesh({
            mesh: "box", halfW: ob.hw, halfH: ob.hh, halfD: ob.hd,
            x: ob.x, y: ob.hh, z: ob.z, color: "#4a5a80",
        });
    }

    for (let i = -ARENA_HALF; i <= ARENA_HALF; i += 5) {
        scene.createMesh({
            mesh: "box", halfW: ARENA_HALF, halfH: 0.005, halfD: 0.02,
            x: 0, y: 0.01, z: i, color: "#3a3a5e",
        });
        scene.createMesh({
            mesh: "box", halfW: 0.02, halfH: 0.005, halfD: ARENA_HALF,
            x: i, y: 0.01, z: 0, color: "#3a3a5e",
        });
    }
}

function clearRemotes() {
    for (const [id] of remotePlayers) removeRemote(id);
    nextRemoteColor = 0;
}

// Note: scene graph nodes for arena geometry are not destroyed between
// sessions (engine has no cheap full reset). buildScene is once-per-process.

// ── Collision ────────────────────────────────────────────────────────────

function pushCircleOutOfAABB(px, pz, r, box) {
    const bx0 = box.x - box.hw, bx1 = box.x + box.hw;
    const bz0 = box.z - box.hd, bz1 = box.z + box.hd;
    const cx = Math.max(bx0, Math.min(px, bx1));
    const cz = Math.max(bz0, Math.min(pz, bz1));
    const dx = px - cx, dz = pz - cz;
    const dist2 = dx * dx + dz * dz;
    if (dist2 < r * r && dist2 > 0.0001) {
        const dist = Math.sqrt(dist2);
        const pen = r - dist;
        return { x: px + (dx / dist) * pen, z: pz + (dz / dist) * pen };
    }
    if (dist2 < 0.0001) {
        const dl = px - bx0, dr = bx1 - px, dt = pz - bz0, db = bz1 - pz;
        const min = Math.min(dl, dr, dt, db);
        if (min === dl) return { x: bx0 - r, z: pz };
        if (min === dr) return { x: bx1 + r, z: pz };
        if (min === dt) return { x: px, z: bz0 - r };
        return { x: px, z: bz1 + r };
    }
    return null;
}

// ── Remotes ──────────────────────────────────────────────────────────────

function getOrCreateRemote(id) {
    let r = remotePlayers.get(id);
    if (r) return r;

    const colorIdx = nextRemoteColor++ % PLAYER_COLORS.length;
    const bodyNode = scene.createMesh({
        mesh: "capsule", radius: PLAYER_RADIUS, halfHeight: 0.5,
        x: 0, y: 0.9, z: 0,
        color: PLAYER_COLORS[colorIdx],
    });

    r = { bodyNode, colorIdx, states: [] };
    remotePlayers.set(id, r);
    return r;
}

function removeRemote(id) {
    const r = remotePlayers.get(id);
    if (!r) return;
    try { scene.destroyNode(r.bodyNode); } catch (e) { /* ignore */ }
    remotePlayers.delete(id);
}

function interpolateRemotes() {
    const renderTime = Date.now() - INTERP_DELAY;

    for (const [id, r] of remotePlayers) {
        if (id === myId) {
            r.bodyNode.visible = false;
            continue;
        }

        const states = r.states;
        if (states.length === 0) {
            r.bodyNode.visible = false;
            continue;
        }

        r.bodyNode.visible = true;

        let s0 = null, s1 = null;
        for (let i = 0; i < states.length - 1; i++) {
            if (states[i].t <= renderTime && states[i + 1].t >= renderTime) {
                s0 = states[i];
                s1 = states[i + 1];
                break;
            }
        }

        if (s0 && s1) {
            const alpha = (renderTime - s0.t) / (s1.t - s0.t);
            r.bodyNode.x = s0.x + (s1.x - s0.x) * alpha;
            r.bodyNode.y = 0.9;
            r.bodyNode.z = s0.z + (s1.z - s0.z) * alpha;
            r.bodyNode.rotationY = -lerpAngle(s0.yaw, s1.yaw, alpha);
        } else if (states.length > 0) {
            const latest = states[states.length - 1];
            r.bodyNode.x = latest.x;
            r.bodyNode.y = latest.alive ? 0.9 : 0.2;
            r.bodyNode.z = latest.z;
            r.bodyNode.rotationY = -latest.yaw;
        }

        while (states.length > 2 && states[0].t < renderTime - 500) {
            states.shift();
        }
    }
}

function lerpAngle(a, b, t) {
    let diff = b - a;
    while (diff > Math.PI) diff -= 2 * Math.PI;
    while (diff < -Math.PI) diff += 2 * Math.PI;
    return a + diff * t;
}

// ── Input / movement ─────────────────────────────────────────────────────

function getInputBits(input) {
    let bits = 0;
    if (!pointerLocked) return bits;
    if (!input) return bits;
    if (input.down("up")) bits |= IN_FWD;
    if (input.down("down")) bits |= IN_BACK;
    if (input.down("left")) bits |= IN_LEFT;
    if (input.down("right")) bits |= IN_RIGHT;
    if (input.down("primary")) bits |= IN_SHOOT;
    return bits;
}

function sendInput(input) {
    if (serverConn == null) return;
    const buf = new ArrayBuffer(14);
    const v = new DataView(buf);
    v.setUint8(0, MSG_INPUT);
    v.setUint32(1, clientTick, true);
    v.setUint8(5, getInputBits(input));
    v.setFloat32(6, localYaw, true);
    v.setFloat32(10, localPitch, true);
    bro.net.send(serverConn, buf, false);
}

function sendName(name) {
    if (serverConn == null) return;
    const data = new TextEncoder().encode(JSON.stringify({ type: "set_name", name }));
    bro.net.send(serverConn, data.buffer);
}

function moveLocal(dtSec, input) {
    const bits = getInputBits(input);
    const fwdX = Math.sin(localYaw), fwdZ = -Math.cos(localYaw);
    const rightX = Math.cos(localYaw), rightZ = Math.sin(localYaw);

    let mx = 0, mz = 0;
    if (bits & IN_FWD) { mx += fwdX; mz += fwdZ; }
    if (bits & IN_BACK) { mx -= fwdX; mz -= fwdZ; }
    if (bits & IN_LEFT) { mx -= rightX; mz -= rightZ; }
    if (bits & IN_RIGHT) { mx += rightX; mz += rightZ; }

    const len = Math.sqrt(mx * mx + mz * mz);
    if (len > 0.001) {
        mx = (mx / len) * MOVE_SPEED * dtSec;
        mz = (mz / len) * MOVE_SPEED * dtSec;
    }

    localX += mx;
    localZ += mz;

    for (const box of ALL_SOLIDS) {
        const result = pushCircleOutOfAABB(localX, localZ, PLAYER_RADIUS, box);
        if (result) {
            localX = result.x;
            localZ = result.z;
        }
    }

    const lim = ARENA_HALF - PLAYER_RADIUS - WALL_THICK;
    localX = Math.max(-lim, Math.min(lim, localX));
    localZ = Math.max(-lim, Math.min(lim, localZ));
}

function ensureInputWiring() {
    if (inputWired) return;
    inputWired = true;
    ensureScene();

    wireTitleFormKeys();

    canvas.addEventListener("mousedown", () => {
        if (!connected) return;
        if (apiRef && apiRef.getScreen() !== "playing") return;
        if (!pointerLocked) {
            try {
                canvas.requestPointerLock();
                pointerLocked = true;
                updateCombatHUD();
            } catch (e) { /* ignore */ }
        }
    });

    document.addEventListener("pointerlockchange", () => {
        pointerLocked = document.pointerLockElement === canvas;
        updateCombatHUD();
    });

    document.addEventListener("mousemove", (e) => {
        if (!pointerLocked) return;
        localYaw += e.movementX * 0.002;
        localPitch -= e.movementY * 0.002;
        localPitch = Math.max(-Math.PI / 2 * 0.95, Math.min(Math.PI / 2 * 0.95, localPitch));
    });
}

function releasePointer() {
    pointerLocked = false;
    try {
        if (document.pointerLockElement) document.exitPointerLock();
    } catch (e) { /* ignore */ }
}

// ── Network ──────────────────────────────────────────────────────────────

function ensureNetWiring() {
    if (netWired) return;
    netWired = true;

    bro.net.onconnect = (connId) => {
        serverConn = connId;
        connected = true;
        connectError = "";
        const errEl = document.getElementById("error-msg");
        if (errEl) errEl.textContent = "";

        buildScene();
        sendName(session.name);

        if (activeRun) {
            activeRun.connected = true;
            activeRun.connecting = false;
        }

        try {
            crosshair.configure({
                style: "crossdot", size: 12, thickness: 2, gap: 3, dotSize: 1,
                color: "#ffffff", opacity: 0.8, outline: true,
                outlineThickness: 1, outlineColor: "#000000",
                moveSpread: 8, fireBloom: 6, adsSpread: 1,
                bloomDecay: 30, lerpSpeed: 10,
            });
            if (apiRef && apiRef.getScreen() === "playing") crosshair.show();
        } catch (e) { /* ignore */ }

        updateCombatHUD();
    };

    bro.net.ondisconnect = () => {
        connectError = connectError || "Lost connection to server";
        if (activeRun) activeRun.connecting = false;
        // Defer teardown to update so we can return gameover status cleanly.
        pendingDisconnect = true;
        releasePointer();
        try { crosshair.hide(); } catch (e) { /* ignore */ }
    };

    bro.net.onmessage = (_connId, data) => {
        handleBinaryMessage(data);
    };
}

function resetLocalState() {
    myId = null;
    connected = false;
    serverConn = null;
    clientTick = 0;
    lastServerTick = 0;
    localX = 0;
    localZ = 0;
    localYaw = 0;
    localPitch = 0;
    localHealth = 100;
    localAlive = true;
    localKills = 0;
    serverX = 0;
    serverZ = 0;
    hasServerPos = false;
    inputSendAccum = 0;
    damageFlashTimer = 0;
    playerNames.clear();
    clearRemotes();
    releasePointer();
}

function teardownConnection() {
    const wasConn = serverConn;
    resetLocalState();
    if (wasConn != null) {
        try {
            if (typeof bro.net.disconnect === "function") bro.net.disconnect(wasConn);
        } catch (e) { /* ignore */ }
    }
    try { crosshair.hide(); } catch (e) { /* ignore */ }
}

function handleBinaryMessage(data) {
    const v = new DataView(data);
    const type = v.getUint8(0);

    switch (type) {
        case MSG_WELCOME: {
            myId = v.getUint16(1, true);
            lastServerTick = v.getUint32(3, true);
            console.log("Welcome! id=" + myId + " serverTick=" + lastServerTick);
            break;
        }

        case MSG_STATE: {
            const sTick = v.getUint32(1, true);
            const count = v.getUint8(9);
            lastServerTick = sTick;

            const now = Date.now();
            const idsInState = new Set();

            let off = 10;
            for (let i = 0; i < count; i++) {
                const id = v.getUint16(off, true); off += 2;
                const x = v.getFloat32(off, true); off += 4;
                const y = v.getFloat32(off, true); off += 4;
                const z = v.getFloat32(off, true); off += 4;
                const yaw = v.getFloat32(off, true); off += 4;
                const health = v.getUint8(off); off += 1;
                const flags = v.getUint8(off); off += 1;
                const kills = v.getUint16(off, true); off += 2;

                const alive = !!(flags & 1);
                idsInState.add(id);

                if (id === myId) {
                    serverX = x;
                    serverZ = z;
                    hasServerPos = true;
                    localHealth = health;
                    localAlive = alive;
                    localKills = kills;
                    if (activeRun) activeRun.score = kills;
                } else {
                    const r = getOrCreateRemote(id);
                    r.states.push({ t: now, x, y, z, yaw, health, alive, kills });
                }
            }

            for (const id of remotePlayers.keys()) {
                if (!idsInState.has(id) && id !== myId) removeRemote(id);
            }
            break;
        }

        case MSG_NAMES: {
            const count = v.getUint8(1);
            playerNames.clear();
            let off = 2;
            for (let i = 0; i < count; i++) {
                const id = v.getUint16(off, true); off += 2;
                const nameLen = v.getUint8(off); off += 1;
                const name = new TextDecoder().decode(new Uint8Array(data, off, nameLen));
                off += nameLen;
                playerNames.set(id, name);
            }
            break;
        }

        case MSG_EVENT: {
            const evtType = v.getUint8(1);
            if (evtType === EVT_KILL) {
                const killerId = v.getUint16(2, true);
                const victimId = v.getUint16(4, true);
                addKillFeed(killerId, victimId);
                if (activeRun && activeRun.play && killerId === myId) activeRun.play("kill");
            } else if (evtType === EVT_HIT) {
                const victimId = v.getUint16(4, true);
                if (victimId === myId) {
                    flashDamage();
                    if (activeRun && activeRun.play) activeRun.play("hit");
                }
            } else if (evtType === EVT_SPAWN) {
                const sx = v.getFloat32(2, true);
                const sz = v.getFloat32(6, true);
                localX = sx;
                localZ = sz;
                serverX = sx;
                serverZ = sz;
                hasServerPos = true;
                localAlive = true;
                localHealth = 100;
            }
            break;
        }
    }
}

// ── Combat HUD ───────────────────────────────────────────────────────────

function updateCombatHUD() {
    const healthFill = document.getElementById("health-fill");
    const healthText = document.getElementById("health-text");
    const killsCount = document.getElementById("kills-count");
    const deathScreen = document.getElementById("death-screen");
    const clickPrompt = document.getElementById("click-prompt");
    const netInfo = document.getElementById("net-info");

    if (healthFill) {
        healthFill.style.width = localHealth + "%";
        healthFill.style.background = localHealth > 60 ? "#2ecc71" :
            localHealth > 30 ? "#f39c12" : "#e74c3c";
    }
    if (healthText) healthText.textContent = String(localHealth);
    if (killsCount) killsCount.textContent = String(localKills);
    if (deathScreen) deathScreen.classList.toggle("hidden", localAlive);
    if (clickPrompt) {
        clickPrompt.classList.toggle("hidden", pointerLocked || !connected);
    }
    if (netInfo) {
        netInfo.textContent =
            "fps " + fps + " | tick " + clientTick + " | server " + lastServerTick +
            (connected ? "" : " | connecting…");
    }
}

function addKillFeed(killerId, victimId) {
    const killFeed = document.getElementById("kill-feed");
    if (!killFeed) return;
    const entry = document.createElement("div");
    entry.className = "kill-entry";
    const kName = killerId === myId ? "You" : (playerNames.get(killerId) || "Player " + killerId);
    const vName = victimId === myId ? "You" : (playerNames.get(victimId) || "Player " + victimId);
    entry.textContent = kName + " killed " + vName;
    killFeed.appendChild(entry);
    setTimeout(() => {
        if (entry.parentNode) entry.parentNode.removeChild(entry);
    }, 3500);
}

function flashDamage() {
    damageFlashTimer = 0.2;
}

// Isolate title form keystrokes from the arcade menu before the first run.
let formKeysWired = false;
function wireTitleFormKeys() {
    if (formKeysWired) return;
    formKeysWired = true;
    for (const id of ["name-input", "address-input"]) {
        const el = document.getElementById(id);
        if (!el) continue;
        el.addEventListener("keydown", (e) => e.stopPropagation());
        el.addEventListener("keyup", (e) => e.stopPropagation());
    }
}
wireTitleFormKeys();
