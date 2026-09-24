// Maker Agent without a network: the backend controls, and a scripted agent
// that writes the project's index.html and looks at it through the real
// preview (look fails on the missing key, but only after capturing, so the
// thumbnail and the error both show up in the transcript).
import { check, eq, test, done, frames, q, text, setValue, shot } from "/lib/kit/test.js";
import { createAgent } from "/lib/kit/agent.js";
import { codingTools, lookTool } from "/lib/kit/agent-tools.js";
import { maker, PROJECT_DIR } from "/app/app.js";

const fs = require('fs');
const savedPrefs = maker.prefs.snapshot();
const placeholder = fs.readFileSync(PROJECT_DIR + '/index.html', 'utf-8');
frames(2);

test('boots on OpenRouter, waiting for a key', () => {
    maker.configure({ kind: 'openrouter', key: '' });
    check(!q('#or-controls').hidden && q('#brolm-controls').hidden, 'OpenRouter controls shown');
    check(q('#btn-send').disabled, 'send disabled without a key');
    check(text('#brain-display').length > 0 && text('#vision-display').length > 0, 'model slots filled');
});

test('a key enables Send', () => {
    setValue('#or-key', 'sk-or-test');
    check(!q('#btn-send').disabled, 'send enabled');
    check(maker.backend.stream(), 'provider available');
});

test('switching to local shows the model row', () => {
    setValue('#backend-kind', 'brolm');
    check(q('#or-controls').hidden && !q('#brolm-controls').hidden, 'local controls shown');
    check(q('#btn-send').disabled, 'no local model loaded yet');
    check(/brolm\/weights\//.test(q('#model-path').value), 'model path prefilled: ' + q('#model-path').value);
    setValue('#backend-kind', 'openrouter');
});

// A scripted brain: write index.html, look, then finish.
const PAGE = '<!doctype html><html><body style="margin:0;background:#1e90ff"><h1 style="color:#fff">hi</h1></body></html>';
const turns = [
    [{ type: 'toolCall', id: 'w', name: 'write_file', arguments: { path: 'index.html', content: PAGE } },
     { type: 'toolCall', id: 'l', name: 'look', arguments: { instruction: 'what color is it?' } }],
    [{ type: 'text', text: 'Built a **blue** page.' }],
];
let i = 0;
const stream = async (ctx, opts, emit) => {
    const content = turns[i++];
    emit({ type: 'start', partial: { role: 'assistant', content } });
    return { role: 'assistant', content, usage: { input: 900, output: 40 }, stopReason: content[0].type === 'toolCall' ? 'toolUse' : 'stop' };
};

maker.reset();
maker.configure({ key: '' });
const agent = createAgent({ stream, tools: codingTools(PROJECT_DIR).concat([lookTool(maker.look)]),
                            onEvent: maker.chat.onEvent, approve: maker.chat.approve });
maker.chat.addUser('make a blue page');
await agent.prompt('make a blue page');
frames(2);

test('the agent wrote the project and looked', () => {
    eq(fs.readFileSync(PROJECT_DIR + '/index.html', 'utf-8'), PAGE, 'index.html written');
    const cards = document.querySelectorAll('#transcript .chat-stack > .chat-tool');
    eq(cards.length, 2, 'write_file + look stacked in one group');
    check(cards[0].classList.contains('done'), 'write done');
    check(cards[1].classList.contains('error') && /OpenRouter key/.test(cards[1].textContent), 'look reports the missing key');
    check(document.querySelector('#transcript canvas.look-shot'), 'look thumbnail shown');
    check(document.querySelector('#transcript .chat-row.agent strong'), 'final reply rendered');
});

test('the preview shows what the agent wrote', () => {
    const cap = maker.capturePreview();
    const d = cap.imageData, k = ((d.height >> 1) * d.width + 8) * 4;
    check(d.data[k + 2] > 200 && d.data[k] < 80, 'preview is blue: ' + [d.data[k], d.data[k + 1], d.data[k + 2]]);
});

shot('scripted');
fs.writeFileSync(PROJECT_DIR + '/index.html', placeholder);
maker.renderPreview();
maker.prefs.restore(savedPrefs);
done('maker ui');
