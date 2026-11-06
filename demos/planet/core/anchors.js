// Anchors for the GPU's work (anchor.bk): where the ground's noise lattices
// lie at a point near the work, found on the CPU in f64 (core/tiles.bk
// k_anchors), so a kernel places its points as f32 offsets from it.

export const ANCHOR_WORDS = 64;   // anchor.bk ANCHOR_VEC4S * 4

// `count` anchors in a KernelBuffer (`buffer`, read by anchor.bk
// read_anchor): set(i, base, dir) places anchor i at `base` (base
// coordinates in f64) with its direction rounded to f32 `dir`; write(n)
// finds the first n and writes them to the buffer, landing before later
// dispatches.
export function createAnchors(kAnchors, count, radius) {
    const src = new Float64Array(count * 6), words = new Int32Array(count * ANCHOR_WORDS);
    const buffer = bro.kernel.createBuffer(count * ANCHOR_WORDS * 4);
    return {
        buffer,
        set(i, base, dir) {
            for (let k = 0; k < 3; k++) {
                src[6 * i + k] = base[k];
                src[6 * i + 3 + k] = dir[k];
            }
        },
        write(n) {
            kAnchors.run([n], src, words, radius);
            buffer.write(n === count ? words : words.subarray(0, n * ANCHOR_WORDS));
        },
    };
}

// A face plane's patch anchored at plane point (uc, vc): plane = the face
// frame's a, e, f (nine numbers). The anchor's base point, its direction
// rounded to f32, and the offsets from it of plane point (u0, v0) for a
// kernel: du0, dv0, rounded to f32.
export function planeAnchor(plane, uc, vc) {
    const base = [0, 1, 2].map((k) => plane[k] + plane[3 + k] * uc + plane[6 + k] * vc);
    const l = Math.hypot(...base);
    const dir = base.map((x) => Math.fround(x / l));
    return { base, dir, uc, vc };
}

// The surface point of an anchor's direction at `radius`, less `origin`:
// what a kernel adds its points' offsets to.
export function anchorPoint(dir, radius, origin) {
    return [0, 1, 2].map((k) => dir[k] * radius - origin[k]);
}
