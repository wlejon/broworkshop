// =============================================================================
// Arcade template — game plugin
// =============================================================================
//
// This file is the only place that should grow for a small game.
// Screens, loop, input rebinding, high scores, and pause are in /lib/arcade.
//
// Contract: /lib/arcade/README.md
//
// Demo behavior (delete when building a real game):
//   • A square drifts around the board.
//   • Space (primary) adds score.
//   • Run ends after 45s so you can exercise game-over + high score.

export const game = {
    /** Unique save / high-score namespace. Change this for every new game. */
    id: "arcade-template",

    /** Canvas clear color; usually matches --arcade-bg in theme.css. */
    clearColor: "#0a0a0c",

    // Optional: extra rebindable actions beyond the shell standards
    // (up/down/left/right/primary/secondary/pause/confirm).
    // actions: [
    //     { name: "bomb", label: "Bomb", defaults: ["b"] },
    // ],

    /**
     * Build a fresh run. Called on Play and Play Again.
     * @param {object} ctx — { audio, save, input, view, play, highScore, switchTo, getScreen }
     */
    create(ctx) {
        return {
            score: 0,
            elapsed: 0,
            x: 0.5,
            y: 0.5,
            vx: 0.00012,
            vy: 0.00009,
            play: ctx.play,
            highScore: ctx.highScore,
        };
    },

    /**
     * @param {object} run
     * @param {number} dt — milliseconds
     * @param {object} input — down(name) / pressed(name)
     * @returns {void | { status: "gameover" } | { status: "screen", name: string }}
     */
    update(run, dt, input) {
        run.elapsed += dt;
        run.x += run.vx * dt;
        run.y += run.vy * dt;
        if (run.x < 0.12 || run.x > 0.88) run.vx *= -1;
        if (run.y < 0.12 || run.y > 0.88) run.vy *= -1;

        if (input.pressed("primary")) {
            run.score += 1;
            run.play("score");
        }

        if (run.elapsed > 45000) {
            return { status: "gameover" };
        }
    },

    /**
     * @param {object} run
     * @param {CanvasRenderingContext2D} ctx
     * @param {{ size: () => { w: number, h: number }, width: Function, height: Function }} view
     */
    draw(run, ctx, view) {
        const { w, h } = view.size();
        const size = Math.min(w, h) * 0.08;
        const x = run.x * w - size / 2;
        const y = run.y * h - size / 2;

        // Soft grid so the playfield reads as intentional
        ctx.strokeStyle = "rgba(126, 200, 227, 0.06)";
        ctx.lineWidth = 1;
        const step = 48;
        ctx.beginPath();
        for (let gx = 0; gx < w; gx += step) {
            ctx.moveTo(gx + 0.5, 0);
            ctx.lineTo(gx + 0.5, h);
        }
        for (let gy = 0; gy < h; gy += step) {
            ctx.moveTo(0, gy + 0.5);
            ctx.lineTo(w, gy + 0.5);
        }
        ctx.stroke();

        ctx.fillStyle = "#7ec8e3";
        ctx.fillRect(x, y, size, size);
        ctx.fillStyle = "rgba(255, 255, 255, 0.25)";
        ctx.fillRect(x, y, size, 3);

        ctx.fillStyle = "rgba(232, 238, 242, 0.55)";
        ctx.font = "14px monospace";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText("Replace game.js with your game", w / 2, h * 0.18);
        ctx.fillText("Space  +1 score   ·   auto game-over at 45s", w / 2, h * 0.18 + 22);
    },

    /** Map of field → value; shell writes #hud-<field>. */
    hud(run) {
        return {
            score: run ? run.score : 0,
            best: run ? run.highScore() : 0,
        };
    },

    /** Text for #gameover-stats (plain text; newlines ok). */
    gameOverText(run) {
        const score = run ? run.score : 0;
        const best = run ? run.highScore() : 0;
        const tag = run && run._newBest ? "  ·  NEW BEST" : "";
        return "Score   " + score + tag + "\nBest    " + best;
    },

    /**
     * Game SFX only. Menu move/select tones are provided by the shell.
     * @param {string} name
     * @param {{ tone: Function, sequence: Function }} audio
     */
    cue(name, audio) {
        if (name === "score") audio.tone(720, 0.06, "square", 0.45);
    },
};
