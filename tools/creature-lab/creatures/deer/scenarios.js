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
};
