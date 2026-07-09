// test_scroll_chaining.js — regression for wheel scroll chaining over the
// transcript's nested overflow regions. A fits-content inner scroller (an
// expanded "💭 Thinking" fold) and an at-edge inner scroller must NOT swallow
// the wheel — it has to chain to the outer #transcript scroller. This exercises
// the engine's handleWheel ancestor walk (src/engine/input_handling.cpp).
//
//   bro-headless ai/pi-agent tests/test_scroll_chaining.js

const api = window.__piDebug;
assert(api && typeof api.fill === "function", "__piDebug.fill present");

// Stack enough turns that the transcript overflows and holds nested scrollers.
api.fill({ turns: 8 });
flush();

const t = document.querySelector("#transcript");
assert(t, "#transcript present");
assert(t.scrollHeight > t.clientHeight + 50,
    "transcript overflows (scrollHeight " + t.scrollHeight + " vs client " + t.clientHeight + ")");

// Park at the top so the first (expanded, fits-content) thinking fold is on screen.
t.scrollTop = 0;
flush();

const fold = document.querySelector(".thinking:not(.collapsed) .thinking-body")
    || document.querySelector(".thinking-body");
assert(fold, "an expanded thinking fold is present");
const fr = fold.getBoundingClientRect();
assert(fr.height > 0 && fr.bottom > fr.top, "thinking fold has a visible rect");

// The fold's content fits (no inner scrollbar). Before the fix this swallowed
// the wheel and the page stuck; now it must chain to the transcript.
const px = fr.left + fr.width / 2;
const py = fr.top + Math.min(Math.max(fr.height / 2, 4), 12);
mouseMove(px, py);

const beforeDown = t.scrollTop;
wheel(px, py, 120); // DOM convention: +deltaY = scroll toward bottom
flush();
assert(t.scrollTop > beforeDown,
    "wheel-down over a fits-content fold chained to the transcript (before " +
    beforeDown + ", after " + t.scrollTop + ")");

// Wheeling back up over the same fold must chain too.
const beforeUp = t.scrollTop;
wheel(px, py, -240);
flush();
assert(t.scrollTop < beforeUp,
    "wheel-up over the fold chained to the transcript (before " + beforeUp +
    ", after " + t.scrollTop + ")");

// Guard the other direction of the fix: an inner scroller that CAN move in the
// wheel direction still consumes the wheel itself (we didn't break nested
// scrolling). Find a long, expanded tool result if one is scrollable.
(function innerStillScrolls() {
    const results = document.querySelectorAll(".tool-result");
    for (let i = 0; i < results.length; i++) {
        const r = results[i];
        // Expand its card so the result is laid out and scrollable.
        const card = r.closest ? r.closest(".tool-card") : null;
        if (card && card.classList.contains("collapsed")) card.classList.remove("collapsed");
        flush();
        if (r.scrollHeight <= r.clientHeight + 4) continue; // not scrollable
        const rr = r.getBoundingClientRect();
        if (rr.height <= 0 || rr.bottom <= 0 || rr.top >= t.getBoundingClientRect().bottom) continue;
        const ix = rr.left + rr.width / 2;
        const iy = rr.top + rr.height / 2;
        mouseMove(ix, iy);
        r.scrollTop = 0;
        const outerBefore = t.scrollTop;
        wheel(ix, iy, 120);
        flush();
        assert(r.scrollTop > 0, "inner scrollable result consumed the wheel (scrollTop " + r.scrollTop + ")");
        assert(t.scrollTop === outerBefore, "outer transcript did not also move while inner had room");
        return true;
    }
    console.log("test_scroll_chaining: (no scrollable inner result to assert against — skipped inner guard)");
    return false;
})();

console.log("test_scroll_chaining: all assertions passed");
