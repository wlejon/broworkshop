// The live view: it loads a run, plays and scrubs it, shows A and B side by
// side, switches scenario, and opens a sheet; screenshots of each state go
// to tests/out/shots/tools_creature-lab-*.png.
//   scripts/validate.sh tools/creature-lab/tests/test_live.js

import { check, eq, test, done, frames, q, shot } from "/lib/kit/test.js";

const lab = globalThis.creatureLab;
check(lab, 'main.js exposes globalThis.creatureLab');
await lab.start();
frames(4);
const S = lab.state;

/** Not one flat colour over the viewport centre: something is drawn there. */
function drawn() {
    const r = q('#view').getBoundingClientRect();
    const cx = (r.left + r.width / 2) | 0, cy = (r.top + r.height / 2) | 0;
    const px = [[0, 0], [-60, 0], [60, 0], [0, -40], [0, 40], [0, 80]].map(([dx, dy]) => getPixel(cx + dx, cy + dy));
    return px.some((p) => Math.abs(p.r - px[0].r) + Math.abs(p.g - px[0].g) + Math.abs(p.b - px[0].b) > 12);
}

test('loads the walk and draws it', () => {
    eq(S.scenario, 'walk', 'first scenario');
    eq(S.runs.length, 1, 'one run');
    check(S.steps > 600, 'recorded steps: ' + S.steps);
    check(drawn(), 'the deer is drawn');
    check(q('#flags').textContent.includes('deer'), 'metrics shown');
    shot('walk');
});

test('plays and scrubs', () => {
    const t0 = S.t;
    frames(30);
    check(S.t > t0 + 0.3, `playback advances (${t0} -> ${S.t})`);
    lab.setTime(3.2);
    near01(S.t, 3.2);
    eq(q('#scrub').value, String(Math.round(3.2 / S.dt)), 'scrub bar follows');
    S.playing = false;
    lab.setTime(4.0);
    frames(2);
    shot('walk-scrubbed');
});

function near01(a, b) { check(Math.abs(a - b) < 1e-6, `${a} vs ${b}`); }

await test('A and B side by side', async () => {
    await lab.load('deer', 'deer:overbend', 'trot');
    lab.setShow('ab');
    lab.setTime(4.0);
    frames(3);
    eq(S.runs.length, 2, 'two runs');
    check(S.runs.every((r) => r.node.visible), 'both shown');
    check(q('#flags').textContent.includes('limit: mtL.x'), 'B\'s limit flag listed');
    shot('ab-trot');
    lab.setShow('b');
    check(!S.runs[0].node.visible && S.runs[1].node.visible, 'B alone');
});

await test('an action scenario', async () => {
    await lab.load('deer', '', 'graze');
    lab.setShow('a');
    lab.setTime(3.0);
    frames(3);
    check(drawn(), 'drawn while grazing');
    shot('graze');
});

test('draws any sheet of the shown run on demand, beside the live view', () => {
    for (const kind of ['charts', 'turnaround', 'trajectory', 'range']) {
        q('#kind').value = kind;
        lab.openSheet();
        frames(2);
        check(q('#sheet').classList.contains('open'), `${kind}: sheet overlay open`);
        check(!!document.querySelector('#sheetBody img'), `${kind}: drawn (${document.querySelector('#sheetBody').textContent.slice(0, 300)})`);
        shot(`sheet-${kind}`);
    }
    q('#close').click();
    check(!q('#sheet').classList.contains('open'), 'closed');
    frames(3);
    check(drawn(), 'the live view still draws');
});

done('creature-lab live');
