// demos/vlm-lab/tests/test_main.js
import { ImageLoader } from '../image-loader.js';
import { VLMEngine } from '../vlm-engine.js';
import { ChatUI } from '../chat-ui.js';

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

console.log("\n=== Vision-Language Lab Integration Tests ===\n");

// [1] Canvas & Viewport Verification
console.log("[1] Viewport & Canvas Verification");
const imageCanvas = document.getElementById('imageCanvas');
const overlayCanvas = document.getElementById('overlayCanvas');

check("imageCanvas element exists", !!imageCanvas);
check("overlayCanvas element exists", !!overlayCanvas);

// [2] ImageLoader & Presets
console.log("\n[2] ImageLoader & Preset Verification");
let loadedContext = null;
const imageLoader = new ImageLoader(imageCanvas, overlayCanvas, (ctx) => {
    loadedContext = ctx;
});

check("imageLoader instantiated", !!imageLoader);
check("preset loaded with ground truth", loadedContext !== null && Array.isArray(loadedContext.groundTruth));
check("ground truth contains boxes", loadedContext && loadedContext.groundTruth.length > 0);

// Test bounding box rendering
imageLoader.renderBoundingBoxes(loadedContext.groundTruth);
check("renderBoundingBoxes rendered without error", imageLoader.currentBoxes.length > 0);

// [3] VLMEngine Multimodal Generation
console.log("\n[3] VLMEngine Multimodal Inference");
const engine = new VLMEngine();
check("VLMEngine instantiated", !!engine);

let streamedTokens = '';
const result = await engine.generateResponse(
    "Detect and locate key objects in this image.",
    loadedContext,
    (token) => {
        streamedTokens += token;
    }
);

check("generateResponse returned result object", !!result);
check("streamedTokens match result text", streamedTokens.length > 0 && streamedTokens === result.text);
check("result extracted bounding boxes", result.boxes && result.boxes.length > 0);
check("latency and token speed calculated", result.latencyMs >= 0 && result.tokensPerSec >= 0);

// [4] ChatUI Message Management
console.log("\n[4] ChatUI Messaging & Tags");
const chatHistory = document.getElementById('chatHistory');
const groundedTags = document.getElementById('groundedTags');
const chatUI = new ChatUI(chatHistory, groundedTags);

chatUI.appendUserMessage("Test user prompt");
const asstBody = chatUI.createAssistantMessage();
asstBody.textContent = "Test assistant stream";
chatUI.updateGroundedTags(result.boxes);

check("chatHistory contains user message", chatHistory.textContent.includes("Test user prompt"));
check("groundedTags updated with box labels", groundedTags.textContent.includes(result.boxes[0].label));

// [5] Screenshot
console.log("\n[5] Capturing Verification Screenshot");
if (typeof advanceTime === 'function') {
    advanceTime(50);
}
if (typeof screenshot === 'function') {
    screenshot("vlm_lab_test.png");
    console.log("  screenshot: vlm_lab_test.png");
}

console.log(`\n=== ${passed} passed, ${failed} failed ===\n`);

if (failed > 0) {
    throw new Error(`${failed} tests failed in vlm-lab integration test suite`);
}
