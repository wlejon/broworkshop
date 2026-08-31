// demos/clipmap-terrain/heightmap.js

/**
 * Procedural heightmap generator for multi-resolution clipmap terrain layers.
 */
export class HeightmapGenerator {
    constructor(seed = 1337) {
        this.seed = seed;
    }

    /**
     * Generate synthetic mountain terrain elevation data as a Float32Array.
     * @param {number} width 
     * @param {number} height 
     * @param {number} metresPerCell 
     * @param {number} originX 
     * @param {number} originZ 
     * @returns {Float32Array}
     */
    generateLayer(width, height, metresPerCell, originX, originZ) {
        const data = new Float32Array(width * height);
        const invW = 1.0 / width;
        const invH = 1.0 / height;

        for (let z = 0; z < height; z++) {
            const worldZ = originZ + (z - height * 0.5) * metresPerCell;
            for (let x = 0; x < width; x++) {
                const worldX = originX + (x - width * 0.5) * metresPerCell;

                // Base mountain ridges
                const nx = worldX * 0.00035;
                const nz = worldZ * 0.00035;

                let elevation = 0;
                let amp = 1.0;
                let freq = 1.0;

                // 4-octave ridge noise
                for (let oct = 0; oct < 4; oct++) {
                    const sx = nx * freq + oct * 12.34;
                    const sz = nz * freq + oct * 56.78;

                    // Ridge signal: 1 - |sin(x) * cos(z)|
                    const n = Math.abs(Math.sin(sx * 2.1) * Math.cos(sz * 2.1) + Math.cos(sx * 1.3 - sz * 1.7) * 0.5);
                    const ridge = 1.0 - n;
                    elevation += ridge * ridge * amp;

                    amp *= 0.5;
                    freq *= 2.0;
                }

                // Valley floor carving & mountain peaks
                elevation = Math.pow(elevation, 1.35) * 1600.0 - 200.0;

                data[z * width + x] = elevation;
            }
        }

        return data;
    }
}
