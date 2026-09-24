// DOM & Web Standards Lab — drive each tab through its buttons and assert on
// the DOM the platform API produced. Run: scripts/validate.sh demos/dom-lab
import { check, eq, frames, test, done, q, text, clickOn, setValue, shot } from "/lib/kit/test.js";
import { ui } from "/app/lab.js";
import { describeCard } from "/app/shadow-dom.js";
import { mutationState } from "/app/mutations.js";
import { rangeState, diagnose } from "/app/range-selection.js";
import { animState, telemetry } from "/app/web-animations.js";

frames(6);

const meters = () => q('#meters').querySelectorAll('stat-meter');
const logText = (sel) => q(sel).textContent;

test('boot: tabs, one visible pane', () => {
    eq(ui.tabs.current, 'custom-elements');
    const shown = Array.from(document.querySelectorAll('[data-pane]')).filter((p) => !p.hidden);
    eq(shown.map((p) => p.dataset.pane), ['custom-elements']);
});

test('custom elements: upgraded meters rendered + lifecycle logged', () => {
    eq(meters().length, 3);
    eq(meters()[0].querySelector('.meter-val').textContent, '45%');
    check(meters()[0] instanceof customElements.get('stat-meter'), 'upgraded instance');
    check(/connectedCallback/.test(logText('#lifecycle-log')), 'connectedCallback logged');
});

test('custom elements: add, randomize, remove', () => {
    clickOn('#add-meter');
    eq(meters().length, 4);
    const added = meters()[3];
    eq(added.querySelector('.meter-label').textContent, 'Dynamic Metric');
    check(/pt$/.test(added.querySelector('.meter-val').textContent), 'unit rendered');
    const before = ui.lifecycleLog.count;
    clickOn('#randomize-meters');
    check(ui.lifecycleLog.count >= before, 'randomize logs (or values repeated)');
    for (const m of meters()) check(m.querySelector('.meter-val').textContent === m.getAttribute('value') + (m.getAttribute('unit') || ''), 'meter shows its attribute');
    clickOn('#remove-meter');
    eq(meters().length, 3);
    check(/disconnectedCallback/.test(logText('#lifecycle-log')), 'disconnectedCallback logged');
});

test('shadow DOM: open roots, slots, theme toggle re-renders shadow only', () => {
    clickOn('[data-tab=shadow-dom]');
    const cards = q('#cards').querySelectorAll('card-box');
    eq(cards.length, 2);
    eq(cards[0].shadowRoot.mode, 'open');
    eq(cards[0].shadowRoot.querySelectorAll('slot').length, 2);
    check(cards[0].querySelector('.card-wrap') === null, 'shadow content is not in the light DOM');
    check(/theme attribute {3}"ocean"/.test(text('#shadow-inspect')), 'inspector shows ocean');
    clickOn('#toggle-themes');
    eq(cards[0].getAttribute('theme'), 'sunset');
    eq(cards[1].getAttribute('theme'), 'ocean');
    check(/"sunset"/.test(describeCard(cards[0])), 'describe follows the attribute');
    check(/theme attribute {3}"sunset"/.test(text('#shadow-inspect')), 'inspector updated');
    clickOn('#update-slot');
    check(/^Updated slotted text/.test(cards[0].querySelector('[slot=body]').textContent), 'slotted body replaced');
});

test('mutation observer: childList, attributes, characterData records', () => {
    clickOn('[data-tab=mutations]');
    const n0 = mutationState.records;
    clickOn('#append-item');
    frames(1);
    eq(q('#observed-list').children.length, 3);
    check(/childList → added 1, removed 0/.test(logText('#mutation-log')), 'append record');
    clickOn('#mutate-attr');
    frames(1);
    eq(q('#mutation-target').getAttribute('data-status'), 'active');
    eq(text('#target-status'), 'active');
    check(/attributes → "data-status" \(old "idle"\)/.test(logText('#mutation-log')), 'attribute record with old value');
    clickOn('#edit-text');
    frames(1);
    check(/characterData → "Node Item #1 \(edited\)"/.test(logText('#mutation-log')), 'characterData record');
    clickOn('#clear-children');
    frames(1);
    eq(q('#observed-list').children.length, 0);
    // Per spec innerHTML = '' queues one childList record removing every child.
    check(/added 0, removed/.test(logText('#mutation-log')), 'innerHTML = "" queued a childList record removing the children');
    check(mutationState.records >= n0 + 3, 'records counted');
    clickOn('#clear-mutation-log');
    eq(q('#mutation-log').childElementCount, 0);
});

test('range: text → element boundaries, mirrored into the Selection', () => {
    clickOn('[data-tab=range-selection]');
    clickOn('#select-range');
    const d = diagnose(rangeState.range);
    eq([d.startContainer, d.startOffset, d.endContainer, d.endOffset, d.collapsed],
       ['#text', 4, 'P', 2, false]);
    eq(d.text, 'Antigravity bro');
    eq(text('#range-text'), '"Antigravity bro"');
    eq(text('#sel-count'), '1');
    eq(window.getSelection().toString(), 'Antigravity bro');
});

test('range: surroundContents wraps the selection in <mark>', () => {
    clickOn('#surround-range');
    const mark = q('#p1 mark');
    eq(mark.textContent, 'Antigravity bro');
    check(mark.firstElementChild && mark.firstElementChild.tagName === 'STRONG', 'mark wraps the strong');
    eq(rangeState.range.toString(), 'Antigravity bro');
});

test('range: collapse, then reset restores the article', () => {
    clickOn('#collapse-range');
    eq(text('#range-collapsed'), 'yes');
    eq(rangeState.range.toString(), '');
    clickOn('#reset-article');
    check(q('#p1').querySelector('mark') === null, 'mark gone after reset');
    eq(text('#range-collapsed'), 'no');
});

test('web animations: running, pause/play, rate, cancel', () => {
    clickOn('[data-tab=web-animations]');
    frames(10);
    eq(animState.animations.length, 2);
    const t = telemetry();
    eq(t.playState, 'running');
    check(t.count >= 2, 'getAnimations sees both, got ' + t.count);
    eq(text('#anim-state'), 'running');
    clickOn('#anim-play');
    eq(animState.animations[0].playState, 'paused');
    eq(text('#anim-play'), 'Play');
    const held = animState.animations[0].currentTime;
    frames(10);
    eq(animState.animations[0].currentTime, held, 'paused time holds');
    clickOn('#anim-play');
    eq(animState.animations[0].playState, 'running');
    setValue('#anim-speed', '2');
    eq(animState.animations[1].playbackRate, 2);
    frames(2);
    eq(text('#anim-rate'), '2.0×');
    clickOn('#anim-cancel');
    frames(2);
    eq(animState.animations[0].playState, 'idle');
    eq(text('#anim-play'), 'Play');
    clickOn('#anim-play');
    eq(animState.animations[0].playState, 'running', 'play after cancel restarts');
    clickOn('#anim-reverse');
    check(animState.animations[0].playbackRate < 0, 'reverse flips the rate');
});

shot('main');
done('dom-lab');
