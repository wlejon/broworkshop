// ui/effects.js — the Bridge and Contacts tabs.

import { $, h, clear } from "/lib/kit/dom.js";
import { params } from "/lib/kit/params.js";
import { progressBar } from "/lib/kit/ui.js";
import { bridge, setThreshold, brokenCount, jointCount, dropWreckingBall, fireProjectile,
         rebuildBridge, clearRubble } from "../sim/bridge.js";
import { state as cstate, recent, setFocus, clearContacts } from "../sim/contacts.js";

export const state = {
    breakThreshold: 900,
    contactsEnabled: true,
    contactDraw: true,
    contactDrawAll: false,
    contactEffects: true,
    contactMinImpulse: 6.0,
};

let breakP = null, contactP = null, meter = null;

// --- bridge ----------------------------------------------------------------------------

export function setBreakThreshold(n) {
    state.breakThreshold = n;
    setThreshold(n);
    if (breakP) breakP.set('breakThreshold', n, true);
    $('#breakHint').textContent = n < 300 ? 'fragile — the deck cannot even hold itself up'
        : n < 1500 ? 'realistic — a heavy impact tears it open'
        : n < 20000 ? 'tough — takes a full-speed shell'
        : 'indestructible — breakingImpulse this high never trips';
    return true;
}

export const smashBridge = () => dropWreckingBall(900, 12);
export const shootBridge = () => fireProjectile(70, 140);

// --- contacts --------------------------------------------------------------------------

const CONTACT_KEYS = { contactsEnabled: 'enabled', contactDraw: 'draw', contactDrawAll: 'drawAll',
                       contactEffects: 'effects', contactMinImpulse: 'minImpulse' };

function setContact(key, v) {
    state[key] = v;
    cstate[CONTACT_KEYS[key]] = v;
    if (contactP) contactP.set(key, v, true);
    return true;
}
export const setContactsEnabled = (on) => setContact('contactsEnabled', !!on);
export const setContactDraw = (on) => setContact('contactDraw', !!on);
export const setContactDrawAll = (on) => setContact('contactDrawAll', !!on);
export const setContactEffects = (on) => setContact('contactEffects', !!on);
export const setContactThreshold = (v) => setContact('contactMinImpulse', v);

// --- wiring ------------------------------------------------------------------------------

export function bindEffects() {
    breakP = params('#breakParams', state, {
        breakThreshold: { label: 'breaking', min: 60, max: 30000, step: 20, fmt: (v) => (v >= 20000 ? '∞' : String(Math.round(v))) },
    }, { onChange: (_, v) => setBreakThreshold(v) });
    $('#btnSmash').onclick = () => smashBridge();
    $('#btnShoot').onclick = () => shootBridge();
    $('#btnRebuild').onclick = () => { rebuildBridge(); setBreakThreshold(state.breakThreshold); };
    $('#btnClearRubble').onclick = () => clearRubble();

    meter = progressBar('#impactBar');
    contactP = params('#contactParams', state, {
        contactsEnabled: { label: 'process the contact stream' },
        contactDraw: { label: 'draw manifold points + normals' },
        contactDrawAll: { label: 'all bodies (else: the selected one)' },
        contactEffects: { label: 'sparks, flash and camera shake' },
        contactMinImpulse: { label: 'fx above', min: 0, max: 120, step: 1, fmt: (v) => v.toFixed(1) },
    }, { onChange: (k, v) => setContact(k, v) });
    $('#btnContactClear').onclick = () => { clearContacts(); setFocus(null); };

    setBreakThreshold(state.breakThreshold);
    for (const k of Object.keys(CONTACT_KEYS)) setContact(k, state[k]);
    refreshEffects();
}

/** Readouts, on the fps cadence: live enough, and a rebuilt list costs nothing. */
export function refreshEffects() {
    $('#stBroken').textContent = `${brokenCount()} / ${jointCount()}`;
    const log = clear($('#breakLog'));
    if (!bridge.log.length) log.appendChild(h('div.dim', null, 'no joints broken'));
    for (const o of bridge.log.slice(-6).reverse()) {
        log.appendChild(h('div', null, `#${o.handle} `, h('b', null, o.kind), ` ${o.index}`));
    }

    $('#stContacts').textContent = String(cstate.lastCount);
    meter.set(cstate.peakImpulse / 600);
    $('#impactVal').textContent = cstate.peakImpulse.toFixed(0) + ' N·s';
    const list = clear($('#contactList'));
    if (!recent.length) list.appendChild(h('div.dim', null, 'no contacts yet — drop something'));
    for (const c of recent.slice(0, 6)) {
        const n = c.normal ? `${c.normal.x.toFixed(2)},${c.normal.y.toFixed(2)},${c.normal.z.toFixed(2)}` : '—';
        // Negative penetration is a SPECULATIVE contact; labelling it beats a
        // negative depth that reads like a bug.
        const pen = c.penetration < 0 ? h('i', null, `spec ${(c.penetration * 1000).toFixed(1)}mm`)
                                      : `${(c.penetration * 1000).toFixed(1)}mm`;
        list.appendChild(h(c.focused ? 'div.crow.hot' : 'div.crow', null,
            h('span', null, `#${c.body1}·#${c.body2}`), h('span', null, `${c.n}pt`), h('span', null, pen),
            h('span.imp', null, c.impulse.toFixed(0)), h('span.nrm', null, 'n ' + n)));
    }
}
