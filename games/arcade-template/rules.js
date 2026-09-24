// Template rules — the game's state and how it changes. No DOM, no audio,
// no drawing: plain data in, plain data out, so tests can drive it directly.
//
// Demo (replace it): a square drifts around the field, each Fire press
// scores a point, and the run ends after ROUND_MS.
//
// Pattern: createX() returns the state; the plugin calls pure functions on
// it every frame; what happened goes onto state.events for the plugin to
// turn into sound, effects and screens (see game.js).

export const ROUND_MS = 45000;
export const SPEED = { x: 0.00012, y: 0.00009 };   // field widths per ms
export const EDGE = 0.12;                           // bounce inset, 0..1

/** A fresh field. Positions are 0..1 so the rules never need the view size. */
export function createField() {
    return {
        score: 0,
        elapsed: 0,
        x: 0.5,
        y: 0.5,
        vx: SPEED.x,
        vy: SPEED.y,
        over: false,
        events: [],
    };
}

/** The player pressed Fire. */
export function tap(field) {
    if (field.over) return;
    field.score += 1;
    field.events.push({ type: "score" });
}

/** Advance `dt` ms: drift, bounce, and end the round on time. */
export function step(field, dt) {
    if (field.over) return;
    field.elapsed += dt;
    field.x += field.vx * dt;
    field.y += field.vy * dt;
    if (field.x < EDGE || field.x > 1 - EDGE) field.vx = -field.vx;
    if (field.y < EDGE || field.y > 1 - EDGE) field.vy = -field.vy;
    if (field.elapsed >= ROUND_MS) {
        field.over = true;
        field.events.push({ type: "timeup" });
    }
}

/** Take the events since the last call. */
export function drainEvents(field) {
    const out = field.events;
    field.events = [];
    return out;
}
