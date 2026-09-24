// Wordspire scoring — pure.
//   word score = sum(letter value x its tile's mult) + lengthBonus x (best mult in the word)
//   streak multiplier = 1 + 0.5 per consecutive valid word after the first, max 5

export const LETTER_VALUES = {
    a: 1, b: 3, c: 3, d: 2, e: 1, f: 4, g: 2, h: 4, i: 1, j: 8, k: 5, l: 1, m: 3,
    n: 1, o: 1, p: 3, q: 10, r: 1, s: 1, t: 1, u: 1, v: 4, w: 4, x: 8, y: 4, z: 10,
};

export function letterValue(ch) {
    return (ch && LETTER_VALUES[String(ch).toLowerCase()]) || 0;
}

/** 3=10, 4=20, 5=40, 6=80, 7=160, then doubling: 8=320, 9=640... */
export function lengthBonus(n) {
    if (n < 3) return 0;
    return 10 * Math.pow(2, n - 3);
}

/** tiles: optional [{ mult }] aligned with the word's letters. */
export function computeWordScore(word, tiles) {
    if (!word || word.length < 3) return 0;
    let sum = 0, maxMult = 1;
    for (let i = 0; i < word.length; i++) {
        const m = (tiles && tiles[i] && tiles[i].mult) || 1;
        maxMult = Math.max(maxMult, m);
        sum += letterValue(word.charAt(i)) * m;
    }
    return Math.floor(sum + lengthBonus(word.length) * maxMult);
}

export function comboMultiplier(streak) {
    return streak <= 1 ? 1 : Math.min(5, 1 + 0.5 * (streak - 1));
}
