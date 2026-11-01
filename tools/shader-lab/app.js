// tools/shader-lab/app.js — live brokernel editor: the source's main_image
// kernel drawn over the canvas every frame (kernel-runtime.js).
import { KernelRuntime } from './kernel-runtime.js';
import { ShaderEditor } from './editor.js';
import { boot } from "/lib/kit/app.js";
import { ids } from "/lib/kit/dom.js";
import { fpsMeter, toggleButton } from "/lib/kit/ui.js";
import { params, bindControl } from "/lib/kit/params.js";

boot();

const dom = ids('viewCanvas', 'presetSelect', 'compileBtn', 'formatBtn', 'copyBtn', 'shaderCode',
                'logStatus', 'logOutput', 'playBtn', 'resetTimeBtn', 'badgeFps', 'badgeRes');

// The kernel's param.x .. param.w, edited in the panel under the viewport.
const uniforms = { param1: 1.0, param2: 3.0, param3: 0.5, param4: 1.0 };
params('#uniforms', uniforms, {
    param1: { min: 0, max: 5,  step: 0.05, label: 'param.x (Speed / Scale)' },
    param2: { min: 0, max: 10, step: 0.1,  label: 'param.y (Detail / Iterations)', fmt: (v) => v.toFixed(2) },
    param3: { min: 0, max: 1,  step: 0.01, label: 'param.z (Color Morph / Palette)' },
    param4: { min: 0, max: 2,  step: 0.05, label: 'param.w (Lighting / Roughness)' },
});

let elapsedTime = 0;
let lastFrameTime = performance.now();
let resolutionScale = 1.0;
const mouse = [0, 0, 0, 0];   // [currX, currY, clickX, clickY]
let mouseDown = false;
const fps = fpsMeter();

let runtime;
try {
    runtime = new KernelRuntime(dom.viewCanvas);
} catch (err) {
    console.error('Failed to start the kernel runtime:', err);
}

if (runtime) {
    new ShaderEditor(dom, (code) => runtime.setSource(code));

    const playing = toggleButton(dom.playBtn, { on: true, labels: ['▶ Resume', '⏸ Pause'] });
    dom.resetTimeBtn.addEventListener('click', () => { elapsedTime = 0; });
    bindControl('#scaleSelect', { onChange: (v) => { resolutionScale = parseFloat(v) || 1.0; resize(); } });

    // Mouse tracking for `mouse` (origin bottom-left, like `frag`).
    const toCanvas = (e) => {
        const rect = dom.viewCanvas.getBoundingClientRect();
        return [e.clientX - rect.left, rect.height - (e.clientY - rect.top)];
    };
    dom.viewCanvas.addEventListener('mousedown', (e) => {
        mouseDown = true;
        const [x, y] = toCanvas(e);
        mouse[0] = mouse[2] = x;
        mouse[1] = mouse[3] = y;
    });
    window.addEventListener('mousemove', (e) => {
        if (!mouseDown) return;
        [mouse[0], mouse[1]] = toCanvas(e);
    });
    window.addEventListener('mouseup', () => { mouseDown = false; mouse[2] = mouse[3] = 0; });
    window.addEventListener('resize', resize);
    resize();

    const loop = (now) => {
        const dt = Math.min(0.1, (now - lastFrameTime) * 0.001);
        lastFrameTime = now;
        if (playing.on) elapsedTime += dt;
        dom.badgeFps.textContent = Math.round(fps.tick()) + ' FPS';
        runtime.render({ time: elapsedTime, mouse, ...uniforms });
        requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
}

function resize() {
    const dpr = window.devicePixelRatio || 1;
    const rect = dom.viewCanvas.getBoundingClientRect();
    if (rect.width > 0 && rect.height > 0) {
        const w = Math.round(rect.width * dpr * resolutionScale);
        const h = Math.round(rect.height * dpr * resolutionScale);
        dom.viewCanvas.width = w;
        dom.viewCanvas.height = h;
        dom.badgeRes.textContent = `${w} × ${h}`;
    }
}
