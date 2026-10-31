// The planet's clouds: one cloud field over the sphere, drawn as a volume
// (scene.createVolume) the view's rays march, and read by the ground for the
// clouds' shadows.
//
// The field is a cumulus layer. At a point of the layer the column holds an
// amount F: the weather (where cloud systems are, over thousands of km) plus
// octaves of detail down to a few tens of metres. Cloud fills the column from
// a flat base up to where its height needs more than F (rounded tops, the
// tallest where F is largest). Seen from any distance it is the same field:
// the octaves a pixel's footprint cannot resolve are replaced by what they
// average to, the chance that the unresolved detail would still put cloud
// there (their sum taken as Gaussian), so a far pixel sees the cloud
// fraction its patch of sky would have up close, and its rays pass through
// as many cloudy columns and clear ones as that fraction says (the march's
// sub-columns). Refinement only sharpens it, as the sea's waves turn into
// its roughness (Bruneton, Neyret and Holzschuch 2010). The field is
// produced by a kernel into a tile cache over the sphere (clouds.bk), so a
// shader reads a column in a few loads, whatever its footprint. The view's
// rays march it, and are lit, in the volume's hook (clouds_volume.bk).

// The layer's shape is clouds.bk's (CLOUD_BASE, CLOUD_DEPTH), here for the
// near grid's gate and the tests.
export const CLOUD_BASE = 1100;       // m above the broad ground under it (clouds.bk k_cloud_lift): the layer's floor
export const CLOUD_DEPTH = 3000;      // m from the floor to the tallest tops
const NEAR_RANGE = 1500;              // m from the eye the engine's near grid integrates (userMedium)
const REFERENCE_FINE = 16;            // the reference march's steps, this many times finer
const NEAR_MARGIN = 300;              // m about the layer's heights the eye uses the grid within
const NOISE_VAR = 0.0728;             // the Perlin noise's variance (ground.bk PERLIN_VAR)
const NOISE_SLOPE = 2.5;              // a bound on its gradient, per lattice unit

// The layer's lift (clouds.bk k_cloud_lift) on six cube faces of FACE + 2
// texels (the faces' edges and a texel beyond), DELTA_GLOBE of the face
// plane apart.
const FACE = 256;
const DELTA_GLOBE = 2 / (FACE - 1);
const FACE_TEXELS = (FACE + 2) * (FACE + 2);

// The view's volume reads the field from a tile cache (bro.tiles,
// clouds.bk k_cloud_tile): TILE cells a tile's edge and TILE_BORDER beyond
// it, a cell's column at a footprint of two cells, refined wherever a cell
// projects over TILE_PIXELS pixels, so every part of the view reads its own
// footprint. TILE_LEVELS deep: 49 m footprints at a face's centre (finer is
// the detail's, CLOUD_COLUMN_MIN).
const TILE = 64, TILE_BORDER = 1, TILE_CELLS = TILE + 2 * TILE_BORDER, TILE_LEVELS = 13;
const TILE_PIXELS = 1, TILE_CAPACITY = 6144, TILE_ATLAS = 2;

// The ground reads what the clouds leave of its light from a second tile
// cache (clouds.bk k_cloud_ground) over the ground's heights, refined where
// the ground is seen: GROUND_TILE cells an edge, a cell projecting over
// GROUND_PIXELS pixels splits, GROUND_LEVELS deep (24 m cells at a face's
// centre, as the column's finest tiles). Light from a cloud a kilometre
// up is softer than the ground's vertices, so its cells are a few pixels.
const GROUND_TILE = 32, GROUND_BORDER = 1, GROUND_CELLS = GROUND_TILE + 2 * GROUND_BORDER, GROUND_LEVELS = 14;
const GROUND_PIXELS = 4, GROUND_CAPACITY = 4096, GROUND_ATLAS = 2;
// For the readers' modules.
export const GROUND_LIGHT = { tile: GROUND_TILE, border: GROUND_BORDER, levels: GROUND_LEVELS, atlas: GROUND_ATLAS };

// The column's octaves (clouds.bk column): wavelength and amplitude.
const OCTAVES = [];
for (let k = 0, w = 2.0e6, a = 0.48; k < 7; k++, w /= 2, a *= 0.6) OCTAVES.push([w, a]);
for (let k = 0, w = 12800, a = 0.32; k < 10; k++, w /= 2, a *= 0.62) OCTAVES.push([w, a]);

// The detail's noise (cloudNoise): gradient noise (Perlin 2002's gradients)
// over a lattice tiling every NOISE_PERIOD units, sampled NOISE_CELL texels
// a unit into NOISE_TEXELS^3 texels (a 3D texture), its z slices one after another, scaled
// to NOISE_VAR's variance.
const NOISE_PERIOD = 16, NOISE_CELL = 4, NOISE_TEXELS = NOISE_PERIOD * NOISE_CELL;
function noiseSlices() {
    const P = NOISE_PERIOD, n = NOISE_TEXELS;
    const hash = new Uint8Array(P * P * P);
    for (let i = 0; i < hash.length; i++) {
        let h = Math.imul(i + 1, 0x9e3779b1);
        h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
        hash[i] = (h ^ (h >>> 13)) & 15;
    }
    const grad = (x, y, z, fx, fy, fz) => {
        const h = hash[((z % P) * P + (y % P)) * P + (x % P)];
        const a = h < 8 ? fx : fy;
        const b = h < 4 ? fy : (h === 12 || h === 14 ? fx : fz);
        return ((h & 1) ? -a : a) + ((h & 2) ? -b : b);
    };
    const fade = (t) => t * t * t * (t * (t * 6 - 15) + 10);
    const mix = (a, b, t) => a + (b - a) * t;
    const out = new Float32Array(n * n * n);
    let sum = 0, sum2 = 0;
    for (let k = 0; k < n; k++) for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
        const x = Math.floor(i / NOISE_CELL), y = Math.floor(j / NOISE_CELL), z = Math.floor(k / NOISE_CELL);
        const fx = (i % NOISE_CELL) / NOISE_CELL, fy = (j % NOISE_CELL) / NOISE_CELL, fz = (k % NOISE_CELL) / NOISE_CELL;
        const u = fade(fx), v = fade(fy), w = fade(fz);
        const x00 = mix(grad(x, y, z, fx, fy, fz), grad(x + 1, y, z, fx - 1, fy, fz), u);
        const x10 = mix(grad(x, y + 1, z, fx, fy - 1, fz), grad(x + 1, y + 1, z, fx - 1, fy - 1, fz), u);
        const x01 = mix(grad(x, y, z + 1, fx, fy, fz - 1), grad(x + 1, y, z + 1, fx - 1, fy, fz - 1), u);
        const x11 = mix(grad(x, y + 1, z + 1, fx, fy - 1, fz - 1), grad(x + 1, y + 1, z + 1, fx - 1, fy - 1, fz - 1), u);
        const val = mix(mix(x00, x10, v), mix(x01, x11, v), w);
        out[(k * n + j) * n + i] = val;
        sum += val;
        sum2 += val * val;
    }
    const mean = sum / out.length, scale = Math.sqrt(NOISE_VAR / (sum2 / out.length - mean * mean));
    let abs = 0, abs2 = 0;
    for (let i = 0; i < out.length; i++) {
        out[i] = (out[i] - mean) * scale;
        abs += Math.abs(out[i]);
        abs2 += out[i] * out[i];
    }
    BILLOW_MEAN = abs / out.length;
    BILLOW_VAR = abs2 / out.length - BILLOW_MEAN * BILLOW_MEAN;
    return out;
}
// The billows' noise (cloudDetailed): the noise's magnitude less its mean,
// and its variance, from the slices.
let BILLOW_MEAN = 0, BILLOW_VAR = 0;
const NOISE = noiseSlices();
// The variance the detail adds to a column at full amount (clouds.bk
// cloud_light's detail_var, clouds_volume.bk's).
export const CLOUD_DETAIL_VAR = NOISE_VAR * (0.07 * 0.07 + 0.04 * 0.04) + BILLOW_VAR * (0.03 * 0.03 + 0.02 * 0.02);

// A bound on the gradient (per m along the layer) of the column resolved at
// footprint w: what a level's amount can change by within a distance.
function gradientBound(w) {
    let g = 0;
    for (const [wavelength, amp] of OCTAVES) {
        const r = Math.min(Math.max(wavelength / w * 0.5 - 1, 0), 1);
        g += r * amp * NOISE_SLOPE / wavelength;
    }
    // The streets (clouds.bk column): rows 2 pi a row across, as dense as
    // the parallels and the warp make them, and their regions' change.
    const r = Math.min(Math.max(STREETS.spacing / w * 0.5 - 1, 0), 1);
    const rowsPerM = 1 / STREETS.spacing + STREETS.warpRows * NOISE_SLOPE / STREETS.warp;
    g += r * STREETS.amp * 2 * Math.PI * rowsPerM + STREETS.amp * 4 * NOISE_SLOPE / STREETS.region;
    return g;
}
const STREETS = { spacing: 4000, amp: 0.09, region: 800000, warp: 80000, warpRows: 3 };

// Cube face i (0..5): axis i % 3, its sign, and the plane's axes, the same
// in the kernel's dispatch and the shader.
export function faceFrame(i) {
    const axis = i % 3, sign = i < 3 ? 1 : -1;
    const a = [0, 0, 0], e = [0, 0, 0], f = [0, 0, 0];
    a[axis] = sign;
    e[(axis + 1) % 3] = 1;
    f[(axis + 2) % 3] = 1;
    return { a, e, f };
}

// The clouds' volume in `scene`, its column field produced by `module`'s
// k_cloud_tile (clouds.bk) into a tile cache and its lift by k_cloud_lift
// once; and what the clouds leave of the ground's light (k_cloud_ground) in
// a second cache over the ground's heights (0 to maxGround metres), bound
// to each of `readers` (nodes whose modules read it: cloud_lookup, the
// cache's lookup; cloud_ground, its pool as a unorm8 texture array; and the
// uniform cloud_w0, the footprint of a root's cells at a face's centre).
// update() each frame with the eye about the planet's centre (f64), its
// altitude, the unit direction to the sun and the view.
export function createClouds(scene, radius, module, readers, seed, hook, maxGround) {
    // The volume's module is built as the oracles it runs (clouds_volume.bk
    // cloud_oracle): constants, so the shipped build carries neither; a
    // change of oracle builds it again (setShaderModule) and binds its
    // values anew (bind, below).
    const volumeModules = (fine, sunMarch) => ({
        ...hook.modules,
        cloud_oracle: `module cloud_oracle;\npub const FINE: f32 = ${fine.toFixed(1)};\npub const SUN_MARCH: bool = ${sunMarch};\n`,
    });
    let built = '1,false';
    const node = scene.createVolume({
        module: hook.source, file: 'clouds_volume.bk', modules: volumeModules(1, false), name: 'clouds',
    });
    const toSun = [0, 0, 0];   // none yet: the first update lights them all

    // The lift, on the cube's faces, and each texel's direction for
    // the range about the eye.
    const lift = bro.kernel.createBuffer(6 * FACE_TEXELS * 4);
    const kLift = module.kernel('k_cloud_lift');
    const liftDirs = new Float32Array(6 * FACE_TEXELS * 3);
    for (let i = 0; i < 6; i++) {
        const fr = faceFrame(i);
        kLift.dispatch([FACE + 2, FACE + 2], lift, i * FACE_TEXELS, FACE + 2,
            fr.a[0], fr.a[1], fr.a[2], fr.e[0], fr.e[1], fr.e[2], fr.f[0], fr.f[1], fr.f[2],
            -1 - DELTA_GLOBE, DELTA_GLOBE, radius, seed);
        for (let y = 0; y < FACE + 2; y++) {
            for (let x = 0; x < FACE + 2; x++) {
                const u = -1 - DELTA_GLOBE + x * DELTA_GLOBE, v = -1 - DELTA_GLOBE + y * DELTA_GLOBE;
                const p = [0, 1, 2].map((c) => fr.a[c] + fr.e[c] * u + fr.f[c] * v);
                const l = Math.hypot(p[0], p[1], p[2]);
                liftDirs.set([p[0] / l, p[1] / l, p[2] / l], 3 * (i * FACE_TEXELS + y * (FACE + 2) + x));
            }
        }
    }
    const liftCpu = lift.read(new Float32Array(6 * FACE_TEXELS));
    // The least and most lift within a ray's reach of the eye (the volume
    // marches 600 km at most), found again once the eye has moved 20 km.
    const liftRange = [0, 0];
    let liftAt = null;
    function updateLiftRange(eye) {
        const r = Math.hypot(eye[0], eye[1], eye[2]);
        const e = [eye[0] / r, eye[1] / r, eye[2] / r];
        if (liftAt && e[0] * liftAt[0] + e[1] * liftAt[1] + e[2] * liftAt[2] > Math.cos(20000 / radius)) return;
        liftAt = e;
        const reach = Math.cos(Math.min(Math.PI, (6.5e5 + Math.sqrt(Math.max(0, r * r - radius * radius))) / radius));
        // And about the eye, for the near grid's gate: the texels within
        // the 20 km it may move and two texels more (the lift is bilinear
        // between them).
        const close = Math.cos(20000 / radius + 2 * DELTA_GLOBE);
        let lo = Infinity, hi = 0, nearLo = Infinity, nearHi = -Infinity;
        for (let i = 0; i < liftCpu.length; i++) {
            const c = e[0] * liftDirs[3 * i] + e[1] * liftDirs[3 * i + 1] + e[2] * liftDirs[3 * i + 2];
            if (c < reach) continue;
            lo = Math.min(lo, liftCpu[i]);
            hi = Math.max(hi, liftCpu[i]);
            if (c < close) continue;
            nearLo = Math.min(nearLo, liftCpu[i]);
            nearHi = Math.max(nearHi, liftCpu[i]);
        }
        liftRange[0] = Number.isFinite(lo) ? lo : 0;
        liftRange[1] = hi;
        liftNear[0] = Number.isFinite(nearLo) ? nearLo : liftRange[0];
        liftNear[1] = Number.isFinite(nearHi) ? nearHi : liftRange[1];
        node.setShaderUniform('lift_range', liftRange);
    }
    const liftNear = [0, 0];

    // Each tile's column field (k_cloud_tile), then its sun field from it and
    // the tiles ready (k_cloud_sun), for the sun toward toSun: produced again
    // (TileCache.refresh) once the sun moves.
    const kTile = module.kernel('k_cloud_tile'), kSun = module.kernel('k_cloud_sun');
    const cache = bro.tiles.createCache({
        domain: { type: 'cubeSphere', radius, center: [0, 0, 0] },
        tileSize: TILE, border: TILE_BORDER, capacity: TILE_CAPACITY, maxLevel: TILE_LEVELS,
        minHeight: CLOUD_BASE, maxHeight: CLOUD_BASE + CLOUD_DEPTH + Math.max(...liftCpu),
        pixelsPerCell: TILE_PIXELS, producePerUpdate: 64,
        layers: { column: 4, sun: 8 },
        produce(batch) {
            kTile.dispatch([TILE_CELLS, TILE_CELLS, batch.count], batch.table, this.layer('column'),
                           TILE_CELLS, TILE, TILE_BORDER, radius);
            kSun.dispatch([TILE_CELLS, TILE_CELLS, batch.count], batch.table, this.lookup, this.layer('column'),
                          this.layer('sun'), TILE_CELLS, TILE, TILE_BORDER, TILE_LEVELS, 4 * radius / TILE,
                          radius, seed, toSun[0], toSun[1], toSun[2], CLOUD_DETAIL_VAR);
        },
    });
    // Per tile level: its cells' footprint at a face's centre, and the
    // column's gradient bound there (at the least stretch over a face).
    const bounds = new Float32Array(4 * (TILE_LEVELS + 1));
    for (let l = 0; l <= TILE_LEVELS; l++) {
        const w = 2 * radius * (2 / 2 ** l / TILE);
        bounds.set([w, gradientBound(w * 0.35)], 4 * l);
    }
    const boundsBuffer = bro.kernel.createBuffer(bounds);

    // The ground's light (k_cloud_ground), for the sun toward toSun:
    // produced again (TileCache.refresh) once the sun moves.
    const kGround = module.kernel('k_cloud_ground');
    const ground = bro.tiles.createCache({
        domain: { type: 'cubeSphere', radius, center: [0, 0, 0] },
        tileSize: GROUND_TILE, border: GROUND_BORDER, capacity: GROUND_CAPACITY, maxLevel: GROUND_LEVELS,
        minHeight: 0, maxHeight: maxGround, pixelsPerCell: GROUND_PIXELS, producePerUpdate: 64,
        layers: { light: 4 },
        produce(batch) {
            kGround.dispatch([GROUND_CELLS, GROUND_CELLS, batch.count], batch.table, this.layer('light'),
                             GROUND_CELLS, GROUND_TILE, GROUND_BORDER, radius, seed,
                             toSun[0], toSun[1], toSun[2], CLOUD_DETAIL_VAR);
        },
    });
    for (const n of readers) {
        n.setShaderBuffer('cloud_lookup', ground.lookup);
        n.setShaderTexture('cloud_ground', { buffer: ground.layer('light'), width: GROUND_CELLS, height: GROUND_CELLS,
                                             layers: GROUND_CAPACITY, atlas: GROUND_ATLAS, channels: 4, format: 'unorm8' });
        n.setShaderUniform('cloud_w0', 4 * radius / GROUND_TILE);
    }

    // The volume's values that hold: its constants, the detail's noise, the
    // lift's faces, and the tile cache's lookup, pool (as a texture array,
    // TILE_ATLAS x TILE_ATLAS slots a layer, GPUs commonly giving 2048
    // layers, its 16-bit halves filtered by the hardware; only the slots each
    // update produces are copied into it), levels' bounds and sun field (four
    // depths a cell, 16 bits each).
    function bind() {
        node.setShaderUniform('radius', radius);
        node.setShaderUniform('billow_mean', BILLOW_MEAN);
        node.setShaderUniform('billow_var', BILLOW_VAR);
        node.setShaderUniform('detail_var', CLOUD_DETAIL_VAR);
        node.setShaderTexture('noise', { data: NOISE, width: NOISE_TEXELS, height: NOISE_TEXELS, depth: NOISE_TEXELS, repeat: true });
        node.setShaderTexture('lift_faces', { data: liftCpu, width: FACE + 2, height: FACE + 2, layers: 6, channels: 1 });
        node.setShaderBuffer('lookup', cache.lookup);
        node.setShaderTexture('columns', { buffer: cache.layer('column'), width: TILE_CELLS, height: TILE_CELLS,
                                           layers: TILE_CAPACITY, atlas: TILE_ATLAS, channels: 2, format: 'unorm16' });
        node.setShaderBuffer('bounds', boundsBuffer);
        node.setShaderTexture('sun_field', { buffer: cache.layer('sun'), width: TILE_CELLS, height: TILE_CELLS,
                                             layers: TILE_CAPACITY, atlas: TILE_ATLAS, channels: 4, format: 'unorm16' });
        node.setShaderUniform('lift_range', liftRange);
    }
    bind();

    let reference = false, sunReference = false;
    const hi = [0, 0, 0], lo = [0, 0, 0];
    return {
        node,
        // The volume's tile cache, and the ground light's; the unit
        // direction to the sun they were last lit for.
        cache, ground, sun: toSun,
        // `view` is the camera as a tile cache takes it (TileCache.update).
        update(eye, altitude, sun, view) {
            // The oracles asked for, built first: a module set anew holds
            // none of the node's values until bound again.
            const fine = reference === true ? REFERENCE_FINE : reference || 1;
            if (`${fine},${sunReference}` !== built) {
                built = `${fine},${sunReference}`;
                node.setShaderModule(hook.source, 'clouds_volume.bk', volumeModules(fine, sunReference));
                bind();
            }
            // A sun moved by a tenth of a degree lights everything anew: the
            // tiles' sun fields and the ground's light, produced again.
            if (sun[0] * toSun[0] + sun[1] * toSun[1] + sun[2] * toSun[2] < Math.cos(0.1 * Math.PI / 180)) {
                toSun[0] = sun[0];
                toSun[1] = sun[1];
                toSun[2] = sun[2];
                cache.refresh();
                ground.refresh();
            }
            cache.update(view);
            ground.update(view);
            updateLiftRange(eye);
            for (let k = 0; k < 3; k++) {
                hi[k] = Math.fround(eye[k]);
                lo[k] = eye[k] - hi[k];
            }
            node.setShaderUniform('cam_hi', hi);
            node.setShaderUniform('cam_lo', lo);
            node.setShaderUniform('cam_alt', altitude);
            // The near grid while the eye is in the layer's heights or about
            // them, where a march takes its many steps close by; further
            // off, it crosses the air to the layer in one.
            const near = altitude > CLOUD_BASE + liftNear[0] - NEAR_MARGIN &&
                         altitude < CLOUD_BASE + CLOUD_DEPTH + liftNear[1] + NEAR_MARGIN;
            node.setShaderUniform('near_range', near && !reference ? NEAR_RANGE : 0);
        },
        // The sun's depth light-marched through the field itself at every
        // sample, its detail included, in place of the depth's model: what
        // that model is measured against (a look change's oracle, with
        // `reference` for the march's steps; never shipped on).
        get sunReference() { return sunReference; },
        set sunReference(on) { sunReference = !!on; },
        // The reference: the whole march in steps 16 times finer (or a
        // number, that many: a convergence sweep), no near grid, at many
        // times the cost, what the march and the grid are measured against
        // (a look change's oracle; never shipped on).
        get reference() { return reference; },
        set reference(on) { reference = typeof on === 'number' ? Math.max(1, Math.round(on)) : !!on; },
    };
}
