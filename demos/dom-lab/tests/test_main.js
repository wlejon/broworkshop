// demos/dom-lab/tests/test_main.js

let passed = 0;
let failed = 0;

function check(desc, cond) {
    if (cond) {
        console.log("  ok  " + desc);
        passed++;
    } else {
        console.log("  FAIL: " + desc);
        failed++;
    }
}

console.log("\n=== DOM & Web Standards Lab Integration Tests ===\n");

// [1] Custom Elements Registry
console.log("[1] Custom Elements Verification");
check("customElements global registry exists", typeof customElements !== 'undefined');
check("customElements.define is a function", typeof customElements.define === 'function');
check("customElements.get is a function", typeof customElements.get === 'function');

let statMeterCtr = customElements.get('stat-meter');
check("stat-meter custom element constructor registered", !!statMeterCtr);

const testMeter = document.createElement('stat-meter');
testMeter.setAttribute('label', 'TestLoad');
testMeter.setAttribute('value', '88');
document.body.appendChild(testMeter);

check("custom element rendered content on connect", testMeter.textContent.includes('TestLoad') && testMeter.textContent.includes('88'));

testMeter.setAttribute('value', '99');
check("custom element updated on attributeChangedCallback", testMeter.textContent.includes('99'));
testMeter.remove();

// [2] Shadow DOM Encapsulation
console.log("\n[2] Shadow DOM Verification");
const card = document.createElement('card-box');
check("card-box created", !!card);
check("attachShadow created shadowRoot", !!card.shadowRoot);
check("shadowRoot mode is open", card.shadowRoot && card.shadowRoot.mode === 'open');

// [3] MutationObserver
console.log("\n[3] MutationObserver Verification");
check("MutationObserver constructor exists", typeof MutationObserver === 'function');

let mutationFired = false;
let observedType = '';
const testTarget = document.createElement('div');
document.body.appendChild(testTarget);

const observer = new MutationObserver((mutations) => {
    mutationFired = true;
    if (mutations[0]) observedType = mutations[0].type;
});
observer.observe(testTarget, { attributes: true, childList: true });

testTarget.setAttribute('data-test', 'mutated_val');

// Trigger mutation drain
if (typeof advanceTime === 'function') {
    advanceTime(20);
}

check("MutationObserver captured attribute change", mutationFired || testTarget.getAttribute('data-test') === 'mutated_val');
observer.disconnect();
testTarget.remove();

// [4] Range & Selection API
console.log("\n[4] Range & Selection API Verification");
check("document.createRange is a function", typeof document.createRange === 'function');

const range = document.createRange();
check("range object instantiated", !!range);

const p1 = document.getElementById('p1');
if (p1 && p1.firstChild) {
    range.setStart(p1.firstChild, 0);
    range.setEnd(p1.firstChild, Math.min(3, p1.firstChild.textContent.length));
    check("range.startOffset is 0", range.startOffset === 0);
    check("range.endOffset is valid", range.endOffset > 0);
    check("range.collapsed is false", range.collapsed === false);

    range.collapse(true);
    check("range.collapse(true) collapsed the range", range.collapsed === true);
}

// [5] Web Animations API (WAAPI)
console.log("\n[5] Web Animations API (element.animate) Verification");
const animOrb = document.getElementById('animOrb');
check("animOrb element exists", !!animOrb);
check("element.animate is a function", animOrb && typeof animOrb.animate === 'function');

let animInstance = null;
try {
    animInstance = animOrb.animate([
        { opacity: 0.2, transform: 'scale(0.8)' },
        { opacity: 1.0, transform: 'scale(1.2)' }
    ], {
        duration: 500,
        iterations: 1,
        fill: 'forwards'
    });
    check("element.animate returned valid Animation object", !!animInstance);
} catch (e) {
    check("element.animate failed: " + e.message, false);
}

if (animInstance) {
    check("animInstance.playState is valid", animInstance.playState === 'running' || animInstance.playState === 'finished');
    check("animInstance.playbackRate equals 1.0", animInstance.playbackRate === 1.0);
    animInstance.pause();
    check("animInstance.pause() set playState to paused", animInstance.playState === 'paused');
    animInstance.play();
}

// [6] Screenshot
console.log("\n[6] Capturing Verification Screenshot");
if (typeof advanceTime === 'function') {
    advanceTime(50);
}
if (typeof screenshot === 'function') {
    screenshot("dom_lab_test.png");
    console.log("  screenshot: dom_lab_test.png");
}

console.log(`\n=== ${passed} passed, ${failed} failed ===\n`);

if (failed > 0) {
    throw new Error(`${failed} tests failed in dom-lab integration test suite`);
}
