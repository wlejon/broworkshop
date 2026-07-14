// Wordspire — letter-grid word builder on the arcade foundation.
// Domain: board.js, dictionary.js, scoring.js, particles.js, text.js.

import { Board } from "/app/board.js";
import { Dictionary } from "/app/dictionary.js";
import { Particles } from "/app/particles.js";
import { Scoring } from "/app/scoring.js";
import { Text } from "/app/text.js";

const LADDER = [261.63, 293.66, 329.63, 349.23, 392.0, 440.0, 493.88, 523.25, 587.33, 659.25, 783.99, 880.0];

let preferredMode = "classic";
let hsTab = "classic";
let mouseWired = false;
let shellRef = null;
let activeRun = null;
let bgT = 0;

export const game = {
    id: "wordspire",
    clearColor: "#0a0614",

    actions: [
        { name: "primary", label: "Add tile", defaults: [" "] },
        { name: "secondary", label: "Remove / clear", defaults: ["Backspace"] },
        { name: "confirm", label: "Submit", defaults: ["Enter"] },
    ],

    defaults: {
        highScore: 0,
        difficulty: 1,
        sfxVol: 80,
        musicVol: 60,
        hsClassic: [],
        hsTimed: [],
        hsPuzzle: [],
        topWords: [],
    },

    create(ctx) {
        Board.setPlay(function (name) { ctx.play(name); });
        Board.setSettings({
            difficulty: ctx.save.get("difficulty") != null ? ctx.save.get("difficulty") : 1,
        });
        Board.setOnWord(function (entry) {
            addTopWord(ctx.save, entry);
        });

        Board.startGame(preferredMode);
        Particles.clear && Particles.clear();

        wireMouse(ctx.view);

        const run = {
            score: 0,
            mode: preferredMode,
            play: ctx.play,
            highScore: ctx.highScore,
            save: ctx.save,
            view: ctx.view,
            ended: false,
        };
        activeRun = run;
        syncScore(run);
        return run;
    },

    update(run, dt, input) {
        activeRun = run;

        if (input.pressed("left")) Board.moveCursor(-1, 0);
        else if (input.pressed("right")) Board.moveCursor(1, 0);
        else if (input.pressed("up")) Board.moveCursor(0, -1);
        else if (input.pressed("down")) Board.moveCursor(0, 1);

        if (input.pressed("primary")) Board.keyAddAtCursor();
        if (input.pressed("confirm")) Board.submitChain();
        if (input.pressed("secondary")) Board.removeLastTile();

        Board.tick(dt);
        syncScore(run);

        if ((Board.isGameOver() || Board.isFinished()) && !run.ended) {
            run.ended = true;
            persistHighScore(run);
            if (Board.isFinished()) run.play("win");
            return { status: "gameover" };
        }
    },

    draw(run, ctx, view) {
        const { w: W, h: H } = view.size();
        drawBg(ctx, W, H);
        const sh = Particles.shakeOffset ? Particles.shakeOffset() : { x: 0, y: 0 };
        ctx.save();
        ctx.translate(sh.x, sh.y);
        Board.draw(ctx, W, H, performance.now());
        ctx.restore();
    },

    drawTitle(ctx, view) {
        const { w: W, h: H } = view.size();
        drawBg(ctx, W, H);
    },

    hud(run) {
        if (!run) {
            return { score: 0, level: 1, extra: 0, longest: "-", best: "-" };
        }
        Board.updateHUD();
        const st = Board.getStats();
        let extra = st.words;
        if (st.mode === "timed") {
            // Board.updateHUD already wrote the clock into #hud-extra
            const el = document.getElementById("hud-extra");
            extra = el ? el.textContent : "0:00";
        } else if (st.mode === "puzzle") {
            const el = document.getElementById("hud-extra");
            extra = el ? el.textContent : "1/20";
        }
        return {
            score: st.score,
            level: st.level,
            extra: extra,
            longest: st.longest ? st.longest.toUpperCase() : "-",
            best: st.bestWord
                ? (st.bestWord.toUpperCase() + " (" + st.bestWordScore + ")")
                : "-",
        };
    },

    gameOverText(run) {
        const st = Board.getStats();
        const title = document.querySelector("#screen-gameover .overlay-title");
        if (title) {
            title.textContent = st.finished
                ? st.mode.toUpperCase() + " COMPLETE!"
                : "GAME OVER";
        }
        const tag = run && run._newBest ? "\n* NEW HIGH SCORE *" : "";
        const lines = [
            "Mode: " + st.mode.toUpperCase(),
            "Score: " + st.score,
            "Words Played: " + st.words,
            "Longest: " + (st.longest ? st.longest.toUpperCase() : "-"),
            "Best: " + (st.bestWord ? (st.bestWord.toUpperCase() + " +" + st.bestWordScore) : "-"),
            "Time: " + formatTime(st.gameTime) + tag,
        ];
        return lines.join("\n");
    },

    onEnterScreen(name, run, api) {
        if (name === "highscores") {
            hsTab = "classic";
            renderHighScores(api);
        }
        if (name === "settings") {
            renderSettings(api);
        }
        if (name === "loading") {
            const el = document.getElementById("loading-status");
            if (el && !Dictionary.loaded()) el.textContent = "Reading dictionary...";
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
            const tabs = ["classic", "timed", "puzzle", "words"];
            const i = tabs.indexOf(hsTab);
            hsTab = tabs[(i + 1) % tabs.length];
            renderHighScores(api);
            return null;
        }

        if (action === "cycle-difficulty") {
            let d = api.save.get("difficulty");
            if (d == null) d = 1;
            d = (d + 1) % 3;
            api.save.set("difficulty", d);
            api.save.save();
            Board.setSettings({ difficulty: d });
            renderSettings(api);
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

        return null;
    },

    cue(name, audio) {
        if (name === "menu") audio.tone(420, 0.03, "sine", 0.3);
        else if (name === "select") audio.tone(620, 0.08, "square", 0.5);
        else if (name === "submit_fail") {
            audio.sequence([
                [220, 0.07, "sawtooth", 0.5],
                [160, 0.12, "sawtooth", 0.5],
            ]);
        } else if (name === "sizzle") audio.tone(90, 0.18, "sawtooth", 0.55);
        else if (name === "fanfare") {
            audio.sequence([
                [523.25, 0.08, "square", 0.7],
                [659.25, 0.08, "square", 0.7],
                [783.99, 0.08, "square", 0.8],
                [1046.5, 0.18, "square", 0.95],
            ]);
        } else if (name === "tile_remove") audio.tone(180, 0.04, "triangle", 0.3);
        else if (name === "clear_chain") audio.tone(130, 0.08, "sine", 0.3);
        else if (name === "gameover") {
            audio.sequence([
                [440, 0.18, "sawtooth", 0.6],
                [330, 0.18, "sawtooth", 0.55],
                [220, 0.30, "sawtooth", 0.6],
                [165, 0.40, "sawtooth", 0.55],
            ]);
        } else if (name === "win") {
            audio.sequence([
                [523, 0.08, "square", 0.7],
                [659, 0.08, "square", 0.7],
                [784, 0.08, "square", 0.7],
                [1047, 0.22, "square", 0.95],
            ]);
        } else if (name.indexOf("tile@") === 0) {
            const n = parseInt(name.slice(5), 10) || 1;
            const i = Math.min(LADDER.length - 1, Math.max(0, n));
            audio.tone(LADDER[i], 0.06, "triangle", 0.45);
        } else if (name.indexOf("submit@") === 0) {
            const length = parseInt(name.slice(7), 10) || 3;
            const base = Math.min(7, Math.max(0, length - 3));
            audio.sequence([
                [LADDER[base], 0.06, "square", 0.55],
                [LADDER[base + 2], 0.06, "square", 0.55],
                [LADDER[base + 4] || LADDER[LADDER.length - 1], 0.10, "square", 0.65],
            ]);
        }
    },
};

function syncScore(run) {
    if (run) run.score = Board.getScore();
}

function drawBg(ctx, Wd, Hd) {
    bgT += 16;
    const g = ctx.createLinearGradient(0, 0, 0, Hd);
    g.addColorStop(0, "#120a24");
    g.addColorStop(1, "#050210");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, Wd, Hd);

    const glyphs = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
    for (let i = 0; i < 22; i++) {
        const x = ((i * 97 + bgT * 0.04) % (Wd + 120)) - 60;
        const y = ((i * 151 + bgT * 0.03) % (Hd + 60));
        ctx.globalAlpha = 0.05 + (i % 5) * 0.015;
        const col = i % 3 === 0 ? "#e8c168" : (i % 3 === 1 ? "#8cdff6" : "#c8b8e8");
        Text.drawCentered(ctx, glyphs.charAt(i % glyphs.length),
            Math.floor(x), Math.floor(y), 6, col);
    }
    ctx.globalAlpha = 1.0;
}

function wireMouse(view) {
    if (!view || !view.canvas || mouseWired) return;
    mouseWired = true;
    const canvas = view.canvas;

    function localXY(e) {
        const rect = canvas.getBoundingClientRect ? canvas.getBoundingClientRect() : null;
        const W = view.width();
        const H = view.height();
        if (rect) {
            return {
                x: (e.clientX - rect.left) * (W / (rect.width || W)),
                y: (e.clientY - rect.top) * (H / (rect.height || H)),
            };
        }
        return { x: e.offsetX || e.clientX, y: e.offsetY || e.clientY };
    }

    canvas.addEventListener("click", function (e) {
        if (!shellRef || shellRef.getScreen() !== "playing") return;
        const p = localXY(e);
        Board.mouseClick(p.x, p.y);
    });
    canvas.addEventListener("dblclick", function (e) {
        if (!shellRef || shellRef.getScreen() !== "playing") return;
        const p = localXY(e);
        Board.mouseDblClick(p.x, p.y);
    });
}

function hsKey(mode) {
    if (mode === "timed") return "hsTimed";
    if (mode === "puzzle") return "hsPuzzle";
    return "hsClassic";
}

function persistHighScore(run) {
    if (!run || !run.save) return;
    const st = Board.getStats();
    const entry = {
        score: st.score,
        words: st.words,
        longest: st.longest,
        best: st.bestWord,
        bestScore: st.bestWordScore,
        time: Math.floor(st.gameTime),
        date: dateISO(),
    };
    const key = hsKey(st.mode);
    const list = (run.save.get(key) || []).slice();
    list.push(entry);
    list.sort(function (a, b) { return (b.score || 0) - (a.score || 0); });
    run.save.set(key, list.slice(0, 10));
    run.save.maybeHighScore(st.score);
    run.save.save();
}

function addTopWord(save, entry) {
    if (!save || !entry) return;
    const list = (save.get("topWords") || []).slice();
    list.push(entry);
    list.sort(function (a, b) { return (b.score || 0) - (a.score || 0); });
    save.set("topWords", list.slice(0, 10));
    save.save();
}

function renderHighScores(api) {
    const tabs = ["classic", "timed", "puzzle", "words"];
    for (let i = 0; i < tabs.length; i++) {
        const t = document.getElementById("hs-tab-" + tabs[i]);
        if (t) t.className = tabs[i] === hsTab ? "hs-tab active" : "hs-tab";
    }
    const out = document.getElementById("hs-list");
    if (!out) return;
    if (hsTab === "words") {
        const tw = api.save.get("topWords") || [];
        if (!tw.length) { out.textContent = "No words yet"; return; }
        out.textContent = tw.map(function (e, i) {
            let rank = (i + 1) + ".";
            if (i < 9) rank = " " + rank;
            return rank + " " + (e.word || "").toUpperCase() +
                "  +" + (e.score || 0) + " (" + (e.mode || "?") + ")";
        }).join("\n");
        return;
    }
    const list = api.save.get(hsKey(hsTab)) || [];
    if (!list.length) { out.textContent = "No scores yet"; return; }
    out.textContent = list.map(function (e, i) {
        let rank = (i + 1) + ".";
        if (i < 9) rank = " " + rank;
        return rank + " " + (e.score || 0) +
            "  Words:" + (e.words || 0) +
            "  Best:" + ((e.best || "-").toUpperCase());
    }).join("\n");
}

function renderSettings(api) {
    const labels = ["Easy", "Normal", "Hard"];
    const d = api.save.get("difficulty");
    const sfx = api.save.get("sfxVol");
    const elD = document.getElementById("opt-difficulty");
    const elS = document.getElementById("opt-sfxVol");
    if (elD) elD.textContent = labels[d != null ? d : 1] || "Normal";
    if (elS) elS.textContent = String(sfx != null ? sfx : 80);
}

function formatTime(ms) {
    const s = Math.floor(ms / 1000);
    const m = Math.floor(s / 60);
    const sec = s % 60;
    return m + ":" + (sec < 10 ? "0" : "") + sec;
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
    };

    window.__wordspire = {
        W: {
            Board: Board,
            Dictionary: Dictionary,
            Scoring: Scoring,
            Particles: Particles,
            Text: Text,
            Screens: Screens,
        },
        board: Board,
        dictionary: Dictionary,
        scoring: Scoring,
        storage: {
            settings: {},
            qualifies: function () { return true; },
            add: function () {},
            list: function () { return []; },
            topWords: function () { return shell.api.save.get("topWords") || []; },
        },
        screens: Screens,
        particles: Particles,
        shell: shell,
        step: function (dt) { Board.tick(dt || 16); },
        setGrid: function (letters) { Board.setGridTest(letters); },
        playPath: function (path) { return Board.playWordByPath(path); },
        forceBurn: function (c, r) { Board.forceBurnAt(c, r); },
        isValidPath: Board.isValidPath,
        computeWordScore: Scoring.computeWordScore,
        dictLookup: function (w) { return Dictionary.isWord(w); },
        settle: Board.settle,
        findMatches: function (n) { return Board.findMatches(n); },
    };
}
