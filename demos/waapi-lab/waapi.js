// waapi.js — Web Animations API controller and side-by-side comparison engine.

export class WaapiController {
    constructor() {
        this.activeAnimations = [];
        this.primaryAnimation = null;
        this.eventListeners = {
            finish: [],
            cancel: [],
            remove: []
        };
    }

    /**
     * Creates and starts an animation sequence on target element(s).
     * @param {Element|Element[]} targets
     * @param {Keyframe[]|PropertyIndexedKeyframes} keyframes
     * @param {KeyframeAnimationOptions|number} options
     */
    animate(targets, keyframes, options) {
        this.cancel();

        const elements = Array.isArray(targets) ? targets : [targets];
        this.activeAnimations = [];

        elements.forEach((el, index) => {
            if (!el) return;

            // Support staggered delay if multiple elements
            let finalOptions = typeof options === 'object' ? { ...options } : options;
            if (elements.length > 1 && typeof finalOptions === 'object' && finalOptions.stagger) {
                finalOptions.delay = (finalOptions.delay || 0) + index * finalOptions.stagger;
            }

            const anim = el.animate(keyframes, finalOptions);

            anim.onfinish = (e) => this._emit('finish', e, anim);
            anim.oncancel = (e) => this._emit('cancel', e, anim);
            if (typeof anim.onremove !== 'undefined') {
                anim.onremove = (e) => this._emit('remove', e, anim);
            }

            this.activeAnimations.push(anim);
        });

        this.primaryAnimation = this.activeAnimations[0] || null;
        return this.primaryAnimation;
    }

    play() {
        this.activeAnimations.forEach(a => a.play());
    }

    pause() {
        this.activeAnimations.forEach(a => a.pause());
    }

    togglePlay() {
        if (!this.primaryAnimation) return false;
        if (this.primaryAnimation.playState === 'running') {
            this.pause();
            return false; // is paused
        } else {
            this.play();
            return true; // is running
        }
    }

    reverse() {
        this.activeAnimations.forEach(a => a.reverse());
    }

    cancel() {
        this.activeAnimations.forEach(a => a.cancel());
        this.activeAnimations = [];
        this.primaryAnimation = null;
    }

    finish() {
        this.activeAnimations.forEach(a => {
            try {
                a.finish();
            } catch (e) {
                // finish() throws if duration is Infinity
                console.warn('finish() called on infinite animation:', e);
            }
        });
    }

    setPlaybackRate(rate) {
        const numRate = parseFloat(rate);
        if (isNaN(numRate)) return;
        this.activeAnimations.forEach(a => {
            if (a.updatePlaybackRate) {
                a.updatePlaybackRate(numRate);
            } else {
                a.playbackRate = numRate;
            }
        });
    }

    setCurrentTime(timeMs) {
        if (!this.primaryAnimation) return;
        this.activeAnimations.forEach(a => {
            try {
                a.currentTime = timeMs;
            } catch (e) {
                console.warn('Error setting currentTime:', e);
            }
        });
    }

    seek(progress0to1) {
        if (!this.primaryAnimation) return;
        const timing = this.getComputedTiming();
        const duration = timing ? timing.duration : 1000;
        if (typeof duration === 'number' && duration > 0) {
            const targetMs = progress0to1 * duration;
            this.setCurrentTime(targetMs);
        }
    }

    commitStyles() {
        this.activeAnimations.forEach(a => {
            if (typeof a.commitStyles === 'function') {
                try {
                    a.commitStyles();
                } catch (e) {
                    console.warn('commitStyles not supported or failed:', e);
                }
            }
        });
    }

    getComputedTiming() {
        if (!this.primaryAnimation || !this.primaryAnimation.effect) return null;
        if (typeof this.primaryAnimation.effect.getComputedTiming === 'function') {
            return this.primaryAnimation.effect.getComputedTiming();
        }
        return null;
    }

    getTelemetry() {
        if (!this.primaryAnimation) {
            return {
                hasAnimation: false,
                playState: 'idle',
                currentTime: 0,
                playbackRate: 1.0,
                progress: 0,
                currentIteration: 0,
                duration: 0,
                activeCount: 0,
                pending: false
            };
        }

        const anim = this.primaryAnimation;
        const timing = this.getComputedTiming();

        const duration = timing && typeof timing.duration === 'number' ? timing.duration : 1000;
        const rawTime = anim.currentTime || 0;
        const progress = duration > 0 ? (rawTime % duration) / duration : 0;
        const iteration = timing ? timing.currentIteration : Math.floor(rawTime / Math.max(1, duration));

        return {
            hasAnimation: true,
            playState: anim.playState || 'running',
            currentTime: Math.round(rawTime),
            playbackRate: anim.playbackRate ?? 1.0,
            progress: Math.min(1, Math.max(0, progress)),
            currentIteration: iteration || 0,
            duration: duration,
            iterations: timing ? timing.iterations : Infinity,
            easing: timing ? timing.easing : 'linear',
            direction: timing ? timing.direction : 'normal',
            activeCount: this.activeAnimations.length,
            pending: anim.pending || false
        };
    }

    on(event, handler) {
        if (this.eventListeners[event]) {
            this.eventListeners[event].push(handler);
        }
    }

    _emit(event, ...args) {
        const list = this.eventListeners[event] || [];
        list.forEach(fn => fn(...args));
    }
}

/**
 * Performance & Engine Comparison Harness:
 * Synchronously tests WAAPI vs CSS Keyframes vs requestAnimationFrame.
 */
export class ComparisonHarness {
    constructor(elements) {
        this.waapiEl = elements.waapi;
        this.cssEl = elements.css;
        this.rafEl = elements.raf;

        this.isRunning = false;
        this.rafHandle = null;
        this.startTime = 0;
        this.duration = 2000;

        this.metrics = {
            waapi: { fps: 60, frameTime: 16.6, frames: 0, lastTick: 0 },
            css: { fps: 60, frameTime: 16.6, frames: 0, lastTick: 0 },
            raf: { fps: 60, frameTime: 16.6, frames: 0, lastTick: 0 }
        };
    }

    start() {
        this.stop();
        this.isRunning = true;
        this.startTime = performance.now();

        // 1. Start WAAPI
        if (this.waapiEl) {
            this.waapiAnim = this.waapiEl.animate([
                { transform: 'translateY(0px) rotate(0deg) scale(1)', background: '#00f0ff' },
                { transform: 'translateY(-30px) rotate(180deg) scale(1.15)', background: '#a855f7' },
                { transform: 'translateY(0px) rotate(360deg) scale(1)', background: '#00f0ff' }
            ], {
                duration: this.duration,
                iterations: Infinity,
                easing: 'cubic-bezier(0.4, 0, 0.2, 1)'
            });
        }

        // 2. Start CSS Animation (via class)
        if (this.cssEl) {
            this.cssEl.classList.add('animating-compare');
        }

        // 3. Start requestAnimationFrame Loop
        let lastFrame = performance.now();
        const tick = (now) => {
            if (!this.isRunning) return;

            const elapsed = now - this.startTime;
            const progress = (elapsed % this.duration) / this.duration;

            // Compute ease-in-out progress for rAF
            const eased = progress < 0.5
                ? 2 * progress * progress
                : -1 + (4 - 2 * progress) * progress;

            const translateY = -30 * Math.sin(progress * Math.PI);
            const rotate = progress * 360;
            const scale = 1 + 0.15 * Math.sin(progress * Math.PI);

            if (this.rafEl) {
                this.rafEl.style.transform = `translateY(${translateY}px) rotate(${rotate}deg) scale(${scale})`;
            }

            // Track frame timing
            const delta = now - lastFrame;
            lastFrame = now;
            this.metrics.raf.fps = Math.round(1000 / Math.max(1, delta));
            this.metrics.raf.frameTime = Math.round(delta * 10) / 10;

            this.rafHandle = requestAnimationFrame(tick);
        };

        this.rafHandle = requestAnimationFrame(tick);
    }

    stop() {
        this.isRunning = false;
        if (this.waapiAnim) {
            this.waapiAnim.cancel();
            this.waapiAnim = null;
        }
        if (this.cssEl) {
            this.cssEl.classList.remove('animating-compare');
        }
        if (this.rafHandle) {
            cancelAnimationFrame(this.rafHandle);
            this.rafHandle = null;
        }
        if (this.rafEl) {
            this.rafEl.style.transform = '';
        }
    }
}
