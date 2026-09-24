// Platform Lab — four browser-platform features bro landed that nothing else in
// the workshop exercises. None is big enough for a demo of its own, and all four
// are the kind of feature that quietly rots when no app depends on it. This lab
// depends on all four, and its smoke test measures them.
//
//   animations.js   element.animate() and the Animation object: the engine's
//                   clock (currentTime, playState) beside the engine's output
//                   (getComputedStyle). A stated time and a measured position
//                   agreeing is what proves the interpolator.
//   mediaquery.js   matchMedia against real @media rules: every query evaluated
//                   through the JS binding and through the cascade, plus the
//                   full listener surface (once / signal / capture / legacy
//                   aliases / onchange) counted independently.
//   borderimage.js  CSS nine-slice borders, checked through the five longhands
//                   in computed style and flat-colour fixture regions readable
//                   with getPixel().
//   compression.js  CompressionStream / DecompressionStream driven as streams:
//                   chunk counts, chained pipelines, container bytes, errors.
//
// House rules: panels never rebuild innerHTML per frame (rows are built once,
// only textContent changes), and every driver the UI uses is an exported named
// function, so the smoke test drives the same entry points a click does.

import { boot } from "/lib/kit/app.js";
import { stats, frameLoop } from "/lib/kit/ui.js";
import { initAnimations, tickAnimations } from "/app/animations.js";
import { initMediaQueries, tickMediaQueries, mqState } from "/app/mediaquery.js";
import { initBorderImage, tickBorderImage } from "/app/borderimage.js";
import { initCompression, cmpState } from "/app/compression.js";

/** Live counters; the smoke test reads frames to prove the loop kept running. */
export const frameStats = { frames: 0 };

export function init() {
    const app = boot();

    // The media-query table must exist before the first evaluateAll(): the CSS
    // side of the comparison reads probe elements that must already be styled.
    initMediaQueries();
    initBorderImage();
    initAnimations();
    initCompression();

    // One loop for the whole app. The animation panel samples every frame (its
    // claim is that the clock is readable at any instant); the other panels only
    // change on resize or a click, so they tick at ~10 Hz.
    const hud = stats('#stats');
    frameLoop(() => {
        tickAnimations();
        if (frameStats.frames % 6 === 0) {
            tickMediaQueries();
            tickBorderImage();
            hud.set({
                frames: frameStats.frames,
                anims: document.getAnimations().length,
                agree: mqState.agreements + ' / ' + (mqState.agreements + mqState.disagreements),
                bench: cmpState.runs.length,
            });
        }
        frameStats.frames++;
    });
    app.status.ok('ready');
}
