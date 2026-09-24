// config.js — presentation and bookkeeping constants for the live app.
// (The fixed sim step lives in sim/match.js as SIM_DT.)
export const Config = {
    MAX_STEPS_PER_FRAME: 8,   // attachAIWorld catch-up cap

    // HUD panel cadences, seconds between updates. DOM mutations are the
    // expensive part; each panel is throttled independently of the sim.
    ROSTER_EVERY: 0.2,
    OBS_EVERY:    0.1,
    REWARD_EVERY: 0.25,
    STATUS_EVERY: 0.25,

    // Snapshot ring for the Rewind button.
    SNAPSHOT_INTERVAL: 1.0,
    SNAPSHOT_KEEP: 5,
    REWIND_SECONDS: 1.5,

    LOG_LINES: 60,            // damage log cap
    REWARD_HISTORY: 200,      // reward chart samples
};
