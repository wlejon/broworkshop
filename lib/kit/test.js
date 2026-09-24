// lib/kit/test.js — helpers for headless test scripts.
//
// Test scripts are ES modules compiled in-process by bro-headless, so they
// import from /lib like any app module (and top-level await works):
//
//   // demos/foo/tests/test_main.js — run: scripts/validate.sh demos/foo
//   import { check, frames, waitFor, clickOn, setValue, shot, done } from "/lib/kit/test.js";
//   frames(10);
//   clickOn('#btn-load');
//   waitFor(() => /ready/.test(text('#status')), 'model loaded', 60000);
//   shot('loaded');
//   done();
//
// Failing is throwing: every check throws, and an uncaught throw makes
// bro-headless exit 1. `test(name, fn)` collects instead of stopping, and
// done() throws if any collected test failed.
//
// Globals from bro-headless used here: advanceTime/sleep, flush, click,
// mouseMove, keyDown/keyUp, textInput, screenshot. See bro docs/headless.md.

// --- assertions -----------------------------------------------------------------

/** Throw `msg` unless cond is truthy. */
export function check(cond, msg) {
    if (!cond) throw new Error('check failed: ' + (msg || 'condition'));
}

/** Deep-equal via JSON. */
export function eq(actual, expected, msg) {
    const a = JSON.stringify(actual), b = JSON.stringify(expected);
    if (a !== b) throw new Error((msg || 'eq') + ': got ' + a + ', want ' + b);
}

/** |a - b| <= eps. */
export function near(a, b, eps, msg) {
    eps = eps == null ? 1e-6 : eps;
    if (!(Math.abs(a - b) <= eps)) throw new Error((msg || 'near') + ': ' + a + ' vs ' + b + ' (eps ' + eps + ')');
}

/** Expect fn to throw (optionally matching re). */
export function throws(fn, re, msg) {
    try { fn(); } catch (e) {
        if (re && !re.test(String((e && e.message) || e))) throw new Error((msg || 'throws') + ': wrong error ' + e);
        return;
    }
    throw new Error((msg || 'throws') + ': did not throw');
}

// --- collected tests ------------------------------------------------------------

let ran = 0, failures = [];

/** Run fn, log ok/FAIL, keep going. Async fns are awaited when the caller awaits. */
export function test(name, fn) {
    ran++;
    const fail = (e) => {
        failures.push(name);
        console.log('  FAIL ' + name + ': ' + ((e && e.message) || e));
    };
    try {
        const r = fn();
        if (r && typeof r.then === 'function') {
            return r.then(() => console.log('  ok   ' + name), fail);
        }
        console.log('  ok   ' + name);
    } catch (e) { fail(e); }
}

/** Print the tally; throw if any test() failed. Call once at the end. */
export function done(label) {
    console.log((label ? label + ': ' : '') + (ran - failures.length) + '/' + ran + ' passed');
    if (failures.length) throw new Error(failures.length + ' failed: ' + failures.join(', '));
}

// --- time ---------------------------------------------------------------------

/** Advance n frames of virtual time (16 ms each) and flush. */
export function frames(n) {
    for (let i = 0; i < (n == null ? 1 : n); i++) advanceTime(16);
    flush();
}

/**
 * Pump the engine until pred() is truthy or `timeoutMs` of WALL time passes
 * (real threads — model loads, workers, child processes — need real time;
 * each step also advances virtual time so timers and callbacks deliver).
 * Returns the final pred() value.
 */
export function pumpUntil(pred, timeoutMs, stepMs) {
    const end = Date.now() + (timeoutMs == null ? 10000 : timeoutMs);
    const step = stepMs || 20;
    while (!pred()) {
        if (Date.now() > end) return pred();
        advanceTime(step);
    }
    return true;
}

/** pumpUntil that throws `msg` on timeout. */
export function waitFor(pred, msg, timeoutMs, stepMs) {
    if (!pumpUntil(pred, timeoutMs, stepMs)) {
        throw new Error('timed out waiting for ' + (msg || 'condition') + ' (' + (timeoutMs || 10000) + ' ms)');
    }
}

// --- DOM ----------------------------------------------------------------------

/** querySelector that throws on a miss (or returns an element passed in). */
export function q(sel) {
    if (typeof sel !== 'string') return sel;
    const el = document.querySelector(sel);
    if (!el) throw new Error('no element matches ' + sel);
    return el;
}

/** Trimmed textContent of a selector. */
export function text(sel) { return q(sel).textContent.trim(); }

/** Center of an element in viewport coordinates. */
export function center(sel) {
    const r = q(sel).getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
}

/**
 * A real click through the engine's input pipeline (hit test, focus,
 * bubbling) at the element's center. Throws if the element has no box or
 * another element is on top of that point.
 */
export function clickOn(sel, button) {
    const el = q(sel);
    const r = el.getBoundingClientRect();
    if (!(r.width > 0 && r.height > 0)) throw new Error('clickOn: ' + sel + ' has no box (hidden?)');
    const x = r.left + r.width / 2, y = r.top + r.height / 2;
    const hit = document.elementFromPoint ? document.elementFromPoint(x, y) : el;
    if (hit && hit !== el && !el.contains(hit) && !(hit.contains && hit.contains(el))) {
        throw new Error('clickOn: ' + sel + ' is covered by ' + describe(hit));
    }
    click(x, y, button || 0);
    flush();
}

/** Click into a field, replace its value by typing, and flush. */
export function typeInto(sel, value) {
    const el = q(sel);
    clickOn(el);
    el.value = '';
    textInput(String(value));
    flush();
}

/**
 * Set a control's value the way a user would leave it and fire input+change
 * (for ranges, selects, checkboxes: textInput cannot drive those).
 */
export function setValue(sel, value) {
    const el = q(sel);
    if (el.type === 'checkbox' || el.type === 'radio') el.checked = !!value;
    else el.value = String(value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    flush();
}

const SDLK = {
    Enter: 0x0d, Escape: 0x1b, Backspace: 0x08, Tab: 0x09, ' ': 0x20, Space: 0x20, Delete: 0x7f,
    ArrowRight: 0x4000004f, ArrowLeft: 0x40000050, ArrowDown: 0x40000051, ArrowUp: 0x40000052,
    Home: 0x4000004a, End: 0x4000004d, PageUp: 0x4000004b, PageDown: 0x4000004e,
};

/** Press and release a key through the engine: 'Enter', 'ArrowUp', 'a', '5'. mod = SDL keymod bits. */
export function press(key, mod) {
    const code = SDLK[key] != null ? SDLK[key] : key.length === 1 ? key.toLowerCase().charCodeAt(0) : null;
    if (code == null) throw new Error('press: unknown key ' + key);
    keyDown(code, 0, mod || 0);
    keyUp(code, 0, mod || 0);
    flush();
}

function describe(el) {
    return el.tagName.toLowerCase() + (el.id ? '#' + el.id : '') +
        (el.className && typeof el.className === 'string' ? '.' + el.className.trim().split(/\s+/).join('.') : '');
}

// --- output -------------------------------------------------------------------

/** Name of the app under test ('demos/kws-lab' -> 'demos_kws-lab'). */
export function appName() {
    const dir = String((globalThis.bro && bro.appDir) || '').replace(/\\/g, '/');
    const m = /\/(games|demos|tools|ai|templates)\/([^/]+)\/?$/.exec(dir);
    return m ? m[1] + '_' + m[2] : dir.split('/').filter(Boolean).pop() || 'app';
}

/**
 * Screenshot to tests/out/shots/<app>-<name>.png (CWD = repo root, as
 * scripts/validate.sh runs), or crop to `sel`. Returns the path.
 */
export function shot(name, sel) {
    flush();
    const path = 'tests/out/shots/' + appName() + '-' + name + '.png';
    if (sel) screenshot(path, sel); else screenshot(path);
    return path;
}
