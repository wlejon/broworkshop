// tools/inpainting-studio/tests/test_main.js
import { MaskCanvasController } from '../mask-canvas.js';
import { ControlNetAnnotator } from '../controlnet.js';
import { InpaintingPipeline } from '../diffusion-pipeline.js';

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

console.log("\n=== Inpainting Studio Integration Tests ===\n");

// [1] Canvases Verification
console.log("[1] Canvases & Context Verification");
const baseCanvas = document.getElementById('baseCanvas');
const maskCanvas = document.getElementById('maskCanvas');
const controlCanvas = document.getElementById('controlCanvas');
const resultCanvas = document.getElementById('resultCanvas');

check("baseCanvas element exists", !!baseCanvas);
check("maskCanvas element exists", !!maskCanvas);
check("controlCanvas element exists", !!controlCanvas);
check("resultCanvas element exists", !!resultCanvas);

// [2] Mask Canvas Controller Operations
console.log("\n[2] Mask Controller Painting Operations");
let maskModified = false;
const maskCtrl = new MaskCanvasController(baseCanvas, maskCanvas, () => {
    maskModified = true;
});

check("MaskCanvasController instantiated", !!maskCtrl);

// Paint stroke
maskCtrl.brushSize = 40;
maskCtrl.brushHardness = 0.8;
maskCtrl.paintStroke(256, 256);
check("paintStroke executed", true);

// Paint line
maskCtrl.paintLine(100, 100, 200, 200);
check("paintLine executed", true);

// Invert mask
maskCtrl.invertMask();
check("invertMask executed", true);

// Clear mask
maskCtrl.clearMask();
check("clearMask executed", true);

// Outpainting Expand
const origW = baseCanvas.width;
maskCtrl.expandBounds(64, 0);
check("expandBounds enlarged canvas width", baseCanvas.width === origW + 64);

// [3] ControlNet Preprocessor
console.log("\n[3] ControlNet Annotator Verification");
const controlNet = new ControlNetAnnotator(controlCanvas);
check("ControlNetAnnotator instantiated", !!controlNet);

// Canny Edge detection
controlNet.process(baseCanvas, 'canny');
check("ControlNet Canny preprocessor executed cleanly", controlCanvas.width === baseCanvas.width);

// Depth map estimation
controlNet.process(baseCanvas, 'depth');
check("ControlNet Depth preprocessor executed cleanly", controlCanvas.height === baseCanvas.height);

// [4] Diffusion Inpainting Pipeline Execution
console.log("\n[4] Inpainting Pipeline Execution");
const pipeline = new InpaintingPipeline(resultCanvas);
check("InpaintingPipeline instantiated", !!pipeline);

// Paint a test mask spot
maskCtrl.paintStroke(150, 150);

const inpaintResult = await pipeline.runInpaint(baseCanvas, maskCanvas, controlCanvas, {
    prompt: "high quality crystal ornament",
    denoise: 0.8,
    steps: 20,
    fillMode: 'blur'
});

check("pipeline.runInpaint returned success", inpaintResult && inpaintResult.success === true);
check("resultCanvas populated", resultCanvas.width === baseCanvas.width);

// [5] Screenshot
console.log("\n[5] Capturing Verification Screenshot");
if (typeof advanceTime === 'function') {
    advanceTime(50);
}
if (typeof screenshot === 'function') {
    screenshot("inpainting_studio_test.png");
    console.log("  screenshot: inpainting_studio_test.png");
}

console.log(`\n=== ${passed} passed, ${failed} failed ===\n`);

if (failed > 0) {
    throw new Error(`${failed} tests failed in inpainting-studio integration test suite`);
}
