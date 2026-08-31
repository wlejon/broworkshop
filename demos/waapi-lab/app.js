// app.js — Main animation orchestration and telemetry loop for WAAPI Lab.

import { ANIMATION_PRESETS, getPresetById } from './presets.js';
import { WaapiController, ComparisonHarness } from './waapi.js';
import { TimelineScrubber, EasingPlotter } from './timeline.js';

class WaapiLabApp {
    constructor() {
        this.dom = {
            presetSelect: document.getElementById('presetSelect'),
            stateBadge: document.getElementById('stateBadge'),
            rateBadge: document.getElementById('rateBadge'),

            // Stage targets
            targetBadge: document.getElementById('targetBadge'),
            targetCard: document.getElementById('targetCard'),
            targetOrb: document.getElementById('targetOrb'),
            targetRipple: document.getElementById('targetRipple'),
            targetMorph: document.getElementById('targetMorph'),
            targetGlitch: document.getElementById('targetGlitch'),
            targetCompare: document.getElementById('targetCompare'),

            // Compare arena nodes
            compWaapiNode: document.getElementById('compWaapiNode'),
            compCssNode: document.getElementById('compCssNode'),
            compRafNode: document.getElementById('compRafNode'),
            comparisonStatsSec: document.getElementById('comparisonStatsSec'),

            // Timeline deck elements
            timelineScrubber: document.getElementById('timelineScrubber'),
            progressFill: document.getElementById('progressFill'),
            keyframeTrack: document.getElementById('keyframeTrack'),
            timecodeDisplay: document.getElementById('timecodeDisplay'),

            // Master controls
            btnPlayPause: document.getElementById('btnPlayPause'),
            btnReverse: document.getElementById('btnReverse'),
            btnCancel: document.getElementById('btnCancel'),
            btnFinish: document.getElementById('btnFinish'),
            rateButtons: document.querySelectorAll('.rate-btn'),

            // Inspector telemetry
            activeCountBadge: document.getElementById('activeCountBadge'),
            telemState: document.getElementById('telemState'),
            telemCurrentTime: document.getElementById('telemCurrentTime'),
            telemRate: document.getElementById('telemRate'),
            telemProgress: document.getElementById('telemProgress'),
            easingCanvas: document.getElementById('easingCanvas'),
            easingNameLbl: document.getElementById('easingNameLbl'),

            // Timing configuration inputs
            timingDuration: document.getElementById('timingDuration'),
            timingIterations: document.getElementById('timingIterations'),
            timingDirection: document.getElementById('timingDirection'),
            keyframeJsonBox: document.getElementById('keyframeJsonBox'),

            // Status bar
            statusTargetName: document.getElementById('statusTargetName')
        };

        this.controller = new WaapiController();
        this.easingPlotter = new EasingPlotter(this.dom.easingCanvas);
        this.timeline = new TimelineScrubber({
            slider: this.dom.timelineScrubber,
            timeDisplay: this.dom.timecodeDisplay,
            progressFill: this.dom.progressFill,
            keyframeTrack: this.dom.keyframeTrack
        }, (progress0to1) => {
            this.controller.seek(progress0to1);
        });

        this.comparisonHarness = new ComparisonHarness({
            waapi: this.dom.compWaapiNode,
            css: this.dom.compCssNode,
            raf: this.dom.compRafNode
        });

        this.currentPreset = null;
        this.currentEasing = 'linear';

        this.initEvents();
        this.loadPreset('elastic-pop');
        this.startTelemetryLoop();
    }

    initEvents() {
        // Preset switch
        this.dom.presetSelect.addEventListener('change', (e) => {
            this.loadPreset(e.target.value);
        });

        // Master playback buttons
        this.dom.btnPlayPause.addEventListener('click', () => {
            const isRunning = this.controller.togglePlay();
            this.dom.btnPlayPause.textContent = isRunning ? '⏸ Pause' : '▶ Play';
        });

        this.dom.btnReverse.addEventListener('click', () => {
            this.controller.reverse();
        });

        this.dom.btnCancel.addEventListener('click', () => {
            this.controller.cancel();
        });

        this.dom.btnFinish.addEventListener('click', () => {
            this.controller.finish();
        });

        // Playback Rate buttons
        this.dom.rateButtons.forEach(btn => {
            btn.addEventListener('click', () => {
                this.dom.rateButtons.forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                const rate = parseFloat(btn.dataset.rate);
                this.controller.setPlaybackRate(rate);
                this.dom.rateBadge.textContent = `${rate}x`;
            });
        });

        // Timing inputs
        const updateTiming = () => {
            if (!this.currentPreset || this.dom.presetSelect.value === 'comparison-arena') return;

            const duration = parseInt(this.dom.timingDuration.value, 10) || 1200;
            const iterVal = this.dom.timingIterations.value;
            const iterations = iterVal === 'Infinity' ? Infinity : parseInt(iterVal, 10);
            const direction = this.dom.timingDirection.value;

            this.currentPreset.timing.duration = duration;
            this.currentPreset.timing.iterations = iterations;
            this.currentPreset.timing.direction = direction;

            this.runPresetAnimation(this.currentPreset);
        };

        this.dom.timingDuration.addEventListener('change', updateTiming);
        this.dom.timingIterations.addEventListener('change', updateTiming);
        this.dom.timingDirection.addEventListener('change', updateTiming);

        // Resize easing canvas on window resize
        window.addEventListener('resize', () => {
            this.easingPlotter.render(this.currentEasing, 0);
        });
    }

    hideAllTargets() {
        this.dom.targetBadge.style.display = 'none';
        this.dom.targetCard.style.display = 'none';
        this.dom.targetOrb.style.display = 'none';
        this.dom.targetRipple.style.display = 'none';
        this.dom.targetMorph.style.display = 'none';
        this.dom.targetGlitch.style.display = 'none';
        this.dom.targetCompare.style.display = 'none';
        this.dom.comparisonStatsSec.style.display = 'none';
    }

    loadPreset(presetId) {
        this.hideAllTargets();
        this.comparisonHarness.stop();

        if (presetId === 'comparison-arena') {
            this.dom.targetCompare.style.display = 'flex';
            this.dom.comparisonStatsSec.style.display = 'block';
            this.dom.statusTargetName.textContent = 'Comparison Arena';
            this.dom.keyframeJsonBox.textContent = '// Side-by-side comparison mode running: WAAPI vs CSS vs rAF.';
            this.comparisonHarness.start();
            this.currentEasing = 'cubic-bezier(0.4, 0, 0.2, 1)';
            this.dom.easingNameLbl.textContent = 'cubic-bezier(0.4, 0, 0.2, 1)';
            return;
        }

        const preset = getPresetById(presetId);
        this.currentPreset = preset;
        this.currentEasing = preset.timing.easing || 'linear';

        // Update Timing Form Inputs
        this.dom.timingDuration.value = preset.timing.duration;
        this.dom.timingIterations.value = preset.timing.iterations.toString();
        this.dom.timingDirection.value = preset.timing.direction || 'normal';

        // Update Keyframes JSON Display
        this.dom.keyframeJsonBox.textContent = JSON.stringify(preset.keyframes, null, 2);
        this.dom.easingNameLbl.textContent = preset.timing.easing;
        this.dom.statusTargetName.textContent = preset.name;

        // Set keyframe markers on timeline track
        this.timeline.setKeyframeMarkers(preset.keyframes);

        this.runPresetAnimation(preset);
    }

    runPresetAnimation(preset) {
        let targets = null;

        switch (preset.targetType) {
            case 'badge':
                this.dom.targetBadge.style.display = 'block';
                targets = this.dom.targetBadge;
                break;
            case 'card':
                this.dom.targetCard.style.display = 'flex';
                targets = this.dom.targetCard;
                break;
            case 'orb':
                this.dom.targetOrb.style.display = 'block';
                targets = this.dom.targetOrb;
                break;
            case 'rippleGrid':
                this.dom.targetRipple.style.display = 'grid';
                targets = Array.from(this.dom.targetRipple.querySelectorAll('.ripple-dot'));
                break;
            case 'morphBlob':
                this.dom.targetMorph.style.display = 'block';
                targets = this.dom.targetMorph;
                break;
            case 'glitchBanner':
                this.dom.targetGlitch.style.display = 'block';
                targets = this.dom.targetGlitch;
                break;
            default:
                this.dom.targetBadge.style.display = 'block';
                targets = this.dom.targetBadge;
        }

        const options = { ...preset.timing };
        if (preset.targetType === 'rippleGrid') {
            options.stagger = 60; // 60ms delay between ripple dots
        }

        this.controller.animate(targets, preset.keyframes, options);
        this.dom.btnPlayPause.textContent = '⏸ Pause';
    }

    startTelemetryLoop() {
        const update = () => {
            const telem = this.controller.getTelemetry();

            if (telem.hasAnimation) {
                this.dom.telemState.textContent = telem.playState;
                this.dom.telemState.style.color = telem.playState === 'running' ? 'var(--green)' : 'var(--amber)';
                this.dom.telemCurrentTime.textContent = `${telem.currentTime} ms`;
                this.dom.telemRate.textContent = `${telem.playbackRate.toFixed(2)}x`;
                this.dom.telemProgress.textContent = `${(telem.progress * 100).toFixed(1)}%`;
                this.dom.activeCountBadge.textContent = `${telem.activeCount} Active`;

                this.dom.stateBadge.textContent = `State: ${telem.playState}`;

                // Update timeline scrubber
                this.timeline.update(telem);

                // Render easing curve with current progress ball
                this.easingPlotter.render(this.currentEasing, telem.progress);
            }

            requestAnimationFrame(update);
        };

        requestAnimationFrame(update);
    }
}

window.addEventListener('DOMContentLoaded', () => {
    window.app = new WaapiLabApp();
});
