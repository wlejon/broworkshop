// Planet clouds — the column field's clipmap (clouds.js, clouds.bk) holds
// one field at every scale: each level is the field filtered to its texels,
// so where a level resolves the column the others agree within the
// variance they leave unresolved, and the cloud cover a fine level counts
// is the cover the coarse level's statistics predict (the occupancy's
// logistic over its unresolved variance).
//   Run: scripts/validate.sh demos/planet
import { check, frames, test, done } from "/lib/kit/test.js";

const clouds = planet.clouds;
const { levels, n } = clouds.layout;
const sigmoid = (x) => 1 / (1 + Math.exp(-x));

function readMap() {
    const map = new Float32Array(clouds.map.byteLength / 4);
    clouds.map.read(map);
    return map;
}

// Level k's (F, variance) at plane point (u, v), bilinear; null outside.
function sample(map, k, u, v) {
    const h = clouds.head;
    const tx = (u - h[4 * k]) / h[4 * k + 2], ty = (v - h[4 * k + 1]) / h[4 * k + 2];
    if (!(tx >= 0 && ty >= 0 && tx < n - 1 && ty < n - 1)) return null;
    const x = Math.floor(tx), y = Math.floor(ty), fx = tx - x, fy = ty - y;
    // The level's grid wraps from its origin in texels (after the headers).
    const ox = h[4 * (levels + 1 + k)], oy = h[4 * (levels + 1 + k) + 1];
    const at = (i, j, c) => map[2 * (k * n * n + ((oy + j) & (n - 1)) * n + ((ox + i) & (n - 1))) + c];
    const lerp = (c) => (at(x, y, c) * (1 - fx) + at(x + 1, y, c) * fx) * (1 - fy) +
                        (at(x, y + 1, c) * (1 - fx) + at(x + 1, y + 1, c) * fx) * fy;
    return [lerp(0), lerp(1)];
}

test('every level agrees at the eye within what it leaves unresolved', () => {
    Object.assign(planet.cam, { lat: 0.45, lon: 0.3, alt: 60000, pitch: -35, heading: 0 });
    frames(3);
    const map = readMap(), h = clouds.head;
    // Level 0's centre lies within every level.
    const u = h[0] + (n / 2) * h[2], v = h[1] + (n / 2) * h[2];
    const [fine] = sample(map, 0, u, v);
    let worst = 0;
    for (let k = 1; k < levels; k++) {
        const [F, V] = sample(map, k, u, v);
        worst = Math.max(worst, Math.abs(F - fine) / Math.sqrt(V + 1e-6));
    }
    check(worst < 4, `each level within 4 of its unresolved deviations of level 0 (worst ${worst.toFixed(2)})`);
});

test('a fine level counts the cover the coarse levels predict', () => {
    const map = readMap(), h = clouds.head;
    for (const [fine, coarse] of [[4, 10], [6, 12], [8, 13]]) {
        let cover = 0;
        for (let i = 0; i < n * n; i++) if (map[2 * (fine * n * n + i)] > 0.02) cover++;
        cover /= n * n;
        // The coarse prediction over the fine level's area.
        const u0 = h[4 * fine], v0 = h[4 * fine + 1], span = (n - 1) * h[4 * fine + 2];
        let predicted = 0, count = 0;
        for (let y = 0; y < 64; y++) for (let x = 0; x < 64; x++) {
            const s = sample(map, coarse, u0 + (x + 0.5) / 64 * span, v0 + (y + 0.5) / 64 * span);
            predicted += sigmoid(1.7 * (s[0] - 0.02) / Math.sqrt(s[1] + 1e-5));
            count++;
        }
        predicted /= count;
        check(Math.abs(cover - predicted) < 0.06,
              `level ${fine} counts ${cover.toFixed(3)} cover at the base, level ${coarse} predicts ${predicted.toFixed(3)}`);
    }
});

done('planet clouds');
