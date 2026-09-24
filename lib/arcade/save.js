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

/**
 * Binary blob <-> base64 text, for putting a TileWorld.save() (or any
 * Uint8Array) in a localStorage JSON save.
 */
export function bytesToBase64(bytes) {
    let bin = "";
    for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    return btoa(bin);
}

/** Inverse of bytesToBase64: a Uint8Array. */
export function base64ToBytes(b64) {
    const bin = atob(b64);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
}
