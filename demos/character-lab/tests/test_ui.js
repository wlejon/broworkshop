// The panel and the input paths, driven for real: tabs, sliders that rebuild,
// the avatar toggle (and the engine animation it runs), keyboard movement,
// a left-click pick through the camera, the teleport buttons, world labels.

import { check, eq, frames, test, done, q, text, clickOn, setValue, press, shot } from "/lib/kit/test.js";
import { worldToScreen, Camera } from "/lib/kit/viewport3d.js";
import { canvas, cam, world, tune, charState, sense, qState, crowdState, characterAvatar,
         PLAZA, BALL_LAB, onTerrain, labelEls } from "/app/lab.js";

frames(10);

// The world pane is taller than the window: scroll the side panel the way a
// user would before clicking a control near its foot (or the tabs at its top).
const reach = (sel) => { q(sel).scrollIntoView({ block: 'center' }); flush(); clickOn(sel); };

const tab = (name) => {
    const r = q(`#tabs [data-tab="${name}"]`).getBoundingClientRect();
    check(r.right <= innerWidth, `tab ${name} on screen`);
    reach(`#tabs [data-tab="${name}"]`);
    check(!q(`[data-pane="${name}"]`).hidden, `pane ${name} shown`);
};


test('layout: viewport beside the panel, readouts live', () => {
    const vp = q('.k-viewport').getBoundingClientRect();
    check(vp.width > 1000 && vp.height > 600, 'viewport sized');
    check(q('.k-side').getBoundingClientRect().left >= vp.right - 1, 'panel on the right');
    eq(text('#roGround'), 'onGround');
    eq(text('#stGround'), 'onGround', 'status bar');
    check(/^\d+$/.test(text('#fps')), 'fps');
    eq(text('#tStepUpV'), '0.40 m', 'slider readouts painted');
});

test('world labels are projected onto the viewport', () => {
    const shown = labelEls.filter((el) => el.style.display === 'block');
    check(shown.length >= 5, `${shown.length} labels on screen`);
    const vp = q('.k-viewport').getBoundingClientRect();
    for (const el of shown) {
        const x = parseFloat(el.style.left), y = parseFloat(el.style.top);
        check(x >= -120 && x <= vp.width + 120 && y >= -40 && y <= vp.height + 40, 'inside the viewport');
    }
    tab('course');
    clickOn('#optLabels');
    frames(3);
    check(labelEls.every((el) => el.style.display === 'none'), 'the toggle hides them');
    clickOn('#optLabels');
    frames(3);
});

test('a construction slider rebuilds the controller once per frame', () => {
    tab('controller');
    const n = charState.rebuilds;
    setValue('#tStepUp', 0.6);
    setValue('#tStepUp', 0.7);
    frames(2);
    eq(tune.stepUp, 0.7);
    eq(charState.rebuilds, n + 1, 'two drags, one rebuild');
    setValue('#tStepUp', 0.4);
    frames(2);
    setValue('#tSpeed', 6);
    eq(tune.moveSpeed, 6, 'a movement slider is free');
    setValue('#tSpeed', 4.5);
});

test('keyboard: W walks the character; the avatar animates it', () => {
    clickOn('#cRigged');
    const av = characterAvatar();
    check(av && av.node.visible, 'avatar shown');
    check(tune.riggedAvatar, 'tune follows');
    // The ticked checkbox keeps focus: the game keys still reach the app,
    // and the Space it cancels for the jump does not toggle the box.
    check(document.activeElement === q('#cRigged'), 'the clicked checkbox has focus');
    const z0 = charState.position.z;
    keyDown('w'.charCodeAt(0), 0, 0);
    frames(40);
    check(charState.position.z < z0 - 1, `walked forward (z ${z0.toFixed(2)} -> ${charState.position.z.toFixed(2)})`);
    eq(av.state, 'ground', 'the machine is on the ground state');
    const bs = av.node.blendState();
    console.log('  avatar blendState: ' + JSON.stringify(bs).slice(0, 300));
    check(Array.isArray(bs.pos) && bs.pos[0] > 1, 'the locomotion space is fed the controller speed: ' + bs.pos);
    keyUp('w'.charCodeAt(0), 0, 0);
    press(' ');
    frames(8);
    eq(av.state, 'air', 'a jump travels to the air state');
    check(q('#cRigged').checked && tune.riggedAvatar, 'the cancelled Space left the focused checkbox ticked');
    frames(80);
    eq(av.state, 'ground', 'and lands');
    frames(8);
    clickOn('#cBones');
    check(av.overlay.enabled, 'bone overlay on');
    frames(4);
    eq(text('#roAvatar'), 'ground');
    shot('avatar');
    clickOn('#cBones');
    clickOn('#cRigged');
    check(!av.node.visible, 'capsule back');
});

test('left-click picks the crate under the cursor through the camera', () => {
    press('r');
    frames(20);
    tab('sensing');
    // Project the crate's centre through the camera and click that pixel: the
    // pick ray is the inverse projection, so it must come back to the crate.
    const tag = world.props[0];
    const c = Physics.getTransform(tag).position;
    const r = canvas.getBoundingClientRect();
    const s = worldToScreen([c.x, c.y, c.z], Camera.orbitViewOpts(cam, canvas), r.width, r.height);
    check(!s.behind && s.x > 0 && s.x < r.width && s.y > 0 && s.y < r.height, 'crate on screen');
    click(r.left + s.x, r.top + s.y, 0);
    frames(4);
    check(qState.pick && qState.pick.bodyId === tag, `picked ${qState.pick && qState.pick.name}`);
    check(qState.pick && qState.pick.viaOverlap, 'overlapPoint agreed with the ray');
    check(text('#qoPick').length > 1 && text('#qoPick') !== '—', 'readout: ' + text('#qoPick'));
});

test('teleport buttons: crowd, ball lab, terrain', () => {
    tab('world');
    reach('#btnGoCrowd');
    frames(20);
    check(Math.hypot(charState.position.x - PLAZA.x, charState.position.z - PLAZA.z) < PLAZA.radius + 4, 'at the plaza');
    check(crowdState.active > 0, 'crowd live');
    reach('#btnGoBall');
    frames(20);
    check(Math.hypot(charState.position.x - BALL_LAB.x, charState.position.z - BALL_LAB.z) < 1, 'at the ball lab');
    reach('#btnLaunch');
    frames(60);
    check(text('#boVerdict') !== '—', 'ball verdict: ' + text('#boVerdict'));
    reach('#btnGoTerrain');
    frames(40);
    check(onTerrain(charState.position.x, charState.position.z) && charState.isGrounded, 'on the hills');
    eq(text('#toOn'), 'yes');
    tab('course');
    reach('#btnReset');
    frames(30);
});

test('sensing panel: a filter checkbox changes the live ray', () => {
    tab('sensing');
    clickOn('#qIgnoreSelf');
    frames(6);
    check(!sense.ignoreSelf && qState.ray && qState.ray.name.startsWith('SELF'), 'unfiltered ray hits SELF');
    check(/^SELF/.test(text('#qoRay')), 'readout says SELF');
    clickOn('#qIgnoreSelf');
    frames(6);
    check(sense.ignoreSelf && !/^SELF/.test(text('#qoRay')), 'filter restored');
});

done('character-lab ui');
