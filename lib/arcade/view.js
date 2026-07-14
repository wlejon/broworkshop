// Arcade kernel — canvas view (engine-aware size + clear).
//
// Bro sets ctx.canvasWidth / ctx.canvasHeight (DPR-aware). Fallback uses
// the canvas element or the sizes passed at create time.

/**
 * @param {object} opts
 * @param {string|HTMLCanvasElement} [opts.canvas] - selector or element (default "#view")
 * @param {number} [opts.width=800]
 * @param {number} [opts.height=600]
 * @param {string} [opts.clearColor="#000"]
 */
export function createView(opts = {}) {
    const fallbackW = opts.width || 800;
    const fallbackH = opts.height || 600;
    let clearColor = opts.clearColor || "#000";

    const canvas = resolveCanvas(opts.canvas || "#view");
    if (!canvas) {
        throw new Error("arcade.view: canvas not found");
    }
    const ctx = canvas.getContext("2d");
    if (!ctx) {
        throw new Error("arcade.view: 2d context unavailable");
    }

    function width() {
        return (ctx.canvasWidth)
            || (canvas.width)
            || fallbackW;
    }

    function height() {
        return (ctx.canvasHeight)
            || (canvas.height)
            || fallbackH;
    }

    function size() {
        return { w: width(), h: height() };
    }

    function clear(color) {
        const w = width();
        const h = height();
        ctx.fillStyle = color != null ? color : clearColor;
        ctx.fillRect(0, 0, w, h);
        return { w, h };
    }

    function setClearColor(color) {
        clearColor = color;
    }

    return {
        canvas,
        ctx,
        width,
        height,
        size,
        clear,
        setClearColor,
    };
}

function resolveCanvas(sel) {
    // bro's QuickJS may not expose HTMLCanvasElement as a global; duck-type.
    if (sel && typeof sel === "object" && typeof sel.getContext === "function") {
        return sel;
    }
    if (typeof sel === "string") return document.querySelector(sel);
    return null;
}
