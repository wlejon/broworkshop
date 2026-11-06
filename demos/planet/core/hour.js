// The sun and the hour: the sun turns about the planet's axis (y) with the
// hour, noon the direction it starts in (NOON, tilted off the equator).

export const NOON = [-0.55, -0.35, -0.75];

// The direction the sun's light travels at `hour` (0 to 24), as the scene's
// directional light takes it.
export function sunDirection(hour) {
    const a = (hour - 12) / 24 * 2 * Math.PI, c = Math.cos(a), s = Math.sin(a);
    return [NOON[0] * c + NOON[2] * s, NOON[1], -NOON[0] * s + NOON[2] * c];
}

// The unit direction toward the sun at `hour`.
export function toSun(hour) {
    const d = sunDirection(hour), l = Math.hypot(...d);
    return d.map((x) => -x / l);
}
