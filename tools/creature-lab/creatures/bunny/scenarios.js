// The bunny's own scenarios, beside the lab's (lab/scenarios.js, sized to
// it): the same shape, a name and a track of intent keys.

export const scenarios = {
    'sit-up': {
        about: 'sitting, it sits up on its haunches to look about, then down again',
        duration: 7,
        track: [{ t: 0 }, { t: 1, action: 'alert', gaze: [0.6, 0.35, 1.2] }, { t: 3, gaze: [-0.8, 0.3, 0.6] }, { t: 4.5, action: 'move', gaze: null }],
    },
    'graze-and-bolt': {
        about: 'grazes, startles at something behind, and bolts',
        duration: 6,
        track: [
            { t: 0, action: 'graze' },
            { t: 2.2, action: 'startle', gaze: [-0.6, 0.2, -0.8] },
            { t: 2.7, action: 'bound', speed: 4.5, heading: 160, gaze: null },
            { t: 6 },
        ],
    },
    'hop-about': {
        about: 'hops a few steps, stops, nibbles, hops on',
        duration: 10,
        track: [
            { t: 0 }, { t: 0.5, speed: 0.4 }, { t: 1.6, speed: 0 }, { t: 2.2, action: 'graze' },
            { t: 4.2, action: 'move', speed: 0.5, heading: 40 }, { t: 5.6, speed: 0 }, { t: 7, speed: 0.4, heading: -20 }, { t: 8.4, speed: 0 },
        ],
    },
};
