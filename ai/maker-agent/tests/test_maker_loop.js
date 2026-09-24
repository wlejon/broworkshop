// Live capstone (tag: net): the author -> preview -> look loop end-to-end
// through the app's real surface, against OpenRouter.
//   1. look over a known page: the vision model returns a real description
//      and the capture thumbnail lands in the transcript.
//   2. An autonomous turn: the brain writes a page with the file tools and
//      the turn reaches idle. What a free model draws varies, so the picture
//      is saved (shot) rather than graded.
// Needs OPENROUTER_API_KEY; skips without it.
//   OPENROUTER_API_KEY=sk-or-... bro-headless ai/maker-agent ai/maker-agent/tests/test_maker_loop.js
import { check, test, done, frames, pumpUntil, skip, shot } from "/lib/kit/test.js";
import { maker, PROJECT_DIR } from "/app/app.js";

const KEY = process.env.OPENROUTER_API_KEY;
if (!KEY) skip('OPENROUTER_API_KEY is not set');

const fs = require('fs');
const savedPrefs = maker.prefs.snapshot();
const placeholder = fs.readFileSync(PROJECT_DIR + '/index.html', 'utf-8');
frames(2);
maker.configure({ kind: 'openrouter', key: KEY });

async function settle(promise, ms) {
    let out = null, fin = false;
    promise.then((v) => { out = { value: v }; fin = true; }, (e) => { out = { error: e }; fin = true; });
    pumpUntil(() => fin, ms);
    return fin ? out : { error: new Error('timed out after ' + ms + ' ms') };
}

try {
    fs.writeFileSync(PROJECT_DIR + '/index.html',
        '<!doctype html><html><head><style>html,body{margin:0;height:100%}' +
        '#sky{height:60%;background:#87ceeb}#ground{height:40%;background:#3a7d34}</style></head>' +
        '<body><div id="sky"></div><div id="ground"></div></body></html>');
    const r = await settle(maker.look('What colors and regions do you see, top to bottom?'), 180000);

    test('look describes the preview', () => {
        check(!r.error, 'look resolved: ' + (r.error && r.error.message));
        const res = r.value;
        const txt = (res.content && res.content[0] && res.content[0].text) || '';
        console.log('look returned: ' + JSON.stringify(txt.slice(0, 220)));
        check(!(res.details && res.details.error), 'vision model answered: ' + txt.slice(0, 200));
        check(txt.length > 15, 'a real description');
    });

    maker.reset();
    fs.writeFileSync(PROJECT_DIR + '/index.html', '<!doctype html><html><body></body></html>');
    const turn = await settle(maker.prompt(
        'Build a simple web page in index.html: a full-viewport page with a sky-blue background and one big ' +
        'centered solid yellow circle (a sun). Write the file, then call the look tool once to check it, then ' +
        'stop and summarize in one sentence. At most 4 tool calls.'), 600000);
    frames(2);

    test('an autonomous turn writes the project and finishes', () => {
        check(!turn.error, 'turn finished: ' + (turn.error && turn.error.message));
        check(!maker.session.running, 'session idle');
        check(document.querySelectorAll('#transcript .chat-tool').length > 0, 'tools were called');
        check(fs.readFileSync(PROJECT_DIR + '/index.html', 'utf-8').length > 60, 'index.html written');
        const cap = maker.capturePreview();
        check(cap.imageData.width > 0, 'final preview captured');
    });
    shot('autonomous');
} finally {
    fs.writeFileSync(PROJECT_DIR + '/index.html', placeholder);
    maker.renderPreview();
    maker.prefs.restore(savedPrefs);
}
done('maker loop');
