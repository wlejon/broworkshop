// tools/shader-lab/editor.js
import { PRESETS } from './presets.js';

export class ShaderEditor {
    constructor(domElements, onCompile) {
        this.dom = domElements;
        this.onCompile = onCompile;
        this.currentPresetKey = 'raymarch';

        this.initEvents();
        this.loadPreset('raymarch');
    }

    initEvents() {
        this.dom.presetSelect.addEventListener('change', () => {
            this.loadPreset(this.dom.presetSelect.value);
        });

        this.dom.compileBtn.addEventListener('click', () => {
            this.triggerCompile();
        });

        this.dom.formatBtn.addEventListener('click', () => {
            this.loadPreset(this.currentPresetKey);
        });

        this.dom.copyBtn.addEventListener('click', () => {
            navigator.clipboard.writeText(this.dom.shaderCode.value).then(() => {
                this.dom.copyBtn.textContent = 'Copied!';
                setTimeout(() => { this.dom.copyBtn.textContent = 'Copy Code'; }, 1500);
            });
        });

        // Shortcut Ctrl+S / Cmd+S
        window.addEventListener('keydown', (e) => {
            if ((e.ctrlKey || e.metaKey) && e.key === 's') {
                e.preventDefault();
                this.triggerCompile();
            }
        });
    }

    loadPreset(key) {
        this.currentPresetKey = key;
        const code = PRESETS[key] || PRESETS.raymarch;
        this.dom.shaderCode.value = code;
        this.triggerCompile();
    }

    triggerCompile() {
        const code = this.dom.shaderCode.value;
        if (this.onCompile) {
            const res = this.onCompile(code);
            this.updateLog(res);
        }
    }

    updateLog(result) {
        if (result.success) {
            this.dom.logStatus.textContent = 'Compiled cleanly';
            this.dom.logStatus.className = 'status-ok';
            this.dom.logOutput.textContent = result.log || 'OK';
        } else {
            this.dom.logStatus.textContent = 'Compilation Error';
            this.dom.logStatus.className = 'status-err';
            this.dom.logOutput.textContent = result.error || 'Unknown error';
        }
    }
}
