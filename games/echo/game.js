// Echo — Simon-style memory pads, arcade plugin.
// Shell (/lib/arcade): screens, loop, pause, bindings, HUD plumbing, high
// score. Here: keys and clicks -> press, rules events -> pad tones.
//   rules.js   sequence, playback timing, echo checking
//   render.js  pads

import { bindPointer } from "/lib/arcade/pointer.js";
import { statsBlock, newBest } from "/lib/arcade/scores.js";
import { createEcho, step, press, drainEvents } from "/app/rules.js";
import { drawPads, padAt } from "/app/render.js";

const PAD_FREQS = [329.63, 415.3, 277.18, 220];

let api = null;

export const game = {
    id: "echo",
    clearColor: "#0a0e14",

    actions: [
        { name: "pad0", label: "Pad 1 (Red)", defaults: ["1", "q"] },
        { name: "pad1", label: "Pad 2 (Green)", defaults: ["2", "w"] },
        { name: "pad2", label: "Pad 3 (Yellow)", defaults: ["3", "a"] },
        { name: "pad3", label: "Pad 4 (Blue)", defaults: ["4", "s"] },
    ],

    init(shellApi) {
        api = shellApi;
        bindPointer(api, {
            down(p) {
                const run = api.getRun();
                const { w, h } = api.view.size();
                const pad = padAt(p.x, p.y, w, h);
                if (run && pad >= 0) press(run.echo, pad);
            },
        });
    },

    create(shellApi) {
        return { score: 0, echo: createEcho(), highScore: shellApi.highScore };
    },

    update(run, dt, input) {
        const e = run.echo;
        for (let i = 0; i < 4; i++) if (input.pressed("pad" + i)) { press(e, i); break; }
        step(e, dt);
        run.score = e.score;

        let result;
        for (const ev of drainEvents(e)) {
            if (ev.type === "flash") padTone(ev.pad, ev.dur / 1000);
            else if (ev.type === "press") padTone(ev.pad, 0.3);
            else if (ev.type === "wrong") {
                api.play("wrong");
                result = { status: "gameover" };
            }
        }
        return result;
    },

    draw(run, ctx, view) {
        const { w, h } = view.size();
        drawPads(ctx, run.echo.glow, w, h);
    },

    hud(run) {
        return {
            round: run ? run.echo.round : 0,
            status: run ? run.echo.status : "",
        };
    },

    gameOverText(run) {
        return statsBlock([
            ["Sequence", run.score + newBest(run)],
            ["Best", run.highScore()],
        ]);
    },

    cue(name, audio) {
        if (name === "wrong") audio.tone(110, 0.5, "sawtooth", 0.7);
    },
};

// A short triangle voice per pad, held for the flash.
function padTone(pad, dur) {
    const audio = api && api.audio;
    const actx = audio && audio.ctx();
    if (!actx) return;
    try {
        const id = actx.createVoice();
        actx.setVoiceWaveform(id, "triangle");
        actx.setVoiceFrequency(id, PAD_FREQS[pad]);
        actx.setVoiceGain(id, 12);
        actx.setVoiceAttack(id, 0.005);
        actx.setVoiceDecay(id, dur * 0.4);
        actx.setVoiceSustain(id, 0.6);
        actx.setVoiceRelease(id, 0.1);
        const t = actx.currentTime;
        actx.startVoice(id, t);
        actx.stopVoice(id, t + dur);
    } catch (err) { /* audio unavailable */ }
}
