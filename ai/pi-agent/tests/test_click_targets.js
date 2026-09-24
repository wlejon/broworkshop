// Click hit-testing inside the #transcript overflow scroller: collapsing a
// tool card by clicking its header must work however far the transcript is
// scrolled (a hit test that ignored the scroll offset would land on the wrong
// element once scrolled), and a reasoning fold's header toggles its own fold.
import { check, test, done, frames } from "/lib/kit/test.js";
import { piAgent } from "/app/app.js";

piAgent.fill({ turns: 8 });
frames(2);

const t = document.querySelector('#transcript');
check(t.scrollHeight > t.clientHeight + 50, 'transcript overflows');

// Click the first header fully inside the viewport; returns whether it flipped
// `cls` on its container (null when nothing is in view at this offset).
function toggleFirstVisible(headSel, boxSel, cls) {
    const tr = t.getBoundingClientRect();
    for (const head of document.querySelectorAll(headSel)) {
        const r = head.getBoundingClientRect();
        if (r.height > 0 && r.top >= tr.top + 4 && r.bottom <= tr.bottom - 4) {
            const box = head.closest(boxSel);
            const before = box.classList.contains(cls);
            click(r.left + r.width / 2, r.top + r.height / 2);
            flush();
            return before !== box.classList.contains(cls);
        }
    }
    return null;
}

test('tool header toggles at every scroll offset', () => {
    let tried = 0;
    for (const top of [0, 400, Math.floor(t.scrollHeight / 2), t.scrollHeight]) {
        t.scrollTop = top;
        frames(1);
        const r = toggleFirstVisible('.chat-tool-head', '.chat-tool', 'collapsed');
        if (r === null) continue;
        check(r, 'toggled at scrollTop ' + t.scrollTop);
        tried++;
    }
    check(tried >= 2, 'exercised clicks at ' + tried + ' offsets');
});

test('thinking header toggles its own fold, both ways', () => {
    t.scrollTop = 0;
    frames(1);
    check(toggleFirstVisible('.chat-think-head', '.chat-think', 'collapsed') === true, 'first click toggles');
    check(toggleFirstVisible('.chat-think-head', '.chat-think', 'collapsed') === true, 'second click toggles back');
});

done('click targets');
