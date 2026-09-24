// support.js — what this engine's Web Animations implementation actually does,
// probed at startup on a throwaway element rather than asserted from memory.
// Each row is a live measurement.

export function probeSupport(host) {
    const el = document.createElement('div');
    el.style.cssText = 'position:absolute; left:-100px; top:0; width:10px; height:10px';
    host.appendChild(el);
    const out = {};
    const a = el.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 1000, iterations: Infinity });

    out.animate = typeof a.play === 'function';
    out.updatePlaybackRate = typeof a.updatePlaybackRate === 'function';
    out.commitStyles = typeof a.commitStyles === 'function';
    out.persist = typeof a.persist === 'function';
    out.updateTiming = typeof a.effect.updateTiming === 'function';
    out.pending = a.pending === true ? 'true' : 'always false';

    // finish() on an infinite animation must throw InvalidStateError.
    try { a.finish(); out.finishInfinite = 'did not throw'; }
    catch (e) { out.finishInfinite = e.name || 'threw'; }
    a.cancel();

    // steps(4, end) at 10% must be exactly 0; anything else is a fallback curve.
    const s = el.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 1000, easing: 'steps(4, end)' });
    s.currentTime = 100;
    const p = s.effect.getComputedTiming().progress;
    out.steps = p === 0 ? 'yes' : `no (progress ${p.toFixed(3)} at 10%, want 0)`;
    out.stepsReportedAs = s.effect.getTiming().easing;
    s.cancel();

    // Per-keyframe easing (what the comparison arena relies on).
    const k = el.animate([{ opacity: 0, easing: 'ease-in' }, { opacity: 1 }], { duration: 1000 });
    k.currentTime = 500;
    const op = parseFloat(getComputedStyle(el).opacity);
    out.keyframeEasing = op < 0.45 ? 'yes' : `no (opacity ${op} at 50%)`;
    k.cancel();

    // A CSS animation is a CSSAnimation in getAnimations(), and every layer of
    // a comma list runs (@keyframes waapiCompare lives in style.css).
    el.style.animation = 'waapiCompare 1s linear infinite, waapiCompare 2s linear infinite';
    const css = el.getAnimations();
    out.cssAnimations = css.length > 0 && css[0] instanceof CSSAnimation &&
        css[0].animationName === 'waapiCompare' && document.getAnimations().includes(css[0])
        ? 'yes' : `no (${css.length} listed)`;
    out.cssLayers = css.length === 2 ? 'yes' : `no (${css.length} of 2 layers)`;

    // display:none cancels a CSS animation; shown again, a new one starts
    // from the beginning.
    const before = css[0];
    el.style.display = 'none';
    const hiddenCount = el.getAnimations().length;
    const hiddenState = before.playState;
    el.style.display = '';
    const after = el.getAnimations()[0];
    out.cssDisplayNone = hiddenCount === 0 && hiddenState === 'idle' && after && after !== before &&
        after.currentTime === 0
        ? 'yes' : `no (${hiddenCount} listed while hidden, ${hiddenState})`;
    el.style.animation = '';

    // A running CSS transition is a CSSTransition.
    el.style.transition = 'opacity 1s linear';
    getComputedStyle(el).opacity;
    el.style.opacity = '0.5';
    const hasCtor = typeof CSSTransition === 'function';
    const tr = el.getAnimations().find((x) => hasCtor && x instanceof CSSTransition);
    out.cssTransitions = tr && tr.transitionProperty === 'opacity' && document.getAnimations().includes(tr)
        ? 'yes' : `no (${el.getAnimations().length} listed)`;
    el.style.transition = '';
    el.style.opacity = '';

    // document.getAnimations() lists CSS animations in tree order, whatever
    // order they started in.
    const first = document.createElement('div');
    const second = document.createElement('div');
    el.append(first, second);
    second.style.animation = 'waapiCompare 1s linear infinite';
    second.getAnimations();
    first.style.animation = 'waapiCompare 1s linear infinite';
    const order = document.getAnimations()
        .map((x) => x.effect && x.effect.target)
        .filter((t) => t === first || t === second);
    out.treeOrder = order.length === 2 && order[0] === first ? 'yes' : 'no (creation order)';

    el.remove();
    return out;
}

export const SUPPORT_LABELS = {
    animate: 'element.animate()',
    keyframeEasing: 'per-keyframe easing',
    finishInfinite: 'finish() on infinite',
    pending: 'anim.pending',
    steps: 'steps() easing',
    stepsReportedAs: '…getTiming().easing',
    updatePlaybackRate: 'updatePlaybackRate()',
    commitStyles: 'commitStyles()',
    persist: 'persist()',
    updateTiming: 'effect.updateTiming()',
    cssAnimations: 'CSS animations in getAnimations()',
    cssLayers: 'comma-list CSS animations',
    cssDisplayNone: 'display:none cancels CSS animations',
    cssTransitions: 'CSS transitions in getAnimations()',
    treeOrder: 'document.getAnimations() tree order',
};

/** A probe value that reads as supported. */
export function supported(key, v) {
    return v === true || v === 'yes' || v === 'InvalidStateError' ||
        (key === 'stepsReportedAs' && /^steps\(/.test(String(v)));
}
