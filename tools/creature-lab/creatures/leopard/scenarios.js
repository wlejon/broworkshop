// The leopard's scenarios alongside the lab's standard suite.

export const scenarios = {
    gallop: {
        about: 'a straight rotary gallop',
        duration: 9,
        track: [{ t: 0, speed: 8.0 }],
    },
    'stalk-and-bolt': {
        about: 'crouches low to inspect prey scent, startles at a rival, and bolts in a rotary gallop',
        duration: 7.5,
        track: [
            { t: 0, action: 'graze' },
            { t: 2.5, action: 'startle', gaze: [-2.5, 0.8, -3.5] },
            { t: 3.4, speed: 7.8, heading: 145, gaze: null },
            { t: 7.5 },
        ],
    },
    leap: {
        about: 'a rotary gallop run-up at 5.6 m/s, coiled pounce over a 0.76 m fallen log, clean landing',
        duration: 4.58,
        ground: { log: { at: [0, 14], yaw: 90, height: 0.76, length: 6 } },
        track: [{ t: 0, speed: 5.6 }],
    },
    'startle-bound': {
        about: 'drinking crouch, startled, launches in powerful bounds, then gallops on',
        duration: 9,
        track: [
            { t: 0, action: 'graze' },
            { t: 1.5, action: 'startle', gaze: [2.0, 0.9, 3.5] },
            { t: 2.2, action: 'bound', speed: 5.4, heading: -20, gaze: null },
            { t: 6.2, action: 'move', speed: 6.8 },
            { t: 8.0, speed: 3.1 },
        ],
    },
};
