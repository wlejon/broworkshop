// ui/machines.js — the Machines tab: motors, the turret, the axis grid, the
// collideConnected pair and the mechanism bench.
//
// The axis grid IS the SixDOF demo: the one place a user can take a joint
// apart one degree of freedom at a time and watch the machine change.

import { $, h } from "/lib/kit/dom.js";
import { params } from "/lib/kit/params.js";
import { segmented } from "/lib/kit/ui.js";
import {
    machines, AXIS_NAMES, AXIS_MODES, modeOf, setAxisMode, setMotor, machineOffset,
    fireTurret, craneLoad, loadPiston, clearMachineDebris, setShowAllAxes, resetMachines, setTurretTracking,
} from "../sim/machines.js";
import {
    setCollideConnected, getCollideConnected, collideSeparation, setGearDrive, setGearRatio, resetGears,
    setRackDrive, rackOffset, resetRack, resetPulley, resetBench,
} from "../sim/bench.js";

export const state = {
    craneSlew: 0.0,
    winchTarget: -2.0,
    pistonTarget: 0.0,
    turretTracking: true,
    showAxes: true,
    collideConnected: false,
    gearSpeed: 2.5,
    gearRatio: 2.0,
    rackSpeed: 1.6,
};

const axisSegs = [];      // [{ key, axis, seg }]

/** Switch one machine axis and resync the grid. */
export function setAxis(key, axis, mode) {
    const ok = setAxisMode(key, axis, mode);
    syncAxisGrid();
    return ok;
}

function syncAxisGrid() {
    for (const a of axisSegs) a.seg.value = modeOf(machines.get(a.key).axes[a.axis]);
}

/** Machines + bench back to their authored layout and default drives. */
export function resetAll() {
    resetMachines();
    resetBench(state.gearSpeed, state.rackSpeed);
    for (const [k, v] of [['craneSlew', 0], ['winchTarget', -2], ['pistonTarget', 0], ['turretTracking', true]]) {
        state[k] = v;
    }
    motorP.refresh(); turretP.refresh();
    syncAxisGrid();
}

function buildAxisGrid() {
    const host = $('#axisGrid');
    for (const m of machines.values()) {
        const card = h('div.card', null, h('span.title', null, m.label), h('div.hint', null, m.hint));
        for (const axis of AXIS_NAMES) {
            // "translationY" -> "tY": six rows per machine, full names would triple the height.
            const letter = axis.slice(-1);
            const row = h('div.axisrow', null, h('span.ax' + letter, null, (axis[0] === 't' ? 't' : 'r') + letter));
            const seg = segmented(row, AXIS_MODES.map((md) => [md, md === 'limited' ? 'lim' : md]), {
                value: modeOf(m.axes[axis]), onChange: (md) => setAxis(m.key, axis, md),
            });
            axisSegs.push({ key: m.key, axis, seg });
            card.appendChild(row);
        }
        host.appendChild(card);
    }
}

let motorP = null, turretP = null;

export function bindMachines() {
    // Slew is a VELOCITY motor, winch and piston POSITION motors: a rate the
    // machine holds forever versus a place it goes and stays.
    motorP = params('#motorParams', state, {
        craneSlew: { label: 'crane slew', min: -1.5, max: 1.5, step: 0.05, fmt: (v) => v.toFixed(2) + ' rad/s' },
        winchTarget: { label: 'winch', min: -4, max: 0, step: 0.05, fmt: (v) => v.toFixed(2) + ' m' },
        pistonTarget: { label: 'piston', min: 0, max: 4.5, step: 0.05, fmt: (v) => v.toFixed(2) + ' m' },
    }, {
        onChange: (k, v) => {
            if (k === 'craneSlew') setMotor('crane', 'rotationY', { type: 'velocity', target: v, maxTorque: 40000 });
            if (k === 'winchTarget') setMotor('winch', 'translationY', { type: 'position', target: v, maxForce: 60000, frequency: 4, damping: 1 });
            if (k === 'pistonTarget') setMotor('piston', 'translationY', { type: 'position', target: v, maxForce: 120000, frequency: 5, damping: 1 });
        },
    });
    $('#btnCraneLoad').onclick = () => craneLoad();
    $('#btnPistonLoad').onclick = () => loadPiston(3);

    turretP = params('#turretParams', state, {
        turretTracking: { label: 'track the drone (re-aims both motors every frame)' },
        showAxes: { label: 'draw axis indicators' },
    }, { onChange: (k, v) => (k === 'turretTracking' ? setTurretTracking(v) : setShowAllAxes(v)) });
    $('#btnFireTurret').onclick = () => fireTurret(34);

    buildAxisGrid();
    $('#btnResetMachines').onclick = () => resetAll();
    $('#btnClearMachines').onclick = () => clearMachineDebris();

    params('#ccParams', state, { collideConnected: { label: 'jointed pair collides with itself' } },
        { onChange: (_, v) => setCollideConnected(v) });

    params('#benchParams', state, {
        gearSpeed: { label: 'gear drive', min: -5, max: 5, step: 0.1, fmt: (v) => v.toFixed(1) + ' rad/s' },
        gearRatio: { label: 'gear ratio', min: 0.5, max: 4, step: 0.1, fmt: (v) => v.toFixed(1) + ':1' },
        rackSpeed: { label: 'rack drive', min: -4, max: 4, step: 0.1, fmt: (v) => v.toFixed(1) + ' rad/s' },
    }, {
        onChange: (k, v) => {
            if (k === 'gearSpeed') setGearDrive(v);
            // Re-datum before re-coupling: a gear locks the hinge angles as they
            // are at creation, so a mid-spin change would bake in the transient.
            if (k === 'gearRatio') { resetGears(); setGearRatio(v); setGearDrive(state.gearSpeed); }
            if (k === 'rackSpeed') setRackDrive(v);
        },
    });
    $('#btnResetRack').onclick = () => { resetRack(); setRackDrive(state.rackSpeed); };
    $('#btnResetPulley').onclick = () => resetPulley();
    refreshMachines();
}

export function refreshMachines() {
    const deg = (r) => (r * 180 / Math.PI).toFixed(0) + '°';
    $('#mCrane').textContent = deg(machineOffset('crane', 'rotationY'));
    $('#mWinch').textContent = machineOffset('winch', 'translationY').toFixed(2) + ' m';
    $('#mPiston').textContent = machineOffset('piston', 'translationY').toFixed(2) + ' m';
    const t = machines.get('turret');
    $('#mTurret').textContent = t && t.aim ? `${deg(t.aim.yaw)} / ${deg(t.aim.pitch)}` : '—';
    // The measured separation IS the proof, so it is live, not an echo of the checkbox.
    $('#ccSep').textContent = collideSeparation().toFixed(3) + ' m';
    $('#ccHint').textContent = getCollideConnected()
        ? "ON — contact wins: the spheres are pushed apart past the rope's own 0.4 m cap."
        : 'OFF — the pair is excluded from collision, so the rope wins and the spheres merge to 0.40 m.';
    $('#mRack').textContent = rackOffset().toFixed(2) + ' m';
}
