// Multi-landform procedural terrain mesh with built-in voxeldag carve cutout hook.
const clamp = (x, lo, hi) => (x < lo ? lo : x > hi ? hi : x);
const mix = (a, b, t) => a + (b - a) * t;
const smoothstep = (e0, e1, x) => {
    const t = clamp((x - e0) / (e1 - e0), 0, 1);
    return t * t * (3 - 2 * t);
};

function hash2(ix, iz) {
    let n = Math.imul(ix, 374761393) + Math.imul(iz, 668265263);
    n = Math.imul(n ^ (n >>> 13), 1274126177);
    return ((n ^ (n >>> 16)) >>> 0) / 4294967295;
}

function vnoise(x, z) {
    const ix = Math.floor(x), iz = Math.floor(z);
    const fx = x - ix, fz = z - iz;
    const ux = fx * fx * (3 - 2 * fx);
    const uz = fz * fz * (3 - 2 * fz);
    const a = hash2(ix, iz);
    const b = hash2(ix + 1, iz);
    const c = hash2(ix, iz + 1);
    const d = hash2(ix + 1, iz + 1);
    return mix(mix(a, b, ux), mix(c, d, ux), uz) * 2 - 1;
}

function fbm(x, z, octaves = 4) {
    let sum = 0, amp = 0.5, freq = 1.0;
    for (let i = 0; i < octaves; i++) {
        sum += amp * vnoise(x * freq, z * freq);
        freq *= 2.03;
        amp *= 0.5;
    }
    return sum;
}

function ridgeFbm(x, z, octaves = 4) {
    let sum = 0, amp = 0.5, freq = 1.0;
    for (let i = 0; i < octaves; i++) {
        const r = 1.0 - Math.abs(vnoise(x * freq, z * freq));
        sum += amp * r * r;
        freq *= 2.08;
        amp *= 0.5;
    }
    return sum;
}

/** Deterministic showcase terrain height at world (x, z) in meters. */
export function heightAt(x, z) {
    // 1. Base valley rolling hills and broad basin relief
    let h = 16.8 + fbm(x * 0.0085 + 3.1, z * 0.0085 - 1.7, 4) * 4.2;

    // 2. West Windmill Terraces: gentle sunlit hills around x in [-135, -42], z in [-8, +76]
    const wdx = (x + 86) / 56;
    const wdz = (z - 32) / 50;
    const wMask = Math.exp(-(wdx * wdx + wdz * wdz));
    h += wMask * (6.2 + fbm(x * 0.022 + 9.0, z * 0.022, 3) * 2.4);

    // 3. Winding gorge running under the Natural Stone Arch at (8, -24)
    const gCenterX = 8.0 + (z + 24) * 0.28 + Math.sin(z * 0.07) * 3.0;
    const gDist = Math.abs(x - gCenterX);
    const gSpanZ = Math.exp(-Math.pow((z + 24) / 36, 2));
    const gCut = Math.exp(-Math.pow(gDist / 8.5, 2)) * gSpanZ;
    h -= gCut * 10.0;

    // 4. North Stratified Escarpment Cliff: steep south-facing sandstone wall at z ~ -47.2..-53.8
    // Keep hero cliff sites at x = -24 (cavern) and x = +40 (overhang) aligned straight along z
    // so z <= -53 sits >= 44 m (burying the 16 m..32 m cavern/overhang shells inside real rock!).
    const siteFlatten =
        Math.exp(-Math.pow((x + 24) / 18, 2)) +
        Math.exp(-Math.pow((x - 40) / 18, 2));
    const warpZ = (fbm(x * 0.024, 4.7, 3) * 4.5) * (1 - clamp(siteFlatten, 0, 1));
    const cliffZ = z - warpZ;
    const mesaBand = Math.exp(-Math.pow(x / 185, 4));
    const northRamp = smoothstep(-47.0, -53.8, cliffZ);
    const northFade = smoothstep(-280, -140, z);
    const mesaTop = 30.5 + ridgeFbm(x * 0.014, z * 0.014, 3) * 14.0 * (1 - clamp(siteFlatten * 0.65, 0, 0.85));
    h += mesaBand * northRamp * northFade * mesaTop;

    // Level apron immediately in front of Cavern (-24, -44) and Overhang (+40, -44)
    const cApron = Math.exp(-Math.pow((x + 24) / 10, 2) - Math.pow((z + 42.5) / 4.2, 2));
    const oApron = Math.exp(-Math.pow((x - 40) / 10, 2) - Math.pow((z + 42.0) / 4.2, 2));
    h = mix(h, 18.5, clamp(cApron * 0.88, 0, 0.92));
    h = mix(h, 18.4, clamp(oApron * 0.88, 0, 0.92));

    // 5. East Promontory: exact y = 24.0 m flat stone platform for the 32 m Recursive Pyramid at (72, 18)
    const pd = Math.hypot(x - 72, z - 18);
    if (pd < 44) {
        const pMask = 1.0 - smoothstep(23.5, 43.0, pd);
        h = mix(h, 24.0, pMask);
    }

    // 6. Outer Mountain Amphitheater Rim & Karst Ridges (r = 210..1150 m)
    const r = Math.hypot(x, z);
    const rimT = smoothstep(185, 460, r);
    const farT = smoothstep(320, 960, r);
    const ridges = ridgeFbm(x * 0.0042 - 2.3, z * 0.0042 + 5.1, 4);
    const broadHills = fbm(x * 0.0022 + 11.4, z * 0.0022 - 7.8, 3);
    h += rimT * (18.0 + ridges * 74.0) + farT * (32.0 + broadHills * 38.0);

    return h;
}

/** Central-difference unit surface normal [nx, ny, nz] at world (x, z). */
export function normalAt(x, z, eps = 0.8) {
    const hL = heightAt(x - eps, z);
    const hR = heightAt(x + eps, z);
    const hD = heightAt(x, z - eps);
    const hU = heightAt(x, z + eps);
    const nx = hL - hR, ny = 2 * eps, nz = hD - hU;
    const l = Math.hypot(nx, ny, nz) || 1;
    return [nx / l, ny / l, nz / l];
}

/** Analytical terrain raycast along `dir` from `origin` up to `maxDist` meters. */
export function raycastTerrain(origin, dir, maxDist = 280) {
    const step = 1.25;
    let prevT = 0;
    let prevDiff = origin[1] - heightAt(origin[0], origin[2]);
    if (prevDiff <= 0) return null;

    for (let t = step; t <= maxDist; t += step) {
        const px = origin[0] + dir[0] * t;
        const py = origin[1] + dir[1] * t;
        const pz = origin[2] + dir[2] * t;
        const diff = py - heightAt(px, pz);
        if (diff <= 0) {
            let lo = prevT, hi = t;
            for (let it = 0; it < 10; it++) {
                const mid = 0.5 * (lo + hi);
                const mx = origin[0] + dir[0] * mid;
                const my = origin[1] + dir[1] * mid;
                const mz = origin[2] + dir[2] * mid;
                if (my - heightAt(mx, mz) > 0) lo = mid;
                else hi = mid;
            }
            const hitT = 0.5 * (lo + hi);
            const hx = origin[0] + dir[0] * hitT;
            const hz = origin[2] + dir[2] * hitT;
            return { position: [hx, heightAt(hx, hz), hz], dist: hitT };
        }
        prevT = t;
        prevDiff = diff;
    }
    return null;
}

function biomeColor(x, y, z, ny) {
    const slope = 1 - clamp(ny, 0, 1);
    const noiseMod = vnoise(x * 0.035, z * 0.035) * 0.5 + 0.5;
    const lush = [0.10, 0.24, 0.08];
    const sunlitGrass = [0.22, 0.31, 0.10];
    const alpineLimestone = [0.42, 0.39, 0.34];
    const sandstone = [0.48, 0.28, 0.18];
    const gorgeSlate = [0.16, 0.17, 0.17];
    const snow = [0.84, 0.87, 0.90];

    let c = [
        mix(lush[0], sunlitGrass[0], noiseMod),
        mix(lush[1], sunlitGrass[1], noiseMod),
        mix(lush[2], sunlitGrass[2], noiseMod),
    ];

    // Promontory stone plinth accent around (72, 18)
    const prom = 1 - smoothstep(18, 30, Math.hypot(x - 72, z - 18));
    c = c.map((v, i) => mix(v, alpineLimestone[i], prom * 0.78));

    // Gorge pebble & slate tone
    const gorge = smoothstep(14.5, 9.5, y);
    c = c.map((v, i) => mix(v, gorgeSlate[i], gorge * 0.82));

    // High-altitude alpine rock + snow caps on outer peaks
    const highRock = smoothstep(52, 92, y);
    c = c.map((v, i) => mix(v, alpineLimestone[i], highRock * 0.72));
    const snowMask = smoothstep(105, 138, y) * smoothstep(0.55, 0.88, ny);
    c = c.map((v, i) => mix(v, snow[i], snowMask));

    // Steep sandstone escarpment rock
    const cliff = smoothstep(0.20, 0.48, slope);
    c = c.map((v, i) => mix(v, sandstone[i], cliff * 0.85));

    return c;
}

/** Build the seamless multi-landform heightfield MeshNode + attach voxeldag carve shader. */
export function createTerrainMesh(scene) {
    const segs = 256;
    const n = segs + 1;
    const count = n * n;
    const positions = new Float32Array(count * 3);
    const normals = new Float32Array(count * 3);
    const colors = new Float32Array(count * 4);
    const indices = new Uint32Array(segs * segs * 6);

    const warp = (u) => 270 * u + 880 * u * u * u; // [-1150, +1150] m, dense near center

    for (let iz = 0; iz < n; iz++) {
        const uz = (iz / segs) * 2 - 1;
        const wz = warp(uz);
        for (let ix = 0; ix < n; ix++) {
            const ux = (ix / segs) * 2 - 1;
            const wx = warp(ux);
            const wy = heightAt(wx, wz);
            const [nx, ny, nz] = normalAt(wx, wz, Math.max(0.75, Math.abs(wx) * 0.008));
            const [r, g, b] = biomeColor(wx, wy, wz, ny);

            const v = iz * n + ix;
            positions[v * 3] = wx;
            positions[v * 3 + 1] = wy;
            positions[v * 3 + 2] = wz;
            normals[v * 3] = nx;
            normals[v * 3 + 1] = ny;
            normals[v * 3 + 2] = nz;
            colors[v * 4] = r;
            colors[v * 4 + 1] = g;
            colors[v * 4 + 2] = b;
            colors[v * 4 + 3] = 1.0;
        }
    }

    let k = 0;
    for (let iz = 0; iz < segs; iz++) {
        for (let ix = 0; ix < segs; ix++) {
            const a = iz * n + ix;
            const b = a + 1;
            const c = a + n;
            const d = c + 1;
            indices[k++] = a; indices[k++] = c; indices[k++] = b;
            indices[k++] = b; indices[k++] = c; indices[k++] = d;
        }
    }

    const node = scene.createMesh({
        positions, normals, colors, indices,
        roughness: 0.90,
        castsShadow: true,
    });
    attachTerrainShader(node);
    return node;
}

/** Attach custom fragment hook combining stratified cliff shading + voxeldag Carve cutouts. */
export function attachTerrainShader(meshNode) {
    meshNode.setShader({
        module: `
            module hook;
            import scene;
            import mesh;
            import voxeldag;

            struct Params {
                region_count: f32,
                carve_enabled: f32,
                pad0: f32,
                pad1: f32
            }
            @binding(4, 0) var params: uniform<Params>;
            @binding(4, 14) var regions: read_buffer<vec4<f32>>;
            @binding(4, 15) var nodes: read_buffer<vec4<u32>>;
            @binding(4, 16) var children: read_buffer<u32>;
            @binding(4, 17) var bricks: read_buffer<vec4<u32>>;

            pub fn fragment(v: mesh::Vertex, s: mesh::Surface) -> mesh::Surface {
                let wp = v.world_pos + scene::camera.eye_world.xyz;
                if (params.carve_enabled > 0.5 && params.region_count > 0.5) {
                    if (voxeldag::is_carved_static_at(wp, params.region_count as u32,
                                                       regions, nodes, children, bricks)) {
                        discard_fragment();
                    }
                }
                let n = normalize(v.normal);
                let slope = 1.0 - clamp(n.y, 0.0, 1.0);
                let strata = 0.5 + 0.5 * sin(wp.y * 0.88 + sin(wp.x * 0.035 + wp.z * 0.03) * 2.4);
                let fine = 0.5 + 0.5 * sin(wp.y * 2.9 + wp.x * 0.14 - wp.z * 0.11);
                let turf = 0.92 + 0.10 * sin(wp.x * 0.55 + wp.z * 0.42) * sin(wp.z * 0.68 - wp.x * 0.31);

                let rockA = vec3<f32>(0.54, 0.31, 0.20);
                let rockB = vec3<f32>(0.27, 0.20, 0.17);
                let rockTint = mix(rockA, rockB, strata * 0.72 + fine * 0.28);
                let cliffMask = smoothstep(0.22, 0.48, slope);

                var out = s;
                out.base_color = mix(s.base_color * turf, rockTint * (0.86 + 0.24 * fine), cliffMask * 0.84);
                out.roughness = clamp(mix(0.88, 0.95, cliffMask), 0.5, 1.0);
                return out;
            }
        `,
    });
}
