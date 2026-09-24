// Reader without TTS: text segmentation + import stripping, the library
// (inject, drag-drop, cards, two-click delete), the settings dialog and the
// light theme. Playback lives in test_tts.js (ml).
// Run: scripts/validate.sh tools/reader

import { check, eq, test, done, frames, clickOn, setValue, text, q, shot } from "/lib/kit/test.js";
import { segment, splitSentences, stripMarkdown, stripHtml } from "/app/lib/text.js";
import { library, loadLibrary, addDocument, LIBRARY_KEY } from "/app/lib/docs.js";
import { prefs, settings } from "/app/lib/state.js";
import { renderLibrary } from "/app/lib/library.js";

const fs = require('fs');
const savedLibrary = localStorage.getItem(LIBRARY_KEY);
const savedPrefs = prefs.snapshot();
const tmp = require('os').tmpdir().replace(/\\/g, '/') + '/bro-reader-test';

try {
    test('sentence split handles abbreviations and initials', () => {
        eq(splitSentences('He arrived at 3 p.m. yesterday. Dr. Smith met J. R. Tolkien. Done!').length, 3, 'count');
        eq(splitSentences('Is it real? Yes… absolutely. "Fine." she said.').length, 3, 'terminators');
    });

    test('markdown and html strip to readable prose', () => {
        const md = stripMarkdown('# Title\n\nSome *emphasized* text with [a link](http://x.y).\n\n- item one\n- item two\n\n```js\ncode();\n```\n\nThe end.');
        check(!/[#*]/.test(md) && md.indexOf('code()') < 0 && md.indexOf('a link') >= 0, 'markdown: ' + JSON.stringify(md));
        const ht = stripHtml('<html><head><style>b{}</style></head><body><h1>Hi</h1><p>One &amp; two.</p><script>x()</script></body></html>');
        check(ht.indexOf('One & two.') >= 0 && ht.indexOf('x()') < 0 && ht.indexOf('<') < 0, 'html: ' + JSON.stringify(ht));
        const s = segment('One. Two.\n\nThree.');
        eq([s.paragraphs.length, s.sentences.length, s.sentences[2].para], [2, 3, 1], 'segment');
    });

    localStorage.setItem(LIBRARY_KEY, '[]');
    loadLibrary();
    renderLibrary();

    test('empty library shows the hint', () => {
        check(!q('#lib-empty').hidden, 'empty hint visible');
        eq(q('#doc-grid').children.length, 0, 'no cards');
    });

    test('added documents render as cards with progress', () => {
        const d = addDocument('The Lighthouse', 'The keeper woke. Fog settled.\n\nHe climbed the stairs.');
        d.pos = 1;
        renderLibrary();
        frames(2);
        check(q('#lib-empty').hidden, 'empty hint hidden');
        eq(q('#doc-grid').children.length, 1, 'one card');
        eq(text('.card-title'), 'The Lighthouse', 'title');
        check(/3 sentences/.test(text('.card-meta')), 'meta: ' + text('.card-meta'));
        eq(text('.card .open'), '▶ Continue · 33%', 'resume button');
    });

    test('dropping a markdown file imports it stripped', () => {
        fs.mkdirSync(tmp, { recursive: true });
        const p = tmp + '/_dropped.md';
        fs.writeFileSync(p, '# Dropped Note\n\nThis arrived by *drag and drop*. It has a second sentence.\n');
        dropFiles(600, 400, [p]);
        frames(2);
        eq(library.length, 2, 'library size');
        eq(library[0].title, 'Dropped Note', 'title from the heading');
        check(!/[#*]/.test(library[0].text), 'markdown stripped');
        eq(q('#doc-grid').children.length, 2, 'cards');
        check(/imported Dropped Note/.test(text('#status')), 'status: ' + text('#status'));
        check(q('#drop-overlay').hidden, 'overlay hidden after drop');
        fs.unlinkSync(p);
    });

    test('unsupported files are reported, not imported', () => {
        const p = tmp + '/_nope.pdf';
        fs.writeFileSync(p, 'x');
        dropFiles(600, 400, [p]);
        frames(2);
        eq(library.length, 2, 'library size');
        check(/unsupported file type/.test(text('#status')), 'status: ' + text('#status'));
        fs.unlinkSync(p);
    });

    shot('library');

    test('delete takes two clicks', () => {
        const sel = '.card[data-id="' + library[0].id + '"] button.danger';
        clickOn(sel);
        eq(text(sel), 'remove?', 'armed');
        eq(library.length, 2, 'still there');
        clickOn(sel);
        eq(library.length, 1, 'removed');
        eq(JSON.parse(localStorage.getItem(LIBRARY_KEY)).length, 1, 'persisted');
    });

    test('settings dialog edits and persists defaults', () => {
        clickOn('#btn-settings');
        check(!q('#settings-modal').hidden, 'dialog open');
        check(/kokoro: .*kokoro/.test(text('#set-paths')), 'paths: ' + text('#set-paths'));
        setValue('#set-fontsize', '24');
        eq(text('#set-fontsize-val'), '24px', 'size readout');
        eq(settings.fontSize, 24, 'size saved');
        setValue('#set-theme', 'light');
        check(document.body.classList.contains('light'), 'light theme');
        eq(JSON.parse(prefs.snapshot()).theme, 'light', 'theme persisted');
        shot('settings-light');
        clickOn('#btn-settings-close');
        check(q('#settings-modal').hidden, 'dialog closed');
        shot('library-light');
        setValue('#set-theme', 'dark');
        check(!document.body.classList.contains('light'), 'dark again');
    });
} finally {
    if (savedLibrary == null) localStorage.removeItem(LIBRARY_KEY); else localStorage.setItem(LIBRARY_KEY, savedLibrary);
    prefs.restore(savedPrefs);
}
done('reader library');
