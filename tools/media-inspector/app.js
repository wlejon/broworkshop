// tools/media-inspector/app.js
import { WaveformViewer } from './waveform.js';
import { FilmstripViewer } from './filmstrip.js';
import { MediaPlayer } from './player.js';
import { MetadataInspector } from './metadata.js';

class MediaInspectorApp {
    constructor() {
        this.dom = {
            sampleSelect: document.getElementById('sampleSelect'),
            customPathInput: document.getElementById('customPathInput'),
            loadBtn: document.getElementById('loadBtn'),
            mediaVideo: document.getElementById('mediaVideo'),
            audioVisualizerStage: document.getElementById('audioVisualizerStage'),
            audioStageName: document.getElementById('audioStageName'),
            previewStatus: document.getElementById('previewStatus'),
            playBtn: document.getElementById('playBtn'),
            stopBtn: document.getElementById('stopBtn'),
            loopBtn: document.getElementById('loopBtn'),
            currentTime: document.getElementById('currentTime'),
            totalDuration: document.getElementById('totalDuration'),
            playbackRate: document.getElementById('playbackRate'),
            volumeSlider: document.getElementById('volumeSlider'),
            optBuckets: document.getElementById('optBuckets'),
            optThumbCount: document.getElementById('optThumbCount'),
            reanalyzeBtn: document.getElementById('reanalyzeBtn'),
            waveformCanvas: document.getElementById('waveformCanvas'),
            filmstripCanvas: document.getElementById('filmstripCanvas'),
            zoomInBtn: document.getElementById('zoomInBtn'),
            zoomOutBtn: document.getElementById('zoomOutBtn'),
            zoomFitBtn: document.getElementById('zoomFitBtn'),
            zoomLabel: document.getElementById('zoomLabel'),
        };

        this.currentPath = '';
        this.currentPeaks = null;
        this.currentThumbnails = null;
        this.zoomLevel = 1.0;

        this.metadataInspector = new MetadataInspector();
        this.waveformViewer = new WaveformViewer(this.dom.waveformCanvas, (time) => {
            this.player.seek(time);
        });
        this.filmstripViewer = new FilmstripViewer(this.dom.filmstripCanvas, (time) => {
            this.player.seek(time);
        });

        this.player = new MediaPlayer(
            this.dom.mediaVideo,
            (time) => this.onTimeUpdate(time),
            (state) => this.onPlayerStateChange(state)
        );

        this.initEvents();
        this.loadSelectedMedia();
    }

    initEvents() {
        this.dom.sampleSelect.addEventListener('change', () => {
            if (this.dom.sampleSelect.value === 'custom') {
                this.dom.customPathInput.style.display = 'inline-block';
            } else {
                this.dom.customPathInput.style.display = 'none';
                this.loadSelectedMedia();
            }
        });

        this.dom.loadBtn.addEventListener('click', () => this.loadSelectedMedia());
        this.dom.reanalyzeBtn.addEventListener('click', () => this.analyzeCurrentMedia());

        // Transport buttons
        this.dom.playBtn.addEventListener('click', () => this.player.togglePlay());
        this.dom.stopBtn.addEventListener('click', () => this.player.stop());
        this.dom.loopBtn.addEventListener('click', () => {
            const isLoop = !this.player.isLooping;
            this.player.setLoop(isLoop);
            this.dom.loopBtn.classList.toggle('active', isLoop);
        });

        this.dom.playbackRate.addEventListener('change', (e) => {
            this.player.setPlaybackRate(e.target.value);
        });

        this.dom.volumeSlider.addEventListener('input', (e) => {
            this.player.setVolume(e.target.value);
        });

        // Zoom controls
        this.dom.zoomInBtn.addEventListener('click', () => {
            this.setZoom(this.zoomLevel * 1.5);
        });
        this.dom.zoomOutBtn.addEventListener('click', () => {
            this.setZoom(this.zoomLevel / 1.5);
        });
        this.dom.zoomFitBtn.addEventListener('click', () => {
            this.setZoom(1.0);
        });

        window.addEventListener('resize', () => {
            this.waveformViewer.resize();
            this.waveformViewer.render();
        });
    }

    setZoom(val) {
        this.zoomLevel = Math.max(1.0, Math.min(16.0, val));
        this.dom.zoomLabel.textContent = this.zoomLevel.toFixed(1) + 'x';
        this.waveformViewer.setZoom(this.zoomLevel);
    }

    formatTime(sec) {
        if (!Number.isFinite(sec) || sec < 0) sec = 0;
        const m = Math.floor(sec / 60);
        const s = Math.floor(sec % 60);
        const ms = Math.floor((sec % 1) * 1000);
        return String(m).padStart(2, '0') + ':' +
               String(s).padStart(2, '0') + '.' +
               String(ms).padStart(3, '0');
    }

    onTimeUpdate(currentTime) {
        this.dom.currentTime.textContent = this.formatTime(currentTime);
        this.waveformViewer.setCurrentTime(currentTime);
    }

    onPlayerStateChange(state) {
        if (state.isPlaying !== undefined) {
            this.dom.playBtn.textContent = state.isPlaying ? '⏸ Pause' : '▶ Play';
            this.dom.playBtn.classList.toggle('active', state.isPlaying);
        }
        if (state.duration !== undefined) {
            this.dom.totalDuration.textContent = this.formatTime(state.duration);
        }
    }

    loadSelectedMedia() {
        let path = this.dom.sampleSelect.value;
        if (path === 'custom') {
            path = this.dom.customPathInput.value.trim();
        }
        if (!path) return;

        this.currentPath = path;
        this.dom.previewStatus.textContent = 'Loading: ' + path;

        const isVideo = path.endsWith('.webm') || path.endsWith('.mp4');
        if (isVideo) {
            this.dom.mediaVideo.style.display = 'block';
            this.dom.audioVisualizerStage.style.display = 'none';
        } else {
            this.dom.mediaVideo.style.display = 'none';
            this.dom.audioVisualizerStage.style.display = 'flex';
            this.dom.audioStageName.textContent = path.split('/').pop() || path;
        }

        this.player.load(path);
        this.analyzeCurrentMedia();
    }

    analyzeCurrentMedia() {
        if (!this.currentPath) return;

        const buckets = parseInt(this.dom.optBuckets.value, 10) || 1024;
        const thumbCount = parseInt(this.dom.optThumbCount.value, 10) || 16;

        let peaks = null;
        let thumbs = null;

        if (typeof bro !== 'undefined' && bro.media && bro.media.available) {
            try {
                peaks = bro.media.peaks(this.currentPath, { buckets: buckets });
            } catch (e) {
                console.warn('bro.media.peaks error:', e);
            }

            try {
                thumbs = bro.media.thumbnails(this.currentPath, { count: thumbCount, height: 72 });
            } catch (e) {
                console.warn('bro.media.thumbnails error:', e);
            }
        }

        this.currentPeaks = peaks;
        this.currentThumbnails = thumbs;

        this.waveformViewer.resize();
        this.waveformViewer.setPeaks(peaks);
        this.filmstripViewer.setThumbnails(thumbs);
        this.metadataInspector.update(peaks, thumbs);

        if (peaks) {
            this.dom.totalDuration.textContent = this.formatTime(peaks.duration);
        }

        this.dom.previewStatus.textContent = 'Inspected';
    }
}

window.addEventListener('DOMContentLoaded', () => {
    new MediaInspectorApp();
});
