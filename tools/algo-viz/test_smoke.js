// Activates each visualizer, waits for it to render, asserts the stage canvas
// has nontrivial content, and captures a screenshot per viz.
//
// Run from the workshop root so /lib mounts:
//   BRO_PROJECT_ROOT=$(realpath ../broworkshop) bro-headless ../broworkshop/tools/algo-viz test_smoke.js

sleep(200); flush();

const ids = VIZ.map(v => v.id);
assert(ids.length >= 3, 'expected 3+ visualizers, got ' + ids.length);
console.log('viz registered:', ids.join(', '));

// Sanity-check shell layout: stage should have meaningful height.
const stage = document.getElementById('stage');
const sr = stage.getBoundingClientRect();
console.log('stage:', sr.width.toFixed(0) + 'x' + sr.height.toFixed(0));
assert(sr.width > 200 && sr.height > 200, 'stage too small: ' + sr.width + 'x' + sr.height);

function nontrivial(samples) {
    // Pass if ANY sample is meaningfully brighter than the stage bg (#050505),
    // OR samples vary among themselves.
    let bright = 0;
    for (const p of samples) if (p.r + p.g + p.b > 60) bright++;
    if (bright > 0) return true;
    const ref = samples[0];
    for (let i = 1; i < samples.length; i++) {
        const p = samples[i];
        if (Math.abs(p.r - ref.r) + Math.abs(p.g - ref.g) + Math.abs(p.b - ref.b) > 8) return true;
    }
    return false;
}

for (const id of ids) {
    const row = document.querySelector(`.viz-item[data-id="${id}"]`);
    assert(row, 'no sidebar row for ' + id);
    row.click();
    sleep(400); flush();           // let init + first rAF run

    const cv = stage.querySelector('canvas');
    assert(cv, 'no canvas after activating ' + id);

    const r = cv.getBoundingClientRect();
    const cx = (r.left + r.width / 2) | 0;
    const cy = (r.top + r.height / 2) | 0;
    // Sample a 5-point cross to verify nontrivial drawing.
    const samples = [
        getPixel(cx, cy),
        getPixel(cx - 80, cy),
        getPixel(cx + 80, cy),
        getPixel(cx, cy - 60),
        getPixel(cx, cy + 60),
    ];
    const ok = nontrivial(samples);
    console.log(`${id}: canvas ${r.width|0}x${r.height|0} center=rgb(${samples[0].r},${samples[0].g},${samples[0].b}) ok=${ok}`);
    assert(ok, `${id}: canvas appears empty`);

    screenshot(`shot_${id}.png`);
    console.log('ok:', id);
}
console.log('SMOKE OK');
