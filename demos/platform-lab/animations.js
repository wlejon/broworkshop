// animations.js — the Web Animations API panel.
//
// bro implements element.animate() on the SAME interpolator that runs CSS
// transitions and @keyframes, which has a consequence worth demonstrating
// rather than describing: a script animation is not a separate clock. It rides
// bro.time, it composites like a CSS animation, and in headless it is driven by
// advanceTime(ms). So the honest way to show it off is to expose the clock.
//
// The panel is built around one claim: at any moment you can ASK an animation
// where it is (currentTime, playState) and where its element ended up
// (getComputedStyle), and the two agree. Every readout here is a live sample of
// that pair, taken once per frame. A demo that only showed things sliding
// around would prove nothing — motion is easy, an accurate clock is not.
//
// Three sub-demos:
//   1. Transport   One long animation with the full control surface wired to
//                  buttons: play/pause/reverse/finish/cancel/seek/playbackRate.
//                  The scrubber both reads and writes currentTime, because the
//                  property is genuinely bidirectional.
//   2. Rate ladder Five identical animations at five playbackRates, started
//                  together. Their currentTimes must fan out in exact ratio —
//                  this is the visual form of the test's rate assertions.
//   3. Registry    A live view of document.getAnimations(), which is the only
//                  way to see the engine's own idea of what is running. The
//                  fill:forwards subtlety (a finished animation stays in the
//                  list only while it is still holding a value) is visible here
//                  and nowhere else.

export const animState = {
    // Transport
    transport: null,          // the Animation object under the buttons
    playState: 'idle',
    currentTime: 0,
    playbackRate: 1,
    finishCount: 0,
    cancelCount: 0,
    lastEvent: '—',
    finishedResolved: 0,
    finishedRejected: 0,
    // Rate ladder
    ladder: [],               // [{ rate, anim, el }]
    // Registry
    registrySize: 0,
    log: [],
};

const TRANSPORT_MS = 4000;

function logLine(text) {
    animState.log.push(text);
    if (animState.log.length > 40) animState.log.shift();
    const el = document.getElementById('animLog');
    if (el) {
        el.textContent = animState.log.slice(-14).join('\n');
        el.scrollTop = el.scrollHeight;
    }
}

// ── Transport ───────────────────────────────────────────────────────────────
//
// The keyframes deliberately mix three interpolation kinds the docs call out
// separately — a length (left), a colour (background-color) and a transform
// function list — so a regression in any one of the three interpolators shows
// up in this one animation rather than needing three.
//
// fill:'forwards' is not decoration: without it the element snaps back to its
// base style the instant the animation finishes, and the registry demo below
// would have nothing to show (getAnimations() keeps a finished animation only
// while it is still holding a forwards fill).

export function buildTransport() {
    const el = document.getElementById('animRunner');
    if (!el) return null;

    const anim = el.animate([
        { left: '0px',   backgroundColor: '#3b82f6', transform: 'scale(1) rotate(0deg)' },
        { left: '600px', backgroundColor: '#f43f5e', transform: 'scale(1.6) rotate(180deg)' },
    ], {
        duration: TRANSPORT_MS,
        easing: 'linear',      // linear so the readout is a pure clock reading:
                               // any easing would make "half the time" stop
                               // meaning "half the distance", and the whole
                               // point of the panel is that they agree.
        fill: 'forwards',
        id: 'pl-transport',
    });

    animState.transport = anim;
    wireHandlers(anim);
    return anim;
}

// onfinish/oncancel and the `finished` promise are two independent delivery
// paths for the same event in the spec, and apps use both. Wiring both here
// means the panel would notice if only one of them worked.
function wireHandlers(anim) {
    anim.onfinish = (e) => {
        animState.finishCount++;
        animState.lastEvent = `finish @ ${Math.round(e.currentTime)}ms`;
        logLine(`onfinish  currentTime=${Math.round(e.currentTime)} type=${e.type}`);
    };
    anim.oncancel = (e) => {
        animState.cancelCount++;
        animState.lastEvent = `cancel (${e.type})`;
        logLine(`oncancel  type=${e.type}`);
    };
    watchFinished(anim);
}

// The `finished` promise is REPLACED after a cancel and after a finished
// animation is played or seeked back into the running state, so a single
// `await` would only ever observe one lifetime. Re-arming on every settle is
// what an app actually has to do, so that is what the panel does.
function watchFinished(anim) {
    const promise = anim.finished;
    promise.then(
        () => {
            animState.finishedResolved++;
            logLine('finished promise RESOLVED');
            if (anim.finished !== promise) watchFinished(anim);
        },
        (err) => {
            animState.finishedRejected++;
            logLine(`finished promise REJECTED ${err && err.name}`);
            if (anim.finished !== promise) watchFinished(anim);
        },
    );
}

// Exported as named driver functions rather than inline click handlers so the
// smoke test drives the panel through exactly the entry points the buttons use.
export function transportPlay()  { animState.transport && animState.transport.play(); }
export function transportPause() { animState.transport && animState.transport.pause(); }
export function transportFinish(){ animState.transport && animState.transport.finish(); }

export function transportReverse() {
    if (animState.transport) animState.transport.reverse();
}

// cancel() rejects `finished` with an AbortError. An unhandled rejection is a
// console error in every realm bro runs, so the re-arm in watchFinished() is
// load-bearing, not tidiness.
export function transportCancel() {
    if (animState.transport) animState.transport.cancel();
}

export function transportSeek(ms) {
    if (!animState.transport) return;
    // Seeking a finished animation un-finishes it (spec), which is why the
    // scrubber can drag a completed run back to life.
    animState.transport.currentTime = ms;
}

export function setPlaybackRate(rate) {
    if (!animState.transport) return;
    animState.transport.playbackRate = rate;
    logLine(`playbackRate = ${rate}`);
}

// ── Rate ladder ─────────────────────────────────────────────────────────────
//
// Five animations over identical keyframes and identical durations, differing
// only in playbackRate. Because they all start in the same frame, their
// currentTimes are a pure multiple of each other forever — which is a much
// stronger statement than "the fast one looks faster", and it is exactly what
// the test asserts numerically.

const LADDER_RATES = [0.25, 0.5, 1, 2, 4];
const LADDER_MS = 8000;

export function buildLadder() {
    const host = document.getElementById('animLadder');
    if (!host) return;
    animState.ladder = [];

    for (const rate of LADDER_RATES) {
        const row = document.createElement('div');
        row.className = 'ladder-row';

        const label = document.createElement('span');
        label.className = 'ladder-label';
        label.textContent = `${rate}×`;
        row.appendChild(label);

        const track = document.createElement('div');
        track.className = 'ladder-track';
        const dot = document.createElement('div');
        dot.className = 'ladder-dot';
        dot.id = `ladderDot${String(rate).replace('.', '_')}`;
        track.appendChild(dot);
        row.appendChild(track);

        const readout = document.createElement('span');
        readout.className = 'ladder-time mono';
        readout.textContent = '0';
        row.appendChild(readout);

        host.appendChild(row);

        const anim = dot.animate(
            [{ transform: 'translateX(0px)' }, { transform: 'translateX(560px)' }],
            { duration: LADDER_MS, easing: 'linear', fill: 'forwards',
              iterations: Infinity, id: `pl-ladder-${rate}` },
        );
        anim.playbackRate = rate;
        animState.ladder.push({ rate, anim, dot, readout });
    }
}

export function ladderRestart() {
    for (const entry of animState.ladder) {
        entry.anim.cancel();
        entry.anim.play();
        entry.anim.playbackRate = entry.rate;
    }
    logLine(`ladder restarted (${animState.ladder.length} animations)`);
}

// ── Registry ────────────────────────────────────────────────────────────────
//
// document.getAnimations() is identity-preserving: the objects that come back
// are the same objects animate() returned. The panel proves that by looking up
// the transport animation by identity rather than by id, which would be the
// easy-but-weaker check.

export function registrySnapshot() {
    const all = document.getAnimations();
    animState.registrySize = all.length;
    return all.map((a) => ({
        id: a.id || '(anonymous)',
        state: a.playState,
        time: a.currentTime === null ? null : Math.round(a.currentTime),
        rate: a.playbackRate,
        isTransport: a === animState.transport,
    }));
}

function renderRegistry() {
    const host = document.getElementById('animRegistry');
    if (!host) return;
    const rows = registrySnapshot();
    // innerHTML per frame would relayout the panel at 60Hz; build once, then
    // only rewrite text (house rule across the labs).
    while (host.children.length < rows.length) {
        const div = document.createElement('div');
        div.className = 'reg-row mono';
        host.appendChild(div);
    }
    while (host.children.length > rows.length) host.removeChild(host.lastChild);
    rows.forEach((r, i) => {
        host.children[i].textContent =
            `${r.isTransport ? '▸' : ' '} ${r.id.padEnd(18)} ${r.state.padEnd(9)} ` +
            `t=${r.time === null ? 'null' : r.time} rate=${r.rate}`;
    });
    const count = document.getElementById('animRegCount');
    if (count) count.textContent = String(rows.length);
}

// ── Per-frame readout ───────────────────────────────────────────────────────

export function tickAnimations() {
    const a = animState.transport;
    if (a) {
        animState.playState = a.playState;
        animState.currentTime = a.currentTime === null ? 0 : a.currentTime;
        animState.playbackRate = a.playbackRate;

        setText('animPlayState', a.playState);
        setText('animTime', a.currentTime === null
            ? 'null' : `${Math.round(a.currentTime)} / ${TRANSPORT_MS} ms`);
        setText('animRate', String(a.playbackRate));
        setText('animFinishCount', String(animState.finishCount));
        setText('animCancelCount', String(animState.cancelCount));
        setText('animLastEvent', animState.lastEvent);
        setText('animPromise',
            `resolved ${animState.finishedResolved} · rejected ${animState.finishedRejected}`);

        // The computed-style readback is the whole point: this is the engine's
        // OWN answer for where the element is, not the app's arithmetic. If the
        // interpolator and the clock ever disagreed, these two columns would
        // drift apart on screen.
        const runner = document.getElementById('animRunner');
        if (runner) {
            const cs = getComputedStyle(runner);
            setText('animComputedLeft', cs.left);
            setText('animComputedColor', cs.backgroundColor);
            setText('animComputedTransform', cs.transform);
        }

        const scrub = document.getElementById('animScrub');
        // Only write the slider when the user is not holding it, otherwise the
        // per-frame write fights the drag.
        if (scrub && !scrub.dataset.dragging && a.currentTime !== null) {
            scrub.value = String(Math.round(a.currentTime));
        }
    }

    for (const entry of animState.ladder) {
        const t = entry.anim.currentTime;
        entry.readout.textContent = t === null ? '—' : String(Math.round(t));
    }

    renderRegistry();
}

function setText(id, text) {
    const el = document.getElementById(id);
    if (el && el.textContent !== text) el.textContent = text;
}

// ── Wiring ──────────────────────────────────────────────────────────────────

export function initAnimations() {
    buildTransport();
    buildLadder();

    bind('animPlay', transportPlay);
    bind('animPause', transportPause);
    bind('animReverse', transportReverse);
    bind('animFinish', transportFinish);
    bind('animCancel', transportCancel);
    bind('animLadderRestart', ladderRestart);

    const scrub = document.getElementById('animScrub');
    if (scrub) {
        scrub.max = String(TRANSPORT_MS);
        scrub.addEventListener('input', () => {
            scrub.dataset.dragging = '1';
            transportSeek(Number(scrub.value));
        });
        scrub.addEventListener('change', () => { delete scrub.dataset.dragging; });
    }

    const rate = document.getElementById('animRateSelect');
    if (rate) rate.addEventListener('change', () => setPlaybackRate(Number(rate.value)));

    // Start paused at 0 so a freshly-opened panel is a still frame the reader
    // can compare against the readouts before anything moves.
    animState.transport.pause();
    animState.transport.currentTime = 0;
    logLine('transport built, paused at 0');
}

function bind(id, fn) {
    const el = document.getElementById(id);
    if (el) el.addEventListener('click', fn);
}

export { TRANSPORT_MS, LADDER_RATES, LADDER_MS };
