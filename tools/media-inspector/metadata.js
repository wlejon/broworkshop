/**
 * metadata.js — Audio/Video Stream Diagnostics & Metadata Panel
 *
 * Formats and renders detailed technical metadata from bro.media.peaks,
 * bro.media.thumbnails, and HTMLMediaElement.
 */

export class MetadataInspector {
    /**
     * @param {HTMLElement} containerEl
     */
    constructor(containerEl) {
        this.container = containerEl;
        this.elements = {
            // Header badges
            badgeAvailable: document.getElementById('badgeAvailable'),
            badgeDuration: document.getElementById('badgeDuration'),
            badgeSampleRate: document.getElementById('badgeSampleRate'),
            badgeChannels: document.getElementById('badgeChannels'),
            badgeResolution: document.getElementById('badgeResolution'),

            // Audio table
            metaSampleRate: document.getElementById('metaSampleRate'),
            metaChannels: document.getElementById('metaChannels'),
            metaAudioDuration: document.getElementById('metaAudioDuration'),
            metaBuckets: document.getElementById('metaBuckets'),
            metaPeakMax: document.getElementById('metaPeakMax'),
            metaPeakMin: document.getElementById('metaPeakMin'),
            metaRmsAvg: document.getElementById('metaRmsAvg'),
            metaWindow: document.getElementById('metaWindow'),

            // Video table
            metaDimensions: document.getElementById('metaDimensions'),
            metaAspectRatio: document.getElementById('metaAspectRatio'),
            metaThumbCount: document.getElementById('metaThumbCount'),
            metaRotation: document.getElementById('metaRotation'),
            metaBufferSize: document.getElementById('metaBufferSize'),
            metaThumbTimes: document.getElementById('metaThumbTimes'),
        };
    }

    /**
     * Update audio stream metadata.
     * @param {Object|null} peaks
     * @param {number} [fallbackDuration]
     */
    updateAudio(peaks, fallbackDuration = 0) {
        if (!peaks) {
            this._setText('metaSampleRate', '—');
            this._setText('metaChannels', '—');
            this._setText('metaAudioDuration', fallbackDuration ? `${fallbackDuration.toFixed(3)}s` : '—');
            this._setText('metaBuckets', '—');
            this._setText('metaPeakMax', '—');
            this._setText('metaPeakMin', '—');
            this._setText('metaRmsAvg', '—');
            this._setText('metaWindow', '—');
            this._setText('badgeSampleRate', '0 Hz');
            this._setText('badgeChannels', '0 ch');
            return;
        }

        const dur = peaks.duration || fallbackDuration || 0;
        const sr = peaks.sampleRate || 0;
        const ch = peaks.channels || 1;
        const buckets = peaks.buckets || 0;

        // Calculate peak extrema and average RMS
        let maxVal = -Infinity;
        let minVal = Infinity;
        let rmsSum = 0;
        let rmsCount = 0;

        if (peaks.max) {
            for (let i = 0; i < peaks.max.length; i++) {
                if (peaks.max[i] > maxVal) maxVal = peaks.max[i];
            }
        }
        if (peaks.min) {
            for (let i = 0; i < peaks.min.length; i++) {
                if (peaks.min[i] < minVal) minVal = peaks.min[i];
            }
        }
        if (peaks.rms) {
            for (let i = 0; i < peaks.rms.length; i++) {
                rmsSum += peaks.rms[i];
                rmsCount++;
            }
        }
        const rmsAvg = rmsCount > 0 ? (rmsSum / rmsCount) : 0;

        // Populate table fields
        this._setText('metaSampleRate', `${sr.toLocaleString()} Hz`);
        this._setText('metaChannels', ch === 1 ? '1 (Mono)' : ch === 2 ? '2 (Stereo)' : `${ch} channels`);
        this._setText('metaAudioDuration', `${dur.toFixed(3)}s`);
        this._setText('metaBuckets', `${buckets.toLocaleString()} buckets`);
        this._setText('metaPeakMax', isFinite(maxVal) ? `+${maxVal.toFixed(3)} (${(maxVal * 100).toFixed(1)}%)` : '—');
        this._setText('metaPeakMin', isFinite(minVal) ? `${minVal.toFixed(3)} (${(minVal * 100).toFixed(1)}%)` : '—');
        this._setText('metaRmsAvg', `${rmsAvg.toFixed(4)} (${(rmsAvg * 100).toFixed(1)}%)`);

        const pFrom = (typeof peaks.from === 'number') ? peaks.from : 0;
        const pTo = (typeof peaks.to === 'number') ? peaks.to : dur;
        this._setText('metaWindow', `${pFrom.toFixed(2)}s .. ${pTo.toFixed(2)}s (Span: ${(pTo - pFrom).toFixed(2)}s)`);

        // Badges
        this._setText('badgeSampleRate', `${sr} Hz`);
        this._setText('badgeChannels', `${ch} ch`);
        this._setText('badgeDuration', `${dur.toFixed(2)}s`);
    }

    /**
     * Update video stream metadata.
     * @param {Object|null} strip
     * @param {Object} [videoInfo]
     */
    updateVideo(strip, videoInfo = null) {
        if (!strip && !videoInfo) {
            this._setText('metaDimensions', '—');
            this._setText('metaAspectRatio', '—');
            this._setText('metaThumbCount', '—');
            this._setText('metaRotation', '—');
            this._setText('metaBufferSize', '—');
            this._setText('metaThumbTimes', '—');
            if (this.elements.badgeResolution) this.elements.badgeResolution.textContent = 'Audio Only';
            return;
        }

        const vw = videoInfo ? videoInfo.videoWidth : (strip ? strip.width : 0);
        const vh = videoInfo ? videoInfo.videoHeight : (strip ? strip.height : 0);
        const rot = videoInfo ? videoInfo.videoRotation : (strip ? strip.rotation : 0);

        if (vw > 0 && vh > 0) {
            const aspect = this._computeAspectRatio(vw, vh);
            this._setText('metaDimensions', `${vw} × ${vh} px`);
            this._setText('metaAspectRatio', `${aspect} (${(vw / vh).toFixed(2)}:1)`);
            if (this.elements.badgeResolution) {
                this.elements.badgeResolution.textContent = `${vw}×${vh}`;
            }
        } else {
            this._setText('metaDimensions', 'No picture (Audio only)');
            this._setText('metaAspectRatio', '—');
            if (this.elements.badgeResolution) {
                this.elements.badgeResolution.textContent = 'Audio Only';
            }
        }

        this._setText('metaRotation', `${rot}°`);

        if (strip) {
            this._setText('metaThumbCount', `${strip.count} frames (${strip.width}×${strip.height} px/frame)`);
            const byteSize = strip.data ? strip.data.length : (strip.width * strip.count * strip.height * 4);
            this._setText('metaBufferSize', `${this.formatBytes(byteSize)} (Uint8ClampedArray)`);

            if (strip.times && strip.times.length > 0) {
                const preview = strip.times.slice(0, 4).map(t => `${t.toFixed(2)}s`).join(', ') +
                    (strip.times.length > 4 ? ` ... +${strip.times.length - 4} more` : '');
                this._setText('metaThumbTimes', preview);
            } else {
                this._setText('metaThumbTimes', '—');
            }
        } else {
            this._setText('metaThumbCount', '—');
            this._setText('metaBufferSize', '—');
            this._setText('metaThumbTimes', '—');
        }
    }

    /**
     * Update API availability badge.
     * @param {boolean} available
     */
    updateAvailability(available) {
        if (!this.elements.badgeAvailable) return;
        if (available) {
            this.elements.badgeAvailable.className = 'badge ok';
            this.elements.badgeAvailable.textContent = 'bro.media: ON';
        } else {
            this.elements.badgeAvailable.className = 'badge error';
            this.elements.badgeAvailable.textContent = 'bro.media: OFF';
        }
    }

    /**
     * Format bytes into readable string.
     * @param {number} bytes
     * @returns {string}
     */
    formatBytes(bytes) {
        if (!bytes || bytes <= 0) return '0 B';
        const units = ['B', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(1024));
        const num = (bytes / Math.pow(1024, i)).toFixed(1);
        return `${num} ${units[i]}`;
    }

    /**
     * Format seconds into mm:ss.mmm format.
     * @param {number} sec
     * @returns {string}
     */
    formatTimecode(sec) {
        if (isNaN(sec) || sec < 0) sec = 0;
        const mins = Math.floor(sec / 60);
        const secs = Math.floor(sec % 60);
        const ms = Math.floor((sec % 1) * 1000);
        return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}.${ms.toString().padStart(3, '0')}`;
    }

    _setText(key, text) {
        if (this.elements[key]) {
            this.elements[key].textContent = text;
        }
    }

    _computeAspectRatio(w, h) {
        const gcd = (a, b) => b === 0 ? a : gcd(b, a % b);
        const d = gcd(w, h);
        const nw = w / d;
        const nh = h / d;
        if (nw > 24 || nh > 24) {
            // Approximate to common ratios
            const r = w / h;
            if (Math.abs(r - 16 / 9) < 0.05) return '16:9';
            if (Math.abs(r - 4 / 3) < 0.05) return '4:3';
            if (Math.abs(r - 21 / 9) < 0.05) return '21:9';
            if (Math.abs(r - 1) < 0.05) return '1:1';
            return `${(w / h).toFixed(2)}:1`;
        }
        return `${nw}:${nh}`;
    }
}
