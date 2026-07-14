// Echo — Simon-style memory pads (arcade plugin).
// Rules, drawing, and cues only. Screens / loop / input shell: /lib/arcade.

const PAD_COLORS = [
    { dim: "#7a1f22", lit: "#ff5a5f", glow: "#ff8a8f" },
    { dim: "#1f6f2a", lit: "#4ade80", glow: "#86f0b0" },
    { dim: "#7a6520", lit: "#f0c674", glow: "#ffe0a0" },
    { dim: "#1f3a7a", lit: "#5b8def", glow: "#9abbff" },
];
const PAD_FREQS = [329.63, 415.3, 277.18, 220];

const GLOW_DECAY = 3; // units per second
const WATCH_LEAD_MS = 600;
const ROUND_PAUSE_MS = 700;

export const game = {
    id: "echo",
    clearColor: "#0a0e14",

    actions: [
        { name: "pad0", label: "Pad 1 (Red)", defaults: ["1", "q"] },
        { name: "pad1", label: "Pad 2 (Green)", defaults: ["2", "w"] },
        { name: "pad2", label: "Pad 3 (Yellow)", defaults: ["3", "a"] },
        { name: "pad3", label: "Pad 4 (Blue)", defaults: ["4", "s"] },
    ],

    create(ctx) {
        const run = {
            score: 0, // longest completed sequence (high-score table)
            round: 0,
            sequence: [],
            playerStep: 0,
            phase: "watch", // watch | input | dead
            padGlow: [0, 0, 0, 0],
            watchIndex: 0,
            status: "WATCH",
            play: ctx.play,
            highScore: ctx.highScore,
            audio: ctx.audio,
            view: ctx.view,
            timers: [],
            ended: false,
        };
        attachPointer(run);
        nextRound(run);
        return run;
    },

    update(run, dt, input) {
        if (run.ended) return { status: "gameover" };

        const decay = (dt / 1000) * GLOW_DECAY;
        for (let i = 0; i < 4; i++) {
            run.padGlow[i] = Math.max(0, run.padGlow[i] - decay);
        }

        if (run.phase === "input") {
            if (input.pressed("pad0")) handlePress(run, 0);
            else if (input.pressed("pad1")) handlePress(run, 1);
            else if (input.pressed("pad2")) handlePress(run, 2);
            else if (input.pressed("pad3")) handlePress(run, 3);
        }

        if (run.ended) return { status: "gameover" };
    },

    draw(run, ctx, view) {
        const { w, h } = view.size();
        for (let i = 0; i < 4; i++) {
            drawPad(ctx, i, w, h, run.padGlow[i]);
        }
    },

    hud(run) {
        return {
            round: run ? run.round : 0,
            best: run ? run.highScore() : 0,
            status: run ? run.status : "",
        };
    },

    gameOverText(run) {
        const reached = run ? Math.max(0, run.round - 1) : 0;
        const best = run ? run.highScore() : 0;
        const tag = run && run._newBest ? "  ·  NEW BEST" : "";
        return (
            "Sequence " + reached + tag + "\n" +
            "Best     " + best
        );
    },

    cue(name, audio) {
        if (name === "wrong") {
            audio.tone(110, 0.5, "sawtooth", 0.7);
        } else if (name.indexOf("pad") === 0) {
            const idx = parseInt(name.slice(3), 10);
            if (idx >= 0 && idx < 4) playPadTone(audio, idx, 0.3);
        }
    },
};

// ── Pointer ──────────────────────────────────────────────────────────────

/** One mousedown listener per canvas; always targets the latest run. */
function attachPointer(run) {
    const canvas = run.view && run.view.canvas;
    if (!canvas) return;
    canvas._echoRun = run;
    if (canvas._echoPointer) return;
    canvas._echoPointer = (ev) => {
        const r = canvas._echoRun;
        if (!r || r.phase !== "input" || r.ended || !r.view) return;
        const { w, h } = r.view.size();
        let mx, my;
        if (canvas.getBoundingClientRect) {
            const rect = canvas.getBoundingClientRect();
            const sx = w / (rect.width || w);
            const sy = h / (rect.height || h);
            mx = (ev.clientX - rect.left) * sx;
            my = (ev.clientY - rect.top) * sy;
        } else {
            mx = ev.offsetX != null ? ev.offsetX : ev.clientX;
            my = ev.offsetY != null ? ev.offsetY : ev.clientY;
        }
        const pad = padAt(mx, my, w, h);
        if (pad >= 0) handlePress(r, pad);
    };
    canvas.addEventListener("mousedown", canvas._echoPointer);
}

// ── Sequence ─────────────────────────────────────────────────────────────

function schedule(run, fn, ms) {
    const id = setTimeout(fn, ms);
    run.timers.push(id);
    return id;
}

function clearTimers(run) {
    for (let i = 0; i < run.timers.length; i++) clearTimeout(run.timers[i]);
    run.timers = [];
}

function nextRound(run) {
    run.round++;
    run.sequence.push(Math.floor(Math.random() * 4));
    run.playerStep = 0;
    run.phase = "watch";
    run.status = "WATCH";
    run.watchIndex = 0;
    schedule(run, () => playWatchStep(run), WATCH_LEAD_MS);
}

function flashDuration(run) {
    let base = 600 - (run.sequence.length - 1) * 25;
    if (base < 220) base = 220;
    return base;
}

function playWatchStep(run) {
    if (run.ended || run.phase !== "watch") return;
    if (run.watchIndex >= run.sequence.length) {
        run.phase = "input";
        run.status = "YOUR TURN";
        return;
    }
    const padIdx = run.sequence[run.watchIndex];
    const dur = flashDuration(run);
    flashPad(run, padIdx, dur / 1000);
    run.watchIndex++;
    const gap = Math.max(80, Math.floor(dur * 0.35));
    schedule(run, () => playWatchStep(run), dur + gap);
}

function flashPad(run, padIdx, durSec) {
    run.padGlow[padIdx] = 1;
    playPadTone(run.audio, padIdx, durSec);
}

function playPadTone(audio, padIdx, durSec) {
    if (!audio || !audio.ctx()) return;
    const actx = audio.ctx();
    const freq = PAD_FREQS[padIdx];
    const dur = durSec || 0.35;
    try {
        const id = actx.createVoice();
        actx.setVoiceWaveform(id, "triangle");
        actx.setVoiceFrequency(id, freq);
        actx.setVoiceGain(id, 12);
        actx.setVoiceAttack(id, 0.005);
        actx.setVoiceDecay(id, dur * 0.4);
        actx.setVoiceSustain(id, 0.6);
        actx.setVoiceRelease(id, 0.1);
        const t = actx.currentTime;
        actx.startVoice(id, t);
        actx.stopVoice(id, t + dur);
    } catch (e) { /* ignore */ }
}

// ── Input ────────────────────────────────────────────────────────────────

function handlePress(run, padIdx) {
    if (run.phase !== "input" || run.ended) return;
    flashPad(run, padIdx, 0.3);

    if (run.sequence[run.playerStep] === padIdx) {
        run.playerStep++;
        if (run.playerStep >= run.sequence.length) {
            run.phase = "watch";
            run.status = "NICE!";
            run.score = run.round;
            schedule(run, () => nextRound(run), ROUND_PAUSE_MS);
        }
    } else {
        fail(run);
    }
}

function fail(run) {
    run.ended = true;
    run.phase = "dead";
    run.status = "WRONG";
    run.score = Math.max(0, run.round - 1);
    run.play("wrong");
    clearTimers(run);
}

// ── Draw ─────────────────────────────────────────────────────────────────

function drawPad(ctx, padIdx, w, h, glow) {
    const r = padRect(padIdx, w, h);
    const col = PAD_COLORS[padIdx];
    ctx.fillStyle = lerpColor(col.dim, col.glow, glow);
    roundRect(ctx, r.x, r.y, r.w, r.h, 24);
    ctx.fill();
    if (glow > 0.02) {
        ctx.save();
        ctx.globalAlpha = glow * 0.5;
        ctx.strokeStyle = col.glow;
        ctx.lineWidth = 6;
        roundRect(ctx, r.x - 2, r.y - 2, r.w + 4, r.h + 4, 26);
        ctx.stroke();
        ctx.restore();
    }
    ctx.strokeStyle = "#0a0e14";
    ctx.lineWidth = 4;
    roundRect(ctx, r.x, r.y, r.w, r.h, 24);
    ctx.stroke();
}

function padRect(padIdx, w, h) {
    const margin = 60;
    const gap = 16;
    const topOffset = 120;
    const bottomOffset = 40;
    const boardW = w - margin * 2;
    const boardH = h - topOffset - bottomOffset;
    const padW = (boardW - gap) / 2;
    const padH = (boardH - gap) / 2;
    const col = padIdx % 2;
    const row = Math.floor(padIdx / 2);
    return {
        x: margin + col * (padW + gap),
        y: topOffset + row * (padH + gap),
        w: padW,
        h: padH,
    };
}

function padAt(mx, my, w, h) {
    for (let i = 0; i < 4; i++) {
        const r = padRect(i, w, h);
        if (mx >= r.x && mx < r.x + r.w && my >= r.y && my < r.y + r.h) return i;
    }
    return -1;
}

function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
}

function lerpColor(a, b, t) {
    if (t <= 0) return a;
    if (t >= 1) return b;
    const ar = parseInt(a.substr(1, 2), 16);
    const ag = parseInt(a.substr(3, 2), 16);
    const ab = parseInt(a.substr(5, 2), 16);
    const br = parseInt(b.substr(1, 2), 16);
    const bg = parseInt(b.substr(3, 2), 16);
    const bb = parseInt(b.substr(5, 2), 16);
    const r = Math.round(ar + (br - ar) * t);
    const g = Math.round(ag + (bg - ag) * t);
    const bl = Math.round(ab + (bb - ab) * t);
    return "rgb(" + r + "," + g + "," + bl + ")";
}
