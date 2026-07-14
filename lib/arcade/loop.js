// Arcade kernel — fixed rAF loop with clamped dt (milliseconds).
//
//   import { createLoop } from "/lib/arcade/loop.js";
//   const loop = createLoop({ update, draw });
//   loop.start();

const MAX_DT_MS = 100;

/**
 * @param {object} opts
 * @param {(dt: number) => void} [opts.update]
 * @param {(dt: number) => void} [opts.draw]
 * @param {number} [opts.maxDt]
 */
export function createLoop(opts = {}) {
    const update = opts.update || (() => {});
    const draw = opts.draw || (() => {});
    const maxDt = opts.maxDt != null ? opts.maxDt : MAX_DT_MS;

    let running = false;
    let lastT = 0;
    let rafId = 0;

    function frame(t) {
        if (!running) return;
        rafId = requestAnimationFrame(frame);
        const dt = Math.min(maxDt, t - lastT);
        lastT = t;
        update(dt);
        draw(dt);
    }

    return {
        start() {
            if (running) return;
            running = true;
            lastT = performance.now();
            rafId = requestAnimationFrame(frame);
        },
        stop() {
            running = false;
            if (rafId) cancelAnimationFrame(rafId);
            rafId = 0;
        },
        isRunning() {
            return running;
        },
    };
}
