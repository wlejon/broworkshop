// actions.js — every user-facing operation, as a function.
//
// One direction only: action -> `state` -> the engine (through the player,
// the machine and the cameras). The HUD's controls call these, the keyboard
// calls these, and the tests call these, so a test exercises exactly the path
// a click does. After each action the HUD is told to re-sync its controls
// (onSync); nothing here touches the DOM.

import { character, player, machine, cameras, overlay, motion } from "/app/lab.js";

export const state = {
    clip: 'idle',
    loop: true,
    speed: 1.0,
    fade: 0.35,
    fadeTarget: 'walk',
    showBones: false,
    showSkin: true,

    // What drives the base track: a clip name or a registered blend space.
    // The axis values persist across base switches because the PARAMETER
    // lives on the space: leave a space and come back at the same mix.
    base: 'idle',
    speedAxis: 0.0,
    dirX: 0.0,
    dirY: 1.0,

    // The machine's own parameter, separate from `speedAxis`: the blend
    // section drives the axis directly with the machine out of the picture,
    // this one drives it THROUGH the machine, which also decides whether the
    // character should be idling, moving or crouch-moving at that speed.
    stateSpeed: 0.0,
    crouch: false,
    rootMotion: false,
    camera: 'orbit',
    cinematic: false,
};

// The three layer slots the HUD exposes. Slot 0 stays free: play(name,
// { mask }) is shorthand for layer 0, so the rows can never collide with it.
// The default masks are DISJOINT — right arm, left arm, head — so all three
// can run over a walking blend at once.
export const LAYER_ROWS = [
    { slot: 1, clip: 'wave',  mask: 'right arm', enabled: false, weight: 1 },
    { slot: 2, clip: 'point', mask: 'left arm',  enabled: false, weight: 1 },
    { slot: 3, clip: 'nod',   mask: 'head only', enabled: false, weight: 1 },
];

const syncers = [];
/** Register fn(what) to run after every action (the HUD's control sync). */
export function onSync(fn) { syncers.push(fn); }
function sync(what) { for (const fn of syncers) fn(what); }

// --- clips + transport -----------------------------------------------------------

/** Hard cut to a clip. Suspends the state machine (node.state goes null). */
export function selectClip(name) {
    state.clip = name;
    state.base = name;
    player.play(name, 0);
    sync('base');
}

/** Blend from whatever is playing into `name` over `fade` seconds. */
export function crossfade(name, fade = state.fade) {
    state.clip = name;
    state.base = name;
    player.crossfadeTo(name, fade);
    sync('base');
}

export function play()  { player.resume(); sync('transport'); }
export function pause() { player.pause(); sync('transport'); }
export function togglePlay() { if (player.playing) pause(); else play(); }
/** Fade to bind pose and deactivate the player — the T-pose is intended. */
export function stop(fade = 0.15) { player.stop(fade); sync('transport'); }

export function setLoop(on) { state.loop = !!on; player.loop = state.loop; sync('transport'); }
export function setSpeed(v) { state.speed = v; player.speed = v; sync('transport'); }
/** Scrub by normalized position; re-poses immediately, even while paused. */
export function scrub(t) { player.seekNormalized(t); }

export function setFade(v) { state.fade = v; sync('fade'); }
export function setFadeTarget(name) { state.fadeTarget = name; sync('fade'); }

// A one-shot clip played MANUALLY would strand the character in its final
// pose, so anything non-looping falls back to idle. State-machine one-shots
// never come through here: autoAdvance is authored into the graph.
character.node.onAnimationFinished = () => {
    if (character.node.state === null) crossfade('idle', 0.25);
};

// --- blend spaces --------------------------------------------------------------

/**
 * Put a blend SPACE on the base track: the same play() a clip goes through.
 * Pushing the current axis value right after means the character arrives at
 * the mix the sliders show, not wherever the space was last left.
 */
export function selectSpace(name, fade = state.fade) {
    state.base = name;
    player.playSpace(name, fade);
    if (name === 'directional') player.setDirection(state.dirX, state.dirY);
    else player.setLocomotion(state.speedAxis, name);
    sync('base');
}

/** Move the 1D speed axis of whichever locomotion space is the base. */
export function setSpeedAxis(v) {
    state.speedAxis = v;
    player.setLocomotion(v, state.base === 'locomotionCrouch' ? 'locomotionCrouch' : 'locomotion');
    sync('axis');
}

/** Move the 2D directional axis: x = strafe (+1 = right), y = forward. */
export function setDirection(x, y) {
    state.dirX = x;
    state.dirY = y;
    player.setDirection(x, y);
    sync('axis');
}

// --- layers ----------------------------------------------------------------------

function row(slot) {
    const r = LAYER_ROWS.find((x) => x.slot === slot);
    if (!r) throw new Error(`no layer row for slot ${slot}`);
    return r;
}

/** Turn a slot on or off with its remembered clip, mask and weight. */
export function setLayerEnabled(slot, on, fade = 0.2) {
    const r = row(slot);
    r.enabled = !!on;
    if (on) player.playLayer(slot, r.clip, r.mask, { weight: r.weight, fadeTime: fade });
    else player.stopLayer(slot, fade);
    sync('layers');
}

export function setLayerWeight(slot, w) {
    const r = row(slot);
    r.weight = w;
    if (r.enabled) player.setLayerWeight(slot, w);
    sync('layers');
}

/** A mask is captured at playLayer time, so a live slot is replayed (atomically). */
export function setLayerMask(slot, mask) {
    const r = row(slot);
    r.mask = mask;
    if (r.enabled) player.playLayer(slot, r.clip, mask, { weight: r.weight, fadeTime: 0 });
    sync('layers');
}

export function setLayerClip(slot, clip) {
    const r = row(slot);
    r.clip = clip;
    if (r.enabled) player.playLayer(slot, clip, r.mask, { weight: r.weight, fadeTime: 0 });
    sync('layers');
}

// --- state machine ---------------------------------------------------------------

/** Manual travel: follows the same authored transitions the driver uses. */
export function travelTo(name) { machine.travel(name); sync('machine'); return name; }

/** Fire a one-shot; the machine remembers where to come back to. */
export function trigger(name) { machine.trigger(name); sync('machine'); return name; }

/** The machine's speed parameter — names no state; the driver decides. */
export function setStateSpeed(v) { state.stateSpeed = v; machine.setSpeed(v); sync('machine'); return v; }

export function setCrouch(on) {
    state.crouch = !!on;
    machine.setCrouch(state.crouch);
    sync('machine');
    return state.crouch;
}

export function clearLog() { machine.log.length = 0; sync('log'); }

// --- root motion -----------------------------------------------------------------

/** Send the character back to the start of the run and zero the odometer. */
export function resetJourney() {
    player.resetTransform();
    motion.distance = 0;
    motion.markers = 0;
    motion.z = 0;
    sync('motion');
    return motion;
}

/** Treadmill (off) or travel (on): the machine swaps its locomotion space. */
export function setRootMotion(on) {
    state.rootMotion = !!on;
    machine.setRootMotion(state.rootMotion);
    if (!state.rootMotion) resetJourney();
    sync('motion');
    return state.rootMotion;
}

// --- cameras ---------------------------------------------------------------------

export function selectCamera(key) {
    state.camera = key;
    cameras.select(key);
    sync('camera');
    return key;
}

/** Fly the wide camera from its clip; arming it cuts to that camera. */
export function setCinematic(on) {
    state.cinematic = !!on;
    cameras.setCinematic(state.cinematic);
    if (state.cinematic && cameras.active !== 'wide') selectCamera('wide');
    sync('camera');
}

// --- rig view --------------------------------------------------------------------

export function setBones(on) { state.showBones = !!on; overlay.setEnabled(state.showBones); sync('rig'); }
export function setSkin(on) { state.showSkin = !!on; character.node.visible = state.showSkin; sync('rig'); }
