// demos/dom-lab/web-animations.js

export class WebAnimationsLab {
    constructor(orbElement, cardElement, onTelemetry) {
        this.orb = orbElement;
        this.card = cardElement;
        this.onTelemetry = onTelemetry;

        this.animations = [];
        this.init();
    }

    init() {
        // Orb floating & pulsing animation
        const orbAnim = this.orb.animate([
            { transform: 'translateY(0px) scale(1)', opacity: 0.9 },
            { transform: 'translateY(-30px) scale(1.15)', opacity: 1.0, offset: 0.5 },
            { transform: 'translateY(0px) scale(1)', opacity: 0.9 }
        ], {
            duration: 1800,
            iterations: Infinity,
            easing: 'ease-in-out',
            id: 'orb-float'
        });

        // Card glow & shift animation
        const cardAnim = this.card.animate([
            { transform: 'rotate(0deg) scale(1)', borderColor: 'rgba(88, 166, 255, 0.2)' },
            { transform: 'rotate(2deg) scale(1.04)', borderColor: 'rgba(88, 166, 255, 0.8)', offset: 0.5 },
            { transform: 'rotate(0deg) scale(1)', borderColor: 'rgba(88, 166, 255, 0.2)' }
        ], {
            duration: 2400,
            iterations: Infinity,
            easing: 'ease-in-out',
            id: 'card-pulse'
        });

        this.animations = [orbAnim, cardAnim];
    }

    play() {
        for (const anim of this.animations) anim.play();
    }

    pause() {
        for (const anim of this.animations) anim.pause();
    }

    togglePlay() {
        const isPaused = this.animations.some(a => a.playState === 'paused');
        if (isPaused) this.play();
        else this.pause();
        return !isPaused;
    }

    reverse() {
        for (const anim of this.animations) anim.reverse();
    }

    cancel() {
        for (const anim of this.animations) anim.cancel();
    }

    setPlaybackRate(rate) {
        const r = parseFloat(rate) || 1.0;
        for (const anim of this.animations) anim.playbackRate = r;
    }

    getTelemetry() {
        const primary = this.animations[0];
        const count = (typeof document.getAnimations === 'function')
            ? document.getAnimations().length
            : this.animations.length;

        return {
            playState: primary ? primary.playState : 'idle',
            currentTime: primary && primary.currentTime !== null ? Math.round(primary.currentTime) : 0,
            playbackRate: primary ? primary.playbackRate : 1.0,
            count: count
        };
    }
}
