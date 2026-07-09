// Unit test for /lib/linediff.js — LCS line diff correctness. No model needed.
//   bro-headless ai/pi-agent tests/test_linediff.js

import { lineDiff } from "/lib/linediff.js";

const types = (ops) => ops.map((o) => o.type).join(",");
const find = (ops, type, text) => ops.some((o) => o.type === type && o.text === text);

// 1. Identical input — all context, no changes.
{
    const ops = lineDiff("a\nb\nc", "a\nb\nc");
    assert(types(ops) === "ctx,ctx,ctx", "identical → all ctx, got " + types(ops));
}

// 2. Pure addition at the end.
{
    const ops = lineDiff("a", "a\nb");
    assert(find(ops, "ctx", "a"), "kept a");
    assert(find(ops, "add", "b"), "added b");
    assert(!ops.some((o) => o.type === "del"), "no deletions");
}

// 3. Pure deletion.
{
    const ops = lineDiff("a\nb", "a");
    assert(find(ops, "ctx", "a"), "kept a");
    assert(find(ops, "del", "b"), "deleted b");
    assert(!ops.some((o) => o.type === "add"), "no additions");
}

// 4. Middle-line replacement — a and c anchor, b→x.
{
    const ops = lineDiff("a\nb\nc", "a\nx\nc");
    assert(find(ops, "ctx", "a") && find(ops, "ctx", "c"), "anchors kept");
    assert(find(ops, "del", "b"), "old middle deleted");
    assert(find(ops, "add", "x"), "new middle added");
}

// 5. Trailing newline doesn't create a spurious blank op.
{
    const ops = lineDiff("a\n", "a\n");
    assert(types(ops) === "ctx", "trailing newline ignored, got " + types(ops));
}

// 6. Empty → non-empty is all additions.
{
    const ops = lineDiff("", "x\ny");
    assert(find(ops, "add", "x") && find(ops, "add", "y"), "both added");
    assert(!ops.some((o) => o.type === "del"), "nothing deleted");
}

console.log("test_linediff: all assertions passed");
