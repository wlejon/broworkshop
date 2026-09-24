// util.js — the three helpers every Platform Lab panel shares.

/** Set an element's text only when it changed (a same-value write still relayouts). */
export function setText(id, text) {
    const el = document.getElementById(id);
    if (el && el.textContent !== text) el.textContent = text;
}

/** Wire a button by id. */
export function bind(id, fn) {
    const el = document.getElementById(id);
    if (el) el.addEventListener('click', fn);
}

/**
 * A capped line log shown in a <pre id>: `lines` keeps the last `keep`
 * entries, the element shows the last `show`. Returns log(text).
 */
export function lineLog(id, lines, keep, show) {
    return (text) => {
        lines.push(text);
        if (lines.length > keep) lines.shift();
        const el = document.getElementById(id);
        if (el) {
            el.textContent = lines.slice(-show).join('\n');
            el.scrollTop = el.scrollHeight;
        }
    };
}
