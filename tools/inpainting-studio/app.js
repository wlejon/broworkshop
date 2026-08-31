// tools/inpainting-studio/app.js
import { MaskCanvasController } from './mask-canvas.js';
import { ControlNetAnnotator } from './controlnet.js';
import { InpaintingPipeline } from './diffusion-pipeline.js';

class InpaintingStudioApp {
    constructor() {
        this.dom = {
            baseCanvas: document.getElementById('baseCanvas'),
            maskCanvas: document.getElementById('maskCanvas'),
            controlCanvas: document.getElementById('controlCanvas'),
            resultCanvas: document.getElementById('resultCanvas'),
            toolBrush: document.getElementById('toolBrush'),
            toolEraser: document.getElementById('toolEraser'),
            brushSize: document.getElementById('brushSize'),
            brushSizeVal: document.getElementById('brushSizeVal'),
            brushHardness: document.getElementById('brushHardness'),
            brushHardnessVal: document.getElementById('brushHardnessVal'),
            invertMaskBtn: document.getElementById('invertMaskBtn'),
            clearMaskBtn: document.getElementById('clearMaskBtn'),
            fillMaskBtn: document.getElementById('fillMaskBtn'),
            expandNorth: document.getElementById('expandNorth'),
            expandSouth: document.getElementById('expandSouth'),
            expandWest: document.getElementById('expandWest'),
            expandEast: document.getElementById('expandEast'),
            presetSelect: document.getElementById('presetSelect'),
            uploadImgBtn: document.getElementById('uploadImgBtn'),
            fileInput: document.getElementById('fileInput'),
            positivePrompt: document.getElementById('positivePrompt'),
            negativePrompt: document.getElementById('negativePrompt'),
            denoiseStrength: document.getElementById('denoiseStrength'),
            denoiseVal: document.getElementById('denoiseVal'),
            cfgScale: document.getElementById('cfgScale'),
            cfgVal: document.getElementById('cfgVal'),
            sampleSteps: document.getElementById('sampleSteps'),
            stepsVal: document.getElementById('stepsVal'),
            fillModeSelect: document.getElementById('fillModeSelect'),
            controlnetMode: document.getElementById('controlnetMode'),
            controlWeight: document.getElementById('controlWeight'),
            controlWeightVal: document.getElementById('controlWeightVal'),
            generateBtn: document.getElementById('generateBtn'),
            modeBtns: document.querySelectorAll('.mode-btn'),
        };

        this.maskController = new MaskCanvasController(
            this.dom.baseCanvas,
            this.dom.maskCanvas,
            () => this.onMaskChanged()
        );

        this.controlNet = new ControlNetAnnotator(this.dom.controlCanvas);
        this.pipeline = new InpaintingPipeline(this.dom.resultCanvas);

        this.currentViewMode = 'composite';

        this.initEvents();
        this.loadPreset('portrait');
    }

    initEvents() {
        // Tools
        this.dom.toolBrush.addEventListener('click', () => {
            this.maskController.tool = 'brush';
            this.dom.toolBrush.classList.add('active');
            this.dom.toolEraser.classList.remove('active');
        });

        this.dom.toolEraser.addEventListener('click', () => {
            this.maskController.tool = 'eraser';
            this.dom.toolEraser.classList.add('active');
            this.dom.toolBrush.classList.remove('active');
        });

        this.dom.brushSize.addEventListener('input', (e) => {
            const v = parseInt(e.target.value, 10);
            this.maskController.brushSize = v;
            this.dom.brushSizeVal.textContent = v + 'px';
        });

        this.dom.brushHardness.addEventListener('input', (e) => {
            const v = parseInt(e.target.value, 10);
            this.maskController.brushHardness = v / 100;
            this.dom.brushHardnessVal.textContent = v + '%';
        });

        // Mask actions
        this.dom.invertMaskBtn.addEventListener('click', () => this.maskController.invertMask());
        this.dom.clearMaskBtn.addEventListener('click', () => this.maskController.clearMask());
        this.dom.fillMaskBtn.addEventListener('click', () => this.maskController.fillMask());

        // Outpainting expansion
        this.dom.expandNorth.addEventListener('click', () => this.maskController.expandBounds(0, -64));
        this.dom.expandSouth.addEventListener('click', () => this.maskController.expandBounds(0, 64));
        this.dom.expandWest.addEventListener('click', () => this.maskController.expandBounds(-64, 0));
        this.dom.expandEast.addEventListener('click', () => this.maskController.expandBounds(64, 0));

        // Presets
        this.dom.presetSelect.addEventListener('change', () => {
            this.loadPreset(this.dom.presetSelect.value);
        });

        this.dom.uploadImgBtn.addEventListener('click', () => this.dom.fileInput.click());
        this.dom.fileInput.addEventListener('change', (e) => {
            if (e.target.files && e.target.files[0]) {
                this.loadFile(e.target.files[0]);
            }
        });

        // Sliders
        this.dom.denoiseStrength.addEventListener('input', (e) => {
            this.dom.denoiseVal.textContent = parseFloat(e.target.value).toFixed(2);
        });
        this.dom.cfgScale.addEventListener('input', (e) => {
            this.dom.cfgVal.textContent = parseFloat(e.target.value).toFixed(1);
        });
        this.dom.sampleSteps.addEventListener('input', (e) => {
            this.dom.stepsVal.textContent = e.target.value;
        });
        this.dom.controlWeight.addEventListener('input', (e) => {
            this.dom.controlWeightVal.textContent = parseFloat(e.target.value).toFixed(2);
        });

        this.dom.controlnetMode.addEventListener('change', () => {
            this.updateControlNet();
        });

        // View Modes
        this.dom.modeBtns.forEach(btn => {
            btn.addEventListener('click', () => {
                this.dom.modeBtns.forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                this.setViewMode(btn.dataset.mode);
            });
        });

        this.dom.generateBtn.addEventListener('click', () => this.generateInpaint());
    }

    setViewMode(mode) {
        this.currentViewMode = mode;
        this.dom.maskCanvas.style.display = (mode === 'composite' || mode === 'mask-only') ? 'block' : 'none';
        this.dom.controlCanvas.style.display = (mode === 'controlnet') ? 'block' : 'none';
        this.dom.resultCanvas.style.display = (mode === 'result') ? 'block' : 'none';
    }

    loadPreset(key) {
        const w = 512, h = 512;
        const ctx = this.dom.baseCanvas.getContext('2d');
        ctx.clearRect(0, 0, w, h);

        if (key === 'portrait') {
            const bg = ctx.createLinearGradient(0, 0, w, h);
            bg.addColorStop(0, '#10002b');
            bg.addColorStop(1, '#240046');
            ctx.fillStyle = bg;
            ctx.fillRect(0, 0, w, h);

            // Portrait silhouette
            ctx.fillStyle = '#ff9e00';
            ctx.beginPath();
            ctx.arc(w * 0.5, h * 0.45, 90, 0, Math.PI * 2);
            ctx.fill();

            // Robe / chest
            ctx.fillStyle = '#3c096c';
            ctx.beginPath();
            ctx.arc(w * 0.5, h * 0.9, 160, Math.PI, 0);
            ctx.fill();
        } else if (key === 'landscape') {
            const sky = ctx.createLinearGradient(0, 0, 0, h);
            sky.addColorStop(0, '#0077b6');
            sky.addColorStop(1, '#90e0ef');
            ctx.fillStyle = sky;
            ctx.fillRect(0, 0, w, h);

            ctx.fillStyle = '#2d6a4f';
            ctx.beginPath();
            ctx.arc(w * 0.5, h * 0.85, 180, Math.PI, 0);
            ctx.fill();
        } else {
            ctx.fillStyle = '#0f172a';
            ctx.fillRect(0, 0, w, h);
            ctx.fillStyle = '#38bdf8';
            ctx.fillRect(w * 0.2, h * 0.3, w * 0.6, h * 0.4);
        }

        this.maskController.clearMask();
        this.updateControlNet();
    }

    loadFile(file) {
        const reader = new FileReader();
        reader.onload = (e) => {
            const img = new Image();
            img.onload = () => {
                const ctx = this.dom.baseCanvas.getContext('2d');
                ctx.clearRect(0, 0, 512, 512);
                ctx.drawImage(img, 0, 0, 512, 512);
                this.maskController.clearMask();
                this.updateControlNet();
            };
            img.src = e.target.result;
        };
        reader.readAsDataURL(file);
    }

    onMaskChanged() {
        // Triggered whenever mask is painted/modified
    }

    updateControlNet() {
        const mode = this.dom.controlnetMode.value;
        this.controlNet.process(this.dom.baseCanvas, mode);
    }

    async generateInpaint() {
        this.dom.generateBtn.disabled = true;
        this.dom.generateBtn.textContent = '⏳ Inpainting...';

        const opts = {
            prompt: this.dom.positivePrompt.value,
            negativePrompt: this.dom.negativePrompt.value,
            denoise: parseFloat(this.dom.denoiseStrength.value),
            cfg: parseFloat(this.dom.cfgScale.value),
            steps: parseInt(this.dom.sampleSteps.value, 10),
            fillMode: this.dom.fillModeSelect.value,
            controlWeight: parseFloat(this.dom.controlWeight.value),
        };

        await this.pipeline.runInpaint(
            this.dom.baseCanvas,
            this.dom.maskCanvas,
            this.dom.controlCanvas,
            opts
        );

        // Switch to result view mode
        this.dom.modeBtns.forEach(b => {
            b.classList.toggle('active', b.dataset.mode === 'result');
        });
        this.setViewMode('result');

        this.dom.generateBtn.disabled = false;
        this.dom.generateBtn.textContent = '✨ Generate Inpainting';
    }
}

window.addEventListener('DOMContentLoaded', () => {
    new InpaintingStudioApp();
});
