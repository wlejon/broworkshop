// slider.js — custom slider widget (std lib)
//
// A drag/wheel/type slider with fine-tuning, replacing <input type="range">.
// Pure UI, no app coupling. Depends on ./dom.js (and, when you pass a `signal`
// option, ./signal.js) so the whole std/ folder moves as a unit.
//
//   const s = slider(container, { min, max, value, step, onChange });
//   s.setValue(50);  s.getValue();
//
// Or bind it to a signal for two-way sync:
//   const freq = signal(440);
//   slider(container, { min: 20, max: 20000, signal: freq });
//
// Interactions:
//   Drag           — adjust value         Shift+drag    — fine mode (fineScale)
//   Mouse wheel    — increment (shift=fine) Right-click  — reset to default
//   Dbl-click value— type an exact number

import { el, on } from "/std/dom.js";
import { effect } from "/std/signal.js";

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

export function slider(container, opts = {}) {
    const min = opts.min !== undefined ? opts.min : 0;
    const max = opts.max !== undefined ? opts.max : 100;
    const step = opts.step || 1;
    const fineScale = opts.fineScale !== undefined ? opts.fineScale : 0.1;
    const format = opts.format || ((v) => String(v));
    const sig = opts.signal || null;
    const defaultValue =
        opts.defaultValue !== undefined ? opts.defaultValue
        : sig ? sig.peek()
        : min;

    let color = opts.color || "#00e5ff";
    let value = clamp(
        opts.value !== undefined ? opts.value : sig ? sig.peek() : defaultValue,
        min, max);

    // Build DOM: [track-area [track, fill, thumb]] [value]
    container.classList.add("fancy-slider");
    const track = el("div", { class: "fs-track" });
    const fill = el("div", { class: "fs-fill", style: { background: color } });
    const thumb = el("div", { class: "fs-thumb", style: { background: color } });
    const trackArea = el("div", { class: "fs-track-area" }, track, fill, thumb);
    const valEl = el("div", { class: "fs-value" });
    container.appendChild(trackArea);
    container.appendChild(valEl);

    const pct = () => (max > min ? (value - min) / (max - min) : 0);

    function render() {
        let trackW = trackArea.getBoundingClientRect().width;
        if (trackW <= 0) trackW = 80; // fallback before layout
        const px = Math.round(pct() * trackW);
        fill.style.width = px + "px";
        thumb.style.left = px + "px";
        valEl.textContent = format(value);
    }

    // Internal setter. `fromSignal` avoids a write-back loop when the change
    // originated from the bound signal's effect.
    function setVal(v, { silent = false, fromSignal = false } = {}) {
        v = Math.round(v / step) * step;
        v = clamp(v, min, max);
        v = Math.round(v * 1e6) / 1e6;
        if (v === value) return;
        value = v;
        render();
        if (!silent && opts.onChange) opts.onChange(value);
        if (!fromSignal && sig) sig.set(value);
    }

    // --- Drag ---
    let dragging = false, dragStartX = 0, dragStartVal = 0, fine = false;

    const posToValue = (clientX) => {
        const rect = trackArea.getBoundingClientRect();
        const p = clamp((clientX - rect.left) / rect.width, 0, 1);
        return min + p * (max - min);
    };

    on(trackArea, "mousedown", (e) => {
        if (e.button === 2) return;
        e.preventDefault();
        dragging = true;
        fine = e.shiftKey;
        dragStartX = e.clientX;
        dragStartVal = value;
        if (!fine) {
            setVal(posToValue(e.clientX));
            dragStartVal = value;
            dragStartX = e.clientX;
        }
        container.classList.add("dragging");
        if (fine) container.classList.add("fine");
    });

    on(document, "mousemove", (e) => {
        if (!dragging) return;
        fine = e.shiftKey;
        container.classList.toggle("fine", fine);
        if (fine) {
            const dx = e.clientX - dragStartX;
            const rect = trackArea.getBoundingClientRect();
            const delta = (dx / rect.width) * (max - min) * fineScale;
            setVal(dragStartVal + delta);
        } else {
            setVal(posToValue(e.clientX));
        }
    });

    on(document, "mouseup", () => {
        if (!dragging) return;
        dragging = false;
        container.classList.remove("dragging");
        container.classList.remove("fine");
    });

    on(container, "contextmenu", (e) => { e.preventDefault(); setVal(defaultValue); });

    on(container, "wheel", (e) => {
        e.preventDefault();
        const mult = e.shiftKey ? fineScale : 1;
        setVal(value + (e.deltaY < 0 ? step * mult : -step * mult));
    });

    // --- Type an exact value ---
    on(valEl, "dblclick", (e) => { e.stopPropagation(); startTextEdit(); });

    function startTextEdit() {
        const input = el("input", { type: "text", class: "fs-input", value: String(value) });
        valEl.textContent = "";
        valEl.appendChild(input);
        input.focus();
        input.select();
        const commit = () => {
            const parsed = parseFloat(input.value);
            if (!isNaN(parsed)) setVal(parsed);
            if (valEl.contains(input)) valEl.removeChild(input);
            valEl.textContent = format(value);
        };
        on(input, "keydown", (e) => {
            if (e.key === "Enter") { e.preventDefault(); commit(); }
            if (e.key === "Escape") {
                if (valEl.contains(input)) valEl.removeChild(input);
                valEl.textContent = format(value);
            }
            e.stopPropagation();
        });
        on(input, "blur", commit);
    }

    // Two-way binding: when the signal changes elsewhere, reflect it here.
    if (sig) effect(() => setVal(sig(), { silent: true, fromSignal: true }));

    render();

    return {
        setValue: (v, silent) => setVal(v, { silent }),
        getValue: () => value,
        setColor: (c) => { color = c; fill.style.background = c; thumb.style.background = c; },
        render,
        el: container,
    };
}
