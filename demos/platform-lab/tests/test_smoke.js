// test_smoke.js — headless integration test for Platform Lab.
//
// Run:
//   ./build/Release/bro-headless.exe ../broworkshop/demos/platform-lab \
//       ../broworkshop/demos/platform-lab/tests/test_smoke.js
//
// Everything here is MEASURED. The distinction matters more in this app than in
// most, because all four features under test are easy to fake-pass:
//
//   - An animation that "moved" proves nothing. So the animation section drives
//     virtual time to exact offsets and asserts the INTERPOLATED VALUE the
//     engine computed — 25% of the way through a linear 0→600px animation must
//     read back as 150px from getComputedStyle, not merely "more than 0".
//   - A media query that "returned a boolean" proves nothing. So every query is
//     cross-checked against the cascade's own answer for the same query, and
//     the listener counts are asserted per registration KIND after a known
//     number of flips.
//   - A border-image that "rendered" proves nothing. So the fixture's nine
//     regions are nine distinct flat colours and the painted result is sampled
//     with getPixel() at nine contracted coordinates.
//   - A compressor that "round-tripped" proves nothing (identity round-trips
//     too). So the output must be strictly smaller for compressible input,
//     strictly NOT smaller for noise, byte-identical after decompression, and
//     carry the right container bytes on the wire.

import {
    // animations
    animState, transportPlay, transportPause, transportReverse, transportFinish,
    transportCancel, transportSeek, setPlaybackRate, ladderRestart,
    registrySnapshot, TRANSPORT_MS, LADDER_RATES,
    // media queries
    mqState, evaluateAll, resetListeners, abortListeners, removePlainListener,
    removeCaptureListenerWrongly, removeCaptureListenerProperly,
    setScheme, darkQuery, LISTENER_QUERY, QUERIES, currentListenerMql,
    // border-image
    biState, longhandsFor, refreshLonghands, applyLive, LONGHANDS,
    // compression
    compress, decompress, roundTripPiped, bytesEqual, inspectContainer,
    compressibleBytes, incompressibleBytes, unicodeBytes,
    saveCompressed, loadCompressed, runBench, probeErrors, demoStorage, FORMATS,
    stats,
} from '/app/app.js';

const near = (a, b, eps) => Math.abs(a - b) <= (eps === undefined ? 1e-3 : eps);
const px = (s) => parseFloat(s);

// Known viewport for everything before the media-query section, so the
// border-image probe coordinates and every width query have a fixed answer.
resize(1600, 1000);
advanceTime(64);
flush();

// =============================================================================
// 1. WEB ANIMATIONS
// =============================================================================

const anim = animState.transport;
assert(anim, 'transport animation was created by element.animate()');
assert(anim.id === 'pl-transport', 'options.id round-tripped to anim.id, got ' + anim.id);
assert(anim.playState === 'paused', 'app boots the transport paused, got ' + anim.playState);
assert(anim.currentTime === 0, 'and parked at 0, got ' + anim.currentTime);
assert(anim.playbackRate === 1, 'default playbackRate is 1, got ' + anim.playbackRate);
assert(anim.pending === false, 'pending is always false — control ops apply immediately');

const runner = document.getElementById('animRunner');

// ── currentTime is a real seek, and the interpolator agrees with it ─────────
//
// The keyframes are linear 0px→600px, #3b82f6→#f43f5e, scale(1)→scale(1.6) over
// 4000ms. Seeking to a fraction f must land the element at exactly f of the way
// along EVERY one of those three, because the easing is linear. This is the
// single most important block in the file: it is the only thing that would
// catch an interpolator that ran on its own approximate clock.

for (const f of [0, 0.25, 0.5, 0.75, 1]) {
    transportSeek(f * TRANSPORT_MS);
    flush();
    const cs = getComputedStyle(runner);
    const expectLeft = f * 600;
    assert(near(px(cs.left), expectLeft, 0.5),
        `seek to ${f * 100}% → left ${cs.left}, expected ${expectLeft}px`);
    // scale(1) → scale(1.6): the function-list interpolator, same clock.
    const m = /scale\(([-\d.]+)\)/.exec(cs.transform);
    assert(m, 'transform kept its scale() function, got ' + cs.transform);
    assert(near(Number(m[1]), 1 + 0.6 * f, 0.01),
        `seek to ${f * 100}% → scale ${m[1]}, expected ${1 + 0.6 * f}`);
}

// Intermediate really is intermediate — not a 0/1 snap at the midpoint.
transportSeek(0.5 * TRANSPORT_MS);
flush();
{
    const left = px(getComputedStyle(runner).left);
    assert(left > 250 && left < 350, 'midpoint left is genuinely intermediate: ' + left);
    // The colour interpolator, checked separately: halfway between #3b82f6
    // (59,130,246) and #f43f5e (244,63,94) is (151.5, 96.5, 170).
    const c = getComputedStyle(runner).backgroundColor;
    const rgb = (c.match(/[\d.]+/g) || []).map(Number);
    assert(rgb.length >= 3, 'background-color read back as rgb(), got ' + c);
    assert(near(rgb[0], 151.5, 3), `red channel midway: ${rgb[0]} vs 151.5`);
    assert(near(rgb[1], 96.5, 3), `green channel midway: ${rgb[1]} vs 96.5`);
    assert(near(rgb[2], 170, 3), `blue channel midway: ${rgb[2]} vs 170`);
    assert(rgb[0] !== 59 && rgb[0] !== 244, 'colour is between the keyframes, not snapped');
}

// ── advanceTime drives it at exactly 1x ────────────────────────────────────

transportSeek(0);
transportPlay();
flush();
assert(anim.playState === 'running', 'play() → running, got ' + anim.playState);

advanceTime(1000);
assert(near(anim.currentTime, 1000, 40),
    'at rate 1, 1000ms of virtual time is 1000ms of animation, got ' + anim.currentTime);
{
    const left = px(getComputedStyle(runner).left);
    assert(near(left, 150, 12), 'and the element is a quarter of the way: ' + left);
}

// ── playbackRate 2 advances at exactly double ──────────────────────────────

const before2x = anim.currentTime;
setPlaybackRate(2);
advanceTime(1000);
const delta2x = anim.currentTime - before2x;
assert(near(delta2x, 2000, 80),
    `playbackRate 2: 1000ms wall → ${delta2x}ms animation, expected 2000`);
assert(delta2x > 1500, 'and it is unambiguously faster than 1x, not rounding');

// ── playbackRate 0 freezes ─────────────────────────────────────────────────

setPlaybackRate(0);
const frozenAt = anim.currentTime;
advanceTime(500);
assert(near(anim.currentTime, frozenAt, 1e-6),
    `playbackRate 0 freezes: ${anim.currentTime} vs ${frozenAt}`);
assert(anim.playState === 'running', 'a frozen animation is still "running", not paused');

// ── playbackRate 0.5 halves it ─────────────────────────────────────────────

setPlaybackRate(0.5);
transportSeek(0);
const beforeHalf = anim.currentTime;
advanceTime(1000);
const deltaHalf = anim.currentTime - beforeHalf;
assert(near(deltaHalf, 500, 60),
    `playbackRate 0.5: 1000ms wall → ${deltaHalf}ms animation, expected 500`);

// ── negative playbackRate runs backwards ───────────────────────────────────

setPlaybackRate(1);
transportSeek(3000);
setPlaybackRate(-1);
advanceTime(1000);
assert(near(anim.currentTime, 2000, 60),
    `playbackRate -1 rewinds: ${anim.currentTime}, expected ~2000`);
assert(anim.currentTime < 3000, 'time genuinely went backwards');
setPlaybackRate(1);

// ── pause() holds; play() resumes from where it held ───────────────────────

transportSeek(1200);
transportPause();
flush();
assert(anim.playState === 'paused', 'pause() → paused, got ' + anim.playState);
const heldAt = anim.currentTime;
const heldLeft = getComputedStyle(runner).left;
advanceTime(2000);
assert(near(anim.currentTime, heldAt, 1e-6), 'paused time does not move: ' + anim.currentTime);
assert(getComputedStyle(runner).left === heldLeft, 'and the element does not move either');

transportPlay();
advanceTime(300);
assert(anim.currentTime > heldAt + 200,
    'play() resumes from the held time rather than restarting: ' + anim.currentTime);

// ── finish() and the finish delivery paths ─────────────────────────────────

const finishesBefore = animState.finishCount;
const resolvedBefore = animState.finishedResolved;

transportFinish();
flush();
advanceTime(16);
flush();

assert(anim.playState === 'finished', 'finish() → finished, got ' + anim.playState);
assert(near(anim.currentTime, TRANSPORT_MS, 1),
    `finish() jumps to the end: ${anim.currentTime}, expected ${TRANSPORT_MS}`);
assert(animState.finishCount === finishesBefore + 1,
    `onfinish fired exactly once, got ${animState.finishCount - finishesBefore}`);
assert(animState.lastEvent.indexOf('finish') === 0, 'the app saw a finish event');

// fill:'forwards' keeps the final value applied after the animation ends.
assert(near(px(getComputedStyle(runner).left), 600, 0.5),
    'fill:forwards holds the end value: ' + getComputedStyle(runner).left);

// The `finished` promise is the other delivery path and must also have settled.
await Promise.resolve(); flush(); advanceTime(16); flush();
await Promise.resolve(); flush();
assert(animState.finishedResolved === resolvedBefore + 1,
    `the finished promise resolved exactly once, got ${animState.finishedResolved - resolvedBefore}`);

// ── reverse() on a finished animation runs it back from the end ────────────

transportReverse();
assert(anim.playbackRate === -1, 'reverse() flipped playbackRate, got ' + anim.playbackRate);
advanceTime(1000);
assert(anim.currentTime < TRANSPORT_MS - 500,
    'reverse() from the end runs backwards: ' + anim.currentTime);
assert(anim.playState === 'running', 'and it is running again, got ' + anim.playState);

// ── getAnimations(): count, identity, and what cancel() removes ────────────

{
    // 1 transport + 5 ladder entries, all live.
    const all = document.getAnimations();
    assert(all.length === 1 + LADDER_RATES.length,
        `document.getAnimations() has transport + ${LADDER_RATES.length} ladder = ` +
        `${1 + LADDER_RATES.length}, got ${all.length}`);
    assert(all.indexOf(anim) >= 0,
        'getAnimations() is identity-preserving — the exact object animate() returned');

    const onRunner = runner.getAnimations();
    assert(onRunner.length === 1, 'the runner element has exactly 1 animation, got ' + onRunner.length);
    assert(onRunner[0] === anim, 'and it is the same object');

    const snap = registrySnapshot();
    assert(snap.filter((r) => r.isTransport).length === 1,
        'the app panel finds exactly one transport row by identity');
}

// A second animation on the same element must ADD to the count.
{
    const extra = runner.animate([{ opacity: 1 }, { opacity: 0.2 }],
        { duration: 2000, fill: 'forwards', id: 'pl-extra' });
    flush();
    assert(runner.getAnimations().length === 2,
        'a second animate() on the element adds an entry, got ' + runner.getAnimations().length);
    assert(document.getAnimations().length === 2 + LADDER_RATES.length,
        'and the document registry grew too, got ' + document.getAnimations().length);

    // Last-created wins per property (bro's documented composite simplification).
    advanceTime(1000);
    const op = Number(getComputedStyle(runner).opacity);
    assert(near(op, 0.6, 0.05), 'the later animation drives opacity to ~0.6, got ' + op);

    // cancel() removes it from the registry immediately — no forwards fill can
    // keep a cancelled animation listed, because cancel drops all effect output.
    extra.cancel();
    flush();
    assert(extra.playState === 'idle', 'cancel() → idle, got ' + extra.playState);
    assert(extra.currentTime === null, 'a cancelled animation has null currentTime, got ' + extra.currentTime);
    assert(runner.getAnimations().length === 1,
        'cancel() removed it from the element registry, got ' + runner.getAnimations().length);
    assert(runner.getAnimations()[0] === anim, 'leaving the transport behind');
    assert(document.getAnimations().length === 1 + LADDER_RATES.length,
        'and from the document registry, got ' + document.getAnimations().length);

    // Effect output is gone: opacity is back to its base value.
    assert(near(Number(getComputedStyle(runner).opacity), 1, 1e-3),
        'cancel() dropped the effect — opacity back to base, got ' + getComputedStyle(runner).opacity);
}

// ── cancel() rejects `finished` with an AbortError ─────────────────────────

{
    const victim = runner.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 1000 });
    const p = victim.finished;
    let rejection = null;
    p.catch((e) => { rejection = e; });
    victim.cancel();
    flush();
    await Promise.resolve(); flush(); advanceTime(16); flush();
    await Promise.resolve(); flush();
    assert(rejection !== null, 'cancel() rejected the finished promise');
    assert(rejection.name === 'AbortError',
        'and rejected with an AbortError, got ' + (rejection && rejection.name));
    assert(victim.finished !== p, 'cancel() installed a FRESH pending finished promise');
}

// ── the rate ladder fans out in exact ratio ────────────────────────────────
//
// Five animations started in the same frame at 0.25/0.5/1/2/4. After the same
// wall time their currentTimes must be exactly proportional to their rates.
// Two animations could agree by luck; five in strict ratio cannot.

ladderRestart();
flush();
advanceTime(1000);

{
    const times = animState.ladder.map((e) => e.anim.currentTime);
    const rates = animState.ladder.map((e) => e.rate);
    assert(times.every((t) => t !== null), 'every ladder animation has a time');

    // Normalise against the 1x entry (index 2) so the assertion is about the
    // RATIO, immune to how much wall time actually elapsed.
    const base = times[rates.indexOf(1)];
    assert(base > 500, 'the 1x ladder entry actually advanced: ' + base);
    for (let i = 0; i < rates.length; i++) {
        const ratio = times[i] / base;
        assert(near(ratio, rates[i], 0.12),
            `ladder ${rates[i]}× ran at ratio ${ratio.toFixed(3)} of 1×, expected ${rates[i]}`);
    }
    // ...and strictly ordered, which quantisation could not fake across five.
    for (let i = 1; i < times.length; i++) {
        assert(times[i] > times[i - 1],
            `ladder times increase with rate: ${times[i - 1]} < ${times[i]}`);
    }
    // Infinite iterations: finish() must throw InvalidStateError.
    let threw = null;
    try { animState.ladder[0].anim.finish(); } catch (e) { threw = e; }
    assert(threw !== null, 'finish() on an infinite animation throws');
    assert(threw.name === 'InvalidStateError',
        'and it is an InvalidStateError, got ' + threw.name);
}

console.log('  ✓ Web Animations');

// =============================================================================
// 2. matchMedia / MediaQueryList / @media
// =============================================================================

// ── matchMedia and the cascade agree, query by query ───────────────────────
//
// Both columns are recomputed at three different viewport sizes. The agreement
// has to hold at every one of them, not just the boot size, because a stale
// cache on either side would only show up after a change.

for (const [w, h] of [[1600, 1000], [700, 900], [1100, 700]]) {
    resize(w, h);
    flush();
    const { agreements, disagreements } = evaluateAll();
    assert(disagreements === 0,
        `at ${w}x${h}: matchMedia and @media disagree on ${disagreements} queries`);
    assert(agreements === 9,
        `at ${w}x${h}: 9 queries have a CSS counterpart to compare, got ${agreements}`);
}

// ── the actual truth values, at a known size ───────────────────────────────
//
// Agreement alone would be satisfied by both sides being wrong identically, so
// pin the answers too.

resize(1600, 1000);
flush();
evaluateAll();

const q = (s) => matchMedia(s).matches;
assert(q('(min-width: 800px)') === true, '1600px wide matches min-width:800px');
assert(q('(max-width: 700px)') === false, 'and does not match max-width:700px');
assert(q('(min-width: 1700px)') === false, 'nor min-width:1700px');
assert(q('(orientation: landscape)') === true, '1600x1000 is landscape');
assert(q('(orientation: portrait)') === false, 'and not portrait');
assert(q('(400px <= width <= 1200px)') === false, 'range syntax excludes 1600');
assert(q('(400px <= width <= 1800px)') === true, 'range syntax includes 1600');
assert(q('(width > 500px)') === true, 'range comparison syntax works');
assert(q('screen and (min-width: 500px)') === true, 'media type + feature');
assert(q('print') === false, 'bro is a screen, never print');
assert(q('all') === true, 'media type "all" matches');
assert(q('complete garbage') === false, 'a garbage query is false, not a throw');
assert(q('(min-width: 3000px), (orientation: landscape)') === true,
    'comma-separated query list is any-of');
assert(q('not all') === false, '"not all" is false');
assert(q('not print') === true, '"not print" is true on a screen');

// .media reflects the input string, trimmed; "" becomes "all".
assert(matchMedia('  (min-width: 640px)  ').media === '(min-width: 640px)',
    'media is trimmed, got "' + matchMedia('  (min-width: 640px)  ').media + '"');
assert(matchMedia('').media === 'all', 'an empty query reports media "all"');
assert(matchMedia('complete garbage').media === 'complete garbage',
    'a garbage query still reflects its input string (no "not all" normalisation)');

// ── .matches is live: correct BEFORE the change event lands ────────────────

{
    const narrow = matchMedia('(max-width: 800px)');
    assert(narrow.matches === false, 'narrow query false at 1600px');
    resize(600, 900);
    assert(narrow.matches === true, '.matches is live — true immediately after resize()');
    resize(1600, 1000);
    assert(narrow.matches === false, 'and back to false');
    flush();
}

// ── listener counts per registration kind, after a known number of flips ───
//
// The panel's six listeners all watch (min-width: 900px). Driving the viewport
// across that boundary N times must fire each one a predictable number of
// times, and the numbers differ per kind — which is the whole experiment.

const mql = currentListenerMql();
assert(mql.media === LISTENER_QUERY, 'the listener list watches ' + LISTENER_QUERY);

// Re-arm from a known state at a WIDE viewport, so the first flip below is
// wide→narrow. The re-arm is necessary rather than tidy: the {once} listener
// installed at boot was already consumed by the resizes above, and a consumed
// once-listener cannot demonstrate that it fires exactly once.
resize(1600, 1000);
flush();
const mql2 = resetListeners();
flush();
assert(mql2.media === LISTENER_QUERY, 'the re-armed list watches ' + LISTENER_QUERY);
assert(mql2.matches === true, 'listener query matches at 1600px');

// Flip 1: wide → narrow.
resize(700, 900);
flush();
assert(mql2.matches === false, 'listener query stopped matching at 700px');
assert(mqState.plainFires === 1, 'plain listener fired once, got ' + mqState.plainFires);
assert(mqState.onceFires === 1, 'once listener fired, got ' + mqState.onceFires);
assert(mqState.captureFires === 1, 'capture listener fired once, got ' + mqState.captureFires);
assert(mqState.signalFires === 1, 'signal listener fired once, got ' + mqState.signalFires);
assert(mqState.legacyFires === 1, 'addListener alias fired once, got ' + mqState.legacyFires);
assert(mqState.onchangeFires === 1, 'onchange fired once, got ' + mqState.onchangeFires);

// The event payload's shape, checked once on a real delivery.
{
    const ev = mqState.lastEvent;
    assert(ev !== null, 'the app captured the change event');
    assert(ev.type === 'change', 'event.type is "change", got ' + ev.type);
    assert(ev.matches === false, 'event.matches carries the flip value, got ' + ev.matches);
    assert(ev.media === LISTENER_QUERY, 'event.media is the query, got ' + ev.media);
    assert(ev.targetIsMql === true, 'event.target is the MediaQueryList');
    assert(ev.currentTargetIsMql === true, 'event.currentTarget is the MediaQueryList');
}

// A resize that does NOT cross the boundary must fire nothing.
resize(600, 900);
flush();
assert(mqState.plainFires === 1,
    'a resize that does not flip .matches fires nothing, got ' + mqState.plainFires);

// Flip 2: narrow → wide. `once` must NOT fire again; everything else must.
resize(1600, 1000);
flush();
assert(mql2.matches === true, 'back to matching');
assert(mqState.plainFires === 2, 'plain fired twice, got ' + mqState.plainFires);
assert(mqState.onceFires === 1,
    'ONCE listener still at 1 after a second flip, got ' + mqState.onceFires);
assert(mqState.captureFires === 2, 'capture fired twice, got ' + mqState.captureFires);
assert(mqState.signalFires === 2, 'signal fired twice, got ' + mqState.signalFires);
assert(mqState.legacyFires === 2, 'legacy fired twice, got ' + mqState.legacyFires);
assert(mqState.onchangeFires === 2, 'onchange fired twice, got ' + mqState.onchangeFires);

// Duplicate registration de-duplicates: installListeners() added onPlain twice,
// so if that were broken plain would now read 4 against capture's 2.
assert(mqState.plainFires === mqState.captureFires,
    `registering the same function twice registers it ONCE: plain ${mqState.plainFires} ` +
    `vs capture ${mqState.captureFires}`);

// ── AbortSignal removes the listener ───────────────────────────────────────

abortListeners();
resize(700, 900);
flush();
assert(mqState.signalFires === 2,
    'after abort() the signal listener is detached, got ' + mqState.signalFires);
assert(mqState.plainFires === 3,
    'while the others keep firing, got plain ' + mqState.plainFires);

// ── removeEventListener identity includes the capture flag ─────────────────

removeCaptureListenerWrongly();     // no capture flag — must NOT remove
resize(1600, 1000);
flush();
assert(mqState.captureFires === 4,
    'removeEventListener without {capture:true} does NOT remove a capture listener, got ' +
    mqState.captureFires);

removeCaptureListenerProperly();    // with the flag — must remove
resize(700, 900);
flush();
assert(mqState.captureFires === 4,
    'removeEventListener with {capture:true} removed it, got ' + mqState.captureFires);
assert(mqState.plainFires === 5, 'the plain listener is unaffected, got ' + mqState.plainFires);

removePlainListener();
const plainAtRemoval = mqState.plainFires;
resize(1600, 1000);
flush();
assert(mqState.plainFires === plainAtRemoval,
    'removeEventListener detached the plain listener, got ' + mqState.plainFires);
assert(mqState.legacyFires > 0, 'the legacy listener is still attached');

// ── a listener-less list still evaluates ───────────────────────────────────

{
    let dropped = matchMedia('(min-width: 1000px)');
    assert(dropped.matches === true, 'a fresh list evaluates immediately');
    dropped = null;   // no listeners: eligible for GC, and that is fine
    assert(matchMedia('(min-width: 1000px)').matches === true,
        'a new list for the same query agrees');
}

// ── prefers-color-scheme flips through the setting, and CSS follows ────────

{
    const dark = darkQuery();
    let schemeFires = 0;
    let lastSchemeEv = null;
    dark.addEventListener('change', (ev) => { schemeFires++; lastSchemeEv = ev; });

    setScheme('light');
    flush(); advanceTime(16); flush();
    assert(dark.matches === false, 'colorScheme light → dark query false');
    // The cascade must agree: style.css has a real @media
    // (prefers-color-scheme: dark) probe rule.
    assert(getComputedStyle(document.getElementById('mqProbeDark')).order === '0',
        'the @media dark probe is off in light mode');

    const firesBeforeDark = schemeFires;
    setScheme('dark');
    flush(); advanceTime(16); flush();
    assert(dark.matches === true, 'colorScheme dark → dark query true');
    assert(getComputedStyle(document.getElementById('mqProbeDark')).order === '1',
        'and the @media dark probe turned on — matchMedia and the cascade agree on scheme too');
    assert(schemeFires === firesBeforeDark + 1,
        `the scheme flip fired change exactly once, got ${schemeFires - firesBeforeDark}`);
    assert(lastSchemeEv.matches === true, 'the scheme change event carried matches:true');
    assert(lastSchemeEv.media === '(prefers-color-scheme: dark)',
        'and the right media string, got ' + lastSchemeEv.media);

    // The whole page moved, not just a probe: the light-mode override in
    // style.css sets --bg, so body's computed background differs per scheme.
    const darkBg = getComputedStyle(document.body).backgroundColor;
    setScheme('light');
    flush(); advanceTime(16); flush();
    const lightBg = getComputedStyle(document.body).backgroundColor;
    assert(darkBg !== lightBg,
        `the @media scheme rule restyles the document: dark ${darkBg} vs light ${lightBg}`);

    setScheme('system');
    flush(); advanceTime(16); flush();
}

// A non-function assigned to onchange silently CLEARS rather than throwing.
{
    const list = matchMedia('(min-width: 1200px)');
    let fired = 0;
    list.onchange = () => { fired++; };
    list.onchange = undefined;   // documented: clears, does not throw
    resize(700, 900); flush();
    resize(1600, 1000); flush();
    assert(fired === 0, 'assigning a non-function to onchange unsubscribes, got ' + fired);
}

resize(1600, 1000);
flush();
console.log('  ✓ matchMedia / @media');

// =============================================================================
// 3. CSS border-image
// =============================================================================

// ── the shorthand expands into all five longhands ──────────────────────────

refreshLonghands();

{
    const lh = longhandsFor('biStretch');
    assert(lh, 'the stretch sample exists');
    for (const prop of LONGHANDS) {
        assert(lh[prop] !== undefined && lh[prop] !== '',
            `shorthand produced ${prop}, got "${lh[prop]}"`);
    }
    assert(lh['border-image-source'].indexOf('nine.png') >= 0,
        'source longhand names the image, got ' + lh['border-image-source']);
    assert(lh['border-image-slice'].indexOf('16') >= 0,
        'slice longhand is 16, got ' + lh['border-image-slice']);
    assert(lh['border-image-width'].indexOf('24px') >= 0,
        'width longhand is 24px, got ' + lh['border-image-width']);
    assert(lh['border-image-repeat'].indexOf('stretch') >= 0,
        'repeat longhand is stretch, got ' + lh['border-image-repeat']);
}

// The slash slots: slice / width / outset, in that order.
{
    const lh = longhandsFor('biOutset');
    assert(lh['border-image-width'].indexOf('20px') >= 0,
        'second slash slot is the WIDTH, got ' + lh['border-image-width']);
    assert(lh['border-image-outset'].indexOf('8px') >= 0,
        'third slash slot is the OUTSET, got ' + lh['border-image-outset']);
}

// `fill` belongs to the slice component wherever it appears in the shorthand.
{
    const filled = longhandsFor('biFill');
    assert(filled['border-image-slice'].indexOf('fill') >= 0,
        '`fill` attached to border-image-slice, got ' + filled['border-image-slice']);
    const unfilled = longhandsFor('biStretch');
    assert(unfilled['border-image-slice'].indexOf('fill') < 0,
        'and is absent when not written, got ' + unfilled['border-image-slice']);
}

// Two-value repeat: horizontal then vertical.
{
    const lh = longhandsFor('biMixedRepeat');
    assert(lh['border-image-repeat'].indexOf('round') >= 0 &&
           lh['border-image-repeat'].indexOf('space') >= 0,
        'both repeat keywords survived, got ' + lh['border-image-repeat']);
}

// Four-value border-image-width in top/right/bottom/left order.
{
    const lh = longhandsFor('biAsymmetric');
    for (const v of ['40px', '12px', '8px', '28px']) {
        assert(lh['border-image-width'].indexOf(v) >= 0,
            `asymmetric width kept ${v}, got ` + lh['border-image-width']);
    }
}

// A gradient source parses as a source (it is just not painted per-region).
{
    const lh = longhandsFor('biGradient');
    assert(lh['border-image-source'].indexOf('gradient') >= 0,
        'a gradient parses into border-image-source, got ' + lh['border-image-source']);
}

// The live control rebuilds a valid shorthand.
{
    const css = applyLive();
    assert(css.indexOf('border-image') < 0, 'applyLive returns the value, not the declaration');
    const lh = longhandsFor('biLiveBox');
    assert(lh['border-image-source'].indexOf('nine.png') >= 0,
        'the live box took the generated source, got ' + lh['border-image-source']);
}

assert(biState.expansions >= 10,
    'at least 10 samples expanded to a real source, got ' + biState.expansions);

// ── the PAINTER: nine known pixels, nine known slices ──────────────────────
//
// #biProbe is a 200x120 box at (400,400) with 24px borders and
// `border-image: url(nine.png) 16 fill / 24px / 0 stretch`. The fixture's nine
// 16x16 regions are nine distinct flat colours, so each of these reads names
// exactly which slice the painter placed at that coordinate. This is the only
// assertion in the file that tests the RENDERER rather than the cascade.
//
// Coordinates are contracted with style.css — see the comment on #biProbe.

advanceTime(64);
flush();

const REGION = {
    tl: [255, 32, 32],   tc: [255, 176, 32],  tr: [248, 240, 48],
    ml: [32, 200, 96],   mc: [40, 44, 60],    mr: [48, 168, 255],
    bl: [128, 64, 224],  bc: [232, 48, 200],  br: [255, 255, 255],
};

// ── instrument calibration (ENGINE BUG WORKAROUND — delete when fixed) ──────
//
// docs/headless.md says getPixel() takes "viewport coordinates (matches
// getBoundingClientRect)". That is not true while a native menu bar is up:
// bro.menu shrinks the DOM viewport (window.innerHeight drops by the bar's
// height) but getPixel/screenshot coordinates stay relative to the whole
// composited frame, so every DOM y is offset by the bar height. This app calls
// installSystemMenu() like every other windowed demo, so it is affected.
//
// Repro (no border-image involved at all):
//     resize(1600, 1000);
//     const d = document.createElement('div');
//     d.style.cssText = 'position:fixed;left:700px;top:400px;width:60px;' +
//                       'height:40px;background:rgb(0,255,0)';
//     document.body.appendChild(d); advanceTime(64); flush();
//     d.getBoundingClientRect().top;        // 400
//     // first green scanline at x=710 is 428, not 400 — a 28px offset.
//     bro.menu.hide(); advanceTime(200); flush();
//     // now it is 400, and window.innerHeight goes 972 → 1000.
//
// Rather than hard-code 28, MEASURE the offset from a marker whose DOM rect is
// known, then assert it is a pure constant vertical translation. That keeps
// every border-image assertion below a genuine measurement of the painter, and
// it will keep working (with a measured 0) the day the engine is fixed.

const CAL = (() => {
    const marker = document.createElement('div');
    marker.style.cssText =
        'position:fixed;left:900px;top:300px;width:40px;height:30px;' +
        'z-index:99999;background:rgb(0,255,0);';
    document.body.appendChild(marker);
    advanceTime(64);
    flush();

    const rect = marker.getBoundingClientRect();
    const isGreen = (p) => p.r < 40 && p.g > 220 && p.b < 40;

    let top = null, left = null;
    for (let y = 0; y < 1000 && top === null; y++) if (isGreen(getPixel(rect.left + 8, y))) top = y;
    for (let x = 0; x < 1600 && left === null; x++) if (isGreen(getPixel(x, top + 8))) left = x;

    marker.remove();
    advanceTime(32);
    flush();

    assert(top !== null && left !== null,
        'the calibration marker painted somewhere findable');
    return { dx: left - rect.left, dy: top - rect.top };
})();

assert(CAL.dx === 0,
    'getPixel has no HORIZONTAL offset from getBoundingClientRect, got ' + CAL.dx);
assert(CAL.dy >= 0 && CAL.dy < 64,
    'the getPixel vertical offset is a small constant (the native menu bar height), got ' + CAL.dy);
if (CAL.dy !== 0) {
    console.log(`  ! ENGINE: getPixel() y is offset ${CAL.dy}px from getBoundingClientRect ` +
                `while bro.menu is visible (docs/headless.md says they match)`);
}

// Nearest-neighbour sampling plus GL readback means an exact match is the
// expectation, but a small tolerance keeps the test about "which slice" rather
// than about colour-space arithmetic.
function assertPixel(x, y, region, what) {
    const p = getPixel(x + CAL.dx, y + CAL.dy);
    const [r, g, b] = REGION[region];
    const dist = Math.abs(p.r - r) + Math.abs(p.g - g) + Math.abs(p.b - b);
    assert(dist <= 24,
        `border-image ${what} at (${x},${y}): got rgb(${p.r},${p.g},${p.b}), ` +
        `expected the "${region}" slice rgb(${r},${g},${b})`);
}

assertPixel(410, 410, 'tl', 'top-left corner');
assertPixel(590, 410, 'tr', 'top-right corner');
assertPixel(410, 506, 'bl', 'bottom-left corner');
assertPixel(590, 506, 'br', 'bottom-right corner');
assertPixel(500, 410, 'tc', 'top edge');
assertPixel(500, 506, 'bc', 'bottom edge');
assertPixel(410, 460, 'ml', 'left edge');
assertPixel(590, 460, 'mr', 'right edge');
// `fill` is what makes the middle region paint at all — without it this pixel
// would show whatever is behind the box.
assertPixel(500, 460, 'mc', 'middle region (only painted because of `fill`)');

// The corners are NOT all the same colour — which is what makes the eight reads
// above independent evidence rather than one fact restated.
{
    const at = (x, y) => getPixel(x + CAL.dx, y + CAL.dy);
    const corners = [at(410, 410), at(590, 410), at(410, 506), at(590, 506)];
    const keys = corners.map((p) => `${p.r},${p.g},${p.b}`);
    assert(new Set(keys).size === 4,
        'the four corners painted four DIFFERENT slices: ' + keys.join(' | '));
}

console.log('  ✓ CSS border-image');

// =============================================================================
// 4. CompressionStream / DecompressionStream
// =============================================================================

assert(typeof CompressionStream === 'function', 'CompressionStream is a constructor');
assert(typeof DecompressionStream === 'function', 'DecompressionStream is a constructor');
{
    const cs = new CompressionStream('gzip');
    assert(cs.readable instanceof ReadableStream, 'cs.readable is a ReadableStream');
    assert(cs.writable instanceof WritableStream, 'cs.writable is a WritableStream');
}

// ── round-trip is byte-identical AND the compressed form is smaller ────────
//
// Round-trip alone would pass for an identity transform, so both halves are
// required: exact bytes back, and strictly fewer bytes in between.

const text = compressibleBytes(64 * 1024);

for (const format of FORMATS) {
    const packed = await compress(text, format);
    const back = await decompress(packed.bytes, format);

    assert(bytesEqual(back.bytes, text),
        `${format}: round-trip is byte-identical (${back.bytes.length} vs ${text.length})`);
    assert(packed.bytes.length < text.length,
        `${format}: compressed form is SMALLER — ${packed.bytes.length} < ${text.length}`);
    // Repetitive English through DEFLATE should be well under 10%; anything
    // near 100% would mean the codec stored rather than compressed.
    assert(packed.bytes.length < text.length * 0.1,
        `${format}: repetitive text compressed hard — ratio ` +
        (packed.bytes.length / text.length).toFixed(4));
}

// ── the three formats are genuinely different on the wire ──────────────────

{
    const gz = (await compress(text, 'gzip')).bytes;
    const zl = (await compress(text, 'deflate')).bytes;
    const raw = (await compress(text, 'deflate-raw')).bytes;

    const gzi = inspectContainer(gz, 'gzip');
    assert(gzi.gzipMagic, `gzip starts 1f 8b, got ${gz[0].toString(16)} ${gz[1].toString(16)}`);
    assert(gzi.deflateMethod, 'gzip CM byte is 8 (deflate), got ' + gz[2]);
    assert(gzi.isize === text.length,
        `gzip ISIZE footer is the uncompressed length: ${gzi.isize} vs ${text.length}`);

    const zli = inspectContainer(zl, 'deflate');
    assert(zli.cm === 8, 'zlib CM nibble is 8 (deflate), got ' + zli.cm);
    assert(zli.zlibHeaderValid,
        `zlib CMF/FLG is a multiple of 31, got ${(zl[0] << 8) | zl[1]}`);

    assert(!(raw[0] === 0x1f && raw[1] === 0x8b), 'deflate-raw has no gzip magic');
    assert(!(((raw[0] << 8) | raw[1]) % 31 === 0 && (raw[0] & 0x0f) === 8),
        'deflate-raw has no zlib header either');

    // Raw is the smallest: no container overhead. gzip carries the most.
    assert(raw.length < zl.length,
        `deflate-raw < deflate (no zlib header): ${raw.length} vs ${zl.length}`);
    assert(zl.length < gz.length,
        `deflate < gzip (smaller container): ${zl.length} vs ${gz.length}`);
    assert(gz.length - raw.length >= 12,
        'the gzip container costs at least its 10-byte header + footer, got ' +
        (gz.length - raw.length));
}

// ── incompressible input must NOT shrink ───────────────────────────────────
//
// The other half of the compression claim: a real codec cannot beat entropy,
// and one that reported a win on random bytes would be lying.

{
    const noise = incompressibleBytes(256 * 1024);
    const packed = await compress(noise, 'gzip', 4096);
    const back = await decompress(packed.bytes, 'gzip', 4096);

    assert(bytesEqual(back.bytes, noise), 'noise round-trips byte-identically');
    assert(packed.bytes.length >= noise.length,
        `random bytes do NOT compress: ${packed.bytes.length} vs ${noise.length}`);
    assert(packed.bytes.length < noise.length * 1.01,
        'and the stored-block overhead is under 1%, got ' +
        ((packed.bytes.length / noise.length - 1) * 100).toFixed(3) + '%');

    // Multi-chunk in BOTH directions — this is what makes it a stream test.
    assert(packed.chunkCount > 1,
        'compressing 256 KB emitted multiple chunks, got ' + packed.chunkCount);
    assert(back.chunkCount > 1,
        'decompressing emitted multiple chunks too, got ' + back.chunkCount);
}

// ── chunk boundaries do not corrupt multi-byte data ────────────────────────
//
// Writing UTF-8 in pieces that split codepoints is the classic way to break a
// naive streaming codec, so the input is deliberately astral-plane text.

{
    const uni = unicodeBytes();
    for (const size of [1, 7, 1024]) {
        const round = await roundTripPiped(uni, 'deflate', size);
        assert(bytesEqual(round.bytes, uni),
            `chained compress|>decompress with ${size}-byte writes is exact ` +
            `(${round.bytes.length} vs ${uni.length})`);
    }
    // The decoded text really is the original, not just equal-length bytes.
    const round = await roundTripPiped(uni, 'gzip', 64);
    assert(new TextDecoder().decode(round.bytes) === new TextDecoder().decode(uni),
        'astral-plane text survives a 64-byte-chunked gzip pipeline');
}

// ── empty input is valid ───────────────────────────────────────────────────

{
    const empty = new Uint8Array(0);
    for (const format of FORMATS) {
        const packed = await compress(empty, format);
        assert(packed.bytes.length > 0,
            `${format} of empty input still emits a container, got ${packed.bytes.length} bytes`);
        const back = await decompress(packed.bytes, format);
        assert(back.bytes.length === 0,
            `${format} empty round-trip is empty, got ${back.bytes.length}`);
    }
}

// ── cross-format decoding must fail, not silently succeed ──────────────────

{
    const gz = (await compress(text, 'gzip')).bytes;
    let threw = null;
    try { await decompress(gz, 'deflate-raw'); } catch (e) { threw = e; }
    assert(threw !== null, 'gzip bytes fed to a deflate-raw decoder must error');
}

// ── the error surface, driven through the app's own prober ─────────────────

{
    const results = await probeErrors();
    for (const r of results) {
        assert(r.threw === true, `error case "${r.case}" rejected as it must`);
    }
    // Unknown formats specifically must be TypeError at CONSTRUCTION.
    const ctorCases = results.filter((r) => r.case.indexOf('Stream("') >= 0);
    assert(ctorCases.length === 8, 'eight bad-format constructor cases, got ' + ctorCases.length);
    for (const r of ctorCases) {
        assert(r.isTypeError, `${r.case} threw a TypeError, got ${r.name}`);
    }
}

// ── the app's bench and storage demo, end to end ───────────────────────────

{
    const runs = await runBench();
    assert(runs.length === 5, 'the bench ran 5 payloads, got ' + runs.length);
    assert(runs.every((r) => r.ok), 'every bench run round-tripped byte-identically');
    const textRuns = runs.filter((r) => r.label.indexOf('repetitive') >= 0);
    assert(textRuns.length === 3, 'the repetitive payload ran in all 3 formats');
    assert(textRuns.every((r) => r.ratio < 0.1), 'and compressed hard in all 3');
    const noiseRun = runs.find((r) => r.label.indexOf('noise') >= 0);
    assert(noiseRun.ratio >= 1, 'while the noise payload did not shrink, ratio ' + noiseRun.ratio);
    assert(noiseRun.chunksOut > 1, 'and came out in multiple chunks');
}

{
    const s = await demoStorage();
    assert(s.ok, 'the compressed-localStorage round-trip returned the exact string');
    assert(s.packedBytes < s.rawBytes,
        `gzip shrank the note: ${s.packedBytes} < ${s.rawBytes}`);
    // base64 gives back a third of what gzip saved — worth asserting so the
    // panel's claim about it is verified rather than asserted in prose.
    assert(s.storedChars > s.packedBytes,
        `base64 inflates the stored form: ${s.storedChars} > ${s.packedBytes}`);
    assert(s.storedChars < s.rawBytes,
        `but it is still a net win over storing raw: ${s.storedChars} < ${s.rawBytes}`);
    assert(await loadCompressed('pl.missing.key') === null,
        'loading a missing key returns null rather than throwing');
}

console.log('  ✓ Compression Streams');

// =============================================================================
// The app itself stayed alive throughout
// =============================================================================

advanceTime(200);
flush();
assert(stats.frames > 10, 'the rAF loop kept running, frames = ' + stats.frames);
assert(mqState.disagreements === 0, 'no matchMedia/@media disagreement accumulated');
assert(document.getAnimations().length >= LADDER_RATES.length,
    'the ladder animations are still registered at teardown');

localStorage.removeItem('pl.note');
setScheme('system');
resize(1600, 1000);
flush();

console.log('platform-lab smoke test: all assertions passed');
