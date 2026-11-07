// The sun and the hour: the sun turns about the planet's axis (y) with the
// hour, noon the direction it starts in, tilted off the equator by the
// world's season (its `noon`, core/world.js; NOON when it gives none).

export const NOON = [-0.55, -0.35, -0.75];
let noon = NOON;

// The world's noon: the direction the sun's light travels at hour 12
// (core/planet.js sets it from the world before anything reads the hour).
export function setNoon(dir) {
    noon = dir ?? NOON;
}

// The direction the sun's light travels at `hour` (0 to 24), as the scene's
// directional light takes it.
export function sunDirection(hour) {
    const a = (hour - 12) / 24 * 2 * Math.PI, c = Math.cos(a), s = Math.sin(a);
    return [noon[0] * c + noon[2] * s, noon[1], -noon[0] * s + noon[2] * c];
}

// The unit direction toward the sun at `hour`.
export function toSun(hour) {
    const d = sunDirection(hour), l = Math.hypot(...d);
    return d.map((x) => -x / l);
}
