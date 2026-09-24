// Arcade — seeded randomness. Rules take an `rng` function instead of calling
// Math.random, so a test (or a replay, or a daily puzzle) can steer them.
//
//   import { seededRandom } from "/lib/arcade/random.js";
//   const rng = seededRandom(42);
//   const board = createBoard(8, 8, rng);     // same seed, same board

/** Deterministic PRNG (mulberry32) returning floats in [0, 1). */
export function seededRandom(seed) {
    let s = (seed >>> 0) || 1;
    return function rand() {
        s = (s + 0x6D2B79F5) >>> 0;
        let t = s;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}
