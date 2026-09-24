// FBm tile generator for viz/noise.js. A multi-million-sample FastNoise2
// call on the main thread was a ~1 Hz frame spike; here it runs off-thread
// while the page keeps sliding its viewRect over the previous tile.

let node = null, key = '';

function ensureNode(m) {
    const k = [m.type, m.octaves, m.gain, m.lacunarity].join('|');
    if (k === key) return;
    const base = FastNoise.create(m.type);
    // FastNoise2 generators default to a feature scale of ~100 units; 1
    // makes `frequency` mean features per unit, like the GPU fbm2D shader.
    base.set('Feature Scale', 1);
    if (m.octaves > 1) {
        node = FastNoise.FractalFBm();
        node.set('Source', base);
        node.set('Octaves', m.octaves | 0);
        node.set('Gain', m.gain);
        node.set('Lacunarity', m.lacunarity);
    } else {
        node = base;
    }
    key = k;
}

self.onmessage = (e) => {
    const m = e.data;
    ensureNode(m);
    const buf = new Float32Array(m.buffer);
    // Scroll offsets are in pixels, like the Simplex GPU shader's
    // (px + origin) * frequency, so scale them into FastNoise's world space.
    node.genUniformGrid2DInto(buf, m.tileOx * m.frequency, m.oy * m.frequency,
                              m.tileW, m.tileH, m.frequency, m.seed);
    self.postMessage({ buffer: buf.buffer, tileW: m.tileW, tileH: m.tileH, tileOx: m.tileOx, oy: m.oy },
                     [buf.buffer]);
};
