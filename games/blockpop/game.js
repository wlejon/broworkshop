// Blockpop — arcade foundation plugin.
// Domain: board.js + particles.js. Shell owns screens / loop / pause / HUD.

import { Board } from "/app/board.js";
import { Particles } from "/app/particles.js";

const LADDER = [261.63, 293.66, 329.63, 349.23, 392.0, 440.0, 493.88, 523.25];

/** Mode selected on mode-select screen before a run starts. */
let pendingMode = "classic";
let hsMode = "classic";

export const game = {
    id: "blockpop",
    clearColor: "#050810",

    // Space = emergency brake only (not Mouse0 — click places via canvas handler)
    actions: [
        { name: "primary", label: "Brake", defaults: [" "] },
    ],

    defaults: {
        highScore: 0,
        riseSpeed: 10,
        colorBlind: false,
        hsClassic: [],
        hsSprint: [],
        hsPuzzle: [],
    },

    create(ctx) {
        Board._play = (name) => ctx.play(name);
        Board._settings = {
            riseSpeed: ctx.save.get("riseSpeed") != null ? ctx.save.get("riseSpeed") : 10,
            colorBlind: !!ctx.save.get("colorBlind"),
        };
        Board.startGame(pendingMode || "classic");

        const run = {
            score: 0,
            play: ctx.play,
            highScore: ctx.highScore,
            save: ctx.save,
            view: ctx.view,
            alive: true,
            ended: false,
        };
        attachPointer(run);
        return run;
    },

    update(run, dt, input) {
        if (run.ended) return { status: "gameover" };

        if (input.pressed("left")) Board.moveLeft();
        if (input.pressed("right")) Board.moveRight();
        if (input.pressed("down")) Board.interact();
        if (input.pressed("up")) Board.shuffleHeld();
        if (input.pressed("primary")) Board.emergencyBrake();

        Board.tick(dt);
        Particles.update(dt);
        run.score = Board.getScore();

        if (Board.isGameOver() || Board.isFinished()) {
            run.ended = true;
            persistHighScore(run);
            if (Board.isFinished()) run.play("win");
            return { status: "gameover", result: { finished: Board.isFinished() } };
        }
    },

    draw(run, ctx, view) {
        const { w, h } = view.size();
        const shake = Particles.shakeOffset();
        ctx.save();
        ctx.translate(shake.x, shake.y);
        Board.draw(ctx, w, h, performance.now());
        ctx.restore();
    },

    hud(run) {
        const st = Board.getStats ? Board.getStats() : {};
        Board.updateHUDLabels && Board.updateHUDLabels();
        return {
            score: st.score != null ? st.score : 0,
            level: st.level != null ? st.level : 1,
            extra: Board.getExtraHud ? Board.getExtraHud() : "—",
            combo: st.bestChain >= 2 ? ("x" + st.bestChain) : "",
        };
    },

    gameOverText(run, result) {
        const st = Board.getStats();
        const fin = st.finished || (result && result.finished);
        const tag = run && run._newBest ? "  ·  NEW BEST" : "";
        const header = fin ? (st.mode.toUpperCase() + " COMPLETE!") : "GAME OVER";
        return (
            header + "\n\n" +
            "Mode     " + st.mode.toUpperCase() + "\n" +
            "Score    " + st.score + tag + "\n" +
            "Level    " + st.level + "\n" +
            "Popped   " + st.blocksPopped + "\n" +
            "Chain    x" + st.bestChain + "\n" +
            "Time     " + formatTime(st.gameTime)
        );
    },

    onEnterScreen(name, run, api) {
        if (name === "modeselect") {
            // ensure menu items use data-action for shell navigation
        }
        if (name === "highscores") {
            hsMode = "classic";
            renderHighScores(api);
        }
        if (name === "settings") {
            renderSettings(api);
        }
        if (name === "gameover") {
            const st = Board.getStats();
            const title = document.querySelector("#screen-gameover .overlay-title");
            if (title) {
                title.textContent = st.finished
                    ? st.mode.toUpperCase() + " COMPLETE!"
                    : "GAME OVER";
            }
        }
    },

    onMenuAction(action, run, api) {
        if (action === "modeselect" || action === "play") {
            // Title PLAY goes to mode select (override default play)
            return "modeselect";
        }
        if (action === "mode-classic") {
            pendingMode = "classic";
            return { startRun: true };
        }
        if (action === "mode-sprint") {
            pendingMode = "sprint";
            return { startRun: true };
        }
        if (action === "mode-puzzle") {
            pendingMode = "puzzle";
            return { startRun: true };
        }
        if (action === "highscores") return "highscores";
        if (action === "settings") return "settings";
        if (action === "credits") return "credits";

        if (action === "hs-next") {
            const modes = ["classic", "sprint", "puzzle"];
            const i = modes.indexOf(hsMode);
            hsMode = modes[(i + 1) % 3];
            renderHighScores(api);
            return null;
        }

        if (action === "toggle-colorblind") {
            const v = !api.save.get("colorBlind");
            api.save.set("colorBlind", v);
            api.save.save();
            Board._settings.colorBlind = v;
            renderSettings(api);
            return null;
        }
        if (action === "cycle-risespeed") {
            let r = api.save.get("riseSpeed") || 10;
            r += 1;
            if (r > 20) r = 5;
            api.save.set("riseSpeed", r);
            api.save.save();
            Board._settings.riseSpeed = r;
            renderSettings(api);
            return null;
        }

        return null;
    },

    // Game SFX only — menu move/select are shell-owned.
    cue(name, audio) {
        if (name === "pick") audio.tone(660, 0.05, "triangle", 0.35);
        else if (name === "drop") audio.tone(220, 0.08, "triangle", 0.5);
        else if (name === "move") audio.tone(440, 0.02, "square", 0.15);
        else if (name === "shuffle") audio.tone(320, 0.04, "sine", 0.25);
        else if (name === "brake") {
            audio.sequence([
                [180, 0.08, "sawtooth", 0.5],
                [260, 0.08, "sawtooth", 0.4],
            ]);
        } else if (name === "warn") audio.tone(90, 0.22, "sawtooth", 0.6);
        else if (name === "gameover") {
            audio.sequence([
                [440, 0.18, "sawtooth", 0.6],
                [330, 0.18, "sawtooth", 0.55],
                [220, 0.32, "sawtooth", 0.6],
            ]);
        } else if (name === "levelup") {
            audio.sequence([
                [392, 0.08, "square", 0.6],
                [523, 0.08, "square", 0.7],
                [659, 0.14, "square", 0.8],
            ]);
        } else if (name === "win") {
            audio.sequence([
                [523, 0.08, "square", 0.7],
                [659, 0.08, "square", 0.7],
                [784, 0.08, "square", 0.7],
                [1047, 0.22, "square", 0.9],
            ]);
        } else if (name.indexOf("pop@") === 0) {
            const parts = name.split("@");
            const color = parseInt(parts[1], 10) || 1;
            const depth = parseInt(parts[2], 10) || 0;
            const c = ((color | 0) - 1) % LADDER.length;
            const mult = Math.pow(2, Math.min(2, depth));
            audio.tone(LADDER[c < 0 ? 0 : c] * mult, 0.08, "square", 0.55);
        } else if (name.indexOf("big@") === 0) {
            const pops = parseInt(name.slice(4), 10) || 3;
            const notes = [];
            for (let i = 0; i < Math.min(5, pops); i++) {
                notes.push([LADDER[i % LADDER.length] * 2, 0.06, "square", 0.6]);
            }
            audio.sequence(notes);
        } else if (name.indexOf("special@") === 0) {
            const kind = name.slice(8);
            if (kind === "star") {
                audio.sequence([
                    [784, 0.05, "square", 0.6],
                    [988, 0.05, "square", 0.6],
                    [1318, 0.1, "square", 0.7],
                ]);
            } else if (kind === "bomb") {
                audio.tone(60, 0.28, "sawtooth", 0.8);
            } else if (kind === "rainbow") {
                audio.sequence([
                    [523, 0.04, "sine", 0.5],
                    [659, 0.04, "sine", 0.5],
                    [784, 0.04, "sine", 0.5],
                    [988, 0.08, "sine", 0.6],
                ]);
            }
        }
    },
};

// Title "PLAY" uses data-action="modeselect" so shell doesn't start a run.
// Restart reuses pendingMode via create().

// ── Pointer ──────────────────────────────────────────────────────────────

/** One listener set per canvas; always targets the latest run on that canvas. */
function attachPointer(run) {
    const canvas = run.view && run.view.canvas;
    if (!canvas) return;
    canvas._blockpopRun = run;
    if (canvas._blockpopPointer) return;
    canvas._blockpopPointer = true;

    canvas.addEventListener("click", (e) => {
        const r = canvas._blockpopRun;
        if (!r || !r.view) return;
        const rect = canvas.getBoundingClientRect
            ? canvas.getBoundingClientRect()
            : null;
        let x = e.clientX, y = e.clientY;
        if (rect) {
            const scaleX = r.view.width() / (rect.width || r.view.width());
            const scaleY = r.view.height() / (rect.height || r.view.height());
            x = (e.clientX - rect.left) * scaleX;
            y = (e.clientY - rect.top) * scaleY;
        } else if (typeof e.offsetX === "number") {
            x = e.offsetX;
            y = e.offsetY;
        }
        Board.mouseClick(x, y);
    });
    canvas.addEventListener("wheel", (e) => {
        Board.mouseWheel(e.deltaY || 0);
    }, { passive: true });
}

// ── High scores / settings ───────────────────────────────────────────────

function persistHighScore(run) {
    if (!run || !run.save) return;
    const st = Board.getStats();
    const entry = {
        score: st.score,
        level: st.level,
        chain: st.bestChain,
        time: Math.floor(st.gameTime),
        date: dateISO(),
    };
    let key = "hsClassic";
    if (st.mode === "sprint") {
        if (!st.finished) return;
        key = "hsSprint";
        entry.score = Math.floor(st.gameTime); // lower is better for display
    } else if (st.mode === "puzzle") {
        key = "hsPuzzle";
    }
    const list = (run.save.get(key) || []).slice();
    if (st.mode === "sprint") {
        list.push(entry);
        list.sort((a, b) => (a.time || 0) - (b.time || 0));
    } else {
        list.push(entry);
        list.sort((a, b) => (b.score || 0) - (a.score || 0));
    }
    run.save.set(key, list.slice(0, 10));
    if (st.mode !== "sprint") run.save.maybeHighScore(st.score);
    run.save.save();
}

function renderHighScores(api) {
    const modes = ["classic", "sprint", "puzzle"];
    for (let i = 0; i < modes.length; i++) {
        const el = document.getElementById("hs-tab-" + modes[i]);
        if (el) el.className = modes[i] === hsMode ? "hs-tab active" : "hs-tab";
    }
    const key =
        hsMode === "sprint" ? "hsSprint" :
        hsMode === "puzzle" ? "hsPuzzle" : "hsClassic";
    const list = api.save.get(key) || [];
    const out = document.getElementById("hs-list");
    if (!out) return;
    if (!list.length) {
        out.textContent = "No scores yet";
        return;
    }
    const lines = [];
    for (let i = 0; i < list.length; i++) {
        const s = list[i];
        let rank = (i + 1) + ".";
        if (i < 9) rank = " " + rank;
        if (hsMode === "sprint") {
            lines.push(rank + " " + formatTime(s.time) + "  Lv" + (s.level || 1));
        } else {
            lines.push(
                rank + " " + (s.score || 0) + "  Lv" + (s.level || 1) +
                "  x" + (s.chain || 1)
            );
        }
    }
    out.textContent = lines.join("\n");
}

function renderSettings(api) {
    const rs = document.getElementById("opt-riseSpeed");
    const cb = document.getElementById("opt-colorBlind");
    if (rs) {
        const v = api.save.get("riseSpeed") || 10;
        rs.textContent = (v / 10).toFixed(1);
    }
    if (cb) cb.textContent = api.save.get("colorBlind") ? "ON" : "OFF";
}

function formatTime(ms) {
    const s = Math.floor(ms / 1000);
    const m = Math.floor(s / 60);
    const sec = s % 60;
    const cs = Math.floor((ms % 1000) / 10);
    return m + ":" + (sec < 10 ? "0" : "") + sec + "." + (cs < 10 ? "0" : "") + cs;
}

function dateISO() {
    try { return new Date().toISOString().slice(0, 10); }
    catch (e) { return "----"; }
}

// ── Test hooks ───────────────────────────────────────────────────────────

/** @type {object|null} */
let shellRef = null;

export function installTestHooks(shell) {
    shellRef = shell;

    const Screens = {
        switchTo: function (name) {
            if (name === "playing" || name === "play") {
                if (!shell.getRun()) {
                    pendingMode = pendingMode || "classic";
                    shell.startRun();
                } else {
                    shell.switchTo("playing");
                }
            } else if (name === "title") {
                shell.switchTo("title");
            } else if (name === "gameOver" || name === "gameover") {
                shell.switchTo("gameover");
            } else {
                shell.switchTo(name);
            }
        },
        manager: function () {
            return {
                name: function () { return shell.getScreen(); },
                current: function () { return null; },
            };
        },
    };

    window.__blockpop = {
        G: {
            Board: Board,
            Particles: Particles,
            Screens: Screens,
        },
        board: Board,
        particles: Particles,
        screens: Screens,
        shell: shell,
        // Convenience for tests (also on Board).
        pick: function () { return Board.pick(); },
        place: function () { return Board.place(); },
    };
}
