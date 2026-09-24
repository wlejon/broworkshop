// FPS Arena — multiplayer first-person client on the arcade shell.
//
// The shell owns screens, pause and the loop; this plugin owns one run = one
// connection. Around it:
//   net.js    bro.net connection, packet handling, local prediction (session)
//   world.js  arena scene, interpolated remote players, cameras
//   hud.js    combat HUD + crosshair
//   arena.js / protocol.js   shared with server.js (movement, collision, wire)
// Mouse look is pointer-locked on the scene canvas; Esc (the shell's pause)
// releases it.

import { connectForm } from "/lib/arcade/netplay.js";
import { IN } from "/app/arena.js";
import { session, connect, disconnect, sendInput, predict, nameOf } from "/app/net.js";
import { ensureWorld, viewCanvas, updateRemotes, clearRemotes, firstPerson, overview } from "/app/world.js";
import { drawHud, reticle, setCrosshair, killFeed, resetHud, flashDamage } from "/app/hud.js";

const DEFAULT_ADDRESS = "127.0.0.1:27015";
const INPUT_INTERVAL = 1000 / 60;   // ms between input packets
const LOOK_SPEED = 0.002;           // radians per pixel of mouse travel
const PITCH_LIMIT = Math.PI / 2 * 0.95;

let form = null;
let shell = null;
const look = { locked: false, wired: false };
const meter = { frames: 0, time: 0, fps: 0 };

export const game = {
    id: "fps",
    clearColor: "#000000",
    defaults: { name: "Player", address: DEFAULT_ADDRESS },
    actions: [{ name: "primary", label: "Shoot", defaults: ["Mouse0"] }],

    create(api) {
        shell = api;
        ensureWorld();
        wireLook();
        const join = form.read(api.save);
        form.clearError();
        resetHud();
        clearRemotes();
        const run = { score: 0, name: join.name, address: join.address, sendAccum: 0 };
        connect(join.address, join.name, {
            onConnect: () => form.clearError(),
            onLost: () => releaseLook(),
            onKill: (killer, victim) => {
                killFeed(nameOf(killer), nameOf(victim));
                if (killer === session.myId && killer !== victim) api.play("kill");
            },
            onHit: (_shooter, victim) => {
                if (victim !== session.myId) return;
                flashDamage();
                api.play("hit");
            },
        });
        return run;
    },

    update(run, dt, input) {
        if (session.lost) {
            return { status: "gameover", result: { score: run.score, reason: session.error } };
        }
        if (!session.connected || session.myId == null) return;
        const dts = Math.min(dt / 1000, 0.05);

        run.sendAccum += dt;
        if (run.sendAccum >= INPUT_INTERVAL) {
            run.sendAccum = Math.min(run.sendAccum - INPUT_INTERVAL, INPUT_INTERVAL);
            sendInput(inputBits(input));
        }
        const bits = inputBits(input);
        predict(bits, dts);
        reticle((bits & (IN.FWD | IN.BACK | IN.LEFT | IN.RIGHT)) !== 0,
                (bits & IN.SHOOT) !== 0 && session.me.alive, dts);
        updateRemotes(session.remotes, session.myId, Date.now());
        run.score = session.me.kills;

        meter.frames++;
        meter.time += dts;
        if (meter.time >= 0.5) {
            meter.fps = Math.round(meter.frames / meter.time);
            meter.frames = 0;
            meter.time = 0;
        }
        drawHud(session, { fps: meter.fps, pointerLocked: look.locked });
    },

    draw() {
        if (session.connected && session.myId != null) firstPerson(session.me);
        else overview(Date.now());
    },

    drawTitle() {
        overview(Date.now());
    },

    hud() {
        return {};    // the combat HUD is drawn by hud.js
    },

    gameOverText(run, result) {
        const reason = (result && result.reason) || "Disconnected";
        return reason + "\nKills: " + (run ? run.score : 0) + (run && run._newBest ? "  ·  NEW BEST" : "");
    },

    onEnterScreen(name, run, api) {
        shell = api;
        if (!form) {
            form = connectForm({
                name: "#name-input", address: "#address-input", error: "#error-msg",
                defaults: { address: DEFAULT_ADDRESS },
            });
            ensureWorld();
        }
        if (name === "playing") {
            setCrosshair(session.connected);
            if (run) drawHud(session, { fps: meter.fps, pointerLocked: look.locked });
            return;
        }
        releaseLook();
        setCrosshair(false);
        // Paused mid-match: the server keeps simulating, so stop walking and firing.
        if (name === "pause") sendInput(0);
        if (name === "title" || name === "gameover") {
            if (session.error) form.error(session.error);
            disconnect();
            clearRemotes();
        }
        if (name === "title") form.fill(api.save);
    },

    cue(name, audio) {
        if (name === "hit") audio.tone(200, 0.08, "sawtooth", 0.45);
        else if (name === "kill") audio.sequence([[520, 0.06, "square", 0.4], [780, 0.1, "square", 0.5]]);
    },
};

// ── Input ────────────────────────────────────────────────────────────────

/** Movement + fire bits; nothing until the mouse is captured. */
function inputBits(input) {
    if (!look.locked || !input) return 0;
    let bits = 0;
    if (input.down("up")) bits |= IN.FWD;
    if (input.down("down")) bits |= IN.BACK;
    if (input.down("left")) bits |= IN.LEFT;
    if (input.down("right")) bits |= IN.RIGHT;
    if (input.down("primary")) bits |= IN.SHOOT;
    return bits;
}

/** Click the scene to capture the mouse; mouse travel turns and pitches the view. */
function wireLook() {
    if (look.wired) return;
    look.wired = true;
    const canvas = viewCanvas();
    canvas.addEventListener("mousedown", () => {
        if (!session.connected || !shell || shell.getScreen() !== "playing" || look.locked) return;
        canvas.requestPointerLock();
        look.locked = true;
    });
    document.addEventListener("pointerlockchange", () => {
        look.locked = document.pointerLockElement === canvas;
    });
    document.addEventListener("mousemove", (e) => {
        if (!look.locked) return;
        const me = session.me;
        me.yaw += e.movementX * LOOK_SPEED;
        me.pitch = Math.max(-PITCH_LIMIT, Math.min(PITCH_LIMIT, me.pitch - e.movementY * LOOK_SPEED));
    });
}

function releaseLook() {
    look.locked = false;
    if (document.pointerLockElement) document.exitPointerLock();
}

/** Test hook: the pointer-lock state the input gate reads. */
export function lookState() {
    return look;
}
