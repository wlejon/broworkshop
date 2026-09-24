// editor.js — the Markdown textarea: line-number gutter, undo/redo history,
// formatting helpers, Tab indent, stats, and the live preview (lib/markdown.js
// with tables, task lists and callouts; preview checkboxes toggle the source).

import { renderMarkdown } from "/lib/markdown.js";

const MD_OPTS = { tables: true, tasks: true, alerts: true };
const HISTORY_MAX = 50;
// A task line, optionally inside blockquotes: the same lines the preview numbers.
const TASK_LINE = /^((?:\s*>)*\s*[-*+]\s+\[)([ xX])(\]\s+.*)$/gm;

export class NoteEditor {
    /** els: { textarea, gutter, preview }; onChange(content) after every edit. */
    constructor(els, onChange) {
        this.ta = els.textarea;
        this.gutter = els.gutter;
        this.preview = els.preview;
        this.onChange = onChange || (() => {});
        this.history = [''];
        this.index = 0;

        this.ta.addEventListener('input', () => this.changed());
        this.ta.addEventListener('scroll', () => { this.gutter.scrollTop = this.ta.scrollTop; });
        this.ta.addEventListener('keydown', (e) => this.onKey(e));
        this.preview.addEventListener('change', (e) => {
            const box = e.target;
            if (box && box.classList && box.classList.contains('md-task-box')) {
                this.setTask(parseInt(box.dataset.taskIndex, 10), box.checked);
            }
        });
    }

    onKey(e) {
        const mod = e.ctrlKey || e.metaKey, k = (e.key || '').toLowerCase();
        if (e.key === 'Tab') { e.preventDefault(); if (e.shiftKey) this.outdent(); else this.indent(); }
        else if (mod && k === 'z') { e.preventDefault(); if (e.shiftKey) this.redo(); else this.undo(); }
        else if (mod && k === 'y') { e.preventDefault(); this.redo(); }
    }

    get value() { return this.ta.value; }

    /** Load a note: resets history, no onChange. */
    setValue(content) {
        this.ta.value = content || '';
        this.history = [this.ta.value];
        this.index = 0;
        this.refresh();
    }

    /** Re-render the gutter and the preview from the textarea. */
    refresh() {
        const n = Math.max(1, this.ta.value.split('\n').length);
        let html = '';
        for (let i = 1; i <= n; i++) html += '<div>' + i + '</div>';
        this.gutter.innerHTML = html;
        this.preview.innerHTML = this.ta.value
            ? renderMarkdown(this.ta.value, MD_OPTS)
            : '<div class="preview-empty">Start typing to see the live preview…</div>';
    }

    /** After any edit: refresh, record history, tell the app. */
    changed(record = true) {
        this.refresh();
        if (record) this.record();
        this.onChange(this.ta.value);
    }

    /** Replace the whole text as one undoable edit. */
    replaceAll(text) {
        this.ta.value = text;
        this.changed();
    }

    stats() {
        const text = this.ta.value;
        const words = text.trim() ? text.trim().split(/\s+/).length : 0;
        const caret = this.ta.selectionStart || 0;
        const before = text.slice(0, caret);
        return {
            chars: text.length, words, lines: text.split('\n').length,
            readingTimeMins: Math.max(1, Math.ceil(words / 200)),
            curLine: before.split('\n').length, curCol: caret - before.lastIndexOf('\n'),
        };
    }

    // ── formatting ───────────────────────────────────────────────────────────

    /**
     * Replace [start, end) with `text`; mode 'select' selects the new text,
     * 'end' puts the caret after it. (setRangeText's contract; bro's textarea
     * has no setRangeText, see ENGINE-ISSUES.md.)
     */
    splice(text, start, end, mode) {
        const v = this.ta.value;
        this.ta.value = v.slice(0, start) + text + v.slice(end);
        this.ta.setSelectionRange(mode === 'select' ? start : start + text.length, start + text.length);
    }

    /** Wrap the selection (or `placeholder`) in prefix/suffix and select the inner text. */
    wrap(prefix, suffix, placeholder) {
        const s = this.ta.selectionStart, e = this.ta.selectionEnd;
        const inner = this.ta.value.slice(s, e) || placeholder || 'text';
        this.splice(prefix + inner + suffix, s, e, 'select');
        this.ta.setSelectionRange(s + prefix.length, s + prefix.length + inner.length);
        this.ta.focus();
        this.changed();
    }

    /** Insert a block at the caret, on its own line. */
    insertBlock(template) {
        const s = this.ta.selectionStart, e = this.ta.selectionEnd;
        const lead = s > 0 && this.ta.value[s - 1] !== '\n' ? '\n' : '';
        this.splice(lead + template, s, e, 'end');
        this.ta.focus();
        this.changed();
    }

    /** Prefix the caret's line with a level-N heading marker. */
    heading(level) {
        const s = this.ta.selectionStart;
        const lineStart = this.ta.value.lastIndexOf('\n', s - 1) + 1;
        this.splice('#'.repeat(level) + ' ', lineStart, lineStart, 'end');
        this.ta.focus();
        this.changed();
    }

    /** The whole lines the selection touches: { start, end, lines }. */
    selectedLines() {
        const text = this.ta.value, s = this.ta.selectionStart, e = this.ta.selectionEnd;
        const start = text.lastIndexOf('\n', s - 1) + 1;
        const nl = text.indexOf('\n', e);
        const end = nl < 0 ? text.length : nl;
        return { start, end, lines: text.slice(start, end).split('\n') };
    }

    indent() {
        const s = this.ta.selectionStart;        if (s === this.ta.selectionEnd) this.splice('  ', s, s, 'end');
        else {
            const b = this.selectedLines();
            this.splice(b.lines.map((l) => '  ' + l).join('\n'), b.start, b.end, 'select');
        }
        this.changed();
    }

    outdent() {
        const b = this.selectedLines();
        this.splice(b.lines.map((l) => l.replace(/^ {1,2}/, '')).join('\n'), b.start, b.end, 'select');
        this.changed();
    }

    /** Check or uncheck the index-th task line of the source. */
    setTask(index, checked) {
        let n = 0;
        const text = this.ta.value.replace(TASK_LINE, (m, a, mark, b) => (n++ === index ? a + (checked ? 'x' : ' ') + b : m));
        if (text !== this.ta.value) this.replaceAll(text);
    }

    // ── history ──────────────────────────────────────────────────────────────

    record() {
        if (this.history[this.index] === this.ta.value) return;
        this.history = this.history.slice(0, this.index + 1);
        this.history.push(this.ta.value);
        if (this.history.length > HISTORY_MAX) this.history.shift();
        this.index = this.history.length - 1;
    }

    undo() { if (this.index > 0) this.restore(--this.index); }
    redo() { if (this.index < this.history.length - 1) this.restore(++this.index); }
    restore(i) {
        this.ta.value = this.history[i];
        this.changed(false);
    }
}
