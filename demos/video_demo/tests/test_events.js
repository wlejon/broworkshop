// Video Demo — playback on the wall clock delivers the media events the app logs.
// Video time ignores advanceTime(); wallSleep() moves it, flush() pumps events.
import { check, eq, frames, test, done, text, q, clickOn, shot } from "/lib/kit/test.js";
import { lab } from "/app/lab.js";

frames(4);
const v = lab.video;

test('metadata primed at load', () => {
    check(v.readyState >= 1, 'readyState ' + v.readyState);
    check(v.duration > 0 && Number.isFinite(v.duration), 'duration ' + v.duration);
    check(v.videoWidth > 0 && v.videoHeight > 0, 'size ' + v.videoWidth + 'x' + v.videoHeight);
    check(/loaded \d+×\d+/.test(text('#status')), 'status names the clip: ' + text('#status'));
});

test('play button starts playback; time advances on the wall clock', () => {
    v.muted = true;
    clickOn('#play');
    check(!v.paused, 'playing after click');
    const t0 = v.currentTime;
    for (let i = 0; i < 6; i++) { wallSleep(100); flush(); }
    check(v.currentTime > t0 + 0.2, 'currentTime ' + t0 + ' -> ' + v.currentTime);
    check(lab.counts.play >= 1, 'play event counted');
    check(lab.counts.timeupdate >= 1, 'timeupdate while playing');
    check(/play/.test(text('#events')), 'play in the event log');
});

test('pause holds the clock', () => {
    clickOn('#pause');
    flush();
    check(v.paused, 'paused');
    const held = v.currentTime;
    wallSleep(200); flush();
    eq(v.currentTime, held, 'paused time does not move');
    check(lab.counts.pause >= 1, 'pause event counted');
});

test('play through to the end fires ended', () => {
    v.currentTime = Math.max(0, v.duration - 0.3);
    v.play();
    for (let i = 0; i < 20 && !v.ended; i++) { wallSleep(100); flush(); }
    check(v.ended, 'ended at ' + v.currentTime + ' / ' + v.duration);
    check(lab.counts.ended === 1, 'ended fired once, got ' + lab.counts.ended);
    frames(2);   // the state panel repaints on rAF
    check(/ended true/.test(q('#state').textContent), 'state panel shows ended');
});

test('clear empties the event log', () => {
    clickOn('#clear-events');
    eq(q('#events').childElementCount, 0);
});

shot('events');
done('video_demo events');
