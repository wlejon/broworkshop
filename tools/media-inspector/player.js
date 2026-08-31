/**
 * player.js — Synchronized Media Playback Engine
 *
 * Wraps HTMLMediaElement (<video>) and synchronizes playback clock
 * with waveform visualizer and filmstrip timelines.
 */

export class MediaPlayer {
    /**
     * @param {HTMLVideoElement} videoElement
     * @param {Object} [options]
     */
    constructor(videoElement, options = {}) {
        this.video = videoElement;
        this.options = Object.assign({
            updateIntervalMs: 16,
        }, options);

        this.src = '';
        this.isLoaded = false;
        this.hasVideoTrack = false;
        this.hasAudioTrack = false;
        this.animFrameId = null;

        // Event callbacks
        this.onTimeUpdateCallback = null;
        this.onStateChangeCallback = null;
        this.onMetadataCallback = null;
        this.onErrorCallback = null;

        this._bindVideoEvents();
    }

    /**
     * Load a media file path or URL into the video player.
     * @param {string} srcPath
     * @returns {Promise<Object>}
     */
    load(srcPath) {
        this.pause();
        this.src = srcPath;
        this.isLoaded = false;

        return new Promise((resolve, reject) => {
            const onMeta = () => {
                cleanup();
                this.isLoaded = true;
                this.hasVideoTrack = (this.video.videoWidth > 0 && this.video.videoHeight > 0);
                const info = this.getMetadata();
                if (this.onMetadataCallback) this.onMetadataCallback(info);
                resolve(info);
            };

            const onErr = (e) => {
                cleanup();
                const err = this.video.error || e;
                if (this.onErrorCallback) this.onErrorCallback(err);
                reject(err);
            };

            const cleanup = () => {
                this.video.removeEventListener('loadedmetadata', onMeta);
                this.video.removeEventListener('error', onErr);
            };

            this.video.addEventListener('loadedmetadata', onMeta, { once: true });
            this.video.addEventListener('error', onErr, { once: true });

            // Apply source
            this.video.src = srcPath;
            this.video.load();

            // Safety timeout in case readyState is already updated
            setTimeout(() => {
                if (this.video.readyState >= 1 && !this.isLoaded) {
                    onMeta();
                }
            }, 300);
        });
    }

    /**
     * Play media.
     * @returns {Promise<void>}
     */
    async play() {
        try {
            await this.video.play();
            this._startClockLoop();
            this._notifyState('playing');
        } catch (e) {
            console.warn('[MediaPlayer] play failed:', e);
            this._notifyState('error');
            if (this.onErrorCallback) this.onErrorCallback(e);
        }
    }

    /**
     * Pause media.
     */
    pause() {
        this.video.pause();
        this._stopClockLoop();
        this._notifyState('paused');
        this._emitTimeUpdate();
    }

    /**
     * Toggle play/pause state.
     */
    togglePlay() {
        if (this.video.paused || this.video.ended) {
            return this.play();
        } else {
            this.pause();
        }
    }

    /**
     * Stop and reset playback to start.
     */
    stop() {
        this.pause();
        this.seek(0);
        this._notifyState('stopped');
    }

    /**
     * Seek to exact timestamp in seconds.
     * @param {number} time
     */
    seek(time) {
        if (isNaN(time)) return;
        const dur = this.duration || 0;
        const clamped = Math.max(0, dur > 0 ? Math.min(dur, time) : time);
        this.video.currentTime = clamped;
        this._emitTimeUpdate();
    }

    /**
     * Step single frame forward (+1) or backward (-1).
     * @param {number} direction
     */
    stepFrame(direction = 1) {
        this.pause();
        if (typeof this.video.stepFrame === 'function') {
            this.video.stepFrame(direction);
        } else {
            // Fallback estimation (e.g. 30fps = ~0.033s)
            const dt = direction > 0 ? (1 / 30) : -(1 / 30);
            this.seek(this.currentTime + dt);
        }
        this._emitTimeUpdate();
    }

    /**
     * Set playback speed rate.
     * @param {number} rate
     */
    setPlaybackRate(rate) {
        this.video.playbackRate = Math.max(0.1, Math.min(16, rate));
    }

    /**
     * Set volume level (0.0 to 1.0).
     * @param {number} vol
     */
    setVolume(vol) {
        this.video.volume = Math.max(0, Math.min(1, vol));
        if (this.video.volume > 0 && this.video.muted) {
            this.video.muted = false;
        }
    }

    /**
     * Set looping state.
     * @param {boolean} loop
     */
    setLoop(loop) {
        this.video.loop = Boolean(loop);
    }

    /**
     * Set muted state.
     * @param {boolean} muted
     */
    setMuted(muted) {
        this.video.muted = Boolean(muted);
    }

    // Getters
    get currentTime() {
        return this.video.currentTime || 0;
    }

    get duration() {
        return this.video.duration || 0;
    }

    get paused() {
        return this.video.paused;
    }

    get ended() {
        return this.video.ended;
    }

    get isPlaying() {
        return !this.video.paused && !this.video.ended;
    }

    get volume() {
        return this.video.volume;
    }

    get muted() {
        return this.video.muted;
    }

    get playbackRate() {
        return this.video.playbackRate;
    }

    get loop() {
        return this.video.loop;
    }

    get videoWidth() {
        return this.video.videoWidth || 0;
    }

    get videoHeight() {
        return this.video.videoHeight || 0;
    }

    get videoRotation() {
        return this.video.videoRotation || 0;
    }

    getMetadata() {
        return {
            duration: this.duration,
            videoWidth: this.videoWidth,
            videoHeight: this.videoHeight,
            videoRotation: this.videoRotation,
            hasVideo: this.videoWidth > 0 && this.videoHeight > 0,
            readyState: this.video.readyState,
            networkState: this.video.networkState,
        };
    }

    /**
     * Set timeupdate callback.
     * @param {(currentTime: number, duration: number) => void} cb
     */
    onTimeUpdate(cb) {
        this.onTimeUpdateCallback = cb;
    }

    /**
     * Set state change callback.
     * @param {(state: 'playing' | 'paused' | 'stopped' | 'ended' | 'error') => void} cb
     */
    onStateChange(cb) {
        this.onStateChangeCallback = cb;
    }

    /**
     * Set loadedmetadata callback.
     * @param {(info: Object) => void} cb
     */
    onLoadedMetadata(cb) {
        this.onMetadataCallback = cb;
    }

    /**
     * Set error callback.
     * @param {(err: any) => void} cb
     */
    onError(cb) {
        this.onErrorCallback = cb;
    }

    /**
     * Destroy / unbind player.
     */
    destroy() {
        this._stopClockLoop();
        this.pause();
        this.video.src = '';
    }

    // ── Internal Helpers ─────────────────────────────────────────────────────

    _bindVideoEvents() {
        this.video.addEventListener('play', () => {
            this._startClockLoop();
            this._notifyState('playing');
        });

        this.video.addEventListener('pause', () => {
            this._stopClockLoop();
            this._notifyState('paused');
        });

        this.video.addEventListener('ended', () => {
            this._stopClockLoop();
            this._notifyState('ended');
            this._emitTimeUpdate();
        });

        this.video.addEventListener('timeupdate', () => {
            this._emitTimeUpdate();
        });

        this.video.addEventListener('seeked', () => {
            this._emitTimeUpdate();
        });
    }

    _startClockLoop() {
        this._stopClockLoop();
        const loop = () => {
            this._emitTimeUpdate();
            if (this.isPlaying) {
                this.animFrameId = requestAnimationFrame(loop);
            }
        };
        this.animFrameId = requestAnimationFrame(loop);
    }

    _stopClockLoop() {
        if (this.animFrameId) {
            cancelAnimationFrame(this.animFrameId);
            this.animFrameId = null;
        }
    }

    _emitTimeUpdate() {
        if (this.onTimeUpdateCallback) {
            this.onTimeUpdateCallback(this.currentTime, this.duration);
        }
    }

    _notifyState(state) {
        if (this.onStateChangeCallback) {
            this.onStateChangeCallback(state);
        }
    }
}
