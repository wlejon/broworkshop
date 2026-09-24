// MutationObserver over a target subtree: childList, attributes (with the old
// value), characterData. Each record is logged in delivery order.

import { $ } from "/lib/kit/dom.js";

export const STATUSES = ['idle', 'active', 'processing', 'completed'];

/** One log line for a MutationRecord. */
export function describeRecord(r) {
    if (r.type === 'childList') return 'childList → added ' + r.addedNodes.length + ', removed ' + r.removedNodes.length;
    if (r.type === 'attributes') return 'attributes → "' + r.attributeName + '" (old "' + r.oldValue + '")';
    if (r.type === 'characterData') return 'characterData → "' + (r.target ? r.target.data : '') + '" (old "' + r.oldValue + '")';
    return r.type;
}

export const mutationState = { observer: null, records: 0 };

export function initMutations(log) {
    const target = $('#mutation-target');
    const list = $('#observed-list');

    const observer = mutationState.observer = new MutationObserver((records) => {
        for (const r of records) {
            mutationState.records++;
            log.add(describeRecord(r));
        }
    });
    observer.observe(target, {
        childList: true, attributes: true, attributeOldValue: true,
        characterData: true, characterDataOldValue: true, subtree: true,
    });

    let counter = list.children.length + 1;
    $('#append-item').addEventListener('click', () => {
        const li = document.createElement('li');
        li.className = 'item';
        li.textContent = 'Node Item #' + counter++;
        list.appendChild(li);
    });
    $('#mutate-attr').addEventListener('click', () => {
        const cur = target.getAttribute('data-status');
        const next = STATUSES[(STATUSES.indexOf(cur) + 1) % STATUSES.length];
        target.setAttribute('data-status', next);
        $('#target-status').textContent = next;
    });
    $('#edit-text').addEventListener('click', () => {
        // Edit the text node in place (Text.data), which is a characterData
        // mutation rather than a childList one.
        const item = list.querySelector('.item');
        if (item && item.firstChild) item.firstChild.data = item.firstChild.data.replace(/( \(edited\))*$/, ' (edited)');
    });
    $('#clear-children').addEventListener('click', () => { list.innerHTML = ''; });
    $('#clear-mutation-log').addEventListener('click', () => log.clear());
}
