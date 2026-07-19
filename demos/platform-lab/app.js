// Platform Lab — the four browser-platform features bro landed that nothing in
// the workshop exercises.
//
// These four have nothing to do with each other technically, which is exactly
// why they share an app: none of them is big enough to justify a demo of its
// own, and all four are the kind of feature that quietly rots because no app
// depends on it. This lab depends on all four, hard, and its smoke test
// measures them rather than smoke-checking them.
//
//   animations.js   element.animate() and the Animation object. The panel is
//                   built so the engine's clock (currentTime, playState) and
//                   the engine's output (getComputedStyle) are shown SIDE BY
//                   SIDE. A demo where things merely move proves nothing; a
//                   demo where a stated time and a measured position agree
//                   proves the interpolator.
//   mediaquery.js   matchMedia against real @media rules — every query is
//                   evaluated twice, once through the JS binding and once
//                   through the cascade, and the panel flags disagreement.
//                   Plus the full listener surface (once / signal / capture /
//                   legacy aliases / onchange) counted independently.
//   borderimage.js  CSS nine-slice borders. Verified through two seams: the
//                   five longhands read back out of computed style (proving
//                   the shorthand grammar), and flat-colour fixture regions
//                   readable with getPixel() (proving the painter).
//   compression.js  CompressionStream / DecompressionStream, driven as real
//                   streams — chunk counts, chained pipelines, container
//                   bytes on the wire, and the error surface.
//
// House rules inherited from input-lab and render-lab:
//   - Panels never rebuild innerHTML per frame; rows are created once and only
//     textContent is rewritten, because a 60 Hz rebuild relayouts and tears.
//   - Every driver the UI uses is an exported named function, so the smoke test
//     drives the app through the same entry points a click does rather than
//     reaching past it into the engine.

import { installSystemMenu } from '/lib/system-menu.js';

import {
    initAnimations, tickAnimations, animState,
    buildTransport, transportPlay, transportPause, transportReverse,
    transportFinish, transportCancel, transportSeek, setPlaybackRate,
    buildLadder, ladderRestart, registrySnapshot,
    TRANSPORT_MS, LADDER_RATES, LADDER_MS,
} from '/app/animations.js';

import {
    initMediaQueries, tickMediaQueries, mqState, evaluateAll,
    installListeners, resetListeners, abortListeners, removePlainListener,
    removeCaptureListenerWrongly, removeCaptureListenerProperly, clearOnChange,
    setScheme, darkQuery, listenerMql, LISTENER_QUERY, QUERIES,
} from '/app/mediaquery.js';

import {
    initBorderImage, tickBorderImage, biState, longhandsFor, refreshLonghands,
    applyLive, REGION_COLORS, SAMPLES as BI_SAMPLES, LONGHANDS,
} from '/app/borderimage.js';

import {
    initCompression, cmpState, runBench, probeErrors, demoStorage,
    compress, decompress, roundTripPiped, bytesEqual, inspectContainer,
    compressibleBytes, incompressibleBytes, unicodeBytes,
    saveCompressed, loadCompressed, sliceInto, streamFrom, readAll, FORMATS,
} from '/app/compression.js';

installSystemMenu();

export const stats = { frames: 0 };

// ── Boot ────────────────────────────────────────────────────────────────────
//
// Order matters exactly once: the media-query table has to be built before the
// first evaluateAll(), because the CSS side of the comparison reads probe
// elements that must already be in the tree and styled. Everything else is
// independent.

initMediaQueries();
initBorderImage();
initAnimations();
initCompression();

// ── Frame loop ──────────────────────────────────────────────────────────────
//
// One rAF for the whole app. The animation panel genuinely needs per-frame
// sampling — its entire claim is that the clock is readable at any instant. The
// other three do not change on their own, so they tick at a divided rate: a
// media-query re-evaluation walks eleven queries through the cascade, and doing
// that 60 times a second to display numbers that only move on resize would be
// pure waste.

let tick = 0;

function frame() {
    tickAnimations();

    // Every 6th frame (~10 Hz) — fast enough that a resize feels instant, slow
    // enough that the cascade walk is not in the frame budget.
    if (tick % 6 === 0) {
        tickMediaQueries();
        tickBorderImage();
    }

    tick++;
    stats.frames++;
    requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// ── Exports for tests ───────────────────────────────────────────────────────
//
// The smoke test imports these and drives the app through them, so a test
// passing means the UI's own code paths work — not merely that the underlying
// engine binding does.

export {
    // animations
    animState, tickAnimations, buildTransport,
    transportPlay, transportPause, transportReverse, transportFinish,
    transportCancel, transportSeek, setPlaybackRate,
    buildLadder, ladderRestart, registrySnapshot,
    TRANSPORT_MS, LADDER_RATES, LADDER_MS,
    // media queries
    mqState, tickMediaQueries, evaluateAll, installListeners, resetListeners,
    abortListeners, removePlainListener, removeCaptureListenerWrongly,
    removeCaptureListenerProperly, clearOnChange, setScheme, darkQuery,
    LISTENER_QUERY, QUERIES,
    // border-image
    biState, tickBorderImage, longhandsFor, refreshLonghands, applyLive,
    REGION_COLORS, BI_SAMPLES, LONGHANDS,
    // compression
    cmpState, runBench, probeErrors, demoStorage,
    compress, decompress, roundTripPiped, bytesEqual, inspectContainer,
    compressibleBytes, incompressibleBytes, unicodeBytes,
    saveCompressed, loadCompressed, sliceInto, streamFrom, readAll, FORMATS,
};

// listenerMql is a live binding in mediaquery.js (installListeners() replaces
// it), so it is re-exported through a getter rather than copied by value.
export function currentListenerMql() {
    return listenerMql;
}
