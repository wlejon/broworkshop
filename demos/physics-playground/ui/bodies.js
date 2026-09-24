// ui/bodies.js — the Ragdoll/Soft tab.
//
// One ragdoll is "the" ragdoll for the panel: the one owning the selected
// part, else the newest (activeRagdoll), which keeps the panel to a few
// buttons instead of a list widget nobody would read.

import { $, h, clear } from "/lib/kit/dom.js";
import { params } from "/lib/kit/params.js";
import { segmented } from "/lib/kit/ui.js";
import {
    spawnRagdoll, ragdollRain, driveRagdoll, stopDrive, poseError, punchPart, selectPart,
    selection, activeRagdoll, clearRagdolls, ragdollCount, totalPartCount, PART_NAMES, POSE_NAMES,
} from "../sim/ragdolls.js";
import { buildCloth, buildBall, getCloth, getBall, gust, poke, clearSoftBodies, CLOTH, PIN_SETS } from "../sim/softbody.js";
import { spawn } from "../sim/spawn.js";
import { state as sandbox, refreshSelection } from "./sandbox.js";

export const state = {
    drivePose: 'stand',
    driveKinematic: false,
    motorFreq: 12,
    pinSet: 'corners',
    ballPressure: 2500,
};

let driveP = null, ballP = null, poseSeg = null, pinSeg = null;

// --- ragdolls ----------------------------------------------------------------------

export function dropRagdoll(pos) {
    return spawnRagdoll(pos || { x: -2 + Math.random() * 6, y: 5.5, z: -2 + Math.random() * 4 });
}

export const dropRagdollRain = (n = 5) => ragdollRain(n);

/** Select one part (the raycast path). A part and a loose body are exclusive selections. */
export function selectRagdollPart(entry, index) {
    const r = selectPart(entry, index);
    if (r) { sandbox.selected = null; refreshSelection(); }
    refreshBodies();
    return r;
}

/** Punch the selected part, or the head when nothing is selected. */
export function punchSelected(dir, strength = 12) {
    const e = activeRagdoll();
    if (!e) return false;
    const idx = selection.entry === e && selection.index >= 0 ? selection.index : PART_NAMES.indexOf('head');
    return punchPart(e, idx, dir || { x: 1, y: 0.35, z: 0 }, strength);
}

export function driveSelected(poseName, kinematic) {
    const e = activeRagdoll();
    if (!e) return false;
    if (poseName) { state.drivePose = poseName; if (poseSeg) poseSeg.value = poseName; }
    if (kinematic != null) { state.driveKinematic = !!kinematic; if (driveP) driveP.set('driveKinematic', !!kinematic, true); }
    return driveRagdoll(e, state.drivePose, state.driveKinematic, { frequency: state.motorFreq, damping: 1.0 });
}

export function limpSelected() {
    const e = activeRagdoll();
    return e ? stopDrive(e) : false;
}

// --- soft bodies -----------------------------------------------------------------------

export function setClothPins(set) {
    state.pinSet = set;
    if (pinSeg) pinSeg.value = set;
    buildCloth(set);
    const hint = $('#pinHint');
    clear(hint).appendChild(h('span', null, h('b', null, set), ` — ${PIN_SETS[set]}. Pinned vertices carry invMass 0: ` +
        'they do not move at all while the sheet between them sags.'));
    return true;
}

/** Rain a few boxes into the middle of the cloth so it visibly deforms. */
export function dropOntoCloth(n = 5) {
    if (!getCloth()) return [];
    const out = [];
    for (let i = 0; i < n; i++) {
        out.push(spawn('box', {
            x: CLOTH.position.x + (Math.random() - 0.5) * 1.4,
            y: CLOTH.position.y + 3 + i * 0.6,
            z: CLOTH.position.z + (Math.random() - 0.5) * 1.4,
        }, { layer: 'player', friction: 0.8, restitution: 0.1, mass: 4 }));
    }
    return out;
}

export const gustCloth = (strength = 6) => gust(getCloth(), strength);

/** The pressure slider: no runtime setter, so rebuild (and re-drop) at the new value. */
export function setPressure(p) {
    state.ballPressure = p;
    if (ballP) ballP.set('ballPressure', p, true);
    return buildBall(p);
}

export const dropBall = (pressure) => setPressure(pressure == null ? state.ballPressure : pressure);
export const pokeBall = (depth = 0.35) => poke(getBall(), depth);

// --- wiring ---------------------------------------------------------------------------

export function bindBodies() {
    $('#btnRagdoll').onclick = () => dropRagdoll();
    $('#btnRagdollRain').onclick = () => dropRagdollRain(5);
    $('#btnClearRagdolls').onclick = () => clearRagdolls();
    $('#btnPunch').onclick = () => punchSelected({ x: 1, y: 0.3, z: 0 }, 14);
    $('#btnUppercut').onclick = () => punchSelected({ x: 0.15, y: 1, z: 0 }, 20);

    poseSeg = segmented('#poseRow', POSE_NAMES, { value: state.drivePose, onChange: (v) => { state.drivePose = v; } });
    driveP = params('#driveParams', state, {
        driveKinematic: { label: 'kinematic drive (hard tracking)' },
        motorFreq: { label: 'motor Hz', min: 1, max: 40, step: 0.5 },
    }, {
        // Re-issue a running drive at once, so the checkbox and the stiffness
        // switch live: the mid-drive switch is the clearest way to feel it.
        onChange: (k) => {
            const r = activeRagdoll();
            if (!r) return;
            if (k === 'driveKinematic' && r.drive.mode !== 'off') driveSelected();
            if (k === 'motorFreq' && r.drive.mode === 'motor') driveSelected();
        },
    });
    $('#btnDrive').onclick = () => driveSelected();
    $('#btnLimp').onclick = () => limpSelected();

    pinSeg = segmented('#pinRow', [['corners', 'corners'], ['edge', 'one edge'], ['none', 'unpinned']],
        { value: state.pinSet, onChange: (v) => setClothPins(v) });
    $('#btnClothDrop').onclick = () => dropOntoCloth(5);
    $('#btnGust').onclick = () => gustCloth(6);
    ballP = params('#ballParams', state, { ballPressure: { label: 'pressure', min: 0, max: 7000, step: 50 } },
        { onChange: (_, v) => setPressure(v) });
    $('#btnBallDrop').onclick = () => dropBall();
    $('#btnPoke').onclick = () => pokeBall(0.35);
    $('#btnSoftClear').onclick = () => clearSoftBodies();

    // The cloth and the ball are fixtures: an empty soft-body panel says
    // nothing about what soft bodies look like.
    setClothPins(state.pinSet);
    setPressure(state.ballPressure);
    refreshBodies();
}

export function refreshBodies() {
    $('#stRagdolls').textContent = String(ragdollCount());
    $('#stParts').textContent = String(totalPartCount());
    $('#partInfo').textContent = selection.entry
        ? `ragdoll #${selection.entry.id} · part ${selection.index} of ${PART_NAMES.length} — ${PART_NAMES[selection.index]}`
        : 'no part selected — click a limb';
    const e = activeRagdoll();
    // Pose error is the honest progress readout: motors chase joint ANGLES.
    $('#driveInfo').textContent = !e ? 'no ragdoll'
        : e.drive.mode === 'off' ? `ragdoll #${e.id} — limp`
        : `#${e.id} — ${e.drive.mode === 'kinematic' ? 'kinematic' : 'motorised'} → ${e.drive.pose} · ` +
          `pose error ${(poseError(e, e.drive.pose) * 180 / Math.PI).toFixed(1)}°`;
}
