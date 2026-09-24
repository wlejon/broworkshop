// Custom Elements: a <stat-meter> autonomous element that renders itself from
// three observed attributes, and reports every lifecycle callback.
//
// The meters already in index.html are upgraded when define() runs, so the
// stream starts with their attributeChangedCallback + connectedCallback.

import { $ } from "/lib/kit/dom.js";

let report = null;     // (event, tag, data) -> void; set before define()

class StatMeter extends HTMLElement {
    static get observedAttributes() { return ['value', 'label', 'unit']; }

    constructor() {
        super();
        this._label = 'Stat';
        this._value = '0';
        this._unit = '';
    }

    connectedCallback() {
        this.render();
        if (report) report('connectedCallback', { label: this._label, value: this._value });
    }

    disconnectedCallback() {
        if (report) report('disconnectedCallback', { label: this._label });
    }

    attributeChangedCallback(name, oldValue, newValue) {
        if (oldValue === newValue) return;
        if (name === 'label') this._label = newValue || 'Stat';
        if (name === 'value') this._value = newValue || '0';
        if (name === 'unit') this._unit = newValue || '';
        this.render();
        if (report) report('attributeChangedCallback', { attr: name, oldVal: oldValue, newVal: newValue });
    }

    render() {
        // textContent, not innerHTML: attribute values are data, not markup.
        if (!this._labelEl) {
            this.textContent = '';
            this._labelEl = document.createElement('span');
            this._labelEl.className = 'meter-label';
            this._valEl = document.createElement('span');
            this._valEl.className = 'meter-val';
            this.append(this._labelEl, this._valEl);
        }
        this._labelEl.textContent = this._label;
        this._valEl.textContent = this._value + this._unit;
    }
}

/** Define <stat-meter> (once); `onLifecycle(event, tag, data)` sees every callback. */
export function registerStatMeter(onLifecycle) {
    report = (event, data) => onLifecycle(event, 'stat-meter', data);
    if (!customElements.get('stat-meter')) customElements.define('stat-meter', StatMeter);
    return StatMeter;
}

const rand = () => String(Math.floor(Math.random() * 100));

export function initCustomElements(log) {
    registerStatMeter((event, tag, data) => log.add('<' + tag + '> ' + event + ' ' + JSON.stringify(data)));
    const meters = $('#meters');

    $('#add-meter').addEventListener('click', () => {
        const el = document.createElement('stat-meter');
        el.setAttribute('label', 'Dynamic Metric');
        el.setAttribute('value', rand());
        el.setAttribute('unit', 'pt');
        meters.appendChild(el);
    });
    $('#randomize-meters').addEventListener('click', () => {
        for (const m of meters.querySelectorAll('stat-meter')) m.setAttribute('value', rand());
    });
    $('#remove-meter').addEventListener('click', () => {
        const last = meters.lastElementChild;
        if (last) last.remove();
    });
}
