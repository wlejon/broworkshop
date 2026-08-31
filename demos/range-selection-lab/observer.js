// observer.js — MutationObserver harness tracking characterData, childList, and attributes with visual diff logs.

export class MutationAuditor {
    constructor(targetElement, onMutationCallback) {
        this.target = targetElement;
        this.onMutationCallback = onMutationCallback || (() => {});
        this.records = [];
        this.isPaused = false;

        this.config = {
            childList: true,
            attributes: true,
            characterData: true,
            subtree: true,
            attributeOldValue: true,
            characterDataOldValue: true
        };

        this.stats = {
            total: 0,
            childList: 0,
            attributes: 0,
            characterData: 0,
            nodesAdded: 0,
            nodesRemoved: 0
        };

        this._initObserver();
    }

    _initObserver() {
        this.observer = new MutationObserver((mutationsList) => {
            if (this.isPaused) return;

            const processedRecords = [];
            for (const record of mutationsList) {
                const processed = this._processRecord(record);
                this.records.unshift(processed);
                if (this.records.length > 250) this.records.pop();
                processedRecords.push(processed);
            }

            this.onMutationCallback(processedRecords, this.stats);
        });

        this.connect();
    }

    connect() {
        if (!this.observer || !this.target) return;
        try {
            this.observer.observe(this.target, this.config);
        } catch (e) {
            console.error('Failed to observe target:', e);
        }
    }

    disconnect() {
        if (this.observer) {
            this.observer.disconnect();
        }
    }

    togglePause() {
        this.isPaused = !this.isPaused;
        return this.isPaused;
    }

    updateConfig(newConfig) {
        Object.assign(this.config, newConfig);
        this.disconnect();
        this.connect();
    }

    clear() {
        this.records = [];
        this.stats = {
            total: 0,
            childList: 0,
            attributes: 0,
            characterData: 0,
            nodesAdded: 0,
            nodesRemoved: 0
        };
        this.onMutationCallback([], this.stats);
    }

    _getNodeDescription(node) {
        if (!node) return 'null';
        if (node.nodeType === Node.TEXT_NODE) {
            const preview = node.textContent.trim().slice(0, 20);
            return `#text "${preview}${node.textContent.length > 20 ? '...' : ''}"`;
        }
        if (node.nodeType === Node.ELEMENT_NODE) {
            let desc = `<${node.nodeName.toLowerCase()}`;
            if (node.id) desc += ` id="${node.id}"`;
            if (node.className && typeof node.className === 'string') desc += ` class="${node.className}"`;
            desc += '>';
            return desc;
        }
        return node.nodeName || 'unknown';
    }

    _processRecord(record) {
        const time = new Date().toLocaleTimeString();
        this.stats.total++;

        let details = {};
        let summary = '';

        if (record.type === 'childList') {
            this.stats.childList++;
            const added = Array.from(record.addedNodes).map(n => this._getNodeDescription(n));
            const removed = Array.from(record.removedNodes).map(n => this._getNodeDescription(n));

            this.stats.nodesAdded += added.length;
            this.stats.nodesRemoved += removed.length;

            summary = `+${added.length} added, -${removed.length} removed in ${this._getNodeDescription(record.target)}`;
            details = {
                addedCount: added.length,
                removedCount: removed.length,
                addedNodes: added,
                removedNodes: removed,
                nextSibling: this._getNodeDescription(record.nextSibling),
                previousSibling: this._getNodeDescription(record.previousSibling)
            };
        } else if (record.type === 'attributes') {
            this.stats.attributes++;
            const attrName = record.attributeName;
            const oldValue = record.oldValue;
            const newValue = record.target.getAttribute ? record.target.getAttribute(attrName) : null;

            summary = `attr "${attrName}": "${oldValue ?? 'null'}" → "${newValue ?? 'null'}" on ${this._getNodeDescription(record.target)}`;
            details = {
                attributeName: attrName,
                oldValue: oldValue,
                newValue: newValue
            };
        } else if (record.type === 'characterData') {
            this.stats.characterData++;
            const oldVal = record.oldValue;
            const newVal = record.target.textContent;

            const oldShort = (oldVal || '').slice(0, 25);
            const newShort = (newVal || '').slice(0, 25);
            summary = `text: "${oldShort}" → "${newShort}"`;
            details = {
                oldText: oldVal,
                newText: newVal
            };
        }

        return {
            id: 'm_' + Math.random().toString(36).substr(2, 9),
            timestamp: time,
            type: record.type,
            targetDesc: this._getNodeDescription(record.target),
            targetTag: record.target.nodeName.toLowerCase(),
            summary: summary,
            details: details
        };
    }

    exportJson() {
        return JSON.stringify({
            stats: this.stats,
            records: this.records
        }, null, 2);
    }
}
