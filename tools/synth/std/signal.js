// signal.js — minimal reactive primitives (zero dependencies)
//
// A tiny dependency-tracking reactive core: signals hold values, effects re-run
// when the signals they read change, computed values derive from other signals.
// Designed to make imperative DOM wiring declarative without a framework.
//
// Part of the in-app std lib (tools/synth/std). Self-contained so it can be
// lifted to a shared /lib/std when stable — it imports nothing.
//
//   const count = signal(0);
//   effect(() => console.log("count is", count()));   // logs immediately, then on change
//   count.set(1);                                      // effect re-runs
//   const doubled = computed(() => count() * 2);
//   batch(() => { count.set(2); count.set(3); });      // effects run once at batch end

// The observer (effect/computed) currently collecting dependencies, if any.
let activeSub = null;

// Batching: while >0, notifications are queued and flushed when the outermost
// batch() returns, so a burst of writes triggers each effect at most once.
let batchDepth = 0;
const pending = new Set();

// A subscriber: an effect or computed that re-runs when its dependencies change.
class Sub {
    constructor(fn) {
        this.fn = fn;
        this.deps = new Set();   // dependency subscriber-sets we're registered in
        this.disposed = false;
    }

    // Detach from every dependency set before a re-run (or on dispose) so stale
    // dependencies from a previous run don't keep this subscriber alive or fire it.
    cleanup() {
        for (const dep of this.deps) dep.delete(this);
        this.deps.clear();
    }

    run() {
        if (this.disposed) return undefined;
        this.cleanup();
        const prev = activeSub;
        activeSub = this;
        try {
            return this.fn();
        } finally {
            activeSub = prev;
        }
    }

    dispose() {
        this.disposed = true;
        this.cleanup();
    }
}

function notify(subs) {
    // Snapshot: a subscriber re-running re-registers itself into `subs`, which
    // would otherwise mutate the set mid-iteration.
    for (const sub of [...subs]) {
        if (batchDepth > 0) pending.add(sub);
        else sub.run();
    }
}

/// Create a writable reactive value. The returned accessor reads (and tracks);
/// `.set(v)` writes, `.update(fn)` writes from the previous value, `.peek()`
/// reads without tracking.
export function signal(initial) {
    let value = initial;
    const subs = new Set();

    function read() {
        if (activeSub) {
            subs.add(activeSub);
            activeSub.deps.add(subs);
        }
        return value;
    }
    read.peek = () => value;
    read.set = (next) => {
        if (Object.is(next, value)) return;
        value = next;
        notify(subs);
    };
    read.update = (fn) => read.set(fn(value));
    return read;
}

/// Create a read-only value derived from other signals. Recomputes when any
/// signal it reads changes.
export function computed(fn) {
    const out = signal(undefined);
    const sub = new Sub(() => out.set(fn()));
    sub.run();
    const read = () => out();
    read.peek = out.peek;
    return read;
}

/// Run `fn` now and re-run it whenever a signal it read changes. Returns a
/// dispose function that stops further runs.
export function effect(fn) {
    const sub = new Sub(fn);
    sub.run();
    return () => sub.dispose();
}

/// Coalesce writes: effects triggered by `fn` run once, after `fn` returns.
export function batch(fn) {
    batchDepth++;
    try {
        return fn();
    } finally {
        if (--batchDepth === 0) {
            const subs = [...pending];
            pending.clear();
            for (const sub of subs) sub.run();
        }
    }
}

/// Read `accessor` without subscribing the current effect to it.
export function untracked(accessor) {
    const prev = activeSub;
    activeSub = null;
    try {
        return accessor();
    } finally {
        activeSub = prev;
    }
}
