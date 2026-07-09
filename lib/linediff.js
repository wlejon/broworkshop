// linediff.js — minimal line-level text diff (LCS).
//
// Returns the line-by-line diff of two texts as a flat op list, suitable for
// rendering a red/green diff view. Pure and dependency-free.
//
//   import { lineDiff } from "/lib/linediff.js";
//   const ops = lineDiff(oldText, newText);
//   // ops: [{ type: "ctx" | "del" | "add", text: "<line>" }, ...]
//   //   ctx = unchanged, del = only in old, add = only in new
//
// For very large inputs the O(n·m) table is skipped in favour of a trivial
// all-delete-then-all-add diff, so it never blows up on huge blobs.

const MAX_CELLS = 4_000_000; // ~4M table cells before we bail to the naive diff

function splitLines(text) {
    if (text == null) return [];
    const s = String(text);
    if (s === "") return []; // empty text is zero lines, not one blank line
    const lines = s.split(/\r?\n/);
    // Drop a single trailing empty line from a final newline so it isn't shown
    // as a spurious blank op.
    if (lines.length > 1 && lines[lines.length - 1] === "") lines.pop();
    return lines;
}

export function lineDiff(oldText, newText) {
    const a = splitLines(oldText);
    const b = splitLines(newText);
    const n = a.length;
    const m = b.length;

    // Guard: on pathologically large inputs, skip the LCS table.
    if (n * m > MAX_CELLS) {
        const ops = [];
        for (const t of a) ops.push({ type: "del", text: t });
        for (const t of b) ops.push({ type: "add", text: t });
        return ops;
    }

    // LCS length table, filled from the bottom-right.
    const dp = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
    for (let i = n - 1; i >= 0; i--) {
        for (let j = m - 1; j >= 0; j--) {
            dp[i][j] = a[i] === b[j]
                ? dp[i + 1][j + 1] + 1
                : Math.max(dp[i + 1][j], dp[i][j + 1]);
        }
    }

    // Walk the table to emit ops in order.
    const ops = [];
    let i = 0;
    let j = 0;
    while (i < n && j < m) {
        if (a[i] === b[j]) {
            ops.push({ type: "ctx", text: a[i] });
            i++;
            j++;
        } else if (dp[i + 1][j] >= dp[i][j + 1]) {
            ops.push({ type: "del", text: a[i] });
            i++;
        } else {
            ops.push({ type: "add", text: b[j] });
            j++;
        }
    }
    while (i < n) ops.push({ type: "del", text: a[i++] });
    while (j < m) ops.push({ type: "add", text: b[j++] });
    return ops;
}
