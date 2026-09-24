// Ragdoll Blender — animation-to-ragdoll blending on one real Jolt ragdoll.
//
//   anim.js     procedural clips (idle / walk / run, two get-ups) as kit poses
//   blender.js  the ANIMATED -> IMPACT -> RAGDOLL -> SETTLING -> GETTING_UP machine
//   cannon.js   real cannonballs, a ballistic aim and a trajectory preview
//   lab.js      scene, floor, lights, grabbing, the frame loop
//   main.js     this: boot + the side panel

import { boot } from "/lib/kit/app.js";
import { $ } from "/lib/kit/dom.js";
import { params } from "/lib/kit/params.js";
import { segmented, progressBar, fpsMeter } from "/lib/kit/ui.js";
import { LOOPS } from "./anim.js";
import { blender, cannon, resetCamera, onFrame } from "./lab.js";

const { status } = boot();

const anims = segmented('#animRow', LOOPS, { value: 'idle', onChange: (v) => blender.setAnimation(v) });

const tune = { stiffness: blender.stiffness, speed: cannon.speed };
params('#tuneParams', tune, {
    stiffness: { label: 'motor stiffness', min: 0, max: 30, step: 1, fmt: (v) => v + ' Hz' },
    speed: { label: 'cannon speed', min: 10, max: 40, step: 1, fmt: (v) => v + ' m/s' },
}, { onChange: (k, v) => (k === 'stiffness' ? blender.setStiffness(v) : cannon.setSpeed(v)) });

$('#btnCannon').onclick = () => cannon.fire();
$('#btnRagdoll').onclick = () => blender.triggerRagdoll(2, { x: 35, y: 20, z: 0 });    // a shove to the chest
$('#btnGetUp').onclick = () => blender.triggerGetUp();
$('#btnReset').onclick = () => { blender.resetToStand(anims.value); };
$('#btnCam').onclick = () => resetCamera();

const bar = progressBar('#blendBar');
const fps = fpsMeter();
let n = 0;
onFrame(() => {
    const f = fps.tick();
    if (++n % 6) return;                      // ten readouts a second is plenty
    const w = blender.weight;
    bar.set(w);
    $('#blendVal').textContent = `${Math.round(w * 100)} % (${w > 0.5 ? 'ragdoll' : 'kinematic'})`;
    const badge = $('#stateBadge');
    badge.textContent = blender.state;
    badge.className = 'badge ' + blender.state.toLowerCase();
    $('#stState').textContent = blender.state;
    $('#stClip').textContent = blender.clip;
    $('#pelvisVal').textContent = blender.pelvisHeight().toFixed(2) + ' m';
    $('#keVal').textContent = blender.kineticEnergy().toFixed(1) + ' J';
    $('#restVal').textContent = blender.restLabel();
    $('#shotVal').textContent = `${cannon.shots} / ${cannon.hits}`;
    $('#stFps').textContent = f ? f.toFixed(0) : '—';
    // A get-up hands back to idle; keep the clip buttons honest.
    if (blender.state === 'ANIMATED' && anims.value !== blender.clip) anims.value = blender.clip;
});

status.set('shoot the cannon, or left-drag a limb · right-drag orbit · middle-drag pan · wheel zoom');
