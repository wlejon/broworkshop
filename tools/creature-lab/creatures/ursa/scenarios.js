// Species-specific scenarios for `ursa` alongside the lab's standard scenarios.

export const scenarios = {
    leap: {
        about: 'heavy rotary gallop run-up at 5.6 m/s, athletic bear vault over a 0.68 m fallen log, cushioned run-out',
        duration: 7,
        ground: { log: { at: [0, 14.5], yaw: 90, height: 0.68, length: 6 } },
        track: [{ t: 0, speed: 5.6 }, { t: 5.6, speed: 2.6 }],
    },
    'forage-and-bluff': {
        about: 'nose-to-ground bear snuffling & foraging, rises into sentinel bluff-alert, then charges off in a rotary gallop',
        duration: 8,
        track: [
            { t: 0, action: 'graze' },
            { t: 2.8, action: 'startle', gaze: [-2.2, 1.3, 3.8] },
            { t: 4.2, action: 'move', speed: 6.5, heading: -30, gaze: null },
            { t: 8 },
        ],
    },
};
