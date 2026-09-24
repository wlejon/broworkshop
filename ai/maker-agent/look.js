// look.js — the maker's eyes: reload the <iframe> preview of the app the agent
// wrote, read its rendered pixels back, and ask an OpenRouter vision model
// what is on screen. The same frame the user sees is what the agent sees.

import { h } from "/lib/kit/dom.js";
import { errorResult, textResult } from "/lib/kit/agent.js";
import { chatCompletion } from "/lib/openrouter.js";

// Free vision models to fall back through when the chosen one is throttled:
// they route to different upstream providers, so another model dodges a 429.
export const VISION_FALLBACKS = [
    'google/gemma-4-31b-it:free',
    'nvidia/nemotron-nano-12b-v2-vl:free',
    'nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free',
    'google/gemma-4-26b-a4b-it:free',
];

const nextFrame = () => new Promise((r) => requestAnimationFrame(() => r()));

function toBase64(bytes) {
    let bin = '';
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return btoa(bin);
}

/**
 * Rebuild the preview from the files on disk. capture() applies the reload
 * and renders the sub-document itself before reading back, so a look right
 * after a write sees that write; the frame yield lets the on-screen preview
 * repaint too.
 */
export async function renderPreview(preview) {
    try { preview.reload(); } catch (e) { console.error('preview.reload', e); }
    await nextFrame();
}

/** The preview's pixels: { imageData, dataUri (JPEG, for the vision model) }, or null. */
export function capturePreview(preview) {
    try {
        const img = preview.capture();
        if (!img || !img.width || !img.height) return null;
        const jpeg = bro.image.encodeJpeg(img.data, img.width, img.height, 4, 82);
        if (!jpeg || !jpeg.length) throw new Error('jpeg encode failed');
        return { imageData: img, dataUri: 'data:image/jpeg;base64,' + toBase64(jpeg) };
    } catch (e) {
        console.error('capturePreview', e);
        return null;
    }
}

/** A thumbnail of what the agent saw (a canvas holding the captured pixels). */
export function lookShot(imageData) {
    const c = h('canvas.look-shot', { width: imageData.width, height: imageData.height });
    c.getContext('2d').putImageData(imageData, 0, 0);
    const s = Math.min(1, 240 / imageData.width, 200 / imageData.height);   // fit a 240x200 thumbnail
    c.style.width = Math.round(imageData.width * s) + 'px';
    c.style.height = Math.round(imageData.height * s) + 'px';
    return c;
}

/**
 * One description of `dataUri` from the first vision model that answers:
 * `models` in order, each with the rate-limit retries of chatCompletion.
 */
export async function describeImage({ key, models, dataUri, instruction, onRateLimit }) {
    if (!key) throw new Error('no OpenRouter key set for the vision model');
    const tries = models.filter((m, i) => m && models.indexOf(m) === i);
    let last = null;
    for (const model of tries) {
        try {
            const body = await chatCompletion({ apiKey: key, maxRetries: 4, onRateLimit }, {
                model, max_tokens: 320,
                messages: [{ role: 'user', content: [
                    { type: 'text', text: instruction + '\nBe concrete and brief. Focus on what differs from the goal and what to change next.' },
                    { type: 'image_url', image_url: { url: dataUri } },
                ] }],
            });
            const msg = body.choices && body.choices[0] && body.choices[0].message;
            return (msg && msg.content) || '(vision model returned no text)';
        } catch (e) {
            last = e;
            console.warn('vision model ' + model + ' failed: ' + ((e && e.message) || e));
        }
    }
    throw last || new Error('all vision models failed');
}

/**
 * The `look` callback for lookTool: reload + capture the preview, show the
 * thumbnail in the chat, describe it with the chosen vision model (then the
 * fallbacks). opts: { preview, chat, backend, status }.
 */
export function previewLook({ preview, chat, backend, status }) {
    return async (instruction) => {
        await renderPreview(preview);
        const cap = capturePreview(preview);
        if (!cap) return errorResult("the preview hasn't rendered anything yet: write your app's index.html first, then look.");
        chat.addNode(lookShot(cap.imageData));
        try {
            const text = await describeImage({
                key: backend.key, models: [backend.vision].concat(VISION_FALLBACKS), dataUri: cap.dataUri, instruction,
                onRateLimit: ({ model, waitMs }) => status.warn('look: ' + String(model).replace(/:free$/, '') +
                    ' rate-limited, retrying in ' + Math.round(waitMs / 1000) + ' s…'),
            });
            return textResult(text, { looked: true });
        } catch (e) {
            return errorResult('looking at the preview failed: ' + ((e && e.message) || e));
        }
    };
}
