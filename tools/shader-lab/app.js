// tools/shader-lab/app.js — live GLSL editor over a fullscreen-quad WebGL2 runtime.
import { GLRuntime } from './gl-runtime.js';
import { ShaderEditor } from './editor.js';
import { boot } from "/lib/kit/app.js";
import { ids } from "/lib/kit/dom.js";
import { fpsMeter, toggleButton } from "/lib/kit/ui.js";
import { params, bindControl } from "/lib/kit/params.js";

boot();

const dom = ids('glCanvas', 'presetSelect', 'compileBtn', 'formatBtn', 'copyBtn', 'shaderCode',
                'logStatus', 'logOutput', 'playBtn', 'resetTimeBtn', 'badgeFps', 'badgeRes');

// Shader uniforms u_param1..4, edited in the panel under the viewport.
const uniforms = { param1: 1.0, param2: 3.0, param3: 0.5, param4: 1.0 };
params('#uniforms', uniforms, {
    param1: { min: 0, max: 5,  step: 0.05, label: 'u_param1 (Speed / Scale)' },
    param2: { min: 0, max: 10, step: 0.1,  label: 'u_param2 (Detail / Iterations)', fmt: (v) => v.toFixed(2) },
    param3: { min: 0, max: 1,  step: 0.01, label: 'u_param3 (Color Morph / Palette)' },
    param4: { min: 0, max: 2,  step: 0.05, label: 'u_param4 (Lighting / Roughness)' },
});

let elapsedTime = 0;
let lastFrameTime = performance.now();
let resolutionScale = 1.0;
const mouse = [0, 0, 0, 0];   // [currX, currY, clickX, clickY]
let mouseDown = false;
const fps = fpsMeter();

let glRuntime;
try {
    glRuntime = new GLRuntime(dom.glCanvas);
} catch (err) {
    console.error('Failed to initialize WebGL2:', err);
}

if (glRuntime) {
    new ShaderEditor(dom, (code) => glRuntime.setFragmentShader(code));

    const playing = toggleButton(dom.playBtn, { on: true, labels: ['▶ Resume', '⏸ Pause'] });
    dom.resetTimeBtn.addEventListener('click', () => { elapsedTime = 0; });
    bindControl('#scaleSelect', { onChange: (v) => { resolutionScale = parseFloat(v) || 1.0; resize(); } });

    // Mouse tracking for u_mouse (GL convention: origin bottom-left).
    const toCanvas = (e) => {
        const rect = dom.glCanvas.getBoundingClientRect();
        return [e.clientX - rect.left, rect.height - (e.clientY - rect.top)];
    };
    dom.glCanvas.addEventListener('mousedown', (e) => {
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
        glRuntime.render({ time: elapsedTime, mouse, ...uniforms });
        requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
}

function resize() {
    const dpr = window.devicePixelRatio || 1;
    const rect = dom.glCanvas.getBoundingClientRect();
    if (rect.width > 0 && rect.height > 0) {
        const w = Math.round(rect.width * dpr * resolutionScale);
        const h = Math.round(rect.height * dpr * resolutionScale);
        dom.glCanvas.width = w;
        dom.glCanvas.height = h;
        dom.badgeRes.textContent = `${w} × ${h}`;
    }
}
