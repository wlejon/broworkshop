// Word list (words.txt, one per line) with a prefix set for pruning board
// searches. ~35k words -> a few hundred thousand prefixes; built once.

let words = null;
let prefixes = null;

function build(list) {
    words = new Set();
    for (const raw of list) {
        const w = raw.trim().toLowerCase();
        if (w.length >= 3 && w.length <= 16 && /^[a-z]+$/.test(w)) words.add(w);
    }
    prefixes = new Set();
    for (const w of words) for (let i = 1; i <= w.length; i++) prefixes.add(w.slice(0, i));
    return words.size;
}

export const Dictionary = {
    /** Fetch and index /app/words.txt. Resolves to the word count. */
    async load(url = "words.txt") {
        const res = await fetch(url);
        if (!res.ok) throw new Error(url + " fetch failed: " + res.status);
        return build((await res.text()).split(/\r?\n/));
    },
    /** Use an explicit list (fallback when the file cannot load). */
    setWords: (list) => build(list),
    loaded: () => words !== null,
    count: () => (words ? words.size : 0),
    isWord: (s) => !!words && !!s && words.has(String(s).toLowerCase()),
    isPrefix: (s) => !!prefixes && !!s && prefixes.has(String(s).toLowerCase()),
};
