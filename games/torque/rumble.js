// rumble.js — the pad as an instrument, not a buzzer.
//
// A rumble effect that fires a fixed magnitude on a fixed event tells you an
// event happened. That is a notification, not haptics. Everything here is
// SCALED from a number the simulation actually produced, so the pad reports how
// much rather than whether:
//
//   slip     the longitudinal slip ratio the wheels are already publishing to
//            the telemetry table. This is grip breaking away, and it is the one
//            a driver most wants in their hands — on the ice patch you feel the
//            rears light up before the car has visibly gone anywhere.
//   impact   |Δspeed| / dt, i.e. the chassis' own longitudinal deceleration. A
//            barrier is tens of g in one tick and braking hard is about one, so
//            a single threshold on measured acceleration separates them without
//            needing collision callbacks at all.
//   redline  how far into the last 12% of the rev range the engine is. This is
//            the shift cue, and because it is a fraction of each vehicle's OWN
//            redline it means the same thing on a 3200 rpm tank as on a 10000
//            rpm bike.
//   tracks   the tank only: a steady low-frequency hum whose level follows
//            track speed and the number of road wheels in contact. Seven and a
//            half tonnes of steel running on links does not feel like tyres,
//            and this is the difference made audible through the grips.
//
// The two motors are used for what they are. The strong (low-frequency) motor
// carries mass — impacts and track rumble; the weak (high-frequency) one
// carries texture — slip and the redline buzz. Mixing them the other way round
// makes a kerb strike feel like a wasp.
//
// playEffect() resolves IMMEDIATELY rather than after `duration`, so a
// continuous effect cannot be built by awaiting it. Instead the level is
// re-committed on a fixed cadence with a duration slightly longer than the
// cadence, which overlaps each effect into the next and gives a smooth
// envelope from a stream of one-shots.

import { activePad } from "/app/input.js";

/** Per-vehicle redlines, matching the HUD's — the shift cue is a fraction of it. */
const REDLINES = { car: 7000, tank: 3200, bike: 10000 };

// Re-commit cadence. 90 ms is fast enough that a slip transient is felt as it
// happens and slow enough that we are not calling into SDL every frame.
const COMMIT_MS = 90;
const EFFECT_MS = 150;        // longer than the cadence, so effects overlap

// Slip below this is a tyre working normally; the friction curves peak around
// 0.06 and the HUD calls a wheel "sliding" at 0.25, so rumble starts where the
// visual readout starts and reaches full scale where the tyre is long gone.
const SLIP_ON = 0.12, SLIP_FULL = 0.90;

// Deceleration that means "hit something" rather than "braked hard". The car's
// brakes are worth roughly 1.2 g; a barrier registers 10-40 g in a single tick.
const IMPACT_G = 3.5 * 9.81;
const IMPACT_FULL = 30 * 9.81;

/**
 * Build the rumble driver.
 *
 * @param {Object} [opts]
 * @param {boolean} [opts.enabled=true]
 * @returns {Object} handle — call update() each frame with the active vehicle's
 *   telemetry; read `state` for the HUD and the smoke test.
 */
export function createRumble({ enabled = true } = {}) {
    let on = !!enabled;
    let sinceCommit = 0;
    let lastSpeed = 0;
    let impact = 0;              // decaying envelope, 0..1

    // What the driver would feel if a pad were plugged in. Computed whether or
    // not one is, so the HUD meter and the smoke test can watch the simulation
    // side of this independently of whether hardware showed up.
    const state = {
        strong: 0,
        weak: 0,
        intensity: 0,            // what the meter draws: the louder motor
        slip: 0,
        impact: 0,
        redline: 0,
        tracks: 0,
        source: 'idle',          // which term is currently dominant
        requests: 0,             // playEffect() calls actually issued
        stops: 0,                // reset() calls issued
        padConnected: false,
    };

    /** Normalised 0..1 ramp between two measured bounds. */
    const ramp = (v, lo, hi) => v <= lo ? 0 : v >= hi ? 1 : (v - lo) / (hi - lo);

    /**
     * @param {number} dt      seconds
     * @param {Object} telem   the active vehicle's telemetry() snapshot
     * @param {boolean} settling  true while a respawn is spinning the drivetrain
     *                            down — the wheels are locked and the slip
     *                            numbers are an artefact, not a driving cue
     */
    function update(dt, telem, settling) {
        const pad = activePad();
        state.padConnected = !!pad;
        if (!telem || !(dt > 0)) return state;

        const kind = telem.kind || 'car';

        // --- Slip: worst driven wheel that is actually touching something.
        // An airborne wheel spins freely and its slip ratio is meaningless; a
        // pad that buzzes hardest mid-jump would be exactly backwards.
        let slip = 0;
        for (const w of telem.wheels) {
            if (!w.contact) continue;
            const s = Math.abs(w.slip || 0);
            if (s > slip) slip = s;
        }
        state.slip = settling ? 0 : ramp(slip, SLIP_ON, SLIP_FULL);

        // --- Impact: the chassis' own longitudinal acceleration. Sampled from
        // telemetry rather than from contact callbacks, which means it catches
        // everything that decelerates the vehicle hard — barriers, tyre stacks,
        // landing off a ramp — without enumerating any of them.
        const accel = Math.abs((telem.speed - lastSpeed) / dt);
        lastSpeed = telem.speed;
        if (!settling && accel > IMPACT_G) {
            impact = Math.max(impact, ramp(accel, IMPACT_G, IMPACT_FULL));
        }
        // A hit is a bang, not a state: decay it over about a fifth of a second
        // so it reads as a discrete event even while held against a wall.
        impact = Math.max(0, impact - dt * 5);
        state.impact = impact;

        // --- Redline: the top 12% of the rev range, as a shift cue.
        const redline = REDLINES[kind] || 7000;
        state.redline = settling ? 0 : ramp(telem.rpm / redline, 0.88, 1.0);

        // --- Track rumble: the tank's texture, scaled by how fast the links are
        // running and how much of the running gear is loaded.
        let tracks = 0;
        if (kind === 'tank' && telem.tracks && !settling) {
            const down = telem.wheels.filter(w => w.contact).length;
            const beltSpeed = Math.max(Math.abs(telem.tracks.left),
                                       Math.abs(telem.tracks.right));
            tracks = ramp(beltSpeed, 0.4, 9) * (down / Math.max(1, telem.wheels.length));
        }
        state.tracks = tracks;

        // --- Mix. Strong motor = mass, weak motor = texture.
        const strong = Math.min(1, state.impact * 1.0 + tracks * 0.55 + state.slip * 0.25);
        const weak = Math.min(1, state.slip * 0.85 + state.redline * 0.45 + tracks * 0.20);
        state.strong = strong;
        state.weak = weak;
        state.intensity = Math.max(strong, weak);
        state.source = state.impact > 0.25 ? 'impact'
            : state.slip > 0.3 ? 'wheel slip'
            : tracks > 0.25 ? 'track rumble'
            : state.redline > 0.2 ? 'redline'
            : state.intensity > 0.02 ? 'road' : 'idle';

        // --- Commit to the hardware on the fixed cadence.
        sinceCommit += dt * 1000;
        if (sinceCommit < COMMIT_MS) return state;
        sinceCommit = 0;
        if (!pad || !pad.vibrationActuator) return state;

        if (!on || state.intensity < 0.02) {
            // Only stop once per quiet period rather than every cadence tick.
            if (state.wasOn) { pad.vibrationActuator.reset(); state.stops++; }
            state.wasOn = false;
            return state;
        }
        pad.vibrationActuator.playEffect('dual-rumble', {
            duration: EFFECT_MS,
            strongMagnitude: strong,
            weakMagnitude: weak,
        });
        state.requests++;
        state.wasOn = true;
        return state;
    }

    return {
        state,
        update,
        get enabled() { return on; },
        setEnabled(v) {
            on = !!v;
            if (!on) {
                const pad = activePad();
                if (pad && pad.vibrationActuator) { pad.vibrationActuator.reset(); state.stops++; }
                state.wasOn = false;
            }
            return on;
        },
    };
}
