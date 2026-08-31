// tools/shader-lab/tests/test_main.js
import { PRESETS } from '../presets.js';
import { GLRuntime } from '../gl-runtime.js';

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

console.log("\n=== WebGL2 Shader Lab Integration Tests ===\n");

// [1] WebGL2 Context & Canvas
console.log("[1] WebGL2 Context Verification");
const canvas = document.getElementById('glCanvas');
check("canvas element exists", !!canvas);

let gl = null;
try {
    gl = canvas ? canvas.getContext('webgl2') : null;
    check("canvas.getContext('webgl2') returned valid WebGL2 context", !!gl);
} catch (e) {
    check("getContext('webgl2') failed: " + e.message, false);
}

// [2] GLRuntime & Quad Buffers
console.log("\n[2] GLRuntime Quad Pipeline");
let runtime = null;
try {
    runtime = new GLRuntime(canvas);
    check("GLRuntime initialized cleanly", !!runtime);
    check("runtime.vao is valid", !!runtime.vao);
    check("runtime.vbo is valid", !!runtime.vbo);
} catch (e) {
    check("GLRuntime init failed: " + e.message, false);
}

// [3] Compile All Presets
console.log("\n[3] Testing Preset Compilation");
if (runtime) {
    for (const [key, src] of Object.entries(PRESETS)) {
        const res = runtime.setFragmentShader(src);
        check(`Preset '${key}' compiles and links cleanly`, res.success === true);
    }
}

// [4] Uniform Locations & Rendering Execution
console.log("\n[4] Uniform Locations & Frame Rendering");
if (runtime) {
    runtime.setFragmentShader(PRESETS.raymarch);
    check("u_resolution uniform location cached", !!runtime.uniformLocations.u_resolution);
    check("u_time uniform location cached", !!runtime.uniformLocations.u_time);
    check("u_mouse uniform location cached", !!runtime.uniformLocations.u_mouse);
    check("u_param1 uniform location cached", !!runtime.uniformLocations.u_param1);

    canvas.width = 640;
    canvas.height = 480;

    try {
        runtime.render({
            time: 2.5,
            mouse: [320, 240, 0, 0],
            param1: 1.0,
            param2: 3.0,
            param3: 0.5,
            param4: 1.0
        });
        check("runtime.render executed without error", true);
    } catch (e) {
        check("runtime.render failed: " + e.message, false);
    }
}

// [5] Error Handling Verification
console.log("\n[5] Invalid Shader Error Reporting");
if (runtime) {
    const invalidShader = `#version 300 es
    precision highp float;
    out vec4 fragColor;
    void main() {
        invalid_syntax_error();
    }`;
    const res = runtime.setFragmentShader(invalidShader);
    check("Invalid GLSL syntax returns success: false", res.success === false);
    check("Invalid GLSL syntax contains error log string", typeof res.error === 'string' && res.error.length > 0);
}

// [6] Screenshot
console.log("\n[6] Capturing Verification Screenshot");
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
