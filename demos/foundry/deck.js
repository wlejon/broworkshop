// demos/foundry/deck.js — the operator's deck for a machine (operate.js).
//
// The deck is compiled from the machine, not laid out by hand: one control
// per independent drive, each the widget its motion wants (a dial for a
// turntable, a lever for a joint that lifts, a throttle for a shaft that
// runs, a slider for a rod), placed in a tree shaped like the machine. A
// control sits under the control whose joint carries its joint, and controls
// carried by the same one stand side by side, so a crane's deck is a dial
// over a lever and a two-armed rig's deck branches in two. A drive with no
// power reaching it is shown, greyed, with the reason, and takes no command.
//
// Levers and dials spring back to stop when let go (hold to move), as a
// joystick does; throttles and sliders stay where they are set. Each control
// answers to its keys: hold the first to raise (or turn on), the second to
// lower (or turn back).

import { h, clear } from "/lib/kit/dom.js";

const STATUS = {
    still: ['still', ''], moving: ['moving', 'ok'], holding: ['holding', ''], locked: ['locked off', ''],
    straining: ['straining', 'warn'], stalled: ['stalled: too heavy', 'bad'], falling: ['slipping back', 'bad'],
    overloaded: ['its boom is overloaded', 'bad'], 'at its stop': ['at its stop', 'warn'], broken: ['broken: its boom gave way', 'bad'], 'at its limit': ['at its load limit', 'warn'],
};

/** Build the deck for machine `m` into `el`; `onSet(controlId, u)` takes each command. */
export function renderDeck(el, m, onSet) {
    clear(el);
    if (!m || !m.controls.length) {
        el.append(h('div', { class: 'f-dk-empty' }, 'Nothing here to run: this design gives out no drive an operator can work. Open a machine with a joint or a powered output.'));
        return;
    }
    const block = (node) => {
        const col = h('div', { class: 'f-dk-col' }, widget(node.control, m, onSet));
        if (node.kids.length) {
            const kids = node.kids.length > 1 ? h('div', { class: 'f-dk-row f-dk-branch' }, ...node.kids.map(block)) : block(node.kids[0]);
            col.append(h('div', { class: 'f-dk-carried' }, kids));
        }
        return col;
    };
    el.append(h('div', { class: 'f-dk-row' }, ...m.layout.kids.map(block)));
}

function widget(ct, m, onSet) {
    const kind = ct.kind;
    const keys = ct.keys ? h('span', { class: 'f-dk-keys' }, `${ct.keys[0].toUpperCase()} / ${ct.keys[1].toUpperCase()}`) : null;
    const head = h('div', { class: 'f-dk-head' }, h('span', { class: 'f-dk-name' }, ct.label), keys);
    const track = h('div', { class: `f-dk-track f-dk-${kind}` }, h('i', { class: 'knob' }));
    if (kind === 'dial') track.append(h('i', { class: 'needle' }));
    const box = h('div', { class: 'f-dk-ctl' + (ct.dark ? ' dark' : ''), 'data-ctl': ct.id, 'data-kind': kind, title: `${ct.label}: ${ct.why}${ct.lines.length ? ` (${ct.lines.join(', ')})` : ''}` },
        head, track,
        h('div', { class: 'f-dk-read' }, h('span', { class: 'st' }), h('span', { class: 'val' })),
        h('div', { class: 'f-dk-bar' }, h('i', {})));
    if (ct.dark) { box.querySelector('.st').textContent = ct.why; return box; }
    // Drag on the track: a lever or dial springs back on release, a throttle stays.
    const spring = kind === 'lever' || kind === 'dial';
    const uAt = (ev) => {
        const r = track.getBoundingClientRect();
        if (kind === 'lever') return Math.max(-1, Math.min(1, ((r.top + r.height / 2) - ev.clientY) / (r.height / 2)));
        return Math.max(-1, Math.min(1, (ev.clientX - (r.left + r.width / 2)) / (r.width / 2)));
    };
    let dragging = false;
    track.addEventListener('pointerdown', (ev) => { dragging = true; if (track.setPointerCapture) try { track.setPointerCapture(ev.pointerId); } catch (e) { /* none */ } onSet(ct.id, uAt(ev)); ev.preventDefault(); });
    track.addEventListener('pointermove', (ev) => { if (dragging) onSet(ct.id, uAt(ev)); });
    const up = () => { if (!dragging) return; dragging = false; if (spring) onSet(ct.id, 0); };
    track.addEventListener('pointerup', up);
    track.addEventListener('pointercancel', up);
    track.addEventListener('dblclick', () => onSet(ct.id, 0));
    return box;
}

const DEG = 180 / Math.PI;

/** Bring the deck's knobs, needles and readouts up to the machine's state. */
export function updateDeck(el, m) {
    if (!m) return;
    for (const ct of m.controls) {
        const box = el.querySelector(`[data-ctl="${ct.id}"]`);
        if (!box || ct.dark) continue;
        const knob = box.querySelector('.knob'), kind = ct.kind;
        if (kind === 'lever') knob.style.top = `${(50 - ct.u * 42).toFixed(1)}%`;
        else knob.style.left = `${(50 + ct.u * 42).toFixed(1)}%`;
        const st = box.querySelector('.st'), val = box.querySelector('.val'), bar = box.querySelector('.f-dk-bar i');
        if (ct.joints.length) {
            // The worst of its joints says how it is going.
            const order = ['broken', 'at its limit', 'stalled', 'falling', 'straining', 'at its stop', 'moving', 'holding', 'locked', 'still'];
            const s = ct.joints.map((j) => m.status[j]).sort((a, b) => order.indexOf(a) - order.indexOf(b))[0];
            const [text, cls] = STATUS[s] || [s, ''];
            st.textContent = text; st.className = 'st ' + cls;
            const j = ct.joints[0], a = m.angles[j] * DEG;
            val.textContent = kind === 'dial' ? `${(((a % 360) + 540) % 360 - 180).toFixed(0)}°` : `${(a * m.joints[j].raise).toFixed(0)}°`;
            if (kind === 'dial') box.querySelector('.needle').style.transform = `rotate(${a.toFixed(1)}deg)`;
            const J = m.joints[j], load = Math.abs(m.torque[j]) / Math.max(1e-9, J.limit || J.cont || 1);
            bar.style.width = `${Math.min(100, load * 100).toFixed(1)}%`;
            bar.className = load > 1 ? 'bad' : load > 0.85 ? 'warn' : '';
        } else {
            st.textContent = ct.u === 0 ? 'stopped' : ct.u > 0 ? 'running' : 'reversed';
            st.className = 'st ' + (ct.u ? 'ok' : '');
            val.textContent = `${Math.round(ct.u * 100)}%`;
            bar.style.width = `${Math.abs(ct.u) * 100}%`;
            bar.className = '';
        }
    }
}
