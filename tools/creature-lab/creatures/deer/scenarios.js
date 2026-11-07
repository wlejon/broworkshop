// The deer's own scenarios, beside the lab's (lab/scenarios.js): the same
// shape, a name and a track of intent keys.

export const scenarios = {
    'browse-and-flee': {
        about: 'grazes, startles at something behind-left, and flees at a gallop',
        duration: 7,
        track: [
            { t: 0, action: 'graze' },
            { t: 2.5, action: 'startle', gaze: [-3, 1.2, -4] },
            { t: 3.4, speed: 7, heading: 150, gaze: null },
            { t: 7 },
        ],
    },
    leap: {
        about: 'a run-up at 5 m/s, a leap over a 1 m log, the run-out',
        duration: 7,
        ground: { log: { at: [0, 14], yaw: 90, height: 1.0, length: 6 } },
        track: [{ t: 0, speed: 5 }, { t: 5.5, speed: 2.5 }],
    },
    'startle-bound': {
        about: 'grazing, startled, escapes in bounds, then gallops on',
        duration: 9,
        track: [
            { t: 0, action: 'graze' },
            { t: 1.5, action: 'startle', gaze: [2, 1.2, 4] },
            { t: 2.2, action: 'bound', speed: 5, heading: -20, gaze: null },
            { t: 6.2, action: 'move', speed: 6 },
            { t: 8, speed: 3 },
        ],
    },
};
