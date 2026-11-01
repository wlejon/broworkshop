// tools/shader-lab/kernel-runtime.js — runs the editor's brokernel source:
// its `main_image` grid kernel is dispatched over the canvas every frame
// into an RGBA32F KernelBuffer, which the canvas's 'kernel' context shows
// (bro docs/kernel-api.js sections 6 and 8). Nothing is read back.

export const ENTRY = 'main_image';

export class KernelRuntime {
    constructor(canvas) {
        if (!bro.kernel || !bro.kernel.gpu) throw new Error('bro.kernel has no GPU device');
        this.canvas = canvas;
        this.ctx = canvas.getContext('kernel');
        if (!this.ctx) throw new Error("the canvas has no 'kernel' context");
        this.kernel = null;
        this.pixels = null;
        this.w = 0;
        this.h = 0;
    }

    // Compile `source` and make its main_image the kernel drawn. A source that
    // does not compile, has no main_image, or whose main_image does not take
    // (out, resolution, time, mouse, param) leaves the last good one running.
    setSource(source) {
        let mod;
        try {
            mod = bro.kernel.compile(source, { file: 'shader.bk' });
        } catch (err) {
            return { success: false, error: err.message };
        }
        if (!mod.kernels.includes(ENTRY))
            return { success: false, error: `no kernel named '${ENTRY}' (found: ${mod.kernels.join(', ') || 'none'})` };
        const kernel = mod.kernel(ENTRY);
        if (kernel.gridDim !== 2)
            return { success: false, error: `${ENTRY} must be a @grid(2) kernel` };
        try {
            // A one-pixel trial run checks the parameters line up.
            kernel.dispatch([1, 1], bro.kernel.createBuffer(16), [1, 1], 0, [0, 0, 0, 0], [1, 1, 1, 1]);
        } catch (err) {
            return { success: false, error: `${ENTRY} takes (g: grid<2>, out: write_store<vec4<f32>, 2>, ` +
                     `resolution: vec2<f32>, time: f32, mouse: vec4<f32>, param: vec4<f32>): ${err.message}` };
        }
        this.kernel = kernel;
        return { success: true, log: `Compiled ${mod.kernels.length} kernel(s): ${mod.kernels.join(', ')}` };
    }

    render(u) {
        if (!this.kernel) return;
        const w = this.canvas.width | 0, h = this.canvas.height | 0;
        if (w <= 0 || h <= 0) return;
        if (w !== this.w || h !== this.h) {
            this.pixels = bro.kernel.createBuffer(w * h * 16);
            this.w = w; this.h = h;
        }
        this.kernel.dispatch([w, h], this.pixels, [w, h], u.time || 0, u.mouse || [0, 0, 0, 0],
                             [u.param1, u.param2, u.param3, u.param4]);
        this.ctx.present(this.pixels, { format: 'rgba32f' });
    }
}
