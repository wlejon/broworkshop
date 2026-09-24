// The author -> preview -> look mechanics with no model or key: point the
// preview at a fixture page, render, and read it back through the exact path
// `look` uses (iframe.capture() + bro.image.encodeJpeg).
import { check, test, done, frames } from "/lib/kit/test.js";
import { maker } from "/app/app.js";

const preview = maker.preview;
preview.src = 'tests/fixtures/capdoc/';   // red top half, blue bottom half
frames(2);

const img = preview.capture();
check(img && img.width > 0 && img.height > 0, 'capture() returned pixels');
const px = (fy) => {
    const i = (Math.floor(img.height * fy) * img.width + (img.width >> 1)) * 4;
    return [img.data[i], img.data[i + 1], img.data[i + 2]];
};

test('capture is top-down and faithful', () => {
    const top = px(0.25), bot = px(0.75);
    check(top[0] > 180 && top[2] < 90, 'top band is red: ' + top);
    check(bot[2] > 180 && bot[0] < 90, 'bottom band is blue: ' + bot);
});

test('capturePreview encodes a JPEG data URI', () => {
    const cap = maker.capturePreview();
    check(cap && cap.dataUri.indexOf('data:image/jpeg;base64,/9j/') === 0, 'jpeg data uri');
    check(cap.dataUri.length > 400, 'non-trivial image (' + cap.dataUri.length + ' chars)');
    check(cap.imageData.width === img.width, 'imageData kept for the thumbnail');
});

done('iframe capture');
