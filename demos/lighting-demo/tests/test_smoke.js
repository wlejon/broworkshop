// Lighting Demo — HUD controls drive the scene and the kit orbit viewport
// responds to real mouse input. Run: scripts/validate.sh demos/lighting-demo
import { check, eq, frames, setValue, text, center, shot, test, done } from "/lib/kit/test.js";

frames(20);

// A coarse fingerprint of the rendered frame, to tell "the view moved".
function fingerprint() {
    let s = '';
    for (let y = 200; y < 1000; y += 160) for (let x = 400; x < 1800; x += 200) {
        const p = getPixel(x, y);
        s += (p.r >> 4) + ',' + (p.g >> 4) + ',' + (p.b >> 4) + ';';
    }
    return s;
}

test('readouts formatted at boot', () => {
    eq(text('#exposureVal'), '1.00');
    eq(text('#sunVal'), '3.0');
    eq(text('#ambientVal'), '0.030');
});

test('sliders update their readouts', () => {
    setValue('#exposure', 2.5);
    eq(text('#exposureVal'), '2.50');
    setValue('#exposure', 1);
    setValue('#sun', 6);
    eq(text('#sunVal'), '6.0');
});

test('environment select loads an HDRI or explains how to get one', () => {
    setValue('#hdri', 'belfast_sunset_puresky');
    frames(5);
    const s = text('#envStatus');
    check(/loaded|HDRI missing/.test(s), 'env status: ' + s);
    setValue('#hdri', '');
    eq(text('#envStatus'), '');
});

test('wheel zoom and right-drag orbit move the camera', () => {
    setValue('#animate', false);           // hold the lights still
    frames(3);
    const before = fingerprint();
    const c = center('#stage');
    wheel(c.x + 300, c.y, 6);
    frames(3);
    const zoomed = fingerprint();
    check(zoomed !== before, 'wheel changed the view');
    mouseDown(c.x + 300, c.y, 2);
    mouseMove(c.x + 420, c.y + 40);
    mouseUp(c.x + 420, c.y + 40, 2);
    frames(3);
    check(fingerprint() !== zoomed, 'right-drag orbited the view');
});

shot('main');
done('lighting-demo');
