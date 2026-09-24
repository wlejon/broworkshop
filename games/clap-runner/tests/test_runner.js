// Clap Runner headless test: the clap / whistle detector, the runner's
// physics and scoring, keyboard play through the shell, the mic feed path
// (bro.mic.feed -> detector -> moves), settings, pause and game over.
// Run: scripts/validate.sh games/clap-runner
import { check, eq, press, text, q, frames, shot } from "/lib/kit/test.js";

advanceTime(200);
const C = window.CLAP;
check(C && C.Runner && C.createDetector, 'CLAP test surface exposed');
eq(C.screen, 'title', 'boots on the title');
check(q('#hud').style.display !== 'none', 'HUD cards show over the title');
eq(text('#hud-score'), '0', 'score card');
eq(text('#hud-multiplier'), '1X', 'multiplier card');
// Clean save: the app's storage survives between runs.
for (const [k, v] of Object.entries({ highScore: 0, clapThreshold: 0.28, whistleMinHz: 700, sfxVol: 80 })) C.save.set(k, v);
C.save.save();
C.options.applyAll();
shot('title');

// ── Detector (pure) ────────────────────────────────────────────────────────

{
    const d = C.createDetector();
    const quiet = { peak: 0.02 };
    const clap = { peak: 0.6 };
    let t = 0;
    const run = (frame, n) => { for (let i = 0; i < n; i++) { d.feed(frame, t); t += 10; } };

    run(quiet, 20);
    eq(d.drain().length, 0, 'silence: no actions');
    run(clap, 1);
    const one = d.drain();
    check(one.length === 1 && one[0].action === 'jump', 'a clap jumps at once');
    eq(d.telemetry.lastGesture, 'SINGLE CLAP (JUMP)', 'telemetry names the gesture');
    eq(d.telemetry.onsets, 1, 'onset counted');

    run(quiet, 50);
    run(clap, 1); run(quiet, 19); run(clap, 1);   // 200 ms apart
    run(quiet, 30);
    const two = d.drain();
    eq(two.map((e) => e.action).join(','), 'jump,superJump', 'double clap -> jump then super jump');
    check(two[1].interval === 200, 'double clap interval 200 ms');
    run(clap, 1); run(quiet, 19); run(clap, 1); run(quiet, 19); run(clap, 1);
    eq(d.drain().map((e) => e.action).join(','), 'jump,superJump,jump', 'a third clap starts over');
    run(quiet, 50);

    run(quiet, 50);
    run(clap, 2);                                   // 10 ms apart: debounced
    run(quiet, 30);
    const deb = d.drain();
    check(deb.length === 1 && deb[0].action === 'jump', 'onsets inside 90 ms count once');

    run(quiet, 50);
    run(clap, 1); run(quiet, 59); run(clap, 1);    // 600 ms apart: two singles
    run(quiet, 30);
    eq(d.drain().map((e) => e.action).join(','), 'jump,jump', 'slow claps are two jumps');

    d.clapThreshold = 0.8;
    run(clap, 1); run(quiet, 30);
    eq(d.drain().length, 0, 'clap under a raised threshold is ignored');
    d.clapThreshold = 0.28;

    const whistle = { peak: 0.1, tonal: true, pitchHz: 1200 };
    run(whistle, 2);
    check(!d.glideActive, 'two tonal frames are not yet a whistle');
    run(whistle, 1);
    check(d.glideActive, 'three tonal frames start a glide');
    eq(d.drain().map((e) => e.action).join(','), 'glide', 'glide action');
    run({ peak: 0.1, tonal: true, pitchHz: 400 }, 3);
    check(!d.glideActive, 'a tone under whistleMinHz lets the glide go');
    eq(d.drain().map((e) => e.action).join(','), 'glideEnd', 'glide end');

    d.gesture('double-clap', 0.9);
    d.gesture('whistle-up', 0.8);
    d.gesture('snap', 0.7);
    d.gesture('knock', 0.6);
    eq(d.drain().map((e) => e.action).join(','), 'superJump,glide,slide,jump', 'template names route to moves');
}

// ── Runner (pure) ──────────────────────────────────────────────────────────

{
    const cues = [];
    const quietFx = { cue: (n) => cues.push(n), emit() {}, text() {} };
    const mk = () => { const r = new C.Runner({ fx: quietFx, rand: () => 0.5 }); r.nextSpawn = 1e9; return r; };
    const G = C.GROUND_Y;

    const r = mk();
    check(r.jump(), 'jump from the ground');
    r.step(0.05);
    check(r.player.y < G && !r.player.grounded, 'airborne after a jump');
    check(!r.jump(), 'no second jump mid-air');
    let peak = G;
    for (let i = 0; i < 100 && !r.player.grounded; i++) { r.step(1 / 60); peak = Math.min(peak, r.player.y); }
    check(r.player.grounded, 'lands again');
    check(G - peak > 110 && G - peak < 140, 'jump apex ~125 px (' + Math.round(G - peak) + ')');

    const s = mk();
    s.superJump();
    let speak = G;
    for (let i = 0; i < 120 && (i < 2 || !s.player.grounded); i++) { s.step(1 / 60); speak = Math.min(speak, s.player.y); }
    check(G - speak > 240, 'super jump apex ~260 px (' + Math.round(G - speak) + ')');

    const g = mk();
    g.superJump();
    for (let i = 0; i < 40; i++) g.step(1 / 60);
    g.glideStart();
    for (let i = 0; i < 30; i++) g.step(1 / 60);
    check(g.player.gliding && g.player.vy <= 120, 'glide caps the fall at 120 px/s');
    g.glideEnd();
    check(!g.player.gliding && cues.includes('glideStop'), 'glide end cues the hum off');

    // Slide ducks under the overhead laser; standing tall hits it.
    const low = mk();
    low.spawnWave('HIGH_LASER');
    low.obstacles[0].x = low.player.x - 10;
    check(low.hits(low.obstacles[0]), 'standing runner hits the laser');
    low.slideStart();
    check(!low.hits(low.obstacles[0]), 'sliding runner passes under it');

    // Spikes crash an unshielded runner; a shield absorbs one hit.
    const sh = mk();
    sh.player.shield = true;
    sh.spawnWave('SPIKE_BARRIER');
    sh.obstacles[0].x = sh.player.x;
    check(!sh.step(1 / 60), 'shield absorbs the spikes');
    check(!sh.player.shield && sh.player.invincible > 0, 'shield spent, brief invincibility');
    const cr = mk();
    cr.spawnWave('SPIKE_BARRIER');
    cr.obstacles[0].x = cr.player.x;
    check(cr.step(1 / 60) && cr.crashed, 'spikes crash the runner');
    check(cues.includes('gameOver'), 'crash cues game over');

    // Coins score x multiplier; every 5th obstacle passed raises it.
    const sc = mk();
    sc.addPickup('COIN', sc.player.x, G - 34, 12);
    sc.step(1 / 60);
    check(sc.coins === 1 && sc.score >= 100, 'coin grabbed (+100)');
    for (let i = 0; i < 5; i++) {
        const o = sc.addObstacle('SPIKE_BARRIER', sc.player.x - 200, G - 42, 46, 42, '#f05');
        o.passed = false;
    }
    sc.step(1 / 60);
    eq(sc.streak, 5, 'five obstacles passed');
    eq(sc.multiplier, 2, 'streak of 5 -> 2X');
    const m = mk();
    m.addPickup('MULTIPLIER', m.player.x, G - 34, 16);
    m.step(1 / 60);
    eq(m.multiplier, 2, '+1X pickup');
    m.addPickup('SHIELD', m.player.x, G - 34, 16);
    m.step(1 / 60);
    check(m.player.shield, 'shield pickup');
}

// ── Keyboard play ──────────────────────────────────────────────────────────

press('Enter');
frames(2);
eq(C.screen, 'playing', 'START RUN starts a run');
const r = C.runner;
r.nextSpawn = 1e9;          // no random obstacles while the controls are checked
r.obstacles.length = 0;
r.pickups.length = 0;

press(' ');
frames(2);
check(!r.player.grounded, 'Space jumps');
eq(text('#gestureBadge'), 'JUMP', 'badge names the move');
check(q('#gestureBadge').classList.contains('fired'), 'badge lit');
frames(60);
check(r.player.grounded, 'landed');
press(' ');
frames(6);                  // ~96 ms later
press(' ');
frames(1);
check(r.player.superJumping, 'double tap Space -> super jump');
eq(text('#gestureBadge'), 'SUPER JUMP', 'super jump badge');
keyDown(101);               // hold E
frames(3);
check(r.player.gliding, 'holding E glides');
keyUp(101);
frames(2);
check(!r.player.gliding, 'releasing E ends the glide');
frames(90);
check(r.player.grounded, 'back on the ground');
keyDown(115);               // S
frames(2);
check(r.player.sliding, 'S slides');
keyUp(115);
frames(1);
check(!r.player.sliding, 'releasing S stands up');
check(r.score > 0 && text('#hud-score') === r.score.toLocaleString(), 'HUD tracks the score (' + text('#hud-score') + ')');
check(/^\d+ m$/.test(text('#hud-distance')), 'distance card');
shot('play');

// ── Mic feed path: bro.mic.feed -> detector -> runner ─────────────────────

if (typeof bro !== 'undefined' && bro.mic && bro.mic.available !== false) {
    check(C.mic.start({ live: false }), 'mic starts in feed mode');
    const er = bro.mic.engineRate();
    const pcm = (ms, fill) => { const a = new Float32Array(Math.round(er * ms / 1000)); for (let i = 0; i < a.length; i++) a[i] = fill(i / er); return a; };
    const silence = (ms) => pcm(ms, () => 0);
    // A clap: 4 ms of decaying noise (seeded, so it is the same every run).
    let seed = 12345;
    const noise = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x3fffffff - 1; };
    const clap = () => pcm(10, (t) => (t < 0.004 ? 0.9 * noise() * (1 - t / 0.004) : 0));
    const settle = () => { for (let i = 0; i < 6; i++) frames(1); };

    frames(40);
    check(r.player.grounded, 'grounded before the clap');
    const onsets0 = C.detector.telemetry.onsets;
    bro.mic.feed(clap(), er);
    bro.mic.feed(silence(40), er);
    settle();
    eq(C.detector.telemetry.onsets, onsets0 + 1, 'detector heard one clap');
    check(!r.player.grounded, 'a fed clap jumped the runner');
    check(!C.detector.glideActive, 'a clap is not a whistle');
    eq(q('#vuBar').style.width, '0%', 'energy bar back to 0 after the clap');
    bro.mic.feed(silence(200), er);
    frames(60);

    bro.mic.feed(clap(), er);
    bro.mic.feed(silence(180), er);
    bro.mic.feed(clap(), er);
    bro.mic.feed(silence(250), er);
    settle();
    check(r.player.superJumping, 'a fed double clap super-jumped');
    frames(90);

    if (C.mic.sense) {
        bro.mic.feed(pcm(400, (t) => 0.2 * Math.sin(2 * Math.PI * 1200 * t)), er);
        settle();
        check(C.detector.glideActive, 'a fed 1200 Hz whistle holds a glide');
        check(/TONE: 1\d\d\d Hz/.test(text('#toneHzLabel')), 'tone readout (' + text('#toneHzLabel') + ')');
        bro.mic.feed(silence(300), er);
        settle();
        check(!C.detector.glideActive && !r.player.gliding, 'silence ends the glide');
    } else {
        console.log('bro.sense not in this build: whistle feed skipped');
    }
    C.mic.stop();
    check(!C.mic.active, 'mic stopped');
} else {
    console.log('bro.mic not in this build: mic feed skipped');
}

// ── Pause + settings ───────────────────────────────────────────────────────

press('Escape');
frames(1);
eq(C.screen, 'pause', 'Esc pauses');
press('ArrowDown'); press('ArrowDown');
press('Enter');
frames(1);
eq(C.screen, 'settings', 'settings from pause');
eq(text('#opt-clapThreshold'), '0.28', 'clap threshold default');
press('Enter');
eq(text('#opt-clapThreshold'), '0.32', 'clap threshold cycles');
check(C.detector.clapThreshold === 0.32, 'detector picks it up');
press('ArrowDown');
press('Enter');
eq(text('#opt-whistleMinHz'), '800', 'whistle floor cycles');
shot('settings');
press('ArrowDown'); press('ArrowDown');
press('Enter');             // APPLY
frames(1);
eq(C.screen, 'pause', 'APPLY returns to pause mid-run');
press('Enter');
frames(1);
eq(C.screen, 'playing', 'resume');

// ── Crash -> game over ─────────────────────────────────────────────────────

r.spawnWave('SPIKE_BARRIER');
r.obstacles[r.obstacles.length - 1].x = r.player.x + 30;
frames(10);
eq(C.screen, 'gameover', 'spikes end the run');
check(/^Score: [\d,]+ \| Distance: \d+m \| Coins: \d+/.test(text('#gameover-stats')), 'game over stats (' + text('#gameover-stats') + ')');
check(/NEW BEST/.test(text('#gameover-stats')), 'first run is a new best');
eq(text('#hud-best'), C.save.highScore().toLocaleString(), 'best card shows the saved high score');
shot('gameover');

press('Enter');
frames(2);
check(C.screen === 'playing' && C.runner !== r && C.runner.score < 50, 'PLAY AGAIN starts fresh');

console.log('clap-runner tests passed.');
