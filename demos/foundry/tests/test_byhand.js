// demos/foundry/tests/test_byhand.js — an operator does the Hand-over yard's job by hand,
// through the input a person has and nothing else: keys held and let go, Space, Tab, the
// speed menu, and the readouts on screen. Where the hook is stands in for looking at the
// view. Which key turns which way is found the way a person finds it, by a tap and a look.
import { test, check, frames, shot, done, setValue, q } from "/lib/kit/test.js";

const f = window.foundry;
const CODE = { Tab: 0x09, ' ': 0x20 };
const code = (k) => CODE[k] ?? k.charCodeAt(0);
function hold(k, n) { keyDown(code(k), 0, 0); frames(Math.max(1, n)); keyUp(code(k), 0, 0); frames(1); }
function tap(k) { hold(k, 1); }
const wrap = (a) => ((((a + Math.PI) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI)) - Math.PI;

/** The driven machine's deck, as read off the screen: control name → [up key, down key]. */
function deckKeys() {
    const out = {};
    for (const box of document.querySelectorAll('#deck [data-ctl]')) {
        const name = box.querySelector('.f-dk-name').textContent, keys = box.querySelector('.f-dk-keys');
        if (keys) out[name] = keys.textContent.toLowerCase().split('/').map((s) => s.trim());
    }
    return out;
}
const hookText = () => (q('#hookSt') ? q('#hookSt').textContent : '');
const driven = () => f.site.machines.find((m) => document.querySelector(`#yardMachines [data-machine="${m.name}"]`).classList.contains('sel'));

/** Tab until `name` is the one being driven. */
function takeMachine(name) {
    for (let k = 0; k < 6 && (!driven() || driven().name !== name); k++) tap('Tab');
    return driven() && driven().name === name;
}

/** Where the hook is round the machine: angle and distance out from where it stands. */
function polar(m, p) { return { a: Math.atan2(p[2] - m.mid[1], p[0] - m.mid[0]), r: Math.hypot(p[0] - m.mid[0], p[2] - m.mid[1]) }; }

/** Bring the hook over [x, z]: aim the boom head with the slew keys and the arm's, a little at a time, watching, and see the hook hang there once it stops swinging. */
function hookOver(m, keys, at, tol) {
    const want = polar(m, [at[0], 0, at[1]]);
    // Which way each key takes it: a tap and a look.
    const learn = (pair, read) => { const a = read(); hold(pair[0], 20); frames(10); return Math.sign(read() - a) || 1; };
    const slew = keys.Slew, armName = Object.keys(keys).find((k) => k !== 'Slew' && k !== 'Hoist'), arm = keys[armName];
    const dir = { slew: learn(slew, () => polar(m, m.tipWorld()).a) };
    dir.arm = learn(arm, () => polar(m, m.tipWorld()).r);
    // How long to hold a key per metre still to go, learned as it goes: shorter after an
    // overshoot, longer after falling short, as a person gets the feel of a machine.
    const gain = { slew: 20, arm: 40 };
    for (let it = 0; it < 200; it++) {
        // A crate set down on the way is dragged: take the line in until it hangs again.
        if (/^on /.test(hookText())) { for (let k = 0; k < 60 && !/lifting/.test(hookText()); k++) hold(keys.Hoist[0], 2); hold(keys.Hoist[0], 8); }
        const h = polar(m, m.tipWorld());
        const ea = wrap(want.a - h.a) * want.r, er = want.r - h.r;
        if (Math.abs(ea) < tol && Math.abs(er) < tol) {
            // Wait for the load to stop swinging, then look at where the hook hangs.
            frames(20);
            const g = polar(m, m.hookWorld());
            if (Math.abs(wrap(want.a - g.a) * want.r) < tol && Math.abs(want.r - g.r) < tol) return true;
            continue;
        }
        const which = Math.abs(ea) >= Math.abs(er) ? 'slew' : 'arm', e = which === 'slew' ? ea : er;
        const pair = which === "slew" ? slew : arm, s = dir[which];
        hold(pair[Math.sign(e) === s ? 0 : 1], Math.max(1, Math.min(60, Math.round(Math.abs(e) * gain[which]))));
        frames(8);
        const n = polar(m, m.tipWorld()), e2 = which === 'slew' ? wrap(want.a - n.a) * want.r : want.r - n.r;
        // It went the wrong way: that key does the other thing. Past it: hold for less. Short of it: more.
        if (Math.sign(e2) === Math.sign(e) && Math.abs(e2) > Math.abs(e) + 0.02) dir[which] = -dir[which];
        else if (Math.sign(e2) !== Math.sign(e) && Math.abs(e2) > tol) gain[which] = Math.max(2, gain[which] * 0.6);
        else if (Math.abs(e2) > Math.abs(e) * 0.6) gain[which] = Math.min(200, gain[which] * 1.25);
    }
    const h = polar(m, m.hookWorld());
    hookOver.miss = `${(wrap(want.a - h.a) * want.r).toFixed(2)} m round, ${(want.r - h.r).toFixed(2)} m out ang ${[...m.angles].map((v) => v.toFixed(2))} st ${m.status}`;
    return false;
}

/** Let the line down until the screen says a crate is under the hook. */
function lowerOnto(keys) {
    for (let k = 0; k < 200 && !/Space takes it/.test(hookText()); k++) hold(keys.Hoist[1], 2);
    return /Space takes it/.test(hookText());
}
/** Take the line in until the screen says the crate is off the ground, and a little more. */
function lift(keys) {
    for (let k = 0; k < 200 && !/lifting/.test(hookText()); k++) hold(keys.Hoist[0], 2);
    hold(keys.Hoist[0], 6);
    return /lifting/.test(hookText());
}
/** Let the line down until the crate stands (the screen stops saying lifting), then let it go. */
function setDown(keys) {
    for (let k = 0; k < 200 && /lifting/.test(hookText()); k++) hold(keys.Hoist[1], 2);
    hold(keys.Hoist[1], 3);
    tap(' ');
    hold(keys.Hoist[0], 6);
    return !/on |lifting/.test(hookText());
}

test('by hand, one operator gets the crate across with both cranes', () => {
    f.reset();
    f.yard(true, 'handover'); frames(2);
    setValue('#yardSpeed', '1'); frames(1);
    const crate = f.site.crates[0], pad = f.site.pads[0];
    const at = () => { const P = f.site.poseOf(crate); return [P[0], P[2]]; };
    // Crane A: Tab to it, read its deck.
    check(takeMachine('Crane A'), 'Tab takes Crane A');
    let A = driven(), keys = deckKeys();
    check(keys.Slew && keys.Hoist && Object.keys(keys).length === 3, `its deck: ${Object.entries(keys).map(([n, k]) => `${n} ${k.join('/')}`).join(', ')}`);
    check(hookOver(A, keys, at(), 0.08), `the hook brought over the crate with the slew and arm keys (${hookOver.miss})`);
    check(lowerOnto(keys), `the line let down until the screen says it can take the crate (${hookText()})`);
    tap(' ');
    check(/on Crate/.test(hookText()), `Space takes it (${hookText()})`);
    check(lift(keys), `the hoist key lifts it (${hookText()})`);
    shot('byhand-lifting');
    // Over to the ground between the cranes, which both reach, and down.
    const spot = [2.5, 0];
    check(hookOver(A, keys, spot, 0.1), `carried over to the ground between the cranes (${hookOver.miss})`);
    check(setDown(keys), `set down and let go (${hookText()})`);
    // Swing A out of the way: its boom head over the far side, where B never works.
    check(hookOver(A, keys, [-2.5, 0], 0.3), `Crane A swung clear (${hookOver.miss})`);
    // Crane B: Tab, read its deck, and the same again to the pad.
    check(takeMachine('Crane B'), 'Tab takes Crane B');
    const B = driven(); keys = deckKeys();
    check(hookOver(B, keys, at(), 0.08), `Crane B's hook over the crate where A left it (${hookOver.miss}; crate at ${at().map((v) => v.toFixed(2))})`);
    check(lowerOnto(keys), 'down onto it');
    tap(' ');
    check(lift(keys), 'taken and lifted');
    check(hookOver(B, keys, [pad.at[0], pad.at[2]], 0.12), `carried over the pad (${hookOver.miss})`);
    frames(60);  // a look before letting it down: the load hangs where it is
    shot('byhand-over-pad');
    check(new RegExp(`over ${pad.name}`).test(hookText()), `the hook panel says it is over the pad (${hookText()})`);
    check(setDown(keys), 'set down on the pad and let go');
    frames(30);
    shot('byhand-done');
    check(f.site.tasks[0].done && /done/.test(q("#yardTasks .d").textContent), `the task list says the crate is on the pad (${q("#yardTasks .d").textContent}; crate at ${at().map((v) => v.toFixed(2))}, pad at ${pad.at[0]},${pad.at[2]})`);
    f.yard(false); frames(1);
});

done('foundry by hand');
