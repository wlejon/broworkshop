// Video Demo — the IDL controls change the element, and the element's behaviour.
import { check, eq, near, frames, test, done, text, q, clickOn, setValue, shot } from "/lib/kit/test.js";
import { lab, describe, stepFrame } from "/app/lab.js";

frames(4);
const v = lab.video;
v.muted = true;

// Media seconds advanced per `wallMs` of wall clock while playing.
function mediaAdvance(wallMs) {
    v.currentTime = 0;
    flush();
    v.play();
    const t0 = v.currentTime, w0 = Date.now();
    wallSleep(wallMs); flush();
    const dt = v.currentTime - t0, dw = (Date.now() - w0) / 1000;
    v.pause(); flush();
    return dt / dw;
}

test('playbackRate slider sets the rate and fires ratechange', () => {
    const before = lab.counts.ratechange;
    setValue('#rate', 2);
    eq(v.playbackRate, 2);
    eq(text('#rate-val'), '2.00');
    check(lab.counts.ratechange === before + 1, 'ratechange fired');
});

test('rate 2 plays faster than rate 0.5', () => {
    const fast = mediaAdvance(400);
    setValue('#rate', 0.5);
    const slow = mediaAdvance(400);
    check(fast > slow * 2, 'rate 2 speed ' + fast.toFixed(2) + ' vs rate 0.5 speed ' + slow.toFixed(2));
    setValue('#rate', 1);
});

test('volume + muted controls fire volumechange', () => {
    const before = lab.counts.volumechange;
    setValue('#volume', 0.5);
    near(v.volume, 0.5, 1e-6, 'volume');
    eq(text('#volume-val'), '0.50');
    setValue('#muted', false);
    eq(v.muted, false);
    check(lab.counts.volumechange >= before + 2, 'volumechange for volume and muted');
    setValue('#muted', true);
});

test('attribute flags reflect onto the element', () => {
    for (const prop of ['autoplay', 'loop', 'controls']) {
        setValue('#' + prop, true);
        eq(v[prop], true, prop);
        check(v.hasAttribute(prop), prop + ' attribute set');
        setValue('#' + prop, false);
        check(!v.hasAttribute(prop), prop + ' attribute removed');
    }
    setValue('#defaultMuted', true);
    check(v.defaultMuted && v.hasAttribute('muted'), 'defaultMuted reflects the muted attribute');
    setValue('#defaultMuted', false);
    setValue('#preload', 'auto');
    eq(v.preload, 'auto');
    check(/preload auto/.test(describe(v)), 'state line shows preload');
});

test('seek buttons land on frames', () => {
    clickOn('#seek1');
    near(v.currentTime, 1.0, 0.1, 'seek 1s');
    clickOn('#seek-end');
    check(v.currentTime > v.duration - 0.35, 'seek end-0.2 -> ' + v.currentTime);
    clickOn('#seek0');
    near(v.currentTime, 0, 1e-6, 'seek 0');
    check(lab.counts.seeked >= 3, 'seeked events');
});

test('frame stepping moves exactly one picture and back', () => {
    check(v.frameRate >= 0, 'frameRate is a number (0 = container declares none): ' + v.frameRate);
    clickOn('#seek1');
    const t0 = v.currentTime;
    clickOn('#step-fwd');
    eq(lab.lastStep, 1, 'stepped one frame');
    const t1 = v.currentTime;
    check(t1 > t0 && t1 - t0 < 0.2, 'forward one picture ' + t0 + ' -> ' + t1);
    if (v.frameRate > 0) near(t1 - t0, 1 / v.frameRate, 0.5 / v.frameRate, 'one frame interval');
    clickOn('#step-back');
    eq(v.currentTime, t0, 'back to the exact frame');
    eq(stepFrame(-100000), lab.lastStep);
    check(lab.lastStep > 0 && v.currentTime === 0, 'stepping past the start stops at the first frame');
});

test('canPlayType buttons', () => {
    clickOn('#cpt-vp9');
    check(/=> "(probably|maybe)"/.test(text('#cpt-result')), text('#cpt-result'));
    clickOn('#cpt-mp4');
    check(/=> ""/.test(text('#cpt-result')), 'mp4 unsupported: ' + text('#cpt-result'));
});

test('set src reloads through the element', () => {
    const loads = lab.counts.loadedmetadata;
    clickOn('#apply-src');
    frames(2);
    check(/hello\.webm$/.test(v.currentSrc), 'currentSrc ' + v.currentSrc);
    check(lab.counts.loadedmetadata > loads, 'loadedmetadata again');
    check(v.readyState >= 1, 'metadata after reload');
});

test('state panel is the element, read live', () => {
    const s = q('#state').textContent;
    check(s.indexOf('readyState    ' + v.readyState) >= 0, 'readyState line');
    check(/video size +\d+×\d+/.test(s), 'size line');
});

shot('idl');
done('video_demo idl');
