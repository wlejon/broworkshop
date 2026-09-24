// Physics Playground — an interactive sandbox for bro's 3D Jolt surface.
//
// The parts of the physics API where the call is one line but the BEHAVIOUR
// is the point, each made visible and toggleable live:
//
//   sim/stage.js      three material lanes fed by identical ramps: friction and
//                     restitution become "how far" and "how high"
//   sim/spawn.js      loose bodies + the registry behind select/edit/clear
//   sim/areas.js      setAreaOverride fields: low gravity, water, a gravity well
//   sim/layers.js     a live-editable six-layer collision matrix
//   sim/ragdolls.js   humanoid ragdolls: joints, per-part punches, motorised vs
//                     kinematic pose drive
//   sim/softbody.js   a pinned cloth and a pressurized ball
//   sim/machines.js   SixDOF machine tools (crane, piston, tracking turret) with
//                     every axis switchable locked / limited / free
//   sim/bench.js      collideConnected, gear, rackAndPinion, pulley
//   sim/bridge.js     a bridge of breakingImpulse joints
//   sim/contacts.js   the contact manifold drawn, listed, and driving sparks,
//                     flashes, camera shake and an impact meter
//   view.js           camera, lights, bay views, click-to-select/drag/spawn
//   ui/*.js           one module per side-panel tab
//
// The headline control is the step-rate slider beside the interpolation box:
// at 15 Hz with interpolation off every body visibly snaps once per step.
//
// Tests import view.js / sim / ui, never this entry module (ENGINE-ISSUES.md:
// a driver script importing the page's entry module evaluates it again).

import { boot } from "/lib/kit/app.js";
import { tabs, fpsMeter } from "/lib/kit/ui.js";
import { $ } from "/lib/kit/dom.js";
import { vp, scene, grab } from "./view.js";
import { buildWorld, stepWorld } from "./sim/world.js";
import { shakeOffset } from "./sim/contacts.js";
import { bindSandbox, refreshSandbox, select, dropOne, setInterpolation, state as sandbox } from "./ui/sandbox.js";
import { bindBodies, refreshBodies } from "./ui/bodies.js";
import { bindMachines, refreshMachines } from "./ui/machines.js";
import { bindEffects, refreshEffects } from "./ui/effects.js";

const { status } = boot();

buildWorld(scene);
bindSandbox();
bindBodies();
bindMachines();
bindEffects();
tabs('#tabs');

// The two things you reach for constantly: another object, and the headline
// toggle without hunting for its checkbox.
document.addEventListener('keydown', (ev) => {
    if (ev.target && /INPUT|SELECT|TEXTAREA/.test(ev.target.tagName || '')) return;
    if (ev.key === ' ') { ev.preventDefault(); setInterpolation(!sandbox.interpolation); }
    else if (ev.key === 'Enter') { ev.preventDefault(); dropOne(); }
    else if (ev.key === 'Escape') select(null);
});

const fps = fpsMeter();
let frameNo = 0, shakeT = 0;

vp.onFrame((dt, t) => {
    stepWorld(dt);
    grab.update(dt);
    shakeT = t;
    const f = fps.tick();
    if (++frameNo % 20 === 0) {
        $('#stFps').textContent = f ? f.toFixed(0) : '—';
        refreshSandbox();
        refreshBodies();
        refreshMachines();
        refreshEffects();
    }
});

// Contact-driven shake, on the eye only: shaking the pivot would fight the
// user's own orbit input.
vp.onView((view) => {
    const s = shakeOffset(shakeT);
    view.position = [view.position[0] + s[0], view.position[1] + s[1], view.position[2] + s[2]];
});

status.set('left-click: select / drag / spawn · right-drag orbit · middle-drag pan · wheel zoom');
