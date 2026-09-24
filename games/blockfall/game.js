// Blockfall — falling-block puzzle, arcade plugin.
// Shell (/lib/arcade): screens, loop, pause, bindings, HUD plumbing, high
// score. Here: the 3-2-1 countdown, auto-repeat (DAS) and soft drop over
// the input, rules events -> sounds, flashes, particles and callouts, the
// music, and the Settings screen.
//   rules.js   well, pieces, rotation, gravity, lock, scoring
//   render.js  drawing
//   music.js   chiptune tracks that speed up with the level

import { createEffects } from "/lib/arcade/effects.js";
import { createOptions, sfxVolume, toggle } from "/lib/arcade/options.js";
import { statsBlock, newBest } from "/lib/arcade/scores.js";
import { formatClock } from "/lib/arcade/timers.js";
import {
    createBlockfall, moveH, softDrop, rotate, hardDrop, hold, step, drainEvents,
} from "/app/rules.js";
import {
    COLORS, CLEAR_MS, layoutFor, cellCenter, drawWell, drawPreviews, drawCountdown,
} from "/app/render.js";
import { Music } from "/app/music.js";

const DAS_DELAY = 167;         // hold this long before auto-repeat
const DAS_ARR = 33;            // then one column per this
const COUNT_STEP = 700;
const COUNT_TOTAL = 3200;
const START_LEVELS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
const CLEAR_TEXT = { 2: "DOUBLE", 3: "TRIPLE", 4: "QUAD!" };

const fx = createEffects({ particle: "square" });
const prefs = { ghost: true, grid: true };
let api = null;
let options = null;

export const game = {
    id: "blockfall",
    clearColor: "#06060a",

    actions: [
        { name: "secondary", label: "Hold", defaults: ["c", "Shift"] },
        { name: "rotate_ccw", label: "Rotate CCW", defaults: ["q", "z"] },
    ],

    defaults: { highScore: 0, startLevel: 1, ghost: true, grid: true, sfxVol: 100 },

    init(shellApi) {
        api = shellApi;
        options = createOptions(api, [
            { key: "startLevel", action: "cycle-startlevel", values: START_LEVELS, label: String },
            toggle("ghost", "toggle-ghost", (v) => { prefs.ghost = v; }),
            toggle("grid", "toggle-grid", (v) => { prefs.grid = v; }),
            sfxVolume(),
        ]);
        options.applyAll();
        Music.init(api.audio);
    },

    create(shellApi) {
        fx.clear();
        Music.stop();
        shellApi.play("countdown");
        return {
            score: 0,
            state: createBlockfall({ startLevel: options.get("startLevel") }),
            phase: "countdown",
            count: 0,          // ms into the countdown
            countN: 3,
            das: { dir: 0, timer: 0, active: false },
            softDropping: false,
            flashes: [],
            clear: null,
            play: shellApi.play,
            highScore: shellApi.highScore,
        };
    },

    update(run, dt, input) {
        tickView(run, dt);
        if (run.phase === "countdown") {
            countdown(run, dt, input);
            return;
        }
        const s = run.state;
        handleInput(run, input);
        stepDas(run, dt);
        step(s, dt, run.softDropping);
        run.score = s.score;
        return react(run);
    },

    draw(run, ctx, view) {
        const { w, h } = view.size();
        const L = layoutFor(w, h);
        const o = fx.shakeOffset();
        ctx.save();
        ctx.translate(o.x, o.y);
        drawWell(ctx, run.state, L, { flashes: run.flashes, clear: run.clear, ghost: prefs.ghost, grid: prefs.grid });
        drawPreviews(ctx, run.state, L);
        fx.draw(ctx);
        ctx.restore();
        if (run.phase === "countdown") drawCountdown(ctx, w, h, run.countN);
    },

    hud(run) {
        if (!run) return { score: 0, level: 1, lines: 0, combo: "—" };
        const s = run.state;
        return {
            score: s.score,
            best: Math.max(run.highScore(), s.score),
            level: s.level,
            lines: s.lines,
            combo: s.combo > 0 ? String(s.combo) : "—",
        };
    },

    gameOverText(run) {
        const s = run.state, st = s.stats;
        return statsBlock([
            ["Score", s.score + newBest(run)],
            ["Best", run.highScore()],
            ["Level", s.level],
            ["Lines", s.lines],
            ["Time", formatClock(s.time)],
            ["Singles / Doubles", st.singles + " / " + st.doubles],
            ["Triples / Quads", st.triples + " / " + st.quads],
            ["Max Combo", st.maxCombo],
        ]);
    },

    onEnterScreen(name, run) {
        if (name === "settings") options.render();
        if (name === "pause") Music.pause();
        else if (name === "playing" && run && run.phase === "playing") Music.resume();
        else if (name === "gameover" || name === "title") Music.stop();
    },

    onMenuAction(action) {
        if (options.handle(action)) return null;
        return action === "settings" ? "settings" : null;
    },

    // Game SFX only — menu move/select are shell-owned.
    cue(name, audio) {
        const seq = CUES[name];
        if (seq) audio.sequence(seq);
    },
};

const CUES = {
    move: [[200, 0.05, "square", 0.4]],
    rotate: [[300, 0.06, "square", 0.5]],
    drop: [[120, 0.12, "triangle", 0.8]],
    lock: [[160, 0.08, "triangle", 0.5]],
    hold: [[250, 0.06, "sine", 0.4]],
    clear1: [[523, 0.15, "square", 0.6]],
    clear2: [[659, 0.15, "square", 0.7]],
    clear3: [[784, 0.18, "square", 0.8]],
    clear4: [[523, 0.1, "square", 0.8], [659, 0.1, "square", 0.8], [784, 0.12, "square", 0.9], [1047, 0.2, "square", 1.0]],
    levelup: [[440, 0.08, "sine", 0.6], [554, 0.08, "sine", 0.7], [659, 0.12, "sine", 0.8]],
    combo: [[520, 0.1, "square", 0.6]],
    countdown: [[440, 0.15, "sine", 0.6]],
    go: [[880, 0.2, "square", 0.8]],
    die: [[300, 0.2, "sawtooth", 0.5], [250, 0.2, "sawtooth", 0.5], [200, 0.4, "sawtooth", 0.5]],
};

// Particle bursts in px/s, tuned to the old per-frame sparks.
const CLEAR_SPARKS = { speed: 0, speedVar: 150, up: 90, life: 400, lifeVar: 300, size: 2, sizeVar: 3, gravity: 540, drag: 1, spin: 0 };
const DROP_SPARKS = { speed: 0, speedVar: 90, up: 60, life: 200, lifeVar: 100, size: 2, sizeVar: 3, gravity: 540, drag: 1, spin: 0 };

// ── Countdown ────────────────────────────────────────────────────────────

function countdown(run, dt, input) {
    run.count += dt;
    const n = 3 - Math.floor(run.count / COUNT_STEP);
    if (n < run.countN && n >= 0) {
        run.countN = n;
        run.play(n > 0 ? "countdown" : "go");
    }
    if (run.count < COUNT_TOTAL) return;
    run.phase = "playing";
    Music.start(run.state.level);
    input.clearEdges();                             // presses during the count don't fire on GO
    // Keys already held arm auto-repeat / soft drop without a free first step.
    run.das = { dir: input.down("left") ? -1 : input.down("right") ? 1 : 0, timer: 0, active: false };
    run.softDropping = input.down("down");
}

// ── Input ────────────────────────────────────────────────────────────────

function handleInput(run, input) {
    const s = run.state;
    if (input.pressed("left")) { moveH(s, -1); armDas(run, -1); }
    if (input.pressed("right")) { moveH(s, 1); armDas(run, 1); }
    // Releasing ends auto-repeat; the other direction still held takes over.
    if (run.das.dir === -1 && !input.down("left")) armDas(run, input.down("right") ? 1 : 0);
    if (run.das.dir === 1 && !input.down("right")) armDas(run, input.down("left") ? -1 : 0);

    if (input.pressed("down")) softDrop(s);
    run.softDropping = input.down("down");
    if (input.pressed("primary")) hardDrop(s);
    if (input.pressed("up")) rotate(s, 1);
    if (input.pressed("rotate_ccw")) rotate(s, -1);
    if (input.pressed("secondary")) hold(s);
}

function armDas(run, dir) {
    run.das = { dir, timer: 0, active: false };
}

function stepDas(run, dt) {
    const das = run.das;
    if (!das.dir) return;
    das.timer += dt;
    if (!das.active) {
        if (das.timer < DAS_DELAY) return;
        das.active = true;
        das.timer = 0;
    }
    while (das.timer >= DAS_ARR) {
        das.timer -= DAS_ARR;
        moveH(run.state, das.dir);
    }
}

// ── Events -> sound and juice ────────────────────────────────────────────

function react(run) {
    const s = run.state;
    const L = layoutFor(api.view.width(), api.view.height());
    let result;
    for (const e of drainEvents(s)) {
        switch (e.type) {
            case "move": case "rotate": case "hold":
                run.play(e.type);
                break;
            case "drop":
                run.play("drop");
                for (const [r, c] of e.cells) {
                    for (let y = r - e.dist; y <= r; y++) if (y >= 0) run.flashes.push({ r: y, c, t: 120 });
                    const p = cellCenter(L, r, c);
                    fx.burst(p.x, p.y, COLORS[e.piece], 2, DROP_SPARKS);
                }
                if (e.dist > 4) fx.shake(120, 3);
                break;
            case "lock":
                run.play("lock");
                for (const [r, c] of e.cells) run.flashes.push({ r, c, t: 200 });
                break;
            case "clear":
                run.play("clear" + e.n);
                if (CLEAR_TEXT[e.n]) fx.toast("#action-text", CLEAR_TEXT[e.n], 800);
                if (e.n === 4) fx.shake(300, 8);
                run.clear = { rows: e.rows, t: 0 };
                e.rows.forEach((r, i) => e.colors[i].forEach((v, c) => {
                    const p = cellCenter(L, r, c);
                    fx.burst(p.x, p.y, COLORS[v] || "#fff", 3, CLEAR_SPARKS);
                }));
                break;
            case "combo":
                run.play("combo");
                if (e.n > 1) fx.toast("#action-text", e.n + "x COMBO!", 800);
                break;
            case "levelup":
                run.play("levelup");
                fx.toast("#action-text", "LEVEL " + e.level, 800);
                Music.setLevel(e.level);
                break;
            case "topout":
                run.play("die");
                Music.stop();
                result = { status: "gameover" };
                break;
        }
    }
    Music.update();
    return result;
}

// Flashes, the line strobe and particles run on the game clock.
function tickView(run, dt) {
    for (const f of run.flashes) f.t -= dt;
    run.flashes = run.flashes.filter((f) => f.t > 0);
    if (run.clear && (run.clear.t += dt) >= CLEAR_MS) run.clear = null;
    fx.update(dt);
}
