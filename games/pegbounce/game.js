// Pegbounce — peg-clearing physics pachinko on the arcade shell.
// Shell owns screens, loop, pause, HUD plumbing. A run is one level attempt:
// clearing it shows the "clear" screen, running out of balls ends the run
// (the shell's game-over screen, dressed as "Level Failed").
// Rules: rules.js · session: round.js · physics: physics.js · levels.js ·
// guides.js · drawing: render.js · menu screens: screens.js

import { createEffects } from "/lib/arcade/effects.js";
import { bindPointer } from "/lib/arcade/pointer.js";
import { createOptions, sfxVolume, toggle } from "/lib/arcade/options.js";
import { Levels } from "/app/levels.js";
import { Guides } from "/app/guides.js";
import { Round } from "/app/round.js";
import { starCount, starString, ladder } from "/app/rules.js";
import { drawRound, drawTitleField, fieldFit, toField } from "/app/render.js";
import { buildScreens, refreshLevelGrid, markGuide, renderBestList } from "/app/screens.js";

const SCREENS = ["levels", "guide", "highscores", "settings", "credits"];

const fx = createEffects({
    particle: "dot",
    burst: { speed: 72, speedVar: 108, up: 0, life: 500, lifeVar: 300, size: 4, sizeVar: 4, drag: 0.97, spin: 0 },
});

// Menu-level choices (not session state): the level and guide the next run uses.
export const menu = { levelIdx: 0, guideId: "wingtip" };
let options = null;
let titleClock = 0;

export const game = {
    id: "pegbounce",
    clearColor: "#04060c",

    defaults: {
        highScore: 0,
        sfxVol: 80,
        unlocked: 1,
        best: {},
        stars: {},
        selectedGuide: "wingtip",
        trajectory: true,
        screenshake: true,
    },

    init(api) {
        menu.guideId = api.save.get("selectedGuide") || "wingtip";
        buildScreens();
        options = createOptions(api, [
            toggle("trajectory", "toggle-trajectory"),
            toggle("screenshake", "toggle-screenshake"),
            sfxVolume(),
        ]);
        options.applyAll();
        bindPointer(api, {
            move(p) {
                const run = api.getRun();
                if (!run) return;
                const f = toField(fieldFit(api.view.width(), api.view.height()), p.x, p.y);
                run.round.aimAt(f.x, f.y);
            },
        });
    },

    create(api) {
        fx.clear();
        if (api.getRun()) api.getRun().round.destroy();
        return {
            score: 0,
            save: api.save,
            play: api.play,
            round: new Round({ levelIdx: menu.levelIdx, guideId: menu.guideId, fx: roundFx(api) }),
        };
    },

    update(run, dt, input) {
        const r = run.round;
        const sec = Math.min(0.033, dt / 1000);
        if (input.down("left")) r.turn(-1, sec);
        if (input.down("right")) r.turn(1, sec);
        if (input.pressed("primary")) r.launch();

        r.step(sec);
        fx.update(dt);
        run.score = r.score;
        showCombo(r);

        if (r.status === "clear") {
            recordClear(run);
            run.play("levelclear");
            return { status: "screen", name: "clear" };
        }
        if (r.status === "fail") {
            run.play("levelfail");
            return { status: "gameover" };
        }
    },

    draw(run, ctx, view) {
        const { w, h } = view.size();
        const shake = options.get("screenshake") ? fx.shakeOffset() : { x: 0, y: 0 };
        drawRound(ctx, w, h, run.round, {
            shake,
            trajectory: options.get("trajectory"),
            overlay: (c) => fx.draw(c),
        });
    },

    drawTitle(ctx, view) {
        const { w, h } = view.size();
        titleClock += 1 / 60;
        drawTitleField(ctx, w, h, Levels.LEVELS[0].background, titleClock);
    },

    hud(run) {
        if (!run) return { score: 0, balls: 0, orange: 0, mult: "x1", guide: "—", level: "—" };
        const r = run.round;
        return {
            score: r.shownScore,
            balls: r.balls,
            orange: r.remainingOrange(),
            mult: "x" + r.mult,
            guide: r.guide.name,
            level: (r.levelIdx + 1) + " — " + r.level.name,
        };
    },

    // The run ends only on a failed level.
    gameOverText(run) {
        const r = run.round;
        return (
            "Level    " + (r.levelIdx + 1) + " — " + r.level.name + "\n" +
            "Cleared  " + (r.totalOrangeStart - r.remainingOrange()) + " of " + r.totalOrangeStart + " orange pegs\n" +
            "Score    " + r.score + (run._newBest ? "  ·  NEW BEST" : "")
        );
    },

    onEnterScreen(name, run, api) {
        if (name === "levels") refreshLevelGrid(api.save);
        if (name === "guide") markGuide(menu.guideId);
        if (name === "highscores") renderBestList(api.save);
        if (name === "settings") options.render();
        if (name === "clear") fillClear(run);
        if (name === "clear" || name === "gameover") fx.clear();    // drops lingering toasts
        if (name !== "playing") showCombo(null);
    },

    onMenuAction(action, run, api) {
        const level = /^level-(\d+)$/.exec(action);
        if (level) {
            menu.levelIdx = +level[1];
            return "guide";
        }
        const guide = /^guide-(\w+)$/.exec(action);
        if (guide) {
            chooseGuide(api.save, guide[1]);
            return null;
        }
        if (action === "startlevel") return { startRun: true };
        if (action === "next" && run) {
            menu.levelIdx = Math.min(run.round.levelIdx + 1, Levels.LEVELS.length - 1);
            return "guide";
        }
        if (options.handle(action)) return null;
        return SCREENS.includes(action) ? action : null;
    },

    // Game SFX only — menu move/select are shell-owned.
    cue(name, audio) {
        const at = name.indexOf("@");
        if (at > 0) {
            const step = parseInt(name.slice(at + 1), 10) || 0;
            if (name.startsWith("orange")) audio.tone(ladder(step) * 1.5, 0.12, "square", 0.5);
            else audio.tone(ladder(step), 0.06, "triangle", 0.45);
            return;
        }
        const seq = CUES[name];
        if (seq) audio.sequence(seq);
    },
};

// ── Sound ─────────────────────────────────────────────────────────────────

const CUES = {
    launch: [[480, 0.09, "triangle", 0.45]],
    wall: [[140, 0.03, "square", 0.2]],
    green: [[660, 0.06, "triangle", 0.55], [880, 0.08, "triangle", 0.55], [1320, 0.1, "square", 0.6]],
    purple: [[520, 0.06, "sawtooth", 0.45], [780, 0.08, "sawtooth", 0.5]],
    catch: [[700, 0.06, "square", 0.5], [950, 0.06, "square", 0.55], [1250, 0.1, "triangle", 0.6]],
    levelclear: [[523, 0.1, "square", 0.55], [659, 0.1, "square", 0.6], [784, 0.1, "square", 0.65], [1047, 0.2, "triangle", 0.7]],
    levelfail: [[250, 0.15, "sawtooth", 0.5], [180, 0.2, "sawtooth", 0.55]],
    fever: [[330, 0.08, "sawtooth", 0.5], [440, 0.08, "sawtooth", 0.55], [660, 0.08, "square", 0.6], [880, 0.18, "square", 0.7]],
};

// ── Wiring ────────────────────────────────────────────────────────────────

/** Round effects (field coordinates) -> the effects layer, DOM toasts, sound. */
function roundFx(api) {
    return {
        cue: (name) => api.play(name),
        burst: (x, y, color, n, speed) => fx.burst(x, y, color, n, { speed: speed * 0.4, speedVar: speed * 0.6 }),
        toast: (text) => fx.toast("#pb-toast", text, 1000),
        fever: (text) => fx.toast("#fever-text", text, 1800),
        shake: () => fx.shake(500, 8),
    };
}

function chooseGuide(save, id) {
    menu.guideId = Guides.byId(id).id;
    save.set("selectedGuide", menu.guideId);
    save.save();
    markGuide(menu.guideId);
}

/** Per-level best + stars, unlock the next level, and the overall best. */
function recordClear(run) {
    const r = run.round;
    const save = run.save;
    const id = r.level.id;
    const best = Object.assign({}, save.get("best"));
    const stars = Object.assign({}, save.get("stars"));
    if (r.score > (best[id] || 0)) best[id] = r.score;
    stars[id] = Math.max(stars[id] || 0, starCount(r.score, r.level.stars));
    save.set("best", best);
    save.set("stars", stars);
    save.set("unlocked", Math.min(Levels.LEVELS.length, Math.max(save.get("unlocked") || 1, r.levelIdx + 2)));
    // A clear does not end the shell run, so the overall best is recorded here.
    run._newBest = save.maybeHighScore(r.score);
    save.save();
}

function fillClear(run) {
    if (!run) return;
    const r = run.round;
    document.getElementById("clear-stats").textContent =
        "Level " + (r.levelIdx + 1) + " — " + r.level.name + "\n" +
        "Score: " + r.score + (run._newBest ? "  ·  NEW BEST" : "") + "\n" +
        "Balls used: " + (r.ballsStart - r.balls);
    document.getElementById("clear-stars").textContent = starString(starCount(r.score, r.level.stars));
}

function showCombo(round) {
    const el = document.getElementById("combo-text");
    const on = !!round && round.shotInProgress && round.hits > 4;
    if (on) el.textContent = "COMBO ×" + round.hits;
    el.style.display = on ? "block" : "none";
}
