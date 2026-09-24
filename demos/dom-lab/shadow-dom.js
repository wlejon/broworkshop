// Shadow DOM: <card-box> keeps its styles inside an open shadow root and
// projects light-DOM children through two named slots. Its theme attribute
// re-renders the shadow tree without touching the slotted content.

import { $ } from "/lib/kit/dom.js";

const THEMES = {
    ocean:  { bg: 'linear-gradient(135deg, #0b2545 0%, #134074 100%)', accent: '#8da9c4' },
    sunset: { bg: 'linear-gradient(135deg, #592941 0%, #9e2a2b 100%)', accent: '#ff9f1c' },
};

let inspect = null;    // (card) -> void

class CardBox extends HTMLElement {
    static get observedAttributes() { return ['theme']; }

    constructor() {
        super();
        this.attachShadow({ mode: 'open' });
        this._theme = this.getAttribute('theme') || 'ocean';
        this.render();
    }

    connectedCallback() { if (inspect) inspect(this); }

    attributeChangedCallback(name, oldVal, newVal) {
        if (name !== 'theme' || oldVal === newVal) return;
        this._theme = newVal || 'ocean';
        this.render();
        if (inspect) inspect(this);
    }

    render() {
        const t = THEMES[this._theme] || THEMES.ocean;
        this.shadowRoot.innerHTML = `
            <style>
                :host { display: block; border-radius: 8px; overflow: hidden;
                        border: 1px solid rgba(255,255,255,0.1); box-shadow: 0 4px 16px rgba(0,0,0,0.3); }
                .card-wrap { background: ${t.bg}; padding: 16px; color: #fff; }
                .title-slot { display: block; font-size: 14px; font-weight: 700; color: ${t.accent}; margin-bottom: 8px; }
                .body-slot { font-size: 12px; line-height: 1.5; color: #e0e6ed; }
            </style>
            <div class="card-wrap">
                <div class="title-slot"><slot name="title">Default Title</slot></div>
                <div class="body-slot"><slot name="body">Default body content goes here.</slot></div>
            </div>`;
    }
}

/** Define <card-box> (once); `onInspect(card)` runs on connect and on theme change. */
export function registerCardBox(onInspect) {
    inspect = onInspect;
    if (!customElements.get('card-box')) customElements.define('card-box', CardBox);
    return CardBox;
}

/** What the inspector shows for one host. */
export function describeCard(card) {
    const title = card.querySelector('[slot="title"]');
    const slots = card.shadowRoot ? card.shadowRoot.querySelectorAll('slot').length : 0;
    return '<card-box>\n' +
        '  theme attribute   "' + card.getAttribute('theme') + '"\n' +
        '  shadowRoot.mode   ' + (card.shadowRoot ? card.shadowRoot.mode : 'closed') + '\n' +
        '  shadow slots      ' + slots + '\n' +
        '  slotted title     "' + (title ? title.textContent : '') + '"\n';
}

export function initShadowDom() {
    const cards = $('#cards');
    const out = $('#shadow-inspect');
    const refresh = () => {
        out.textContent = Array.from(cards.querySelectorAll('card-box')).map(describeCard).join('\n');
    };
    registerCardBox(refresh);
    refresh();

    $('#toggle-themes').addEventListener('click', () => {
        for (const c of cards.querySelectorAll('card-box')) {
            c.setAttribute('theme', c.getAttribute('theme') === 'ocean' ? 'sunset' : 'ocean');
        }
    });
    $('#update-slot').addEventListener('click', () => {
        const body = cards.querySelector('card-box [slot="body"]');
        if (body) body.textContent = 'Updated slotted text at ' + new Date().toLocaleTimeString();
        refresh();
    });
}
