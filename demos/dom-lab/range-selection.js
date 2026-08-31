// demos/dom-lab/range-selection.js

export class RangeSelectionLab {
    constructor(articleElement, onRangeChange) {
        this.article = articleElement;
        this.onRangeChange = onRangeChange;
        this.currentRange = null;

        this.init();
    }

    init() {
        this.selectDefaultRange();
    }

    selectDefaultRange() {
        const p1 = document.getElementById('p1');
        if (!p1) return;

        const range = document.createRange();
        // Select from first child text node to strong tag
        if (p1.firstChild) {
            range.setStart(p1.firstChild, 4);
            range.setEnd(p1.childNodes[1] || p1.firstChild, 2);
        }

        this.currentRange = range;
        this.notify();
    }

    surroundWithMark() {
        if (!this.currentRange || this.currentRange.collapsed) return;

        try {
            const mark = document.createElement('mark');
            this.currentRange.surroundContents(mark);
            this.notify();
        } catch (e) {
            console.warn('surroundContents error (non-contiguous boundary):', e);
        }
    }

    collapseToStart() {
        if (!this.currentRange) return;
        this.currentRange.collapse(true);
        this.notify();
    }

    notify() {
        if (this.onRangeChange && this.currentRange) {
            this.onRangeChange({
                startContainerName: this.currentRange.startContainer ? (this.currentRange.startContainer.nodeName || 'text') : 'null',
                startOffset: this.currentRange.startOffset,
                endContainerName: this.currentRange.endContainer ? (this.currentRange.endContainer.nodeName || 'text') : 'null',
                endOffset: this.currentRange.endOffset,
                collapsed: this.currentRange.collapsed
            });
        }
    }
}
