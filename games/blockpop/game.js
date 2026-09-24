// Blockpop — rising-stack sort-and-pop with three modes, on the arcade shell.
// Shell owns screens, loop, pause, HUD plumbing and the high score.
// Rules: rules.js · session: board.js · drawing: render.js

import { createEffects } from "/lib/arcade/effects.js";
import { bindPointer } from "/lib/arcade/pointer.js";
import { recordScore, createScoreTabs, today } from "/lib/arcade/scores.js";
import { createOptions, sfxVolume, toggle } from "/lib/arcade/options.js";
import { COLORS } from "/app/rules.js";
import { Board } from "/app/board.js";
import { layoutFor, cellCenter, columnAt, addFlash, stepFlashes, drawBackground, drawBoard } from "/app/render.js";

const MODES = ["classic", "sprint", "puzzle"];
const HS_KEY = { classic: "hsClassic", sprint: "hsSprint", puzzle: "hsPuzzle" };
const EXTRA_LABEL = { classic: "NEXT RISE", sprint: "LEFT", puzzle: "MOVES" };
const SCREENS = ["modeselect", "highscores", "settings", "credits"];
const TOASTS = { action: ["#action-text", 900], cascade: ["#cascade-text", 700] };
const RISE_SPEEDS = [5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20];

const fx = createEffects({
    particle: "square",
    burst: { speed: 20, speedVar: 150, up: 60, life: 500, lifeVar: 400, size: 3, sizeVar: 2, gravity: 650, drag: 1, spin: 0 },
});

// Menu-level choices (not session state).
let nextMode = "classic";
let scoreTabs = null;
let options = null;
const prefs = { riseSpeed: 10, colorBlind: false };

export const game = {
    id: "blockpop",
    clearColor: "#050810",

    // Space = emergency brake only; a click picks / drops through the pointer.
    actions: [
        { name: "primary", label: "Brake", defaults: [" "] },
    ],

    defaults: {
        highScore: 0,
        sfxVol: 80,
        riseSpeed: 10,
        colorBlind: false,
        hsClassic: [],
        hsSprint: [],
        hsPuzzle: [],
    },

    init(api) {
        scoreTabs = createScoreTabs(api.save, MODES.map((m) => ({
            id: m,
            key: HS_KEY[m],
            format: m === "sprint"
                ? (e) => formatTime(e.time) + "  Lv" + (e.level || 1)
                : (e) => (e.score || 0) + "  Lv" + (e.level || 1) + "  x" + (e.chain || 1),
        })));
        options = createOptions(api, [
            { key: "riseSpeed", action: "cycle-risespeed", values: RISE_SPEEDS,
              label: (v) => (v / 10).toFixed(1), apply: (v) => { prefs.riseSpeed = v; } },
            toggle("colorBlind", "toggle-colorblind", (v) => { prefs.colorBlind = v; }),
            sfxVolume(),
        ]);
        options.applyAll();
        bindPointer(api, {
            click(p) {
                const run = api.getRun();
                const col = run ? columnAt(run.layout, p.x) : -1;
                if (col < 0) return;
                run.board.moveTo(col);
                run.board.interact();
            },
            wheel() {
                const run = api.getRun();
                if (run) run.board.shuffleHeld();
            },
        });
    },

    create(api) {
        fx.clear();
        const run = {
            score: 0,
            save: api.save,
            play: api.play,
            layout: layoutFor(api.view.width(), api.view.height()),
            flashes: [],
            board: null,
        };
        run.board = new Board({ mode: nextMode, riseSpeed: prefs.riseSpeed, fx: boardFx(api, run) });
        return run;
    },

    update(run, dt, input) {
        const b = run.board;
        if (input.pressed("left")) b.moveLeft();
        if (input.pressed("right")) b.moveRight();
        if (input.pressed("down")) b.interact();
        if (input.pressed("up")) b.shuffleHeld();
        if (input.pressed("primary")) b.emergencyBrake();

        b.riseSpeed = prefs.riseSpeed;
        b.tick(dt);
        fx.update(dt);
        stepFlashes(run.flashes, dt);
        run.score = b.score;

        if (b.ended()) {
            fx.clear();              // toasts would otherwise freeze behind the overlay
            run.flashes.length = 0;
            recordRun(run);
            if (b.finished) run.play("win");
            return { status: "gameover" };
        }
    },

    draw(run, ctx, view) {
        const { w, h } = view.size();
        run.layout = layoutFor(w, h);
        const shake = fx.shakeOffset();
        ctx.save();
        ctx.translate(shake.x, shake.y);
        drawBackground(ctx, w, h, run.board.time);
        drawBoard(ctx, run.board, run.layout, run.flashes, prefs.colorBlind);
        fx.draw(ctx);
        ctx.restore();
    },

    hud(run) {
        if (!run) return { score: 0, level: 1, extra: "—" };
        const b = run.board;
        const chain = b.bestChain >= 2;
        for (const id of ["hud-combo-label", "hud-combo"]) {
            const el = document.getElementById(id);
            if (el) el.style.display = chain ? "block" : "none";
        }
        return {
            score: b.score,
            level: b.level,
            extra: b.extraHud(),
            "extra-label": EXTRA_LABEL[b.mode],
            combo: chain ? "x" + b.bestChain : "",
        };
    },

    gameOverText(run) {
        const st = run.board.stats;
        const title = document.querySelector("#screen-gameover .overlay-title");
        if (title) title.textContent = st.finished ? st.mode.toUpperCase() + " COMPLETE!" : "GAME OVER";
        return (
            "Mode     " + st.mode.toUpperCase() + "\n" +
            "Score    " + st.score + (run._newBest ? "  ·  NEW BEST" : "") + "\n" +
            "Level    " + st.level + "\n" +
            "Popped   " + st.blocksPopped + "\n" +
            "Chain    x" + st.bestChain + "\n" +
            "Time     " + formatTime(st.gameTime)
        );
    },

    onEnterScreen(name, run) {
        if (name === "highscores") scoreTabs.show(run ? run.board.mode : nextMode);
        if (name === "settings") options.render();
    },

    onMenuAction(action) {
        const mode = /^mode-(\w+)$/.exec(action);
        if (mode) {
            nextMode = mode[1];
            return { startRun: true };
        }
        if (action === "play") return "modeselect";
        if (action === "hs-next") { scoreTabs.next(); return null; }
        if (options.handle(action)) return null;
        return SCREENS.includes(action) ? action : null;
    },

    // Game SFX only — menu move/select are shell-owned.
    cue(name, audio) {
        const seq = CUES[name];
        if (seq) { audio.sequence(seq); return; }
        const [kind, a, b] = name.split("@");
        if (kind === "pop") {
            const c = Math.max(0, ((parseInt(a, 10) || 1) - 1) % LADDER.length);
            audio.tone(LADDER[c] * Math.pow(2, Math.min(2, parseInt(b, 10) || 0)), 0.08, "square", 0.55);
        } else if (kind === "big") {
            const pops = parseInt(a, 10) || 3;
            const notes = [];
            for (let i = 0; i < Math.min(5, pops); i++) notes.push([LADDER[i % LADDER.length] * 2, 0.06, "square", 0.6]);
            audio.sequence(notes);
        } else if (kind === "special" && SPECIAL_CUES[a]) {
            audio.sequence(SPECIAL_CUES[a]);
        }
    },
};

// ── Sound ─────────────────────────────────────────────────────────────────

const LADDER = [261.63, 293.66, 329.63, 349.23, 392.0, 440.0, 493.88, 523.25];

const CUES = {
    pick: [[660, 0.05, "triangle", 0.35]],
    drop: [[220, 0.08, "triangle", 0.5]],
    move: [[440, 0.02, "square", 0.15]],
    shuffle: [[320, 0.04, "sine", 0.25]],
    brake: [[180, 0.08, "sawtooth", 0.5], [260, 0.08, "sawtooth", 0.4]],
    warn: [[90, 0.22, "sawtooth", 0.6]],
    gameover: [[440, 0.18, "sawtooth", 0.6], [330, 0.18, "sawtooth", 0.55], [220, 0.32, "sawtooth", 0.6]],
    levelup: [[392, 0.08, "square", 0.6], [523, 0.08, "square", 0.7], [659, 0.14, "square", 0.8]],
    win: [[523, 0.08, "square", 0.7], [659, 0.08, "square", 0.7], [784, 0.08, "square", 0.7], [1047, 0.22, "square", 0.9]],
};

const SPECIAL_CUES = {
    star: [[784, 0.05, "square", 0.6], [988, 0.05, "square", 0.6], [1318, 0.1, "square", 0.7]],
    bomb: [[60, 0.28, "sawtooth", 0.8]],
    rainbow: [[523, 0.04, "sine", 0.5], [659, 0.04, "sine", 0.5], [784, 0.04, "sine", 0.5], [988, 0.08, "sine", 0.6]],
};

// ── Wiring ────────────────────────────────────────────────────────────────

/** Session effects in board coordinates -> pixels through the run's layout. */
function boardFx(api, run) {
    return {
        cue: (name) => api.play(name),
        pop(c, r, color) {
            const p = cellCenter(run.layout, c, r);
            fx.burst(p.x, p.y, COLORS[color] || "#fff", 6);
            addFlash(run.flashes, c, r);
        },
        toast(kind, text) { const [sel, ms] = TOASTS[kind]; fx.toast(sel, text, ms); },
        shake: (ms, amp) => fx.shake(ms, amp),
    };
}

/** Per-mode leaderboard; sprint ranks finished runs by time. */
function recordRun(run) {
    const st = run.board.stats;
    const entry = { score: st.score, level: st.level, chain: st.bestChain, time: Math.floor(st.gameTime), date: today() };
    if (st.mode === "sprint") {
        if (st.finished) recordScore(run.save, HS_KEY.sprint, entry, 10, (a, b) => (a.time || 0) - (b.time || 0));
    } else {
        recordScore(run.save, HS_KEY[st.mode], entry);
    }
}

/** m:ss.cc */
export function formatTime(ms) {
    const s = Math.floor(ms / 1000);
    const m = Math.floor(s / 60);
    const sec = s % 60;
    const cs = Math.floor((ms % 1000) / 10);
    return m + ":" + (sec < 10 ? "0" : "") + sec + "." + (cs < 10 ? "0" : "") + cs;
}

export const internals = { prefs, get nextMode() { return nextMode; } };
