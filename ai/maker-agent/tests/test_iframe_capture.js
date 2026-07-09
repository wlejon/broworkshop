// Headless proof of the author -> preview -> look MECHANICS, with NO model or API
// key: point the preview iframe at a known fixture, force a rendered frame, and
// capture it back through the exact path the `look` tool uses (iframe.capture() +
// bro.image.encodeJpeg). Proves the rebuilt maker-agent's perceptual loop works.
//
//   bro-headless ai/maker-agent tests/test_iframe_capture.js

assert(window.__makerDebug, "main.js must have booted (window.__makerDebug present)");

const preview = document.querySelector("#preview");
assert(preview, "preview iframe present");

// Point the preview at the fixture (red top / blue bottom). Assigning src reloads
// the sub-document from disk — the same call the agent's edits trigger via reload().
preview.src = "tests/fixtures/capdoc/";

// In headless there is no continuous render loop, so force one full frame (which
// records + replays every iframe into its GPU surface) before reading it back.
screenshot("C:/Users/jonny/AppData/Local/Temp/claude/D--projects-bro/7361a163-5fb9-4b8e-84fd-ab689d46da8d/scratchpad/maker_preview_frame.png");

const img = preview.capture();
assert(img, "capture() returned an ImageData");
assert(img.width > 0 && img.height > 0, "capture has non-zero size");
console.log("capture:", img.width + "x" + img.height);

function px(x, y) {
    const i = (y * img.width + x) * 4;
    return [img.data[i], img.data[i + 1], img.data[i + 2]];
}
const cx = img.width >> 1;
const top = px(cx, Math.floor(img.height * 0.25));   // red band
const bot = px(cx, Math.floor(img.height * 0.75));   // blue band
console.log("top(25%) =", JSON.stringify(top));
console.log("bot(75%) =", JSON.stringify(bot));
assert(top[0] > 180 && top[2] < 90, "top band is red (correct capture + top-down orientation)");
assert(bot[2] > 180 && bot[0] < 90, "bottom band is blue");

// The exact encode the app's capturePreview() performs for the vision model.
const bytes = bro.image.encodeJpeg(img.data, img.width, img.height, 4, 82);
assert(bytes && bytes.length > 200, "jpeg encoded from the captured preview");
console.log("jpeg bytes:", bytes.length);

// And through the app's own wrapper (returns { dataUri, imageData }).
const cap = window.__makerDebug.capturePreview();
assert(cap && cap.dataUri && cap.dataUri.indexOf("data:image/jpeg;base64,") === 0, "capturePreview() produced a data URI");
console.log("capturePreview dataUri length:", cap.dataUri.length);

console.log("MAKER CAPTURE MECHANICS OK");
