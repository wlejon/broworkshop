// TripoSplat stage-time profile, through the lab's own worker (not a test:
// validate.sh only runs test_*.js). Two generates of the default sample: the
// first includes one-time warmup (CUDA graph capture, cuBLAS workspaces), the
// second is the steady-state number. The binding prints per-stage timings
// when BRO_TRIPOSPLAT_PROFILE=1; BRODIFFUSION_FLOW_PROFILE=1 adds a per-op
// flow-DiT breakdown (use few steps with it). From the broworkshop root:
//
//   BRO_TRIPOSPLAT_PROFILE=1 ../bro/build/Release/bro-headless.exe demos/triposplat \
//       demos/triposplat/tests/profile.js > tests/out/triposplat-profile.log 2>&1
//
// PROFILE_STEPS / PROFILE_GAUSSIANS override the lab defaults (20 / 131072).

import { waitFor, setValue, clickOn } from "/lib/kit/test.js";
import { lab } from "/app/lab.js";

const env = (typeof process !== 'undefined' && process.env) || {};
const steps = +env.PROFILE_STEPS || 20, gaussians = +env.PROFILE_GAUSSIANS || 131072;
const saved = lab.ui.prefs.snapshot();

waitFor(() => lab.loaded || lab.error, 'pipeline load', 600000);
if (lab.error) throw new Error(lab.error);
console.log('device: ' + lab.device + ' · steps ' + steps + ' · gaussians ' + gaussians);
lab.ui.controls.set('steps', steps);
lab.ui.controls.set('numGaussians', gaussians);
setValue('#bg-remove', false);
for (const label of ['run 1 (includes warmup)', 'run 2 (steady state)']) {
    const n = lab.runs;
    clickOn('#btn-go');
    waitFor(() => lab.runs > n, label, 600000);
    console.log(label + ': ' + (lab.cloud ? lab.cloud.ms + ' ms · ' + lab.cloud.count + ' gaussians' : lab.error));
}
lab.ui.prefs.restore(saved);
