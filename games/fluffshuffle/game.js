// Fluffshuffle — wrap-drag match-3 on the arcade foundation.
// Domain: board.js, puffs.js, particles.js.

import { Board } from "/app/board.js";
import { Particles } from "/app/particles.js";
import { Puffs } from "/app/puffs.js";

const COLOR_PITCH = [0, 440, 494, 523, 587, 659, 784];

let preferredMode = "classic";
let hsMode = "classic";
let shellRef = null;

export const game = {
    id: "fluffshuffle",
    clearColor: "#0d1326",

    actions: [
        { name: "primary", label: "Grab / release", defaults: [" ", "Enter"] },
    ],

    defaults: {
        highScore: 0,
        sfxVol: 80,
        dragDead: 6,
        showCursor: true,
        eyeTrack: true,
        hsClassic: [],
        hsTimed: [],
        hsPuzzle: [],
    },

    create(ctx) {
        Board.setPlay(function (name) { ctx.play(name); });
        Board.setSettings({
            dragDead: ctx.save.get("dragDead") != null ? ctx.save.get("dragDead") : 6,
            showCursor: ctx.save.get("showCursor") !== false,
            eyeTrack: ctx.save.get("eyeTrack") !== false,
        });

        Board.startGame(preferredMode);
        if (Particles.clear) Particles.clear();

        const run = {
            score: 0,
            mode: preferredMode,
            play: ctx.play,
            highScore: ctx.highScore,
            save: ctx.save,
            view: ctx.view,
            ended: false,
        };
        attachPointer(run);
        syncScore(run);
        return run;
    },

    update(run, dt, input) {
        if (input.pressed("up")) Board.cursorSlide(-1, 0);
        else if (input.pressed("down")) Board.cursorSlide(1, 0);
        else if (input.pressed("left")) Board.cursorSlide(0, -1);
        else if (input.pressed("right")) Board.cursorSlide(0, 1);

        if (input.pressed("primary")) Board.cursorAction();

        Board.update(dt);
        if (Particles) Particles.update(dt);
        syncScore(run);

        const done = Board.isGameOver() ||
            (Board.getMode() === "puzzle" && Board.isFinished());
        if (done && !run.ended) {
            run.ended = true;
            persistHighScore(run);
            run.play("gameover");
            return { status: "gameover" };
        }
    },

    draw(run, ctx, view) {
        const { w: W, h: H } = view.size();
        Board.calcLayout(W, H);
        Board.drawBackground(ctx, W, H);
        Board.drawBoard(ctx);
        if (Particles) Particles.draw(ctx);
    },

    drawTitle(ctx, view) {
        const { w: W, h: H } = view.size();
        const g = ctx.createLinearGradient(0, 0, 0, H);
        g.addColorStop(0, "#0d1326");
        g.addColorStop(1, "#231a38");
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, W, H);
    },

    hud(run) {
        if (!run) {
            return { score: 0, level: 1, extra: 0 };
        }
        Board.updateHUD();
        const mode = Board.getMode();
        let extra = Board.getPopped();
        if (mode === "timed") extra = Board.formatTime(Board.getModeTimer());
        else if (mode === "puzzle") extra = Board.getPuzzleMovesLeft();
        return {
            score: Board.getScore(),
            level: Board.getLevel(),
            extra: extra,
            best: run.highScore(),
        };
    },

    gameOverText(run) {
        const m = Board.getMode();
        const score = Board.getScore();
        const stats = Board.getStats() || {};
        const finished = Board.isFinished();
        const modeLabel = m.charAt(0).toUpperCase() + m.slice(1);
        const title = document.querySelector("#screen-gameover .overlay-title");
        if (title) title.textContent = finished ? (modeLabel + " Complete!") : "Game Over";
        const tag = run && run._newBest ? "  ·  NEW BEST" : "";
        return (
            "Score      " + score + tag + "\n" +
            "Level      " + Board.getLevel() + "    Moves  " + Board.getMoves() + "\n" +
            "Popped     " + (stats.popped || 0) + "\n" +
            "Max Chain  x" + Board.getMaxChain() + "\n" +
            "Specials   J" + (stats.jumboMade || 0) +
                " A" + (stats.arrowMade || 0) +
                " P" + (stats.prismMade || 0) + "\n" +
            "Unlocks    " + (stats.unlocks || 0)
        );
    },

    onEnterScreen(name, run, api) {
        if (name === "highscores") {
            hsMode = "classic";
            renderHighScores(api);
        }
        if (name === "settings") {
            renderSettings(api);
        }
    },

    onMenuAction(action, run, api) {
        if (action === "modeselect" || action === "play") return "modeselect";
        if (action === "highscores") return "highscores";
        if (action === "settings") return "settings";
        if (action === "credits") return "credits";

        if (action === "mode-classic") {
            preferredMode = "classic";
            return { startRun: true };
        }
        if (action === "mode-timed") {
            preferredMode = "timed";
            return { startRun: true };
        }
        if (action === "mode-puzzle") {
            preferredMode = "puzzle";
            return { startRun: true };
        }

        if (action === "hs-next") {
            const modes = ["classic", "timed", "puzzle"];
            const i = modes.indexOf(hsMode);
            hsMode = modes[(i + 1) % 3];
            renderHighScores(api);
            return null;
        }

        if (action === "cycle-sfx") {
            let v = api.save.get("sfxVol");
            if (v == null) v = 80;
            v = (v + 10) % 110;
            api.save.set("sfxVol", v);
            api.save.save();
            if (api.audio && api.audio.setSfxVol) api.audio.setSfxVol(v / 100);
            renderSettings(api);
            return null;
        }
        if (action === "cycle-drag") {
            let d = api.save.get("dragDead");
            if (d == null) d = 6;
            d += 1;
            if (d > 20) d = 2;
            api.save.set("dragDead", d);
            api.save.save();
            Board.setSettings({ dragDead: d });
            renderSettings(api);
            return null;
        }
        if (action === "toggle-cursor") {
            const v = api.save.get("showCursor") === false ? true : false;
            // Toggle: if currently false → true, else false. Default is true.
            const cur = api.save.get("showCursor");
            const next = cur === false;
            api.save.set("showCursor", next);
            api.save.save();
            Board.setSettings({ showCursor: next });
            renderSettings(api);
            return null;
        }
        if (action === "toggle-eyes") {
            const cur = api.save.get("eyeTrack");
            const next = cur === false;
            api.save.set("eyeTrack", next);
            api.save.save();
            Board.setSettings({ eyeTrack: next });
            renderSettings(api);
            return null;
        }

        return null;
    },

    // Game SFX only — menu move/select are shell-owned.
    cue(name, audio) {
        if (name === "grab") audio.tone(520, 0.05, "sine", 0.35);
        else if (name === "snap") audio.tone(880, 0.04, "square", 0.3);
        else if (name === "cursor") audio.tone(380, 0.04, "sine", 0.22);
        else if (name === "thud") audio.tone(120, 0.16, "sawtooth", 0.4);
        else if (name === "lock") {
            audio.sequence([
                [260, 0.06, "triangle", 0.35],
                [180, 0.10, "triangle", 0.35],
            ]);
        } else if (name === "levelup") {
            audio.sequence([
                [523, 0.1, "triangle", 0.5],
                [659, 0.1, "triangle", 0.5],
                [784, 0.1, "triangle", 0.5],
                [1047, 0.18, "sine", 0.5],
            ]);
        } else if (name === "gameover") {
            audio.sequence([
                [440, 0.15, "triangle", 0.45],
                [330, 0.15, "triangle", 0.45],
                [220, 0.25, "triangle", 0.45],
            ]);
        } else if (name.indexOf("match@") === 0) {
            const parts = name.split("@");
            const chain = parseInt(parts[1], 10) || 1;
            const color = parseInt(parts[2], 10) || 1;
            const size = parseInt(parts[3], 10) || 3;
            const base = COLOR_PITCH[color] || 520;
            const step = Math.min(chain, 8);
            const freq = base * Math.pow(1.0595, step);
            const vol = Math.min(1.0, 0.35 + size * 0.05);
            audio.tone(freq, 0.12, "triangle", vol);
            audio.tone(freq * 1.5, 0.06, "sine", 0.25 * vol);
            if (size >= 4) {
                audio.sequence([
                    [freq * 1.5, 0.08, "triangle", vol * 0.7],
                    [freq * 2.0, 0.12, "sine", vol * 0.55],
                ]);
            }
            if (chain >= 3) {
                audio.sequence([
                    [600 + chain * 50, 0.06, "square", 0.3],
                    [760 + chain * 50, 0.06, "square", 0.3],
                    [960 + chain * 50, 0.10, "square", 0.3],
                ]);
            }
        }
    },
};

function syncScore(run) {
    if (run) run.score = Board.getScore();
}

/** One listener set per canvas; always targets the latest run on that canvas. */
function attachPointer(run) {
    const canvas = run.view && run.view.canvas;
    if (!canvas) return;
    canvas._fluffshuffleRun = run;
    if (canvas._fluffshufflePointer) return;
    canvas._fluffshufflePointer = true;

    function localXY(e) {
        const r = canvas._fluffshuffleRun;
        if (!r || !r.view) return null;
        const rect = canvas.getBoundingClientRect
            ? canvas.getBoundingClientRect()
            : null;
        const W = r.view.width();
        const H = r.view.height();
        if (rect) {
            return {
                x: (e.clientX - rect.left) * (W / (rect.width || W)),
                y: (e.clientY - rect.top) * (H / (rect.height || H)),
            };
        }
        if (typeof e.offsetX === "number") return { x: e.offsetX, y: e.offsetY };
        return { x: e.clientX, y: e.clientY };
    }

    canvas.addEventListener("mousedown", function (e) {
        if (!shellRef || shellRef.getScreen() !== "playing") return;
        const p = localXY(e);
        if (p) Board.handleMouseDown(p.x, p.y);
    });
    canvas.addEventListener("mousemove", function (e) {
        if (!shellRef || shellRef.getScreen() !== "playing") return;
        const p = localXY(e);
        if (p) Board.handleMouseMove(p.x, p.y);
    });
    canvas.addEventListener("mouseup", function (e) {
        if (!shellRef || shellRef.getScreen() !== "playing") return;
        const p = localXY(e);
        if (p) Board.handleMouseUp(p.x, p.y);
    });
}

function hsKey(mode) {
    if (mode === "timed") return "hsTimed";
    if (mode === "puzzle") return "hsPuzzle";
    return "hsClassic";
}

function persistHighScore(run) {
    if (!run || !run.save) return;
    const m = Board.getMode();
    const score = Board.getScore();
    if (score <= 0) return;
    const entry = {
        score: score,
        level: Board.getLevel(),
        chain: Board.getMaxChain(),
        date: dateISO(),
    };
    const key = hsKey(m);
    const list = (run.save.get(key) || []).slice();
    list.push(entry);
    list.sort(function (a, b) { return (b.score || 0) - (a.score || 0); });
    run.save.set(key, list.slice(0, 10));
    run.save.maybeHighScore(score);
    run.save.save();
}

function renderHighScores(api) {
    const tabs = { classic: "hs-tab-classic", timed: "hs-tab-timed", puzzle: "hs-tab-puzzle" };
    for (const k in tabs) {
        const el = document.getElementById(tabs[k]);
        if (el) el.className = k === hsMode ? "hs-tab active" : "hs-tab";
    }
    const list = api.save.get(hsKey(hsMode)) || [];
    const elList = document.getElementById("hs-list");
    if (!elList) return;
    if (!list.length) { elList.textContent = "No scores yet"; return; }
    const lines = [];
    for (let i = 0; i < list.length; i++) {
        const s = list[i];
        const rank = (i + 1 < 10 ? " " : "") + (i + 1) + ".";
        lines.push(rank + " " + s.score + "  Lv" + (s.level || 1) + "  x" + (s.chain || 1));
    }
    elList.textContent = lines.join("\n");
}

function renderSettings(api) {
    const el = function (id, v) {
        const n = document.getElementById(id);
        if (n) n.textContent = String(v);
    };
    const sfx = api.save.get("sfxVol");
    const drag = api.save.get("dragDead");
    el("opt-sfxVol", sfx != null ? sfx : 80);
    el("opt-dragDead", drag != null ? drag : 6);
    el("opt-showCursor", api.save.get("showCursor") === false ? "OFF" : "ON");
    el("opt-eyeTrack", api.save.get("eyeTrack") === false ? "OFF" : "ON");
}

function dateISO() {
    try { return new Date().toISOString().slice(0, 10); }
    catch (e) { return "----"; }
}

export function installTestHooks(shell) {
    shellRef = shell;

    const Screens = {
        switchTo: function (name) {
            if (name === "playing" || name === "play") {
                if (!shell.getRun()) {
                    preferredMode = preferredMode || "classic";
                    shell.startRun();
                } else {
                    shell.switchTo("playing");
                }
            } else if (name === "gameOver" || name === "gameover") {
                shell.switchTo("gameover");
            } else if (name === "modeSelect" || name === "mode-select") {
                shell.switchTo("modeselect");
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
        settings: function () { return Board.getSettings(); },
    };

    window.__fluffshuffle = {
        G: {
            Puffs: Puffs,
            Particles: Particles,
            Board: Board,
            Screens: Screens,
        },
        board: Board,
        puffs: Puffs,
        particles: Particles,
        screens: Screens,
        shell: shell,
    };
}
