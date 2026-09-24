// Shared by the nav-lab tests: click a side-panel control the way a user
// would get to it (unfold its panel by its caption, scroll it into view).
import { q, clickOn } from "/lib/kit/test.js";

export function reveal(sel) {
    const panel = q(sel).closest('.k-panel');
    if (panel && panel.classList.contains('folded')) {
        const cap = panel.querySelector('h2');
        cap.scrollIntoView({ block: 'center' });
        flush();
        // The caption's right end: a caption may hold a feature checkbox's
        // label on its left, and clicking that toggles the feature, not the fold.
        const r = cap.getBoundingClientRect();
        click(r.right - 4, r.top + r.height / 2, 0);
        flush();
        if (panel.classList.contains('folded')) throw new Error('reveal: panel of ' + sel + ' did not unfold');
    }
    q(sel).scrollIntoView({ block: 'center' });
    flush();
}

export function reach(sel) {
    reveal(sel);
    clickOn(sel);
}
