// demos/dom-lab/shadow-dom.js

export function registerShadowComponents(onInspect) {
    class CardBox extends HTMLElement {
        static get observedAttributes() {
            return ['theme'];
        }

        constructor() {
            super();
            this._shadow = this.attachShadow({ mode: 'open' });
            this._theme = this.getAttribute('theme') || 'ocean';
            this.render();
        }

        attributeChangedCallback(name, oldVal, newVal) {
            if (name === 'theme' && oldVal !== newVal) {
                this._theme = newVal || 'ocean';
                this.render();
                if (onInspect) onInspect(this);
            }
        }

        connectedCallback() {
            if (onInspect) onInspect(this);
        }

        render() {
            const isOcean = this._theme === 'ocean';
            const bgGrad = isOcean
                ? 'linear-gradient(135deg, #0b2545 0%, #134074 100%)'
                : 'linear-gradient(135deg, #592941 0%, #9e2a2b 100%)';
            const accent = isOcean ? '#8da9c4' : '#ff9f1c';

            this._shadow.innerHTML = `
                <style>
                    :host {
                        display: block;
                        border-radius: 8px;
                        overflow: hidden;
                        box-shadow: 0 4px 16px rgba(0,0,0,0.3);
                        font-family: inherit;
                        border: 1px solid rgba(255,255,255,0.1);
                    }
                    .card-wrap {
                        background: ${bgGrad};
                        padding: 16px;
                        color: #fff;
                    }
                    .title-slot {
                        font-size: 14px;
                        font-weight: 700;
                        color: ${accent};
                        margin-bottom: 8px;
                        display: block;
                    }
                    .body-slot {
                        font-size: 12px;
                        line-height: 1.5;
                        color: #e0e6ed;
                    }
                </style>
                <div class="card-wrap">
                    <div class="title-slot">
                        <slot name="title">Default Title</slot>
                    </div>
                    <div class="body-slot">
                        <slot name="body">Default body content goes here.</slot>
                    </div>
                </div>
            `;
        }
    }

    if (typeof customElements !== 'undefined' && !customElements.get('card-box')) {
        customElements.define('card-box', CardBox);
    }
}
