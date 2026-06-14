// storage.js — namespaced localStorage wrapper + high-score tables.
//
// Usage:
//   const S = Storage.create("crater");
//   S.load({ name: "Player", sfxVol: 0.8 });   // returns merged defaults
//   S.set("name", "Jonny");
//   S.save();
//   const hs = Storage.highscores("crater", 10);
//   hs.add({ score: 120, name: "JB", date: "2026-04-22" });


    function safeGet(key) {
        try { return localStorage.getItem(key); } catch (e) { return null; }
    }
    function safeSet(key, value) {
        try { localStorage.setItem(key, value); } catch (e) {}
    }

    function create(namespace) {
        const key = namespace + ':settings';
        let data = {};
        return {
            load(defaults) {
                data = Object.assign({}, defaults || {});
                const raw = safeGet(key);
                if (raw) {
                    try {
                        const parsed = JSON.parse(raw);
                        for (const k in parsed) {
                            if (Object.prototype.hasOwnProperty.call(data, k)) {
                                data[k] = parsed[k];
                            }
                        }
                    } catch (e) {}
                }
                return data;
            },
            save() { safeSet(key, JSON.stringify(data)); },
            get(k)      { return data[k]; },
            set(k, v)   { data[k] = v; },
            all()       { return data; },
        };
    }

    // High-score table: sorted descending by `score` (or ascending when
    // `ascending: true` — for timed modes where lower is better).
    function highscores(namespace, maxEntries, opts) {
        opts = opts || {};
        const key = namespace + ':highscores';
        const max = maxEntries || 10;
        const field = opts.field || 'score';
        const asc   = !!opts.ascending;
        const cmp   = asc
            ? (a, b) => a[field] - b[field]
            : (a, b) => b[field] - a[field];

        function loadAll() {
            const raw = safeGet(key);
            if (!raw) return [];
            try { return JSON.parse(raw) || []; } catch (e) { return []; }
        }
        function saveAll(list) { safeSet(key, JSON.stringify(list)); }

        return {
            list: loadAll,
            add(entry) {
                const list = loadAll();
                list.push(entry);
                list.sort(cmp);
                list.length = Math.min(list.length, max);
                saveAll(list);
                return list;
            },
            qualifies(value) {
                const list = loadAll();
                if (list.length < max) return true;
                return asc ? (value < list[list.length - 1][field])
                           : (value > list[list.length - 1][field]);
            },
            clear() { saveAll([]); },
        };
    }

    // Common arcade pattern: a single persistent high score for one mode.
    // Returns an object with { highScore (getter), maybeUpdate, load, save }.
    // Auto-loads on first construction so callers can use it immediately;
    // load() is exposed for explicit reload but is a no-op after init.
    function highScoreOnly(namespace) {
        const s = create(namespace);
        let loaded = false;
        function ensure() { if (!loaded) { s.load({ highScore: 0 }); loaded = true; } }
        ensure();
        return {
            get highScore() { return s.get('highScore') || 0; },
            set highScore(v) { s.set('highScore', v); },
            load() { loaded = false; ensure(); },
            save() { s.save(); },
            maybeUpdate(score) {
                if (score > (s.get('highScore') || 0)) {
                    s.set('highScore', score);
                    s.save();
                    return true;
                }
                return false;
            },
        };
    }

export const Storage = { create, highscores, highScoreOnly };
