// AI Arena — record a stretch of a match to .bgar, play it back onto the
// stage, and check playback freezes the live match and hands it back.
//
//   scripts/validate.sh demos/ai-arena
import { check, test, done, simUntil, frames, q, text, setValue, clickOn } from "/lib/kit/test.js";
import { lab } from "/app/lab.js";

const fs = require("fs");
const positions = () => lab.state.agents.map((a) => a.x.toFixed(3) + "," + a.z.toFixed(3)).join(" ");

frames(5);
setValue('#sel-scenario', 'squad_3v3');

let path = null;
test('record writes a replay with frames and events', () => {
    clickOn('#btn-record');
    check(lab.isRecording() && q('#btn-record').textContent === 'Stop rec', 'recording');
    path = lab.recordingPath();
    check(/replays[\\/]arena-\d+\.bgar$/.test(path), 'recording into the app replays dir: ' + path);
    simUntil(() => lab.state.elapsed > 6, 12000);
    check(/recording\s+\d+ frames/.test(text('#status')) || lab.isRecording(), 'status while recording');
    clickOn('#btn-record');
    check(!lab.isRecording(), 'stopped');
    check(fs.existsSync(path), 'file written');

    const rr = bro.ai.game.createReplayReader();
    check(rr.open(path), 'reader opens it: ' + rr.errorMessage);
    check(rr.frameCount > 60, 'frames: ' + rr.frameCount);
    check(rr.damageSummary().length > 0, 'damage events were recorded');
});

test('play drives the stage from the file, then resumes the match', () => {
    const live = positions();
    clickOn('#btn-play');
    check(lab.isPlaying() && q('#btn-play').classList.contains('active'), 'playing');
    frames(30);
    check(positions() === live, 'live match frozen during playback');
    check(/^replay \d+\/\d+/.test(text('#status')), 'status shows replay progress: ' + text('#status'));
    const first = lab.state.agents[0].unit.id;
    const node = lab.stage.unitNode(first);
    const f = lab.playback.frame.agents.find((a) => a.id === first);
    check(f && Math.abs(node.x - f.x) < 1e-3 && Math.abs(node.z - f.z) < 1e-3, 'unit node sits on the recorded position');

    check(simUntil(() => !lab.isPlaying(), 20000), 'playback reaches the end');
    check(/replay finished/.test(q('#log').lastElementChild.textContent), 'finish logged');
    check(q('#btn-play').textContent === 'Play', 'play button reset');
    check(simUntil(() => positions() !== live, 3000), 'live match runs again');
});

test('stop mid-playback', () => {
    clickOn('#btn-play');
    frames(10);
    clickOn('#btn-play');
    check(!lab.isPlaying(), 'stopped');
    check(/replay stopped/.test(q('#log').lastElementChild.textContent), 'stop logged');
});

if (path) fs.unlinkSync(path);
done('ai-arena replay');
