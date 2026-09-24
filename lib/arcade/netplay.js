// Arcade netplay — the client-side chrome every networked arcade game repeats:
// a Name / Server form on the title screen, remembered between runs, with an
// error line for "could not connect" / "disconnected" / "server full".
//
//   import { connectForm } from "/lib/arcade/netplay.js";
//   const form = connectForm({ name: "#in-name", address: "#in-address",
//                              error: "#title-error", defaults: { address: "127.0.0.1:27100" } });
//   onEnterScreen("title") { form.fill(api.save); }
//   onMenuAction("connect") { const join = form.read(api.save); ... }
//   bro.net.ondisconnect = () => form.error("Lost connection to server");
//
// Typing in a field must not drive the arcade menu (arrow keys, W/S, Space
// and P are menu/pause bindings), so key events stop at the field. Enter is
// let through on purpose: Enter in the Server field connects.
//
// Networking itself stays with the game: lib/netroom.js for tagged JSON
// (games/crater), raw bro.net + a binary protocol for 60 Hz traffic
// (games/fps). Servers import their game's shared modules by relative path
// (`./shared.js`) so they run the same under bro-server and a launcher Worker.

const PASS_KEYS = new Set(["Enter"]);

function resolve(el) {
    if (!el) return null;
    return typeof el === "string" ? document.querySelector(el) : el;
}

/**
 * opts: name, address, error — selectors or elements (each optional);
 *       defaults = { name: "Player", address: "127.0.0.1:27100" };
 *       maxName = 16.
 * Returns { read(save?), fill(save?), error(msg), clearError(), fields }.
 * read/fill persist through an arcade save (keys "name" and "address").
 */
export function connectForm(opts) {
    const o = opts || {};
    const defaults = Object.assign({ name: "Player", address: "127.0.0.1:27100" }, o.defaults);
    const maxName = o.maxName || 16;
    const nameEl = resolve(o.name);
    const addrEl = resolve(o.address);
    const errEl = resolve(o.error);

    for (const el of [nameEl, addrEl]) {
        if (!el) continue;
        const stop = (e) => { if (!PASS_KEYS.has(e.key)) e.stopPropagation(); };
        el.addEventListener("keydown", stop);
        el.addEventListener("keyup", stop);
    }

    /** The trimmed form values (defaults for blanks), saved when `save` is given. */
    function read(save) {
        const name = ((nameEl && nameEl.value.trim()) || defaults.name).slice(0, maxName);
        const address = (addrEl && addrEl.value.trim()) || defaults.address;
        if (save) {
            save.set("name", name);
            save.set("address", address);
            save.save();
        }
        return { name, address };
    }

    /** Put the remembered (or default) values back into the fields. */
    function fill(save) {
        const get = (k) => (save && save.get(k)) || defaults[k];
        if (nameEl) nameEl.value = get("name");
        if (addrEl) addrEl.value = get("address");
    }

    function error(msg) {
        if (errEl) errEl.textContent = msg || "";
    }

    return {
        read, fill, error,
        clearError: () => error(""),
        fields: { name: nameEl, address: addrEl, error: errEl },
    };
}
