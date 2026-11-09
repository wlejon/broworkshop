// The sun and the hour: the sun turns about the planet's axis (y) with the
// hour, noon the direction it starts in, tilted off the equator by the
// world's season (its `noon`, core/world.js; NOON when it gives none).

export const NOON = [-0.55, -0.35, -0.75];
let noon = NOON;

// The world's noon: the direction the sun's light travels at hour 12, its
// tilt off the equator kept and turned about the axis so the sun stands over
// longitude `lon` (radians; the world's start, so a world opens at noon).
// core/planet.js sets it from the world before anything reads the hour.
export function setNoon(dir, lon) {
    const d = dir ?? NOON;
    const turn = lon - Math.atan2(-d[0], -d[2]), c = Math.cos(turn), s = Math.sin(turn);
    noon = [d[0] * c + d[2] * s, d[1], -d[0] * s + d[2] * c];
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
