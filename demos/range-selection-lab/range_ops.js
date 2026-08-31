// range_ops.js — Deep Range & Selection operations, caret tracking, and DOM mutations.

export class RangeOps {
    constructor(editorElement, onMetricsChange) {
        this.editor = editorElement;
        this.onMetricsChange = onMetricsChange || (() => {});
        this.lastExtractedFragment = null;
        this.lastClonedFragment = null;
        this._bindEvents();
    }

    _bindEvents() {
        document.addEventListener('selectionchange', () => {
            if (this.isEditorFocused() || this.isSelectionInsideEditor()) {
                this.notify();
            }
        });

        this.editor.addEventListener('input', () => this.notify());
        this.editor.addEventListener('keyup', () => this.notify());
        this.editor.addEventListener('mouseup', () => this.notify());
    }

    isEditorFocused() {
        return document.activeElement === this.editor || this.editor.contains(document.activeElement);
    }

    isSelectionInsideEditor() {
        const sel = window.getSelection();
        if (!sel || sel.rangeCount === 0) return false;
        const anchor = sel.anchorNode;
        const focus = sel.focusNode;
        return (anchor && this.editor.contains(anchor)) || (focus && this.editor.contains(focus));
    }

    getSelection() {
        return window.getSelection();
    }

    getRange() {
        const sel = this.getSelection();
        if (!sel || sel.rangeCount === 0) return null;
        return sel.getRangeAt(0);
    }

    /**
     * Determines whether the selection direction is forward or backward.
     */
    getSelectionDirection() {
        const sel = this.getSelection();
        if (!sel || sel.isCollapsed || !sel.anchorNode || !sel.focusNode) return 'none';

        const range = document.createRange();
        range.setStart(sel.anchorNode, sel.anchorOffset);
        range.setEnd(sel.focusNode, sel.focusOffset);

        return range.collapsed ? 'backward' : 'forward';
    }

    /**
     * Extracts full diagnostic metrics for Range and Selection.
     */
    getMetrics() {
        const sel = this.getSelection();
        const range = this.getRange();

        if (!sel || !range) {
            return {
                hasSelection: false,
                selection: null,
                range: null,
                caret: null
            };
        }

        const dir = this.getSelectionDirection();
        const startContainer = range.startContainer;
        const endContainer = range.endContainer;
        const commonAncestor = range.commonAncestorContainer;

        const startNodeName = startContainer.nodeType === Node.TEXT_NODE
            ? `#text "${startContainer.textContent.slice(0, 15)}..."`
            : `<${startContainer.nodeName.toLowerCase()}>`;

        const endNodeName = endContainer.nodeType === Node.TEXT_NODE
            ? `#text "${endContainer.textContent.slice(0, 15)}..."`
            : `<${endContainer.nodeName.toLowerCase()}>`;

        const ancestorName = commonAncestor.nodeType === Node.TEXT_NODE
            ? `#text in <${commonAncestor.parentNode ? commonAncestor.parentNode.nodeName.toLowerCase() : 'root'}>`
            : `<${commonAncestor.nodeName.toLowerCase()}>`;

        const rects = Array.from(range.getClientRects()).map(r => ({
            x: Math.round(r.x),
            y: Math.round(r.y),
            width: Math.round(r.width),
            height: Math.round(r.height)
        }));

        const bounding = range.getBoundingClientRect();
        const caret = this.getCaretPixelPosition();

        let fragmentHtml = '';
        try {
            const clone = range.cloneContents();
            const div = document.createElement('div');
            div.appendChild(clone);
            fragmentHtml = div.innerHTML;
        } catch (e) {
            fragmentHtml = `(unavailable: ${e.message})`;
        }

        return {
            hasSelection: true,
            selection: {
                anchorNode: sel.anchorNode ? sel.anchorNode.nodeName : 'null',
                anchorOffset: sel.anchorOffset,
                focusNode: sel.focusNode ? sel.focusNode.nodeName : 'null',
                focusOffset: sel.focusOffset,
                isCollapsed: sel.isCollapsed,
                type: sel.type,
                rangeCount: sel.rangeCount,
                direction: dir
            },
            range: {
                startContainerName: startNodeName,
                startOffset: range.startOffset,
                endContainerName: endNodeName,
                endOffset: range.endOffset,
                commonAncestor: ancestorName,
                collapsed: range.collapsed,
                textLength: range.toString().length,
                textSnippet: range.toString(),
                clientRectsCount: rects.length,
                rects: rects,
                boundingRect: {
                    x: Math.round(bounding.x),
                    y: Math.round(bounding.y),
                    width: Math.round(bounding.width),
                    height: Math.round(bounding.height)
                },
                htmlPreview: fragmentHtml
            },
            caret: caret
        };
    }

    /**
     * Returns exact (X, Y) pixel coordinates of the caret or active range start.
     */
    getCaretPixelPosition() {
        const sel = this.getSelection();
        if (!sel || sel.rangeCount === 0) return null;

        const range = sel.getRangeAt(0).cloneRange();
        let rect = null;

        if (range.getClientRects) {
            const rects = range.getClientRects();
            if (rects.length > 0) {
                rect = rects[0];
            }
        }

        if (!rect) {
            rect = range.getBoundingClientRect();
        }

        if ((!rect || (rect.x === 0 && rect.y === 0 && rect.width === 0)) && range.startContainer) {
            // Fallback: insert temporary dummy span to measure caret
            const span = document.createElement('span');
            span.appendChild(document.createTextNode('\u200b'));
            try {
                const tempRange = range.cloneRange();
                tempRange.insertNode(span);
                rect = span.getBoundingClientRect();
                if (span.parentNode) span.parentNode.removeChild(span);
            } catch (e) {
                // Ignore fallback failure
            }
        }

        if (!rect) return null;

        const editorRect = this.editor.getBoundingClientRect();
        return {
            viewportX: Math.round(rect.left),
            viewportY: Math.round(rect.top),
            editorRelativeX: Math.round(rect.left - editorRect.left),
            editorRelativeY: Math.round(rect.top - editorRect.top),
            height: Math.round(rect.height || 18)
        };
    }

    notify() {
        const metrics = this.getMetrics();
        this.onMetricsChange(metrics);
    }

    // ── Content Manipulation via Range APIs ───────────────────────────────────

    /**
     * Surrounds selection with specified tag and class.
     * Uses surroundContents when possible; falls back to extract+wrap when non-contiguous.
     */
    surroundSelection(tagName = 'mark', className = '', attributes = {}) {
        const range = this.getRange();
        if (!range || range.collapsed) return false;

        try {
            const elem = document.createElement(tagName);
            if (className) elem.className = className;
            for (const [k, v] of Object.entries(attributes)) {
                elem.setAttribute(k, v);
            }

            range.surroundContents(elem);
            this.notify();
            return true;
        } catch (err) {
            // surroundContents throws if range splits a non-text element.
            // Fallback gracefully via extractContents:
            try {
                const elem = document.createElement(tagName);
                if (className) elem.className = className;
                for (const [k, v] of Object.entries(attributes)) {
                    elem.setAttribute(k, v);
                }
                const fragment = range.extractContents();
                elem.appendChild(fragment);
                range.insertNode(elem);
                this.notify();
                return true;
            } catch (innerErr) {
                console.error('Failed to surround contents:', innerErr);
                return false;
            }
        }
    }

    /**
     * Extracts selected range into DocumentFragment and stores for inspection.
     */
    extractSelection() {
        const range = this.getRange();
        if (!range || range.collapsed) return null;

        const fragment = range.extractContents();
        this.lastExtractedFragment = fragment;

        const div = document.createElement('div');
        div.appendChild(fragment.cloneNode(true));
        const html = div.innerHTML;

        this.notify();
        return { fragment, html };
    }

    /**
     * Clones selected range into DocumentFragment without removing it.
     */
    cloneSelection() {
        const range = this.getRange();
        if (!range) return null;

        const fragment = range.cloneContents();
        this.lastClonedFragment = fragment;

        const div = document.createElement('div');
        div.appendChild(fragment.cloneNode(true));
        const html = div.innerHTML;

        this.notify();
        return { fragment, html };
    }

    /**
     * Inserts an arbitrary DOM Node at the current range/caret.
     */
    insertNode(node) {
        const range = this.getRange();
        if (!range) return false;

        range.deleteContents();
        range.insertNode(node);

        // Move caret after inserted node
        range.setStartAfter(node);
        range.collapse(true);
        const sel = this.getSelection();
        sel.removeAllRanges();
        sel.addRange(range);

        this.notify();
        return true;
    }

    /**
     * Inserts HTML snippet at caret using DOMParser.
     */
    insertHtml(htmlString) {
        const parser = new DOMParser();
        const doc = parser.parseFromString(htmlString, 'text/html');
        const fragment = document.createDocumentFragment();

        while (doc.body.firstChild) {
            fragment.appendChild(doc.body.firstChild);
        }

        const lastNode = fragment.lastChild;
        const range = this.getRange();
        if (!range) return false;

        range.deleteContents();
        range.insertNode(fragment);

        if (lastNode) {
            range.setStartAfter(lastNode);
            range.collapse(true);
            const sel = this.getSelection();
            sel.removeAllRanges();
            sel.addRange(range);
        }

        this.notify();
        return true;
    }

    /**
     * Deletes contents of current selection.
     */
    deleteContents() {
        const range = this.getRange();
        if (!range) return false;

        range.deleteContents();
        this.notify();
        return true;
    }

    /**
     * Collapses current range to start or end.
     */
    collapse(toStart = true) {
        const range = this.getRange();
        if (!range) return;

        range.collapse(toStart);
        const sel = this.getSelection();
        sel.removeAllRanges();
        sel.addRange(range);
        this.notify();
    }

    // ── Semantic Range Selectors ──────────────────────────────────────────────

    selectSentence() {
        const sel = this.getSelection();
        if (!sel || !this.isSelectionInsideEditor()) return;

        const anchor = sel.anchorNode;
        if (!anchor) return;

        const textNode = anchor.nodeType === Node.TEXT_NODE ? anchor : anchor.firstChild;
        if (!textNode || textNode.nodeType !== Node.TEXT_NODE) return;

        const text = textNode.textContent;
        const offset = Math.min(sel.anchorOffset, text.length);

        // Find sentence boundaries: period, exclamation, question mark, or start/end of string
        let start = 0;
        let end = text.length;

        for (let i = offset - 1; i >= 0; i--) {
            if (/[.!?\n]/.test(text[i])) {
                start = i + 1;
                while (start < text.length && /\s/.test(text[start])) start++;
                break;
            }
        }

        for (let i = offset; i < text.length; i++) {
            if (/[.!?\n]/.test(text[i])) {
                end = i + 1;
                break;
            }
        }

        const range = document.createRange();
        range.setStart(textNode, start);
        range.setEnd(textNode, end);

        sel.removeAllRanges();
        sel.addRange(range);
        this.notify();
    }

    selectParagraph() {
        const sel = this.getSelection();
        if (!sel || !this.isSelectionInsideEditor()) return;

        let node = sel.anchorNode;
        while (node && node !== this.editor) {
            if (['P', 'DIV', 'H1', 'H2', 'H3', 'BLOCKQUOTE', 'LI', 'PRE'].includes(node.nodeName)) {
                const range = document.createRange();
                range.selectNodeContents(node);
                sel.removeAllRanges();
                sel.addRange(range);
                this.notify();
                return;
            }
            node = node.parentNode;
        }
    }

    selectAll() {
        const range = document.createRange();
        range.selectNodeContents(this.editor);
        const sel = this.getSelection();
        sel.removeAllRanges();
        sel.addRange(range);
        this.notify();
    }

    /**
     * Programmatically sets range start/end containers and offsets.
     */
    setRange(startNode, startOffset, endNode, endOffset) {
        try {
            const range = document.createRange();
            range.setStart(startNode, startOffset);
            range.setEnd(endNode, endOffset);

            const sel = this.getSelection();
            sel.removeAllRanges();
            sel.addRange(range);
            this.notify();
            return true;
        } catch (e) {
            console.error('setRange failed:', e);
            return false;
        }
    }
}
