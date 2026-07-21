// ═══ small helpers — dom · fs · ui factories · field drawing ═════════════════
import { status } from "/app/lib/core.js";

export const _fs = (() => { try { return require('fs'); } catch (e) { return null; } })();
export const _os = (() => { try { return require('os'); } catch (e) { return null; } })();

export function el(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
}

export function pExists(p) { try { return _fs && _fs.existsSync(p); } catch (e) { return false; } }
export function pParent(p) { return p.replace(/[\\\/]+$/, '').replace(/[\\\/][^\\\/]*$/, ''); }
export function pName(p)   { return p.replace(/[\\\/]+$/, '').replace(/^.*[\\\/]/, ''); }

// localStorage / native dialogs, defensively (both absent in some headless builds).
export function remember(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }
export function recall(k)      { try { return localStorage.getItem(k) || ''; } catch (e) { return ''; } }
export function browseFolder(start) {
    if (typeof showOpenFolderDialog !== 'function') { status('folder dialog unavailable', true); return null; }
    const r = showOpenFolderDialog(start || null);
    return r && r.length ? r[0] : null;
}

// ─── control factories ────────────────────────────────────────────────────────
// Compact labelled controls that append to a container and return the input, so a
// probe wires a change handler and reads .value. `fmt` renders the live readout.
export function mkRange(host, label, val, min, max, step, onInput, fmt) {
    const wrap = el('label', 'ctl');
    wrap.appendChild(el('span', 'ctl-lbl', label));
    const input = document.createElement('input');
    input.type = 'range'; input.min = min; input.max = max; input.step = step; input.value = val;
    const out = el('span', 'ctl-val', fmt ? fmt(val) : String(val));
    input.addEventListener('input', () => {
        const v = parseFloat(input.value);
        if (out) out.textContent = fmt ? fmt(v) : String(v);
        onInput(v);
    });
    wrap.appendChild(input); wrap.appendChild(out);
    host.appendChild(wrap);
    return input;
}
export function mkNumber(host, label, val, step, onChange) {
    const wrap = el('label', 'ctl');
    wrap.appendChild(el('span', 'ctl-lbl', label));
    const input = document.createElement('input');
    input.type = 'number'; input.value = val; input.step = step || 1;
    input.addEventListener('change', () => onChange(parseFloat(input.value)));
    wrap.appendChild(input);
    host.appendChild(wrap);
    return input;
}
export function mkSelect(host, label, options, val, onChange) {
    const wrap = el('label', 'ctl');
    if (label) wrap.appendChild(el('span', 'ctl-lbl', label));
    const sel = document.createElement('select');
    for (const o of options) {
        const opt = document.createElement('option');
        opt.value = o; opt.textContent = o; sel.appendChild(opt);
    }
    sel.value = val;
    sel.addEventListener('change', () => onChange(sel.value));
    wrap.appendChild(sel);
    host.appendChild(wrap);
    return sel;
}
export function mkButton(host, label, onClick, title) {
    const b = el('button', 'btn', label);
    if (title) b.title = title;
    b.addEventListener('click', onClick);
    host.appendChild(b);
    return b;
}

// ─── field drawing ────────────────────────────────────────────────────────────
// One channel out of a planar stage buffer (channel c of an h×w tile lives at
// data[(c·h + z)·w + x]).
export function plane(res, ch) {
    const n = res.width * res.height;
    return res.data.subarray(ch * n, (ch + 1) * n);
}

// Draw a Float32 field to a canvas through the GPU colormap path (one draw, no
// CPU buffer). autoRange scales to the field's own min/max, which matters because
// these channels span metres, °C, mm/yr and a standardised residual all at once.
export function drawField(canvas, field, srcW, srcH, lut, opts) {
    bro.image.gpu.colormap(canvas, field, lut, {
        srcW, srcH, autoRange: true, ...(opts || {}),
    });
}

// Size a canvas's DISPLAY box (inline CSS) to the largest rectangle preserving
// srcW:srcH that fits its parent, so a square field in a wide card letterboxes
// instead of stretching. The parent must be `.canvas-wrap.fit` (flex-centred).
// Returns { dw, dh } so a GPU-colormap caller can match its backing store 1:1;
// a putImageData caller keeps its native backing store and only scales on display.
export function fitContain(canvas, srcW, srcH) {
    const wrap = canvas.parentElement; if (!wrap) return null;
    const cw = wrap.clientWidth | 0, ch = wrap.clientHeight | 0;
    if (cw < 4 || ch < 4) return null;
    const ar = srcW / srcH;
    let dw = cw, dh = Math.round(cw / ar);
    if (dh > ch) { dh = ch; dw = Math.round(ch * ar); }
    canvas.style.width = dw + 'px'; canvas.style.height = dh + 'px';
    return { dw, dh };
}

// Min/max/mean of a field, on the CPU — used for the numeric readouts that an
// auto-ranged colour alone cannot give ("is this 3 km of relief or 3 cm?").
export function fieldStats(field) {
    let lo = Infinity, hi = -Infinity, sum = 0;
    for (let i = 0; i < field.length; i++) {
        const v = field[i];
        if (v < lo) lo = v; if (v > hi) hi = v; sum += v;
    }
    return { lo, hi, mean: sum / (field.length || 1) };
}

// A titled card holding one canvas, appended to `host`. Returns { wrap, canvas, note }.
export function mkCard(host, title, w, h) {
    const wrap = el('div', 'card');
    wrap.appendChild(el('div', 'card-title', title));
    const cwrap = el('div', 'canvas-wrap');
    const canvas = document.createElement('canvas');
    canvas.width = w; canvas.height = h;
    cwrap.appendChild(canvas);
    wrap.appendChild(cwrap);
    const note = el('div', 'card-note');
    wrap.appendChild(note);
    host.appendChild(wrap);
    return { wrap, canvas, note };
}
