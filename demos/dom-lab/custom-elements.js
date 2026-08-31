// demos/dom-lab/custom-elements.js

export function registerCustomElements(onLifecycle) {
    class StatMeter extends HTMLElement {
        static get observedAttributes() {
            return ['value', 'label', 'unit'];
        }

        constructor() {
            super();
            this._label = 'Stat';
            this._value = '0';
            this._unit = '';
        }

        connectedCallback() {
            this.render();
            if (onLifecycle) {
                onLifecycle('connectedCallback', this.tagName.toLowerCase(), {
                    label: this._label,
                    value: this._value
                });
            }
        }

        disconnectedCallback() {
            if (onLifecycle) {
                onLifecycle('disconnectedCallback', this.tagName.toLowerCase(), {
                    label: this._label
                });
            }
        }

        attributeChangedCallback(name, oldValue, newValue) {
            if (oldValue === newValue) return;

            if (name === 'label') this._label = newValue || 'Stat';
            if (name === 'value') this._value = newValue || '0';
            if (name === 'unit') this._unit = newValue || '';

            this.render();

            if (onLifecycle) {
                onLifecycle('attributeChangedCallback', this.tagName.toLowerCase(), {
                    attr: name,
                    oldVal: oldValue,
                    newVal: newValue
                });
            }
        }

        render() {
            this.innerHTML = `
                <span class="meter-label">${this._label}</span>
                <span class="meter-val">${this._value}${this._unit}</span>
            `;
        }
    }

    if (typeof customElements !== 'undefined' && !customElements.get('stat-meter')) {
        customElements.define('stat-meter', StatMeter);
    }
}
