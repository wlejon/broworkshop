// The walk and fly controls (lib/kit/planetcam.js) driven by injected input
// in headless bro, with numbers asserted and stills along each path.
//
//   bro-headless --grant files --width 1280 --height 720 demos/planet demos/planet/controls.js -- [out=<dir>]
//
// walk  20 s from the ground shot toward the range, walking and running,
//       turning with the mouse, a jump, and a re-anchor forced mid-walk:
//       the eye 1.6 to 1.8 m over the ground whenever it is on it, the
//       view's up the local up, no step in the eye's path on the body.
// fly   from the ground up to 100 km and to orbit (Space + Shift), and back
//       down (C + Shift) until it lands into walk: the times taken.
import { ctl, setShot, scene, R } from "/app/world.js";

const argv = (bro.app && bro.app.argv) || [];
const opt = (key) => { const a = argv.find((s) => typeof s === 'string' && s.startsWith(key + '=')); return a ? a.slice(key.length + 1) : undefined; };
const OUT = (opt('out') || bro.resolvePath('/app/captures')).replace(/\\/g, '/');
const fps = 30, dt = 1 / fps;
const frame = () => advanceTime(1000 / fps);
const frames = (n) => { for (let i = 0; i < n; i++) frame(); };
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a) => { const l = Math.hypot(a[0], a[1], a[2]); return a.map((x) => x / l); };
const tap = (code) => { keyDown(code); frame(); keyUp(code); };
const fails = [];
const check = (ok, what) => { console.log(`${ok ? 'PASS' : 'FAIL'} ${what}`); if (!ok) fails.push(what); };
const shot = (name) => { screenshot(`${OUT}/${name}.png`); console.log(`  still ${OUT}/${name}.png`); };
// The pointer moved by (dx, dy) pixels over the view, with the left button held.
let mouse = [640, 360];
const look = (dx, dy) => { mouse = [mouse[0] + dx, mouse[1] + dy]; mouseMove(mouse[0], mouse[1]); };

document.body.classList.add('clean');
bro.menu.hide();
flush();
perf.settle({ maxFrames: 300, kinds: ['land processes'] });

// --- walk ---------------------------------------------------------------------
setShot('ground');
frames(240);
perf.settle({ maxFrames: 3000 });
tap('KeyF');
check(ctl.mode === 'walk', `F from the held ground shot walks (mode ${ctl.mode})`);
mouseDown(mouse[0], mouse[1], 0);
frame();
console.log(`walk: pointer ${document.pointerLockElement ? 'locked' : 'not locked (drag look)'}`);
shot('walk_0s');

const alts = [], ups = [], steps = [], radial = [];
let prevBody = scene.toBody(ctl.state().pos), prevSerial = scene.place.serial, reanchors = 0, reanchorStep = 0;
let jumpTop = 0, jumped = false, ground0 = null, groundMin = Infinity, groundMax = -Infinity;
const N = 20 * fps;
keyDown('KeyW');
for (let i = 0; i < N; i++) {
    const t = i * dt;
    // Run from 4 to 12 s; turn a little every second; jump at 15 s.
    if (i === 4 * fps) keyDown('ShiftLeft');
    if (i === 12 * fps) keyUp('ShiftLeft');
    if (i % fps === 0 && i > 0) look(i % (2 * fps) === 0 ? 60 : -45, i < 2 * fps ? 8 : 0);
    if (i === 15 * fps) keyDown('Space');
    if (i === 15 * fps + 2) keyUp('Space');
    // A re-anchor forced mid-walk: the place onto a cell 40 km off (the
    // engine re-anchors back on the eye's cell the next frame).
    if (i === 10 * fps) {
        const s = ctl.state(), u = scene.upAt(s.pos);
        const far = s.pos.map((x, k) => x + s.heading[k] * 40000 - u[k] * (40000 ** 2) / (2 * R));
        scene.reanchorAt(scene.toBody(far));
    }
    frame();
    const s = ctl.state(), u = scene.upAt(s.pos), b = scene.toBody(s.pos);
    const v = ctl.view(), f = norm(v.target.map((x, k) => x - v.position[k]));
    if (s.grounded) alts.push(s.altitude);
    ups.push({ roll: Math.abs(dot(norm(cross(f, v.up)), u)), above: dot(v.up, u) });
    const step = Math.hypot(b[0] - prevBody[0], b[1] - prevBody[1], b[2] - prevBody[2]);
    steps.push(step);
    radial.push(Math.hypot(b[0], b[1], b[2]) - R);
    if (scene.place.serial !== prevSerial) { reanchors += scene.place.serial - prevSerial; reanchorStep = Math.max(reanchorStep, step); prevSerial = scene.place.serial; }
    prevBody = b;
    const gh = radial[radial.length - 1] - s.altitude;
    if (ground0 == null) ground0 = gh;
    groundMin = Math.min(groundMin, gh); groundMax = Math.max(groundMax, gh);
    if (i >= 15 * fps && i < 17 * fps) { jumpTop = Math.max(jumpTop, s.altitude); if (!s.grounded) jumped = true; }
    if (i === 7 * fps) shot('walk_7s_running');
    if (i === 15 * fps + 10) shot('walk_15s_jump');
}
keyUp('KeyW');
frames(15);
shot('walk_20s');
mouseUp(mouse[0], mouse[1], 0);

const travelled = steps.reduce((a, b) => a + b, 0);
const amin = Math.min(...alts), amax = Math.max(...alts);
// (Jitter: the eye's height on the body, second difference a frame, over
// the frames walked on the ground away from the jump.)
let jerk = 0;
for (let i = 2; i < radial.length; i++) if (i < 15 * fps - 2 || i > 17 * fps + 2) jerk = Math.max(jerk, Math.abs(radial[i] - 2 * radial[i - 1] + radial[i - 2]));
console.log(`walk: ${travelled.toFixed(1)} m in 20 s, ground ${groundMin.toFixed(1)} to ${groundMax.toFixed(1)} m over the datum, ${alts.length} of ${N} frames on the ground`);
check(amin >= 1.6 && amax <= 1.8, `walk: eye ${amin.toFixed(3)} to ${amax.toFixed(3)} m over the ground`);
const roll = Math.max(...ups.map((x) => x.roll)), above = Math.min(...ups.map((x) => x.above));
check(roll < 1e-3 && above > 0, `walk: view's right off the local horizontal ${roll.toExponential(2)}, its up on the local up's side (min dot ${above.toFixed(3)})`);
check(jumped && jumpTop > 2.3, `walk: the jump lifted the eye to ${jumpTop.toFixed(2)} m`);
check(reanchors >= 1 && reanchorStep < 9 * dt * 1.5, `walk: ${reanchors} re-anchors, the eye's largest step on the body across one ${reanchorStep.toFixed(3)} m (a frame's walk ${(9 * dt).toFixed(2)} m)`);
check(Math.max(...steps) < 9 * dt * 1.5, `walk: largest step a frame ${Math.max(...steps).toFixed(3)} m`);
console.log(`walk: largest second difference of the eye's height a frame ${jerk.toFixed(4)} m`);

// --- fly ----------------------------------------------------------------------
tap('KeyF');
check(ctl.mode === 'fly', `F from walk flies (mode ${ctl.mode})`);
const alt0 = ctl.state().altitude;
check(Math.abs(alt0 - 1.7) < 0.05, `fly: takes off from the eye where it was (${alt0.toFixed(3)} m)`);
keyDown('ShiftLeft');
keyDown('Space');
let t = 0, t100 = null, tOrbit = null, at1k = false, at10k = false;
while (t < 120) {
    frame(); t += dt;
    const a = ctl.state().altitude;
    if (!at1k && a > 1000) { at1k = true; shot('fly_up_1km'); }
    if (!at10k && a > 10000) { at10k = true; shot('fly_up_10km'); }
    if (t100 == null && a > 1e5) { t100 = t; shot('fly_up_100km'); }
    if (a > 1.8e7) { tOrbit = t; break; }
}
keyUp('Space');
check(t100 != null && t100 < 30, `fly: ground to 100 km in ${t100?.toFixed(1)} s (boosted)`);
check(tOrbit != null && tOrbit < 45, `fly: ground to 18,000 km in ${tOrbit?.toFixed(1)} s (boosted)`);
// Look down at the globe from orbit.
mouseDown(mouse[0], mouse[1], 0);
for (let i = 0; i < 10; i++) { look(0, 60); frame(); }
mouseUp(mouse[0], mouse[1], 0);
frames(10);
shot('fly_orbit');
const vu = ctl.view(), uu = scene.upAt(vu.position);
const fo = norm(vu.target.map((x, k) => x - vu.position[k]));
check(Math.abs(dot(norm(cross(fo, vu.up)), uu)) < 1e-3, 'fly: at orbit the view is still level about the local up');
// Back down, sinking and boosted, until it lands.
keyDown('KeyC');
t = 0;
let tDown100 = null, down1k = false, lowest = Infinity;
while (t < 120 && ctl.mode === 'fly') {
    frame(); t += dt;
    const a = ctl.state().altitude;
    lowest = Math.min(lowest, a);
    if (Math.round(t / dt) % 30 === 0) { const s = ctl.state(); console.log(`  down ${t.toFixed(2)} s: ${a.toFixed(0)} m, ${Math.hypot(...s.vel).toFixed(0)} m/s, pitch ${s.pitch.toFixed(2)}`); }
    if (tDown100 == null && a < 1e5) { tDown100 = t; shot('fly_down_100km'); }
    if (!down1k && a < 1000) { down1k = true; shot('fly_down_1km'); }
}
keyUp('KeyC');
check(lowest >= 1.69, `fly: never under the eye's height over the ground (lowest ${lowest.toFixed(3)} m)`);
keyUp('ShiftLeft');
check(ctl.mode === 'walk', `fly: orbit to the ground in ${t.toFixed(1)} s, landed into ${ctl.mode} (100 km after ${tDown100?.toFixed(1)} s)`);
frames(60);
perf.settle({ maxFrames: 1500 });
shot('landed');
const sl = ctl.state();
check(sl.grounded && Math.abs(sl.altitude - 1.7) < 0.1, `landed: eye ${sl.altitude.toFixed(3)} m over the ground`);
// The unboosted pace, measured on the way up for 10 s from the ground.
tap('KeyF');
keyDown('Space');
frames(10 * fps);
keyUp('Space');
console.log(`fly: unboosted, 10 s of climbing from the ground reach ${ctl.state().altitude.toFixed(0)} m`);
tap('KeyF');
check(ctl.mode === 'orbit', `F from fly orbits (mode ${ctl.mode})`);
setShot('orbit');
frames(5);
check(ctl.mode === 'orbit', 'a view button holds its shot in orbit');
// The panel's buttons (main.js), when the page has them.
const flyButton = document.querySelector('#mode [data-value="fly"]');
if (flyButton) {
    flyButton.click();
    frame();
    const help = document.getElementById('help').textContent;
    check(ctl.mode === 'fly' && flyButton.classList.contains('active') && help.includes('WASD fly'), `the Fly button flies; help "${help}"`);
    document.querySelector('#shots [data-value="ground"]').click();
    frame();
    check(ctl.mode === 'orbit' && document.querySelector('#mode [data-value="orbit"]').classList.contains('active'), 'the Ground view button holds its shot, the Orbit button lit');
}

console.log(fails.length ? `${fails.length} FAILED` : 'all passed');
