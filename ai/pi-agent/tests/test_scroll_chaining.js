// Wheel scroll chaining over the transcript's nested overflow regions: an
// inner scroller whose content fits (an expanded reasoning fold) or that is
// at its edge must pass the wheel to #transcript, while an inner scroller
// with room still consumes it (engine: handleWheel's ancestor walk).
import { check, test, done, frames } from "/lib/kit/test.js";
import { piAgent } from "/app/app.js";

piAgent.fill({ turns: 8 });
frames(2);

const t = document.querySelector('#transcript');
check(t.scrollHeight > t.clientHeight + 50, 'transcript overflows (' + t.scrollHeight + ' vs ' + t.clientHeight + ')');
t.scrollTop = 0;
frames(1);

test('wheel over a fits-content fold chains to the transcript', () => {
    const fold = document.querySelector('.chat-think:not(.collapsed) .chat-think-body');
    check(fold, 'an expanded fold is present');
    const r = fold.getBoundingClientRect();
    const x = r.left + r.width / 2, y = r.top + Math.min(Math.max(r.height / 2, 4), 12);
    mouseMove(x, y);
    const before = t.scrollTop;
    wheel(x, y, 120);
    flush();
    check(t.scrollTop > before, 'wheel down moved the transcript (' + before + ' -> ' + t.scrollTop + ')');
    const mid = t.scrollTop;
    wheel(x, y, -240);
    flush();
    check(t.scrollTop < mid, 'wheel up moved it back (' + mid + ' -> ' + t.scrollTop + ')');
});

test('an inner result with room consumes the wheel', () => {
    const tb = t.getBoundingClientRect();
    for (const res of document.querySelectorAll('.chat-tool-result')) {
        const card = res.closest('.chat-tool');
        card.classList.remove('collapsed');
        frames(1);
        if (res.scrollHeight <= res.clientHeight + 4) continue;
        t.scrollTop += res.getBoundingClientRect().top - tb.top - 20;
        frames(1);
        const r = res.getBoundingClientRect();
        if (r.top < tb.top || r.bottom > tb.bottom) continue;
        const x = r.left + r.width / 2, y = r.top + r.height / 2;
        mouseMove(x, y);
        res.scrollTop = 0;
        const outer = t.scrollTop;
        wheel(x, y, 120);
        flush();
        check(res.scrollTop > 0, 'inner result scrolled (' + res.scrollTop + ')');
        check(t.scrollTop === outer, 'transcript stayed put');
        return;
    }
    check(false, 'no scrollable inner result found');
});

done('scroll chaining');
