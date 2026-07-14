// Arcade kernel — namespaced prefs + single high-score helper.

function safeGet(key) {
    try { return localStorage.getItem(key); }
    catch (e) { return null; }
}

function safeSet(key, value) {
    try { localStorage.setItem(key, value); }
    catch (e) { /* ignore */ }
}

/**
 * @param {string} namespace - unique per game (e.g. "snake")
 */
export function createSave(namespace) {
    if (!namespace) throw new Error("arcade.save: namespace required");

    const settingsKey = namespace + ":settings";
    let data = {};

    function load(defaults) {
        data = Object.assign({}, defaults || {});
        const raw = safeGet(settingsKey);
        if (raw) {
            try {
                const parsed = JSON.parse(raw);
                for (const k in parsed) {
                    if (Object.prototype.hasOwnProperty.call(data, k)) {
                        data[k] = parsed[k];
                    }
                }
            } catch (e) { /* ignore */ }
        }
        return data;
    }

    function save() {
        safeSet(settingsKey, JSON.stringify(data));
    }

    function get(k) {
        return data[k];
    }

    function set(k, v) {
        data[k] = v;
    }

    /** Update high score if higher; persists when improved. Returns true if new best. */
    function maybeHighScore(score) {
        const prev = data.highScore || 0;
        if (score > prev) {
            data.highScore = score;
            save();
            return true;
        }
        return false;
    }

    function highScore() {
        return data.highScore || 0;
    }

    return {
        load,
        save,
        get,
        set,
        maybeHighScore,
        highScore,
    };
}
