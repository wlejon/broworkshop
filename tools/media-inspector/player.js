// tools/media-inspector/player.js
export class MediaPlayer {
    constructor(videoElement, onTimeUpdate, onStateChange) {
        this.video = videoElement;
        this.onTimeUpdate = onTimeUpdate;
        this.onStateChange = onStateChange;

        this.isPlaying = false;
        this.isLooping = false;
        this.duration = 0;

        this.initEvents();
    }

    initEvents() {
        this.video.addEventListener('timeupdate', () => {
            if (this.onTimeUpdate) this.onTimeUpdate(this.video.currentTime);
        });

        this.video.addEventListener('loadedmetadata', () => {
            this.duration = this.video.duration || 0;
            if (this.onStateChange) this.onStateChange({ duration: this.duration, ready: true });
        });

        this.video.addEventListener('play', () => {
            this.isPlaying = true;
            if (this.onStateChange) this.onStateChange({ isPlaying: true });
        });

        this.video.addEventListener('pause', () => {
            this.isPlaying = false;
            if (this.onStateChange) this.onStateChange({ isPlaying: false });
        });

        this.video.addEventListener('ended', () => {
            if (this.isLooping) {
                this.seek(0);
                this.play();
            } else {
                this.isPlaying = false;
                if (this.onStateChange) this.onStateChange({ isPlaying: false });
            }
        });
    }

    load(sourceUrl) {
        this.video.src = sourceUrl;
        this.video.load();
    }

    play() {
        this.video.play().catch(err => console.warn('Play interrupted:', err));
    }

    pause() {
        this.video.pause();
    }

    togglePlay() {
        if (this.isPlaying) this.pause();
        else this.play();
    }

    stop() {
        this.pause();
        this.seek(0);
    }

    seek(timeSeconds) {
        if (Number.isFinite(timeSeconds)) {
            this.video.currentTime = Math.max(0, Math.min(this.duration || Infinity, timeSeconds));
            if (this.onTimeUpdate) this.onTimeUpdate(this.video.currentTime);
        }
    }

    setLoop(loop) {
        this.isLooping = !!loop;
        this.video.loop = this.isLooping;
    }

    setPlaybackRate(rate) {
        this.video.playbackRate = parseFloat(rate) || 1.0;
    }

    setVolume(vol) {
        this.video.volume = Math.max(0, Math.min(1, parseFloat(vol) || 0));
    }
}
