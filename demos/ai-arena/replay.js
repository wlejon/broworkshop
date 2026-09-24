// replay.js — rewind snapshots, .bgar recording and playback.
//
// Recording writes one frame per rendered frame (bro.ai.game.createRecorder)
// into <app>/replays/. Playback reads a finished file with
// createReplayReader and walks it by each frame's recorded `elapsed`, so it
// plays at the speed it was recorded whatever the frame rate. All state
// lives on the match state (state.rec) so a new match starts clean.
import { Config } from "/app/config.js";
import { SIM_DT } from "/app/sim/match.js";

function rec(state) {
    return state.rec || (state.rec = {
        recorder: null, recording: false, path: null,
        reader: null, playing: false, t: 0, frame: 0,
        snapshots: [], snapshotAccum: 0,
    });
}

export function isRecording(state) { return !!(state && state.rec && state.rec.recording); }
export function isPlaying(state) { return !!(state && state.rec && state.rec.playing); }
export function recordingPath(state) { return state && state.rec ? state.rec.path : null; }

/** Per live frame: keep the rewind ring. */
export function snapshotTick(state, dt) {
    const r = rec(state);
    r.snapshotAccum += dt;
    if (r.snapshotAccum < Config.SNAPSHOT_INTERVAL) return;
    r.snapshotAccum = 0;
    r.snapshots.push({ t: state.elapsed, snap: state.world.snapshot() });
    while (r.snapshots.length > Config.SNAPSHOT_KEEP) r.snapshots.shift();
}

/**
 * Restore the newest snapshot at least REWIND_SECONDS old (else the oldest).
 * Returns the snapshot time, or null when there is none yet.
 */
export function rewind(state) {
    const snaps = rec(state).snapshots;
    if (!snaps.length) return null;
    let target = snaps[0];
    for (const s of snaps) if (state.elapsed - s.t >= Config.REWIND_SECONDS) target = s;
    state.world.restore(target.snap);
    return target.t;
}

/** Open a new recording in <app>/replays/; returns its path. Throws on failure. */
export function startRecording(state) {
    const r = rec(state);
    const path = bro.resolvePath("replays/arena-" + Date.now() + ".bgar");
    const recorder = bro.ai.game.createRecorder();
    if (!recorder.open(path, 1, Date.now(), SIM_DT)) throw new Error("recorder open failed: " + path);
    recorder.writeRoster(state.world);
    Object.assign(r, { recorder, recording: true, path });
    return path;
}

/** Close the recording; returns its frame count. */
export function stopRecording(state) {
    const r = rec(state);
    if (!r.recording) return 0;
    r.recorder.close();
    r.recording = false;
    return r.recorder.frameCount;
}

/**
 * Capture this frame. Must run before the frame's world.events are cleared:
 * the recorder takes the events that arrived since its previous frame.
 */
export function recordTick(state) {
    const r = state.rec;
    if (r && r.recording) r.recorder.recordFrame(state.simSteps, state.elapsed, state.world);
}

/** Start playing `path` (default: the last recording). Returns the frame count. Throws on failure. */
export function startPlayback(state, path) {
    const r = rec(state);
    const file = path || r.path;
    if (!file) throw new Error("no replay to play - record one first");
    const reader = bro.ai.game.createReplayReader();
    if (!reader.open(file)) throw new Error("replay open failed: " + reader.errorMessage);
    if (!reader.frameCount) throw new Error("replay is empty: " + file);
    Object.assign(r, { reader, playing: true, t: 0, frame: 0, path: file, t0: reader.frame(0).elapsed });
    return reader.frameCount;
}

export function stopPlayback(state) {
    const r = rec(state);
    r.playing = false;
    r.reader = null;
}

/**
 * Advance playback by dt seconds. Returns { frame, index, count, done }
 * (frame: the ReplayReader frame to draw; done: the last frame was reached).
 */
export function playbackTick(state, dt) {
    const r = rec(state), rr = r.reader;
    r.t += dt;
    let i = r.frame;
    while (i + 1 < rr.frameCount && rr.frame(i + 1).elapsed - r.t0 <= r.t) i++;
    r.frame = i;
    return { frame: rr.frame(i), index: i, count: rr.frameCount, done: i + 1 >= rr.frameCount };
}
