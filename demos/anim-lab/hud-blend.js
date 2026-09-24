// hud-blend.js — the Blend and Layers tabs: base-track spaces, the 1D speed
// axis, the 2D direction pad, the live mix bars and the three masked layer
// rows. Controls call actions.js; the mix bars read the ENGINE (blendState),
// because during a fade what was asked for and what drives the bones differ.

import { $, h, clear, segmented, bindControl } from "/lib/kit/index.js";
import { player, masks } from "/app/lab.js";
import { state, LAYER_ROWS, onSync, selectSpace, setSpeedAxis, setDirection,
         setLayerEnabled, setLayerWeight, setLayerMask, setLayerClip } from "/app/actions.js";

// The nine pad presets: dragging is the fun way in, but exact corners are the
// way to SEE a three-way mix — and something a test can drive exactly.
const PAD_PRESETS = [
    ['↖', -0.7,  0.7], ['↑',  0,  1], ['↗',  0.7,  0.7],
    ['←',  -1,   0  ], ['•',  0,  0], ['→',  1,    0  ],
    ['↙', -0.7, -0.7], ['↓',  0, -1], ['↘',  0.7, -0.7],
];
const SPACES = [['locomotion', '1D speed'], ['directional', '2D direction'], ['locomotionCrouch', '1D crouch']];

const clampAxis = (v) => (v < -1 ? -1 : (v > 1 ? 1 : v));
const options = (names, sel) => names.map((n) => h('option', { value: n, selected: n === sel }, n));

let spaceSeg = null, axis = null;
const layerUi = new Map();

export function bindBlendHud() {
    // Each button is play(space) — the same call a clip button makes.
    spaceSeg = segmented('#spaceRow', SPACES, { value: '', onChange: (s) => selectSpace(s) });
    for (const b of spaceSeg.buttons) b.dataset.space = b.dataset.value;

    axis = bindControl('#speedAxis', {
        out: '#speedAxisV', fmt: (v) => v.toFixed(2) + ' m/s', onChange: (v) => setSpeedAxis(v),
    });

    // Pointer events with capture, so the drag survives leaving the pad.
    const pad = $('#pad');
    let dragging = false;
    const dragTo = (ev) => {
        const r = pad.getBoundingClientRect();
        const x = ((ev.clientX - r.left) / r.width) * 2 - 1;
        const y = 1 - ((ev.clientY - r.top) / r.height) * 2;     // screen y grows down
        setDirection(clampAxis(x), clampAxis(y));
    };
    pad.addEventListener('pointerdown', (ev) => {
        pad.setPointerCapture(ev.pointerId);
        dragging = true;
        dragTo(ev);
        ev.preventDefault();
    });
    pad.addEventListener('pointermove', (ev) => { if (dragging) dragTo(ev); });
    pad.addEventListener('pointerup', (ev) => { dragging = false; pad.releasePointerCapture(ev.pointerId); });

    const presets = $('#padPresets');
    for (const [label, x, y] of PAD_PRESETS) {
        presets.appendChild(h('button.small', { title: `${x}, ${y}`, onclick: () => setDirection(x, y) }, label));
    }

    buildLayerRows();
    onSync(syncBlend);
    syncBlend('axis');
    syncBlend('base');
}

function buildLayerRows() {
    const host = $('#layerRows');
    for (const row of LAYER_ROWS) {
        const cb = h('input', { type: 'checkbox', onchange: () => setLayerEnabled(row.slot, cb.checked) });
        const clipSel = h('select', { onchange: () => setLayerClip(row.slot, clipSel.value) },
            options(player.names, row.clip));
        const maskSel = h('select', { onchange: () => setLayerMask(row.slot, maskSel.value) },
            options(masks.names, row.mask));
        const weight = h('input', { type: 'range', min: '0', max: '1', step: '0.01', value: String(row.weight),
            oninput: () => setLayerWeight(row.slot, parseFloat(weight.value)) });
        const weightV = h('span.k-val');
        const bones = h('div.bones');
        const el = h('div.layer', { dataset: { slot: String(row.slot) } },
            h('label.layerHead', null, cb, ` slot ${row.slot} `, clipSel),
            h('label.k-field', null, h('span', null, 'mask'), maskSel),
            h('label.k-field', null, h('span', null, 'weight'), weight, weightV),
            bones);
        host.appendChild(el);
        layerUi.set(row.slot, { cb, clipSel, maskSel, weight, weightV, bones, el });
    }
    syncLayers();
}

function syncLayers() {
    for (const row of LAYER_ROWS) {
        const ui = layerUi.get(row.slot);
        if (!ui) continue;
        ui.cb.checked = row.enabled;
        ui.clipSel.value = row.clip;
        ui.maskSel.value = row.mask;
        ui.weight.value = String(row.weight);
        ui.weightV.textContent = row.weight.toFixed(2);
        ui.el.classList.toggle('on', row.enabled);
        // A mask is abstract until the list visibly shrinks from twenty names to three.
        const list = masks.bones(row.mask);
        ui.bones.textContent = `${list.length} bones · ` +
            (list.length > 6 ? list.slice(0, 5).join(' ') + ' …' : list.join(' '));
    }
}

function syncBlend(what) {
    if (what === 'base') {
        spaceSeg.value = SPACES.some(([s]) => s === state.base) ? state.base : '';
    } else if (what === 'axis') {
        axis.value = state.speedAxis;
        const dot = $('#padDot');
        dot.style.left = `${(state.dirX + 1) * 50}%`;
        dot.style.top = `${(1 - state.dirY) * 50}%`;
        $('#dirV').textContent = `${state.dirX.toFixed(2)}, ${state.dirY.toFixed(2)}`;
    } else if (what === 'layers') {
        syncLayers();
    }
}

/**
 * The base composition as weight bars, plus the live layers: blendState()
 * rendered literally. Rows are rebuilt only when the SET of clips changes;
 * otherwise only the bars move.
 */
export function renderBlendMix() {
    const bs = player.blendState();
    const host = $('#baseMix');
    const rows = bs.clips || [];
    const key = rows.map((c) => c.name).join('|');
    if (host.dataset.key !== key) {
        clear(host);
        host.dataset.key = key;
        for (const c of rows) {
            host.appendChild(h('div.mix', null,
                h('span.mixName', null, c.name),
                h('div.mixTrack', null, h('div.mixFill')),
                h('span.mixVal')));
        }
    }
    rows.forEach((c, i) => {
        const line = host.children[i];
        if (!line) return;
        line.querySelector('.mixFill').style.width = `${Math.round(c.weight * 100)}%`;
        line.querySelector('.mixVal').textContent = c.weight.toFixed(2);
    });

    const sum = rows.reduce((a, c) => a + c.weight, 0);
    $('#mixSum').textContent = rows.length
        ? `${rows.length} clip${rows.length === 1 ? '' : 's'} · Σ ${sum.toFixed(2)}`
        : 'base track idle';
    // pos is [] (not absent) when no space is on the base track.
    const pos = bs.pos || [];
    $('#mixPhase').textContent = pos.length
        ? `pos [${pos.map((v) => v.toFixed(2)).join(', ')}] · phase ${(bs.phase || 0).toFixed(2)}`
        : `phase ${(bs.phase || 0).toFixed(2)}`;

    const live = bs.layers || [];
    $('#layerSlots').textContent = `${live.length}/${LAYER_ROWS.length}`;
    $('#layerCount').textContent = live.length
        ? `${live.length} live: ` + live.map((l) => `${l.slot}:${l.name} ${l.weight.toFixed(2)}`).join(' · ')
        : 'no layers — base track only';
}
