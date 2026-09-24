// ARDY Motion: boot loads the text encoder + motion model in the worker; a
// Generate through the panel returns a G1 clip and builds the skeleton (a
// sphere per joint, beads per bone); playback advances on the virtual clock,
// pause holds, the scrubber poses any frame. Skips without the weights.
//
//   scripts/validate.sh --ml ai/ardy-motion

import { check, test, done, waitFor, simUntil, q, text, clickOn, setValue, shot, needWeights } from "/lib/kit/test.js";
import { lab, ARDY, LLM2VEC } from "/app/lab.js";

needWeights('ARDY G1 motion model', ARDY, { probe: 'config.yaml' });
needWeights('LLM2Vec-Llama3-8B', LLM2VEC, { probe: 'config.json' });

waitFor(() => lab.ready || lab.error, 'pipeline load', 600000);
check(!lab.error, 'loaded: ' + lab.error);
test('device shown', () => check(lab.device && /ready/.test(lab.ui.row.metaEl.textContent)));
test('generate enabled, playback not yet', () => check(!q('#gen').disabled && q('#play').disabled));

// 1. generate a short clip with a fixed seed
setValue('#frames', '52');
setValue('#random-seed', false);
setValue('#seed', '7');
clickOn('#gen');
test('busy while generating', () => check(lab.busy && q('#gen').disabled));
waitFor(() => lab.clips > 0 || lab.error, 'generate', 600000);
check(!lab.error, lab.error);
const c = lab.clip;
test('clip shape', () => check(c.frames >= 52 && c.joints > 0 && c.fps === 25 &&
                               c.positions.length === c.frames * c.joints * 3 && c.parents.length === c.joints));
test('a sphere per joint', () => check(lab.joints.length === c.joints));
test('beads on every non-root bone', () => {
    let roots = 0; for (const p of c.parents) if (p < 0) roots++;
    check(lab.bones.length === c.joints - roots);
});
test('positions finite', () => { for (const v of c.positions) if (!Number.isFinite(v)) throw new Error('non-finite position'); });
test('clip info + seed', () => check(/7 · 2.5 · 10/.test(text('#clip-info')) && /foot contact/.test(text('#clip-info'))));
test('playing', () => check(lab.playing && text('#play') === 'Pause'));

// 2. playback advances on the virtual clock; pause holds
const f0 = lab.frame;
simUntil(() => lab.frame !== f0, 2000);
test('playback advanced', () => check(lab.frame !== f0, 'frame ' + lab.frame));
shot('playing');
clickOn('#play');
test('paused', () => check(!lab.playing && text('#play') === 'Play'));
const held = lab.frame;
simUntil(() => false, 400);
test('pause holds the frame', () => check(lab.frame === held));

// 3. scrub poses an exact frame
setValue('#scrub', String(c.frames - 1));
test('scrub posed the last frame', () => check(lab.frame === c.frames - 1 && text('#frame') === c.frames + ' / ' + c.frames));
const J = c.joints, base = (c.frames - 1) * J * 3;
test('joint 0 at its clip position (+ floor offset)', () =>
    check(Math.abs((lab.joints[0].x - c.positions[base]) - (lab.joints[1].x - c.positions[base + 3])) < 1e-4));

done('ardy-motion');
