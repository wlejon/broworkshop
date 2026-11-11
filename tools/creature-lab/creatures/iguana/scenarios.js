// Iguana-specific scenarios alongside the lab's standard suite (lab/scenarios.js).
// Sized for an adult green spiny iguana (~0.27 m dorsal height, ~1.35 m length,
// walk 0.55 m/s, trot 1.6 m/s, sprint gallop 4.2 m/s).

export const scenarios = {
    leap: {
        about: 'lizard sprint run-up at 3.9 m/s, agile vault over a 0.18 m fallen branch, run-out',
        duration: 7,
        ground: { log: { at: [0, 8.6], yaw: 90, height: 0.18, length: 4.5 } },
        track: [{ t: 0, speed: 3.9 }, { t: 5.8, speed: 1.6 }],
    },
    'bask-and-bolt': {
        about: 'sun-basking flat on warm ground, startled by threat, territorial display then sprint escape',
        duration: 9,
        track: [
            { t: 0, action: 'lie' },
            { t: 3.0, action: 'startle', gaze: [1.5, 0.5, 2.5] },
            { t: 4.4, action: 'move', speed: 4.0, heading: -35, gaze: null },
            { t: 7.8, speed: 1.5 },
        ],
    },
    'territorial-display': {
        about: 'alert territorial head-bobbing and gular dewlap flare, then slow patrol walk',
        duration: 8,
        track: [
            { t: 0, action: 'alert', gaze: [1.2, 0.35, 2.2] },
            { t: 4.2, action: 'move', speed: 0.55, gaze: null },
        ],
    },
};
