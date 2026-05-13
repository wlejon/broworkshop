// FBm tile generator. Runs on a Worker so the main thread never blocks on
// a multi-million-sample FastNoise2 call (which is what was producing the
// ~1Hz JS spike on Perlin/Value/Cellular). The main thread keeps rendering
// the previously-uploaded tile via the cheap viewRect-slide path while we
// fill the next one here.

let baseNode = null, fbmNode = null;
let lastType = null, lastOctaves = -1, lastGain = NaN, lastLacunarity = NaN;

function ensureNodes(type, octaves, gain, lacunarity) {
    if (type === lastType && octaves === lastOctaves
        && gain === lastGain && lacunarity === lastLacunarity) {
        return;
    }
    baseNode = FastNoise.create(type);
    if (octaves > 1) {
        fbmNode = FastNoise.FractalFBm();
        fbmNode.set('Source', baseNode);
        fbmNode.set('Octaves', octaves | 0);
        fbmNode.set('Gain', gain);
        fbmNode.set('Lacunarity', lacunarity);
    } else {
        fbmNode = baseNode;
    }
    lastType = type;
    lastOctaves = octaves;
    lastGain = gain;
    lastLacunarity = lacunarity;
}

self.onmessage = (e) => {
    const m = e.data;
    ensureNodes(m.type, m.octaves, m.gain, m.lacunarity);

    const buf = new Float32Array(m.buffer);
    // Match the Simplex GPU shader's (px + uOrigin) * uFrequency convention:
    // scroll offset is in pixel units, so scale by frequency to feed
    // FastNoise2's world-space xOffset.
    fbmNode.genUniformGrid2DInto(
        buf,
        m.tileOx * m.frequency,
        m.oy * m.frequency,
        m.tileW, m.tileH,
        m.frequency, m.seed);

    self.postMessage({
        id: m.id,
        buffer: buf.buffer,
        tileW: m.tileW, tileH: m.tileH,
        tileOx: m.tileOx, oy: m.oy,
    }, [buf.buffer]);
};
