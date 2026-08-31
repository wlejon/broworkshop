// editor.js — Text editing, syntax formatting, synchronized line numbers, and rich Markdown rendering.

export class NotebookEditor {
    constructor(elements, onDocChangeCallback) {
        this.textarea = elements.textarea;
        this.gutter = elements.gutter;
        this.preview = elements.preview;
        this.onDocChange = onDocChangeCallback || (() => {});

        this.history = [];
        this.historyIndex = -1;
        this.isComposing = false;
        this.suppressHistory = false;

        this._bindEvents();
    }

    _bindEvents() {
        if (!this.textarea) return;

        // Input & Typing
        this.textarea.addEventListener('input', () => {
            this.updateLineNumbers();
            this.renderPreview();
            this.recordHistory();
            this.onDocChange(this.getValue());
        });

        // Synchronize Gutter Scroll
        this.textarea.addEventListener('scroll', () => {
            if (this.gutter) {
                this.gutter.scrollTop = this.textarea.scrollTop;
            }
        });

        // Tab and Keyboard shortcuts
        this.textarea.addEventListener('keydown', (e) => {
            if (e.key === 'Tab') {
                e.preventDefault();
                if (e.shiftKey) {
                    this.outdentSelection();
                } else {
                    this.indentSelection();
                }
            } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
                e.preventDefault();
                if (e.shiftKey) {
                    this.redo();
                } else {
                    this.undo();
                }
            } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') {
                e.preventDefault();
                this.redo();
            }
        });

        // Task checkbox toggle in preview
        if (this.preview) {
            this.preview.addEventListener('change', (e) => {
                if (e.target && e.target.classList.contains('task-checkbox')) {
                    const taskIndex = parseInt(e.target.dataset.taskIndex, 10);
                    this.toggleTaskCheckbox(taskIndex, e.target.checked);
                }
            });
        }
    }

    setValue(content) {
        this.suppressHistory = true;
        this.textarea.value = content || '';
        this.history = [this.textarea.value];
        this.historyIndex = 0;
        this.suppressHistory = false;

        this.updateLineNumbers();
        this.renderPreview();
    }

    getValue() {
        return this.textarea.value;
    }

    updateLineNumbers() {
        if (!this.gutter) return;

        const lines = this.textarea.value.split('\n');
        const count = Math.max(1, lines.length);

        let gutterHtml = '';
        for (let i = 1; i <= count; i++) {
            gutterHtml += `<div>${i}</div>`;
        }

        this.gutter.innerHTML = gutterHtml;
    }

    getStats() {
        const text = this.textarea.value;
        const chars = text.length;
        const words = text.trim() ? text.trim().split(/\s+/).length : 0;
        const lines = text.split('\n').length;
        const readingTimeMins = Math.max(1, Math.ceil(words / 200));

        const start = this.textarea.selectionStart || 0;
        const preCaret = text.slice(0, start);
        const curLine = preCaret.split('\n').length;
        const curCol = start - preCaret.lastIndexOf('\n');

        return {
            chars,
            words,
            lines,
            readingTimeMins,
            curLine,
            curCol
        };
    }

    // ── Formatting Shortcuts ──────────────────────────────────────────────────

    wrapSelection(prefix, suffix = prefix, defaultText = 'text') {
        const start = this.textarea.selectionStart;
        const end = this.textarea.selectionEnd;
        const text = this.textarea.value;
        const selected = text.slice(start, end) || defaultText;

        const replacement = `${prefix}${selected}${suffix}`;
        this.textarea.setRangeText(replacement, start, end, 'select');

        // Focus & select wrapped text
        this.textarea.selectionStart = start + prefix.length;
        this.textarea.selectionEnd = start + prefix.length + selected.length;
        this.textarea.focus();

        this.updateLineNumbers();
        this.renderPreview();
        this.recordHistory();
        this.onDocChange(this.getValue());
    }

    insertBlock(template) {
        const start = this.textarea.selectionStart;
        const end = this.textarea.selectionEnd;
        const text = this.textarea.value;

        // Ensure prefix newline if not at start of line
        let insertion = template;
        if (start > 0 && text[start - 1] !== '\n') {
            insertion = '\n' + insertion;
        }

        this.textarea.setRangeText(insertion, start, end, 'end');
        this.textarea.focus();

        this.updateLineNumbers();
        this.renderPreview();
        this.recordHistory();
        this.onDocChange(this.getValue());
    }

    insertHeading(level = 2) {
        const start = this.textarea.selectionStart;
        const text = this.textarea.value;
        const lineStart = text.lastIndexOf('\n', start - 1) + 1;
        const prefix = '#'.repeat(level) + ' ';

        this.textarea.selectionStart = lineStart;
        this.textarea.selectionEnd = lineStart;
        this.textarea.setRangeText(prefix, lineStart, lineStart, 'end');
        this.textarea.focus();

        this.updateLineNumbers();
        this.renderPreview();
        this.recordHistory();
        this.onDocChange(this.getValue());
    }

    indentSelection() {
        const start = this.textarea.selectionStart;
        const end = this.textarea.selectionEnd;
        const text = this.textarea.value;

        if (start === end) {
            this.textarea.setRangeText('  ', start, start, 'end');
        } else {
            const lineStart = text.lastIndexOf('\n', start - 1) + 1;
            const lineEnd = text.indexOf('\n', end);
            const blockEnd = lineEnd === -1 ? text.length : lineEnd;
            const selectedLines = text.slice(lineStart, blockEnd).split('\n');

            const indented = selectedLines.map(l => '  ' + l).join('\n');
            this.textarea.setRangeText(indented, lineStart, blockEnd, 'select');
        }

        this.updateLineNumbers();
        this.renderPreview();
        this.recordHistory();
        this.onDocChange(this.getValue());
    }

    outdentSelection() {
        const start = this.textarea.selectionStart;
        const end = this.textarea.selectionEnd;
        const text = this.textarea.value;

        const lineStart = text.lastIndexOf('\n', start - 1) + 1;
        const lineEnd = text.indexOf('\n', end);
        const blockEnd = lineEnd === -1 ? text.length : lineEnd;
        const selectedLines = text.slice(lineStart, blockEnd).split('\n');

        const outdented = selectedLines.map(l => l.replace(/^ {1,2}/, '')).join('\n');
        this.textarea.setRangeText(outdented, lineStart, blockEnd, 'select');

        this.updateLineNumbers();
        this.renderPreview();
        this.recordHistory();
        this.onDocChange(this.getValue());
    }

    // ── History (Undo / Redo) ─────────────────────────────────────────────────

    recordHistory() {
        if (this.suppressHistory) return;
        const current = this.textarea.value;
        if (this.historyIndex >= 0 && this.history[this.historyIndex] === current) return;

        // Truncate future history if branched
        this.history = this.history.slice(0, this.historyIndex + 1);
        this.history.push(current);
        if (this.history.length > 50) this.history.shift();
        this.historyIndex = this.history.length - 1;
    }

    undo() {
        if (this.historyIndex > 0) {
            this.historyIndex--;
            this.suppressHistory = true;
            this.textarea.value = this.history[this.historyIndex];
            this.suppressHistory = false;
            this.updateLineNumbers();
            this.renderPreview();
            this.onDocChange(this.getValue());
        }
    }

    redo() {
        if (this.historyIndex < this.history.length - 1) {
            this.historyIndex++;
            this.suppressHistory = true;
            this.textarea.value = this.history[this.historyIndex];
            this.suppressHistory = false;
            this.updateLineNumbers();
            this.renderPreview();
            this.onDocChange(this.getValue());
        }
    }

    // ── Interactive Task List Support ─────────────────────────────────────────

    toggleTaskCheckbox(taskIndex, isChecked) {
        const text = this.textarea.value;
        const taskRegex = /^(\s*[-*+]\s+\[)([ xX])(\]\s+.*)$/gm;
        let match;
        let count = 0;

        while ((match = taskRegex.exec(text)) !== null) {
            if (count === taskIndex) {
                const mark = isChecked ? 'x' : ' ';
                const newText = text.slice(0, match.index) +
                    match[1] + mark + match[3] +
                    text.slice(match.index + match[0].length);

                this.setValue(newText);
                this.recordHistory();
                this.onDocChange(this.getValue());
                break;
            }
            count++;
        }
    }

    // ── Enhanced Markdown Renderer ────────────────────────────────────────────

    renderPreview() {
        if (!this.preview) return;
        const raw = this.textarea.value;
        this.preview.innerHTML = this.parseMarkdown(raw);
    }

    parseMarkdown(src) {
        if (!src) return '<div class="preview-empty">Start typing to see live preview...</div>';

        const lines = String(src).split(/\r?\n/);
        const out = [];
        let i = 0;
        let taskCounter = 0;

        while (i < lines.length) {
            const line = lines[i];

            // 1. Fenced Code Block
            const fenceMatch = line.match(/^(\s*)(```+|~~~+)(.*)$/);
            if (fenceMatch) {
                const lang = (fenceMatch[3] || '').trim();
                const codeLines = [];
                i++;
                while (i < lines.length && !lines[i].startsWith(fenceMatch[2])) {
                    codeLines.push(this.escapeHtml(lines[i]));
                    i++;
                }
                i++; // skip closing fence
                out.push(`<pre class="md-code-block" data-lang="${this.escapeHtml(lang)}"><code>${codeLines.join('\n')}</code></pre>`);
                continue;
            }

            // 2. Blank Line
            if (/^\s*$/.test(line)) {
                i++;
                continue;
            }

            // 3. Horizontal Rule
            if (/^\s*(---+|\*\*\*+|___+)\s*$/.test(line)) {
                out.push('<hr class="md-hr">');
                i++;
                continue;
            }

            // 4. Headings
            const hMatch = line.match(/^(#{1,6})\s+(.*)$/);
            if (hMatch) {
                const level = hMatch[1].length;
                out.push(`<h${level} class="md-h${level}">${this.inlineFormat(hMatch[2])}</h${level}>`);
                i++;
                continue;
            }

            // 5. Blockquote & Callouts
            if (/^\s*>\s?/.test(line)) {
                const bqLines = [];
                while (i < lines.length && /^\s*>\s?/.test(lines[i])) {
                    bqLines.push(lines[i].replace(/^\s*>\s?/, ''));
                    i++;
                }
                const bqContent = bqLines.join('\n');

                // Check GitHub Alert callout: [!NOTE], [!TIP], [!WARNING], [!IMPORTANT], [!CAUTION]
                const alertMatch = bqContent.match(/^\[!(NOTE|TIP|WARNING|IMPORTANT|CAUTION)\]\s*(.*)$/is);
                if (alertMatch) {
                    const alertType = alertMatch[1].toLowerCase();
                    const alertBody = alertMatch[2];
                    out.push(`
                        <div class="md-alert md-alert-${alertType}">
                            <div class="md-alert-title">${alertMatch[1]}</div>
                            <div class="md-alert-content">${this.parseMarkdown(alertBody)}</div>
                        </div>`);
                } else {
                    out.push(`<blockquote class="md-blockquote">${this.parseMarkdown(bqContent)}</blockquote>`);
                }
                continue;
            }

            // 6. Tables
            if (/^\s*\|(.+)\|/.test(line)) {
                const tableLines = [];
                while (i < lines.length && /^\s*\|(.+)\|/.test(lines[i])) {
                    tableLines.push(lines[i]);
                    i++;
                }
                out.push(this.renderTable(tableLines));
                continue;
            }

            // 7. Interactive Task List
            const taskMatch = line.match(/^(\s*)[-*+]\s+\[([ xX])\]\s+(.*)$/);
            if (taskMatch) {
                const isChecked = taskMatch[2].toLowerCase() === 'x';
                const taskText = taskMatch[3];
                const checkedAttr = isChecked ? 'checked' : '';
                const doneClass = isChecked ? 'task-done' : '';
                out.push(`
                    <div class="md-task-item ${doneClass}">
                        <input type="checkbox" class="task-checkbox" data-task-index="${taskCounter++}" ${checkedAttr}>
                        <span>${this.inlineFormat(taskText)}</span>
                    </div>`);
                i++;
                continue;
            }

            // 8. Ordered & Unordered Lists
            const isOrdered = /^\s*\d+[.)]\s+/.test(line);
            const isUnordered = /^\s*[-*+]\s+/.test(line);
            if (isOrdered || isUnordered) {
                const items = [];
                const tag = isOrdered ? 'ol' : 'ul';
                const pattern = isOrdered ? /^\s*\d+[.)]\s+(.*)$/ : /^\s*[-*+]\s+(.*)$/;

                while (i < lines.length) {
                    const m = lines[i].match(pattern);
                    if (!m) break;
                    items.push(`<li>${this.inlineFormat(m[1])}</li>`);
                    i++;
                }
                out.push(`<${tag} class="md-list">${items.join('')}</${tag}>`);
                continue;
            }

            // 9. Standard Paragraph
            const pBuf = [];
            while (i < lines.length && !/^\s*$/.test(lines[i]) && !this.isBlockStart(lines[i])) {
                pBuf.push(lines[i]);
                i++;
            }
            out.push(`<p class="md-paragraph">${this.inlineFormat(pBuf.join('\n'))}</p>`);
        }

        return out.join('\n');
    }

    isBlockStart(line) {
        return /^(\s*)(```+|~~~+)/.test(line) ||
               /^#{1,6}\s+/.test(line) ||
               /^\s*>\s?/.test(line) ||
               /^\s*\|(.+)\|/.test(line) ||
               /^\s*[-*+]\s+/.test(line) ||
               /^\s*\d+[.)]\s+/.test(line) ||
               /^\s*(---+|\*\*\*+|___+)\s*$/.test(line);
    }

    renderTable(tableLines) {
        if (tableLines.length < 2) return '';

        const splitRow = (row) => row.trim().replace(/^\||\|$/g, '').split('|').map(c => c.trim());
        const headers = splitRow(tableLines[0]);
        const isAlignRow = /^[\s|:-]+$/.test(tableLines[1]);
        const startRow = isAlignRow ? 2 : 1;

        let ths = headers.map(h => `<th>${this.inlineFormat(h)}</th>`).join('');
        let trs = '';

        for (let r = startRow; r < tableLines.length; r++) {
            const cells = splitRow(tableLines[r]);
            const tds = cells.map(c => `<td>${this.inlineFormat(c)}</td>`).join('');
            trs += `<tr>${tds}</tr>`;
        }

        return `
            <table class="md-table">
                <thead><tr>${ths}</tr></thead>
                <tbody>${trs}</tbody>
            </table>`;
    }

    inlineFormat(str) {
        let s = this.escapeHtml(str);

        // Inline code `code`
        s = s.replace(/`([^`]+)`/g, '<code class="md-inline-code">$1</code>');

        // Links [text](url)
        s = s.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener" class="md-link">$1</a>');

        // Bold & Italic
        s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
        s = s.replace(/__([^_]+)__/g, '<strong>$1</strong>');
        s = s.replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>');
        s = s.replace(/(^|[^_])_([^_\n]+)_/g, '$1<em>$2</em>');
        s = s.replace(/~~([^~]+)~~/g, '<del>$1</del>');

        // Line breaks
        s = s.replace(/\n/g, '<br>');

        return s;
    }

    escapeHtml(s) {
        return String(s || '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }
}
