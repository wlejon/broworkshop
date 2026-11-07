// The creature contract's records: what a host (the lab, later the planet)
// hands a rig and what it reads back. Every species is written against
// these; the same names are a brokernel module, `creature::contract`.
//
// One rig dispatch steps every creature of a batch once:
//
//   @kernel @grid(1)
//   fn k_rig(g: grid<1>, intent: read_store<f32, 1>, env: read_store<f32, 1>,
//            state: rw_store<f32, 1>, pose: write_store<vec4<f32>, 1>,
//            tele: write_store<f32, 1>, dt: f32)
//
// intent  INTENT floats a creature: what a brain wants (below)
// env     the ground's record, passed to creature::ground's functions
// state   the species' own STATE floats a creature; the first five are the
//         contract's: position, yaw, and whether it has been placed
// pose    NB bones x 3 vec4 a creature (lab/skeleton.js), what the skin
//         hook draws and the lab measures
// tele    TELE floats a creature: what the rig says it is doing (below)

export const INTENT = 16;
export const I = {
    VEL_X: 0, VEL_Z: 1,          // wanted velocity on the ground, m/s (world)
    HEADING: 2,                  // wanted heading (yaw, rad), with HEADING_MODE 1
    HEADING_MODE: 3,             // 0: face along the velocity; 1: hold HEADING
    GAZE_X: 4, GAZE_Y: 5, GAZE_Z: 6,   // a point to look at (world)
    GAZE_W: 7,                   // 0 no gaze target .. 1 look at it
    ACTION: 8,                   // ACTION below
    ACTION_PARAM: 9,             // the action's own amount (0..1)
    SEED: 10,                    // the individual's seed
};

// BOUND: go by leaps (every stride a leap, as an escape), not by a gait.
export const ACTION = { MOVE: 0, GRAZE: 1, STARTLE: 2, LIE: 3, ALERT: 4, BOUND: 5 };
export const ACTION_NAMES = ['move', 'graze', 'startle', 'lie', 'alert', 'bound'];

export const STATE_HEADER = { POS: 0, YAW: 3, PLACED: 4 };

export const MAX_FEET = 8;
export const TELE = 16 + 4 * MAX_FEET;
export const T = {
    POS: 0, YAW: 3, SPEED: 4,
    GAIT: 5,          // GAIT below (the dominant one)
    PHASE: 6,         // the gait cycle's phase, 0..1
    ACTION: 7,
    HEIGHT: 8,        // the body's height over the ground under it
    PITCH: 9, ROLL: 10,
    FREQ: 11,         // strides a second
    LEAP: 12,         // in a leap: s from its take-off plus 10 (0: not leaping)
    FOOT: 16,         // per foot k at FOOT + 4k: planted (0/1), then where (x, y, z)
};

export const GAIT = { STAND: 0, WALK: 1, TROT: 2, GALLOP: 3 };
export const GAIT_NAMES = ['stand', 'walk', 'trot', 'gallop'];

export function contractModule() {
    let s = 'module creature::contract;\n';
    s += `pub const INTENT: i32 = ${INTENT};\npub const TELE: i32 = ${TELE};\npub const MAX_FEET: i32 = ${MAX_FEET};\n`;
    for (const [k, v] of Object.entries(I)) s += `pub const I_${k}: i32 = ${v};\n`;
    for (const [k, v] of Object.entries(ACTION)) s += `pub const ACT_${k}: i32 = ${v};\n`;
    for (const [k, v] of Object.entries(STATE_HEADER)) s += `pub const S_${k}: i32 = ${v};\n`;
    for (const [k, v] of Object.entries(T)) s += `pub const T_${k}: i32 = ${v};\n`;
    for (const [k, v] of Object.entries(GAIT)) s += `pub const GAIT_${k}: i32 = ${v};\n`;
    return s;
}
