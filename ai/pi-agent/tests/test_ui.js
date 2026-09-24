// The transcript UI end to end without a model: the scripted demo session
// (demo.js) streams the same agent events a live run does through the real
// renderer. Asserts every kind of row it draws, then screenshots it.
//   scripts/validate.sh ai/pi-agent
import { check, eq, test, done, frames, q, text, clickOn, shot } from "/lib/kit/test.js";
import { piAgent } from "/app/app.js";

frames(4);

test('boots waiting for a model', () => {
    check(/load a model/.test(text('#status')), 'status: ' + text('#status'));
    check(q('#btn-send').disabled, 'send disabled before a model loads');
    check(/brolm\/weights\/.*(\.gguf|Qwen3\.5)/.test(q('#model-path').value), 'model path prefilled: ' + q('#model-path').value);
});

await piAgent.runDemo({ live: false });
frames(4);

const $$ = (s) => document.querySelectorAll(s);

test('user and agent rows', () => {
    eq($$('#transcript .chat-row.you').length, 1, 'one user row');
    eq($$('#transcript .chat-row.agent').length, 2, 'plan reply + closing summary');
    check(!document.querySelector('#transcript .chat-row.streaming'), 'no bubble left streaming');
});

test('markdown rendered in the reply', () => {
    const body = document.querySelector('#transcript .chat-row.agent .chat-body');
    check(body.querySelector('h2'), 'heading');
    check(body.querySelector('ol li'), 'ordered list');
    check(body.querySelector('pre.md-code .chat-copy'), 'code block with a Copy button');
    check(body.querySelector('a[href="https://example.com/add"]'), 'link');
});

test('reasoning fold, collapsed', () => {
    const fold = q('#transcript .chat-think');
    check(fold.classList.contains('collapsed'), 'collapsed by default');
    check(/least invasive change/.test(fold.textContent), 'holds the thinking text');
});

test('tool cards', () => {
    const cards = $$('#transcript .chat-tool');
    eq(cards.length, 4, 'list_dir, read_file, edit_file, read__file');
    eq(Array.from(cards).map((c) => c.querySelector('.chat-tool-name').textContent),
       ['list_dir', 'read_file', 'edit_file', 'read__file']);
    check(cards[0].classList.contains('done') && !cards[0].classList.contains('collapsed'), 'short result stays open');
    check(cards[1].classList.contains('collapsed'), 'long result collapses');
    eq(cards[1].querySelector('.chat-tool-sum').textContent, 'lib/math.js', 'argument summary in the head');
    check(cards[2].querySelector('.chat-diff .add') && cards[2].querySelector('.chat-diff .ctx'), 'edit_file renders a diff');
    check(cards[3].classList.contains('error') && /error/.test(cards[3].querySelector('.chat-tool-state').textContent), 'error card');
});

test('approval prompt, then deny', () => {
    const card = q('#transcript .chat-approve');
    check(/bash/.test(card.textContent), 'asks about bash');
    clickOn(card.querySelector('.deny'));
    check(card.classList.contains('resolved') && /Denied/.test(card.textContent), 'resolved as denied');
});

test('context meter', () => {
    const m = q('#ctx-meter');
    check(!m.hidden, 'meter visible');
    check(/\/ 8(\.2)?k ctx/.test(text('#ctx-meter .chat-ctx-nums')), 'meter text: ' + text('#ctx-meter .chat-ctx-nums'));
});

test('clear transcript', () => {
    shot('demo');
    piAgent.reset();
    frames(1);
    eq(q('#transcript').children.length, 0, 'transcript cleared');
    check(q('#ctx-meter').hidden, 'meter hidden after reset');
});

done('pi-agent ui');
