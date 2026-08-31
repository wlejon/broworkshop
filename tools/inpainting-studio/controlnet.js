// tools/inpainting-studio/controlnet.js

export class ControlNetAnnotator {
    constructor(controlCanvas) {
        this.canvas = controlCanvas;
        this.ctx = this.canvas.getContext('2d');
    }

    process(baseCanvas, mode = 'canny') {
        const w = baseCanvas.width;
        const h = baseCanvas.height;

        this.canvas.width = w;
        this.canvas.height = h;

        if (mode === 'none') {
            this.ctx.clearRect(0, 0, w, h);
            return;
        }

        const baseCtx = baseCanvas.getContext('2d');
        const imgData = baseCtx.getImageData(0, 0, w, h);
        const outData = this.ctx.createImageData(w, h);

        const src = imgData.data;
        const dst = outData.data;

        if (mode === 'canny') {
            // Sobel Edge Filter
            for (let y = 1; y < h - 1; y++) {
                for (let x = 1; x < w - 1; x++) {
                    const idx = (y * w + x) * 4;

                    // Compute luminance for 3x3 neighborhood
                    const getLum = (ox, oy) => {
                        const i = ((y + oy) * w + (x + ox)) * 4;
                        return src[i] * 0.299 + src[i + 1] * 0.587 + src[i + 2] * 0.114;
                    };

                    const gx = -getLum(-1, -1) + getLum(1, -1)
                              -2 * getLum(-1, 0) + 2 * getLum(1, 0)
                              -getLum(-1, 1) + getLum(1, 1);

                    const gy = -getLum(-1, -1) - 2 * getLum(0, -1) - getLum(1, -1)
                              +getLum(-1, 1) + 2 * getLum(0, 1) + getLum(1, 1);

                    const mag = Math.hypot(gx, gy);
                    const edge = mag > 45 ? 255 : 0;

                    dst[idx] = edge;
                    dst[idx + 1] = edge;
                    dst[idx + 2] = edge;
                    dst[idx + 3] = 255;
                }
            }
        } else if (mode === 'depth') {
            // Depth map estimation (luminance + vertical gradient)
            for (let y = 0; y < h; y++) {
                const depthGrad = (y / h) * 120;
                for (let x = 0; x < w; x++) {
                    const idx = (y * w + x) * 4;
                    const lum = src[idx] * 0.299 + src[idx + 1] * 0.587 + src[idx + 2] * 0.114;
                    const depth = Math.min(255, lum * 0.6 + depthGrad);

                    dst[idx] = depth;
                    dst[idx + 1] = depth;
                    dst[idx + 2] = depth;
                    dst[idx + 3] = 255;
                }
            }
        }

        this.ctx.putImageData(outData, 0, 0);
    }
}
