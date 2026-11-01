// tools/shader-lab/tests/test_main.js
import { PRESETS } from '../presets.js';
import { KernelRuntime } from '../kernel-runtime.js';

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

console.log("\n=== brokernel Shader Lab Integration Tests ===\n");

// [1] The canvas and the GPU
console.log("[1] Canvas & bro.kernel");
const canvas = document.getElementById('viewCanvas');
check("canvas element exists", !!canvas);
check("bro.kernel has a GPU", !!(bro.kernel && bro.kernel.gpu));

// [2] The runtime
console.log("\n[2] KernelRuntime");
let runtime = null;
try {
    runtime = new KernelRuntime(canvas);
    check("KernelRuntime initialized cleanly", !!runtime);
    check("canvas has a 'kernel' context", !!runtime.ctx);
} catch (e) {
    check("KernelRuntime init failed: " + e.message, false);
}

// [3] Every preset compiles and draws a picture that is not one colour.
console.log("\n[3] Presets");
if (runtime) {
    canvas.width = 160;
    canvas.height = 120;
    for (const [key, src] of Object.entries(PRESETS)) {
        const res = runtime.setSource(src);
        check(`Preset '${key}' compiles` + (res.success ? '' : ': ' + res.error), res.success === true);
        if (!res.success) continue;
        runtime.render({ time: 2.5, mouse: [0, 0, 0, 0], param1: 1.0, param2: 3.0, param3: 0.5, param4: 1.0 });
        const r = canvas.getBoundingClientRect();
        const px = getPixels(Math.round(r.x), Math.round(r.y), 16, 16).data;
        const shot = getPixels(Math.round(r.x + r.width / 2) - 8, Math.round(r.y + r.height / 2) - 8, 16, 16).data;
        let varied = false;
        for (let i = 4; i < px.length; i += 4) if (px[i] !== px[0] || shot[i] !== px[0]) { varied = true; break; }
        check(`Preset '${key}' draws a picture`, varied);
    }
}

// [4] Rendering with the mouse held and a resize
console.log("\n[4] Frame Rendering");
if (runtime) {
    runtime.setSource(PRESETS.raymarch);
    canvas.width = 640;
    canvas.height = 480;
    try {
        runtime.render({ time: 2.5, mouse: [320, 240, 320, 240], param1: 1.0, param2: 3.0, param3: 0.5, param4: 1.0 });
        check("runtime.render executed without error", true);
        check("pixel buffer follows the canvas size", runtime.w === 640 && runtime.h === 480);
    } catch (e) {
        check("runtime.render failed: " + e.message, false);
    }
}

// [5] Errors
console.log("\n[5] Error Reporting");
if (runtime) {
    const good = runtime.kernel;
    let res = runtime.setSource(`@kernel @grid(2)
fn main_image(g: grid<2>, out: write_store<vec4<f32>, 2>) {
    invalid_syntax_error();
}`);
    check("a compile error returns success: false", res.success === false);
    check("its log names the error", typeof res.error === 'string' && res.error.length > 0);
    check("the last good kernel keeps running", runtime.kernel === good);

    res = runtime.setSource(`@kernel @grid(2)
fn other(g: grid<2>, out: write_store<vec4<f32>, 2>) {
    out[g.x(), g.y()] = vec4<f32>(1.0, 0.0, 0.0, 1.0);
}`);
    check("a source without main_image is refused", res.success === false && /main_image/.test(res.error));

    res = runtime.setSource(`@kernel @grid(2)
fn main_image(g: grid<2>, out: write_store<vec4<f32>, 2>) {
    out[g.x(), g.y()] = vec4<f32>(1.0, 0.0, 0.0, 1.0);
}`);
    check("a main_image with the wrong parameters is refused", res.success === false && /takes/.test(res.error));
}

// [6] Screenshot
console.log("\n[6] Capturing Verification Screenshot");
if (runtime) runtime.setSource(PRESETS.raymarch);
if (typeof advanceTime === 'function') {
    advanceTime(50);
}
if (typeof screenshot === 'function') {
    screenshot("shader_lab_test.png");
    console.log("  screenshot: shader_lab_test.png");
}

console.log(`\n=== ${passed} passed, ${failed} failed ===\n`);

if (failed > 0) {
    throw new Error(`${failed} tests failed in shader-lab integration test suite`);
}
