// Arcade — mouse on the game canvas, in canvas pixels, only while playing.
//
//   import { bindPointer } from "/lib/arcade/pointer.js";
//   init(api) {
//       bindPointer(api, {
//           down(p, e) { board.press(p.x, p.y); },
//           move(p) { ... }, up(p) { ... }, click(p) { ... }, dblclick(p) { ... },
//       });
//   }
//
// p = { x, y, button } in the view's drawing coordinates (the canvas may be
// stretched by CSS; this maps client pixels through its box). Events are
// dropped unless the shell screen is "playing", so clicks on menus never
// leak into the board. Call once (from game.init).

/** Client coordinates of a mouse event -> canvas drawing coordinates. */
export function toCanvas(view, e) {
    const canvas = view.canvas;
    const rect = canvas.getBoundingClientRect ? canvas.getBoundingClientRect() : null;
    const W = view.width(), H = view.height();
    if (rect && rect.width > 0 && rect.height > 0) {
        return {
            x: (e.clientX - rect.left) * (W / rect.width),
            y: (e.clientY - rect.top) * (H / rect.height),
        };
    }
    return { x: e.clientX, y: e.clientY };
}

const EVENTS = { down: "mousedown", move: "mousemove", up: "mouseup", click: "click", dblclick: "dblclick" };

export function bindPointer(api, handlers) {
    const canvas = api.view.canvas;
    for (const name in EVENTS) {
        const fn = handlers[name];
        if (!fn) continue;
        canvas.addEventListener(EVENTS[name], (e) => {
            if (api.getScreen() !== "playing") return;
            const p = toCanvas(api.view, e);
            p.button = e.button || 0;
            fn(p, e);
        });
    }
}
