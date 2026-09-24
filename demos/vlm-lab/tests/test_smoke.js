// VLM Lab: boot loads Qwen3-VL; quick prompts stream real replies into the
// chat about the sample image; a detect prompt's boxes (whatever the model
// says) land as overlay tags; a follow-up turn does not resend the image;
// Stop settles; CLIP and Qwen3.5 load and answer through the family switch
// when their weights are here. Replies are not graded. Skips without Qwen3-VL.
//
//   scripts/validate.sh --ml demos/vlm-lab

import { check, eq, test, done, waitFor, q, text, clickOn, setValue, shot, needWeights } from "/lib/kit/test.js";
import { findWeights } from "/lib/kit/weights.js";
import { lab, QWEN3VL, QWEN35, CLIP, CLIP_TOK, splitThinking } from "/app/lab.js";
import { parseBoxes } from "/app/stage.js";

// 0. pure parsing (no model)
test('parseBoxes: every complete bbox_2d object, clamped', () => {
    const b = parseBoxes('Here: [{"bbox_2d": [10, 20, 300, 400], "label": "sun"}, {"label": "hill", "bbox_2d": [0,500,1200,999]}, {"bbox_2d": [5, 5');
    eq(b.length, 2);
    eq(b[0].label, 'sun'); eq(b[1].label, 'hill'); eq(b[1].x2, 1000);
});
test('parseBoxes: degenerate boxes dropped', () => eq(parseBoxes('{"bbox_2d":[50,50,40,60],"label":"x"}').length, 0));
test('parseBoxes: exact repeats once', () =>
    eq(parseBoxes('{"bbox_2d":[1,2,3,4],"label":"a"},{"bbox_2d":[1,2,3,4],"label":"a"},{"bbox_2d":[1,2,3,4],"label":"b"}').length, 2));
test('splitThinking', () => {
    const s = splitThinking('<think>hmm</think>\n\nA cat.');
    check(s.thinking === 'hmm' && s.text === 'A cat.');
});

needWeights('Qwen3-VL Instruct', QWEN3VL, { probe: 'config.json' });

const answered = (n) => { waitFor(() => lab.replies > n, 'reply', 300000); check(!lab.error, lab.error); };

// 1. load
waitFor(() => lab.model || lab.error, 'Qwen3-VL load', 600000);
check(!lab.error, 'loaded: ' + lab.error);
test('model meta', () => check(/layers/.test(lab.ui.row.metaEl.textContent)));
test('sample image shown', () => check(/mountain/i.test(text('#image-meta'))));
test('send + quick prompts armed; CLIP prompt off', () =>
    check(!q('#btn-send').disabled && !q('#quick button').disabled && q('#quick button[data-clip]').disabled));

// 2. describe via a quick prompt
setValue('#max-tokens', '96');
let n = lab.replies;
clickOn('#quick button:nth-child(1)');
test('running: stop armed', () => check(lab.running && !q('#btn-stop').disabled));
answered(n);
test('reply text', () => check(lab.reply.length > 0));
test('chat rows: you + model', () => check(q('#chat .chat-row.you') && q('#chat .chat-row.agent') &&
                                           text('#chat .chat-row.agent .chat-body').length > 0));
test('badges', () => check(/tok\/s/.test(text('#badge-rate')) && /\d+ ms/.test(text('#badge-latency'))));
test('image went with the first turn', () => check(lab.turns[0].image && lab.turns[0].image.width === 640));

// 3. detect: whatever boxes the reply holds become overlay tags
setValue('#sample', 'objects');
test('new image: meta + boxes cleared', () => check(/desk/.test(text('#image-meta')) && lab.ui.stage.shown.length === 0));
setValue('#max-tokens', '256');
n = lab.replies;
clickOn('#quick button:nth-child(2)');
answered(n);
console.log('detect reply: ' + lab.reply.slice(0, 300).replace(/\n/g, ' '));
test('boxes parsed from the reply = tags = overlay', () => {
    eq(lab.boxes.length, parseBoxes(lab.reply).length);
    eq(lab.ui.stage.shown.length, lab.boxes.length);
    if (lab.boxes.length) eq(document.querySelectorAll('#tags .tag').length, lab.boxes.length);
});
test('the new image rode this turn', () => eq(lab.turns.filter((t) => t.image).length, 2));
shot('detect');

// 4. follow-up: no image resend
n = lab.replies;
q('#prompt').value = 'Answer in one short sentence: what is the largest object?';
clickOn('#btn-send');
answered(n);
test('follow-up turn has no image', () => check(!lab.turns[lab.turns.length - 2].image && lab.turns.length === 6));

// 5. stop settles
setValue('#max-tokens', '1024');
n = lab.replies;
q('#prompt').value = 'Write a very long, detailed story about this image.';
clickOn('#btn-send');
waitFor(() => document.querySelector('#chat .chat-row.agent.streaming'), 'streaming', 120000);
clickOn('#btn-stop');
waitFor(() => lab.replies > n, 'stop', 120000);
test('stopped', () => check(/stopped|done/.test(text('#status')) && !lab.running && !q('#btn-send').disabled));

// 6. clear chat
clickOn('#btn-clear');
test('clear chat', () => check(lab.turns.length === 0 && !document.querySelector('#chat .chat-row')));

// 7. CLIP captions
if (findWeights(CLIP, { probe: 'model.safetensors' }) && findWeights(CLIP_TOK, { probe: 'vocab.json' })) {
    setValue('#family', 'clip');
    waitFor(() => lab.model || lab.error, 'CLIP load', 300000);
    check(!lab.error, lab.error);
    n = lab.replies;
    clickOn('#quick button[data-clip]');
    answered(n);
    test('CLIP: a scored row per caption, best first', () => {
        eq(document.querySelectorAll('#chat .clip-scores tr').length, 4);
        check(lab.scores[0].score >= lab.scores[3].score);
        for (const s of lab.scores) check(s.score >= -1 && s.score <= 1, 'cosine range');
    });
    shot('clip');
} else console.log('CLIP weights absent: CLIP family not exercised');

// 8. Qwen3.5
if (findWeights(QWEN35, { probe: 'config.json' })) {
    setValue('#family', 'qwen35');
    waitFor(() => lab.model || lab.error, 'Qwen3.5 load', 300000);
    check(!lab.error, lab.error);
    setValue('#max-tokens', '64');
    n = lab.replies;
    clickOn('#quick button:nth-child(1)');
    answered(n);
    test('Qwen3.5 replied', () => check(q('#chat .chat-row.agent') && lab.turns.length === 2));
} else console.log('Qwen3.5 weights absent: family not exercised');

done('vlm-lab');
