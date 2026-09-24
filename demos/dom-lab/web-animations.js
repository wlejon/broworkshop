// Web Animations: two infinite element.animate() loops (a floating orb, a
// pulsing card) under one transport, with the primary Animation's state read
// back every frame.

import { $ } from "/lib/kit/dom.js";

export const animState = { animations: [] };

export function startAnimations() {
    const orb = $('#anim-orb').animate([
        { transform: 'translateY(0px) scale(1)', opacity: 0.9 },
        { transform: 'translateY(-30px) scale(1.15)', opacity: 1.0, offset: 0.5 },
        { transform: 'translateY(0px) scale(1)', opacity: 0.9 },
    ], { duration: 1800, iterations: Infinity, easing: 'ease-in-out', id: 'orb-float' });

    const card = $('#anim-card').animate([
        { transform: 'rotate(0deg) scale(1)', borderColor: 'rgba(88, 166, 255, 0.2)' },
        { transform: 'rotate(2deg) scale(1.04)', borderColor: 'rgba(88, 166, 255, 0.8)', offset: 0.5 },
        { transform: 'rotate(0deg) scale(1)', borderColor: 'rgba(88, 166, 255, 0.2)' },
    ], { duration: 2400, iterations: Infinity, easing: 'ease-in-out', id: 'card-pulse' });

    animState.animations = [orb, card];
}

const each = (fn) => { for (const a of animState.animations) fn(a); };

/** Play if anything is not running (paused, or idle after cancel); else pause. Returns running. */
export function togglePlay() {
    const running = animState.animations.every((a) => a.playState === 'running');
    if (running) each((a) => a.pause());
    else each((a) => a.play());
    return !running;
}
export function reverse() { each((a) => a.reverse()); }
export function cancel() { each((a) => a.cancel()); }
export function setPlaybackRate(rate) {
    const r = parseFloat(rate) || 1;
    each((a) => { a.playbackRate = r; });
}

export function telemetry() {
    const a = animState.animations[0];
    return {
        playState: a ? a.playState : 'idle',
        currentTime: a && a.currentTime !== null ? Math.round(a.currentTime) : null,
        playbackRate: a ? a.playbackRate : 1,
        count: document.getAnimations().length,
    };
}

export function initWebAnimations() {
    startAnimations();
    const btn = $('#anim-play');
    const label = () => {
        const running = animState.animations.every((a) => a.playState === 'running');
        btn.textContent = running ? 'Pause' : 'Play';
    };
    btn.addEventListener('click', () => { togglePlay(); label(); });
    $('#anim-reverse').addEventListener('click', () => { reverse(); label(); });
    $('#anim-cancel').addEventListener('click', () => { cancel(); label(); });
    $('#anim-speed').addEventListener('change', (e) => setPlaybackRate(e.target.value));
    return label;
}

/** Per-frame readout. */
export function renderTelemetry() {
    const t = telemetry();
    $('#anim-state').textContent = t.playState;
    $('#anim-time').textContent = t.currentTime === null ? '—' : t.currentTime + ' ms';
    $('#anim-rate').textContent = t.playbackRate.toFixed(1) + '×';
    $('#anim-count').textContent = String(t.count);
}
