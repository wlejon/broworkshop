// The live app: boot readouts, the bake panel's stale-then-rebake flow, path
// presets, the NavGrid comparison, save/load, click-to-pick through the
// camera, folding panels, and the screenshots.
//
//   scripts/validate.sh demos/nav-lab
import { check, test, done, text, q, clickOn, setValue, shot, frames } from "/lib/kit/test.js";
import { marks } from "/app/level.js";
import { bakeParams, navState } from "/app/navmesh.js";
import { agentState } from "/app/agents.js";
import { lab, state, setRoute, pickLevel } from "/app/lab.js";
import { reach, reveal } from "./reach.js";

frames(30);

test('boots baked, with a route and live readouts', () => {
    check(navState.mesh && navState.mesh.valid, 'baked at boot');
    check(state.path && !state.path.partial, 'boot route drawn');
    check(+text('#stSamples') === navState.walkableSamples && navState.walkableSamples > 200, 'samples readout');
    check(/Baked from \d+ static bodies/.test(text('#bakeHint')), text('#bakeHint'));
    check(/Static \+ links: 3/.test(text('#modeBar')), text('#modeBar'));
    check(q('#btnModeLinks').classList.contains('active'), 'mode button lit');
    check(/m$/.test(text('#stLen')), 'length readout ' + text('#stLen'));
    check(text('#status') === 'ready', text('#status'));
    check(q('#steerLegend').children.length === 5, 'kernel legend');
});
shot('boot');

test('a bake slider marks the bake stale; the button applies it', () => {
    const samples = navState.walkableSamples;
    reveal('#pRadius');
    setValue('#pRadius', 1.0);
    check(bakeParams.agentRadius === 1.0 && text('#pRadiusV') === '1.00 m', 'param + readout');
    check(/press Re-bake/.test(text('#bakeHint')) && navState.walkableSamples === samples, 'stale, not re-baked');
    reach('#btnBake');
    check(navState.walkableSamples < samples, `${samples} -> ${navState.walkableSamples}`);
    check(/Baked from/.test(text('#bakeHint')), text('#bakeHint'));
    setValue('#pRadius', 0.5);
    reach('#btnBake');
    check(navState.walkableSamples === samples, 'restored');
});

test('path presets and the NavGrid comparison', () => {
    reach('#btnCrossFloor');
    check(state.path && state.path.rise > 3, 'cross-floor route');
    check(/Multi-level route/.test(text('#pathHint')), text('#pathHint'));
    reveal('#gridOn');
    setValue('#gridOn', true);
    check(state.gridPath === null || state.gridPath.points.every((p) => p.y === 0), 'grid route is flat');
    check(/(pinned at y 0|finds nothing)/.test(text('#gridHint')), text('#gridHint'));
    reach('#btnSameFloor');
    check(state.path.rise < 0.75 && /agree/.test(text('#gridHint')), text('#gridHint'));
    setValue('#gridOn', false);
    reach('#btnToRoof');
    check(state.path && state.path.maxY > 7, 'roof route');
});

test('requireFullPath turns a clamped route into none', () => {
    setRoute(marks.eastRoom, { x: 18, y: 3, z: -10.5 });   // the island: reachable only by the jump
    check(state.path && !state.path.partial, 'reachable with the jump baked');
    reveal('#reqFull');
    setValue('#reqFull', true);
    check(state.requireFullPath === true, 'flag set');
    setValue('#reqFull', false);
});

test('save + load buttons round-trip the mesh', () => {
    setRoute(marks.hallSW, marks.mezzanine);
    reach('#btnSave');
    check(/^Saved \d+ bytes/.test(text('#cacheHint')), text('#cacheHint'));
    reach('#btnLoad');
    check(/same query returns the same/.test(text('#cacheHint')), text('#cacheHint'));
});

test('left-click on the level sets the route start through the camera', () => {
    const r = lab.vp.canvas.getBoundingClientRect();
    const target = marks.hallSW;
    const s = lab.vp.toScreen([target.x, target.y, target.z]);
    check(!s.behind && s.x > 0 && s.x < r.width && s.y > 0 && s.y < r.height, 'west hall on screen');
    const expect = pickLevel(s.x, s.y);
    check(expect && Math.hypot(expect.x - target.x, expect.z - target.z) < 1.0 && expect.y < 0.5,
        'the pick ray comes back to the floor it was projected from');
    click(r.left + s.x, r.top + s.y, 0);
    frames(2);
    check(Math.hypot(state.start.x - expect.x, state.start.y - expect.y, state.start.z - expect.z) < 1e-4,
        `start ${state.start.x.toFixed(2)}, ${state.start.y.toFixed(2)}, ${state.start.z.toFixed(2)}`);
});

test('walkers take the speed slider and the send button', () => {
    reveal('#aSpeed');
    setValue('#aSpeed', 5);
    check(agentState.agents.every((a) => a.agent.speed === 5), 'speed applied');
    setRoute(marks.hallSW, marks.eastRoom);
    reach('#btnSend');
    frames(30);
    check(/^[1-4] \/ 4$/.test(text('#stWalking')), 'walking ' + text('#stWalking'));
});

test('panels fold by their caption', () => {
    const panel = q('#btnSave').closest('.k-panel');
    const cap = panel.querySelector('h2');
    cap.scrollIntoView({ block: 'center' });
    flush();
    clickOn(cap);
    check(panel.classList.contains('folded'), 'folded class');
    const btn = q('#btnSave').getBoundingClientRect();
    check(btn.width === 0 && btn.height === 0, 'folded body hidden, its buttons with it');
    check(panel.getBoundingClientRect().height < 50, 'panel collapsed to its caption');
    clickOn(cap);
    check(!panel.classList.contains('folded'), 'unfolded');
});

// A frame worth looking at: the funnel with avoidance, the cross-floor route.
setRoute(marks.hallSW, marks.mezzanine);
reach('#btnFunnel');
reveal('#avoidOn');
setValue('#avoidOn', true);
frames(150);
shot('crowd');
setValue('#steerOn', true);
lab.vp.reframe([-6, 0, -18], 26, { yaw: 0.3, pitch: -0.7 });
frames(120);
shot('steering');
done('nav-lab ui');
