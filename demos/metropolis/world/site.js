// The land metropolis is built on, as lib/city's `site`: terrain, the river,
// and the district cores the street field and density grow from.

import { WORLD_HALF, terrainHeight, riverCenterX, riverSignedDist } from "/app/world/terrain_field.js";

function riverTangent(z) {
    const e = 2;
    const dx = (riverCenterX(z + e) - riverCenterX(z - e)) / (2 * e);
    const l = Math.hypot(dx, 1);
    return [dx / l, 1 / l];
}

/** Angle (radians, atan2(z, x)) of the river's flow at z. */
function riverAngle(z) {
    const [tx, tz] = riverTangent(z);
    return Math.atan2(tz, tx);
}

export const SITE = {
    half: WORLD_HALF,
    height: terrainHeight,
    water: riverSignedDist,
    waterTangent: (x, z) => riverTangent(z),
    centers: [
        // Downtown on the west bank, its grid square to the river.
        { name: 'downtown', x: riverCenterX(0) - 640, z: 40, r: 1300, angle: riverAngle(0), weight: 1.0 },
        // Old town across the river, an older grid at its own angle.
        { name: 'oldtown', x: riverCenterX(300) + 900, z: 300, r: 1100, angle: 0.52, weight: 0.62 },
        { name: 'midtown', x: riverCenterX(-1700) - 900, z: -1700, r: 1100, angle: riverAngle(-1700) + 0.3, weight: 0.7 },
        { name: 'harbor', x: riverCenterX(1900) - 700, z: 1900, r: 1000, angle: riverAngle(1900), weight: 0.55 },
        { name: 'eastside', x: riverCenterX(-1500) + 1500, z: -1500, r: 1200, angle: -0.25, weight: 0.42 },
        { name: 'southeast', x: riverCenterX(2600) + 1700, z: 2600, r: 1300, angle: 0.9, weight: 0.38 },
        { name: 'westgate', x: -3100, z: 600, r: 1400, angle: 0.15, weight: 0.36 },
        { name: 'northfield', x: riverCenterX(-3400) - 1200, z: -3400, r: 1300, angle: -0.6, weight: 0.33 },
    ],
};

import { hash2, noise2 } from "/lib/city/field.js";

/** Parks: a scatter of green blocks, more of them outside the core. */
SITE.isPark = (x, z, face, dens) => {
    const h = hash2(Math.round(x / 37), Math.round(z / 37), 4242);
    return h < (dens > 0.6 ? 0.04 : 0.07);
};

/** Industry: the river's lower reach, and a belt by the south-west. */
SITE.isIndustrial = (x, z, dens) => {
    const w = riverSignedDist(x, z);
    if (z > 2300 && w < 700 && dens > 0.08) return true;
    return noise2(x - 900, z + 400, 1100, 61) > 0.78 && dens < 0.45;
};
