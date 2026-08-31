/**
 * app.js — Main Application Coordinator for Media Inspector
 *
 * Coordinates bro.media.peaks and bro.media.thumbnails extraction,
 * HTMLMediaElement playback synchronization, and responsive UI components.
 */

import { WaveformVisualizer } from './waveform.js';
import { FilmstripVisualizer } from './filmstrip.js';
import { MediaPlayer } from './player.js';
import { MetadataInspector } from './metadata.js';

export class MediaInspectorApp {
    constructor() {
        this.currentPath = '';
        this.totalDuration = 0;
        this.peaksData = null;
        this.stripData = null;
        this.currentFrom = 0;
        this.currentTo = 0;
        this.zoomFactor = 1.0;

        this._initDOM();
        this._initModules();
        this._bindEvents();
        this._checkBroMediaAvailable();
    }

    /**
     * Start the application and load default media sample.
     */
    async start() {
        const initialSample = this.dom.sampleSelect ? this.dom.sampleSelect.value : 'samples/hello.webm';
        await this.inspect(initialSample);
    }

    /**
     * Inspect and analyze a media file.
     * @param {string} path
     */
    async inspect(path) {
        if (!path) return;
        this.currentPath = path;
        this._setStatus('Analyzing media...', 'status-playing');

        // Reset zoom window
        this.currentFrom = 0;
        this.currentTo = 0;
        this.zoomFactor = 1.0;
        this._updateZoomLabel();

        try {
            // 1. Load into MediaPlayer
            const mediaInfo = await this.player.load(path);
            this.totalDuration = mediaInfo.duration || 0;

            // Handle Video vs Audio-only display stage
            if (mediaInfo.hasVideo) {
                this.dom.mediaVideo.style.display = 'block';
                this.dom.audioStage.style.display = 'none';
            } else {
                this.dom.mediaVideo.style.display = 'none';
                this.dom.audioStage.style.display = 'flex';
                const leafName = path.split(/[\/\\]/).pop() || path;
                if (this.dom.audioStageName) {
                    this.dom.audioStageName.textContent = leafName;
                }
            }

            // 2. Perform bro.media analysis
            await this.runAnalysis();

            this._setStatus('Ready', 'status-idle');
        } catch (e) {
            console.error('[MediaInspectorApp] inspect failed:', e);
            this._setStatus(`Error loading: ${e.message || e}`, 'status-paused');
        }
    }

    /**
     * Run bro.media.peaks and bro.media.thumbnails analysis with current parameters.
     */
    async runAnalysis(windowOpts = null) {
        if (typeof bro === 'undefined' || !bro.media || !bro.media.available) {
            console.warn('[MediaInspectorApp] bro.media API not available');
            this.metadata.updateAvailability(false);
            return;
        }

        this.metadata.updateAvailability(true);

        const buckets = parseInt(this.dom.optBuckets.value, 10) || 1024;
        const count = parseInt(this.dom.optThumbCount.value, 10) || 16;
        const height = parseInt(this.dom.optThumbHeight.value, 10) || 72;

        const peakOpts = { buckets };
        const thumbOpts = { count, height };

        if (windowOpts && typeof windowOpts.from === 'number' && typeof windowOpts.to === 'number') {
            peakOpts.from = windowOpts.from;
            peakOpts.to = windowOpts.to;
            thumbOpts.from = windowOpts.from;
            thumbOpts.to = windowOpts.to;
        }

        // 1. Extract Audio Peaks
        try {
            this.peaksData = bro.media.peaks(this.currentPath, peakOpts);
            if (!this.peaksData && !this.currentPath.startsWith('tools/media-inspector/')) {
                this.peaksData = bro.media.peaks(`tools/media-inspector/${this.currentPath}`, peakOpts);
            }
            if (!this.peaksData && this.currentPath.includes('hello.webm')) {
                this.peaksData = bro.media.peaks('demos/video_demo/hello.webm', peakOpts);
            }
            if (this.peaksData && this.peaksData.duration) {
                this.totalDuration = Math.max(this.totalDuration, this.peaksData.duration);
            }
        } catch (err) {
            console.warn('[MediaInspectorApp] bro.media.peaks error:', err);
            this.peaksData = null;
        }

        // 2. Extract Video Thumbnails
        try {
            this.stripData = bro.media.thumbnails(this.currentPath, thumbOpts);
            if (!this.stripData && !this.currentPath.startsWith('tools/media-inspector/')) {
                this.stripData = bro.media.thumbnails(`tools/media-inspector/${this.currentPath}`, thumbOpts);
            }
            if (!this.stripData && this.currentPath.includes('hello.webm')) {
                this.stripData = bro.media.thumbnails('demos/video_demo/hello.webm', thumbOpts);
            }
        } catch (err) {
            console.warn('[MediaInspectorApp] bro.media.thumbnails error:', err);
            this.stripData = null;
        }

        // 3. Update Visualizers
        this.waveform.setData(this.peaksData, this.totalDuration);
        this.filmstrip.setData(this.stripData, this.totalDuration);

        // 4. Update Diagnostics Metadata
        this.metadata.updateAudio(this.peaksData, this.totalDuration);
        this.metadata.updateVideo(this.stripData, this.player.getMetadata());

        // Update total duration badge & display
        this._updateTimeDisplay(this.player.currentTime, this.totalDuration);
    }

    // ── Private Setup ────────────────────────────────────────────────────────

    _initDOM() {
        this.dom = {
            sampleSelect: document.getElementById('sampleSelect'),
            customPathInput: document.getElementById('customPathInput'),
            filePicker: document.getElementById('filePicker'),
            browseBtn: document.getElementById('browseBtn'),
            loadBtn: document.getElementById('loadBtn'),
            dropZone: document.getElementById('dropZone'),

            // Preview & Transport
            mediaVideo: document.getElementById('mediaVideo'),
            audioStage: document.getElementById('audioVisualizerStage'),
            audioStageName: document.getElementById('audioStageName'),
            previewStatus: document.getElementById('previewStatus'),
            playBtn: document.getElementById('playBtn'),
            stopBtn: document.getElementById('stopBtn'),
            stepBackBtn: document.getElementById('stepBackBtn'),
            stepFwdBtn: document.getElementById('stepFwdBtn'),
            loopBtn: document.getElementById('loopBtn'),
            currentTime: document.getElementById('currentTime'),
            totalDuration: document.getElementById('totalDuration'),
            playbackRate: document.getElementById('playbackRate'),
            volumeSlider: document.getElementById('volumeSlider'),
            muteBtn: document.getElementById('muteBtn'),

            // Canvases
            waveformCanvas: document.getElementById('waveformCanvas'),
            filmstripCanvas: document.getElementById('filmstripCanvas'),
            filmstripContainer: document.getElementById('filmstripContainer'),

            // Timeline Controls
            zoomInBtn: document.getElementById('zoomInBtn'),
            zoomOutBtn: document.getElementById('zoomOutBtn'),
            zoomFitBtn: document.getElementById('zoomFitBtn'),
            zoomSelBtn: document.getElementById('zoomSelBtn'),
            zoomLabel: document.getElementById('zoomLabel'),

            // Analysis Options
            optBuckets: document.getElementById('optBuckets'),
            optThumbCount: document.getElementById('optThumbCount'),
            optThumbHeight: document.getElementById('optThumbHeight'),
            reanalyzeBtn: document.getElementById('reanalyzeBtn'),
            resetZoomBtn: document.getElementById('resetZoomBtn'),
        };
    }

    _initModules() {
        this.waveform = new WaveformVisualizer(this.dom.waveformCanvas);
        this.filmstrip = new FilmstripVisualizer(this.dom.filmstripCanvas, this.dom.filmstripContainer);
        this.player = new MediaPlayer(this.dom.mediaVideo);
        this.metadata = new MetadataInspector(document.getElementById('metaContent'));
    }

    _checkBroMediaAvailable() {
        const available = typeof bro !== 'undefined' && bro.media && Boolean(bro.media.available);
        this.metadata.updateAvailability(available);
    }

    _bindEvents() {
        // 1. Source Selection
        this.dom.sampleSelect.addEventListener('change', () => {
            const val = this.dom.sampleSelect.value;
            if (val === 'custom') {
                this.dom.customPathInput.style.display = 'inline-block';
                this.dom.browseBtn.style.display = 'inline-block';
            } else {
                this.dom.customPathInput.style.display = 'none';
                this.dom.browseBtn.style.display = 'none';
                this.inspect(val);
            }
        });

        this.dom.loadBtn.addEventListener('click', () => {
            const val = this.dom.sampleSelect.value;
            const target = (val === 'custom') ? this.dom.customPathInput.value.trim() : val;
            if (target) this.inspect(target);
        });

        this.dom.customPathInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                const target = this.dom.customPathInput.value.trim();
                if (target) this.inspect(target);
            }
        });

        this.dom.browseBtn.addEventListener('click', () => {
            this.dom.filePicker.click();
        });

        this.dom.filePicker.addEventListener('change', (e) => {
            const file = e.target.files && e.target.files[0];
            if (file) {
                // In bro/browser environments, file path or URL object
                const filePath = file.path || file.name;
                this.dom.customPathInput.value = filePath;
                this.inspect(filePath);
            }
        });

        // 2. Drag & Drop File Loading
        window.addEventListener('dragover', (e) => {
            e.preventDefault();
            this.dom.dropZone.classList.add('drag-over');
        });

        window.addEventListener('dragleave', (e) => {
            if (e.clientX === 0 && e.clientY === 0) {
                this.dom.dropZone.classList.remove('drag-over');
            }
        });

        window.addEventListener('drop', (e) => {
            e.preventDefault();
            this.dom.dropZone.classList.remove('drag-over');
            const file = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
            if (file) {
                const targetPath = file.path || file.name;
                this.dom.sampleSelect.value = 'custom';
                this.dom.customPathInput.style.display = 'inline-block';
                this.dom.customPathInput.value = targetPath;
                this.inspect(targetPath);
            }
        });

        // 3. Transport Controls
        this.dom.playBtn.addEventListener('click', () => this.player.togglePlay());
        this.dom.stopBtn.addEventListener('click', () => this.player.stop());
        this.dom.stepBackBtn.addEventListener('click', () => this.player.stepFrame(-1));
        this.dom.stepFwdBtn.addEventListener('click', () => this.player.stepFrame(1));

        this.dom.loopBtn.addEventListener('click', () => {
            const newLoop = !this.player.loop;
            this.player.setLoop(newLoop);
            this.dom.loopBtn.classList.toggle('active', newLoop);
        });

        this.dom.playbackRate.addEventListener('change', () => {
            const rate = parseFloat(this.dom.playbackRate.value) || 1.0;
            this.player.setPlaybackRate(rate);
        });

        this.dom.volumeSlider.addEventListener('input', () => {
            const vol = parseFloat(this.dom.volumeSlider.value);
            this.player.setVolume(vol);
            this._updateMuteIcon(vol === 0);
        });

        this.dom.muteBtn.addEventListener('click', () => {
            const isMuted = !this.player.muted;
            this.player.setMuted(isMuted);
            this._updateMuteIcon(isMuted);
        });

        // 4. Player Events Synchronization
        this.player.onTimeUpdate((currTime, dur) => {
            this.waveform.setPlayhead(currTime);
            this.filmstrip.setPlayhead(currTime);
            this._updateTimeDisplay(currTime, dur || this.totalDuration);
        });

        this.player.onStateChange((state) => {
            if (state === 'playing') {
                this.dom.playBtn.textContent = '⏸ Pause';
                this._setStatus('Playing', 'status-playing');
            } else if (state === 'paused') {
                this.dom.playBtn.textContent = '▶ Play';
                this._setStatus('Paused', 'status-paused');
            } else if (state === 'stopped' || state === 'ended') {
                this.dom.playBtn.textContent = '▶ Play';
                this._setStatus(state === 'ended' ? 'Ended' : 'Ready', 'status-idle');
            }
        });

        // 5. Scrubber & Timeline Synchronization
        this.waveform.onSeek((time) => {
            this.player.seek(time);
            this.filmstrip.setPlayhead(time);
        });

        this.filmstrip.onSeek((time) => {
            this.player.seek(time);
            this.waveform.setPlayhead(time);
        });

        // 6. Zoom Controls
        this.dom.zoomInBtn.addEventListener('click', () => {
            this.waveform.zoom(1.5);
            this._updateZoomFactor();
        });

        this.dom.zoomOutBtn.addEventListener('click', () => {
            this.waveform.zoom(0.67);
            this._updateZoomFactor();
        });

        this.dom.zoomFitBtn.addEventListener('click', () => {
            this.waveform.fit();
            this.filmstrip.setWindow(0, this.totalDuration);
            this.zoomFactor = 1.0;
            this._updateZoomLabel();
        });

        this.dom.zoomSelBtn.addEventListener('click', () => {
            const sel = this.waveform.getSelection();
            if (sel) {
                this.waveform.setWindow(sel.from, sel.to);
                this.filmstrip.setWindow(sel.from, sel.to);
                this._updateZoomFactor();
            }
        });

        this.dom.reanalyzeBtn.addEventListener('click', () => {
            this.runAnalysis();
        });

        this.dom.resetZoomBtn.addEventListener('click', () => {
            this.waveform.fit();
            this.filmstrip.setWindow(0, this.totalDuration);
            this.runAnalysis();
            this.zoomFactor = 1.0;
            this._updateZoomLabel();
        });

        // 7. Keyboard Shortcuts
        window.addEventListener('keydown', (e) => {
            if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') return;
            if (e.code === 'Space') {
                e.preventDefault();
                this.player.togglePlay();
            } else if (e.code === 'ArrowLeft') {
                e.preventDefault();
                this.player.seek(this.player.currentTime - 1);
            } else if (e.code === 'ArrowRight') {
                e.preventDefault();
                this.player.seek(this.player.currentTime + 1);
            } else if (e.code === 'Home') {
                e.preventDefault();
                this.player.seek(0);
            } else if (e.code === 'Escape') {
                this.waveform.fit();
                this.zoomFactor = 1.0;
                this._updateZoomLabel();
            }
        });

        // 8. Responsive Resizing
        window.addEventListener('resize', () => {
            this.waveform.resize();
            this.filmstrip.resize();
        });
    }

    _updateTimeDisplay(curr, total) {
        if (this.dom.currentTime) {
            this.dom.currentTime.textContent = this.metadata.formatTimecode(curr);
        }
        if (this.dom.totalDuration) {
            this.dom.totalDuration.textContent = this.metadata.formatTimecode(total);
        }
    }

    _updateZoomFactor() {
        const span = this.waveform.windowTo - this.waveform.windowFrom;
        if (span > 0 && this.totalDuration > 0) {
            this.zoomFactor = Math.max(1, this.totalDuration / span);
        } else {
            this.zoomFactor = 1.0;
        }
        this._updateZoomLabel();
    }

    _updateZoomLabel() {
        if (this.dom.zoomLabel) {
            this.dom.zoomLabel.textContent = `${this.zoomFactor.toFixed(1)}x`;
        }
    }

    _updateMuteIcon(isMuted) {
        if (this.dom.muteBtn) {
            this.dom.muteBtn.textContent = isMuted ? '🔇' : '🔊';
        }
    }

    _setStatus(text, className) {
        if (!this.dom.previewStatus) return;
        this.dom.previewStatus.textContent = text;
        this.dom.previewStatus.className = `sub-label ${className || 'status-idle'}`;
    }
}

// Bootstrap app on DOM load
window.addEventListener('DOMContentLoaded', () => {
    window.mediaInspectorApp = new MediaInspectorApp();
    window.mediaInspectorApp.start();
});
