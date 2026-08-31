// tools/shader-lab/app.js
import { GLRuntime } from './gl-runtime.js';
import { ShaderEditor } from './editor.js';

class ShaderLabApp {
    constructor() {
        this.dom = {
            glCanvas: document.getElementById('glCanvas'),
            presetSelect: document.getElementById('presetSelect'),
            compileBtn: document.getElementById('compileBtn'),
            formatBtn: document.getElementById('formatBtn'),
            copyBtn: document.getElementById('copyBtn'),
            shaderCode: document.getElementById('shaderCode'),
            logStatus: document.getElementById('logStatus'),
            logOutput: document.getElementById('logOutput'),
            playBtn: document.getElementById('playBtn'),
            resetTimeBtn: document.getElementById('resetTimeBtn'),
            scaleSelect: document.getElementById('scaleSelect'),
            badgeFps: document.getElementById('badgeFps'),
            badgeRes: document.getElementById('badgeRes'),
            param1: document.getElementById('param1'),
            param1Val: document.getElementById('param1Val'),
            param2: document.getElementById('param2'),
            param2Val: document.getElementById('param2Val'),
            param3: document.getElementById('param3'),
            param3Val: document.getElementById('param3Val'),
            param4: document.getElementById('param4'),
            param4Val: document.getElementById('param4Val'),
        };

        this.isPlaying = true;
        this.elapsedTime = 0;
        this.lastFrameTime = performance.now();
        this.fpsFrames = 0;
        this.fpsLastCalc = performance.now();

        this.mouse = [0, 0, 0, 0]; // [currX, currY, clickX, clickY]
        this.isMouseDown = false;
        this.resolutionScale = 1.0;

        try {
            this.glRuntime = new GLRuntime(this.dom.glCanvas);
        } catch (err) {
            console.error('Failed to initialize WebGL2:', err);
            return;
        }

        this.editor = new ShaderEditor(this.dom, (code) => {
            return this.glRuntime.setFragmentShader(code);
        });

        this.initEvents();
        this.resize();

        this.loop = this.loop.bind(this);
        requestAnimationFrame(this.loop);
    }

    initEvents() {
        this.dom.playBtn.addEventListener('click', () => {
            this.isPlaying = !this.isPlaying;
            this.dom.playBtn.textContent = this.isPlaying ? '⏸ Pause' : '▶ Resume';
            this.dom.playBtn.classList.toggle('active', this.isPlaying);
        });

        this.dom.resetTimeBtn.addEventListener('click', () => {
            this.elapsedTime = 0;
        });

        this.dom.scaleSelect.addEventListener('change', (e) => {
            this.resolutionScale = parseFloat(e.target.value) || 1.0;
            this.resize();
        });

        // Mouse tracking for u_mouse
        const canvas = this.dom.glCanvas;
        canvas.addEventListener('mousedown', (e) => {
            this.isMouseDown = true;
            const rect = canvas.getBoundingClientRect();
            const x = e.clientX - rect.left;
            const y = rect.height - (e.clientY - rect.top);
            this.mouse[0] = x;
            this.mouse[1] = y;
            this.mouse[2] = x;
            this.mouse[3] = y;
        });

        window.addEventListener('mousemove', (e) => {
            if (!this.isMouseDown) return;
            const rect = canvas.getBoundingClientRect();
            const x = e.clientX - rect.left;
            const y = rect.height - (e.clientY - rect.top);
            this.mouse[0] = x;
            this.mouse[1] = y;
        });

        window.addEventListener('mouseup', () => {
            this.isMouseDown = false;
            this.mouse[2] = 0;
            this.mouse[3] = 0;
        });

        // Sliders
        const setupSlider = (slider, label) => {
            slider.addEventListener('input', (e) => {
                label.textContent = parseFloat(e.target.value).toFixed(2);
            });
        };
        setupSlider(this.dom.param1, this.dom.param1Val);
        setupSlider(this.dom.param2, this.dom.param2Val);
        setupSlider(this.dom.param3, this.dom.param3Val);
        setupSlider(this.dom.param4, this.dom.param4Val);

        window.addEventListener('resize', () => this.resize());
    }

    resize() {
        const dpr = window.devicePixelRatio || 1;
        const rect = this.dom.glCanvas.getBoundingClientRect();
        if (rect.width > 0 && rect.height > 0) {
            const w = Math.round(rect.width * dpr * this.resolutionScale);
            const h = Math.round(rect.height * dpr * this.resolutionScale);
            this.dom.glCanvas.width = w;
            this.dom.glCanvas.height = h;
            this.dom.badgeRes.textContent = `${w} × ${h}`;
        }
    }

    loop(now) {
        const dt = Math.min(0.1, (now - this.lastFrameTime) * 0.001);
        this.lastFrameTime = now;

        if (this.isPlaying) {
            this.elapsedTime += dt;
        }

        // FPS calculation
        this.fpsFrames++;
        if (now - this.fpsLastCalc > 500) {
            const fps = Math.round((this.fpsFrames * 1000) / (now - this.fpsLastCalc));
            this.dom.badgeFps.textContent = `${fps} FPS`;
            this.fpsFrames = 0;
            this.fpsLastCalc = now;
        }

        const uniforms = {
            time: this.elapsedTime,
            mouse: this.mouse,
            param1: parseFloat(this.dom.param1.value),
            param2: parseFloat(this.dom.param2.value),
            param3: parseFloat(this.dom.param3.value),
            param4: parseFloat(this.dom.param4.value),
        };

        this.glRuntime.render(uniforms);
        requestAnimationFrame(this.loop);
    }
}

window.addEventListener('DOMContentLoaded', () => {
    new ShaderLabApp();
});
