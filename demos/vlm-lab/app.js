// demos/vlm-lab/app.js
import { ImageLoader } from './image-loader.js';
import { VLMEngine } from './vlm-engine.js';
import { ChatUI } from './chat-ui.js';

class VLMLabApp {
    constructor() {
        this.dom = {
            imageCanvas: document.getElementById('imageCanvas'),
            overlayCanvas: document.getElementById('overlayCanvas'),
            sampleImageSelect: document.getElementById('sampleImageSelect'),
            uploadBtn: document.getElementById('uploadBtn'),
            fileInput: document.getElementById('fileInput'),
            groundedTags: document.getElementById('groundedTags'),
            chatHistory: document.getElementById('chatHistory'),
            clearChatBtn: document.getElementById('clearChatBtn'),
            promptInput: document.getElementById('promptInput'),
            sendBtn: document.getElementById('sendBtn'),
            badgeTokens: document.getElementById('badgeTokens'),
            badgeLatency: document.getElementById('badgeLatency'),
            modelSelect: document.getElementById('modelSelect'),
        };

        this.currentImageContext = null;
        this.isGenerating = false;

        this.vlmEngine = new VLMEngine();
        this.chatUI = new ChatUI(this.dom.chatHistory, this.dom.groundedTags);
        this.imageLoader = new ImageLoader(
            this.dom.imageCanvas,
            this.dom.overlayCanvas,
            (ctx) => {
                this.currentImageContext = ctx;
            }
        );

        this.initEvents();
    }

    initEvents() {
        this.dom.sampleImageSelect.addEventListener('change', () => {
            this.imageLoader.loadPreset(this.dom.sampleImageSelect.value);
            this.imageLoader.clearOverlay();
            this.chatUI.updateGroundedTags([]);
        });

        this.dom.uploadBtn.addEventListener('click', () => {
            this.dom.fileInput.click();
        });

        this.dom.fileInput.addEventListener('change', (e) => {
            if (e.target.files && e.target.files[0]) {
                this.imageLoader.loadFile(e.target.files[0]);
            }
        });

        this.dom.clearChatBtn.addEventListener('click', () => {
            this.chatUI.clear();
            this.imageLoader.clearOverlay();
        });

        this.dom.sendBtn.addEventListener('click', () => this.handleSend());

        this.dom.promptInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                this.handleSend();
            }
        });

        document.querySelectorAll('.quick-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                const prompt = btn.dataset.prompt;
                this.dom.promptInput.value = prompt;
                this.handleSend();
            });
        });
    }

    async handleSend() {
        if (this.isGenerating) return;
        const text = this.dom.promptInput.value.trim();
        if (!text) return;

        this.dom.promptInput.value = '';
        this.isGenerating = true;
        this.dom.sendBtn.disabled = true;

        this.chatUI.appendUserMessage(text);
        const streamingBody = this.chatUI.createAssistantMessage();

        const result = await this.vlmEngine.generateResponse(
            text,
            this.currentImageContext,
            (chunk) => {
                streamingBody.textContent += chunk;
                this.chatUI.scrollToBottom();
            }
        );

        if (result.boxes && result.boxes.length > 0) {
            this.imageLoader.renderBoundingBoxes(result.boxes);
            this.chatUI.updateGroundedTags(result.boxes);
        }

        this.dom.badgeLatency.textContent = `${result.latencyMs} ms`;
        this.dom.badgeTokens.textContent = `${result.tokensPerSec} tok/s`;

        this.isGenerating = false;
        this.dom.sendBtn.disabled = false;
    }
}

window.addEventListener('DOMContentLoaded', () => {
    new VLMLabApp();
});
