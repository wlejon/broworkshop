// test_click_targets.js — regression for click hit-testing inside the
// #transcript overflow scroller. Collapsing a tool card by clicking its header
// must work no matter how far the transcript is internally scrolled (a hit-test
// that ignored the overflow scroll offset would land on the wrong element once
// scrolled — the "clicking is only sometimes effective" symptom).
//
//   bro-headless ai/pi-agent tests/test_click_targets.js

const api = window.__piDebug;
assert(api && typeof api.fill === "function", "__piDebug.fill present");
api.fill({ turns: 8 });
flush();

const t = document.querySelector("#transcript");
assert(t.scrollHeight > t.clientHeight + 50, "transcript overflows");

// Click the first tool-card header fully inside the viewport at a given scroll
// offset and assert the card's collapsed state flips.
function toggleAt(scrollTop, label) {
    t.scrollTop = scrollTop;
    flush();
    const tRect = t.getBoundingClientRect();
    const heads = document.querySelectorAll(".tool-card .tool-head");
    for (let i = 0; i < heads.length; i++) {
        const r = heads[i].getBoundingClientRect();
        if (r.height > 0 && r.top >= tRect.top + 4 && r.bottom <= tRect.bottom - 4) {
            const card = heads[i].closest(".tool-card");
            const before = card.classList.contains("collapsed");
            click(r.left + r.width / 2, r.top + r.height / 2);
            flush();
            const after = card.classList.contains("collapsed");
            assert(before !== after,
                label + ": clicking the tool header toggled collapse (" + before + " -> " + after + ")");
            return true;
        }
    }
    return false; // nothing in view at this offset — not a failure
}

let tested = 0;
if (toggleAt(0, "at-top")) tested++;
if (toggleAt(400, "scrolled-400")) tested++;
if (toggleAt(Math.floor(t.scrollHeight / 2), "scrolled-mid")) tested++;
if (toggleAt(t.scrollHeight, "at-bottom")) tested++;
assert(tested >= 2, "exercised clicks at multiple scroll offsets (" + tested + ")");

// A "💭 Thinking" fold must toggle when its header is clicked — including a
// past fold, whose handler must target its own element (not a shared var).
(function thinkingFoldToggles() {
    t.scrollTop = 0;
    flush();
    const tRect = t.getBoundingClientRect();
    const heads = document.querySelectorAll(".thinking .thinking-head");
    for (let i = 0; i < heads.length; i++) {
        const r = heads[i].getBoundingClientRect();
        if (r.height > 0 && r.top >= tRect.top + 4 && r.bottom <= tRect.bottom - 4) {
            const fold = heads[i].closest(".thinking");
            const before = fold.classList.contains("collapsed");
            click(r.left + r.width / 2, r.top + r.height / 2);
            flush();
            assert(before !== fold.classList.contains("collapsed"),
                "clicking a thinking header toggled its own fold (" + before + " -> " + !before + ")");
            // Toggle back to confirm it works both directions.
            click(r.left + r.width / 2, r.top + r.height / 2);
            flush();
            assert(before === fold.classList.contains("collapsed"),
                "clicking again restored the fold state");
            return;
        }
    }
    assert(false, "no thinking fold visible to click");
})();

console.log("test_click_targets: all assertions passed");
