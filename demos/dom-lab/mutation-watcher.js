// demos/dom-lab/mutation-watcher.js

export class MutationWatcher {
    constructor(targetElement, onMutationRecord) {
        this.target = targetElement;
        this.onMutationRecord = onMutationRecord;

        this.observer = new MutationObserver((mutationsList) => {
            for (const mutation of mutationsList) {
                if (this.onMutationRecord) {
                    this.onMutationRecord(mutation);
                }
            }
        });

        this.start();
    }

    start() {
        this.observer.observe(this.target, {
            childList: true,
            attributes: true,
            attributeOldValue: true,
            subtree: true,
            characterData: true,
        });
    }

    stop() {
        this.observer.disconnect();
    }
}
